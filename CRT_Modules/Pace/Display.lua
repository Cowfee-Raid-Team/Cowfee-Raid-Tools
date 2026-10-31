local ADDON, CRT = ...

-- The pace window: during a pull of a boss with a pace plan, one bar per boss unit in the plan showing
-- its health, a tick where its health should be now, and AHEAD or BEHIND.
--
-- In combat the game hides boss health from addons (a secret value), so the addon never compares it.
-- The bar gets UnitHealthPercent through the game's ScaleTo100 curve, which a status bar accepts as it
-- is. AHEAD and BEHIND are faded in by two step curves built around the expected health: the game
-- runs the hidden health through them and SetAlpha takes the result, so the game does the comparing.
-- The curves are rebuilt only when the expected health moves. Each bar is named for its boss unit, with
-- fallbacks for when the game hides the name (setLabel, below).
--
-- During a Timeline rehearsal (the alerts engine running one) of a boss with a plan, the window shows
-- too, on the rehearsal's clock and phases. No boss is there, so each bar sits on its tick: always on
-- pace, to show where the plan wants the health. It closes when the rehearsal ends.

local Pace = CRT.Pace
local UI = CRT.UI

local BAR_W, BAR_H = 220, 16
local ROW_H = 40
local TICK_EVERY = 0.2

local frame, handle
local bars = {}
local run -- { encounterID, plan, units, pullAt, rehearsal } while a pull (or a rehearsal) with a plan runs
local previewOn = false

local function db()
    return CRT.db.pace
end

-- Asks whether it is secret first, so a secret is never compared, even with nil.
local function readable(v)
    return not (issecretvalue and issecretvalue(v)) and v ~= nil
end

-- A step curve on health 0 to 1: `below` under the expected health e, `above` from e up.
local function stepCurve(e, below, above)
    if not (C_CurveUtil and C_CurveUtil.CreateCurve) then
        return nil
    end
    local ok, c = pcall(C_CurveUtil.CreateCurve)
    if not ok or not c then
        return nil
    end
    local built = pcall(function()
        if Enum and Enum.LuaCurveType and Enum.LuaCurveType.Linear then
            c:SetType(Enum.LuaCurveType.Linear)
        end
        local x = math.max(0.002, math.min(0.998, e))
        c:AddPoint(0, below)
        c:AddPoint(x - 0.001, below)
        c:AddPoint(x, above)
        c:AddPoint(1, above)
    end)
    return built and c or nil
end

-- The window ---------------------------------------------------------------------------------------

local build

-- Its place, drag, nudge, reset and anchor are the shared helper's (UI/Placement.lua). Held by its top, so a new
-- bar grows it downwards.
local placement = UI.Placement.Define("pace", {
    title = "Pace",
    store = db,
    default = { point = "TOP", relativePoint = "TOP", x = 0, y = -260 },
    point = "TOP",
    build = function()
        build()
    end,
})

function Pace:ResetPosition()
    placement:Reset()
end

local function bar(i)
    local b = bars[i]
    if b then
        return b
    end
    b = CreateFrame("Frame", nil, frame)
    b:SetSize(BAR_W + 16, ROW_H)
    b:SetPoint("TOPLEFT", 0, -6 - (i - 1) * ROW_H)
    b.label = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.label:SetPoint("TOPLEFT", 8, 0)
    b.state = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.state:SetPoint("TOPRIGHT", -8, 0)
    b.bar = CreateFrame("StatusBar", nil, b)
    b.bar:SetSize(BAR_W, BAR_H)
    b.bar:SetPoint("TOPLEFT", 8, -16)
    b.bar:SetStatusBarTexture("Interface\\Buttons\\WHITE8X8")
    b.bar:SetStatusBarColor(0.75, 0.2, 0.2, 1)
    b.bar:SetMinMaxValues(0, 100)
    local bg = b.bar:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(0, 0, 0, 0.6)
    b.tick = b.bar:CreateTexture(nil, "OVERLAY")
    b.tick:SetSize(2, BAR_H + 6)
    b.tick:SetColorTexture(1, 1, 1, 1)
    b.ahead = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.ahead:SetPoint("RIGHT", b.state, "LEFT", -4, 0)
    UI.ThemedText(b.ahead, function()
        return UI.GoodText("AHEAD")
    end)
    b.behind = b:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    b.behind:SetPoint("RIGHT", b.state, "LEFT", -4, 0)
    UI.ThemedText(b.behind, function()
        return UI.BadText("BEHIND")
    end)
    bars[i] = b
    return b
end

