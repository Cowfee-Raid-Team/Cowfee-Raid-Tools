local ADDON, CRT = ...

-- The Assignment highlights page (Highlights/Data.lua), in the side menu's Modules group after Interrupts. Settings
-- only, so no tabs: Use assignment highlights (the module's switch, off by default; General Settings > Modules has the
-- same switch), then Highlight my name, Highlight my group
-- and Glow when a line with me changes, greyed while the switch is off, and Preview highlights.

local UI = CRT.UI
local H = CRT.NoteHighlights

-- Every word on this page, in one place so the wording is easy to change.
local TEXT = {
    title = "Assignment highlights",
    enable = "Use assignment highlights",
    enableHelp = "In the raid note windows, the lines that name you or your raid group get a band behind them, with your name or group in the theme's accent colour. When a new version of the same note changes what you do, the line glows for a few seconds and says Added, Removed or Moved. A line you were taken off that is gone shows faded for those seconds. Lines about others stay as they are.",
    name = "Highlight my name",
    group = "Highlight my group (G3, group 3)",
    glow = "Glow when a line with me changes",
    preview = "Preview highlights",
    previewTip = "Shows the assignments window with a sample note that names you and your group. Other previews stay as they are.",
    previewOff = "Tick Use assignment highlights first.",
}
CRT.HighlightsPage = { TEXT = TEXT }

-- Where things sit: the switch under the title, the three options indented under it, then the preview button.
local TOP = -40
local ROW_H = 24
local INDENT = 24
local PREVIEW_GAP = 16

local page
local controls = {}

local function refresh()
    if not page or not page:IsShown() then
        return
    end
    for _, control in ipairs(controls) do
        control.refresh()
    end
end

local function checkRow(pf, x, y, text)
    local check = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    check:SetPoint("TOPLEFT", x, y)
    check.label = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    check.label:SetPoint("LEFT", check, "RIGHT", 1, 0)
    check.label:SetText(text)
    return check
end

local function enabled()
    return H:Enabled()
end

-- One of the three options: a check for CRTDB.highlights[field], greyed while the module is off.
local function option(pf, y, field, text)
    local check = checkRow(pf, 6 + INDENT, y, text)
    check:SetScript("OnClick", function(self)
        H.Settings()[field] = self:GetChecked() and true or false
        H:Changed()
        refresh()
    end)
    check.refresh = function()
        local on = enabled()
        check:SetChecked(H.Settings()[field] and true or false)
        check:SetEnabled(on)
        check.label:SetFontObject(on and CRTFontSmall or CRTFontDisableSmall)
    end
    controls[#controls + 1] = check
    return check
end

local function build(pf)
    page = pf

    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    title:SetPoint("TOPLEFT", 8, -8)
    title:SetText(TEXT.title)

    local enable = checkRow(pf, 6, TOP, TEXT.enable)
    enable:SetScript("OnClick", function(self)
        H:SetEnabled(self:GetChecked())
        refresh()
    end)
    enable.refresh = function()
        enable:SetChecked(enabled() and true or false)
    end
    controls[#controls + 1] = enable
    UI.HelpRight(enable.label, TEXT.enable, TEXT.enableHelp)
    page.enable = enable

    page.name = option(pf, TOP - ROW_H, "name", TEXT.name)
    page.group = option(pf, TOP - ROW_H * 2, "group", TEXT.group)
    page.glow = option(pf, TOP - ROW_H * 3, "glow", TEXT.glow)

    local preview = UI.PreviewButton(pf, TEXT.preview, { H.PREVIEW_KEY }, { tooltip = TEXT.previewTip, enabledIf = function()
        return enabled(), TEXT.previewOff
    end })
    preview:SetPoint("TOPLEFT", 8, TOP - ROW_H * 4 - PREVIEW_GAP)
    controls[#controls + 1] = preview
    page.preview = preview

    pf:SetScript("OnShow", refresh)
    refresh()
end

UI:RegisterPage("highlights", TEXT.title, build)
