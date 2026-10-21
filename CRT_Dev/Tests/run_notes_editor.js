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
    if k == "Show" then return function(self) local was = self.shown self.shown = true if not was and self.scripts.OnShow then self.scripts.OnShow(self) end end end
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
  Alerts = { Settings = function() return { bars = {} } end, RegisterBlock = function() end, onPull = {}, OnChange = function() end },
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
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2, 10);
for (const f of files) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
