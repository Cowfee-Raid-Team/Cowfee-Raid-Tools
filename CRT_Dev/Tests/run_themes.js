// CRT_Core/Themes.lua and the theme switch in CRT_Core/UI/Panel.lua: every theme has every palette key,
// the four themes in the menu's order, old saved data mapped to a theme, picking a theme from the title
// bar's button (UI.ContextMenu under it) saving ui.theme and ui.modern and refilling CRT.MOCHA, the
// button's label, the live re-skin, the blackouts' menu bar, matcha text (UI.GoodText), and the pages
// that use it.
// Usage: node run_themes.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local themesSrc, panelSrc, controlsSrc, windowSrc = ...
local unpack = unpack or table.unpack -- the harness runs Lua 5.3
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function near(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end
local function hex(h) return { tonumber(h:sub(1, 2), 16) / 255, tonumber(h:sub(3, 4), 16) / 255, tonumber(h:sub(5, 6), 16) / 255 } end

-- a texture or font string that remembers its colour, alpha, text, points and whether it shows
local function texture(owner, layer)
  local t = { shown = true, alpha = 1, layer = layer, points = {} }
  local m = {
    SetColorTexture = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetVertexColor = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetGradient = function(self, _, from, to) self.gradient = { from, to } end,
    SetTexture = function(self, file) self.file = file end,
    SetAlpha = function(self, a) self.alpha = a end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end, IsShown = function(self) return self.shown end,
    SetText = function(self, text) self.text = text end, GetText = function(self) return self.text end,
    SetTextColor = function(self, r, g, b) self.rgb = { r, g, b } end,
    GetStringWidth = function(self) return #(self.text or "") * 6 end,
    GetUnboundedStringWidth = function(self) return #(self.text or "") * 6 end,
    GetFont = function() return "f", 14, "" end,
    GetObjectType = function() return "Texture" end,
  }
  if owner then owner.textures[#owner.textures + 1] = t end
  return setmetatable(t, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
end
local function frame(kind, parent, template)
  local f = { kind = kind, children = {}, textures = {}, scripts = {}, shown = true, enabled = true, checked = false, points = {} }
  local m = {
    GetObjectType = function(self) return self.kind end,
    GetFrameLevel = function() return 1 end,
    GetChildren = function(self) return unpack(self.children) end,
    GetRegions = function(self) return unpack(self.textures) end,
    CreateTexture = function(self, _, layer) return texture(self, layer) end,
    CreateFontString = function() return texture(nil) end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    HookScript = function(self, k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end fn(...) end end,
    Show = function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end,
    Hide = function(self) self.shown = false end,
    IsShown = function(self) return self.shown end,
    SetShown = function(self, v) self.shown = v and true or false end,
    SetText = function(self, text) self.text = text if self.fs then self.fs.text = text end end,
    GetText = function(self) return self.text end,
    GetFontString = function(self) return self.fs end,
    ClearAllPoints = function(self) self.points = {} end,
    SetPoint = function(self, ...) self.points[#self.points + 1] = { ... } end,
    SetBackdropColor = function(self, r, g, b, a) self.backdrop = { r, g, b, a } end,
    SetBackdropBorderColor = function(self, r, g, b, a) self.border = { r, g, b, a } end,
    Click = function(self) if self.scripts.OnClick then self.scripts.OnClick(self, "LeftButton") end
      if self.scripts.PostClick then self.scripts.PostClick(self, "LeftButton") end end,
  }
  if kind == "CheckButton" then
    m.SetChecked = function(self, on) self.checked = on and true or false end
    m.GetChecked = function(self) return self.checked end
    m.SetEnabled = function(self, on) self.enabled = on and true or false end
    m.Enable = function(self) self.enabled = true end
    m.Disable = function(self) self.enabled = false end
    m.IsEnabled = function(self) return self.enabled end
    local art = {}
    for _, key in ipairs({ "Normal", "Pushed", "Highlight", "Checked", "DisabledChecked" }) do art[key] = texture(nil) end
    f.art = art
    for _, key in ipairs({ "Normal", "Pushed", "Highlight", "Checked", "DisabledChecked", "Disabled" }) do
      m["Get" .. key .. "Texture"] = function() return art[key] end
    end
  end
  if template == "UIPanelButtonTemplate" then
    f.Left, f.Middle, f.Right = texture(nil), texture(nil), texture(nil)
    f.fs = texture(nil)
  elseif template == "InputBoxTemplate" then
    f.Left, f.Middle, f.Right = texture(nil), texture(nil), texture(nil)
  elseif template == "BasicFrameTemplateWithInset" then
    f.CloseButton = frame("Button", nil)
    texture(f) -- the template's own art
  end
  local fields = { Left = true, Middle = true, Right = true, Background = true, Arrow = true, SetupMenu = true, Inset = true, bar = true, fs = true }
  setmetatable(f, { __index = function(_, k) return m[k] or (type(k) == "string" and not fields[k] and k:find("^%u") and function() end) or nil end })
  if parent and parent.children then parent.children[#parent.children + 1] = f end
  return f
end
CreateFrame = function(kind, name, parent, template) return frame(kind, parent, template) end
CreateColor = function(r, g, b, a) return { r, g, b, a } end
hooksecurefunc = function(t, name, hook)
  local old = t[name]
  rawset(t, name, function(...) local r = { old(...) } hook(...) return unpack(r) end)
end
GameTooltip = setmetatable({}, { __index = function() return function() end end })
UIParent = frame("Frame", nil)
MinimalSliderWithSteppersMixin = { Label = { Left = 1, Right = 2 }, Event = { OnValueChanged = 1, OnInteractStart = 2, OnInteractEnd = 3 } }
CreateMinimalSliderFormatter = function(_, fn) return fn end
-- the game's context menu: records the entries a generator makes and the menu frame it returns
local lastMenu
MenuUtil = {
  CreateContextMenu = function(owner, generator)
    local root = { radios = {} }
    function root:AddMenuAcquiredCallback() end
    function root:CreateRadio(text, isSelected, setSelected) self.radios[#self.radios + 1] = { text = text, isSelected = isSelected, setSelected = setSelected } return {} end
    generator(owner, root)
    lastMenu = frame("Frame", nil)
    lastMenu.root, lastMenu.owner = root, owner
    lastMenu.GetFrameStrata = function() return "FULLSCREEN_DIALOG" end
    return lastMenu
  end,
}

local CRT = { db = { ui = { modern = false, layers = {} } } }
local fontsApplied = 0
function CRT:ApplyFonts() fontsApplied = fontsApplied + 1 end
assert(load(themesSrc, "Themes.lua"))("CowfeeRaidTools", CRT)
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(controlsSrc, "Controls.lua"))("CowfeeRaidTools", CRT)
assert(load(windowSrc, "Window.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
local M = CRT.MOCHA

-- Every theme has every key, as { r, g, b } from 0 to 1.
check(#CRT.THEME_KEYS >= 13, "the palette keys are listed")
for _, info in ipairs(CRT.THEME_LIST) do
  local p = CRT.THEMES[info.key]
  check(p ~= nil, info.key .. " has a palette")
  for _, key in ipairs(CRT.THEME_KEYS) do
    local c = p and p[key]
    check(type(c) == "table" and #c == 3 and c[1] >= 0 and c[1] <= 1 and c[2] >= 0 and c[2] <= 1 and c[3] >= 0 and c[3] <= 1,
      info.key .. " has " .. key)
  end
end
for _, key in ipairs({ "espresso", "roast", "edge", "mocha", "caramel", "latte", "cream", "matcha", "walnut", "walnutEdge", "walnutShine", "walnutText", "tick" }) do
  local listed = false
  for _, k in ipairs(CRT.THEME_KEYS) do if k == key then listed = true end end
  check(listed, "THEME_KEYS has " .. key)
end
print("ok themes: every theme has every key")

-- The four themes, in the menu's order, with their names; only Default: Blizzard is Classic.
local want = { { "blizzard", "Default: Blizzard", false }, { "midnight", "Blackout: Midnight", true }, { "nitro", "Blackout: Nitro", true }, { "cowfee", "Beanworks: Cowfee", true } }
check(#CRT.THEME_LIST == 4, "four themes")
for i, w in ipairs(want) do
  local info = CRT.THEME_LIST[i]
  check(info and info.key == w[1] and info.name == w[2] and info.modern == w[3], "theme " .. i .. " is " .. w[2])
end
check(CRT.THEME_LIST[2].menuBar and CRT.THEME_LIST[3].menuBar and not CRT.THEME_LIST[4].menuBar and not CRT.THEME_LIST[1].menuBar, "only the blackouts have the menu bar")

-- The palettes from the job.
local function palette(key, list)
  for k, h in pairs(list) do
    check(near(CRT.THEMES[key][k], type(h) == "string" and hex(h) or h), key .. "." .. k .. " is " .. (type(h) == "string" and ("#" .. h) or "white"))
  end
end
palette("cowfee", { espresso = "17110E", roast = "2B1E17", edge = "5A4231", mocha = "8C4F2B", caramel = "E2A14B", latte = "D9B48A",
  cream = "F4EBDD", matcha = "8FA876", walnut = "4A3424", walnutEdge = "1A120C", walnutShine = "7A5A3E", walnutText = { 1, 1, 1 },
  tick = { 1, 1, 1 }, checkEdge = "1A120C" })
palette("midnight", { espresso = "050505", roast = "121212", edge = "2E2E2E", mocha = "2A2A2A", caramel = "E6E6E6", latte = "BDBDBD",
  cream = "F2F2F2", matcha = "7FBF7F", walnut = "1E1E1E", walnutEdge = "000000", walnutShine = "3A3A3A", tick = "E6E6E6", checkEdge = "E6E6E6" })
palette("nitro", { espresso = "06080A", roast = "11151A", edge = "28313B", mocha = "1E2A36", caramel = "7FB3D9", latte = "A9BBCB",
  cream = "EEF2F5", matcha = "8FCFA0", walnut = "18202A", walnutEdge = "000000", walnutShine = "34414F", tick = "7FB3D9", checkEdge = "7FB3D9" })
-- Default: Blizzard keeps the colours from before themes, so what reads CRT.MOCHA in Classic is unchanged.
local old = { espresso = { 0.11, 0.078, 0.063 }, roast = { 0.165, 0.122, 0.098 }, edge = { 0.30, 0.235, 0.188 }, mocha = { 0.44, 0.31, 0.22 },
  caramel = { 0.78, 0.56, 0.36 }, latte = { 0.87, 0.73, 0.56 }, cream = { 0.95, 0.90, 0.84 }, matcha = "8FA876", walnut = "4A3424",
  walnutEdge = "1A120C", walnutShine = "7A5A3E", walnutText = { 1, 1, 1 }, tick = { 1, 1, 1 }, checkEdge = "1A120C",
  stripTop = { 0.353, 0.247, 0.173 }, stripBottom = { 0.227, 0.165, 0.122 }, note = { 0.80, 0.71, 0.60 } }
for _, key in ipairs(CRT.THEME_KEYS) do check(old[key] ~= nil, "the test knows blizzard's old " .. key) end
palette("blizzard", old)
print("ok themes: the palettes")

-- Old saved data maps to a theme; ui.modern follows the theme.
local function resolve(ui) local key = CRT:ResolveTheme(ui) return key, ui.theme, ui.modern end
local k, t, m = resolve({ modern = true })
check(k == "cowfee" and t == "cowfee" and m == true, "modern = true and no theme loads as cowfee")
k, t, m = resolve({ modern = false })
check(k == "blizzard" and t == "blizzard" and m == false, "modern = false loads as blizzard")
k, t, m = resolve({})
check(k == "blizzard" and m == false, "no look saved loads as blizzard")
k, t, m = resolve({ theme = "nitro", modern = false })
check(k == "nitro" and m == true, "a saved theme wins and sets modern")
k, t, m = resolve({ theme = "blizzard", modern = true })
check(k == "blizzard" and m == false, "blizzard sets modern off")
k, t, m = resolve({ theme = "pure", modern = true })
check(k == "cowfee" and m == true, "an unknown theme falls back by modern")
print("ok themes: old saved data maps to a theme")

-- Controls made before the switch, to see them re-skinned live.
local page = frame("Frame", nil)
local edit = CreateFrame("EditBox", nil, page, "InputBoxTemplate")
local cb = CreateFrame("CheckButton", nil, page, "UICheckButtonTemplate")
UI:SkinTree(page)
UI:SkinEditBox(edit)
cb:SetChecked(true)
local win = CreateFrame("Frame", nil, nil, "BasicFrameTemplateWithInset")
UI:StyleWindow(win)
-- a pop-out made by the shared helper (the Timeline window is one): it follows the theme like any window
UISpecialFrames, tinsert = {}, table.insert
local popout = UI.Window("TestPopout", { kind = "popout", title = "Timeline", layer = "timeline" })
local strip = UI.TitleStrip(frame("Frame", nil), 24)
strip:SetBadge("Boss", "a note", UI.TITLE_STRIP.neutral)
local kept = M.caramel -- a table a caller kept from CRT.MOCHA
local editBg = edit.textures[1]

-- The title bar's theme button.
local bar = frame("Frame", nil)
local lb = UI:MakeThemeButton(bar)
check(UI.lookButton == lb, "the button is UI.lookButton")
check(lb.text == "Default: Blizzard", "the label is the theme in use: " .. tostring(lb.text))
lb:Click()
check(lastMenu ~= nil and lastMenu.owner == lb, "a click opens a menu from the button (UI.ContextMenu)")
local radios = lastMenu and lastMenu.root.radios or {}
check(#radios == 4, "the menu lists four themes")
for i, w in ipairs(want) do
  check(radios[i] and radios[i].text == w[2], "menu entry " .. i .. " is " .. w[2])
end
check(radios[1] and radios[1].isSelected() and not radios[4].isSelected(), "the theme in use is ticked")
local p = lastMenu and lastMenu.points[1]
check(p and p[1] == "TOPRIGHT" and p[2] == lb and p[3] == "BOTTOMRIGHT", "the menu opens under the button")
print("ok themes: the title bar's theme menu")

-- Picking each theme saves it, sets modern, refills CRT.MOCHA, relabels the button and re-skins live.
for i, w in ipairs(want) do
  local before = fontsApplied
  lb:Click()
  lastMenu.root.radios[i].setSelected()
  local key = w[1]
  local pal = CRT.THEMES[key]
  check(CRT.db.ui.theme == key and CRT.db.ui.modern == w[3], "picking " .. w[2] .. " saves theme and modern")
  check(UI:Theme() == key and UI:IsModern() == w[3], "UI:Theme and UI:IsModern follow " .. key)
  local same = true
  for _, k2 in ipairs(CRT.THEME_KEYS) do if not near(M[k2], pal[k2]) then same = false end end
  check(same, "CRT.MOCHA is " .. key .. "'s palette")
  check(CRT.MOCHA == M and M.caramel == kept and near(kept, pal.caramel), "CRT.MOCHA's tables are refilled, so kept ones follow")
  check(lb.text == w[2], "the button's label is " .. w[2])
  check(fontsApplied > before, "the fonts are applied again")
  check(lastMenu.root.radios[i].isSelected(), w[2] .. " is ticked in the menu")
  if w[3] then
    check(editBg.shown and near(editBg.rgb, pal.roast), key .. ": an edit box re-skins to its roast")
    check(win.crtBg.shown and near(win.crtBg.rgb, pal.espresso), key .. ": a window re-skins to its espresso")
    check(popout.crtBg.shown and near(popout.crtBg.rgb, pal.espresso) and not popout.crtArt[1].shown, key .. ": a UI.Window pop-out re-skins to its espresso, no template art")
    check(near(cb.crtCheck.box.edge.fills[1].rgb, pal.checkEdge) and near(cb.crtCheck.tick.rgb, pal.tick), key .. ": a ticked box has its edge and tick")
    check(near(cb.crtCheck.box.face.fills[1].rgb, pal.walnut), key .. ": a ticked box has the knob colour")
    check(near(strip.line.rgb, pal.caramel) and near(strip.title.rgb, pal.cream), key .. ": a title strip's line and title")
    check(near(strip.badge.backdrop, pal.espresso) and near(strip.badge.text.rgb, pal.latte), key .. ": the neutral badge follows the theme")
    check(near(strip.bg.gradient[2], pal.stripTop) and near(strip.bg.gradient[1], pal.stripBottom), key .. ": the strip's gradient")
  else
    check(not editBg.shown and edit.Left.alpha == 1, "Default: Blizzard: the edit box has the game's art")
    check(not win.crtBg.shown and win.crtArt[1].shown, "Default: Blizzard: the window has the template's art")
    check(not popout.crtBg.shown and popout.crtArt[1].shown, "Default: Blizzard: a UI.Window pop-out has the template's art")
    check(cb.art.Normal.alpha == 1, "Default: Blizzard: the checkbox has the game's art")
  end
end
print("ok themes: picking each theme saves it and re-skins live")

-- UI.Tint and UI:OnTheme: a theme change repaints a tinted part, runs the hooks, refreshes the page in
-- view (its OnShow script) and an open window with a refresh.
do
  local tex = texture(nil)
  local box = frame("Frame", nil)
  UI.Tint(tex, "SetColorTexture", "caramel", 0.4)
  UI.Tint(box, "SetBackdropColor", "roast", 0.9)
  UI.Tint(box, "SetBackdropBorderColor", "edge")
  local hooked, pageRefreshed, winRefreshed = 0, 0, 0
  UI:OnTheme(function() hooked = hooked + 1 end)
  UI:OnTheme(function() error("a broken hook") end)
  geterrorhandler = function() return function() end end
  -- the main window, with what UI:ApplyStyle paints
  local mf = frame("Frame", nil)
  mf.art, mf.flat, mf.flatEdges = {}, {}, {}
  mf.flatBg, mf.flatTitle, mf.titleLine, mf.menuLine = texture(nil), texture(nil), texture(nil), texture(nil)
  mf.menu = { blocks = {} }
  UI.frame = mf
  local pf = frame("Frame", nil)
  pf:SetScript("OnShow", function() pageRefreshed = pageRefreshed + 1 end)
  UI.pages.demo = { key = "demo", frame = pf }
  CRT.db.lastPage = "demo"
  local w = UI.windows[1]
  w.refresh = function() winRefreshed = winRefreshed + 1 end
  UI:SetTheme("nitro")
  local n = CRT.THEMES.nitro
  check(near(tex.rgb, n.caramel) and tex.a == 0.4, "a tinted texture takes the new caramel at its alpha")
  check(near(box.backdrop, n.roast) and near(box.border, n.edge), "a tinted backdrop takes both its colors")
  check(hooked == 1, "UI:OnTheme hooks run, even after a broken one")
  check(pageRefreshed == 1, "the page in view refreshes")
  check(winRefreshed == 1, "an open window with a refresh refreshes")
  UI:SetTheme("midnight")
  check(near(tex.rgb, CRT.THEMES.midnight.caramel), "and again on the next theme")
  UI.frame, UI.pages.demo, w.refresh = nil, nil, nil
end
print("ok themes: a theme change repaints tinted parts, hooks, the page and windows")

-- UI:SetModern still works: on picks Beanworks: Cowfee, or keeps a Modern theme in use.
UI:SetTheme("nitro")
UI:SetModern(true)
check(UI:Theme() == "nitro", "SetModern(true) keeps a Modern theme")
UI:SetModern(false)
check(UI:Theme() == "blizzard" and not UI:IsModern(), "SetModern(false) is Default: Blizzard")
UI:SetModern(true)
check(UI:Theme() == "cowfee", "SetModern(true) from Classic is Beanworks: Cowfee")

-- The blackouts' 2 px accent bar left of the selected menu page.
local function menuButton() return { sel = texture(nil), text = texture(nil), bar = texture(nil) } end
for _, w in ipairs(want) do
  UI:SetTheme(w[1])
  local b = menuButton()
  UI:StyleMenuButton(b, true)
  local barOn = b.bar and b.bar.shown
  if w[1] == "midnight" or w[1] == "nitro" then
    check(barOn and near(b.bar.rgb, CRT.THEMES[w[1]].caramel), w[2] .. ": the selected page has the accent bar")
    local other = menuButton()
    UI:StyleMenuButton(other, false)
    check(not other.bar.shown, w[2] .. ": only the selected page has it")
  else
    check(not barOn, w[2] .. ": no accent bar")
  end
end
print("ok themes: the blackouts' menu bar")

-- Matcha text for good states.
UI:SetTheme("cowfee")
check(UI.GoodText("on", "80ff80") == "|cff8fa876on|r", "Modern: good text is matcha: " .. UI.GoodText("on", "80ff80"))
UI:SetTheme("nitro")
check(UI.GoodText("on") == "|cff8fcfa0on|r", "Nitro: its own matcha")
UI:SetTheme("blizzard")
check(UI.GoodText("on", "80ff80") == "|cff80ff80on|r", "Classic keeps its green")
check(UI.GoodText("on") == "on", "Classic with no colour leaves the text as it is")
print("ok themes: matcha for good states")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " theme checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// The pages that show a good state use UI.GoodText (matcha in a Modern theme).
let srcFails = 0;
for (const [file, what] of [
  ['CRT_Modules/Groups/Page.lua', 'the active layout'],
  ['CRT_Modules/Late/Page.lua', 'on time'],
  ['CRT_Modules/Tattlebot/Page.lua', 'tracked as'],
  ['CRT_Modules/LootMaster/Page.lua', 'CRT Looting on, synced to'],
  ['CRT_Modules/LootMaster/Window.lua', 'everyone answered'],
]) {
  if (read(file).includes('UI.GoodText')) console.log('ok themes: ' + file + ' uses UI.GoodText (' + what + ')');
  else { console.log('FAIL ' + file + ' does not use UI.GoodText (' + what + ')'); srcFails++; }
}
// The toc loads Themes.lua right after Core.lua, before anything reads CRT.MOCHA.
const toc = read('CowfeeRaidTools.toc').split(/\r?\n/);
const core = toc.indexOf('CRT_Core\\Core.lua');
if (core >= 0 && toc[core + 1] === 'CRT_Core\\Themes.lua') console.log('ok themes: the toc loads Themes.lua after Core.lua');
else { console.log('FAIL the toc does not load CRT_Core\\Themes.lua right after Core.lua'); srcFails++; }
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/Themes.lua', 'CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Controls.lua', 'CRT_Core/UI/Window.lua']) {
  lua.lua_pushstring(L, to_luastring(read(f)));
}
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
if (srcFails > 0) process.exit(1);
