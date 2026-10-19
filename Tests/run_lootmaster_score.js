// LootMaster/Score.lua: Raider Score from the Late Tracker's saved nights. Usage: node run_lootmaster_score.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, scoreSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local WEEK = 7 * 86400
local NOW = 1790000000
GetTime = function() return 0 end
time = function() return NOW end
geterrorhandler = function() return print end
local history = {}
local Late = { listeners = {} }
function Late.Seconds(night, p) return math.max(0, (p.joinedAt or night.endedAt) - night.startedAt) end
function Late.IsLate(night, p) return Late.Seconds(night, p) > (night.grace or 0) * 60 end
function Late:History() return history end
function Late:OnChange(fn) self.listeners[#self.listeners + 1] = fn end
local CRT = { Late = Late, db = { lootmaster = { score = { show = true, late = 5, per10 = 1, noShow = 15, recover = 5, weeks = 8 } } } }
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
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['LootMaster/Data.lua', 'LootMaster/Score.lua']) lua.lua_pushstring(L, to_luastring(fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : 'error("missing")'));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
