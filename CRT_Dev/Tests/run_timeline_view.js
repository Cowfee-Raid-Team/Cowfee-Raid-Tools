// CRT_Modules/Timeline/View.lua: ticks, time math, lanes, and one build of the canvas on mock frames.
// Usage: node run_timeline_view.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua CRT_Modules/Timeline/View.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, dbSrc, refSrc, lanesSrc, viewSrc, regSrc, seasonSrc, nekSrc, tipSrc = ...
local buttons, textures = 0, 0
local function mock(kind)
  local m = { shown = true, kind = kind, children = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function() return mock("FontString") end end
    if k == "CreateTexture" then return function() textures = textures + 1 return mock("Texture") end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "SetPoint" then return function(self, ...) rawset(self, "pt", { ... }) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "Show" then return function(self) rawset(self, "shown", true) end end
    if k == "Hide" then return function(self) rawset(self, "shown", false) end end
    if k == "SetShown" then return function(self, on) rawset(self, "shown", on and true or false) end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "IsVisible" then return function(self) return rawget(self, "shown") end end
    if k == "GetWidth" then return function(self) return rawget(self, "w") or 600 end end
    if k == "GetHeight" then return function(self) return rawget(self, "h") or 300 end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetVertexColor" then return function(self, r, g, b) rawset(self, "vcolor", { r, g, b }) end end
    if k == "GetLeft" then return function() return 100 end end
    if k == "GetTop" then return function() return 500 end end
    if k == "GetEffectiveScale" then return function() return 1 end end
    if k == "IsMouseOver" then return function() return false end end
    if k == "SetHorizontalScroll" then return function(self, v) rawset(self, "hs", v) end end
    if k == "GetHorizontalScroll" then return function(self) return rawget(self, "hs") or 0 end end
    if k == "SetVerticalScroll" then return function(self, v) rawset(self, "vs", v) end end
    if k == "GetVerticalScroll" then return function(self) return rawget(self, "vs") or 0 end end
    if k == "GetVerticalScrollRange" then return function() return 0 end end
    if k == "GetHorizontalScrollRange" then return function() return 0 end end
    if k == "SetScrollChild" then return function(self, c) rawset(self, "child", c) end end
    if k == "GetValue" then return function(self) return rawget(self, "value") or 0 end end
    if k == "SetValue" then return function(self, v) rawset(self, "value", v) local fn = rawget(self, "OnValueChanged") if fn then fn(self, v) end end end
    if k == "GetMinMaxValues" then return function() return 0, 0 end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    if k == "GetScript" then return function(self, name) return rawget(self, name) end end
    if k == "GetChildren" then return function() return end end
    if k == "GetObjectType" then return function(self) return rawget(self, "kind") end end
    return function() end end })
