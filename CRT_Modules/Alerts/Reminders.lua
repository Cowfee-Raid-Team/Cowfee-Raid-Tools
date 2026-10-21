local ADDON, CRT = ...

-- Your own reminders: a timed alert you save for a boss. Its times come from the boss's reference
-- timeline (the cast schedule of one ability, converted to a phase and seconds into it) or from times
-- you type, and it runs on the alerts engine as the "mine" block beside the raid note. A reminder is
-- saved in CRT.db.alerts.reminders[encounterID][id] as
--   { boss, spellID, text, times, outputs = { alert, bar, speech, text, icon, circle }, warn, speech,
--     priority, difficulty, enabled, linger, sound, auraSound, glow, iconID, color, speakAt }
-- auraSound true also plays the sound when the spell's aura is put on you (Sound/Auras.lua).
-- where `times` is typed text ("P1 0:02, 1:17; P2 +0:18") or nil for the reference, `speech` is
-- "text", "textcount" (the text, then 3, 2, 1) or "count", `speakAt` is nil (the text is read out when
-- the alert shows) or "zero" (at its time), and `difficulty` nil means any. A reminder on a boss ability
-- follows its row's casts instead of typed times, and may add `shifts` ({ [cast] = seconds }), `off`
-- ({ [cast] = true }), and from the one-time move of older typed times `timesBackup`, `timesUnmatched`
-- and `timesMigrated` (see MigrateOne).

local Alerts = CRT.Alerts
local Rules = CRT.AlertRules

local Reminders = {}
CRT.AlertReminders = Reminders

local BLOCK = "mine"
-- said once when an older alert's typed times move onto its ability's casts (see MigrateOne)
local MIGRATE_TEXT = "%s now follows its ability timeline. Times with no cast near them were kept aside: %s"

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return true
end

local function copy(v)
    if type(v) ~= "table" then
        return v
    end
    local out = {}
    for k, x in pairs(v) do
        out[k] = copy(x)
    end
    return out
end

-- The first number in a phase label: "P1.5" gives 1.5, "Phase 2" gives 2, "Intermission" nil.
function Reminders.PhaseNumber(label)
    if type(label) ~= "string" then
        return nil
    end
    local num = label:match("%d+%.%d+") or label:match("%d+")
    return num and tonumber(num) or nil
end

-- The phase and the seconds into it of a time t from the pull: the phase is that of the last numbered
-- phase line at or before t (1 before any), and the seconds count from that line (from the pull before
-- any). With no reference (a recorded pull) it is phase 1 from the pull.
function Reminders.PhaseAt(ref, t)
    local ph, from = 1, 0
    for _, p in ipairs(ref and ref.phases or {}) do
        local n = Reminders.PhaseNumber(p.label)
        if n and type(p.t) == "number" and p.t <= t then
            ph, from = n, p.t
        end
    end
    return ph, t - from
end

