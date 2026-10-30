// CRT_Modules/Timeline/Page.lua on mock frames: the real Data.lua, a stub Journal and View.
// usage: node run_timeline_page.js <Data.lua> <Database.lua> <Reference.lua> <Lanes.lua> <ReferencePage.lua> <SettingsTab.lua> <Page.lua> <Journal.lua> <Registry.lua> <Season.lua> <Nekzali.lua> <ReviewTab.lua> <Rehearsal.lua> <RehearsalWindow.lua> <CRT_Core/Slash.lua>
// Journal.lua is loaded on its own CRT table only for its RaidBosses, which the stub Journal hands on.
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, dbSrc, refSrc, lanesSrc, refPageSrc, settingsTabSrc, pageSrc, journalSrc, regSrc, seasonSrc, nekSrc, reviewSrc, rehSrc, rehWinSrc, slashSrc, toggleSrc = ...
local strings, checks, edits, buttons, dropdowns, sliders = {}, {}, {}, {}, {}, {}
pills = {}
selectedTabButton = nil
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
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
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
function CreateFrame(kind, _, _, template) local m = mock(kind) m.template = template allFrames[#allFrames + 1] = m
  if kind == "CheckButton" then checks[#checks+1] = m elseif kind == "EditBox" then edits[#edits+1] = m
  elseif kind == "Button" then buttons[#buttons+1] = m end
  return m end
format = string.format
CRTFontButtonSmall, CRTFontButtonSmallHighlight, CRTFontButtonSmallDisable = { "small" }, { "smallHighlight" }, { "smallDisable" }
CANCEL = "Cancel"
UISpecialFrames = {}
UIParent = { GetWidth = function() return 1920 end, GetHeight = function() return 1080 end } -- the screen the pop-out sizes in
function tinsert(t, v) table.insert(t, v) end
InCombatLockdown = function() return false end
C_Spell = { GetSpellName = function() return nil end }
local popup
StaticPopup_ShowCustomGenericConfirmation = function(info) popup = info end
local pages, tabs, printed, helps = {}, {}, {}, {}
local helpTargets, helpCalls = {}, 0 -- UI.HelpRight's target for each (?), by title; UI.Help calls made outside it
skinCalls = 0
rowsList = {}
tooltipSettings = {}
local function opts(o) return type(o.options) == "function" and o.options() or o.options end
local CRT = { db = { timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3, overlayOn = false, hideEmpty = false, nextId = 1 } },
  UI = { Tint = function() end, OnTheme = function() end, SkinScrollBar = function() end, PAGE_W = 1026, PAGE_H = 560, Help = function(_, title, text) helpCalls = helpCalls + 1 helps[title] = text return mock() end,
    HelpRight = function(target, title, text) helps[title] = text helpTargets[title] = target return mock() end, HELP_GAP = 4, HELP_SIZE = 20,
    Dropdown = function(parent, text, o) local m = mock() m.opts, m.text, m.parent = o, text, parent dropdowns[#dropdowns+1] = m rawset(m, "refresh", function() end) return m end,
    -- as wide as the real row: its label, the gap, the bar and the value (CRT_Core/UI/Controls.lua)
    Slider = function(_, text, o) local m = mock() m.opts, m.text = o, text sliders[#sliders+1] = m rawset(m, "refresh", function() end)
      rawset(m, "GetWidth", function() return (o.labelWidth or 140) + 5 + (o.width or 200) + 44 end) return m end,
    PanelButton = function(parent, label, h, onClick) local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b.text = label
      rawset(b, "OnClick", onClick) rawset(b, "GetWidth", function(self) return rawget(self, "w") or math.max(40, #label * 6 + 28) end)
      -- the label's width follows its font: a font set after the last sizing leaves the button the wrong width
      rawset(b, "SetNormalFontObject", function(self, f) self.normalFont = f self.sized = false end)
      rawset(b, "SetHighlightFontObject", function(self, f) self.highlightFont = f end)
      rawset(b, "SetDisabledFontObject", function(self, f) self.disabledFont = f end)
      rawset(b, "GetFontString", function(self) return { GetStringWidth = function() return #label * (self.normalFont == CRTFontButtonSmall and 5 or 6) end } end)
      rawset(b, "SetWidth", function(self, w) self.w = w self.sized = true end)
      b.sized = true return b end,
    PanelButtonWidth = function(w) return math.max(40, math.ceil(w or 0) + 28) end,
    -- CRT_Core/UI/Controls.lua's value pill (tested in run_controls.js): its options, its refresh greys it
    ValuePill = function(parent, o) local m = mock("pill") m.opts, m.parent = o, parent pills[#pills + 1] = m
      rawset(m, "refresh", function() m.enabled = not o.enabledIf or (o.enabledIf() and true or false) m.text = tostring(o.get()) end) m.refresh() return m end,
    SkinTree = function(_, f) skinCalls = skinCalls + 1 end,
    SkinEditBox = function(_, e) rawset(e, "skinned", true) end,
    RegisterPage = function(_, key, title, fn) pages[key] = { title = title, build = fn } end,
    RegisterTab = function(_, b) tabs[#tabs+1] = b end, SetTabSelected = function(_, b, on) if on then selectedTabButton = b end end,
    IsModern = function() return true end, Scale = function() return 100 end, RegisterLayer = function(_, k, f) layered = k if k == "timeline" then popFrame = f end end, SelectPage = function(_, k) selectedPage = k end,
    ResetButtonWidth = function() return 44 end, ResetButton = function() return mock() end, Show = function() end, SkinCloseButton = function() end,
    StyleWindow = function() end, SetFrameTitle = function() end },
  PALETTE = { background = { 0.1, 0.1, 0.1 }, border = { 0.3, 0.3, 0.3 }, accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, text = { 0.95, 0.9, 0.84 } },
}
CRT_THEME(CRT, CRT.UI)
-- Timeline.DevMode reads the Development page's hidden flag: /crt dev open while the tests run, unless one closes it
CRT.UI.pages = { dev = { hidden = false } }
local function setDev(on) CRT.UI.pages.dev.hidden = not on end
-- a developer build: the CRT_Dev files loaded (CRT.Dev); a test takes it away for a packaged build
CRT.Dev = {}
-- the real CRT_Core/UI/Toggle.lua (UI.Toggle2, the pop-out's Abilities | Healer CDs toggle)
assert(load(toggleSrc, "CRT_Core/UI/Toggle.lua"))("CowfeeRaidTools", CRT)
-- over the real UI/Tooltip.lua's (CRT_THEME loads it): the Tooltip position dropdown with its spot picker,
-- recording the area and the options
CRT.UI.TooltipPositionSetting = function(parent, area, o) local g = { row = mock(), picker = mock(), area = area, opts = o, parent = parent, refreshed = 0 }
  g.refresh = function() g.refreshed = g.refreshed + 1 end tooltipSettings[#tooltipSettings + 1] = g return g end
function CRT:Print(m) printed[#printed+1] = m end
-- the shared window helper (CRT_Core/UI/Window.lua): records what it was asked for; like it, puts the frame on its layer
windowsMade = {}
function CRT.UI.Window(name, o)
  local w = mock("window") w.content = mock() w.placed = 0
  w.strip, w.reset = mock("strip"), mock("reset") -- the title strip, and Reset on it (a pop-out's)
  rawset(w, "Place", function(self) self.placed = self.placed + 1 end)
  rawset(w, "SetBackdropColor", function(self) self.flatPainted = true end)
  windowsMade[#windowsMade + 1] = { name = name, opts = o, frame = w }
  CRT.UI:RegisterLayer(o.layer or "popups", w)
  return w
end
local customAdded = {}
customRemoved = {}
journalHidden = {}
CRT.TimelineJournal = { ResolveID = function(_, k, r) if type(k) == "number" then return k end if r and type(r.encounterID) == "number" then return r.encounterID end end, Rows = function() return rowsList end, AddCustom = function(_, e, s) customAdded[#customAdded+1] = s end,
  RemoveCustom = function(_, e, s) customRemoved[#customRemoved + 1] = s end, SetHidden = function(_, e, s, h) journalHidden[e .. ":" .. s] = h or nil end,
  IsHidden = function(_, e, s) return journalHidden[e .. ":" .. tostring(s)] and true or false end }
do
  local realCRT = {}
  assert(load(journalSrc, "Journal.lua"))("CowfeeRaidTools", realCRT)
  CRT.TimelineJournal.RaidBosses = function() return realCRT.TimelineJournal:RaidBosses() end
end
local view = { SetData = function(self, pull, eid, overlay, name, group) self.pull, self.eid, self.overlay, self.group = pull, eid, overlay, group self.sets = (self.sets or 0) + 1 end, refreshes = 0, Refresh = function(self) self.refreshes = self.refreshes + 1 end, SetSpan = function(self, v) self.span = v end, Fit = function(self) self.fits = (self.fits or 0) + 1 end, CastCount = function() return 0 end, SetOrder = function(self, o) self.order = o end, ClearHighlight = function(self) self.highlight = nil end, Highlight = function(self, id, name) self.highlight = { spellID = id, name = name and name:lower() } local ref = self.pull and self.pull.reference for _, row in ipairs(ref and ref.rows or {}) do if (id and row.spellID == id) or (name and row.name:lower() == name:lower()) then return true end end return false end }
view.SetMode = function(self, mode, later) self.mode = mode self.later = later if not later then self.refreshes = self.refreshes + 1 end end
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
-- Boss library wiring (CRT_Data/Bosses/Registry.lua, then the tests' sample pack (CRT_Dev/Tests/SamplePack: test data, never the shipped season), then the ADDON_LOADED the game fires once every file has loaded).
local function loadBosses(CRT, reg, season, nek)
  local real, handler = CreateFrame, nil
  CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
  assert(load(reg, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
  CreateFrame = real
  assert(load(season, "CRT_Dev/Tests/SamplePack/Season.lua"))("CowfeeRaidTools", CRT)
  assert(load(nek, "CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua"))("CowfeeRaidTools", CRT)
  -- the test bosses are in the library too: the boss list shows library bosses only
  for _, b in ipairs({ { 3001, "Alpha" }, { 3002, "Beta" }, { 3003, "Gamma (2)" }, { 4004, "Zork the Late" }, { 5001, "Delta" } }) do
    CRT.Bosses:Register({ encounterID = b[1], name = b[2], season = "sample" })
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
-- the /crt registry before Page.lua, as the .toc loads it, so Page.lua registers /crt timeline (tested below)
SlashCmdList = {}
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
assert(load(slashSrc, "CRT_Core/Slash.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock()
assert(pages.timeline, "page registered") print("ok page registered")
pages.timeline.build(pf)
pf:Show()

local function tabText(b) return type(b.text) == "table" and b.text.text or b.text end
local function find(list, text) for _, d in ipairs(list) do if d.text == text then return d end end end
assert(#tabs == 3 and tabText(tabs[1]) == "Review" and tabText(tabs[2]) == "Settings" and tabText(tabs[3]) == "Advanced", "tabs order: Review, Settings, Advanced")
print("ok tabs order")

assert(find(dropdowns, "Pull") == nil, "no Pull dropdown on the Review tab")
print("ok no Pull dropdown")
-- the read-only label of the ability timeline shown, where the Pull dropdown was (the Unnamed casts (?) follows it)
local function shownLabel() return helpTargets["Unnamed casts"] end
local function labelText() local l = shownLabel() return l and l.text end
-- a shown Recent pulls row, by the pull's id
local function recentRow(id)
  for _, b in ipairs(buttons) do
    if rawget(b, "title") and b.shown and rawget(b, "pullID") == id then return b end
  end
end
do
  local first = find(dropdowns, "Boss")
  local o = opts(first.opts)
  assert(o[1].title and not o[2].title, "the boss list starts with a raid heading")
  assert(first.opts.get() == o[2].key, "the page opens on the route's first boss")
  first.opts.set(3001)
end
print("ok boss list follows the route")
-- pull 12 is Alpha's second pull: shown by its own count on the boss, on the Recent pulls list
do
  local row = recentRow(12)
  assert(row and row.title.text == "Pull 2 " .. string.char(194, 183) .. " 1:00 " .. string.char(194, 183) .. " wipe " .. string.char(194, 183) .. " Normal/Heroic", "pull label: " .. tostring(row and row.title.text))
  -- Alpha has no ability timeline: its newest pull is drawn, lit on the list, and the label says so
  assert(view.pull and view.pull.id == 12 and labelText() == "No ability timeline " .. string.char(194, 183) .. " Pull 2", "no ability timeline: the newest pull is drawn: " .. tostring(labelText()))
  row.OnClick(row)
  assert(view.pull.id == 12, "no ability timeline: clicking the drawn pull keeps it")
  local r11 = recentRow(11)
  r11.OnClick(r11)
  assert(view.pull.id == 11 and view.overlay == nil and labelText():find("Pull 1$"), "no ability timeline: clicking another pull draws it")
  r11 = recentRow(11) r11.OnClick(r11)
  assert(view.pull.id == 12, "no ability timeline: clicking it again goes back to the newest")
end
print("ok pull label")

local diffDD = find(dropdowns, "Difficulty")
do
  assert(diffDD and diffDD.opts.get() == "nh", "difficulty defaults to Normal/Heroic")
  local o = opts(diffDD.opts)
  assert(#o == 2 and o[1].key == "nh" and o[1].label == "Normal/Heroic" and o[2].key == "mythic" and o[2].label == "Mythic", "difficulty options")
  assert(helps["Difficulty"] and helps["Difficulty"]:find("Mythic-only", 1, true), "difficulty has a (?) that explains the split")
  -- every (?) on the page is UI.HelpRight's, right of the thing it explains
  assert(helpCalls == 0, "no (?) made outside UI.HelpRight: " .. helpCalls)
  for title in pairs(helps) do assert(helpTargets[title] ~= nil, "the (?) " .. title .. " has a target") end
  assert(helpTargets["Difficulty"] == diffDD, "Difficulty's (?) is right of its dropdown")
  assert(shownLabel() and shownLabel().kind == "fs" and shownLabel().pt[4] == 412, "Unnamed casts' (?) is right of the label, where the Pull dropdown was")
  assert(helpTargets["Order"] == find(dropdowns, "Order"), "Order's (?) is right of its dropdown")
  local deaths = helpTargets["Deaths from recent pulls"]
  assert(deaths and deaths.kind == "fs" and deaths.text == "pulls", "the Deaths checkbox's (?) is right of the word after its pill")
  assert(helpTargets["Pop out"] and helpTargets["Pop out"].text == "Pop out", "Pop out's (?) is right of its button")
  local pt = helpTargets["Pop out"].pt
  assert(pt and pt[1] == "TOPRIGHT" and pt[4] == -8 - 4 - 20, "Pop out stands a (?) in from the right, so its (?) ends at the frame's inset: " .. tostring(pt and pt[4]))
  assert(helpTargets["Rehearse"] and helpTargets["Rehearse"].pt[2] == helpTargets["Pop out"] and helpTargets["Rehearse"].pt[4] == -(4 + 20 + 6), "Rehearse sits a (?) and a gap left of Pop out")
  print("ok every (?) on the Review tab is right of what it explains")
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

-- Settings tab > Tooltips: the timeline area's Tooltip position and its picker, under Recording in the right
-- column, with a (?) on its heading; refreshed with the tab's other controls
do
  assert(#tooltipSettings == 1 and tooltipSettings[1].area == "timeline", "the Settings tab has the Timeline's Tooltip position: " .. #tooltipSettings)
  local g = tooltipSettings[1]
  assert(helps["Tooltips"] and helpTargets["Tooltips"] and helpTargets["Tooltips"].text == "Tooltips", "the Tooltips heading has a (?)")
  local hp = helpTargets["Tooltips"].pt or {}
  local rp = rawget(g.row, "pt") or {}
  assert(hp[1] == "TOPLEFT" and hp[4] == 360 and rp[1] == "TOPLEFT" and rp[4] == 360 and rp[5] < hp[5], "Tooltips sits in the right column, the dropdown under its heading")
  local overlayPulls = find(sliders, "Overlay pulls")
  assert(overlayPulls and overlayPulls.pt[4] == 360 and hp[5] < overlayPulls.pt[5] - 20, "Tooltips sits under Overlay pulls in the right column")
  -- under the dropdown (about 30 high), the picker (UI.SPOT_PICKER_H, at most 70) stays inside the tab
  local labelW = g.opts and g.opts.labelWidth or 140
  assert(rp[5] - 32 - 70 > -(CRT.UI.PAGE_H - 60) and 360 + labelW + 5 + 126 < CRT.UI.PAGE_W, "the Tooltips picker fits the tab: " .. tostring(rp[5]))
  local before = g.refreshed
  tabs[2].OnClick(tabs[2]) -- the Settings tab: its OnShow refreshes every control
  assert(g.refreshed > before, "the Tooltip position refreshes with the tab")
  tabs[1].OnClick(tabs[1])
end
print("ok Settings tab: the Timeline's Tooltip position")

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

-- Review has no Time visible row and no Fit button (Alex, 2026-10-30); Seconds visible stays on Settings,
-- and the view's zoom (the wheel, a drag, a right-click on the axis) needs no slider to follow it
do
  assert(find(sliders, "Time visible") == nil, "Review has no Time visible slider")
  for _, b in ipairs(buttons) do assert(b.text ~= "Fit", "Review has no Fit button") end
  local secs = find(sliders, "Seconds visible")
  assert(secs and secs.opts.min == 60 and secs.opts.max == 600 and secs.opts.step == 30, "Settings keeps Seconds visible")
  assert(secs.opts.format(90) == "1:30" and secs.opts.toDisplay(90) == 1.5 and secs.opts.fromDisplay(2.5) == 150, "Seconds visible is typed in minutes")
  secs.opts.set(120)
  assert(T:Settings().span == 120, "Seconds visible sets the span")
  for _, sl in ipairs(sliders) do
    if sl.text ~= "Seconds visible" then assert(sl.opts.toDisplay == nil, sl.text .. " types what it shows") end
  end
  assert(view.onSpan == nil, "no slider on Review follows a zoom")
  -- the timeline takes the row the slider had: right under the checkboxes
  local holderTop
  for _, fr in ipairs(allFrames) do if rawget(fr, "pt") and fr.pt[1] == "TOPLEFT" and fr.pt[4] == 8 and (fr.pt[5] == -64 or fr.pt[5] == -96) and rawget(fr, "kind") == "Frame" then holderTop = fr.pt[5] end end
  assert(holderTop == -64 or holderTop == -96, "the timeline starts under the checkboxes")
  local help = helps["The Timeline"]
  assert(help:find("time axis", 1, true) and help:find("Ctrl", 1, true) and help:find("right-click the axis", 1, true) and not help:find("Fit", 1, true), "the Timeline's help names drag zoom and the right-click, no Fit")
  assert(not help:find("Advanced", 1, true), "the Timeline's help doesn't point at the Advanced tab")
end
print("ok Review has no Time visible row")

-- Deaths from the last (N) pulls: the pill is Overlay pulls, both ways, and greyed while the box is off
do
  local pill = pills[1]
  local overlayCheck
  for _, c in ipairs(checks) do if c.Label and c.Label.text == "Deaths from the last" then overlayCheck = c end end
  assert(overlayCheck and pill, "the checkbox reads Deaths from the last, with a pill")
  assert(pill.pt and pill.pt[1] == "LEFT" and pill.pt[2] == overlayCheck.Label, "the pill sits right after the checkbox's words")
  local word
  for _, st in ipairs(strings) do if st.text == "pulls" and rawget(st, "pt") and st.pt[2] == pill then word = st end end
  assert(word, "then the word pulls")
  assert(pill.opts.min == 2 and pill.opts.max == 5, "the pill's range is Overlay pulls': 2 to 5")
  local slider = find(sliders, "Overlay pulls")
  assert(slider.opts.min == pill.opts.min and slider.opts.max == pill.opts.max, "one range for both")
  pill.opts.set(5)
  assert(T:Settings().overlay == 5 and slider.opts.get() == 5, "the pill writes Overlay pulls; the slider follows")
  slider.opts.set(2)
  assert(pill.opts.get() == 2, "the slider writes it; the pill follows")
  T:Set("overlay", 3)
  assert(pill.text == "3", "a change redraws the pill (it is one of Review's controls): " .. tostring(pill.text))
  T:Set("overlayOn", false)
  assert(pill.enabled == false, "greyed while Deaths from the last pulls is off")
  overlayCheck:SetChecked(true) overlayCheck.OnClick(overlayCheck)
  assert(T:Settings().overlayOn == true and pill.enabled == true, "ticking the box frees the pill")
  T:Set("overlayOn", false)
  assert(helps["Deaths from recent pulls"]:find("How many pulls it covers: the number, or Overlay pulls on the Settings tab.", 1, true), "the (?) says where the number is set")
end
print("ok the pulls pill")

-- Settings: no Rows block; Hide rows with no casts stays, under View
do
  assert(helps["Rows"] == nil, "the Settings tab has no Rows heading")
  for _, st in ipairs(strings) do assert(type(st.text) ~= "string" or not st.text:find("^Rows for "), "no Rows for line") end
  local hide
  for _, c in ipairs(checks) do if c.Label and c.Label.text == "Hide rows with no casts in this pull" then hide = c end end
  assert(hide and hide.pt[4] == 8 - 4, "Hide rows with no casts is on Settings, in the left column")
  local icon = find(sliders, "Icon size")
  assert(hide.pt[5] < icon.pt[5], "under Icon size, in View")
  hide:SetChecked(true) hide.OnClick(hide)
  assert(T:Settings().hideEmpty == true, "it writes hideEmpty")
  hide:SetChecked(false) hide.OnClick(hide)
  assert(T:Settings().hideEmpty == false, "and back")
  -- the sections moved up: Recording sits under View on the left, Tooltips under Deaths on the right
  local recHelp = helpTargets["Recording"]
  assert(recHelp.pt[4] == 8 and recHelp.pt[5] > -200, "Recording moved up into the left column: " .. tostring(recHelp.pt[5]))
end
print("ok Settings has no Rows block")
print("ok fit button")

-- new lines of the Journal abilities list are skinned (their tick)
rowsList = { { spellID = 1, name = "A", own = true } }
local skinBefore = skinCalls
T:Set("grid", 30)
assert(skinCalls > skinBefore, "new list lines are skinned")
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
  assert(view.pull and view.pull.reference and labelText() == "Abilities " .. DOT .. " Mythic " .. DOT .. " 9:48", "reference-only boss shows its ability timeline, named in the label: " .. tostring(labelText()))
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
assert(labelText() == "Abilities " .. DOT .. " Mythic " .. DOT .. " 9:48" and view.pull.reference and view.eid == 3470 and view.overlay == nil, "with pulls saved, the ability timeline is still what is drawn")
assert(T:ReferenceFor(3470, "mythic").ref == view.pull.reference, "the shown ability timeline is Timeline:ReferenceFor's")
print("ok abilities always drawn, named in the label")

-- the Recent pulls list
local function recent(id) return recentRow(id) end
do
  local function gold(b) local c = rawget(b, "border") return c and c[1] == 1 and c[2] > 0.8 end
  local function filled(b) local c = rawget(b, "fill") local sel = CRT.PALETTE.selected return c and sel and math.abs(c[1] - sel[1]) < 0.01 and math.abs(c[2] - sel[2]) < 0.01 end
  local b2 = recent(2)
  for _, b in ipairs(buttons) do if rawget(b, "title") then
    rawset(b, "SetBackdropBorderColor", function(self, r, g, bl) rawset(self, "border", { r, g, bl }) end)
    rawset(b, "SetBackdropColor", function(self, r, g, bl) rawset(self, "fill", { r, g, bl }) end)
  end end
  assert(b2 and b2.title.text == "Pull 2 " .. DOT .. " 7:32 " .. DOT .. " wipe " .. DOT .. " Mythic" and b2.deaths.text == "2 deaths", "recent pulls: line text")
  assert(b2.deaths.color and b2.deaths.color[1] > 0.9 and b2.deaths.color[2] < 0.5, "recent pulls: deaths in red")
  b2.OnClick(b2)
  assert(view.overlay and view.overlay.id == 2 and view.pull.reference, "clicking a pull lays its deaths over the abilities, which stay drawn")
  assert(gold(b2) and filled(b2), "the picked row is lit: the theme's selected fill and a heading border")
  assert(not filled(recent(1)) and not gold(recent(1)), "the other rows are not lit")
  -- the row's tooltip, placed by UI.TooltipOwner in the timeline's area
  local realOwner, tipArea, tipText = CRT.UI.TooltipOwner, nil, nil
  CRT.UI.TooltipOwner = function(_, _, _, _, _, how) tipArea = how end
  GameTooltip = { SetText = function(_, t) tipText = t end, AddLine = function() end, Show = function() end, Hide = function() end }
  assert(rawget(b2, "OnEnter"), "a recent pull has a tooltip")
  b2.OnEnter(b2)
  assert(tipArea == "timeline" and tipText and tipText:find("^Pull 2 "), "the tooltip goes through UI.TooltipOwner (timeline area): " .. tostring(tipArea))
  CRT.UI.TooltipOwner = realOwner
  b2 = recent(2)
  b2.OnClick(b2)
  assert(view.overlay == nil and view.pull.reference, "clicking the picked pull again clears it")
  assert(not gold(b2) and not filled(b2), "cleared: back to the grey border")
  b2.OnClick(b2)
  local b1 = recent(1) b1.OnClick(b1)
  assert(view.overlay and view.overlay.id == 1 and gold(recent(1)) and not gold(recent(2)), "clicking another pull switches to it")
  b2 = recent(2) b2.OnClick(b2)
  assert(view.overlay and view.overlay.id == 2, "switched back")
  -- kept per boss and difficulty
  bossDD.opts.set(3002)
  assert(view.overlay == nil, "another boss has its own pick (none)")
  bossDD.opts.set(3470)
  assert(view.overlay and view.overlay.id == 2, "the boss's pick is kept while another boss is looked at")
  diffDD.opts.set("nh")
  assert(view.overlay == nil, "the other difficulty has its own pick (none)")
  diffDD.opts.set("mythic")
  assert(view.overlay and view.overlay.id == 2, "the pick is kept per difficulty")
  for k in pairs(CRT.db.timeline) do assert(not tostring(k):lower():find("pick") and not tostring(k):lower():find("overlaypull"), "recent pulls: the pick is not saved: " .. tostring(k)) end
  -- a deleted pull's pick is dropped
  local pulls = CRT.db.timeline.bosses[3470].pulls
  local gone = table.remove(pulls, 2)
  T:Fire()
  assert(view.overlay == nil and view.pull.reference, "a deleted pull's pick is dropped")
  pulls[2] = gone
  T:Fire()
  assert(view.overlay == nil, "and stays dropped when the pull comes back")
end
print("ok recent pulls toggle overlay")

-- Advanced, Journal abilities: a Shown tick on each line hides or shows the row (Journal:SetHidden), an
-- unticked line is dimmed; your own spells are marked yours, with an x and Remove on the menu
local function abilityLineNamed(name)
  for _, c in ipairs(checks) do
    local l = rawget(c, "line")
    if l and l.shown and l.name and l.name.text == name then return l end
  end
end
do
  rowsList = { { spellID = 777, name = "Grasping Depths", icon = "texG" }, { spellID = 555, name = "Mine", own = true } }
  T:Set("grid", 30)
  local l = abilityLineNamed("Grasping Depths")
  assert(l and l.check.shown and l.check.checked and l.check.template == "UICheckButtonTemplate", "each Journal ability has a Shown tick, ticked")
  assert(l.check.pt[1] == "LEFT" and l.icon.pt[2] > l.check.pt[2] and l.name.pt[2] > l.icon.pt[2], "the tick, then the icon, then the name")
  assert(l.id.text == "777", "the spell ID stays")
  l.check:SetChecked(false) l.check.OnClick(l.check)
  assert(journalHidden["3470:777"], "unticking hides the Journal row")
  T:Set("grid", 30)
  l = abilityLineNamed("Grasping Depths")
  assert(not l.check.checked and rawget(l.name, "alpha") and l.name.alpha < 1 and l.icon.alpha < 1, "an unticked row is dimmed")
  l.check:SetChecked(true) l.check.OnClick(l.check)
  assert(not journalHidden["3470:777"], "ticking shows it again")
  T:Set("grid", 30)
  l = abilityLineNamed("Grasping Depths")
  assert(l.check.checked and l.name.alpha == 1 and not l.remove.shown, "back to full, and no x on a Journal row")
  local mine = abilityLineNamed("Mine")
  assert(mine and mine.tag.text == "yours" and mine.remove.shown, "your own spell is marked yours, with Remove")
  assert(mine.remove.text == "Remove" and mine.remove.template == "UIPanelButtonTemplate" and mine.remove.normalFont == CRTFontButtonSmall, "Remove is a small panel button")
  mine.remove.OnClick(mine.remove)
  assert(customRemoved[#customRemoved] == 555, "Remove takes it out")
  rowsList = {}
  T:Set("grid", 30)
end
print("ok Advanced ticks hide and show Journal rows")

-- Add spell ID: adds a row of your own for the list's boss
do
  local realName = C_Spell.GetSpellName
  C_Spell.GetSpellName = function(id) if id == 4321 then return "Custom Cast" end end
  edit:SetText("4321") add.OnClick(add)
  assert(customAdded[#customAdded] == 4321 and edit:GetText() == "", "Add spell ID adds a custom row")
  assert(rawget(edit, "skinned"), "the spell ID box is skinned (UI:SkinEditBox)")
  C_Spell.GetSpellName = realName
  assert(helps["Add"] and helps["Add"]:find("recorded pulls", 1, true), "Add's (?) says recorded pulls only")
end
print("ok add spell ID")

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
  assert(labelText() == "Abilities " .. DOT .. " Mythic " .. DOT .. " 5:00 " .. DOT .. " yours", "references tab saves: yours shown first: " .. tostring(labelText()))
end
print("ok references tab saves")

-- In use: with more than one ability timeline, the Advanced tab picks the one the Review tab shows
do
  local function useBox(key) for _, c in ipairs(checks) do if rawget(c, "key") == key and c.shown and rawget(c, "Label") and c.Label.text == "In use" then return c end end end
  local mine, ship = useBox("own:1"), useBox("ship:1")
  assert(mine and ship and mine.checked and not ship.checked, "In use: shown with two, yours ticked by default")
  assert(mine.pt[1] == "TOPLEFT" and mine.pt[2] + 70 <= 310 and mine.pt[2] >= 154 + 60, "In use sits inside the reference's line, after its kind: " .. tostring(mine.pt[2]))
  assert(mine.template == "UIRadioButtonTemplate" and ship.template == "UIRadioButtonTemplate", "In use is a radio button")
  ship.OnClick(ship)
  assert(labelText() == "Abilities " .. DOT .. " Mythic " .. DOT .. " 9:48" and view.pull.reference.length == 588, "In use: the shipped one is shown: " .. tostring(labelText()))
  assert(useBox("ship:1").checked and not useBox("own:1").checked, "In use: the tick moves")
  assert(T:ReferenceFor(3470, "mythic").key == "ship:1", "In use: the alerts' picker follows (Timeline:ReferenceFor)")
  assert(T:RehearsalSourceFor(3470, "mythic").base.reference.length == 588, "In use: the Rehearsal follows")
  assert(T:ReferenceFor(3470, "nh") == nil, "In use: the other difficulty keeps its own")
  local saved = CRT.db.timeline.reviewRefs[3470].mythic
  assert(type(saved) == "string" and saved:find("^ship|"), "In use: a shipped pick is saved by its header, not its list place: " .. tostring(saved))
  ship = useBox("ship:1") ship.OnClick(ship)
  assert(useBox("ship:1").checked, "In use: ticking the ticked one keeps it")
  mine = useBox("own:1") mine.OnClick(mine)
  assert(view.pull.reference.length == 300 and T:ReferenceFor(3470, "mythic").key == "own:1", "In use: back to yours")
  -- a pick on Mythic with Prefer (a reminder's own Difficulty) still wins inside the group
  assert(T:ReferenceFor(3470, "mythic", nil, "Mythic").key == "own:1", "In use: the pick wins when it fits the asked difficulty")
end
print("ok In use picks the ability timeline shown")

do
  assert(view.pull.reference and view.pull.reference.length == 300, "own reference shown")
  local del
  for _, b in ipairs(buttons) do if b.text == "Delete" and b.shown and rawget(b, "key") == "own:1" then del = b end end
  assert(del, "deleting the shown reference falls back: delete button")
  popup = nil
  del.OnClick(del)
  assert(popup and popup.callback, "deleting the shown reference falls back: confirms")
  popup.callback()
  assert(#CRT.db.timeline.references == 0, "deleting the shown reference falls back: deleted")
  assert(labelText() == "Abilities " .. DOT .. " Mythic " .. DOT .. " 9:48" and view.pull.reference.length == 588, "deleting the shown (and picked) reference falls back to the shipped one: " .. tostring(labelText()))
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
  assert(labelText() == "Abilities " .. DOT .. " Heroic " .. DOT .. " 0:10 " .. DOT .. " yours", "own reference label marked yours: " .. tostring(labelText()))
  R:Delete(key)
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  assert(not labelText():find("yours"), "own reference label marked yours: shipped is not")
end
print("ok own reference label marked yours")

do
  bossDD.opts.set(3470)
  assert(edit.enabled == true and add.enabled == true, "add spell: on for a boss's Journal list, ability timeline or not")
  assert(helps["Journal abilities"]:find("combat", 1, true), "Journal abilities help: not read in combat")
  assert(helps["Abilities Text"]:find("combat", 1, true), "References help: icons need the Journal, not read in combat")
  local key = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nA: 0:10")
  local edit2
  for _, b in ipairs(buttons) do if b.text == "Edit" and b.shown and rawget(b, "key") == key then edit2 = b end end
  edit2.OnClick(edit2)
  assert(edit.enabled == false and add.enabled == false, "add spell: off while your ability timeline is open in the box")
  btn("Clear").OnClick(btn("Clear"))
  assert(edit.enabled == true and add.enabled == true, "add spell: on again")
  R:Delete(key)
end
print("ok add spell disabled on a reference")

do
  local key = R:Add("Boss: Zork the Late\\nDifficulty: Mythic\\nA: 0:10")
  T:Set("grid", 30)
  bossDD.opts.set(4004)
  assert(bossDD.opts.get() == 4004 and view.pull.reference == R:Find(key).ref, "a reference with no Encounter line joins its library boss by name")
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
  assert(textStarting("Added IDs to 1 line."), "fill spell IDs: status")
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

-- with your ability timeline open in the box, its rows are listed: their ticks hide by name for the page's boss
do
  rowsList = { { spellID = 777, name = "Grasping Depths", icon = "texG" } }
  local key = T:SaveReferenceText("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nEncounter: 3470\\nSoulcoil Rite: 0:10\\nGrasping Depths: 0:20")
  assert(key, "an ability timeline of yours, open in the box")
  local l = abilityLineNamed("Soulcoil Rite")
  assert(l and l.refRow and l.check.shown and l.check.checked, "its rows have ticks")
  l.check:SetChecked(false) l.check.OnClick(l.check)
  assert(CRT.db.timeline.rows[3470].hiddenNames["soulcoil rite"] == true, "reference rows hide by name")
  l.check:SetChecked(true) l.check.OnClick(l.check)
  assert(not CRT.db.timeline.rows[3470].hiddenNames["soulcoil rite"], "reference rows show again")
  -- a row whose Journal match is hidden shows unticked; ticking it shows the spell again
  journalHidden["3470:777"] = true
  T:Set("grid", 30)
  l = abilityLineNamed("Grasping Depths")
  assert(l and not l.check.checked, "journal-hidden reference row shows unticked")
  l.check:SetChecked(true) l.check.OnClick(l.check)
  assert(not journalHidden["3470:777"], "ticking it shows the spell again")
  R:Delete(key)
  for _, b in ipairs(buttons) do if b.text == "Clear" then b.OnClick(b) end end
  rowsList = {}
  T:Set("grid", 30)
end
print("ok reference rows tick by name on Advanced")

-- Advanced only with /crt dev open: hidden otherwise, and a selected Advanced goes back to Review
do
  local adv = tabs[3]
  adv.OnClick(adv)
  assert(selectedTabButton == adv and adv.shown, "with /crt dev open, Advanced shows and can be picked")
  setDev(false)
  T:Fire()
  assert(not adv.shown and tabs[1].shown and tabs[2].shown, "without /crt dev, the tab bar has Review and Settings")
  assert(selectedTabButton == tabs[1], "Advanced was selected: back to Review")
  adv.OnClick(adv)
  assert(selectedTabButton == tabs[1], "a hidden tab can't be picked")
  -- Send to Timeline outside dev: saves nothing, says so, opens no hidden tab
  local before, count = #printed, #CRT.db.timeline.references
  local key = T:SaveReferenceText("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nEncounter: 3470\\nOdd: 0:10")
  assert(key == nil and #CRT.db.timeline.references == count and selectedTabButton == tabs[1], "Save outside dev saves nothing and selects no hidden tab")
  assert(#printed == before + 1 and not printed[#printed]:find("/crt dev", 1, true), "and says so, without pointing at /crt dev: " .. tostring(printed[#printed]))
  T:OpenReferenceText("Boss: X")
  assert(#printed == before + 2 and selectedTabButton == tabs[1], "Open outside dev says so too, and opens nothing")
  setDev(true)
  T:Fire()
  assert(adv.shown, "with /crt dev open again, Advanced is back without a reload")
  tabs[1].OnClick(tabs[1])
end
print("ok Advanced only behind /crt dev")

-- a packaged build (no CRT_Dev files) reads none of your own timeline layers that only Advanced manages:
-- rows hidden by name, your ability labels; the saved data stays, and a developer build reads it again
do
  local ref = R:Find("ship:1").ref
  local function laneNamed(name)
    local lanes = CRT.TimelineLanes.AsShown({ reference = ref }, {}, T:Settings(), 3470, nil, "mythic")
    for _, l in ipairs(lanes) do if l.label == name or l.baseLabel == name then return l end end
  end
  local s = T:Settings()
  s.rows[3470] = s.rows[3470] or {}
  s.rows[3470].hiddenNames = { ["soulcoil rite"] = true }
  T:SetAbility(3470, 1286873, "name", "My name")
  assert(laneNamed("Soulcoil Rite") == nil and T:Ability(3470, 1286873).name == "My name", "developer build: your hide and your label are read")
  CRT.Dev = nil
  assert(T.DevBuild() == false and laneNamed("Soulcoil Rite") ~= nil and T:Ability(3470, 1286873) == nil, "packaged build: neither is read")
  local lanes = { { label = "X", spellID = 1286873 } }
  assert(T:ApplyAbilities(lanes, 3470, {}) == lanes and lanes[1].label == "X", "packaged build: no labels laid on")
  assert(s.rows[3470].hiddenNames["soulcoil rite"] == true and s.abilities["3470"][1286873].name == "My name", "packaged build: nothing saved is removed")
  CRT.Dev = {}
  assert(laneNamed("Soulcoil Rite") == nil and T:Ability(3470, 1286873).name == "My name", "developer build again: read as before")
  s.rows[3470].hiddenNames = nil
  T:SetAbility(3470, 1286873, "name", nil)
end
print("ok a packaged build skips your own timeline layers")

-- the ability menu marks a value from the boss file (Bosses:Abilities): its row can't be unticked, its type is
-- "(boss file)" and No type is off, its icons are "(boss file)"; nothing saved changes
do
  local function root()
    local r = { items = {} }
    local function add(kind, text) local el = { kind = kind, text = text, enabled = true } function el:SetEnabled(v) self.enabled = v end
      function el:CreateRadio(t) local c = add("radio", t) table.insert(self.items, c) return c end
      function el:CreateCheckbox(t) local c = add("check", t) table.insert(self.items, c) return c end
      function el:CreateButton(t) local c = add("button", t) table.insert(self.items, c) return c end
      el.items = {} return el end
    function r:CreateTitle() end function r:CreateDivider() end
    function r:CreateCheckbox(t) local c = add("check", t) table.insert(self.items, c) return c end
    function r:CreateButton(t) local c = add("button", t) table.insert(self.items, c) return c end
    return r
  end
  local function find(items, text) for _, el in ipairs(items) do if el.text:find(text, 1, true) then return el end end end
  local savedAbilities = CRT.Bosses.abilities[3470]
  CRT.Bosses.abilities[3470] = { [1286873] = { type = "raid", row = true, tags = { "tank" } } }
  local r = root()
  CRT.TimelineAbilityMenu.Fill(r, 3470, { name = "Soulcoil Rite", spellID = 1286873, tags = { "magic" } })
  local rowBox = find(r.items, "Show as a timeline row")
  assert(rowBox.text == "Show as a timeline row (boss file)" and rowBox.enabled == false, "a shipped row: marked and off")
  local types = find(r.items, "Set type").items
  assert(types[1].text == "No type (edit the boss file to remove its type)" and types[1].enabled == false, "a shipped type: No type is off and says where to remove it")
  assert(find(types, "Raid damage").text:find("(boss file)", 1, true) and not find(types, "Soak").text:find("(boss file)", 1, true), "the shipped type is marked, no other")
  local tagItems = find(r.items, "Tags").items
  assert(find(tagItems, "Tank").text:find("(boss file)", 1, true) and not find(tagItems, "Magic").text:find("(boss file)", 1, true), "the shipped icons are marked")
  assert(find(tagItems, "Use the Journal's icons") == nil, "no Journal's icons button with no icons of yours")
  assert(T:OwnAbility(3470, 1286873) == nil, "nothing saved by opening the menu")
  CRT.Bosses.abilities[3470] = nil
  r = root()
  CRT.TimelineAbilityMenu.Fill(r, 3470, { name = "Soulcoil Rite", spellID = 1286873 })
  assert(find(r.items, "Show as a timeline row").text == "Show as a timeline row" and find(r.items, "Show as a timeline row").enabled, "no boss file label: the row as before")
  assert(find(r.items, "Set type").items[1].text == "No type" and find(r.items, "Set type").items[1].enabled, "no boss file label: No type as before")
  CRT.Bosses.abilities[3470] = savedAbilities
end
print("ok the ability menu marks the boss file's values")

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
  assert(view.onPhaseMoved, "phase move: the page listens to the view")
  local count = #CRT.db.timeline.references
  local before = #printed
  view.onPhaseMoved(1, 187)
  local key = "own:" .. (CRT.db.timeline.nextRef - 1)
  assert(R:Find(key) and #CRT.db.timeline.references == count + 1 and labelText():find("yours$") and view.pull.reference.phases[1].t == 187, "phase move: a shipped reference becomes a reference of your own, and it is shown: " .. tostring(labelText()))
  assert(table.concat(printed, "|", before + 1):find("ability timeline of your own", 1, true), "phase move: says a copy was made")
  local p = view.pull.reference.phases[1]
  assert(p.t == 187 and p.planned == 197, "phase move: the shown reference has the moved line")
  assert(not R:Find("ship:1").text:find("planned", 1, true), "phase move: the shipped text never changes")
  view.onPhaseMoved(1, 190)
  assert(T:ReferenceFor(3470, "mythic").key == key and #CRT.db.timeline.references == count + 1 and R:Find(key).text:find("Phase: P1.5 3:10 (planned 3:17)", 1, true), "phase move: moving it again changes your copy in place")
  view.onPhaseMoved(1, 197)
  assert(not R:Find(key).text:find("planned", 1, true), "phase move: putting it back removes the planned note")
  R:Delete(key)
  -- with the shipped one picked In use over one of yours, the copy is picked in its place
  local other = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nA: 0:10")
  T:SetChosenReference(3470, "mythic", R.ChoiceKey(R:Find("ship:1")))
  assert(view.pull.reference.length == 588, "phase move: the shipped one picked")
  view.onPhaseMoved(1, 187)
  local copy = "own:" .. (CRT.db.timeline.nextRef - 1)
  assert(copy ~= other and T:ReferenceFor(3470, "mythic").key == copy and view.pull.reference.phases[1].t == 187, "phase move: the copy is picked in the shipped one's place, and shown")
  R:Delete(copy) R:Delete(other)
  T:SetChosenReference(3470, "mythic", nil)
end
print("ok a moved phase line is saved into the reference")

-- Difficulty: the dropdown filters the lists, Save stamps, Copy to crosses over -----------------------
local function copyBtn(text, key) for _, b in ipairs(buttons) do if b.shown and b.text == text and rawget(b, "key") == key then return b end end end
local function statusIs(p) for _, s in ipairs(strings) do if type(s.text) == "string" and s.text:find(p, 1, true) == 1 then return s.text end end end

do
  diffDD.opts.set("nh")
  bossDD.opts.set(3470)
  assert(labelText() == "No ability timeline", "difficulty defaults to Normal/Heroic: the shipped Mythic one is not shown: " .. tostring(labelText()))
  assert(view.pull == nil and view.group == "nh", "difficulty defaults to Normal/Heroic: nothing shown")
  local shown
  for _, s in ipairs(strings) do if s.text == "No pulls recorded for this boss yet" and s.shown then shown = true end end
  assert(shown, "difficulty defaults to Normal/Heroic: the empty label shows")
end
print("ok mythic reference is not in the Normal/Heroic pull options")

do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  assert(labelText():find("^Abilities") and view.pull and view.pull.reference and view.group == "mythic", "mythic shows the shipped reference")
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
  -- the Recent pulls rows, top down: { key, label }
  local function pulls()
    local rows = {}
    for _, b in ipairs(buttons) do if rawget(b, "title") and b.shown then rows[#rows + 1] = b end end
    table.sort(rows, function(x, y) return x.pt[5] > y.pt[5] end)
    local out = {}
    for i, b in ipairs(rows) do out[i] = { key = b.pullID, label = b.title.text, row = b } end
    return out
  end
  local nhList = pulls()
  assert(#nhList == 2 and nhList[1].key == h2 and nhList[2].key == h1, "pulls filtered by difficulty: Normal/Heroic lists its own")
  assert(nhList[1].label:find("Heroic$") and nhList[2].label:find("Heroic$"), "pulls filtered by difficulty: labels end with the difficulty name: " .. nhList[1].label)
  assert(nhList[1].label:find("^Pull 2 ") and nhList[2].label:find("^Pull 1 "), "pulls counted per boss and difficulty: " .. nhList[1].label)
  assert(view.pull and view.pull.id == h2, "no ability timeline: the newest pull is drawn")
  assert(helps["Unnamed casts"]():find("Boss Timeline"), "empty-pull hint: shown for a recorded pull with no casts")
  local bossOpt for _, o in ipairs(opts(bossDD.opts)) do if o.key == 5001 then bossOpt = o end end
  assert(bossOpt.label == "Delta (2)", "pulls filtered by difficulty: boss count is the group's: " .. bossOpt.label)
  diffDD.opts.set("mythic")
  local myList = pulls()
  assert(#myList == 2 and myList[1].key == m2 and myList[2].key == m1 and myList[1].label:find("Mythic$") and myList[1].label:find("^Pull 2 "), "pulls filtered by difficulty: Mythic lists its own, counted from 1")
  myList[2].row.OnClick(myList[2].row)
  assert(view.pull and view.pull.id == m1, "difficulty switch repairs the selection: a Mythic pull shown")
  diffDD.opts.set("nh")
  assert(view.pull.id == h2 and view.group == "nh", "difficulty switch repairs the selection: newest Heroic pull")
  diffDD.opts.set("mythic")
  assert(view.pull.id == m1, "the Mythic pick is kept while Normal/Heroic was shown")
  diffDD.opts.set("nh")
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
  local b2 = recent(2) b2.OnClick(b2)
  assert(view.overlay and view.overlay.id == 2, "difficulty switch: laid")
  local sets = view.sets
  diffDD.opts.set("nh")
  assert(view.sets > sets and view.overlay == nil, "difficulty switch: the other difficulty shows no pull of this one")
  diffDD.opts.set("mythic")
  assert(view.overlay and view.overlay.id == 2 and view.group == "mythic", "difficulty switch: back, the pick is still there")
  b2 = recent(2) b2.OnClick(b2)
  assert(view.overlay == nil, "difficulty switch: cleared")
end
print("ok difficulty switch keeps each difficulty's pick")

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
  assert(labelText() == "Abilities " .. DOT .. " Mythic " .. DOT .. " 9:48", "copy to normal/heroic: not shown under Mythic")
  diffDD.opts.set("nh")
  assert(view.pull.reference == R:Find(key).ref and labelText():find("yours$"), "copy to normal/heroic: switching to Normal/Heroic shows it")
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
  assert(view.pull.reference == R:Find(key).ref, "the boss's one ability timeline is shown")
  local list = opts(orderDD.opts)
  assert(#list == 2 and list[1].label == "Gebbo > Nama (as written)" and list[2].key == "Nama > Gebbo", "order options: " .. tostring(list[1] and list[1].label))
  assert(orderDD.opts.get() == "Gebbo > Nama" and view.order and view.order[1] == "Gebbo", "written order chosen at first")
  orderDD.opts.set("Nama > Gebbo")
  assert(CRT.db.timeline.orders[5001].mythic == "Nama > Gebbo", "chosen order saved per boss and difficulty")
  assert(orderDD.opts.get() == "Nama > Gebbo" and view.order[1] == "Nama", "view gets the chosen order")
  assert(CRT.db.timeline.orders[5001].nh == nil, "the other difficulty keeps its own")
  orderDD.opts.set("Gebbo > Nama")
  assert(CRT.db.timeline.orders[5001].mythic == nil, "the written order is kept as no choice")
  -- layout: Order moved into the room the Pull dropdown left, right after the label, nothing reaching
  -- past the page; at the pop-out's smallest it drops to the third row, clear of Share note
  local f = orderDD.parent
  local HELP = 4 + 20
  rawset(f, "GetWidth", function() return CRT.UI.PAGE_W end)
  orderDD.refresh()
  local pt = orderDD.pt
  assert(pt[1] == "TOPLEFT" and pt[4] == 412 + 220 + 16 and pt[5] == -4, "layout: Order right after the label on the main window: " .. tostring(pt[4]))
  assert(pt[4] + 185 + HELP <= CRT.UI.PAGE_W - 8, "layout: Order and its (?) stay inside the page")
  assert(orderDD.shown, "layout: Order shown for an ability timeline with an Order line")
  rawset(f, "GetWidth", function() return 760 end)
  orderDD.refresh()
  pt = orderDD.pt
  assert(pt[4] == 8 and pt[5] == -64, "layout: at the pop-out's smallest Order drops to the third row, at its start: " .. tostring(pt[4]))
  local shareLeft = 760 - (8 + HELP) - 90
  assert(pt[4] + 185 + HELP < shareLeft, "layout: clear of Share note at the pop-out's smallest")
  -- the label itself: where the Pull dropdown was, its text cut short before it reaches Order
  assert(shownLabel().pt[4] == 412 and shownLabel().pt[5] == -9, "layout: the label sits where the Pull dropdown was")
  rawset(f, "GetWidth", nil)
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
  local last = CRT.db.timeline.lastView
  assert(last and last.group == "mythic" and last.boss == 3470 and last.pull == "ship:1", "the shown view is saved (pull: the key of what is drawn)")
  diffDD.opts.set("nh")
  -- a reload: the page is built again from what was saved
  CRT.db.timeline.lastView = { group = "mythic", boss = 3470, pull = "ship:1" }
  local pf2 = mock()
  pages.timeline.build(pf2)
  pf2:Show()
  T:Fire()
  assert(diffDD.opts.get() == "mythic" and bossDD.opts.get() == 3470 and view.pull.reference == R:Find("ship:1").ref and view.group == "mythic", "a reload opens on the saved difficulty and boss, with its ability timeline")
  CRT.db.timeline.lastView = { group = "mythic", boss = 3470, pull = 99999 }
  local pfN = mock()
  pages.timeline.build(pfN)
  pfN:Show()
  T:Fire()
  assert(bossDD.opts.get() == 3470 and view.pull.reference and view.overlay == nil, "an old saved pull choice is ignored: the ability timeline shows")
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
do
  -- the Abilities | Healer CDs toggle: on the pop-out's title strip only, Abilities first, remembered
  local made
  for _, m in ipairs(windowsMade) do if m.name == "CowfeeRaidToolsTimelineWindow" then made = m end end
  local w = made.frame
  local halves = {}
  for _, b in ipairs(tabs) do if rawget(b, "key") then halves[#halves + 1] = b end end
  assert(#halves == 2 and halves[1].key == "abilities" and halves[2].key == "healers", "two halves (UI.Toggle2): Abilities, Healer CDs")
  assert(tabText(halves[1]) == "Abilities" and tabText(halves[2]) == "Healer CDs", "labelled Abilities and Healer CDs")
  -- sized from their labels each time the window opens (6 px a letter here)
  for _, b in ipairs(halves) do
    rawset(b, "SetSize", function(self, bw, bh) rawset(self, "w", bw) rawset(self, "h", bh) end)
    rawset(b.text, "GetStringWidth", function(self) return #(self.text or "") * 6 end)
  end
  CRT.TimelinePopout()
  w:Hide() w.OnHide()
  assert(halves[2].w == 10 * 6 + 20 and halves[1].w == 9 * 6 + 20, "each half as wide as its label and padding: " .. tostring(halves[1].w) .. ", " .. tostring(halves[2].w))
  assert(helps["Healer CDs"] and helpTargets["Healer CDs"] == halves[2], "a (?) right of the toggle explains the view")
  assert(helps["Healer CDs"]:find("Raid Groups", 1, true) and helps["Healer CDs"]:find("raid note", 1, true), "it says where the rows and casts come from")
  -- placed right to left from Reset, leaving room for the (?)
  assert(halves[2].pt[1] == "RIGHT" and halves[2].pt[2] == w.reset and halves[2].pt[4] == -(8 + 4 + 20), "Healer CDs sits a (?) left of Reset")
  assert(halves[1].pt[2] == halves[2] and halves[1].pt[4] == -4, "Abilities just left of it")
  -- the toggle, its (?), Reset and the close button leave the title room at the smallest size
  local used = halves[1].w + 4 + halves[2].w + 8 + 4 + 20 + 4 + 44 + 30
  assert(halves[1].w >= 60 and used <= 760 - 200, "fits at the pop-out's minimum width: " .. used)
  -- docked: Abilities, always
  CRT.db.timeline.popView = nil
  assert(view.mode == nil, "docked: the abilities")
  CRT.TimelinePopout()
  assert(view.mode == nil, "the pop-out opens on Abilities by default")
  halves[2].OnClick(halves[2])
  assert(view.mode == "healers" and CRT.db.timeline.popView == "healers", "Healer CDs: the view's healer layout, remembered")
  w:Hide() w.OnHide()
  assert(view.mode == nil, "docking goes back to the abilities")
  local before = view.refreshes
  CRT.TimelinePopout()
  assert(view.mode == "healers", "the next pop-out opens on Healer CDs again")
  assert(view.later == true and view.refreshes == before + 1, "set before the one redraw the pop-out makes: " .. (view.refreshes - before))
  halves[1].OnClick(halves[1])
  assert(view.mode == nil and CRT.db.timeline.popView == "abilities", "Abilities again")
  halves[2].OnClick(halves[2])
  -- Show on the Timeline lights an ability's row: on Abilities for that opening, the saved choice kept
  T:ShowRow(3470, "Soulcoil Rite")
  assert(view.mode == nil and CRT.db.timeline.popView == "healers", "Show on the Timeline shows Abilities without saving it")
  w:Hide() w.OnHide()
  -- from closed: Abilities decided before the window draws, so Healer CDs never draws first
  local modes = {}
  local realSet = view.SetMode
  view.SetMode = function(self, mode, later) modes[#modes + 1] = tostring(mode) realSet(self, mode, later) end
  T:ShowRow(3470, "Soulcoil Rite")
  view.SetMode = realSet
  assert(view.mode == nil and not table.concat(modes, ","):find("healers", 1, true), "no Healer CDs on the way: " .. table.concat(modes, ","))
  w:Hide() w.OnHide()
  CRT.TimelinePopout()
  assert(view.mode == "healers", "the next plain pop-out is on Healer CDs again")
  halves[1].OnClick(halves[1])
  w:Hide() w.OnHide()
  diffDD.opts.set("nh")
end
print("ok the pop-out's Abilities | Healer CDs toggle")
do
  -- the pop-out's size, kept per view (timeline.popout.abilities and .healers): Abilities a normal window,
  -- 1200 x 600 within 90% of the screen; Healer CDs 1600 x 900, taller for every row up to 90% of the screen's
  -- height; each until the player sizes the window on that view with the grip. Switching views gives the window
  -- that view's size, so going back to Abilities shrinks it. Reset puts both back.
  local made
  for _, m in ipairs(windowsMade) do if m.name == "CowfeeRaidToolsTimelineWindow" then made = m end end
  local o, w = made.opts, made.frame
  assert(type(o.onPlace) == "function" and type(o.onResize) == "function" and type(o.onReset) == "function",
    "pop-out: sized each time it is placed, a grip size kept for its view, Reset clears both")
  local realParent = UIParent
  local screenW, screenH, scale = 1920, 1080, 1
  UIParent = { GetWidth = function() return screenW end, GetHeight = function() return screenH end }
  local function near(a, b) return a ~= nil and math.abs(a - b) < 0.01 end
  local width, height = 0, 0
  rawset(w, "SetSize", function(_, a, b) width, height = a, b end)
  rawset(w, "GetWidth", function() return width end)
  rawset(w, "GetHeight", function() return height end)
  rawset(w, "SetHeight", function(_, h) height = h end)
  rawset(w, "GetScale", function() return scale end)
  -- like UI.Window's Place: onPlace runs at its end
  local realPlace = rawget(w, "Place")
  rawset(w, "Place", function(self) self.placed = self.placed + 1 o.onPlace(self) end)
  view.frame = { GetHeight = function() return height - 158 end }
  local rowsH = 500
  view.ContentHeight = function() return rowsH end
  local halves = {}
  for _, b in ipairs(tabs) do if rawget(b, "key") then halves[#halves + 1] = b end end
  local s = CRT.db.timeline.popout
  for k in pairs(s) do s[k] = nil end
  local function size() return width .. " x " .. height end

  CRT.db.timeline.popView = "abilities"
  CRT.TimelinePopout()
  assert(width == 1200 and height == 600, "Abilities: a normal window, 1200 x 600: " .. size())
  assert(type(s.abilities) == "table" and type(s.healers) == "table" and s.abilities.userSized ~= true and s.healers.userSized ~= true,
    "each view's size is kept on its own")
  halves[2].OnClick(halves[2])
  assert(width == 1600 and height == 900, "Healer CDs: 1600 x 900 when its rows fit: " .. size())
  halves[1].OnClick(halves[1])
  assert(width == 1200 and height == 600, "back to Abilities: shrinks to its size: " .. size())
  rowsH = 1200
  halves[2].OnClick(halves[2])
  assert(width == 1600 and near(height, 1080 * 0.9), "Healer CDs grows to every row, up to 90% of the screen's height: " .. size())
  halves[1].OnClick(halves[1])
  assert(width == 1200 and height == 600, "and shrinks again on Abilities: " .. size())
  rowsH = 800
  halves[2].OnClick(halves[2])
  assert(height == 158 + 800, "just tall enough when that fits: " .. height)
  w:Hide() w.OnHide()
  CRT.TimelinePopout()
  assert(width == 1600 and height == 958, "opened again on Healer CDs: its size: " .. size())
  halves[1].OnClick(halves[1])

  -- the player's size on Abilities: kept for Abilities, Healer CDs still grows
  width, height = 1000, 700
  o.onResize(w)
  assert(s.abilities.userSized == true and s.abilities.width == 1000 and s.abilities.height == 700, "the grip on Abilities: Abilities' own size")
  assert(s.healers.userSized ~= true, "Healer CDs' size untouched")
  halves[2].OnClick(halves[2])
  assert(width == 1600 and height == 958, "Healer CDs still grows: " .. size())
  halves[1].OnClick(halves[1])
  assert(width == 1000 and height == 700, "back to the player's Abilities size: " .. size())
  -- the player's size on Healer CDs: kept there and never grown
  halves[2].OnClick(halves[2])
  width, height = 1300, 650
  o.onResize(w)
  assert(s.healers.userSized == true and s.healers.width == 1300 and s.healers.height == 650, "the grip on Healer CDs: its own size")
  halves[1].OnClick(halves[1])
  assert(width == 1000 and height == 700, "Abilities keeps the player's size: " .. size())
  rowsH = 1200
  halves[2].OnClick(halves[2])
  assert(width == 1300 and height == 650, "Healer CDs keeps the player's size, not grown for its rows: " .. size())
  w:Hide() w.OnHide()
  CRT.TimelinePopout()
  assert(width == 1300 and height == 650, "and opens at it: " .. size())

  -- Show on the Timeline lights an ability's row on Abilities: at the Abilities size
  T:ShowRow(3470, "Soulcoil Rite")
  assert(width == 1000 and height == 700 and CRT.db.timeline.popView == "healers", "Show on the Timeline: the Abilities size: " .. size())
  w:Hide() w.OnHide()

  -- Reset (UI.Window clears the place, then onReset, then Place): both back to their defaults
  CRT.db.timeline.popView = "healers"
  CRT.TimelinePopout()
  s.userSized = false
  o.onReset(s)
  w:Place()
  assert(s.abilities.userSized ~= true and s.healers.userSized ~= true, "Reset: neither view keeps the player's size")
  assert(width == 1600 and near(height, 1080 * 0.9), "Reset on Healer CDs: its default, grown for its rows: " .. size())
  halves[1].OnClick(halves[1])
  assert(width == 1200 and height == 600, "Reset: Abilities' default again: " .. size())

  -- within the screen, in the window's own units, never under its minimum
  screenW, screenH = 1280, 640
  w:Place()
  assert(near(width, 1280 * 0.9) and near(height, 640 * 0.9), "within 90% of a small screen: " .. size())
  scale = 1.25
  w:Place()
  assert(near(width, 1280 * 0.9 / 1.25) and near(height, 640 * 0.9 / 1.25), "in its own units when scaled: " .. size())
  screenW, screenH, scale = 600, 300, 1
  w:Place()
  assert(width == 760 and height == 360, "never under its minimum size: " .. size())
  screenW, screenH = 1920, 1080
  w:Hide() w.OnHide()

  -- saved before each view kept its own size: a size the player chose is Abilities'; the old default was nobody's
  CRT.db.timeline.popView = "abilities"
  for k in pairs(s) do s[k] = nil end
  s.width, s.height = 1000, 700
  CRT.TimelinePopout()
  assert(width == 1000 and height == 700 and s.abilities.userSized == true and s.healers.userSized ~= true, "an older chosen size: Abilities': " .. size())
  halves[2].OnClick(halves[2])
  assert(width == 1600, "Healer CDs at its own default: " .. size())
  halves[1].OnClick(halves[1])
  w:Hide() w.OnHide()
  for k in pairs(s) do s[k] = nil end
  s.width, s.height = 1200, 600
  CRT.TimelinePopout()
  assert(width == 1200 and height == 600 and s.abilities.userSized ~= true, "the old default was nobody's choice")
  w:Hide() w.OnHide()
  for k in pairs(s) do s[k] = nil end
  s.width, s.height, s.userSized = 1600, 900, false
  CRT.TimelinePopout()
  assert(width == 1200 and height == 600, "the size the last version picked was nobody's choice: " .. size())
  w:Hide() w.OnHide()

  assert(T.PopoutView and T:PopoutView() == nil, "PopoutView: none while docked")
  CRT.TimelinePopout()
  assert(T:PopoutView() == view, "PopoutView: the view while popped out (the window log reads it)")
  w:Hide() w.OnHide()
  for k in pairs(s) do s[k] = nil end
  view.frame, view.ContentHeight = nil, nil
  for _, k in ipairs({ "SetSize", "GetWidth", "GetHeight", "SetHeight", "GetScale" }) do rawset(w, k, nil) end
  rawset(w, "Place", realPlace)
  CRT.db.timeline.popView = "abilities"
  UIParent = realParent
  diffDD.opts.set("nh")
end
print("ok the pop-out's size")

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
  assert(b.enabled == true, "enabled with a reference shown")
end
print("ok rehearse button greyed without a source")

do
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  local s = T:RehearsalSource()
  assert(s and s.base and s.base.reference == view.pull.reference, "source: the shown reference")
  assert(s.encounterID == 3470 and s.group == "mythic" and s.difficultyName == "Mythic" and s.bossName == "Nek'zali the Soulcoiler" and s.order == nil and s.pull == "ship:1", "source: boss, group, difficulty, name, order")
  local b2 = recentRow(2) b2.OnClick(b2)
  s = T:RehearsalSource()
  assert(view.overlay and view.overlay.id == 2 and s.base.reference == view.pull.reference and s.pull == "ship:1", "source: a pull laid over it still rehearses the ability timeline")
  b2 = recentRow(2) b2.OnClick(b2)
  -- a boss with no ability timeline rehearses the pull drawn
  local zid = T:SavePull({ encounterID = 4004, name = "Zork the Late", difficultyID = 16, length = 90, kill = false, casts = {}, deaths = {} })
  bossDD.opts.set(4004)
  s = T:RehearsalSource()
  assert(s and s.base == view.pull and s.base.id == zid and s.pull == zid and s.difficultyName == "Mythic", "source: a recorded pull")
  GetDifficultyInfo = function(id) if id == 16 then return "Mythic (game)" end end
  assert(T:RehearsalSource().difficultyName == "Mythic (game)", "source: a pull's own difficulty name")
  GetDifficultyInfo = nil
  T:DeleteBoss(4004)
  bossDD.opts.set(3470)
  local key = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Heroic\\nA: 0:10")
  diffDD.opts.set("nh")
  bossDD.opts.set(3470)
  s = T:RehearsalSource()
  assert(s and s.group == "nh" and s.difficultyName == "Heroic", "source: a Heroic reference plays as Heroic")
  local nkey = R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Normal\\nA: 0:10")
  T:SetChosenReference(3470, "nh", R.ChoiceKey(R:Find(nkey)))
  assert(T:RehearsalSource().difficultyName == "Normal", "source: a reference's own Difficulty line: " .. tostring(T:RehearsalSource().difficultyName))
  local bkey = R:Add("Boss: Nek'zali the Soulcoiler\\nA: 0:10")
  T:SetChosenReference(3470, "nh", R.ChoiceKey(R:Find(bkey)))
  assert(T:RehearsalSource().difficultyName == "Heroic", "source: a reference with no Difficulty line plays as its group")
  R:Delete(nkey) R:Delete(bkey)
  T:Fire()
  assert(T:RehearsalSource().base.reference == R:Find(key).ref, "a picked ability timeline that is deleted falls back to the first")
  T:SetChosenReference(3470, "nh", nil)
  local b = rehearseBtn()
  b.OnClick(b)
  assert(RW:IsOpen() and RW.source.encounterID == 3470 and RW.source.difficultyName == "Heroic", "the button opens the window on the source")
  RW:Close()
  R:Delete(key)
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
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
  local lines = {}
  local oldPrint = print
  CRT.version = "test"
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

-- No Play on the Review tab (Alex, 2026-10-30): Rehearse is first in the row, then Pop out and Share note.
-- The playhead stays: it follows the Rehearsal window's own Play.
do
  -- the Review tab's per-frame update: every OnUpdate but the view's and the Rehearsal window's own
  local function tick() for _, fr in ipairs(allFrames) do local fn = rawget(fr, "OnUpdate") if fn and fr ~= view.frame and fr ~= RW.frame and fr ~= RW.frame.strip then pcall(fn, fr) end end end
  if RW:IsOpen() then RW:Close() end
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  for _, x in ipairs(buttons) do
    assert(not ((x.text == "Play" or x.text == "Pause") and not (RW.frame and x == RW.frame.play)), "Review has no Play button")
  end
  assert(helps["Play"] == nil, "and no Play (?)")
  local reh, pop, share = rehearseBtn(), helpTargets["Pop out"], helpTargets["Share note"]
  -- wide (the main panel): Rehearse, Pop out, Share note, left to right, on the second row
  local f -- the review frame of the page built last (the page is built again above, as on a reload)
  for _, d in ipairs(dropdowns) do if d.text == "Order" then f = d.parent end end
  rawset(f, "GetWidth", function() return CRT.UI.PAGE_W end)
  T:Fire()
  assert(reh.pt[1] == "RIGHT" and reh.pt[2] == pop and reh.pt[3] == "LEFT", "Rehearse is first, right before Pop out")
  assert(pop.pt[1] == "RIGHT" and pop.pt[2] == share, "then Pop out, right before Share note")
  assert(share.pt[1] == "TOPRIGHT" and share.pt[5] == -38, "Share note ends the second row: " .. tostring(share.pt[5]))
  rawset(f, "GetWidth", nil)
  T:Fire()
  assert(pop.pt[1] == "TOPRIGHT" and share.pt[5] == -64, "narrow: Share note on the third row, Pop out ends the second")
  reh.OnClick(reh)
  assert(RW:IsOpen() and RW.source.boss == 3470 and RW.source.pull == "ship:1" and RW.source.group == "mythic", "Rehearse opens the shown fight")
  tick()
  RW:Play()
  tick()
  assert(view.playT and view.playFollow == true, "the playhead follows the window's Play")
  RW:Pause()
  RW:Seek(42)
  tick()
  assert(view.playT == 42 and view.playFollow == false, "paused: the playhead at the Rehearsal's time: " .. tostring(view.playT))
  local b2 = recentRow(2) b2.OnClick(b2)
  tick()
  assert(view.playT == 42, "a pull laid over it keeps the playhead")
  b2 = recentRow(2) b2.OnClick(b2)
  local zid = T:SavePull({ encounterID = 4004, name = "Zork the Late", difficultyID = 16, length = 90, kill = false, casts = {}, deaths = {} })
  bossDD.opts.set(4004)
  tick()
  assert(view.playT == nil, "a rehearsal of another fight shows no playhead")
  RW:Close()
  tick()
  assert(view.playT == nil, "closing the Rehearsal hides the playhead")
  T:DeleteBoss(4004)
  bossDD.opts.set(3470)
end
print("ok Review has no Play; Rehearse is first in the row")
do
  -- Send to Timeline saves the Journal's export at once and opens it; the middle list is that reference
  local text = table.concat({ "Boss: Nek'zali the Soulcoiler", "Difficulty: Mythic", "Encounter: 3470", "# Stage One",
    "Soulcoil Rite [spell 111] (type raid, tags healer):", "Phase: P1.5 (Intermission: Ritual of Awakening)", "Essence Rend:" }, "\\n")
  local key = T:SaveReferenceText(text)
  assert(key and key:find("^own:"), "saved as your reference: " .. tostring(key))
  assert(diffDD.opts.get() == "mythic" and bossDD.opts.get() == 3470 and view.pull.reference == R:Find(key).ref and labelText():find("yours$"), "its boss and difficulty picked, and (yours first) it is shown")
  local function shown(t) for _, x in ipairs(strings) do if x.text == t then return x end end end
  assert(shown("Phase 1 (from the pull)"), "the list starts with phase 1")
  assert(shown("Intermission: Ritual of Awakening") and not shown("P1.5  Intermission: Ritual of Awakening"), "a phase waiting for its start, as a heading by its name, not its number")
  assert(shown("no start yet") and shown("no times"), "says what still needs a time")
  assert(statusIs("Abilities"), "titled as the reference's abilities")
  -- text that doesn't read yet goes to the box instead
  assert(T:SaveReferenceText("Boss: X") == nil, "nothing saved when it doesn't read")
  R:Delete(key)
  diffDD.opts.set("mythic") bossDD.opts.set(3470)
end
print("ok send to timeline saves and lists the reference")

do
  -- what a Test button rehearses: the boss's reference for the group, else its newest pull, leaving
  -- the page's own selection alone
  diffDD.opts.set("mythic")
  bossDD.opts.set(3470)
  local b2 = recentRow(2) b2.OnClick(b2)
  local s = T:RehearsalSourceFor(3470, "mythic")
  assert(s and s.base.reference and s.base.reference.boss == "Nek'zali the Soulcoiler", "the group's reference first")
  assert(s.encounterID == 3470 and s.group == "mythic" and s.bossName == "Nek'zali the Soulcoiler" and s.order == nil, "boss, group, name, order")
  assert(view.overlay and view.overlay.id == 2 and view.pull.reference, "the page's selection is unchanged")
  assert(T:RehearsalSourceFor(3470, "nh") == nil, "no Normal/Heroic reference or pull: nil")
  local pulls = CRT.db.timeline.bosses[3470].pulls
  pulls[#pulls + 1] = { id = 3, difficultyID = 15, length = 200, kill = true, casts = {}, deaths = {} }
  s = T:RehearsalSourceFor(3470, "nh")
  assert(s and s.base.id == 3 and s.group == "nh" and s.pull == 3, "else the newest pull of the group")
  pulls[#pulls] = nil
  assert(T:RehearsalSourceFor(4242, "mythic") == nil, "a boss with nothing: nil")
  b2 = recentRow(2) b2.OnClick(b2)
end
print("ok rehearsal source for a boss and difficulty")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const p of process.argv.slice(2, 17)) {
  let src; try { src = fs.readFileSync(p, 'utf8'); } catch (e) { console.error('cannot read ' + p); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
// CRT_Core/UI/Toggle.lua, found from Page.lua's place (CRT_Modules/Timeline/Page.lua)
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(path.dirname(process.argv[8]), '..', '..', 'CRT_Core', 'UI', 'Toggle.lua'), 'utf8')));
if (lua.lua_pcall(L, 16, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
