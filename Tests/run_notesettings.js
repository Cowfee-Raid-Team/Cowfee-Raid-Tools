// Builds the Raid Notes page (Notes/Settings.lua and Notes/Page.lua) on mock frames and switches tabs.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local settingsSrc, pageSrc = ...
local created = 0
local function mock()
  local m = { shown = false }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" or k == "CreateTexture" then return function() created = created + 1 return mock() end end
    if k == "SetText" then return function(self, s) self.text = s end end
    if k == "GetText" then return function(self) return rawget(self, "typed") end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on) end end
    if k == "SetTextColor" then return function(self, r) rawset(self, "grey", r < 1) end end
    if k == "Show" then return function(self) self.shown = true if rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "HasFocus" then return function() return false end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    return function() end end })
end
allFrames = {}
function CreateFrame(kind) created = created + 1 local f = mock() rawset(f, "kind", kind) allFrames[#allFrames+1] = f return f end
format = string.format
UIParent = mock()
UISpecialFrames = {}
tinsert = table.insert
CANCEL = "Cancel"
ChatFontNormal = {}
local pages = {}
local alertsDb = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 } }
local barRefreshes, barTests = 0, 0
local previewsOn = false
local sliderLabels = {}
local listeners = {}
local alertSettings = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100 }
local win = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata", hidePassed = true, onlyMe = false }
local CRT = {
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end },
  UI = { PAGE_W = 1026, PAGE_H = 560, Help = function() return mock() end, Dropdown = function(_, _, o) local m = mock() rawset(m, "refresh", function() if o.enabledIf then rawset(m, "enabled", o.enabledIf() and true or false) end end) return m end, Slider = function(_, t, o) sliderLabels[t] = o local m = mock() rawset(m, "refresh", function() if o.enabledIf then rawset(m, "enabled", o.enabledIf() and true or false) end end) return m end,  RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end, SetFrameTitle = function() end, RegisterTab = function() end, SetPreviews = function(_, on) previewsOn = on end, SetTabSelected = function() end },
  Notes = {
    CanEditRaid = function() return true end, -- Notes/Data.lua: solo, you may change the raid note
    WindowSettings = function() return win end, Alert = function() return alertSettings end, Set = function(_, k, f, v) print("Set", k, f, v); local t = k == "alert" and alertSettings or win; t[f] = v; for _, fn in ipairs(listeners) do fn() end end,
    TrustedOnly = function() return true end, OnChange = function(_, fn) listeners[#listeners+1] = fn end,
    List = function() return {} end, ListStyle = function() return "grouped" end, ListDifficulty = function() return "All" end, ListFolded = function() return false end, SetListFolded = function() end, SetListDifficulty = function() end, SetListStyle = function() end, DifficultyGroup = function() return "Other" end, DIFFICULTIES = { "Mythic", "Heroic", "Normal" }, ShortName = function(n) return n end, ViaLabel = function(v) return v end, SourceLabel = function() return nil end, Active = function() return nil end, Get = function() return nil end, Personal = function() return "my note" end,
  },
  NoteEngine = { running = false, PeekNextPhase = function() return nil end },
  Alerts = { Settings = function() return alertsDb end },
  AlertBars = { Refresh = function() barRefreshes = barRefreshes + 1 end, Test = function() barTests = barTests + 1 end },
  NoteComm = { Sharing = function() return nil end },
  NoteWindow = { FONTS = { { name = "Friz Quadrata" } } },
}
assert(load(settingsSrc, "Settings.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock()
pages.notes(pf)
pf:Show()
print("notes tab built, frames and strings so far: " .. created)
CRT.NotesPage.Open("settings")
print("settings tab built, total: " .. created)
-- The Alerts column keeps the timing and voice rows, as sliders and a dropdown.
for _, label in ipairs({ "Show it early by", "Count down seconds", "Speech volume" }) do assert(sliderLabels[label], "keeps " .. label) end
-- The switches and the alert areas moved to the Alerts tab.
for _, label in ipairs({ "Bars at once", "Show bars from", "Bar width", "Bar height" }) do assert(not sliderLabels[label], label .. " is not here") end
for _, f in ipairs(allFrames) do
  assert(not (f.kind == "Button" and rawget(f, "text") == "Previews"), "no Previews button")
  assert(not (f.kind == "Button" and rawget(f, "text") == "Test bars"), "no Test bars button")
end
-- Greying follows the switches, now set on the Alerts tab.
local early, volume = sliderLabels["Show it early by"], sliderLabels["Speech volume"]
assert(early.enabledIf() == true and volume.enabledIf() == true)
alertSettings.enabled = false alertSettings.tts = false
assert(early.enabledIf() == false and volume.enabledIf() == false, "greyed while off")
alertSettings.enabled = true alertSettings.tts = true
local checks = 0
for _, f in ipairs(allFrames) do if f.kind == "CheckButton" then checks = checks + 1 end end
-- 3 windows (Show, Locked) + Hide lines once passed + Show only me + the sharing switch
assert(checks == 13, "checkboxes (12 settings, and Display my notes first on the Notes tab): " .. checks)
print("ok alerts column keeps timing and voice")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2], 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[3], 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }

