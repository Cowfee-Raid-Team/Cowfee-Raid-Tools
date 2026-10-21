// The ready check bar and the game's ready check window: loads CRT_Modules/Consumables/Display.lua on mock
// frames, with stubs for the rest of the module. Checks the bar docks under the game's window (the one with
// Ready and Not Ready, ReadyCheckListenerFrame) when it shows, floats at its own place when it doesn't (the
// player who started the check), follows the window, hides with it, and has Close only for the raid leader.
//   node run_consumables_dock.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local displaySrc = ...
local passed, failed = 0, 0
local function check(name, cond, detail)
  if cond then passed = passed + 1 print("ok " .. name)
  else failed = failed + 1 print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or "")) end
end

-- A mock frame or region: any method is a no-op unless defined here.
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, hooks = {} }
  return setmetatable(m, { __index = function(t, k)
    if type(k) == "string" and k:match("^%l") then return nil end
    if k == "CreateFontString" or k == "CreateTexture" then return function(self) local r = mock("Region") rawset(r, "parent", self) return r end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "HookScript" then return function(self, n, fn) table.insert(self.hooks, { n, fn }) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false for _, h in ipairs(self.hooks) do if h[1] == "OnHide" then h[2](self) end end end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    -- Shown, and every parent shown, as in the game.
    if k == "IsVisible" then return function(self)
      local f = self
      while f do if not f.shown then return false end f = rawget(f, "parent") end
      return true end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetPoint" then return function(self) local p = self.pts[1] if p then return p[1], p[2], p[3], p[4], p[5] end end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    return function() end
  end })
end

-- Game stubs.
UIParent = mock("UIParent")
local SECRET = setmetatable({}, { __eq = function() error("compared a secret value") end })
issecretvalue = function(v) return rawequal(v, SECRET) end
local combat = false
InCombatLockdown = function() return combat end
local now = 100
GetTime = function() return now end
local leader = false
UnitIsGroupLeader = function(unit) return unit == "player" and leader end
UnitName = function() return "Me" end
Ambiguate = function(name) return (name:gsub("%-.*", "")) end
local timers = {}
C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
local function runTimers() local list = timers timers = {} for _, fn in ipairs(list) do fn() end end
GameTooltip = mock("GameTooltip")

-- The game's ready check frames, as in Blizzard_FrameXML/Mainline/ReadyCheck.xml: ReadyCheckFrame on
-- UIParent, ReadyCheckListenerFrame (the window with Ready and Not Ready) inside it. The game shows
-- ReadyCheckFrame for everyone, and the listener only to players who did not start the check.
ReadyCheckFrame = mock("Frame") rawset(ReadyCheckFrame, "parent", UIParent) ReadyCheckFrame.shown = false
ReadyCheckListenerFrame = mock("Frame") rawset(ReadyCheckListenerFrame, "parent", ReadyCheckFrame) ReadyCheckListenerFrame.shown = false
local function gameShows(startedByMe)
  ReadyCheckFrame.shown = true
  ReadyCheckListenerFrame.shown = not startedByMe
end

