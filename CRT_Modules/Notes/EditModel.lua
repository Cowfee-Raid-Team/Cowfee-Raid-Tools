local ADDON, CRT = ...

-- The assignments of a note as rows of names, for the pop-out note editor (Notes/EditorWindow.lua). No frames.
-- The raw text stays the one source: an edit changes only names, and Text() gives the raw text back with every
-- other byte as written (times, phases, text, colours, unknown fields, spacing, line ends, line order, the
-- invite list). A line whose names are back to what they were is written exactly as it was.
--   Model.New(text, opts)       a session over the text. opts: markdown (the personal note), readOnly
--   s.rows                      the note's lines in their own order (see rowFor)
--   s:Add(i, token)             appends a name or tag word to row i
--   s:Remove(i, k)              removes row i's k-th name
--   s:Move(i, k, j)             moves row i's k-th name to the end of row j
--   s:Text(), s:Dirty()         the raw text now, and whether it differs from the text opened
--   s:SetQuickFill(on), s:Select(i), s:PaletteClick(token)   Quick fill: a click on a chip appends it to the row
--   s:BeginDrag(source), s:Drop(i), s:CancelDrag()            a drag: { token } from the palette, { row, index }
--                                                             from a row
--   Model.Palette(roster, query)  the palette's sections: Players, General, Groups and Classes
-- Where the names are:
--   a timed line   the words of its tag: field (the last one, as the parser reads it), separated by spaces. A line
--                  with no tag: gets "tag:<names>;" after its time: and ph: fields once it has a name.
--   a label line   "Label: names" (a line of free text with a colon), its words after the colon, kept with the
--                  commas and spaces between them as written; a new name takes the line's own separator.
-- Every other line (the header, headings, text, a timer the parser could not read, the invite list) is shown as
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
}

-- The tag words the alerts understand (Notes/Engine.lua: IsMine, groupTag and the class words), which the
-- Raid Notes integrations also read: "everyone", a role, "Group1".."Group8" in one word (Integrations/MRT.lua
-- reads only that spelling of a group), and a class by its file name ("DEATHKNIGHT").
Model.GENERAL = {
    { label = TEXT.everyone, token = "everyone" },
    { label = TEXT.tanks, token = "tank" },
    { label = TEXT.healers, token = "healer" },
    { label = TEXT.dps, token = "dps" },
    { label = TEXT.melee, token = "melee" },
    { label = TEXT.ranged, token = "ranged" },
}
Model.GROUPS = 8

local TAG_WORD = "%S+" -- the parser's tag words (Parse.lua: words)
local LABEL_WORD = "[%w\128-\255][%w\128-\255%-']*" -- a name in free text, as Render.lua reads it

local function trim(s)
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

