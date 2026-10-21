// CRT_Core/UI/ScrollBar.lua's UI:SkinScrollBar: one scroll bar look per theme (THEME_LIST's scrollBar)
// over stand-ins of the game's two scroll bars, MinimalScrollBar and UIPanelScrollFrameTemplate's
// UIPanelScrollBarTemplate: Default: Blizzard keeps the game's art, Blackout: Midnight a grey rail with a
// square accent thumb, Blackout: Nitro a framed track with an accent thumb and a faint tick under it,
// Beanworks: Cowfee a rounded track with the rounded walnut thumb; no arrow buttons in the Modern themes;
// hover lightens the thumb; a live theme switch both ways. Then a scan of the addon: every scroll bar
// made from those templates goes through UI:SkinScrollBar.
// Usage: node run_scrollbar.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local themesSrc, panelSrc, controlsSrc, scrollSrc = ...
local unpack = unpack or table.unpack -- the harness runs Lua 5.3
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function near(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end

-- a texture that remembers its colour, alpha, size and whether it shows
local function texture(owner, layer, sublevel)
  local t = { shown = true, alpha = 1, layer = layer, sublevel = sublevel, points = {} }
  local m = {
    SetColorTexture = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 self.file = nil end,
    SetVertexColor = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetTexture = function(self, file) self.file = file end,
    SetAtlas = function(self, atlas) self.atlas = atlas end,
    SetAlpha = function(self, a) self.alpha = a end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end, IsShown = function(self) return self.shown end,
    SetWidth = function(self, w) self.w = w end, SetHeight = function(self, h) self.h = h end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetPoint = function(self, ...) self.points[#self.points + 1] = { ... } end,
    SetAllPoints = function(self, to) self.allPoints = to or true end,
    GetObjectType = function() return "Texture" end,
  }
  if owner then owner.textures[#owner.textures + 1] = t end
  return setmetatable(t, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
end
local function frame(kind, parent)
  local f = { kind = kind, children = {}, textures = {}, scripts = {}, shown = true, mouse = true, alpha = 1, points = {} }
  local m = {
    GetObjectType = function(self) return self.kind end,
    GetChildren = function(self) return unpack(self.children) end,
    GetRegions = function(self) return unpack(self.textures) end,
    CreateTexture = function(self, _, layer, _, sublevel) return texture(self, layer, sublevel) end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    HookScript = function(self, k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end fn(...) end end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end, IsShown = function(self) return self.shown end,
    SetAlpha = function(self, a) self.alpha = a end, GetAlpha = function(self) return self.alpha end,
    EnableMouse = function(self, on) self.mouse = on and true or false end,
    IsMouseEnabled = function(self) return self.mouse end,
  }
  setmetatable(f, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and not k:find("^Track") and function() end) or nil end })
  if parent then parent.children[#parent.children + 1] = f end
  return f
end
-- MinimalScrollBar (Blizzard_SharedXML/Shared/Scroll/MinimalScrollBar.xml): Track with Begin, Middle, End;
-- Track.Thumb with Begin, Middle, End; the Back and Forward steppers
local function minimalScrollBar(parent)
  local bar = frame("EventFrame", parent)
  bar.Track = frame("Frame", bar)
  for _, k in ipairs({ "Begin", "Middle", "End" }) do bar.Track[k] = texture(bar.Track, "ARTWORK") end
  bar.Track.Thumb = frame("Button", bar.Track)
  for _, k in ipairs({ "Begin", "Middle", "End" }) do bar.Track.Thumb[k] = texture(bar.Track.Thumb, "ARTWORK") end
  bar.Back = frame("Button", bar)
  bar.Forward = frame("Button", bar)
  return bar
end
-- UIPanelScrollFrameTemplate (Blizzard_SharedXML/SecureScrollTemplates.xml): a ScrollFrame whose ScrollBar is
-- a UIPanelScrollBarTemplate Slider with ThumbTexture, ScrollUpButton and ScrollDownButton
local function panelScrollFrame(parent)
  local scroll = frame("ScrollFrame", parent)
  local bar = frame("Slider", scroll)
  bar.ThumbTexture = texture(bar, "ARTWORK")
  bar.GetThumbTexture = function(self) return self.ThumbTexture end
  bar.ScrollUpButton = frame("Button", bar)
  bar.ScrollDownButton = frame("Button", bar)
  scroll.ScrollBar = bar
  return scroll
end
CreateFrame = function(kind, _, parent) return frame(kind, parent) end
hooksecurefunc = function(t, name, hook)
  local old = t[name]
  rawset(t, name, function(...) local r = { old(...) } hook(...) return unpack(r) end)
end
GameTooltip = setmetatable({}, { __index = function() return function() end end })
MinimalSliderWithSteppersMixin = { Label = { Left = 1, Right = 2 }, Event = { OnValueChanged = 1, OnInteractStart = 2, OnInteractEnd = 3 } }
CreateMinimalSliderFormatter = function(_, fn) return fn end

local CRT = { db = { ui = { modern = false, theme = "blizzard", layers = {} } } }
function CRT:ApplyFonts() end
assert(load(themesSrc, "Themes.lua"))("CowfeeRaidTools", CRT)
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(controlsSrc, "Controls.lua"))("CowfeeRaidTools", CRT)
assert(load(scrollSrc, "ScrollBar.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
local M = CRT.MOCHA
UI.pages = UI.pages or {}

check(type(UI.SkinScrollBar) == "function", "UI:SkinScrollBar exists")
if not UI.SkinScrollBar then print(passes .. " passed, " .. fails .. " failed") error("no SkinScrollBar") end

-- each Modern theme names its scroll bar look; Default: Blizzard has none (the game's art)
local looks = {}
for _, info in ipairs(CRT.THEME_LIST) do looks[info.key] = info.scrollBar end
check(looks.blizzard == nil, "Default: Blizzard has no scroll bar look of its own")
check(looks.midnight == "rail" and looks.nitro == "framed" and looks.cowfee == "rounded", "Midnight a rail, Nitro framed, Cowfee rounded")
check(UI.SCROLL_BAR_LOOKS and UI.SCROLL_BAR_LOOKS.rail and UI.SCROLL_BAR_LOOKS.framed and UI.SCROLL_BAR_LOOKS.rounded, "the looks' sizes are in UI.SCROLL_BAR_LOOKS")

UI:SetTheme("blizzard")
local page = frame("Frame", nil)
local mini = minimalScrollBar(page)
local panel = panelScrollFrame(page).ScrollBar
local before = #UI.skinned
UI:SkinScrollBar(mini)
UI:SkinScrollBar(panel)
check(#UI.skinned == before + 2, "both scroll bars follow the theme (UI.skinned)")
UI:SkinScrollBar(mini)
check(#UI.skinned == before + 2, "skinning twice adds it once")
UI:SkinScrollBar(frame("Frame", page))
UI:SkinScrollBar(nil)
check(#UI.skinned == before + 2, "a frame that isn't a known scroll bar is left alone")
local sm, sp = mini.crtScroll, panel.crtScroll
check(sm ~= nil and sp ~= nil, "the skin's parts are kept on bar.crtScroll")

local function gameArt(bar)
  if rawget(bar, "Track") then return { bar.Track.Begin, bar.Track.Middle, bar.Track.End, bar.Track.Thumb.Begin, bar.Track.Thumb.Middle, bar.Track.Thumb.End } end
  return { bar.ThumbTexture }
end
local function buttons(bar) if rawget(bar, "Back") then return { bar.Back, bar.Forward } end return { bar.ScrollUpButton, bar.ScrollDownButton } end
local function artShows(bar) for _, t in ipairs(gameArt(bar)) do if t.alpha ~= 1 then return false end end return true end
local function artHidden(bar) for _, t in ipairs(gameArt(bar)) do if t.alpha ~= 0 then return false end end return true end
local function buttonsShow(bar) for _, b in ipairs(buttons(bar)) do if b.alpha ~= 1 or not b.mouse then return false end end return true end
local function buttonsHidden(bar) for _, b in ipairs(buttons(bar)) do if b.alpha ~= 0 or b.mouse then return false end end return true end
-- every texture the skin drew, shown ones only
local function drawn(bar)
  local n = 0
  for _, look in pairs(bar.crtScroll.looks) do
    for _, list in ipairs({ look.track, look.thumb }) do for _, t in ipairs(list) do if t.shown then n = n + 1 end end end
  end
  return n
end
local function blizzardLook(bar, name)
  check(artShows(bar), name .. ", Default: Blizzard: the game's track and thumb show")
  check(buttonsShow(bar), name .. ", Default: Blizzard: the arrow buttons show and take clicks")
  check(drawn(bar) == 0, name .. ", Default: Blizzard: nothing of the skin shows")
end
blizzardLook(mini, "MinimalScrollBar")
blizzardLook(panel, "UIPanelScrollBar")

-- Blackout: Midnight: a 2 px rail in edge grey, a square accent thumb, no arrow buttons.
UI:SetTheme("midnight")
for _, case in ipairs({ { mini, "MinimalScrollBar" }, { panel, "UIPanelScrollBar" } }) do
  local bar, name = case[1], case[2]
  local look = bar.crtScroll.looks.rail
  check(look ~= nil and bar.crtScroll.style == "rail", name .. ": Midnight uses the rail")
  check(artHidden(bar), name .. ", Midnight: the game's track and thumb are hidden")
  check(buttonsHidden(bar), name .. ", Midnight: no arrow buttons (faded, no clicks)")
  check(look.rail.shown and look.rail.w == 2 and near(look.rail.rgb, M.edge), name .. ", Midnight: a 2 px edge grey rail")
  check(look.thumbFace.shown and near(look.thumbFace.rgb, M.caramel) and near(M.caramel, CRT.THEMES.midnight.caramel), name .. ", Midnight: an accent (white) thumb")
  check(look.thumbFace.file == nil and look.thumbFace.w == UI.SCROLL_BAR_LOOKS.rail.thumb, name .. ", Midnight: a square thumb, a flat colour of its own width")
end

-- Blackout: Nitro: a framed track (roast fill, 1 px edge), a solid accent-blue thumb, a faint tick under it.
UI:SetTheme("nitro")
for _, case in ipairs({ { mini, "MinimalScrollBar" }, { panel, "UIPanelScrollBar" } }) do
  local bar, name = case[1], case[2]
  local look = bar.crtScroll.looks.framed
  check(look ~= nil and bar.crtScroll.style == "framed", name .. ": Nitro uses the framed track")
  check(not bar.crtScroll.looks.rail.rail.shown and not bar.crtScroll.looks.rail.thumbFace.shown, name .. ", Nitro: the Midnight rail is hidden")
  check(artHidden(bar) and buttonsHidden(bar), name .. ", Nitro: the game's art and the arrow buttons are hidden")
  check(look.fill.shown and near(look.fill.rgb, M.roast), name .. ", Nitro: a roast track")
  local edgesOk = #look.edges == 4
  for _, e in ipairs(look.edges) do edgesOk = edgesOk and e.shown and near(e.rgb, M.edge) end
  check(edgesOk, name .. ", Nitro: a 1 px edge around the track")
  check(look.thumbFace.shown and near(look.thumbFace.rgb, M.caramel) and near(M.caramel, CRT.THEMES.nitro.caramel), name .. ", Nitro: an accent-blue thumb")
  check(look.tick.shown and near(look.tick.rgb, M.caramel) and look.tick.a < 0.6 and look.tick.h == 1, name .. ", Nitro: a faint accent tick under the thumb")
  local p = look.tick.points[1]
  check(p and p[1] == "TOP" and p[3] == "BOTTOM", name .. ", Nitro: the tick sits just under the thumb")
end

-- Beanworks: Cowfee: a rounded roast track with an edge border, the rounded walnut thumb with its top shine.
UI:SetTheme("cowfee")
for _, case in ipairs({ { mini, "MinimalScrollBar" }, { panel, "UIPanelScrollBar" } }) do
  local bar, name = case[1], case[2]
  local look = bar.crtScroll.looks.rounded
  check(look ~= nil and bar.crtScroll.style == "rounded", name .. ": Cowfee uses the rounded look")
  check(not bar.crtScroll.looks.framed.fill.shown and not bar.crtScroll.looks.framed.tick.shown, name .. ", Cowfee: the Nitro track is hidden")
  check(artHidden(bar) and buttonsHidden(bar), name .. ", Cowfee: the game's art and the arrow buttons are hidden")
  check(look.trackEdge.corners[1].shown and near(look.trackEdge.fills[1].rgb, M.edge) and near(look.trackEdge.corners[1].rgb, M.edge), name .. ", Cowfee: an edge border, rounded")
  check(near(look.trackFace.fills[1].rgb, M.roast), name .. ", Cowfee: a roast track")
  check(look.thumbFace.corners[1].shown and near(look.thumbFace.fills[1].rgb, M.walnut) and near(look.thumbFace.corners[1].rgb, M.walnut), name .. ", Cowfee: a rounded walnut thumb")
  check(near(look.thumbEdge.fills[1].rgb, M.walnutEdge), name .. ", Cowfee: the knob's dark walnut edge")
  check(look.shine.shown and near(look.shine.rgb, M.walnutShine), name .. ", Cowfee: the top shine")
end

-- Hover lightens the thumb; leaving puts it back. The MinimalScrollBar's thumb is its own button; the
-- UIPanelScrollBar's thumb is a texture, so the whole bar is the hover area.
local walnut = { M.walnut[1], M.walnut[2], M.walnut[3] }
mini.Track.Thumb.scripts.OnEnter(mini.Track.Thumb)
local lit = sm.looks.rounded.thumbFace.fills[1].rgb
check(lit[1] > walnut[1] and lit[2] > walnut[2] and lit[3] > walnut[3], "hover on the thumb lightens it")
mini.Track.Thumb.scripts.OnLeave(mini.Track.Thumb)
check(near(sm.looks.rounded.thumbFace.fills[1].rgb, walnut), "leaving puts the thumb's colour back")
panel.scripts.OnEnter(panel)
lit = sp.looks.rounded.thumbFace.fills[1].rgb
check(lit[1] > walnut[1], "UIPanelScrollBar: hover lightens its thumb")
panel.scripts.OnLeave(panel)
check(near(sp.looks.rounded.thumbFace.fills[1].rgb, walnut), "UIPanelScrollBar: leaving puts it back")
UI:SetTheme("midnight")
panel.scripts.OnEnter(panel)
lit = sp.looks.rail.thumbFace.rgb
check(lit[1] > M.caramel[1], "Midnight: hover lightens the white thumb too")
panel.scripts.OnLeave(panel)
print("ok scrollbar: hover lightens the thumb")

-- The game hides and shows the UIPanelScrollBar's thumb texture (ScrollFrame_OnScrollRangeChanged); the
-- drawn thumb follows it. The game shows the arrow buttons again on a range change; they stay faded.
panel.ThumbTexture:Hide()
check(not sp.looks.rail.thumbFace.shown, "a hidden game thumb hides the drawn thumb")
panel.ThumbTexture:Show()
check(sp.looks.rail.thumbFace.shown, "shown again, the drawn thumb shows")
panel.ScrollUpButton:Show()
check(buttonsHidden(panel), "a button the game shows again stays faded and clickless")
print("ok scrollbar: the drawn thumb follows the game's")

-- Live, both ways: Modern to Default: Blizzard puts the game's art back; and back to a Modern theme.
UI:SetTheme("blizzard")
blizzardLook(mini, "MinimalScrollBar, switched back")
blizzardLook(panel, "UIPanelScrollBar, switched back")
UI:SetTheme("nitro")
check(artHidden(mini) and buttonsHidden(mini) and sm.looks.framed.fill.shown, "Default: Blizzard to Nitro, live")
-- a scroll bar made while a Modern theme is on is skinned at once
local late = minimalScrollBar(page)
UI:SkinScrollBar(late)
check(artHidden(late) and late.crtScroll.looks.framed.fill.shown, "a scroll bar skinned in a Modern theme takes it at once")
-- a button whose mouse was off before the skin stays off in Default: Blizzard
local quiet = minimalScrollBar(page)
quiet.Back.mouse = false
UI:SkinScrollBar(quiet)
UI:SetTheme("blizzard")
check(quiet.Back.mouse == false and quiet.Forward.mouse == true, "Default: Blizzard gives each button back its own mouse setting")
print("ok scrollbar: the theme switch, both ways")

-- Widths: the MinimalScrollBar is 8 px wide, so the framed and rounded tracks are 8 there; the
-- UIPanelScrollBar (16 px) gets the full 10.
UI:SetTheme("nitro")
check(sm.looks.framed.fill.w == 8 and sm.looks.framed.thumbFace.w < 8, "MinimalScrollBar, Nitro: an 8 px track, the thumb inside it")
check(sp.looks.framed.fill.w == 10, "UIPanelScrollBar, Nitro: a 10 px track")
UI:SetTheme("cowfee")
local function areaW(shape) local c = shape.corners[1] local p = c.points[1] return p and p[2] and p[2].w end
check(areaW(sm.looks.rounded.trackEdge) == 8 and areaW(sm.looks.rounded.thumbEdge) < 8, "MinimalScrollBar, Cowfee: an 8 px track, the thumb inside it")
check(areaW(sp.looks.rounded.trackEdge) == 10, "UIPanelScrollBar, Cowfee: a 10 px track")
print("ok scrollbar: the tracks fit their bars")

-- A hand-made vertical Slider (the Pace list): its own track texture and SetThumbTexture thumb are its art.
UI:SetTheme("blizzard")
local function handSlider(orientation)
  local s = frame("Slider", page)
  s.orientation = orientation
  s.GetOrientation = function(self) return self.orientation end
  s.track = s:CreateTexture(nil, "BACKGROUND")
  s.track:SetColorTexture(0.2, 0.2, 0.2, 0.6) -- not a theme colour: the Pace list's own grey
  s.thumb = s:CreateTexture(nil, "ARTWORK")
  s.GetThumbTexture = function(self) return self.thumb end
  return s
end
local hand = handSlider("VERTICAL")
UI:SkinScrollBar(hand)
local sh = hand.crtScroll
check(sh ~= nil, "a hand-made vertical Slider is skinned")
check(hand.track.alpha == 1 and hand.thumb.alpha == 1 and drawn(hand) == 0, "hand-made Slider, Default: Blizzard: its own track and thumb, nothing drawn")
for _, case in ipairs({ { "midnight", "rail", "rail" }, { "nitro", "framed", "fill" }, { "cowfee", "rounded", "shine" } }) do
  UI:SetTheme(case[1])
  local look = sh.looks[case[2]]
  check(hand.track.alpha == 0 and hand.thumb.alpha == 0, "hand-made Slider, " .. case[1] .. ": its own track and thumb are hidden")
  check(look ~= nil and look[case[3]].shown, "hand-made Slider, " .. case[1] .. ": the " .. case[2] .. " look shows")
end
hand.thumb:Hide()
check(not sh.looks.rounded.thumbFace.corners[1].shown, "hand-made Slider: the drawn thumb follows its thumb's Hide")
hand.thumb:Show()
UI:SetTheme("blizzard")
check(hand.track.alpha == 1 and hand.thumb.alpha == 1 and drawn(hand) == 0, "hand-made Slider, back to Default: Blizzard: its own look again")
local sideways = handSlider("HORIZONTAL")
UI:SkinScrollBar(sideways)
check(sideways.crtScroll == nil, "a horizontal Slider is left alone")
print("ok scrollbar: a hand-made vertical Slider")

-- The gutter: the room a list keeps right of its rows for its bar, one rule, the same in every theme.
check(UI.SCROLL_GAP == 6 and UI.SCROLL_BAR_W == 18, "the gap is 6 px; the widest bar's art is 18 px")
check(type(UI.ScrollGutter) == "function" and UI.ScrollGutter() == 24 and UI.ScrollGutter(4) == 10, "UI.ScrollGutter: the gap and the bar's width, the game's widest bar by default")
-- How far each theme's drawing starts right of its bar's left edge, on each kind of bar (negative: left of
-- it). Default: Blizzard is the game's art: UIPanelScrollBarTemplate's 18 px thumb and arrow buttons centred
-- on its 16 px bar (SecureScrollTemplates.xml, SecureUIPanelTemplates.xml); MinimalScrollBar's art inside its
-- 8 px; a hand-made Slider's own textures fill it (the Pace list's 10 px). The scan below checks each list's
-- rows against these.
local BAR_W = { panel = 16, minimal = 8, hand = 10 }
local DEFAULT_ART = { panel = 18, minimal = 8, hand = 10 }
local insets = {}
for _, info in ipairs(CRT.THEME_LIST) do
  for kind, barW in pairs(BAR_W) do
    local art = DEFAULT_ART[kind]
    local k = info.scrollBar and UI.SCROLL_BAR_LOOKS[info.scrollBar]
    if k then
      art = kind == "minimal" and math.max(k.narrowTrack, k.narrowThumb) or math.max(k.track, k.thumb)
    end
    check(art <= UI.SCROLL_BAR_W, info.key .. ", " .. kind .. " bar: its look fits the gutter (" .. art .. " px)")
    insets[#insets + 1] = kind .. " " .. info.key .. " " .. ((barW - art) / 2)
  end
end
SCROLL_INSETS = table.concat(insets, ";")
SCROLL_GAP = UI.SCROLL_GAP
print("ok scrollbar: the gutter is the same in every theme")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " scroll bar checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let ok = true;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(read('CRT_Core/Themes.lua')));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Panel.lua')));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Controls.lua')));
let scrollSrc = '';
try { scrollSrc = read('CRT_Core/UI/ScrollBar.lua'); } catch (e) { console.log('FAIL CRT_Core/UI/ScrollBar.lua is missing'); ok = false; }
lua.lua_pushstring(L, to_luastring(scrollSrc));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); ok = false; }
// each theme's inset on each kind of bar, and the gap, from the checks above
const luaGlobal = (name) => { lua.lua_getglobal(L, to_luastring(name)); const v = lua.lua_isnil(L, -1) ? null : lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return v; };
const INSETS = {};
for (const part of (luaGlobal('SCROLL_INSETS') || '').split(';').filter(Boolean)) {
  const [kind, theme, inset] = part.split(' ');
  (INSETS[kind] = INSETS[kind] || {})[theme] = Number(inset);
}
const GAP = Number(luaGlobal('SCROLL_GAP'));

// Every scroll bar in the addon (Lua and XML): each CreateFrame from UIPanelScrollFrameTemplate or
// MinimalScrollBar, and each hand-made vertical Slider, is kept in a variable and followed, within a few
// lines, by UI:SkinScrollBar on its bar. A scroll bar template the skin doesn't know, one made inline, a
// hand-made horizontal Slider or one in XML fails unless ALLOW lists it with a reason. The known ones are
// listed so a scan that silently finds nothing fails too.
const KNOWN = [
  ['CRT_Core/UI/SettingsPage.lua', 'CowfeeRaidToolsProfileTextScroll'],
  ['CRT_Modules/Groups/Page.lua', 'CowfeeRaidToolsDialogScroll'], // Raid Groups import box
  ['CRT_Modules/Groups/Page.lua', 'CowfeeRaidToolsGroupExtraScroll'],
  ['CRT_Modules/Groups/Page.lua', 'CowfeeRaidToolsPresetScroll'], // Raid Groups Quick Load
  ['CRT_Modules/LootMaster/Page.lua', 'MinimalScrollBar'],
  ['CRT_Modules/LootMaster/Window.lua', 'MinimalScrollBar'], // the Loot Master list
  ['CRT_Modules/LootMaster/RaiderWindow.lua', 'MinimalScrollBar'], // All Loot Rolls
  ['CRT_Modules/LootMaster/BossLootWindow.lua', 'MinimalScrollBar'],
  ['CRT_Modules/Loot/Page.lua', 'MinimalScrollBar'],
  ['CRT_Modules/GearChecker/Page.lua', 'MinimalScrollBar'], // the Gear Checker list
  ['CRT_Modules/Timeline/View.lua', 'CowfeeRaidToolsTimelineView'],
  ['CRT_Modules/Timeline/SettingsTab.lua', 'CowfeeRaidToolsTimelineRowsScroll'],
  ['CRT_Modules/Timeline/ReferencePage.lua', 'CowfeeRaidToolsTimelineReferenceScroll'],
  ['CRT_Modules/Timeline/ReferencePage.lua', 'CowfeeRaidToolsTimelineAbilitiesScroll'],
  ['CRT_Modules/Notes/Page.lua', 'CowfeeRaidToolsNoteImportScroll'],
  ['CRT_Modules/Notes/Page.lua', 'CowfeeRaidToolsNotesListScroll'],
  ['CRT_Modules/Notes/Page.lua', 'CowfeeRaidToolsNoteTextScroll'],
  ['CRT_Modules/Notes/Page.lua', 'CowfeeRaidToolsPersonalNoteScroll'],
  ['CRT_Modules/Late/Page.lua', 'CowfeeRaidToolsLateRosterScroll'],
  ['CRT_Modules/Late/Page.lua', 'CowfeeRaidToolsLateListScroll'],
  ['CRT_Modules/Tattlebot/Page.lua', 'CowfeeRaidToolsTattleListScroll'],
  ['CRT_Modules/Tattlebot/Page.lua', 'CowfeeRaidToolsTattleMechScroll'],
  ['CRT_Modules/Consumables/Page.lua', 'CowfeeRaidToolsConsumableScroll'],
  ['CRT_Modules/Consumables/Tools.lua', 'CowfeeRaidToolsTextWindowScroll'],
  ['CRT_Modules/Pace/Page.lua', 'CowfeeRaidToolsPaceTextScroll'],
  ['CRT_Dev/Dev/ReferenceTypes.lua', 'CowfeeRaidToolsReferenceManageScroll'],
  ['CRT_Dev/Dev/ReferenceTypes.lua', 'CowfeeRaidToolsReferenceTypesScroll'],
  ['CRT_Modules/Pace/Page.lua', 'Slider'], // the Pace list's hand-made vertical Slider
];
// Scroll bars the skin leaves alone on purpose: [file, text on the CreateFrame line, reason].
const ALLOW = [
  ['CRT_Modules/Timeline/View.lua', 'local bar = CreateFrame("Slider", nil, f)',
    'the Timeline\'s sideways bar: horizontal, already roast and caramel from the theme; its look waits on Alex'],
];
// The templates the skin knows: a scroll frame's bar is its .ScrollBar, the others are the bar itself.
const KNOWN_TEMPLATES = { UIPanelScrollFrameTemplate: '.ScrollBar', MinimalScrollBar: '' };
// Scroll bar templates the skin doesn't know yet: using one fails until its parts are checked in
// Blizzard's UI source and added to partsOf in CRT_Core/UI/ScrollBar.lua.
const OTHER_TEMPLATES = ['ScrollFrameTemplate', 'WowTrimScrollBar', 'MinimalScrollBarTemplate', 'UIPanelScrollBarTemplate',
  'VerticalScrollBarTemplate', 'HorizontalScrollBarTemplate', 'FauxScrollFrameTemplate', 'HybridScrollFrameTemplate',
  'InputScrollFrameTemplate', 'ScrollingEditBoxTemplate', 'ListScrollFrameTemplate'];
const WINDOW = 15;
// The gutter, per list: how far right of the edge its rows end at the bar's left edge starts, then each
// theme's drawing (INSETS); the rows' right edge must be left of the drawing in every theme.
//   UIPanelScrollFrameTemplate: the scroll frame clips its rows at its right edge, and the template puts
//     its bar 6 px right of it (SecureScrollTemplates.xml: TOPLEFT to TOPRIGHT, x 6); a list that moves
//     the bar fails, so its new place gets checked here first.
//   MinimalScrollBar: a scroll box (WowScrollBox, WowScrollBoxList) clips its rows; the bar is anchored
//     TOPLEFT to the box's TOPRIGHT, x pixels right of it.
//   A hand-made Slider: its rows aren't clipped; it's placed UI.SCROLL_GAP right of a sum ending in the
//     rows' width (... + LIST_W + UI.SCROLL_GAP), and the rows are that wide.
const TEMPLATE_GAP = 6;
let clear = 0;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function gutter(where, text, after, name, template, bare) {
  let kind, offset;
  if (template === 'UIPanelScrollFrameTemplate') {
    kind = 'panel';
    if (new RegExp(reEsc(name) + '\\.ScrollBar:(SetPoint|ClearAllPoints|SetAllPoints|SetWidth|SetSize)\\(').test(text)) {
      return fail(where + ' moves the scroll frame\'s bar; check its rows stay clear of it and teach the gutter check its place');
    }
    offset = TEMPLATE_GAP;
  } else if (template === 'MinimalScrollBar') {
    kind = 'minimal';
    const a = after.match(new RegExp(reEsc(name) + ':SetPoint\\("TOPLEFT",\\s*(\\w+),\\s*"TOPRIGHT",\\s*(-?\\d+|UI\\.SCROLL_GAP)'));
    if (!a) return fail(where + ' a MinimalScrollBar not anchored TOPLEFT to its scroll box\'s TOPRIGHT; check its rows stay clear of it');
    if (!new RegExp(reEsc(a[1]) + '\\s*=\\s*CreateFrame\\("Frame",\\s*nil,\\s*[\\w.]+,\\s*"WowScrollBox(List)?"\\)').test(text)) {
      return fail(where + ' the bar hangs off ' + a[1] + ', which is not a scroll box, so its rows are not clipped before the bar');
    }
    offset = a[2] === 'UI.SCROLL_GAP' ? GAP : Number(a[2]);
  } else if (bare) {
    kind = 'hand';
    const a = after.match(new RegExp(reEsc(name) + ':SetPoint\\("TOPLEFT",[^,]*\\+\\s*(\\w+)\\s*\\+\\s*UI\\.SCROLL_GAP\\s*,'));
    if (!a) return fail(where + ' a hand-made Slider not placed UI.SCROLL_GAP right of its rows (... + LIST_W + UI.SCROLL_GAP)');
    if (!new RegExp(':SetSize\\(' + reEsc(a[1]) + ',').test(text)) return fail(where + ' no row is ' + a[1] + ' wide, the width the bar is placed after');
    offset = GAP;
  } else return;
  if (!(offset >= GAP)) fail(where + ' its bar is ' + offset + ' px from its rows, under the ' + GAP + ' px gap (UI.SCROLL_GAP)');
  const themes = INSETS[kind] || {};
  if (!Object.keys(themes).length) return fail(where + ' no theme insets for a ' + kind + ' bar');
  for (const [theme, inset] of Object.entries(themes)) {
    if (!(offset + inset >= 1)) return fail(where + ', ' + theme + ': the bar\'s drawing starts ' + (offset + inset) + ' px from the rows\' right edge, over them');
  }
  clear++;
}
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.claude' || e.name === '.git' || e.name === 'Tests') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(lua|xml)$/.test(e.name)) files.push(p);
  }
})(root);
let sites = 0, skinned = 0, allowed = 0;
const seen = new Set();
const allowUsed = new Set();
const fail = (msg) => { console.log('FAIL ' + msg); ok = false; };
for (const file of files) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const xml = rel.endsWith('.xml');
  lines.forEach((line, i) => {
    if (/^\s*--/.test(line)) return;
    const where = rel + ':' + (i + 1);
    const allow = ALLOW.find((a) => a[0] === rel && line.includes(a[1]));
    let template = null;
    for (const t of Object.keys(KNOWN_TEMPLATES).concat(OTHER_TEMPLATES)) {
      if (line.includes(xml ? 'inherits="' + t + '"' : '"' + t + '"')) { template = t; break; }
    }
    // a hand-made Slider: CreateFrame("Slider", name, parent) with no template
    const bare = !xml && /CreateFrame\("Slider",\s*[^,()]+,\s*[^,()]+\)/.test(line);
    if (!template && !bare) return;
    if (!xml && !line.includes('CreateFrame(')) return; // a template name in a string, not a frame being made
    sites++;
    seen.add(rel + '|' + line);
    if (allow) { allowed++; allowUsed.add(allow[1]); return; }
    if (xml) return fail(where + ' a scroll bar template in XML; make it in Lua and skin it with UI:SkinScrollBar');
    if (template && !(template in KNOWN_TEMPLATES)) {
      return fail(where + ' ' + template + ': UI:SkinScrollBar only knows MinimalScrollBar, UIPanelScrollFrameTemplate and hand-made vertical Sliders; check its parts in Blizzard\'s UI source and add it to partsOf in CRT_Core/UI/ScrollBar.lua');
    }
    const m = line.match(/^\s*(?:local\s+)?([\w.]+)\s*=\s*CreateFrame\(/);
    if (!m) return fail(where + ' a scroll bar made inline; keep it in a variable and pass it to UI:SkinScrollBar');
    const after = lines.slice(i + 1, i + 1 + WINDOW).join('\n');
    if (bare) {
      const o = lines.slice(i + 1, i + 6).join('\n').match(/SetOrientation\("(\w+)"\)/);
      if (o && o[1] === 'HORIZONTAL') return fail(where + ' a hand-made horizontal Slider: the skin only does vertical bars; skin it or add it to ALLOW with a reason');
    }
    const want = m[1] + (template ? KNOWN_TEMPLATES[template] : '');
    if (new RegExp('UI:SkinScrollBar\\(' + want.replace(/[.]/g, '\\.') + '\\)').test(after)) skinned++;
    else fail(where + ' ' + (template || 'a hand-made Slider') + ' without UI:SkinScrollBar(' + want + ') within ' + WINDOW + ' lines');
    gutter(where, lines.join('\n'), after, m[1], template, bare);
  });
}
console.log((ok ? 'ok' : 'FAIL') + ' scrollbar: ' + clear + ' lists keep their rows clear of their bar in ' + Object.keys(INSETS.panel || {}).length + ' themes');
for (const a of ALLOW) if (!allowUsed.has(a[1])) fail('the allowed scroll bar in ' + a[0] + ' is gone; take it off ALLOW');
for (const [f, name] of KNOWN) {
  const hit = [...seen].some((s) => s.startsWith(f + '|') && s.includes('"' + name));
  if (!hit) { console.log('FAIL the known scroll bar ' + name + ' in ' + f + ' was not found'); ok = false; }
}
if (sites < KNOWN.length) { console.log('FAIL only ' + sites + ' scroll bars found, ' + KNOWN.length + ' known'); ok = false; }
console.log((ok ? 'ok' : 'FAIL') + ' scrollbar: ' + skinned + ' of ' + sites + ' scroll bars go through UI:SkinScrollBar, ' + allowed + ' allowed out');
process.exit(ok ? 0 : 1);
