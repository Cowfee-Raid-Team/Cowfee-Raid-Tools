local ADDON, CRT = ...

-- Assignment highlights' settings (Highlights/Data.lua), a section of Raid Notes > Notes Settings: Notes/Settings.lua
-- calls Build for its place. Use assignment highlights (the one switch; General Settings > Modules has the same one),
-- then Highlight my name, Highlight my group, Glow when my assignment changes and which note windows show them,
-- greyed while the switch is off, and Preview highlights.

local UI = CRT.UI
local H = CRT.NoteHighlights

-- Every word of the section, in one place so the wording is easy to change.
local TEXT = {
    title = "Highlights",
    enable = "Use assignment highlights",
    enableHelp = "In the note windows ticked below, the lines that name you or your raid group get a band behind them, with your name or group in the theme's accent colour. When a new version of the same note changes your part, the line glows for a few seconds and says Added, Removed or Moved. A line you were taken off that is gone shows faded for those seconds. Lines about others stay as they are.",
    name = "Highlight my name",
    group = "Highlight my group (G3, group 3)",
    glow = "Glow when my assignment changes",
    assignments = "Assignments window",
    timers = "Timer window",
    personal = "Personal note",
    preview = "Preview highlights",
    previewTip = "Shows the assignments window with a sample note that names you and your group, with one Added, Moved and Removed line. Other previews stay as they are.",
    previewOff = "Tick Use assignment highlights first.",
}

-- Where things sit, from the section's heading down: the switch, the options indented under it, the preview button.
local ROW_H = 24
local INDENT = 16
local PREVIEW_GAP = 8
local WHITE = { 1, 1, 1 }
local GREY = { 0.5, 0.5, 0.5 }

-- The options under the switch: a setting in CRTDB.highlights, or in highlights.windows.
local OPTIONS = {
    { field = "name", label = TEXT.name },
    { field = "group", label = TEXT.group },
    { field = "glow", label = TEXT.glow },
    { window = "assignments", label = TEXT.assignments },
    { window = "timers", label = TEXT.timers },
    { window = "personal", label = TEXT.personal },
}

local function enabled()
    return H:Enabled()
end

local function checkRow(pf, x, y, width, text)
    local check = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    check:SetPoint("TOPLEFT", x, y)
    check.label = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    check.label:SetPoint("LEFT", check, "RIGHT", 2, 0)
    check.label:SetWidth(width)
    check.label:SetJustifyH("LEFT")
    check.label:SetText(text)
    return check
end

local function windows()
    local s = H.Settings()
    if type(s.windows) ~= "table" then
        s.windows = {}
    end
    return s.windows
end

-- Builds the section at x, top on pf, width wide. Returns a control whose refresh() reads the settings again (the
-- Notes Settings tab calls it with its own); its parts are in .enable, .options (by field or window) and .preview.
local function build(pf, x, top, width)
    local section = { options = {} }
    local parts = {}
    local function refresh()
        for _, part in ipairs(parts) do
            part.refresh()
        end
    end
    section.refresh = refresh

    local title = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    title:SetPoint("TOPLEFT", x, top)
    title:SetText(TEXT.title)

    local enable = checkRow(pf, x - 4, top - 20, width - 30 - UI.HELP_SIZE - UI.HELP_GAP, TEXT.enable)
    enable:SetScript("OnClick", function(self)
        H:SetEnabled(self:GetChecked())
        refresh()
    end)
    enable.refresh = function()
        enable:SetChecked(enabled() and true or false)
    end
    parts[#parts + 1] = enable
    UI.HelpRight(enable, TEXT.enable, TEXT.enableHelp)
    section.enable = enable

    for i, opt in ipairs(OPTIONS) do
        local check = checkRow(pf, x - 4 + INDENT, top - 20 - i * ROW_H, width - 30 - INDENT, opt.label)
        local function get()
            if opt.window then
                return windows()[opt.window] == true
            end
            return H.Settings()[opt.field] and true or false
        end
        check:SetScript("OnClick", function(self)
            local on = self:GetChecked() and true or false
            if opt.window then
                windows()[opt.window] = on
            else
                H.Settings()[opt.field] = on
            end
            H:Changed()
            refresh()
        end)
        check.refresh = function()
            local on = enabled()
            check:SetChecked(get())
            check:SetEnabled(on)
            local c = on and WHITE or GREY
            check.label:SetTextColor(c[1], c[2], c[3])
        end
        parts[#parts + 1] = check
        section.options[opt.window or opt.field] = check
    end

    local preview = UI.PreviewButton(pf, TEXT.preview, { H.PREVIEW_KEY }, { tooltip = TEXT.previewTip, enabledIf = function()
        return enabled(), TEXT.previewOff
    end })
    preview:SetPoint("TOPLEFT", x, top - 20 - (#OPTIONS + 1) * ROW_H - PREVIEW_GAP)
    parts[#parts + 1] = preview
    section.preview = preview

    refresh()
    return section
end

CRT.HighlightsSettings = { TEXT = TEXT, Build = build }