-- The raw text as { text, eol } pieces, cut where Parse cuts its lines; joined they give the text back.
local function splitLines(raw)
    local pieces, pos = {}, 1
    while true do
        local nl = raw:find("\n", pos, true)
        if not nl then
            pieces[#pieces + 1] = { text = raw:sub(pos), eol = "" }
            return pieces
        end
        local text, eol = raw:sub(pos, nl - 1), "\n"
        if text:sub(-1) == "\r" then
            text, eol = text:sub(1, -2), "\r\n"
        end
        pieces[#pieces + 1] = { text = text, eol = eol }
        pos = nl + 1
    end
end

-- Names fields ------------------------------------------------------------------------------------------------

-- A run of names inside a line: before .. open .. lead .. names (each after its separator) .. trail .. close .. after.
-- open and close are empty, or (a timed line with no tag: yet) the "tag:" and ";" a first name brings.
local function field(before, value, after, pattern, defaultSep)
    local f = { before = before, after = after, open = "", close = "", items = {}, lead = "", trail = "" }
    local pos = 1
    for start, word, stop in value:gmatch("()(" .. pattern .. ")()") do
        local sep = value:sub(pos, start - 1)
        if #f.items == 0 then
            f.lead = sep
        end
        f.items[#f.items + 1] = { word = word, sep = #f.items == 0 and "" or sep }
        pos = stop
    end
    if #f.items == 0 then
        f.lead = value -- the spaces where the names go
    else
        f.trail = value:sub(pos)
    end
    f.sep = (f.items[2] and f.items[2].sep) or defaultSep
    return f
end

local function fieldText(f)
    local out = { f.lead }
    for k, item in ipairs(f.items) do
        out[#out + 1] = (k > 1 and item.sep or "") .. item.word
    end
    return f.before .. f.open .. table.concat(out) .. f.trail .. f.close .. f.after
end

-- The "key:value" parts of a line, split at ";" as the parser splits them: { key (lower case), from, to }, from
-- and to the value's first and last byte.
local function parts(line)
    local out, pos = {}, 1
    while pos <= #line + 1 do
        local semi = line:find(";", pos, true)
        local stop = (semi or (#line + 1)) - 1
        local part = line:sub(pos, stop)
        local key, colon = part:match("^%s*([^:]+)():")
        if key then
            out[#out + 1] = { key = trim(key):lower(), from = pos + colon, to = stop, semi = semi }
        end
        if not semi then
            break
        end
        pos = semi + 1
    end
    return out
end

-- The names of a timed line: its last tag: field, or, with none, where one goes (after time: and ph:).
local function tagField(line)
    local list = parts(line)
    local tag, anchor
    for _, p in ipairs(list) do
        if p.key == "tag" then
            tag = p
        elseif p.key == "time" or p.key == "ph" then
            anchor = anchor or p
            if p.from > anchor.from then
                anchor = p
            end
        end
    end
    if tag then
        return field(line:sub(1, tag.from - 1), line:sub(tag.from, tag.to), line:sub(tag.to + 1), TAG_WORD, " ")
    end
    local at = anchor and (anchor.semi or #line) or #line
    local f = field(line:sub(1, at), "", line:sub(at + 1), TAG_WORD, " ")
    -- after a field that ends the line with no ";": ";tag:names"
    local closed = anchor and anchor.semi or (line:sub(-1) == ";") or line == ""
    f.open, f.close = closed and "tag:" or ";tag:", closed and ";" or ""
    f.bare = true -- open and close only once it has a name
    return f
end

-- The names of a label line: the words after its first colon.
local function labelField(line)
    local colon = line:find(":", 1, true)
    return field(line:sub(1, colon), line:sub(colon + 1), "", LABEL_WORD, ", ")
end

-- Rows ----------------------------------------------------------------------------------------------------------

local function num(n)
    return (("%.10g"):format(n))
end

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
    if label then
        row.kind, row.label, row.editable = "label", label, true
        row.field = labelField(line)
    elseif t:find(":", 1, true) or t:find("**", 1, true) then
        row.kind, row.text = "text", t
    else
        row.kind, row.text = "heading", t
    end
end

-- One row per line of the text: { kind, line (its number), raw (as written), editable, names (current) } and, by
-- kind: timer { time, ph, timer (the parsed timer), display }, label { label }, heading / text / unread { text }.
-- Kinds: header, timer, unread (starts like a timer, no time the parser reads), invite, label, heading, text, blank.
local function rowFor(lineNo, raw, timer, markdown)
    local row = { line = lineNo, raw = raw }
    local lower = trim(raw):lower()
    if timer then
        row.kind, row.editable, row.timer = "timer", true, timer
        local t = math.max(0, timer.time)
        row.time = string.format("%d:%02d", math.floor(t / 60), math.floor(t % 60))
        row.ph = num(timer.ph or 1)
        local display = Parser.Field(raw, "displaytype")
        row.display = (display and display ~= "") and display or nil
        row.field = tagField(raw)
    elseif lower:find("^encounterid:") then
        row.kind, row.text = "header", trim(raw)
    elseif lower:find("^invitelist:") then
        local list = trim(raw):match("^[^:]+:(.*)$") or ""
        local n = 0
        for name in list:gsub(";%s*$", ""):gmatch("[^,]+") do
            if trim(name) ~= "" then
                n = n + 1
            end
        end
        row.kind, row.count = "invite", n
    elseif lower:find("^time:") or (lower:find("^ph:%s*[%d%.]+%s*;") and lower:find(";%s*time:")) then
        row.kind, row.text = "unread", trim(raw)
    else
        freeRow(row, raw, markdown)
    end
    if row.field then
        row.original = {}
        for k, item in ipairs(row.field.items) do
            row.original[k] = item.word
        end
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

-- Row i's names now (a copy).
function Session:Names(i)
    local row = self.rows[i]
    local out = {}
    for k, item in ipairs(row and row.field and row.field.items or {}) do
        out[k] = item.word
    end
    return out
end

-- Whether row i takes names.
function Session:Editable(i)
    local row = self.rows[i]
    return not self.readOnly and row ~= nil and row.editable == true
end

-- A token fit to be one name or tag word: no spaces, ";", ":", ",", "|" or line ends.
local function validToken(token)
    return type(token) == "string" and readable(token) and token:match("^[^%s;:,|]+$") ~= nil
end
Model.ValidToken = validToken

local function has(f, token)
    local lower = token:lower()
    for _, item in ipairs(f.items) do
        if item.word:lower() == lower then
            return true
        end
    end
    return false
end

-- Appends a name to row i. False when the row takes no names, the token isn't one word, or the row has it already.
function Session:Add(i, token)
    if not (self:Editable(i) and validToken(token)) then
        return false
    end
    local f = self.rows[i].field
    if has(f, token) then
        return false
    end
    if #f.items == 0 and f.lead == "" and self.rows[i].kind == "label" then
        f.lead = " " -- "Kicks:" becomes "Kicks: Name"
    end
    f.items[#f.items + 1] = { word = token, sep = f.sep }
    return true
end

-- Removes row i's k-th name, with the separator before it (the first name: the one after it goes).
function Session:Remove(i, k)
    if not self:Editable(i) then
        return false
    end
    local items = self.rows[i].field.items
    if not items[k] then
        return false
    end
    table.remove(items, k)
    if k == 1 and items[1] then
        items[1].sep = ""
    end
    return true
end

-- Moves row i's k-th name to the end of row j. Nothing changes when j can't take it.
function Session:Move(i, k, j)
    if i == j or not (self:Editable(i) and self:Editable(j)) then
        return false
    end
    local item = self.rows[i].field.items[k]
    if not item or has(self.rows[j].field, item.word) then
        return false
    end
    self:Remove(i, k)
    return self:Add(j, item.word)
end

local function changed(row)
    local items = row.field.items
    if #items ~= #row.original then
        return true
    end
    for k, item in ipairs(items) do
        if item.word ~= row.original[k] then
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
    local f = row.field
    if f.bare and #f.items == 0 then
        return row.raw
    end
    return fieldText(f)
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

-- A click on a palette chip: with Quick fill on and a row selected, the chip's token is appended to it.
function Session:PaletteClick(token)
    if self.quickFill and self.selected then
        return self:Add(self.selected, token)
    end
    return false
end

-- Drag and drop -------------------------------------------------------------------------------------------------

-- source: { token = "Name" } (a palette chip) or { row = i, index = k } (a row's chip). Nothing in read-only.
function Session:BeginDrag(source)
    if self.readOnly or type(source) ~= "table" then
        self.drag = nil
        return false
    end
    if source.row and not (self:Editable(source.row) and self.rows[source.row].field.items[source.index]) then
        self.drag = nil
        return false
    end
    if not source.row and not validToken(source.token) then
        self.drag = nil
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
    return self:Add(i, d.token)
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

-- The game's classes: { label (its name), token (its file name), class }.
local function classes()
    local out = {}
    local n = GetNumClasses and GetNumClasses() or 0
    for i = 1, n do
        local ok, name, file = pcall(GetClassInfo, i)
        if ok and readable(name) and readable(file) and type(name) == "string" and type(file) == "string"
            and name ~= "" and file ~= "" then
            out[#out + 1] = { label = name, token = file, class = file }
        end
    end
    return out
end

-- roster: Groups:ReadRoster()'s { key, subgroup, class, role } (nil: none). Returns { { key, title, entries } }:
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
