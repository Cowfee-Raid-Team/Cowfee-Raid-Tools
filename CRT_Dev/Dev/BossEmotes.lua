local ADDON, CRT = ...

-- DEVELOPER ONLY. Boss debug's "emotes" section (Dev/BossDebug.lua): what a boss says and does in a pull,
-- to find the events that start its phases. While Boss debug is on, from ENCOUNTER_START to ENCOUNTER_END,
-- one line per event, "m:ss.t EVENT sender: text", each value through the secret check first (a hidden
-- one is <secret>). The lines go in with Append's always, so neither the record's MAX_LINES nor any probe's
-- cap drops one; this section's own MAX_LINES stops a runaway spam from filling the saved file, and past
-- it lines are only counted (capped "emotes limit").
--
-- Logged (payloads checked on warcraft.wiki.gg, 2026-10-28):
--   CHAT_MSG_RAID_BOSS_EMOTE, CHAT_MSG_RAID_BOSS_WHISPER, CHAT_MSG_MONSTER_YELL, _SAY and _EMOTE
--     (text, playerName: the sender), RAID_BOSS_EMOTE and RAID_BOSS_WHISPER (text, playerName, ...)
--   UNIT_TARGETABLE_CHANGED (unitTarget) on boss1 to boss8, with UnitExists and UnitCanAttack("player", unit)
--   INSTANCE_ENCOUNTER_ENGAGE_UNIT (no payload): each boss unit that exists, with UnitName
--   ENCOUNTER_START and ENCOUNTER_END, as the section's first and last lines (the last one past the limit)
--
-- Under the lines, Under(rec) gives a summary: each distinct text (colour, texture and link codes and the
-- group's names taken out) with its first time, how many times, and a phase trigger to paste in the form
-- of CRT_Modules/Alerts/PhaseDatabase.lua. Alerts/Phases.lua matches a boss emote's raw text, without
-- case, against the trigger's value as plain text, so the suggested value is the longest plain run of the
-- raw text between those codes and names: it is always found in the emote it came from. Phase triggers
-- read boss emotes only, so yells, says and whispers get no suggestion; nor does a secret text.
--
-- Saved in the boss's record: lines.emotes and counts.emotes as every section, and emoteTexts = { { group,
-- text, value, first, events = { [event] = n }, secret }, ... } in the order they first came, at most
-- MAX_TEXTS; emoteTextsOver counts the texts past it.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local BossDebug = CRT.BossDebug

local Emotes = {}
CRT.BossEmotes = Emotes

Emotes.MAX_LINES = 1500 -- the section's own limit, per pull
Emotes.MAX_TEXTS = 200 -- distinct texts the summary keeps, per pull
local SECTION = "emotes"

-- The text events and their group: the summary's label, and whether a phase trigger reads it.
local TEXTS = {
    CHAT_MSG_RAID_BOSS_EMOTE = "boss emote", RAID_BOSS_EMOTE = "boss emote",
    CHAT_MSG_RAID_BOSS_WHISPER = "boss whisper", RAID_BOSS_WHISPER = "boss whisper",
    CHAT_MSG_MONSTER_YELL = "yell", CHAT_MSG_MONSTER_SAY = "say", CHAT_MSG_MONSTER_EMOTE = "monster emote",
}
local TRIGGER_GROUP = "boss emote" -- the one group Alerts/Phases.lua's "emote" kind reads
local ALWAYS = { "ENCOUNTER_START", "ENCOUNTER_END", "INSTANCE_ENCOUNTER_ENGAGE_UNIT" }
local MAX_BOSS = 8 -- boss1 to boss8
local BOSS_UNITS = {}
for i = 1, MAX_BOSS do
    BOSS_UNITS["boss" .. i] = true
end

-- Codes the chat frame draws, not shows as text: colour, texture, atlas, link and line break.
local CODES = { "|c%x%x%x%x%x%x%x%x", "|cn[^:|]*:", "|r", "|T.-|t", "|A.-|a", "|H.-|h", "|h", "|n", "|K.-|k" }

local TEXT = {
    summary = "Summary: each distinct text, its first time, how many times, and a phase trigger to paste:",
    noTexts = "(no texts)",
    noTrigger = "  (no trigger: phase triggers read boss emotes only)",
    secretText = "  (secret text: no trigger)",
    noValue = "  (no plain text to match: no trigger)",
    over = "... %d more texts not listed (the summary keeps %d)",
    leftOut = "... %d more emote lines left out (the section keeps %d)",
}

local frame
local follow = false
local pulling = false
local startedAt = 0
local names = {} -- the group's names at the pull, longest first
local index = setmetatable({}, { __mode = "k" }) -- record -> { [key] = entry }, rebuilt from emoteTexts

local function isSecret(v)
    if not issecretvalue then
        return false
    end
    local ok, secret = pcall(issecretvalue, v)
    return not ok or secret and true or false
end

local function readable(v)
    return not isSecret(v) and v ~= nil
end

-- A game call's first result, or the text "error" when it fails.
local function ask(fn, ...)
    if type(fn) ~= "function" then
        return "missing"
    end
    local ok, v = pcall(fn, ...)
    if not ok then
        return "error"
    end
    return v
