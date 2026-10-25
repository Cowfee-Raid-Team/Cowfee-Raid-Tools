// CRT_Modules/Alerts/Areas.lua and CRT_Modules/Alerts/Texts.lua: the shared area builder and the big-text area, with mock frames.
// Usage: node run_alerts_areas.js CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Areas.lua CRT_Modules/Alerts/Texts.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const placementLua = require('./placement_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + placementLua(process.argv.slice(2)) + `
local rulesSrc, engineSrc, areasSrc, textsSrc = ...
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
    -- shown, and every parent shown, as in the game (UI/Placement.lua places only an element whose drag box is on screen)
    if k == "IsVisible" then return function(self) local f = self while f do if not f.shown then return false end f = rawget(f, "parent") end return true end end
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
    if k == "SetAllPoints" then return function(self) rawset(self, "allPoints", true) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetCenter" then return function(self) if self == UIParent then return 480, 300 end return 530, 450 end end
    if k == "SetColorTexture" or k == "SetVertexColor" then return function(self, r, g, b) rawset(self, "color", { r, g, b }) end end
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
  bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
  areas = {
    icons = { shown = true, cap = 5, size = 44, font = "Friz Quadrata", fontSize = 20, outline = "OUTLINE", grow = "down" },
    texts = { shown = true, cap = 3, font = "Friz Quadrata", fontSize = 36, outline = "THICKOUTLINE", grow = "down", align = "CENTER" },
    circles = { shown = true, cap = 3, size = 64, fontSize = 16, grow = "right" },
  },
  customColors = true, -- the checks were written for the player's own colours: Use custom colours on
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
local menus = {}
CRT.UI.ContextMenu = function(owner, fill)
  local root = { items = {} }
  function root:CreateButton(label, fn) self.items[#self.items + 1] = { label = label, fn = fn } end
  fill(root)
  menus[#menus + 1] = root
end
CRT_PLACEMENT(CRT)
assert(load(areasSrc, "Areas"))("CowfeeRaidTools", CRT)
assert(load(textsSrc, "Texts"))("CowfeeRaidTools", CRT)
local A, Areas, T = CRT.Alerts, CRT.AlertAreas, CRT.AlertTexts
assert(Areas and type(Areas.New) == "function" and type(Areas.Glow) == "function", "Areas API")
assert(T and type(T.Refresh) == "function" and type(T.ResetPosition) == "function" and type(T.Test) == "function" and type(T.Visible) == "function", "Texts area API")
assert(previews.alerttexts and layers.alerttexts == nil, "preview registered, layer waits for build")

-- One block giving text lines.
local items = {}
A:RegisterBlock("rem", { label = "Reminders", group = false, Entries = function()
  local out = {}
  for _, it in ipairs(items) do local c = {} for k, v in pairs(it) do c[k] = v end out[#out + 1] = c end
  return out
end })
local function item(t)
  local d = { id = "i", ph = 1, time = 0, text = "x", priority = 31, hold = 0.5, warn = 8, outputs = { text = true } }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local function pull(list)
  A:Stop()
  items = list or {}
  clock = 100
  wipe(errors)
  CRT.db.alerts = defaults()
  T:ResetPosition()
end
local function start() A.HandleEvent("ENCOUNTER_START", 3001, "Boss", 16) end
local function shownTexts() local t = {} for i, w in ipairs(T:Visible()) do t[i] = w.text.text end return table.concat(t, ",") end

-- the shared ticker builds every area on login
local ticker
for _, f in ipairs(frames) do if rawget(f, "OnUpdate") and rawget(f, "OnEvent") then ticker = f end end
assert(ticker, "ticker exists")
ticker.OnEvent(ticker, "PLAYER_LOGIN")
local win = created.CowfeeRaidToolsAlertTexts
assert(win and layers.alerttexts == win, "frame built and registered on its layer")
local handle
for _, f in ipairs(frames) do if f.template == "BackdropTemplate" and f.parent == win then handle = f end end
assert(handle, "drag box")
local gear = handle.gear
assert(gear and gear.parent == handle and rawget(gear, "OnClick"), "settings button on the drag box")

-- drag box only with previews
pull({ item{ id = "a", time = 5, text = "Soak" } })
start()
T:Refresh()
assert(win.shown and #T:Visible() == 1 and not handle.shown, "running: shown without the drag box")
previews.alerttexts(true)
assert(handle.shown and #T:Visible() >= 1, "preview: drag box and samples")
local title
for _, f in ipairs(fontStrings) do if f.parent == handle and f.text and f.text == "Critical alerts text: drag to move" then title = f end end
assert(title and title.font and title.font:find("^CRTFont"), "title on the drag box in a CRTFont")
assert(resets >= 1, "reset on the drag box")
-- the whole title sits left of the settings button and Reset (retail widths: the title's unbounded text)
do
  local titleRight = title.pts[1][2] + title:GetUnboundedStringWidth()
  local gearLeft = handle.w - 2 - 44 - 4 - gear.w -- left of Reset (the stand-in is 44 wide), 4 apart
  assert(handle.w >= 220, "never narrower than before: " .. handle.w)
  assert(titleRight < gearLeft, "title (right edge " .. titleRight .. ") ends left of the settings button (" .. gearLeft .. ")")
  assert(gear.pts[1][1] == "RIGHT" and gearLeft - titleRight >= 4, "a gap before the button")
  print("ok areas: the drag box fits its title")
end
A:Settings().areas.texts.shown = false
T:Refresh()
assert(win.shown and handle.shown, "preview shows even with the area off")
A:Settings().areas.texts.shown = true
previews.alerttexts(false)
T:Refresh()
assert(not handle.shown, "preview off hides the drag box")
assert(#errors == 0, tostring(errors[1]))
print("ok areas: drag box only with previews")

-- pooled, capped: 50 due at once, cap 3
local fifty = {}
for i = 1, 50 do fifty[i] = item{ id = "f" .. i, time = 3 + i * 0.01, text = "Due " .. i } end
pull(fifty)
start()
local before = made
for i = 1, 20 do clock = 100 + i * 0.1 T:Refresh() end
assert(#T:Visible() == 3, "three shown")
assert(T.more == 47, "more counts the rest: " .. tostring(T.more))
assert(shownTexts():find("^Due 1 %(") and shownTexts():find("Due 3 %("), shownTexts())
local pooled = 0
for _, f in ipairs(frames) do if f.parent == win and f.kind == "Frame" and f ~= handle and rawget(f, "text") ~= "" and type(rawget(f, "text")) == "table" then pooled = pooled + 1 end end
assert(pooled <= 3, "pool never grows past the cap: " .. pooled)
local after = made
for i = 21, 40 do clock = 100 + i * 0.05 T:Refresh() end
assert(made == after, "nothing created per refresh")
A:Settings().areas.texts.cap = 2
T:Refresh()
assert(#T:Visible() == 2, "cap follows the setting")
A:Settings().areas.texts.cap = 99
T:Refresh()
assert(#T:Visible() == 10, "cap at most 10")
assert(#errors == 0, tostring(errors[1]))
print("ok areas: pooled, capped")

-- grow directions: each widget after the first anchors to the one before, 4 px apart
pull({ item{ id = "a", time = 2, text = "A" }, item{ id = "b", time = 3, text = "B" }, item{ id = "c", time = 4, text = "C" } })
start()
local expect = { down = { "TOP", "BOTTOM", 0, -4 }, up = { "BOTTOM", "TOP", 0, 4 }, left = { "RIGHT", "LEFT", -4, 0 }, right = { "LEFT", "RIGHT", 4, 0 } }
for dir, e in pairs(expect) do
  A:Settings().areas.texts.grow = dir
  T:Refresh()
  local v = T:Visible()
  assert(#v == 3, dir)
  local p1 = v[1].pts[1]
  assert(p1[1] == e[1] and p1[2] == win and p1[3] == e[1], dir .. ": first on the area")
  local p2 = v[2].pts[1]
  assert(p2[1] == e[1] and p2[2] == v[1] and p2[3] == e[2] and p2[4] == e[3] and p2[5] == e[4], dir .. ": second after the first")
  assert(v[3].pts[1][2] == v[2], dir .. ": third after the second")
  local hp = handle.pts[1]
  if dir == "up" then
    assert(hp[1] == "TOP" and hp[2] == win and hp[3] == "BOTTOM", "grow up: drag box below the area")
  else
    assert(hp[1] == "BOTTOM" and hp[2] == win and hp[3] == "TOP", dir .. ": drag box above the area")
  end
end
-- an alignment lines the texts up on that edge
A:Settings().areas.texts.grow = "down"
A:Settings().areas.texts.align = "LEFT"
T:Refresh()
local v = T:Visible()
assert(v[1].pts[1][1] == "TOPLEFT" and v[2].pts[1][1] == "TOPLEFT" and v[2].pts[1][3] == "BOTTOMLEFT", "left aligned")
A:Settings().areas.texts.align = "RIGHT"
A:Settings().areas.texts.grow = "up"
T:Refresh()
v = T:Visible()
assert(v[1].pts[1][1] == "BOTTOMRIGHT" and v[2].pts[1][3] == "TOPRIGHT", "right aligned, up")
print("ok areas: grow directions")

-- position saved by center and reset
pull()
previews.alerttexts(true) -- a drag box takes a drag only while it is on screen, in Previews
handle.OnDragStop(handle)
local pos = A:Settings().areas.texts.position
assert(pos and pos.point == "CENTER" and pos.x == 50 and pos.y == 150, "saved by center")
assert(win.pts[1][1] == "CENTER" and win.pts[1][4] == 50, "placed where saved")
T:ResetPosition()
assert(A:Settings().areas.texts.position == nil, "reset clears the position")
assert(win.pts[1][1] == "CENTER" and win.pts[1][4] == 3 and win.pts[1][5] == 323, "back to the default (under the break timer)")
previews.alerttexts(false)
win.pts = {} T:ResetPosition() -- the preview drew it; placed again for the checks below
handle.OnDragStop(handle)
assert(A:Settings().areas.texts.position == nil, "outside Previews a stray drag stop saves nothing")
print("ok areas: position saved and reset")

-- idle: no run, preview or test: hidden once, then nothing
pull({ item{ id = "a", time = 5, text = "Idle" } })
start()
ticker.OnUpdate(ticker, 0.11)
assert(win.shown and #T:Visible() == 1)
A:Stop()
local lineCalls = 0
local realLines = A.Lines
A.Lines = function(...) lineCalls = lineCalls + 1 return realLines(...) end
ticker.OnUpdate(ticker, 0.11)
assert(not win.shown and #T:Visible() == 0, "hidden when idle")
local hidesAfter = hides
for i = 1, 20 do ticker.OnUpdate(ticker, 0.11) end
assert(hides == hidesAfter, "hidden only once")
assert(lineCalls == 0, "no lines read while idle")
A.Lines = realLines
-- a test runs while idle, and stops when its lines have passed
T:Test({ { text = "Test text", at = clock + 2, hold = 0.5 } })
assert(win.shown and shownTexts() == "Test text (2.0)", shownTexts())
clock = clock + 3
ticker.OnUpdate(ticker, 0.11)
assert(not win.shown, "test over")
print("ok areas: idle does no work")

-- texts: countdown text and NOW
pull({ item{ id = "a", time = 15, text = "Far" }, item{ id = "b", time = 5, text = "Near", color = { 1, 0, 0 } } })
A:Settings().areas.texts.cap = 3
start()
clock = 105.2
T:Refresh()
assert(shownTexts() == "Near (NOW)", shownTexts())
clock = 102.66
T:Refresh()
assert(shownTexts() == "Near (2.3)", "tenths under 10: " .. shownTexts())
local w = T:Visible()[1]
assert(w.text.textColor[1] == 1 and w.text.textColor[2] == 0, "line color")
-- Use custom colours off: your own line colour is ignored (no type here, and no Colors.lua loaded: white)
A:Settings().customColors = false T:Refresh()
assert(T:Visible()[1].text.textColor[2] == 1, "own colour ignored with custom colours off")
A:Settings().customColors = true T:Refresh()
clock = 100
T:Refresh()
assert(shownTexts() == "Near (5.0)", shownTexts())
assert(T:Visible()[1].w == #"Near (5.0)" * 6 + 8, "as wide as its words: " .. T:Visible()[1].w)
clock = 104.96
T:Refresh()
assert(shownTexts() == "Near (NOW)", "never 0.0: " .. shownTexts())
clock = 104.92
T:Refresh()
assert(shownTexts() == "Near (NOW)", "0.08 left reads NOW: " .. shownTexts())
clock = 100
pull({ item{ id = "a", time = 15, text = "Far", warn = 20 } })
start()
clock = 100.2
T:Refresh()
assert(shownTexts() == "Far (14)", "whole seconds from 10: " .. shownTexts())
assert(T:Visible()[1].text.textColor[1] == 1 and T:Visible()[1].text.textColor[3] == 1, "white without a color")
clock = 115
T:Refresh()
assert(shownTexts() == "Far (NOW)", shownTexts())
clock = 115.6
T:Refresh()
assert(#T:Visible() == 0, "gone after hold")
-- font, size, outline, align from the settings; secret text falls back to the spell name
pull({ item{ id = "s", time = 3, text = SECRET, spellID = 100 } })
start()
T:Refresh()
w = T:Visible()[1]
assert(#errors == 0, tostring(errors[1]))
assert(w.text.text == "Spell Name (3.0)", w.text.text)
assert(w.text.fontPath == "Fonts\\\\FRIZQT__.TTF" and w.text.fontSize == 36 and w.text.fontFlags == "THICKOUTLINE", "area font")
assert(w.text.justify == "CENTER", "align")
print("ok texts: countdown text and NOW")

-- texts: a longer line grows its widget (measured unbounded, not by the widget's last size)
pull({ item{ id = "s", time = 3, text = "A" } })
start()
T:Refresh()
local grown = T:Visible()[1]
assert(grown.w == #"A (3.0)" * 6 + 8, "short: " .. grown.w)
pull({ item{ id = "l", time = 3, text = "A much longer line of text" } })
start()
T:Refresh()
assert(T:Visible()[1] == grown, "same pooled widget")
assert(grown.w == #"A much longer line of text (3.0)" * 6 + 8, "grows: " .. grown.w)
assert(grown.text.pts[1] and grown.text.pts[1][1] == "CENTER" and not rawget(grown.text, "allPoints"), "anchored by one point")
print("ok texts: a longer line grows its widget")

-- texts: glow at zero
pull({ item{ id = "g", time = 5, text = "Glow", glow = true }, item{ id = "n", time = 5.5, text = "Plain" } })
start()
T:Refresh()
local g1 = T:Visible()[1]
assert(g1.glowBorder == nil or not g1.glowBorder.shown, "no glow before zero")
clock = 105.2
T:Refresh()
g1 = T:Visible()[1]
assert(g1.text.text == "Glow (NOW)" and g1.glowBorder and g1.glowBorder.shown, "glows at zero")
local edges = 0
for _, f in ipairs(frames) do if f.kind == "Texture" and f.parent == g1.glowBorder then edges = edges + 1 end end
assert(edges == 4, "four edge textures: " .. edges)
local p = T:Visible()[2]
assert(p.text.text == "Plain (0.3)" and (p.glowBorder == nil or not p.glowBorder.shown), "no glow without line.glow")
clock = 106
T:Refresh()
assert(#T:Visible() == 0 and not g1.glowBorder.shown, "glow off when hidden")
-- Areas.Glow alone, made once
local wf = CreateFrame("Frame", nil, UIParent)
Areas.Glow(wf, true)
local border = wf.glowBorder
assert(border and border.shown, "glow on")
Areas.Glow(wf, false)
assert(not border.shown, "glow off")
Areas.Glow(wf, true)
assert(wf.glowBorder == border, "made once")
print("ok texts: glow at zero")

-- the gear's menu: Placement (UI/Placement.lua), and Settings, which opens Raid Notes > Alerts on its area; the old
-- shared window is gone
local opened = {}
CRT.NoteAlertsTab = { Select = function(key) opened[#opened + 1] = "select " .. key end }
CRT.NotesPage = { Open = function(tab) opened[#opened + 1] = "open " .. tab end }
gear.OnClick(gear)
local menu = menus[#menus]
assert(menu and menu.items[1].label == "Placement" and menu.items[2].label == "Settings", "the gear: Placement and Settings")
menu.items[2].fn()
assert(table.concat(opened, ",") == "select texts,open alerts", table.concat(opened, ","))
assert(created.CowfeeRaidToolsAlertArea == nil, "no settings window")
CRT.NoteAlertsTab, CRT.NotesPage = nil, nil
gear.OnClick(gear)
menus[#menus].items[2].fn() -- without the tab loaded, nothing breaks
assert(T.placement == CRT.UI.Placement.Find("alerttexts"), "placed by the shared helper as alerttexts")
print("ok areas: gear opens Placement and the Alerts tab on its area")

-- the settings panel shows controls that read their values as they are made, and again
local panelParent = CreateFrame("Frame", nil, UIParent)
local changes = 0
local panel = Areas.Panel(panelParent, function() changes = changes + 1 end)
assert(panel.frame and panel.frame.parent == panelParent, "panel on its parent")
pull({ item{ id = "a", time = 3, text = "Open" } })
start()
T:Refresh()
panel:Select(T)
assert(panel.area == T, "shows texts")
assert(sliders["At once"].value == 3 and dropdowns["Grow"].value == "down" and sliders["Size"].value == 36 and dropdowns["Font"].value == "Friz Quadrata", "values read as made")
panel:Select(T)
assert(sliders["Size"].shown, "shows again")
assert(Areas.Find("texts") == T and Areas.Find("nope") == nil, "Areas.Find")
assert(#errors == 0, tostring(errors[1]))
print("ok areas: settings panel shows twice with real-like controls")

-- texts: settings panel rows
pull({ item{ id = "a", time = 3, text = "Rows" } })
start()
T:Refresh()
panel:Select(T)
local dialog = panel.frame
assert(layers.panel == nil, "no window of its own")
local show
for _, f in ipairs(frames) do if f.kind == "CheckButton" and f.parent == dialog and rawget(f, "labelText") == "Show these alerts" then show = f end end
assert(show and show.checked, "Show these alerts")
assert(sliders["At once"] and dropdowns["Grow"], "common rows")
assert(dropdowns["Font"] and sliders["Size"] and dropdowns["Outline"] and dropdowns["Align"], "texts rows")
local function keys(row) local o = row.opts.options local list = type(o) == "function" and o() or o local t = {} for i, x in ipairs(list) do t[i] = x.key end return table.concat(t, ",") end
assert(keys(dropdowns["Grow"]) == "down,up,left,right", keys(dropdowns["Grow"]))
assert(keys(dropdowns["Outline"]) == ",OUTLINE,THICKOUTLINE", keys(dropdowns["Outline"]))
assert(keys(dropdowns["Align"]) == "LEFT,CENTER,RIGHT", keys(dropdowns["Align"]))
assert(sliders["Size"].opts.min == 12 and sliders["Size"].opts.max == 72, "size 12-72")
assert(sliders["At once"].opts.min == 1 and sliders["At once"].opts.max == 10, "at once 1-10")
local calls = fontListCalls
assert(keys(dropdowns["Font"]) == "Friz Quadrata,Arial Narrow" and fontListCalls > calls, "font list read when the menu opens")
fontList[3] = { name = "Shared", path = "Interface\\\\Shared.ttf", shared = true }
assert(keys(dropdowns["Font"]):find("Shared"), "shared media fonts appear")
-- changing a setting refreshes the area at once
sliders["Size"].opts.set(48)
assert(A:Settings().areas.texts.fontSize == 48 and T:Visible()[1].text.fontSize == 48, "size applied at once")
dropdowns["Font"].opts.set("Shared")
assert(T:Visible()[1].text.fontPath == "Interface\\\\Shared.ttf", "font applied")
dropdowns["Outline"].opts.set("")
assert(A:Settings().areas.texts.outline == "" and T:Visible()[1].text.fontFlags == "", "no outline")
dropdowns["Align"].opts.set("LEFT")
assert(T:Visible()[1].text.justify == "LEFT", "align applied")
dropdowns["Grow"].opts.set("up")
assert(A:Settings().areas.texts.grow == "up" and T:Visible()[1].pts[1][1] == "BOTTOMLEFT", "grow applied")
-- a font that fails to load falls back to Friz Quadrata
fontList[4] = { name = "Broken", path = "Interface\\\\Broken.ttf" }
dropdowns["Font"].opts.set("Broken")
assert(T:Visible()[1].text.fontPath == "Fonts\\\\FRIZQT__.TTF", "broken font falls back: " .. tostring(T:Visible()[1].text.fontPath))
sliders["At once"].opts.set(1)
assert(A:Settings().areas.texts.cap == 1)
local before = changes
show:SetChecked(false)
show.OnClick(show)
assert(A:Settings().areas.texts.shown == false and #T:Visible() == 0, "area off at once")
assert(changes > before, "the tab hears of a change")
-- showing again makes no new rows
local d, s = dropdownsMade, slidersMade
panel:Select(T)
assert(dropdownsMade == d and slidersMade == s, "rows reused on every showing")
-- a second area shares the panel and adds its own rows the same way
local other = Areas.New({ key = "test", output = "icon", layer = "alerttexts", title = "Other area", settingsKey = "icons",
  defaultPosition = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0 },
  make = function(parent) local f = CreateFrame("Frame", nil, parent) f:SetSize(10, 10) return f end,
  draw = function() end, sample = function(now) return { { at = now + 1 } } end,
  settings = function(dlg, st) dlg:Check("Show the text", function() return st.showText end, function(v) st.showText = v end) end })
panel:Select(other)
assert(panel.area == other and not dropdowns["Font"].shown, "other area, texts rows hidden")
local own
for _, f in ipairs(frames) do if f.kind == "CheckButton" and rawget(f, "labelText") == "Show the text" then own = f end end
assert(own and own.shown, "its own check row")
own:SetChecked(true)
own.OnClick(own)
assert(A:Settings().areas.icons.showText == true, "check sets")
assert(show.shown and sliders["At once"].shown, "common rows stay")
-- the common Show row now reads and writes the other area's settings
A:Settings().areas.texts.shown = true
panel:Refresh()
assert(show.checked == true)
show:SetChecked(false) show.OnClick(show)
assert(A:Settings().areas.icons.shown == false and A:Settings().areas.texts.shown == true, "Show these alerts follows the area shown")
show:SetChecked(true) show.OnClick(show)
panel:Select(T)
assert(panel.area == T and dropdowns["Font"].shown and not own.shown, "back to texts")
assert(#errors == 0, tostring(errors[1]))
print("ok texts: settings panel rows")

-- a lines hook's leftover count reaches area.more and the after hook
local hookLines, afterCalls = {}, {}
local drawnAt = {}
local hooked = Areas.New({ key = "hooked", output = "circle", layer = "alerttexts", title = "Hooked", settingsKey = "circles",
  defaultPosition = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0 },
  make = function(parent) local f = CreateFrame("Frame", nil, parent) f:SetSize(10, 10) return f end,
  draw = function(w, line, now, s, shownAt) drawnAt[line.id] = shownAt end,
  sample = function(now) return {} end,
  lines = function(now, s, cap) return hookLines, 1 end,
  after = function(area, n, more) afterCalls[#afterCalls + 1] = { n = n, more = more } end })
hooked:Build()
pull()
A:Settings().areas.circles.cap = 3
start()
hookLines = { { id = "a", at = 110 }, { id = "b", at = 111 }, { id = "c", at = 112 }, { id = "d", at = 113 } }
hooked:Refresh()
local last = afterCalls[#afterCalls]
assert(#hooked:Visible() == 3 and hooked.more == 2 and last.n == 3 and last.more == 2, "more from the hook plus past the cap")
print("ok areas: more count and after hook")

-- shownAt is kept by line id, so it survives lines moving up to another widget
clock = 100
hookLines = { { id = "a", at = 110 }, { id = "b", at = 111 } }
hooked:Refresh()
assert(drawnAt.a == 100 and drawnAt.b == 100)
clock = 101
hookLines = { { id = "b", at = 111 }, { id = "c", at = 112 } }
hooked:Refresh()
assert(drawnAt.b == 100, "b keeps when it first showed after moving up")
assert(drawnAt.c == 101, "c new")
assert(hooked.shownAt.a == nil, "a forgotten once gone")
clock = 102
hookLines = { { id = "a", at = 110 } }
hooked:Refresh()
assert(drawnAt.a == 102, "a back counts afresh")
print("ok areas: shownAt survives lines moving up")

-- a failing area reports once, not every tick, and the others still refresh
local failing = true
local broken = Areas.New({ key = "broken", output = "circle", layer = "alerttexts", title = "Broken", settingsKey = "circles",
  defaultPosition = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0 },
  make = function(parent) return CreateFrame("Frame", nil, parent) end,
  draw = function() if failing then error("draw failed") end end,
  sample = function() return {} end,
  lines = function() return { { id = "x", at = 110 } }, 0 end })
broken:Build()
wipe(errors)
for i = 1, 10 do ticker.OnUpdate(ticker, 0.11) end
assert(#errors == 1, "reported once: " .. #errors)
failing = false
ticker.OnUpdate(ticker, 0.11)
failing = true
ticker.OnUpdate(ticker, 0.11)
assert(#errors == 2, "reported again after working")
failing = false
print("ok areas: a failing area reports once")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (let i = 2; i < 6; i++) {
  let src = '';
  try { src = fs.readFileSync(process.argv[i], 'utf8'); } catch (e) { console.error('missing ' + process.argv[i]); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
