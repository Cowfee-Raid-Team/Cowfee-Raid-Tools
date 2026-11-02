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
local CRT = { db = { alerts = { instantRelease = true }, dev = {} } }
function CRT:Print(m) printed[#printed + 1] = tostring(m) end
assert(load(releaseSrc, "@InstantRelease.lua"))("CowfeeRaidTools", CRT)
local ok, err = pcall(function() assert(load(devSrc, "@InstantReleaseTest.lua"))("CowfeeRaidTools", CRT) end)
check("InstantReleaseTest.lua loads", ok and CRT.InstantReleaseTest ~= nil, err)
if not (ok and CRT.InstantReleaseTest) then print(passed .. " passed, " .. failed .. " failed") error("no dev file") end
local T = CRT.InstantReleaseTest
local function run(msg) printed = {} return T:Command(msg) end
local function said(s) for _, p in ipairs(printed) do if p:find(s, 1, true) then return true end end return false end
local function reset() dead, ghost, incoming, selfRes, repops, timers = true, false, false, nil, 0, {} CRT.db.alerts.instantRelease = true T:Command("dev autorelease off") end

check("the constants: 600 s armed, 1 s wait", T.ARM_SECONDS == 600 and T.ARM_WAIT == 1)
check("it takes dev autorelease and leaves other words", run("dev autorelease") == true and T:Command("dev autoreleasex") == false and T:Command("dev lowhp") == false)

-- status
reset()
run("dev autorelease")
check("status (no word): one line per check", said("Setting: on") and said("Dead: true") and said("Ghost: false") and said("Incoming resurrection: false")
  and said("Resurrection offer: none") and said("Self-resurrect options: none") and said("RepopMe: present"), table.concat(printed, " | "))
check("status: dead, nothing else: would release", said("Would release"), table.concat(printed, " | "))
reset() dead = false run("dev autorelease status")
check("status alive: would hold, you're alive", said("Would hold: you're alive") and said("Dead: false"), table.concat(printed, " | "))
reset() dead, ghost = false, true run("dev autorelease status")
check("status ghost: would hold, already a ghost", said("Would hold: you're already a ghost"), table.concat(printed, " | "))
reset() selfRes = { { name = "Use Soulstone" } } run("dev autorelease status")
check("status self-res: would hold, you can resurrect yourself, and names it", said("Would hold: you can resurrect yourself") and said("Use Soulstone"), table.concat(printed, " | "))
reset() CRT.db.alerts.instantRelease = false run("dev autorelease status")
check("status setting off: would hold, the setting is off", said("Setting: off") and said("Would hold: the setting is off"), table.concat(printed, " | "))
reset() dead = SECRET run("dev autorelease status")
check("status with a secret death state: says secret, holds, no error", said("Dead: <secret>") and said("Would hold:"), table.concat(printed, " | "))
reset() fire("RESURRECT_REQUEST", "Healer") run("dev autorelease status")
check("status with an offer open: its seconds left, would hold", said("Resurrection offer: open, 60 s left") and said("Would hold: a resurrection offer is open"), table.concat(printed, " | "))
fire("PLAYER_DEAD")
check("every line through CRT:Print, with no other addon named", not said("BugSack") and not said("WeakAuras"))

-- now
reset() run("dev autorelease now")
check("now, on and dead: not released at once, says it will", repops == 0 and said("Releasing in 0.5 s"), table.concat(printed, " | "))
step(0.5)
check("now: RepopMe once after the delay, and says so", repops == 1 and said("RepopMe called"), table.concat(printed, " | "))
step(5)
check("now: only once", repops == 1)
reset() CRT.db.alerts.instantRelease = false run("dev autorelease now") step(2)
check("now with the setting off: nothing, and it says so", repops == 0 and said("the setting is off"), table.concat(printed, " | "))
reset() dead = false run("dev autorelease now") step(2)
check("now alive: nothing, and why", repops == 0 and said("Would hold: you're alive"), table.concat(printed, " | "))
reset() run("dev autorelease now") step(0.2) selfRes = { { name = "Reincarnation" } } step(2)
check("now, a self-resurrect by the delay's end: not released, and it says so", repops == 0 and said("Not released"), table.concat(printed, " | "))

-- arm
reset() dead = false run("dev autorelease arm")
check("arm: says armed for 10 minutes, as a boss wipe", said("Armed for 10 minutes: die and it acts as a boss wipe."), table.concat(printed, " | "))
check("no status line names a boss", not said("boss set up") and not said("Boss:"))
step(30) dead = true fire("PLAYER_DEAD")
step(0.9)
check("arm: nothing before the wait and the delay", repops == 0)
step(0.7)
check("arm, then a death: released about 1.5 s later", repops == 1, repops)
dead, ghost = true, false fire("PLAYER_DEAD") step(3)
check("arm is one shot", repops == 1, repops)
reset() dead = false run("dev autorelease arm") step(601) dead = true fire("PLAYER_DEAD") step(3)
check("arm times out after 10 minutes", repops == 0)
reset() dead = false run("dev autorelease arm") run("dev autorelease off") dead = true fire("PLAYER_DEAD") step(3)
check("off disarms", repops == 0 and said("Disarmed"), table.concat(printed, " | "))
reset() dead = false run("dev autorelease arm") CRT.db.alerts.instantRelease = false printed = {} dead = true fire("PLAYER_DEAD") step(3)
check("armed with the setting off: nothing, and it says the setting is off", repops == 0 and said("the setting is off"), table.concat(printed, " | "))

-- the shipped path: any boss's wipe releases
reset() fire("ENCOUNTER_END", 3421, "Boss", 16, 20, 0) step(2)
check("a real wipe releases", repops == 1)
reset() fire("ENCOUNTER_END", 9999, "Other boss", 1, 5, 0) step(2)
check("a real wipe on any other boss releases too", repops == 1)
reset() fire("ENCOUNTER_END", 3421, "Boss", 16, 20, 1) step(2)
check("a real kill still does nothing", repops == 0)
reset() CRT.InstantRelease:OnEncounterEnd(0, 1, { done = function() end }) step(2)
check("the dev hook with a kill still does nothing", repops == 0)

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
