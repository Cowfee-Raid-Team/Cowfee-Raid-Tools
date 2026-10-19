// Alerts/Circles.lua: the circles area (ring, seconds, text), with mock frames.
// Usage: node run_alerts_circles.js Alerts/Rules.lua Alerts/Engine.lua Alerts/Areas.lua Alerts/Circles.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local rulesSrc, engineSrc, areasSrc, circlesSrc, controlsSrc = ...
local RING = "Interface\\\\AddOns\\\\CowfeeRaidTools\\\\Media\\\\"
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
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} rawset(self, "allPoints", nil) end end
    if k == "GetCenter" then return function(self) if self == UIParent then return 480, 300 end return 530, 450 end end
    if k == "SetColorTexture" or k == "SetVertexColor" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetBackdropColor" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
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
  -- As the game's XML does: a CooldownFrameTemplate frame starts stretched over its parent (setAllPoints).
  if template == "CooldownFrameTemplate" then rawset(f, "allPoints", parent) end
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
ColorPickerFrame = { setups = {}, rgb = { 1, 1, 1 }, alpha = 1 }
function ColorPickerFrame:SetupColorPickerAndShow(info) self.info = info; self.setups[#self.setups + 1] = info end
function ColorPickerFrame:GetColorRGB() return self.rgb[1], self.rgb[2], self.rgb[3] end
function ColorPickerFrame:GetColorAlpha() return self.alpha end
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
    circles = { shown = true, cap = 3, size = 64, fontSize = 16, grow = "right", thickness = "medium", ringColor = { 1, 1, 1, 0.9 }, font = "Friz Quadrata" },
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
  -- Like UI/Controls.lua: a dropdown builds its menu (options and get) when made and on refresh, and a
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
assert(load(areasSrc, "Areas"))("CowfeeRaidTools", CRT)
assert(load(circlesSrc, "Circles"))("CowfeeRaidTools", CRT)
do -- the real UI/Controls.lua: only PickColor is taken, the harness keeps its own Dropdown and Slider
  local tmp = { UI = {} }
  assert(load(controlsSrc, "UI/Controls.lua"))("CowfeeRaidTools", tmp)
  CRT.UI.PickColor = tmp.UI.PickColor
end
local A, Areas, I = CRT.Alerts, CRT.AlertAreas, CRT.AlertCircles
-- The settings rows show in the panel the Alerts tab owns (Areas.Panel), as on Raid Notes > Alerts.
local panel = Areas.Panel(CreateFrame("Frame", nil, UIParent))
assert(I and type(I.Refresh) == "function" and type(I.Visible) == "function" and type(I.Test) == "function", "Circles area API")
assert(previews.alertcircles, "preview registered")

local items = {}
A:RegisterBlock("rem", { label = "Reminders", group = false, Entries = function()
  local out = {}
  for _, it in ipairs(items) do local c = {} for k, v in pairs(it) do c[k] = v end out[#out + 1] = c end
  return out
end })
local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 31, hold = 0.5, warn = 8, outputs = { circle = true } }
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
local win = created.CowfeeRaidToolsAlertCircles
assert(win and layers.alertcircles == win, "frame built on its layer")

-- cooldown and seconds
pull({ item{ id = "a", time = 5, text = "Soak" } })
start()
I:Refresh()
local w = I:Visible()[1]
assert(w and w.ring.w == 64 and w.ring.h == 64, "ring size")
local cd = w.cooldown
assert(cd.kind == "Cooldown" and cd.template == "CooldownFrameTemplate" and cd.parent == w.ring, "cooldown child of the ring")
do
  local old = CreateFrame("Cooldown", nil, w, "CooldownFrameTemplate")
  old:SetSize(64, 64)
  old:SetPoint("TOP", w, "TOP", 0, 0)
  assert(rawget(old, "allPoints") == w, "old pattern stays stretched over the widget")
  local bw, bh = bounds(cd)
  assert(bw == 64 and bh == 64 and cd.allPoints == w.ring, "cooldown bounds equal the ring frame")
end
assert(cd.swipeTexture == RING .. "RingMedium" and cd.reversed == false, "ring swipe, not reversed (it empties): " .. tostring(cd.swipeTexture))
assert(cd.hideNumbers == true and cd.drawEdge == false and cd.bling == false and cd.noCooldownCount == true, "own numbers, no edge, no bling")
assert(cd.swipeColor[1] == 1 and cd.swipeColor[2] == 1 and cd.swipeColor[3] == 1 and cd.swipeColor[4] == 0.9, "swipe in the ring colour")
assert(w.track.texture == RING .. "RingMedium" and w.track.color[4] > 0.17 and w.track.color[4] < 0.19, "faint ring in the ring texture")
assert(w.seconds.text == "5", "seconds: " .. tostring(w.seconds.text))
clock = 102.2 I:Refresh()
assert(w.seconds.text == "3", "rounded up: " .. w.seconds.text)
clock = 104.95 I:Refresh()
assert(w.seconds.text == "NOW", "NOW under 0.1")
assert(#cd.cooldownCalls == 1, "set once")
assert(#errors == 0, tostring(errors[1]))
print("ok circles: cooldown and seconds")

-- an alert's own colour wins on the ring and the track; the ring colour is for the rest
pull({ item{ id = "c", time = 5, text = "Soak", color = { 1, 0, 0 } } })
start()
I:Refresh()
do
  local cw = I:Visible()[1]
  local sc = cw.cooldown.swipeColor
  assert(sc[1] == 1 and sc[2] == 0 and sc[3] == 0 and sc[4] == 0.9, "swipe in the alert colour, ring alpha: " .. table.concat(sc, ","))
  local tc = cw.track.color
  assert(tc[1] == 1 and tc[2] == 0 and tc[3] == 0 and tc[4] > 0.17 and tc[4] < 0.19, "faint track in the alert colour: " .. table.concat(tc, ","))
  CRT.db.alerts.areas.circles.ringColor = { 0, 0, 1, 0.5 }
  I:Refresh()
  sc, tc = cw.cooldown.swipeColor, cw.track.color
  assert(sc[3] == 0 and sc[1] == 1 and sc[4] == 0.5, "alert colour still wins, alpha follows the setting")
  assert(math.abs(tc[4] - 0.1) < 0.001, "track alpha 0.2 of the setting")
  pull({ item{ id = "c2", time = 5, text = "Soak" } })
  CRT.db.alerts.areas.circles.ringColor = { 0, 0, 1, 0.5 }
  start() I:Refresh()
  sc = I:Visible()[1].cooldown.swipeColor
  assert(sc[1] == 0 and sc[3] == 1 and sc[4] == 0.5, "no alert colour: the ring colour")
end
print("ok circles: alert colour wins on the ring")

-- text under the ring
pull({ item{ id = "t", time = 5, text = "A fairly long alert text", color = { 0, 1, 0 } } })
start()
I:Refresh()
w = I:Visible()[1]
local tp = w.text.pts[1]
assert(w.text.text == "A fairly long alert text" and w.text.shown, "text")
assert(tp[1] == "TOP" and tp[2] == w.ring and tp[3] == "BOTTOM", "under the ring, centred")
assert(w.text.textColor[2] == 1, "text colour")
assert(w.text.fontSize == 16 and w.text.fontPath == "Fonts\\\\FRIZQT__.TTF", "area font size")
local words = #"A fairly long alert text" * 6
assert(words > 64 and w.w == words, "widget as wide as the words: " .. w.w)
assert(w.h > 64, "taller than the ring")
pull({ item{ id = "t2", time = 5, text = "Hi" } })
start() I:Refresh()
assert(I:Visible()[1].w == 64, "as wide as the ring when the words are narrower")
print("ok circles: text under the ring")

-- size setting
pull({ item{ id = "z", time = 5, text = "Size" } })
start() I:Refresh()
panel:Select(I)
local dialog = panel.frame
assert(panel.area == I, "shows this area")
assert(sliders["Size"].opts.min == 32 and sliders["Size"].opts.max == 160 and sliders["Size"].value == 64, "size 32-160")
assert(sliders["Text size"].opts.min == 10 and sliders["Text size"].opts.max == 32 and sliders["Text size"].value == 16, "text size 10-32")
assert(dropdowns["Font"] and dropdowns["Outline"], "font and outline")
sliders["Size"].opts.set(100)
w = I:Visible()[1]
assert(w.ring.w == 100 and w.seconds.fontSize == 33, "size applied at once: " .. tostring(w.ring.w))
sliders["Text size"].opts.set(24)
assert(I:Visible()[1].text.fontSize == 24, "text size applied")
dropdowns["Font"].opts.set("Arial Narrow")
assert(I:Visible()[1].text.fontPath == "Fonts\\\\ARIALN.TTF", "font applied")
assert(#errors == 0, tostring(errors[1]))
print("ok circles: size setting")

-- glow at zero
pull({ item{ id = "g", time = 5, text = "Glow", glow = true } })
start() I:Refresh()
local g1 = I:Visible()[1]
assert(g1.glowBorder == nil or not g1.glowBorder.shown, "no glow before zero")
clock = 105.2 I:Refresh()
g1 = I:Visible()[1]
assert(g1.seconds.text == "NOW" and g1.glowBorder and g1.glowBorder.shown, "glows at zero")
clock = 106 I:Refresh()
assert(#I:Visible() == 0 and not g1.glowBorder.shown, "glow off when hidden")
print("ok circles: glow at zero")

-- the ring starts full for a late line
pull({ item{ id = "late", time = 10, text = "Late", warn = 8 } })
start()
clock = 108
I:Refresh()
w = I:Visible()[1]
assert(#w.cooldown.cooldownCalls == 1, "one call")
local c = w.cooldown.cooldownCalls[1]
assert(math.abs(c[1] - 108) < 1e-6 and math.abs(c[2] - 2) < 1e-6, "SetCooldown(at - 2, 2): " .. tostring(c[1]) .. "," .. tostring(c[2]))
clock = 109 I:Refresh()
assert(#w.cooldown.cooldownCalls == 1, "not reset as time runs")
print("ok circles: ring starts full for a late line")

-- made does not grow
pull({ item{ id = "n1", time = 5, text = "N" } })
start() I:Refresh()
local before = made
for i = 1, 30 do clock = 100 + i * 0.1 I:Refresh() end
assert(made == before, "nothing created per refresh")
print("ok circles: made does not grow")

-- the preview animates
pull()
previews.alertcircles(true)
assert(#I:Visible() == 3, "three samples")
local calls = #I:Visible()[2].cooldown.cooldownCalls
for i = 1, 20 do clock = 100 + i * 0.1 I:Refresh() end
assert(#I:Visible()[2].cooldown.cooldownCalls == calls, "swipe set once, not every tick")
assert(I:Visible()[2].seconds.text == "3", "seconds run: " .. I:Visible()[2].seconds.text)
assert(#errors == 0, tostring(errors[1]))
previews.alertcircles(false)
print("ok circles: preview animates")

-- circles grow right by default
pull({ item{ id = "r1", time = 5, text = "Short" }, item{ id = "r2", time = 6, text = "A much longer line of words here" } })
start() I:Refresh()
local v = I:Visible()
assert(#v == 2 and v[2].pts[1][2] == v[1] and v[2].pts[1][1] == "LEFT" and v[2].pts[1][3] == "RIGHT", "second to the right of the first")
print("ok circles: grow right")

-- font row shows a listed font on defaults
pull({ item{ id = "f1", time = 5, text = "Font" } })
start() I:Refresh()
panel:Select(I)
A:Settings().areas.circles.font = nil -- an old save has none; the row still shows a listed font
local fv = dropdowns["Font"].value
local listed = false
for _, f in ipairs(fontList) do if f.name == fv then listed = true end end
assert(listed, "font row shows a listed font: " .. tostring(fv))
assert(I:Visible()[1].text.fontPath == "Fonts\\\\FRIZQT__.TTF" and I:Visible()[1].seconds.fontPath == "Fonts\\\\FRIZQT__.TTF", "drawn in that font")
print("ok circles: font row shows a listed font on defaults")

-- the preview starts full again each cycle
pull()
previews.alertcircles(true)
local restartAt
for i = 0, 40 do
  clock = 100 + i * 0.5
  I:Refresh()
  local calls2 = I:Visible()[2].cooldown.cooldownCalls
  if #calls2 > 1 and not restartAt then restartAt = clock end
end
assert(restartAt, "the preview started over")
local cc = I:Visible()[2].cooldown.cooldownCalls
local last = cc[#cc]
assert(math.abs(last[2] - 5) < 1e-6, "ring runs its full 5 s after the restart: " .. tostring(last[2]))
assert(math.abs(last[1] - (restartAt)) < 1e-6, "from the restart: " .. tostring(last[1]) .. " vs " .. restartAt)
previews.alertcircles(false)
print("ok circles: preview restarts full")

-- Stage 2b: the see-through ring
pull({ item{ id = "nd", time = 5, text = "Ring" } })
start() I:Refresh()
w = I:Visible()[1]
local function noDisc(frame)
  assert(frame.disc == nil, "no disc field")
  for _, f in ipairs(frames) do
    if f.kind == "Texture" and f.parent == w.over then error("a texture on the over frame") end
  end
end
noDisc(w)
print("ok circles: no centre disc")

local function swipeOf(thickness)
  pull({ item{ id = "th" .. thickness, time = 5, text = "T" } })
  CRT.db.alerts.areas.circles.thickness = thickness
  start() I:Refresh()
  local ww = I:Visible()[1]
  return ww.cooldown.swipeTexture, ww.track.texture
end
for _, name in ipairs({ "Thin", "Medium", "Thick" }) do
  local sw, tr = swipeOf(name:lower())
  assert(sw == RING .. "Ring" .. name and tr == sw, name .. ": " .. tostring(sw) .. " / " .. tostring(tr))
end
local sw0 = swipeOf("bogus")
assert(sw0 == RING .. "RingMedium", "unknown thickness falls back to medium")
print("ok circles: swipe uses the ring texture of the chosen thickness")

pull({ item{ id = "col", time = 5, text = "C", color = { 1, 0, 0 } } })
CRT.db.alerts.areas.circles.ringColor = { 0.2, 0.4, 0.6, 0.5 }
start() I:Refresh()
w = I:Visible()[1]
local sc = w.cooldown.swipeColor
assert(sc[1] == 1 and sc[2] == 0 and sc[3] == 0 and sc[4] == 0.5, "swipe in the line colour at the ring alpha (ruling B4)")
local tc = w.track.color
assert(tc[1] == 1 and tc[2] == 0 and tc[3] == 0 and math.abs(tc[4] - 0.1) < 1e-6, "track = line colour at 0.2 of the ring alpha: " .. tostring(tc[4]))
assert(w.text.textColor[1] == 1 and w.text.textColor[2] == 0, "text keeps the line colour")
panel:Select(I)
print("ok circles: ring colour applies to ring and swipe")

pull()
local p = I.frame.pts[#I.frame.pts]
assert(p[1] == "CENTER" and p[2] == UIParent and p[3] == "CENTER" and p[4] == 0 and p[5] == -40, "default centred on the character: " .. tostring(p[1]) .. "," .. tostring(p[4]) .. "," .. tostring(p[5]))
print("ok circles: default centred on the character")

-- the Ring colour row opens the game's colour picker
pull({ item{ id = "pk", time = 5, text = "P" } })
start() I:Refresh()
panel:Select(I)
local dlg = panel.frame
local ringRow
for _, f in ipairs(frames) do if rawget(f, "colorLabel") == "Ring colour" then ringRow = f end end
assert(ringRow, "a Ring colour row")
assert(dropdowns["Ring thickness"] and dropdowns["Ring thickness"].value == "medium", "Ring thickness dropdown on medium")
ringRow.swatch.OnClick(ringRow.swatch)
local info = ColorPickerFrame.info
assert(info and info.hasOpacity == true and info.r == 1 and info.opacity == 0.9, "picker opened on the ring colour with opacity")
ColorPickerFrame.rgb = { 0.1, 0.2, 0.3 } ColorPickerFrame.alpha = 0.7
info.swatchFunc()
local rc = CRT.db.alerts.areas.circles.ringColor
assert(rc[1] == 0.1 and rc[2] == 0.2 and rc[3] == 0.3 and rc[4] == 0.7, "swatchFunc writes rgb and alpha")
assert(I:Visible()[1].cooldown.swipeColor[1] == 0.1, "applied at once")
info.opacityFunc()
info.cancelFunc()
rc = CRT.db.alerts.areas.circles.ringColor
assert(rc[1] == 1 and rc[4] == 0.9, "cancel puts the old colour back")
-- a picker left open cannot write somewhere else
ringRow.swatch.OnClick(ringRow.swatch)
local stale = ColorPickerFrame.info
local oldTable = CRT.db.alerts.areas.circles
CRT.db.alerts = defaults()
ColorPickerFrame.rgb = { 0, 0, 0 }
stale.swatchFunc()
assert(CRT.db.alerts.areas.circles.ringColor[1] == 1 and oldTable.ringColor[1] == 0, "stale picker writes to the table it opened on")
assert(#errors == 0, tostring(errors[1]))
print("ok circles: ring colour row and picker")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (let i = 2; i < 7; i++) {
  let src = '';
  try { src = fs.readFileSync(process.argv[i], 'utf8'); } catch (e) { console.error('missing ' + process.argv[i]); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }

// The ring textures: header bytes, a clear centre and an opaque ring
const path = require('path');
const media = path.join(path.dirname(path.dirname(path.resolve(process.argv[5]))), 'Media');
for (const [name, width] of [['RingThin', 12], ['RingMedium', 22], ['RingThick', 36]]) {
  const b = fs.readFileSync(path.join(media, name + '.tga'));
  const ok = b.length === 18 + 256 * 256 * 4 && b[0] === 0 && b[1] === 0 && b[2] === 2 && b.readUInt16LE(12) === 256 && b.readUInt16LE(14) === 256 && b[16] === 32 && b[17] === 0x28;
  const at = (x, y) => b[18 + (y * 256 + x) * 4 + 3];
  if (!ok) { console.error('FAIL tga header ' + name); process.exit(1); }
  if (at(128, 128) !== 0) { console.error('FAIL ' + name + ' centre alpha ' + at(128, 128)); process.exit(1); }
  if (at(128, 128 + 126 - 4) !== 255) { console.error('FAIL ' + name + ' ring alpha ' + at(128, 250)); process.exit(1); }
  if (at(128, 128 + 126 - width - 4) !== 0) { console.error('FAIL ' + name + ' inside the ring is not clear'); process.exit(1); }
}
console.log('ok circles: ring textures (header, clear centre, opaque ring)');
