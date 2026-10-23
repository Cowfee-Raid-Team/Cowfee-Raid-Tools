// The pop-out note editor: the real CRT_Modules/Notes/Parse.lua, Data.lua, Engine.lua, EditModel.lua, Render.lua,
// EditorWindow.lua, Settings.lua and Page.lua on mock frames.
//   The model: a note opened and saved with no edit gives the text back byte for byte (CRLF, spacing, unknown
//   fields, the invite list, no newline at the end); timed lines shown only, never rewritten, drops on them
//   refused; add, move and remove on label lines and the invite list change only the names (the invite list
//   players only, its slots kept); names with realms; palette tokens the alerts understand; Quick fill; a drag
//   and its cancel; read-only.
//   The window: the Pop out editor buttons, timers dimmed under their heading, rows and palette chips, a drag
//   with the mouse handlers and Escape,
//   Quick fill, the raw text, Save through Notes:UpdateRaw, the unsaved warning, the permission gate and the
//   personal note. Players from: the current group, the note's invite list or a saved Raid Groups layout (the
//   linked one first, picked when solo), class colours, search, the tokens written, and when the list redraws.
// Usage: node run_notes_editor.js <Parse.lua> <Data.lua> <Engine.lua> <EditModel.lua> <Render.lua> <EditorWindow.lua> <Settings.lua> <Page.lua>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local parseSrc, dataSrc, engineSrc, modelSrc, renderSrc, windowSrc, settingsSrc, pageSrc = ...
local edits, buttons, frames, scrolls, events, checks = {}, {}, {}, {}, {}, {}
local focused
local cursor = { 0, 0 }
local function mock(kind, name)
  local m = { shown = true, kind = kind, name = name, scripts = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self, _, _, font) local f = mock("FontString") rawset(f, "font", font) rawset(f, "parent", self) return f end end
    if k == "CreateTexture" then return function(self) local f = mock("Texture") rawset(f, "parent", self) return f end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") or "" end end
    if k == "Show" then return function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end end
    if k == "Hide" then return function(self) local was = self.shown self.shown = false if was and self.scripts.OnHide then self.scripts.OnHide(self) end end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "IsVisible" then return function(self) local f = self while f do if not f.shown then return false end f = rawget(f, "parent") end return true end end
    if k == "IsMouseOver" then return function(self) return rawget(self, "over") == true end end
    if k == "HasFocus" then return function(self) return focused == self end end
    if k == "SetFocus" then return function(self) if focused and focused ~= self then focused:ClearFocus() end focused = self end end
    if k == "ClearFocus" then return function(self) if focused == self then focused = nil if self.scripts.OnEditFocusLost then self.scripts.OnEditFocusLost(self) end end end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "Enable" then return function(self) rawset(self, "enabled", true) end end
    if k == "Disable" then return function(self) rawset(self, "enabled", false) end end
    if k == "IsEnabled" then return function(self) return rawget(self, "enabled") ~= false end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return rawget(self, "checked") == true end end
    if k == "EnableMouse" then return function(self, on) rawset(self, "mouse", on and true or false) end end
    if k == "EnableKeyboard" then return function(self, on) rawset(self, "keyboard", on and true or false) end end
    if k == "SetMultiLine" then return function(self, v) rawset(self, "multi", v) end end
    if k == "SetTexture" then return function(self, v) rawset(self, "texture", v) end end
    if k == "SetAtlas" then return function(self, v) rawset(self, "atlas", v) end end
    if k == "SetTextColor" then return function(self, r, g, b, a) rawset(self, "textColor", { r, g, b, a }) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetBackdropBorderColor" then return function(self, r, g, b, a) rawset(self, "border", { r, g, b, a }) end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "height", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "width", w) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "width", w) rawset(self, "height", h) end end
    if k == "GetHeight" then return function(self) return rawget(self, "height") or 400 end end
    if k == "GetWidth" then return function(self) return rawget(self, "width") or 600 end end
    if k == "GetStringHeight" then return function(self) return 12 end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "GetEffectiveScale" then return function() return 1 end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "GetScript" then return function(self, n) return self.scripts[n] end end
    if k == "HookScript" then return function(self, n, fn) local old = self.scripts[n] self.scripts[n] = function(...) if old then old(...) end fn(...) end end end
    if k == "RegisterEvent" then return function(self, e) events[e] = self end end
    return function() end end })
