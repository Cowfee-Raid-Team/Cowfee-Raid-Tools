local ADDON, CRT = ...

-- The Timeline page's Settings tab: the view (how much time is visible, the axis labels, the icon
-- size, Hide rows with no casts), the deaths filters, recording (with deleting the boss's pulls), and
-- where the Timeline's tooltips open (the timeline area of UI/Tooltip.lua). Every control writes through
-- Timeline:Set. Each row's own show or hide and your own spells are on the Advanced tab's Journal
-- abilities (ReferencePage.lua, /crt dev only). The Timeline page builds it with Build(parent, ctx) and
-- calls tab:Refresh() when anything changes; ctx gives it selectedBoss(), bossName() and refresh().

local Timeline = CRT.Timeline
local View = CRT.TimelineView
local UI = CRT.UI

-- The span sliders show minutes and seconds (View.Format), so a typed number is minutes.
local function toMinutes(seconds)
    return seconds / 60
end

local function fromMinutes(minutes)
    return minutes * 60
end

local SettingsTab = {}
CRT.TimelineSettingsTab = SettingsTab

-- Two columns: View, then Recording on the left; Deaths, then Tooltips on the right. Each section is a
-- heading, then its rows.
local LEFT_X, RIGHT_X = 8, 360
local HEADING_GAP = 18 -- from a heading to its first row
local ROW_STEP = 32 -- an Edit Mode style row (a slider or a dropdown)
local CHECK_STEP = 26 -- a checkbox row
local DROPDOWN_TO_CHECKS = 36 -- from Death rows to the role checkboxes
local CHECKS_TO_SLIDER = 24 -- from the role checkboxes to First deaths only
local DELETE_GAP = 10 -- above Delete this boss's pulls
local SECTION_GAP = 10 -- from a section's last row to the next heading
local VIEW_Y, DEATHS_Y = -8, -8
local RECORDING_Y = VIEW_Y - HEADING_GAP - 3 * ROW_STEP - CHECK_STEP - SECTION_GAP
local TOOLTIPS_Y = DEATHS_Y - HEADING_GAP - DROPDOWN_TO_CHECKS - CHECKS_TO_SLIDER - 2 * ROW_STEP - SECTION_GAP

local TEXT = {
    hideEmpty = "Hide rows with no casts in this pull",
    viewHelp = "How much time is visible at once (the mouse wheel zooms too), how often the time axis is labelled, and how big the cast icons are. Auto labels the axis more often as you zoom in. Hide rows with no casts leaves out a recorded pull's rows with no cast in that pull, for every boss.",
    deathsHelp = "Whether deaths share one row or each player gets a row, which roles show, and whether only the first few deaths show (0 shows all). Overlay pulls is how many pulls the Deaths from the last pulls checkbox covers on the Review tab; the number there changes it too.",
}

local GRIDS = {
    { key = "auto", label = "Auto (by zoom)" },
    { key = 5, label = "5 seconds" },
    { key = 10, label = "10 seconds" },
    { key = 15, label = "15 seconds" },
    { key = 30, label = "30 seconds" },
    { key = 60, label = "1 minute" },
}
local DEATH_ROWS = {
    { key = "combined", label = "One row for everyone" },
    { key = "player", label = "A row per player" },
}

local function settings()
    return Timeline:Settings()
end

local function label(parent, text, font)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "CRTFontNormal")
    fs:SetText(text)
    return fs
end

local function button(parent, text, width)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontButtonSmall)
    b:SetHighlightFontObject(CRTFontButtonSmallHighlight)
    b:SetDisabledFontObject(CRTFontButtonSmallDisable)
    b:SetSize(width, 20)
    b:SetText(text)
    return b
end

-- Asks in the game's own confirmation box, then runs accept.
local function confirm(text, arg, acceptText, accept)
    StaticPopup_ShowCustomGenericConfirmation({
        text = text,
        text_arg1 = arg,
        acceptText = acceptText,
        cancelText = CANCEL,
        showAlert = true,
        callback = accept,
    })
end

