// Runs Dev/TimelineProbe.lua with mock game calls: one raid boss pull with a secret spell ID.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local src = ...
local SECRET = {}
local printed = {}
local say = print
print = function(s) printed[#printed + 1] = s end
function issecretvalue(v) return v == SECRET end
function GetInstanceInfo() return "Nerub-ar Palace", "raid" end
time = function() return 1000 end
C_EncounterTimeline = {
    GetEventInfo = function() return nil end,
    GetEventState = function() return 1 end,
    IsFeatureEnabled = function() return true end,
}
C_DamageMeter = { GetCombatSessionFromType = function() return nil end }
C_DeathRecap = { GetRecapEvents = function() return {} end }
C_Map = { GetBestMapForUnit = function() return 2657 end }
local ejCalls = {}
EJ_GetInstanceForMap = function(m) assert(m == 2657, "map id passed"); return 1273 end
EJ_GetEncounterInfoByIndex = function(i, inst)
    assert(inst == 1273, "instance passed")
    if i > 2 then return nil end
    return "Boss" .. i, "d", 900 + i, 1, "link", inst, 3000 + i, 1
end
EJ_GetEncounterInfo = function(id) ejCalls[#ejCalls + 1] = id; return "Boss", "d", id, 1, "link", 1273, 3000 + (id - 900), 1 end
EJ_SelectInstance = function() error("EJ_SelectInstance must not be called") end
CRTDB = nil
local CRT = {}
function CRT:Print(m) printed[#printed + 1] = m end
assert(load(src, "TimelineProbe.lua"))("CowfeeRaidTools", CRT)
local Probe = CRT.TimelineProbe
assert(Probe, "probe table exists")

-- not armed: nothing recorded
CRTDB = {}
CRT.db = CRTDB
Probe.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16, 20)
Probe.HandleEvent("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 5, spellID = SECRET, duration = 30 })
local f = CRTDB.dev and CRTDB.dev.probe and CRTDB.dev.probe.fields or {}
assert(next(f) == nil, "probe not armed records nothing")
say("ok probe not armed records nothing")

-- armed pull
Probe:Arm()
assert(CRTDB.dev.probe.fields, "arm creates CRTDB.dev.probe")
Probe.HandleEvent("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 4, spellID = 7, duration = 12 })
assert(CRTDB.dev.probe.fields["added.prepull.spellID@event"] == "readable", "prepull event recorded")
assert(CRTDB.dev.probe.fields["added.spellID@event"] == nil, "prepull event not counted as an in-pull added event")
say("ok added.prepull recorded")
Probe.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16, 20)
Probe.HandleEvent("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 5, spellID = SECRET, duration = 30 })
Probe.HandleEvent("UNIT_SPELLCAST_START", "boss1", "GUID", SECRET)
Probe.HandleEvent("UNIT_SPELLCAST_SUCCEEDED", "player", "GUID", 99)
Probe.HandleEvent("ENCOUNTER_END", 3001, "Boss", 16, 20, 1)
Probe.HandleEvent("PLAYER_REGEN_ENABLED")
local p = CRTDB.dev.probe
assert(p.encounterID == 3001, "encounter id stored")
assert(p.fields["added.spellID@event"] == "secret", "added.spellID secret at event")
assert(p.fields["added.duration@event"] == "readable", "added.duration readable at event")
assert(p.fields["getinfo.spellID@end"] == "missing", "getinfo.spellID missing at end")
assert(p.fields["bosscast.spellID@event"] == "secret", "boss cast spell id recorded as secret")
assert(p.fields["feature.enabled@event"] == "readable", "feature check recorded")
assert(p.fields["ej.match@event"] == "readable" and p.counts["ej.match@event"].missing == 0, "ej match found (3001 = index 1)")
assert(p.fields["ej.dungeonEncounterID@event"] == "readable", "ej fields from the match")
assert(ejCalls[1] == 901, "EJ_GetEncounterInfo got the journal encounter id, not the dungeon one")
say("ok moments and classes")
say("ok journal match")

-- disarmed after ooc: later events add nothing
local before = 0
for _ in pairs(p.fields) do before = before + 1 end
Probe.HandleEvent("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 6, spellID = 1, duration = 3, source = 0 })
local after = 0
for _ in pairs(p.fields) do after = after + 1 end
assert(before == after, "disarmed after the out of combat step")
say("ok disarms")

printed = {}
Probe:Show()
local hit = false
for _, line in ipairs(printed) do if tostring(line):find("added.spellID", 1, true) then hit = true end end
assert(hit, "Show prints a line with added.spellID")
say("ok show prints")

-- a non-raid pull does not start
CRTDB = {} CRT.db = CRTDB
GetInstanceInfo = function() return "Dungeon", "party" end
Probe:Arm()
Probe.HandleEvent("ENCOUNTER_START", 1, "X", 8, 5)
Probe.HandleEvent("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 1, spellID = 1 })
assert(next(CRTDB.dev.probe.fields) == nil, "non raid pull records nothing")
say("ok non raid ignored")
-- boss3 is recorded, target is ignored
CRTDB = {} CRT.db = CRTDB
GetInstanceInfo = function() return "Nerub-ar Palace", "raid" end
Probe:Arm()
Probe.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16, 20)
Probe.HandleEvent("UNIT_SPELLCAST_SUCCEEDED", "target", "G", 7)
assert(CRTDB.dev.probe.fields["bosscast.spellID@event"] == nil, "target cast ignored")
Probe.HandleEvent("UNIT_SPELLCAST_SUCCEEDED", "boss3", "G", 7)
assert(CRTDB.dev.probe.fields["bosscast.spellID@event"] == "readable", "boss3 cast recorded")
say("ok boss3 recorded, target ignored")

-- a failing call records only error, and a missing namespace does not throw
C_EncounterTimeline = nil
C_DamageMeter = nil
Probe.HandleEvent("ENCOUNTER_END", 3001, "Boss", 16, 20, 1)
assert(CRTDB.dev.probe.counts["feature.enabled@end"].error == 1, "feature error counted")
assert(CRTDB.dev.probe.counts["feature.enabled@end"].missing == 0, "feature error not also missing")
say("ok failed call records error only")

-- recap sampling reads the newest event first
CRTDB = {} CRT.db = CRTDB
local sampled
C_DamageMeter = { GetCombatSessionFromType = function() return { combatSources = { { deathRecapID = 7, isLocalPlayer = false, sourceGUID = "G" } } } end,
    GetCombatSessionSourceFromType = function() return nil end }
C_DeathRecap = { GetRecapEvents = function() return { { spellId = 1 }, { spellId = SECRET } } end }
Probe:Arm()
Probe.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16, 20)
Probe.HandleEvent("ENCOUNTER_END", 3001, "Boss", 16, 20, 1)
assert(CRTDB.dev.probe.fields["recap.other.spellId@end"] == "readable", "recap samples events[1]")
say("ok recap samples the first event")
-- no match in the Journal
CRTDB = {} CRT.db = CRTDB
Probe:Arm()
Probe.HandleEvent("ENCOUNTER_START", 9999, "Boss", 16, 20)
assert(CRTDB.dev.probe.fields["ej.match@event"] == "missing", "ej match missing")
say("ok journal no match")
CRTDB = {} CRT.db = CRTDB

-- phase event sources and the ENCOUNTER_TIMELINE_ catch-all
local calls = {}
function CreateFrame()
    local f = {}
    function f:SetScript() end
    function f:RegisterEvent(e) calls[#calls + 1] = "reg " .. e end
    function f:UnregisterAllEvents() calls[#calls + 1] = "unreg" end
    function f:RegisterAllEvents() calls[#calls + 1] = "regall" end
    return f
end
function UnitCanAttack(a, u) return u == "boss1" end
function UnitExists(u) return u == "boss1" end
function UnitGUID(u) return u == "boss1" and SECRET or nil end
CRTDB = {} CRT.db = CRTDB
Probe:Arm()
local seenAll = false
for _, c in ipairs(calls) do if c == "regall" then seenAll = true end end
assert(seenAll, "armed registers all events")
Probe.HandleEvent("RAID_BOSS_EMOTE", SECRET, "Boss")
Probe.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16, 20)
Probe.HandleEvent("RAID_BOSS_EMOTE", SECRET, "Boss")
Probe.HandleEvent("CHAT_MSG_RAID_BOSS_EMOTE", "text", SECRET)
Probe.HandleEvent("UNIT_TARGETABLE_CHANGED", "boss1")
Probe.HandleEvent("INSTANCE_ENCOUNTER_ENGAGE_UNIT")
Probe.HandleEvent("ENCOUNTER_TIMELINE_NEW_THING", 5, SECRET)
Probe.HandleEvent("ENCOUNTER_TIMELINE_EVENT_REMOVED", 5)
Probe.HandleEvent("SOME_OTHER_EVENT", 5)
local q = CRTDB.dev.probe.fields
assert(q["emote.text@event"] == "secret" and q["emote.sender@event"] == "readable", "secret emote text recorded as secret")
assert(q["chatemote.text@event"] == "readable" and q["chatemote.sender@event"] == "secret")
assert(q["targetable.unit@event"] == "readable" and q["targetable.canAttack@event"] == "readable", "targetable unit and UnitCanAttack")
assert(q["engage.boss1.exists@event"] == "readable" and q["engage.boss1.guid@event"] == "secret" and q["engage.boss2.guid@event"] == "missing", "engage units")
assert(q["other.ENCOUNTER_TIMELINE_NEW_THING.arg1@event"] == "readable" and q["other.ENCOUNTER_TIMELINE_NEW_THING.arg2@event"] == "secret", "catch-all records new event name and arg classes")
assert(q["other.ENCOUNTER_TIMELINE_EVENT_REMOVED.arg1@event"] == "readable")
for k in pairs(q) do assert(not k:find("SOME_OTHER_EVENT"), "only ENCOUNTER_TIMELINE_ names") end
assert(CRTDB.dev.probe.counts["emote.text@event"].secret == 2, "emote while armed in a raid and during the pull both recorded")
say("ok phase event sources recorded")
calls = {}
Probe.HandleEvent("ENCOUNTER_END", 3001, "Boss", 16, 20, 1)
assert(calls[1] == "unreg" and calls[2] == "reg ENCOUNTER_START", "catch-all off at ENCOUNTER_END")
calls = {}
Probe.HandleEvent("PLAYER_REGEN_ENABLED")
assert(calls[1] == "unreg" and calls[2] == "reg ENCOUNTER_START", "disarm unregisters then re-registers the normal list")
local before2 = CRTDB.dev.probe.counts["emote.text@event"].secret
Probe.HandleEvent("RAID_BOSS_EMOTE", SECRET, "Boss")
Probe.HandleEvent("ENCOUNTER_TIMELINE_NEW_THING", 5)
assert(CRTDB.dev.probe.counts["emote.text@event"].secret == before2, "nothing recorded once off")
say("ok catch-all off after disarm")
`;
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2], 'utf8')));
const ok = lauxlib.luaL_loadstring(L, to_luastring(harness));
if (ok !== 0) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_insert(L, -2);
const rc = lua.lua_pcall(L, 1, 0, 0);
if (rc !== 0) { console.error('FAIL', lua.lua_tojsstring(L, -1)); process.exit(1); }
