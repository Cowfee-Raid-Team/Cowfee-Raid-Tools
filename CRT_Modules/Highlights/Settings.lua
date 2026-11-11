local ADDON, CRT = ...

-- Assignment highlights' settings (Highlights/Data.lua), a section of Raid Notes > Notes Settings: Notes/Settings.lua
-- calls Build for its place, with its own check box, heading and refresh, so the section looks and greys like the rest
-- of the tab. Use assignment highlights (the one switch; General Settings > Modules has the same one), then Highlight
-- my name, Highlight my group, Glow when my assignment changes and which note windows show them, greyed while the
-- switch is off, and Preview highlights.

local UI = CRT.UI
local H = CRT.NoteHighlights

-- Every word of the section, in one place so the wording is easy to change.
local TEXT = {
    title = "Highlights",
    enable = "Use assignment highlights",
    enableHelp = "In the note windows ticked below, the lines that name you or your raid group get a band behind them, with your name or group in the theme's accent colour.\n\nWhen a new version of the same note changes your part, the line glows for a few seconds and says Added, Removed or Moved. A line you were taken off that is gone shows faded for those seconds. The personal note shows the bands only: you write it yourself.\n\nLines about others stay as they are.",
    -- the same switch on General Settings > Modules (UI/SettingsPage.lua), where nothing is below it
    generalHelp = "In the note windows you tick on Raid Notes > Notes Settings > Highlights, the lines that name you or your raid group get a band behind them, with your name or group in the theme's accent colour.\n\nWhen a new version of the same note changes your part, the line glows for a few seconds and says Added, Removed or Moved.\n\nThe same switch as on Raid Notes > Notes Settings > Highlights, where its other options are.",
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
local CHECK_W = 30 -- a check box and the gap before its label

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

local function windows()
    local s = H.Settings()
    if type(s.windows) ~= "table" then
        s.windows = {}
    end
    return s.windows
end

-- Builds the section at x, top on pf, width wide. page: the tab's helpers, { check, heading, refresh }:
--   check(parent, x, y, label, enabledIf, getter, setter) -> check, label   (Notes/Settings.lua's makeCheck, which
--                                                                            keeps the check in the tab's refresh)
--   heading(parent, x, y, text) -> font string
--   refresh()                                                               the tab's refresh
-- Returns a control whose refresh() greys Preview highlights with the switch (the tab keeps it with its own); its parts
-- are in .enable, .options (by field or window) and .preview.
local function build(pf, x, top, width, page)
    local section = { options = {} }
    local preview
    local function changed()
        H:Changed()
        page.refresh()
        if preview then
            preview.refresh()
        end
    end

    page.heading(pf, x, top, TEXT.title)

    local enable, enableText = page.check(pf, x - 4, top - 20, TEXT.enable, nil, enabled, function(on)
        H:SetEnabled(on)
        changed()
    end)
    enableText:SetWidth(width - CHECK_W - UI.HELP_SIZE - UI.HELP_GAP)
    UI.HelpRight(enable, TEXT.enable, TEXT.enableHelp)
    section.enable = enable

    for i, opt in ipairs(OPTIONS) do
        local check, label = page.check(pf, x - 4 + INDENT, top - 20 - i * ROW_H, opt.label, enabled, function()
            if opt.window then
                return windows()[opt.window] == true
            end
            return H.Settings()[opt.field] and true or false
        end, function(on)
            if opt.window then
                windows()[opt.window] = on
            else
                H.Settings()[opt.field] = on
            end
            changed()
        end)
        label:SetWidth(width - CHECK_W - INDENT)
        section.options[opt.window or opt.field] = check
    end

    preview = UI.PreviewButton(pf, TEXT.preview, { H.PREVIEW_KEY }, { tooltip = TEXT.previewTip, enabledIf = function()
        return enabled(), TEXT.previewOff
    end })
    preview:SetPoint("TOPLEFT", x, top - 20 - (#OPTIONS + 1) * ROW_H - PREVIEW_GAP)
    section.preview = preview
    section.refresh = preview.refresh
    return section
end

CRT.HighlightsSettings = { TEXT = TEXT, Build = build }
