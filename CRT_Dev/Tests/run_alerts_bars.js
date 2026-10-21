// CRT_Modules/Alerts/Bars.lua: the alert bars on the area builder, with mock frames.
// Usage: node run_alerts_bars.js CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Areas.lua CRT_Modules/Alerts/Bars.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Alerts/Colors.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local rulesSrc, engineSrc, areasSrc, barsSrc, referenceSrc, colorsSrc = ...
local frames, fontStrings = {}, {}
local hides = 0
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, checked = false, text = "", pts = {}, w = 0, h = 0, alpha = 1 }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    -- Only methods (capitalised) exist on a frame; any other missing field is nil, as in the game.
    if type(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" then return function(self, _, _, font)
      local f = mock("FontString", self) rawset(f, "font", font) fontStrings[#fontStrings + 1] = f return f end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "CreateAnimationGroup" then return function(self)
      local g = mock("AnimationGroup", self) rawset(g, "playing", false)
      rawset(g, "CreateAnimation", function() return mock("Animation", g) end)
      rawset(g, "Play", function(gg) rawset(gg, "playing", true) end)
      rawset(g, "Stop", function(gg) rawset(gg, "playing", false) end)
      rawset(g, "IsPlaying", function(gg) return gg.playing end)
      return g end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) if self.shown then hides = hides + 1 end self.shown = false end end
    if k == "SetShown" then return function(self, on) if self.shown and not on then hides = hides + 1 end self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetTexture" then return function(self, s) rawset(self, "texture", s) end end
    if k == "SetFont" then return function(self, path, size, flags)
      if path:find("Broken") then rawset(self, "fontPath", nil) return false end
      rawset(self, "fontPath", path) rawset(self, "fontSize", size) rawset(self, "fontFlags", flags) return true end end
    if k == "GetFont" then return function(self) return rawget(self, "fontPath"), rawget(self, "fontSize"), rawget(self, "fontFlags") end end
    if k == "SetJustifyH" then return function(self, j) rawset(self, "justify", j) end end
    if k == "SetTextColor" then return function(self, r, g, b, a) rawset(self, "textColor", { r, g, b, a }) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return self.w end end
    if k == "GetHeight" then return function(self) return self.h end end
    -- As in retail: GetStringWidth is bounded by the region's width (its own, or its parent's when set to
    -- all points); GetUnboundedStringWidth is the words' full width.
    if k == "GetUnboundedStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "GetStringWidth" then return function(self)
      local full = #(rawget(self, "text") or "") * 6
      local bound = rawget(self, "allPoints") and self.parent.w or (self.w > 0 and self.w) or nil
      return bound and math.min(full, bound) or full end end
    if k == "SetAllPoints" then return function(self) rawset(self, "allPoints", true) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetCenter" then return function(self) if self == UIParent then return 480, 300 end return 530, 450 end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabledState", on and true or false) end end
    if k == "SetColorTexture" or k == "SetVertexColor" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "GetFrameLevel" then return function() return 1 end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