end

-- A value as a line shows it.
local function show(v)
    if isSecret(v) then
        return "<secret>"
    elseif v == nil then
        return "nil"
    elseif type(v) == "string" then
        return (v:gsub("[\r\n]+", " "))
    end
    return tostring(v)
end

-- Seconds as m:ss.t.
function Emotes.Clock(seconds)
    local tenths = math.floor((seconds or 0) * 10 + 0.5)
    local m = math.floor(tenths / 600)
    local rest = tenths - m * 600
    return string.format("%d:%02d.%d", m, math.floor(rest / 10), rest % 10)
end

local function escapePattern(s)
    return (s:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0"))
end

-- The player's and the group's names, read once at the pull.
local function readNames()
    local seen, list = {}, {}
    local function add(unit)
        local n = ask(UnitName, unit)
        if readable(n) and type(n) == "string" and #n > 1 and not seen[n] then
            seen[n] = true
            list[#list + 1] = n
        end
    end
    add("player")
    local raid = ask(IsInRaid)
    local count = ask(GetNumGroupMembers)
    if readable(count) and type(count) == "number" then
        local prefix = (readable(raid) and raid == true) and "raid" or "party"
        for i = 1, math.min(count, 40) do
            add(prefix .. i)
        end
    end
    table.sort(list, function(a, b)
        return #a > #b
    end)
    return list
end

-- The text with every code and name replaced by codeRep and nameRep.
local function mask(text, codeRep, nameRep)
    for _, p in ipairs(CODES) do
        text = text:gsub(p, codeRep)
    end
    for _, n in ipairs(names) do
        text = text:gsub(escapePattern(n), nameRep)
    end
    return text
end

-- The summary's text: no codes, the names as <name>, spaces closed up.
function Emotes.Clean(text)
    local s = text:gsub("|H.-|h", ""):gsub("[\r\n]+", " ") -- a link's visible part stays, its |H...|h goes
    s = mask(s, "", "<name>")
    return (s:gsub("%s+", " "):match("^%s*(.-)%s*$"))
end

-- The phase trigger's value: the longest plain run of the raw text between codes, names and %s, trimmed.
-- Each run is part of the raw text as it came, so Alerts/Phases.lua always finds it there.
function Emotes.TriggerValue(text)
    local s = mask(text:gsub("%%s", "\1"):gsub("[\r\n]", "\1"), "\1", "\1")
    local best = ""
    for run in s:gmatch("[^\1]+") do
        run = run:match("^%s*(.-)%s*$")
        if #run > #best then
            best = run
        end
    end
    return best ~= "" and best or nil
end

-- The section's line count, or nil when no record takes lines.
local function keptLines()
    local rec = BossDebug and BossDebug:Current()
    if not rec then
        return nil
    end
    return rec.lines[SECTION] and #rec.lines[SECTION] or 0, rec
end

-- One line, "m:ss.t EVENT body", through the section's own limit unless last (the pull's end line, kept to
-- close the section). secrets: how many values in it the game hid.
local function add(event, body, secrets, last)
    local kept = keptLines()
    if not kept then
        return
    end
    if kept >= Emotes.MAX_LINES and not last then
        BossDebug:Capped(SECTION, "limit", secrets)
        return
    end
    local line = Emotes.Clock(GetTime() - startedAt) .. " " .. event .. " " .. body
    BossDebug:Append(SECTION, line, secrets, true)
end

-- The summary's entry for a text, made on its first time.
local function note(event, text)
    local _, rec = keptLines()
    if not rec then
        return
    end
    rec.emoteTexts = rec.emoteTexts or {}
    local map = index[rec]
    if not map then
        map = {}
        for _, e in ipairs(rec.emoteTexts) do
            map[e.group .. "\0" .. (e.secret and "" or e.text)] = e
        end
        index[rec] = map
    end
    local group, secret = TEXTS[event], isSecret(text)
    local clean = (not secret and type(text) == "string") and Emotes.Clean(text) or ""
    local key = group .. "\0" .. (secret and "" or clean)
    local e = map[key]
    if not e then
        if #rec.emoteTexts >= Emotes.MAX_TEXTS then
            rec.emoteTextsOver = (rec.emoteTextsOver or 0) + 1
            return
        end
        e = { group = group, secret = secret or nil, first = GetTime() - startedAt, events = {} }
        if not secret then
            e.text = clean
            e.value = type(text) == "string" and Emotes.TriggerValue(text) or nil
        end
        rec.emoteTexts[#rec.emoteTexts + 1] = e
        map[key] = e
    end
    e.events[event] = (e.events[event] or 0) + 1
end

-- Each boss unit that exists: "boss1 Name, boss2 Name".
local function bossUnits()
    local parts, secrets = {}, 0
    for i = 1, MAX_BOSS do
        local unit = "boss" .. i
        local exists = ask(UnitExists, unit)
        if isSecret(exists) then
            parts[#parts + 1] = unit .. " exists=<secret>"
            secrets = secrets + 1
        elseif exists == true then
            local n = ask(UnitName, unit)
            if isSecret(n) then
                secrets = secrets + 1
            end
            parts[#parts + 1] = unit .. " " .. show(n)
        end
    end
    return #parts > 0 and table.concat(parts, ", ") or "no boss units", secrets
end

local function setUnitEvents(on)
    if on then
        frame:RegisterEvent("UNIT_TARGETABLE_CHANGED")
    else
        frame:UnregisterEvent("UNIT_TARGETABLE_CHANGED")
    end
end

local function onTargetable(unit)
    if isSecret(unit) then
        add("UNIT_TARGETABLE_CHANGED", "<secret>: unit hidden", 1)
        return
    end
    if type(unit) ~= "string" or not BOSS_UNITS[unit] then
        return
    end
    local exists, canAttack = ask(UnitExists, unit), ask(UnitCanAttack, "player", unit)
    local secrets = (isSecret(exists) and 1 or 0) + (isSecret(canAttack) and 1 or 0)
    add("UNIT_TARGETABLE_CHANGED", unit .. ": exists=" .. show(exists) .. " canAttack=" .. show(canAttack), secrets)
end

function Emotes.HandleEvent(event, ...)
    if not follow or not CRT.db or not BossDebug or not BossDebug:IsOn() then
        return
    end
    local a1, a2, a3, _, a5 = ...
    if event == "ENCOUNTER_START" then
        BossDebug:Open(a1, a2, a3)
        pulling = true
        startedAt = GetTime()
        names = readNames()
        setUnitEvents(true)
        local units, secrets = bossUnits()
        add(event, show(a2) .. ": " .. units, secrets + (isSecret(a2) and 1 or 0))
        return
    end
    if not pulling then
        return
    end
    if event == "ENCOUNTER_END" then
        local result = isSecret(a5) and "<secret>" or a5 == 1 and "kill" or a5 == 0 and "wipe" or show(a5)
        add(event, show(a2) .. ": " .. result, (isSecret(a2) and 1 or 0) + (isSecret(a5) and 1 or 0), true)
        pulling = false
        setUnitEvents(false)
    elseif TEXTS[event] then
        add(event, show(a2) .. ": " .. show(a1), (isSecret(a1) and 1 or 0) + (isSecret(a2) and 1 or 0))
        note(event, a1)
    elseif event == "UNIT_TARGETABLE_CHANGED" then
        onTargetable(a1)
    elseif event == "INSTANCE_ENCOUNTER_ENGAGE_UNIT" then
        add(event, bossUnits())
    end
end

-- Boss debug on or off: listens while it is on. Prints nothing.
function Emotes:Follow(on)
    follow = on and true or false
    if not frame then
        frame = CreateFrame("Frame")
        frame:SetScript("OnEvent", function(_, event, ...)
            Emotes.HandleEvent(event, ...)
        end)
    end
    frame:UnregisterAllEvents()
    pulling = false
    if follow then
        for _, e in ipairs(ALWAYS) do
            frame:RegisterEvent(e)
        end
        for e in pairs(TEXTS) do
            frame:RegisterEvent(e)
        end
    end
end

-- A summary entry's two lines.
local function entryLines(e, out)
    local events = {}
    for ev in pairs(e.events or {}) do
        events[#events + 1] = ev
    end
    table.sort(events)
    local n, parts = 0, {}
    for _, ev in ipairs(events) do
        local c = e.events[ev]
        n = math.max(n, c) -- RAID_BOSS_EMOTE and CHAT_MSG_RAID_BOSS_EMOTE both come for one emote
        parts[#parts + 1] = ev .. " " .. c
    end
    out[#out + 1] = string.format("%s %dx %s (%s): %s", Emotes.Clock(e.first), n, e.group, table.concat(parts, ", "),
        e.secret and "<secret>" or tostring(e.text))
    if e.secret then
        out[#out + 1] = TEXT.secretText
    elseif e.group ~= TRIGGER_GROUP then
        out[#out + 1] = TEXT.noTrigger
    elseif not e.value then
        out[#out + 1] = TEXT.noValue
    else
        local v = e.value:gsub("\\", "\\\\"):gsub('"', '\\"')
        out[#out + 1] = '  { kind = "emote", value = "' .. v .. '" }'
    end
end

-- The lines BossDebug's text puts under the section's lines: what the limit left out, then the summary.
function Emotes:Under(rec)
    local out = {}
    local left = rec.capped and rec.capped[SECTION .. " limit"]
    if left and left > 0 then
        out[#out + 1] = string.format(TEXT.leftOut, left, self.MAX_LINES)
    end
    out[#out + 1] = ""
    out[#out + 1] = TEXT.summary
    local list = rec.emoteTexts or {}
    if #list == 0 then
        out[#out + 1] = TEXT.noTexts
    end
    for _, e in ipairs(list) do
        entryLines(e, out)
    end
    if (rec.emoteTextsOver or 0) > 0 then
        out[#out + 1] = string.format(TEXT.over, rec.emoteTextsOver, self.MAX_TEXTS)
    end
    return out
end
