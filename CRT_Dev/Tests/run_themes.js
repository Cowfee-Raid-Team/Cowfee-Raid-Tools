// CRT_Core/Themes.lua and the theme switch in CRT_Core/UI/Panel.lua: every theme has every palette key,
// the four themes in the menu's order, old saved data mapped to a theme, picking a theme from the title
// bar's button (UI.ContextMenu under it) saving ui.theme and ui.modern and refilling CRT.PALETTE, the
// button's label, the live re-skin, the blackouts' menu bar, good text (UI.GoodText), and the pages
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
FRAME_PIECES = { "TopLeftCorner", "TopRightCorner", "TopBorder", "BotLeftCorner", "BotRightCorner", "BottomBorder",
  "LeftBorder", "RightBorder", "Bg", "TitleBg", "TopTileStreaks" }
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
    -- and its border and title pieces by name, as the game's BaseBasicFrameTemplate and BasicFrameTemplate
    -- make them (Blizzard_UIPanelTemplates/Mainline/UIPanelTemplates.xml)
    for _, key in ipairs(FRAME_PIECES) do f[key] = texture(f) end
  elseif template == "UIPanelScrollFrameTemplate" then
    f.ScrollBar = frame("Slider", f)
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
local M = CRT.PALETTE

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
for _, key in ipairs({ "background", "surface", "border", "selected", "accent", "label", "heading", "text", "good", "warn", "bad", "knob", "knobBorder", "knobShine", "knobText", "check" }) do
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
palette("cowfee", { background = "17110E", surface = "2B1E17", border = "5A4231", selected = "8C4F2B", accent = "E2A14B", label = "D9B48A",
  heading = "D9B48A", text = "F4EBDD", good = "8FA876", warn = "F2C14E", bad = "C8553D", knob = "4A3424", knobBorder = "1A120C", knobShine = "7A5A3E", knobText = { 1, 1, 1 },
  check = { 1, 1, 1 }, checkBorder = "1A120C", outline = "17110E" })
palette("midnight", { background = "050505", surface = "121212", border = "2E2E2E", selected = "2A2A2A", accent = "E6E6E6", label = "BDBDBD",
  heading = "BDBDBD", text = "F2F2F2", good = "7FBF7F", warn = "E6B450", bad = "E06C6C", knob = "1E1E1E", knobBorder = "000000", knobShine = "3A3A3A", check = "E6E6E6", checkBorder = "E6E6E6", outline = "000000" })
palette("nitro", { background = "06080A", surface = "11151A", border = "28313B", selected = "1E2A36", accent = "7FB3D9", label = "A9BBCB",
  heading = "A9BBCB", text = "EEF2F5", good = "8FCFA0", warn = "F0C060", bad = "FF7F6B", knob = "18202A", knobBorder = "000000", knobShine = "34414F", check = "7FB3D9", checkBorder = "7FB3D9", outline = "000000" })
