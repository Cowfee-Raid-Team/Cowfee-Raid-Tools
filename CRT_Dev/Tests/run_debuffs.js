// Debuff panel settings and look: loads CRT_Core/Core.lua (for the defaults), CRT_Modules/Debuffs/Data.lua, CRT_Modules/Debuffs/Panel.lua
// and CRT_Modules/Debuffs/Page.lua on mock frames. Checks the clamps, the defaults, the dispel colors (never from a
// secret value), the layout signature, how a container button's dispel textures are wired, and the
// tab's controls.
//   node run_debuffs.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local coreSrc, dataSrc, panelSrc, pageSrc = ...
local passed, failed = 0, 0
local function check(name, cond, detail)
  if cond then passed = passed + 1 print("ok " .. name)
  else failed = failed + 1 print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or "")) end
end

-- A mock frame, region or font object: any method is a no-op unless defined here.
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, calls = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" or k == "CreateTexture" then return function(self, _, layer, _, sub)
      local r = mock(k == "CreateTexture" and "Texture" or "FontString") rawset(r, "layer", layer) rawset(r, "sublevel", sub)
      rawset(r, "parent", self) return r end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 7 end end
    if k == "SetTexture" then return function(self, tex) rawset(self, "texture", tex) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetVertexColor" then return function(self, r, g, b, a) rawset(self, "vertex", { r, g, b, a }) end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "GetAlpha" then return function(self) return rawget(self, "alpha") or 1 end end
    if k == "SetAtlas" then return function(self, a) rawset(self, "atlas", a) end end
    if k == "SetBlendMode" then return function(self, b) rawset(self, "blend", b) end end
    if k == "GetFont" then return function() return "f", 12, "" end end
    if k == "GetTextColor" then return function() return 1, 1, 1 end end
    -- A frame's level is its own when set, else one above its parent's, as in the game.
    if k == "SetFrameLevel" then return function(self, n) rawset(self, "level", n) end end
    if k == "GetFrameLevel" then return function(self)
      local p = rawget(self, "parent")
      return rawget(self, "level") or (p and p:GetFrameLevel() + 1) or 1 end end
    if k == "EnableMouse" then return function(self, on) rawset(self, "mouse", on) end end
    if k == "GetPoint" then return function() return "CENTER", nil, "CENTER", 0, 0 end end
    if k == "IsForbidden" then return function(self) return forbidTextures and self.kind == "Texture" or false end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on) end end
    return function() end
  end })
end

-- Game stubs. forbidTextures makes every texture forbidden, as during an encounter.
forbidTextures = false
format = string.format
CreateFont = function() return mock("Font") end
for _, n in ipairs({ "GameFontNormal", "GameFontHighlight", "GameFontDisable", "GameFontHighlightSmall", "GameFontDisableSmall",
  "GameFontNormalLarge", "GameFontNormalSmall", "ChatFontNormal" }) do _G[n] = mock("Font") end
CRTFontNormal, CRTFontHighlight, CRTFontDisable = mock("Font"), mock("Font"), mock("Font")
UIParent = mock("UIParent")
local SECRET = setmetatable({}, { __eq = function() error("compared a secret value") end,
  __lt = function() error("compared a secret value") end, __le = function() error("compared a secret value") end,
  __concat = function() error("joined a secret value") end })
issecretvalue = function(v) return rawequal(v, SECRET) end
local combat = false
InCombatLockdown = function() return combat end
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a, GetRGBA = function(c) return c.r, c.g, c.b, c.a end } end
C_Texture = { GetAtlasInfo = function(name) if name == "bags-glow-white" then return { width = 64, height = 64 } end end }
IsEncounterInProgress = function() return false end
UnitAffectingCombat = function() return false end
GetTime = function() return 100 end
GetBuildInfo = function() return "12.1.5", "1", "", 120105 end
C_AddOns = { IsAddOnLoaded = function() return true end }
C_UnitAuras = {}
C_Spell = { GetSpellTexture = function(id) return "icon" .. id end }
Enum = { CustomAuraButtonDispelTypeTextureStyle = { Border = 0, BorderWithIcon = 1, Icon = 2, PreserveAsset = 3, CustomAsset = 4 } }

