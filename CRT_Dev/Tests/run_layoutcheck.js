// The layout check (CRT_Dev/Dev/LayoutCheck.lua) on frames that work out where they sit from their anchors, sizes and
// scales, as the game does: a frame with SetScale (or under one) is measured in the page's units, what a clipping frame
// (SetClipsChildren, as every ScrollBox is: Loot Master > Raider Score's list) cuts off is not counted, and a real
// overflow is still found. Then the
// pages the check flagged on build#038, built for real on those frames at UI.PAGE_W x UI.PAGE_H: Raid Notes > Notes
// (CRT_Modules/Notes/Page.lua with the real UI.Dropdown from CRT_Core/UI/Controls.lua) and Raid Notes > Marker macros
// (CRT_Modules/Markers/MacrosTab.lua with the real marker display, Markers/Display.lua). Each must report nothing.
// usage: node run_layoutcheck.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const W = process.argv[2];
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = require('./theme_stub')(W) + `
local checkSrc, controlsSrc, pageSrc, parseSrc, renderSrc, displaySrc, tabSrc = ...
local fails, passes = 0, 0
unpack = unpack or table.unpack
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- Frames with a place: every method a no-op unless set here. Places are worked out in screen units from the
-- anchors (offsets and sizes are in a frame's own scale, as in the game), and GetLeft and the rest answer in the
-- frame's own effective scale (warcraft.wiki.gg, API Region GetLeft).
local M = {}
local everything = {}
local function new(kind, parent, isRegion)
  local o = { kind = kind, parent = parent, points = {}, shown = true, scale = 1, children = {}, regions = {} }
  everything[#everything + 1] = o
  setmetatable(o, { __index = function(_, k) return M[k] or (k:match("^%u") and function() end) or nil end })
  if parent then table.insert(isRegion and parent.regions or parent.children, o) end
  return o
end
local function parentOf(o) return o.parent end
function M:GetParent() return self.parent end
function M:GetObjectType() return self.kind end
function M:GetChildren() return unpack(self.children) end
function M:GetRegions() return unpack(self.regions) end
function M:CreateFontString() return new("FontString", self, true) end
function M:CreateTexture() return new("Texture", self, true) end
function M:CreateLine() return new("Line", self, true) end
function M:SetScale(s) self.scale = s end
function M:GetScale() return self.scale end
function M:GetEffectiveScale() return self.scale * (self.parent and self.parent:GetEffectiveScale() or 1) end
function M:Show() self.shown = true local fn = rawget(self, "OnShow") if fn then fn(self) end end
function M:Hide() self.shown = false end
function M:SetShown(on) if on then self:Show() else self:Hide() end end
function M:IsShown() return self.shown end
function M:IsVisible() return self.shown and (not self.parent or self.parent:IsVisible()) end
function M:SetScript(name, fn) rawset(self, name, fn) end
function M:GetScript(name) return rawget(self, name) end
function M:HookScript() end
function M:SetText(s) self.text = s if self.fs then self.fs.text = s end end
function M:GetText() return self.text end
function M:GetStringWidth() return #(tostring(self.text or "")) * 6 end
function M:GetFontString() return self.fs end
function M:SetFontString(fs) self.fs = fs end
function M:SetClipsChildren(on) self.clips = on and true or false end
function M:DoesClipChildren() return self.clips or false end
function M:SetScrollChild(c) self.scrollChild = c end
function M:GetScrollChild() return self.scrollChild end
function M:SetEnabled(on) self.enabled = on end
function M:IsEnabled() return self.enabled ~= false end
function M:GetFrameLevel() return 1 end
function M:SetSize(w, h) self.w, self.h = w, h end
function M:SetWidth(w) self.w = w end
function M:SetHeight(h) self.h = h end
function M:ClearAllPoints() self.points = {} end
function M:SetPoint(point, a, b, c, d)
  local rel, relPoint, x, y
  if type(a) == "table" then rel = a if type(b) == "string" then relPoint, x, y = b, c, d else relPoint, x, y = point, b, c end
  elseif type(a) == "string" then rel, relPoint, x, y = self.parent, a, b, c
  else rel, relPoint, x, y = self.parent, point, a, b end
  table.insert(self.points, { point = point, rel = rel, relPoint = relPoint, x = x or 0, y = y or 0 })
end
function M:SetAllPoints(rel)
  self:ClearAllPoints()
  self:SetPoint("TOPLEFT", rel or self.parent, "TOPLEFT", 0, 0)
  self:SetPoint("BOTTOMRIGHT", rel or self.parent, "BOTTOMRIGHT", 0, 0)
end

-- Where a point sits along an edge: 0 at the left (or bottom), 0.5 in the middle, 1 at the right (or top).
local function hOf(p) return p:find("LEFT") and 0 or (p:find("RIGHT") and 1 or 0.5) end
local function vOf(p) return p:find("BOTTOM") and 0 or (p:find("TOP") and 1 or 0.5) end
-- The frame's rect in screen units, { l, r, t, b }, or nil when it has no place.
local function rect(o)
  if o.fixed then return o.fixed end
  if #o.points == 0 then return nil end
  local s = o:GetEffectiveScale()
  local width = o.w and o.w * s
  local height = o.h and o.h * s
  if o.kind == "FontString" then
    width = width or o:GetStringWidth() * s
    height = height or ((o.text and o.text ~= "") and 12 * s or 0)
  end
  local xs, ys = {}, {}
  for _, p in ipairs(o.points) do
    local r = p.rel and rect(p.rel)
    if r then
      local hr, vr = hOf(p.relPoint), vOf(p.relPoint)
      xs[#xs + 1] = { h = hOf(p.point), at = r.l + hr * (r.r - r.l) + p.x * s }
      ys[#ys + 1] = { v = vOf(p.point), at = r.b + vr * (r.t - r.b) + p.y * s }
    end
  end
  local function solve(list, key, size)
    if #list == 0 then return nil end
    local a = list[1]
    for i = 2, #list do
      local b = list[i]
      if b[key] ~= a[key] then
        local lo, hi = a, b
        if lo[key] > hi[key] then lo, hi = hi, lo end
        local span = (hi.at - lo.at) / (hi[key] - lo[key])
        local start = lo.at - lo[key] * span
        return start, start + span
      end
    end
    size = size or 0
    local start = a.at - a[key] * size
    return start, start + size
  end
  local l, r = solve(xs, "h", width)
  local b, t = solve(ys, "v", height)
  if not (l and b) then return nil end
  return { l = l, r = r, t = t, b = b }
end
local function edge(o, k) local r = rect(o) return r and r[k] / o:GetEffectiveScale() end
function M:GetLeft() return edge(self, "l") end
function M:GetRight() return edge(self, "r") end
function M:GetTop() return edge(self, "t") end
function M:GetBottom() return edge(self, "b") end
function M:GetWidth() local r = rect(self) return r and (r.r - r.l) / self:GetEffectiveScale() or (self.w or 0) end
function M:GetHeight() local r = rect(self) return r and (r.t - r.b) / self:GetEffectiveScale() or (self.h or 0) end

UIParent = new("Frame")
UIParent.fixed = { l = 0, r = 1920, t = 1080, b = 0 }
function CreateFrame(kind, name, parent, template)
  local f = new(kind == "DropdownButton" and "DropdownButton" or kind, parent or UIParent)
  if template == "UIPanelButtonTemplate" or template == "UICheckButtonTemplate" then
    f.fs = new("FontString", f, true)
    f.fs:SetPoint("CENTER")
  end
  if template == "WowStyle1DropdownTemplate" then f.h = 26 end
  if name then _G[name] = f end
  return f
end
function CreateFont() return new("Font") end
GameFontHighlight = new("Font")
format = string.format
tinsert = table.insert
UISpecialFrames = {}
CANCEL = "Cancel"
C_Timer = { After = function() end }
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
function InCombatLockdown() return false end
GameTooltip = new("GameTooltip")

-- The page area, where UI/Panel.lua puts it: UI.PAGE_W x UI.PAGE_H, its top left 300 right and 900 up the screen.
local function newPage()
  local pf = new("Frame", UIParent)
  pf.fixed = { l = 300, r = 300 + 1026, t = 900, b = 900 - 560 }
  return pf
end

local pages = {}
local CRT = {
  db = { ui = { font = "Friz Quadrata" }, markers = { disabled = {} }, notes = {} },
  FontPath = function() return "Fonts\\\\FRIZQT__.TTF" end,
  Print = function() end,
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end, DeclareField = function() end,
    Options = function() return { { key = 3001, label = "First boss" } } end, FirstKey = function(list) return list[1] and list[1].key end },
  UI = { PAGE_W = 1026, PAGE_H = 560, SkinScrollBar = function() end, SkinDropdown = function() end,
    ScrollGutter = function(w) return 6 + (w or 18) end, RegisterLayer = function() end, RegisterThemed = function() end,
    RegisterPreview = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end,
    SetFrameTitle = function() end, RegisterTab = function() end, SetTabSelected = function() end,
    PanelButtonWidth = function(w) return math.ceil(w) + 24 end, TooltipOwner = function() end },
  Notes = {
    CanEditRaid = function() return true end, Set = function() end, OnChange = function() end,
    List = function() return {} end, ListStyle = function() return "grouped" end, ListDifficulty = function() return "All" end,
    ListFolded = function() return false end, SetListFolded = function() end, SetListDifficulty = function() end,
    DifficultyGroup = function() return "Other" end, DIFFICULTIES = { "Mythic", "Heroic", "Normal" }, ShortName = function(n) return n end,
    ViaLabel = function(v) return v end, SourceLabel = function() return nil end, Active = function() return nil end,
    Get = function() return nil end, Personal = function() return "" end, HistoryCount = function() return 0 end,
  },
  NoteTargets = { List = function() return {} end, Get = function() return nil end },
  Alerts = { running = false },
  NoteEngine = { running = false, PeekNextPhase = function() return nil end },
  NoteComm = { Sharing = function() return nil end },
  NoteReminders = { Build = function() end }, NoteAlertsTab = { Build = function() end }, NoteSettings = { Build = function() end },
  Groups = { Find = function() return nil end },
}
-- a (?) icon right of what it explains, as UI.HelpRight places it
function CRT.UI.HelpRight(target, title, text)
  local b = CreateFrame("Button", nil, target.parent)
  b:SetSize(16, 16)
  b:SetPoint("LEFT", target, "RIGHT", 4, 0)
  return b
end
CRT.UI.Help = CRT.UI.HelpRight
function CRT.UI.ResetButton(parent) local b = CreateFrame("Button", nil, parent) b:SetSize(16, 16) return b end
CRT_THEME(CRT, CRT.UI)
local UI = CRT.UI
assert(load(controlsSrc, "Controls.lua"))("CowfeeRaidTools", CRT)
assert(load(checkSrc, "LayoutCheck.lua"))("CowfeeRaidTools", CRT)
local Check = CRT.LayoutCheck
check(type(Check.Scan) == "function", "the check's scan is reachable for tests (LayoutCheck.Scan)")

local function scanned(pf, where)
  local out = {}
  Check.Scan(pf, where, out)
  for _, line in ipairs(out) do print("  " .. line) end
  return out
end

-- 1. A frame scaled down to fit its box, inside the page: GetLeft and the rest answer in its own scale, which is not
-- the page's. Nothing is outside.
do
  local pf = newPage()
  local box = CreateFrame("Frame", nil, pf)
  box:SetPoint("TOPLEFT", 464, -100)
  box:SetSize(300, 160)
  local canvas = CreateFrame("Frame", nil, box)
  canvas:SetScale(0.3)
  canvas:SetSize(900, 500)
  canvas:SetPoint("CENTER")
  local cell = CreateFrame("Frame", nil, canvas)
  cell:SetSize(80, 86)
  cell:SetPoint("TOPLEFT", canvas, "TOPLEFT", 820, -414)
  local name = cell:CreateFontString()
  name:SetText("Ashka")
  name:SetPoint("TOP")
  name:SetWidth(76)
  local out = scanned(pf, "scaled")
  check(#out == 0, "a scaled frame inside the page is measured in the page's units: nothing outside (got " .. #out .. ")")
  -- the same canvas really reaching 10 page pixels past the right edge is still found, by 10
  local far = CreateFrame("Frame", nil, pf)
  far:SetScale(0.5)
  far:SetSize(100, 20)
  far:SetPoint("TOPRIGHT", pf, "TOPRIGHT", 20, -200) -- 20 of its own pixels: 10 of the page's
  out = scanned(pf, "scaled")
  check(#out == 1 and out[1]:find("past by right 10$") ~= nil, "a scaled frame really outside is found, by page pixels (got " .. tostring(out[1]) .. ")")
end

-- 2. A list that clips its rows (SetClipsChildren, as every ScrollBox does): a row half past the list's bottom is cut
-- off there, so nothing shows outside the page. The list itself is still measured. This is Loot Master > Raider
-- Score's list (CRT_Modules/LootMaster/Page.lua, a WowScrollBoxList): 56 under its tab at -66, down to 8 above the
-- page's bottom, so 430 high, with rows of 20; on build#038 its 22nd row was reported 2 past the page's bottom.
do
  local pf = newPage()
  local box = CreateFrame("Frame", nil, pf)
  box:SetPoint("TOPLEFT", 8, -122)
  box:SetSize(580, 430)
  box:SetClipsChildren(true)
  local target = CreateFrame("Frame", nil, box)
  target:SetAllPoints()
  for i = 1, 22 do
    local row = CreateFrame("Frame", nil, target)
    row:SetSize(580, 20)
    row:SetPoint("TOPLEFT", 0, -(i - 1) * 20)
    local fs = row:CreateFontString()
    fs:SetText("Raider " .. i)
    fs:SetPoint("LEFT", 4, 0)
  end
  local out = scanned(pf, "clipped")
  check(#out == 0, "rows a clipping list cuts off are not counted (got " .. #out .. ")")
  box:SetSize(580, 440)
  out = scanned(pf, "clipped")
  check(#out == 1 and out[1]:find("past by bottom 2$") ~= nil, "the clipping list itself past the bottom is still found (got " .. tostring(out[1]) .. ")")
  -- an ordinary frame past the bottom, as before
  box:SetSize(580, 430)
  local plain = CreateFrame("Frame", nil, pf)
  plain:SetPoint("BOTTOMLEFT", pf, "BOTTOMLEFT", 8, -6)
  plain:SetSize(100, 32)
  out = scanned(pf, "plain")
  check(#out == 1 and out[1]:find("Frame .* past by bottom 6$") ~= nil, "an ordinary frame past the bottom is found (got " .. tostring(out[1]) .. ")")
end

-- 3. Raid Notes > Notes, built for real: the note buttons and Send to (a UI.Dropdown row) fit above the tab's bottom.
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
assert(load(parseSrc, "Parse.lua"))("CowfeeRaidTools", CRT)
assert(load(renderSrc, "Render.lua"))("CowfeeRaidTools", CRT)
local notesPage = newPage()
pages.notes(notesPage)
notesPage:Show()
for _, ns in ipairs({ "crt", "all" }) do
  CRT.db.notes.shareTarget = ns
  CRT.NotesPage.Open("notes")
  local out = scanned(notesPage, "Raid Notes > Notes")
  check(#out == 0, "Raid Notes > Notes fits the page, Send to on " .. ns .. " (got " .. #out .. ")")
end

-- 4. Raid Notes > Marker macros, built for real: the marker display's preview is drawn inside its box on the tab,
-- scaled down to fit, whatever the display's size.
local displays = {}
CRT.MarkerDisplayDB = { displays = displays, help = {} }
CRT.Macros = {
  Status = function()
    local entries = {}
    for i = 1, 8 do entries[i] = { state = "missing", def = { name = "CRT Marker " .. i, body = "/raid {rt" .. i .. "}", icon = 134400 } } end
    return { entries = entries, label = "Marker calls", total = 8, created = 0, changed = {}, conflicts = {}, outdated = 0 }
  end,
  StatusText = function() return "none" end, InCombat = function() return false end, OnChange = function() end,
}
assert(load(displaySrc, "Display.lua"))("CowfeeRaidTools", CRT)
assert(load(tabSrc, "MacrosTab.lua"))("CowfeeRaidTools", CRT)
for _, def in ipairs({
  { slots = 4, layout = "row", iconSize = 40 },
  { slots = 4, layout = "free", shape = "square", iconSize = 73, canvas = 400 },
  { slots = 8, layout = "grid", iconSize = 96 },
}) do
  displays[3001] = def
  CRT.NotesPage.Open("markers")
  CRT.MarkerMacrosTab.Pick(3001)
  local out = scanned(notesPage, "Raid Notes > Marker macros")
  check(#out == 0, "Raid Notes > Marker macros fits the page, display " .. def.layout .. " of " .. def.slots .. " (got " .. #out .. ")")
  -- and not only because its box clips it: with no clipping anywhere the scaled preview still sits inside
  local clipped = {}
  for _, o in ipairs(everything) do if o.clips then clipped[#clipped + 1] = o o.clips = false end end
  out = scanned(notesPage, "Raid Notes > Marker macros, unclipped")
  for _, o in ipairs(clipped) do o.clips = true end
  check(#clipped > 0 and #out == 0, "the preview of display " .. def.layout .. " of " .. def.slots .. " sits inside the page unclipped too (got " .. #out .. ")")
end

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error("layout check harness failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Dev/Dev/LayoutCheck.lua', 'CRT_Core/UI/Controls.lua', 'CRT_Modules/Notes/Page.lua', 'CRT_Modules/Notes/Parse.lua',
  'CRT_Modules/Notes/Render.lua', 'CRT_Modules/Markers/Display.lua', 'CRT_Modules/Markers/MacrosTab.lua']) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, f), 'utf8')));
}
if (lua.lua_pcall(L, 7, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
