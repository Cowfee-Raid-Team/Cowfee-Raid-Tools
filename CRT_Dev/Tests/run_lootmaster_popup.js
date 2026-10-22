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
    SetHorizTile = function(self, v) self.horizTile = v end,
    SetVertTile = function(self, v) self.vertTile = v end,
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
    GetObjectType = function(self) return self.kind end,
    SetNormalAtlas = function(self, a) self.normalAtlas = a end,
    SetHighlightAtlas = function(self, a) self.highlightAtlas = a end,
    SetPushedAtlas = function(self, a) self.pushedAtlas = a end,
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
  if template == "BasicFrameTemplateWithInset" then
    -- the window template's own textures (Blizzard_UIPanelTemplates: BasicFrameTemplate and its inset)
    f.CloseButton = mock("Button", f)
    f.CloseButton.crtSkin = false
    f.crtArt = false -- not styled yet (every other unknown key is a no-op method)
    local regions = {}
    for _, key in ipairs({ "Bg", "TitleBg", "TopTileStreaks", "InsetBg", "InsetBorderTop", "InsetBorderBottom", "InsetBorderLeft", "InsetBorderRight" }) do
      local t = mock("Texture", f)
      t.key = key
      f[key] = t
      regions[#regions + 1] = t
    end
    f.GetRegions = function() return unpack(regions) end
  end
  frames[#frames + 1] = f
  return f
end
GameFontNormal = { GetTextColor = function() return 1, 0.82, 0 end }
CRTFontLarge = { GetTextColor = function() return 1, 0.82, 0 end }
CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end
GetTime = function() return 100 end
unpack = unpack or table.unpack
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
UISpecialFrames, tinsert = {}, table.insert
-- the game's quality colours and its loot border atlases (Blizzard_Colors: ITEM_QUALITY_COLORS, LOOT_BORDER_BY_QUALITY)
ITEM_QUALITY_COLORS = { [3] = { r = 0, g = 0.44, b = 0.87 }, [4] = { r = 0.64, g = 0.21, b = 0.93 } }
LOOT_BORDER_BY_QUALITY = { [2] = "loottoast-itemborder-green", [3] = "loottoast-itemborder-blue", [4] = "loottoast-itemborder-purple" }
ColorManager = { GetAtlasDataForLootBorderItemQuality = function(q) return LOOT_BORDER_BY_QUALITY[q] end,
  GetColorDataForItemQuality = function(q) return ITEM_QUALITY_COLORS[q] end }
local quality = { ["item:1"] = 4, ["item:2"] = 3, ["item:9"] = 99 }
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
-- each theme's palette as CRT:UseTheme fills CRT.PALETTE (only the keys the popup and the strip read)
local PALETTES = {
  cowfee = { background = { 0.11, 0.078, 0.063 }, border = { 0.30, 0.235, 0.188 }, surface = { 0.165, 0.122, 0.098 } },
  midnight = { background = { 0.04, 0.04, 0.04 }, border = { 0.25, 0.25, 0.25 }, surface = { 0.09, 0.09, 0.09 } },
}
CRT.PALETTE = { accent = { 0.78, 0.56, 0.36 }, text = { 0.95, 0.90, 0.84 }, label = { 0.87, 0.73, 0.56 },
  titleTop = { 0.35, 0.25, 0.17 }, titleBottom = { 0.23, 0.17, 0.12 }, muted = { 0.8, 0.71, 0.6 } }
local function palette(name) for k, v in pairs(PALETTES[name]) do CRT.PALETTE[k] = v end end
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
  if x < 12 or x + b.w > p.w - 12 then inside = false end
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
check(inside, "the buttons stay inside the panel, clear of the border ring")
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
check(p.stone and p.stone.shown, "classic: the stone shows")
eq(p.stone.file, "Interface\\\\FrameGeneral\\\\UI-Background-Marble", "classic: the stone is the grey marble")
check(p.stone.horizTile and p.stone.vertTile and rawget(p.stone, "coords") == nil, "classic: the marble tiles, unstretched")
eq(p.bg[4], 0, "classic: no dark flat fill over the stone")
local own = UI.Stone(mock("Frame"))
check(own.file == UI.STONE.file and own.horizTile and own.vertTile and own.points[1][1] == "TOPLEFT" and own.points[1][2] == 0 and own.points[2][1] == "BOTTOMRIGHT", "UI.Stone: the shared stone, covering its frame")
eq(p.edge[4], 0, "classic: the flat edge gives way to the border art")
check(p.timer.shown ~= false and p.timer.fill and p.timer.fill[4] > 0, "classic: the background timer is still there, lighter over the stone")
-- the game draws its border about 4.5 px outside the stone: the stone and the timer sit 4 in
local function at(r, i) local q = r.points[i] return q and (q[1] .. " " .. q[2] .. " " .. q[3]) end
eq(at(p.stone, 1), "TOPLEFT 4 -4", "classic: the stone 4 in at the top left")
eq(at(p.stone, 2), "BOTTOMRIGHT -4 4", "classic: and at the bottom right")
eq(at(p.timer, 1), "TOPLEFT 4 -4", "classic: the timer on the stone, not under the ring")
eq(at(p.timer, 2), "BOTTOMLEFT 4 4", "classic: the timer's bottom on the stone too")
check(p.close.points[1][2] <= -8, "the X clear of the border ring (" .. tostring(p.close.points[1][2]) .. ")")
eq(p.close.normalAtlas, "lootroll-toast-icon-pass-up", "classic: the roll frame's X")
check(p.close.highlightAtlas == "lootroll-toast-icon-pass-highlight" and p.close.pushedAtlas == "lootroll-toast-icon-pass-down", "classic: the X's hover and pressed art")
check(rawget(p.close, "template") == nil, "the X is the roll frame's, not the window close button")

-- Default: Blizzard: one window frame around everything, the window template kept by UI:StyleWindow
local chrome
for _, f in ipairs(frames) do
  if f.template == "BasicFrameTemplateWithInset" and f.parent and f.parent == panels[1].parent then chrome = f end
end
local anchor = panels[1].parent
check(chrome ~= nil, "classic: the popup has the window template's frame")
check(chrome and chrome.crtArt and #chrome.crtArt == 8, "classic: StyleWindow keeps the template's 8 textures as its art")
local artShown = chrome and #chrome.crtArt > 0
for _, t in ipairs(chrome and chrome.crtArt or {}) do if not t.shown then artShown = false end end
check(artShown and chrome.TitleBg.shown and chrome.InsetBg.shown, "classic: the border pieces show")
check(chrome and chrome.shown, "classic: the frame shows")
check(chrome and not chrome.CloseButton.shown, "classic: the frame's own X is hidden")
local strip
for _, f in ipairs(frames) do if rawget(f, "framed") ~= nil and f.parent == anchor then strip = f end end
check(strip and strip.framed and not strip.bar.shown, "classic: the strip lets the template draw the title tile")
eq(strip and strip.points[1][2], 1, "classic: the strip 1 in from the frame's edge")
-- the title bar, right to left: its X and All Loot Rolls, on the bar's centre line; the (i) after the title
local x = strip and rawget(strip, "close")
check(x and x.template == "UIPanelCloseButton" and x.parent == strip, "title bar: an X in every theme")
check(x and x.points[1][1] == "RIGHT" and x.points[1][3] == nil or (x and x.points[1][2] == -2), "title bar: the X at the right")
check(strip.answers.points[1][2] == x and strip.answers.points[1][1] == "RIGHT" and strip.answers.points[1][5] == 0, "title bar: All Loot Rolls left of the X, centred")
local hp = strip.help.points[#strip.help.points]
check(strip.help.crtHelpText == strip.title and hp[1] == "LEFT" and hp[2] == strip.title and hp[5] == 0, "title bar: the (i) just right of the title's text (UI.HelpRight), centred")
check(strip.help.crtHelpTarget == strip.title and strip.help.parent == strip, "title bar: the (i) is the strip's own (strip:SetHelp)")
-- the frame holds the title bar and both items, with no gap under the last and nothing outside it
local p2 = panels[2]
local function fits(what, items)
  local want = 26 + 4
  for i, q in ipairs(items) do want = want + q.h + (i < #items and 4 or 0) end
  want = want + 6
  eq(chrome.h, want, what .. ": the frame's height follows the items")
  eq(chrome.w, 520 + 4 + 6, what .. ": the frame is the items plus its inset")
  eq(anchor.h, chrome.h, what .. ": the popup is the frame")
  local y = -(26 + 4)
  for _, q in ipairs(items) do
    check(last(q)[2] == 4 and last(q)[3] == y, what .. ": an item inside the inset at " .. y .. " (got " .. tostring(last(q)[2]) .. ", " .. tostring(last(q)[3]) .. ")")
    y = y - q.h - 4
  end
end
fits("classic, two items", { p, p2 })

-- the name in the plate, the detail line under it, the X at the top right
check(last(p.name)[2] == p.plate[1] or last(p.name)[2] == p.plateFlat or (p.name.points[1] and p.name.points[1][2] == p.plate[1]), "the name sits in the plate")
eq(p.name.text, "|cffa335ee[Fang]|r", "the name is the item's link, in its quality colour")
check(p.detail.text and p.detail.text:find("639", 1, true), "the detail line keeps the item level")
check(p.time.text and p.time.text:find("Time left", 1, true), "the time left shows")
eq(p.close.points[1][1], "TOPRIGHT", "the X at the top right")

-- Beanworks: Cowfee and Blackout: Midnight: the theme's colours, no game art (UI:SetTheme repaints, then
-- the skinned controls follow through CRT:ApplyFonts)
local function theme(isModern)
  CRT.db.ui.modern = isModern
  UI:RepaintTheme()
  for _, c in ipairs(UI.skinned) do c.crtSkin(isModern) end
end
for _, name in ipairs({ "cowfee", "midnight" }) do
  palette(name)
  theme(true)
  local pal = PALETTES[name]
  check(allShown(p.rollBorder, false), name .. ": no game border")
  check(not p.slot.shown and allShown(p.plate, false) and not p.stone.shown, name .. ": no game slot, plate or stone")
  check(p.plateFlat.shown and near(p.plateFlat.fill, pal.surface), name .. ": a flat plate in the theme's field colour")
  check(near(p.bg, pal.background) and p.bg[4] > 0.9 and near(p.edge, pal.border) and p.edge[4] == 1, name .. ": the panel in the theme's colours")
  check(p.slotFlat.shown and near(p.slotFlat.edge, { 0.64, 0.21, 0.93 }), name .. ": the slot edge in the quality colour")
  check(not chrome.shown, name .. ": no window frame, the flat strip only")
  check(strip.points[1][2] == 0 and strip.w == 520 and strip.bg.shown, name .. ": the flat strip full width")
  check(last(p)[2] == 0 and last(p)[3] == -(26 + 4), name .. ": the first item right under the strip, full width")
  eq(anchor.h, 26 + 4 + p.h + 4 + p2.h, name .. ": the popup ends at the last item")
  eq(at(p.timer, 1), "TOPLEFT 1 -1", name .. ": the timer inside the 1 px edge")
  -- Modern puts the badge after the title: after the (i), so the (i) never covers the TEST or boss badge
  local bp = last(strip.badge)
  check(bp and bp[1] == "LEFT" and bp[2] == strip.help and bp[3] == "RIGHT", name .. ": the badge comes after the (i), not under it")
  local np = last(strip.note)
  check(np and np[2] == (strip.badge.shown and strip.badge or strip.help), name .. ": the note after the badge, else after the (i)")
end
-- and back to Default: Blizzard
theme(false)
check(allShown(p.rollBorder, true) and p.slot.shown and p.stone.shown and not p.plateFlat.shown, "classic again: the game's art is back")
check(chrome.shown and chrome.TitleBg.shown, "classic again: the window frame is back")
fits("classic again", { p, p2 })

-- an item answered for you: the auto line inside the frame's inset, the items under it
LM.incoming.items[3] = { itemString = "item:2", shownAt = 100 }
LM.incoming.mine[3] = { auto = true, closed = true, response = "pass" }
UI:RepaintTheme()
local autoFrame
for _, f in ipairs(frames) do if rawget(f, "show") and rawget(f, "text") and f.parent == anchor then autoFrame = f end end
check(autoFrame and autoFrame.shown, "auto line shows")
check(autoFrame and autoFrame.points[1][2] == 4 and autoFrame.points[1][3] == -(26 + 4), "classic: the auto line inside the inset")
eq(chrome.h, 26 + 4 + 22 + 4 + p.h + 4 + p2.h + 6, "classic: the frame takes in the auto line")
eq(last(p)[3], -(26 + 4 + 22 + 4), "classic: the items under it")

-- unchanged behaviour: a click answers, a right-click closes, and the frame shrinks to what is left
p.note.text = " my note "
p.buttons[2].scripts.OnClick()
check(answered and answered[1] == p.index and answered[2] == eight[2].key and answered[3] == "my note", "a click sends the answer with the note")
p.scripts.OnMouseUp(p, "RightButton")
check(LM.incoming.mine[p.index] and LM.incoming.mine[p.index].closed, "a right-click closes the item")
check(not p.shown, "the closed item hides")
eq(chrome.h, 26 + 4 + 22 + 4 + p2.h + 6, "closed: the frame shrinks to the items left")
eq(last(p2)[3], -(26 + 4 + 22 + 4), "closed: the next item moves up, no gap")
-- the auto items shown again (Show again): every item back, the frame grows
LM:ShowPopup()
check(p.shown and autoFrame.shown == false, "shown again: the closed item is back and the auto line goes")
local p3
for _, f in ipairs(frames) do if rawget(f, "note") and rawget(f, "buttons") and f ~= p and f ~= p2 then p3 = f end end
fits("shown again", { p, p2, p3 })
eq(at(p.timer, 1), "TOPLEFT 4 -4", "classic again: the timer back on the stone")

-- the art's fallbacks: an unknown quality gets the roll frame's own default slot and no colour
LM.incoming.items[3] = { itemString = "item:9", shownAt = 100 }
UI:RepaintTheme()
eq(p3.slot.atlas, "loottoast-itemborder-green", "an unknown quality: the default slot border")
check(near(p3.rollBorder[1].vertex, { 1, 1, 1 }), "an unknown quality: the border uncoloured")
-- without the game's ColorManager, or with one that lacks these lookups: the game's tables
local cm = ColorManager
for _, what in ipairs({ "no ColorManager", "a ColorManager without the lookups" }) do
  ColorManager = what == "no ColorManager" and nil or {}
  UI:RepaintTheme()
  eq(p.slot.atlas, "loottoast-itemborder-purple", what .. ": the slot from LOOT_BORDER_BY_QUALITY")
  check(near(p.rollBorder[1].vertex, { 0.64, 0.21, 0.93 }), what .. ": the colour from ITEM_QUALITY_COLORS")
  eq(p2.slot.atlas, "loottoast-itemborder-blue", what .. ": a rare item still blue")
end
ColorManager = cm

-- three rows of buttons (a wider font): the item grows by a row and the frame with it
local twoRows = p.h
LETTER = 11
LM.incoming.responses = LM.CleanResponses(eight)
UI:RepaintTheme()
local ys, n3 = {}, 0
for _, b in ipairs(p.buttons) do local y = last(b)[3] if not ys[y] then ys[y] = true n3 = n3 + 1 end end
eq(n3, 3, "a wider font: three rows")
eq(p.h, twoRows + 22 + 4, "three rows: the item one row taller")
fits("three rows", { p, p2, p3 })
LETTER = 7.5

-- a flask (a consumable, no slot) is open to every raider: every button on, no "can't use" line
local instant = C_Item.GetItemInfoInstant
C_Item.GetItemInfoInstant = function(s) if s == "item:5" then return 5, "Consumable", "Flask", "", 0, 0, 3 end return instant(s) end
LM.incoming.items[4] = { itemString = "item:5", ilvl = 90, shownAt = 100 }
LM.incoming.mine[4] = nil
UI:RepaintTheme()
local pf
for _, f in ipairs(frames) do if rawget(f, "note") and rawget(f, "buttons") and rawget(f, "itemString") == "item:5" then pf = f end end
check(pf ~= nil and pf.shown, "a flask: its panel shows")
local allOn = pf ~= nil and #pf.buttons > 0
for _, b in ipairs(pf and pf.buttons or {}) do if rawget(b, "enabled") == false then allOn = false end end
check(allOn, "a flask: every answer button is on")
eq(pf and (rawget(pf.status, "text") or ""), "", "a flask: no answered-for-you line")
local flaskDetail = LM.DetailText(LM.incoming.items[4])
check(type(flaskDetail) == "string" and flaskDetail:find("Flask", 1, true) and not flaskDetail:find("can't", 1, true), "a flask: the detail line names it, no can't-use word (" .. tostring(flaskDetail) .. ")")
C_Item.GetItemInfoInstant = instant
rawget(strip, "close").scripts.OnClick()
local allClosed = true
for i in pairs(LM.incoming.items) do if not (LM.incoming.mine[i] and LM.incoming.mine[i].closed) then allClosed = false end end
check(allClosed, "the title bar's X closes every item")
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Window.lua', 'CRT_Modules/LootMaster/Popup.lua', 'CRT_Modules/LootMaster/Data.lua', 'CRT_Core/Gear.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