local created = {}
local made = 0
function CreateFrame(kind, name, parent, template)
  made = made + 1
  local f = mock(kind, parent, template)
  if kind == "Cooldown" then
    rawset(f, "cooldownCalls", {})
    rawset(f, "SetCooldown", function(self, start, dur) self.cooldownCalls[#self.cooldownCalls + 1] = { start, dur } end)
    rawset(f, "Clear", function(self) self.cooldownCalls[#self.cooldownCalls + 1] = "clear" end)
    rawset(f, "SetHideCountdownNumbers", function(self, on) rawset(self, "hideNumbers", on) end)
    rawset(f, "SetDrawBling", function(self, on) rawset(self, "bling", on) end)
    rawset(f, "SetSwipeTexture", function(self, t) rawset(self, "swipeTexture", t) end)
    rawset(f, "SetReverse", function(self, on) rawset(self, "reversed", on) end)
    rawset(f, "SetSwipeColor", function(self, r, g, b, a) rawset(self, "swipeColor", { r, g, b, a }) end)
    rawset(f, "SetDrawEdge", function(self, on) rawset(self, "drawEdge", on) end)
  end
  if name then created[name] = f end
  return f
end
local clock = 100
format = string.format
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
local function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local SECRET = {}
function issecretvalue(v) return v == SECRET end
local function defaults() return {
  bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20, font = "Friz Quadrata", fontSize = 13,
    barColor = { 0.44, 0.31, 0.22, 1 }, bgColor = { 0, 0, 0, 0.6 }, textColor = { 0.95, 0.90, 0.84, 1 } },
  areas = {
    icons = { shown = true, cap = 5, size = 44, font = "Friz Quadrata", fontSize = 20, outline = "OUTLINE", grow = "down" },
    texts = { shown = true, cap = 3, font = "Friz Quadrata", fontSize = 36, outline = "THICKOUTLINE", grow = "down", align = "CENTER" },
    circles = { shown = true, cap = 3, size = 64, fontSize = 16, grow = "right" },
  },
  -- the checks below were written for the player's own colours: Use custom colours on (its off side is at the end)
  customColors = true,
  reminders = {}, phases = {}, overrides = {}, nextId = 1 } end
local previews, layers, resets, dropdowns, sliders = {}, {}, 0, {}, {}
local dropdownsMade, slidersMade = 0, 0
local CRT = { db = { alerts = defaults() } }
CRT.Timeline = { readable = function(v) local ok, s = pcall(issecretvalue, v); return ok and not s end }
local fontList = { { name = "Friz Quadrata", path = "Fonts\\\\FRIZQT__.TTF" }, { name = "Arial Narrow", path = "Fonts\\\\ARIALN.TTF" } }
local fontListCalls = 0
function CRT:FontList() fontListCalls = fontListCalls + 1 return fontList end
function CRT:FontPath(name) for _, f in ipairs(fontList) do if f.name == name then return f.path end end return nil end
CRT.UI = {
  RegisterLayer = function(_, key, f) layers[key] = f end,
  RegisterPreview = function(_, key, fn) previews[key] = fn end,
  ResetButtonWidth = function() return 44 end, ResetButton = function(parent, fn) resets = resets + 1 local b = mock("Button", parent) rawset(b, "onReset", fn) return b end,
  SetFrameTitle = function(f, t) rawset(f, "title", t) end,
  StyleWindow = function(_, f) rawset(f, "styled", (rawget(f, "styled") or 0) + 1) end,
  Help = function(parent) return mock("Button", parent) end,
  -- Like CRT_Core/UI/Controls.lua: a dropdown builds its menu (options and get) when made and on refresh, and a
  -- slider reads get() as it is made (slider:Init) and on refresh.
  Dropdown = function(parent, label, opts) dropdownsMade = dropdownsMade + 1 local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    local function menu() local o = opts.options local list = type(o) == "function" and o() or o assert(type(list) == "table", label .. ": options") rawset(r, "value", opts.get()) end
    menu()
    rawset(r, "refresh", function() menu() if opts.enabledIf then opts.enabledIf() end end) dropdowns[label] = r return r end,
  Slider = function(parent, label, opts) slidersMade = slidersMade + 1 local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    rawset(r, "value", opts.get() or opts.min)
    rawset(r, "refresh", function() rawset(r, "value", opts.get() or opts.min) if opts.enabledIf then opts.enabledIf() end end) sliders[label] = r return r end,
}
local spells = { [100] = { name = "Spell Name", icon = 555 } }
CRT.Notes = { SpellInfo = function(_, id) return spells[id] end }
assert(load(rulesSrc, "Rules"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "Engine"))("CowfeeRaidTools", CRT)
assert(load(referenceSrc, "Reference"))("CowfeeRaidTools", CRT)
assert(load(colorsSrc, "Colors"))("CowfeeRaidTools", CRT)
CRT_THEME(CRT, CRT.UI)
assert(load(areasSrc, "Areas"))("CowfeeRaidTools", CRT)
assert(load(barsSrc, "Bars"))("CowfeeRaidTools", CRT)
local A, Areas, B = CRT.Alerts, CRT.AlertAreas, CRT.AlertBars
-- The settings rows show in the panel the Alerts tab owns (Areas.Panel), as on Raid Notes > Alerts.
local panel = Areas.Panel(CreateFrame("Frame", nil, UIParent))
assert(B and type(B.Refresh) == "function" and type(B.ResetPosition) == "function" and type(B.Test) == "function"
  and type(B.Visible) == "function" and type(B.More) == "function", "Bars API")
assert(previews.alertbars and layers.alertbars == nil, "preview registered, layer waits for build")

-- Two blocks, as the addon has: the note block gates its bar flag on noteLines at the pull, reminders don't.
local noteItems, remItems = {}, {}
A:RegisterBlock("note", { label = "Raid note", group = false, Entries = function(run)
  local bars = A:Settings().bars
  local out = {}
  for _, it in ipairs(noteItems) do
    local c = {} for k, v in pairs(it) do c[k] = v end
    c.outputs = { bar = (bars.shown and bars.noteLines) and true or false }
    out[#out + 1] = c
  end
  return out
end })
A:RegisterBlock("rem", { label = "Reminders", group = false, Entries = function(run)
  local out = {}
  for _, it in ipairs(remItems) do
    local c = {} for k, v in pairs(it) do c[k] = v end
    c.outputs = { bar = true }
    out[#out + 1] = c
  end
  return out
end })
local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 21, hold = 0, warn = 0 }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local function pull(notes, rems)
  A:Stop()
  noteItems, remItems = notes or {}, rems or {}
  clock = 100
  wipe(errors)
  CRT.db.alerts = defaults()
  getmetatable(B).__index.Test(B, nil) -- ends a test still running
  B:ResetPosition()
end
local function start() A.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16) end
local function texts() local t = {} for i, v in ipairs(B:Visible()) do t[i] = v.text end return table.concat(t, ",") end

-- the ticker builds the window on login
local ticker
for _, f in ipairs(frames) do if rawget(f, "OnUpdate") and rawget(f, "OnEvent") then ticker = f end end
assert(ticker, "ticker exists")
ticker.OnEvent(ticker, "PLAYER_LOGIN")
local win = created.CowfeeRaidToolsAlertBars
assert(win and layers.alertbars == win, "frame built and registered as a layer")
local handle
for _, f in ipairs(frames) do if f.template == "BackdropTemplate" and f.parent == win then handle = f end end
assert(handle, "drag bar")

-- soonest five and +2 more
local notes = {}
for i = 1, 7 do notes[i] = item{ id = "n" .. i, time = 10 - i, text = "Line " .. i } end
pull(notes)
start()
B:Refresh()
assert(win.shown and #B:Visible() == 5, "five bars")
assert(texts() == "Line 7,Line 6,Line 5,Line 4,Line 3", texts())
assert(B:More() == 2)
local moreShown
for _, f in ipairs(fontStrings) do if f.text == "+2 more" and f.shown then moreShown = f end end
assert(moreShown, "+2 more line")
assert(B:Visible()[1].time == "3.0" and B:Visible()[5].time == "7.0", "time under 10 is one decimal")
assert(not handle.shown, "drag bar hidden without previews")
assert(#errors == 0, tostring(errors[1]))
print("ok bars: shows soonest five and +2 more")

-- time text and fill
pull({ item{ id = "a", time = 15, text = "Far" }, item{ id = "b", time = 5, text = "Near" } })
start()
clock = 100
B:Refresh()
local v = B:Visible()
assert(v[1].text == "Near" and v[1].time == "5.0" and v[2].time == "15", v[2].time)
assert(v[1].fraction == 1 and v[2].fraction == 1, "both start full when they appear")
clock = 103
B:Refresh()
assert(math.abs(B:Visible()[1].fraction - 2 / 5) < 1e-9, "fill empties as at nears: " .. B:Visible()[1].fraction)
assert(math.abs(B:Visible()[2].fraction - 12 / 15) < 1e-9, "over its own total")
assert(math.abs(B:Visible()[1].color[1] - 0.44) < 1e-9 and B:Visible()[1].color[3] == 0.22, "default color")
print("ok bars: time text and fill")

-- a late bar starts full
pull({ item{ id = "late", time = 35, text = "Late" }, item{ id = "early", time = 40, text = "Early" } })
start()
clock = 126.1 -- 8.9 s left for Late, 13.9 for Early, both inside ahead 20 when they first show
B:Refresh()
v = B:Visible()
assert(v[1].text == "Late" and v[1].fraction == 1 and v[2].fraction == 1, "appears full: " .. v[1].fraction)
clock = 130.55
B:Refresh()
v = B:Visible()
assert(math.abs(v[1].fraction - 4.45 / 8.9) < 1e-9, "over the time left at first sight: " .. v[1].fraction)
pull({ item{ id = "cap", time = 60, text = "Far" } })
start()
clock = 140 B:Refresh() -- 20 left: total is ahead
clock = 150 B:Refresh()
assert(math.abs(B:Visible()[1].fraction - 10 / 20) < 1e-9, "capped at ahead")
print("ok bars: a late bar starts full")

-- hidden when not running and no preview
pull({ item{ id = "a", time = 5 } })
B:Refresh()
assert(not win.shown, "not running")
start()
B:Refresh()
assert(win.shown)
A:Stop()
B:Refresh()
assert(not win.shown, "stopped hides")
print("ok bars: hidden when not running and no preview")

-- shown off hides every block
pull({ item{ id = "a", time = 5, text = "N" } }, { item{ id = "r", time = 6, text = "R" } })
start()
B:Refresh()
assert(texts() == "N,R")
A:Settings().bars.shown = false
B:Refresh()
assert(not win.shown and #B:Visible() == 0, "bars shown off hides every block")
print("ok bars: shown off hides every block")

-- preview
pull()
previews.alertbars(true)
assert(win.shown and #B:Visible() == 3 and handle.shown, "three samples and drag bar")
local dragText
for _, f in ipairs(fontStrings) do if f.text == "Alert bars: drag to move" then dragText = f end end
assert(dragText and dragText.parent == handle and dragText.font == "CRTFontSmall")
assert(resets >= 1, "reset button")
A:Settings().bars.shown = false
B:Refresh()
assert(win.shown, "preview shows even with bars off")
A:Settings().bars.shown = true
previews.alertbars(false)
assert(not win.shown and not handle.shown, "preview off hides")
print("ok bars: preview shows samples and drag bar")

-- preview starts full and animates
pull()
previews.alertbars(true)
v = B:Visible()
assert(v[1].fraction == 1 and v[2].fraction == 1 and v[3].fraction == 1, "all full at the start")
assert(v[1].time == "8.0" and v[3].time == "19", v[3].time)
for i = 1, 40 do clock = 100 + i * 0.1 B:Refresh() end
B:Refresh()
v = B:Visible()
assert(math.abs(v[1].fraction - 4 / 8) < 1e-9 and math.abs(v[3].fraction - 15 / 19) < 1e-9, "the preview runs: " .. v[1].fraction)
local restarted = false
for i = 1, 200 do clock = 104 + i * 0.1 B:Refresh() if clock > 119 and B:Visible()[1].fraction == 1 then restarted = true end end -- all passed: starts over, full again
assert(restarted, "starts over full")
previews.alertbars(false)
print("ok bars: preview starts full and animates")

-- reset clears position
pull()
handle.OnDragStop(handle)
local pos = A:Settings().bars.position
assert(pos and pos.point == "CENTER" and pos.x == 50 and pos.y == 150, "saved by center")
B:ResetPosition()
assert(A:Settings().bars.position == nil, "reset clears position")
print("ok bars: reset clears position")

-- the old saved position (the old window's centre) converts once so the top stays
pull()
A:Settings().bars.positionV = nil -- as saved by the old version
A:Settings().bars.position = { point = "CENTER", relativePoint = "CENTER", x = 30, y = 50 }
B:Refresh() -- any use reads the settings
local p = A:Settings().bars.position
assert(p.x == 30 and p.y == 50 + 22, "top kept: first bar centre is h+2 above the old window centre: " .. p.y)
for i = 1, 3 do B:Refresh() end
assert(A:Settings().bars.position.y == 72, "converted once")
handle.OnDragStop(handle) -- a new drag is saved as it is and not converted again
assert(A:Settings().bars.position.y == 150)
B:Refresh()
assert(A:Settings().bars.position.y == 150, "a new position is left alone")
pull()
A:Settings().bars.height = 30
A:Settings().bars.positionV = nil
A:Settings().bars.position = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0 }
B:Refresh()
assert(A:Settings().bars.position.y == 32, "uses the bar height")
print("ok bars: old saved position converted once")

-- note lines off hides note bars (read at the pull)
pull({ item{ id = "n1", time = 5, text = "Note one" } }, { item{ id = "r1", time = 6, text = "Reminder one" } })
A:Settings().bars.noteLines = false
start()
B:Refresh()
assert(texts() == "Reminder one", texts())
print("ok bars: note lines off hides note bars")

-- text and icon sources
pull({ item{ id = "a", time = 1, text = "", spellID = 100 }, item{ id = "b", time = 2, text = "Own", spellID = 100, icon = 777 },
       item{ id = "c", time = 3, text = "No icon" }, item{ id = "d", time = 4, text = SECRET, spellID = 100 },
       item{ id = "e", time = 5, text = SECRET, spellID = SECRET } })
start()
B:Refresh()
v = B:Visible()
assert(#errors == 0, tostring(errors[1]))
assert(v[1].text == "Spell Name" and v[1].icon == 555, "spell name and icon")
assert(v[2].text == "Own" and v[2].icon == 777, "line icon wins")
assert(v[3].text == "No icon" and v[3].icon == nil)
assert(v[4].text == "Spell Name", "secret text falls back to spell name")
assert(v[5].text == "" and v[5].icon == nil, "secret everything draws empty")
print("ok bars: text and icon sources")

-- line color
pull({ item{ id = "a", time = 5, text = "C", color = { 1, 0, 0 } } })
start() B:Refresh()
assert(B:Visible()[1].color[1] == 1 and B:Visible()[1].color[2] == 0)
print("ok bars: line color")

-- test bars
pull()
B:Test(12)
assert(win.shown and #B:Visible() == 3, "test shows three")
assert(B:Visible()[1].time == "12" and B:Visible()[1].fraction == 1, "test starts full")
clock = 103
B:Refresh()
assert(B:Visible()[1].time == "9.0", B:Visible()[1].time)
assert(math.abs(B:Visible()[1].fraction - 9 / 12) < 1e-9, "test runs")
clock = 130
B:Refresh()
assert(not win.shown, "test hides afterwards")
B:Test()
assert(win.shown and B:Visible()[1].time == "12", "default 12 seconds")
print("ok bars: test bars")

-- ticker refresh every 0.1 s
pull({ item{ id = "a", time = 5, text = "T" } })
start()
win:Hide()
ticker.OnUpdate(ticker, 0.05)
assert(not win.shown)
ticker.OnUpdate(ticker, 0.06)
assert(win.shown, "refreshed after 0.1 s")
print("ok bars: ticker")

-- settings in the panel
pull({ item{ id = "s", time = 5, text = "S" } })
start() B:Refresh()
panel:Select(B)
local dialog = panel.frame
assert(dialog and panel.area == B, "shows the bars")
local ahead, width, height = sliders["Show bars from"], sliders["Width"], sliders["Height"]
assert(ahead and ahead.opts.min == 5 and ahead.opts.max == 60 and ahead.value == 20, "show bars from 5-60")
assert(width and width.opts.min == 120 and width.opts.max == 400 and width.opts.step == 10 and width.value == 240, "width 120-400 step 10")
assert(height and height.opts.min == 12 and height.opts.max == 40 and height.value == 20, "height 12-40")
assert(sliders["At once"] and sliders["At once"].opts.min == 1 and sliders["At once"].opts.max == 10 and sliders["At once"].value == 5, "at once 1-10")
assert(dropdowns["Grow"], "grow")
width.opts.set(300)
assert(A:Settings().bars.width == 300 and B:Visible()[1] and B.pool[1].w == 300, "width applied at once")
height.opts.set(30)
assert(B.pool[1].h == 30 and A:Settings().bars.height == 30)
ahead.opts.set(10)
assert(A:Settings().bars.ahead == 10)
sliders["At once"].opts.set(2)
assert(A:Settings().bars.cap == 2)
dropdowns["Grow"].opts.set("up")
assert(A:Settings().bars.grow == "up")
A:Settings().bars.shown = false
assert(ahead.opts.enabledIf() == false and width.opts.enabledIf() == false, "rows grey with bars off")
A:Settings().bars.shown = true
assert(#errors == 0, tostring(errors[1]))
print("ok bars: settings in the panel")

-- font, size and colours
pull({ item{ id = "f1", time = 5, text = "Own", color = { 1, 0, 0 } }, item{ id = "f2", time = 6, text = "Plain" } })
local bs = A:Settings().bars
bs.font = "Arial Narrow" bs.fontSize = 16 bs.height = 24
bs.barColor = { 0.1, 0.2, 0.3, 0.8 } bs.bgColor = { 0.5, 0.6, 0.7, 0.4 } bs.textColor = { 0.9, 0.8, 0.7, 0.6 }
start() B:Refresh()
local b1, b2 = B.pool[1], B.pool[2]
assert(b1.text.fontPath == "Fonts\\\\ARIALN.TTF" and b1.time.fontPath == "Fonts\\\\ARIALN.TTF", "bars font on text and seconds")
assert(b1.text.fontSize == 16 and b1.time.fontSize == 16 and b1.text.fontFlags == "OUTLINE", "size and outline")
bs.height = 12 B:Refresh()
assert(b1.text.fontSize == 10 and b1.time.fontSize == 10, "font clamped to height - 2: " .. tostring(b1.text.fontSize))
bs.height = 24 B:Refresh()
assert(b1.text.fontSize == 16, "back to the set size")
print("ok bars: font and size apply")

local function near(c, r, g, b, a) return c and math.abs(c[1] - r) < 1e-6 and math.abs(c[2] - g) < 1e-6 and math.abs(c[3] - b) < 1e-6 and (a == nil or math.abs((c[4] or 1) - a) < 1e-6) end
assert(near(b1.fill.color, 1, 0, 0), "alert colour on the fill")
assert(near(b2.fill.color, 0.1, 0.2, 0.3, 0.8), "bar colour when the alert has none: " .. tostring(b2.fill.color and b2.fill.color[1]))
assert(near(B:Visible()[2].color, 0.1, 0.2, 0.3), "row colour is the bar colour")
CRT.db.alerts.bars.barColor = { 0.3, 0.3, 0.3, 1 } B:Refresh()
assert(near(b2.fill.color, 0.3, 0.3, 0.3) and near(b1.fill.color, 1, 0, 0), "bar colour changes only plain bars")
pull({ item{ id = "s", time = 5, text = "Sec", color = SECRET } })
A:Settings().bars.barColor = { 0.1, 0.2, 0.3, 1 }
start() B:Refresh()
assert(near(B.pool[1].fill.color, 0.1, 0.2, 0.3), "unreadable alert colour falls back to the bar colour")
print("ok bars: alert colour wins over bar colour")

pull({ item{ id = "t1", time = 5, text = "T", color = { 1, 0, 0 } } })
bs = A:Settings().bars
bs.bgColor = { 0.5, 0.6, 0.7, 0.4 } bs.textColor = { 0.9, 0.8, 0.7, 0.6 }
start() B:Refresh()
b1 = B.pool[1]
assert(near(b1.bg.color, 0.5, 0.6, 0.7, 0.4), "background colour from the area")
assert(near(b1.text.textColor, 0.9, 0.8, 0.7, 0.6) and near(b1.time.textColor, 0.9, 0.8, 0.7, 0.6), "text colour on text and seconds")
local notes2 = {}
for i = 1, 7 do notes2[i] = item{ id = "m" .. i, time = 10 - i, text = "L" .. i, color = { 0, 1, 0 } } end
pull(notes2)
bs = A:Settings().bars
bs.textColor = { 0.9, 0.8, 0.7, 0.6 } bs.font = "Arial Narrow" bs.fontSize = 14
start() B:Refresh()
moreShown = nil
for _, f in ipairs(fontStrings) do if f.text == "+2 more" and f.shown then moreShown = f end end
assert(moreShown and near(moreShown.textColor, 0.9, 0.8, 0.7, 0.6), "+N more uses the text colour")
assert(moreShown.fontPath == "Fonts\\\\ARIALN.TTF" and moreShown.fontSize == 14, "+N more uses the bars font")
-- an old save without the new fields
pull({ item{ id = "o", time = 5, text = "Old" } })
bs = A:Settings().bars
bs.font, bs.fontSize, bs.barColor, bs.bgColor, bs.textColor = nil, nil, nil, nil, nil
start() B:Refresh()
b1 = B.pool[1]
assert(near(b1.fill.color, 0.44, 0.31, 0.22) and near(b1.bg.color, 0, 0, 0, 0.6) and near(b1.text.textColor, 0.95, 0.90, 0.84, 1), "old save uses the defaults")
assert(b1.text.fontSize == 13 and b1.text.fontPath == "Fonts\\\\FRIZQT__.TTF", "old save font defaults")
assert(#errors == 0, tostring(errors[1]))
print("ok bars: background and text colours apply")

-- the dialog rows
pull({ item{ id = "d", time = 5, text = "D" } })
start() B:Refresh() panel:Select(B)
assert(dropdowns["Font"] and sliders["Text size"] and sliders["Text size"].opts.min == 8 and sliders["Text size"].opts.max == 24 and sliders["Text size"].value == 13, "font and text size rows")
local swatches = {}
for _, f in ipairs(frames) do if rawget(f, "colorLabel") then swatches[f.colorLabel] = f end end
assert(swatches["Bar colour"] and swatches["Background"] and swatches["Text colour"], "three colour rows")
sliders["Text size"].opts.set(18) dropdowns["Font"].opts.set("Arial Narrow")
assert(A:Settings().bars.fontSize == 18 and A:Settings().bars.font == "Arial Narrow" and B.pool[1].text.fontSize == 18, "settings applied")
-- colour rows grey out with the area off
A:Settings().bars.shown = false panel:Select(B)
for _, f in ipairs(frames) do if rawget(f, "colorLabel") then swatches[f.colorLabel] = f end end
assert(swatches["Bar colour"].swatch.enabledState == false and swatches["Text colour"].swatch.enabledState == false, "colour rows grey with bars off")
A:Settings().bars.shown = true panel:Select(B)
assert(swatches["Bar colour"].swatch.enabledState == true, "colour rows on again")
-- a bad alpha is no reason to error
A:Settings().bars.barColor = { 1, 0, 0, "x" } A:Settings().bars.bgColor = { 0, 0, 1, {} }
start() B:Refresh()
assert(#errors == 0, tostring(errors[1]))
assert(near(B.pool[1].fill.color, 1, 0, 0, 1) and near(B.pool[1].bg.color, 0, 0, 1, 0.6), "bad alpha takes the default's")
print("ok bars: font and colour rows")

-- glow at zero
pull({ item{ id = "g", time = 5, text = "Glow", glow = true, hold = 2 } })
start() B:Refresh()
local g1 = B.pool[1]
assert(g1.glowBorder == nil or not g1.glowBorder.shown, "no glow before zero")
clock = 105.2 B:Refresh()
assert(g1.glowBorder and g1.glowBorder.shown, "glows at zero")
clock = 108 B:Refresh()
assert(#B:Visible() == 0 and not g1.glowBorder.shown, "glow off when hidden")
print("ok bars: glow at zero")

-- the more line goes away when everything fits
pull(notes)
start() B:Refresh()
assert(B:More() == 2)
A:Settings().bars.cap = 7 B:Refresh()
assert(B:More() == 0)
moreShown = nil
for _, f in ipairs(fontStrings) do if f.text == "+2 more" and f.shown then moreShown = f end end
assert(not moreShown, "more line hidden")
print("ok bars: more line hides")

-- pooled
pull(notes) start() B:Refresh()
local before = made
for i = 1, 30 do clock = 100 + i * 0.1 B:Refresh() end
assert(made == before, "nothing created per refresh")
print("ok bars: made does not grow")

-- Use custom colours off (the default): every bar is in its ability type's colour, the theme's accent with no
-- known type; your Bar, Background and Text colours are ignored and greyed but stay saved; a raid note line's
-- own colour (the raid leader's) still wins, yours (a reminder's) does not.
local TYPES = CRT.TimelineReference.TYPES
pull({ item{ id = "lead", time = 5, text = "Leader", color = { 1, 0, 0 }, abilityType = "soak" } },
  { item{ id = "mine", time = 6, text = "Mine", color = { 0, 1, 0 } }, item{ id = "typed", time = 7, text = "Typed", abilityType = "dispel" },
    item{ id = "plain", time = 8, text = "Plain" } })
bs = A:Settings().bars
A:Settings().customColors = false
bs.barColor = { 0.1, 0.2, 0.3, 0.8 } bs.bgColor = { 0.5, 0.6, 0.7, 0.4 } bs.textColor = { 0.9, 0.8, 0.7, 0.6 }
start() B:Refresh()
local byText = {}
for i, v in ipairs(B:Visible()) do byText[v.text] = B.pool[i] end
assert(near(byText.Leader.fill.color, 1, 0, 0, 0.9), "off: the raid note's own colour still wins")
assert(near(byText.Mine.fill.color, CRT.PALETTE.accent[1], CRT.PALETTE.accent[2], CRT.PALETTE.accent[3], 0.9), "off: your reminder's colour is ignored, no type gives the accent")
local dc = TYPES.dispel.color
assert(near(byText.Typed.fill.color, dc[1], dc[2], dc[3], 0.9), "off: a typed bar in its type's colour")
assert(near(byText.Plain.fill.color, CRT.PALETTE.accent[1], CRT.PALETTE.accent[2], CRT.PALETTE.accent[3]), "off: no type, the theme's accent")
assert(near(byText.Plain.bg.color, 0, 0, 0, 0.6) and near(byText.Plain.text.textColor, 0.95, 0.90, 0.84, 1), "off: background and text colours are the defaults")
assert(near(bs.barColor, 0.1, 0.2, 0.3, 0.8) and near(bs.bgColor, 0.5, 0.6, 0.7, 0.4) and near(bs.textColor, 0.9, 0.8, 0.7, 0.6), "off: your colours stay saved")
-- a theme switch repaints the accent at the next draw
CRT.UI.SwitchTheme("nitro") B:Refresh()
assert(near(byText.Plain.fill.color, CRT.PALETTE.accent[1], CRT.PALETTE.accent[2], CRT.PALETTE.accent[3]), "off: the accent follows the theme")
CRT.UI.SwitchTheme("blizzard")
-- the colour rows grey out while off, and come back on
panel:Select(B)
for _, f in ipairs(frames) do if rawget(f, "colorLabel") then swatches[f.colorLabel] = f end end
assert(swatches["Bar colour"].swatch.enabledState == false and swatches["Background"].swatch.enabledState == false
  and swatches["Text colour"].swatch.enabledState == false, "off: the colour rows are greyed")
A:Settings().customColors = true panel:Select(B) B:Refresh()
assert(swatches["Bar colour"].swatch.enabledState == true, "on: the colour rows are back")
assert(near(byText.Mine.fill.color, 0, 1, 0, 0.9) and near(byText.Plain.fill.color, 0.1, 0.2, 0.3, 0.8)
  and near(byText.Plain.bg.color, 0.5, 0.6, 0.7, 0.4), "on: your saved colours apply again")
assert(#errors == 0, tostring(errors[1]))
print("ok bars: type colours, custom colours only with the box")

-- the Previews' bars show three types' colours
A:Settings().customColors = false
local samples = B.def.sample(500)
assert(samples[1].abilityType == "dispel" and samples[2].abilityType == "soak" and samples[3].abilityType == "mythic", "preview types")
print("ok bars: previews in type colours")

-- the ability type after the text, whatever colour the bar uses
A:Settings().customColors = true
pull({ item{ id = "t1", time = 5, text = "Hungering Pyre", abilityType = "soak" },
       item{ id = "t2", time = 6, text = "Own colour", abilityType = "mythic", color = { 1, 0, 0 } },
       item{ id = "t3", time = 7, text = "Unknown" },
       item{ id = "t4", time = 8, text = "Odd", abilityType = "nonsense" } })
start() B:Refresh()
v = B:Visible()
assert(v[1].text == "Hungering Pyre" and v[1].kind == " (soak)" and B.pool[1].kind.text == " (soak)" and B.pool[1].kind.shown, "typed bar names its type")
assert(v[2].kind == " (mythic)", "shown with the line's own colour too")
assert(v[3].kind == nil and not B.pool[3].kind.shown and B.pool[3].kind.text == "", "no type known: text unchanged")
assert(v[4].kind == nil, "an unknown type key is not shown")
A:Settings().customColors = false B:Refresh()
assert(B:Visible()[1].kind == " (soak)", "shown with type colours too")
-- the setting, on by default and saved
assert(CRT.db.alerts.bars.showType == nil or CRT.db.alerts.bars.showType == true)
panel:Select(B)
local box
for _, f in ipairs(frames) do if rawget(f, "labelText") == "Show the ability type" then box = f end end
assert(box and box.help, "checkbox with a (?) help")
box.refresh() assert(box.checked == true, "on by default")
box.OnClick({ GetChecked = function() return false end })
assert(A:Settings().bars.showType == false and B:Visible()[1].kind == nil and not B.pool[1].kind.shown, "off: names only")
box.refresh() assert(box.checked == false)
A:Settings().bars.showType = true B:Refresh()
assert(B:Visible()[1].kind == " (soak)", "on again")
print("ok bars: the ability type after the text")

-- a long text is cut before the type; the type and the seconds stay
A:Settings().bars.width = 240 A:Settings().bars.fontSize = 13
pull({ item{ id = "long", time = 5, text = "A very long ability name that cannot fit", abilityType = "soak" },
       item{ id = "short", time = 6, text = "Pyre", abilityType = "soak" } })
start() B:Refresh()
local lb, sb = B.pool[1], B.pool[2]
local timeW = #lb.time.text * 6
assert(lb.text.w >= 1 and lb.text.w + #" (soak)" * 6 + timeW + 12 <= 240, "long text leaves room: " .. lb.text.w)
assert(lb.kind.shown and lb.kind.text == " (soak)", "the type stays whole")
local kp = lb.kind.pts[#lb.kind.pts]
assert(kp[1] == "LEFT" and kp[2] == lb.text and kp[3] == "RIGHT", "the type follows the cut text")
assert(sb.text.w == #"Pyre" * 6 + 2, "a short text is not stretched: " .. sb.text.w)
-- with the type off, the whole room is the text's
A:Settings().bars.showType = false B:Refresh()
assert(lb.text.w > 150, "no type: more room for the text: " .. lb.text.w)
assert(#errors == 0, tostring(errors[1]))
print("ok bars: long text is cut before the type")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (let i = 2; i < 8; i++) {
  let src = '';
  try { src = fs.readFileSync(process.argv[i], 'utf8'); } catch (e) { console.error('missing ' + process.argv[i]); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 6, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
