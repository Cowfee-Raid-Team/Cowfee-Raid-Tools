// Timeline: drop a note by double-clicking the track, and saved notes drawn as flag markers.
// Usage: node run_alerts_marks.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Alerts/Reminders.lua CRT_Modules/Timeline/View.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local dataSrc, dbSrc, refSrc, lanesSrc, rulesSrc, engineSrc, parseSrc, notesSrc, remSrc, viewSrc, regSrc, seasonSrc, nekSrc = ...
local buttons = 0
local textures = 0 -- every texture made, to tell a pool from one made per frame
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
    if k == "SetFrameLevel" then return function(self, v) rawset(self, "level", v) end end
    if k == "GetFrameLevel" then return function(self) return rawget(self, "level") or 1 end end
    if k == "SetHighlightTexture" then return function(self, tx) local t = mock("Texture") rawset(t, "path", tx) rawset(self, "hl", t) return t end end
    if k == "GetHighlightTexture" then return function(self) local t = rawget(self, "hl") if not t then t = mock("Texture") rawset(self, "hl", t) end return t end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "IsVisible" then return function(self) return rawget(self, "shown") end end
    if k == "GetWidth" then return function(self) return rawget(self, "w") or 600 end end
    if k == "GetHeight" then return function(self) return rawget(self, "h") or 300 end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, a, rel, b, x, y) rawset(self, "pt", { a, rel, b, x, y }) end end
    if k == "SetTexture" then return function(self, v) rawset(self, "tex", v) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetVertexColor" then return function(self, r, g, b) rawset(self, "vcolor", { r, g, b }) end end
    -- retail: a font string with a width set measures at most that width; the unbounded width is the text's own
    if k == "GetStringWidth" then return function(self) local w = #(rawget(self, "text") or "") * 6 local set = rawget(self, "w") return set and math.min(w, set) or w end end
    if k == "GetUnboundedStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "GetAlpha" then return function(self) return rawget(self, "alpha") or 1 end end
    if k == "GetLeft" then return function() return 100 end end
    if k == "GetTop" then return function() return 500 end end
    if k == "GetEffectiveScale" then return function() return 1 end end
    if k == "IsMouseOver" then return function() return false end end
    if k == "SetHorizontalScroll" then return function(self, v) rawset(self, "hs", v) end end
    if k == "GetHorizontalScroll" then return function(self) return rawget(self, "hs") or 0 end end
    if k == "SetVerticalScroll" then return function(self, v) rawset(self, "vs", v) end end
    if k == "GetVerticalScroll" then return function(self) return rawget(self, "vs") or 0 end end
    if k == "GetVerticalScrollRange" then return function() return 0 end end
    if k == "SetScrollChild" then return function(self, c) rawset(self, "child", c) end end
    if k == "GetValue" then return function(self) return rawget(self, "value") or 0 end end
    if k == "SetValue" then return function(self, v) rawset(self, "value", v) local fn = rawget(self, "OnValueChanged") if fn then fn(self, v) end end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    if k == "GetScript" then return function(self, name) return rawget(self, name) end end
    if k == "EnableKeyboard" then return function(self, on) rawset(self, "keyboard", on and true or false) end end
    if k == "SetPropagateKeyboardInput" then return function(self, on) rawset(self, "propagate", on and true or false) end end
    if k == "EnableMouse" then return function(self, on) rawset(self, "mouse", on) end end
    return function() end end })
