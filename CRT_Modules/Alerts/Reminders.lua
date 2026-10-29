local ADDON, CRT = ...

-- Your own reminders: a timed alert you save for a boss. Its times come from the boss's reference
-- timeline (the cast schedule of one ability, converted to a phase and seconds into it) or from times
-- you type, and it runs on the alerts engine as the "mine" block beside the raid note. A reminder is
-- saved in CRT.db.alerts.reminders[encounterID][id] as
--   { boss, spellID, text, times, outputs = { alert, bar, speech, text, icon, circle, timeline }, warn, speech,
--     priority, group, difficulty, enabled, linger, sound, auraSound, glow, iconID, color, speakAt, ticks, fill, countTo, barTo,
--     absorb, raidNote }
-- raidNote (optional) = { tag, key, difficulty }: saved as Raid note in Mech Alerts (Notes/MechNote.lua). Its lines in the
-- boss's raid note alert instead, so the "mine" block skips it (InNote); nothing else changes.
-- auraSound true also plays the sound when the spell's aura is put on you (Sound/Auras.lua).
-- absorb (optional, AbsorbOf) = { unit, length, anyDifficulty } makes its bar a shield bar, as a special alert's
-- (Alerts/Absorb.lua; the format at the top of Alerts/Special.lua): the window opens Show from before each cast, and
-- AbsorbWatches gives the untimed bar. Its ticks and fill are then not used (they stay saved).
-- ticks (optional) are the bar's impact ticks, seconds into the bar from when it shows ({ 2, 4 }); fill "up" makes
-- the bar fill up instead of emptying. A reminder's bar always runs from Show from before the cast to the cast, and
-- each item carries the ticks inside it as a bar of its own for the bars (barStart, barEnd and ticks as seconds after
-- the cast, Alerts/Bars.lua; BarTicks); a tick at or past Show from is not drawn. Until #1171 ticks were seconds
-- after the cast, with the bar running past the last one; nothing shipped saved any, so they are read the new way.
-- None of them is saved at its default.
-- barTo is an older field (Bar ends, "cast"): it stays saved where it was set, and nothing reads it.
-- where `times` is typed text ("P1 0:02, 1:17; P2 +0:18") or nil for the reference, `speech` is
-- "text", "textcount" (the text, then 3, 2, 1) or "count", `speakAt` is nil (the text is read out when
-- the alert shows) or "zero" (at its time). `group` is the difficulty group it is for, "nh" (Normal/Heroic)
-- or "mythic" (Reminders.GroupOf). Older reminders have instead `difficulty`, a Difficulty line's text
-- ("Heroic"), read as its group, or neither: any difficulty, until the pass splits them into one per group
-- (SplitOne, kept as they were in alerts.anyBackup[encounterID][id]). A reminder on a boss ability
-- follows its row's casts instead of typed times, and may add `shifts` ({ [group] = { [castKey] =
-- seconds } }, group "mythic" or "nh", castKey such as "P1@0:36": see CastKey), `off` (the same shape,
-- true for a cast turned off), and from the move of typed times `timesBackup`, `timesUnmatched` and
-- `timesMigrated` (see MigrateOne).

local Alerts = CRT.Alerts
local Rules = CRT.AlertRules

local Reminders = {}
CRT.AlertReminders = Reminders

-- The saved tables kept per boss, declared for the dev season purge (Bosses:DeclareStore, CRT_Data/Bosses/Registry.lua).
if CRT.Bosses and CRT.Bosses.DeclareField then
    CRT.Bosses:DeclareField("reminders", "alerts", "reminders")
    CRT.Bosses:DeclareField("reminder backups", "alerts", "anyBackup")
end

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

-- A shield bar's absorb as a reminder, a template or a share keeps it: { unit, length, anyDifficulty }, a fresh copy,
-- or nil when a has none or it doesn't read. The rule is Notes/Parse.lua's Parser.ReadAbsorb, which note lines and
-- special entries read by too.
function Reminders.AbsorbOf(a)
    local P = CRT.NoteParser
    if type(a) ~= "table" or not (P and P.ReadAbsorb) then
        return nil
    end
    return (P.ReadAbsorb(a.unit, a.length, a.anyDifficulty))
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

