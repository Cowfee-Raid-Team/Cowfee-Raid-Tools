// CRT_Modules/LootMaster/Popup.lua's item panels: the roll-frame look in each theme, the answer buttons'
// rows at the popup's width, the 12-letter labels, and the clicks. Stand-in frames remember what was set.
// Usage: node run_lootmaster_popup.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local panelSrc, windowSrc, popupSrc, dataSrc, gearSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local function near(c, want) return c and want and math.abs(c[1] - want[1]) < 0.001 and math.abs(c[2] - want[2]) < 0.001 and math.abs(c[3] - want[3]) < 0.001 end

-- CRTFontSmall is the game's small font at 1.2 (12 pt Friz Quadrata): about 7.5 px a letter in mixed case
local LETTER = 7.5
local frames = {}
local function mock(kind, parent)
  local o = { shown = true, kind = kind, parent = parent }
  local methods = {
    CreateTexture = function(self) return mock("Texture", self) end,
    CreateFontString = function(self) return mock("FontString", self) end,
    SetText = function(self, t) self.text = t end,
    GetText = function(self) return rawget(self, "text") end,
    GetStringWidth = function(self) local t = rawget(self, "text") return #(type(t) == "string" and t or "") * LETTER end,
    SetTextColor = function(self, r, g, b) self.color = { r, g, b } end,
    SetVertexColor = function(self, r, g, b, a) self.vertex = { r, g, b, a } end,
    SetColorTexture = function(self, r, g, b, a) self.fill = { r, g, b, a } end,
    SetBackdropColor = function(self, r, g, b, a) self.bg = { r, g, b, a } end,
    SetBackdropBorderColor = function(self, r, g, b, a) self.edge = { r, g, b, a } end,
    SetTexture = function(self, f) self.file = f self.atlas = nil end,
    SetAtlas = function(self, a) self.atlas = a self.file = nil end,
    SetTexCoord = function(self, ...) self.coords = { ... } end,
    SetAlpha = function(self, a) self.alpha = a end,
    Show = function(self) self.shown = true end,
    Hide = function(self) self.shown = false end,
    SetShown = function(self, v) self.shown = v and true or false end,
    IsShown = function(self) return self.shown end,
    GetFrameLevel = function() return 1 end,
    SetSize = function(self, w, h) self.w, self.h = w, h end,
    SetWidth = function(self, w) self.w = w end,
    SetHeight = function(self, h) self.h = h end,
    GetWidth = function(self) return rawget(self, "w") or 0 end,
    GetHeight = function(self) return rawget(self, "h") or 0 end,
    SetEnabled = function(self, v) self.enabled = v end,
    SetScript = function(self, k, fn) local t = rawget(self, "scripts") or {} rawset(self, "scripts", t) t[k] = fn end,
    GetScript = function(self, k) local t = rawget(self, "scripts") return t and t[k] end,
    HookScript = function(self, k, fn) local t = rawget(self, "scripts") or {} rawset(self, "scripts", t) t[k] = t[k] or fn end,
    SetParent = function(self, p) self.parent = p end,
    SetFontObject = function(self, f) self.font = f end,
    ClearAllPoints = function(self) self.points = {} end,
    SetPoint = function(self, ...) local t = rawget(self, "points") or {} rawset(self, "points", t) t[#t + 1] = { ... } end,
    SetAllPoints = function(self, r) self.all = r or true end,
    GetHighlightTexture = function(self) local h = rawget(self, "hl") or mock("Texture", self) rawset(self, "hl", h) return h end,
  }
  return setmetatable(o, { __index = function(_, k) return methods[k] or function() end end })
end
CreateFrame = function(kind, name, parent, template)
  local f = mock(kind, parent)
  f.template = template
  if template == "UIPanelButtonTemplate" then
    f.Left, f.Middle, f.Right, f.label = mock(), mock(), mock(), mock()
    f.crtSkin = false
    f.SetText = function(self, t) self.label.text = t end
    f.GetFontString = function(self) return self.label end
    f.GetObjectType = function() return "Button" end
  end
  if template == "BasicFrameTemplateWithInset" then f.CloseButton = mock() end
  frames[#frames + 1] = f
  return f
end
GameFontNormal = { GetTextColor = function() return 1, 0.82, 0 end }
CRTFontLarge = { GetTextColor = function() return 1, 0.82, 0 end }
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end
GetTime = function() return 100 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
UISpecialFrames, tinsert = {}, table.insert
-- the game's quality colours and its loot border atlases (Blizzard_Colors: ITEM_QUALITY_COLORS, LOOT_BORDER_BY_QUALITY)
ITEM_QUALITY_COLORS = { [3] = { r = 0, g = 0.44, b = 0.87 }, [4] = { r = 0.64, g = 0.21, b = 0.93 } }
LOOT_BORDER_BY_QUALITY = { [2] = "loottoast-itemborder-green", [3] = "loottoast-itemborder-blue", [4] = "loottoast-itemborder-purple" }
ColorManager = { GetAtlasDataForLootBorderItemQuality = function(q) return LOOT_BORDER_BY_QUALITY[q] end }
local quality = { ["item:1"] = 4, ["item:2"] = 3 }
C_Item = {
  GetItemIconByID = function() return 134400 end,
  GetItemInfo = function(s) if quality[s] then return "Fang", "|cffa335ee[Fang]|r", quality[s] end end,
  GetItemInfoInstant = function() return 1, "", "Leather", "INVTYPE_WAIST", 0, 4, 2 end,
}
INVTYPE_WAIST, MISCELLANEOUS = "Waist", "Miscellaneous"
Ambiguate = function(n) return n end
UIParent = mock()
local CRT = { LootMaster = {}, db = { ui = { modern = false, layers = {} }, lootmaster = { popup = {} } } }
CRT.Print = function() end
-- each theme's palette as CRT:UseTheme fills CRT.MOCHA (only the keys the popup and the strip read)
local PALETTES = {
  cowfee = { espresso = { 0.11, 0.078, 0.063 }, edge = { 0.30, 0.235, 0.188 }, roast = { 0.165, 0.122, 0.098 } },
  midnight = { espresso = { 0.04, 0.04, 0.04 }, edge = { 0.25, 0.25, 0.25 }, roast = { 0.09, 0.09, 0.09 } },
}
CRT.MOCHA = { caramel = { 0.78, 0.56, 0.36 }, cream = { 0.95, 0.90, 0.84 }, latte = { 0.87, 0.73, 0.56 },
  stripTop = { 0.35, 0.25, 0.17 }, stripBottom = { 0.23, 0.17, 0.12 }, note = { 0.8, 0.71, 0.6 } }
local function palette(name) for k, v in pairs(PALETTES[name]) do CRT.MOCHA[k] = v end end
palette("cowfee")
assert(load(panelSrc, "Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(windowSrc, "Window.lua"))("CowfeeRaidTools", CRT)
assert(load(gearSrc, "Gear.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local UI, LM = CRT.UI, CRT.LootMaster
LM.listeners = LM.listeners or {}
assert(load(popupSrc, "Popup.lua"))("CowfeeRaidTools", CRT)
LM.MyGear = function() return {} end
local answered
function LM:Answer(index, key, note) answered = { index, key, note } end

-- labels: 12 letters at most, cut when longer
eq(LM.LABEL_MAX, 12, "labels hold 12 letters")
eq(LM.MAX_RESPONSES, 8, "8 answers at most")
local cut = LM.CleanResponses({ { key = "a", label = "Seventeen letters" }, { key = "pass", label = "Pass" } })
eq(cut[1].label, "Seventeen le", "a longer label is cut to 12")
-- letters, as the label box counts them: 14 Cyrillic letters (2 bytes each) keep 12 whole ones
eq(LM.CutLetters(string.rep("\\208\\159", 14), 12), string.rep("\\208\\159", 12), "a label in another script keeps 12 whole letters")
eq(LM.CutLetters("short", 12), "short", "a short label is kept")

-- the worst case: 8 answers of 12 letters, each with an icon
local eight = {}
for i = 1, 7 do eight[i] = { key = "r" .. i, label = string.rep("m", 12), color = { 0.5, 0.5, 0.5 }, icon = "need" } end
eight[8] = { key = "pass", label = "Passpasspass", color = { 0.5, 0.5, 0.5 }, icon = "pass" }
eight = LM.CleanResponses(eight)
eq(#eight, 8, "the worst case has 8 answers")
local byKey = {}
for _, r in ipairs(eight) do byKey[r.key] = r end
LM.incoming = { items = { { itemString = "item:1", ilvl = 639, shownAt = 100 }, { itemString = "item:2", ilvl = 626, shownAt = 100 } },
  mine = {}, responses = eight, byKey = byKey, seconds = 60, test = true }
LM:ShowPopup()

local panels = {}
for _, f in ipairs(frames) do
  if rawget(f, "note") and rawget(f, "buttons") then panels[#panels + 1] = f end
end
eq(#panels, 2, "one panel per item")
local p = panels[1]

-- the buttons: at most 2 rows, inside the panel, never overlapping, below the item and above Notes
local function last(r) local t = rawget(r, "points") return t and t[#t] or {} end
local rows, inside, overlap = {}, true, false
local placed = {}
for _, b in ipairs(p.buttons) do
  local pt = last(b)
  local x, y = pt[2], pt[3]
  rows[y] = true
  if x < 0 or x + b.w > p.w - 8 then inside = false end
  for _, q in ipairs(placed) do
    if q.y == y and not (q.x + q.w <= x or x + b.w <= q.x) then overlap = true end
  end
  placed[#placed + 1] = { x = x, y = y, w = b.w }
end
local nRows = 0
for _ in pairs(rows) do nRows = nRows + 1 end
eq(#p.buttons, 8, "8 buttons")
check(p.buttons[1].w >= 12 * LETTER + 14 + 2 * 6, "a button holds its 12 letters and icon (" .. p.buttons[1].w .. ")")
check(nRows <= 2, "8 buttons of 12 letters fit in 2 rows (got " .. nRows .. ")")
check(inside, "the buttons stay inside the panel")
check(not overlap, "no button overlaps another")

-- Default: Blizzard: the roll frame's art
local function allShown(list, v) for _, t in ipairs(list) do if (t.shown and true or false) ~= v then return false end end return #list > 0 end
check(p.rollBorder and #p.rollBorder == 8, "classic: the roll frame's border in 8 pieces")
check(allShown(p.rollBorder, true), "classic: the border shows")
local fileOK = true
for _, t in ipairs(p.rollBorder) do if t.file ~= "Interface\\\\LootFrame\\\\LootToast" or not t.coords then fileOK = false end end
check(fileOK, "classic: the border is LootToast, cut by texture coordinates")
check(near(p.rollBorder[1].vertex, { 0.64, 0.21, 0.93 }), "classic: the border takes the item's quality colour")
eq(p.slot.atlas, "loottoast-itemborder-purple", "classic: the slot is the game's loot border for an epic")
check(p.slot.shown, "classic: the slot border shows")
eq(panels[2].slot.atlas, "loottoast-itemborder-blue", "classic: a rare item's slot is blue")
check(p.plate and #p.plate == 3 and allShown(p.plate, true), "classic: the name plate's three pieces show")
check(p.plate[1].file == "Interface\\\\LootFrame\\\\LootToast" and p.plate[1].coords, "classic: the plate is LootToast's item name border")
check(not p.plateFlat.shown and not p.slotFlat.shown, "classic: no flat plate or slot")
eq(p.edge[4], 0, "classic: the flat edge gives way to the border art")
check(p.timer.shown ~= false and p.timer.fill and p.timer.fill[4] > 0, "classic: the background timer is still there")

-- the name in the plate, the detail line under it, the X at the top right
check(last(p.name)[2] == p.plate[1] or last(p.name)[2] == p.plateFlat or (p.name.points[1] and p.name.points[1][2] == p.plate[1]), "the name sits in the plate")
eq(p.name.text, "|cffa335ee[Fang]|r", "the name is the item's link, in its quality colour")
check(p.detail.text and p.detail.text:find("639", 1, true), "the detail line keeps the item level")
check(p.time.text and p.time.text:find("Time left", 1, true), "the time left shows")
eq(p.close.points[1][1], "TOPRIGHT", "the X at the top right")

-- Beanworks: Cowfee and Blackout: Midnight: the theme's colours, no game art
local function modern(name)
  palette(name)
  CRT.db.ui.modern = true
  UI:RepaintTheme()
end
for _, name in ipairs({ "cowfee", "midnight" }) do
  modern(name)
  local pal = PALETTES[name]
  check(allShown(p.rollBorder, false), name .. ": no game border")
  check(not p.slot.shown and allShown(p.plate, false), name .. ": no game slot or plate")
  check(p.plateFlat.shown and near(p.plateFlat.fill, pal.roast), name .. ": a flat plate in the theme's field colour")
  check(near(p.bg, pal.espresso) and near(p.edge, pal.edge) and p.edge[4] == 1, name .. ": the panel in the theme's colours")
  check(p.slotFlat.shown and near(p.slotFlat.edge, { 0.64, 0.21, 0.93 }), name .. ": the slot edge in the quality colour")
end
-- and back to Default: Blizzard
CRT.db.ui.modern = false
UI:RepaintTheme()
check(allShown(p.rollBorder, true) and p.slot.shown and not p.plateFlat.shown, "classic again: the game's art is back")

-- unchanged behaviour: a click answers, a right-click closes
p.note.text = " my note "
p.buttons[2].scripts.OnClick()
check(answered and answered[1] == p.index and answered[2] == eight[2].key and answered[3] == "my note", "a click sends the answer with the note")
p.scripts.OnMouseUp(p, "RightButton")
check(LM.incoming.mine[p.index] and LM.incoming.mine[p.index].closed, "a right-click closes the item")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Window.lua', 'CRT_Modules/LootMaster/Popup.lua', 'CRT_Modules/LootMaster/Data.lua', 'CRT_Core/Gear.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
