// CRT_Core/UI/Panel.lua's UI.PanelButton, CRT_Core/UI/Window.lua's title bar badge and CRT_Modules/LootMaster/Tabs.lua's item tabs, with stand-in frames that remember
// what was set on them. Usage: node run_lootmaster_ui.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, windowSrc, tabsSrc, popupSrc = ...
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
    GetText = function(self) return rawget(self, "text") end,
    GetStringWidth = function(self) local t = rawget(self, "text") return #(type(t) == "string" and t or "") * 6 end,
    SetTextColor = function(self, r, g, b) self.color = { r, g, b } end,
    SetBackdropColor = function(self, r, g, b) self.bg = { r, g, b } end,
    SetBackdropBorderColor = function(self, r, g, b) self.edge = { r, g, b } end,
    SetAlpha = function(self, a) self.alpha = a end,
    Show = function(self) self.shown = true end,
    Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end,
    IsShown = function(self) return self.shown end,
    GetFrameLevel = function() return 1 end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetScript = function(self, k, fn) local t = rawget(self, "scripts") or {} rawset(self, "scripts", t) t[k] = fn end,
    GetScript = function(self, k) local t = rawget(self, "scripts") return t and t[k] end,
    SetWidth = function(self, w) self.w = w end,
    GetWidth = function(self) return rawget(self, "w") end,
    SetFontObject = function(self, f) self.font = f end,
    SetAtlas = function(self, a) self.atlas = a end,
    ClearAllPoints = function(self) self.points = {} end,
    SetPoint = function(self, ...) local t = rawget(self, "points") or {} rawset(self, "points", t) t[#t + 1] = { ... } end,
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
  if template == "BasicFrameTemplateWithInset" then f.CloseButton = mock() end
  return f
end
-- the game's font objects the title strip uses, and CRT's
GameFontNormal = { GetTextColor = function() return 1, 0.82, 0 end }
CRTFontLarge = { GetTextColor = function() return 1, 0.82, 0 end }
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end
C_Item = { GetItemIconByID = function() return 134400 end }
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
RAID_CLASS_COLORS = { MAGE = { r = 0.25, g = 0.78, b = 0.92 } }
local CRT = { LootMaster = {}, db = { ui = { modern = true, layers = {} } } }
CRT.MOCHA = { roast = { 0.165, 0.122, 0.098 }, edge = { 0.30, 0.235, 0.188 }, caramel = { 0.78, 0.56, 0.36 }, cream = { 0.95, 0.90, 0.84 },
  espresso = { 0.11, 0.078, 0.063 }, latte = { 0.87, 0.73, 0.56 }, stripTop = { 0.35, 0.25, 0.17 }, stripBottom = { 0.23, 0.17, 0.12 }, note = { 0.8, 0.71, 0.6 } }
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(windowSrc, "Window.lua"))("CowfeeRaidTools", CRT)
assert(load(tabsSrc, "Tabs.lua"))("CowfeeRaidTools", CRT)
local itemInfo = {}
CRT.LootMaster.OnChange = function() end
C_Item.GetItemInfoInstant = function(s) local i = itemInfo[s] or {} return 1, "", i.sub, i.loc, 0, i.class, i.subclass end
INVTYPE_WAIST, MISCELLANEOUS, INVTYPE_NON_EQUIP_IGNORE = "Waist", "Miscellaneous", ""
UIParent = mock()
assert(load(popupSrc, "Popup.lua"))("CowfeeRaidTools", CRT)
local UI, LM = CRT.UI, CRT.LootMaster
local STRIP = UI.TITLE_STRIP
-- a STRIP colour as { r, g, b }: a CRT.MOCHA key (the theme) or a colour of its own
local function col(c) return { UI.StripColor(c) } end

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

-- the header button: the game's red button in Classic, the Reset look in Modern; an icon in both
local function look(name)
  CRT.db.ui.modern = name == "modern"
  for _, c in ipairs(UI.skinned) do c.crtSkin(CRT.db.ui.modern) end
end
local function sized(btn, what, w, h)
  eq(btn.w, w, what .. ": width") eq(btn.h, h, what .. ": height")