-- m:ss, or m:ss.s when the time has tenths (FormatTimes' and the cast keys'); a time before the pull as -m:ss.
local function clock(t)
    t = math.floor(t * 10 + 0.5) / 10
    if t < 0 then
        return "-" .. clock(-t)
    end
    if t == math.floor(t) then
        return string.format("%d:%02d", math.floor(t / 60), t % 60)
    end
    local m = math.floor(t / 60)
    return string.format("%d:%04.1f", m, t - m * 60)
end

-- A cast's stable key: its written time in its phase, by the planned phase lines, as "P1@0:36" or
-- "P2@0:53". A moved phase line, or a season update that adds or removes another cast, leaves it alone.
function Reminders.CastKey(ref, t)
    local ph, from = 1, 0
    for _, p in ipairs(ref and ref.phases or {}) do
        local n = Reminders.PhaseNumber(p.label)
        local at = p.planned or p.t
        if n and type(at) == "number" and at <= t then
            ph, from = n, at
        end
    end
    return "P" .. tostring(ph) .. "@" .. clock(t - from)
end

-- The difficulty groups a reminder can be saved for.
local GROUPS = { nh = true, mythic = true }

-- The difficulty group of a Difficulty line's text, through the Timeline's one grouping (Timeline:GroupFor).
local function groupOfText(difficulty)
    local T = CRT.Timeline
    if type(difficulty) ~= "string" or not readable(difficulty) or trim(difficulty) == "" or not (T and T.GroupFor) then
        return nil
    end
    return T:GroupFor(trim(difficulty))
end

-- The difficulty group a reminder is for: its group, else the group of an older reminder's difficulty text
-- ("Normal" and "Heroic" are "nh", "Mythic" is "mythic"), else nil (an older reminder on any difficulty).
function Reminders.GroupOf(r)
    if type(r) ~= "table" then
        return nil
    end
    if GROUPS[r.group] then
        return r.group
    end
    return groupOfText(r.difficulty)
end

-- The difficulty group of a reference ("mythic" or "nh", from its Difficulty line).
local function refGroup(ref)
    local Ref = CRT.TimelineReference
    return Ref and Ref.Group and Ref.Group(ref) or "nh"
end

-- A reminder's per-group table (shifts or off): field[group], or {}.
local function perGroup(r, field, group)
    local all = r and r[field]
    local t = type(all) == "table" and all[group]
    return type(t) == "table" and t or {}
end

-- The casts of a reference row as { ph, t }, each where the Timeline draws it (Lanes.Placer: a moved
-- phase line moves its casts, and hides those it pushes past the next phase), then through PhaseAt.
-- So a time counts from where its phase line is now, and lands on the row's cast. Each entry also has
-- key, the cast's stable key (CastKey; a second cast with the same key gets "#2"). r (optional) is a
-- reminder on a boss ability: for the reference's difficulty group (Reference.Group), its
-- shifts[group][key] (seconds, from dragging its flag) move a cast's alert, and its off[group][key] (a
-- deleted time) leaves the cast out unless keepOff; an entry with a shift has it as shift, and one
-- turned off has off.
function Reminders.FromReference(ref, row, r, keepOff)
    local out = {}
    if not (ref and row) then
        return out
    end
    local Lanes = CRT.TimelineLanes
    local place = Lanes and Lanes.Placer and Lanes.Placer(ref)
    local group = refGroup(ref)
    local shifts, off = perGroup(r, "shifts", group), perGroup(r, "off", group)
    local seen = {}
    for _, cast in ipairs(row.casts or {}) do
        local key = Reminders.CastKey(ref, cast.t)
        seen[key] = (seen[key] or 0) + 1
        if seen[key] > 1 then
            key = key .. "#" .. seen[key]
        end
        local at = cast.t
        if place then
            at = place(at)
        end
        if at and (keepOff or not off[key]) then
            local ph, t = Reminders.PhaseAt(ref, at)
            local shift = tonumber(shifts[key])
            if shift == 0 then
                shift = nil
            end
            out[#out + 1] = { ph = ph, t = t + (shift or 0), key = key, shift = shift,
                off = off[key] and true or nil }
        end
    end
    return out
