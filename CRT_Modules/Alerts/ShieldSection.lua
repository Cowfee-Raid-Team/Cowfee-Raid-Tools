local ADDON, CRT = ...

-- The Shield bar section: one builder for the alert editor (Alerts/Editor.lua, under Show as) and both Mech Alerts tabs
-- (Notes/SpecialAlerts.lua's Special panel and Notes/Reminders.lua's Mechanics panel). It edits a shield bar shown as
-- { on, unit, length, anyDifficulty } through its host's get and set, so each host keeps its own store: the editor's
-- and the Mechanics panel's draft (Alerts/Draft.lua's draft.shield, saved as a reminder's absorb or a note line's
-- shield:) and the Special tab's choice (Special:SetChoice "absorb"). The bar itself is Alerts/Absorb.lua's.
--   Shield bar (?)            ticked: the alert's bar is a shield bar. Greyed while Bar is off (or nothing may change)
--   Shield on                 Boss 1 to Boss 5 (Draft.ShieldUnitOptions)
--   Seconds to break          Draft.SHIELD_MIN to SHIELD_MAX, a step of 1
--   Any time it goes up (?)   the shield bar's anyDifficulty; greyed too for an alert set for every difficulty
--                             (opts.anyApplies), where it changes nothing
--   Last pull                 Alerts/ShieldPulls.lua: the boss units with a shield on the boss's last pull and when (each
--                             start), with a Use button each that picks it in Shield on; only for an alert on a boss
--   Default (optional)        the host's, after Any time's (?): shown while its show() says so
-- Shield on, Seconds to break, Any time and the Use buttons are greyed while Shield bar is unticked or greyed.
-- Two layouts (rows L.WIDE_ROW or L.ROW apart):
--   "wide"    the editor: Shield bar with Last pull beside it, Shield on and Seconds to break, Any time (three rows)
--   "column"  a panel's column: Shield bar with a short note beside it (opts.note), Shield on (with Any time beside it
--             when opts.anyBeside), Seconds to break, Any time (unless beside Shield on), then Last pull on a row of its own
-- Every piece placed TOPLEFT goes through opts.place, so the editor's saved-template layout moves it with its rows. The
-- Use and Default buttons are made as the editor's own buttons are (UIPanelButtonTemplate in CRT's button fonts,
-- UI:SkinButton for both looks), sized from their labels.

local UI = CRT.UI

local ShieldSection = {}
CRT.AlertShieldSection = ShieldSection

-- Every word of the section, in one place. Keep the keys, change the text in quotes, save, /reload.
local TEXT = {
    shieldBar = "Shield bar",
    shieldHelp = "Draws a bar of the boss's shield on every cast of this alert, and on any shield that goes up between them. The fill drains as the raid breaks it; the tick and seconds count the time you have.",
    note = "every cast above, plus any shield between them",
    shieldOn = "Shield on",
    shieldBoss = "Boss %d",
    shieldLength = "Seconds to break",
    seconds = "%d s",
    anyTime = "Any time it goes up",
    -- %s: Alerts/Absorb.lua's Absorb.GAP
    anyHelp = "On: the bar also comes on a difficulty this alert isn't set for, whenever the boss's shield goes up. On a difficulty it is set for, a shield that goes up between the casts gets a bar either way.\n\nGreyed for an alert set for every difficulty: it has nothing to add there.\n\nA new bar starts once the shield's hits stop for %s s.",
    lastPull = "Last pull: %s",
    lastPullMany = "Last pull: %d boss shields", -- two or three: the Use buttons name them, the tooltip says when
    lastPullTitle = "Last pull",
    lastPullShield = "Boss %d shield at %s",
    lastPullNone = "Last pull: no boss shield seen.",
    lastPullNever = "Last pull: no pull of this boss yet.",
    useUnit = "Use Boss %d",
    default = "Default",
}
ShieldSection.TEXT = TEXT

local L = {
    ROW = 24, WIDE_ROW = 28, -- between the rows: a panel's column, the editor
    CHECK = 24, CHECK_GAP = 2, -- a checkbox, and the gap before its label
    DROP_GAP = 5, -- CRT_Core/UI/Controls.lua: between a row's label and its control
    UNIT_LABEL = 60, UNIT_W = 90, -- Shield on
    LENGTH_LABEL = 100, LENGTH_W = 130, -- Seconds to break
    WIDE_LENGTH_X = 175, -- the editor: Seconds to break this far right of Shield on
    WIDE_TEXT_X = 135, -- the editor: Last pull this far right of the Shield bar box
    BESIDE_GAP = 8, -- Any time after Shield on, in a column with opts.anyBeside
    TEXT_DY = -6, -- a line of text beside a checkbox or a dropdown, this far below its top
    USE_GAP = 6, -- before each Use button
    BUTTON_H = 24,
    NOTE_GAP = 6, -- the note after Shield bar's (?)
    DEFAULT_GAP = 8, -- Default after Any time's (?)
}
ShieldSection.L = L

local EMPTY = {}

local function Draft()
    return CRT.AlertDraft
end

-- How tall a layout is: its rows, each L.ROW or L.WIDE_ROW.
function ShieldSection.Height(layout, anyBeside)
    if layout == "wide" then
        return 3 * L.WIDE_ROW
    end
    return (anyBeside and 4 or 5) * L.ROW
end

-- Any time's (?) text, with the untimed rule's gap from Alerts/Absorb.lua.
function ShieldSection.AnyHelp()
    local Absorb = CRT.AlertAbsorb
    local gap = Absorb and type(Absorb.GAP) == "number" and Absorb.GAP or 1.5
    return string.format(TEXT.anyHelp, ("%g"):format(gap))
end

local function textWidth(fs)
    local w = fs.GetUnboundedStringWidth and fs:GetUnboundedStringWidth() or fs:GetStringWidth()
    return math.ceil(tonumber(w) or 0)
end

-- The Last pull line's text, the boss units it names (Alerts/ShieldPulls.lua) and its tooltip's full text, for a boss.
-- One unit is named on the line, with each time it had a shield; two or three are counted there ("Last pull: 2 boss
-- shields"), the Use buttons naming each and the tooltip saying when, so nothing is cut short.
function ShieldSection.LastPull(encounterID)
    local SP = CRT.AlertShieldPulls
    local seen = SP and type(encounterID) == "number" and SP:Seen(encounterID) or nil
    if not seen then
        return TEXT.lastPullNever, {}, TEXT.lastPullNever
    elseif #seen == 0 then
        return TEXT.lastPullNone, seen, TEXT.lastPullNone
    end
    local parts = {}
    for i, e in ipairs(seen) do
        local clocks = {}
        for j, t in ipairs(e.times or { e.at }) do
            clocks[j] = SP.Clock(t)
        end
        parts[i] = string.format(TEXT.lastPullShield, SP.UnitNumber(e.unit), table.concat(clocks, ", "))
    end
    local text = #seen == 1 and string.format(TEXT.lastPull, parts[1]) or string.format(TEXT.lastPullMany, #seen)
    return text, seen, table.concat(parts, "\n")
end

local function makeCheck(parent, label, onClick)
    local check = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    check:SetSize(L.CHECK, L.CHECK)
    local text = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", check, "RIGHT", L.CHECK_GAP, 0)
    text:SetText(label)
    check.label = text
    check:SetScript("OnClick", function(self)
        onClick(self:GetChecked() and true or false)
    end)
    return check
end

-- A button as the editor's and the Mech Alerts panels' own (their makeButton): the game's panel button in CRT's button
-- fonts, skinned for both looks (UI:SkinButton, which a later UI:SkinTree leaves alone). Sized from its label later.
local function makeButton(parent, height, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetNormalFontObject(CRTFontNormal)
    b:SetHighlightFontObject(CRTFontHighlight)
    b:SetDisabledFontObject(CRTFontDisable)
    b:SetSize(UI.PanelButtonWidth(0), height)
    b:SetScript("OnClick", onClick)
    if UI.SkinButton then
        UI:SkinButton(b)
    end
    return b
end

local function sizeButton(b, label)
    b:SetText(label)
    local fs = b:GetFontString()
    b:SetWidth(UI.PanelButtonWidth(fs and fs:GetStringWidth() or 0))
end

-- Last pull: its line, a hover frame over it for the tooltip, and the Use buttons after it.
local function buildLastPull(s, parent, o, at, x, y)
    s.lastText = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    at(s.lastText, x, y)
    s.lastText:SetJustifyH("LEFT")
    s.lastText:SetWordWrap(false)
    s.lastHit = CreateFrame("Frame", nil, parent)
    s.lastHit:SetAllPoints(s.lastText)
    s.lastHit:EnableMouse(true)
    s.lastHit:SetScript("OnEnter", function(self)
        UI.TooltipOwner(GameTooltip, self, "ANCHOR_TOP")
        GameTooltip:SetText(TEXT.lastPullTitle, 1, 1, 1)
        GameTooltip:AddLine(s.lastTip or "", 0.85, 0.85, 0.85, true)
        GameTooltip:Show()
    end)
    s.lastHit:SetScript("OnLeave", function()
        GameTooltip:Hide()
    end)
    local prev = s.lastText
    for i = 1, CRT.AlertShieldPulls and CRT.AlertShieldPulls.MAX_SHOWN or 3 do
        local b = makeButton(parent, o.buttonHeight or L.BUTTON_H, function(self)
            if s.IsOn() and self.unit then
                o.set("unit", self.unit)
            end
        end)
        b:SetPoint("LEFT", prev, "RIGHT", L.USE_GAP, 0)
        b:Hide()
        s.use[i] = b
        prev = b
    end
end

-- Builds the section into parent. opts:
--   layout     "wide" or "column"; x, y its top left in parent; width the room it has from x
--   note       column: the short note beside Shield bar; anyBeside: column: Any time beside Shield on (four rows)
--   anyApplies function() -> false while Any time changes nothing (an alert set for every difficulty) (optional)
--   place      function(el, x, y) placing a piece TOPLEFT (default el:SetPoint("TOPLEFT", x, y))
--   register   function(row): the host redraws this dropdown or slider with its own (optional)
--   get        function() -> { on, unit, length, anyDifficulty }, or nil while there is nothing to show
--   set        function(field, value): field "on", "unit", "length" or "anyDifficulty"; the host saves and redraws
--   barOn      function() -> whether the alert's Bar is ticked
--   editable   function() -> false while nothing may change (optional)
--   encounterID function() -> the alert's boss, for Last pull (nil: no Last pull line)
--   default    { show = function() -> bool, click = function() } (optional)
--   buttonHeight the Use and Default buttons' height (default L.BUTTON_H)
-- Returns the section: check, help, note, unitRow, lengthRow, any, anyHelp, lastText, lastHit, lastTip, use, default,
-- and Refresh(rows), which draws it from get (rows: the dropdown and slider too).
function ShieldSection.Build(parent, o)
    local s = { use = {}, opts = o }
    local wide = o.layout == "wide"
    local R = wide and L.WIDE_ROW or L.ROW
    local place = o.place or function(el, x, y)
        el:SetPoint("TOPLEFT", x, y)
    end
    local function at(el, dx, dy)
        place(el, o.x + dx, o.y + dy)
        return el
    end
    local function register(row)
        if o.register then
            o.register(row)
        end
        return row
    end
    function s.IsOn()
        local v = o.get()
        local editable = not o.editable or o.editable()
        return editable and v ~= nil and v.on and o.barOn() and true or false
    end

    s.check = at(makeCheck(parent, TEXT.shieldBar, function(on) o.set("on", on) end), 0, 0)
    s.help = UI.HelpRight(s.check, TEXT.shieldBar, TEXT.shieldHelp)
    if o.note and not wide then
        s.note = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
        s.note:SetPoint("LEFT", s.help, "RIGHT", L.NOTE_GAP, 0)
        s.note:SetJustifyH("LEFT")
        s.note:SetWordWrap(false)
        s.note:SetText(TEXT.note)
        UI.Tint(s.note, "SetTextColor", "muted")
    end
    s.unitRow = register(at(UI.Dropdown(parent, TEXT.shieldOn, {
        labelWidth = L.UNIT_LABEL, width = L.UNIT_W, enabledIf = s.IsOn,
        options = function() return Draft().ShieldUnitOptions(TEXT.shieldBoss, { shield = o.get() }) end,
        get = function() return (o.get() or EMPTY).unit or Draft().SHIELD_UNITS[1] end,
        set = function(v) o.set("unit", v) end,
    }), 0, -R))
    local D = Draft()
    s.lengthRow = register(at(UI.Slider(parent, TEXT.shieldLength, {
        min = D.SHIELD_MIN, max = D.SHIELD_MAX, step = 1, labelWidth = L.LENGTH_LABEL, width = L.LENGTH_W,
        enabledIf = s.IsOn,
        format = function(v) return string.format(TEXT.seconds, v) end,
        get = function() return (o.get() or EMPTY).length or Draft().SHIELD_LENGTH end,
        set = function(v) o.set("length", v) end,
    }), wide and L.WIDE_LENGTH_X or 0, wide and -R or -2 * R))
    -- Any time: the editor's third row; a column's fourth, or beside Shield on
    local beside = not wide and o.anyBeside
    s.anyX = beside and (L.UNIT_LABEL + L.DROP_GAP + L.UNIT_W + L.BESIDE_GAP) or 0
    local anyY = beside and -R or ((wide and -2 or -3) * R)
    s.any = at(makeCheck(parent, TEXT.anyTime, function(on) o.set("anyDifficulty", on) end), s.anyX, anyY)
    s.anyHelp = UI.HelpRight(s.any, TEXT.anyTime, ShieldSection.AnyHelp())
    if o.default then
        s.default = makeButton(parent, o.buttonHeight or L.BUTTON_H, function()
            o.default.click()
        end)
        sizeButton(s.default, TEXT.default)
        s.default:SetPoint("LEFT", s.anyHelp, "RIGHT", L.DEFAULT_GAP, 0)
    end
    -- where Last pull sits, and the room it and its buttons have
    local lastX, lastY
    if wide then
        lastX, lastY = L.WIDE_TEXT_X, L.TEXT_DY
    else
        lastX, lastY = 0, (beside and -3 or -4) * R + L.TEXT_DY
    end
    s.lastRoom = o.width - lastX
    buildLastPull(s, parent, o, at, lastX, lastY)

    function s.Refresh(rows)
        ShieldSection.Refresh(s, rows)
    end
    return s
end

-- Draws a section from its host's get: the boxes, which parts are greyed, Default, and the Last pull line with a Use
-- button (sized from its label) for each boss unit it names, the line cut short when they don't all fit. rows: the
-- dropdown and slider too (a host that redraws them itself leaves it out).
function ShieldSection.Refresh(s, rows)
    local o = s.opts
    local v = o.get()
    local editable = not o.editable or o.editable()
    local barOn = editable and v ~= nil and o.barOn() and true or false
    local on = s.IsOn()
    v = v or EMPTY
    s.check:SetChecked(v.on and true or false)
    s.check:SetEnabled(barOn)
    s.check.label:SetAlpha(barOn and 1 or 0.5)
    if s.note then
        s.note:SetAlpha(barOn and 1 or 0.5)
        local before = L.CHECK + L.CHECK_GAP + textWidth(s.check.label) + UI.HELP_GAP + UI.HELP_SIZE + L.NOTE_GAP
        s.note:SetWidth(math.max(0, o.width - before))
    end
    s.any:SetChecked(v.anyDifficulty and true or false)
    local anyOn = on and (not o.anyApplies or o.anyApplies()) and true or false
    s.any:SetEnabled(anyOn)
    s.any.label:SetAlpha(anyOn and 1 or 0.5)
    if s.anyX > 0 then
        -- beside Shield on: its label is cut to the column (a large text size), its (?) after it
        local room = o.width - s.anyX - L.CHECK - L.CHECK_GAP - UI.HELP_GAP - UI.HELP_SIZE
        s.any.label:SetWordWrap(false)
        s.any.label:SetWidth(math.max(0, math.min(textWidth(s.any.label), room)))
    end
    -- a length saved above the usual top (a share, an older code) shows as it is
    if s.lengthRow.SetMax then
        s.lengthRow.SetMax(math.max(Draft().SHIELD_MAX, v.length or 0))
    end
    if rows then
        s.unitRow.refresh()
        s.lengthRow.refresh()
    end
    if s.default then
        s.default:SetShown(editable and o.default.show() and true or false)
    end
    local enc = o.encounterID and o.encounterID()
    local onBoss = type(enc) == "number"
    local text, seen, tip = ShieldSection.LastPull(enc)
    s.lastText:SetShown(onBoss)
    s.lastText:SetText(onBoss and text or "")
    s.lastTip = tip
    s.lastHit:SetShown(onBoss)
    -- a Use button for each unit while they fit the room (a narrow column takes fewer: Shield on lists every unit, the
    -- tooltip says when each had a shield)
    local buttons, full = 0, false
    for i, b in ipairs(s.use) do
        local e = onBoss and not full and seen[i]
        if e then
            sizeButton(b, string.format(TEXT.useUnit, CRT.AlertShieldPulls.UnitNumber(e.unit)))
            local w = L.USE_GAP + (b:GetWidth() or 0)
            if buttons + w > s.lastRoom then
                e, full = nil, true
            else
                buttons = buttons + w
                b.unit = e.unit
                b:SetEnabled(on)
            end
        end
        b:SetShown(e and true or false)
    end
    s.lastText:SetWidth(math.max(0, math.min(textWidth(s.lastText), s.lastRoom - buttons)))
end
