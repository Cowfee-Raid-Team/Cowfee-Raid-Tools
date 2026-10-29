// CRT_Modules/Notes/Reminders.lua: the Mech Alerts tab (a list of the boss's abilities and your own reminders, and one
// settings panel for the selected row), with the real CRT_Modules/Alerts/Draft.lua, CRT_Modules/Alerts/SpellLookup.lua and
// CRT_Modules/Alerts/Editor.lua on mock frames.
// Usage: node run_mechalerts.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua
//   CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Speech.lua CRT_Modules/Alerts/Reminders.lua CRT_Modules/Alerts/Draft.lua
//   CRT_Modules/Alerts/SpellLookup.lua CRT_Modules/Alerts/Editor.lua CRT_Modules/Alerts/Colors.lua CRT_Modules/Notes/Reminders.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local sources = { ... }
local made = {}
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, enabled = true, checked = false, text = "", pts = {}, w = 0, h = 0 }
  made[#made + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if type(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" then return function(self, _, _, font) local f = mock("FontString", self) rawset(f, "font", font) return f end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "HookScript" then return function(self, n, fn) rawset(self, "hook" .. n, fn) end end
    -- the game runs OnShow when a hidden frame shows
    if k == "Show" then return function(self) local was = self.shown self.shown = true if not was and rawget(self, "OnShow") then self.OnShow(self) end end end
    -- the game runs OnHide when a shown frame hides
    if k == "Hide" then return function(self) local was = self.shown self.shown = false if was and rawget(self, "OnHide") then self.OnHide(self) end end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "IsVisible" then return function(self) local f = self while f do if not f.shown then return false end f = f.parent end return true end end
    if k == "HasFocus" then return function(self) return rawget(self, "focused") == true end end
    -- the game fires OnEditFocusLost when a box with the focus loses it
    if k == "ClearFocus" then return function(self)
      local had = rawget(self, "focused") rawset(self, "focused", false)
      if had and rawget(self, "OnEditFocusLost") then self.OnEditFocusLost(self) end end end
    if k == "SetFocus" then return function(self) rawset(self, "focused", true) end end
    -- the game fires OnTextChanged(self, false) when code sets an edit box's text
    if k == "SetText" then return function(self, s)
      rawset(self, "text", s)
      if self.kind == "EditBox" and rawget(self, "OnTextChanged") then self.OnTextChanged(self, false) end end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return self.enabled end end
    if k == "SetTexture" then return function(self, s) rawset(self, "texture", s) end end
    if k == "SetColorTexture" or k == "SetVertexColor" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "textColor", { r, g, b }) end end
    if k == "SetWordWrap" then return function(self, on) rawset(self, "wordWrap", on) end end
    if k == "SetNormalFontObject" then return function(self, f) rawset(self, "normalFont", f) end end
    -- a font string's words, 6 a letter
    if k == "GetUnboundedStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 * (TEXT_SCALE or 1) end end
    if k == "SetMultiLine" then return function(self, on) rawset(self, "multiLine", on) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return self.w end end
    if k == "GetHeight" then return function(self) return self.h end end
    if k == "SetAllPoints" then return function(self) rawset(self, "allPoints", true) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetParent" then return function(self) return self.parent end end
    if k == "GetFrameLevel" then return function() return 1 end end
    if k == "GetFrameStrata" then return function(self) return rawget(self, "strata") or "MEDIUM" end end
    if k == "SetFrameStrata" then return function(self, v) rawset(self, "strata", v) end end
    if k == "GetValue" then return function(self) return rawget(self, "value") or 0 end end
    if k == "SetValue" then return function(self, v) rawset(self, "value", v) end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
