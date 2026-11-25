local ADDON, CRT = ...

-- Undo and Redo in the note editor (Notes/EditorWindow.lua; #1309, Alex 2026-11-15): every change to the working copy
-- before Save can be stepped back and forward. In memory only, never saved.
--   How: it doesn't follow each action. After each change the editor redraws (Editor.Refresh), and EU.Track compares
--   the session's text with the text it last saw: when it differs, the text before goes on the undo list as one step.
--   So every way of changing the working copy is covered: a chip added, moved or removed (drag, Quick fill, x), the
--   timer lines that follow a row, Delete line, Delete all, Delete selected, Remove old lines, Remove stale lines, Make
--   all, Make an Assign block, Update block, the Link banner's fix, Add assignment's every edit and Remove assignment,
--   and a kick block's rows. An action names its step first (Editor.Step: "Delete 3 lines"); a change nobody named is
--   "Change". Undo and Redo put a step's text back as a new session (Editor.ApplyText: its base stays the saved text,
--   so it shows unsaved), and the block Add assignment showed then.
--   Typing (Add assignment's Name, Times and a row's label and text) is one step per burst: typing that pauses for no
--   more than BURST seconds joins the step before; a longer pause, the box letting go, Enter or any other change ends
--   it. (Raw text is read-only: it can't be typed in.)
--   A step's list is cleared by Save, Push note, closing the editor (saved or discarded) and opening another note
--   (each makes a new session, EU.Reset). A History restore while the editor shows the note with nothing unsaved is
--   one step (Editor.Restoring): Undo puts the text before it back, unsaved.
--   Keys: Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo, while the editor shows (the window takes the keyboard, passing
--   every key on to the game but the ones it acts on, with Frame:SetPropagateKeyboardInput). Never in combat: the window
--   lets go of the keyboard as combat starts (that call can't be made in combat). Inside the editor's own text boxes
--   (Raw text, Add assignment's) the same keys, when there is a step to take, end the typing and then step; with
--   nothing to take, the box keeps its focus and selection. The title strip keeps a long note name clear of the
--   header buttons (strip:SetTitleEnd, CRT_Core/UI/Window.lua).
-- Called by the editor:
--   EU.Build(win)          Undo and Redo in the title strip, the keys
--   EU.Track()             at the start of each Refresh: a changed text is a step
--   EU.Refresh()           the buttons, greyed with their reasons
--   EU.Reset()             a new session: no steps
--   EU.Label(kind, ...)    names the next change (TEXT[kind], formatted; kind .. "One" when the first value is 1)
--   EU.Typing(burst)       the next change is typing: { key, first, last } (the box's kind, its first and last key's
--                          GetTime()); EU.EndBurst() ends a burst
--   EU.Push(text, kind)    a step with that text before it (History's restore)
--   EU.Undo(), EU.Redo()   step; false when there was nothing to do
--   EU.CatchKeys(on), EU.KeyDown(frame, key), EU.BoxKey(box, key)   the keys
-- Game calls (warcraft.wiki.gg, read 2026-11-25): Frame:SetPropagateKeyboardInput (#nocombat since 10.1.5),
-- Frame:EnableKeyboard, OnKeyDown(self, key) (an EditBox gets it while it has the focus), GetCurrentKeyBoardFocus(),
-- IsControlKeyDown(), IsShiftKeyDown(), InCombatLockdown(), GetTime().

local UI = CRT.UI
local Notes = CRT.Notes
local Editor = CRT.NoteEditor
local W = Editor.state

local EU = {}
CRT.NoteEditorUndo = EU

-- Every word of it, in one place. Keep the keys, change the text in quotes, save, /reload.
-- Some keys below format two or more values (%s, %d) in a fixed order: a translation keeps that order (see Locale.lua).
local TEXT = CRT.Locale("Notes.EditorUndo", {
    undo = "Undo",
    redo = "Redo",
    undoStep = "Undo: %s",
    redoStep = "Redo: %s",
    undoKeys = "Ctrl+Z does it too.",
    redoKeys = "Ctrl+Y or Ctrl+Shift+Z does it too.",
    -- why a greyed control can't be used (UX rule 5), on its tooltip
    nothingUndo = "Nothing to undo yet.",
    nothingRedo = "Nothing to redo.",
    undone = "Undone: %s.",
    redone = "Redone: %s.",
    -- the steps, as the buttons' tooltips and the status line name them
    change = "Change",
    add = "Add %s",
    move = "Move %s",
    remove = "Remove %s",
    deleteOne = "Delete 1 line",
    delete = "Delete %d lines",
    removeOldOne = "Remove 1 old line",
    removeOld = "Remove %d old lines",
    removeStaleOne = "Remove 1 stale line",
    removeStale = "Remove %d stale lines",
    makeAllOne = "Make all (1 block)",
    makeAll = "Make all (%d blocks)",
    makeBlock = "Make an Assign block from %s",
    updateBlock = "Update %s",
    assign = "Change %s",
    typing = "Typing in %s",
    removeAssign = "Remove %s",
    linkFix = "Add %s to %s",
    restore = "Restore from History",
})
EU.TEXT = TEXT

local MAX = 50 -- steps kept: past it, the oldest goes
local BURST = 1 -- seconds: typing that pauses no longer is one step
EU.MAX, EU.BURST = MAX, BURST

-- past: the steps to undo, newest last; future: the steps to redo, next last. A step: { text (the working copy then),
-- key (the block Add assignment showed then, or nil), label }. last, lastKey: the text and block as Track last saw
-- them. pending: the next change's { label, burst }. burst: the typing step still open { key, step, at (its last key) }.
local U = { past = {}, future = {} }
EU.state = U

local function inCombat()
    return InCombatLockdown and InCombatLockdown() and true or false
end

local function now()
    return GetTime and GetTime() or 0
end

-- The block Add assignment shows, while it is open (its key in the text, nil for a block not written yet).
local function assignKey()
    local EA = CRT.NoteEditorAssign
    return (W.assignOn and EA and EA.state) and EA.state.key or nil
end

local function editable()
    return W.session ~= nil and not W.session.readOnly
end

-- Steps ------------------------------------------------------------------------------------------------------------

function EU.Reset()
    U.past, U.future, U.pending, U.burst = {}, {}, nil, nil
    U.last = W.session and W.session:Text() or nil
    U.lastKey = assignKey()
end

-- Contract: every Editor.Step (this) is followed by the change and then an Editor.Refresh, whose Track takes the
-- label (a refused change leaves the text as it was, and the label goes unused).
function EU.Label(kind, ...)
    local f = TEXT[kind] or TEXT.change
    if select("#", ...) > 0 and (...) == 1 and TEXT[kind .. "One"] then
        f = TEXT[kind .. "One"]
    end
    U.pending = { label = string.format(f, ...) }
end

function EU.Typing(burst)
    if U.pending and type(burst) == "table" then
        U.pending.burst = burst
    end
end

function EU.EndBurst()
    U.burst = nil
end

local function push(list, step)
    list[#list + 1] = step
    while #list > MAX do
        table.remove(list, 1)
    end
end

function EU.Push(text, kind)
    push(U.past, { text = text, label = TEXT[kind] or TEXT.change })
    U.future, U.burst = {}, nil
end

-- Whether this typing joins the open typing step: the same box's kind, nothing else since, no longer pause.
local function joins(b)
    local open = U.burst
    return b ~= nil and open ~= nil and open.key == b.key and open.step == U.past[#U.past]
        and type(b.first) == "number" and type(open.at) == "number" and b.first - open.at <= BURST
end

function EU.Track()
    local s = W.session
    if not s then
        return
    end
    local text, key = s:Text(), assignKey()
    local p = U.pending
    U.pending = nil
    if U.last ~= nil and not s.readOnly and text ~= U.last then
        local b = p and p.burst
        if joins(b) then
            U.burst.at = b.last or b.first
        else
            local step = { text = U.last, key = U.lastKey, label = p and p.label or TEXT.change }
            push(U.past, step)
            U.burst = b and { key = b.key, step = step, at = b.last or b.first } or nil
        end
        U.future = {}
    end
    U.last, U.lastKey = text, key
end

-- The box with the keyboard, when it is the editor's.
local function focusedBox()
    if not GetCurrentKeyBoardFocus then
        return nil
    end
    local ok, box = pcall(GetCurrentKeyBoardFocus)
    if not (ok and type(box) == "table") then
        return nil
    end
    local f = box
    while f do
        if f == W.window then
            return box
        end
        f = f.GetParent and f:GetParent() or nil
    end
    return nil
end

-- Before a step: a drag ended, a box of the editor let go (its typing written, as one step), anything changed since
-- the last redraw taken as a step, and the typing step closed.
local function settle()
    Editor.CancelDrag()
    local box = focusedBox()
    if box then
        box:ClearFocus()
    end
    local ui = W.assignUI
    if W.assignOn and ui and ui.pending then
        ui:Flush()
    end
    EU.Track()
    U.burst = nil
end

-- Puts a step's text back, the text now going on the other list.
local function apply(from, to, done)
    if not (editable() and W.window and W.window:IsShown()) then
        return false
    end
    settle()
    local step = table.remove(from)
    if not step then
        return false
    end
    push(to, { text = W.session:Text(), key = assignKey(), label = step.label })
    Editor.ApplyText(step.text)
    local EA = CRT.NoteEditorAssign
    if W.assignOn and EA and EA.Restored then
        EA.Restored(step.key) -- the block it showed then, read from the text put back
    end
    U.last, U.lastKey, U.pending = step.text, assignKey(), nil
    W.refused = nil
    W.notice = UI.GoodText(string.format(done, step.label))
    Editor.Refresh()
    return true
end

function EU.Undo()
    return apply(U.past, U.future, TEXT.undone)
end

function EU.Redo()
    return apply(U.future, U.past, TEXT.redone)
end

-- The buttons ----------------------------------------------------------------------------------------------------

local function refreshButton(b, opts, list, stepText, keys, nothing, title)
    local ok = editable() and #list > 0
    b:SetEnabled(ok)
    opts.tipTitle = ok and string.format(stepText, list[#list].label) or title
    opts.tipText = keys
    local reason = nothing
    if not editable() then
        local _, why = Notes:CanEditRaid()
        reason = why or nothing
    end
    UI.GreyWhy(b, ok, reason, title) -- says why it is greyed (UX rule 5)
end

function EU.Refresh()
    local b, r = U.undoButton, U.redoButton
    if not (b and r) then
        return
    end
    refreshButton(b, U.undoOpts, U.past, TEXT.undoStep, TEXT.undoKeys, TEXT.nothingUndo, TEXT.undo)
    refreshButton(r, U.redoOpts, U.future, TEXT.redoStep, TEXT.redoKeys, TEXT.nothingRedo, TEXT.redo)
    -- left of History, or of Reset where History hides (the personal note)
    local win = W.window
    local anchor = (W.history and W.history:IsShown()) and W.history or (win.reset or win.CloseButton)
    r:ClearAllPoints()
    r:SetPoint("RIGHT", anchor, "LEFT", -4, 0)
    if win.strip.Layout then
        win.strip:Layout() -- the title clear of the buttons, which may have changed (History's count)
    end
end

-- The keys -------------------------------------------------------------------------------------------------------

-- "undo" for Ctrl+Z, "redo" for Ctrl+Y and Ctrl+Shift+Z, else nil.
local function chord(key)
    if not (IsControlKeyDown and IsControlKeyDown()) then
        return nil
    end
    if key == "Z" then
        return (IsShiftKeyDown and IsShiftKeyDown()) and "redo" or "undo"
    end
    return key == "Y" and "redo" or nil
end

-- The window takes the keyboard while it shows, out of combat; every key passes on to the game unless it acts.
function EU.CatchKeys(on)
    local f = W.window
    if not (f and f.EnableKeyboard) then
        return
    end
    if on then
        if U.keysOn or inCombat() then
            return
        end
        if f.SetPropagateKeyboardInput then
            pcall(f.SetPropagateKeyboardInput, f, true)
        end
        pcall(f.EnableKeyboard, f, true)
        U.keysOn = true
    elseif U.keysOn then
        pcall(f.EnableKeyboard, f, false) -- a plain frame may let go in combat
        U.keysOn = false
    end
end

-- A key on the window: Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z with a step to take is kept from the game and steps; any other
-- key, or one with nothing to do, goes on. In combat nothing is kept or done (the window lets go of the keys then).
function EU.KeyDown(f, key)
    if inCombat() then
        return
    end
    local what = chord(key)
    local act = what ~= nil and editable() and focusedBox() == nil
        and #(what == "undo" and U.past or U.future) > 0
    if f.SetPropagateKeyboardInput then
        pcall(f.SetPropagateKeyboardInput, f, not act)
        -- a kept key passes keys on again at once (next frame), not only at the next key press
        if act and C_Timer and C_Timer.After then
            C_Timer.After(0, function()
                if not inCombat() then
                    pcall(f.SetPropagateKeyboardInput, f, true)
                end
            end)
        end
    end
    if act and what == "undo" then
        EU.Undo()
    elseif act then
        EU.Redo()
    end
end

-- A key in one of the editor's text boxes (it has the keyboard, so the game gets no key from it anyway): the same keys
-- let the box go, which ends its typing, then step.
function EU.BoxKey(box, key)
    local what = chord(key)
    -- nothing to step (or a note you can't change): the box keeps its focus and selection. Typing not written yet is
    -- something to undo: letting go of the box writes it as a step.
    local ui = W.assignUI
    local typed = what == "undo" and W.assignOn and ui ~= nil and ui.pending ~= nil
    if not (what and editable() and (typed or #(what == "undo" and U.past or U.future) > 0)) then
        return
    end
    if box and box.ClearFocus then
        box:ClearFocus()
    end
    if what == "undo" then
        EU.Undo()
    else
        EU.Redo()
    end
end

-- Building -------------------------------------------------------------------------------------------------------

local function button(win, label, opts, fn)
    local b = UI.HeaderButton(win.strip, label, fn, opts)
    if b.SetMotionScriptsWhileDisabled then
        b:SetMotionScriptsWhileDisabled(true) -- greyed, its tooltip still says why
    end
    return b
end

function EU.Build(win)
    U.undoOpts = { tipTitle = TEXT.undo, tipText = TEXT.undoKeys }
    U.redoOpts = { tipTitle = TEXT.redo, tipText = TEXT.redoKeys }
    U.redoButton = button(win, TEXT.redo, U.redoOpts, function()
        EU.Redo()
    end)
    U.undoButton = button(win, TEXT.undo, U.undoOpts, function()
        EU.Undo()
    end)
    U.redoButton:SetPoint("RIGHT", win.reset or win.CloseButton, "LEFT", -4, 0)
    U.undoButton:SetPoint("RIGHT", U.redoButton, "LEFT", -4, 0)
    W.undoButton, W.redoButton = U.undoButton, U.redoButton
    -- a long note name never runs under the header buttons: X, Reset, History, Redo, Undo, right to left
    if win.strip.SetTitleEnd then
        win.strip:SetTitleEnd(function()
            local out = {}
            for _, f in ipairs({ win.CloseButton or false, win.reset or false, W.history or false, U.redoButton, U.undoButton }) do
                if f then
                    out[#out + 1] = f
                end
            end
            return out
        end)
    end
    win:SetScript("OnKeyDown", EU.KeyDown)
    win:HookScript("OnShow", function()
        EU.CatchKeys(true)
    end)
    if W.raw then
        W.raw:SetScript("OnKeyDown", EU.BoxKey) -- Raw text: read-only, but it takes the keyboard to select and copy
    end
end

-- The window hid: it lets go of the keys; closed for good (saved, nothing unsaved, or discarded), no steps.
function EU.Hidden(closed)
    EU.CatchKeys(false)
    if closed then
        EU.Reset()
    end
end

-- Combat starting lets go of the keyboard, so a kept key can never hold the game's keys in a fight; it is taken back
-- when combat ends, while the editor shows.
function EU.Combat(event)
    if event == "PLAYER_REGEN_DISABLED" then
        EU.CatchKeys(false)
    elseif event == "PLAYER_REGEN_ENABLED" then
        EU.CatchKeys(W.window ~= nil and W.window:IsShown())
    end
end
