// Alerts/Editor.lua: the popout alert editor (Stage 2a), with mock frames. UI/Panel.lua is loaded for the
// real window look (UI:StyleWindow, UI:ApplyStyle); its controls are replaced by recording mocks.
// Usage: node run_alerts_editor.js UI/Panel.lua Timeline/Data.lua Timeline/Database.lua Timeline/Reference.lua
//   Timeline/Lanes.lua Alerts/Rules.lua Alerts/Engine.lua Alerts/Speech.lua Notes/Parse.lua Notes/Data.lua
//   Notes/Engine.lua Alerts/Reminders.lua Alerts/Editor.lua
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
-- a secret value stands in as SECRET: the game hides it from comparisons and tests
local SECRET = setmetatable({}, { __tostring = function() return "<secret>" end })
function issecretvalue(v) return v == SECRET end
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
-- the group as the game reports it: booleans (secret values possible). You lead the raid by default.
local group = { raid = true, party = true, leader = true, assist = false }
function IsInRaid() return group.raid end
function IsInGroup() return group.party end
function UnitIsGroupLeader(unit) if unit == "player" then return group.leader end return false end
function UnitIsGroupAssistant(unit) if unit == "player" then return group.assist end return false end
local function setMember() group.raid, group.party, group.leader, group.assist = true, true, false, false end
local REASON = "Only the raid leader or assistants can change the raid note."
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

local layers, previews, helps, dropdowns, sliders = {}, {}, {}, {}, {}
local CRT = {
  db = {
    ui = { modern = true, layers = {} },
    window = { scale = 100 },
    timeline = { references = {}, nextRef = 1, record = true, rows = {} },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
    notes = { list = {}, nextId = 1, alert = { enabled = true, tts = true, seconds = 10, ttsSeconds = 3 } },
  },
}
CRT.MOCHA = { espresso = { 0.11, 0.078, 0.063 }, roast = { 0.165, 0.122, 0.098 }, edge = { 0.3, 0.235, 0.188 },
  mocha = { 0.44, 0.31, 0.22 }, caramel = { 0.78, 0.56, 0.36 }, latte = { 0.87, 0.73, 0.56 }, cream = { 0.95, 0.9, 0.84 } }
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
function CRT:PlaySound() end
assert(load(sources[1], "Panel"))("CowfeeRaidTools", CRT)
local UI = CRT.UI
assert(UI.StyleWindow and UI.ApplyStyle and UI.SkinTree, "Panel API")
UI.RegisterLayer = function(_, key, f) layers[key] = f end
UI.RegisterPreview = function(_, key, fn) previews[key] = fn end
UI.ResetButton = function(parent, fn) local b = mock("Button", parent) rawset(b, "onReset", fn) rawset(b, "isReset", true) return b end
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
local function loadSource(i, src)
  if src:find("function UI.PickColor", 1, true) then -- the real UI/Controls.lua: only PickColor is taken, the harness keeps its own Dropdown and Slider
    local tmp = { UI = {} }
    assert(load(src, "UI/Controls.lua"))("CowfeeRaidTools", tmp)
    CRT.UI.PickColor = tmp.UI.PickColor
  else
    assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
  end
end
for i = 2, #sources do
  loadSource(i, sources[i])
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
  group.raid, group.party, group.leader, group.assist = true, true, true, false
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

-- open new prefilled from spell
do
  reset()
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss" })
  local w = win()
  assert(w and w.shown, "window shown")
  assert(w.w == 600 and w.h == 480, "fits 600 x 480: " .. tostring(w.w) .. "x" .. tostring(w.h))
  assert(layers.panel ~= w and previews.alerteditor, "not on the panel layer; preview registered")
  assert(w.strata == "FULLSCREEN_DIALOG" and w.toplevel == true, "editor above every window: " .. tostring(w.strata))
  assert(UISpecialFrames[1] == "CowfeeRaidToolsAlertEditor", "closed by Escape")
  assert(w.title == "Alert", w.title)
  assert(w.textEdit.text == "Real Name", "text defaults to the spell name: " .. w.textEdit.text)
  assert(value("Save as") == "mine" and not w.forRow.shown, "Only me, no For row")
  assert(value("Icon") == "spell" and w.idEdit.text == "777" and w.iconPreview.texture == "tex777" and w.iconPreview.shown, "spell icon")
  assert(w.timeEdit.text == "", "no time")
  assert(not w.deleteBtn.shown, "delete hidden for new")
  assert(w.checks.alert.checked and w.checks.bar.checked and not w.checks.text.checked and w.also.speak.checked, "default outputs")
  assert(sliders["Show from"].opts.get() == 5 and sliders["Show from"].opts.min == 1 and sliders["Show from"].opts.max == 60)
  assert(sliders["Linger"].opts.get() == 0 and sliders["Linger"].opts.min == 0 and sliders["Linger"].opts.max == 10)
  assert(value("Relative to") == 1 and optionList(dropdowns["Relative to"])[1].label == "Pull")
  assert(value("Difficulty") == "any" and value("Sound") == "none")
  assert(optionKeys(dropdowns["Sound"]) == "none,kit:RAID_WARNING,kit:READY_CHECK,kit:RAID_BOSS_EMOTE_WARNING,kit:UI_RAID_BOSS_WHISPER_WARNING,kit:ALARM_CLOCK_WARNING_3,kit:PVP_THROUGH_QUEUE,kit:TELL_MESSAGE", optionKeys(dropdowns["Sound"]))
  assert(w.sourceText.text == "No times", "no matching row: " .. w.sourceText.text)
  E:Open(ENC, nil, { spellID = 777, text = "Custom", times = "P1 0:10" })
  assert(w.textEdit.text == "Custom" and w.timeEdit.text == "0:10" and w.sourceText.text:find("P1 0:10", 1, true), w.sourceText.text)
  for _, f in ipairs(fontStrings) do assert(not (f.text or ""):find("aved alert"), "no saved alert wording (they are templates now)") end
  print("ok editor: open new prefilled from spell")
end

