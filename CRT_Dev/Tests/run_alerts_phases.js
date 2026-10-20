// Alerts/PhaseDatabase.lua + Alerts/Phases.lua: phase events on the alerts engine.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local rulesSrc, engineSrc, dbSrc, phasesSrc = ...
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
local clock = 100
function GetTime() return clock end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
local function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local SECRET = {}
function issecretvalue(v) return v == SECRET end
local printed = {}
local function defaults() return { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
  reminders = {}, phases = {}, overrides = {}, nextId = 1 } end
local CRT = { db = { alerts = defaults() } }
CRT.Timeline = { readable = function(v) local ok, s = pcall(issecretvalue, v); return ok and not s end }
function CRT:Print(m) printed[#printed + 1] = m end
local units = {}
function UnitExists(u) return units[u] and true or false end
local canAttack = {}
function UnitCanAttack(a, u) if canAttack[u] == "boom" then error("boom") end return canAttack[u] end
assert(load(rulesSrc, "Rules"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "Engine"))("CowfeeRaidTools", CRT)
assert(load(dbSrc, "PhaseDatabase"))("CowfeeRaidTools", CRT)
assert(load(phasesSrc, "Phases"))("CowfeeRaidTools", CRT)
local A, P = CRT.Alerts, CRT.AlertPhases
assert(P and type(P.HandleEvent) == "function" and CRT.AlertPhaseDB, "Phases and database exist")
local H = A.HandleEvent

local blockItems = {}
A:RegisterBlock("test", { label = "Test", group = false, Entries = function(run) return blockItems end })
local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 21, hold = 0, warn = 0,
    outputs = { alert = true, bar = true, speech = false } }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local function fresh(items)
  A:Stop()
  blockItems = items or {}
  clock = 100
  wipe(errors); wipe(units); wipe(canAttack)
  CRT.db.alerts = defaults()
  for k in pairs(CRT.AlertPhaseDB) do CRT.AlertPhaseDB[k] = nil end
end
local function pull(id) H("ENCOUNTER_START", id or 3001, "Boss", 16) end

