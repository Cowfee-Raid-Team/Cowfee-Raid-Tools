// CRT_Modules/QoL/LowHealth.lua and CRT_Dev/Dev/LowHealthProbe.lua: the LOW HEALTH banner's path with your health secret
// (the curve's result straight into SetAlpha, never compared, joined, turned into text or used as a key), the banner off,
// the curve's points, the fallback when the curve gives nothing; and the dev probe (/crt dev lowhp) logging each path
// (the curve result's secret-ness, the banner's path, the game's Combat Audio Alerts pulse calls) without an error.
// A secret here errors on any comparison, arithmetic, join, length, index or text conversion, as the game's do in addon code.
// Usage: node run_lowhealth.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local lowSrc, probeSrc = ...
local out = print
local passed, failed = 0, 0
local function check(name, cond, detail)
  if cond then passed = passed + 1 out("ok " .. name) else failed = failed + 1 out("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or "")) end
end
format = string.format
-- a secret: any use but passing it on or asking issecretvalue/type is an error
local function boom() error("secret value used", 2) end
local SECRET = setmetatable({}, { __eq = boom, __lt = boom, __le = boom, __concat = boom, __add = boom, __sub = boom, __mul = boom,
  __div = boom, __unm = boom, __len = boom, __index = boom, __newindex = boom, __tostring = boom, __call = boom })
function issecretvalue(v) return rawequal(v, SECRET) end
local realType = type
function type(v) if rawequal(v, SECRET) then return "number" end return realType(v) end
local inCombat = false
function InCombatLockdown() return inCombat end
function UnitIsDeadOrGhost() return false end
function UnitHealth() return SECRET end
function UnitHealthMax() return SECRET end
local hpResult = SECRET -- what UnitHealthPercent with a curve gives
local hpCalls = 0
function UnitHealthPercent(unit, predicted, curve) hpCalls = hpCalls + 1 if curve then return hpResult end return SECRET end
Enum = { LuaCurveType = { Linear = 0, Step = 1 } }
local curves = {}
C_CurveUtil = { CreateCurve = function()
  local c = { points = {} }
  function c:SetType(t) self.type = t end
  function c:AddPoint(x, y) self.points[#self.points + 1] = { x, y } end
  function c:Evaluate(x) return 0 end
  curves[#curves + 1] = c
  return c
end }
local errors = {}
local frames = {}
local function frameMock(name)
  local f = { name = name, shown = true, alpha = 1, scripts = {}, events = {} }
  frames[#frames + 1] = f
  return setmetatable(f, { __index = function(t, k)
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "GetAlpha" then return function(self) return rawget(self, "alpha") end end
    if k == "SetShown" then return function(self, on) rawset(self, "shown", on and true or false) end end
    if k == "Show" then return function(self) rawset(self, "shown", true) end end
    if k == "Hide" then return function(self) rawset(self, "shown", false) end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "IsVisible" then return function(self) return rawget(self, "shown") end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "RegisterEvent" then return function(self, e) self.events[e] = true end end
    if k == "UnregisterEvent" then return function(self, e) self.events[e] = nil end end
    if k == "RegisterUnitEvent" then return function(self, e) self.events[e] = true end end
    if k == "CreateFontString" then return function() return frameMock() end end
    if k == "GetPoint" then return function() return "CENTER", nil, "CENTER", 0, 0 end end
    if k == "GetFrameStrata" then return function() return "DIALOG" end end
    if type(k) == "string" and k:find("^%u") then return function() end end
  end })
end
function CreateFrame(kind, name) return frameMock(name) end
UIParent = frameMock("UIParent")
local function fire(event, ...)
  for _, f in ipairs(frames) do
    if f.events[event] and f.scripts.OnEvent then
      local ok, err = pcall(f.scripts.OnEvent, f, event, ...)
      if not ok then errors[#errors + 1] = tostring(err) end
    end
  end
end
local printed = {}
function print(...) local t = {} for i = 1, select("#", ...) do t[i] = tostring((select(i, ...))) end printed[#printed + 1] = table.concat(t, " ") end
local clock = 100
function GetTime() return clock end
function time() return 1700000000 end
function date() return "2026-11-01 12:00" end
C_Timer = { After = function(_, fn) fn() end }
local cvars = { CAAEnabled = "0", CAAPulsePlayerHealthPercent = "0" }
C_CVar = { GetCVar = function(n) return cvars[n] end, SetCVar = function(n, v) cvars[n] = tostring(v) end }
local hooks = {}
function hooksecurefunc(t, name, fn)
  local old = t[name]
  t[name] = function(...) local r = { old(...) } fn(...) return unpack(r) end
  hooks[#hooks + 1] = name
end
unpack = unpack or table.unpack
CombatAudioAlertManager = { SetHealthPulseSoundKit = function() end, StopHealthPulse = function() end }
local CRT = { db = { qol = { lowHealth = { enabled = false, threshold = 35 } }, dev = {} } }
function CRT:Print(m) printed[#printed + 1] = tostring(m) end
local shown
CRT.ConsumablesTools = { ShowText = function(_, title, text) shown = { title = title, text = text } end }
local UI = {}
CRT.UI = UI
function UI:RegisterLayer() end
function UI.Tint() end
function UI.ThemedText(fs, build) fs:SetText(build()) end
function UI.BadText(s) return s end
function UI.ResetButton() return frameMock() end
function UI:RegisterPreview() end
UI.Placement = { Define = function() return { Attach = function() return frameMock() end, Reset = function() end } end }
local ok, err = pcall(function() assert(load(lowSrc, "@LowHealth.lua"))("CowfeeRaidTools", CRT) end)
check("LowHealth.lua loads", ok, err)
local LH = CRT.LowHealth
fire("PLAYER_LOGIN")
local banner
for _, f in ipairs(frames) do if f.name == "CowfeeRaidToolsLowHealth" then banner = f end end
check("the banner is built at login, hidden while off", banner and not banner.shown and banner.alpha == 0)

-- on, with your health secret: the curve's result goes straight into SetAlpha
LH:SetEnabled(true)
check("on: the banner is shown, its alpha the curve's result as given", banner.shown and rawequal(banner.alpha, SECRET), tostring(issecretvalue(banner.alpha)))
check("on: no error", #errors == 0, errors[1])
check("the curve: 1 up to 35%, 0 from just above it", #curves >= 1 and curves[#curves].points[2][1] == 0.35 and curves[#curves].points[2][2] == 1
  and curves[#curves].points[3][2] == 0 and curves[#curves].points[4][1] == 1)
local st = LH:State()
check("the path is the curve, with no error", st and st.path == "curve" and st.error == nil, st and (tostring(st.path) .. " " .. tostring(st.error)))
inCombat = true
fire("UNIT_HEALTH", "player")
check("in combat, on each health change: still the curve's result, no error", rawequal(banner.alpha, SECRET) and #errors == 0 and LH:State().path == "curve", errors[1])
-- the curve gives nothing: the plain fallback, which can't read a secret health and shows nothing
hpResult = nil
fire("UNIT_HEALTH", "player")
check("no curve result: the plain path, hidden, no error", banner.alpha == 0 and LH:State().path == "plain" and #errors == 0, errors[1])
hpResult = 0.5 -- a readable result (a client where it isn't secret)
fire("UNIT_HEALTH", "player")
check("a readable result goes in as it is", banner.alpha == 0.5 and LH:State().path == "curve")
hpResult = SECRET
inCombat = false
-- off
LH:SetEnabled(false)
check("off: hidden, alpha 0", not banner.shown and banner.alpha == 0)

-- the code never compares the curve's result: it is only checked with type() and passed to SetAlpha
local update = lowSrc:match("function LowHealth:Update%(%).-\\nend\\r?\\n")
check("Update is in the file", update ~= nil)
if update then
  local bad = update:match("alpha%s*[=~<>]=") or update:match("alpha%s*[<>]") or update:match("[=~<>]=%s*alpha") or update:match("%.%.%s*alpha") or update:match("tostring%(alpha%)")
  check("Update never compares, joins or converts the curve's result", bad == nil, bad)
end

-- The dev probe -----------------------------------------------------------------------------------------
LH:SetEnabled(true)
local okP, errP = pcall(function() assert(load(probeSrc, "@LowHealthProbe.lua"))("CowfeeRaidTools", CRT) end)
check("LowHealthProbe.lua loads", okP, errP)
local P = CRT.LowHealthProbe
check("it takes dev lowhp and leaves other words", P and P:Command("dev lowhp on") == true and P:Command("dev lowhpx") == false and P:Command("dev aura on") == false)
check("on: it listens and hooks the game's pulse", CRT.db.dev.lowhpProbe and CRT.db.dev.lowhpProbe.on == true
  and table.concat(hooks, ","):find("SetHealthPulseSoundKit", 1, true) and table.concat(hooks, ","):find("StopHealthPulse", 1, true))
inCombat = true
fire("PLAYER_REGEN_DISABLED")
fire("UNIT_HEALTH", "player")
CombatAudioAlertManager:SetHealthPulseSoundKit(SECRET)
CombatAudioAlertManager:SetHealthPulseSoundKit(12345)
CombatAudioAlertManager:SetHealthPulseSoundKit(nil)
CombatAudioAlertManager:StopHealthPulse()
fire("UNIT_HEALTH", SECRET) -- even the unit hidden
inCombat = false
fire("PLAYER_REGEN_ENABLED")
check("no error from the probe, whatever was secret", #errors == 0, errors[1])
local text = P:Text() or ""
check("the log: the curve result's secret-ness, the banner's path and the combat state", text:find("curve result <secret number>", 1, true) and text:find("banner curve", 1, true)
  and text:find("combat on", 1, true) and text:find("combat off", 1, true), text)
check("the log: each pulse call, a secret kit told apart", text:find("pulse kit <secret number>", 1, true) and text:find("pulse kit 12345", 1, true)
  and text:find("pulse kit nil", 1, true) and text:find("pulse stop", 1, true), text)
check("the log: the game's pulse settings", text:find("CAAEnabled 0", 1, true) and text:find("CAAPulsePlayerHealthPercent 0", 1, true), text)
check("the log: a hidden unit is logged, not read", text:find("UNIT_HEALTH <secret number>", 1, true), text)
-- repeats of the same line are counted, not logged again
local before = #CRT.db.dev.lowhpProbe.last.lines
fire("UNIT_HEALTH", "player") fire("UNIT_HEALTH", "player") fire("UNIT_HEALTH", "player")
check("the same line again is counted, not added", #CRT.db.dev.lowhpProbe.last.lines <= before + 1, #CRT.db.dev.lowhpProbe.last.lines - before)
P:Command("dev lowhp show")
check("show opens the log to copy", shown and shown.text:find("Low-health probe", 1, true))
P:Command("dev lowhp off")
local n = #CRT.db.dev.lowhpProbe.last.lines
CombatAudioAlertManager:SetHealthPulseSoundKit(777)
fire("UNIT_HEALTH", "player")
check("off: nothing more is logged (the hooks stay, quiet)", #CRT.db.dev.lowhpProbe.last.lines == n and CRT.db.dev.lowhpProbe.on == false)
check("the probe changes no game setting", cvars.CAAEnabled == "0" and cvars.CAAPulsePlayerHealthPercent == "0")
check("no error at all", #errors == 0, errors[1])
out(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error(failed .. " checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const f of ['CRT_Modules/QoL/LowHealth.lua', 'CRT_Dev/Dev/LowHealthProbe.lua']) {
  const p = path.join(d, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''));
}
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
