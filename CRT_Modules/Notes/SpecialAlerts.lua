local ADDON, CRT = ...

-- The Special part of the Mech Alerts tab (Notes/Reminders.lua builds it into the tab): the Mechanics |
-- Special (N) toggle over the left list, the boss's special alerts (Alerts/Special.lua, from its boss file)
-- for the difficulty on show, each with its on/off tick in its ability type's colour, and on the right the
-- selected one: When and Who as its data says them, Show as (your choices, saved at once), Markers (greyed:
-- an addon can't set them) and Test. The tab hands it the boss, the difficulty group and the ability timeline
-- on show (host), and the places of its list and panel. The toggle's choice is saved in
-- CRT.db.alerts.specialView; Mechanics is the default.

local UI = CRT.UI

-- Every word of the Special view, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    mechanics = "Mechanics",
    special = "Special (%d)",
    toggleHelp = "Mechanics lists the boss's abilities and your own reminders. Special lists the boss's special alerts: scripted calls such as soak rotations. Each is off until you tick it.",
    empty = "No special alerts for this boss yet.",
    kind = "special alert",
    alertMe = "Alert me",
    when = "When",
    whenHelp = "When the alert comes, from the boss's data. Casts are read from the ability timeline Times from names.",
    whenRow = "Each cast of %s: %s. Shown %s s before.",
    whenNoCasts = "Each cast of %s. None on the ability timeline on show.",
    whenTimes = "At %s. Shown %s s before.",
    spell = "spell %d",
    who = "Who",
    whoHelp = "Who gets each cast. In turn: the first cast goes to the first step, the next cast to the next, and so on, then from the start again. Only the players of a cast's step get its alert.",
    everyone = "Everyone, on every cast.",
    rotation = "In turn, one step per cast:",
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
    NAME_X = 30,
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
    -- the panel's rows, from its top
    TITLE_Y = -14, KIND_Y = -36, ALERT_Y = -12,
    WHEN_Y = -62, WHEN_TEXT_Y = -82,
    WHO_Y = -108, WHO_TEXT_Y = -128, CHIPS_Y = -146,
    SHOW_Y = -176, SPEAK_Y = -248,
    MARK_Y = -282, MARK_TEXT_Y = -302, MARK_CHECK_Y = -318,
    MESSAGE_Y = -352,
    ALERT_W = 130, -- Alert me and its label, at the header's right
}

local GREY = { 0.5, 0.5, 0.5 }
local WHITE = { 1, 1, 1 }
local TIMES_GREY = { 0.55, 0.5, 0.45 }
local OFF_ALPHA = 0.5 -- the Markers section, which can't be used

local M = {}
CRT.NoteSpecialAlerts = M

-- host: { boss = fn -> encounterID, name; group = fn -> "nh" or "mythic"; reference = fn -> entry or nil;
-- view = fn(view) after the toggle changed }. ui: every frame. state: the session's choices.
local host, ui = nil, {}
local state = { picked = {}, offset = 0, notice = nil }

local function width(fs)
    local w = fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth() or fs:GetStringWidth()
    return math.ceil(tonumber(w) or 0)
end

local function Special()
    return CRT.AlertSpecial
end

local function db()
    return CRT.db and CRT.db.alerts
end

-- The view on show: "mechanics" (the default) or "special".
function M.View()
    local s = db()
    return s and s.specialView == "special" and "special" or "mechanics"
end

local function setView(view)
    local s = db()
    if s then
        s.specialView = view == "special" and "special" or "mechanics"
    end
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

-- A name's colour: its ability type's, dimmed when off and lifted when selected (as the Mechanics rows).
local function mix(c, to, t)
    return { c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t, c[3] + (to[3] - c[3]) * t }
end

local function nameColor(entry, on, isSelected)
    local Colors = CRT.AlertColors
    local c = entry.type and Colors and Colors.KnownTypeColor(entry.type)
    if not c then
        c = on and CRT.PALETTE.text or GREY
        return c[1], c[2], c[3]
    end
    if not on then
        c = mix(c, GREY, 0.5)
    end
    if isSelected then
        c = mix(c, WHITE, 0.5)
    end
    return c[1], c[2], c[3]
