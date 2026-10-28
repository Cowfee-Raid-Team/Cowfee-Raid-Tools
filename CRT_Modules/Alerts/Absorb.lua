local ADDON, CRT = ...

-- Shield bars: a special alert with absorb = { unit, length, anyDifficulty } (the format is at the top of
-- Alerts/Special.lua), one of your reminders with the same field (Alerts/Reminders.lua) or a raid or personal note line
-- with shield: (Notes/Parse.lua) shows a bar whose fill is the absorb shield left on its boss unit, and whose tick and
-- seconds are length seconds from when the shield went up. Alerts/Bars.lua draws them (one draw path, drawAbsorb); this
-- file only decides when each bar starts and ends, and keeps the shield's readings. Only with the alert's Bar on.
--   Timed: an item of the run that carries absorb (one per cast) opens a window from its absorb.lead before the cast
--     (a special entry's own lead from the boss file, never your Show from; a reminder's or a note line's Show from)
--     to length after it. The first
--     UNIT_ABSORB_AMOUNT_CHANGED for its unit inside it starts the bar. The bar ends when length runs out, when the run
--     stops (the encounter's end) or when the item leaves the run's lines (a later phase cut it). Each window gives one
--     bar.
--   Untimed: Special:AbsorbWatches(run), Reminders:AbsorbWatches(run) and NoteEngine:AbsorbWatches(run) give a watch
--     per alert, keyed as its items' absorb.key (else special, else id). While none of the alert's timed windows is open and no
--     timed bar of it runs (its phase not reached yet, as with no phase triggers and no Next phase; no times on this
--     difficulty, with anyDifficulty; or the shield came off its plan), the unit's first absorb event starts a bar,
--     and a new one starts only after it ended and the events stopped for GAP seconds.
--   One shield, one bar: a unit has at most one bar at a time. A window that opens, or an untimed start, while a bar on
--     that unit runs takes that bar over (whichever alert started it), so a special alert, a raid note line and your
--     own reminder on the same shield show one bar. Its label is the highest of them by RANK: a special alert, then a
--     note line, then your own; the bar keeps the length it started with.
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
local dev -- the developer watch (Absorb:DevWatch): { unit, label, length } while it runs, or nil
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

-- Which alert labels a bar several take over, highest first: a special alert (a watch with no block is one), then a
-- raid or personal note line, then anything else (your own reminder, a test).
local RANK = { special = 3, note = 2, personal = 2 }
local function rankOf(src)
    return RANK[src.block or "special"] or 1
end

-- A bar's state: its unit, when it started, its length, the shield's first reading (its maximum) and the last one, seq
-- (one up per reading, so the bar redraws only on a new one), the rank of the alert it is labelled by, and the line the
-- bars draw.
local function newState(id, at, length, total, src, unit)
    local st = { unit = unit, at = at, length = length, max = total, value = total, seq = 1, rank = rankOf(src) }
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

local DEV_REASON = "devshield" -- the run the developer watch starts (CRT_Dev/Dev/ShieldBarDev.lua)

local function devRun(run)
    return dev ~= nil and run ~= nil and run == dev.run
end

-- On every change of the alerts: a new run starts clean, and the watches and the units are read again. Only a boss
-- pull listens to the event, and only while some bar watches a unit.
function Absorb:Sync()
    local run = Alerts.running and Alerts.run or nil
    if dev and run ~= dev.run then
        dev = nil -- another run (a real pull, a Test) took the place of the developer watch
    end
    if not run then
        reset()
        listen(EMPTY)
        return
    end
    if runId ~= Alerts.runId then
        reset()
        runId = Alerts.runId
    end
    watches = {}
    for _, source in ipairs({ CRT.AlertSpecial or EMPTY, CRT.AlertReminders or EMPTY, CRT.NoteEngine or EMPTY }) do
        if source.AbsorbWatches then
            for _, w in ipairs(source:AbsorbWatches(run) or EMPTY) do
                watches[#watches + 1] = w
            end
        end
    end
    if devRun(run) then
        watches = { { id = "absorb:dev", key = "dev", unit = dev.unit, length = dev.length, text = dev.label } }
    end
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
    if run.reason == "encounter" or devRun(run) then
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

-- The alert a shield line stands for, which its untimed watch has as its key: a reminder's or a special entry's
-- every cast is one alert.
local function keyOf(line)
    return line.absorb.key or line.special or line.id
end

-- The bar running on a unit now, timed or untimed, or nil: a unit has one at a time.
local function unitBar(unit, now)
    for _, st in pairs(timed) do
        if st.unit == unit and running(st, now) then
            return st
        end
    end
    for _, f in pairs(free) do
        if f.bar and f.bar.unit == unit and running(f.bar, now) then
            return f.bar
        end
    end
    return nil
end

-- Another alert takes a running bar over: it labels the bar when it ranks higher.
local LABEL_FIELDS = { "block", "text", "icon", "spellID", "color", "abilityType", "priority" }
local function takeOver(st, src)
    local rank = rankOf(src)
    if rank > st.rank then
        st.rank = rank
        for _, k in ipairs(LABEL_FIELDS) do
            st.line[k] = src[k]
        end
        st.line.block = src.block or "special"
    end
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
                    busy[keyOf(line)] = true
                end
            elseif open then
                -- a bar already showing this shield (untimed, or another alert's window) goes on as this window's
                local taken = unitBar(unit, now)
                if taken then
                    taken.adopted = true
                    takeOver(taken, line)
                    update(taken, total)
                    timed[line.id] = taken
                else
                    timed[line.id] = newState(line.id, now, a.length, total, line, unit)
                end
                busy[keyOf(line)] = true
            end
            if open then
                busy[keyOf(line)] = true
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
            elseif unitBar(unit, now) then
                -- another alert's bar shows this shield: this one takes it over, never a second bar
                f.bar = unitBar(unit, now)
                takeOver(f.bar, w)
            elseif not f.lastEventAt or now - f.lastEventAt >= Absorb.GAP then
                f.n = f.n + 1
                local id = w.id .. ":" .. f.n -- its own line: the lint reads a line with total on it for operators
                f.bar = newState(id, now, w.length, total, w, unit)
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
    local seen = {} -- a bar several alerts took over is drawn once
    local sample = Alerts.run.reason ~= "encounter"
    for _, line in ipairs(absorbLines(now)) do
        local st = timed[line.id]
        local a = line.absorb
        if not st and sample and now >= line.at and now < line.at + a.length then
            -- no absorb events outside a pull: the bar starts at its cast, full, with no amount; one per unit too
            st = unitBar(a.unit, now)
            if st then
                takeOver(st, line)
            else
                st = newState(line.id, line.at, a.length, 1, line, a.unit)
                st.sample = true
            end
            timed[line.id] = st
        end
        if running(st, now) and not seen[st] then
            seen[st] = true
            out = out or {}
            out[#out + 1] = st.line
        end
    end
    for _, w in ipairs(watches) do
        local f = free[w.id]
        if f and running(f.bar, now) and not f.bar.adopted and not seen[f.bar] then
            seen[f.bar] = true
            out = out or {}
            out[#out + 1] = f.bar.line
        end
    end
    return out or EMPTY
end

-- Developer only (CRT_Dev/Dev/ShieldBarDev.lua): an untimed watch on any unit, with its own label and length, in a run
-- of its own that has no lines (so it works in or out of combat, with no encounter). The first event starts the bar and
-- a new one only after the GAP rule, as a real untimed bar. Any other run starting (a real pull) ends the watch.
function Absorb:DevWatch(unit, label, length)
    self:DevStop()
    Alerts:Start(nil, nil, DEV_REASON, { blocks = {}, tag = DEV_REASON })
    dev = { unit = unit, label = label, length = length, run = Alerts.run }
    self:Sync()
end

function Absorb:DevStop()
    local run = Alerts.running and Alerts.run or nil
    local mine = dev and run == dev.run
    dev = nil
    if mine then
        Alerts:Stop()
    end
end

function Absorb:DevActive()
    return dev ~= nil
end

Alerts:OnChange(function()
    Absorb:Sync()
end)
