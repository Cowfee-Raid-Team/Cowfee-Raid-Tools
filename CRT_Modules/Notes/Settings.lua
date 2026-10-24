local ADDON, CRT = ...

-- The Notes Settings tab of the Raid Notes page (Notes/Page.lua builds it into its tab): one column for each
-- of the three note windows (timers, assignments, personal note), who to accept shared notes from and how the
-- Notes tab lists them. The note callout (its timing, look and voice) and where your note lines show are on
-- the Alert Settings tab (Notes/AlertsTab.lua, Notes/Alert.lua). Unlocked windows can be dragged and resized by
-- hand, and their position and size are saved per player.

local Notes = CRT.Notes
local UI = CRT.UI

-- Every word on this tab, in one place so the wording is easy to change. Keep the keys, change the
-- text in quotes, save, and /reload.
local TEXT = {
    hint = "Untick Locked to drag a window and resize it from its corner, then lock it so clicks pass through. Keep up when empty leaves a window on screen with nothing to show. Previews shows every window with sample text.",

    -- The three window columns.
    timers = "Timers",
    assignments = "Assignments",
    personal = "Personal note",
    show = "Show this window",
    locked = "Locked (clicks pass through)",
    keepEmpty = "Keep up when empty",
    hidePassed = "Hide lines once passed",
    onlyMe = "Show only me",
    fontSize = "Font size",
    windowAlpha = "Window alpha",
    backgroundAlpha = "Background",
    font = "Font",

    -- All three note windows.
    allWindows = "All note windows",
    allWindowsHelp = "Settings for the Timers, Assignments and Personal note windows together. Show outside of raid: tick it to show all three outside a raid instance too; off, they show only in a raid. Previews still shows them.",
    showOutsideRaid = "Show outside of raid",

    -- Sharing.
    sharing = "Sharing",
    trustedOnly = "Only accept notes from leader or assistants",
    autoAccept = "Accept healers' cooldown changes automatically",
    autoAcceptHelp = "For the raid leader and assistants. Healers can move their own cooldowns on the Timeline's "
        .. "Healer CDs and send them to you; they show under Proposed changes there. Ticked, a change from a group "
        .. "member about their own line is written into the raid note at once. A change to a line you changed since "
        .. "always waits. Share the note afterwards as usual.",
    notesList = "Notes list",
    listStyle = "Show notes",
    listHelp = "How the Notes tab lists notes: Grouped headings puts every note under its difficulty; Dropdown and Chips show one difficulty at a time, picked above the list.",
    grouped = "Grouped headings",
    dropdown = "Dropdown",
    chips = "Chips",
}

-- Four columns across the page (UI.PAGE_W), under All note windows: the three note windows, COLUMN_W
-- each, then Sharing and Notes list in what is left. A slider row is 4 + labelWidth + 5 + width + its value
-- (about 44).
local COLUMN_W = math.floor((UI.PAGE_W - 16) / 4)
local FOURTH_X = 8 + 3 * COLUMN_W + 10
local FOURTH_W = UI.PAGE_W - 8 - FOURTH_X
-- All note windows comes first, at the top left; the columns start ALL_H under it: its heading and
-- its check box (20 apart, as in every section), then the 36 a section leaves before the next heading.
local TOP, ALL_H = -14, 56
local WINDOWS = {
    { key = "window", title = TEXT.timers },
    { key = "assignments", title = TEXT.assignments },
    { key = "personal", title = TEXT.personal },
}

local WHITE = { 1, 1, 1 }
local GREY = { 0.5, 0.5, 0.5 }

local page
local controls = {}

local function setting(key, field)
    return function()
        return Notes:WindowSettings(key)[field]
    end, function(value)
        Notes:Set(key, field, value)
    end
end

-- Greys a label out, for a control that can't be used right now.
local function greyOut(label, on)
    local c = on and WHITE or GREY
    label:SetTextColor(c[1], c[2], c[3])
end

