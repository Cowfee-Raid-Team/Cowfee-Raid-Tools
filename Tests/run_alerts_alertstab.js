// The Alerts tab of Raid Notes (Notes/AlertsTab.lua) with the real Notes/Page.lua, Notes/Settings.lua,
// Alerts/Areas.lua and the four area files, on mock frames.
// Usage: node run_alerts_alertstab.js Alerts/Rules.lua Alerts/Engine.lua Notes/Settings.lua Notes/AlertsTab.lua
//   Notes/Page.lua Alerts/Areas.lua Alerts/Bars.lua Alerts/Texts.lua Alerts/Icons.lua Alerts/Circles.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local frames, fontStrings = {}, {}
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, checked = false, text = "", pts = {}, w = 0, h = 0 }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if type(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" then return function(self, _, _, font)
      local f = mock("FontString", self) rawset(f, "font", font) fontStrings[#fontStrings + 1] = f return f end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "CreateAnimationGroup" then return function(self)
      local g = mock("AnimationGroup", self)
      rawset(g, "CreateAnimation", function() return mock("Animation", g) end)
      return g end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) local was = self.shown self.shown = true if not was and rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "SetFont" then return function(self, path, size, flags) rawset(self, "fontPath", path) rawset(self, "fontSize", size) return true end end
    if k == "GetFont" then return function(self) return rawget(self, "fontPath"), rawget(self, "fontSize") end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "textColor", { r, g, b }) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return self.w end end
    if k == "GetHeight" then return function(self) return self.h end end
    if k == "GetUnboundedStringWidth" or k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "SetAllPoints" then return function(self) rawset(self, "allPoints", true) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetCenter" then return function() return 480, 300 end end
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
  if template == "CooldownFrameTemplate" then rawset(f, "allPoints", parent) end
  if name then created[name] = f end
  return f
end
local clock = 100
format = string.format
function GetTime() return clock end
CANCEL = "Cancel"
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local SECRET = {}
function issecretvalue(v) return v == SECRET end
ColorPickerFrame = { rgb = { 1, 1, 1 }, alpha = 1 }
function ColorPickerFrame:SetupColorPickerAndShow(info) self.info = info end
function ColorPickerFrame:GetColorRGB() return self.rgb[1], self.rgb[2], self.rgb[3] end
function ColorPickerFrame:GetColorAlpha() return self.alpha end

local function defaults() return {
  bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20, font = "Friz Quadrata", fontSize = 13,
    barColor = { 0.44, 0.31, 0.22, 1 }, bgColor = { 0, 0, 0, 0.6 }, textColor = { 0.95, 0.90, 0.84, 1 } },
  areas = {
    icons = { shown = true, cap = 5, size = 44, font = "Friz Quadrata", fontSize = 20, outline = "OUTLINE", grow = "down", showText = true, fade = true },
    texts = { shown = true, cap = 3, font = "Friz Quadrata", fontSize = 36, outline = "THICKOUTLINE", grow = "down", align = "CENTER" },
    circles = { shown = true, cap = 3, size = 64, thickness = "medium", ringColor = { 1, 1, 1, 0.9 }, font = "Friz Quadrata", fontSize = 16, grow = "right" },
  },
  noteLines = { text = false, icon = false, circle = false },
  reminders = {}, phases = {}, overrides = {}, nextId = 1 } end

local CRT = { NoteTargets = { List = function() return {} end, Get = function() return nil end, Share = function() end }, -- Integrations/NoteTargets.lua: no outside note addons here
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end }, db = { alerts = defaults(), notes = {}, window = { point = "CENTER", x = 10, y = 20, scale = 100 } } }
CRT.Timeline = { readable = function(v) local ok, s = pcall(issecretvalue, v); return ok and not s end }
local fontList = { { name = "Friz Quadrata", path = "Fonts\\\\FRIZQT__.TTF" } }
function CRT:FontList() return fontList end
function CRT:FontPath(name) for _, f in ipairs(fontList) do if f.name == name then return f.path end end return nil end
function CRT:Print() end

