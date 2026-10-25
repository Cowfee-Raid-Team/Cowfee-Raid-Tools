local ADDON, CRT = ...

-- The Raid Notes page, with five tabs:
--   Notes      the list of notes (one per boss), the text of the selected one, importing, sharing with
--              the group, the roster link to Raid Groups, your personal note, and a test run
--   Reminders  a boss's Journal abilities and your own reminders (Notes/Reminders.lua)
--   Markers    Marker macros: a boss's marker display and the marker macros (Markers/MacrosTab.lua)
--   Alerts     where your note lines show and how each kind of alert looks (Notes/AlertsTab.lua)
--   Settings   the three note windows, your alert's timing and voice, and sharing (Notes/Settings.lua)
-- (The Phases tab, Notes/Phases.lua, is off the page; see TABS below.)
-- The note windows and your alert are moved with "Previews".

local Notes = CRT.Notes
local Engine = CRT.NoteEngine
local UI = CRT.UI
local Targets = CRT.NoteTargets

local TEXT = {
    shared = "Shared",
    personal = "Personal",
    toPersonal = "Make my personal note",
    difficulty = "Difficulty",
    allDifficulties = "All",
    otherDifficulty = "Other",
    kindHelp = "Shared: the raid's notes, one per guild. A share from your guild replaces its note for that boss; one from another guild or a pickup group is kept apart. The newest share is the note in use and runs on the pull.\n\nPersonal: your own lines for a boss, kept on this computer. They run on every pull alongside the shared note, and a share never touches them.",
    noteText = "Note text",
    renderHelp = "The note shows as it reads in the game. Click it to see the raw text. Edit it and Save to see it rendered again. Unsaved changes stay in the raw text.\n\nIf you can't change the raid note, the raw text is read-only. Press Escape to go back.\n\nThe personal note works the same way.\n\nPop out editor opens the note's lines in a window. Drag players, roles, groups and classes onto its assignment lines, and players onto its invite list. Timers stay as they are. Only the names change.\n\nHistory keeps the note's last 5 earlier versions. Compare one with the note now, or restore it.",
    popOut = "Pop out editor",
    history = "History (%d)",
    historyLabel = "History",
    historyTip = "The note's last 5 earlier versions: when, how and who changed them. Compare one with the note now, or restore it.",
    historyNone = "No earlier versions yet. Each change to this note's text keeps the text before it here, up to 5.",
    historyLine = "%d earlier version%s in History",
    popOutShort = "Pop out",
    changedUnder = "This note changed while you were typing, so your text was not saved. Click Save again to replace the note with your text, or click another note and back to see the new one.",
    personalChangedUnder = "Your personal note changed in the note editor while you were typing here, so this was not saved. Click Save again to replace it with this text.",
    saveText = "Save text changes",
    saved = "Saved.",
    sendTo = "Send to",
    crtHelp = "CRT shares the note with CRT's own raid note and makes it everyone's active note. In a raid you must be the leader or an assistant.",
    allHelp = "All available sends with CRT and with every other addon on the list that is loaded, and says in chat how each one went.",
}

-- Share's Send to: "crt", a note target's key, or "all". A saved target that no longer exists is CRT.
local function shareTarget()
    local key = CRT.db.notes.shareTarget
    if key == "all" or (key and Targets:Get(key)) then
        return key
    end
    return "crt"
end