end
local CAPS, PAD = UI.PANEL_BUTTON_PAD, UI.HEADER_BUTTON_PAD
look("classic")
local hb = UI.HeaderButton(mock(), "All Loot Rolls", function() clicked = false end)
local lw = 14 * 6
sized(hb, "header classic", lw + 2 * CAPS, 20)
eq(hb.Left.alpha, 1, "header classic: template art shown")
look("modern")
sized(hb, "header modern", lw + 2 * PAD, 20)
eq(hb.Left.alpha, 0, "header modern: template art hidden")
-- the label can change: the width follows it
hb:SetLabel("Rolls")
sized(hb, "header relabelled", math.max(44, 5 * 6 + 2 * PAD), 20)
eq(hb.label.text, "Rolls", "header relabelled: its text")
look("classic")
sized(hb, "header relabelled classic", 5 * 6 + 2 * CAPS, 20)
hb:SetLabel("All Loot Rolls")
look("modern")
sized(UI.HeaderButton(mock(), "Go", function() end), "short header", 44, 20)
-- a button made while Modern is on is already Modern
local early = UI.HeaderButton(mock(), "Go", function() end)
eq(early.Left.alpha, 0, "header: made in Modern, flat at once")
-- the icon: a texture path or an atlas, kept in every look; an unknown value shows none
local ib = UI.HeaderButton(mock(), "Rolls", function() end, { icon = "icon-file" })
local ab = UI.HeaderButton(mock(), "Rolls", function() end, { icon = { atlas = "some-atlas" } })
check(UI.HeaderButton(mock(), "Rolls", function() end, { icon = 5 }).icon ~= nil and type(UI.HeaderButton(mock(), "R", function() end, { icon = 5 }).icon) ~= "table", "header button: an unknown icon shows none")
for _, name in ipairs({ "classic", "modern" }) do
  look(name)
  local caps = name == "classic" and CAPS or PAD
  sized(ib, "icon " .. name, 45 + 2 * caps, 20)
  check(ib.icon and ib.icon.shown and ab.icon and ab.icon.shown, "header button icon kept in " .. name)
end
hb.scripts.OnClick()
check(not clicked, "header button: the click runs")
-- Reset on a handle stays small: 16 flat, 18 in Classic, and it re-sizes when the look changes
look("classic")
local rb = UI.ResetButton(mock(), function() end)
sized(rb, "reset classic", 30 + 2 * CAPS, 18)
look("modern")
sized(rb, "reset modern", math.max(44, 30 + 2 * PAD), 16)
eq(rb.label.text, "Reset", "reset button: its label")
check(type(rb.scripts.OnEnter) == "function", "reset button: keeps its tooltip")
eq(UI.ResetButtonWidth(), 30 + 2 * CAPS, "reset width: the widest look")

-- the popup's detail line
LM.MyGear = function() return {} end
itemInfo.waist = { sub = "Leather", loc = "INVTYPE_WAIST", class = 4, subclass = 2 }
itemInfo.junk = { sub = "Junk", loc = "INVTYPE_NON_EQUIP_IGNORE", class = 15, subclass = 0 }
local junk = LM.DetailText({ itemString = "junk", ilvl = 75 })
check(not junk:find("^, ") and not junk:find(", Junk") and not junk:find("You have"), "detail: junk has no slot text and no 'You have' (" .. junk .. ")")
itemInfo.bag = { sub = "Bag", loc = "INVTYPE_NON_EQUIP_IGNORE", class = 1, subclass = 0 }
local bag = LM.DetailText({ itemString = "bag", ilvl = 20 })
check(bag:find("Bag", 1, true) and not bag:find(", Bag") and not bag:find("You have"), "detail: a no-slot item shows its subtype alone (" .. bag .. ")")
local waist = LM.DetailText({ itemString = "waist", ilvl = 318 })
check(waist:find("Waist, Leather", 1, true) and waist:find("You have: nothing in that slot", 1, true), "detail: a normal item is unchanged (" .. waist .. ")")

