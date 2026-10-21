// Builds CRT_Modules/Late/Page.lua on mock frames with two saved nights and prints the totals table rows.
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, pageSrc = ...
local strings = {}
local function mock()
  local m = { shown = false }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function() local x = mock() strings[#strings+1] = x return x end end
    if k == "CreateTexture" then return function() return mock() end end
    if k == "SetText" then return function(self, s) self.text = s end end
    if k == "Show" then return function(self) self.shown = true if rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "HasFocus" then return function() return false end end
    if k == "GetWidth" then return function() return 378 end end
    if k == "GetStringHeight" then return function() return 14 end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    if k == "SetPoint" then return function(self, p, x, y) if type(x) == "number" then rawset(self, "x", x) rawset(self, "y", y) end end end
    return function() end end })
end
function CreateFrame() return mock() end
format = string.format
date = os.date
time = function(t) if t then return os.time(t) end return os.time({ year = 2026, month = 10, day = 14, hour = 23, min = 0 }) end
function IsInGroup() return false end
C_Timer = { After = function() end, NewTicker = function() end }
RAID_CLASS_COLORS = {}
local pages = {}
local CRT = { db = { late = { days = {}, hour = 20, minute = 0, grace = 0, history = {}, nextId = 3, lastAuto = "" } },
  UI = { SlotGrid = function() local g = { slots = {}, labels = {}, blockH = 143, slotW = 188 } for i = 1, 40 do local b = mock() rawset(b, "index", i) rawset(b, "icon", mock()) rawset(b, "text", mock()) rawset(b, "right", mock()) g.slots[i] = b end return g end, FitText = function() end, GoodText = function(t) return t end, ClipText = function() return mock() end, PAGE_W = 1026, PAGE_H = 560, Help = function() return mock() end, Dropdown = function(_, _, o) local m = mock() rawset(m, "refresh", function() if o.enabledIf then rawset(m, "enabled", o.enabledIf() and true or false) end end) return m end, Slider = function(_, _, o) local m = mock() rawset(m, "refresh", function() if o.enabledIf then rawset(m, "enabled", o.enabledIf() and true or false) end end) return m end,  RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, RegisterTab = function() end, SetTabSelected = function() end, SkinTree = function() end, SkinScrollBar = function() end, SetFrameTitle = function() end },
  Groups = { NUM_SLOTS = 40, Active = function() return nil end, Find = function() return nil end, OnChange = function() end, ReportName = function(k) return (k:gsub("%-.*", "")) end, Normalize = function(k) return k end, ReadRoster = function() return {} end, ClassColor = function() return 1, 1, 1 end, Display = function(k) return k end, Presets = function() return {} end, Find = function() return nil end, OnChange = function() end },
}
function CRT:Print(m) print(m) end
CRT_THEME(CRT, CRT.UI)
local function at(h, m) return os.time({ year = 2026, month = 10, day = 14, hour = h, min = m }) end
CRT.db.late.history = {
  { id = 1, startedAt = at(20, 0), endedAt = at(22, 0), how = "schedule", endReason = "disband", layout = "Main", grace = 0,
    players = { { key = "Balevolence-Stormrage", joinedAt = at(20, 14) }, { key = "Abu-Kel'Thuzad", never = true }, { key = "Gadios-Silvermoon", joinedAt = at(20, 0) } } },
  { id = 2, startedAt = at(20, 0), endedAt = at(21, 0), how = "button", endReason = "button", layout = "Main", grace = 0,
    players = { { key = "Balevolence-Stormrage", joinedAt = at(20, 5) }, { key = "Gadios-Silvermoon", joinedAt = at(20, 0) } } },
}
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock()
pages.late(pf)
pf:Show()
-- Print the totals table: strings created after the page's own, grouped by y.
local rows = {}
for _, s in ipairs(strings) do
  local y = rawget(s, "y")
  if s.shown and y and y <= -24 and type(rawget(s, "text")) == "string" then
    rows[y] = rows[y] or {}
    table.insert(rows[y], (rawget(s, "x") or 0) .. ":" .. s.text)
  end
end
local ys = {} for y in pairs(rows) do ys[#ys+1] = y end table.sort(ys, function(a, b) return a > b end)
for _, y in ipairs(ys) do print(y, table.concat(rows[y], " | ")) end
-- The no-show count is the theme's bad colour, and follows a live switch (the page in view refreshes on a switch).
local function noShowCell()
  for _, s in ipairs(strings) do
    local t = rawget(s, "text")
    if s.shown and type(t) == "string" and t:find("^|cff%x%x%x%x%x%x1|r$") then return t end
  end
end
local fails = 0
local function check(ok, what) if ok then print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
check(noShowCell() == "|cffff20201|r", "Default: Blizzard: the no-show count is the game's red: " .. tostring(noShowCell()))
CRT.UI.SwitchTheme("nitro")
pf:Show()
check(noShowCell() == "|cffff7f6b1|r", "Nitro: the no-show count follows the switch: " .. tostring(noShowCell()))
CRT.UI.SwitchTheme("blizzard")
if fails > 0 then error(fails .. " late page checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2], 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[3], 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