-- Default: Blizzard keeps the colours from before themes, so what reads CRT.PALETTE in Classic is unchanged;
-- its heading, good, warn and bad are the game's gold, green, orange and red (the fallbacks, with no game globals here).
local old = { background = { 0.11, 0.078, 0.063 }, surface = { 0.165, 0.122, 0.098 }, border = { 0.30, 0.235, 0.188 }, selected = { 0.44, 0.31, 0.22 },
  accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, text = { 0.95, 0.90, 0.84 }, heading = { 1, 0.82, 0 }, good = "19FF19",
  warn = "FF8040", bad = "FF2020", knob = "4A3424",
  knobBorder = "1A120C", knobShine = "7A5A3E", knobText = { 1, 1, 1 }, check = { 1, 1, 1 }, checkBorder = "1A120C",
  titleTop = { 0.353, 0.247, 0.173 }, titleBottom = { 0.227, 0.165, 0.122 }, muted = { 0.80, 0.71, 0.60 },
  outline = "1A120C" } -- the darkest colour (the knob's edge), for the alert bars' Border
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
local kept = M.accent -- a table a caller kept from CRT.PALETTE
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

-- Picking each theme saves it, sets modern, refills CRT.PALETTE, relabels the button and re-skins live.
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
  check(same, "CRT.PALETTE is " .. key .. "'s palette")
  check(CRT.PALETTE == M and M.accent == kept and near(kept, pal.accent), "CRT.PALETTE's tables are refilled, so kept ones follow")
  check(lb.text == w[2], "the button's label is " .. w[2])
  check(fontsApplied > before, "the fonts are applied again")
  check(lastMenu.root.radios[i].isSelected(), w[2] .. " is ticked in the menu")
  if w[3] then
    check(editBg.shown and near(editBg.rgb, pal.surface), key .. ": an edit box re-skins to its surface")
    check(win.crtBg.shown and near(win.crtBg.rgb, pal.background), key .. ": a window re-skins to its background")
    check(popout.crtBg.shown and near(popout.crtBg.rgb, pal.background) and not popout.crtArt[1].shown, key .. ": a UI.Window pop-out re-skins to its background, no template art")
    local anyPiece = false
    for _, k2 in ipairs(FRAME_PIECES) do if popout[k2].shown then anyPiece = true end end
    check(not anyPiece and popout.crtEdges[1].shown, key .. ": a UI.Window has its flat edge, none of the template's border")
    check(near(cb.crtCheck.box.edge.fills[1].rgb, pal.checkBorder) and near(cb.crtCheck.tick.rgb, pal.check), key .. ": a ticked box has its edge and tick")
    check(near(cb.crtCheck.box.face.fills[1].rgb, pal.knob), key .. ": a ticked box has the knob colour")
    check(near(strip.line.rgb, pal.accent) and near(strip.title.rgb, pal.text), key .. ": a title strip's line and title")
    check(near(strip.badge.backdrop, pal.background) and near(strip.badge.text.rgb, pal.label), key .. ": the neutral badge follows the theme")
    check(near(strip.bg.gradient[2], pal.titleTop) and near(strip.bg.gradient[1], pal.titleBottom), key .. ": the strip's gradient")
  else
    check(not editBg.shown and edit.Left.alpha == 1, "Default: Blizzard: the edit box has the game's art")
    check(not win.crtBg.shown and win.crtArt[1].shown, "Default: Blizzard: the window has the template's art")
    check(not popout.crtBg.shown and popout.crtArt[1].shown, "Default: Blizzard: a UI.Window pop-out has the template's art")
    -- the metal border and title art, piece by piece, the same as the main window's, and no flat edge over it
    for _, key in ipairs(FRAME_PIECES) do
      local t = popout[key]
      check(t and t.shown and t.alpha == 1, "Default: Blizzard: a UI.Window's " .. key .. " shows")
    end
    for _, edge in ipairs(popout.crtEdges) do check(not edge.shown, "Default: Blizzard: no flat 1 px edge on a UI.Window") end
    check(not popout.crtTitle.shown and not popout.crtTitleLine.shown and not popout.strip.bg.shown and not popout.strip.bar.shown,
      "Default: Blizzard: nothing of the window or its strip covers the template's title art")
    check(cb.art.Normal.alpha == 1, "Default: Blizzard: the checkbox has the game's art")
  end
end
print("ok themes: picking each theme saves it and re-skins live")

-- UI.Tint and UI:OnTheme: a theme change repaints a tinted part, runs the hooks, refreshes the page in
-- view (its OnShow script) and an open window with a refresh.
do
  local tex = texture(nil)
  local box = frame("Frame", nil)
  UI.Tint(tex, "SetColorTexture", "accent", 0.4)
  UI.Tint(box, "SetBackdropColor", "surface", 0.9)
  UI.Tint(box, "SetBackdropBorderColor", "border")
  local hooked, pageRefreshed, winRefreshed = 0, 0, 0
  UI:OnTheme(function() hooked = hooked + 1 end)
  UI:OnTheme(function() error("a broken hook") end)
  geterrorhandler = function() return function() end end
  -- the main window, with what UI:ApplyStyle paints
  local mf = frame("Frame", nil)
  mf.art, mf.flat, mf.flatEdges = {}, {}, {}
  mf.flatBg, mf.flatTitle, mf.titleLine = texture(nil), texture(nil), texture(nil)
  mf.divider = { line = texture(nil), shadow = texture(nil) }
  mf.menu = UI:CreateMenu(mf)
  UI.frame = mf
  local pf = frame("Frame", nil)
  pf:SetScript("OnShow", function() pageRefreshed = pageRefreshed + 1 end)
  UI.pages.demo = { key = "demo", frame = pf }
  CRT.db.lastPage = "demo"
  local w = UI.windows[1]
  w.refresh = function() winRefreshed = winRefreshed + 1 end
  UI:SetTheme("nitro")
  local n = CRT.THEMES.nitro
  check(near(tex.rgb, n.accent) and tex.a == 0.4, "a tinted texture takes the new accent at its alpha")
  check(near(box.backdrop, n.surface) and near(box.border, n.border), "a tinted backdrop takes both its colors")
  check(hooked == 1, "UI:OnTheme hooks run, even after a broken one")
  check(pageRefreshed == 1, "the page in view refreshes")
  check(winRefreshed == 1, "an open window with a refresh refreshes")
  UI:SetTheme("midnight")
  check(near(tex.rgb, CRT.THEMES.midnight.accent), "and again on the next theme")
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
    check(barOn and near(b.bar.rgb, CRT.THEMES[w[1]].accent), w[2] .. ": the selected page has the accent bar")
    local other = menuButton()
    UI:StyleMenuButton(other, false)
    check(not other.bar.shown, w[2] .. ": only the selected page has it")
  else
    check(not barOn, w[2] .. ": no accent bar")
  end
end
print("ok themes: the blackouts' menu bar")

-- One heading, good, warn and bad colour per theme, the same everywhere in it (the mockup Alex approved; warn
-- from the style guide job).
local mock = {
  blizzard = { heading = "ffd100", good = "19ff19", warn = "ff8040", bad = "ff2020" },
  cowfee = { heading = "d9b48a", good = "8fa876", warn = "f2c14e", bad = "c8553d" },
  midnight = { heading = "bdbdbd", good = "7fbf7f", warn = "e6b450", bad = "e06c6c" },
  nitro = { heading = "a9bbcb", good = "8fcfa0", warn = "f0c060", bad = "ff7f6b" },
}
for key, m in pairs(mock) do
  UI:SetTheme(key)
  check(UI.GoodText("on") == "|cff" .. m.good .. "on|r", key .. ": good text: " .. UI.GoodText("on"))
  check(UI.WarnText and UI.WarnText("low") == "|cff" .. m.warn .. "low|r", key .. ": warn text: " .. tostring(UI.WarnText and UI.WarnText("low")))
  check(m.warn ~= m.heading and m.warn ~= m.bad and m.warn ~= m.good, key .. ": warn is its own colour")
  check(UI.BadText("late") == "|cff" .. m.bad .. "late|r", key .. ": bad text: " .. UI.BadText("late"))
  check(UI.HeadingText("Raid") == "|cff" .. m.heading .. "Raid|r", key .. ": heading text: " .. UI.HeadingText("Raid"))
  check(UI.Hex("bad") == m.bad and UI.ColorText("x", "good") == "|cff" .. m.good .. "x|r", key .. ": UI.Hex and UI.ColorText")
  local r, g, b, a = UI.Color("heading")
  check(near({ r, g, b }, hex(m.heading)) and a == 1, key .. ": UI.Color gives the heading")
  local _, _, _, a2 = UI.Color("bad", 0.5)
  check(a2 == 0.5, key .. ": UI.Color passes the alpha on")
end
print("ok themes: one heading, good, warn and bad colour per theme")

-- A live switch repaints a tinted heading and a UI.ThemedText line.
do
  UI:SetTheme("blizzard")
  local head, line = texture(nil), texture(nil)
  UI.Tint(head, "SetTextColor", "heading")
  UI.ThemedText(line, function() return UI.GoodText("Ready") .. " " .. UI.BadText("Missing") end)
  check(near(head.rgb, { 1, 0.82, 0 }), "Default: Blizzard: a tinted heading is the game's gold")
  check(line.text == "|cff19ff19Ready|r |cffff2020Missing|r", "Default: Blizzard: a themed text: " .. tostring(line.text))
  UI:SetTheme("nitro")
  check(near(head.rgb, hex("A9BBCB")), "Nitro: the tinted heading repaints")
  check(line.text == "|cff8fcfa0Ready|r |cffff7f6bMissing|r", "Nitro: the themed text is rebuilt: " .. tostring(line.text))
  -- UI.ThemedText(fs, nil) stops it: the text stays as it is and a switch no longer rebuilds it
  UI.ThemedText(line, nil)
  line:SetText("plain")
  UI:SetTheme("cowfee")
  check(line.text == "plain", "an unregistered themed text is left alone: " .. tostring(line.text))
end
print("ok themes: a live switch repaints headings and themed texts")

-- Themes.lua reads the game's own text colours when the game has them.
do
  local saved = { NORMAL_FONT_COLOR, GREEN_FONT_COLOR, RED_FONT_COLOR, ORANGE_FONT_COLOR }
  local function color(r, g, b) return { GetRGB = function() return r, g, b end } end
  NORMAL_FONT_COLOR, GREEN_FONT_COLOR, RED_FONT_COLOR = color(1, 0.824, 0), color(0.098, 1, 0.098), color(1, 0.125, 0.125)
  ORANGE_FONT_COLOR = color(1, 0.5, 0.25)
  local C2 = { db = { ui = {} } }
  assert(load(themesSrc, "Themes.lua"))("CowfeeRaidTools", C2)
  local b = C2.THEMES.blizzard
  check(near(b.heading, { 1, 0.824, 0 }) and near(b.good, { 0.098, 1, 0.098 }) and near(b.bad, { 1, 0.125, 0.125 }),
    "Default: Blizzard reads NORMAL_FONT_COLOR, GREEN_FONT_COLOR and RED_FONT_COLOR")
  check(near(b.warn, { 1, 0.5, 0.25 }), "Default: Blizzard's warn reads ORANGE_FONT_COLOR")
  GREEN_FONT_COLOR = { GetRGB = function() error("no") end }
  ORANGE_FONT_COLOR = nil
  C2 = { db = { ui = {} } }
  assert(load(themesSrc, "Themes.lua"))("CowfeeRaidTools", C2)
  check(near(C2.THEMES.blizzard.good, hex("19FF19")), "a broken game colour falls back")
  check(near(C2.THEMES.blizzard.warn, hex("FF8040")), "no ORANGE_FONT_COLOR: warn falls back to the game's orange")
  NORMAL_FONT_COLOR, GREEN_FONT_COLOR, RED_FONT_COLOR, ORANGE_FONT_COLOR = saved[1], saved[2], saved[3], saved[4]
end
print("ok themes: the game's own colours")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " theme checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// The pages that show a good state use UI.GoodText (good in a Modern theme).
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
// The style guide (CRT_Dev/StyleGuide.md): warning states in the theme's warn colour; the colours that are not the
// theme's stay as they were; a raider's response buttons come only from the looter's set. Each is one line of code.
for (const [file, re, what] of [
  ['CRT_Modules/Consumables/Bar.lua', /^\s*low = CRT\.PALETTE\.warn,/m, 'your bar: running low ants in warn'],
  ['CRT_Modules/Consumables/Bar.lua', /slot\.time:SetTextColor\(CRT\.UI\.Color\("warn"\)\)/, 'your bar: the running low time in warn'],
  ['CRT_Modules/ReadyCheck/Window.lua', /percent < 80 and CRT\.UI\.WarnText\(text\)/, 'ready check window: durability under 80% in warn'],
  ['CRT_Modules/ReadyCheck/Window.lua', /cell\.text:SetText\(CRT\.UI\.WarnText\(c\.left/, 'ready check window: a buff running low in warn'],
  ['CRT_Modules/ReadyCheck/BuffLock.lua', /UI\.Tint\(cover\.hint, "SetTextColor", "warn"\)/, 'the buff lock hint in warn'],
  ['CRT_Modules/LootMaster/Page.lua', /s >= 70 and UI\.WarnText\(s\)/, 'Loot Master: scores 70-89 in warn'],
  ['CRT_Modules/LootMaster/Window.lua', /return UI\.WarnText\(TEXT\.nocrt\)/, 'Loot Master: no CRT in warn'],
  ['CRT_Modules/LootMaster/RaiderWindow.lua', /return UI\.WarnText\(TEXT\.nocrt\)/, 'All Loot Rolls: no CRT in warn'],
  ['CRT_Modules/Late/Page.lua', /UI\.WarnText\("Arrived late \("/, 'Late Tracker: Arrived late in warn'],
  ['CRT_Modules/Late/Page.lua', /UI\.WarnText\("Late \("/, 'Late Tracker: a past night\'s Late in warn'],
  ['CRT_Modules/Late/Page.lua', /UI\.WarnText\("\+" \.\. minutes/, 'Late Tracker: the grid\'s minutes late in warn'],
  ['CRT_Modules/Late/Page.lua', /UI\.WarnText\(minutes\(Late\.Seconds\(night, p\)\) \.\. " late"\)/, 'Late Tracker: a player\'s minutes late in warn'],
  ['CRT_Modules/Timeline/ReferencePage.lua', /saved\.warnings\[1\]\)\s*\n\s*status:SetTextColor\(UI\.Color\("warn"\)\)/, 'ability timeline: saved with warnings in warn'],
  ['CRT_Modules/Tattlebot/Page.lua', /"\|cffff8060" \.\. Tattle\.Short\(data\.damage\) \.\. "\|r".*not a theme colour/, 'Tattlebot: the totals\' damage orange again'],
  ['CRT_Modules/Tattlebot/Page.lua', /\|cffff8060%s\|r on %d.*not a theme colour/, 'Tattlebot: the scan\'s damage orange again'],
  ['CRT_Modules/LootMaster/Page.lua', /looting:SetText\(on and UI:IsModern\(\) and UI\.GoodText\(line\) or line\).*not a theme colour/, 'Loot Master: the looting line as before themes'],
  ['CRT_Modules/LootMaster/Page.lua', /LM:SyncStatus\(UI:IsModern\(\) and UI\.GoodText or nil\).*not a theme colour/, 'Loot Master: the synced to line as before themes'],
  ['CRT_Modules/LootMaster/Window.lua', /answered >= expected\) and UI:IsModern\(\) and UI\.GoodText\(count\) or count\).*not a theme colour/, 'Loot Master: the all-answered count as before themes'],
  ['CRT_Modules/GearChecker/Page.lua', /^\s*low = CRT\.PALETTE\.warn,/m, 'Gear Checker: a low item in warn'],
  ['CRT_Modules/GearChecker/Page.lua', /^\s*bad = CRT\.PALETTE\.bad,/m, 'Gear Checker: missing in the theme\'s bad'],
  ['CRT_Modules/GearChecker/Page.lua', /^\s*good = CRT\.PALETTE\.good,/m, 'Gear Checker: enchanted in the theme\'s good'],
]) {
  if (re.test(read(file))) console.log('ok themes: ' + what);
  else { console.log('FAIL ' + file + ': ' + what); srcFails++; }
}
if (/BadText\(Tattle\.Short/.test(read('CRT_Modules/Tattlebot/Page.lua'))) { console.log('FAIL Tattlebot damage is not a theme colour'); srcFails++; }
// A raider's popup and All Loot Rolls window colour the buttons from the session the looter sent (Comm.lua's B part),
// never from the raider's own saved set.
for (const file of ['CRT_Modules/LootMaster/Popup.lua', 'CRT_Modules/LootMaster/RaiderWindow.lua']) {
  if (/LM:Responses?\(/.test(read(file))) { console.log('FAIL ' + file + ' reads your own response set'); srcFails++; }
  else console.log('ok themes: ' + file + ' takes its response colours from the looter\'s session');
}
// Overlays are not refreshed with the page in view, so each repaints on a theme switch itself: an OnTheme hook,
// a UI.Tint or a UI.ThemedText. (Live switches are checked in the harnesses that build them: run_breaktimer, run_latepage,
// run_groups_extras, run_lootmaster_bosswin, run_alerts_personalwin, run_alerts_editor, run_consumables_dock. The debuff
// panel has no theme colour: its countdown is the approved yellow in every theme.)
for (const [file, what] of [
  ['CRT_Modules/Notes/Window.lua', 'the note windows'],
  ['CRT_Modules/Notes/Alert.lua', 'the note callout'],
  ['CRT_Modules/Consumables/Display.lua', 'your bar'],
  ['CRT_Modules/ReadyCheck/BuffLock.lua', 'the buff lock hint'],
  ['CRT_Modules/ReadyCheck/Window.lua', 'the ready check window'],
  ['CRT_Modules/QoL/LowHealth.lua', 'the low-health warning'],
  ['CRT_Modules/QoL/BreakTimer.lua', 'the break timer'],
  ['CRT_Modules/Pace/Display.lua', 'the pace bars'],
  ['CRT_Modules/Alerts/Areas.lua', 'the alert areas'],
]) {
  if (/OnTheme\(|UI\.Tint\(|UI\.ThemedText\(/.test(read(file))) console.log('ok themes: ' + file + ' repaints on a theme switch (' + what + ')');
  else { console.log('FAIL ' + file + ' has no theme hook (' + what + ')'); srcFails++; }
}
// The toc loads Themes.lua right after Core.lua, before anything reads CRT.PALETTE.
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
