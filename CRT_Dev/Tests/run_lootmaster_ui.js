// CRT_Core/UI/Panel.lua's UI.PanelButton, CRT_Core/UI/Window.lua's title bar badge and CRT_Modules/LootMaster/Tabs.lua's item tabs, with stand-in frames that remember
// what was set on them. Usage: node run_lootmaster_ui.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, windowSrc, tabsSrc, popupSrc, dataSrc, gearSrc, tooltipSrc = ...
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
  if template == "BasicFrameTemplateWithInset" then
    -- a window: not styled yet (UI:StyleWindow), and it knows its parent (UIParent for a window of its own)
    f.CloseButton, f.crtArt = mock(), false
    f.GetParent = function() return parent end
  end
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
CRT.PALETTE = { surface = { 0.165, 0.122, 0.098 }, border = { 0.30, 0.235, 0.188 }, accent = { 0.78, 0.56, 0.36 }, text = { 0.95, 0.90, 0.84 },
  background = { 0.11, 0.078, 0.063 }, label = { 0.87, 0.73, 0.56 }, titleTop = { 0.35, 0.25, 0.17 }, titleBottom = { 0.23, 0.17, 0.12 }, muted = { 0.8, 0.71, 0.6 } }
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(tooltipSrc, "Tooltip.lua"))("CowfeeRaidTools", CRT)
assert(load(windowSrc, "Window.lua"))("CowfeeRaidTools", CRT)
assert(load(gearSrc, "Gear.lua"))("CowfeeRaidTools", CRT) -- the gear engine, before any module, as in the .toc
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT) -- first of Loot Master: it makes CRT.LootMaster
CRT.db.lootmaster = {}
CRT.LootMaster.Settings = function() return CRT.db.lootmaster end
assert(load(tabsSrc, "Tabs.lua"))("CowfeeRaidTools", CRT)
local itemInfo = {}
CRT.LootMaster.OnChange = function() end
C_Item.GetItemInfoInstant = function(s) local i = itemInfo[s] or {} return 1, "", i.sub, i.loc, 0, i.class, i.subclass end
INVTYPE_WAIST, MISCELLANEOUS, INVTYPE_NON_EQUIP_IGNORE = "Waist", "Miscellaneous", ""
UIParent = mock()
assert(load(popupSrc, "Popup.lua"))("CowfeeRaidTools", CRT)
local UI, LM = CRT.UI, CRT.LootMaster
local STRIP = UI.TITLE_STRIP
-- a STRIP colour as { r, g, b }: a CRT.PALETTE key (the theme) or a colour of its own
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
check(near(col(STRIP.neutral.bg), CRT.PALETTE.background) and near(col(STRIP.neutral.text), CRT.PALETTE.label), "badge: neutral is the theme's background and label")
check(not near(col(STRIP.neutral.text), STRIP.badgeText), "badge: neutral text is not the TEST colour")
eq(s.note.text, "", "badge: no note")
s:SetBadge("TEST", "again")
check(near(s.badge.bg, STRIP.badgeBg) and near(s.badge.text.color, STRIP.badgeText), "badge: TEST after a boss is orange again")
s:SetBadge(nil)
check(not s.badge.shown and not s.note.shown, "badge: nothing hides it")

-- the title strip per look. Classic is the main window's title bar (BasicFrameTemplate: GameFontNormal
-- centred at the frame's TOP -6, -4, the game's dark title tile, the badge at the left end); Modern the
-- background strip with the larger text-coloured title on the left. A look switch re-styles a strip made earlier.
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
check(not fs.bg.shown and not fs.line.shown, "classic: no background strip or accent line")
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
  check(near(st.title.color, col(STRIP.title)) and near(st.title.color, CRT.PALETTE.text), "modern: the text-coloured title")
  check(st.bg.shown and st.line.shown and not st.bar.shown, "modern: the background strip and accent line")
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

