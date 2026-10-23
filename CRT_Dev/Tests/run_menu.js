// The main window's side menu (CRT_Core/UI/Panel.lua): UI.MENU_GROUPS's four groups and their labels, each
// page under its group's header, the headers in both looks (Default: Blizzard's Settings-menu header art,
// a Modern theme's small muted label over each box), no header over a page, its highlight or the divider,
// the menu fitting the main window, and the scroll path when the groups don't fit.
// Usage: node run_menu.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local coreSrc, themesSrc, panelSrc, scrollSrc, profilesSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
-- prints ok for a part of the test when it added no failure
local sectionFails = 0
local function section(what) if fails == sectionFails then print("ok menu: " .. what) end sectionFails = fails end
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, regions = {}, children = {}, scripts = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self, _, layer, font)
      local fsx = mock("FontString") rawset(fsx, "font", font) rawset(fsx, "text", "") table.insert(self.regions, fsx) return fsx end end
    if k == "CreateTexture" then return function(self, _, layer) local tx = mock("Texture") rawset(tx, "layer", layer) table.insert(self.regions, tx) return tx end end
    if k == "GetRegions" then return function(self) return table.unpack(self.regions) end end
    if k == "GetChildren" then return function(self) return table.unpack(self.children) end end
    if k == "GetObjectType" then return function(self) return self.kind end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "GetScript" then return function(self, n) return self.scripts[n] end end
    if k == "HookScript" then return function(self, n, fn) local old = self.scripts[n] self.scripts[n] = function(...) if old then old(...) end fn(...) end end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 8 end end
    if k == "GetFont" then return function() return "f", 14, "" end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "textColor", { r, g, b }) end end
    if k == "SetFontObject" then return function(self, o) rawset(self, "font", o) end end
    if k == "SetAtlas" then return function(self, a) rawset(self, "atlas", a) end end
    if k == "SetClipsChildren" then return function(self, on) rawset(self, "clips", on) end end
    if k == "EnableMouseWheel" then return function(self, on) rawset(self, "wheel", on) end end
    if k == "SetScrollChild" then return function(self, c) rawset(self, "child", c) end end
    if k == "IsMouseEnabled" then return function() return true end end
    if k == "GetFrameLevel" then return function() return 1 end end
    return function() end end })
end
function CreateFrame(kind, name, parent, template)
  local f = mock(kind) rawset(f, "parent", parent) rawset(f, "template", template)
  if parent and rawget(parent, "children") then table.insert(parent.children, f) end
  if template == "BasicFrameTemplateWithInset" then f:CreateTexture() rawset(f, "CloseButton", mock("Button")) end
  -- UIPanelScrollFrameTemplate's bar and its parts, as UI:SkinScrollBar finds them
  if template == "UIPanelScrollFrameTemplate" then
    local bar = mock("Slider")
    rawset(bar, "ThumbTexture", mock("Texture")) rawset(bar, "ScrollUpButton", mock("Button")) rawset(bar, "ScrollDownButton", mock("Button"))
    rawset(f, "ScrollBar", bar)
  end
  return f
end
function hooksecurefunc(t, name, hook) local old = t[name] rawset(t, name, function(...) old(...) hook(...) end) end
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end
date, time = os.date, os.time
UIParent = mock("UIParent") UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
format = string.format
InCombatLockdown = function() return false end
GetTime = function() return 0 end
C_AddOns = {}
local function fontObject(path, size, flags)
  local o = { path = path, size = size, flags = flags, color = { 1, 1, 1 } }
  function o:CopyFontObject(src) self.path, self.size, self.flags = src.path, src.size, src.flags end
  function o:GetFont() return self.path, self.size, self.flags end
  function o:SetFont(p, s, f) self.path, self.size, self.flags = p, s, f end
  function o:GetTextColor() return self.color[1], self.color[2], self.color[3] end
  function o:SetTextColor(r, g, b) self.color = { r, g, b } end
  return o