-- The reverse of PhaseAt: the time from the pull of seconds into phase ph, through the reference's
-- first phase line of that number. Phase 1 always counts from the pull, as PhaseAt does before any
-- numbered line (a later line whose label carries a 1, "Intermission 1", doesn't move it). Nil for a
-- phase the reference doesn't have, and for any phase above 1 with no reference (a recorded pull,
-- whose phase times aren't known).
function Reminders.AbsoluteTime(ref, ph, seconds)
    if type(ph) ~= "number" or type(seconds) ~= "number" then
        return nil
    end
    if ph == 1 then
        return seconds
    end
    for _, p in ipairs(ref and ref.phases or {}) do
        if type(p.t) == "number" and Reminders.PhaseNumber(p.label) == ph then
            return p.t + seconds
        end
    end
    return nil
end

-- The phase mask on a reference: the earliest phase line of a later phase than ph (a higher number,
-- "P1.5" counts as later than 1), or nil. Whatever phase ph has timed at or after it never comes, as the
-- engine's Alerts:PhaseCut does in a pull.
function Reminders.PhaseCut(ref, ph)
    if type(ph) ~= "number" then
        return nil
    end
    local cut
    for _, p in ipairs(ref and ref.phases or {}) do
        local n = Reminders.PhaseNumber(p.label)
        if n and n > ph and type(p.t) == "number" and (not cut or p.t < cut) then
            cut = p.t
        end
    end
    return cut
end

-- The casts of a reference row as { ph, t }, each where the Timeline draws it (Lanes.Placer: a moved
-- phase line moves its casts, and hides those it pushes past the next phase), then through PhaseAt.
-- So a time counts from where its phase line is now, and lands on the row's cast. Each entry also has
-- cast, the cast's place in the row (1 = its first written cast). r (optional) is a reminder on a boss
-- ability: its shifts[cast] (seconds, from dragging its flag) move a cast's alert, and its off[cast] (a
-- deleted time) leaves the cast out; an entry with a shift has it as shift.
function Reminders.FromReference(ref, row, r)
    local out = {}
    if not (ref and row) then
        return out
    end
    local Lanes = CRT.TimelineLanes
    local place = Lanes and Lanes.Placer and Lanes.Placer(ref)
    local shifts = r and type(r.shifts) == "table" and r.shifts or {}
    local off = r and type(r.off) == "table" and r.off or {}
    for i, cast in ipairs(row.casts or {}) do
        local at = cast.t
        if place then
            at = place(at)
        end
        if at and not off[i] then
            local ph, t = Reminders.PhaseAt(ref, at)
            local shift = tonumber(shifts[i])
            if shift == 0 then
                shift = nil
            end
            out[#out + 1] = { ph = ph, t = t + (shift or 0), cast = i, shift = shift }
        end
    end
    return out
end

-- "P1 0:02, 1:17; P2 +0:18" into { { ph, t } }. Groups split by ";", each an optional P<number> and
-- then times split by ",". A time may carry tenths ("3:13.5", "193.5"), as a click on the Timeline
-- gives. Returns nil and a message naming the bad part.
local function parseTime(s)
    local t = CRT.TimelineReference.ParseTime(s)
    if t then
        return t
    end
    s = trim(s)
    local m, sec = s:match("^(%d+):(%d%d%.%d+)$")
    if m and tonumber(sec) < 60 then
        return tonumber(m) * 60 + tonumber(sec)
    end
    if s:match("^%d+%.%d+$") then
        return tonumber(s)
    end
    return nil
end

function Reminders.ParseTimes(text)
    if type(text) ~= "string" then
        return nil, "no times"
    end
    local parse = parseTime
    local out = {}
    for group in (text .. ";"):gmatch("([^;]*);") do
        group = trim(group)
        if group ~= "" then
            local ph, rest = 1, group
            if group:match("^[Pp]") then
                local num, after = group:match("^[Pp]%s*(%d+%.?%d*)%s*(.*)$")
                if not num then
                    return nil, "bad phase '" .. group .. "'"
                end
                ph, rest = tonumber(num), after
            end
            local label = "P" .. tostring(ph)
            local count = 0
            for tok in (rest .. ","):gmatch("([^,]*),") do
                tok = trim(tok)
                if tok ~= "" then
                    local t = parse((tok:gsub("^%+%s*", "")))
                    if not t then
                        return nil, "bad time '" .. tok .. "' in " .. label
                    end
                    out[#out + 1] = { ph = ph, t = t }
                    count = count + 1
                end
            end
            if count == 0 then
                return nil, "no times in " .. label
            end
        end
    end
    if #out == 0 then
        return nil, "no times"
    end
    return out
end

-- m:ss, or m:ss.s when the time has tenths.
local function clock(t)
    t = math.floor(t * 10 + 0.5) / 10
    if t == math.floor(t) then
        return string.format("%d:%02d", math.floor(t / 60), t % 60)
    end
    local m = math.floor(t / 60)
    return string.format("%d:%04.1f", m, t - m * 60)
end

-- The reverse of ParseTimes: phases in order, as "P1 0:02, 1:17; P2 +0:18".
function Reminders.FormatTimes(list)
    local phases, byPhase = {}, {}
    for _, e in ipairs(list or {}) do
        if not byPhase[e.ph] then
            byPhase[e.ph] = {}
            phases[#phases + 1] = e.ph
        end
        local g = byPhase[e.ph]
        g[#g + 1] = (e.ph == 1 and "" or "+") .. clock(e.t)
    end
    table.sort(phases)
    local parts = {}
    for _, ph in ipairs(phases) do
        parts[#parts + 1] = "P" .. tostring(ph) .. " " .. table.concat(byPhase[ph], ", ")
    end
    return table.concat(parts, "; ")
end

-- Saved reminders ----------------------------------------------------------------------------

local function store(create)
    local db = Alerts:Settings()
    if not db then
        return nil
    end
    if create and type(db.reminders) ~= "table" then
        db.reminders = {}
    end
    return db.reminders
end

function Reminders:Get(encounterID, id)
    local all = store()
    local list = all and all[encounterID]
    return list and list[id] or nil
end

-- { { id, r } } for a boss, oldest id first.
function Reminders:List(encounterID)
    -- the first listing of a boss moves older typed times on its abilities onto the casts (MigrateBoss)
    if Reminders.MigrateBoss then
        Reminders.MigrateBoss(encounterID)
    end
    local out = {}
    local all = store()
    for id, r in pairs(all and all[encounterID] or {}) do
        out[#out + 1] = { id = id, r = r }
    end
    table.sort(out, function(a, b)
        return a.id < b.id
    end)
    return out
end

-- Saves a copy of r with the defaults filled in. id nil makes a new reminder. Returns the id.
function Reminders:Save(encounterID, id, r)
    local all = store(true)
    local db = Alerts:Settings()
    if not (all and db) then
        return nil
    end
    local saved = copy(r)
    for _, k in ipairs({ "difficulty", "boss" }) do
        if type(saved[k]) ~= "string" or trim(saved[k]) == "" then
            saved[k] = nil
        end
    end
    if saved.times ~= nil and trim(saved.times) == "" then
        saved.times = nil
    end
    saved.outputs = saved.outputs or {}
    for _, k in ipairs({ "alert", "bar", "speech" }) do
        if saved.outputs[k] == nil then
            saved.outputs[k] = true
        end
    end
    saved.warn = saved.warn or 5
    saved.speech = saved.speech or "text"
    saved.priority = saved.priority or "normal"
    if saved.enabled == nil then
        saved.enabled = true
    end
    -- a boss ability's alert follows its casts: typed times saved onto it become shifts (MigrateOne)
    if Reminders.MigrateOne then
        pcall(Reminders.MigrateOne, encounterID, saved, true)
    end
    if not id then
        id = db.nextId or 1
        db.nextId = id + 1
    end
    all[encounterID] = all[encounterID] or {}
    all[encounterID][id] = saved
    Alerts:Fire()
    return id
end

-- Removes a reminder, and any display overrides saved for it, so nothing is left pointing at it. The
-- Timeline's flags and the alert run read the reminders afresh on the change this fires.
function Reminders:Delete(encounterID, id)
    local all = store()
    if all and all[encounterID] then
        all[encounterID][id] = nil
    end
    local db = Alerts:Settings()
    local over = db and db.overrides and db.overrides[BLOCK]
    if type(over) == "table" then
        over[id] = nil
    end
    Alerts:Fire()
end

-- base with the overrides[blockKey][entryID] fields laid over it. Never writes into base.
function Reminders:Effective(blockKey, entryID, base)
    local out = copy(base or {})
    local db = Alerts:Settings()
    local over = db and db.overrides and db.overrides[blockKey] and db.overrides[blockKey][entryID]
    if type(over) == "table" then
        for k, v in pairs(over) do
            if type(v) == "table" and type(out[k]) == "table" then
                for k2, v2 in pairs(v) do
                    out[k][k2] = copy(v2)
                end
            else
                out[k] = copy(v)
            end
        end
    end
    return out
end

-- Times --------------------------------------------------------------------------------------

local function lower(s)
    return trim(s):lower()
end

-- The reference of the boss to use, through the one picker the Timeline and the Rehearsal use
-- (Timeline:ReferenceFor): for the reminder's own difficulty (its Difficulty line's text, preferred inside
-- its group), else for group (the run's or the view's "mythic" or "nh"). With neither, or nothing in the
-- group, the reference of the reminder's difficulty, else the boss's first, as before.
local function referenceFor(encounterID, r, group)
    local Ref, T = CRT.TimelineReference, CRT.Timeline
    if not Ref then
        return nil
    end
    if r.difficulty and T and T.GroupFor then
        group = T:GroupFor(r.difficulty)
    end
    if (group == "mythic" or group == "nh") and T and T.ReferenceFor then
        local entry = T:ReferenceFor(encounterID, group, r.boss, r.difficulty)
        if entry then
            return entry.ref
        end
    end
    local found = Ref:ForBoss(encounterID, r.boss)
    if #found == 0 then
        return nil
    end
    if r.difficulty then
        for _, entry in ipairs(found) do
            if entry.ref.difficulty and lower(entry.ref.difficulty) == lower(r.difficulty) then
                return entry.ref
            end
        end
    end
    return found[1].ref
end

Reminders.ReferenceFor = referenceFor

local function spellName(id)
    if type(id) ~= "number" or id <= 0 or not (C_Spell and C_Spell.GetSpellName) then
        return nil
    end
    local ok, name = pcall(C_Spell.GetSpellName, id)
    if ok and type(name) == "string" and readable(name) and name ~= "" then
        return name
    end
    return nil
end

Reminders.SpellName = spellName

-- The row of a reference for a reminder: by spell ID (a row's own [spell] or its Journal spell), else
-- by name (the spell's name or the reminder's text). journalRows (optional) are the boss's Journal rows to match
-- spells with, in place of asking the Journal (the alerts' type colours pass only rows already read).
local function rowFor(ref, encounterID, r, journalRows)
    local rows = journalRows
    if not rows and CRT.TimelineJournal then
        local ok, res = pcall(CRT.TimelineJournal.Rows, CRT.TimelineJournal, encounterID)
        rows = ok and res or nil
    end
    local want = type(r.spellID) == "number" and r.spellID > 0 and r.spellID or nil
    if want and CRT.TimelineLanes then
        for _, row in ipairs(ref.rows or {}) do
            local ok, id = pcall(CRT.TimelineLanes.RowSpell, row, encounterID, rows or {})
            if ok and id == want then
                return row
            end
        end
    end
    local names = {}
    local sn = spellName(r.spellID)
    if sn then
        names[lower(sn)] = true
    end
    if trim(r.text) ~= "" then
        names[lower(r.text)] = true
    end
    for _, row in ipairs(ref.rows or {}) do
        if names[lower(row.name)] then
            return row
        end
    end
end

Reminders.RowFor = rowFor

-- A reminder on a boss ability: one with a spell (a Mech Alert's). Its times are always the casts of
-- its row on the ability timeline (FromReference), never typed ones, so the Timeline, the Rehearsal, the
-- Mech Alerts list and the alerts agree. Your own reminders (no spell) keep typed times.
local function onAbility(r)
    return type(r.spellID) == "number" and r.spellID > 0
end

-- The reference and row a reminder on a boss ability follows (see Times), or nil.
local function castSource(encounterID, r, ref, group)
    if not onAbility(r) then
        return nil
    end
    ref = ref or referenceFor(encounterID, r, group)
    local row = ref and rowFor(ref, encounterID, r)
    if row then
        return ref, row
    end
    return nil
end

-- The times of a reminder: { { ph, t } } and where they came from ("typed", "reference" or "none").
-- A reminder on a boss ability with a row on the ability timeline takes that row's casts, each with its
-- cast number and any shift (FromReference); typed times are only read when the timeline has no row for
-- it, and for your own reminders. Typed text that does not read gives {}, "typed" and the message.
-- `ref` (optional) is the reference to read, in place of the reminder's own (the Rehearsal's, the
-- Timeline view's); group (optional) is the run's or the view's difficulty group ("mythic" or "nh"),
-- which picks the reference of a reminder on any difficulty (referenceFor).
function Reminders:Times(encounterID, r, ref, group)
    local cref, row = castSource(encounterID, r, ref, group)
    if row then
        return Reminders.FromReference(cref, row, r), "reference"
    end
    if type(r.times) == "string" and trim(r.times) ~= "" then
        local list, err = Reminders.ParseTimes(r.times)
        if not list then
            return {}, "typed", err
        end
        return list, "typed"
    end
    ref = ref or referenceFor(encounterID, r, group)
    row = ref and rowFor(ref, encounterID, r)
    if row then
        return Reminders.FromReference(ref, row), "reference"
    end
    return {}, "none"
end

-- Moves one time of a reminder (index in the list Times gives) to phase ph, t seconds in, or adds that
-- time. The times are saved as typed text, so a reminder that followed the reference now holds its own
-- list; every other field stays. False when the reminder, its time or its typed times can't be read.
local function writeTimes(encounterID, id, change)
    local r = Reminders:Get(encounterID, id)
    if not r then
        return false
    end
    local list, source = Reminders:Times(encounterID, r)
    if source == "typed" and #list == 0 then
        return false
    end
    if not change(list) then
        return false
    end
    local saved = copy(r)
    saved.times = Reminders.FormatTimes(list)
    return Reminders:Save(encounterID, id, saved) ~= nil
end

-- A change to a reminder on a boss ability: change(saved, list, ref) edits a copy's shifts and off from
-- the casts Times gives (with the same ref and group), and it is saved. Nil when the reminder follows no
-- casts (the typed path applies then); false when it can't be read or the change is refused.
local function writeCasts(encounterID, id, ref, group, change)
    local r = Reminders:Get(encounterID, id)
    if not r then
        return false
    end
    local cref, row = castSource(encounterID, r, ref, group)
    if not row then
        return nil
    end
    local saved = copy(r)
    saved.shifts = type(saved.shifts) == "table" and saved.shifts or {}
    saved.off = type(saved.off) == "table" and saved.off or {}
    if not change(saved, Reminders.FromReference(cref, row, r), cref, row) then
        return false
    end
    if next(saved.shifts) == nil then
        saved.shifts = nil
    end
    if next(saved.off) == nil then
        saved.off = nil
    end
    return Reminders:Save(encounterID, id, saved) ~= nil
end

local function tenthOf(x)
    return math.floor(x * 10 + 0.5) / 10
end

-- Seconds from the pull of a cast's time without its shift, through the same reference.
local function castAt(ref, e)
    return Reminders.AbsoluteTime(ref, e.ph, e.t - (e.shift or 0))
end

-- Moves one time (index in Times' list) to phase ph, t seconds in. On a boss ability this is that cast's
-- shift, seconds from the cast; otherwise the times are saved as typed. ref and group (optional) are
-- those the list was read with (see Times), so the index is the same cast.
function Reminders:SetTime(encounterID, id, index, ph, t, ref, group)
    if type(ph) ~= "number" or type(t) ~= "number" then
        return false
    end
    local done = writeCasts(encounterID, id, ref, group, function(saved, list, cref)
        local e = list[index]
        local base = e and castAt(cref, e)
        local to = Reminders.AbsoluteTime(cref, ph, t)
        if not (base and to) then
            return false
        end
        local shift = tenthOf(to - base)
        saved.shifts[e.cast] = shift ~= 0 and shift or nil
        return true
    end)
    if done ~= nil then
        return done
    end
    return writeTimes(encounterID, id, function(list)
        if not list[index] then
            return false
        end
        list[index] = { ph = ph, t = t }
        return true
    end)
end

-- Takes one time out of a reminder that has several. On a boss ability this turns that cast off;
-- otherwise the rest are saved as typed times. False for a reminder with a single time (delete the
-- reminder instead) or an index it doesn't have.
function Reminders:RemoveTime(encounterID, id, index, ref, group)
    local done = writeCasts(encounterID, id, ref, group, function(saved, list)
        if #list < 2 or not list[index] then
            return false
        end
        saved.off[list[index].cast] = true
        return true
    end)
    if done ~= nil then
        return done
    end
    return writeTimes(encounterID, id, function(list)
        if #list < 2 or not list[index] then
            return false
        end
        table.remove(list, index)
        return true
    end)
end

-- Adds a time. On a boss ability this turns back on the cast turned off nearest to it (false when none
-- is off: every cast already has its alert); otherwise the time is added to the typed ones.
function Reminders:AddTime(encounterID, id, ph, t, ref, group)
    if type(ph) ~= "number" or type(t) ~= "number" then
        return false
    end
    local done = writeCasts(encounterID, id, ref, group, function(saved, _, cref, row)
        local at = Reminders.AbsoluteTime(cref, ph, t)
        if not at then
            return false
        end
        local all = Reminders.FromReference(cref, row, { shifts = saved.shifts })
        local best, bestGap
        for _, e in ipairs(all) do
            local castTime = Reminders.AbsoluteTime(cref, e.ph, e.t)
            if saved.off[e.cast] and castTime then
                local gap = math.abs(castTime - at)
                if not bestGap or gap < bestGap then
                    best, bestGap = e.cast, gap
                end
            end
        end
        if not best then
            return false
        end
        saved.off[best] = nil
        return true
    end)
    if done ~= nil then
        return done
    end
    return writeTimes(encounterID, id, function(list)
        list[#list + 1] = { ph = ph, t = t }
        return true
    end)
end

-- Moving typed times onto the casts ---------------------------------------------------------------
-- Older reminders on a boss ability could hold typed times (a flag dragged, a time typed). Once, the
-- first time a boss's reminders are listed, each such reminder follows its casts instead: the typed
-- text moves to timesBackup (kept, never deleted), a typed time within MIGRATE_WINDOW seconds of a cast
-- becomes that cast's shift, and those that match no cast are kept as timesUnmatched and named in chat.
-- Only fields are added; nothing else changes. timesMigrated marks it done.

local MIGRATE_WINDOW = 5
Reminders.MIGRATE_WINDOW = MIGRATE_WINDOW
local migratedBosses = {}

-- One reminder's move (r is the stored table, changed in place). Returns the unmatched times' text, or
-- nil; false when it isn't a typed reminder on a boss ability with a row to follow. again (Save) moves
-- typed times saved onto an ability since, such as a new alert from a double-click on a cast.
function Reminders.MigrateOne(encounterID, r, again)
    if type(r) ~= "table" or (r.timesMigrated and not again) or not onAbility(r)
        or type(r.times) ~= "string" or trim(r.times) == "" then
        return false
    end
    local ref, row = castSource(encounterID, r, nil, nil)
    local typed = Reminders.ParseTimes(r.times)
    if not (row and typed) then
        return false
    end
    local casts = Reminders.FromReference(ref, row)
    local shifts, claimed, unmatched = {}, {}, {}
    for _, e in ipairs(typed) do
        local at = Reminders.AbsoluteTime(ref, e.ph, e.t)
        local best, bestGap
        for _, c in ipairs(casts) do
            local castTime = Reminders.AbsoluteTime(ref, c.ph, c.t)
            local gap = at and castTime and math.abs(castTime - at)
            if gap and not claimed[c.cast] and gap <= MIGRATE_WINDOW and (not bestGap or gap < bestGap) then
                best, bestGap = c, gap
            end
        end
        if best then
            claimed[best.cast] = true
            local shift = tenthOf(at - Reminders.AbsoluteTime(ref, best.ph, best.t))
            if shift ~= 0 then
                shifts[best.cast] = shift
            end
        else
            unmatched[#unmatched + 1] = e
        end
    end
    r.timesBackup = r.timesBackup or r.times
    r.times = nil
    r.shifts = next(shifts) and shifts or nil
    r.timesMigrated = true
    if #unmatched > 0 then
        r.timesUnmatched = Reminders.FormatTimes(unmatched)
        return r.timesUnmatched
    end
    return nil
end

local function migrateBoss(encounterID)
    if migratedBosses[encounterID] then
        return
    end
    migratedBosses[encounterID] = true
    local all = store()
    for id, r in pairs(all and all[encounterID] or {}) do
        local ok, unmatched = pcall(Reminders.MigrateOne, encounterID, r)
        if ok and type(unmatched) == "string" and CRT.Print then
            local name = trim(r.text) ~= "" and r.text or spellName(r.spellID) or ("Reminder " .. tostring(id))
            CRT:Print(string.format(MIGRATE_TEXT, name, unmatched))
        end
    end
end
Reminders.MigrateBoss = migrateBoss

-- A boss's reminders listed again from scratch (the harness, after it swaps the saved data).
function Reminders.ResetMigration()
    migratedBosses = {}
end

-- The Mech Alerts list's text of a reminder's times: as FormatTimes, each shifted cast followed by its
-- shift ("P1 0:33 (-3 s)").
function Reminders.FormatCasts(list)
    local phases, byPhase = {}, {}
    for _, e in ipairs(list or {}) do
        if not byPhase[e.ph] then
            byPhase[e.ph] = {}
            phases[#phases + 1] = e.ph
        end
        local g = byPhase[e.ph]
        local s = (e.ph == 1 and "" or "+") .. clock(e.t)
        if e.shift then
            s = s .. string.format(" (%s%g s)", e.shift > 0 and "+" or "", e.shift)
        end
        g[#g + 1] = s
    end
    table.sort(phases)
    local parts = {}
    for _, ph in ipairs(phases) do
        parts[#parts + 1] = "P" .. tostring(ph) .. " " .. table.concat(byPhase[ph], ", ")
    end
    return table.concat(parts, "; ")
end

-- The block -----------------------------------------------------------------------------------

-- A run with anyDifficulty (the Phases tab asking which phases a boss has) takes every difficulty.
-- A reminder's difficulty is a Difficulty line's text; a pull's ID (DifficultyID) matches it on any
-- client language, where the game's name for it is translated.
local DIFFICULTY_IDS = { normal = 14, heroic = 15, mythic = 16 }
local function matchesDifficulty(r, run)
    if not r.difficulty or run.anyDifficulty then
        return true
    end
    if type(run.difficultyName) == "string" and lower(run.difficultyName) == lower(r.difficulty) then
        return true
    end
    local id = DIFFICULTY_IDS[lower(r.difficulty)]
    return id ~= nil and run.difficultyID == id
end

local function speechList(r, text)
    local mode = r.speech
    return Rules.SpeechItems(text, r.warn or 5, mode ~= "count", mode == "textcount" or mode == "count",
        r.speakAt == "zero")
end

-- The alert items of one reminder (r with any overrides already laid over it), one per time. Used by
-- the block and by the editor's Test, which runs a reminder that is not saved.
-- difficulty is not checked here; the block does that. group and ref (optional) are the run's difficulty
-- group and ability timeline (see Times).
function Reminders:Items(encounterID, id, r, group, ref)
    local out = {}
    local times = Reminders:Times(encounterID, r, ref, group)
    local icon
    if type(r.iconID) == "number" and r.iconID > 0 then
        icon = r.iconID
    elseif type(r.spellID) == "number" and r.spellID > 0 and C_Spell and C_Spell.GetSpellTexture then
        local ok, tex = pcall(C_Spell.GetSpellTexture, r.spellID)
        if ok and tex ~= nil and readable(tex) then
            icon = tex
        end
    end
    local text
    if type(r.text) == "string" and trim(r.text) ~= "" then
        text = r.text
    else
        text = spellName(r.spellID)
        if not text then
            local hasSpell = type(r.spellID) == "number" and r.spellID > 0
            text = hasSpell and ("Spell " .. tostring(r.spellID)) or "Reminder"
        end
    end
    local o = r.outputs or {}
    for n, t in ipairs(times) do
        out[#out + 1] = {
            id = "mine:" .. tostring(id) .. ":" .. n,
            ph = t.ph,
            time = t.t,
            spellID = r.spellID,
            icon = icon,
            text = text,
            priority = Rules.Priority(3, r.priority),
            warn = r.warn or 5,
            hold = math.max(0.5, type(r.linger) == "number" and r.linger or 0),
            color = r.color,
            sound = r.sound,
            glow = r.glow and true or nil,
            outputs = { alert = o.alert and true or false, bar = o.bar and true or false,
                speech = o.speech and true or false, text = o.text and true or false,
                icon = o.icon and true or false, circle = o.circle and true or false },
            speech = speechList(r, text),
        }
    end
    return out
end

local function entries(run)
    local out = {}
    if not (run and run.encounterID) then
        return out
    end
    -- the run's difficulty group, and a rehearsal's own ability timeline: the casts the window plays
    local group = Alerts.RunGroup and Alerts:RunGroup(run) or nil
    for _, e in ipairs(Reminders:List(run.encounterID)) do
        local r = Reminders:Effective(BLOCK, e.id, e.r)
        if r.enabled ~= false and matchesDifficulty(r, run) then
            for _, item in ipairs(Reminders:Items(run.encounterID, e.id, r, group, run.reference)) do
                out[#out + 1] = item
            end
        end
    end
    return out
end

Alerts:RegisterBlock(BLOCK, { label = "Your reminders", group = true, own = true, Entries = entries })
