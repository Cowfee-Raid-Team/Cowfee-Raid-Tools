local ADDON, CRT = ...

-- A raid note shown as it reads in the game, for the Note text and Personal note boxes of Raid Notes
-- (Page.lua). The raw text stays the saved source: sharing, alerts and imports never see this file.
--   Render.Rows(text, ctx)      the rows to draw, read with the note parser (Parse.lua); no frames
--   Render.Markup(row)          a row's text as one string with colour codes
--   Render.ClassLookup(sources) name -> class file: the group, then the guild, then names seen before
--   Render.View(parent, opts)   a scrolling view of the rows, made of pooled row frames
--   Render.Bind(view, ...)      one box: rendered until clicked, then its raw edit box until saved
-- Rows are worked out once per change (the text, the invite list opened, a spell loaded, a theme switch),
-- never per frame or scroll.

local Render = { views = {} }
CRT.NoteRender = Render
local UI = CRT.UI

local TEXT = {
    encounter = "Encounter %s",
    roster = "roster linked in Raid Groups",
    you = "(you)",
    invite = "Invite list (%d)",
    spell = "Spell %s",
    empty = "Empty. Click to write.",
}

local QUESTION_ICON = "Interface\\Icons\\INV_Misc_QuestionMark"
local SWATCH = "Interface\\Buttons\\WHITE8X8"
local BULLET = "\226\128\162 "

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return not (issecretvalue and issecretvalue(v))
end

local function usable(v)
    return readable(v) and type(v) == "string" and v ~= ""
end

local function fmtTime(seconds)
    seconds = math.max(0, seconds or 0)
    return format("%d:%02d", math.floor(seconds / 60), math.floor(seconds % 60))
end

local function num(n)
    return (("%.10g"):format(n))
end

-- Class colours -----------------------------------------------------------------------------------

-- One source of names: by full key ("name-realm", lower case, no spaces) and by name alone, the second
-- only when every player of that name has the same class.
local function index(list)
    local byKey, byBase = {}, {}
    for _, e in ipairs(list or {}) do
        if type(e) == "table" and usable(e.key) and usable(e.class) then
            local lower = e.key:lower():gsub("%s+", "")
            byKey[lower] = e.class
            local base = lower:match("^[^-]+") or lower
            if byBase[base] == nil then
                byBase[base] = e.class
            elseif byBase[base] ~= e.class then
                byBase[base] = false
            end
        end
    end
    return { byKey = byKey, byBase = byBase }
end

