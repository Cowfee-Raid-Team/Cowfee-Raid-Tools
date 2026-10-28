// CRT_Modules/Alerts/Saved.lua and the editor's saved alert features: save as saved alert, open from one, edit one.
// Usage: node run_alerts_saved.js <the files of run_alerts_editor.js>, then CRT_Modules/Alerts/Saved.lua last
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local frames, fontStrings = {}, {}
local NOT_METHODS = { Left = true, Middle = true, Right = true, Background = true, Arrow = true, SetupMenu = true, CloseButton = true, tex = true }
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, enabled = true, checked = false, text = "",
    pts = {}, w = 0, h = 0, regions = {}, children = {} }
  frames[#frames + 1] = m
  if type(parent) == "table" and rawget(parent, "children") then table.insert(parent.children, m) end
  return setmetatable(m, { __index = function(t, k)
    -- fields the code looks for on frames: only there when set
    if NOT_METHODS[k] or (type(k) == "string" and k:find("^crt")) then return nil end
    if k == "CreateFontString" then return function(self, _, _, font)
      local f = mock("FontString") rawset(f, "parent", self) rawset(f, "font", font) fontStrings[#fontStrings + 1] = f
      table.insert(self.regions, f) return f end end
    if k == "CreateTexture" then return function(self) local tx = mock("Texture") rawset(tx, "parent", self) table.insert(self.regions, tx) return tx end end
    if k == "GetRegions" then return function(self) return table.unpack(self.regions) end end
    if k == "GetChildren" then return function(self) return table.unpack(self.children) end end
    if k == "GetObjectType" then return function(self) return self.kind end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "HookScript" then return function(self, n, fn) rawset(self, "hook" .. n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, s)
      rawset(self, "text", s)
      if self.kind == "EditBox" and rawget(self, "OnTextChanged") then self.OnTextChanged(self, false) end end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return self.enabled end end
    if k == "SetTexture" then return function(self, s) rawset(self, "texture", s) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "GetWidth" then return function(self) return rawget(self, "w") end end
    if k == "GetHeight" then return function(self) return rawget(self, "h") end end
    -- retail: wrapped lines at the set width, ~7 px a letter, 14 px a line
    if k == "GetStringHeight" then return function(self)
      local width, lines = rawget(self, "w") or 1000, 0
      for l in ((rawget(self, "text") or "") .. "\\n"):gmatch("(.-)\\n") do lines = lines + math.max(1, math.ceil(#l * 7 / width)) end
      return lines * 14 end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "SetNonSpaceWrap" then return function(self, on) rawset(self, "nonSpaceWrap", on) end end
    if k == "GetFrameLevel" then return function() return 1 end end
    if k == "HighlightText" then return function(self) rawset(self, "highlighted", true) end end
    if k == "SetFocus" then return function(self) rawset(self, "focused", true) end end
    if k == "SetFrameStrata" then return function(self, v) rawset(self, "strata", v) end end
    if k == "GetFrameStrata" then return function(self) return rawget(self, "strata") or "MEDIUM" end end
    if k == "SetToplevel" then return function(self, v) rawset(self, "toplevel", v) end end
    if k == "Raise" then return function(self) rawset(self, "raised", (rawget(self, "raised") or 0) + 1) end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
function tinsert(t, v) table.insert(t, v) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-16 12:00" end
CANCEL = "Cancel"
CRTFontNormal, CRTFontHighlight, CRTFontDisable, CRTFontEdit, CRTFontDisableSmall = {}, {}, {}, {}, {}
local created = {}
function CreateFrame(kind, name, parent, template)
  local f = mock(kind, parent, template)
  if name then created[name] = f end
  if template == "UIPanelButtonTemplate" then
    for _, k in ipairs({ "Left", "Middle", "Right" }) do rawset(f, k, mock("Texture")) end
  end
  if template == "BasicFrameTemplateWithInset" then
    f:CreateTexture() f:CreateTexture() -- the template's art
    rawset(f, "CloseButton", mock("Button", f, "UIPanelCloseButton"))
    rawset(f, "Inset", mock("Frame", f))
  end
  return f
end
local clock = 100
function GetTime() return clock end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
function issecretvalue() return false end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
SOUNDKIT = { RAID_WARNING = 8959, READY_CHECK = 8960 }
C_Spell = {
  GetSpellName = function(id) return ({ [777] = "Real Name", [888] = "Other Spell" })[id] end,
  GetSpellTexture = function(id) return "tex" .. tostring(id) end,
  GetSpellInfo = function(id) local n = ({ [777] = "Real Name", [888] = "Other Spell" })[id] return n and { name = n, iconID = "tex" .. id } end,
}
-- you are Me in a raid of three
function UnitName(unit) return ({ player = "Me", raid1 = "Alexi", raid2 = "Bob", raid3 = "Me" })[unit] end
function UnitClass() return "Druid", "DRUID" end
function UnitGroupRolesAssigned() return "HEALER" end
function IsInRaid() return true end
function IsInGroup() return true end
function UnitIsGroupLeader(unit) return unit == "player" end
function UnitIsGroupAssistant() return false end
function GetNumGroupMembers() return 3 end
function UnitIsUnit(a, b) return a == b or (a == "raid3" and b == "player") end
function GetRaidRosterInfo(i) return UnitName("raid" .. i), nil, 1 end
local CLASSES = { { "Warrior", "WARRIOR" }, { "Death Knight", "DEATHKNIGHT" }, { "Druid", "DRUID" } }
function GetNumClasses() return #CLASSES end
function GetClassInfo(i) local c = CLASSES[i] if c then return c[1], c[2], i end end
local picker = {}
ColorPickerFrame = {
  SetupColorPickerAndShow = function(self, info) picker.info = info end,
  strata = "DIALOG", SetFrameStrata = function(self, v) self.strata = v end, GetFrameStrata = function(self) return self.strata end,
  Raise = function(self) self.raised = true end,
  HookScript = function(self, name, fn) self.hooks = self.hooks or {} self.hooks[name] = self.hooks[name] or {} table.insert(self.hooks[name], fn) end,
  Hide = function(self) for _, fn in ipairs((self.hooks or {}).OnHide or {}) do fn(self) end end,
  GetColorRGB = function() return picker.r or 1, picker.g or 1, picker.b or 1 end,
}
local popups = {}
-- the game's popup frame: DIALOG strata, shown by the call (which returns nothing)
StaticPopup1 = { strata = "DIALOG", shown = false, hooks = {},
  SetFrameStrata = function(self, v) self.strata = v end, GetFrameStrata = function(self) return self.strata end,
  Raise = function(self) self.raised = true end, IsShown = function(self) return self.shown end,
  HookScript = function(self, name, fn) self.hooks[name] = self.hooks[name] or {} table.insert(self.hooks[name], fn) end,
  Hide = function(self) self.shown = false for _, fn in ipairs(self.hooks.OnHide or {}) do fn(self) end end }
function StaticPopup_ShowCustomGenericConfirmation(info) popups[#popups + 1] = info StaticPopup1.which, StaticPopup1.shown = "GENERIC_CONFIRMATION", true end
-- retail: hides the shown popup of that kind
function StaticPopup_Hide(which) if StaticPopup1.shown and StaticPopup1.which == which then StaticPopup1:Hide() end end
-- StaticPopup_Show with an edit box, as retail does: the dialog comes back with its OnShow run; Accept runs OnAccept(dialog, data)
StaticPopupDialogs = {}
StaticPopup1.EditBox = { text = "", SetText = function(self, s) self.text = s end, GetText = function(self) return self.text end,
  HighlightText = function() end, GetParent = function() return StaticPopup1 end }
StaticPopup1.accept = function() local def = StaticPopupDialogs[StaticPopup1.which] def.OnAccept(StaticPopup1, StaticPopup1.data) StaticPopup1:Hide() end
popupShows = 0
function StaticPopup_Visible(which) if StaticPopup1.shown and StaticPopup1.which == which then return 'StaticPopup1' end end
function StaticPopup_Show(which, a, b, data)
  popupShows = popupShows + 1
  local def = assert(StaticPopupDialogs[which], "popup defined")
  StaticPopup1.which, StaticPopup1.data, StaticPopup1.shown = which, data, true
  StaticPopup1.EditBox:SetText("")
  if def.OnShow then def.OnShow(StaticPopup1, data) end
  return StaticPopup1
end
ACCEPT = "Accept"

local layers, previews, helps, dropdowns, sliders = {}, {}, {}, {}, {}
local CRT = {
  db = {
    ui = { modern = true, layers = {} },
    window = { scale = 100 },
    timeline = { references = {}, nextRef = 1, record = true, rows = {} },
    alerts = { saved = {}, nextSavedId = 1, starters = { healthstone = true, healthpotion = true, gate = true }, bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
    notes = { list = {}, nextId = 1, alert = { enabled = true, tts = true, seconds = 10, ttsSeconds = 3 } },
  },
}
CRT.PALETTE = { background = { 0.11, 0.078, 0.063 }, surface = { 0.165, 0.122, 0.098 }, border = { 0.3, 0.235, 0.188 },
  selected = { 0.44, 0.31, 0.22 }, accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, text = { 0.95, 0.9, 0.84 } }
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
function CRT:PlaySound() end
assert(load(sources[1], "Panel"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
assert(UI.StyleWindow and UI.ApplyStyle and UI.SkinTree, "Panel API")
UI.RegisterLayer = function(_, key, f) layers[key] = f end
UI.RegisterPreview = function(_, key, fn) previews[key] = fn end
UI.ResetButtonWidth = function() return 44 end; UI.ResetButton = function(parent, fn) local b = mock("Button", parent) rawset(b, "onReset", fn) rawset(b, "isReset", true) return b end
UI.SetFrameTitle = function(f, t) f.title = t end
UI.Help = function(parent, title, text) local b = mock("Button", parent) rawset(b, "helpTitle", title) rawset(b, "helpText", text) helps[#helps + 1] = b return b end
UI.Dropdown = function(parent, label, opts) local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
  rawset(r, "refresh", function() rawset(r, "refreshed", (rawget(r, "refreshed") or 0) + 1) end) dropdowns[label] = r return r end
UI.SoundDropdown = function(parent, label, opts) local o = {} for k, v in pairs(opts) do o[k] = v end
  o.options = opts.options or function() return CRT.Sound:Choices({ none = opts.none, filesOnly = opts.filesOnly }) end
  local r = UI.Dropdown(parent, label, o)
  if opts.help then rawset(r, "help", UI.Help(parent, label, "sound help")) end
  return r end
UI.Slider = function(parent, label, opts) local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
  rawset(r, "refresh", function() end) sliders[label] = r return r end
for i = 2, #sources do
  assert(load(sources[i], "src" .. i))("CowfeeRaidTools", CRT)
end
local R, A, E, Ref, Notes, P = CRT.AlertReminders, CRT.Alerts, CRT.AlertEditor, CRT.TimelineReference, CRT.Notes, CRT.NoteParser
assert(E and E.Open and E.OpenNote and E.Close and E.Save and E.Test and E.Export, "AlertEditor API")
assert(A.blocks.mine and A.blocks.minetest, "blocks")

-- a boss with two references
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Mythic\\nEncounter: 9001\\nLength: 3:00\\nPhase: P2 2:00\\nAbility: 0:30, 2:20"))
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Heroic\\nEncounter: 9001\\nLength: 2:00\\nAbility: 0:45"))
local ENC = 9001

local function reset()
  E:Close()
  A:Stop(true)
  CRT.db.alerts.reminders = {}
  CRT.db.alerts.overrides = {}
  CRT.db.alerts.nextId = 1
  CRT.db.notes.list = {} CRT.db.notes.nextId = 1 CRT.db.notes.active = nil
  for i = #popups, 1, -1 do popups[i] = nil end
  for i = #errors, 1, -1 do errors[i] = nil end
  for i = #printed, 1, -1 do printed[i] = nil end
  clock = 100
end
local function win() return created.CowfeeRaidToolsAlertEditor end
local function typeInto(edit, s) edit:SetText(s) edit.OnTextChanged(edit, true) end
local function click(b) b.OnClick(b) end
local function setCheck(c, on) c.checked = on c.OnClick(c) end
local function pick(label, key) dropdowns[label].opts.set(key) end
local function value(label) return dropdowns[label].opts.get() end
local function optionList(row) local list = type(row.opts.options) == "function" and row.opts.options() or row.opts.options return list end
local function optionKeys(row)
  local t = {} for i, o in ipairs(optionList(row)) do t[i] = tostring(o.key) end return table.concat(t, ",")
end
local function hasOption(row, key) for _, o in ipairs(optionList(row)) do if o.key == key then return o end end end
local function message() return win().messageText.text or "" end
local function noteRaw(id) return Notes:Get(id).raw end

local S = CRT.AlertSaved
assert(S and S.Save and S.Get and S.List and S.Rename and S.Delete and S.Prefill and S.OnChange, "AlertSaved API")
assert(E.EditSaved, "Editor:EditSaved")

local function resetSaved()
  reset()
  CRT.db.alerts.saved = {}
  CRT.db.alerts.nextSavedId = 1
  StaticPopup1.shown = false
  StaticPopup1.data = nil
end
local fires = 0
A:OnChange(function() fires = fires + 1 end)
local savedFires = 0
S:OnChange(function() savedFires = savedFires + 1 end)

local function full()
  return { name = "Soak", text = "Soak now", spellID = 777, iconID = 135940, saveAs = "note", tags = { "tank", "G1" },
    color = { 1, 0.5, 0, 1 }, outputs = { alert = true, bar = false, text = true, icon = true, circle = true, timeline = true, speech = true },
    speech = "textcount", sound = "RAID_WARNING", glow = true, warn = 8, linger = 3,
    -- what a saved alert never keeps
    times = "P2 +1:30", ph = 2, time = 5, phase = 2, encounterID = ENC, boss = "Test Boss", difficulty = "Mythic",
    enabled = true, priority = "high", id = 77, reminder = true }
end

-- save strips time and encounter
do
  resetSaved()
  local f = full()
  local before, beforeSaved = fires, savedFires
  local id = S:Save(nil, f)
  assert(id == 1 and CRT.db.alerts.nextSavedId == 2, "first id")
  assert(fires == before + 1 and savedFires == beforeSaved + 1, "a save tells the alerts windows and the listeners")
  local s = S:Get(id)
  assert(s.name == "Soak" and s.text == "Soak now" and s.spellID == 777 and s.iconID == 135940 and s.saveAs == "note", "fields")
  assert(#s.tags == 2 and s.tags[1] == "tank" and s.tags[2] == "G1", "tags")
  assert(s.outputs.alert and not s.outputs.bar and s.outputs.text and s.outputs.icon and s.outputs.circle and s.outputs.timeline and s.outputs.speech, "outputs")
  assert(s.speech == "textcount" and s.sound == "RAID_WARNING" and s.glow == true and s.warn == 8 and s.linger == 3, "speech, sound, glow, warn, linger")
  assert(s.color[1] == 1 and s.color[2] == 0.5 and s.color[3] == 0, "colour")
  for _, k in ipairs({ "times", "ph", "time", "phase", "encounterID", "boss", "difficulty", "enabled", "priority", "id", "reminder" }) do
    assert(s[k] == nil, "stripped: " .. k)
  end
  f.color[1] = 0 f.tags[1] = "x" f.outputs.alert = false
  assert(s.color[1] == 1 and s.tags[1] == "tank" and s.outputs.alert, "a copy: later edits of the source don't reach it")
  -- names: the text, else the spell's name, else a plain one
  local a = S:Save(nil, { text = "  Spread out ", spellID = 777, outputs = { alert = true } })
  local b = S:Save(nil, { spellID = 777, outputs = { alert = true } })
  local c = S:Save(nil, { outputs = { alert = true } })
  assert(S:Get(a).name == "Spread out" and S:Get(b).name == "Real Name" and S:Get(c).name == "Template", S:Get(c).name)
  assert(S:Get(c).warn == 5 and S:Get(c).saveAs == "mine" and S:Get(c).linger == nil and S:Get(c).outputs.bar == false, "defaults")
  -- the list is by name
  local names = {} for i, e in ipairs(S:List()) do names[i] = e.s.name end
  assert(table.concat(names, ",") == "Real Name,Soak,Spread out,Template", table.concat(names, ","))
  -- overwriting keeps the id, and the name when none is given
  local again = S:Save(id, { text = "Changed", outputs = { bar = true } })
  assert(again == id and S:Get(id).text == "Changed" and S:Get(id).name == "Soak" and S:Get(id).tags[1] == nil and #S:List() == 4, "overwritten")
  assert(S:Save(nil, "nope") == nil, "no fields, nothing saved")
  print("ok saved: save strips time and encounter")
end

-- prefill fills every field
do
  resetSaved()
  local id = S:Save(nil, full())
  local pre = S:Prefill(id, ENC, 2, 45, nil, "Test Boss")
  assert(pre and pre.saved == id and pre.spellID == 777 and pre.saveAs == "note" and pre.ph == 2 and pre.time == 45 and pre.boss == "Test Boss")
  assert(S:Prefill(99, ENC, 1, 1) == nil, "no such saved alert")
  assert(S:Prefill(id, ENC, 1, 5, 888).spellID == 888, "a dropped spell wins")
  table.insert(A.phaseSources, function() return { 2 } end)
  E:Open(ENC, nil, pre)
  local w = win()
  assert(w.textEdit.text == "Soak now", w.textEdit.text)
  assert(value("Save as") == "note" and w.forRow.shown and value("For") == "tank G1", tostring(value("For")))
  assert(value("Relative to") == 2 and w.timeEdit.text == "0:45", w.timeEdit.text)
  assert(value("Icon") == "id" and w.idEdit.text == "135940", "icon ID kept")
  assert(w.checks.alert.checked and not w.checks.bar.checked and w.checks.text.checked and w.checks.icon.checked and w.checks.circle.checked)
  assert(w.also.speak.checked and w.also.count.checked and w.also.glow.checked, "speak, count, glow")
  assert(value("Sound") == "kit:RAID_WARNING" and sliders["Show from"].opts.get() == 8 and sliders["Linger"].opts.get() == 3)
  assert(w.colorSwatch.tex.color[1] == 1 and w.colorSwatch.tex.color[2] == 0.5, "colour")
  assert(w.title == "Alert" and not w.deleteBtn.shown, "an ordinary new alert")
  -- the spell of the saved alert shows its name; Save makes a note line with the time
  pick("Save as", "mine")
  click(w.saveBtn)
  local r = R:Get(ENC, 1)
  assert(r and r.text == "Soak now" and r.spellID == 777 and r.times == "P2 +0:45" and r.iconID == 135940 and r.boss == "Test Boss", "saved: " .. tostring(r and r.times))
  assert(r.outputs.bar == false and r.outputs.alert and r.speech == "textcount" and r.warn == 8 and r.linger == 3 and r.glow, "reminder fields")
  assert(r.color[2] == 0.5 and r.sound == "RAID_WARNING", "colour and sound")
  -- a spell dropped on an icon replaces the saved alert's own, and its icon with it
  E:Open(ENC, nil, S:Prefill(id, ENC, 1, 10, 888, "Test Boss"))
  assert(value("Icon") == "spell" and w.idEdit.text == "888" and w.textEdit.text == "Soak now", "dropped spell: " .. w.idEdit.text)
  -- text that only names its own spell takes the dropped spell's name; on its own spell, or nowhere, it stays
  local named = S:Save(nil, { text = "Real Name", spellID = 777, outputs = { alert = true } })
  E:Open(ENC, nil, S:Prefill(named, ENC, 1, 10, 888, "Test Boss"))
  assert(w.textEdit.text == "Other Spell" and w.idEdit.text == "888", "spell-name text follows the dropped spell: " .. w.textEdit.text)
  E:Open(ENC, nil, S:Prefill(named, ENC, 1, 10, 777, "Test Boss"))
  assert(w.textEdit.text == "Real Name", "dropped on its own spell: kept")
  E:Open(ENC, nil, S:Prefill(named, ENC, 1, 10, nil, "Test Boss"))
  assert(w.textEdit.text == "Real Name", "not on an icon: kept")
  local empty = S:Save(nil, { spellID = 777, outputs = { alert = true } })
  E:Open(ENC, nil, S:Prefill(empty, ENC, 1, 10, 888, "Test Boss"))
  assert(w.textEdit.text == "Other Spell", "no text: the dropped spell's name: " .. w.textEdit.text)
  -- a saved alert with no spell and no text of its own takes the dropped spell's name
  local bare = S:Save(nil, { outputs = { alert = true } })
  E:Open(ENC, nil, S:Prefill(bare, ENC, 1, 10, 888, "Test Boss"))
  assert(w.textEdit.text == "Other Spell" and w.idEdit.text == "888", "bare saved alert on a spell")
  E:Open(ENC, nil, S:Prefill(bare, ENC, 1, 10, nil, "Test Boss"))
  assert(w.textEdit.text == "" and w.idEdit.text == "", "bare saved alert elsewhere keeps no spell")
  -- no time given: the boxes stay empty
  E:Open(ENC, nil, S:Prefill(id, ENC, nil, nil, nil, nil))
  assert(w.timeEdit.text == "" , "no time given")
  print("ok saved: prefill fills every field")
end

-- rename and delete
do
  resetSaved()
  local id = S:Save(nil, full())
  local before, beforeSaved = fires, savedFires
  assert(S:Rename(id, "  Big soak ") and S:Get(id).name == "Big soak")
  assert(fires == before + 1 and savedFires == beforeSaved + 1, "rename tells the windows")
  assert(S:Rename(id, "   ") and S:Get(id).name == "Soak now", "an empty name takes the default: " .. S:Get(id).name)
  assert(S:Rename(99, "x") == false)
  before, beforeSaved = fires, savedFires
  S:Delete(id)
  assert(S:Get(id) == nil and #S:List() == 0 and fires == before + 1 and savedFires == beforeSaved + 1, "deleted")
  S:Delete(id)
  assert(fires == before + 1, "deleting nothing tells no one")
  assert(S:Save(nil, full()) == 2, "ids are not reused")
  print("ok saved: rename and delete")
end

-- editor: save as saved alert
do
  resetSaved()
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss" })
  local w = win()
  assert(w.saveSavedBtn.shown and w.saveSavedBtn.text == "Save As Template", "the button: " .. tostring(w.saveSavedBtn.text))
  local def = StaticPopupDialogs.COWFEE_RAID_TOOLS_SAVED_ALERT_NAME
  assert(def == nil, "the popup is made when first asked")
  typeInto(w.textEdit, "Soak now")
  pick("Relative to", 1) typeInto(w.timeEdit, "1:30")
  pick("Difficulty", "Mythic")
  click(w.saveSavedBtn)
  def = StaticPopupDialogs.COWFEE_RAID_TOOLS_SAVED_ALERT_NAME
  assert(def and def.hasEditBox and def.button1 and def.button2 and def.OnAccept, "a popup with an edit box and Accept and Cancel")
  assert(StaticPopup1.shown and StaticPopup1.EditBox.text == "Soak now", "default name filled in: " .. tostring(StaticPopup1.EditBox.text))
  assert(StaticPopup1.strata == "FULLSCREEN_DIALOG" and StaticPopup1.raised, "popup above the editor")
  assert(#S:List() == 0, "nothing saved until Accept")
  StaticPopup1.EditBox:SetText("  My soak ")
  StaticPopup1.accept()
  local list = S:List()
  assert(#list == 1 and list[1].s.name == "My soak" and list[1].s.text == "Soak now" and list[1].s.spellID == 777, "saved under the name")
  local s = list[1].s
  assert(s.times == nil and s.ph == nil and s.boss == nil and s.difficulty == nil and s.encounterID == nil, "no time, boss or difficulty")
  assert(s.saveAs == "mine" and s.outputs.alert and s.outputs.bar and s.speech == "text" and s.outputs.speech, "outputs and speech")
  assert(w.shown and R:Get(ENC, 1) == nil, "the editor stays open and saves no reminder")
  assert(printed[#printed] and printed[#printed]:find("My soak", 1, true), "says so")
  -- an empty name takes the default; the popup shows the draft's current text
  StaticPopup1:Hide()
  typeInto(w.textEdit, "Other text")
  click(w.saveSavedBtn)
  assert(StaticPopup1.EditBox.text == "Other text", StaticPopup1.EditBox.text)
  StaticPopup1.EditBox:SetText("")
  StaticPopup1.accept()
  assert(#S:List() == 2 and S:Get(2).name == "Other text", "empty name: " .. tostring(S:Get(2) and S:Get(2).name))
  -- asked again while the popup is open: no second popup, the open one takes the draft as it is now
  StaticPopup1:Hide()
  typeInto(w.textEdit, "First")
  click(w.saveSavedBtn)
  typeInto(w.textEdit, "Second")
  local shows = popupShows
  click(w.saveSavedBtn)
  assert(popupShows == shows and StaticPopup1.data.fields.text == "Second", "reuses the open popup")
  StaticPopup1:Hide()
  -- a save that fails says so on the editor's message line
  click(w.saveSavedBtn)
  local keep = S.Save
  S.Save = function() return nil end
  StaticPopup1.accept()
  S.Save = keep
  assert(message():find("could not be saved", 1, true), "failure shown: " .. message())
  typeInto(w.textEdit, "")
  -- no text: the spell's name; Enter accepts; Cancel and Escape save nothing
  StaticPopup1:Hide()
  typeInto(w.textEdit, "")
  click(w.saveSavedBtn)
  assert(StaticPopup1.EditBox.text == "Real Name", "spell name default")
  StaticPopup1.EditBox.EditBoxOnEnterPressed = nil
  -- retail calls the handler as (editBox, dialog.data); the box sits in a holder, not the dialog itself
  local box = StaticPopup1.EditBox
  local holder = { Hide = function() end }
  box.GetParent = function() return holder end
  def.EditBoxOnEnterPressed(box, StaticPopup1.data)
  assert(#S:List() == 3 and S:Get(3).name == "Real Name" and not StaticPopup1.shown, "Enter accepts and closes, from the data argument")
  click(w.saveSavedBtn)
  def.EditBoxOnEscapePressed(box, StaticPopup1.data)
  assert(#S:List() == 3 and not StaticPopup1.shown, "Escape cancels")
  -- no data argument: the dialog's own data
  box.GetParent = function() return StaticPopup1 end
  click(w.saveSavedBtn)
  box:SetText("By parent")
  def.EditBoxOnEnterPressed(box)
  assert(#S:List() == 4 and S:Get(4).name == "By parent" and not StaticPopup1.shown, "falls back to the dialog's data")
  S:Delete(4)
  click(w.saveSavedBtn)
  StaticPopup1:Hide()
  assert(#S:List() == 3 and StaticPopup1.strata == "DIALOG", "Cancel saves nothing; strata restored")
  -- nothing ticked: no popup
  for _, k in ipairs({ "alert", "text", "icon", "bar", "circle" }) do setCheck(w.checks[k], false) end
  setCheck(w.also.speak, false)
  click(w.saveSavedBtn)
  assert(not StaticPopup1.shown and message():find("Tick a Show as box", 1, true), "needs an output: " .. message())
  for _, f in ipairs(fontStrings) do assert(not (f.text or ""):find("aved alert"), "no saved alert wording (they are templates now)") end
  for _, m in ipairs(frames) do assert(not (m.text or ""):find("aved alert"), "no saved alert wording (they are templates now)") end
  print("ok editor: save as saved alert")
end

-- templates: the editor's words
do
  resetSaved()
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss" })
  local w = win()
  assert(w.saveSavedBtn.text == "Save As Template", "Save As Template: " .. tostring(w.saveSavedBtn.text))
  typeInto(w.textEdit, "Soak now")
  click(w.saveSavedBtn)
  assert(StaticPopupDialogs.COWFEE_RAID_TOOLS_SAVED_ALERT_NAME.text == "Name this template:", "the name prompt")
  StaticPopup1.accept()
  assert(printed[#printed] == 'Template "Soak now" saved.', "the chat line: " .. tostring(printed[#printed]))
  E:Close()
  E:EditSaved(nil)
  assert(win().title == "New template", "new: " .. tostring(win().title))
  E:EditSaved(S:List()[1].id)
  assert(win().title == "Template: Soak now", "title: " .. tostring(win().title))
  E:Close()
  print("ok templates: strip and editor say Templates and Save As Template")
end

-- the editor's new-alert defaults, as one source: what a fresh draft saves as a template
do
  resetSaved()
  assert(type(E.NewDefaults) == "function", "Editor.NewDefaults")
  local d = E.NewDefaults()
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss" })
  local w = win()
  typeInto(w.textEdit, "Fresh")
  click(w.saveSavedBtn)
  StaticPopup1.accept()
  local s = S:List()[1].s
  for _, k in ipairs({ "alert", "text", "icon", "bar", "circle", "speech" }) do
    assert((d.outputs[k] and true or false) == s.outputs[k], "output " .. k)
  end
  assert(d.outputs.alert and d.outputs.bar and d.outputs.speech and not d.outputs.text, "alert, bar, read out")
  assert(d.speech == s.speech and d.speech == "text" and d.warn == s.warn and d.warn == 5 and d.saveAs == "mine", "speech, warn, save as")
  -- a fresh table each call
  d.outputs.alert = false
  assert(E.NewDefaults().outputs.alert == true, "not shared")
  E:Close()
  print("ok templates: the editor's new defaults are a new alert's")
end

-- the popup helpers on CRT.UI
do
  assert(UI.LiftOver and UI.ShownPopup and UI.PopupEditBox, "popup helpers on CRT.UI")
  local keepVis = StaticPopup_Visible
  local mine = { IsShown = function() return true end }
  local returned = { IsShown = function() return true end }
  StaticPopup1.shown, StaticPopup1.which = true, "SOMEONE_ELSES"
  StaticPopup2 = mine
  StaticPopup_Visible = function(which) if which == "MINE" then return "StaticPopup2" end end
  assert(UI.ShownPopup(returned, "MINE") == returned, "the frame the call returned first")
  assert(UI.ShownPopup(nil, "MINE") == mine, "then the named popup, not the first visible one")
  assert(UI.ShownPopup(nil, "NOT_SHOWN") == StaticPopup1, "then the first visible one")
  StaticPopup1.shown, StaticPopup2 = false, nil
  assert(UI.ShownPopup(nil, "NOT_SHOWN") == nil, "none shown: nil")
  StaticPopup_Visible = keepVis
  local a, b, c = {}, {}, {}
  assert(UI.PopupEditBox({ GetEditBox = function() return a end, EditBox = b }) == a, "GetEditBox first")
  assert(UI.PopupEditBox({ EditBox = b, editBox = c }) == b and UI.PopupEditBox({ editBox = c }) == c, "then EditBox, editBox")
  assert(UI.PopupEditBox(nil) == nil, "no dialog: nil")
  -- lifted once, hooked once, strata back on hide
  local d = { strata = "DIALOG", hooks = {}, SetFrameStrata = function(self, v) self.strata = v end, GetFrameStrata = function(self) return self.strata end,
    Raise = function(self) self.raised = true end, HookScript = function(self, n, fn) self.hooks[#self.hooks + 1] = fn end }
  UI.LiftOver(d) UI.LiftOver(d)
  assert(d.strata == "FULLSCREEN_DIALOG" and d.raised and #d.hooks == 1, "lifted")
  d.hooks[1](d)
  UI.LiftOver(d)
  assert(d.strata == "FULLSCREEN_DIALOG" and #d.hooks == 1, "lifted again, one hook")
  d.hooks[1](d)
  assert(d.strata == "DIALOG", "strata back")
  UI.LiftOver(nil)
  print("ok ui: popup helpers")
end

-- editor: edit a saved alert
do
  resetSaved()
  local id = S:Save(nil, full())
  local other = S:Save(nil, { text = "Other", outputs = { alert = true } })
  assert(E:EditSaved(99) == false, "no such saved alert")
  assert(E:EditSaved(id) == true)
  local w = win()
  assert(w.shown and w.title == "Template: Soak", w.title)
  assert(dropdowns["Save as"].shown and w.forRow.shown, "Save as and For stay")
  assert(not dropdowns["Relative to"].shown and not dropdowns["Difficulty"].shown, "no Relative to, Difficulty")
  assert(w.h == 590 - 48, "frame shrinks: " .. tostring(w.h))
  -- no gap: every visible element's top is at most one row gap under the one above it
  local function gaps()
    local ys, seen = {}, {}
    for _, m in ipairs(frames) do
      local pt = m.pts and m.pts[1]
      if m.parent == w and m.shown and pt and pt[1] == "TOPLEFT" and type(pt[3]) == "number" and not seen[pt[3]] and m ~= w.messageText and (m.kind ~= "FontString" or m.text ~= "") then
        seen[pt[3]] = true ys[#ys + 1] = pt[3]
      end
    end
    for _, m in ipairs(fontStrings) do
      local pt = m.pts and m.pts[1]
      if m.parent == w and m.shown and pt and pt[1] == "TOPLEFT" and type(pt[3]) == "number" and not seen[pt[3]] and m.text ~= "" and m ~= w.messageText then
        seen[pt[3]] = true ys[#ys + 1] = pt[3]
      end
    end
    table.sort(ys, function(a, b) return a > b end)
    local worst = 0
    for i = 2, #ys do worst = math.max(worst, ys[i - 1] - ys[i]) end
    return worst
  end
  assert(gaps() <= 40, "no blank band in saved mode: " .. gaps())
  assert(not w.timeEdit.shown and not w.timeLabel.shown and not w.timeHelp.shown and not w.saveSavedBtn.shown, "no Time, no Save as saved alert")
  assert(w.testBtn.shown and not w.exportBtn.shown and w.deleteBtn.shown, "Test and Delete stay; no Export (a saved alert has no time to write)")
  assert(w.textEdit.text == "Soak now" and w.forRow.shown and value("For") == "tank G1" and w.idEdit.text == "135940", "fields")
  assert(w.messageText.text == "", "no time is asked for: " .. w.messageText.text)
  -- Test: 10 s into phase 1, starting at its Show from, saving nothing
  click(w.testBtn)
  assert(A.running and A.run.reason == "test" and #A.items == 1 and message() == "", "test ran: " .. message())
  local it = A.items[1]
  assert(it.ph == 1 and it.time == 10 and it.block == "note", "note-type saved alert tests as a note item")
  assert(it.warn > 0 and A:PhaseStart(1) == clock + it.warn - 10, "at its Show from, no lead: " .. tostring(A:PhaseStart(1) - clock))
  A:Stop(true)
  -- a reminder-type one tests as a reminder
  typeInto(w.textEdit, "Changed")
  pick("Save as", "mine")
  click(w.testBtn)
  assert(A.running and #A.items == 1 and A.items[1].block == "minetest" and A.items[1].ph == 1 and A.items[1].time == 10 and A.items[1].text == "Changed")
  A:Stop(true)
  -- Save overwrites, keeping id and name
  pick("Save as", "note")
  setCheck(w.also.glow, false)
  sliders["Linger"].opts.set(0)
  click(w.saveBtn)
  assert(not w.shown and #S:List() == 2, "closed, nothing added")
  local s = S:Get(id)
  assert(s.text == "Changed" and s.name == "Soak" and s.glow == nil and s.linger == nil and s.spellID == 777 and s.tags[2] == "G1", "overwritten")
  assert(S:Get(other).text == "Other" and R:Get(ENC, 1) == nil and next(CRT.db.notes.list) == nil, "nothing else touched")
  -- Delete asks, then deletes
  E:EditSaved(id)
  click(w.deleteBtn)
  assert(#popups == 1 and popups[1].text == "Delete this template?" and S:Get(id), "asks first")
  assert(StaticPopup1.strata == "FULLSCREEN_DIALOG" and StaticPopup1.raised, "popup above the editor")
  popups[1].callback()
  assert(S:Get(id) == nil and not w.shown and S:Get(other), "deleted after accept")
  -- a new one
  assert(E:EditSaved(nil) == true)
  assert(w.title == "New template" and not w.deleteBtn.shown and not w.saveSavedBtn.shown, "new: " .. w.title)
  typeInto(w.textEdit, "Fresh")
  click(w.saveBtn)
  local n = S:List()
  assert(#n == 2 and S:Get(3) and S:Get(3).text == "Fresh" and S:Get(3).name == "Fresh" and S:Get(3).saveAs == "mine", "created")
  -- nothing ticked still refuses
  E:EditSaved(3)
  for _, k in ipairs({ "alert", "text", "icon", "bar", "circle" }) do setCheck(w.checks[k], false) end
  setCheck(w.also.speak, false)
  click(w.saveBtn)
  assert(w.shown and message():find("Tick a Show as box", 1, true))
  -- an ordinary alert opened afterwards has its rows back
  E:Open(ENC, nil, {})
  assert(dropdowns["Save as"].shown and dropdowns["Relative to"].shown and dropdowns["Difficulty"].shown and w.timeEdit.shown and w.saveSavedBtn.shown and w.exportBtn.shown and w.title == "Alert", "rows back")
  assert(w.h == 590 and dropdowns["Sound"].pts[1][3] == -304 - 14 - 26 - 84 and w.messageText.pts[1][3] == -350 - 14 - 26 - 84, "normal layout restored")
  -- Save as in a saved alert is kept: only me, and a note line for a class
  local mine = S:Save(nil, { text = "Mine", saveAs = "mine", outputs = { alert = true } })
  E:EditSaved(mine)
  assert(value("Save as") == "mine" and not w.forRow.shown, "only me: no For")
  pick("Save as", "note") pick("For", "DRUID")
  assert(w.forRow.shown)
  click(w.saveBtn)
  assert(S:Get(mine).saveAs == "note" and S:Get(mine).tags[1] == "DRUID", "Save as and For saved")
  print("ok editor: edit a saved alert")
end

-- editor: a rename or delete elsewhere while a saved alert is open
do
  resetSaved()
  local id = S:Save(nil, full())
  E:EditSaved(id)
  local w = win()
  S:Rename(id, "Renamed on the chip")
  assert(w.title == "Template: Renamed on the chip", "the title follows a rename: " .. tostring(w.title))
  typeInto(w.textEdit, "Edited")
  click(w.saveBtn)
  assert(not w.shown and S:Get(id).name == "Renamed on the chip" and S:Get(id).text == "Edited", "Save keeps the new name: " .. S:Get(id).name)
  -- deleted while open: says so; Save makes nothing
  E:EditSaved(id)
  S:Delete(id)
  assert(w.shown and message():find("deleted", 1, true), "says it is gone: " .. message())
  typeInto(w.textEdit, "Again")
  click(w.saveBtn)
  assert(w.shown and S:Get(id) == nil and #S:List() == 0 and message():find("deleted", 1, true), "not made again: " .. message())
  -- another saved alert changing leaves the title be; a new one keeps its title
  local a = S:Save(nil, { text = "A", outputs = { alert = true } })
  local b = S:Save(nil, { text = "B", outputs = { alert = true } })
  E:EditSaved(a)
  S:Rename(b, "Bee")
  assert(w.title == "Template: A" and message() == "", "another one renamed: " .. w.title)
  E:EditSaved(nil)
  S:Rename(a, "Ay")
  assert(w.title == "New template", w.title)
  -- an ordinary alert open: untouched
  E:Open(ENC, nil, {})
  S:Rename(a, "Ayy")
  assert(w.title == "Alert", w.title)
  E:Close()
  S:Rename(a, "Ayyy")
  assert(not w.shown, "closed stays closed")
  print("ok editor: rename or delete elsewhere while open")
end

-- (final fix I1) the caller's Save as wins over the saved alert's own: an admin's Raid note saved
-- alert asked for as Only me (the Personal notes row) opens as Only me, in the real editor
do
  resetSaved()
  local id = S:Save(nil, full())
  assert(S:Get(id).saveAs == "note" and Notes:CanEditRaid() == true, "an admin and a Raid note saved alert")
  local pre = S:Prefill(id, ENC, 1, 20, nil, "Test Boss")
  pre.saveAs = "mine"
  E:Open(ENC, nil, pre)
  assert(value("Save as") == "mine" and not win().forRow.shown, "prefill Only me wins: " .. tostring(value("Save as")))
  -- no Save as asked for: the saved alert's own
  E:Open(ENC, nil, S:Prefill(id, ENC, 1, 20, nil, "Test Boss"))
  assert(value("Save as") == "note", "its own Raid note otherwise")
  print("ok editor: saved alert opened as only me")
end

-- (final fix I1) View's PlaceSaved on the Personal notes lane, through the real editor: a mine draft
do
  resetSaved()
  local id = S:Save(nil, full())
  local View = assert(CRT.TimelineView, "View.lua loaded")
  local Methods
  for i = 1, 60 do
    local name, v = debug.getupvalue(View.Create, i)
    if not name then break end
    if name == "Methods" then Methods = v end
  end
  assert(Methods and Methods.PlaceSaved, "the view's methods")
  local pv = setmetatable({ encounterID = ENC, bossName = "Test Boss" }, Methods)
  pv:PlaceSaved(id, 45, nil, { kind = "personal" })
  assert(win().shown and value("Save as") == "mine" and win().textEdit.text == "Soak now" and win().timeEdit.text == "0:45", "dropped on Personal notes: a mine draft: " .. tostring(value("Save as")))
  click(win().saveBtn)
  local r = R:Get(ENC, 1)
  assert(r and r.times == "P1 0:45" and r.text == "Soak now" and #CRT.db.notes.list == 0, "saved as your reminder, no raid note: " .. tostring(r and r.times))
  -- another lane keeps the saved alert's Raid note
  pv:PlaceSaved(id, 45, nil, { kind = "reference" })
  assert(value("Save as") == "note", "elsewhere: Raid note")
  print("ok personal: PlaceSaved on Personal notes opens a mine draft")
end
do
  -- starter templates: added once, as your own; Healthstone pinned first; yours of that name pinned instead
  local S = CRT.AlertSaved
  local fires = 0
  CRT.db.alerts.saved, CRT.db.alerts.nextSavedId, CRT.db.alerts.starters = {}, 1, nil
  local zed = S:Save(nil, { name = "Aaa first by name", outputs = { alert = true } })
  local before = 0
  local list = S:List()
  local names = {}
  for _, e in ipairs(list) do names[#names + 1] = e.s.name end
  assert(names[1] == "Healthstone" and names[2] == "Health potion", "Healthstone, then Health potion, pinned first: " .. table.concat(names, ","))
  assert(list[2].s.iconID == 7548909, "Health potion's icon")
  assert(table.concat(names, ","):find("Gate"), "Gate added")
  local hs = list[1].s
  assert(hs.iconID == 538745 and hs.saveAs == "mine" and hs.outputs.alert and hs.outputs.bar and hs.outputs.speech and hs.warn == 5, "Healthstone's defaults")
  local gate
  for _, e in ipairs(list) do if e.s.name == "Gate" then gate = e end end
  assert(gate.s.iconID == 607512 and gate.s.pin == nil, "Gate: its icon, not pinned")
  -- a deleted starter never comes back
  S:Delete(gate.id)
  local again = S:List()
  for _, e in ipairs(again) do assert(e.s.name ~= "Gate", "a deleted starter stays deleted") end
  assert(#again == 3, "nothing doubled: " .. #again)
  -- your own Healthstone is pinned instead of a copy
  CRT.db.alerts.saved, CRT.db.alerts.nextSavedId, CRT.db.alerts.starters = {}, 1, nil
  local mine = S:Save(nil, { name = "healthstone", text = "Pop it", outputs = { text = true } })
  local l2 = S:List()
  local count = 0
  for _, e in ipairs(l2) do if e.s.name:lower() == "healthstone" then count = count + 1 end end
  assert(count == 1 and l2[1].id == mine and S:Get(mine).text == "Pop it", "yours pinned, unchanged, no copy")
  -- an edit keeps the pin
  S:Save(mine, { name = "healthstone", text = "Pop it now", outputs = { text = true } })
  assert(S:Get(mine).pin == 1, "an edit keeps the pin")
  CRT.db.alerts.starters = { healthstone = true, healthpotion = true, gate = true }
  print("ok starter templates")
end
-- shield bar: a template keeps it (Saved:Save), opens with it in the editor, and Save as template takes it
do
  resetSaved()
  local f = full()
  f.absorb = { unit = "boss2", length = 15, anyDifficulty = true }
  local id = S:Save(nil, f)
  local s = S:Get(id)
  assert(s.absorb and s.absorb.unit == "boss2" and s.absorb.length == 15 and s.absorb.anyDifficulty == true, "the template keeps its absorb")
  assert(s.absorb ~= f.absorb, "a copy")
  local bad = S:Save(nil, { name = "Bad", outputs = { bar = true }, absorb = { unit = "target", length = 15 } })
  assert(S:Get(bad).absorb == nil, "an absorb that doesn't read is left out")
  assert(S:Get(S:Save(nil, { name = "None", outputs = { bar = true } })).absorb == nil, "none: none")
  -- the editor opens it with Shield bar ticked
  assert(E:EditSaved(id))
  assert(win().shield.check.checked == true and value("Shield on") == "boss2", "EditSaved: Shield bar on Boss 2")
  E:Close()
  E:Open(ENC, nil, S:Prefill(id, ENC, 1, 20, nil, "Test Boss"))
  assert(win().shield.check.checked == true and value("Shield on") == "boss2", "placed on a boss: Shield bar on Boss 2")
  local made = S:Save(nil, (function() local r = CRT.AlertDraft.BuildReminder({}, CRT.AlertDraft.ForReminder({ text = "x", outputs = { bar = true }, absorb = { unit = "boss4", length = 9, anyDifficulty = false } })) r.saveAs = "mine" return r end)())
  assert(S:Get(made).absorb.unit == "boss4" and S:Get(made).absorb.length == 9 and S:Get(made).absorb.anyDifficulty == false, "a draft's shield bar becomes a template's")
  E:Close()
  print("ok shield bar: templates keep it")
end
-- speak at: templates keep it
do
  resetSaved()
  local id = S:Save(nil, { text = "Zero", outputs = { alert = true, speech = true }, speech = "text", speakAt = "zero" })
  assert(S:Get(id).speakAt == "zero", "Save keeps speakAt")
  local plain = S:Save(nil, { text = "Plain", outputs = { alert = true, speech = true }, speech = "text" })
  assert(S:Get(plain).speakAt == nil, "none: on show")
  assert(S:Save(nil, { text = "Bad", outputs = { alert = true }, speakAt = "later" }) and S:Get(3).speakAt == nil, "only zero is kept")
  assert(S:Prefill(id, ENC, 1, 10).speakAt == "zero", "Prefill carries it")
  E:Open(ENC, nil, S:Prefill(id, ENC, 1, 10, nil, "Test Boss"))
  assert(value("Speak at") == "zero", "a template placed opens At 0")
  E:Close()
  -- Save As Template from the editor keeps it
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss" })
  local w = win()
  pick("Speak at", "zero")
  click(w.saveSavedBtn)
  StaticPopup1.EditBox:SetText("Zero tpl")
  StaticPopup1.accept()
  local made
  for _, e in ipairs(S:List()) do if e.s.name == "Zero tpl" then made = e.s end end
  assert(made and made.speakAt == "zero", "Save As Template keeps At 0")
  E:Close()
  -- editing a template itself
  assert(E:EditSaved(id))
  assert(value("Speak at") == "zero", "EditSaved reads it")
  pick("Speak at", "show")
  click(w.saveBtn)
  assert(S:Get(id).speakAt == nil, "and saves On show as nothing")
  -- the cooldown template
  local ct = CRT.AlertDraft.CooldownTemplate()
  assert(ct.speakAt == "zero", "CooldownTemplate carries it")
  print("ok speak at: templates keep it")
end

`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
