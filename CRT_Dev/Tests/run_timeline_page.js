// CRT_Modules/Timeline/Page.lua on mock frames: the real Data.lua, a stub Journal and View.
// usage: node run_timeline_page.js <Data.lua> <Database.lua> <Reference.lua> <Lanes.lua> <ReferencePage.lua> <SettingsTab.lua> <Page.lua> <Journal.lua> <Registry.lua> <Season.lua> <Nekzali.lua> <ReviewTab.lua> <Rehearsal.lua> <RehearsalWindow.lua> <CRT_Core/Slash.lua>
// Journal.lua is loaded on its own CRT table only for its RaidBosses, which the stub Journal hands on.
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, dbSrc, refSrc, lanesSrc, refPageSrc, settingsTabSrc, pageSrc, journalSrc, regSrc, seasonSrc, nekSrc, reviewSrc, rehSrc, rehWinSrc, slashSrc = ...
local strings, checks, edits, buttons, dropdowns, sliders = {}, {}, {}, {}, {}, {}
local function mock(kind)
  local m = { shown = false, kind = kind }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function() local x = mock("fs") strings[#strings+1] = x return x end end
    if k == "CreateTexture" then return function() return mock() end end
    if k == "SetText" then return function(self, s) self.text = s end end
    if k == "GetText" then return function(self) return self.text or "" end end
    if k == "SetChecked" then return function(self, v) self.checked = v end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "Show" then return function(self) self.shown = true if rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "HasFocus" then return function() return false end end
    if k == "GetWidth" then return function() return 378 end end
    if k == "GetStringHeight" then return function() return 14 end end
    if k == "GetVerticalScroll" then return function() return 0 end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    if k == "SetPoint" then return function(self, ...) rawset(self, "pt", { ... }) end end
    if k == "SetEnabled" then return function(self, v) self.enabled = v end end
    if k == "SetNumeric" then return function(self, v) rawset(self, "numeric", v) end end
    if k == "SetMultiLine" then return function(self, v) rawset(self, "multi", v) end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "color", { r, g, b }) end end
    if k == "SetParent" then return function(self, p) rawset(self, "parent", p) reparented = self end end
    if k == "GetPoint" then return function() return "CENTER", nil, "CENTER", 10, 20 end end
    if k == "GetHeight" then return function() return 600 end end
    if k == "RegisterEvent" then return function(self, e) local r = rawget(self, "events") or {} r[e] = true rawset(self, "events", r) end end
    return function() end end })