end

-- The words of When.
local function whenText(enc, entry)
    local S, Reminders = Special(), CRT.AlertReminders
    local lead = tostring(entry.lead)
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

-- The toggle ---------------------------------------------------------------------------------------

local function toggleButton(parent, label, onClick)
    local b = CreateFrame("Button", nil, parent, "BackdropTemplate")
    if b.SetBackdrop then
        b:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    end
    b.sel = b:CreateTexture(nil, "ARTWORK")
    b.sel:SetAllPoints()
    b.sel:SetColorTexture(UI.Color("heading", 0.18)) -- UI:RegisterTab styles it from here on
    b.text = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.text:SetPoint("CENTER")
    b.text:SetText(label)
    b:SetScript("OnClick", onClick)
    UI:RegisterTab(b)
    return b
end

-- Each half of the toggle as wide as its label (the count changes the second), side by side.
local function layToggle()
    local x = 0
    for _, b in ipairs({ ui.mechBtn, ui.specialBtn }) do
        b:SetSize(math.max(L.TOGGLE_MIN_W, width(b.text) + 2 * L.TOGGLE_PAD), L.TOGGLE_H)
        b:ClearAllPoints()
        b:SetPoint("TOPLEFT", L.X + x, L.Y)
        x = x + b:GetWidth() + L.TOGGLE_GAP
    end
end

-- The list ---------------------------------------------------------------------------------------

