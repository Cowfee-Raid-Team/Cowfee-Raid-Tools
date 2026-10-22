// CRT_Core/UI/Tooltip.lua's spots and modes, and CRT_Core/UI/Controls.lua's UI.SpotPicker, on mock frames:
// each of the twelve spots places the tooltip with the SetOwner anchor warcraft.wiki.gg gives for it, or
// ANCHOR_NONE and a SetPoint; the game's spot and the cursor; an area's own choice and spot, and its
// fallback to General Settings; the flags; the picker (twelve spots, a click sets and highlights, greyed
// but still clickable, a subset, a tooltip naming each spot); and UI.TooltipPositionSetting, the dropdown
// with its picker under or beside it.
// Usage: node run_tooltip_spots.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, themesSrc, tooltipSrc, controlsSrc = ...
local unpack = unpack or table.unpack
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local function near(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end

-- mock frames, textures and font strings that remember what they were given
local function object(kind, parent)
  local o = { kind = kind, children = {}, regions = {}, scripts = {}, shown = true, alpha = 1, parent = parent, pts = {} }
  local m = {
    GetObjectType = function(self) return self.kind end,
    GetParent = function(self) return self.parent end,
    GetChildren = function(self) return unpack(self.children) end,
    CreateTexture = function(self, _, layer) local t = object("Texture", self) t.layer = layer self.regions[#self.regions + 1] = t return t end,
    CreateFontString = function(self, _, layer, font) local t = object("FontString", self) t.layer, t.font = layer, font self.regions[#self.regions + 1] = t return t end,
    SetPoint = function(self, ...) self.pts[#self.pts + 1] = { ... } end,
    ClearAllPoints = function(self) self.pts = {} end,
    SetAllPoints = function(self) self.all = true end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetWidth = function(self, w) self.w = w end,
    SetHeight = function(self, h) self.h = h end,
    GetWidth = function(self) return self.w or 0 end,
    GetHeight = function(self) return self.h or 0 end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end,
    IsShown = function(self) return self.shown end,
    SetAlpha = function(self, a) self.alpha = a end,
    SetColorTexture = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetVertexColor = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetText = function(self, s) self.text = s end,
    GetText = function(self) return self.text end,
    SetTextColor = function(self, r, g, b) self.textRGB = { r, g, b } end,
    GetTextColor = function(self) local c = self.textRGB or { 1, 1, 1 } return c[1], c[2], c[3] end,
    GetStringWidth = function(self) return #(self.text or "") * 7 end,
    SetEnabled = function(self, on) self.enabled = on and true or false end,
  }
  setmetatable(o, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
  if parent and parent.children and kind ~= "Texture" and kind ~= "FontString" then parent.children[#parent.children + 1] = o end
  return o
end
CreateFrame = function(kind, name, parent) return object(kind, parent) end

-- the tooltip: what SetOwner, ClearAllPoints, SetPoint and SetClampedToScreen got
local function newTip()
  local t = { calls = {} }
  t.SetOwner = function(self, owner, anchor, x, y) self.owner, self.anchor, self.x, self.y = owner, anchor, x, y self.point = nil self.cleared = false self.calls[#self.calls + 1] = "SetOwner" end
  t.ClearAllPoints = function(self) self.cleared = true self.point = nil end
  t.SetPoint = function(self, p, rel, rp, x, y) self.point = { p, rel, rp, x, y } end
  t.SetClampedToScreen = function(self, on) self.clamped = on end
  t.SetText = function(self, s) self.title = s end
  t.AddLine = function() end
  t.Show = function(self) self.shown = true end
  t.Hide = function(self) self.shown = false end
  return t
end
GameTooltip = newTip()
local defaults = {}
local function gameSpot() GameTooltip_SetDefaultAnchor = function(t, o) defaults[#defaults + 1] = { t, o } t:SetOwner(o, "ANCHOR_NONE") end end

local CRT = { db = { ui = { modern = false, theme = "blizzard", layers = {} } } }
assert(load(themesSrc, "Themes.lua"))("CowfeeRaidTools", CRT)
CRT:UseTheme("blizzard")
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(tooltipSrc, "Tooltip.lua"))("CowfeeRaidTools", CRT)
assert(load(controlsSrc, "Controls.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
local owner = object("Button", nil)

-- 1. The twelve spots, in the picker's order, and how each is placed (warcraft.wiki.gg, API GameTooltip:SetOwner:
-- ANCHOR_LEFT is SetPoint("BOTTOMRIGHT", owner, "TOPLEFT"), ANCHOR_RIGHT BOTTOMLEFT on TOPRIGHT, ANCHOR_TOP BOTTOM on TOP,
-- ANCHOR_BOTTOM TOP on BOTTOM, ANCHOR_BOTTOMLEFT TOPRIGHT on BOTTOMLEFT, ANCHOR_BOTTOMRIGHT TOPLEFT on BOTTOMRIGHT)
local WANT = {
  { "topleft", "Top left", "ANCHOR_LEFT" }, { "top", "Top", "ANCHOR_TOP" }, { "topright", "Top right", "ANCHOR_RIGHT" },
  { "leftupper", "Left, upper", nil, "BOTTOMRIGHT", "LEFT" }, { "left", "Left", nil, "RIGHT", "LEFT" }, { "leftlower", "Left, lower", nil, "TOPRIGHT", "LEFT" },
  { "rightupper", "Right, upper", nil, "BOTTOMLEFT", "RIGHT" }, { "right", "Right", nil, "LEFT", "RIGHT" }, { "rightlower", "Right, lower", nil, "TOPLEFT", "RIGHT" },
  { "bottomleft", "Bottom left", "ANCHOR_BOTTOMLEFT" }, { "bottom", "Bottom", "ANCHOR_BOTTOM" }, { "bottomright", "Bottom right", "ANCHOR_BOTTOMRIGHT" },
}
check(type(UI.TOOLTIP_SPOTS) == "table" and #UI.TOOLTIP_SPOTS == 12, "twelve spots")
if type(UI.TOOLTIP_SPOTS) ~= "table" then print(passes .. " passed, " .. fails .. " failed") error("no UI.TOOLTIP_SPOTS") end
for i, w in ipairs(WANT) do
  local s = UI.TOOLTIP_SPOTS[i] or {}
  eq(s.key, w[1], "spot " .. i .. " key")
  eq(s.label, w[2], "spot " .. w[1] .. " label")
  CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "spot", w[1]
  local t = newTip()
  local got = UI.TooltipOwner(t, owner, "ANCHOR_TOP", nil, nil)
  eq(got, "spot", w[1] .. ": placed on a spot")
  if w[3] then
    check(t.owner == owner and t.anchor == w[3] and t.point == nil, w[1] .. ": SetOwner(owner, " .. w[3] .. ") (got " .. tostring(t.anchor) .. ")")
  else
    check(t.owner == owner and t.anchor == "ANCHOR_NONE" and t.cleared, w[1] .. ": ANCHOR_NONE, then its points cleared")
    local p = t.point or {}
    check(p[1] == w[4] and p[2] == owner and p[3] == w[5] and p[4] == 0 and p[5] == 0, w[1] .. ": SetPoint(" .. w[4] .. ", owner, " .. w[5] .. ") (got " .. tostring(p[1]) .. " " .. tostring(p[3]) .. ")")
  end
  check(t.clamped == true, w[1] .. ": kept on the screen")
end
-- the game's own GameTooltip is already kept on the screen by its template, so it is left as it is
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "spot", "leftupper"
GameTooltip = newTip()
UI.TooltipOwner(GameTooltip, owner, "ANCHOR_TOP")
check(GameTooltip.clamped == nil and GameTooltip.anchor == "ANCHOR_NONE", "GameTooltip: placed, its clamping left to its template")
-- the default: top right, ANCHOR_RIGHT, where CRT's tooltips opened before the picker
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = nil, nil
eq(UI.TOOLTIP_SPOT_DEFAULT, "topright", "the default spot")
local t = newTip()
eq(UI.TooltipOwner(t, owner, "ANCHOR_TOP"), "spot", "nothing saved: on a spot")
eq(t.anchor, "ANCHOR_RIGHT", "nothing saved: top right, as before (the caller's anchor is not used)")
CRT.db.ui.tooltipSpot = "nowhere"
t = newTip() UI.TooltipOwner(t, owner, "ANCHOR_TOP")
eq(t.anchor, "ANCHOR_RIGHT", "an unknown saved spot: top right")
eq(UI.TooltipChosenSpot(nil), "topright", "an unknown saved spot reads as top right")
print("ok tooltip spots: twelve spots, each placed as the wiki says")

-- 2. General Settings: next to what you hover, the game's spot, follow the cursor
local keys = {} for _, c in ipairs(UI.TOOLTIP_POSITIONS) do keys[#keys + 1] = c.key .. "=" .. c.label end
eq(table.concat(keys, ","), "spot=Next to what you hover,game=Game's tooltip spot,cursor=Follow the cursor", "General Settings' three choices")
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = nil, nil
eq(UI.TooltipChoice(nil), "spot", "nothing saved: next to what you hover")
CRT.db.ui.tooltipMode = "nonsense"
eq(UI.TooltipPosition(), "spot", "an unknown saved mode: next to what you hover")
gameSpot()
CRT.db.ui.tooltipMode = "game"
defaults = {}
t = newTip()
eq(UI.TooltipOwner(t, owner, "ANCHOR_TOP"), "game", "the game's spot")
check(#defaults == 1 and defaults[1][1] == t and defaults[1][2] == owner, "the game's spot: GameTooltip_SetDefaultAnchor(tooltip, owner)")
GameTooltip_SetDefaultAnchor = nil
CRT.db.ui.tooltipSpot = "bottom"
t = newTip()
eq(UI.TooltipOwner(t, owner, "ANCHOR_TOP"), "spot", "no GameTooltip_SetDefaultAnchor: on the spot")
eq(t.anchor, "ANCHOR_BOTTOM", "no GameTooltip_SetDefaultAnchor: the saved spot")
GameTooltip_SetDefaultAnchor = function() error("broken") end
t = newTip()
eq(UI.TooltipOwner(t, owner, "ANCHOR_TOP"), "spot", "a failing GameTooltip_SetDefaultAnchor: on the spot")
CRT.db.ui.tooltipMode = "cursor"
t = newTip()
eq(UI.TooltipOwner(t, owner, "ANCHOR_TOP"), "cursor", "follow the cursor")
eq(t.anchor, "ANCHOR_CURSOR", "follow the cursor: ANCHOR_CURSOR")
-- the setters: a picked spot turns spots on
UI.SetTooltipChoice(nil, "game")
eq(CRT.db.ui.tooltipMode, "game", "SetTooltipChoice saves the mode")
UI.SetTooltipChoice(nil, "general")
eq(CRT.db.ui.tooltipMode, "game", "General Settings has no Use the general setting")
UI.SetTooltipSpot(nil, "leftlower")
check(CRT.db.ui.tooltipSpot == "leftlower" and CRT.db.ui.tooltipMode == "spot", "SetTooltipSpot saves the spot and turns spots on")
UI.SetTooltipSpot(nil, "nowhere")
eq(CRT.db.ui.tooltipSpot, "leftlower", "an unknown spot is not saved")
print("ok tooltip spots: General Settings' three choices")

-- 3. The flags: a kept anchor and its offsets; the game's spot, or the anchor given without it
GameTooltip_SetDefaultAnchor = nil
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "spot", "bottom"
t = newTip()
eq(UI.TooltipOwner(t, owner, "ANCHOR_TOP", 0, 6, UI.TOOLTIP_KEEP), "owner", "UI.TOOLTIP_KEEP: the anchor given")
check(t.anchor == "ANCHOR_TOP" and t.x == 0 and t.y == 6, "UI.TOOLTIP_KEEP: the anchor and offsets reach SetOwner")
gameSpot() defaults = {}
t = newTip()
eq(UI.TooltipOwner(t, owner, "ANCHOR_LEFT", nil, nil, UI.TOOLTIP_GAME), "game", "UI.TOOLTIP_GAME: the game's spot on a spot setting")
GameTooltip_SetDefaultAnchor = nil
t = newTip()
eq(UI.TooltipOwner(t, owner, "ANCHOR_LEFT", nil, nil, UI.TOOLTIP_GAME), "owner", "UI.TOOLTIP_GAME without the game's function: the anchor given")
eq(t.anchor, "ANCHOR_LEFT", "UI.TOOLTIP_GAME fallback anchor")
print("ok tooltip spots: the flags")

-- 4. The areas: their own choice and spot; Use the general setting follows General Settings, spot and all
keys = {} for _, c in ipairs(UI.TOOLTIP_AREA_POSITIONS) do keys[#keys + 1] = c.key .. "=" .. c.label end
eq(table.concat(keys, ","), "general=Use the general setting,spot=Next to what you hover,game=Game's tooltip spot,cursor=Follow the cursor", "an area's four choices")
check(UI.TOOLTIP_AREAS.loothistory.table == "loot" and UI.TOOLTIP_AREAS.lootmaster.table == "lootmaster", "the areas' tables")
gameSpot()
for area, tbl in pairs({ loothistory = "loot", lootmaster = "lootmaster" }) do
  for _, general in ipairs({ "spot", "game", "cursor" }) do
    CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = general, "left"
    for _, choice in ipairs({ "unset", "general", "spot", "game", "cursor", "owner", "nonsense" }) do
      CRT.db[tbl] = { tooltipMode = choice ~= "unset" and choice or nil, tooltipSpot = "bottomright" }
      local own = choice == "spot" or choice == "game" or choice == "cursor"
      local want = own and choice or general
      local what = area .. " on " .. choice .. ", general " .. general
      eq(UI.TooltipChoice(area), own and choice or "general", what .. ": its choice")
      eq(UI.TooltipPosition(area), want, what .. ": how it opens")
      defaults = {}
      t = newTip()
      local got = UI.TooltipOwner(t, owner, "ANCHOR_TOP", nil, nil, area)
      if want == "game" then
        check(got == "game" and #defaults == 1, what .. ": the game's spot")
      elseif want == "cursor" then
        check(got == "cursor" and t.anchor == "ANCHOR_CURSOR", what .. ": follows the cursor")
      elseif choice == "spot" then
        check(got == "spot" and t.anchor == "ANCHOR_BOTTOMRIGHT", what .. ": its own spot, bottom right (got " .. tostring(t.anchor) .. ")")
      else
        check(got == "spot" and t.anchor == "ANCHOR_NONE" and t.point and t.point[1] == "RIGHT", what .. ": General Settings' spot, left")
      end
    end
  end
  CRT.db[tbl] = nil
  CRT.db.ui.tooltipMode = "game"
  eq(UI.TooltipPosition(area), "game", area .. " with no saved table: the general setting")
  eq(UI.TooltipChosenSpot(area), "topright", area .. " with no saved table: the default spot")
  UI.SetTooltipSpot(area, "top") -- no table: nothing to save in, and no error
end
-- an area's choice stays in its area
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "spot", "top"
CRT.db.loot = { tooltipMode = "spot", tooltipSpot = "left" }
CRT.db.lootmaster = { tooltipMode = "general", tooltipSpot = "bottom" }
check(UI.TooltipSpot() == "top" and UI.TooltipSpot("loothistory") == "left" and UI.TooltipSpot("lootmaster") == "top", "each area keeps its own spot; one on the general setting takes General Settings'")
eq(UI.TooltipSpot("nosucharea"), "top", "an unknown area: General Settings' spot")
UI.SetTooltipChoice("lootmaster", "general")
eq(CRT.db.lootmaster.tooltipMode, "general", "an area can go back to Use the general setting")
UI.SetTooltipSpot("lootmaster", "rightupper")
check(CRT.db.lootmaster.tooltipSpot == "rightupper" and CRT.db.lootmaster.tooltipMode == "spot" and CRT.db.ui.tooltipSpot == "top", "a spot picked for an area is the area's own and turns its spots on")
GameTooltip_SetDefaultAnchor = nil
print("ok tooltip spots: the areas, their own spot and the general fallback")

-- 5. The picker: a box with twelve spots, the chosen one in the accent
check(type(UI.SpotPicker) == "function", "UI.SpotPicker exists")
if type(UI.SpotPicker) ~= "function" then print(passes .. " passed, " .. fails .. " failed") error("no UI.SpotPicker") end
local page = object("Frame", nil)
local chosen, sets, on = "topright", {}, true
local p = UI.SpotPicker(page, {
  label = "What you hover",
  get = function() return chosen end,
  set = function(k) sets[#sets + 1] = k chosen = k end,
  enabledIf = function() return on end,
})
local n, order = 0, {}
for _, s in ipairs(UI.TOOLTIP_SPOTS) do if p.spots[s.key] then n = n + 1 end end
eq(n, 12, "the picker builds twelve spots")
eq(p.w, UI.SPOT_PICKER_W, "the picker's width") eq(p.h, UI.SPOT_PICKER_H, "the picker's height")
check(UI.SPOT_PICKER_W <= 130 and UI.SPOT_PICKER_H <= 64, "a small control: " .. UI.SPOT_PICKER_W .. "x" .. UI.SPOT_PICKER_H)
eq(p.text.text, "What you hover", "the box says what it stands for")
-- every spot inside the picker, the box inside the spots' ring, no two spots on the same place
local seen = {}
for key, b in pairs(p.spots) do
  local pt = b.pts[1]
  local x, y = pt[2], pt[3]
  check(x >= 0 and x + b.w <= p.w and y <= 0 and -y + b.h <= p.h, key .. ": inside the picker")
  local at = x .. "," .. y
  check(not seen[at], key .. ": a place of its own") seen[at] = true
  check(b.highlight and b.highlight.layer == "HIGHLIGHT", key .. ": lights up under the mouse")
end
local function at(key) local pt = p.spots[key].pts[1] return pt[2], pt[3] end
local x1, y1 = at("topleft") local x2 = at("top") local x3 = at("topright")
check(x1 < x2 and x2 < x3 and y1 == 0, "the top row: left, middle, right")
local _, yu = at("leftupper") local _, ym = at("left") local _, yl = at("leftlower")
check(yu > ym and ym > yl, "a side: upper, middle, lower")
local _, yb = at("bottom")
check(yl > yb, "the side spots sit between the top and bottom rows")
-- Classic: the chosen spot in the game's gold, the others in the dark fill
local P = CRT.PALETTE
check(near(p.spots.topright.fill.rgb, P.heading), "Classic: the chosen spot is the game's gold")
check(near(p.spots.left.fill.rgb, P.surface), "Classic: another spot is dark")
-- a click saves and highlights at once
p.spots.leftlower.scripts.OnClick(p.spots.leftlower)
eq(sets[#sets], "leftlower", "a click sets the spot")
check(near(p.spots.leftlower.fill.rgb, P.heading) and near(p.spots.topright.fill.rgb, P.surface), "a click highlights the new spot and clears the old one")
-- Modern: the theme's accent
CRT.db.ui.modern, CRT.db.ui.theme = true, "nitro"
CRT:UseTheme("nitro")
p.crtSkin(true)
check(near(p.spots.leftlower.fill.rgb, CRT.PALETTE.accent), "Modern: the chosen spot is the theme's accent")
check(near(p.spots.top.fill.rgb, CRT.PALETTE.surface) and near(p.spots.top.edge.rgb, CRT.PALETTE.border), "Modern: the others are the theme's surface with its edge")
CRT.db.ui.modern, CRT.db.ui.theme = false, "blizzard"
CRT:UseTheme("blizzard")
p.crtSkin(false)
local skinned = false for _, c in ipairs(UI.skinned) do if c == p then skinned = true end end
check(skinned, "the picker follows the look and theme switches (UI.skinned)")
-- a tooltip names each spot, placed by UI.TooltipOwner
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "spot", "bottom"
GameTooltip = newTip()
p.spots.rightupper.scripts.OnEnter(p.spots.rightupper)
check(GameTooltip.title == "Right, upper" and GameTooltip.shown and GameTooltip.owner == p.spots.rightupper, "hovering a spot names it")
eq(GameTooltip.anchor, "ANCHOR_BOTTOM", "the spot's tooltip opens on the chosen spot, through UI.TooltipOwner")
p.spots.rightupper.scripts.OnLeave(p.spots.rightupper)
check(not GameTooltip.shown, "leaving hides it")
-- greyed: faded with a grey label, still clickable
on = false
p.refresh()
check(p.alpha < 1 and p.text.textRGB[1] == 0.5, "enabledIf false: the picker is greyed")
p.spots.bottom.scripts.OnClick(p.spots.bottom)
eq(sets[#sets], "bottom", "a greyed picker still takes a click")
on = true
p.refresh()
eq(p.alpha, 1, "enabledIf true: not greyed")
-- a subset: the others hidden
local q = UI.SpotPicker(page, { label = "Loot Master window", spots = { "topleft", "top", "left", "right" }, get = function() return nil end, set = function() end })
local shown = {} for _, s in ipairs(UI.TOOLTIP_SPOTS) do if q.spots[s.key].shown then shown[#shown + 1] = s.key end end
eq(table.concat(shown, ","), "topleft,top,left,right", "spots: only the ones asked for show")
check(near(q.spots.top.fill.rgb, P.surface), "no chosen spot: none highlighted")
print("ok tooltip spots: the picker")

-- 6. UI.TooltipPositionSetting: the dropdown and its picker
local drops = {}
UI.Dropdown = function(parent, text, opts) local r = object("Frame", parent) r.label, r.opts = text, opts r.refresh = function() r.refreshed = (r.refreshed or 0) + 1 end drops[#drops + 1] = r return r end
check(type(UI.TooltipPositionSetting) == "function", "UI.TooltipPositionSetting exists")
CRT.db.ui.tooltipMode, CRT.db.ui.tooltipSpot = "game", "top"
local g = UI.TooltipPositionSetting(page, nil, { labelWidth = 120, width = 160 })
eq(g.row.label, "Tooltip position", "general: the dropdown's label")
eq(g.row.opts.options, UI.TOOLTIP_POSITIONS, "general: General Settings' choices")
eq(g.picker.text.text, "What you hover", "general: the picker's box")
local pp = g.picker.pts[1] or {}
check(pp[1] == "TOPLEFT" and pp[2] == g.row and pp[3] == "BOTTOMLEFT" and pp[4] == 125 and pp[5] <= 0, "general: the picker sits under the dropdown, past its label")
g.refresh()
check(g.picker.alpha < 1, "general: greyed on the game's spot")
g.picker.spots.left.scripts.OnClick(g.picker.spots.left)
check(CRT.db.ui.tooltipMode == "spot" and CRT.db.ui.tooltipSpot == "left", "general: clicking a spot turns spots on and saves it")
check(g.row.refreshed and g.picker.alpha == 1, "general: the dropdown shows it, the picker is no longer greyed")
g.row.opts.set("cursor")
check(CRT.db.ui.tooltipMode == "cursor" and g.picker.alpha < 1, "general: Follow the cursor greys the picker")
eq(g.row.opts.get(), "cursor", "general: the dropdown reads it back")
CRT.db.lootmaster = { tooltipMode = "general", tooltipSpot = "topright" }
local a = UI.TooltipPositionSetting(page, "lootmaster", { labelWidth = 110, width = 160, beside = true })
eq(a.row.opts.options, UI.TOOLTIP_AREA_POSITIONS, "area: the area's choices")
local ap = a.picker.pts[1] or {}
check(ap[1] == "LEFT" and ap[2] == a.row and ap[3] == "RIGHT", "beside: the picker sits right of the dropdown")
a.refresh()
check(a.picker.alpha < 1, "area: greyed on Use the general setting")
eq(a.row.opts.get(), "general", "area: the dropdown reads Use the general setting")
a.picker.spots.bottomleft.scripts.OnClick(a.picker.spots.bottomleft)
check(CRT.db.lootmaster.tooltipMode == "spot" and CRT.db.lootmaster.tooltipSpot == "bottomleft" and CRT.db.ui.tooltipSpot == "left", "area: a click gives the area its own spot, General Settings' stays")
a.row.opts.set("general")
check(CRT.db.lootmaster.tooltipMode == "general" and a.picker.alpha < 1, "area: back to Use the general setting greys it again")
GameTooltip = newTip()
CRT.db.lootmaster.tooltipMode, CRT.db.ui.tooltipMode = "spot", "spot"
a.picker.spots.top.scripts.OnEnter(a.picker.spots.top)
eq(GameTooltip.anchor, "ANCHOR_BOTTOMLEFT", "area: its picker's own tooltips follow the area")
print("ok tooltip spots: the Tooltip position dropdown with its picker")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " tooltip spot checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/UI/Panel.lua', 'CRT_Core/Themes.lua', 'CRT_Core/UI/Tooltip.lua', 'CRT_Core/UI/Controls.lua']) lua.lua_pushstring(L, to_luastring(read(f)));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
