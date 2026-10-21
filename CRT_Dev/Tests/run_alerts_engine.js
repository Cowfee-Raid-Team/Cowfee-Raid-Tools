// CRT_Modules/Alerts/Engine.lua: blocks, run start/stop, phase clock, timed lines, listeners.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local rulesSrc, engineSrc = ...
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
local clock = 100
function GetTime() return clock end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
local function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local function defaults() return { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
  reminders = {}, phases = {}, overrides = {}, nextId = 1 } end
local CRT = { db = { alerts = defaults() } }
assert(load(rulesSrc, "CRT_Modules/Alerts/Rules.lua"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "CRT_Modules/Alerts/Engine.lua"))("CowfeeRaidTools", CRT)
local A = CRT.Alerts
assert(A and type(A.HandleEvent) == "function", "Alerts and HandleEvent exist")
local H = A.HandleEvent

local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 21, hold = 0, warn = 0,
    outputs = { alert = true, bar = true, speech = false } }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local blockItems = {}
A:RegisterBlock("test", { label = "Test", group = false, Entries = function(run) return blockItems end })
local function fresh(items)
  A:Stop()
  blockItems = items or {}
  clock = 100
  wipe(errors)
end

-- first phase starts at the pull
fresh({ item{ id = "a" } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(A.running and A.runId >= 1 and A.run.encounterID == 3001 and A.run.difficultyName == "Mythic" and A.run.reason == "encounter")
assert(A:PhaseStart(1) == clock and A:CurrentPhase() == 1, "phase 1 at pull")
clock = 107; assert(A:Elapsed() == 7)
print("ok start: first phase starts at pull")

-- next phase in order
fresh({ item{ id = "a", ph = 1 }, item{ id = "b", ph = 1.5 }, item{ id = "c", ph = 2 } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(A:NextPhase() == 1.5 and A:NextPhase() == 2 and A:NextPhase() == nil)
print("ok phase: next phase in order")

-- repeat start ignored
fresh({ item{ id = "a", ph = 1 }, item{ id = "c", ph = 2 } })
H("ENCOUNTER_START", 3001, "Boss", 16)
clock = 120
assert(A:StartPhase(2, "event") == true)
clock = 130
assert(A:StartPhase(2, "event") == false and A:PhaseStart(2) == 120)
print("ok phase: repeat start ignored")

-- later start skips earlier
fresh({ item{ id = "a", ph = 1 }, item{ id = "b", ph = 1.5, text = "B" }, item{ id = "c", ph = 2, text = "C" } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(A:StartPhase(2) == true)
assert(A:Skipped(1.5) and not A:Skipped(1) and not A:Skipped(2))
for _, l in ipairs(A:Lines(100)) do assert(l.text ~= "B", "skipped phase item in lines") end
assert(A:NextPhase() == nil)
print("ok phase: later start skips earlier")

-- lines timed from the phase start; speech offsets
fresh({ item{ id = "a", ph = 2, time = 30, text = "A", outputs = { speech = true },
  speech = { { offset = 5, text = "soon" } } } })
H("ENCOUNTER_START", 3001, "Boss", 16)
clock = 100; A:StartPhase(2)
local ls = A:Lines(100)
assert(#ls == 1 and ls[1].at == 130 and ls[1].block == "test", tostring(ls[1] and ls[1].at))
assert(ls[1].speech[1].at == 125 and ls[1].speech[1].text == "soon")
assert(blockItems[1].at == nil, "item not mutated")
print("ok lines: timed from phase start")

-- items of a phase not yet started are left out
fresh({ item{ id = "a", ph = 1, time = 5 }, item{ id = "b", ph = 3, time = 5 } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(#A:Lines(100) == 1)
print("ok lines: unstarted phase left out")

-- end stops encounter run only
fresh({})
A:Start(3001, "Normal", "test")
H("ENCOUNTER_END", 3001)
assert(A.running, "test run survives")
H("ENCOUNTER_START", 3002, "Boss", 16)
H("ENCOUNTER_END", 3002)
assert(not A.running and #A:Lines(100) == 0)
print("ok end stops encounter run only")

-- profile reset mid-pull
fresh({ item{ id = "a", time = 3 } })
H("ENCOUNTER_START", 3001, "Boss", 16)
CRT.db.alerts = defaults()
assert(A:Settings() == CRT.db.alerts)
assert(#A:Lines(100) == 1 and A.running)
print("ok profile reset mid-pull keeps running")

-- listeners
fresh({})
local called = 0
A:OnChange(function() error("boom") end)
A:OnChange(function() called = called + 1 end)
A:Fire()
assert(called == 1 and #errors == 1 and tostring(errors[1]):find("boom"), "listener error reported")
table.remove(A.listeners); table.remove(A.listeners)
print("ok failing listener does not stop others")

-- failing block
fresh({ item{ id = "a" } })
A:RegisterBlock("bad", { label = "Bad", group = false, Entries = function() error("nope") end })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(#A:Lines(100) == 1 and #errors == 1 and tostring(errors[1]):find("nope"), "block error reported")
print("ok failing block does not stop others")

-- onPull hooks, starting flag, opts
fresh({ item{ id = "a" } })
local seen, startingSeen
A.onPull[#A.onPull + 1] = function(run) seen = run; startingSeen = A.starting end
A.onPull[#A.onPull + 1] = function() error("hook") end
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(seen == A.run and startingSeen == true and A.starting == false and (function() for _, e in ipairs(errors) do if tostring(e):find("hook") then return true end end end)(), "hook error reported")
seen = nil
A:Start(1, "x", "test")
assert(seen == nil, "hooks only for encounter")
A:Start(1, "x", "test", { blocks = { other = true } })
assert(#A:Lines(100) == 0)
blockItems = { item{ id = "a" }, item{ id = "b" } }
A:Start(1, "x", "test", { filter = function(key, it) return it.id == "b" end })
assert(#A:Lines(100) == 1 and A:Lines(100)[1].id == "b")
local r1 = A.runId; A:Start(1, "x", "test"); assert(A.runId == r1 + 1)
print("ok start: hooks, starting flag, opts")

-- skipped phase never starts
fresh({ item{ id = "a", ph = 1 }, item{ id = "b", ph = 1.5, text = "B" }, item{ id = "c", ph = 2 } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(A:StartPhase(2) == true and A:Skipped(1.5))
assert(A:StartPhase(1.5) == false and A:PhaseStart(1.5) == nil and A:Skipped(1.5))
for _, l in ipairs(A:Lines(100)) do assert(l.text ~= "B", "skipped item in lines") end
print("ok phase: skipped phase never starts")

-- non-table item and starting reset
fresh({ 5, "str", item{ id = "a" } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(#A:Lines(100) == 1 and A.starting == false)
A.phaseSources[#A.phaseSources + 1] = function() error("src") end
A:Start(1, "x", "test")
assert(A.starting == false and A.running)
table.remove(A.phaseSources)
print("ok start: non-table item is skipped and starting resets")

-- phasesFor
A:Stop()
blockItems = { item{ ph = 2 }, item{ ph = 1.5 } }
A.phaseSources[#A.phaseSources + 1] = function(run) return { 3 } end
local ph = A:PhasesFor({ encounterID = 1 })
assert(#ph == 3 and ph[1] == 1.5 and ph[2] == 2 and ph[3] == 3 and not A.running, table.concat(ph, ","))
table.remove(A.phaseSources)
blockItems = {}
ph = A:PhasesFor({ encounterID = 1 })
assert(#ph == 1 and ph[1] == 1, "1 when nothing names a phase")
print("ok phasesFor: works without a run")

-- a triggered lowest phase waits for its trigger
fresh({ item{ id = "a", ph = 2, time = 10, text = "A" } })
A.phaseSources[#A.phaseSources + 1] = function(run) return { 2 } end
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(A:Phases()[1] == 1 and #A:Phases() == 2, "phase 1 added: " .. table.concat(A:Phases(), ","))
assert(A:PhaseStart(1) == 100 and A:PhaseStart(2) == nil and A:CurrentPhase() == 1, "pull is phase 1")
clock = 115
assert(#A:Lines(100) == 0 and A:PhaseStart(2) == nil, "phase 2 reminder does not fire without its trigger")
assert(A:StartPhase(2, "event") and A:PhaseStart(2) == 115)
table.remove(A.phaseSources)
print("ok start: triggered lowest phase waits for its trigger")

-- lowest phase starts at the pull
fresh({ item{ id = "a", ph = 2, time = 5, text = "A" }, item{ id = "b", ph = 3, time = 5, text = "B" } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(A:PhaseStart(2) == 100 and A:CurrentPhase() == 2 and A:PhaseStart(1) == nil and not A:Skipped(1), "phase 2 at pull")
assert(#A:Phases() == 2 and A:Phases()[1] == 2, "no phase 1 seeded")
local ls2 = A:Lines(100)
assert(#ls2 == 1 and ls2[1].text == "A" and ls2[1].at == 105)
clock = 107; assert(A:Elapsed() == 7)
assert(A:NextPhase() == 3 and A:NextPhase() == nil)
fresh({})
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(A:PhaseStart(1) == 100 and A:CurrentPhase() == 1, "empty run starts phase 1")
print("ok start: lowest phase starts at pull")

-- opts.firstAt
fresh({ item{ id = "a", ph = 1, time = 30, text = "A" } })
A:Start(3001, nil, "test", { firstAt = 90 })
assert(A:PhaseStart(1) == 90 and A:Elapsed() == 10, "firstAt sets the first phase start")
assert(A:Lines(100)[1].at == 120, "lines count from firstAt")
A:Start(3001, nil, "test")
assert(A:PhaseStart(1) == 100, "default is now")
print("ok start: firstAt sets the first phase start")

-- lines are cached until something changes
fresh({ item{ id = "a", ph = 1, time = 3, text = "A" }, item{ id = "b", ph = 2, time = 5, text = "B" } })
H("ENCOUNTER_START", 3001, "Boss", 16)
local c1 = A:Lines(100)
clock = 103
local c2 = A:Lines(103)
assert(c1 == c2, "two calls without a change return the same table")
assert(#c1 == 1 and c1[1].text == "A")
print("ok lines: cached between changes")
clock = 104
A:StartPhase(2, "event")
local c3 = A:Lines(104)
assert(c3 ~= c1 and #c3 == 2, "StartPhase invalidates the cached lines")
assert(A:Lines(104) == c3, "cached again after the rebuild")
A:Stop()
assert(#A:Lines(104) == 0, "nothing after stop")
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(A:Lines(100) ~= c3, "a new start rebuilds")
print("ok lines: StartPhase, Stop and Start invalidate")

-- items with no output never become lines
local noOut = item{ id = "x", time = 5, text = "X" }
noOut.outputs = nil
fresh({ item{ id = "a", time = 5, text = "A" }, noOut,
  item{ id = "y", time = 6, text = "Y", outputs = { alert = false, bar = false, speech = false } } })
H("ENCOUNTER_START", 3001, "Boss", 16)
local ls3 = A:Lines(100)
assert(#ls3 == 1 and ls3[1].text == "A", "only the item that shows: " .. #ls3)
assert(#A.items == 3, "the run still holds every item")
print("ok lines: items with no output dropped")

-- PeekNextPhase names the next phase without starting it
fresh({ item{ id = "a", ph = 1 }, item{ id = "b", ph = 1.5 }, item{ id = "c", ph = 2 } })
assert(A:PeekNextPhase() == nil, "nothing running")
H("ENCOUNTER_START", 3001, "Boss", 16)
local v = A.version
assert(A:PeekNextPhase() == 1.5 and A:PeekNextPhase() == 1.5, "peek is stable")
assert(A:PhaseStart(1.5) == nil and A.version == v, "peek starts nothing")
assert(A:NextPhase() == 1.5 and A:PeekNextPhase() == 2)
assert(A:NextPhase() == 2 and A:PeekNextPhase() == nil)
print("ok phase: PeekNextPhase has no side effects")

-- the phase mask: once phase 2 starts, phase 1 items timed at or after it drop; earlier ones stay
fresh({ item{ id = "early", ph = 1, time = 50, text = "E" }, item{ id = "late", ph = 1, time = 70, text = "L" },
  item{ id = "edge", ph = 1, time = 60, text = "G" }, item{ id = "p2", ph = 2, time = 5, text = "P" } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(#A:Lines(100) == 3, "before phase 2 every phase 1 line is there")
assert(A:PhaseCut(1) == nil and not A:IsCut(1, 70))
clock = 160; A:StartPhase(2)
local texts = {}
for _, l in ipairs(A:Lines(160)) do texts[l.text] = true end
assert(texts.E and texts.P and not texts.L and not texts.G, "phase 1 lines at or after phase 2's start drop")
assert(A:PhaseCut(1) == 160 and A:PhaseCut(2) == nil and A:IsCut(1, 60) and not A:IsCut(1, 59.9))
assert(#A.items == 4, "nothing deleted from the run")
print("ok mask: a later phase cuts an earlier phase's lines")

-- the mask follows the earliest later phase, and the next pull starts clean
fresh({ item{ id = "late", ph = 1, time = 70, text = "L" }, item{ id = "i", ph = 1.5, time = 45, text = "I" },
  item{ id = "p2", ph = 2, time = 1, text = "P" } })
H("ENCOUNTER_START", 3001, "Boss", 16)
clock = 140; A:StartPhase(1.5)
clock = 180; A:StartPhase(2)
local t2 = {}
for _, l in ipairs(A:Lines(180)) do t2[l.text] = true end
assert(not t2.L and not t2.I and t2.P, "1 cut at 1.5's start, 1.5 cut at 2's start")
fresh({ item{ id = "late", ph = 1, time = 70, text = "L" } })
H("ENCOUNTER_START", 3001, "Boss", 16)
assert(#A:Lines(100) == 1, "a new pull has no mask")
print("ok mask: earliest later phase; a new pull starts clean")

-- the chosen order: a part's phase 1 line moves with it, or never comes past its new window
do
  local asked
  CRT.Timeline = {
    GroupFor = function(_, name) return name and name:lower():find("mythic") and "mythic" or "nh" end,
    -- as CRT_Modules/Timeline/Data.lua's: by the difficulty's ID (16 is Mythic), else by its name
    GroupOf = function(self, id, name)
      if type(id) == "number" then return id == 16 and "mythic" or "nh" end
      return name and self:GroupFor(name) or nil
    end,
    OrderShift = function(_, eid, group)
      asked = eid .. "/" .. tostring(group)
      if eid ~= 3497 then return nil end
      return function(spellID, text, t)
        if spellID == 777 then return t + 100 end
        if text == "Gone" then return false end
        return t
      end
    end,
  }
  fresh({ item{ id = "m", ph = 1, time = 20, spellID = 777, text = "Moved" }, item{ id = "g", ph = 1, time = 30, text = "Gone" },
    item{ id = "k", ph = 1, time = 40, text = "Kept" }, item{ id = "p2", ph = 2, time = 5, spellID = 777, text = "P2" } })
  H("ENCOUNTER_START", 3497, "Boss", 16)
  assert(asked == "3497/mythic", "asked for the run's boss and group: " .. tostring(asked))
  local byText = {}
  for _, it in ipairs(A.items) do byText[it.text] = it end
  assert(byText.Moved.time == 120, "a part's line moves: " .. tostring(byText.Moved.time))
  assert(byText.Gone == nil, "past its new window it never comes")
  assert(byText.Kept.time == 40 and byText.P2.time == 5, "other lines and later phases keep their time")
  assert(blockItems[1].time == 20, "the block's own line is not rewritten")
  assert(A:OrderTime(777, "x", 1, 10) == 110 and A:OrderTime(777, "x", 2, 10) == 10)
  fresh({ item{ id = "m", ph = 1, time = 20, spellID = 777, text = "Moved" } })
  H("ENCOUNTER_START", 3001, "Boss", 16)
  assert(A.items[1].time == 20, "a boss with no order moves nothing")
  CRT.Timeline.OrderShift = function() error("broken") end
  fresh({ item{ id = "m", ph = 1, time = 20, spellID = 777, text = "Moved" } })
  H("ENCOUNTER_START", 3497, "Boss", 16)
  for _, e in ipairs(errors) do assert(not tostring(e):find("broken"), "order error escaped: " .. tostring(e)) end
  assert(A.items[1].time == 20, "a failing order lookup moves nothing")
  CRT.Timeline = nil
end
print("ok order: a part's lines follow the chosen order")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2], 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[3], 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
