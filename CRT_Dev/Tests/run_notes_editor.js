// The pop-out note editor: the real CRT_Modules/Notes/Parse.lua, Data.lua, Engine.lua, EditModel.lua, Render.lua,
// EditorWindow.lua, Settings.lua and Page.lua on mock frames.
//   The model: a note opened and saved with no edit gives the text back byte for byte (CRLF, spacing, unknown
//   fields, the invite list, no newline at the end); add, move and remove on timed and label lines change only
//   the names; names with realms; palette tokens the alerts understand; Quick fill; a drag and its cancel;
//   read-only.
//   The window: the Pop out editor buttons, rows and palette chips, a drag with the mouse handlers and Escape,
//   Quick fill, the raw text, Save through Notes:UpdateRaw, the unsaved warning, the permission gate and the
//   personal note.
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
local CLASSES = { { "Warrior", "WARRIOR" }, { "Priest", "PRIEST" }, { "Death Knight", "DEATHKNIGHT" }, { "SECRETname", "MAGE" } }
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
    Dropdown = function() local m = mock() rawset(m, "refresh", function() end) return m end,
    Slider = function() local m = mock() rawset(m, "refresh", function() end) return m end,
    RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end,
    SetFrameTitle = function() end, RegisterTab = function() end, SetTabSelected = function() end, SkinTree = function() end,
    SkinButton = function() end, SkinCheckButton = function() end, PANEL_BUTTON_PAD = 14,
    PanelButtonWidth = function(w) return math.max(40, math.ceil(w or 0) + 28) end },
  Alerts = { Settings = function() return { bars = {} } end, RegisterBlock = function() end, onPull = {}, OnChange = function() end,
    PeekNextPhase = function() return nil end },
  AlertRules = {},
  NoteReminders = { Build = function() end }, NotePhases = { Build = function() end },
  NoteAlertsTab = { Build = function() end, Select = function() end },
  NoteWindow = { FONTS = { { name = "Friz Quadrata" } }, Flash = function() end },
  NoteComm = { Sharing = function() return nil end, Share = function() end },
  NoteTargets = { List = function() return {} end, Get = function() return nil end },
  Groups = { NUM_SLOTS = 40, Normalize = function(n) return n end, CreatePreset = function() return "roster1" end,
    Find = function(_, id) return id == "roster1" and {} or nil end },
}
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
    "time:1;tag:A;\\r\\ntime:2;tag:B;\\n  \\t\\nMixed: endings\\r\\n", "# Heading\\n- Abu: bullet\\n---\\n**Tanks**: Abu, Cheo\\nTanks: Abu" }
  for n, text in ipairs(samples) do
    for _, md in ipairs({ false, true }) do
      local s = Model.New(text, { markdown = md })
      assert(s:Text() == text, "sample " .. n .. " comes back as written")
      assert(not s:Dirty(), "sample " .. n .. " is not dirty")
    end
  end
  -- an add and its remove: the line is written exactly as it was
  local s = Model.New(NOTE)
  local i = rowOf(s, "timer", 1)
  assert(s:Add(i, "Rixxy") and s:Dirty(), "an add makes it dirty")
  assert(s:Remove(i, #s:Names(i)) and s:Text() == NOTE and not s:Dirty(), "removing it again gives the text back")
end
print("ok round trip: no edit gives the text back byte for byte, CRLF, spacing and unknown fields kept")

-- 2. Rows in the note's own order, by kind
do
  local s = Model.New(NOTE)
  local kinds = {}
  for i, r in ipairs(s.rows) do kinds[i] = r.kind end
  assert(table.concat(kinds, ",") == "header,timer,timer,timer,timer,unread,label,label,blank,heading,label,invite", table.concat(kinds, ","))
  local _, t = rowOf(s, "timer", 1)
  assert(t.time == "0:48" and t.ph == "1" and t.display == "Text" and t.timer.color, "a timer row: time, phase, display type, colour")
  assert(s:Names(2)[1] == "Abu" and s:Names(2)[2] == "Gadios", "its names")
  assert(s:Names(3)[1] == "Cheoeqar" and s:Names(3)[2] == "Abu-Sargeras", "a name with a realm is one name")
  assert(#s:Names(4) == 0, "a timer with no tag has no names")
  assert(s:Names(7)[2] == "Abu" and s.rows[7].label == "Melee", "a label row: its label and names")
  assert(s.rows[12].count == 3, "the invite list collapsed to its count")
  for _, i in ipairs({ 1, 6, 9, 10, 12 }) do
    assert(not s:Add(i, "Abu"), "row " .. i .. " (" .. s.rows[i].kind .. ") takes no names")
  end
  assert(s:Text() == NOTE, "nothing changed")
end
print("ok rows in the note's order; header, headings, text, unread lines and the invite list take no names")

-- 3. Add, move and remove on timed lines rewrite only the tag field
do
  local s = Model.New(NOTE)
  assert(s:Add(2, "Rixxy"), "add to a timer")
  assert(s:LineText(2) == "time:48;ph:1;tag:Abu Gadios Rixxy;text:Group 1 go in;dur:8;colors:0 1 1 1;DisplayType:Text;", s:LineText(2))
  assert(s:Remove(3, 1), "remove the first name")
  assert(s:LineText(3) == "  Time:34; ph:1 ;Tag: Abu-Sargeras ;spellid:64843;Custom:keep me;  ", "spacing and unknown fields kept: [" .. s:LineText(3) .. "]")
  assert(s:Add(4, "healer") and s:LineText(4) == "ph:1.5;time:5;tag:healer;spellid:99999;", "a tag added after time and ph: " .. s:LineText(4))
  assert(s:Add(5, "Abu") and s:LineText(5) == "time:7;tag:Abu", "a line with no ; at its end: " .. s:LineText(5))
  assert(s:Move(2, 1, 4) and s:LineText(4) == "ph:1.5;time:5;tag:healer Abu;spellid:99999;" and s:LineText(2):find("tag:Gadios Rixxy;", 1, true), "a move: " .. s:LineText(4) .. " / " .. s:LineText(2))
  onlyChanged(NOTE:gsub("\\r", ""), s:Text():gsub("\\r", ""), { 2, 3, 4, 5 })
  assert(select(2, s:Text():gsub("\\r\\n", "")) == select(2, NOTE:gsub("\\r\\n", "")), "every line end kept")
  -- the parser reads the new names and keeps every other field
  local note = Parser.Parse(s:Text())
  local byLine = {}
  for _, t in ipairs(note.timers) do byLine[t.line] = t end
  assert(table.concat(byLine[4].tags, " ") == "healer Abu" and byLine[4].spellId == 99999 and byLine[4].ph == 1.5 and byLine[4].time == 5, "line 4 parsed")
  assert(table.concat(byLine[3].tags, " ") == "Abu-Sargeras" and byLine[3].spellId == 64843, "line 3 parsed")
  assert(byLine[2].text == "Group 1 go in" and byLine[2].dur == 8 and byLine[2].color[2] == 1, "line 2 keeps its text, dur and colour")
  assert(table.concat(byLine[5].tags, " ") == "Abu" and byLine[5].time == 7, "line 5 parsed")
  -- every name removed: the field stays, empty
  local e = Model.New("time:34;ph:1;tag:Cheoeqar;spellid:1;")
  assert(e:Remove(1, 1) and e:Text() == "time:34;ph:1;tag:;spellid:1;" and #Parser.Parse(e:Text()).timers[1].tags == 0, e:Text())
  -- a name the row has already, or not one word, is not added
  assert(not s:Add(2, "gadios") and not s:Add(2, "two words") and not s:Add(2, "a;b") and not s:Add(2, "") and not s:Add(2, "SECRETx"), "duplicates and bad tokens refused")
  -- no limit on how many names a row takes
  local many = Model.New("time:1;tag:;")
  for n = 1, 40 do assert(many:Add(1, "P" .. n)) end
  assert(#Parser.Parse(many:Text()).timers[1].tags == 40, "40 names on one row")
end
print("ok timed lines: add, move and remove change only the tag field; no limit on names")

-- 4. Label lines: the names after the colon, separators as written
do
  local s = Model.New(NOTE)
  assert(s:Add(7, "Gadios") and s:LineText(7) == "Melee: Cheoeqar, Abu, Gadios", s:LineText(7))
  assert(s:Remove(7, 1) and s:LineText(7) == "Melee: Abu, Gadios", s:LineText(7))
  assert(s:Move(7, 1, 8) and s:LineText(8) == "Kicks G1: Abu" and s:LineText(7) == "Melee: Gadios", s:LineText(8) .. " / " .. s:LineText(7))
  assert(s:Add(8, "Rixxy-Sargeras") and s:LineText(8) == "Kicks G1: Abu, Rixxy-Sargeras", "a name with a realm: " .. s:LineText(8))
  assert(s:Move(8, 2, 2) and s:LineText(2):find("tag:Abu Gadios Rixxy-Sargeras;", 1, true), "a label's name moves to a timer: " .. s:LineText(2))
  onlyChanged(NOTE:gsub("\\r", ""), s:Text():gsub("\\r", ""), { 2, 7, 8 })
  local sp = Model.New("Soak:  Abu Cheo  \\nOther:   ")
  assert(sp:Add(1, "Gil") and sp:LineText(1) == "Soak:  Abu Cheo Gil  ", "a space-separated label keeps spaces: [" .. sp:LineText(1) .. "]")
  assert(sp:Add(2, "Gil") and sp:LineText(2) == "Other:   Gil", "an empty label keeps its spaces: [" .. sp:LineText(2) .. "]")
end
print("ok label lines: names after the colon, commas and spaces as written")

-- 5. Palette tokens: the words the alerts understand
do
  local roster = {
    { key = "Zed-Sargeras", class = "WARRIOR", role = "DAMAGER", subgroup = 1 },
    { key = "Abu-Sargeras", class = "MAGE", role = "TANK", subgroup = 1 },
    { key = "Gadios-Sargeras", class = "PRIEST", role = "HEALER", subgroup = 3 },
    { key = "Bob-Other", class = "ROGUE", role = nil, subgroup = 2 },
    { key = "SECRETkey", class = "MAGE", role = "TANK" },
  }
  local sections = Model.Palette(roster)
  local keys = {}
  for i, sec in ipairs(sections) do keys[i] = sec.key end
  assert(table.concat(keys, ",") == "players,general,groups,classes", table.concat(keys, ","))
  local p = sections[1].entries
  assert(#p == 4 and p[1].token == "Abu" and p[2].token == "Gadios" and p[3].token == "Zed" and p[4].token == "Bob-Other", "players by role, own realm left out, secret skipped")
  assert(p[1].class == "MAGE" and p[1].role == "TANK", "a player's class and role")
  local g = {}
  for _, e in ipairs(sections[2].entries) do g[#g + 1] = e.token end
  assert(table.concat(g, ",") == "everyone,tank,healer,dps,melee,ranged", table.concat(g, ","))
  assert(#sections[3].entries == 8 and sections[3].entries[1].token == "Group1" and sections[3].entries[8].token == "Group8", "Group1..Group8")
  local c = sections[4].entries
  assert(#c == 3 and c[3].token == "DEATHKNIGHT" and c[3].label == "Death Knight" and c[3].class == "DEATHKNIGHT", "classes by file name, a hidden class name skipped")
  -- each token is one the alerts read: the player here is a healer priest in raid group 3
  local function mine(word) return Engine:IsMine({ tags = { word } }) end
  inRaid = true
  assert(mine("everyone") and mine("healer") and mine("Group3") and mine("PRIEST") and mine("Gadios"), "everyone, role, group, class and name match")
  assert(not mine("tank") and not mine("dps") and not mine("Group1") and not mine("WARRIOR") and not mine("melee"), "others don't")
  inRaid = false
  -- search: label or token, any case
  local found = Model.Palette(roster, "gro")
  assert(#found[3].entries == 8 and #found[1].entries == 0 and #found[2].entries == 0, "search keeps Group1..8 for 'gro'")
  found = Model.Palette(roster, "death")
  assert(#found[4].entries == 1 and found[4].entries[1].token == "DEATHKNIGHT", "search finds a class by its name")
end
print("ok palette: players by role, general, Group1..8 and classes, each token one the alerts read; search")

-- 6. Quick fill, drag and cancel, read-only
do
  local s = Model.New(NOTE)
  assert(not s:PaletteClick("tank"), "Quick fill off: a click adds nothing")
  s:SetQuickFill(true)
  assert(s:Select(10) == nil, "a heading can't be selected")
  assert(s:Select(4) == 4, "a timer row is selected")
  assert(s:PaletteClick("tank") and s:PaletteClick("Group2") and table.concat(s:Names(4), " ") == "tank Group2", "clicks append to it")
  s:SetQuickFill(false)
  assert(s.selected == nil and not s:PaletteClick("dps"), "off again: nothing selected")
  -- a drag from the palette, and from a row
  assert(s:BeginDrag({ token = "Rixxy" }) and s:Drop(7) and s:Names(7)[3] == "Rixxy", "palette chip dropped on a label")
  assert(s:BeginDrag({ row = 7, index = 3 }) and s:Drop(2) and s:Names(2)[3] == "Rixxy" and #s:Names(7) == 2, "row chip moved to a timer")
  -- cancel: the drop does nothing
  local before = s:Text()
  assert(s:BeginDrag({ token = "Nobody" }))
  s:CancelDrag()
  assert(not s:Drop(2) and s:Text() == before, "a cancelled drag drops nothing")
  assert(s:BeginDrag({ token = "Nobody" }) and not s:Drop(nil) and s.drag == nil and s:Text() == before, "dropped outside every row: nothing")
  assert(s:BeginDrag({ row = 2, index = 1 }) and not s:Drop(2) and s:Text() == before, "dropped on its own row: nothing")
  assert(not s:BeginDrag({ row = 10, index = 1 }), "a heading has nothing to drag")
  -- read-only: nothing changes
  local r = Model.New(NOTE, { readOnly = true })
  r:SetQuickFill(true)
  assert(not r:Add(2, "X") and not r:Remove(2, 1) and not r:Move(2, 1, 7) and not r:BeginDrag({ token = "X" }) and r:Select(2) == nil, "read-only refuses every edit")
  assert(r:Text() == NOTE, "and the text is as written")
end
print("ok Quick fill, drag, drag cancel and read-only")

-- The window --------------------------------------------------------------------------------------------------
if not windowSrc then return end
CRT.UI.PanelButton = function(parent, label, h, fn)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b:SetText(label) b:SetScript("OnClick", fn) return b
end
assert(load(renderSrc, "Render.lua"))("CowfeeRaidTools", CRT)
assert(load(windowSrc, "EditorWindow.lua"))("CowfeeRaidTools", CRT)
assert(load(settingsSrc, "Settings.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local Editor = CRT.NoteEditor
assert(Editor and Editor.Open and Editor.state, "CRT.NoteEditor with Open")
CRT.Groups.ReadRoster = function() return { { key = "Abu-Sargeras", class = "MAGE", role = "TANK" }, { key = "Gadios-Sargeras", class = "PRIEST", role = "HEALER" },
  { key = "Rixxy-Sargeras", class = "ROGUE", role = "DAMAGER" } } end
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

-- 7. Pop out editor: rows in the note's order, the palette, a drag adds and moves, x removes
do
  local pop = button("Pop out editor")
  assert(pop and pop:IsEnabled(), "a Pop out editor button by the Note text")
  assert(button("Pop out"), "and one by the Personal note")
  pop.scripts.OnClick(pop)
  assert(W.window.shown and W.session and W.session.base == NOTE and not W.session.readOnly, "it opens the selected note, editable")
  assert(rawget(W.window, "title"):find("Nek'zali", 1, true), "titled with the note")
  assert(W.window.opts.kind == "popout" and W.window.opts.layer == "popups" and W.window.opts.saved() == CRT.db.notes.editor, "a pop-out on the popups layer, its place saved in notes.editor")
  assert(shownRows() == #W.session.rows, "a row per line")
  local chips = W.rowFrames[2].chips
  assert(chips[1].shown and chips[1].text:GetText() == "Abu" and chips[2].text:GetText() == "Gadios" and chips[1].remove.shown, "row 2's names as removable chips")
  assert(chips[1].text.textColor[1] == RAID_CLASS_COLORS.MAGE.r, "a chip in its class colour")
  for _, token in ipairs({ "Abu", "Gadios", "Rixxy", "everyone", "tank", "Group1", "Group8", "WARRIOR", "DEATHKNIGHT" }) do
    assert(paletteChip(token), "a palette chip for " .. token)
  end
  assert(rawget(paletteChip("Abu").icon, "atlas") == "classicon-MAGE" and paletteChip("Abu").icon.shown, "a player's class icon")
  assert(paletteChip("DEATHKNIGHT").text:GetText() == "Death Knight", "a class by its name")
  -- a palette chip dragged onto the timer with no tag
  drag(paletteChip("Rixxy"), 4)
  assert(table.concat(W.session:Names(4), " ") == "Rixxy", "dropped on row 4")
  assert(W.raw:GetText():find("ph:1.5;time:5;tag:Rixxy;spellid:99999;", 1, true), "the raw text follows at once")
  assert(W.save:IsEnabled() and W.status:GetText():find("Unsaved", 1, true), "Save on, unsaved changes said")
  -- a row's chip dragged onto another row moves it
  drag(W.rowFrames[2].chips[2], 7)
  assert(table.concat(W.session:Names(7), " ") == "Cheoeqar Abu Gadios" and table.concat(W.session:Names(2), " ") == "Abu", "Gadios moved from row 2 to row 7")
  -- dropped outside every row: nothing
  local before = W.session:Text()
  drag(paletteChip("tank"), nil)
  assert(W.session:Text() == before and not W.ghost.shown, "a drop outside the rows does nothing")
  -- x removes
  local x = W.rowFrames[7].chips[1].remove
  x.scripts.OnClick(x)
  assert(table.concat(W.session:Names(7), " ") == "Abu Gadios", "x removes Cheoeqar")
end
print("ok the window: rows, palette chips with class colours and icons, drag adds and moves, x removes")

-- 8. Escape cancels a drag; a press that doesn't move is a click; Quick fill
do
  local before = W.session:Text()
  local chip = paletteChip("healer")
  cursor = { 10, 10 }
  chip.scripts.OnMouseDown(chip, "LeftButton")
  cursor = { 60, 10 }
  W.driver.scripts.OnUpdate(W.driver)
  assert(W.ghost.shown and W.session.drag and rawget(W.driver, "keyboard"), "dragging, with the keys caught for Escape")
  rawset(W.rowFrames[4], "over", true) rawset(W.rowsScroll, "over", true)
  W.driver.scripts.OnKeyDown(W.driver, "ESCAPE")
  assert(not W.ghost.shown and not W.driver.shown and W.session.drag == nil and not rawget(W.driver, "keyboard"), "Escape ends it")
  chip.scripts.OnMouseUp(chip, "LeftButton")
  rawset(W.rowFrames[4], "over", false)
  assert(W.session:Text() == before, "and the button let go drops nothing")
  -- Quick fill off: a click on a chip adds nothing
  click(paletteChip("Group2"))
  assert(W.session:Text() == before, "a click without Quick fill adds nothing")
  W.quick:SetChecked(true)
  W.quick.scripts.OnClick(W.quick)
  assert(W.session.quickFill, "Quick fill on")
  W.rowFrames[8].scripts.OnMouseDown(W.rowFrames[8])
  assert(W.session.selected == 8, "a click on a line selects it")
  click(paletteChip("Group2"))
  click(paletteChip("Rixxy"))
  assert(table.concat(W.session:Names(8), " ") == "Group2 Rixxy", "clicks fill it: " .. table.concat(W.session:Names(8), " "))
  assert(W.raw:GetText():find("Kicks G1: Group2, Rixxy", 1, true), "the raw text: " .. W.raw:GetText())
  W.quick:SetChecked(false)
  W.quick.scripts.OnClick(W.quick)
  -- the raw text box is read-only, and Raw text shows and hides it
  local text = W.raw:GetText()
  W.raw:SetText("typed")
  W.raw.scripts.OnTextChanged(W.raw, true)
  assert(W.raw:GetText() == text, "typing in the raw text is undone")
  assert(not W.rawBox.shown and rawget(W.rawButton, "text") == "Raw text", "the raw text hidden at first")
  W.rawButton.scripts.OnClick(W.rawButton)
  assert(W.rawBox.shown and rawget(W.rawButton, "text") == "Hide raw text", "Raw text shows it")
end
print("ok Escape cancels a drag, a click is not a drag, Quick fill, the raw text read-only")

-- 9. Save: through Notes:UpdateRaw, only the names changed
do
  local expected = W.session:Text()
  W.save.scripts.OnClick(W.save)
  local saved = Notes:Get(id).raw
  assert(saved == expected, "the note holds the editor's text")
  onlyChanged(NOTE:gsub("\\r", ""), saved:gsub("\\r", ""), { 2, 4, 7, 8 })
  assert(select(2, saved:gsub("\\r\\n", "")) == select(2, NOTE:gsub("\\r\\n", "")), "line ends kept")
  assert(not W.session:Dirty() and W.session.base == saved and not W.save:IsEnabled(), "a clean session after Save")
  local parsed = Notes:Parsed(id)
  local found = false
  for _, t in ipairs(parsed.timers) do if t.line == 4 and t.tags[1] == "Rixxy" then found = true end end
  assert(found, "the stored note's timers have the new name, for the alerts and sharing")
  assert(CRT.NoteRender.views.Text.text == saved, "the page's rendered note shows it")
end
print("ok Save writes the raw text through Notes:UpdateRaw; only names changed")

-- 10. Unsaved changes warn on close; a clean close doesn't
do
  local kept = Notes:Get(id).raw
  W.window:Hide()
  assert(#popups == 0, "a clean close asks nothing")
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  drag(paletteChip("Abu"), 5)
  assert(W.session:Dirty(), "an unsaved change")
  W.window:Hide()
  assert(popups[#popups] == "COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED", "closing asks")
  runTimers()
  assert(W.window.shown and W.session:Dirty(), "the editor stays up with the change")
  -- another note can't take the window while it has unsaved changes
  assert(not Editor.Open({ personal = true }), "the personal note waits")
  StaticPopupDialogs.COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED.OnAccept()
  assert(not W.window.shown and W.session == nil, "Discard closes it")
  runTimers()
  assert(not W.window.shown, "and it stays closed")
  assert(Notes:Get(id).raw == kept, "nothing saved")
end
print("ok unsaved changes warn on close")

-- 11. Following changes from elsewhere; a note changed under unsaved edits is not overwritten
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

-- 12. A raider who can't change the raid note: read-only
do
  inRaid, leader = true, false
  redraw()
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  assert(W.window.shown and W.session.readOnly, "it opens read-only")
  assert(not W.save:IsEnabled() and not W.quick:IsEnabled(), "Save and Quick fill greyed")
  assert(not W.rowFrames[2].chips[1].remove.shown, "no x on the chips")
  assert(W.status:GetText():find("Only the raid leader", 1, true), "the status says why")
  local before = Notes:Get(id).raw
  drag(paletteChip("Abu"), 5)
  assert(not W.session:Dirty() and not W.driver.shown, "a drag doesn't start")
  assert(not Editor.Save() and Notes:Get(id).raw == before, "Save writes nothing")
  -- promoted: the clean editor becomes editable
  leader = true
  redraw()
  assert(not W.session.readOnly and W.save and W.quick:IsEnabled(), "a promotion unlocks it")
  -- lost the right with unsaved changes: Save asks again and writes nothing
  drag(paletteChip("Rixxy"), 5)
  leader = false
  assert(not Editor.Save() and Notes:Get(id).raw == before, "Save asks CanEditRaid again")
  StaticPopupDialogs.COWFEE_RAID_TOOLS_NOTE_EDITOR_UNSAVED.OnAccept()
  inRaid, leader = false, false
  redraw()
end
print("ok read-only for a raider who can't change the raid note; Save asks again")

-- 13. The personal note: its own editor, saved with Notes:SetPersonal, markdown lines as written
do
  Notes:SetPersonal("# Mine\\nTanks: Abu\\n- Gadios: a bullet\\ntime:10;ph:1;spellid:64843;")
  inRaid, leader = true, false -- a personal note is yours, whatever your rank
  local pp = button("Pop out")
  pp.scripts.OnClick(pp)
  assert(W.window.shown and W.source.personal and not W.session.readOnly, "the personal note opens, editable")
  assert(rawget(W.window, "title") == "Personal note editor", "titled")
  assert(W.session.rows[1].kind == "heading" and W.session.rows[3].kind == "text" and W.session.rows[2].kind == "label", "# heading and - bullet as written, a label takes names")
  drag(paletteChip("Gadios"), 2)
  drag(paletteChip("dps"), 4)
  W.save.scripts.OnClick(W.save)
  assert(Notes:Personal() == "# Mine\\nTanks: Abu, Gadios\\n- Gadios: a bullet\\ntime:10;ph:1;tag:dps;spellid:64843;", "saved: " .. Notes:Personal())
  assert(not W.session:Dirty(), "clean after Save")
  W.window:Hide()
  inRaid, leader = false, false
end
print("ok the personal note: opened, edited and saved with only names changed")

-- 14. A theme switch repaints the open editor
do
  local pop = button("Pop out editor")
  pop.scripts.OnClick(pop)
  CRT.UI.SwitchTheme("nitro")
  local chip = W.rowFrames[2].chips[1]
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
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2, 10);
for (const f of files) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
