// CRT_Modules/Timeline/Data.lua recording: casts at Finished time, filters, deaths read with retries.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local src = ...
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
local queue = {}
C_Timer = { After = function(_, fn) queue[#queue + 1] = fn end }
local function runTimers()
  local n = 0
  while #queue > 0 do
    local fn = table.remove(queue, 1)
    fn()
    n = n + 1
    assert(n < 100, "timers loop forever")
  end
  return n
end
local clock, wall = 100, 1700000000
function GetTime() return clock end
function time() return wall end
local inCombat, instType = false, "raid"
function InCombatLockdown() return inCombat end
function GetInstanceInfo() return "Raid", instType end
function IsInRaid() return true end
function GetNumGroupMembers() return 2 end
function UnitName(u) return ({ raid1 = "Tanky", raid2 = "Mage" })[u] end
function UnitFullName(u) return UnitName(u) end
function UnitGUID(u) return ({ raid1 = "G1", raid2 = "G2" })[u] end
function UnitGroupRolesAssigned(u) return ({ raid1 = "TANK", raid2 = "DAMAGER" })[u] or "NONE" end
local secrets = {}
function issecretvalue(v) return secrets[v] == true end
local SECRET = {}
secrets[SECRET] = true
local states = {}
C_EncounterTimeline = { GetEventState = function(id) return states[id] end }
local sources, sourceDetail, recap = {}, {}, {}
C_DamageMeter = {
  GetCombatSessionFromType = function(s, t) assert(s == 1 and t == 9, "meter: current deaths"); return { combatSources = sources } end,
  GetCombatSessionSourceFromType = function(s, t, guid) return sourceDetail[guid] end,
}
C_DeathRecap = { GetRecapEvents = function(id) return recap[id] end }
local function defaults()
  return { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3,
    overlayOn = false, hideEmpty = false, nextId = 1 }
end
local CRT = { db = { timeline = defaults() } }
assert(load(src, "CRT_Modules/Timeline/Data.lua"))("CowfeeRaidTools", CRT)
local T = CRT.Timeline
assert(type(T.HandleEvent) == "function", "HandleEvent exists")
local H = T.HandleEvent
local function reset(record)
  CRT.db = { timeline = defaults() }
  CRT.db.timeline.record = record ~= false
  queue = {}; sources = {}; sourceDetail = {}; recap = {}; states = {}
  inCombat = false; instType = "raid"; clock = 100
end
local function total() local n = 0 for _, b in ipairs(T:Bosses()) do n = n + b.count end return n end

-- records casts at Finished time
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
assert(T:Recording() ~= nil, "recording started")
clock = 101; H("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 1, source = 0, duration = 10, spellID = 5001 })
clock = 105; H("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 2, source = 0, duration = 15, spellID = SECRET })
clock = 111; states[1] = 2; H("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 1)
clock = 120; states[2] = 2; H("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 2)
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
runTimers()
local p = T:Pulls(3001)[1]
assert(p and p.length == 60 and p.kill == false and p.name == "Boss" and p.difficultyID == 16 and p.startedAt == 1700000000, "casts: pull fields")
assert(#p.casts == 2 and p.casts[1].t == 11 and p.casts[1].dur == 10 and p.casts[1].spellID == 5001
  and p.casts[2].t == 20 and p.casts[2].spellID == 0 and p.casts[2].dur == 15, "records casts at Finished time")
assert(T:Recording() == nil, "recording cleared")
print("ok records casts at Finished time")

-- canceled events are dropped
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
H("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 1, source = 0, duration = 10, spellID = 5001 })
states[1] = 3; H("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 1)
H("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 2, source = 0, duration = 10, spellID = 5002 })
H("ENCOUNTER_TIMELINE_EVENT_REMOVED", 2)
states[2] = 2; H("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 2)
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 1)
runTimers()
assert(#T:Pulls(3001)[1].casts == 0 and T:Pulls(3001)[1].kill == true, "canceled events are dropped")
print("ok canceled events are dropped")

-- script events are ignored
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
H("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 1, source = 1, duration = 10, spellID = 5001 })
states[1] = 2; H("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 1)
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
runTimers()
assert(#T:Pulls(3001)[1].casts == 0, "script events are ignored")
print("ok script events are ignored")

-- short pull is dropped
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
clock = 110; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
runTimers()
assert(total() == 0 and T:Recording() == nil, "short pull is dropped")
print("ok short pull is dropped")

-- not in a raid is ignored
reset(); instType = "party"
H("ENCOUNTER_START", 3001, "Boss", 16, 5)
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 5, 0)
runTimers()
assert(total() == 0 and T:Recording() == nil, "not in a raid is ignored")
print("ok not in a raid is ignored")

-- record off is ignored
reset(false)
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
runTimers()
assert(total() == 0, "record off is ignored")
print("ok record off is ignored")

-- end without start is ignored
reset()
H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
H("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 9)
runTimers()
assert(total() == 0, "end without start is ignored")
print("ok end without start is ignored")

-- deaths wait for combat to end
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
inCombat = true
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
assert(runTimers() == 0 and total() == 0, "deaths wait for regen")
inCombat = false; H("PLAYER_REGEN_ENABLED")
runTimers()
assert(total() == 1, "deaths wait for combat to end")
print("ok deaths wait for combat to end")

-- deaths read with killing blow
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
sources = {
  { name = "Mage", classFilename = "MAGE", deathRecapID = 7, deathTimeSeconds = 42, sourceGUID = "G2" },
  { name = "Pet", classFilename = "HUNTER", deathRecapID = 0, deathTimeSeconds = 5, sourceGUID = "G9" },
}
recap[7] = { { spellId = SECRET }, { spellId = 222 }, { spellId = 111 }, { spellId = SECRET } } -- newest first: the first readable is the killing blow
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
runTimers()
local d = T:Pulls(3001)[1].deaths
assert(#d == 1 and d[1].t == 42 and d[1].class == "MAGE" and d[1].name == "Mage" and d[1].recapID == 7
  and d[1].role == "DAMAGER" and d[1].spellID == 222, "deaths read with killing blow")
print("ok deaths read with killing blow")

-- killing blow falls back to the deadly spell, then 0
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
sources = {
  { name = "Mage", classFilename = "MAGE", deathRecapID = 7, deathTimeSeconds = 42, sourceGUID = "G2" },
  { name = "Nobody", classFilename = "ROGUE", deathRecapID = 8, deathTimeSeconds = 50, sourceGUID = "G8" },
}
recap[7] = nil
sourceDetail["G2"] = { combatSpells = { { spellID = 1, isDeadly = false }, { spellID = 333, isDeadly = true } } }
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
runTimers()
d = T:Pulls(3001)[1].deaths
assert(#d == 2 and d[1].spellID == 333 and d[2].spellID == 0 and d[2].role == "NONE", "killing blow fallback")
print("ok killing blow fallback")

-- deaths: secret after retries saves pull
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
sources = { { name = "Mage", classFilename = "MAGE", deathRecapID = 7, deathTimeSeconds = SECRET, sourceGUID = "G2" } }
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
local ran = runTimers()
d = T:Pulls(3001)[1].deaths
assert(ran == 6 and #d == 1 and d[1].t == nil and d[1].name == "Mage", "deaths: secret after retries saves pull (ran " .. ran .. ")")
print("ok deaths: secret after retries saves pull")

-- new pull saves pending pull
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
sources = { { name = "Mage", classFilename = "MAGE", deathRecapID = 7, deathTimeSeconds = 42, sourceGUID = "G2" } }
inCombat = true
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
clock = 170; H("ENCOUNTER_START", 3002, "Second", 16, 20)
assert(#T:Pulls(3001) == 1 and #T:Pulls(3001)[1].deaths == 0, "new pull saves pending pull: A saved once with no deaths")
assert(T:Recording() ~= nil and T:Recording().encounterID == 3002, "new pull saves pending pull: B recording")
inCombat = false; H("PLAYER_REGEN_ENABLED")
runTimers()
assert(#T:Pulls(3001) == 1 and total() == 1, "new pull saves pending pull: callbacks do not save A again")
clock = 240; H("ENCOUNTER_END", 3002, "Second", 16, 20, 1)
runTimers()
assert(#T:Pulls(3002) == 1 and #T:Pulls(3002)[1].deaths == 1 and total() == 2, "new pull saves pending pull: B records normally")
assert(T:Pulls(3001)[1].saved == nil and T:Pulls(3001)[1].startTime == nil, "no stray fields")
print("ok new pull saves pending pull")

-- combat start saves pending pull
reset()
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
sources = { { name = "Mage", classFilename = "MAGE", deathRecapID = 7, deathTimeSeconds = 42, sourceGUID = "G2" } }
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
assert(total() == 0, "combat start saves pending pull: still waiting for the read")
inCombat = true; H("PLAYER_REGEN_DISABLED") -- a trash pull starts inside the read window
assert(#T:Pulls(3001) == 1 and #T:Pulls(3001)[1].deaths == 0, "combat start saves pending pull: saved at once with no deaths")
runTimers()
assert(total() == 1, "combat start saves pending pull: the queued read does not save it again")
print("ok combat start saves pending pull")

-- a failing listener does not stop saving
reset()
local seen = 0
T:OnChange(function() error("page broke") end)
T:OnChange(function() seen = seen + 1 end)
local oldHandler = geterrorhandler
local errs = 0
function geterrorhandler() return function() errs = errs + 1 end end
H("ENCOUNTER_START", 3001, "Boss", 16, 20)
clock = 160; H("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
runTimers()
assert(total() == 1 and seen >= 1 and errs >= 1, "failing listener does not stop saving")
geterrorhandler = oldHandler
T.listeners = {}
print("ok failing listener does not stop saving")

assert(T.readable(1) == true and T.readable(SECRET) == false, "readable exposed")
print("ok readable exposed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
let src; try { src = fs.readFileSync(process.argv[2], 'utf8'); } catch (e) { console.error('cannot read ' + process.argv[2]); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
