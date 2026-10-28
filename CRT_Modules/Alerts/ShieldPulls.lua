local ADDON, CRT = ...

-- Last pull's shields: on every boss pull (a run with reason "encounter", Alerts/Engine.lua's onPull), the times from
-- the pull that a shield went up on each boss unit, boss1 to boss5: the unit's first UNIT_ABSORB_AMOUNT_CHANGED, and
-- each later one that comes after the unit's events stopped for GAP seconds (the untimed shield bar's rule,
-- Alerts/Absorb.lua), up to MAX_TIMES a unit. Only the times are kept: the shield's amount is secret during an
-- encounter and is never read here (no UnitGetTotalAbsorbs). The Shield bar section (Alerts/ShieldSection.lua: the alert
-- editor and both Mech Alerts tabs) shows it ("Last pull: Boss 2 shield at 0:45.0, 1:45.2") with a Use button for each
-- unit, so a shield race is set up from what the game showed on the last pull.
-- Saved per boss, the last pull only: CRT.db.alerts.shieldPulls[encounterID] = { at = time() of the pull,
-- units = { boss2 = 45, ... }, times = { boss2 = { 45, 105.2 }, ... } } (seconds from the pull, to a tenth): units holds
-- each unit's first time, as it always did, times every start (added 2026-10-28; a record without it has its first
-- only). A pull replaces its boss's record once it sees a shield, or at its end when it lasted MIN_PULL seconds or more
-- (so a pull with no shield says so); a quick wipe that saw none keeps what the pull before found (Alex, 2026-10-28).
-- The events are listened to only from the pull to the run's end, through Frame:RegisterUnitEvent (up to four units a
-- frame: two frames).

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
ShieldPulls.MAX_TIMES = 8 -- shield starts kept per unit
local GAP = 1.5 -- seconds without events before a unit's next event is a new shield: Alerts/Absorb.lua's Absorb.GAP

local frames = {}
-- { runId, encounterID, startedAt, record, kept, last } while a pull is recorded; kept once it is saved; last is each
-- unit's latest event time, for the gap rule
local active

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
    local record = { at = time and time() or nil, units = {}, times = {} }
    active = { runId = Alerts.runId, encounterID = enc, startedAt = GetTime(), record = record, last = {} }
    listen(true)
end

-- The gap rule's seconds: Alerts/Absorb.lua's, so Last pull counts a new shield where an untimed bar starts one.
local function gap()
    local Absorb = CRT.AlertAbsorb
    return Absorb and type(Absorb.GAP) == "number" and Absorb.GAP or GAP
end

function ShieldPulls.HandleEvent(event, unit)
    if event ~= EVENT or not active then
        return
    end
    if not (readable(unit) and type(unit) == "string" and IS_UNIT[unit]) then
        return
    end
    local now = GetTime()
    local last = active.last[unit]
    active.last[unit] = now
    if last and now - last < gap() then
        return -- the same shield, still being hit
    end
    local record = active.record
    local at = math.floor((now - active.startedAt) * 10 + 0.5) / 10
    local list = record.times[unit] or {}
    record.times[unit] = list
    if #list < ShieldPulls.MAX_TIMES then
        list[#list + 1] = at
    end
    if record.units[unit] == nil then
        record.units[unit] = at
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

-- A unit's shield starts in a record, in order: its times list, else (a record from before them) its first time.
local function startsOf(record, unit, first)
    local list = type(record.times) == "table" and record.times[unit]
    local out = {}
    for _, t in ipairs(type(list) == "table" and list or {}) do
        if type(t) == "number" and #out < ShieldPulls.MAX_TIMES then
            out[#out + 1] = t
        end
    end
    if #out == 0 then
        out[1] = first
    end
    table.sort(out)
    return out
end

-- The boss units that had a shield on the boss's last pull, soonest first: { { unit, at, times } }, at most
-- MAX_SHOWN; at is the unit's first shield, times every start kept for it. Nil when no pull of the boss was kept.
function ShieldPulls:Seen(encounterID)
    local record = self:Last(encounterID)
    if not record then
        return nil
    end
    local out = {}
    for _, unit in ipairs(ShieldPulls.UNITS) do
        local at = record.units[unit]
        if type(at) == "number" then
            out[#out + 1] = { unit = unit, at = at, times = startsOf(record, unit, at) }
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