local pages, tabs, previews, rowsMade = {}, {}, {}, 0
local dropdowns, sliders = {}, {}
local shownPages = {}
local pagePf
local previewsOn = false
CRT.UI = { PAGE_W = 1026, PAGE_H = 560,
  RegisterPage = function(_, key, title, fn) pages[key] = fn end,
  RegisterTab = function(_, b) tabs[#tabs + 1] = b end,
  SetTabSelected = function(_, b, on) rawset(b, "selected", on) end,
  -- As UI/Panel.lua: the page is built the first time it is shown, then shown.
  Show = function(_, key)
    shownPages[#shownPages + 1] = key
    if not pagePf then pagePf = mock("Frame") pagePf.shown = false pages[key](pagePf) end
    pagePf:Show()
  end,
  -- As UI/Panel.lua: the window at its saved place.
  ApplyWindowPosition = function(self)
    local f, w = self.frame, CRT.db.window
    f:ClearAllPoints()
    f:SetPoint(w.point, UIParent, w.point, w.x, w.y)
  end,
  SetPreviews = function(self, on)
    previewsOn = on
    self.previewing = on and true or false
    for _, fn in pairs(previews) do fn(on) end
  end,
  RegisterPreview = function(_, key, fn) previews[key] = fn end,
  RegisterLayer = function() end,
  SetFrameTitle = function(f, t) rawset(f, "title", t) end,
  StyleWindow = function(_, f) rawset(f, "styled", true) end,
  ResetButtonWidth = function() return 44 end, ResetButton = function(parent) return mock("Button", parent) end,
  Help = function(parent, title, text) local b = mock("Button", parent) rawset(b, "helpTitle", title) rawset(b, "helpText", text) return b end,
  Dropdown = function(parent, label, opts) rowsMade = rowsMade + 1 local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    local function menu() local o = opts.options local list = type(o) == "function" and o() or o assert(type(list) == "table", label .. ": options") rawset(r, "value", opts.get()) end
    menu()
    rawset(r, "refresh", function() menu() if opts.enabledIf then rawset(r, "enabled", opts.enabledIf() and true or false) end end)
    dropdowns[#dropdowns + 1] = r return r end,
  Slider = function(parent, label, opts) rowsMade = rowsMade + 1 local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    rawset(r, "value", opts.get() or opts.min)
    rawset(r, "refresh", function() rawset(r, "value", opts.get() or opts.min) if opts.enabledIf then rawset(r, "enabled", opts.enabledIf() and true or false) end end)
    sliders[#sliders + 1] = r return r end,
}

-- the main window, centred a little above the screen's centre; the screen's centre is (480, 300)
rawset(UIParent, "GetCenter", function() return 480, 300 end)
CRT.UI.frame = mock("Frame")
rawset(CRT.UI.frame, "GetCenter", function() return 480, 350 end)
CRT.UI.frame:SetPoint("CENTER", UIParent, "CENTER", 10, 20)
local alertSettings = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100, iconPosition = "left" }
local win = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata", hidePassed = true, onlyMe = false }
local listeners = {}
CRT.Notes = {
  CanEditRaid = function() return true end, -- Notes/Data.lua: solo, you may change the raid note
  WindowSettings = function() return win end, Alert = function() return alertSettings end,
  Set = function(_, k, f, v) local t = k == "alert" and alertSettings or win t[f] = v for _, fn in ipairs(listeners) do fn() end end,
  TrustedOnly = function() return true end, OnChange = function(_, fn) listeners[#listeners + 1] = fn end,
  List = function() return {} end, ListStyle = function() return "grouped" end, ListDifficulty = function() return "All" end, ListFolded = function() return false end, SetListFolded = function() end, SetListDifficulty = function() end, SetListStyle = function() end, DifficultyGroup = function() return "Other" end, DIFFICULTIES = { "Mythic", "Heroic", "Normal" }, ShortName = function(n) return n end, ViaLabel = function(v) return v end, SourceLabel = function() return nil end, Active = function() return nil end, Get = function() return nil end, Personal = function() return "" end,
  SpellInfo = function() return nil end,
}
CRT.NoteEngine = { running = false, PeekNextPhase = function() return nil end }
CRT.NoteComm = { Sharing = function() return nil end }
CRT.NoteReminders = { Build = function() end }
CRT.NotePhases = { Build = function() end }
CRT.NoteAlert = { Speak = function() end }

local function loadSource(i, src)
  if src:find("function UI.PickColor", 1, true) then -- the real UI/Controls.lua: only PickColor is taken, the harness keeps its own Dropdown and Slider
    local tmp = { UI = {} }
    assert(load(src, "UI/Controls.lua"))("CowfeeRaidTools", tmp)
    CRT.UI.PickColor = tmp.UI.PickColor
  else
    assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
  end
end
for i, src in ipairs(sources) do
  loadSource(i, src)
end
local A, Areas = CRT.Alerts, CRT.AlertAreas
for _, area in ipairs(Areas.list) do area:Build() end

local fail = 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)) fail = fail + 1 end
end
local function under(f, root)
  while f do if f == root then return true end f = f.parent end
  return false
end
local function checks(label, root)
  local out
  for _, f in ipairs(frames) do if f.kind == "CheckButton" and rawget(f, "labelText") == label and (not root or under(f, root)) then out = f end end
  return out
end
local function row(list, label, root)
  local out
  for _, r in ipairs(list) do if r.label == label and (not root or under(r, root)) then out = r end end
  return out
end
local function click(b) b.OnClick(b) end
local function keys(r) local o = r.opts.options local list = type(o) == "function" and o() or o local k, l = {}, {} for i, x in ipairs(list) do k[i] = x.key l[i] = x.label end return table.concat(k, ","), table.concat(l, ",") end
local function configDropdown()
  for _, r in ipairs(dropdowns) do if keys(r) == "icons,texts,bars,circles" then return r end end
end
local function tabFrame(name)
  for _, b in ipairs(tabs) do if b.text.text == name then return b end end
end

check("tab: gear opens the tab on its area", function()
  -- The panel is closed and the page never built; Previews is on.
  assert(pagePf == nil, "page not built yet")
  CRT.UI:SetPreviews(true)
  local C = CRT.AlertCircles
  assert(C.handle.shown, "drag box with previews")
  -- the icons' gear first, so its rows exist before they must hide
  click(CRT.AlertIcons.handle.gear)
  assert(configDropdown().value == "icons", "icons selected")
  local fadeRow = checks("Fade to grey as time runs out")
  assert(fadeRow and fadeRow.shown, "icons rows shown")
  local gear = C.handle.gear
  click(gear)
  assert(shownPages[#shownPages] == "notes", "opens Raid Notes")
  local alertsTab = tabFrame("Alert Settings")
  assert(alertsTab and alertsTab.selected == true, "on the Alerts tab")
  local d = configDropdown()
  assert(d and d.value == "circles", "circles selected: " .. tostring(d and d.value))
  local thick = row(dropdowns, "Ring thickness")
  assert(thick and thick.shown, "circles rows shown")
  assert(not fadeRow.shown, "icons rows hidden")
  -- another area's gear swaps the tab to it
  click(CRT.AlertBars.handle.gear)
  assert(configDropdown().value == "bars", "bars")
  assert(row(sliders, "Show bars from").shown and not thick.shown, "bars rows shown, circles hidden")
  CRT.UI:SetPreviews(false)
  assert(#errors == 0, tostring(errors[1]))
end)

check("tab: gear moves the main window aside while Previews are on", function()
  local UI, f = CRT.UI, CRT.UI.frame
  local function at() local p = f.pts[#f.pts] return p[1], p[3], p[4], p[5] end
  local function gearOn(area, x)
    area:Settings().position = { point = "CENTER", relativePoint = "CENTER", x = x, y = 0 }
    area.handle.gear.OnClick(area.handle.gear)
  end
  local saved = CRT.db.window
  -- previews off: the window is left where it is
  gearOn(CRT.AlertCircles, 300)
  local p0, _, x0 = at()
  assert(p0 == "CENTER" and x0 == 10, "not moved without Previews")
  UI:SetPreviews(true)
  gearOn(CRT.AlertCircles, 300)
  local p, rel, x, y = at()
  assert(p == "LEFT" and rel == "LEFT" and x == 20 and y == 50, "area at x 300: window on the left, same height: " .. p .. " " .. x .. " " .. y)
  assert(saved.point == "CENTER" and saved.x == 10 and saved.y == 20, "saved position unchanged")
  gearOn(CRT.AlertCircles, -300)
  p, rel, x, y = at()
  assert(p == "RIGHT" and rel == "RIGHT" and x == -20 and y == 50, "area at x -300: window on the right: " .. p .. " " .. x)
  gearOn(CRT.AlertCircles, 0)
  assert(at() == "LEFT", "x 0 counts as the right side of the screen, so the window goes left")
  assert(saved.point == "CENTER" and saved.x == 10 and saved.y == 20, "still unchanged")
  UI:SetPreviews(false)
  p, rel, x, y = at()
  assert(p == "CENTER" and x == 10 and y == 20 and UI.windowParked == nil, "back at its saved place: " .. p .. " " .. x)
  -- dragged meanwhile: the drag stands, and a later gear does not undo it
  UI:SetPreviews(true)
  gearOn(CRT.AlertBars, 300)
  assert(at() == "LEFT" and UI.windowParked == true, "parked")
  f:ClearAllPoints() f:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 111, -222)
  CRT.db.window = { point = "TOPLEFT", x = 111, y = -222 } -- what the panel's drag handler saves
  UI.windowParked = "dragged" -- and marks
  gearOn(CRT.AlertBars, -300)
  p, _, x, y = at()
  assert(p == "TOPLEFT" and x == 111 and y == -222, "a dragged window stays")
  UI:SetPreviews(false)
  p, _, x, y = at()
  assert(p == "TOPLEFT" and x == 111 and y == -222 and UI.windowParked == nil, "drag stands after Previews off: " .. p)
  CRT.db.window = saved
  CRT.UI.frame:ClearAllPoints() CRT.UI.frame:SetPoint("CENTER", UIParent, "CENTER", 10, 20)
  assert(#errors == 0, tostring(errors[1]))
end)

check("tab: drag box titles are measured again when Previews turn on", function()
  local UI = CRT.UI
  local area = CRT.AlertCircles
  local before = area.handle.w
  area.handleTitle:SetText(string.rep("w", 80))
  UI:SetPreviews(true)
  assert(area.handle.w > before and area.handle.w == area.handleMin, "wider for the longer title: " .. before .. " -> " .. area.handle.w)
  UI:SetPreviews(false)
  assert(#errors == 0, tostring(errors[1]))
end)

check("tab: four tabs fit", function()
  local names = {}
  for i, b in ipairs(tabs) do
    names[i] = b.text.text
    assert(b.w == 164 and b.h == 26, "tab size " .. b.w)
    assert(b.pts[1][2] == 8 + (i - 1) * 168, "tab x " .. tostring(b.pts[1][2]))
  end
  assert(table.concat(names, ",") == "Notes,Mech Alerts,Alert Settings,Notes Settings", table.concat(names, ","))
  local last = tabs[#tabs]
  assert(last.pts[1][2] + last.w <= 686, "right edge " .. (last.pts[1][2] + last.w))
  CRT.NotesPage.Open("settings")
  assert(tabs[4].selected and not tabs[3].selected)
  CRT.NotesPage.Open("alerts")
  assert(tabs[3].selected and not tabs[4].selected, "Open(alerts)")
end)

check("tab: routing checkboxes bind the saved fields", function()
  CRT.NotesPage.Open("alerts")
  local db = CRT.db.alerts
  local heading
  for _, f in ipairs(fontStrings) do if f.text == "Your note lines go to" then heading = f end end
  assert(heading and heading.font:find("^CRTFont"), "heading in a CRTFont")
  local cases = {
    { "Next spell alert", function() return alertSettings.enabled end },
    { "Text", function() return db.noteLines.text end },
    { "Icon", function() return db.noteLines.icon end },
    { "Bar", function() return db.bars.noteLines end },
    { "Circle", function() return db.noteLines.circle end },
    { "Read them out (text to speech)", function() return alertSettings.tts end },
  }
  for _, c in ipairs(cases) do
    local b = checks(c[1])
    assert(b, "check " .. c[1])
    assert(b.checked == (c[2]() and true or false), c[1] .. " shows the saved value")
    b:SetChecked(not b.checked) click(b)
    assert((c[2]() and true or false) == b.checked, c[1] .. " saves")
    b:SetChecked(not b.checked) click(b)
    assert((c[2]() and true or false) == b.checked, c[1] .. " saves back")
  end
  -- an old save without the routing table
  db.noteLines = nil
  local t = checks("Text")
  t:SetChecked(true) click(t)
  assert(db.noteLines and db.noteLines.text == true, "noteLines made when missing")
  db.noteLines.text = false
  -- reads the saved value when the tab shows
  alertSettings.tts = false
  CRT.NotesPage.Open("notes") CRT.NotesPage.Open("alerts")
  assert(checks("Read them out (text to speech)").checked == false, "refreshed on show")
  alertSettings.tts = true
  for _, fn in ipairs(listeners) do fn() end
  assert(checks("Read them out (text to speech)").checked == true, "refreshed on a notes change")
  -- the heading has a (?) that says lines with their own displays keep them
  local help
  for _, f in ipairs(frames) do if rawget(f, "helpText") and tostring(f.helpText):find("own") and tostring(f.helpTitle) == "Your note lines go to" then help = f end end
  assert(help, "routing (?)")
  assert(help.helpText:find("next pull"), "routing (?) says a change takes effect on the next pull")
  -- speech works wherever the lines go: its box never greys with the alert off, and its (?) says so
  alertSettings.enabled = false
  for _, fn in ipairs(listeners) do fn() end
  local sp = checks("Read them out (text to speech)")
  assert(sp.enabled ~= false, "speech box usable with the alert off")
  alertSettings.enabled = true
  for _, fn in ipairs(listeners) do fn() end
  local speechHelp
  for _, f in ipairs(frames) do if rawget(f, "helpTitle") == "Read them out (text to speech)" then speechHelp = f end end
  assert(speechHelp and speechHelp.helpText:find("wherever") and speechHelp.helpText:find("reminders"), "speech (?)")
  -- Try it: Previews and Test all areas
  local previewsBtn, testBtn, tryIt
  for _, f in ipairs(frames) do
    if f.kind == "Button" and f.text == "Previews" then previewsBtn = f end
    if f.kind == "Button" and f.text == "Test all areas" then testBtn = f end
  end
  for _, f in ipairs(fontStrings) do if f.text == "Try it" then tryIt = f end end
  assert(tryIt and previewsBtn and testBtn, "Try it, Previews and Test all areas")
  click(previewsBtn)
  assert(previewsOn == true, "Previews on")
  CRT.UI:SetPreviews(false)
  click(testBtn)
  for _, key in ipairs({ "AlertIcons", "AlertTexts", "AlertBars", "AlertCircles" }) do
    assert(#CRT[key]:Visible() == 3, key .. " tests three lines: " .. #CRT[key]:Visible())
  end
  assert(#errors == 0, tostring(errors[1]))
end)

check("tab: configuration dropdown swaps rows", function()
  CRT.NotesPage.Open("alerts")
  local heading
  for _, f in ipairs(fontStrings) do if f.text == "Configuration" then heading = f end end
  assert(heading and heading.font:find("^CRTFont"), "Configuration heading")
  local help
  for _, f in ipairs(frames) do if rawget(f, "helpTitle") == "Configuration" then help = f end end
  assert(help, "Configuration (?)")
  local d = configDropdown()
  local k, l = keys(d)
  assert(l == "Icons,Texts,Bars,Circles", l)
  d.opts.set("icons")
  local show = checks("Show these alerts")
  assert(show and show.shown and show.checked, "Show these alerts")
  assert(row(sliders, "At once").shown and row(dropdowns, "Grow").shown, "common rows")
  local fade = checks("Fade to grey as time runs out")
  assert(fade and fade.shown, "icons rows")
  show:SetChecked(false) click(show)
  assert(CRT.db.alerts.areas.icons.shown == false, "Show these alerts saves the icons' shown")
  show:SetChecked(true) click(show)
  d.opts.set("bars")
  assert(d.value == "bars", "dropdown shows bars")
  assert(not fade.shown and row(sliders, "Show bars from").shown, "bars rows in, icons rows out")
  assert(checks("Show these alerts") == show and show.shown, "same common rows")
  show:SetChecked(false) click(show)
  assert(CRT.db.alerts.bars.shown == false, "now the bars' shown")
  assert(checks("Bar").enabled == false, "the Bar route greys with bars off")
  show:SetChecked(true) click(show)
  assert(checks("Bar").enabled == true)
  row(sliders, "At once").opts.set(4)
  assert(CRT.db.alerts.bars.cap == 4, "At once on bars")
  -- rows are made once per area, never on every switch
  for _, key in ipairs({ "texts", "circles", "icons", "bars" }) do d.opts.set(key) end
  local n, frameCount = rowsMade, made
  for i = 1, 3 do for _, key in ipairs({ "texts", "circles", "icons", "bars" }) do d.opts.set(key) end end
  assert(rowsMade == n, "no rows made on a switch")
  assert(made == frameCount, "no frames made on a switch (checks and colour rows too): " .. (made - frameCount))
  -- remembered for the session
  CRT.NotesPage.Open("notes") CRT.NotesPage.Open("alerts")
  assert(configDropdown().value == "bars" and row(sliders, "Show bars from").shown, "selection kept")
  -- words
  for _, f in ipairs(fontStrings) do
    local s = tostring(f.text)
    assert(not s:find("%f[%a]Area%f[%A]") and not s:find("Templates"), "word: " .. s)
  end
  for _, r in ipairs(dropdowns) do assert(not tostring(r.label):find("%f[%a]Area%f[%A]"), "label " .. tostring(r.label)) end
  assert(#errors == 0, tostring(errors[1]))
end)

check("tab: colour swatch opens the picker and saves", function()
  CRT.NotesPage.Open("alerts")
  configDropdown().opts.set("bars")
  local barRow
  for _, f in ipairs(frames) do if rawget(f, "colorLabel") == "Bar colour" and f.shown then barRow = f end end
  assert(barRow, "Bar colour row")
  click(barRow.swatch)
  local info = ColorPickerFrame.info
  assert(info and info.hasOpacity and math.abs(info.r - 0.44) < 1e-6, "picker opened on the bar colour")
  ColorPickerFrame.rgb = { 0.1, 0.2, 0.3 } ColorPickerFrame.alpha = 0.5
  info.swatchFunc()
  local c = CRT.db.alerts.bars.barColor
  assert(c[1] == 0.1 and c[2] == 0.2 and c[3] == 0.3 and c[4] == 0.5, "saved")
  assert(barRow.swatch.tex.color[1] == 0.1, "swatch shows it")
  info.cancelFunc()
  assert(math.abs(CRT.db.alerts.bars.barColor[1] - 0.44) < 1e-6, "cancel puts it back")
  configDropdown().opts.set("circles")
  local ring
  for _, f in ipairs(frames) do if rawget(f, "colorLabel") == "Ring colour" and f.shown then ring = f end end
  assert(ring and not barRow.shown, "circles' ring colour row, bars' hidden")
  assert(#errors == 0, tostring(errors[1]))
end)

check("tab: settings tab keeps timing and voice only", function()
  CRT.NotesPage.Open("settings")
  local speak
  for _, f in ipairs(frames) do if f.kind == "Button" and f.text == "Test speech" then speak = f end end
  assert(speak, "Test speech")
  local root = speak.parent
  local words = {}
  for _, f in ipairs(fontStrings) do if under(f, root) then words[tostring(f.text)] = true end end
  for _, r in ipairs(sliders) do if under(r, root) then words[r.label] = r end end
  for _, r in ipairs(dropdowns) do if under(r, root) then words[r.label] = r end end
  for _, w in ipairs({ "Show it early by", "Count down seconds", "Speech volume", "Spell icon" }) do assert(words[w], "keeps " .. w) end
  for _, w in ipairs({ "Show your next spell or callout", "Text to Speech", "Alert areas", "Show your note lines as bars" }) do assert(not words[w], "moved: " .. w) end
  for _, f in ipairs(frames) do assert(not (f.kind == "Button" and f.text == "Previews" and under(f, root)), "no Previews here") end
  -- greying still follows the switches, now on the Alerts tab
  alertSettings.enabled = false alertSettings.tts = false
  for _, fn in ipairs(listeners) do fn() end
  assert(words["Show it early by"].enabled == false and words["Speech volume"].enabled == false, "greyed while off")
  alertSettings.enabled = true alertSettings.tts = true
  for _, fn in ipairs(listeners) do fn() end
  assert(words["Show it early by"].enabled == true and words["Count down seconds"].enabled == true, "back on")
  local help
  for _, f in ipairs(frames) do if rawget(f, "helpText") and under(f, root) and tostring(f.helpText):find("Alert Settings tab") then help = f end end
  assert(help, "a (?) pointing to the Alert Settings tab")
end)

check("alertstab: fits PAGE_W and PAGE_H", function()
  CRT.NotesPage.Open("alerts")
  local heading
  for _, f in ipairs(fontStrings) do if f.text == "Configuration" then heading = f end end
  local root = heading.parent
  local W, H = CRT.UI.PAGE_W, CRT.UI.PAGE_H - 66 -- the tab sits under the tabs (Notes/Page.lua)
  local function fx(p) if p:find("LEFT") then return 0 elseif p:find("RIGHT") then return 1 end return 0.5 end
  local function fy(p) if p:find("TOP") then return 0 elseif p:find("BOTTOM") then return 1 end return 0.5 end
  local function width(m)
    local o = rawget(m, "opts")
    if o then return (o.labelWidth or 140) + 5 + (o.width or 200) + ((rawget(m, "value") ~= nil and o.min) and 44 or 0) end
    return m.w or 0
  end
  local function height(m) if rawget(m, "opts") then return 32 end if m.kind == "FontString" and (m.h or 0) == 0 then return 14 end return m.h or 0 end
  local rects
  local function rect(m)
    if m == root then return { 0, 0, W, H } end
    if rects[m] then return rects[m] end
    local w, h = width(m), height(m)
    local xs, ys = {}, {}
    for _, p in ipairs(m.pts) do
      local point, rel, relPoint, x, y = p[1], p[2], p[3], p[4], p[5]
      if type(rel) ~= "table" then rel, relPoint, x, y = m.parent, point, p[2], p[3] end
      local rr = rect(rel)
      xs[#xs + 1] = { fx(point), rr[1] + fx(relPoint) * (rr[3] - rr[1]) + (x or 0) }
      ys[#ys + 1] = { fy(point), rr[2] + fy(relPoint) * (rr[4] - rr[2]) - (y or 0) }
    end
    local function span(list, size)
      local lo, hi
      for _, e in ipairs(list) do if e[1] == 0 then lo = e[2] elseif e[1] == 1 then hi = e[2] end end
      if lo and hi then return lo, hi end
      local e = list[1]
      if not e then return 0, size end
      local a = e[2] - e[1] * size
      return a, a + size
    end
    local l, r = span(xs, w)
    local t, b = span(ys, h)
    rects[m] = { l, t, r, b }
    return rects[m]
  end
  local function inside(m)
    local f = m.parent
    while f do if f == root then return true end f = f.parent end
    return false
  end
  local function visible(m)
    local f = m
    while f and f ~= root do if not f.shown then return false end f = f.parent end
    return true
  end
  for _, key in ipairs({ "icons", "texts", "bars", "circles" }) do
    configDropdown().opts.set(key)
    rects = {}
    local n = 0
    for _, m in ipairs(frames) do
      if inside(m) and visible(m) and #m.pts > 0 then
        local r = rect(m)
        n = n + 1
        local name = tostring(rawget(m, "label") or rawget(m, "text") or m.kind)
        assert(r[1] >= -0.5 and r[2] >= -0.5, key .. ": " .. name .. " passes the top or left edge")
        assert(r[3] <= W + 0.5, key .. ": " .. name .. " passes the right edge: " .. r[3])
        assert(r[4] <= H + 0.5, key .. ": " .. name .. " passes the bottom edge: " .. r[4])
      end
    end
    assert(n > 10, key .. ": checked " .. n)
  end
  -- the two columns spread over the page: Configuration starts in its right half
  rects = {}
  assert(rect(heading)[1] >= W / 2, "the right column starts at half the page: " .. rect(heading)[1])
end)

if fail > 0 then error(fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const n = process.argv.length - 2;
for (let i = 2; i < process.argv.length; i++) {
  let src = '';
  try { src = fs.readFileSync(process.argv[i], 'utf8'); } catch (e) { console.error('missing ' + process.argv[i]); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, n, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
