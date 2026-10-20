// CRT_Core/UI/Panel.lua's UI.Help: in Classic the game's gold "i" (MainHelpPlateButton's three textures,
// scaled), in Modern a caramel ring that fills caramel under the mouse with an espresso "i"; the look
// switch swaps them live, a theme switch repaints the Modern colours, the tooltip is unchanged and the
// hit box is the same size in both looks.
// Usage: node run_help.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, mochaSrc = ...
local unpack = unpack or table.unpack -- the harness runs Lua 5.3
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function near(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 0.003 and math.abs(c[2] - want[2]) < 0.003 and math.abs(c[3] - want[3]) < 0.003 end

-- a texture or font string that remembers what it was given
local function region(owner, layer)
  local t = { shown = true, alpha = 1, layer = layer }
  local m = {
    SetColorTexture = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetVertexColor = function(self, r, g, b, a) self.rgb = { r, g, b } self.a = a or 1 end,
    SetTexture = function(self, file) self.file = file end,
    SetBlendMode = function(self, mode) self.blend = mode end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetPoint = function(self, p, rel, rp, x, y) self.point = { p, rel, rp, x, y } end,
    SetAlpha = function(self, a) self.alpha = a end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end, IsShown = function(self) return self.shown end,
    SetText = function(self, text) self.text = text end,
    SetFont = function(self, file, size, flags) self.font = { file, size, flags } end,
    SetTextColor = function(self, r, g, b) self.textRGB = { r, g, b } end,
  }
  if owner then owner.regions[#owner.regions + 1] = t end
  return setmetatable(t, { __index = function(_, k) return m[k] or function() end end })
end
local function frame(kind, parent)
  local f = { kind = kind, children = {}, regions = {}, scripts = {}, shown = true }
  local m = {
    GetObjectType = function(self) return self.kind end,
    GetChildren = function(self) return unpack(self.children) end,
    CreateTexture = function(self, _, layer) return region(self, layer) end,
    CreateFontString = function(self, _, layer) return region(self, layer) end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    GetSize = function(self) return self.w, self.h end,
    SetScript = function(self, k, fn) self.scripts[k] = fn end,
    GetScript = function(self, k) return self.scripts[k] end,
    Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
    IsShown = function(self) return self.shown end,
  }
  setmetatable(f, { __index = function(_, k) return m[k] or (type(k) == "string" and k:find("^%u") and function() end) or nil end })
  if parent and parent.children then parent.children[#parent.children + 1] = f end
  return f
end
CreateFrame = function(kind, name, parent) return frame(kind, parent) end
hooksecurefunc = function() end
local tip = { lines = {} }
GameTooltip = {
  SetOwner = function(self, owner, anchor) self.owner, self.anchor = owner, anchor self.lines = {} end,
  SetText = function(self, text) self.title = text end,
  AddLine = function(self, text, r, g, b, wrap) self.lines[#self.lines + 1] = text end,
  Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
}

local CRT = { db = { ui = { modern = false, theme = "blizzard", layers = {} } } }
assert(load(mochaSrc, "Themes.lua"))("CowfeeRaidTools", CRT)
CRT:UseTheme("cowfee")
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
local M = CRT.MOCHA
local function look(modern)
  CRT.db.ui.modern = modern
  for _, c in ipairs(UI.skinned) do c.crtSkin(modern) end
end

-- Classic: the Appearances tab's "i" (Blizzard_HelpPlate.xml, MainHelpPlateButton), scaled to the hit box
local page = frame("Frame", nil)
local before = #UI.skinned
local b = UI.Help(page, "Title", "First paragraph.\\n\\nSecond paragraph.")
local h = b.crtHelp
check(h ~= nil, "the parts are kept on b.crtHelp")
if not h then print(passes .. " passed, " .. fails .. " failed") error("no crtHelp") end
check(#UI.skinned == before + 1 and UI.skinned[#UI.skinned] == b, "the icon follows the look switch (UI.skinned)")
check(b.w == 20 and b.h == 20 and UI.HELP_SIZE == 20, "a 20 px hit box: " .. tostring(b.w) .. "x" .. tostring(b.h))
check(h.i.file == "Interface\\\\common\\\\help-i", "Classic: the \\"i\\" is Interface\\\\common\\\\help-i: " .. tostring(h.i.file))
check(h.ring.file == "Interface\\\\Minimap\\\\MiniMap-TrackingBorder", "Classic: the ring is MiniMap-TrackingBorder: " .. tostring(h.ring.file))
check(h.glow.file == "Interface\\\\Minimap\\\\UI-Minimap-ZoomButton-Highlight", "Classic: the glow is UI-Minimap-ZoomButton-Highlight: " .. tostring(h.glow.file))
check(h.glow.layer == "HIGHLIGHT" and h.glow.blend == "ADD", "the glow shows under the mouse, added on")
check(h.i.w == 23 and h.ring.w == 32 and h.glow.w == 23, "the template's sizes (46, 64, 46) at half")
check(h.ring.point[4] == 6 and h.ring.point[5] == -6.5, "the ring keeps the template's +12/-13 offset, scaled")
check(h.glow.point[4] == -0.5 and h.glow.point[5] == 0.5, "the glow keeps the template's -1/+1 offset, scaled")
check(h.i.shown and h.ring.shown and h.glow.alpha == 1, "Classic: the gold \\"i\\", its ring and glow show")
check(not h.circle.shown and not h.fill.shown and not h.letter.shown, "Classic: the Modern ring is hidden")
print("ok help: Classic is the game's gold \\"i\\"")

-- the tooltip is unchanged: the title, then one line per paragraph
b.scripts.OnEnter(b)
check(GameTooltip.owner == b and GameTooltip.anchor == "ANCHOR_RIGHT" and GameTooltip.title == "Title", "the tooltip has the title, beside the icon")
check(#GameTooltip.lines == 2 and GameTooltip.lines[2] == "Second paragraph.", "one tooltip line per paragraph")
b.scripts.OnLeave(b)
check(not GameTooltip.shown, "leaving hides the tooltip")
local n = 0
local live = UI.Help(page, "Live", function() n = n + 1 return "Count " .. n end)
live.scripts.OnEnter(live)
live.scripts.OnLeave(live)
live.scripts.OnEnter(live)
check(GameTooltip.lines[1] == "Count 2", "a function's text is read each time")
live.scripts.OnLeave(live)
print("ok help: the tooltip is unchanged")

-- Modern: a caramel ring round a caramel "i", the same hit box
look(true)
check(not h.i.shown and not h.ring.shown and h.glow.alpha == 0, "Modern: the gold \\"i\\", ring and glow are hidden")
check(h.circle.shown and h.letter.shown and not h.fill.shown, "Modern: the ring and its \\"i\\" show, unfilled")
check(type(h.circle.file) == "string" and h.circle.file:find("CRT_Media\\\\Media\\\\Ring") ~= nil, "the ring is a CRT ring texture: " .. tostring(h.circle.file))
check(type(h.fill.file) == "string" and h.fill.file:find("CRT_Media\\\\Media\\\\Disc$") ~= nil, "the fill is CRT_Media/Media/Disc.tga: " .. tostring(h.fill.file))
check(h.circle.w == 16 and h.fill.w == 16, "a 16 px ring")
check(near(h.circle.rgb, M.caramel) and near(h.letter.textRGB, M.caramel), "a caramel ring and \\"i\\"")
check(h.letter.text == "i" and h.letter.font ~= nil, "the \\"i\\" has its own font")
check(b.w == 20 and b.h == 20, "the hit box is unchanged by the look")
b.scripts.OnEnter(b)
check(h.fill.shown and near(h.fill.rgb, M.caramel), "hover: it fills caramel")
check(near(h.letter.textRGB, M.espresso), "hover: the \\"i\\" turns espresso")
b.scripts.OnLeave(b)
check(not h.fill.shown and near(h.letter.textRGB, M.caramel), "leave: the ring again")
print("ok help: Modern is a caramel ring that fills on hover")

-- a theme switch repaints the Modern colours
local cowfee = { M.caramel[1], M.caramel[2], M.caramel[3] }
CRT:UseTheme("nitro")
check(not near(CRT.MOCHA.caramel, cowfee), "the test themes have different caramels")
UI:RepaintTheme()
check(near(h.circle.rgb, CRT.MOCHA.caramel) and near(h.letter.textRGB, CRT.MOCHA.caramel), "another theme: its caramel")
b.scripts.OnEnter(b)
check(near(h.fill.rgb, CRT.MOCHA.caramel) and near(h.letter.textRGB, CRT.MOCHA.espresso), "another theme: its hover colours")
b.scripts.OnLeave(b)
CRT:UseTheme("cowfee")
UI:RepaintTheme()

-- back to Classic, live
look(false)
check(h.i.shown and h.ring.shown and h.glow.alpha == 1 and not h.circle.shown and not h.letter.shown, "Classic again: the gold \\"i\\"")
b.scripts.OnEnter(b)
check(not h.fill.shown, "Classic hover: no caramel fill")
b.scripts.OnLeave(b)
-- one made in Modern is Modern at once
look(true)
local m2 = UI.Help(page, "Made in Modern", "x")
check(m2.crtHelp.circle.shown and not m2.crtHelp.i.shown, "an icon made in Modern is Modern at once")
print("ok help: the look switch swaps them live")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " help checks failed") end
`;
const root = process.argv[2];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(read('CRT_Core/UI/Panel.lua')));
lua.lua_pushstring(L, to_luastring(read('CRT_Core/Themes.lua')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
