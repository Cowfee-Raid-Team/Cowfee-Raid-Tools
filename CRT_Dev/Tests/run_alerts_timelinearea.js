// CRT_Modules/Alerts/TimelineArea.lua: the timeline area (icons sliding along a line, names, Journal icons, ticks, the
// NOW effects), with mock frames.
// Usage: node run_alerts_timelinearea.js CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Areas.lua
//   CRT_Modules/Alerts/TimelineArea.lua CRT_Core/UI/Controls.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Alerts/Colors.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const placementLua = require('./placement_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + placementLua(process.argv.slice(2)) + `
local rulesSrc, engineSrc, areasSrc, timelineSrc, controlsSrc, referenceSrc, colorsSrc = ...
local MEDIA = "Interface\\\\AddOns\\\\CowfeeRaidTools\\\\CRT_Media\\\\Media\\\\"
local frames = {}
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, checked = false, text = "", pts = {}, w = 0, h = 0, alpha = 1, scale = 1 }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if type(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" then return function(self, _, _, font) local f = mock("FontString", self) rawset(f, "font", font) return f end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "CreateAnimationGroup" then return function(self)
      local g = mock("AnimationGroup", self)
      rawset(g, "CreateAnimation", function() return mock("Animation", g) end)
      return g end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "GetScript" then return function(self, n) return rawget(self, n) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetTexture" then return function(self, s) rawset(self, "texture", s) end end
    if k == "SetAtlas" then return function(self, s) rawset(self, "atlas", s) end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "SetScale" then return function(self, s) rawset(self, "scale", s) end end
    if k == "SetFont" then return function(self, p, size, flags) rawset(self, "fontPath", p) rawset(self, "fontSize", size) return true end end
    if k == "GetFont" then return function(self) return rawget(self, "fontPath"), rawget(self, "fontSize") end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "textColor", { r, g, b }) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return self.w end end
    if k == "GetHeight" then return function(self) return self.h end end
    if k == "GetUnboundedStringWidth" or k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "SetAllPoints" then return function(self, target) rawset(self, "allPoints", target or self.parent) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetCenter" then return function(self) if self == UIParent then return 480, 300 end return 530, 450 end end
    if k == "SetColorTexture" or k == "SetVertexColor" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "GetFrameLevel" then return function() return 1 end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabledState", on and true or false) end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
local created, made = {}, 0
function CreateFrame(kind, name, parent, template)
  made = made + 1
  local f = mock(kind, parent, template)
  if name then created[name] = f end
  return f
end
local clock = 100
format = string.format
ColorPickerFrame = { rgb = { 1, 1, 1 }, alpha = 1 }
function ColorPickerFrame:SetupColorPickerAndShow(info) self.info = info end
function ColorPickerFrame:GetColorRGB() return self.rgb[1], self.rgb[2], self.rgb[3] end
function ColorPickerFrame:GetColorAlpha() return self.alpha end
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
local SECRET = {}
function issecretvalue(v) return v == SECRET end
local coreSrc = CORE_SRC
local function defaults() return {
  bars = { shown = true, noteLines = true, cap = 5, ahead = 20 },
  areas = {
    timeline = { shown = true, cap = 5, direction = "down", side = "right", length = 300, seconds = 10, size = 32, thickness = 2,
      showNames = true, showCountdown = true, tenths = 0, badges = true, ticks = "5", nowEffect = "flash", nowText = "NOW!",
      nowTime = 1, stack = true, font = "Friz Quadrata", fontSize = 14 },
  },
  customColors = false,
  reminders = {}, phases = {}, overrides = {}, nextId = 1 } end
