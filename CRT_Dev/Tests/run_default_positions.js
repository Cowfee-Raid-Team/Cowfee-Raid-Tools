// The shipped default places of the movable areas Alex laid out (2026-10-25): the break timer, the note callout,
// the critical alerts text, the low-health banner and the alert circles. For each, on mock frames: a new install
// puts it at the default, a saved position wins over the default, and Reset clears the saved one and puts it back.
// Every place is a CENTER (or TOP) offset from UIParent, so it lands in the same spot on any screen size.
// Usage: node run_default_positions.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
const placementLua = require('./placement_stub');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const harness = placementLua(root) + `
local SRC = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
format = format or string.format
wipe = wipe or function(t) for k in pairs(t) do t[k] = nil end return t end

-- frames that remember their anchor; any other method is a no-op
local frames
local function region(name)
  local r = { name = name, scripts = {}, pts = {}, shown = false }
  local m = {
    SetPoint = function(self, p, rel, rp, x, y) self.pts[#self.pts + 1] = { p, rel, rp, x, y } end,
    ClearAllPoints = function(self) self.pts = {} end,
    GetPoint = function(self) local p = self.pts[1] if p then return p[1], p[2], p[3], p[4], p[5] end end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end,
    IsShown = function(self) return self.shown end, IsVisible = function(self) return self.shown end,
    CreateTexture = function() return region() end,
    CreateFontString = function() return region() end,
    CreateAnimationGroup = function() return region() end,
    CreateAnimation = function() return region() end,
    GetStringWidth = function() return 60 end, GetUnboundedStringWidth = function() return 60 end,
    GetStringHeight = function() return 14 end,
    GetWidth = function() return 100 end, GetHeight = function() return 20 end,
    GetFrameLevel = function() return 1 end, GetCenter = function() return 0, 0 end,
    GetFont = function() return "Fonts\\\\FRIZQT__.TTF", 12, "" end,
    GetAlpha = function() return 1 end,
  }
  return setmetatable(r, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
end
CreateFrame = function(_, name) local f = region(name) if name then frames[name] = f end return f end
UIParent = region("UIParent")
GetTime = function() return 100 end
time = function() return 100 end
date = function() return "20:00" end
InCombatLockdown = function() return false end
IsInGroup = function() return false end
IsInRaid = function() return false end
UnitHealth = function() return 100 end
UnitHealthMax = function() return 100 end
issecretvalue = function() return false end

-- a fresh addon table for one load
local function newCRT()
  frames = {}
  local previews = {}
  local CRT = { db = { alerts = { areas = {} }, notes = { alert = {} }, qol = { lowHealth = {}, breakTimer = {} } } }
  local UI = { previews = previews, HELP_GAP = 4 }
  setmetatable(UI, { __index = function(_, k)
    if type(k) == "string" and k:find("^%u") and k:find("%l") then return function() return region() end end
  end })
  function UI:RegisterPreview(key, fn) previews[key] = fn end
  function UI:RegisterLayer() end
  function UI:RegisterThemed() end
  function UI:OnTheme() end
  function UI.ResetButtonWidth() return 50 end
  function UI.BadText(t) return t end
  CRT.UI = UI
  CRT_PLACEMENT(CRT) -- UI/Placement.lua, which every movable element is placed by
  CRT.PALETTE = setmetatable({}, { __index = function() return { 1, 1, 1 } end })
  CRT.Alerts = { running = false, Lines = function() return {} end, Now = function() return 100 end }
  CRT.AlertRules = { Area = function() return {}, 0 end, Alert = function() end }
  CRT.Notes = { Alert = function() return CRT.db.notes.alert end, SpellInfo = function() end, Set = function() end }
  CRT.NoteEngine = { running = false }
  CRT.Sound = { Play = function() end }
  CRT.BreakFormats = { OnReceive = function() end, AnswerSyncWith = function() end, Label = function(k) return k end,
    SendAll = function() return {}, {} end }
  function CRT:Print() end
  return CRT
end

local function load_(CRT, files)
  for _, f in ipairs(files) do
    assert(load(SRC[f], f))("CowfeeRaidTools", CRT)
  end
end

-- each area: the files it needs, how its saved position is reached, how it is built, its frame and Reset
local AREAS = {
  { name = "break timer", files = { "CRT_Modules/QoL/BreakTimer.lua" }, frame = "CowfeeRaidToolsBreak",
    want = { "TOP", "TOP", 0, -140 },
    store = function(CRT) return CRT.db.qol.breakTimer end,
    build = function(CRT) CRT.UI.previews["break"](true) end,
    reset = function(CRT) CRT.BreakTimer:ResetPosition() end },
  { name = "note callout", files = { "CRT_Modules/Notes/Alert.lua" }, frame = "CowfeeRaidToolsNoteAlert",
    want = { "CENTER", "CENTER", 3, 113 },
    store = function(CRT) return CRT.db.notes.alert end,
    build = function(CRT) CRT.UI.previews.alert(false) end,
    reset = function(CRT) CRT.NoteAlert:ResetPosition() end },
  { name = "critical alerts text", files = { "CRT_Modules/Alerts/Areas.lua", "CRT_Modules/Alerts/Texts.lua" }, frame = "CowfeeRaidToolsAlertTexts",
    want = { "CENTER", "CENTER", 3, 323 },
    store = function(CRT) return CRT.AlertTexts:Settings() end,
    build = function(CRT) CRT.AlertTexts:Build() end,
    reset = function(CRT) CRT.AlertTexts:ResetPosition() end },
  { name = "low health", files = { "CRT_Modules/QoL/LowHealth.lua" }, frame = "CowfeeRaidToolsLowHealth",
    want = { "CENTER", "CENTER", -5, 41 },
    store = function(CRT) return CRT.db.qol.lowHealth end,
    build = function(CRT) CRT.UI.previews.lowhealth(false) end,
    reset = function(CRT) CRT.LowHealth:ResetPosition() end },
  { name = "alert circles", files = { "CRT_Modules/Alerts/Areas.lua", "CRT_Modules/Alerts/Circles.lua" }, frame = "CowfeeRaidToolsAlertCircles",
    want = { "CENTER", "CENTER", 8, -29 },
    store = function(CRT) return CRT.AlertCircles:Settings() end,
    build = function(CRT) CRT.AlertCircles:Build() end,
    reset = function(CRT) CRT.AlertCircles:ResetPosition() end },
}

local function at(f)
  local p = f and f.pts[#f.pts]
  if not p then return "nowhere" end
  return string.format("%s %s %s %s on %s", tostring(p[1]), tostring(p[3]), tostring(p[4]), tostring(p[5]), tostring(p[2] and p[2].name))
end
local function placed(f, want)
  local p = f and f.pts[#f.pts]
  return p ~= nil and p[1] == want[1] and p[2] == UIParent and (p[3] or p[1]) == want[2] and p[4] == want[3] and p[5] == want[4]
end

local SAVED = { point = "CENTER", relativePoint = "CENTER", x = 123, y = -45 }
for _, a in ipairs(AREAS) do
  local want = string.format("%s %s %d %d", a.want[1], a.want[2], a.want[3], a.want[4])
  -- a new install: no saved position
  local CRT = newCRT()
  load_(CRT, a.files)
  local ok, err = pcall(a.build, CRT)
  check(ok, a.name .. ": builds on mock frames: " .. tostring(err))
  check(placed(frames[a.frame], a.want), a.name .. ": a new install puts it at " .. want .. ", got " .. at(frames[a.frame]))
  check(a.store(CRT).position == nil, a.name .. ": a new install saves no position")
  -- a player who moved it keeps their place, and Reset puts it back at the default
  CRT = newCRT()
  load_(CRT, a.files)
  a.store(CRT).position = { point = SAVED.point, relativePoint = SAVED.relativePoint, x = SAVED.x, y = SAVED.y }
  ok, err = pcall(a.build, CRT)
  check(ok, a.name .. ": builds with a saved position: " .. tostring(err))
  check(placed(frames[a.frame], { "CENTER", "CENTER", 123, -45 }), a.name .. ": a saved position wins, got " .. at(frames[a.frame]))
  a.reset(CRT)
  check(a.store(CRT).position == nil, a.name .. ": Reset clears the saved position")
  check(placed(frames[a.frame], a.want), a.name .. ": Reset puts it at " .. want .. ", got " .. at(frames[a.frame]))
end

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " default position checks failed") end
`;

const files = ['CRT_Modules/QoL/BreakTimer.lua', 'CRT_Modules/Notes/Alert.lua', 'CRT_Modules/Alerts/Areas.lua', 'CRT_Modules/Alerts/Texts.lua',
  'CRT_Modules/QoL/LowHealth.lua', 'CRT_Modules/Alerts/Circles.lua'];
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_newtable(L);
for (const f of files) {
  lua.lua_pushstring(L, to_luastring(read(f)));
  lua.lua_setfield(L, -2, to_luastring(f));
}
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
console.log('ok default positions: new install, saved position and Reset for the five areas');
