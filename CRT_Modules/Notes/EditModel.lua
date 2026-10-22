local ADDON, CRT = ...

-- The assignments of a note as rows of names, for the pop-out note editor (Notes/EditorWindow.lua). No frames.
-- The raw text stays the one source: an edit changes only names, and Text() gives the raw text back with every
-- other byte as written (times, phases, text, colours, unknown fields, spacing, line ends, line order). A line
-- whose names are back to what they were is written exactly as it was.
--   Model.New(text, opts)       a session over the text. opts: markdown (the personal note), readOnly
--   s.rows                      the note's lines in their own order (see rowFor)
--   s:Add(i, token, kind)       appends a name or tag word to row i; kind is the palette chip's ("player",
--                               "general", "group", "class"), nil for a name from a row
--   s:Remove(i, k)              removes row i's k-th name
--   s:Move(i, k, j)             moves row i's k-th name to row j
--   s:Text(), s:Dirty()         the raw text now, and whether it differs from the text opened
--   s:SetQuickFill(on), s:Select(i), s:PaletteClick(token, kind)   Quick fill: a click on a chip adds it to the row
--   s:BeginDrag(source), s:Drop(i), s:CancelDrag()   a drag: { token, kind } from the palette, { row, index } from a row
--   Model.Palette(roster, query)  the palette's sections: Players, General, Groups and Classes
--   Model.Sources(layouts, linkedId, noInvite), Model.DefaultSource(linkedId, inGroup), Model.Roster(names, classOf, roleOf)
--                               where the Players come from: the group, the note's invite list or a Raid Groups layout
-- Where the names are (Alex, 2026-10-21: only the text assignments and the invite list; the timed lines, cooldowns
-- included, are left alone for now):
--   a label line   "Label: names" (a line of free text with a colon), its words after the colon, kept with the
--                  commas and spaces between them as written; a new name takes the line's own separator.
--   the invite     "invitelist:A,B,,C;", its comma-separated slots in group order. Only players: a removed name
--   list           leaves its slot empty, so everyone after it keeps their group; a new one fills the first empty
--                  slot, else goes on the end. The spaces in a slot and everything around the list stay as written.
-- Every other line (the header, the timed lines, headings, text, a timer the parser could not read) is shown as
-- written and never changes.

local Model = {}
CRT.NoteEditModel = Model

local Parser = CRT.NoteParser

local TEXT = {
    everyone = "Everyone",
    tanks = "Tanks",
    healers = "Healers",
    dps = "Dps",
    melee = "Melee",
    ranged = "Ranged",
    group = "Group %d",
    fromGroup = "Current group",
    fromInvite = "This note's invite list",
}