local previews, layers, dropdowns, sliders = {}, {}, {}, {}
local CRT = { db = { alerts = defaults() } }
CRT.Timeline = { readable = function(v) local ok, s = pcall(issecretvalue, v); return ok and not s end }
local fontList = { { name = "Friz Quadrata", path = "Fonts\\\\FRIZQT__.TTF" }, { name = "Arial Narrow", path = "Fonts\\\\ARIALN.TTF" } }
function CRT:FontList() return fontList end
function CRT:FontPath(name) for _, f in ipairs(fontList) do if f.name == name then return f.path end end return nil end
CRT.UI = {
  RegisterLayer = function(_, key, f) layers[key] = f end,
  RegisterPreview = function(_, key, fn) previews[key] = fn end,
  ResetButtonWidth = function() return 44 end, ResetButton = function(parent) return mock("Button", parent) end,
  Help = function(parent, title, text) local b = mock("Button", parent) rawset(b, "helpTitle", title) rawset(b, "helpText", text) return b end,
  Dropdown = function(parent, label, opts) local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    local function menu() local o = opts.options local list = type(o) == "function" and o() or o assert(type(list) == "table", label .. ": options") rawset(r, "list", list) rawset(r, "value", opts.get()) end
    menu()
    rawset(r, "refresh", function() menu() if opts.enabledIf then rawset(r, "enabled", opts.enabledIf() and true or false) end end) dropdowns[label] = r return r end,
  Slider = function(parent, label, opts) local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    rawset(r, "value", opts.get() or opts.min)
    rawset(r, "refresh", function() rawset(r, "value", opts.get() or opts.min) if opts.enabledIf then rawset(r, "enabled", opts.enabledIf() and true or false) end end) sliders[label] = r return r end,
}
local spells = { [100] = { name = "Spell Name", icon = 555 } }
CRT.Notes = { SpellInfo = function(_, id) return spells[id] end }
assert(load(rulesSrc, "Rules"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "Engine"))("CowfeeRaidTools", CRT)
assert(load(referenceSrc, "Reference"))("CowfeeRaidTools", CRT)
assert(load(colorsSrc, "Colors"))("CowfeeRaidTools", CRT)
CRT_THEME(CRT, CRT.UI)
CRT_PLACEMENT(CRT) -- UI/Placement.lua, which every area is placed by
assert(load(areasSrc, "Areas"))("CowfeeRaidTools", CRT)
assert(load(timelineSrc, "TimelineArea"))("CowfeeRaidTools", CRT)
do -- the real CRT_Core/UI/Controls.lua: only PickColor is taken
  local tmp = { UI = {} }
  assert(load(controlsSrc, "CRT_Core/UI/Controls.lua"))("CowfeeRaidTools", tmp)
  CRT.UI.PickColor = tmp.UI.PickColor
end
local A, Areas, T = CRT.Alerts, CRT.AlertAreas, CRT.AlertTimeline
local Ref = CRT.TimelineReference
local panel = Areas.Panel(CreateFrame("Frame", nil, UIParent))

local fails = 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)) fails = fails + 1 end
end
local function near(a, b) return math.abs(a - b) < 1e-6 end
local function same(c, want) return c ~= nil and near(c[1], want[1]) and near(c[2], want[2]) and near(c[3], want[3]) end

local items = {}
A:RegisterBlock("rem", { label = "Reminders", group = false, Entries = function()
  local out = {}
  for _, it in ipairs(items) do local c = {} for k, v in pairs(it) do c[k] = v end out[#out + 1] = c end
  return out
end })
local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 31, hold = 0.5, warn = 8, outputs = { timeline = true } }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local function s() return CRT.db.alerts.areas.timeline end
local function pull(list, settings)
  A:Stop()
  items = list or {}
  clock = 100
  CRT.db.alerts = defaults()
  for k, v in pairs(settings or {}) do s()[k] = v end
  T:ResetPosition()
