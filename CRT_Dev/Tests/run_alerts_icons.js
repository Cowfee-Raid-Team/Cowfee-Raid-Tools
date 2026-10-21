// CRT_Modules/Alerts/Icons.lua: the icons area (icon, cooldown swipe, seconds, text), with mock frames.
// Usage: node run_alerts_icons.js CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Areas.lua CRT_Modules/Alerts/Icons.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local rulesSrc, engineSrc, areasSrc, iconsSrc = ...
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
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "textColor", { r, g, b }) end end
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
    if k == "SetAllPoints" then return function(self, target) rawset(self, "allPoints", target or self.parent) end end
    if k == "SetFrameLevel" then return function(self, n) rawset(self, "level", n) end end
    if k == "SetDesaturation" then return function(self, v) rawset(self, "desat", v) end end
    if k == "SetDesaturated" then return function(self, on) rawset(self, "desatOn", on) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} rawset(self, "allPoints", nil) end end
    if k == "GetCenter" then return function(self) if self == UIParent then return 480, 300 end return 530, 450 end end
    if k == "SetColorTexture" or k == "SetVertexColor" then return function(self, r, g, b) rawset(self, "color", { r, g, b }) end end
    if k == "GetFrameLevel" then return function(self) return rawget(self, "level") or 1 end end
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
  -- As the game's XML does: a CooldownFrameTemplate frame starts stretched over its parent (setAllPoints).
  if template == "CooldownFrameTemplate" then rawset(f, "allPoints", parent) end
  if kind == "Cooldown" then
    rawset(f, "cooldownCalls", {})
    rawset(f, "SetCooldown", function(self, start, dur) self.cooldownCalls[#self.cooldownCalls + 1] = { start, dur } end)
    rawset(f, "Clear", function(self) self.cooldownCalls[#self.cooldownCalls + 1] = "clear" end)
    rawset(f, "SetHideCountdownNumbers", function(self, on) rawset(self, "hideNumbers", on) end)
    rawset(f, "SetDrawBling", function(self, on) rawset(self, "bling", on) end)
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
-- A frame's drawn size: the frame it is stretched over (SetAllPoints) wins over its own SetSize.
local function bounds(f)
  local t = rawget(f, "allPoints")
  if t then return bounds(t) end
  return f.w, f.h
end
local function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local SECRET = {}
function issecretvalue(v) return v == SECRET end
local function defaults() return {
  bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
  areas = {
    icons = { shown = true, cap = 5, size = 44, font = "Friz Quadrata", fontSize = 20, outline = "OUTLINE", grow = "down" },
    texts = { shown = true, cap = 3, font = "Friz Quadrata", fontSize = 36, outline = "THICKOUTLINE", grow = "down", align = "CENTER" },
    circles = { shown = true, cap = 3, size = 64, fontSize = 16, grow = "right" },
  },
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
CRT_THEME(CRT, CRT.UI)
assert(load(areasSrc, "Areas"))("CowfeeRaidTools", CRT)
assert(load(iconsSrc, "Icons"))("CowfeeRaidTools", CRT)
local A, Areas, I = CRT.Alerts, CRT.AlertAreas, CRT.AlertIcons
-- The settings rows show in the panel the Alerts tab owns (Areas.Panel), as on Raid Notes > Alerts.
local panel = Areas.Panel(CreateFrame("Frame", nil, UIParent))
assert(I and type(I.Refresh) == "function" and type(I.Visible) == "function" and type(I.Test) == "function", "Icons area API")
assert(previews.alerticons, "preview registered")

local items = {}
A:RegisterBlock("rem", { label = "Reminders", group = false, Entries = function()
  local out = {}
  for _, it in ipairs(items) do local c = {} for k, v in pairs(it) do c[k] = v end out[#out + 1] = c end
  return out
end })
local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 31, hold = 0.5, warn = 8, icon = 4444, outputs = { icon = true } }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local function pull(list)
  A:Stop()
  items = list or {}
  clock = 100
  wipe(errors)
  CRT.db.alerts = defaults()
  I:ResetPosition()
  for _, f in ipairs(frames) do if f.kind == "Cooldown" then f.cooldownCalls = {} end end
end
local function start() A.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16) end
local ticker
for _, f in ipairs(frames) do if rawget(f, "OnUpdate") and rawget(f, "OnEvent") then ticker = f end end
ticker.OnEvent(ticker, "PLAYER_LOGIN")
local win = created.CowfeeRaidToolsAlertIcons
assert(win and layers.alerticons == win, "frame built on its layer")

-- texture, seconds and text
pull({ item{ id = "a", time = 5, text = "Soak", color = { 1, 0, 0 } } })
start()
I:Refresh()
local w = I:Visible()[1]
assert(w and w.icon.texture == 4444 and w.icon.shown, "icon texture")
assert(w.icon.w == 44 and w.icon.h == 44, "icon size")
assert(w.seconds.text == "5", "seconds: " .. tostring(w.seconds.text))
assert(w.text.text == "Soak" and w.text.shown and w.text.textColor[1] == 1 and w.text.textColor[2] == 0, "text and colour")
assert(w.seconds.fontSize == 22, "seconds at half the icon: " .. tostring(w.seconds.fontSize))
assert(w.text.fontSize == 20 and w.text.fontPath == "Fonts\\\\FRIZQT__.TTF" and w.text.fontFlags == "OUTLINE", "area font")
assert(w.w == 44 + 6 + #"Soak" * 6 + 4, "widget as wide as icon and words: " .. w.w)
local cd = w.cooldown
assert(cd.kind == "Cooldown" and cd.template == "CooldownFrameTemplate" and cd.parent == w.iconFrame, "cooldown child of the icon frame")
assert(cd.hideNumbers == true and cd.drawEdge == false, "own numbers, no edge")
clock = 102.2
I:Refresh()
assert(w.seconds.text == "3", "rounded up: " .. w.seconds.text)
clock = 104.95
I:Refresh()
assert(w.seconds.text == "NOW", "NOW under 0.1")
clock = 100
I:Refresh()
assert(#errors == 0, tostring(errors[1]))
print("ok icons: texture, seconds and text")

-- the swipe is bounded to the icon square
pull({ item{ id = "b", time = 5, text = "A very very long line of words that runs on" } })
start()
I:Refresh()
w = I:Visible()[1]
local bw, bh = bounds(w.cooldown)
assert(bw == 44 and bh == 44 and w.w > 100, "swipe bounds are the icon square, not the widget: " .. bw .. "x" .. bh .. " in " .. w.w)
assert(w.cooldown.allPoints == w.iconFrame and bounds(w.iconFrame) == 44, "cooldown stretched over the icon frame")
assert(w.icon.parent == w.iconFrame, "icon texture on the icon frame")
assert(w.text.parent ~= w.iconFrame and w.text.parent ~= w.cooldown and w.text.parent == w, "text is not under the swipe")
assert(w.text.pts[1][1] == "LEFT" and w.text.pts[1][2] == w and w.text.pts[1][4] == 44 + 6, "text to the right of the icon")
A:Settings().areas.icons.size = 60
I:Refresh()
bw, bh = bounds(w.cooldown)
assert(bw == 60 and bh == 60, "follows the size")
print("ok icons: swipe bounded to the icon")
-- the mock models the template: the old pattern (SetSize + SetPoint, no ClearAllPoints) stays stretched
local old = CreateFrame("Cooldown", nil, w, "CooldownFrameTemplate")
old:SetSize(44, 44)
old:SetPoint("LEFT", w, "LEFT", 0, 0)
local ow = bounds(old)
assert(ow == w.w and ow > 44, "old pattern is as wide as the widget: " .. tostring(ow))
bw, bh = bounds(w.cooldown)
assert(bw == 60 and bh == 60 and w.cooldown.allPoints == w.iconFrame, "current code is exactly the icon square")
print("ok icons: mock catches the stretched cooldown")

-- the seconds sit above the swipe, centred on the icon
assert(w.seconds.parent == w.over and w.over:GetFrameLevel() > w.cooldown:GetFrameLevel(), "seconds frame above the cooldown")
assert(w.over.pts[1][1] == "CENTER" and w.over.pts[1][2] == w.iconFrame, "overlay centred on the icon")
assert(w.seconds.pts[1][1] == "CENTER" and w.seconds.pts[1][2] == w.over, "seconds centred")
assert(w.over.parent ~= w.cooldown, "overlay not inside the cooldown")
print("ok icons: seconds above the swipe")

-- fades to grey as time runs out
pull({ item{ id = "f", time = 5, text = "Fade", warn = 8 } })
start()
clock = 100 I:Refresh()
w = I:Visible()[1]
assert(w.icon.desat == 0, "starts in colour: " .. tostring(w.icon.desat))
clock = 102.5 I:Refresh()
assert(math.abs(w.icon.desat - 0.5) < 1e-6, "half way: " .. tostring(w.icon.desat))
clock = 104 I:Refresh()
assert(math.abs(w.icon.desat - 0.8) < 1e-6, "four fifths: " .. tostring(w.icon.desat))
clock = 105 I:Refresh()
assert(w.icon.desat == 1, "grey at zero: " .. tostring(w.icon.desat))
clock = 105.04 I:Refresh()
assert(w.icon.desat == 1, "grey after zero")
-- a late line is full colour when first shown, then fades over what is left
pull({ item{ id = "fl", time = 10, text = "Late", warn = 8 } })
start()
clock = 108 I:Refresh()
w = I:Visible()[1]
assert(w.icon.desat == 0, "late line starts in colour: " .. tostring(w.icon.desat))
clock = 109 I:Refresh()
assert(math.abs(w.icon.desat - 0.5) < 1e-6, "late line half way: " .. tostring(w.icon.desat))
-- a widget taking a new line goes back to colour
I.def.draw(w, { id = "next", at = 120, warn = 8, icon = 4444, text = "N" }, 119.9, A:Settings().areas.icons, 119.9)
assert(w.icon.desat == 0, "new line resets: " .. tostring(w.icon.desat))
assert(#errors == 0, tostring(errors[1]))
print("ok icons: fades to grey")

-- fade off keeps the colour
pull({ item{ id = "fo", time = 5, text = "Keep" } })
start()
clock = 100 I:Refresh()
A:Settings().areas.icons.fade = false
w = I:Visible()[1]
clock = 104 I:Refresh()
assert(w.icon.desat == 0, "colour with fade off: " .. tostring(w.icon.desat))
clock = 105.2 I:Refresh()
assert(w.icon.desat == 0, "still colour at zero")
A:Settings().areas.icons.fade = true
I:Refresh()
assert(w.icon.desat == 1, "fade back on")
-- the dialog row
panel:Select(I)
local dlg = panel.frame
local fcheck
for _, f in ipairs(frames) do if f.kind == "CheckButton" and rawget(f, "labelText") == "Fade to grey as time runs out" and f.parent == dlg then fcheck = f end end
assert(fcheck and fcheck.checked, "Fade row, on")
fcheck:SetChecked(false)
fcheck.OnClick(fcheck)
assert(A:Settings().areas.icons.fade == false, "turned off")
-- without SetDesaturation the texture falls back to SetDesaturated
pull({ item{ id = "fb", time = 5, text = "Fallback" } })
start()
clock = 100 I:Refresh()
w = I:Visible()[1]
w.icon.SetDesaturation = false
rawset(w.icon, "SetDesaturation", nil)
local mt = getmetatable(w.icon)
local oldIndex = mt.__index
mt.__index = function(t, k) if k == "SetDesaturation" then return nil end return oldIndex(t, k) end
clock = 104 I:Refresh()
assert(w.icon.desatOn == true, "fallback greys at 0.8")
clock = 100.5 I.def.draw(w, { id = "fb", at = 105, warn = 8, icon = 4444, text = "F" }, 100.5, A:Settings().areas.icons, 100)
assert(w.icon.desatOn == false, "fallback in colour early")
mt.__index = oldIndex
assert(#errors == 0, tostring(errors[1]))
print("ok icons: fade off keeps colour")

-- cooldown set once per line
pull({ item{ id = "once", time = 5, text = "A", warn = 8 } })
start()
clock = 100
for i = 1, 10 do clock = 100 + i * 0.1 I:Refresh() end
w = I:Visible()[1]
assert(#w.cooldown.cooldownCalls == 1, "set once over many refreshes: " .. #w.cooldown.cooldownCalls)
local c = w.cooldown.cooldownCalls[1]
assert(math.abs(c[1] - 100.1) < 1e-6 and math.abs(c[2] - 4.9) < 1e-6, "from first showing: " .. tostring(c[1]) .. "," .. tostring(c[2]))
-- a line moving up onto the widget sets it again; the same line staying does not
pull({ item{ id = "m1", time = 5, text = "A" }, item{ id = "m2", time = 6, text = "B" } })
start()
clock = 100 I:Refresh()
local v = I:Visible()
local first, second = v[1], v[2]
assert(#first.cooldown.cooldownCalls == 1 and #second.cooldown.cooldownCalls == 1)
clock = 105.6 I:Refresh()
v = I:Visible()
assert(#v == 1 and v[1] == first and #first.cooldown.cooldownCalls == 2, "b moved up: swipe set for b")
assert(first.text.text == "B", "b on the first widget")
local cb = first.cooldown.cooldownCalls[2]
assert(math.abs(cb[1] - 100) < 1e-6 and math.abs(cb[2] - 6) < 1e-6, "b keeps its first showing: " .. tostring(cb[1]) .. "," .. tostring(cb[2]))
clock = 105.7 I:Refresh()
assert(#first.cooldown.cooldownCalls == 2, "no new call while it stays")
I.def.draw(first, { id = "m2", at = 107, warn = 8, icon = 4444, text = "B" }, 105.7, A:Settings().areas.icons, 100)
assert(#first.cooldown.cooldownCalls == 3, "at changed: set again")
assert(#errors == 0, tostring(errors[1]))
print("ok icons: cooldown set once per line")

-- the swipe starts full for a late line
pull({ item{ id = "late", time = 10, text = "Late", warn = 8 } })
start()
clock = 108 -- first shown with 2 s left
I:Refresh()
w = I:Visible()[1]
assert(#w.cooldown.cooldownCalls == 1, "one call")
c = w.cooldown.cooldownCalls[1]
assert(math.abs(c[1] - 108) < 1e-6 and math.abs(c[2] - 2) < 1e-6, "SetCooldown(at - 2, 2): " .. tostring(c[1]) .. "," .. tostring(c[2]))
clock = 109
I:Refresh()
assert(#w.cooldown.cooldownCalls == 1, "not reset as time runs")
print("ok icons: swipe starts full for a late line")

-- secret texture shows no icon
pull({ item{ id = "s", time = 5, text = "Hidden icon", icon = SECRET } })
start()
I:Refresh()
w = I:Visible()[1]
assert(#errors == 0, tostring(errors[1]))
assert(w and not w.icon.shown and not w.cooldown.shown, "no icon, no swipe")
assert(w.text.text == "Hidden icon", "text still shows")
pull({ item{ id = "s2", time = 5, text = SECRET, icon = false, spellID = 100 } })
start()
I:Refresh()
w = I:Visible()[1]
assert(#errors == 0 and w.icon.texture == 555 and w.text.text == "Spell Name", "spell fills a secret text, and its icon")
pull({ item{ id = "s3", time = 5, text = "No icon", icon = false } })
start()
I:Refresh()
assert(#errors == 0 and not I:Visible()[1].icon.shown, "missing icon")
print("ok icons: secret texture shows no icon")

-- hide text option
pull({ item{ id = "t", time = 5, text = "Words" } })
start()
I:Refresh()
w = I:Visible()[1]
assert(w.text.shown and w.w > 44)
A:Settings().areas.icons.showText = false
I:Refresh()
assert(not w.text.shown and w.w == 44, "just the icon: " .. w.w)
A:Settings().areas.icons.showText = true
I:Refresh()
assert(w.text.shown and w.w > 44, "back")
panel:Select(I)
local dialog = panel.frame
assert(panel.area == I, "shows this area")
assert(sliders["Size"].opts.min == 24 and sliders["Size"].opts.max == 96 and sliders["Size"].value == 44, "size 24-96")
assert(sliders["Text size"].opts.min == 10 and sliders["Text size"].opts.max == 40 and sliders["Text size"].value == 20, "text size 10-40")
assert(dropdowns["Font"] and dropdowns["Outline"], "font and outline")
local check
for _, f in ipairs(frames) do if f.kind == "CheckButton" and rawget(f, "labelText") == "Show the text" and f.parent == dialog then check = f end end
assert(check and check.shown and check.checked, "Show the text, on")
check:SetChecked(false)
check.OnClick(check)
assert(A:Settings().areas.icons.showText == false and not w.text.shown, "turned off at once")
sliders["Size"].opts.set(60)
assert(I:Visible()[1].icon.w == 60 and I:Visible()[1].seconds.fontSize == 30, "size applied at once")
dropdowns["Font"].opts.set("Arial Narrow")
assert(I:Visible()[1].seconds.fontPath == "Fonts\\\\ARIALN.TTF", "font applied")
assert(#errors == 0, tostring(errors[1]))
print("ok icons: hide text option")

-- glow at zero
pull({ item{ id = "g", time = 5, text = "Glow", glow = true } })
start()
I:Refresh()
local g1 = I:Visible()[1]
assert(g1.glowBorder == nil or not g1.glowBorder.shown, "no glow before zero")
clock = 105.2
I:Refresh()
g1 = I:Visible()[1]
assert(g1.seconds.text == "NOW" and g1.glowBorder and g1.glowBorder.shown, "glows at zero")
clock = 106
I:Refresh()
assert(#I:Visible() == 0 and not g1.glowBorder.shown, "glow off when hidden")
print("ok icons: glow at zero")

-- the preview shows three icons with their swipes
pull()
previews.alerticons(true)
assert(#I:Visible() == 3 and I:Visible()[2].icon.texture, "preview samples")
assert(#errors == 0, tostring(errors[1]))
print("ok icons: preview")

-- column shares a left edge
previews.alerticons(false)
pull({ item{ id = "k1", time = 5, text = "Short" }, item{ id = "k2", time = 6, text = "A much longer line of words" } })
start()
clock = 100 I:Refresh()
v = I:Visible()
assert(#v == 2 and v[1].w ~= v[2].w, "different widths")
assert(v[1].pts[1][1] == "TOPLEFT" and v[2].pts[1][1] == "TOPLEFT" and v[2].pts[1][2] == v[1] and v[2].pts[1][3] == "BOTTOMLEFT", "same left anchor")
A:Settings().areas.icons.grow = "up"
I:Refresh()
v = I:Visible()
assert(v[1].pts[1][1] == "BOTTOMLEFT" and v[2].pts[1][1] == "BOTTOMLEFT" and v[2].pts[1][3] == "TOPLEFT", "left edge growing up")
print("ok icons: column shares a left edge")

-- no per-refresh creation, other addons' numbers and finish flash off, steady preview swipes
pull({ item{ id = "n1", time = 5, text = "N" } })
start()
I:Refresh()
local before = made
for i = 1, 20 do clock = 100 + i * 0.1 I:Refresh() end
assert(made == before, "nothing created per refresh")
cd = I:Visible()[1].cooldown
assert(cd.noCooldownCount == true and cd.bling == false, "no outside numbers, no bling")
pull()
previews.alerticons(true)
w = I:Visible()[1]
local calls = #I:Visible()[2].cooldown.cooldownCalls
for i = 1, 20 do clock = 100 + i * 0.1 I:Refresh() end
assert(#I:Visible()[2].cooldown.cooldownCalls == calls, "preview swipe set once, not every tick")
previews.alerticons(false)
print("ok icons: steady preview and cooldown flags")

-- Font and Text size follow Show the text
pull({ item{ id = "e1", time = 5, text = "E" } })
start()
I:Refresh()
panel:Select(I)
A:Settings().areas.icons.showText = false
local en = true
local o = sliders["Text size"].opts
assert(o.enabledIf() == false and dropdowns["Font"].opts.enabledIf() == false, "disabled without the text")
A:Settings().areas.icons.showText = true
assert(o.enabledIf() == true and dropdowns["Font"].opts.enabledIf() == true, "enabled with it")
print("ok icons: text rows follow Show the text")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (let i = 2; i < 6; i++) {
  let src = '';
  try { src = fs.readFileSync(process.argv[i], 'utf8'); } catch (e) { console.error('missing ' + process.argv[i]); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
