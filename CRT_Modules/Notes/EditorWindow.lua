local ADDON, CRT = ...

-- The pop-out note editor: a note's assignments as rows of names, changed by drag and drop, opened from Raid Notes
-- (the Pop out editor buttons by the Note text and the Personal note). Left, the note's lines in their own order
-- (Notes/EditModel.lua); right, a palette: Search, Players from (the current group, the note's invite list or a
-- saved Raid Groups layout, Alex 2026-10-21), the players, General, Groups and Classes. Only the
-- assignment lines ("Label: names") and the invite list (players only) take names; the timed lines are shown
-- dimmed under a Timers heading and never change (Alex, 2026-10-21). Drag a chip onto a row to add it, a row's
-- chip onto another row to move it, x removes it; with Quick fill on, click a row, then click chips to add them. Raw text shows the note as it will be saved. Only names change: Save writes the
-- raw text through Notes:UpdateRaw (Notes:SetPersonal for the personal note), so sharing works as before.
--   Editor.Open({ id = noteId }) or Editor.Open({ personal = true })
-- A raid note opens read-only for anyone who can't change it (Notes:CanEditRaid); a personal note never is. A drag
-- is the mouse's own: OnMouseDown on a chip, a driver frame's OnUpdate that starts it past a few pixels and moves
-- the ghost, OnMouseUp to drop it on the row under the mouse; Escape cancels it. Closing with unsaved changes asks
-- first. History in the title bar opens the note's earlier versions (Notes/HistoryWindow.lua).
-- Timer lines that list the same players as an assignment line follow it (Notes/EditorLinks.lua, Notes/Links.lua):
-- a change to the line's names is written on them too, and a banner over the rows offers to link them.

local Notes = CRT.Notes
local Model = CRT.NoteEditModel
local UI = CRT.UI

local Editor = {}
CRT.NoteEditor = Editor

-- The timer links (Notes/EditorLinks.lua, loaded after this file), or nil without them.
local function links()
    return CRT.NoteEditorLinks
end

local TEXT = {
    title = "Note editor: %s",
    personalTitle = "Personal note editor",
    untitled = "Note",
    search = "Search",
    playersFrom = "Players from",
    sections = { players = "Players", general = "General", groups = "Groups", classes = "Classes" },
    quickFill = "Quick fill",
    rawText = "Raw text",
    hideRaw = "Hide raw text",
    save = "Save",
    close = CLOSE or "Close",
    unsaved = "Unsaved changes.",
    saved = "Saved.",
    personalSaved = "Personal note saved.",
    gone = "This note was deleted, so there is nothing to save it to.",
    changed = "This note changed since you opened it. Close the editor and open it again.",
    otherOpen = "Save or close the note editor first.",
    history = "History (%d)",
    historyTitle = "History",
    historyTip = "The note's last 5 earlier versions: when, how and who changed them. Compare one with the note now, or restore it.",
    spell = "Spell %s",
    invite = "Invite list (%d):",
    timers = "Timers (from the note, not editable here)",
    discard = "Close the note editor without saving your changes?",
    discardButton = "Discard",
    helpTitle = "Note editor",
    help = "Drag a player, role, group or class from the right onto an assignment line (\"Label: names\") to add "
        .. "it. Drag a name from one line to another to move it. Click x to remove it. Escape cancels a drag.\n\n"
        .. "The invite list takes players only. Removing a player leaves their slot empty, so the others keep "
        .. "their groups.\n\n"
        .. "Quick fill: click a line, then click names on the right to add them to it.\n\n"
        .. "Players from picks the players listed on the right: your current group, this note's invite list, or a "
        .. "saved Raid Groups layout. A note linked to a layout shows that layout first, and picks it when you're "
        .. "not in a group.\n\n"
        .. "Timers are shown as the note has them and can't be changed here, except that a timer line listing the "
        .. "same players as an assignment line follows it: change the line's names and the timer line gets them "
        .. "too. Only names change. Raw text shows the note as it will be saved.",
}

local L = {
    width = 900, height = 580, minWidth = 680, minHeight = 420,
    paletteW = 270, gap = 10, footerH = 28, rawH = 150, searchH = 22, fromH = 32, fromLabelW = 78,
    fromGap = 5, -- UI.Dropdown's gap between its label and the dropdown (UI/Controls.lua)
    rowGap = 4, chipH = 18, chipGap = 4, chipPad = 6, iconW = 16, removeW = 14,
    timeW = 36, phaseW = 32, infoH = 18, timerAlpha = 0.5, labelMax = 0.35, headingH = 20, blankH = 8, sectionGap = 8,
    dragStart = 4, -- pixels the mouse moves with the button down before a press becomes a drag
}

local POPUP = "COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED"
local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }

-- The editor's state: the window and its parts, the session (Model.New) and where it came from. playersFrom: where
-- the palette's Players come from (Model.SOURCE_GROUP, Model.SOURCE_INVITE or a layout's id); picked: the choice
-- made in the dropdown for each note ("personal" for the personal note), kept until the game is reloaded.
local W = { rowFrames = {}, paletteChips = {}, headings = {}, picked = {} }
Editor.state = W

local function readable(v)
    return not (issecretvalue and issecretvalue(v))
end

-- The class colour of a chip, or nil. Not a theme colour: the game's class colours.
local function classRGB(class)
    local c = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    if c then
        return c.r, c.g, c.b
    end
    return nil
end

