local ADDON, CRT = ...

-- Alerts as a code to paste into another CRT (the share engine, CRT_Core/Share.lua, kind "alerts"): your Mech
-- Alerts (your own reminders, Alerts/Reminders.lua) and your special alert choices (Alerts/Special.lua), and for
-- the developer tool (/crt dev alerts, CRT_Dev/Dev/AlertExport.lua) the boss files' special entries themselves.
-- The payload, version 1:
--   { v = 1, from, date, version, boss = { [encounterID] = { [group] = { reminders = { r, ... },
--     special = { [key] = choices }, defs = { def, ... } } } } }
-- group is "nh" or "mythic", or "any" for an older reminder on any difficulty and a special alert for both.
-- A reminder carries only the fields REMINDER_FIELDS lists (what the Mech Alerts store saves, ticks, fill and
-- barTo among them); special choices are { on, show, speak, markers, fill }; defs are boss file entries.
-- Reading checks every field the way the editor does (Draft's and Reminders' parsers, Special.Read) and leaves
-- out, and counts, anything that doesn't read. Read changes nothing: it compares each part with what you have
-- (new, replaces yours, same as yours), and Apply writes the picked parts into the same store the panel uses.
-- AlertShare:Read and Apply are meant for any caller (the dev window now, players sharing their own alerts
-- later). Nothing is sent as an addon message: codes are pasted by hand. Saved data only grows.

local Alerts = CRT.Alerts

local AS = {}
CRT.AlertShare = AS

AS.KIND = "alerts"
AS.VERSION = 1
-- deeper than the engine's default: a definition's rotation steps sit 9 levels in
AS.CAPS = { depth = 10, entries = 500, total = 20000, string = 2000 }

local TEXT = {
    nothing = "Nothing to export: no Mech Alerts or special alerts there.",
    combat = "Can't import during combat.",
    someone = "someone",
    summary = "%s's alerts for %s: %s.",
    counts = " %d new, %d replaces yours, %d same as yours.",
    dropped = " %d left out: not valid.",
    bosses = "%d bosses",
    reminders = { "%d Mech Alert", "%d Mech Alerts" },
    special = { "%d special alert", "%d special alerts" },
    defs = { "%d definition", "%d definitions" },
    empty = "nothing",
    boss = "encounter %d",
}
AS.TEXT = TEXT

local GROUPS = { nh = true, mythic = true, any = true }
local SHOW_KEYS = { "alert", "text", "icon", "bar", "circle", "timeline" }
local OUTPUT_KEYS = { alert = true, text = true, icon = true, bar = true, circle = true, timeline = true, speech = true }
local MAX_TEXT = 255
local MAX_FROM = 48

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
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

local function same(a, b)
    if type(a) ~= type(b) then
        return false
    end
    if type(a) ~= "table" then
        return a == b
    end
    for k, v in pairs(a) do
        if not same(v, b[k]) then
            return false
        end
    end
    for k in pairs(b) do
        if a[k] == nil then
            return false
        end
    end
    return true
end
AS.Same = same

local function finite(v)
    return type(v) == "number" and v == v and v > -math.huge and v < math.huge
end

local function wholeID(v)
    return finite(v) and v > 0 and v % 1 == 0 and v <= 2147483647
end

-- Reminder fields ------------------------------------------------------------------------------------
-- Each field a reminder may carry, and its check: the value to keep, or nil to leave it out. The ranges are
-- the Mech Alerts panel's (Show from 1 to 60 s, Linger 0 to 10 s).

local function textField(max)
    return function(v)
        if type(v) == "string" and #v <= max then
            return v
        end
    end
end

local function oneOf(set)
    return function(v)
        if set[v] then
            return v
        end
    end
end

local function flag(v)
    if type(v) == "boolean" then
        return v
    end
end

local function seconds(lo, hi)
    return function(v)
        if finite(v) and v >= lo and v <= hi then
            return v
        end
    end
end

local CAST_KEY = "^P[%d%.]+@[%d:%.]+$"

