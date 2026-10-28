local ADDON, CRT = ...

-- Last pull's shields: on every boss pull (a run with reason "encounter", Alerts/Engine.lua's onPull), the time from
-- the pull that the first UNIT_ABSORB_AMOUNT_CHANGED came for each boss unit, boss1 to boss5. Only the time is kept:
-- the shield's amount is secret during an encounter and is never read here (no UnitGetTotalAbsorbs). The alert
-- editor's Shield bar section shows it ("Last pull: Boss 2 shield at 3:03.8") with a Use button for each unit, so a
-- shield race is set up from what the game showed on the last pull.
-- Saved per boss, the last pull only: CRT.db.alerts.shieldPulls[encounterID] = { at = time() of the pull,
-- units = { boss2 = 183.8, ... } } (seconds from the pull, to a tenth). A pull replaces its boss's record once it
-- sees a shield, or at its end when it lasted MIN_PULL seconds or more (so a pull with no shield says so); a quick wipe
-- that saw none keeps what the pull before found (Alex, 2026-10-28). The events are listened to only from the pull to the run's end, through
-- Frame:RegisterUnitEvent (up to four units a frame: two frames), and each unit's first event is the only one used.

local Alerts = CRT.Alerts

local ShieldPulls = {}
CRT.AlertShieldPulls = ShieldPulls

-- The saved table kept per boss, declared for the dev season purge (Bosses:DeclareField, CRT_Data/Bosses/Registry.lua).
if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("shield pulls", "alerts", "shieldPulls")
end

local EVENT = "UNIT_ABSORB_AMOUNT_CHANGED"
ShieldPulls.UNITS = { "boss1", "boss2", "boss3", "boss4", "boss5" }
local UNIT_GROUPS = { { "boss1", "boss2", "boss3", "boss4" }, { "boss5" } } -- RegisterUnitEvent takes up to four
local IS_UNIT = {}
for _, u in ipairs(ShieldPulls.UNITS) do
    IS_UNIT[u] = true
end
ShieldPulls.MAX_SHOWN = 3 -- the editor's Last pull line names at most this many
ShieldPulls.MIN_PULL = 30 -- seconds: a shorter pull with no shield leaves the record as it was

local frames = {}
local active -- { runId, encounterID, startedAt, record, kept } while a pull is recorded; kept once it is saved

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return not (issecretvalue and issecretvalue(v))
end

local function store(create)
    local db = Alerts:Settings()
    if not db then
        return nil
    end
    if create and type(db.shieldPulls) ~= "table" then
        db.shieldPulls = {}
    end
    return db.shieldPulls
end

local function listen(on)
    for i, units in ipairs(UNIT_GROUPS) do
        local f = frames[i]
        if on and not f then
            f = CreateFrame("Frame")
            f:SetScript("OnEvent", function(_, event, unit)
                ShieldPulls.HandleEvent(event, unit)
            end)
            frames[i] = f
        end
        if f then
            f:UnregisterEvent(EVENT)
            if on then
                if f.RegisterUnitEvent then
                    f:RegisterUnitEvent(EVENT, (unpack or table.unpack)(units))
                else
                    f:RegisterEvent(EVENT)
                end
            end
        end
    end
end

-- The pull's record replaces its boss's saved one (once).
local function keep()
    local all = active and not active.kept and store(true)
    if all then
        all[active.encounterID] = active.record
        active.kept = true
    end
end

-- A boss pull begins: a new record for its boss, saved once it sees a shield or ends long enough, and the events
-- are listened to.
local function start(run)
    local enc = run and run.encounterID
    if not (readable(enc) and type(enc) == "number") then
        return
    end
    local record = { at = time and time() or nil, units = {} }
    active = { runId = Alerts.runId, encounterID = enc, startedAt = GetTime(), record = record }
    listen(true)
end

function ShieldPulls.HandleEvent(event, unit)
    if event ~= EVENT or not active then
        return
    end
    if not (readable(unit) and type(unit) == "string" and IS_UNIT[unit]) then
        return
    end
    local units = active.record.units
    if units[unit] == nil then
        units[unit] = math.floor((GetTime() - active.startedAt) * 10 + 0.5) / 10
        keep()
    end
end

Alerts.onPull[#Alerts.onPull + 1] = function(run)
    start(run)
end

-- The run ended (the encounter's end) or another took its place: the record is done.
Alerts:OnChange(function()
    if active and not (Alerts.running and Alerts.runId == active.runId) then
        if GetTime() - active.startedAt >= ShieldPulls.MIN_PULL then
            keep()
        end
        active = nil
        listen(false)
    end
end)

-- The boss's last pull record, { at, units }, or nil when none was kept.
function ShieldPulls:Last(encounterID)
    local all = store()
    local record = all and all[encounterID]
    return type(record) == "table" and type(record.units) == "table" and record or nil
end

-- The boss units that had a shield on the boss's last pull, soonest first: { { unit, at } }, at most MAX_SHOWN.
-- Nil when no pull of the boss was kept.
function ShieldPulls:Seen(encounterID)
    local record = self:Last(encounterID)
    if not record then
        return nil
    end
    local out = {}
    for _, unit in ipairs(ShieldPulls.UNITS) do
        local at = record.units[unit]
        if type(at) == "number" then
            out[#out + 1] = { unit = unit, at = at }
        end
    end
    table.sort(out, function(a, b)
        if a.at ~= b.at then
            return a.at < b.at
        end
        return a.unit < b.unit
    end)
    for i = #out, ShieldPulls.MAX_SHOWN + 1, -1 do
        out[i] = nil
    end
    return out
end

-- Seconds from the pull as m:ss.t: 183.8 is "3:03.8".
function ShieldPulls.Clock(t)
    local tenths = math.floor(t * 10 + 0.5)
    local s = tenths / 10
    return string.format("%d:%04.1f", math.floor(s / 60), s - math.floor(s / 60) * 60)
end

-- A boss unit's number: 2 for boss2.
function ShieldPulls.UnitNumber(unit)
    return tonumber(type(unit) == "string" and unit:match("^boss(%d)$") or nil)
end

-- What Mech Alerts' and the Special panel's line says of an alert's shield bar: "Shield bar: Boss 2, 15 s".
ShieldPulls.BAR_LINE = "Shield bar: Boss %s, %s s"
function ShieldPulls.BarLine(absorb)
    return string.format(ShieldPulls.BAR_LINE, tostring(ShieldPulls.UnitNumber(absorb.unit) or "?"), ("%g"):format(absorb.length))
end
