// CRT_Modules/Groups/Data.lua and CRT_Modules/Groups/Page.lua on mock frames: the "In group, not in layout" list.
// usage: node run_groups_extras.js <addon folder>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv[2]) + `
local dataSrc, pageSrc = ...
local buttons = {}
local function mock(kind)
  local m = { shown = true, kind = kind }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock("r") end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") or "" end end
    if k == "Show" then return function(self) rawset(self, "shown", true) end end
    if k == "Hide" then return function(self) rawset(self, "shown", false) end end
    if k == "SetShown" then return function(self, on) rawset(self, "shown", on and true or false) end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "IsMouseOver" then return function(self) return rawget(self, "over") or false end end
    if k == "HasFocus" then return function() return false end end
    if k == "SetBackdropBorderColor" then return function(self, r, g, b) rawset(self, "border", { r, g, b }) end end
    if k == "SetFrameStrata" then return function(self, s) rawset(self, "strata", s) end end
    return function() end end })
end
local frames = {}
function CreateFrame(kind, name) local m = mock(kind) frames[#frames + 1] = m if kind == "Button" then buttons[#buttons + 1] = m end return m end
UIParent = mock()
format = string.format
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
C_Timer = { After = function() end }
GetNormalizedRealmName = function() return "Area52" end
Ambiguate = function(k) return (k:gsub("%-Area52$", "")) end
RAID_CLASS_COLORS = setmetatable({}, { __index = function() return { r = 1, g = 1, b = 1 } end })
UnitGroupRolesAssigned = function() return "DAMAGER" end
UnitIsUnit = function() return false end
IsInRaid = function() return true end
local raid = { { "Solex", 1, "MAGE" }, { "Abu-KelThuzad", 1, "SHAMAN" }, { "Balevolence", 2, "MONK" }, { "Newguy", 3, "PALADIN" } }
GetNumGroupMembers = function() return #raid end
GetRaidRosterInfo = function(i) local r = raid[i] return r[1], nil, r[2], nil, nil, r[3] end
GetCursorPosition = function() return 0, 0 end
local CRT = { db = { groups = { presets = {}, nextId = 1, keepChanges = false, source = "raid", working = {} }, classCache = {}, roleCache = {}, ui = {} } }
function CRT:Print(m) print("  [chat] " .. m) end
local pages = {}
CRT.UI = { SkinScrollBar = function() end, SlotGrid = function() local g = { slots = {}, labels = {}, blockH = 143, slotW = 188 } for i = 1, 40 do local b = mock() rawset(b, "index", i) rawset(b, "icon", mock()) rawset(b, "text", mock()) rawset(b, "right", mock()) g.slots[i] = b end return g end, FitText = function() end, GoodText = function(t) return t end, ClipText = function() return mock() end, PAGE_W = 1026, PAGE_H = 560, Help = function() return mock() end, RegisterPage = function(_, k, t, fn) pages[k] = fn end }
CRT_THEME(CRT, CRT.UI)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local G = CRT.Groups
local w = G:Working()
w[1] = "Solex-Area52" w[2] = "Abu-KelThuzad" w[6] = "Gadios-Area52"
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock()
pages.groups(pf)
pf.OnShow(pf)
local function extras()
  local out = {}
  for _, b in ipairs(buttons) do if rawget(b, "entry") and b.shown then out[#out + 1] = b.text.text .. " " .. b.group.text end end
  return out
end
print("not in layout: " .. table.concat(extras(), ", "))
-- Click Balevolence (raid group 2): goes to the first empty slot of group 2 (slot 7, since 6 is Gadios).
for _, b in ipairs(buttons) do if rawget(b, "entry") and b.entry.key:find("Balevolence") then b:OnClick() break end end
print("after click: slot 7 = " .. w[7] .. "; list: " .. table.concat(extras(), ", "))
-- Drag Newguy onto slot 1 (Solex): replaces Solex, who then shows in the list.
local row
for _, b in ipairs(buttons) do if rawget(b, "entry") and b.shown and b.entry.key:find("Newguy") then row = b end end
row:OnDragStart()
-- The drag ghost's edge is the theme's heading colour and follows a live switch.
local ghost
for _, f in ipairs(frames) do if rawget(f, "strata") == "TOOLTIP" then ghost = f end end
local function near(c, r, g, b) return c and math.abs(c[1] - r) < 0.003 and math.abs(c[2] - g) < 0.003 and math.abs(c[3] - b) < 0.003 end
local themeFails = 0
local function check(ok, what) if ok then print("ok " .. what) else themeFails = themeFails + 1 print("FAIL " .. what) end end
check(ghost and near(rawget(ghost, "border"), 1, 0.82, 0), "Default: Blizzard: the drag ghost's edge is the game's gold")
CRT.UI.SwitchTheme("cowfee")
check(ghost and near(rawget(ghost, "border"), 0xD9 / 255, 0xB4 / 255, 0x8A / 255), "Beanworks: Cowfee: the drag ghost's edge follows the switch")
CRT.UI.SwitchTheme("blizzard")
if themeFails > 0 then error(themeFails .. " groups theme checks failed") end
`;
const tail = `
for _, b in ipairs(buttons) do if rawget(b, "index") == 1 then rawset(b, "over", true) end end
row:OnDragStop()
print("after drag onto slot 1: slot 1 = " .. w[1] .. "; list: " .. table.concat(extras(), ", "))
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness + tail)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Data.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Groups/Page.lua', 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