local function paintList(list, enc, current)
    local maxRows = #ui.rows
    local maxOffset = math.max(0, #list - maxRows)
    state.offset = math.max(0, math.min(state.offset, maxOffset))
    local m = CRT.PALETTE.selected
    for i, row in ipairs(ui.rows) do
        local entry = list[state.offset + i]
        if entry then
            local on = Special():Choices(enc, entry).on
            local isSel = entry == current
            row.entry = entry
            row.check:SetChecked(on)
            row.name:SetText(entry.label)
            row.name:SetTextColor(nameColor(entry, on, isSel))
            if UI:IsModern() then
                row.sel:SetColorTexture(m[1], m[2], m[3], 0.95)
            else
                row.sel:SetColorTexture(UI.Color("heading", 0.18))
            end
            row.sel:SetShown(isSel)
            row.frame:Show()
        else
            row.entry = nil
            row.frame:Hide()
        end
    end
    ui.empty:SetShown(#list == 0)
end

-- The panel ----------------------------------------------------------------------------------------

local function chip(i)
    local c = ui.chips[i]
    if c then
        return c
    end
    c = CreateFrame("Frame", nil, ui.panel, "BackdropTemplate")
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

local function drawWho(enc, entry)
    local S = Special()
    local mode = entry.who.mode
    local steps
    if mode == "rotation" then
        ui.whoText:SetText(TEXT.rotation)
        steps = entry.who.steps
    elseif mode == "note" then
        steps = S.NoteSteps(S.NoteFor(nil, enc), entry.who.note)
        ui.whoText:SetText(string.format(#steps > 0 and TEXT.noteLine or TEXT.noNoteLine, entry.who.note))
    else
        ui.whoText:SetText(TEXT.everyone)
    end
    drawChips(steps)
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
    drawWho(enc, entry)
    placeShowAs()
    for key, check in pairs(ui.checks) do
        check:SetChecked(c.show[key] and true or false)
    end
    ui.speak:SetChecked(c.speak)
    drawMarkers(entry)
    ui.message:SetText(state.notice and UI.BadText(state.notice) or "")
end

-- Draws the view: the toggle always, the Special list and panel while Special is on show.
function M.Refresh()
    if not ui.mechBtn then
        return
    end
    local list, enc = entries()
    ui.specialBtn.text:SetText(string.format(TEXT.special, #list))
    layToggle()
    local special = M.View() == "special"
    UI:SetTabSelected(ui.mechBtn, not special)
    UI:SetTabSelected(ui.specialBtn, special)
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

local function line(parent, y)
    local fs = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    fs:SetPoint("TOPLEFT", L.INSET, y)
    fs:SetWidth(L.PANEL_W - 2 * L.INSET)
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
    row.name = frame:CreateFontString(nil, "OVERLAY", "CRTFontNormal")
    row.name:SetPoint("LEFT", L.NAME_X, 0)
    row.name:SetWidth(L.LIST_W - 4 - L.NAME_X - 8)
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
    ui.titleHelp = UI.HelpRight(ui.title, TEXT.kind, function()
        local entry = current()
        return entry and entry.help or ""
    end)
    ui.kind = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    ui.kind:SetPoint("TOPLEFT", L.INSET, L.KIND_Y)
    ui.kind:SetText(TEXT.kind)
    UI.Tint(ui.kind, "SetTextColor", "muted")
    ui.alertMe = makeCheck(p, TEXT.alertMe, L.PANEL_W - L.INSET - L.ALERT_W, L.ALERT_Y, setChoice("on"))

    heading(p, TEXT.when, L.WHEN_Y, nil, TEXT.whenHelp)
    ui.whenText = line(p, L.WHEN_TEXT_Y)
    ui.whenText:SetTextColor(TIMES_GREY[1], TIMES_GREY[2], TIMES_GREY[3])

    heading(p, TEXT.who, L.WHO_Y, nil, TEXT.whoHelp)
    ui.whoText = line(p, L.WHO_TEXT_Y)
    ui.chips = {}
    ui.more = p:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    ui.more:Hide()

    heading(p, TEXT.showAs, L.SHOW_Y, nil, TEXT.showAsHelp)
    ui.checks = {}
    local labels = { alert = TEXT.callout, text = TEXT.showText, icon = TEXT.showIcon, bar = TEXT.bar, circle = TEXT.circle,
        timeline = TEXT.timeline }
    for key, label in pairs(labels) do
        ui.checks[key] = makeCheck(p, label, L.INSET - 4, L.SHOW_Y, setChoice(key, true))
    end
    placeShowAs()
    ui.speak = makeCheck(p, TEXT.speak, L.INSET - 4, L.SPEAK_Y, setChoice("speak"))

    ui.markHeading = heading(p, TEXT.markers, L.MARK_Y, nil, TEXT.markersHelp)
    ui.markText = line(p, L.MARK_TEXT_Y)
    ui.markCheck = makeCheck(p, TEXT.markThem, L.INSET - 4, L.MARK_CHECK_Y, setChoice("markers"))
    ui.markCheck.label:SetWidth(L.PANEL_W / 2)

    ui.message = line(p, L.MESSAGE_Y)

    local b = CreateFrame("Button", nil, p, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetText(TEXT.test)
    local fs = b.GetFontString and b:GetFontString()
    b:SetSize(math.max(L.TEST_W, UI.PanelButtonWidth and UI.PanelButtonWidth(fs and width(fs) or 0) or L.TEST_W), L.BUTTON_H)
    b:SetPoint("BOTTOMRIGHT", -L.INSET, L.BOTTOM_Y)
    b:SetScript("OnClick", test)
    ui.testBtn = b
end

-- Builds the view into the tab f. h: the host (see above). g: where things go, in the tab's numbers:
-- x, y (the toggle's top left), toggleH, listY, listW, listH (the Special list, down to the tab's
-- bottom), panelX, panelY, panelW, panelH. Returns the parts, for the tab and the tests.
function M.Build(f, h, g)
    host = h
    ui, state = {}, { picked = {}, offset = 0, notice = nil }
    L.X, L.Y, L.TOGGLE_H = g.x, g.y, g.toggleH
    L.LIST_W, L.LIST_H = g.listW, g.listH
    L.PANEL_X, L.PANEL_Y, L.PANEL_W, L.PANEL_H = g.panelX, g.panelY, g.panelW, g.panelH

    ui.mechBtn = toggleButton(f, TEXT.mechanics, function()
        choose("mechanics")
    end)
    ui.specialBtn = toggleButton(f, string.format(TEXT.special, 0), function()
        choose("special")
    end)
    layToggle()
    ui.toggleHelp = UI.HelpRight(ui.specialBtn, TEXT.mechanics, TEXT.toggleHelp)

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

    buildPanel(f)
    list:Hide()
    ui.panel:Hide()
    M.Refresh()
    return ui
end

M.TEXT = TEXT