-- save as mine saves a reminder, with the new fields beside the old
do
  reset()
  local src = function() return { 2 } end
  table.insert(A.phaseSources, src)
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss" })
  local w = win()
  assert(hasOption(dropdowns["Relative to"], 2) and hasOption(dropdowns["Relative to"], 2).label == "Phase 2", "phase 2 offered")
  typeInto(w.textEdit, "  Soak now ")
  pick("Relative to", 2)
  typeInto(w.timeEdit, "1:30")
  setCheck(w.checks.bar, false)
  setCheck(w.checks.text, true) setCheck(w.checks.icon, true) setCheck(w.checks.circle, true)
  setCheck(w.also.count, true) setCheck(w.also.glow, true)
  pick("Sound", "kit:RAID_WARNING")
  sliders["Show from"].opts.set(8) sliders["Linger"].opts.set(3)
  pick("Icon", "id") typeInto(w.idEdit, "135940")
  assert(w.iconPreview.texture == 135940, "icon ID preview")
  click(w.colorSwatch)
  assert(ColorPickerFrame.strata == "FULLSCREEN_DIALOG" and ColorPickerFrame.raised, "colour picker above the editor")
  ColorPickerFrame:Hide()
  assert(ColorPickerFrame.strata == "DIALOG", "picker strata restored on hide")
  click(w.colorSwatch)
  assert(ColorPickerFrame.strata == "FULLSCREEN_DIALOG" and #ColorPickerFrame.hooks.OnHide == 1, "lifted again, hooked once")
  ColorPickerFrame:Hide()
  picker.r, picker.g, picker.b = 1, 0.5, 0 picker.info.swatchFunc()
  pick("Difficulty", "Mythic")
  assert(message() == "", message())
  click(w.saveBtn)
  local r = R:Get(ENC, 1)
  assert(r, "saved as 1")
  assert(r.text == "Soak now" and r.times == "P2 +1:30" and r.spellID == 777 and r.boss == "Test Boss", tostring(r.times))
  assert(r.outputs.bar == false and r.outputs.alert == true and r.outputs.text and r.outputs.icon and r.outputs.circle, "outputs")
  assert(r.outputs.speech == true and r.speech == "textcount", "speak + count")
  print("DBGSND", tostring(r.sound), tostring(r.warn), tostring(r.linger), tostring(r.glow), tostring(r.iconID)) assert(r.warn == 8 and r.linger == 3 and r.sound == "kit:RAID_WARNING" and r.glow == true and r.iconID == 135940, "new fields")
  assert(r.color[1] == 1 and r.color[2] == 0.5 and r.color[3] == 0, "color")
  assert(r.difficulty == "Mythic" and r.priority == "normal" and r.enabled == true)
  assert(not w.shown, "closed after save")
  -- edit it again: the fields read back, and the speech mapping follows the boxes
  CRT.db.alerts.reminders[ENC][1].enabled = false
  E:Open(ENC, 1)
  assert(w.deleteBtn.shown and value("Relative to") == 2 and w.timeEdit.text == "1:30" and w.also.speak.checked and w.also.count.checked)
  assert(value("Icon") == "id" and w.idEdit.text == "135940" and value("Sound") == "kit:RAID_WARNING" and w.also.glow.checked)
  setCheck(w.also.count, false)
  click(w.saveBtn)
  assert(R:Get(ENC, 1).speech == "text" and R:Get(ENC, 1).enabled == false and CRT.db.alerts.nextId == 2, "speak only, same id")
  E:Open(ENC, 1) setCheck(w.also.speak, false) setCheck(w.also.count, true) click(w.saveBtn)
  assert(R:Get(ENC, 1).speech == "count" and R:Get(ENC, 1).outputs.speech == true, "count only")
  E:Open(ENC, 1) setCheck(w.also.count, false) click(w.saveBtn)
  assert(R:Get(ENC, 1).outputs.speech == false, "neither: speech off")
  for i = #A.phaseSources, 1, -1 do if A.phaseSources[i] == src then table.remove(A.phaseSources, i) end end
  print("ok editor: save as mine saves a reminder")
end

-- a Stage 1 reminder keeps its times text unless Relative to or Time is touched
do
  reset()
  R:Save(ENC, nil, { text = "Old", boss = "Test Boss", times = "P1 0:10, 0:20; P2 +0:05", warn = 6, speech = "textcount", priority = "high" })
  E:Open(ENC, 1)
  local w = win()
  assert(w.timeEdit.text == "0:10" and value("Relative to") == 1, "first time shown")
  assert(w.sourceText.text:find("P1 0:10, 0:20; P2 +0:05", 1, true), w.sourceText.text)
  assert(w.also.speak.checked and w.also.count.checked, "textcount reads as both boxes")
  typeInto(w.textEdit, "Renamed")
  click(w.saveBtn)
  local r = R:Get(ENC, 1)
  assert(r.text == "Renamed" and r.times == "P1 0:10, 0:20; P2 +0:05" and r.priority == "high" and r.warn == 6, "times kept: " .. tostring(r.times))
  -- reference times (nil) stay nil
  R:Save(ENC, nil, { text = "Ability", boss = "Test Boss" })
  E:Open(ENC, 2)
  assert(w.sourceText.text:find("From Abilities", 1, true), w.sourceText.text)
  click(w.saveBtn)
  assert(R:Get(ENC, 2).times == nil, "reference kept")
  -- touching the time replaces the list
  E:Open(ENC, 1)
  typeInto(w.timeEdit, "45")
  click(w.saveBtn)
  assert(R:Get(ENC, 1).times == "P1 0:45", tostring(R:Get(ENC, 1).times))
  print("ok editor: a stage 1 reminder keeps its times")
end

-- bad time blocks save
do
  reset()
  E:Open(ENC, nil, { text = "X" })
  local w = win()
  typeInto(w.timeEdit, "0:xx")
  assert(message():find("bad time", 1, true) and message():find("ff6060", 1, true), "error in red: " .. message())
  assert(w.saveBtn.enabled, "save stays enabled")
  click(w.saveBtn)
  assert(R:Get(ENC, 1) == nil and w.shown, "nothing saved, window stays")
  typeInto(w.timeEdit, "0:10")
  assert(message() == "", message())
  click(w.saveBtn)
  assert(R:Get(ENC, 1) and R:Get(ENC, 1).times == "P1 0:10")
  print("ok editor: bad time blocks save")
end

-- nothing ticked refuses save
do
  reset()
  E:Open(ENC, nil, { text = "Quiet", times = "P1 0:10" })
  local w = win()
  for _, k in ipairs({ "alert", "text", "icon", "bar", "circle" }) do setCheck(w.checks[k], false) end
  setCheck(w.also.speak, false) setCheck(w.also.count, false)
  pick("Sound", "kit:RAID_WARNING")
  click(w.saveBtn)
  assert(R:Get(ENC, 1) == nil and w.shown and message():find("Tick", 1, true), "refused: " .. message())
  assert(E:Test() == false and not A.running, "test refused too")
  setCheck(w.also.count, true)
  assert(message() == "", "message clears on a change")
  click(w.saveBtn)
  assert(R:Get(ENC, 1) and R:Get(ENC, 1).speech == "count", "count alone is enough")
  print("ok editor: nothing ticked refuses save")
end

-- opens for a note line
local NOTE = "EncounterID:9001;Difficulty:Heroic;Name:Test Boss\\nFree text here\\ntime:34;ph:2;tag:Druid;spellid:888;text:Dodge;dur:4;colors:1 0 0 1;show:text,circle;tts:1;sound:READY_CHECK;warn:7;linger:2;icon:135940;\\ntime:50;ph:1;text:Other;"
do
  reset()
  local id = Notes:Import(NOTE)
  E:OpenNote(id, 3)
  local w = win()
  assert(w.shown and value("Save as") == "note" and w.forRow.shown, "note line, For shown")
  -- (S19) a class tag reads back as the class file name
  assert(value("For") == "DRUID" and value("Difficulty") == "Heroic" and value("Relative to") == 2 and w.timeEdit.text == "0:34")
  assert(w.textEdit.text == "Dodge" and value("Icon") == "id" and w.idEdit.text == "135940")
  assert(w.checks.text.checked and w.checks.circle.checked and not w.checks.alert.checked and not w.checks.bar.checked)
  assert(w.also.speak.checked and not w.also.count.checked and not w.also.glow.checked and value("Sound") == "kit:READY_CHECK")
  assert(sliders["Show from"].opts.get() == 7 and sliders["Linger"].opts.get() == 2 and w.deleteBtn.shown)
  assert(w.colorSwatch.tex.color[1] == 1 and w.colorSwatch.tex.color[2] == 0, "color swatch")
  -- a line that is not a timed line does not open
  assert(E:OpenNote(id, 2) == false, "free text refused")
  -- an unchanged save writes the same fields back, keeping dur
  E:OpenNote(id, 3)
  click(w.saveBtn)
  local t = Notes:TimerAt(id, 3)
  assert(t and t.dur == 4 and t.spellId == 888 and t.text == "Dodge" and t.tts and t.warn == 7 and t.iconID == 135940 and t.sound == "READY_CHECK")
  assert(noteRaw(id):find("Free text here\\ntime:34;", 1, true) and noteRaw(id):find("\\ntime:50;ph:1;text:Other;$"), noteRaw(id))
  print("ok editor: opens for a note line")
end

-- a time dropped on the Timeline keeps its tenths when saved as your own, and reads back
do
  reset()
  E:Open(ENC, nil, { text = "Tenths", boss = "Test Boss", ph = 1, time = 12.4 })
  local w = win()
  assert(w.timeEdit.text == "12.4", w.timeEdit.text)
  click(w.saveBtn)
  local list = R:List(ENC)
  assert(#list == 1 and list[1].r.times == "P1 0:12.4", tostring(list[1] and list[1].r.times))
  E:Open(ENC, list[1].id)
  assert(w.timeEdit.text == "12.4", "reopened: " .. w.timeEdit.text)
  print("ok editor: a dropped time keeps its tenths")
end

-- save as note adds a line
do
  reset()
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss", saveAs = "note", ph = 1, time = 12.4 })
  local w = win()
  assert(value("Save as") == "note" and w.forRow.shown and w.timeEdit.text == "12.4", "prefill as a note line keeps its tenths: " .. tostring(w.timeEdit.text))
  assert(value("For") == "everyone", "a new note line is for everyone: " .. tostring(value("For")))
  assert(w.savesText.text == "Saves to: a new note for this boss", w.savesText.text)
  pick("For", "DEATHKNIGHT")
  pick("Difficulty", "Mythic")
  typeInto(w.textEdit, "Soak; now\\nplease")
  setCheck(w.checks.text, true)
  click(w.saveBtn)
  assert(not w.shown, "closed")
  local id = Notes:FindForEncounter(ENC, "Mythic")
  assert(id, "note made")
  assert(Notes:Get(id).difficulty == "Mythic" and Notes:Get(id).encounterID == ENC, "numeric encounter, difficulty")
  local raw = noteRaw(id)
  assert(raw:find("^EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\n"), raw)
  local t = Notes:TimerAt(id, 2)
  assert(t.time == 12.4 and t.ph == 1 and t.tags[1] == "DEATHKNIGHT" and t.spellId == 777, "fields")
  assert(t.text == "Soak now please" and not raw:find("Soak;", 1, true), "; and line ends stripped: " .. tostring(t.text))
  assert(t.show.alert and t.show.bar and t.show.text and not t.show.icon and t.tts and t.warn == 5, "outputs")
  assert(#R:List(ENC) == 0, "no reminder")
  -- Everyone writes tag:everyone (a line with no tag alerts no one), and the Difficulty starts on the
  -- boss's only note
  E:Open(ENC, nil, { text = "All", saveAs = "note", ph = 1, time = 20 })
  assert(value("For") == "everyone" and not hasOption(dropdowns["For"], ""), "Everyone, and no No one choice")
  assert(value("Difficulty") == "Mythic" and w.savesText.text == "Saves to: Test Boss (Mythic)",
    "difficulty " .. tostring(value("Difficulty")) .. ", " .. w.savesText.text)
  click(w.saveBtn)
  assert(noteRaw(id):find("\\ntime:20;ph:1;tag:everyone;text:All;", 1, true), noteRaw(id))
  -- end to end: a pull builds the saved line's item through the real IsMine, and it alerts you
  local saved
  for _, t2 in ipairs(Notes:Parsed(id).timers) do if t2.text == "All" then saved = t2 end end
  assert(saved and CRT.NoteEngine:IsMine(saved), "IsMine: everyone is you")
  A.HandleEvent("ENCOUNTER_START", ENC, "Boss", 16)
  local item
  for _, it in ipairs(A.items) do if it.block == "note" and it.text == "All" then item = it end end
  assert(item and item.outputs and item.outputs.alert and item.outputs.bar and item.outputs.speech, "the pull's item alerts")
  clock = A:PhaseStart(1) + 18
  local best = CRT.AlertRules.Alert(A:Lines(clock), clock)
  assert(best and best.text == "All", "shows on the Next spell alert")
  A:Stop(true)
  clock = 100
  -- a boss without a numeric encounter ID can't take a note line
  E:Open("Some Boss", nil, { text = "No", saveAs = "note", time = 5 })
  click(w.saveBtn)
  assert(w.shown and message() ~= "", "refused without an encounter ID")
  print("ok editor: save as note adds a line")
end

-- a note line changed elsewhere is never overwritten
do
  reset()
  local id = Notes:Import(NOTE)
  E:OpenNote(id, 4)
  local w = win()
  typeInto(w.textEdit, "Mine now")
  -- someone shares a new version: line 4 changes
  Notes:UpdateRaw(id, (noteRaw(id):gsub("text:Other;", "text:Changed;")))
  local before = noteRaw(id)
  assert(E:Save() == false, "stale save refused")
  assert(w.shown and message():find("changed", 1, true), "message: " .. message())
  assert(noteRaw(id) == before, "note untouched")
  -- delete is refused the same way
  click(w.deleteBtn)
  popups[#popups].callback()
  assert(noteRaw(id) == before and w.shown, "stale delete refused")
  -- a fresh open edits it
  E:OpenNote(id, 4)
  typeInto(w.textEdit, "Fresh")
  assert(E:Save() == true and Notes:TimerAt(id, 4).text == "Fresh")
  E:OpenNote(id, 4)
  click(w.deleteBtn)
  popups[#popups].callback()
  assert(not noteRaw(id):find("Fresh", 1, true) and noteRaw(id):find("Free text here", 1, true) and not w.shown, "deleted the line only")
  print("ok editor: stale note line refused")
end

-- switching save as moves it
do
  reset()
  R:Save(ENC, nil, { text = "Move me", boss = "Test Boss", times = "P1 0:30" })
  E:Open(ENC, 1)
  local w = win()
  pick("Save as", "note")
  assert(w.forRow.shown, "For shows for a note line")
  click(w.saveBtn)
  assert(R:Get(ENC, 1) == nil, "reminder gone")
  local id = Notes:FindForEncounter(ENC, nil)
  assert(id and Notes:TimerAt(id, 2) and Notes:TimerAt(id, 2).text == "Move me" and Notes:TimerAt(id, 2).time == 30, "line added")
  -- and back
  E:OpenNote(id, 2)
  pick("Save as", "mine")
  assert(not w.forRow.shown)
  click(w.saveBtn)
  assert(Notes:TimerAt(id, 2) == nil, "line removed")
  local list = R:List(ENC)
  assert(#list == 1 and list[1].r.text == "Move me" and list[1].r.times == "P1 0:30", "reminder saved")
  -- a note line moved to another difficulty goes to that difficulty's note
  CRT.db.notes.list = {} CRT.db.notes.nextId = 1
  local h = Notes:Import(NOTE)
  local mythic = Notes:Import("EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\ntime:1;tag:everyone;text:M;")
  E:OpenNote(h, 4)
  assert(w.savesText.text == "Saves to: Test Boss (Heroic)", w.savesText.text)
  pick("Difficulty", "Mythic")
  assert(w.savesText.text == "Saves to: Test Boss (Mythic)", w.savesText.text)
  click(w.saveBtn)
  local m = Notes:FindForEncounter(ENC, "Mythic")
  assert(m == mythic and Notes:TimerAt(m, 3).text == "Other" and not noteRaw(h):find("Other", 1, true), "moved to Mythic")
  -- (S18) with no Mythic note, a Mythic pull reads the Heroic note: the line stays where it is
  CRT.db.notes.list = {} CRT.db.notes.nextId = 1
  h = Notes:Import(NOTE)
  E:OpenNote(h, 4)
  pick("Difficulty", "Mythic")
  assert(w.savesText.text == "Saves to: Test Boss (Heroic)", "saves to the note the pull reads: " .. w.savesText.text)
  typeInto(w.textEdit, "Still here")
  click(w.saveBtn)
  local count = 0
  for _ in pairs(CRT.db.notes.list) do count = count + 1 end
  assert(count == 1 and Notes:TimerAt(h, 4).text == "Still here", "replaced in place, no new note")
  print("ok editor: switching save as moves it")
end

-- the For list
do
  reset()
  E:Open(ENC, nil, { saveAs = "note" })
  local keys = "," .. optionKeys(dropdowns["For"]) .. ","
  for _, k in ipairs({ "everyone", "Me", "tank", "healer", "dps", "melee", "ranged", "WARRIOR", "DEATHKNIGHT", "DRUID", "G1", "G8", "Alexi", "Bob" }) do
    assert(keys:find("," .. k .. ",", 1, true), "For has " .. k .. ": " .. keys)
  end
  assert(optionList(dropdowns["For"])[1].label == "Everyone" and optionList(dropdowns["For"])[2].label == "Me")
  assert(type(dropdowns["For"].opts.maxHeight) == "number" and dropdowns["For"].opts.maxHeight <= 420, "For scrolls")
  assert(type(dropdowns["Sound"].opts.maxHeight) == "number", "Sound scrolls")
  for _, label in ipairs({ "Save as", "Difficulty", "Relative to", "Icon" }) do assert(dropdowns[label].opts.maxHeight == nil, label .. " unchanged") end
  assert(hasOption(dropdowns["For"], "DEATHKNIGHT").label == "Death Knight", "class names shown as the game names them")
  assert(not hasOption(dropdowns["For"], "") and not hasOption(dropdowns["For"], "DeathKnight"), "no empty or localized class keys")
  local _, count = keys:gsub(",Me,", "")
  assert(count == 1, "you are listed once")
  -- a tag the list doesn't have is kept as a choice
  local id = Notes:Import("EncounterID:9001\\ntime:5;tag:Alexi Bob;text:Pair;")
  E:OpenNote(id, 2)
  assert(value("For") == "Alexi Bob" and hasOption(dropdowns["For"], "Alexi Bob"), "own tag kept")
  print("ok editor: for list has classes and roster")
end

-- export shows the note line
do
  reset()
  E:Open(ENC, nil, { spellID = 777, text = "Out; now", saveAs = "note", ph = 2, time = 65 })
  local w = win()
  pick("For", "healer")
  click(w.exportBtn)
  local x = created.CowfeeRaidToolsAlertExport
  assert(x and x.shown and x.edit, "export window")
  local text = x.edit.text
  assert(text:find("^time:65;ph:2;tag:healer;spellid:777;text:Out now;"), text)
  assert(x.edit.highlighted, "text selected")
  local t = P.Parse(text).timers[1]
  assert(t and t.time == 65 and t.ph == 2 and t.show.alert and t.show.bar, "parses back")
  -- read-only: typing puts it back
  typeInto(x.edit, "oops")
  assert(x.edit.text == text, "read-only")
  assert(#R:List(ENC) == 0 and next(CRT.db.notes.list) == nil, "export saves nothing")
  assert(x.crtBg, "export box follows the look")
  -- a time that does not read is not exported
  x:Hide()
  typeInto(w.timeEdit, "")
  assert(E:Export() == nil and not x.shown and message():find("Type a time", 1, true), "no time, no export: " .. message())
  typeInto(w.timeEdit, "1:o5")
  assert(E:Export() == nil and not x.shown and message():find("bad time", 1, true), "bad time, no export")
  print("ok editor: export shows the note line")
end

-- test shows every ticked display, saving nothing
do
  reset()
  E:Open(ENC, nil, { text = "Draft", times = "P1 0:30" })
  local w = win()
  for _, k in ipairs({ "alert", "text", "icon", "bar", "circle" }) do setCheck(w.checks[k], true) end
  click(w.testBtn)
  assert(A.running and A.run.reason == "test" and #A.items == 1)
  local o = A.items[1].outputs
  assert(o.alert and o.text and o.icon and o.bar and o.circle and o.speech, "every display")
  assert(A.items[1].block == "minetest")
  A:Stop(true)
  -- a note line draft runs through the note block's item builder, as a note item
  local id = Notes:Import(NOTE)
  local before = noteRaw(id)
  E:OpenNote(id, 3)
  click(w.testBtn)
  assert(A.running and #A.items == 1, "one test item")
  local it = A.items[1]
  assert(it.block == "note" and it.ph == 2 and it.time == 34, "note item: " .. tostring(it.block))
  assert(it.outputs.text and it.outputs.circle and not it.outputs.alert and it.outputs.speech and it.sound == "READY_CHECK" and it.warn == 7)
  assert(A:PhaseStart(2) == clock + 10 - 34, "10 s out")
  assert(noteRaw(id) == before and #R:List(ENC) == 0, "nothing saved")
  print("ok editor: test shows every ticked display")
end

-- delete asks first
do
  reset()
  R:Save(ENC, nil, { text = "gone", times = "5" })
  E:Open(ENC, 1)
  local w = win()
  click(w.deleteBtn)
  assert(#popups == 1 and R:Get(ENC, 1), "asks first")
  assert(StaticPopup1.strata == "FULLSCREEN_DIALOG" and StaticPopup1.raised, "popup above the editor")
  StaticPopup1:Hide()
  assert(StaticPopup1.strata == "DIALOG", "popup strata restored on hide")
  StaticPopup1.shown = true click(w.deleteBtn) -- a second ask lifts it again, with one hook
  assert(StaticPopup1.strata == "FULLSCREEN_DIALOG" and #StaticPopup1.hooks.OnHide == 1, "lifted again, hooked once")
  StaticPopup1:Hide()
  popups[1].callback()
  assert(R:Get(ENC, 1) == nil and not w.shown, "deleted after accept")
  print("ok editor: delete asks first")
end

-- test runs only this reminder
do
  reset()
  R:Save(ENC, nil, { text = "Other", times = "5" })
  E:Open(ENC, nil, { text = "Draft", times = "P1 0:30, 1:00; P2 +0:10" })
  local w = win()
  setCheck(w.also.speak, false)
  click(w.testBtn)
  assert(A.running and A.run.reason == "test", "test run")
  assert(#A.items == 3, "three items: " .. #A.items)
  for _, it in ipairs(A.items) do assert(it.text == "Draft" and it.block == "minetest", "only the draft") end
  assert(A:PhaseStart(1) == clock + 10 - 30, "starts 10 s before the first time")
  assert(A.items[1].outputs.speech == false, "unsaved checkbox used")
  local lines = A:Lines(clock)
  assert(#lines >= 1 and lines[1].text == "Draft" and lines[1].at == clock + 10)
  A:Stop(true)
  A.HandleEvent("ENCOUNTER_START", ENC, "Boss", 16)
  for _, it in ipairs(A.items) do assert(it.text ~= "Draft", "draft never in a real pull") end
  assert(#errors == 0, tostring(errors[1]))
  print("ok editor: test runs only this reminder")
end

-- test saves nothing, does nothing on a bad time, and is refused mid-pull
do
  reset()
  R:Save(ENC, nil, { text = "Other", times = "5" })
  local before = #R:List(ENC)
  E:Open(ENC, nil, { text = "Draft", times = "P1 0:30" })
  local w = win()
  click(w.testBtn)
  assert(A.running, "test ran")
  assert(#R:List(ENC) == before and CRT.db.alerts.nextId == 2 and R:Get(ENC, 2) == nil, "nothing saved")
  A:Stop(true)
  typeInto(w.timeEdit, "oops")
  click(w.testBtn)
  assert(not A.running, "bad time: no test")
  assert(message():find("bad time", 1, true), "error stays shown")
  typeInto(w.timeEdit, "0:30")
  A.HandleEvent("ENCOUNTER_START", ENC, "Boss", 16)
  local run = A.run
  click(w.testBtn)
  assert(A.run == run, "real pull untouched")
  assert(message():find("during a pull", 1, true) and #printed == 0, "mid-pull refusal on the window: " .. message())
  A:Stop(true)
  -- the lowest phase has an event trigger: phase 1 would be the pull and P2 never starts
  for i = #printed, 1, -1 do printed[i] = nil end
  local src = function() return { 2 } end
  table.insert(A.phaseSources, src)
  pick("Relative to", 2)
  typeInto(w.timeEdit, "0:10")
  assert(E:Test() == false, "trigger phase: no test")
  assert(not A.running, "trigger phase: the empty run is stopped")
  assert(#printed == 0 and message():find("phase 2", 1, true), "trigger phase says so on the window: " .. message())
  for i = #A.phaseSources, 1, -1 do if A.phaseSources[i] == src then table.remove(A.phaseSources, i) end end
  print("ok editor: test saves nothing")
end

-- difficulty choices
do
  reset()
  E:Open(ENC, nil, { boss = "Test Boss" })
  assert(optionKeys(dropdowns["Difficulty"]) == "any,Mythic,Heroic,Normal", optionKeys(dropdowns["Difficulty"]))
  R:Save(ENC, nil, { text = "o", boss = "Test Boss", difficulty = "Story" })
  E:Open(ENC, 1)
  assert(optionKeys(dropdowns["Difficulty"]) == "any,Mythic,Heroic,Normal,Story", optionKeys(dropdowns["Difficulty"]))
  E:Open(ENC, nil, { text = "z" })
  pick("Difficulty", "Mythic") pick("Difficulty", "any")
  click(win().saveBtn)
  assert(R:Get(ENC, 2).difficulty == nil, "Any saves nil")
  print("ok editor: difficulty choices")
end

-- the editor opens on top, cancel closes
do
  reset()
  local before = rawget(win(), "raised") or 0
  E:Open(ENC, nil, { text = "x" })
  assert((rawget(win(), "raised") or 0) == before + 1, "Raise on open")
  click(win().cancelBtn)
  assert(not win().shown and #R:List(ENC) == 0, "cancel saves nothing")
  print("ok editor: raised on open")
end

-- reset button and preview
do
  reset()
  E:Open(ENC, nil, nil)
  local resetBtn
  for _, f in ipairs(frames) do if rawget(f, "isReset") and f.parent == win() then resetBtn = f end end
  assert(resetBtn, "reset button")
  resetBtn.onReset()
  assert(win().pts[1][1] == "CENTER")
  typeInto(win().textEdit, "Keep me")
  previews.alerteditor(true)
  assert(win().shown and win().textEdit.text == "Keep me", "previews on keeps the open draft")
  previews.alerteditor(false)
  assert(win().shown and win().textEdit.text == "Keep me", "previews off keeps the open draft")
  E:Close()
  previews.alerteditor(true)
  assert(win().shown and win().textEdit.text == "", "previews on opens an empty editor")
  assert(#win().pts == 1 and win().pts[1][1] == "BOTTOMRIGHT" and win().pts[1][4] < 0 and win().pts[1][5] > 0,
    "off the centre, clear of the areas: " .. tostring(win().pts[1][1]))
  previews.alerteditor(false)
  assert(not win().shown)
  assert(win().pts[1][1] == "CENTER", "back to the centre for the next open")
  -- dragged while in the corner: it keeps the spot the player gave it
  previews.alerteditor(true)
  win().OnDragStop(win())
  E:Close()
  assert(win().pts[1][1] == "BOTTOMRIGHT", "a dragged editor is not sent back")
  win():ClearAllPoints() win():SetPoint("CENTER", UIParent, "CENTER", 0, 0)
  previews.alerteditor(false)
  -- closed by Escape (the game hides it and runs OnHide) or Close (Save ends in Close) instead of Previews off
  for _, how in ipairs({ "escape", "close" }) do
    previews.alerteditor(true)
    assert(win().pts[1][1] == "BOTTOMRIGHT", how .. ": in the corner")
    if how == "escape" then
      win():Hide() win().OnHide(win())
    else
      E:Close()
    end
    assert(win().pts[1][1] == "CENTER" and #win().pts == 1, how .. ": back at the centre for the next Open")
    previews.alerteditor(false)
  end
  print("ok editor: reset and preview")
end

-- messages on the window: save without a boss, kept times that do not read, the colour picker
do
  reset()
  E:Open(nil, nil, { text = "Nowhere", times = "P1 0:10" })
  local w = win()
  assert(E:Save() == false and w.shown and message():find("boss", 1, true) and #printed == 0, "no boss: " .. message())
  CRT.db.alerts.reminders[ENC] = { [5] = { text = "Broken", times = "P1 0:xx", outputs = { alert = true } } }
  E:Open(ENC, 5)
  assert(message():find("0:xx", 1, true), "kept times error shown on open: " .. message())
  assert(E:Save() == false and R:Get(ENC, 5).times == "P1 0:xx", "kept bad times block save")
  typeInto(w.timeEdit, "0:20")
  assert(message() == "" and E:Save() == true and R:Get(ENC, 5).times == "P1 0:20", "typing a time replaces them")
  -- a picker opened on one alert never writes into the next
  E:Open(ENC, nil, { text = "First", times = "P1 0:10" })
  click(w.colorSwatch)
  local stale = picker.info
  E:Open(ENC, nil, { text = "Second", times = "P1 0:10" })
  picker.r, picker.g, picker.b = 0, 1, 0
  stale.swatchFunc() stale.cancelFunc()
  click(w.saveBtn)
  local second
  for _, e in ipairs(R:List(ENC)) do if e.r.text == "Second" then second = e.r end end
  assert(second and second.color == nil, "second alert untouched by the first picker")
  assert(A.blocks.minetest.label == "Alert test", "test block label")
  print("ok editor: messages on the window")
end

-- cancelling the colour picker puts back no colour on an alert that had none
do
  reset()
  E:Open(ENC, nil, { text = "Plain", times = "P1 0:10" })
  local w = win()
  click(w.colorSwatch)
  local info = picker.info
  picker.r, picker.g, picker.b = 0, 1, 0
  info.swatchFunc()
  assert(w.colorSwatch.tex.color[1] == 0 and w.colorSwatch.tex.color[2] == 1, "the picked colour shows on the swatch")
  info.cancelFunc()
  click(w.saveBtn)
  local plain
  for _, e in ipairs(R:List(ENC)) do if e.r.text == "Plain" then plain = e.r end end
  assert(plain and plain.color == nil, "cancelling the colour picker puts back no colour")
  print("ok editor: cancelling the colour picker puts back no colour")
end

-- the window follows the look
do
  reset()
  E:Open(ENC, nil, { text = "Look" })
  local w = win()
  assert(w.crtBg and w.crtBg.shown and w.crtTitleLine.shown, "Modern: flat background and title line")
  assert(w.crtBg.color[1] == CRT.MOCHA.espresso[1] and w.crtTitleLine.color[1] == CRT.MOCHA.caramel[1], "espresso and caramel")
  for _, t in ipairs(w.crtArt) do assert(t.shown == false, "template art hidden") end
  assert(w.Inset.shown == false, "Modern hides the inset")
  assert(#w.crtArt == 2, "only the template's own art: " .. #w.crtArt)
  assert(w.CloseButton.crtSkin, "the plain X")
  assert(w.saveBtn.crtSkin or not w.saveBtn.Left, "buttons skinned")
  CRT.db.ui.modern = false
  UI:ApplyStyle()
  assert(not w.crtBg.shown and not w.crtTitleLine.shown, "Classic: flat parts hidden")
  for _, t in ipairs(w.crtArt) do assert(t.shown == true, "template art back") end
  assert(w.Inset.shown == true, "Classic shows the inset")
  local x = created.CowfeeRaidToolsAlertExport
  assert(x and not x.crtBg.shown, "export box follows too")
  CRT.db.ui.modern = true
  UI:ApplyStyle()
  assert(w.crtBg.shown and x.crtBg.shown)
  assert(#errors == 0, tostring(errors[1]))
  print("ok editor: window follows the look")
end

-- (S20) a reminder with several times moved to the raid note writes one line per time
do
  reset()
  R:Save(ENC, nil, { text = "Many", boss = "Test Boss", times = "P1 0:10, 0:20; P2 +0:05", glow = true,
    outputs = { alert = true, text = true } })
  E:Open(ENC, 1)
  local w = win()
  pick("Save as", "note")
  assert(w.sourceText.text:find("P1 0:10, 0:20; P2 +0:05", 1, true), "times line shown in note mode: " .. w.sourceText.text)
  -- Test runs every time
  click(w.testBtn)
  assert(A.running and #A.items == 3, "three test items: " .. #A.items)
  for _, it in ipairs(A.items) do assert(it.block == "note" and it.text == "Many", "note items") end
  assert(A:PhaseStart(1) == clock + 10 - 10, "10 s before the first")
  A:Stop(true)
  -- Export: one note line per time, joined by newlines, and it writes nothing
  local exported = E:Export()
  local got = {}
  for l in (exported .. "\\n"):gmatch("(.-)\\n") do got[#got + 1] = l end
  assert(#got == 3, "three export lines: " .. exported)
  local wantEx = { { 1, 10 }, { 1, 20 }, { 2, 5 } }
  for i, l in ipairs(got) do
    local t = P.Parse(l).timers[1]
    assert(t and t.ph == wantEx[i][1] and t.time == wantEx[i][2] and t.text == "Many", "export line " .. i .. ": " .. l)
  end
  local xb = created.CowfeeRaidToolsAlertExport
  assert(xb.strata == "FULLSCREEN_DIALOG" and xb.toplevel ~= true and layers.panel ~= xb and (rawget(xb, "raised") or 0) >= 1, "export box above every window, not toplevel")
  assert(xb.edit.text == exported and xb.text == exported, "all lines in the copy box")
  assert(rawget(xb.edit, "template") == nil, "no template art")
  assert(xb.edit.w == xb.measure.w, "measured at its own width: " .. tostring(xb.edit.w) .. " vs " .. tostring(xb.measure.w))
  assert(xb.measure.nonSpaceWrap == true, "the measuring text wraps anywhere, like the edit box")
  assert(xb.box.h >= 3 * 14 and xb.h > xb.box.h, "the box covers the lines: " .. tostring(xb.box.h) .. " in " .. tostring(xb.h))
  assert(Notes:FindForEncounter(ENC, nil) == nil, "export saves nothing")
  -- a line that wraps needs more rows than its newline count; a long one scrolls inside a capped box
  local rows = math.ceil(#exported * 7 / xb.edit.w)
  assert(xb.edit.h >= rows * 14 and xb.edit.h >= 3 * 14, "edit covers wrapped rows: " .. xb.edit.h)
  assert(xb.scroll.h <= 180 and xb.scroll.h == math.min(xb.edit.h, 180), "scroll frame capped")
  xb:Hide()
  -- a write that fails takes the written lines out again and keeps the reminder
  local orig, calls = Notes.AddLine, 0
  Notes.AddLine = function(self, ...) calls = calls + 1 if calls == 2 then return nil end return orig(self, ...) end
  assert(E:Save() == false and message() ~= "", "refused: " .. message())
  Notes.AddLine = orig
  assert(R:Get(ENC, 1), "reminder kept")
  for _, e in ipairs(Notes:List()) do assert(#Notes:Parsed(e.id).timers == 0, "the written line was taken out") end
  -- all written: one line each with the same fields, and the reminder gone
  CRT.db.notes.list = {} CRT.db.notes.nextId = 1
  assert(E:Save() == true, "saved")
  assert(R:Get(ENC, 1) == nil, "reminder deleted")
  local id = Notes:FindForEncounter(ENC, nil)
  local ts = Notes:Parsed(id).timers
  assert(#ts == 3, "three lines: " .. #ts)
  local want = { { 1, 10 }, { 1, 20 }, { 2, 5 } }
  for i, t in ipairs(ts) do
    assert(t.ph == want[i][1] and t.time == want[i][2], "time " .. i .. ": " .. t.ph .. " " .. t.time)
    assert(t.text == "Many" and t.glow and t.show.alert and t.show.text and t.tags[1] == "everyone", "fields " .. i .. ": " .. P.FormatLine(t))
  end
  -- touching the time writes the one typed time
  R:Save(ENC, nil, { text = "Typed", boss = "Test Boss", times = "P1 0:10, 0:20" })
  local rid = R:List(ENC)[1].id
  E:Open(ENC, rid)
  pick("Save as", "note")
  typeInto(w.timeEdit, "0:40")
  assert(w.sourceText.text == "", "no times line once Time is typed")
  click(w.saveBtn)
  local typed = 0
  for _, t in ipairs(Notes:Parsed(id).timers) do if t.text == "Typed" then typed = typed + 1 assert(t.time == 40) end end
  assert(typed == 1, "one line")
  print("ok editor: a reminder with several times moves as one line per time")
end

-- (S18) the Difficulty of a new raid note line starts on the note the pull would read
do
  reset()
  local h = Notes:Import("EncounterID:9001;Difficulty:Heroic;Name:Test Boss\\ntime:1;tag:everyone;text:H;")
  -- only one note: that one, outside a raid
  E:Open(ENC, nil, { text = "x", saveAs = "note", time = 5 })
  local w = win()
  assert(value("Difficulty") == "Heroic" and w.savesText.text == "Saves to: Test Boss (Heroic)", tostring(value("Difficulty")))
  -- Only me keeps Any, and switching to Raid note takes the default
  E:Open(ENC, nil, { text = "x", time = 5 })
  assert(value("Difficulty") == "any" and w.savesText.text == "", "only me: Any")
  pick("Save as", "note")
  assert(value("Difficulty") == "Heroic", "switching to Raid note: " .. tostring(value("Difficulty")))
  pick("Save as", "mine")
  assert(value("Difficulty") == "any", "and back to Any")
  -- a difficulty you picked stays
  pick("Difficulty", "Normal") pick("Save as", "note")
  assert(value("Difficulty") == "Normal" and w.savesText.text == "Saves to: Test Boss (Heroic)", "picked stays; " .. w.savesText.text)
  -- two notes, outside a raid: Any
  local m = Notes:Import("EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\ntime:1;tag:everyone;text:M;")
  E:Open(ENC, nil, { text = "x", saveAs = "note", time = 5 })
  assert(value("Difficulty") == "any", "two notes outside a raid: " .. tostring(value("Difficulty")))
  -- in a Mythic raid: the Mythic note; in a Normal raid with no Normal note: the note the pull falls back to
  GetInstanceInfo = function() return "Raid", "raid", 16, "Mythic" end
  E:Open(ENC, nil, { text = "x", saveAs = "note", time = 5 })
  assert(value("Difficulty") == "Mythic" and w.savesText.text == "Saves to: Test Boss (Mythic)", "in Mythic")
  GetInstanceInfo = function() return "Raid", "raid", 14, "Normal" end
  E:Open(ENC, nil, { text = "x", saveAs = "note", time = 5 })
  local fallback = Notes:Get(Notes:FindForEncounter(ENC, "Normal")).difficulty
  assert(value("Difficulty") == fallback, "in Normal: " .. tostring(value("Difficulty")))
  GetInstanceInfo = nil
  -- a reminder's own difficulty stays when it moves
  R:Save(ENC, nil, { text = "r", boss = "Test Boss", times = "5", difficulty = "Mythic" })
  E:Open(ENC, R:List(ENC)[1].id)
  pick("Save as", "note")
  assert(value("Difficulty") == "Mythic", "reminder difficulty kept")
  -- no note at all: Any, saved to a new note
  CRT.db.notes.list = {}
  E:Open(ENC, nil, { text = "x", saveAs = "note", time = 5 })
  assert(value("Difficulty") == "any" and w.savesText.text == "Saves to: a new note for this boss")
  print("ok editor: difficulty starts on the note the pull reads")
end

-- a line with no tag alerts no one, and says so
do
  reset()
  local id = Notes:Import("EncounterID:9001;Name:Test Boss\\ntime:5;text:Nobody;")
  local t = Notes:TimerAt(id, 2)
  assert(not CRT.NoteEngine:IsMine(t), "no tag is not yours")
  E:OpenNote(id, 2)
  local w = win()
  assert(value("For") == "" and hasOption(dropdowns["For"], "").label == "No one (timers window only)", "own label")
  assert(optionList(dropdowns["For"])[1].key == "everyone", "Everyone is still first")
  pick("For", "everyone")
  assert(hasOption(dropdowns["For"], ""), "No one stays a choice")
  pick("For", "")
  click(w.saveBtn)
  assert(noteRaw(id) == "EncounterID:9001;Name:Test Boss\\ntime:5;ph:1;text:Nobody;show:alert,bar;tts:1;warn:10;", noteRaw(id))
  -- an old localized class tag reads back as the class (S19), and matches as before
  local c = Notes:Import("EncounterID:9002;Name:B\\ntime:5;tag:deathknight;text:DK;\\ntime:6;tag:druid;text:Me;")
  E:OpenNote(c, 2)
  assert(value("For") == "DEATHKNIGHT", tostring(value("For")))
  assert(CRT.NoteEngine:IsMine(Notes:TimerAt(c, 3)), "old druid tag still yours")
  assert(CRT.NoteEngine:IsMine({ tags = { "DRUID" } }) and CRT.NoteEngine:IsMine({ tags = { "Druid" } }), "file name, any case")
  print("ok editor: no tag reads back as No one")
end

-- a cooldown assigned on the Timeline: For prefilled to a player, or to No one
do
  reset()
  local function rawWith(s)
    for _, n in pairs(CRT.db.notes.list) do if n.raw and n.raw:find(s, 1, true) then return n.raw end end
  end
  E:Open(ENC, nil, { spellID = 777, text = "Tide", saveAs = "note", ph = 1, time = 20, tag = "Rain-Other" })
  local w = win()
  assert(value("Save as") == "note" and w.forRow.shown, "a raid note")
  assert(value("For") == "Rain-Other" and hasOption(dropdowns["For"], "Rain-Other"), "For the player: " .. tostring(value("For")))
  assert(not hasOption(dropdowns["For"], ""), "no No one choice for a player")
  click(w.saveBtn)
  assert(rawWith("ph:1;tag:Rain-Other;spell:777;text:Tide;") or rawWith("tag:Rain-Other;"), "saved for the player")
  -- no one: the editor's own No one choice, and the line has no tag
  E:Open(ENC, nil, { spellID = 777, text = "Unassigned", saveAs = "note", ph = 1, time = 30, tag = "" })
  assert(value("For") == "" and hasOption(dropdowns["For"], "").label == "No one (timers window only)", "For No one: " .. tostring(value("For")))
  click(w.saveBtn)
  local raw = rawWith("text:Unassigned;")
  assert(raw, "saved")
  for line in raw:gmatch("[^\\n]+") do
    if line:find("text:Unassigned;", 1, true) then assert(not line:find("tag:", 1, true), "no tag: " .. line) end
  end
  -- no tag in the prefill: Everyone, as before
  E:Open(ENC, nil, { text = "All", saveAs = "note", ph = 1, time = 40 })
  assert(value("For") == "everyone", "Everyone by default")
  -- a member: Only me, whatever For was asked
  group.leader = false
  E:Open(ENC, nil, { spellID = 777, saveAs = "note", ph = 1, time = 20, tag = "Rain-Other" })
  assert(value("Save as") == "mine" and not w.forRow.shown, "a member: Only me")
  print("ok editor: prefill sets For to a player or to no one")
end

-- a line written back keeps the fields FormatLine doesn't know
do
  reset()
  local id = Notes:Import("EncounterID:9001;Name:Test Boss\\ntime:48;tag:everyone;text:Go in;dur:8;DisplayType:Text;Custom:x;")
  E:OpenNote(id, 2)
  local w = win()
  typeInto(w.textEdit, "Go now")
  click(w.saveBtn)
  local raw = noteRaw(id)
  assert(raw:find("text:Go now;", 1, true) and raw:find("DisplayType:Text;Custom:x;$"), raw)
  assert(Notes:TimerAt(id, 2).dur == 8, "dur kept")
  E:OpenNote(id, 2)
  assert(E:Export():find("DisplayType:Text;Custom:x;$"), "export keeps them too")
  print("ok editor: unknown fields kept")
end

-- (personal notes) who may change the raid note
do
  reset()
  local function can() local ok, why = Notes:CanEditRaid() return ok, why end
  assert(can() == true, "raid leader")
  group.leader, group.assist = false, true
  assert(can() == true, "raid assistant")
  group.assist = false
  local ok, why = can()
  assert(ok == false and why == REASON, "raid member: " .. tostring(why))
  group.raid, group.party, group.leader = false, true, true
  assert(can() == true, "party leader")
  group.leader, group.assist = false, true
  assert(can() == false, "party member (no assistants in a party)")
  group.party, group.leader, group.assist = false, false, false
  assert(can() == true, "solo")
  group.raid, group.party, group.leader = SECRET, true, true
  assert(can() == false, "secret raid state")
  group.raid, group.leader, group.assist = true, SECRET, SECRET
  assert(can() == false, "secret leader and assistant")
  group.raid, group.party, group.leader, group.assist = false, SECRET, false, false
  assert(can() == false, "secret party state")
  print("ok admin: raid leader, assistant, party leader, solo, member")
end

do
  reset()
  setMember()
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss", saveAs = "note", ph = 1, time = 20 })
  local w = win()
  assert(value("Save as") == "mine" and not w.forRow.shown, "a new Raid note draft opens as Only me for a member")
  assert(hasOption(dropdowns["Save as"], "note").disabled == true, "Raid note greyed")
  assert(not hasOption(dropdowns["Save as"], "mine").disabled, "Only me stays")
  local helpText = w.saveAsHelp and w.saveAsHelp.helpText
  if type(helpText) == "function" then helpText = helpText() end
  assert(w.saveAsHelp and w.saveAsHelp.shown and helpText == REASON, "(?) gives the reason: " .. tostring(helpText))
  pick("Save as", "note")
  assert(value("Save as") == "mine" and message():find(REASON, 1, true), "picking it anyway is refused: " .. message())
  -- the leader: Raid note is a choice, no (?)
  group.leader = true
  E:Open(ENC, nil, { text = "x", saveAs = "note", ph = 1, time = 5 })
  assert(value("Save as") == "note" and not hasOption(dropdowns["Save as"], "note").disabled and not w.saveAsHelp.shown, "leader")
  -- promoted while it is open: the choice comes back on the next redraw
  group.leader = false
  E:Open(ENC, nil, { text = "x", ph = 1, time = 5 })
  assert(hasOption(dropdowns["Save as"], "note").disabled == true)
  group.assist = true
  assert(not hasOption(dropdowns["Save as"], "note").disabled, "assistant now")
  print("ok editor: save as raid note greyed for a member")
end

do
  reset()
  local id = Notes:Import(NOTE)
  local before = noteRaw(id)
  setMember()
  assert(E:OpenNote(id, 3) == true, "opens")
  local w = win()
  assert(w.title == "Raid note line", tostring(w.title))
  assert(value("Save as") == "note" and value("For") == "DRUID" and value("Relative to") == 2 and w.timeEdit.text == "0:34", "fields shown")
  assert(w.textEdit.text == "Dodge" and w.idEdit.text == "135940" and w.checks.text.checked and w.checks.circle.checked)
  assert(w.textEdit.enabled == false and w.timeEdit.enabled == false and w.idEdit.enabled == false, "boxes locked")
  for _, k in ipairs({ "alert", "text", "icon", "bar", "circle" }) do assert(w.checks[k].enabled == false, k .. " locked") end
  assert(w.also.speak.enabled == false and w.also.count.enabled == false and w.also.glow.enabled == false, "Also locked")
  assert(w.colorSwatch.enabled == false and w.colorDefault.enabled == false, "colour locked")
  for _, label in ipairs({ "Save as", "For", "Difficulty", "Relative to", "Icon", "Sound" }) do
    assert(dropdowns[label].opts.enabledIf and dropdowns[label].opts.enabledIf() == false, label .. " greyed")
  end
  assert(sliders["Show from"].opts.enabledIf() == false and sliders["Linger"].opts.enabledIf() == false, "sliders greyed")
  assert(not w.saveBtn.shown and not w.deleteBtn.shown and not w.saveSavedBtn.shown, "no Save, Delete or Save as saved alert")
  assert(w.exportBtn.shown and w.copyBtn and w.copyBtn.shown and w.copyBtn.text == "Copy to my reminders", "Export and Copy")
  -- nothing changes the draft
  pick("Relative to", 1) pick("Save as", "mine") sliders["Linger"].opts.set(9)
  setCheck(w.checks.bar, true) setCheck(w.also.glow, true)
  typeInto(w.textEdit, "Hacked") typeInto(w.timeEdit, "9:99")
  assert(value("Relative to") == 2 and value("Save as") == "note" and sliders["Linger"].opts.get() == 2, "setters blocked")
  assert(not w.checks.bar.checked and not w.also.glow.checked, "checkboxes put back")
  local line = E:Export()
  assert(line and line:find("text:Dodge;", 1, true) and line:find("^time:34;ph:2;"), "export shows the line as it is: " .. tostring(line) .. " " .. message())
  assert(E:Save() == false and noteRaw(id) == before and #R:List(ENC) == 0, "Save writes nothing")
  -- the leader opens it exactly as before
  group.leader = true
  E:OpenNote(id, 3)
  assert(w.title == "Alert" and w.saveBtn.shown and w.deleteBtn.shown and w.saveSavedBtn.shown and not w.copyBtn.shown, "admin: editable")
  assert(w.textEdit.enabled == true and w.checks.bar.enabled == true and dropdowns["Save as"].opts.enabledIf() == true)
  print("ok editor: member opens a raid line read-only")
end

do
  reset()
  local id = Notes:Import(NOTE .. "\\ntime:75.5;ph:1;tag:everyone;text:Glow;show:bar;count:1;glow:1;")
  local before = noteRaw(id)
  setMember()
  E:OpenNote(id, 3)
  local w = win()
  click(w.copyBtn)
  assert(w.shown and w.title == "Alert" and not w.copyBtn.shown and w.saveBtn.shown and not w.deleteBtn.shown, "a new reminder")
  assert(value("Save as") == "mine" and not w.forRow.shown and w.textEdit.enabled == true and dropdowns["Sound"].opts.enabledIf() == true)
  assert(w.sourceText.text == "Times: P2 +0:34", w.sourceText.text)
  click(w.saveBtn)
  assert(not w.shown, "saved and closed: " .. message())
  local list = R:List(ENC)
  assert(#list == 1, "one reminder")
  local r = list[1].r
  assert(r.times == "P2 +0:34" and r.spellID == 888 and r.text == "Dodge" and r.boss == "Test Boss", tostring(r.times))
  assert(r.outputs.text and r.outputs.circle and not r.outputs.alert and not r.outputs.bar and not r.outputs.icon, "displays")
  assert(r.outputs.speech and r.speech == "text" and not r.glow, "speech")
  assert(r.sound == "READY_CHECK" and r.warn == 7 and r.linger == 2 and r.iconID == 135940, "sound, warn, linger, icon")
  assert(r.color and r.color[1] == 1 and r.color[2] == 0 and r.color[3] == 0, "colour")
  assert(noteRaw(id) == before, "raid note untouched")
  -- a fraction of a second, a countdown and a glow come along too
  E:OpenNote(id, 5)
  click(w.copyBtn)
  click(w.saveBtn)
  list = R:List(ENC)
  local g
  for _, e in ipairs(list) do if e.r.text == "Glow" then g = e.r end end
  assert(g and g.times == "P1 1:15.5" and g.glow == true and g.speech == "count" and g.outputs.speech and g.outputs.bar and not g.outputs.alert, tostring(g and g.times))
  assert(noteRaw(id) == before, "raid note still untouched")
  print("ok editor: copy raid line to mine")
end

do
  reset()
  local id = Notes:Import(NOTE)
  local before = noteRaw(id)
  -- opened by the leader, who is then demoted with it open
  E:OpenNote(id, 4)
  local w = win()
  typeInto(w.textEdit, "Changed")
  setMember()
  assert(E:Save() == false and message():find(REASON, 1, true) and noteRaw(id) == before, "replace refused: " .. message())
  click(w.deleteBtn)
  popups[#popups].callback()
  assert(noteRaw(id) == before and w.shown and message():find(REASON, 1, true), "delete refused")
  -- moving the line to your reminders takes it out of the raid note: refused too
  pick("Save as", "mine")
  assert(E:Save() == false and #R:List(ENC) == 0 and noteRaw(id) == before, "move to mine refused")
  -- a new Raid note line
  group.leader = true
  E:Open(ENC, nil, { text = "New", saveAs = "note", ph = 1, time = 5 })
  setMember()
  local count = 0
  assert(E:Save() == false and message():find(REASON, 1, true), "add refused")
  for _ in pairs(CRT.db.notes.list) do count = count + 1 end
  assert(count == 1 and noteRaw(id) == before, "no note written")
  -- a reminder moved to the raid note
  group.leader = true
  R:Save(ENC, nil, { text = "Mine", boss = "Test Boss", times = "P1 0:30" })
  E:Open(ENC, 1)
  pick("Save as", "note")
  setMember()
  assert(E:Save() == false and R:Get(ENC, 1) and noteRaw(id) == before, "reminder kept, nothing written")
  -- promoted again: the same draft saves
  group.assist = true
  assert(E:Save() == true and R:Get(ENC, 1) == nil, "assistant saves")
  print("ok editor: raid write refused for a member")
end

-- (final fix M1) promoted while a raid line is open read-only: the next redraw makes it editable
do
  reset()
  local id = Notes:Import(NOTE)
  setMember()
  E:OpenNote(id, 3)
  local w = win()
  assert(w.title == "Raid note line" and not w.saveBtn.shown and w.copyBtn.shown, "read-only first")
  -- promoted, nothing redrawn yet: Save says to open it again, not the leader-only text
  group.assist = true
  assert(E:Save() == false, "a stale read-only Save writes nothing")
  assert(message():find("open it again", 1, true) and not message():find(REASON, 1, true), "reopen message: " .. message())
  -- that redraw (and any other) unlocks it as for any leader
  assert(w.title == "Alert" and w.saveBtn.shown and w.deleteBtn.shown and w.saveSavedBtn.shown and not w.copyBtn.shown, "unlocked")
  assert(w.textEdit.enabled == true and w.checks.bar.enabled == true and dropdowns["Save as"].opts.enabledIf() == true, "boxes open")
  typeInto(w.textEdit, "Dodge now")
  assert(E:Save() == true and Notes:TimerAt(id, 3).text == "Dodge now", "saves as a leader: " .. message())
  -- a redraw from a pick unlocks too
  setMember()
  E:OpenNote(id, 4)
  group.leader = true
  pick("Relative to", 1)
  assert(w.title == "Alert" and w.saveBtn.shown and w.textEdit.enabled == true, "a pick redraws and unlocks")
  print("ok editor: promotion unlocks an open raid line")
end

-- (final fix Mn4) Copy to my reminders needs a boss: greyed on a line of a note with no encounter
do
  reset()
  local id = Notes:Import("Name:No Boss\\ntime:20;text:Run;")
  setMember()
  assert(E:OpenNote(id, 2) == true, "opens")
  local w = win()
  assert(w.copyBtn.shown and w.copyBtn.enabled == false, "greyed without an encounter")
  assert(E:CopyToMine() == false and w.title == "Raid note line", "refused")
  local nid = Notes:Import(NOTE)
  E:OpenNote(nid, 3)
  assert(w.copyBtn.shown and w.copyBtn.enabled == true, "with a boss: enabled")
  print("ok editor: copy needs an encounter")
end

-- (spell lookup) the Spell / Icon ID box takes a name: a list of this boss's abilities and your spells
local LOOK = 9100
assert(Ref:Add("Boss: Lookup Boss\\nDifficulty: Mythic\\nEncounter: 9100\\nLength: 3:00\\nShadow Lash [spell 3001]: 0:30\\nShadow Bolt: 0:40\\nNo Spell Here: 0:50"))
local NAMES = { [777] = "Real Name", [888] = "Other Spell", [3001] = "Shadow Lash", [3002] = "Shadow Bolt",
  [3003] = "Searing Shadows", [3004] = "Darkness Falls", [589] = "Shadow Word: Pain" }
local realSpell = { GetSpellName = C_Spell.GetSpellName, GetSpellTexture = C_Spell.GetSpellTexture }
local bookCalls = 0
local function lookupMocks()
  C_Spell.GetSpellName = function(id) return NAMES[id] end
  CRT.TimelineJournal = { Rows = function(_, enc)
    if enc == LOOK then
      return { { spellID = 3002, name = "Shadow Bolt", icon = 5002 }, { spellID = 3003, name = "Searing Shadows", icon = 5003 },
        { spellID = 3004, name = "Darkness Falls", icon = 5004 }, { spellID = 3005, name = "Custom Cleave", icon = 5005, own = true } }
    end
    return {}
  end }
  Enum = { SpellBookSpellBank = { Player = 0, Pet = 1 }, SpellBookItemType = { None = 0, Spell = 1, FutureSpell = 2, PetAction = 3, Flyout = 4 } }
  -- the game's spellbook: tables per skill line and per item, secret values possible
  local items = {
    { name = "Shadow Word: Pain", spellID = 589, iconID = 136207, itemType = 1 },
    { name = "Shadow Bolt", spellID = 3002, iconID = 999, itemType = 1 },
    { name = SECRET, spellID = 7001, iconID = 1, itemType = 1 },
    { name = "Shadowfiend", spellID = SECRET, iconID = 2, itemType = 1 },
    { name = "Shadow Crash", spellID = 205385, iconID = 3, itemType = 2 },
    { name = "Shadow Portals", spellID = 0, iconID = 4, itemType = 4, actionID = 12 },
    { name = "Mind Flay", spellID = 15407, iconID = SECRET, itemType = SECRET },
    { name = "Shadowform Aura", spellID = 7002, iconID = 5, itemType = 1, isPassive = true },
    { name = "Vampiric Touch", spellID = 34914, iconID = 6, itemType = 1, isPassive = SECRET },
    { name = "Healing Tide", spellID = 108280, iconID = 7, itemType = 1 },
    { name = "Lush Growth", spellID = 8001, iconID = 8, itemType = 1 },
  }
  bookCalls = 0
  C_SpellBook = {
    GetNumSpellBookSkillLines = function() bookCalls = bookCalls + 1 return 3 end,
    GetSpellBookSkillLineInfo = function(i)
      if i == 1 then return { name = "General", itemIndexOffset = 0, numSpellBookItems = 3 } end
      if i == 2 then return { name = "Shadow", itemIndexOffset = 3, numSpellBookItems = 8 } end
      return { name = "Hidden", itemIndexOffset = SECRET, numSpellBookItems = 5 }
    end,
    GetSpellBookItemInfo = function(index, bank)
      assert(bank == 0, "the player's bank")
      local it = items[index]
      if not it then error("no such item") end
      return { name = it.name, spellID = it.spellID, iconID = it.iconID, itemType = it.itemType, actionID = it.actionID, isPassive = it.isPassive }
    end,
  }
end
local function lookupDone()
  C_Spell.GetSpellName, C_Spell.GetSpellTexture = realSpell.GetSpellName, realSpell.GetSpellTexture
  CRT.TimelineJournal, C_SpellBook, Enum = nil, nil, nil
end
local function shownRows(w)
  local out = {}
  for _, row in ipairs(w.lookup.rows) do if row.shown then out[#out + 1] = row end end
  return out
end
local function rowNames(w)
  local t = {} for i, row in ipairs(shownRows(w)) do t[i] = row.nameText.text end return table.concat(t, ",")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  local w = win()
  assert(w.lookup and not w.lookup.shown, "list hidden at first")
  typeInto(w.idEdit, "sh")
  assert(not w.lookup.shown, "two letters open nothing")
  typeInto(w.idEdit, "  shadow ")
  assert(w.lookup.shown, "letters open the list")
  assert(rowNames(w) == "Shadow Bolt,Shadow Lash,Shadow Word: Pain,Searing Shadows", rowNames(w))
  local rows = shownRows(w)
  assert(rows[1].tagText.text == "Boss" and rows[2].tagText.text == "Timeline" and rows[3].tagText.text == "Yours" and rows[4].tagText.text == "Boss", "tags")
  assert(rows[1].idText.text == "3002" and rows[2].idText.text == "3001" and rows[3].idText.text == "589", "ids")
  assert(rows[1].icon.texture == 5002 and rows[3].icon.texture == 136207, "icons from the source")
  assert(w.lookup.strata == "FULLSCREEN_DIALOG", "above the editor: " .. tostring(w.lookup.strata))
  typeInto(w.idEdit, "SHADOW B")
  assert(shownRows(w)[1].nameText.text == "Shadow Bolt", "case-insensitive: " .. rowNames(w))
  assert(bookCalls == 1, "spellbook read once per open: " .. bookCalls)
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  typeInto(w.idEdit, "shadow")
  assert(bookCalls == 2, "read again on the next open")
  local helped
  for _, h in ipairs(helps) do if h.helpTitle == "Icon" and tostring(h.helpText):find("spell name", 1, true) and tostring(h.helpText):find("close spelling", 1, true) then helped = true end end
  assert(helped, "Icon help names the lookup")
  -- clearing the box hides the list
  typeInto(w.idEdit, "")
  assert(not w.lookup.shown, "cleared: hidden")
  assert(#errors == 0, tostring(errors[1]))
  lookupDone()
  print("ok lookup: letters open matches from boss, timeline and yours")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { spellID = 777, boss = "Lookup Boss", times = "P1 0:10" })
  local w = win()
  typeInto(w.idEdit, "shad")
  assert(w.spellName.text == "Real Name" and w.iconPreview.texture == "tex777", "preview kept: " .. tostring(w.spellName.text))
  typeInto(w.idEdit, "x")
  assert(w.spellName.text == "Real Name", "one letter keeps it too")
  click(w.saveBtn)
  local r = R:Get(LOOK, 1)
  assert(r and r.spellID == 777, "spell kept: " .. tostring(r and r.spellID) .. " " .. message())
  lookupDone()
  print("ok lookup: typing letters keeps the spell")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  local w = win()
  assert(w.textEdit.text == "", "no text")
  typeInto(w.idEdit, "lash")
  click(shownRows(w)[1])
  assert(not w.lookup.shown, "hidden after the pick")
  assert(w.idEdit.text == "3001" and w.textEdit.text == "Shadow Lash" and w.spellName.text == "Shadow Lash", w.idEdit.text .. " " .. w.textEdit.text)
  -- text that only named the previous spell becomes the new one's
  typeInto(w.idEdit, "searing")
  click(shownRows(w)[1])
  assert(w.idEdit.text == "3003" and w.textEdit.text == "Searing Shadows", w.textEdit.text)
  typeInto(w.timeEdit, "0:20")
  click(w.saveBtn)
  local r = R:Get(LOOK, 1)
  assert(r and r.spellID == 3003 and r.text == "Searing Shadows", "saved: " .. message())
  lookupDone()
  print("ok lookup: pick fills the spell and empty text")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { spellID = 777, boss = "Lookup Boss", text = "Soak now" })
  local w = win()
  typeInto(w.idEdit, "lash")
  click(shownRows(w)[1])
  assert(w.idEdit.text == "3001" and w.textEdit.text == "Soak now", "typed text kept: " .. w.textEdit.text)
  lookupDone()
  print("ok lookup: typed text kept")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  local w = win()
  typeInto(w.idEdit, "shadow")
  w.idEdit.OnEnterPressed(w.idEdit)
  assert(w.idEdit.text == "3002" and w.textEdit.text == "Shadow Bolt" and not w.lookup.shown, "top match: " .. w.idEdit.text)
  -- Escape and losing focus hide the list, leaving the spell alone
  typeInto(w.idEdit, "shadow")
  w.idEdit.OnEscapePressed(w.idEdit)
  assert(not w.lookup.shown, "Escape hides")
  typeInto(w.idEdit, "shadow")
  w.idEdit.OnEditFocusLost(w.idEdit)
  assert(not w.lookup.shown, "focus lost hides")
  assert(w.spellName.text == "Shadow Bolt", "spell kept")
  lookupDone()
  print("ok lookup: Enter picks the top match")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { spellID = 777, boss = "Lookup Boss" })
  local w = win()
  assert(w.textEdit.text == "Real Name", "named after the spell")
  pick("Icon", "id")
  typeInto(w.idEdit, "bolt")
  click(shownRows(w)[1])
  assert(w.idEdit.text == "5002" and w.iconPreview.texture == 5002, "the spell's icon: " .. w.idEdit.text)
  assert(w.textEdit.text == "Real Name", "Icon ID mode leaves the text: " .. w.textEdit.text)
  -- a source without an icon: the game's texture when it reads as a number
  C_Spell.GetSpellTexture = function(id) return id == 3001 and 4001 or ("tex" .. tostring(id)) end
  typeInto(w.idEdit, "lash")
  click(shownRows(w)[1])
  assert(w.idEdit.text == "4001", "GetSpellTexture: " .. w.idEdit.text)
  typeInto(w.timeEdit, "0:20")
  click(w.saveBtn)
  local r = R:Get(LOOK, 1)
  assert(r and r.iconID == 4001 and r.spellID == 777, "icon set, spell kept: " .. tostring(r and r.spellID))
  lookupDone()
  print("ok lookup: icon ID mode takes the spell's icon")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { spellID = 777, boss = "Lookup Boss" })
  local w = win()
  typeInto(w.idEdit, "zzzz")
  local rows = shownRows(w)
  assert(w.lookup.shown and #rows == 1 and rows[1].nameText.text == "No spells match" and not rows[1].match, rowNames(w))
  w.idEdit.OnEnterPressed(w.idEdit)
  assert(w.spellName.text == "Real Name", "Enter picks nothing")
  click(rows[1])
  assert(w.spellName.text == "Real Name", "the grey row picks nothing")
  assert(not w.lookup.shown, "a click on the grey row closes the list")
  typeInto(w.idEdit, "zzzz")
  assert(w.lookup.shown, "open again")
  w.lookup.OnMouseDown(w.lookup)
  assert(not w.lookup.shown, "a click on the list closes it")
  lookupDone()
  print("ok lookup: no matches row")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  local w = win()
  typeInto(w.idEdit, "bolt")
  local rows = shownRows(w)
  assert(#rows == 1 and rows[1].tagText.text == "Boss" and rows[1].idText.text == "3002", "once, from the boss: " .. rowNames(w))
  -- no encounter: only your spells
  E:Open(nil, nil)
  typeInto(w.idEdit, "bolt")
  rows = shownRows(w)
  assert(#rows == 1 and rows[1].tagText.text == "Yours" and rows[1].icon.texture == 999, "yours only: " .. rowNames(w))
  typeInto(w.idEdit, "lash")
  assert(rowNames(w) == "Lush Growth", "no timeline without a boss: " .. rowNames(w))
  lookupDone()
  print("ok lookup: duplicates shown once, boss first")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  local w = win()
  for _, q in ipairs({ "fiend", "crash", "portal", "mind flay" }) do
    typeInto(w.idEdit, q)
    assert(not shownRows(w)[1].match, q .. " skipped: " .. rowNames(w))
  end
  typeInto(w.idEdit, "word")
  assert(rowNames(w) == "Shadow Word: Pain", "the readable one stays: " .. rowNames(w))
  typeInto(w.idEdit, "aura")
  assert(not shownRows(w)[1].match, "passives skipped: " .. rowNames(w))
  typeInto(w.idEdit, "vampiric")
  assert(rowNames(w) == "Vampiric Touch", "a secret passive flag is not a passive: " .. rowNames(w))
  typeInto(w.idEdit, "cleave")
  assert(rowNames(w) == "Custom Cleave" and shownRows(w)[1].tagText.text == "Timeline", "a custom Journal row is tagged Timeline")
  assert(#errors == 0, tostring(errors[1]))
  lookupDone()
  print("ok lookup: secret spellbook entries skipped")
end

do
  reset() lookupMocks()
  local id = Notes:Import("EncounterID:9100;Difficulty:Mythic;Name:Lookup Boss\\ntime:20;spellid:777;text:Run;")
  setMember()
  assert(E:OpenNote(id, 2) == true, "opens")
  local w = win()
  assert(w.title == "Raid note line", "read-only")
  typeInto(w.idEdit, "shadow")
  assert(not w.lookup.shown, "nothing opens")
  assert(bookCalls == 0, "nothing read")
  lookupDone()
  print("ok lookup: read-only opens nothing")
end


do
  reset() lookupMocks()
  E:Open(LOOK, nil, { spellID = 777, boss = "Lookup Boss" })
  local w = win()
  assert(w.textEdit.text == "Real Name", "named after the spell")
  w.idEdit.OnEditFocusGained(w.idEdit)
  typeInto(w.idEdit, "")
  typeInto(w.idEdit, "lash")
  click(shownRows(w)[1])
  assert(w.idEdit.text == "3001" and w.textEdit.text == "Shadow Lash", "refilled: " .. w.textEdit.text)
  lookupDone()
  print("ok lookup: backspacing to empty still refills text naming the old spell")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { spellID = 777, boss = "Lookup Boss" })
  local w = win()
  typeInto(w.idEdit, "shadow")
  w.idEdit.OnEscapePressed(w.idEdit)
  assert(not w.lookup.shown and w.idEdit.text == "777", "Escape: " .. w.idEdit.text)
  typeInto(w.idEdit, "shadow")
  w.idEdit.OnEditFocusLost(w.idEdit)
  assert(w.idEdit.text == "777", "focus lost: " .. w.idEdit.text)
  -- no spell: an empty box
  typeInto(w.idEdit, "")
  typeInto(w.idEdit, "shadow")
  w.idEdit.OnEscapePressed(w.idEdit)
  assert(w.idEdit.text == "", "empty: " .. w.idEdit.text)
  -- Icon ID mode puts the icon back
  pick("Icon", "id")
  typeInto(w.idEdit, "135940")
  typeInto(w.idEdit, "shadow")
  w.idEdit.OnEscapePressed(w.idEdit)
  assert(w.idEdit.text == "135940", "icon: " .. w.idEdit.text)
  lookupDone()
  print("ok lookup: Escape puts the ID back")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  local w = win()
  typeInto(w.idEdit, "Heailng Tid")
  assert(w.lookup.shown and shownRows(w)[1].nameText.text == "Healing Tide" and shownRows(w)[1].tagText.text == "Yours", "near match: " .. rowNames(w))
  w.idEdit.OnEnterPressed(w.idEdit)
  assert(w.idEdit.text == "108280" and w.textEdit.text == "Healing Tide", "Enter: " .. w.idEdit.text)
  -- a word inside the name counts too
  typeInto(w.idEdit, "tdie")
  assert(rowNames(w) == "Healing Tide", "word start: " .. rowNames(w))
  lookupDone()
  print("ok lookup: a typo finds the near match (Heailng Tid -> Healing Tide)")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  local w = win()
  typeInto(w.idEdit, "lash")
  assert(rowNames(w) == "Shadow Lash,Lush Growth", "substring first: " .. rowNames(w))
  typeInto(w.idEdit, "SHADOW B")
  assert(rowNames(w) == "Shadow Bolt,Shadow Lash,Shadow Word: Pain,Searing Shadows", "then by distance, source: " .. rowNames(w))
  lookupDone()
  print("ok lookup: substring matches rank above near matches")
end

do
  reset() lookupMocks()
  E:Open(LOOK, nil, { boss = "Lookup Boss" })
  local w = win()
  for _, q in ipairs({ "qwxzv", "abc", "completely unrelated" }) do
    typeInto(w.idEdit, q)
    local rows = shownRows(w)
    assert(#rows == 1 and not rows[1].match and rows[1].nameText.text == "No spells match", q .. ": " .. rowNames(w))
  end
  lookupDone()
  print("ok lookup: a far-off query still shows No spells match")
end

-- the note line save is Alerts/Draft.lua's (Draft.SaveNote, no frames): the editor saves through it,
-- and writes the same line as before the move
do
  reset()
  local D = CRT.AlertDraft
  local real, calls = D.SaveNote, 0
  if real then D.SaveNote = function(...) calls = calls + 1 return real(...) end end
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss", saveAs = "note", ph = 2, time = 12.4, tag = "Rain" })
  local w = win()
  typeInto(w.textEdit, "Go; now")
  setCheck(w.checks.text, true)
  click(w.saveBtn)
  D.SaveNote = real
  local id = Notes:FindForEncounter(ENC, nil)
  local raw = id and noteRaw(id) or ""
  print("  line: " .. raw)
  assert(not w.shown and raw:find("\\ntime:12.4;ph:2;tag:Rain;spellid:777;text:Go now;show:alert,text,bar;tts:1;warn:5;", 1, true), "the same line: " .. raw)
  assert(type(real) == "function" and calls == 1, "saved through Draft.SaveNote: " .. calls)
  -- called alone, with no editor: a new line, the stale guard, the raid note asked at the save, no boss
  E:Close()
  local d = D.New()
  d.saveAs, d.tag, d.ph, d.timeText, d.timeTouched, d.text = "note", "", 1, "30", true, "Alone"
  d.show = { text = true }
  local ok, err = D.SaveNote({ encounterID = ENC }, d)
  assert(ok == true and err == nil, "saved alone: " .. tostring(err))
  local t = Notes:TimerAt(id, 3)
  assert(t and t.text == "Alone" and #t.tags == 0 and t.time == 30 and t.show.text and not t.show.alert and t.tts, "a line for no one: " .. noteRaw(id))
  local _, before = Notes:TimerAt(id, 2)
  ok, err = D.SaveNote({ encounterID = ENC, noteID = id, line = 2, expected = "not the line" }, d)
  assert(ok == false and err == D.TEXT.stale and select(2, Notes:TimerAt(id, 2)) == before, "stale refused: " .. tostring(err))
  setMember()
  ok, err = D.SaveNote({ encounterID = ENC }, d)
  assert(ok == false and err == REASON, "a member is refused at the save: " .. tostring(err))
  group.leader = true
  ok, err = D.SaveNote({ encounterID = "Some Boss" }, d)
  assert(ok == false and type(err) == "string" and err ~= "", "no encounter ID: refused")
  print("ok editor: note save unchanged after the core move")
end
-- Timeline/Page.lua's RehearsalSourceFor, as the window plays it: the boss's first reference for the
-- group, else nothing. sourceOverride replaces it (a recorded pull: a base with no reference).
local sourceOverride
CRT.Timeline.RehearsalSourceFor = function(self, enc, group)
  if sourceOverride then return sourceOverride end
  local list = Ref:ForGroup(Ref:ForBoss(enc), group == "mythic" and "mythic" or "nh")
  local ref = list[1] and list[1].ref
  if not ref then return nil end
  return { base = { reference = ref }, encounterID = enc, group = group, difficultyName = ref.difficulty }
end
-- The Rehearsal window's OpenAt (Timeline/RehearsalWindow.lua), mocked: every call recorded.
local opened = {}
local function mockWindow(ok, reason)
  for i = #opened, 1, -1 do opened[i] = nil end
  CRT.TimelineRehearsalWindow = { OpenAt = function(self, enc, diff, t, o)
    opened[#opened + 1] = { enc = enc, diff = diff, t = t, opts = o }
    if ok then return true end
    return false, reason
  end }
end

-- editor: test opens the rehearsal for an unsaved draft
do
  reset()
  E:Open(ENC, nil, { text = "Draft", times = "P1 0:30" })
  local w = win()
  mockWindow(true)
  click(w.testBtn)
  assert(#opened == 1, "OpenAt called: " .. #opened)
  local c = opened[1]
  assert(c.enc == ENC and c.diff == "Heroic" and c.t == 25 and c.opts.stopAt == 33, "the 5 s countdown before 0:30, paused 3 s after: " .. tostring(c.diff) .. " " .. tostring(c.t))
  assert(c.opts.testing == "Draft", "Testing label: " .. tostring(c.opts.testing))
  local extra = c.opts.alerts and c.opts.alerts.extra
  assert(type(extra) == "table" and #extra == 1 and extra[1].text == "Draft" and extra[1].block == "minetest", "the draft's item")
  assert(c.opts.alerts.replaces == nil, "nothing saved to replace")
  assert(not A.running and #R:List(ENC) == 0 and #printed == 0, "no quick test, nothing saved")
  -- a raid note line: its item is a note item, and its saved line is replaced
  local id = Notes:Import(NOTE)
  E:OpenNote(id, 4) -- time:50;ph:1;text:Other;
  click(w.testBtn)
  c = opened[2]
  assert(c and c.t == 40 and c.diff == "Heroic", "the note line from 0:50, its 10 s Show from early: " .. tostring(c and c.t))
  extra = c.opts.alerts.extra
  assert(#extra == 1 and extra[1].block == "note" and extra[1].text == "Other", "note item")
  local rep = c.opts.alerts.replaces
  assert(rep and rep.block == "note" and rep.noteID == id and rep.line == 4, "its saved line replaced")
  CRT.TimelineRehearsalWindow = nil
  assert(#errors == 0, tostring(errors[1]))
  print("ok editor: test opens the rehearsal for an unsaved draft")
end

-- editor: a later-phase alert starts from its reference time
do
  reset()
  E:Open(ENC, nil, { text = "Late", times = "P2 0:10" })
  local w = win()
  mockWindow(true)
  pick("Difficulty", "Mythic")
  click(w.testBtn)
  local c = opened[1]
  assert(c and c.t == 125 and c.diff == "Mythic", "P2 at 2:00 + 0:10, its 5 s Show from early: " .. tostring(c and c.t))
  -- Heroic's reference has no phase 2: no fight time, so the quick test runs
  pick("Difficulty", "Heroic")
  click(w.testBtn)
  assert(#opened == 1, "the window not asked without a fight time")
  assert(A.running and A.run.reason == "test", "quick test instead")
  A:Stop(true)
  CRT.TimelineRehearsalWindow = nil
  assert(#errors == 0, tostring(errors[1]))
  print("ok editor: a later-phase alert starts from its reference time")
end



-- test: the jump uses the reference the window plays
do
  reset()
  -- follows the reference: Mythic has 0:30, Heroic 0:45. No difficulty, outside a raid: the window
  -- plays the Normal/Heroic group, so the jump goes by Heroic's 0:45.
  E:Open(ENC, nil, { text = "Ability", boss = "Test Boss" })
  local w = win()
  mockWindow(true)
  click(w.testBtn)
  local c = opened[1]
  assert(c and c.diff == "Heroic" and c.t == 40, "Heroic's 0:45, 5 s early: " .. tostring(c and c.diff) .. " " .. tostring(c and c.t))
  -- a recorded pull has no reference: only phase 1 times are placed
  sourceOverride = { base = { id = 1 }, encounterID = ENC, group = "mythic", difficultyName = "Mythic" }
  E:Open(ENC, nil, { text = "Mixed", times = "P1 0:20; P2 0:01" })
  pick("Difficulty", "Mythic")
  click(w.testBtn)
  c = opened[2]
  assert(c and c.t == 15 and c.diff == "Mythic", "phase 1 from the pull, 5 s early: " .. tostring(c and c.t))
  E:Open(ENC, nil, { text = "Later", times = "P2 0:10" })
  pick("Difficulty", "Mythic")
  click(w.testBtn)
  assert(#opened == 2, "a later phase can't be placed on a pull: the window is not asked")
  assert(A.running and A.run.reason == "test", "quick test instead")
  A:Stop(true)
  sourceOverride = nil
  -- no source at all: the quick test
  local real = CRT.Timeline.RehearsalSourceFor
  CRT.Timeline.RehearsalSourceFor = function() return nil end
  E:Open(ENC, nil, { text = "None", times = "P1 0:20" })
  click(w.testBtn)
  CRT.Timeline.RehearsalSourceFor = real
  assert(#opened == 2 and A.running and A.run.reason == "test", "no source: quick test")
  A:Stop(true)
  CRT.TimelineRehearsalWindow = nil
  assert(#errors == 0, tostring(errors[1]))
  print("ok test: the jump uses the reference the window plays")
end

-- test: a part's alert jumps to its chosen slot
do
  reset()
  local realShift = CRT.Timeline.OrderShift
  local asked = {}
  -- the chosen order moves this part's 0:30 to 1:30, and drops its 1:00 past the new window
  CRT.Timeline.OrderShift = function(self, enc, group)
    asked[#asked + 1] = group
    return function(spellID, text, t)
      if text ~= "Part" then return t end
      if t == 30 then return 90 end
      if t == 60 then return false end
      return t
    end
  end
  E:Open(ENC, nil, { text = "Part", times = "P1 0:30, 1:00; P2 0:05" })
  pick("Difficulty", "Mythic")
  local w = win()
  mockWindow(true)
  click(w.testBtn)
  local c = opened[1]
  assert(asked[1] == "mythic", "the order of the group played: " .. tostring(asked[1]))
  assert(c and c.t == 85, "0:30 moved to 1:30, 1:00 dropped, P2 0:05 is 2:05: " .. tostring(c and c.t))
  -- a line of no part keeps its time
  E:Open(ENC, nil, { text = "Other", times = "P1 0:30" })
  pick("Difficulty", "Mythic")
  click(w.testBtn)
  assert(opened[2] and opened[2].t == 25, "no part: unmoved: " .. tostring(opened[2] and opened[2].t))
  CRT.Timeline.OrderShift = realShift
  CRT.TimelineRehearsalWindow = nil
  assert(#errors == 0, tostring(errors[1]))
  print("ok test: a part's alert jumps to its chosen slot")
end


-- speak at: the editor's dropdown saves zero on a reminder
do
  reset()
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss" })
  local w = win()
  local row = dropdowns["Speak at"]
  assert(row, "a Speak at dropdown")
  assert(optionKeys(row) == "show,zero", optionKeys(row))
  assert(optionList(row)[1].label == "On show" and optionList(row)[2].label == "At 0", "its words")
  assert(value("Speak at") == "show", "On show by default")
  typeInto(w.timeEdit, "0:30")
  pick("Speak at", "zero")
  assert(value("Speak at") == "zero")
  click(w.saveBtn)
  local r = R:Get(ENC, 1)
  assert(r and r.speakAt == "zero" and r.speech == "text", "saved as zero: " .. tostring(r and r.speakAt))
  E:Open(ENC, 1)
  assert(value("Speak at") == "zero", "reads back")
  pick("Speak at", "show")
  click(w.saveBtn)
  assert(R:Get(ENC, 1).speakAt == nil, "On show is saved as nothing")
  -- a raid note line: written as ttsat:0, and read back
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss", saveAs = "note" })
  typeInto(w.timeEdit, "0:40")
  pick("Speak at", "zero")
  click(w.saveBtn)
  local note = Notes:Get(1)
  assert(note and note.raw:find("ttsat:0;", 1, true), "note line has ttsat:0: " .. tostring(note and note.raw))
  local lineNo
  local n = 0
  for l in (note.raw .. "\\n"):gmatch("(.-)\\n") do n = n + 1 if l:find("ttsat", 1, true) then lineNo = n end end
  assert(E:OpenNote(1, lineNo), "opens the line")
  assert(value("Speak at") == "zero", "the line reads back At 0")
  pick("Speak at", "show")
  click(w.saveBtn)
  assert(not Notes:Get(1).raw:find("ttsat", 1, true), "On show writes no ttsat: " .. Notes:Get(1).raw)
  print("ok speak at: the editor's dropdown saves zero on a reminder")
end

-- speak at: greyed when speech is off
do
  reset()
  E:Open(ENC, nil, { spellID = 777, boss = "Test Boss" })
  local w = win()
  local row = dropdowns["Speak at"]
  assert(row.opts.enabledIf and row.opts.enabledIf() == true, "on while Speak the text is ticked")
  local before = row.refreshed or 0
  setCheck(w.also.speak, false)
  assert(row.opts.enabledIf() == false, "greyed with Speak the text off")
  assert((row.refreshed or 0) > before, "redrawn when the box changes")
  setCheck(w.also.count, true)
  assert(row.opts.enabledIf() == false, "count alone keeps it greyed")
  setCheck(w.also.speak, true)
  assert(row.opts.enabledIf() == true, "back on")
  -- a read-only raid note line shows it disabled
  local id = Notes:Import("EncounterID:9001;Name:Test Boss\\ntime:34;ph:1;text:Dodge;show:text;tts:1;ttsat:0;")
  setMember()
  assert(E:OpenNote(id, 2))
  assert(value("Speak at") == "zero" and row.opts.enabledIf() == false, "read-only: shown, disabled")
  pick("Speak at", "show")
  assert(value("Speak at") == "zero", "a pick changes nothing")
  print("ok speak at: greyed when speech is off")
end

-- speak at: a dropped cooldown speaks at 0
do
  reset()
  local D = CRT.AlertDraft
  assert(D.CooldownDefaults().speakAt == "zero", "cooldown defaults")
  assert(D.ForCooldown(777, nil, "Test Boss").speakAt == "zero", "a cooldown draft")
  local id = D.PlaceCooldown(ENC, 777, nil, "Test Boss", 1, 30)
  local r = id and R:Get(ENC, id)
  assert(r and r.speakAt == "zero", "placed as mine: speakAt zero")
  local items = R:Items(ENC, id, r)
  assert(items[1] and items[1].speech[1].offset == 0, "it speaks at the cast")
  assert(D.PlaceCooldown(ENC, 777, nil, "Test Boss", 1, 45, "Alexi"), "placed on the raid note")
  local raw
  for _, rec in pairs(CRT.db.notes.list) do raw = rec.raw end
  assert(raw and raw:find("ttsat:0;", 1, true), "its note line writes ttsat:0: " .. tostring(raw))
  print("ok speak at: a dropped cooldown speaks at 0")
end

`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
