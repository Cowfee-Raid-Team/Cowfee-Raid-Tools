// Loads CRT_Core/UI/Controls.lua with stand-ins for WowStyle1DropdownTemplate and
// MinimalSliderWithSteppersTemplate that behave like the game's (a radio menu built by SetupMenu's
// generator; a slider whose SetValue fires OnValueChanged), then picks choices and drags values.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local src = ...
fontHeight = 14 -- what a font string's GetFont reports
local timers = {} -- C_Timer.After callbacks, run by runTimers()
C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
local function runTimers() local list = timers timers = {} for _, fn in ipairs(list) do fn() end end
local function region()
  local r = { color = { 1, 0.82, 0 } }
  function r:SetPoint() end function r:SetWidth() end function r:SetJustifyH() end function r:SetWordWrap() end
  function r:SetText(t) self.text = t end function r:SetFontObject() end
  function r:Show() self.shown = true end function r:Hide() self.shown = false end
  function r:GetUnboundedStringWidth() return #(self.text or "") * 7 end
  function r:GetFont() return "f", fontHeight, "" end
  function r:GetTextColor() return self.color[1], self.color[2], self.color[3] end
  function r:SetTextColor(a, b, c) self.color = { a, b, c } end
  return r
end
-- Methods a test doesn't care about do nothing (the Modern slider's textures and scripts).
local quiet = { __index = function(_, k) if type(k) == "string" and k:find("^%u") and not k:find("^On%u") then return function() end end end }
local function frame(kind, template)
  local f = setmetatable({ kind = kind, template = template, callbacks = {}, shown = true, alpha = 1 }, quiet)
  function f:SetHeight() end function f:GetWidth() return self.width end function f:SetWidth(w) self.width = w end function f:SetSize(w) self.width = w end function f:SetPoint() end
  function f:CreateFontString() return region() end
  function f:SetEnabled(on) self.enabled = on end
  function f:SetText(t) self.text = t end function f:GetFontString() return nil end
  function f:SetScript(name, fn) self[name] = fn end
  function f:Show() self.shown = true end function f:Hide() self.shown = false end
  function f:SetShown(on) self.shown = on and true or false end function f:IsShown() return self.shown end
  function f:SetAlpha(a) self.alpha = a end
  function f:SetPoint(point, rel, relPoint, x) self.x = x end
  function f:CreateTexture() return setmetatable({}, quiet) end
  function f:GetLeft() return 100 end function f:GetEffectiveScale() return self.effScale or 1 end
  function f:EnableMouseWheel(on) self.wheelOn = on and true or false end
  function f:SetHeight(h) self.height = h end
  function f:GetScript(name) return rawget(self, name) end
  if kind == "EditBox" then
    function f:SetText(t) self.text = t end function f:GetText() return self.text end
    function f:SetFocus() self.focus = true end
    function f:ClearFocus() if self.focus then self.focus = false if self.OnEditFocusLost then self.OnEditFocusLost(self) end end end
  end
  if template == "WowStyle1DropdownTemplate" then
    function f:SetupMenu(gen) self.gen = gen end
    function f:GenerateMenu()
      local radios = {}
      -- like the game's element description: SetEnabled(false) greys the item and a click on it does nothing
      local root = { CreateRadio = function(_, label, isSel, setSel, data)
        local d = { label = label, isSel = isSel, setSel = setSel, data = data, enabled = true }
        function d:SetEnabled(on) self.enabled = on and true or false end
        function d:AddInitializer() end
        radios[#radios + 1] = d return d end }
      self.gen(self, root)
      self.radios = radios
      self.shown = nil
      for _, r in ipairs(radios) do if r.isSel(r.data) then self.shown = r.label end end
    end
    function f:Pick(label) self:GenerateMenu() for _, r in ipairs(self.radios) do if r.label == label and r.enabled then r.setSel(r.data) end end end
  elseif template == "MinimalSliderWithSteppersTemplate" then
    function f:Init(value, low, high, steps, formatters) self.value, self.low, self.high, self.steps, self.formatters = value, low, high, steps, formatters end
    function f:RegisterCallback(event, fn, owner) self.callbacks[event] = function(...) fn(owner, ...) end end
    function f:Fire(event, ...) if self.callbacks[event] then self.callbacks[event](...) end end
    function f:SetValue(v) self.value = v self:Fire("OnValueChanged", v) end
    function f:Text() return self.formatters[2](self.value) end
  end
  return f
end
function CreateFrame(kind, name, parent, template) return frame(kind, template) end
MinimalSliderWithSteppersMixin = { Label = { Left = 1, Right = 2 }, Event = { OnValueChanged = "OnValueChanged", OnInteractStart = "OnInteractStart", OnInteractEnd = "OnInteractEnd" } }
function CreateMinimalSliderFormatter(label, fn) return fn end
local CRT = { UI = { SkinDropdown = function() end } } -- Panel.lua skins the dropdown; not under test here
assert(load(src, "Controls.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI

-- Dropdown.
local saved = { output = "self" }
local enabled = true
local d = UI.Dropdown({}, "Post to", { options = { { key = "self", label = "Only me" }, { key = "raid", label = "Raid chat" } },
  get = function() return saved.output end, set = function(k) saved.output = k end, enabledIf = function() return enabled end })
d.refresh()
print("dropdown shows: " .. tostring(d.Dropdown.shown) .. ", row width " .. d:GetWidth())
d.Dropdown:Pick("Raid chat") d.refresh()
print("picked Raid chat: saved " .. saved.output .. ", shows " .. d.Dropdown.shown)
enabled = false d.refresh()
print("disabled: dropdown enabled " .. tostring(d.Dropdown.enabled) .. ", label grey " .. tostring(d.Label.color[1] == 0.5))
enabled = true d.refresh()
print("enabled again: label color restored " .. tostring(d.Label.color[2] == 0.82))
-- Options from a function, read each time the menu opens.
local list = { { key = "none", label = "None picked" } }
local d2 = UI.Dropdown({}, "Expected roster", { options = function() return list end, get = function() return "a" end, set = function() end })
list[2] = { key = "a", label = "Main" } d2.refresh()
print("dynamic options: shows " .. tostring(d2.Dropdown.shown))
-- An option with disabled = true is greyed and can't be picked; the others work as before.
local pickedKey = "a"
local d3 = UI.Dropdown({}, "Save as", { options = { { key = "a", label = "A" }, { key = "b", label = "B", disabled = true } },
  get = function() return pickedKey end, set = function(k) pickedKey = k end })
d3.refresh()
assert(d3.Dropdown.radios[1].enabled == true and d3.Dropdown.radios[2].enabled == false, "B greyed, A not")
d3.Dropdown:Pick("B")
assert(pickedKey == "a", "a greyed option can't be picked")
assert(d.Dropdown.radios[1].enabled and d.Dropdown.radios[2].enabled, "options without disabled stay enabled")
print("ok controls: a disabled option is greyed and can't be picked")

-- A sound dropdown with playButton: a Play button after it plays the chosen sound once, and is greyed
-- with no sound chosen or when the row is disabled.
local played = {}
CRT.Sound = { Choices = function() return { { key = "none", label = "None" }, { key = "lsm:Debuff", label = "Debuff (shared)" } } end,
  Play = function(self, key) played[#played + 1] = key return 1 end }
local chosen, editable = "none", true
local s = UI.SoundDropdown({}, "Sound", { none = "None", playButton = true, get = function() return chosen end,
  set = function(k) chosen = k end, enabledIf = function() return editable end })
s.refresh()
assert(s.play and s.play.text == "Play", "a Play button after the dropdown")
assert(s.play.enabled == false, "greyed with no sound chosen")
s.Dropdown:Pick("Debuff (shared)") s.refresh()
assert(s.play.enabled == true, "enabled once a sound is chosen")
s.play.OnClick(s.play)
assert(#played == 1 and played[1] == "lsm:Debuff", "plays the chosen sound once: " .. tostring(played[1]))
editable = false s.refresh()
assert(s.play.enabled == false, "greyed when the row is disabled")
local plain = UI.SoundDropdown({}, "Sound", { none = "None", get = function() return "none" end, set = function() end })
assert(plain.play == nil, "no Play button unless asked")
print("ok controls: a sound dropdown's Play button plays the chosen sound")

-- Slider.
local value, sets = 35, 0
local s = UI.Slider({}, "Health", { min = 5, max = 90, step = 5, format = function(v) return v .. "%" end,
  get = function() return value end, set = function(v) value = v sets = sets + 1 end })
local bar = s.Slider
print("slider init: value " .. bar.value .. ", steps " .. bar.steps .. ", text " .. bar:Text())
s.refresh()
print("refresh saves nothing back: sets " .. sets)
bar:SetValue(47.4)
print("drag to 47.4: saved " .. value .. " (snapped to a step of 5), text " .. bar:Text())
-- onRelease: saved only when the mouse lets go.
local scale, scaleSets = 100, 0
local s2 = UI.Slider({}, "Window Scale", { min = 50, max = 200, step = 5, onRelease = true, get = function() return scale end, set = function(v) scale = v scaleSets = scaleSets + 1 end })
s2.Slider:Fire("OnInteractStart") s2.Slider:SetValue(120) s2.Slider:SetValue(150)
print("dragging: saved " .. scale .. ", sets " .. scaleSets)
s2.refresh()
print("refresh mid-drag leaves the bar alone: bar " .. s2.Slider.value)
s2.Slider:Fire("OnInteractEnd")
print("let go: saved " .. scale .. ", sets " .. scaleSets)
s2.Slider:SetValue(155)
print("stepper click: saved " .. scale)

-- The look switch. A slider made in Classic is the game's slider and nothing else.
local fails = 0
local function check(ok, what) if not ok then fails = fails + 1 print("FAIL " .. what) end end
CRT.PALETTE = { border = { 0.3, 0.2, 0.2 }, accent = { 0.8, 0.6, 0.4 }, knob = { 0.29, 0.2, 0.14 }, knobBorder = { 0.1, 0.07, 0.05 }, knobShine = { 0.48, 0.35, 0.24 }, knobText = { 1, 1, 1 } }
local modern = false
UI.skinned = {}
function UI:IsModern() return modern end
local cursorX, buttonDown = 0, true
function GetCursorPosition() return cursorX, 0 end
function IsMouseButtonDown() return buttonDown end
local hp, hpSets = 35, 0
local h = UI.Slider({}, "Health", { min = 5, max = 90, step = 5, width = 200, format = function(v) return v .. "%" end,
  get = function() return hp end, set = function(v) hp = v hpSets = hpSets + 1 end })
check(h.Slider.shown and h.modern == nil, "Classic builds only the game's slider")
check(UI.skinned[#UI.skinned] == h and h.crtSkin, "the slider follows the look button (UI.skinned)")
check(h:GetWidth() == 140 + 5 + 200 + 44, "the row is as wide as before: " .. tostring(h:GetWidth()))

-- Switch to Modern: the game's slider hides, the track and the knob show the value.
modern = true h.crtSkin(true)
local m = h.modern
check(m ~= nil, "Modern builds the track and the knob")
check(not h.Slider.shown and m.track.shown, "Modern hides the game's slider and shows the track")
check(m.text.text == "35%", "the knob shows the formatted value: " .. tostring(m.text.text))
check(m.trackW == 244, "the track spans the bar and the value's room: " .. tostring(m.trackW))
local kw = m.knob.width
check(kw >= 38, "the knob is at least 38 wide: " .. tostring(kw))
-- the fill reaches the knob's centre: half a knob at min, the middle at mid, the end less half a knob at max
local function fillAt(v) hp = v h.refresh() return m.fillW end
check(fillAt(5) == kw / 2, "fill at min: " .. tostring(m.fillW))
check(math.abs(fillAt(47.5) - 244 / 2) < 0.01, "fill at mid: " .. tostring(m.fillW))
check(fillAt(90) == 244 - m.knob.width / 2, "fill at max: " .. tostring(m.fillW))
check(m.knob.x == 244 - m.knob.width, "the knob stays inside the track's end: " .. tostring(m.knob.x))
hp = 35 h.refresh() hpSets = 0
print("ok controls: Modern shows the track and the knob, filled to the knob's centre")

-- The wheel moves one step, and stops at the ends.
m.track.OnMouseWheel(m.track, 1)
check(hp == 40 and hpSets == 1 and m.text.text == "40%", "wheel up moves one step: " .. hp)
m.knob.OnMouseWheel(m.knob, -1) m.knob.OnMouseWheel(m.knob, -1)
check(hp == 30, "wheel down over the knob moves one step each: " .. hp)
hp = 90 h.refresh() hpSets = 0
m.track.OnMouseWheel(m.track, 1)
check(hp == 90 and hpSets == 0, "the wheel stops at max")
hp = 35 h.refresh() hpSets = 0
print("ok controls: the wheel moves one step")

-- row.SetMax: a value loaded above the usual top shows as it is, and the wheel reaches it
h.SetMax(120)
check(h.Slider.high == 120 and h.Slider.steps == (120 - 5) / 5, "the game's slider takes the new range: " .. tostring(h.Slider.high))
hp = 110 h.refresh()
check(m.text.text == "110%" and hpSets == 0, "110 shows as it is, nothing saved: " .. tostring(m.text.text))
m.track.OnMouseWheel(m.track, 1)
check(hp == 115, "the wheel goes past the old top: " .. hp)
h.SetMax(90)
hp = 35 h.refresh() hpSets = 0
print("ok controls: SetMax")

-- Click the knob without moving: a number box with the plain number.
cursorX = 100 + m.knob.x + kw / 2
m.knob.OnMouseDown(m.knob, "LeftButton") m.track.OnUpdate(m.track, 0.01)
cursorX = cursorX + 2 m.track.OnUpdate(m.track, 0.01) -- under 3 px is still a click
m.knob.OnMouseUp(m.knob, "LeftButton")
check(hp == 35 and hpSets == 0, "a click on the knob changes nothing")
check(m.edit.shown and m.edit.focus and m.edit.text == "35" and not m.text.shown, "a click on the knob opens the number box: " .. tostring(m.edit.text))
-- Enter sets the typed value, snapped to the step and kept in range
m.edit:SetText("47.4") m.edit.OnEnterPressed(m.edit)
check(hp == 45 and not m.edit.shown and m.text.shown and m.text.text == "45%", "typed 47.4 sets 45: " .. hp)
m.knob.OnMouseDown(m.knob, "LeftButton") m.knob.OnMouseUp(m.knob, "LeftButton")
m.edit:SetText("999") m.edit.OnEnterPressed(m.edit)
check(hp == 90, "typed 999 is kept at max: " .. hp)
m.knob.OnMouseDown(m.knob, "LeftButton") m.knob.OnMouseUp(m.knob, "LeftButton")
m.edit:SetText("-20") m.edit.OnEnterPressed(m.edit)
check(hp == 5, "typed -20 is kept at min: " .. hp)
-- Escape keeps the old value, even as the box loses focus
local before = hpSets
m.knob.OnMouseDown(m.knob, "LeftButton") m.knob.OnMouseUp(m.knob, "LeftButton")
m.edit:SetText("60") m.edit.OnEscapePressed(m.edit)
check(hp == 5 and hpSets == before and not m.edit.shown, "Escape keeps the old value: " .. hp)
-- Focus lost (a click elsewhere) sets it; text that isn't a number changes nothing
m.knob.OnMouseDown(m.knob, "LeftButton") m.knob.OnMouseUp(m.knob, "LeftButton")
m.edit:SetText("20%") m.edit.OnEditFocusLost(m.edit)
check(hp == 20 and not m.edit.shown, "focus lost sets the value: " .. hp)
m.knob.OnMouseDown(m.knob, "LeftButton") m.knob.OnMouseUp(m.knob, "LeftButton")
m.edit:SetText("abc") m.edit.OnEnterPressed(m.edit)
check(hp == 20, "text that isn't a number changes nothing: " .. hp)
-- While typing, Up/Down and Right/Left move one step
m.knob.OnMouseDown(m.knob, "LeftButton") m.knob.OnMouseUp(m.knob, "LeftButton")
m.edit.OnArrowPressed(m.edit, "UP")
check(hp == 25 and m.edit.text == "25", "Up while typing moves one step: " .. hp)
m.edit.OnArrowPressed(m.edit, "LEFT") m.edit.OnArrowPressed(m.edit, "LEFT")
check(hp == 15 and m.edit.text == "15", "Left while typing moves one step back: " .. hp)
m.edit.OnEscapePressed(m.edit)
print("ok controls: a click on the knob types a value, clamped and snapped; Escape keeps the old one")

-- Drag the knob: the value follows the mouse past 3 px. Click the track: the knob jumps there.
hp = 35 h.refresh() hpSets = 0
local usable = 244 - m.knob.width
local function xFor(v) return 100 + (v - 5) / 85 * usable + m.knob.width / 2 end
cursorX = xFor(35) m.knob.OnMouseDown(m.knob, "LeftButton")
cursorX = xFor(60) m.track.OnUpdate(m.track, 0.01)
check(hp == 60, "dragging the knob sets the value: " .. hp)
m.knob.OnMouseUp(m.knob, "LeftButton")
check(not m.edit.shown, "a drag doesn't open the number box")
cursorX = xFor(80) m.track.OnMouseDown(m.track, "LeftButton") m.track.OnMouseUp(m.track, "LeftButton")
check(hp == 80, "a click on the track moves the knob there: " .. hp)
-- the mouse let go somewhere else: the drag ends on the next frame
cursorX = xFor(50) m.track.OnMouseDown(m.track, "LeftButton") buttonDown = false m.track.OnUpdate(m.track, 0.01) buttonDown = true
cursorX = xFor(70) if m.track.OnUpdate then m.track.OnUpdate(m.track, 0.01) end
check(hp == 50, "the drag ends when the button is up: " .. hp)
print("ok controls: drag the knob or click the track")

-- onRelease (Window Scale): a drag saves once, on release; the wheel and typing save at once.
local sc, scSets = 100, 0
local w = UI.Slider({}, "Window Scale", { min = 50, max = 200, step = 5, onRelease = true, get = function() return sc end, set = function(v) sc = v scSets = scSets + 1 end })
local wm = w.modern
check(wm and not w.Slider.shown, "a slider made in Modern starts Modern")
local wu = wm.trackW - wm.knob.width
local function wx(v) return 100 + (v - 50) / 150 * wu + wm.knob.width / 2 end
cursorX = wx(100) wm.knob.OnMouseDown(wm.knob, "LeftButton")
cursorX = wx(150) wm.track.OnUpdate(wm.track, 0.01) cursorX = wx(160) wm.track.OnUpdate(wm.track, 0.01)
check(sc == 100 and scSets == 0 and wm.text.text == "160", "while dragging nothing is saved, the knob shows 160: " .. sc .. ", " .. tostring(wm.text.text))
w.refresh()
check(wm.text.text == "160", "refresh mid-drag leaves the knob alone")
wm.knob.OnMouseUp(wm.knob, "LeftButton")
check(sc == 160 and scSets == 1, "let go: saved once: " .. sc .. ", sets " .. scSets)
-- the wheel waits until it stops turning (0.4 s after the last notch), then saves once
wm.track.OnMouseWheel(wm.track, 1) wm.track.OnMouseWheel(wm.track, 1)
check(sc == 160 and scSets == 1 and wm.text.text == "170", "wheel notches wait, the knob shows 170: " .. sc)
w.refresh()
check(wm.text.text == "170", "a refresh keeps the waiting nudge on the knob")
table.remove(timers, 1)() -- the first notch's timer: not the last notch, so nothing
check(sc == 160, "an earlier notch's timer saves nothing")
wm.track.OnMouseWheel(wm.track, 1) runTimers()
check(sc == 175 and scSets == 2, "the wheel saves once it stops: " .. sc .. ", sets " .. scSets)
-- arrow keys wait the same way, and Enter saves them at once
wm.knob.OnMouseDown(wm.knob, "LeftButton") wm.knob.OnMouseUp(wm.knob, "LeftButton")
wm.edit.OnArrowPressed(wm.edit, "UP") wm.edit.OnArrowPressed(wm.edit, "UP")
check(sc == 175 and wm.edit.text == "185", "arrow keys wait: " .. sc)
wm.edit.OnEnterPressed(wm.edit)
check(sc == 185 and scSets == 3, "Enter saves the arrows' value at once: " .. sc)
runTimers()
check(sc == 185 and scSets == 3, "and the waiting timers save nothing more")
-- typing saves at once
wm.knob.OnMouseDown(wm.knob, "LeftButton") wm.knob.OnMouseUp(wm.knob, "LeftButton")
wm.edit:SetText("120") wm.edit.OnEnterPressed(wm.edit)
check(sc == 120 and scSets == 4, "a typed value saves at once: " .. sc)
-- hidden mid-drag: the dragged value is saved
cursorX = wx(120) wm.knob.OnMouseDown(wm.knob, "LeftButton")
cursorX = wx(140) wm.track.OnUpdate(wm.track, 0.01)
check(sc == 120, "mid-drag, nothing saved")
wm.track.OnHide(wm.track)
check(sc == 140 and scSets == 5 and wm.track.OnUpdate == nil, "hidden mid-drag saves the dragged value: " .. sc)
print("ok controls: Window Scale applies on release, on Enter, or when the wheel stops")

-- At an effective scale of 0.8 the knob still follows the mouse.
wm.track.effScale = 0.8
cursorX = wx(140) * 0.8 wm.knob.OnMouseDown(wm.knob, "LeftButton")
cursorX = wx(80) * 0.8 wm.track.OnUpdate(wm.track, 0.01) wm.knob.OnMouseUp(wm.knob, "LeftButton")
check(sc == 80, "a drag at scale 0.8 lands on the value under the mouse: " .. sc)
wm.track.effScale = nil

-- Ctrl + wheel goes to the window's own wheel handler and leaves the slider alone.
local scaled
local window = { OnMouseWheel = function(_, delta) scaled = delta end }
function window:GetScript(name) return self[name] end function window:GetParent() return nil end
local holder = { GetScript = function() return nil end, GetParent = function() return window end }
function wm.track:GetParent() return holder end
IsControlKeyDown = function() return true end
wm.knob.OnMouseWheel(wm.knob, -1)
check(scaled == -1 and sc == 80 and #timers == 0, "Ctrl + wheel reaches the window, not the slider")
IsControlKeyDown = function() return false end

-- A greyed-out slider ignores the mouse.
local on, v3 = false, 2
local g = UI.Slider({}, "Count", { min = 1, max = 8, get = function() return v3 end, set = function(v) v3 = v end, enabledIf = function() return on end })
g.refresh()
g.modern.track.OnMouseWheel(g.modern.track, 1) g.modern.knob.OnMouseDown(g.modern.knob, "LeftButton") g.modern.knob.OnMouseUp(g.modern.knob, "LeftButton")
check(v3 == 2 and not g.modern.edit.shown and g.modern.track.alpha < 1, "a greyed-out slider ignores the wheel and clicks")
check(g.modern.track.wheelOn == false and g.modern.knob.wheelOn == false, "a greyed-out slider lets the wheel through to the page")
on = true g.refresh()
check(g.modern.track.alpha == 1 and g.modern.track.wheelOn and g.modern.knob.wheelOn, "enabled again, wheel and all")
-- The knob is tall enough for its font, and keeps the widest text it has shown.
check(g.modern.knob.height == 22, "a 14 px font: a 22 px knob: " .. tostring(g.modern.knob.height))
fontHeight = 20 g.crtSkin(true)
check(g.modern.knob.height == 28, "a 20 px font: a 28 px knob: " .. tostring(g.modern.knob.height))
fontHeight = 14
local grow = UI.Slider({}, "Grow", { min = 0, max = 10, format = function(v) return v == 5 and "five, wide text" or tostring(v) end, get = function() return 5 end, set = function() end })
local wide = grow.modern.knob.width
grow.modern.track.OnMouseWheel(grow.modern.track, 1)
check(grow.modern.knob.width == wide, "the knob keeps the widest text it has shown: " .. grow.modern.knob.width)
-- UI.RoundRect: a bar no taller than two radii has no side pieces
check(#UI.RoundRect(CreateFrame("Frame"), {}, "ARTWORK", 0, 2, 0, 4).fills == 1 and #UI.RoundRect(CreateFrame("Frame"), {}, "ARTWORK", 0, 5, 0).fills == 3, "a pill-ended bar leaves out the side pieces")
-- The knob text uses the formatter, and grows with it
local any = UI.Slider({}, "First deaths", { min = 0, max = 20, format = function(v) return v == 0 and "Any" or (v .. " deaths at most") end, get = function() return 0 end, set = function() end })
check(any.modern.text.text == "Any", "the knob text uses the formatter: " .. tostring(any.modern.text.text))
check(any.modern.knob.width > 38, "the knob grows to its widest text: " .. tostring(any.modern.knob.width))

-- Back to Classic: the game's slider again, at the current value. And back: the knob shows it too.
modern = false h.crtSkin(false)
check(h.Slider.shown and not m.track.shown, "Classic shows the game's slider again")
check(h.Slider.value == hp, "the game's slider has the current value: " .. tostring(h.Slider.value))
local setsBefore = hpSets
hp = 65 h.refresh()
modern = true h.crtSkin(true)
check(m.text.text == "65%" and hpSets == setsBefore, "back to Modern, the knob shows the current value: " .. tostring(m.text.text))
print("ok controls: the look button switches the slider live")
-- A slider shown in another unit (seconds as minutes) is typed in the unit shown.
local secs = 300
local mins = UI.Slider({}, "Longer than", { min = 0, max = 600, step = 30, format = function(v) return (v / 60) .. " min" end,
  toDisplay = function(v) return v / 60 end, fromDisplay = function(n) return n * 60 end,
  get = function() return secs end, set = function(v) secs = v end })
local mm = mins.modern
local function typeIn(t) mm.knob.OnMouseDown(mm.knob, "LeftButton") mm.knob.OnMouseUp(mm.knob, "LeftButton") local shown = mm.edit.text mm.edit:SetText(t) mm.edit.OnEnterPressed(mm.edit) return shown end
check(typeIn("4.5") == "5" and secs == 270, "the box opens in minutes, and 4.5 is 270 s: " .. secs)
typeIn("2:30") check(secs == 150, "2:30 is 150 s: " .. secs)
typeIn("4:30") check(secs == 270, "4:30 is 270 s: " .. secs)
typeIn("2,5") check(secs == 150, "a comma counts as a point: " .. secs)
typeIn("2.1") check(secs == 120, "2.1 min snaps to a 30 s step: " .. secs)
typeIn("99") check(secs == 600, "99 min is kept at max: " .. secs)
mm.knob.OnMouseDown(mm.knob, "LeftButton") mm.knob.OnMouseUp(mm.knob, "LeftButton")
mm.edit.OnArrowPressed(mm.edit, "DOWN")
check(secs == 570 and mm.edit.text == "9.5", "Down while typing moves one step, shown in minutes: " .. secs .. ", " .. tostring(mm.edit.text))
mm.edit.OnEscapePressed(mm.edit)
check(secs == 570, "Escape keeps it")
print("ok controls: a slider shown in minutes is typed in minutes")
print(fails .. " failed")
if fails > 0 then error(fails .. " slider checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/CRT_Core/UI/Controls.lua', 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
