local ADDON, CRT = ...

-- A marker display's own clear moments (Markers/Display.lua): besides the gap, the full display and a
-- new phase, a display can list boss moments in clearOn, and the first that happens clears it. Each
-- entry is one of:
--   { event = "timeline", spellID = N }  a boss timeline event for that spell: when it finishes (its
--                                        state turns Finished), or with when = "start" when it is added
--   { event = "cast", spellID = N }      a cast by boss1 to boss5: when it succeeds, or with
--                                        when = "start" when the cast or channel starts
--   { event = "emote", contains = "text" }  a boss emote, yell or say holding that text (any case)
--   { event = "targetable" }             boss1 to boss5 becomes targetable or untargetable
--
-- The game can hide these values during a boss fight (secret values). Blizzard's documentation (12.1.5,
-- checked 2026-10-21) says: a timeline event's spellID is secret during an encounter (only id, source,
-- duration and maxQueueDuration never are); a boss's cast payload is secret when unit casts are
-- restricted (SecretWhenUnitSpellCastRestricted); CHAT_MSG_RAID_BOSS_EMOTE and the CHAT_MSG_MONSTER_
-- events are secret in chat lockdown (inside raids and dungeons); RAID_BOSS_EMOTE and
-- UNIT_TARGETABLE_CHANGED carry no secret flag. A hidden value matches nothing, so its entry just never
-- fires; nothing is compared before the secret check. /crt dev clearprobe shows which of them a real
-- boss sends readably.
--
-- The events are listened to only while a display with entries of that kind is armed for a pull.

local ClearOn = {}
CRT.MarkerClearOn = ClearOn

local BOSS_UNITS = { boss1 = true, boss2 = true, boss3 = true, boss4 = true, boss5 = true }
local FINISHED = 2 -- Enum.EncounterTimelineEventState.Finished (EncounterTimelineConstantsDocumentation.lua)
local ENCOUNTER_SOURCE = 0 -- Enum.EncounterTimelineEventSource.Encounter, the same file

-- The kinds, in the dev editor's order, and the events each listens to.
ClearOn.KINDS = { "timeline", "cast", "emote", "targetable" }
local EVENTS = {
    timeline = { "ENCOUNTER_TIMELINE_EVENT_ADDED", "ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", "ENCOUNTER_TIMELINE_EVENT_REMOVED" },
    cast = { "UNIT_SPELLCAST_START", "UNIT_SPELLCAST_CHANNEL_START", "UNIT_SPELLCAST_SUCCEEDED" },
    emote = { "RAID_BOSS_EMOTE", "CHAT_MSG_RAID_BOSS_EMOTE", "CHAT_MSG_MONSTER_YELL", "CHAT_MSG_MONSTER_EMOTE", "CHAT_MSG_MONSTER_SAY" },
    targetable = { "UNIT_TARGETABLE_CHANGED" },
}
local CAST_WHEN = { UNIT_SPELLCAST_START = "start", UNIT_SPELLCAST_CHANNEL_START = "start", UNIT_SPELLCAST_SUCCEEDED = "end" }

local entries = {} -- the armed display's entries, checked; empty when none
local spellOf = {} -- timeline event ID -> its spell ID, when readable
local frame

-- The secret test comes first: comparing a secret value, even with nil, is not allowed.
local function readable(v)
    if issecretvalue and issecretvalue(v) then
        return false
    end
    return v ~= nil
end

-- A checked copy of one entry, or nil when it can't work: a spell ID must be a whole number above 0,
-- an emote's text must not be empty.
function ClearOn.Valid(e)
    if type(e) ~= "table" or not EVENTS[e.event] then
        return nil
    end
    local out = { event = e.event }
    if e.event == "timeline" or e.event == "cast" then
        local id = tonumber(e.spellID)
        if not id or id <= 0 or id ~= math.floor(id) then
            return nil
        end
        out.spellID = id
        out.when = e.when == "start" and "start" or nil
    elseif e.event == "emote" then
        if type(e.contains) ~= "string" or not e.contains:find("%S") then
            return nil
        end
        out.contains = e.contains
    end
    return out
end

