// CRT_Dev/Dev/AuraProbe.lua on a stand-in group: /crt dev aura logs what the game lets an addon read of a debuff on each
// group unit (by spell ID and by name), whether it is a private aura, the combat and encounter state, and UNIT_AURA
// while on. Secret values are proxies that raise an error on any use the game forbids, and the aura calls can error,
// so a probe that touches a secret or lets an error through fails the check. Loads Alerts/Special.lua and
// Alerts/DebuffList.lua for the tier it saves.
// Usage: node run_auraprobe.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local srcs = { ... }
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

local SECRET = {}
local function forbidden() error("used a secret value") end
for _, k in ipairs({ "__index", "__newindex", "__len", "__concat", "__lt", "__le", "__eq", "__add", "__sub", "__mul", "__div", "__unm", "__call", "__tostring" }) do SECRET[k] = forbidden end
local function secret(v) return setmetatable({ inner = v }, SECRET) end
function issecretvalue(v) return getmetatable(v) == SECRET end
local realType = type
function type(v) if getmetatable(v) == SECRET then return realType(rawget(v, "inner")) end return realType(v) end
function canaccessvalue(v) return not issecretvalue(v) end

local frames = {}
function CreateFrame()
  local f = { events = {}, scripts = {} }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  function f:SetScript(k, fn) self.scripts[k] = fn end
  frames[#frames + 1] = f
  return f
end
local now = 100
function GetTime() return now end
function time() return 1792540800 end
date = os.date
function geterrorhandler() return function(e) error(e) end end

-- the game: a raid of four, a combat flag, and aura calls set per check
local inCombat, encounter = false, false
function InCombatLockdown() return inCombat end
function UnitAffectingCombat() return inCombat end
C_InstanceEncounter = { IsEncounterInProgress = function() return encounter end }
local inRaid = true
function IsInRaid() return inRaid end
function IsInGroup() return true end
function UnitExists(u) local i = tonumber(u:match("^raid(%d+)$") or "") return (i and i <= 4) or u == "player" or u == "party1" end
function UnitName(u) if u == "raid2" then return secret("Hidden") end return "Name-" .. u end
C_Spell = { GetSpellName = function(id) if id == 1301117 then return "Grasping Fangs" end end }
local byID, byName, private = {}, {}, false
C_UnitAuras = {
  GetUnitAuraBySpellID = function(u, id) local a = byID[u] if a == "error" then error("Auras cannot be read") end return a end,
  GetAuraDataBySpellName = function(u, name, filter) assert(filter == "HARMFUL") local a = byName[u] if a == "error" then error("tainted") end return a end,
  AuraIsPrivate = function(id) if private == "error" then error("no") end return private end,
}

local printed, shown = {}, nil
local CRT = { db = { dev = {}, alerts = { special = {}, debuffLists = {}, debuffTiers = {} } } }
function CRT:Print(s) printed[#printed + 1] = s end
CRT.ConsumablesTools = { ShowText = function(_, title, text) shown = { title = title, text = text } end }
CRT.Bosses = { List = function() return { { encounterID = 3492 } } end, Get = function(_, id) if id == 3492 then return { encounterID = 3492, special = {
  { kind = "debuffList", key = "fangs", label = "Grasping Fangs", spellID = 1301117, sides = { { key = "l", groups = { 1 } } } } } } end end,
  Loaded = function() return true end }
CRT.Alerts = { RegisterBlock = function() end, Settings = function() return CRT.db.alerts end }
for i = 1, #srcs, 2 do assert(load(srcs[i + 1], srcs[i]))("CowfeeRaidTools", CRT) end
local P, DL = CRT.AuraProbe, CRT.AlertDebuffList
check(P and DL, "the probe and the debuff list loaded")
local function log() local l = CRT.db.dev.auraProbe and CRT.db.dev.auraProbe.last return l and l.lines or {} end
local function has(s) for _, l in ipairs(log()) do if l:find(s, 1, true) then return true end end return false end
local function line(s) for _, l in ipairs(log()) do if l:find(s, 1, true) then return l end end return "" end
local function count(s) local n = 0 for _, l in ipairs(log()) do if l:find(s, 1, true) then n = n + 1 end end return n end

check(P:Command("dev absorbprobe on") == false and P:Command("dev auras") == false, "another command is not the probe's")

-- A snapshot: every kind of answer, nothing touched that is secret, nothing let through that errors
byID = { raid1 = { spellId = 1301117, name = "Grasping Fangs", auraInstanceID = 7, isHarmful = true, applications = 0, duration = 8, expirationTime = 120 },
  raid2 = secret({}), raid3 = "error" }
byID.raid1.sourceUnit = secret("boss1")
byName = { raid1 = "error", raid2 = nil, raid3 = secret({}), raid4 = { spellId = secret(1301117), name = "Grasping Fangs" } }
local ok, err = pcall(P.Command, P, "dev aura 1301117")
check(ok, "a snapshot never errors on secrets or failing calls: " .. tostring(err))
check(shown and shown.title:find("Ctrl+C", 1, true) and shown.text:find("raid1", 1, true), "it opens in a window to copy")
check(has("STATE combat=false lockdown=false encounter=false raid=true group=true"), "the combat and encounter state: " .. line("STATE"))
check(has('SPELL 1301117 name="Grasping Fangs" private=false'), "the spell's name and AuraIsPrivate")
check(has('raid1 "Name-raid1" spell 1301117 byID: readable spellId=1301117 name="Grasping Fangs" auraInstanceID=7 isHarmful=true applications=0 duration=8 expirationTime=120 sourceUnit=secret'),
  "a readable aura: each field, a hidden one as secret: " .. line("raid1 "))
check(has("raid1") and line("raid1 "):find("byName: error ", 1, true) ~= nil, "a lookup by name that errors: logged as error")
check(line("raid2 "):find("raid2 <secret> spell 1301117 byID: secret table | byName: nothing", 1, true) ~= nil, "a hidden aura table and a hidden name, nothing read: " .. line("raid2 "))
check(line("raid3 "):find("byID: error ", 1, true) ~= nil and line("raid3 "):find("byName: secret table", 1, true) ~= nil, "an erroring lookup by ID, a hidden one by name")
check(line("raid4 "):find("byID: nothing", 1, true) ~= nil and line("raid4 "):find("byName: readable spellId=secret", 1, true) ~= nil, "nothing by ID; by name a field the game hides")
check(has("TIER spell 1301117 readable (someone has it)") and DL:Seen(3492, 1301117) == "readable", "the tier: readable, saved for the Looks tab")

-- secret booleans and failing APIs: the private and unreadable tiers
byID = { raid1 = secret(true), raid2 = secret(false) }
pcall(P.Command, P, "dev aura 1301117")
check(has("byID: secret boolean") and has("TIER spell 1301117 secret") and DL:Seen(3492, 1301117) == "secret", "a secret boolean: the secret tier")
byID = { raid1 = "error", raid2 = "error", raid3 = "error", raid4 = "error" }
pcall(P.Command, P, "dev aura 1301117")
check(has("TIER spell 1301117 unreadable") and DL:Notice(3492, 1301117) ~= nil, "every lookup failing: unreadable, the notice set")
private = true
pcall(P.Command, P, "dev aura 1301117")
check(has("private=true") and has("TIER spell 1301117 private") and DL:Seen(3492, 1301117) == "private", "AuraIsPrivate true: private")
private = "error"
byID = {}
ok, err = pcall(P.Command, P, "dev aura 1301117")
check(ok and has("private=nil"), "AuraIsPrivate erroring: nil, no error: " .. tostring(err))
private = false
C_UnitAuras.GetAuraDataBySpellName = nil
ok, err = pcall(P.Command, P, "dev aura 1301117")
check(ok and line("raid1 "):find("byName: error \\"missing\\"", 1, true) ~= nil, "a missing function: logged as missing: " .. line("raid1 "))
local saveName = C_Spell
C_Spell = nil
pcall(P.Command, P, "dev aura 1301117")
check(has("byName: no spell name"), "no spell name: no lookup by name")
C_Spell = saveName

-- On: the pull, combat and UNIT_AURA
printed = {}
P:Command("dev aura on")
check(CRT.db.dev.auraProbe.on and printed[1]:find("1301117", 1, true), "/crt dev aura on, for the last spell: " .. tostring(printed[1]))
local f
for _, fr in ipairs(frames) do if fr.events.UNIT_AURA then f = fr end end
check(f and f.events.ENCOUNTER_START and f.events.ENCOUNTER_END and f.events.PLAYER_REGEN_DISABLED, "it listens to the pull, combat and UNIT_AURA")
local function fire(e, ...) f.scripts.OnEvent(f, e, ...) end
CRT.db.dev.auraProbe.spells = nil
inCombat, encounter = true, true
now = 200
byID = {}
fire("ENCOUNTER_START", 3492, "Ula'tek", 16, 20)
check(has("+0.0 ENCOUNTER_START encounterID=3492") and has("STATE combat=true lockdown=true encounter=true") and has("(pull start)"), "the pull starts a log with a snapshot")
check(has("SPELL 1301117"), "with no spell given: every debuff list's spell")
local before = #log()
now = 203
byID.raid2 = { spellId = 1301117 }
fire("UNIT_AURA", "raid2", { isFullUpdate = false })
check(has("+3.0 UNIT_AURA unit=\\"raid2\\" updateInfo=readable isFullUpdate=false"), "a UNIT_AURA line, updateInfo readable")
check(count("raid2 <secret> spell 1301117 byID: readable") == 1, "its answer changed: a lookup line")
fire("UNIT_AURA", "raid2", { isFullUpdate = false })
check(count("raid2 <secret> spell 1301117 byID: readable") == 1, "the same answer: no new lookup line")
ok, err = pcall(fire, "UNIT_AURA", secret("raid3"), secret({}))
check(ok and has("UNIT_AURA unit=<secret> updateInfo=secret"), "a fully secret payload: logged, nothing touched: " .. tostring(err))
fire("UNIT_AURA", "nameplate4", {})
check(not has("nameplate4"), "a unit outside the group is left out")
fire("ENCOUNTER_END", 3492, "Ula'tek", 16, 20, 0)
check(has("ENCOUNTER_END encounterID=3492") and has("(pull end)"), "the pull's end: a snapshot")
P:Command("dev aura off")
check(CRT.db.dev.auraProbe.on == false and not f.events.UNIT_AURA and #log() > before, "off: listens no more, the log stays")
P:Command("dev aura on 1301117")
check(CRT.db.dev.auraProbe.spells[1] == 1301117, "on with a spell")
P:Command("dev aura off")
-- the cap: UNIT_AURA lines on their own, counted per unit past it; the lookup, TIER and STATE lines and the pull-end
-- snapshot are always kept
CRT.db.dev.auraProbe.on = true
P.AURA_MAX = 5
fire("ENCOUNTER_START", 3492, "Ula'tek", 16, 20)
for i = 1, 300 do
  byID.raid1 = (i % 2 == 0) and { spellId = 1301117 } or nil -- the answer flips: a lookup line each time
  fire("UNIT_AURA", i % 3 == 0 and "raid2" or "raid1", {})
end
check(count("UNIT_AURA unit=") == 5, "UNIT_AURA lines stop at their cap: " .. count("UNIT_AURA unit="))
local drops = CRT.db.dev.auraProbe.last.dropped
check(drops and drops['"raid1"'] == 196 and drops['"raid2"'] == 99, "the rest counted per unit: " .. tostring(drops and drops['"raid1"']) .. ", " .. tostring(drops and drops['"raid2"']))
check(count('raid1 "Name-raid1" spell 1301117 byID:') > 50, "every changed lookup line kept past the cap")
fire("ENCOUNTER_END", 3492, "Ula'tek", 16, 20, 0)
local lines = log()
local tierAfter, stateAfter = false, false
local seenEnd = false
for _, l in ipairs(lines) do
  if l:find("ENCOUNTER_END", 1, true) then seenEnd = true end
  if seenEnd and l:find("TIER spell 1301117", 1, true) then tierAfter = true end
  if seenEnd and l:find("STATE ", 1, true) and l:find("(pull end)", 1, true) then stateAfter = true end
end
check(seenEnd and tierAfter and stateAfter, "after a flood of UNIT_AURA the pull-end snapshot's STATE and TIER lines are there")
P:Command("dev aura show")
check(shown.text:find('more UNIT_AURA lines left out (the log keeps 5 of them): "raid1" 196, "raid2" 99', 1, true) ~= nil, "and the log says how many, by unit")
-- a spell no debuff list watches: logged, not saved
CRT.db.alerts.debuffTiers = {}
pcall(P.Command, P, "dev aura 4242")
check(has("TIER spell 4242") and has("not saved") and next(CRT.db.alerts.debuffTiers) == nil, "a spell of no list: its tier is logged, not saved")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error("aura probe: " .. fails .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/Alerts/Special.lua', 'CRT_Modules/Alerts/DebuffList.lua', 'CRT_Dev/Dev/AuraProbe.lua'];
for (const f of files) { lua.lua_pushstring(L, to_luastring(f)); lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(root, f), 'utf8'))); }
if (lua.lua_pcall(L, 2 * files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