end

-- "P1 0:02, 1:17; P2 +0:18" into { { ph, t } }. Groups split by ";", each an optional P<number> and
-- then times split by ",". A time may carry tenths ("3:13.5", "193.5"), as a click on the Timeline
-- gives. With prePull (special alerts only; your reminders never pass it), a phase 1 time may have a
-- leading minus, a time before the pull ("-0:15" or "-15" is t = -15); a minus in any other phase is an
-- error. Returns nil and a message naming the bad part.
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

function Reminders.ParseTimes(text, prePull)
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
                    local before = prePull and tok:match("^%-%s*(.+)$")
                    if before and ph ~= 1 then
                        return nil, "time '" .. tok .. "' in " .. label .. " is before the pull: only P1 may have one"
                    end
                    local t = parse(before or (tok:gsub("^%+%s*", "")))
                    if not t then
                        return nil, "bad time '" .. tok .. "' in " .. label
                    end
                    if before and t > 0 then
                        t = -t
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

-- Saves a copy of r with the defaults filled in. id nil makes a new reminder. Returns the id. group
-- (optional) is the difficulty group the caller shows the reminder for ("mythic" or "nh"): a new
-- reminder with no group of its own is saved for it, and typed times on a boss ability are placed on the
-- row the caller showed (MigrateOne). A saved reminder on any difficulty saved with a group (r.group) is
-- split first (SplitOne), so the other group keeps it as it was; the id returned is then that group's.
function Reminders:Save(encounterID, id, r, group)
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
    if not GROUPS[saved.group] then
        saved.group = nil
    end
    if id == nil and not Reminders.GroupOf(saved) and GROUPS[group] then
        saved.group = group
    end
    -- an older Difficulty text of another group than the one saved no longer says anything
    if saved.group and saved.difficulty and groupOfText(saved.difficulty) ~= saved.group then
        saved.difficulty = nil
    end
    if id and saved.group and all[encounterID] and all[encounterID][id]
        and not Reminders.GroupOf(all[encounterID][id]) then
        -- the split is not your step: Ctrl+Z takes back the edit below, never the copy (and so never
        -- leaves its display overrides behind)
        local ids
        local Undo = CRT.TimelineUndo
        if Undo and Undo.Quietly then
            Undo:Quietly(function()
                ids = Reminders.SplitOne(encounterID, id)
            end)
        else
            ids = Reminders.SplitOne(encounterID, id)
        end
        id = ids and ids[saved.group] or id
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
    -- a boss ability's alert follows its casts: typed times saved onto it snap onto them, kept in
    -- timesBackup; any that can't be placed are added to timesUnmatched and said in chat (MigrateOne)
    local okMove, unmatched = false, nil
    if Reminders.MigrateOne then
        okMove, unmatched = pcall(Reminders.MigrateOne, encounterID, saved, true, group)
    end
    if not id then
        id = db.nextId or 1
        db.nextId = id + 1
    end
    if okMove and type(unmatched) == "string" and Reminders.SayUnmatched then
        Reminders.SayUnmatched(id, saved, unmatched)
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
-- (Timeline:ReferenceFor): for the reminder's own group (GroupOf; an older reminder's Difficulty text is
-- preferred inside it), else for group (the run's or the view's "mythic" or "nh"). With neither, or
-- nothing in the group, the reference of the reminder's difficulty text, else the boss's first, as before.
local function referenceFor(encounterID, r, group)
    local Ref, T = CRT.TimelineReference, CRT.Timeline
    if not Ref then
        return nil
    end
    group = Reminders.GroupOf(r) or group
    local prefer = groupOfText(r.difficulty) and r.difficulty or nil
    if GROUPS[group] and T and T.ReferenceFor then
        local entry = T:ReferenceFor(encounterID, group, r.boss, prefer)
        if entry then
            return entry.ref
        end
    end
    local found = Ref:ForBoss(encounterID, r.boss)
    if #found == 0 then
        return nil
    end
    if prefer then
        for _, entry in ipairs(found) do
            if entry.ref.difficulty and lower(entry.ref.difficulty) == lower(prefer) then
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

