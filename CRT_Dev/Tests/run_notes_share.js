// The Timeline and Raid Notes stay in step: the real CRT_Modules/Notes/Parse.lua, Data.lua, Comm.lua, Settings.lua and
// Page.lua. A note made for a boss gets its header and shows on Raid Notes; Share always makes the note
// active here (sent to the group only when allowed); the Raid Notes page follows the active note; lines the
// Timeline writes show in the Raid Notes text.
// Usage: node run_notes_share.js <Parse.lua> <Data.lua> <Comm.lua> <Settings.lua> <Page.lua> <Render.lua>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local parseSrc, dataSrc, commSrc, settingsSrc, pageSrc, renderSrc = ...
local edits, buttons, helps = {}, {}, {}
local function mock(kind)
  local m = { shown = false, kind = kind }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock() end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") or "" end end
    if k == "Show" then return function(self) self.shown = true if rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "HasFocus" then return function(self) return rawget(self, "focus") and true or false end end
    if k == "ClearFocus" then return function(self) rawset(self, "focus", false) end end
    -- like the game: a disabled box or button stays disabled until enabled again
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return rawget(self, "enabled") ~= false end end
    if k == "SetMultiLine" then return function(self, v) rawset(self, "multi", v) end end
    if k == "SetBackdropBorderColor" then return function(self, r, g, b) rawset(self, "border", { r, g, b }) end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    return function() end end })
