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
-- the note until Save. The timer lines are linked to their rows (Assign.Link), so the rows view shows them following.
-- Called by the editor:
--   EA.Build(left)   makes the view, hidden
--   EA.Toggle()      Add assignment: opens the view (on the row selected for Quick fill's block, if it is one), or
--                    closes it
--   EA.Refresh()     redraws it from the session
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
    badTimes = "The times don't read: %s",
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

local function write()
    local b = A.block
    if not b or readOnly() then
        return
    end
    local key = Assign.Key(b.name)
    local list, typed = times()
    local lines = Assign.Lines(b, (typed or A.timers ~= "none") and list or nil, { key = key, spellID = b.spellID })
    local text = Assign.Replace(W.session:Text(), key, lines, A.key)
    A.key = key
    apply(text)
    Assign.Link(noteKey(), text, key)
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

-- Picking what to edit -----------------------------------------------------------------------------------------------

-- The timers a block read from the text has: the mechanic its spell is, else typed times, else none.
local function timersFor(b)
    for i, m in ipairs(A.mechs) do
        if b.spellID and m.spellID == b.spellID then
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

local function newBlock()
    local base, n = TEXT.assignment, 1
    local taken = {}
    for _, key in ipairs(Assign.Keys(W.session:Text())) do
        taken[key] = true
    end
    local name
    repeat
        name = base .. " " .. n
        n = n + 1
    until not taken[Assign.Key(name)] and not Assign.Read(W.session:Text(), Assign.Key(name))
    A.block, A.key = Assign.NewBlock(name), nil
    A.timers = "none"
end

-- A group list made into a block (Assign.Adopt), against the timers picked (a mechanic's casts, else the lines' own).
local function adopt(heading)
    local m = A.mechs[A.timers]
    local text, b = Assign.Adopt(W.session:Text(), heading, m and m.casts or nil, { spellID = m and m.spellID or nil })
    if not text then
        return
    end
    apply(text)
    A.block, A.key = b, b.key
    if not m then
        A.timers = b.times and "typed" or "none"
    end
    Assign.Link(noteKey(), text, b.key)
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
        adopt(tonumber(key:sub(3)))
    end
    Editor.Refresh()
end

-- The block of the row selected for Quick fill, if it is one: its heading's key.
local function selectedBlock()
    local s = W.session
    local i = s and s.selected
    while i and i > 0 and s.rows[i] and s.rows[i].kind == "label" do
        i = i - 1
    end
    local row = i and s.rows[i]
    if row and row.kind == "heading" and Assign.Read(s:Text(), Assign.Key(row.text)) then
        return Assign.Key(row.text)
    end
end

-- The view ---------------------------------------------------------------------------------------------------------

function EA.Build(left)
    local f = CreateFrame("Frame", nil, left)
    f:SetAllPoints()
    f:Hide()
    W.assignFrame = f
    A.pick = UI.Dropdown(f, TEXT.assignment, {
        labelWidth = L.labelW, width = L.dropW,
        options = choices,
        get = function()
            return A.key and ("b:" .. A.key) or "new"
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

function EA.IsOpen()
    return W.assignOn == true
end