-- enabledIf, when given, returns whether a control can be used. When it returns false the control is
-- greyed out and can't be changed, such as a hidden window's rows.
-- enabledIf comes before getter and setter, which must be last (see makeNumber). Pass nil when the
-- box never greys out.
local function makeCheck(parent, x, y, label, enabledIf, getter, setter)
    local check = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    check:SetPoint("TOPLEFT", x, y)
    local text = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", check, "RIGHT", 2, 0)
    -- wraps inside its column rather than running into the next one
    text:SetWidth(COLUMN_W - 30)
    text:SetJustifyH("LEFT")
    text:SetText(label)
    check.label = text -- UI.HelpRight follows it
    check:SetScript("OnClick", function(self)
        setter(self:GetChecked() and true or false)
    end)
    check.refresh = function()
        check:SetChecked(getter() and true or false)
        if enabledIf then
            local on = enabledIf()
            check:SetEnabled(on)
            greyOut(text, on)
        end
    end
    controls[#controls + 1] = check
    return check, text
end

-- A number setting as an Edit Mode style slider. opts: low and high (the range), labelWidth and
-- width (default 100 and 76, to fit a column), format (the text beside the bar) and enabledIf.
-- getter and setter come last because setting() returns both: Lua only passes every
-- return value of a call when it is the last argument, so in the middle the setter is lost.
local function makeNumber(parent, x, y, label, opts, getter, setter)
    local row = UI.Slider(parent, label, {
        min = opts.low,
        max = opts.high,
        step = 1,
        labelWidth = opts.labelWidth or 100,
        width = opts.width or 76,
        format = opts.format,
        enabledIf = opts.enabledIf,
        get = getter,
        set = setter,
    })
    row:SetPoint("TOPLEFT", x + 4, y)
    controls[#controls + 1] = row
    return row
end

local function percent(v)
    return (v or 0) .. "%"
end

local function heading(parent, x, y, text)
    local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetText(text)
    return fs
end

local function buildColumn(pf, index, def, top)
    local x = 8 + (index - 1) * COLUMN_W
    local title = heading(pf, x, top, def.title)
    if index == 1 then
        UI.HelpRight(title, "Note windows", TEXT.hint)
    end

    -- Everything below Show this window greys out while the window is hidden.
    local function shown()
        return Notes:WindowSettings(def.key).shown and true or false
    end
    makeCheck(pf, x - 4, top - 20, TEXT.show, nil, setting(def.key, "shown"))
    makeCheck(pf, x - 4, top - 44, TEXT.locked, shown, setting(def.key, "locked"))
    makeCheck(pf, x - 4, top - 68, TEXT.keepEmpty, shown, setting(def.key, "keepEmpty"))
    local y = top - 92
    if def.key == "window" then
        makeCheck(pf, x - 4, y, TEXT.hidePassed, shown, setting(def.key, "hidePassed"))
        makeCheck(pf, x - 4, y - 24, TEXT.onlyMe, shown, setting(def.key, "onlyMe"))
        y = y - 48
    end
    makeNumber(pf, x, y, TEXT.fontSize, { low = 8, high = 32, enabledIf = shown }, setting(def.key, "fontSize"))
    makeNumber(pf, x, y - 28, TEXT.windowAlpha, { low = 10, high = 100, format = percent, enabledIf = shown }, setting(def.key, "alpha"))
    makeNumber(pf, x, y - 56, TEXT.backgroundAlpha, { low = 0, high = 100, format = percent, enabledIf = shown }, setting(def.key, "bgAlpha"))

    -- Read each time the menu opens, so fonts shared by other addons appear.
    local function fonts()
        local out = { { key = "default", label = "Game default" } }
        for _, f in ipairs(CRT:FontList()) do
            out[#out + 1] = { key = f.name, label = f.name }
        end
        return out
    end
    local font = UI.Dropdown(pf, TEXT.font, {
        options = fonts,
        labelWidth = 40,
        width = COLUMN_W - 64,
        get = function()
            return Notes:WindowSettings(def.key).font or "Friz Quadrata"
        end,
        set = function(name)
            Notes:Set(def.key, "font", name)
        end,
        enabledIf = shown,
    })
    font:SetPoint("TOPLEFT", x, y - 88)
    controls[#controls + 1] = font
end

local function refresh()
    if not page or not page:IsShown() then
        return
    end
    for _, control in ipairs(controls) do
        control.refresh()
    end
end

local function build(pf)
    page = pf

    -- one switch for all three note windows
    local allTitle = heading(pf, 8, TOP, TEXT.allWindows)
    UI.HelpRight(allTitle, TEXT.allWindows, TEXT.allWindowsHelp)
    makeCheck(pf, 4, TOP - 20, TEXT.showOutsideRaid, nil, function()
        return Notes:ShowOutsideRaid()
    end, function(value)
        Notes:Set(nil, "showOutsideRaid", value)
    end)
    local top = TOP - ALL_H

    -- The three note windows.
    for index, def in ipairs(WINDOWS) do
        buildColumn(pf, index, def, top)
    end

    -- Sharing, then how the Notes tab lists the notes, in the fourth column. The note callout's timing and
    -- voice moved to its own entry on Alert Settings > Configuration (Notes/Alert.lua).
    local x = FOURTH_X
    heading(pf, x, top, TEXT.sharing)
    makeCheck(pf, x - 4, top - 20, TEXT.trustedOnly, nil, function()
        return Notes:TrustedOnly()
    end, function(value)
        Notes:Set(nil, "trustedOnly", value)
    end)
    -- healers' cooldown changes sent from Healer CDs (Notes/Proposals.lua)
    local auto, autoText = makeCheck(pf, x - 4, top - 56, TEXT.autoAccept, nil, function()
        return CRT.NoteProposals and CRT.NoteProposals.AutoAccept() or false
    end, function(value)
        Notes:Set(nil, "autoAcceptCooldowns", value)
    end)
    autoText:SetWidth(COLUMN_W - 30 - UI.HELP_SIZE - UI.HELP_GAP) -- room for its (?)
    UI.HelpRight(auto, TEXT.autoAccept, TEXT.autoAcceptHelp)

    local listTitle = heading(pf, x, top - 92, TEXT.notesList)
    UI.HelpRight(listTitle, TEXT.notesList, TEXT.listHelp)
    local styleRow = UI.Dropdown(pf, TEXT.listStyle, {
        options = { { key = "grouped", label = TEXT.grouped }, { key = "dropdown", label = TEXT.dropdown }, { key = "chips", label = TEXT.chips } },
        labelWidth = 80,
        width = FOURTH_W - 85,
        get = function()
            return Notes:ListStyle()
        end,
        set = function(key)
            Notes:SetListStyle(key)
        end,
    })
    styleRow:SetPoint("TOPLEFT", x, top - 114)
    controls[#controls + 1] = styleRow

    pf:SetScript("OnShow", refresh)
    Notes:OnChange(refresh)
end

-- Built into the Notes Settings tab by Notes/Page.lua.
CRT.NoteSettings = { Build = build }