-- the badge: the old call is unchanged, a colour makes it the neutral boss badge
local s = UI.TitleStrip(mock(), 24)
s:SetBadge("TEST", "nothing is passed")
eq(s.badge.text.text, "TEST", "badge: the text")
eq(s.note.text, "nothing is passed", "badge: the note")
check(s.badge.shown, "badge: shown")
check(near(s.badge.bg, STRIP.badgeBg) and near(s.badge.edge, STRIP.badgeEdge) and near(s.badge.text.color, STRIP.badgeText), "badge: no colour keeps the orange TEST badge")
s:SetBadge("Plexus Sentinel", nil, STRIP.neutral)
eq(s.badge.text.text, "Plexus Sentinel", "badge: a boss's name")
check(near(s.badge.bg, col(STRIP.neutral.bg)) and near(s.badge.edge, col(STRIP.neutral.edge)) and near(s.badge.text.color, col(STRIP.neutral.text)), "badge: the neutral colours")
check(near(col(STRIP.neutral.bg), CRT.MOCHA.espresso) and near(col(STRIP.neutral.text), CRT.MOCHA.latte), "badge: neutral is the theme's espresso and latte")
check(not near(col(STRIP.neutral.text), STRIP.badgeText), "badge: neutral text is not the TEST colour")
eq(s.note.text, "", "badge: no note")
s:SetBadge("TEST", "again")
check(near(s.badge.bg, STRIP.badgeBg) and near(s.badge.text.color, STRIP.badgeText), "badge: TEST after a boss is orange again")
s:SetBadge(nil)
check(not s.badge.shown and not s.note.shown, "badge: nothing hides it")

