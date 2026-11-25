local ADDON, CRT = ...

-- The Start here page (key "start"), first in the menu's General group and the page a new profile opens on (Core.lua's lastPage default).
-- It has no tabs: the title with a line and the Welcome button (UI/Welcome.lua) beside it, then What's on.
-- What's on has one checkbox, in sections, for everything CRT draws on screen, plays or says.
-- Each checkbox reads and writes the same saved field as the switch on the feature's own page, through the feature's own setter where it has one, so both stay in step.
-- The page name on its right (UI.LinkButton) opens that page on the tab that holds it.
-- A feature that draws, plays or speaks adds its row to WHATS_ON below, in the same job (the UX rules).

local UI = CRT.UI

-- One row per switch, in sections. A row:
--   key      its name, for the harnesses
--   label    the checkbox's text
--   path     the saved field under CRTDB it reads ("consumables.enabled"); invert: the field is the switch's
--            opposite (minimap.hide)
--   set      function(on), the feature's own setter; without it the field is written as it is
--   page     the page key the link opens, tab its tab (for a page with an Open(tab), OPENERS below)
--   where    the page and tab as the link's tooltip names it; open, a function used instead of the page
--   linkText the link's text, when it isn't the page's title
--   help     a (?) on the row: { title, text }
local function db()
    return CRT.db
end

local function readyCheckApply()
    if CRT.ReadyCheckWindow and CRT.ReadyCheckWindow.Apply then
        CRT.ReadyCheckWindow:Apply()
    end
end

-- an alert area by its key ("icons", "texts", "bars", "circles", "timeline"), redrawn after its switch
local function alertArea(key)
    for _, area in ipairs(CRT.AlertAreas and CRT.AlertAreas.list or {}) do
        if area.def and area.def.key == key then
            return area
        end
    end
    return nil
end

local function areaSet(key)
    return function(on)
        local area = alertArea(key)
        local s = area and area:Settings()
        if s then
            s.shown = on
            area:Refresh()
        end
    end
end

local function noteWindowSet(key)
    return function(on)
        CRT.Notes:Set(key, "shown", on)
    end
end

local TEXT = {
    title = "Start here",
    intro = "New here? The Welcome shows where to begin.",
    welcome = "Welcome",
    welcomeTip = "Opens the Welcome again: next steps for raiders and for leaders.",
    whatsOn = "What's on",
    whatsOnHelp = {
        "Everything Cowfee Raid Tools draws on screen, plays or says. Untick one to switch it off.",
        { "The page on the right", "opens the page with the same switch and the rest of its settings. Both stay in step." },
    },
    opens = "Opens %s.",
    notLoaded = "This page isn't loaded.",
    interruptsOff = "Tick Enable Interrupts to show its page.",
    pageHidden = "This page is hidden right now.",
    interruptsHelp = "Kick numbers above a boss's adds, a countdown before your kick and the leader's kick list. Off for everyone until they tick this. The Interrupts page lists the bosses it works on.",
}