local function castKey(k)
    if type(k) ~= "string" or #k > 32 then
        return false
    end
    local base = k:gsub("#%d+$", "")
    return base:find(CAST_KEY) ~= nil
end

-- shifts or off: { [group] = { [castKey] = value } }; check(value) keeps a value or gives nil.
local function perCast(check)
    return function(v, count)
        if type(v) ~= "table" then
            return nil
        end
        local out
        for g, list in pairs(v) do
            if (g == "nh" or g == "mythic") and type(list) == "table" then
                for k, x in pairs(list) do
                    local good = castKey(k) and check(x)
                    if good ~= nil then
                        out = out or {}
                        out[g] = out[g] or {}
                        out[g][k] = good
                    else
                        count()
                    end
                end
            else
                count()
            end
        end
        return out
    end
end

local REMINDER_FIELDS = {
    boss = textField(100),
    spellID = function(v)
        if wholeID(v) then
            return v
        end
    end,
    iconID = function(v)
        if wholeID(v) then
            return v
        end
    end,
    text = textField(MAX_TEXT),
    times = function(v)
        if type(v) == "string" and #v <= MAX_TEXT and trim(v) ~= "" and CRT.AlertReminders.ParseTimes(v) then
            return v
        end
    end,
    outputs = function(v, count)
        if type(v) ~= "table" then
            return nil
        end
        local out = {}
        for k, x in pairs(v) do
            if OUTPUT_KEYS[k] and type(x) == "boolean" then
                out[k] = x
            else
                count()
            end
        end
        return out
    end,
    warn = seconds(1, 60),
    speech = oneOf({ text = true, textcount = true, count = true }),
    priority = oneOf({ high = true, normal = true, low = true }),
    group = oneOf({ nh = true, mythic = true }),
    difficulty = textField(40),
    enabled = flag,
    linger = seconds(0, 10),
    sound = function(v)
        if type(v) ~= "string" or #v > MAX_TEXT then
            return nil
        end
        local Sound = CRT.Sound
        if Sound and Sound.Normalize then
            return Sound.Normalize(v)
        end
        return v
    end,
    auraSound = flag,
    glow = flag,
    color = function(v)
        if type(v) ~= "table" or #v < 3 or #v > 4 then
            return nil
        end
        local out = {}
        for k, x in pairs(v) do
            if type(k) ~= "number" or k < 1 or k > 4 or k % 1 ~= 0 or not finite(x) or x < 0 or x > 1 then
                return nil
            end
            out[k] = x
        end
        return out
    end,
    speakAt = oneOf({ zero = true }),
    -- the impact ticks as the Impact ticks box reads them: seconds after the cast, 0 or more, in order
    ticks = function(v, count)
        if type(v) ~= "table" then
            return nil
        end
        local n = 0
        for _ in pairs(v) do
            n = n + 1
        end
        local list = CRT.AlertReminders.TickList(v)
        local kept = list and #list or 0
        for _ = 1, n - kept do
            count()
        end
        return list
    end,
    fill = oneOf({ up = true }),
    barTo = oneOf({ cast = true }),
    shifts = perCast(function(x)
        if finite(x) and math.abs(x) <= 600 then
            return x
        end
    end),
    off = perCast(function(x)
        if x == true then
            return true
        end
    end),
}
AS.REMINDER_FIELDS = REMINDER_FIELDS

-- A reminder with only the fields that travel, each checked. Returns the clean copy (nil when it isn't a
-- reminder you could save: no spell and no text, or nothing it shows, as Draft.Problem says) and how many
-- parts were left out.
function AS.CleanReminder(r)
    if type(r) ~= "table" then
        return nil, 1
    end
    local dropped = 0
    local function count()
        dropped = dropped + 1
    end
    local out = {}
    for k, v in pairs(r) do
        local check = REMINDER_FIELDS[k]
        local good = check and check(v, count)
        if good ~= nil then
            out[k] = good
        elseif check ~= nil or type(k) ~= "string" or not k:find("^times") then
            -- the migration's bookkeeping (timesBackup, timesUnmatched, timesMigrated) stays behind quietly
            count()
        end
    end
    if not (out.spellID or trim(out.text) ~= "") then
        return nil, dropped + 1
    end
    local Draft = CRT.AlertDraft
    if Draft and Draft.ForReminder and Draft.Problem and Draft.Problem(nil, Draft.ForReminder(out)) then
        return nil, dropped + 1
    end
    return out, dropped
