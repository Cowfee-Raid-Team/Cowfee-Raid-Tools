// CRT_Dev/Dev/WindowLog.lua (/crt dev winlog) on mock frames: it logs the Timeline pop-out as it logs the main window,
// every size, place and scale change and each OnSizeChanged with the line that did it, and once a resize ends, what the
// pop-out's view laid out (its layout, VisibleWidth, track width, scroll range, name column). Off, it prints nothing.
// Usage: node run_winlog.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const W = process.argv[2];
const harness = String.raw`
local src = ...
local printed = {}
print = function(s) printed[#printed + 1] = tostring(s) end
local function frame(name)
  local f = { scripts = {}, w = 100, h = 50, scale = 1, name = name, shown = true }
  for _, m in ipairs({ "SetPoint", "ClearAllPoints", "SetHeight", "SetWidth", "SetSize", "SetScale", "StartMoving", "StartSizing", "StopMovingOrSizing" }) do
    f[m] = function() end
  end
  function f:GetPoint() return "TOPLEFT", nil, "TOPLEFT", 10, -20 end
  function f:GetLeft() return 10 end
  function f:GetTop() return 700 end
  function f:GetScale() return self.scale end
  function f:GetWidth() return self.w end
  function f:GetHeight() return self.h end
  function f:GetEffectiveScale() return 1 end
  function f:IsShown() return self.shown end
  function f:IsMouseOver() return false end
  function f:GetChildren() end
  function f:SetScript(n, fn) self.scripts[n] = fn end
  function f:HookScript(n, fn) local old = self.scripts[n] self.scripts[n] = function(...) if old then old(...) end fn(...) end end
  function f:GetName() return self.name end
  return f
end
local made = {}
function CreateFrame() local f = frame() made[#made + 1] = f return f end
function hooksecurefunc(t, name, fn) local old = t[name] t[name] = function(...) old(...) fn(...) end end
function debugstack() return '[string "@Interface/AddOns/CowfeeRaidTools/CRT_Core/UI/Window.lua"]:447: in function' end
function GetCursorPosition() return 0, 0 end
function IsMouseButtonDown() return false end
local timers = {}
C_Timer = { After = function(d, fn) timers[#timers + 1] = { d = d, fn = fn } end }
local function flush() local list = timers timers = {} for _, t in ipairs(list) do t.fn() end return list end
UIParent = frame("UIParent")
local main = frame("CowfeeRaidToolsFrame")
local view
local CRT = { UI = { Create = function() return main end } }
function CRT:Print(m) printed[#printed + 1] = m end
CRT.Timeline = { PopoutView = function() return view end }
CRT.TimelineView = { LABEL_W = 166 }
assert(load(src))("CowfeeRaidTools", CRT)
local Log = CRT.WindowLog
local fails = 0
local function check(ok, what) if ok then io.write("PASS " .. what .. "\n") else fails = fails + 1 io.write("FAIL " .. what .. "\n") end end
local function said(pattern) for _, s in ipairs(printed) do if s:find(pattern, 1, true) then return s end end end
local function clear() for i = #printed, 1, -1 do printed[i] = nil end end

-- on before the pop-out exists: it is hooked once it is made (the log's every-frame watcher finds it)
Log:Toggle()
check(said("Timeline pop-out") ~= nil, "on: it says the pop-out is logged too")
local pop = frame("CowfeeRaidToolsTimelineWindow")
_G.CowfeeRaidToolsTimelineWindow = pop
clear()
pop:SetSize(1600, 900)
check(said("pop-out SetSize") == nil, "not hooked before the watcher saw it")
-- the log's every-frame watcher: the frame it made at load with an OnUpdate
local found
for _, f in ipairs(made) do if f.scripts.OnUpdate then found = f end end
check(found ~= nil, "the log watches every frame")
found.scripts.OnUpdate(found)
pop.w, pop.h = 1600, 900
pop:SetSize(1600, 900)
local line = said("pop-out SetSize")
check(line and line:find("w 1600 h 900", 1, true) and line:find("Window.lua:447", 1, true), "SetSize is logged with the size and the line that did it: " .. tostring(line))
for _, m in ipairs({ "SetWidth", "SetHeight", "SetPoint", "SetScale", "StartSizing" }) do
  clear()
  pop[m](pop, 1)
  check(said("pop-out " .. m) ~= nil, m .. " is logged")
end
clear()
pop.scripts.OnSizeChanged(pop, 1610, 905)
check(said("pop-out OnSizeChanged: 1610 x 905") ~= nil, "each size change is logged")
-- a resize that ends: the view's layout, after its own relayout
view = { frame = frame(), trackW = 1234, lanes = { 1, 2, 3 }, labels = { frame() }, vscroll = frame(), body = frame() }
view.labels[1].w = 162
function view:Mode() return "healers" end
function view:VisibleWidth() return 1234 end
function view.vscroll:GetVerticalScrollRange() return 120 end
function view.vscroll:GetVerticalScroll() return 30 end
clear()
pop:StopMovingOrSizing()
check(said("pop-out StopMovingOrSizing") ~= nil, "the end of the resize is logged")
local due = flush()
local delayed = false
for _, t in ipairs(due) do if t.d >= 0.2 then delayed = true end end
check(delayed, "the view's report waits for the view's own relayout")
local r = said("pop-out view:")
check(r and r:find("Healer CDs", 1, true) and r:find("VisibleWidth 1234", 1, true) and r:find("track 1234", 1, true)
  and r:find("scroll range 120", 1, true) and r:find("name column 166", 1, true) and r:find("rows 3", 1, true),
  "then the view's layout: mode, VisibleWidth, track, scroll range, name column: " .. tostring(r))
-- off: nothing more
Log:Toggle()
clear()
pop:SetSize(1, 1)
pop.scripts.OnSizeChanged(pop, 1, 1)
pop:StopMovingOrSizing()
flush()
check(#printed == 0, "off: nothing is printed")
-- no view popped out: it says so
Log:Toggle()
view = nil
clear()
Log.PopoutReport()
check(said("pop-out view: none") ~= nil, "no pop-out view: it says none")
io.write(fails == 0 and "all passed\n" or (fails .. " failed\n"))
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, 'CRT_Dev/Dev/WindowLog.lua'), 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