end
function CreateFrame(kind) local m = mock(kind)
  if kind == "EditBox" then edits[#edits + 1] = m elseif kind == "Button" then buttons[#buttons + 1] = m end
  return m end
format = string.format
date = os.date
UIParent = mock()
UISpecialFrames = {}
tinsert = table.insert
CANCEL = "Cancel"
ChatFontNormal = {}
-- the group: solo at first
local inRaid, leader, sent, printed = false, false, {}, {}
function IsInGroup(category) return category == nil and inRaid end
function IsInRaid() return inRaid end
LE_PARTY_CATEGORY_INSTANCE = 2
function UnitIsGroupLeader() return leader end
function UnitIsGroupAssistant() return false end
function GetTime() return 100 end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function(prefix, msg, ch) sent[#sent + 1] = ch return 0 end }
C_Spell = { GetSpellName = function() return nil end, GetSpellTexture = function() return nil end }
local pages = {}
local CRT = {
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end },
  db = { notes = { list = {}, nextId = 1, trustedOnly = true,
    window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
    assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50 },
    alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100 } } },
  UI = { PAGE_W = 1026, PAGE_H = 560, SkinScrollBar = function() end, ScrollGutter = function(w) return 6 + (w or 18) end, Help = function(parent, title, text) local m = mock() rawset(m, "helpTitle", title) rawset(m, "helpText", text) helps[#helps + 1] = m return m end, Dropdown = function() local m = mock() rawset(m, "refresh", function() end) return m end, Slider = function() local m = mock() rawset(m, "refresh", function() end) return m end, RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end, SetFrameTitle = function() end, RegisterTab = function() end, SetTabSelected = function() end, SkinTree = function() end },
  Alerts = { Settings = function() return { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 } } end },
  AlertBars = { Refresh = function() end, Test = function() end },
  NoteReminders = { Build = function() end }, NotePhases = { Build = function() end },
  NoteEngine = { running = false, PeekNextPhase = function() return nil end },
  NoteAlertsTab = { Build = function() end, Select = function() end },
  NoteWindow = { FONTS = { { name = "Friz Quadrata" } }, flashes = 0, Flash = function(self) self.flashes = self.flashes + 1 end },
  Groups = { Find = function() return nil end },
}
function CRT:Print(m) printed[#printed + 1] = m end
CRT_THEME(CRT, CRT.UI)
assert(load(parseSrc, "Parse.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(settingsSrc, "Settings.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
assert(load(renderSrc, "Render.lua"))("CowfeeRaidTools", CRT)
local Notes, Comm = CRT.Notes, CRT.NoteComm
local function lastPrint() return printed[#printed] or "" end

-- Two notes already on Raid Notes, as Alex has them: Sentinels is active.
local sentinels = Notes:Import("EncounterID:3445;Difficulty:Mythic;Name:Sentinels\\ntime:7;ph:1;tag:Crazyoio;spellid:31884;")
local fangs = Notes:Import("EncounterID:3421;Difficulty:Mythic;Name:Twin Fangs\\ntime:5;ph:1;tag:Abu;spellid:1;")
Notes:SetActive(sentinels)

local pf = mock()
pages.notes(pf)
pf:Show()
CRT.NotesPage.Open("notes")
local editor
for _, e in ipairs(edits) do if rawget(e, "multi") and editor == nil then editor = e end end
assert(editor, "the Raid Notes text box")
local function shown() return editor:GetText() end
assert(shown():find("Name:Sentinels", 1, true), "Raid Notes shows the active note at first")

-- 1. The Timeline makes a note for a boss that has none: header first, listed on Raid Notes
local id, made = Notes:NoteFor(3470, "Mythic", "Nek'zali the Soulcoiler")
assert(id and made == true, "a boss with no note gets one")
local record = Notes:Get(id)
assert(record.raw == "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali the Soulcoiler\\n", "the new note is its header line: " .. tostring(record.raw))
assert(record.encounterID == 3470 and record.difficulty == "Mythic" and record.name == "Nek'zali the Soulcoiler", "the header is read back like any imported note")
local listed = false
for _, entry in ipairs(Notes:List()) do listed = listed or entry.id == id end
assert(listed, "the new note is on the Raid Notes list")
local again, madeAgain = Notes:NoteFor(3470, "Mythic", "Nek'zali the Soulcoiler")
assert(again == id and madeAgain == false, "asking again finds the same note")
local heroic = Notes:NoteFor(3470, "Heroic", "Nek'zali the Soulcoiler")
assert(heroic == id, "another difficulty reads the boss's note, as a pull would (no one-line note is made)")
assert(Notes:NoteFor("ref:x", "Mythic", "X") == nil, "no note without an encounter ID")
print("ok the timeline makes a boss's note with its header")

-- 2. Share solo: the note becomes active here, Raid Notes jumps to it, nothing is sent
Comm:Share(id)
assert(Notes:Active() == id, "share makes it the active note even solo")
assert(#sent == 0, "solo, nothing is sent")
assert(CRT.NoteWindow.flashes == 1, "every Share press shows the note-updated stamp, even one that is not sent")
assert(lastPrint():find("is now your active note, but it wasn't sent", 1, true), "says why it wasn't sent: " .. lastPrint())
assert(shown():find("Name:Nek'zali the Soulcoiler", 1, true), "Raid Notes now shows the shared note: " .. shown())
print("ok share solo makes the note active and Raid Notes shows it")

-- 3. Share as raid leader: sent to the raid, and active
inRaid, leader = true, true
Comm:Share(fangs)
assert(Notes:Active() == fangs and #sent > 0 and sent[1] == "RAID", "the leader's share goes to the raid and is active")
assert(CRT.NoteWindow.flashes == 2, "the leader sees the note-updated stamp when sharing")
assert(shown():find("Name:Twin Fangs", 1, true), "Raid Notes follows to the shared note")
print("ok share as leader sends to the raid and Raid Notes follows")

-- 4. Reading another note stays until the active note changes again
for _, b in ipairs(buttons) do if rawget(b, "id") == sentinels and rawget(b, "OnClick") then b.OnClick(b) end end
assert(shown():find("Name:Sentinels", 1, true), "clicking another note on Raid Notes shows it")
for _, fn in ipairs(Notes.listeners) do fn() end
assert(shown():find("Name:Sentinels", 1, true), "a redraw keeps the note you clicked while the active note is the same")
inRaid, leader = false, false
Comm:Share(id)
assert(shown():find("Name:Nek'zali", 1, true), "a new active note moves Raid Notes to it")
print("ok Raid Notes follows the active note, not every redraw")

-- 5. While typing in the Raid Notes text, the jump waits
editor.focus = true
editor:SetText("typing...")
Comm:Share(sentinels)
assert(shown() == "typing...", "typing is not replaced by the jump")
editor.focus = false
for _, fn in ipairs(Notes.listeners) do fn() end
assert(shown():find("Name:Sentinels", 1, true), "the jump happens on the next redraw after typing")
print("ok the jump waits while you type")

-- 6. A line written by the Timeline shows in the Raid Notes text of that note
Comm:Share(id)
local nid, n = Notes:AddLine(3470, "Mythic", "Nek'zali the Soulcoiler", "time:36;ph:1;tag:Abu;spellid:1284103;")
assert(nid == id and n == 2, "the timeline's line goes into the boss's note as its second line: " .. tostring(nid) .. "," .. tostring(n))
assert(shown():find("time:36;ph:1;tag:Abu;spellid:1284103;", 1, true), "Raid Notes shows the new line: " .. shown())
assert(Notes:ReplaceLine(id, 2, "time:60;ph:1;tag:Abu;spellid:1284103;", "time:36;ph:1;tag:Abu;spellid:1284103;"), "moving the line on the timeline")
assert(shown():find("time:60;ph:1;tag:Abu;spellid:1284103;", 1, true), "Raid Notes shows the moved time: " .. shown())
assert(Notes:Get(id).raw:find("time:60", 1, true), "the stored note, which is what Share sends, has the change")
print("ok timeline edits show in the Raid Notes text that is shared")

-- 7. (P4) Only the leader or an assistant changes the note text on Raid Notes
local REASON = "Only the raid leader or assistants can change the raid note."
local save, lockHelp
for _, b in ipairs(buttons) do if rawget(b, "text") == "Save text changes" then save = b end end
for _, h in ipairs(helps) do if h.helpTitle == "Note text" then lockHelp = h end end
assert(save and lockHelp, "the Save button and the (?) by Note text")
local function redraw() for _, fn in ipairs(Notes.listeners) do fn() end end
local function helpText() local t = lockHelp.helpText if type(t) == "function" then t = t() end return t end
-- solo: you change your own copy
inRaid, leader = false, false
redraw()
assert(editor:IsEnabled() and save:IsEnabled() and not lockHelp:IsShown(), "solo: editable, no (?)")
-- a raid member: read-only, greyed, the (?) gives the reason; a click anyway is refused
inRaid, leader = true, false
redraw()
assert(not save:IsEnabled(), "member: Save greyed")
-- the raw text stays selectable but read-only: typing is undone at once (Notes/Render.lua)
local loadedText = editor:GetText()
editor:SetText(loadedText .. "typed")
editor.OnTextChanged(editor, true)
assert(editor:GetText() == loadedText, "member: typing in the raw text is undone")
assert(lockHelp:IsShown() and helpText() == REASON, "member: (?) with the reason: " .. tostring(helpText()))
local before = Notes:Get(id).raw
editor:SetText(before .. "time:90;text:Mine;\\n")
save.OnClick(save)
assert(Notes:Get(id).raw == before and lastPrint() == REASON, "member: Save refused with the reason: " .. lastPrint())
-- promoted: the next show unlocks it, and Save writes
leader = true
pf:Show()
assert(editor:IsEnabled() and save:IsEnabled() and not lockHelp:IsShown(), "promoted: unlocked on show")
editor:SetText(before .. "time:90;text:Mine;\\n")
save.OnClick(save)
assert(Notes:Get(id).raw:find("text:Mine;", 1, true) and lastPrint() == "Saved.", "leader saves: " .. lastPrint())
-- demoted again: the next redraw locks it
leader = false
redraw()
assert(not save:IsEnabled() and lockHelp:IsShown(), "demoted: locked on redraw")
inRaid = false
redraw()
print("ok raid notes: only the leader or an assistant saves the note text")

-- 8. Share with no note: the Empty note becomes everyone's note, with the stamp; pressed again it reuses it
local flashesBefore = CRT.NoteWindow.flashes
Comm:Share(nil)
local emptyId, emptyRecord = Notes:Active()
assert(emptyRecord and emptyRecord.name == "Empty" and emptyRecord.raw == "EncounterID:;Name:Empty", "no note shares the Empty note: " .. tostring(emptyRecord and emptyRecord.raw))
assert(CRT.NoteWindow.flashes == flashesBefore + 1, "the Empty note shows the stamp")
local count = 0
for _ in pairs(CRT.db.notes.list) do count = count + 1 end
Comm:Share(nil)
local count2 = 0
for _ in pairs(CRT.db.notes.list) do count2 = count2 + 1 end
assert(Notes:Active() == emptyId and count2 == count and CRT.NoteWindow.flashes == flashesBefore + 2, "pressed again: the same Empty note, stamped again")
print("ok share with no note sends the Empty note, every time")
do
  -- shared notes: one per guild; personal notes: your own lines, never replaced, run beside the shared one
  local H = "EncounterID:4001;Difficulty:Mythic;Name:Copy Boss"
  local mine = Notes:Import(H .. "\\ntime:10;ph:1;tag:Solex;text:Guild line;", "Officer1", nil, "guild:Cowfee")
  local again = Notes:Import(H .. "\\ntime:12;ph:1;tag:Solex;text:Guild line 2;", "Officer2", nil, "guild:Cowfee")
  assert(again == mine and Notes:Get(mine).raw:find("Guild line 2", 1, true) and Notes:Get(mine).from == "Officer2", "a share from the same guild replaces that guild's note")
  local pug = Notes:Import(H .. "\\ntime:30;ph:1;tag:Solex;text:Pug line;", "PugLead", nil, "guild:Other")
  assert(pug ~= mine and Notes:Get(mine).raw:find("Guild line 2", 1, true), "another guild's share is a note of its own, never yours replaced")
  -- the shared note in use runs: the active one, else the newest
  Notes:SetActive(mine)
  assert(Notes:FindForEncounter(4001, "Mythic") == mine, "the active shared note runs")
  -- a note received is tagged with who sent it, an old tag replaced
  local tagged = Comm.TagSender("line one\\nSent by: Someone\\n\\n", "Solex")
  assert(tagged == "line one\\nSent by: Solex", "Sent by at the bottom, once: " .. tagged)
  -- your personal note: made once per boss and difficulty, never a shared note, never replaced by a share
  local p1, made = Notes:MakePersonal(4001, "Mythic", "Copy Boss")
  local p2, made2 = Notes:MakePersonal(4001, "Mythic", "Copy Boss")
  assert(p1 and made and p2 == p1 and not made2 and Notes:Get(p1).personal, "one personal note per boss and difficulty")
  Notes:UpdateRaw(p1, H .. "\\ntime:20;ph:1;tag:Solex;text:My own line;")
  assert(Notes:PersonalFor(4001, "Mythic") == p1 and Notes:FindForEncounter(4001, "Mythic") ~= p1, "personal is found apart, never as the shared note")
  Notes:Import(H .. "\\ntime:15;ph:1;tag:Solex;text:Leader again;", "Officer1", nil, "guild:Cowfee")
  assert(Notes:Get(p1).raw:find("My own line", 1, true), "a share never touches your personal note")
  local function ids(kind) local out = {} for _, e in ipairs(Notes:List(kind)) do out[e.id] = true end return out end
  assert(ids("personal")[p1] and not ids("shared")[p1] and ids("shared")[mine] and ids("shared")[pug], "each tab lists its own kind")
  -- a note from before sources were kept is replaced by the first share
  local old = Notes:Import("EncounterID:4002;Difficulty:Mythic;Name:Old" .. "\\ntime:1;ph:1;text:Old;", "Someone")
  Notes:Get(old).source = nil
  local new = Notes:Import("EncounterID:4002;Difficulty:Mythic;Name:Old" .. "\\ntime:2;ph:1;text:New;", "Officer1", nil, "guild:Cowfee")
  assert(new == old, "an old note without a source is replaced, not doubled")
  Notes:Delete(p1) Notes:Delete(mine) Notes:Delete(pug) Notes:Delete(old)
end
print("ok shared notes per guild and your personal notes")
do
  -- an unknown source (a pug, another guild): every share its own note, an exact repeat not doubled
  local H = "EncounterID:4003;Difficulty:Mythic;Name:Pug Boss"
  local a = Notes:Import(H .. "\\ntime:1;ph:1;text:A;\\nSent by: Pugger-Realm", "Pugger-Realm", nil, "pug:Pugger-Realm", "Cowfee Raid Tools")
  local b = Notes:Import(H .. "\\ntime:2;ph:1;text:B;\\nSent by: Pugger-Realm", "Pugger-Realm", nil, "pug:Pugger-Realm", "Cowfee Raid Tools")
  local again = Notes:Import(H .. "\\ntime:1;ph:1;text:A;\\nSent by: Pugger-Realm", "Pugger-Realm", nil, "pug:Pugger-Realm", "Cowfee Raid Tools")
  assert(a and b and a ~= b, "a pug's two different shares are two notes")
  assert(again == a, "an exact repeat replaces itself, not a third note")
  assert(Notes:Get(a).via == "Cowfee Raid Tools", "the addon it came by is kept")
  assert(Notes.SourceLabel(Notes:Get(a)) == "Pugger", "labelled by the sender, without the realm")
  local g = Notes:Import(H .. "\\ntime:3;ph:1;text:G;", "Officer-Realm", nil, "guild:Cowfee", "Cowfee Raid Tools")
  assert(g ~= a and g ~= b and Notes.SourceLabel(Notes:Get(g)) == "Cowfee", "your guild's note is labelled by the guild")
  Notes:Delete(a) Notes:Delete(b) Notes:Delete(g)
end
print("ok pug notes kept apart, your guild's by its name")
do
  -- the Notes list's three styles (Notes Settings): grouped headings, a dropdown, chips
  local function rowsShown()
    local out = {}
    for _, b in ipairs(buttons) do
      local t = rawget(b, "text")
      if rawget(b, "shown") and type(t) == "table" and (type(rawget(b, "heading")) == "string" or rawget(b, "id")) then
        out[#out + 1] = (type(rawget(b, "heading")) == "string" and ("#" .. b.heading) or tostring(t.text))
      end
    end
    return table.concat(out, "|")
  end
  Notes:SetListStyle("grouped")
  local g = rowsShown()
  assert(g:find("^#Mythic") and not g:find("(Mythic)", 1, true), "grouped: a Mythic heading, the rows without (Mythic): " .. g)
  Notes:SetListFolded("Mythic", true)
  assert(rowsShown():find("^#Mythic|#Other"), "a folded heading hides its notes, the next group still shown: " .. rowsShown())
  Notes:SetListFolded("Mythic", false)
  Notes:SetListStyle("dropdown")
  Notes:SetListDifficulty("Heroic")
  assert(rowsShown() == "", "dropdown on Heroic: no Mythic notes: " .. rowsShown())
  Notes:SetListDifficulty("All")
  assert(rowsShown():find("(Mythic)", 1, true), "All: the difficulty on each row")
  Notes:SetListStyle("chips")
  Notes:SetListDifficulty("Mythic")
  assert(rowsShown() ~= "" and not rowsShown():find("#", 1, true), "chips on Mythic: the notes, no headings")
  Notes:SetListDifficulty("All")
  Notes:SetListStyle("grouped")
end
print("ok the notes list: grouped headings, a dropdown, chips")
do
  -- who is your guild: the guild roster by name and realm (a guildie of another realm too), else the group
  local saved = { IsInGuild, GetGuildInfo, GetNumGroupMembers, IsInRaid, UnitName, GetNormalizedRealmName, CRT.Groups }
  IsInGuild = function() return true end
  GetGuildInfo = function(u) if u == "player" or u == "raid2" then return "Cowfee" end end
  GetNormalizedRealmName = function() return "Sargeras" end
  GetNumGroupMembers = function() return 0 end
  IsInRaid = function() return false end
  CRT.Groups = { Normalize = function(n) if not n:find("-", 1, true) then n = n .. "-Sargeras" end return n end,
    ReadGuild = function() return { { key = "Rixxy-TwistingNether" }, { key = "Abu-Sargeras" } } end }
  assert(Comm.InMyGuild("Rixxy-TwistingNether"), "a guildie of another realm, from the roster")
  assert(Comm.InMyGuild("Abu"), "a guildie of your realm, sent without the realm")
  assert(not Comm.InMyGuild("Pugger-Realm"), "anyone else is not")
  -- not on the roster yet (it loads late): in the group, by name and realm apart as UnitName gives them
  CRT.Groups = { Normalize = CRT.Groups.Normalize, ReadGuild = function() return {} end }
  GetNumGroupMembers = function() return 2 end
  IsInRaid = function() return true end
  UnitName = function(u) if u == "raid1" then return "Pugger", "Realm" elseif u == "raid2" then return "Rixxy", "TwistingNether" end end
  assert(Comm.InMyGuild("Rixxy-TwistingNether"), "in the group with your guild, matched across realms")
  assert(not Comm.InMyGuild("Pugger-Realm"), "in the group, another guild")
  IsInGuild, GetGuildInfo, GetNumGroupMembers, IsInRaid, UnitName, GetNormalizedRealmName, CRT.Groups = (table.unpack or unpack)(saved, 1, 7)
  -- the Shared by row's short names
  assert(Notes.ShortName("Rixxy-TwistingNether") == "Rixxy" and Notes.ShortName("Abu") == "Abu", "names without the realm")
  assert(Notes.ViaLabel("Cowfee Raid Tools") == "CRT" and Notes.ViaLabel("CRT") == "CRT" and Notes.ViaLabel("Northern Sky") == "NSRT", "addons by their short names")
end
print("ok your guild by its roster, across realms; short names")
do
  -- what you save or share is your guild's note, by the guild you are in now
  local saved = { IsInGuild, GetGuildInfo, UnitName }
  IsInGuild = function() return true end
  GetGuildInfo = function(u) if u == "player" then return "Cowfee of the Very Long Guild Name Indeed" end end
  UnitName = function(u) if u == "player" then return "Solex" end end
  local H = "EncounterID:4010;Difficulty:Mythic;Name:Claim Boss"
  local mine = Notes:Import(H .. "\\ntime:1;ph:1;text:A;", nil, nil, nil, "Imported")
  Notes:UpdateRaw(mine, H .. "\\ntime:2;ph:1;text:B;")
  assert(Notes:Get(mine).source == "guild:Cowfee of the Very Long Guild Name Indeed", "saving your own note makes it your guild's: " .. tostring(Notes:Get(mine).source))
  assert(Notes.SourceLabel(Notes:Get(mine)) == "Cowfee of the Very Long Guild Name Indeed", "labelled by the whole guild name (the row cuts it at its width)")
  local pug = Notes:Import(H .. "\\ntime:3;ph:1;text:P;", "Pugger-Realm", nil, "pug:Pugger-Realm", "CRT")
  Notes:UpdateRaw(pug, H .. "\\ntime:4;ph:1;text:P2;")
  assert(Notes:Get(pug).source == "pug:Pugger-Realm", "saving someone else's note leaves it theirs")
  Notes:ClaimForGuild(pug, true)
  assert(Notes:Get(pug).source:find("^guild:") and Notes:Get(pug).from == "Solex" and Notes:Get(pug).via == "CRT" and Notes:Get(pug).sharedAt, "sharing it puts it out as your guild's, shared by you through CRT")
  IsInGuild = function() return false end
  local solo = Notes:Import("EncounterID:4011;Name:Solo" .. "\\ntime:1;ph:1;text:S;", nil, nil, nil, "Imported")
  Notes:ClaimForGuild(solo, true)
  assert(Notes:Get(solo).source == nil and Notes:Get(solo).from == "Solex", "out of a guild: shared by you, no guild")
  IsInGuild, GetGuildInfo, UnitName = (table.unpack or unpack)(saved, 1, 3)
  Notes:Delete(mine) Notes:Delete(pug) Notes:Delete(solo)
end
print("ok your saved or shared note is your guild's")
do
  -- a long list: a row for every note (the list scrolls), each one selectable
  local made = {}
  for i = 1, 14 do
    made[i] = Notes:Import("EncounterID:" .. (5000 + i) .. ";Difficulty:Mythic;Name:Boss " .. i .. "\\ntime:1;ph:1;text:X;")
  end
  Notes:Fire()
  local rowsFor = {}
  for _, b in ipairs(buttons) do
    local id = rawget(b, "id")
    if id and rawget(b, "shown") then rowsFor[id] = b end
  end
  for i = 1, 14 do assert(rowsFor[made[i]], "a row for note " .. i .. " of 14") end
  local last = rowsFor[made[14]]
  last.OnClick(last)
  assert(shown():find("Name:Boss 14", 1, true), "the 14th note can be picked: " .. shown())
  for i = 1, 14 do Notes:Delete(made[i]) end
end
print("ok a long notes list: a row for every note, all selectable")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of process.argv.slice(2, 8)) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 6, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