local want = { "manual", "emote", "untargetable", "targetable", "newboss" }
assert(#P.KINDS == 5)
for i, k in ipairs(want) do assert((P.KINDS[i].key or P.KINDS[i][1]) == k and (P.KINDS[i].label or P.KINDS[i][2])) end

fresh()
CRT.AlertPhaseDB[3001] = { [2] = { kind = "emote", value = "shipped words" }, [3] = { kind = "targetable", value = "boss1" } }
assert(P:Set(3001, 2, "emote", "my words") == true)
local f = P:For(3001)
assert(f[2].kind == "emote" and f[2].value == "my words" and f[2].from == "yours", "yours over shipped")
assert(f[3].from == "shipped" and f[3].kind == "targetable")
f[3].kind = "x"; f[2].value = "x"
assert(CRT.AlertPhaseDB[3001][3].kind == "targetable" and CRT.db.alerts.phases[3001][2].value == "my words", "copies, not stored tables")
print("ok phases: yours over shipped")

local fired = 0
A:OnChange(function() fired = fired + 1 end)
fired = 0
P:UseShipped(3001, 2)
f = P:For(3001)
assert(f[2].from == "shipped" and f[2].value == "shipped words")
assert(CRT.db.alerts.phases[3001] == nil or CRT.db.alerts.phases[3001][2] == nil)
assert(fired == 1, "UseShipped fires")
P:Set(3001, 2, "emote", "a"); assert(fired == 2, "Set fires")
print("ok phases: use shipped removes yours")

fresh()
assert(P:Set(3001, 2, "emote", "x"))
assert(not P:Set(3001, 2, "bogus", "x"))
assert(not P:Set(3001, 2, "untargetable", "boss6"))
assert(not P:Set(3001, 2, "newboss", "player"))
assert(not P:Set(3001, 2, "newboss", "boss1") and P:Set(3001, 2, "newboss", "boss2") and P:Set(3001, 2, "targetable", "boss1"))
assert(not P:Set(3001, 2, "targetable", nil))
assert(not P:Set(3001, 2, "untargetable", SECRET))
for i = 1, 5 do assert(P:Set(3001, 2.5, "untargetable", "boss" .. i)) end
assert(P:Set(3001, 2.5, "manual", nil))
print("ok phases: set rejects bad unit")

fresh({ item{ id = "a", ph = 1 } })
P:Set(3001, 2, "emote", "coils tighten")
pull(3001)
assert(A:PhaseStart(2) == nil)
P.HandleEvent("RAID_BOSS_EMOTE", "The coils TIGHTEN!", "Boss")
assert(A:PhaseStart(2) == clock and A:CurrentPhase() == 2)
clock = 120
P.HandleEvent("CHAT_MSG_RAID_BOSS_EMOTE", "The coils TIGHTEN!", "Boss")
assert(A:PhaseStart(2) == 100, "second emote ignored")
print("ok phases: emote starts phase")

fresh({ item{ id = "a", ph = 1 } })
P:Set(3001, 2, "emote", "coils")
pull(3001)
P.HandleEvent("RAID_BOSS_EMOTE", SECRET, "Boss")
P.HandleEvent("RAID_BOSS_EMOTE", 5, "Boss")
P.HandleEvent("RAID_BOSS_EMOTE", nil)
P.HandleEvent("UNIT_TARGETABLE_CHANGED", SECRET)
assert(A:PhaseStart(2) == nil and #errors == 0 and #printed == 0)
print("ok phases: secret emote text never matches")

fresh({ item{ id = "a", ph = 1 } })
P:Set(3001, 2, "untargetable", "boss1"); P:Set(3001, 3, "targetable", "boss1")
pull(3001)
canAttack.boss1 = true
P.HandleEvent("UNIT_TARGETABLE_CHANGED", "boss2")
assert(A:PhaseStart(3) == nil, "other unit ignored")
P.HandleEvent("UNIT_TARGETABLE_CHANGED", "boss1")
assert(A:PhaseStart(2) == nil and A:PhaseStart(3) == 100, "targetable true starts phase 3")
fresh({ item{ id = "a", ph = 1 } })
P:Set(3001, 2, "untargetable", "boss1")
pull(3001)
canAttack.boss1 = "boom"; P.HandleEvent("UNIT_TARGETABLE_CHANGED", "boss1")
canAttack.boss1 = SECRET; P.HandleEvent("UNIT_TARGETABLE_CHANGED", "boss1")
canAttack.boss1 = nil; P.HandleEvent("UNIT_TARGETABLE_CHANGED", "boss1")
canAttack.boss1 = true; P.HandleEvent("UNIT_TARGETABLE_CHANGED", "boss1")
assert(A:PhaseStart(2) == nil and #errors == 0)
canAttack.boss1 = false; P.HandleEvent("UNIT_TARGETABLE_CHANGED", "boss1")
assert(A:PhaseStart(2) == 100)
print("ok phases: untargetable starts phase")

fresh({ item{ id = "a", ph = 1 } })
units.boss1 = true; units.boss3 = true
P:Set(3001, 2, "newboss", "boss3"); P:Set(3001, 3, "newboss", "boss2")
pull(3001)
P.HandleEvent("INSTANCE_ENCOUNTER_ENGAGE_UNIT")
assert(A:PhaseStart(2) == nil and A:PhaseStart(3) == nil, "boss3 was there at the pull")
units.boss2 = true
P.HandleEvent("INSTANCE_ENCOUNTER_ENGAGE_UNIT")
assert(A:PhaseStart(3) == 100 and A:Skipped(2))
print("ok phases: newboss only when new")

fresh({ item{ id = "a", ph = 1 }, item{ id = "b", ph = 3 } })
P:Set(3001, 2, "emote", "go"); P:Set(3001, 2.5, "manual")
pull(3001)
local ph = A:Phases()
assert(#ph == 3 and ph[1] == 1 and ph[2] == 2 and ph[3] == 3, "event phase listed, manual not")
assert(A:NextPhase() == 2 and A:PhaseStart(2) == 100)
print("ok phases: event phase counts for next phase")

fresh({ item{ id = "a", ph = 1 } })
P:Set(3001, 2, "emote", "go"); P:Set(3002, 2, "emote", "go")
pull(3002)
P.HandleEvent("RAID_BOSS_EMOTE", "go go", "B")
assert(A:PhaseStart(2) == 100)
fresh({ item{ id = "a", ph = 1 } })
P:Set(3001, 2, "emote", "go")
pull(3002)
P.HandleEvent("RAID_BOSS_EMOTE", "go", "B")
assert(A:PhaseStart(2) == nil, "other boss phase not considered")
fresh({ item{ id = "a", ph = 1 } })
P:Set(3001, 3, "emote", "go"); P:Set(3001, 2, "emote", "go")
pull(3001)
P.HandleEvent("RAID_BOSS_EMOTE", "go", "B")
assert(A:PhaseStart(2) == 100 and A:PhaseStart(3) == nil, "one event, earliest phase only")
fresh({}); P:Set(3001, 2, "emote", "go")
P.HandleEvent("RAID_BOSS_EMOTE", "go", "B")
assert(#errors == 0)
print("ok phases: only current boss")

fresh({ item{ id = "a", ph = 1 } })
P:Set(3001, 2, "emote", "go")
A:Start(3001, "Mythic", "test")
P.HandleEvent("RAID_BOSS_EMOTE", "go", "B")
assert(A:PhaseStart(2) == nil and #errors == 0)
print("ok phases: test run ignores events")

fresh()
local nan = 0 / 0
for _, bad in ipairs({ nan, math.huge, -math.huge, 0, 1, -2, "2" }) do
  assert(P:Set(3001, bad, "emote", "x") == false)
end
assert(P:Set("a", 2, "emote", "x") == false and P:Set(nil, 2, "emote", "x") == false and P:Set(nan, 2, "emote", "x") == false)
assert(P:Set(3001, 1.5, "emote", "x") == true)
CRT.AlertPhaseDB[3001] = { [1] = { kind = "emote", value = "x" } }
pull(3001)
local phs = A:Phases()
assert(#phs == 2 and phs[1] == 1 and phs[2] == 1.5, "phase 1 trigger ignored, 1.5 listed: " .. table.concat(phs, ","))
P.HandleEvent("RAID_BOSS_EMOTE", "x", "B")
assert(A:PhaseStart(1.5) == 100 and #errors == 0)
print("ok phases: set rejects bad phase numbers")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (let i = 2; i < 6; i++) lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[i], 'utf8')));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