end

-- Special choices -------------------------------------------------------------------------------------

-- Incoming choices laid over base (your own for the entry, Special:Choices), each field checked; a field that
-- doesn't read keeps base's and is counted.
local function cleanChoices(v, base, count)
    local out = copy(base)
    if type(v) ~= "table" then
        count()
        return out
    end
    for k, x in pairs(v) do
        if k == "on" or k == "speak" or k == "markers" then
            if type(x) == "boolean" then
                out[k] = x
            else
                count()
            end
        elseif k == "fill" then
            if x == "up" or x == "down" then
                out.fill = x
            else
                count()
            end
        elseif k == "show" and type(x) == "table" then
            for sk, sv in pairs(x) do
                if out.show[sk] ~= nil and type(sv) == "boolean" then
                    out.show[sk] = sv
                else
                    count()
                end
            end
        else
            count()
        end
    end
    return out
end

-- Collecting -----------------------------------------------------------------------------------------

local function playerName()
    local ok, name = pcall(UnitName, "player")
    if not ok or type(name) ~= "string" or (issecretvalue and issecretvalue(name)) then
        return TEXT.someone
    end
    return name
end

local function cleanName(from)
    if type(from) ~= "string" then
        return TEXT.someone
    end
    from = from:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|", ""):sub(1, MAX_FROM)
    return from ~= "" and from or TEXT.someone
end

local function bossName(enc)
    local def = CRT.Bosses and CRT.Bosses.Get and CRT.Bosses:Get(enc)
    return def and def.name or TEXT.boss:format(enc)
end
AS.BossName = bossName

