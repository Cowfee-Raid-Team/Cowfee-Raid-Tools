// The Gear Checker page (CRT_Modules/GearChecker/Page.lua) on stand-in frames with the real UI helpers
// (Themes.lua, Panel.lua, Controls.lua, Window.lua, ScrollBar.lua): it fits the page area; the chips, the
// Refresh label with the CRT count and its width; the rows (name in class colour, average, the issues
// badge, the cells' quality border, red and orange outlines, enchant dots and gem diamonds, not seen yet);
// the filters; the page in each theme and a live theme switch; hover, shift-click, the issues badge's
// tooltip and the right-click menu (the Send issues to submenu per group, guild and officer rights, Say in
// the world into the chat box, chat box, inspect); and the pop-out window saving its place and size.
// Usage: node run_gearchecker_page.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local themesSrc, panelSrc, controlsSrc, windowSrc, scrollSrc, gearSrc, dataSrc, inspectSrc, commSrc, pageSrc = ...
unpack = unpack or table.unpack -- the harness runs Lua 5.3
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local function near(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
tinsert = table.insert
UISpecialFrames = {}
GetTime = function() return 100 end
time = function() return 1790000000 end
local timers = {}
C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end, NewTicker = function() return { Cancel = function() end } end }
local function flush() local list = timers timers = {} for _, fn in ipairs(list) do fn() end end

-- stand-in regions and frames: setters record, getters answer from what was set; any other method does
-- nothing, except the names of a template's parts, which a frame has only when its template makes them
FIELDS = { Left = true, Middle = true, Right = true, Background = true, Arrow = true, SetupMenu = true, Inset = true, Track = true,
  Thumb = true, Back = true, Forward = true, ThumbTexture = true, ScrollUpButton = true, ScrollDownButton = true, CloseButton = true }
