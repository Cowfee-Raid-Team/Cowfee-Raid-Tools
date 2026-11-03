// CRT_Dev/Dev/DevPage.lua on mock frames: the Development page's tabs (Layout, Windows, Boss data, Probes), built
// with the shared tab strip (CRT_Modules/Alerts/SubTabs.lua). Each tab shows only its own sections, stacked from the
// top of the tab area; every section and every control placed in it sits inside the page (UI.PAGE_W x UI.PAGE_H)
// and inside its section, and no two sections of a tab overlap. The tab picked last stays for the session.
// usage: node run_devpage.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local subTabsSrc, panelSrc, pageSrc, layerCount = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- Frames: each keeps its parent, points, size, text and shown state.
local M = {}
local meta = { __index = function(t, k)
  local m = rawget(M, k)
  if m then return m end
  if type(k) == "string" and k:match("^[A-Z]") then return function() end end -- any other game method: a no-op
  return nil
end }
local regions = {}
local function region(kind, parent)
  local r = setmetatable({ kind = kind, parent = parent, shown = true, scripts = {}, points = {} }, meta)
  regions[#regions + 1] = r
  return r
end
function M:SetScript(n, fn) self.scripts[n] = fn end
function M:GetScript(n) return self.scripts[n] end
function M:Show() self.shown = true end
function M:Hide() self.shown = false end
function M:SetShown(v) self.shown = v and true or false end
function M:IsShown() return self.shown end
function M:IsVisible() local f = self while f do if not f.shown then return false end f = f.parent end return true end
function M:SetText(t) self.text = t end
function M:GetText() return self.text end
function M:SetChecked(v) self.checked = v and true or false end
function M:GetChecked() return self.checked end
function M:GetParent() return self.parent end
function M:SetPoint(...) self.points[#self.points + 1] = { ... } end
function M:ClearAllPoints() self.points = {} end
function M:SetSize(w, h) self.w, self.h = w, h end
function M:SetWidth(w) self.w = w end
function M:SetHeight(h) self.h = h end
function M:GetWidth() return self.w or 0 end
function M:GetStringWidth() return #(self.text or "") * 7 end
function M:GetUnboundedStringWidth() return #(self.text or "") * 7 end
function M:CreateFontString() return region("FontString", self) end
function M:CreateTexture() return region("Texture", self) end
function M:Click() if self.scripts.OnClick then self.scripts.OnClick(self, "LeftButton") end end
function CreateFrame(kind, name, parent, template)
  local f = region(kind or "Frame", parent)
  f.template = template
  return f
end
UIParent = region("Frame")

local calls = {}
local function stub(name) return function() calls[#calls + 1] = name end end
local CRT = { db = { dev = {} } }
local pages = {}
local UI = {
  PAGE_W = 1026, PAGE_H = 560, LAYERS = {},
  pages = pages,
  RegisterPage = function(self, key, name, build) pages[key] = { name = name, build = build } end,
  SetPageHidden = function() end,
  HelpRight = function(target, title, text) return region("Button", target.parent) end,
  PanelButton = function(parent, label, h, onClick) local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b:SetText(label) b:SetSize(#label * 7 + 20, h) b:SetScript("OnClick", onClick) return b end,
  Dropdown = function(parent, label, o) local d = CreateFrame("Frame", nil, parent) d:SetSize(o.labelWidth + o.width, 26) d.label = label d.refresh = function() end return d end,
  LayerChoices = function() return {} end,
  Layer = function() return "HIGH" end,
  SetLayer = function() end,
  RegisterTab = function(self, b) self.tabs = self.tabs or {} self.tabs[#self.tabs + 1] = b end,
  SetTabSelected = function(self, b, on) b.selected = on end,
  Tint = function() end,
  Color = function() return 1, 1, 1, 1 end,
  SkinTree = function() end,
  LiftOver = function() end,
  ShownPopup = function(r) return r end,
}
for i = 1, layerCount do UI.LAYERS[i] = { key = "layer" .. i, label = "Layer " .. i } end
CRT.UI = UI
CRT.Dev = { Toggle = stub("Dev:Toggle"), IsOn = function() return false end, SetMoving = function() end, IsMoving = function() return false end, ClearAll = stub("Dev:ClearAll"), ResetAllPositions = stub("Dev:ResetAllPositions") }
CRT.DebuffPanel = { ShowInfo = stub("DebuffPanel:ShowInfo") }
CRT.ReferenceTypes = { Toggle = stub("ReferenceTypes:Toggle") }
CRT.WindowLog = { Toggle = stub("WindowLog:Toggle") }
CRT.LayoutCheck = { Run = stub("LayoutCheck:Run") }
CRT.LateTest = { Toggle = stub("LateTest:Toggle") }
CRT.TimelineProbe = { Arm = stub("TimelineProbe:Arm"), Show = stub("TimelineProbe:Show") }
CRT.MarkerEditor = { Toggle = stub("MarkerEditor:Toggle") }
CRT.SeasonTools = { Toggle = stub("SeasonTools:Toggle") }
CRT.BossOrder = { Toggle = stub("BossOrder:Toggle") }
CRT.Bosses = { Current = function() return { name = "Midnight Season 2" } end, LoadMode = function() return "current" end }
local logs = {}
for i = 1, 12 do logs[i] = { encounterID = 3000 + i } end
CRT.BossDebug = { List = function() return logs end, RowText = function(_, r) return "Boss " .. r.encounterID, "Mythic, 4:12" end,
  OnChange = function() end, IsOn = function() return false end, SetOn = function() end }

assert(load(subTabsSrc, "SubTabs.lua"))("CowfeeRaidTools", CRT)
assert(load(panelSrc, "BossDebugPanel.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "DevPage.lua"))("CowfeeRaidTools", CRT)

local Page = CRT.DevPage
check(pages.dev ~= nil, "the Development page is registered")
check(Page ~= nil and Page.Layout ~= nil and Page.Select ~= nil, "CRT.DevPage: Layout and Select")
if not (Page and pages.dev) then print(passes .. " passed, " .. fails .. " failed") return fails end

local pf = CreateFrame("Frame", nil, UIParent)
pf:SetSize(UI.PAGE_W, UI.PAGE_H)
pages.dev.build(pf)
if pf.scripts.OnShow then pf.scripts.OnShow(pf) end

-- The tabs, in Alex's order, Layout open the first time.
local want = { "layout", "windows", "bossdata", "probes" }
local labels = { layout = "Layout", windows = "Windows", bossdata = "Boss data", probes = "Probes" }
local keys = {}
for i, t in ipairs(Page.TABS) do keys[i] = t.key end
check(table.concat(keys, ",") == table.concat(want, ","), "four tabs in order: " .. table.concat(keys, ","))
local strip = Page.Strip()
check(strip ~= nil and strip:Current() == "layout", "Layout is open the first time")
for _, k in ipairs(want) do
  local b = strip and strip.buttons[k]
  check(b and b.text and b.text.text == labels[k], "the " .. k .. " tab reads " .. labels[k])
  check(b and b.w and b.w >= #labels[k] * 7, "the " .. k .. " tab is at least its label's width")
end

-- The right sections on each tab, nothing else.
local wantSections = {
  layout = { "layout" },
  windows = { "windows", "windowlog", "layers" },
  bossdata = { "reftypes", "markers", "seasons" },
  probes = { "probe", "diagnostics", "bossdebug" },
}
local headingOf = { layout = "Layout editor", windows = "Windows", windowlog = "Window log", layers = "Layers, each window",
  reftypes = "Logged Timeline Ref", markers = "Marker displays", seasons = "Season packs", probe = "Timeline probe",
  diagnostics = "Diagnostics", bossdebug = "Boss debug" }
local lay = Page.Layout()
for _, tab in ipairs(want) do
  local got = {}
  for _, s in ipairs(lay[tab] or {}) do got[#got + 1] = s.key end
  table.sort(got)
  local exp = {}
  for i, k in ipairs(wantSections[tab]) do exp[i] = k end
  table.sort(exp)
  check(table.concat(got, ",") == table.concat(exp, ","), tab .. " has its sections: " .. table.concat(got, ","))
end

-- Sections: inside the page under the tabs, stacked from the top of the tab area, no overlaps.
local function overlap(a, b)
  return a.x < b.x + b.w and b.x < a.x + a.w and a.y > b.y - b.h and b.y > a.y - a.h
end
for _, tab in ipairs(want) do
  local list = lay[tab] or {}
  local tops = {}
  for _, s in ipairs(list) do
    check(s.x >= 0 and s.x + s.w <= UI.PAGE_W and s.y <= Page.L.top and s.y - s.h >= -UI.PAGE_H,
      tab .. ": " .. s.key .. " is inside the page (" .. s.x .. ", " .. s.y .. ", " .. s.w .. " x " .. s.h .. ")")
    tops[s.x] = math.max(tops[s.x] or -math.huge, s.y)
  end
  for _, top in pairs(tops) do
    check(top == Page.L.top, tab .. ": each column starts at the top of the tab area")
  end
  for i = 1, #list do
    for j = i + 1, #list do
      check(not overlap(list[i], list[j]), tab .. ": " .. list[i].key .. " and " .. list[j].key .. " don't overlap")
    end
  end
end

-- Every control on a tab sits inside one of that tab's sections, and the tab shows only its own headings.
local frames = strip.frames
local function tabOf(r)
  local f = r
  while f do
    for k, tf in pairs(frames) do if f == tf then return k end end
    f = f.parent
  end
end
-- A region's top left on the page: SetPoint("TOPLEFT", x, y), or a point on the tab frame's TOPLEFT.
local function placed(r)
  local p = r.points[1]
  if not p then return nil end
  if p[1] == "TOPLEFT" and type(p[2]) == "number" then return p[2], p[3] end
  if type(p[2]) == "table" and p[3] == "TOPLEFT" and type(p[4]) == "number" then
    if p[1] == "TOPRIGHT" then return p[4] - (r.w or 0), p[5] end
    if p[1] == "TOPLEFT" then return p[4], p[5] end
  end
end
local inside, stray, counted = 0, {}, 0
for _, r in ipairs(regions) do
  local tab = tabOf(r)
  local x, y = placed(r)
  if tab and x and r.parent and frames[tab] and (r.parent == frames[tab]) then
    counted = counted + 1
    local ok = false
    for _, s in ipairs(lay[tab]) do
      -- 4 px slack on the left: a check box sits 3 px left of its heading, so its tick lines up
      if x >= s.x - 4 and x + (r.w or 0) <= s.x + s.w and y <= s.y and y - (r.h or 0) >= s.y - s.h then ok = true end
    end
    if ok then inside = inside + 1 else stray[#stray + 1] = tab .. " " .. tostring(r.text or r.label or r.kind) .. " at " .. x .. ", " .. y end
  end
end
check(counted > 30, "the controls are built on the tab frames (" .. counted .. ")")
check(#stray == 0, "every control sits inside its tab's section" .. (#stray > 0 and (": " .. table.concat(stray, "; ")) or ""))

local function visibleHeadings()
  local out = {}
  for _, r in ipairs(regions) do
    if r.kind == "FontString" and r:IsVisible() and tabOf(r) then -- on a tab, not the strip's labels
      for k, h in pairs(headingOf) do if r.text == h then out[k] = true end end
    end
  end
  return out
end
for _, tab in ipairs(want) do
  strip.buttons[tab]:Click()
  check(strip:Current() == tab and frames[tab]:IsShown(), "clicking " .. tab .. " opens it")
  local seen = visibleHeadings()
  local okAll = true
  for k in pairs(headingOf) do
    local mine = false
    for _, s in ipairs(wantSections[tab]) do if s == k then mine = true end end
    if (seen[k] or false) ~= mine then okAll = false print("  " .. tab .. ": heading " .. k .. (mine and " missing" or " shown")) end
  end
  check(okAll, tab .. " shows only its own headings")
end

-- One button on each tab works as before.
local function clickText(tab, text)
  strip.buttons[tab]:Click()
  for _, r in ipairs(regions) do
    if r.text == text and r.scripts.OnClick and r:IsVisible() then r:Click() return true end
  end
  return false
end
calls = {}
clickText("layout", "Open the layout editor")
clickText("windows", "Reset all positions")
clickText("bossdata", "Open Logged Timeline Ref")
clickText("probes", "Show what it found")
check(table.concat(calls, ",") == "Dev:Toggle,Dev:ResetAllPositions,ReferenceTypes:Toggle,TimelineProbe:Show", "a button on each tab works: " .. table.concat(calls, ","))

-- The tab picked last stays for the session: the page shown again keeps it.
strip.buttons.bossdata:Click()
if pf.scripts.OnShow then pf.scripts.OnShow(pf) end
check(strip:Current() == "bossdata", "the tab picked last stays when the page shows again")
check(CRT.AlertSubTabs.Picked("dev") == "bossdata", "the session remembers it under the dev owner")
Page.Select("probes")
check(strip:Current() == "probes", "Select opens a tab")

print(passes .. " passed, " .. fails .. " failed")
return fails
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Alerts/SubTabs.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Dev/Dev/BossDebugPanel.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Dev/Dev/DevPage.lua', 'utf8')));
// as many layers as General Settings has: the Layers section must fit them all
const panel = fs.readFileSync(d + '/CRT_Core/UI/Panel.lua', 'utf8');
const block = (panel.match(/UI\.LAYERS = \{([\s\S]*?)\n\}/) || [])[1] || '';
const layers = (block.match(/\{ key = /g) || []).length;
lua.lua_pushinteger(L, layers);
if (lua.lua_pcall(L, 4, 1, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
const luaFails = lua.lua_tointeger(L, -1);

// Developer only: DevPage.lua stays inside the .toc's do-not-package block, after the shared tab strip.
const toc = fs.readFileSync(d + '/CowfeeRaidTools.toc', 'utf8');
const a = toc.indexOf('#@do-not-package@'), b = toc.indexOf('#@end-do-not-package@'), i = toc.indexOf('CRT_Dev\\Dev\\DevPage.lua');
let bad = luaFails > 0 ? 1 : 0;
if (!(a >= 0 && i > a && i < b)) { console.log('FAIL DevPage.lua is not in the .toc do-not-package block'); bad++; }
if (toc.indexOf('CRT_Modules\\Alerts\\SubTabs.lua') > i) { console.log('FAIL SubTabs.lua loads after DevPage.lua'); bad++; }
if (layers < 10) { console.log('FAIL read ' + layers + ' layers from Panel.lua'); bad++; }
if (bad === (luaFails > 0 ? 1 : 0)) console.log('ok the page never ships and loads after the tab strip');
process.exit(bad === 0 ? 0 : 1);
