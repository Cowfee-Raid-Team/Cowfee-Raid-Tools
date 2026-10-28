local ADDON, CRT = ...

-- Shield bars: a special alert with absorb = { unit, length, anyDifficulty } (the format is at the top of
-- Alerts/Special.lua) shows a bar whose fill is the absorb shield left on its boss unit, and whose tick and seconds are
-- length seconds from when the shield went up. Alerts/Bars.lua draws them (one draw path, drawAbsorb); this file only
-- decides when each bar starts and ends, and keeps the shield's readings. Only with the alert's Bar on.
--   Timed: an item of the run that carries absorb (the special block's, one per cast) opens a window from the entry's
--     own lead before the cast (the boss file's, never your Show from) to length after it. The first
--     UNIT_ABSORB_AMOUNT_CHANGED for its unit inside it starts the bar. The bar ends when length runs out, when the run
--     stops (the encounter's end) or when the item leaves the run's lines (a later phase cut it). Each window gives one
--     bar.
--   Untimed: Special:AbsorbWatches(run) gives a watch per entry. While none of the entry's timed windows is open and no
--     timed bar of it runs (its phase not reached yet, as with no phase triggers and no Next phase; no times on this
--     difficulty, with anyDifficulty; or the shield came off its plan), the unit's first absorb event starts a bar,
--     and a new one starts only after it ended and the events stopped for GAP seconds. A window that opens while that
--     bar runs takes it over, so a shield never gets two bars.
--   A run that is not a boss pull (Test, a rehearsal) hears no absorb events: its timed bars start at their cast,
--     full, with no amount, so a Test shows the bar.
-- UnitGetTotalAbsorbs is secret during an encounter (absorb probe, 2026-10-27): its value is kept as it came and
-- only ever passed on to StatusBar:SetMinMaxValues and SetValue and to AbbreviateNumbers, whose text goes to
-- FontString:SetText (Alerts/Bars.lua). It is never compared, added or tested here, so the bar can't tell the shield
-- broke: when the events stop, the fill stays where it was. The first reading is the bar's maximum. The suite's lint
-- "shield readings are never compared" checks this file and Bars.lua's shield bar section for it.
-- Every event does no more than read the total and keep it; the bars redraw on their own ticker. The event is
-- registered for the watched units only (Frame:RegisterUnitEvent, up to MAX_UNIT_FILTER units; more listen to all).

local Alerts = CRT.Alerts

local Absorb = {}
CRT.AlertAbsorb = Absorb

Absorb.GAP = 1.5 -- seconds without absorb events before an untimed bar may start again
local EVENT = "UNIT_ABSORB_AMOUNT_CHANGED"
local MAX_UNIT_FILTER = 4 -- the units Frame:RegisterUnitEvent takes
local EMPTY = {}

local runId -- the run the states below belong to
local timed = {} -- item line id -> its bar's state
local free = {} -- watch id -> { n (bars so far), lastEventAt, bar (its state, or nil) }
local watches = EMPTY -- Special:AbsorbWatches of the run
local units = {} -- the units any bar of the run watches
local frame
local listening -- the units the event is registered for, as one text ("boss2"), or nil when it is not

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return not (issecretvalue and issecretvalue(v))
end

local function reset()
    timed, free, watches, units = {}, {}, EMPTY, {}
    runId = nil
end

-- Whether an item or line has a shield bar to show: it carries absorb and its Bar is on.
local function shows(it)
    return type(it.absorb) == "table" and type(it.outputs) == "table" and it.outputs.bar and true or false
end

-- The run's lines that carry a shield bar, worked out once per lines table (Alerts:Lines hands out the same one
-- until something changes).
local cache = setmetatable({}, { __mode = "k" })
local function absorbLines(now)
    local lines = Alerts:Lines(now)
    local done = cache[lines]
    if done then
        return done
    end
    local out = {}
    for _, line in ipairs(lines) do
        if shows(line) then
            out[#out + 1] = line
        end
    end
    cache[lines] = out
    return out
end

-- A bar's state: when it started, its length, the shield's first reading (its maximum) and the last one, seq (one up
-- per reading, so the bar redraws only on a new one), and the line the bars draw.
local function newState(id, at, length, total, src)
    local st = { at = at, length = length, max = total, value = total, seq = 1 }
    st.line = {
        id = id,
        at = at + length,
        barFrom = at,
        absorb = st,
        block = src.block or "special",
        text = src.text,
        icon = src.icon,
        spellID = src.spellID,
        color = src.color,
        abilityType = src.abilityType,
        priority = src.priority,
        hold = 0,
        outputs = { bar = true },
    }
    return st
end

-- Registers the event for these units (a sorted list), or drops it with none.
local function listen(list)
    local key = #list > 0 and table.concat(list, ",") or nil
    if key == listening then
        return
    end
    listening = key
    if not frame then
        if not key then
            return
        end
        frame = CreateFrame("Frame")
        frame:SetScript("OnEvent", function(_, event, ...)
            Absorb.HandleEvent(event, ...)
        end)
    end
    frame:UnregisterEvent(EVENT)
    if not key then
        return
    end
    if #list <= MAX_UNIT_FILTER and frame.RegisterUnitEvent then
        frame:RegisterUnitEvent(EVENT, (unpack or table.unpack)(list))
    else
        frame:RegisterEvent(EVENT)
    end
end

-- On every change of the alerts: a new run starts clean, and the watches and the units are read again. Only a boss
-- pull listens to the event, and only while some bar watches a unit.
function Absorb:Sync()
    local run = Alerts.running and Alerts.run or nil
    if not run then
        reset()
        listen(EMPTY)
        return
    end
    if runId ~= Alerts.runId then
        reset()
        runId = Alerts.runId
    end
    local Special = CRT.AlertSpecial
    watches = Special and Special.AbsorbWatches and Special:AbsorbWatches(run) or EMPTY
    units = {}
    for _, w in ipairs(watches) do
        units[w.unit] = true
    end
    for _, it in ipairs(Alerts.items or EMPTY) do
        if shows(it) and type(it.absorb.unit) == "string" then
            units[it.absorb.unit] = true
        end
    end
    local list = {}
    if run.reason == "encounter" then
        for unit in pairs(units) do
            list[#list + 1] = unit
        end
        table.sort(list)
    end
    listen(list)
end

-- A reading on a bar that runs: kept as it came, for the bars' next draw.
local function update(st, total)
    st.value = total
    st.seq = st.seq + 1
end

-- Whether a bar shows at now: from its start until its length runs out.
local function running(st, now)
    return st and now >= st.at and now < st.at + st.length
end

-- The untimed bar of an entry that runs now, or nil.
local function freeBar(key, now)
    for _, w in ipairs(watches) do
        local f = free[w.id]
        if w.key == key and f and running(f.bar, now) then
            return f.bar
        end
    end
    return nil
end

-- The timed rules for one reading. Returns the entries (by key) a window or a timed bar has now: the untimed rules
-- leave those alone.
local function timedReading(unit, total, now)
    local busy = {}
    for _, line in ipairs(absorbLines(now)) do
        local a = line.absorb
        if a.unit == unit then
            local st = timed[line.id]
            local lead = type(a.lead) == "number" and a.lead or line.warn or 0
            local open = now >= line.at - lead and now <= line.at + a.length
            if st then
                if running(st, now) then
                    update(st, total)
                    busy[line.special or line.id] = true
                end
            elseif open then
                -- an untimed bar already showing this shield goes on as this window's
                local taken = line.special and freeBar(line.special, now)
                if taken then
                    taken.adopted = true
                    update(taken, total)
                    timed[line.id] = taken
                else
                    timed[line.id] = newState(line.id, now, a.length, total, line)
                end
                busy[line.special or line.id] = true
            end
            if open then
                busy[line.special or line.id] = true
            end
        end
    end
    return busy
end

function Absorb.HandleEvent(event, unit)
    if event ~= EVENT or not Alerts.running or runId ~= Alerts.runId then
        return
    end
    if not readable(unit) or type(unit) ~= "string" or not units[unit] then
        return
    end
    if type(UnitGetTotalAbsorbs) ~= "function" then
        return
    end
    local ok, total = pcall(UnitGetTotalAbsorbs, unit)
    -- type() is the one thing asked of the value: a secret reports its real type
    if not ok or type(total) ~= "number" then
        return
    end
    local now = Alerts:Now()
    local busy = timedReading(unit, total, now)
    for _, w in ipairs(watches) do
        if w.unit == unit then
            local f = free[w.id]
            if not f then
                f = { n = 0 }
                free[w.id] = f
            end
            if f.bar and not running(f.bar, now) then
                f.bar = nil
            end
            if busy[w.key] then
                -- the timed rules have this shield
            elseif f.bar then
                update(f.bar, total)
            elseif not f.lastEventAt or now - f.lastEventAt >= Absorb.GAP then
                f.n = f.n + 1
                local id = w.id .. ":" .. f.n -- its own line: the lint reads a line with total on it for operators
                f.bar = newState(id, now, w.length, total, w)
            end
            -- the gap counts every event on the unit, whichever rules took it
            f.lastEventAt = now
        end
    end
end

-- The shield bars to draw at now, as lines (Alerts/Bars.lua): the timed ones whose item is still in the run's lines,
-- then the untimed ones (one a window took over shows as the window's). {} while none.
function Absorb:Lines(now)
    if not Alerts.running then
        return EMPTY
    end
    if runId ~= Alerts.runId then
        self:Sync()
    end
    local out
    local sample = Alerts.run.reason ~= "encounter"
    for _, line in ipairs(absorbLines(now)) do
        local st = timed[line.id]
        local length = line.absorb.length
        if not st and sample and now >= line.at and now < line.at + length then
            -- no absorb events outside a pull: the bar starts at its cast, full, with no amount
            st = newState(line.id, line.at, length, 1, line)
            st.sample = true
            timed[line.id] = st
        end
        if running(st, now) then
            out = out or {}
            out[#out + 1] = st.line
        end
    end
    for _, w in ipairs(watches) do
        local f = free[w.id]
        if f and running(f.bar, now) and not f.bar.adopted then
            out = out or {}
            out[#out + 1] = f.bar.line
        end
    end
    return out or EMPTY
end

Alerts:OnChange(function()
    Absorb:Sync()
end)