-- The tag words the alerts understand (Notes/Engine.lua: IsMine, groupTag and the class words), which the
-- Raid Notes integrations also read: "everyone", a role, "Group1".."Group8" in one word (Integrations/MRT.lua
-- reads only that spelling of a group), and a class by its name as raiders' notes write it, with its space
-- ("Death Knight", Parse.lua's class words). Lines written by file name ("DEATHKNIGHT") still read.
Model.GENERAL = {
    { label = TEXT.everyone, token = "everyone" },
    { label = TEXT.tanks, token = "tank" },
    { label = TEXT.healers, token = "healer" },
    { label = TEXT.dps, token = "dps" },
    { label = TEXT.melee, token = "melee" },
    { label = TEXT.ranged, token = "ranged" },
}
Model.GROUPS = 8

-- Words that name a role, everyone or a raid group rather than a player (Notes/Engine.lua's tag words): never put
-- in the invite list.
local NOT_PLAYER = { all = true, everyone = true, raid = true, tank = true, tanks = true, healer = true,
    healers = true, heal = true, dps = true, damager = true, damage = true, melee = true, melees = true,
    ranged = true, range = true }

-- A name in a label line: anything between spaces and commas, so removing one keeps every other mark as written
-- ("Abu (left), Cheo" removes "(left)" as one word, never a bracket of it). A class name of several words with
-- only spaces between them ("Demon Hunter") is one name.
local LABEL_WORD = "[^%s,]+"

local function trim(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

-- The raw text as { text, eol } pieces, cut where Parse cuts its lines; joined they give the text back.
-- Notes/Data.lua's, so a note is cut into lines one way.
local splitLines = CRT.Notes.SplitPieces

-- The game's classes: { label (its name in the game), token (its name as notes write it, "Demon Hunter"), class
-- (its file name) }.
local function classes()
    local out = {}
    local n = GetNumClasses and GetNumClasses() or 0
    for i = 1, n do
        local ok, name, file = pcall(GetClassInfo, i)
        if ok and readable(name) and readable(file) and type(name) == "string" and type(file) == "string"
            and name ~= "" and file ~= "" then
            out[#out + 1] = { label = name, token = Parser.ClassName(file) or name, class = file }
        end
    end
    return out
end

-- Whether a word names a role, everyone, a raid group or a class, not a player.
local function notPlayer(word)
    local lower = word:lower()
    if NOT_PLAYER[lower] or lower:match("^g%d$") or lower:match("^grp%d$") or lower:match("^group%d$") then
        return true
    end
    return Parser.ClassOf(word) ~= nil
end
Model.NotPlayer = notPlayer

-- Label fields -----------------------------------------------------------------------------------------------

-- The names of a label line: before .. lead .. names (each after its separator) .. trail.
local function labelField(line)
    local colon = line:find(":", 1, true)
    local value = line:sub(colon + 1)
    local f = { kind = "label", before = line:sub(1, colon), items = {}, lead = "", trail = "" }
    local pos = 1
    -- a class name of several words with spaces between them is one name ("Demon Hunter"), as Parse.lua cuts it
    for _, item in ipairs(Parser.ClassRuns(value, LABEL_WORD)) do
        local sep = value:sub(pos, item.start - 1)
        if #f.items == 0 then
            f.lead = sep
        end
        f.items[#f.items + 1] = { word = item.text, sep = #f.items == 0 and "" or sep }
        pos = item.stop
    end
    if #f.items == 0 then
        f.lead = value -- the spaces where the names go
    else
        f.trail = value:sub(pos)
    end
    f.sep = (f.items[2] and f.items[2].sep) or ", "
    return f
end

-- Invite fields ----------------------------------------------------------------------------------------------

-- The slots of an invite list: before ("invitelist:") .. slots joined by "," .. after (the closing ";" and any
-- spaces). Each slot { lead, name, trail }; an empty slot has name "".
local function inviteField(line)
    local colon = line:find(":", 1, true)
    local rest = line:sub(colon + 1)
    local close = rest:find(";%s*$")
    local value = close and rest:sub(1, close - 1) or rest
    local f = { kind = "invite", before = line:sub(1, colon), after = close and rest:sub(close) or "", slots = {} }
    local pos = 1
    while true do
        local comma = value:find(",", pos, true)
        local entry = value:sub(pos, (comma or 0) - 1)
        local lead, name, trail = entry:match("^(%s*)(.-)(%s*)$")
        f.slots[#f.slots + 1] = { lead = lead, name = name, trail = trail }
        if not comma then
            break
        end
        pos = comma + 1
    end
    return f
end

-- Fields, either kind -----------------------------------------------------------------------------------------

local function names(f)
    local out = {}
    if f.kind == "invite" then
        for _, slot in ipairs(f.slots) do
            if slot.name ~= "" then
                out[#out + 1] = slot.name
            end
        end
    else
        for k, item in ipairs(f.items) do
            out[k] = item.word
        end
    end
    return out
end

-- Whether the field has the token already, a class in any spelling ("DEMONHUNTER" for "Demon Hunter").
local function has(f, token)
    local lower, class = token:lower(), Parser.ClassOf(token)
    for _, name in ipairs(names(f)) do
        if name:lower() == lower or (class and Parser.ClassOf(name) == class) then
            return true
        end
    end
    return false
end

local function add(f, token)
    if f.kind == "invite" then
        for _, slot in ipairs(f.slots) do
            if slot.name == "" then
                slot.name = token
                return
            end
        end
        f.slots[#f.slots + 1] = { lead = "", name = token, trail = "" }
        return
    end
    if #f.items == 0 and f.lead == "" then
        f.lead = " " -- "Kicks:" becomes "Kicks: Name"
    end
    f.items[#f.items + 1] = { word = token, sep = f.sep }
end

-- Removes the k-th name: a label's with the separator before it (the first name: the one after it goes); an
-- invite list's leaves its slot empty.
local function remove(f, k)
    if f.kind == "invite" then
        local n = 0
        for _, slot in ipairs(f.slots) do
            if slot.name ~= "" then
                n = n + 1
                if n == k then
                    slot.name = ""
                    return true
                end
            end
        end
        return false
    end
    if not f.items[k] then
        return false
    end
    table.remove(f.items, k)
    if k == 1 and f.items[1] then
        f.items[1].sep = ""
    end
    return true
end

-- The field's names, slot by slot (an invite list's empty slots as ""), to tell whether they changed.
local function shape(f)
    if f.kind ~= "invite" then
        return names(f)
    end
    local out = {}
    for i, slot in ipairs(f.slots) do
        out[i] = slot.name
    end
    return out
end

local function fieldText(f)
    if f.kind == "invite" then
        local out = {}
        for i, slot in ipairs(f.slots) do
            out[i] = slot.lead .. slot.name .. slot.trail
        end
        return f.before .. table.concat(out, ",") .. f.after
    end
    local out = { f.lead }
    for k, item in ipairs(f.items) do
        out[#out + 1] = (k > 1 and item.sep or "") .. item.word
    end
    return f.before .. table.concat(out) .. f.trail
end

-- Rows ----------------------------------------------------------------------------------------------------------

local function num(n)
    return (("%.10g"):format(n))
end

-- Whether the part before a line's colon reads as an assignment's label (Parse.lua's, which the integrations read
-- too): short, with no markup, and not a phase heading ("Phase 2: kite adds left").
local looksLikeLabel = Parser.LooksLikeLabel
Model.LooksLikeLabel = looksLikeLabel

-- A line that is not a timer. Mirrors Render.lua's freeRow: blank, a label ("Melee: names"), a heading (no colon)
-- or text; with markdown also # heading, --- divider and - bullet (text).
local function freeRow(row, line, markdown)
    local t = trim(line)
    if t == "" then
        row.kind = "blank"
        return
    end
    if markdown then
        local heading = t:match("^#+%s+(.-)%s*$")
        if heading then
            row.kind, row.text = "heading", heading
            return
        end
        if t:match("^%-%-%-+$") or t:match("^%*%*%*+$") or t:match("^[%-%*]%s+.+$") then
            row.kind, row.text = "text", t
            return
        end
    end
    local label = t:match("^([^:]+):")
    if label and looksLikeLabel(label) then
        row.kind, row.label, row.editable = "label", label, true
        row.field = labelField(line)
    elseif t:find(":", 1, true) or t:find("**", 1, true) then
        row.kind, row.text = "text", t
    else
        row.kind, row.text = "heading", t
    end
end

-- One row per line of the text: { kind, line (its number), raw (as written), editable } and, by kind: timer { time,
-- ph, timer (the parsed timer), tags (its names, shown only), display }, label { label }, heading / text / unread
-- { text }. Kinds: header, timer, unread (starts like a timer, no time the parser reads), invite, label, heading,
-- text, blank. Only label and invite rows take names.
local function rowFor(lineNo, raw, timer, markdown)
    local row = { line = lineNo, raw = raw }
    local lower = trim(raw):lower()
    if timer then
        row.kind, row.timer, row.tags = "timer", timer, timer.tags or {}
        local t = math.max(0, timer.time)
        row.time = string.format("%d:%02d", math.floor(t / 60), math.floor(t % 60))
        row.ph = num(timer.ph or 1)
        local display = Parser.Field(raw, "displaytype")
        row.display = (display and display ~= "") and display or nil
    elseif lower:find("^encounterid:") then
        row.kind, row.text = "header", trim(raw)
    elseif lower:find("^invitelist:") then
        row.kind, row.editable = "invite", true
        row.field = inviteField(raw)
    elseif lower:find("^time:") or (lower:find("^ph:%s*[%d%.]+%s*;") and lower:find(";%s*time:")) then
        row.kind, row.text = "unread", trim(raw)
    else
        freeRow(row, raw, markdown)
    end
    if row.field then
        row.original = shape(row.field)
    end
    return row
end

local Session = {}
Session.__index = Session

function Model.New(text, opts)
    opts = opts or {}
    text = text or ""
    local s = setmetatable({ base = text, readOnly = opts.readOnly and true or false, markdown = opts.markdown,
        quickFill = false, rows = {} }, Session)
    local note = Parser.Parse(text)
    local byLine = {}
    for _, t in ipairs(note.timers) do
        byLine[t.line] = t
    end
    s.pieces = splitLines(text)
    for i, piece in ipairs(s.pieces) do
        s.rows[i] = rowFor(i, piece.text, byLine[i], opts.markdown)
    end
    return s
end

-- Row i's names now (a copy; an invite list's without its empty slots).
function Session:Names(i)
    local row = self.rows[i]
    return (row and row.field) and names(row.field) or {}
end

-- Whether row i takes names.
function Session:Editable(i)
    local row = self.rows[i]
    return not self.readOnly and row ~= nil and row.editable == true
end

-- A token fit to be one name or tag word: no spaces, ";", ":", ",", "|" or line ends. A class name may hold its
-- spaces ("Demon Hunter").
local function validToken(token)
    if not (type(token) == "string" and readable(token)) then
        return false
    end
    if token:match("^[^%s;:,|]+$") then
        return true
    end
    -- spaces only, inside it: never a tab or a space at either end
    return not token:find("^ ") and not token:find(" $") and token:gsub(" +", ""):match("^[^%s;:,|]+$") ~= nil
        and Parser.ClassOf(token) ~= nil
end
Model.ValidToken = validToken

-- Adds a name to row i. False when the row takes no names, the token isn't one word, the row has it already, or
-- (the invite list) it is not a player.
function Session:Add(i, token, kind)
    if not (self:Editable(i) and validToken(token)) then
        return false
    end
    local f = self.rows[i].field
    if has(f, token) then
        return false
    end
    if f.kind == "invite" and ((kind ~= nil and kind ~= "player") or notPlayer(token)) then
        return false
    end
    add(f, token)
    return true
end

-- Removes row i's k-th name.
function Session:Remove(i, k)
    if not self:Editable(i) then
        return false
    end
    return remove(self.rows[i].field, k)
end

-- Moves row i's k-th name to row j. Nothing changes when j can't take it.
function Session:Move(i, k, j)
    if i == j or not (self:Editable(i) and self:Editable(j)) then
        return false
    end
    -- added to j first, removed from i only once it is in: a word j refuses is never lost
    local word = self:Names(i)[k]
    if not (word and validToken(word)) or not self:Add(j, word) then
        return false
    end
    return self:Remove(i, k)
end

local function changed(row)
    local now = shape(row.field)
    if #now ~= #row.original then
        return true
    end
    for k, name in ipairs(now) do
        if name ~= row.original[k] then
            return true
        end
    end
    return false
end

-- Row i's line now: as written while its names are the ones it had.
function Session:LineText(i)
    local row = self.rows[i]
    if not (row and row.field and changed(row)) then
        return row and row.raw or nil
    end
    return fieldText(row.field)
end

function Session:Text()
    local out = {}
    for i, piece in ipairs(self.pieces) do
        out[i] = self:LineText(i) .. piece.eol
    end
    return table.concat(out)
end

function Session:Dirty()
    return self:Text() ~= self.base
end

-- The players in the note's invite list now (every invite line's, each once, in order), edits included.
function Session:InviteNames()
    local out, seen = {}, {}
    for i, row in ipairs(self.rows) do
        if row.kind == "invite" then
            for _, name in ipairs(self:Names(i)) do
                if not seen[name:lower()] then
                    seen[name:lower()] = true
                    out[#out + 1] = name
                end
            end
        end
    end
    return out
end

-- Quick fill ----------------------------------------------------------------------------------------------------

function Session:SetQuickFill(on)
    self.quickFill = on and true or false
    if not self.quickFill then
        self.selected = nil
    end
end

-- Selects row i for Quick fill (only a row that takes names). Returns the row selected, or nil.
function Session:Select(i)
    self.selected = (self.quickFill and self:Editable(i)) and i or nil
    return self.selected
end

-- A click on a palette chip: with Quick fill on and a row selected, the chip's token is added to it.
function Session:PaletteClick(token, kind)
    if self.quickFill and self.selected then
        return self:Add(self.selected, token, kind)
    end
    return false
end

-- Drag and drop -------------------------------------------------------------------------------------------------

-- source: { token = "Name", kind } (a palette chip) or { row = i, index = k } (a row's chip). Nothing in read-only.
function Session:BeginDrag(source)
    self.drag = nil
    if self.readOnly or type(source) ~= "table" then
        return false
    end
    if source.row then
        -- a word that could not go anywhere (an invite slot holding "Two words", say) is never picked up
        local word = self:Editable(source.row) and self:Names(source.row)[source.index]
        if not (word and validToken(word)) then
            return false
        end
    elseif not validToken(source.token) then
        return false
    end
    self.drag = source
    return true
end

-- Drops the drag on row i (nil: outside every row, which does nothing). Returns whether a name was added or moved.
function Session:Drop(i)
    local d = self.drag
    self.drag = nil
    if not (d and i) then
        return false
    end
    if d.row then
        return self:Move(d.row, d.index, i)
    end
    return self:Add(i, d.token, d.kind)
end

function Session:CancelDrag()
    self.drag = nil
end

-- The palette ---------------------------------------------------------------------------------------------------

local ROLE_ORDER = { TANK = 1, HEALER = 2, DAMAGER = 3 }

-- The name a player chip writes: without the realm when it is your own (Ambiguate "none", as Raid Groups shows it).
local function shortName(key)
    if Ambiguate then
        local ok, name = pcall(Ambiguate, key, "none")
        if ok and type(name) == "string" and readable(name) and name ~= "" then
            return name
        end
    end
    return key
end

local function matches(entry, query)
    if not query or query == "" then
        return true
    end
    local q = query:lower()
    return entry.label:lower():find(q, 1, true) ~= nil or entry.token:lower():find(q, 1, true) ~= nil
end

-- The chip kind of each section, which a drop on the invite list checks (only "player" goes there).
local SECTION_KIND = { players = "player", general = "general", groups = "group", classes = "class" }

-- roster: Groups:ReadRoster()'s { key, subgroup, class, role } (nil: none). Returns { { key, kind, entries } }:
-- players (by role: tanks, healers, damage, then unknown; each by name), general, groups and classes, each entry
-- { label, token, class, role }. query keeps the entries whose label or token holds it (any case).
function Model.Palette(roster, query)
    local players = {}
    for _, p in ipairs(roster or {}) do
        if type(p) == "table" and type(p.key) == "string" and readable(p.key) and p.key ~= "" then
            local name = shortName(p.key)
            if validToken(name) then
                local class = readable(p.class) and type(p.class) == "string" and p.class or nil
                local role = readable(p.role) and ROLE_ORDER[p.role] and p.role or nil
                players[#players + 1] = { label = name, token = name, class = class, role = role }
            end
        end
    end
    table.sort(players, function(a, b)
        local ra, rb = ROLE_ORDER[a.role] or 4, ROLE_ORDER[b.role] or 4
        if ra ~= rb then
            return ra < rb
        end
        return a.label:lower() < b.label:lower()
    end)
    local groups = {}
    for g = 1, Model.GROUPS do
        groups[g] = { label = string.format(TEXT.group, g), token = "Group" .. g }
    end
    local sections = {
        { key = "players", entries = players },
        { key = "general", entries = Model.GENERAL },
        { key = "groups", entries = groups },
        { key = "classes", entries = classes() },
    }
    for _, section in ipairs(sections) do
        section.kind = SECTION_KIND[section.key]
        local kept = {}
        for _, e in ipairs(section.entries) do
            if matches(e, query) then
                kept[#kept + 1] = e
            end
        end
        section.entries = kept
    end
    return sections
end

-- Players from -----------------------------------------------------------------------------------------------------

-- The source keys besides a layout's id (a Raid Groups layout is picked by its own id).
Model.SOURCE_GROUP = "group"
Model.SOURCE_INVITE = "invite"

-- The "Players from" choices: { key, label }: the current group, the note's invite list, then every saved layout
-- (layouts: Groups:Presets(), { id, name }) by name, the note's linked layout (linkedId) first. noInvite leaves the
-- invite list out (the personal note has none).
function Model.Sources(layouts, linkedId, noInvite)
    local out = { { key = Model.SOURCE_GROUP, label = TEXT.fromGroup } }
    if not noInvite then
        out[#out + 1] = { key = Model.SOURCE_INVITE, label = TEXT.fromInvite }
    end
    local linked, rest = nil, {}
    for _, p in ipairs(layouts or {}) do
        if type(p) == "table" and p.id ~= nil and type(p.name) == "string" then
            local entry = { key = p.id, label = p.name }
            if linkedId ~= nil and p.id == linkedId then
                linked = entry
            else
                rest[#rest + 1] = entry
            end
        end
    end
    if linked then
        out[#out + 1] = linked
    end
    for _, entry in ipairs(rest) do
        out[#out + 1] = entry
    end
    return out
end

-- The choice a note opens with: its linked layout when you're not in a group, else the current group.
function Model.DefaultSource(linkedId, inGroup)
    if linkedId ~= nil and not inGroup then
        return linkedId
    end
    return Model.SOURCE_GROUP
end

-- A roster for Palette from a list of names (a layout's slots, "" for an empty one, or the invite list): each
-- name once, its class from classOf(name) and its role from roleOf(name) when known (both may be nil).
function Model.Roster(names, classOf, roleOf)
    local out, seen = {}, {}
    for _, key in ipairs(names or {}) do
        if type(key) == "string" and readable(key) and key ~= "" and not seen[key:lower()] then
            seen[key:lower()] = true
            out[#out + 1] = { key = key, class = classOf and classOf(key) or nil, role = roleOf and roleOf(key) or nil }
        end
    end
    return out
end