end
GameFontNormal = fontObject("Fonts/FRIZQT__.TTF", 12, "") GameFontHighlight = GameFontNormal GameFontDisable = GameFontNormal
GameFontHighlightSmall = fontObject("Fonts/FRIZQT__.TTF", 10, "") GameFontDisableSmall = GameFontHighlightSmall
GameFontNormalLarge = fontObject("Fonts/FRIZQT__.TTF", 16, "")
GameFontNormalSmall = fontObject("Fonts/FRIZQT__.TTF", 10, "") ChatFontNormal = fontObject("Fonts/ARIALN.TTF", 14, "")
LibStub = { GetLibrary = function() end }
function CreateFont(name) local o = fontObject() _G[name] = o return o end
local CRT = {}
local frames = {}
local rawCreate = CreateFrame
CreateFrame = function(...) local f = rawCreate(...) frames[#frames + 1] = f return f end
assert(load(coreSrc, "CRT_Core/Core.lua"))("CowfeeRaidTools", CRT)
assert(load(themesSrc, "CRT_Core/Themes.lua"))("CowfeeRaidTools", CRT)
assert(load(profilesSrc, "CRT_Core/Profiles.lua"))("CowfeeRaidTools", CRT)
CRTDB = {}
for _, f in ipairs(frames) do if f.scripts.OnEvent then f.scripts.OnEvent(f, "ADDON_LOADED", "CowfeeRaidTools") end end
CRT.db.ui.theme, CRT.db.ui.modern = "blizzard", false
CRT:UseTheme("blizzard")
assert(load(panelSrc, "CRT_Core/UI/Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(scrollSrc, "CRT_Core/UI/ScrollBar.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI

-- 1. The groups and their labels, in order.
local want = {
  { "General", "settings", "qol" },
  { "Raid Admin", "readycheck", "groups", "gearcheck", "loot" },
  { "Bosses", "timeline", "notes", "pace" },
  { "Modules", "lootmaster", "requests", "late", "tattle" },
}
check(#UI.MENU_GROUPS == #want, "four menu groups, got " .. #UI.MENU_GROUPS)
for i, w in ipairs(want) do
  local g = UI.MENU_GROUPS[i] or {}
  check(g.label == w[1], "group " .. i .. " is labelled " .. w[1] .. ", got " .. tostring(g.label))
  local keys = table.concat(g, " ")
  check(keys == table.concat(w, " ", 2), w[1] .. " holds " .. table.concat(w, " ", 2) .. ", got " .. keys)
end

section("the four groups, their labels and pages in order")
-- Every page, registered out of the menu's order (as the .toc loads them), plus the Development page,
-- hidden until /crt dev; it joins the last group.
local titles = { settings = "General Settings", qol = "Quality of Life", readycheck = "Ready Check", groups = "Raid Groups",
  gearcheck = "Gear Checker", loot = "Loot History", timeline = "Timeline", notes = "Raid Notes", pace = "Pace",
  lootmaster = "Loot Master", requests = "Requests", late = "Late Tracker", tattle = "Tattlebot", dev = "Development" }
for _, key in ipairs({ "settings", "groups", "readycheck", "notes", "late", "tattle", "timeline", "pace", "gearcheck", "loot", "lootmaster", "requests", "qol", "dev" }) do
  UI:RegisterPage(key, titles[key], function() end)
end
UI:SetPageHidden("dev", true)
local f = UI:Create()
local menu = f.menu
check(menu and menu.inner and menu.scroll, "the menu has its scroll frame and the frame it scrolls")
check(menu.scroll.ScrollBar.crtScroll ~= nil, "the menu's scroll bar goes through UI:SkinScrollBar")
check(menu.scroll.child == menu.inner, "the scroll frame scrolls menu.inner")

local W = UI.PAGE_W and (1200 - 8 - 8 - 8 - UI.PAGE_W) -- the menu's width
local function pointOf(frame) return frame.pts[1] or {} end
-- the y of a frame's TOPLEFT on menu.inner
local function topOf(frame) local p = pointOf(frame) return p[2] == menu.inner and p[5] or nil end

-- Checks one look: every group's header present with its label, its pages under it in order, and nothing
-- overlapping. Returns the layout.
local function checkLook(name, modern)
  local lay = menu.layout
  check(lay ~= nil, name .. ": UI:LayoutMenu keeps its layout")
  if not lay then return end
  local groups = UI.MenuGroups()
  check(#lay.headers == #groups, name .. ": one header per group shown")
  local pageAt = {}
  for _, p in ipairs(lay.pages) do pageAt[p.key] = p end
  local row = UI.MENU_LAYOUT.row
  for i, item in ipairs(lay.headers) do
    local h = menu.headers[i]
    check(h and h.shown, name .. ": header " .. i .. " shows")
    check(h and h.label.text == item.label and item.label == groups[i].label, name .. ": header " .. i .. " reads " .. tostring(groups[i].label))
    check(h and topOf(h) == item.y and h.h == item.h and h.w == lay.width, name .. ": header " .. i .. " sits where the layout puts it")
    check(h and h.clips == true, name .. ": header " .. i .. " clips its art to itself")
    local bottom = item.y - item.h
    local nextTop = lay.headers[i + 1] and lay.headers[i + 1].y or -math.huge
    for n, key in ipairs(groups[i].keys) do
      local p = pageAt[key]
      local b = UI.pages[key].button
      check(p ~= nil, name .. ": " .. key .. " is placed")
      if p then
        check(p.y <= bottom, name .. ": " .. key .. " is under its header, not over it (page top " .. p.y .. ", header bottom " .. bottom .. ")")
        check(p.y - row >= nextTop, name .. ": " .. key .. " ends above the next header")
        check(topOf(b) == p.y, name .. ": " .. key .. "'s button is at its place")
        if n == 1 then check(p.y < bottom or (modern and p.y <= bottom), name .. ": " .. key .. " starts below the header, clear of its highlight") end
        local prev = groups[i].keys[n - 1]
        if prev then check(pageAt[prev] and pageAt[prev].y - row >= p.y, name .. ": " .. key .. " is below " .. prev .. " without overlapping") end
      end
    end
  end
  -- nothing reaches past the menu's right edge into the divider's gap
  check(lay.width <= W, name .. ": the headers are no wider than the menu (" .. lay.width .. " of " .. W .. ")")
  for _, p in ipairs(lay.pages) do check(p.left >= 0 and p.right >= 0, name .. ": " .. p.key .. " stays inside the menu") end
  return lay
end

-- 2. Default: Blizzard: the game's Settings-menu header bars.
UI:ApplyStyle()
local lay = checkLook("Classic", false)
if lay then
  local atlases = {}
  for i, item in ipairs(lay.headers) do
    local h = menu.headers[i]
    atlases[#atlases + 1] = h.art.atlas
    check(h.art.shown, "Classic: header " .. i .. " shows its art")
    check(h.label.font == "CRTFontHighlight", "Classic: header " .. i .. " label in the highlight font")
    -- the art is the whole atlas scaled to the menu's width; its bar is the header's height
    local a = UI.MENU_LAYOUT.classic.art
    check(math.abs(h.art.w - lay.width) < 0.01 and math.abs(h.art.h - lay.width * a.h / a.w) < 0.01, "Classic: header " .. i .. " art keeps the atlas's shape")
    check(math.abs(item.h - lay.width * a.bar / a.w) <= 0.5, "Classic: header " .. i .. " is the art's bar high, " .. item.h)
  end
  check(table.concat(atlases, " ") == "Options_CategoryHeader_1 Options_CategoryHeader_2 Options_CategoryHeader_3 Options_CategoryHeader_1",
    "Classic: the headers take the game's three header atlases in turn: " .. table.concat(atlases, " "))
  for _, bg in ipairs(menu.blocks) do check(not bg.shown, "Classic: no Modern boxes") end
  local b = UI.pages.settings.button
  check(pointOf(b.text)[1] == "LEFT", "Classic: page labels stay on the left")
  check(not lay.scroll and lay.height <= UI.PAGE_H, "Classic: the menu fits the window without scrolling (" .. lay.height .. " of " .. UI.PAGE_H .. ")")
end
section("Default: Blizzard: Settings-menu header bars, pages under them, no overlap, fits")
-- with the Development page shown too
UI:SetPageHidden("dev", false)
lay = checkLook("Classic with Development", false)
if lay then
  check(lay.pages[#lay.pages].key == "dev", "Development joins the last group")
  -- every page, Development included, fits Classic's taller header bars with room to spare
  check(not lay.scroll and lay.height <= UI.PAGE_H - 4, "Classic with Development still fits, with room (" .. lay.height .. " of " .. UI.PAGE_H .. ")")
  check(menu.scroll.wheel == false and menu.inner.h == lay.height, "Classic with Development: no scrolling, the inner frame is the groups' height")
end

section("Development joins the last group and still fits")
-- 3. Each Modern theme: a small label in the muted colour over each group's box.
for _, theme in ipairs({ "midnight", "nitro", "cowfee" }) do
  UI:SetTheme(theme)
  lay = checkLook(theme, true)
  if lay then
    check(#lay.boxes == #lay.headers, theme .. ": one box per group")
    for i, item in ipairs(lay.headers) do
      local h, box, bg = menu.headers[i], lay.boxes[i], menu.blocks[i]
      check(not h.art.shown, theme .. ": header " .. i .. " has no art")
      check(h.label.font == "CRTFontSmall", theme .. ": header " .. i .. " label in the small font")
      local c, m = h.label.textColor, CRT.PALETTE.muted
      check(c and math.abs(c[1] - m[1]) < 0.003 and math.abs(c[2] - m[2]) < 0.003 and math.abs(c[3] - m[3]) < 0.003, theme .. ": header " .. i .. " label in the muted colour")
      check(box and box.y == item.y - item.h, theme .. ": header " .. i .. " sits right above its box")
      check(bg and bg.shown and topOf(bg) == box.y and bg.h == box.h, theme .. ": box " .. i .. " drawn where the layout puts it")
    end
    check(not lay.scroll and lay.height <= UI.PAGE_H, theme .. ": the menu fits without scrolling (" .. lay.height .. " of " .. UI.PAGE_H .. ")")
    check(pointOf(UI.pages.settings.button.text)[1] == "CENTER", theme .. ": page labels centred in their box")
  end
end
UI:SetTheme("blizzard")
check(menu.headers[1].art.shown and not menu.blocks[1].shown, "back to Default: Blizzard: header art again, no boxes")

section("each Modern theme: a muted small label over each box, fits")
-- 4. The scroll path: groups taller than the menu scroll, inside the menu, with the theme's bar.
do
  local groups = UI.MenuGroups()
  for _, modern in ipairs({ false, true }) do
    local name = modern and "Modern" or "Classic"
    local short = UI.MenuLayout(groups, modern, W, 300)
    check(short.scroll == true, name .. ": a 300 px menu scrolls")
    check(short.width == W - UI.ScrollGutter(), name .. ": scrolling leaves room for the bar (" .. short.width .. ")")
    local tall = UI.MenuLayout(groups, modern, W, UI.PAGE_H)
    check(not tall.scroll and tall.width == W, name .. ": the full-height menu doesn't scroll")
    for i = 2, #short.pages do check(short.pages[i - 1].y - UI.MENU_LAYOUT.row >= short.pages[i].y, name .. ": scrolling pages don't overlap") end
  end
  -- many pages: the real menu scrolls
  local extra = {}
  for i = 1, 6 do extra[i] = "extra" .. i UI:RegisterPage(extra[i], "Extra " .. i, function() end) end
  -- a page registered after the window was made gets its button the way UI:Create makes them
  for _, key in ipairs(extra) do
    local b = CreateFrame("Button", nil, menu.inner)
    rawset(b, "sel", b:CreateTexture()) rawset(b, "bar", b:CreateTexture()) rawset(b, "text", b:CreateFontString())
    UI.pages[key].button = b
  end
  for _, theme in ipairs({ "blizzard", "cowfee" }) do
    UI:SetTheme(theme)
    lay = menu.layout
    check(lay.scroll == true and lay.height > UI.PAGE_H, theme .. ": too many pages make the menu scroll")
    local p = menu.scroll.pts[2] or {}
    check(p[1] == "BOTTOMRIGHT" and p[2] == -UI.ScrollGutter(), theme .. ": the scroll frame leaves the bar's room inside the menu")
    check(menu.scroll.wheel == true, theme .. ": the wheel scrolls the menu")
    check(menu.inner.w == lay.width and menu.inner.h == lay.height, theme .. ": the scrolled frame is the groups' size")
    checkLook(theme .. " scrolling", theme ~= "blizzard")
  end
  for _, key in ipairs(extra) do UI:SetPageHidden(key, true) end
  lay = menu.layout
  check(not lay.scroll and menu.scroll.wheel == false, "hiding them again stops the scrolling and frees the wheel")
  local p = menu.scroll.pts[2] or {}
  check(p[1] == "BOTTOMRIGHT" and p[2] == 0, "the scroll frame fills the menu again")
end

section("the scroll path: too many pages scroll inside the menu with the theme's bar")
print(passes .. " passed")
if fails > 0 then print(fails .. " failed") end
MENU_FAILS = fails
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const p of ['CRT_Core/Core.lua', 'CRT_Core/Themes.lua', 'CRT_Core/UI/Panel.lua', 'CRT_Core/UI/ScrollBar.lua', 'CRT_Core/Profiles.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_getglobal(L, to_luastring('MENU_FAILS'));
process.exit(lua.lua_tonumber(L, -1) > 0 ? 1 : 0);
