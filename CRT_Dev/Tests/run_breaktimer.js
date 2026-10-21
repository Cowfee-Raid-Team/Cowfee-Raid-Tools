// CRT_Modules/QoL/BreakTimer.lua: the break timer window follows the theme. Its bar is the theme's accent (the
// theme's bad in the last minute), its texts the theme's text colour with an outline so they read on any fill, and
// a theme switch repaints all of it at once: while a break counts down, while the preview shows it, and on
// "Break's over".
// Usage: node run_breaktimer.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const themeLua = require('./theme_stub');
const root = process.argv[2];
const harness = themeLua(root) + `
local breakSrc = ...
local unpack = unpack or table.unpack
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function near(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end

-- frames, textures and font strings that remember their colours, text, font object and scripts
local function region(template)
  local r = { shown = true, template = template, scripts = {} }
  local m = {
    SetStatusBarColor = function(self, cr, cg, cb, ca) self.bar = { cr, cg, cb, ca or 1 } end,
    SetTextColor = function(self, cr, cg, cb, ca) self.rgb = { cr, cg, cb, ca or 1 } end,
    SetColorTexture = function(self, cr, cg, cb, ca) self.rgb = { cr, cg, cb, ca or 1 } end,
    SetText = function(self, t) self.text = t end,
    SetValue = function(self, v) self.value = v end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end, IsShown = function(self) return self.shown end,
    CreateTexture = function() return region() end,
    CreateFontString = function(_, _, _, tmpl) return region(tmpl) end,
    GetPoint = function() return "TOP", nil, "TOP", 0, -140 end,
  }
  return setmetatable(r, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
end
CreateFrame = function() return region() end
UIParent = region()
local now = 1000
time = function() return now end
GetTime = function() return now end
date = function() return "20:10" end
IsInGroup = function() return false end
IsInRaid = function() return false end
Ambiguate = function(n) return n end
InCombatLockdown = function() return false end

local CRT = { db = { qol = { breakTimer = {} } } }
CRT.UI = {}
CRT_THEME(CRT, CRT.UI)
local UI = CRT.UI
local previews = {}
function UI:RegisterLayer() end
function UI:RegisterThemed() end
function UI:RegisterPreview(key, fn) previews[key] = fn end
function UI.ResetButton() return region() end
function CRT:Print() end
CRT.Sound = { Play = function() end }
CRT.BreakFormats = { OnReceive = function() end, AnswerSyncWith = function() end, Label = function(k) return k end,
  SendAll = function() return {}, {} end }
assert(load(breakSrc, "BreakTimer.lua"))("CowfeeRaidTools", CRT)
local Break = CRT.BreakTimer
local P = CRT.PALETTE
local THEMES = { "blizzard", "midnight", "nitro", "cowfee" }

-- the window is built on first use; find its bar and texts through a preview
UI.SwitchTheme("cowfee")
previews["break"](true)
-- the window's parts, from the module's test hook
local parts = Break.Parts and Break.Parts() or {}
local bar, label, timeText, endsText = parts.bar, parts.label, parts.timeText, parts.endsText
check(bar and label and timeText and endsText, "Break.Parts gives the bar and its texts")
if not (bar and label and timeText and endsText) then print(passes .. " passed, " .. fails .. " failed") error("no parts") end

-- the preview: the bar is the accent, the texts the text colour, in every theme, repainted live on a switch
for _, key in ipairs(THEMES) do
  UI.SwitchTheme(key)
  check(near(bar.bar, P.accent) and bar.bar[4] == 1, key .. ": the preview's bar repaints to the accent")
  for name, fs in pairs({ label = label, time = timeText, ends = endsText }) do
    check(near(fs.rgb, P.text), key .. ": the " .. name .. " text is the theme's text colour")
  end
end
for name, fs in pairs({ label = label, time = timeText, ends = endsText }) do
  check(fs.template == "CRTFontLargeOutline", "the " .. name .. " text is outlined, so it reads on any fill: " .. tostring(fs.template))
end
previews["break"](false)

-- a running break: a switch repaints the bar at once, with no tick in between
Break:Command("10")
for _, key in ipairs(THEMES) do
  UI.SwitchTheme(key)
  check(near(bar.bar, P.accent), key .. ": a running break's bar takes the accent at once")
end
-- the tick keeps the accent
UI.SwitchTheme("nitro")
now = now + 5
local tick = parts.frame:GetScript("OnUpdate")
check(tick ~= nil, "a running break ticks")
if tick then tick(parts.frame, 1) end
check(near(bar.bar, CRT.THEMES.nitro.accent), "nitro: the tick keeps the accent")
-- the last minute: the theme's bad, repainted live too
now = now + 600 - 5 - 30
if tick then tick(parts.frame, 1) end
check(near(bar.bar, CRT.THEMES.nitro.bad), "nitro: the last minute is the theme's bad")
for _, key in ipairs(THEMES) do
  UI.SwitchTheme(key)
  check(near(bar.bar, P.bad), key .. ": the last minute repaints to the theme's bad")
end
-- "Break's over", then a new break goes back to the accent
now = now + 31
if tick then tick(parts.frame, 1) end
check(label.text == "Break's over", "the break ends: " .. tostring(label.text))
Break:Command("5")
UI.SwitchTheme("midnight")
check(near(bar.bar, CRT.THEMES.midnight.accent), "a new break is the accent again")
Break:Command("0")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " break timer checks failed") end
`;
const src = fs.readFileSync(path.join(root, 'CRT_Modules/QoL/BreakTimer.lua'), 'utf8');
// no fixed colour in the file: the bar and texts read the palette (the drag strip's Classic colours go through
// UI:RegisterThemed, as on the other overlays)
let srcFails = 0;
if (/SetTextColor\(\s*1\s*,\s*1\s*,\s*1/.test(src)) { console.log('FAIL BreakTimer.lua writes a fixed white text colour'); srcFails++; }
if (/COLOR_LAST|0\.85,\s*0\.27,\s*0\.2/.test(src)) { console.log('FAIL BreakTimer.lua keeps a fixed last-minute red'); srcFails++; }
if (!/UI:RegisterThemed\(handle/.test(src)) { console.log('FAIL the drag strip is not themed'); srcFails++; }
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
if (srcFails > 0) process.exit(1);
console.log('ok break timer: the theme\'s accent, bad and text, repainted live');
