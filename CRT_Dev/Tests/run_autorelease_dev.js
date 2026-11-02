// CRT_Dev/Dev/AutoReleaseTest.lua: /crt dev autorelease, the developer test of Release my spirit after a wipe
// (QoL/AutoRelease.lua) outside a raid. status prints each check and the verdict; now runs the real end-of-encounter
// path as a wipe with only the boss lookup skipped; arm does the same on the next death within ARM_SECONDS, ARM_WAIT
// after it; off disarms. Also: the file and its slash word are inside the do-not-package blocks, and the dev hook
// leaves the shipped path as it was (no force: the boss lookup still decides).
// Usage: node run_autorelease_dev.js <addon folder>
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
local CRT = { db = { qol = { autoRelease = true }, dev = {} } }
function CRT:Print(m) printed[#printed + 1] = tostring(m) end
local bossOK = false
CRT.Bosses = { AutoRelease = function(_, id) return bossOK end, AutoReleaseNames = function() return { "Sample Release Boss" } end }
assert(load(releaseSrc, "@AutoRelease.lua"))("CowfeeRaidTools", CRT)
local ok, err = pcall(function() assert(load(devSrc, "@AutoReleaseTest.lua"))("CowfeeRaidTools", CRT) end)
check("AutoReleaseTest.lua loads", ok and CRT.AutoReleaseTest ~= nil, err)
if not (ok and CRT.AutoReleaseTest) then print(passed .. " passed, " .. failed .. " failed") error("no dev file") end
local T = CRT.AutoReleaseTest
local function run(msg) printed = {} return T:Command(msg) end
local function said(s) for _, p in ipairs(printed) do if p:find(s, 1, true) then return true end end return false end
local function reset() dead, ghost, incoming, selfRes, repops, timers = true, false, false, nil, 0, {} CRT.db.qol.autoRelease = true T:Command("dev autorelease off") end

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
reset() CRT.db.qol.autoRelease = false run("dev autorelease status")
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
reset() CRT.db.qol.autoRelease = false run("dev autorelease now") step(2)
check("now with the setting off: nothing, and it says so", repops == 0 and said("the setting is off"), table.concat(printed, " | "))
reset() dead = false run("dev autorelease now") step(2)
check("now alive: nothing, and why", repops == 0 and said("Would hold: you're alive"), table.concat(printed, " | "))
reset() run("dev autorelease now") step(0.2) selfRes = { { name = "Reincarnation" } } step(2)
check("now, a self-resurrect by the delay's end: not released, and it says so", repops == 0 and said("Not released"), table.concat(printed, " | "))

-- arm
reset() dead = false run("dev autorelease arm")
check("arm: says armed for 10 minutes, with the boss from the data", said("Armed for 10 minutes") and said("Sample Release Boss"), table.concat(printed, " | "))
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
reset() dead = false run("dev autorelease arm") CRT.db.qol.autoRelease = false printed = {} dead = true fire("PLAYER_DEAD") step(3)
check("armed with the setting off: nothing, and it says the setting is off", repops == 0 and said("the setting is off"), table.concat(printed, " | "))

-- the shipped path is as before: without force the boss lookup decides
reset() bossOK = false fire("ENCOUNTER_END", 3421, "Boss", 16, 20, 0) step(2)
check("a real wipe on a boss without autoRelease still does nothing", repops == 0)
reset() bossOK = true fire("ENCOUNTER_END", 3421, "Boss", 16, 20, 0) step(2)
check("a real wipe on an autoRelease boss still releases", repops == 1)
reset() fire("ENCOUNTER_END", 3421, "Boss", 16, 20, 1) step(2)
check("a real kill still does nothing", repops == 0)
reset() bossOK = false CRT.AutoRelease:OnEncounterEnd(0, 1, { force = true }) step(2)
check("force skips only the boss lookup: a kill still does nothing", repops == 0)

-- never shipped: the .toc line and the slash word sit inside the do-not-package blocks
local block = tocText:match("#@do%-not%-package@(.-)#@end%-do%-not%-package@") or ""
check("the .toc line is inside the do-not-package block", block:find("CRT_Dev\\Dev\\AutoReleaseTest.lua", 1, true) ~= nil
  and select(2, tocText:gsub("AutoReleaseTest%.lua", "")) == 1)
local slash = slashText:match("%-%-@do%-not%-package@(.-)%-%-@end%-do%-not%-package@") or ""
check("the slash word is inside Slash.lua's do-not-package block", slash:find("CRT.AutoReleaseTest:Command(msg)", 1, true) ~= nil
  and select(2, slashText:gsub("AutoReleaseTest", "")) == select(2, slash:gsub("AutoReleaseTest", "")))
print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error(failed .. " checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
const read = (f) => { const p = path.join(d, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
for (const f of ['CRT_Modules/QoL/AutoRelease.lua', 'CRT_Dev/Dev/AutoReleaseTest.lua', 'CowfeeRaidTools.toc', 'CRT_Core/Slash.lua']) lua.lua_pushstring(L, to_luastring(read(f)));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
