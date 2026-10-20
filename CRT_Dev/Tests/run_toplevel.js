// CRT_Core/UI/Panel.lua's UI:RegisterLayer: frames on the panel and timeline layers are toplevel and raise
// when shown; the popups layer is toplevel only; every other layer is left alone.
// Usage: node run_toplevel.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, mochaSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end

local function frame(protected)
  local f = { strata = nil, toplevel = false, raised = 0, scripts = {}, protected = protected }
  function f:SetFrameStrata(s) self.strata = s end
  function f:SetToplevel(v) self.toplevel = v end
  function f:Raise() self.raised = self.raised + 1 end
  function f:IsProtected() return self.protected end
  function f:HookScript(k, fn) self.scripts[k] = fn end
  function f:Show() if self.scripts.OnShow then self.scripts.OnShow(self) end end
  -- any other method does nothing
  return setmetatable(f, { __index = function(_, k) return type(k) == "string" and k:find("^%u") and function() end or nil end })
end
local combat = false
InCombatLockdown = function() return combat end
CreateFrame = function() return frame() end

local CRT = { db = { ui = { modern = false, layers = {} } } }
assert(load(mochaSrc, "Themes.lua"))("CowfeeRaidTools", CRT)
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI

for _, key in ipairs({ "panel", "timeline" }) do
  local f = frame()
  UI:RegisterLayer(key, f)
  check(f.toplevel == true, key .. " layer: toplevel")
  f:Show()
  check(f.raised == 1, key .. " layer: raised when shown")
  -- a protected frame in combat is not raised
  local p = frame(true)
  UI:RegisterLayer(key, p)
  combat = true
  p:Show()
  combat = false
  check(p.raised == 0, key .. " layer: a protected frame is not raised in combat")
end

local pop = frame()
UI:RegisterLayer("popups", pop)
check(pop.toplevel == true, "popups layer: toplevel")
pop:Show()
check(pop.raised == 0 and next(pop.scripts) == nil, "popups layer: no raise hook")

for _, layer in ipairs(UI.LAYERS) do
  if layer.key ~= "panel" and layer.key ~= "timeline" and layer.key ~= "popups" then
    local f = frame()
    UI:RegisterLayer(layer.key, f)
    check(f.toplevel == false and next(f.scripts) == nil, layer.key .. " layer: unchanged")
  end
end

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " toplevel checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Panel.lua')));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/Themes.lua')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
