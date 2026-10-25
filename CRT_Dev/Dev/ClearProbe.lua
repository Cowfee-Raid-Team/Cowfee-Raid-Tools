local ADDON, CRT = ...

-- DEVELOPER ONLY. Finds a boss's reset moment for a marker display's clearOn (Markers/ClearOn.lua).
-- /crt dev clearprobe on logs every boss pull, from ENCOUNTER_START to ENCOUNTER_END, one line per event
-- that could mark a reset, with the seconds from the pull and each value as it came, or <secret> when
-- the game hid it. /crt dev clearprobe show prints a count per event (and which fields were secret) and
-- opens the whole log in a window to copy (Ctrl+C). /crt dev clearprobe off stops it; the log stays.
--
-- Logged (every name checked in Blizzard's 12.1.5 API documentation, 2026-10-21):
--   ENCOUNTER_TIMELINE_EVENT_ADDED (the info table's id, source, spellID, spellName, duration,
--     isApproximate), _STATE_CHANGED (with GetEventState), _TRACK_CHANGED (with GetEventTrack),
--     _REMOVED, _HIGHLIGHT, _BLOCK_STATE_CHANGED, ENCOUNTER_TIMELINE_STATE_UPDATED, _LAYOUT_UPDATED,
--     _VIEW_ACTIVATED and _VIEW_DEACTIVATED
--   CHAT_MSG_RAID_BOSS_EMOTE, CHAT_MSG_RAID_BOSS_WHISPER, CHAT_MSG_MONSTER_YELL, _SAY and _EMOTE (text,
--     sender), RAID_BOSS_EMOTE and RAID_BOSS_WHISPER (text, sender, displayTime)
--   UNIT_SPELLCAST_START, _SUCCEEDED and _CHANNEL_START on boss1 to boss5 (spellID, and its name when
--     readable), UNIT_TARGETABLE_CHANGED on them (with UnitExists and UnitCanAttack), boss health
--     (UNIT_HEALTH with UnitHealthPercent: the first value, then each jump up of over 1% or down of
--     over 10% in one update; a secret one once), INSTANCE_ENCOUNTER_ENGAGE_UNIT (each boss unit's
--     UnitName and UnitGUID), and CRT_PHASE: a new phase in CRT's alerts engine (Alerts:CurrentPhase)
-- A value is never compared or tested before the secret check.
--
-- Saved in CRTDB.dev.clearProbe: on, and last = { encounterID, name, difficultyID, started (time()),
-- lines, counts[event] = { n, secret[field] = n }, dropped }, the last pull only.
--
-- Boss debug (Dev/BossDebug.lua) turns it on through Follow without its own switch: then each line also
-- goes to the boss's record, section "clear", and CRTDB.dev.clearProbe is left alone unless on too.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.ClearProbe = Probe

Probe.MAX_LINES = 3000
local BOSS_UNITS = { boss1 = true, boss2 = true, boss3 = true, boss4 = true, boss5 = true }
local RISE, DROP = 1.01, 0.9 -- a health update above 101% or below 90% of the last one is a jump

-- Listened to while on; the unit events only during a pull (they fire for every unit in the raid).
local ALWAYS = { "ENCOUNTER_START", "ENCOUNTER_END",
    "ENCOUNTER_TIMELINE_EVENT_ADDED", "ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", "ENCOUNTER_TIMELINE_EVENT_TRACK_CHANGED",
    "ENCOUNTER_TIMELINE_EVENT_REMOVED", "ENCOUNTER_TIMELINE_EVENT_HIGHLIGHT", "ENCOUNTER_TIMELINE_EVENT_BLOCK_STATE_CHANGED",
    "ENCOUNTER_TIMELINE_STATE_UPDATED", "ENCOUNTER_TIMELINE_LAYOUT_UPDATED",
    "ENCOUNTER_TIMELINE_VIEW_ACTIVATED", "ENCOUNTER_TIMELINE_VIEW_DEACTIVATED",
    "CHAT_MSG_RAID_BOSS_EMOTE", "CHAT_MSG_RAID_BOSS_WHISPER", "CHAT_MSG_MONSTER_YELL", "CHAT_MSG_MONSTER_SAY",
    "CHAT_MSG_MONSTER_EMOTE", "RAID_BOSS_EMOTE", "RAID_BOSS_WHISPER", "INSTANCE_ENCOUNTER_ENGAGE_UNIT" }
local DURING = { "UNIT_SPELLCAST_START", "UNIT_SPELLCAST_SUCCEEDED", "UNIT_SPELLCAST_CHANNEL_START",
    "UNIT_TARGETABLE_CHANGED", "UNIT_HEALTH" }
local ID_ONLY = { ENCOUNTER_TIMELINE_EVENT_REMOVED = true, ENCOUNTER_TIMELINE_EVENT_HIGHLIGHT = true,
    ENCOUNTER_TIMELINE_EVENT_BLOCK_STATE_CHANGED = true }
local CHAT = { CHAT_MSG_RAID_BOSS_EMOTE = true, CHAT_MSG_RAID_BOSS_WHISPER = true, CHAT_MSG_MONSTER_YELL = true,
    CHAT_MSG_MONSTER_SAY = true, CHAT_MSG_MONSTER_EMOTE = true }
local CASTS = { UNIT_SPELLCAST_START = true, UNIT_SPELLCAST_SUCCEEDED = true, UNIT_SPELLCAST_CHANNEL_START = true }
local INFO_FIELDS = { "id", "source", "spellID", "spellName", "duration", "isApproximate" }

local frame
local pulling = false
local startedAt = 0
local lastHealth, healthSecret = {}, {}
local lastPhase
local follow = false -- Boss debug is on: log every pull into its record too

local function store()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.clearProbe = CRT.db.dev.clearProbe or { on = false }
    return CRT.db.dev.clearProbe
end

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

-- A value as the log shows it.
local function show(v)
    if isSecret(v) then
        return "<secret>"
    elseif v == nil then
        return "nil"
    elseif type(v) == "string" then
        return '"' .. v:gsub("[\r\n]+", " ") .. '"'
    elseif type(v) == "number" or type(v) == "boolean" then
        return tostring(v)
    end
    return "<" .. type(v) .. ">"
end

-- One line: the seconds from the pull, the event and its fields ({ name, value } pairs, in order).
function Probe.Line(seconds, event, fields)
    local parts = { string.format("+%.1f", seconds), event }
    for _, f in ipairs(fields) do
        parts[#parts + 1] = f[1] .. "=" .. show(f[2])
    end
    return table.concat(parts, " ")
end

local function add(event, fields)
    local s = store()
    local last = s.on and s.last or nil
    if not last and not follow then
        return
    end
    local line = Probe.Line(GetTime() - startedAt, event, fields)
    if follow and CRT.BossDebug then
        local secrets = 0
        for _, f in ipairs(fields) do
            if isSecret(f[2]) then
                secrets = secrets + 1
            end
        end
        CRT.BossDebug:Append("clear", line, secrets)
    end
    if not last then
        return
    end
    local c = last.counts[event]
    if not c then
        c = { n = 0, secret = {} }
        last.counts[event] = c
    end
    c.n = c.n + 1
    for _, f in ipairs(fields) do
        if isSecret(f[2]) then
            c.secret[f[1]] = (c.secret[f[1]] or 0) + 1
        end
    end
    if #last.lines >= Probe.MAX_LINES then
        last.dropped = (last.dropped or 0) + 1
        return
    end
    last.lines[#last.lines + 1] = line
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

local function setUnitEvents(on)
    for _, e in ipairs(DURING) do
        if on then
            frame:RegisterEvent(e)
        else
            frame:UnregisterEvent(e)
        end
    end
end

local function startPull(encounterID, name, difficultyID, groupSize)
    pulling = true
    startedAt = GetTime()
    lastHealth, healthSecret = {}, {}
    lastPhase = CRT.Alerts and CRT.Alerts.CurrentPhase and ask(CRT.Alerts.CurrentPhase, CRT.Alerts) or nil
    if store().on then
        store().last = { encounterID = readable(encounterID) and encounterID or nil, name = readable(name) and name or nil,
            difficultyID = readable(difficultyID) and difficultyID or nil, started = time(), lines = {}, counts = {} }
    end
    if follow and CRT.BossDebug then
        CRT.BossDebug:Open(encounterID, name, difficultyID)
    end
    setUnitEvents(true)
    add("ENCOUNTER_START", { { "encounterID", encounterID }, { "name", name }, { "difficultyID", difficultyID }, { "groupSize", groupSize } })
end

local function endPull(encounterID, success)
    add("ENCOUNTER_END", { { "encounterID", encounterID }, { "success", success } })
    local last = store().on and store().last
    if last then
        last.length = GetTime() - startedAt
        last.success = readable(success) and success or nil
        if last.dropped then
            last.lines[#last.lines + 1] = "... " .. last.dropped .. " more lines dropped (the log keeps " .. Probe.MAX_LINES .. ")"
        end
    end
    pulling = false
    setUnitEvents(false)
end

local function onHealth(unit)
    local pct = ask(UnitHealthPercent, unit)
    if isSecret(pct) then
        if not healthSecret[unit] then
            healthSecret[unit] = true
            add("UNIT_HEALTH", { { "unit", unit }, { "percent", pct } })
        end
        return
    end
    if type(pct) ~= "number" then
        return
    end
    local last = lastHealth[unit]
    lastHealth[unit] = pct
    if not last then
        add("UNIT_HEALTH", { { "unit", unit }, { "percent", pct } })
    elseif pct > last * RISE then
        add("UNIT_HEALTH", { { "unit", unit }, { "percent", pct }, { "jump", "up" } })
    elseif pct < last * DROP then
        add("UNIT_HEALTH", { { "unit", unit }, { "percent", pct }, { "jump", "down" } })
    end
end

-- A boss unit: readable and boss1 to boss5. A secret unit counts too, since it might be one.
local function bossOrSecret(unit)
    return isSecret(unit) or (readable(unit) and BOSS_UNITS[unit])
end

local function onEngage()
    local fields = {}
    for i = 1, 5 do
        local unit = "boss" .. i
        local exists = ask(UnitExists, unit)
        if isSecret(exists) or exists == "error" then
            fields[#fields + 1] = { unit .. ".exists", exists }
        elseif exists then
            fields[#fields + 1] = { unit .. ".name", ask(UnitName, unit) }
            fields[#fields + 1] = { unit .. ".guid", ask(UnitGUID, unit) }
        end
    end
    add("INSTANCE_ENCOUNTER_ENGAGE_UNIT", fields)
end

local function onTimeline(event, a1)
    local api = C_EncounterTimeline or {}
    if event == "ENCOUNTER_TIMELINE_EVENT_ADDED" then
        if not readable(a1) or type(a1) ~= "table" then
            add(event, { { "info", a1 } })
            return
        end
        local fields = {}
        for _, k in ipairs(INFO_FIELDS) do
            local ok, v = pcall(function() return a1[k] end)
            if not ok then
                v = "error"
            end
            fields[#fields + 1] = { k, v } -- not "ok and v": v may be secret or false
        end
        add(event, fields)
    elseif event == "ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED" or event == "ENCOUNTER_TIMELINE_EVENT_TRACK_CHANGED" then
        -- Not "readable(a1) and ask(...) or nil": the answer may be secret, and a secret can't be tested.
        local state = event == "ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED"
        local fields = { { "eventID", a1 } }
        if readable(a1) then
            fields[2] = { state and "state" or "track", ask(state and api.GetEventState or api.GetEventTrack, a1) }
        end
        add(event, fields)
    elseif ID_ONLY[event] then
        add(event, { { "eventID", a1 } })
    elseif event == "ENCOUNTER_TIMELINE_VIEW_ACTIVATED" or event == "ENCOUNTER_TIMELINE_VIEW_DEACTIVATED" then
        add(event, { { "viewType", a1 } })
    else
        add(event, {})
    end
end

function Probe.HandleEvent(event, ...)
    if not CRT.db or not (store().on or follow) then
        return
    end
    local a1, a2, a3, a4, a5 = ...
    if event == "ENCOUNTER_START" then
        startPull(a1, a2, a3, a4)
        return
    end
    if not pulling then
        return
    end
    if event == "ENCOUNTER_END" then
        endPull(a1, a5)
    elseif event:sub(1, 19) == "ENCOUNTER_TIMELINE_" then
        onTimeline(event, a1)
    elseif CHAT[event] then
        add(event, { { "text", a1 }, { "sender", a2 } })
    elseif event == "RAID_BOSS_EMOTE" or event == "RAID_BOSS_WHISPER" then
        add(event, { { "text", a1 }, { "sender", a2 }, { "displayTime", a3 } })
    elseif CASTS[event] then
        if bossOrSecret(a1) then
            local fields = { { "unit", a1 }, { "spellID", a3 } }
            if readable(a3) and type(a3) == "number" and C_Spell and C_Spell.GetSpellName then
                fields[3] = { "spell", ask(C_Spell.GetSpellName, a3) }
            end
            add(event, fields)
        end
    elseif event == "UNIT_TARGETABLE_CHANGED" then
        if bossOrSecret(a1) then
            local fields = { { "unit", a1 } }
            if readable(a1) then
                fields[2] = { "exists", ask(UnitExists, a1) }
                fields[3] = { "canAttack", ask(UnitCanAttack, "player", a1) }
            end
            add(event, fields)
        end
    elseif event == "UNIT_HEALTH" then
        if readable(a1) and BOSS_UNITS[a1] then
            onHealth(a1)
        end
    elseif event == "INSTANCE_ENCOUNTER_ENGAGE_UNIT" then
        onEngage()
    end
end

-- CRT's own phase change, during a pull.
local function onAlertsChange()
    if not pulling or not CRT.db or not (store().on or follow) then
        return
    end
    local ph = ask(CRT.Alerts.CurrentPhase, CRT.Alerts)
    if ph ~= lastPhase then
        lastPhase = ph
        add("CRT_PHASE", { { "phase", ph } })
    end
end
if CRT.Alerts and CRT.Alerts.OnChange then
    CRT.Alerts:OnChange(onAlertsChange)
end

local function listen(on)
    if not frame then
        frame = CreateFrame("Frame")
        frame:SetScript("OnEvent", function(_, event, ...)
            Probe.HandleEvent(event, ...)
        end)
    end
    frame:UnregisterAllEvents()
    pulling = false
    if on then
        for _, e in ipairs(ALWAYS) do
            frame:RegisterEvent(e)
        end
    end
end

function Probe:SetOn(on)
    store().on = on and true or false
    listen(on or follow)
    CRT:Print(on and "Clear probe on: it logs the next boss pull. /crt dev clearprobe show after it." or "Clear probe off. The last log is kept.")
end

-- Boss debug on or off: listens while it or the probe's own switch is on. Prints nothing.
function Probe:Follow(on)
    follow = on and true or false
    listen(store().on or follow)
end

-- The whole log: a header, then one line per event.
function Probe:Text()
    local last = store().last
    if not last then
        return nil
    end
    local when = date and last.started and date("%Y-%m-%d %H:%M", last.started) or "?"
    local result = last.success == 1 and "kill" or last.success == 0 and "wipe" or "not ended"
    local head = string.format('Clear probe: encounter %s "%s", difficulty %s, pulled %s, %s, %s',
        tostring(last.encounterID or "?"), tostring(last.name or "?"), tostring(last.difficultyID or "?"), when,
        last.length and string.format("%.1f s", last.length) or "still going", result)
    return head .. "\n<secret> is a value the game hid; nil is a missing one.\n" .. table.concat(last.lines, "\n")
end

-- One line per event: how many came, and which fields were secret how often.
function Probe:Summary()
    local last = store().last
    local out = {}
    if not last then
        return out
    end
    local events = {}
    for e in pairs(last.counts) do
        events[#events + 1] = e
    end
    table.sort(events)
    for _, e in ipairs(events) do
        local c = last.counts[e]
        local names = {}
        for f in pairs(c.secret) do
            names[#names + 1] = f
        end
        table.sort(names)
        local parts = {}
        for _, f in ipairs(names) do
            parts[#parts + 1] = f .. " " .. c.secret[f]
        end
        out[#out + 1] = e .. ": " .. c.n .. (#parts > 0 and (" (secret: " .. table.concat(parts, ", ") .. ")") or " (all readable)")
    end
    return out
end

function Probe:Show()
    local text = self:Text()
    if not text then
        CRT:Print("The clear probe has no log yet. Run /crt dev clearprobe on, then pull a boss.")
        return
    end
    CRT:Print("Clear probe, last pull:")
    for _, line in ipairs(self:Summary()) do
        CRT:Print("  " .. line)
    end
    CRT.ConsumablesTools:ShowText("Clear probe log (Ctrl+C to copy, paste to Claude)", text)
end

-- Handles "dev clearprobe [on|off|show]". Returns false for any other command.
function Probe:Command(msg)
    local rest = msg:match("^dev%s+clearprobe%s*$") and "" or msg:match("^dev%s+clearprobe%s+(.-)%s*$")
    if not rest then
        return false
    end
    if rest == "on" or rest == "off" then
        self:SetOn(rest == "on")
    elseif rest == "show" then
        self:Show()
    else
        local last = store().last
        CRT:Print("Clear probe is " .. (store().on and "on" or "off") .. (last and (", with a log of " .. #last.lines .. " lines") or ", no log yet")
            .. ". /crt dev clearprobe on, off or show.")
    end
    return true
end

-- On stays on through a /reload.
local login = CreateFrame("Frame")
login:RegisterEvent("PLAYER_LOGIN")
login:SetScript("OnEvent", function()
    if CRT.db and CRT.db.dev and CRT.db.dev.clearProbe and CRT.db.dev.clearProbe.on then
        listen(true)
    end
end)