end
local function start() A.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16) end
local function last(f) return f.pts[#f.pts] end
local ticker
for _, f in ipairs(frames) do if rawget(f, "OnUpdate") and rawget(f, "OnEvent") then ticker = f end end
ticker.OnEvent(ticker, "PLAYER_LOGIN")
local win = created.CowfeeRaidToolsAlertTimeline

check("timeline: registered as an area", function()
  assert(T and T.def.output == "timeline" and Areas.Find("timeline") == T, "the timeline area")
  assert(previews.alerttimeline, "its preview")
  assert(win and layers.alerttimeline == win, "its frame on its own layer")
  assert(T.def.noGrow, "no Grow row: it has a direction")
end)

check("timeline: position over time in every direction and line length", function()
  for _, case in ipairs({ { "down", "BOTTOM", 0, 1 }, { "up", "TOP", 0, -1 }, { "left", "LEFT", 1, 0 }, { "right", "RIGHT", -1, 0 } }) do
    for _, length in ipairs({ 300, 200 }) do
      pull({ item{ id = "a", time = 10, text = "Soak" } }, { direction = case[1], length = length })
      start() T:Refresh()
      local w = T:Visible()[1]
      assert(w, case[1] .. ": shown")
      for _, at in ipairs({ { 100, length }, { 105, length / 2 }, { 107.5, length / 4 }, { 110, 0 } }) do
        clock = at[1] T:Refresh()
        local p = last(w)
        local wantX, wantY = case[3] * at[2], case[4] * at[2]
        assert(p[1] == "CENTER" and p[2] == win and p[3] == case[2] and near(p[4], wantX) and near(p[5], wantY),
          case[1] .. " " .. length .. " at " .. at[1] .. ": " .. tostring(p[3]) .. " " .. p[4] .. "," .. p[5])
      end
      -- the area is the line's box, upright or sideways
      local vertical = case[1] == "down" or case[1] == "up"
      assert(win.w == (vertical and 32 or length) and win.h == (vertical and length or 32), case[1] .. ": box " .. win.w .. "x" .. win.h)
      local track = T.tl.track
      assert(track.shown and (vertical and track.w == 2 or track.h == 2), case[1] .. ": the line's thickness")
    end
  end
  -- seconds on the line: a line further out than that waits at the far end, unseen
  pull({ item{ id = "b", time = 15, text = "Far", warn = 20 } }, { seconds = 10 })
  start() T:Refresh()
  assert(#T:Visible() == 0, "not on the line until 10 s are left")
  clock = 105 T:Refresh()
  local w = T:Visible()[1]
  assert(w and near(last(w)[5], 300) and w.alpha == 1, "enters at the top at 10 s")
  assert(#errors == 0, tostring(errors[1]))
end)

check("timeline: one OnUpdate, only while something is on the line, moves the icons", function()
  pull({ item{ id = "m", time = 4, text = "Move", hold = 0 } }, { nowTime = 1 })
  local mover = T.tl and T.tl.mover
  start() T:Refresh()
  mover = T.tl.mover
  assert(rawget(mover, "OnUpdate"), "set while an icon is on the line")
  local w = T:Visible()[1]
  clock = 102
  mover.OnUpdate(mover, 0.016)
  assert(near(last(w)[5], 2 / 10 * 300), "moved by the OnUpdate: " .. last(w)[5])
  clock = 105.5 T:Refresh()
  assert(#T:Visible() == 0 and rawget(mover, "OnUpdate") == nil, "gone, and the OnUpdate with it: " .. #T:Visible() .. " " .. tostring(mover.OnUpdate))
  -- a run that ends leaves no OnUpdate
  pull({ item{ id = "m2", time = 4, text = "Move" } })
  start() T:Refresh()
  assert(rawget(T.tl.mover, "OnUpdate"), "on again")
  A:Stop() T:Tick()
  assert(rawget(T.tl.mover, "OnUpdate") == nil and not win.shown, "off when the run stops")
end)

check("timeline: the names' side", function()
  local function nameAt(settings)
    pull({ item{ id = "n", time = 5, text = "Name" } }, settings)
    start() T:Refresh()
    local w = T:Visible()[1]
    return w, last(w.name)
  end
  local w, p = nameAt({ side = "right" })
  assert(p[1] == "LEFT" and p[2] == w and p[3] == "RIGHT" and p[4] > 0, "right of an upright line")
  assert(w.name.text == "Name" and w.name.shown, "the name")
  w, p = nameAt({ side = "left" })
  assert(p[1] == "RIGHT" and p[3] == "LEFT" and p[4] < 0, "left: " .. tostring(p[1]) .. " " .. tostring(p[3]) .. " " .. tostring(p[4]))
  w, p = nameAt({ direction = "left", side = "above" })
  assert(p[1] == "BOTTOM" and p[3] == "TOP" and p[5] > 0, "above a sideways line")
  w, p = nameAt({ direction = "right", side = "below" })
  assert(p[1] == "TOP" and p[3] == "BOTTOM" and p[5] < 0, "below")
  -- right of an upright line means above a sideways one, left below
  w, p = nameAt({ direction = "left", side = "right" })
  assert(p[1] == "BOTTOM", "the positive side carries over")
  panel:Select(T)
  CRT.db.alerts.areas.timeline.side = "left"
  dropdowns["Names on"].refresh()
  assert(dropdowns["Names on"].value == "below" and dropdowns["Names on"].list[1].key == "above", "sideways: Above or Below")
  w = nameAt({ showNames = false })
  assert(not w.name.shown, "Show the names off")
end)

check("timeline: Journal icons from the line's tags", function()
  assert(table.concat(T.Badges({ abilityTags = { "mythic", "bogus", "tank", "magic" } }), ",") == "tank,mythic,magic", "the Journal's order, unknown words left out")
  assert(#T.Badges({}) == 0, "none")
  pull({ item{ id = "g", time = 5, text = "Tags", abilityTags = { "mythic", "healer" } } })
  start() T:Refresh()
  local w = T:Visible()[1]
  assert(w.badges[1].shown and w.badges[1].atlas == Ref.TAGS.healer.atlas and w.badges[2].atlas == Ref.TAGS.mythic.atlas and not w.badges[3].shown, "two icons, healer first")
  local b1 = last(w.badges[1])
  assert(b1[2] == w and b1[1] == "LEFT" and b1[3] == "RIGHT", "between the icon and the name")
  assert(last(w.name)[4] > b1[4] + 14, "the name after them")
  pull({ item{ id = "g2", time = 5, text = "Tags", abilityTags = { "mythic" } } }, { badges = false })
  start() T:Refresh()
  assert(not T:Visible()[1].badges[1].shown, "Indicator icons off")
end)

check("timeline: tick positions", function()
  assert(table.concat(T.Ticks({ ticks = "5", seconds = 10 }), ",") == "5", "5")
  assert(table.concat(T.Ticks({ ticks = "10,3, 5,40", seconds = 10 }), ",") == "3,5,10", "sorted, past the line left out")
  assert(#T.Ticks({ ticks = "", seconds = 10 }) == 0, "none")
  assert(table.concat(T.Ticks({ seconds = 10 }), ",") == "5", "default 5")
  pull({ item{ id = "t", time = 8, text = "Tick" } }, { ticks = "3,5" })
  start() T:Refresh()
  local t1, t2 = T.tl.ticks[1], T.tl.ticks[2]
  local p1, p2 = last(t1.diamond), last(t2.diamond)
  assert(p1[3] == "BOTTOM" and near(p1[5], 90) and near(p2[5], 150), "at 3 s and 5 s of 10 on 300 px")
  assert(t1.diamond.texture == MEDIA .. "Diamond" and t1.label.text == "3" and t2.label.text == "5", "diamonds with their seconds")
  assert(last(t1.label)[1] == "RIGHT", "labels away from the names")
  local placed = t1.diamond.pts
  clock = 101 T:Refresh() clock = 102 T:Refresh()
  assert(t1.diamond.pts == placed, "not placed again while nothing about them changed")
  s().side = "left" T:Refresh()
  assert(t1.diamond.pts ~= placed and last(t1.label)[1] == "LEFT", "placed again when the names' side changes")
  pull({ item{ id = "t2", time = 8, text = "Tick" } }, { ticks = "", direction = "right", length = 200 })
  start() T:Refresh()
  assert(not T.tl.ticks[1].diamond.shown and not T.tl.ticks[2].diamond.shown, "None hides them")
  pull({ item{ id = "t3", time = 8, text = "Tick" } }, { ticks = "5", direction = "right", length = 200 })
  start() T:Refresh()
  local p = last(T.tl.ticks[1].diamond)
  assert(p[3] == "RIGHT" and near(p[4], -100) and p[5] == 0, "sideways: " .. p[4])
end)

check("timeline: each NOW effect's start and end", function()
  local function fx(kind, t) return { T.Effect(kind, t, 1) } end
  local before = fx("flash", -0.5)
  assert(before[1] == 1 and before[2] == 0 and before[3] == 0, "before 0: no effect")
  local f0, f1 = fx("flash", 0), fx("flash", 1)
  assert(f0[1] == 1 and f0[2] == 1 and f1[1] == 0 and f1[2] == 0, "Flash and fade: white then gone")
  local r0, r1 = fx("ring", 0), fx("ring", 1)
  assert(r0[3] == 1 and r0[4] == 1 and r1[3] == 0 and near(r1[4], 2.5) and r1[1] == 0, "Ring burst grows and fades")
  local p0, pg, p1 = fx("pop", 0), fx("pop", 0.2), fx("pop", 1)
  assert(p0[1] == 1 and p0[5] == 1 and near(pg[5], 1.6) and p1[1] == 0, "Text pop grows, then fades")
  local s0, s1 = fx("slide", 0), fx("slide", 1)
  assert(s0[1] == 1 and s1[1] == 0, "Slide off fades")
  assert(fx("none", 0)[1] == 0, "None: gone at 0")
  -- on the widgets
  local function at0(effect, extra)
    local settings = { nowEffect = effect, nowTime = 1 }
    for k, v in pairs(extra or {}) do settings[k] = v end
    pull({ item{ id = "e" .. effect, time = 5, text = "Now" } }, settings)
    start()
    clock = 105 T:Refresh()
    return T:Visible()[1]
  end
  local w = at0("flash")
  assert(w and w.alpha == 1 and w.flash.alpha == 1 and w.count.text == "", "flash starts white")
  clock = 105.99 T:Refresh()
  assert(w.alpha < 0.02 and w.flash.alpha == 0, "and fades out")
  clock = 106.01 T:Refresh()
  assert(#T:Visible() == 0, "gone after its time")
  w = at0("ring")
  assert(w.ring.shown and w.ring.texture == MEDIA .. "RingThin" and w.ring.w == 32 and w.ring.alpha == 1, "ring from the icon")
  clock = 105.5 T:Refresh()
  assert(near(w.ring.w, 32 * 1.75), "ring grows: " .. w.ring.w)
  w = at0("pop", { nowText = "GO!" })
  assert(w.pop.shown and w.popText.text == "GO!" and w.count.text == "", "the NOW text pops")
  clock = 105.2 T:Refresh()
  assert(near(w.pop.scale, 1.6), "grown: " .. w.pop.scale)
  w = at0("slide")
  clock = 105.5 T:Refresh()
  assert(near(last(w)[5], -15) and near(w.alpha, 0.5), "slides on past the end: " .. last(w)[5])
  w = at0("none")
  assert(w == nil, "None: no icon at 0")
  -- how long it lasts
  w = at0("flash", { nowTime = 2 })
  clock = 106.5 T:Refresh()
  assert(T:Visible()[1] and near(T:Visible()[1].alpha, 0.25), "NOW lasts 2 s")
  assert(#errors == 0, tostring(errors[1]))
end)

check("timeline: the countdown", function()
  pull({ item{ id = "c", time = 5, text = "Count" } })
  start() T:Refresh()
  local w = T:Visible()[1]
  assert(w.count.text == "5", "whole seconds: " .. w.count.text)
  clock = 102.5 T:Refresh()
  assert(w.count.text == "3", "rounded up: " .. w.count.text)
  clock = 104.5 T:Refresh()
  assert(w.count.text == "1", "no tenths by default")
  pull({ item{ id = "c2", time = 5, text = "Count" } }, { tenths = 3 })
  start() clock = 102.45 T:Refresh()
  assert(T:Visible()[1].count.text == "2.5", "tenths under 3 s: " .. T:Visible()[1].count.text)
  clock = 102.04 T:Refresh()
  assert(T:Visible()[1].count.text == "2.9", "never the threshold itself: " .. T:Visible()[1].count.text)
  pull({ item{ id = "c3", time = 5, text = "Count" } }, { showCountdown = false })
  start() T:Refresh()
  assert(T:Visible()[1].count.text == "", "Show the countdown off")
end)

check("timeline: stacked icons move aside, away from the names", function()
  pull({ item{ id = "s1", time = 5, text = "One" }, item{ id = "s2", time = 5.5, text = "Two" }, item{ id = "s3", time = 9, text = "Three" } })
  start() T:Refresh()
  local v = T:Visible()
  assert(#v == 3, "three")
  assert(last(v[1])[4] == 0 and last(v[2])[4] == -(32 + 4) and last(v[3])[4] == 0, "the second steps left, the third has room: " .. last(v[2])[4])
  assert(last(v[2].name)[1] == "RIGHT", "its name on its outer side")
  pull({ item{ id = "s1", time = 5, text = "One" }, item{ id = "s2", time = 5.5, text = "Two" } }, { stack = false })
  start() T:Refresh()
  assert(last(T:Visible()[2])[4] == 0, "stacking off: on the line")
end)

-- Bug 20261021-timeline-side: a name switched sides near the end. Lanes were worked out again every redraw from
-- where the icons were then, so an icon reaching the end beside one still playing its NOW effect there stepped
-- aside (its name flipped), and stepped back once that one was gone; a stacked icon went back to the line (and its
-- name with it) as soon as the icon before it finished.
check("timeline: a name keeps its side from entry through the NOW effect", function()
  local mover
  -- each line's name anchor and its icon's distance from the line, every 0.05 s of its life
  local function run(list, settings)
    pull(list, settings)
    start()
    local sides = {}
    while clock < 109 do
      T:Refresh()
      mover = T.tl.mover
      if rawget(mover, "OnUpdate") then mover.OnUpdate(mover, 0.016) end
      local vertical = s().direction == "down" or s().direction == "up"
      for _, w in ipairs(T:Visible()) do
        local p, icon = last(w.name), last(w)
        local across = vertical and icon[4] or icon[5]
        local seen = sides[w.line.id] or {}
        sides[w.line.id] = seen
        seen[#seen + 1] = { name = p[1], across = across, at = clock }
      end
      clock = clock + 0.05
    end
    return sides
  end
  local function steady(sides, id, label)
    local seen = sides[id]
    assert(seen and #seen > 100, label .. " " .. id .. ": shown its whole life")
    for _, x in ipairs(seen) do
      assert(x.name == seen[1].name and near(x.across, seen[1].across), label .. " " .. id .. ": " .. seen[1].name .. " " .. seen[1].across
        .. " became " .. x.name .. " " .. x.across .. " at " .. x.at)
    end
    return seen[1]
  end
  local NEAR = { down = "LEFT", up = "LEFT", left = "BOTTOM", right = "BOTTOM" } -- the name's own point on the positive side
  local FAR = { down = "RIGHT", up = "RIGHT", left = "TOP", right = "TOP" }
  for _, direction in ipairs({ "down", "up", "left", "right" }) do
    for _, side in ipairs({ "right", "left" }) do
      local chosen = side == "right" and NEAR[direction] or FAR[direction]
      local outer = side == "right" and FAR[direction] or NEAR[direction]
      for _, stack in ipairs({ true, false }) do
        for _, effect in ipairs({ "flash", "pop", "ring", "slide" }) do
          local label = direction .. "/" .. side .. "/" .. tostring(stack) .. "/" .. effect
          -- 1.5 s apart: never over each other in flight, but the second reaches the end while the first's NOW plays there
          local sides = run({ item{ id = "a", time = 5, text = "First" }, item{ id = "b", time = 6.5, text = "Second" } },
            { direction = direction, side = side, stack = stack, nowEffect = effect, nowTime = 1 })
          for _, id in ipairs({ "a", "b" }) do
            local x = steady(sides, id, label)
            assert(x.name == chosen and x.across == 0, label .. " " .. id .. ": on the line, the name on the chosen side: " .. x.name)
          end
          -- three close ones: the second is stacked from the start and stays there when the first finishes
          sides = run({ item{ id = "p", time = 5, text = "One" }, item{ id = "q", time = 5.5, text = "Two" }, item{ id = "r", time = 6, text = "Three" } },
            { direction = direction, side = side, stack = stack, nowEffect = effect, nowTime = 1 })
          local p, q, r = steady(sides, "p", label), steady(sides, "q", label), steady(sides, "r", label)
          assert(p.name == chosen and p.across == 0 and r.name == chosen and r.across == 0, label .. ": the first and third on the line")
          if stack then
            assert(q.name == outer and q.across ~= 0, label .. ": the second beside it, its name outside")
          else
            assert(q.name == chosen and q.across == 0, label .. ": stacking off, the second on the line")
          end
        end
      end
    end
  end
  -- a pooled widget that held a stacked icon carries nothing over to the next one
  run({ item{ id = "p", time = 5, text = "One" }, item{ id = "q", time = 5.5, text = "Two" } })
  pull({ item{ id = "z", time = 5, text = "Alone" }, item{ id = "y", time = 9, text = "Later" } })
  start() T:Refresh()
  for _, w in ipairs(T:Visible()) do
    assert(last(w.name)[1] == "LEFT" and last(w)[4] == 0, w.line.id .. ": a fresh icon on the line, its name on the right")
  end
  assert(#errors == 0, tostring(errors[1]))
end)

check("timeline: colour rules", function()
  local soak, dispel = Ref.TYPES.soak.color, Ref.TYPES.dispel.color
  pull({ item{ id = "k1", time = 8, text = "Soak", abilityType = "soak", color = { 0, 1, 0 } }, item{ id = "k2", time = 9.5, text = "None" } })
  start() T:Refresh()
  local w1, w2 = T:Visible()[1], T:Visible()[2]
  assert(same(w1.edge.color, soak) and same(w1.name.textColor, soak), "the type's colour, your own ignored")
  assert(same(w2.edge.color, CRT.PALETTE.accent), "no type: the accent")
  assert(same(T.tl.track.color, CRT.PALETTE.accent), "the line: the accent")
  clock = 105.5 T:Refresh()
  assert(same(w1.edge.color, { 1, 1, 1 }) and same(w1.name.textColor, soak), "white edge in the last 3 s")
  -- your colours with the box
  pull({ item{ id = "k3", time = 8, text = "Soak", abilityType = "soak", color = { 0, 1, 0 } } }, { lineColor = { 0.1, 0.2, 0.3, 1 } })
  start() T:Refresh()
  assert(same(T.tl.track.color, CRT.PALETTE.accent), "box off: your line colour unused")
  CRT.db.alerts.customColors = true
  T:Refresh()
  assert(same(T:Visible()[1].edge.color, { 0, 1, 0 }) and same(T.tl.track.color, { 0.1, 0.2, 0.3 }), "box on: your colours")
  -- the raid leader's note colour always
  A:RegisterBlock("note", { label = "Raid note", group = false, Entries = function()
    return { item{ id = "lead", time = 6, text = "Leader", color = { 1, 0, 0 }, abilityType = "dispel" } }
  end })
  CRT.db.alerts.customColors = false
  start() T:Refresh()
  local lead
  for _, w in ipairs(T:Visible()) do if w.name.text == "Leader" then lead = w end end
  assert(lead and same(lead.edge.color, { 1, 0, 0 }), "the leader's colour wins")
  A:RegisterBlock("note", { label = "Raid note", group = false, Entries = function() return {} end })
  -- a theme switch: the line follows the accent
  local old = { T.tl.track.color[1], T.tl.track.color[2], T.tl.track.color[3] }
  CRT.UI.SwitchTheme("nitro")
  assert(same(T.tl.track.color, CRT.PALETTE.accent) and not same(old, CRT.PALETTE.accent), "the new theme's accent at once")
  CRT.UI.SwitchTheme("cowfee")
end)

check("timeline: pooled, nothing made per refresh", function()
  pull({ item{ id = "p1", time = 6, text = "A", abilityTags = { "tank" } }, item{ id = "p2", time = 8, text = "B" } })
  start() T:Refresh()
  local before = made
  for i = 1, 40 do clock = 100 + i * 0.1 T:Refresh() T.tl.mover.OnUpdate(T.tl.mover, 0.016) end
  assert(made == before, "made " .. (made - before))
  assert(#errors == 0, tostring(errors[1]))
end)

check("timeline: cap and only the timeline output", function()
  local list = {}
  for i = 1, 8 do list[i] = item{ id = "q" .. i, time = i, text = "Q" .. i } end
  list[9] = item{ id = "other", time = 2, text = "Bar only", outputs = { bar = true } }
  pull(list, { cap = 3 })
  start() T:Refresh()
  local v = T:Visible()
  assert(#v == 3 and v[1].name.text == "Q1" and T.more == 5, "soonest three: " .. #v .. " more " .. tostring(T.more))
end)

check("timeline: Previews show three icons of three types with Journal icons", function()
  pull()
  previews.alerttimeline(true)
  local v = T:Visible()
  assert(#v == 3 and win.shown and T.handle.shown, "three samples and the drag box")
  local kinds = {}
  for _, w in ipairs(v) do kinds[#kinds + 1] = w.line.abilityType assert(w.badges[1].shown, "Journal icons on each") end
  assert(table.concat(kinds, ",") == "raid,soak,dispel", table.concat(kinds, ","))
  assert(same(v[2].edge.color, Ref.TYPES.soak.color), "in their types' colours")
  assert(v[1].alpha == 1 and v[3].alpha == 1, "all on the line")
  local y = last(v[1])[5]
  for i = 1, 10 do clock = 100 + i * 0.1 T:Refresh() end
  assert(last(v[1])[5] < y, "they slide")
  previews.alerttimeline(false)
  T:Tick()
  assert(not win.shown, "off again")
  assert(#errors == 0, tostring(errors[1]))
end)

check("timeline: settings rows apply at once", function()
  pull({ item{ id = "r", time = 5, text = "Rows" } })
  start() T:Refresh()
  panel:Select(T)
  for _, label in ipairs({ "Direction", "Names on", "Tick marks", "NOW effect", "NOW text", "Font" }) do assert(dropdowns[label] and dropdowns[label].shown, "dropdown " .. label) end
  for _, label in ipairs({ "Line length", "Seconds on the line", "Icon size", "Line thickness", "Tenths under", "NOW lasts", "Text size" }) do assert(sliders[label] and sliders[label].shown, "slider " .. label) end
  assert(not dropdowns["Grow"] or not dropdowns["Grow"].shown, "no Grow row")
  assert(sliders["At once"].shown, "At once is the most icons")
  local helps = 0
  for _, f in ipairs(frames) do if rawget(f, "helpTitle") == "Indicator icons" or rawget(f, "helpTitle") == "Stack icons that overlap" then helps = helps + 1 end end
  assert(helps == 2, "(?) on the indicator icons and stacking")
  dropdowns["Direction"].opts.set("left")
  assert(last(T:Visible()[1])[3] == "LEFT" and win.w == 300, "direction applied at once")
  sliders["Line length"].opts.set(400)
  assert(win.w == 400, "length applied")
  sliders["Icon size"].opts.set(40)
  assert(T:Visible()[1].w == 40, "size applied")
  dropdowns["NOW effect"].opts.set("none")
  dropdowns["NOW text"].refresh() sliders["NOW lasts"].refresh()
  assert(dropdowns["NOW text"].enabled == false and sliders["NOW lasts"].enabled == false, "NOW text and time grey out with None")
  assert(sliders["Tenths under"].opts.format(0) == "Off", "tenths 0 reads Off")
  assert(#errors == 0, tostring(errors[1]))
end)

check("timeline: a rehearsal moves the icons on its own clock, and a pause holds them", function()
  pull({ item{ id = "rh", time = 30, text = "Rehearsed" } })
  local fight = 22
  A:Start(3001, "Mythic", "rehearsal", { clock = function() return fight end, speed = function() return 1 end })
  T:Refresh()
  local w = T:Visible()[1]
  assert(w and near(last(w)[5], 8 / 10 * 300), "8 s left on the rehearsal's clock: " .. tostring(w and last(w)[5]))
  clock = clock + 5 -- real time runs on, the rehearsal is paused
  T:Refresh() T.tl.mover.OnUpdate(T.tl.mover, 0.016)
  assert(near(last(w)[5], 8 / 10 * 300) and w.count.text == "8", "paused: it holds")
  fight = 26
  T.tl.mover.OnUpdate(T.tl.mover, 0.016)
  assert(near(last(w)[5], 4 / 10 * 300) and w.count.text == "4", "moves with the clock")
  A:Stop()
end)

check("timeline: defaults in CRT_Core/Core.lua", function()
  local core = coreSrc
  assert(core:find("timeline = { shown = true", 1, true), "an areas.timeline default")
  for _, k in ipairs({ 'direction = "down"', 'side = "right"', "length = 300", "seconds = 10", "size = 32", "thickness = 2", 'ticks = "5"', 'nowEffect = "flash"', 'nowText = "NOW!"', "nowTime = 1", "stack = true", "badges = true" }) do
    assert(core:find(k, 1, true), "default " .. k)
  end
  assert(core:find("timeline = false", 1, true), "note lines are not routed to it until chosen")
end)

if fails > 0 then error(fails .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (let i = 2; i < 9; i++) {
  let src = '';
  try { src = fs.readFileSync(process.argv[i], 'utf8'); } catch (e) { console.error('missing ' + process.argv[i]); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
// CRT_Core/Core.lua, for the defaults check
const core = fs.readFileSync(path.join(path.dirname(path.dirname(path.dirname(path.resolve(process.argv[5])))), 'CRT_Core', 'Core.lua'), 'utf8');
lua.lua_pushstring(L, to_luastring(core));
lua.lua_setglobal(L, to_luastring('CORE_SRC'));
if (lua.lua_pcall(L, 7, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }

// The tick texture: a 32 x 32 TGA, as the rings are, with a clear corner and a solid middle
const media = path.join(path.dirname(path.dirname(path.dirname(path.resolve(process.argv[5])))), 'CRT_Media', 'Media');
const b = fs.readFileSync(path.join(media, 'Diamond.tga'));
const ok = b.length === 18 + 32 * 32 * 4 && b[2] === 2 && b.readUInt16LE(12) === 32 && b.readUInt16LE(14) === 32 && b[16] === 32 && b[17] === 0x28;
const at = (x, y) => b[18 + (y * 32 + x) * 4 + 3];
if (!ok || at(0, 0) !== 0 || at(16, 16) !== 255) { console.error('FAIL timeline: Diamond.tga header or shape'); process.exit(1); }
console.log('ok timeline: the diamond texture');
