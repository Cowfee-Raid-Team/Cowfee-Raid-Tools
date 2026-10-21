local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev gametimeline [seconds] [spellID] adds one script event to the game's boss timeline
-- (C_EncounterTimeline.AddScriptEvent, built by Alerts/GameTimeline.lua's Request like a real alert) and prints what
-- came back: the event ID, its info and state read back (each value readable or secret), whether the game's
-- timeline is on, its view type, our override, and whether an encounter is going. It answers whether a script event
-- shows outside an encounter, and whether a spell ID of 0 is taken. /crt dev gametimeline cancel takes the last one
-- back. This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.GameTimelineProbe = Probe

local DEFAULT_SECONDS = 20
local NAME = "CRT probe"
local FIELDS = { "id", "source", "spellName", "spellID", "iconFileID", "duration", "maxQueueDuration", "icons", "severity", "isApproximate" }

local function show(v)
    if issecretvalue and issecretvalue(v) then
        return "secret"
    end
    return tostring(v)
end

local function ask(fn, ...)
    if type(fn) ~= "function" then
        return "missing"
    end
    local ok, v = pcall(fn, ...)
    if not ok then
        return "error: " .. tostring(v)
    end
    return show(v)
end

local function status(C)
    local inEncounter = C_InstanceEncounter and C_InstanceEncounter.IsEncounterInProgress
    local frame = EncounterTimeline
    print(("  feature available %s, enabled %s, view type %s, override %s, encounter %s, visible events %s"):format(
        ask(C.IsFeatureAvailable), ask(C.IsFeatureEnabled), ask(C.GetViewType),
        frame and frame.GetAttribute and ask(frame.GetAttribute, frame, "overrideViewType") or "no frame",
        ask(inEncounter), ask(C.HasVisibleEvents)))
end

local function add(C, seconds, spellID)
    local Game = CRT.AlertGameTimeline
    local line = { id = "probe", at = 0, text = NAME, spellID = spellID, priority = 32, abilityTags = { "tank", "magic" } }
    local req = Game and Game.Request(line, seconds) or { spellID = spellID or 0, iconFileID = 134400, duration = seconds, overrideName = NAME }
    print(("  request: spell %s, icon %s, %s s, name %s, icons %s, severity %s"):format(show(req.spellID), show(req.iconFileID),
        show(req.duration), show(req.overrideName), show(req.icons), show(req.severity)))
    local ok, id = pcall(C.AddScriptEvent, req)
    if not ok then
        CRT:Print("AddScriptEvent failed: " .. tostring(id))
        return
    end
    CRT:Print("Added event " .. show(id) .. ".")
    if issecretvalue and issecretvalue(id) then
        return
    end
    Probe.last = id
    local okInfo, info = pcall(C.GetEventInfo, id)
    if okInfo and type(info) == "table" then
        local parts = {}
        for _, k in ipairs(FIELDS) do
            parts[#parts + 1] = k .. " " .. show(info[k])
        end
        print("  info: " .. table.concat(parts, ", "))
    else
        print("  info: " .. (okInfo and "nil" or ("error: " .. tostring(info))))
    end
    print("  state " .. ask(C.GetEventState, id) .. ", time left " .. ask(C.GetEventTimeRemaining, id))
end

-- Handles "dev gametimeline ...". Returns false for any other command.
function Probe:Command(msg)
    if not msg:match("^dev%s+gametimeline") then
        return false
    end
    local C = C_EncounterTimeline
    if type(C) ~= "table" or type(C.AddScriptEvent) ~= "function" then
        CRT:Print("This client has no C_EncounterTimeline.AddScriptEvent.")
        return true
    end
    local rest = msg:match("^dev%s+gametimeline%s*(.-)%s*$") or ""
    if rest == "cancel" then
        if self.last then
            local ok, err = pcall(C.CancelScriptEvent, self.last)
            CRT:Print(ok and ("Canceled event " .. tostring(self.last) .. ".") or ("CancelScriptEvent failed: " .. tostring(err)))
            self.last = nil
        else
            CRT:Print("No probe event to cancel.")
        end
        status(C)
        return true
    end
    local seconds, spellID = rest:match("^(%d+%.?%d*)%s*(%d*)$")
    seconds = tonumber(seconds) or DEFAULT_SECONDS
    spellID = tonumber(spellID)
    CRT:Print("Game timeline probe:")
    status(C)
    add(C, seconds, spellID)
    status(C)
    return true
end
