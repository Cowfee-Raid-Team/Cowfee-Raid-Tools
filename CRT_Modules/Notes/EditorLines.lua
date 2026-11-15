local ADDON, CRT = ...

-- The note editor's timed lines, deleted (Notes/EditorWindow.lua; #1294, Alex 2026-11-15). A timed line is never
-- edited in the editor, but it can go:
--   right-click a timed line   Delete line, and Delete all "<text>" lines for <player> (the same players and text, any
--                              time and phase: Check.SameLines), the second asked first with the lines listed
--   click a timed line         selects it; Shift-click selects every timed line from the last one clicked; Ctrl-click
--                              adds or removes one. Delete selected (in the footer, while lines are selected) asks
--                              first with the lines listed
-- A confirmation lists the lines grouped as the note check does (EC.GroupList: "Lulu: Grab side green orb, 6 lines (P1
-- 0:07 to 3:40)") and says how many are an Assign block's ("2 of these are in Orb Carriers P1."): a block line deleted
-- is that cast left out for its row, which the block keeps (a cast with no lines is deliberate, #1288). Every delete is
-- Check.RemoveLines on the session's text through Editor.ApplyText: every other line byte for byte, nothing written
-- until Save. The selection goes with any change to the text, and on Save. A note you can't change: no selection, and
-- the menu's items greyed with the reason.
-- Called by the editor:
--   ELn.Click(f, button)     a mouse press on a timed line's row frame
--   ELn.Paint(f, i)          a timed line's row drawn: tinted when selected (the theme's heading colour: the style
--                            guide's "a selected row's tint")
--   ELn.BuildButton(parent)  Delete selected, hidden; ELn.RefreshButton() shows it while lines are selected and
--                            returns whether it shows
--   ELn.Selected()           the selected line numbers, sorted
--   ELn.Clear()              no selection

local UI = CRT.UI
local Check = CRT.NoteCheck
local Editor = CRT.NoteEditor
local W = Editor.state

local ELn = {}
CRT.NoteEditorLines = ELn

-- Every word of it, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    deleteLine = "Delete line",
    deleteAll = "Delete all \"%s\" lines for %s",
    deleteSelected = "Delete selected (%d)",
    confirmOne = "Delete 1 line from the note?\n%s",
    confirm = "Delete %d lines from the note?\n%s",
    inBlockOne = "1 of these is in %s. That cast is left out for its row.",
    inBlock = "%d of these are in %s. Those casts are left out for their rows.",
    deleteButton = "Delete",
    deletedOne = "Deleted 1 line.",
    deleted = "Deleted %d lines.",
}
ELn.TEXT = TEXT

local L = { buttonH = 24, tint = 0.18 }

-- The selection: line numbers (a set), the line Shift-click counts from, and the text it was made on (another text:
-- gone).
local S = { set = {}, anchor = nil, text = nil }
ELn.state = S

local function readOnly()
    return W.session == nil or W.session.readOnly
end

-- Why the note can't be changed, for the greyed menu items.
local function whyReadOnly()
    local _, why = CRT.Notes:CanEditRaid()
    return why
end

function ELn.Clear()
    S.set, S.anchor, S.text = {}, nil, nil
end

-- The selection, dropped when the text changed since it was made.
local function current()
    if S.text and not (W.session and W.session:Text() == S.text) then
        ELn.Clear()
    end
    return S.set
end