-- CRT first (the default), then every note target, greyed out with the reason when its addon isn't
-- loaded, then All available.
local function shareOptions()
    local list = { { key = "crt", label = "CRT", tooltip = TEXT.crtHelp } }
    for _, target in ipairs(Targets:List()) do
        local available, why = target.IsAvailable()
        list[#list + 1] = { key = target.key, label = target.label, disabled = not available,
            tooltip = available and target.help or ("Not available: " .. why) }
    end
    list[#list + 1] = { key = "all", label = "All available", tooltip = TEXT.allHelp }
    return list
end

local function shareHelp()
    local parts = { TEXT.crtHelp }
    for _, target in ipairs(Targets:List()) do
        local available, why = target.IsAvailable()
        parts[#parts + 1] = target.help .. (available and "" or ("\n" .. UI.BadText("Not available: " .. why)))
    end
    parts[#parts + 1] = TEXT.allHelp
    return table.concat(parts, "\n\n")
end

local ROW_H = 24
-- the note buttons and Send to (a UI.Dropdown row, UI.CONTROL_ROW_H high), at the bottom of the list's column
local BUTTONS_H = 4 * (24 + 4) + (UI.CONTROL_ROW_H or 32)
local LIST_SCROLL_W = 22 -- the list's scroll bar
-- The Notes tab in three columns across the page (UI.PAGE_W): the notes list, the note text, and your
-- personal note with Try it. The tab is UI.PAGE_H - 66 high, under the tabs.
local LIST_W = 250
local RIGHT_W = 250
local TEXT_X = 8 + LIST_W + 14
local RIGHT_X = UI.PAGE_W - 8 - RIGHT_W
local TEXT_W = RIGHT_X - 14 - TEXT_X
local TAB_H = UI.PAGE_H - 66
-- The note text box, from under its heading down to the details under it: Last updated, Shared by, Roster
-- and the History line (STATUS_LINES lines of STATUS_LINE_H, the tiny font's line), and Save beside them.
local STATUS_LINE_H = 12
local STATUS_LINES = 4
local NOTE_BOX_TOP = 36
local NOTE_BOX_H = TAB_H - NOTE_BOX_TOP - 8 - STATUS_LINES * STATUS_LINE_H

local GRAY = { 0.35, 0.35, 0.35 }
local GOLD = CRT.PALETTE.heading -- the theme's heading colour; refilled in place on a theme switch
local listKind = "shared" -- the Notes list's tab: "shared" (the raid's notes) or "personal" (your copies)
local BACKDROP = {
    bgFile = "Interface\\Buttons\\WHITE8X8",
    edgeFile = "Interface\\Buttons\\WHITE8X8",
    edgeSize = 1,
}

local page, rows, editor, status, selected = nil, {}, nil, nil, nil
local textBox -- the note text: rendered, or its raw edit box (Render.Bind)
-- The active note the page last followed. When the active note changes (shared from here or the
-- Timeline, received from the raid leader, or made from the Timeline), the page selects it, so the
-- text shown is the note that runs; clicking another note still shows that one until the next change.
local followedActive
local kindTabs, toPersonal = {}, nil -- the Shared and Personal tabs, and Make my personal note
local makeRow -- makes the notes list's i-th row (set in build)
local diffDropdown, diffChips = nil, {} -- the list's difficulty filter, for the Dropdown and Chips styles
local LIST_TOP = -36 -- where the notes list starts; a filter row takes one row of it
local listScroll, listChild -- the notes list scrolls, from the top down to the note buttons
local useButton, shareButton -- Use this note and Share to raid, for shared notes only
local controls = {}
local importDialog
local refresh

local function skin(frame, alpha)
    frame:SetBackdrop(BACKDROP)
    frame:SetBackdropColor(0, 0, 0, alpha or 0.5)
    frame:SetBackdropBorderColor(GRAY[1], GRAY[2], GRAY[3], 1)
end

-- The edit box only covers the lines it holds, so a click on the empty part of its box would do
-- nothing. This makes the whole box and its scroll area put the cursor at the end of the text.
local function clickToType(box, scroll, edit)
    local function focus()
        -- a box that is read-only (greyed) takes no typing
        if edit.IsEnabled and not edit:IsEnabled() then
            return
        end
        edit:SetFocus()
        edit:SetCursorPosition(#(edit:GetText() or ""))
    end
    for _, frame in ipairs({ box, scroll }) do
        frame:EnableMouse(true)
        frame:SetScript("OnMouseDown", focus)
    end
end

local function makeButton(parent, label, width, height)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetSize(width, height or 24)
    b:SetText(label)
    return b
end

-- A button as wide as its label (UI.PanelButtonWidth: the label and the template's end caps).
local function fitButton(b)
    local fs = b.GetFontString and b:GetFontString()
    local w = fs and fs:GetStringWidth() or 0
    b:SetWidth(UI.PanelButtonWidth and UI.PanelButtonWidth(w) or (math.ceil(w) + 28))
    return b
end

-- Opens the pop-out note editor (Notes/EditorWindow.lua) on a note, or { personal = true }.
local function openEditor(source)
    if CRT.NoteEditor then
        CRT.NoteEditor.Open(source)
    end
end

-- Import dialog: paste a note. -------------------------------------------------------------

local function getImportDialog()
    if importDialog then
        return importDialog
    end
    local d = CreateFrame("Frame", "CowfeeRaidToolsNoteImport", UIParent, "BasicFrameTemplateWithInset")
    UI:StyleWindow(d)
    d:SetSize(560, 420)
    d:SetPoint("CENTER")
    UI:RegisterLayer("popups", d)
    d:SetClampedToScreen(true)
    d:SetMovable(true)
    d:EnableMouse(true)
    d:RegisterForDrag("LeftButton")
    d:SetScript("OnDragStart", function(self) self:StartMoving(true) end)
    d:SetScript("OnDragStop", d.StopMovingOrSizing)
    tinsert(UISpecialFrames, "CowfeeRaidToolsNoteImport")
    UI.SetFrameTitle(d, "Import a raid note (paste it below)")

    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsNoteImportScroll", d, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 14, -34)
    scroll:SetPoint("BOTTOMRIGHT", -34, 46)
    d.edit = CreateFrame("EditBox", nil, scroll)
    d.edit:SetMultiLine(true)
    d.edit:SetAutoFocus(false)
    d.edit:SetFontObject(CRTFontEdit)
    d.edit:SetWidth(500)
    d.edit:SetScript("OnEscapePressed", function()
        d:Hide()
    end)
    scroll:SetScrollChild(d.edit)

    local ok = makeButton(d, "Import", 110, 26)
    ok:SetPoint("BOTTOM", -60, 12)
    ok:SetScript("OnClick", function()
        -- on the Personal tab an import is your own copy, never replaced by a share
        local id, message = Notes:Import(d.edit:GetText(), nil, listKind == "personal", nil, "Imported")
        CRT:Print(message)
        if id then
            selected = id
            d:Hide()
            refresh()
        end
    end)
    local cancel = makeButton(d, CANCEL, 110, 26)
    cancel:SetPoint("BOTTOM", 60, 12)
    cancel:SetScript("OnClick", function()
        d:Hide()
    end)
    d:Hide()
    importDialog = d
    return d
end

-- The page ---------------------------------------------------------------------------------

local function kindOf(record)
    return record and record.personal and "personal" or "shared"
end

local function selectedNote()
    if selected and Notes:Get(selected) and kindOf(Notes:Get(selected)) == listKind then
        return selected, Notes:Get(selected)
    end
    local activeId, activeRecord = Notes:Active()
    if activeId and kindOf(activeRecord) == listKind then
        selected = activeId
        return activeId, activeRecord
    end
    local list = Notes:List(listKind)
    if list[1] then
        selected = list[1].id
        return selected, list[1].record
    end
    selected = nil
    return nil
end

refresh = function()
    if not page or not page:IsShown() then
        return
    end
    local newActive = Notes:Active()
    -- not while you are typing in the note text: the jump waits for the next refresh after that
    if newActive ~= followedActive and not (editor and editor:HasFocus()) then
        followedActive = newActive
        if newActive then
            selected = newActive
            listKind = kindOf(Notes:Get(newActive)) -- the list follows the note in use to its tab
        end
    end
    local id, record = selectedNote()
    local activeId = Notes:Active()

    -- the list as Notes Settings says: grouped under folding difficulty headings, or one difficulty (or
    -- All) picked with a dropdown or with chips over it
    local all = Notes:List(listKind)
    local style = Notes:ListStyle()
    local filter = Notes:ListDifficulty()
    local items, top = {}, LIST_TOP
    if style == "grouped" then
        local groups = {}
        for _, e in ipairs(all) do
            local g = Notes.DifficultyGroup(e.record)
            groups[g] = groups[g] or {}
            table.insert(groups[g], e)
        end
        for _, g in ipairs({ "Mythic", "Heroic", "Normal", "Other" }) do
            if groups[g] then
                local folded = Notes:ListFolded(g)
                items[#items + 1] = { heading = g, count = #groups[g], folded = folded }
                if not folded then
                    for _, e in ipairs(groups[g]) do
                        items[#items + 1] = { entry = e, short = true }
                    end
                end
            end
        end
    else
        top = LIST_TOP - ROW_H
        for _, e in ipairs(all) do
            if filter == "All" or Notes.DifficultyGroup(e.record) == filter then
                items[#items + 1] = { entry = e, short = filter ~= "All" }
            end
        end
    end
    diffDropdown:SetShown(style == "dropdown")
    if style == "dropdown" then
        diffDropdown.refresh()
    end
    for key, chip in pairs(diffChips) do
        chip:SetShown(style == "chips")
        local n = 0
        for _, e in ipairs(all) do
            if key == "All" or Notes.DifficultyGroup(e.record) == key then
                n = n + 1
            end
        end
        chip:SetText((key == "All" and "All" or key:sub(1, 1)) .. " " .. n)
        UI:SetTabSelected(chip, key == filter)
    end
    local list = items
    for _, kind in ipairs({ "shared", "personal" }) do
        UI:SetTabSelected(kindTabs[kind], kind == listKind)
    end
    toPersonal:SetShown(listKind == "shared")
    useButton:SetShown(listKind == "shared")
    shareButton:SetShown(listKind == "shared")
    -- the list scrolls under its filter row (when there is one) down to the note buttons
    listScroll:ClearAllPoints()
    listScroll:SetPoint("TOPLEFT", 8, top)
    listScroll:SetPoint("BOTTOMRIGHT", page, "TOPLEFT", 8 + LIST_W - LIST_SCROLL_W, -(TAB_H - BUTTONS_H - 6))
    for i = #rows + 1, #list do
        rows[i] = makeRow(i)
    end
    listChild:SetHeight(math.max(1, #list * ROW_H))
    for i = 1, #rows do
        local row = rows[i]
        local item = list[i]
        local entry = item and item.entry
        row.heading = item and item.heading or nil
        if item and item.heading then
            -- a difficulty heading: the theme's heading colour, no box, click to fold it
            row.text:SetText((item.folded and "> " or "v ") .. item.heading .. " (" .. item.count .. ")")
            row.text:SetTextColor(UI.Color("heading"))
            row:SetBackdropColor(0, 0, 0, 0)
            row:SetBackdropBorderColor(0, 0, 0, 0)
            row.id = nil
            row:Show()
        elseif entry then
            row.text:SetTextColor(1, 1, 1)
            row:SetBackdropColor(0, 0, 0, 0.45)
            local r = entry.record
            -- a shared note says whose it is: your guild's by its name, anyone else's by the sender
            local label = (r.name or "Note") .. ((r.difficulty and not item.short) and (" (" .. r.difficulty .. ")") or "")
                .. ((not r.personal) and Notes.SourceLabel(r) and (" - " .. Notes.SourceLabel(r)) or "")
            if entry.id == activeId then
                label = label .. "  " .. UI.GoodText("active")
            end
            row.text:SetText(label)
            row.id = entry.id
            local color = entry.id == id and GOLD or GRAY
            row:SetBackdropBorderColor(color[1], color[2], color[3], 1)
            row:Show()
        else
            row:Hide()
        end
    end

    -- The note's text, as saved, shown rendered (Notes/Render.lua) until clicked. The raw box follows the
    -- saved text whenever it holds no unsaved typing, so a line moved, copied or deleted on the Timeline
    -- shows here at once. Unsaved typing stays, raw, until it is saved or another note is picked.
    local rosterLinked = record and record.presetId and CRT.Groups:Find(record.presetId) and true or false
    textBox:Update(record and record.raw or "", id, rosterLinked)

    local lines = {}
    if record then
        -- the note's details, one per line: its last change, who shared it, its roster
        local by = Notes.ShortName(record.updatedBy or record.from)
        lines[#lines + 1] = "Last updated: " .. (record.updated or "?") .. (by and (" - " .. by) or "")
        if record.from then
            local via = Notes.ViaLabel(record.via)
            lines[#lines + 1] = "Shared by: " .. Notes.ShortName(record.from) .. ", " .. (record.sharedAt or record.updated or "?")
                .. (via and (" (" .. via .. ")") or "")
        end
        if record.presetId and CRT.Groups:Find(record.presetId) then
            lines[#lines + 1] = "Roster: linked to a Raid Groups layout"
        end
    end
    local history = record and Notes:HistoryCount(id) or 0
    -- what is going on now: a share being sent, a run
    local now = {}
    local sent, total = CRT.NoteComm:Sharing()
    if sent then
        now[#now + 1] = format("Sharing: %d of %d parts sent", sent, total)
    end
    local Alerts = CRT.Alerts
    if Engine.running then
        now[#now + 1] = "Running: phase " .. tostring(Engine:CurrentPhase()) .. (Engine.reason == "test" and " (test)" or "")
    elseif Alerts.running and not (Alerts.run and Alerts.run.reason == "countdown") then
        -- A run with reminders but no note for this boss: the note windows stay idle. The pull timer's countdown
        -- run (special alerts before the pull, Alerts/Countdown.lua) runs no reminders, so it gets no line.
        now[#now + 1] = "Running reminders, no note: phase " .. tostring(Engine:CurrentPhase())
            .. (Alerts.run and Alerts.run.reason == "test" and " (test)" or "")
    end
    -- at most STATUS_LINES lines, the room under the box: the History line goes first (History (N) shows the
    -- count too), then a share and a run share one line
    if history > 0 and #lines + 1 + #now <= STATUS_LINES then
        lines[#lines + 1] = format(TEXT.historyLine, history, history == 1 and "" or "s")
    end
    if #lines + #now > STATUS_LINES then
        now = { table.concat(now, "; ") }
    end
    for _, line in ipairs(now) do
        lines[#lines + 1] = line
    end
    status:SetText(table.concat(lines, "\n"))

    for _, control in ipairs(controls) do
        control.refresh()
    end
end

local function buildNotes(pf)
    page = pf


    -- Left: the notes.
    local listLabel = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    listLabel:SetPoint("TOPLEFT", 8, -14)
    listLabel:SetText("Notes")
    UI.HelpRight(listLabel, "Raid notes", "Import a note and share it with the raid before the pull; its timers count down from the start of the fight, and its other text goes to the Assignments window. Notes Settings has the windows and sharing; Alert Settings has where your lines show; Mech Alerts has boss mechanic alerts.")
    -- Shared and Personal: which notes the list shows
    for i, kind in ipairs({ "shared", "personal" }) do
        local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
        b:SetSize(68, 20)
        b:SetPoint("TOPLEFT", 98 + (i - 1) * 72, -10)
        skin(b, 0.4)
        b.sel = b:CreateTexture(nil, "ARTWORK")
        b.sel:SetAllPoints()
        b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
        b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        b.text:SetPoint("CENTER")
        b.text:SetText(kind == "shared" and TEXT.shared or TEXT.personal)
        b:SetScript("OnClick", function()
            listKind = kind
            selected = nil
            refresh()
        end)
        UI:RegisterTab(b)
        kindTabs[kind] = b
    end
    -- the (?) just after the tabs, clear of the Note text heading at TEXT_X
    UI.HelpRight(kindTabs.personal, TEXT.personal, TEXT.kindHelp)

    -- the difficulty filter over the list, for the Dropdown and Chips styles (Notes Settings)
    local DIFF_OPTIONS = { { key = "All", label = TEXT.allDifficulties } }
    for _, d in ipairs(Notes.DIFFICULTIES) do
        DIFF_OPTIONS[#DIFF_OPTIONS + 1] = { key = d, label = d }
    end
    DIFF_OPTIONS[#DIFF_OPTIONS + 1] = { key = "Other", label = TEXT.otherDifficulty }
    diffDropdown = UI.Dropdown(pf, TEXT.difficulty, {
        options = DIFF_OPTIONS,
        labelWidth = 64,
        width = LIST_W - 68,
        get = function()
            return Notes:ListDifficulty()
        end,
        set = function(key)
            Notes:SetListDifficulty(key)
        end,
    })
    diffDropdown:SetPoint("TOPLEFT", 8, LIST_TOP)
    diffDropdown:Hide()
    local chipKeys = { "All", "Mythic", "Heroic", "Normal" }
    local chipW = math.floor((LIST_W - 3 * 4) / #chipKeys)
    for i, key in ipairs(chipKeys) do
        local c = CreateFrame("Button", nil, pf, "BackdropTemplate")
        c:SetSize(chipW, 18)
        c:SetPoint("TOPLEFT", 8 + (i - 1) * (chipW + 4), LIST_TOP - 2)
        skin(c, 0.4)
        c.sel = c:CreateTexture(nil, "ARTWORK")
        c.sel:SetAllPoints()
        c.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
        c.text = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        c.text:SetPoint("CENTER")
        c:SetFontString(c.text)
        c:SetScript("OnClick", function()
            Notes:SetListDifficulty(key)
        end)
        UI:RegisterTab(c)
        c:Hide()
        diffChips[key] = c
    end

    -- the notes list: a scroll frame from under the tabs to the note buttons, holding a row per note or
    -- heading (made as the list grows), scrolled with the mouse wheel or its bar
    listScroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsNotesListScroll", pf, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(listScroll.ScrollBar)
    listChild = CreateFrame("Frame", nil, listScroll)
    listChild:SetSize(LIST_W - LIST_SCROLL_W, 1)
    listScroll:SetScrollChild(listChild)
    makeRow = function(i)
        local row = CreateFrame("Button", nil, listChild, "BackdropTemplate")
        row:SetSize(LIST_W - LIST_SCROLL_W, ROW_H - 2)
        row:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_H)
        skin(row, 0.45)
        row.text = row:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        row.text:SetPoint("LEFT", 8, 0)
        row.text:SetPoint("RIGHT", -6, 0)
        row.text:SetJustifyH("LEFT")
        row.text:SetWordWrap(false) -- one line, cut short rather than wrapping out of its box
        row:SetScript("OnClick", function(self)
            if type(self.heading) == "string" then -- a difficulty heading folds; a note row picks its note
                Notes:SetListFolded(self.heading, not Notes:ListFolded(self.heading))
                return
            end
            selected = self.id
            refresh()
        end)
        return row
    end

    -- the note buttons, at the bottom of the column (BUTTONS_H high, Send to the last row)
    local import = makeButton(pf, "Import", 122)
    import:SetPoint("TOPLEFT", 8, -(TAB_H - BUTTONS_H))
    import:SetScript("OnClick", function()
        local d = getImportDialog()
        d.edit:SetText("")
        d:Show()
        d.edit:SetFocus()
    end)
    local delete = makeButton(pf, "Delete", 122)
    delete:SetPoint("LEFT", import, "RIGHT", 6, 0)
    delete:SetScript("OnClick", function()
        if selected then
            Notes:Delete(selected)
            selected = nil
            refresh()
        end
    end)
    local active = makeButton(pf, "Use this note", 122)
    useButton = active
    active:SetPoint("TOPLEFT", import, "BOTTOMLEFT", 0, -4)
    active:SetScript("OnClick", function()
        if selected then
            Notes:SetActive(selected)
        end
    end)
    local share = makeButton(pf, "Share to raid", 122)
    shareButton = share
    share:SetPoint("LEFT", active, "RIGHT", 6, 0)
    share:SetScript("OnClick", function()
        -- With no note picked, CRT sends the Empty note (Notes/Comm.lua) and the other addons clear theirs.
        local key = shareTarget()
        local record = selected and Notes:Get(selected)
        if key == "crt" or key == "all" then
            CRT.NoteComm:Share(selected)
        end
        if key == "all" then
            for _, target in ipairs(Targets:List()) do
                local available, why = target.IsAvailable()
                if available then
                    Targets:Share(target.key, record)
                else
                    CRT:Print(target.label .. ": skipped, " .. why)
                end
            end
        elseif key ~= "crt" then
            Targets:Share(key, record)
        end
        refresh()
    end)
    local roster = makeButton(pf, "Open roster in Raid Groups", LIST_W)
    roster:SetPoint("TOPLEFT", active, "BOTTOMLEFT", 0, -4)
    roster:SetScript("OnClick", function()
        local record = selected and Notes:Get(selected)
        if record and record.presetId and CRT.Groups:Find(record.presetId) then
            CRT.Groups:Select(record.presetId)
            UI:Show("groups")
        else
            CRT:Print("This note has no invite list, so there is no roster for it.")
        end
    end)
    -- Where Share to raid sends the note: CRT's own sharing, another raid addon's note, or all of them.
    local sendTo = UI.Dropdown(pf, TEXT.sendTo, {
        labelWidth = 56,
        width = 160,
        options = shareOptions,
        get = shareTarget,
        set = function(key)
            Notes:Set(nil, "shareTarget", key)
        end,
    })
    -- Save to personal (on the Shared tab): a copy of this note, with your changes, kept as your own
    toPersonal = makeButton(pf, TEXT.toPersonal, LIST_W)
    toPersonal:SetPoint("TOPLEFT", roster, "BOTTOMLEFT", 0, -4)
    toPersonal:SetScript("OnClick", function()
        if not selected then
            return
        end
        local record = Notes:Get(selected)
        local id = record and Notes:MakePersonal(record.encounterID, record.difficulty, record.name)
        if id then
            listKind, selected = "personal", id
            refresh()
        else
            CRT:Print("This note has no boss (EncounterID), so there is no personal note to make for it.")
        end
    end)
    sendTo:SetPoint("TOPLEFT", toPersonal, "BOTTOMLEFT", 0, -4)
    controls[#controls + 1] = sendTo
    UI.HelpRight(sendTo, TEXT.sendTo, shareHelp)

    -- Middle: the note text, editable, down to the Save button at the bottom of the tab.
    local textLabel = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    textLabel:SetPoint("TOPLEFT", TEXT_X, -14)
    textLabel:SetText(TEXT.noteText)
    local box = CreateFrame("Frame", nil, pf, "BackdropTemplate")
    box:SetPoint("TOPLEFT", TEXT_X, -NOTE_BOX_TOP)
    box:SetSize(TEXT_W, NOTE_BOX_H)
    skin(box, 0.4)
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsNoteTextScroll", box, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll:SetPoint("TOPLEFT", 6, -6)
    scroll:SetPoint("BOTTOMRIGHT", -28, 6)
    editor = CreateFrame("EditBox", nil, scroll)
    editor:SetMultiLine(true)
    editor:SetAutoFocus(false)
    editor:SetFontObject(_G.CRTFontEditSmall or CRTFontEdit) -- smaller, so note lines fit; never unreadable
    editor:SetWidth(TEXT_W - 40)
    editor:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    scroll:SetScrollChild(editor)
    clickToType(box, scroll, editor)
    -- the note rendered over the box; a click shows the raw text, read-only when you may not change it
    local Render = CRT.NoteRender
    local textView = Render.View(box, {
        key = "Text",
        width = TEXT_W - 6 - (4 + UI.ScrollGutter()), -- the view's scroll frame, inside the box (Render.View)
        onClick = function()
            textBox:Raw()
        end,
        context = function()
            return { rosterLinked = textBox.contextKey }
        end,
    })
    textBox = Render.Bind(textView, scroll, editor, function()
        return (Notes:CanEditRaid())
    end)
    -- Pop out editor, over the box's right end: the selected note's names to drag and drop (read-only for a raider
    -- who can't change the raid note, as the raw text is)
    local popOut = fitButton(makeButton(pf, TEXT.popOut, 120, 20))
    popOut:SetPoint("BOTTOMRIGHT", box, "TOPRIGHT", 0, 3)
    popOut:SetScript("OnClick", function()
        if selected then
            openEditor({ id = selected })
        end
    end)
    popOut.refresh = function()
        popOut:SetEnabled(selected ~= nil and CRT.NoteEditor ~= nil)
    end
    controls[#controls + 1] = popOut
    -- History, left of Pop out editor: the note's earlier versions (Notes/HistoryWindow.lua); greyed with none
    local history = fitButton(makeButton(pf, format(TEXT.history, 0), 120, 20))
    history:SetPoint("RIGHT", popOut, "LEFT", -6, 0)
    history:SetScript("OnClick", function()
        if selected and CRT.NoteHistory then
            CRT.NoteHistory.Open(selected)
        end
    end)
    history:SetMotionScriptsWhileDisabled(true) -- the tooltip says why it is greyed
    history:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
        GameTooltip:SetText(TEXT.historyLabel, 1, 1, 1)
        GameTooltip:AddLine(self:IsEnabled() and TEXT.historyTip or TEXT.historyNone, 0.85, 0.85, 0.85, true)
        GameTooltip:Show()
    end)
    history:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    history.refresh = function()
        local n = selected and Notes:Get(selected) and Notes:HistoryCount(selected) or 0
        history:SetText(format(TEXT.history, n))
        fitButton(history)
        history:SetEnabled(n > 0)
    end
    controls[#controls + 1] = history

    local save = makeButton(pf, TEXT.saveText, 170)
    save:SetPoint("TOPRIGHT", box, "BOTTOMRIGHT", 0, -6)
    save:SetScript("OnClick", function()
        if selected then
            -- asked again at the click: you may have lost the right since the page drew
            local allowed, why = Notes:CanEditRaid()
            if not allowed then
                CRT:Print(why)
                return
            end
            -- the note changed (a share, the Timeline, the note editor) while you typed: never written over
            local record = Notes:Get(selected)
            if record and editor.loaded ~= nil and (record.raw or "") ~= editor.loaded then
                editor.loaded = record.raw or "" -- seen: a second Save is your choice to replace it
                CRT:Print(TEXT.changedUnder)
                return
            end
            textBox:Saved()
            editor:ClearFocus()
            Notes:UpdateRaw(selected, editor:GetText())
            CRT:Print(TEXT.saved)
        end
    end)

    -- Only the raid leader or an assistant changes the raid note (P4): for anyone else the raw text is
    -- read-only (it can be selected and copied, typing is undone: Render.Bind) and Save is greyed, with a
    -- (?) saying why. Set again at every redraw and show, so a
    -- promotion unlocks it. Import, Use this note and Delete stay: they choose which note you hold.
    -- The (?) on how the rendered note works comes first, the lock's (?) after it.
    local renderHelp = UI.HelpRight(textLabel, TEXT.noteText, TEXT.renderHelp)
    local lockHelp = UI.HelpRight(renderHelp, TEXT.noteText, function()
        local _, why = Notes:CanEditRaid()
        return why or ""
    end)
    lockHelp.refresh = function()
        local allowed = Notes:CanEditRaid()
        save:SetEnabled(allowed and true or false)
        lockHelp:SetShown(not allowed)
    end
    controls[#controls + 1] = lockHelp

    status = pf:CreateFontString(nil, "OVERLAY", _G.CRTFontDisableTiny and "CRTFontDisableTiny" or "CRTFontDisableSmall")
    status:SetPoint("TOPLEFT", box, "BOTTOMLEFT", 0, -8)
    status:SetPoint("RIGHT", save, "LEFT", -8, 0)
    status:SetJustifyH("LEFT")
    -- never more lines than the room under the box (a long line is cut short, not wrapped below the tab)
    if status.SetMaxLines then
        status:SetMaxLines(STATUS_LINES)
    end

    -- Right: your personal note, shown in its own window.
    local top = -14
    local personalLabel = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    personalLabel:SetPoint("TOPLEFT", RIGHT_X, top)
    personalLabel:SetText("Personal note (only you see it)")
    local pbox = CreateFrame("Frame", nil, pf, "BackdropTemplate")
    pbox:SetPoint("TOPLEFT", RIGHT_X, top - 22)
    pbox:SetSize(RIGHT_W, 220)
    skin(pbox, 0.4)
    local pscroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsPersonalNoteScroll", pbox, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(pscroll.ScrollBar)
    pscroll:SetPoint("TOPLEFT", 6, -6)
    pscroll:SetPoint("BOTTOMRIGHT", -28, 6)
    local personal = CreateFrame("EditBox", nil, pscroll)
    personal:SetMultiLine(true)
    personal:SetAutoFocus(false)
    personal:SetFontObject(CRTFontEdit)
    personal:SetWidth(RIGHT_W - 40)
    personal:SetScript("OnEscapePressed", function(self)
        self:ClearFocus()
    end)
    pscroll:SetScrollChild(personal)
    clickToType(pbox, pscroll, personal)
    -- rendered like the note text, with the personal note's markdown
    local personalBox
    local personalView = Render.View(pbox, {
        key = "Personal",
        width = RIGHT_W - 6 - (4 + UI.ScrollGutter()),
        onClick = function()
            personalBox:Raw()
        end,
        context = function()
            return { markdown = true }
        end,
    })
    personalBox = Render.Bind(personalView, pscroll, personal)
    personal.refresh = function()
        personalBox:Update(Notes:Personal(), "personal")
    end
    controls[#controls + 1] = personal

    local psave = fitButton(makeButton(pf, "Save personal note", 170))
    psave:SetPoint("TOPLEFT", pbox, "BOTTOMLEFT", 0, -6)
    psave:SetScript("OnClick", function()
        if personal.loaded ~= nil and Notes:Personal() ~= personal.loaded then
            personal.loaded = Notes:Personal() -- seen: a second Save is your choice to replace it
            CRT:Print(TEXT.personalChangedUnder)
            return
        end
        personalBox:Saved()
        personal:ClearFocus()
        Notes:SetPersonal(personal:GetText())
        CRT:Print("Personal note saved.")
    end)
    -- the short label, so both buttons fit the column; right-aligned to the box, never past the page
    local ppop = fitButton(makeButton(pf, TEXT.popOutShort, 80))
    ppop:SetPoint("TOPRIGHT", pbox, "BOTTOMRIGHT", 0, -6)
    ppop:SetScript("OnClick", function()
        openEditor({ personal = true })
    end)
    -- Display my notes first: what you typed above your Mech Alerts reminders in the personal window
    local first = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    first:SetSize(24, 24)
    first:SetPoint("TOPLEFT", psave, "BOTTOMLEFT", -2, -2)
    local firstText = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    firstText:SetPoint("LEFT", first, "RIGHT", 2, 0)
    firstText:SetText("Display my notes first")
    UI.HelpRight(firstText, "Display my notes first", "Shows your personal note above your Mech Alerts reminders instead of under them.\n\nFormatting: # Heading, **bold**, - a bullet, --- a divider line. A pasted raid note shows as the boss and its timed lines, by phase.")
    first:SetScript("OnClick", function(self)
        Notes:SetPersonalFirst(self:GetChecked())
    end)
    first.refresh = function()
        first:SetChecked(Notes.PersonalFirst and Notes:PersonalFirst() or false)
    end
    controls[#controls + 1] = first
    -- Right, under the personal note: try the note in use. Next phase has its own row, since its text
    -- grows with the phase it starts ("Next phase (1.5)").
    top = top - 22 - 220 - 6 - 26 - 26 - 20
    local runLabel = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    runLabel:SetPoint("TOPLEFT", RIGHT_X, top)
    runLabel:SetText("Try it")
    UI.HelpRight(runLabel, "Try it", "Test run starts the selected note now, as if the boss was pulled. Next phase starts the next phase, intermissions included. Stop ends it.")

    local testRun = makeButton(pf, "Test run", 100)
    testRun:SetPoint("TOPLEFT", RIGHT_X, top - 24)
    testRun:SetScript("OnClick", function()
        local id = selected or Notes:Active()
        if id then
            Notes:SetActive(id)
            Engine:Start(Notes:Parsed(id), "test")
        end
    end)
    -- Named after the phase it starts, e.g. "Next phase (1.5)", so an intermission is not a surprise.
    local nextPhase = makeButton(pf, "Next phase", 176)
    nextPhase:SetPoint("TOPLEFT", testRun, "BOTTOMLEFT", 0, -6)
    nextPhase:SetScript("OnClick", function()
        local ph = Engine:NextPhase()
        CRT:Print(ph and ("Phase " .. ph .. " started.") or "No phase left to start, or nothing is running.")
    end)
    nextPhase.refresh = function()
        local ph = Engine:PeekNextPhase()
        nextPhase:SetText(ph and ("Next phase (" .. tostring(ph) .. ")") or "Next phase")
    end
    controls[#controls + 1] = nextPhase
    local stop = makeButton(pf, "Stop", 70)
    stop:SetPoint("LEFT", testRun, "RIGHT", 6, 0)
    stop:SetScript("OnClick", function()
        Engine:Stop()
    end)

    pf:SetScript("OnShow", refresh)
    Notes:OnChange(refresh)
    CRT.Bosses:OnRouteChange(refresh) -- the raid route, the note list's order
end

-- Tabs ---------------------------------------------------------------------------------------

-- The Phases tab (Notes/Phases.lua) was taken off the page; its triggers, shipped and saved, still
-- start the phases, and its file is kept so it can be put back or moved.
local TABS = {
    { key = "notes", label = "Notes" },
    { key = "reminders", label = "Mech Alerts" },
    { key = "markers", label = "Marker macros" },
    { key = "alerts", label = "Alert Settings" },
    { key = "settings", label = "Notes Settings" },
}
local tabButtons, tabFrames, built = {}, {}, {}
local currentTab = "notes"

local function selectTab(key)
    if not tabFrames[key] then
        key = "notes"
    end
    currentTab = key
    if not built[key] then
        built[key] = true
        if key == "notes" then
            buildNotes(tabFrames[key])
        elseif key == "reminders" then
            CRT.NoteReminders.Build(tabFrames[key])
        elseif key == "markers" then
            CRT.MarkerMacrosTab.Build(tabFrames[key])
        elseif key == "alerts" then
            CRT.NoteAlertsTab.Build(tabFrames[key])
        else
            CRT.NoteSettings.Build(tabFrames[key])
        end
    end
    for _, tab in ipairs(TABS) do
        local on = tab.key == key
        tabFrames[tab.key]:SetShown(on)
        UI:SetTabSelected(tabButtons[tab.key], on)
    end
end

local function build(pf)
    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText("Raid Notes")

    for i, tab in ipairs(TABS) do
        local b = CreateFrame("Button", nil, pf, "BackdropTemplate")
        -- Five tabs across the page (UI.PAGE_W), Settings last.
        b:SetSize(164, 26)
        b:SetPoint("TOPLEFT", 8 + (i - 1) * 168, -36)
        skin(b, 0.4)
        b.sel = b:CreateTexture(nil, "ARTWORK")
        b.sel:SetAllPoints()
        b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
        b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
        b.text:SetPoint("CENTER")
        b.text:SetText(tab.label)
        b:SetScript("OnClick", function()
            selectTab(tab.key)
        end)
        tabButtons[tab.key] = b
        UI:RegisterTab(b)

        local f = CreateFrame("Frame", nil, pf)
        f:SetPoint("TOPLEFT", 0, -66)
        f:SetPoint("BOTTOMRIGHT", 0, 0)
        f:Hide()
        tabFrames[tab.key] = f
    end

    local line = pf:CreateTexture(nil, "ARTWORK")
    line:SetColorTexture(GRAY[1], GRAY[2], GRAY[3], 1)
    line:SetHeight(1)
    line:SetPoint("TOPLEFT", 8, -62)
    line:SetPoint("TOPRIGHT", -8, -62)

    pf:SetScript("OnShow", function()
        selectTab(currentTab)
    end)
end

UI:RegisterPage("notes", "Raid Notes", build)

-- Opens the Raid Notes page on a tab: "notes", "reminders" (Mech Alerts), "markers" (Marker macros), "alerts"
-- (Alert Settings) or "settings". TAB_H is a tab's height under the tabs, for the tabs that size themselves from it.
CRT.NotesPage = {
    TAB_H = TAB_H,
    -- the Notes tab's note text box and the detail lines under it, for the layout checks
    NOTE_BOX_TOP = NOTE_BOX_TOP, NOTE_BOX_H = NOTE_BOX_H, STATUS_LINE_H = STATUS_LINE_H, STATUS_LINES = STATUS_LINES,
    Open = function(tab)
        currentTab = tab
        UI:Show("notes")
        if tabFrames[tab] then
            selectTab(tab)
        end
    end,
}