-- The reference, row and difficulty group a reminder on a boss ability follows, or nil. A reminder is on
-- a boss ability when its spell has a row on the ability timeline, or when it has no spell and its text
-- names a row that has no spell of its own either (a spell-less ability row, matched by name). Its times
-- are then always that row's casts (FromReference), never typed ones, so the Timeline, the Rehearsal, the
-- Mech Alerts list and the alerts agree. Your own reminders keep typed times.
local function castSource(encounterID, r, ref, group)
    if type(r) ~= "table" then
        return nil
    end
    local spell = type(r.spellID) == "number" and r.spellID > 0
    if not spell and trim(r.text) == "" then
        return nil
    end
    ref = ref or referenceFor(encounterID, r, group)
    local row = ref and rowFor(ref, encounterID, r)
    if not row then
        return nil
    end
    if not spell then
        local Lanes = CRT.TimelineLanes
        local ok, id = false, nil
        if Lanes and Lanes.RowSpell then
            ok, id = pcall(Lanes.RowSpell, row, encounterID)
        end
        if not ok or id ~= 0 then
            return nil
        end
    end
    return ref, row, refGroup(ref)
end

-- Whether a reminder (or a draft's probe) is on a boss ability whose casts it follows (see castSource).
function Reminders.FollowsCasts(encounterID, r, ref, group)
    return castSource(encounterID, r, ref, group) ~= nil
end

-- Every cast a reminder on a boss ability follows, turned off ones too ({ ph, t, key, shift, off }), for
-- the alert editor's and Mech Alerts' lists; {} when it follows none.
function Reminders.AllCasts(encounterID, r, ref, group)
    local cref, row = castSource(encounterID, r, ref, group)
    if not row then
        return {}
    end
    return Reminders.FromReference(cref, row, r, true)
end

-- The times of a reminder: { { ph, t } } and where they came from ("typed", "reference" or "none").
-- A reminder on a boss ability takes its row's casts, each with its key and any shift (FromReference);
-- typed times are only read for your own reminders. Typed text that does not read gives {}, "typed" and
-- the message. `ref` (optional) is the reference to read, in place of the reminder's own (the
-- Rehearsal's, the Timeline view's); group (optional) is the run's or the view's difficulty group
-- ("mythic" or "nh"), which picks the reference of a reminder on any difficulty (referenceFor).
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

-- The saved[field][group] table, made when missing.
local function groupTable(saved, field, group)
    saved[field] = type(saved[field]) == "table" and saved[field] or {}
    saved[field][group] = type(saved[field][group]) == "table" and saved[field][group] or {}
    return saved[field][group]
end

-- Drops saved[field][group] and saved[field] when they are left empty.
local function tidy(saved, field, group)
    local all = saved[field]
    if type(all) ~= "table" then
        return
    end
    if type(all[group]) == "table" and next(all[group]) == nil then
        all[group] = nil
    end
    if next(all) == nil then
        saved[field] = nil
    end
end

