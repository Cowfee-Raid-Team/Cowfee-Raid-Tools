// CRT_Modules/Alerts/Absorb.lua and the shield bar's draw in CRT_Modules/Alerts/Bars.lua, with mock frames: a special
// alert's absorb starts its bar on the first UNIT_ABSORB_AMOUNT_CHANGED inside its cast's window (or, untimed, on the
// first one at all), the fill and amount take the shield's secret readings only through StatusBar:SetMinMaxValues,
// SetValue and AbbreviateNumbers then SetText, the tick runs right to left over its length, the colour never changes,
// and the bar ends at its length, the encounter's end and when its window closes. Secret values are proxies that raise
// an error on any use the game forbids (arithmetic, comparison, indexing, length, concatenation, tostring).
// Usage: node run_alerts_absorb.js <addon folder>
const fs = require('fs');
const themeLua = require('./theme_stub');
const placementLua = require('./placement_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const d = process.argv[2];
const FILES = ['CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Areas.lua', 'CRT_Modules/Alerts/Bars.lua',
  'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Alerts/Colors.lua', 'CRT_Modules/Alerts/Absorb.lua'];
const harness = themeLua(d) + placementLua(d) + `
local rulesSrc, engineSrc, areasSrc, barsSrc, referenceSrc, colorsSrc, absorbSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

local SECRET = {}
local function forbidden() error("used a secret value") end
for _, k in ipairs({ "__index", "__newindex", "__len", "__concat", "__lt", "__le", "__eq", "__add", "__sub", "__mul", "__div",
  "__mod", "__pow", "__unm", "__call", "__tostring" }) do SECRET[k] = forbidden end
local function secret(v) return setmetatable({ inner = v }, SECRET) end
function issecretvalue(v) return getmetatable(v) == SECRET end
-- the game's type() reports a secret's real type
local realType = type
function type(v) if getmetatable(v) == SECRET then return realType(rawget(v, "inner")) end return realType(v) end

local frames = {}
local function mock(kind, parent)
  local m = { kind = kind, parent = parent, shown = true, text = "", pts = {}, w = 0, h = 0, alpha = 1, events = {} }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if realType(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" then return function(self) return mock("FontString", self) end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "CreateAnimationGroup" then return function(self)
      local g = mock("AnimationGroup", self)
      rawset(g, "CreateAnimation", function() return mock("Animation", g) end)
      return g end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "RegisterEvent" then return function(self, e) self.events[e] = true end end
    if k == "UnregisterEvent" then return function(self, e) self.events[e] = nil end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "IsVisible" then return function(self) local f = self while f do if not f.shown then return false end f = rawget(f, "parent") end return true end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetTexture" then return function(self, s) rawset(self, "texture", s) end end
    if k == "SetFont" then return function(self, path, size, flags) rawset(self, "fontPath", path) rawset(self, "fontSize", size) return true end end
    if k == "GetFont" then return function(self) return rawget(self, "fontPath"), rawget(self, "fontSize") end end
    if k == "SetTextColor" then return function(self, r, g, b, a) rawset(self, "textColor", { r, g, b, a }) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return self.w end end
    if k == "GetHeight" then return function(self) return self.h end end
    -- measuring a text: a secret one raises (its length is forbidden)
    if k == "GetUnboundedStringWidth" or k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetCenter" then return function(self) return 530, 450 end end
    if k == "SetColorTexture" or k == "SetVertexColor" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "GetFrameLevel" then return function() return 1 end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
local statusBars = {}
function CreateFrame(kind, name, parent)
  local f = mock(kind, parent)
  if kind == "StatusBar" then
    statusBars[#statusBars + 1] = f
    rawset(f, "calls", {})
    rawset(f, "SetMinMaxValues", function(self, a, b) self.calls[#self.calls + 1] = { "minmax", a, b } end)
    rawset(f, "SetValue", function(self, v) self.calls[#self.calls + 1] = { "value", v } end)
    rawset(f, "SetStatusBarTexture", function(self, t) rawset(self, "barTexture", t) end)
    rawset(f, "SetStatusBarColor", function(self, r, g, b, a) self.calls[#self.calls + 1] = { "color", r, g, b, a } end)
  end
  return f
end
local clock = 100
format = string.format
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end

-- the game's shield readings and its formatter, which takes a secret and gives a secret string
local absorbs, absorbCalls = {}, 0
function UnitGetTotalAbsorbs(u) absorbCalls = absorbCalls + 1 return absorbs[u] end
local formatted = {}
function AbbreviateNumbers(v) local s = secret("1.2M") formatted[#formatted + 1] = { input = v, output = s } return s end

local function defaults() return {
  bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20, font = "Friz Quadrata", fontSize = 13 },
  areas = {}, reminders = {}, phases = {}, overrides = {}, nextId = 1 } end
local CRT = { db = { alerts = defaults() } }
CRT.Timeline = { readable = function(v) local ok, s = pcall(issecretvalue, v); return ok and not s end }
function CRT:FontList() return { { name = "Friz Quadrata", path = "Fonts\\\\FRIZQT__.TTF" } } end
function CRT:FontPath() return "Fonts\\\\FRIZQT__.TTF" end
CRT.UI = {
  RegisterLayer = function() end, RegisterPreview = function() end,
  ResetButtonWidth = function() return 44 end, ResetButton = function(parent) return mock("Button", parent) end,
  SetFrameTitle = function() end, StyleWindow = function() end, Help = function(parent) return mock("Button", parent) end,
  Dropdown = function(parent) return mock("Row", parent) end, Slider = function(parent) return mock("Row", parent) end,
}
CRT.Notes = { SpellInfo = function() return nil end }
-- the untimed watches Alerts/Special.lua would give (absorb.anyDifficulty on a difficulty with no times)
local watchList = {}
CRT.AlertSpecial = { AbsorbWatches = function(_, run) return watchList end }
assert(load(rulesSrc, "Rules"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "Engine"))("CowfeeRaidTools", CRT)
assert(load(referenceSrc, "Reference"))("CowfeeRaidTools", CRT)
assert(load(colorsSrc, "Colors"))("CowfeeRaidTools", CRT)
CRT_THEME(CRT, CRT.UI)
CRT_PLACEMENT(CRT)
assert(load(areasSrc, "Areas"))("CowfeeRaidTools", CRT)
assert(load(barsSrc, "Bars"))("CowfeeRaidTools", CRT)
assert(load(absorbSrc, "Absorb"))("CowfeeRaidTools", CRT)
local A, B, Ab = CRT.Alerts, CRT.AlertBars, CRT.AlertAbsorb
check(Ab and Ab.GAP == 1.5, "CRT.AlertAbsorb, a 1.5 s gap")

local ticker
for _, f in ipairs(frames) do if rawget(f, "OnUpdate") and rawget(f, "OnEvent") then ticker = f end end
ticker.OnEvent(ticker, "PLAYER_LOGIN")

-- the special block's items: the shield's two casts (phase 1 at 60 s and 150 s, lead 6), a plain bar, a phase 2 item
local items = {}
A:RegisterBlock("special", { label = "Special", group = false, Entries = function() local out = {} for i, it in ipairs(items) do
  local c = {} for k, v in pairs(it) do c[k] = v end out[i] = c end return out end })
local function shieldItems()
  return {
    { id = "special:shield:1", ph = 1, time = 60, text = "Shield", warn = 6, hold = 0.5, priority = 31,
      outputs = { alert = true, bar = true }, absorb = { unit = "boss2", length = 15 } },
    { id = "special:shield:2", ph = 1, time = 150, text = "Shield", warn = 6, hold = 0.5, priority = 31,
      outputs = { alert = true, bar = true }, absorb = { unit = "boss2", length = 15 } },
    { id = "later", ph = 2, time = 5, text = "Later", warn = 0, hold = 0, priority = 31, outputs = { bar = true } },
  }
end
local function absorbFrame() for _, f in ipairs(frames) do if rawget(f, "OnEvent") and f.events.UNIT_ABSORB_AMOUNT_CHANGED then return f end end end
local function fire(unit) local f = absorbFrame() if f then f.OnEvent(f, "UNIT_ABSORB_AMOUNT_CHANGED", unit) end end
local function shields() local out = {} for i, r in ipairs(B:Visible()) do if r.absorb then out[#out + 1] = { row = r, bar = B.pool[i] } end end return out end
local function sbOf(bar) return bar.absorbParts and bar.absorbParts.sb end
local function callsOf(sb, kind) local out = {} for _, c in ipairs(sb.calls) do if c[1] == kind then out[#out + 1] = c end end return out end
local function pull(list, watches)
  A:Stop()
  items, watchList = list or {}, watches or {}
  clock = 100
  absorbs = {}
  CRT.db.alerts = defaults()
  A.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16)
end

-- Mythic: the window of the first cast is 154 to 175 s; the item draws no bar of its own
pull(shieldItems())
check(absorbFrame() ~= nil, "a pull with a shield item listens to UNIT_ABSORB_AMOUNT_CHANGED")
local first = secret(900000)
absorbs.boss2 = first
clock = 150 fire("boss2")
clock = 155 B:Refresh()
check(#B:Visible() == 0, "an absorb event before the window starts nothing, and the item draws no plain bar")
fire("boss1")
B:Refresh()
check(#B:Visible() == 0, "another unit's absorb starts nothing")
clock = 157 fire("boss2")
B:Refresh()
local sh = shields()
check(#sh == 1 and sh[1].row.text == "Shield" and sh[1].row.time == "15" and sh[1].row.tick == 1, "the first absorb event in the window starts the bar: 15 s, the tick at the right end")
local bar = sh[1] and sh[1].bar
local sb = bar and sbOf(bar)
local mm = sb and callsOf(sb, "minmax")[1]
check(mm and mm[2] == 0 and rawequal(mm[3], first), "the first reading is the maximum, passed as it came")
local vals = sb and callsOf(sb, "value") or {}
check(#vals == 1 and rawequal(vals[1][2], first), "and the value")
check(#formatted >= 1 and rawequal(formatted[#formatted].input, first) and rawequal(bar.absorbParts.amount.text, formatted[#formatted].output), "the amount: AbbreviateNumbers' secret text on the left, through SetText")
check(not bar.fill.shown and not bar.text.shown and not bar.time.shown and sb.shown, "the plain fill and texts are hidden, the status bar shown")
check(sb.barTexture == "Interface\\\\Buttons\\\\WHITE8X8", "a plain white fill, tinted")
-- many readings in one frame: each event only keeps the value
local before = #callsOf(sb, "value")
for i = 1, 30 do absorbs.boss2 = secret(900000 - i) fire("boss2") end
check(#callsOf(sb, "value") == before, "no draw per event: 30 events, no SetValue")
local latest = absorbs.boss2
clock = 157.05 B:Refresh()
check(#callsOf(sb, "value") == before, "redraws at most every 0.1 s")
clock = 157.2 B:Refresh()
local v2 = callsOf(sb, "value")
check(#v2 == before + 1 and rawequal(v2[#v2][2], latest), "then the latest reading: " .. #v2)
check(#callsOf(sb, "minmax") == 1, "the maximum is set once")
-- the tick and the seconds on CRT's clock, right to left
local function tickX(b) local pts = b.absorbParts.tick.pts return pts[#pts][4] end
local x1 = tickX(bar)
clock = 164.5 B:Refresh()
sh = shields()
check(sh[1] and math.abs(sh[1].row.tick - 0.5) < 1e-9 and sh[1].row.time == "7.5", "half way: the tick in the middle, 7.5 s left")
local x2 = tickX(bar)
clock = 171 ticker.OnUpdate(ticker, 0.016)
local x3 = tickX(bar)
check(x1 > x2 and x2 > x3 and x3 >= 0, "the tick moves from right to left, between refreshes too: " .. x1 .. " " .. x2 .. " " .. x3)
local colors = callsOf(sb, "color")
local same = #colors >= 2
for _, c in ipairs(colors) do for i = 2, 5 do if c[i] ~= colors[1][i] then same = false end end end
check(same, "the colour never changes: " .. #colors .. " draws")
clock = 172 absorbs.boss2 = secret(1) fire("boss2")
B:Refresh()
check(#shields() == 0, "the bar ends when its length runs out")
clock = 173 fire("boss2") B:Refresh()
check(#shields() == 0, "one bar per window: no second one inside it")
check(#errors == 0, tostring(errors[1]))

-- the encounter's end ends it
pull(shieldItems())
absorbs.boss2 = secret(5)
clock = 156 fire("boss2") B:Refresh()
check(#shields() == 1, "started")
A.HandleEvent("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
B:Refresh()
check(#shields() == 0 and not (absorbFrame() and absorbFrame().events.UNIT_ABSORB_AMOUNT_CHANGED), "the encounter's end ends it, and the event is dropped")

-- the window closes: a later phase cuts the cast (as a phase change cancelled the second shield on the probe pull)
pull(shieldItems())
absorbs.boss2 = secret(5)
clock = 155 fire("boss2") B:Refresh()
check(#shields() == 1, "started before the cast")
clock = 158 A:StartPhase(2)
B:Refresh()
check(#shields() == 0, "a later phase cut the cast: the bar ends with its window")

-- the second cast's window opens a bar of its own
pull(shieldItems())
absorbs.boss2 = secret(5)
clock = 246 fire("boss2") B:Refresh()
sh = shields()
check(#sh == 1 and sh[1].row.time == "15", "the next cast's window: a new bar")
check(#errors == 0, tostring(errors[1]))

-- a formatter that fails, or none: the amount is blank; a failing reading is skipped
pull(shieldItems())
local realFormat = AbbreviateNumbers
AbbreviateNumbers = function() error("nope") end
absorbs.boss2 = secret(5)
clock = 157 fire("boss2") B:Refresh()
sh = shields()
check(sh[1] and sh[1].bar.absorbParts.amount.text == "", "a failing formatter: the amount is blank")
AbbreviateNumbers = nil
clock = 157.5 absorbs.boss2 = secret(4) fire("boss2") B:Refresh()
check(shields()[1].bar.absorbParts.amount.text == "", "no formatter: blank")
AbbreviateNumbers = realFormat
local realTotal = UnitGetTotalAbsorbs
UnitGetTotalAbsorbs = function() error("no unit") end
clock = 158 fire("boss2") B:Refresh()
check(#shields() == 1 and #errors == 0, "a reading that errors is left out")
UnitGetTotalAbsorbs = realTotal
absorbs.boss2 = nil
clock = 158.5 fire("boss2") B:Refresh()
check(#errors == 0, "no reading at all is left out: " .. tostring(errors[1]))
fire(secret("boss2"))
check(#errors == 0, "a secret unit is left out")

-- a Test (no absorb events outside a pull): the bar at its cast, full, no amount
A:Stop()
items, watchList = shieldItems(), {}
clock = 100
A:Start(3001, "Mythic", "test")
check(not (absorbFrame() and absorbFrame().events.UNIT_ABSORB_AMOUNT_CHANGED), "a Test does not listen")
clock = 159 B:Refresh()
check(#shields() == 0, "a Test: nothing before the cast")
clock = 160 B:Refresh()
sh = shields()
local tsb = sh[1] and sbOf(sh[1].bar)
local tmm = tsb and callsOf(tsb, "minmax")
check(sh[1] and sh[1].row.time == "15" and tmm[#tmm][3] == 1 and callsOf(tsb, "value")[#callsOf(tsb, "value")][2] == 1, "a Test: from the cast, full")
check(sh[1].bar.absorbParts.amount.text == "", "a Test: no amount")
A:Stop()

-- untimed (Normal/Heroic with no ability timeline): the first absorb event starts it; a new one only after it ended and
-- the events stopped for 1.5 s
pull({}, { { id = "absorb:shield", key = "shield", unit = "boss2", length = 15, text = "Shield" } })
check(absorbFrame() ~= nil, "an untimed watch listens too")
absorbs.boss2 = secret(5)
clock = 120 fire("boss2") B:Refresh()
sh = shields()
check(#sh == 1 and sh[1].row.time == "15" and B:Visible()[1].text == "Shield", "the first absorb event starts the bar, no times needed")
local firstId = B.pool[1].line.id
for t = 121, 134 do clock = t fire("boss2") end
clock = 135 fire("boss2") B:Refresh()
check(#shields() == 0, "ends when its length runs out")
clock = 135.5 fire("boss2") B:Refresh()
check(#shields() == 0, "events still coming: no new bar")
clock = 136.6 fire("boss2") B:Refresh()
check(#shields() == 0, "1.1 s apart is no gap")
clock = 138.2 fire("boss2") B:Refresh()
sh = shields()
check(#sh == 1 and sh[1].row.time == "15" and B.pool[1].line.id ~= firstId, "after a 1.6 s gap, a new bar")
clock = 140 B:Refresh()
check(#shields() == 1, "it runs on with no events (the fill stays where it was)")
fire("boss3")
check(#errors == 0, tostring(errors[1]))

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + f, 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
