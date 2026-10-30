local ADDON, CRT = ...

-- The note editor's Add assignment (Notes/EditorWindow.lua): the same assignment block as the Mech Alerts Assign tab
-- (Notes/Assign.lua, edited in Notes/AssignBlock.lua), added to the note being edited. In place of the rows, on the
-- left side:
--   Assignment   New assignment, a block the note has already, or a group list with timer lines that follow it
--                (a pasted planner note, Assign.Candidates) to make into a block
--   Timers       None (names only), Typed times, or one of the boss's mechanics on its ability timeline for the note's
--                difficulty (its casts)
--   Done         back to the rows
-- then the block editor (Name, Times, rows, + Row, Quick fill), with the editor's own palette on the right. Each change
-- is written into the editor's session (its text, as Save will write it), so Raw text and Save follow; nothing reaches
-- the note until Save, which links the blocks' timer lines to their rows (Assign.LinkAll). A name another block or a
-- typed list of the note has is refused, with the reason (Assign.KeyTaken). Making a typed list a block asks first,
-- saying what changes (Assign.AdoptChanges). When a note opens with such lists, a banner over the rows offers it.
-- Called by the editor:
--   EA.Build(left)   makes the view, hidden, and the banner
--   EA.Toggle()      Add assignment: opens the view (on the row selected for Quick fill's block, if it is one), or
--                    closes it
--   EA.Refresh()     redraws it from the session
--   EA.RefreshBanner(width, top)   the banner's height (0 hidden), under the Link banner
--   EA.Close()       back to the rows

local UI = CRT.UI
local Notes = CRT.Notes
local Model = CRT.NoteEditModel
local Assign = CRT.NoteAssign
local Editor = CRT.NoteEditor
local W = Editor.state

local EA = {}
CRT.NoteEditorAssign = EA

-- Every word of the view, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    assignment = "Assignment",
    newBlock = "New assignment",
    fromRows = "Make an Assign block from %s",
    timers = "Timers",
    none = "None (names only)",
    typed = "Typed times",
    mechanics = "Mechanics",
    done = "Done",
    remove = "Remove assignment",
    removeTip = "Takes this assignment out of the note, with its timer lines and the blank line before it.",
    removeConfirm = "Take the assignment '%s' out of the note?",
    removeButton = "Remove",
    removed = "Removed %s.",
    badTimes = "The times don't read: %s",
    keyTaken = "The note already has an assignment or a group list named %s. Pick another name.",
    adoptTitle = "Make an Assign block from %s?",
    adoptLines = "Its %d timer lines become the block's lines.",
    adoptTexts = "%s: the lines' different texts become one text per row.",
    adoptDropped = "%d lines lose their colours and other settings.",
    adoptOff = "%d lines on no cast stay as they are.",
    adoptButton = "Make block",
    adoptGone = "The note changed: that group list isn't there any more.",
    bannerOne = "%s has timer lines under its rows. Make it an Assign block to change it in one place?",
    bannerMany = "%d group lists have timer lines under their rows (%s). Make one an Assign block?",
    bannerMake = "Make an Assign block",
    bannerLater = "Not now",
    timersHelp = "None: only the heading and the rows go in the note, for names with no timers. Typed times: type the times below. A mechanic: its casts on the boss's ability timeline for this note's difficulty; each row gets a timer line on the casts it is on.\n\nAssignment picks the block to edit: a new one, one the note has, or a group list with timer lines under it (such as a pasted note) to make into a block.",
}
EA.TEXT = TEXT

-- Assignment, then Timers under it, each a dropdown row (UI.CONTROL_ROW_H); the block editor under them
local L = { rowH = 30, topH = 64, labelW = 80, dropW = 220 }