function SettingsTab.Build(f, ctx)
    local tab = {}
    local controls = {}
    local deleteButton

    -- A checkbox with its text on the right. get() is the setting, set(on) saves it.
    local function checkbox(parent, x, y, text, get, set)
        local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
        cb:SetSize(24, 24)
        cb:SetPoint("TOPLEFT", parent, "TOPLEFT", x - 4, y)
        cb.Label = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        cb.Label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
        cb.Label:SetJustifyH("LEFT")
        cb.Label:SetText(text)
        cb:SetScript("OnClick", function(self)
            set(self:GetChecked() and true or false)
        end)
        cb.refresh = function()
            cb:SetChecked(get() and true or false)
        end
        controls[#controls + 1] = cb
        return cb
    end

    local function place(row, parent, x, y)
        row:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
        controls[#controls + 1] = row
        return row
    end

    local function slider(parent, x, y, text, opts)
        opts.labelWidth, opts.width = 120, 150
        return place(UI.Slider(parent, text, opts), parent, x, y)
    end

    -- minutes: the value is seconds shown as minutes and seconds, and typed in minutes
    local function settingSlider(parent, x, y, text, field, low, high, step, format, minutes)
        return slider(parent, x, y, text, {
            min = low, max = high, step = step, format = format,
            toDisplay = minutes and toMinutes or nil,
            fromDisplay = minutes and fromMinutes or nil,
            get = function()
                return settings()[field]
            end,
            set = function(value)
                Timeline:Set(field, value)
            end,
        })
    end

    -- View
    local viewHeading = label(f, "View")
    viewHeading:SetPoint("TOPLEFT", f, "TOPLEFT", LEFT_X, VIEW_Y)
    UI.HelpRight(viewHeading, "View", TEXT.viewHelp)
    local y = VIEW_Y - HEADING_GAP
    settingSlider(f, LEFT_X, y, "Seconds visible", "span", 60, 600, 30, View.Format, true)
    y = y - ROW_STEP
    place(UI.Dropdown(f, "Axis labels every", {
        options = GRIDS,
        labelWidth = 120,
        width = 150,
        get = function()
            return settings().grid
        end,
        set = function(key)
            Timeline:Set("grid", key)
        end,
    }), f, LEFT_X, y)
    y = y - ROW_STEP
    settingSlider(f, LEFT_X, y, "Icon size", "iconSize", 16, 32, 1)
    y = y - ROW_STEP
    checkbox(f, LEFT_X, y, TEXT.hideEmpty, function()
        return settings().hideEmpty
    end, function(on)
        Timeline:Set("hideEmpty", on)
    end)

    -- Deaths
    local deathsHeading = label(f, "Deaths")
    deathsHeading:SetPoint("TOPLEFT", f, "TOPLEFT", RIGHT_X, DEATHS_Y)
    UI.HelpRight(deathsHeading, "Deaths", TEXT.deathsHelp)
    y = DEATHS_Y - HEADING_GAP
    place(UI.Dropdown(f, "Death rows", {
        options = DEATH_ROWS,
        labelWidth = 120,
        width = 150,
        get = function()
            return settings().deathRows
        end,
        set = function(key)
            Timeline:Set("deathRows", key)
        end,
    }), f, RIGHT_X, y)
    y = y - DROPDOWN_TO_CHECKS
    local roleX = RIGHT_X
    for _, role in ipairs({ { "TANK", "Tanks" }, { "HEALER", "Healers" }, { "DAMAGER", "Damage" } }) do
        checkbox(f, roleX, y, role[2], function()
            return settings().roles[role[1]]
        end, function(on)
            local roles = settings().roles
            roles[role[1]] = on
            Timeline:Set("roles", roles)
        end)
        roleX = roleX + 100
    end
    y = y - CHECKS_TO_SLIDER
    settingSlider(f, RIGHT_X, y, "First deaths only", "firstDeaths", 0, 20, 1, function(v)
        return v == 0 and "All" or tostring(v)
    end)
    y = y - ROW_STEP
    local range = Timeline.OVERLAY_PULLS
    settingSlider(f, RIGHT_X, y, "Overlay pulls", "overlay", range.min, range.max, 1)

    -- Recording
    local recordingHeading = label(f, "Recording")
    recordingHeading:SetPoint("TOPLEFT", f, "TOPLEFT", LEFT_X, RECORDING_Y)
    UI.HelpRight(recordingHeading, "Recording", "Pulls are saved on their own during raid boss fights, ten per boss, the oldest dropped first. Pulls shorter than the shortest pull are not kept.")
    y = RECORDING_Y - HEADING_GAP
    checkbox(f, LEFT_X, y, "Record every pull", function()
        return settings().record
    end, function(on)
        Timeline:Set("record", on)
    end)
    y = y - CHECK_STEP
    settingSlider(f, LEFT_X, y, "Shortest pull (s)", "minPull", 5, 60, 1)
    y = y - ROW_STEP - DELETE_GAP
    deleteButton = button(f, "Delete this boss's pulls", 180)
    deleteButton:SetPoint("TOPLEFT", f, "TOPLEFT", LEFT_X, y)
    deleteButton:SetScript("OnClick", function()
        local boss = ctx.selectedBoss()
        if not boss then
            return
        end
        confirm("Delete every saved pull of %s?", ctx.bossName() or tostring(boss), "Delete", function()
            Timeline:DeleteBoss(boss)
        end)
    end)

    -- Tooltips: the timeline area's Tooltip position and its spot picker under it (UI/Tooltip.lua), for
    -- every tooltip on the Review tab, docked or popped out
    local tipHeading = label(f, "Tooltips")
    tipHeading:SetPoint("TOPLEFT", f, "TOPLEFT", RIGHT_X, TOOLTIPS_Y)
    UI.HelpRight(tipHeading, "Tooltips", "Where the Timeline's tooltips open, such as a cast's or a reminder's when you hover it, on this page or in its pop-out. Use the general setting follows General Settings. Outside the window puts it just past the edge of the window you are in, on the spot you click in the box below; clicking a spot picks it, and clicking it again goes back to each tooltip on its own side. Follow the cursor keeps the tooltip at your mouse.")
    local position = UI.TooltipPositionSetting(f, "timeline", { labelWidth = 120, width = 150 })
    position.row:SetPoint("TOPLEFT", f, "TOPLEFT", RIGHT_X, TOOLTIPS_Y - HEADING_GAP)
    controls[#controls + 1] = position

    f:SetScript("OnShow", function()
        ctx.refresh()
    end)

    -- Redraws the controls from the settings, and the Delete button.
    function tab:Refresh()
        for _, control in ipairs(controls) do
            control.refresh()
        end
        local selectedBoss = ctx.selectedBoss()
        deleteButton:SetEnabled(selectedBoss ~= nil and #Timeline:Pulls(selectedBoss) > 0)
    end

    return tab
end
