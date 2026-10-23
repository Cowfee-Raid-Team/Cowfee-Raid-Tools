local ADDON, CRT = ...

-- The Alerts tab of the Raid Notes page (Notes/Page.lua builds it into its tab).
--   Left   where your own note lines go: the note callout (Notes/Alert.lua), the critical alerts text, icons,
--          bars, circles and timeline, and whether they are read out. Each uses a switch kept elsewhere: the
--          callout and speech in CRTDB.notes.alert (enabled, tts), the bars in alerts.bars.noteLines, the rest in
--          alerts.noteLines. A note line with its own show: keeps its displays (see Notes/Engine.lua).
--          Under it, Colours (Use custom colours, alerts.customColors, the one switch for your own alert colours:
--          the areas' colour rows, your reminders' and templates' colour; see Alerts/Colors.lua), then Previews
--          and a test of every area.
--   Right  Configuration, from half the page: a dropdown of the note callout and the five alert areas, and the
--          chosen one's settings, drawn by Alerts/Areas.lua's panel from each area's def.settings (the callout's
--          from CRT.NoteAlert.PanelEntry), in a scroll frame (CowfeeRaidToolsAlertSettingsScroll) for one with
--          more rows than fit. The choice is kept for the session. The callout's Read them out row is the same
--          setting (notes.alert.tts) as the left column's: each follows the other.
-- The ⚙ on each area's drag box opens this tab on that area (CRT.NoteAlertsTab.Select).
-- The areas load after this file, so they are only looked up once the tab is built.

local Notes = CRT.Notes
local UI = CRT.UI

-- Every word on this tab, in one place so the wording is easy to change. Keep the keys, change the
-- text in quotes, save, and /reload.
local TEXT = {
    routeTitle = "Your note lines go to",
    routeHelp = "Where your own lines from the raid note show, and whether they are read out. Tick as many as you like.\n\n"
        .. "This is for your note lines without their own displays. A line that names its own displays keeps them, though each display's own switch can still turn it off.\n\n"
        .. "Your note lines are read when the pull starts, so a change takes effect on the next pull.",
    callout = "Note callout/assignments",
    text = "Critical alerts text",
    icon = "Icon",
    bar = "Bar",
    circle = "Circle",
    timeline = "Alert timeline",
    speech = "Read them out (text to speech)",
    speechHelp = "Reads your note lines out wherever they show, with or without the note callout, and plays their sounds.\n\n"
        .. "It is also the switch for all speech: turning it off silences your reminders' speech too.\n\n"
        .. "Note callout/assignments under Configuration has the same switch, with when, how loud and how fast it reads.",

    colours = "Colours",
    coloursHelp = "Each alert shows in the colour of its ability type, as on the Timeline: dispel blue, soak pink, Mythic only orange.\n\n"
        .. "Tick Use custom colours to use your own bar, ring and alert colours instead. Unticked, they stay saved.\n\n"
        .. "A colour the raid leader put on a raid note line always shows.",
    custom = "Use custom colours",

    tryIt = "Try it",
    tryHelp = "Previews shows every alert with samples, so you can drag them into place; the cog on each opens its settings here. Test all areas counts three test alerts down in each.",
    previews = "Previews",
    testAll = "Test all areas",
    testLine = "Test alert %d",

    config = "Configuration",
    configHelp = "How each kind of alert looks. Pick one from the list to see its settings; a change shows at once.\n\n"
        .. "Critical alerts text is the big text in the middle of the screen. Your note lines go there only when you tick it on the left.",
    callout = "Note callout/assignments",
    icons = "Icons",
    texts = "Critical alerts text",
    bars = "Bars",
    circles = "Circles",
    timelineArea = "Alert timeline",
}

-- The note callout, then the areas, in the dropdown in this order. The callout is not an area: its rows
-- come from CRT.NoteAlert.PanelEntry.
local CALLOUT = "callout"
local KINDS = {
    { key = CALLOUT, label = TEXT.callout },
    { key = "icons", label = TEXT.icons },
    { key = "texts", label = TEXT.texts },
    { key = "bars", label = TEXT.bars },
    { key = "circles", label = TEXT.circles },
    { key = "timeline", label = TEXT.timelineArea },
}
local DEFAULT_KIND = CALLOUT
-- Two columns, each half of the page (UI.PAGE_W): where your note lines go on the left, Configuration
-- on the right. The tab is UI.PAGE_H - 66 high under the tabs (Notes/Page.lua); an area's rows that run
-- taller than the room under the dropdown scroll (the timeline has many).
local COLUMN_GAP = 16
local RIGHT_X = math.floor(UI.PAGE_W / 2) + COLUMN_GAP / 2
local TAB_H = UI.PAGE_H - 66
local ROWS_TOP = 68      -- the rows start this far down the tab, under the dropdown
local ROWS_BOTTOM = 4    -- and end this far above its bottom: room for the bars' 13 rows without scrolling
local TEST_ICONS = { 136243, 135808, 136116 }
local TEST_TIMES = { 8, 12, 16 } -- seconds until each test alert reaches 0
local TEST_HOLD = 1