-- the title strip per look. Classic is the main window's title bar (BasicFrameTemplate: GameFontNormal
-- centred at the frame's TOP -6, -4, the game's dark title tile, the badge at the left end); Modern the
-- espresso strip with the larger cream title on the left. A look switch re-styles a strip made earlier.
local function point(r) return r.points and r.points[#r.points] or {} end
look("classic")
local parent = mock()
local fs = UI.TitleStrip(parent, 24, { framed = true })
fs:SetWidth(600)
fs:SetTitle("Loot Master")
eq(fs.title.font, GameFontNormal, "classic: the main window's title font")
check(near(fs.title.color, { 1, 0.82, 0 }), "classic: the title font's own gold")
local p = point(fs.title)
check(p[1] == "TOP" and p[2] == parent and p[3] == "TOP" and p[4] == -6 and p[5] == -4, "classic framed: the title where the window template puts its own")
check(not fs.bg.shown and not fs.line.shown, "classic: no espresso strip or caramel line")
check(not fs.bar.shown, "classic framed: the window's own title bar shows, no second one")
fs:SetBadge("TEST", "nothing is passed")
p = point(fs.badge)
check(p[1] == "LEFT" and p[2] == fs and p[3] == "LEFT" and p[4] == STRIP.classicBadgeX, "classic: the badge at the left end, where the main window shows its version")
p = point(fs.note)
check(p[1] == "LEFT" and p[2] == fs.badge and p[3] == "RIGHT", "classic: the note after the badge")
eq(point(fs.title)[1], "TOP", "classic: a short badge leaves the title centred")
-- a badge too wide for the centred title pushes it right of the note
fs:SetWidth(200)
fs:SetBadge("A very long boss name here", "and a note")
p = point(fs.title)
check(p[1] == "LEFT" and p[2] == fs.note and p[3] == "RIGHT", "classic: a wide badge puts the title after the note, not under it")
-- a resize lays the strip out again (OnSizeChanged)
fs:SetWidth(600)
fs.scripts.OnSizeChanged(fs)
eq(point(fs.title)[1], "TOP", "classic: widened, the title is centred again")
fs:SetWidth(200)
fs.scripts.OnSizeChanged(fs)
p = point(fs.title)
check(p[1] == "LEFT" and p[2] == fs.note, "classic: narrowed, the title goes after the note")
fs:SetWidth(600)
fs.scripts.OnSizeChanged(fs)
eq(point(fs.title)[1], "TOP", "classic: widened again, centred")
fs:SetBadge(nil)
eq(point(fs.title)[1], "TOP", "classic: no badge, centred again")
-- a note with no badge still shows, at the left end
fs:SetBadge(nil, "all loot rolls, read only")
check(fs.note.shown and not fs.badge.shown, "badge: a note shows without a badge")
p = point(fs.note)
check(p[1] == "LEFT" and p[2] == fs and p[4] == STRIP.classicBadgeX, "classic: a note alone sits at the left end")
-- a strip of its own (the popup's): draws the game's title tile itself, title centred
local own = UI.TitleStrip(mock(), 26)
own:SetWidth(480)
check(own.bar.shown and own.bar.atlas == STRIP.classicBar, "classic own strip: the game's title tile")
eq(STRIP.classicBar, "_UI-Frame-TitleTileBg", "classic: the window template's title tile")
p = point(own.title)
check(p[1] == "CENTER" and p[2] == own, "classic own strip: the title centred")
-- Modern, by switching the look: both strips re-style
look("modern")
for _, st in ipairs({ fs, own }) do
  eq(st.title.font, CRTFontLarge, "modern: the larger title font")
  check(near(st.title.color, col(STRIP.title)) and near(st.title.color, CRT.MOCHA.cream), "modern: the cream title")
  check(st.bg.shown and st.line.shown and not st.bar.shown, "modern: the espresso strip and caramel line")
  p = point(st.title)
  check(p[1] == "LEFT" and p[2] == st and p[4] == 10, "modern: the title on the left")
end
fs:SetBadge("TEST", "x")
p = point(fs.badge)
check(p[1] == "LEFT" and p[2] == fs.title and p[3] == "RIGHT", "modern: the badge after the title")
fs:SetBadge(nil, "a note")
p = point(fs.note)
check(p[1] == "LEFT" and p[2] == fs.title and p[3] == "RIGHT", "modern: a note alone follows the title")
-- every UI.Window's strip lies on the window template's own title bar
UISpecialFrames, tinsert = {}, table.insert
local win = UI.Window("TestWindow", { kind = "popout", title = "Loot Master" })
check(win.strip.framed and win.strip.window == win, "window: its strip is framed by the window template")
eq(win.strip.title.text, "Loot Master", "window: the title")
p = point(win.reset)
check(p[1] == "RIGHT" and p[2] == win.CloseButton and p[4] == -4 and p[5] == 0, "window modern: Reset beside the close button")
-- and back to Classic
look("classic")
check(not win.strip.bar.shown and not win.strip.bg.shown, "window classic: only the template's title bar")
eq(win.strip.title.font, GameFontNormal, "window classic: the main window's title font")
p = point(win.reset)
check(p[1] == "RIGHT" and p[2] == win.CloseButton and p[4] == -4 and p[5] == 1, "window classic: Reset 1 higher, like Previews")
eq(fs.title.font, GameFontNormal, "classic again: the main window's title font")
check(near(fs.title.color, { 1, 0.82, 0 }), "classic again: gold")
check(not fs.bg.shown and own.bar.shown, "classic again: the strip art switches back")
look("modern")

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

-- the tooltip: only the icon has it, and it opens left of the window; clicks on the icon reach the tab
local winFrame = mock()
local got = {}
GameTooltip = { SetOwner = function(_, o, a) got.owner, got.anchor = o, a end, SetPoint = function(_, ...) got.pt = { ... } end,
  SetHyperlink = function() end, AddLine = function() end, Show = function() got.shown = true end, Hide = function() got.shown = false end }
local picked, dbl
local t2 = LM.ItemTabs(mock(), { window = winFrame, onSelect = function(i) picked = i end, onDoubleClick = function(i) dbl = i end })
t2:Update({ { itemString = "item:1" } }, 1, nil, nil)
local tb = t2.tabs[1]
check(tb.frame.scripts.OnEnter ~= nil, "tooltip: the icon has OnEnter")
check(tb.scripts.OnEnter == nil, "tooltip: the tab body has none")
tb.frame.scripts.OnEnter(tb.frame)
eq(got.anchor, "ANCHOR_NONE", "tooltip: placed by hand")
eq(got.pt[1], "TOPRIGHT", "tooltip: its right edge")
check(got.pt[2] == winFrame and got.pt[3] == "TOPLEFT", "tooltip: sits at the window's left")
tb.scripts.OnClick(tb, "LeftButton")
eq(picked, 1, "tab click selects")
picked = nil
tb.frame.scripts.OnClick(tb.frame, "LeftButton")
eq(picked, 1, "icon click selects the tab")
tb.frame.scripts.OnDoubleClick(tb.frame, "LeftButton")
eq(dbl, 1, "icon double-click reaches the tab")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Window.lua', 'CRT_Modules/LootMaster/Tabs.lua', 'CRT_Modules/LootMaster/Popup.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