end
function CreateFrame(kind) if kind == "Button" then buttons = buttons + 1 end return mock(kind) end
UIParent = mock("Frame")
GameTooltip = mock("GameTooltip")
local cursor = 400
function GetCursorPosition() return cursor, 300 end
function GetTime() return 0 end
function IsMouseButtonDown() return true end
function IsShiftKeyDown() return false end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end }
RAID_CLASS_COLORS = {}
CRTFontSmall, CRTFontNormal, CRTFontHighlight = {}, {}, {}
local CRT = {
  db = { timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3,
    overlayOn = false, hideEmpty = true, nextId = 1 } },
  PALETTE = { accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, surface = { 0.165, 0.122, 0.098 }, text = { 0.95, 0.90, 0.84 } },
  Groups = { ClassColor = function() return 1, 1, 1 end },
}
local hidden = {}
CRT.TimelineJournal = { ResolveID = function(_, k, r) if type(k) == "number" then return k end if r and type(r.encounterID) == "number" then return r.encounterID end end,
  Rows = function() return {} end,
  IsHidden = function(_, enc, id) return hidden[id] and true or false end,
}
CRT_THEME(CRT, CRT.UI)
-- View.lua places its tooltips with UI.TooltipOwner: a CRT.UI with only the real CRT_Core/UI/Tooltip.lua
CRT.UI = {}
CRT_TOOLTIP(CRT)
assert(load(dataSrc, "CRT_Modules/Timeline/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(dbSrc, "CRT_Modules/Timeline/Database.lua"))("CowfeeRaidTools", CRT)
assert(load(refSrc, "CRT_Modules/Timeline/Reference.lua"))("CowfeeRaidTools", CRT)
assert(load(lanesSrc, "CRT_Modules/Timeline/Lanes.lua"))("CowfeeRaidTools", CRT)
-- Boss library wiring (CRT_Data/Bosses/Registry.lua, then the season pack, then the ADDON_LOADED the game fires once every file has loaded).
local function loadBosses(CRT, reg, season, nek)
  local real, handler = CreateFrame, nil
  CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
  assert(load(reg, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
  CreateFrame = real
  assert(load(season, "CRT_Data/Seasons/Midnight-S1/Season.lua"))("CowfeeRaidTools", CRT)
  assert(load(nek, "CRT_Data/Seasons/Midnight-S1/NekzaliTheSoulcoiler.lua"))("CowfeeRaidTools", CRT)
  handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
end
loadBosses(CRT, regSrc, seasonSrc, nekSrc)
assert(load(viewSrc, "CRT_Modules/Timeline/View.lua"))("CowfeeRaidTools", CRT)
-- the shared ability tooltip the view's icons and rows use (CRT_Modules/Timeline/AbilityTip.lua, beside View.lua)
assert(load(tipSrc, "CRT_Modules/Timeline/AbilityTip.lua"))("CowfeeRaidTools", CRT)
local View = CRT.TimelineView
local T = CRT.Timeline
local S = CRT.db.timeline

-- Ticks
assert(#View.Ticks(300, 30, 600) == 11, "ticks at 300s span with 30s grid")
print("ok ticks at 300s span with 30s grid")
do
  local ticks = View.Ticks(600, 10, 600)
  assert(#ticks > 1, "ticks at 600s span with 10s grid are thinned: has ticks")
  for i = 2, #ticks do
    local gap = View.TimeToX(ticks[i], 600, 600) - View.TimeToX(ticks[i - 1], 600, 600)
    assert(gap >= 40, "ticks at 600s span with 10s grid are thinned")
  end
  assert(ticks[1] == 0, "ticks start at 0")
end
print("ok ticks at 600s span with 10s grid are thinned")

assert(View.TimeToX(150, 300, 600) == 300, "TimeToX")
assert(View.Format(125) == "2:05", "Format")
assert(View.Format(0) == "0:00" and View.Format(59.9) == "0:59", "Format edges")
print("ok TimeToX and Format")

local function kinds(lanes) local t = {} for i, l in ipairs(lanes) do t[i] = l.kind end return table.concat(t, ",") end
local rows = { { spellID = 5001, name = "A", icon = 1 }, { spellID = 5002, name = "B", icon = 2 } }
local pull = { id = 1, encounterID = 3001, length = 200, casts = { { t = 10, dur = 2, spellID = 5001 }, { t = 20, dur = 0, spellID = 0 } },
  deaths = { { t = 50, name = "Abu", class = "MAGE", role = "DAMAGER", spellID = 0 } } }
do
  local lanes = View.Lanes(pull, rows, S, 3001)
  assert(kinds(lanes) == "deaths,spell,unnamed", "lanes order and unnamed: " .. kinds(lanes))
  assert(lanes[2].spellID == 5001 and #lanes[2].marks == 1 and #lanes[3].marks == 1 and #lanes[1].marks == 1, "lanes order and unnamed: marks")
  assert(rows[1].marks == nil, "lanes do not touch the cached rows")
  S.hideEmpty = false
  lanes = View.Lanes(pull, rows, S, 3001)
  assert(kinds(lanes) == "deaths,spell,spell,unnamed", "hideEmpty off keeps empty rows")
  hidden[5002] = true
  lanes = View.Lanes(pull, rows, S, 3001)
  assert(kinds(lanes) == "deaths,spell,unnamed", "hidden rows are dropped")
  hidden[5002] = nil
  S.hideEmpty = true
  local quiet = { id = 2, length = 100, casts = { { t = 5, spellID = 5001 } }, deaths = {} }
  lanes = View.Lanes(quiet, rows, S, 3001)
  assert(kinds(lanes) == "deaths,spell", "no unnamed lane without marks")
end
print("ok lanes order and unnamed")

do
  S.deathRows = "player"
  local p = { id = 3, length = 200, casts = {}, deaths = {
    { t = 30, name = "Abu", class = "MAGE", role = "DAMAGER", spellID = 0 },
    { t = 60, name = "Bel", class = "PRIEST", role = "HEALER", spellID = 0 },
    { name = "Cid", class = "ROGUE", role = "DAMAGER", spellID = 0 } } }
  local lanes, unknown = View.Lanes(p, rows, S, 3001)
  local n = 0
  for _, l in ipairs(lanes) do if l.kind == "deaths" then n = n + 1 end end
  assert(n == 2, "per-player death lanes")
  assert(unknown and #unknown == 1 and unknown[1].name == "Cid", "deaths without a time are listed apart")
  S.deathRows = "combined"
end
print("ok per-player death lanes")

do
  for i = 1, 3 do
    T:SavePull({ encounterID = 3001, name = "Boss", length = 100, kill = false, casts = {},
      deaths = { { t = 10 * i, name = "P" .. i, class = "MAGE", role = "DAMAGER", spellID = 0 } } })
  end
  S.overlayOn = true
  local newest = T:Pulls(3001)[1]
  local lanes = View.Lanes(newest, rows, S, 3001)
  local ages = {}
  for _, m in ipairs(lanes[1].marks) do ages[#ages + 1] = m.age end
  table.sort(ages)
  assert(table.concat(ages, ",") == "0,1,2", "overlay adds aged marks: " .. table.concat(ages, ","))
  S.overlayOn = false
  lanes = View.Lanes(newest, rows, S, 3001)
  assert(#lanes[1].marks == 1 and lanes[1].marks[1].age == 0, "overlay off: shown pull only")
end
print("ok overlay adds aged marks")

do
  local parent = mock("Frame")
  local view = View.Create(parent)
  view:SetData(pull, 3001)
  view:Refresh()
  local made = buttons
  view:Refresh()
  view:Refresh()
  assert(buttons == made, "build smoke: icons come from the pool")
  assert(view:CastCount() == 2, "build smoke: cast count")
  view:SetSpan(5000)
  assert(S.span == 600, "build smoke: SetSpan clamps to 600")
  view:SetSpan(10)
  assert(S.span == 60, "build smoke: SetSpan clamps to 60")
  view:SetData(pull, 3001)
  view:ScrollTo(500)
  view.hscroll.OnMouseWheel(view.hscroll, -1)
  assert(S.span == 75 and view.hscroll:GetHorizontalScroll() == 340, "zoom keeps the time under the cursor")
  local before = view.hscroll:GetHorizontalScroll()
  view.hscroll.OnMouseDown(view.hscroll, "LeftButton")
  cursor = 350
  view.frame.OnUpdate(view.frame)
  view.hscroll.OnMouseUp(view.hscroll, "LeftButton")
  assert(view.hscroll:GetHorizontalScroll() == before, "left button does not drag")
  print("ok left button does not drag")
  cursor = 400
  view.hscroll.OnMouseDown(view.hscroll, "RightButton")
  cursor = 350
  view.frame.OnUpdate(view.frame)
  view.hscroll.OnMouseUp(view.hscroll, "RightButton")
  assert(view.hscroll:GetHorizontalScroll() == 390 and view.axisScroll:GetHorizontalScroll() == 390, "right-button drag scrolls the track and the axis")
  print("ok right-button drag scrolls")
  view:SetData({ id = 9, encounterID = 3001, length = 100, casts = { { t = 5, spellID = 1 }, { spellID = 2 }, { t = "x", spellID = 3 } }, deaths = {} }, 3001)
  assert(view:CastCount() == 1, "cast count counts only casts with a numeric time")
  view:SetData(nil, nil)
  view:Refresh()
  assert(view:CastCount() == 0, "build smoke: empty view")
end
print("ok build smoke")
-- Reference drawing ---------------------------------------------------------------------------------
local nekzali = assert(CRT.TimelineReference.Parse(CRT.TimelineDB.references[1]), "nekzali parses")
local overlay = { id = 2, length = 600, kill = false, casts = { { t = 5, spellID = 0 }, { t = 70, spellID = 0 }, { spellID = 0 } },
  deaths = { { t = 30, name = "Abu", class = "MAGE", role = "DAMAGER", spellID = 0 } } }
local function shown(list) local n = 0 for _, x in ipairs(list or {}) do if x:IsShown() then n = n + 1 end end return n end
local function shownText(list) local n = 0 for _, x in ipairs(list or {}) do if x:IsShown() and (x:GetText() or "") ~= "" then n = n + 1 end end return n end
local function durMarks(ref, length)
  local n = 0
  for _, row in ipairs(ref.rows) do for _, c in ipairs(row.casts) do if c.dur and c.dur > 0 and c.t < length then n = n + 1 end end end
  return n
end

local refView = View.Create(mock("Frame"))
do
  refView:SetData({ reference = nekzali }, "ref:x", overlay)
  refView:Refresh()
  local extra = refView:Extra()
  assert(extra and extra.length == 600 and extra.endLine == 600, "reference build smoke: extra")
  assert(refView.trackW == 600 * 600 / S.span, "reference build smoke: track width from extra.length")
  assert(shown(refView.pullTicks) == 2, "reference build smoke: one tick per timed overlay cast")
  assert(refView.endLine and refView.endLine:IsShown(), "reference build smoke: end line shown")
  local ticksLabel
  for _, l in ipairs(refView.labels) do if l:IsShown() and l.lane and l.lane.kind == "ticks" then ticksLabel = l end end
  assert(ticksLabel and ticksLabel.text:GetText() == "Pull 2 casts", "reference build smoke: ticks lane label")
end
print("ok reference build smoke")

do
  refView:SetData({ reference = nekzali }, "ref:x")
  local want = durMarks(nekzali, refView:Extra().length)
  assert(want == 10, "bars only on reference lanes: fixture has 10 bars, got " .. want)
  assert(shown(refView.bars) == want, "bars only on reference lanes: shown " .. shown(refView.bars))
  local leads = 0
  for _, row in ipairs(nekzali.rows) do if row.lead then leads = leads + #row.casts end end
  assert(shown(refView.leads) == leads, "bars only on reference lanes: one lead line per cast of a lead row")
  assert(not (refView.endLine and refView.endLine:IsShown()), "bars only on reference lanes: no end line without overlay")
  local pv = View.Create(mock("Frame"))
  pv:SetData(pull, 3001)
  assert(shown(pv.bars) == 0 and shown(pv.leads) == 0 and shown(pv.phaseLines) == 0, "bars only on reference lanes: pull shows none")
  refView:SetData(pull, 3001)
  assert(shown(refView.bars) == 0 and shown(refView.leads) == 0, "bars only on reference lanes: switching to a pull hides them")
end
print("ok bars only on reference lanes")

do
  refView:SetData({ reference = nekzali }, "ref:x")
  assert(shown(refView.phaseLines) == 3, "phase lines: 3 shown, got " .. shown(refView.phaseLines))
  assert(shownText(refView.phaseTexts) == 2, "phase lines: 2 labels, got " .. shownText(refView.phaseTexts))
  local zero = { boss = "Z", length = 100, phases = { { t = 0, label = "P1" }, { t = 50, label = "P2" } },
    rows = { { name = "A", casts = { { t = 10 } } } } }
  refView:SetData({ reference = zero }, "ref:z")
  assert(shown(refView.phaseLines) == 1 and shownText(refView.phaseTexts) == 1, "phase lines: P1 at 0:00 gets no line")
end
print("ok phase lines")

do
  refView:SetData({ reference = nekzali }, "ref:x", overlay)
  refView:Refresh()
  local b, l, p, t, made = #refView.bars, #refView.leads, #refView.phaseLines, #refView.pullTicks, textures
  for _ = 1, 3 do refView:Refresh() end
  assert(#refView.bars == b and #refView.leads == l and #refView.phaseLines == p and #refView.pullTicks == t, "pool reuse: pools keep their size")
  assert(textures == made, "pool reuse: no new textures")
end
print("ok pool reuse")

do
  local said = {}
  GameTooltip = setmetatable({}, { __index = function(_, k) return function(_, a) said[#said + 1] = k .. ":" .. tostring(a) end end })
  local function tipFor(label, t)
    for _, b in ipairs(refView.icons) do
      if b:IsShown() and b.lane.label == label and b.mark.t == t then
        for i = #said, 1, -1 do said[i] = nil end
        b.OnEnter(b)
        return table.concat(said, "|", 2) -- after SetOwner
      end
    end
    return "no icon"
  end
  refView:SetData({ reference = nekzali }, "ref:x")
  local tip = tipFor("Soulcoil Rite", 2)
  assert(tip == "SetText:Soulcoil Rite|AddLine:Planned at 0:02|AddLine:Lasts 45s|AddLine:Raid damage: raid-wide damage, unavoidable|Show:nil", "reference tooltip: name, planned, lasts, type: " .. tip)
  tip = tipFor("Possession Barrage", 36)
  assert(tip == "SetText:Possession Barrage|AddLine:Planned at 0:36|AddLine:Cast starts 7s before|AddLine:Fall-off: damage that drops the farther you stand|Show:nil", "reference tooltip: lead, type: " .. tip)
  local given = { boss = "G", length = 60, phases = {}, rows = { { name = "X", spellID = 4242, casts = { { t = 10 } } } } }
  refView:SetData({ reference = given }, "ref:g")
  tip = tipFor("X", 10)
  assert(tip == "SetSpellByID:4242|AddLine:Planned at 0:10|Show:nil", "reference tooltip: spell id uses SetSpellByID: " .. tip)
  GameTooltip = mock("GameTooltip")
end
print("ok reference tooltip")

do
  local said = {}
  GameTooltip = setmetatable({}, { __index = function(_, k)
    if k == "SetSpellByID" then return function() error("unknown spell") end end
    return function(_, a, r, g, b) said[#said + 1] = k .. ":" .. tostring(a) .. (k == "SetText" and (":" .. tostring(r) .. "," .. tostring(g) .. "," .. tostring(b)) or "") end
  end })
  local given = { boss = "G", length = 60, phases = {}, rows = { { name = "Xylo", spellID = 4242, casts = { { t = 10 } } } } }
  refView:SetData({ reference = given }, "ref:g")
  local tip
  for _, b in ipairs(refView.icons) do
    if b:IsShown() and b.lane.label == "Xylo" and b.mark.t == 10 then
      for i = #said, 1, -1 do said[i] = nil end
      local ok, err = pcall(b.OnEnter, b)
      assert(ok, "tooltip survives SetSpellByID error: " .. tostring(err))
      tip = table.concat(said, "|", 2)
    end
  end
  assert(tip == "SetText:Xylo:1,0.82,0|AddLine:Planned at 0:10|Show:nil", "tooltip survives SetSpellByID error: " .. tostring(tip))
  GameTooltip = mock("GameTooltip")
end
print("ok tooltip survives SetSpellByID error")

do
  -- the Journal's text: asked with the view's boss and difficulty group, shown under the cast's lines
  local said, asked = {}, {}
  GameTooltip = setmetatable({}, { __index = function(_, k) return function(_, a) said[#said + 1] = k .. ":" .. tostring(a) end end })
  CRT.TimelineJournal.AbilitySection = function(_, enc, group, spellID, name, sectionID)
    asked[#asked + 1] = tostring(enc) .. "/" .. tostring(group) .. "/" .. tostring(spellID) .. "/" .. tostring(name) .. "/" .. tostring(sectionID)
    return { description = "Journal words", tags = {} }, 16
  end
  function GetDifficultyInfo(id) return id == 16 and "Mythic" or nil end
  local given = { boss = "G", encounterID = 3001, length = 60, phases = {}, rows = { { name = "Xylo", spellID = 4242, sectionID = 77, types = { "soak" }, casts = { { t = 10 } } } } }
  refView:SetData({ reference = given }, "ref:g", nil, "G", "mythic")
  refView:Refresh()
  local icon, label
  for _, b in ipairs(refView.icons) do if b:IsShown() and b.lane.label == "Xylo" then icon = b end end
  for _, l in ipairs(refView.labels) do if l:IsShown() and l.lane and l.lane.label == "Xylo" then label = l end end
  icon.OnEnter(icon)
  local tip = table.concat(said, "|", 2)
  assert(asked[1] == "3001/mythic/4242/Xylo/77", "Journal asked for the view's boss, group, spell, name and section: " .. tostring(asked[1]))
  assert(tip == "SetSpellByID:4242|AddLine:Planned at 0:10|AddLine:Encounter Journal (Mythic)|AddLine:Journal words|AddLine:Soak: stack to share the damage|Show:nil", "icon tooltip with the Journal: " .. tip)
  for i = #said, 1, -1 do said[i] = nil end
  label.OnEnter(label)
  tip = table.concat(said, "|", 2)
  assert(tip == "SetSpellByID:4242|AddLine:Encounter Journal (Mythic)|AddLine:Journal words|AddLine:Soak: stack to share the damage|Show:nil", "row name tooltip, the same without the cast's lines: " .. tip)
  CRT.TimelineJournal.AbilitySection = nil
  GetDifficultyInfo = nil
  GameTooltip = mock("GameTooltip")
end
print("ok ability tooltip with the Journal's text on icons and rows")

do
  local said = {}
  GameTooltip = setmetatable({}, { __index = function(_, k) return function(_, a) said[#said + 1] = k .. ":" .. tostring(a) end end })
  S.overlayOn = false
  refView:SetData({ reference = nekzali }, "ref:x", overlay)
  local tip
  for _, b in ipairs(refView.icons) do
    if b:IsShown() and b.mark.death and b.mark.t == 30 then b.OnEnter(b) tip = table.concat(said, "|") end
  end
  assert(tip and tip:find("AddLine:Pull 2", 1, true), "overlay death tooltip names its pull with overlayOn off: " .. tostring(tip))
  for i = #said, 1, -1 do said[i] = nil end
  local pv = View.Create(mock("Frame"))
  pv:SetData(pull, 3001)
  for _, b in ipairs(pv.icons) do
    if b:IsShown() and b.mark.death then b.OnEnter(b) end
  end
  assert(not table.concat(said, "|"):find("AddLine:Pull", 1, true), "a recorded pull's own deaths name no pull with overlayOn off")
  GameTooltip = mock("GameTooltip")
end
print("ok overlay death tooltip names its pull")

do
  local v = View.Create(mock("Frame"))
  v:SetData(pull, 3001)
  assert(v:CastCount() == 2, "old SetData still works: cast count")
  assert(v:Extra().length == 200 and v.trackW == 200 * 600 / S.span, "old SetData still works: width from pull length")
  local icons = 0
  for _, b in ipairs(v.icons) do if b:IsShown() then icons = icons + 1 end end
  assert(icons == 3, "old SetData still works: 3 icons, got " .. icons)
  assert(shown(v.pullTicks) == 0, "old SetData still works: no ticks")
end
print("ok old SetData still works")

do
  local R = CRT.TimelineReference
  local typed = assert(R.Parse("Boss: T\\nA (type mythic soak spread): 0:10+20\\nB (type raid): 0:30\\nC: 0:40"), "types: parses")
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = typed }, "ref:t")
  local la, lb, lc = v.labels[2], v.labels[3], v.labels[4]
  assert(la.lane.label == "A" and lb.lane.label == "B" and lc.lane.label == "C", "types: lanes in order")
  local function same(c, want) return c and math.abs(c[1] - want[1]) < 0.01 and math.abs(c[2] - want[2]) < 0.01 and math.abs(c[3] - want[3]) < 0.01 end
  assert(same(la.stripe.color, R.TYPES.mythic.color) and math.abs(la.stripe.color[4] - 0.08) < 0.001 and la.stripe:IsShown(), "types: row tinted 8% in the first type's color")
  assert(la.dots[1]:IsShown() and la.dots[2]:IsShown() and not la.dots[3]:IsShown(), "types: one dot per extra type")
  assert(same(la.dots[1].vcolor, R.TYPES.spread.color) and same(la.dots[2].vcolor, R.TYPES.soak.color), "types: dots in reading order, last rightmost")
  assert(not lb.dots[1]:IsShown() and same(lb.stripe.color, R.TYPES.raid.color), "types: single type, no dots")
  assert(lc.stripe.color[4] == 0.04 and not lc.dots[1]:IsShown(), "types: untyped row keeps the plain stripe")
  assert(v.bars[1].h == 18, "types: bars are 18 px, got " .. tostring(v.bars[1].h))
  print("ok row tint, type dots and taller bars")
  -- five types: the dots are types 2, 3 and 4, in reading order, the leftmost being type 2
  local five = assert(R.Parse("Boss: T\\nA (type raid spread soak mythic dodge): 0:10\\nB (type raid): 0:20"), "dots: parses")
  local v5 = View.Create(mock("Frame"))
  v5:SetData({ reference = five }, "ref:t")
  local a5 = v5.labels[2]
  assert(a5.dots[1]:IsShown() and a5.dots[2]:IsShown() and a5.dots[3]:IsShown(), "dots: three shown for five types")
  assert(same(a5.dots[3].vcolor, R.TYPES.spread.color) and same(a5.dots[2].vcolor, R.TYPES.soak.color) and same(a5.dots[1].vcolor, R.TYPES.mythic.color),
    "dots: types 2, 3, 4 left to right")
  print("ok a lane with five types shows dots for types 2, 3 and 4")
  local said = {}
  GameTooltip = setmetatable({}, { __index = function(_, k) return function(_, a) said[#said + 1] = k .. ":" .. tostring(a) end end })
  local icon
  for _, b in ipairs(v.icons) do if b:IsShown() and b.lane == la.lane then icon = b end end
  icon.OnEnter(icon)
  local all = table.concat(said, "|")
  assert(all:find("AddLine:Mythic: Mythic only", 1, true) and all:find("AddLine:Soak: stack to share the damage", 1, true) and all:find("AddLine:Spread: spread out or get away", 1, true), "types: icon tooltip lists every type: " .. all)
  said = {}
  la.OnEnter(la)
  all = table.concat(said, "|")
  assert(all:find("SetText:A", 1, true) and all:find("AddLine:Soak", 1, true), "types: label tooltip lists the types: " .. all)
  GameTooltip = mock("GameTooltip")
  print("ok type tooltips")
end

do
  local ref = assert(CRT.TimelineReference.Parse(CRT.TimelineDB.references[1]), "phase drag: a fresh Nek'zali")
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, "ref:x")
  local length = v:Extra().length
  local function at(t) cursor = 100 + View.TimeToX(t, length, v.trackW) end
  local moved
  v.onPhaseMoved = function(i, t) moved = { i, t } end
  local before = 0
  for _, lane in ipairs(v.lanes) do if lane.kind == "reference" then before = before + #lane.marks end end

  -- a plain left press on the line does nothing to it
  at(197)
  v.hscroll.OnMouseDown(v.hscroll, "LeftButton")
  assert(v.phaseDrag == nil, "phase drag: a press without Shift doesn't pick the line up")
  v.hscroll.OnMouseUp(v.hscroll, "LeftButton")

  -- Shift + drag 10 seconds earlier
  IsShiftKeyDown = function() return true end
  v.hscroll.OnMouseDown(v.hscroll, "LeftButton")
  assert(v.phaseDrag and v.phaseDrag.index == 1, "phase drag: Shift + press on the line picks it up")
  local original, from = ref, ref.phases[1].t
  ref = v.pull.reference -- the drag works on the view's own copy of the phases
  assert(ref ~= original and ref.phases ~= original.phases and ref.rows == original.rows, "phase drag: the view copies the phases, not the rows")
  at(187)
  v.frame.OnUpdate(v.frame)
  assert(ref.phases[1].t == 187, "phase drag: the line follows the cursor: " .. tostring(ref.phases[1].t))
  assert(tostring(v.hover:GetText()):find("P1.5: 3:07 (planned 3:17)", 1, true), "phase drag: the label shows the new and planned times: " .. tostring(v.hover:GetText()))
  local after = 0
  for _, lane in ipairs(v.lanes) do if lane.kind == "reference" then after = after + #lane.marks end end
  assert(after < before and v:Extra().masked == before - after, "phase drag: casts past the moved line hide while it drags (" .. before .. " -> " .. after .. ")")
  local gold = false
  for _, line in ipairs(v.phaseLines) do if line:IsShown() and line.color and line.color[2] > 0.8 then gold = true end end
  assert(gold, "phase drag: the dragged line is gold")
  at(1)
  v.frame.OnUpdate(v.frame)
  assert(ref.phases[1].t == 5, "phase drag: kept at least 5 seconds after the pull: " .. ref.phases[1].t)
  at(400)
  v.frame.OnUpdate(v.frame)
  assert(ref.phases[1].t == ref.phases[2].t - 5, "phase drag: kept 5 seconds before the next line: " .. ref.phases[1].t)
  at(187)
  v.frame.OnUpdate(v.frame)
  v.hscroll.OnMouseUp(v.hscroll, "LeftButton")
  assert(moved and moved[1] == 1 and moved[2] == 187 and v.phaseDrag == nil, "phase drag: letting go saves the move")
  assert(original.phases[1].t == from, "phase drag: the parsed reference itself never changes")
  IsShiftKeyDown = function() return false end
  print("ok shift-drag moves a phase line and hides casts past it")

  -- right-click on the moved line puts it back; on an unmoved line the line is left alone
  moved = nil
  at(187)
  v.hscroll.OnMouseDown(v.hscroll, "RightButton")
  v.hscroll.OnMouseUp(v.hscroll, "RightButton")
  assert(moved and moved[1] == 1 and moved[2] == 197, "phase reset: right-click on a moved line puts it back at its planned time")
  moved = nil
  at(ref.phases[2].t)
  local opened = false
  local savedMenu = MenuUtil
  MenuUtil = { CreateContextMenu = function() opened = true end }
  v.hscroll.OnMouseDown(v.hscroll, "RightButton")
  v.hscroll.OnMouseUp(v.hscroll, "RightButton")
  MenuUtil = savedMenu
  assert(moved == nil and opened, "phase reset: an unmoved line isn't reset, and the track menu opens as usual")
  print("ok right-click puts a moved phase line back")

  -- developer builds with /crt dev open: right-click a mechanic's name for the ability menu; players get none
  local lbl
  for _, l in ipairs(v.labels) do if rawget(l, "lane") and CRT.Timeline.Ignorable(l.lane) then lbl = l break end end
  assert(lbl and lbl.OnClick, "label menu: a mechanic's name takes a right-click")
  local filled, opens = nil, 0
  local savedUI, savedFill = CRT.UI, CRT.TimelineAbilityMenu
  CRT.TimelineAbilityMenu = { Fill = function(root, boss, row, hideName) filled = { boss = boss, row = row, hide = hideName } end }
  MenuUtil = { CreateContextMenu = function(owner, fn) opens = opens + 1 fn(owner, {}) end }
  CRT.UI = { pages = {} }
  lbl.OnClick(lbl, "RightButton")
  assert(opens == 0, "label menu: none for players (no Development page)")
  CRT.UI.pages.dev = { hidden = false }
  lbl.OnClick(lbl, "LeftButton")
  assert(opens == 0, "label menu: only the right button")
  lbl.OnClick(lbl, "RightButton")
  assert(opens == 1 and filled and filled.boss == v.encounterID and filled.hide == CRT.Timeline.IgnoreName(lbl.lane) and filled.row.name == filled.hide, "label menu: the ability menu with Hide, in dev")
  CRT.UI, CRT.TimelineAbilityMenu, MenuUtil = savedUI, savedFill, savedMenu
  print("ok label menu: right-click a row name in dev only")
end

do
  local function refRows(v)
    local n = 0
    for _, lane in ipairs(v.lanes) do if lane.kind == "reference" then n = n + 1 end end
    return n
  end
  local ref = assert(CRT.TimelineReference.Parse(CRT.TimelineDB.references[1]), "group: a fresh Nek'zali")
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, "ref:x")
  local all = refRows(v)
  v:SetData({ reference = ref }, "ref:x", nil, nil, "nh")
  v:Refresh()
  assert(all == 11 and refRows(v) == 9, "view keeps the group across refresh: " .. all .. " then " .. refRows(v))
  v:SetData({ reference = ref }, "ref:x", nil, nil, "mythic")
  v:Refresh()
  assert(refRows(v) == 11, "view keeps the group across refresh: mythic shows all")
end
print("ok view keeps the group across refresh")
do
  local R = CRT.TimelineReference
  local close = R.Parse("Boss: C\\nPhase: E1 1:00\\nPhase: E2 1:05\\nPhase: 3:00\\nOrder: E1, E2 = Gebbo, Nama\\nToss (part Gebbo): 1:02\\nThud (part Nama): 1:07\\nShared: 0:30")
  local v = View.Create(mock("Frame"))
  v:SetOrder({ "Nama", "Gebbo" })
  v:SetData({ reference = close }, "ref:c")
  local t1, t2 = v.phaseTexts[1]:GetText(), v.phaseTexts[2]:GetText()
  assert(t1:find("E1", 1, true) and t1:find("Nama", 1, true) and t2:find("Gebbo", 1, true), "phase labels name the part now in the window: " .. t1)
  assert(close.phases[1].label == "E1", "the reference's own label is untouched")
  assert(v.axisH == 44, "two close labels stagger over two rows, the axis grows: " .. tostring(v.axisH))
  v:SetOrder(nil)
  v:Refresh()
  assert(v.phaseTexts[1]:GetText():find("Gebbo", 1, true), "no chosen order: the written order")
  local far = R.Parse("Boss: F\\nLength: 6:00\\nPhase: P2 1:00\\nPhase: P3 5:00\\nA: 0:30")
  v:SetData({ reference = far }, "ref:f")
  assert(v.axisH == 32 and v.phaseTexts[1]:GetText() == "P2", "far apart labels share one row: " .. tostring(v.axisH))
  v:SetData({ casts = {}, deaths = {}, length = 60, id = 1 }, 3001)
  assert(v.axisH == 20, "no phases: the axis keeps its height")
end
print("ok phase labels stagger and name the chosen part")
do
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = nekzali }, 3470)
  local target = v.lanes[#v.lanes]
  assert(v:Highlight(nil, target.label:upper()) == true and v.highlightRow == #v.lanes and v.highlightTex:IsShown(), "highlight by name lights that row")
  local c = v.highlightTex.color
  assert(c and c[1] > 0.9 and c[2] > 0.9 and c[3] > 0.8 and c[4] < 0.5, "a foamy off-white band")
  assert(v:Highlight(123456789, "No such ability") == false and not v.highlightTex:IsShown(), "no such row: nothing lit")
  v:Highlight(nil, v.lanes[2].label)
  v:Highlight(nil, target.label)
  assert(v.highlightRow == #v.lanes, "a second highlight moves the light")
  v:ClearHighlight()
  assert(v.highlight == nil and not v.highlightTex:IsShown(), "clear highlight puts the light out")
  v:Highlight(nil, target.label)
  v:SetData({ reference = nekzali }, 3470)
  assert(v.highlightRow == nil and not v.highlightTex:IsShown(), "new data clears the light")
end
print("ok highlight a row")
do
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = nekzali }, 3470)
  assert(not v.playLine or not v.playLine:IsShown(), "no playhead to begin with")
  local length = v.drawLength
  v:SetPlayhead(60)
  local x = View.TimeToX(60, length, v.trackW)
  assert(v.playLine:IsShown() and v.playLine.pt and math.abs(v.playLine.pt[4] - (x - 1)) < 0.01, "the line at the time")
  assert(v.playTag:IsShown() and v.playTag.text.text == View.Format(60), "the time on its tag: " .. tostring(v.playTag.text.text))
  v:Refresh()
  assert(v.playLine:IsShown(), "kept through a redraw")
  -- following: a line past the right edge scrolls it to a third of the way across
  v:ScrollTo(0)
  local far = math.min(length, 500)
  local fx = View.TimeToX(far, length, v.trackW)
  v:SetPlayhead(far, false)
  assert(v.hscroll:GetHorizontalScroll() == 0, "paused: no scrolling")
  v:SetPlayhead(far, true)
  local want = math.max(0, math.min(v.trackW - v:VisibleWidth(), fx - v:VisibleWidth() / 3))
  assert(fx <= v:VisibleWidth() or math.abs(v.hscroll:GetHorizontalScroll() - want) < 0.01, "playing: the line scrolled back into view")
  v:SetPlayhead(nil)
  assert(not v.playLine:IsShown() and not v.playTag:IsShown(), "nil hides it")
  v:SetPlayhead(60)
  v:SetData(nil, nil)
  assert(not v.playLine:IsShown(), "no fight shown: no line")
end
print("ok the rehearsal playhead")
do
  -- Ctrl+Z and Ctrl+Y go to CRT_Modules/Timeline/Undo.lua and are kept; other keys pass through
  local calls, watched = {}, {}
  CRT.TimelineUndo = { Undo = function() calls[#calls + 1] = "undo" end, Redo = function() calls[#calls + 1] = "redo" end,
    Watch = function(_, f) watched[#watched + 1] = f end }
  local v = View.Create(mock("Frame"))
  assert(watched[1] == v.frame, "the view registers with the undo history")
  local kb, prop
  rawset(v.frame, "EnableKeyboard", function(_, on) kb = on end)
  rawset(v.frame, "SetPropagateKeyboardInput", function(_, on) prop = on end)
  v.frame.OnShow(v.frame)
  assert(kb == true, "keys taken while it shows")
  local ctrl, shift = false, false
  IsControlKeyDown = function() return ctrl end
  IsShiftKeyDown = function() return shift end
  v.frame.OnKeyDown(v.frame, "Z")
  assert(#calls == 0 and prop == true, "plain Z passes through")
  ctrl = true
  v.frame.OnKeyDown(v.frame, "Z")
  assert(calls[1] == "undo" and prop == false, "Ctrl+Z undoes, kept from the game")
  v.frame.OnKeyDown(v.frame, "Y")
  shift = true
  v.frame.OnKeyDown(v.frame, "Z")
  assert(calls[2] == "redo" and calls[3] == "redo", "Ctrl+Y and Ctrl+Shift+Z redo")
  ctrl, shift = false, false
  -- a kept key passes keys on again next frame, and combat lets go of the keyboard altogether
  local timers = {}
  local realCombat, realTimer = InCombatLockdown, C_Timer
  C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
  ctrl = true
  v.frame.OnKeyDown(v.frame, "Z")
  ctrl = false
  assert(prop == false and #timers == 1, "kept for that press")
  timers[1]()
  assert(prop == true, "keys pass on again the next frame")
  ctrl = true
  v.frame.OnKeyDown(v.frame, "Z")
  ctrl = false
  local inCombat = true
  InCombatLockdown = function() return inCombat end
  v.frame.OnEvent(v.frame, "PLAYER_REGEN_DISABLED")
  assert(kb == false, "combat: the keyboard let go, so no key is held from the game")
  timers[#timers]()
  assert(prop == false, "the next-frame reset is skipped in combat (not allowed there)")
  inCombat = false
  v.frame.OnEvent(v.frame, "PLAYER_REGEN_ENABLED")
  assert(kb == true and prop == true, "after combat: taken again, passing keys on")
  InCombatLockdown, C_Timer = realCombat, realTimer
  v.frame.OnHide(v.frame)
  assert(kb == false, "hidden: keys let go")
  IsControlKeyDown, IsShiftKeyDown, CRT.TimelineUndo = nil, function() return false end, nil
end
print("ok ctrl+z and ctrl+y on the timeline")
do
  -- ignored mechanics: personal, by name, out of the lanes into their own list under them
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = nekzali }, 3470)
  local first
  for _, lane in ipairs(v.lanes) do if T.Ignorable(lane) then first = lane break end end
  assert(first, "a mechanic lane to ignore")
  local count = #v.lanes
  local l
  for _, x in ipairs(v.labels) do if x.lane == first then l = x end end
  assert(l.check:IsShown(), "a mechanic has its show tick")
  l.check:SetChecked(false)
  rawset(l.check, "GetChecked", function() return false end)
  l.check.OnClick(l.check)
  rawset(l.check, "GetChecked", nil)
  assert(T:Ignored(3470, first.label) and T:Ignored(3470, first.label:upper()), "saved by name, any case")
  v:Refresh()
  assert(#v.lanes == count - 1 and #v.ignoredLanes == 1 and v.ignoredLanes[1].label == first.label, "out of the lanes, into the ignored list")
  assert(v.ignoredHead:IsShown() and v.ignoredHead.text.text == "Ignored mechanics (1)", "the list's heading counts it")
  local notIn = true
  for _, lane in ipairs(v.lanes) do if lane.label == first.label then notIn = false end end
  assert(notIn, "not drawn on the track")
  T:Set("ignoredOpen", true)
  v:Refresh()
  local row = v.labels[#v.lanes + 1]
  assert(row.lane.label == first.label and row:IsShown() and row.check:IsShown(), "opened: listed with its tick")
  T:SetIgnored(3470, first.label, false)
  v:Refresh()
  assert(#v.lanes == count and #v.ignoredLanes == 0 and not v.ignoredHead:IsShown(), "ticked again: back in the lanes, no list")
  assert(T:Settings().ignored == nil or T:Settings().ignored["3470"] == nil, "nothing left saved")
  for _, lane in ipairs(v.lanes) do
    if lane.kind == "personal" or lane.kind == "notes" or lane.kind == "deaths" then assert(not T.Ignorable(lane), "notes and deaths can't be ignored") end
  end
  T:Set("ignoredOpen", nil)
end
print("ok ignored mechanics")
do
  -- Auto axis labels follow the zoom: 1000 px across the track
  local function step(visible) local t = View.Ticks(600, "auto", 1000 * 600 / visible) return t[2] - t[1] end
  assert(step(60) == 5, "zoomed all the way in: every 5 s, got " .. step(60))
  assert(step(150) == 15 or step(150) == 10, "a little out: 10 or 15 s, got " .. step(150))
  assert(step(300) == 30, "5 minutes: every 30 s, got " .. step(300))
  assert(step(600) == 60, "zoomed out: every minute, got " .. step(600))
  assert(View.Ticks(600, nil, 1000)[2] == 60, "no setting is Auto")
  -- a fixed choice is still kept, doubled only when too tight
  assert(View.Ticks(600, 30, 10000)[2] == 30 and View.Ticks(600, 5, 1000)[2] == 40, "fixed: 30 kept; 5 doubled to 40 at 1.7 px/s")
end
print("ok auto axis labels follow the zoom")
do
  -- your labels for Journal abilities: a row with no casts, a type, a name; ignoring goes by the own name
  local realRows = CRT.TimelineJournal.Rows
  CRT.TimelineJournal.Rows = function() return { { name = "Latent Cultist", spellID = 1287198, icon = 1 } } end
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = nekzali }, 3470)
  local count = #v.lanes
  T:SetAbility(3470, 1287198, "row", true)
  v:Refresh()
  local row
  for _, lane in ipairs(v.lanes) do if lane.kind == "journal" then row = lane end end
  assert(row and row.label == "Latent Cultist" and row.spellID == 1287198 and #row.marks == 0 and #v.lanes == count + 1, "a row of its own, no casts")
  T:SetAbility(3470, 1287198, "type", "soak")
  T:SetAbility(3470, 1287198, "name", "Adds")
  v:Refresh()
  for _, lane in ipairs(v.lanes) do if lane.kind == "journal" then row = lane end end
  assert(row.label == "Adds" and row.baseLabel == "Latent Cultist" and row.types[1] == "soak" and row.color == CRT.TimelineReference.TYPES.soak.color, "named and typed")
  T:SetIgnored(3470, T.IgnoreName(row), true)
  v:Refresh()
  assert(#v.ignoredLanes == 1 and v.ignoredLanes[1].label == "Adds" and T:Ignored(3470, "Latent Cultist"), "ignored by its own name")
  T:SetIgnored(3470, "Latent Cultist", false)
  T:SetAbility(3470, 1287198, "row", nil) T:SetAbility(3470, 1287198, "type", nil) T:SetAbility(3470, 1287198, "name", nil)
  v:Refresh()
  assert(#v.lanes == count and (T:Settings().abilities == nil or T:Settings().abilities["3470"] == nil), "all cleared, nothing left saved")
  CRT.TimelineJournal.Rows = realRows
end
print("ok journal ability labels")
do
  -- the Journal's icons on a row: from the reference's tags, the type dots left of them; yours replace them
  local R = CRT.TimelineReference
  local ref = assert(R.Parse("Boss: T\\nRend [spell 777] (type dispel heroic, tags magic healer): 0:10\\nPlain: 0:20"), "tags: parses")
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 9001)
  local rend, plain
  for i, lane in ipairs(v.lanes) do
    if lane.label == "Rend" then rend = v.labels[i] elseif lane.label == "Plain" then plain = v.labels[i] end
  end
  assert(rend and rend.lane.tags[1] == "magic" and rend.lane.tags[2] == "healer", "the lane keeps the tags")
  assert(rend.tagIcons[1]:IsShown() and rend.tagIcons[2]:IsShown() and not rend.tagIcons[3]:IsShown(), "two icons shown")
  assert(rend.dots[1]:IsShown() and rend.dots[1].pt[4] < -4 - 2 * 15, "the type dot moved left of the icons: " .. tostring(rend.dots[1].pt[4]))
  assert(plain and not plain.tagIcons[1]:IsShown(), "no tags, no icons")
  -- your own tags from the Advanced tab's menu replace them
  T:SetAbility(9001, 777, "tags", { "tank" })
  v:Refresh()
  for i, lane in ipairs(v.lanes) do if lane.label == "Rend" then rend = v.labels[i] end end
  assert(rend.lane.tags[1] == "tank" and #rend.lane.tags == 1 and rend.tagIcons[1]:IsShown() and not rend.tagIcons[2]:IsShown(), "yours in place of the Journal's")
  T:SetAbility(9001, 777, "tags", nil)
end
print("ok journal icons on the rows")

do
  -- Drag to zoom: a left drag on the time axis, or Ctrl + left drag on the track, zooms to that range.
  -- The mock track starts 100 px from the screen's left, 600 px shown; a 600 s fight at 300 s across is 2 px a second.
  local long = { id = 20, encounterID = 3001, length = 600, casts = { { t = 10, spellID = 5001 }, { t = 300, spellID = 5001 } }, deaths = {} }
  local v = View.Create(mock("Frame"))
  local told = 0
  v.onSpan = function() told = told + 1 end
  v:SetData(long, 3001)
  local function reset(span) v:SetSpan(span or 300) v:ScrollTo(0) end
  local function at(t) cursor = 100 + View.TimeToX(t, 600, v.trackW) - v.hscroll:GetHorizontalScroll() end
  local function scrolled() return v.hscroll:GetHorizontalScroll() end
  local function clampSpanOf(s) return math.max(60, math.min(600, math.floor(s + 0.5))) end
  local axis = v.axisScroll
  reset()
  assert(rawget(axis, "OnMouseDown") and rawget(axis, "OnMouseUp"), "drag zoom: the axis takes the mouse")
  at(120)
  axis.OnMouseDown(axis, "LeftButton")
  at(210)
  v.frame.OnUpdate(v.frame)
  local band = v.zoomBand
  assert(band and band.fill:IsShown() and band.tag:IsShown(), "drag zoom: a band shows while dragging")
  assert(band.tag.text:GetText() == "2:00 \\226\\128\\147 3:30 (1:30)", "drag zoom: the band's times: " .. tostring(band.tag.text:GetText()))
  assert(band.fill.pt and band.fill.pt[4] == 240 and band.fill.w == 180, "drag zoom: the band spans the range on the track")
  local made = textures
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == 90 and scrolled() == 800 and v.axisScroll:GetHorizontalScroll() == 800, "drag zoom: 2:00-3:30 fills the track: span " .. S.span .. ", scroll " .. scrolled())
  assert(not band.fill:IsShown() and not band.tag:IsShown() and v.zoomSel == nil, "drag zoom: the band goes on release")
  assert(told == 1, "drag zoom: the page is told the span changed")
  print("ok drag on the time axis zooms to the range")

  -- the same right to left, and again: the band's parts are made once
  reset()
  at(210)
  axis.OnMouseDown(axis, "LeftButton")
  at(120)
  v.frame.OnUpdate(v.frame)
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == 90 and scrolled() == 800, "drag zoom: dragged right to left the same")
  assert(textures == made, "drag zoom: no new textures for a second band")
  print("ok drag right to left zooms the same, and the band is reused")

  -- Ctrl + drag on the track does the same; without Ctrl a left drag on the track still selects nothing
  reset()
  at(120)
  v.hscroll.OnMouseDown(v.hscroll, "LeftButton")
  assert(v.zoomSel == nil, "track: a plain left press starts no selection")
  at(210)
  v.frame.OnUpdate(v.frame)
  v.hscroll.OnMouseUp(v.hscroll, "LeftButton")
  assert(S.span == 300 and scrolled() == 0, "track: a plain left drag changes nothing")
  local ctrl = true
  IsControlKeyDown = function() return ctrl end
  v.clickAt = nil
  at(120)
  v.hscroll.OnMouseDown(v.hscroll, "LeftButton")
  at(210)
  v.frame.OnUpdate(v.frame)
  assert(band.fill:IsShown(), "track: Ctrl + drag shows the band")
  v.hscroll.OnMouseUp(v.hscroll, "LeftButton")
  assert(S.span == 90 and scrolled() == 800, "track: Ctrl + drag zooms to the range: span " .. S.span .. ", scroll " .. scrolled())
  assert(v.clickAt == nil, "track: the release is the selection's, not a click toward a double-click")
  -- a Ctrl + click that doesn't move is still a plain click on the track
  reset()
  at(120)
  v.hscroll.OnMouseDown(v.hscroll, "LeftButton")
  v.hscroll.OnMouseUp(v.hscroll, "LeftButton")
  assert(S.span == 300 and v.clickAt ~= nil, "track: Ctrl + click without a drag is a plain click")
  v.clickAt = nil
  -- Ctrl + drag starting on a cast icon
  reset()
  local icon
  for _, b in ipairs(v.icons) do if b:IsShown() and b.mark and b.mark.t == 10 then icon = b end end
  assert(icon, "track: a cast icon to start on")
  at(10)
  icon.OnMouseDown(icon, "LeftButton")
  at(100)
  v.frame.OnUpdate(v.frame)
  icon.OnMouseUp(icon, "LeftButton")
  assert(S.span == 90 and math.abs(scrolled() - 10 * 600 / 90) < 0.01, "track: Ctrl + drag from a cast icon zooms too: " .. S.span)
  ctrl = false
  print("ok ctrl+drag on the track zooms to the range")

  -- tiny drags are ignored: moved under the start distance, back under 2 px, or under a second
  reset()
  at(120)
  axis.OnMouseDown(axis, "LeftButton")
  cursor = cursor + 2
  v.frame.OnUpdate(v.frame)
  assert(not band.fill:IsShown(), "tiny: no band before the drag starts")
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == 300 and scrolled() == 0, "tiny: a click on the axis changes nothing")
  at(120)
  axis.OnMouseDown(axis, "LeftButton")
  cursor = cursor + 10
  v.frame.OnUpdate(v.frame)
  cursor = cursor - 9
  v.frame.OnUpdate(v.frame)
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == 300 and scrolled() == 0, "tiny: a drag back under 2 px is ignored")
  reset(60) -- 10 px a second
  at(30)
  axis.OnMouseDown(axis, "LeftButton")
  cursor = cursor + 8
  v.frame.OnUpdate(v.frame)
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == 60 and scrolled() == 0, "tiny: under a second is ignored")
  print("ok tiny drags are ignored")

  -- a range under a minute zooms to a minute, centred on it
  reset()
  at(100)
  axis.OnMouseDown(axis, "LeftButton")
  at(130)
  v.frame.OnUpdate(v.frame)
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == 60 and scrolled() == 850, "short range: a minute centred on 1:40-2:10: span " .. S.span .. ", scroll " .. scrolled())
  -- one near the start keeps to 0
  reset()
  at(5)
  axis.OnMouseDown(axis, "LeftButton")
  at(20)
  v.frame.OnUpdate(v.frame)
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == 60 and scrolled() == 0, "short range at the start: scrolled to 0")
  print("ok ranges under a minute clamp and centre")

  -- past the track's right edge the track scrolls along while selecting
  reset()
  at(120)
  axis.OnMouseDown(axis, "LeftButton")
  cursor = 100 + 600 + 50
  v.frame.OnUpdate(v.frame)
  local moved = scrolled()
  assert(moved > 0, "edge: the track scrolls past the right edge")
  local to = (moved + 650) / 2
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == math.floor(to - 120 + 0.5) and math.abs(scrolled() - 120 * 600 / S.span) < 0.01, "edge: the range runs to where the cursor reached: " .. S.span)
  print("ok the track scrolls along past its edge")

  -- Escape cancels: kept from the game, the band gone, the release does nothing
  local prop
  rawset(v.frame, "SetPropagateKeyboardInput", function(_, on) prop = on end)
  v.frame.OnShow(v.frame)
  reset()
  at(120)
  axis.OnMouseDown(axis, "LeftButton")
  at(210)
  v.frame.OnUpdate(v.frame)
  v.frame.OnKeyDown(v.frame, "ESCAPE")
  assert(prop == false and not band.fill:IsShown(), "escape: the band goes, the key kept from the game")
  at(250)
  v.frame.OnUpdate(v.frame)
  assert(not band.fill:IsShown(), "escape: the band stays gone while the button is still held")
  axis.OnMouseUp(axis, "LeftButton")
  assert(S.span == 300 and scrolled() == 0 and v.zoomSel == nil, "escape: letting go after it zooms nothing")
  -- Escape with no selection running passes on, as before
  v.frame.OnKeyDown(v.frame, "ESCAPE")
  assert(prop == true, "escape: passes on with nothing to cancel")
  -- Ctrl + drag on the track, then Escape: the release is not a click either
  ctrl = true
  at(120)
  v.hscroll.OnMouseDown(v.hscroll, "LeftButton")
  at(210)
  v.frame.OnUpdate(v.frame)
  v.frame.OnKeyDown(v.frame, "ESCAPE")
  v.hscroll.OnMouseUp(v.hscroll, "LeftButton")
  assert(S.span == 300 and v.clickAt == nil, "escape: a cancelled Ctrl + drag is no click")
  ctrl = false
  -- hiding the view mid-drag drops it
  at(120)
  axis.OnMouseDown(axis, "LeftButton")
  at(210)
  v.frame.OnUpdate(v.frame)
  v.frame.OnHide(v.frame)
  assert(v.zoomSel == nil and not band.fill:IsShown(), "hidden: the selection is dropped")
  print("ok escape cancels a selection")

  -- Fit and a right-click on the axis show the whole fight again
  v:SetSpan(90) v:ScrollTo(800)
  told = 0
  v:Fit()
  assert(S.span == 600 and scrolled() == 0 and told == 1, "fit: the whole 10 minute fight")
  v:SetSpan(90) v:ScrollTo(800)
  at(200)
  axis.OnMouseDown(axis, "RightButton")
  axis.OnMouseUp(axis, "RightButton")
  assert(S.span == 600 and scrolled() == 0, "fit: a right-click on the axis does the same")
  v:SetSpan(90) v:ScrollTo(800)
  at(200)
  axis.OnMouseDown(axis, "RightButton")
  cursor = cursor + 30
  axis.OnMouseUp(axis, "RightButton")
  assert(S.span == 90, "fit: a right press that moves is no click")
  v:SetData(pull, 3001) -- 200 s
  v:Fit()
  assert(S.span == 200 and scrolled() == 0, "fit: a shorter fight fills the track: " .. S.span)
  v:SetData({ id = 21, encounterID = 3001, length = 900, casts = {}, deaths = {} }, 3001)
  v:Fit()
  assert(S.span == 600, "fit: a longer fight is kept to 10 minutes across")
  v:SetData({ id = 22, encounterID = 3001, length = 20, casts = {}, deaths = {} }, 3001)
  v:Fit()
  assert(S.span == 60, "fit: a fight under a minute shows a minute")
  v:SetData({ reference = nekzali }, "ref:x")
  v:SetSpan(90)
  v:Fit()
  assert(S.span == clampSpanOf(v:Extra().length) and scrolled() == 0, "fit: an ability timeline's length")
  print("ok fit and right-click on the axis show the whole fight")

  -- the rest still works: right-drag scrolls the track
  v:SetData(long, 3001)
  reset()
  v:ScrollTo(200)
  cursor = 400
  v.hscroll.OnMouseDown(v.hscroll, "RightButton")
  cursor = 350
  v.frame.OnUpdate(v.frame)
  v.hscroll.OnMouseUp(v.hscroll, "RightButton")
  assert(scrolled() == 250 and S.span == 300, "right-drag still scrolls")
  print("ok right-drag still scrolls next to drag zoom")

  -- the pop-out: the same view in a window of its own, narrower at its smallest
  local pv = View.Create(mock("Frame"))
  rawset(pv.axisScroll, "w", 760 - 16 - 166 - 24)
  pv:SetData(long, 3001)
  pv:SetSpan(300) pv:ScrollTo(0)
  local w = pv:VisibleWidth()
  cursor = 100 + View.TimeToX(120, 600, pv.trackW)
  pv.axisScroll.OnMouseDown(pv.axisScroll, "LeftButton")
  cursor = 100 + View.TimeToX(210, 600, pv.trackW)
  pv.frame.OnUpdate(pv.frame)
  pv.axisScroll.OnMouseUp(pv.axisScroll, "LeftButton")
  assert(S.span == 90 and math.abs(pv.hscroll:GetHorizontalScroll() - 120 * w / 90) < 0.01, "pop-out: the same drag zoom")
  pv:Fit()
  assert(S.span == 600 and pv.hscroll:GetHorizontalScroll() == 0, "pop-out: Fit the same")
  S.span = 300
  cursor = 400
  print("ok the pop-out view zooms the same")
end

-- A theme change: the parts made once are tinted through UI.Tint and repaint, and a shown view redraws
-- through UI:OnTheme. This UI stands in for CRT_Core/UI/Panel.lua's (run_themes.js tests the real one).
do
  local tints, hooks = {}, {}
  local savedUI = CRT.UI
  local function paint(t) local c = CRT.PALETTE[t[3]] t[1][t[2]](t[1], c[1], c[2], c[3], t[4] or 1) end
  CRT.UI = { Tint = function(r, m, k, a) local t = { r, m, k, a } tints[#tints + 1] = t paint(t) end,
    OnTheme = function(_, fn) hooks[#hooks + 1] = fn end }
  local v = View.Create(mock("Frame"))
  v:SetData(pull, 3001)
  v:Refresh()
  assert(#hooks >= 1, "a view registers UI:OnTheme")
  local base
  for _, t in ipairs(tints) do if t[2] == "SetColorTexture" and t[3] == "accent" and t[4] == nil then base = t[1] break end end
  assert(base and rawget(base, "color")[1] == CRT.PALETTE.accent[1], "the axis line is tinted from the theme")
  local was = { CRT.PALETTE.accent[1], CRT.PALETTE.accent[2], CRT.PALETTE.accent[3] }
  CRT.PALETTE.accent[1], CRT.PALETTE.accent[2], CRT.PALETTE.accent[3] = 0.5, 0.7, 0.85
  for _, t in ipairs(tints) do paint(t) end
  local redrew = false
  local real = v.Refresh
  rawset(v, "Refresh", function(self) redrew = true return real(self) end)
  for _, fn in ipairs(hooks) do fn() end
  local c = rawget(base, "color")
  assert(c[1] == 0.5 and c[2] == 0.7 and c[3] == 0.85, "the axis line takes the new theme's accent")
  assert(redrew, "a shown view redraws on a theme change")
  CRT.PALETTE.accent[1], CRT.PALETTE.accent[2], CRT.PALETTE.accent[3] = was[1], was[2], was[3]
  CRT.UI = savedUI
end
print("ok a theme change repaints the view")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
// the eight files given, then the shared ability tooltip beside View.lua
const files = process.argv.slice(2, 10).concat([path.join(path.dirname(process.argv[6]), 'AbilityTip.lua')]);
for (const p of files) {
  let src; try { src = fs.readFileSync(p, 'utf8'); } catch (e) { console.error('cannot read ' + p); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 9, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