-- What the editor holds: the note's record (nil for the personal note, or once deleted), its saved text, and
-- whether it may be changed.
local function sourceText()
    if W.source.personal then
        return Notes:Personal(), true
    end
    local record = Notes:Get(W.source.id)
    if not record then
        return nil, false
    end
    if record.personal then
        return record.raw or "", true
    end
    return record.raw or "", (Notes:CanEditRaid()) and true or false
end

local function readOnly()
    return W.session == nil or W.session.readOnly
end

-- Chips ------------------------------------------------------------------------------------------------------------

local function paintChip(b, selected)
    b:SetBackdropColor(UI.Color("surface", 0.95))
    b:SetBackdropBorderColor(UI.Color(selected and "heading" or "border"))
    local r, g, bl = classRGB(b.class)
    if r then
        b.text:SetTextColor(r, g, bl) -- not a theme colour: the class colour
    else
        b.text:SetTextColor(UI.Color("text"))
    end
    b.remove.text:SetTextColor(UI.Color("muted"))
end

local chipDown, chipUp, removeClick -- the chips' mouse handlers (Drag and drop, below)

local function makeChip(parent)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    b:SetBackdrop(BACKDROP)
    b:SetHeight(L.chipH)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetSize(L.chipH - 4, L.chipH - 4)
    b.icon:SetPoint("LEFT", 2, 0)
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.text:SetWordWrap(false)
    b.remove = CreateFrame("Button", nil, b)
    b.remove:SetSize(L.removeW, L.chipH)
    b.remove:SetPoint("RIGHT", 0, 0)
    b.remove.text = b.remove:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.remove.text:SetPoint("CENTER", 0, 1)
    b.remove.text:SetText("x")
    b.remove:SetScript("OnClick", function()
        removeClick(b)
    end)
    b:EnableMouse(true)
    b:SetScript("OnMouseDown", function(self, button)
        chipDown(self, button)
    end)
    b:SetScript("OnMouseUp", function(self, button)
        chipUp(self, button)
    end)
    return b
end

