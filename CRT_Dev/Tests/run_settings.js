// Loads CRT_Core/Core.lua, CRT_Core/UI/Panel.lua, CRT_Core/UI/Controls.lua (stubbed templates), CRT_Core/UI/SettingsPage.lua and
// CRT_Modules/Notes/Alert.lua on mock frames, then changes fonts, layers and style, and lays the alert out on
// each side.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local coreSrc, panelSrc, controlsSrc, pageSrc, alertSrc, profilesSrc = ...
-- FAIL lines are counted, and the count printed last, so a failure shows past the runner's tail
local failCount, rawPrint = 0, print
print = function(s, ...) if type(s) == "string" and s:find("^FAIL ") then failCount = failCount + 1 end rawPrint(s, ...) end
CLOSE = "Close" DELETE = "Delete"
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
local frames = {}
local combat = false
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, regions = {} }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self, _, _, font)
      local fsx = mock("FontString") rawset(fsx, "font", font) rawset(fsx, "text", "") table.insert(self.regions, fsx) return fsx end end
    if k == "CreateTexture" then return function(self) local tx = mock("Texture") table.insert(self.regions, tx) return tx end end
    if k == "GetRegions" then return function(self) return table.unpack(self.regions) end end
    if k == "GetObjectType" then return function(self) return self.kind end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetFrameStrata" then return function(self, s) rawset(self, "strata", s) end end
    if k == "IsProtected" then return function(self) return rawget(self, "protected") or false end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 8 end end
    if k == "GetFont" then return function() return "f", 20, "" end end
    if k == "GetCenter" then return function() return 500, 400 end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    return function() end end })
end
function CreateFrame(kind, name, parent, template) local f = mock(kind) if template == "BasicFrameTemplateWithInset" then f:CreateTexture() f:CreateTexture() end return f end
UIParent = mock("UIParent") UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
format = string.format
InCombatLockdown = function() return combat end
GetTime = function() return 0 end
C_AddOns = {}
-- Font objects: record SetFont.
local fontObjects = {}
local function fontObject(path, size, flags)
  local o = { path = path, size = size, flags = flags }
  function o:CopyFontObject(src) self.path, self.size, self.flags = src.path, src.size, src.flags end
  function o:GetFont() return self.path, self.size, self.flags end
  function o:SetFont(p, s, f) self.path, self.size, self.flags = p, s, f end
  o.color = { 1, 0.82, 0 }
  function o:GetTextColor() return self.color[1], self.color[2], self.color[3] end
  function o:SetTextColor(r, g, b) self.color = { r, g, b } end
  return o
end
GameFontNormal = fontObject("Fonts\\\\FRIZQT__.TTF", 12, "") GameFontHighlight = GameFontNormal GameFontDisable = GameFontNormal
GameFontHighlightSmall = fontObject("Fonts\\\\FRIZQT__.TTF", 10, "") GameFontDisableSmall = GameFontHighlightSmall
GameFontNormalLarge = fontObject("Fonts\\\\FRIZQT__.TTF", 16, "")
GameFontNormalSmall = fontObject("Fonts/FRIZQT__.TTF", 10, "") ChatFontNormal = fontObject("Fonts/ARIALN.TTF", 14, "")
CANCEL = "Cancel"
local popup
function StaticPopup_ShowCustomGenericConfirmation(data) popup = data end
-- A LibSharedMedia stand-in with one font of its own and one that is the same file as a game font.
local lsm = { List = function() return { "Arial Narrow", "Expressway" } end, Fetch = function(_, _, name) return ({ ["Arial Narrow"] = "Fonts/ARIALN.TTF", Expressway = "Interface/AddOns/SharedMedia/Expressway.ttf" })[name] end }
LibStub = { GetLibrary = function(_, name) if name == "LibSharedMedia-3.0" then return lsm end end }
function CreateFont(name) local o = fontObject() fontObjects[name] = o _G[name] = o return o end
local CRT = {}
assert(load(coreSrc, "CRT_Core/Core.lua"))("CowfeeRaidTools", CRT)
assert(load(profilesSrc, "CRT_Core/Profiles.lua"))("CowfeeRaidTools", CRT)
-- the shipped textures' folder, set once in Core.lua
if CRT.MEDIA == "Interface\\\\AddOns\\\\CowfeeRaidTools\\\\CRT_Media\\\\Media\\\\" then print("ok CRT.MEDIA") else print("FAIL CRT.MEDIA: " .. tostring(CRT.MEDIA)) end
-- ADDON_LOADED.
CRTDB = nil
for _, f in ipairs(frames) do if rawget(f, "OnEvent") then f.OnEvent(f, "ADDON_LOADED", "CowfeeRaidTools") end end
local function fontLine(name) local o = fontObjects[name] return name .. " " .. o.path .. " " .. o.size .. " '" .. o.flags .. "'" end
print("loaded: " .. fontLine("CRTFontNormal") .. ", ui.font " .. CRT.db.ui.font)
CRT.db.ui.font = "Arial Narrow" CRT.db.ui.outline = "OUTLINE" CRT.db.ui.textSize = 125 CRT:ApplyFonts()
print("Arial, outline, 125%: " .. fontLine("CRTFontNormal") .. "; " .. fontLine("CRTFontLarge"))
CRT.db.ui.font = "default" CRT.db.ui.outline = "" CRT.db.ui.textSize = 100 CRT:ApplyFonts()
print("back to default: " .. fontLine("CRTFontNormal"))

assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
-- Controls with simple stand-ins, so the page can build.
MinimalSliderWithSteppersMixin = { Label = { Right = 2 }, Event = {} }
function CreateMinimalSliderFormatter(_, fn) return fn end
assert(load(controlsSrc, "Controls.lua"))("CowfeeRaidTools", CRT)
CRT.Notes = { Alert = function() return CRT.db.notes.alert end, SpellInfo = function() return { icon = 1, name = "Avenging Wrath" } end }
CRT.NoteEngine = { running = false }
-- CRT_Modules/Notes/Alert.lua's preview reads CRT.Alerts.running (set by CRT_Modules/Alerts/Engine.lua in the game)
CRT.Alerts = CRT.Alerts or { running = false }
assert(load(pageSrc, "SettingsPage.lua"))("CowfeeRaidTools", CRT)
UI:RegisterPage("devtest", "Development", function() end)
UI:SetPageHidden("devtest", true, true)
assert(load(alertSrc, "Alert.lua"))("CowfeeRaidTools", CRT)

-- Layers. Header buttons made by UI:Create are remembered, for the look toggle's check.
headerMade = {}
local realHeaderButton = UI.HeaderButton
UI.HeaderButton = function(p, label, fn, opts) local b = realHeaderButton(p, label, fn, opts) headerMade[b] = label return b end
local f = UI:Create()
UI.HeaderButton = realHeaderButton
print("main window layer " .. tostring(f.strata) .. ", art textures " .. #f.art)
local bar = mock("Frame") rawset(bar, "protected", true)
UI:RegisterLayer("bar", bar)
UI:SetLayer("panel", "DIALOG")
print("panel -> Dialog: " .. f.strata .. ", saved " .. tostring(CRT.db.ui.layers.panel))
UI:SetLayer("panel", "HIGH")
print("panel back to default: saved " .. tostring(CRT.db.ui.layers.panel))
combat = true UI:SetLayer("bar", "LOW")
print("bar in combat: " .. tostring(bar.strata) .. " (waits)")
combat = false
for _, fr in ipairs(frames) do if rawget(fr, "OnEvent") and fr ~= frames[1] then fr.OnEvent(fr, "PLAYER_REGEN_ENABLED") end end
print("after combat: " .. tostring(bar.strata))

-- Two looks only: a profile saved with the old style "minimal" is the Classic look, with the game's art.
CRT.db.ui.style = "minimal" CRT.db.ui.bgAlpha = 50 UI:ApplyStyle()
if not f.art[1].shown or f.flatBg.shown or UI:IsModern() then print("FAIL a saved style 'minimal' must load as Classic (art shown " .. tostring(f.art[1].shown) .. ", flat shown " .. tostring(f.flatBg.shown) .. ")") end
if UI.IsFlat then print("FAIL UI:IsFlat is gone: only Classic and Modern are left") end
print("old minimal 50%: art shown " .. tostring(f.art[1].shown) .. ", art alpha " .. tostring(f.art[1].alpha) .. ", flat shown " .. tostring(f.flatBg.shown))

-- The look toggle in the title bar: a header button whose label shows the look; a click switches it
-- live, fonts and all, as the old checkbox did.
do
  local lb = UI.lookButton
  if not lb then
    print("FAIL no look toggle in the title bar")
  else
    if not headerMade[lb] then print("FAIL the look toggle is not a UI.HeaderButton") end
    if lb.text ~= "UI: Classic" then print("FAIL toggle label in Classic: " .. tostring(lb.text)) end
    local before = fontObjects.CRTFontNormal.path
    lb.OnClick(lb)
    if not CRT.db.ui.modern then print("FAIL a click turns Modern on") end
    if lb.text ~= "UI: Modern" then print("FAIL toggle label in Modern: " .. tostring(lb.text)) end
    if not f.titleLine.shown or f.art[1].shown then print("FAIL a click applies the Modern look at once") end
    if fontObjects.CRTFontNormal.path == before then print("FAIL a click applies the Modern fonts at once") end
    lb.OnClick(lb)
    if CRT.db.ui.modern or lb.text ~= "UI: Classic" or f.titleLine.shown or not f.art[1].shown then print("FAIL a second click goes back to Classic") end
    if fontObjects.CRTFontNormal.path ~= before then print("FAIL a second click puts the Classic fonts back") end
    -- a look set another way (a profile switch) shows on the button with the next ApplyStyle
    CRT.db.ui.modern = true UI:ApplyStyle()
    if lb.text ~= "UI: Modern" then print("FAIL toggle label follows ApplyStyle") end
    CRT.db.ui.modern = false CRT:ApplyFonts() UI:ApplyStyle()
    print("look toggle: " .. lb.text)
    -- the toggle is sized once per ApplyStyle, and again after a font change (its label's width moves)
    local realSkin, skins = lb.crtSkin, 0
    lb.crtSkin = function(...) skins = skins + 1 return realSkin(...) end
    UI:ApplyStyle()
    if skins ~= 1 then print("FAIL ApplyStyle sizes the toggle once (got " .. skins .. ")") end
    skins = 0 CRT.db.ui.outline = "OUTLINE" CRT:ApplyFonts()
    if skins < 1 then print("FAIL a font change re-sizes the header buttons") end
    CRT.db.ui.outline = "" CRT:ApplyFonts()
    lb.crtSkin = realSkin
  end
end

-- Settings page builds, with the dropdown options captured by label.
local dropdowns = {}
local realDropdown = UI.Dropdown
UI.Dropdown = function(p, text, opts) dropdowns[text] = opts return realDropdown(p, text, opts) end
UI:SelectPage("settings")
if dropdowns["Style"] then print("FAIL General Settings still has the Style dropdown") end
for _, fr in ipairs(frames) do
  local t = rawget(fr, "text")
  if type(t) == "string" and t:find("Modern look", 1, true) then print("FAIL General Settings still has the Modern look checkbox") end
end
local names = {} for _, o in ipairs(dropdowns["Font"].options()) do names[#names + 1] = o.label end
print("font choices: " .. table.concat(names, ", "))
CRT.Notes.Fire = function() print("  note windows redraw") end
CRT.ready = true
CRT.db.notes.window.font = "Morpheus"
dropdowns["Font"].set("Expressway")
print("picked Expressway: popup '" .. string.format(popup.text, popup.text_arg1) .. "', button " .. popup.acceptText .. ", font still " .. CRT.db.ui.font)
popup.callback()
print("accepted: ui.font " .. CRT.db.ui.font .. ", note windows " .. CRT.db.notes.window.font .. " / " .. CRT.db.notes.assignments.font .. " / " .. CRT.db.notes.personal.font)
print("  " .. fontLine("CRTFontNormal") .. "; " .. fontLine("CRTFontEdit") .. "; " .. fontLine("CRTFontButtonSmall"))
popup = nil dropdowns["Font"].set("Expressway")
print("same font again: popup " .. tostring(popup))
print("settings page built: " .. tostring(UI.pages.settings.frame ~= nil) .. ", title " .. UI.pages.settings.title .. ", profile " .. CRT.Profiles:Current() .. ", minimap " .. tostring(CRT.db.minimap.angle))
local opts = {} for _, o in ipairs(dropdowns["Use profile"].options()) do opts[#opts + 1] = o.label end
print("use profile choices: " .. table.concat(opts, ", ") .. "; copy from enabled " .. tostring(dropdowns["Copy from"].enabledIf()))

-- Modern look.
if k == nil then end
local pb = UI.pages.settings.button
local tab = mock("Button") rawset(tab, "sel", mock("Texture")) rawset(tab, "text", mock("FontString"))
UI:RegisterTab(tab)
CRT.db.ui.modern = true UI:ApplyStyle()
print("modern: art shown " .. tostring(f.art[1].shown) .. ", flat " .. tostring(f.flatBg.shown) .. ", title line " .. tostring(f.titleLine.shown) .. ", menu line " .. tostring(f.menuLine.shown) .. ", menu block " .. tostring(f.menu.blocks[1] and f.menu.blocks[1].shown) .. ", button text at " .. tostring(pb.text.pts[1][1]) .. ", tab teal " .. tostring(tab.sel.color[2] > tab.sel.color[1]))
print("modern font: " .. fontLine("CRTFontNormal") .. ", color " .. string.format("%.2f %.2f %.2f", CRT.db.ui.modern and 0 or 0, 0, 0))
CRT.db.ui.font = "default" CRT:ApplyFonts() print("modern default font: " .. fontLine("CRTFontNormal")) CRT.db.ui.font = "Expressway"
CRT:ApplyFonts() print("after ApplyFonts in modern: " .. fontLine("CRTFontNormal") .. string.format(", color %.2f %.2f %.2f", fontObjects.CRTFontNormal.color[1], fontObjects.CRTFontNormal.color[2], fontObjects.CRTFontNormal.color[3]))
CRT.db.ui.modern = false CRT:ApplyFonts() UI:ApplyStyle()
print("classic font: " .. fontLine("CRTFontNormal") .. string.format(", color %.2f %.2f %.2f", fontObjects.CRTFontNormal.color[1], fontObjects.CRTFontNormal.color[2], fontObjects.CRTFontNormal.color[3]))
print("classic: title line " .. tostring(f.titleLine.shown) .. ", menu block " .. tostring(f.menu.blocks[1].shown) .. ", button text at " .. tostring(pb.text.pts[1][1]) .. ", tab gold " .. tostring(tab.sel.color[1] == 1))
-- Minimize: this check was removed on the alerts branch before main gained UI:SetMinimized (2026-10-15);
-- the minimize session should restore it here.
-- Fade out over 2 seconds.
do
  local target = mock("Frame") rawset(target, "alpha", 1)
  rawset(target, "GetAlpha", function(self) return rawget(self, "alpha") end)
  local done = false
  local before = #frames
  UI.FadeOut(target, 2, function() done = true end)
  local driver = frames[#frames]
  driver.OnUpdate(driver, 1)
  local mid = target.alpha
  driver.OnUpdate(driver, 1.1)
  print(string.format("fade: half way alpha %.2f, done %s, end alpha %s", mid, tostring(done), tostring(target.alpha)))
  UI.CancelFade(target)
  print("shown again: alpha " .. tostring(target.alpha))
end
-- Themed backdrops outside the main window.
do
  local f2 = mock("Frame")
  rawset(f2, "SetBackdropBorderColor", function(self, r, g, b) rawset(self, "border", { r, g, b }) end)
  rawset(f2, "SetBackdropColor", function(self, r, g, b, a) rawset(self, "bg", { r, g, b, a }) end)
  UI:RegisterThemed(f2, { bg = { 0, 0, 0, 0.45 }, border = { 0.2, 0.8, 0.9 } })
  local classic = string.format("%.2f %.2f %.2f", f2.border[1], f2.border[2], f2.border[3])
  CRT.db.ui.modern = true UI:ApplyStyle()
  print(string.format("themed: classic border %s, modern border %.2f %.2f %.2f, bg alpha kept %.2f", classic, f2.border[1], f2.border[2], f2.border[3], f2.bg[4]))
  CRT.db.ui.modern = false UI:ApplyStyle()
end
-- Text size in points, and the opacity of the whole window.
CRT.db.ui.fontSize = 18 CRT:ApplyFonts()
print("18 pt: " .. fontLine("CRTFontNormal") .. "; " .. fontLine("CRTFontLarge") .. "; " .. fontLine("CRTFontSmall"))
CRT.db.ui.fontSize = 14 CRT:ApplyFonts()
CRT.db.ui.bgAlpha = 10 UI:ApplyStyle() print("opacity 10 saved: window alpha " .. tostring(f.alpha) .. " (clamped to 0.3)")
CRT.db.ui.bgAlpha = 100 UI:ApplyStyle()
local migrated = { ui = { textSize = 105 } }
-- A hidden page: no menu button until shown, then hidden again when the window closes.
do
  local b = UI.pages.devtest.button
  UI:LayoutMenu()
  print("hidden page: button shown " .. tostring(b.shown))
  UI:SelectPage("devtest") print("  opening it falls back to: " .. CRT.db.lastPage)
  UI:SetPageHidden("devtest", false) UI:SelectPage("devtest")
  print("  after /crt dev: button shown " .. tostring(b.shown) .. ", open page " .. CRT.db.lastPage)
  f.OnHide()
  print("  window closed: button shown " .. tostring(b.shown) .. ", hidden " .. tostring(UI.pages.devtest.hidden))
end
-- The saved window position keeps its relative point, and puts the window back from it.
do
  local pts = {}
  rawset(f, "GetPoint", function() return "TOPLEFT", UIParent, "BOTTOMLEFT", 300, 900 end)
  rawset(f, "SetPoint", function(self, ...) pts = { ... } end)
  UI:SaveWindowPosition()
  UI:ApplyWindowPosition()
  print("saved " .. CRT.db.window.point .. " from " .. CRT.db.window.relativePoint .. ", put back " .. tostring(pts[1]) .. " from " .. tostring(pts[3]) .. " " .. tostring(pts[4]) .. "," .. tostring(pts[5]))
end
-- The Timeline window's layer stops at Fullscreen.
CRT.db.ui.layers.timeline = "TOOLTIP"
local tl = {} for _, c in ipairs(UI:LayerChoices("timeline")) do tl[#tl + 1] = c.key end
print("timeline layer saved as Tooltip is used as " .. UI:Layer("timeline") .. "; choices " .. table.concat(tl, " "))
-- Alert layout on each side. Fonts are 20 high, so the icon is 20 + 2 + 20 = 42.
for _, fr in ipairs(frames) do if rawget(fr, "OnEvent") then pcall(fr.OnEvent, fr, "PLAYER_LOGIN") end end
UI.previews.alert(true)
local alertFrame
for _, fr in ipairs(frames) do if fr.kind == "Frame" and rawget(fr, "w") == 42 + 8 + 14 * 8 then alertFrame = fr end end
for _, side in ipairs({ "left", "right", "above", "below" }) do
  CRT.db.notes.alert.iconPosition = side
  CRT.NoteAlert:Refresh()
  -- Find the icon (a 42 x 42 texture) and the frame's size.
  local icon, size
  for _, fr in ipairs(frames) do
    if fr.kind == "Texture" and rawget(fr, "w") == 42 and rawget(fr, "h") == 42 and fr.pts[1] then icon = fr end
  end
  for _, fr in ipairs(frames) do if rawget(fr, "strata") and fr.kind == "Frame" and rawget(fr, "w") and fr ~= f and fr ~= bar then size = fr.w .. "x" .. fr.h end end
  print(side .. ": icon at " .. tostring(icon and icon.pts[1][1]) .. ", alert " .. tostring(size))
end
if failCount > 0 then print(failCount .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const p of ['CRT_Core/Core.lua', 'CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Controls.lua', 'CRT_Core/UI/SettingsPage.lua', 'CRT_Modules/Notes/Alert.lua', 'CRT_Core/Profiles.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, 6, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
