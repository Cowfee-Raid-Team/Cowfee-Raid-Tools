local ADDON, CRT = ...

-- The Special part of the Mech Alerts tab (Notes/Reminders.lua builds it into the tab): the Special (N) |
-- Mechanics toggle over the left list, the boss's special alerts (Alerts/Special.lua, from its boss file)
-- for the difficulty on show, each with its on/off tick and its icon (Special.Icon) in its ability type's colour, and
-- on the right the selected one: its name, "special alert" and Alert me, then the subtabs (Alerts/SubTabs.lua, owner
-- "special", the Mechanics panel's strip): When (the When line as its data says it, Show from with Default for the boss
-- file's), Who (a rotation's steps as chips, a roles list as "Roles: Tank, Healer"), Looks (Show as, Bar fill, Count
-- down to; your choices, saved at once), Sound and speech (Speak the text), Shield bar (Alerts/ShieldSection.lua, as in
-- the alert editor: your shield bar over the entry's absorb, Special:SetChoice "absorb", with Default for the boss
-- file's) and Markers (greyed: an addon can't set them); Test at the bottom right on every tab. The tab hands it the boss, the difficulty group and the ability timeline
-- on show (host), and the places of its list and panel. Special first: the tab opens on Special every time
-- (M.Opened), a boss with none too. A click on Mechanics holds for that boss until the tab is left; Make a
-- Mech Alert opens it on Mechanics (M.ShowMechanics). CRT.db.alerts.specialView and specialViewPicked, the
-- older saved pick, are no longer read or written.

local UI = CRT.UI

-- Every word of the Special view, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    mechanics = "Mechanics",
    special = "Special (%d)",
    toggleHelp = "Special lists this tier's prepared alerts for the boss, such as soak rotations. Tick the ones you want. Mechanics is for your own reminders: an ability a special alert already covers is marked Special there.",
    empty = "No special alerts for this boss yet.",
    emptyHint = "Mechanics has every ability for your own reminders.",
    kind = "special alert",
    alertMe = "Alert me",
    when = "When",
    whenHelp = "When the alert comes, from the boss's data. Casts are read from the ability timeline picked in Times from. A time with a minus comes before the pull: it plays from the game's pull timer, never in a rehearsal.",
    whenRow = "Each cast of %s: %s. Shown %s s before.",
    whenNoCasts = "Each cast of %s. None on the ability timeline on show.",
    whenTimes = "At %s. Shown %s s before.",
    showFrom = "Duration",
    showFromHelp = "How long before the specified time this alert should start showing up. Default puts back the shipped time.",
    showFromTip = "How long before the specified time this alert should start showing up",
    seconds = "%d s",
    default = "Default",
    impacts = "Impacts: %s",
    impactsToCast = "Impacts: %s. The bar ends at the cast.",
    barLength = "Bar %s s",
    barLengthFrom = "Bar %s s from %s s %s the cast",
    before = "before",
    after = "after",
    barImpacts = "%s, impacts at %s",
    secondsWord = "%s s",
    andWord = " and ",
    spell = "spell %d",
    who = "Who",
    whoHelp = "Who gets each cast. In turn: the first cast goes to the first step, the next cast to the next, and so on, then from the start again. Only the players of a cast's step get its alert. Roles: every cast goes to the players the words name, by role, class, raid group or name.",
    everyone = "Everyone, on every cast.",
    rotation = "In turn, one step per cast:",
    roles = "Roles: %s",
    noteLine = "The names on the raid note's \"%s\" line:",
    noNoteLine = "The raid note has no \"%s\" line yet.",
    more = "+%d",
    you = "This step has you.",
    showAs = "Show as",
    showAsHelp = "Where the alert shows: the note callout, the alert areas (Critical alerts text, Icon, Bar, Circle, Alert timeline), and whether it is read out. Alert Settings sets how each one looks.",
    callout = "Note callout/assignments",
    showText = "Critical alerts text",
    showIcon = "Icon",
    bar = "Bar",
    circle = "Circle",
    timeline = "Alert timeline",
    speak = "Speak the text",
    barFill = "Bar fill",
    fillUp = "Bar fills up",
    fillDown = "Bar empties",
    countTo = "Count down to",
    countCast = "The cast",
    countImpact = "Each impact",
    countHelp = "What the bar's number counts down to: the end of the cast, or the next hit.",
    markers = "Markers",
    markersHelp = "Addons can't put raid markers on players. Since patch 12.0 only the game's own menus and the /tm macro can. So the alert names its marks in its text instead.",
    marks = "Marks for each step: %s. Named in the alert's text.",
    noMarks = "This alert has no marks.",
    markThem = "Mark the players",
    test = "Test",
    noTest = "Nothing to test: this alert has no times on the ability timeline on show.",
}

