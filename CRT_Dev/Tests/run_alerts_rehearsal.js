// The alerts engine's rehearsal run (Timeline Rehearsal plan, Task 2): a run driven by the Rehearsal
// window's clock, which may stand still, speed up or jump. Engine, speech, the bars and icons areas, the
// note engine (Preview as), the personal note window and CRT.AlertRoster, with game-like mocks.
// Args (in the TOC's order): CRT_Data/Bosses/Registry.lua CRT_Dev/Tests/SamplePack/Season.lua
//   CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua CRT_Modules/Groups/Data.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua
//   CRT_Modules/Alerts/Speech.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Notes/Engine.lua CRT_Modules/Notes/Window.lua CRT_Modules/Timeline/Data.lua
//   CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Alerts/Roster.lua CRT_Modules/Alerts/Reminders.lua CRT_Modules/Alerts/Areas.lua
//   CRT_Modules/Alerts/Bars.lua CRT_Modules/Alerts/Icons.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const placementLua = require('./placement_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const files = process.argv.slice(2);
if (files.length < 19) { console.error('usage: node run_alerts_rehearsal.js <19 files in TOC order>'); process.exit(2); }

const harness = themeLua(process.argv.slice(2)) + placementLua(process.argv.slice(2)) + `
local sources = { ... }
local clock = 1000
function GetTime() return clock end
format = string.format
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-17 12:00" end
function time() return 1700000000 end
function InCombatLockdown() return false end
function UnitName(u) if u == "player" then return "Cheoeqar" end return nil end
function UnitFullName(u) if u == "player" then return "Cheoeqar", "Area52" end return nil end
function UnitClass(u) if u == "player" then return "Mage", "MAGE" end return nil end
function UnitGroupRolesAssigned() return "DAMAGER" end
function GetNormalizedRealmName() return "Area52" end
-- As the game does: "none" leaves the realm out only for your own realm.
function Ambiguate(name, mode)
  local base, realm = name:match("^([^-]+)-(.+)$")
  if base and (mode == "short" or realm == "Area52") then return base end
  return name
end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
local raid = nil -- { { name, subgroup, classFile } } while in a raid
function IsInRaid() return raid ~= nil end
function IsInGroup() return raid ~= nil end
function IsInInstance() return false, "none" end
function GetNumGroupMembers() return raid and #raid or 1 end
function GetNumSubgroupMembers() return 0 end
function GetRaidRosterInfo(i) local r = raid and raid[i] if r then return r[1], 0, r[2], 80, r[3], r[3] end end
function UnitIsUnit(a, b) return a == b end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
C_Timer = { After = function() end, NewTicker = function() return { Cancel = function() end } end }
local secrets = {}
function issecretvalue(v) return secrets[v] == true end
local SECRET = {}
secrets[SECRET] = true
C_Spell = {
  GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end,
  GetSpellName = function(id) return "Spell" .. id end,
  GetSpellTexture = function(id) return 100000 + id end,
}
RAID_CLASS_COLORS = {}
LOCALIZED_CLASS_NAMES_MALE = { MAGE = "Mage", PRIEST = "Priest", DEATHKNIGHT = "Death Knight" }
SOUNDKIT = { RAID_WARNING = 8959 }
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end

-- Everything that could reach other players: counted, and never called in a rehearsal.
local sent = {}
local function spy(name) return function(...) sent[#sent + 1] = name end end
SendChatMessage = spy("SendChatMessage")
SendAddonMessage = spy("SendAddonMessage")
C_ChatInfo = { SendAddonMessage = spy("C_ChatInfo.SendAddonMessage"), SendChatMessage = spy("C_ChatInfo.SendChatMessage"),
  RegisterAddonMessagePrefix = function() end, SendAddonMessageLogged = spy("SendAddonMessageLogged") }
RaidNotice_AddMessage = spy("RaidNotice_AddMessage")
ActionButton_ShowOverlayGlow = spy("ActionButton_ShowOverlayGlow")
C_PartyInfo = { DoCountdown = spy("DoCountdown") }
local played = {}
PlaySound = function(kit) played[#played + 1] = kit end

-- Text to speech: what was said and every stop.
local said, stops = {}, 0
C_VoiceChat = {
  SpeakText = function(_, text) said[#said + 1] = text end,
  StopSpeakingText = function() stops = stops + 1 end,
}
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
Enum = { TtsVoiceType = { Standard = 0 } }

-- Mock frames: shown state, text, scripts, events, children and font strings. A Cooldown frame records
-- SetCooldown, Pause, Resume and Clear as the game would get them.
local all, named = {}, {}
local methods = {}
local function newObj(kind, parent, name)
  local o = setmetatable({ kind = kind, parent = parent, shown = true, scripts = {}, events = {},
    strings = {}, children = {}, text = "", w = 100, h = 20 }, { __index = function(t, k)
      local m = methods[k]
      if m then return m end
      if type(k) ~= "string" or not k:find("^%u") then return nil end
      return function() end
    end })
  if parent and type(parent) == "table" and parent.children then
    if kind == "FontString" then parent.strings[#parent.strings + 1] = o
    elseif kind ~= "Texture" then parent.children[#parent.children + 1] = o end
  end
  if name then named[name] = o end
  all[#all + 1] = o
  return o
end
function methods.Show(o) o.shown = true end
function methods.Hide(o) o.shown = false end
function methods.SetShown(o, v) o.shown = v and true or false end
function methods.IsShown(o) return o.shown end
function methods.SetScript(o, k, fn) o.scripts[k] = fn end
function methods.GetScript(o, k) return o.scripts[k] end
function methods.RegisterEvent(o, ev) o.events[ev] = true end
function methods.UnregisterEvent(o, ev) o.events[ev] = nil end
function methods.CreateFontString(o) return newObj("FontString", o) end
function methods.CreateTexture(o) return newObj("Texture", o) end
function methods.CreateAnimationGroup(o) return newObj("AnimationGroup", o) end
function methods.CreateAnimation(o) return newObj("Animation", o) end
function methods.Play(o) o.played = (rawget(o, "played") or 0) + 1 o.playing = true end
function methods.Stop(o) o.playing = false end
function methods.IsPlaying(o) return rawget(o, "playing") or false end
function methods.SetText(o, t) o.text = t end
function methods.GetText(o) return o.text end
function methods.GetFont() return "font", 14 end
function methods.SetFont() return true end
function methods.GetStringWidth(o) return #tostring(o.text) * 8 end
function methods.GetUnboundedStringWidth(o) return #tostring(o.text) * 8 end
function methods.SetSize(o, w, h) o.w, o.h = w, h end
function methods.SetWidth(o, w) o.w = w end
function methods.SetHeight(o, h) o.h = h end
function methods.GetWidth(o) return o.w end
function methods.GetHeight(o) return o.h end
function methods.GetFrameLevel() return 1 end
function methods.GetPoint() return "CENTER", nil, "CENTER", 0, 0 end
local function cdLog(o) local l = rawget(o, "cd") if not l then l = {} rawset(o, "cd", l) end return l end
function methods.SetCooldown(o, start, dur) table.insert(cdLog(o), { "set", start, dur }) end
function methods.Pause(o) table.insert(cdLog(o), { "pause" }) end
function methods.Resume(o) table.insert(cdLog(o), { "resume" }) end
function methods.Clear(o) table.insert(cdLog(o), { "clear" }) end
function CreateFrame(kind, name, parent) return newObj(kind, parent, name) end
function CreateFont(name) return newObj("Font", nil, name) end
UIParent = newObj("Frame")
GameFontHighlight = newObj("Font")
GameTooltip = newObj("GameTooltip")

local function fire(ev, ...)
  for _, o in ipairs(all) do
    if o.events[ev] and o.scripts.OnEvent then o.scripts.OnEvent(o, ev, ...) end
  end
end
-- One game frame: every OnUpdate script runs with the real seconds since the last.
local function frame(dt)
  for _, o in ipairs(all) do
    if o.scripts.OnUpdate then o.scripts.OnUpdate(o, dt) end
  end
end

local noteText = table.concat({
  "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali",
  "time:40;ph:1;tag:Rixxy;text:For Rixxy;",
  "time:41;ph:1;tag:Cheoeqar;text:For me;",
  "time:42;ph:1;tag:Mage;text:For mages;",
  "time:43;ph:1;tag:healer;text:For healers;",
  "time:44;ph:1;text:For no one;",
}, "\\n")
local CRT = {
  PALETTE = { accent = { 0.78, 0.56, 0.36 } },
  db = {
    ui = { outline = "" }, classCache = {}, roleCache = {},
    groups = { presets = {}, working = {}, active = nil },
    timeline = { references = {}, nextRef = 1, record = false, rows = {}, bosses = {}, keep = 5 },
    notes = {
      list = { [1] = { raw = noteText, name = "Nek'zali note", encounterID = 3470, difficulty = "Mythic" } },
      nextId = 2, trustedOnly = true, active = 1,
      window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
      assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
      personal = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
      personalText = "",
      alert = { enabled = false, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" },
    },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      areas = { icons = { shown = true, cap = 5, size = 44, fontSize = 20, grow = "down" } },
      reminders = {}, phases = {}, overrides = {}, nextId = 1, speechNotice = true },
  },
  UI = { Tint = function() end, OnTheme = function() end, RegisterLayer = function() end, RegisterPreview = function() end,
    ResetButtonWidth = function() return 44 end, ResetButton = function(p) return newObj("Button", p) end, Help = function(p) return newObj("Button", p) end },
  FONTS = {},
  FontPath = function() return "font" end,
  FontList = function() return {} end,
  Print = function() end,
  PlaySound = function(_, kit) played[#played + 1] = kit end,
}
CRT_THEME(CRT, CRT.UI)
CRT_PLACEMENT(CRT) -- UI/Placement.lua, which every area is placed by
for i = 1, #sources, 2 do
  local before = #all
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
  -- The Timeline's recorder is not under test: its frames hear no events and run no updates here.
  if sources[i]:find("CRT_Modules/Timeline/Data.lua", 1, true) then
    for j = before + 1, #all do all[j].events = {} all[j].scripts.OnUpdate = nil end
  end
end
fire("ADDON_LOADED", "CowfeeRaidTools")
fire("PLAYER_LOGIN")

local A, R, Notes, NW, Speech, Bars, Icons = CRT.Alerts, CRT.AlertReminders, CRT.Notes, CRT.NoteWindow,
  CRT.AlertSpeech, CRT.AlertBars, CRT.AlertIcons
local NE = CRT.NoteEngine
local win = named.CowfeeRaidToolsNote_personal
-- the window draws its lines as rows; what it shows, as one text, is its DrawnText
local body = win and setmetatable({}, { __index = function(_, k) if k == "text" then return NW:Get("personal"):DrawnText() end end })

-- The rehearsal clock, as the window would hand it over.
local fight, speed, playing = 0, 1, true
local function opts(as) return { clock = function() return fight end, speed = function() return speed end, as = as } end
-- Real seconds pass in game frames of 0.05 s; the fight clock moves with them while playing, at the speed.
local function advance(seconds)
  local steps = math.floor(seconds / 0.05 + 0.5)
  for _ = 1, steps do
    clock = clock + 0.05
    if playing then fight = fight + 0.05 * speed end
    frame(0.05)
  end
end
local function near(a, b, eps) return type(a) == "number" and type(b) == "number" and math.abs(a - b) < (eps or 1e-6) end

local blockItems = {}
local EID = 9999 -- a boss with no note and no reminders, for the tests of the engine alone
A:RegisterBlock("rtest", { label = "Rehearsal test", group = false, Entries = function() return blockItems end })
local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 21, hold = 0, warn = 10,
    outputs = { bar = true, icon = true } }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local function texts(lines)
  local out = {}
  for _, l in ipairs(lines) do out[#out + 1] = tostring(l.text) end
  table.sort(out)
  return table.concat(out, ",")
end
local function has(lines, text) for _, l in ipairs(lines) do if l.text == text then return true end end return false end

local results = {}
local function fresh()
  if A.running then A:Stop() end
  blockItems = {}
  clock, fight, speed, playing = 1000, 0, 1, true
  raid = nil
  CRT.db.alerts.reminders = {}
  CRT.db.alerts.nextId = 1
  CRT.db.groups.presets, CRT.db.groups.active = {}, nil
  CRT.db.classCache = {}
  CRT.db.notes.alert.tts = true
  CRT.db.notes.showOutsideRaid = true -- these checks are about the run, not where the windows may show
  wipe(said) stops = 0 wipe(sent) wipe(played)
  Speech:Reset()
  frame(0.2) -- the areas and speech settle on "no run"
  for _, o in ipairs(all) do rawset(o, "cd", nil) end -- each test reads its own swipe calls
end
local function test(name, fn)
  fresh()
  local ok, err = pcall(fn)
  if ok and #errors > 0 then ok, err = false, "error handler: " .. errors[1] end
  wipe(errors)
  results[#results + 1] = (ok and "ok " or "FAIL ") .. name .. (ok and "" or (": " .. tostring(err)))
end

test("Now is GetTime outside a rehearsal", function()
  assert(A:Now() == 1000, "no run: " .. tostring(A:Now()))
  assert(A:IsRehearsal() == false)
  fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
  clock = 1012
  assert(A:Now() == 1012 and A:IsRehearsal() == false, "encounter: " .. tostring(A:Now()))
  A:Start(3470, "Mythic", "test")
  assert(A:Now() == 1012 and A:IsRehearsal() == false, "test run")
end)

test("rehearsal run follows its clock", function()
  blockItems = { item{ id = "a", time = 50, text = "Soak" } }
  fight = 30
  A:Start(EID, "Mythic", "rehearsal", opts())
  assert(A.running and A:IsRehearsal(), "rehearsal running")
  assert(A.run.reason == "rehearsal")
  local base = A:TimeAt(0)
  assert(near(A:Now(), base + 30), "now is base + clock")
  assert(near(A:PhaseStart(1), base), "phase 1 at fight second 0")
  assert(near(A:Elapsed(), 30), "elapsed " .. tostring(A:Elapsed()))
  advance(2) -- 1x: the fight moves with the real time
  assert(near(A:Now(), base + 32, 1e-6) and near(A:Elapsed(), 32, 1e-6), "1x")
  speed = 2
  advance(3) -- 2x: six fight seconds in three
  assert(near(A:Elapsed(), 38, 1e-6), "2x elapsed " .. tostring(A:Elapsed()))
  local bars = Bars:Visible()
  assert(#bars == 1 and bars[1].text == "Soak" and bars[1].time == format("%d", math.floor(50 - fight)) and near(fight, 38, 1e-6),
    "bar counts on the clock: " .. tostring(bars[1] and bars[1].time))
  -- the base stays where Start put it
  assert(near(A:TimeAt(0), base))
end)

test("rehearsal pause freezes the alerts", function()
  blockItems = { item{ id = "a", time = 20, text = "Soak", outputs = { bar = true, icon = true, alert = true } } }
  A:Start(EID, "Mythic", "rehearsal", opts())
  advance(15)
  local bar = Bars:Visible()[1]
  local icon = Icons:Visible()[1]
  assert(bar and icon, "bar and icon showing")
  local t1, f1, s1 = bar.time, bar.fraction, icon.seconds.text
  playing = false
  advance(5)
  local bar2, icon2 = Bars:Visible()[1], Icons:Visible()[1]
  assert(bar2.time == t1 and near(bar2.fraction, f1), "bar frozen: " .. t1 .. " -> " .. bar2.time)
  assert(icon2.seconds.text == s1, "icon seconds frozen")
  assert(CRT.AlertRules.Alert(A:Lines(A:Now()), A:Now()), "the alert still shows")
  assert(near(A:Elapsed(), 15, 1e-6), "elapsed stands still")
end)

test("rehearsal skips items before the clock", function()
  blockItems = { item{ id = "a", time = 10, text = "Early", outputs = { bar = true, speech = true }, speech = { { offset = 0, text = "Early" } } },
    item{ id = "b", time = 30, hold = 3, text = "Passing" }, item{ id = "c", time = 31, text = "Next" } }
  fight = 30.5
  A:Start(EID, "Mythic", "rehearsal", opts())
  local lines = A:Lines(A:Now())
  assert(texts(lines) == "Next", "only the item after the clock: " .. texts(lines))
  advance(2)
  for _, s in ipairs(said) do assert(s ~= "Early", "an item before the clock was read out") end
  -- the same items in a run that is not a rehearsal all show
  A:Start(EID, "Mythic", "test")
  assert(#A:Lines(A:Now()) == 3)
end)

test("a jump keeps an item due just after it", function()
  blockItems = { item{ id = "a", time = 35, text = "Soak", warn = 10, icon = 136243 } }
  fight = 30 -- the item's warning began at 25, before the jump
  A:Start(EID, "Mythic", "rehearsal", opts())
  advance(0.2)
  local bar, icon = Bars:Visible()[1], Icons:Visible()[1]
  assert(bar and bar.time == "4.8", "bar from the right point: " .. tostring(bar and bar.time))
  assert(icon and icon.seconds.text == "5", "icon countdown from the right point: " .. tostring(icon and icon.seconds.text))
  -- part-way through: the bar fills over its 20 s lead (4.8 of 20 left), the swipe over its 10 s warning
  assert(near(bar.fraction, 4.8 / 20, 1e-3), "bar fill part-way: " .. tostring(bar.fraction))
  local log = icon.cooldown.cd
  local set = log and log[1]
  assert(set and set[1] == "set" and near(set[3], 10, 1e-6) and near(set[2] + set[3] - clock, 4.8, 0.06),
    "swipe part-way: " .. tostring(set and set[2]) .. " " .. tostring(set and set[3]))
end)

test("an item exactly at the jump point stays", function()
  blockItems = { item{ id = "o", ph = 1, time = 500, text = "P1" }, item{ id = "a", ph = 2, time = 28.8, text = "At the jump" } }
  fight = 30.1
  A:Start(EID, "Mythic", "rehearsal", opts())
  A:StartPhase(2, "rehearsal", A:TimeAt(1.3))
  assert(has(A:Lines(A:Now()), "At the jump"), "dropped by rounding: " .. texts(A:Lines(A:Now())))
end)

test("rehearsal speech only at 1x", function()
  blockItems = {
    item{ id = "a", time = 10, text = "A", outputs = { speech = true }, speech = { { offset = 0, text = "Alpha" } } },
    item{ id = "b", time = 10, text = "B", outputs = { speech = true }, speech = { { offset = 0, text = "Bravo" } } },
    item{ id = "c", time = 20, text = "C", outputs = { speech = true }, speech = { { offset = 0, text = "Charlie" } } },
    item{ id = "d", time = 30, text = "D", outputs = { speech = true }, speech = { { offset = 0, text = "Delta" } } },
  }
  A:Start(EID, "Mythic", "rehearsal", opts())
  advance(10.2)
  assert(#said == 1 and said[1] == "Alpha", "1x speaks: " .. table.concat(said, ","))
  assert(#Speech.queue == 1, "speech already queued at 1x stays")
  speed = 2
  advance(0.2)
  assert(stops == 1, "a change away from 1x stops what is said: " .. stops)
  assert(#Speech.queue == 0, "the queue is dropped")
  advance(5) -- fight 20 passes at 2x
  for _, s in ipairs(said) do assert(s ~= "Charlie" and s ~= "Bravo", "spoke at 2x: " .. s) end
  speed = 1
  advance(10) -- past fight 30 at 1x
  assert(said[#said] == "Delta", "back at 1x speaks again: " .. table.concat(said, ","))
  assert(stops == 1, "no stop while at 1x")
end)

test("rehearsal icon swipe follows pause and speed", function()
  blockItems = { item{ id = "a", time = 20, text = "Soak", warn = 10, icon = 136243 } }
  A:Start(EID, "Mythic", "rehearsal", opts())
  advance(12)
  local icon = Icons:Visible()[1]
  assert(icon, "icon showing")
  local log = icon.cooldown.cd
  local function dump(l) local o = {} for _, c in ipairs(l or {}) do o[#o + 1] = table.concat({ tostring(c[1]), tostring(c[2]), tostring(c[3]) }, " ") end return table.concat(o, "; ") end
  assert(log and log[1][1] == "set", "swipe set: " .. dump(log))
  -- first shown at fight 10 (warn 10): ten seconds, on real time at 1x
  assert(near(log[1][3], 10, 1e-6), "1x duration " .. tostring(log[1][3]))
  local n = #log
  playing = false
  advance(1)
  assert(#log > n and log[#log][1] == "pause", "paused with the clock: " .. tostring(log[#log][1]))
  local fightAt = fight
  n = #log
  advance(2)
  assert(#log == n, "nothing more while paused")
  playing, speed = true, 2
  advance(0.2)
  local last
  for i = n + 1, #log do if log[i][1] == "set" then last = log[i] end end
  assert(last, "set again on resume at 2x")
  -- the swipe runs over the time left divided by the speed: it ends when the clock reaches 20
  local realEnd = last[2] + last[3]
  local fightLeft = 20 - fight
  assert(near(realEnd - clock, fightLeft / 2, 0.06), "ends at the item's time: " .. (realEnd - clock) .. " vs " .. fightLeft / 2)
  assert(near(last[3], 10 / 2, 1e-6), "whole swipe scaled by the speed: " .. last[3])
end)

local function cdDump(l) local o = {} for _, c in ipairs(l or {}) do o[#o + 1] = c[1] end return table.concat(o, ",") end

test("rehearsal: a paused swipe resumes for a real run", function()
  blockItems = { item{ id = "a", time = 20, text = "Soak", warn = 10, icon = 136243 } }
  A:Start(EID, "Mythic", "rehearsal", opts())
  advance(12)
  playing = false
  advance(0.5)
  local icon = Icons:Visible()[1]
  assert(icon.cooldown.cd[#icon.cooldown.cd][1] == "pause", "paused: " .. cdDump(icon.cooldown.cd))
  local n = #icon.cooldown.cd
  clock = clock + 1
  A:Start(EID, "Mythic", "test")
  advance(11) -- the item shows again in the real run, on the same widget
  assert(Icons:Visible()[1] == icon, "same widget")
  local log = icon.cooldown.cd
  local resumed = false
  for i = n + 1, #log do if log[i][1] == "resume" then resumed = true end end
  assert(resumed, "resumed for the real run: " .. cdDump(log))
end)

test("rehearsal swipe starts paused and stays paused through a speed change", function()
  blockItems = { item{ id = "a", time = 12, text = "Soak", warn = 10, icon = 136243 } }
  fight = 5
  playing = false
  A:Start(EID, "Mythic", "rehearsal", opts())
  advance(0.5)
  local log = Icons:Visible()[1].cooldown.cd
  local first
  for i, c in ipairs(log) do if c[1] == "set" then first = i break end end
  assert(first and log[first + 1] and log[first + 1][1] == "pause", "never runs for a tick: " .. cdDump(log))
  speed = 4
  advance(0.5)
  assert(log[#log][1] == "pause", "a speed change while paused stays paused: " .. cdDump(log))
end)

test("test icons ignore the rehearsal's pause and speed", function()
  A:Start(EID, "Mythic", "rehearsal", opts())
  speed, playing = 2, false
  advance(0.5)
  local at = clock + 5
  Icons:Test({ { id = "t1", text = "T", icon = 136243, at = at, warn = 10 } })
  advance(0.3)
  local w = Icons:Visible()[1]
  local log = w and w.cooldown.cd
  assert(log and #log >= 1, "test icon shown")
  for _, c in ipairs(log) do assert(c[1] ~= "pause", "test icon paused: " .. cdDump(log)) end
  local last = log[#log]
  assert(last[1] == "set" and near(last[2] + last[3], at, 1e-6), "plain real-time swipe")
end)

test("a new run forgets when lines first showed", function()
  blockItems = { item{ id = "a", time = 15, text = "Soak" } }
  A:Start(EID, "Mythic", "test")
  advance(0.2)
  clock = clock + 1
  blockItems = { item{ id = "a", time = 19, text = "Soak" } }
  A:Start(EID, "Mythic", "test")
  advance(0.2)
  local b = Bars:Visible()[1]
  assert(b and b.fraction > 0.98, "fills from the new run's first sight: " .. tostring(b and b.fraction))
end)

test("rehearsal bars freeze on pause", function()
  blockItems = { item{ id = "a", time = 30, text = "Soak" } }
  A:Start(EID, "Mythic", "rehearsal", opts())
  advance(15)
  local b = Bars:Visible()[1]
  local t1, f1 = b.time, b.fraction
  playing = false
  advance(3)
  b = Bars:Visible()[1]
  assert(b.time == t1 and near(b.fraction, f1), "frozen on pause")
  playing, speed = true, 2
  advance(1)
  b = Bars:Visible()[1]
  assert(near(fight, 17, 1e-6) and b.time == format("%d", math.floor(30 - fight)), "two fight seconds in one at 2x: " .. b.time)
end)

test("rehearsal personal note window counts on the clock", function()
  assert(win and body, "personal window")
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Move", times = "P1 0:30" })
  fight = 10
  A:Start(3470, "Mythic", "rehearsal", opts())
  NW:RefreshAll()
  assert(body.text:find("> 0:20|r", 1, true), "counts from the clock:\\n" .. body.text)
  advance(2)
  NW:RefreshAll()
  assert(body.text:find("> 0:18|r", 1, true), "moves with it:\\n" .. body.text)
  playing = false
  advance(5)
  NW:RefreshAll()
  assert(body.text:find("> 0:18|r", 1, true), "stands still on pause:\\n" .. body.text)
end)

local function mineReminder()
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "My own", times = "P1 0:45",
    outputs = { bar = true } })
end

test("preview as another player", function()
  mineReminder()
  CRT.db.classCache["rixxy-area52"] = "MAGE"
  raid = { { "Cheoeqar", 1, "MAGE" }, { "Rixxy", 2, "MAGE" } }
  A:Start(3470, "Mythic", "rehearsal", opts("Rixxy"))
  local lines = A:Lines(A:Now())
  assert(texts(lines) == "For Rixxy,For mages", "their lines only: " .. texts(lines))
  assert(not has(lines, "My own"), "none of your reminders")
  assert(NE:Note() ~= nil and NE.running, "the timers window runs the note")
  -- as a priest: no class line, still their own
  CRT.db.classCache["rixxy-area52"] = "PRIEST"
  raid = nil
  A:Start(3470, "Mythic", "rehearsal", opts("Rixxy"))
  assert(texts(A:Lines(A:Now())) == "For Rixxy", "class from the roster: " .. texts(A:Lines(A:Now())))
  -- as yourself (nil): your lines and your reminders
  A:Start(3470, "Mythic", "rehearsal", opts())
  lines = A:Lines(A:Now())
  assert(has(lines, "For me") and has(lines, "For mages") and has(lines, "My own") and not has(lines, "For Rixxy"),
    "as you: " .. texts(lines))
end)

test("preview as another player leaves out your personal note", function()
  local def = A.blocks.personal
  assert(def and def.own, "the personal note block is yours")
  local entries = def.Entries
  def.Entries = function() return { { id = "personal:1", ph = 1, time = 30, text = "My personal line",
    outputs = { alert = true, bar = true }, priority = 20, hold = 0, warn = 5 } } end
  A:Start(3470, "Mythic", "rehearsal", opts("Rixxy"))
  local asThem = has(A:Lines(A:Now()), "My personal line")
  A:Start(3470, "Mythic", "rehearsal", opts())
  local asYou = has(A:Lines(A:Now()), "My personal line")
  def.Entries = entries
  assert(not asThem, "not shown as another player")
  assert(asYou, "shown as you")
end)

test("preview as yourself counts as you", function()
  mineReminder()
  A:Start(3470, "Mythic", "rehearsal", opts("Cheoeqar"))
  local lines = A:Lines(A:Now())
  assert(has(lines, "For me") and has(lines, "For mages") and has(lines, "My own") and not has(lines, "For Rixxy"),
    "as your own name: " .. texts(lines))
end)

test("rehearsal: timers window shows the rehearsed note", function()
  local timers = named.CowfeeRaidToolsNote_window
  assert(timers, "timers window")
  local tbody = setmetatable({}, { __index = function(_, k) if k == "text" then return NW:Get("window"):DrawnText() end end })
  CRT.db.notes.list[2] = { raw = "EncounterID:1111;Difficulty:Mythic;Name:Other\\ntime:5;ph:1;text:Other boss;", name = "Other note", encounterID = 1111, difficulty = "Mythic" }
  CRT.db.notes.active = 2
  Notes:Fire()
  fight = 30
  A:Start(3470, "Mythic", "rehearsal", opts("Rixxy"))
  NW:RefreshAll()
  local text = tbody.text
  assert(text:find("For Rixxy", 1, true) and not text:find("Other boss", 1, true), "the rehearsed note:\\n" .. text)
  assert(text:find("0:10", 1, true), "counts on the clock:\\n" .. text)
  assert(text:find("For no one", 1, true) and not text:find("For me", 1, true), "Preview as filter:\\n" .. text)
  playing = false
  advance(3)
  NW:RefreshAll()
  assert(tbody.text:find("0:10", 1, true), "stands still on pause:\\n" .. tbody.text)
  A:Stop()
  CRT.db.notes.list[2] = nil
  CRT.db.notes.active = 1
  Notes:Fire()
end)

test("preview as everyone", function()
  mineReminder()
  A:Start(3470, "Mythic", "rehearsal", opts("*"))
  local lines = A:Lines(A:Now())
  assert(texts(lines) == "For Rixxy,For healers,For mages,For me,My own", "every tagged line and yours: " .. texts(lines))
  assert(not has(lines, "For no one"), "No one stays in the timers window")
  -- outside a rehearsal Preview as never applies
  fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
  lines = A:Lines(A:Now())
  assert(not has(lines, "For Rixxy") and has(lines, "For me"), "encounter: " .. texts(lines))
end)

test("a rehearsal run sends nothing", function()
  mineReminder()
  blockItems = { item{ id = "a", time = 5, text = "Loud", sound = "RAID_WARNING", glow = true,
    outputs = { bar = true, icon = true, speech = true, alert = true }, speech = { { offset = 0, text = "Loud" } } } }
  A:Start(3470, "Mythic", "rehearsal", opts("*"))
  A:StartPhase(2, "rehearsal", A:TimeAt(20))
  advance(50)
  A:Stop()
  advance(0.5)
  assert(#sent == 0, "sent: " .. table.concat(sent, ","))
  assert(#played >= 1, "a sound still plays here")
end)

test("rehearsal fires no pull hooks", function()
  local pulled = 0
  A.onPull[#A.onPull + 1] = function() pulled = pulled + 1 end
  local setActive = Notes.SetActive
  local activated = 0
  Notes.SetActive = function(...) activated = activated + 1 return setActive(...) end
  A:Start(3470, "Mythic", "rehearsal", opts())
  Notes.SetActive = setActive
  table.remove(A.onPull)
  assert(pulled == 0, "pull hooks ran")
  assert(activated == 0, "the active note changed")
end)

test("an encounter replaces a rehearsal run", function()
  blockItems = { item{ id = "a", time = 50, text = "Soak" } }
  fight = 100
  A:Start(3470, "Mythic", "rehearsal", opts())
  -- an encounter ending elsewhere leaves the rehearsal going
  fire("ENCOUNTER_END", 3470)
  assert(A.running and A:IsRehearsal(), "ENCOUNTER_END leaves it")
  clock = 1010
  fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
  assert(A.running and A.run.reason == "encounter" and not A:IsRehearsal(), "replaced")
  assert(A:Now() == 1010 and A:PhaseStart(1) == 1010, "real time again")
  fight = 400
  assert(A:Now() == 1010, "the old clock no longer counts")
  assert(has(A:Lines(A:Now()), "For me"), "the encounter's note runs")
end)

test("TimeAt and StartPhase in a rehearsal", function()
  blockItems = { item{ id = "o", ph = 1, time = 500, text = "P1" },
    item{ id = "a", ph = 2, time = 5, text = "P2 early" }, item{ id = "b", ph = 2, time = 45, text = "P2 late" } }
  A:Start(EID, "Mythic", "rehearsal", opts())
  local base = A:TimeAt(0)
  assert(near(A:TimeAt(60), base + 60))
  assert(A:StartPhase(2, "rehearsal", A:TimeAt(60)) == true)
  assert(near(A:PhaseStart(2), base + 60))
  local lines = A:Lines(A:Now())
  -- phase 1's line after phase 2's start is masked, as in any run
  assert(texts(lines) == "P2 early,P2 late" and near(lines[1].at, base + 65), "phase 2 items from its start: " .. texts(lines))
  -- a jump to 100: the run starts again and the window starts the phases before it
  A:Stop(true)
  fight = 100
  A:Start(EID, "Mythic", "rehearsal", opts())
  assert(A:StartPhase(2, "rehearsal", A:TimeAt(60)) == true)
  lines = A:Lines(A:Now())
  assert(texts(lines) == "P2 late", "only what is after the jump: " .. texts(lines))
  assert(lines[1].text == "P2 late" and near(lines[1].at, A:TimeAt(105)))
end)

test("rehearsal: extra items fire, replaced saved one does not", function()
  mineReminder() -- reminder 1, "My own" at 0:45
  local o = opts()
  o.extra = { item{ id = "mine:test:1", time = 46, text = "Draft", block = "minetest" },
    item{ id = "mine:test:2", time = 10, text = "Too early", block = "minetest" } }
  o.replaces = { block = "mine", id = 1 }
  fight = 30
  A:Start(3470, "Mythic", "rehearsal", o)
  local lines = A:Lines(A:Now())
  assert(has(lines, "Draft"), "the draft's item fires: " .. texts(lines))
  assert(not has(lines, "Too early"), "an extra item before the clock is cut like any other: " .. texts(lines))
  assert(not has(lines, "My own"), "the saved reminder is left out: " .. texts(lines))
  assert(has(lines, "For me"), "the rest of the fight still runs: " .. texts(lines))
  -- a raid note line: line 3 of note 1 ("For me") is left out, the others stay
  o = opts()
  o.extra = { item{ id = "note:test:1", time = 41, text = "Draft line", block = "note" } }
  o.replaces = { block = "note", noteID = 1, line = 3 }
  A:Start(3470, "Mythic", "rehearsal", o)
  lines = A:Lines(A:Now())
  assert(has(lines, "Draft line") and not has(lines, "For me"), "note line replaced: " .. texts(lines))
  assert(has(lines, "For mages") and has(lines, "My own"), "other lines stay: " .. texts(lines))
  -- another note's line 3 is not this one
  o.replaces = { block = "note", noteID = 7, line = 3 }
  A:Start(3470, "Mythic", "rehearsal", o)
  assert(has(A:Lines(A:Now()), "For me"), "a different note's line is not left out")
end)

test("rehearsal: extra and replaces only in a rehearsal", function()
  mineReminder()
  local o = { extra = { item{ id = "mine:test:1", time = 46, text = "Draft", block = "minetest" } },
    replaces = { block = "mine", id = 1 } }
  A:Start(3470, "Mythic", "test", o)
  local lines = A:Lines(A:Now())
  assert(not has(lines, "Draft") and has(lines, "My own"), "test run: " .. texts(lines))
  A:Start(3470, "Mythic", "encounter", o)
  lines = A:Lines(A:Now())
  assert(not has(lines, "Draft") and has(lines, "My own"), "encounter run: " .. texts(lines))
end)

test("roster: active layout with classes, else the live group", function()
  local Roster = CRT.AlertRoster
  assert(Roster and Roster.Players, "CRT.AlertRoster:Players")
  CRT.db.groups.presets = { { id = 1, name = "Main", slots = { "Rixxy-Area52", "Abu-Area52", "Zed-Other", "rixxy-area52" } } }
  CRT.db.groups.active = 1
  CRT.db.classCache["rixxy-area52"] = "MAGE"
  CRT.db.classCache["abu-area52"] = "WARRIOR" -- the live group wins
  raid = { { "Cheoeqar", 1, "MAGE" }, { "Abu", 1, "PRIEST" } }
  local list = Roster:Players()
  local got = {}
  for _, p in ipairs(list) do got[#got + 1] = p.name .. ":" .. tostring(p.class) .. ":" .. p.key end
  assert(table.concat(got, ",") == "Abu:PRIEST:Abu-Area52,Rixxy:MAGE:Rixxy-Area52,Zed-Other:nil:Zed-Other",
    "active layout: " .. table.concat(got, ","))
  -- a class the game hides is left out
  CRT.db.classCache["rixxy-area52"] = SECRET
  list = Roster:Players()
  assert(list[2].name == "Rixxy" and list[2].class == nil, "secret class left out")
  -- no active layout: the live group
  CRT.db.groups.active = nil
  got = {}
  for _, p in ipairs(Roster:Players()) do got[#got + 1] = p.name .. ":" .. tostring(p.class) end
  assert(table.concat(got, ",") == "Abu:PRIEST,Cheoeqar:MAGE", "live group: " .. table.concat(got, ","))
  -- an empty active layout: the live group too
  CRT.db.groups.presets[1].slots = {}
  CRT.db.groups.active = 1
  assert(#Roster:Players() == 2, "empty layout falls back")
end)

return table.concat(results, "\\n")
`;

const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.log('FAIL load: ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, files.length * 2 + 8);
for (const p of files) {
  const rel = p.replace(/\\/g, '/').replace(/^.*?\/(Bosses|Seasons|Alerts|Notes|Timeline|Groups)\//, '$1/');
  lua.lua_pushstring(L, to_luastring(rel));
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'return'));
}
if (lua.lua_pcall(L, files.length * 2, 1, 0) !== lua.LUA_OK) { console.log('FAIL run: ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
const out = lua.lua_tojsstring(L, -1);
console.log(out);
const failed = out.split('\n').filter((l) => l.startsWith('FAIL')).length;
if (failed) { console.log(failed + ' failed'); process.exit(1); }
