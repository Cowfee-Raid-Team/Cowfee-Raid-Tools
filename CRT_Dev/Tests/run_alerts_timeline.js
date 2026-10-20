// Timeline double-click to reminder editor, and /crt reminders.
// Usage: node run_alerts_timeline.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua CRT_Modules/Timeline/View.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Reminders.lua CRT_Core/Slash.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local dataSrc, dbSrc, refSrc, lanesSrc, viewSrc, rulesSrc, engineSrc, remSrc, slashSrc = ...
local buttons, textures = 0, 0
local function mock(kind)
  local m = { shown = true, kind = kind, children = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function() return mock("FontString") end end
    if k == "CreateTexture" then return function() textures = textures + 1 return mock("Texture") end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
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
  MOCHA = { caramel = { 0.78, 0.56, 0.36 }, latte = { 0.87, 0.73, 0.56 }, roast = { 0.165, 0.122, 0.098 }, cream = { 0.95, 0.90, 0.84 } },
  Groups = { ClassColor = function() return 1, 1, 1 end },
}
local hidden = {}
CRT.TimelineJournal = { ResolveID = function(_, k, r) if type(k) == "number" then return k end if r and type(r.encounterID) == "number" then return r.encounterID end end,
  Rows = function() return {} end,
  IsHidden = function(_, enc, id) return hidden[id] and true or false end,
}
assert(load(dataSrc, "CRT_Modules/Timeline/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(dbSrc, "CRT_Modules/Timeline/Database.lua"))("CowfeeRaidTools", CRT)
assert(load(refSrc, "CRT_Modules/Timeline/Reference.lua"))("CowfeeRaidTools", CRT)
assert(load(lanesSrc, "CRT_Modules/Timeline/Lanes.lua"))("CowfeeRaidTools", CRT)
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
local function wipe(t) for k in pairs(t) do t[k] = nil end return t end
CRT.db.alerts = { bars = {}, reminders = {}, phases = {}, overrides = {}, nextId = 1 }
function GetTime() return 100 end
function issecretvalue() return false end
function geterrorhandler() return function() end end
assert(load(viewSrc, "CRT_Modules/Timeline/View.lua"))("CowfeeRaidTools", CRT)
assert(load(rulesSrc, "CRT_Modules/Alerts/Rules.lua"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "CRT_Modules/Alerts/Engine.lua"))("CowfeeRaidTools", CRT)
assert(load(remSrc, "CRT_Modules/Alerts/Reminders.lua"))("CowfeeRaidTools", CRT)
local opened = {}
CRT.AlertEditor = { Open = function(_, enc, id, prefill) opened[#opened + 1] = { enc = enc, id = id, prefill = prefill } end }
local View = CRT.TimelineView
local T = CRT.Timeline
local S = CRT.db.timeline


local View = CRT.TimelineView
local S = CRT.db.timeline
local function dbl(view, spellKind, label, t, wantDeath)
  for _, b in ipairs(view.icons) do
    if b:IsShown() and b.lane.label == label and b.mark.t == t then
      b.OnMouseDown(b, "LeftButton") b.OnMouseUp(b, "LeftButton") b.OnMouseDown(b, "LeftButton")
      cursor = cursor - 30
      view.frame.OnUpdate(view.frame)
      b.OnDoubleClick(b, "LeftButton")
      b.OnMouseUp(b, "LeftButton")
      return b
    end
  end
  error("no icon " .. label .. " " .. t)
end
local function reset() for i = #opened, 1, -1 do opened[i] = nil end for i = #printed, 1, -1 do printed[i] = nil end cursor = 400 end

local ref = assert(CRT.TimelineReference.Parse("Boss: Nek\\nEncounter: 3001\\nPhase: P1 0:00\\nPhase: P2 1:00\\nSoulcoil [spell 4242]: 0:10, 1:15\\nPlain: 0:30"), "ref parses")
do
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  reset()
  v:ScrollTo(50)
  local before = v.hscroll:GetHorizontalScroll()
  dbl(v, nil, "Soulcoil", 75)
  assert(#opened == 1, "opens once")
  local o = opened[1]
  assert(o.enc == 3001 and o.id == nil, "encounter and new")
  assert(o.prefill.spellID == 4242 and o.prefill.text == "Spell4242" and o.prefill.boss == "Nek", "prefill spell, text, boss")
  assert(o.prefill.ph == 2 and o.prefill.time == 15 and o.prefill.saveAs == "mine", "phase time: " .. tostring(o.prefill.ph) .. " " .. tostring(o.prefill.time))
  assert(v.dragX == nil and v.hscroll:GetHorizontalScroll() == before, "double-click leaves no drag and no move")
end
print("ok double-click reference cast opens editor with phase time")

do
  local p = { id = 1, encounterID = 3001, length = 200, casts = { { t = 20.4, spellID = 0 }, { t = 10, dur = 2, spellID = 5001 } }, deaths = { { t = 50, name = "Abu", class = "MAGE", role = "DAMAGER", spellID = 0 } } }
  local v = View.Create(mock("Frame"))
  v:SetData(p, 3001, nil, "Alpha")
  reset()
  dbl(v, nil, "Boss casts (unnamed)", 20.4)
  local o = opened[1]
  assert(o and o.prefill.spellID == nil and o.prefill.text == nil and o.prefill.ph == 1 and o.prefill.time == 20.4 and o.prefill.boss == "Alpha", "unnamed cast: only time")
  assert(v.dragX == nil, "no drag left")
  print("ok double-click unnamed cast opens editor with only time")
  reset()
  reset()
  dbl(v, nil, "Boss casts (unnamed)", 10)
  assert(opened[1] and opened[1].prefill.spellID == 5001 and opened[1].prefill.text == "Spell5001", "unnamed lane cast with an id keeps it")
  print("ok double-click unlisted cast keeps its own spell")
  reset()
  local realRows = CRT.TimelineJournal.Rows
  CRT.TimelineJournal.Rows = function() return { { spellID = 5001, name = "Named Spell", icon = 1 } } end
  v:SetData(p, 3001, nil, "Alpha")
  local lane
  for _, l in ipairs(v.lanes) do if l.kind == "spell" and #l.marks > 0 then lane = l end end
  dbl(v, nil, lane.label, 10)
  o = opened[1]
  assert(o and o.prefill.spellID == 5001 and o.prefill.ph == 1 and o.prefill.time == 10, "recorded named cast")
  CRT.TimelineJournal.Rows = realRows
  print("ok double-click recorded named cast")
  reset()
  dbl(v, nil, "Deaths", 50)
  assert(#opened == 0 and #printed == 0, "deaths row does nothing")
  print("ok double-click deaths row does nothing")
end

do
  local nameOnly = assert(CRT.TimelineReference.Parse("Boss: Named\\nA: 0:10"))
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = nameOnly }, "ref:named", nil, "Named")
  reset()
  dbl(v, nil, "A", 10)
  assert(#opened == 0 and #printed == 1 and printed[1]:find("pulled once", 1, true), "text key prints: " .. tostring(printed[1]))
  assert(v.dragX == nil, "no drag left")
end
print("ok double-click boss known only by name prints and opens nothing")

do
  -- a boss under a string key whose reference has an Encounter line, or whose name the Journal knows
  local withEnc = assert(CRT.TimelineReference.Parse("Boss: Keyed\\nEncounter: 3001\\nA: 0:10"))
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = withEnc }, "ref:keyed", nil, "Keyed")
  reset()
  dbl(v, nil, "A", 10)
  assert(#opened == 1 and opened[1].enc == 3001 and #printed == 0, "Encounter line used for a string key")
  local nameOnly = assert(CRT.TimelineReference.Parse("Boss: Named\\nA: 0:10"))
  local realResolve = CRT.TimelineJournal.ResolveID
  CRT.TimelineJournal.ResolveID = function(J, k, r) if r and r.boss == "Named" then return 4444 end return realResolve(J, k, r) end
  v:SetData({ reference = nameOnly }, "ref:named", nil, "Named")
  reset()
  dbl(v, nil, "A", 10)
  assert(#opened == 1 and opened[1].enc == 4444 and #printed == 0, "Journal name lookup used for a string key")
  CRT.TimelineJournal.ResolveID = realResolve
end
print("ok double-click string key falls back to ResolveID")

do
  -- a reference row with no spell is named after the row
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  reset()
  dbl(v, nil, "Plain", 30)
  assert(#opened == 1 and opened[1].prefill.spellID == nil and opened[1].prefill.text == "Plain", "text: " .. tostring(opened[1] and opened[1].prefill.text))
end
print("ok double-click reference row without spell prefills its label")

do
  local overlay = { id = 2, length = 600, kill = false, casts = { { t = 5, spellID = 0 } },
    deaths = { { t = 30, name = "Abu", class = "MAGE", role = "DAMAGER", spellID = 0 } } }
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 3001, overlay, "Nek")
  reset()
  for _, b in ipairs(v.icons) do assert(not (b:IsShown() and b.lane.kind == "ticks"), "tick rows have no icons") end
  dbl(v, nil, "Deaths", 30)
  assert(#opened == 0 and #printed == 0, "overlay deaths do nothing")
end
print("ok double-click overlay rows do nothing")

do
  local slashed = {}
  CRT.NotesPage = { Open = function(tab) slashed[#slashed + 1] = tab end }
  CRT.UI = {}
  SlashCmdList = {}
  CRT.version = "test"
  strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
  local out = {}
  local realPrint = print
  print = function(s) out[#out + 1] = s end
  assert(load(slashSrc, "CRT_Core/Slash.lua"))("CowfeeRaidTools", CRT)
  SlashCmdList["COWFEERAIDTOOLS"]("reminders")
  SlashCmdList["COWFEERAIDTOOLS"]("help")
  print = realPrint
  assert(#slashed == 1 and slashed[1] == "reminders", "slash opens tab")
  local help
  for _, l in ipairs(out) do if l:find("/crt reminders", 1, true) then help = true end end
  assert(help, "help lists reminders")

  -- /crt note next on a pull with only reminders (no note) starts P2 and says so
  local A = CRT.Alerts
  CRT.NoteEngine = { NextPhase = function() if not A.running then return nil end return A:NextPhase() end }
  CRT.AlertReminders:Save(3001, nil, { text = "Soak", times = "P1 0:05; P2 +0:10", boss = "Nek" })
  A.HandleEvent("ENCOUNTER_START", 3001, "Nek", 16)
  reset()
  SlashCmdList["COWFEERAIDTOOLS"]("note next")
  assert(A:PhaseStart(2) ~= nil, "P2 started")
  assert(printed[1] == "Phase 2 started.", "chat line names the phase: " .. tostring(printed[1]))
  A.HandleEvent("ENCOUNTER_END", 3001)
end
print("ok slash reminders opens tab")
print("ok slash note next starts P2 of a reminders-only pull")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const p of process.argv.slice(2, 11)) {
  let src; try { src = fs.readFileSync(p, 'utf8'); } catch (e) { console.error('cannot read ' + p); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 9, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