local L = {
    INSET = 12,
    TOGGLE_PAD = 10, -- each side of a toggle label
    TOGGLE_MIN_W = 60,
    TOGGLE_GAP = 4,
    ROW_H = 24,
    EMPTY_GAP = 6, -- the empty list's hint under its line
    CHECK_SIZE = 24,
    CHECK_LABEL_W = 96,
    SHOW_GAP = 10,
    CHIP_H = 18,
    CHIP_PAD = 6,
    CHIP_GAP = 6,
    MAX_CHIPS = 12,
    TEST_W = 80,
    BUTTON_H = 22,
    BOTTOM_Y = 10,
    -- the panel's rows, from its top: the header, then the subtabs (Alerts/SubTabs.lua) with a rule under them, then
    -- the open tab's rows from CONTENT_Y (the Mechanics panel's numbers, Notes/Reminders.lua, so both line up)
    TITLE_Y = -14, KIND_Y = -36, ALERT_Y = -12,
    TABS_Y = -66, RULE_Y = -90, CONTENT_Y = -100,
    MESSAGE_Y = -408, -- under the tabs' rows, on every tab
    -- Show from: the Mechanics panel's slider (Notes/Reminders.lua's SHOW_LABEL, SLIDER_W), Default after its (?)
    LEAD_LABEL = 70, LEAD_W = 150, DEFAULT_GAP = 8,
    ALERT_W = 130, -- Alert me and its label, at the header's right
    FILL_LABEL = 90, FILL_W = 120, -- Bar fill under Show as, and Count down to under it
}
-- each tab's rows, from the top of the tab's content
local TOP = L.CONTENT_Y
-- When: the When line (its (?) after it), the impacts under it, Duration and Default
L.WHEN_TEXT_Y, L.IMPACTS_Y, L.LEAD_Y = TOP, TOP - 16, TOP - 32
-- Who: its heading, the roles or rotation line, the chips
L.WHO_Y, L.WHO_TEXT_Y, L.CHIPS_Y = TOP, TOP - 20, TOP - 38
-- Looks: Show as (its two rows of boxes under the heading), Bar fill, Count down to
L.SHOW_Y, L.FILL_Y, L.COUNT_Y = TOP, TOP - 80, TOP - 102
-- Sound and speech: Speak the text. Shield bar: the section (Alerts/ShieldSection.lua's column) over the panel's width
L.SPEAK_Y, L.SHIELD_Y = TOP, TOP
-- Markers: its heading, the marks line, Mark the players
L.MARK_Y, L.MARK_TEXT_Y, L.MARK_CHECK_Y = TOP, TOP - 20, TOP - 36

-- the lists' look, shared with the Mechanics list (Notes/MechLook.lua)
local Look = CRT.MechLook
local GREY, TIMES_GREY = Look.GREY, Look.TIMES_GREY
local OFF_ALPHA = 0.5 -- the Markers section, which can't be used

local M = {}
CRT.NoteSpecialAlerts = M

-- host: { boss = fn -> encounterID, name; group = fn -> "nh" or "mythic"; reference = fn -> entry or nil;
-- view = fn(view) after the toggle changed }. ui: every frame. state: the session's choices.
local host, ui = nil, {}
local state = { picked = {}, views = {}, offset = 0, notice = nil, shields = {} }

local function width(fs)
    local w = fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth() or fs:GetStringWidth()
    return math.ceil(tonumber(w) or 0)
end

local function Special()
    return CRT.AlertSpecial
end

-- The boss's special alerts for the difficulty on show.
local function entries()
    local S = Special()
    local enc = host and host.boss()
    if not (S and enc) then
        return {}, enc
    end
    return S:List(enc, host.group()), enc
end

-- The view on show, "mechanics" or "special", for the boss on show: the one picked for it since the tab
-- opened, else Special.
function M.View()
    local _, enc = entries()
    return enc and state.views[enc] or "special"
end

-- A pick on the toggle: held for the boss on show until the tab is left.
local function setView(view)
    local _, enc = entries()
    if enc then
        state.views[enc] = view == "special" and "special" or "mechanics"
    end
end

-- The tab opened (its OnShow): every boss is on Special again.
function M.Opened()
    state.views = {}
end

-- Shows a boss's Mechanics for this visit (Mech Alerts opened on one of its abilities). Called once the tab
-- is on show, after M.Opened.
function M.ShowMechanics(encounterID)
    if encounterID ~= nil then
        state.views[encounterID] = "mechanics"
    end
end

local function selected(list, enc)
    local key = enc and state.picked[enc]
    for _, e in ipairs(list) do
        if e.key == key then
            return e
        end
    end
    if list[1] and enc then
        state.picked[enc] = list[1].key
    end
    return list[1]
end

local function ref()
    local entry = host and host.reference and host.reference()
    return entry and entry.ref or nil
end

-- The words of When.
local function whenText(enc, entry)
    local S, Reminders = Special(), CRT.AlertReminders
    local lead = tostring(S:Lead(enc, entry)) -- your Show from, else the entry's
    if entry.when.list then
        return string.format(TEXT.whenTimes, Reminders.FormatTimes(entry.when.list), lead)
    end
    local name = entry.when.row or Reminders.SpellName(entry.when.spellID) or string.format(TEXT.spell, entry.when.spellID)
    local times = S:Times(enc, entry, host.group(), ref())
    if #times == 0 then
        return string.format(TEXT.whenNoCasts, name)
    end
    return string.format(TEXT.whenRow, name, Reminders.FormatTimes(times), lead)
end

-- "+0:02.5": seconds after the cast as minutes and seconds.
local function after(t)
    local m = math.floor(t / 60)
    local sec = t - m * 60
    return "+" .. m .. ":" .. (sec == math.floor(sec) and string.format("%02d", sec) or string.format("%04.1f", sec))
end

local function joined(list)
    if #list <= 1 then
        return list[1] or ""
    end
    return table.concat(list, ", ", 1, #list - 1) .. TEXT.andWord .. list[#list]
end

-- The line under When: the bar's impacts, or nil for an alert with none. Ticks after the cast read "Impacts:
-- +0:00, +0:02.5"; a bar of its own "Bar 8 s, impacts at 4.5 s and 6.5 s".
function M.ImpactsText(entry)
    local imp = entry and entry.impacts
    if not imp then
        return nil
    end
    if imp.length then
        local bar = string.format(TEXT.barLength, string.format("%g", imp.length))
        if imp.start ~= 0 then
            bar = string.format(TEXT.barLengthFrom, string.format("%g", imp.length), string.format("%g", math.abs(imp.start)),
                imp.start < 0 and TEXT.before or TEXT.after)
        end
        if #imp.inBar == 0 then
            return bar
        end
        local list = {}
        for i, t in ipairs(imp.inBar) do
            list[i] = string.format(TEXT.secondsWord, string.format("%g", t))
        end
        return string.format(TEXT.barImpacts, bar, joined(list))
    end
    local list = {}
    for i, t in ipairs(imp.ticks) do
        list[i] = after(t)
    end
    return string.format(imp.barTo == "cast" and TEXT.impactsToCast or TEXT.impacts, table.concat(list, ", "))
end

-- The toggle ---------------------------------------------------------------------------------------

-- UI.Toggle2 (CRT_Core/UI/Toggle.lua). Each half as wide as its label (the count changes the first), side by
-- side. When both and the (?) after them don't fit the list's width (a large text size), both shrink in
-- proportion and their labels are cut with "...". Measured on every draw, so a text size changed since is followed.
local function layToggle()
    ui.toggle:Size(L.LIST_W - UI.HELP_GAP - UI.HELP_SIZE)
    ui.toggle:PlaceLeft(L.X, L.Y)
end

-- The list ---------------------------------------------------------------------------------------

local function paintList(list, enc, current)
    local maxRows = #ui.rows
    local maxOffset = math.max(0, #list - maxRows)
    state.offset = math.max(0, math.min(state.offset, maxOffset))
    local selColor = { Look.SelectedColor(UI:IsModern()) }
    for i, row in ipairs(ui.rows) do
        local entry = list[state.offset + i]
        if entry then
            local on = Special():Choices(enc, entry).on
            local isSel = entry == current
            row.entry = entry
            row.check:SetChecked(on)
            -- its icon (Special.Icon), drawn as the Mechanics list draws one
            Look.SetIcon(row.icon, Special().Icon(enc, entry, host.group(), ref()))
            row.name:SetText(entry.label)
            row.name:SetTextColor(Look.NameColor(entry.type, on, isSel))
            row.sel:SetColorTexture(selColor[1], selColor[2], selColor[3], selColor[4])
            row.sel:SetShown(isSel)
            row.frame:Show()
        else
            row.entry = nil
            row.frame:Hide()
        end
    end
    ui.empty:SetShown(#list == 0)
    ui.emptyHint:SetShown(#list == 0)
end

-- The panel ----------------------------------------------------------------------------------------

local function chip(i)
    local c = ui.chips[i]
    if c then
        return c
    end
    c = CreateFrame("Frame", nil, ui.whoFrame, "BackdropTemplate")
    if c.SetBackdrop then
        c:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    end
    c.text = c:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    c.text:SetPoint("CENTER")
    ui.chips[i] = c
    return c
end

-- The steps as chips in order ("1: G1, G2"), as many as fit on one line, then "+N"; yours edged in the accent.
local function drawChips(steps)
    local S = Special()
    local x, right = L.INSET, L.PANEL_W - L.INSET
    local shown = 0
    for i = 1, math.max(#ui.chips, math.min(#(steps or {}), L.MAX_CHIPS)) do
        local step = steps and steps[i]
        local c = (step and i <= L.MAX_CHIPS) and chip(i) or ui.chips[i]
        if c then
            if step and i <= L.MAX_CHIPS then
                c.text:SetText(i .. ": " .. table.concat(step.words, ", "))
                local w = width(c.text) + 2 * L.CHIP_PAD
                if x + w <= right - 30 then
                    c:SetSize(w, L.CHIP_H)
                    c:ClearAllPoints()
                    c:SetPoint("TOPLEFT", x, L.CHIPS_Y)
                    local mine = S.IsMine(step)
                    if c.SetBackdropColor then
                        local bg, edge = CRT.PALETTE.surface or GREY, mine and CRT.PALETTE.accent or (CRT.PALETTE.border or GREY)
                        c:SetBackdropColor(bg[1], bg[2], bg[3], 0.9)
                        c:SetBackdropBorderColor(edge[1], edge[2], edge[3], 1)
                    end
                    c.mine = mine
                    c:Show()
                    x = x + w + L.CHIP_GAP
                    shown = shown + 1
                else
                    c:Hide()
                end
            else
                c:Hide()
            end
        end
    end
    local left = #(steps or {}) - shown
    ui.more:SetShown(left > 0)
    if left > 0 then
        ui.more:SetText(string.format(TEXT.more, left))
        ui.more:ClearAllPoints()
        ui.more:SetPoint("TOPLEFT", x, L.CHIPS_Y - 3)
    end
end

-- Draws Who. Returns whether it picks players (a rotation, the raid note's line or a roles list with any in it), not
-- Everyone: the Who tab's dot.
local function drawWho(enc, entry)
    local S = Special()
    local mode = entry.who.mode
    local steps
    local picks = false
    if mode == "rotation" then
        ui.whoText:SetText(TEXT.rotation)
        steps = entry.who.steps
        picks = #(steps or {}) > 0
    elseif mode == "note" then
        steps = S.NoteSteps(S.NoteFor(nil, enc), entry.who.note)
        ui.whoText:SetText(string.format(#steps > 0 and TEXT.noteLine or TEXT.noNoteLine, entry.who.note))
        picks = #steps > 0
    elseif mode == "roles" then
        -- one list for every cast, so no chips: its words, each with a capital
        local words = {}
        for i, w in ipairs(entry.who.roles) do
            words[i] = w:sub(1, 1):upper() .. w:sub(2)
        end
        ui.whoText:SetText(string.format(TEXT.roles, table.concat(words, ", ")))
        picks = #words > 0
    else
        ui.whoText:SetText(TEXT.everyone)
    end
    drawChips(steps)
    return picks
end

-- The selected alert's choices in a draft's shape, for the subtabs' dots (Alerts/SubTabs.lua's on functions): its
-- Show as boxes, Speak the text, the shield bar in use, and for Who and Markers whoPicks and marked (marks, and Mark
-- the players on).
function M.TabState(enc, entry, c, picks)
    local a = Special():Absorb(enc, entry, c)
    return { show = c.show, speak = c.speak,
        shield = a and { on = true, unit = a.unit, length = a.length, anyDifficulty = a.anyDifficulty } or nil,
        whoPicks = picks and true or false, marked = entry.marks ~= nil and c.markers == true }
end

local function drawMarkers(entry)
    local S = Special()
    local allowed = S.MARKING.allowed == true
    if entry.marks then
        local names = {}
        for i, m in ipairs(entry.marks) do
            names[i] = S.MarkName(m)
        end
        ui.markText:SetText(string.format(TEXT.marks, table.concat(names, ", ")))
    else
        ui.markText:SetText(TEXT.noMarks)
    end
    -- greyed, with the reason in its (?): an addon can't set raid markers (Alerts/Special.lua)
    for _, part in ipairs({ ui.markHeading, ui.markText, ui.markCheck, ui.markCheck.label }) do
        part:SetAlpha(allowed and 1 or OFF_ALPHA)
    end
    ui.markCheck:SetEnabled(allowed and entry.marks ~= nil)
    ui.markCheck:SetChecked(false)
end

local function placeShowAs()
    local Draft = CRT.AlertDraft
    local rows = {}
    for r, keys in ipairs(Draft.SHOW_ROWS) do
        rows[r] = {}
        for i, key in ipairs(keys) do
            rows[r][i] = ui.checks[key]
        end
    end
    -- over the Looks tab's width
    Draft.FlowShowAs(rows, L.INSET - 4, L.PANEL_W - L.INSET, L.CHECK_SIZE + 2, L.SHOW_GAP, function(check, x, r)
        check:ClearAllPoints()
        check:SetPoint("TOPLEFT", x, L.SHOW_Y - 20 - (r - 1) * 26)
    end)
end

local function drawPanel(enc, entry)
    ui.content:SetShown(entry ~= nil)
    if not entry then
        return
    end
    local c = Special():Choices(enc, entry)
    ui.title:SetText(entry.label)
    ui.titleHelp:SetShown(entry.help ~= nil)
    ui.alertMe:SetChecked(c.on)
    ui.whenText:SetText(whenText(enc, entry))
    local impacts = M.ImpactsText(entry)
    ui.impactsText:SetText(impacts or "")
    ui.impactsText:SetShown(impacts ~= nil)
    ui.lead.refresh()
    ui.leadDefault:SetEnabled(c.lead ~= nil) -- greyed while the shipped lead is on
    local picks = drawWho(enc, entry)
    placeShowAs()
    for key, check in pairs(ui.checks) do
        check:SetChecked(c.show[key] and true or false)
    end
    ui.speak:SetChecked(c.speak)
    ui.fill.refresh()
    -- a shield bar (yours or the entry's absorb) fills with the shield left, not with time: nothing to choose
    ui.fill:SetShown(Special():Absorb(enc, entry, c) == nil)
    ui.shield.Refresh(true)
    ui.countTo.refresh()
    drawMarkers(entry)
    ui.message:SetText(state.notice and UI.BadText(state.notice) or "")
    -- each tab's dot: something on it is on
    ui.tabs:Paint(M.TabState(enc, entry, c, picks))
end

-- Draws the view: the toggle always, the Special list and panel while Special is on show.
function M.Refresh()
    if not ui.mechBtn then
        return
    end
    local list, enc = entries()
    ui.specialBtn.text:SetText(string.format(TEXT.special, #list))
    layToggle()
    local view = M.View()
    local special = view == "special"
    -- SetTabSelected skins the whole tab (UI:SkinTree), so only when the view changes; a plain redraw restyles
    local changed = ui.tabView ~= view
    ui.tabView = view
    ui.toggle:Select(view, changed)
    ui.list:SetShown(special)
    ui.panel:SetShown(special)
    if not special then
        return
    end
    local current = selected(list, enc)
    paintList(list, enc, current)
    drawPanel(enc, current)
end

local function current()
    local list, enc = entries()
    return selected(list, enc), enc
end

local function choose(view)
    if view ~= M.View() then
        state.notice = nil
        setView(view)
        if host.view then
            host.view(view)
        end
    end
    M.Refresh()
end

local function setChoice(field, show)
    return function(on)
        local entry, enc = current()
        if entry then
            state.notice = nil
            Special():SetChoice(enc, entry, field, on, show) -- fires the alerts change, which redraws the tab
            M.Refresh()
        end
    end
end

local function test()
    local entry, enc = current()
    if not entry then
        return
    end
    local item = Special():TestItem(enc, entry, host.group(), ref())
    local Editor = CRT.AlertEditor
    local ok, err = false, TEXT.noTest
    if item and Editor and Editor.TestItem then
        ok, err = Editor:TestItem(enc, item)
    end
    state.notice = not ok and (err or TEXT.noTest) or nil
    M.Refresh()
end

-- Building ---------------------------------------------------------------------------------------

local function makeCheck(parent, label, x, y, onClick)
    local check = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    check:SetSize(L.CHECK_SIZE, L.CHECK_SIZE)
    check:SetPoint("TOPLEFT", x, y)
    local text = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", check, "RIGHT", 2, 0)
    text:SetWidth(L.CHECK_LABEL_W)
    text:SetJustifyH("LEFT")
    text:SetWordWrap(false)
    text:SetText(label)
    check.label = text
    check:SetScript("OnClick", function(self)
        onClick(self:GetChecked() and true or false)
    end)
    return check
end

local function heading(parent, label, y, helpTitle, helpText)
    local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    fs:SetPoint("TOPLEFT", L.INSET, y)
    fs:SetText(label)
    if helpText then
        UI.HelpRight(fs, helpTitle or label, helpText)
    end
    return fs
end

-- A line of text over the panel's width (w: narrower, such as room for a (?) after it).
local function line(parent, y, w)
    local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    fs:SetPoint("TOPLEFT", L.INSET, y)
    fs:SetWidth(w or (L.PANEL_W - 2 * L.INSET))
    fs:SetJustifyH("LEFT")
    fs:SetWordWrap(false)
    return fs
end

local function backdrop(f, alpha)
    if f.SetBackdrop then
        f:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
        local function paint()
            local bg, edge = CRT.PALETTE.background, CRT.PALETTE.border
            f:SetBackdropColor(bg[1] * 0.8, bg[2] * 0.8, bg[3] * 0.8, alpha)
            f:SetBackdropBorderColor(edge[1], edge[2], edge[3], 1)
        end
        paint()
        UI:OnTheme(paint)
    end
end

local function makeRow(parent, i)
    local frame = CreateFrame("Button", nil, parent)
    frame:SetSize(L.LIST_W - 4, L.ROW_H - 2)
    frame:SetPoint("TOPLEFT", 2, -2 - (i - 1) * L.ROW_H)
    local row = { frame = frame }
    row.sel = frame:CreateTexture(nil, "BACKGROUND")
    row.sel:SetAllPoints()
    row.sel:Hide()
    local hl = frame:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.06)
    row.check = CreateFrame("CheckButton", nil, frame, "UICheckButtonTemplate")
    row.check:SetSize(22, 22)
    row.check:SetPoint("LEFT", 2, 0)
    row.check:SetScript("OnClick", function(self)
        local _, enc = entries()
        if row.entry and enc then
            Special():SetChoice(enc, row.entry, "on", self:GetChecked() and true or false)
            M.Refresh()
        end
    end)
    row.icon = Look.MakeIcon(frame)
    row.icon:Hide()
    row.name = frame:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    row.name:SetPoint("LEFT", Look.NAME_X, 0)
    row.name:SetWidth(L.LIST_W - 4 - Look.NAME_X - 8)
    row.name:SetJustifyH("LEFT")
    row.name:SetWordWrap(false)
    frame:SetScript("OnClick", function()
        local _, enc = entries()
        if row.entry and enc then
            state.picked[enc] = row.entry.key
            state.notice = nil
            M.Refresh()
        end
    end)
    frame:SetScript("OnEnter", function(self)
        local e = row.entry
        if not (e and GameTooltip and UI.TooltipOwner) then
            return
        end
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_RIGHT")
        GameTooltip:SetText(e.label, 1, 1, 1)
        if e.help then
            GameTooltip:AddLine(e.help, 0.85, 0.85, 0.85, true)
        end
        GameTooltip:Show()
    end)
    frame:SetScript("OnLeave", function()
        if GameTooltip then
            GameTooltip:Hide()
        end
    end)
    return row
end

-- Show from: your lead for the selected alert (Special:SetChoice "lead"), the Mechanics panel's slider; its (?),
-- then Default (UI.PanelButton), which puts the entry's own lead back.
local function setLead(value)
    local entry, enc = current()
    if entry then
        state.notice = nil
        Special():SetChoice(enc, entry, "lead", value) -- fires the alerts change, which redraws the tab
        M.Refresh()
    end
end

local function buildLead(p)
    local S = Special()
    ui.lead = UI.Slider(p, TEXT.showFrom, {
        min = S.LEAD_MIN, max = S.LEAD_MAX, step = 1, labelWidth = L.LEAD_LABEL, width = L.LEAD_W,
        tipTitle = TEXT.showFrom, tipText = TEXT.showFromTip,
        format = function(v)
            return string.format(TEXT.seconds, math.floor(v + 0.5))
        end,
        onRelease = true, -- saved when the bar is let go, not on every step of a drag
        get = function()
            local entry, enc = current()
            return entry and Special():Lead(enc, entry) or S.LEAD_MIN
        end,
        set = setLead,
    })
    ui.lead:SetPoint("TOPLEFT", L.INSET, L.LEAD_Y)
    ui.leadHelp = UI.HelpRight(ui.lead, TEXT.showFrom, TEXT.showFromHelp)
    ui.leadDefault = UI.PanelButton(p, TEXT.default, L.BUTTON_H, function()
        setLead(nil)
    end)
    ui.leadDefault:SetPoint("LEFT", ui.leadHelp, "RIGHT", L.DEFAULT_GAP, 0)
end

-- The Shield bar section: your shield bar for the selected alert as the section shows one ({ on, unit, length,
-- anyDifficulty }): the one in use (Special:Absorb), or, while there is none, the last one picked for it this session,
-- else the entry's own, else a new alert's (Draft.NewShield), greyed.
local function shieldState()
    local entry, enc = current()
    if not entry then
        return nil
    end
    local a = Special():Absorb(enc, entry)
    local base = a or state.shields[enc .. ":" .. entry.key] or entry.absorb or CRT.AlertDraft.NewShield()
    return { on = a ~= nil, unit = base.unit, length = base.length, anyDifficulty = base.anyDifficulty and true or false }
end

-- A change in the section: saved as your choice at once (Special:SetChoice "absorb": false for Shield bar unticked,
-- nothing kept while it is the entry's own). The pick is remembered for the session, so a tick puts it back.
local function setShield(field, value)
    local entry, enc = current()
    local s = shieldState()
    if not (entry and s) then
        return
    end
    local on = s.on
    local pick = { unit = s.unit, length = s.length, anyDifficulty = s.anyDifficulty }
    if field == "on" then
        on = value and true or false
    else
        pick[field] = value
    end
    state.shields[enc .. ":" .. entry.key] = pick
    state.notice = nil
    Special():SetChoice(enc, entry, "absorb", on and pick or false) -- fires the alerts change, which redraws the tab
    M.Refresh()
end

local function buildShield(p)
    ui.shield = CRT.AlertShieldSection.Build(p, {
        layout = "column", note = true, x = L.INSET, y = L.SHIELD_Y, width = L.PANEL_W - 2 * L.INSET,
        buttonHeight = L.BUTTON_H,
        get = shieldState,
        set = setShield,
        -- an entry for both difficulty groups (no difficulty) plays everywhere: Any time adds nothing
        anyApplies = function()
            local entry = current()
            return entry ~= nil and entry.difficulty ~= nil
        end,
        barOn = function()
            local entry, enc = current()
            return entry ~= nil and Special():Choices(enc, entry).show.bar and true or false
        end,
        encounterID = function()
            local _, enc = current()
            return enc
        end,
        -- Default: back to the boss file's shield bar (or none), shown only while yours differs
        default = {
            show = function()
                local entry, enc = current()
                return entry ~= nil and Special():Choices(enc, entry).absorb ~= nil
            end,
            click = function()
                local entry, enc = current()
                if entry then
                    state.shields[enc .. ":" .. entry.key] = nil
                    state.notice = nil
                    Special():SetChoice(enc, entry, "absorb", nil)
                    M.Refresh()
                end
            end,
        },
    })
end

-- When: the When line (its (?) after it, so the line leaves room for it), the impacts under it, Duration and Default.
local function buildWhen(p)
    ui.whenText = line(p, L.WHEN_TEXT_Y, L.PANEL_W - 2 * L.INSET - UI.HELP_GAP - UI.HELP_SIZE)
    ui.whenText:SetTextColor(TIMES_GREY[1], TIMES_GREY[2], TIMES_GREY[3])
    ui.whenHelp = UI.HelpRight(ui.whenText, TEXT.when, TEXT.whenHelp)
    ui.impactsText = line(p, L.IMPACTS_Y)
    ui.impactsText:SetTextColor(TIMES_GREY[1], TIMES_GREY[2], TIMES_GREY[3])
    buildLead(p)
end

-- Who: its heading and (?), the roles or rotation line, and the steps as chips (drawChips).
local function buildWho(p)
    ui.whoFrame = p
    ui.whoHeading = heading(p, TEXT.who, L.WHO_Y, nil, TEXT.whoHelp)
    ui.whoText = line(p, L.WHO_TEXT_Y)
    ui.chips = {}
    ui.more = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    ui.more:Hide()
end

-- Markers: greyed, with the reason in its (?) (drawMarkers).
local function buildMarkers(p)
    ui.markHeading = heading(p, TEXT.markers, L.MARK_Y, nil, TEXT.markersHelp)
    ui.markText = line(p, L.MARK_TEXT_Y)
    ui.markCheck = makeCheck(p, TEXT.markThem, L.INSET - 4, L.MARK_CHECK_Y, setChoice("markers"))
    ui.markCheck.label:SetWidth(L.PANEL_W / 2)
end

-- Looks: Show as, then Bar fill and Count down to under it.
local function buildLooks(p)
    heading(p, TEXT.showAs, L.SHOW_Y, nil, TEXT.showAsHelp)
    ui.checks = {}
    local labels = { alert = TEXT.callout, text = TEXT.showText, icon = TEXT.showIcon, bar = TEXT.bar, circle = TEXT.circle,
        timeline = TEXT.timeline }
    for key, label in pairs(labels) do
        ui.checks[key] = makeCheck(p, label, L.INSET - 4, L.SHOW_Y, setChoice(key, true))
    end
    placeShowAs()
    -- Bar fill: whether the bar fills up to the cast or empties, saved with your choices; greyed while Bar is off
    ui.fill = UI.Dropdown(p, TEXT.barFill, {
        labelWidth = L.FILL_LABEL, width = L.FILL_W,
        options = { { key = "up", label = TEXT.fillUp }, { key = "down", label = TEXT.fillDown } },
        enabledIf = function()
            local entry, enc = current()
            return entry ~= nil and Special():Choices(enc, entry).show.bar and true or false
        end,
        get = function()
            local entry, enc = current()
            return entry and Special():Choices(enc, entry).fill or "up"
        end,
        set = function(key)
            local entry, enc = current()
            if entry then
                state.notice = nil
                Special():SetChoice(enc, entry, "fill", key)
                M.Refresh()
            end
        end,
    })
    ui.fill:SetPoint("TOPLEFT", L.INSET, L.FILL_Y)
    -- Count down to: the bar's number counts to the cast (the default) or to each impact; greyed while the bar has no
    -- ticks (a shield bar's impacts don't apply)
    ui.countTo = UI.Dropdown(p, TEXT.countTo, {
        labelWidth = L.FILL_LABEL, width = L.FILL_W,
        options = CRT.AlertDraft.CountOptions(TEXT.countCast, TEXT.countImpact),
        enabledIf = function()
            local entry, enc = current()
            if not (entry and entry.impacts) then
                return false
            end
            local c = Special():Choices(enc, entry)
            return c.show.bar and Special():Absorb(enc, entry, c) == nil and true or false
        end,
        get = function()
            local entry, enc = current()
            return entry and Special():Choices(enc, entry).countTo or "cast"
        end,
        set = function(key)
            local entry, enc = current()
            if entry then
                state.notice = nil
                Special():SetChoice(enc, entry, "countTo", key)
                M.Refresh()
            end
        end,
    })
    ui.countTo:SetPoint("TOPLEFT", L.INSET, L.COUNT_Y)
    UI.HelpRight(ui.countTo, TEXT.countTo, TEXT.countHelp)
end

local function buildPanel(f)
    local frame = CreateFrame("Frame", nil, f, "BackdropTemplate")
    frame:SetSize(L.PANEL_W, L.PANEL_H)
    frame:SetPoint("TOPLEFT", L.PANEL_X, L.PANEL_Y)
    backdrop(frame, 0.6)
    ui.panel = frame
    local p = CreateFrame("Frame", nil, frame)
    p:SetPoint("TOPLEFT", frame, "TOPLEFT", 0, 0)
    p:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", 0, 0)
    ui.content = p

    ui.title = p:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    ui.title:SetPoint("TOPLEFT", L.INSET, L.TITLE_Y)
    ui.title:SetWidth(L.PANEL_W - 2 * L.INSET - L.ALERT_W - UI.HELP_GAP - UI.HELP_SIZE - 8)
    ui.title:SetJustifyH("LEFT")
    ui.title:SetWordWrap(false)
    -- the selected alert's own help, under its name
    ui.titleHelp = UI.HelpRight(ui.title, function()
        local entry = current()
        return entry and entry.label or TEXT.kind
    end, function()
        local entry = current()
        return entry and entry.help or ""
    end)
    ui.kind = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    ui.kind:SetPoint("TOPLEFT", L.INSET, L.KIND_Y)
    ui.kind:SetText(TEXT.kind)
    UI.Tint(ui.kind, "SetTextColor", "muted")
    ui.alertMe = makeCheck(p, TEXT.alertMe, L.PANEL_W - L.INSET - L.ALERT_W, L.ALERT_Y, setChoice("on"))

    -- Under the header, the subtabs (Alerts/SubTabs.lua, shared with the Mechanics panel and the alert editor): each
    -- tab's controls are built into its own frame, so only the open tab's show. The tab picked stays when another row
    -- is picked, and for the session.
    ui.tabs = CRT.AlertSubTabs.Build(p, { owner = "special", x = L.INSET, y = L.TABS_Y,
        rule = { y = L.RULE_Y, left = L.INSET, right = L.INSET }, maxW = L.PANEL_W - 2 * L.INSET })
    local tf = ui.tabs.frames
    buildWhen(tf.when)
    buildWho(tf.who)
    buildLooks(tf.looks)
    ui.speak = makeCheck(tf.sound, TEXT.speak, L.INSET - 4, L.SPEAK_Y, setChoice("speak"))
    buildShield(tf.shield)
    buildMarkers(tf.markers)

    -- Under the tabs, on every tab: Test's problem, and Test at the bottom right
    ui.message = line(p, L.MESSAGE_Y)

    local b = CreateFrame("Button", nil, p, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetText(TEXT.test)
    local fs = b.GetFontString and b:GetFontString()
    b:SetSize(math.max(L.TEST_W, UI.PanelButtonWidth and UI.PanelButtonWidth(fs and width(fs) or 0) or L.TEST_W), L.BUTTON_H)
    b:SetPoint("BOTTOMRIGHT", -L.INSET, L.BOTTOM_Y)
    if CRT.AlertEditor and CRT.AlertEditor.BindTest then
        CRT.AlertEditor:BindTest(b, "special", test) -- reads Stop while its test plays
    else
        b:SetScript("OnClick", test)
    end
    ui.testBtn = b
end

-- Builds the view into the tab f. h: the host (see above). g: where things go, in the tab's numbers:
-- x, y (the toggle's top left), toggleH, listY, listW, listH (the Special list, down to the tab's
-- bottom), panelX, panelY, panelW, panelH. Returns the parts, for the tab and the tests.
function M.Build(f, h, g)
    host = h
    ui, state = {}, { picked = {}, views = {}, offset = 0, notice = nil, shields = {} }
    L.X, L.Y, L.TOGGLE_H = g.x, g.y, g.toggleH
    L.LIST_W, L.LIST_H = g.listW, g.listH
    L.PANEL_X, L.PANEL_Y, L.PANEL_W, L.PANEL_H = g.panelX, g.panelY, g.panelW, g.panelH

    -- Special on the left, Mechanics on the right, the (?) after it
    ui.toggle = UI.Toggle2(f, { { key = "special", label = string.format(TEXT.special, 0) }, { key = "mechanics", label = TEXT.mechanics } },
        choose, { pad = L.TOGGLE_PAD, minW = L.TOGGLE_MIN_W, gap = L.TOGGLE_GAP, h = L.TOGGLE_H })
    ui.specialBtn, ui.mechBtn = ui.toggle.buttons[1], ui.toggle.buttons[2]
    layToggle()
    ui.toggleHelp = UI.HelpRight(ui.mechBtn, TEXT.mechanics, TEXT.toggleHelp)

    local list = CreateFrame("Frame", nil, f, "BackdropTemplate")
    list:SetSize(L.LIST_W, L.LIST_H)
    list:SetPoint("TOPLEFT", L.X, g.listY)
    backdrop(list, 0.8)
    ui.list = list
    ui.rows = {}
    for i = 1, math.floor((L.LIST_H - 4) / L.ROW_H) do
        ui.rows[i] = makeRow(list, i)
    end
    list:EnableMouseWheel(true)
    list:SetScript("OnMouseWheel", function(_, delta)
        state.offset = state.offset + (delta > 0 and -1 or 1)
        M.Refresh()
    end)
    ui.empty = list:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    ui.empty:SetPoint("TOPLEFT", 8, -8)
    ui.empty:SetWidth(L.LIST_W - 16)
    ui.empty:SetJustifyH("LEFT")
    ui.empty:SetText(TEXT.empty)
    UI.Tint(ui.empty, "SetTextColor", "muted")
    -- and where your own reminders are
    ui.emptyHint = list:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    ui.emptyHint:SetPoint("TOPLEFT", ui.empty, "BOTTOMLEFT", 0, -L.EMPTY_GAP)
    ui.emptyHint:SetWidth(L.LIST_W - 16)
    ui.emptyHint:SetJustifyH("LEFT")
    ui.emptyHint:SetText(TEXT.emptyHint)
    UI.Tint(ui.emptyHint, "SetTextColor", "muted")

    buildPanel(f)
    list:Hide()
    ui.panel:Hide()
    M.Refresh()
    return ui
end

M.TEXT = TEXT