end
function CreateFrame(kind) if kind == "Button" then buttons = buttons + 1 end return mock(kind) end
UIParent = mock("Frame")
local tip = {}
GameTooltip = mock("GameTooltip")
GameTooltip.SetOwner = function() for i = #tip, 1, -1 do tip[i] = nil end end
GameTooltip.SetText = function(_, s) tip[#tip + 1] = s end
GameTooltip.AddLine = function(_, s) tip[#tip + 1] = s end
local cx, cy, now = 400, 300, 100
function GetCursorPosition() return cx, cy end
function GetTime() return now end
local mouseDown = true
function IsMouseButtonDown() return mouseDown end
function IsShiftKeyDown() return false end
local alt = false
function date() return "2026-10-16 12:00" end
function IsAltKeyDown() return alt end
function InCombatLockdown() return false end
local SECRET = setmetatable({}, { __tostring = function() return "secret" end })
function issecretvalue(v) return v == SECRET end
-- the group, as the game reports it: solo by default (you may change the raid note)
local group = { raid = false, party = false, leader = false, assist = false }
function IsInRaid() return group.raid end
function IsInGroup() return group.party or group.raid end
function UnitIsGroupLeader(unit) return unit == "player" and group.leader end
function UnitIsGroupAssistant(unit) return unit == "player" and group.assist end
local function asMember() group.raid, group.party, group.leader, group.assist = true, true, false, false end
local function asSolo() group.raid, group.party, group.leader, group.assist = false, false, false, false end
local handled = {}
function geterrorhandler() return function(e) handled[#handled + 1] = e end end
function GetNumClasses() return 2 end
function GetClassInfo(i) if i == 1 then return "Death Knight", "DEATHKNIGHT", 6 end return "Mage", "MAGE", 8 end
C_Timer = { After = function() end }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end }
RAID_CLASS_COLORS = {}
CRTFontSmall, CRTFontNormal, CRTFontHighlight = {}, {}, {}
local CRT = {
  db = { timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3,
    overlayOn = false, hideEmpty = true, nextId = 1 },
    notes = { list = {}, nextId = 1, alert = {}, window = {} } },
  PALETTE = { accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, surface = { 0.165, 0.122, 0.098 }, text = { 0.95, 0.90, 0.84 } },
  Groups = { ClassColor = function() return 1, 1, 1 end },
}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
local journalRows = {}
CRT.TimelineJournal = { ResolveID = function(_, k, r) if type(k) == "number" then return k end if r and type(r.encounterID) == "number" then return r.encounterID end end,
  Rows = function() return journalRows end,
  IsHidden = function() return false end,
}
CRT.db.alerts = { bars = {}, reminders = {}, phases = {}, overrides = {}, nextId = 1 }
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
assert(load(rulesSrc, "CRT_Modules/Alerts/Rules.lua"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "CRT_Modules/Alerts/Engine.lua"))("CowfeeRaidTools", CRT)
assert(load(parseSrc, "CRT_Modules/Notes/Parse.lua"))("CowfeeRaidTools", CRT)
assert(load(notesSrc, "CRT_Modules/Notes/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(remSrc, "CRT_Modules/Alerts/Reminders.lua"))("CowfeeRaidTools", CRT)
assert(load(viewSrc, "CRT_Modules/Timeline/View.lua"))("CowfeeRaidTools", CRT)
local opened, notesOpened = {}, {}
CRT.AlertEditor = {
  Open = function(_, enc, id, prefill) opened[#opened + 1] = { enc = enc, id = id, prefill = prefill } end,
  OpenNote = function(_, noteID, line) notesOpened[#notesOpened + 1] = { noteID = noteID, line = line } end,
}
-- the alert editor window, for a release over it (MouseIsOver goes by its rectangle, shown or not)
local editorFrame = mock("Frame")
editorFrame:Hide()
local overEditor = false
function MouseIsOver(f) return overEditor and f == editorFrame end
CRT.AlertEditor.Frame = function() return editorFrame end
-- the game's context menu and confirm popup, and the helpers CRT.UI gives for lifting it over the editor
local menus, popups, lifted = {}, {}, {}
local function description(kind, text, fn)
  local d = { kind = kind, text = text, fn = fn, items = {} }
  function d:CreateTitle(t) local x = description("title", t) table.insert(self.items, x) return x end
  function d:CreateButton(t, f) local x = description("button", t, f) table.insert(self.items, x) return x end
  return d
end
MenuUtil = { CreateContextMenu = function(owner, gen)
  local root = description("root")
  gen(owner, root)
  menus[#menus + 1] = { owner = owner, root = root }
  return {}
end }
function StaticPopup_ShowCustomGenericConfirmation(info) popups[#popups + 1] = info return nil end
local helps = {}
CRT.UI = { LiftOver = function(d) lifted[#lifted + 1] = d end, ShownPopup = function(ret, name) return { named = name } end,
  Help = function(parent, title, text) local b = mock("Button") rawset(b, "helpTitle", title) rawset(b, "helpText", text) helps[#helps + 1] = b return b end }
local View, Rem, Notes = CRT.TimelineView, CRT.AlertReminders, CRT.Notes
local function reset()
  for i = #opened, 1, -1 do opened[i] = nil end
  for i = #notesOpened, 1, -1 do notesOpened[i] = nil end
  for i = #printed, 1, -1 do printed[i] = nil end
  now = now + 10
end
-- the screen x of time t at the harness's width (600) and span (300), track scrolled by hs
local function screenX(v, t) return 100 - v.hscroll:GetHorizontalScroll() + t * 600 / 300 end
-- the screen y of the middle of lane i (the track's top is at 500)
local function laneY(i) return 500 - (i - 1) * 30 - 15 end
local function laneIndex(v, label) for i, l in ipairs(v.lanes) do if l.label == label then return i end end error("no lane " .. label) end
-- a click reaches the track only inside its bounds: x from 100 across the 600 px window, y from the top
-- (500) down the body's height, as the game would deliver it
local function inside(v) return cx >= 100 and cx <= 700 and cy <= 500 and cy >= 500 - v.body:GetHeight() end
local function up(v, button, dt)
  now = now + (dt or 0)
  if inside(v) then v.hscroll.OnMouseDown(v.hscroll, button or "LeftButton") v.hscroll.OnMouseUp(v.hscroll, button or "LeftButton") end
end
local function doubleAt(v, t, i)
  -- scroll so t is inside the 600 px window, as a player would
  if screenX(v, t) > 700 then v:ScrollTo(t * 2 - 300) end
  cx, cy = screenX(v, t), laneY(i)
  up(v) up(v, nil, 0.2)
end
local function flags(v)
  local out = {}
  for _, f in ipairs(v.flags or {}) do if f:IsShown() then out[#out + 1] = f end end
  return out
end
local function flagAt(v, t, mine)
  for _, f in ipairs(flags(v)) do
    if math.abs(f.mark.t - t) < 0.01 and (mine == nil or (f.mark.mine and true or false) == mine) then return f end
  end
end

local nek = assert(CRT.TimelineReference.Parse(CRT.TimelineDB.references[1]), "nekzali parses")

do
  -- Nek'zali: P1.5 at 3:17, an unnumbered phase line at 5:53, P2 at 7:20. 6:30 is in the unnumbered stretch.
  local ph, s = Rem.PhaseAt(nek, 390)
  assert(ph == 1.5 and s == 193, "PhaseAt in the unnumbered stretch: " .. tostring(ph) .. " " .. tostring(s))
  assert(Rem.AbsoluteTime(nek, 1.5, 193) == 390, "AbsoluteTime back")
  assert(Rem.AbsoluteTime(nek, 1, 20) == 20 and Rem.AbsoluteTime(nek, 2, 18) == 458, "phase 1 from the pull, P2 from its line")
  assert(Rem.AbsoluteTime(nek, 3, 5) == nil, "a phase the reference doesn't have")
  assert(Rem.AbsoluteTime(nil, 1, 30) == 30 and Rem.AbsoluteTime(nil, 2, 30) == nil, "recorded pull: only phase 1")
  local p0, s0 = Rem.PhaseAt(nil, 42.5)
  assert(p0 == 1 and s0 == 42.5, "no reference: phase 1 from the pull")
  -- a later line whose label carries a 1 does not move phase 1's start away from the pull
  local inter = assert(CRT.TimelineReference.Parse("Boss: X\\nLength: 5:00\\nPhase: Intermission 1 2:00\\nPhase: P2 3:00\\nA: 0:10"))
  local pi, si = Rem.PhaseAt(inter, 60)
  assert(pi == 1 and si == 60 and Rem.AbsoluteTime(inter, 1, 60) == 60, "phase 1 before the Intermission 1 line: " .. tostring(Rem.AbsoluteTime(inter, 1, 60)))
  assert(Rem.AbsoluteTime(inter, 2, 5) == 185, "P2 still from its line")
  -- times with tenths read and write back
  assert(Rem.FormatTimes({ { ph = 1.5, t = 193.5 } }) == "P1.5 +3:13.5" and Rem.FormatTimes({ { ph = 1, t = 3.5 } }) == "P1 0:03.5", Rem.FormatTimes({ { ph = 1.5, t = 193.5 } }))
  local back = Rem.ParseTimes("P1.5 +3:13.5, 12.4")
  assert(back and back[1].t == 193.5 and back[2].t == 12.4, "tenths parse")

  local v = View.Create(mock("Frame"))
  v:SetData({ reference = nek }, 3001, nil, "Nek'zali")
  reset()
  local row = laneIndex(v, "Essence Rend")
  doubleAt(v, 390.5, row)
  assert(#opened == 1, "double-click opens the editor")
  local o = opened[1]
  assert(o.enc == 3001 and o.id == nil, "new alert for the boss")
  assert(o.prefill.ph == 1.5 and o.prefill.time == 193.5, "phase and seconds: " .. tostring(o.prefill.ph) .. " " .. tostring(o.prefill.time))
  assert(o.prefill.saveAs == "mine" and o.prefill.boss == "Nek'zali", "saveAs mine and the boss")
  -- saved as a reminder the way the editor writes it (FormatTimes of its phase and time), its marker
  -- lands back on the clicked time
  CRT.AlertReminders:Save(3001, nil, { text = "Here", times = Rem.FormatTimes({ { ph = o.prefill.ph, t = o.prefill.time } }), boss = "Nek'zali" })
  local f = flagAt(v, 390.5, true)
  assert(f, "reminder marker at the clicked time")
  assert(f.pt[4] == View.TimeToX(390.5, nek.length, v.trackW) - 5, "marker x is the clicked x")
  CRT.db.alerts.reminders = {}
  -- saved as a note line (the parser writes the time as it is), the same
  CRT.db.notes.list[50] = { raw = "EncounterID:3001;Name:Nek'zali\\n" .. CRT.NoteParser.FormatLine({ time = o.prefill.time, ph = o.prefill.ph, text = "Here" }), encounterID = 3001, name = "Nek'zali" }
  v:Refresh()
  assert(flagAt(v, 390.5, false), "note marker at the clicked time")
  CRT.db.notes.list[50] = nil
end
print("ok timeline: click time round trips through phase")

local ref = assert(CRT.TimelineReference.Parse("Boss: Nek\\nEncounter: 3001\\nLength: 3:00\\nPhase: P1 0:00\\nPhase: P2 1:00\\nSoulcoil [spell 4242]: 0:10, 1:15\\nPlain: 0:30"), "ref parses")

do
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  reset()
  doubleAt(v, 70, laneIndex(v, "Soulcoil"))
  local o = opened[1]
  assert(o and o.prefill.spellID == nil and o.prefill.text == nil, "reference row opens blank")
  assert(o.prefill.ph == 2 and o.prefill.time == 10, "P2 +10")
  reset()
  doubleAt(v, 20, laneIndex(v, "Plain"))
  assert(opened[1] and opened[1].prefill.spellID == nil and opened[1].prefill.text == nil, "a row without a spell opens blank too")
  -- a recorded pull: a spell row opens blank, phase 1 from the pull
  journalRows = { { spellID = 5001, name = "Named Spell", icon = 1 } }
  local p = { id = 1, encounterID = 3001, length = 200, casts = { { t = 10, spellID = 5001 } }, deaths = {} }
  v:SetData(p, 3001, nil, "Alpha")
  reset()
  doubleAt(v, 42, laneIndex(v, "Named Spell"))
  o = opened[1]
  assert(o and o.prefill.spellID == nil and o.prefill.text == nil and o.prefill.ph == 1 and o.prefill.time == 42 and o.prefill.boss == "Alpha", "recorded row opens blank")
  journalRows = {}
end
print("ok timeline: double-click on a row opens blank")

do
  local p = { id = 1, encounterID = 3001, length = 200, casts = { { t = 10, spellID = 0 } }, deaths = { { t = 50, name = "Abu", class = "MAGE", role = "DAMAGER", spellID = 0 } } }
  local v = View.Create(mock("Frame"))
  v:SetData(p, 3001, nil, "Alpha")
  reset()
  doubleAt(v, 60, laneIndex(v, "Deaths"))
  local o = opened[1]
  assert(o and o.prefill.spellID == nil and o.prefill.text == nil and o.prefill.ph == 1 and o.prefill.time == 60, "deaths: time only")
  reset()
  -- the track reaches the bottom of the window (300 px) though the two lanes are 60 px
  assert(#v.lanes == 3 and v.lanes[3].label == "Personal notes" and v.body:GetHeight() == 300 and v.track:GetHeight() == 300, "track as tall as the window: " .. tostring(v.body:GetHeight()))
  doubleAt(v, 60, #v.lanes + 3)
  o = opened[1]
  assert(o and o.prefill.spellID == nil and o.prefill.time == 60, "empty space below the lanes: time only")
  reset()
  cx, cy = screenX(v, 60), 500 - 310
  up(v) up(v, nil, 0.1)
  assert(#opened == 0, "below the window nothing is clicked")
  reset()
  doubleAt(v, 60, laneIndex(v, "Boss casts (unnamed)"))
  assert(opened[1] and opened[1].prefill.spellID == nil, "the unnamed row gives no spell")
  -- a boss known only by name prints and opens nothing
  local nameOnly = assert(CRT.TimelineReference.Parse("Boss: Named\\nA: 0:10"))
  v:SetData({ reference = nameOnly }, "ref:named", nil, "Named")
  reset()
  doubleAt(v, 5, 2)
  assert(#opened == 0 and #printed == 1, "string key with no encounter prints")
end
print("ok timeline: double-click on deaths has no spell")

do
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  reset()
  cx, cy = screenX(v, 50), laneY(2)
  up(v)
  assert(#opened == 0, "one click does nothing")
  up(v, nil, 0.5)
  assert(#opened == 0, "two clicks 0.5 s apart do nothing")
  now = now + 10
  up(v) cx = cx + 10 up(v, nil, 0.1)
  assert(#opened == 0, "two clicks 10 px apart do nothing")
  now = now + 10
  up(v, "RightButton") up(v, "RightButton", 0.1)
  assert(#opened == 0, "right button double does nothing")
  now = now + 10
  -- a click on an icon then one on the track is not a double-click
  local icon
  for _, b in ipairs(v.icons) do if b:IsShown() then icon = b break end end
  up(v) icon.OnMouseDown(icon, "LeftButton") icon.OnMouseUp(icon, "LeftButton") up(v, nil, 0.1)
  assert(#opened == 0, "icon click between")
  now = now + 10
  up(v) up(v, nil, 0.1)
  assert(#opened == 1, "a real double-click still works")
  up(v, nil, 0.1)
  assert(#opened == 1, "a third click is not a second double-click")
end
print("ok timeline: single click does nothing")

-- a click, a right-drag that scrolls the track, then a quick click: not a double-click
do
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  CRT.db.timeline.span = 60
  v:Refresh()
  v:ScrollTo(40)
  reset()
  cx, cy = 300, laneY(2)
  up(v)
  v.hscroll.OnMouseDown(v.hscroll, "RightButton")
  cx = cx - 30
  v.frame.OnUpdate(v.frame)
  v.hscroll.OnMouseUp(v.hscroll, "RightButton")
  assert(v.hscroll:GetHorizontalScroll() ~= 40, "the drag scrolled")
  cx = cx + 30
  up(v, nil, 0.1)
  assert(#opened == 0, "drag then a quick click opens nothing")
  now = now + 10
  up(v) up(v, nil, 0.1)
  assert(#opened == 1, "a double-click after it still works")
  CRT.db.timeline.span = 300
end
print("ok timeline: a drag between clicks is no double-click")

-- notes for the boss: two difficulties, plus another boss's note that must not show
local function addNote(id, raw, enc, diff, name)
  CRT.db.notes.list[id] = { raw = raw, encounterID = enc, difficulty = diff, name = name }
end
addNote(1, "EncounterID:3001;Difficulty:Heroic;Name:Nek\\ntime:20;ph:1;tag:Abu DEATHKNIGHT mage;spellid:4242;\\ntime:15;ph:2;tag:everyone;text:Soak now;", 3001, "Heroic", "Nek")
addNote(2, "EncounterID:3001;Difficulty:Mythic;Name:Nek\\nfree text\\ntime:25;ph:1;spellid:4242;text:Mythic one;", 3001, "Mythic", "Nek")
addNote(3, "EncounterID:9999;Name:Other\\ntime:5;ph:1;text:Not here;", 9999, nil, "Other")

do
  local v = View.Create(mock("Frame"))
  CRT.AlertReminders:Save(3001, nil, { spellID = 4343, times = "P1 0:40", boss = "Nek" })
  CRT.AlertReminders:Save(3001, nil, { text = "Free one", times = "P2 +0:30", boss = "Nek" })
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  local list = flags(v)
  assert(#list == 5, "five markers: " .. #list)
  local soul = laneIndex(v, "Soulcoil")
  local notesLane = laneIndex(v, "Notes")
  local personal = laneIndex(v, "Personal notes")
  assert(notesLane == #v.lanes - 1 and personal == #v.lanes, "a Notes lane at the bottom, then Personal notes")
  local accent, text = CRT.PALETTE.accent, CRT.PALETTE.text
  local function check(t, mine, row, color, what)
    local f = flagAt(v, t, mine)
    assert(f, what .. ": no marker")
    assert(f.mark.row == row, what .. ": row " .. tostring(f.mark.row))
    assert(f.head.color[1] == color[1] and f.head.color[2] == color[2], what .. ": color")
    assert(f.pt[5] == -(row - 1) * 30, what .. ": y (the button spans the row)")
    assert(f.mouse == true and f.w == 20 and f.h == 20, what .. ": a 20 x 20 button at the head: " .. tostring(f.w) .. "x" .. tostring(f.h))
    assert(f.head.w == 12 and f.head.h == 14, what .. ": flag 12 wide, head 14 high")
    assert(f.head.pt[1] == "TOPLEFT" and f.head.pt[4] == 4 and f.pole.pt[4] == 4, what .. ": flag centred in the button")
    assert(rawget(f.pole, "mouse") ~= true and rawget(f.head, "mouse") ~= true and f.pole.h == 24 and f.pole.kind == "Texture", what .. ": the pole is a plain texture")
    assert(f.h <= 20 and f.h < 30 - 9, what .. ": the button leaves the row's lower part (the icon's) uncovered")
    assert(rawget(f, "hl"), what .. ": hover highlight")
    return f
  end
  check(20, false, soul, accent, "heroic spell line")
  check(25, false, soul, accent, "mythic spell line")
  check(75, false, notesLane, accent, "text line in P2")
  check(40, true, personal, text, "reminder with a spell on Personal notes")
  check(90, true, personal, text, "reminder without a spell on Personal notes")
  -- a marker over a cast icon stays the one clicked: its level is above every icon's
  local topIcon = 0
  for _, b in ipairs(v.icons) do if b.level and b.level > topIcon then topIcon = b.level end end
  assert(topIcon > 0, "icons have a level")
  for _, fl in ipairs(list) do assert(fl.level > topIcon, "flag level " .. tostring(fl.level) .. " above icons " .. topIcon) end
  -- hover
  local f = flagAt(v, 25, false)
  f.OnEnter(f)
  assert(tip[1] == "Mythic one" and tip[2] == "No one (timers window only)", "a line with no tag: " .. table.concat(tip, "|"))
  f = flagAt(v, 20, false)
  f.OnEnter(f)
  assert(tip[1] == "Spell4242" and tip[2] == "Abu Death Knight Mage" and tip[3] == "P1 0:20" and tip[4] == "Raid note (Heroic)", "note tip: " .. table.concat(tip, "|"))
  f = flagAt(v, 75, false)
  f.OnEnter(f)
  assert(tip[1] == "Soak now" and tip[2] == "Everyone" and tip[3] == "P2 +0:15", "text note tip: " .. table.concat(tip, "|"))
  f = flagAt(v, 90, true)
  f.OnEnter(f)
  assert(tip[1] == "Free one" and tip[2] == "Only me" and tip[3] == "P2 +0:30" and tip[4] == "Your reminder", "reminder tip: " .. table.concat(tip, "|"))
  -- pooled: refreshing makes no new frames
  local made = buttons
  v:Refresh() v:Refresh()
  assert(buttons == made, "markers come from the pool")
  -- a change to the notes or the reminders redraws them while shown
  Notes:Delete(2)
  assert(#flags(v) == 4, "note delete redraws")
  CRT.db.alerts.reminders = {}
  CRT.Alerts:Fire()
  assert(#flags(v) == 2, "reminder change redraws: " .. #flags(v))
  -- a failing redraw goes to the error handler and the save still happens
  local realRefresh = v.Refresh
  v.Refresh = function() error("boom") end
  local nid = CRT.AlertReminders:Save(3001, nil, { spellID = 4343, times = "P1 0:41", boss = "Nek" })
  assert(CRT.AlertReminders:Get(3001, nid) and #handled == 1 and tostring(handled[1]):find("boom"), "listener error handled")
  CRT.AlertReminders:Delete(3001, nid)
  for i = #handled, 1, -1 do handled[i] = nil end
  v.Refresh = realRefresh
  v:Refresh()
  assert(#flags(v) == 2, "back to two")
  v.frame:Hide()
  CRT.AlertReminders:Save(3001, nil, { spellID = 4343, times = "P1 0:40", boss = "Nek" })
  assert(#flags(v) == 2, "hidden view does not redraw")
  v.frame:Show()
  CRT.db.alerts.reminders = {}
  addNote(2, "EncounterID:3001;Difficulty:Mythic;Name:Nek\\nfree text\\ntime:25;ph:1;spellid:4242;text:Mythic one;", 3001, "Mythic", "Nek")
end
print("ok marks: note lines and reminders drawn")

do
  local v = View.Create(mock("Frame"))
  local saved = CRT.db.notes.list[1]
  CRT.db.notes.list[1] = nil
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  local n = #v.lanes
  assert(v.lanes[n].label == "Personal notes" and v.lanes[n - 1].label ~= "Notes", "no Notes lane when every marker has a row")
  assert(#flags(v) == 1, "the mythic line only")
  CRT.db.notes.list[1] = saved
  v:Refresh()
  assert(#v.lanes == n + 1 and v.lanes[n].label == "Notes" and v.lanes[n + 1].label == "Personal notes", "Notes lane once a text line needs it, above Personal notes")
  -- a boss with no notes or reminders has no Notes lane and no markers
  v:SetData({ reference = ref }, 4000, nil, "Empty")
  assert(#flags(v) == 0 and v.lanes[#v.lanes - 1].label ~= "Notes", "nothing for another boss")
end
print("ok marks: notes lane only when needed")

do
  journalRows = { { spellID = 4242, name = "Soulcoil", icon = 1 } }
  local p = { id = 1, encounterID = 3001, length = 200, casts = { { t = 10, spellID = 4242 } }, deaths = {} }
  CRT.AlertReminders:Save(3001, nil, { text = "Later", times = "P1 0:50; P2 +0:05", boss = "Nek" })
  local v = View.Create(mock("Frame"))
  v:SetData(p, 3001, nil, "Nek")
  local list = flags(v)
  for _, f in ipairs(list) do assert(f.mark.ph == 1, "only phase 1 on a recorded pull") end
  assert(#list == 3, "heroic 0:20, mythic 0:25, reminder 0:50: " .. #list)
  assert(flagAt(v, 20, false).mark.row == laneIndex(v, "Soulcoil"), "on the recorded spell row")
  assert(flagAt(v, 50, true).mark.row == #v.lanes and v.lanes[#v.lanes].label == "Personal notes", "text reminder on the Personal notes lane")
  CRT.db.alerts.reminders = {}
  journalRows = {}
end
print("ok marks: phase 2 skipped on a recorded pull")

do
  local id = CRT.AlertReminders:Save(3001, nil, { spellID = 4343, times = "P1 0:40", boss = "Nek" })
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  reset()
  local f = flagAt(v, 75, false)
  f.OnMouseDown(f, "LeftButton") f.OnMouseUp(f, "LeftButton") f.OnMouseDown(f, "LeftButton")
  f.OnDoubleClick(f, "LeftButton")
  assert(#notesOpened == 1 and notesOpened[1].noteID == 1 and notesOpened[1].line == 3, "note line opens: " .. tostring(notesOpened[1] and notesOpened[1].line))
  f = flagAt(v, 40, true)
  f.OnDoubleClick(f, "LeftButton")
  assert(#opened == 1 and opened[1].enc == 3001 and opened[1].id == id and opened[1].prefill == nil, "reminder opens")
  -- a double-click on a marker is not a track double-click
  assert(#opened == 1, "no new alert from the marker's clicks")
  -- a right-drag started on a marker is undone by its double-click, like an icon's
  CRT.db.timeline.span = 60
  v:Refresh()
  v:ScrollTo(40)
  assert(v.hscroll:GetHorizontalScroll() == 40, "scrolled")
  f = flagAt(v, 40, true)
  f.OnMouseDown(f, "RightButton")
  cx = cx - 30
  v.frame.OnUpdate(v.frame)
  f.OnDoubleClick(f, "LeftButton")
  assert(v.dragX == nil and v.hscroll:GetHorizontalScroll() == 40, "drag undone")
  CRT.db.timeline.span = 300
  CRT.db.alerts.reminders = {}
end
print("ok marks: double-click opens the editor")

-- Dragging a flag moves its alert; Alt held at release adds a time instead.
do
  local rawNote = "EncounterID:3001;Difficulty:Heroic;Name:Nek\\ntime:20;ph:1;spellid:4242;text:Soak;DisplayType:Text;\\ntime:45;ph:1;text:Other;"
  local savedNote = CRT.db.notes.list[1]
  local function setup(reminderTimes)
    CRT.db.alerts.reminders = {}
    CRT.db.notes.list[1] = { raw = rawNote, encounterID = 3001, difficulty = "Heroic", name = "Nek" }
    CRT.db.notes.list[2] = nil
    local id = reminderTimes and CRT.AlertReminders:Save(3001, nil, { spellID = 4343, text = "Mine", times = reminderTimes, boss = "Nek", priority = "high" })
    local v = View.Create(mock("Frame"))
    v:SetData({ reference = ref }, 3001, nil, "Nek")
    reset()
    alt = false
    return v, id
  end
  local function drag(v, f, toT, altAtRelease, midAlt)
    cx = screenX(v, f.mark.t)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, toT)
    alt = midAlt or false
    v.frame.OnUpdate(v.frame)
    alt = altAtRelease or false
    f.OnMouseUp(f, "LeftButton")
    alt = false
  end
  local function timesOf(id) return CRT.AlertReminders:Get(3001, id).times end

  -- move a reminder time: 100 s is phase 2 (starts 1:00), 40 s in
  do
    local v, id = setup("P1 0:40, 0:50")
    local f = flagAt(v, 50, true)
    assert(f.mark.kind == "mine" and f.mark.encounterID == 3001 and f.mark.id == id and f.mark.index == 2, "reminder flag knows its source")
    drag(v, f, 100.04)
    assert(timesOf(id) == "P1 0:40; P2 +0:40", "moved the second time: " .. tostring(timesOf(id)))
    local r = CRT.AlertReminders:Get(3001, id)
    assert(r.priority == "high" and r.text == "Mine" and r.spellID == 4343, "other fields unchanged")
    assert(flagAt(v, 100, true) and not flagAt(v, 50, true), "the flag redrew at the new time")
    -- a reminder on a spell-less ability row (matched by name: the registered Nek'zali reference's
    -- "Essence Rend", no spell in this Journal) follows its casts: a drag shifts that one cast
    CRT.db.alerts.reminders = {}
    local rid = CRT.AlertReminders:Save(3001, nil, { text = "Essence Rend", boss = "Nek'zali the Soulcoiler" })
    local nv = View.Create(mock("Frame"))
    nv:SetData({ reference = nek }, 3001, nil, "Nek'zali")
    local rtimes, source = CRT.AlertReminders:Times(3001, CRT.AlertReminders:Get(3001, rid))
    assert(source == "reference" and #rtimes >= 2, "timed from the reference: " .. tostring(source))
    local first = CRT.AlertReminders.AbsoluteTime(nek, rtimes[1].ph, rtimes[1].t)
    local rf = flagAt(nv, first, true)
    assert(rf and rf.mark.index == 1, "reference time flag")
    drag(nv, rf, 30)
    local rr = CRT.AlertReminders:Get(3001, rid)
    assert(rr.times == nil and rr.shifts and rr.shifts.mythic and rr.shifts.mythic["P1@0:20"] == 10,
      "a shift on that cast, no typed times: " .. tostring(rr.times))
    local after = CRT.AlertReminders:Times(3001, rr)
    assert(#after == #rtimes and after[1].t == 30 and after[2].t == rtimes[2].t, "every cast still followed, the first moved")
    -- dragged to the left edge lands at 0
    CRT.db.alerts.reminders = {}
    local cid = CRT.AlertReminders:Save(3001, nil, { text = "C", times = "P1 0:40", boss = "Nek" })
    v:Refresh()
    drag(v, flagAt(v, 40, true), 0)
    assert(timesOf(cid) == "P1 0:00", "clamped to 0: " .. tostring(timesOf(cid)))
  end
  print("ok drag: move a reminder time")

  do
    local v, id = setup("P1 0:40")
    drag(v, flagAt(v, 40, true), 100, true)
    assert(timesOf(id) == "P1 0:40; P2 +0:40", "alt added a time: " .. tostring(timesOf(id)))
    assert(flagAt(v, 40, true) and flagAt(v, 100, true), "both flags")
    assert(not Rem:SetTime(3001, id, 5, 1, 1) and not Rem:AddTime(3001, 99, 1, 1), "bad index or id refused")
  end
  print("ok drag: alt adds a reminder time")

  do
    local v = setup(nil)
    local f = flagAt(v, 20, false)
    assert(f.mark.kind == "note" and f.mark.noteID == 1 and f.mark.line == 2 and f.mark.expected == "time:20;ph:1;spellid:4242;text:Soak;DisplayType:Text;", "note flag knows its source: " .. tostring(f.mark.expected))
    drag(v, f, 100)
    local lines = {}
    for l in (CRT.db.notes.list[1].raw .. "\\n"):gmatch("([^\\n]*)\\n") do lines[#lines + 1] = l end
    assert(#lines == 3 and lines[1] == "EncounterID:3001;Difficulty:Heroic;Name:Nek" and lines[3] == "time:45;ph:1;text:Other;", "other lines kept")
    local moved
    for _, x in ipairs(CRT.NoteParser.Parse(CRT.db.notes.list[1].raw).timers) do if x.line == 2 then moved = x end end
    assert(moved and moved.ph == 2 and moved.time == 40 and moved.spellId == 4242 and moved.text == "Soak", "moved to P2 +40, rest kept")
    assert(lines[2]:find("DisplayType:Text;", 1, true), "unknown field kept: " .. lines[2])
    assert(flagAt(v, 100, false) and not flagAt(v, 20, false), "redrawn")
  end
  print("ok drag: move a note line")

  do
    local v = setup(nil)
    drag(v, flagAt(v, 20, false), 100, true)
    local count = 0
    for _ in CRT.db.notes.list[1].raw:gmatch("spellid:4242") do count = count + 1 end
    assert(count == 2, "a new line in the same note: " .. CRT.db.notes.list[1].raw)
    assert(flagAt(v, 20, false) and flagAt(v, 100, false), "both flags")
    local newest
    for _, x in ipairs(CRT.NoteParser.Parse(CRT.db.notes.list[1].raw).timers) do if x.ph == 2 then newest = x end end
    assert(newest and newest.time == 40 and newest.text == "Soak", "identical line at the new time")
    local dt = 0
    for _ in CRT.db.notes.list[1].raw:gmatch("DisplayType:Text;") do dt = dt + 1 end
    assert(dt == 2, "unknown field copied too")
  end
  print("ok drag: alt adds a note line")

  do
    local v, id = setup("P1 0:40")
    local f = flagAt(v, 40, true)
    cx = screenX(v, 40)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 100)
    alt = true
    v.frame.OnUpdate(v.frame)
    assert(v.ghost and v.ghost.label:GetText() == "Alt \\194\\183 add a time 1:40" and v.ghost:IsShown(), "label while Alt held: " .. tostring(v.ghost and v.ghost.label:GetText()))
    alt = false
    v.frame.OnUpdate(v.frame)
    assert(v.ghost.label:GetText() == "Move to 1:40", "label without Alt: " .. tostring(v.ghost.label:GetText()))
    -- Alt let go before the mouse: release moves
    alt = true v.frame.OnUpdate(v.frame) alt = false
    f.OnMouseUp(f, "LeftButton")
    assert(timesOf(id) == "P2 +0:40", "alt let go first moves: " .. tostring(timesOf(id)))
    assert(not v.ghost:IsShown(), "ghost hidden after release")
    -- Alt pressed only at the end: adds
    drag(v, flagAt(v, 100, true), 130, true, false)
    assert(timesOf(id) == "P2 +0:40, +1:10" and flagAt(v, 100, true) and flagAt(v, 130, true), "alt only at release adds: " .. tostring(timesOf(id)))
  end
  print("ok drag: alt read at release")

  do
    local v, id = setup("P1 0:40")
    local f = flagAt(v, 40, true)
    cx = screenX(v, 40)
    f.OnMouseDown(f, "LeftButton")
    cx = cx + 3
    v.frame.OnUpdate(v.frame)
    assert(not (v.ghost and v.ghost:IsShown()), "no ghost under 4 px")
    f.OnMouseUp(f, "LeftButton")
    assert(timesOf(id) == "P1 0:40" and #printed == 0, "nothing written")
    -- double-click still opens the editor
    f.OnMouseDown(f, "LeftButton") f.OnMouseUp(f, "LeftButton") f.OnMouseDown(f, "LeftButton")
    f.OnDoubleClick(f, "LeftButton")
    f.OnMouseUp(f, "LeftButton")
    assert(#opened == 1 and timesOf(id) == "P1 0:40", "double-click opens, nothing moves")
    assert(v.move == nil, "move state cleared")
  end
  print("ok drag: small move is a click")

  do
    local v = setup(nil)
    local f = flagAt(v, 20, false)
    cx = screenX(v, 20)
    f.OnMouseDown(f, "LeftButton")
    -- the leader shares again while the flag is held
    local changed = rawNote:gsub("text:Soak;", "text:Soak changed;")
    CRT.db.notes.list[1].raw = changed
    cx = screenX(v, 100)
    v.frame.OnUpdate(v.frame)
    f.OnMouseUp(f, "LeftButton")
    assert(CRT.db.notes.list[1].raw == changed, "note untouched")
    assert(#printed == 1 and printed[1]:find("changed"), "one chat line: " .. tostring(printed[1]))
    -- the same for Alt
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 130)
    alt = true
    f.OnMouseUp(f, "LeftButton")
    alt = false
    assert(CRT.db.notes.list[1].raw == changed and #printed == 2, "alt refused too")
    assert(not v.ghost:IsShown(), "ghost gone")
  end
  print("ok drag: stale note line refused")

  do
    local v, id = setup("P1 0:40")
    CRT.db.timeline.span = 60
    v:Refresh()
    v:ScrollTo(40)
    local f = flagAt(v, 40, true)
    f.OnMouseDown(f, "RightButton")
    assert(v.move == nil and v.dragX ~= nil, "right button starts a scroll, not a move")
    local before = v.hscroll:GetHorizontalScroll()
    cx = cx - 30
    v.frame.OnUpdate(v.frame)
    assert(v.hscroll:GetHorizontalScroll() ~= before, "scrolled")
    f.OnMouseUp(f, "RightButton")
    assert(v.dragX == nil and timesOf(id) == "P1 0:40", "nothing moved")
    CRT.db.timeline.span = 300
    v:Refresh()
  end
  print("ok drag: right-drag still scrolls")

  -- a redraw mid-drag (the note is edited through UpdateRaw, which fires OnChange) refuses the write
  do
    local v = setup(nil)
    local f = flagAt(v, 20, false)
    cx = screenX(v, 20)
    f.OnMouseDown(f, "LeftButton")
    local changed = rawNote:gsub("text:Soak;", "text:Soak changed;")
    Notes:UpdateRaw(1, changed)
    assert(f.mark.expected ~= nil and f.mark.expected:find("Soak changed", 1, true), "the pooled flag was redrawn for the new line")
    cx = screenX(v, 100)
    v.frame.OnUpdate(v.frame)
    f.OnMouseUp(f, "LeftButton")
    assert(CRT.db.notes.list[1].raw == changed, "note untouched after a redraw mid-drag")
    assert(#printed == 1 and printed[1]:find("changed since you grabbed it", 1, true), "refused: " .. tostring(printed[1]))
    assert(flagAt(v, 20, false) and not flagAt(v, 100, false), "flag unchanged")
    -- the reminder's time changed under the grab: refused too
    local v2, id = setup("P1 0:40")
    local g = flagAt(v2, 40, true)
    cx = screenX(v2, 40)
    g.OnMouseDown(g, "LeftButton")
    local r = CRT.AlertReminders:Get(3001, id)
    r.times = "P1 0:55"
    CRT.Alerts:Fire()
    cx = screenX(v2, 100)
    g.OnMouseUp(g, "LeftButton")
    assert(timesOf(id) == "P1 0:55" and #printed == 1, "a changed reminder time refused")
  end
  print("ok drag: redraw mid-drag refuses")

  -- a redraw that hands the pooled flag to another alert: the release still moves the grabbed one
  do
    local v, id = setup("P1 0:40")
    local f = flagAt(v, 40, true)
    cx = screenX(v, 40)
    f.OnMouseDown(f, "LeftButton")
    CRT.db.notes.list[7] = { raw = "EncounterID:3001;Difficulty:Normal;Name:Nek\\ntime:5;ph:1;text:First;", encounterID = 3001, difficulty = "Normal", name = "Nek" }
    Notes:Fire()
    assert(f.mark.kind == "note", "the pooled flag now belongs to another alert: " .. tostring(f.mark.kind))
    cx = screenX(v, 100)
    v.frame.OnUpdate(v.frame)
    f.OnMouseUp(f, "LeftButton")
    CRT.db.notes.list[7] = nil
    assert(timesOf(id) == "P2 +0:40" and #printed == 0, "the grabbed reminder moved: " .. tostring(timesOf(id)))
    assert(CRT.db.notes.list[7] == nil, "the other alert untouched")
  end
  print("ok drag: redraw hands the flag to another alert")

  -- Alt adds to the grabbed note, not to FindForEncounter's pick
  do
    local v = setup(nil)
    CRT.db.notes.list[2] = { raw = "EncounterID:3001;Difficulty:Mythic;Name:Nek\\ntime:25;ph:1;spellid:4242;text:Mythic one;", encounterID = 3001, difficulty = "Mythic", name = "Nek" }
    v:Refresh()
    local before2 = CRT.db.notes.list[2].raw
    local f = flagAt(v, 25, false)
    assert(f.mark.noteID == 2, "the mythic line")
    drag(v, f, 100, true)
    -- note 1 (Heroic) is what FindForEncounter(3001, "Mythic") would not pick first; either way, note 2 gains it
    assert(CRT.db.notes.list[2].raw:find("\\ntime:25;ph:1;spellid:4242;text:Mythic one;\\ntime:40;ph:2;", 1, true) ~= nil or CRT.db.notes.list[2].raw:find("ph:2;", 1, true), "added to its own note: " .. CRT.db.notes.list[2].raw)
    assert(CRT.db.notes.list[1].raw == rawNote, "the other note untouched")
    CRT.db.notes.list[2] = nil
  end
  print("ok drag: alt adds to the grabbed note")

  -- release off the track cancels; so does the left button found up with the cursor off the track
  do
    local v, id = setup("P1 0:40")
    local f = flagAt(v, 40, true)
    cx = screenX(v, 40)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 100)
    cy = 100 -- below the window
    v.frame.OnUpdate(v.frame)
    f.OnMouseUp(f, "LeftButton")
    assert(timesOf(id) == "P1 0:40" and #printed == 0 and not v.ghost:IsShown(), "release below the track cancels")
    cy = 300
    f.OnMouseDown(f, "LeftButton")
    cx = 750 -- right of the window
    mouseDown = false
    v.frame.OnUpdate(v.frame)
    mouseDown = true
    assert(timesOf(id) == "P1 0:40" and v.move == nil and not v.ghost:IsShown(), "button found up off the track cancels")
    -- found up over the track: applies
    cx = screenX(v, 40)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 100)
    mouseDown = false
    v.frame.OnUpdate(v.frame)
    mouseDown = true
    assert(timesOf(id) == "P2 +0:40", "button found up over the track applies: " .. tostring(timesOf(id)))
    -- Alt at the same time adds nothing
    local g = flagAt(v, 100, true)
    cx = screenX(v, 100)
    g.OnMouseDown(g, "LeftButton")
    cx = cx + 1
    drag(v, g, 100.04, true)
    assert(timesOf(id) == "P2 +0:40", "alt at the same time does nothing")
  end
  print("ok drag: release off the track cancels")

  -- a release over the open alert editor (above the track) cancels; the editor hidden, it applies
  do
    local v, id = setup("P1 0:40")
    editorFrame:Show() overEditor = true
    drag(v, flagAt(v, 40, true), 100)
    assert(timesOf(id) == "P1 0:40" and #printed == 0 and not v.ghost:IsShown(), "released over the editor: cancelled")
    drag(v, flagAt(v, 40, true), 100, true)
    assert(timesOf(id) == "P1 0:40", "alt released over the editor: cancelled")
    editorFrame:Hide()
    drag(v, flagAt(v, 40, true), 100)
    assert(timesOf(id) == "P2 +0:40", "hidden editor: applies: " .. tostring(timesOf(id)))
    overEditor = false
  end
  print("ok drag: release over the editor cancels")

  -- the label stays inside the visible track
  do
    local v = setup("P1 0:40")
    CRT.db.timeline.span = 60
    v:Refresh()
    v:ScrollTo(20)
    local hs, vis = v.hscroll:GetHorizontalScroll(), v:VisibleWidth()
    local checked = 0
    for _, f in ipairs(flags(v)) do
      local m = f.mark
      -- grab at the flag's own place when it is on screen, then drag to each edge and the middle
      local gx = screenX(v, m.t)
      if gx >= 100 and gx <= 700 then
        for _, sx in ipairs({ 101, 400, 699 }) do
          cx = gx
          f.OnMouseDown(f, "LeftButton")
          cx = sx
          v.frame.OnUpdate(v.frame)
          local lx = v.ghost.label.pt[4]
          local w = #v.ghost.label:GetText() * 6
          assert(lx >= hs and lx + w <= hs + vis, "label inside the visible track (row " .. m.row .. "): " .. lx .. " w " .. w .. " [" .. hs .. "," .. hs + vis .. "]")
          v:CancelMove()
          checked = checked + 1
        end
      end
    end
    assert(checked >= 3, "flags checked: " .. checked)
    CRT.db.timeline.span = 300
    v:Refresh()
  end
  print("ok drag: label stays visible")

  -- the phase mask: a phase 1 time at or after the P2 line (1:00) has no flag; nothing is deleted
  do
    local v, id = setup("P1 0:55, 1:05; P2 0:10")
    assert(flagAt(v, 55, true), "P1 0:55 before the P2 line keeps its flag")
    assert(not flagAt(v, 65, true), "P1 1:05 past the P2 line is hidden")
    assert(flagAt(v, 65, true) == nil and flagAt(v, 65, false) == nil, "nothing drawn at 1:05")
    assert(timesOf(id) == "P1 0:55, 1:05; P2 0:10", "the reminder keeps every time: " .. tostring(timesOf(id)))
    local R = CRT.AlertReminders
    assert(R.PhaseCut(ref, 1) == 60 and R.PhaseCut(ref, 2) == nil and R.PhaseCut(nil, 1) == nil)
  end
  print("ok mask: flags past a later phase line hide")

  -- the chosen order: a part's flag sits where its part now is; a drag and a pick go back to the written order
  do
    local realShift = CRT.Timeline.OrderShift
    CRT.Timeline.OrderShift = function(_, eid)
      if eid ~= 3001 then return nil end
      return function(spellID, text, t)
        if spellID == 4242 or spellID == 4343 then return t + 10 end
        if text == "Other" then return false end
        return t
      end, function(spellID, text, t)
        if spellID == 4242 or spellID == 4343 then return t - 10 end
        return t
      end
    end
    local v, id = setup("P1 0:20")
    assert(flagAt(v, 30, true) and not flagAt(v, 20, true), "the reminder for the part's spell moved 0:20 -> 0:30")
    assert(flagAt(v, 30, false), "the raid line for that spell (Soak, 0:20) moved too")
    assert(not flagAt(v, 45, false), "a line past its new window is hidden")
    drag(v, flagAt(v, 30, true), 45)
    assert(timesOf(id) == "P1 0:35", "a drag to 0:45 on screen stores the written 0:35: " .. tostring(timesOf(id)))
    assert(v:WrittenTime(4242, nil, 50) == 40 and v:WrittenTime(nil, "x", 50) == 50, "a picked time goes back to the written order")
    CRT.Timeline.OrderShift = realShift
  end
  print("ok order: flags follow the chosen order")

  -- spell icons on markers: the icon in the flag's color as an edge, the plain flag without a spell
  do
    local v, id = setup("P1 0:40")
    CRT.AlertReminders:Save(3001, nil, { text = "By icon", times = "P1 0:55", boss = "Nek", iconID = 135940 })
    v:Refresh()
    local accent, text = CRT.PALETTE.accent, CRT.PALETTE.text
    local rem = flagAt(v, 40, true)
    assert(rem.icon.shown and rem.icon.tex == "tex4343", "reminder with a spell shows its icon: " .. tostring(rem.icon.tex))
    assert(rem.edge.shown and rem.edge.color[1] == text[1] and rem.edge.color[2] == text[2], "text-coloured edge on your reminder")
    assert(rem.head.shown == false, "no flag head under an icon")
    assert(rem.icon.w == 18 and rem.icon.h == 18 and rem.w == 20 and rem.h == 20, "the icon sits inside the 20 x 20 button")
    local note = flagAt(v, 20, false)
    assert(note.icon.shown and note.icon.tex == "tex4242" and note.edge.color[1] == accent[1] and note.edge.color[2] == accent[2], "raid note line with a spell: icon, accent edge")
    local plain = flagAt(v, 45, false)
    assert(plain.mark.spellID == nil and plain.icon.shown == false and plain.edge.shown == false and plain.head.shown ~= false, "a text line keeps the plain flag")
    local byIcon = flagAt(v, 55, true)
    assert(byIcon.icon.shown and byIcon.icon.tex == 135940, "an icon ID shows too: " .. tostring(byIcon.icon.tex))
    -- a spell whose icon can't be read falls back to the flag
    local real = C_Spell.GetSpellTexture
    C_Spell.GetSpellTexture = function() error("secret") end
    v:Refresh()
    assert(flagAt(v, 40, true).icon.shown == false and flagAt(v, 40, true).head.shown ~= false, "unreadable icon: the plain flag")
    C_Spell.GetSpellTexture = real
    -- the pooled flag handed to a line without a spell loses the icon
    CRT.db.alerts.reminders = {}
    v:Refresh()
    for _, f in ipairs(flags(v)) do
      if not f.mark.spellID then assert(f.icon.shown == false and f.head.shown ~= false, "icon cleared on a reused flag") end
    end
  end
  print("ok marks: spell icons on markers")

  local function rclick(v, f, dx, dt)
    cx, cy = screenX(v, f.mark.t), laneY(f.mark.row)
    for i = #menus, 1, -1 do menus[i] = nil end
    f.OnMouseDown(f, "RightButton")
    now = now + (dt or 0.1)
    cx = cx + (dx or 0)
    f.OnMouseUp(f, "RightButton")
    return menus[1]
  end
  local function find(d, text) for _, x in ipairs(d.items) do if x.text == text then return x end end end
  local function popupsClear() for i = #popups, 1, -1 do popups[i] = nil end for i = #lifted, 1, -1 do lifted[i] = nil end end

  -- right-click on a flag: a menu with Edit and Delete
  do
    local v, id = setup("P1 0:40")
    local f = flagAt(v, 40, true)
    local menu = rclick(v, f, 3)
    assert(menu and #menus == 1 and menu.owner == f, "a right-click on a flag opens its menu")
    local titles = {}
    for _, x in ipairs(menu.root.items) do titles[#titles + 1] = x.kind .. ":" .. tostring(x.text) end
    assert(table.concat(titles, "|") == "title:Mine \\194\\183 P1 0:40|button:Edit|button:Delete", "menu items: " .. table.concat(titles, "|"))
    assert(not find(menu.root, "Copy") and not find(menu.root, "Place"), "no Copy, and not the track's menu")
    find(menu.root, "Edit").fn()
    assert(#opened == 1 and opened[1].enc == 3001 and opened[1].id == id and opened[1].prefill == nil, "Edit opens the reminder like a double-click")
    local nf = flagAt(v, 20, false)
    menu = rclick(v, nf)
    assert(menu and menu.root.items[1].text == "Soak \\194\\183 P1 0:20", "note line title: " .. tostring(menu and menu.root.items[1].text))
    find(menu.root, "Edit").fn()
    assert(#notesOpened == 1 and notesOpened[1].noteID == 1 and notesOpened[1].line == 2, "Edit opens the note line")
    -- the click does not move the view or the alert
    assert(timesOf(id) == "P1 0:40" and v.hscroll:GetHorizontalScroll() == 0, "nothing moved")
    -- too slow, or moved too far: no menu
    assert(rclick(v, flagAt(v, 40, true), 0, 0.5) == nil, "held 0.5 s: no menu")
    assert(rclick(v, flagAt(v, 40, true), 10) == nil, "moved 10 px: no menu")
    -- no menu API: nothing breaks
    local real = MenuUtil
    MenuUtil = nil
    for i = #printed, 1, -1 do printed[i] = nil end
    rclick(v, flagAt(v, 40, true))
    MenuUtil = real
    assert(#printed == 1, "no menu API: one chat line")
    -- the track still opens its own menu away from a flag
    cx, cy = screenX(v, 150), laneY(2)
    for i = #menus, 1, -1 do menus[i] = nil end
    v.hscroll.OnMouseDown(v.hscroll, "RightButton") v.hscroll.OnMouseUp(v.hscroll, "RightButton")
    assert(#menus == 1 and find(menus[1].root, "New alert here"), "track menu intact")
  end
  print("ok marks: right-click on a flag opens Edit and Delete")

  -- right-drag on a flag still scrolls and opens no menu
  do
    local v, id = setup("P1 0:40")
    CRT.db.timeline.span = 60
    v:Refresh()
    v:ScrollTo(40)
    local f = flagAt(v, 40, true)
    for i = #menus, 1, -1 do menus[i] = nil end
    f.OnMouseDown(f, "RightButton")
    local before = v.hscroll:GetHorizontalScroll()
    cx = cx - 30
    v.frame.OnUpdate(v.frame)
    f.OnMouseUp(f, "RightButton")
    assert(v.hscroll:GetHorizontalScroll() ~= before and #menus == 0, "scrolled, no menu")
    CRT.db.timeline.span = 300
    v:Refresh()
  end
  print("ok marks: right-drag on a flag scrolls, no menu")

  -- Delete: confirm, then one time of several / the whole reminder / a note line
  do
    local v, id = setup("P1 0:40, 0:50")
    local f = flagAt(v, 50, true)
    popupsClear()
    find(rclick(v, f).root, "Delete").fn()
    assert(#popups == 1 and popups[1].callback and popups[1].showAlert and #lifted == 1 and lifted[1].named == "GENERIC_CONFIRMATION", "a confirm popup, lifted over the editor")
    assert(popups[1].text:find("Mine", 1, true) and popups[1].text:find("other times stay", 1, true), "it says only this time goes: " .. popups[1].text)
    assert(timesOf(id) == "P1 0:40, 0:50" or timesOf(id) == "P1 0:40; P1 0:50", "nothing deleted before the confirm: " .. timesOf(id))
    popups[1].callback()
    assert(timesOf(id) == "P1 0:40" and CRT.AlertReminders:Get(3001, id).text == "Mine", "only the 0:50 time removed: " .. tostring(timesOf(id)))
    assert(flagAt(v, 40, true) and not flagAt(v, 50, true), "redrawn")
    -- the last time: the reminder goes
    popupsClear()
    find(rclick(v, flagAt(v, 40, true)).root, "Delete").fn()
    assert(popups[1].text:find("Delete your reminder", 1, true), "single time: delete the reminder: " .. popups[1].text)
    popups[1].callback()
    assert(CRT.AlertReminders:Get(3001, id) == nil and not flagAt(v, 40, true), "reminder deleted")
    -- a reminder on an ability row with several casts: the delete turns that cast off, the others stay
    CRT.db.alerts.reminders = {}
    local rid = CRT.AlertReminders:Save(3001, nil, { text = "Essence Rend", boss = "Nek'zali the Soulcoiler" })
    local nv = View.Create(mock("Frame"))
    nv:SetData({ reference = nek }, 3001, nil, "Nek'zali")
    local rtimes = CRT.AlertReminders:Times(3001, CRT.AlertReminders:Get(3001, rid))
    local first = CRT.AlertReminders.AbsoluteTime(nek, rtimes[1].ph, rtimes[1].t)
    popupsClear()
    find(rclick(nv, flagAt(nv, first, true)).root, "Delete").fn()
    popups[1].callback()
    local want = {}
    for i = 2, #rtimes do want[#want + 1] = rtimes[i] end
    local rr = CRT.AlertReminders:Get(3001, rid)
    assert(rr.times == nil and rr.off and rr.off.mythic and rr.off.mythic["P1@0:20"] == true, "that cast off, no typed times")
    assert(CRT.AlertReminders.FormatTimes(CRT.AlertReminders:Times(3001, rr)) == CRT.AlertReminders.FormatTimes(want), "the others stay")
    assert(not Rem:RemoveTime(3001, rid, 99) and not Rem:RemoveTime(3001, 12345, 1), "bad index or id refused")
    CRT.db.alerts.reminders = {}
    local one = Rem:Save(3001, nil, { text = "One", times = "P1 0:40", boss = "Nek" })
    assert(not Rem:RemoveTime(3001, one, 1) and Rem:Get(3001, one), "a single time is not removed by RemoveTime")
  end
  print("ok marks: delete a reminder time or the reminder")

  do
    local v = setup(nil)
    local f = flagAt(v, 20, false)
    popupsClear()
    find(rclick(v, f).root, "Delete").fn()
    assert(#popups == 1 and popups[1].text:find("Delete this raid note line", 1, true) and popups[1].text:find("Soak", 1, true), "note confirm: " .. popups[1].text)
    assert(CRT.db.notes.list[1].raw == rawNote, "note kept until confirmed")
    popups[1].callback()
    local lines = {}
    for l in (CRT.db.notes.list[1].raw .. "\\n"):gmatch("([^\\n]*)\\n") do lines[#lines + 1] = l end
    assert(#lines == 2 and lines[1] == "EncounterID:3001;Difficulty:Heroic;Name:Nek" and lines[2] == "time:45;ph:1;text:Other;", "only the line removed: " .. CRT.db.notes.list[1].raw)
    assert(not flagAt(v, 20, false) and flagAt(v, 45, false), "redrawn")
    assert(#printed == 0, "no refusal")
  end
  print("ok marks: delete a note line")

  -- stale: the alert changed between the menu and the confirm
  do
    local v = setup(nil)
    popupsClear()
    find(rclick(v, flagAt(v, 20, false)).root, "Delete").fn()
    local changed = rawNote:gsub("text:Soak;", "text:Soak changed;")
    Notes:UpdateRaw(1, changed)
    popups[1].callback()
    assert(CRT.db.notes.list[1].raw == changed, "stale note line not deleted")
    assert(#printed == 1 and printed[1]:find("changed since", 1, true) and printed[1]:find("nothing was deleted", 1, true), "refusal: " .. tostring(printed[1]))
    local v2, id = setup("P1 0:40, 0:50")
    popupsClear()
    find(rclick(v2, flagAt(v2, 50, true)).root, "Delete").fn()
    CRT.AlertReminders:Get(3001, id).times = "P1 0:40, 0:52"
    popups[1].callback()
    assert(CRT.AlertReminders:Get(3001, id).times == "P1 0:40, 0:52" and #printed == 1, "stale reminder time not deleted")
    -- the reminder itself gone
    popupsClear()
    find(rclick(v2, flagAt(v2, 40, true)).root, "Delete").fn()
    CRT.AlertReminders:Delete(3001, id)
    popups[1].callback()
    assert(#printed == 2 and printed[2]:find("changed since", 1, true), "deleted reminder: refused, no error")
  end
  print("ok marks: stale delete refused")

  -- Personal notes -------------------------------------------------------------------------------
  do
    local v, id = setup("P1 0:40")
    CRT.AlertReminders:Save(3001, nil, { text = "No spell", times = "P1 0:55", boss = "Nek" })
    v:Refresh()
    local personal = laneIndex(v, "Personal notes")
    local lane = v.lanes[personal]
    assert(personal == #v.lanes and lane.key == "personal" and lane.kind == "personal", "Personal notes is the last lane")
    local soul = laneIndex(v, "Soulcoil")
    for _, f in ipairs(flags(v)) do
      if f.mark.mine then
        assert(f.mark.row == personal, "a reminder only on Personal notes: row " .. tostring(f.mark.row))
      else
        assert(f.mark.row ~= personal, "a raid note line never on Personal notes")
      end
    end
    assert(flagAt(v, 40, true).mark.spellID == 4343 and flagAt(v, 40, true).icon.tex == "tex4343", "with its spell icon")
    assert(flagAt(v, 20, false).mark.row == soul, "the raid line stays on its spell row")
    assert(flagAt(v, 45, false).mark.row == laneIndex(v, "Notes"), "a text raid line stays on Notes")
    -- the (?) on its label
    local h = v.personalHelp
    assert(h and h:IsShown() and h.helpTitle == "Personal notes" and h.helpText:find("only yours", 1, true) and h.helpText:find("your PC", 1, true), "a (?) on Personal notes: " .. tostring(h and h.helpText))
    assert(h.pt and h.pt[2] == v.labels[personal], "anchored to its label")
    -- moving a personal flag changes only its time; it stays on Personal notes
    drag(v, flagAt(v, 40, true), 100)
    assert(timesOf(id) == "P2 +0:40" and flagAt(v, 100, true).mark.row == personal, "moved, still on Personal notes")
    local r = CRT.AlertReminders:Get(3001, id)
    assert(r.spellID == 4343 and r.text == "Mine" and r.priority == "high", "only the time changed")
  end
  print("ok personal: only on its row")

  do
    -- no reminders, no notes: the row is there, last
    local v = View.Create(mock("Frame"))
    CRT.db.alerts.reminders = {}
    v:SetData({ reference = ref }, 4000, nil, "Empty")
    assert(v.lanes[#v.lanes].label == "Personal notes" and #flags(v) == 0, "an empty Personal notes row")
    assert(v.personalHelp and v.personalHelp:IsShown(), "its (?) shows")
    -- a recorded pull
    local p = { id = 1, encounterID = 3001, length = 200, casts = { { t = 10, spellID = 0 } }, deaths = {} }
    v:SetData(p, 3001, nil, "Alpha")
    assert(v.lanes[#v.lanes].label == "Personal notes", "on a recorded pull too")
    -- a boss known only by name
    local nameOnly = assert(CRT.TimelineReference.Parse("Boss: Named\\nA: 0:10"))
    v:SetData({ reference = nameOnly }, "ref:named", nil, "Named")
    assert(v.lanes[#v.lanes].label == "Personal notes", "a boss without an encounter ID")
    -- no boss: no lanes, the (?) hidden
    v:SetData(nil, nil, nil, nil)
    assert(#v.lanes == 0 and not v.personalHelp:IsShown(), "no boss: no row, no (?)")
    -- exactly one Personal notes lane after several redraws
    v:SetData({ reference = ref }, 3001, nil, "Nek")
    v:Refresh() v:Refresh()
    local count = 0
    for _, l in ipairs(v.lanes) do if l.kind == "personal" then count = count + 1 end end
    assert(count == 1, "one Personal notes lane: " .. count)
  end
  print("ok personal: row always present")

  do
    local v = setup(nil)
    local personal = laneIndex(v, "Personal notes")
    doubleAt(v, 70, personal)
    assert(#opened == 1, "double-click on Personal notes opens the editor")
    local p = opened[1].prefill
    assert(opened[1].enc == 3001 and opened[1].id == nil and p.saveAs == "mine" and p.ph == 2 and p.time == 10 and p.spellID == nil, "a blank personal alert at the clicked time")
    -- a raid member too
    asMember()
    reset()
    doubleAt(v, 30, personal)
    assert(#opened == 1 and opened[1].prefill.saveAs == "mine" and opened[1].prefill.time == 30, "a member gets one too")
    asSolo()
  end
  print("ok personal: double-click makes a personal alert")

  do
    local v, id = setup("P1 0:40")
    asMember()
    local f = flagAt(v, 20, false)
    -- drag: no ghost, no write
    cx = screenX(v, 20)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 100)
    v.frame.OnUpdate(v.frame)
    assert(not (v.ghost and v.ghost:IsShown()), "no ghost for a member")
    f.OnMouseUp(f, "LeftButton")
    assert(CRT.db.notes.list[1].raw == rawNote, "the raid line did not move")
    -- Alt+drag: nothing added
    drag(v, flagAt(v, 20, false), 100, true)
    assert(CRT.db.notes.list[1].raw == rawNote and not flagAt(v, 100, false), "Alt+drag adds nothing")
    -- the double-click still opens it (read-only, by the editor)
    reset()
    f = flagAt(v, 20, false)
    f.OnMouseDown(f, "LeftButton") f.OnMouseUp(f, "LeftButton") f.OnMouseDown(f, "LeftButton")
    f.OnDoubleClick(f, "LeftButton")
    f.OnMouseUp(f, "LeftButton")
    assert(#notesOpened == 1 and notesOpened[1].noteID == 1 and notesOpened[1].line == 2, "double-click opens the line")
    assert(CRT.db.notes.list[1].raw == rawNote, "still unmoved")
    -- a move started as an admin and let go after a demotion is refused with the reason
    asSolo()
    f = flagAt(v, 20, false)
    cx = screenX(v, 20)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 100)
    v.frame.OnUpdate(v.frame)
    asMember()
    for i = #printed, 1, -1 do printed[i] = nil end
    f.OnMouseUp(f, "LeftButton")
    assert(CRT.db.notes.list[1].raw == rawNote and #printed == 1 and printed[1]:find("raid leader or assistants", 1, true), "demoted mid-drag: refused: " .. tostring(printed[1]))
    -- your own reminder still drags
    drag(v, flagAt(v, 40, true), 100)
    assert(timesOf(id) == "P2 +0:40", "a member's reminder moves: " .. tostring(timesOf(id)))
    drag(v, flagAt(v, 100, true), 130, true)
    assert(timesOf(id) == "P2 +0:40, +1:10", "and Alt adds a time: " .. tostring(timesOf(id)))
    asSolo()
  end
  print("ok raid: non-admin can't drag")

  do
    local v, id = setup("P1 0:40")
    asMember()
    local menu = rclick(v, flagAt(v, 20, false))
    local titles = {}
    for _, x in ipairs(menu.root.items) do titles[#titles + 1] = x.kind .. ":" .. tostring(x.text) end
    assert(table.concat(titles, "|") == "title:Soak \\194\\183 P1 0:20|button:View", "member's raid line menu: " .. table.concat(titles, "|"))
    find(menu.root, "View").fn()
    assert(#notesOpened == 1 and notesOpened[1].noteID == 1 and notesOpened[1].line == 2, "View opens the line")
    -- a Delete confirmed after a demotion is refused with the reason
    asSolo()
    popupsClear()
    find(rclick(v, flagAt(v, 20, false)).root, "Delete").fn()
    asMember()
    for i = #printed, 1, -1 do printed[i] = nil end
    popups[1].callback()
    assert(CRT.db.notes.list[1].raw == rawNote and #printed == 1 and printed[1]:find("raid leader or assistants", 1, true), "demoted before the confirm: refused: " .. tostring(printed[1]))
    -- your own reminder keeps Edit and Delete
    menu = rclick(v, flagAt(v, 40, true))
    titles = {}
    for _, x in ipairs(menu.root.items) do titles[#titles + 1] = x.kind .. ":" .. tostring(x.text) end
    assert(table.concat(titles, "|") == "title:Mine \\194\\183 P1 0:40|button:Edit|button:Delete", "member's reminder menu: " .. table.concat(titles, "|"))
    asSolo()
  end
  print("ok raid: non-admin menu shows View, no Delete")

  do
    local v = setup(nil)
    asMember()
    local menu = rclick(v, flagAt(v, 20, false))
    assert(find(menu.root, "View") and not find(menu.root, "Delete"), "a member first")
    -- promoted to assistant: no reload, no redraw
    group.assist = true
    menu = rclick(v, flagAt(v, 20, false))
    assert(find(menu.root, "Edit") and find(menu.root, "Delete") and not find(menu.root, "View"), "promoted: Edit and Delete")
    drag(v, flagAt(v, 20, false), 100)
    local moved
    for _, x in ipairs(CRT.NoteParser.Parse(CRT.db.notes.list[1].raw).timers) do if x.line == 2 then moved = x end end
    assert(moved and moved.ph == 2 and moved.time == 40, "promoted: the drag moves the line")
    asSolo()
  end
  print("ok raid: promotion unlocks")

  do
    -- the raid leader (and solo) see what they saw before
    for _, who in ipairs({ "leader", "solo" }) do
      local v = setup(nil)
      if who == "leader" then group.raid, group.party, group.leader = true, true, true end
      local menu = rclick(v, flagAt(v, 20, false))
      local titles = {}
      for _, x in ipairs(menu.root.items) do titles[#titles + 1] = x.kind .. ":" .. tostring(x.text) end
      assert(table.concat(titles, "|") == "title:Soak \\194\\183 P1 0:20|button:Edit|button:Delete", who .. ": menu " .. table.concat(titles, "|"))
      local f = flagAt(v, 20, false)
      cx = screenX(v, 20)
      f.OnMouseDown(f, "LeftButton")
      cx = screenX(v, 100)
      v.frame.OnUpdate(v.frame)
      assert(v.ghost:IsShown() and v.ghost.label:GetText() == "Move to 1:40", who .. ": the ghost")
      f.OnMouseUp(f, "LeftButton")
      assert(flagAt(v, 100, false) and not flagAt(v, 20, false), who .. ": moved")
      popupsClear()
      find(rclick(v, flagAt(v, 100, false)).root, "Delete").fn()
      popups[1].callback()
      assert(not flagAt(v, 100, false) and #printed == 0, who .. ": deleted")
      asSolo()
    end
  end
  print("ok raid: admin unchanged")

  do
    -- (final fix T2-M1) no hover highlight on a raid flag you can't change; the tooltip stays
    local v = setup(nil)
    CRT.AlertReminders:Save(3001, nil, { text = "Own", times = "P1 0:50", boss = "Nek" })
    v:Refresh()
    asMember()
    v:Refresh()
    local raid, own = flagAt(v, 20, false), flagAt(v, 50, true)
    assert(raid:GetHighlightTexture():GetAlpha() == 0, "member: no highlight on a raid flag")
    assert(own:GetHighlightTexture():GetAlpha() == 1, "member: your reminder keeps its highlight")
    raid.OnEnter(raid)
    assert(tip[1] == "Soak", "the raid flag's tooltip stays: " .. tostring(tip[1]))
    assert(raid:GetHighlightTexture():GetAlpha() == 0, "still none on hover")
    -- promoted: the next hover has it, no redraw
    group.assist = true
    raid.OnEnter(raid)
    assert(raid:GetHighlightTexture():GetAlpha() == 1, "promoted: highlight on hover")
    asSolo()
    v:Refresh()
    assert(flagAt(v, 20, false):GetHighlightTexture():GetAlpha() == 1, "solo: highlight")
  end
  print("ok raid: no highlight on a locked flag")

  do
    -- (final fix T2-M2) the Personal notes (?) goes by the name's own width, inside the label
    local v = setup(nil)
    local personal = laneIndex(v, "Personal notes")
    local l = v.labels[personal]
    -- as in the game: the label's anchors cap what GetStringWidth measures
    l.text:SetWidth(40)
    v:Refresh()
    local own = #"Personal notes" * 6
    assert(v.personalHelp.pt[4] == math.min(42 + own, 166 - 4 - 24), "after the whole name: " .. tostring(v.personalHelp.pt[4]))
    -- a long name stops at the label's right edge
    l.text:SetWidth(nil)
    rawset(l.text, "GetUnboundedStringWidth", function() return 400 end)
    v:DrawPersonalHelp(v.lanes)
    assert(v.personalHelp.pt[4] == 166 - 4 - 24, "clamped: " .. tostring(v.personalHelp.pt[4]))
    rawset(l.text, "GetUnboundedStringWidth", nil)
  end
  print("ok personal: help placed by the name's own width")

  CRT.db.alerts.reminders = {}
  CRT.db.notes.list[1] = savedNote
end
-- Cooldown bands: the selected flag's cooldown before and after it, live while a flag drags.
do
  local savedList = CRT.db.notes.list
  local realCD = CRT.AlertCooldowns
  -- CRT_Modules/Alerts/Cooldowns.lua's Length, as the list would give it: 4242 lasts 60 s, 5151 30 s, anything else unknown
  local lengths = { [4242] = 60, [5151] = 30 }
  CRT.AlertCooldowns = { Length = function(_, id) return lengths[id] end, List = function() return {} end, Filter = function() return "mine" end }
  local accent, text, red = CRT.PALETTE.accent, CRT.PALETTE.text, { 0.89, 0.29, 0.29 }
  local HEAD = "EncounterID:3001;Difficulty:Heroic;Name:Nek\\n"
  local function setup(lines, rems)
    CRT.db.notes.list = { [1] = { raw = HEAD .. table.concat(lines or {}, "\\n"), encounterID = 3001, difficulty = "Heroic", name = "Nek" } }
    CRT.db.alerts.reminders = {}
    for _, r in ipairs(rems or {}) do r.boss = "Nek" CRT.AlertReminders:Save(3001, nil, r) end
    local v = View.Create(mock("Frame"))
    v:SetData({ reference = ref }, 3001, nil, "Nek")
    v.frame:Show() v.frame.OnShow(v.frame) -- shown, as on screen: the view takes the keys
    reset() alt = false mouseDown = true
    return v
  end
  local function shown(v) local out = {} for _, t in ipairs(v.bandTex or {}) do if t:IsShown() then out[#out + 1] = t end end return out end
  local function same(c, want) return c and math.abs(c[1] - want[1]) < 1e-6 and math.abs(c[2] - want[2]) < 1e-6 and math.abs(c[3] - want[3]) < 1e-6 end
  -- a shown band texture from x0 to x1 on the track in color, else nil
  local function bandAt(v, x0, x1, color)
    for _, t in ipairs(shown(v)) do
      if math.abs(t.pt[4] - x0) < 0.01 and math.abs(t.w - (x1 - x0)) < 0.01 and (not color or same(t.color, color)) then return t end
    end
  end
  local function reds(v) local n = 0 for _, t in ipairs(shown(v)) do if same(t.color, red) then n = n + 1 end end return n end
  local function click(v, f) cx = screenX(v, f.mark.t) f.OnMouseDown(f, "LeftButton") f.OnMouseUp(f, "LeftButton") end
  local function outlined(f) local sel = rawget(f, "sel") return sel ~= nil and sel[1]:IsShown() end
  -- the track here: 180 s over 360 px (600 px window, 300 s span), so x = 2t

  do
    local v = setup({ "time:30;ph:2;spellid:4242;tag:Abu;" })
    local f = flagAt(v, 90, false)
    assert(f and #shown(v) == 0 and not outlined(f), "nothing selected: no bands")
    click(v, f)
    assert(outlined(f), "the clicked flag is outlined")
    local sc = f.sel[1].color
    assert(math.abs(sc[1] - 0xF3 / 255) < 1e-6 and math.abs(sc[2] - 0xEC / 255) < 1e-6 and math.abs(sc[3] - 0xE0 / 255) < 1e-6, "the outline is F3ECE0")
    local row = laneIndex(v, "Soulcoil")
    local before = bandAt(v, 60, 180, accent)
    local after = bandAt(v, 180, 300, accent)
    assert(before and after, "before 0:30-1:30 and after 1:30-2:30 on its row")
    assert(math.abs(before.color[4] - 0.25) < 1e-6 and after.color[4] == before.color[4], "see-through: " .. tostring(before.color[4]))
    assert(before.pt[5] == -(row - 1) * 30 - 2 and before.h == 26 and after.pt[5] == before.pt[5], "on the flag's own row: " .. tostring(before.pt[5]))
    assert(bandAt(v, 60, 61) and bandAt(v, 299, 300), "a 1 px line at each far end")
    assert(v.bandLabel:IsShown() and v.bandLabel:GetText() == "1:00", "the length in the after bar: " .. tostring(v.bandLabel:GetText()))
    assert(v.bandFrame.level == f.level - 1, "a frame level under the flags: " .. tostring(v.bandFrame.level) .. " " .. tostring(f.level))
    assert(#opened == 0 and #notesOpened == 0, "a click opens nothing")
    -- the double-click still opens the line
    f.OnMouseDown(f, "LeftButton") f.OnDoubleClick(f, "LeftButton") f.OnMouseUp(f, "LeftButton")
    assert(#notesOpened == 1, "double-click unchanged")
  end
  print("ok bands: a click selects a flag and draws both bands")

  do
    local v = setup({ "time:30;ph:2;spellid:4242;tag:Abu;" }, { { spellID = 5151, times = "P1 0:20" } })
    local a, b = flagAt(v, 90, false), flagAt(v, 20, true)
    click(v, a)
    click(v, b)
    assert(outlined(b) and not outlined(a), "the selection moved")
    local personal = laneIndex(v, "Personal notes")
    assert(bandAt(v, 0, 40, text) and bandAt(v, 40, 100, text), "the reminder's bands, in its own colour, clamped at 0")
    assert(not bandAt(v, 60, 180), "the first flag's bands are gone")
    assert(shown(v)[1].pt[5] == -(personal - 1) * 30 - 2, "on the Personal notes row")
    -- a click on empty track clears
    cx, cy = screenX(v, 150), laneY(1)
    up(v)
    assert(not outlined(b) and #shown(v) == 0 and not v.bandLabel:IsShown(), "empty click clears")
    -- Escape while the view has keys clears too, and lets other keys through
    click(v, a)
    assert(v.frame.keyboard == true, "keys taken while the view shows")
    v.frame.OnKeyDown(v.frame, "W")
    assert(outlined(a) and v.frame.propagate == true, "other keys pass through")
    v.frame.OnKeyDown(v.frame, "ESCAPE")
    assert(not outlined(a) and #shown(v) == 0 and v.frame.propagate == false and v.frame.keyboard == true, "Escape clears and is kept; the keys stay for Ctrl+Z")
    v.frame.OnKeyDown(v.frame, "ESCAPE")
    assert(v.frame.propagate == true, "with nothing selected Escape passes through")
    -- a press that moves past the threshold is a drag, not a click: nothing selected
    cx = screenX(v, 20)
    b.OnMouseDown(b, "LeftButton") cx = cx + 30 v.frame.OnUpdate(v.frame) b.OnMouseUp(b, "LeftButton")
    for _, fl in ipairs(flags(v)) do assert(not outlined(fl), "a drag selects nothing") end
  end
  print("ok bands: one selection at a time; empty click clears")

  do
    local v = setup({ "time:30;ph:2;spellid:4242;tag:Abu;" }, { { spellID = 5151, times = "P1 0:20" } })
    local f = flagAt(v, 20, true)
    local id = f.mark.id
    click(v, f)
    v:Refresh()
    assert(outlined(flagAt(v, 20, true)) and bandAt(v, 0, 40, text), "kept on a redraw")
    -- another alert takes the flag's place in the pool: the outline follows the alert, not the button
    CRT.db.notes.list[1].raw = HEAD .. "time:5;ph:1;spellid:4242;tag:Abu;\\ntime:30;ph:2;spellid:4242;tag:Abu;"
    v:Refresh()
    local g = flagAt(v, 20, true)
    assert(outlined(g) and g.mark.id == id, "by identity")
    for _, fl in ipairs(flags(v)) do if fl ~= g then assert(not outlined(fl), "only one outlined") end end
    -- the alert gone: nothing selected
    CRT.AlertReminders:Delete(3001, id)
    for _, fl in ipairs(flags(v)) do assert(not outlined(fl), "gone with its alert") end
    assert(#shown(v) == 0, "no bands")
  end
  print("ok bands: selection survives a redraw")

  do
    local v = setup({ "time:20;ph:1;spellid:4242;tag:Abu;", "time:100;ph:2;spellid:4242;tag:Mage;", "time:110;ph:2;spellid:4242;tag:Rogue;" })
    click(v, flagAt(v, 20, false))
    assert(bandAt(v, 0, 40) and bandAt(v, 40, 160), "before clamped at 0")
    assert(not bandAt(v, -80, -79) and not bandAt(v, 0, 1), "no far line off the start")
    assert(bandAt(v, 159, 160), "the after line")
    click(v, flagAt(v, 160, false))
    assert(bandAt(v, 200, 320) and bandAt(v, 320, 360), "after clamped at the end")
    assert(not bandAt(v, 359, 360) and bandAt(v, 200, 201), "no far line past the end")
    assert(v.bandLabel:IsShown(), "1:00 fits in 40 px")
    click(v, flagAt(v, 170, false))
    assert(bandAt(v, 340, 360), "a 20 px after bar")
    assert(not v.bandLabel:IsShown(), "no label where it doesn't fit")
  end
  print("ok bands: clamped to the view")

  do
    local v = setup({
      "time:30;ph:2;spellid:4242;tag:Abu;", -- 90: selected
      "time:50;ph:2;spellid:4242;tag:Abu;", -- 110: inside after
      "time:50;ph:1;spellid:4242;tag:Abu;", -- 50: inside before
      "time:40;ph:2;spellid:4242;tag:Mage;", -- 100: another target
      "time:10;ph:2;spellid:5151;tag:Abu;", -- 70: another spell
      "time:90;ph:2;spellid:4242;tag:Abu;", -- 150: up again exactly then
    }, { { spellID = 5151, times = "P1 0:30, 0:45" } })
    click(v, flagAt(v, 90, false))
    assert(bandAt(v, 180, 220, red), "after: red from the selected cast to the one inside")
    assert(bandAt(v, 100, 180, red), "before: red from the one inside to the selected cast")
    assert(reds(v) == 2, "only the same spell for the same target: " .. reds(v))
    -- your reminders count their own times only
    click(v, flagAt(v, 30, true))
    assert(bandAt(v, 60, 90, red) and reds(v) == 1, "the reminder's other time: " .. reds(v))
  end
  print("ok bands: same spell same target inside a band turns red")

  do
    local v = setup({ "time:30;ph:1;spellid:4242;tag:Abu;", "time:90;ph:2;spellid:4242;tag:Abu;" })
    local f = flagAt(v, 30, false)
    cx = screenX(v, 30)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 50)
    v.frame.OnUpdate(v.frame)
    assert(v.ghost:IsShown() and v.ghost.label:GetText() == "Move to 0:50", "label: " .. tostring(v.ghost.label:GetText()))
    assert(bandAt(v, 0, 100) and bandAt(v, 100, 220), "the bands follow the ghost")
    cx = screenX(v, 100)
    v.frame.OnUpdate(v.frame)
    assert(v.ghost.label:GetText() == "Move to 1:40 \\194\\183 too soon", "too soon: " .. tostring(v.ghost.label:GetText()))
    assert(bandAt(v, 80, 200) and bandAt(v, 200, 320) and bandAt(v, 200, 300, red), "moved, with the clash in red")
    -- Alt adds a time: the grabbed one stays, and counts
    cx = screenX(v, 50)
    alt = true
    v.frame.OnUpdate(v.frame)
    assert(v.ghost.label:GetText() == "Alt \\194\\183 add a time 0:50 \\194\\183 too soon", "alt: " .. tostring(v.ghost.label:GetText()))
    alt = false
    -- cancelled: gone
    v:CancelMove()
    assert(#shown(v) == 0 and not v.bandLabel:IsShown(), "cancel hides them")
    -- released: gone, and the drop is still allowed
    f = flagAt(v, 30, false)
    cx = screenX(v, 30)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 100)
    v.frame.OnUpdate(v.frame)
    f.OnMouseUp(f, "LeftButton")
    assert(flagAt(v, 100, false), "dropped too soon all the same")
    assert(#shown(v) == 0, "release hides them")
  end
  print("ok bands: drag shows bands and too soon in the label")

  do
    local v = setup({ "time:30;ph:2;spellid:7777;tag:Abu;", "time:40;ph:2;text:Words;" })
    click(v, flagAt(v, 90, false))
    assert(outlined(flagAt(v, 90, false)) and #shown(v) == 0 and not (v.bandLabel and v.bandLabel:IsShown()), "unknown length: selected, no bands")
    click(v, flagAt(v, 100, false))
    assert(#shown(v) == 0, "no spell: no bands")
    local f = flagAt(v, 90, false)
    cx = screenX(v, 90)
    f.OnMouseDown(f, "LeftButton")
    cx = screenX(v, 95)
    v.frame.OnUpdate(v.frame)
    assert(#shown(v) == 0 and v.ghost.label:GetText() == "Move to 1:35", "dragging: none, no too soon")
    v:CancelMove()
  end
  print("ok bands: no length, no bands")

  do
    local v = setup({ "time:30;ph:2;spellid:4242;tag:Abu;", "time:50;ph:2;spellid:4242;tag:Abu;" })
    -- the ghost is made on the first drag; a drag once first so only the bands are counted
    local f = flagAt(v, 90, false)
    cx = screenX(v, 90) f.OnMouseDown(f, "LeftButton") cx = screenX(v, 150) v.frame.OnUpdate(v.frame) v:CancelMove()
    click(v, flagAt(v, 90, false))
    local made, n = textures, #v.bandTex
    for _ = 1, 5 do v:Refresh() end
    f = flagAt(v, 90, false)
    cx = screenX(v, 90)
    f.OnMouseDown(f, "LeftButton")
    for i = 1, 20 do cx = screenX(v, 60 + i) v.frame.OnUpdate(v.frame) end
    v:CancelMove()
    click(v, flagAt(v, 110, false))
    assert(#v.bandTex <= 6, "at most six band textures: " .. #v.bandTex)
    assert(textures - made <= 6 - n, "no textures made per frame: " .. (textures - made))
  end
  print("ok bands: textures are pooled")

  do
    -- the Heroic note and the Mythic note: a line in one never makes a line in the other too soon
    local v = setup({ "time:30;ph:2;spellid:4242;tag:Abu;" })
    CRT.db.notes.list[2] = { raw = "EncounterID:3001;Difficulty:Mythic;Name:Nek\\ntime:50;ph:2;spellid:4242;tag:Abu;", encounterID = 3001, difficulty = "Mythic", name = "Nek" }
    v:Refresh()
    click(v, flagAt(v, 90, false))
    assert(bandAt(v, 60, 180) and reds(v) == 0, "the Mythic line at 1:50 is not too soon for the Heroic one: " .. reds(v))
    -- the same note still counts
    CRT.db.notes.list[1].raw = HEAD .. "time:30;ph:2;spellid:4242;tag:Abu;\\ntime:50;ph:2;spellid:4242;tag:Abu;"
    v:Refresh()
    click(v, flagAt(v, 90, false))
    assert(reds(v) == 1, "the same note: red")
    -- dragging the Heroic line next to the Mythic one: not too soon
    CRT.db.notes.list[1].raw = HEAD .. "time:30;ph:2;spellid:4242;tag:Abu;"
    v:Refresh()
    local f = flagAt(v, 90, false)
    cx = screenX(v, 90) f.OnMouseDown(f, "LeftButton") cx = screenX(v, 100) v.frame.OnUpdate(v.frame)
    assert(v.ghost.label:GetText() == "Move to 1:40", "no too soon across notes: " .. tostring(v.ghost.label:GetText()))
    v:CancelMove()
  end
  print("ok bands: other difficulty's lines are not too soon")

  do
    -- (fix 1) a double-click opens the editor and lets go of Escape
    local v = setup({ "time:30;ph:2;spellid:4242;tag:Abu;" })
    local f = flagAt(v, 90, false)
    cx = screenX(v, 90)
    f.OnMouseDown(f, "LeftButton") f.OnMouseUp(f, "LeftButton") f.OnMouseDown(f, "LeftButton")
    f.OnDoubleClick(f, "LeftButton") f.OnMouseUp(f, "LeftButton")
    assert(#notesOpened == 1, "the editor opened")
    assert(not outlined(f), "the selection let go")
    v.frame.OnKeyDown(v.frame, "ESCAPE")
    assert(v.frame.propagate == true, "so Escape reaches the editor")
    -- a window Escape closes is shown: Escape goes on to it
    click(v, f)
    local win = mock("Frame")
    _G.CRTTestEscWindow = win
    UISpecialFrames = { "CRTTestEscWindow" }
    v.frame.OnKeyDown(v.frame, "ESCAPE")
    assert(v.frame.propagate == true, "Escape passed on to the shown window")
    win:Hide()
    click(v, f)
    v.frame.OnKeyDown(v.frame, "ESCAPE")
    assert(v.frame.propagate == false and not outlined(f), "no such window shown: kept, and clears")
    UISpecialFrames, _G.CRTTestEscWindow = nil, nil
  end
  print("ok bands: escape closes the editor after a double-click")

  do
    -- (fix 2) hidden: keys and selection let go; in combat: keys taken once it ends
    local v = setup({ "time:30;ph:2;spellid:4242;tag:Abu;" })
    click(v, flagAt(v, 90, false))
    v.frame:Hide() v.frame.OnHide(v.frame)
    assert(v.frame.keyboard == false and v.selected == nil, "hidden: no keys, nothing selected")
    local realCombat = InCombatLockdown
    InCombatLockdown = function() return true end
    v.frame:Show() v.frame.OnShow(v.frame)
    click(v, flagAt(v, 90, false))
    assert(outlined(flagAt(v, 90, false)) and v.frame.keyboard ~= true, "in combat: selected, keys left alone")
    InCombatLockdown = realCombat
    v.frame.OnEvent(v.frame, "PLAYER_REGEN_ENABLED")
    assert(v.frame.keyboard == true, "after combat: Escape works")
    v.frame.OnHide(v.frame)
  end
  print("ok bands: keys follow hide, show and combat")

  do
    -- (fix 4) a flag drag works out the other casts once, not every frame
    local v = setup({ "time:30;ph:1;spellid:4242;tag:Abu;", "time:90;ph:2;spellid:4242;tag:Abu;" })
    local calls, real = 0, v.OtherCasts
    rawset(v, "OtherCasts", function(...) calls = calls + 1 return real(...) end)
    local f = flagAt(v, 30, false)
    cx = screenX(v, 30) f.OnMouseDown(f, "LeftButton")
    for i = 1, 10 do cx = screenX(v, 40 + i * 6) v.frame.OnUpdate(v.frame) end
    assert(v.ghost.label:GetText():find("too soon", 1, true), "still finds the clash: " .. v.ghost.label:GetText())
    alt = true v.frame.OnUpdate(v.frame) alt = false
    assert(calls == 1, "once per drag: " .. calls)
    v:CancelMove()
    rawset(v, "OtherCasts", nil)
  end
  print("ok bands: a drag finds the other casts once")

  do
    -- (fix 6) a dark inner border under the outline, so it shows on a text-coloured flag
    local v = setup(nil, { { spellID = 5151, times = "P1 0:20" } })
    local f = flagAt(v, 20, true)
    click(v, f)
    local inner = rawget(f, "selIn")
    assert(inner and #inner == 4, "four inner sides")
    for _, side in ipairs(inner) do assert(side:IsShown() and side.color[1] < 0.3 and side.color[2] < 0.3 and side.color[3] < 0.3, "dark and shown") end
    cx, cy = screenX(v, 150), laneY(1) up(v)
    for _, side in ipairs(inner) do assert(not side:IsShown(), "hidden with the outline") end
  end
  print("ok bands: the outline has a dark inner border")

  do
    -- (fix 7) the selection follows a moved or added time of your reminder
    local v = setup(nil, { { spellID = 5151, times = "P1 0:40, 0:50" } })
    local function drag(f, toT, withAlt)
      cx = screenX(v, f.mark.t) f.OnMouseDown(f, "LeftButton")
      cx = screenX(v, toT) v.frame.OnUpdate(v.frame)
      alt = withAlt or false f.OnMouseUp(f, "LeftButton") alt = false
    end
    click(v, flagAt(v, 40, true))
    drag(flagAt(v, 40, true), 55)
    assert(outlined(flagAt(v, 55, true)) and not outlined(flagAt(v, 50, true)), "follows the move")
    drag(flagAt(v, 55, true), 30, true)
    assert(outlined(flagAt(v, 30, true)) and not outlined(flagAt(v, 55, true)), "follows the added time")
  end
  print("ok bands: the selection follows a moved cast")

  do
    -- (fix 8) a cast at the very same time is the same moment, not too soon
    local v = setup({ "time:30;ph:2;spellid:4242;tag:Abu;", "time:30;ph:2;spellid:4242;tag:Abu;text:Twin;" })
    click(v, flagAt(v, 90, false))
    assert(reds(v) == 0, "no red for the same moment: " .. reds(v))
    local f = flagAt(v, 90, false)
    -- held over its twin's time: the same moment, not too soon
    cx = screenX(v, 90) f.OnMouseDown(f, "LeftButton") cx = screenX(v, 100) v.frame.OnUpdate(v.frame)
    cx = screenX(v, 90) v.frame.OnUpdate(v.frame)
    assert(v.ghost.label:GetText() == "Move to 1:30", "same time as the twin: " .. v.ghost.label:GetText())
    v:CancelMove()
  end
  print("ok bands: a cast at the same time is not too soon")

  CRT.AlertCooldowns = realCD
  CRT.db.notes.list = savedList
  CRT.db.alerts.reminders = {}
end

-- One source: an "any difficulty" alert on a boss ability draws its flags on the casts of the ability
-- timeline the view shows, or for a pull, of the view's difficulty group; never another group's
do
  local savedList, savedRefs, savedNext = CRT.db.notes.list, CRT.db.timeline.references, CRT.db.timeline.nextRef
  CRT.db.notes.list = {}
  CRT.db.timeline.references, CRT.db.timeline.nextRef = {}, 1
  local R = CRT.AlertReminders
  -- your own Heroic one is listed first
  R.ResetMigration()
  CRT.TimelineReference:Add("Boss: Nek\\nEncounter: 3001\\nDifficulty: Heroic\\nLength: 3:00\\nSoulcoil [spell 4242]: 0:20, 1:40")
  CRT.TimelineReference:Add("Boss: Nek\\nEncounter: 3001\\nDifficulty: Mythic\\nLength: 3:00\\nSoulcoil [spell 4242]: 0:12, 1:22, 2:02")
  local mythic
  for _, e in ipairs(CRT.TimelineReference:List()) do if e.ref.difficulty == "Mythic" and e.ref.encounterID == 3001 then mythic = e.ref end end
  CRT.db.alerts.reminders = {}
  local id = R:Save(3001, nil, { spellID = 4242, boss = "Nek" })
  local function mine(v)
    local out = {}
    for _, f in ipairs(flags(v)) do if f.mark.mine then out[#out + 1] = f.mark.t end end
    table.sort(out)
    for i, t in ipairs(out) do out[i] = string.format("%g", t) end
    return table.concat(out, ",")
  end
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = mythic }, 3001, nil, "Nek", "mythic")
  assert(mine(v) == "12,82,122", "a Mythic view shows the Mythic casts: " .. mine(v))
  -- a recorded Mythic pull: the Mythic ability timeline, picked by the view's group
  local pull = { id = 7, encounterID = 3001, length = 200, casts = {}, deaths = {}, difficultyID = 16 }
  v:SetData(pull, 3001, nil, "Nek", "mythic")
  assert(mine(v) == "12,82,122", "a Mythic pull shows the Mythic casts, not your Heroic ones: " .. mine(v))
  v:SetData(pull, 3001, nil, "Nek", "nh")
  assert(mine(v) == "20,100", "a Heroic pull shows the Heroic casts: " .. mine(v))
  -- a drag on the Mythic view shifts that Mythic cast, read back the same way; the delete turns it off
  v:SetData({ reference = mythic }, 3001, nil, "Nek", "mythic")
  local ref, group = v:ReminderSource(R:Get(3001, id))
  assert(ref == mythic and group == "mythic", "one source for reads and writes")
  assert(R:SetTime(3001, id, 2, 1, 80, ref, group), "moved")
  local r = R:Get(3001, id)
  assert(r.shifts and r.shifts.mythic and r.shifts.mythic["P1@1:22"] == -2 and r.shifts.nh == nil and r.times == nil, "a shift on the second cast, no typed times")
  v:Refresh()
  assert(mine(v) == "12,80,122", "drawn shifted: " .. mine(v))
  v:SetData(pull, 3001, nil, "Nek", "nh")
  assert(mine(v) == "20,100", "a drag on Mythic leaves Heroic as it was: " .. mine(v))
  v:SetData({ reference = mythic }, 3001, nil, "Nek", "mythic")
  assert(R:RemoveTime(3001, id, 3, ref, group) and R:Get(3001, id).off.mythic["P1@2:02"] == true, "deleted: the third cast off")
  v:Refresh()
  assert(mine(v) == "12,80", "and gone: " .. mine(v))
  assert(R:AddTime(3001, id, 1, 125, ref, group) and R:Get(3001, id).off == nil, "an added time turns the nearest cast back on")
  -- a note or reminder of its own difficulty shows only on a view of its group, as in a pull
  CRT.db.alerts.reminders = {}
  R:Save(3001, nil, { text = "Heroic own", times = "P1 0:50", boss = "Nek", difficulty = "Heroic" })
  R:Save(3001, nil, { text = "Mythic own", times = "P1 0:55", boss = "Nek", difficulty = "Mythic" })
  -- saved per group, as Mech Alerts and the editor save them now
  R:Save(3001, nil, { text = "NH group", times = "P1 0:52", boss = "Nek" }, "nh")
  R:Save(3001, nil, { text = "Mythic group", times = "P1 0:57", boss = "Nek" }, "mythic")
  CRT.db.notes.list = {
    [1] = { raw = "EncounterID:3001;Difficulty:Heroic;Name:Nek\\ntime:40;ph:1;text:Heroic line;", encounterID = 3001, difficulty = "Heroic", name = "Nek" },
    [2] = { raw = "EncounterID:3001;Difficulty:Mythic;Name:Nek\\ntime:45;ph:1;text:Mythic line;", encounterID = 3001, difficulty = "Mythic", name = "Nek" },
  }
  local function texts(view)
    local out = {}
    for _, f in ipairs(flags(view)) do out[#out + 1] = tostring(f.mark.text) end
    table.sort(out)
    return table.concat(out, ",")
  end
  v:SetData({ reference = mythic }, 3001, nil, "Nek", "mythic")
  assert(texts(v) == "Mythic group,Mythic line,Mythic own", "a Mythic view: only Mythic's own and any: " .. texts(v))
  v:SetData(pull, 3001, nil, "Nek", "nh")
  assert(texts(v) == "Heroic line,Heroic own,NH group", "a Heroic view: only Heroic's: " .. texts(v))
  v:SetData(pull, 3001, nil, "Nek")
  assert(texts(v) == "Heroic line,Heroic own,Mythic group,Mythic line,Mythic own,NH group", "no group: everything: " .. texts(v))
  CRT.db.alerts.reminders = {}
  CRT.db.notes.list, CRT.db.timeline.references, CRT.db.timeline.nextRef = savedList, savedRefs, savedNext
end
print("ok one source: flags follow the view's ability timeline and difficulty group")

`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const p of process.argv.slice(2, 15)) {
  let src; try { src = fs.readFileSync(p, 'utf8'); } catch (e) { console.error('cannot read ' + p); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 13, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
