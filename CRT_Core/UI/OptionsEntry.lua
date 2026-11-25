local ADDON, CRT = ...

-- CRT's entry in the game's Esc > Options > AddOns list (UX rule 10): one line on what CRT is, an Open Cowfee Raid
-- Tools button and "Or type /crt." No CRT setting is repeated there; they all stay in /crt.
-- The entry is a canvas layout category of the game's Settings API (Gethe/wow-ui-source live,
-- Blizzard_Settings_Shared/Blizzard_ImplementationReadme.lua and Blizzard_Settings.lua):
--   Settings.RegisterCanvasLayoutCategory(frame, name) returns the category (and its layout); the settings panel
--     parents the frame to its canvas, anchors it all over it and shows it while the category is picked
--   Settings.RegisterAddOnCategory(category) lists it under AddOns
--   SettingsPanel:Close(true) closes the panel without going back to the game menu (SettingsPanelMixin:Close,
--     Blizzard_SettingsPanel.lua; it asks first when the game has unapplied settings, leaving the panel up);
--     HideUIPanel is the fallback
-- Every call is guarded, so a client without them registers nothing and never errors.

local UI = CRT.UI
local Options = {}
CRT.OptionsEntry = Options

local TEXT = {
    name = "Cowfee Raid Tools",
    line = "Raid tools for groups, notes, ready checks, loot and ability timelines.",
    open = "Open Cowfee Raid Tools",
    orType = "Or type /crt.",
    closeFirst = "Close Options, then type /crt.",
}
Options.TEXT = TEXT

local L = { x = 16, top = -16, gap = 10, button = 24 }

-- The panel's OnHide, hooked once: opens the main window when the panel closes after asking to discard.
local function afterPanelHides()
    if Options.waiting then
        Options.waiting = false
        UI:Show()
    end
end

-- Closes the game's settings panel, then opens the main window. When the game asks first (unapplied settings), the
-- panel stays up: the window opens once it closes, never under it. In combat the panel is left alone (closing it
-- commits the game's settings and key bindings from addon code) and the window just opens.
function Options.Open()
    local panel = _G.SettingsPanel
    if InCombatLockdown() or not (panel and panel.IsShown and panel:IsShown()) then
        UI:Show()
        return
    end
    if not (panel.Close and pcall(panel.Close, panel, true)) and HideUIPanel then
        pcall(HideUIPanel, panel)
    end
    if panel:IsShown() then
        if not Options.hooked and panel.HookScript then
            Options.hooked = pcall(panel.HookScript, panel, "OnHide", afterPanelHides)
        end
        Options.waiting = Options.hooked and true or false
        if not Options.hooked then
            CRT:Print(TEXT.closeFirst)
        end
        return
    end
    UI:Show()
end

local function build()
    local f = CreateFrame("Frame")
    f:Hide()
    local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", L.x, L.top)
    title:SetText(TEXT.name)
    local line = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    line:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -L.gap)
    line:SetText(TEXT.line)
    local open = UI.PanelButton(f, TEXT.open, L.button, Options.Open)
    open:SetPoint("TOPLEFT", line, "BOTTOMLEFT", 0, -L.gap)
    local orType = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    orType:SetPoint("TOPLEFT", open, "BOTTOMLEFT", 0, -L.gap)
    orType:SetText(TEXT.orType)
    Options.view = { frame = f, title = title, line = line, open = open, orType = orType }
    return f
end

-- Registers the entry once. True when the game's Settings API took it.
function Options.Register()
    if Options.category then
        return true
    end
    local S = _G.Settings
    if not (S and S.RegisterCanvasLayoutCategory and S.RegisterAddOnCategory) then
        return false
    end
    local ok, category = pcall(function()
        return S.RegisterCanvasLayoutCategory(build(), TEXT.name)
    end)
    if not ok or not category then
        return false
    end
    if not pcall(S.RegisterAddOnCategory, category) then
        return false
    end
    Options.category = category
    return true
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
    Options.Register()
end)
