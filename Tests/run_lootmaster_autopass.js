// LootMaster/AutoPass.lua: the auto-pass gate, AutoPass:ShouldPass(state, roll). Every combination of its
// checks (each one good or bad) gives false with the first failing check's reason, and true only when all
// hold; a test returns false before anything else; the 90 second heartbeat edge; the gate is pure (it reads
// no global and changes nothing it is given). Usage: node run_lootmaster_autopass.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, gateSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local CRT = { db = { lootmaster = {} } }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
-- the gate is loaded with no globals at all but type: any other global it reads, or any it writes, fails
local reads = {}
local sandbox = setmetatable({ type = type }, {
  __index = function(_, k) reads[#reads + 1] = k error("the gate read the global " .. tostring(k)) end,
  __newindex = function(_, k) error("the gate wrote the global " .. tostring(k)) end,
})
assert(load(gateSrc, "AutoPass.lua", "t", sandbox))("CowfeeRaidTools", CRT)
local AutoPass = LM.AutoPass
check(type(AutoPass) == "table" and type(AutoPass.ShouldPass) == "function", "the gate exists")

local HERE, ELSEWHERE = "2810-16", "2810-15"
local function good()
  local state = {
    test = false, me = "Halo-Sargeras", leader = "Solex-Sargeras", myInstance = HERE, on = true,
    from = "Solex-Sargeras", version = LM.LOOTING_SINCE, yesInstance = HERE, leaderOnline = true,
    leaderInstance = HERE, heartbeatAt = 1000, now = 1030, passed = { [3] = true },
  }
  local roll = { id = 7, test = false, instance = HERE, bossInstance = HERE }
  return state, roll
end

-- Each check, in the gate's order: its reason and how to make it fail.
local CHECKS = {
  { "test", function(s, r) s.test = true end },
  { "test", function(s, r) r.test = true end },
  { "notraid", function(s, r) s.myInstance = nil end },
  { "nogroup", function(s, r) s.leader = nil end },
  { "looter", function(s, r) s.me = "Solex-Sargeras" end },
  { "off", function(s, r) s.on = false end },
  { "notleader", function(s, r) s.from = "Quick-Sargeras" end },
  { "version", function(s, r) s.version = "0.1.0" end },
  { "instance", function(s, r) s.yesInstance = ELSEWHERE end },
  { "offline", function(s, r) s.leaderOnline = false end },
  { "away", function(s, r) s.leaderInstance = ELSEWHERE end },
  { "quiet", function(s, r) s.heartbeatAt = s.now - 91 end },
  { "noroll", function(s, r) r.id = nil end },
  { "once", function(s, r) s.passed[r.id or 7] = true end },
  { "rollplace", function(s, r) r.instance = ELSEWHERE end },
  { "notboss", function(s, r) r.bossInstance = nil end },
}

-- 1. All good: pass
local s, r = good()
local ok, why = AutoPass:ShouldPass(s, r)
eq(ok, true, "all checks hold: pass")
eq(why, "pass", "all checks hold: the reason")
eq(#reads, 0, "no global read")

-- 2. Every combination of the checks: false with the first failing reason, true only with none failing
local n = #CHECKS
local combos, wrong = 0, 0
for mask = 0, 2 ^ n - 1 do
  local st, ro = good()
  local first
  local m = mask
  for i = 1, n do
    if m % 2 == 1 then
      CHECKS[i][2](st, ro)
      first = first or CHECKS[i][1]
    end
    m = math.floor(m / 2)
  end
  local got, reason = AutoPass:ShouldPass(st, ro)
  combos = combos + 1
  if first then
    if got ~= false or reason ~= first then
      wrong = wrong + 1
      if wrong <= 5 then print("FAIL combination " .. mask .. ": got " .. tostring(got) .. " " .. tostring(reason) .. ", want false " .. first) end
    end
  elseif got ~= true then
    wrong = wrong + 1
    print("FAIL combination 0 should pass")
  end
end
eq(combos, 2 ^ n, "every combination tried")
eq(wrong, 0, "every combination gives the right answer and reason")

-- 3. A test returns false first, whatever else is missing, even with no state or no roll
eq(select(2, AutoPass:ShouldPass(nil, { test = true })), "test", "test roll, no state: test")
eq(select(2, AutoPass:ShouldPass({ test = true }, nil)), "test", "test state, no roll: test")
eq((AutoPass:ShouldPass({ test = true }, { test = true })), false, "test: false")
eq(select(2, AutoPass:ShouldPass(nil, nil)), "nostate", "nothing: no state")
eq(select(2, AutoPass:ShouldPass({}, nil)), "notraid", "an empty state fails closed")
s, r = good()
eq(select(2, AutoPass:ShouldPass(s, nil)), "noroll", "no roll")
eq(select(2, AutoPass:ShouldPass(s, "7")), "noroll", "a roll that isn't a table")

-- 4. Values that are only nearly right fail closed
local function reason(edit)
  local st, ro = good()
  edit(st, ro)
  local got, why = AutoPass:ShouldPass(st, ro)
  return got and "pass" or why
end
eq(reason(function(st) st.heartbeatAt = st.now - 90 end), "pass", "heartbeat 90 s ago: still fine")
eq(reason(function(st) st.heartbeatAt = st.now - 90.01 end), "quiet", "heartbeat just over 90 s ago")
eq(reason(function(st) st.heartbeatAt = st.now + 1 end), "quiet", "a heartbeat from the future")
eq(reason(function(st) st.heartbeatAt = nil end), "quiet", "no heartbeat")
eq(reason(function(st) st.now = nil end), "quiet", "no clock")
eq(reason(function(st) st.heartbeatAt = "1000" end), "quiet", "a heartbeat time that isn't a number")
eq(reason(function(st) st.on = "yes" end), "off", "on must be true, not just truthy")
eq(reason(function(st) st.on = nil end), "off", "never heard: off")
eq(reason(function(st) st.leaderOnline = 1 end), "offline", "online must be true")
eq(reason(function(st) st.leaderOnline = nil end), "offline", "online unknown: offline")
eq(reason(function(st) st.version = nil end), "version", "no version")
eq(reason(function(st) st.version = "garbage" end), "version", "an unreadable version")
eq(reason(function(st) st.from = nil end), "notleader", "no sender")
eq(reason(function(st) st.myInstance = 2810 end), "notraid", "an instance that isn't a key")
eq(reason(function(st) st.yesInstance = nil end), "instance", "no instance said Yes for")
eq(reason(function(st) st.leaderInstance = nil end), "away", "the leader's instance unknown")
eq(reason(function(st, ro) ro.id = "7" end), "noroll", "a roll id that isn't a number")
eq(reason(function(st) st.passed = nil end), "pass", "no passed list: none passed yet")
eq(reason(function(st, ro) ro.test = 1 end), "test", "any test mark counts")
eq(reason(function(st, ro) ro.bossInstance = ELSEWHERE end), "notboss", "a boss in another instance")
eq(reason(function(st) st.me = nil end), "pass", "your own name unknown: you aren't the leader")

-- 5. Pure: nothing it is given changes
s, r = good()
local before = {}
for k, v in pairs(s) do before[k] = v end
AutoPass:ShouldPass(s, r)
local same = true
for k, v in pairs(before) do same = same and s[k] == v end
for k in pairs(s) do same = same and before[k] ~= nil end
check(same, "the state is unchanged")
eq(s.passed[7], nil, "the gate doesn't mark the roll passed")
eq(r.id, 7, "the roll is unchanged")
eq(#reads, 0, "still no global read")

-- 6. Ready: the leader's side alone (no roll), the same reasons; every reason has words
s = good()
eq((AutoPass:Ready(s)), true, "ready: all good")
s.on = false
eq(select(2, AutoPass:Ready(s)), "off", "ready: off")
for _, c in ipairs(CHECKS) do
  check(type(AutoPass.WHY[c[1]]) == "string" and AutoPass.WHY[c[1]] ~= "", "words for " .. c[1])
end
check(type(AutoPass.WHY.nostate) == "string" and type(AutoPass.WHY.unheard) == "string", "words for nostate and unheard")
eq(AutoPass.STALE, 90, "heartbeat stale after 90 s")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['LootMaster/Data.lua', 'LootMaster/AutoPass.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
