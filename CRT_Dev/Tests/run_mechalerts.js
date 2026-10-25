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

check("mech: raid note option disabled with help", function()
  local f = fresh()
  local d = f.panel.saveAs
  assert(d and d.label == "Save as", "Save as dropdown")
  local opts = d.opts.options()
  local note, mine
  for _, o in ipairs(opts) do if o.key == "note" then note = o elseif o.key == "mine" then mine = o end end
  assert(note and note.label == "Raid note" and note.disabled == true, "Raid note greyed")
  assert(mine and mine.label == "Only me" and not mine.disabled, "Only me works")
  assert(d.opts.get() == "mine")
  d.opts.set("note")
  assert(d.opts.get() == "mine", "Raid note can't be picked")
  local help = f.panel.saveAsHelp
  assert(help and help.helpText == "Raid note lines have one time each: make them on the Timeline.", tostring(help and help.helpText))
  assert(#R:List(ENC) == 0, "nothing saved")
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

check("mech: test with no Show from starts 8 s before, a long Linger stops later", function()
  local f = fresh()
  dropdowns["Difficulty"].opts.set("nh") -- the Heroic timeline's times
  local p = f.panel
  setCheck(f.rows[1].check, true)
  sliders["Show from"].opts.set(0)
  sliders["Linger"].opts.set(6)
  mockWindow(true)
  click(p.testBtn)
  CRT.TimelineRehearsalWindow = nil
  local c = opened[#opened]
  sliders["Show from"].opts.set(5)
  sliders["Linger"].opts.set(0)
  assert(c and c.t == 37, "8 s before 0:45 with no Show from: " .. tostring(c and c.t))
  assert(c.opts.stopAt == 51, "pauses after the 6 s Linger: " .. tostring(c.opts.stopAt))
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

check("mech: test plays the countdown and stops 3 s after", function()
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
  assert(c.t == 40, "from the 5 s Show from before Heroic's 0:45: " .. tostring(c.t))
  assert(c.opts.stopAt == 48, "pauses 3 s after: " .. tostring(c.opts.stopAt))
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

-- Impact ticks, Bar fill and Bar ends on any mechanic (CRT_Modules/Alerts/Draft.lua ParseTicks; the bars draw them,
-- CRT_Modules/Alerts/Bars.lua). Ticks are seconds after the cast, typed with commas.
check("mech ticks: the typed ticks parse", function()
  local D = CRT.AlertDraft
  local function list(t) local out = {} for i, v in ipairs(t) do out[i] = tostring(v) end return table.concat(out, ",") end
  local t = D.ParseTicks("1.5, 3.5")
  assert(t and list(t) == "1.5,3.5", "two ticks: " .. tostring(t and list(t)))
  t = D.ParseTicks("3.5,1.5 ,  2")
  assert(t and list(t) == "1.5,2,3.5", "put in order: " .. tostring(t and list(t)))
  t = D.ParseTicks("2, 2, 0")
  assert(t and list(t) == "0,2", "the same tick once, 0 is at the cast: " .. tostring(t and list(t)))
  for _, empty in ipairs({ "", "   ", nil }) do
    local e, err = D.ParseTicks(empty)
    assert(e and #e == 0 and err == nil, "empty: no ticks, no problem")
  end
  local bad, err = D.ParseTicks("1.5, soon")
  assert(bad == nil and type(err) == "string" and err:find("soon", 1, true), "a word: " .. tostring(err))
  bad, err = D.ParseTicks("-1, 2")
  assert(bad == nil and err:find("-1", 1, true) and err:find("after the cast", 1, true), "below 0: " .. tostring(err))
  bad, err = D.ParseTicks("1e3")
  assert(bad == nil and err, "only plain seconds")
  assert(D.TicksText({ 1.5, 3.5 }) == "1.5, 3.5" and D.TicksText(nil) == nil and D.TicksText({}) == nil, "back to text")
end)

check("mech ticks: the rows follow Bar and the ticks", function()
  local f = fresh()
  local p = f.panel
  setCheck(f.rows[1].check, true)
  assert(p.ticksEdit and p.ticksEdit.kind == "EditBox", "an Impact ticks box")
  assert(p.ticksLabel.text == "Impact ticks" and p.ticksUnit.text == "s after the cast", "its words: " .. tostring(p.ticksUnit.text))
  assert(p.barFill and p.barFill.label == "Bar fill" and p.barTo and p.barTo.label == "Bar ends", "two dropdowns")
  local function keys(row) local out = {} for i, o in ipairs(row.opts.options) do out[i] = o.key .. "=" .. o.label end return table.concat(out, ",") end
  assert(keys(p.barFill) == "up=Bar fills up,down=Bar empties", keys(p.barFill))
  assert(keys(p.barTo) == "last=At the last impact,cast=At the cast", keys(p.barTo))
  local helped
  for _, h in ipairs(helps) do if h.helpTitle == "Impact ticks" then helped = h end end
  assert(helped and helped.helpText:find("thin line", 1, true) and helped.helpText:find("Only me", 1, true), "a (?) on the ticks")
  -- a new alert has Bar on: ticks and Bar fill on, Bar ends greyed with no ticks
  assert(p.checks.bar.checked, "Bar on")
  assert(p.ticksEdit.enabled and p.barFill.opts.enabledIf() == true, "on with Bar")
  assert(p.barFill.opts.get() == "down", "Bar empties, as bars always did")
  assert(p.barTo.opts.enabledIf() == false and p.barTo.opts.get() == "last", "Bar ends greyed with no ticks")
  typeInto(p.ticksEdit, "1.5, 3.5")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  assert(p.barTo.opts.enabledIf() == true, "Bar ends on with ticks")
  -- Bar off: all three grey out
  setCheck(p.checks.bar, false)
  assert(not p.ticksEdit.enabled and p.barFill.opts.enabledIf() == false and p.barTo.opts.enabledIf() == false, "greyed with Bar off")
  local grey = p.ticksLabel.textColor
  assert(grey and grey[1] == 0.5, "the label greyed")
  setCheck(p.checks.bar, true)
  assert(p.ticksEdit.enabled and p.ticksLabel.textColor[1] ~= 0.5, "back on")
  -- cleared: Bar ends greys again
  typeInto(p.ticksEdit, "")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  assert(p.barTo.opts.enabledIf() == false, "no ticks: Bar ends greyed")
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
  p.barTo.opts.set("cast")
  assert(R:Get(ENC, id).barTo == "cast", "At the cast saved")
  p.barTo.opts.set("last")
  assert(R:Get(ENC, id).barTo == nil, "At the last impact, the default, saved as nothing")
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
  assert(p.ticksEdit.text == "2" and p.barFill.opts.get() == "up" and p.barTo.opts.get() == "last", "loaded back: " .. tostring(p.ticksEdit.text))
  -- emptied: no ticks saved at all
  typeInto(p.ticksEdit, "")
  p.ticksEdit.OnEnterPressed(p.ticksEdit)
  assert(R:Get(ENC, id).ticks == nil, "empty: no ticks field")
  assert(#errors == 0, tostring(errors[1]))
end)

check("mech ticks: an older reminder gains no fields", function()
  local f = fresh()
  local p = f.panel
  local id = R:Save(ENC, nil, { spellID = 777, boss = "Test Boss", text = "Old one", group = "mythic", outputs = { bar = true, alert = true } })
  click(f.rows[1].frame)
  assert(p.ticksEdit.text == "" and p.barFill.opts.get() == "down" and p.barTo.opts.get() == "last", "the defaults on show")
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
  p.barTo.opts.set("cast")
  local r = R:Get(ENC, id)
  -- Reminders:Items, which the block of your reminders runs on
  local items = R:Items(ENC, id, r, R.GroupOf(r))
  assert(#items > 0, "items")
  for _, it in ipairs(items) do
    assert(it.ticks and #it.ticks == 2 and it.ticks[2] == 3.5 and it.fill == "up" and it.barTo == "cast", "each item has them")
  end
  assert(items[1].ticks ~= items[2].ticks and items[1].ticks ~= r.ticks, "each its own copy")
  -- a pull of the boss
  A:Start(ENC, r.group == "mythic" and "Mythic" or "Heroic", "encounter")
  local got
  for _, it in ipairs(A.items) do if it.id == "mine:" .. id .. ":1" then got = it end end
  A:Stop(true)
  assert(got and got.ticks and got.ticks[1] == 1.5 and got.fill == "up" and got.barTo == "cast", "the run's item")
  -- the panel's Test (a quick test, no Rehearsal window)
  click(p.testBtn)
  assert(A.running and A.run.reason == "test", "a test run")
  got = nil
  for _, it in ipairs(A.items) do if it.id == "mine:test:1" then got = it end end
  A:Stop(true)
  assert(got and got.ticks and #got.ticks == 2 and got.fill == "up" and got.barTo == "cast", "the test's item")
  -- the ticks alone, with Bar ends at the last impact: no barTo, the bars' default
  p.barTo.opts.set("last")
  items = R:Items(ENC, id, R:Get(ENC, id), R.GroupOf(r))
  assert(items[1].barTo == nil and items[1].ticks, "ticks, ending at the last impact")
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
    local text = type(h.helpText) == "function" and h.helpText() or h.helpText or ""
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
  sliders["Show from"].opts.set(9)
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
  assert(fp[3] == -262 and fp[2] > 96, "on the Speak row, after its label")
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

check("mech special (" .. LOOK .. "): a roles alert's Who, a time before the pull, and each row's icon", function()
  withSpecial({ { key = "roles", label = "Roles", when = { times = "-0:15, 0:30" }, who = { mode = "roles", roles = { "tank", "healer", 3 } }, icon = 135000 },
    { key = "row", label = "By row", when = { row = "Real Name" } },
    { key = "none", label = "No icon", when = { times = "0:30" } } })
  CRT.db.alerts.special = {}
  local f = freshOpen()
  local s = f.special
  click(s.rows[1].frame)
  assert(s.whoText.text == "Roles: Tank, Healer, G3", "Who: " .. s.whoText.text)
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
  assert(nameX(s.rows[1]) > nameX(s.rows[3]) and s.rows[1].name.w < s.rows[3].name.w, "the name moves over for the icon")
  rects = {}
  local ir, nr = rect(s.rows[1].icon, f), rect(s.rows[1].name, f)
  assert(ir[3] <= nr[1], "the icon before the name")
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