-- Fills a chip: entry { label, class }, source (what a drag carries), removable (a row's chip that can be removed),
-- icon (a player's or class's class icon). Returns its width.
local function fillChip(b, entry, source, removable, icon)
    b.source, b.class, b.token = source, entry.class, entry.token
    b.text:SetText(entry.label)
    local left = L.chipPad
    b.icon:Hide()
    if icon and entry.class and GetClassAtlas then
        local ok, atlas = pcall(GetClassAtlas, entry.class)
        if ok and type(atlas) == "string" and pcall(b.icon.SetAtlas, b.icon, atlas) then
            b.icon:Show()
            left = L.iconW + 2
        end
    end
    b.text:ClearAllPoints()
    b.text:SetPoint("LEFT", left, 0)
    b.remove:SetShown(removable)
    local w = left + math.ceil(b.text:GetStringWidth() or 0) + (removable and L.removeW or L.chipPad)
    b:SetWidth(w)
    paintChip(b)
    b:Show()
    return w
end

-- Lays chips out left to right from x0, wrapping at width, from y0 down. Returns the height used.
local function flow(chips, widths, x0, width, y0)
    local x, y = x0, y0
    for k, chip in ipairs(chips) do
        local w = widths[k]
        if x > x0 and x + w > width then
            x, y = x0, y + L.chipH + L.chipGap
        end
        chip:ClearAllPoints()
        chip:SetPoint("TOPLEFT", x, -y)
        x = x + w + L.chipGap
    end
    return (#chips > 0) and (y - y0 + L.chipH) or 0
end

-- Rows -------------------------------------------------------------------------------------------------------------

local function rowFrame(i)
    local f = W.rowFrames[i]
    if f then
        return f
    end
    f = CreateFrame("Button", nil, W.rowsChild, "BackdropTemplate")
    f:SetBackdrop(BACKDROP)
    f.chips = {}
    f.time = f:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    f.time:SetPoint("TOPLEFT", 4, -3)
    f.phase = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.phase:SetPoint("TOPLEFT", 4 + L.timeW, -3)
    f.swatch = f:CreateTexture(nil, "ARTWORK")
    f.swatch:SetSize(10, 10)
    f.info = f:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    f.info:SetJustifyH("LEFT")
    f.info:SetWordWrap(false)
    f.display = f:CreateFontString(nil, "OVERLAY", "CRTFontDisableSmall")
    f.display:SetPoint("TOPRIGHT", -4, -3)
    f.label = f:CreateFontString(nil, "OVERLAY", "CRTFontButtonSmall")
    f.label:SetJustifyH("LEFT")
    f.label:SetWordWrap(false)
    f.heading = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    f.heading:SetPoint("TOPLEFT", 4, -2)
    f.heading:SetJustifyH("LEFT")
    f.heading:SetWordWrap(false)
    f:SetScript("OnMouseDown", function(self)
        -- Quick fill: a click on a line selects it for the palette's clicks
        if W.session and W.session.quickFill then
            W.session:Select(self.index)
            Editor.DrawRows()
        end
    end)
    W.rowFrames[i] = f
    return f
end

-- The text a timer row shows after its phase: its names, then the spell's name (or its ID until the game has it)
-- and its text. Shown only: a timed line is never changed here.
local function timerInfo(row)
    local t = row.timer
    local out = t.text or ""
    if t.kind == "spell" then
        local info = Notes:SpellInfo(t.spellId)
        local name = info and info.name or string.format(TEXT.spell, tostring(t.spellId))
        out = (out ~= "") and (name .. " - " .. out) or name
    end
    if row.tags and #row.tags > 0 then
        out = table.concat(CRT.NoteParser.JoinClassWords(row.tags), ", ") .. "  " .. out
    end
    return out
end

local function rowChips(f, i, row, x0, width, y0)
    local names = W.session:Names(i)
    local editable = W.session:Editable(i)
    local list, widths = {}, {}
    for k, name in ipairs(names) do
        local chip = f.chips[k] or makeChip(f)
        f.chips[k] = chip
        -- a player's class, else the class a class name names ("Demon Hunter")
        local class = (W.classOf and W.classOf(name)) or CRT.NoteParser.ClassOf(name)
        widths[k] = fillChip(chip, { label = name, class = class, token = name }, { row = i, index = k }, editable, false)
        list[k] = chip
    end
    for k = #names + 1, #f.chips do
        f.chips[k]:Hide()
    end
    return math.max(L.chipH, flow(list, widths, x0, width, y0))
end

-- Lays row i out for its kind and returns its height.
local function drawRow(f, i, row, width)
    for _, part in ipairs({ f.time, f.phase, f.swatch, f.info, f.display, f.label, f.heading }) do
        part:Hide()
    end
    f.index, f.kind = i, row.kind
    local el = links()
    if el then
        el.Clear(f) -- its tag and hover, set again below for its kind
    end
    f:EnableMouse(row.editable == true)
    local kind = row.kind
    -- a timed line is shown dimmed, under the Timers heading: no drop target, nothing to drag or remove
    f:SetAlpha(kind == "timer" and L.timerAlpha or 1)
    if kind ~= "label" and kind ~= "invite" then
        for _, chip in ipairs(f.chips) do
            chip:Hide()
        end
    end
    local height
    if kind == "timer" then
        f.time:SetText(row.time)
        f.phase:SetText("P" .. row.ph)
        f.time:Show()
        f.phase:Show()
        local x = 4 + L.timeW + L.phaseW
        if row.timer.color then
            local c = row.timer.color
            f.swatch:SetColorTexture(c[1] or 1, c[2] or 1, c[3] or 1, 1) -- not a theme colour: the line's colors:
            f.swatch:ClearAllPoints()
            f.swatch:SetPoint("TOPLEFT", x, -5)
            f.swatch:Show()
            x = x + 14
        end
        local right = 4
        if row.display then
            f.display:SetText(row.display)
            f.display:Show()
            right = right + math.ceil(f.display:GetStringWidth() or 0) + 6
        end
        f.info:ClearAllPoints()
        f.info:SetPoint("TOPLEFT", x, -3)
        f.info:SetWidth(math.max(20, width - x - right))
        f.info:SetText(timerInfo(row))
        f.info:Show()
        if el then
            el.TimerRow(f, i) -- the row it follows, on hover
        end
        height = L.infoH
    elseif kind == "label" or kind == "invite" then
        f.label:SetWidth(0)
        f.label:SetText(kind == "invite" and string.format(TEXT.invite, #W.session:Names(i)) or (row.label .. ":"))
        local w = math.min(math.ceil(f.label:GetStringWidth() or 0), math.floor(width * L.labelMax))
        f.label:SetWidth(w)
        f.label:ClearAllPoints()
        f.label:SetPoint("TOPLEFT", 4, -4)
        f.label:Show()
        -- how many timer lines follow it, right of the label
        local tagW = (el and kind == "label") and el.LabelTag(f, i, 4 + w + 6) or 0
        height = rowChips(f, i, row, 4 + w + 8 + tagW, width - 4, 2) + L.rowGap
    else
        if kind == "blank" then
            height = L.blankH
        else
            local text = row.text or ""
            local font = "CRTFontDisableSmall"
            if kind == "heading" or kind == "header" then
                font = "CRTFontNormal"
            end
            f.heading:SetFontObject(_G[font] or font)
            f.heading:SetWidth(width - 8)
            f.heading:SetText(text)
            if kind == "heading" or kind == "header" then
                f.heading:SetTextColor(UI.Color("heading"))
            else
                f.heading:SetTextColor(UI.Color("muted"))
            end
            f.heading:Show()
            height = L.headingH
        end
    end
    -- an editable row is a drop target: a box, its edge the heading colour when selected for Quick fill
    local selected = W.session.selected == i
    if row.editable then
        f:SetBackdropColor(UI.Color("background", 0.5))
        f:SetBackdropBorderColor(UI.Color(selected and "heading" or "border", selected and 1 or 0.6))
    else
        f:SetBackdropColor(0, 0, 0, 0)
        f:SetBackdropBorderColor(0, 0, 0, 0)
    end
    f.baseBorder = selected and "heading" or "border"
    return height
end

function Editor.DrawRows()
    if not W.session then
        return
    end
    if W.press then
        Editor.CancelDrag() -- its chip may be filled with another name
    end
    local width = W.rowsWidth or 400
    local y = 0
    -- the Timers heading, over the first timed line: they show what the note has, never changed here
    if not W.timerHeading then
        W.timerHeading = W.rowsChild:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    end
    W.timerHeading:Hide()
    for i, row in ipairs(W.session.rows) do
        if row.kind == "timer" and not W.timerHeading:IsShown() then
            W.timerHeading:ClearAllPoints()
            W.timerHeading:SetPoint("TOPLEFT", 4, -(y + 2))
            W.timerHeading:SetText(TEXT.timers)
            W.timerHeading:SetTextColor(UI.Color("muted"))
            W.timerHeading:Show()
            y = y + L.headingH
        end
        local f = rowFrame(i)
        local h = drawRow(f, i, row, width)
        f:ClearAllPoints()
        f:SetPoint("TOPLEFT", 0, -y)
        f:SetSize(width, h)
        f:Show()
        y = y + h + (row.editable and 2 or 0)
    end
    for i = #W.session.rows + 1, #W.rowFrames do
        W.rowFrames[i]:Hide()
    end
    W.rowsChild:SetHeight(math.max(1, y))
end

-- The palette ------------------------------------------------------------------------------------------------------

-- The live group out of combat (where its names may be secret, nothing): Groups:ReadRoster.
local function roster()
    local Groups = CRT.Groups
    if (InCombatLockdown and InCombatLockdown()) or not (Groups and Groups.ReadRoster) then
        return {}
    end
    local ok, list = pcall(Groups.ReadRoster, Groups)
    return ok and type(list) == "table" and list or {}
end

-- Players from: a saved Raid Groups layout by its id (Groups:Find), or nil.
local function findLayout(id)
    local Groups = CRT.Groups
    if id == nil or not (Groups and Groups.Find) then
        return nil
    end
    local preset = Groups:Find(id)
    return type(preset) == "table" and preset or nil
end

-- The layout the open note is linked to (its invite list became it on import), if it still exists.
local function linkedLayout()
    if not W.source or W.source.personal then
        return nil
    end
    local record = Notes:Get(W.source.id)
    local id = record and record.presetId
    return findLayout(id) and id or nil
end

local function pickKey()
    return W.source and (W.source.personal and "personal" or W.source.id)
end

-- The choices of the Players from dropdown (Model.Sources).
local function sourceChoices()
    local Groups = CRT.Groups
    local ok, layouts = false, nil
    if Groups and Groups.Presets then
        ok, layouts = pcall(Groups.Presets, Groups)
    end
    -- the personal note has no invite list
    local personal = W.source and W.source.personal
    return Model.Sources(ok and type(layouts) == "table" and layouts or {}, linkedLayout(), personal)
end

-- Whether a source can still be listed for the open note: the group, the invite list (not the personal note's), or a
-- layout that still exists.
local function validSource(from)
    if from == Model.SOURCE_GROUP then
        return true
    elseif from == Model.SOURCE_INVITE then
        return not (W.source and W.source.personal)
    end
    return from ~= nil and findLayout(from) ~= nil
end

-- Where the Players come from for the open note, worked out once as it opens: the choice made for it, else its
-- linked layout when you're not in a group, else the current group.
local function openSource()
    local key = pickKey()
    local from = key ~= nil and W.picked[key] or nil
    if not validSource(from) then
        if key ~= nil then
            W.picked[key] = nil
        end
        from = Model.DefaultSource(linkedLayout(), IsInGroup and IsInGroup() or false)
    end
    W.playersFrom = from
end

-- A layout changed: the source stays as it is unless it was a layout deleted since, which falls back as on opening.
local function keepSource()
    if not validSource(W.playersFrom) then
        openSource()
    end
end

-- A player's class: the one stored for that name (Raid Groups keeps it), else the shared class lookup Render uses.
local function playerClass(name)
    local cache = CRT.db and CRT.db.classCache
    local Groups = CRT.Groups
    if cache then
        local class = cache[name:lower()]
        if not class and Groups and Groups.Normalize then
            local ok, key = pcall(Groups.Normalize, name)
            class = ok and type(key) == "string" and cache[key:lower()] or nil
        end
        if class then
            return class
        end
    end
    return W.classOf and W.classOf(name) or nil
end

-- A player's last role seen (Groups.CachedRole), for the role order.
local function playerRole(name)
    local Groups = CRT.Groups
    if not (Groups and Groups.CachedRole) then
        return nil
    end
    local role = Groups.CachedRole(name)
    if not role and Groups.Normalize then
        local ok, key = pcall(Groups.Normalize, name)
        role = ok and type(key) == "string" and Groups.CachedRole(key) or nil
    end
    return role
end

-- The palette's players from the source picked.
local function sourceRoster()
    local from = W.playersFrom or Model.SOURCE_GROUP
    if from == Model.SOURCE_GROUP then
        return roster()
    end
    -- memoised by Render until the names it knows change
    W.classOf = CRT.NoteRender and CRT.NoteRender.SharedLookup and CRT.NoteRender.SharedLookup() or nil
    if from == Model.SOURCE_INVITE then
        return Model.Roster(W.session and W.session:InviteNames() or {}, playerClass, playerRole)
    end
    local preset = findLayout(from)
    return Model.Roster(preset and preset.slots or {}, playerClass, playerRole)
end

local function heading(n)
    local h = W.headings[n]
    if not h then
        h = W.paletteChild:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        W.headings[n] = h
    end
    return h
end

function Editor.DrawPalette()
    if W.press then
        Editor.CancelDrag() -- its chip is about to be filled with another entry
    end
    local width = (L.paletteW - UI.ScrollGutter()) - 4
    local sections = Model.Palette(sourceRoster(), W.query)
    local used, y = 0, 0
    for n, section in ipairs(sections) do
        local h = heading(n)
        h:ClearAllPoints()
        h:SetPoint("TOPLEFT", 2, -y)
        h:SetText(TEXT.sections[section.key])
        h:SetTextColor(UI.Color("heading"))
        h:Show()
        y = y + L.headingH
        local list, widths = {}, {}
        for _, entry in ipairs(section.entries) do
            used = used + 1
            local chip = W.paletteChips[used] or makeChip(W.paletteChild)
            W.paletteChips[used] = chip
            local icon = section.key == "players" or section.key == "classes"
            widths[#widths + 1] = fillChip(chip, entry, { token = entry.token, kind = section.kind }, false, icon)
            list[#list + 1] = chip
        end
        y = y + flow(list, widths, 2, width, y) + L.sectionGap
    end
    for k = used + 1, #W.paletteChips do
        W.paletteChips[k]:Hide()
    end
    W.paletteChild:SetHeight(math.max(1, y))
end

-- Drag and drop ----------------------------------------------------------------------------------------------------

-- The row under the mouse that takes names, or nil (outside the rows' scroll area there is none).
local function rowUnderMouse()
    if not (W.rowsScroll and W.rowsScroll:IsMouseOver()) then
        return nil
    end
    for i, f in ipairs(W.rowFrames) do
        if f:IsShown() and W.session.rows[i] and W.session.rows[i].editable and f:IsMouseOver() then
            return i
        end
    end
    return nil
end

local function highlight(target)
    for i, f in ipairs(W.rowFrames) do
        local row = W.session and W.session.rows[i]
        if row and row.editable and f:IsShown() then
            local key = (i == target) and "accent" or f.baseBorder or "border"
            f:SetBackdropBorderColor(UI.Color(key, (key == "border") and 0.6 or 1))
        end
    end
end

-- The keys while dragging, for Escape: out of combat only, where letting the other keys through can be changed.
local function catchKeys(on)
    local d = W.driver
    if on and not (InCombatLockdown and InCombatLockdown()) then
        if d.SetPropagateKeyboardInput then
            pcall(d.SetPropagateKeyboardInput, d, true)
        end
        d:EnableKeyboard(true)
        W.keys = true
    elseif W.keys then
        d:EnableKeyboard(false)
        W.keys = false
    end
end

local function endPress()
    W.press = nil
    if W.ghost then
        W.ghost:Hide()
    end
    if W.driver then
        catchKeys(false)
        W.driver:Hide()
    end
end

function Editor.CancelDrag()
    if not W.press then
        return
    end
    if W.session then
        W.session:CancelDrag()
    end
    endPress()
    highlight(nil)
end

local function cursor()
    local x, y = GetCursorPosition()
    local scale = UIParent:GetEffectiveScale() or 1
    return x / scale, y / scale
end

local function dragUpdate()
    local p = W.press
    if not p then
        W.driver:Hide()
        return
    end
    -- the button let go where the chip never heard it (its frame hidden or redrawn): the press ends, no drop
    if IsMouseButtonDown and not IsMouseButtonDown("LeftButton") then
        Editor.CancelDrag()
        return
    end
    local x, y = cursor()
    if not p.dragging then
        if math.abs(x - p.x) + math.abs(y - p.y) < L.dragStart then
            return
        end
        if not W.session:BeginDrag(p.source) then
            endPress()
            return
        end
        p.dragging = true
        W.ghost.text:SetText(p.chip.text:GetText() or "")
        W.ghost:SetWidth(math.ceil(W.ghost.text:GetStringWidth() or 0) + 2 * L.chipPad)
        local r, g, b = classRGB(p.chip.class)
        if r then
            W.ghost.text:SetTextColor(r, g, b) -- not a theme colour: the class colour
        else
            W.ghost.text:SetTextColor(UI.Color("text"))
        end
        W.ghost:Show()
        catchKeys(true)
    end
    W.ghost:ClearAllPoints()
    W.ghost:SetPoint("CENTER", UIParent, "BOTTOMLEFT", x, y)
    highlight(rowUnderMouse())
end

function chipDown(chip, button)
    if button ~= "LeftButton" or readOnly() or not chip.source then
        return
    end
    local x, y = cursor()
    W.press = { chip = chip, source = chip.source, x = x, y = y }
    W.driver:Show()
end

-- The palette lists the invite list as it is now: drawn again when the session's names change.
local function followInvite()
    if W.playersFrom == Model.SOURCE_INVITE then
        Editor.DrawPalette()
    end
end

local function changed()
    Editor.Refresh()
    followInvite()
end

-- A change to the session's names (fn returns whether it changed any), with the timer lines that follow a changed
-- row given its new names.
local function edit(fn)
    local el = links()
    if el then
        return el.Edit(fn)
    end
    return fn()
end

function chipUp(chip)
    local p = W.press
    if not p or p.chip ~= chip then
        return
    end
    endPress()
    if p.dragging then
        -- drawn again either way, so a refused drop leaves nothing half shown
        local target = rowUnderMouse()
        edit(function()
            return W.session:Drop(target)
        end)
        changed()
    elseif p.source.token then
        if edit(function()
            return W.session:PaletteClick(p.source.token, p.source.kind)
        end) then
            changed()
        end
    elseif W.session.quickFill then
        W.session:Select(p.source.row)
        Editor.DrawRows()
    end
end

function removeClick(chip)
    local s = chip.source
    if s and s.row and W.session and edit(function()
        return W.session:Remove(s.row, s.index)
    end) then
        changed()
    end
end

local function makeDrag()
    W.driver = CreateFrame("Frame", nil, UIParent)
    W.driver:SetSize(1, 1)
    W.driver:Hide()
    W.driver:SetScript("OnUpdate", dragUpdate)
    W.driver:SetScript("OnKeyDown", function(self, key)
        local escape = key == "ESCAPE"
        if self.SetPropagateKeyboardInput and not (InCombatLockdown and InCombatLockdown()) then
            pcall(self.SetPropagateKeyboardInput, self, not escape)
        end
        if escape then
            Editor.CancelDrag()
        end
    end)
    local g = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
    g:SetBackdrop(BACKDROP)
    g:SetFrameStrata("TOOLTIP")
    g:SetHeight(L.chipH)
    g.text = g:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    g.text:SetPoint("LEFT", L.chipPad, 0)
    UI.Tint(g, "SetBackdropColor", "surface", 0.95)
    UI.Tint(g, "SetBackdropBorderColor", "accent")
    g:Hide()
    W.ghost = g
end

-- Refresh, save, close ---------------------------------------------------------------------------------------------

local layoutLeft -- the rows, the banner over them and the raw text under them (below)

-- Everything that follows the session: the rows, the raw text, Save and the status line.
function Editor.Refresh()
    if not (W.window and W.session) then
        return
    end
    W.classOf = CRT.NoteRender and CRT.NoteRender.SharedLookup and CRT.NoteRender.SharedLookup() or nil
    -- from the window's own size (set by UI.Window), which is known before the layout runs
    local inset = UI.WINDOW_DEFAULTS and UI.WINDOW_DEFAULTS.inset or 8
    local width = (W.window:GetWidth() or L.width) - 2 * inset - L.paletteW - L.gap - UI.ScrollGutter()
    W.rowsWidth = math.max(200, width)
    W.rowsChild:SetWidth(W.rowsWidth)
    -- the timer links and their banner over the rows, before the rows that show them
    local el = links()
    W.bannerH = el and el.Refresh(W.rowsWidth + UI.ScrollGutter()) or 0
    layoutLeft()
    Editor.DrawRows()
    local text = W.session:Text()
    if W.raw:GetText() ~= text then
        W.raw:SetText(text)
    end
    local dirty = W.session:Dirty()
    W.save:SetEnabled(dirty and not readOnly())
    W.quick:SetEnabled(not readOnly())
    W.quick:SetChecked(W.session.quickFill)
    local status = ""
    if W.notice then
        status = W.notice
    elseif readOnly() and not W.source.personal then
        local _, why = Notes:CanEditRaid()
        status = UI.WarnText(why or "")
    elseif dirty then
        status = UI.WarnText(TEXT.unsaved)
    end
    W.status:SetText(status)
end

function layoutLeft()
    W.rowsScroll:ClearAllPoints()
    W.rowsScroll:SetPoint("TOPLEFT", 0, -(W.bannerH or 0)) -- under the Link banner when it shows
    if W.rawShown then
        W.rawBox:Show()
        W.rowsScroll:SetPoint("BOTTOMRIGHT", W.rawBox, "TOPRIGHT", -UI.ScrollGutter(), 6)
    else
        W.rawBox:Hide()
        W.rowsScroll:SetPoint("BOTTOMRIGHT", -UI.ScrollGutter(), 0)
    end
    W.rawButton:SetText(W.rawShown and TEXT.hideRaw or TEXT.rawText)
end

-- A new session over the saved text.
local function loadSession()
    local text, editable = sourceText()
    W.session = Model.New(text or "", { markdown = W.source.personal, readOnly = not editable })
    W.notice = nil
    if W.source.personal then
        W.window.strip:SetTitle(TEXT.personalTitle)
    else
        local record = Notes:Get(W.source.id)
        local name = record and record.name or TEXT.untitled
        if record and record.difficulty then
            name = name .. " (" .. record.difficulty .. ")"
        end
        W.window.strip:SetTitle(string.format(TEXT.title, name))
    end
end

function Editor.Save()
    local s = W.session
    if not s or readOnly() then
        return false
    end
    local text = s:Text()
    if W.source.personal then
        if Notes:Personal() ~= s.base then
            W.notice = UI.BadText(TEXT.changed)
            Editor.Refresh()
            return false
        end
        W.saving = true
        Notes:SetPersonal(text)
        W.saving = false
        CRT:Print(TEXT.personalSaved)
    else
        local record = Notes:Get(W.source.id)
        if not record then
            W.notice = UI.BadText(TEXT.gone)
            Editor.Refresh()
            return false
        end
        if not record.personal then
            -- asked again at the click: you may have lost the right since it opened
            local allowed, why = Notes:CanEditRaid()
            if not allowed then
                CRT:Print(why)
                return false
            end
        end
        if (record.raw or "") ~= s.base then
            W.notice = UI.BadText(TEXT.changed)
            Editor.Refresh()
            return false
        end
        W.saving = true
        Notes:UpdateRaw(W.source.id, text)
        W.saving = false
        CRT:Print(TEXT.saved)
    end
    local quick = s.quickFill
    loadSession()
    W.session:SetQuickFill(quick)
    Editor.Refresh()
    followInvite()
    return true
end

-- A change from elsewhere (a share, the page, the Timeline, a promotion): an editor with nothing unsaved follows it.
local function onNotesChange()
    if W.saving or not (W.window and W.window:IsShown() and W.session) or W.session:Dirty() then
        return
    end
    local text, editable = sourceText()
    if text == nil then
        W.notice = UI.BadText(TEXT.gone)
        Editor.Refresh()
    elseif text ~= W.session.base or editable == W.session.readOnly then
        local quick = W.session.quickFill
        loadSession()
        W.session:SetQuickFill(quick and editable)
        Editor.Refresh()
        followInvite()
    end
end

local function onHide(win)
    Editor.CancelDrag()
    if W.discarding or not (W.session and W.session:Dirty()) then
        return
    end
    -- unsaved: back up at once, and ask, the question lifted over the editor (UI.LiftOver)
    if not StaticPopupDialogs[POPUP] then
        StaticPopupDialogs[POPUP] = {
            text = TEXT.discard,
            button1 = TEXT.discardButton,
            button2 = CANCEL or "Cancel",
            timeout = 0,
            whileDead = true,
            hideOnEscape = true,
            preferredIndex = 3,
            OnAccept = function()
                Editor.Discard()
            end,
        }
    end
    C_Timer.After(0, function()
        win:Show()
        UI.LiftOver(UI.ShownPopup(StaticPopup_Show(POPUP), POPUP))
    end)
end

-- Closes the editor and drops what was not saved.
function Editor.Discard()
    W.discarding = true
    W.session = nil
    if W.window then
        W.window:Hide()
    end
    W.discarding = false
end

-- Building ---------------------------------------------------------------------------------------------------------

local function buildPalette(c)
    local right = CreateFrame("Frame", nil, c)
    right:SetPoint("TOPRIGHT", 0, 0)
    right:SetPoint("BOTTOMRIGHT", 0, L.footerH + 4)
    right:SetWidth(L.paletteW)
    local label = right:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    label:SetPoint("TOPLEFT", 2, -4)
    label:SetText(TEXT.search)
    local search = CreateFrame("EditBox", "CowfeeRaidToolsNoteEditorSearch", right, "InputBoxTemplate")
    search:SetAutoFocus(false)
    UI:SkinEditBox(search)
    search:SetFontObject(CRTFontHighlight)
    search:SetHeight(L.searchH)
    search:SetPoint("LEFT", label, "RIGHT", 10, 0)
    search:SetPoint("RIGHT", right, "RIGHT", -4, 0)
    search:SetScript("OnTextChanged", function(self, user)
        if user then
            W.query = strtrim(self:GetText() or "")
            Editor.DrawPalette()
        end
    end)
    search:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    W.search = search
    -- Players from: the group, the note's invite list or a saved Raid Groups layout
    local from = UI.Dropdown(right, TEXT.playersFrom, {
        labelWidth = L.fromLabelW, width = L.paletteW - L.fromLabelW - L.fromGap - 4,
        options = sourceChoices,
        get = function()
            return W.playersFrom
        end,
        set = function(key)
            local pick = pickKey()
            if pick ~= nil then
                W.picked[pick] = key
            end
            W.playersFrom = key
            Editor.DrawPalette()
            W.from.refresh()
        end,
    })
    from:SetPoint("TOPLEFT", 2, -(L.searchH + 6))
    W.from = from
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsNoteEditorPalette", right, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 0, -(L.searchH + 6 + L.fromH + 2))
    scroll:SetPoint("BOTTOMRIGHT", -UI.ScrollGutter(), 0)
    W.paletteChild = CreateFrame("Frame", nil, scroll)
    W.paletteChild:SetSize(L.paletteW - UI.ScrollGutter(), 1)
    scroll:SetScrollChild(W.paletteChild)
    W.paletteScroll = scroll
end

local function buildLeft(c)
    local left = CreateFrame("Frame", nil, c)
    left:SetPoint("TOPLEFT", 0, 0)
    left:SetPoint("BOTTOMRIGHT", -(L.paletteW + L.gap), L.footerH + 4)
    W.left = left
    local el = links()
    if el then
        el.Build(left) -- the Link banner, at the top
    end
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsNoteEditorRows", left, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    W.rowsChild = CreateFrame("Frame", nil, scroll)
    W.rowsChild:SetSize(400, 1)
    scroll:SetScrollChild(W.rowsChild)
    W.rowsScroll = scroll
    -- the raw text, as it will be saved: read-only, it can be selected and copied
    local box = CreateFrame("Frame", nil, left, "BackdropTemplate")
    box:SetBackdrop(BACKDROP)
    UI.Tint(box, "SetBackdropColor", "background", 0.6)
    UI.Tint(box, "SetBackdropBorderColor", "border")
    box:SetPoint("BOTTOMLEFT", 0, 0)
    box:SetPoint("BOTTOMRIGHT", 0, 0)
    box:SetHeight(L.rawH)
    local rawScroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsNoteEditorRaw", box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(rawScroll.ScrollBar)
    rawScroll:SetPoint("TOPLEFT", 6, -6)
    rawScroll:SetPoint("BOTTOMRIGHT", -(4 + UI.ScrollGutter()), 6)
    local raw = CreateFrame("EditBox", nil, rawScroll)
    raw:SetMultiLine(true)
    raw:SetAutoFocus(false)
    raw:SetFontObject(_G.CRTFontEditSmall or CRTFontEdit)
    raw:SetWidth(400)
    raw:SetScript("OnTextChanged", function(self, user)
        if user and W.session and self:GetText() ~= W.session:Text() then
            self:SetText(W.session:Text())
        end
    end)
    raw:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    rawScroll:SetScrollChild(raw)
    W.raw, W.rawBox = raw, box
    box:SetScript("OnSizeChanged", function(self, w)
        raw:SetWidth(math.max(100, (w or 400) - 16 - UI.ScrollGutter()))
    end)
end

local function buildFooter(c)
    local quick = CreateFrame("CheckButton", nil, c, "UICheckButtonTemplate")
    quick:SetSize(24, 24)
    quick:SetPoint("BOTTOMLEFT", -2, 0)
    UI:SkinCheckButton(quick)
    quick:SetScript("OnClick", function(self)
        if W.session then
            W.session:SetQuickFill(self:GetChecked())
            Editor.Refresh()
        end
    end)
    local quickText = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    quickText:SetPoint("LEFT", quick, "RIGHT", 2, 0)
    quickText:SetText(TEXT.quickFill)
    UI.HelpRight(quickText, TEXT.helpTitle, TEXT.help)
    W.quick = quick
    W.close = UI.PanelButton(c, TEXT.close, 24, function()
        W.window:Hide()
    end)
    W.close:SetPoint("BOTTOMRIGHT", 0, 0)
    W.save = UI.PanelButton(c, TEXT.save, 24, function()
        Editor.Save()
    end)
    W.save:SetPoint("RIGHT", W.close, "LEFT", -6, 0)
    W.rawButton = UI.PanelButton(c, TEXT.hideRaw, 24, function()
        W.rawShown = not W.rawShown
        layoutLeft()
        Editor.Refresh()
    end)
    W.rawButton:SetPoint("RIGHT", W.save, "LEFT", -6, 0)
    W.status = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    W.status:SetPoint("LEFT", quickText, "RIGHT", 30, 0)
    W.status:SetPoint("RIGHT", W.rawButton, "LEFT", -8, 0)
    W.status:SetJustifyH("LEFT")
    W.status:SetWordWrap(false)
end

-- History in the title bar, left of Reset: the note's earlier versions (Notes/HistoryWindow.lua), the same
-- window as the Raid Notes page's History. Not on the personal note; greyed with no earlier version.
local function refreshHistory()
    local b = W.history
    if not b then
        return
    end
    local id = W.source and not W.source.personal and W.source.id
    b:SetShown(id ~= nil and id ~= false)
    local n = id and Notes:Get(id) and Notes:HistoryCount(id) or 0
    b:SetLabel(string.format(TEXT.history, n))
    b:SetEnabled(n > 0)
end
Editor.RefreshHistory = refreshHistory

local function buildHistory(win)
    local b = UI.HeaderButton(win.strip, string.format(TEXT.history, 0), function()
        if W.source and not W.source.personal and CRT.NoteHistory then
            CRT.NoteHistory.Open(W.source.id)
        end
    end, { tipTitle = TEXT.historyTitle, tipText = TEXT.historyTip })
    b:SetPoint("RIGHT", win.reset or win.CloseButton, "LEFT", -4, 0)
    if b.SetMotionScriptsWhileDisabled then
        b:SetMotionScriptsWhileDisabled(true) -- greyed with no earlier version, its tooltip still says what it is
    end
    W.history = b
    Notes:OnChange(refreshHistory)
end

local function build()
    local win = UI.Window("CowfeeRaidToolsNoteEditor", {
        kind = "popout", title = TEXT.personalTitle, layer = "popups",
        saved = function()
            return CRT.db.notes.editor
        end,
        width = L.width, height = L.height, minWidth = L.minWidth, minHeight = L.minHeight,
    })
    W.window = win
    local c = win.content
    buildLeft(c)
    buildPalette(c)
    buildFooter(c)
    buildHistory(win)
    makeDrag()
    layoutLeft()
    win.refresh = function() -- a theme switch repaints it (UI:RepaintTheme)
        Editor.Refresh()
        Editor.DrawPalette()
    end
    win:SetScript("OnHide", onHide)
    win:SetScript("OnSizeChanged", function()
        if win:IsShown() then
            Editor.Refresh()
        end
    end)
    win:RegisterEvent("GROUP_ROSTER_UPDATE")
    -- the group changed: new players in the palette (when it lists the group), and a promotion (or demotion) unlocks
    -- (or locks) a clean editor
    win:SetScript("OnEvent", function()
        if win:IsShown() then
            if W.playersFrom == Model.SOURCE_GROUP then
                Editor.DrawPalette()
            end
            onNotesChange()
        end
    end)
    -- a layout saved, renamed, changed or deleted: the dropdown's choices, and the palette when it lists a layout
    if CRT.Groups and CRT.Groups.OnChange then
        CRT.Groups:OnChange(function()
            if not (win:IsShown() and W.session) then
                return
            end
            local before = W.playersFrom
            keepSource()
            W.from.refresh()
            if (before ~= Model.SOURCE_GROUP and before ~= Model.SOURCE_INVITE) or W.playersFrom ~= before then
                Editor.DrawPalette()
            end
        end)
    end
    UI:OnTheme(function()
        if win:IsShown() then
            win.refresh()
        end
    end)
    Notes:OnChange(onNotesChange)
end

-- source: { id = a note's id } or { personal = true } (the personal note).
function Editor.Open(source)
    if type(source) ~= "table" or not (source.personal or Notes:Get(source.id)) then
        return false
    end
    if not W.window then
        build()
    end
    local same = W.source and ((source.personal and W.source.personal) or (not source.personal and W.source.id == source.id))
    if W.session and W.session:Dirty() and W.window:IsShown() and not same then
        CRT:Print(TEXT.otherOpen)
        return false
    end
    if not (same and W.window:IsShown() and W.session) then
        W.source = { id = source.id, personal = source.personal and true or nil }
        loadSession()
        openSource() -- worked out once for this open; a layout edit later never changes it
    end
    W.from.refresh()
    refreshHistory()
    W.window:Show()
    if W.window.Raise then
        W.window:Raise()
    end
    Editor.Refresh()
    Editor.DrawPalette()
    return true
end

function Editor.IsShown()
    return W.window ~= nil and W.window:IsShown()
end
