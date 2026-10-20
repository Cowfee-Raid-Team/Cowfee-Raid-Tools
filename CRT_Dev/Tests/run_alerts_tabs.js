// CRT_Modules/Notes/Reminders.lua + CRT_Modules/Notes/Phases.lua + CRT_Modules/Notes/Page.lua: the Reminders and Phases tabs, with mock frames.
// Usage: node run_alerts_tabs.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Reminders.lua CRT_Modules/Alerts/PhaseDatabase.lua CRT_Modules/Alerts/Phases.lua CRT_Modules/Alerts/Draft.lua CRT_Modules/Alerts/SpellLookup.lua CRT_Modules/Notes/Reminders.lua CRT_Modules/Notes/Phases.lua CRT_Modules/Notes/Page.lua
// The Mech Alerts list and panel themselves are tested in run_mechalerts.js.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local made = {}
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, enabled = true, checked = false, text = "", pts = {}, w = 0, h = 0 }
  made[#made + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self) return mock("FontString", self) end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true if rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "HasFocus" then return function() return false end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return self.enabled end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetParent" then return function(self) return self.parent end end
    if k == "GetVerticalScroll" or k == "GetValue" then return function(self) return rawget(self, "value") or 0 end end
    if k == "SetValue" then return function(self, v) rawset(self, "value", v) end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
tinsert = table.insert
format = string.format
CANCEL = "Cancel"
CRTFontNormal, CRTFontHighlight, CRTFontDisable, CRTFontEdit, CRTFontDisableSmall, CRTFontSmall = {}, {}, {}, {}, {}, {}
_G.wipe = wipe -- the game has it as a global
function CreateFrame(kind, name, parent, template) return mock(kind, parent, template) end
local clock = 100
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
function issecretvalue() return false end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
C_Spell = {
  GetSpellName = function(id) return ({ [777] = "Real Name", [888] = "Other Spell" })[id] end,
  GetSpellTexture = function(id) return "tex" .. tostring(id) end,
}

local tabs, helps, dropdowns, pages = {}, {}, {}, {}
local function allDropdowns(label) return dropdowns[label] or {} end
local CRT = {
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
}
function CRT:Print() end
CRT.MOCHA = { espresso = { 0.11, 0.078, 0.063 }, edge = { 0.3, 0.235, 0.188 }, mocha = { 0.44, 0.31, 0.22 }, caramel = { 0.78, 0.56, 0.36 } }
CRT.UI = { Tint = function() end, OnTheme = function() end, PAGE_W = 1026, PAGE_H = 560, IsModern = function() return true end,
  RegisterPage = function(_, key, title, fn) pages[key] = fn end,
  RegisterTab = function(_, b) tabs[#tabs + 1] = b end,
  SetTabSelected = function(_, b, on) rawset(b, "selected", on) end,
  Show = function() end, SetFrameTitle = function() end, RegisterLayer = function() end,
  Help = function(parent, title, text) local b = mock("Button", parent) rawset(b, "helpTitle", title) rawset(b, "helpText", text) helps[#helps + 1] = b return b end,
  Dropdown = function(parent, label, opts) local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    rawset(r, "refresh", function() rawset(r, "refreshed", (rawget(r, "refreshed") or 0) + 1) end)
    dropdowns[label] = dropdowns[label] or {} table.insert(dropdowns[label], r) return r end,
  Slider = function() return mock("Row") end,
}
CRT.UI.SoundDropdown = function(parent, label, opts) local o = {} for k, v in pairs(opts) do o[k] = v end
  o.options = opts.options or function() return CRT.Sound:Choices({ none = opts.none, filesOnly = opts.filesOnly }) end
  local r = CRT.UI.Dropdown(parent, label, o)
  if opts.help then rawset(r, "help", CRT.UI.Help(parent, label, "sound help")) end
  return r end
CRT.Notes = {
  CanEditRaid = function() return true end, -- CRT_Modules/Notes/Data.lua: solo, you may change the raid note
  OnChange = function() end, List = function() return {} end, ListStyle = function() return "grouped" end, ListDifficulty = function() return "All" end, ListFolded = function() return false end, SetListFolded = function() end, SetListDifficulty = function() end, SetListStyle = function() end, DifficultyGroup = function() return "Other" end, DIFFICULTIES = { "Mythic", "Heroic", "Normal" }, ShortName = function(n) return n end, ViaLabel = function(v) return v end, SourceLabel = function() return nil end, Get = function() return nil end,
  Personal = function() return "" end,
}
local activeRecord = { encounterID = 9001, name = "Test Boss" }
CRT.Notes.Active = function() return "n1", activeRecord end
local peek
CRT.NoteEngine = { running = false, PeekNextPhase = function() return peek end,
  CurrentPhase = function() return CRT.Alerts:CurrentPhase() end, NextPhase = function() end }
CRT.NoteComm = { Sharing = function() return nil end }
CRT.NoteSettings = { Build = function() end }
local alertsTabBuilt = 0
CRT.NoteAlertsTab = { Build = function() alertsTabBuilt = alertsTabBuilt + 1 end, Select = function() end }
local journalRows = { { spellID = 777, name = "Real Name", icon = "tex777" }, { spellID = 888, name = "Other Spell", icon = "tex888" } }
local raidList = {}
CRT.TimelineJournal = { Rows = function(self, id) return journalRows end, RaidBosses = function() return raidList end }
-- CRT_Data/Bosses/Registry.lua: the boss library's route, the one ordered boss list (raid headings, then bosses)
local routeFns = {}
local route = { { key = "raid:test", label = "Test Raid", title = true }, { key = 9001, label = "Test Boss" }, { key = 5555, label = "Raid Boss" } } -- the phase tests work on Test Boss, first in the route
CRT.Bosses = { Options = function() return route end, OnRouteChange = function(self, fn) routeFns[#routeFns + 1] = fn end,
  FirstKey = function(o) for _, x in ipairs(o) do if not x.title then return x.key end end end }
local opened = {}
CRT.AlertEditor = { Open = function(self, enc, id, prefill) opened[#opened + 1] = { enc = enc, id = id, prefill = prefill } end }

for i, src in ipairs(sources) do
  assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
end
CRT.AlertEditor.Open = function(self, enc, id, prefill) opened[#opened + 1] = { enc = enc, id = id, prefill = prefill } end
local R, P, A, Ref = CRT.AlertReminders, CRT.AlertPhases, CRT.Alerts, CRT.TimelineReference
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Mythic\\nEncounter: 9001\\nLength: 3:00\\nPhase: P2 2:00\\nReal Name: 0:30, 2:20"))
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Heroic\\nEncounter: 9001\\nLength: 2:00\\nReal Name: 0:45"))
local ENC = 9001
local function click(b) b.OnClick(b) end

local function reset()
  CRT.db.alerts.reminders = {}
  CRT.db.alerts.phases = {}
  CRT.db.alerts.nextId = 1
  for i = #opened, 1, -1 do opened[i] = nil end
  for k in pairs(dropdowns) do dropdowns[k] = nil end
end
local function fresh(builder)
  reset()
  local f = mock("Frame")
  builder(f)
  f:Show()
  return f
end
local function pick(label, key)
  local d = dropdowns[label][#dropdowns[label]]
  d.opts.set(key)
  return d
end
local function optionKeys(d)
  local list = type(d.opts.options) == "function" and d.opts.options() or d.opts.options
  local t = {} for i, o in ipairs(list) do t[i] = tostring(o.key) end return table.concat(t, ",")
end

local ok_, fail = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)) fail = fail + 1 end
end

assert(pages.notes, "notes page registered")

check("tabs: four tabs, settings last", function()
  for i = #tabs, 1, -1 do tabs[i] = nil end
  local pf = mock("Frame")
  pages.notes(pf)
  pf:Show()
  -- the page's tabs; the Notes list's Shared and Personal tabs (20 high) are checked apart
  local kinds = {}
  for i = #tabs, 1, -1 do if tabs[i].h == 20 then table.insert(kinds, 1, tabs[i].text.text) table.remove(tabs, i) elseif tabs[i].h == 18 then table.remove(tabs, i) end end -- 18: the difficulty chips
  assert(table.concat(kinds, ",") == "Shared,Personal", "the list's tabs: " .. table.concat(kinds, ","))
  local names = {}
  for i, b in ipairs(tabs) do names[i] = b.text.text end
  assert(table.concat(names, ",") == "Notes,Mech Alerts,Alert Settings,Notes Settings", table.concat(names, ","))
  for i, b in ipairs(tabs) do
    assert(b.w == 164 and b.h == 26, "tab size")
    assert(b.pts[1][2] == 8 + (i - 1) * 168, "tab x " .. tostring(b.pts[1][2]))
  end
  assert(#tabs == 4 and tabs[4].pts[1][2] + tabs[4].w <= 686, "fits the page")
end)

check("tabs: open reminders tab by name", function()
  reset()
  CRT.NotesPage.Open("reminders")
  assert(dropdowns["Boss"], "reminders tab built a Boss dropdown")
  assert(tabs[2].selected == true and tabs[1].selected == false, "reminders tab selected")
  CRT.NotesPage.Open("alerts")
  assert(tabs[3].selected == true and alertsTabBuilt == 1, "alerts tab selected and built")
  CRT.NotesPage.Open("settings")
  assert(tabs[4].selected == true and tabs[3].selected == false, "settings tab selected")
  CRT.NotesPage.Open("alerts")
  assert(alertsTabBuilt == 1, "built once")
end)

check("reminders tab: boss dropdown starts on the active note's boss", function()
  local f = fresh(CRT.NoteReminders.Build)
  assert(optionKeys(dropdowns["Boss"][1]):find("9001"), optionKeys(dropdowns["Boss"][1]))
  assert(dropdowns["Boss"][1].opts.get() == 9001)
end)

check("reminders tab: help beside the title", function()
  fresh(CRT.NoteReminders.Build)
  assert(#helps >= 1)
end)

check("phases tab: phase 1 has no dropdown", function()
  local f = fresh(CRT.NotePhases.Build)
  local row = f.rows[1]
  assert(row.name.text:find("Phase 1") and row.kind == nil and row.kindFrame == nil, "phase 1 row")
  assert(row.frame.shown)
end)

check("phases tab: setting a kind saves yours", function()
  local f = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p2", times = "P1 0:05; P2 +0:10", boss = "Test Boss" })
  CRT.NotePhases.Refresh()
  local row = f.rows[2]
  assert(row.name.text:find("Phase 2"), tostring(row.name.text))
  assert(row.kind and row.kind.opts, "kind dropdown")
  assert(optionKeys(row.kind) == "manual,emote,untargetable,targetable,newboss", optionKeys(row.kind))
  row.kind.opts.set("untargetable")
  local mine = CRT.db.alerts.phases[ENC][2]
  assert(mine.kind == "untargetable" and mine.value == "boss1", "saved " .. tostring(mine.kind) .. tostring(mine.value))
  assert(row.marker.text == "Yours" and row.useShipped.shown, "yours marker")
  assert(optionKeys(row.value) == "boss1,boss2,boss3,boss4,boss5", optionKeys(row.value))
  row.value.opts.set("boss3")
  assert(CRT.db.alerts.phases[ENC][2].value == "boss3")
  row.kind.opts.set("newboss")
  assert(CRT.db.alerts.phases[ENC][2].kind == "newboss" and CRT.db.alerts.phases[ENC][2].value ~= "boss1")
  assert(optionKeys(row.value) == "boss2,boss3,boss4,boss5", optionKeys(row.value))
  row.kind.opts.set("manual")
  assert(CRT.db.alerts.phases[ENC][2].kind == "manual")
  click(row.useShipped)
  assert(CRT.db.alerts.phases[ENC] == nil, "use shipped removes yours")
  assert(not row.useShipped.shown and row.marker.text ~= "Yours")
end)

check("phases tab: emote needs words, rejected kind leaves row as it was", function()
  local f = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p2", times = "P1 0:05; P2 +0:10", boss = "Test Boss" })
  CRT.NotePhases.Refresh()
  local row = f.rows[2]
  row.kind.opts.set("emote")
  assert(CRT.db.alerts.phases[ENC] == nil, "nothing saved without words")
  row.edit.text = "Now we fight" row.edit.OnEnterPressed(row.edit)
  assert(CRT.db.alerts.phases[ENC][2].kind == "emote" and CRT.db.alerts.phases[ENC][2].value == "Now we fight")
  row.edit.text = "   " row.edit.OnEnterPressed(row.edit)
  assert(CRT.db.alerts.phases[ENC][2].value == "Now we fight", "blank rejected, kept")
end)

check("phases tab: shipped marker and Use shipped only for yours", function()
  local f = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p1", times = "P1 0:05", boss = "Test Boss" })
  CRT.AlertPhaseDB[ENC] = { [2] = { kind = "emote", value = "shipped words" } }
  CRT.NotePhases.Refresh()
  local row = f.rows[2]
  assert(row.name.text:find("Phase 2") and row.marker.text == "Shipped" and not row.useShipped.shown, "shipped")
  assert(row.edit.text == "shipped words")
  row.kind.opts.set("untargetable")
  assert(row.marker.text == "Yours" and row.useShipped.shown)
  click(row.useShipped)
  assert(row.marker.text == "Shipped")
  CRT.AlertPhaseDB[ENC] = nil
end)

check("phases tab: boss dropdown and help", function()
  fresh(CRT.NotePhases.Build)
  assert(dropdowns["Boss"] and #helps >= 1)
end)

check("phases tab: focus without edit keeps shipped", function()
  local f = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p1", times = "P1 0:05", boss = "Test Boss" })
  CRT.AlertPhaseDB[ENC] = { [2] = { kind = "emote", value = "shipped words" } }
  CRT.NotePhases.Refresh()
  local row = f.rows[2]
  row.edit.OnEditFocusLost(row.edit)
  row.edit.OnEnterPressed(row.edit)
  row.edit.OnEditFocusLost(row.edit)
  assert(CRT.db.alerts.phases[ENC] == nil and row.marker.text == "Shipped", "still shipped")
  row.edit.text = "changed" row.edit.OnEnterPressed(row.edit)
  assert(CRT.db.alerts.phases[ENC][2].value == "changed" and row.marker.text == "Yours")
  CRT.AlertPhaseDB[ENC] = nil
end)

check("phases tab: lowest phase is the pull", function()
  local f = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p2", times = "P2 +0:10", boss = "Test Boss" })
  CRT.NotePhases.Refresh()
  local row = f.rows[1]
  assert(row.name.text:find("Phase 2") and row.name.text:find("pull") and row.kind == nil, row.name.text)
  assert(not f.rows[2].frame.shown, "no second row")
end)

check("tabs: every phases row control fits inside the 686 wide page", function()
  local function fits(frame, limit, what)
    for _, p in ipairs(frame.pts) do
      local x = p[1] == "RIGHT" and p[2] or p[2]
      if p[1] == "TOPLEFT" or p[1] == "LEFT" then
        assert(x + frame.w <= limit, what .. " right edge " .. (x + frame.w) .. " > " .. limit)
      elseif p[1] == "RIGHT" then
        assert(x <= 0, what .. " right anchor outside")
      end
    end
  end
  local function checkRows(f, what)
    for i, row in ipairs(f.rows) do
      fits(row.frame, 686, what .. " row " .. i)
      for k, c in pairs(row) do
        if type(c) == "table" and c ~= row.frame and c.pts then
          local w = c.w
          local o = rawget(c, "opts") if o then w = (o.labelWidth or 0) + 10 + (o.width or 0) end
          local probe = { pts = c.pts, w = w }
          fits(probe, row.frame.w, what .. " row " .. i .. " " .. k)
        end
      end
    end
  end
  -- the Mech Alerts tab's own layout test is in run_mechalerts.js (nothing passes the page edges)
  local g = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p", times = "P1 0:05; P2 +0:10", boss = "Test Boss" })
  CRT.NotePhases.Refresh()
  checkRows(g, "phases")
end)

check("phases tab: kind change after pending emote redraws", function()
  local f = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p", times = "P1 0:05; P2 +0:10", boss = "Test Boss" })
  CRT.NotePhases.Refresh()
  local row = f.rows[2]
  row.kind.opts.set("emote")
  assert(row.edit.shown, "emote box shows while pending")
  row.kind.opts.set("untargetable")
  assert(row.kind.opts.get() == "untargetable" and not row.edit.shown and row.value.shown, "redrawn as untargetable")
  assert(CRT.db.alerts.phases[ENC][2].kind == "untargetable")
end)

check("phases tab: triggered phase is not the pull", function()
  local f = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p2", times = "P2 +0:10", boss = "Test Boss" })
  CRT.AlertPhaseDB[ENC] = { [2] = { kind = "emote", value = "go" } }
  CRT.NotePhases.Refresh()
  assert(f.rows[1].name.text:find("Phase 1") and f.rows[1].name.text:find("pull") and f.rows[1].kind == nil, f.rows[1].name.text)
  assert(f.rows[2].name.text == "Phase 2" and f.rows[2].kind, "phase 2 has its dropdown")
  CRT.AlertPhaseDB[ENC] = nil
end)

local function findText(pattern)
  for _, m in ipairs(made) do
    if type(rawget(m, "text")) == "string" and m.text:find(pattern) then return m end
  end
end

check("notes page: Next phase names the phase it starts", function()
  CRT.NotesPage.Open("notes")
  local b = findText("^Next phase")
  assert(b and b.text == "Next phase", "idle label: " .. tostring(b and b.text))
  assert(b.w >= 130, "wide enough for the phase: " .. tostring(b.w))
  peek = 1.5
  CRT.NotesPage.Open("notes")
  assert(b.text == "Next phase (1.5)", b.text)
  peek = nil
  CRT.NotesPage.Open("notes")
  assert(b.text == "Next phase", b.text)
end)

check("notes page: a reminders-only run shows as running", function()
  A:Start(ENC, nil, "test")
  CRT.NotesPage.Open("notes")
  local st = findText("Running reminders, no note")
  assert(st and st.text:find("phase %d") and st.text:find("(test)", 1, true), "status: " .. tostring(st and st.text))
  A:Stop()
  CRT.NotesPage.Open("notes")
  assert(not findText("Running reminders"), "status cleared after stop")
end)

check("reminders tab: lists the current raid's Journal bosses", function()
  raidList[1] = { encounterID = 5555, name = "Raid Boss" }
  local f = fresh(CRT.NoteReminders.Build)
  local keys = optionKeys(dropdowns["Boss"][1])
  assert(keys:find("5555", 1, true), keys)
  local g = fresh(CRT.NotePhases.Build)
  assert(optionKeys(dropdowns["Boss"][1]):find("5555", 1, true), "phases tab too")
  raidList[1] = nil
end)

check("phases tab: a difficulty-specific reminder's phase is listed", function()
  local f = fresh(CRT.NotePhases.Build)
  R:Save(ENC, nil, { text = "p3", times = "P1 0:05; P3 +0:10", boss = "Test Boss", difficulty = "Mythic" })
  CRT.NotePhases.Refresh()
  local found = false
  for _, row in ipairs(f.rows) do
    if row.frame.shown and type(row.name.text) == "string" and row.name.text:find("Phase 3", 1, true) then found = true end
  end
  assert(found, "phase 3 row from a Mythic-only reminder")
end)

check("no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)
if fail > 0 then error(fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const srcs = process.argv.slice(2);
for (const s of srcs) lua.lua_pushstring(L, to_luastring(fs.readFileSync(s, 'utf8')));
if (lua.lua_pcall(L, srcs.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