local WHITE = { 1, 1, 1 }
local GREY = { 0.5, 0.5, 0.5 }

local tab, panel, kindDrop, rowsScroll
local selected = DEFAULT_KIND
local controls = {}

local function makeButton(parent, label, width, height)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetSize(width, height or 24)
    b:SetText(label)
    return b
end

local function heading(parent, x, y, text)
    local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", x, y)
    fs:SetText(text)
    return fs
end

-- A checkbox. enabledIf, when given, greys it out while it returns false.
local function makeCheck(parent, x, y, label, enabledIf, get, set)
    local check = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    check:SetSize(24, 24)
    check:SetPoint("TOPLEFT", x, y)
    check.labelText = label
    local text = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", check, "RIGHT", 2, 0)
    text:SetText(label)
    check.label = text
    check:SetScript("OnClick", function(self)
        set(self:GetChecked() and true or false)
    end)
    check.refresh = function()
        check:SetChecked(get() and true or false)
        if enabledIf then
            local on = enabledIf() and true or false
            check:SetEnabled(on)
            local c = on and WHITE or GREY
            text:SetTextColor(c[1], c[2], c[3])
        end
    end
    controls[#controls + 1] = check
    return check
end

local function alertSettings()
    return CRT.Alerts:Settings()
end

-- alerts.noteLines, made when an older save has none.
local function routing()
    local alerts = alertSettings()
    if type(alerts.noteLines) ~= "table" then
        alerts.noteLines = { text = false, icon = false, circle = false, timeline = false }
    end
    return alerts.noteLines
end

local function areaOn(key)
    return function()
        local area = CRT.AlertAreas.Find(key)
        return area and area:Settings().shown and true or false
    end
end

local function refresh()
    if not tab or not tab:IsShown() then
        return
    end
    for _, control in ipairs(controls) do
        control.refresh()
    end
    if panel then
        panel:Refresh()
    end
end

-- The area with this key, or the note callout's panel entry for "callout"; nil for none.
local function find(key)
    if key == CALLOUT then
        return CRT.NoteAlert and CRT.NoteAlert.PanelEntry
    end
    return CRT.AlertAreas and CRT.AlertAreas.Find(key)
end

-- Shows the chosen area's settings on the right.
local function show(key)
    local area = find(key)
    if not area then
        key = DEFAULT_KIND
        area = find(key)
    end
    selected = key
    if not (panel and area) then
        return
    end
    panel:Select(area)
    -- back to the top, and the scroll bar only when the rows are taller than the room
    if rowsScroll then
        local tall = panel.frame:GetHeight() > rowsScroll:GetHeight()
        rowsScroll:SetVerticalScroll(0)
        if rowsScroll.ScrollBar then
            rowsScroll.ScrollBar:SetShown(tall)
        end
    end
    if kindDrop then
        kindDrop.refresh()
    end
end

-- Three test alerts in every area, counting down without a run.
local function testAll()
    local now = GetTime()
    for _, kind in ipairs(KINDS) do
        local area = CRT.AlertAreas.Find(kind.key)
        if area then
            local lines = {}
            for i, seconds in ipairs(TEST_TIMES) do
                lines[i] = { id = "tabtest" .. i, text = format(TEXT.testLine, i), icon = TEST_ICONS[i], at = now + seconds, hold = TEST_HOLD }
            end
            area:Test(lines)
        end
    end
end

local function build(pf)
    tab = pf

    -- Left: where your note lines go.
    local routeTitle = heading(pf, 8, -14, TEXT.routeTitle)
    UI.HelpRight(routeTitle, TEXT.routeTitle, TEXT.routeHelp)
    local function alertField(field)
        return function()
            return Notes:Alert()[field]
        end, function(value)
            Notes:Set("alert", field, value)
        end
    end
    local function route(field)
        return function()
            return routing()[field]
        end, function(value)
            routing()[field] = value
            refresh()
        end
    end
    local y = -38
    local function nextRow()
        local at = y
        y = y - 26
        return at
    end
    makeCheck(pf, 4, nextRow(), TEXT.callout, nil, alertField("enabled"))
    makeCheck(pf, 4, nextRow(), TEXT.text, areaOn("texts"), route("text"))
    makeCheck(pf, 4, nextRow(), TEXT.icon, areaOn("icons"), route("icon"))
    makeCheck(pf, 4, nextRow(), TEXT.bar, areaOn("bars"), function()
        return alertSettings().bars.noteLines
    end, function(value)
        alertSettings().bars.noteLines = value
        refresh()
        if CRT.AlertBars then
            CRT.AlertBars:Refresh()
        end
    end)
    makeCheck(pf, 4, nextRow(), TEXT.circle, areaOn("circles"), route("circle"))
    makeCheck(pf, 4, nextRow(), TEXT.timeline, areaOn("timeline"), route("timeline"))
    local speech = makeCheck(pf, 4, nextRow(), TEXT.speech, nil, alertField("tts"))
    UI.HelpRight(speech.label, TEXT.speech, TEXT.speechHelp)

    -- Colours: the one switch for your own alert colours
    local colourTop = y - 20
    local colourTitle = heading(pf, 8, colourTop, TEXT.colours)
    UI.HelpRight(colourTitle, TEXT.colours, TEXT.coloursHelp)
    y = colourTop - 24
    makeCheck(pf, 4, nextRow(), TEXT.custom, nil, function()
        return CRT.Alerts:CustomColors()
    end, function(value)
        alertSettings().customColors = value and true or false
        refresh()
        -- the areas, the Timeline's rows and any open alert redraw in the new colours
        for _, area in ipairs(CRT.AlertAreas and CRT.AlertAreas.list or {}) do
            area:Refresh()
        end
        CRT.Alerts:Fire()
        if CRT.Timeline and CRT.Timeline.Fire then
            CRT.Timeline:Fire()
        end
    end)

    local tryTop = y - 20
    local tryTitle = heading(pf, 8, tryTop, TEXT.tryIt)
    UI.HelpRight(tryTitle, TEXT.tryIt, TEXT.tryHelp)
    local previews = makeButton(pf, TEXT.previews, 140)
    previews:SetPoint("TOPLEFT", 8, tryTop - 24)
    previews:SetScript("OnClick", function()
        UI:SetPreviews(true)
    end)
    local test = makeButton(pf, TEXT.testAll, 140)
    test:SetPoint("LEFT", previews, "RIGHT", 8, 0)
    test:SetScript("OnClick", testAll)

    -- Right: how each kind of alert looks.
    local configTitle = heading(pf, RIGHT_X, -14, TEXT.config)
    UI.HelpRight(configTitle, TEXT.config, TEXT.configHelp)
    -- No label: the heading says what the list is.
    kindDrop = UI.Dropdown(pf, "", {
        options = KINDS,
        labelWidth = 1,
        width = 180,
        get = function()
            return selected
        end,
        set = show,
    })
    kindDrop:SetPoint("TOPLEFT", RIGHT_X - 4, -32)
    -- The chosen area's rows, in a scroll frame that clips them to the tab; its bar shows only when needed.
    local scroll = CreateFrame("ScrollFrame", "CowfeeRaidToolsAlertSettingsScroll", pf, "UIPanelScrollFrameTemplate")
    UI:SkinScrollBar(scroll.ScrollBar)
    scroll.scrollBarHideable = true -- the template hides the bar when nothing scrolls
    scroll:SetPoint("TOPLEFT", RIGHT_X, -ROWS_TOP)
    panel = CRT.AlertAreas.Panel(scroll, refresh)
    -- as wide as the rows and the (?) after a control, so the scroll frame never clips one
    local width = panel.fullWidth or panel.frame:GetWidth()
    panel.frame:SetWidth(width)
    scroll:SetSize(width, TAB_H - ROWS_TOP - ROWS_BOTTOM)
    scroll:SetScrollChild(panel.frame)
    rowsScroll = scroll

    pf:SetScript("OnShow", function()
        show(selected)
        refresh()
    end)
    Notes:OnChange(refresh)
    show(selected)
end

-- Built into the Alerts tab by Notes/Page.lua. Select(key) picks the note callout ("callout") or an area
-- ("icons", "texts", "bars", "circles" or "timeline") for when the tab shows, and shows it at once if the
-- tab is built.
CRT.NoteAlertsTab = {
    Build = build,
    Select = function(key)
        selected = key
        if panel then
            show(key)
        end
    end,
}
