// Your own shield bars, end to end: a reminder with absorb (CRT_Modules/Alerts/Reminders.lua) and a raid note line with
// shield: (CRT_Modules/Notes/Parse.lua, Notes/Engine.lua) start a shield bar through CRT_Modules/Alerts/Absorb.lua exactly
// as a special alert's absorb does: inside a cast's window (from its Show from) on the first UNIT_ABSORB_AMOUNT_CHANGED,
// or untimed (no window open: a phase not reached, or another difficulty with "Also without a timeline"), none with Bar
// off. The editor's Test (Editor:TestDraft's quick test) shows the sample: full, no amount, its whole length. The
// shield's readings are secret proxies that raise on any use the game forbids.
// Usage: node run_alerts_shield.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const d = process.argv[2];
const FILES = [
  'CRT_Modules/Timeline/Data.lua', 'CRT_Modules/Timeline/Database.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/Lanes.lua',
  'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua',
  'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/Engine.lua',
  'CRT_Modules/Alerts/Reminders.lua', 'CRT_Modules/Alerts/Special.lua', 'CRT_Modules/Alerts/Absorb.lua', 'CRT_Modules/Alerts/ShieldPulls.lua',
  'CRT_Modules/Alerts/Draft.lua', 'CRT_Modules/Alerts/SpellLookup.lua', 'CRT_Modules/Alerts/ShieldSection.lua', 'CRT_Modules/Alerts/Editor.lua',
];
const harness = `
local sources = { ... }
local SECRET = {}
local function forbidden() error("used a secret value") end
for _, k in ipairs({ "__index", "__newindex", "__len", "__concat", "__lt", "__le", "__eq", "__add", "__sub", "__mul", "__div",
  "__mod", "__pow", "__unm", "__call", "__tostring" }) do SECRET[k] = forbidden end
local function secret(v) return setmetatable({ inner = v }, SECRET) end
function issecretvalue(v) return getmetatable(v) == SECRET end
local realType = type
function type(v) if getmetatable(v) == SECRET then return realType(rawget(v, "inner")) end return realType(v) end

local frames = {}
local function mock(kind, parent)
  local m = { kind = kind, parent = parent, shown = true, text = "", events = {} }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if realType(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" or k == "CreateTexture" then return function(self) return mock(k, self) end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "RegisterEvent" then return function(self, e) self.events[e] = "all" end end
    if k == "RegisterUnitEvent" then return function(self, e, ...) self.events[e] = table.concat({ ... }, ",") end end
    if k == "UnregisterEvent" then return function(self, e) self.events[e] = nil end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return self.text end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
function CreateFrame(kind, name, parent) return mock(kind, parent) end
function tinsert(t, v) table.insert(t, v) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-28 12:00" end
format = string.format
local clock = 100
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
function InCombatLockdown() return false end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { s = s, fn = fn } end }
SOUNDKIT = { RAID_WARNING = 8959 }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end,
  GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
function UnitName(u) if u == "player" then return "Cheoeqar" end end
function UnitGroupRolesAssigned() return "DAMAGER" end
function UnitClass(u) if u == "player" then return "Mage", "MAGE", 8 end end
function IsInRaid() return false end
function IsInGroup() return false end
function GetNumGroupMembers() return 0 end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic" })[id] end
local absorbs = {}
function UnitGetTotalAbsorbs(u) return absorbs[u] end
function AbbreviateNumbers() return secret("1M") end

local CRT = {
  db = {
    ui = { modern = true, layers = {} },
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    notes = { list = {}, nextId = 1, trustedOnly = true, alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3 } },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20 }, reminders = {}, phases = {}, overrides = {}, nextId = 1, special = {} },
  },
}
CRT.UI = { RegisterLayer = function() end, RegisterPreview = function() end, pages = {} }
function CRT:Print() end
CRT.Sound = { Speak = function() return true end, StopSpeaking = function() end, Play = function() end,
  Compact = function(v) return v end, Normalize = function(v) return v end, Choices = function() return {} end }
CRT.TimelineJournal = { Rows = function() return {} end, IsHidden = function() return false end }
for i, src in ipairs(sources) do
  assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
end
local A, R, Ab, E, D, Notes = CRT.Alerts, CRT.AlertReminders, CRT.AlertAbsorb, CRT.AlertEditor, CRT.AlertDraft, CRT.Notes
assert(A and R and Ab and E and D and Notes, "the modules")

local ENC = 9101
local ok_, fail = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then ok_ = ok_ + 1 print("ok " .. name) else fail = fail + 1 print("FAIL " .. name .. ": " .. tostring(err)) end
end
local function listened(unit)
  for _, f in ipairs(frames) do
    local u = f.events.UNIT_ABSORB_AMOUNT_CHANGED
    -- Alerts/ShieldPulls.lua's two frames listen to boss1-boss4 and boss5 every pull: not a shield bar's
    if u and u ~= "boss1,boss2,boss3,boss4" and u ~= "boss5" and (u == "all" or ("," .. u .. ","):find("," .. unit .. ",", 1, true)) then return true end
  end
  return false
end
local function fire(unit, at) clock = at absorbs[unit] = absorbs[unit] or secret(800000) Ab.HandleEvent("UNIT_ABSORB_AMOUNT_CHANGED", unit) end
local function shields(at) clock = at return Ab:Lines(at) end
local function reset()
  A:Stop(true)
  CRT.db.alerts.reminders, CRT.db.alerts.nextId, CRT.db.alerts.overrides = {}, 1, {}
  CRT.db.notes.list, CRT.db.notes.nextId, CRT.db.notes.active = {}, 1, nil
  absorbs = {}
  CRT.AlertSpecial.dev[ENC] = nil
  wipe(errors)
  clock = 100
end
local function reminder(fields)
  local r = { text = "Break it", times = "P1 0:30", group = "mythic", warn = 5,
    outputs = { alert = true, bar = true, speech = false }, absorb = { unit = "boss2", length = 15, anyDifficulty = true } }
  for k, v in pairs(fields or {}) do r[k] = v end
  return R:Save(ENC, nil, r)
end
local function pull(diffID) clock = 100 A:Start(ENC, diffID == 16 and "Mythic" or "Heroic", "encounter", { difficultyID = diffID or 16 }) end

check("a reminder's shield bar: the first absorb event inside its window starts it", function()
  reset()
  local id = reminder()
  pull(16)
  assert(listened("boss2"), "the pull listens to boss2")
  -- the window: Show from (5 s) before the cast at 130 to 15 s after
  fire("boss2", 126)
  local l = shields(126.5)
  assert(#l == 1 and l[1].text == "Break it" and l[1].absorb.length == 15 and l[1].block == "mine", "one bar: " .. #l)
  assert(l[1].id == "mine:" .. id .. ":1", "the timed bar of the cast: " .. tostring(l[1].id))
  assert(rawequal(l[1].absorb.max, absorbs.boss2), "its maximum is the reading, as it came")
  assert(#shields(140) == 1 and #shields(141.1) == 0, "ends when its 15 s run out")
  -- the reminder's own bar is not drawn: the item only opens the window
  local item
  for _, it in ipairs(A.items) do if it.id == "mine:" .. id .. ":1" then item = it end end
  assert(item and item.absorb and item.absorb.lead == 5 and item.absorb.key == "mine:" .. id and item.ticks == nil, "the item: absorb with its Show from, no ticks")
  A:Stop()
  assert(not listened("boss2"), "the pull's end drops the event")
  assert(#errors == 0, tostring(errors[1]))
end)

check("a reminder's shield bar: untimed before its window (the fallback), one bar only", function()
  reset()
  reminder()
  pull(16)
  fire("boss2", 110) -- no window open yet: the untimed watch
  local l = shields(110.5)
  assert(#l == 1 and l[1].id:find("^absorb:mine:"), "the first event starts the untimed bar: " .. tostring(l[1] and l[1].id))
  fire("boss2", 112)
  assert(#shields(112) == 1, "still one")
  A:Stop()
end)

check("a reminder's shield bar on another difficulty: only with Also without a timeline", function()
  reset()
  reminder({ group = "nh" })
  pull(16) -- a Mythic pull: the reminder is Normal/Heroic's, no times here
  assert(listened("boss2"), "anyDifficulty: the watch listens")
  fire("boss2", 150)
  local l = shields(150.2)
  assert(#l == 1 and l[1].id:find("^absorb:mine:"), "the untimed bar")
  reset()
  reminder({ group = "nh", absorb = { unit = "boss2", length = 15, anyDifficulty = false } })
  pull(16)
  assert(not listened("boss2"), "without it: nothing listened to")
  fire("boss2", 150)
  assert(#shields(150.2) == 0, "and no bar")
  A:Stop()
end)

check("Bar off: no shield bar, nothing listened to", function()
  reset()
  reminder({ outputs = { alert = true, bar = false } })
  pull(16)
  assert(not listened("boss2"), "not listened to")
  fire("boss2", 126)
  assert(#shields(127) == 0, "no bar")
  A:Stop()
  reset()
  reminder({ enabled = false })
  pull(16)
  assert(not listened("boss2"), "a reminder turned off: nothing")
  A:Stop()
end)

check("a raid note line's shield bar: inside its window, from the line's Show from", function()
  reset()
  local nid = Notes:Import("EncounterID:" .. ENC .. ";Difficulty:Mythic;Name:Boss\\ntime:30;ph:1;tag:everyone;text:Note shield;show:bar;warn:6;shield:boss3,10;")
  assert(nid, "the note")
  pull(16)
  assert(listened("boss3"), "the pull listens to boss3")
  fire("boss3", 125)
  local l = shields(125.5)
  assert(#l == 1 and l[1].text == "Note shield" and l[1].absorb.length == 10 and l[1].id == "note:1", "the timed bar: " .. tostring(l[1] and l[1].id))
  assert(#shields(134.9) == 1 and #shields(135.1) == 0, "10 s long")
  A:Stop()
  -- someone else's line: nothing
  reset()
  Notes:Import("EncounterID:" .. ENC .. ";Difficulty:Mythic;Name:Boss\\ntime:30;ph:1;tag:Bob;text:Not mine;show:bar;shield:boss3,10;")
  pull(16)
  assert(not listened("boss3"), "a line for another player: nothing listened to")
  A:Stop()
  -- show: without bar: no shield bar
  reset()
  Notes:Import("EncounterID:" .. ENC .. ";Difficulty:Mythic;Name:Boss\\ntime:30;ph:1;tag:everyone;text:No bar;show:text;shield:boss3,10;")
  pull(16)
  assert(not listened("boss3"), "Bar off on the line: nothing")
  fire("boss3", 125)
  assert(#shields(125.5) == 0, "no bar")
  A:Stop()
  assert(#errors == 0, tostring(errors[1]))
end)

check("a raid note line's shield bar: the fallback, and another difficulty's note only with any", function()
  reset()
  -- phase 2, no trigger: its window never opens, so the first event starts the untimed bar
  Notes:Import("EncounterID:" .. ENC .. ";Difficulty:Mythic;Name:Boss\\ntime:1;ph:1;tag:everyone;text:Pull;\\ntime:30;ph:2;tag:everyone;text:P2 shield;show:bar;shield:boss2,12;")
  pull(16)
  fire("boss2", 300)
  local l = shields(300.5)
  assert(#l == 1 and l[1].id:find("^absorb:note:2:") and l[1].text == "P2 shield" and l[1].absorb.length == 12, "untimed: " .. tostring(l[1] and l[1].id))
  A:Stop()
  -- the boss's only note is Heroic's; a Mythic pull runs it: a line without any gets no untimed bar there
  reset()
  Notes:Import("EncounterID:" .. ENC .. ";Difficulty:Heroic;Name:Boss\\ntime:1;ph:1;tag:everyone;text:Pull;\\ntime:30;ph:2;tag:everyone;text:P2 shield;show:bar;shield:boss2,12;")
  pull(16)
  fire("boss2", 300)
  assert(#shields(300.5) == 0, "another difficulty's note, no any: no untimed bar (its timed windows still open, as the note runs)")
  A:Stop()
  reset()
  Notes:Import("EncounterID:" .. ENC .. ";Difficulty:Heroic;Name:Boss\\ntime:1;ph:1;tag:everyone;text:Pull;\\ntime:30;ph:2;tag:everyone;text:P2 shield;show:bar;shield:boss2,12,any;")
  pull(16)
  fire("boss2", 300)
  assert(#shields(300.5) == 1, "with any: the untimed bar")
  A:Stop()
  assert(#errors == 0, tostring(errors[1]))
end)

check("the editor's Test: the shield bar's sample, full, no amount, its whole length", function()
  reset()
  local d = D.New()
  d.text, d.keptTimes = "Break it", "P1 0:30"
  D.SetGroup(d, "mythic")
  d.shield.on, d.shield.unit, d.shield.length = true, "boss2", 15
  clock = 100
  wipe(timers)
  local ok, err = E:TestDraft({ encounterID = ENC }, d)
  assert(ok, "the test starts: " .. tostring(err))
  assert(A.run.reason == "test" and not listened("boss2"), "a Test listens to nothing")
  -- the quick test starts at its Show from: the cast 5 s after the click
  assert(#shields(104.9) == 0, "nothing before the cast")
  local l = shields(105)
  assert(#l == 1 and l[1].absorb.sample and l[1].absorb.max == 1 and l[1].absorb.value == 1, "from the cast, full")
  assert(#shields(119.9) == 1 and #shields(120.1) == 0, "for its 15 s")
  assert(#timers == 1 and timers[1].s >= 5 + 15, "the test runs the bar's whole length: " .. tostring(timers[1] and timers[1].s))
  A:Stop()
  -- a raid note line's item carries it too (the editor's note test builds it with ItemFor)
  local t = CRT.NoteParser.Parse("time:30;ph:1;tag:everyone;text:x;show:bar;shield:boss1,8;").timers[1]
  local it = CRT.NoteEngine.ItemFor(t, 1, true)
  assert(it.absorb and it.absorb.unit == "boss1" and it.absorb.length == 8, "the note line's test item")
  assert(CRT.NoteEngine.ItemFor(t, 1, false).absorb == nil, "someone else's line: none")
  assert(#errors == 0, tostring(errors[1]))
end)

-- One shield, one bar: a special alert, a raid note line and your own reminder all on boss2 show one bar, labelled by the
-- first of them in that order; two units still get a bar each
local S = CRT.AlertSpecial
local function withSpecial(ph)
  S.dev[ENC] = { { key = "shield", label = "Special shield", text = "Special shield", default = true, who = { mode = "everyone" },
    when = { times = "P" .. ph .. " 0:30" }, lead = 6, show = { callout = true, bar = true }, absorb = { unit = "boss2", length = 15, anyDifficulty = true } } }
  assert(S:Get(ENC, "shield"), "the special entry reads")
end
local function noteOn(ph, unit, difficulty)
  Notes:Import("EncounterID:" .. ENC .. ";Difficulty:" .. (difficulty or "Mythic") .. ";Name:Boss\\ntime:1;ph:1;tag:everyone;text:Pull;\\ntime:30;ph:" .. ph .. ";tag:everyone;text:Note shield;show:bar;warn:6;shield:" .. (unit or "boss2") .. ",10;")
end

check("one shield, one bar: a special alert, a note line and a reminder on boss2, timed", function()
  reset()
  withSpecial(1)
  noteOn(1)
  reminder()
  pull(16)
  fire("boss2", 126)
  local l = shields(126.5)
  assert(#l == 1, "one bar: " .. #l)
  assert(l[1].text == "Special shield", "the special alert's label: " .. tostring(l[1].text))
  for t = 126.5, 130, 0.5 do fire("boss2", t) end
  assert(#shields(130) == 1, "still one")
  S.dev[ENC] = nil
  A:Stop()
  assert(#errors == 0, tostring(errors[1]))
end)

check("one shield, one bar: untimed (phase 2 not reached), and a window opening later", function()
  reset()
  withSpecial(2)
  noteOn(2)
  reminder({ times = "P2 0:30" })
  pull(16)
  fire("boss2", 300)
  local l = shields(300.5)
  assert(#l == 1 and l[1].text == "Special shield", "untimed: one bar, the special alert's: " .. #l .. " " .. tostring(l[1] and l[1].text))
  A:Stop()
  -- your reminder's untimed bar first; then the note line's window opens on the same shield: one bar, the note's label.
  -- (The boss's only note is Heroic's and its line has no any: in this Mythic pull it has its window but no untimed watch.)
  reset()
  noteOn(1, "boss2", "Heroic")
  reminder({ group = "nh" }) -- a Mythic pull: untimed only
  pull(16)
  fire("boss2", 110)
  l = shields(110.5)
  assert(#l == 1 and l[1].text == "Break it", "your reminder's untimed bar: " .. tostring(l[1] and l[1].text))
  local st = l[1].absorb
  fire("boss2", 124.5) -- the note's window is open from 124; the reminder's bar runs until 125
  l = shields(124.8)
  assert(#l == 1 and l[1].absorb == st and l[1].text == "Note shield", "the window takes it over, labelled by the note: " .. #l .. " " .. tostring(l[1] and l[1].text))
  A:Stop()
  S.dev[ENC] = nil
  assert(#errors == 0, tostring(errors[1]))
end)

check("one shield, one bar: two units, two bars", function()
  reset()
  noteOn(1, "boss3")
  reminder()
  pull(16)
  fire("boss2", 126) fire("boss3", 126)
  local l = shields(126.5)
  assert(#l == 2, "boss2 and boss3: two bars: " .. #l)
  A:Stop()
  assert(#errors == 0, tostring(errors[1]))
end)

-- Your Shield bar choice on a special alert (Mech Alerts > Special): the engine reads the one in use (Special:Absorb),
-- for its timed windows and its untimed watch alike
check("a special alert's shield bar: your choice over the boss file's, timed and Any time", function()
  reset()
  CRT.db.alerts.special = {}
  withSpecial(1)
  local entry = S:Get(ENC, "shield")
  S:SetChoice(ENC, entry, "absorb", { unit = "boss3", length = 20, anyDifficulty = true })
  pull(16)
  assert(listened("boss3") and not listened("boss2"), "your unit is listened to, the shipped one isn't")
  fire("boss3", 125)
  local l = shields(125.5)
  assert(#l == 1 and l[1].text == "Special shield" and l[1].absorb.length == 20 and l[1].id:find("^special:shield:"), "the timed bar: yours, 20 s: " .. tostring(l[1] and l[1].id))
  assert(#shields(144.9) == 1 and #shields(145.1) == 0, "20 s long")
  A:Stop()
  -- false: the shipped bar is off, nothing listened to
  reset()
  withSpecial(1)
  S:SetChoice(ENC, entry, "absorb", false)
  pull(16)
  assert(not listened("boss2"), "Shield bar unticked: nothing listened to")
  fire("boss2", 126)
  assert(#shields(126.5) == 0, "and no bar")
  A:Stop()
  -- Any time: on a difficulty the entry isn't for, only your choice's anyDifficulty brings the untimed bar
  reset()
  S.dev[ENC] = { { key = "nh", label = "NH shield", text = "NH shield", default = true, difficulty = "nh", who = { mode = "everyone" },
    when = { times = "P1 0:30" }, show = { callout = true, bar = true } } }
  local nh = S:Get(ENC, "nh")
  S:SetChoice(ENC, nh, "absorb", { unit = "boss4", length = 12, anyDifficulty = false })
  pull(16)
  assert(not listened("boss4"), "an entry with no shipped bar, yours without Any time: a Mythic pull has nothing")
  A:Stop()
  S:SetChoice(ENC, nh, "absorb", { unit = "boss4", length = 12, anyDifficulty = true })
  pull(16)
  assert(listened("boss4"), "with Any time: the watch listens")
  fire("boss4", 150)
  l = shields(150.2)
  assert(#l == 1 and l[1].id == "absorb:nh:1" and l[1].absorb.length == 12 and l[1].text == "NH shield", "the untimed bar: " .. tostring(l[1] and l[1].id))
  A:Stop()
  S.dev[ENC] = nil
  CRT.db.alerts.special = {}
  assert(#errors == 0, tostring(errors[1]))
end)

check("Last pull: every boss pull listens to boss1 to boss5 until its end, with no shield bar too", function()
  reset()
  pull(16)
  local seen = {}
  for _, f in ipairs(frames) do local u = f.events.UNIT_ABSORB_AMOUNT_CHANGED if u then seen[u] = true end end
  assert(seen["boss1,boss2,boss3,boss4"] and seen.boss5, "two frames: boss1-boss4 and boss5")
  A:Stop()
  local left = false
  for _, f in ipairs(frames) do if f.events.UNIT_ABSORB_AMOUNT_CHANGED then left = true end end
  assert(not left, "dropped at the pull's end")
  -- a Test or a countdown records nothing
  CRT.db.alerts.shieldPulls = {}
  A:Start(ENC, "Mythic", "test")
  CRT.AlertShieldPulls.HandleEvent("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
  A:Stop()
  assert(next(CRT.db.alerts.shieldPulls) == nil, "a Test keeps no record")
end)

print(ok_ .. " passed, " .. fail .. " failed")
if fail > 0 then error("shield alerts: " .. fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const p of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
