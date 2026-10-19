// Debuff panel settings and look: loads Core.lua (for the defaults), Debuffs/Data.lua, Debuffs/Panel.lua
// and Debuffs/Page.lua on mock frames. Checks the clamps, the defaults, the dispel colors (never from a
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
      local r = mock(k == "CreateTexture" and "Texture" or "FontString") rawset(r, "layer", layer) rawset(r, "sublevel", sub) return r end end
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
    if k == "SetBlendMode" then return function(self, b) rawset(self, "blend", b) end end
    if k == "GetFont" then return function() return "f", 12, "" end end
    if k == "GetTextColor" then return function() return 1, 1, 1 end end
    if k == "GetFrameLevel" then return function() return 1 end end
    if k == "GetPoint" then return function() return "CENTER", nil, "CENTER", 0, 0 end end
    if k == "IsForbidden" then return function() return false end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on) end end
    return function() end
  end })
end

-- Game stubs.
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
InCombatLockdown = function() return false end
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
  frames[#frames + 1] = f
  if kind == "AuraContainer" then
    rawset(f, "AddAuraGroup", function(self, key, filter, opts) groupOpts = opts return true end)
  end
  return f
end

local CRT = {}
assert(load(coreSrc, "Core.lua"))("CowfeeRaidTools", CRT)
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
  PAGE_W = 1026, PAGE_H = 560,
  RegisterLayer = function() end,
  RegisterPreview = function(_, key, fn) previewFns[key] = fn end,
  SetPreviews = function() end,
  ResetButton = function() return mock("Button") end,
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
end
Debuffs:SetDispelGlow(false)
check("border only: one PreserveAsset texture", styles() == "3", styles())
local borderTex = added[1].tex
check("the dispel border is the base border's size", borderTex.w == 44 + 5 and borderTex.shown)
Debuffs:Set("borderScale", 0)
check("border size 0 hides the dispel border too", #added == 0 and not borderTex.shown, styles())
Debuffs:Set("borderScale", 1)
Debuffs:SetDispelBorder(false)
check("border off: hidden and not registered", #added == 0 and not borderTex.shown, styles())

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
Panel:SetPreview(false)
check("the preview stops", Panel:IsPreviewing() == false)
Debuffs:SetDispelBorder(false)
Debuffs:SetMaxCount(4)
local info = Panel:InfoText()
check("diagnostics list the new settings", info:find("dispel icon size 20%%") and info:find("dispel border false") and info:find("glow false"), info:match("Settings:[^\\n]*"))

-- The tab.
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock("Frame")
CRT.DebuffsPage.Build(pf)
check("icon size slider goes to 128", sliders["Icon size"] and sliders["Icon size"].opts.max == 128)
local ds = sliders["Dispel icon size"]
check("dispel icon size slider is 20 to 100", ds and ds.opts.min == 20 and ds.opts.max == 100)
check("dispel icon size shows a percent", ds and ds.opts.format(35) == "35%")
Debuffs:SetDispelIconScale(0.35)
check("dispel icon size reads the saved scale", ds and ds.opts.get() == 35, ds and ds.opts.get())
ds.opts.set(70)
check("dispel icon size saves a fraction", math.abs(Debuffs:DispelIconScale() - 0.7) < 1e-9, Debuffs:DispelIconScale())
Debuffs:SetDispelIcon(false)
check("dispel icon size is off while the dispel icon is off", ds.opts.enabledIf() == false)
Debuffs:SetDispelIcon(true)
check("dispel icon size is on with the dispel icon", ds.opts.enabledIf() == true)
check("the dispel border has a (?) help", helps["Color the border by dispel type"] ~= nil)

print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error("debuff checks failed") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['Core.lua', 'Debuffs/Data.lua', 'Debuffs/Panel.lua', 'Debuffs/Page.lua']) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
}
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