-- a window's saved place: one saved before the helper (any point, with its relativePoint, as the Timeline
-- pop-out kept it) loads as it was; the helper's saves are TOPLEFT to TOPLEFT, in the window's own units
local kept = { point = "CENTER", relativePoint = "BOTTOM", x = 10, y = 20, width = 900, height = 500 }
local pw = UI.Window("TestPlaced", { kind = "popout", saved = function() return kept end, width = 1200, height = 600, minWidth = 760, minHeight = 360 })
p = point(pw)
check(p[1] == "CENTER" and p[2] == UIParent and p[3] == "BOTTOM" and p[4] == 10 and p[5] == 20, "window: an old saved place loads as it was")
check(pw.w == 900 and pw.h == 500, "window: an old saved size loads as it was")
-- dragged on a window scaled to 80%: the screen's height is measured in the window's units
UIParent.GetHeight = function() return 1000 end
pw.GetLeft, pw.GetTop, pw.GetScale = function() return 100 end, function() return 700 end, function() return 0.8 end
pw.GetWidth, pw.GetHeight = function() return 1000.4 end, function() return 450 end
pw.scripts.OnDragStop(pw)
check(kept.point == "TOPLEFT" and kept.relativePoint == "TOPLEFT" and kept.x == 100 and math.abs(kept.y - (700 - 1000 / 0.8)) < 0.001, "window: saved TOPLEFT in its own units (got " .. tostring(kept.point) .. " " .. tostring(kept.relativePoint) .. " " .. tostring(kept.x) .. " " .. tostring(kept.y) .. ")")
check(kept.width == 1000 and kept.height == 450, "window: its size saved")
pw:Place()
p = point(pw)
check(p[1] == "TOPLEFT" and p[3] == "TOPLEFT" and p[4] == 100 and math.abs(p[5] + 550) < 0.001, "window: placed where it was saved")
-- a window that never kept a relativePoint does not get one
local plain = {}
local qw = UI.Window("TestPlain", { kind = "popout", saved = function() return plain end })
qw.GetLeft, qw.GetTop, qw.GetHeight = function() return 5 end, function() return 900 end, function() return 420 end
qw.scripts.OnDragStop(qw)
check(plain.point == "TOPLEFT" and plain.relativePoint == nil and plain.y == -100, "window: unscaled, no relativePoint added")
-- Reset forgets the place and size, the relativePoint too
pw.reset.scripts.OnClick(pw.reset)
check(kept.point == nil and kept.relativePoint == nil and kept.width == nil, "window: Reset forgets the saved place")
p = point(pw)
check(p[1] == "CENTER" and pw.w == 1200 and pw.h == 600, "window: Reset puts it in the middle at its default size")

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

-- the tooltip: only the icon has it; clicks on the icon reach the tab
local winFrame = mock()
local got = {}
GameTooltip = { SetOwner = function(_, o, a) got.owner, got.anchor = o, a end, SetPoint = function(_, ...) got.pt = { ... } end,
  ClearAllPoints = function() got.pt = nil got.cleared = true end, SetHyperlink = function() end, AddLine = function() end, Show = function() got.shown = true end, Hide = function() got.shown = false end }
local picked, dbl
local t2 = LM.ItemTabs(mock(), { window = winFrame, onSelect = function(i) picked = i end, onDoubleClick = function(i) dbl = i end })
t2:Update({ { itemString = "item:1" } }, 1, nil, nil)
local tb = t2.tabs[1]
check(tb.frame.scripts.OnEnter ~= nil, "tooltip: the icon has OnEnter")
check(tb.scripts.OnEnter == nil, "tooltip: the tab body has none")
tb.frame.scripts.OnEnter(tb.frame)
-- by default the item tabs are like every other Loot Master tooltip: no spot picked (auto), so next to the
-- icon, on the window's outer side, as before the picker
eq(got.owner, tb.frame, "tooltip: owned by the icon")
eq(got.anchor, "ANCHOR_LEFT", "tooltip: by default next to the icon, on the window's outer side")
check(got.pt == nil, "tooltip: by default not placed by hand")
tb.scripts.OnClick(tb, "LeftButton")
eq(picked, 1, "tab click selects")
picked = nil
tb.frame.scripts.OnClick(tb.frame, "LeftButton")
eq(picked, 1, "icon click selects the tab")
tb.frame.scripts.OnDoubleClick(tb.frame, "LeftButton")
eq(dbl, 1, "icon double-click reaches the tab")

