local ADDON, CRT = ...

-- Assignment highlights' settings (Highlights/Data.lua), a section of Raid Notes > Notes Settings: Notes/Settings.lua
-- calls Build for its place, with its own check box, heading and refresh, so the section looks and greys like the rest
-- of the tab. Use assignment highlights (the one switch), then Highlight my name, Highlight my group and Glow when my
-- assignment changes, greyed while the switch is off, and Preview highlights. Which note windows show them is a
-- Use highlights box in each window's column (WindowCheck, called by Notes/Settings.lua).

local UI = CRT.UI
local H = CRT.NoteHighlights

-- Every word of the section, in one place so the wording is easy to change.
local TEXT = {
    title = "Highlights",
    enable = "Use assignment highlights",
    enableHelp = "In the note windows whose Use highlights box is ticked (one in each window's column above), the lines that name you or your raid group get a band behind them, with your name or group in the theme's accent colour.\n\nWhen a new version of the same note changes your part, the line glows for a few seconds and says Added, Removed or Moved. A line you were taken off that is gone shows faded for those seconds. The personal note shows the bands only: you write it yourself.\n\nLines about others stay as they are.",
    -- the box in each note window's column (windowCheck below)
    windowLabel = "Use highlights",
    windowHelp = "Marks the lines that name you or your raid group in this window, with a band behind them.\n\nThe glow and the Added, Removed or Moved words show too when your part changes.\n\nGreyed out while the main switch is off: Raid Notes > Notes Settings > Highlights > Use assignment highlights.",
    windowHelpPersonal = "Marks the lines that name you or your raid group in this window, with a band behind them. The personal note shows the bands only, with no glow, because you write it yourself.\n\nGreyed out while the main switch is off: Raid Notes > Notes Settings > Highlights > Use assignment highlights.",
    name = "Highlight my name",
    group = "Highlight my group (G3, group 3)",
    glow = "Glow when my assignment changes",
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
            return H.Settings()[opt.field] and true or false
        end, function(on)
            H.Settings()[opt.field] = on
            changed()
        end)
        label:SetWidth(width - CHECK_W - INDENT)
        section.options[opt.field] = check
    end

    preview = UI.PreviewButton(pf, TEXT.preview, { H.PREVIEW_KEY }, { tooltip = TEXT.previewTip, enabledIf = function()
        return enabled(), TEXT.previewOff
    end })
    preview:SetPoint("TOPLEFT", x, top - 20 - (#OPTIONS + 1) * ROW_H - PREVIEW_GAP)
    section.preview = preview
    section.refresh = preview.refresh
    return section
end

-- The Use highlights box in a note window's column (Notes/Settings.lua), bound to CRTDB.highlights.windows[window]
-- (assignments, timers or personal). Greyed while shown() says the window is hidden, or the main switch is off.
-- page: the same helpers as Build. labelWidth: room for the label and its (?). Returns the check box.
local function windowCheck(pf, x, y, window, shown, page, labelWidth)
    local check, label = page.check(pf, x, y, TEXT.windowLabel, function()
        return enabled() and shown()
    end, function()
        return windows()[window] == true
    end, function(on)
        windows()[window] = on
        H:Changed()
        page.refresh()
    end)
    label:SetWidth(labelWidth - UI.HELP_SIZE - UI.HELP_GAP) -- room for its (?)
    UI.HelpRight(check, TEXT.windowLabel, window == "personal" and TEXT.windowHelpPersonal or TEXT.windowHelp)
    return check
end

CRT.HighlightsSettings = { TEXT = TEXT, Build = build, WindowCheck = windowCheck }
