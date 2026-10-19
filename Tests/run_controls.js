// Loads UI/Controls.lua with stand-ins for WowStyle1DropdownTemplate and
// MinimalSliderWithSteppersTemplate that behave like the game's (a radio menu built by SetupMenu's
// generator; a slider whose SetValue fires OnValueChanged), then picks choices and drags values.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local src = ...
local function region()
  local r = { color = { 1, 0.82, 0 } }
  function r:SetPoint() end function r:SetWidth() end function r:SetJustifyH() end function r:SetWordWrap() end
  function r:SetText(t) self.text = t end
  function r:GetTextColor() return self.color[1], self.color[2], self.color[3] end
  function r:SetTextColor(a, b, c) self.color = { a, b, c } end
  return r
end
local function frame(kind, template)
  local f = { kind = kind, template = template, callbacks = {} }
  function f:SetHeight() end function f:GetWidth() return self.width end function f:SetWidth(w) self.width = w end function f:SetSize(w) self.width = w end function f:SetPoint() end
  function f:CreateFontString() return region() end
  function f:SetEnabled(on) self.enabled = on end
  function f:SetText(t) self.text = t end function f:GetFontString() return nil end
  function f:SetScript(name, fn) self[name] = fn end
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
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/UI/Controls.lua', 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
