local ADDON, CRT = ...

-- The one confirm and the one Undo (the UX rule "Lost work asks first; quick actions can be undone", Alex,
-- 2026-11-24, #1299). Deleting something the player can't get back asks once, through UI.Confirm; a quick action
-- that clears or removes acts at once and offers Undo for UNDO_SECONDS, through UI.UndoToast. No other confirm
-- styles: no two-click buttons, no typed names.
--
-- UI.Confirm(opts) shows the game's popup with CRT's own dialog (CONFIRM_POPUP), lifted over CRT's windows
-- (UI.LiftOver). True when it showed; with no popup to ask with nothing happens, so nothing is lost without the click.
--   text      what goes, the thing named in quotes: 'Delete the note "Nek'zali (Mythic)"?'
--   detail    what goes with it, on its own paragraph: "Its 5 saved versions go too. This can't be undone."
--   accept    the accept button, naming the action: "Delete note"
--   cancel    the other button (default the game's CANCEL)
--   onAccept  run once on accept; Cancel and Escape run nothing
--   danger    true shows the game's alert icon
-- The dialog: StaticPopupDialogs[key] with button1, button2, OnAccept(dialog, data), hideOnEscape, timeout 0,
-- whileDead, showAlert; StaticPopup_Show(key, text_arg1, text_arg2, data) returns the dialog (Gethe/wow-ui-source
-- live, Blizzard_StaticPopup/StaticPopup.lua, checked 2026-11-24). Its button labels and showAlert are read from the
-- dialog's table at each show (Blizzard_StaticPopup_Game/GameDialog.lua SetupButtons, SetupAlertIcon), so they are
-- set just before it; text "" shows text_arg1 as it is (SetText, not SetFormattedText), so a "%" in a name is safe.
-- Escape hides a hideOnEscape dialog after its OnCancel (StaticPopup_EscapePressed); this one has no OnCancel.
--
-- UI.UndoToast(opts) shows a small bar near the bottom of the window the action happened in, with the message and an
-- Undo button, for UNDO_SECONDS; a second toast replaces the first (whose action then stands). Returns the bar.
--   text      what happened: "Cleared the grid (24 names)."
--   onUndo    puts back exactly the state saved before the action; run at most once
--   owner     a region in the window the action happened in (UI.WindowOf); else the main window
-- UI.HideUndoToast() hides it, dropping its Undo.
-- The bar: the theme's surface with an accent edge on its left (Modern), the game's dark tooltip look with the same
-- accent edge (Classic); repainted when the look or theme changes.

local UI = CRT.UI

local CONFIRM_POPUP = "CRT_CONFIRM"
local UNDO_SECONDS = 10 -- how long Undo is offered
local TOAST = { height = 32, pad = 10, gap = 10, edge = 3, bottom = 12, button = 22, margin = 20, level = 100 }
local TEXT = { cancel = "Cancel", undo = "Undo" }
UI.CONFIRM_POPUP = CONFIRM_POPUP
UI.UNDO_SECONDS = UNDO_SECONDS
UI.UNDO_TOAST = TOAST

-- Confirm --------------------------------------------------------------------------------------------------------

local function dialog()
    local d = StaticPopupDialogs[CONFIRM_POPUP]
    if not d then
        d = {
            text = "", -- text_arg1 is shown as it is
            hideOnEscape = 1,
            timeout = 0,
            whileDead = 1,
            OnAccept = function(_, data)
                local fn = data and data.onAccept
                if fn then
                    data.onAccept = nil -- once
                    fn()
                end
            end,
        }
        StaticPopupDialogs[CONFIRM_POPUP] = d
    end
    return d
end

-- The popup's whole text: the question, then what goes with it.
function UI.ConfirmText(opts)
    local text = opts.text or ""
    if opts.detail and opts.detail ~= "" then
        text = text .. "\n\n" .. opts.detail
    end
    return text
end

function UI.Confirm(opts)
    if not (opts and StaticPopupDialogs and StaticPopup_Show) then
        return false
    end
    local d = dialog()
    d.button1 = opts.accept or OKAY or "OK"
    d.button2 = opts.cancel or CANCEL or TEXT.cancel
    d.showAlert = opts.danger and 1 or nil
    local ok, frame = pcall(StaticPopup_Show, CONFIRM_POPUP, UI.ConfirmText(opts), nil, { onAccept = opts.onAccept })
    if not ok or type(frame) ~= "table" then
        return false -- not shown (no free dialog): nothing to lift
    end
    UI.LiftOver(UI.ShownPopup(frame, CONFIRM_POPUP))
    return true
end

-- Undo toast -----------------------------------------------------------------------------------------------------

local toast -- the one bar, made on first use
local token = 0 -- bumped by every show and hide, so an old timer or Undo does nothing

local function paint(f)
    local modern = UI:IsModern()
    if modern then
        f:SetBackdropColor(UI.Color("surface", 0.97))
        f:SetBackdropBorderColor(UI.Color("border"))
    else
        f:SetBackdropColor(0, 0, 0, 0.92) -- the game's dark tooltip ground
        f:SetBackdropBorderColor(0.6, 0.6, 0.6, 1)
    end
    f.edge:SetColorTexture(UI.Color("accent"))
    f.text:SetTextColor(UI.Color("text"))
end

local function build()
    local f = CreateFrame("Frame", "CowfeeRaidToolsUndoToast", UIParent, "BackdropTemplate")
    f:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    f:SetHeight(TOAST.height)
    f:EnableMouse(true) -- clicks on the bar don't fall through to the page under it
    f.edge = f:CreateTexture(nil, "ARTWORK")
    f.edge:SetPoint("TOPLEFT", 1, -1)
    f.edge:SetPoint("BOTTOMLEFT", 1, 1)
    f.edge:SetWidth(TOAST.edge)
    f.text = f:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    f.text:SetPoint("LEFT", TOAST.pad + TOAST.edge, 0)
    f.text:SetJustifyH("LEFT")
    f.text:SetWordWrap(false)
    f.undo = UI.PanelButton(f, TEXT.undo, TOAST.button, function()
        local fn = f.onUndo
        UI.HideUndoToast()
        if fn then
            fn()
        end
    end)
    f.undo:SetPoint("RIGHT", -TOAST.pad, 0)
    f.crtSkin = function()
        paint(f)
    end
    UI.skinned[#UI.skinned + 1] = f
    if UI.OnTheme then
        UI:OnTheme(function()
            paint(f)
        end)
    end
    f:Hide()
    return f
end

function UI.HideUndoToast()
    token = token + 1
    if toast then
        toast.onUndo = nil
        toast:Hide()
    end
end

function UI.UndoToast(opts)
    opts = opts or {}
    toast = toast or build()
    UI.HideUndoToast() -- the one before goes, its action standing
    local win = (opts.owner and UI.WindowOf(opts.owner)) or UI.frame or UIParent
    toast:SetParent(win)
    toast:ClearAllPoints()
    toast:SetPoint("BOTTOM", win, "BOTTOM", 0, TOAST.bottom)
    if win.GetFrameLevel then
        toast:SetFrameLevel(win:GetFrameLevel() + TOAST.level)
    end
    toast.text:SetText(opts.text or "")
    -- as wide as the message and the button need, never wider than the window
    local want = TOAST.edge + 2 * TOAST.pad + (toast.text:GetStringWidth() or 0) + TOAST.gap + (toast.undo:GetWidth() or 0)
    local room = (win.GetWidth and win:GetWidth() or 0) - 2 * TOAST.margin
    local w = (room > 0 and want > room) and room or want
    toast:SetWidth(w)
    toast.text:SetWidth(math.max(1, w - TOAST.edge - 2 * TOAST.pad - TOAST.gap - (toast.undo:GetWidth() or 0)))
    toast.onUndo = opts.onUndo
    paint(toast)
    toast:Show()
    token = token + 1
    local mine = token
    C_Timer.After(UNDO_SECONDS, function()
        if mine == token then
            UI.HideUndoToast()
        end
    end)
    return toast
end