local function region(kind, parent)
  local r = { kind = kind, parent = parent, shown = true, points = {}, scripts = {}, children = {}, regions = {}, w = 0, h = 0, level = 1 }
  if parent and parent.children and kind ~= "Texture" and kind ~= "FontString" then parent.children[#parent.children + 1] = r end
  if parent and parent.regions and (kind == "Texture" or kind == "FontString") then parent.regions[#parent.regions + 1] = r end
  local m = {}
  function m:GetObjectType() return self.kind end
  function m:SetPoint(...) self.points[#self.points + 1] = { ... } end
  function m:ClearAllPoints() self.points = {} end
  function m:SetAllPoints(to) self.points = { { "ALL", to } } end
  function m:SetSize(w, h) self.w, self.h = w, h end
  function m:SetWidth(w) self.w = w end
  function m:SetHeight(h) self.h = h end
  function m:GetWidth() return self.w end
  function m:GetHeight() return self.h end
  function m:GetLeft() return self.left end
  function m:GetTop() return self.top end
  function m:GetScale() return self.scale or 1 end
  function m:SetScale(s) self.scale = s end
  function m:Show() local was = self.shown self.shown = true if not was and self.scripts.OnShow then self.scripts.OnShow(self) end end
  function m:Hide() local was = self.shown self.shown = false if was and self.scripts.OnHide then self.scripts.OnHide(self) end end
  function m:SetShown(v) if v then self:Show() else self:Hide() end end
  function m:IsShown() return self.shown end
  function m:IsVisible() local p = self while p do if not p.shown then return false end p = p.parent end return true end
  function m:SetParent(p) self.parent = p end
  function m:GetParent() return self.parent end
  function m:SetText(t) self.text = t if self.fs then self.fs.text = t end end
  function m:GetText() return self.text end
  function m:GetStringWidth() return #(self.text or "") * 6 end
  function m:GetUnboundedStringWidth() return #(self.text or "") * 6 end
  function m:GetFontString() return self.fs end
  function m:SetTextColor(r, g, b) self.color = { r, g, b } end
  function m:SetColorTexture(r, g, b, a) self.color = { r, g, b, a } end
  function m:SetVertexColor(r, g, b, a) self.vertex = { r, g, b, a } end
  function m:SetTexture(t) self.file = t end
  function m:SetRotation(r) self.rotation = r end
  function m:GetFont() return "f", 12, "" end
  function m:CreateTexture() return region("Texture", self) end
  function m:CreateFontString() return region("FontString", self) end
  function m:SetScript(k, fn) self.scripts[k] = fn end
  function m:GetScript(k) return self.scripts[k] end
  function m:HookScript(k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end fn(...) end end
  function m:GetChildren() return unpack(self.children) end
  function m:GetRegions() return unpack(self.regions) end
  function m:GetFrameLevel() return self.level end
  function m:SetFrameLevel(l) self.level = l end
  function m:IsMouseEnabled() return true end
  function m:GetFrameStrata() return self.strata or "MEDIUM" end
  function m:SetFrameStrata(s) self.strata = s end
  function m:IsProtected() return false end
  function m:SetBackdropColor(r, g, b, a) self.backdrop = { r, g, b, a } end
  function m:SetBackdropBorderColor(r, g, b, a) self.border = { r, g, b, a } end
  function m:RegisterForClicks(...) self.clicks = { ... } end
  function m:Click(button) if self.scripts.OnClick then self.scripts.OnClick(self, button or "LeftButton") end end
  function m:GetHighlightTexture() return self.highlight end
  return setmetatable(r, { __index = function(_, k) return m[k] or (type(k) == "string" and not FIELDS[k] and k:find("^%u") and function() end) or nil end })
end
local made = {}
CreateFrame = function(kind, name, parent, template)
  local f = region(kind, parent)
  f.name, f.template = name, template
  made[#made + 1] = f
  if name then _G[name] = f end
  if template == "UIPanelButtonTemplate" then
    f.Left, f.Middle, f.Right = region("Texture"), region("Texture"), region("Texture")
    f.fs = region("FontString")
    f.highlight = region("Texture")
  elseif template == "BasicFrameTemplateWithInset" then
    f.CloseButton = CreateFrame("Button", nil, f)
    f:CreateTexture()
  elseif template == "MinimalScrollBar" then
    f.Track = region("Frame") f.Track.Thumb = region("Frame") f.Back = region("Button") f.Forward = region("Button")
  end
  return f
end
CreateColor = function(r, g, b, a) return { r, g, b, a } end
hooksecurefunc = function(t, name, hook) local old = t[name] rawset(t, name, function(...) local r = { old(...) } hook(...) return unpack(r) end) end
UIParent = region("Frame") UIParent.h = 1080 UIParent.w = 1920
-- the scroll list: the provider handed in, and the initializer to draw rows with
local list = {}
CreateDataProvider = function(rows) return rows end
ScrollBoxConstants = { RetainScrollPosition = true }
CreateScrollBoxListLinearView = function() local v = region("View") function v:SetElementInitializer(kind, fn) list.init = fn end function v:SetElementExtent(h) list.extent = h end return v end
ScrollUtil = { InitScrollBoxListWithScrollBar = function(box) function box:SetDataProvider(p) list.rows = p end end }
local function drawRows() local frames = {} for i, row in ipairs(list.rows or {}) do local f = CreateFrame("Button") list.init(f, row) frames[i] = f end return frames end
-- the menu: records the entries; a button is a submenu too
local lastRoot
local function menuNode(t, fn)
  local n = { text = t, fn = fn, enabled = true, items = {} }
  function n:AddMenuAcquiredCallback() end
  function n:CreateTitle(x) self.items[#self.items + 1] = { title = x } end
  function n:CreateDivider() end
  function n:CreateButton(x, f) local b = menuNode(x, f) self.items[#self.items + 1] = b return b end
  function n:SetEnabled(on) self.enabled = on end
  function n:SetTooltip(f) local t = { lines = {} } function t:AddLine(x) self.lines[#self.lines + 1] = x end f(t, self) self.tooltip = table.concat(t.lines, " ") end
  return n
end
GameTooltip_SetTitle = function(t, x) t:AddLine(x) end
GameTooltip_AddNormalLine = function(t, x) t:AddLine(x) end
MenuUtil = { CreateContextMenu = function(owner, generator)
  local root = menuNode()
  generator(owner, root)
  lastRoot = root
  return region("Frame")
end }
local tip = {}
GameTooltip = { SetOwner = function() tip = { lines = {} } end, SetHyperlink = function(_, s) tip.link = s end, SetItemByID = function(_, id) tip.byID = id end,
  AddLine = function(_, t, r, g, b) tip.lines[#tip.lines + 1] = t tip.colors = tip.colors or {} tip.colors[#tip.lines] = { r, g, b } end,
  Show = function() tip.shown = true end, Hide = function() tip.shown = false end,
  SetText = function(_, t, r, g, b) tip.title = t tip.titleColor = { r, g, b } end }

-- the game: a raid of four, you, Quick (CRT), Arrow (inspected), Halo (not seen)
local UNITS = { raid1 = { "Solex", "PALADIN" }, raid2 = { "Quick", "ROGUE" }, raid3 = { "Arrow", "HUNTER" }, raid4 = { "Halo", "DRUID" } }
local function u(unit) if unit == "player" then return UNITS.raid1 end return UNITS[unit] end
UnitFullName = function(unit) local x = u(unit) return x and x[1] end
UnitClass = function(unit) local x = u(unit) return x and x[2], x and x[2] end
UnitIsUnit = function(a, b) return u(a) == u(b) end
GetNormalizedRealmName = function() return "Sargeras" end
LE_PARTY_CATEGORY_INSTANCE = 2
local raid = true
IsInRaid = function() return raid end
IsInGroup = function(c) return c == nil end
GetNumGroupMembers = function() return 4 end
GetNumSubgroupMembers = function() return 0 end
InCombatLockdown = function() return false end
RAID_CLASS_COLORS = { ROGUE = { r = 1, g = 0.96, b = 0.41 }, PALADIN = { r = 0.96, g = 0.55, b = 0.73 }, HUNTER = { r = 0.67, g = 0.83, b = 0.45 }, DRUID = { r = 1, g = 0.49, b = 0.04 } }
ITEM_QUALITY_COLORS = { [2] = { r = 0.12, g = 1, b = 0 }, [4] = { r = 0.64, g = 0.21, b = 0.93 } }
local QUALITY = setmetatable({}, { __index = function() return 4 end })
local LOC = { [111] = "INVTYPE_FINGER", [101] = "INVTYPE_HEAD" }
C_Item = {
  GetDetailedItemLevelInfo = function() return 289 end,
  GetItemInfoInstant = function(s) local id = tonumber(tostring(s):match("item:(%d+)") or s) return id, "Armor", "Misc", LOC[id] or "INVTYPE_CHEST", 5000 + (id or 0), 4, 0 end,
  GetItemNumSockets = function(s) return tonumber(s:match("item:(%d+)")) == 111 and 2 or 0 end,
  GetItemInfo = function(s) return "Band", "|cffa335ee|H" .. s .. "|h[Band]|h|r" end,
  GetItemQualityByID = function(s) return QUALITY[tonumber(tostring(s):match("item:(%d+)") or s)] end,
  RequestLoadItemDataByID = function() end,
}
GetInventoryItemLink = function(unit, slot) if unit == "player" and slot == 1 then return "|cffa335ee|Hitem:101:7364|h[Helm]|h|r" end end
GetInventoryItemID = function(unit, slot) if unit == "player" and slot == 1 then return 101 end end
local said = {}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function() return 0 end,
  SendChatMessage = function(text, chatType, _, target) said[#said + 1] = { text = text, chatType = chatType, target = target } end }
local chat = { opened = {}, inserted = {} }
ChatFrameUtil = { GetActiveWindow = function() return chat.active end, InsertLink = function(t) chat.inserted[#chat.inserted + 1] = t return true end,
  OpenChat = function(t) chat.opened[#chat.opened + 1] = t end }
local inspected
InspectUnit = function(unit) inspected = unit end
local shift = false
IsShiftKeyDown = function() return shift end

local CRT = { db = { ui = { modern = false, layers = {}, theme = "blizzard" }, window = { scale = 100 }, gearChecker = { filter = "all", popout = {} } } }
function CRT:ApplyFonts() end
function CRT:Print() end
for _, src in ipairs({ themesSrc, panelSrc, controlsSrc, windowSrc, scrollSrc, gearSrc, dataSrc, inspectSrc, commSrc, pageSrc }) do
  assert(load(src))("CowfeeRaidTools", CRT)
end
local UI, GC, Gear = CRT.UI, CRT.GearChecker, CRT.Gear
local P = GC.Page
local Lt = GC.PAGE_LAYOUT

-- the gear: Quick sent theirs (a ring gem missing), Arrow was inspected (no head enchant, a low item)
Gear:Remember("Quick-Sargeras", { { slot = 1, id = 101, itemString = "item:101:7364", ilvl = 289 }, { slot = 11, id = 111, itemString = "item:111:7364:213746", ilvl = 289 } }, "gearcheck", true)
GC.Comm.crt["Quick-Sargeras"], GC.Comm.sets["Quick-Sargeras"] = true, 1
local arrowSet = {}
for i, s in ipairs(Gear.SLOTS) do arrowSet[i] = { slot = s.id, id = 200 + i, itemString = "item:" .. (200 + i) .. ":7364", ilvl = 289 } end
arrowSet[1] = { slot = 1, id = 101, itemString = "item:101", ilvl = 289 } -- no enchant
arrowSet[9] = { slot = 10, id = 210, itemString = "item:210", ilvl = 270 } -- hands, 19 under
Gear:Remember("Arrow-Sargeras", arrowSet, "inspect", true)
CRT.Bosses = { GearChecks = function() return { enchant = { 1, 3, 5, 7, 8, 11, 12, 16, 17 }, enchantWeaponOnly = { 17 }, sockets = true } end }

-- 1. The page builds and fits the page area
check(UI.pages.gearcheck ~= nil, "the page is registered")
eq(UI.pages.gearcheck.title, "Gear Checker", "it is called Gear Checker in the left menu")
local listed = false
for _, key in ipairs(UI.MENU_GROUPS[2]) do listed = listed or key == "gearcheck" end
check(listed, "it sits in the Raid Groups and Ready Check block")
local page = CreateFrame("Frame") page.w, page.h = UI.PAGE_W, UI.PAGE_H
GC.LOW_ILVL = 15 -- the help text is built from it
UI.pages.gearcheck.builder(page)
GC.LOW_ILVL = 12
local helpButton
for _, f in ipairs(made) do if f.crtHelp and f.parent == P.body then helpButton = f end end
helpButton.scripts.OnEnter(helpButton)
local helpText = table.concat(tip.lines, " ")
check(helpText:find("an item 15 or more item levels under", 1, true) ~= nil, "the help says the low item level rule from GC.LOW_ILVL")
page.scripts.OnShow(page)
check(P.body ~= nil and P.box ~= nil, "the body and the list are built")
check(Lt.rowW + Lt.barGap + Lt.barW <= UI.PAGE_W - 16, "a row and the scroll bar fit inside the page (" .. (Lt.rowW + Lt.barGap + Lt.barW) .. ")")
eq(Lt.rowW, Lt.nameW + Lt.ilvlW + Lt.issuesW + 16 * Lt.cellW, "all 16 slots in a row")
check(P.bar.crtScroll ~= nil, "the scroll bar goes through UI:SkinScrollBar")
local chipW = 0
for _, c in ipairs(P.chips) do chipW = chipW + c.w + Lt.chipGap end
local right = P.refreshButton.w + P.popButton.w + 6 + 10 + P.countText:GetStringWidth()
check(chipW + 8 + 20 + 20 + right <= UI.PAGE_W - 16, "the chips, help, count and buttons fit across the page")
eq(#P.chips, 4, "four filter chips")
eq(P.chips[1].text.text .. "|" .. P.chips[2].text.text .. "|" .. P.chips[3].text.text .. "|" .. P.chips[4].text.text, "Everyone|Only issues|Missing gems|Missing enchants", "the chips' labels")
eq(P.refreshButton:GetText(), "Refresh (2/4 have CRT)", "Refresh says how many have CRT")
eq(P.refreshButton.w, UI.PanelButtonWidth(#"Refresh (2/4 have CRT)" * 6), "Refresh is as wide as its label")

-- 2. The rows
local rows = drawRows()
eq(#rows, 4, "everyone: four rows")
local function rowOf(name) for _, f in ipairs(rows) do if f.data.name == name .. "-Sargeras" then return f end end end
local me, quick, arrow, halo = rowOf("Solex"), rowOf("Quick"), rowOf("Arrow"), rowOf("Halo")
eq(me.name.text, "Solex", "your row, first")
eq(rows[1], me, "you first")
check(near(quick.name.color, { 1, 0.96, 0.41 }), "Quick's name in the rogue colour")
eq(quick.ilvl.text, string.format("%.1f", 578 / 16), "the average item level")
eq(quick.issues.text, "1", "Quick: one issue")
check(near(quick.badge.color, { 0.9, 0.15, 0.15 }), "a red badge with issues")
eq(arrow.issues.text, "2", "Arrow: a missing enchant and a low item")
local function cell(f, slot) for _, c in ipairs(f.cells) do if c.slot == slot then return c end end end
local ring = cell(quick, 11)
check(ring.icon.shown and ring.icon.file == 5111, "the ring's icon")
check(near(ring.quality[1].color, { 0.64, 0.21, 0.93 }), "the quality border")
eq(ring.ilvl.text, "289", "the item level under the icon")
check(ring.flag[1].shown and near(ring.flag[1].color, { 0.9, 0.15, 0.15 }), "a red outline for a missing gem")
check(ring.gems[1].edge.shown and ring.gems[2].edge.shown and not ring.gems[3].edge.shown, "two gem diamonds")
check(near(ring.gems[1].fill.vertex, { 0.55, 0.8, 1 }), "the first filled")
check(near(ring.gems[2].edge.vertex, { 0.9, 0.15, 0.15 }), "the second empty with a red edge")
check(ring.gems[1].edge.rotation and math.abs(ring.gems[1].edge.rotation - math.pi / 4) < 0.001, "diamonds: squares turned 45 degrees")
check(ring.dot.shown and near(ring.dot.vertex, { 0.3, 0.85, 0.3 }), "an enchanted ring: a green dot")
local head = cell(arrow, 1)
check(head.dot.shown and near(head.dot.vertex, { 0.9, 0.15, 0.15 }), "no head enchant: a red dot")
check(head.flag[1].shown and near(head.flag[1].color, { 0.9, 0.15, 0.15 }), "and a red outline")
local hands = cell(arrow, 10)
check(hands.flag[1].shown and near(hands.flag[1].color, { 1, 0.55, 0.1 }), "a low item: an orange outline")
check(not cell(arrow, 2).dot.shown, "a neck has no enchant dot")
check(not cell(arrow, 2).flag[1].shown, "and no outline")
check(not cell(quick, 3).icon.shown, "an empty slot shows no icon")
check(not halo.cells[1].shown, "not seen: no cells")
eq(halo.notSeen.text, "not seen yet", "not seen yet")
check(not halo.badge.shown, "not seen: no badge")

-- 3. The filters
P.chips[3]:Click()
eq(CRT.db.gearChecker.filter, "gems", "a chip saves the filter")
rows = drawRows()
eq(#rows, 1, "missing gems: one row")
eq(rows[1].data.name, "Quick-Sargeras", "Quick")
check(P.chips[3].selected and not P.chips[1].selected, "the chip picked looks selected")
P.chips[4]:Click()
rows = drawRows()
eq(#rows == 1 and rows[1].data.name, "Arrow-Sargeras", "missing enchants: Arrow")
arrow = rows[1]
check(cell(arrow, 1).icon.shown and cell(arrow, 1).ilvl.text == "289", "missing enchants: Arrow's head is drawn")
check(not cell(arrow, 10).icon.shown and cell(arrow, 10).ilvl.text == "" and not cell(arrow, 10).flag[1].shown, "missing enchants: the low hands are drawn empty")
check(not cell(arrow, 2).icon.shown and cell(arrow, 2).ilvl.text == "", "missing enchants: a slot with no issue is drawn empty")
check(cell(arrow, 2).shown and cell(arrow, 2).back.shown, "the columns stay in place: the cell is there, only empty")
P.chips[3]:Click()
rows = drawRows()
check(cell(rows[1], 11).icon.shown and not cell(rows[1], 1).icon.shown, "missing gems: only Quick's ring")
P.chips[2]:Click()
rows = drawRows()
eq(#rows, 2, "only issues: Quick and Arrow")
quick, arrow = rowOf("Quick"), rowOf("Arrow")
check(cell(quick, 11).icon.shown and not cell(quick, 1).icon.shown, "only issues: Quick's ring, not the enchanted head")
check(cell(arrow, 1).icon.shown and cell(arrow, 10).icon.shown and cell(arrow, 10).flag[1].shown, "only issues: Arrow's head and the low hands")
check(not cell(arrow, 2).icon.shown and not cell(arrow, 2).dot.shown, "only issues: a fine slot is drawn empty")
GameTooltip:Hide()
cell(arrow, 2).scripts.OnEnter(cell(arrow, 2))
check(not tip.shown, "a cell drawn empty has no tooltip")
cell(arrow, 2).scripts.OnClick(cell(arrow, 2), "RightButton")
eq(lastRoot.items[1].title, "Arrow", "a right-click on an empty cell still opens the row's menu")
P.chips[1]:Click()
rows = drawRows()
eq(#rows, 4, "everyone again")
quick, arrow = rowOf("Quick"), rowOf("Arrow")

-- 4. The page in each theme, and a live switch
for _, info in ipairs(CRT.THEME_LIST) do
  UI:SetTheme(info.key)
  local f = drawRows()[2]
  local hcol = P.headers[1].color
  if info.modern then
    check(near(hcol, CRT.THEMES[info.key].latte), info.key .. ": headings in the theme's latte")
    check(near(f.bg.color, CRT.THEMES[info.key].roast), info.key .. ": rows in the theme's roast")
    check(near(f.ilvl.color, CRT.THEMES[info.key].cream), info.key .. ": text in the theme's cream")
    check(near(P.chips[1].backdrop, CRT.THEMES[info.key].roast), info.key .. ": the chips follow the theme")
  else
    check(near(hcol, { 1, 0.82, 0 }), info.key .. ": the game's gold headings")
    check(near(f.bg.color, { 0, 0, 0 }), info.key .. ": the game's dark rows")
    check(near(f.ilvl.color, { 1, 1, 1 }), info.key .. ": white text")
  end
  check(near(cell(f, 11).flag[1].color, { 0.9, 0.15, 0.15 }), info.key .. ": the red outline stays red")
end
UI:SetTheme("blizzard")
rows = drawRows()
quick = rowOf("Quick")

-- 4b. The quality border: Uncommon until the item loads, then its own colour, redrawn once it loads
QUALITY[111] = false
P.Refresh()
quick = drawRows()[2]
check(near(cell(quick, 11).quality[1].color, { 0.12, 1, 0 }), "an item not loaded yet: the Uncommon border")
timers = {}
P.OnEvent("ITEM_DATA_LOAD_RESULT", 999)
eq(#timers, 0, "another item loading: no redraw")
QUALITY[111] = nil
P.OnEvent("ITEM_DATA_LOAD_RESULT", 111)
P.OnEvent("ITEM_DATA_LOAD_RESULT", 101)
eq(#timers, 1, "a shown item loading: one redraw for the items that load together")
flush()
quick = drawRows()[2]
check(near(cell(quick, 11).quality[1].color, { 0.64, 0.21, 0.93 }), "loaded: its own quality colour")
issecretvalue = function(v) return v == 777 end
QUALITY[111] = 777
P.Refresh()
quick = drawRows()[2]
check(near(cell(quick, 11).quality[1].color, { 0.12, 1, 0 }), "a secret quality is never looked up: Uncommon")
issecretvalue = nil
QUALITY[111] = nil
P.Refresh()
rows = drawRows()
quick, arrow = rowOf("Quick"), rowOf("Arrow")

-- 5. Hover, shift-click
ring = cell(quick, 11)
ring.scripts.OnEnter(ring)
eq(tip.link, "item:111:7364:213746", "hover: the exact item")
check(tip.lines[2] == "missing gem", "hover: what is missing")
shift = true
ring.scripts.OnClick(ring, "LeftButton")
eq(chat.opened[1], "[Quick] Finger |cffa335ee|Hitem:111:7364:213746|h[Band]|h|r 289 - missing gem", "shift-click: the line in a new chat box")
chat.active = {}
ring.scripts.OnClick(ring, "LeftButton")
eq(chat.inserted[1], chat.opened[1], "shift-click: into the chat box being typed in")
chat.active = nil
shift = false
local opened = #chat.opened
ring.scripts.OnClick(ring, "LeftButton")
eq(#chat.opened, opened, "a plain click puts nothing in chat")

-- 5b. Hovering the issues badge lists the issues
check(arrow.badgeHit ~= nil and arrow.badgeHit.w == Lt.badgeW and arrow.badgeHit.h == Lt.badgeH, "the hover area is the badge's size")
arrow.badgeHit.scripts.OnEnter(arrow.badgeHit)
eq(tip.title, "Arrow", "badge: the player's name")
check(near(tip.titleColor, { 0.67, 0.83, 0.45 }), "badge: in their class colour")
eq(#tip.lines, 2, "badge: a line per issue")
eq(tip.lines[1], "Head |cffa335ee|Hitem:101|h[Band]|h|r 289 - missing enchant", "badge: the chat lines' wording")
check(near(tip.colors[1], { 0.9, 0.15, 0.15 }), "badge: a missing enchant in red")
check(tip.lines[2]:find("^Hands .* 270 %- 17 item levels under average$") ~= nil, "badge: the low item, how far under (" .. tostring(tip.lines[2]) .. ")")
check(near(tip.colors[2], { 1, 0.55, 0.1 }), "badge: a low item in orange")
check(tip.shown, "badge: the tooltip shows")
arrow.badgeHit.scripts.OnLeave(arrow.badgeHit)
check(not tip.shown, "badge: gone when the mouse leaves")
me.badgeHit.scripts.OnEnter(me.badgeHit)
check(#tip.lines == 1 and tip.lines[1] == "No issues", "badge: no issues")
halo.badgeHit.scripts.OnEnter(halo.badgeHit)
check(#tip.lines == 1 and tip.lines[1] == "Not seen yet", "badge: not seen yet")
arrow.badgeHit.scripts.OnClick(arrow.badgeHit, "RightButton")
eq(lastRoot.items[1].title, "Arrow", "a right-click on the badge opens its row's menu")

-- 6. The right-click menu
IsInGuild = function() return true end
GetGuildInfo = function() return "Cowfee", "Officer", 1 end
C_GuildInfo = { CanSpeakInGuildChat = function() return true end, GuildControlGetRankFlags = function() return { true, true, true, true } end }
IsInInstance = function() return true, "raid" end
arrow.scripts.OnClick(arrow, "RightButton")
local items = lastRoot.items
eq(items[1].title, "Arrow", "menu: the player's name")
eq(items[2].text, "Send issues to", "menu: send issues to")
eq(items[3].text, "Put in chat box", "menu: chat box")
eq(items[4].text, "Inspect Arrow", "menu: inspect")
local sub = items[2].items
local labels = {}
for _, b in ipairs(sub) do labels[#labels + 1] = b.text end
eq(table.concat(labels, "|"), "Raid|Guild|Officer|Whisper Arrow|Say", "send to: the raid, Guild, Officer, a whisper, Say")
check(items[2].enabled, "send to: there are issues to send")
local function pick(text) for _, b in ipairs(lastRoot.items[2].items) do if b.text == text then return b end end end
said = {}
pick("Whisper Arrow").fn()
eq(#said, 1, "whisper: the first line now")
flush()
eq(#said, 2, "whisper: a line per issue, the next a moment later")
check(said[1].chatType == "WHISPER" and said[1].target == "Arrow-Sargeras", "whisper: to Arrow")
check(said[1].text:find("^Gear check: ") ~= nil, "whisper: the gear check line")
for _, ch in ipairs({ { "Raid", "RAID" }, { "Guild", "GUILD" }, { "Officer", "OFFICER" }, { "Say", "SAY" } }) do
  said = {}
  pick(ch[1]).fn()
  flush()
  check(#said == 2 and said[1].chatType == ch[2] and said[2].chatType == ch[2] and said[1].text:find("^%[Arrow%] ") ~= nil, ch[1] .. ": the lines go there")
end
check(pick("Say").tooltip == nil, "say in an instance: no note")
IsInInstance = function() return false, "none" end
arrow.scripts.OnClick(arrow, "RightButton")
check(pick("Say").tooltip ~= nil and pick("Say").tooltip:find("chat box", 1, true) ~= nil, "say in the world: its tooltip says it goes to the chat box")
said = {}
local openedBefore = #chat.opened
pick("Say").fn()
flush()
eq(#said, 0, "say in the world: nothing sent the game would block")
check(#chat.opened == openedBefore + 1 and chat.opened[#chat.opened]:find("^/s %[Arrow%] ") ~= nil, "say in the world: the lines in a chat box, to send with Enter")
IsInInstance = function() return true, "raid" end
lastRoot.items[3].fn()
check(chat.opened[#chat.opened]:find("^%[Arrow%] ") ~= nil, "chat box: the issues to edit first")
lastRoot.items[4].fn()
eq(inspected, "raid3", "inspect: the game's inspect window on Arrow")
cell(quick, 3).scripts.OnClick(cell(quick, 3), "RightButton")
eq(lastRoot.items[1].title, "Quick", "a right-click on a cell opens its row's menu")
C_GuildInfo.GuildControlGetRankFlags = function() return { true, true, true, false } end
raid = false
arrow.scripts.OnClick(arrow, "RightButton")
labels = {}
for _, b in ipairs(lastRoot.items[2].items) do labels[#labels + 1] = b.text end
eq(table.concat(labels, "|"), "Party|Guild|Whisper Arrow|Say", "in a party, a rank that can't speak in officer chat: Party, no Officer")
IsInGroup = function() return false end
IsInGuild = function() return false end
arrow.scripts.OnClick(arrow, "RightButton")
labels = {}
for _, b in ipairs(lastRoot.items[2].items) do labels[#labels + 1] = b.text end
eq(table.concat(labels, "|"), "Whisper Arrow|Say", "out of a group and a guild: a whisper and Say")
IsInGroup = function(c) return c == nil end
IsInGuild = function() return true end
raid = true
me.scripts.OnClick(me, "RightButton")
check(not lastRoot.items[4].enabled, "your own row: no inspect")
labels = {}
for _, b in ipairs(lastRoot.items[2].items) do labels[#labels + 1] = b.text end
check(not table.concat(labels, "|"):find("Whisper", 1, true), "your own row: no whisper")
check(not lastRoot.items[2].enabled and not lastRoot.items[3].enabled, "no issues: send and chat box greyed")
check(lastRoot.items[2].tooltip ~= nil and lastRoot.items[2].tooltip:find("No issues", 1, true) ~= nil, "no issues: the tooltip says so")

-- 7. The pop-out window keeps its place and size
P.popButton:Click()
local win = _G.CowfeeRaidToolsGearCheckerWindow
check(win ~= nil and win.shown, "pop out: the window")
check(P.body.parent == win.content, "pop out: the page moved into it")
check(P.dockedNote.shown, "pop out: the page says where it went")
eq(P.popButton:GetText(), "Dock", "pop out: the button docks")
eq(win.strata, "FULLSCREEN_DIALOG", "pop out: on the pop-up windows layer")
win.left, win.top, win.w, win.h = 300, 700, 1100, 520
win.scripts.OnDragStop(win)
local saved = CRT.db.gearChecker.popout
check(saved.point == "TOPLEFT" and saved.x == 300 and saved.y == 700 - 1080, "moved: its place is saved")
win.grip.scripts.OnMouseUp()
check(saved.width == 1100 and saved.height == 520, "resized: its size is saved")
win:Hide()
check(P.body.parent == page and not P.dockedNote.shown, "closing it puts the page back")
eq(P.popButton:GetText(), "Pop out", "and the button pops out again")
win.w, win.h = 0, 0
P.popButton:Click()
local p = win.points[1]
check(p and p[1] == "TOPLEFT" and p[4] == 300 and p[5] == 700 - 1080, "popped out again (or after a reload): where it was")
check(win.w == 1100 and win.h == 520, "at its size")
local minW = Lt.popMinW - 16
check(minW >= Lt.rowW + Lt.barGap + Lt.barW, "the window's smallest size still fits a whole row")
P.popButton:Click()

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Themes.lua', 'CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Controls.lua', 'CRT_Core/UI/Window.lua', 'CRT_Core/UI/ScrollBar.lua',
  'CRT_Core/Gear.lua', 'CRT_Modules/GearChecker/Data.lua', 'CRT_Modules/GearChecker/Inspect.lua', 'CRT_Modules/GearChecker/Comm.lua',
  'CRT_Modules/GearChecker/Page.lua'];
for (const f of files) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