-- The view's state: the block on show, its key in the session's text (nil before the first write), and its timers
-- ("none", "typed" or a mechanic's index in A.mechs).
local A = { timers = "none", mechs = {} }
EA.state = A

local function readOnly()
    return W.session == nil or W.session.readOnly
end

-- The note being edited, or nil (the personal note).
local function record()
    return W.source and not W.source.personal and Notes:Get(W.source.id) or nil
end

local function noteKey()
    return W.source and (W.source.personal and "personal" or W.source.id)
end

-- The boss's mechanics with casts on its ability timeline for the note's difficulty: { name, spellID, casts }.
local function mechanics()
    local rec = record()
    local enc = rec and rec.encounterID
    local Ref, Reminders, T = CRT.TimelineReference, CRT.AlertReminders, CRT.Timeline
    if not (type(enc) == "number" and Ref and Reminders) then
        return {}
    end
    local group = T and T.GroupFor and rec.difficulty and T:GroupFor(rec.difficulty) or "nh"
    local ok, entries = pcall(Ref.ForBoss, Ref, enc, rec.name)
    if not ok or type(entries) ~= "table" then
        return {}
    end
    local mine = Ref:ForGroup(entries, group)
    local entry = mine[1] or entries[1]
    local out = {}
    for _, row in ipairs(entry and entry.ref and entry.ref.rows or {}) do
        if type(row.name) == "string" and row.name ~= "" then
            local probe = { spellID = row.spellID, text = row.name, boss = rec.name }
            local okT, casts = pcall(Reminders.Times, Reminders, enc, probe, entry.ref, group)
            if okT and type(casts) == "table" and #casts > 0 then
                out[#out + 1] = { name = row.name, spellID = row.spellID, casts = casts }
            end
        end
    end
    return out
end

-- The times the block's lines go on, and whether they are typed.
local function times()
    if A.timers == "typed" then
        return (A.block and A.block.times) or {}, true
    end
    local m = A.mechs[A.timers]
    return m and m.casts or {}, false
end

-- Writing into the session -------------------------------------------------------------------------------------------

-- The session's text with the block written in it, as a new session (its base the saved text, so it stays unsaved).
local function apply(text)
    local s = W.session
    local quick, selected = s.quickFill, s.selected
    W.session = Model.New(text, { markdown = s.markdown, readOnly = s.readOnly, base = s.base })
    W.session:SetQuickFill(quick)
    W.session.selected = selected
end

-- The mechanic picked in Timers, as its key on the block's heading (for:), or nil.
local function mechKey()
    local m = A.mechs[A.timers]
    return m and CRT.MechNote.Key(m.spellID, m.name) or nil
end

-- Writes the block into the session. False, with the reason on the status line, when its name is another block's or
-- a typed list's in the note.
local function write()
    local b = A.block
    if not b or readOnly() then
        return false
    end
    local key = Assign.Key(b.name)
    local text = W.session:Text()
    if Assign.KeyTaken(text, key, A.key) then
        W.notice = UI.BadText(string.format(TEXT.keyTaken, Assign.CleanName(b.name)))
        return false
    end
    local list, typed = times()
    local lines = Assign.Lines(b, (typed or A.timers ~= "none") and list or nil,
        { key = key, spellID = b.spellID, mech = mechKey() })
    local old = A.key
    A.key = key
    apply(Assign.Replace(text, key, lines, old))
    return true
end

local function changed(kind)
    local b = A.block
    if not b then
        return
    end
    if kind == "times" then
        local text = CRT.AlertDraft and CRT.AlertDraft.trim(A.ui.timesEdit:GetText()) or ""
        if text == "" then
            b.times = nil
        else
            local list, err = CRT.AlertReminders.ParseTimes(text)
            if not list then
                W.notice = UI.BadText(string.format(TEXT.badTimes, tostring(err)))
                Editor.Refresh()
                return
            end
            b.times = Assign.SortTimes(list)
        end
    end
    W.notice = nil
    write()
    Editor.Refresh()
end
EA.Write = write

-- Picking what to edit -----------------------------------------------------------------------------------------------

-- The timers a block read from the text has: the mechanic its heading names, else typed times, else none.
local function timersFor(b)
    for i, m in ipairs(A.mechs) do
        if b.mech and CRT.MechNote.Key(m.spellID, m.name) == b.mech then
            return i
        end
    end
    return b.times and "typed" or "none"
end

local function openBlock(key)
    local b = Assign.Read(W.session:Text(), key, nil)
    if not b then
        return false
    end
    A.timers = timersFor(b)
    local m = A.mechs[A.timers]
    if m then
        b = Assign.Read(W.session:Text(), key, m.casts) or b
        b.times = nil
    end
    A.block, A.key = b, key
    return true
end

-- A new block, "Assignment n" with the first n whose name the note has free.
local function newBlock()
    local text, n = W.session:Text(), 1
    local name
    repeat
        name = TEXT.assignment .. " " .. n
        n = n + 1
    until not Assign.KeyTaken(text, Assign.Key(name))
    A.block, A.key = Assign.NewBlock(name), nil
    A.timers = "none"
end

-- A group list made into a block (Assign.Adopt), against the timers picked (a mechanic's casts, else the lines' own).
local function adopt(heading)
    local m = A.mechs[A.timers]
    local text, b = Assign.Adopt(W.session:Text(), heading, m and m.casts or nil,
        { spellID = m and m.spellID or nil, mech = mechKey() })
    if not text then
        return
    end
    apply(text)
    A.block, A.key = b, b.key
    if not m then
        A.timers = b.times and "typed" or "none"
    end
    W.assignOn = true
    Editor.Refresh()
end

-- What making the list a block changes, for the confirmation.
local function adoptText(heading)
    local m = A.mechs[A.timers]
    local c = Assign.AdoptChanges(W.session:Text(), heading, m and m.casts or nil, CRT.NoteLinks.Saved(noteKey()))
    if not c then
        return nil
    end
    local out = { string.format(TEXT.adoptTitle, c.name), string.format(TEXT.adoptLines, c.lines) }
    if #c.texts > 0 then
        out[#out + 1] = string.format(TEXT.adoptTexts, table.concat(c.texts, ", "))
    end
    if c.dropped > 0 then
        out[#out + 1] = string.format(TEXT.adoptDropped, c.dropped)
    end
    if c.off > 0 then
        out[#out + 1] = string.format(TEXT.adoptOff, c.off)
    end
    return table.concat(out, "\n")
end

-- The name of the group list at that line, while it is still one (Assign.Candidates), else nil.
local function candidateName(heading)
    local s = W.session
    for _, c in ipairs(s and Assign.Candidates(s:Text(), CRT.NoteLinks.Saved(noteKey())) or {}) do
        if c.heading == heading then
            return c.name
        end
    end
end

-- Make an Assign block: asks first, listing what changes; nothing changes until it is accepted, and then only when
-- that line is still the same group list (the note may have changed meanwhile).
function EA.AskAdopt(heading)
    local text = adoptText(heading)
    local name = candidateName(heading)
    if not (text and name) or readOnly() then
        return false
    end
    local function accept()
        if not (W.session and not readOnly()) then
            return
        end
        if candidateName(heading) ~= name then
            W.notice = UI.BadText(TEXT.adoptGone)
            Editor.Refresh()
            return
        end
        adopt(heading)
    end
    if not StaticPopup_ShowCustomGenericConfirmation then
        accept()
        return true
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = text,
        acceptText = TEXT.adoptButton,
        cancelText = CANCEL,
        callback = accept,
    }), "GENERIC_CONFIRMATION"))
    return true
end

-- The Assignment dropdown's choices: new, the note's blocks, then the group lists to make into one.
local function choices()
    local out = { { key = "new", label = TEXT.newBlock } }
    local text = W.session and W.session:Text() or ""
    for _, key in ipairs(Assign.Keys(text)) do
        local b = Assign.Read(text, key)
        out[#out + 1] = { key = "b:" .. key, label = b and b.name or key }
    end
    for _, c in ipairs(Assign.Candidates(text, CRT.NoteLinks.Saved(noteKey()))) do
        out[#out + 1] = { key = "c:" .. c.heading, label = string.format(TEXT.fromRows, c.name) }
    end
    return out
end

local function pick(key)
    if readOnly() then
        return
    end
    A.ui:Flush()
    if key == "new" then
        newBlock()
    elseif key:find("^b:") then
        openBlock(key:sub(3))
    elseif key:find("^c:") then
        EA.AskAdopt(tonumber(key:sub(3)))
    end
    Editor.Refresh()
end

-- Remove assignment: the block, its timer lines and the blank line before it (Assign.Replace) taken out of the session,
-- after a confirmation. The view goes back to New assignment; the editor shows the change unsaved.
function EA.AskRemove()
    local key, b = A.key, A.block
    if not (key and b) or readOnly() then
        return false
    end
    local name = Assign.CleanName(b.name)
    local function go()
        if not (W.session and not readOnly()) or not Assign.Read(W.session:Text(), key) then
            return
        end
        A.ui:Flush()
        local old = W.session:Text()
        local text = Assign.Replace(old, key, {})
        -- a block that ended the note took its last line's end with it: the line before it ends the note again
        if not old:find("\n$") then
            text = text:gsub("\r?\n$", "")
        end
        apply(text)
        newBlock()
        Editor.Refresh()
        W.notice = UI.GoodText(string.format(TEXT.removed, name))
        Editor.Refresh()
    end
    if not StaticPopup_ShowCustomGenericConfirmation then
        go()
        return true
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = string.format(TEXT.removeConfirm, name),
        acceptText = TEXT.removeButton,
        cancelText = CANCEL,
        showAlert = true,
        callback = go,
    }), "GENERIC_CONFIRMATION"))
    return true
