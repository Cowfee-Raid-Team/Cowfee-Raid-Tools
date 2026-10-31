// CRT_Modules/Pace/Display.lua: each pace bar's name. Best first: the unit's name when it reads; a hidden (secret)
// name passed straight to the label's SetText, never compared; the name remembered from when it last read (at the
// pull, a boss unit engaging, or an earlier update), kept per encounter for the session; on a plan with one boss
// unit, the boss's name from the boss library; then the unit token. And the preview's bar takes the Pace page's
// boss's name. On mock frames, with CRT_Modules/Pace/Data.lua loaded for the plans. Secret values are proxies that
// raise an error on any use the game forbids (arithmetic, comparison, indexing, concatenation, calling, tostring).
// Usage: node run_pace_display.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const harness = `
local DATA, DISPLAY, PAGE = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
format = string.format

local SECRET = {}
local function forbidden() error("used a secret value") end
for _, k in ipairs({ "__index", "__newindex", "__len", "__concat", "__lt", "__le", "__eq", "__add", "__sub", "__mul", "__div", "__unm", "__call", "__tostring" }) do SECRET[k] = forbidden end
local function secret(v) return setmetatable({ inner = v }, SECRET) end
function issecretvalue(v) return getmetatable(v) == SECRET end
local realType = type
function type(v) if getmetatable(v) == SECRET then return realType(rawget(v, "inner")) end return realType(v) end

