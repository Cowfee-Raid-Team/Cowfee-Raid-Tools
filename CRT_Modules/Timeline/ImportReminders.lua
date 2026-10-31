local ADDON, CRT = ...

-- Import reminders: reads an export of the Timeline Reminders addon, pasted as text, into your own reminders, so
-- each of its alerts sits on the Timeline's Personal notes row as one of your reminders. Built only from a sample
-- export: no code of that addon was read. Nothing here draws; the pop-out is Timeline/ImportWindow.lua.
--
-- The format, as the sample has it:
--   EncounterID:3492;Difficulty:Heroic;Name:Ula'tek          a boss's header; blank lines between bosses
--   ph:1;time:135.5;tag:11;dur:10;text:Damage Amp;          one reminder: key:value; pairs, in any order
--   ph:1;time:407.5;tag:everyone;dur:20;text:Soak;colors:1.0000 0.0745 0.1529 1;
-- ph is the phase number, time seconds (with decimals), tag who it is for ("everyone" or a class ID), dur how long
-- it shows, text what it says (may be empty) and colors "r g b a" from 0 to 1. A key or header field not listed is
-- kept as it was on the reminder (import.extra, import.bossExtra) and never stops the import.
--
--   Import.Parse(text)          the text as { bosses = { { encounterID, difficulty, name, reminders, skipped,
--                               extra } }, skipped }, pure: reminders are { line, ph, time, tag, dur, text, color,
--                               extra }, skipped { { line, reason } }; lines before any header are skipped at the top
--   Import.Plan(parsed, classID) what would be imported for you: per boss its group, whether the season knows it,
--                               the reminders for you (ForPlayer) as reminder tables, and every skipped line
--   Import.Apply(plan, opts)    writes them through the reminders' own save path (Alerts/Draft.lua, Alerts/Reminders.lua)
--
-- Saved data (additive): each imported reminder has import = { source = Import.SOURCE, tag, ph, time, dur, text,
-- extra, bossExtra } (text only when the line's was empty; extra and bossExtra only when there are unknown fields).
-- Replace deletes only reminders whose import.source is Import.SOURCE, for the bosses and difficulty groups pasted.
-- It never touches a note, for a raid leader or a raider: only CRT.db.alerts.reminders.

local Import = {}
CRT.TimelineImport = Import

Import.SOURCE = "timeline-reminders"
Import.FORMAT_NAME = "Timeline Reminders"

local TEXT = {
    placeholder = "Reminder",
    beforeBoss = "before any boss line",
    notReminder = "not a reminder line",
    noTime = "no time",
    badTime = "bad time (%s)",
    beforePull = "a time before the pull (%s)",
    badPhase = "bad phase (%s)",
    noTag = "no tag",
    otherTag = "for another tag (%s)",
    badBoss = "no encounter ID",
    badDifficulty = "unknown difficulty (%s)",
    noDifficulty = "no difficulty",
    duplicate = "already one of your reminders",
    combat = "Can't import during combat.",
    saveFailed = "could not be saved",
}
Import.TEXT = TEXT

-- The keys a reminder line reads; any other is kept in import.extra.
local LINE_KEYS = { ph = true, time = true, tag = true, dur = true, text = true, colors = true }
local HEADER_KEYS = { encounterid = true, difficulty = true, name = true }
-- The difficulty names a header may give, in lower case: only these are read (Normal and Heroic share a group).
local DIFFICULTIES = { normal = "Normal", heroic = "Heroic", mythic = "Mythic" }

local function trim(s)
    return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- "k:v;k:v;" into { { key, value } } in order, the key as written and the value trimmed. A part with no ":" gives
-- nil (the line is not key:value pairs). The last part may lack its ";".
local function pairsOf(line)
    local out = {}
    for part in (line .. ";"):gmatch("([^;]*);") do
        if trim(part) ~= "" then
            local key, value = part:match("^%s*([^:]-)%s*:(.*)$")
            if not key or key == "" then
                return nil
            end
            out[#out + 1] = { key = key, value = trim(value) }
        end
    end
    return out
end

-- "1.0000 0.0745 0.1529 1" into { r, g, b, 1 } (the alerts' colour shape, Alerts/Editor.lua's), or nil.
function Import.Color(s)
    local nums = {}
    for word in tostring(s or ""):gmatch("%S+") do
        nums[#nums + 1] = tonumber(word)
    end
    for i = 1, 3 do
        local v = nums[i]
        if type(v) ~= "number" or v ~= v or v < 0 or v > 1 then
            return nil
        end
    end
    return { nums[1], nums[2], nums[3], 1 }
end

-- One reminder line into { line, ph, time, tag, dur, text, color, extra }, or nil and why it is skipped.
local function readLine(raw, list)
    local r = { line = raw, extra = nil }
    for _, p in ipairs(list) do
        local key = p.key:lower()
        if LINE_KEYS[key] then
            r[key] = p.value
        else
            r.extra = r.extra or {}
            r.extra[p.key] = p.value
        end
    end
    if r.time == nil then
        return nil, TEXT.noTime
    end
    local t = tonumber(r.time)
    if not t or t ~= t or t == math.huge then
        return nil, string.format(TEXT.badTime, r.time)
    end
    if t < 0 then
        return nil, string.format(TEXT.beforePull, r.time)
    end
    local ph = 1
    if r.ph ~= nil and r.ph ~= "" then
        ph = tonumber(r.ph)
        if not ph or ph < 1 then
            return nil, string.format(TEXT.badPhase, r.ph)
        end
    end
    local out = { line = raw, ph = ph, time = t, tag = r.tag, dur = tonumber(r.dur), text = trim(r.text),
        extra = r.extra }
    if r.colors ~= nil then
        out.color = Import.Color(r.colors)
        if not out.color then
            -- a colour that doesn't read is kept as it was
            out.extra = out.extra or {}
            out.extra.colors = r.colors
        end
    end
    return out
end

-- A header line's pairs into a boss.
local function readHeader(list)
    local boss = { reminders = {}, skipped = {} }
    for _, p in ipairs(list) do
        local key = p.key:lower()
        if key == "encounterid" then
            boss.encounterID = tonumber(p.value)
        elseif key == "difficulty" then
            boss.difficulty = p.value
        elseif key == "name" then
            boss.name = p.value
        end
        if not HEADER_KEYS[key] then
            boss.extra = boss.extra or {}
            boss.extra[p.key] = p.value
        end
    end
    return boss
end

local function isHeader(list)
    for _, p in ipairs(list) do
        if p.key:lower() == "encounterid" then
            return true
        end
    end
    return false
end

-- The pasted text into bosses. Pure: no saved data, no game calls.
function Import.Parse(text)
    local out = { bosses = {}, skipped = {} }
    if type(text) ~= "string" then
        return out
    end
    local boss
    for raw in (text:gsub("\r\n?", "\n") .. "\n"):gmatch("([^\n]*)\n") do
        local line = trim(raw)
        if line ~= "" then
            local list = pairsOf(line)
            if list and #list > 0 and isHeader(list) then
                boss = readHeader(list)
                out.bosses[#out.bosses + 1] = boss
            elseif not boss then
                out.skipped[#out.skipped + 1] = { line = line, reason = TEXT.beforeBoss }
            elseif not list or #list == 0 then
                boss.skipped[#boss.skipped + 1] = { line = line, reason = TEXT.notReminder }
            else
                local r, why = readLine(line, list)
                if r then
                    boss.reminders[#boss.reminders + 1] = r
                else
                    boss.skipped[#boss.skipped + 1] = { line = line, reason = why }
                end
            end
        end
    end
    return out
end

-- The rules (each in one place) ------------------------------------------------------------------------

-- Who a line is for, until the format's tags are settled: "everyone", and a class ID that is the player's own
-- (UnitClass's third value). Any other tag is for someone else.
function Import.ForPlayer(tag, classID)
    if type(tag) ~= "string" or tag == "" then
        return false, TEXT.noTag
    end
    if tag:lower() == "everyone" then
        return true
    end
    local n = tonumber(tag)
    if n and type(classID) == "number" and n == classID then
        return true
    end
    return false, string.format(TEXT.otherTag, tag)
end

-- The player's class ID, or nil when the game doesn't give a readable one.
function Import.PlayerClassID()
    if not UnitClass then
        return nil
    end
    local ok, _, _, id = pcall(UnitClass, "player")
    if not ok or (issecretvalue and issecretvalue(id)) or type(id) ~= "number" then
        return nil
    end
    return id
end

-- A line's time as the reminder's typed times: phase 1 is seconds from the pull ("P1 2:15.5"); a later phase's
-- time is seconds from that phase's start ("P2 +0:48.1"), as a typed P2 time is (Reminders.AbsoluteTime places it
-- from the phase line on the ability timeline).
function Import.Times(ph, time)
    return CRT.AlertReminders.FormatTimes({ { ph = ph, t = time } })
end

-- How long a line shows as the reminder's Show from (warn): its alert and bar come up dur seconds before its time
-- and run to it (Alerts/Reminders.lua's Items). Show from's own range, 1 to 60 seconds; none: the default 5.
local WARN_MIN, WARN_MAX, WARN_DEFAULT = 1, 60, 5
function Import.Warn(dur)
    if type(dur) ~= "number" or dur ~= dur then
        return WARN_DEFAULT
    end
    return math.max(WARN_MIN, math.min(WARN_MAX, math.floor(dur * 10 + 0.5) / 10))
end

-- A header's difficulty as a reminder's group ("nh" or "mythic", through Reminders.GroupOf), or nil and why.
function Import.Group(difficulty)
    local name = DIFFICULTIES[trim(difficulty):lower()]
    if not name then
        if trim(difficulty) == "" then
            return nil, TEXT.noDifficulty
        end
        return nil, string.format(TEXT.badDifficulty, trim(difficulty))
    end
    return CRT.AlertReminders.GroupOf({ difficulty = name })
end

-- Planning ------------------------------------------------------------------------------------------------

-- The reminder a line becomes, made as the alert editor makes a new one (Draft.New, Draft.BuildReminder): Only
-- me, its time typed, its text (or the placeholder), colour and Show from; the rest the editor's defaults.
local function reminderOf(boss, line)
    local Draft = CRT.AlertDraft
    local draft = Draft.New()
    Draft.SetGroup(draft, boss.group)
    draft.boss = boss.bossName
    draft.text = line.text ~= "" and line.text or TEXT.placeholder
    draft.ph = line.ph
    draft.timeText = ("%.10g"):format(line.time)
    draft.timeTouched = true
    draft.warn = Import.Warn(line.dur)
    draft.color = line.color and { line.color[1], line.color[2], line.color[3], line.color[4] } or nil
    local r = Draft.BuildReminder({ encounterID = boss.encounterID }, draft)
    -- the phase rule is Import.Times, whatever the draft's time box reads
    r.times = Import.Times(line.ph, line.time)
    r.import = { source = Import.SOURCE, tag = line.tag, ph = line.ph, time = line.time, dur = line.dur,
        text = line.text == "" and "" or nil, extra = line.extra, bossExtra = boss.extra }
    return r
end

-- What the parsed text would import for a player of classID: { bosses = { { encounterID, name, difficulty, group,
-- known, reminders = { reminder tables }, skipped = { { line, reason } }, reason } }, skipped, count }. A boss
-- with a reason (no encounter ID, an unknown difficulty) imports nothing; known is false for a boss the season
-- doesn't have (still imported, by its encounter ID). count is how many reminders would be written.
function Import.Plan(parsed, classID)
    local out = { bosses = {}, skipped = parsed and parsed.skipped or {}, count = 0 }
    local Bosses = CRT.Bosses
    for _, b in ipairs(parsed and parsed.bosses or {}) do
        local def = b.encounterID and Bosses and Bosses.Get and Bosses:Get(b.encounterID)
        local p = { encounterID = b.encounterID, name = (def and def.name) or b.name, difficulty = b.difficulty,
            known = def ~= nil and def ~= false, extra = b.extra, reminders = {}, skipped = {} }
        p.bossName = p.name
        for _, s in ipairs(b.skipped) do
            p.skipped[#p.skipped + 1] = s
        end
        if not b.encounterID then
            p.reason = TEXT.badBoss
        else
            p.group, p.reason = Import.Group(b.difficulty)
        end
        if not p.reason then
            for _, line in ipairs(b.reminders) do
                local mine, why = Import.ForPlayer(line.tag, classID)
                if mine then
                    p.reminders[#p.reminders + 1] = reminderOf(p, line)
                else
                    p.skipped[#p.skipped + 1] = { line = line.line, reason = why }
                end
            end
        else
            for _, line in ipairs(b.reminders) do
                p.skipped[#p.skipped + 1] = { line = line.line, reason = p.reason }
            end
        end
        out.count = out.count + #p.reminders
        out.bosses[#out.bosses + 1] = p
    end
    return out
end

-- Writing ---------------------------------------------------------------------------------------------------

-- The key two reminders are the same by: their group, typed time and text.
local function sameKey(group, times, text)
    local R = CRT.AlertReminders
    local list = type(times) == "string" and R.ParseTimes(times)
    if not list then
        return nil
    end
    return tostring(group) .. "|" .. R.FormatTimes(list) .. "|" .. trim(text):lower()
end

local function imported(r)
    return type(r) == "table" and type(r.import) == "table" and r.import.source == Import.SOURCE
end

-- Writes the plan: with opts.replace, first deletes what this importer wrote before for each boss and group
-- pasted; then saves each reminder through Reminders:Save, leaving out one that is the same (group, time, text)
-- as a reminder the boss already has. Returns { added, removed, duplicates, failed }, or nil and the message
-- (during combat, as the Timeline's other edits).
function Import.Apply(plan, opts)
    if InCombatLockdown and InCombatLockdown() then
        return nil, TEXT.combat
    end
    local R = CRT.AlertReminders
    local res = { added = 0, removed = 0, duplicates = 0, failed = 0 }
    for _, p in ipairs(plan and plan.bosses or {}) do
        if p.group and p.encounterID then
            if opts and opts.replace then
                for _, e in ipairs(R:List(p.encounterID)) do
                    if imported(e.r) and R.GroupOf(e.r) == p.group then
                        R:Delete(p.encounterID, e.id)
                        res.removed = res.removed + 1
                    end
                end
            end
            local seen = {}
            for _, e in ipairs(R:List(p.encounterID)) do
                local key = R.GroupOf(e.r) == p.group and sameKey(p.group, e.r.times, e.r.text)
                if key then
                    seen[key] = true
                end
            end
            for _, r in ipairs(p.reminders) do
                local key = sameKey(p.group, r.times, r.text)
                if key and seen[key] then
                    res.duplicates = res.duplicates + 1
                elseif R:Save(p.encounterID, nil, r, p.group) then
                    res.added = res.added + 1
                    if key then
                        seen[key] = true
                    end
                else
                    res.failed = res.failed + 1
                end
            end
        end
    end
    return res
end