local WHATS_ON = {
    { title = "On screen",
        { key = "consumables", label = "Consumables bar", path = "consumables.enabled", page = "readycheck", tab = "auto", where = "Ready Check > Settings",
            set = function(on) CRT.Consumables:SetEnabled(on) readyCheckApply() end },
        { key = "readyWindow", label = "Ready check window", path = "readycheck.window.enabled", page = "readycheck", tab = "window", where = "Ready Check > Window",
            set = function(on) db().readycheck.window.enabled = on readyCheckApply() end },
        { key = "debuffs", label = "Debuff panel", path = "debuffs.enabled", page = "qol", tab = "debuffs", where = "Quality of Life > Debuffs",
            set = function(on) CRT.Debuffs:SetEnabled(on) end },
        { key = "callout", label = "Note callout", path = "notes.alert.enabled", page = "notes", tab = "alerts", where = "Raid Notes > Alert settings",
            set = function(on) CRT.Notes:Set("alert", "enabled", on) end },
        { key = "timers", label = "Note timers window", path = "notes.window.shown", page = "notes", tab = "settings", where = "Raid Notes > Notes settings",
            set = noteWindowSet("window") },
        { key = "assignments", label = "Assignments window", path = "notes.assignments.shown", page = "notes", tab = "settings", where = "Raid Notes > Notes settings",
            set = noteWindowSet("assignments") },
        { key = "personal", label = "Personal note window", path = "notes.personal.shown", page = "notes", tab = "settings", where = "Raid Notes > Notes settings",
            set = noteWindowSet("personal") },
        { key = "highlights", label = "Assignment highlights", path = "highlights.enabled", page = "notes", tab = "settings", where = "Raid Notes > Notes settings",
            set = function(on) CRT.NoteHighlights:SetEnabled(on) end },
        { key = "pace", label = "Pace window", path = "pace.shown", page = "pace", where = "Pace",
            set = function(on)
                db().pace.shown = on
                if not on and CRT.Pace and CRT.Pace.Stop then
                    CRT.Pace:Stop()
                end
            end },
        { key = "battleRes", label = "Battle res icon", path = "qol.battleRes.enabled", page = "qol", tab = "brez", where = "Quality of Life > Battle res",
            set = function(on) db().qol.battleRes.enabled = on CRT.BattleRes:Apply() end },
        { key = "lowHealth", label = "Low health alert", path = "qol.lowHealth.enabled", page = "qol", tab = "lowhealth", where = "Quality of Life > Low health",
            set = function(on) CRT.LowHealth:SetEnabled(on) end },
        { key = "interrupts", label = "Enable Interrupts", path = "interrupts.enabled", page = "interrupts", where = "Interrupts",
            help = { "Enable Interrupts", TEXT.interruptsHelp },
            set = function(on) CRT.Interrupts:SetEnabled(on) end },
        { key = "whatsNew", label = "What's new after updates", path = "whatsNew.show", linkText = "What's new", where = "the What's new window",
            open = function() CRT.WhatsNew:ShowNow() end },
        { key = "minimap", label = "Minimap button", path = "minimap.hide", invert = true, page = "settings", tab = "appearance", where = "General Settings > Appearance",
            set = function(on) CRT.MinimapButton:SetHidden(not on) end },
    },
    { title = "Alerts",
        { key = "alertIcons", label = "Alert icons", path = "alerts.areas.icons.shown", page = "notes", tab = "alerts", where = "Raid Notes > Alert settings", set = areaSet("icons") },
        { key = "alertTexts", label = "Alert text", path = "alerts.areas.texts.shown", page = "notes", tab = "alerts", where = "Raid Notes > Alert settings", set = areaSet("texts") },
        { key = "alertBars", label = "Alert bars", path = "alerts.bars.shown", page = "notes", tab = "alerts", where = "Raid Notes > Alert settings", set = areaSet("bars") },
        { key = "alertCircles", label = "Alert circles", path = "alerts.areas.circles.shown", page = "notes", tab = "alerts", where = "Raid Notes > Alert settings", set = areaSet("circles") },
        { key = "alertTimeline", label = "Alert timeline", path = "alerts.areas.timeline.shown", page = "notes", tab = "alerts", where = "Raid Notes > Alert settings", set = areaSet("timeline") },
    },
    { title = "Sound and speech",
        { key = "speech", label = "Text to speech", path = "notes.alert.tts", page = "notes", tab = "alerts", where = "Raid Notes > Alert settings",
            set = function(on) CRT.Notes:Set("alert", "tts", on) end },
    },
    { title = "Chat and recording",
        { key = "report", label = "Ready check report", path = "readycheck.auto", page = "readycheck", tab = "auto", where = "Ready Check > Settings",
            set = function(on) db().readycheck.auto = on readyCheckApply() end },
        { key = "earlyPull", label = "Early pull report", path = "readycheck.earlyPull", page = "readycheck", tab = "auto", where = "Ready Check > Settings",
            set = function(on) db().readycheck.earlyPull = on readyCheckApply() end },
        { key = "tattle", label = "Tattlebot", path = "tattle.enabled", page = "tattle", where = "Tattlebot (the switch is on its Settings tab)",
            set = function(on) CRT.Tattle:Set("enabled", on) end },
        { key = "timeline", label = "Timeline recording", path = "timeline.record", page = "timeline", where = "Timeline",
            set = function(on) CRT.Timeline:Set("record", on) end },
        { key = "combatLog", label = "Combat logging", path = "qol.combatLog.enabled", page = "qol", tab = "combatlog", where = "Quality of Life > Combat log",
            set = function(on) CRT.CombatLog:SetEnabled(on) end },
    },
}