-- One entry as a short line, for the dev editor.
function ClearOn.Describe(e)
    local start = e.when == "start"
    if e.event == "timeline" then
        return "Timeline spell " .. e.spellID .. (start and " (when added)" or " (when it finishes)")
    elseif e.event == "cast" then
        return "Boss cast " .. e.spellID .. (start and " (when it starts)" or " (when it succeeds)")
    elseif e.event == "emote" then
        return "Boss emote or yell holding \"" .. e.contains .. "\""
    end
    return "A boss becomes targetable or untargetable"
end

local function clear()
    if CRT.MarkerDisplay then
        CRT.MarkerDisplay:Clear()
    end
end

-- Whether an entry of this kind matches: spellID and when for the spell kinds, text for emotes.
local function matches(kind, spellID, when, text)
    for _, e in ipairs(entries) do
        if e.event == kind then
            if kind == "emote" then
                if text:lower():find(e.contains:lower(), 1, true) then
                    return true
                end
            elseif kind == "targetable" or (e.spellID == spellID and (e.when or "end") == when) then
                return true
            end
        end
    end
    return false
end

local function onTimeline(event, a1)
    if event == "ENCOUNTER_TIMELINE_EVENT_ADDED" then
        local info = a1
        if not readable(info) or type(info) ~= "table" then
            return
        end
        local id, spellID, source = info.id, info.spellID, info.source
        -- Only the boss's own events: CRT's alerts can be on the game's timeline too (Alerts/GameTimeline.lua).
        local encounter = Enum and Enum.EncounterTimelineEventSource and Enum.EncounterTimelineEventSource.Encounter or ENCOUNTER_SOURCE
        if not readable(source) or source ~= encounter then
            return
        end
        if not readable(id) or not readable(spellID) or type(spellID) ~= "number" then
            return
        end
        spellOf[id] = spellID
        if matches("timeline", spellID, "start") then
            clear()
        end
        return
    end
    local id = a1
    if not readable(id) then
        return
    end
    local spellID = spellOf[id]
    if event == "ENCOUNTER_TIMELINE_EVENT_REMOVED" then
        spellOf[id] = nil
    elseif spellID then
        local api = C_EncounterTimeline and C_EncounterTimeline.GetEventState
        local ok, state = false, nil
        if api then
            ok, state = pcall(api, id)
        end
        local finished = Enum and Enum.EncounterTimelineEventState and Enum.EncounterTimelineEventState.Finished or FINISHED
        if ok and readable(state) and state == finished and matches("timeline", spellID, "end") then
            clear()
        end
    end
end

local function onEvent(_, event, a1, a2, a3)
    if #entries == 0 then
        return
    end
    if CAST_WHEN[event] then
        if readable(a1) and BOSS_UNITS[a1] and readable(a3) and type(a3) == "number" and matches("cast", a3, CAST_WHEN[event]) then
            clear()
        end
    elseif event == "UNIT_TARGETABLE_CHANGED" then
        if readable(a1) and BOSS_UNITS[a1] and matches("targetable") then
            clear()
        end
    elseif event:sub(1, 19) == "ENCOUNTER_TIMELINE_" then
        onTimeline(event, a1)
    elseif readable(a1) and type(a1) == "string" and matches("emote", nil, nil, a1) then
        clear()
    end
end

-- Listens for the armed display's entries; def nil (or one without entries) stops listening.
function ClearOn:Arm(def)
    entries, spellOf = {}, {}
    for _, e in ipairs(type(def) == "table" and type(def.clearOn) == "table" and def.clearOn or {}) do
        entries[#entries + 1] = ClearOn.Valid(e)
    end
    if not frame then
        if #entries == 0 then
            return
        end
        frame = CreateFrame("Frame")
        frame:SetScript("OnEvent", onEvent)
    end
    frame:UnregisterAllEvents()
    local kinds = {}
    for _, e in ipairs(entries) do
        kinds[e.event] = true
    end
    for kind in pairs(kinds) do
        -- Not RegisterUnitEvent: it takes at most two units; the handler keeps boss1 to boss5.
        for _, ev in ipairs(EVENTS[kind]) do
            frame:RegisterEvent(ev)
        end
    end
end

-- The armed entries, for tests.
function ClearOn:Entries()
    return entries
end
