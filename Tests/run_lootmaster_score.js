// LootMaster/Score.lua: Raider Score from the Late Tracker's saved nights. Usage: node run_lootmaster_score.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, scoreSrc, lateSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local WEEK = 7 * 86400
local NOW = 1790000000
GetTime = function() return 0 end
time = function() return NOW end
geterrorhandler = function() return print end
-- The real Late Tracker (Late/Data.lua), so the score reads nights through the tracker's own rule.
date = os.date
format = string.format
function IsInGroup() return false end
Ambiguate = function(k) return k end
C_Timer = { After = function() end, NewTicker = function() end }
function CreateFrame() return { RegisterEvent = function() end, SetScript = function() end } end
local history = {}
local roster = {}
local layout = { id = 1, name = "Main Raid", slots = {} }
for i = 1, 40 do layout.slots[i] = "" end
local CRT = { db = {
  late = { days = {}, hour = 20, minute = 0, grace = 10, history = history, nextId = 1, lastAuto = "", layoutId = 1 },
  lootmaster = { score = { show = true, late = 5, per10 = 1, noShow = 15, recover = 5, weeks = 8 } } } }
function CRT:Print() end
CRT.Groups = { NUM_SLOTS = 40, Find = function(_, id) return id == 1 and layout or nil end, Active = function() return CRT.db.late.layoutId end,
  ReadRoster = function() local out = {} for _, k in ipairs(roster) do out[#out+1] = { key = k } end return out end,
  OnChange = function() end, Normalize = function(k) return k end,
  MakeLookup = function(r) local m = {} for _, e in ipairs(r) do m[e.key:lower()] = e end return function(k) return m[k:lower()] end end }
assert(load(lateSrc, "Late/Data.lua"))("CowfeeRaidTools", CRT)
local Late = CRT.Late
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(scoreSrc, "Score.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
local function night(weeksAgo, players)
  local start = NOW - weeksAgo * WEEK
  local n = { startedAt = start, endedAt = start + 3 * 3600, grace = 0, players = {} }
  for _, p in ipairs(players) do
    n.players[#n.players + 1] = { key = p[1], joinedAt = p[2] and (start + p[2] * 60) or (p[3] and start or nil), never = p[2] == nil and not p[3] or nil }
  end
  history[#history + 1] = n
end
-- { name, minutes late } ; { name, nil, true } on time ; { name } never came
night(0, { { "Solex-Sargeras", nil, true }, { "Quick-Sargeras", 25 }, { "Arrow-Sargeras" } })
night(2, { { "Solex-Sargeras", nil, true }, { "Arrow-Sargeras" } })
night(10, { { "Halo-Sargeras" } }) -- older than the 8 weeks counted

eq(LM.Score("Solex-Sargeras"), 100, "always on time")
-- Quick: 5 + 1 * floor(25 / 10) = 7 this week, nothing back yet
eq(LM.Score("Quick-Sargeras"), 93, "late 25 minutes this week")
-- Arrow: 15 this week, plus 15 - 2 weeks * 5 = 5 from two weeks ago
eq(LM.Score("Arrow-Sargeras"), 80, "two no-shows, one partly recovered")
eq(LM.Score("arrow-sargeras"), 80, "names match without case")
eq(LM.Score("Halo-Sargeras"), nil, "only nights in the window count")
eq(LM.Score("Nobody-Sargeras"), nil, "no nights, no score")
local d = LM.ScoreDetails("Arrow-Sargeras")
eq(d and d.nights, 2, "nights expected")
eq(d and d.never, 2, "no-shows")
eq(d and d.late, 0, "late (not counting no-shows)")

-- settings change the result, and turning it off hides it
CRT.db.lootmaster.score.noShow = 25
LM.ScoreChanged()
eq(LM.Score("Arrow-Sargeras"), 60, "a bigger no-show penalty: 25 + 15")
CRT.db.lootmaster.score.show = false
LM.ScoreChanged()
eq(LM.Score("Arrow-Sargeras"), nil, "off: no score")
CRT.db.lootmaster.score.show = true
CRT.db.lootmaster.score.noShow = 15

-- a new night is picked up when the Late Tracker says it changed
night(0, { { "Solex-Sargeras" } })
for _, fn in ipairs(Late.listeners) do fn() end
eq(LM.Score("Solex-Sargeras"), 85, "the new night counts")
check(#LM.ScoreList() >= 3, "a list for the Raider Score tab")
eq(LM.ScoreList()[1].score <= LM.ScoreList()[#LM.ScoreList()].score, true, "lowest first")

-- The Late Tracker decides on time, late and no-show; the score follows it exactly.
local function finish(start, stop)
  NOW = stop
  Late:End("button", stop)
  for _, fn in ipairs(Late.listeners) do fn() end
end
local function totals()
  local out = {} for _, t in ipairs(Late:Totals()) do out[t.key:lower()] = t end return out
end
-- A test night started at 17:33 and ended at 17:34 with a 10 minute grace: twenty expected players,
-- none of them seen in your group (a test on your own), so the tracker records that they never joined.
local raiders = {}
for i = 1, 20 do raiders[i] = "Raider" .. i .. "-Sargeras" layout.slots[i] = raiders[i] end
local start = NOW + 3600
NOW = start
roster = {}
check(Late:Start("button", start), "the test night starts")
finish(start, start + 60)
local night = history[#history]
eq(night.players[1].never, true, "saved data: never joined")
local tt = totals()
for i, key in ipairs(raiders) do
  eq(Late.Status(night, night.players[i]), "ontime", key .. ": the tracker counts on time")
  eq(tt[key:lower()].never, 0, key .. ": no no-show in the tracker's totals")
  eq(LM.Score(key), 100, key .. ": no no-show in the score")
  eq(LM.ScoreDetails(key).never, 0, key .. ": no-show count")
end
-- A real night past the grace: Raider1 joins on time, Raider2 25 minutes late, Raider3 never comes.
for i = 4, 40 do layout.slots[i] = "" end
start = NOW + 3600
NOW = start
roster = { "Raider1-Sargeras" }
Late:Start("button", start)
NOW = start + 25 * 60
roster = { "Raider1-Sargeras", "Raider2-Sargeras" }
Late:Scan(NOW)
finish(start, start + 2 * 3600)
night = history[#history]
eq(Late.Status(night, night.players[1]), "ontime", "joined at the start")
eq(Late.Status(night, night.players[2]), "late", "joined after the grace")
eq(Late.Status(night, night.players[3]), "noshow", "never joined, the night ran past the grace")
tt = totals()
eq(LM.Score("Raider1-Sargeras"), 100, "on time: no penalty")
eq(LM.Score("Raider2-Sargeras"), 93, "late 25 minutes: 5 + 2")
eq(LM.Score("Raider3-Sargeras"), 85, "a real no-show")
eq(tt["raider3-sargeras"].never, 1, "the tracker counts the no-show too")
eq(LM.ScoreDetails("Raider3-Sargeras").never, 1, "the score counts it once")
-- late counts and minutes agree: the tracker's Late column includes no-shows, the score's does not
for _, key in ipairs({ "Raider1-Sargeras", "Raider2-Sargeras", "Raider3-Sargeras" }) do
  local t, d = tt[key:lower()], LM.ScoreDetails(key)
  eq(d.late, t.late - t.never, key .. ": late nights agree")
  eq(d.never, t.never, key .. ": no-shows agree")
end
eq(tt["raider2-sargeras"].seconds, 25 * 60, "the tracker's minutes late")
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['LootMaster/Data.lua', 'LootMaster/Score.lua', 'Late/Data.lua']) lua.lua_pushstring(L, to_luastring(fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : 'error("missing")'));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