end
function CreateFrame(kind, name, parent, template)
  local m = mock(kind, name)
  rawset(m, "parent", parent)
  rawset(m, "template", template)
  if name then _G[name] = m end
  if kind == "EditBox" then edits[#edits + 1] = m elseif kind == "Button" then buttons[#buttons + 1] = m
  elseif kind == "CheckButton" then checks[#checks + 1] = m
  elseif kind == "ScrollFrame" then scrolls[#scrolls + 1] = m else frames[#frames + 1] = m end
  return m
end
format = string.format
date = os.date
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
UIParent = mock()
UISpecialFrames = {}
tinsert = table.insert
CANCEL = "Cancel"
function GetCursorPosition() return cursor[1], cursor[2] end
local mouseDown = true -- the left button held; a test lets it go to check a press the chip never hears end
function IsMouseButtonDown(b) return b == "LeftButton" and mouseDown end
local lifted
-- a value the game hides: any string starting SECRET
function issecretvalue(v) return type(v) == "string" and v:find("^SECRET") ~= nil end
local inRaid, leader = false, false
local combat = false
function IsInGroup() return inRaid end
function IsInRaid() return inRaid end
function UnitIsGroupLeader() return leader end
function UnitIsGroupAssistant() return false end
local myName = "Gadios"
function UnitName(u) if u == "player" then return myName end end
function UnitClass(u) if u == "player" then return "Priest", "PRIEST" end end
function UnitGroupRolesAssigned() return "HEALER" end
function UnitIsUnit(a, b) return a == "raid1" and b == "player" end
function GetNumGroupMembers() return 1 end
function GetRaidRosterInfo(i) if i == 1 then return "Gadios", 2, 3 end end
function GetTime() return 100 end
function InCombatLockdown() return combat end
function Ambiguate(key, mode) return (key:gsub("%-Sargeras$", "")) end
local CLASSES = { { "Warrior", "WARRIOR" }, { "Priest", "PRIEST" }, { "Death Knight", "DEATHKNIGHT" }, { "SECRETname", "MAGE" }, { "Demon Hunter", "DEMONHUNTER" } }
function GetNumClasses() return #CLASSES end
function GetClassInfo(i) local c = CLASSES[i] return c[1], c[2], i end
function GetClassAtlas(file) return "classicon-" .. file end
local afters = {}
C_Timer = { After = function(_, fn) afters[#afters + 1] = fn end }
local function runTimers() local list = afters afters = {} for _, fn in ipairs(list) do fn() end end
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function() return 0 end }
C_Spell = { GetSpellInfo = function(id) return { name = "Spell name " .. id, iconID = 1000 + id } end, RequestLoadSpellData = function() end }
-- not theme colours: the game's class colours
RAID_CLASS_COLORS = { MAGE = { r = 0.25, g = 0.78, b = 0.92, colorStr = "ff3fc7eb" }, PRIEST = { r = 1, g = 1, b = 1, colorStr = "ffffffff" },
  ROGUE = { r = 1, g = 0.96, b = 0.41, colorStr = "fffff468" }, WARRIOR = { r = 0.78, g = 0.61, b = 0.43, colorStr = "ffc69b6d" },
  DEATHKNIGHT = { r = 0.77, g = 0.12, b = 0.23, colorStr = "ffc41e3a" } }
local popups = {}
StaticPopupDialogs = {}
function StaticPopup_Show(key) popups[#popups + 1] = key return { key = key } end
function StaticPopup_Hide() end
local pages, printed = {}, {}
local CRT = {
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end },
  db = { classCache = {}, notes = { list = {}, nextId = 1, trustedOnly = true, personalText = "", editor = {},
    window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
    assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50 },
    alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100 } } },
  UI = { PAGE_W = 1026, PAGE_H = 560, SkinScrollBar = function() end, ScrollGutter = function(w) return 6 + (w or 18) end,
    Help = function(parent, title, text) local m = mock() rawset(m, "helpTitle", title) rawset(m, "helpText", text) return m end,
    Dropdown = function(_, label, opts) local m = mock() rawset(m, "label", label) rawset(m, "opts", opts) rawset(m, "refresh", function() end) return m end,
    Slider = function() local m = mock() rawset(m, "refresh", function() end) return m end,
    RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end,
    SetFrameTitle = function() end, RegisterTab = function() end, SetTabSelected = function() end, SkinTree = function() end,
    SkinButton = function() end, SkinCheckButton = function() end, PANEL_BUTTON_PAD = 14,
    SkinEditBox = function(_, e) rawset(e, "skinned", true) end, LiftOver = function(d) lifted = d end, ShownPopup = function(ret) return ret end,
    PanelButtonWidth = function(w) return math.max(40, math.ceil(w or 0) + 28) end },
  Alerts = { Settings = function() return { bars = {} } end, RegisterBlock = function() end, onPull = {}, OnChange = function() end,
    PeekNextPhase = function() return nil end },
  AlertRules = {},
  NoteReminders = { Build = function() end }, NotePhases = { Build = function() end },
  NoteAlertsTab = { Build = function() end, Select = function() end },
  NoteWindow = { FONTS = { { name = "Friz Quadrata" } }, Flash = function() end },
  NoteComm = { Sharing = function() return nil end, Share = function() end },
  NoteTargets = { List = function() return {} end, Get = function() return nil end },
  Groups = { NUM_SLOTS = 40, Normalize = function(n) if n ~= "" and not n:find("-", 1, true) then return n .. "-Sargeras" end return n end, CreatePreset = function() return "roster1" end, listeners = {} },
}
-- saved Raid Groups layouts: the note's imported invite list (roster1) and another, by name
local PRESETS = {
  { id = 7, name = "Alt team", slots = { "Zed-Sargeras", "Bob-Other", "", "Abu-Sargeras", "zed-sargeras", "Plain-Nowhere", "" } },
  { id = "roster1", name = "Nek'zali Mythic roster", slots = { "Abu-Sargeras", "Gadios-Sargeras", "Rixxy-Sargeras", "Kip-Sargeras", "" } },
}
function CRT.Groups:Presets() return PRESETS end
function CRT.Groups:Find(id) for i, p in ipairs(PRESETS) do if p.id == id then return p, i end end end
function CRT.Groups:OnChange(fn) self.listeners[#self.listeners + 1] = fn end
function CRT.Groups:Fire() for _, fn in ipairs(self.listeners) do fn() end end
CRT.db.roleCache = {}
function CRT.Groups.CachedRole(key) return key and CRT.db.roleCache[key:lower()] end
function CRT:Print(msg) printed[#printed + 1] = msg end
-- the window helper: a frame with content, Place and a strip with SetTitle
function CRT.UI.Window(name, opts)
  local f = CreateFrame("Frame", name, UIParent)
  rawset(f, "opts", opts)
  f.content = CreateFrame("Frame", nil, f)
  f.strip = { SetTitle = function(self, t) rawset(f, "title", t) end }
  rawset(f, "CloseButton", CreateFrame("Button", nil, f))
  f.Place = function() end
  f.shown = false
  if opts.escape ~= false and name then tinsert(UISpecialFrames, name) end
  return f
end
CRT_THEME(CRT, CRT.UI)
assert(load(parseSrc, "Parse.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "Engine.lua"))("CowfeeRaidTools", CRT)
assert(load(modelSrc, "EditModel.lua"))("CowfeeRaidTools", CRT)
local Model, Notes, Parser, Engine = CRT.NoteEditModel, CRT.Notes, CRT.NoteParser, CRT.NoteEngine
assert(Model and Model.New and Model.Palette, "CRT.NoteEditModel with New and Palette")

local NOTE = table.concat({
  "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali",
  "time:48;ph:1;tag:Abu Gadios;text:Group 1 go in;dur:8;colors:0 1 1 1;DisplayType:Text;",
  "  Time:34; ph:1 ;Tag: Cheoeqar  Abu-Sargeras ;spellid:64843;Custom:keep me;  ",
  "ph:1.5;time:5;spellid:99999;",
  "time:7",
  "time:2:10;ph:1;text:no time it can read;",
  "Melee: Cheoeqar, Abu",
  "Kicks G1:",
  "",
  "Kick order",
  "Something odd ; with: colons",
  "invitelist:Cheoeqar-Sargeras,Abu-Sargeras,,Gadios-Sargeras;",
}, "\\r\\n")
local function rowOf(s, kind, n)
  local k = 0
  for i, r in ipairs(s.rows) do if r.kind == kind then k = k + 1 if k == (n or 1) then return i, r end end end
end
local function lines(text) local out = {} for l in (text .. "\\n"):gmatch("(.-)\\n") do out[#out + 1] = l end return out end
-- every line but those listed is byte for byte the same
local function onlyChanged(before, after, changedLines)
  local a, b = lines(before), lines(after)
  assert(#a == #b, "same number of lines: " .. #a .. " vs " .. #b)
  local allowed = {}
  for _, n in ipairs(changedLines) do allowed[n] = true end
  for i = 1, #a do
    if not allowed[i] then assert(a[i] == b[i], "line " .. i .. " unchanged:\\n  " .. a[i] .. "\\n  " .. b[i]) end
  end
end

-- 1. Round trip: opened and saved with no edit, the text is the same, byte for byte
do
  local samples = { NOTE, NOTE .. "\\r\\n", (NOTE:gsub("\\r\\n", "\\n")), (NOTE:gsub("\\r\\n", "\\n")) .. "\\n\\n", "", "\\n",
    "time:1;tag:A;\\r\\ntime:2;tag:B;\\n  \\t\\nMixed: endings\\r\\n", "# Heading\\n- Abu: bullet\\n---\\n**Tanks**: Abu, Cheo\\nTanks: Abu",
    "  invitelist: A , B ,,C ;  \\ninvitelist:;\\ninvitelist:A" }
  for n, text in ipairs(samples) do
    for _, md in ipairs({ false, true }) do
      local s = Model.New(text, { markdown = md })
      assert(s:Text() == text, "sample " .. n .. " comes back as written")
      assert(not s:Dirty(), "sample " .. n .. " is not dirty")
    end
  end
  -- an add and its remove: the line is written exactly as it was
  local s = Model.New(NOTE)
  local i = rowOf(s, "label", 1)
  assert(s:Add(i, "Rixxy") and s:Dirty(), "an add makes it dirty")
  assert(s:Remove(i, #s:Names(i)) and s:Text() == NOTE and not s:Dirty(), "removing it again gives the text back")
  local inv = rowOf(s, "invite")
  assert(s:Remove(inv, 2) and s:Dirty(), "an invite list remove makes it dirty")
  assert(s:Add(inv, "Abu-Sargeras", "player") and s:Text() == NOTE and not s:Dirty(), "putting the player back gives the text back")
end
print("ok round trip: no edit gives the text back byte for byte, CRLF, spacing and unknown fields kept")

-- 2. Rows in the note's own order, by kind; only label lines and the invite list take names
do
  local s = Model.New(NOTE)
  local kinds = {}
  for i, r in ipairs(s.rows) do kinds[i] = r.kind end
  assert(table.concat(kinds, ",") == "header,timer,timer,timer,timer,unread,label,label,blank,heading,label,invite", table.concat(kinds, ","))
  local _, t = rowOf(s, "timer", 1)
  assert(t.time == "0:48" and t.ph == "1" and t.display == "Text" and t.timer.color, "a timer row: time, phase, display type, colour")
  assert(table.concat(t.tags, " ") == "Abu Gadios" and not t.editable, "a timer row shows its names, not editable")
  assert(s:Names(7)[2] == "Abu" and s.rows[7].label == "Melee", "a label row: its label and names")
  assert(table.concat(s:Names(12), " ") == "Cheoeqar-Sargeras Abu-Sargeras Gadios-Sargeras" and s.rows[12].editable, "the invite list: its players, editable")
  for _, i in ipairs({ 1, 2, 3, 4, 5, 6, 9, 10 }) do
    assert(not s:Add(i, "Abu"), "row " .. i .. " (" .. s.rows[i].kind .. ") takes no names")
  end
  assert(s:Text() == NOTE, "nothing changed")
end
print("ok rows in the note's order; header, timers, headings, text and unread lines take no names")

-- 3. Timed lines are never changed: no add, remove, move, drop, Quick fill or drag from them
do
  local s = Model.New(NOTE)
  for i = 2, 5 do
    assert(not s:Add(i, "Rixxy") and not s:Remove(i, 1) and not s:Move(i, 1, 7) and not s:Move(7, 1, i), "row " .. i .. " refuses edits")
    assert(not s:BeginDrag({ row = i, index = 1 }), "nothing to drag from row " .. i)
    assert(s:BeginDrag({ token = "Rixxy", kind = "player" }) and not s:Drop(i), "a drop on row " .. i .. " is refused")
  end
  s:SetQuickFill(true)
  assert(s:Select(2) == nil and not s:PaletteClick("tank", "general"), "a timer can't be selected for Quick fill")
  -- edits everywhere else leave every timed line byte for byte as written
  assert(s:Add(7, "Rixxy") and s:Remove(7, 1) and s:Add(8, "Zed") and s:Remove(12, 1) and s:Add(12, "Bob", "player"), "label and invite edits")
  local a, b = lines(NOTE:gsub("\\r", "")), lines(s:Text():gsub("\\r", ""))
  for i = 1, 6 do assert(a[i] == b[i], "line " .. i .. " untouched: " .. b[i]) end
  local note = Parser.Parse(s:Text())
  local byLine = {} for _, t in ipairs(note.timers) do byLine[t.line] = t end
  assert(#note.timers == 4 and table.concat(byLine[2].tags, " ") == "Abu Gadios" and #byLine[4].tags == 0, "the timers read the same")
  -- a duplicate, or not one word, is not added; no limit on how many names a line takes
  assert(not s:Add(7, "rixxy") and not s:Add(7, "two words") and not s:Add(7, "a;b") and not s:Add(7, "") and not s:Add(7, "SECRETx"), "duplicates and bad tokens refused")
  local many = Model.New("Soak:")
  for n = 1, 40 do assert(many:Add(1, "P" .. n)) end
  assert(#many:Names(1) == 40, "40 names on one line")
end
print("ok timed lines are shown only: drops, Quick fill and drags refused, never rewritten")

-- 4. Label lines: the names after the colon, separators as written
do
  local s = Model.New(NOTE)
  assert(s:Add(7, "Gadios") and s:LineText(7) == "Melee: Cheoeqar, Abu, Gadios", s:LineText(7))
  assert(s:Remove(7, 1) and s:LineText(7) == "Melee: Abu, Gadios", s:LineText(7))
  assert(s:Move(7, 1, 8) and s:LineText(8) == "Kicks G1: Abu" and s:LineText(7) == "Melee: Gadios", s:LineText(8) .. " / " .. s:LineText(7))
  assert(s:Add(8, "Rixxy-Sargeras") and s:LineText(8) == "Kicks G1: Abu, Rixxy-Sargeras", "a name with a realm: " .. s:LineText(8))
  assert(s:Move(8, 2, 11) and s:LineText(11) == "Something odd ; with: colons, Rixxy-Sargeras", "moved to another label: " .. s:LineText(11))
  onlyChanged(NOTE:gsub("\\r", ""), s:Text():gsub("\\r", ""), { 7, 8, 11 })
  assert(select(2, s:Text():gsub("\\r\\n", "")) == select(2, NOTE:gsub("\\r\\n", "")), "every line end kept")
  local sp = Model.New("Soak:  Abu Cheo  \\nOther:   ")
  assert(sp:Add(1, "Gil") and sp:LineText(1) == "Soak:  Abu Cheo Gil  ", "a space-separated label keeps spaces: [" .. sp:LineText(1) .. "]")
  assert(sp:Add(2, "Gil") and sp:LineText(2) == "Other:   Gil", "an empty label keeps its spaces: [" .. sp:LineText(2) .. "]")
end
print("ok label lines: names after the colon, commas and spaces as written")

-- 5. The invite list: players only, slots kept, its own format
do
  local s = Model.New(NOTE)
  assert(s:Remove(12, 2) and s:LineText(12) == "invitelist:Cheoeqar-Sargeras,,,Gadios-Sargeras;", "a removed player leaves the slot empty: " .. s:LineText(12))
  assert(s:Add(12, "Rixxy-Sargeras", "player") and s:LineText(12) == "invitelist:Cheoeqar-Sargeras,Rixxy-Sargeras,,Gadios-Sargeras;", "a new one fills the first empty slot: " .. s:LineText(12))
  assert(s:Add(12, "Bob", "player") and s:Add(12, "Zed", "player"), "two more")
  assert(s:LineText(12) == "invitelist:Cheoeqar-Sargeras,Rixxy-Sargeras,Bob,Gadios-Sargeras,Zed;", "then on the end: " .. s:LineText(12))
  local inv = Parser.Parse(s:Text()).invite
  assert(#inv == 5 and inv[2] == "Rixxy-Sargeras" and inv[5] == "Zed", "the parser reads it")
  -- only players: General, Groups and Classes chips are refused, and so are such words from a row
  assert(not s:Add(12, "tank", "general") and not s:Add(12, "everyone", "general") and not s:Add(12, "Group2", "group"), "general and group chips refused")
  assert(not s:Add(12, "PRIEST", "class") and not s:Add(12, "DEATHKNIGHT") and not s:Add(12, "deathknight") and not s:Add(12, "G3") and not s:Add(12, "healer"), "class and role words refused")
  assert(not s:Add(12, "Gadios-sargeras", "player"), "a player already there is refused")
  assert(s:BeginDrag({ token = "Group4", kind = "group" }) and not s:Drop(12), "a dropped group does nothing")
  s:SetQuickFill(true)
  assert(s:Select(12) == 12 and not s:PaletteClick("PRIEST", "class") and s:PaletteClick("Kip", "player"), "Quick fill: players only")
  -- a player dragged out of it onto a label, and a label's player into it; a label's group word stays out
  assert(s:Move(12, 1, 7) and s:Names(7)[3] == "Cheoeqar-Sargeras" and s:LineText(12):find("^invitelist:,Rixxy"), "dragged out: " .. s:LineText(12))
  assert(s:Move(7, 2, 12) and s:LineText(12):find("^invitelist:Abu,Rixxy"), "a label's player into the empty slot: " .. s:LineText(12))
  assert(s:Add(8, "Group2") and not s:Move(8, 1, 12) and s:Names(8)[1] == "Group2", "a label's group word can't go in")
  -- spaces in the slots, the closing ; and what follows stay as written
  local sp = Model.New("  invitelist: A , B ,,C ;  ")
  assert(sp:Remove(1, 2) and sp:Text() == "  invitelist: A ,  ,,C ;  ", "[" .. sp:Text() .. "]")
  assert(sp:Add(1, "D", "player") and sp:Text() == "  invitelist: A , D ,,C ;  ", "[" .. sp:Text() .. "]")
  local empty = Model.New("invitelist:;\\ninvitelist:A")
  assert(empty:Add(1, "A", "player") and empty:Add(2, "B", "player") and empty:Text() == "invitelist:A;\\ninvitelist:A,B", empty:Text())
end
print("ok the invite list: players only, a removed slot stays empty, separators and format as written")

-- 5b. A word no row can take is never lost; label punctuation kept; what counts as an assignment line
do
  local s = Model.New("invitelist:Two Words,A|x,Abu;\\nKicks: Cheo")
  assert(table.concat(s:Names(1), "/") == "Two Words/A|x/Abu", "the invite list's names as written")
  for k = 1, 2 do
    assert(not s:BeginDrag({ row = 1, index = k }), "a word no row can take is not picked up (" .. k .. ")")
    assert(not s:Move(1, k, 2), "and a move refuses it (" .. k .. ")")
  end
  assert(table.concat(s:Names(1), "/") == "Two Words/A|x/Abu" and not s:Dirty(), "nothing lost")
  assert(s:Move(1, 3, 2) and s:LineText(2) == "Kicks: Cheo, Abu" and s:LineText(1) == "invitelist:Two Words,A|x,;", "a good one still moves: " .. s:LineText(1))
  -- only spaces and commas separate a label's names: removing one keeps every other mark
  local p = Model.New("Soak: Abu (left), Cheo.\\nKicks: Abu, Cheo.")
  assert(table.concat(p:Names(1), "/") == "Abu/(left)/Cheo.", table.concat(p:Names(1), "/"))
  assert(p:Remove(1, 2) and p:LineText(1) == "Soak: Abu, Cheo.", "[" .. p:LineText(1) .. "]")
  assert(p:Remove(2, 1) and p:LineText(2) == "Kicks: Cheo.", "[" .. p:LineText(2) .. "]")
  -- a line is an assignment only when its label is short, plain and not a phase heading
  local kinds = Model.New(table.concat({ "Phase 2: kite adds left", "P1.5: run", "{time:1:30} Abu: soak", "|cffff0000Red|r: Abu",
    "Stack on the boss and then: spread", "Kick order: Abu", "Soak Circle G1: Cheo" }, "\\n"))
  local got = {}
  for i, r in ipairs(kinds.rows) do got[i] = r.kind end
  assert(table.concat(got, ",") == "text,text,text,text,text,label,label", table.concat(got, ","))
  assert(not kinds:Add(1, "Abu") and not kinds:Add(3, "Abu") and kinds:Add(6, "Cheo"), "only the real labels take names")
end
print("ok a word no row can take is never lost; label punctuation kept; phase headings and markup lines stay text")

-- 5c. A class name of two words is one name (Alex's Nymrissa note, 2026-10-21)
do
  local ORB = table.concat({ "Orb Soak 1: Demon Hunter Warlock Priest Monk", "Orb Soak 2: Shaman Monk Druid Rogue",
    "Orb Soak 3: Mage Warlock Death Knight Warrior", "Orb Soak 4: Hunter" }, "\\n")
  local s = Model.New(ORB)
  assert(table.concat(s:Names(1), "/") == "Demon Hunter/Warlock/Priest/Monk", table.concat(s:Names(1), "/"))
  assert(table.concat(s:Names(2), "/") == "Shaman/Monk/Druid/Rogue", table.concat(s:Names(2), "/"))
  assert(table.concat(s:Names(3), "/") == "Mage/Warlock/Death Knight/Warrior", table.concat(s:Names(3), "/"))
  assert(table.concat(s:Names(4), "/") == "Hunter", "Hunter on its own stays Hunter")
  assert(s:Text() == ORB and not s:Dirty(), "opened and read: as written")
  assert(s:Remove(1, 1) and s:LineText(1) == "Orb Soak 1: Warlock Priest Monk", "[" .. s:LineText(1) .. "]")
  assert(s:Remove(3, 3) and s:LineText(3) == "Orb Soak 3: Mage Warlock Warrior", "[" .. s:LineText(3) .. "]")
  onlyChanged(ORB, s:Text(), { 1, 3 })
  -- the one-word spellings in any case; a comma between the words keeps them apart; the spaces as written
  local o = Model.New("Soak: DemonHunter, DEMONHUNTER deathknight\\nSplit: Demon, Hunter\\nWide: Death   Knight, Abu\\nEnd: Abu demon HUNTER")
  assert(table.concat(o:Names(1), "/") == "DemonHunter/DEMONHUNTER/deathknight", table.concat(o:Names(1), "/"))
  assert(table.concat(o:Names(2), "/") == "Demon/Hunter", table.concat(o:Names(2), "/"))
  assert(table.concat(o:Names(3), "/") == "Death   Knight/Abu", table.concat(o:Names(3), "/"))
  assert(table.concat(o:Names(4), "/") == "Abu/demon HUNTER", table.concat(o:Names(4), "/"))
  assert(o:Remove(3, 1) and o:LineText(3) == "Wide: Abu", "[" .. o:LineText(3) .. "]")
  assert(o:Remove(4, 2) and o:LineText(4) == "End: Abu", "[" .. o:LineText(4) .. "]")
  -- dragged from the palette it writes the name as notes write it; moved as one; a second spelling is a duplicate
  local entry
  for _, e in ipairs(Model.Palette({})[4].entries) do if e.class == "DEMONHUNTER" then entry = e end end
  assert(entry and entry.token == "Demon Hunter" and entry.label == "Demon Hunter", "the palette's Demon Hunter")
  local m = Model.New("A: Abu\\nB: Cheo\\nC: DEMONHUNTER\\ninvitelist:Abu;")
  assert(m:BeginDrag({ token = entry.token, kind = "class" }) and m:Drop(1) and m:LineText(1) == "A: Abu, Demon Hunter", "[" .. m:LineText(1) .. "]")
  assert(m:BeginDrag({ token = "Death Knight", kind = "class" }) and m:Drop(2) and m:LineText(2) == "B: Cheo, Death Knight", "[" .. m:LineText(2) .. "]")
  assert(m:BeginDrag({ row = 1, index = 2 }) and m:Drop(2) and m:LineText(2) == "B: Cheo, Death Knight, Demon Hunter" and m:LineText(1) == "A: Abu", "moved as one")
  assert(not m:Move(2, 3, 3) and m:LineText(3) == "C: DEMONHUNTER", "the same class in another spelling is a duplicate")
  assert(not m:Move(2, 3, 4) and not m:Add(4, "Demon Hunter") and not m:Add(4, "DemonHunter", "player"), "never in the invite list")
  assert(m:LineText(4) == "invitelist:Abu;", m:LineText(4))
  assert(not m:Add(1, "Demon Hunters") and not m:Add(1, "Abu Cheo"), "only a class name may hold a space")
  assert(not m:Add(1, "Death\\tKnight") and not m:Add(1, " Death Knight") and not m:Add(1, "Death Knight "), "only spaces, inside it")
  local tab = Model.New("Soak: Demon\\tHunter")
  assert(table.concat(tab:Names(1), "/") == "Demon/Hunter", "a tab keeps two words apart")
  for _, w in ipairs({ "Demon Hunter", "DemonHunter", "DEMONHUNTER", "demon hunter", "Death Knight", "DeathKnight", "Hunter", "PRIEST" }) do
    assert(Model.NotPlayer(w), w .. " is not a player")
  end
  assert(not Model.NotPlayer("Demon") and not Model.NotPlayer("Knight") and not Model.NotPlayer("Abu"), "a word that is no class is a name")
end
print("ok two-word class names: one chip, removed whole, written with the space, the one-word spellings read")

-- 6. Palette tokens: the words the alerts understand
do
  local roster = {
    { key = "Zed-Sargeras", class = "WARRIOR", role = "DAMAGER", subgroup = 1 },
    { key = "Abu-Sargeras", class = "MAGE", role = "TANK", subgroup = 1 },
    { key = "Gadios-Sargeras", class = "PRIEST", role = "HEALER", subgroup = 3 },
    { key = "Bob-Other", class = "ROGUE", role = nil, subgroup = 2 },
    { key = "SECRETkey", class = "MAGE", role = "TANK" },
  }
  local sections = Model.Palette(roster)
  local keys, kinds = {}, {}
  for i, sec in ipairs(sections) do keys[i] = sec.key kinds[i] = sec.kind end
  assert(table.concat(keys, ",") == "players,general,groups,classes", table.concat(keys, ","))
  assert(table.concat(kinds, ",") == "player,general,group,class", "each section's chip kind")
  local p = sections[1].entries
  assert(#p == 4 and p[1].token == "Abu" and p[2].token == "Gadios" and p[3].token == "Zed" and p[4].token == "Bob-Other", "players by role, own realm left out, secret skipped")
  assert(p[1].class == "MAGE" and p[1].role == "TANK", "a player's class and role")
  local g = {}
  for _, e in ipairs(sections[2].entries) do g[#g + 1] = e.token end
  assert(table.concat(g, ",") == "everyone,tank,healer,dps,melee,ranged", table.concat(g, ","))
  assert(#sections[3].entries == 8 and sections[3].entries[1].token == "Group1" and sections[3].entries[8].token == "Group8", "Group1..Group8")
  local c = sections[4].entries
  assert(#c == 4 and c[3].token == "Death Knight" and c[3].label == "Death Knight" and c[3].class == "DEATHKNIGHT", "classes by name as notes write them, a hidden class name skipped")
  assert(c[1].token == "Warrior" and c[4].token == "Demon Hunter" and c[4].class == "DEMONHUNTER", "Demon Hunter with its space")
  -- each token is one the alerts read: the player here is a healer priest in raid group 3
  local function mine(word) return Engine:IsMine({ tags = { word } }) end
  inRaid = true
  assert(mine("everyone") and mine("healer") and mine("Group3") and mine("PRIEST") and mine("Gadios"), "everyone, role, group, class and name match")
  assert(not mine("tank") and not mine("dps") and not mine("Group1") and not mine("WARRIOR") and not mine("melee"), "others don't")
  inRaid = false
  local found = Model.Palette(roster, "gro")
  assert(#found[3].entries == 8 and #found[1].entries == 0 and #found[2].entries == 0, "search keeps Group1..8 for 'gro'")
  found = Model.Palette(roster, "death")
  assert(#found[4].entries == 1 and found[4].entries[1].token == "Death Knight", "search finds a class by its name")
end
print("ok palette: players by role, general, Group1..8 and classes, each token one the alerts read; search")

-- 7. Quick fill, drag and cancel, read-only
do
  local s = Model.New(NOTE)
  assert(not s:PaletteClick("tank", "general"), "Quick fill off: a click adds nothing")
  s:SetQuickFill(true)
  assert(s:Select(10) == nil and s:Select(4) == nil, "a heading or a timer can't be selected")
  assert(s:Select(8) == 8, "a label row is selected")
  assert(s:PaletteClick("tank", "general") and s:PaletteClick("Group2", "group") and table.concat(s:Names(8), " ") == "tank Group2", "clicks add to it")
  s:SetQuickFill(false)
  assert(s.selected == nil and not s:PaletteClick("dps", "general"), "off again: nothing selected")
  assert(s:BeginDrag({ token = "Rixxy", kind = "player" }) and s:Drop(7) and s:Names(7)[3] == "Rixxy", "palette chip dropped on a label")
  assert(s:BeginDrag({ row = 7, index = 3 }) and s:Drop(11) and s:Names(11)[2] == "Rixxy" and #s:Names(7) == 2, "row chip moved to another label")
  local before = s:Text()
  assert(s:BeginDrag({ token = "Nobody", kind = "player" }))
  s:CancelDrag()
  assert(not s:Drop(7) and s:Text() == before, "a cancelled drag drops nothing")
  assert(s:BeginDrag({ token = "Nobody" }) and not s:Drop(nil) and s.drag == nil and s:Text() == before, "dropped outside every row: nothing")
  assert(s:BeginDrag({ row = 7, index = 1 }) and not s:Drop(7) and s:Text() == before, "dropped on its own row: nothing")
  assert(not s:BeginDrag({ row = 10, index = 1 }), "a heading has nothing to drag")
  local r = Model.New(NOTE, { readOnly = true })
  r:SetQuickFill(true)
  assert(not r:Add(7, "X") and not r:Remove(7, 1) and not r:Move(7, 1, 8) and not r:BeginDrag({ token = "X" }) and r:Select(7) == nil, "read-only refuses every edit")
  assert(not r:Remove(12, 1) and r:Text() == NOTE, "and the text is as written")
end
print("ok Quick fill, drag, drag cancel and read-only")

-- The window --------------------------------------------------------------------------------------------------
if not windowSrc then return end
CRT.UI.PanelButton = function(parent, label, h, fn)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b:SetText(label) b:SetScript("OnClick", fn) return b
end
-- the title bar's History button (run_notes_history.js tests it)
CRT.UI.HeaderButton = function(parent, label, fn)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b:SetText(label) b:SetScript("OnClick", fn)
  b.SetLabel = function(self, t) self:SetText(t) end
  return b
end
assert(load(renderSrc, "Render.lua"))("CowfeeRaidTools", CRT)
assert(load(windowSrc, "EditorWindow.lua"))("CowfeeRaidTools", CRT)
assert(load(settingsSrc, "Settings.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local Editor = CRT.NoteEditor
assert(Editor and Editor.Open and Editor.state, "CRT.NoteEditor with Open")
CRT.Groups.ReadRoster = function() return { { key = "Abu-Sargeras", class = "MAGE", role = "TANK" }, { key = "Gadios-Sargeras", class = "PRIEST", role = "HEALER" },
  { key = "Rixxy-Sargeras", class = "ROGUE", role = "DAMAGER" }, { key = "Kip-Sargeras", class = "WARRIOR", role = "DAMAGER" } } end
local id = Notes:Import(NOTE)
Notes:SetActive(id)
local pf = mock()
pages.notes(pf)
pf:Show()
CRT.NotesPage.Open("notes")
local function redraw() for _, fn in ipairs(Notes.listeners) do fn() end end
local function button(text) for _, b in ipairs(buttons) do if rawget(b, "text") == text then return b end end end
local W = Editor.state
local function paletteChip(token) for _, c in ipairs(W.paletteChips) do if c.shown and c.token == token then return c end end end
local function shownRows() local n = 0 for _, f in ipairs(W.rowFrames) do if f.shown then n = n + 1 end end return n end
local function chipsShown(f) local n = 0 for _, c in ipairs(f.chips) do if c.shown then n = n + 1 end end return n end
-- a press on a chip, the mouse moved and over row rowIndex (nil: over no row), then let go
local function drag(chip, rowIndex)
  cursor = { 100, 100 }
  chip.scripts.OnMouseDown(chip, "LeftButton")
  cursor = { 130, 140 }
  if W.driver.shown then W.driver.scripts.OnUpdate(W.driver) end
  for i, f in ipairs(W.rowFrames) do rawset(f, "over", i == rowIndex) end
  rawset(W.rowsScroll, "over", rowIndex ~= nil)
  if W.driver.shown then W.driver.scripts.OnUpdate(W.driver) end
  chip.scripts.OnMouseUp(chip, "LeftButton")
  for _, f in ipairs(W.rowFrames) do rawset(f, "over", false) end
end
local function click(chip) cursor = { 50, 50 } chip.scripts.OnMouseDown(chip, "LeftButton") if W.driver.shown then W.driver.scripts.OnUpdate(W.driver) end chip.scripts.OnMouseUp(chip, "LeftButton") end

-- 8. Pop out editor: rows, timers dimmed and shown only, the palette, a drag adds and moves, x removes
do
  local pop = button("Pop out editor")
  assert(pop and pop:IsEnabled(), "a Pop out editor button by the Note text")
  assert(button("Pop out"), "and one by the Personal note")
  pop.scripts.OnClick(pop)
  assert(W.window.shown and W.session and W.session.base == NOTE and not W.session.readOnly, "it opens the selected note, editable")
  assert(rawget(W.window, "title"):find("Nek'zali", 1, true), "titled with the note")
  assert(W.window.opts.kind == "popout" and W.window.opts.layer == "popups" and W.window.opts.saved() == CRT.db.notes.editor, "a pop-out on the popups layer, its place saved in notes.editor")
  assert(shownRows() == #W.session.rows, "a row per line")
  -- timed lines: under the Timers heading, dimmed, their names as text, no chips, no mouse
  assert(W.timerHeading.shown and W.timerHeading:GetText():find("not editable", 1, true), "the Timers heading")
  for i = 2, 5 do
    local f = W.rowFrames[i]
    assert(rawget(f, "alpha") == 0.5, "timer row " .. i .. " dimmed")
    assert(chipsShown(f) == 0 and rawget(f, "mouse") == false, "timer row " .. i .. ": no chips, no clicks")
  end
  assert(W.rowFrames[2].info:GetText():find("Abu, Gadios", 1, true), "a timer's names shown as text: " .. W.rowFrames[2].info:GetText())
  local chips = W.rowFrames[7].chips
  assert(chips[1].shown and chips[1].text:GetText() == "Cheoeqar" and chips[2].text:GetText() == "Abu" and chips[1].remove.shown, "row 7's names as removable chips")
  assert(chips[2].text.textColor[1] == RAID_CLASS_COLORS.MAGE.r, "a chip in its class colour")
  assert(chipsShown(W.rowFrames[12]) == 3 and W.rowFrames[12].label:GetText() == "Invite list (3):", "the invite list as player chips")
  for _, token in ipairs({ "Abu", "Gadios", "Rixxy", "everyone", "tank", "Group1", "Group8", "Warrior", "Death Knight" }) do
    assert(paletteChip(token), "a palette chip for " .. token)
  end
  assert(rawget(paletteChip("Abu").icon, "atlas") == "classicon-MAGE" and paletteChip("Abu").icon.shown, "a player's class icon")
  assert(paletteChip("Death Knight").text:GetText() == "Death Knight", "a class by its name")
  -- a drop on a timer is refused
  drag(paletteChip("Rixxy"), 4)
  assert(not W.session:Dirty() and not W.ghost.shown, "a drop on a timed line does nothing")
  -- onto an assignment line
  drag(paletteChip("Rixxy"), 8)
  assert(table.concat(W.session:Names(8), " ") == "Rixxy", "dropped on row 8")
  assert(W.raw:GetText():find("Kicks G1: Rixxy\\r\\n", 1, true), "the raw text follows at once")
  assert(W.save:IsEnabled() and W.status:GetText():find("Unsaved", 1, true), "Save on, unsaved changes said")
  -- a row's chip dragged onto another row moves it
  drag(W.rowFrames[7].chips[2], 11)
  assert(table.concat(W.session:Names(11), " ") == "colons Abu" and table.concat(W.session:Names(7), " ") == "Cheoeqar", "Abu moved from row 7 to row 11")
  -- the invite list: a General chip is refused, a player goes in
  local before = W.session:Text()
  drag(paletteChip("tank"), 12)
  drag(paletteChip("Group1"), 12)
  drag(paletteChip("Warrior"), 12)
  assert(W.session:Text() == before, "only players go in the invite list")
  drag(paletteChip("Kip"), 12)
  assert(W.session:LineText(12) == "invitelist:Cheoeqar-Sargeras,Abu-Sargeras,Kip,Gadios-Sargeras;", W.session:LineText(12))
  drag(paletteChip("tank"), nil)
  assert(not W.ghost.shown, "a drop outside the rows does nothing")
  -- x removes, from a label and from the invite list
  local x = W.rowFrames[7].chips[1].remove
  x.scripts.OnClick(x)
  assert(#W.session:Names(7) == 0, "x removes Cheoeqar")
  x = W.rowFrames[12].chips[1].remove
  x.scripts.OnClick(x)
  assert(W.session:LineText(12) == "invitelist:,Abu-Sargeras,Kip,Gadios-Sargeras;", "x empties the invite slot: " .. W.session:LineText(12))
end
print("ok the window: timers dimmed and shown only, chips, drag adds and moves, the invite list takes players only, x removes")

-- 9. Escape cancels a drag; a press that doesn't move is a click; Quick fill
do
  local before = W.session:Text()
  local chip = paletteChip("healer")
  cursor = { 10, 10 }
  chip.scripts.OnMouseDown(chip, "LeftButton")
  cursor = { 60, 10 }
  W.driver.scripts.OnUpdate(W.driver)
  assert(W.ghost.shown and W.session.drag and rawget(W.driver, "keyboard"), "dragging, with the keys caught for Escape")
  rawset(W.rowFrames[8], "over", true) rawset(W.rowsScroll, "over", true)
  W.driver.scripts.OnKeyDown(W.driver, "ESCAPE")
  assert(not W.ghost.shown and not W.driver.shown and W.session.drag == nil and not rawget(W.driver, "keyboard"), "Escape ends it")
  chip.scripts.OnMouseUp(chip, "LeftButton")
  rawset(W.rowFrames[8], "over", false)
  assert(W.session:Text() == before, "and the button let go drops nothing")
  click(paletteChip("Group2"))
  assert(W.session:Text() == before, "a click without Quick fill adds nothing")
  W.quick:SetChecked(true)
  W.quick.scripts.OnClick(W.quick)
  assert(W.session.quickFill, "Quick fill on")
  W.rowFrames[3].scripts.OnMouseDown(W.rowFrames[3])
  assert(W.session.selected == nil, "a timer can't be selected")
  W.rowFrames[8].scripts.OnMouseDown(W.rowFrames[8])
  assert(W.session.selected == 8, "a click on a line selects it")
  click(paletteChip("Group2"))
  click(paletteChip("Abu"))
  assert(table.concat(W.session:Names(8), " ") == "Rixxy Group2 Abu", "clicks fill it: " .. table.concat(W.session:Names(8), " "))
  assert(W.raw:GetText():find("Kicks G1: Rixxy, Group2, Abu", 1, true), "the raw text: " .. W.raw:GetText())
  W.rowFrames[12].scripts.OnMouseDown(W.rowFrames[12])
  click(paletteChip("Group2"))
  click(paletteChip("Rixxy"))
  assert(W.session:LineText(12) == "invitelist:Rixxy,Abu-Sargeras,Kip,Gadios-Sargeras;", "Quick fill on the invite list: players only: " .. W.session:LineText(12))
  W.quick:SetChecked(false)
  W.quick.scripts.OnClick(W.quick)
  local text = W.raw:GetText()
  W.raw:SetText("typed")
  W.raw.scripts.OnTextChanged(W.raw, true)
  assert(W.raw:GetText() == text, "typing in the raw text is undone")
  assert(not W.rawBox.shown and rawget(W.rawButton, "text") == "Raw text", "the raw text hidden at first")
  W.rawButton.scripts.OnClick(W.rawButton)
  assert(W.rawBox.shown and rawget(W.rawButton, "text") == "Hide raw text", "Raw text shows it")
end
print("ok Escape cancels a drag, a click is not a drag, Quick fill, the raw text read-only")

-- 10. Save: through Notes:UpdateRaw, only the names changed, timers untouched
do
  local expected = W.session:Text()
  W.save.scripts.OnClick(W.save)
  local saved = Notes:Get(id).raw
  assert(saved == expected, "the note holds the editor's text")
  onlyChanged(NOTE:gsub("\\r", ""), saved:gsub("\\r", ""), { 7, 8, 11, 12 })
  assert(select(2, saved:gsub("\\r\\n", "")) == select(2, NOTE:gsub("\\r\\n", "")), "line ends kept")
  assert(not W.session:Dirty() and W.session.base == saved and not W.save:IsEnabled(), "a clean session after Save")
  local parsed = Notes:Parsed(id)
  assert(parsed.invite[1] == "Rixxy" and parsed.invite[3] == "Kip", "the stored invite list has the new players")
  assert(CRT.NoteRender.views.Text.text == saved, "the page's rendered note shows it")
end
print("ok Save writes the raw text through Notes:UpdateRaw; only names changed, timers untouched")

-- 11. Unsaved changes warn on close; a clean close doesn't
do
  local kept = Notes:Get(id).raw
  W.window:Hide()
  assert(#popups == 0, "a clean close asks nothing")
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  drag(paletteChip("Gadios"), 8)
  assert(W.session:Dirty(), "an unsaved change")
  W.window:Hide()
  runTimers()
  assert(popups[#popups] == "COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED", "closing asks")
  assert(lifted and lifted.key == "COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED", "the question is lifted over the editor")
  assert(W.window.shown and W.session:Dirty(), "the editor stays up with the change")
  assert(not Editor.Open({ personal = true }), "the personal note waits")
  StaticPopupDialogs.COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED.OnAccept()
  assert(not W.window.shown and W.session == nil, "Discard closes it")
  runTimers()
  assert(not W.window.shown, "and it stays closed")
  assert(Notes:Get(id).raw == kept, "nothing saved")
end
print("ok unsaved changes warn on close")

-- 12. Following changes from elsewhere; a note changed under unsaved edits is not overwritten
do
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  local newer = Notes:Get(id).raw .. "\\r\\nHealers: Gadios"
  Notes:UpdateRaw(id, newer)
  assert(W.session.base == newer and W.session.rows[#W.session.rows].label == "Healers", "a clean editor follows a change")
  drag(paletteChip("Abu"), #W.session.rows)
  Notes:UpdateRaw(id, newer .. "\\r\\nShared: by someone")
  assert(W.session:Dirty() and W.session.base == newer, "unsaved edits are kept")
  W.save.scripts.OnClick(W.save)
  assert(Notes:Get(id).raw == newer .. "\\r\\nShared: by someone", "Save doesn't overwrite the newer note")
  assert(W.status:GetText():find("changed since you opened it", 1, true), "and says why")
  StaticPopupDialogs.COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED.OnAccept()
end
print("ok a clean editor follows changes; a note changed under unsaved edits is not overwritten")

-- 13. A raider who can't change the raid note: read-only
do
  inRaid, leader = true, false
  redraw()
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  assert(W.window.shown and W.session.readOnly, "it opens read-only")
  assert(not W.save:IsEnabled() and not W.quick:IsEnabled(), "Save and Quick fill greyed")
  assert(not W.rowFrames[12].chips[1].remove.shown, "no x on the chips")
  assert(W.status:GetText():find("Only the raid leader", 1, true), "the status says why")
  local before = Notes:Get(id).raw
  drag(paletteChip("Gadios"), 7)
  assert(not W.session:Dirty() and not W.driver.shown, "a drag doesn't start")
  assert(not Editor.Save() and Notes:Get(id).raw == before, "Save writes nothing")
  leader = true
  redraw()
  assert(not W.session.readOnly and W.quick:IsEnabled(), "a promotion unlocks it")
  drag(paletteChip("Gadios"), 7)
  assert(W.session:Dirty(), "an edit")
  leader = false
  assert(not Editor.Save() and Notes:Get(id).raw == before, "Save asks CanEditRaid again")
  StaticPopupDialogs.COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED.OnAccept()
  inRaid, leader = false, false
  redraw()
end
print("ok read-only for a raider who can't change the raid note; Save asks again")

-- 14. The personal note: its own editor, saved with Notes:SetPersonal, timers and markdown lines as written
do
  Notes:SetPersonal("# Mine\\nTanks: Abu\\n- Gadios: a bullet\\ntime:10;ph:1;spellid:64843;")
  inRaid, leader = true, false -- a personal note is yours, whatever your rank
  local pp = button("Pop out")
  pp.scripts.OnClick(pp)
  assert(W.window.shown and W.source.personal and not W.session.readOnly, "the personal note opens, editable")
  assert(rawget(W.window, "title") == "Personal note editor", "titled")
  assert(W.session.rows[1].kind == "heading" and W.session.rows[3].kind == "text" and W.session.rows[2].kind == "label", "# heading and - bullet as written, a label takes names")
  drag(paletteChip("dps"), 4)
  assert(not W.session:Dirty(), "its timed line refuses a drop")
  drag(paletteChip("Gadios"), 2)
  W.save.scripts.OnClick(W.save)
  assert(Notes:Personal() == "# Mine\\nTanks: Abu, Gadios\\n- Gadios: a bullet\\ntime:10;ph:1;spellid:64843;", "saved: " .. Notes:Personal())
  assert(not W.session:Dirty(), "clean after Save")
  W.window:Hide()
  inRaid, leader = false, false
end
print("ok the personal note: opened, edited and saved with only names changed")

-- 15. A theme switch repaints the open editor
do
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  CRT.UI.SwitchTheme("nitro")
  local chip = paletteChip("Abu")
  local b = CRT.PALETTE.border
  local got = rawget(chip, "border")
  assert(got and got[1] == b[1] and got[2] == b[2] and got[3] == b[3], "a chip's edge in the theme's border colour")
  CRT.UI.SwitchTheme("cowfee")
  b = CRT.PALETTE.border
  got = rawget(chip, "border")
  assert(got[1] == b[1] and got[2] == b[2], "and again after another switch")
  W.window:Hide()
end
print("ok a theme switch repaints the editor")

-- 16. A ghost never sticks: the button let go unheard ends the press; a redraw under a press ends it
do
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  assert(W.search.skinned, "the Search box is skinned")
  W.from.opts.set("group") -- the palette lists the group, so a roster change redraws it
  local before = W.session:Text()
  local chip = paletteChip("Gadios")
  cursor = { 10, 10 }
  chip.scripts.OnMouseDown(chip, "LeftButton")
  cursor = { 80, 10 }
  W.driver.scripts.OnUpdate(W.driver)
  assert(W.ghost.shown, "dragging")
  mouseDown = false -- let go where the chip never heard it
  W.driver.scripts.OnUpdate(W.driver)
  mouseDown = true
  assert(not W.ghost.shown and not W.driver.shown and W.press == nil and W.session.drag == nil, "the press ends, the ghost goes")
  assert(W.session:Text() == before, "and nothing is dropped")
  -- a roster change redraws the palette under a press: the press ends
  chip = paletteChip("Gadios")
  chip.scripts.OnMouseDown(chip, "LeftButton")
  cursor = { 150, 10 }
  W.driver.scripts.OnUpdate(W.driver)
  assert(W.ghost.shown, "dragging again")
  W.window.scripts.OnEvent(W.window, "GROUP_ROSTER_UPDATE")
  assert(not W.ghost.shown and W.press == nil, "a redraw ends it")
  chip.scripts.OnMouseUp(chip, "LeftButton")
  assert(W.session:Text() == before, "the late button up drops nothing")
  -- a refused drop still redraws: the rows drawn again
  local draws = 0
  local old = Editor.DrawRows
  Editor.DrawRows = function() draws = draws + 1 return old() end
  drag(paletteChip("tank"), 12)
  Editor.DrawRows = old
  assert(draws > 0 and W.session:Text() == before, "a refused drop redraws, changes nothing")
  W.window:Hide()
end
print("ok a ghost never sticks: a button let go unheard or a redraw ends the press; a refused drop redraws")

-- 17. A promotion unlocks a clean read-only editor on the roster event alone
do
  inRaid, leader = true, false
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  assert(W.session.readOnly, "read-only")
  leader = true
  W.window.scripts.OnEvent(W.window, "GROUP_ROSTER_UPDATE")
  assert(not W.session.readOnly and W.quick:IsEnabled(), "unlocked by GROUP_ROSTER_UPDATE")
  W.window:Hide()
  inRaid, leader = false, false
end
print("ok a promotion unlocks the editor on GROUP_ROSTER_UPDATE")

-- 18. Changed while open or typed: the editor's personal Save and the page's raw Saves never write over it
do
  Notes:SetPersonal("Tanks: Abu")
  local pp = button("Pop out")
  pp.scripts.OnClick(pp)
  drag(paletteChip("Gadios"), 1)
  Notes:SetPersonal("Tanks: Abu\\nNew: line")
  W.save.scripts.OnClick(W.save)
  assert(Notes:Personal() == "Tanks: Abu\\nNew: line" and W.status:GetText():find("changed since you opened it", 1, true), "the editor's personal Save refuses")
  StaticPopupDialogs.COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED.OnAccept()
  -- the page's Note text: typed, then the note changes underneath
  local editor, personal
  for _, e in ipairs(edits) do if rawget(e, "multi") then if not editor then editor = e elseif not personal then personal = e end end end
  redraw()
  local current = Notes:Get(id).raw
  editor:SetText(current .. "\\r\\nTyped: here")
  Notes:UpdateRaw(id, current .. "\\r\\nShared: meanwhile")
  local save = button("Save text changes")
  save.scripts.OnClick(save)
  assert(Notes:Get(id).raw == current .. "\\r\\nShared: meanwhile", "the first Save doesn't write over the change")
  assert(printed[#printed]:find("changed while you were typing", 1, true), "and says so")
  save.scripts.OnClick(save)
  assert(Notes:Get(id).raw == current .. "\\r\\nTyped: here", "a second Save replaces it, by choice")
  -- the personal box: the same
  redraw()
  personal:SetText(Notes:Personal() .. "\\nMine: typed")
  Notes:SetPersonal("Other: text")
  local psave = button("Save personal note")
  psave.scripts.OnClick(psave)
  assert(Notes:Personal() == "Other: text" and printed[#printed]:find("changed in the note editor", 1, true), "the personal Save refuses first")
  psave.scripts.OnClick(psave)
  assert(Notes:Personal():find("Mine: typed", 1, true), "then replaces it")
end
print("ok a note changed while open or typed is never written over without a second Save")

-- 19. Players from: the current group, the note's invite list or a saved Raid Groups layout
do
  -- the model: the choices (the linked layout first), the default, a roster from names
  local function keysOf(list) local out = {} for i, o in ipairs(list) do out[i] = tostring(o.key) end return table.concat(out, ",") end
  assert(keysOf(Model.Sources(PRESETS)) == "group,invite,7,roster1", keysOf(Model.Sources(PRESETS)))
  local src = Model.Sources(PRESETS, "roster1")
  assert(keysOf(src) == "group,invite,roster1,7" and src[1].label == "Current group" and src[2].label == "This note's invite list"
    and src[3].label == "Nek'zali Mythic roster", "the linked layout listed first: " .. keysOf(src))
  assert(Model.DefaultSource(7, false) == 7 and Model.DefaultSource(7, true) == "group" and Model.DefaultSource(nil, false) == "group", "the default")
  local r = Model.Roster({ "A-X", "", "a-x", "B", "SECRETz" }, function(n) return n == "B" and "MAGE" or nil end, function() return "TANK" end)
  assert(#r == 2 and r[1].key == "A-X" and r[1].class == nil and r[2].class == "MAGE" and r[2].role == "TANK", "each name once, class and role")

  -- the window: solo, a note linked to a layout opens on that layout
  inRaid, leader = false, false
  local id2 = Notes:Import("EncounterID:3471;Difficulty:Heroic;Name:Other\\ninvitelist:Abu-Sargeras,Kip-Sargeras,Wren-Elsewhere;\\nSoak: Abu")
  Notes:Get(id2).presetId = 7
  CRT.db.classCache["zed-sargeras"] = "WARRIOR"
  CRT.db.classCache["bob-other"] = "ROGUE" -- known only from the stored class
  CRT.db.classCache["abu-sargeras"] = nil -- known only from the group
  CRT.db.roleCache["abu-sargeras"] = "TANK"
  CRT.db.roleCache["zed-sargeras"] = "DAMAGER"
  assert(Editor.Open({ id = id2 }), "opens")
  assert(W.from.label == "Players from", "the Players from dropdown")
  assert(W.from.opts.get() == 7 and W.playersFrom == 7, "the linked layout picked when solo")
  assert(keysOf(W.from.opts.options()) == "group,invite,7,roster1", "the linked layout listed first")
  local function players()
    local out = {}
    for _, c in ipairs(W.paletteChips) do if c.shown and c.source and c.source.kind == "player" then out[#out + 1] = c.token end end
    return table.concat(out, ",")
  end
  assert(players() == "Abu,Zed,Bob-Other,Plain-Nowhere", "the layout's players by role then name, own realm dropped: " .. players())
  local function colour(token) return paletteChip(token).text.textColor end
  assert(colour("Zed")[1] == RAID_CLASS_COLORS.WARRIOR.r and colour("Bob-Other")[1] == RAID_CLASS_COLORS.ROGUE.r, "class colours from the stored class")
  assert(colour("Abu")[1] == RAID_CLASS_COLORS.MAGE.r and rawget(paletteChip("Abu").icon, "atlas") == "classicon-MAGE", "else the shared lookup, with the class icon")
  assert(not paletteChip("Plain-Nowhere").icon.shown and colour("Plain-Nowhere")[1] == CRT.PALETTE.text[1], "else plain")
  assert(not paletteChip("Gadios"), "not the group's players")
  -- search
  W.search:SetText("ze")
  W.search.scripts.OnTextChanged(W.search, true)
  assert(players() == "Zed", "search filters them: " .. players())
  W.search:SetText("")
  W.search.scripts.OnTextChanged(W.search, true)
  -- the names written as the note's token rules say
  drag(paletteChip("Zed"), 3)
  drag(paletteChip("Bob-Other"), 3)
  assert(W.session:LineText(3) == "Soak: Abu, Zed, Bob-Other", W.session:LineText(3))
  drag(paletteChip("Zed"), 2)
  assert(W.session:LineText(2) == "invitelist:Abu-Sargeras,Kip-Sargeras,Wren-Elsewhere,Zed;", W.session:LineText(2))

  -- the invite list as it is now, edits included
  W.from.opts.set("invite")
  assert(W.playersFrom == "invite" and players() == "Abu,Zed,Kip,Wren-Elsewhere", "the invite list's players: " .. players())
  assert(colour("Kip")[1] == RAID_CLASS_COLORS.WARRIOR.r, "a class from the group")
  local x = W.rowFrames[2].chips[2].remove
  x.scripts.OnClick(x)
  assert(players() == "Abu,Zed,Wren-Elsewhere", "follows an edit: " .. players())
  local paints = 0
  local oldDraw = Editor.DrawPalette
  Editor.DrawPalette = function() paints = paints + 1 return oldDraw() end
  Editor.Refresh()
  Editor.DrawPalette = oldDraw
  assert(paints == 0, "Refresh itself never draws the palette; its callers do")
  -- the choice is kept for this note
  W.save.scripts.OnClick(W.save)
  W.window:Hide()
  assert(Editor.Open({ id = id2 }) and W.playersFrom == "invite", "remembered on reopening")
  -- the current group
  W.from.opts.set("group")
  assert(players() == "Abu,Gadios,Kip,Rixxy", "the group's players: " .. players())

  -- the roster event redraws only when the group is listed
  local draws = 0
  local old = Editor.DrawPalette
  Editor.DrawPalette = function() draws = draws + 1 return old() end
  W.window.scripts.OnEvent(W.window, "GROUP_ROSTER_UPDATE")
  assert(draws == 1, "group picked: redrawn")
  W.from.opts.set(7)
  draws = 0
  W.window.scripts.OnEvent(W.window, "GROUP_ROSTER_UPDATE")
  assert(draws == 0, "a layout picked: not redrawn")
  Editor.DrawPalette = old
  -- a layout changed, renamed, then deleted
  PRESETS[1].slots[3] = "Newbie-Sargeras"
  PRESETS[1].name = "Alt team B"
  CRT.Groups:Fire()
  assert(paletteChip("Newbie") and players():find("Newbie", 1, true), "a changed layout redraws: " .. players())
  assert(W.from.opts.options()[3].label == "Alt team B", "renamed in the dropdown")
  local alt = table.remove(PRESETS, 1)
  CRT.Groups:Fire()
  assert(W.playersFrom == "group" and keysOf(W.from.opts.options()) == "group,invite,roster1", "a deleted layout falls back to the group")
  assert(players() == "Abu,Gadios,Kip,Rixxy", "and the palette follows: " .. players())
  table.insert(PRESETS, 1, alt)
  W.window:Hide()

  -- in a group, a note opens on the current group (nothing picked for it yet)
  W.picked[id2] = nil
  inRaid, leader = true, true
  assert(Editor.Open({ id = id2 }) and W.playersFrom == "group", "in a group: the current group")
  W.window:Hide()
  inRaid, leader = false, false
  W.picked[id2] = nil
  assert(Editor.Open({ id = id2 }) and W.playersFrom == 7, "solo again: the linked layout")
  -- worked out once on opening: joining a group and an unrelated layout edit leave it
  inRaid = true
  PRESETS[2].name = "Renamed roster"
  CRT.Groups:Fire()
  assert(W.playersFrom == 7, "a layout edit doesn't recompute the default")
  inRaid = false
  W.window:Hide()
  -- the personal note has no invite list to pick
  assert(keysOf(Model.Sources(PRESETS, nil, true)) == "group,7,roster1", "noInvite")
  assert(Editor.Open({ personal = true }) and keysOf(W.from.opts.options()) == "group,7,roster1" and W.playersFrom == "group", "the personal note's choices")
  W.window:Hide()
end
print("ok Players from: the group, the invite list or a layout (linked one first and picked when solo), class colours, search, tokens, refresh")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2, 10);
for (const f of files) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
