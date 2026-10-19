// UI/Panel.lua's UI.PanelButton, UI/Window.lua's title bar badge and LootMaster/Tabs.lua's item tabs, with stand-in frames that remember
// what was set on them. Usage: node run_lootmaster_ui.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, windowSrc, tabsSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local function near(c, want) return c and math.abs(c[1] - want[1]) < 0.001 and math.abs(c[2] - want[2]) < 0.001 and math.abs(c[3] - want[3]) < 0.001 end

-- a stand-in frame: every method works; the ones read back here keep their values
local function mock()
  local o = { shown = true }
  local methods = {
    CreateTexture = function() return mock() end,
    CreateFontString = function() return mock() end,
    SetText = function(self, t) self.text = t end,
    GetText = function(self) return self.text end,
    GetStringWidth = function(self) return #(self.text or "") * 6 end,
    SetTextColor = function(self, r, g, b) self.color = { r, g, b } end,
    SetBackdropColor = function(self, r, g, b) self.bg = { r, g, b } end,
    SetBackdropBorderColor = function(self, r, g, b) self.edge = { r, g, b } end,
    Show = function(self) self.shown = true end,
    Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end,
    IsShown = function(self) return self.shown end,
    GetFrameLevel = function() return 1 end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetScript = function(self, k, fn) local t = rawget(self, "scripts") or {} rawset(self, "scripts", t) t[k] = fn end,
  }
  return setmetatable(o, { __index = function(_, k) return methods[k] or function() end end })
end
CreateFrame = function(kind, name, parent, template)
  local f = mock()
  if template == "UIPanelButtonTemplate" then
    -- the template's end caps and its button text
    f.Left, f.Middle, f.Right, f.label = mock(), mock(), mock(), mock()
    f.crtSkin = false -- not skinned yet (every other unknown key is a no-op method)
    f.SetText = function(self, t) self.label.text = t end
    f.GetFontString = function(self) return self.label end
    f.GetObjectType = function() return "Button" end
  end
  return f
end
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end
C_Item = { GetItemIconByID = function() return 134400 end }
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
RAID_CLASS_COLORS = { MAGE = { r = 0.25, g = 0.78, b = 0.92 } }
local CRT = { LootMaster = {}, db = { ui = { modern = true } } }
CRT.MOCHA = { roast = { 0.165, 0.122, 0.098 }, edge = { 0.30, 0.235, 0.188 }, caramel = { 0.78, 0.56, 0.36 }, cream = { 0.95, 0.90, 0.84 } }
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(windowSrc, "Window.lua"))("CowfeeRaidTools", CRT)
assert(load(tabsSrc, "Tabs.lua"))("CowfeeRaidTools", CRT)
local UI, LM = CRT.UI, CRT.LootMaster
local STRIP = UI.TITLE_STRIP

-- a panel button outside a panel page: sized from its label, skinned so it follows the look
local before = #UI.skinned
local clicked = false
local pb = UI.PanelButton(mock(), "Everyone's answers", 18, function() clicked = true end)
eq(pb.label.text, "Everyone's answers", "panel button: its label")
eq(pb.w, 18 * 6 + 2 * UI.PANEL_BUTTON_PAD, "panel button: the label's width plus both end caps")
eq(pb.h, 18, "panel button: the height asked for")
eq(#UI.skinned, before + 1, "panel button: added to UI.skinned, so switching the look updates it")
eq(UI.skinned[#UI.skinned], pb, "panel button: the one skinned")
check(type(pb.crtSkin) == "function", "panel button: has the skin switch")
pb.scripts.OnClick()
check(clicked, "panel button: the click runs")
eq(UI.PanelButton(mock(), "x", 18).w, UI.PANEL_BUTTON_MIN_W, "panel button: a short label gets the minimum width")

-- the badge: the old call is unchanged, a colour makes it the neutral boss badge
local s = UI.TitleStrip(mock(), 24)
s:SetBadge("TEST", "nothing is passed")
eq(s.badge.text.text, "TEST", "badge: the text")
eq(s.note.text, "nothing is passed", "badge: the note")
check(s.badge.shown, "badge: shown")
check(near(s.badge.bg, STRIP.badgeBg) and near(s.badge.edge, STRIP.badgeEdge) and near(s.badge.text.color, STRIP.badgeText), "badge: no colour keeps the orange TEST badge")
s:SetBadge("Plexus Sentinel", nil, STRIP.neutral)
eq(s.badge.text.text, "Plexus Sentinel", "badge: a boss's name")
check(near(s.badge.bg, STRIP.neutral.bg) and near(s.badge.edge, STRIP.neutral.edge) and near(s.badge.text.color, STRIP.neutral.text), "badge: the neutral colours")
check(not near(STRIP.neutral.text, STRIP.badgeText), "badge: neutral text is not the TEST colour")
eq(s.note.text, "", "badge: no note")
s:SetBadge("TEST", "again")
check(near(s.badge.bg, STRIP.badgeBg) and near(s.badge.text.color, STRIP.badgeText), "badge: TEST after a boss is orange again")
s:SetBadge(nil)
check(not s.badge.shown and not s.note.shown, "badge: nothing hides it")

-- the item tabs: "X/Y answered", orange when the time ran out with answers missing
local tabs = LM.ItemTabs(mock(), {})
local counts = { { 3, 5, false }, { 3, 5, true }, { 5, 5, true }, { 0, 0, false } }
local items = { { itemString = "item:1" }, { itemString = "item:2" }, { itemString = "item:3" }, { itemString = "item:4" }, { itemString = "item:5", award = { name = "Quick-Sargeras" } } }
tabs:Update(items, 1, function(i) return counts[i][1], counts[i][2], counts[i][3] end, function() return "MAGE" end)
eq(tabs.tabs[1].name.text, "3/5 answered", "tabs: X/Y")
check(not near(tabs.tabs[1].name.color, LM.TAB_LATE_COLOR), "tabs: time left is the normal colour")
eq(tabs.tabs[2].name.text, "3/5 answered", "tabs: X/Y when late")
check(near(tabs.tabs[2].name.color, LM.TAB_LATE_COLOR), "tabs: time out with answers missing is orange")
eq(tabs.tabs[3].name.text, "5/5 answered", "tabs: everyone")
check(not near(tabs.tabs[3].name.color, LM.TAB_LATE_COLOR), "tabs: everyone answered is the normal colour")
eq(tabs.tabs[4].name.text, "0/0 answered", "tabs: nobody with CRT yet")
eq(tabs.tabs[5].name.text, "Quick", "tabs: a given item shows its winner")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['UI/Panel.lua', 'UI/Window.lua', 'LootMaster/Tabs.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
