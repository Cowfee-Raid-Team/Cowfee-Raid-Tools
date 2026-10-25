// A special alert's Test, end to end: Special:TestItem (CRT_Modules/Alerts/Special.lua) -> Editor:TestItem's quick test
// (CRT_Modules/Alerts/Editor.lua) -> the engine -> the bars (CRT_Modules/Alerts/Bars.lua), the callout's line and the
// speech, with mock frames. A Test plays what a pull plays for that cast: the same bar (its own start and length, its
// impact ticks, filling up or emptying), and the callout and speech once each. The same entry in a real pull too.
// Usage: node run_alerts_specialtest.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua
//   CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua
//   CRT_Modules/Alerts/Speech.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Notes/Engine.lua CRT_Modules/Notes/Alert.lua
//   CRT_Modules/Alerts/Reminders.lua CRT_Modules/Alerts/Draft.lua CRT_Modules/Alerts/SpellLookup.lua CRT_Modules/Alerts/Editor.lua
//   CRT_Modules/Alerts/Special.lua CRT_Modules/Alerts/Colors.lua CRT_Modules/Alerts/Areas.lua CRT_Modules/Alerts/Bars.lua
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local sources = { ... }
local frames = {}
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, checked = false, text = "", pts = {}, w = 0, h = 0, alpha = 1 }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if type(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" then return function(self) return mock("FontString", self) end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "CreateAnimationGroup" then return function(self)
      local g = mock("AnimationGroup", self)
      rawset(g, "CreateAnimation", function() return mock("Animation", g) end)
      return g end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetFont" then return function(self, path, size, flags) rawset(self, "fontPath", path) return true end end
    if k == "GetFont" then return function(self) return rawget(self, "fontPath") end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return self.w end end
    if k == "GetHeight" then return function(self) return self.h end end
    if k == "GetUnboundedStringWidth" or k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetCenter" then return function() return 480, 300 end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "GetFrameLevel" then return function() return 1 end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-25 12:00" end
format = string.format
local created = {}
function CreateFrame(kind, name, parent, template)
  local f = mock(kind, parent, template)
  if name then created[name] = f end
  return f
end
local clock = 100
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
function issecretvalue() return false end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
SOUNDKIT = { RAID_WARNING = 8959, READY_CHECK = 8960 }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end,
  GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
-- you: Cheoeqar, a damage dealer in raid group 3
function UnitName(u) if u == "player" then return "Cheoeqar" end end
function UnitGroupRolesAssigned() return "DAMAGER" end
function UnitClass(u) if u == "player" then return "Mage", "MAGE", 8 end end
function IsInRaid() return true end
function IsInGroup() return true end
function GetNumGroupMembers() return 2 end
function UnitIsUnit(a, b) return a == "raid2" and b == "player" end
function GetRaidRosterInfo(i) if i == 2 then return "Cheoeqar", 0, 3 end return "Other", 0, 1 end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic" })[id] end

local spoken = {}
local CRT = {
  db = {
    ui = { modern = true, layers = {} },
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    notes = { list = {}, nextId = 1, trustedOnly = true,
      alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0 } },
    -- the bars as Alex has them: shown from 10 s ahead
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 10, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1, special = {} },
  },
}
local previews = {}
CRT.UI = {
  RegisterLayer = function() end, RegisterPreview = function(_, key, fn) previews[key] = fn end, pages = {},
  ResetButtonWidth = function() return 44 end, ResetButton = function(parent) return mock("Button", parent) end,
  SetFrameTitle = function() end, StyleWindow = function() end,
  Help = function(parent) return mock("Button", parent) end,
  Dropdown = function(parent) local r = mock("Row", parent) rawset(r, "refresh", function() end) return r end,
  Slider = function(parent) local r = mock("Row", parent) rawset(r, "refresh", function() end) return r end,
}
CRT_THEME(CRT, CRT.UI)
function CRT:Print() end
function CRT:PlaySound() end
function CRT:FontList() return { { name = "Friz Quadrata", path = "Fonts\\\\FRIZQT__.TTF" } } end
function CRT:FontPath() return "Fonts\\\\FRIZQT__.TTF" end
CRT.Sound = { Speak = function(_, text) spoken[#spoken + 1] = text return true end, StopSpeaking = function() end, Play = function() end,
  Compact = function(v) return v end, Normalize = function(v) return v end, Choices = function() return {} end }
CRT.TimelineJournal = { Rows = function() return {} end, IsHidden = function() return false end }
for i, src in ipairs(sources) do
  assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
end
local A, S, E, B, Rules, Speech = CRT.Alerts, CRT.AlertSpecial, CRT.AlertEditor, CRT.AlertBars, CRT.AlertRules, CRT.AlertSpeech
local Callout = CRT.NoteAlert
assert(A and S and E and E.TestItem and B and Speech and Callout, "the modules")
assert(previews.alertbars and previews.alert, "the bars and the callout have Previews")
-- Previews on or off, as the main window's Previews button turns them (UI:SetPreviews)
local function setPreviews(on) for _, fn in pairs(previews) do fn(on) end end
-- the ticker builds the areas at login
for _, f in ipairs(frames) do if rawget(f, "OnUpdate") and rawget(f, "OnEvent") then pcall(f.OnEvent, f, "PLAYER_LOGIN") end end

-- the dev sample's shape (CRT_Dev/Dev/SpecialSample.lua): a soak rotation, its bar from 3 s before each cast for 8 s,
-- the impacts 4.5 and 6.5 s into it. Cast 2 (group 3's) is at 0:50.
local ENC = 9002
S.dev[ENC] = { {
  key = "devSample", label = "Sample: soak rotation", type = "soak",
  when = { times = "P1 0:20, 0:50, 1:20, 1:50" }, lead = 5,
  who = { mode = "rotation", rotation = { { 1, 2 }, { 3, 4 } } },
  text = "Soak now: {group}",
  show = { callout = true, bar = true, text = true, speech = true },
  bar = { start = -3, length = 8, ticks = { 4.5, 6.5 } },
} }
local entry = assert(S:Get(ENC, "devSample"), "the sample reads")

local ok_, fail = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then ok_ = ok_ + 1 print("ok " .. name) else fail = fail + 1 print("FAIL " .. name .. ": " .. tostring(err)) end
end
local function near(a, b) return type(a) == "number" and math.abs(a - b) < 1e-6 end
local function at(t) clock = t B:Refresh() Speech:Tick(clock) return B:Visible()[1] end
local function callout() return Rules.Alert(A:Lines(clock), clock) end

-- Plays the bar from t0 (the cast at t0 + castIn) and checks it as the boss file says: it shows from 3 s before the
-- cast, 8 s long, with its ticks 4.5 and 6.5 s into it, filling up (or emptying with "down").
local function checkBar(t0, castIn, fill)
  local cast = t0 + castIn
  assert(at(cast - 3.5) == nil, "no bar before its start, 3 s before the cast")
  local v = at(cast - 3)
  assert(v, "the bar shows 3 s before the cast")
  assert(v.time == "8.0", "8 s long: " .. tostring(v.time))
  assert(v.fill == fill, "fills " .. fill .. ": " .. tostring(v.fill))
  assert(near(v.filled, fill == "up" and 0 or 1), (fill == "up" and "starts empty" or "starts full") .. ": " .. tostring(v.filled))
  assert(v.ticks and #v.ticks == 2, "two impact ticks: " .. tostring(v.ticks and #v.ticks))
  -- each tick where the fill's edge is as its impact lands: 4.5 and 6.5 s of the 8 filled, or that much gone
  local p1, p2 = 4.5 / 8, 6.5 / 8
  if fill == "down" then p1, p2 = 1 - p1, 1 - p2 end
  assert(near(v.ticks[1].pos, p1) and near(v.ticks[2].pos, p2), "ticks 4.5 and 6.5 s into the bar: " .. v.ticks[1].pos .. ", " .. v.ticks[2].pos)
  v = at(cast + 1.5) -- the first impact, 4.5 s into the bar
  assert(v and v.ticks[1].passed and not v.ticks[2].passed, "the first impact has landed")
  assert(near(v.filled, p1), "the fill's edge on the first tick: " .. tostring(v.filled))
  v = at(cast + 4.9)
  assert(v and v.time == "0.1", "the bar runs to its end, 5 s after the cast: " .. tostring(v and v.time))
end

local function speechCount(text)
  local n = 0
  for _, s in ipairs(spoken) do if s == text then n = n + 1 end end
  return n
end

check("special test: the bar plays as set, filling up", function()
  A:Stop(true) wipe(spoken) wipe(errors)
  S:SetChoice(ENC, entry, "fill", "up")
  clock = 100
  local item = assert(S:TestItem(ENC, entry, "mythic"), "a test item")
  assert(item.fill == "up" and item.barStart == -3 and item.barEnd == 5, "the item carries the bar")
  local ok, err = E:TestItem(ENC, item)
  assert(ok, "the test starts: " .. tostring(err))
  checkBar(100, 10, "up")
  assert(#errors == 0, tostring(errors[1]))
end)

check("special test: the bar plays as set, emptying", function()
  A:Stop(true) wipe(spoken) wipe(errors)
  S:SetChoice(ENC, entry, "fill", "down")
  clock = 100
  assert(E:TestItem(ENC, S:TestItem(ENC, entry, "mythic")), "the test starts")
  checkBar(100, 10, "down")
  S:SetChoice(ENC, entry, "fill", "up")
  assert(#errors == 0, tostring(errors[1]))
end)

check("special test: the callout and the speech come once each", function()
  A:Stop(true) wipe(spoken) wipe(errors)
  clock = 100
  local item = S:TestItem(ENC, entry, "mythic")
  assert(E:TestItem(ENC, item), "the test starts")
  local shown, last = 0, nil
  for t = 100, 116, 0.1 do
    clock = t
    Speech.playing = false -- each line is said in full
    Speech:Tick(clock)
    local c = callout()
    local id = c and c.id
    if id and id ~= last then shown = shown + 1 end
    last = id
  end
  assert(shown == 1, "one callout: " .. shown)
  assert(speechCount(item.text) == 1, "said once: " .. speechCount(item.text) .. " of " .. #spoken)
  assert(#errors == 0, tostring(errors[1]))
end)

-- Previews on (set up the bars, then Test): the Test's alert shows as set, in place of the samples
check("special test: with Previews on, the bar and the callout are the alert's, not the samples", function()
  A:Stop(true) wipe(spoken) wipe(errors)
  clock = 100
  setPreviews(true)
  local sample = at(100)
  assert(#B:Visible() == 3 and sample.ticks == nil, "Previews show the three samples: " .. #B:Visible())
  local item = S:TestItem(ENC, entry, "mythic")
  assert(E:TestItem(ENC, item), "the test starts")
  checkBar(100, 10, "up")
  local v = at(108)
  assert(#B:Visible() == 1 and v.text == item.text, "only the alert's bar, no sample bars: " .. #B:Visible() .. " " .. tostring(v.text))
  clock = 106 Callout:Refresh()
  local shown = {}
  for _, f in ipairs(frames) do if f.kind == "FontString" and f.text == item.text and f.shown ~= false then shown[#shown + 1] = f end end
  assert(#shown >= 1, "the callout shows the alert's text")
  A:Stop(true)
  clock = 120 at(120) Callout:Refresh()
  local back = B:Visible()[1]
  assert(#B:Visible() == 3 and back.text ~= item.text, "the test over: the samples again")
  setPreviews(false)
  assert(#errors == 0, tostring(errors[1]))
end)

check("special pull: the same bar on each of your casts", function()
  A:Stop(true) wipe(spoken) wipe(errors)
  setPreviews(false)
  S:SetChoice(ENC, entry, "on", true)
  clock = 100
  A:Start(ENC, "Mythic", "encounter", { difficultyID = 16 })
  checkBar(100, 50, "up") -- your cast: the second, at 0:50
  A:Stop(true)
  S:SetChoice(ENC, entry, "on", false)
  assert(#errors == 0, tostring(errors[1]))
end)

print(ok_ .. " passed, " .. fail .. " failed")
if fail > 0 then error("special alert test: " .. fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
