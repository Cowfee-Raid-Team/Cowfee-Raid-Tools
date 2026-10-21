// CRT_Modules/Alerts/GameTimeline.lua: our alerts in the game's boss timeline (C_EncounterTimeline script events),
// Show in, and Replace the game's timeline, with a mock C_EncounterTimeline and EncounterTimeline frame. Also the dev
// probe (CRT_Dev/Dev/GameTimelineProbe.lua) and that it never ships.
// Usage: node run_alerts_gametimeline.js CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Areas.lua
//   CRT_Modules/Alerts/GameTimeline.lua CRT_Modules/Alerts/TimelineArea.lua CRT_Modules/Timeline/Reference.lua
//   CRT_Modules/Alerts/Colors.lua CRT_Dev/Dev/GameTimelineProbe.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local rulesSrc, engineSrc, areasSrc, gameSrc, timelineSrc, referenceSrc, colorsSrc, probeSrc = ...
local frames = {}
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, checked = false, text = "", pts = {}, w = 0, h = 0, alpha = 1, scale = 1 }
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
    if k == "GetScript" then return function(self, n) return rawget(self, n) end end
    if k == "RegisterEvent" then return function(self, e) rawset(self, "ev_" .. e, true) end end
    if k == "UnregisterEvent" then return function(self, e) rawset(self, "ev_" .. e, nil) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return self.w end end
    if k == "GetHeight" then return function(self) return self.h end end
    if k == "GetUnboundedStringWidth" or k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetCenter" then return function(self) if self == UIParent then return 480, 300 end return 530, 450 end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabledState", on and true or false) end end
    if k == "GetFrameLevel" then return function() return 1 end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
local created = {}
function CreateFrame(kind, name, parent, template)
  local f = mock(kind, parent, template)
  if name then created[name] = f end
  return f
