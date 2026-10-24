// Debuff panel settings and look: loads CRT_Core/Core.lua (for the defaults), CRT_Modules/Debuffs/Data.lua, CRT_Modules/Debuffs/Panel.lua
// and CRT_Modules/Debuffs/Page.lua on mock frames. Checks the clamps, the defaults, the dispel colors (never from a
// secret value), the layout signature, how a container button's dispel textures are wired, and the
// tab's controls.
//   node run_debuffs.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local coreSrc, dataSrc, panelSrc, pageSrc, clickSrc, ignoreSrc, qolPageSrc, tooltipSrc = ...
local passed, failed = 0, 0
local function check(name, cond, detail)
  if cond then passed = passed + 1 print("ok " .. name)
  else failed = failed + 1 print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or "")) end
end

-- A mock frame, region or font object: any method is a no-op unless defined here.
regions = {} -- every texture and font string made
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, calls = {} }
  return setmetatable(m, { __index = function(t, k)
    -- A field the addon keeps on a frame (lowercase, such as a tile's endsAt) is nil until set, as in the game.
    if type(k) == "string" and k:match("^%l") then return nil end
    if k == "CreateFontString" or k == "CreateTexture" then return function(self, _, layer, _, sub)
      local r = mock(k == "CreateTexture" and "Texture" or "FontString") rawset(r, "layer", layer) rawset(r, "sublevel", sub)
      rawset(r, "parent", self) regions[#regions + 1] = r return r end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) rawset(self, "setPoints", (rawget(self, "setPoints") or 0) + 1) end end
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
    if k == "SetFont" then return function(self, p, size, flags) rawset(self, "font", { path = p, size = size, flags = flags }) return true end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "textColor", { r, g, b }) end end
    if k == "GetFont" then return function() return "f", 12, "" end end
    if k == "GetTextColor" then return function() return 1, 1, 1 end end
    -- A frame's level is its own when set, else one above its parent's, as in the game.
    if k == "SetFrameLevel" then return function(self, n) rawset(self, "level", n) end end
    if k == "GetFrameLevel" then return function(self)
      local p = rawget(self, "parent")
      return rawget(self, "level") or (p and p:GetFrameLevel() + 1) or 1 end end
    if k == "EnableMouse" then return function(self, on) rawset(self, "mouse", on) rawset(self, "motion", on) end end
    if k == "SetMouseMotionEnabled" then return function(self, on) rawset(self, "motion", on) end end
    if k == "RegisterForClicks" then return function(self, ...) rawset(self, "clicks", { ... }) end end
    if k == "SetPassThroughButtons" then return function(self, ...) rawset(self, "passThrough", { ... }) end end
    if k == "SetDesaturated" then return function(self, on) rawset(self, "desaturated", on) end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on) end end
    -- A frame's first point as set, or the middle of its parent before it has one.
    if k == "GetPoint" then return function(self)
      local p = self.pts[1]
      if p then return p[1], p[2], p[3], p[4], p[5] end
      return "CENTER", nil, "CENTER", 0, 0 end end
    if k == "IsForbidden" then return function(self) return forbidTextures and self.kind == "Texture" or false end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on) end end
    return function() end
  end })
end

-- Game stubs. forbidTextures makes every texture forbidden, as during an encounter.
forbidTextures = false
format = string.format
unpack = unpack or table.unpack -- the game's Lua 5.1 global
CreateFont = function() return mock("Font") end
for _, n in ipairs({ "GameFontNormal", "GameFontHighlight", "GameFontDisable", "GameFontHighlightSmall", "GameFontDisableSmall",
  "GameFontNormalLarge", "GameFontNormalSmall", "ChatFontNormal" }) do _G[n] = mock("Font") end
CRTFontNormal, CRTFontHighlight, CRTFontDisable = mock("Font"), mock("Font"), mock("Font")
UIParent = mock("UIParent")
rawset(UIParent, "w", 1920) rawset(UIParent, "h", 1080)
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
-- The boss debuff slots: each anchor's arguments, by aura index.
local anchorArgs, nextAnchor = {}, 0
C_UnitAuras = {
  AddPrivateAuraAnchor = function(args) nextAnchor = nextAnchor + 1 anchorArgs[args.auraIndex] = args return nextAnchor end,
  RemovePrivateAuraAnchor = function() end,
}
-- The game's flow layout values, as in Blizzard_SharedXMLBase/AnchorUtil.lua (live).
AnchorUtil = { FlowLayoutAxis = { Horizontal = 0, Vertical = 1 }, FlowDirection = { Left = -1, Right = 1, Up = 1, Down = -1 } }
C_Spell = { GetSpellTexture = function(id) return "icon" .. id end }
Enum = { CustomAuraButtonDispelTypeTextureStyle = { Border = 0, BorderWithIcon = 1, Icon = 2, PreserveAsset = 3, CustomAsset = 4 },
  NumericRuleFormatRounding = { Nearest = 0, Up = 1, Down = 2 } }