local frames = {}
function CreateFrame(kind, name, parent)
  local f = mock(kind)
  rawset(f, "parent", parent) rawset(f, "name", name)
  frames[#frames + 1] = f
  return f
end

local CRT = { db = { readycheck = { fadeOnPull = true } } }
function CRT:Print(m) print("  [print] " .. tostring(m)) end
local savedPosition
CRT.Consumables = {
  CATEGORIES = { { key = "food" }, { key = "flask" } },
  Def = function() return { clickable = false } end,
  Enabled = function() return true end,
  NotStarter = function() return false end,
  Position = function() return savedPosition end,
  SavePosition = function() end,
  ResetPosition = function() savedPosition = nil end,
  RefreshBags = function() end,
  Order = function() return { "food", "flask" } end,
  Status = function() return {} end,
  NextItem = function() end,
}
CRT.Ants = { Update = function() end }
CRT.ConsumablesBar = {
  Size = function() return 100, 40 end, BACKDROP = {},
  CreateSlot = function(parent) local s = mock("Button") rawset(s, "parent", parent) return s end,
  Apply = function() end, AddStatusLines = function() end,
}
local previews = {}
CRT.UI = {
  RegisterLayer = function() end, RegisterThemed = function() end,
  ResetButton = function() return mock("Button") end,
  CancelFade = function() end, FadeOut = function() end,
  RegisterPreview = function(_, key, fn) previews[key] = fn end,
}

assert(load(displaySrc, "Display.lua"))("CowfeeRaidTools", CRT)
local Display = CRT.ConsumablesDisplay
local events
for _, f in ipairs(frames) do if rawget(f, "OnEvent") then events = f end end
events.OnEvent(events, "PLAYER_LOGIN")
local bar, closeBar
for _, f in ipairs(frames) do if rawget(f, "name") == "CowfeeRaidToolsReadyCheckRow" then bar = f end end
for _, f in ipairs(frames) do if f.kind == "Button" and rawget(f, "parent") == bar and rawget(f, "OnClick") then closeBar = f end end
check("the bar and its Close button are built at login", bar ~= nil and closeBar ~= nil)

local function dockedUnder(win)
  local p = bar.pts[1]
  return #bar.pts == 1 and p[1] == "TOP" and p[2] == win and p[3] == "BOTTOM" and p[4] == 0 and p[5] < 0 and p[5] >= -8
end
local function floating()
  local p = bar.pts[1]
  return #bar.pts == 1 and p[2] == UIParent
end
local function tick(dt) bar.OnUpdate(bar, dt or 0.6) end
local function readyCheck(initiator, startedByMe)
  -- The game's own handler and ours both run on READY_CHECK, in either order.
  events.OnEvent(events, "READY_CHECK", initiator, 30)
  gameShows(startedByMe)
  runTimers()
end
local function finish()
  ReadyCheckFrame:Hide()
  events.OnEvent(events, "READY_CHECK_FINISHED")
end

-- 1. Someone else starts a check: the bar docks right under the game's window, centred, a small gap.
leader = false
readyCheck("Raidlead", false)
check("someone else's check: the bar shows", bar.shown)
check("someone else's check: the bar sits under the game's window, centred", dockedUnder(ReadyCheckListenerFrame), bar.pts[1] and table.concat({ tostring(bar.pts[1][1]), tostring(bar.pts[1][3]), tostring(bar.pts[1][5]) }, " "))
check("it is anchored to the game's window, never parented to it", rawget(bar, "parent") == UIParent)
check("not the leader: no Close", not closeBar.shown)
tick()
check("it stays docked as it refreshes", dockedUnder(ReadyCheckListenerFrame))
-- A saved place is for the floating bar only: with the game's window up, the bar docks.
savedPosition = { point = "CENTER", relativePoint = "CENTER", x = 50, y = 60 }
tick()
check("a saved place doesn't pull it off the game's window", dockedUnder(ReadyCheckListenerFrame))
-- Answering hides the game's window (ReadyCheckFrame:Hide in its Ready button), and the bar goes with it at once.
ReadyCheckFrame:Hide()
check("clicking Ready hides the bar with the game's window", not bar.shown)
finish()
check("the game's window is hooked, not replaced", rawget(ReadyCheckFrame, "OnHide") == nil and #ReadyCheckFrame.hooks >= 1)
check("the game's window is never given scripts by the addon", rawget(ReadyCheckListenerFrame, "OnShow") == nil and rawget(ReadyCheckListenerFrame, "OnHide") == nil)

-- In combat the hide waits, then happens after combat.
readyCheck("Raidlead", false)
combat = true
ReadyCheckFrame:Hide()
check("in combat the bar waits to hide", bar.shown)
combat = false
events.OnEvent(events, "PLAYER_REGEN_ENABLED")
check("after combat it hides", not bar.shown)
finish()

-- 2. You start the check as raid leader: the game shows you no window, so the bar floats with Close.
leader = true
savedPosition = nil
readyCheck("Me", true)
check("your own check: the bar shows", bar.shown)
check("your own check: the bar floats at its usual place", floating(), bar.pts[1] and tostring(bar.pts[1][2]))
check("raid leader: Close shows", closeBar.shown)
tick()
check("your own check: it stays up while the check runs", bar.shown and floating())
savedPosition = { point = "CENTER", relativePoint = "CENTER", x = 50, y = 60 }
tick()
check("your own check: a saved place is used", floating() and bar.pts[1][1] == "CENTER" and bar.pts[1][4] == 50)
closeBar.OnClick(closeBar)
check("Close hides it", not bar.shown)
finish()

-- The leader on someone else's check (an assistant started it): docked, with Close.
readyCheck("Assist", false)
check("leader on an assistant's check: docked under the window", dockedUnder(ReadyCheckListenerFrame))
check("leader on an assistant's check: Close shows", closeBar.shown)
finish()
check("the check ending hides it", not bar.shown)

-- A leader status the game hides is never compared, and gives no Close.
leader = SECRET
readyCheck("Raidlead", false)
check("a hidden leader status gives no Close", not closeBar.shown)
finish()
leader = false

-- The window moves: the bar is anchored to it, so it follows without being moved itself.
readyCheck("Raidlead", false)
local before = bar.pts[1][2]
ReadyCheckListenerFrame.pts = { { "CENTER", UIParent, "CENTER", 200, 100 } }
tick()
check("the bar follows the game's window", dockedUnder(ReadyCheckListenerFrame) and before == ReadyCheckListenerFrame)
finish()

-- Not the leader, your own check (Not when I start it off): floating, no Close, gone when the check ends.
readyCheck("Me", true)
check("a raider's own check: floating, no Close", floating() and not closeBar.shown)
now = now + 40
tick()
check("it goes when the check's time is up", not bar.shown)
finish()

-- Previews: the floating bar with its drag handle, never docked and never with Close.
previews.consumables(true)
check("preview: floating", floating())
check("preview: no Close", not closeBar.shown)
gameShows(false)
tick()
check("preview: not docked even with the game's window up", floating())
previews.consumables(false)
finish()

print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error("consumables dock checks failed") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, 'CRT_Modules/Consumables/Display.lua'), 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
