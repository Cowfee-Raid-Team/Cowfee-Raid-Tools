// CRT_Modules/LootMaster/Window.lua (the looter window) and RaiderWindow.lua (All Loot Rolls), built on stand-in frames:
// each window's column headings and rows sit in one frame that clips its children (LM.ListArea in Tabs.lua), so a
// narrow window cuts them off at the same edge; the columns keep their x; the scroll bar is outside the clipped frame.
// Usage: node run_lootmaster_windows.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local tabsSrc, winSrc, raiderSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end

wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
C_Item = { GetItemIconByID = function() return 1 end, GetItemInfo = function() return "Item", "[Item]" end }
C_Timer = { NewTicker = function() return { Cancel = function() end } end }
CreateDataProvider = function(rows) return rows end
ScrollBoxConstants = {}

-- stand-in frames: every method works; the ones read back here keep what they were given
local made = {}
local helped = {} -- every (?) UI.HelpRight made, in order
local function mock(kind, parent, template)
  local o = { kind = kind, parent = parent, template = template, points = {}, scripts = {}, shown = false, regions = {} }
  local m = {
    SetPoint = function(self, ...) self.points[#self.points + 1] = { ... } end,
    ClearAllPoints = function(self) self.points = {} end,
    SetClipsChildren = function(self, on) self.clips = on end,
    CreateTexture = function(self) local t = mock("Texture", self) return t end,
    CreateFontString = function(self) local t = mock("FontString", self) self.regions[#self.regions + 1] = t return t end,
    SetText = function(self, v) self.text = v end,
    GetText = function(self) return self.text end,
    Show = function(self) self.shown = true end,
    Hide = function(self) self.shown = false end,
    IsShown = function(self) return self.shown end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    HookScript = function(self, k, fn) self.scripts[k] = fn end,
    GetFrameLevel = function() return 1 end,
  }
  return setmetatable(o, { __index = function(_, k)
    if m[k] then return m[k] end
    if type(k) == "string" and k:match("^%u") then return function() end end
  end })
end
CreateFrame = function(kind, name, parent, template)
  local f = mock(kind, parent, template)
  made[#made + 1] = f
  return f
end
CreateScrollBoxListLinearView = function() return mock("View") end
ScrollUtil = { InitScrollBoxListWithScrollBar = function() end }

-- the UI helpers the windows call, recording what they were given
local sortParent, sortOpts
local CRT = { db = { lootmaster = { window = {}, answers = {}, sort = {} } }, PALETTE = { accent = { 1, 1, 1 }, border = { 1, 1, 1 }, text = { 1, 1, 1 } } }
CRT.UI = {
  ContextMenu = function() end,
  SkinScrollBar = function() end,
  Window = function(name) local w = mock("Frame", nil) w.name = name w.content = mock("Frame", w)
    w.strip = { SetTitle = function() end, SetBadge = function() end } return w end,
  HelpRight = function(target, title, text, opts) local b = (function(parent) return mock("Button", parent) end)(opts and opts.parent or target, title, text) rawset(b, "helpTarget", target) helped[#helped + 1] = b return b end, HELP_GAP = 4, HELP_SIZE = 20, Help = function(parent) return mock("Button", parent) end,
  HeaderButton = function(parent) return mock("Button", parent) end,
  SortHeaders = function(parent, cols, opts) sortParent, sortOpts = parent, opts return { refresh = function() end } end,
  OnTheme = function() end,
  GoodText = function(t) return t end,
  TITLE_STRIP = { neutral = {} },
}
local handlers = {}
CRT.LootMaster = {
  OnChange = function(_, fn) handlers[#handlers + 1] = fn end,
  Fire = function() end,
  Me = function() return "Solex" end,
  SortRows = function() end,
}
local LM = CRT.LootMaster
assert(load(tabsSrc, "Tabs.lua"))("CowfeeRaidTools", CRT)
LM.ItemTabs = function() return { Update = function() end } end -- the tabs have their own harness
assert(load(winSrc, "Window.lua"))("CowfeeRaidTools", CRT)
assert(load(raiderSrc, "RaiderWindow.lua"))("CowfeeRaidTools", CRT)

local function find(template, from)
  for i = from or 1, #made do if made[i].template == template then return made[i], i end end
end
local function hasPoint(f, want)
  for _, p in ipairs(f.points) do
    local same = true
    for i, v in ipairs(want) do if p[i] ~= v then same = false end end
    if same then return true end
  end
  return false
end

-- the looter window
local session = {
  test = true, items = { { itemString = "item:1" } }, players = {},
  AnswerCount = function() return 0, 0 end, Rows = function() return {} end, Response = function() return nil end,
}
LM.current = session
LM:ShowWindow()
local box = find("WowScrollBoxList")
local bar = find("MinimalScrollBar")
check(box ~= nil and bar ~= nil, "looter: has a scroll box and a scroll bar")
local area = box and box.parent
check(area and area.clips == true, "looter: the rows sit in a frame that clips its children")
check(sortParent == area, "looter: the column headings sit in the same clipping frame as the rows")
check(sortOpts and sortOpts.x == 0 and sortOpts.y == 0, "looter: the headings start at the clipping frame's top left")
check(bar and bar.parent ~= area and bar.parent and not bar.parent.clips, "looter: the scroll bar is outside the clipped frame")
check(bar and hasPoint(bar, { "TOPLEFT", box, "TOPRIGHT" }), "looter: the scroll bar sits right of the rows")
check(area and hasPoint(area, { "BOTTOMRIGHT", -LM.LIST_SCROLL_GAP, 0 }), "looter: the clipped frame leaves room for the scroll bar")
check(box and hasPoint(box, { "TOPLEFT", 0 }) and hasPoint(box, { "BOTTOMRIGHT", 0, 0 }), "looter: the rows fill the clipped frame under the headings")
check(#helped == 1 and helped[1].helpTarget.kind == "FontString", "looter: its one (?) is right of the item's name in the header")

-- All Loot Rolls
LM.incoming = { test = true, items = { { itemString = "item:1" } }, view = {
  AnswerCount = function() return 0, 0 end, Rows = function() return {} end, players = {}, Response = function() end } }
local before = #made
LM:ShowAnswers()
local rbox = find("WowScrollBoxList", before + 1)
local rbar = find("MinimalScrollBar", before + 1)
local rarea = rbox and rbox.parent
check(rarea and rarea.clips == true and rarea ~= area, "raider: the rows sit in their own clipping frame")
local titles = {}
for _, fs in ipairs(rarea and rarea.regions or {}) do if fs.text then titles[#titles + 1] = fs.text end end
check(#titles == 6 and titles[1] == "Name", "raider: the six column headings are in the clipping frame (got " .. #titles .. ")")
local fixed = true
for _, fs in ipairs(rarea and rarea.regions or {}) do
  local p = fs.points[1]
  if not (p and p[1] == "TOPLEFT" and type(p[2]) == "number" and p[3] == 0) then fixed = false end
end
check(fixed, "raider: each heading keeps its own x at the clipping frame's top")
check(rbar and rbar.parent ~= rarea and not rbar.parent.clips, "raider: the scroll bar is outside the clipped frame")
check(#helped == 2 and helped[2].helpTarget.kind == "FontString", "raider: its one (?) is right of the item's name in the header")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
let srcFails = 0;
for (const f of ['CRT_Modules/LootMaster/Window.lua', 'CRT_Modules/LootMaster/RaiderWindow.lua']) {
  if (/OnSizeChanged/.test(read(f))) { console.log('FAIL ' + f + ' reacts to a resize; columns should only clip'); srcFails++; }
  else console.log('ok ' + f + ': no resize code moves or hides columns');
}
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/LootMaster/Tabs.lua', 'CRT_Modules/LootMaster/Window.lua', 'CRT_Modules/LootMaster/RaiderWindow.lua']) lua.lua_pushstring(L, to_luastring(read(f)));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
if (srcFails > 0) process.exit(1);
