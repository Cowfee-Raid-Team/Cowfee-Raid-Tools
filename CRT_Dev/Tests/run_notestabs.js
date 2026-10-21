// Builds the Raid Notes page (CRT_Modules/Notes/Settings.lua and CRT_Modules/Notes/Page.lua) on mock frames and switches tabs.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local settingsSrc, pageSrc = ...
local created = 0
local allTexts = {}
local function mock()
  local m = { shown = false }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" or k == "CreateTexture" then return function() created = created + 1 return mock() end end
    if k == "SetText" then return function(self, s) self.text = s allTexts[tostring(s)] = true end end
    if k == "Show" then return function(self) self.shown = true if rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "HasFocus" then return function() return false end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    return function() end end })
end
function CreateFrame() created = created + 1 return mock() end
format = string.format
UIParent = mock()
UISpecialFrames = {}
tinsert = table.insert
CANCEL = "Cancel"
ChatFontNormal = {}
local pages = {}
local builtTabs = {}
local listeners = {}
local alertSettings = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100 }
local win = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata", hidePassed = true, onlyMe = false }
local CRT = {
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end },
  UI = { PAGE_W = 1026, PAGE_H = 560, SkinScrollBar = function() end, Help = function() return mock() end, Dropdown = function(_, _, o) local m = mock() rawset(m, "refresh", function() if o.enabledIf then rawset(m, "enabled", o.enabledIf() and true or false) end end) return m end, Slider = function(_, _, o) local m = mock() rawset(m, "refresh", function() if o.enabledIf then rawset(m, "enabled", o.enabledIf() and true or false) end end) return m end,  RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end, SetFrameTitle = function() end, RegisterTab = function() end, SetTabSelected = function() end },
  Notes = {
    CanEditRaid = function() return true end, -- CRT_Modules/Notes/Data.lua: solo, you may change the raid note
    WindowSettings = function() return win end, Alert = function() return alertSettings end, Set = function(_, k, f, v) end,
    TrustedOnly = function() return true end, ShowOutsideRaid = function() return true end, OnChange = function(_, fn) listeners[#listeners+1] = fn end,
    List = function() return {} end, ListStyle = function() return "grouped" end, ListDifficulty = function() return "All" end, ListFolded = function() return false end, SetListFolded = function() end, SetListDifficulty = function() end, SetListStyle = function() end, DifficultyGroup = function() return "Other" end, DIFFICULTIES = { "Mythic", "Heroic", "Normal" }, ShortName = function(n) return n end, ViaLabel = function(v) return v end, SourceLabel = function() return nil end, Active = function() return nil end, Get = function() return nil end, Personal = function() return "my note" end,
  },
  Alerts = { Settings = function() return { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 } } end },
  AlertBars = { Refresh = function() end, Test = function() end },
  NoteReminders = { Build = function() builtTabs[#builtTabs + 1] = 'reminders' end },
  NotePhases = { Build = function() builtTabs[#builtTabs + 1] = 'phases' end },
  NoteEngine = { running = false, PeekNextPhase = function() return nil end },
  NoteAlertsTab = { Build = function() builtTabs[#builtTabs + 1] = 'alerts' end, Select = function() end },
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
CRT.NotesPage.Open("reminders")
CRT.NotesPage.Open("phases") -- no Phases tab any more: falls back to Notes, builds nothing
CRT.NotesPage.Open("alerts")
assert(table.concat(builtTabs, ",") == "reminders,alerts", "four tabs built by name, no Phases")
assert(allTexts["Notes Settings"] and not allTexts["Settings"], "the settings tab is named Notes Settings")
CRT.NotesPage.Open("notes")
for _, fn in ipairs(listeners) do fn() end
print("refresh ok, listeners: " .. #listeners)
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2], 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[3], 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
