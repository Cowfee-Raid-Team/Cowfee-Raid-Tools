// CRT_Modules/LootMaster/AutoPass.lua: the auto-pass gate, AutoPass:ShouldPass(state, roll). Every combination of its
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
    test = false, me = "Halo-Sargeras", leader = "Solex-Sargeras", myInstance = HERE, finder = false,
    inRaid = true, enableInParty = false, on = true,
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
  { "finder", function(s, r) s.finder = true end },
  { "party", function(s, r) s.inRaid = false end },
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
eq(reason(function(st) st.finder = nil end), "finder", "finder group unknown: refused")
eq(reason(function(st) st.finder = 0 end), "finder", "finder must be exactly false")
eq(reason(function(st) st.inRaid = false st.enableInParty = true end), "pass", "a party with Enable in party on")
eq(reason(function(st) st.inRaid = nil end), "party", "raid unknown: refused")
eq(reason(function(st) st.inRaid = false st.enableInParty = 1 end), "party", "Enable in party must be exactly true")
-- a wipe: the leader outside (no instance), for the instance it said Yes for, within the away window
eq(LM.LOOTING_AWAY, 600, "the away window is 10 minutes")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = 120 end), "pass", "leader outside for 2 minutes")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = 600 end), "pass", "leader outside for exactly 10 minutes")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = 600.5 end), "away", "leader outside for over 10 minutes")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = nil end), "away", "leader outside, time unknown")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = -1 end), "away", "leader outside, a time from the future")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = "5" end), "away", "leader outside, a time that isn't a number")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = 0 / 0 end), "away", "leader outside, a time that is NaN")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = false st.leaderAway = 5 end), "away", "leader outside the Yes raid but not in the open world (a dungeon, delve, battleground): away")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = nil st.leaderAway = 5 end), "away", "leader's place unknown: away")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = 1 st.leaderAway = 5 end), "away", "open world must be exactly true")
eq(reason(function(st) st.leaderInstance = ELSEWHERE st.leaderOpenWorld = true st.leaderAway = 5 end), "away", "leader in another raid instance, whatever else it says: away")
eq(reason(function(st) st.leaderInstance = ELSEWHERE st.leaderAway = 5 end), "away", "leader in another raid instance: away whatever the time")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = 5 st.yesInstance = ELSEWHERE end), "instance", "leader outside, Yes for another instance")
eq(reason(function(st) st.leaderInstance = nil st.leaderOpenWorld = true st.leaderAway = 5 st.myInstance = nil end), "notraid", "leader outside and you outside: you must be in")

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

-- 7. The roll types: the numbers Blizzard's GroupLootFrame.xml buttons send (Pass 0, Need 1, Greed 2,
-- Transmog 4) and the wiki's Disenchant 3
eq(AutoPass.ROLL.pass, 0, "pass is 0")
eq(AutoPass.ROLL.need, 1, "need is 1")
eq(AutoPass.ROLL.greed, 2, "greed is 2")
eq(AutoPass.ROLL.disenchant, 3, "disenchant is 3")
eq(AutoPass.ROLL.transmog, 4, "transmog is 4")
eq(AutoPass.ROLL_NAME[1], "Need", "need's name")
eq(AutoPass.ROLL_NAME[2], "Greed", "greed's name")
eq(AutoPass.ROLL_NAME[4], "Transmog", "transmog's name")

-- 8. LeaderRoll: the raid leader's own roll. Every combination of its checks: false with the first failing
-- reason; with all holding, Need when allowed, else Greed, else Transmog, else false "cant"
local function leaderGood()
  local state = {
    test = false, me = "Solex-Sargeras", leader = "Solex-Sargeras", myInstance = HERE,
    leading = true, leadingInstance = HERE, canLoot = true, rolled = { [3] = { type = 1 } },
  }
  local roll = { id = 7, test = false, instance = HERE, bossInstance = HERE }
  local info = { canNeed = true, canGreed = true, canTransmog = true }
  return state, roll, info
end
local LCHECKS = {
  { "test", function(s, r, i) s.test = true end },
  { "test", function(s, r, i) r.test = true end },
  { "notraid", function(s, r, i) s.myInstance = nil end },
  { "notleader", function(s, r, i) s.me = "Halo-Sargeras" end },
  { "off", function(s, r, i) s.leading = false end },
  { "instance", function(s, r, i) s.leadingInstance = ELSEWHERE end },
  { "authority", function(s, r, i) s.canLoot = false end },
  { "noroll", function(s, r, i) r.id = nil end },
  { "once", function(s, r, i) s.rolled[r.id or 7] = { type = 2 } end },
  { "rollplace", function(s, r, i) r.instance = ELSEWHERE end },
  { "notboss", function(s, r, i) r.bossInstance = nil end },
  { "noinfo", function(s, r, i) return "noinfo" end },
}
local ln = #LCHECKS
local lcombos, lwrong = 0, 0
for mask = 0, 2 ^ ln - 1 do
  local st, ro, inf = leaderGood()
  local first
  local m = mask
  for i = 1, ln do
    if m % 2 == 1 then
      if LCHECKS[i][2](st, ro, inf) == "noinfo" then inf = nil end
      first = first or LCHECKS[i][1]
    end
    m = math.floor(m / 2)
  end
  local got, reason = AutoPass:LeaderRoll(st, ro, inf)
  lcombos = lcombos + 1
  if first then
    if got ~= false or reason ~= first then
      lwrong = lwrong + 1
      if lwrong <= 5 then print("FAIL leader combination " .. mask .. ": got " .. tostring(got) .. " " .. tostring(reason) .. ", want false " .. first) end
    end
  elseif got ~= AutoPass.ROLL.need then
    lwrong = lwrong + 1
    print("FAIL leader combination 0 should roll Need")
  end
end
eq(lcombos, 2 ^ ln, "leader: every combination tried")
eq(lwrong, 0, "leader: every combination gives the right answer and reason")
-- which roll: every mix of canNeed, canGreed and canTransmog
for need = 0, 1 do for greed = 0, 1 do for tmog = 0, 1 do
  local st, ro = leaderGood()
  local inf = { canNeed = need == 1, canGreed = greed == 1, canTransmog = tmog == 1 }
  local want, wantWhy = false, "cant"
  if need == 1 then want, wantWhy = AutoPass.ROLL.need, "need"
  elseif greed == 1 then want, wantWhy = AutoPass.ROLL.greed, "greed"
  elseif tmog == 1 then want, wantWhy = AutoPass.ROLL.transmog, "transmog" end
  local got, why = AutoPass:LeaderRoll(st, ro, inf)
  local label = string.format("leader: need=%d greed=%d transmog=%d", need, greed, tmog)
  eq(got, want, label)
  eq(why, wantWhy, label .. ", the reason")
end end end
-- only exactly true counts as allowed; anything else fails closed
local function lroll(edit)
  local st, ro, inf = leaderGood()
  inf = edit(st, ro, inf) or inf
  local got, why = AutoPass:LeaderRoll(st, ro, inf)
  return got, why
end
eq(select(2, lroll(function(st, ro, inf) inf.canNeed = 1 inf.canGreed = "yes" inf.canTransmog = {} end)), "cant", "leader: allowed must be exactly true")
eq(select(2, lroll(function(st, ro, inf) inf.canNeed = nil inf.canGreed = nil inf.canTransmog = nil end)), "cant", "leader: nothing allowed")
eq(select(2, lroll(function(st, ro, inf) return "x" end)), "noinfo", "leader: info that isn't a table")
eq(select(2, lroll(function(st) st.me = nil end)), "notleader", "leader: your name unknown")
eq(select(2, lroll(function(st) st.leader = nil end)), "notleader", "leader: no leader (not in a group)")
eq(select(2, lroll(function(st) st.leading = "yes" end)), "off", "leader: on must be exactly true")
eq(select(2, lroll(function(st) st.leadingInstance = nil end)), "instance", "leader: no Yes instance")
eq(select(2, lroll(function(st) st.canLoot = nil end)), "authority", "leader: loot authority unknown: refused")
eq(select(2, lroll(function(st) st.canLoot = 1 end)), "authority", "leader: loot authority must be exactly true")
eq(select(2, lroll(function(st) st.rolled = nil end)), "need", "leader: no rolled list: none rolled yet")
eq(select(2, lroll(function(st, ro) ro.id = "7" end)), "noroll", "leader: a roll id that isn't a number")
eq(select(2, AutoPass:LeaderRoll(nil, nil, nil)), "nostate", "leader: nothing: no state")
eq(select(2, AutoPass:LeaderRoll(nil, { test = true }, nil)), "test", "leader: a test roll before anything")
-- pure: nothing it is given changes
local st, ro, inf = leaderGood()
AutoPass:LeaderRoll(st, ro, inf)
eq(st.rolled[7], nil, "leader: the gate doesn't mark the roll rolled")
eq(#reads, 0, "leader: no global read")
for _, c in ipairs(LCHECKS) do
  check(type(AutoPass.LEADER_WHY[c[1]]) == "string" and AutoPass.LEADER_WHY[c[1]] ~= "", "leader words for " .. c[1])
end
check(type(AutoPass.LEADER_WHY.cant) == "string", "leader words for cant")
eq(AutoPass.CLOSE_SECONDS, 3, "the game gets 3 s to close a roll; a confirm later than that isn't answered")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/AutoPass.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