function ELn.Selected()
    local out = {}
    for i in pairs(current()) do
        out[#out + 1] = i
    end
    table.sort(out)
    return out
end

local function isTimer(i)
    local row = W.session and W.session.rows[i]
    return row ~= nil and row.kind == "timer"
end

-- Deleting ---------------------------------------------------------------------------------------------------------

-- What the confirmation says: how many, the lines grouped, and the blocks they are in.
local function confirmText(list)
    local n = #list
    local EC = CRT.NoteEditorCheck
    local listed = EC and EC.GroupList(list) or ""
    local out = { n == 1 and string.format(TEXT.confirmOne, listed) or string.format(TEXT.confirm, n, listed) }
    for _, b in ipairs(Check.InBlocks(W.session, list)) do
        out[#out + 1] = b.n == 1 and string.format(TEXT.inBlockOne, b.name) or string.format(TEXT.inBlock, b.n, b.name)
    end
    local text = table.concat(out, "\n")
    return CRT.MarkerText and CRT.MarkerText(text) or text
end

-- Deletes the lines from the session, asked first when `ask` (or when one is an Assign block's); nothing changes
-- unless the text is the same at Accept.
local function delete(list, ask)
    local s = W.session
    if not s or readOnly() or #list == 0 then
        return false
    end
    local text = s:Text()
    local function go()
        if not (W.session and not readOnly() and W.session:Text() == text) then
            return
        end
        Editor.ApplyText(Check.RemoveLines(text, list))
        ELn.Clear()
        W.notice = UI.GoodText(#list == 1 and TEXT.deletedOne or string.format(TEXT.deleted, #list))
        Editor.Refresh()
    end
    ask = ask or #Check.InBlocks(s, list) > 0
    if not (ask and StaticPopup_ShowCustomGenericConfirmation) then
        go()
        return true
    end
    UI.LiftOver(UI.ShownPopup(StaticPopup_ShowCustomGenericConfirmation({
        text = confirmText(list),
        acceptText = TEXT.deleteButton,
        cancelText = CANCEL,
        callback = go,
    }), "GENERIC_CONFIRMATION"))
    return true
end
ELn.Delete = delete

-- The right-click menu ---------------------------------------------------------------------------------------------

-- A menu item, greyed with the reason on a note you can't change.
local function item(root, label, fn)
    local b = root:CreateButton(label, fn)
    if readOnly() then
        b:SetEnabled(false)
        local why = whyReadOnly()
        if why and b.SetTooltip and GameTooltip_AddNormalLine then
            b:SetTooltip(function(tooltip)
                GameTooltip_AddNormalLine(tooltip, why)
            end)
        end
    end
    return b
end

local function menuFill(i)
    return function(root)
        local s = W.session
        local row = s and s.rows[i]
        if not (row and row.kind == "timer") then
            return
        end
        item(root, TEXT.deleteLine, function()
            delete({ i }, false)
        end)
        local same = Check.SameLines(s, i)
        local text = row.timer.text or ""
        local who = table.concat(s:TimerNames(i), " ")
        if text ~= "" and who ~= "" and #same > 1 then
            local label = string.format(TEXT.deleteAll, text, who)
            item(root, CRT.MarkerText and CRT.MarkerText(label) or label, function()
                delete(Check.SameLines(W.session, i), true)
            end)
        end
    end
end
ELn.MenuFill = menuFill

-- Clicks ----------------------------------------------------------------------------------------------------------

local function shift()
    return IsShiftKeyDown and IsShiftKeyDown() and true or false
end

local function ctrl()
    return IsControlKeyDown and IsControlKeyDown() and true or false
end

-- Left: select (Shift: a range of timed lines from the last click; Ctrl: add or remove one). Right: the menu.
function ELn.Click(f, button)
    local i = f and f.index
    if not (i and isTimer(i)) then
        return
    end
    if button == "RightButton" then
        UI.ContextMenu(f, menuFill(i))
        return
    end
    if readOnly() then
        return
    end
    local set = current()
    if shift() and S.anchor and isTimer(S.anchor) then
        local from, to = math.min(S.anchor, i), math.max(S.anchor, i)
        if not ctrl() then
            set = {}
        end
        for j = from, to do
            if isTimer(j) then
                set[j] = true
            end
        end
    elseif ctrl() then
        set[i] = (not set[i]) or nil
        S.anchor = i
    else
        -- the only line selected, clicked again: none
        local n = 0
        for _ in pairs(set) do
            n = n + 1
        end
        local only = set[i] and n == 1
        set = {}
        if not only then
            set[i] = true
        end
        S.anchor = i
    end
    S.set, S.text = set, W.session:Text()
    Editor.Refresh()
end

-- A timed line's row: the selected ones at full strength, tinted in the theme's heading colour.
function ELn.Paint(f, i)
    if not current()[i] then
        return
    end
    f:SetAlpha(1)
    f:SetBackdropColor(UI.Color("heading", L.tint))
    f:SetBackdropBorderColor(UI.Color("heading", 0.6))
end

-- Delete selected --------------------------------------------------------------------------------------------------

local function label(button, text)
    button:SetText(text)
    local fs = button.GetFontString and button:GetFontString()
    button:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
end

function ELn.BuildButton(parent)
    local b = UI.PanelButton(parent, string.format(TEXT.deleteSelected, 0), L.buttonH, function()
        delete(ELn.Selected(), true)
    end)
    b:Hide()
    S.button = b
    return b
end

function ELn.RefreshButton()
    local b = S.button
    if not b then
        return false
    end
    local n = #ELn.Selected()
    local on = n > 0 and not readOnly() and not W.assignOn
    b:SetShown(on)
    if on then
        label(b, string.format(TEXT.deleteSelected, n))
    end
    return on
end