-- Item tabs (lootmaster.itemTooltip): Same as above (Loot Master's Tooltip position), a side of the window, or
-- the game's tooltip spot
eq(LM.TOOLTIP_ANCHOR_DEFAULT, "area", "item tabs: the default is Same as above")
local order = {}
for _, a in ipairs(LM.TOOLTIP_ANCHORS) do order[#order + 1] = a.key end
eq(table.concat(order, ","), "area,left,right,bottomleft,bottomright,topleft,topright,topcenter,bottomcenter,game", "item tabs: Same as above, the eight sides in Alex's order, the game's spot")
eq(LM.TOOLTIP_ANCHORS[1].label, "Same as above", "item tabs: the first choice's label")
eq(LM.TOOLTIP_ANCHORS[#LM.TOOLTIP_ANCHORS].label, "Game's tooltip spot", "item tabs: the last choice's label")
-- the sides name a spot's place outside the window (UI.TOOLTIP_SPOTS' window entries), never points of their own
local spotKeys = {} for _, s in ipairs(UI.TOOLTIP_SPOTS) do spotKeys[s.key] = s.window ~= nil end
for _, a in ipairs(LM.TOOLTIP_ANCHORS) do
  if a.key ~= "area" and a.key ~= "game" then
    check(spotKeys[a.window] == true and a.point == nil and a.rel == nil and a.dx == nil and a.dy == nil, "item tabs " .. a.key .. ": a spot's window place, written once (" .. tostring(a.window) .. ")")
  end
end
local want = {
  left = { "TOPRIGHT", "TOPLEFT", -4 }, right = { "TOPLEFT", "TOPRIGHT", 4 },
  topleft = { "BOTTOMLEFT", "TOPLEFT", 0, 4 }, topcenter = { "BOTTOM", "TOP", 0, 4 }, topright = { "BOTTOMRIGHT", "TOPRIGHT", 0, 4 },
  bottomleft = { "TOPLEFT", "BOTTOMLEFT", 0, -4 }, bottomcenter = { "TOP", "BOTTOM", 0, -4 }, bottomright = { "TOPRIGHT", "BOTTOMRIGHT", 0, -4 },
}
tb.frame.GetTop = function() return 500 end
winFrame.GetTop = function() return 600 end
local def
GameTooltip_SetDefaultAnchor = function(tip, owner) def = { tip, owner } end
for key, w in pairs(want) do
  for _, general in ipairs({ "spot", "game" }) do
    -- a side stays where it is whatever General Settings or Loot Master's Tooltip position say
    CRT.db.ui.tooltipMode = general
    CRT.db.lootmaster.itemTooltip = key
    CRT.db.lootmaster.tooltipMode = general == "game" and "cursor" or "spot"
    got, def = {}, nil
    tb.frame.scripts.OnEnter(tb.frame)
    eq(got.anchor, "ANCHOR_NONE", "tooltip " .. key .. ": placed by hand")
    eq(got.owner, tb.frame, "tooltip " .. key .. ": owner is the icon")
    check(def == nil, "tooltip " .. key .. ": not the game's spot")
    check(got.pt and got.pt[1] == w[1] and got.pt[2] == winFrame and got.pt[3] == w[2] and got.pt[4] == w[3], "tooltip " .. key .. ": point")
    eq(got.pt and got.pt[5], w[4] or -100, "tooltip " .. key .. ": vertical offset")
  end
end
CRT.db.ui.tooltipMode, CRT.db.lootmaster.tooltipMode = nil, nil
CRT.db.lootmaster.itemTooltip = "game"
got, def = {}, nil
tb.frame.scripts.OnEnter(tb.frame)
check(def and def[1] == GameTooltip and def[2] == tb.frame, "item tabs on the game's spot: the game's own anchor")
check(got.pt == nil, "item tabs on the game's spot: nothing placed by hand")
-- Same as above: Loot Master's Tooltip position, which is General Settings' unless set; on auto, the icon's
-- own ANCHOR_LEFT; a spot picked for Loot Master (bottom) or General Settings (top) wins over it
for _, c in ipairs({
  { "nonsense", nil, nil, "ANCHOR_LEFT" }, { "area", nil, "game", "game" }, { "area", "general", "game", "game" }, { "area", "spot", "game", "ANCHOR_LEFT" },
  { "area", "game", nil, "game" }, { "area", "cursor", "game", "cursor" }, { nil, "cursor", nil, "cursor" }, { "area", "general", "spot", "ANCHOR_LEFT" },
  { "area", "spot", "spot", "ANCHOR_BOTTOM", "bottom" }, { "area", "spot", nil, "ANCHOR_BOTTOM", "bottom", "top" }, { "area", "general", "spot", "ANCHOR_TOP", "bottom", "top" },
  { "area", "spot", "spot", "ANCHOR_LEFT", "auto", "top" },
}) do
  CRT.db.lootmaster.itemTooltip, CRT.db.lootmaster.tooltipMode, CRT.db.ui.tooltipMode = c[1], c[2], c[3]
  CRT.db.lootmaster.tooltipSpot, CRT.db.ui.tooltipSpot = c[5], c[6]
  got, def = {}, nil
  tb.frame.scripts.OnEnter(tb.frame)
  local what = "item tabs " .. tostring(c[1]) .. ", Loot Master " .. tostring(c[2]) .. " " .. tostring(c[5]) .. ", general " .. tostring(c[3]) .. " " .. tostring(c[6])
  if c[4] == "game" then
    check(def and def[2] == tb.frame and got.pt == nil, what .. ": the game's spot")
  elseif c[4] == "cursor" then
    check(def == nil and got.anchor == "ANCHOR_CURSOR" and got.pt == nil, what .. ": follows the cursor")
  else
    check(def == nil and got.anchor == c[4] and got.pt == nil, what .. ": on the spot, " .. c[4] .. " (got " .. tostring(got.anchor) .. ")")
  end
end
CRT.db.lootmaster.itemTooltip, CRT.db.lootmaster.tooltipMode, CRT.db.ui.tooltipMode, CRT.db.lootmaster.tooltipSpot, CRT.db.ui.tooltipSpot = nil, nil, nil, nil, nil
-- the old setting (lootmaster.tooltipAnchor) is not read here: Core.lua moved it to itemTooltip once
CRT.db.lootmaster.tooltipAnchor = "right"
got, def = {}, nil
tb.frame.scripts.OnEnter(tb.frame)
check(got.pt == nil and got.anchor == "ANCHOR_LEFT", "item tabs: the old tooltipAnchor field is not read")
CRT.db.lootmaster.tooltipAnchor = nil
-- one placement for both: a side of the window and a picked spot in a CRT window go through UI.TooltipOutside
local outsideCalls, realOutside = {}, UI.TooltipOutside
check(type(realOutside) == "function", "UI.TooltipOutside exists")
UI.TooltipOutside = function(...) outsideCalls[#outsideCalls + 1] = { ... } return realOutside(...) end
CRT.db.lootmaster.itemTooltip = "right"
got = {}
tb.frame.scripts.OnEnter(tb.frame)
check(#outsideCalls == 1 and outsideCalls[1][2] == tb.frame and outsideCalls[1][3] == winFrame and outsideCalls[1][4] == "rightupper" and outsideCalls[1][5] == true, "item tabs on Right: placed by UI.TooltipOutside, by the window")
check(got.pt and got.pt[1] == "TOPLEFT" and got.pt[2] == winFrame and got.pt[3] == "TOPRIGHT" and got.pt[4] == 4 and got.pt[5] == -100, "item tabs on Right: still beside the window's right edge, level with the icon")
-- Same as above with a spot picked, the icon in a CRT window (the looter window): outside that window
local lootWin = UI.AddWindow(mock())
tb.frame.GetParent = function() return tb end
tb.GetParent = function() return lootWin end
CRT.db.lootmaster.itemTooltip, CRT.db.lootmaster.tooltipMode, CRT.db.lootmaster.tooltipSpot = "area", "spot", "bottom"
outsideCalls, got = {}, {}
tb.frame.scripts.OnEnter(tb.frame)
check(#outsideCalls == 1 and outsideCalls[1][3] == lootWin, "item tabs, Same as above on Bottom: placed by the same UI.TooltipOutside")
check(got.anchor == "ANCHOR_NONE" and got.pt and got.pt[1] == "TOP" and got.pt[2] == lootWin and got.pt[3] == "BOTTOM" and got.pt[5] == -4, "item tabs, Same as above on Bottom: under the window, not the icon")
CRT.db.lootmaster.tooltipSpot = "auto"
outsideCalls, got = {}, {}
tb.frame.scripts.OnEnter(tb.frame)
check(#outsideCalls == 0 and got.anchor == "ANCHOR_LEFT" and got.owner == tb.frame, "item tabs, Same as above on auto: next to the icon, as before")
UI.TooltipOutside = realOutside
tb.frame.GetParent, tb.GetParent = nil, nil
CRT.db.lootmaster.itemTooltip, CRT.db.lootmaster.tooltipMode, CRT.db.lootmaster.tooltipSpot = nil, nil, nil
-- every UI.Window is a CRT window for that lookup: a dialog, a pop-out and an overlay (the raider popup)
for _, kind in ipairs({ "dialog", "popout", "overlay" }) do
  local w = UI.Window("TestLookup" .. kind, { kind = kind })
  local inside = mock()
  inside.GetParent = function() return w.content end
  if w.content ~= w then w.content.GetParent = function() return w end end
  eq(UI.WindowOf(inside), w, "UI.Window " .. kind .. ": the window something inside it is in")
end

-- the gear icons: a tooltip by item ID with the item level, the real link on your own row, none when empty
local tip = {}
GameTooltip = { SetOwner = function(_, o, a) tip.owner, tip.anchor = o, a end,
  SetItemByID = function(_, id) tip.byID = id end, SetHyperlink = function(_, l) tip.link = l end,
  AddLine = function(_, t) tip.lines = (tip.lines or "") .. t .. "|" end,
  Show = function() tip.shown = true end, Hide = function() tip.shown = false end }
LM.MyGear = function() return { { id = 77, ilvl = 600, link = "item:77::real" } } end
local rowClick, rowButton
local grow = mock()
grow:SetScript("OnClick", function(_, b) rowClick = b end)
local gicon = LM.GearIcon(grow, 10)
LM.SetGear(gicon, { id = 55, ilvl = 610 }, nil)
check(gicon.shown and gicon.hit.shown, "gear icon: shown with a piece")
gicon.hit.scripts.OnEnter(gicon.hit)
eq(tip.byID, 55, "gear tooltip: the item by its ID")
eq(tip.lines, "Equipped at item level 610|", "gear tooltip: the item level line")
eq(tip.owner, gicon.hit, "gear tooltip: owned by the icon")
check(tip.shown, "gear tooltip: shown")
gicon.hit.scripts.OnLeave()
check(tip.shown == false, "gear tooltip: hidden on leave")
gicon.hit.scripts.OnClick(gicon.hit, "RightButton")
eq(rowClick, "RightButton", "gear icon: a click reaches the row")
tip = {}
LM.SetGear(gicon, { id = 77, ilvl = 600 }, "item:1")
gicon.hit.scripts.OnEnter(gicon.hit)
eq(tip.link, "item:77::real", "gear tooltip: your own row uses the equipped link")
check(tip.byID == nil, "gear tooltip: own row does not fall back to the ID")
eq(tip.lines, "Equipped at item level 600|", "gear tooltip: your own row has the item level line too")
-- another raider's piece once their G part arrived: the exact item, through the gear engine
tip = {}
local FULL = "item:55:7364:213746::::::90:577::28:3:12667:12793:6652"
LM.SetGear(gicon, { id = 55, ilvl = 610, itemString = FULL, slot = 11 }, nil)
gicon.hit.scripts.OnEnter(gicon.hit)
eq(tip.link, FULL, "gear tooltip: a raider's full item by its item string")
check(tip.byID == nil, "gear tooltip: not by ID when the item string is known")
eq(tip.lines, "Equipped at item level 610|", "gear tooltip: with the item level line")
eq(tip.anchor, "ANCHOR_RIGHT", "gear tooltip: right of the icon")
check(CRT.Gear.ShowTooltip ~= nil, "the gear engine shows it")
-- Tooltip position, the game's tooltip spot: the gear button's tooltip opens there
tip, def = {}, nil
CRT.db.ui.tooltipMode = "game"
gicon.hit.scripts.OnEnter(gicon.hit)
check(def and def[1] == GameTooltip and def[2] == gicon.hit and tip.anchor == nil, "gear tooltip, the game's tooltip spot: GameTooltip_SetDefaultAnchor")
eq(tip.link, FULL, "gear tooltip, the game's tooltip spot: the same item")
CRT.db.ui.tooltipMode = nil
-- and they follow Loot Master's own Tooltip position
tip, def = {}, nil
CRT.db.lootmaster.tooltipMode = "game"
gicon.hit.scripts.OnEnter(gicon.hit)
check(def and def[2] == gicon.hit and tip.anchor == nil, "gear tooltip, Loot Master on the game's spot: GameTooltip_SetDefaultAnchor")
tip, def = {}, nil
CRT.db.lootmaster.tooltipMode = "cursor"
CRT.db.ui.tooltipMode = "game"
gicon.hit.scripts.OnEnter(gicon.hit)
check(def == nil and tip.anchor == "ANCHOR_CURSOR", "gear tooltip, Loot Master following the cursor: over General Settings' game's spot")
CRT.db.lootmaster.tooltipMode, CRT.db.ui.tooltipMode = nil, nil
tip = {}
LM.SetGear(gicon, nil, nil)
check(not gicon.shown and not gicon.hit.shown, "gear icon: an empty slot hides it")
gicon.hit.scripts.OnEnter(gicon.hit)
check(tip.owner == nil and not tip.byID, "gear tooltip: none on an empty slot")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Window.lua', 'CRT_Modules/LootMaster/Tabs.lua', 'CRT_Modules/LootMaster/Popup.lua', 'CRT_Modules/LootMaster/Data.lua', 'CRT_Core/Gear.lua', 'CRT_Core/UI/Tooltip.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, 7, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