tinsert = table.insert
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
CANCEL, ACCEPT = "Cancel", "Accept"
SOUNDKIT = { RAID_WARNING = 8959, READY_CHECK = 8960 }
CRTFontNormal, CRTFontHighlight, CRTFontDisable, CRTFontEdit, CRTFontDisableSmall, CRTFontSmall = {}, {}, {}, {}, {}, {}
CRTFontButtonSmall, CRTFontButtonSmallHighlight, CRTFontButtonSmallDisable = {}, {}, {}
-- a button label's width: 6 a letter, 5 in the game's small button font
local function labelWidth(b) return #(rawget(b, "text") or "") * (rawget(b, "normalFont") == CRTFontButtonSmall and 5 or 6) * (TEXT_SCALE or 1) end
function CreateFrame(kind, name, parent, template) return mock(kind, parent, template) end
local clock = 100
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
function issecretvalue() return false end
function InCombatLockdown() return false end
-- the game's timers: run here only when a test lets the time pass (runTimers)
local timers = {}
C_Timer = { After = function(delay, fn) timers[#timers + 1] = { delay = delay, fn = fn } end }
local function runTimers()
  local due = timers
  timers = {}
  for _, t in ipairs(due) do t.fn() end
end
local NAMES = { [777] = "Real Name", [888] = "Other Spell", [999] = "Third Thing" }
C_Spell = {
  GetSpellName = function(id) return NAMES[id] end,
  GetSpellTexture = function(id) return "tex" .. tostring(id) end,
}
local picker = {}
ColorPickerFrame = { SetupColorPickerAndShow = function(self, info) picker.info = info end,
  GetColorRGB = function() return picker.r or 1, picker.g or 1, picker.b or 1 end }

local helps, dropdowns, sliders = {}, {}, {}
TAB_CALLS = { set = 0, style = 0 }
local printed = {}
local CRT = {
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1,
      customColors = true }, -- the checks were written for your own colours: Use custom colours on
  },
}
function CRT:Print(m) printed[#printed + 1] = m end
CRT.PALETTE = { background = { 0.11, 0.078, 0.063 }, surface = { 0.165, 0.122, 0.098 }, border = { 0.3, 0.235, 0.188 },
  selected = { 0.44, 0.31, 0.22 }, accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, text = { 0.95, 0.9, 0.84 } }
CRT.UI = { Tint = function(r, m, k, a) local c = CRT.PALETTE[k] r[m](r, c[1], c[2], c[3], a or 1) end, OnTheme = function() end, PAGE_W = 1026, PAGE_H = 560,
  -- the look on show: Modern unless a check sets MODERN = false (Classic)
  IsModern = function() return MODERN ~= false end,
  -- tabs: which is selected, and how often each way was asked (SetTabSelected also skins the whole tab)
  RegisterTab = function() end,
  SetTabSelected = function(self, b, on) TAB_CALLS.set = TAB_CALLS.set + 1 rawset(b, "tabSelected", on) end,
  StyleTab = function(self, b, on) TAB_CALLS.style = TAB_CALLS.style + 1 rawset(b, "tabSelected", on) end,
  RegisterPage = function() end,
  Show = function() end, SetFrameTitle = function() end, RegisterLayer = function() end, RegisterPreview = function() end,
  SkinTree = function() end, StyleWindow = function() end,
  Help = function(parent, title, text) local b = mock("Button", parent) rawset(b, "helpTitle", title) rawset(b, "helpText", text) helps[#helps + 1] = b return b end,
  Dropdown = function(parent, label, opts) local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    rawset(r, "refresh", function() rawset(r, "value", opts.get()) end)
    dropdowns[label] = r return r end,
  Slider = function(parent, label, opts) local r = mock("Slider", parent) rawset(r, "label", label) rawset(r, "opts", opts)
    rawset(r, "refresh", function() rawset(r, "value", opts.get()) end)
    sliders[label] = r return r end,
}
-- CRT_Core/UI/Panel.lua's PanelButton: as wide as its label plus 14 each side, at least 40
CRT.UI.PanelButtonWidth = function(w) return math.max(40, math.ceil(w or 0) + 28) end
CRT.UI.PanelButton = function(parent, label, height, onClick)
  local b = mock("Button", parent, "UIPanelButtonTemplate")
  rawset(b, "text", label) rawset(b, "OnClick", onClick)
  rawset(b, "GetFontString", function(self) return { GetStringWidth = function() return labelWidth(self) end } end)
  b:SetSize(CRT.UI.PanelButtonWidth(labelWidth(b)), height)
  return b
end
-- CRT_Modules/Notes/AlertShareWindows.lua: the Export and Import windows, recorded
local shareCalls = {}
CRT.NoteAlertShare = { OpenExport = function(enc) shareCalls[#shareCalls + 1] = { "export", enc } end,
  OpenImport = function() shareCalls[#shareCalls + 1] = { "import" } end }
CRT.UI.SoundDropdown = function(parent, label, opts) local o = {} for k, v in pairs(opts) do o[k] = v end
  o.options = opts.options or function() return CRT.Sound:Choices({ none = opts.none, filesOnly = opts.filesOnly }) end
  local r = CRT.UI.Dropdown(parent, label, o)
  if opts.help then rawset(r, "help", CRT.UI.Help(parent, label, "sound help")) end
  return r end
CRT.Notes = {
  CanEditRaid = function() return true end, -- CRT_Modules/Notes/Data.lua: solo, you may change the raid note
  -- CRT_Modules/Notes/Data.lua: listeners told on every note change, the active note's included
  listeners = {}, OnChange = function(self, fn) table.insert(self.listeners, fn) end,
  Fire = function(self) for _, fn in ipairs(self.listeners) do fn() end end,
  List = function() return {} end, Get = function() return nil end,
}
-- CRT_Modules/Notes/Data.lua's store as Notes/MechNote.lua uses it (Save as Raid note): notes by id, the one a pull reads,
-- one made, and a text changed. Each change tells the listeners.
local noteStore, noteNext = {}, 1
local function resetNotes() noteStore, noteNext = {}, 1 end
CRT.Notes.Get = function(self, id) return id and noteStore[id] or nil end
CRT.Notes.FindForEncounter = function(self, enc, diff)
  local any
  for id, r in pairs(noteStore) do
    if r.encounterID == enc then
      if diff and r.difficulty and r.difficulty:lower() == diff:lower() then return id end
      any = any or id
    end
  end
  return any
end
CRT.Notes.Import = function(self, text, from, personal, source, via, anyText, asNew)
  local id = noteNext noteNext = noteNext + 1
  local enc, d, name = text:match("^EncounterID:(%d+);Difficulty:([^;\\n]+);Name:([^\\n]+)")
  noteStore[id] = { raw = text, encounterID = tonumber(enc), difficulty = d, name = name, via = via, asNew = asNew }
  self:Fire()
  return id
end
CRT.Notes.UpdateRaw = function(self, id, text) noteStore[id].raw = text self:Fire() return true end
-- Notes/Data.lua's Busy: combat, or a boss encounter (the game's call)
CRT.Notes.Busy = function()
  if InCombatLockdown() then return true end
  local fn = (C_InstanceEncounter and C_InstanceEncounter.IsEncounterInProgress) or IsEncounterInProgress
  return fn ~= nil and fn() == true
end
CRT.Notes.FindExact = function(self, enc, diff)
  for id, r in pairs(noteStore) do
    if r.encounterID == enc and r.difficulty and diff and r.difficulty:lower() == diff:lower() then return id end
  end
end
CRT.Notes.NoteFor = function(self, enc, diff, boss, opts)
  local id = opts and opts.exact and self:FindExact(enc, diff) or (not (opts and opts.exact) and self:FindForEncounter(enc, diff))
  if id then return id, false end
  return self:Import("EncounterID:" .. enc .. ";Difficulty:" .. diff .. ";Name:" .. boss .. "\\n", nil, nil, nil, opts and opts.via, nil, opts and opts.exact), true
end
local activeRecord = { encounterID = 9001, name = "Test Boss" }
CRT.Notes.Active = function() return "n1", activeRecord end
CRT.NotesPage = { TAB_H = CRT.UI.PAGE_H - 66 } -- CRT_Modules/Notes/Page.lua: a tab's height under the tabs
local journalRows = { { spellID = 777, name = "Real Name", icon = "tex777" }, { spellID = 888, name = "Other Spell", icon = "tex888" } }
local raidList = { { encounterID = 5555, name = "Raid Boss" } }
CRT.TimelineJournal = { Rows = function(self, id) if id == 9001 then return journalRows end return {} end, RaidBosses = function() return raidList end,
  IsHidden = function() return false end } -- CRT_Modules/Timeline/Journal.lua: rows you took off the Timeline's Advanced list
-- CRT_Data/Bosses/Registry.lua: the boss library's route, the one ordered boss list (raid headings, then bosses)
local routeFns = {}
local route = { { key = "raid:test", label = "Test Raid", title = true }, { key = 5555, label = "Raid Boss" }, { key = 9001, label = "Test Boss" } }
CRT.Bosses = { Options = function() return route end, OnRouteChange = function(self, fn) routeFns[#routeFns + 1] = fn end,
  FirstKey = function(o) for _, x in ipairs(o) do if not x.title then return x.key end end end }

CRT_THEME(CRT, CRT.UI)
local function loadSource(i, src)
  if src:find("function UI.PickColor", 1, true) then -- the real CRT_Core/UI/Controls.lua: only PickColor is taken, the harness keeps its own Dropdown and Slider
    local tmp = { UI = {} }
    assert(load(src, "CRT_Core/UI/Controls.lua"))("CowfeeRaidTools", tmp)
    CRT.UI.PickColor = tmp.UI.PickColor
  elseif src:find("function UI:SkinScrollBar", 1, true) then -- the real CRT_Core/UI/ScrollBar.lua: only the gutter rule is taken
    local tmp = { UI = {} }
    assert(load(src, "CRT_Core/UI/ScrollBar.lua"))("CowfeeRaidTools", tmp)
    CRT.UI.SCROLL_GAP, CRT.UI.SCROLL_BAR_W, CRT.UI.ScrollGutter = tmp.UI.SCROLL_GAP, tmp.UI.SCROLL_BAR_W, tmp.UI.ScrollGutter
  else
    assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
  end
end
for i, src in ipairs(sources) do
  loadSource(i, src)
end
local R, A, Ref, E = CRT.AlertReminders, CRT.Alerts, CRT.TimelineReference, CRT.AlertEditor
assert(CRT.AlertDraft and CRT.AlertSpellLookup, "the draft core and the spell lookup")
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Mythic\\nEncounter: 9001\\nLength: 3:00\\nPhase: P2 2:00\\nReal Name: 0:30, 2:20\\nOther Spell: 1:00"))
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Heroic\\nEncounter: 9001\\nLength: 2:00\\nReal Name: 0:45"))
local ENC = 9001
local showCalls, showResult = {}, true
CRT.Timeline.ShowRow = function(self, enc, spell, name) showCalls[#showCalls + 1] = { enc = enc, spell = spell, name = name } return showResult end

local TAB_W, TAB_H = CRT.UI.PAGE_W, CRT.UI.PAGE_H - 66 -- CRT_Modules/Notes/Page.lua: a tab sits under the tabs
local function click(b) assert(b and b.OnClick, "clickable") b.OnClick(b, "LeftButton") end
local function setCheck(c, on) c.checked = on click(c) end
-- typing: the box has the focus (a click in it), then the text changes
local function typeInto(edit, s) rawset(edit, "focused", true) edit.text = s edit.OnTextChanged(edit, true) end
local function reset()
  CRT.db.alerts.reminders = {}
  CRT.db.alerts.nextId = 1
  for i = #showCalls, 1, -1 do showCalls[i] = nil end
  for i = #printed, 1, -1 do printed[i] = nil end
  A:Stop(true)
end
-- the tab as it opens: on Special (Notes/SpecialAlerts.lua)
local function freshOpen()
  reset()
  local f = mock("Frame")
  f.shown = false
  rawset(f, "w", TAB_W) rawset(f, "h", TAB_H)
  CRT.NoteReminders.Build(f)
  f:Show()
  return f
end
-- the tab with Mechanics clicked, for the checks of the Mechanics list and panel
local function fresh()
  local f = freshOpen()
  if f.special and CRT.NoteSpecialAlerts.View() == "special" then
    click(f.special.mechBtn)
  end
  return f
end
local function only()
  local list = R:List(ENC)
  assert(#list == 1, "one reminder, got " .. #list)
  return list[1].r, list[1].id
end

local ok_, fail = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)) fail = fail + 1 end
end

check("mech: list rows with tick, icon, name, dot", function()
  local f = fresh()
  local r1, r2 = f.rows[1], f.rows[2]
  assert(r1.frame.shown and r1.name.text == "Real Name", "first ability row: " .. tostring(r1.name.text))
  assert(r1.check.kind == "CheckButton" and r1.check.checked == false, "a tick, off with no reminder")
  assert(r1.icon.texture == "tex777" and r1.icon.shown, "the icon")
  assert(r1.dot.shown, "the reference has times for Real Name")
  assert(r2.name.text == "Other Spell" and r2.dot.shown, "the second row on the ability timeline")
  assert(not f.rows[3].frame.shown, "no third row")
  -- the name is cut with ... inside the list
  assert(r1.name.wordWrap == false and r1.name.w > 0, "single line, fixed width")
  assert(r1.name.w + 60 <= f.list.w, "the name stays inside the list: " .. r1.name.w .. " of " .. f.list.w)
  assert(f.list.w >= 230 and f.list.w <= 270, "about 250 wide: " .. f.list.w)
  for _, row in ipairs(f.rows) do assert(not row.edit, "no Edit buttons") end
  local dot = r1.dot.color
  assert(dot and math.abs(dot[1] - CRT.PALETTE.accent[1]) < 1e-6, "an accent dot")
  -- a long list scrolls with the wheel
  for i = 1, 30 do R:Save(ENC, nil, { text = "mine " .. i, times = "P1 0:" .. string.format("%02d", i), boss = "Test Boss" }) end
  CRT.NoteReminders.Refresh()
  local shown = 0
  for _, row in ipairs(f.rows) do if row.frame.shown then shown = shown + 1 end end
  assert(shown == #f.rows, "every row in use")
  assert(f.list.OnMouseWheel, "the list takes the wheel")
  f.list.OnMouseWheel(f.list, -1)
  assert(f.rows[1].name.text ~= "Real Name", "scrolled down")
  f.list.OnMouseWheel(f.list, 1)
  assert(f.rows[1].name.text == "Real Name", "and back up")
  assert(#errors == 0, tostring(errors[1]))
end)

-- The list's scroll bar is its own thin thumb at its right edge, the same in every theme (an accent tint):
-- every row, and so its selection, highlight (both SetAllPoints) and dot, ends UI.SCROLL_GAP before it.
check("mech: no row runs under the list's scroll bar", function()
  local f = fresh()
  for i = 1, 30 do R:Save(ENC, nil, { text = "mine " .. i, times = "P1 0:" .. string.format("%02d", i), boss = "Test Boss" }) end
  CRT.NoteReminders.Refresh()
  local thumb = f.thumb
  assert(thumb and thumb.shown, "a long list shows its scroll bar")
  local p = thumb.pts[#thumb.pts]
  assert(p[1] == "TOPRIGHT" and p[2] == f.list and p[3] == "TOPRIGHT", "the bar hangs from the list's right edge")
  local barLeft = f.list.w + p[4] - thumb.w
  for i, row in ipairs(f.rows) do
    local rp = row.frame.pts[1]
    assert(rp[1] == "TOPLEFT" and type(rp[2]) == "number", "row " .. i .. " placed from the list's left")
    local right = rp[2] + row.frame.w
    assert(right + CRT.UI.SCROLL_GAP <= barLeft, "row " .. i .. " ends at " .. right .. ", the bar starts at " .. barLeft)
    assert(row.sel.allPoints, "row " .. i .. ": the selection is the row's own size")
    local dp = row.dot.pts[1]
    assert(dp[1] == "RIGHT" and type(dp[2]) == "number" and dp[2] <= 0, "row " .. i .. ": the dot sits inside the row")
  end
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: click selects, panel shows its fields", function()
  local f = fresh()
  local p = f.panel
  -- first open: the first row is selected
  assert(f.rows[1].sel.shown and not f.rows[2].sel.shown, "first row selected")
  local sc = f.rows[1].sel.color
  assert(sc and math.abs(sc[1] - CRT.PALETTE.selected[1]) < 1e-6, "the selected-tab colour")
  assert(p.name.text == "Real Name" and p.icon.texture == "tex777" and p.icon.w == 28, "header")
  assert(p.textEdit.text == "Real Name" and p.idEdit.text == "777", "look boxes")
  -- a click on the row, outside the tick, selects it
  click(f.rows[2].frame)
  assert(f.rows[2].sel.shown and not f.rows[1].sel.shown, "second row selected")
  assert(p.name.text == "Other Spell" and p.textEdit.text == "Other Spell" and p.idEdit.text == "888", "panel follows")
  assert(p.showFrom.opts.get() == 5 and p.linger.opts.get() == 0, "sliders from a new draft")
  assert(p.checks.alert.checked and p.checks.bar.checked and not p.checks.text.checked, "Show as")
  assert(p.also.speak.checked and not p.also.count.checked and not p.also.glow.checked, "Also")
  assert(p.alertMe.checked == false, "Alert me off with no reminder")
  assert(#R:List(ENC) == 0, "selecting saves nothing")
  -- a saved reminder shows its own fields
  R:Save(ENC, nil, { spellID = 777, boss = "Test Boss", text = "Custom", warn = 8, linger = 2, outputs = { icon = true, alert = false, bar = false }, speech = "count" })
  click(f.rows[1].frame)
  assert(p.name.text == "Custom" and p.textEdit.text == "Custom", "its text")
  assert(p.showFrom.opts.get() == 8 and p.linger.opts.get() == 2, "its sliders")
  assert(p.checks.icon.checked and not p.checks.alert.checked and p.also.count.checked and not p.also.speak.checked, "its outputs")
  assert(p.alertMe.checked == true, "Alert me on")
  -- the last selection is kept per boss for the session
  click(f.rows[2].frame)
  dropdowns["Boss"].opts.set(5555)
  assert(f.panel.name.text ~= "Other Spell", "another boss")
  dropdowns["Boss"].opts.set(ENC)
  assert(f.rows[2].sel.shown and p.name.text == "Other Spell", "back on the second row")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: Show as names fit the left column, in two rows", function()
  local f = fresh()
  local p = f.panel
  assert(p.checks.alert.label.text == "Note callout/assignments" and p.checks.text.label.text == "Critical alerts text", "the displays' names")
  local helpRoom = 0
  for _, help in ipairs(helps) do if help.helpTitle == "Show as" then helpRoom = 1 end end
  assert(helpRoom == 1, "Show as has its (?)")
  for _, help in ipairs(helps) do
    if help.helpTitle == "Show as" then assert(help.helpText:find("note callout", 1, true) and help.helpText:find("Critical alerts text", 1, true), "its (?) names them") end
  end
  -- the left column: from the panel's inset to half the panel (CRT_Modules/Notes/Reminders.lua L.COL_W)
  local colRight = 12 + math.floor((p.frame.w - 24 - 22) / 2)
  -- at the default size every label is as wide as its words; at the largest (about 1.75 times, General
  -- Settings' 22 in Modern) they are narrowed to fit, measured again on the next draw
  local function rows(scale, cut)
    for _, rowKeys in ipairs({ { "alert", "text" }, { "icon", "bar", "circle", "timeline" } }) do
      local right, y = 0, nil
      for _, k in ipairs(rowKeys) do
        local c = p.checks[k]
        local pt = c.pts[#c.pts]
        assert(pt[2] >= right, k .. " starts after the label before it (" .. scale .. ")")
        assert(y == nil or pt[3] == y, k .. " on its row")
        y = pt[3]
        local words = math.ceil(#c.label.text * 6 * scale)
        assert(cut or c.label.w == words, k .. ": its label as wide as its words, never cut")
        assert(c.label.w <= words and c.label.wordWrap == false, k .. ": one line, never wider than its words")
        right = pt[2] + 26 + c.label.w
      end
      assert(right <= colRight, "the row ends inside the left column at " .. scale .. ": " .. right .. " of " .. colRight)
    end
  end
  rows(1, false)
  TEXT_SCALE = 1.75
  click(f.rows[2].frame)
  rows(1.75, true)
  assert(p.checks.alert.label.w < math.ceil(#p.checks.alert.label.text * 6 * 1.75), "cut to fit at the largest size")
  TEXT_SCALE = nil
  click(f.rows[1].frame)
  rows(1, false)
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: tick makes and turns off a reminder", function()
  local f = fresh()
  local row = f.rows[1]
  setCheck(row.check, true)
  local r, id = only()
  assert(r.spellID == 777 and r.boss == "Test Boss" and r.text == "Real Name" and r.enabled == true, "made")
  assert(r.outputs.alert and r.warn == 5 and r.speech == "text", "defaults filled")
  assert(f.panel.alertMe.checked == true, "the panel's Alert me follows")
  setCheck(row.check, false)
  r = only()
  assert(r.enabled == false, "kept, turned off")
  assert(f.panel.alertMe.checked == false and row.check.checked == false, "both off")
  -- Alert me is the same switch
  setCheck(f.panel.alertMe, true)
  r = only()
  assert(r.enabled == true and row.check.checked == true, "Alert me turns it back on")
  click(f.rows[2].frame)
  setCheck(f.panel.alertMe, true)
  assert(#R:List(ENC) == 2 and R:List(ENC)[2].r.spellID == 888, "Alert me makes the second one")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: a change in the panel saves the reminder", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  p.showFrom.opts.set(9)
  assert(R:Get(ENC, id).warn == 9, "Show from saved")
  typeInto(p.textEdit, "Soak")
  p.textEdit.OnEnterPressed(p.textEdit)
  assert(R:Get(ENC, id).text == "Soak", "text saved")
  assert(f.rows[1].name.text == "Soak", "the row shows it")
  setCheck(p.checks.bar, false)
  assert(R:Get(ENC, id).outputs.bar == false, "Bar saved")
  assert(p.checks.timeline and not p.checks.timeline.checked, "a Timeline box, off")
  setCheck(p.checks.timeline, true)
  assert(R:Get(ENC, id).outputs.timeline == true, "Timeline saved")
  setCheck(p.checks.timeline, false)
  assert(R:Get(ENC, id).outputs.timeline == false, "Timeline off saved")
  setCheck(p.also.glow, true)
  assert(R:Get(ENC, id).glow == true, "Glow saved")
  p.sound.opts.set(p.sound.opts.options()[2].key)
  assert(R:Get(ENC, id).sound == p.sound.opts.options()[2].key, "sound saved")
  click(p.colorSwatch)
  picker.r, picker.g, picker.b = 0.2, 0.4, 0.6
  picker.info.swatchFunc()
  assert(R:Get(ENC, id).color[1] == 0.2, "colour saved")
  click(p.colorDefault)
  assert(R:Get(ENC, id).color == nil, "Default clears it")
  -- Use custom colours off: the Color row is greyed and changes nothing; the saved colour stays
  click(p.colorSwatch) picker.r, picker.g, picker.b = 0.3, 0.3, 0.3 picker.info.swatchFunc()
  CRT.db.alerts.customColors = false
  setCheck(p.also.glow, false) setCheck(p.also.glow, true) -- any change redraws the panel
  assert(p.colorSwatch.enabled == false and p.colorDefault.enabled == false, "off: the colour row is greyed")
  click(p.colorDefault)
  assert(R:Get(ENC, id).color and R:Get(ENC, id).color[1] == 0.3, "off: Default changes nothing, the colour stays saved")
  CRT.db.alerts.customColors = true
  click(p.colorDefault)
  assert(R:Get(ENC, id).color == nil and p.colorSwatch.enabled == true, "on: open again")
  assert(only() and #R:List(ENC) == 1, "still one reminder")
  -- nothing to show: a small red line, and the saved reminder stays as it was
  setCheck(p.checks.alert, false)
  setCheck(p.also.speak, false)
  assert(p.message.shown and p.message.text:find("nothing", 1, true) and p.message.text:find("|cff" .. CRT.UI.Hex("bad"), 1, true), "red line: " .. tostring(p.message.text))
  assert(R:Get(ENC, id).outputs.alert == false and R:Get(ENC, id).outputs.speech == true, "the change that left nothing is not saved")
  setCheck(p.checks.alert, true)
  assert(p.message.text == "" and R:Get(ENC, id).outputs.alert == true and R:Get(ENC, id).outputs.speech == false, "saved again, line cleared")
  -- Test runs it through the editor's test, and Save as template asks for a name
  click(p.testBtn)
  assert(A.running and A.run.reason == "test", "test run")
  A:Stop(true)
  local asked
  local was = E.AskTemplateName
  E.AskTemplateName = function(self, c, d) asked = { c = c, d = d } return true end
  click(p.templateBtn)
  E.AskTemplateName = was
  assert(asked and asked.c.id == id and asked.d.text == "Soak", "Save as template takes the panel's alert")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: first change on an ability makes its reminder", function()
  local f = fresh()
  click(f.rows[2].frame)
  assert(#R:List(ENC) == 0)
  f.panel.linger.opts.set(3)
  local r, id = only()
  assert(r.spellID == 888 and r.linger == 3 and r.text == "Other Spell" and r.boss == "Test Boss", "made from the ability")
  assert(not f.rows[2].check.checked and f.rows[2].sel.shown, "still unticked, and still selected")
  f.panel.showFrom.opts.set(7)
  local r2, id2 = only()
  assert(id2 == id and r2.warn == 7 and r2.linger == 3, "the same reminder changes")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: times line is read-only", function()
  local f = fresh()
  local t = f.panel.times
  assert(t.kind == "FontString", "a line of text, not a box: " .. tostring(t.kind))
  assert(t.text:find("P1 0:30", 1, true), "times from the reference: " .. tostring(t.text))
  assert(t.wordWrap == false and t.w > 0, "one line, cut with ...")
  assert(t.textColor and t.textColor[1] < 0.8, "greyed")
  click(f.rows[2].frame)
  assert(t.text:find("P1 1:00", 1, true), "the second row's casts: " .. t.text)
  assert(not dropdowns["Relative to"] and not dropdowns["Time"], "no Relative to")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: times from follows the reference", function()
  local f = fresh()
  local d = dropdowns["Times from"]
  local keys = {}
  for _, o in ipairs(d.opts.options()) do keys[#keys + 1] = o.key end
  assert(table.concat(keys, ","):find("own:1") and table.concat(keys, ","):find("own:2"), table.concat(keys, ","))
  assert(f.panel.times.text:find("0:30", 1, true), "first reference: " .. f.panel.times.text)
  d.opts.set("own:2")
  assert(f.panel.times.text:find("0:45", 1, true), "the Heroic reference: " .. f.panel.times.text)
  assert(f.rows[1].dot.shown, "the dot follows it too")
end)

check("mech: show on the timeline calls ShowRow", function()
  local f = fresh()
  click(f.panel.timelineBtn)
  assert(#showCalls == 1 and showCalls[1].enc == ENC and showCalls[1].spell == 777 and showCalls[1].name == "Real Name", "ShowRow(9001, 777, Real Name)")
  assert(#printed == 0, "found: nothing printed")
  showResult = false
  click(f.panel.timelineBtn)
  assert(#printed == 1 and printed[1] == "That mechanic isn't on the Timeline for this boss yet.", tostring(printed[1]))
  showResult = true
  local was = CRT.Timeline.ShowRow
  CRT.Timeline.ShowRow = nil
  click(f.panel.timelineBtn)
  -- an error inside ShowRow goes to the error handler, not lost
  CRT.Timeline.ShowRow = function() error("broken row") end
  click(f.panel.timelineBtn)
  CRT.Timeline.ShowRow = was
  assert(#errors == 1 and tostring(errors[1]):find("broken row", 1, true), "error reported: " .. tostring(errors[1]))
  table.remove(errors, 1)
end)

-- Save as Raid note (Notes/MechNote.lua): the alert goes into the boss's raid note for the difficulty on show, one line
-- per cast (the Mythic ability timeline: Real Name at P1 0:30 and P2 0:20), every change rewrites them, Only me takes
-- them out
local function noteFor(enc, diff)
  local id = CRT.Notes:FindForEncounter(enc, diff)
  return id and noteStore[id], id
end
local function marked(raw, key)
  local out = {}
  for line in (raw .. "\\n"):gmatch("(.-)\\n") do
    if CRT.MechNote.IsMarked(line, key) then out[#out + 1] = CRT.NoteParser.Parse(line).timers[1] end
  end
  return out
end
local function mineItems()
  return A.blocks.mine.Entries({ encounterID = ENC, anyDifficulty = true })
end

check("mech raid note: Save as Raid note writes one line per cast", function()
  resetNotes()
  local f = fresh()
  local p = f.panel
  local d = p.saveAs
  assert(d and d.label == "Save as", "Save as dropdown")
  local keys = {}
  for _, o in ipairs(d.opts.options) do keys[#keys + 1] = o.key .. (o.disabled and "(off)" or "") end
  assert(table.concat(keys, ",") == "note,mine", "Raid note can be picked: " .. table.concat(keys, ","))
  assert(d.opts.get() == "mine" and p.forDrop and p.forDrop.label == "For", "Only me, and a For dropdown")
  assert(p.forDrop.opts.enabledIf() == false, "For greyed while Only me")
  assert(p.noteStatus.text == "", "no status line")
  assert(p.saveAsHelp.helpText:find("raid note for the difficulty on show", 1, true) and p.saveAsHelp.helpText:find("Share the note", 1, true), "its (?) says what it does")
  -- an existing note for the boss: kept, with its free text
  noteStore[1] = { raw = "EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\nTanks: Abu\\ntime:5;text:Other;", encounterID = 9001, difficulty = "Mythic" }
  noteNext = 2
  d.opts.set("note")
  local r, id = only()
  assert(r.enabled == true and r.raidNote and r.raidNote.tag == "all" and r.raidNote.key == "777" and r.raidNote.difficulty == "Mythic", "the reminder is on and in the note")
  assert(d.opts.get() == "note" and p.forDrop.opts.enabledIf() == true, "Raid note shows, For open")
  local note = noteStore[1]
  local lines = marked(note.raw, "777")
  assert(#lines == 2, "one line per cast: " .. note.raw)
  assert(lines[1].ph == 1 and lines[1].time == 30 and lines[2].ph == 2 and lines[2].time == 20, "phases kept")
  assert(lines[1].tags[1] == "all" and lines[1].spellId == 777 and lines[1].text == "Real Name" and lines[1].show.alert and lines[1].show.bar and lines[1].tts and lines[1].warn == 5, "the panel's alert")
  assert(note.raw:find("^EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\nTanks: Abu\\ntime:5;text:Other;\\n"), "the rest kept: " .. note.raw)
  assert(f.rows[1].check.checked and p.alertMe.checked, "ticked")
  assert(p.noteStatus.text:find("In the raid note for Test Boss (Mythic): 2 lines. Share the note to send it to the raid.", 1, true), "status: " .. p.noteStatus.text)
  assert(p.noteStatus.text:find("|cff" .. CRT.UI.Hex("good"), 1, true), "in the good colour")
  assert(#mineItems() == 0, "your own alert steps aside for the note's lines")
  -- a change rewrites the lines in place, never adds
  p.showFrom.opts.set(9)
  lines = marked(noteStore[1].raw, "777")
  assert(#lines == 2 and lines[1].warn == 9 and lines[2].warn == 9, "Show from")
  typeInto(p.textEdit, "Dodge")
  p.textEdit.OnEnterPressed(p.textEdit)
  lines = marked(noteStore[1].raw, "777")
  assert(#lines == 2 and lines[1].text == "Dodge", "Text")
  setCheck(p.checks.circle, true)
  assert(marked(noteStore[1].raw, "777")[1].show.circle, "Show as")
  assert(select(2, noteStore[1].raw:gsub("mech:777;", "")) == 2, "two lines, no duplicates")
  assert(noteNext == 2, "no second note")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech raid note: For, the tick, and Only me", function()
  resetNotes()
  local f = fresh()
  local p = f.panel
  p.saveAs.opts.set("note")
  local note = noteFor(ENC, "Mythic")
  assert(note and note.name == "Test Boss" and note.difficulty == "Mythic" and note.via == "Mech Alerts" and note.asNew, "a note made for the boss")
  -- For: a role
  local labels = {}
  for _, o in ipairs(p.forDrop.opts.options()) do labels[#labels + 1] = (o.title and "#" or "") .. o.label .. (o.checkbox and "[]" or "") end
  assert(table.concat(labels, ","):find("^Everyone,Tanks,Healers,Melee,Ranged,#Players"), table.concat(labels, ","))
  p.forDrop.opts.set("healer")
  local lines = marked(note.raw, "777")
  assert(#lines == 2 and lines[1].tags[1] == "healer" and lines[2].tags[1] == "healer", "the lines' tag reads healer")
  assert(p.forDrop.opts.get() == "healer", "For shows it")
  -- For: picked players, ticked one by one
  p.forDrop.opts.toggle("Abu")
  p.forDrop.opts.toggle("Cheo")
  lines = marked(note.raw, "777")
  assert(table.concat(lines[1].tags, " ") == "Abu Cheo" and p.forDrop.opts.checked("Abu"), "players: " .. table.concat(lines[1].tags, " "))
  labels = {}
  for _, o in ipairs(p.forDrop.opts.options()) do if o.checkbox then labels[#labels + 1] = o.label end end
  assert(table.concat(labels, ","):find("Abu", 1, true) and table.concat(labels, ","):find("Cheo", 1, true), "picked players stay listed")
  p.forDrop.opts.toggle("Abu") p.forDrop.opts.toggle("Cheo")
  assert(marked(note.raw, "777")[1].tags[1] == "all", "none left: everyone")
  -- Alert me off: out of the note, and back
  setCheck(f.rows[1].check, false)
  assert(#marked(note.raw, "777") == 0 and only().raidNote, "off: the lines are gone, the choice kept")
  assert(p.noteStatus.text:find("Off", 1, true) and p.noteStatus.text:find("|cff" .. CRT.UI.Hex("warn"), 1, true), "said in the warn colour: " .. p.noteStatus.text)
  setCheck(f.rows[1].check, true)
  assert(#marked(note.raw, "777") == 2, "on: back")
  -- lines gone from the note (a share replaced it): the panel owns them, so they are written again at once
  note.raw = "EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\n"
  CRT.Notes:Fire()
  assert(#marked(note.raw, "777") == 2 and p.noteStatus.text:find("2 lines", 1, true), "written again: " .. note.raw)
  -- a line changed elsewhere (a drag on the Timeline): written back as the panel has it when the row is picked
  note.raw = note.raw:gsub("time:30;", "time:33;")
  click(f.rows[2].frame) click(f.rows[1].frame)
  assert(marked(note.raw, "777")[1].time == 30, "the panel's time again")
  -- Only me: the lines go, the personal alert is back
  note.raw = note.raw .. "free text after\\n"
  p.saveAs.opts.set("mine")
  local r = only()
  assert(r.raidNote == nil and r.enabled == true and p.saveAs.opts.get() == "mine", "Only me again, still on")
  assert(#marked(note.raw, "777") == 0 and note.raw == "EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\nfree text after\\n", "only its lines taken out: " .. note.raw)
  assert(#mineItems() == 2, "your own alert runs again: " .. #mineItems())
  assert(p.noteStatus.text == "" and p.forDrop.opts.enabledIf() == false, "status gone, For greyed")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech raid note: refused when you may not change the raid note; Heroic goes to its own note", function()
  resetNotes()
  local f = fresh()
  local p = f.panel
  local was = CRT.Notes.CanEditRaid
  CRT.Notes.CanEditRaid = function() return false, "Only the raid leader or assistants can change the raid note." end
  p.saveAs.opts.set("note")
  assert(p.saveAs.opts.get() == "mine" and #R:List(ENC) == 0 and next(noteStore) == nil, "nothing saved or written")
  assert(p.message.text:find("raid leader", 1, true), "the reason: " .. tostring(p.message.text))
  CRT.Notes.CanEditRaid = was
  -- Times from on the Heroic ability timeline: the Heroic note, its one cast
  dropdowns["Times from"].opts.set("own:2")
  p.saveAs.opts.set("note")
  local note = noteFor(ENC, "Heroic")
  assert(note and note.difficulty == "Heroic" and #marked(note.raw, "777") == 1 and marked(note.raw, "777")[1].time == 45, "Heroic: " .. tostring(note and note.raw))
  assert(only().raidNote.difficulty == "Heroic" and p.noteStatus.text:find("(Heroic): 1 line.", 1, true), p.noteStatus.text)
  -- a problem in the panel: nothing written, the lines stay as they were
  setCheck(p.checks.alert, false) setCheck(p.checks.bar, false)
  local before = note.raw
  setCheck(p.also.speak, false)
  assert(note.raw == before and p.message.text:find("nothing", 1, true), "a change that can't save writes nothing")
  setCheck(p.checks.alert, true)
  -- your own reminder in the note, deleted: its lines go too
  click(f.ownButton)
  typeInto(p.textEdit, "Mine")
  typeInto(p.timesEdit, "P1 0:10, 0:50")
  p.timesEdit.OnEnterPressed(p.timesEdit)
  p.saveAs.opts.set("note")
  assert(#marked(note.raw, "mine") == 2, "own reminder: its typed times: " .. note.raw)
  local popup
  StaticPopup_ShowCustomGenericConfirmation = function(o) popup = o return {} end
  CRT.UI.LiftOver = CRT.UI.LiftOver or function(x) return x end
  CRT.UI.ShownPopup = CRT.UI.ShownPopup or function(x) return x end
  click(p.deleteBtn)
  assert(popup, "asked")
  popup.callback()
  assert(#marked(note.raw, "mine") == 0 and #marked(note.raw, "777") == 1, "its lines went, the other alert's stay")
  assert(#errors == 0, tostring(errors[1]))
end)

-- while you may not change the raid note (in a raid, not the leader or an assistant): a Raid note alert's edits and
-- tick are refused with the reason, the lines are never rewritten, and Only me and Delete still work, saying the lines
-- stay in the note
check("mech raid note: without the right to change the raid note", function()
  resetNotes()
  local f = fresh()
  local p = f.panel
  p.saveAs.opts.set("note")
  local note = noteFor(ENC, "Mythic")
  local before = note.raw
  local _, id = only()
  local was = CRT.Notes.CanEditRaid
  local REASON = "Only the raid leader or assistants can change the raid note."
  CRT.Notes.CanEditRaid = function() return false, REASON end
  -- an edit
  p.showFrom.opts.set(12)
  assert(R:Get(ENC, id).warn == 5 and note.raw == before, "not saved, not written")
  assert(p.message.text:find("raid leader", 1, true), "the reason: " .. tostring(p.message.text))
  -- Alert me off
  setCheck(f.rows[1].check, false)
  assert(R:Get(ENC, id).enabled == true and note.raw == before, "still on, the lines stay")
  assert(f.rows[1].check.checked == true and p.message.text:find("raid leader", 1, true), "the tick shows on again, with the reason")
  setCheck(p.alertMe, false)
  assert(R:Get(ENC, id).enabled == true, "Alert me too")
  -- out of step, and nothing written: said in the warn colour
  note.raw = note.raw:gsub("time:30;", "time:33;")
  CRT.Notes:Fire()
  assert(note.raw:find("time:33;", 1, true) and p.noteStatus.text:find("out of date", 1, true)
    and p.noteStatus.text:find("|cff" .. CRT.UI.Hex("warn"), 1, true), "out of date: " .. p.noteStatus.text)
  local stale = note.raw
  -- Only me: always saved; the lines stay, and it says so
  p.saveAs.opts.set("mine")
  assert(R:Get(ENC, id).raidNote == nil and p.saveAs.opts.get() == "mine", "Only me saved")
  assert(note.raw == stale and p.message.text:find("stay in the raid note", 1, true), "lines stay: " .. tostring(p.message.text))
  -- Delete your own Raid note reminder: deleted, the lines stay, said
  CRT.Notes.CanEditRaid = was
  click(f.ownButton)
  typeInto(p.textEdit, "Mine")
  typeInto(p.timesEdit, "P1 0:10")
  p.timesEdit.OnEnterPressed(p.timesEdit)
  p.saveAs.opts.set("note")
  assert(#marked(note.raw, "mine") == 1, "own one in the note")
  CRT.Notes.CanEditRaid = function() return false, REASON end
  local popup
  StaticPopup_ShowCustomGenericConfirmation = function(o) popup = o return {} end
  CRT.UI.LiftOver = CRT.UI.LiftOver or function(x) return x end
  CRT.UI.ShownPopup = CRT.UI.ShownPopup or function(x) return x end
  click(p.deleteBtn)
  popup.callback()
  assert(#marked(note.raw, "mine") == 1 and p.message.text:find("Deleted", 1, true), "deleted, lines stay, said: " .. tostring(p.message.text))
  CRT.Notes.CanEditRaid = was
  assert(#errors == 0, tostring(errors[1]))
end)

-- the panel never rewrites the note on its own mid-pull; an older alert on any difficulty goes into the note for the
-- group on show only; a pull that reads another note is said
check("mech raid note: no rewrite in an encounter, an older alert splits, another note for the pull is said", function()
  resetNotes()
  local f = fresh()
  local p = f.panel
  p.saveAs.opts.set("note")
  local note = noteFor(ENC, "Mythic")
  -- a share replaced the note during a pull: nothing written until it ends
  IsEncounterInProgress = function() return true end
  note.raw = "EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\n"
  CRT.Notes:Fire()
  click(f.rows[2].frame) click(f.rows[1].frame)
  assert(#marked(note.raw, "777") == 0, "not written during an encounter: " .. note.raw)
  assert(p.noteStatus.text:find("none of its lines", 1, true), p.noteStatus.text)
  IsEncounterInProgress = nil
  CRT.Notes:Fire()
  assert(#marked(note.raw, "777") == 2, "written once it ended")
  -- the pull reads another note (an active note for any difficulty, say): said in the warn colour
  local wasFind = CRT.Notes.FindForEncounter
  CRT.Notes.FindForEncounter = function() return 999 end
  CRT.Notes:Fire()
  assert(p.noteStatus.text:find("The pull uses another note for this boss, so these lines won't run.", 1, true)
    and p.noteStatus.text:find("|cff" .. CRT.UI.Hex("warn"), 1, true), p.noteStatus.text)
  CRT.Notes.FindForEncounter = wasFind
  CRT.Notes:Fire()
  assert(p.noteStatus.text:find("2 lines", 1, true), p.noteStatus.text)
  -- an older alert on any difficulty: Raid note for the group on show only, the other half stays Only me
  resetNotes()
  local f2 = fresh()
  local id = R:Save(ENC, nil, { spellID = 888, boss = "Test Boss", text = "Other Spell", outputs = { alert = true }, enabled = true })
  CRT.db.alerts.reminders[ENC][id].group = nil
  CRT.NoteReminders.Refresh()
  click(f2.rows[2].frame)
  f2.panel.saveAs.opts.set("note")
  local mythic, nh = {}, {}
  for _, e in ipairs(R:List(ENC)) do
    if R.GroupOf(e.r) == "mythic" then mythic[#mythic + 1] = e.r elseif R.GroupOf(e.r) == "nh" then nh[#nh + 1] = e.r end
  end
  assert(#mythic == 1 and mythic[1].raidNote and #nh == 1 and nh[1].raidNote == nil, "split: Mythic in the note, Normal/Heroic Only me")
  assert(#marked(noteFor(ENC, "Mythic").raw, "888") == 1, "its one Mythic cast in the note")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: every (?) is right of what it explains", function()
  local f = fresh()
  for _, h in ipairs(helps) do
    assert(rawget(h, "helpTarget") ~= nil, "the (?) " .. tostring(h.helpTitle) .. " is placed by UI.HelpRight")
  end
  local p = f.panel
  assert(rawget(p.saveAsHelp, "helpTarget") == p.saveAs, "Save as: its (?) is right of the dropdown")
  assert(rawget(p.timesHelp, "helpTarget") == p.timesEdit, "Times: its (?) is right of the box")
  local aura
  for _, h in ipairs(helps) do if rawget(h, "helpTarget") == p.auraSound.label then aura = h end end
  assert(aura, "the aura sound check's (?) is right of its label's text")
end)

check("mech: your own reminder button", function()
  local f = fresh()
  click(f.ownButton)
  assert(#R:List(ENC) == 0, "not saved until a change")
  local sel
  for _, row in ipairs(f.rows) do if row.frame.shown and row.sel.shown then sel = row end end
  assert(sel and sel == f.rows[3], "a new row, selected")
  assert(f.panel.textEdit.text == "" and f.panel.idEdit.text == "", "an empty alert")
  typeInto(f.panel.textEdit, "Soak now")
  f.panel.textEdit.OnEditFocusLost(f.panel.textEdit)
  local r = only()
  assert(r.text == "Soak now" and r.spellID == nil and r.boss == "Test Boss", "saved as your own")
  assert(f.rows[3].name.text == "Soak now" and f.rows[3].sel.shown, "listed and still selected: " .. tostring(f.rows[3].name.text) .. " " .. tostring(f.rows[3].sel.shown) .. " " .. tostring(f.rows[4].frame.shown) .. tostring(f.rows[4].sel.shown))
  assert(not f.rows[4].frame.shown, "no second new row")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: Export and Import sit beside Your own reminder", function()
  local f = fresh()
  local own, ex, im = f.ownButton, f.exportButton, f.importButton
  assert(ex and im, "the two buttons")
  assert(ex.text == "Export" and im.text == "Import" and ex.shown and im.shown and own.shown, "named and shown")
  assert(own.normalFont == CRTFontButtonSmall and ex.normalFont == CRTFontButtonSmall and im.normalFont == CRTFontButtonSmall, "all three in the small button font")
  assert(ex.w == CRT.UI.PanelButtonWidth(labelWidth(ex)) and im.w == CRT.UI.PanelButtonWidth(labelWidth(im)), "each as wide as its label")
  assert(own.w + ex.w + im.w + 8 == 250, "the three fill the list's width: " .. own.w .. " " .. ex.w .. " " .. im.w)
  assert(own.w >= CRT.UI.PanelButtonWidth(labelWidth(own)), "Your own reminder's label fits: " .. own.w)
  local p = im.pts[1]
  assert(p[1] == "TOPRIGHT" and p[3] == "TOPLEFT" and p[4] == 8 + 250 and p[5] == own.pts[1][3], "Import ends at the list's right edge, on Your own reminder's row")
  assert(ex.pts[1][1] == "RIGHT" and ex.pts[1][2] == im and ex.pts[1][4] == -4, "Export left of Import")
  for i = #shareCalls, 1, -1 do shareCalls[i] = nil end
  click(ex)
  assert(shareCalls[1] and shareCalls[1][1] == "export" and shareCalls[1][2] == ENC, "Export opens on the boss on show")
  click(im)
  assert(shareCalls[2] and shareCalls[2][1] == "import", "Import opens")
  click(f.special.specialBtn)
  assert(not ex.shown and not im.shown and not own.shown, "hidden on Special")
  click(f.special.mechBtn)
  assert(ex.shown and im.shown, "back on Mechanics")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: icon box looks up spells by name", function()
  local f = fresh()
  local p = f.panel
  click(f.ownButton)
  assert(p.lookup and not p.lookup.shown, "list hidden at first")
  typeInto(p.idEdit, "ot")
  assert(not p.lookup.shown, "two letters open nothing")
  typeInto(p.idEdit, "other")
  assert(p.lookup.shown and p.lookup.rows[1].nameText.text == "Other Spell" and p.lookup.rows[1].tagText.text == "Boss", "a match from the boss: " .. tostring(p.lookup.shown) .. " " .. tostring(p.lookup.rows[1].nameText.text) .. " " .. tostring(p.lookup.rows[1].tagText.text))
  assert(#R:List(ENC) == 0, "letters change nothing")
  click(p.lookup.rows[1])
  assert(not p.lookup.shown and p.idEdit.text == "888" and p.textEdit.text == "Other Spell", "picked: " .. p.idEdit.text)
  local r = only()
  assert(r.spellID == 888 and r.text == "Other Spell", "saved with the spell")
  -- near matches too, and Enter takes the top one
  typeInto(p.idEdit, "Ral Name")
  assert(p.lookup.shown and p.lookup.rows[1].nameText.text == "Real Name", "close spelling")
  p.idEdit.OnEnterPressed(p.idEdit)
  assert(p.idEdit.text == "777" and only().spellID == 777, "Enter picks it")
  -- the list stays on the page: lined up with the box's right edge
  assert(p.lookup.pts[1][1] == "TOPRIGHT", "right aligned")
  assert(#errors == 0, tostring(errors[1]))
end)

-- Where a mock sits in the tab, from its anchors: { left, top, right, bottom }, y growing down.
local FX = { LEFT = 0, CENTER = 0.5, RIGHT = 1, TOP = 0.5, BOTTOM = 0.5 }
local function fx(p) if p:find("LEFT") then return 0 elseif p:find("RIGHT") then return 1 end return 0.5 end
local function fy(p) if p:find("TOP") then return 0 elseif p:find("BOTTOM") then return 1 end return 0.5 end
local function width(m)
  local o = rawget(m, "opts")
  if o then return (o.labelWidth or 140) + 5 + (o.width or 200) + (m.kind == "Slider" and 44 or 0) end
  return m.w or 0
end
local function height(m)
  if rawget(m, "opts") then return 32 end
  if m.kind == "FontString" and (m.h or 0) == 0 then return 14 end
  return m.h or 0
end
local rects
local function rect(m, root)
  if m == root then return { 0, 0, TAB_W, TAB_H } end
  if rects[m] then return rects[m] end
  local w, h = width(m), height(m)
  local xs, ys = {}, {}
  for _, p in ipairs(m.pts) do
    local point, rel, relPoint, x, y = p[1], p[2], p[3], p[4], p[5]
    if type(rel) ~= "table" then rel, relPoint, x, y = m.parent, point, p[2], p[3] end
    local rr = rect(rel, root)
    local px = rr[1] + fx(relPoint) * (rr[3] - rr[1]) + (x or 0)
    local py = rr[2] + fy(relPoint) * (rr[4] - rr[2]) - (y or 0)
    xs[#xs + 1] = { fx(point), px } ys[#ys + 1] = { fy(point), py }
  end
  local function span(list, size)
    local lo, hi
    for _, e in ipairs(list) do if e[1] == 0 then lo = e[2] elseif e[1] == 1 then hi = e[2] end end
    if lo and hi then return lo, hi end
    local e = list[1]
    if not e then return 0, size end
    local a = e[2] - e[1] * size
    return a, a + size
  end
  local l, r = span(xs, w)
  local t, b = span(ys, h)
  rects[m] = { l, t, r, b }
  return rects[m]
end
local function under(m, root)
  local f = m.parent
  while f do if f == root then return true end f = f.parent end
  return false
end
local function visible(m, root)
  local f = m
  while f and f ~= root do if not f.shown then return false end f = f.parent end
  return true
end
local function edges(root, what)
  rects = {}
  local n = 0
  for _, m in ipairs(made) do
    if under(m, root) and visible(m, root) and (#m.pts > 0) then
      local r = rect(m, root)
      n = n + 1
      local name = (rawget(m, "label") or rawget(m, "text") or m.kind)
      assert(r[1] >= -0.5 and r[2] >= -0.5, what .. ": " .. tostring(name) .. " passes the top or left edge (" .. r[1] .. ", " .. r[2] .. ")")
      assert(r[3] <= TAB_W + 0.5, what .. ": " .. tostring(name) .. " passes the right edge: " .. r[3] .. " > " .. TAB_W)
      assert(r[4] <= TAB_H + 0.5, what .. ": " .. tostring(name) .. " passes the bottom edge: " .. r[4] .. " > " .. TAB_H)
    end
  end
  return n
end

check("mech: typing saves once after a pause, not per key", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  local fired = 0
  local was = A.Fire
  A.Fire = function(...) fired = fired + 1 return was(...) end
  for _, s in ipairs({ "S", "So", "Soa", "Soak" }) do typeInto(p.textEdit, s) end
  assert(fired == 0 and R:Get(ENC, id).text == "Real Name", "nothing saved while typing: " .. fired)
  assert(#timers > 0 and timers[1].delay >= 0.3 and timers[1].delay <= 1, "a short pause")
  runTimers()
  assert(fired == 1 and R:Get(ENC, id).text == "Soak", "saved once after the pause: " .. fired)
  p.textEdit.OnEnterPressed(p.textEdit)
  p.textEdit.OnEditFocusLost(p.textEdit)
  assert(fired == 1, "nothing left to save")
  typeInto(p.textEdit, "Soak now")
  p.textEdit.OnEnterPressed(p.textEdit)
  assert(fired == 2 and R:Get(ENC, id).text == "Soak now", "Enter saves at once")
  runTimers()
  assert(fired == 2, "the pause after it finds nothing to save")
  typeInto(p.textEdit, "Soak later")
  p.textEdit.OnEditFocusLost(p.textEdit)
  assert(fired == 3 and R:Get(ENC, id).text == "Soak later", "leaving the box saves")
  -- a click on another row saves what was typed first
  typeInto(p.textEdit, "Typed then left")
  click(f.rows[2].frame)
  assert(R:Get(ENC, id).text == "Typed then left", "kept when switching rows")
  A.Fire = was
  runTimers()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: your own reminder takes typed times", function()
  local f = fresh()
  local p = f.panel
  -- an ability with reference times keeps the read-only line
  assert(p.times.shown and not p.timesEdit.shown, "reference times: read only")
  click(f.ownButton)
  assert(p.timesEdit.shown and not p.times.shown, "your own reminder: a Times box")
  assert(p.timesEdit.kind == "EditBox" and p.timesEdit.w > 0 and p.timesEdit.multiLine == false, "one line, fixed width")
  typeInto(p.timesEdit, "P1 0:30, 1:15; P2 0:20")
  assert(#R:List(ENC) == 0, "not saved per key")
  p.timesEdit.OnEnterPressed(p.timesEdit)
  local r, id = only()
  assert(r.times == "P1 0:30, 1:15; P2 0:20", "typed times saved: " .. tostring(r.times))
  local list = R:Times(ENC, r)
  assert(#list == 3 and list[3].ph == 2 and list[3].t == 20, "they read as three times")
  assert(p.timesEdit.shown and p.timesEdit.text == "P1 0:30, 1:15; P2 0:20", "still the box, with the times")
  -- a bad time: the parse error in red, nothing saved
  typeInto(p.timesEdit, "P1 0:30, soon")
  p.timesEdit.OnEnterPressed(p.timesEdit)
  local _, err = R.ParseTimes("P1 0:30, soon")
  assert(p.message.text:find("|cff" .. CRT.UI.Hex("bad"), 1, true) and p.message.text:find(err, 1, true), "red line: " .. tostring(p.message.text))
  assert(R:Get(ENC, id).times == "P1 0:30, 1:15; P2 0:20", "bad times not saved")
  -- a boss ability's alert follows its casts: typed times saved onto it are kept aside, never used
  local aid = R:Save(ENC, nil, { spellID = 777, boss = "Test Boss", text = "Real Name", times = "P1 0:05" })
  click(f.rows[1].frame)
  assert(p.times.shown and not p.timesEdit.shown and not p.times.text:find("0:05", 1, true), "the casts, read only: " .. tostring(p.times.text))
  local a = R:Get(ENC, aid)
  assert(a.times == nil and a.timesBackup == "P1 0:05" and a.timesUnmatched == "P1 0:05", "kept aside, far from any cast")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: editing an unticked ability keeps it off", function()
  local f = fresh()
  local p = f.panel
  click(f.rows[2].frame)
  p.showFrom.opts.set(8)
  local r, id = only()
  assert(r.enabled == false and r.warn == 8, "made, but off")
  assert(not f.rows[2].check.checked and not p.alertMe.checked, "the tick still shows off")
  setCheck(p.checks.icon, true)
  assert(R:Get(ENC, id).enabled == false, "another change keeps it off")
  setCheck(p.alertMe, true)
  assert(R:Get(ENC, id).enabled == true and f.rows[2].check.checked, "Alert me turns it on")
  p.linger.opts.set(4)
  assert(R:Get(ENC, id).enabled == true, "a change keeps it on")
  setCheck(f.rows[2].check, false)
  p.showFrom.opts.set(9)
  assert(R:Get(ENC, id).enabled == false and R:Get(ENC, id).warn == 9, "and off again after the tick")
  -- your own reminder too: made off until ticked
  click(f.ownButton)
  typeInto(p.textEdit, "Mine")
  p.textEdit.OnEnterPressed(p.textEdit)
  local mine
  for _, e in ipairs(R:List(ENC)) do if e.r.text == "Mine" then mine = e.r end end
  assert(mine and mine.enabled == false, "your own reminder made off")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: switching rows with a focused box loads the new row's text", function()
  local f = fresh()
  local p = f.panel
  typeInto(p.textEdit, "Hello")
  -- a click on a list row leaves the box's focus alone in the game
  click(f.rows[2].frame)
  assert(only().spellID == 777 and only().text == "Hello", "the first row kept what was typed")
  assert(p.textEdit.text == "Other Spell" and p.idEdit.text == "888", "the new row's text: " .. tostring(p.textEdit.text))
  assert(not p.textEdit.focused, "the box let go")
  typeInto(p.textEdit, "Other Spell!")
  p.textEdit.OnEnterPressed(p.textEdit)
  local list = R:List(ENC)
  assert(#list == 2 and list[1].r.text == "Hello" and list[2].r.spellID == 888 and list[2].r.text == "Other Spell!", "typing goes to the new row")
  -- the Times box too, on your own reminder
  click(f.ownButton)
  typeInto(p.timesEdit, "P1 0:40")
  click(f.rows[1].frame)
  assert(not p.timesEdit.shown or p.timesEdit.text ~= "P1 0:40", "the Times box shows the new row")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: typing then switching boss saves to the first row", function()
  local f = fresh()
  typeInto(f.panel.textEdit, "Boss text")
  dropdowns["Boss"].opts.set(5555)
  runTimers()
  local r = only()
  assert(r.spellID == 777 and r.text == "Boss text", "saved to the first boss's row")
  assert(#R:List(5555) == 0, "nothing on the other boss")
  assert(f.panel.textEdit.text ~= "Boss text", "the box cleared for the other boss")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: Open from the Timeline saves typing to its own row first", function()
  local f = fresh()
  typeInto(f.panel.textEdit, "Open text")
  local opened = CRT.NotesPage.Open
  CRT.NotesPage.Open = function() end
  CRT.NoteReminders.Open(5555, 888)
  CRT.NotesPage.Open = opened
  runTimers()
  local r = only()
  assert(r.spellID == 777 and r.text == "Open text", "saved to the row it was typed on")
  assert(#R:List(5555) == 0, "nothing on the boss Open moved to")
  assert(dropdowns["Boss"].opts.get() == 5555, "Open moved to the boss")
  dropdowns["Boss"].opts.set(ENC)
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: tick during typing makes one reminder", function()
  local f = fresh()
  click(f.rows[2].frame)
  typeInto(f.panel.textEdit, "Typed first")
  setCheck(f.rows[2].check, true)
  runTimers()
  local r = only()
  assert(r.spellID == 888 and r.text == "Typed first" and r.enabled == true, "one reminder, typed and on")
  -- Alert me with typing waiting, on your own reminder
  click(f.ownButton)
  typeInto(f.panel.textEdit, "Mine typed")
  setCheck(f.panel.alertMe, true)
  runTimers()
  local n = 0
  for _, e in ipairs(R:List(ENC)) do if e.r.text == "Mine typed" then n = n + 1 assert(e.r.enabled == true, "on") end end
  assert(n == 1 and #R:List(ENC) == 2, "one more reminder, got " .. #R:List(ENC))
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: typing a spell ID saves once", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  local fired = 0
  local was = A.Fire
  A.Fire = function(...) fired = fired + 1 return was(...) end
  for _, s in ipairs({ "8", "88", "888" }) do typeInto(p.idEdit, s) end
  assert(fired == 0 and R:Get(ENC, id).spellID == 777, "nothing saved per digit: " .. fired)
  runTimers()
  assert(fired == 1 and R:Get(ENC, id).spellID == 888, "saved once after the pause: " .. fired)
  typeInto(p.idEdit, "777")
  p.idEdit.OnEnterPressed(p.idEdit)
  assert(fired == 2 and R:Get(ENC, id).spellID == 777, "Enter saves at once: " .. fired)
  runTimers()
  assert(fired == 2, "nothing left after Enter")
  typeInto(p.idEdit, "999")
  p.idEdit:ClearFocus()
  assert(fired == 3 and R:Get(ENC, id).spellID == 999, "leaving the box saves")
  A.Fire = was
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: hiding the tab saves typing", function()
  local f = fresh()
  typeInto(f.panel.textEdit, "Before hiding")
  f:Hide()
  assert(only().text == "Before hiding", "saved on hide")
  assert(not f.panel.textEdit.focused, "the box let go")
  f:Show()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: sliders save when let go", function()
  local f = fresh()
  assert(f.panel.showFrom.opts.onRelease == true and f.panel.linger.opts.onRelease == true, "onRelease on both sliders")
end)

check("mech: ticking a new row with a problem lists it once", function()
  local f = fresh()
  local p = f.panel
  click(f.ownButton)
  typeInto(p.timesEdit, "P1 soon")
  p.timesEdit.OnEnterPressed(p.timesEdit)
  assert(#R:List(ENC) == 0 and p.message.text ~= "", "bad times: not saved")
  setCheck(f.rows[3].check, true)
  local r = only()
  assert(r.enabled == true, "made, on")
  assert(f.rows[3].frame.shown and not f.rows[4].frame.shown, "no waiting new row left")
  assert(f.rows[3].sel.shown, "the made row is selected")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: a scroll step parses nothing", function()
  local f = fresh()
  for i = 1, 30 do R:Save(ENC, nil, { text = "mine " .. i, times = "P1 0:" .. string.format("%02d", i), boss = "Test Boss" }) end
  CRT.NoteReminders.Refresh()
  local counts = { parse = 0, times = 0, list = 0, forBoss = 0 }
  local wParse, wTimes, wList, wFor = Ref.Parse, R.Times, Ref.List, Ref.ForBoss
  Ref.Parse = function(...) counts.parse = counts.parse + 1 return wParse(...) end
  R.Times = function(...) counts.times = counts.times + 1 return wTimes(...) end
  Ref.List = function(...) counts.list = counts.list + 1 return wList(...) end
  Ref.ForBoss = function(...) counts.forBoss = counts.forBoss + 1 return wFor(...) end
  local first = f.rows[1].name.text
  for i = 1, 5 do f.list.OnMouseWheel(f.list, -1) end
  local scrolled = f.rows[1].name.text
  click(f.rows[2].frame)
  local selected = f.panel.name.text
  Ref.Parse, R.Times, Ref.List, Ref.ForBoss = wParse, wTimes, wList, wFor
  assert(scrolled ~= first, "it scrolled")
  assert(selected == f.rows[2].name.text, "the click selected the row")
  assert(counts.parse == 0 and counts.times == 0 and counts.list == 0 and counts.forBoss == 0,
    string.format("parse %d, times %d, list %d, forBoss %d", counts.parse, counts.times, counts.list, counts.forBoss))
  -- a change to the reminders still rebuilds the list
  R:Save(ENC, nil, { text = "after the cache", boss = "Test Boss" })
  local found = false
  for _ = 1, 40 do
    for _, row in ipairs(f.rows) do if row.frame.shown and row.name.text == "after the cache" then found = true end end
    f.list.OnMouseWheel(f.list, -1)
  end
  assert(found, "a saved reminder is listed")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: boss list follows the route, with raid headings", function()
  local f = fresh()
  local o = dropdowns["Boss"].opts.options()
  assert(o[1].title and o[2].key == 5555 and o[3].key == ENC, "the route's order with its heading, not re-sorted")
  assert(dropdowns["Boss"].opts.get() == ENC, "starts on the active note's boss, wherever it sits in the route")
  dropdowns["Boss"].opts.set("raid:test")
  assert(dropdowns["Boss"].opts.get() == ENC, "a heading is never picked")
  -- the Development page reorders the route: the list follows
  route[2], route[3] = route[3], route[2]
  for _, fn in ipairs(routeFns) do fn() end
  local o2 = dropdowns["Boss"].opts.options()
  local k2, k3 = o2[2].key, o2[3].key
  local picked = dropdowns["Boss"].opts.get()
  route[2], route[3] = route[3], route[2]
  for _, fn in ipairs(routeFns) do fn() end
  assert(k2 == ENC and k3 == 5555 and picked == ENC, "a new route order is read again, the pick kept")
  -- a boss outside the library is not listed, even as the active note's boss
  activeRecord.encounterID, activeRecord.name = 4444, "Gone Boss"
  CRT.Notes:Fire()
  local onGone = dropdowns["Boss"].opts.get()
  activeRecord.encounterID, activeRecord.name = ENC, "Test Boss"
  CRT.Notes:Fire()
  assert(onGone ~= 4444, "a boss outside the library is not picked")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: a quiet save leaves no stray new row", function()
  table.insert(route, { key = 4444, label = "Gone Boss" })
  for _, fn in ipairs(routeFns) do fn() end
  activeRecord.encounterID, activeRecord.name = 4444, "Gone Boss"
  local f = fresh()
  assert(dropdowns["Boss"].opts.get() == 4444, "on the active note's boss")
  click(f.ownButton)
  typeInto(f.panel.textEdit, "Stray")
  -- that boss leaves the route, so the tab moves to another while typing waits
  table.remove(route)
  activeRecord.encounterID, activeRecord.name = ENC, "Test Boss"
  for _, fn in ipairs(routeFns) do fn() end
  assert(dropdowns["Boss"].opts.get() == ENC, "moved to another boss")
  local saved = R:List(4444)
  assert(#saved == 1 and saved[1].r.text == "Stray", "the typing was saved to its own boss")
  -- back on that boss: the saved reminder, and no empty new row
  table.insert(route, { key = 4444, label = "Gone Boss" })
  for _, fn in ipairs(routeFns) do fn() end
  dropdowns["Boss"].opts.set(4444)
  local shown = 0
  for _, row in ipairs(f.rows) do if row.frame.shown then shown = shown + 1 end end
  local firstName = f.rows[1].name.text
  table.remove(route)
  for _, fn in ipairs(routeFns) do fn() end
  CRT.db.alerts.reminders[4444] = nil
  assert(shown == 1 and firstName == "Stray", "one row, the saved one: " .. shown .. " " .. tostring(firstName))
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: names and icons loaded late show up", function()
  local f = fresh()
  local name, tex = NAMES[999], C_Spell.GetSpellTexture
  NAMES[999] = nil
  C_Spell.GetSpellTexture = function(id) if id == 999 then return nil end return tex(id) end
  R:Save(ENC, nil, { spellID = 999, boss = "Test Boss", times = "P1 0:10" })
  local row = f.rows[3]
  assert(row.name.text == "Reminder" and not row.icon.shown, "not loaded yet: " .. tostring(row.name.text))
  -- the game loads the spell
  NAMES[999], C_Spell.GetSpellTexture = name, tex
  local counts = { parse = 0, times = 0 }
  local wParse, wTimes = Ref.Parse, R.Times
  Ref.Parse = function(...) counts.parse = counts.parse + 1 return wParse(...) end
  R.Times = function(...) counts.times = counts.times + 1 return wTimes(...) end
  f.list.OnMouseWheel(f.list, -1)
  Ref.Parse, R.Times = wParse, wTimes
  assert(row.name.text == "Third Thing" and row.icon.texture == "tex999" and row.icon.shown, "healed: " .. tostring(row.name.text))
  assert(counts.parse == 0 and counts.times == 0, "still nothing parsed")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: nothing passes the page edges", function()
  local f = fresh()
  for i = 1, 30 do R:Save(ENC, nil, { text = "mine " .. i .. " with a long name that runs on and on", times = "P1 0:01", boss = "Test Boss" }) end
  CRT.NoteReminders.Refresh()
  local n = edges(f, "ability selected")
  assert(n > 40, "checked " .. n .. " pieces")
  -- the match list open under the Icon box
  typeInto(f.panel.idEdit, "other")
  assert(f.panel.lookup.shown)
  edges(f, "lookup open")
  f.panel.lookup:Hide()
  -- the panel fills the rest of the width
  rects = {}
  local pr = rect(f.panel.frame, f)
  -- the header: Alert me's label ends before Save as starts
  local am, sa = rect(f.panel.alertMe.label, f), rect(f.panel.saveAs, f)
  assert(am[3] <= sa[1], "Alert me overlaps Save as: " .. am[3] .. " > " .. sa[1])
  -- the Raid note status line under the name ends before For, which sits under Save as, in line with it
  local st, fo = rect(f.panel.noteStatus, f), rect(f.panel.forDrop, f)
  assert(st[3] <= fo[1] and fo[1] == sa[1] and fo[2] > sa[2], "status " .. st[3] .. ", For " .. fo[1] .. ", Save as " .. sa[1])
  assert(st[2] > rect(f.panel.alertMe, f)[2], "the status line is under the header")
  assert(pr[3] >= TAB_W - 12 and pr[4] >= TAB_H - 12, "the panel fills the page: " .. pr[3] .. ", " .. pr[4])
  local lr = rect(f.list, f)
  assert(lr[4] >= TAB_H - 60, "the list fills the height: " .. lr[4])
  assert(#errors == 0, tostring(errors[1]))
end)

-- CRT_Modules/Timeline/Page.lua's RehearsalSourceFor, as the window plays it: the boss's first reference for the
-- group, else nothing. sourceOverride replaces it (a recorded pull: a base with no reference).
local sourceOverride
CRT.Timeline.RehearsalSourceFor = function(self, enc, group)
  if sourceOverride then return sourceOverride end
  local list = Ref:ForGroup(Ref:ForBoss(enc), group == "mythic" and "mythic" or "nh")
  local ref = list[1] and list[1].ref
  if not ref then return nil end
  return { base = { reference = ref }, encounterID = enc, group = group, difficultyName = ref.difficulty }
end
-- The Rehearsal window's OpenAt (CRT_Modules/Timeline/RehearsalWindow.lua), mocked: every call recorded.
local opened = {}
local function mockWindow(ok, reason)
  for i = #opened, 1, -1 do opened[i] = nil end
  CRT.TimelineRehearsalWindow = { OpenAt = function(self, enc, diff, t, o)
    opened[#opened + 1] = { enc = enc, diff = diff, t = t, opts = o }
    if ok then return true end
    return false, reason
  end }
end

check("mech: test with no Show from starts at its first show moment, a Linger stops 5 s after it", function()
  local f = fresh()
  dropdowns["Difficulty"].opts.set("nh") -- the Heroic timeline's times
  local p = f.panel
  setCheck(f.rows[1].check, true)
  f.panel.showFrom.opts.set(0)
  sliders["Linger"].opts.set(6)
  mockWindow(true)
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  local c = opened[#opened]
  f.panel.showFrom.opts.set(5)
  sliders["Linger"].opts.set(0)
  assert(c and c.t == 45, "at 0:45 with no Show from: " .. tostring(c and c.t))
  assert(c.opts.stopAt == 56, "the 6 s Linger, then 5 s: " .. tostring(c.opts.stopAt))
  assert(#errors == 0, tostring(errors[1]))
end)

-- Alex's Ravenous Feast (#1159), on the bar model of #1171: Show from 8 s, Linger 0, a bar with impact ticks 4.5 and
-- 6.5 s into it that fills up. The bar runs from Show from before the cast to the cast, ticks or not; the test plays
-- from the moment it shows to 5 s after the cast and its Linger, and only around the first cast.
check("mech: a ticked bar's test plays from its bar to 5 s after the cast", function()
  local f = fresh()
  dropdowns["Difficulty"].opts.set("nh") -- the Heroic timeline's times: 0:45 first
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  f.panel.showFrom.opts.set(8)
  sliders["Linger"].opts.set(0)
  setCheck(p.checks.bar, true)
  typeInto(p.ticksEdit, "4.5, 6.5")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  p.barFill.opts.set("up")
  mockWindow(true)
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  local c = opened[#opened]
  assert(c and c.t == 37, "the moment the bar shows at 0:37: " .. tostring(c and c.t))
  -- the bar ends at the cast (0:45) and keeps the alert's half second (Linger 0), then 5 s: no tail past the ticks
  assert(c.opts.stopAt == 50.5, "5 s after the cast and its Linger: " .. tostring(c.opts.stopAt))
  local it = c.opts.alerts.extra[1]
  assert(it.barStart == -8 and it.barEnd == 0 and it.ticks[1] == -3.5 and it.ticks[2] == -1.5 and it.fill == "up" and it.barTo == nil,
    "the bar from Show from before the cast to the cast, its ticks inside it: " .. tostring(it.barStart) .. " " .. tostring(it.barEnd))
  -- a pull's items carry the same bar
  local items = R:Items(ENC, id, R:Get(ENC, id), "nh")
  assert(items[1].barStart == -8 and items[1].barEnd == 0, "a pull's bar too: " .. tostring(items[1].barStart))
  -- Show from 20, Linger 5: 20 s before the cast, then the cast, its Linger and 5 s
  f.panel.showFrom.opts.set(20)
  sliders["Linger"].opts.set(5)
  mockWindow(true)
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  c = opened[#opened]
  assert(c and c.t == 25 and c.opts.stopAt == 55, "Show from 20, Linger 5: " .. tostring(c and c.t) .. " to " .. tostring(c and c.opts.stopAt))
  -- the quick test (no window): the same window, from now
  A:Stop(true)
  timers = {}
  click(p.testBtn)
  assert(A.running and A.run.reason == "test", "a quick test")
  assert(A:PhaseStart(1) == clock + 20 - 45, "20 s to the cast: " .. tostring(A:PhaseStart(1) - clock))
  local stop
  for _, t in ipairs(timers) do if t.delay > 5 then stop = t end end
  assert(stop and stop.delay == 20 + 5 + 5, "ends 5 s after the cast and its Linger: " .. tostring(stop and stop.delay))
  A:Stop(true)
  timers = {}
  f.panel.showFrom.opts.set(5)
  sliders["Linger"].opts.set(0)
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: picking another alert ends the test in the Rehearsal", function()
  local f = fresh()
  local ended = 0
  click(f.rows[1].frame)
  CRT.TimelineRehearsalWindow = { EndTest = function() ended = ended + 1 end }
  click(f.rows[1].frame)
  assert(ended == 0, "the same row: the test goes on")
  click(f.rows[2].frame)
  CRT.TimelineRehearsalWindow = nil
  assert(ended == 1, "another row ends it: " .. ended)
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: test plays the countdown and stops 5 s after", function()
  local f = fresh()
  dropdowns["Difficulty"].opts.set("nh") -- the Heroic timeline's times
  local p = f.panel
  setCheck(f.rows[1].check, true) -- Real Name follows the reference: Heroic 0:45, Mythic 0:30 and 2:20
  mockWindow(true)
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  assert(#opened == 1, "OpenAt called once: " .. #opened)
  local c = opened[1]
  assert(c.enc == ENC and c.diff == "Heroic", "boss and difficulty: " .. tostring(c.enc) .. " " .. tostring(c.diff))
  assert(c.t == 40, "the 5 s Show from before Heroic's 0:45: " .. tostring(c.t))
  assert(c.opts.stopAt == 50.5, "ends 5 s after its half second: " .. tostring(c.opts.stopAt))
  assert(c.opts.testing == "Real Name", "Testing label: " .. tostring(c.opts.testing))
  assert(not A.running, "no quick test as well")
  assert(p.message.text == "", "no message: " .. tostring(p.message.text))
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: test passes the current draft, saved one replaced", function()
  local f = fresh()
  dropdowns["Difficulty"].opts.set("nh") -- the Heroic timeline's times
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  typeInto(p.textEdit, "Soak") -- still pending: no Enter, no pause
  mockWindow(true)
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  assert(R:Get(ENC, id).text == "Soak", "the typing is saved first")
  local o = opened[1] and opened[1].opts
  -- the times of the ability timeline the Rehearsal plays (Heroic 0:45), not another difficulty's
  assert(o and o.alerts and type(o.alerts.extra) == "table" and #o.alerts.extra == 1, "the draft's items: " .. tostring(o and o.alerts and o.alerts.extra and #o.alerts.extra))
  local it = o.alerts.extra[1]
  assert(it.text == "Soak" and it.id == "mine:test:1" and it.ph == 1 and it.time == 45, "the draft as typed, at Heroic's time: " .. tostring(it.text) .. " " .. tostring(it.time))
  assert(o.alerts.replaces and o.alerts.replaces.block == "mine" and o.alerts.replaces.id == id, "the saved one is replaced")
  assert(o.testing == "Soak", "label follows the text")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: test falls back to the quick test when the window can't open", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  mockWindow(false, "Not in combat.")
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  assert(#opened == 1, "asked the window")
  assert(A.running and A.run.reason == "test", "quick test instead")
  assert(#printed == 1 and printed[1]:find("Not in combat.", 1, true), "one chat line with the reason: " .. tostring(printed[1]))
  A:Stop(true)
  -- no window at all: the quick test, and nothing printed
  for i = #printed, 1, -1 do printed[i] = nil end
  click(p.testBtn)
  assert(A.running and A.run.reason == "test" and #printed == 0, "no window: quick test, silent")
  A:Stop(true)
  -- false with no reason: quick test, nothing printed
  mockWindow(false, nil)
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  assert(A.running and A.run.reason == "test" and #printed == 0, "no reason: quick test, silent")
  A:Stop(true)
  -- a real pull: still blocked, the window never asked
  mockWindow(true)
  A.HandleEvent("ENCOUNTER_START", ENC, "Boss", 16)
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  assert(#opened == 0 and A.run.reason == "encounter", "blocked during a pull")
  A:Stop(true)
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: test replaces a running quick test with the rehearsal", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  click(p.testBtn) -- no window yet: a quick test
  assert(A.running and A.run.reason == "test", "quick test going")
  A.run.tag = "special" -- one another Test button started: this one reads Test and opens the Rehearsal
  -- the real OpenAt stops a quick test itself, then opens; any other run still blocks it
  for i = #opened, 1, -1 do opened[i] = nil end
  CRT.TimelineRehearsalWindow = { OpenAt = function(self, enc, diff, t, o)
    opened[#opened + 1] = { t = t, reason = A.running and A.run.reason }
    if A.running and A.run.reason == "test" then A:Stop(true) end
    if A.running then return false, "Rehearsal can't start while the alerts are running a pull or a test." end
    return true
  end }
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  assert(#opened == 1 and opened[1].reason == "test", "the Test button leaves the quick test to OpenAt")
  assert(not A.running and #printed == 0, "the rehearsal opened, nothing printed: " .. tostring(printed[1]))
  assert(#errors == 0, tostring(errors[1]))
end)

-- Test becomes Stop while the quick test this button started runs (Editor:BindTest, shared with the other Test buttons)
check("mech: the Test button reads Stop while its test runs, and Stop ends it", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  CRT.TimelineRehearsalWindow = nil
  A:Stop()
  timers = {}
  assert(p.testBtn.text == "Test", "idle: Test")
  click(p.testBtn)
  assert(A.running and A.run.reason == "test", "a quick test")
  assert(p.testBtn.text == "Stop", "reads Stop: " .. tostring(p.testBtn.text))
  click(p.testBtn)
  assert(not A.running, "Stop ends the run")
  assert(p.testBtn.text == "Test", "reads Test again")
  assert(p.message.text == "", "no message")
  -- the run ending on its own
  click(p.testBtn)
  assert(p.testBtn.text == "Stop", "Stop again")
  local last = timers[#timers]
  assert(last and last.delay > 5, "the end timer")
  last.fn()
  assert(not A.running and p.testBtn.text == "Test", "the end timer puts the label back")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech: the Test button never stops a pull, a countdown or a Rehearsal", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  CRT.TimelineRehearsalWindow = nil
  A:Stop()
  -- a pull: Test stays, and the click is refused as before
  A.HandleEvent("ENCOUNTER_START", ENC, "Boss", 16)
  local pull = A.run
  assert(p.testBtn.text == "Test", "a pull going: Test")
  click(p.testBtn)
  assert(A.running and A.run == pull and p.testBtn.text == "Test", "the pull goes on")
  A:Stop()
  -- a countdown
  A:Start(ENC, "Mythic", "countdown", { firstAt = GetTime() + 10, difficultyID = 16 })
  assert(p.testBtn.text == "Test", "a countdown going: Test")
  assert(CRT.AlertEditor:StopTest("mechanics") == false and A.running and A.run.reason == "countdown", "the countdown is not this button's to stop")
  A:Stop()
  -- a Rehearsal
  A:Start(ENC, "Mythic", "rehearsal", { clock = function() return 0 end, speed = function() return 1 end })
  local rehearsal = A.run
  assert(p.testBtn.text == "Test", "a Rehearsal going: Test")
  assert(CRT.AlertEditor:StopTest("mechanics") == false and A.run == rehearsal, "the Rehearsal is not this button's to stop")
  A:Stop()
  assert(#errors == 0, tostring(errors[1]))
end)

-- Test that opens the Rehearsal: the run carries the panel button's tag, the button reads Stop, Stop closes the window
check("mech: the Test button reads Stop while its Rehearsal runs, and Stop closes it", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  A:Stop(true)
  local closed = 0
  CRT.TimelineRehearsalWindow = {
    OpenAt = function(self, enc, diff, t, o)
      opened[#opened + 1] = { t = t, opts = o }
      A:Start(enc, diff, "rehearsal", { clock = function() return 0 end, speed = function() return 1 end, tag = o.tag })
      return true
    end,
    Close = function(self) closed = closed + 1 if A:IsRehearsal() then A:Stop() end end,
  }
  for i = #opened, 1, -1 do opened[i] = nil end
  assert(p.testBtn.text == "Test", "idle: Test")
  click(p.testBtn)
  assert(#opened == 1 and opened[1].opts.tag == "mechanics", "the window is asked with the panel's tag: " .. tostring(opened[1] and opened[1].opts.tag))
  assert(A.running and A.run.reason == "rehearsal" and A.run.tag == "mechanics", "a rehearsal run with the tag")
  assert(p.testBtn.text == "Stop", "reads Stop: " .. tostring(p.testBtn.text))
  click(p.testBtn)
  assert(closed == 1 and not A.running, "Stop closes the window, the run ends")
  assert(p.testBtn.text == "Test" and p.message.text == "", "reads Test again, no message")
  -- a Rehearsal the player opened: Test stays and a click does not close it
  A:Start(ENC, "Heroic", "rehearsal", { clock = function() return 0 end, speed = function() return 1 end })
  local own = A.run
  assert(p.testBtn.text == "Test" and CRT.AlertEditor:StopTest("mechanics") == false, "an untagged Rehearsal: Test")
  assert(closed == 1 and A.run == own, "left open")
  A:Stop(true)
  CRT.TimelineRehearsalWindow = nil
  assert(#errors == 0, tostring(errors[1]))
end)

check("speak at: Mech Alerts panel has it too", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  local row = dropdowns["Speak at"]
  assert(row and p.speakAt == row, "a Speak at dropdown on the panel")
  local keys = {}
  for i, o in ipairs(row.opts.options) do keys[i] = o.key end
  assert(table.concat(keys, ",") == "show,zero" and row.opts.options[2].label == "At 0", "On show, At 0")
  assert(row.opts.get() == "show" and row.opts.enabledIf() == true, "On show, enabled")
  row.opts.set("zero")
  assert(R:Get(ENC, id).speakAt == "zero", "saved at once")
  assert(row.value == "zero", "the panel shows it")
  setCheck(p.also.speak, false)
  assert(row.opts.enabledIf() == false, "greyed with Speak the text off")
  setCheck(p.also.speak, true)
  assert(row.opts.enabledIf() == true, "back on")
  row.opts.set("show")
  assert(R:Get(ENC, id).speakAt == nil, "On show saved as nothing")
  assert(#errors == 0, tostring(errors[1]))
end)

-- Impact ticks and Bar fill on any mechanic (CRT_Modules/Alerts/Draft.lua ParseTicks; the bars draw them,
-- CRT_Modules/Alerts/Bars.lua). Ticks are seconds into the bar (from when it shows), typed with commas.
check("mech ticks: the typed ticks parse", function()
  local D = CRT.AlertDraft
  local function list(t) local out = {} for i, v in ipairs(t) do out[i] = tostring(v) end return table.concat(out, ",") end
  local t = D.ParseTicks("1.5, 3.5")
  assert(t and list(t) == "1.5,3.5", "two ticks: " .. tostring(t and list(t)))
  t = D.ParseTicks("3.5,1.5 ,  2")
  assert(t and list(t) == "1.5,2,3.5", "put in order: " .. tostring(t and list(t)))
  t = D.ParseTicks("2, 2, 0")
  assert(t and list(t) == "0,2", "the same tick once, 0 is where the bar starts: " .. tostring(t and list(t)))
  for _, empty in ipairs({ "", "   ", nil }) do
    local e, err = D.ParseTicks(empty)
    assert(e and #e == 0 and err == nil, "empty: no ticks, no problem")
  end
  local bad, err = D.ParseTicks("1.5, soon")
  assert(bad == nil and type(err) == "string" and err:find("soon", 1, true), "a word: " .. tostring(err))
  bad, err = D.ParseTicks("-1, 2")
  assert(bad == nil and err:find("-1", 1, true) and err:find("into the bar", 1, true), "below 0: " .. tostring(err))
  bad, err = D.ParseTicks("1e3")
  assert(bad == nil and err, "only plain seconds")
  assert(D.TicksText({ 1.5, 3.5 }) == "1.5, 3.5" and D.TicksText(nil) == nil and D.TicksText({}) == nil, "back to text")
end)

check("mech ticks: the rows follow Bar and the ticks", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  assert(p.ticksEdit and p.ticksEdit.kind == "EditBox", "an Impact ticks box")
  assert(p.ticksLabel.text == "Impact ticks" and p.ticksUnit.text == "s into the bar", "its words: " .. tostring(p.ticksUnit.text))
  assert(p.barFill and p.barFill.label == "Bar fill", "the Bar fill dropdown")
  assert(p.barTo == nil and dropdowns["Bar ends"] == nil, "no Bar ends row: a ticked bar always ends at the cast")
  local function keys(row) local out = {} for i, o in ipairs(row.opts.options) do out[i] = o.key .. "=" .. o.label end return table.concat(out, ",") end
  assert(keys(p.barFill) == "up=Bar fills up,down=Bar empties", keys(p.barFill))
  local helped
  for _, h in ipairs(helps) do if h.helpTitle == "Impact ticks" then helped = h end end
  assert(helped and helped.helpText:find("thin line", 1, true) and helped.helpText:find("Only me", 1, true), "a (?) on the ticks")
  assert(not helped.helpText:find("Bar ends", 1, true) and not helped.helpText:find("1 s past", 1, true)
    and helped.helpText:find("Seconds after the bar appears when each hit lands. The bar runs from Show from to the cast; a tick past its end isn't shown.", 1, true),
    "its (?) says ticks are in the bar, which ends at the cast: " .. helped.helpText)
  -- Count down to under Bar fill on Looks; the Shield bar section at the top of its own tab; Speak the text, Count down
  -- and Glow one under the other on Sound and speech; a save's problem above the bottom row, on every tab
  local function y(fr) local pt = fr.pts[#fr.pts] return pt[#pt] end
  local function x(fr) local pt = fr.pts[#fr.pts] return pt[#pt - 1] end
  assert(y(p.barFill) - y(p.countTo) == 22, "Count down to under Bar fill")
  assert(y(p.shield.check) == -100 and p.shield.check.parent == p.tabs.frames.shield, "Shield bar at the top of its tab: " .. y(p.shield.check))
  assert(y(p.also.speak) - y(p.also.count) == 26 and y(p.also.count) - y(p.also.glow) == 26 and x(p.also.speak) < 20, "Sound and speech's rows, one column")
  assert(p.message.pts[1][1] == "BOTTOMLEFT" and p.message.parent == p.content, "the message above the bottom row, outside the tabs")
  -- a new alert has Bar on: ticks and Bar fill on
  assert(p.checks.bar.checked, "Bar on")
  assert(p.ticksEdit.enabled and p.barFill.opts.enabledIf() == true, "on with Bar")
  assert(p.barFill.opts.get() == "down", "Bar empties, as bars always did")
  -- Bar off: both grey out
  setCheck(p.checks.bar, false)
  assert(not p.ticksEdit.enabled and p.barFill.opts.enabledIf() == false, "greyed with Bar off")
  local grey = p.ticksLabel.textColor
  assert(grey and grey[1] == 0.5, "the label greyed")
  setCheck(p.checks.bar, true)
  assert(p.ticksEdit.enabled and p.ticksLabel.textColor[1] ~= 0.5, "back on")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech ticks: saved with the reminder, bad ones not", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  typeInto(p.ticksEdit, "3.5, 1.5")
  assert(R:Get(ENC, id).ticks == nil, "not saved per key")
  runTimers()
  local r = R:Get(ENC, id)
  assert(r.ticks and #r.ticks == 2 and r.ticks[1] == 1.5 and r.ticks[2] == 3.5, "saved in order after the pause")
  p.barFill.opts.set("up")
  assert(R:Get(ENC, id).fill == "up", "Bar fills up saved")
  assert(R:Get(ENC, id).barTo == nil, "no bar end saved")
  p.barFill.opts.set("down")
  assert(R:Get(ENC, id).fill == nil, "Bar empties, the default, saved as nothing")
  p.barFill.opts.set("up")
  -- a bad tick: said in red, nothing saved
  typeInto(p.ticksEdit, "1.5, -2")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  assert(p.message.text:find("|cff" .. CRT.UI.Hex("bad"), 1, true) and p.message.text:find("-2", 1, true), "red line: " .. tostring(p.message.text))
  r = R:Get(ENC, id)
  assert(#r.ticks == 2 and r.ticks[1] == 1.5, "the last good ticks kept")
  typeInto(p.ticksEdit, "2")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  assert(p.message.text == "" and #R:Get(ENC, id).ticks == 1, "fixed: saved, the message gone")
  -- the panel shows them again when the row is loaded afresh (a /reload)
  click(f.rows[2].frame)
  click(f.rows[1].frame)
  assert(p.ticksEdit.text == "2" and p.barFill.opts.get() == "up", "loaded back: " .. tostring(p.ticksEdit.text))
  -- emptied: no ticks saved at all
  typeInto(p.ticksEdit, "")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  assert(R:Get(ENC, id).ticks == nil, "empty: no ticks field")
  assert(#errors == 0, tostring(errors[1]))
end)

-- A reminder whose bar is a shield bar: the Shield bar section (Alerts/ShieldSection.lua, the alert editor's) on the
-- panel, in place of the ticks, Bar fill and Count down to, and a change on the panel keeps it
check("mech shield: a shield bar hides ticks and fill, and every save keeps it", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  R:Get(ENC, id).absorb = { unit = "boss2", length = 15, anyDifficulty = true }
  click(f.rows[2].frame)
  click(f.rows[1].frame)
  local s = p.shield
  assert(s.check.checked and s.unitRow.opts.get() == "boss2" and s.lengthRow.opts.get() == 15 and s.any.checked, "the section shows it")
  assert(not p.ticksEdit.shown and not p.ticksLabel.shown and not p.barFill.shown and not p.countTo.shown, "no ticks, Bar fill or Count down to")
  p.showFrom.opts.set(8)
  local r = R:Get(ENC, id)
  assert(r.warn == 8 and r.absorb and r.absorb.unit == "boss2" and r.absorb.length == 15, "a change on the panel keeps the shield bar")
  -- another row with none: the bar's rows are back
  r.absorb = nil
  click(f.rows[2].frame)
  click(f.rows[1].frame)
  assert(not s.check.checked and p.ticksEdit.shown and p.barFill.shown, "none: the rows are back")
  assert(#errors == 0, tostring(errors[1]))
end)

-- The Shield bar section on the Mechanics panel: the editor's controls (one shared builder), greyed while Bar is off and
-- its rows while Shield bar is unticked; a change makes the ability's reminder (off, as every first change does) and
-- saves its absorb, which shields every cast of the ability
check("mech shield: the Shield bar section makes and saves the reminder's absorb", function()
  local f = fresh()
  local p = f.panel
  local s = assert(p.shield, "the section")
  assert(s.opts.layout == "column" and s.note and s.note.text == "every cast above, plus any shield between them", "the column, with its note: " .. tostring(s.note and s.note.text))
  assert(s.check.label.text == "Shield bar" and s.help.helpTitle == "Shield bar" and s.any.label.text == "Any time it goes up" and s.anyHelp, "the editor's controls and (?)s")
  assert(s.unitRow.label == "Shield on" and s.lengthRow.label == "Seconds to break" and s.lengthRow.opts.min == 3 and s.lengthRow.opts.max == 60, "Shield on, 3 to 60 s")
  assert(s.default == nil, "no Default on Mechanics")
  assert(#R:List(ENC) == 0 and not s.check.checked and s.check.enabled, "unticked, Bar on: it can be ticked")
  assert(not s.unitRow.opts.enabledIf() and not s.lengthRow.opts.enabledIf() and not s.any.enabled, "its rows wait for Shield bar")
  -- Bar off greys the section; on again it can be ticked
  setCheck(p.checks.bar, false)
  local _, id = only() -- the change made the reminder
  assert(not s.check.enabled and not s.unitRow.opts.enabledIf(), "Bar off: greyed")
  setCheck(p.checks.bar, true)
  -- tick it: saved at once, Boss 1, 15 s, Any time on
  setCheck(s.check, true)
  local r = R:Get(ENC, id)
  assert(r.absorb and r.absorb.unit == "boss1" and r.absorb.length == 15 and r.absorb.anyDifficulty == true, "ticked: saved")
  assert(r.enabled == false, "made off, as every first change on an ability")
  assert(s.unitRow.opts.enabledIf() and s.lengthRow.opts.enabledIf() and s.any.enabled, "its rows with it")
  s.unitRow.opts.set("boss2")
  s.lengthRow.opts.set(20)
  setCheck(s.any, false)
  r = R:Get(ENC, id)
  assert(r.absorb.unit == "boss2" and r.absorb.length == 20 and r.absorb.anyDifficulty == false, "each change saved")
  -- every cast of the ability carries it
  local items = R:Items(ENC, id, r, "mythic")
  assert(#items == 2 and items[1].absorb.unit == "boss2" and items[2].absorb.length == 20 and items[1].ticks == nil, "both casts shield: " .. #items)
  -- unticked: no absorb, the pick kept for a tick back
  setCheck(s.check, false)
  assert(R:Get(ENC, id).absorb == nil and s.unitRow.opts.get() == "boss2", "unticked: none saved, the pick kept")
  setCheck(s.check, true)
  assert(R:Get(ENC, id).absorb.unit == "boss2" and R:Get(ENC, id).absorb.length == 20, "ticked back as it was")
  -- reloaded from the store (a /reload)
  click(f.rows[2].frame)
  click(f.rows[1].frame)
  assert(s.check.checked and s.unitRow.opts.get() == "boss2" and s.lengthRow.opts.get() == 20 and not s.any.checked, "read back")
  assert(#errors == 0, tostring(errors[1]))
end)

-- Last pull on the Mechanics panel: each boss unit's shield starts on the boss's last pull, with Use
check("mech shield: Last pull with its Use buttons", function()
  local f = fresh()
  local s = f.panel.shield
  CRT.db.alerts.shieldPulls = { [ENC] = { at = 1, units = { boss3 = 30 }, times = { boss3 = { 30, 90.5 } } } }
  CRT.NoteReminders.Refresh()
  assert(s.lastText.shown and s.lastText.text == "Last pull: Boss 3 shield at 0:30.0, 1:30.5", "the line: " .. tostring(s.lastText.text))
  assert(s.use[1].shown and s.use[1].text == "Use Boss 3" and not s.use[1].enabled, "Use Boss 3, greyed until Shield bar is ticked")
  setCheck(s.check, true)
  assert(s.use[1].enabled, "enabled with it")
  click(s.use[1])
  local r = only()
  assert(r.absorb.unit == "boss3", "Use picks Boss 3 and saves it")
  CRT.db.alerts.shieldPulls = nil
  assert(#errors == 0, tostring(errors[1]))
end)

-- The Mechanics panel's layout with the section, on its Shield bar tab: Any time beside Shield on, Last pull on a row of
-- its own; inside the panel, above the bottom row, overlapping nothing on show
check("mech shield: the section fits its tab, clear of the marker tick and the buttons", function()
  local f = fresh()
  local p = f.panel
  click(p.tabs.buttons.shield)
  CRT.db.alerts.shieldPulls = { [ENC] = { at = 1, units = { boss1 = 10, boss2 = 20, boss3 = 30 } } }
  CRT.NoteReminders.Refresh()
  local s = p.shield
  rects = {}
  local pr = rect(p.frame, f)
  local function top(m) return rect(m, f)[2] end
  assert(top(s.any) == top(s.unitRow) and rect(s.any, f)[1] >= rect(s.unitRow, f)[3], "Any time beside Shield on")
  assert(top(s.lastText) > top(s.lengthRow) + 20 and rect(s.lastText, f)[1] == rect(s.check, f)[1], "Last pull on its own row, under Seconds to break")
  assert(s.use[1].shown and s.use[2].shown and s.use[3].shown, "a Use button for each of three units")
  local parts = { s.check, s.unitRow, s.lengthRow, s.any, s.lastText, s.note }
  for _, b in ipairs(s.use) do if b.shown then parts[#parts + 1] = b end end
  local others = { p.testBtn, p.templateBtn, p.deleteBtn }
  local function overlap(a, b) return a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5 and a[2] < b[4] - 0.5 and b[2] < a[4] - 0.5 end
  -- a dropdown or slider row is 32 high (UI.CONTROL_ROW_H) with its control about 20 high in its middle
  local function box(m) local r = rect(m, f) if rawget(m, "opts") then return { r[1], r[2] + 6, r[3], r[4] - 6 } end return r end
  for _, part in ipairs(parts) do
    local r = rect(part, f)
    assert(r[1] >= pr[1] and r[3] <= pr[3] - 12 + 0.5, "inside the panel: " .. tostring(part.label or part.text) .. " " .. r[1] .. ".." .. r[3])
    assert(r[4] <= pr[4] - 10 - 24 - 1, "above the bottom row (the marker tick and the buttons): " .. tostring(part.label or part.text) .. " " .. r[4])
    for _, o in ipairs(others) do
      assert(not overlap(box(part), box(o)), tostring(part.label or part.text) .. " overlaps " .. tostring(o.label or o.text))
    end
  end
  edges(f, "mechanics with the shield section")
  TEXT_SCALE = 1.75
  CRT.NoteReminders.Refresh()
  edges(f, "mechanics with the shield section, large text")
  TEXT_SCALE = nil
  CRT.db.alerts.shieldPulls = nil
  assert(#errors == 0, tostring(errors[1]))
end)

-- The panel's subtabs (Alerts/SubTabs.lua): When, Looks, Sound and speech, Shield bar under the header, at the approved
-- mock-up's sizes, each holding its controls; one tab's controls on show at a time; Test and Save as template on every
-- tab; a dot on a tab while something on it is on; the tab stays when another row is picked.
local SUBTABS = { "when", "looks", "sound", "shield" }
local function onTab(p)
  local s = p.shield
  return {
    when = { p.showFrom, p.linger, p.times, p.timesEdit, p.timelineBtn },
    looks = { p.checks.alert, p.checks.text, p.checks.icon, p.checks.bar, p.checks.circle, p.checks.timeline, p.textEdit,
      p.iconType, p.idEdit, p.colorSwatch, p.colorDefault, p.colorLabel, p.barFill, p.countTo, p.ticksEdit, p.ticksLabel },
    sound = { p.sound, p.auraSound, p.also.speak, p.speakAt, p.also.count, p.also.glow },
    shield = { s.check, s.unitRow, s.lengthRow, s.any, s.lastText },
  }
end
local function visibleIn(m, root) local x = m while x and x ~= root do if not x.shown then return false end x = x.parent end return x == root end

check("mech subtabs: four tabs under the header, in order, at the mock-up's sizes", function()
  local f = fresh()
  local p = f.panel
  local t = p.tabs
  assert(t and table.concat(t.keys, ",") == table.concat(SUBTABS, ","), "the four tabs, in order: " .. tostring(t and table.concat(t.keys, ",")))
  local labels, x = {}, 12
  for i, key in ipairs(t.keys) do
    local b = t.buttons[key]
    labels[i] = b.text.text
    local pt = b.pts[#b.pts]
    assert(b.parent == p.content and pt[1] == "TOPLEFT" and pt[2] == x and pt[3] == -66, key .. " at " .. tostring(pt[2]) .. ", " .. tostring(pt[3]))
    assert(b.h == 24 and b.w == (key == "sound" and 150 or 118), key .. " is " .. tostring(b.w) .. " x " .. tostring(b.h))
    x = x + b.w + 4
  end
  assert(table.concat(labels, ",") == "When,Looks,Sound and speech,Shield bar", table.concat(labels, ","))
  -- the rule under them, the header above them
  assert(t.rule and t.rule.pts[1][3] == -90, "a rule under the tabs")
  rects = {}
  local tabTop = rect(t.buttons.when, f)[2]
  -- a dropdown row is 32 high (UI.CONTROL_ROW_H) with its control about 20 high in its middle
  local function bottom(m) return rect(m, f)[4] - (rawget(m, "opts") and 6 or 0) end
  for _, m in ipairs({ p.forDrop, p.saveAs, p.alertMe, p.noteStatus, p.name, p.icon }) do
    assert(m.parent == p.content, "the header stays outside the tabs: " .. tostring(m.label or m.text))
    assert(bottom(m) <= tabTop + 0.5, "above the tabs: " .. tostring(m.label or m.text) .. " ends at " .. bottom(m) .. ", the tabs start at " .. tabTop)
  end
  -- each control is built into its own tab's frame
  for key, list in pairs(onTab(p)) do
    for i, m in ipairs(list) do
      assert(m.parent == t.frames[key], key .. " control " .. i .. " (" .. tostring(rawget(m, "label") or rawget(m, "text")) .. ") on its tab")
    end
  end
  -- Test, Save as template and the message stay outside the tabs
  for _, m in ipairs({ p.testBtn, p.templateBtn, p.message }) do assert(m.parent == p.content, "outside the tabs: " .. tostring(m.text)) end
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech subtabs: one tab's controls on show, Test and Save as template on every tab, nothing overlapping", function()
  local f = fresh()
  local p = f.panel
  local list = onTab(p)
  local function overlap(a, b) return a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5 and a[2] < b[4] - 0.5 and b[2] < a[4] - 0.5 end
  local function box(m) local r = rect(m, f) if rawget(m, "opts") then return { r[1], r[2] + 6, r[3], r[4] - 6 } end return r end
  for _, key in ipairs(SUBTABS) do
    click(p.tabs.buttons[key])
    assert(p.tabs:Current() == key and p.tabs.buttons[key].tabSelected == true, key .. " selected")
    for other, ctrls in pairs(list) do
      for i, m in ipairs(ctrls) do
        local want = other == key
        -- a control the tab itself hides (the times box while the timeline has times) only counts when it shows
        if want then
          assert(visibleIn(m.parent, f), key .. ": control " .. i .. "'s tab on show")
        else
          assert(not visibleIn(m, f), key .. ": " .. other .. " control " .. i .. " hidden")
        end
      end
    end
    assert(visibleIn(p.testBtn, f) and visibleIn(p.templateBtn, f), key .. ": Test and Save as template on show")
    -- the tab's controls, the header and the bottom row: none overlapping another
    rects = {}
    local shown = { p.saveAs, p.forDrop, p.alertMe, p.testBtn, p.templateBtn, p.tabs.buttons.when, p.tabs.buttons.shield }
    for _, m in ipairs(list[key]) do if visibleIn(m, f) then shown[#shown + 1] = m end end
    for i = 1, #shown do
      for j = i + 1, #shown do
        assert(not overlap(box(shown[i]), box(shown[j])), key .. ": " .. tostring(rawget(shown[i], "label") or rawget(shown[i], "text")) .. " overlaps "
          .. tostring(rawget(shown[j], "label") or rawget(shown[j], "text")))
      end
    end
    edges(f, key .. " tab")
  end
  click(p.tabs.buttons.when)
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech subtabs: a tab's dot follows its settings", function()
  local f = fresh()
  local p = f.panel
  local dots = p.tabs.buttons
  setCheck(f.rows[1].check, true)
  local _, id = only()
  assert(not dots.when.dot.shown, "When has no dot")
  -- Shield bar: only while the shield bar is on
  assert(not dots.shield.dot.shown, "no shield bar, no dot")
  setCheck(p.shield.check, true)
  assert(R:Get(ENC, id).absorb ~= nil and dots.shield.dot.shown, "Shield bar on: its dot")
  setCheck(p.shield.check, false)
  assert(R:Get(ENC, id).absorb == nil and not dots.shield.dot.shown, "Shield bar off: the dot goes")
  -- Sound and speech: a new alert speaks its text
  assert(dots.sound.dot.shown, "Speak the text on: a dot")
  setCheck(p.also.speak, false)
  assert(not dots.sound.dot.shown, "nothing on Sound and speech: no dot")
  setCheck(p.also.glow, true)
  assert(dots.sound.dot.shown, "Glow at 0: a dot")
  setCheck(p.also.glow, false)
  p.sound.opts.set("READY_CHECK")
  assert(dots.sound.dot.shown, "a sound: a dot")
  p.sound.opts.set(CRT.AlertDraft.NO_SOUND)
  assert(not dots.sound.dot.shown, "no sound: no dot")
  -- Looks: while a Show as box is ticked
  assert(dots.looks.dot.shown, "Show as ticked: a dot")
  for _, k in ipairs(CRT.AlertDraft.SHOW_KEYS) do if p.checks[k].checked then setCheck(p.checks[k], false) end end
  assert(not dots.looks.dot.shown, "nothing shown: no dot")
  -- a tab with its dot stays at least as wide as its label, the dot and the padding
  local b = dots.sound
  assert(b.dot.pts[1][1] == "LEFT" and b.dot.pts[1][2] == b.text and b.dot.pts[1][3] == "RIGHT", "the dot after the label")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech subtabs: the tab stays when another row or boss is picked, and for the session", function()
  local f = fresh()
  local p = f.panel
  click(p.tabs.buttons.sound)
  click(f.rows[2].frame)
  assert(p.tabs:Current() == "sound" and p.tabs.frames.sound.shown and not p.tabs.frames.when.shown, "another row: still Sound and speech")
  dropdowns["Boss"].opts.set(5555)
  dropdowns["Boss"].opts.set(ENC)
  assert(p.tabs:Current() == "sound", "another boss and back: still Sound and speech")
  CRT.NoteReminders.Refresh()
  assert(p.tabs:Current() == "sound", "a redraw keeps it")
  -- the tab built again (a /reload is a new session): the session's pick
  local g = fresh()
  assert(g.panel.tabs:Current() == "sound" and g.panel.tabs.frames.sound.shown, "built again: the tab picked last")
  click(g.panel.tabs.buttons.when)
  assert(CRT.AlertSubTabs.Picked("mechanics") == "when", "remembered")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech subtabs: another tab saves what was typed, lets go of the boxes and closes the lookup", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  click(p.tabs.buttons.looks)
  typeInto(p.textEdit, "Soak it")
  assert(R:Get(ENC, id).text == "Real Name", "not saved while typing")
  click(p.tabs.buttons.when)
  assert(R:Get(ENC, id).text == "Soak it", "saved on leaving the tab: " .. tostring(R:Get(ENC, id).text))
  assert(not p.textEdit:HasFocus(), "the Text box let go")
  click(p.tabs.buttons.looks)
  -- the lookup open, then another tab: closed when Looks shows again
  typeInto(p.idEdit, "other")
  assert(p.lookup.shown, "the lookup open")
  click(p.tabs.buttons.sound)
  assert(not p.idEdit:HasFocus(), "the Icon box let go")
  click(p.tabs.buttons.looks)
  assert(not p.lookup.shown, "closed on coming back to Looks")
  assert(p.idEdit.text == "777", "the ID back in the box: " .. tostring(p.idEdit.text))
  click(p.tabs.buttons.when)
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech subtabs: greying follows a change made on another tab", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  -- Speak the text off on Sound and speech: Speak at greys, still after going to another tab and back
  click(p.tabs.buttons.sound)
  assert(p.speakAt.opts.enabledIf() == true, "Speak at on with Speak the text")
  setCheck(p.also.speak, false)
  click(p.tabs.buttons.when)
  click(p.tabs.buttons.sound)
  assert(p.speakAt.opts.enabledIf() == false, "Speak at greyed")
  setCheck(p.also.speak, true)
  -- Bar off on Looks: the Shield bar tab's section greys
  click(p.tabs.buttons.shield)
  assert(p.shield.check.enabled == true, "Shield bar on with Bar")
  click(p.tabs.buttons.looks)
  setCheck(p.checks.bar, false)
  click(p.tabs.buttons.shield)
  assert(p.shield.check.enabled == false and p.shield.unitRow.opts.enabledIf() == false, "Shield bar greyed with Bar off on Looks")
  click(p.tabs.buttons.looks)
  setCheck(p.checks.bar, true)
  click(p.tabs.buttons.shield)
  assert(p.shield.check.enabled == true, "back on")
  click(p.tabs.buttons.when)
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech subtabs: a tab for one host only stays out of the others", function()
  local list = {}
  for i, e in ipairs(CRT.AlertSubTabs.LIST) do list[i] = e end
  list[#list + 1] = { key = "assign", label = "Assign", width = 118, hosts = { mechanics = true } }
  local panelStrip = CRT.AlertSubTabs.Build(mock("Frame"), { owner = "mechanics", x = 12, y = -66, list = list })
  local editorStrip = CRT.AlertSubTabs.Build(mock("Frame"), { owner = "editor", x = 16, y = -82, list = list })
  assert(table.concat(panelStrip.keys, ",") == "when,looks,sound,shield,assign", "the panel has it")
  assert(table.concat(editorStrip.keys, ",") == "when,looks,sound,shield" and editorStrip.buttons.assign == nil and editorStrip.frames.assign == nil,
    "the editor hasn't: " .. table.concat(editorStrip.keys, ","))
  -- the editor's strip fits its 600 px window (16 in from each side)
  assert(16 + editorStrip:Layout() <= 600 - 16, "the editor strip fits: " .. editorStrip:Layout())
  -- the panel's five fit the panel (748 wide, 12 in from each side)
  assert(12 + panelStrip:Layout() <= 748 - 12, "the panel strip fits: " .. panelStrip:Layout())
  click(panelStrip.buttons.when) -- the session's pick back on When
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech subtabs: a fifth tab is one more entry in the list", function()
  local list = {}
  for i, e in ipairs(CRT.AlertSubTabs.LIST) do list[i] = e end
  list[#list + 1] = { key = "assign", label = "Assign", width = 118, on = function() return true end }
  local host = mock("Frame")
  local s = CRT.AlertSubTabs.Build(host, { owner = "fifth", x = 12, y = -66, list = list })
  assert(table.concat(s.keys, ",") == "when,looks,sound,shield,assign", table.concat(s.keys, ","))
  local b = s.buttons.assign
  assert(b.pts[1][2] == 12 + 118 + 4 + 118 + 4 + 150 + 4 + 118 + 4 and b.w == 118, "after the others: " .. tostring(b.pts[1][2]))
  assert(s.buttons.when.w == 118 and s.buttons.sound.w == 150, "the others unchanged")
  assert(s.frames.assign and not s.frames.assign.shown and s:Current() == "when", "its frame, hidden until picked")
  s:Paint({ show = {} })
  assert(b.dot.shown, "its own dot")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech ticks: Count down to, the cast or each impact", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  local c = p.countTo
  assert(c and c.label == "Count down to", "a Count down to dropdown")
  local out = {}
  for i, o in ipairs(c.opts.options) do out[i] = o.key .. "=" .. o.label end
  assert(table.concat(out, ",") == "cast=The cast,impact=Each impact", table.concat(out, ","))
  local helped
  for _, h in ipairs(helps) do if h.helpTitle == "Count down to" then helped = h end end
  assert(helped and helped.helpText == "What the bar's number counts down to: the end of the cast, or the next hit.", "its (?)")
  -- greyed without ticks, on with them
  assert(c.opts.enabledIf() == false, "greyed with no ticks")
  assert(c.opts.get() == "cast", "The cast, by default")
  typeInto(p.ticksEdit, "1.5, 3.5")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  assert(c.opts.enabledIf() == true, "on with ticks")
  setCheck(p.checks.bar, false)
  assert(c.opts.enabledIf() == false, "greyed with Bar off")
  setCheck(p.checks.bar, true)
  assert(R:Get(ENC, id).countTo == nil, "the default is saved as nothing")
  c.opts.set("impact")
  assert(R:Get(ENC, id).countTo == "impact", "Each impact saved")
  local r = R:Get(ENC, id)
  for _, it in ipairs(R:Items(ENC, id, r, R.GroupOf(r))) do
    assert(it.countTo == "impact", "each item carries it")
  end
  click(f.rows[2].frame)
  click(f.rows[1].frame)
  assert(c.opts.get() == "impact", "loaded back")
  c.opts.set("cast")
  assert(R:Get(ENC, id).countTo == nil, "The cast saved as nothing")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech ticks: an older reminder gains no fields", function()
  local f = fresh()
  local p = f.panel
  local id = R:Save(ENC, nil, { spellID = 777, boss = "Test Boss", text = "Old one", group = "mythic", outputs = { bar = true, alert = true } })
  click(f.rows[1].frame)
  assert(p.ticksEdit.text == "" and p.barFill.opts.get() == "down", "the defaults on show")
  p.showFrom.opts.set(7)
  local r = R:Get(ENC, id)
  assert(r.warn == 7 and r.ticks == nil and r.fill == nil and r.barTo == nil, "a change elsewhere adds no tick fields")
  local items = R:Items(ENC, id, r, "mythic")
  assert(#items > 0, "it has items")
  for _, it in ipairs(items) do
    assert(it.ticks == nil and it.fill == nil and it.barTo == nil, "a plain bar, as before")
  end
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech ticks: a run and a Test carry them onto the items", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  typeInto(p.ticksEdit, "1.5, 3.5")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  p.barFill.opts.set("up")
  local r = R:Get(ENC, id)
  -- Reminders:Items, which the block of your reminders runs on
  local items = R:Items(ENC, id, r, R.GroupOf(r))
  assert(#items > 0, "items")
  for _, it in ipairs(items) do
    assert(it.ticks and #it.ticks == 2 and it.ticks[2] == -1.5 and it.fill == "up" and it.barTo == nil, "each item has them, as seconds from the cast")
  end
  assert(items[1].ticks ~= items[2].ticks and items[1].ticks ~= r.ticks, "each its own copy")
  -- a pull of the boss
  A:Start(ENC, r.group == "mythic" and "Mythic" or "Heroic", "encounter")
  local got
  for _, it in ipairs(A.items) do if it.id == "mine:" .. id .. ":1" then got = it end end
  A:Stop(true)
  assert(got and got.ticks and got.ticks[1] == -3.5 and got.fill == "up" and got.barTo == nil, "the run's item")
  -- the panel's Test (a quick test, no Rehearsal window)
  click(p.testBtn)
  assert(A.running and A.run.reason == "test", "a test run")
  got = nil
  for _, it in ipairs(A.items) do if it.id == "mine:test:1" then got = it end end
  A:Stop(true)
  assert(got and got.ticks and #got.ticks == 2 and got.fill == "up" and got.barTo == nil, "the test's item")
  assert(#errors == 0, tostring(errors[1]))
end)

-- #1171: ticks are seconds into the bar, which runs from Show from before the cast to the cast whatever the ticks.
-- A tick at or past the bar's end (or under 0) is not drawn and never moves the bar; the panel says so under the
-- box, the reminder still saves, and a longer Show from can make it fit.
check("mech ticks: inside a bar that ends at the cast, never extending it", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  local _, id = only()
  p.showFrom.opts.set(5)
  typeInto(p.ticksEdit, "2, 4")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  local r = R:Get(ENC, id)
  assert(r.ticks and r.ticks[1] == 2 and r.ticks[2] == 4, "saved as typed: seconds into the bar")
  local it = R:Items(ENC, id, r, R.GroupOf(r))[1]
  assert(it.barStart == -5 and it.barEnd == 0, "from 5 s before the cast to the cast: " .. tostring(it.barStart) .. " " .. tostring(it.barEnd))
  assert(#it.ticks == 2 and it.ticks[1] == -3 and it.ticks[2] == -1, "2 and 4 s in: 3 and 1 s before the cast")
  assert(p.message.text == "", "both fit: no message")
  -- 6 is past the 5 s bar: not drawn, said under the box, still saved
  typeInto(p.ticksEdit, "2, 6")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  r = R:Get(ENC, id)
  assert(r.ticks and #r.ticks == 2 and r.ticks[2] == 6, "the tick past the bar still saves")
  it = R:Items(ENC, id, r, R.GroupOf(r))[1]
  assert(it.barStart == -5 and it.barEnd == 0 and #it.ticks == 1 and it.ticks[1] == -3, "only the 2 s tick, the bar unchanged")
  assert(p.message.text:find("6 is past the 5 s bar and won't show", 1, true), "said under the box: " .. tostring(p.message.text))
  -- 5 is the bar's end: not drawn either
  typeInto(p.ticksEdit, "2, 5")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  it = R:Items(ENC, id, R:Get(ENC, id), R.GroupOf(r))[1]
  assert(#it.ticks == 1 and p.message.text:find("5 is past the 5 s bar", 1, true), "a tick on the end isn't drawn: " .. tostring(p.message.text))
  -- every tick past the bar: a plain bar, as with no ticks
  typeInto(p.ticksEdit, "6, 7")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  it = R:Items(ENC, id, R:Get(ENC, id), R.GroupOf(r))[1]
  assert(it.ticks == nil and it.barStart == nil and it.barEnd == nil, "nothing drawn: a plain bar")
  assert(p.message.text:find("6, 7 are past the 5 s bar and won't show", 1, true), "both named: " .. tostring(p.message.text))
  -- Show from 8: 6 fits, and the message goes
  typeInto(p.ticksEdit, "2, 6")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  p.showFrom.opts.set(8)
  r = R:Get(ENC, id)
  it = R:Items(ENC, id, r, R.GroupOf(r))[1]
  assert(it.barStart == -8 and it.barEnd == 0 and #it.ticks == 2 and it.ticks[1] == -6 and it.ticks[2] == -2, "2 and 6 s into an 8 s bar")
  assert(p.message.text == "", "the message goes: " .. tostring(p.message.text))
  -- back to 5: said again
  p.showFrom.opts.set(5)
  assert(p.message.text:find("6 is past the 5 s bar", 1, true), "Show from re-checks: " .. tostring(p.message.text))
  -- Bar off: no bar, nothing to say
  setCheck(p.checks.bar, false)
  assert(p.message.text == "", "no bar, no message: " .. tostring(p.message.text))
  setCheck(p.checks.bar, true)
  assert(#errors == 0, tostring(errors[1]))
end)

-- A reminder saved with the old Bar ends At the cast (barTo = "cast") keeps the field, but it is ignored: its items
-- have their ticks inside the bar, as every reminder's; a save from the panel leaves the field as it was.
check("mech ticks: an old At the cast reminder now shows its ticks", function()
  local f = fresh()
  local p = f.panel
  local id = R:Save(ENC, nil, { spellID = 777, boss = "Test Boss", text = "Old cast", group = "mythic", outputs = { bar = true, alert = true },
    ticks = { 1, 2 }, barTo = "cast" })
  local items = R:Items(ENC, id, R:Get(ENC, id), "mythic")
  assert(#items > 0, "it has items")
  for _, it in ipairs(items) do
    assert(it.ticks and #it.ticks == 2 and it.barTo == nil, "ticks, no bar end on the item")
  end
  click(f.rows[1].frame)
  p.showFrom.opts.set(7)
  local r = R:Get(ENC, id)
  assert(r.warn == 7 and r.barTo == "cast", "the stored field stays")
  assert(#errors == 0, tostring(errors[1]))
end)

-- Each ability's name in its main type's colour (Reference.ABILITY_TYPES, found as alerts find it: your label, the
-- ability timeline's row, the Journal's icons), dimmed when its reminder is off, lifted on the selected row so it
-- reads on the highlight; no type keeps the text colour. Hovering a name lists its types, the main one first.
check("mech: ability names in their type colour, with a type tooltip", function()
  local T, Ref = CRT.Timeline, CRT.TimelineReference
  local said = {}
  GameTooltip = setmetatable({}, { __index = function(_, k)
    return function(_, a, r, g, b) said[#said + 1] = { k, a, r and { r, g, b } } end end })
  journalRows[2].tags = { "tank", "magic", "mythic" }
  CRT.TimelineJournal.CachedRows = function(_, id) if id == ENC then return journalRows end end
  T:SetAbility(ENC, 777, "type", "soak")
  local f = fresh()
  R:Save(ENC, nil, { text = "mine", times = "P1 0:10", boss = "Test Boss" })
  setCheck(f.rows[2].check, true)
  CRT.NoteReminders.Refresh()
  local r1, r2, r3 = f.rows[1], f.rows[2], f.rows[3]
  local soak, dispel, text = Ref.TYPES.soak.color, Ref.TYPES.dispel.color, CRT.PALETTE.text
  local function near(c, w) return c and math.abs(c[1] - w[1]) < 1e-6 and math.abs(c[2] - w[2]) < 1e-6 and math.abs(c[3] - w[3]) < 1e-6 end
  assert(r2.name.text == "Other Spell" and r2.check.checked and not r2.sel.shown, "Other Spell: ticked, not selected")
  assert(near(r2.name.textColor, dispel), "a magic icon: the name in dispel blue")
  assert(r3.name.text == "mine" and near(r3.name.textColor, text), "no type: the theme's text colour")
  -- the selected row (Real Name, unticked): soak, dimmed, then lifted toward white
  local c1 = r1.name.textColor
  assert(r1.sel.shown and not r1.check.checked, "Real Name selected, unticked")
  assert(c1[1] > c1[2] and c1[3] > c1[2] and not near(c1, soak), "still pink, changed for the highlight: " .. table.concat(c1, ","))
  -- selected and ticked: lighter than the type's own colour, same hue
  click(r2.frame)
  local c2 = r2.name.textColor
  assert(c2[1] >= dispel[1] and c2[2] >= dispel[2] and c2[3] >= dispel[3] and c2[3] > c2[1], "lifted on the selection: " .. table.concat(c2, ","))
  -- unticked and not selected: the type's colour dimmed toward grey, not lost
  click(r1.frame)
  setCheck(r2.check, false)
  local d = r2.name.textColor
  assert(not r2.check.checked and not r2.sel.shown, "Other Spell unticked")
  assert(d[3] > d[1] + 0.1 and d[3] < dispel[3] and math.abs(d[1] - 0.5) < math.abs(dispel[1] - 0.5), "dimmed blue: " .. table.concat(d, ","))
  -- the tooltip: the name, then each type in its colour, the main one first
  assert(r2.frame.OnEnter and r2.frame.OnLeave, "the row has a tooltip")
  r2.frame.OnEnter(r2.frame)
  local names = {}
  for _, s in ipairs(said) do names[#names + 1] = s[1] .. ":" .. tostring(s[2]) end
  local all = table.concat(names, "|")
  -- the shared ability tooltip (CRT.AbilityTip): the game's spell tooltip, then the types
  assert(all == "SetOwner:" .. tostring(r2.frame) .. "|SetSpellByID:888|AddLine:Dispel: a debuff to dispel|AddLine:Mythic: Mythic only|Show:nil", all)
  assert(near(said[3][3], dispel) and near(said[4][3], Ref.TYPES.mythic.color), "each line in its type's colour")
  -- the header icon over the selected row's settings shows the same tooltip
  click(r2.frame)
  local hit = CRT.NoteReminders.IconHit()
  assert(hit and hit.OnEnter, "the header icon has a hover frame")
  said = {}
  hit.OnEnter(hit)
  assert(said[1] and said[1][1] == "SetOwner" and said[2][1] == "SetSpellByID" and said[2][2] == 888, "the header icon shows the ability tooltip")
  click(r1.frame)
  said = {}
  r2.frame.OnEnter(r2.frame)
  -- Tooltip position, the game's tooltip spot: the same text where the game shows its tooltips
  assert(type(CRT.UI.TooltipOwner) == "function", "UI.TooltipOwner (CRT_Core/UI/Tooltip.lua) is loaded")
  local spot
  GameTooltip_SetDefaultAnchor = function(t, o) spot = { t, o } end
  CRT.db.ui = { tooltipMode = "game" }
  said = {}
  r2.frame.OnEnter(r2.frame)
  assert(spot and spot[1] == GameTooltip and spot[2] == r2.frame and said[1][1] == "SetSpellByID", "the game's tooltip spot: GameTooltip_SetDefaultAnchor, no SetOwner of its own")
  CRT.db.ui, GameTooltip_SetDefaultAnchor = nil, nil
  said = {}
  r1.frame.OnEnter(r1.frame)
  assert(said[3][2] == "Soak: stack to share the damage" and near(said[3][3], soak) and #said == 4, "your label: its one type")
  said = {}
  r3.frame.OnEnter(r3.frame)
  assert(said[2][2] == "mine" and said[3][2]:find("^No type yet") and said[3][2]:find("Set type", 1, true), "no type: how to set one: " .. tostring(said[3][2]))
  -- the Journal's text, asked for the boss and difficulty on show, between the spell and the types
  local asked
  CRT.TimelineJournal.AbilitySection = function(_, enc, group, spellID, name, sectionID)
    asked = tostring(enc) .. "/" .. tostring(group) .. "/" .. tostring(spellID) .. "/" .. tostring(name)
    if spellID == 888 then return { description = "What it does" }, 16 end
  end
  said = {}
  r2.frame.OnEnter(r2.frame)
  names = {}
  for _, s in ipairs(said) do names[#names + 1] = s[1] .. ":" .. tostring(s[2]) end
  all = table.concat(names, "|")
  assert(asked and asked:find("^" .. ENC .. "/%a+/888/Other Spell$"), "the Journal asked for the boss, the group on show and the spell: " .. tostring(asked))
  assert(all:find("SetSpellByID:888|AddLine:Encounter Journal (Mythic)|AddLine:What it does|AddLine:Dispel: a debuff to dispel", 1, true), "the Journal's text before the types: " .. all)
  CRT.TimelineJournal.AbilitySection = nil
  said = {}
  r3.frame.OnLeave(r3.frame)
  assert(said[1][1] == "Hide", "leaving hides it")
  T:SetAbility(ENC, 777, "type", nil)
  journalRows[2].tags = nil
  CRT.TimelineJournal.CachedRows = nil
  GameTooltip = nil
  assert(#errors == 0, tostring(errors[1]))
end)

-- The list is the rows of the ability timeline Times from names, as the Timeline shows them: with rows the
-- Journal doesn't have, without abilities that have no casts there, mechanics you ignored, the Timeline's
-- hidden rows, Mythic-only rows on Normal and Heroic, and the Mech Alerts hidden list on top. A ticked
-- reminder of yours keeps its row, marked when it is not on that timeline.
check("mech: the list follows the ability timeline", function()
  local T = CRT.Timeline
  local library = CRT.Bosses
  CRT.Bosses = setmetatable({ Get = function(_, id) if id == ENC then return { encounterID = ENC, name = "Test Boss",
    hidden = { "Timeline Hidden" } } end end }, { __index = library })
  journalRows[3] = { spellID = 999, name = "Third Thing", icon = "tex999" } -- in the Journal, not on the timeline
  local normal = assert(Ref:Add("Boss: Test Boss\\nDifficulty: Normal\\nEncounter: 9001\\nLength: 3:00\\nPhase: P2 2:00\\n"
    .. "Real Name: 0:20\\nExtra Add: 0:50\\nIgnored Thing: 1:00\\nTimeline Hidden: 1:10\\nMythic Bit (type mythic): 1:30\\nOther Spell: 2:00+30"))
  T:SetIgnored(ENC, "Ignored Thing", true)
  local function names(f)
    local out = {}
    for _, row in ipairs(f.rows) do if row.frame.shown then out[#out + 1] = row.name.text end end
    return table.concat(out, ",")
  end
  local f = fresh()
  -- at first the group of the boss's first timeline, the Mythic one
  assert(names(f) == "Real Name,Other Spell", "the Mythic timeline's rows: " .. names(f))
  -- Normal/Heroic: its first timeline, then the Normal one picked in Times from
  dropdowns["Difficulty"].opts.set("nh")
  assert(dropdowns["Times from"].opts.get() ~= normal and names(f) == "Real Name", "Normal/Heroic: the Heroic timeline first: " .. names(f))
  dropdowns["Times from"].opts.set(normal)
  assert(dropdowns["Times from"].opts.get() == normal and dropdowns["Difficulty"].opts.get() == "nh", "Times from names the Normal timeline")
  assert(names(f) == "Real Name,Extra Add,Other Spell", "Normal: its rows in order, less ignored, hidden, Mythic-only: " .. names(f))
  -- a row the Journal doesn't have: its own alert, matched by name, following its casts
  local extra = f.rows[2]
  assert(extra.dot.shown and extra.icon.shown, "a timeline row with no Journal row")
  click(extra.frame)
  assert(f.panel.times.text:find("P1 0:50", 1, true), "its casts: " .. tostring(f.panel.times.text))
  setCheck(extra.check, true)
  local r = only()
  assert(r.text == "Extra Add" and r.spellID == nil and r.enabled == true, "ticked by name")
  assert(names(f) == "Real Name,Extra Add,Other Spell" and f.rows[2].check.checked, "one row, ticked: " .. names(f))
  -- the Mech Alerts hidden list on top
  CRT.db.dev = { mechHidden = { [tostring(ENC)] = { ["other spell"] = "Other Spell" } } }
  CRT.NoteReminders.Refresh()
  assert(names(f) == "Real Name,Extra Add", "mechHidden on top: " .. names(f))
  CRT.db.dev = nil
  -- a ticked alert of yours on an ability not on this timeline: kept, marked; unticked: not listed
  local id = R:Save(ENC, nil, { spellID = 999, boss = "Test Boss", text = "Third Thing", enabled = true })
  CRT.NoteReminders.Refresh()
  assert(names(f) == "Real Name,Extra Add,Other Spell,(not on timeline) Third Thing", "ticked, off the timeline: " .. names(f))
  local third = R:Get(ENC, id)
  third.enabled = false
  R:Save(ENC, id, third)
  CRT.NoteReminders.Refresh()
  assert(names(f) == "Real Name,Extra Add,Other Spell", "unticked, off the timeline: " .. names(f))
  dropdowns["Difficulty"].opts.set("mythic")
  T:SetIgnored(ENC, "Ignored Thing", false)
  Ref:Delete(normal)
  journalRows[3] = nil
  CRT.Bosses = library
  reset()
  assert(#errors == 0, tostring(errors[1]))
end)

-- Alerts are saved per difficulty group: the Difficulty dropdown has the Timeline's two groups, no Any; each
-- shows its own alerts and Times from its own ability timeline, and a change saves for the group on show only.
check("mech: alerts per difficulty group", function()
  local f = fresh()
  local diff = dropdowns["Difficulty"]
  local opts = diff.opts.options()
  assert(#opts == 2 and opts[1].key == "nh" and opts[1].label == "Normal/Heroic" and opts[2].key == "mythic" and opts[2].label == "Mythic",
    "Normal/Heroic and Mythic only")
  for _, h in ipairs(helps) do
    -- a (?) whose text changes (a special alert's own help) gives it from a function
    -- (the Shield bar section's Any time it goes up is a checkbox, not a difficulty)
    local text = (type(h.helpText) == "function" and h.helpText() or h.helpText or ""):gsub("Any time", "")
    assert(not text:find("Any", 1, true), "no help names Any: " .. tostring(text))
  end
  assert(diff.opts.get() == "mythic" and f.rows[1].name.text == "Real Name", "the boss's first timeline's group")
  -- tick an alert on in Mythic: Normal/Heroic doesn't show it on
  setCheck(f.rows[1].check, true)
  local r, id = only()
  assert(r.group == "mythic" and r.enabled == true, "saved for Mythic")
  diff.opts.set("nh")
  assert(diff.value == "nh" and dropdowns["Times from"].opts.get() ~= nil, "Normal/Heroic on show")
  assert(f.rows[1].name.text == "Real Name" and not f.rows[1].check.checked, "not on in Normal/Heroic")
  assert(f.panel.times.text:find("0:45", 1, true), "Times from the Heroic timeline: " .. tostring(f.panel.times.text))
  -- a change here makes Normal/Heroic's own, and leaves Mythic's alone
  f.panel.showFrom.opts.set(9)
  local list = R:List(ENC)
  assert(#list == 2 and list[2].r.group == "nh" and list[2].r.warn == 9 and list[2].r.enabled == false, "Normal/Heroic's own, off like its tick")
  assert(R:Get(ENC, id).warn == 5 and R:Get(ENC, id).enabled == true, "Mythic's untouched")
  setCheck(f.rows[1].check, true)
  assert(R:Get(ENC, list[2].id).enabled == true and #R:List(ENC) == 2, "ticked on in Normal/Heroic")
  setCheck(f.rows[1].check, false)
  assert(R:Get(ENC, list[2].id).enabled == false and R:Get(ENC, id).enabled == true, "off in Normal/Heroic only")
  diff.opts.set("mythic")
  assert(f.rows[1].check.checked and f.panel.showFrom.opts.get() == 5, "Mythic's still on, with its own Show from")
  -- an older alert on any difficulty shows on in both; turning it off in one splits it
  reset()
  local any = R:Save(ENC, nil, { spellID = 777, boss = "Test Boss", text = "Real Name", enabled = true })
  CRT.NoteReminders.Refresh()
  assert(f.rows[1].check.checked, "Any: on in Mythic")
  diff.opts.set("nh")
  assert(f.rows[1].check.checked, "and on in Normal/Heroic")
  setCheck(f.rows[1].check, false)
  local groups = {}
  for _, e in ipairs(R:List(ENC)) do groups[#groups + 1] = tostring(e.r.group) .. "=" .. tostring(e.r.enabled) end
  assert(table.concat(groups, ",") == "nh=false,mythic=true", "split, off for Normal/Heroic only: " .. table.concat(groups, ","))
  assert(R:Get(ENC, any).group == "nh", "the old id is Normal/Heroic's")
  diff.opts.set("mythic")
  assert(f.rows[1].check.checked, "still on in Mythic")
  -- Times from a Heroic timeline puts Normal/Heroic on show
  local heroic
  for _, o in ipairs(dropdowns["Times from"].opts.options()) do if o.label:find("Heroic", 1, true) then heroic = o.key end end
  dropdowns["Times from"].opts.set(heroic)
  assert(diff.opts.get() == "nh" and not f.rows[1].check.checked, "Normal/Heroic, its alert off")
  reset()
  assert(#errors == 0, tostring(errors[1]))
end)

-- A reminder split into one per group, with "Also when it lands on me", wants one aura sound, not two.
check("mech: a split reminder's aura sound is wanted once", function()
  reset()
  local Au = CRT.SoundAuras
  local sound = CRT.Sound:Choices({ none = "None" })[2].key
  local id = R:Save(ENC, nil, { spellID = 777, boss = "Test Boss", text = "Real Name", enabled = true, auraSound = true, sound = sound })
  assert(R.SplitOne(ENC, id), "split")
  Au:SyncReminders()
  local n = 0
  for key, w in pairs(Au.wanted) do if key:find("^reminder:") then n = n + 1 assert(w.spellID == 777, "its spell") end end
  assert(n == 1, "one wanted aura sound, got " .. n)
  reset()
  Au:SyncReminders()
  assert(#errors == 0, tostring(errors[1]))
end)

-- Abilities hidden from Mech Alerts for everyone: the boss file's mechHidden list and a developer's own
-- (Timeline:SetMechHidden), set from a row's right-click menu while /crt dev is open.
check("mech: hidden from the list for everyone, set in /crt dev", function()
  local T = CRT.Timeline
  CRT.db.dev = nil
  local library = CRT.Bosses
  CRT.Bosses = setmetatable({ Get = function(_, id) if id == ENC then return { encounterID = ENC, name = "Test Boss", mechHidden = { "Other Spell" } } end end }, { __index = library })
  local menus = {}
  local function menuRoot()
    local root = { items = {} }
    function root:CreateTitle(t) self.items[#self.items + 1] = { title = t } end
    function root:CreateButton(t, fn) local b = { text = t, fn = fn } self.items[#self.items + 1] = b return b end
    function root:CreateDivider() self.items[#self.items + 1] = { divider = true } end
    return root
  end
  CRT.UI.ContextMenu = function(owner, fill) local root = menuRoot() root.owner = owner fill(root) menus[#menus + 1] = root return root end
  local function pick(root, text)
    for _, it in ipairs(root.items) do if it.text == text then return it end end
    error("no menu item " .. text)
  end
  local function rightClick(row) row.frame.OnClick(row.frame, "RightButton") return menus[#menus] end
  local function names(f)
    local out = {}
    for _, row in ipairs(f.rows) do if row.frame.shown then out[#out + 1] = row.name.text end end
    return table.concat(out, ",")
  end

  -- a player: the shipped hidden ability is gone, and right-click opens nothing
  local f = fresh()
  assert(names(f) == "Real Name", "players: no hidden rows: " .. names(f))
  assert(not T:Hidden(ENC, "Other Spell"), "the timeline keeps it")
  local before = #menus
  f.rows[1].frame.OnClick(f.rows[1].frame, "RightButton")
  assert(#menus == before, "no menu for players")
  -- a reminder you made on it stays listed, and keeps working
  local id = R:Save(ENC, nil, { spellID = 888, boss = "Test Boss", text = "Other Spell", enabled = true })
  CRT.NoteReminders.Refresh()
  assert(names(f) == "Real Name,Other Spell", "your own reminder keeps its row: " .. names(f))
  assert(R:Get(ENC, id).enabled == true, "and stays on")
  -- unticked, it no longer keeps the row (a panel change on a row makes an unticked reminder too)
  local r = R:Get(ENC, id)
  r.enabled = false
  R:Save(ENC, id, r)
  CRT.NoteReminders.Refresh()
  assert(names(f) == "Real Name", "an unticked reminder keeps no hidden row: " .. names(f))
  reset()
  CRT.NoteReminders.Refresh()
  assert(names(f) == "Real Name", "deleted: gone again")
  -- the Timeline's Make a Mech Alert on it opens it all the same
  CRT.NotesPage.Open = function() end
  CRT.NoteReminders.Open(ENC, 888)
  assert(names(f) == "Real Name,Other Spell" and f.rows[2].sel.shown and f.panel.name.text == "Other Spell", "asked for: listed and selected: " .. names(f))
  CRT.NotesPage.Open = nil
  -- only while that open lasts: another row picked, it goes
  click(f.rows[1].frame)
  CRT.NoteReminders.Refresh()
  assert(names(f) == "Real Name" and f.rows[1].sel.shown, "another row picked: gone: " .. names(f))
  -- or the tab closed
  CRT.NotesPage.Open = function() end
  CRT.NoteReminders.Open(ENC, 888)
  CRT.NotesPage.Open = nil
  f:Hide()
  f:Show()
  assert(names(f) == "Real Name" and f.rows[1].sel.shown, "the tab closed and opened: gone, the first row selected: " .. names(f))

  -- /crt dev open: hidden rows show greyed, with a mark
  CRT.UI.pages = { dev = { hidden = false } }
  CRT.NoteReminders.Refresh()
  local r2 = f.rows[2]
  assert(r2.frame.shown and r2.name.text == "(hidden) Other Spell", "dev: listed with a mark: " .. tostring(r2.name.text))
  local muted = CRT.PALETTE.muted
  assert(muted and r2.name.textColor[1] == muted[1] and r2.name.textColor[3] == muted[3], "dev: in the theme's muted colour")
  assert(f.rows[1].name.text == "Real Name", "dev: a shown row has no mark")

  -- right-click: hide and show again, and nothing else selected
  click(f.rows[2].frame)
  local m = rightClick(f.rows[1])
  assert(m.owner == f.rows[1].frame and m.items[1].title == "Real Name", "the menu's title is the ability")
  pick(m, "Hide from Mech Alerts for everyone").fn()
  assert(T:MechHidden(ENC, "Real Name") and not T:Hidden(ENC, "Real Name"), "hidden from Mech Alerts only")
  assert(CRT.db.dev.mechHidden[tostring(ENC)]["real name"] == "Real Name", "saved on this computer")
  assert(f.rows[1].name.text == "(hidden) Real Name" and f.rows[2].sel.shown, "redrawn, the selection kept")
  pick(rightClick(f.rows[1]), "Show again").fn()
  assert(not T:MechHidden(ENC, "Real Name") and f.rows[1].name.text == "Real Name", "shown again")
  pick(rightClick(f.rows[2]), "Show again").fn()
  assert(not T:MechHidden(ENC, "Other Spell") and CRT.db.dev.mechHidden[tostring(ENC)]["other spell"] == false, "a shipped one shown again")

  -- no bulk Hide all with no timer: abilities with no casts are never listed
  for _, it in ipairs(rightClick(f.rows[1]).items) do assert(it.text ~= "Hide all with no timer", "no bulk hide") end
  pick(rightClick(f.rows[2]), "Hide from Mech Alerts for everyone").fn()
  local list = T:MechHiddenNames(ENC)
  assert(#list == 1 and list[1] == "Other Spell" and CRT.db.dev.mechHidden[tostring(ENC)] == nil, "back to the shipped list: " .. table.concat(list, ","))

  -- /crt dev closed again: gone for you too, even the selected one (the first row is selected instead)
  click(f.rows[2].frame)
  assert(f.rows[2].sel.shown and f.panel.name.text == "Other Spell", "the hidden row selected in dev")
  CRT.UI.pages.dev.hidden = true
  f:Hide()
  f:Show()
  assert(names(f) == "Real Name", "dev closed: " .. names(f))
  assert(f.rows[1].sel.shown and f.panel.name.text == "Real Name", "the first shown row selected")

  CRT.UI.pages, CRT.UI.ContextMenu, CRT.db.dev = nil, nil, nil
  CRT.Bosses = library
  reset()
  assert(#errors == 0, tostring(errors[1]))
end)

-- The Special view (CRT_Modules/Notes/SpecialAlerts.lua): the Mechanics | Special toggle over the list, the boss's
-- special alerts (CRT_Modules/Alerts/Special.lua, from its boss file) and the selected one's panel.
local SPECIAL_LIST = {
  { key = "soaks", label = "Orb soaks", help = "Two groups soak each orb.", type = "soak", when = { row = "Real Name" }, lead = 6,
    who = { mode = "rotation", rotation = { { 1, 2 }, { 3, 4 } } }, text = "Soak now: {group}",
    show = { callout = true, bar = false, speech = true }, markers = { marks = { "star", "circle" } } },
  { key = "mythicOnly", label = "Mythic dance", difficulty = "mythic", when = { times = "P1 0:20" } },
}
local function withSpecial(list)
  CRT.Bosses.Get = function(self, id) if id == ENC then return { encounterID = ENC, name = "Test Boss", season = "T", special = list } end end
  CRT.Bosses.Loaded = function() return true end
end
local function noSpecial() CRT.Bosses.Get, CRT.Bosses.Loaded = nil, nil end
local SA = CRT.NoteSpecialAlerts
-- every check in both looks
for _, LOOK in ipairs({ "Modern", "Classic" }) do
MODERN = LOOK == "Modern"

check("mech special (" .. LOOK .. "): the toggle sits over the list, Special on the left and on show", function()
  noSpecial()
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = nil, nil
  local f = freshOpen()
  local s = f.special
  assert(s and s.mechBtn and s.specialBtn, "two halves")
  assert(s.toggle.buttons[1] == s.specialBtn and s.toggle.buttons[2] == s.mechBtn, "Special first, Mechanics second")
  assert(s.mechBtn.text.text == "Mechanics" and s.specialBtn.text.text == "Special (0)", "labels: " .. tostring(s.specialBtn.text.text))
  assert(SA.View() == "special" and s.list.shown and s.panel.shown, "Special on show, a boss with none too")
  assert(not f.list.shown and not f.ownButton.shown and not f.panel.frame.shown, "Mechanics hidden")
  rects = {}
  local a, b, lr = rect(s.specialBtn, f), rect(s.mechBtn, f), rect(s.list, f)
  assert(a[3] <= b[1], "side by side, Special on the left")
  assert(a[4] <= lr[2] and b[4] <= lr[2], "over the list: " .. a[4] .. " > " .. lr[2])
  assert(a[1] >= lr[1] and b[3] + 24 <= lr[3], "inside the list's width, its (?) too")
  assert(math.abs(a[3] - a[1] - (#"Special (0)" * 6 + 20)) < 1, "sized from its label")
  assert(s.toggleHelp and rawget(s.toggleHelp, "helpTarget") == s.mechBtn, "the (?) after the toggle, right of Mechanics")
  -- the largest text size: both halves shrink, cut with "...", so they and the (?) still fit the list
  TEXT_SCALE = 1.75
  CRT.NoteReminders.Refresh()
  rects = {}
  a, b, lr = rect(s.specialBtn, f), rect(s.mechBtn, f), rect(s.list, f)
  assert(a[3] <= b[1] and b[3] + 24 <= lr[3], "at 1.75 the toggle and its (?) fit 250: " .. b[3] .. " of " .. lr[3])
  assert(s.specialBtn.text.wordWrap == false and s.specialBtn.text.w <= a[3] - a[1], "its label is cut to the button")
  TEXT_SCALE = nil
  CRT.NoteReminders.Refresh()
  -- a redraw only restyles the toggle; SetTabSelected (which skins the whole tab) only when the view changes
  local set, style = TAB_CALLS.set, TAB_CALLS.style
  CRT.NoteReminders.Refresh()
  assert(TAB_CALLS.set == set and TAB_CALLS.style == style + 2, "a redraw restyles: " .. TAB_CALLS.set - set .. " " .. TAB_CALLS.style - style)
  assert(s.specialBtn.tabSelected == true and s.mechBtn.tabSelected == false, "Special selected")
  click(s.mechBtn)
  assert(TAB_CALLS.set == set + 2 and s.mechBtn.tabSelected == true and s.specialBtn.tabSelected == false, "the view changed: SetTabSelected")
  assert(f.list.shown and not s.list.shown, "Mechanics on show")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): Special shows the empty line and its hint, and a pick holds while the tab stays open", function()
  noSpecial()
  local f = fresh()
  local s = f.special
  typeInto(f.panel.textEdit, "Typed before Special")
  rawset(f.panel.timesEdit, "focused", true) rawset(f.panel.idEdit, "focused", true)
  click(s.specialBtn)
  assert(not f.panel.textEdit.focused and not f.panel.timesEdit.focused and not f.panel.idEdit.focused, "the Mechanics boxes let go")
  assert(only().text == "Typed before Special", "typing on the Mechanics panel is saved first")
  assert(SA.View() == "special", "Special on show")
  assert(not f.list.shown and not f.ownButton.shown and not f.panel.frame.shown, "Mechanics hidden")
  assert(s.list.shown and s.panel.shown and s.empty.shown and s.empty.text == "No special alerts for this boss yet.", "the empty line")
  assert(s.emptyHint and s.emptyHint.shown and s.emptyHint.text == "Mechanics has every ability for your own reminders.", "and where to go instead")
  rects = {}
  local er, hr = rect(s.empty, f), rect(s.emptyHint, f)
  assert(hr[2] > er[2], "the hint under the empty line")
  local m = CRT.PALETTE.muted
  assert(s.empty.textColor and s.empty.textColor[1] == m[1] and s.empty.textColor[3] == m[3], "in the muted colour")
  assert(not s.content.shown, "no panel content")
  click(s.mechBtn)
  click(s.specialBtn)
  assert(SA.View() == "special" and s.list.shown, "held for the boss while the tab stays built")
  local f2 = freshOpen()
  assert(SA.View() == "special" and not f2.list.shown and f2.special.list.shown and f2.special.empty.shown, "built again: a boss with none opens on Special too")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): the list counts, ticks and selects", function()
  withSpecial(SPECIAL_LIST)
  local f = fresh()
  local s = f.special
  assert(s.specialBtn.text.text == "Special (2)", "Mythic on show: both: " .. s.specialBtn.text.text)
  dropdowns["Difficulty"].opts.set("nh")
  assert(s.specialBtn.text.text == "Special (1)", "Normal/Heroic: the Mythic one is left out")
  dropdowns["Difficulty"].opts.set("mythic")
  click(s.specialBtn)
  assert(s.rows[1].frame.shown and s.rows[1].name.text == "Orb soaks" and s.rows[2].name.text == "Mythic dance" and not s.rows[3].frame.shown, "two rows")
  assert(not s.empty.shown, "no empty line")
  assert(s.rows[1].check.checked == false and s.rows[1].sel.shown and not s.rows[2].sel.shown, "off, the first selected")
  local want = { CRT.MechLook.SelectedColor(MODERN) }
  local sel = s.rows[1].sel.color
  assert(sel[1] == want[1] and sel[4] == want[4] and want[4] == (MODERN and 0.95 or 0.18), LOOK .. ": the selected row's tint, as the Mechanics list's")
  local c = s.rows[1].name.textColor
  assert(c and c[1] ~= 1, "in its type's colour, lifted on the selected row")
  setCheck(s.rows[1].check, true)
  assert(CRT.db.alerts.special[ENC].soaks.on == true and s.rows[1].check.checked, "ticked: saved on")
  assert(s.alertMe.checked == true, "the panel's Alert me follows")
  local c2 = s.rows[2].name.textColor
  assert(c2[1] == 0.5 and c2[2] == 0.5, "an off row without a type is grey")
  click(s.rows[2].frame)
  assert(s.rows[2].sel.shown and not s.rows[1].sel.shown and s.title.text == "Mythic dance", "the second selected")
  click(s.mechBtn)
  CRT.db.alerts.special = {}
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): the tab opens on Special every time; Make a Mech Alert opens on Mechanics", function()
  withSpecial(SPECIAL_LIST)
  CRT.db.alerts.special = {}
  -- an old save that picked Mechanics: no longer read for opening
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  local f = freshOpen()
  assert(SA.View() == "special" and f.special.list.shown and not f.list.shown, "opens on Special")
  assert(f.special.specialBtn.tabSelected == true, "the toggle says so")
  click(f.special.mechBtn)
  assert(SA.View() == "mechanics" and f.list.shown and not f.special.list.shown, "Mechanics for this visit")
  assert(CRT.db.alerts.specialView == "mechanics" and CRT.db.alerts.specialViewPicked == true, "the saved fields are kept as they were")
  -- left and opened again (another tab picked, or the window closed): Special again
  f:Hide() f:Show()
  assert(SA.View() == "special" and f.special.list.shown and not f.list.shown, "opened again: Special, whatever was picked last")
  click(f.special.mechBtn)
  local f2 = freshOpen()
  assert(SA.View() == "special" and f2.special.list.shown, "built again: Special")
  -- the menu (or any other way to the tab) opens it the same way
  local opened = CRT.NotesPage.Open
  CRT.NotesPage.Open = function() f2:Hide() f2:Show() end
  click(f2.special.mechBtn)
  CRT.NoteReminders.Open(ENC)
  assert(SA.View() == "special" and f2.special.list.shown, "opened on a boss: Special")
  -- Make a Mech Alert opens the tab on one of the boss's abilities: Mechanics, nothing saved
  CRT.db.alerts.specialView = "special"
  CRT.NoteReminders.Open(ENC, 888)
  assert(SA.View() == "mechanics" and f2.list.shown and not f2.special.list.shown and CRT.db.alerts.specialView == "special", "opened on an ability: Mechanics")
  f2:Hide() f2:Show()
  assert(SA.View() == "special", "and the next opening is on Special again")
  CRT.NotesPage.Open = opened
  noSpecial()
  CRT.NoteReminders.Refresh()
  assert(SA.View() == "special" and f2.special.empty.shown and f2.special.emptyHint.shown, "a boss with none: Special, its empty line and hint")
  -- the toggle's (?) says what each is for
  local help
  for _, h in ipairs(helps) do if h.helpTitle == "Mechanics" then help = h end end
  assert(help and help.helpText:find("prepared alerts", 1, true) and help.helpText:find("your own reminders", 1, true), "its (?)")
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): an ability a special alert covers is tagged Special, its tooltip names it", function()
  withSpecial(SPECIAL_LIST)
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  local said = {}
  GameTooltip = setmetatable({}, { __index = function(_, k) return function(_, a) said[#said + 1] = { k, a } end end })
  local f = fresh()
  local r1, r2 = f.rows[1], f.rows[2]
  assert(r1.name.text == "Real Name" and r1.tag.shown and r1.tag.text.text == "Special", "Real Name: the Orb soaks row")
  assert(not r2.tag.shown, "Other Spell: no special alert covers it")
  assert(math.abs(r1.tag.w - (#"Special" * 6 + 8)) < 1, "sized from its word: " .. tostring(r1.tag.w))
  assert(r1.name.w < r2.name.w, "the name a little shorter for it")
  r1.tag.OnEnter(r1.tag)
  local text
  for _, l in ipairs(said) do if l[1] == "AddLine" then text = l[2] end end
  assert(text and text:find("Orb soaks", 1, true) and text:find("only alerts the casts it doesn't", 1, true), "names the special alert: " .. tostring(text))
  said = {}
  r1.check.OnEnter(r1.check)
  assert(#said > 0, "the tick's tooltip says it too")
  -- ticking it asks nothing: your reminder is made as always
  setCheck(r1.check, true)
  assert(only().spellID == 777 and only().enabled == true, "ticked")
  said = {}
  r2.check.OnEnter(r2.check)
  assert(#said == 0, "no tooltip on a tick nothing covers")
  -- covered by spell too: a special alert on Other Spell's spell. A new list is read on the next redraw, here the
  -- toggle's (nothing else tells the tab, as with the developer's sample before it fires the change)
  withSpecial({ { key = "byspell", label = "By spell", when = { spellID = 888 } } })
  click(f.special.specialBtn) click(f.special.mechBtn)
  assert(not f.rows[1].tag.shown and f.rows[2].tag.shown, "by its spell, read again: " .. tostring(f.rows[1].tag.shown))
  GameTooltip = nil
  noSpecial()
  CRT.NoteReminders.Refresh()
  assert(not f.rows[2].tag.shown, "none: no tag")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): the panel says When and Who, keeps Show as, greys Markers", function()
  withSpecial(SPECIAL_LIST)
  CRT.db.alerts.special = {}
  local f = fresh()
  local s = f.special
  click(s.specialBtn)
  assert(s.content.shown and s.title.text == "Orb soaks" and s.kind.text == "special alert", "title and kind")
  assert(s.titleHelp.shown, "its help in a (?)")
  assert(type(s.titleHelp.helpTitle) == "function" and s.titleHelp.helpTitle() == "Orb soaks" and s.titleHelp.helpText() == "Two groups soak each orb.", "the (?) is titled with the alert's name")
  assert(s.whenText.text == "Each cast of Real Name: P1 0:30; P2 +0:20. Shown 6 s before.", "When: " .. s.whenText.text)
  assert(not s.impactsText.shown, "no impacts: no line under When")
  assert(s.whoText.text == "In turn, one step per cast:", "Who: " .. s.whoText.text)
  assert(s.chips[1].shown and s.chips[1].text.text == "1: G1, G2" and s.chips[2].text.text == "2: G3, G4", "the steps as chips, in order")
  assert(not s.more.shown, "no more")
  assert(s.checks.alert.checked and not s.checks.bar.checked and s.speak.checked, "Show as from the data")
  assert(s.checks.alert.label.text == "Note callout/assignments" and s.checks.timeline.label.text == "Alert timeline", "the same names as a mechanic")
  setCheck(s.checks.bar, true)
  assert(CRT.db.alerts.special[ENC].soaks.show.bar == true and CRT.db.alerts.special[ENC].soaks.on == false, "Bar saved, still off")
  setCheck(s.speak, false)
  assert(CRT.db.alerts.special[ENC].soaks.speak == false, "Speak saved")
  -- Bar fill: fills up by default, or empties; saved with your choices, greyed while Bar is off
  local fill = dropdowns["Bar fill"]
  assert(fill and fill == s.fill and fill.value == "up", "Bar fill: up by default")
  local labels = {}
  for i, o in ipairs(fill.opts.options) do labels[i] = o.key .. "=" .. o.label end
  assert(table.concat(labels, ",") == "up=Bar fills up,down=Bar empties", table.concat(labels, ","))
  assert(fill.opts.enabledIf() == true, "on with Bar on")
  fill.opts.set("down")
  assert(CRT.db.alerts.special[ENC].soaks.fill == "down" and fill.value == "down" and CRT.db.alerts.special[ENC].soaks.speak == false, "saved, the rest kept")
  setCheck(s.checks.bar, false)
  assert(fill.opts.enabledIf() == false, "greyed with Bar off")
  local fp = fill.pts[#fill.pts]
  assert(fp[3] == s.speak.pts[1][3] and fp[2] > 96, "on the Speak row, after its label")
  -- markers: an addon can't set them, so the section is greyed and says why
  assert(s.markText.text == "Marks for each step: Star, Circle. Named in the alert's text.", "the marks: " .. s.markText.text)
  assert(s.markCheck.enabled == false and s.markCheck.checked == false, "Mark the players: greyed")
  local help
  for _, h in ipairs(helps) do if h.helpTitle == "Markers" then help = h end end
  assert(help and help.helpText:find("can't", 1, true) and help.helpText:find("12.0", 1, true), "its (?) says why")
  -- your step's chip
  CRT.NoteEngine = { IsMine = function(self, item) return item.tags[1] == "G3" end }
  CRT.NoteReminders.Refresh()
  assert(s.chips[2].mine and not s.chips[1].mine, "your step's chip is marked")
  CRT.NoteEngine = nil
  -- every (?) is placed by UI.HelpRight
  for _, h in ipairs(helps) do assert(rawget(h, "helpTarget") ~= nil, "the (?) " .. tostring(h.helpTitle) .. " is placed by UI.HelpRight") end
  click(s.mechBtn)
  CRT.db.alerts.special = {}
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): the impacts under When", function()
  withSpecial({ { key = "ticks", label = "Ticks", when = { times = "0:30" }, ticks = { 0, 2.5 } },
    { key = "tocast", label = "To cast", when = { times = "0:30" }, ticks = { 0, 62 }, barTo = "cast" },
    { key = "bar", label = "Bar", when = { times = "0:30" }, bar = { length = 8, ticks = { 4.5, 6.5 } } },
    { key = "early", label = "Early bar", when = { times = "0:30" }, bar = { start = -3, length = 8, ticks = { 4.5 } } },
    { key = "plain", label = "Plain bar", when = { times = "0:30" }, bar = { start = 2, length = 10 } } })
  local f = freshOpen()
  local s = f.special
  local want = { "Impacts: +0:00, +0:02.5", "Impacts: +0:00, +1:02. The bar ends at the cast.", "Bar 8 s, impacts at 4.5 s and 6.5 s",
    "Bar 8 s from 3 s before the cast, impacts at 4.5 s", "Bar 10 s from 2 s after the cast" }
  for i, w in ipairs(want) do
    click(s.rows[i].frame)
    assert(s.impactsText.shown and s.impactsText.text == w, i .. ": " .. tostring(s.impactsText.text))
  end
  local wr, ir, hr = rect(s.whenText, f), rect(s.impactsText, f), nil
  assert(ir[2] > wr[2], "under When")
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

-- A shield bar (absorb) fills with the shield left, so Bar fill has nothing to choose: it is hidden for it
check("mech special (" .. LOOK .. "): no Bar fill on a shield bar", function()
  withSpecial({ { key = "plain", label = "Plain", when = { times = "0:30" } },
    { key = "shield", label = "Shield", when = { times = "0:30" }, absorb = { unit = "boss2", length = 15 } } })
  local f = freshOpen()
  local s = f.special
  click(s.rows[1].frame)
  assert(s.fill.shown, "a plain bar: Bar fill shows")
  click(s.rows[2].frame)
  assert(not s.fill.shown, "a shield bar: Bar fill is hidden")
  assert(s.shield.check.checked and s.shield.unitRow.opts.get() == "boss2" and s.shield.lengthRow.opts.get() == 15, "the Shield bar section shows it")
  setCheck(s.checks.bar, false)
  assert(not s.shield.check.enabled and not s.shield.unitRow.opts.enabledIf(), "greyed while Bar is off")
  setCheck(s.checks.bar, true)
  assert(s.shield.check.enabled and s.shield.unitRow.opts.enabledIf(), "back with Bar on")
  click(s.rows[1].frame)
  assert(s.fill.shown and not s.shield.check.checked, "back on a plain bar: shown again")
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  CRT.db.alerts.special = {}
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

-- The Special tab's Shield bar section: the editor's controls on your choice for the alert (Special:SetChoice "absorb"),
-- saved only while it differs from the boss file's entry; Default puts the entry's back; false turns the shipped bar off;
-- an entry with none can get one. The engine reads the one in use (Special:Absorb): its items and its untimed watch.
local SHIELD_ENTRY = { key = "shield", label = "Shield", when = { times = "0:30, 1:30" }, absorb = { unit = "boss2", length = 15, anyDifficulty = true } }
check("mech special (" .. LOOK .. "): the Shield bar section, your choice over the shipped one", function()
  withSpecial({ SHIELD_ENTRY, { key = "plain", label = "Plain", when = { times = "0:30" }, ticks = { 0, 2 } },
    { key = "myth", label = "Mythic shield", difficulty = "mythic", when = { times = "0:30" }, absorb = { unit = "boss1", length = 10 } } })
  CRT.db.alerts.special = {}
  local f = freshOpen()
  local s = f.special
  local S = CRT.AlertSpecial
  local sh = assert(s.shield, "the section")
  assert(sh.opts.layout == "column" and not sh.opts.anyBeside and sh.note, "a column (Any time on its own row, for Default after it), its note")
  click(s.rows[1].frame)
  local entry = S:Get(ENC, "shield")
  assert(sh.check.checked and sh.unitRow.opts.get() == "boss2" and sh.lengthRow.opts.get() == 15 and sh.any.checked, "the shipped one: Boss 2, 15 s, Any time")
  assert(sh.default and not sh.default.shown, "no Default while it is the shipped one")
  assert(sh.any.checked and not sh.any.enabled and sh.unitRow.opts.enabledIf(), "an alert for every difficulty: Any time greyed (it adds nothing), its tick kept")
  assert(sh.anyHelp.helpText:find("a difficulty this alert isn't set for", 1, true), "Any time's (?)")
  -- Seconds to break 20: your choice, saved; Default shows; the engine uses it
  sh.lengthRow.opts.set(20)
  local saved = CRT.db.alerts.special[ENC].shield.absorb
  assert(saved and saved.unit == "boss2" and saved.length == 20 and saved.anyDifficulty == true, "saved as your choice")
  assert(sh.default.shown and sh.lengthRow.opts.get() == 20, "Default appears")
  assert(S:Absorb(ENC, entry).length == 20, "Special:Absorb: yours")
  CRT.db.alerts.special[ENC].shield.on = true
  local items = S:Items(ENC, entry, { group = "mythic" })
  assert(#items == 2 and items[1].absorb.length == 20 and items[2].absorb.length == 20 and items[1].absorb.unit == "boss2", "every cast carries yours")
  local test = S:TestItem(ENC, entry, "mythic")
  assert(test and test.absorb.length == 20, "Test plays a 20 s shield bar")
  -- the untimed watch of a pull reads it too
  local watches = S:AbsorbWatches({ reason = "encounter", encounterID = ENC })
  assert(#watches == 1 and watches[1].length == 20 and watches[1].unit == "boss2", "the untimed watch: yours")
  -- back to the shipped one: Default
  click(sh.default)
  assert(CRT.db.alerts.special[ENC].shield.absorb == nil and not sh.default.shown and sh.lengthRow.opts.get() == 15, "Default: the shipped 15 s")
  -- set back to the shipped values by hand: nothing kept
  sh.lengthRow.opts.set(18)
  sh.lengthRow.opts.set(15)
  assert(CRT.db.alerts.special[ENC].shield.absorb == nil and not sh.default.shown, "the same as shipped: nothing kept")
  -- Shield bar unticked: false turns the shipped bar off
  setCheck(sh.check, false)
  assert(CRT.db.alerts.special[ENC].shield.absorb == false and S:Absorb(ENC, entry) == nil, "false: no shield bar")
  assert(sh.default.shown and not sh.check.checked and sh.unitRow.opts.get() == "boss2", "Default shows; the pick stays, greyed")
  assert(not sh.unitRow.opts.enabledIf() and not sh.lengthRow.opts.enabledIf() and not sh.any.enabled, "its rows greyed")
  assert(S:Items(ENC, entry, { group = "mythic" })[1].absorb == nil, "the items: no shield bar")
  assert(#S:AbsorbWatches({ reason = "encounter", encounterID = ENC }) == 0, "and no untimed watch")
  assert(s.fill.shown, "a plain bar again: Bar fill shows")
  setCheck(sh.check, true)
  assert(CRT.db.alerts.special[ENC].shield.absorb == nil and S:Absorb(ENC, entry).length == 15, "ticked back: the shipped one")
  -- an entry with no shipped shield bar gets one; its impacts give way to it
  click(s.rows[2].frame)
  local plain = S:Get(ENC, "plain")
  assert(not sh.check.checked and sh.unitRow.opts.get() == "boss1" and sh.lengthRow.opts.get() == 15, "none: a new alert's, greyed")
  assert(s.countTo.opts.enabledIf() == true, "Count down to for its ticks")
  setCheck(sh.check, true)
  local own = CRT.db.alerts.special[ENC].plain.absorb
  assert(own and own.unit == "boss1" and own.length == 15 and own.anyDifficulty == true, "yours: Boss 1, 15 s")
  assert(not s.fill.shown and s.countTo.opts.enabledIf() == false, "Bar fill hidden, Count down to greyed")
  local it = S:Items(ENC, plain, { group = "mythic" })[1]
  assert(it.absorb and it.absorb.unit == "boss1" and it.ticks == nil, "its item: a shield bar, no ticks")
  setCheck(sh.check, false)
  assert(CRT.db.alerts.special[ENC].plain.absorb == nil and S:Items(ENC, plain, { group = "mythic" })[1].ticks ~= nil, "unticked: none kept (it had none), its ticks back")
  -- an alert for one difficulty: Any time can be changed
  click(s.rows[3].frame)
  assert(sh.check.checked and not sh.any.checked and sh.any.enabled, "Mythic only: Any time enabled")
  setCheck(sh.any, true)
  assert(CRT.db.alerts.special[ENC].myth.absorb.anyDifficulty == true, "saved as your choice")
  CRT.db.alerts.special = {}
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

-- The Special panel's layout with the section: right of Show as and Bar fill, between the Who chips and Markers
check("mech special (" .. LOOK .. "): the Shield bar section sits clear of Show as, Bar fill and Markers", function()
  withSpecial({ SHIELD_ENTRY })
  CRT.db.alerts.special = {}
  CRT.db.alerts.shieldPulls = { [ENC] = { at = 1, units = { boss1 = 10, boss2 = 20, boss3 = 30 } } }
  local f = freshOpen()
  local s = f.special
  local sh = s.shield
  sh.lengthRow.opts.set(20) -- Default on show
  rects = {}
  local pr = rect(s.panel, f)
  local parts = { sh.check, sh.unitRow, sh.lengthRow, sh.any, sh.lastText, sh.note, sh.default }
  for _, b in ipairs(sh.use) do if b.shown then parts[#parts + 1] = b end end
  assert(sh.use[3].shown, "three Use buttons fit its own row")
  local others = { s.speak, s.fill, s.countTo, s.markHeading, s.markText, s.markCheck, s.testBtn, s.whoText }
  for _, c in pairs(s.checks) do others[#others + 1] = c others[#others + 1] = c.label end
  local function overlap(a, b) return a[1] < b[3] - 0.5 and b[1] < a[3] - 0.5 and a[2] < b[4] - 0.5 and b[2] < a[4] - 0.5 end
  -- a dropdown or slider row is 32 high (UI.CONTROL_ROW_H) with its control about 20 high in its middle
  local function box(m) local r = rect(m, f) if rawget(m, "opts") then return { r[1], r[2] + 6, r[3], r[4] - 6 } end return r end
  for _, part in ipairs(parts) do
    local r = rect(part, f)
    assert(r[3] <= pr[3] - 12 + 0.5, "inside the panel: " .. tostring(part.label or part.text) .. " " .. r[3])
    for _, o in ipairs(others) do
      assert(not overlap(box(part), box(o)), tostring(part.label or part.text) .. " overlaps " .. tostring(o.label or o.text))
    end
  end
  edges(f, "special with the shield section")
  TEXT_SCALE = 1.75
  CRT.NoteReminders.Refresh()
  edges(f, "special with the shield section, large text")
  TEXT_SCALE = nil
  CRT.db.alerts.shieldPulls = nil
  CRT.db.alerts.special = {}
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): Count down to under Bar fill: the cast or each impact, greyed without ticks", function()
  withSpecial({ { key = "ticks", label = "Ticks", when = { times = "0:30" }, ticks = { 0, 2.5 } },
    { key = "plain", label = "Plain", when = { times = "0:30" } } })
  CRT.db.alerts.special = {}
  local f = freshOpen()
  local s = f.special
  local c = s.countTo
  assert(c and c.label == "Count down to", "a Count down to dropdown")
  local out = {}
  for i, o in ipairs(c.opts.options) do out[i] = o.key .. "=" .. o.label end
  assert(table.concat(out, ",") == "cast=The cast,impact=Each impact", table.concat(out, ","))
  click(s.rows[1].frame)
  rects = {}
  local fr, cr = rect(s.fill, f), rect(c, f)
  assert(cr[2] > fr[2] and cr[1] == fr[1], "under Bar fill")
  assert(c.opts.enabledIf() == true and c.opts.get() == "cast", "on with ticks, The cast first")
  c.opts.set("impact")
  local saved
  for _, byKey in pairs(CRT.db.alerts.special) do if byKey.ticks then saved = byKey.ticks end end
  assert(saved and saved.countTo == "impact", "Each impact saved")
  assert(c.opts.get() == "impact", "and shown")
  c.opts.set("cast")
  for _, byKey in pairs(CRT.db.alerts.special) do if byKey.ticks then saved = byKey.ticks end end
  assert(saved.countTo == nil, "The cast saved as nothing")
  click(s.rows[2].frame)
  assert(c.opts.enabledIf() == false, "greyed without ticks")
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): Show from under When: yours, saved when it differs; Default puts the shipped one back", function()
  withSpecial(SPECIAL_LIST) -- Orb soaks ships lead 6, Mythic dance the default 5
  CRT.db.alerts.special = {}
  local f = freshOpen()
  local s = f.special
  local sl, def = s.lead, s.leadDefault
  assert(sl and sl.label == "Show from" and sl.kind == "Slider", "a Show from slider")
  local m = f.panel.showFrom.opts
  assert(sl.opts.min == m.min and sl.opts.max == m.max and sl.opts.min == 1 and sl.opts.max == 60 and sl.opts.step == 1, "the Mechanics range, 1 to 60 s")
  assert(sl.opts.labelWidth == m.labelWidth and sl.opts.width == m.width and sl.opts.onRelease == true, "the Mechanics slider's label width, width, saved when let go")
  assert(sl.opts.format(8) == m.format(8), "its value reads as the Mechanics one: " .. tostring(sl.opts.format(8)))
  assert(sl.opts.get() == 6 and sl.value == 6, "starts at the shipped lead")
  assert(def and def.text == "Default" and def.enabled == false, "Default, greyed at the default")
  assert(def.w == CRT.UI.PanelButtonWidth(#"Default" * 6), "Default sized from its label: " .. tostring(def.w))
  -- the (?) right of the slider, Default after it
  local help
  for _, h in ipairs(helps) do if h.helpTitle == "Show from" and rawget(h, "helpTarget") == sl then help = h end end
  assert(help and help.helpText == "How long before each cast this alert shows. Default puts back the shipped time.", "its (?): " .. tostring(help and help.helpText))
  rects = {}
  local sr, hr, dr = rect(sl, f), rect(help, f), rect(def, f)
  local wr, ir, whoR = rect(s.whenText, f), rect(s.impactsText, f), rect(s.whoHeading, f)
  assert(hr[1] >= sr[3] and dr[1] >= hr[3], "slider, its (?), then Default")
  assert(sr[2] >= ir[4] and sr[2] >= wr[4] and sr[4] <= whoR[2], "under When's lines, over Who")
  -- moved: saved, When follows, Default lights up
  sl.opts.set(8)
  assert(CRT.db.alerts.special[ENC].soaks.lead == 8, "saved")
  assert(s.whenText.text == "Each cast of Real Name: P1 0:30; P2 +0:20. Shown 8 s before.", "When follows: " .. s.whenText.text)
  assert(sl.value == 8 and def.enabled == true, "Default lights up")
  -- Test plays it at yours
  click(s.testBtn)
  local got
  for _, it in ipairs(A.items) do if it.id == "special:test:soaks" then got = it end end
  assert(got and got.warn == 8, "Test at your Show from: " .. tostring(got and got.warn))
  A:Stop(true)
  -- another alert: its own
  click(s.rows[2].frame)
  assert(sl.opts.get() == 5 and def.enabled == false and s.whenText.text:find("Shown 5 s before.", 1, true), "Mythic dance: its own 5 s")
  click(s.rows[1].frame)
  assert(sl.opts.get() == 8 and def.enabled == true, "Orb soaks: yours kept")
  -- Default: the shipped one back, nothing saved for it
  click(def)
  assert(CRT.db.alerts.special[ENC].soaks.lead == nil and sl.opts.get() == 6 and sl.value == 6, "back to 6, not saved")
  assert(s.whenText.text:find("Shown 6 s before.", 1, true) and def.enabled == false, "When and Default follow")
  -- moved back by hand to the shipped value: the same as Default
  sl.opts.set(9) sl.opts.set(6)
  assert(CRT.db.alerts.special[ENC].soaks.lead == nil and def.enabled == false, "the shipped value by hand: not saved")
  -- a bar of its own: still said as shipped
  withSpecial({ { key = "early", label = "Early bar", when = { times = "0:30" }, lead = 4, bar = { start = -3, length = 8 } } })
  CRT.NoteReminders.Refresh()
  sl.opts.set(12)
  assert(s.whenText.text == "At P1 0:30. Shown 12 s before." and s.impactsText.text == "Bar 8 s from 3 s before the cast", "the bar's line unchanged: " .. s.impactsText.text)
  click(s.mechBtn)
  CRT.db.alerts.special = {}
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): a roles alert's Who, a time before the pull, and each row's icon", function()
  withSpecial({ { key = "roles", label = "Roles", when = { times = "-0:15, 0:30" }, who = { mode = "roles", roles = { "tank", "healer", 3 } }, icon = 135000 },
    { key = "row", label = "By row", when = { row = "Real Name" } },
    { key = "none", label = "No icon", when = { times = "0:30" } } })
  CRT.db.alerts.special = {}
  local f = freshOpen()
  local s = f.special
  click(s.rows[1].frame)
  assert(s.whoText.text == "Roles: Tank, Healer, Group 3", "Who: " .. s.whoText.text)
  assert(s.chips[1] == nil or not s.chips[1].shown, "no chips: one list for every cast")
  assert(s.whenText.text == "At P1 -0:15, 0:30. Shown 5 s before.", "When: " .. s.whenText.text)
  local who, when
  for _, h in ipairs(helps) do
    if h.helpTitle == "Who" then who = h end
    if h.helpTitle == "When" then when = h end
  end
  assert(who and who.helpText:find("Roles:", 1, true), "Who's (?) says what roles do")
  assert(when and when.helpText:find("before the pull", 1, true) and when.helpText:find("pull timer", 1, true), "When's (?) says what a minus does")
  -- the icon on each row: the entry's (every number is a spell in this harness, so its texture), its row's spell, or none
  assert(s.rows[1].icon.shown and s.rows[1].icon.texture == "tex135000", "the entry's icon: " .. tostring(s.rows[1].icon.texture))
  assert(s.rows[2].icon.shown and s.rows[2].icon.texture == "tex777", "the row's spell: " .. tostring(s.rows[2].icon.texture))
  assert(not s.rows[3].icon.shown, "none")
  local function nameX(row) return row.name.pts[#row.name.pts][2] end
  assert(nameX(s.rows[1]) == nameX(s.rows[3]) and s.rows[1].name.w == s.rows[3].name.w, "one name column, with an icon or without")
  rects = {}
  local ir, nr = rect(s.rows[1].icon, f), rect(s.rows[1].name, f)
  assert(ir[3] <= nr[1], "the icon before the name")
  -- drawn as the Mechanics list draws its icon (Notes/MechLook.lua): the same size, place and name column
  local m = f.rows[1]
  assert(s.rows[1].icon.w == 18 and m.icon.w == s.rows[1].icon.w and m.icon.pts[1][2] == s.rows[1].icon.pts[1][2], "the same icon")
  assert(nameX(m) == nameX(s.rows[1]), "the same name column")
  CRT.db.alerts.specialView, CRT.db.alerts.specialViewPicked = "mechanics", true
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): Test plays the alert through the editor's test", function()
  withSpecial(SPECIAL_LIST)
  local f = fresh()
  local s = f.special
  click(s.specialBtn)
  click(s.testBtn)
  assert(A.running and A.run.reason == "test", "a test run")
  local got
  for _, it in ipairs(A.items) do if it.id == "special:test:soaks" then got = it end end
  assert(got and got.ph == 1 and got.time == 10 and got.text == "Soak now: G1, G2 (Star, Circle)" and got.outputs.alert, "the first cast, 10 s ahead: " .. tostring(got and got.text))
  A:Stop(true)
  -- an alert with no times says so
  withSpecial({ { key = "none", label = "Nothing", when = { row = "Not A Row" } } })
  CRT.NoteReminders.Refresh()
  click(s.testBtn)
  assert(not A.running and s.message.text:find("Nothing to test", 1, true), "no times: " .. tostring(s.message.text))
  click(s.mechBtn)
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): Test reads Stop while the test plays, and Stop ends it", function()
  withSpecial(SPECIAL_LIST)
  local f = fresh()
  local s = f.special
  click(s.specialBtn)
  A:Stop()
  timers = {}
  assert(s.testBtn.text == "Test", "idle: Test")
  click(s.testBtn)
  assert(A.running and A.run.reason == "test" and s.testBtn.text == "Stop", "a test, and the button reads Stop: " .. tostring(s.testBtn.text))
  assert(f.panel.testBtn.text == "Test", "the Mechanics panel's own button is not showing this test")
  click(s.testBtn)
  assert(not A.running and s.testBtn.text == "Test", "Stop ends it, the button reads Test")
  -- the run ending on its own
  click(s.testBtn)
  assert(s.testBtn.text == "Stop", "Stop again")
  local last = timers[#timers]
  assert(last and last.delay > 5, "the end timer")
  last.fn()
  assert(not A.running and s.testBtn.text == "Test", "the end timer puts the label back")
  -- a pull: Test stays and the pull goes on
  A.HandleEvent("ENCOUNTER_START", ENC, "Boss", 16)
  local pull = A.run
  assert(s.testBtn.text == "Test", "a pull going: Test")
  click(s.testBtn)
  assert(A.running and A.run == pull, "the pull goes on")
  A:Stop()
  -- a countdown
  A:Start(ENC, "Mythic", "countdown", { firstAt = GetTime() + 10, difficultyID = 16 })
  assert(s.testBtn.text == "Test" and CRT.AlertEditor:StopTest("special") == false and A.run.reason == "countdown", "a countdown stays")
  A:Stop()
  click(s.mechBtn)
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech special (" .. LOOK .. "): nothing passes the page edges", function()
  local long = {}
  for i = 1, 30 do long[i] = { key = "k" .. i, label = "Special alert number " .. i .. " with a long name", when = { times = "0:10" },
    who = { mode = "rotation", rotation = { { 1, 2, 3, 4, 5 }, { 6, 7, 8 }, "tank", "healer", "melee", "ranged", { 1 }, { 2 }, { 3 }, { 4 }, { 5 }, { 6 }, { 7 } } },
    markers = { marks = { "star", "circle", "diamond", "triangle", "moon", "square", "cross", "skull" } } } end
  withSpecial(long)
  local f = fresh()
  click(f.special.specialBtn)
  local n = edges(f, "special")
  assert(n > 40, "checked " .. n .. " pieces")
  assert(f.special.more.shown, "the steps that don't fit are counted")
  rects = {}
  local lr, pr = rect(f.special.list, f), rect(f.special.panel, f)
  assert(lr[3] <= pr[1], "the list ends before the panel")
  assert(lr[4] >= TAB_H - 12 and pr[4] >= TAB_H - 12, "both fill the height")
  TEXT_SCALE = 1.75
  CRT.NoteReminders.Refresh()
  edges(f, "special, large text")
  TEXT_SCALE = nil
  click(f.special.mechBtn)
  noSpecial()
  assert(#errors == 0, tostring(errors[1]))
end)

end
MODERN = nil

check("no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)
if fail > 0 then error(fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const srcs = process.argv.slice(2);
lua.lua_checkstack(L, srcs.length + 2); // more sources than the stack's first 20 slots
for (const s of srcs) lua.lua_pushstring(L, to_luastring(fs.readFileSync(s, 'utf8')));
if (lua.lua_pcall(L, srcs.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