-- Frames: an AuraContainer records its group options, so the test can make a button through them.
local frames, groupOpts = {}, nil
function CreateFrame(kind, name, parent, template)
  local f = mock(kind)
  rawset(f, "parent", parent) rawset(f, "name", name)
  frames[#frames + 1] = f
  if kind == "AuraContainer" then
    rawset(f, "AddAuraGroup", function(self, key, filter, opts) groupOpts = opts return true end)
  end
  return f
end

local CRT = {}
assert(load(coreSrc, "CRT_Core/Core.lua"))("CowfeeRaidTools", CRT)
local defaults = CRT.defaults.debuffs
local function fresh()
  local copy = {}
  for k, v in pairs(defaults) do copy[k] = v end
  return copy
end
CRT.db = { debuffs = fresh() }

-- UI stubs: sliders, dropdowns and help icons record their options.
local sliders, helps, previewFns = {}, {}, {}
CRT.UI = {
  PAGE_W = 1026, PAGE_H = 560, previewing = false,
  RegisterLayer = function() end,
  RegisterPreview = function(_, key, fn) previewFns[key] = fn end,
  SetPreviews = function() end,
  ResetButtonWidth = function() return 44 end, ResetButton = function() return mock("Button") end,
  Slider = function(p, text, opts) local r = mock("Slider") rawset(r, "opts", opts) rawset(r, "refresh", function() end) sliders[text] = r return r end,
  Dropdown = function(p, text, opts) local r = mock("Dropdown") rawset(r, "refresh", function() end) return r end,
  Help = function(p, title, text) local h = mock("Help") helps[title] = text return h end,
}
function CRT:Print(m) print("  [print] " .. tostring(m)) end

assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local Debuffs = CRT.Debuffs

-- Defaults.
check("default dispel icon scale is 0.35", defaults.dispelIconScale == 0.35, defaults.dispelIconScale)
check("default dispel border is off", defaults.dispelBorder == false, tostring(defaults.dispelBorder))
check("default dispel glow is off", defaults.dispelGlow == false, tostring(defaults.dispelGlow))
CRT.db.debuffs.dispelIconScale = nil
check("old saved data without a dispel scale reads 0.35", Debuffs:DispelIconScale() == 0.35, Debuffs:DispelIconScale())
CRT.db.debuffs = fresh()

-- Clamps.
Debuffs:SetSize(200) check("icon size clamps to 128", Debuffs:Size() == 128, Debuffs:Size())
Debuffs:SetSize(128) check("icon size 128 is allowed", Debuffs:Size() == 128, Debuffs:Size())
Debuffs:SetSize(100) check("icon size 100 is allowed", Debuffs:Size() == 100, Debuffs:Size())
Debuffs:SetSize(3) check("icon size clamps to 24", Debuffs:Size() == 24, Debuffs:Size())
Debuffs:SetSize(44)
Debuffs:SetDispelIconScale(5) check("dispel scale clamps to 1.0", Debuffs:DispelIconScale() == 1, Debuffs:DispelIconScale())
Debuffs:SetDispelIconScale(0.05) check("dispel scale clamps to 0.2", Debuffs:DispelIconScale() == 0.2, Debuffs:DispelIconScale())
Debuffs:SetDispelIconScale(0.7) check("dispel scale 0.7 is kept", math.abs(Debuffs:DispelIconScale() - 0.7) < 1e-9, Debuffs:DispelIconScale())
Debuffs:SetDispelIconScale("x") check("dispel scale ignores junk", math.abs(Debuffs:DispelIconScale() - 0.7) < 1e-9, Debuffs:DispelIconScale())
Debuffs:SetDispelIconScale(0.35)
Debuffs:SetDispelBorder(1) check("dispel border saves true", CRT.db.debuffs.dispelBorder == true)
Debuffs:SetDispelGlow(nil) check("dispel glow saves false", CRT.db.debuffs.dispelGlow == false)
Debuffs:SetDispelBorder(false)

-- Colors: the fallback table without the game's colors, then the game's own.
local function same(a, b) return math.abs(a - b) < 1e-6 end
local br, bg, bb = Debuffs:DispelColor(nil)
check("no dispel type gives the default border", br == Debuffs.BORDER_COLOR[1] and bg == Debuffs.BORDER_COLOR[2] and bb == Debuffs.BORDER_COLOR[3])
local r, g, b = Debuffs:DispelColor("Unknown")
check("an unknown type gives the default border", r == br and g == bg and b == bb)
r, g, b = Debuffs:DispelColor(SECRET)
check("a secret value gives the default border", r == br and g == bg and b == bb)
for kind, c in pairs(Debuffs.DISPEL_COLORS) do
  r, g, b = Debuffs:DispelColor(kind)
  check(kind .. " gives its fallback color", same(r, c[1]) and same(g, c[2]) and same(b, c[3]))
end
r, g, b = Debuffs:DispelColor("Magic")
check("Magic is blue", b > r and b > g, r .. "," .. g .. "," .. b)
r, g, b = Debuffs:DispelColor("Poison")
check("Poison is green", g > r and g > b, r .. "," .. g .. "," .. b)
r, g, b = Debuffs:DispelColor("Curse")
check("Curse is purple", r > g and b > g, r .. "," .. g .. "," .. b)
r, g, b = Debuffs:DispelColor("Disease")
check("Disease is brown", r > g and g > b, r .. "," .. g .. "," .. b)
AuraUtil = { GetAuraBorderColor = function(kind)
  return { GetRGB = function() return 0.11, 0.22, 0.33 end, GetRGBA = function() return 0.11, 0.22, 0.33, 1 end }
end }
r, g, b = Debuffs:DispelColor("Magic")
check("the game's own color is used when it has one", same(r, 0.11) and same(g, 0.22) and same(b, 0.33), r .. "," .. g .. "," .. b)
r, g, b = Debuffs:DispelColor(nil)
check("no dispel type still gives the default border with the game's colors", r == br and g == bg and b == bb)
AuraUtil = { GetAuraBorderColor = function() error("broken") end }
r, g, b = Debuffs:DispelColor("Poison")
check("a failing game color falls back to the table", same(r, Debuffs.DISPEL_COLORS.Poison[1]) and same(g, Debuffs.DISPEL_COLORS.Poison[2]))
AuraUtil = nil

-- Signature: each new field rebuilds.
local function changes(field, value)
  local before = Debuffs:LookSignature()
  local old = CRT.db.debuffs[field]
  CRT.db.debuffs[field] = value
  local after = Debuffs:LookSignature()
  CRT.db.debuffs[field] = old
  return before ~= after
end
check("signature changes with dispelIconScale", changes("dispelIconScale", 0.7))
check("signature changes with dispelBorder", changes("dispelBorder", true))
check("signature changes with dispelGlow", changes("dispelGlow", true))
check("signature changes with size", changes("size", 60))
check("signature changes with spacing", changes("spacing", 10))

-- Spacing: the gap between two icons' borders, 0 to 20, default 4.
check("default spacing is 4", defaults.spacing == 4 and Debuffs:Spacing() == 4, tostring(defaults.spacing))
CRT.db.debuffs.spacing = nil
check("old saved data without a spacing reads 4", Debuffs:Spacing() == 4, Debuffs:Spacing())
CRT.db.debuffs = fresh()
Debuffs:SetSpacing(50) check("spacing clamps to 20", Debuffs:Spacing() == 20, Debuffs:Spacing())
Debuffs:SetSpacing(-3) check("spacing clamps to 0", Debuffs:Spacing() == 0, Debuffs:Spacing())
Debuffs:SetSpacing(7.6) check("spacing is whole pixels", Debuffs:Spacing() == 8, Debuffs:Spacing())
Debuffs:SetSpacing("x") check("spacing ignores junk", Debuffs:Spacing() == 8, Debuffs:Spacing())
Debuffs:SetSpacing(4)

-- The step from one icon to the next: the icon, the border's width (half of it on each icon) and the
-- spacing, so neighbouring borders never overlap.
for _, scale in ipairs({ 0, 1, 2, 4 }) do
  for _, gap in ipairs({ 0, 4, 20 }) do
    CRT.db.debuffs.borderScale, CRT.db.debuffs.spacing = scale, gap
    local edge = 5 * scale
    local step = Debuffs:Step(44)
    check(format("step at border %d, spacing %d is 44 + %d + %d", scale, gap, edge, gap), step == 44 + edge + gap, step)
    check(format("borders never overlap at border %d, spacing %d", scale, gap), step >= 44 + Debuffs:Edge(), step)
  end
end
CRT.db.debuffs.borderScale, CRT.db.debuffs.spacing = 1, 4
check("signature is stable", Debuffs:LookSignature() == Debuffs:LookSignature())

-- The panel: build it, then make a container button through the group's initializeFrame.
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
local Panel = CRT.DebuffPanel
local events
for _, f in ipairs(frames) do if rawget(f, "OnEvent") then events = f end end
events.OnEvent(events, "PLAYER_LOGIN")
check("the container's group was added", groupOpts ~= nil and type(groupOpts.initializeFrame) == "function")
local added = {}
local button = mock("AuraButton")
rawset(button, "SetIcon", function() end)
rawset(button, "ClearDispelTypeTextures", function() added = {} end)
rawset(button, "AddDispelTypeTexture", function(self, tex, opts)
  for _, a in ipairs(added) do if a.tex == tex then error("the same region was added twice") end end
  added[#added + 1] = { tex = tex, opts = opts }
  tex:Show() -- the game shows it on a debuff with a dispel type
end)
local function styles()
  local out = {}
  for _, a in ipairs(added) do out[#out + 1] = a.opts.style end
  table.sort(out)
  return table.concat(out, ",")
end
local function glowTex()
  for _, a in ipairs(added) do if a.tex.sublevel == -1 then return a.tex end end
end
groupOpts.initializeFrame(button)
check("all off: no dispel textures", #added == 0, styles())
Debuffs:SetDispelIcon(true)
check("dispel icon: one Icon texture", styles() == "2", styles())
local icon = added[1].tex
check("dispel icon is 35% of 44 (15 px)", icon.w == 15, icon.w)
Debuffs:SetDispelIconScale(0.7)
check("dispel icon at 70% of 44 (30 px)", icon.w == 30, icon.w)
Debuffs:SetDispelIconScale(0.2)
check("dispel icon keeps its 10 px minimum", icon.w == 10, icon.w)
Debuffs:SetDispelIcon(false)
Debuffs:SetDispelGlow(true)
check("glow alone, without the border, adds nothing", #added == 0, styles())
Debuffs:SetDispelBorder(true)
check("border and glow: two PreserveAsset textures", styles() == "3,3", styles())
for _, a in ipairs(added) do
  check("dispel border texture skips debuffs with no type", not a.opts.showWithoutDispelType and a.opts.showWhenHarmful == true)
  local map = a.opts.customDispelColorMap
  local keys = {}
  for k, c in pairs(map or {}) do
    if type(c.GetRGBA) == "function" then keys[#keys + 1] = k end
  end
  table.sort(keys)
  check("the color map has a color object for each dispel type", table.concat(keys, ",") == "Bleed,Curse,Disease,Magic,Poison", table.concat(keys, ","))
  if map then
    local r, g, b = map.Magic:GetRGBA()
    local er, eg, eb = Debuffs:DispelColor("Magic")
    check("the color map's Magic is Debuffs:DispelColor's", r == er and g == eg and b == eb)
  end
end
check("the glow uses the white bag glow atlas, drawn additively", glowTex() and glowTex().atlas == "bags-glow-white" and glowTex().blend == "ADD")
Debuffs:Set("borderScale", 0)
check("border size 0: neither the border nor the glow is added", #added == 0, styles())
Debuffs:Set("borderScale", 1)
Debuffs:SetDispelGlow(false)
check("border only: one PreserveAsset texture", styles() == "3", styles())
local borderTex = added[1].tex
check("the dispel border is the base border's size", borderTex.w == 44 + 5 and borderTex.shown)
Debuffs:Set("borderScale", 0)
check("border size 0 hides the dispel border too", #added == 0 and not borderTex.shown, styles())
Debuffs:Set("borderScale", 1)
Debuffs:SetDispelBorder(false)
check("border off: hidden and not registered", #added == 0 and not borderTex.shown, styles())

-- The glow sits on its own frame inside the button, above every button and its swipe, and below its
-- own button's timer and stacks.
local timeText = {}
rawset(button, "SetDurationText", function(self, fs) timeText[self] = fs end)
local button2 = mock("AuraButton")
rawset(button2, "SetIcon", function() end)
rawset(button2, "ClearDispelTypeTextures", function() end)
rawset(button2, "AddDispelTypeTexture", function() end)
rawset(button2, "SetDurationText", function(self, fs) timeText[self] = fs end)
Debuffs:SetDispelBorder(true) Debuffs:SetDispelGlow(true)
groupOpts.initializeFrame(button2)
local glow = glowTex()
check("the glow is handed to the game", glow ~= nil)
if glow then
  local holder = rawget(glow, "parent")
  local function descends(region, owner)
    local p = rawget(region, "parent")
    while p do if p == owner then return true end p = rawget(p, "parent") end
    return false
  end
  check("the glow is still inside its button (the game needs that)", descends(glow, button))
  check("the glow's frame is not the button itself", holder ~= button)
  local level = holder:GetFrameLevel()
  local below = level > button:GetFrameLevel() and level > button2:GetFrameLevel()
  for _, f in ipairs(frames) do
    if f.kind == "Cooldown" and (rawget(f, "parent") == button or rawget(f, "parent") == button2) and f:GetFrameLevel() >= level then below = false end
  end
  check("the glow's frame is above every button and its swipe", below, level)
  local text = timeText[button] and rawget(timeText[button], "parent")
  check("its own timer and stacks stay above the glow", text ~= nil and text:GetFrameLevel() > level, text and text:GetFrameLevel())
  check("the glow's frame never takes the mouse", rawget(holder, "mouse") == false)
end
Debuffs:SetDispelBorder(false) Debuffs:SetDispelGlow(false)

-- The timer and stacks are raised when the parts are made, even if the button can't be wired yet.
local button3 = mock("AuraButton")
rawset(button3, "SetIcon", function() end)
forbidTextures = true
groupOpts.initializeFrame(button3)
forbidTextures = false
local top3 = 0
for _, f in ipairs(frames) do
  if f.kind == "Frame" and rawget(f, "parent") == button3 then top3 = math.max(top3, f:GetFrameLevel()) end
end
check("a button skipped while forbidden still has its text above the swipe", top3 == button3:GetFrameLevel() + 21, top3)

-- The panel and the container's row are laid out by the step.
local panelFrame
for _, f in ipairs(frames) do if rawget(f, "name") == "CowfeeRaidToolsDebuffPanel" then panelFrame = f end end
for _, case in ipairs({ { 1, 4 }, { 2, 0 }, { 4, 20 } }) do
  CRT.db.debuffs.borderScale, CRT.db.debuffs.spacing = case[1], case[2]
  Debuffs:Fire()
  local step = Debuffs:Step(44)
  check(format("panel width uses the step (border %d, spacing %d)", case[1], case[2]), panelFrame.w == 3 * step + 44, panelFrame.w)
end
CRT.db.debuffs.borderScale, CRT.db.debuffs.spacing = 1, 4
Debuffs:Fire()
check("the group's spacing is the step less the icon", groupOpts.layout.elementSpacing == 5 + 4, groupOpts.layout.elementSpacing)

-- The preview tiles color their border only where the sample's type is known.
Debuffs:SetDispelBorder(true)
Debuffs:SetMaxCount(8)
Panel:SetPreview(true)
check("the panel reports its preview", Panel:IsPreviewing() == true)
-- tile textures: find the dispel border textures created on tiles by their color
local colored, plain = 0, 0
for _, f in ipairs(frames) do
  local parts = rawget(f, "parts")
  if parts and parts.dispelBorder then
    if parts.dispelBorder.shown and parts.dispelBorder.vertex then colored = colored + 1 end
    if not parts.dispelBorder.shown then plain = plain + 1 end
  end
end
check("6 sample tiles with a dispel type get a colored border", colored == 6, colored)
check("2 sample tiles without one keep the plain border", plain == 2, plain)
local tileXs = {}
for _, f in ipairs(frames) do
  if rawget(f, "parts") and f.shown and f.pts[1] then tileXs[#tileXs + 1] = f.pts[1][4] end
end
table.sort(tileXs)
local stepOK = #tileXs == 8
for i, x in ipairs(tileXs) do if x ~= (i - 1) * Debuffs:Step(44) then stepOK = false end end
check("preview tiles are one step apart", stepOK, table.concat(tileXs, ","))
local function tileGlows()
  local n = 0
  for _, f in ipairs(frames) do
    local parts = rawget(f, "parts")
    if parts and parts.glow and parts.glow.shown then n = n + 1 end
  end
  return n
end
Debuffs:SetDispelGlow(true)
check("6 sample tiles glow", tileGlows() == 6, tileGlows())
local tileGlowAbove, tileCount = true, 0
for _, f in ipairs(frames) do
  local parts = rawget(f, "parts")
  if parts and parts.glow then
    tileCount = tileCount + 1
    local holder = rawget(parts.glow, "parent")
    if holder == f or holder:GetFrameLevel() <= f:GetFrameLevel() + 1 then tileGlowAbove = false end
  end
end
check("each tile's glow is on a frame above the tiles", tileCount == 8 and tileGlowAbove, tileCount)
Debuffs:Set("borderScale", 0)
check("no tile glows at border size 0", tileGlows() == 0, tileGlows())
Debuffs:Set("borderScale", 1)
Debuffs:SetDispelGlow(false)
Panel:SetPreview(false)
check("the preview stops", Panel:IsPreviewing() == false)
Debuffs:SetDispelBorder(false)
Debuffs:SetMaxCount(4)
local info = Panel:InfoText()
check("diagnostics list the new settings", info:find("dispel icon size 20%%") and info:find("dispel border false") and info:find("glow false") and info:find("spacing 4"), info:match("Settings:[^\\n]*"))

-- The tab.
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock("Frame")
CRT.DebuffsPage.Build(pf)
check("icon size slider goes to 128", sliders["Icon size"] and sliders["Icon size"].opts.max == 128)
local ds = sliders["Dispel icon size"]
check("dispel icon size slider is 20 to 100", ds and ds.opts.min == 20 and ds.opts.max == 100)
check("dispel icon size shows a percent", ds and ds.opts.format(35) == "35%")
-- the duration shows minutes, so a typed number is minutes too
local du = sliders["Hide debuffs longer than"]
check("duration typed in minutes", du and du.opts.toDisplay and du.opts.toDisplay(300) == 5 and du.opts.fromDisplay(4.5) == 270)
check("other sliders type what they show", ds and ds.opts.toDisplay == nil and sliders["Spacing"] and sliders["Spacing"].opts.toDisplay == nil)
local sp = sliders["Spacing"]
check("spacing slider is 0 to 20", sp and sp.opts.min == 0 and sp.opts.max == 20)
check("spacing slider reads the setting", sp and sp.opts.get() == 4)
if sp then sp.opts.set(12) end
check("spacing slider saves", Debuffs:Spacing() == 12, Debuffs:Spacing())
Debuffs:SetSpacing(4)
check("spacing has a (?) help that mentions the border", helps["Spacing"] ~= nil and helps["Spacing"]:find("border") ~= nil)
Debuffs:SetDispelIconScale(0.35)
check("dispel icon size reads the saved scale", ds and ds.opts.get() == 35, ds and ds.opts.get())
ds.opts.set(70)
check("dispel icon size saves a fraction", math.abs(Debuffs:DispelIconScale() - 0.7) < 1e-9, Debuffs:DispelIconScale())
Debuffs:SetDispelIcon(false)
check("dispel icon size is off while the dispel icon is off", ds.opts.enabledIf() == false)
Debuffs:SetDispelIcon(true)
check("dispel icon size is on with the dispel icon", ds.opts.enabledIf() == true)
check("the dispel border has a (?) help", helps["Color the border by dispel type"] ~= nil)

-- The look boxes save through Debuffs' setters.
local function findCheck(label)
  for _, f in ipairs(frames) do
    local l = rawget(f, "label")
    if f.kind == "CheckButton" and l and rawget(l, "text") == label then return f end
  end
end
local borderBox, glowBox = findCheck("Color the border by dispel type"), findCheck("Glow on dispellable debuffs")
check("the border and glow boxes exist", borderBox ~= nil and glowBox ~= nil)
rawset(glowBox, "GetChecked", function() return true end)
glowBox.OnClick(glowBox)
check("glow ticked with the border off: saved, but no glow", CRT.db.debuffs.dispelGlow == true and Debuffs:DispelGlow() == false)
rawset(borderBox, "GetChecked", function() return true end)
borderBox.OnClick(borderBox)
check("border ticked: the glow is on", Debuffs:DispelBorder() == true and Debuffs:DispelGlow() == true)
Debuffs:SetDispelBorder(false) Debuffs:SetDispelGlow(false)

-- Preview debuffs: only this panel, its label, combat, and closing the tab.
local pb
for _, f in ipairs(frames) do if f.kind == "Button" and rawget(f, "text") == "Preview debuffs" then pb = f end end
check("the Preview debuffs button exists", pb ~= nil and type(rawget(pb, "OnClick")) == "function")
pf:Show()
pb.OnClick(pb)
check("Preview debuffs turns the debuff preview on", Panel:IsPreviewing() == true)
check("and leaves the global Previews off", CRT.UI.previewing == false)
check("the label reads Stop preview", pb.text == "Stop preview", pb.text)
pb.OnClick(pb)
check("Stop preview turns it off", Panel:IsPreviewing() == false and pb.text == "Preview debuffs", pb.text)
combat = true
pb.OnClick(pb)
check("in combat it won't turn on", Panel:IsPreviewing() == false and pb.text == "Preview debuffs", pb.text)
combat = false
pb.OnClick(pb)
combat = true
pb.OnClick(pb)
check("in combat Stop preview still works", Panel:IsPreviewing() == false and pb.text == "Preview debuffs", pb.text)
combat = false
previewFns.debuffs(true)
check("the global Previews sets the label", pb.text == "Stop preview", pb.text)
previewFns.debuffs(false)
check("and sets it back", pb.text == "Preview debuffs", pb.text)
pb.OnClick(pb)
pf.OnHide(pf)
check("closing the tab ends the preview", Panel:IsPreviewing() == false and pb.text == "Preview debuffs", pb.text)
CRT.UI.previewing = true
previewFns.debuffs(true)
pf.OnHide(pf)
check("closing the tab leaves it on while Previews is on", Panel:IsPreviewing() == true)
CRT.UI.previewing = false
previewFns.debuffs(false)

-- Without the glow's atlas there is no glow at all: a plain square above the icon would tint it.
C_Texture = { GetAtlasInfo = function() return nil end }
local before = #frames
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
local Panel2 = CRT.DebuffPanel
for i = before + 1, #frames do if rawget(frames[i], "OnEvent") then events = frames[i] end end
events.OnEvent(events, "PLAYER_LOGIN")
check("no glow atlas: a second panel is built", groupOpts ~= nil and #frames > before + 1)
Debuffs:SetDispelBorder(true) Debuffs:SetDispelGlow(true)
added = {}
local button4 = mock("AuraButton")
rawset(button4, "SetIcon", function() end)
rawset(button4, "ClearDispelTypeTextures", function() added = {} end)
rawset(button4, "AddDispelTypeTexture", function(self, tex, opts) added[#added + 1] = { tex = tex, opts = opts } tex:Show() end)
groupOpts.initializeFrame(button4)
local borders = 0
for _, a in ipairs(added) do if a.opts.style == 3 then borders = borders + 1 end end
check("no glow atlas: only the border is handed to the game", borders == 1 and glowTex() == nil, styles())
Debuffs:SetMaxCount(8)
Panel2:SetPreview(true)
local plainGlows, tilesSeen = 0, 0
for _, f in ipairs(frames) do
  local parts = rawget(f, "parts")
  if parts and parts.glow and not rawget(parts.glow, "atlas") then tilesSeen = tilesSeen + 1 if parts.glow.shown then plainGlows = plainGlows + 1 end end
end
check("no glow atlas: no preview tile shows a glow", tilesSeen == 8 and plainGlows == 0, tilesSeen .. " tiles, " .. plainGlows .. " glowing")
Panel2:SetPreview(false)
check("no glow atlas: the diagnostics say so", Panel2:InfoText():find("glow atlas") ~= nil)
Debuffs:SetDispelBorder(false) Debuffs:SetDispelGlow(false) Debuffs:SetMaxCount(4)

print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error("debuff checks failed") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/Core.lua', 'CRT_Modules/Debuffs/Data.lua', 'CRT_Modules/Debuffs/Panel.lua', 'CRT_Modules/Debuffs/Page.lua']) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
}
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