-- The bosses to export: the list given, else every boss with a reminder or a special alert, in route order
-- (bosses off the route after, by encounter ID).
local function bossList(opts)
    if type(opts.bosses) == "table" then
        return opts.bosses
    end
    local seen, out = {}, {}
    local function add(enc)
        if type(enc) == "number" and not seen[enc] then
            seen[enc] = true
            out[#out + 1] = enc
        end
    end
    local Bosses = CRT.Bosses
    for _, def in ipairs(Bosses and Bosses.RouteList and Bosses:RouteList() or {}) do
        add(def.encounterID)
    end
    local rest = {}
    for enc in pairs((Alerts:Settings() or {}).reminders or {}) do
        if type(enc) == "number" and not seen[enc] then
            rest[#rest + 1] = enc
        end
    end
    table.sort(rest)
    for _, enc in ipairs(rest) do
        add(enc)
    end
    return out
end
AS.BossList = bossList

-- The raw boss file entries of a boss, then the developer's sample, as written.
local function rawDefs(enc)
    local out = {}
    local Bosses, Special = CRT.Bosses, CRT.AlertSpecial
    local def = Bosses and Bosses.Get and Bosses:Get(enc)
    local loaded = def and (not Bosses.Loaded or Bosses:Loaded(enc))
    for _, list in ipairs({ loaded and def.special or {}, Special and Special.dev[enc] or {} }) do
        for _, d in ipairs(type(list) == "table" and list or {}) do
            if type(d) == "table" and Special.Read(d) then
                out[#out + 1] = d
            end
        end
    end
    return out
end
AS.RawDefs = rawDefs

local function slot(boss, enc, group)
    boss[enc] = boss[enc] or {}
    boss[enc][group] = boss[enc][group] or {}
    return boss[enc][group]
end

-- One boss's parts into the payload's boss table. Returns how many parts it added.
local function collectBoss(boss, enc, opts)
    local n = 0
    local Special, Reminders = CRT.AlertSpecial, CRT.AlertReminders
    if opts.reminders then
        for _, e in ipairs(Reminders:List(enc)) do
            local clean = AS.CleanReminder(e.r)
            if clean then
                local s = slot(boss, enc, Reminders.GroupOf(e.r) or "any")
                s.reminders = s.reminders or {}
                s.reminders[#s.reminders + 1] = clean
                n = n + 1
            end
        end
    end
    if opts.special then
        for _, entry in ipairs(Special:List(enc)) do
            local s = slot(boss, enc, entry.difficulty or "any")
            s.special = s.special or {}
            s.special[entry.key] = Special:Choices(enc, entry)
            n = n + 1
        end
        if opts.defs then
            for _, d in ipairs(rawDefs(enc)) do
                local s = slot(boss, enc, d.difficulty or "any")
                s.defs = s.defs or {}
                s.defs[#s.defs + 1] = copy(d)
                n = n + 1
            end
        end
    end
    return n
end

-- The payload for opts: { bosses (a list of encounter IDs; nil for every boss), special (your choices),
-- reminders (your Mech Alerts), defs (the boss files' entries too: developer builds) }. Returns it and how many
-- parts it holds.
function AS:Collect(opts)
    opts = opts or {}
    local boss, n = {}, 0
    for _, enc in ipairs(bossList(opts)) do
        n = n + collectBoss(boss, enc, opts)
    end
    return { v = AS.VERSION, from = playerName(), date = date("%Y-%m-%d"), version = tostring(CRT.version or "dev"), boss = boss }, n
end

-- The code for opts (as Collect). Returns the code and how many parts it holds, or nil and the reason.
function AS:Export(opts)
    local payload, n = self:Collect(opts)
    if n == 0 then
        return nil, TEXT.nothing
    end
    local code, err = CRT.Share.Encode(AS.KIND, AS.VERSION, payload)
    if not code then
        return nil, err
    end
    return code, n
end

-- Reading and comparing ---------------------------------------------------------------------------------

local function groupOf(r)
    return CRT.AlertReminders.GroupOf(r) or "any"
end

-- Your reminder an incoming one would replace: the same boss and difficulty group, and the same spell (the
-- same text first, when several have it), else, with no spell, the same text. Each of yours once.
local function findMatch(enc, group, clean, taken)
    local want = trim(clean.text):lower()
    local best
    for _, e in ipairs(CRT.AlertReminders:List(enc)) do
        local r = e.r
        if not taken[e.id] and groupOf(r) == group then
            local sameText = trim(r.text):lower() == want
            if clean.spellID then
                if r.spellID == clean.spellID and (sameText or not best) then
                    best = e
                    if sameText then
                        break
                    end
                end
            elseif not (type(r.spellID) == "number" and r.spellID > 0) and sameText then
                best = e
                break
            end
        end
    end
    return best
end

-- A reminder as Reminders:Save keeps it, its defaults filled in, so one saved from a code compares the same
-- as the code's.
local function asSaved(r)
    if type(r) ~= "table" then
        return nil
    end
    local out = copy(r)
    out.outputs = out.outputs or {}
    for _, k in ipairs({ "alert", "bar", "speech" }) do
        if out.outputs[k] == nil then
            out.outputs[k] = true
        end
    end
    out.warn = out.warn or 5
    out.speech = out.speech or "text"
    out.priority = out.priority or "normal"
    if out.enabled == nil then
        out.enabled = true
    end
    return out
end

local function readReminders(info, enc, group, list, taken)
    if type(list) ~= "table" then
        info.dropped = info.dropped + 1
        return
    end
    for _, r in ipairs(list) do
        local clean, dropped = AS.CleanReminder(r)
        info.dropped = info.dropped + dropped
        if clean then
            -- the slot says the group: a reminder's own group must agree
            if group ~= "any" then
                clean.group = group
            elseif clean.group then
                clean.group = nil
                info.dropped = info.dropped + 1
            end
            local match = findMatch(enc, group, clean, taken)
            local item = { kind = "reminder", enc = enc, group = group, value = clean, label = clean.text }
            if match then
                taken[match.id] = true
                item.target = match.id
                item.status = same(asSaved(AS.CleanReminder(match.r)), asSaved(clean)) and "same" or "replace"
            else
                item.status = "new"
            end
            info.items[#info.items + 1] = item
        end
    end
end

local function readSpecial(info, enc, group, map, defs)
    local Special = CRT.AlertSpecial
    if type(map) ~= "table" then
        info.dropped = info.dropped + 1
        return
    end
    for key, v in pairs(map) do
        local entry = type(key) == "string" and Special:Get(enc, key)
        if entry or (type(key) == "string" and defs[key]) then
            local base = entry and Special:Choices(enc, entry) or { on = false, show = {}, speak = true, markers = false, fill = "up" }
            if not entry then
                for _, k in ipairs(SHOW_KEYS) do
                    base.show[k] = false
                end
            end
            local clean = cleanChoices(v, base, function()
                info.dropped = info.dropped + 1
            end)
            info.items[#info.items + 1] = { kind = "special", enc = enc, group = group, key = key, value = clean, label = entry and entry.label or key,
                status = same(clean, base) and "same" or "replace" }
        else
            info.dropped = info.dropped + 1
        end
    end
end

-- The definitions in a code: one this CRT has (shipped or the developer's sample) is the same or differs and
-- is never changed; a new one can be loaded for this session. Returns the keys of the new ones.
local function readDefs(info, enc, group, list)
    local Special = CRT.AlertSpecial
    local newKeys = {}
    if type(list) ~= "table" then
        info.dropped = info.dropped + 1
        return newKeys
    end
    local have = {}
    for _, d in ipairs(rawDefs(enc)) do
        have[d.key] = d
    end
    for _, d in ipairs(list) do
        local entry = Special.Read(d)
        if entry then
            local mine = have[entry.key]
            local status = not mine and "new" or (same(mine, d) and "same" or "differs")
            if status == "new" then
                newKeys[entry.key] = true
            end
            info.items[#info.items + 1] = { kind = "def", enc = enc, group = group, key = entry.key, value = copy(d), label = entry.label, status = status }
        else
            info.dropped = info.dropped + 1
        end
    end
    return newKeys
end

local function addCounts(info)
    info.counts = { new = 0, replace = 0, same = 0, differs = 0 }
    info.kinds = { reminder = 0, special = 0, def = 0 }
    for _, it in ipairs(info.items) do
        info.counts[it.status] = info.counts[it.status] + 1
        info.kinds[it.kind] = info.kinds[it.kind] + 1
    end
end

-- Reads a pasted code without changing anything. Returns { from, date, version, bosses = { encounterID, ... },
-- items = { { kind = "reminder" | "special" | "def", enc, group, key, label, value, status = "new" | "replace"
-- | "same" | "differs" (a definition), target (the reminder replaced) } }, counts, kinds, dropped }, or nil and
-- the reason.
function AS:Read(text)
    local data, err = CRT.Share.Decode(text, AS.KIND, AS.VERSION, AS.CAPS)
    if not data then
        return nil, err
    end
    if type(data.v) == "number" and data.v > AS.VERSION then
        return nil, CRT.Share.TEXT.newer
    end
    if type(data.boss) ~= "table" then
        return nil, CRT.Share.TEXT.damaged
    end
    local info = { from = cleanName(data.from), date = type(data.date) == "string" and data.date:sub(1, 10) or nil,
        version = type(data.version) == "string" and data.version:sub(1, 20) or nil, bosses = {}, items = {}, dropped = 0 }
    local encs = {}
    for enc in pairs(data.boss) do
        if wholeID(enc) and type(data.boss[enc]) == "table" then
            encs[#encs + 1] = enc
        else
            info.dropped = info.dropped + 1
        end
    end
    table.sort(encs)
    for _, enc in ipairs(encs) do
        info.bosses[#info.bosses + 1] = enc
        local taken = {}
        local groups = {}
        for group, part in pairs(data.boss[enc]) do
            if GROUPS[group] and type(part) == "table" then
                groups[#groups + 1] = group
            else
                info.dropped = info.dropped + 1
            end
        end
        table.sort(groups)
        -- definitions first: a choice for a definition the code brings is read with it
        local newDefs = {}
        for _, group in ipairs(groups) do
            local part = data.boss[enc][group]
            if part.defs ~= nil then
                for k in pairs(readDefs(info, enc, group, part.defs)) do
                    newDefs[k] = true
                end
            end
        end
        for _, group in ipairs(groups) do
            local part = data.boss[enc][group]
            if part.reminders ~= nil then
                readReminders(info, enc, group, part.reminders, taken)
            end
            if part.special ~= nil then
                readSpecial(info, enc, group, part.special, newDefs)
            end
        end
    end
    addCounts(info)
    return info
end

local function plural(pair, n)
    return (n == 1 and pair[1] or pair[2]):format(n)
end

-- One short line: whose code, for which bosses, what it holds, and how many parts are new, replace yours or
-- are the same as yours (and how many were left out).
function AS.Summary(info)
    local where = #info.bosses == 1 and bossName(info.bosses[1]) or TEXT.bosses:format(#info.bosses)
    local parts = {}
    if info.kinds.reminder > 0 then
        parts[#parts + 1] = plural(TEXT.reminders, info.kinds.reminder)
    end
    if info.kinds.special > 0 then
        parts[#parts + 1] = plural(TEXT.special, info.kinds.special)
    end
    if info.kinds.def > 0 then
        parts[#parts + 1] = plural(TEXT.defs, info.kinds.def)
    end
    local line = TEXT.summary:format(info.from, where, #parts > 0 and table.concat(parts, ", ") or TEXT.empty)
        .. TEXT.counts:format(info.counts.new, info.counts.replace, info.counts.same)
    if info.dropped > 0 then
        line = line .. TEXT.dropped:format(info.dropped)
    end
    return line
end

-- Applying ---------------------------------------------------------------------------------------------

local function applyReminder(item)
    local Reminders = CRT.AlertReminders
    local clean = copy(item.value)
    if item.status == "new" then
        return Reminders:Save(item.enc, nil, clean, item.group ~= "any" and item.group or nil) ~= nil
    end
    local mine = Reminders:Get(item.enc, item.target)
    if not mine then
        return false
    end
    -- every field that travels is the code's; the rest (this computer's bookkeeping) stays as it was
    local merged = copy(mine)
    for k in pairs(REMINDER_FIELDS) do
        merged[k] = clean[k]
    end
    return Reminders:Save(item.enc, item.target, merged) ~= nil
end

local function applySpecial(item)
    local db = Alerts:Settings()
    if type(db) ~= "table" then
        return false
    end
    db.special = type(db.special) == "table" and db.special or {}
    db.special[item.enc] = type(db.special[item.enc]) == "table" and db.special[item.enc] or {}
    db.special[item.enc][item.key] = copy(item.value)
    return true
end

-- A new definition goes on the boss as the developer's sample does (Special.dev): for this session, never saved.
-- A new list, so the special alerts read it again.
local function applyDef(item)
    local Special = CRT.AlertSpecial
    local list = {}
    for _, d in ipairs(Special.dev[item.enc] or {}) do
        list[#list + 1] = d
    end
    list[#list + 1] = copy(item.value)
    Special.dev[item.enc] = list
    return true
end

-- Writes the picked parts of a read code: pick(item) says which (default: every new one and every one that
-- replaces yours; a definition that differs from this CRT's is never written). Returns how many were written, or
-- nil and the reason.
function AS:Apply(info, pick)
    if InCombatLockdown and InCombatLockdown() then
        return nil, TEXT.combat
    end
    local n = 0
    -- definitions first, so a choice for one finds it
    for _, kind in ipairs({ "def", "reminder", "special" }) do
        for _, item in ipairs(info.items) do
            local wanted = item.kind == kind and (item.status == "new" or item.status == "replace")
            if wanted and pick then
                wanted = pick(item) and true or false
            end
            if wanted then
                local done
                if kind == "def" then
                    done = applyDef(item)
                elseif kind == "reminder" then
                    done = applyReminder(item)
                else
                    done = applySpecial(item)
                end
                if done then
                    n = n + 1
                end
            end
        end
    end
    if n > 0 then
        Alerts:Fire()
    end
    return n
end