end
allFrames = {}
function CreateFrame(kind) local m = mock(kind) allFrames[#allFrames + 1] = m
  if kind == "CheckButton" then checks[#checks+1] = m elseif kind == "EditBox" then edits[#edits+1] = m
  elseif kind == "Button" then buttons[#buttons+1] = m end
  return m end
format = string.format
CANCEL = "Cancel"
UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
InCombatLockdown = function() return false end
C_Spell = { GetSpellName = function() return nil end }
local popup
StaticPopup_ShowCustomGenericConfirmation = function(info) popup = info end
local pages, tabs, printed, helps = {}, {}, {}, {}
skinCalls = 0
rowsList = {}
local function opts(o) return type(o.options) == "function" and o.options() or o.options end
local CRT = { db = { timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3, overlayOn = false, hideEmpty = false, nextId = 1 } },
  UI = { Tint = function() end, OnTheme = function() end, SkinScrollBar = function() end, PAGE_W = 1026, PAGE_H = 560, Help = function(_, title, text) helps[title] = text return mock() end,
    Dropdown = function(_, text, o) local m = mock() m.opts, m.text = o, text dropdowns[#dropdowns+1] = m rawset(m, "refresh", function() end) return m end,
    Slider = function(_, text, o) local m = mock() m.opts, m.text = o, text sliders[#sliders+1] = m rawset(m, "refresh", function() end) return m end,
    SkinTree = function(_, f) skinCalls = skinCalls + 1 end,
    RegisterPage = function(_, key, title, fn) pages[key] = { title = title, build = fn } end,
    RegisterTab = function(_, b) tabs[#tabs+1] = b end, SetTabSelected = function() end,
    IsModern = function() return true end, Scale = function() return 100 end, RegisterLayer = function(_, k, f) layered = k if k == "timeline" then popFrame = f end end, SelectPage = function(_, k) selectedPage = k end,
    ResetButtonWidth = function() return 44 end, ResetButton = function() return mock() end, Show = function() end, SkinCloseButton = function() end,
    StyleWindow = function() end, SetFrameTitle = function() end },
  PALETTE = { background = { 0.1, 0.1, 0.1 }, border = { 0.3, 0.3, 0.3 }, accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, text = { 0.95, 0.9, 0.84 } },
}
CRT_THEME(CRT, CRT.UI)
function CRT:Print(m) printed[#printed+1] = m end
-- the shared window helper (CRT_Core/UI/Window.lua): records what it was asked for; like it, puts the frame on its layer
windowsMade = {}
function CRT.UI.Window(name, o)
  local w = mock("window") w.content = mock() w.placed = 0
  rawset(w, "Place", function(self) self.placed = self.placed + 1 end)
  rawset(w, "SetBackdropColor", function(self) self.flatPainted = true end)
  windowsMade[#windowsMade + 1] = { name = name, opts = o, frame = w }
  CRT.UI:RegisterLayer(o.layer or "popups", w)
  return w
end
local customAdded = {}
journalHidden = {}
CRT.TimelineJournal = { ResolveID = function(_, k, r) if type(k) == "number" then return k end if r and type(r.encounterID) == "number" then return r.encounterID end end, Rows = function() return rowsList end, AddCustom = function(_, e, s) customAdded[#customAdded+1] = s end,
  RemoveCustom = function() end, SetHidden = function(_, e, s, h) journalHidden[e .. ":" .. s] = h or nil end,
  IsHidden = function(_, e, s) return journalHidden[e .. ":" .. tostring(s)] and true or false end }
do
  local realCRT = {}
  assert(load(journalSrc, "Journal.lua"))("CowfeeRaidTools", realCRT)
  CRT.TimelineJournal.RaidBosses = function() return realCRT.TimelineJournal:RaidBosses() end
end
local view = { SetData = function(self, pull, eid, overlay, name, group) self.pull, self.eid, self.overlay, self.group = pull, eid, overlay, group self.sets = (self.sets or 0) + 1 end, refreshes = 0, Refresh = function(self) self.refreshes = self.refreshes + 1 end, SetSpan = function(self, v) self.span = v end, CastCount = function() return 0 end, SetOrder = function(self, o) self.order = o end, ClearHighlight = function(self) self.highlight = nil end, Highlight = function(self, id, name) self.highlight = { spellID = id, name = name and name:lower() } local ref = self.pull and self.pull.reference for _, row in ipairs(ref and ref.rows or {}) do if (id and row.spellID == id) or (name and row.name:lower() == name:lower()) then return true end end return false end }
view.EncounterNumber = function(self) return type(self.eid) == "number" and self.eid or nil end
view.SetPlayhead = function(self, t, follow) self.playT = type(t) == "number" and t or nil self.playFollow = follow and true or false end
-- the raid notes and their sharing, as CRT_Modules/Notes/Data.lua and CRT_Modules/Notes/Comm.lua give them
local noteFor, canShare, shared, noteListeners = {}, true, {}, {}
local noteForCalls, madeNotes = {}, 0
CRT.Notes = { FindForEncounter = function(_, enc) return noteFor[enc] end, OnChange = function(_, fn) noteListeners[#noteListeners + 1] = fn end,
  NoteFor = function(_, enc, diff, name)
    noteForCalls[#noteForCalls + 1] = { enc = enc, diff = diff, name = name }
    if noteFor[enc] then return noteFor[enc], false end
    madeNotes = madeNotes + 1
    noteFor[enc] = 100 + madeNotes
    return noteFor[enc], true
  end,
  Get = function(_, id) return { name = "Note " .. id } end }
CRT.NoteComm = { CanShare = function() if canShare then return true end return false, "Only the raid leader or an assistant can share notes." end,
  Share = function(_, id) shared[#shared + 1] = id end }
CRT.TimelineView = { Create = function() return view end, Format = function(t) return string.format("%d:%02d", math.floor(t / 60), t % 60) end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local T = CRT.Timeline
local function pull(id, len, kill) return { id = id, length = len, kill = kill, casts = {}, deaths = {} } end
CRT.db.timeline.bosses = {
  [3001] = { name = "Alpha", pulls = { pull(11, 120, true), pull(12, 60, false) } },
  [3002] = { name = "Beta", pulls = {} },
}
CRT.db.timeline.nextId = 13
assert(load(dbSrc, "Database.lua"))("CowfeeRaidTools", CRT)
assert(load(refSrc, "Reference.lua"))("CowfeeRaidTools", CRT)
assert(load(lanesSrc, "Lanes.lua"))("CowfeeRaidTools", CRT)
-- Boss library wiring (CRT_Data/Bosses/Registry.lua, then the season pack, then the ADDON_LOADED the game fires once every file has loaded).
local function loadBosses(CRT, reg, season, nek)
  local real, handler = CreateFrame, nil
  CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
  assert(load(reg, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
  CreateFrame = real
  assert(load(season, "CRT_Data/Seasons/Midnight-S1/Season.lua"))("CowfeeRaidTools", CRT)
  assert(load(nek, "CRT_Data/Seasons/Midnight-S1/NekzaliTheSoulcoiler.lua"))("CowfeeRaidTools", CRT)
  -- the test bosses are in the library too: the boss list shows library bosses only
  for _, b in ipairs({ { 3001, "Alpha" }, { 3002, "Beta" }, { 3003, "Gamma (2)" }, { 4004, "Zork the Late" }, { 5001, "Delta" } }) do
    CRT.Bosses:Register({ encounterID = b[1], name = b[2], season = "midnight-s1" })
  end
  handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
end
loadBosses(CRT, regSrc, seasonSrc, nekSrc)
assert(load(refPageSrc, "ReferencePage.lua"))("CowfeeRaidTools", CRT)
assert(load(settingsTabSrc, "SettingsTab.lua"))("CowfeeRaidTools", CRT)
assert(load(reviewSrc, "ReviewTab.lua"))("CowfeeRaidTools", CRT)
-- the alerts engine as Rehearse reads it: whether a run is going and whether it is a rehearsal
alertsStub = { running = false, rehearsal = false, listeners = {} }
function alertsStub:OnChange(fn) self.listeners[#self.listeners + 1] = fn end
function alertsStub:IsRehearsal() return self.running and self.rehearsal end
function alertsStub:Stop() self.running, self.rehearsal = false, false end
function alertsStub:Start(_, _, kind) self.running, self.rehearsal = true, kind == "rehearsal" return true end
function alertsStub:StartPhase() end
function alertsStub:TimeAt() return nil end
alertsStub.fire = function() for _, fn in ipairs(alertsStub.listeners) do fn() end end
CRT.Alerts = alertsStub
GetTime = function() return 1000 end
assert(load(rehSrc, "Rehearsal.lua"))("CowfeeRaidTools", CRT)
assert(load(rehWinSrc, "RehearsalWindow.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock()
assert(pages.timeline, "page registered") print("ok page registered")
pages.timeline.build(pf)
pf:Show()

local function tabText(b) return type(b.text) == "table" and b.text.text or b.text end
assert(#tabs == 3 and tabText(tabs[1]) == "Review" and tabText(tabs[2]) == "Settings" and tabText(tabs[3]) == "Advanced", "tabs order: Review, Settings, Advanced")
print("ok tabs order")

local function find(list, text) for _, d in ipairs(list) do if d.text == text then return d end end end
local pullDD = find(dropdowns, "Pull")
do
  local first = find(dropdowns, "Boss")
  local o = opts(first.opts)
  assert(o[1].title and not o[2].title, "the boss list starts with a raid heading")
  assert(first.opts.get() == o[2].key, "the page opens on the route's first boss")
  first.opts.set(3001)
end
print("ok boss list follows the route")
assert(pullDD and opts(pullDD.opts)[1].label == "Pull 12 " .. string.char(194, 183) .. " 1:00 " .. string.char(194, 183) .. " wipe " .. string.char(194, 183) .. " Normal/Heroic", "pull label: " .. tostring(opts(pullDD.opts)[1].label))
print("ok pull label")

local diffDD = find(dropdowns, "Difficulty")
do
  assert(diffDD and diffDD.opts.get() == "nh", "difficulty defaults to Normal/Heroic")
  local o = opts(diffDD.opts)
  assert(#o == 2 and o[1].key == "nh" and o[1].label == "Normal/Heroic" and o[2].key == "mythic" and o[2].label == "Mythic", "difficulty options")
  assert(helps["Difficulty"] and helps["Difficulty"]:find("Mythic-only", 1, true), "difficulty has a (?) that explains the split")
  assert(view.group == "nh", "difficulty defaults to Normal/Heroic: the view gets the group")
  local nekOpt
  for _, b in ipairs(opts(find(dropdowns, "Boss").opts)) do if b.key == 3470 then nekOpt = b end end
  assert(nekOpt and nekOpt.label == "Nek'zali the Soulcoiler", "difficulty defaults to Normal/Heroic: Nek'zali is listed (a library boss), with no pulls counted")
end
print("ok difficulty defaults to Normal/Heroic with nothing saved")

local record
for _, c in ipairs(checks) do if c.Label and c.Label.text == "Record every pull" then record = c break end end
assert(record, "record checkbox exists")
record:SetChecked(false) record.OnClick(record)
assert(T:Settings().record == false, "record checkbox writes setting")
print("ok record checkbox writes setting")

local edit, add
for _, e in ipairs(edits) do if rawget(e, "numeric") then edit = e end end
for _, b in ipairs(buttons) do if b.text == "Add" then add = b end end
assert(edit and add, "add row controls")
edit:SetText("abc") add.OnClick(add)
assert(#customAdded == 0, "add bad spell id")
edit:SetText("123") add.OnClick(add)
local found = false for _, m in ipairs(printed) do if m == "No spell with that ID." then found = true end end
assert(#customAdded == 0 and found, "add bad spell id")
print("ok add bad spell id")

-- pick the boss with no pulls
local bossDD = find(dropdowns, "Boss")
local opt
for _, o in ipairs(opts(bossDD.opts)) do if o.key == 3002 then opt = o end end
assert(opt, "boss without pulls is listed")
bossDD.opts.set(3002)
local shown
for _, s in ipairs(strings) do if s.text == "No pulls recorded for this boss yet" and s.shown then shown = true end end
assert(shown, "empty boss label")
print("ok empty boss label")

-- delete asks first
local del
for _, b in ipairs(buttons) do if b.text == "Delete this boss's pulls" then del = b end end
assert(del, "delete button")
bossDD.opts.set(3001)
del.OnClick(del)
assert(popup and popup.callback, "delete confirms")
popup.callback()
assert(CRT.db.timeline.bosses[3001] == nil, "delete removes the boss")
print("ok delete confirms and removes")

-- boss names come from the list, not from the label
T:SavePull({ encounterID = 3003, name = "Gamma (2)", length = 60, kill = true, casts = {}, deaths = {} })
bossDD.opts.set(3003)
local labelOpt
for _, o in ipairs(opts(bossDD.opts)) do if o.key == 3003 then labelOpt = o end end
assert(labelOpt and labelOpt.name == "Gamma (2)" and labelOpt.label == "Gamma (2) (1)", "boss options carry key, name and label")
print("ok boss name is not stripped")
T:DeleteBoss(3003)

-- the Review tab redraws when switched to
local settingsTab, reviewTab = tabs[3], tabs[1]
settingsTab.OnClick(settingsTab)
local before = view.refreshes
reviewTab.OnClick(reviewTab)
assert(view.refreshes > before, "review tab refreshes the view")
print("ok review tab refreshes")

-- the zoom slider
local zoom = find(sliders, "Time visible")
assert(zoom and zoom.opts.min == 60 and zoom.opts.max == 600 and zoom.opts.step == 30, "zoom slider exists")
assert(zoom.opts.format(90) == "1:30", "zoom slider formats minutes")
zoom.opts.set(120)
assert(T:Settings().span == 120 and view.span == 120, "zoom slider sets span and view")
T:Settings().span = 90
assert(zoom.opts.get() == 90, "zoom slider re-reads span")
assert(find(sliders, "Seconds visible"), "settings tab keeps its span slider")
-- both span sliders show m:ss, so a typed number is minutes
for _, label in ipairs({ "Time visible", "Seconds visible" }) do
  local o = find(sliders, label).opts
  assert(o.toDisplay and o.toDisplay(90) == 1.5 and o.fromDisplay(2.5) == 150, label .. " is typed in minutes")
end
for _, sl in ipairs(sliders) do
  if sl.text ~= "Time visible" and sl.text ~= "Seconds visible" then assert(sl.opts.toDisplay == nil, sl.text .. " types what it shows") end
end
print("ok zoom slider")

-- new row lines are skinned
rowsList = { { spellID = 1, name = "A", own = true } }
local skinBefore = skinCalls
T:Set("grid", 30)
assert(skinCalls > skinBefore, "new row lines are skinned")
print("ok row lines skinned")
rowsList = {}

-- the boss list is the boss library's: a Journal boss outside it is never listed
EJ_GetInstanceForMap = function() return 77 end
EJ_GetEncounterInfoByIndex = function(i) if i == 1 then return "Zed", "", 1, 501 end end
EJ_GetEncounterInfo = function() return "Zed", "", 501, 0, "", 77, 6001 end
C_Map = { GetBestMapForUnit = function() return 1 end }
GetInstanceInfo = function() return "Dungeon", "party" end
T:Set("grid", 30)
local function hasZed() for _, o in ipairs(opts(bossDD.opts)) do if o.name == "Zed" then return true end end end
assert(not hasZed(), "no Journal bosses outside a raid")
GetInstanceInfo = function() return "Raid", "raid" end
T:Set("grid", 30)
assert(not hasZed(), "a raid's Journal boss that is not in the boss library is not listed, even inside the raid")
print("ok only boss library bosses are listed")

-- empty wording
GetInstanceInfo = function() return "Dungeon", "party" end
T:DeleteBoss(3002)
local shippedRefs = CRT.TimelineDB.references
CRT.TimelineDB.references = {}
T:Set("grid", 30)
CRT.TimelineDB.references = shippedRefs
bossDD.opts.set(3002)
local bossEmpty
for _, s in ipairs(strings) do if s.text == "No pulls recorded for this boss yet" and s.shown then bossEmpty = true end end
assert(bossEmpty, "a library boss with nothing saved shows the boss's empty label")
print("ok empty label for a boss with nothing saved")
diffDD.opts.set("mythic")

-- Reference timelines ----------------------------------------------------------------------------
local R = CRT.TimelineReference
local DOT = string.char(194, 183)
local NEK = 3470 -- a library boss is listed by its encounter ID, pulled or not
local function hasKey(dd, key) for _, o in ipairs(opts(dd.opts)) do if o.key == key then return o end end end

T:Set("grid", 30)
local refBoss = hasKey(bossDD, NEK)
assert(refBoss and refBoss.label == "Nek'zali the Soulcoiler", "a boss with only a reference is listed by its name")
print("ok a boss with only a reference is listed")

do
  bossDD.opts.set(NEK)
  assert(pullDD.opts.get() == "ship:1" and view.pull and view.pull.reference, "reference-only boss shows its reference")
  assert(not helps["Unnamed casts"]():find("Boss Timeline"), "empty-pull hint: not for a reference")
end

-- a boss with 2 saved pulls and the shipped reference
CRT.db.timeline.bosses[3470] = { name = "Nek'zali the Soulcoiler", pulls = {
  { id = 1, difficultyID = 16, length = 300, kill = false, casts = {}, deaths = { { t = 10, name = "A" } } },
  { id = 2, difficultyID = 16, length = 452, kill = false, casts = { { t = 5 } }, deaths = { { t = 20, name = "B" }, { t = 30, name = "C" } } } } }
T:Set("grid", 30)
local listed = 0
for _, o in ipairs(opts(bossDD.opts)) do if o.key == 3470 then listed = listed + 1 assert(o.label == "Nek'zali the Soulcoiler (2)", "pulled: the count joins the label: " .. o.label) end end
assert(listed == 1, "the boss is listed once")
bossDD.opts.set(3470)
local first = opts(pullDD.opts)[1]
assert(first.key == "ship:1" and first.label == "Abilities " .. DOT .. " Mythic " .. DOT .. " 9:48", "reference first in pull dropdown: " .. tostring(first.label))
assert(opts(pullDD.opts)[2].key == 2, "reference first in pull dropdown: pulls follow")
assert(pullDD.opts.get() == "ship:1" and view.pull.reference and view.eid == 3470, "reference first in pull dropdown: selected")
print("ok reference first in pull dropdown")

-- the Recent pulls list
local function recent(id)
  for _, b in ipairs(buttons) do
    local t = rawget(b, "title")
    if t and b.shown and t.text and t.text:find("^Pull " .. id .. " ") then return b end
  end
end
do
  local function gold(b) local c = rawget(b, "border") return c and c[1] == 1 and c[2] > 0.8 end
  local b2 = recent(2)
  for _, b in ipairs(buttons) do if rawget(b, "title") then rawset(b, "SetBackdropBorderColor", function(self, r, g, bl) rawset(self, "border", { r, g, bl }) end) end end
  assert(b2 and b2.title.text == "Pull 2 " .. DOT .. " 7:32 " .. DOT .. " wipe " .. DOT .. " Mythic" and b2.deaths.text == "2 deaths", "recent pulls: line text")
  assert(b2.deaths.color and b2.deaths.color[1] > 0.9 and b2.deaths.color[2] < 0.5, "recent pulls: deaths in red")
  b2.OnClick(b2)
  assert(view.overlay and view.overlay.id == 2 and view.pull.reference, "recent pulls toggle overlay: on")
  assert(gold(b2), "recent pulls toggle overlay: gold border, as the Raid Notes list")
  b2 = recent(2)
  b2.OnClick(b2)
  assert(view.overlay == nil and view.pull.reference, "recent pulls toggle overlay: off")
  assert(not gold(b2), "recent pulls toggle overlay: back to the grey border")
  b2.OnClick(b2)
  pullDD.opts.set(2)
  assert(view.overlay == nil and view.pull.id == 2, "recent pulls: changing pull clears the overlay")
  assert(not recent(2), "recent pulls: hidden for a recorded pull")
  assert(helps["Unnamed casts"]():find("Boss Timeline"), "empty-pull hint: shown for a recorded pull")
  pullDD.opts.set("ship:1")
  b2 = recent(2) b2.OnClick(b2)
  assert(view.overlay and view.overlay.id == 2, "recent pulls: overlay again")
  bossDD.opts.set(3001) bossDD.opts.set(3470)
  assert(view.overlay == nil, "recent pulls: changing boss clears the overlay")
  for k in pairs(CRT.db.timeline) do assert(not tostring(k):lower():find("overlaypull"), "recent pulls: overlay not saved") end
end
print("ok recent pulls toggle overlay")

-- reference rows on the Settings tab hide by name
do
  local line
  for _, c in ipairs(checks) do
    local p = rawget(c, "line")
    if p and p.shown and p.text and p.text.text == "Soulcoil Rite" then line = p end
  end
  assert(line, "reference rows listed on the Settings tab")
  line.check:SetChecked(false) line.check.OnClick(line.check)
  assert(CRT.db.timeline.rows[3470].hiddenNames["soulcoil rite"] == true, "reference rows hide by name")
  line.check:SetChecked(true) line.check.OnClick(line.check)
  assert(not CRT.db.timeline.rows[3470].hiddenNames["soulcoil rite"], "reference rows show again")
end
print("ok reference rows hide by name")

-- a reference row with no [spell] whose Journal match by name is hidden shows unticked
do
  rowsList = { { spellID = 777, name = "Grasping Depths", icon = "texG" } }
  journalHidden["3470:777"] = true
  local function laneShown()
    local lanes = CRT.TimelineLanes.Build(view.pull, rowsList, T:Settings(), 3470)
    for _, l in ipairs(lanes) do if l.label == "Grasping Depths" then return true end end
    return false
  end
  T:Set("grid", 30)
  local line
  for _, c in ipairs(checks) do
    local p = rawget(c, "line")
    if p and p.shown and p.text and p.text.text == "Grasping Depths" then line = p end
  end
  assert(line and not line.check.checked and not laneShown(), "journal-hidden reference row shows unticked")
  line.check:SetChecked(true) line.check.OnClick(line.check)
  assert(not journalHidden["3470:777"] and laneShown() and line.check.checked, "ticking it shows the lane again")
  line.check:SetChecked(false) line.check.OnClick(line.check)
  assert(not journalHidden["3470:777"] and not laneShown() and CRT.db.timeline.rows[3470].hiddenNames["grasping depths"], "unticking hides by name only")
  line.check:SetChecked(true) line.check.OnClick(line.check)
  rowsList = {}
  T:Set("grid", 30)
end
print("ok journal-hidden reference row shows unticked")

-- the References tab
local paste
for _, e in ipairs(edits) do if rawget(e, "multi") then paste = e end end
local function btn(text) for _, b in ipairs(buttons) do if b.text == text then return b end end end
local function statusText() for _, s in ipairs(strings) do if (type(s.text) == "string" and s.text:find("^Saved")) or (type(s.text) == "string" and s.text:find("^Line")) then return s.text end end end
do
  assert(paste, "references tab: paste box")
  local save = btn("Save")
  paste:SetText("Boss: Nek'zali the Soulcoiler\\nnonsense line")
  save.OnClick(save)
  local st = statusText() or ""
  assert(st:find("Line 2") and #CRT.db.timeline.references == 0, "references tab saves: invalid text shows the line: " .. st)
  paste:SetText("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nLength: 5:00\\nSmash: 0:10, 0:40")
  save.OnClick(save)
  assert(statusText() == "Saved for Mythic" and R:Find("own:1") and #CRT.db.timeline.references == 1, "references tab saves: valid text")
  assert(opts(pullDD.opts)[1].key == "own:1" and opts(pullDD.opts)[2].key == "ship:1", "references tab saves: yours listed first")
end
print("ok references tab saves")

do
  pullDD.opts.set("own:1")
  assert(view.pull.reference and view.pull.reference.length == 300, "own reference shown")
  local del
  for _, b in ipairs(buttons) do if b.text == "Delete" and b.shown and rawget(b, "key") == "own:1" then del = b end end
  assert(del, "deleting the shown reference falls back: delete button")
  popup = nil
  del.OnClick(del)
  assert(popup and popup.callback, "deleting the shown reference falls back: confirms")
  popup.callback()
  assert(#CRT.db.timeline.references == 0, "deleting the shown reference falls back: deleted")
  local sel = pullDD.opts.get()
  assert(sel == "ship:1" or type(sel) == "number", "deleting the shown reference falls back: " .. tostring(sel))
  assert(view.pull and (view.pull.reference or view.pull.id), "deleting the shown reference falls back: something shown")
end
print("ok deleting the shown reference falls back")

do
  local copy
  for _, b in ipairs(buttons) do if b.text == "Copy" and b.shown and rawget(b, "key") == "ship:1" then copy = b end end
  assert(copy, "copy button on shipped")
  copy.OnClick(copy)
  assert(paste:GetText() == CRT.TimelineDB.references[1], "copy fills the box")
  local key = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nA: 0:10")
  local edit2
  for _, b in ipairs(buttons) do if b.text == "Edit" and b.shown and rawget(b, "key") == key then edit2 = b end end
  assert(edit2, "edit button on yours")
  edit2.OnClick(edit2)
  assert(paste:GetText() == "Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nA: 0:10", "edit fills the box")
  paste:SetText("Boss: Nek'zali the Soulcoiler\\nA: 0:20")
  btn("Save").OnClick(btn("Save"))
  assert(#CRT.db.timeline.references == 1 and R:Find(key).ref.rows[1].casts[1].t == 20, "save updates the one being edited")
  R:Delete(key)
end
print("ok copy and edit fill the box")

-- final review fixes ---------------------------------------------------------------------------------
do
  bossDD.opts.set(3470)
  local key = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Heroic\\nA: 0:10")
  diffDD.opts.set("nh")
  T:Set("grid", 30)
  local mine, shipped
  for _, o in ipairs(opts(pullDD.opts)) do
    if o.key == key then mine = o elseif o.key == "ship:1" then shipped = o end
  end
  assert(mine and mine.label == "Abilities " .. DOT .. " Heroic " .. DOT .. " 0:10 " .. DOT .. " yours", "own reference label marked yours: " .. tostring(mine and mine.label))
  assert(shipped == nil, "own reference label marked yours: the shipped Mythic one is not listed on Normal/Heroic")
  R:Delete(key)
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  assert(not opts(pullDD.opts)[1].label:find("yours"), "own reference label marked yours: shipped is not")
end
print("ok own reference label marked yours")

do
  bossDD.opts.set(3470)
  pullDD.opts.set("ship:1")
  assert(edit.enabled == false and add.enabled == false, "add spell disabled on a reference")
  assert(helps["Rows"]:find("recorded pulls", 1, true), "add spell disabled on a reference: help says so")
  assert(helps["Rows"]:find("Encounter Journal", 1, true) and helps["Rows"]:find("combat", 1, true), "Rows help: icons need the Journal, not read in combat")
  assert(helps["Abilities Text"]:find("combat", 1, true), "References help: icons need the Journal, not read in combat")
  pullDD.opts.set(2)
  assert(edit.enabled == true and add.enabled == true, "add spell disabled on a reference: enabled again for a recorded pull")
  pullDD.opts.set("ship:1")
  assert(add.enabled == false, "add spell disabled on a reference: and off again")
end
print("ok add spell disabled on a reference")

do
  local key = R:Add("Boss: Zork the Late\\nDifficulty: Mythic\\nA: 0:10")
  T:Set("grid", 30)
  bossDD.opts.set(4004)
  assert(bossDD.opts.get() == 4004 and pullDD.opts.get() == key, "a reference with no Encounter line joins its library boss by name")
  R:Delete(key)
  bossDD.opts.set(3470)
end
print("ok a reference finds its library boss by name")

do
  local key = R:Add("Boss: Qux\\nDifficulty: Mythic\\nEncounter: 9009\\nRite: 0:10")
  T:Set("grid", 30)
  for _, o in ipairs(opts(bossDD.opts)) do assert(o.key ~= 9009 and o.label ~= "Qux", "a reference for a boss outside the library is not listed") end
  R:Delete(key)
end
print("ok a reference for a boss outside the library is not listed")

do
  bossDD.opts.set(3470)
  local function savedStatus()
    for _, s in ipairs(strings) do
      if type(s.text) == "string" and s.text:find("^Saved") then return s.text end
    end
  end
  paste:SetText("Boss: Somebody Else\\nA: 0:10")
  btn("Save").OnClick(btn("Save"))
  assert(savedStatus() == "Saved for Somebody Else", "saved for another boss: " .. tostring(savedStatus()))
  R:Delete("own:" .. (CRT.db.timeline.nextRef - 1))
  paste:SetText("Boss: nek'zali THE soulcoiler\\nA: 0:10")
  btn("Clear").OnClick(btn("Clear"))
  paste:SetText("Boss: nek'zali THE soulcoiler\\nA: 0:10")
  btn("Save").OnClick(btn("Save"))
  assert(savedStatus() == "Saved for Mythic", "saved for another boss: same boss says the difficulty: " .. tostring(savedStatus()))
  R:Delete("own:" .. (CRT.db.timeline.nextRef - 1))
end
print("ok saved for another boss")

do
  local J = CRT.TimelineJournal
  local oldResolve = J.ResolveID
  J.ResolveID = function(self, k, r)
    if r and r.boss == "Nek'zali the Soulcoiler" then return 3470 end
    return oldResolve(self, k, r)
  end
  local function hasText(t) for _, s in ipairs(strings) do if s.text == t then return true end end end
  local function textStarting(p) for _, s in ipairs(strings) do if type(s.text) == "string" and s.text:find(p, 1, true) == 1 then return s.text end end end
  rowsList = { { spellID = 111, name = "Soulcoil Rite", icon = "t1" }, { spellID = 222, name = "Invoke", icon = "t2" } }
  paste:SetText("Boss: Nek'zali the Soulcoiler\\nSoulcoil Rite: 0:02\\nOther: 5")
  assert(paste.OnTextChanged, "journal abilities: box watches its text")
  paste.OnTextChanged(paste)
  assert(hasText("Journal abilities: Nek'zali the Soulcoiler") and hasText("Soulcoil Rite") and hasText("111") and hasText("222"), "journal abilities: listed with spell IDs")
  print("ok journal abilities listed for the box's boss")
  local fillB = btn("Fill spell IDs")
  assert(fillB, "fill spell IDs: button")
  fillB.OnClick(fillB)
  assert(paste:GetText() == "Boss: Nek'zali the Soulcoiler\\nSoulcoil Rite [spell 111]: 0:02\\nOther: 5", "fill spell IDs: text filled: " .. paste:GetText())
  assert(textStarting("Added 1 spell ID."), "fill spell IDs: status")
  fillB.OnClick(fillB)
  assert(textStarting("No more lines match"), "fill spell IDs: nothing left to fill")
  rowsList = {}
  fillB.OnClick(fillB)
  assert(textStarting("No Journal abilities found for Nek'zali the Soulcoiler"), "fill spell IDs: no Journal rows")
  assert(hasText("No Journal abilities found"), "journal abilities: empty state")
  print("ok fill spell IDs button")
  btn("Clear").OnClick(btn("Clear"))
  J.ResolveID = oldResolve
end

-- Share note on the Review tab: makes the boss's raid note when it has none, then shares it
do
  local function shareBtn() for _, b in ipairs(buttons) do if b.text == "Share note" then return b end end end
  bossDD.opts.set(3470)
  local b = shareBtn()
  assert(b, "a Share note button exists")
  assert(b.shown == true, "shown for a boss with an encounter ID, even before it has a raid note")
  assert(helps["Share note"] and helps["Share note"]:find("raid leader or an assistant", 1, true), "Share note has a (?) help")
  canShare = false
  bossDD.opts.set(3470)
  assert(shareBtn().shown == true, "shown without permission to share too (the note then only becomes yours)")
  canShare = true
  noteFor[3470] = nil
  local before = #printed
  b.OnClick(b)
  local call = noteForCalls[#noteForCalls]
  assert(call and call.enc == 3470, "share note asks for the boss's note by encounter ID")
  assert(call.name and call.name:find("Nek", 1, true), "share note passes the boss's name for a new note's header: " .. tostring(call.name))
  assert(madeNotes == 1 and #shared == 1 and shared[1] == noteFor[3470], "a boss with no note gets one made, and that note is shared")
  local said = table.concat(printed, "|", before + 1)
  assert(said:find("Made a raid note", 1, true), "says a note was made: " .. said)
  b.OnClick(b)
  assert(madeNotes == 1 and #shared == 2 and shared[2] == noteFor[3470], "the second press shares the same note, nothing new is made")
  noteFor[3470] = 7
  b.OnClick(b)
  assert(shared[3] == 7, "an existing note is shared as it is: " .. tostring(shared[3]))
end
print("ok share note makes the note when needed and shares it")

-- A phase line moved on the timeline is written into the shown reference
do
  bossDD.opts.set(3470)
  pullDD.opts.set("ship:1")
  assert(view.onPhaseMoved, "phase move: the page listens to the view")
  local count = #CRT.db.timeline.references
  local before = #printed
  view.onPhaseMoved(1, 187)
  local key = pullDD.opts.get()
  assert(type(key) == "string" and key:find("^own:") and #CRT.db.timeline.references == count + 1, "phase move: a shipped reference becomes a reference of your own, and it is shown: " .. tostring(key))
  assert(table.concat(printed, "|", before + 1):find("ability timeline of your own", 1, true), "phase move: says a copy was made")
  local p = view.pull.reference.phases[1]
  assert(p.t == 187 and p.planned == 197, "phase move: the shown reference has the moved line")
  assert(not R:Find("ship:1").text:find("planned", 1, true), "phase move: the shipped text never changes")
  view.onPhaseMoved(1, 190)
  assert(pullDD.opts.get() == key and #CRT.db.timeline.references == count + 1 and R:Find(key).text:find("Phase: P1.5 3:10 (planned 3:17)", 1, true), "phase move: moving it again changes your copy in place")
  view.onPhaseMoved(1, 197)
  assert(not R:Find(key).text:find("planned", 1, true), "phase move: putting it back removes the planned note")
  R:Delete(key)
end
print("ok a moved phase line is saved into the reference")

-- Difficulty: the dropdown filters the lists, Save stamps, Copy to crosses over -----------------------
local function copyBtn(text, key) for _, b in ipairs(buttons) do if b.shown and b.text == text and rawget(b, "key") == key then return b end end end
local function statusIs(p) for _, s in ipairs(strings) do if type(s.text) == "string" and s.text:find(p, 1, true) == 1 then return s.text end end end

do
  diffDD.opts.set("nh")
  bossDD.opts.set(3470)
  for _, o in ipairs(opts(pullDD.opts)) do assert(o.key ~= "ship:1", "difficulty defaults to Normal/Heroic: the shipped Mythic reference is not in the pull options") end
  assert(view.pull == nil and view.group == "nh", "difficulty defaults to Normal/Heroic: nothing shown")
  local shown
  for _, s in ipairs(strings) do if s.text == "No pulls recorded for this boss yet" and s.shown then shown = true end end
  assert(shown, "difficulty defaults to Normal/Heroic: the empty label shows")
end
print("ok mythic reference is not in the Normal/Heroic pull options")

do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  assert(opts(pullDD.opts)[1].key == "ship:1" and view.pull and view.pull.reference and view.group == "mythic", "mythic shows the shipped reference")
end
print("ok mythic shows the shipped reference")

do
  GetDifficultyInfo = function(id) if id == 15 then return "Heroic" elseif id == 16 then return "Mythic" end end
  local function mk(d) T:SavePull({ encounterID = 5001, name = "Delta", difficultyID = d, length = 60, kill = false, casts = {}, deaths = {} }) end
  mk(15) mk(16) mk(15) mk(16)
  local ids = {}
  for _, p in ipairs(CRT.db.timeline.bosses[5001].pulls) do ids[#ids + 1] = p.id end
  local h1, m1, h2, m2 = ids[1], ids[2], ids[3], ids[4]
  diffDD.opts.set("nh")
  bossDD.opts.set(5001)
  local function pulls() local out = {} for _, o in ipairs(opts(pullDD.opts)) do if type(o.key) == "number" then out[#out + 1] = o end end return out end
  local nhList = pulls()
  assert(#nhList == 2 and nhList[1].key == h2 and nhList[2].key == h1, "pulls filtered by difficulty: Normal/Heroic lists its own")
  assert(nhList[1].label:find("Heroic$") and nhList[2].label:find("Heroic$"), "pulls filtered by difficulty: labels end with the difficulty name: " .. nhList[1].label)
  local bossOpt for _, o in ipairs(opts(bossDD.opts)) do if o.key == 5001 then bossOpt = o end end
  assert(bossOpt.label == "Delta (2)", "pulls filtered by difficulty: boss count is the group's: " .. bossOpt.label)
  diffDD.opts.set("mythic")
  local myList = pulls()
  assert(#myList == 2 and myList[1].key == m2 and myList[2].key == m1 and myList[1].label:find("Mythic$"), "pulls filtered by difficulty: Mythic lists its own")
  pullDD.opts.set(m1)
  assert(view.pull and view.pull.id == m1, "difficulty switch repairs the selection: a Mythic pull shown")
  diffDD.opts.set("nh")
  assert(pullDD.opts.get() == h2 and view.pull.id == h2 and view.group == "nh", "difficulty switch repairs the selection: newest Heroic pull: " .. tostring(pullDD.opts.get()))
  GetDifficultyInfo = nil
  T:SavePull({ encounterID = 5001, name = "Delta", length = 60, kill = false, casts = {}, deaths = {} })
  assert(pulls()[1].label:find("Normal/Heroic$"), "pull with no difficultyID is labelled Normal/Heroic")
  T:DeleteBoss(5001)
  bossDD.opts.set(3470)
end
print("ok pulls filtered by difficulty")
print("ok difficulty switch repairs the selection")

do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  pullDD.opts.set("ship:1")
  local b2 = recent(2) b2.OnClick(b2)
  assert(view.overlay and view.overlay.id == 2, "difficulty switch clears the overlay: laid")
  local sets = view.sets
  diffDD.opts.set("nh")
  assert(view.sets > sets and view.overlay == nil, "difficulty switch clears the overlay")
  diffDD.opts.set("mythic")
  assert(view.overlay == nil and view.group == "mythic", "difficulty switch clears the overlay: stays clear")
end
print("ok difficulty switch clears the overlay")

do
  diffDD.opts.set("nh")
  bossDD.opts.set(3470)
  paste:SetText("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nSmash: 0:10")
  btn("Save").OnClick(btn("Save"))
  local key = "own:" .. (CRT.db.timeline.nextRef - 1)
  assert(R:Find(key).text:find("Difficulty: Heroic", 1, true) and not R:Find(key).text:find("Mythic", 1, true), "save stamps the difficulty: stored")
  assert(paste:GetText():find("Difficulty: Heroic", 1, true), "save stamps the difficulty: the box shows it")
  assert(statusIs("Saved for Normal/Heroic"), "save stamps the difficulty: status " .. tostring((statusIs("Saved"))))
  paste:SetText("Boss: Nek'zali the Soulcoiler\\nPhase: P2 2:53 (planned 3:03)\\nSmash: 0:10")
  btn("Save").OnClick(btn("Save"))
  assert(R:Find(key).text:find("Phase: P2 2:53 (planned 3:03)", 1, true) and R:Find(key).text:find("Difficulty: Heroic", 1, true), "save stamps the difficulty: phase lines kept")
  R:Delete(key)
  btn("Clear").OnClick(btn("Clear"))
end
print("ok save stamps the difficulty")

do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  local c = copyBtn("Copy to Normal/Heroic", "ship:1")
  assert(c, "copy to normal/heroic: button on the shipped reference")
  local count = #CRT.db.timeline.references
  c.OnClick(c)
  assert(#CRT.db.timeline.references == count + 1, "copy to normal/heroic: an own reference is added")
  local text = CRT.db.timeline.references[count + 1].text
  assert(not text:find("\\nGrasping Depths", 1, true) and not text:find("\\nInvoke", 1, true) and text:find("Soulcoil Rite", 1, true) and text:find("Difficulty: Heroic", 1, true), "copy to normal/heroic: Mythic-only rows dropped, stamped")
  assert(statusIs("Copied to Normal/Heroic (2 Mythic-only rows left out)"), "copy to normal/heroic: status " .. tostring((statusIs("Copied"))))
  assert(not copyBtn("Copy to Mythic", "ship:1"), "copy to normal/heroic: no Copy to Mythic on a Mythic reference")
  local key = "own:" .. (CRT.db.timeline.nextRef - 1)
  for _, o in ipairs(opts(pullDD.opts)) do assert(o.key ~= key, "copy to normal/heroic: not listed under Mythic") end
  diffDD.opts.set("nh")
  local listed
  for _, o in ipairs(opts(pullDD.opts)) do if o.key == key then listed = o end end
  assert(listed, "copy to normal/heroic: switching to Normal/Heroic lists it")
  local back = copyBtn("Copy to Mythic", key)
  assert(back, "copy to mythic: button on a Normal/Heroic reference")
  back.OnClick(back)
  assert(statusIs("Copied to Mythic") and not statusIs("Copied to Mythic ("), "copy to mythic: status " .. tostring((statusIs("Copied"))))
  assert(CRT.db.timeline.references[#CRT.db.timeline.references].text:find("Difficulty: Mythic", 1, true), "copy to mythic: stamped Mythic")
  while #CRT.db.timeline.references > count do table.remove(CRT.db.timeline.references) end
  T:Set("grid", 30)
end
print("ok copy to normal/heroic")

do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  local count = #CRT.db.timeline.references
  local key = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nSmash (type raid mythic): 0:10")
  local c = copyBtn("Copy to Normal/Heroic", key)
  assert(c, "copy with only Mythic-only rows: button")
  c.OnClick(c)
  assert(#CRT.db.timeline.references == count + 1, "copy with only Mythic-only rows adds nothing")
  assert(statusIs("Nothing to copy: every row is Mythic-only"), "copy with only Mythic-only rows: plain status " .. tostring((statusIs("Nothing"))))
  R:Delete(key)
end
print("ok copy of an all Mythic-only reference says so")

do
  diffDD.opts.set("nh")
  bossDD.opts.set(3470)
  assert(not copyBtn("Copy", "ship:1") and not copyBtn("Copy to Mythic", "ship:1"), "references tab follows difficulty: shipped Mythic reference not listed")
  local nekOpt for _, o in ipairs(opts(bossDD.opts)) do if o.key == 3470 then nekOpt = o end end
  assert(nekOpt.label == "Nek'zali the Soulcoiler", "boss with no pulls in the group is labelled by name only: " .. nekOpt.label)
  diffDD.opts.set("mythic")
  local shipCopy = copyBtn("Copy", "ship:1")
  assert(shipCopy, "references tab follows difficulty: listed on Mythic")
  assert(shipCopy.pt[1] == "BOTTOMRIGHT" and copyBtn("Copy to Normal/Heroic", "ship:1").pt[1] == "RIGHT", "reference row: buttons sit on the line below the name")
  assert(CRT.Timeline.GROUP_NAMES.nh == "Normal/Heroic" and CRT.Timeline.GROUP_NAMES.mythic == "Mythic", "one shared group-name table")
end
print("ok references tab follows difficulty")

do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  assert(statusIs("New abilities") == "New abilities \\194\\183 Mythic", "mode names the difficulty Save writes: " .. tostring(statusIs("New abilities")))
  assert(statusIs("Ability timelines for Nek'zali the Soulcoiler (Mythic)"), "reference list is titled with the difficulty: " .. tostring(statusIs("Ability timelines for")))
  local count = #CRT.db.timeline.references
  local mkey = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nSmash (type raid mythic): 0:10")
  diffDD.opts.set("mythic")
  local e
  for _, b in ipairs(buttons) do if b.text == "Edit" and b.shown and rawget(b, "key") == mkey then e = b end end
  assert(e, "stale editing: edit button on the own Mythic reference")
  e.OnClick(e)
  assert(statusIs("Editing") and statusIs("Editing"):find("\\194\\183 Mythic$"), "mode names the difficulty Save writes: editing " .. tostring(statusIs("Editing")))
  local before = R:Find(mkey).text
  diffDD.opts.set("nh")
  assert(statusIs("New abilities") == "New abilities \\194\\183 Normal/Heroic", "stale editing: back to New reference after the switch: " .. tostring(statusIs("New abilities")))
  assert(paste:GetText() == before, "stale editing: the box keeps its text")
  btn("Save").OnClick(btn("Save"))
  assert(#CRT.db.timeline.references == count + 2, "stale editing: Save adds a new reference")
  assert(R:Find(mkey).text == before and R:Find(mkey).ref.difficulty == "Mythic", "stale editing: the Mythic one is untouched")
  local newKey = "own:" .. (CRT.db.timeline.nextRef - 1)
  assert(R:Find(newKey).text:find("Difficulty: Heroic", 1, true), "stale editing: the new one is Normal/Heroic")
  diffDD.opts.set("mythic")
  local listedM, listedNew
  for _, b in ipairs(buttons) do
    if b.shown and b.text == "Edit" and rawget(b, "key") == mkey then listedM = true end
    if b.shown and b.text == "Edit" and rawget(b, "key") == newKey then listedNew = true end
  end
  assert(listedM and not listedNew, "stale editing: the Mythic one is still listed on Mythic")
  R:Delete(newKey) R:Delete(mkey)
  btn("Clear").OnClick(btn("Clear"))
end
print("ok stale editing never moves a reference to the other group")
do
  local orderDD = find(dropdowns, "Order")
  assert(orderDD, "an Order dropdown is built")
  local key = R:Add("Boss: Delta\\nDifficulty: Mythic\\nEncounter: 5001\\nPhase: E1 1:00\\nPhase: E2 2:00\\nPhase: 3:00\\nOrder: E1, E2 = Gebbo, Nama\\nToss (part Gebbo): 1:10\\nThud (part Nama): 2:10\\nShared: 0:30")
  assert(key, "order reference saved")
  diffDD.opts.set("mythic")
  bossDD.opts.set(5001)
  pullDD.opts.set(key)
  local list = opts(orderDD.opts)
  assert(#list == 2 and list[1].label == "Gebbo > Nama (as written)" and list[2].key == "Nama > Gebbo", "order options: " .. tostring(list[1] and list[1].label))
  assert(orderDD.opts.get() == "Gebbo > Nama" and view.order and view.order[1] == "Gebbo", "written order chosen at first")
  orderDD.opts.set("Nama > Gebbo")
  assert(CRT.db.timeline.orders[5001].mythic == "Nama > Gebbo", "chosen order saved per boss and difficulty")
  assert(orderDD.opts.get() == "Nama > Gebbo" and view.order[1] == "Nama", "view gets the chosen order")
  assert(CRT.db.timeline.orders[5001].nh == nil, "the other difficulty keeps its own")
  orderDD.opts.set("Gebbo > Nama")
  assert(CRT.db.timeline.orders[5001].mythic == nil, "the written order is kept as no choice")
  pullDD.opts.set("ship:1")
  bossDD.opts.set(3470)
  assert(view.order == nil and #opts(orderDD.opts) == 0, "a reference with no Order line has no order")
  R:Delete(key)
  diffDD.opts.set("nh")
end
print("ok order dropdown saves the raid's order")
do
  assert(T:GroupFor("Mythic") == "mythic" and T:GroupFor("Heroic") == "nh" and T:GroupFor(nil) == "nh", "group for a difficulty name")
  local key = R:Add("Boss: Delta\\nDifficulty: Mythic\\nEncounter: 5001\\nPhase: Window A 1:00\\nPhase: Window B 2:00\\nPhase: 3:00\\nOrder: Window A, Window B = Gebbo, Nama\\nToss [spell 777] (part Gebbo): 1:10, 1:55\\nThud (part Nama): 2:10\\nShared: 0:30")
  assert(key, "order reference for OrderShift")
  assert(T:OrderShift(5001, "mythic") == nil, "written order: no shift")
  assert(T:OrderShift(5001, "nh") == nil, "no Normal/Heroic reference with an order: no shift")
  assert(T:OrderShift(9999, "mythic") == nil, "a boss with no reference: no shift")
  T:SetOrder(5001, "mythic", "Nama > Gebbo")
  local shift, unshift = T:OrderShift(5001, "mythic")
  assert(shift and unshift, "a chosen order shifts, both ways")
  assert(unshift(777, "", 130) == 70 and unshift(0, "Thud", 70) == 130, "unshift takes a drawn time back to the written one")
  assert(unshift(777, "", 70) == false, "unshift: a time outside the part's chosen window")
  assert(unshift(0, "Shared", 30) == 30, "unshift: a line of no part row keeps its time")
  assert(shift(777, "anything", 70) == 130, "found by spell ID, moved to its new window")
  assert(shift(0, "{rt1} Thud soon", 130) == 70, "found by name in the text")
  assert(shift(0, "Shared", 30) == 30 and shift(0, "nothing here", 75) == 75, "a line of no part row keeps its time")
  T:SetOrder(5001, "mythic", nil)
  R:Delete(key)
end
print("ok order shift for the alerts")
do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  pullDD.opts.set("ship:1")
  local last = CRT.db.timeline.lastView
  assert(last and last.group == "mythic" and last.boss == 3470 and last.pull == "ship:1", "the shown view is saved")
  diffDD.opts.set("nh")
  -- a reload: the page is built again from what was saved
  CRT.db.timeline.lastView = { group = "mythic", boss = 3470, pull = "ship:1" }
  local pf2 = mock()
  pages.timeline.build(pf2)
  pf2:Show()
  T:Fire()
  assert(diffDD.opts.get() == "mythic" and bossDD.opts.get() == 3470 and pullDD.opts.get() == "ship:1" and view.group == "mythic", "a reload opens on the saved difficulty, boss and reference")
  CRT.db.timeline.lastView = { group = "mythic", boss = 3470, pull = 99999 }
  local pfN = mock()
  pages.timeline.build(pfN)
  pfN:Show()
  T:Fire()
  assert(bossDD.opts.get() == 3470 and type(pullDD.opts.get()) == "string" and pullDD.opts.get():find("^%a+:%d+$"), "a saved pull that is gone falls back to the boss's reference: " .. tostring(pullDD.opts.get()))
  CRT.db.timeline.lastView = { group = "mythic", boss = 424242, pull = 1 }
  local pfN = mock()
  pages.timeline.build(pfN)
  pfN:Show()
  T:Fire()
  assert(bossDD.opts.get() ~= 424242 and bossDD.opts.get() ~= nil, "a saved boss that is gone falls back to the first listed")
  diffDD.opts.set("nh")
end
print("ok the last view is saved and opened again")
do
  diffDD.opts.set("nh")
  local ok = T:ShowRow(3470, "Soulcoil Rite")
  assert(ok == true and diffDD.opts.get() == "mythic" and bossDD.opts.get() == 3470 and view.highlight and view.highlight.name == "soulcoil rite", "show row: finds the Mythic-only boss and lights the row")
  assert(T:ShowRow(3470, 987654, "Not a row") == false, "show row: no such row")
  assert(T:ShowRow(55555, 1) == false and diffDD.opts.get() == "mythic", "show row: an unknown boss keeps the difficulty shown")
  diffDD.opts.set("nh")
end
print("ok show a row on the timeline")
do
  -- from Mech Alerts: closing the pop-out goes back to Raid Notes; the Dock button stays on the Timeline
  CRT.db.lastPage, selectedPage = "notes", nil
  if popFrame and popFrame:IsShown() then popFrame:Hide() popFrame.OnHide() end
  selectedPage = nil
  T:ShowRow(3470, "Soulcoil Rite")
  CRT.db.lastPage = "timeline"
  assert(popFrame and popFrame:IsShown(), "show row pops the Timeline out")
  popFrame:Hide() popFrame.OnHide()
  assert(selectedPage == "notes", "closing goes back to the page it came from: " .. tostring(selectedPage))
  selectedPage = nil
  CRT.db.lastPage = "notes"
  T:ShowRow(3470, "Soulcoil Rite")
  CRT.db.lastPage = "timeline"
  popFrame:Hide() popFrame.OnHide()
  popFrame.OnHide()
  assert(selectedPage == "notes", "once")
  selectedPage = nil
  CRT.TimelinePopout()
  popFrame:Hide() popFrame.OnHide()
  assert(selectedPage == nil, "a plain pop-out closes onto the Timeline")
  diffDD.opts.set("nh")
end
print("ok closing a Show on the Timeline goes back")
do
  -- the pop-out is a UI.Window pop-out, so it has the game's window art in Default: Blizzard and the theme in
  -- the Modern themes (UI:StyleWindow restyles it on a theme change), never a flat black box of its own
  local made
  for _, m in ipairs(windowsMade) do if m.name == "CowfeeRaidToolsTimelineWindow" then assert(not made, "the pop-out is made once") made = m end end
  assert(made, "the pop-out is made by UI.Window, keeping its global name")
  local o = made.opts
  assert(o.kind == "popout" and o.layer == "timeline" and o.title == "Timeline", "pop-out: kind popout, the timeline layer, its title")
  assert(o.minWidth == 760 and o.minHeight == 360 and o.width == 1200 and o.height == 600, "pop-out: MIN_W and MIN_H kept, 1200 x 600 by default")
  assert(type(o.saved) == "function" and o.saved() == CRT.db.timeline.popout, "pop-out: its place and size stay in timeline.popout")
  assert(o.escape ~= false, "pop-out: Escape closes it")
  local w = made.frame
  assert(popFrame == w, "pop-out: on the timeline layer")
  assert(not rawget(w, "flatPainted"),"pop-out: no backdrop colours of its own (the old flat black look)")
  local before = w.placed
  CRT.TimelinePopout()
  assert(w.placed == before + 1, "pop-out: put at its saved place each time it opens")
  assert(reparented and reparented.parent == w.content, "pop-out: the Review tab moves into the window's content")
  w:Hide() w.OnHide()
  assert(reparented.parent ~= w.content, "pop-out: closing puts the Review tab back")
  diffDD.opts.set("nh")
end
print("ok the pop-out is a UI.Window")

-- Rehearse (Task 4) ------------------------------------------------------------------------------------
local RW, Run = CRT.TimelineRehearsalWindow, CRT.TimelineRehearsalRun
local function rehearseBtn() for i = #buttons, 1, -1 do if buttons[i].text == "Rehearse" then return buttons[i] end end end
-- the Rehearsal watcher is the last frame made that watches combat and encounters (Data.lua's recorder watches them too)
local function runEvents() for i = #allFrames, 1, -1 do local fr = allFrames[i] if rawget(fr, "OnEvent") and rawget(fr, "events") and fr.events.ENCOUNTER_START and fr.events.PLAYER_REGEN_DISABLED then return fr end end end
do
  local b = rehearseBtn()
  assert(b, "a Rehearse button on the Review tab")
  assert(helps["Rehearse"], "Rehearse has a (?)")
  diffDD.opts.set("nh")
  bossDD.opts.set(3470)
  assert(view.pull == nil, "nothing shown on Normal/Heroic")
  assert(b.enabled == false and T:RehearsalSource() == nil, "greyed with nothing shown")
  local before = #printed
  assert(T:Rehearse() == false and not RW:IsOpen(), "nothing to open")
  assert(#printed == before + 1, "says why")
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  pullDD.opts.set("ship:1")
  assert(b.enabled == true, "enabled with a reference shown")
end
print("ok rehearse button greyed without a source")

do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  pullDD.opts.set("ship:1")
  local s = T:RehearsalSource()
  assert(s and s.base and s.base.reference == view.pull.reference, "source: the shown reference")
  assert(s.encounterID == 3470 and s.group == "mythic" and s.difficultyName == "Mythic" and s.bossName == "Nek'zali the Soulcoiler" and s.order == nil, "source: boss, group, difficulty, name, order")
  pullDD.opts.set(2)
  s = T:RehearsalSource()
  assert(s and s.base == view.pull and s.base.id == 2 and s.difficultyName == "Mythic", "source: a recorded pull")
  GetDifficultyInfo = function(id) if id == 16 then return "Mythic (game)" end end
  assert(T:RehearsalSource().difficultyName == "Mythic (game)", "source: a pull's own difficulty name")
  GetDifficultyInfo = nil
  local key = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Heroic\\nA: 0:10")
  diffDD.opts.set("nh")
  bossDD.opts.set(3470)
  pullDD.opts.set(key)
  s = T:RehearsalSource()
  assert(s and s.group == "nh" and s.difficultyName == "Heroic", "source: a Heroic reference plays as Heroic")
  local nkey = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Normal\\nA: 0:10")
  pullDD.opts.set(nkey)
  assert(T:RehearsalSource().difficultyName == "Normal", "source: a reference's own Difficulty line: " .. tostring(T:RehearsalSource().difficultyName))
  local bkey = R:Add("Boss: Nek'zali the Soulcoiler\\nA: 0:10")
  pullDD.opts.set(bkey)
  assert(T:RehearsalSource().difficultyName == "Heroic", "source: a reference with no Difficulty line plays as its group")
  R:Delete(nkey) R:Delete(bkey)
  pullDD.opts.set(key)
  local b = rehearseBtn()
  b.OnClick(b)
  assert(RW:IsOpen() and RW.source.encounterID == 3470 and RW.source.difficultyName == "Heroic", "the button opens the window on the source")
  RW:Close()
  R:Delete(key)
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  pullDD.opts.set("ship:1")
end
print("ok rehearse opens on what the Review tab shows")

do
  local b = rehearseBtn()
  assert(b.enabled == true, "enabled to begin with")
  InCombatLockdown = function() return true end
  T:Set("grid", 30)
  assert(b.enabled == false, "greyed in combat")
  local before = #printed
  assert(T:Rehearse() == false and not RW:IsOpen() and #printed == before + 1, "in combat: not opened, says why")
  InCombatLockdown = function() return false end
  T:Set("grid", 30)
  assert(b.enabled == true, "enabled again")
  local ev = runEvents()
  assert(ev, "the combat watcher")
  ev.OnEvent(ev, "PLAYER_REGEN_DISABLED")
  assert(b.enabled == false, "greyed as combat starts (before InCombatLockdown is true)")
  ev.OnEvent(ev, "PLAYER_REGEN_ENABLED")
  assert(b.enabled == true, "enabled when combat ends")
  ev.OnEvent(ev, "ENCOUNTER_START", 3470)
  assert(b.enabled == false, "greyed during an encounter")
  ev.OnEvent(ev, "ENCOUNTER_END", 3470)
  assert(b.enabled == true, "enabled after it")
  IsEncounterInProgress = function() return true end
  T:Set("grid", 30)
  assert(b.enabled == false, "greyed while the game says an encounter is in progress")
  IsEncounterInProgress = nil
  alertsStub.running = true
  alertsStub.fire()
  assert(b.enabled == false, "greyed while the alerts run a real pull")
  alertsStub.rehearsal = true
  alertsStub.fire()
  assert(b.enabled == true, "a rehearsal run does not grey it")
  alertsStub.running, alertsStub.rehearsal = false, false
  alertsStub.fire()
  assert(b.enabled == true, "enabled again")
end
print("ok rehearse greyed in combat")

do
  SlashCmdList = {}
  strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
  local lines = {}
  local oldPrint = print
  CRT.version = "test"
  assert(load(slashSrc, "CRT_Core/Slash.lua"))("CowfeeRaidTools", CRT)
  print = function(s) lines[#lines + 1] = s end
  SlashCmdList["COWFEERAIDTOOLS"]("help")
  print = oldPrint
  local listed
  for i, l in ipairs(lines) do if l:find("/crt timeline rehearse", 1, true) and lines[i - 1] and lines[i - 1]:find("/crt timeline", 1, true) then listed = true end end
  assert(listed, "the help lists it next to the timeline line")
  SlashCmdList["COWFEERAIDTOOLS"]("timeline rehearse")
  assert(RW:IsOpen() and RW.source.encounterID == 3470, "/crt timeline rehearse opens it")
  RW:Close()
  InCombatLockdown = function() return true end
  local before = #printed
  SlashCmdList["COWFEERAIDTOOLS"]("timeline rehearse")
  assert(not RW:IsOpen() and #printed == before + 1, "/crt timeline rehearse in combat: says why")
  InCombatLockdown = function() return false end
end
print("ok slash rehearse follows the button")

-- Play on the Review tab and the playhead -----------------------------------------------------------
do
  local function playBtn() for i = #buttons, 1, -1 do local x = buttons[i] if (x.text == "Play" or x.text == "Pause") and not (RW.frame and x == RW.frame.play) then return x end end end
  -- the Review tab's per-frame update: every OnUpdate but the view's and the Rehearsal window's own
  local function tick() for _, fr in ipairs(allFrames) do local fn = rawget(fr, "OnUpdate") if fn and fr ~= view.frame and fr ~= RW.frame and fr ~= RW.frame.strip then pcall(fn, fr) end end end
  if RW:IsOpen() then RW:Close() end
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  pullDD.opts.set("ship:1")
  local b = playBtn()
  assert(b and helps["Play"], "a Play button with a (?)")
  assert(b.enabled == true, "enabled with a fight shown")
  tick()
  assert(view.playT == nil, "no playhead without a rehearsal")
  b.OnClick(b)
  assert(RW:IsOpen() and RW:Playing(), "Play opens the Rehearsal on the shown fight and plays it")
  assert(RW.source.boss == 3470 and RW.source.pull == "ship:1" and RW.source.group == "mythic", "the source names the boss, pull and difficulty")
  tick()
  assert(view.playT and view.playFollow == true and b.text == "Pause", "the playhead follows while playing, the button says Pause")
  b.OnClick(b)
  assert(RW:IsOpen() and not RW:Playing(), "Play again pauses the same fight")
  RW:Seek(42)
  tick()
  assert(view.playT == 42 and view.playFollow == false and b.text == "Play", "the playhead at the Rehearsal's time, paused: " .. tostring(view.playT))
  -- the window's own Play moves it too
  RW:Play()
  tick()
  assert(b.text == "Pause" and view.playFollow == true, "the window's Play plays here too")
  RW:Pause()
  -- another fight shown: no playhead, and Play opens the shown one instead
  pullDD.opts.set(2)
  tick()
  assert(view.playT == nil and b.text == "Play", "a rehearsal of another fight shows no playhead")
  b.OnClick(b)
  assert(RW:IsOpen() and RW.source.pull == 2 and RW:Playing(), "Play opens the shown fight")
  RW:Close()
  tick()
  assert(view.playT == nil, "closing the Rehearsal hides the playhead")
  pullDD.opts.set("ship:1")
end
print("ok play on the timeline moves the playhead")
do
  -- Send to Timeline saves the Journal's export at once and opens it; the middle list is that reference
  local text = table.concat({ "Boss: Nek'zali the Soulcoiler", "Difficulty: Mythic", "Encounter: 3470", "# Stage One",
    "Soulcoil Rite [spell 111] (type raid, tags healer):", "Phase: P1.5 (Intermission: Ritual of Awakening)", "Essence Rend:" }, "\\n")
  local key = T:SaveReferenceText(text)
  assert(key and key:find("^own:"), "saved as your reference: " .. tostring(key))
  assert(diffDD.opts.get() == "mythic" and bossDD.opts.get() == 3470 and pullDD.opts.get() == key, "its boss, difficulty and reference picked")
  local function shown(t) for _, x in ipairs(strings) do if x.text == t then return x end end end
  assert(shown("Phase 1 (from the pull)"), "the list starts with phase 1")
  assert(shown("Intermission: Ritual of Awakening") and not shown("P1.5  Intermission: Ritual of Awakening"), "a phase waiting for its start, as a heading by its name, not its number")
  assert(shown("no start yet") and shown("no times"), "says what still needs a time")
  assert(statusIs("Abilities"), "titled as the reference's abilities")
  -- text that doesn't read yet goes to the box instead
  assert(T:SaveReferenceText("Boss: X") == nil, "nothing saved when it doesn't read")
  R:Delete(key)
  diffDD.opts.set("mythic") bossDD.opts.set(3470) pullDD.opts.set("ship:1")
end
print("ok send to timeline saves and lists the reference")

do
  -- what a Test button rehearses: the boss's reference for the group, else its newest pull, leaving
  -- the page's own selection alone
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  pullDD.opts.set(2)
  local s = T:RehearsalSourceFor(3470, "mythic")
  assert(s and s.base.reference and s.base.reference.boss == "Nek'zali the Soulcoiler", "the group's reference first")
  assert(s.encounterID == 3470 and s.group == "mythic" and s.bossName == "Nek'zali the Soulcoiler" and s.order == nil, "boss, group, name, order")
  assert(pullDD.opts.get() == 2 and view.pull.id == 2, "the page's selection is unchanged")
  assert(T:RehearsalSourceFor(3470, "nh") == nil, "no Normal/Heroic reference or pull: nil")
  local pulls = CRT.db.timeline.bosses[3470].pulls
  pulls[#pulls + 1] = { id = 3, difficultyID = 15, length = 200, kill = true, casts = {}, deaths = {} }
  s = T:RehearsalSourceFor(3470, "nh")
  assert(s and s.base.id == 3 and s.group == "nh" and s.pull == 3, "else the newest pull of the group")
  pulls[#pulls] = nil
  assert(T:RehearsalSourceFor(4242, "mythic") == nil, "a boss with nothing: nil")
  pullDD.opts.set("ship:1")
end
print("ok rehearsal source for a boss and difficulty")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const p of process.argv.slice(2, 17)) {
  let src; try { src = fs.readFileSync(p, 'utf8'); } catch (e) { console.error('cannot read ' + p); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 15, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