-- frames that remember what is done to them
local frames = {}
local labelRefusesSecrets = false -- an older client: SetText errors on a secret
local function region(kind, parent, name)
  local r = { kind = kind, parent = parent, name = name, shown = true, scripts = {}, events = {} }
  frames[#frames + 1] = r
  function r:Show() self.shown = true end
  function r:Hide() self.shown = false end
  function r:SetShown(v) self.shown = v and true or false end
  function r:IsShown() return self.shown end
  function r:SetScript(k, fn) self.scripts[k] = fn end
  function r:RegisterEvent(e) self.events[e] = true end
  function r:SetText(t)
    if labelRefusesSecrets and issecretvalue(t) then error("secret text refused") end
    self.text = t
  end
  function r:SetAlpha(a) self.alpha = a end
  function r:SetValue(v) self.value = v end
  function r:CreateTexture() return region("Texture", self) end
  function r:CreateFontString() return region("FontString", self) end
  return setmetatable(r, { __index = function(_, k) if realType(k) == "string" and k:match("^%u") then return function() end end end })
end
UIParent = region("Frame")
function CreateFrame(kind, name, parent) local f = region(kind, parent, name) if name then _G[name] = f end return f end
local clock = 100
function GetTime() return clock end
function time() return 1792540800 end
function InCombatLockdown() return false end
UNKNOWNOBJECT = "Unknown"

-- the boss units
local units = {} -- [unit] = name (a string, a secret proxy, or false for a unit that isn't there)
function UnitExists(u) return units[u] ~= nil and units[u] ~= false end
function UnitName(u) local n = units[u] if n == false then return nil end return n end
function UnitHealthPercent() return 50 end

-- a stand-in CRT
local previews = {}
local CRT = { db = { pace = { shared = {}, own = {}, use = {}, disabled = {} } }, PaceDB = { bosses = {} } }
local UI = {}
CRT.UI = UI
function UI:RegisterPreview(key, fn) previews[key] = fn end
function UI:RegisterThemed() end
function UI:RegisterLayer() end
function UI.ThemedText() end
function UI.GoodText(t) return t end
function UI.BadText(t) return t end
function UI.ResetButton(parent) return region("Button", parent) end
UI.Placement = { Define = function() return { Attach = function() end, Reset = function() end } end, FitHandle = function() end }
local defs = {
  [1001] = { encounterID = 1001, name = "The Twin Fangs" },
  [1002] = { encounterID = 1002, name = "Lone Boss" },
  [1003] = { encounterID = 1003, name = "Another Lone Boss" },
}
CRT.Bosses = { Get = function(_, id) return defs[id] end }
local TWO = { mode = "time", rows = { { ph = 1, t = 60, unit = "boss1", hp = 50 }, { ph = 1, t = 60, unit = "boss2", hp = 50 } } }
local ONE = { mode = "time", rows = { { ph = 1, t = 60, unit = "boss1", hp = 50 } } }
CRT.PaceDB.bosses[1001] = TWO
CRT.PaceDB.bosses[1002] = ONE
CRT.PaceDB.bosses[1003] = ONE

assert(load(DATA, "Data"))("CowfeeRaidTools", CRT)
assert(load(DISPLAY, "Display"))("CowfeeRaidTools", CRT)
local Pace = CRT.Pace

local function fire(event, ...)
  for _, f in ipairs(frames) do
    if f.events[event] and f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
  end
end
local function tick()
  local w = _G.CowfeeRaidToolsPace
  w.scripts.OnUpdate(w, 1)
end
-- the bars' labels, in order: the window's rows are the frames made on it with a label
local function label(i)
  local n = 0
  for _, f in ipairs(frames) do
    if f.parent == _G.CowfeeRaidToolsPace and f.label then
      n = n + 1
      if n == i then return f.label.text end
    end
  end
end

-- a readable name
units = { boss1 = "Vexhul", boss2 = "Ithraz" }
local ok, err = pcall(fire, "ENCOUNTER_START", 1001, "The Twin Fangs", 16, 20)
check(ok, "the pull starts with no error: " .. tostring(err))
ok, err = pcall(tick)
check(ok, "an update runs with no error: " .. tostring(err))
check(label(1) == "Vexhul" and label(2) == "Ithraz", "a readable name names the bar: " .. tostring(label(1)) .. ", " .. tostring(label(2)))

-- a secret name goes to SetText as it is, never compared
local hidden = secret("Vexhul")
units.boss1 = hidden
ok, err = pcall(tick)
check(ok, "a secret name raises no error (never compared): " .. tostring(err))
check(rawequal(label(1), hidden), "a secret name is passed straight to the label")

-- the name remembered from when it last read: the secret refused by the label, or the unit gone
labelRefusesSecrets = true
ok, err = pcall(tick)
check(ok, "a label that refuses the secret raises no error: " .. tostring(err))
check(label(1) == "Vexhul", "then the name remembered from when it read: " .. tostring(label(1)))
labelRefusesSecrets = false
units.boss2 = false
tick()
check(label(2) == "Ithraz", "a boss unit gone: still its remembered name: " .. tostring(label(2)))
fire("ENCOUNTER_END", 1001)
-- the next pull of the same boss, the names hidden from the start: remembered for the session
units = { boss1 = false, boss2 = false }
fire("ENCOUNTER_START", 1001, "The Twin Fangs", 16, 20)
tick()
check(label(1) == "Vexhul" and label(2) == "Ithraz", "the next pull of the boss keeps the names for the session: " .. tostring(label(1)) .. ", " .. tostring(label(2)))
fire("ENCOUNTER_END", 1001)

-- remembered at the pull and when a boss unit engages, before any update
units = { boss1 = "Solo", boss2 = false }
fire("ENCOUNTER_START", 1003, "Another Lone Boss", 16, 20)
units.boss1 = secret("Solo")
labelRefusesSecrets = true
tick()
check(label(1) == "Solo", "a name that read at the pull is remembered: " .. tostring(label(1)))
labelRefusesSecrets = false
fire("ENCOUNTER_END", 1003)
CRT.PaceDB.bosses[1003] = TWO
units = { boss1 = false, boss2 = false }
fire("ENCOUNTER_START", 1003, "Another Lone Boss", 16, 20)
units.boss2 = "Late Add"
fire("INSTANCE_ENCOUNTER_ENGAGE_UNIT")
units.boss2 = secret("Late Add")
labelRefusesSecrets = true
tick()
check(label(2) == "Late Add", "a name that read when its unit engaged is remembered: " .. tostring(label(2)))
labelRefusesSecrets = false
fire("ENCOUNTER_END", 1003)

-- the game's placeholder for a unit not loaded yet is never remembered
units = { boss1 = "Unknown" }
fire("ENCOUNTER_START", 1002, "Lone Boss", 16, 20)
units.boss1 = false
tick()
check(label(1) == "Lone Boss", "the game's Unknown is not remembered: " .. tostring(label(1)))
fire("ENCOUNTER_END", 1002)

-- a plan with one boss unit: the boss's name from the boss library
CRT.PaceDB.bosses[1002] = ONE
units = { boss1 = false }
fire("ENCOUNTER_START", 1002, "Lone Boss", 16, 20)
tick()
check(label(1) == "Lone Boss", "one boss unit, no name yet: the boss's name: " .. tostring(label(1)))
fire("ENCOUNTER_END", 1002)

-- then the unit token: two boss units, no name ever read, no boss file
CRT.PaceDB.bosses[1004] = TWO
units = { boss1 = false, boss2 = false }
fire("ENCOUNTER_START", 1004, "Unfiled", 16, 20)
tick()
check(label(1) == "boss1" and label(2) == "boss2", "no name at all: the unit token: " .. tostring(label(1)) .. ", " .. tostring(label(2)))
fire("ENCOUNTER_END", 1004)
CRT.PaceDB.bosses[1005] = ONE
fire("ENCOUNTER_START", 1005, "Unfiled", 16, 20)
tick()
check(label(1) == "boss1", "one boss unit with no boss file: the unit token: " .. tostring(label(1)))
fire("ENCOUNTER_END", 1005)

-- the preview: the Pace page's boss's name
check(PAGE:find("function Pace:PageBoss", 1, true) ~= nil, "the Pace page tells which boss it shows (Pace:PageBoss)")
local pageBoss = 1002
Pace.PageBoss = function() return pageBoss end
previews.pace(true)
check(label(1) == "Lone Boss", "the preview's bar takes the page's boss's name: " .. tostring(label(1)))
previews.pace(false)
pageBoss = 9999
previews.pace(true)
check(label(1) == "Boss", "a page boss with no boss file: Boss: " .. tostring(label(1)))
previews.pace(false)
Pace.PageBoss = nil
previews.pace(true)
check(label(1) == "Boss", "no page boss: Boss: " .. tostring(label(1)))
previews.pace(false)

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " pace display checks failed") end
`;

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Pace/Data.lua', 'CRT_Modules/Pace/Display.lua', 'CRT_Modules/Pace/Page.lua']) lua.lua_pushstring(L, to_luastring(read(f)));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
console.log('ok pace display: bar names, readable, secret, remembered, one boss, unit, and the preview');