end

-- The block of the row selected for Quick fill, if it is one: its marked heading's key.
local function selectedBlock()
    local s = W.session
    local i = s and s.selected
    while i and i > 0 and s.rows[i] and s.rows[i].kind == "label" do
        i = i - 1
    end
    local row = i and s.rows[i]
    return row and row.assign and row.assign.key or nil
end

-- The view ---------------------------------------------------------------------------------------------------------

function EA.Build(left)
    local f = CreateFrame("Frame", nil, left)
    f:SetAllPoints()
    f:Hide()
    W.assignFrame = f
    EA.BuildBanner(left) -- the banner over the rows (below)
    A.pick = UI.Dropdown(f, TEXT.assignment, {
        labelWidth = L.labelW, width = L.dropW,
        options = choices,
        get = function()
            -- the block on show, while the text has it; else New (a block not written yet)
            local text = W.session and W.session:Text() or ""
            for _, key in ipairs(A.key and Assign.Keys(text) or {}) do
                if key == A.key then
                    return "b:" .. key
                end
            end
            return "new"
        end,
        set = pick,
        enabledIf = function()
            return not readOnly()
        end,
    })
    A.pick:SetPoint("TOPLEFT", 0, 0)
    A.timersDrop = UI.Dropdown(f, TEXT.timers, {
        labelWidth = L.labelW, width = L.dropW, maxHeight = 300,
        options = function()
            local out = { { key = "none", label = TEXT.none }, { key = "typed", label = TEXT.typed } }
            if #A.mechs > 0 then
                out[#out + 1] = { title = true, label = TEXT.mechanics }
            end
            for i, m in ipairs(A.mechs) do
                out[#out + 1] = { key = i, label = m.name }
            end
            return out
        end,
        get = function()
            return A.timers
        end,
        set = function(key)
            if readOnly() or key == A.timers then
                return
            end
            A.ui:Flush()
            A.timers = key
            local m = A.mechs[key]
            if A.block then
                A.block.spellID = m and m.spellID or nil
                A.block.mech = mechKey() -- the heading names the mechanic picked, or none
                if key ~= "typed" then
                    A.block.times = nil
                end
            end
            changed("rows")
        end,
        enabledIf = function()
            return not readOnly()
        end,
    })
    A.timersDrop:SetPoint("TOPLEFT", 0, -L.rowH)
    UI.HelpRight(A.timersDrop, TEXT.timers, TEXT.timersHelp)
    A.ui = CRT.NoteAssignBlock.Build(f, {
        x = 0, y = -L.topH, width = 400, height = 300,
        state = W,
        names = { rows = "CowfeeRaidToolsNoteEditorAssignRows" },
        block = function()
            return A.block
        end,
        times = times,
        timesText = function()
            return (A.block and A.block.times) and CRT.AlertReminders.FormatTimes(A.block.times) or ""
        end,
        changed = changed,
        readOnly = readOnly,
    })
    -- Done, bottom right of the block, back to the rows
    A.done = UI.PanelButton(A.ui.content, TEXT.done, 22, function()
        EA.Close()
    end)
    A.done:SetPoint("BOTTOMRIGHT", 0, 0)
    -- Remove assignment, left of Done: only for a block the note has
    A.remove = UI.PanelButton(A.ui.content, TEXT.remove, 22, function()
        EA.AskRemove()
    end)
    A.remove:SetPoint("RIGHT", A.done, "LEFT", -6, 0)
    A.remove:Hide()
    if A.remove.SetMotionScriptsWhileDisabled then
        A.remove:SetMotionScriptsWhileDisabled(true)
    end
    A.remove:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
        GameTooltip:SetText(TEXT.remove, 1, 1, 1)
        GameTooltip:AddLine(TEXT.removeTip, 0.85, 0.85, 0.85, true)
        GameTooltip:Show()
    end)
    A.remove:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    W.assignDrag = CRT.NoteAssignBlock.DragOpts(A.ui)
    W.assignUI = A.ui
end

-- Sizes the block editor to the left side (the window can be resized).
local function layout()
    local c = A.ui.content
    local w = W.left and W.left:GetWidth() or 400
    local h = W.left and W.left:GetHeight() or 300
    c:SetSize(math.max(300, w), math.max(150, h - L.topH))
    A.ui.rowsWidth = math.max(280, w) - UI.ScrollGutter()
    A.ui.child:SetWidth(A.ui.rowsWidth)
end

function EA.Refresh()
    if not (W.assignOn and A.ui) then
        return
    end
    -- the session was loaded again (Save, a change from elsewhere): the block is read from it
    if A.key and not Assign.Read(W.session:Text(), A.key) then
        A.key = nil
    elseif A.key and not A.ui.pending then
        local m = A.mechs[A.timers]
        local b = Assign.Read(W.session:Text(), A.key, m and m.casts or nil)
        if b then
            b.spellID = b.spellID or (m and m.spellID)
            if m then
                b.times = nil
            end
            A.block = b
        end
    end
    layout()
    A.pick.refresh()
    A.timersDrop.refresh()
    A.ui:Refresh()
    A.remove:SetShown(A.key ~= nil)
    A.remove:SetEnabled(not readOnly())
    A.ui.status:SetText("")
end

function EA.Toggle()
    if W.assignOn then
        EA.Close()
        return
    end
    if not (W.session and A.ui) then
        return
    end
    A.mechs = mechanics()
    local key = selectedBlock()
    if not (key and openBlock(key)) then
        newBlock()
    end
    W.assignOn = true
    Editor.Refresh()
end

function EA.Close()
    if A.ui then
        A.ui:Flush()
    end
    Editor.CancelDrag()
    W.assignOn = false
    A.block, A.key = nil, nil
    Editor.Refresh()
end

-- The banner ---------------------------------------------------------------------------------------------------------
-- A note with group lists that timer lines follow (Assign.Candidates: a pasted planner note, say) says so over the rows,
-- under the Link banner, and offers to make the first one a block (asked first, EA.AskAdopt). Not now hides it until
-- the text changes. Not for a note you can't change, nor while Add assignment is open.

local BACKDROP = { bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 }
local BANNER = { pad = 6, gap = 4, buttonH = 22, buttonGap = 6, below = 6 }

function EA.BuildBanner(left)
    local b = CreateFrame("Frame", nil, left, "BackdropTemplate")
    b:SetBackdrop(BACKDROP)
    UI.Tint(b, "SetBackdropColor", "surface", 0.9)
    UI.Tint(b, "SetBackdropBorderColor", "border")
    b.title = b:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    b.title:SetJustifyH("LEFT")
    UI.Tint(b.title, "SetTextColor", "heading")
    b.make = UI.PanelButton(b, TEXT.bannerMake, BANNER.buttonH, function()
        local c = A.candidates and A.candidates[1]
        if c then
            A.mechs = mechanics()
            A.timers = "none"
            EA.AskAdopt(c.heading)
        end
    end)
    b.later = UI.PanelButton(b, TEXT.bannerLater, BANNER.buttonH, function()
        if W.session then
            A.dismissed = { key = noteKey(), text = W.session:Text() }
            Editor.Refresh()
        end
    end)
    b:Hide()
    A.banner = b
end

function EA.RefreshBanner(width, top)
    local b = A.banner
    local s = W.session
    if not b then
        return 0
    end
    A.candidates = s and not s.readOnly and not W.assignOn and Assign.Candidates(s:Text(), CRT.NoteLinks.Saved(noteKey())) or {}
    local d = A.dismissed
    if #A.candidates == 0 or (d and d.key == noteKey() and d.text == s:Text()) then
        b:Hide()
        return 0
    end
    local names = {}
    for i, c in ipairs(A.candidates) do
        names[i] = c.name
    end
    b:ClearAllPoints()
    b:SetPoint("TOPLEFT", 0, -(top or 0))
    b:SetWidth(width)
    b.title:ClearAllPoints()
    b.title:SetPoint("TOPLEFT", BANNER.pad, -BANNER.pad)
    b.title:SetWidth(width - 2 * BANNER.pad)
    b.title:SetText(#names == 1 and string.format(TEXT.bannerOne, names[1])
        or string.format(TEXT.bannerMany, #names, table.concat(names, ", ")))
    local y = BANNER.pad + math.ceil(b.title:GetStringHeight() or 14) + BANNER.gap
    b.make:ClearAllPoints()
    b.make:SetPoint("TOPLEFT", BANNER.pad, -y)
    b.later:ClearAllPoints()
    b.later:SetPoint("LEFT", b.make, "RIGHT", BANNER.buttonGap, 0)
    y = y + BANNER.buttonH + BANNER.pad
    b:SetHeight(y)
    b:Show()
    return y + BANNER.below
end

function EA.IsOpen()
    return W.assignOn == true
end