-- The names the game and the addon know, best first: the live group, the guild roster, then names seen
-- before (the shared class cache, which Raid Groups fills, and the Loot Master session's raiders). In
-- combat, where the group's names may be secret, only the names seen before.
function Render.ClassSources()
    local Groups = CRT.Groups
    local live = not (InCombatLockdown and InCombatLockdown())
    local function read(fn)
        if live and Groups and type(Groups[fn]) == "function" then
            local ok, list = pcall(Groups[fn], Groups)
            if ok and type(list) == "table" then
                return list
            end
        end
        return {}
    end
    local seen = {}
    for key, class in pairs(CRT.db and CRT.db.classCache or {}) do
        seen[#seen + 1] = { key = key, class = class }
    end
    local LM = CRT.LootMaster
    for _, session in ipairs({ LM and LM.current or false, LM and LM.incoming or false }) do
        if type(session) == "table" and type(session.players) == "table" then
            for name, p in pairs(session.players) do
                if type(p) == "table" then
                    seen[#seen + 1] = { key = name, class = p.class }
                end
            end
        end
    end
    return { read("ReadRoster"), read("ReadGuild"), seen }
end

-- A function name -> class file or nil. A name with a realm matches only that player; a name without one
-- matches the one player of that name. Sources are asked in order.
function Render.ClassLookup(sources)
    local indexed = {}
    for i, list in ipairs(sources or Render.ClassSources()) do
        indexed[i] = index(list)
    end
    local memo = {}
    return function(name)
        if not usable(name) then
            return nil
        end
        local lower = name:lower():gsub("%s+", "")
        if memo[lower] ~= nil then
            return memo[lower] or nil
        end
        local hasRealm = lower:find("-", 1, true) ~= nil
        local base = lower:match("^[^-]+") or lower
        local found
        for _, src in ipairs(indexed) do
            found = src.byKey[lower] or (not hasRealm and src.byBase[base]) or nil
            if found then
                break
            end
        end
        memo[lower] = found or false
        return found
    end
end

-- The class colour's code, "ffrrggbb", or nil. Not a theme colour: the game's class colours.
local function classColor(class)
    local c = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    return c and c.colorStr or nil
end

-- Rows ---------------------------------------------------------------------------------------------

local function nameOf(word, ctx)
    local base = (word:lower():gsub("%-.*$", ""))
    return { text = word, class = ctx.classOf and ctx.classOf(word) or nil, me = ctx.me ~= nil and base == ctx.me }
end

-- A timer's tag that is a class name as one part in its class colour, a name of several words as one ("Demon
-- Hunter", Parse.lua's class words). Every tag is a name, so any spelling is the class; a player of that name
-- keeps the player's colour. Returns the part and how many tags it takes, or nil.
local function classPart(words, i, ctx)
    local file, n = CRT.NoteParser.ClassAt(words, i)
    if not file or (n == 1 and ctx.classOf and ctx.classOf(words[i])) then
        return nil
    end
    return { text = table.concat(words, " ", i, i + n - 1), class = file, me = false }, n
end

local WORD = "[%w\128-\255][%w\128-\255%-']*"

-- A line of text as parts: each word a name (class and you), the spaces and commas between them as written.
-- classes: class names count too (an assignment's names), cut as Parse.lua's ClassRuns cuts them, and only a
-- sure one ("Hunter", "DEMONHUNTER", "demon hunter"), so "kill the hunter pet" stays as written.
local function parts(s, ctx, out, classes)
    out = out or {}
    local items = {}
    if classes then
        items = CRT.NoteParser.ClassRuns(s, WORD)
    else
        for start, word, stop in s:gmatch("()(" .. WORD .. ")()") do
            items[#items + 1] = { start = start, stop = stop, text = word }
        end
    end
    local pos = 1
    for _, item in ipairs(items) do
        if item.start > pos then
            out[#out + 1] = { text = s:sub(pos, item.start - 1) }
        end
        local player = not item.text:find(" ", 1, true) and ctx.classOf and ctx.classOf(item.text)
        if item.class and item.sure and not player then
            out[#out + 1] = { text = item.text, class = item.class, me = false } -- the spaces as written
        else
            out[#out + 1] = nameOf(item.text, ctx)
        end
        pos = item.stop
    end
    if pos <= #s then
        out[#out + 1] = { text = s:sub(pos) }
    end
    return out
end

-- Markdown in the personal note: **bold** spans become parts in the heading colour.
local function boldParts(s, ctx, classes)
    local out, pos = {}, 1
    while true do
        local a, b, inner = s:find("%*%*(.-)%*%*", pos)
        if not a then
            break
        end
        parts(s:sub(pos, a - 1), ctx, out, classes)
        out[#out + 1] = { text = inner, bold = true }
        pos = b + 1
    end
    return parts(s:sub(pos), ctx, out, classes)
end

local function timerRow(t, rawLine, ctx)
    local Parser = CRT.NoteParser
    local row = { kind = "timer", time = fmtTime(t.time), phase = "P" .. num(t.ph or 1), color = t.color, names = {} }
    local tags = t.tags or {}
    local i = 1
    while i <= #tags do
        local part, n = classPart(tags, i, ctx)
        row.names[#row.names + 1] = part or nameOf(tags[i], ctx)
        i = i + (n or 1)
    end
    if t.kind == "spell" then
        local info = ctx.spell and ctx.spell(t.spellId)
        row.spellId = t.spellId
        if info and info.name then
            row.icon, row.text = info.icon or QUESTION_ICON, info.name
        else
            row.icon, row.text, row.pending = QUESTION_ICON, format(TEXT.spell, tostring(t.spellId)), true
        end
        if type(t.text) == "string" and t.text ~= "" then
            row.text = row.text .. " - " .. t.text
        end
    else
        row.text = t.text or ""
        row.icon = t.iconID
    end
    local display = Parser.Field(rawLine, "displaytype")
    row.display = (display and display ~= "") and display or nil
    return row
end

-- A line that is not a timer: blank, a label ("Melee: names"), a heading (no colon) or text. With
-- markdown (the personal note): # heading, --- divider, - bullet, **bold**.
local function freeRow(line, ctx)
    if line == "" then
        return { kind = "blank" }
    end
    local bullet = false
    if ctx.markdown then
        local heading = line:match("^%s*#+%s+(.-)%s*$")
        if heading then
            return { kind = "heading", text = heading }
        end
        if line:match("^%s*%-%-%-+%s*$") or line:match("^%s*%*%*%*+%s*$") then
            return { kind = "divider" }
        end
        local item = line:match("^%s*[%-%*]%s+(.+)$")
        if item then
            line, bullet = BULLET .. item, true
        end
    end
    local label, rest = line:match("^([^:]+):%s*(.*)$")
    if label and not bullet then
        -- class names coloured only in an assignment's names, never in a sentence
        local classes = CRT.NoteParser.LooksLikeLabel(label)
        return { kind = "label", label = label,
            parts = ctx.markdown and boldParts(rest, ctx, classes) or parts(rest, ctx, nil, classes) }
    end
    if bullet or line:find(":", 1, true) or line:find("**", 1, true) then
        return { kind = "text", parts = ctx.markdown and boldParts(line, ctx) or parts(line, ctx) }
    end
    return { kind = "heading", text = line }
end

-- ctx: classOf (name -> class), me (your name, lower case), spell (id -> { name, icon } or nil),
-- inviteOpen, rosterLinked, markdown. Returns the rows in order: the header, the timers by phase and time,
-- lines it could not read, the other lines, the invite list (its names under it when open).
function Render.Rows(text, ctx)
    ctx = ctx or {}
    local Parser = CRT.NoteParser
    local note = Parser.Parse(text or "")
    local raw = Parser.SplitLines(text or "")
    local rows = {}
    if note.encounterID or note.name or note.difficulty then
        local title = note.name or ""
        if note.difficulty and note.difficulty ~= "" then
            title = title .. (title ~= "" and " " or "") .. "(" .. note.difficulty .. ")"
        end
        local sub = {}
        if note.encounterID then
            sub[#sub + 1] = format(TEXT.encounter, tostring(note.encounterID))
        end
        if note.invite and ctx.rosterLinked then
            sub[#sub + 1] = TEXT.roster
        end
        rows[#rows + 1] = { kind = "header", text = title, sub = table.concat(sub, " - ") }
    end
    for _, t in ipairs(note.timers) do
        rows[#rows + 1] = timerRow(t, raw[t.line], ctx)
    end
    for _, line in ipairs(note.unread or {}) do
        rows[#rows + 1] = { kind = "text", parts = { { text = line } } }
    end
    if #note.lines > 0 and #rows > 0 and note.lines[1] ~= "" then
        rows[#rows + 1] = { kind = "blank" }
    end
    for _, line in ipairs(note.lines) do
        rows[#rows + 1] = freeRow(line, ctx)
    end
    if note.invite then
        local names = {}
        for _, n in ipairs(note.invite) do
            if n ~= "" then
                names[#names + 1] = nameOf(n, ctx)
            end
        end
        rows[#rows + 1] = { kind = "invite", count = #names, open = ctx.inviteOpen and true or false }
        if ctx.inviteOpen and #names > 0 then
            local list = {}
            for i, n in ipairs(names) do
                if i > 1 then
                    list[#list + 1] = { text = ", " }
                end
                list[#list + 1] = n
            end
            rows[#rows + 1] = { kind = "text", parts = list }
        end
    end
    if #rows == 0 then
        rows[1] = { kind = "hint", text = TEXT.empty }
    end
    return rows
end

-- Markup --------------------------------------------------------------------------------------------

-- A name in its class colour, "(you)" after your own; any other word as written.
local function partMarkup(p)
    if p.bold then
        return UI.HeadingText(p.text)
    end
    local color = classColor(p.class)
    local text = color and ("|c" .. color .. p.text .. "|r") or p.text
    if p.me then
        text = text .. " " .. UI.HeadingText(TEXT.you)
    end
    return text
end

local function partsMarkup(list)
    local out = {}
    for i, p in ipairs(list or {}) do
        out[i] = partMarkup(p)
    end
    return table.concat(out)
end

-- The line's own colour as a small square, drawn inline. Not a theme colour: the raid leader's colors:.
local function swatch(c)
    local function byte(v)
        return math.max(0, math.min(255, math.floor((tonumber(v) or 1) * 255 + 0.5)))
    end
    return format("|T%s:10:10:0:0:8:8:0:8:0:8:%d:%d:%d|t ", SWATCH, byte(c[1]), byte(c[2]), byte(c[3]))
end

-- A row's main text: for a timer the names (comma separated), the swatch, the icon and the text; for a
-- label its names; for text its words; for the invite list its count.
function Render.Markup(row)
    local kind = row.kind
    if kind == "timer" then
        local names = {}
        for i, n in ipairs(row.names) do
            names[i] = partMarkup(n)
        end
        local out = table.concat(names, ", ")
        if out ~= "" then
            out = out .. "  "
        end
        if row.color then
            out = out .. swatch(row.color)
        end
        if row.icon then
            out = out .. "|T" .. tostring(row.icon) .. ":0|t "
        end
        return out .. (row.text or "")
    elseif kind == "label" or kind == "text" then
        return partsMarkup(row.parts)
    elseif kind == "invite" then
        return (row.open and "v " or "> ") .. format(TEXT.invite, row.count)
    elseif kind == "heading" or kind == "header" then
        return UI.HeadingText(row.text or "")
    end
    return row.text or ""
end

-- The view ------------------------------------------------------------------------------------------

local ROW_H = 18
local HEADER_H = 32
local TIME_W = 34
local CHIP_W = 32
local LABEL_MAX = 0.4 -- a label takes at most this share of the row

-- A spell the views show by its ID until the game loads it: spellState[id] is "asked" once its data is
-- asked for, "loaded" when the game says it loaded (one more draw), and "failed" when the load failed or
-- the spell still has no name after it. A spell is asked for once: a failed one keeps showing "Spell <ID>".
local spellState = {}

-- What a draw does for a spell row still showing its ID.
local function askSpell(spellId)
    local state = spellState[spellId]
    if state == nil then
        spellState[spellId] = "asked"
        if C_Spell and C_Spell.RequestLoadSpellData then
            pcall(C_Spell.RequestLoadSpellData, spellId)
        end
    elseif state == "loaded" then
        spellState[spellId] = "failed" -- loaded, but still no name: never asked again
    end
end

local function makeRow(view, i)
    local row = CreateFrame("Button", nil, view.child)
    row:SetHeight(ROW_H)
    row.time = row:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    row.time:SetPoint("TOPLEFT", 0, -2)
    row.time:SetWidth(TIME_W)
    row.time:SetJustifyH("LEFT")
    row.chip = row:CreateTexture(nil, "ARTWORK")
    row.chip:SetPoint("TOPLEFT", TIME_W, 0)
    row.chip:SetSize(CHIP_W - 4, ROW_H - 4)
    row.chipText = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.chipText:SetPoint("CENTER", row.chip, "CENTER", 0, 0)
    row.label = row:CreateFontString(nil, "OVERLAY", "CRTFontButtonSmall")
    row.label:SetPoint("TOPLEFT", 0, -2)
    row.label:SetJustifyH("LEFT")
    row.label:SetWordWrap(false)
    row.small = row:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    row.small:SetJustifyH("RIGHT")
    UI.Tint(row.small, "SetTextColor", "muted")
    row.text = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    row.text:SetJustifyH("LEFT")
    row.text:SetJustifyV("TOP")
    row.text:SetWordWrap(true)
    row.heading = row:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    row.heading:SetPoint("TOPLEFT", 0, -2)
    row.heading:SetWidth(view.width)
    row.heading:SetJustifyH("LEFT")
    row.heading:SetWordWrap(false)
    row.muted = row:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    row.muted:SetWidth(view.width)
    row.muted:SetJustifyH("LEFT")
    row.muted:SetWordWrap(false)
    UI.Tint(row.muted, "SetTextColor", "muted")
    row.divider = row:CreateTexture(nil, "ARTWORK")
    row.divider:SetHeight(1)
    row.divider:SetPoint("LEFT", 0, 0)
    row.divider:SetPoint("RIGHT", 0, 0)
    -- only the invite list's row takes clicks; a click anywhere else reaches the view and opens the raw text
    row:SetScript("OnClick", function(self)
        if self.rowKind == "invite" then
            view.inviteOpen = not view.inviteOpen
            view:Redraw()
        end
    end)
    view.pool[i] = row
    return row
end

-- Lays one row out for its kind and returns its height. width is the rows' width: each text gets its
-- width set, so a wrapped line's height is known at once.
local function drawRow(row, data, width)
    local kind = data.kind
    row.rowKind = kind
    row:EnableMouse(kind == "invite")
    for _, part in ipairs({ row.time, row.chip, row.chipText, row.label, row.small, row.text, row.heading, row.muted, row.divider }) do
        part:Hide()
    end
    local height = ROW_H
    if kind == "header" then
        row.heading:SetText(Render.Markup(data))
        row.heading:Show()
        if data.sub ~= "" then
            row.muted:ClearAllPoints()
            row.muted:SetPoint("TOPLEFT", row.heading, "BOTTOMLEFT", 0, -2)
            row.muted:SetText(data.sub)
            row.muted:Show()
            height = HEADER_H
        end
        return height
    elseif kind == "heading" then
        row.heading:SetText(Render.Markup(data))
        row.heading:Show()
        return height
    elseif kind == "divider" then
        row.divider:SetColorTexture(UI.Color("heading", 0.35))
        row.divider:Show()
        return height / 2
    elseif kind == "blank" then
        return height / 2
    elseif kind == "hint" then
        row.muted:ClearAllPoints()
        row.muted:SetPoint("TOPLEFT", 0, -2)
        row.muted:SetText(data.text)
        row.muted:Show()
        return height
    elseif kind == "invite" then
        row.label:SetText(Render.Markup(data))
        row.label:Show()
        return height
    end
    -- timer, label and text: the main text wraps from its left edge to the row's right (or the display type)
    local left, right = 0, 0
    row.small:ClearAllPoints()
    row.text:ClearAllPoints()
    if kind == "timer" then
        row.time:SetText(data.time)
        row.time:Show()
        row.chip:SetColorTexture(UI.Color("heading", 0.18))
        row.chip:Show()
        row.chipText:SetText(data.phase)
        row.chipText:Show()
        left = TIME_W + CHIP_W
        if data.display then
            row.small:SetPoint("TOPRIGHT", 0, -2)
            row.small:SetText(data.display)
            row.small:Show()
            right = (row.small:GetStringWidth() or 0) + 6
        end
    elseif kind == "label" then
        row.label:SetWidth(0)
        row.label:SetText(data.label .. ":")
        local max = math.floor(width * LABEL_MAX)
        local w = row.label:GetStringWidth() or 0
        if w > max then
            w = max
            row.label:SetWidth(max)
        end
        row.label:Show()
        left = w + 6
    end
    row.text:SetPoint("TOPLEFT", left, -2)
    row.text:SetWidth(math.max(20, width - left - right))
    row.text:SetText(Render.Markup(data))
    row.text:Show()
    return math.max(height, (row.text:GetStringHeight() or 0) + 6)
end

-- opts: key (a name for the scroll frame and Render.views), width (the rows' width), onClick (a click
-- anywhere but the invite list), context (a function returning the ctx extras: rosterLinked, markdown).
function Render.View(parent, opts)
    local view = { pool = {}, rows = {}, draws = 0, inviteOpen = false, width = opts.width }
    local frame = CreateFrame("Frame", nil, parent)
    frame:SetAllPoints()
    view.frame = frame
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsNoteView" .. opts.key .. "Scroll", frame, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 6, -6)
    scroll:SetPoint("BOTTOMRIGHT", -(4 + UI.ScrollGutter()), 6)
    view.child = CreateFrame("Frame", nil, scroll)
    view.child:SetSize(opts.width, 1)
    scroll:SetScrollChild(view.child)
    for _, f in ipairs({ frame, scroll, view.child }) do
        f:EnableMouse(true)
        f:SetScript("OnMouseDown", function()
            opts.onClick()
        end)
    end

    -- Draws the rows of the text last given, again only when something changed.
    function view:Redraw()
        local extra = opts.context and opts.context() or {}
        local ctx = { classOf = Render.SharedLookup(), inviteOpen = self.inviteOpen, rosterLinked = extra.rosterLinked,
            markdown = extra.markdown, spell = function(id)
                return CRT.Notes:SpellInfo(id)
            end }
        local me = UnitName and UnitName("player")
        ctx.me = usable(me) and me:lower() or nil
        self.rows = Render.Rows(self.text, ctx)
        self.draws = self.draws + 1
        self.drawn = self.version
        local y = 0
        for i, data in ipairs(self.rows) do
            local row = self.pool[i] or makeRow(self, i)
            row:ClearAllPoints()
            row:SetPoint("TOPLEFT", 0, -y)
            row:SetPoint("TOPRIGHT", 0, -y)
            local h = drawRow(row, data, self.width)
            row:SetHeight(h)
            row:Show()
            y = y + h
            if data.pending and data.spellId then
                askSpell(data.spellId)
            end
        end
        for i = #self.rows + 1, #self.pool do
            self.pool[i]:Hide()
        end
        self.child:SetHeight(math.max(1, y))
    end

    -- The text to show; drawn now when it differs from what is drawn, or the view is out of date.
    function view:SetText(text, contextKey)
        text = text or ""
        if text ~= self.text then
            self.inviteOpen = false
        elseif contextKey == self.contextKey and self.drawn == Render.version then
            return
        end
        self.text, self.contextKey, self.version = text, contextKey, Render.version
        self:Redraw()
    end

    Render.views[opts.key] = view
    return view
end

-- One box of the page: the view over its raw edit box. The box shows rendered unless its edit box has the
-- focus or holds typing not yet saved; a click on the view shows the raw text with the focus. When
-- canEdit() says no (a raider who can't change the raid note) the raw text is read-only: it can be
-- selected and copied, and any typing is undone at once. Escape or losing the focus with nothing typed
-- shows it rendered again.
--   pair:Update(saved, owner, contextKey)  the saved text of the note owner (a new owner drops the typing)
--   pair:Saved()                           call before saving: the typed text becomes the loaded text
function Render.Bind(view, scroll, edit, canEdit)
    local pair = {}
    local function rendered()
        scroll:Hide()
        view.frame:Show()
        view:SetText(edit.loaded, pair.contextKey)
    end
    function pair:Dirty()
        return edit:GetText() ~= (edit.loaded or "")
    end
    function pair:Raw()
        view.frame:Hide()
        scroll:Show()
        edit:SetFocus()
        edit:SetCursorPosition(#(edit:GetText() or ""))
    end
    function pair:Update(saved, owner, contextKey)
        saved = saved or ""
        local switched = owner ~= self.owner
        self.owner, self.contextKey = owner, contextKey
        if switched or not self:Dirty() then
            if edit:GetText() ~= saved then
                local cursor = edit:GetCursorPosition() or 0
                edit:SetText(saved)
                if edit:HasFocus() then
                    edit:SetCursorPosition(math.min(cursor, #saved))
                end
            end
            edit.loaded = saved
        end
        if edit:HasFocus() or self:Dirty() then
            view.frame:Hide()
            scroll:Show()
        else
            rendered()
        end
    end
    function pair:Saved()
        edit.loaded = edit:GetText()
    end
    -- read-only: typing (userInput) puts the loaded text back; the page's own SetText calls pass through
    edit:SetScript("OnTextChanged", function(self, userInput)
        if userInput and canEdit and not canEdit() and self:GetText() ~= (self.loaded or "") then
            self:SetText(self.loaded or "")
        end
    end)
    edit:SetScript("OnEditFocusLost", function()
        if not pair:Dirty() then
            rendered()
        end
    end)
    return pair
end

-- Redraws -------------------------------------------------------------------------------------------

Render.version = 1

-- One name -> class lookup for every view, built again only when the version changes (a roster change,
-- a theme switch, a spell loaded), so the two boxes of the page read the group and guild once.
local sharedLookup, lookupVersion
function Render.SharedLookup()
    if not sharedLookup or lookupVersion ~= Render.version then
        sharedLookup, lookupVersion = Render.ClassLookup(), Render.version
    end
    return sharedLookup
end

-- Every view draws again: on a theme switch (the heading colour, the chips) and when a spell it waits on
-- has loaded. A view not on screen (its page or tab closed) draws when it is next shown.
local function redrawAll()
    Render.version = Render.version + 1
    for _, view in pairs(Render.views) do
        if view.text and view.frame:IsVisible() then
            view:SetText(view.text, view.contextKey)
        end
    end
end
Render.RedrawAll = redrawAll

UI:OnTheme(redrawAll)

local pendingRedraw = false
local events = CreateFrame("Frame")
events:RegisterEvent("SPELL_DATA_LOAD_RESULT")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:SetScript("OnEvent", function(_, event, spellID, success)
    if event == "GROUP_ROSTER_UPDATE" then
        -- the class colours may change: each view draws again the next time the page shows or refreshes it
        Render.version = Render.version + 1
        return
    end
    if not (readable(spellID) and readable(success) and spellState[spellID] == "asked") then
        return
    end
    if not success then
        spellState[spellID] = "failed" -- its row already shows "Spell <ID>": nothing to draw
        return
    end
    spellState[spellID] = "loaded"
    -- several spells load together: one redraw for them
    if not pendingRedraw then
        pendingRedraw = true
        C_Timer.After(0.2, function()
            pendingRedraw = false
            redrawAll()
        end)
    end
end)