end
local clock = 100
format = string.format
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
local SECRET = setmetatable({}, { __tostring = function() return "SECRET" end })
function issecretvalue(v) return v == SECRET end
local combat = false
function InCombatLockdown() return combat end
local printed = {}
local rawPrint = print
print = function(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end printed[#printed + 1] = table.concat(t, " ") end

-- The game's API as Gethe/wow-ui-source documents it (EncounterTimelineDocumentation.lua and the constants files).
Enum = {
  EncounterTimelineViewType = { None = 0, Timeline = 1, Bars = 2 },
  EncounterEventSeverity = { Low = 0, Medium = 1, High = 2 },
  EncounterEventIconmask = { DeadlyEffect = 1, EnrageEffect = 2, BleedEffect = 4, MagicEffect = 8, DiseaseEffect = 16,
    CurseEffect = 32, PoisonEffect = 64, TankRole = 128, HealerRole = 256, DpsRole = 512 },
  EncounterTimelineEventSource = { Encounter = 0, Script = 1, EditMode = 2 },
}
local api
local function resetApi()
  api = { added = {}, order = {}, canceled = {}, finished = {}, nextId = 0, enabled = true, view = 2, viewSets = {}, failNext = false }
end
resetApi()
local function noSecrets(t)
  for k, v in pairs(t) do assert(not issecretvalue(v), "a secret value passed as " .. tostring(k)) end
end
C_EncounterTimeline = {
  IsFeatureAvailable = function() return true end,
  IsFeatureEnabled = function() return api.enabled end,
  AddScriptEvent = function(req)
    assert(type(req) == "table", "a request table")
    noSecrets(req)
    if api.failNext then api.failNext = false error("AddScriptEvent failed") end
    api.nextId = api.nextId + 1
    api.added[api.nextId] = req
    api.order[#api.order + 1] = api.nextId
    return api.nextId
  end,
  CancelScriptEvent = function(id) assert(not issecretvalue(id)) api.canceled[#api.canceled + 1] = id end,
  FinishScriptEvent = function(id) assert(not issecretvalue(id)) api.finished[#api.finished + 1] = id end,
  CancelAllScriptEvents = function() api.cancelAll = true end,
  SetViewType = function(v) assert(not issecretvalue(v)) api.view = v api.viewSets[#api.viewSets + 1] = v end,
  GetViewType = function() return api.view end,
  GetEventInfo = function(id) local r = api.added[id] if not r then return nil end
    return { id = id, source = 1, spellName = r.overrideName, spellID = r.spellID, iconFileID = r.iconFileID, duration = r.duration, maxQueueDuration = 0, icons = r.icons or 0, severity = r.severity, isApproximate = false } end,
  GetEventState = function(id) return api.added[id] and 0 or nil end,
  HasVisibleEvents = function() return next(api.added) ~= nil end,
}
local editModeView = 2 -- the player's Edit Mode choice: Bars
EncounterTimeline = { attrs = {}, hides = 0, anchors = 0 }
function EncounterTimeline:SetAttribute(k, v) self.attrs[k] = v end
function EncounterTimeline:GetAttribute(k) return self.attrs[k] end
function EncounterTimeline:Hide() self.hides = self.hides + 1 end
function EncounterTimeline:ClearAllPoints() self.anchors = self.anchors + 1 end
function EncounterTimeline:SetPoint() self.anchors = self.anchors + 1 end
function EncounterTimeline:UpdateSystemSettingViewType() -- as EncounterTimeline.lua does it
  C_EncounterTimeline.SetViewType(self:GetAttribute("overrideViewType") or editModeView)
end

local function defaults() return {
  bars = { shown = true, noteLines = true, cap = 5, ahead = 20 },
  areas = {
    timeline = { shown = true, cap = 5, direction = "down", side = "right", length = 300, seconds = 10, size = 32, thickness = 2,
      showNames = true, showCountdown = true, tenths = 0, badges = true, ticks = "5", nowEffect = "flash", nowText = "NOW!",
      nowTime = 1, stack = true, font = "Friz Quadrata", fontSize = 14, gameMode = "standalone", gameAlsoHere = false },
  },
  customColors = false,
  reminders = {}, phases = {}, overrides = {}, nextId = 1 } end
local previews, layers, dropdowns, sliders = {}, {}, {}, {}
local CRT = { db = { alerts = defaults() } }
function CRT:Print(msg) printed[#printed + 1] = msg end
CRT.Timeline = { readable = function(v) local ok, s = pcall(issecretvalue, v); return ok and not s end }
local fontList = { { name = "Friz Quadrata", path = "Fonts\\\\FRIZQT__.TTF" } }
function CRT:FontList() return fontList end
function CRT:FontPath(name) return fontList[1].path end
CRT.UI = {
  RegisterLayer = function(_, key, f) layers[key] = f end,
  RegisterPreview = function(_, key, fn) previews[key] = fn end,
  ResetButtonWidth = function() return 44 end, ResetButton = function(parent) return mock("Button", parent) end,
  Help = function(parent, title, text) local b = mock("Button", parent) rawset(b, "helpTitle", title) rawset(b, "helpText", text) return b end,
  Dropdown = function(parent, label, opts) local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    local function menu() local o = opts.options local list = type(o) == "function" and o() or o rawset(r, "list", list) rawset(r, "value", opts.get()) end
    menu()
    rawset(r, "refresh", function() menu() if opts.enabledIf then rawset(r, "enabled", opts.enabledIf() and true or false) end end) dropdowns[label] = r return r end,
  Slider = function(parent, label, opts) local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    rawset(r, "refresh", function() end) sliders[label] = r return r end,
}
local spells = { [100] = { name = "Spell Name", icon = 555 } }
CRT.Notes = { SpellInfo = function(_, id) return spells[id] end }
assert(load(rulesSrc, "Rules"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "Engine"))("CowfeeRaidTools", CRT)
assert(load(referenceSrc, "Reference"))("CowfeeRaidTools", CRT)
assert(load(colorsSrc, "Colors"))("CowfeeRaidTools", CRT)
CRT_THEME(CRT, CRT.UI)
assert(load(areasSrc, "Areas"))("CowfeeRaidTools", CRT)
assert(load(gameSrc, "GameTimeline"))("CowfeeRaidTools", CRT)
assert(load(timelineSrc, "TimelineArea"))("CowfeeRaidTools", CRT)
assert(load(probeSrc, "GameTimelineProbe"))("CowfeeRaidTools", CRT)
local A, Areas, T, G = CRT.Alerts, CRT.AlertAreas, CRT.AlertTimeline, CRT.AlertGameTimeline
local panel = Areas.Panel(CreateFrame("Frame", nil, UIParent))
for _, f in ipairs(frames) do -- the areas' ticker builds them at login
  if f ~= G.frame and rawget(f, "OnUpdate") and rawget(f, "OnEvent") then f.OnEvent(f, "PLAYER_LOGIN") end
end

local fails = 0
-- print is captured for the probe, so the results go out through the real one
local out = rawPrint
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then out("ok " .. name) else out("FAIL " .. name .. ": " .. tostring(err)) fails = fails + 1 end
end
local function near(a, b) return math.abs(a - b) < 1e-6 end

local items = {}
A:RegisterBlock("rem", { label = "Reminders", group = false, Entries = function()
  local list = {}
  for _, it in ipairs(items) do local c = {} for k, v in pairs(it) do c[k] = v end list[#list + 1] = c end
  return list
end })
local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 32, hold = 0.5, warn = 8, outputs = { timeline = true } }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local function s() return CRT.db.alerts.areas.timeline end
local function pull(list, settings)
  A:Stop()
  resetApi()
  items = list or {}
  clock = 100
  CRT.db.alerts = defaults()
  for k, v in pairs(settings or {}) do s()[k] = v end
end
local function start() A.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16) end
local function count(t) local n = 0 for _ in pairs(t) do n = n + 1 end return n end
local function shownNames()
  T:Refresh()
  local names = {}
  for _, w in ipairs(T:Visible()) do names[#names + 1] = w.name.text end
  return table.concat(names, ",")
end

local ADD = { gameMode = "add" }
local function with(extra) local t = { gameMode = "add" } for k, v in pairs(extra) do t[k] = v end return t end

check("game timeline: Standalone, the default, sends nothing and leaves the game's timeline alone", function()
  pull({ item{ id = "st", time = 4, text = "Alone" } })
  G.frame.OnEvent(G.frame, "PLAYER_LOGIN")
  start()
  assert(G.Mode(s()) == "standalone", "the default")
  assert(count(api.added) == 0 and #api.viewSets == 0 and EncounterTimeline.attrs.overrideViewType == nil, "untouched")
  assert(shownNames() == "Alone", "on the Alert timeline")
end)

check("game timeline: Add sends each timeline alert the area's seconds ahead", function()
  pull({ item{ id = "a", time = 8, text = "Soak", spellID = 100, abilityTags = { "tank", "magic", "mythic" }, priority = 33 },
    item{ id = "b", time = 50, text = "Later", icon = 777 },
    item{ id = "c", time = 6, text = "Bar only", outputs = { bar = true } } }, ADD)
  start()
  assert(count(api.added) == 1, "one sent at the pull: " .. count(api.added))
  local r = api.added[api.order[1]]
  assert(near(r.duration, 8) and r.overrideName == "Soak" and r.spellID == 100 and r.iconFileID == 555, "duration, name, spell, icon")
  assert(r.icons == 128 + 8, "tank and magic, Mythic has no game icon: " .. tostring(r.icons))
  assert(r.severity == 2 and r.maxQueueDuration == 0 and r.paused == false, "high priority: High")
  -- the later one is sent once it is within the area's 10 seconds, with the time left
  clock = 100 + 50 - 10 - 0.5 G:Sync()
  assert(count(api.added) == 1, "not before")
  clock = 100 + 50 - 10 + 1 G:Sync()
  assert(count(api.added) == 2, "the second sent within reach")
  local r2 = api.added[api.order[2]]
  assert(near(r2.duration, 9) and r2.iconFileID == 777 and r2.spellID == 0 and r2.severity == 1 and r2.icons == nil, "its own icon, no spell, Medium, no icons")
  G:Sync()
  assert(count(api.added) == 2, "never sent twice")
  assert(rawget(G.frame, "OnUpdate"), "the check runs while alerts are coming")
  assert(#errors == 0, tostring(errors[1]))
end)

check("game timeline: up to 60 seconds ahead, and no more than At once at a time", function()
  pull({ item{ id = "f1", time = 55, text = "Far" }, item{ id = "f2", time = 70, text = "Farther" } }, with{ seconds = 90 })
  assert(T.Seconds(s()) == 60, "Seconds on the line stops at 60")
  start()
  assert(count(api.added) == 1 and near(api.added[api.order[1]].duration, 55), "55 s ahead sent at the pull")
  clock = 111 G:Sync()
  assert(count(api.added) == 2 and near(api.added[api.order[2]].duration, 59), "the next at 60 s")
  -- At once 2: the third waits, and shows on the Alert timeline meanwhile
  pull({ item{ id = "c1", time = 3, text = "One" }, item{ id = "c2", time = 4, text = "Two" }, item{ id = "c3", time = 5, text = "Three" } }, with{ cap = 2 })
  start()
  assert(count(api.added) == 2 and api.added[api.order[1]].overrideName == "One" and api.added[api.order[2]].overrideName == "Two", "the soonest two")
  assert(shownNames() == "Three", "the one waiting shows here")
  clock = 103.1 G:Sync()
  assert(count(api.added) == 3 and api.added[api.order[3]].overrideName == "Three", "sent once the first is done")
  assert(shownNames() == "", "and only there")
end)

check("game timeline: finished at 0, canceled at the end of the pull and when a phase cuts it", function()
  pull({ item{ id = "a", time = 5, text = "One" }, item{ id = "b", time = 9, text = "Two" } }, ADD)
  start()
  local first, second = api.order[1], api.order[2]
  clock = 105.1 G:Sync()
  assert(#api.finished == 1 and api.finished[1] == first, "the first finished at its time")
  A.HandleEvent("ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
  assert(#api.canceled == 1 and api.canceled[1] == second, "the other canceled at the end of the pull")
  assert(not api.cancelAll, "never every addon's events")
  assert(rawget(G.frame, "OnUpdate") == nil, "the check stops with the run")
  -- a phase cut
  pull({ item{ id = "p1", ph = 1, time = 20, text = "Cut" }, item{ id = "p2", ph = 2, time = 3, text = "P2" } }, with{ seconds = 30 })
  start()
  local cut = api.order[1]
  assert(api.added[cut].overrideName == "Cut", "phase 1 sent")
  clock = 105 A:StartPhase(2, "next")
  assert(api.canceled[1] == cut, "canceled once phase 2 masks it")
  assert(api.added[api.order[2]].overrideName == "P2", "phase 2's line sent")
end)

check("game timeline: never a secret value, and a failed add shows here instead", function()
  pull({ item{ id = "s", time = 4, text = SECRET, spellID = SECRET, icon = SECRET } }, ADD)
  start()
  local r = api.added[api.order[1]]
  assert(r and r.overrideName == "" and r.spellID == 0 and r.iconFileID == G.QUESTION_ICON, "secrets left out")
  pull({ item{ id = "f", time = 4, text = "Fails" } }, ADD)
  api.failNext = true
  start()
  assert(count(api.added) == 0 and #errors == 0, "a failed add is no error")
  assert(shownNames() == "Fails", "and shows on this timeline")
  errors = {}
end)

check("game timeline: not in a rehearsal or with the game's timeline off, and a Mode change takes back", function()
  pull({ item{ id = "r", time = 4, text = "Rehearsed" } }, ADD)
  local fight = 0
  A:Start(3001, "Mythic", "rehearsal", { clock = function() return fight end, speed = function() return 1 end })
  G:Sync()
  assert(count(api.added) == 0, "a rehearsal sends nothing")
  assert(shownNames() == "Rehearsed", "it shows here")
  pull({ item{ id = "d", time = 4, text = "Disabled" } }, ADD)
  api.enabled = false
  start()
  assert(count(api.added) == 0, "the game's timeline turned off")
  assert(shownNames() == "Disabled", "then everything shows here")
  pull({ item{ id = "m", time = 4, text = "Mid" } }, ADD)
  start()
  assert(count(api.added) == 1)
  s().gameMode = "standalone"
  G:Sync()
  assert(api.canceled[1] == api.order[1], "taken back")
end)

check("game timeline: Add, with and without Also show the Alert timeline, and Replace", function()
  pull({ item{ id = "x", time = 4, text = "Both" } }, with{ gameAlsoHere = true })
  start()
  assert(count(api.added) == 1 and shownNames() == "Both", "Also show on: here too")
  pull({ item{ id = "y", time = 4, text = "Game" } }, ADD)
  start()
  assert(count(api.added) == 1 and shownNames() == "", "Also show off: only there")
  pull({ item{ id = "z", time = 4, text = "Replaced" } }, { gameMode = "replace" })
  G:ApplyReplace()
  start()
  assert(count(api.added) == 0 and shownNames() == "Replaced", "Replace: nothing sent, all here")
  s().gameMode = "standalone" G:ApplyReplace()
end)

check("game timeline: nothing sent while the game's view type is None, and it shows here", function()
  pull({ item{ id = "v", time = 4, text = "None view" } }, ADD)
  api.view = 0 -- another addon replacing it, or our Replace waiting for combat
  start()
  assert(count(api.added) == 0 and shownNames() == "None view", "falls back to this timeline")
end)

check("game timeline: the Journal tags' game icons live on Reference.TAGS", function()
  local Ref = CRT.TimelineReference
  assert(Ref.TAGS.tank.gameIcon == "TankRole" and Ref.TAGS.magic.gameIcon == "MagicEffect" and Ref.TAGS.mythic.gameIcon == nil, "on the tags")
  local r = G.Request({ id = "q", at = 0, text = "Q", abilityTags = { "healer", "dps", "deadly", "heroic", "healer" } }, 5)
  assert(r.icons == 256 + 512 + 1, "healer, dps and deadly once each: " .. tostring(r.icons))
end)

check("game timeline: after a /reload mid-pull, what was left is taken back at the end", function()
  pull({ item{ id = "k", time = 4, text = "Kept" } }, ADD)
  CRTDBChar = {}
  start()
  local id = api.order[1]
  assert(CRTDBChar.gameTimelineSent[id] == "Kept", "the sent ID is kept for the session")
  A:Stop()
  assert(next(CRTDBChar.gameTimelineSent) == nil, "and forgotten once taken back")
  -- the UI before the reload left two IDs; one is now another addon's event
  resetApi()
  api.added[55] = { overrideName = "Old" }
  api.added[56] = { overrideName = "Someone else's" }
  CRTDBChar.gameTimelineSent = { [55] = "Old", [56] = "Old too" }
  G.frame.OnEvent(G.frame, "PLAYER_ENTERING_WORLD", false, true)
  G.frame.OnEvent(G.frame, "ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
  assert(#api.canceled == 1 and api.canceled[1] == 55, "only ours: " .. table.concat(api.canceled, ","))
  assert(next(CRTDBChar.gameTimelineSent) == nil, "the list is cleared")
  -- a real login starts empty
  CRTDBChar.gameTimelineSent = { [57] = "Stale" }
  G.frame.OnEvent(G.frame, "PLAYER_ENTERING_WORLD", true, false)
  assert(next(CRTDBChar.gameTimelineSent) == nil, "cleared at login")
  G.frame.OnEvent(G.frame, "ENCOUNTER_END", 3001, "Boss", 16, 20, 0)
  assert(#api.canceled == 1, "nothing to take back after a login")
end)

check("game timeline: Replace puts back another addon's override", function()
  pull({}, { gameMode = "replace" })
  EncounterTimeline.attrs.overrideViewType = 1
  G:ApplyReplace()
  assert(EncounterTimeline.attrs.overrideViewType == 0 and api.view == 0, "replaced")
  s().gameMode = "add"
  G:ApplyReplace()
  assert(EncounterTimeline.attrs.overrideViewType == 1 and api.view == 1, "theirs again: " .. tostring(EncounterTimeline.attrs.overrideViewType))
  EncounterTimeline.attrs.overrideViewType = nil
end)

check("game timeline: Replace the game's timeline", function()
  pull({}, ADD)
  G.frame.OnEvent(G.frame, "PLAYER_LOGIN")
  assert(EncounterTimeline.attrs.overrideViewType == nil and #api.viewSets == 0, "never chosen: the game's timeline is never touched")
  s().gameMode = "replace"
  G.frame.OnEvent(G.frame, "PLAYER_LOGIN")
  assert(EncounterTimeline.attrs.overrideViewType == 0 and api.view == 0, "at load: the override and view type None")
  s().gameMode = "standalone"
  G:ApplyReplace()
  assert(EncounterTimeline.attrs.overrideViewType == nil and api.view == editModeView, "left: back to the Edit Mode choice")
  -- in combat it waits
  combat = true
  s().gameMode = "replace"
  G:ApplyReplace()
  assert(api.view == editModeView and G.frame.ev_PLAYER_REGEN_ENABLED, "waits for the end of combat")
  combat = false
  G.frame.OnEvent(G.frame, "PLAYER_REGEN_ENABLED")
  assert(api.view == 0 and EncounterTimeline.attrs.overrideViewType == 0, "applied after combat")
  s().gameMode = "standalone" G:ApplyReplace()
  assert(EncounterTimeline.hides == 0 and EncounterTimeline.anchors == 0, "never hidden or moved")
  -- another addon's override is left alone when ours was never set
  EncounterTimeline.attrs.overrideViewType = 1
  G:ApplyReplace()
  assert(EncounterTimeline.attrs.overrideViewType == 1, "not ours, not cleared")
  EncounterTimeline.attrs.overrideViewType = nil
end)

check("game timeline: the Mode rows on the Alert timeline area", function()
  pull({})
  panel:Select(T)
  local also
  for _, f in ipairs(frames) do if rawget(f, "labelText") == "Also show the Alert timeline" and f.shown then also = f end end
  local mode = dropdowns["Mode"]
  assert(mode and mode.shown and also, "the Mode dropdown and the box")
  local keys = {}
  for _, o in ipairs(mode.list) do keys[#keys + 1] = o.key .. "=" .. o.label end
  assert(table.concat(keys, ",") == "standalone=Standalone,add=Add to the game's timeline,replace=Replace the game's timeline", table.concat(keys, ","))
  assert(mode.value == "standalone" and not also.checked, "the defaults")
  assert(also.enabledState == false, "Also show greys out outside Add")
  local helps = {}
  for _, f in ipairs(frames) do if rawget(f, "helpTitle") then helps[f.helpTitle] = true end end
  assert(helps["Mode"] and helps["Also show the Alert timeline"], "a (?) on each")
  assert(sliders["Seconds on the line"].opts.max == 60, "Seconds on the line goes to 60")
  mode.opts.set("replace")
  assert(s().gameMode == "replace" and api.view == 0, "Replace applies at once")
  mode.opts.set("add")
  assert(api.view == editModeView and also.enabledState == true, "back, and Also show can be ticked")
  also:SetChecked(true) also.OnClick(also)
  assert(s().gameAlsoHere == true, "Also show saved")
  assert(#errors == 0, tostring(errors[1]))
end)

check("game timeline: older clients without the API", function()
  local saved = C_EncounterTimeline
  C_EncounterTimeline = nil
  pull({ item{ id = "n", time = 4, text = "Old" } }, { gameMode = "replace" })
  G:ApplyReplace()
  s().gameMode = "add"
  start()
  assert(shownNames() == "Old" and #errors == 0, "shows here, no error")
  C_EncounterTimeline = saved
  s().gameMode = "standalone"
end)

check("game timeline: defaults in CRT_Core/Core.lua", function()
  for _, k in ipairs({ 'gameMode = "standalone"', "gameAlsoHere = false" }) do
    assert(CORE_SRC:find(k, 1, true), "default " .. k)
  end
  assert(not CORE_SRC:find("gameSend", 1, true) and not CORE_SRC:find("gameReplace", 1, true), "the old settings never shipped")
end)

check("game timeline: the dev probe adds one script event and prints it", function()
  pull({})
  local P = CRT.GameTimelineProbe
  assert(P and P:Command("dev gametimeline 12 100", "dev gametimeline 12 100"), "the command")
  local id = api.order[1]
  assert(id and near(api.added[id].duration, 12) and api.added[id].spellID == 100, "one event of 12 s")
  local all = table.concat(printed, "\\n")
  assert(all:find("event " .. id, 1, true) and all:find("view type", 1, true), "prints the result: " .. all)
  assert(all:find("/console taintLog 1", 1, true), "and how to check for taint")
  P:Command("dev gametimeline cancel", "dev gametimeline cancel")
  assert(api.canceled[#api.canceled] == id, "cancel takes it back")
  assert(not P:Command("dev other", "dev other"), "other commands pass")
end)

if fails > 0 then error(fails .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (let i = 2; i < 10; i++) {
  let src = '';
  try { src = fs.readFileSync(process.argv[i], 'utf8'); } catch (e) { console.error('missing ' + process.argv[i]); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
const root = path.dirname(path.dirname(path.dirname(path.resolve(process.argv[5]))));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(root, 'CRT_Core', 'Core.lua'), 'utf8')));
lua.lua_setglobal(L, to_luastring('CORE_SRC'));
if (lua.lua_pcall(L, 8, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }

// The probe never ships: its .toc line and its slash command sit inside the do-not-package blocks.
const inBlock = (text, needle) => {
  const at = text.indexOf(needle);
  const open = text.lastIndexOf('@do-not-package@', at);
  const close = text.indexOf('@end-do-not-package@', open);
  return at >= 0 && open >= 0 && at < close && text.lastIndexOf('@end-do-not-package@', at) < open;
};
const toc = fs.readFileSync(path.join(root, 'CowfeeRaidTools.toc'), 'utf8');
const slash = fs.readFileSync(path.join(root, 'CRT_Core', 'Slash.lua'), 'utf8');
if (!inBlock(toc, 'CRT_Dev\\Dev\\GameTimelineProbe.lua')) { console.error('FAIL game timeline: the probe is not in the .toc do-not-package block'); process.exit(1); }
if (!inBlock(slash, 'GameTimelineProbe')) { console.error('FAIL game timeline: the probe command is not in the Slash.lua do-not-package block'); process.exit(1); }
const gameAt = toc.indexOf('CRT_Modules\\Alerts\\GameTimeline.lua'), areaAt = toc.indexOf('CRT_Modules\\Alerts\\TimelineArea.lua');
if (gameAt < 0 || gameAt > areaAt) { console.error('FAIL game timeline: GameTimeline.lua must load before TimelineArea.lua'); process.exit(1); }
console.log('ok game timeline: the probe never ships, and the load order');
