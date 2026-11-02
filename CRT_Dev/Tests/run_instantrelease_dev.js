// CRT_Dev/Dev/InstantReleaseTest.lua: /crt dev autorelease, the developer test of Instantly release after wipe
// (Alerts/InstantRelease.lua) outside a raid. status prints each check and the verdict; now runs the real end-of-encounter
// path as a wipe (InstantRelease:OnEncounterEnd with its dev opts.done); arm does the same on the next death within
// ARM_SECONDS, ARM_WAIT after it; off disarms. Also: the file and its slash word are inside the do-not-package blocks,
// and the dev hook leaves the shipped path as it was (any boss's wipe releases, a kill never).
// Usage: node run_instantrelease_dev.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local releaseSrc, devSrc, tocText, slashText = ...
local passed, failed = 0, 0
local function check(name, cond, detail)
  if cond then passed = passed + 1 print("ok " .. name)
  else failed = failed + 1 print("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or "")) end
end
format = string.format
local SECRET = setmetatable({}, { __eq = function() error("secret compared", 2) end })
function issecretvalue(v) return rawequal(v, SECRET) end
local clock = 100
function GetTime() return clock end
local timers = {}
C_Timer = { After = function(d, fn) timers[#timers + 1] = { due = clock + d, fn = fn } end }
local function step(dt)
  local stop = clock + dt
  while true do
    local first
    for i, t in ipairs(timers) do if t.due <= stop + 1e-9 and (not first or t.due < timers[first].due) then first = i end end
    if not first then break end
    local t = table.remove(timers, first)
    clock = math.max(clock, t.due)
    t.fn()
  end
  clock = stop
end
local dead, ghost, incoming, selfRes = true, false, false, nil
function UnitIsDead(u) return dead end
function UnitIsGhost(u) return ghost end
function UnitHasIncomingResurrection(u) return incoming end
C_DeathInfo = { GetSelfResurrectOptions = function() return selfRes end }
function GetCorpseRecoveryDelay() return 0 end
local instanceType = "none" -- in town: the dev command goes past the raid check
function IsInInstance() return instanceType ~= "none", instanceType end
local repops = 0
function RepopMe() repops = repops + 1 ghost = true dead = false end
local frames = {}
function CreateFrame()
  local f = { events = {} }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  function f:SetScript(n, fn) self[n] = fn end
  frames[#frames + 1] = f
  return f
end
local function fire(ev, ...) for _, f in ipairs(frames) do if f.events[ev] and f.OnEvent then f.OnEvent(f, ev, ...) end end end
local printed = {}
local NEK, FANGS, UNKNOWN = 3470, 3421, 9999
local NAMES = { [NEK] = "Nek'zali the Soulcoiler", [FANGS] = "The Twin Fangs" }
local CRT = { db = { alerts = { instantReleaseBosses = { [NEK] = true } }, dev = {} } }
function CRT:Print(m) printed[#printed + 1] = tostring(m) end
CRT.Bosses = { DeclareField = function() end, Get = function(_, id) return NAMES[id] and { encounterID = id, name = NAMES[id] } or nil end }
local onShow = NEK -- the boss on show on Mech Alerts
CRT.NoteReminders = { Boss = function() return onShow end }
assert(load(releaseSrc, "@InstantRelease.lua"))("CowfeeRaidTools", CRT)
local ok, err = pcall(function() assert(load(devSrc, "@InstantReleaseTest.lua"))("CowfeeRaidTools", CRT) end)
check("InstantReleaseTest.lua loads", ok and CRT.InstantReleaseTest ~= nil, err)
if not (ok and CRT.InstantReleaseTest) then print(passed .. " passed, " .. failed .. " failed") error("no dev file") end
local T = CRT.InstantReleaseTest
local function run(msg) printed = {} return T:Command(msg) end
local function said(s) for _, p in ipairs(printed) do if p:find(s, 1, true) then return true end end return false end
local function all() return table.concat(printed, " | ") end
local function reset()
  dead, ghost, incoming, selfRes, repops, timers = true, false, false, nil, 0, {}
  CRT.db.alerts.instantReleaseBosses = { [NEK] = true }
  onShow = NEK
  T:Command("dev autorelease off")
end

check("the constants: 600 s armed, 1 s wait", T.ARM_SECONDS == 600 and T.ARM_WAIT == 1)
check("it takes dev autorelease and leaves other words", run("dev autorelease") == true and T:Command("dev autoreleasex") == false and T:Command("dev lowhp") == false)

-- status
reset()
run("dev autorelease")
check("status (no word): one line per check", said("Boss on show: Nek'zali the Soulcoiler (3470), ticked") and said("Dead: true") and said("Ghost: false")
  and said("Incoming resurrection: false") and said("Resurrection offer: none") and said("Self-resurrect options: none") and said("RepopMe: present"), all())
check("status: the raid check's answer, and that the dev command goes past it", said("Raid instance: no (none)") and said("now and arm go past it"), all())
check("status: dead, nothing else: would release", said("Would release"), all())
reset() CRT.db.alerts.instantReleaseBosses = { [NEK] = true, [UNKNOWN] = true } run("dev autorelease")
check("status lists the ticked bosses by name, an ID the library doesn't know as its ID", said("Ticked bosses: Nek'zali the Soulcoiler, 9999"), all())
reset() CRT.db.alerts.instantReleaseBosses = {} run("dev autorelease")
check("status with none ticked says so", said("Ticked bosses: none"), all())
reset() dead = false run("dev autorelease status")
check("status alive: would hold, you're alive", said("Would hold: you're alive") and said("Dead: false"), all())
reset() dead, ghost = false, true run("dev autorelease status")
check("status ghost: would hold, already a ghost", said("Would hold: you're already a ghost"), all())
reset() selfRes = { { name = "Use Soulstone" } } run("dev autorelease status")
check("status self-res: would hold, you can resurrect yourself, and names it", said("Would hold: you can resurrect yourself") and said("Use Soulstone"), all())
reset() onShow = FANGS run("dev autorelease status")
check("status on an unticked boss: would hold, it isn't ticked", said("Boss on show: The Twin Fangs (3421), not ticked") and said("Would hold: The Twin Fangs isn't ticked"), all())
reset() onShow = nil run("dev autorelease status")
check("status with no boss on show says so", said("Boss on show: none") and said("Would hold: no boss on show"), all())
reset() dead = SECRET run("dev autorelease status")
check("status with a secret death state: says secret, holds, no error", said("Dead: <secret>") and said("Would hold:"), all())
reset() fire("RESURRECT_REQUEST", "Healer") run("dev autorelease status")
check("status with an offer open: its seconds left, would hold", said("Resurrection offer: open, 60 s left") and said("Would hold: a resurrection offer is open"), all())
fire("PLAYER_DEAD")
check("every line through CRT:Print, with no other addon named", not said("BugSack") and not said("WeakAuras"))

-- now: the boss on show, or a given ID
reset() run("dev autorelease now")
check("now, the boss on show ticked and dead: not released at once, says it will", repops == 0 and said("Releasing in 0.5 s") and said("Nek'zali the Soulcoiler"), all())
step(0.5)
check("now: RepopMe once after the delay, and says so", repops == 1 and said("RepopMe called"), all())
step(5)
check("now: only once", repops == 1)
reset() onShow = FANGS run("dev autorelease now") step(2)
check("now on an unticked boss on show: nothing, and it says so", repops == 0 and said("The Twin Fangs isn't ticked"), all())
reset() onShow = FANGS run("dev autorelease now 3470") step(2)
check("now <encounterID> acts on that boss", repops == 1 and said("Nek'zali the Soulcoiler"), all())
reset() run("dev autorelease now 3421") step(2)
check("now <encounterID> of an unticked boss: nothing", repops == 0 and said("The Twin Fangs isn't ticked"), all())
reset() onShow = nil run("dev autorelease now") step(2)
check("now with no boss on show and no ID: nothing, and it says so", repops == 0 and said("no boss on show"), all())
reset() dead = false run("dev autorelease now") step(2)
check("now alive: nothing, and why", repops == 0 and said("Would hold: you're alive"), all())
reset() run("dev autorelease now") step(0.2) selfRes = { { name = "Reincarnation" } } step(2)
check("now, a self-resurrect by the delay's end: not released, and it says so", repops == 0 and said("Not released"), all())

-- arm
reset() dead = false run("dev autorelease arm")
check("arm: says armed for 10 minutes, naming the boss", said("Armed for 10 minutes: die and it acts as a wipe on Nek'zali the Soulcoiler."), all())
step(30) onShow = FANGS dead = true fire("PLAYER_DEAD")
step(0.9)
check("arm: nothing before the wait and the delay", repops == 0)
step(0.7)
check("arm, then a death: released about 1.5 s later, on the boss armed (not the one on show now)", repops == 1, repops)
dead, ghost = true, false fire("PLAYER_DEAD") step(3)
check("arm is one shot", repops == 1, repops)
reset() onShow = FANGS dead = false run("dev autorelease arm")
check("arm on an unticked boss: says so, not armed", said("The Twin Fangs isn't ticked") and not said("Armed"), all())
dead = true fire("PLAYER_DEAD") step(3)
check("and a death then does nothing", repops == 0)
reset() onShow = FANGS dead = false run("dev autorelease arm 3470")
check("arm <encounterID> arms that boss", said("acts as a wipe on Nek'zali the Soulcoiler"), all())
dead = true fire("PLAYER_DEAD") step(3)
check("and a death releases", repops == 1, repops)
reset() dead = false run("dev autorelease arm") step(601) dead = true fire("PLAYER_DEAD") step(3)
check("arm times out after 10 minutes", repops == 0)
reset() dead = false run("dev autorelease arm") run("dev autorelease off") dead = true fire("PLAYER_DEAD") step(3)
check("off disarms", repops == 0 and said("Disarmed"), all())
reset() dead = false run("dev autorelease arm") CRT.db.alerts.instantReleaseBosses = {} printed = {} dead = true fire("PLAYER_DEAD") step(3)
check("armed, then the boss unticked: nothing, and it says it isn't ticked", repops == 0 and said("isn't ticked"), all())

-- the shipped path: a raid wipe on a ticked boss releases; the event never goes past the raid check
reset() fire("ENCOUNTER_END", NEK, "Boss", 16, 20, 0) step(2)
check("a real wipe outside a raid does nothing (only the dev command goes past the raid check)", repops == 0)
instanceType = "party"
reset() fire("ENCOUNTER_END", NEK, "Dungeon boss", 8, 5, 0) step(2)
check("a real dungeon wipe does nothing", repops == 0)
instanceType = "raid"
reset() fire("ENCOUNTER_END", NEK, "Boss", 16, 20, 0) step(2)
check("a real raid wipe on a ticked boss releases", repops == 1)
reset() fire("ENCOUNTER_END", FANGS, "Other boss", 15, 20, 0) step(2)
check("a real raid wipe on an unticked boss does nothing", repops == 0)
reset() fire("ENCOUNTER_END", NEK, "Boss", 16, 20, 1) step(2)
check("a real kill still does nothing", repops == 0)
reset() CRT.InstantRelease:OnEncounterEnd(NEK, 1, { done = function() end }) step(2)
check("the dev hook with a kill still does nothing", repops == 0)
instanceType = "none"

-- never shipped: the .toc line and the slash word sit inside the do-not-package blocks
local block = tocText:match("#@do%-not%-package@(.-)#@end%-do%-not%-package@") or ""
check("the .toc line is inside the do-not-package block", block:find("CRT_Dev\\Dev\\InstantReleaseTest.lua", 1, true) ~= nil
  and select(2, tocText:gsub("InstantReleaseTest%.lua", "")) == 1)
local slash = slashText:match("%-%-@do%-not%-package@(.-)%-%-@end%-do%-not%-package@") or ""
check("the slash word is inside Slash.lua's do-not-package block", slash:find("CRT.InstantReleaseTest:Command(msg)", 1, true) ~= nil
  and select(2, slashText:gsub("InstantReleaseTest", "")) == select(2, slash:gsub("InstantReleaseTest", "")))
print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error(failed .. " checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
const read = (f) => { const p = path.join(d, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
for (const f of ['CRT_Modules/Alerts/InstantRelease.lua', 'CRT_Dev/Dev/InstantReleaseTest.lua', 'CowfeeRaidTools.toc', 'CRT_Core/Slash.lua']) lua.lua_pushstring(L, to_luastring(read(f)));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