function build()
    if frame then
        return
    end
    frame = CreateFrame("Frame", "CowfeeRaidToolsPace", UIParent, "BackdropTemplate")
    frame:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI:RegisterThemed(frame, { bg = { 0.05, 0.05, 0.07, 0.8 }, border = { 0.78, 0.63, 0.31 } })
    UI:RegisterLayer("alert", frame)
    frame:SetClampedToScreen(true)

    handle = CreateFrame("Frame", nil, frame, "BackdropTemplate")
    handle:SetHeight(20)
    handle:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8X8", edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 1 })
    UI:RegisterThemed(handle, { bg = { 0.3, 0.25, 0.05, 0.9 }, border = { 0.78, 0.63, 0.31 } })
    local text = handle:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    text:SetPoint("LEFT", 6, 0)
    text:SetText("Pace: drag to move")
    local reset = UI.ResetButton(handle, function()
        Pace:ResetPosition()
    end)
    reset:SetPoint("RIGHT", -2, 0)
    UI.Placement.FitHandle(handle, frame, text)
    handle:Hide()
    frame:Hide()
    placement:Attach(frame, handle, { reset = reset })
end

local function layout(units)
    for i, b in ipairs(bars) do
        b:SetShown(i <= #units)
    end
    for i = 1, #units do
        bar(i):Show()
    end
    frame:SetSize(BAR_W + 16, 10 + #units * ROW_H)
end

-- The phase and seconds into it, from the alerts engine's phase clock, else phase 1 from the pull. In a
-- rehearsal the pull is the engine's time for 0:00, which moves when the rehearsal jumps.
local function where()
    local Alerts = CRT.Alerts
    local now = GetTime()
    if run.rehearsal then
        now = Alerts:Now()
        run.pullAt = Alerts:TimeAt(0)
    end
    local ph = Alerts and Alerts.CurrentPhase and Alerts:CurrentPhase()
    local at = ph and Alerts:PhaseStart(ph)
    if run.plan.mode == "time" then
        return 1, now - run.pullAt
    end
    if ph and at then
        -- a phase start is on the engine's clock (Alerts:Now, the rehearsal's during a rehearsal)
        return ph, (Alerts.Now and Alerts:Now() or now) - at
    end
    return 1, now - run.pullAt
end

-- A rehearsal's bar: the plan's own health, on its tick.
local function setRehearsalBar(b, i, expected)
    b.label:SetText(i == 1 and run.bossName or ("Boss " .. i))
    b.bar:SetValue(expected or 0)
    b.ahead:SetAlpha(0)
    b.behind:SetAlpha(0)
    if not expected then
        b.tick:Hide()
        b.state:SetText("")
        return
    end
    b.tick:ClearAllPoints()
    b.tick:SetPoint("CENTER", b.bar, "LEFT", BAR_W * expected / 100, 0)
    b.tick:Show()
    b.state:SetText(string.format("should be %.0f%%", expected))
end

-- Each bar's name. In combat the game hides a boss unit's name (UnitName gives a secret), so, best first:
--   1. the name, when it reads;
--   2. the hidden name, given to the label as it is (FontString:SetText takes a secret) and never compared;
--   3. the name kept from when it last read (at the pull, a boss unit engaging, or an earlier update), per
--      encounter for this session only, never saved;
--   4. on a plan with one boss unit, the boss's name from the boss library;
--   5. the unit token.
local names = {} -- [encounterID][unit] = name

-- The unit's name when it reads; else nil, and true with the secret itself when the game hid it.
local function readName(unit)
    local ok, name = pcall(UnitName, unit)
    if not ok then
        return nil
    end
    if issecretvalue and issecretvalue(name) then
        return nil, true, name
    end
    if name == nil or name == "" or (UNKNOWNOBJECT and name == UNKNOWNOBJECT) then
        return nil -- no unit, or the game's placeholder for one not loaded yet
    end
    return name
end

-- Keeps a unit's name for this pull's boss, when it reads. Returns the name, or nil.
local function remember(unit, name)
    local id = run and run.encounterID
    name = name or readName(unit)
    if id and name then
        names[id] = names[id] or {}
        names[id][unit] = name
    end
    return name
end

-- Every unit of the pull's plan: at the pull, and when a boss unit engages.
local function rememberAll()
    if run and not run.rehearsal then
        for _, unit in ipairs(run.units) do
            remember(unit)
        end
    end
end

local function setLabel(b, unit)
    local name, isSecret, hidden = readName(unit)
    if name then
        remember(unit, name)
        b.label:SetText(name)
        return
    end
    if isSecret and pcall(b.label.SetText, b.label, hidden) then
        return
    end
    local kept = run.encounterID and names[run.encounterID] and names[run.encounterID][unit]
    if kept then
        b.label:SetText(kept)
    elseif #run.units == 1 and run.bossName then
        b.label:SetText(run.bossName)
    else
        b.label:SetText(unit)
    end
end

local function setBar(b, unit, expected)
    setLabel(b, unit)
    -- The health: hidden in combat, given to the bar as it is.
    local scale = CurveConstants and CurveConstants.ScaleTo100
    local ok, hp = pcall(UnitHealthPercent, unit, true, scale)
    if ok and hp ~= nil then
        pcall(b.bar.SetValue, b.bar, hp)
    end
    if not expected then
        b.tick:Hide()
        b.state:SetText("")
        b.ahead:SetAlpha(0)
        b.behind:SetAlpha(0)
        return
    end
    b.tick:ClearAllPoints()
    b.tick:SetPoint("CENTER", b.bar, "LEFT", BAR_W * expected / 100, 0)
    b.tick:Show()
    b.state:SetText(string.format("should be %.0f%%", expected))
    -- Curves are rebuilt only when the expected health moves by a tenth of a percent.
    local key = math.floor(expected * 10 + 0.5)
    if b.curveKey ~= key then
        b.curveKey = key
        b.aheadCurve = stepCurve(expected / 100, 1, 0)
        b.behindCurve = stepCurve(expected / 100, 0, 1)
    end
    for _, pair in ipairs({ { b.ahead, b.aheadCurve }, { b.behind, b.behindCurve } }) do
        local fs, curve = pair[1], pair[2]
        local shown = false
        if curve then
            local okA, alpha = pcall(UnitHealthPercent, unit, true, curve)
            if okA and alpha ~= nil then
                shown = pcall(fs.SetAlpha, fs, alpha)
            end
        end
        if not shown then
            fs:SetAlpha(0)
        end
    end
end

local elapsed = 0
local function onUpdate(_, dt)
    elapsed = elapsed + dt
    if elapsed < TICK_EVERY or not run then
        return
    end
    elapsed = 0
    local ph, seconds = where()
    for i, unit in ipairs(run.units) do
        if run.rehearsal then
            setRehearsalBar(bar(i), i, Pace.Expected(run.plan, unit, ph, seconds))
            bar(i):SetAlpha(1)
        elseif UnitExists(unit) then
            setBar(bar(i), unit, Pace.Expected(run.plan, unit, ph, seconds))
            bar(i):SetAlpha(1)
        else
            setLabel(bar(i), unit)
            bar(i):SetAlpha(0.3)
        end
    end
end

-- rehearsal: true for a Timeline rehearsal, on the alerts engine's clock (see the top of this file).
function Pace:Start(encounterID, rehearsal)
    local plan = self:Plan(encounterID)
    if not plan or not self:Enabled(encounterID) or db().shown == false then
        self:Stop()
        return
    end
    build()
    local units = Pace.Units(plan)
    if #units == 0 then
        return
    end
    run = { encounterID = encounterID, plan = plan, units = units, pullAt = GetTime(), rehearsal = rehearsal and true or nil }
    local def = encounterID and CRT.Bosses and CRT.Bosses:Get(encounterID)
    run.bossName = def and def.name or (rehearsal and "Boss" or nil)
    rememberAll()
    elapsed = TICK_EVERY -- the first update draws at once
    for _, b in ipairs(bars) do
        b.curveKey = nil
    end
    layout(units)
    frame:SetScript("OnUpdate", onUpdate)
    frame:Show()
end

function Pace:Stop()
    run = nil
    if frame then
        frame:SetScript("OnUpdate", nil)
        if not previewOn then
            frame:Hide()
        end
    end
end

-- Previews: a sample bar, half way, with the tick at 60%, named for the boss the Pace page shows.
UI:RegisterPreview("pace", function(on)
    previewOn = on and true or false
    build()
    handle:SetShown(previewOn)
    if previewOn then
        layout({ "boss1" })
        local b = bar(1)
        local id = Pace.PageBoss and Pace:PageBoss()
        local def = id and CRT.Bosses and CRT.Bosses:Get(id)
        b.label:SetText(def and def.name or "Boss")
        b.bar:SetValue(50)
        b.tick:ClearAllPoints()
        b.tick:SetPoint("CENTER", b.bar, "LEFT", BAR_W * 0.6, 0)
        b.tick:Show()
        b.state:SetText("should be 60%")
        b.ahead:SetAlpha(1)
        b.behind:SetAlpha(0)
        frame:Show()
    elseif not run then
        frame:Hide()
    end
end)

local events = CreateFrame("Frame")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("ENCOUNTER_END")
events:RegisterEvent("INSTANCE_ENCOUNTER_ENGAGE_UNIT") -- a boss unit appeared: keep its name while it reads
events:SetScript("OnEvent", function(_, event, encounterID)
    if not CRT.db then
        return
    end
    if event == "INSTANCE_ENCOUNTER_ENGAGE_UNIT" then
        rememberAll()
    elseif event == "ENCOUNTER_START" then
        Pace:Start(readable(encounterID) and encounterID or nil)
    else
        Pace:Stop()
    end
end)

-- A Timeline rehearsal starting or ending (the alerts engine's change event). A real pull's run is
-- never touched here.
local function followRehearsal()
    local Alerts = CRT.Alerts
    if not CRT.db or (run and not run.rehearsal) then
        return
    end
    local enc = Alerts:IsRehearsal() and Alerts.run and Alerts.run.encounterID
    if enc then
        if not (run and run.encounterID == enc) then
            Pace:Start(enc, true)
        end
    elseif run then
        Pace:Stop()
    end
end

if CRT.Alerts and CRT.Alerts.OnChange then
    CRT.Alerts:OnChange(followRehearsal)
end
