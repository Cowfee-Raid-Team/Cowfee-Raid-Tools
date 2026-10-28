local ADDON, CRT = ...

-- Shield bars: a special alert with absorb = { unit, length, anyDifficulty } (the format is at the top of
-- Alerts/Special.lua) shows a bar whose fill is the absorb shield left on its boss unit, and whose tick and seconds are
-- length seconds from when the shield went up. Alerts/Bars.lua draws them (one draw path, drawAbsorb); this file only
-- decides when each bar starts and ends, and keeps the shield's readings.
--   Timed: an item of the run that carries absorb (the special block's, one per cast) opens a window from its lead
--     before the cast to length after it. The first UNIT_ABSORB_AMOUNT_CHANGED for its unit inside it starts the bar.
--     The bar ends when length runs out, when the run stops (the encounter's end) or when the item leaves the run's
--     lines (a later phase cut it). Each window gives one bar.
--   Untimed (absorb.anyDifficulty, on a difficulty with no times for the entry): Special:AbsorbWatches(run) lists
--     them. The first absorb event on the unit starts a bar; a new one starts only after it ended and the events
--     stopped for GAP seconds.
--   A run that is not a boss pull (Test, a rehearsal) hears no absorb events: its timed bars start at their cast,
--     full, with no amount, so a Test shows the bar.
-- UnitGetTotalAbsorbs is secret during an encounter (absorb probe, 2026-10-27): its value is kept as it came and
-- only ever passed on to StatusBar:SetMinMaxValues and SetValue and to AbbreviateNumbers, whose text goes to
-- FontString:SetText (Alerts/Bars.lua). It is never compared, added or tested here, so the bar can't tell the shield
-- broke: when the events stop, the fill stays where it was. The first reading is the bar's maximum.
-- Every event does no more than read the total and keep it; the bars redraw on their own ticker.

local Alerts = CRT.Alerts

local Absorb = {}
CRT.AlertAbsorb = Absorb

Absorb.GAP = 1.5 -- seconds without absorb events before an untimed bar may start again
local EVENT = "UNIT_ABSORB_AMOUNT_CHANGED"
local EMPTY = {}

local runId -- the run the states below belong to
local timed = {} -- item line id -> its bar's state
local free = {} -- watch id -> { n (bars so far), lastEventAt, bar (its state, or nil) }
local watches = EMPTY -- Special:AbsorbWatches of the run
local units = {} -- the units any bar of the run watches
local frame

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

-- The run's lines that carry absorb, worked out once per lines table (Alerts:Lines hands out the same one until
-- something changes).
local cache = setmetatable({}, { __mode = "k" })
local function absorbLines(now)
    local lines = Alerts:Lines(now)
    local done = cache[lines]
    if done then
        return done
    end
    local out = {}
    for _, line in ipairs(lines) do
        if type(line.absorb) == "table" then
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

local function setListening(on)
    if not frame then
        if not on then
            return
        end
        frame = CreateFrame("Frame")
        frame:SetScript("OnEvent", function(_, event, ...)
            Absorb.HandleEvent(event, ...)
        end)
    end
    if on then
        frame:RegisterEvent(EVENT)
    else
        frame:UnregisterEvent(EVENT)
    end
end

-- On every change of the alerts: a new run starts clean, and the untimed watches and the units are read again. Only
-- a boss pull listens to the event, and only while some bar watches a unit.
function Absorb:Sync()
    local run = Alerts.running and Alerts.run or nil
    if not run then
        reset()
        setListening(false)
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
        if type(it.absorb) == "table" and type(it.absorb.unit) == "string" then
            units[it.absorb.unit] = true
        end
    end
    setListening(run.reason == "encounter" and next(units) ~= nil)
end

-- A reading on a bar that runs: kept as it came, for the bars' next draw.
local function update(st, total)
    st.value = total
    st.seq = st.seq + 1
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
    for _, line in ipairs(absorbLines(now)) do
        if line.absorb.unit == unit then
            local st = timed[line.id]
            local length = line.absorb.length
            if st then
                if now < st.at + st.length then
                    update(st, total)
                end
            elseif now >= line.at - (line.warn or 0) and now <= line.at + length then
                timed[line.id] = newState(line.id, now, length, total, line)
            end
        end
    end
    for _, w in ipairs(watches) do
        if w.unit == unit then
            local f = free[w.id]
            if not f then
                f = { n = 0 }
                free[w.id] = f
            end
            if f.bar and now >= f.bar.at + f.bar.length then
                f.bar = nil
            end
            if f.bar then
                update(f.bar, total)
            elseif not f.lastEventAt or now - f.lastEventAt >= Absorb.GAP then
                f.n = f.n + 1
                f.bar = newState(w.id .. ":" .. f.n, now, w.length, total, w)
            end
            f.lastEventAt = now
        end
    end
end

-- Whether a bar shows at now: from its start until its length runs out.
local function running(st, now)
    return st and now >= st.at and now < st.at + st.length
end

-- The shield bars to draw at now, as lines (Alerts/Bars.lua): the timed ones whose item is still in the run's lines,
-- then the untimed ones. {} while none.
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
        if f and running(f.bar, now) then
            out = out or {}
            out[#out + 1] = f.bar.line
        end
    end
    return out or EMPTY
end

Alerts:OnChange(function()
    Absorb:Sync()
end)