-- The game's number formatter (NumericRuleFormatterSharedDocumentation.lua): records its breakpoints.
local formatters = {}
C_StringUtil = { CreateNumericRuleFormatter = function()
  local f = { SetBreakpoints = function(self, list) self.breakpoints = list end }
  formatters[#formatters + 1] = f
  return f
end }

-- Frames: an AuraContainer records its group options, so the test can make a button through them.
local frames, groupOpts = {}, nil
function CreateFrame(kind, name, parent, template)
  local f = mock(kind)
  rawset(f, "parent", parent) rawset(f, "name", name)
  frames[#frames + 1] = f
  if kind == "AuraContainer" then
    rawset(f, "AddAuraGroup", function(self, key, filter, opts) groupOpts = opts return true end)
    -- The flow layout calls (Blizzard_AuraContainerFlowLayout.lua), as last set.
    rawset(f, "SetFlowLayoutAnchorPoint", function(self, point) rawset(self, "flowPoint", point) end)
    rawset(f, "SetFlowLayoutAxis", function(self, axis) rawset(self, "flowAxis", axis) end)
    rawset(f, "SetFlowLayoutGrowthDirection", function(self, h, v) rawset(self, "flowH", h) rawset(self, "flowV", v) end)
  elseif kind == "Cooldown" then
    -- The swipe's look, as last set (Cooldown widget API).
    rawset(f, "SetReverse", function(self, on) rawset(self, "reversed", on) end)
    rawset(f, "SetSwipeColor", function(self, r, g, b, a) rawset(self, "swipeColor", { r, g, b, a }) end)
    rawset(f, "SetDrawEdge", function(self, on) rawset(self, "drawEdge", on) end)
    rawset(f, "SetDrawBling", function(self, on) rawset(self, "drawBling", on) end)
    rawset(f, "SetDrawSwipe", function(self, on) rawset(self, "drawSwipe", on) end)
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
local sliders, dropdowns, helps, previewFns, spotPickers = {}, {}, {}, {}, {}
CRT.UI = {
  PAGE_W = 1026, PAGE_H = 560, previewing = false,
  SkinScrollBar = function() end, ScrollGutter = function(w) return 6 + (w or 18) end,
  -- the look's skins record what they were given (UI/Panel.lua)
  skinned = {},
  SkinEditBox = function(self, e) self.skinned[e] = "edit" end,
  SkinButton = function(self, b) self.skinned[b] = "button" end,
  PanelButtonWidth = function(w) return math.max(40, math.ceil(w or 0) + 28) end,
  PanelButton = function(parent, label, height, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetText(label) b:SetSize(math.max(40, #label * 7 + 28), height) b:SetScript("OnClick", onClick)
    CRT.UI:SkinButton(b)
    return b
  end,
  RegisterLayer = function() end,
  RegisterPreview = function(_, key, fn) previewFns[key] = fn end,
  SetPreviews = function() end,
  ResetButtonWidth = function() return 44 end, ResetButton = function() return mock("Button") end,
  Slider = function(p, text, opts) local r = mock("Slider") rawset(r, "opts", opts) rawset(r, "refresh", function() end) sliders[text] = r return r end,
  Dropdown = function(p, text, opts) local r = mock("Dropdown") rawset(r, "opts", opts) rawset(r, "refresh", function() end) dropdowns[text] = r return r end,
  Help = function(p, title, text) local h = mock("Help") helps[title] = text return h end,
  SPOT_PICKER_GAP = 12, SPOT_PICKER_W = 126, HELP_GAP = 4, HELP_SIZE = 20,
  SpotPicker = function(p, opts) local r = mock("SpotPicker") rawset(r, "opts", opts) rawset(r, "refresh", function() end) spotPickers[#spotPickers + 1] = r return r end,
}
CRT_THEME(CRT, CRT.UI)
-- the tooltip rules (UI.TooltipAnchor, the areas, the Tooltip position setting)
assert(load(tooltipSrc, "Tooltip.lua"))("CowfeeRaidTools", CRT)
function CRT:Print(m) print("  [print] " .. tostring(m)) end

assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local Debuffs = CRT.Debuffs

-- Defaults. New players get the big number on the icon and the thick frame.
check("default timer is on the icon (center)", defaults.timerPosition == "center", defaults.timerPosition)
check("default border size is 2 (a 5 px frame on each side)", defaults.borderScale == 2, defaults.borderScale)
check("the unused dispelBorder default stays, since saved data only grows", defaults.dispelBorder == false)
-- Loading saved data fills only what is missing: a player's saved timer and border stay as they are.
local coreEvents
for _, f in ipairs(frames) do if rawget(f, "OnEvent") then coreEvents = f end end
local savedDb = CRT.db
CRT.Profiles = { Load = function() end }
local realUseTheme = CRT.UseTheme -- Themes.lua's, for the theme switch check
CRT.ResolveTheme = function(_, ui) return ui and ui.theme end
CRT.UseTheme = function() end
CRT.ApplyFonts = function() end
CRTDB = { debuffs = { timerPosition = "below", borderScale = 1 } }
coreEvents.OnEvent(coreEvents, "ADDON_LOADED", "CowfeeRaidTools")
check("a saved timer position is kept", CRTDB.debuffs.timerPosition == "below", CRTDB.debuffs.timerPosition)
check("a saved border size is kept", CRTDB.debuffs.borderScale == 1, CRTDB.debuffs.borderScale)
check("a missing setting gets its default", CRTDB.debuffs.spacing == 4 and CRTDB.debuffs.size == 44)
CRTDB = { debuffs = {} }
coreEvents.OnEvent(coreEvents, "ADDON_LOADED", "CowfeeRaidTools")
check("a new player starts with the timer on the icon and border size 2", CRTDB.debuffs.timerPosition == "center" and CRTDB.debuffs.borderScale == 2)
check("default grow is left to right", defaults.grow == "right" and CRTDB.debuffs.grow == "right", tostring(defaults.grow))
CRTDB = { debuffs = { grow = "left" } }
coreEvents.OnEvent(coreEvents, "ADDON_LOADED", "CowfeeRaidTools")
check("a saved grow direction is kept", CRTDB.debuffs.grow == "left", CRTDB.debuffs.grow)
CRT.db, CRTDB = savedDb, nil
check("default dispel icon scale is 0.35", defaults.dispelIconScale == 0.35, defaults.dispelIconScale)
check("default dispel glow is off", defaults.dispelGlow == false, tostring(defaults.dispelGlow))
check("default swipe has no bright edge line", defaults.swipe == true and defaults.swipeEdge == false, tostring(defaults.swipeEdge))
CRTDB = { debuffs = { swipeEdge = true } }
coreEvents.OnEvent(coreEvents, "ADDON_LOADED", "CowfeeRaidTools")
check("a saved bright edge stays on", CRTDB.debuffs.swipeEdge == true, tostring(CRTDB.debuffs.swipeEdge))
CRT.db, CRTDB = savedDb, nil
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
Debuffs:SetDispelGlow(1) check("dispel glow saves true, with no other box", CRT.db.debuffs.dispelGlow == true and Debuffs:DispelGlow() == true)
Debuffs:SetDispelGlow(nil) check("dispel glow saves false", CRT.db.debuffs.dispelGlow == false)
check("the old colored border box is gone: the frame always takes the dispel color", Debuffs.SetDispelBorder == nil and Debuffs.DispelBorder == nil)

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
check("an old saved dispelBorder value changes nothing", not changes("dispelBorder", true))
check("signature changes with dispelGlow", changes("dispelGlow", true))
check("signature changes with size", changes("size", 60))
check("signature changes with spacing", changes("spacing", 10))
check("signature changes with grow", changes("grow", "left"))

-- Grow: right (left to right, the default) or left (right to left).
check("grow reads right by default", Debuffs:Grow() == "right", Debuffs:Grow())
CRT.db.debuffs.grow = nil
check("old saved data without a grow reads right", Debuffs:Grow() == "right", Debuffs:Grow())
Debuffs:SetGrow("left") check("grow left saves", CRT.db.debuffs.grow == "left" and Debuffs:Grow() == "left")
Debuffs:SetGrow("up") check("grow ignores junk", Debuffs:Grow() == "left", Debuffs:Grow())
CRT.db.debuffs.grow = "sideways"
check("a junk saved grow reads right", Debuffs:Grow() == "right", Debuffs:Grow())
Debuffs:SetGrow("right")
local growKeys = {}
for _, o in ipairs(Debuffs.GROW_DIRECTIONS or {}) do growKeys[#growKeys + 1] = o.key .. "=" .. o.label end
check("the grow choices", table.concat(growKeys, ",") == "right=Left to right,left=Right to left", table.concat(growKeys, ","))

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

-- Where a frame is on screen, from its one point, its size and UIParent's (1920 x 1080): left, right,
-- top and bottom, as the game would place it.
local function fraction(point)
  local fx = point:find("LEFT") and 0 or point:find("RIGHT") and 1 or 0.5
  local fy = point:find("BOTTOM") and 0 or point:find("TOP") and 1 or 0.5
  return fx, fy
end
local function edges(f)
  if #f.pts ~= 1 then return nil end
  local p = f.pts[1]
  local fx, fy = fraction(p[1])
  local rx, ry = fraction(p[3])
  local left = rx * UIParent.w + p[4] - fx * f.w
  local bottom = ry * UIParent.h + p[5] - fy * f.h
  return left, left + f.w, bottom + f.h, bottom
end
local function near(a, b) return a ~= nil and b ~= nil and math.abs(a - b) < 1e-6 end

-- The panel: build it, then make a container button through the group's initializeFrame. A position
-- saved before the panel kept a fixed corner (any point) loads where it was.
CRT.db.debuffs.position = { point = "BOTTOMLEFT", relativePoint = "BOTTOMLEFT", x = 300, y = 200 }
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
local Panel = CRT.DebuffPanel
local events
for _, f in ipairs(frames) do if rawget(f, "OnEvent") then events = f end end
events.OnEvent(events, "PLAYER_LOGIN")
-- The right-click spots (Click.lua), after the panel's own events frame is found.
assert(load(clickSrc, "Click.lua"))("CowfeeRaidTools", CRT)
local Click = CRT.DebuffClick
local clickEvents = frames[#frames]
do
  local panel
  for _, f in ipairs(frames) do if rawget(f, "name") == "CowfeeRaidToolsDebuffPanel" then panel = f end end
  local left, right, top, bottom = edges(panel)
  check("an old saved position loads where it was", near(left, 300) and near(bottom, 200), tostring(left) .. "," .. tostring(bottom))
  local saved = CRT.db.debuffs.position
  check("and is saved again from the panel's top left", saved.point == "TOPLEFT" and saved.relativePoint == "BOTTOMLEFT"
    and near(saved.x, 300) and near(saved.y, 200 + panel.h), saved.point .. " " .. saved.x .. "," .. saved.y)
end
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
check("all off: only the frame, which takes the dispel color", styles() == "3", styles())
Debuffs:SetDispelIcon(true)
check("dispel icon: an Icon texture beside the frame", styles() == "2,3", styles())
local icon
for _, a in ipairs(added) do if a.opts.style == 2 then icon = a.tex end end
check("dispel icon is 35% of 44 (15 px)", icon.w == 15, icon.w)
Debuffs:SetDispelIconScale(0.7)
check("dispel icon at 70% of 44 (30 px)", icon.w == 30, icon.w)
Debuffs:SetDispelIconScale(0.2)
check("dispel icon keeps its 10 px minimum", icon.w == 10, icon.w)
Debuffs:SetDispelIcon(false)
Debuffs:SetDispelGlow(true)
check("frame and glow: two PreserveAsset textures", styles() == "3,3", styles())
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
check("border size 0: neither the frame nor the glow is added", #added == 0, styles())
Debuffs:Set("borderScale", 1)
Debuffs:SetDispelGlow(false)
check("glow off: the frame alone", styles() == "3", styles())
local borderTex = added[1].tex
check("the dispel frame is the dark frame's size", borderTex.w == 44 + 5 and borderTex.shown)
Debuffs:Set("borderScale", 0)
check("border size 0 hides the dispel frame too", #added == 0 and not borderTex.shown, styles())
Debuffs:Set("borderScale", 1)

-- The look of a button: a dark frame with a thin bevel inside it, a big yellow countdown with an
-- outline in the middle, and white stacks with an outline at the bottom right.
local timeFS, countFS
rawset(button, "SetDurationText", function(self, fs) timeFS = fs end)
rawset(button, "SetApplicationCount", function(self, fs) countFS = fs end)
Debuffs:Set("timerPosition", "center")
check("the countdown and stacks are handed to the game", timeFS ~= nil and countFS ~= nil)
local L = Panel.LOOK
check("the look is a table at the top of Panel.lua", type(L) == "table" and type(L.timerColor) == "table" and type(L.font) == "string")
if timeFS and countFS then
  check("the countdown is yellow", timeFS.textColor and timeFS.textColor[1] == L.timerColor[1] and timeFS.textColor[2] == L.timerColor[2] and timeFS.textColor[3] == L.timerColor[3]
    and timeFS.textColor[1] > 0.9 and timeFS.textColor[2] > 0.7 and timeFS.textColor[3] < 0.3)
  -- the approved yellow in every theme: a switch to Beanworks: Cowfee and a restyle keep it
  local stubUseTheme = CRT.UseTheme
  CRT.UseTheme = realUseTheme
  CRT.UI.SwitchTheme("cowfee")
  Debuffs:Set("timerPosition", "center")
  check("the countdown stays the approved yellow in a Modern theme", timeFS.textColor and timeFS.textColor[1] == 1 and timeFS.textColor[2] == 0.82
    and timeFS.textColor[3] == 0, timeFS.textColor and table.concat(timeFS.textColor, ","))
  CRT.UI.SwitchTheme("blizzard")
  CRT.UseTheme = stubUseTheme
  check("the countdown has an outline", timeFS.font and timeFS.font.flags:find("OUTLINE") ~= nil, timeFS.font and timeFS.font.flags)
  check("the countdown is in the middle of the icon", timeFS.pts[1] and timeFS.pts[1][1] == "CENTER" and timeFS.pts[1][3] == "CENTER")
  check("the stacks are white with an outline", countFS.textColor and countFS.textColor[1] == 1 and countFS.textColor[2] == 1 and countFS.textColor[3] == 1
    and countFS.font and countFS.font.flags:find("OUTLINE") ~= nil)
  check("the stacks sit at the bottom right", countFS.pts[1] and countFS.pts[1][1] == "BOTTOMRIGHT")
  local small = timeFS.font.size
  Debuffs:SetSize(88)
  local big = timeFS.font.size
  check("the countdown grows with the icon size", big > small and big == Panel.TimerFontSize(88) and small == Panel.TimerFontSize(44), small .. " -> " .. big)
  check("the countdown is big: nearly half the icon", Panel.TimerFontSize(44) >= 18 and Panel.TimerFontSize(88) >= 36, Panel.TimerFontSize(44))
  check("a big countdown has a thick outline", timeFS.font.flags == "THICKOUTLINE", timeFS.font.flags)
  check("the stacks grow with the icon size too", countFS.font.size == Panel.StackFontSize(88) and Panel.StackFontSize(88) > Panel.StackFontSize(44))
  Debuffs:SetSize(24)
  check("the countdown stays readable on the smallest icon", timeFS.font.size >= 10, timeFS.font.size)
  Debuffs:SetSize(44)
  local onIcon = timeFS.font.size
  Debuffs:Set("timerPosition", "below")
  check("beside the icon the number is smaller than on it, so it doesn't crowd the row", timeFS.font.size < onIcon and timeFS.font.size >= 10, onIcon .. " / " .. timeFS.font.size)
  Debuffs:Set("timerPosition", "center")
  check("the font is the game's own when the addon font is the default", timeFS.font.path == L.font, timeFS.font.path)
end
-- The button's own textures, found by what they were drawn with.
local function texturesOf(owner, test)
  for _, r in ipairs(regions) do
    if rawget(r, "parent") == owner and r.kind == "Texture" and test(r) then return r end
  end
end
local bevel = texturesOf(button, function(r) local c = rawget(r, "color") return c and c[1] == L.bevelColor[1] and c[4] == L.bevelColor[4] end)
check("the frame has a thin bevel inside it", bevel ~= nil and bevel.w == 44 + 2 * L.bevelWidth and bevel.shown, bevel and bevel.w)
local frameTex = texturesOf(button, function(r) local c = rawget(r, "color") return c and c[4] == 1 and r.layer == "BACKGROUND" and r ~= bevel end)
check("the frame is dark", frameTex and frameTex.color[1] < 0.15 and frameTex.color[2] < 0.15 and frameTex.color[3] < 0.15 and frameTex.shown)
check("the frame is the icon plus the border's width", frameTex and frameTex.w == 44 + 5, frameTex and frameTex.w)
Debuffs:Set("borderScale", 0.5)
check("no bevel on a frame too thin for one", bevel and not bevel.shown)
Debuffs:Set("borderScale", 1)

-- The swipe: reversed from the action bar (a fresh debuff is lit and darkens as it runs out), a
-- muted dark fill from the look, no bright edge line by default and no bling at the end.
local function cooldownOf(owner)
  for _, f in ipairs(frames) do
    if f.kind == "Cooldown" and rawget(f, "parent") == owner then return f end
  end
end
local function mutedSwipe(cd)
  local c, want = cd and rawget(cd, "swipeColor"), L.swipeColor
  return cd ~= nil and type(want) == "table" and c ~= nil and c[1] == want[1] and c[2] == want[2] and c[3] == want[3] and c[4] == want[4]
end
check("the look's swipe color is a muted black", type(L.swipeColor) == "table" and L.swipeColor[1] == 0 and L.swipeColor[2] == 0 and L.swipeColor[3] == 0
  and math.abs(L.swipeColor[4] - 0.6) < 1e-9)
local buttonCD = cooldownOf(button)
check("a button's swipe is reversed: it darkens as the debuff runs out", buttonCD and rawget(buttonCD, "reversed") == true)
check("a button's swipe has the muted color", mutedSwipe(buttonCD))
check("a button's swipe has no edge line by default", buttonCD and rawget(buttonCD, "drawEdge") == false)
check("a button's swipe has no bling", buttonCD and rawget(buttonCD, "drawBling") == false)
Debuffs:Set("swipeEdge", true)
check("the bright edge box still turns the line on", buttonCD and rawget(buttonCD, "drawEdge") == true)
Debuffs:Set("swipeEdge", defaults.swipeEdge)
Panel:SetPreview(true)
local tileCD
for _, f in ipairs(frames) do
  if rawget(f, "parts") and f.shown then tileCD = cooldownOf(f) break end
end
check("a preview tile's swipe is reversed, muted, with no edge or bling", tileCD and rawget(tileCD, "reversed") == true and mutedSwipe(tileCD)
  and rawget(tileCD, "drawEdge") == false and rawget(tileCD, "drawBling") == false)
Panel:SetPreview(false)
-- The boss debuff slots: the game draws their swipe, and takes only whether it has an edge.
Debuffs:SetPrivateSlots(true)
check("a boss debuff slot has no swipe edge by default", anchorArgs[1] and anchorArgs[1].showCooldownEdge == false and anchorArgs[1].showCooldownFrame == true)
Debuffs:Set("swipeEdge", true)
check("the bright edge box turns a slot's edge on", anchorArgs[1] and anchorArgs[1].showCooldownEdge == true)
Debuffs:Set("swipeEdge", defaults.swipeEdge)
check("a slot is given only fields the game documents", anchorArgs[1] and anchorArgs[1].reverse == nil and anchorArgs[1].swipeColor == nil)
Debuffs:SetPrivateSlots(false)

-- The countdown's text: seconds with no "s" under a minute, m:ss from 60 s.
local cases = { { 9, "9" }, { 8.2, "9" }, { 59, "59" }, { 59.5, "59" }, { 60, "1:00" }, { 103, "1:43" }, { 102.4, "1:43" }, { 600, "10:00" }, { 0.3, "1" } }
for _, c in ipairs(cases) do
  check("the time " .. c[1] .. " reads " .. c[2], Panel.FormatTime(c[1]) == c[2], Panel.FormatTime(c[1]))
end
check("a secret time is never compared, and gives no text", Panel.FormatTime(SECRET) == nil)
check("a stack of 3 reads 3", Panel.StackText(3) == "3")
check("one stack shows nothing, like the game", Panel.StackText(1) == "" and Panel.StackText(nil) == "" and Panel.StackText(0) == "")
check("a secret stack count is never compared", Panel.StackText(SECRET) == "")

-- The game's formatter for the real debuffs: the same text, from the breakpoints the panel gives it.
-- Rules as documented: the input is stepped and rounded, clamped to min/max, then each component is
-- divided (div) and/or reduced (mod), stepped and rounded, and formatted.
local fmt = formatters[#formatters]
check("the game's formatter was given breakpoints", fmt and type(fmt.breakpoints) == "table" and #fmt.breakpoints >= 2)
local function roundStep(v, step, rounding)
  if not step then return v end
  local q = v / step
  if rounding == 1 then q = math.ceil(q) elseif rounding == 2 then q = math.floor(q) else q = math.floor(q + 0.5) end
  return q * step
end
local function gameFormat(list, value)
  local rule
  for _, bp in ipairs(list) do if value >= bp.threshold and (not rule or bp.threshold >= rule.threshold) then rule = bp end end
  local v = roundStep(value, rule.step, rule.rounding)
  if rule.min and v < rule.min then v = rule.min end
  if rule.max and v > rule.max then v = rule.max end
  if not rule.components then return string.format(rule.format, v) end
  local vals = {}
  for _, comp in ipairs(rule.components) do
    local x = v
    if comp.div then x = x / comp.div end
    if comp.mod then x = x % comp.mod end
    vals[#vals + 1] = roundStep(x, comp.step, comp.rounding)
  end
  return string.format(rule.format, (table.unpack or unpack)(vals))
end
if fmt and fmt.breakpoints then
  for _, c in ipairs(cases) do
    local ok, text = pcall(gameFormat, fmt.breakpoints, c[1])
    check("the game's formatter reads " .. c[1] .. " as " .. c[2], ok and text == c[2], text)
  end
  for _, bp in ipairs(fmt.breakpoints) do
    check("no breakpoint adds an s", not bp.format:find("s"), bp.format)
  end
end
Debuffs:Set("timerPosition", defaults.timerPosition)

-- The glow sits on its own frame inside the button, above every button and its swipe, and below its
-- own button's timer and stacks.
local timeText = {}
rawset(button, "SetDurationText", function(self, fs) timeText[self] = fs end)
local button2 = mock("AuraButton")
rawset(button2, "SetIcon", function() end)
rawset(button2, "ClearDispelTypeTextures", function() end)
rawset(button2, "AddDispelTypeTexture", function() end)
rawset(button2, "SetDurationText", function(self, fs) timeText[self] = fs end)
Debuffs:SetDispelGlow(true)
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
Debuffs:SetDispelGlow(false)

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

-- Tooltips on hover: the game's own aura button tooltip (Blizzard_AuraButton.lua: OnEnter shows it from the
-- button's own aura, owned by the button at its SetTooltipAnchorPoint anchor). The panel only turns hover on
-- and gives the anchor, from the debuffs tooltip area (UI.TooltipAnchor). Off: no button takes hover.
do
  local tipButton = mock("AuraButton")
  rawset(tipButton, "SetIcon", function() end)
  rawset(tipButton, "SetTooltipAnchorPoint", function(self, point, x, y)
    rawset(self, "tipAnchor", { point, x, y }) rawset(self, "anchorCalls", (rawget(self, "anchorCalls") or 0) + 1) end)
  rawset(tipButton, "SetHideTooltipInCombat", function(self, on) rawset(self, "hideInCombat", on) end)
  local function tipAt() local a = rawget(tipButton, "tipAnchor") or {} return format("%s %g,%g", tostring(a[1]), tonumber(a[2]) or 0 / 0, tonumber(a[3]) or 0 / 0) end
  CRT.db.ui = { tooltipMode = "spot", tooltipSpot = "auto" }
  check("tooltips are off by default", defaults.tooltips == false and Debuffs:Tooltips() == false, tostring(defaults.tooltips))
  check("the panel's tooltip area follows General Settings by default", defaults.tooltipMode == "general" and defaults.tooltipSpot == "auto")
  groupOpts.initializeFrame(tipButton)
  check("off: a button takes no hover, so the panel stays click-through", rawget(tipButton, "motion") == false, tostring(rawget(tipButton, "motion")))
  Debuffs:SetTooltips(true)
  check("SetTooltips saves true", CRT.db.debuffs.tooltips == true and Debuffs:Tooltips() == true)
  check("on: the button takes hover, for the game's own tooltip", rawget(tipButton, "motion") == true)
  check("on: the game keeps the tooltip in combat too", rawget(tipButton, "hideInCombat") == false)
  local want = { CRT.UI.TooltipAnchor("debuffs", "ANCHOR_BOTTOMLEFT", 0, 0, 44) }
  check("on auto: next to the icon, below it on the left, the game's own side for an aura button", tipAt() == "ANCHOR_BOTTOMLEFT 0,0" and want[1] == "ANCHOR_BOTTOMLEFT", tipAt())
  -- the area's own choice and spot reach the button, applied at the next layout
  CRT.db.debuffs.tooltipMode = "cursor"
  panelFrame.OnUpdate(panelFrame, 1)
  check("the area on Follow the cursor: the game's tooltip follows the cursor", tipAt() == "ANCHOR_CURSOR 0,0", tipAt())
  CRT.db.debuffs.tooltipMode, CRT.db.debuffs.tooltipSpot = "spot", "leftupper"
  panelFrame.OnUpdate(panelFrame, 1)
  check("the area's own side spot: its anchor, offset by half the icon", tipAt() == "ANCHOR_LEFT 0,-22", tipAt())
  CRT.db.debuffs.tooltipMode = "general"
  CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "spot", "bottom"
  panelFrame.OnUpdate(panelFrame, 1)
  check("Use the general setting: General Settings' spot", tipAt() == "ANCHOR_BOTTOM 0,0", tipAt())
  local calls = rawget(tipButton, "anchorCalls")
  panelFrame.OnUpdate(panelFrame, 1) panelFrame.OnUpdate(panelFrame, 1)
  check("an unchanged anchor isn't set again on every layout", rawget(tipButton, "anchorCalls") == calls, rawget(tipButton, "anchorCalls") - calls)
  CRT.db.ui.tooltipMode = "game"
  panelFrame.OnUpdate(panelFrame, 1)
  check("the game's tooltip spot can't be given to the game's button: next to the icon, as auto", tipAt() == "ANCHOR_BOTTOMLEFT 0,0", tipAt())
  CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "spot", "auto"
  Debuffs:SetSize(60)
  CRT.db.debuffs.tooltipMode, CRT.db.debuffs.tooltipSpot = "spot", "rightlower"
  panelFrame.OnUpdate(panelFrame, 1)
  check("a side spot follows the icon size", tipAt() == "ANCHOR_BOTTOMRIGHT 0,30", tipAt())
  Debuffs:SetSize(44)
  CRT.db.debuffs.tooltipMode, CRT.db.debuffs.tooltipSpot = "general", "auto"
  -- a preview, or the panel turned off: the real row is faded out, so its buttons take no hover
  Panel:SetPreview(true)
  check("during a preview the real buttons take no hover", rawget(tipButton, "motion") == false)
  Panel:SetPreview(false)
  check("after the preview they do again", rawget(tipButton, "motion") == true)
  Debuffs:SetEnabled(false)
  check("with the panel off they take no hover", rawget(tipButton, "motion") == false)
  Debuffs:SetEnabled(true)
  check("turned on again, they do", rawget(tipButton, "motion") == true)
  -- the right-click spots above the icons still take clicks only, never hover, so hover reaches the button
  Click.Update()
  local spotMotion = false
  for _, s in ipairs(Click.catchers) do if rawget(s, "motion") then spotMotion = true end end
  check("with tooltips on the right-click spots still never take hover", not spotMotion)
  -- in combat a change waits for combat to end, like every other setting on the buttons
  combat = true
  Debuffs:SetTooltips(false)
  check("in combat turning tooltips off waits", rawget(tipButton, "motion") == true)
  combat = false
  events.OnEvent(events, "PLAYER_REGEN_ENABLED")
  check("after combat the buttons take no hover", rawget(tipButton, "motion") == false and CRT.db.debuffs.tooltips == false)
  -- a button the container makes in combat, with the setting on, is wired at once: hover, anchor, kept in combat
  Debuffs:SetTooltips(true)
  combat = true
  local combatButton = mock("AuraButton")
  rawset(combatButton, "SetIcon", function() end)
  rawset(combatButton, "SetTooltipAnchorPoint", function(self, point, x, y) rawset(self, "tipAnchor", { point, x, y }) end)
  rawset(combatButton, "SetHideTooltipInCombat", function(self, on) rawset(self, "hideInCombat", on) end)
  groupOpts.initializeFrame(combatButton)
  local ca = rawget(combatButton, "tipAnchor") or {}
  check("a button made in combat with tooltips on gets hover, the anchor and keeps its tooltip in combat",
    rawget(combatButton, "motion") == true and ca[1] == "ANCHOR_BOTTOMLEFT" and ca[2] == 0 and ca[3] == 0 and rawget(combatButton, "hideInCombat") == false,
    tostring(rawget(combatButton, "motion")) .. " " .. tostring(ca[1]) .. " " .. tostring(rawget(combatButton, "hideInCombat")))
  combat = false
  events.OnEvent(events, "PLAYER_REGEN_ENABLED")
  Debuffs:SetTooltips(false)
  -- a button the game has made forbidden (an encounter) is left alone and wired once it is safe
  Debuffs:SetTooltips(true)
  rawset(tipButton, "IsForbidden", function() return true end)
  Debuffs:SetTooltips(false)
  check("a forbidden button is not touched", rawget(tipButton, "motion") == true)
  rawset(tipButton, "IsForbidden", nil)
  Panel:Apply()
  check("and is wired once it is safe again", rawget(tipButton, "motion") == false)
  CRT.db.ui = nil
  check("the diagnostics say whether tooltips are on", Panel:InfoText():find("tooltips false") ~= nil, Panel:InfoText():match("Settings:[^\\n]*"))
end

-- Grow: the container's flow layout, its anchor, the boss debuff slots and the preview tiles all
-- start at the panel's left end (right) or its right end (left). The panel itself never moves.
do
  local box
  for _, f in ipairs(frames) do if f.kind == "AuraContainer" then box = f end end
  local function pointIs(region, point, x)
    local p = region.pts[1]
    return #region.pts == 1 and p[1] == point and p[2] == panelFrame and p[3] == point and p[4] == x and p[5] == 0
  end
  local step = Debuffs:Step(44)
  check("left to right: the row grows right from the top left", box.flowPoint == "TOPLEFT" and box.flowH == 1 and box.flowV == -1, tostring(box.flowPoint) .. " " .. tostring(box.flowH))
  check("left to right: the container sits at the panel's top left", pointIs(box, "TOPLEFT", 0))
  local atLeft, atRight, atTop = edges(panelFrame)
  local function notMoved()
    local l, r, t = edges(panelFrame)
    return near(l, atLeft) and near(r, atRight) and near(t, atTop)
  end
  Debuffs:SetPrivateSlots(true)
  local slotsRight = anchorArgs[1] and anchorArgs[2] and anchorArgs[1].parent.pts[1][1] == "TOPLEFT" and anchorArgs[1].parent.pts[1][4] == 0
    and anchorArgs[2].parent.pts[1][4] == step
  check("left to right: boss debuff slot 1 at the left end, slot 2 one step right", slotsRight)
  Debuffs:SetGrow("left")
  check("right to left: the row grows left from the top right", box.flowPoint == "TOPRIGHT" and box.flowH == AnchorUtil.FlowDirection.Left and box.flowV == -1, tostring(box.flowPoint) .. " " .. tostring(box.flowH))
  check("right to left: the container sits at the panel's top right", pointIs(box, "TOPRIGHT", 0), box.pts[1] and box.pts[1][1])
  local s1, s2 = anchorArgs[1].parent, anchorArgs[2].parent
  check("right to left: boss debuff slot 1 at the right end, slot 2 one step left", s1.pts[1][1] == "TOPRIGHT" and s1.pts[1][3] == "TOPRIGHT" and s1.pts[1][4] == 0
    and s2.pts[1][1] == "TOPRIGHT" and s2.pts[1][4] == -step, s2.pts[1] and s2.pts[1][4])
  check("switching direction doesn't move the panel", notMoved() and panelFrame.w == 3 * step + 44, table.concat({ edges(panelFrame) }, ","))
  check("right to left: the panel is held by its top right", panelFrame.pts[1][1] == "TOPRIGHT" and CRT.db.debuffs.position.point == "TOPRIGHT",
    panelFrame.pts[1][1] .. " " .. CRT.db.debuffs.position.point)
  -- The preview: sample 1 next to the right end, each next one a step to its left.
  Panel:SetPreview(true)
  local order, n = true, 0
  for _, f in ipairs(frames) do
    local parts = rawget(f, "parts")
    if parts and f.shown then
      n = n + 1
      local p = f.pts[1]
      if not (p and p[1] == "TOPRIGHT" and p[2] == panelFrame and p[3] == "TOPRIGHT") then order = false end
    end
  end
  local xs = {}
  for _, f in ipairs(frames) do if rawget(f, "parts") and f.shown then xs[#xs + 1] = f.pts[1][4] end end
  check("right to left: the preview tiles run from the right end, one step apart", order and n == 4 and xs[1] == 0 and xs[2] == -step and xs[3] == -2 * step and xs[4] == -3 * step, table.concat(xs, ","))
  Panel:SetPreview(false)
  -- In combat the switch waits, like every other layout change, and applies when combat ends.
  combat = true
  Debuffs:SetGrow("right")
  check("in combat the row keeps growing left", box.flowPoint == "TOPRIGHT" and box.flowH == -1 and pointIs(box, "TOPRIGHT", 0))
  check("in combat the slots stay put", s1.pts[1][1] == "TOPRIGHT")
  combat = false
  events.OnEvent(events, "PLAYER_REGEN_ENABLED")
  check("after combat the row grows right again", box.flowPoint == "TOPLEFT" and box.flowH == 1 and pointIs(box, "TOPLEFT", 0))
  check("after combat the slots are back at the left end", s1.pts[1][1] == "TOPLEFT" and s2.pts[1][4] == step)
  check("and the panel never moved", notMoved() and panelFrame.pts[1][1] == "TOPLEFT", table.concat({ edges(panelFrame) }, ","))
  Debuffs:SetPrivateSlots(false)
  -- Without AnchorUtil the flow layout uses the game's own values (Blizzard_SharedXMLBase/AnchorUtil.lua).
  local savedAnchorUtil = AnchorUtil
  AnchorUtil = nil
  Debuffs:SetGrow("left")
  check("no AnchorUtil: right to left still grows left from the top right", box.flowPoint == "TOPRIGHT" and box.flowH == -1 and box.flowV == -1 and box.flowAxis == 0,
    tostring(box.flowPoint) .. " " .. tostring(box.flowH) .. " " .. tostring(box.flowV) .. " " .. tostring(box.flowAxis))
  Debuffs:SetGrow("right")
  check("no AnchorUtil: left to right grows right from the top left", box.flowPoint == "TOPLEFT" and box.flowH == 1 and box.flowV == -1 and box.flowAxis == 0,
    tostring(box.flowPoint) .. " " .. tostring(box.flowH))
  AnchorUtil = savedAnchorUtil
end

-- The panel keeps its fixed end: the right one with right to left, the left one with left to right,
-- whatever the icon size, count, spacing or border size. In combat a change waits, as before.
do
  Debuffs:SetGrow("left")
  local _, right, top = edges(panelFrame)
  local w = panelFrame.w
  Debuffs:SetSize(80)
  local _, r2, t2 = edges(panelFrame)
  check("right to left: a bigger icon keeps the right end", panelFrame.w > w and near(r2, right) and near(t2, top), tostring(r2) .. " vs " .. tostring(right))
  Debuffs:SetMaxCount(7)
  local _, r3 = edges(panelFrame)
  check("right to left: more icons keep the right end", near(r3, right), tostring(r3) .. " vs " .. tostring(right))
  Debuffs:SetSpacing(12) Debuffs:Set("borderScale", 3)
  local _, r4 = edges(panelFrame)
  check("right to left: spacing and border size keep the right end", near(r4, right), tostring(r4) .. " vs " .. tostring(right))
  combat = true
  local wBefore = panelFrame.w
  Debuffs:SetSize(30)
  check("in combat the size change waits", panelFrame.w == wBefore, panelFrame.w)
  combat = false
  events.OnEvent(events, "PLAYER_REGEN_ENABLED")
  local _, r5 = edges(panelFrame)
  check("after combat the smaller panel keeps the right end", panelFrame.w < wBefore and near(r5, right), tostring(r5) .. " vs " .. tostring(right))
  Debuffs:SetGrow("right")
  local left = edges(panelFrame)
  check("switching to left to right after a resize doesn't move it", near(select(2, edges(panelFrame)), right))
  Debuffs:SetSize(70) Debuffs:SetMaxCount(2)
  local l2 = edges(panelFrame)
  check("left to right: the left end stays put", near(l2, left), tostring(l2) .. " vs " .. tostring(left))
  -- A drag: the game leaves the panel at whatever point it likes; it is saved from the fixed corner.
  local handleFrame
  for _, f in ipairs(frames) do if rawget(f, "OnDragStop") then handleFrame = f end end
  Debuffs:SetGrow("left")
  panelFrame.pts = { { "CENTER", UIParent, "CENTER", 40, -20 } }
  local dl, dr, dt = edges(panelFrame)
  handleFrame.OnDragStop(handleFrame)
  local saved = CRT.db.debuffs.position
  local nl, nr, nt = edges(panelFrame)
  check("a drag with right to left saves the top right", saved.point == "TOPRIGHT" and saved.relativePoint == "CENTER", saved.point)
  check("and the panel stays where it was dropped", near(nl, dl) and near(nr, dr) and near(nt, dt), tostring(nr) .. " vs " .. tostring(dr))
  Debuffs:Fire() -- as after a /reload: the saved position is applied as it is
  local _, rr = edges(panelFrame)
  check("the saved drag comes back in the same place", near(rr, dr) and panelFrame.pts[1][1] == "TOPRIGHT")
  Debuffs:SetGrow("right")
  panelFrame.pts = { { "BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -100, 50 } }
  dl = edges(panelFrame)
  handleFrame.OnDragStop(handleFrame)
  check("a drag with left to right saves the top left", CRT.db.debuffs.position.point == "TOPLEFT" and near(edges(panelFrame), dl), CRT.db.debuffs.position.point)
  Debuffs:SetSize(44) Debuffs:SetMaxCount(4) Debuffs:SetSpacing(4) Debuffs:Set("borderScale", 1)
end

-- Where the panel shows: everywhere, in and out of combat, hidden only by the settings. The game's
-- candidate filter rule for the fields the panel uses, as in Blizzard_AuraContainerUtil.lua
-- (DoesAuraPassCandidateFilters): a duration above maxDuration, or a permanent one (0), is left out
-- when maxDuration is set.
local function passes(filters, aura)
  if filters.isFromPlayerOrPlayerPet ~= nil and aura.isFromPlayerOrPlayerPet ~= filters.isFromPlayerOrPlayerPet then return false end
  if filters.maxDuration ~= nil and (aura.duration > filters.maxDuration or aura.duration == 0) then return false end
  return true
end
local containerFrame
for _, f in ipairs(frames) do if f.kind == "AuraContainer" then containerFrame = f end end
IsInRaid = function() return false end
IsInGroup = function() return false end
IsInInstance = function() return false, "none" end
local function tick() panelFrame.OnUpdate(panelFrame, 0.01) end
local function realRowShown() return panelFrame:GetAlpha() == 1 and containerFrame:GetAlpha() == 1 end
CRT.db.debuffs.maxDuration = defaults.maxDuration
local minute = { duration = 60, isFromPlayerOrPlayerPet = false }
tick()
check("a 60 s debuff passes the default filters", passes(Debuffs:CandidateFilters(), minute))
check("out of combat, solo in the open world, the panel shows its debuffs", realRowShown(), panelFrame:GetAlpha())
events.OnEvent(events, "PLAYER_REGEN_DISABLED") tick()
check("in combat the panel shows", realRowShown(), panelFrame:GetAlpha())
events.OnEvent(events, "PLAYER_REGEN_ENABLED") tick()
check("after combat the panel still shows", realRowShown(), panelFrame:GetAlpha())
IsInRaid = function() return true end
IsInInstance = function() return true, "raid" end
tick()
check("in a raid the panel shows", realRowShown(), panelFrame:GetAlpha())
IsInRaid = function() return false end
IsInInstance = function() return false, "none" end
Debuffs:SetEnabled(false) tick()
check("turned off, the panel is hidden", panelFrame:GetAlpha() == 0, panelFrame:GetAlpha())
Debuffs:SetEnabled(true) tick()
check("turned on again, it shows", realRowShown(), panelFrame:GetAlpha())
check("a debuff you cast is left out", not passes(Debuffs:CandidateFilters(), { duration = 10, isFromPlayerOrPlayerPet = true }))

-- The time filter at its edge.
Debuffs:SetMaxDuration(60)
local f60 = Debuffs:CandidateFilters()
check("limit 60: a 60 s debuff shows", passes(f60, { duration = 60, isFromPlayerOrPlayerPet = false }))
check("limit 60: a 60.0 s debuff shows", passes(f60, { duration = 60.0, isFromPlayerOrPlayerPet = false }))
check("limit 60: a 59.9 s debuff shows", passes(f60, { duration = 59.9, isFromPlayerOrPlayerPet = false }))
check("limit 60: a 60.5 s debuff is hidden", not passes(f60, { duration = 60.5, isFromPlayerOrPlayerPet = false }))
check("limit 60: a permanent debuff is hidden", not passes(f60, { duration = 0, isFromPlayerOrPlayerPet = false }))
Debuffs:SetMaxDuration(30)
check("limit 30: the 60 s debuff is hidden", not passes(Debuffs:CandidateFilters(), minute))
check("limit 30: a 20 s debuff shows", passes(Debuffs:CandidateFilters(), { duration = 20, isFromPlayerOrPlayerPet = false }))
Debuffs:SetMaxDuration(60.7)
check("a limit with decimals is whole seconds", Debuffs:MaxDuration() == 60, Debuffs:MaxDuration())
Debuffs:SetMaxDuration(0)
local fOff = Debuffs:CandidateFilters()
check("limit Off: no duration filter is passed", fOff.maxDuration == nil, tostring(fOff.maxDuration))
check("limit Off: a 10 min debuff shows", passes(fOff, { duration = 600, isFromPlayerOrPlayerPet = false }))
check("limit Off: a permanent debuff shows", passes(fOff, { duration = 0, isFromPlayerOrPlayerPet = false }))
Debuffs:SetMaxDuration(defaults.maxDuration)

-- The preview tiles color their border only where the sample's type is known.
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
check("6 sample tiles with a dispel type get a colored frame", colored == 6, colored)
check("2 sample tiles without one keep the dark frame", plain == 2, plain)
-- Each sample's frame: its dispel type's color, else dark; the big yellow number and the stacks.
local tilesByIndex = {}
for _, f in ipairs(frames) do if rawget(f, "parts") and f.shown and f.pts[1] then tilesByIndex[#tilesByIndex + 1] = f end end
table.sort(tilesByIndex, function(a, b) return a.pts[1][4] < b.pts[1][4] end)
local samples = Panel.SAMPLES
local colorsOK, darkOK, textOK, stacksOK = true, true, true, true
for i, tile in ipairs(tilesByIndex) do
  local s, p = samples[i], rawget(tile, "parts")
  if s.dispel then
    local r, g, b = Debuffs:DispelColor(s.dispel)
    local v = p.dispelBorder.vertex
    if not (p.dispelBorder.shown and v and v[1] == r and v[2] == g and v[3] == b) then colorsOK = false end
  else
    local c = p.border.color
    if p.dispelBorder.shown or not (c and c[1] == Debuffs.BORDER_COLOR[1] and c[2] == Debuffs.BORDER_COLOR[2] and c[3] == Debuffs.BORDER_COLOR[3]) then darkOK = false end
  end
  if p.count.text ~= Panel.StackText(s.stacks) then stacksOK = false end
end
check("a dispellable sample's frame is its dispel type's color", colorsOK and #tilesByIndex == 8, #tilesByIndex)
check("a sample with no dispel type keeps the dark frame", darkOK)
check("the samples' stacks read as the game shows them", stacksOK)
panelFrame.OnUpdate(panelFrame, 1)
for i, tile in ipairs(tilesByIndex) do
  local want = Panel.FormatTime(samples[i].left)
  if rawget(tile, "parts").time.text ~= want then textOK = false print("  tile " .. i .. ": " .. tostring(rawget(tile, "parts").time.text) .. " not " .. want) end
end
check("the samples' countdown reads like the real one, with no s", textOK)
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
Debuffs:SetMaxCount(4)
local info = Panel:InfoText()
check("diagnostics list the new settings", info:find("dispel icon size 20%%") and info:find("frame colored by dispel type") and info:find("glow false") and info:find("spacing 4"), info:match("Settings:[^\\n]*"))

-- The tab.
assert(load(ignoreSrc, "Ignore.lua"))("CowfeeRaidTools", CRT)
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
check("the duration's (?) says what happens to debuffs with no end time", helps["Hide debuffs longer than"] ~= nil and helps["Hide debuffs longer than"]:find("no end time") ~= nil)
local onBox
for _, f in ipairs(frames) do
  local l = rawget(f, "label")
  if f.kind == "CheckButton" and l and rawget(l, "text") == "Show the debuff panel" then onBox = f end
end
check("the on box reads Show the debuff panel, not in combat only", onBox ~= nil)
check("other sliders type what they show", ds and ds.opts.toDisplay == nil and sliders["Spacing"] and sliders["Spacing"].opts.toDisplay == nil)
local sp = sliders["Spacing"]
check("spacing slider is 0 to 20", sp and sp.opts.min == 0 and sp.opts.max == 20)
check("spacing slider reads the setting", sp and sp.opts.get() == 4)
if sp then sp.opts.set(12) end
check("spacing slider saves", Debuffs:Spacing() == 12, Debuffs:Spacing())
Debuffs:SetSpacing(4)
check("spacing has a (?) help that mentions the border", helps["Spacing"] ~= nil and helps["Spacing"]:find("border") ~= nil)
local gd = dropdowns["Grow"]
check("a Grow dropdown with the two directions", gd and gd.opts.options == Debuffs.GROW_DIRECTIONS)
check("Grow reads the setting", gd and gd.opts.get() == "right", gd and gd.opts.get())
if gd then gd.opts.set("left") end
check("Grow saves", Debuffs:Grow() == "left", Debuffs:Grow())
if gd then gd.opts.set("right") end
check("the Look help explains Grow", helps["Look"] ~= nil and helps["Look"]:find("Grow:") ~= nil and helps["Look"]:find("Right to left") ~= nil)
local gx, gy = gd and gd.pts[1] and gd.pts[1][2], gd and gd.pts[1] and gd.pts[1][3]
check("Grow sits in the Look column, inside the page", gx == 440 and gy and gy < 0 and gy > -CRT.UI.PAGE_H, tostring(gx) .. "," .. tostring(gy))
Debuffs:SetDispelIconScale(0.35)
check("dispel icon size reads the saved scale", ds and ds.opts.get() == 35, ds and ds.opts.get())
ds.opts.set(70)
check("dispel icon size saves a fraction", math.abs(Debuffs:DispelIconScale() - 0.7) < 1e-9, Debuffs:DispelIconScale())
Debuffs:SetDispelIcon(false)
check("dispel icon size is off while the dispel icon is off", ds.opts.enabledIf() == false)
Debuffs:SetDispelIcon(true)
check("dispel icon size is on with the dispel icon", ds.opts.enabledIf() == true)

-- The look boxes save through Debuffs' setters.
local function findCheck(label)
  for _, f in ipairs(frames) do
    local l = rawget(f, "label")
    if f.kind == "CheckButton" and l and rawget(l, "text") == label then return f end
  end
end
local borderBox, glowBox = findCheck("Color the border by dispel type"), findCheck("Glow on dispellable debuffs")
check("the colored border box is gone, the glow box stays", borderBox == nil and glowBox ~= nil)
check("the glow box has a (?) help that says the frame takes the dispel color", helps["Glow on dispellable debuffs"] ~= nil and helps["Glow on dispellable debuffs"]:find("frame") ~= nil)
check("the Look help describes the frame and the countdown", helps["Look"] ~= nil and helps["Look"]:find("frame") ~= nil and helps["Look"]:find("yellow") ~= nil)
rawset(glowBox, "GetChecked", function() return true end)
glowBox.OnClick(glowBox)
check("glow ticked: saved and on", CRT.db.debuffs.dispelGlow == true and Debuffs:DispelGlow() == true)
Debuffs:SetDispelGlow(false)

-- Show tooltips on hover, in the Look column, with its (?) and the panel's own Tooltip position beside it.
do
  local tipBox = findCheck("Show tooltips on hover")
  check("a Show tooltips on hover box", tipBox ~= nil)
  local help = helps["Show tooltips on hover"]
  check("its (?) says the icons take the mouse, and that off keeps the panel click-through", help ~= nil and help:find("mouse", 1, true) ~= nil and help:find("click-through", 1, true) ~= nil, help)
  check("its (?) says what happens in combat and with the boss debuff slots", help ~= nil and help:find("combat", 1, true) ~= nil and help:find("boss debuff slots", 1, true) ~= nil, help)
  check("its (?) says the game's tooltip spot opens next to the icon", help ~= nil and help:find("Game's tooltip spot", 1, true) ~= nil, help)
  if tipBox then
    local p = tipBox.pts[1]
    check("the box sits in the Look column, under the glow, above the Ignore section's lists", p and p[2] == 436 and p[3] <= -228 and p[3] - 26 > -270, p and (p[2] .. "," .. p[3]))
    rawset(tipBox, "GetChecked", function() return true end)
    tipBox.OnClick(tipBox)
    check("ticked: saved and on", CRT.db.debuffs.tooltips == true)
    rawset(tipBox, "GetChecked", function() return false end)
    tipBox.OnClick(tipBox)
    check("unticked: saved and off", CRT.db.debuffs.tooltips == false)
    pf:Show()
    Debuffs:SetTooltips(true)
    check("the box shows the setting", rawget(tipBox, "checked") == true)
    Debuffs:SetTooltips(false)
    check("and shows it off", rawget(tipBox, "checked") == false)
  end
  local pos = dropdowns["Tooltip position"]
  check("the panel's own Tooltip position, for the debuffs area", pos and pos.opts.options == CRT.UI.TOOLTIP_AREA_POSITIONS)
  if pos then
    pos.opts.set("cursor")
    check("it saves in CRTDB.debuffs", CRT.db.debuffs.tooltipMode == "cursor")
    pos.opts.set("general")
    Debuffs:SetTooltips(false)
    check("greyed while tooltips are off", pos.opts.enabledIf and pos.opts.enabledIf() == false)
    Debuffs:SetTooltips(true)
    check("usable while they are on", pos.opts.enabledIf() == true)
    Debuffs:SetEnabled(false)
    check("greyed while the panel is off", pos.opts.enabledIf() == false)
    Debuffs:SetEnabled(true)
    Debuffs:SetTooltips(false)
    -- placed from the box's label as drawn: beside it when the row fits on the page, else under the box
    local label = tipBox and tipBox.label
    local function placedFor(width)
      rawset(label, "GetStringWidth", function() return width end)
      pf:Show() Debuffs:Fire()
      local p = pos.pts[1]
      return p, p and (p[2] + 100 + 5 + 140 + 12 + 126) or 0, 436 + 26 + 2 + width + 4 + 20
    end
    local p, right, labelEnd = placedFor(120)
    check("a usual label: the row sits beside the box at 630, on the page", p and #pos.pts == 1 and p[2] == 630 and p[3] == -228 and right <= CRT.UI.PAGE_W and labelEnd < 630,
      p and (p[2] .. "," .. p[3] .. " right " .. right))
    p, right, labelEnd = placedFor(140)
    check("a bigger font: the row moves right, past the label and its (?), still on the page", p and p[2] >= labelEnd + 12 and p[3] == -228 and right <= CRT.UI.PAGE_W,
      p and (p[2] .. "," .. p[3] .. " right " .. right))
    p, right = placedFor(260)
    check("no room beside it: the row goes under the box, on the page", p and p[3] <= -228 - 26 and p[3] > -294 and p[2] > 460 and right <= CRT.UI.PAGE_W and #pos.pts == 1,
      p and (p[2] .. "," .. p[3] .. " right " .. right))
    rawset(label, "GetStringWidth", nil)
    check("its picker's box stands for the icon", spotPickers[#spotPickers] and spotPickers[#spotPickers].opts.label == "The icon")
    check("its (?) says a change waits for an encounter to end, and an icon made in one keeps the game's own hover",
      help and help:find("encounter", 1, true) ~= nil and help:find("game's own hover", 1, true) ~= nil, help)
  end
end

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

-- The Debuffs tab's (?) and Preview debuffs: the button sits right of the title's (?).
do
  local p = pb and pb.pts[1]
  check("Preview debuffs is anchored to the title's (?), not off the page", p and type(p[2]) == "table" and rawget(p[2], "helpTarget") ~= nil, p and tostring(p[2]))
end

-- Ignore these debuffs ----------------------------------------------------------------------
-- The game's spells, their secrecy (C_Secrets.GetSpellAuraSecrecy: 0 never secret, 2 contextually
-- secret) and your debuffs (C_UnitAuras.GetAuraDataByIndex), as the game gives them.
local SPELLS = {
  [57723] = { name = "Exhaustion", icon = 136090 }, [80354] = { name = "Temporal Displacement", icon = 458224 },
  [389123] = { name = "Lingering Doom", icon = 1001 }, [442611] = { name = "Old Scar", icon = 1002 },
  [500001] = { name = "Short Burn", icon = 1003 }, [500002] = { name = "Quick Poison", icon = 1004 },
}
local NEVER_SECRET = { [57723] = true, [80354] = true, [389123] = true, [500001] = true, [500002] = true }
C_Spell = {
  GetSpellTexture = function(id) return SPELLS[id] and SPELLS[id].icon or nil end,
  DoesSpellExist = function(id) return SPELLS[id] ~= nil end,
  GetSpellInfo = function(id) local s = SPELLS[id] if s then return { name = s.name, iconID = s.icon, spellID = id } end end,
}
Enum.SecrecyLevel = { NeverSecret = 0, AlwaysSecret = 1, ContextuallySecret = 2 }
C_Secrets = { GetSpellAuraSecrecy = function(id) return NEVER_SECRET[id] and 0 or 2 end }
local AURAS = {}
local auraReads = 0
C_UnitAuras.GetAuraDataByIndex = function(unit, index, filter)
  auraReads = auraReads + 1
  if unit ~= "player" or filter ~= "HARMFUL" then return nil end
  return AURAS[index]
end
local function aura(id, duration, expires, instance, fromYou)
  return { spellId = id, name = SPELLS[id] and SPELLS[id].name or "?", icon = SPELLS[id] and SPELLS[id].icon, duration = duration,
    expirationTime = expires, auraInstanceID = instance, isFromPlayerOrPlayerPet = fromYou or false, isHarmful = true }
end
local box
for _, f in ipairs(frames) do if f.kind == "AuraContainer" then box = f end end
rawset(box, "SetAuraGroupCandidateFilters", function(self, key, filters) rawset(self, "lastFilters", filters) end)
local fired = 0
Debuffs:OnChange(function() fired = fired + 1 end)

do
  check("the default ignored list is empty", type(defaults.ignored) == "table" and next(defaults.ignored) == nil)
  CRT.db.debuffs.ignored = nil
  check("old saved data without a list reads as empty", #Debuffs:IgnoredList() == 0 and type(CRT.db.debuffs.ignored) == "table")
  -- spell IDs
  local ids = { { "57723", 57723 }, { " 12 ", 12 }, { 389123, 389123 }, { "12a", nil }, { "0", nil }, { "-3", nil }, { 1.5, nil }, { "0x10", nil }, { "", nil }, { SECRET, nil } }
  for _, c in ipairs(ids) do
    check("spell ID " .. tostring(rawequal(c[1], SECRET) and "(secret)" or c[1]) .. " reads " .. tostring(c[2]), Debuffs.SpellID(c[1]) == c[2], tostring(Debuffs.SpellID(c[1])))
  end
  local n, i = Debuffs.SpellInfo("389123")
  check("a spell's name and icon come from the game", n == "Lingering Doom" and i == 1001, tostring(n) .. " " .. tostring(i))
  check("an ID the game has no spell for gives nothing", Debuffs.SpellInfo(999) == nil)
  check("Exhaustion can be hidden: the game flags it never secret", Debuffs.CanHide(57723) == true)
  check("a contextually secret spell can't be hidden by its ID", Debuffs.CanHide(442611) == false)
  local savedSecrets = C_Secrets
  C_Secrets = nil
  check("without the secrecy API it can't say", Debuffs.CanHide(57723) == nil)
  C_Secrets = { GetSpellAuraSecrecy = function() return SECRET end }
  check("a secret secrecy is never compared", Debuffs.CanHide(500002) == nil)
  C_Secrets = savedSecrets
  local asked = 0
  C_Secrets = { GetSpellAuraSecrecy = function(id) asked = asked + 1 return savedSecrets.GetSpellAuraSecrecy(id) end }
  Debuffs.CanHide(500002) Debuffs.CanHide(500002) Debuffs.CanHide(500002)
  check("each spell's secrecy is asked once and kept", asked == 1, asked)
  C_Secrets = savedSecrets
  local savedInfo = C_Spell.GetSpellInfo
  C_Spell.GetSpellInfo = function() return { name = SECRET, iconID = SECRET } end
  check("a secret spell name is never compared, and gives nothing", Debuffs.SpellInfo(389123) == nil)
  C_Spell.GetSpellInfo = savedInfo

  -- adding and removing
  local before = fired
  local id, err = Debuffs:AddIgnored("389123")
  check("Add saves a typed spell ID as a number", id == 389123 and CRT.db.debuffs.ignored[389123] == true, tostring(err))
  check("and refreshes listeners", fired == before + 1, fired - before)
  check("the panel's filter now leaves it out, with the built-in ones", box.lastFilters and box.lastFilters.excludeSpellIDs[389123] == true and box.lastFilters.excludeSpellIDs[57723] == true)
  check("CandidateFilters has both lists", Debuffs:CandidateFilters().excludeSpellIDs[389123] and Debuffs:CandidateFilters().excludeSpellIDs[80354])
  local _, e2 = Debuffs:AddIgnored(389123)
  check("adding it again says so", e2 == Debuffs.IGNORE_TEXT.already, e2)
  local _, e3 = Debuffs:AddIgnored(57723)
  check("a built-in one says it's always ignored", e3 == Debuffs.IGNORE_TEXT.builtIn and CRT.db.debuffs.ignored[57723] == nil, e3)
  local _, e4 = Debuffs:AddIgnored("999")
  check("a non-spell ID says so and isn't added", e4 == Debuffs.IGNORE_TEXT.notSpell and CRT.db.debuffs.ignored[999] == nil, e4)
  local _, e5 = Debuffs:AddIgnored("abc")
  check("text that isn't an ID says so", e5 == Debuffs.IGNORE_TEXT.notID, e5)
  check("a non-hideable spell can still be added", Debuffs:AddIgnored(442611) == 442611)
  CRT.db.debuffs.ignored.junk = true CRT.db.debuffs.ignored[0] = true CRT.db.debuffs.ignored[77] = "yes"
  local list = Debuffs:IgnoredList()
  check("junk saved keys are skipped", #list == 2 and list[1] == 389123 and list[2] == 442611, table.concat(list, ","))
  check("and never reach the filter", Debuffs:CandidateFilters().excludeSpellIDs.junk == nil and Debuffs:CandidateFilters().excludeSpellIDs[0] == nil)
  CRT.db.debuffs.ignored.junk, CRT.db.debuffs.ignored[0], CRT.db.debuffs.ignored[77] = nil, nil, nil
  -- in combat the filter change waits, like any other, and applies when combat ends
  combat = true
  Debuffs:RemoveIgnored(389123)
  check("Remove takes it off the list at once", CRT.db.debuffs.ignored[389123] == nil)
  check("in combat the panel's filter waits", box.lastFilters.excludeSpellIDs[389123] == true)
  combat = false
  events.OnEvent(events, "PLAYER_REGEN_ENABLED")
  check("after combat the panel shows it again", box.lastFilters.excludeSpellIDs[389123] == nil)
  -- the list is capped at what a shared settings table may hold
  local full = {}
  for k = 1, Debuffs.MAX_IGNORED do full[k] = true end
  CRT.db.debuffs.ignored = full
  SPELLS[600000] = { name = "One Too Many", icon = 1 }
  local _, e6 = Debuffs:AddIgnored(600000)
  check("a full list says so", e6 == Debuffs.IGNORE_TEXT.full, e6)
  SPELLS[600000] = nil
  CRT.db.debuffs.ignored = { [442611] = true }
end

-- What the panel's row holds now, worked out the way the game fills it.
do
  CRT.db.debuffs.maxDuration = 300
  AURAS = {
    aura(500002, 20, 130, 7), -- ends at 130
    aura(500001, 10, 110, 9), -- ends first
    aura(57723, 600, 700, 3), -- Exhaustion: built in, and the game hides it
    aura(442611, 60, 110, 5), -- ignored but the game won't hide it: same end as 500001, lower instance first
    aura(389123, 30, 120, 4, true), -- your own: left out
    aura(80354, 0, 0, 2), -- no end, and a limit is set: left out
  }
  local list = Debuffs:Current()
  local order = {}
  for _, a in ipairs(list or {}) do order[#order + 1] = a.spellId end
  check("the row's debuffs, soonest to end first, as the game sorts them", table.concat(order, ",") == "442611,500001,500002", table.concat(order, ","))
  check("a debuff the game won't hide is marked", list and list[1].canHide == false and list[2].canHide == true)
  CRT.db.debuffs.maxDuration = 0
  AURAS[7] = aura(389123, 0, 0, 1) -- no end, from an enemy: shown with no limit, after the timed ones
  list = Debuffs:Current()
  order = {}
  for _, a in ipairs(list or {}) do order[#order + 1] = a.spellId end
  check("with no limit, a debuff with no end sorts last, and the built-in ones stay out", table.concat(order, ",") == "442611,500001,500002,389123", table.concat(order, ","))
  AURAS[7] = nil
  CRT.db.debuffs.maxDuration = 300
  AURAS[2] = aura(500001, 10, SECRET, 9)
  local okSecret, l2 = pcall(Debuffs.Current, Debuffs)
  local o2 = {}
  for _, a in ipairs(okSecret and l2 or {}) do o2[#o2 + 1] = a.unreadable and "?" or tostring(a.spellId) end
  check("a debuff with a secret value holds a spot of its own, unread; the rest still read", okSecret and table.concat(o2, ",") == "442611,500002,?", tostring(l2) .. " " .. table.concat(o2, ","))
  -- a missing name and icon, then a secret end time: every value is still checked, nothing compared
  AURAS[2] = { spellId = 500001, name = nil, icon = nil, duration = 10, expirationTime = SECRET, auraInstanceID = 9, isFromPlayerOrPlayerPet = false }
  local okNil, l3 = pcall(Debuffs.Current, Debuffs)
  check("a nil name and icon don't skip the secret checks after them", okNil and l3 and l3[#l3].unreadable == true, tostring(l3))
  AURAS[2] = { spellId = 500001, name = nil, icon = nil, duration = 10, expirationTime = 110, auraInstanceID = 9, isFromPlayerOrPlayerPet = false }
  local l4 = Debuffs:Current()
  check("a debuff with no name or icon still reads, by its spell ID", l4 and l4[2] and l4[2].spellId == 500001 and l4[2].icon == nil and l4[2].name == "Spell 500001")
  AURAS[2] = aura(500001, 10, 110, 9)
end

-- Right-click a debuff on the panel.
local menus = {}
CRT.UI.ContextMenu = function(owner, fill)
  local root = { titles = {}, buttons = {} }
  function root:CreateTitle(text) self.titles[#self.titles + 1] = text end
  function root:CreateButton(text, fn) self.buttons[#self.buttons + 1] = { text = text, fn = fn } end
  fill(root)
  root.owner = owner
  menus[#menus + 1] = root
  return root
end
local function buttonNamed(menu, text)
  for _, b in ipairs(menu and menu.buttons or {}) do if b.text == text then return b end end
end
do
  CRT.db.debuffs.ignored = {}
  Debuffs:SetMaxCount(4)
  Debuffs:Fire()
  local c = Click.catchers
  local shownSpots, mice = 0, {}
  for i, s in ipairs(c) do
    if s.shown then shownSpots = shownSpots + 1 end
    mice[i] = tostring(rawget(s, "mouse"))
  end
  check("one right-click spot per icon shown, the rest hidden", shownSpots == 4, shownSpots)
  check("only spots holding a debuff take the mouse", table.concat(mice, ","):find("^true,true,true,false") ~= nil and not table.concat(mice, ","):find("true", 16), table.concat(mice, ","))
  check("a spot takes right-clicks only, and never hover", c[1].clicks and c[1].clicks[1] == "RightButtonUp" and #c[1].clicks == 1 and rawget(c[1], "motion") == false)
  local pass = c[1].passThrough and table.concat(c[1].passThrough, ",") or ""
  check("left-clicks pass through the spot", pass:find("LeftButton") ~= nil and not pass:find("RightButton"), pass)
  local step = Debuffs:Step(Debuffs:Size())
  check("each spot sits over its icon", c[2].pts[1] and c[2].pts[1][1] == "TOPLEFT" and c[2].pts[1][4] == step and c[2].w == Debuffs:Size(), c[2].pts[1] and c[2].pts[1][4])
  check("the spots sit above the icons, their glow and text", c[1]:GetFrameLevel() >= panelFrame:GetFrameLevel() + 25)

  -- out of combat: the menu names the debuff and offers Ignore this debuff and Cancel
  c[2].OnClick(c[2], "RightButton")
  local m = menus[#menus]
  check("the menu's title is the debuff's name and icon", m and m.titles[1] and m.titles[1]:find("Short Burn", 1, true) and m.titles[1]:find("1003", 1, true), m and m.titles[1])
  check("with Ignore this debuff and Cancel", buttonNamed(m, Click.TEXT.ignore) ~= nil and buttonNamed(m, Click.TEXT.cancel) ~= nil)
  buttonNamed(m, Click.TEXT.ignore).fn()
  check("Ignore this debuff adds it", CRT.db.debuffs.ignored[500001] == true)
  check("and the panel's filter leaves it out at once", box.lastFilters.excludeSpellIDs[500001] == true)
  -- the debuff the game won't hide says so instead
  c[1].OnClick(c[1], "RightButton")
  m = menus[#menus]
  check("a debuff the game won't hide: it says it still shows, and can still be added", m.titles[1]:find("Old Scar", 1, true) and m.titles[2] == Debuffs.IGNORE_TEXT.cantHide and buttonNamed(m, Click.TEXT.ignore) ~= nil)
  buttonNamed(m, Click.TEXT.ignore).fn()
  check("Ignore adds it like typing it", CRT.db.debuffs.ignored[442611] == true)
  -- a left-click does nothing
  local count = #menus
  c[3].OnClick(c[3], "LeftButton")
  check("a left-click opens no menu", #menus == count)
  -- a menu opened out of combat, then combat starts: Ignore adds nothing
  CRT.db.debuffs.ignored = {}
  Debuffs:Fire()
  c[2].OnClick(c[2], "RightButton")
  m = menus[#menus]
  combat = true
  clickEvents.OnEvent(clickEvents, "PLAYER_REGEN_DISABLED")
  buttonNamed(m, Click.TEXT.ignore).fn()
  check("Ignore after combat starts adds nothing", CRT.db.debuffs.ignored[500001] == nil)
  local held = false
  for _, s in ipairs(c) do if rawget(s, "mouse") then held = true end end
  check("in combat every spot lets go: the panel is click-through", not held)
  c[2].OnClick(c[2], "RightButton")
  m = menus[#menus]
  check("in combat the menu says to try again after combat", m.titles[1] == Click.TEXT.later and buttonNamed(m, Click.TEXT.ignore) == nil and buttonNamed(m, Click.TEXT.cancel) ~= nil)
  panelFrame.OnUpdate(panelFrame, 1)
  held = false
  for _, s in ipairs(c) do if rawget(s, "mouse") then held = true end end
  check("the spots stay click-through all combat", not held)
  combat = false
  events.OnEvent(events, "PLAYER_REGEN_ENABLED")
  check("after combat the spots take right-clicks again", rawget(c[1], "mouse") == true)
  -- a secret value: try again, nothing added
  AURAS[1] = aura(500002, 20, 130, SECRET) -- its end time still places it third
  c[3].OnClick(c[3], "RightButton")
  m = menus[#menus]
  c[1].OnClick(c[1], "RightButton")
  check("the other spots still read", menus[#menus].titles[1]:find("Old Scar", 1, true) ~= nil)
  c[3].OnClick(c[3], "RightButton")
  m = menus[#menus]
  check("a secret value out of combat: the menu says it can't read this debuff", m.titles[1] == Click.TEXT.unreadable and buttonNamed(m, Click.TEXT.ignore) == nil, m.titles[1])
  -- the spots aren't worked out again on every layout: only when your debuffs change
  AURAS[1] = aura(500002, 20, 130, 7)
  clickEvents.OnEvent(clickEvents, "UNIT_AURA", "player")
  local reads = auraReads
  for _ = 1, 5 do panelFrame.OnUpdate(panelFrame, 1) end
  check("layouts reuse the spots' debuffs", auraReads == reads, auraReads - reads)
  AURAS[4] = nil AURAS[5] = nil AURAS[6] = nil -- Old Scar's slot and later ones end
  clickEvents.OnEvent(clickEvents, "UNIT_AURA", "player")
  check("UNIT_AURA works them out again", auraReads > reads and rawget(c[3], "mouse") ~= true and rawget(c[2], "mouse") == true)
  AURAS = { aura(500002, 20, 130, 7), aura(500001, 10, 110, 9), aura(57723, 600, 700, 3), aura(442611, 60, 110, 5), aura(389123, 30, 120, 4, true), aura(80354, 0, 0, 2) }
  clickEvents.OnEvent(clickEvents, "UNIT_AURA", "player")
  AURAS[1] = aura(500002, 20, 130, 7)
  -- during a preview the panel is click-through
  Panel:SetPreview(true)
  held = false
  for _, s in ipairs(c) do if rawget(s, "mouse") then held = true end end
  check("during a preview the spots let go", not held)
  Panel:SetPreview(false)
  Debuffs:SetEnabled(false)
  check("with the panel off the spots let go", not rawget(c[1], "mouse"))
  Debuffs:SetEnabled(true)
end

-- The section on the tab.
do
  local I = CRT.DebuffsIgnore
  local v = I.view
  check("the section has a title with a (?)", v.title and v.title.text == "Ignore these debuffs" and v.help and rawget(v.help, "helpTarget") == v.title)
  check("its (?) says the boss debuff slots can't be filtered", helps["Ignore these debuffs"] and helps["Ignore these debuffs"]:find("boss debuff slots", 1, true) ~= nil)
  local function type_(text) v.edit:SetText(text) v.edit.OnTextChanged(v.edit, true) end
  type_("389123")
  check("typing a spell ID shows its name", v.name.text == "Lingering Doom", v.name.text)
  check("and its icon", v.icon.texture == 1001 and v.icon.shown)
  check("and says Add hides it", v.status.text == I.TEXT.canHide, v.status.text)
  check("the Spell ID box and the tab's nudge boxes take the look", CRT.UI.skinned[v.edit] == "edit" and (function()
    local n = 0 for o, k in pairs(CRT.UI.skinned) do if k == "edit" and o ~= v.edit then n = n + 1 end end return n == 2 end)())
  check("Add is the shared button, sized from its label and skinned", CRT.UI.skinned[v.add] == "button" and v.add.w == math.max(40, #"Add" * 7 + 28))
  local savedSecrets2 = C_Secrets
  C_Secrets = nil
  type_("500001")
  check("when the game can't say whether it hides it, the status says nothing", v.name.text == "Short Burn" and v.status.text == "", v.status.text)
  C_Secrets = savedSecrets2
  type_("442611")
  check("a spell the game won't hide says it still shows", v.status.text and v.status.text:find(Debuffs.IGNORE_TEXT.cantHide, 1, true) ~= nil, v.status.text)
  type_("999")
  check("a non-spell ID says so", v.name.text and v.name.text:find(I.TEXT.noSpell, 1, true) ~= nil and not v.icon.shown, v.name.text)
  v.add.OnClick(v.add)
  check("and Add doesn't add it", CRT.db.debuffs.ignored[999] == nil and v.status.text:find(Debuffs.IGNORE_TEXT.notSpell, 1, true) ~= nil, v.status.text)
  type_("")
  check("an empty box shows nothing", v.name.text == "" and not v.icon.shown)
  type_("389123")
  v.add.OnClick(v.add)
  check("Add puts it on Yours and clears the box", CRT.db.debuffs.ignored[389123] == true and v.edit.text == "")
  check("Yours shows it with a Remove button", v.rows[1] and v.rows[1].shown and v.rows[1].id == 389123 and v.rows[1].name.text:find("Lingering Doom", 1, true) and v.rows[1].remove ~= nil)
  check("and the panel stops showing it", box.lastFilters.excludeSpellIDs[389123] == true)
  check("a new row's Remove button takes the look", CRT.UI.skinned[v.rows[1].remove] == "button")
  check("the empty-list line hides", not v.none.shown)
  -- a debuff ignored by right-click shows up in the list at once
  Debuffs:AddIgnored(442611)
  check("a change made elsewhere shows at once", v.rows[2] and v.rows[2].shown and v.rows[2].id == 442611)
  check("one the game won't hide is marked", v.rows[2].name.text:find(I.TEXT.stillShows, 1, true) ~= nil and v.rows[2].cantHide == true)
  v.rows[1].remove.OnClick(v.rows[1].remove)
  check("Remove takes it off", CRT.db.debuffs.ignored[389123] == nil and v.rows[1].id == 442611 and not v.rows[2].shown)
  check("and the panel shows it again", box.lastFilters.excludeSpellIDs[389123] == nil)
  -- built in, greyed, no Remove, with "and N more" past what fits
  local built = Debuffs:BuiltInList()
  local shown, greyed, removable = 0, true, false
  for _, row in ipairs(v.builtInRows) do
    if row.shown then
      shown = shown + 1
      if not (row.name.textColor and row.name.textColor[1] == 0.5 and row.icon.desaturated) then greyed = false end
      if row.remove then removable = true end
    end
  end
  check("the built-in list is greyed and can't be removed", shown > 0 and greyed and not removable)
  check("a built-in one the game won't hide is marked still shows", v.builtInRows[1].id == 26013 and v.builtInRows[1].cantHide and v.builtInRows[1].name.text:find(I.TEXT.stillShows, 1, true) ~= nil)
  check("a built-in one the game hides isn't marked", v.builtInRows[2].id == 57723 and not v.builtInRows[2].name.text:find(I.TEXT.stillShows, 1, true))
  check("the (?) quotes the setting and says right-drag doesn't start over an icon", helps["Ignore these debuffs"]:find('"Hide debuffs longer than"', 1, true) ~= nil and helps["Ignore these debuffs"]:find("right-drag", 1, true) ~= nil)
  local rest = v.more.rest and #v.more.rest or 0
  check("the built-in ones that don't fit read and N more", shown + rest == #built and (rest == 0 or (v.more.shown and v.moreText.text == format(I.TEXT.more, rest))), shown .. " + " .. rest .. " of " .. #built)
  check("the built-in names come from the game", v.builtInRows[1].title == (Debuffs.SpellInfo(built[1]) or ("Spell " .. built[1])))
  -- the layout fits inside the tab: the tab frame starts I.TAB_TOP under the page's top, as QoL/Page.lua puts it
  check("QoL/Page.lua's tab frames start where the section expects", qolPageSrc:find('f:SetPoint("TOPLEFT", 0, -' .. I.TAB_TOP .. ')', 1, true) ~= nil)
  local tabH = CRT.UI.PAGE_H - I.TAB_TOP
  local fits = true
  for _, b in ipairs({ v.yoursBox, v.builtInBox }) do
    local p = b.pts[1]
    if not (p and p[2] + b.w <= CRT.UI.PAGE_W and p[3] - b.h >= -tabH and p[3] < 0) then fits = false end
  end
  check("both lists fit inside the tab", fits, v.yoursBox.pts[1][3] .. " - " .. v.yoursBox.h)
  local titleY = v.title.pts[1][3]
  check("the section starts under the panel settings and the Look column", titleY <= -240, titleY)
  check("Yours scrolls when it grows past its space", v.scroll ~= nil and v.child ~= nil)
  for k = 1, 12 do SPELLS[700000 + k] = { name = "Filler " .. k, icon = 2000 + k } Debuffs:AddIgnored(700000 + k) end
  check("a long list makes the scroll child taller than the box", v.child.h > v.yoursBox.h, v.child.h)
  CRT.db.debuffs.ignored = {}
  Debuffs:Fire()
  check("an empty list says so", v.none.shown)
end

-- Without the glow's atlas there is no glow at all: a plain square above the icon would tint it.
C_Texture = { GetAtlasInfo = function() return nil end }
local before = #frames
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
local Panel2 = CRT.DebuffPanel
for i = before + 1, #frames do if rawget(frames[i], "OnEvent") then events = frames[i] end end
events.OnEvent(events, "PLAYER_LOGIN")
check("no glow atlas: a second panel is built", groupOpts ~= nil and #frames > before + 1)
local box2
for i = before + 1, #frames do if frames[i].kind == "AuraContainer" then box2 = frames[i] end end
check("a new container is anchored once, by its flow layout", box2 and rawget(box2, "setPoints") == 1 and #box2.pts == 1, box2 and rawget(box2, "setPoints"))
Debuffs:SetDispelGlow(true)
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
Debuffs:SetDispelGlow(false) Debuffs:SetMaxCount(4)

print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error("debuff checks failed") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Core.lua', 'CRT_Modules/Debuffs/Data.lua', 'CRT_Modules/Debuffs/Panel.lua', 'CRT_Modules/Debuffs/Page.lua',
  'CRT_Modules/Debuffs/Click.lua', 'CRT_Modules/Debuffs/Ignore.lua', 'CRT_Modules/QoL/Page.lua', 'CRT_Core/UI/Tooltip.lua'];
for (const f of files) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