-- The pages that open on a tab, by their own Open(tab).
local OPENERS = { readycheck = "ReadyCheckPage", qol = "QoLPage", notes = "NotesPage", settings = "SettingsPage" }

-- Every number the page is placed with, in px: the left margin; the right column's start (half the page) and the
-- room before it; a row's least height and the room around its text; the checkbox and the space after it; the
-- space between a row's label and its link, between sections and under a heading; the intro's distance from the
-- title (on the title's line), the Welcome button's height, and the room above What's on.
local L = {
    x = 8, col2 = math.floor(UI.PAGE_W / 2), colGap = 16, row = 24, rowPad = 2, check = 24, checkGap = 2,
    linkGap = 12, sectionGap = 10, headingGap = 4, introGap = 24, button = 22, whatsOnGap = 14,
}

local function find(path)
    local t = CRT.db
    for part in path:gmatch("[^%.]+") do
        if type(t) ~= "table" then
            return nil
        end
        t = t[part]
    end
    return t
end

-- A row's switch, as on or off, read from its saved field.
local function get(row)
    local v = find(row.path)
    if row.invert then
        return not v
    end
    return v == true
end

local function set(row, on)
    on = on and true or false
    if row.set then
        row.set(on)
        return
    end
    local t = CRT.db
    local parts = {}
    for part in row.path:gmatch("[^%.]+") do
        parts[#parts + 1] = part
    end
    for i = 1, #parts - 1 do
        t = t[parts[i]]
    end
    if row.invert then
        on = not on
    end
    t[parts[#parts]] = on
end

-- Whether a row's link can open its page now, and why not.
local function canOpen(row)
    if row.open then
        return true
    end
    local p = UI.pages[row.page]
    if not p then
        return false, TEXT.notLoaded
    end
    if p.hidden then
        return false, row.key == "interrupts" and TEXT.interruptsOff or TEXT.pageHidden
    end
    return true
end

local function open(row)
    if row.open then
        row.open()
        return
    end
    local api = row.tab and CRT[OPENERS[row.page] or ""]
    if api and api.Open then
        api.Open(row.tab)
    else
        UI:Show(row.page)
    end
end

local Start = { WHATS_ON = WHATS_ON, TEXT = TEXT, LAYOUT = L, Get = get, Set = set, CanOpen = canOpen, OpenRow = open }
CRT.StartPage = Start

local view = { rows = {}, headings = {} }
Start.view = view

local function width(fs)
    return math.ceil(fs:GetStringWidth() or 0)
end

local function height(fs)
    return math.ceil(fs:GetStringHeight() or 0)
end

local function buildRow(pf, row)
    local cb = CreateFrame("CheckButton", nil, pf, "UICheckButtonTemplate")
    cb:SetSize(L.check, L.check)
    local label = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    label:SetJustifyH("LEFT")
    label:SetWordWrap(true)
    label:SetText(row.label)
    cb.label = label
    cb:SetScript("OnClick", function(self)
        set(row, self:GetChecked())
        Start.Refresh()
    end)
    local title = row.linkText or (UI.pages[row.page] and UI.pages[row.page].title) or row.where
    local link = UI.LinkButton(pf, title, {
        tipTitle = title,
        tipText = TEXT.opens:format(row.where),
        enabledIf = function()
            return canOpen(row)
        end,
        onClick = function()
            open(row)
        end,
    })
    local help = row.help and UI.HelpRight(cb, row.help[1], row.help[2])
    return { def = row, check = cb, label = label, link = link, help = help }
end

-- Places a column's sections from top. The labels share the column's widest label (wrapped when the column is
-- too narrow), so the links line up. Returns the bottom.
local function layoutColumn(x, colW, sections, top)
    local labelW, linkW = 0, 0
    for _, s in ipairs(sections) do
        for _, r in ipairs(s.rows) do
            r.link:Fit()
            local w = width(r.label) + (r.help and (UI.HELP_GAP + UI.HELP_SIZE) or 0)
            labelW = math.max(labelW, w)
            linkW = math.max(linkW, r.link:GetWidth())
        end
    end
    local room = colW - L.check - L.checkGap - L.linkGap - linkW
    labelW = math.max(1, math.min(labelW, room))
    local y = top
    for i, s in ipairs(sections) do
        if i > 1 then
            y = y - L.sectionGap
        end
        s.heading:ClearAllPoints()
        s.heading:SetPoint("TOPLEFT", x, y)
        y = y - height(s.heading) - L.headingGap
        for _, r in ipairs(s.rows) do
            local textW = labelW - (r.help and (UI.HELP_GAP + UI.HELP_SIZE) or 0)
            r.label:SetWidth(textW)
            local h = math.max(L.row, height(r.label) + L.rowPad)
            r.check:ClearAllPoints()
            r.check:SetPoint("TOPLEFT", x - 4, y - (h - L.check) / 2)
            r.label:ClearAllPoints()
            r.label:SetPoint("LEFT", r.check, "RIGHT", L.checkGap, 0)
            r.link:ClearAllPoints()
            r.link:SetPoint("LEFT", r.check, "RIGHT", L.checkGap + labelW + L.linkGap, 0)
            r.top, r.h = y, h
            y = y - h
        end
    end
    return y
end

-- Lays the page out from its text sizes, so it fits at every text size: run on every showing (the text size is
-- changed on General Settings, so the page is hidden then).
function Start.Layout()
    local v = view
    if not v.page then
        return
    end
    -- the title, with the intro and the Welcome button on its line
    local top = 8
    local lineH = math.max(height(v.title), height(v.intro), L.button)
    v.title:ClearAllPoints()
    v.title:SetPoint("TOPLEFT", L.x, -(top + (lineH - height(v.title)) / 2))
    v.intro:ClearAllPoints()
    v.intro:SetPoint("TOPLEFT", L.x + width(v.title) + L.introGap, -(top + (lineH - height(v.intro)) / 2))
    -- the button's width from its label at the current text size
    local fs = v.welcome:GetFontString()
    v.welcome:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
    v.welcome:ClearAllPoints()
    v.welcome:SetPoint("LEFT", v.intro, "RIGHT", L.linkGap, 0)
    local y = -(top + lineH + L.whatsOnGap)
    v.whatsOn:ClearAllPoints()
    v.whatsOn:SetPoint("TOPLEFT", L.x, y)
    y = y - height(v.whatsOn) - L.headingGap - L.sectionGap
    local left, right = {}, {}
    for i, s in ipairs(v.sections) do
        if i == 1 then
            left[#left + 1] = s
        else
            right[#right + 1] = s
        end
    end
    local bottomL = layoutColumn(L.x + 4, L.col2 - L.x - L.colGap, left, y)
    local bottomR = layoutColumn(L.col2 + 4, UI.PAGE_W - L.col2 - L.x, right, y)
    v.bottom = math.min(bottomL, bottomR)
end

function Start.Refresh()
    for _, r in ipairs(view.rows) do
        r.check:SetChecked(get(r.def))
        r.link.refresh()
    end
end

local function build(pf)
    local v = view
    v.page = pf
    v.title = pf:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    v.title:SetText(TEXT.title)
    v.intro = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    v.intro:SetText(TEXT.intro)
    v.welcome = UI.PanelButton(pf, TEXT.welcome, L.button, function()
        if CRT.Welcome then
            CRT.Welcome:Open()
        end
    end)
    v.welcome:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
        GameTooltip:SetText(TEXT.welcome, 1, 1, 1)
        UI.AddTooltipText(GameTooltip, TEXT.welcomeTip)
        GameTooltip:Show()
    end)
    v.welcome:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    v.whatsOn = pf:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    v.whatsOn:SetText(TEXT.whatsOn)
    UI.HelpRight(v.whatsOn, TEXT.whatsOn, TEXT.whatsOnHelp)
    v.sections = {}
    for _, section in ipairs(WHATS_ON) do
        local s = { heading = pf:CreateFontString(nil, "OVERLAY", "CRTFontSmall"), rows = {} }
        s.heading:SetText(UI.HeadingText(section.title))
        UI.ThemedText(s.heading, function()
            return UI.HeadingText(section.title)
        end)
        for _, row in ipairs(section) do
            local r = buildRow(pf, row)
            s.rows[#s.rows + 1] = r
            v.rows[#v.rows + 1] = r
        end
        v.sections[#v.sections + 1] = s
    end
    pf:SetScript("OnShow", function()
        Start.Layout()
        Start.Refresh()
    end)
    Start.Layout()
    Start.Refresh()
end

UI:RegisterPage("start", TEXT.title, build)

-- Opens the main window on Start here.
function Start.Open()
    UI:Show("start")
end