-- A change to a reminder on a boss ability: change(shifts, off, list, ref, saved) edits a copy's shifts
-- and off of the reference's group (keyed by CastKey) from the casts Times gives (with the same ref and
-- group), and it is saved. Nil when the reminder follows no casts (the typed path applies then); false
-- when it can't be read or the change is refused.
local function writeCasts(encounterID, id, ref, group, change)
    local r = Reminders:Get(encounterID, id)
    if not r then
        return false
    end
    local cref, row, g = castSource(encounterID, r, ref, group)
    if not row then
        return nil
    end
    local saved = copy(r)
    local shifts, off = groupTable(saved, "shifts", g), groupTable(saved, "off", g)
    local ok = change(shifts, off, Reminders.FromReference(cref, row, r), cref, row, saved)
    tidy(saved, "shifts", g)
    tidy(saved, "off", g)
    if not ok then
        return false
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
-- shift, seconds from the cast, for the reference's difficulty group only; otherwise the times are saved
-- as typed. ref and group (optional) are those the list was read with (see Times), so the index is the
-- same cast.
function Reminders:SetTime(encounterID, id, index, ph, t, ref, group)
    if type(ph) ~= "number" or type(t) ~= "number" then
        return false
    end
    local done = writeCasts(encounterID, id, ref, group, function(shifts, _, list, cref)
        local e = list[index]
        local base = e and castAt(cref, e)
        local to = Reminders.AbsoluteTime(cref, ph, t)
        if not (base and to) then
            return false
        end
        local shift = tenthOf(to - base)
        shifts[e.key] = shift ~= 0 and shift or nil
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

-- Takes one time out of a reminder that has several. On a boss ability this turns that cast off (for
-- the reference's group); otherwise the rest are saved as typed times. False for a reminder with a
-- single time (delete the reminder instead) or an index it doesn't have.
function Reminders:RemoveTime(encounterID, id, index, ref, group)
    local done = writeCasts(encounterID, id, ref, group, function(_, off, list)
        if #list < 2 or not list[index] then
            return false
        end
        off[list[index].key] = true
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
    local done = writeCasts(encounterID, id, ref, group, function(_, off, _, cref, row, saved)
        local at = Reminders.AbsoluteTime(cref, ph, t)
        if not at then
            return false
        end
        local best, bestGap
        for _, e in ipairs(Reminders.FromReference(cref, row, saved, true)) do
            local castTime = Reminders.AbsoluteTime(cref, e.ph, e.t)
            if e.off and castTime then
                local gap = math.abs(castTime - at)
                if not bestGap or gap < bestGap then
                    best, bestGap = e.key, gap
                end
            end
        end
        if not best then
            return false
        end
        off[best] = nil
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
-- Older reminders on a boss ability could hold typed times (a flag dragged, a time typed). Once, out of
-- combat after login (MigrateAll), each such reminder follows its casts instead: its typed text moves
-- from times to timesBackup (added to what timesBackup already holds, never overwriting it), a typed time
-- within MIGRATE_WINDOW seconds of a cast snaps onto that cast with no shift (shifts only come from
-- dragging a flag afterwards), and those that match no cast are added to timesUnmatched and named in
-- chat. timesMigrated marks it done. Save does the same for typed times saved onto an ability later.

local MIGRATE_WINDOW = 5
Reminders.MIGRATE_WINDOW = MIGRATE_WINDOW

-- "a; b", or whichever is there.
local function joined(a, b)
    if type(a) == "string" and a ~= "" then
        return a .. "; " .. b
    end
    return b
end

-- One reminder's move (r is the table changed in place). Returns the unmatched times' text, or nil;
-- false when it holds no typed times, or isn't on a boss ability with a row to follow. again (Save) moves
-- typed times saved onto an ability since, such as a new alert from a double-click on a cast. group is
-- the caller's difficulty group, so the row is the one the caller shows; with none, a reminder on any
-- difficulty is matched against both groups' rows (the closest cast wins, Normal/Heroic's on a tie).
function Reminders.MigrateOne(encounterID, r, again, group)
    if type(r) ~= "table" or (r.timesMigrated and not again)
        or type(r.times) ~= "string" or trim(r.times) == "" then
        return false
    end
    local typed = Reminders.ParseTimes(r.times)
    if not typed then
        return false
    end
    local groups
    local own = Reminders.GroupOf(r)
    if own then
        groups = { own }
    elseif GROUPS[group] then
        groups = { group }
    else
        groups = { "nh", "mythic" }
    end
    local sources, seenRef = {}, {}
    for _, g in ipairs(groups) do
        local ref, row = castSource(encounterID, r, nil, g)
        if row and not seenRef[ref] then
            seenRef[ref] = true
            sources[#sources + 1] = { ref = ref, casts = Reminders.FromReference(ref, row), claimed = {} }
        end
    end
    if #sources == 0 then
        return false
    end
    -- a typed time near a cast came from a double-click by it, not an offset: it snaps onto the cast
    local unmatched = {}
    for _, e in ipairs(typed) do
        local best, bestGap
        for _, s in ipairs(sources) do
            local at = Reminders.AbsoluteTime(s.ref, e.ph, e.t)
            for _, c in ipairs(s.casts) do
                local castTime = Reminders.AbsoluteTime(s.ref, c.ph, c.t)
                local gap = at and castTime and math.abs(castTime - at)
                if gap and gap <= MIGRATE_WINDOW and not s.claimed[c.key] and (not bestGap or gap < bestGap) then
                    best, bestGap = { s = s, key = c.key }, gap
                end
            end
        end
        if best then
            best.s.claimed[best.key] = true
        else
            unmatched[#unmatched + 1] = e
        end
    end
    if r.timesBackup ~= r.times then
        r.timesBackup = r.timesBackup == nil and r.times or joined(r.timesBackup, r.times)
    end
    r.times = nil
    r.timesMigrated = true
    if #unmatched > 0 then
        local text = Reminders.FormatTimes(unmatched)
        r.timesUnmatched = joined(r.timesUnmatched, text)
        return text
    end
    return nil
end

-- The chat line for times that match no cast.
local function sayUnmatched(id, r, text)
    if CRT.Print then
        local name = trim(r.text) ~= "" and r.text or spellName(r.spellID) or ("Reminder " .. tostring(id))
        CRT:Print(string.format(MIGRATE_TEXT, name, text))
    end
end
Reminders.SayUnmatched = sayUnmatched

-- One per difficulty group ------------------------------------------------------------------------
-- An older reminder could be for any difficulty (no group and no difficulty saved). Once, in the same
-- pass, each becomes two with the same settings: itself for Normal/Heroic and a copy (a new id, with its
-- display overrides copied too) for Mythic, so nothing that fired before stops firing. Before the change it
-- is kept as it was in alerts.anyBackup[encounterID][id], never overwritten. A reminder already for one
-- group is left alone, so a second pass changes nothing.

-- Splits reminder id of a boss when it is on any difficulty. Returns { nh = id, mythic = copy's id }, or
-- nil when there is no such reminder or it is already for one group.
function Reminders.SplitOne(encounterID, id)
    local all = store()
    local db = Alerts:Settings()
    local r = all and type(all[encounterID]) == "table" and all[encounterID][id]
    if not (db and type(r) == "table") or Reminders.GroupOf(r) then
        return nil
    end
    db.anyBackup = type(db.anyBackup) == "table" and db.anyBackup or {}
    db.anyBackup[encounterID] = type(db.anyBackup[encounterID]) == "table" and db.anyBackup[encounterID] or {}
    if db.anyBackup[encounterID][id] == nil then
        db.anyBackup[encounterID][id] = copy(r)
    end
    local other = copy(r)
    other.group = "mythic"
    r.group = "nh"
    local newID = db.nextId or 1
    db.nextId = newID + 1
    all[encounterID][newID] = other
    local over = db.overrides and db.overrides[BLOCK]
    if type(over) == "table" and over[id] ~= nil then
        over[newID] = copy(over[id])
    end
    return { nh = id, mythic = newID }
end

-- Every boss's reminders on any difficulty split (SplitOne). Returns how many.
local function splitAll(all)
    local n = 0
    for enc, list in pairs(all) do
        if type(list) == "table" then
            local ids = {}
            for id in pairs(list) do
                ids[#ids + 1] = id
            end
            for _, id in ipairs(ids) do
                local ok, res = pcall(Reminders.SplitOne, enc, id)
                if ok and res then
                    n = n + 1
                end
            end
        end
    end
    return n
end

-- The one pass over every boss's reminders: typed times moved onto the casts (MigrateOne), then each
-- reminder on any difficulty split into one per group (SplitOne). Its changes are not your steps: it runs
-- inside the Timeline's undo Quietly (so Ctrl+Z never puts typed times back), then fires the alerts' change
-- event so every list and window reads the reminders again. Returns how many reminders it moved, then how
-- many it split.
function Reminders.MigrateAll()
    local all = store()
    if type(all) ~= "table" then
        return 0, 0
    end
    local moved, split = 0, 0
    local function run()
        for enc, list in pairs(all) do
            for id, r in pairs(type(list) == "table" and list or {}) do
                local ok, res = pcall(Reminders.MigrateOne, enc, r)
                if ok and res ~= false then
                    moved = moved + 1
                    if type(res) == "string" then
                        sayUnmatched(id, r, res)
                    end
                end
            end
        end
        split = splitAll(all)
        if moved > 0 or split > 0 then
            Alerts:Fire()
        end
    end
    local Undo = CRT.TimelineUndo
    if Undo and Undo.Quietly then
        Undo:Quietly(run)
    else
        run()
    end
    return moved, split
end

-- When the pass runs: once, at login or on entering the world, out of combat (waiting for combat to end
-- when it is on), never at a pull.
local pass = { done = false, waiting = false }
function Reminders.MigratePass()
    if pass.done then
        return
    end
    if InCombatLockdown and InCombatLockdown() then
        pass.waiting = true
        return
    end
    pass.done, pass.waiting = true, false
    pcall(Reminders.MigrateAll)
end

-- The pass can run again (the harness, after it swaps the saved data).
function Reminders.ResetMigration()
    pass.done, pass.waiting = false, false
end

local passFrame = CreateFrame("Frame")
passFrame:RegisterEvent("PLAYER_LOGIN")
passFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
passFrame:RegisterEvent("PLAYER_REGEN_ENABLED")
passFrame:SetScript("OnEvent", function(_, event)
    if event ~= "PLAYER_REGEN_ENABLED" or pass.waiting then
        Reminders.MigratePass()
    end
end)

-- The Mech Alerts list's text of a reminder's times: as FormatTimes, each shifted cast followed by its
-- shift ("P1 0:33 (-3 s)"), and one turned off (AllCasts) by "(off)".
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
        if e.off then
            s = s .. " (off)"
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
-- Otherwise a reminder runs when its group (GroupOf) is the run's (Alerts:RunGroup: the Timeline's group
-- of the pull's difficulty ID, the same on every client language, else of its name). An older reminder on
-- any difficulty, not split yet, runs on every one.
local function matchesDifficulty(r, run)
    local want = Reminders.GroupOf(r)
    if not want or run.anyDifficulty then
        return true
    end
    return Alerts.RunGroup ~= nil and Alerts:RunGroup(run) == want
end

-- A reminder's saved impact ticks as a fresh list in order (seconds into the bar, each 0 or more), or nil
-- for none. Anything else saved there is left out.
function Reminders.TickList(ticks)
    if type(ticks) ~= "table" then
        return nil
    end
    local out = {}
    for _, t in ipairs(ticks) do
        if type(t) == "number" and t == t and t >= 0 and t < math.huge then
            out[#out + 1] = t
        end
    end
    table.sort(out)
    return #out > 0 and out or nil
end

-- A reminder's bar runs from Show from (warn seconds) before the cast to the cast, ticks or not. Its saved ticks
-- (seconds into the bar) split into those on it, each moved to seconds after the cast as the bars read them (-warn
-- + tick, so 0 or less), and those outside it (at or past warn): those are not drawn and never move the bar.
-- Returns the ticks on the bar, then the saved ticks left off, each nil for none.
function Reminders.BarTicks(ticks, warn)
    local list = Reminders.TickList(ticks)
    if not list then
        return nil, nil
    end
    warn = type(warn) == "number" and warn or 0
    local on, off = {}, {}
    for _, t in ipairs(list) do
        if t < warn then
            on[#on + 1] = t - warn
        else
            off[#off + 1] = t
        end
    end
    return #on > 0 and on or nil, #off > 0 and off or nil
end

local function speechList(r, text)
    local mode = r.speech
    return Rules.SpeechItems(text, r.warn or 5, mode ~= "count", mode == "textcount" or mode == "count",
        r.speakAt == "zero")
end

-- A reminder's icon (its own icon ID, else its spell's texture) and its text (its own, else its spell's name).
local function looks(r)
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
    return icon, text
end

-- The alert items of one reminder (r with any overrides already laid over it), one per time. Used by
-- the block and by the editor's Test, which runs a reminder that is not saved.
-- difficulty is not checked here; the block does that. group and ref (optional) are the run's difficulty
-- group and ability timeline (see Times).
function Reminders:Items(encounterID, id, r, group, ref)
    local out = {}
    local times = Reminders:Times(encounterID, r, ref, group)
    local icon, text = looks(r)
    local o = r.outputs or {}
    local fill = r.fill == "up" and "up" or nil
    local countTo = r.countTo == "impact" and "impact" or nil
    local warn = type(r.warn) == "number" and r.warn or 5
    -- a shield bar (Alerts/Absorb.lua): each cast's window opens at Show from, and its ticks don't apply
    local absorb = Reminders.AbsorbOf(r.absorb)
    for n, t in ipairs(times) do
        -- the bar's impact ticks, each item its own copy (BarTicks): with any on it, a bar of its own (Alerts/Bars.lua)
        -- from Show from (warn) before the cast to the cast, so each impact sits at the same place on the bar in a
        -- pull and in a test, whenever the bar first showed. A tick off the bar changes nothing
        local ticks = not absorb and Reminders.BarTicks(r.ticks, warn) or nil
        out[#out + 1] = {
            absorb = absorb and { unit = absorb.unit, length = absorb.length, lead = warn, key = BLOCK .. ":" .. tostring(id) } or nil,
            ticks = ticks,
            barStart = ticks and -warn or nil,
            barEnd = ticks and 0 or nil,
            fill = fill,
            countTo = ticks and countTo or nil,
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
                icon = o.icon and true or false, circle = o.circle and true or false,
                timeline = o.timeline and true or false },
            speech = speechList(r, text),
        }
    end
    return out
end

-- Whether a reminder was saved as Raid note (raidNote, Notes/MechNote.lua): its lines in the boss's raid note alert
-- in its place, so it runs no alerts of its own until it is Only me again.
function Reminders.InNote(r)
    return type(r) == "table" and type(r.raidNote) == "table"
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
        if r.enabled ~= false and not Reminders.InNote(r) and matchesDifficulty(r, run) then
            for _, item in ipairs(Reminders:Items(run.encounterID, e.id, r, group, run.reference)) do
                out[#out + 1] = item
            end
        end
    end
    return out
end

-- coverable: a reminder steps aside for a special alert on the same cast (Alerts/Engine.lua, No double alerts)
Alerts:RegisterBlock(BLOCK, { label = "Your reminders", group = true, own = true, coverable = true, Entries = entries })

-- The untimed shield bars of a pull (Alerts/Absorb.lua), as Special:AbsorbWatches gives a special alert's: one watch
-- per reminder turned on with absorb and its Bar on, { id, key, block, unit, length, text, icon, color, priority,
-- timed }. A reminder for the pull's difficulty group has one (timed when it has times there: the fallback while no
-- window of it is open); one for the other group only with anyDifficulty, untimed. Only a boss pull has them. {} when
-- none.
function Reminders:AbsorbWatches(run)
    local out = {}
    if not (run and run.reason == "encounter" and type(run.encounterID) == "number") then
        return out
    end
    local group = Alerts.RunGroup and Alerts:RunGroup(run) or nil
    for _, e in ipairs(Reminders:List(run.encounterID)) do
        local r = Reminders:Effective(BLOCK, e.id, e.r)
        local a = Reminders.AbsorbOf(r.absorb)
        local fits = a and matchesDifficulty(r, run)
        if a and r.enabled ~= false and not Reminders.InNote(r) and type(r.outputs) == "table" and r.outputs.bar
            and (fits or a.anyDifficulty) then
            local icon, text = looks(r)
            out[#out + 1] = {
                id = "absorb:" .. BLOCK .. ":" .. tostring(e.id),
                key = BLOCK .. ":" .. tostring(e.id),
                block = BLOCK,
                unit = a.unit,
                length = a.length,
                text = text,
                icon = icon,
                color = r.color,
                priority = Rules.Priority(3, r.priority),
                timed = fits and #Reminders:Times(run.encounterID, r, run.reference, group) > 0 or false,
            }
        end
    end
    return out
end
