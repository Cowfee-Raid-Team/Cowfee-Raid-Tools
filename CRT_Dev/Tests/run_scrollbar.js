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

// Every scroll bar in the addon: each CreateFrame from UIPanelScrollFrameTemplate or MinimalScrollBar is
// followed, within a few lines, by UI:SkinScrollBar on its bar. The known ones are listed so a scan that
// silently finds nothing fails too.
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
];
const WINDOW = 15;
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.claude' || e.name === '.git' || e.name === 'Tests') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.lua')) files.push(p);
  }
})(root);
let sites = 0, skinned = 0;
const seen = new Set();
for (const file of files) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?:local\s+)?([\w.]+)\s*=\s*CreateFrame\("(ScrollFrame|EventFrame)",\s*([^,]+),.*"(UIPanelScrollFrameTemplate|MinimalScrollBar)"\)/);
    if (!m) return;
    sites++;
    const v = m[1], minimal = m[4] === 'MinimalScrollBar';
    const want = minimal ? v : v + '.ScrollBar';
    const near = lines.slice(i + 1, i + 1 + WINDOW).join('\n');
    const esc = want.replace(/[.]/g, '\\.');
    if (new RegExp('UI:SkinScrollBar\\(' + esc + '\\)').test(near)) skinned++;
    else { console.log('FAIL ' + rel + ':' + (i + 1) + ' ' + m[4] + ' without UI:SkinScrollBar(' + want + ') within ' + WINDOW + ' lines'); ok = false; }
    seen.add(rel + '|' + line);
  });
}
for (const [f, name] of KNOWN) {
  const hit = [...seen].some((s) => s.startsWith(f + '|') && s.includes('"' + name));
  if (!hit) { console.log('FAIL the known scroll bar ' + name + ' in ' + f + ' was not found'); ok = false; }
}
if (sites < KNOWN.length) { console.log('FAIL only ' + sites + ' scroll bars found, ' + KNOWN.length + ' known'); ok = false; }
console.log((ok ? 'ok' : 'FAIL') + ' scrollbar: ' + skinned + ' of ' + sites + ' scroll bars go through UI:SkinScrollBar');
process.exit(ok ? 0 : 1);
