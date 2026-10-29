// Raid note history: the real CRT_Modules/Notes/Parse.lua, Data.lua, Diff.lua, Engine.lua, EditModel.lua, Render.lua,
// HistoryWindow.lua, EditorWindow.lua, Settings.lua and Page.lua on mock frames.
//   The diff (Notes/Diff.lua): added, removed and unchanged lines, empty texts, reordered lines, line ends.
//   The store (Notes/Data.lua): a version kept per path (edited, imported, received, line changes, restored) with how
//   and who; nothing on an unchanged save; at most 5; line changes in a row kept as one; the total size cap; Delete
//   removes a note's history; Restore and its undo.
//   The page: History (N) left of Pop out editor, greyed with none, and the footer line; the note text box shrunk by
//   that line so the details and Save stay inside the tab, and History clear of the Note text heading's (?).
//   The window: rows of when, how and who; Compare's diff and counts; Restore asks, then restores, and can be undone.
//   The pop-out editor's History button, and none for the personal note.
// Usage: node run_notes_history.js <Parse.lua> <Data.lua> <Diff.lua> <Engine.lua> <EditModel.lua> <Render.lua> <HistoryWindow.lua> <EditorWindow.lua> <Settings.lua> <Page.lua>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local parseSrc, dataSrc, diffSrc, engineSrc, modelSrc, renderSrc, historySrc, windowSrc, settingsSrc, pageSrc = ...
local buttons, edits, fontStrings, dropdowns = {}, {}, {}, {}
local focused
local function mock(kind, name)
  local m = { shown = true, kind = kind, name = name, scripts = {}, points = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self, _, _, font) local f = mock("FontString") rawset(f, "font", font) rawset(f, "parent", self) fontStrings[#fontStrings + 1] = f return f end end
    if k == "CreateTexture" then return function(self) local f = mock("Texture") rawset(f, "parent", self) return f end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") or "" end end
    if k == "GetFontString" then return function(self) local b = self return { GetStringWidth = function() return #(rawget(b, "text") or "") * 6 end } end end
    if k == "Show" then return function(self) local was = self.shown self.shown = true if not was and self.scripts.OnShow then self.scripts.OnShow(self) end end end
    if k == "Hide" then return function(self) local was = self.shown self.shown = false if was and self.scripts.OnHide then self.scripts.OnHide(self) end end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "IsVisible" then return function(self) local f = self while f do if not f.shown then return false end f = rawget(f, "parent") end return true end end
    if k == "GetParent" then return function(self) return rawget(self, "parent") end end
    if k == "HasFocus" then return function(self) return focused == self end end
    if k == "SetFocus" then return function(self) focused = self end end
    if k == "ClearFocus" then return function(self) if focused == self then focused = nil end end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return rawget(self, "enabled") ~= false end end
    if k == "SetPoint" then return function(self, ...) local p = { ... } self.points[#self.points + 1] = p end end
    if k == "ClearAllPoints" then return function(self) self.points = {} end end
    if k == "SetHeight" then return function(self, h) rawset(self, "height", h) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "width", w) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "width", w) rawset(self, "height", h) end end
    if k == "GetHeight" then return function(self) return rawget(self, "height") or 400 end end
    if k == "GetWidth" then return function(self) return rawget(self, "width") or 600 end end
    if k == "GetStringHeight" then return function(self) local n = 1 for _ in (rawget(self, "text") or ""):gmatch("\\n") do n = n + 1 end return n * 12 end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "GetScript" then return function(self, n) return self.scripts[n] end end
    if k == "HookScript" then return function(self, n, fn) local old = self.scripts[n] self.scripts[n] = function(...) if old then old(...) end fn(...) end end end
    if k == "GetEffectiveScale" then return function() return 1 end end
    if k == "SetMaxLines" then return function(self, n) rawset(self, "maxLines", n) end end
    if k == "SetMotionScriptsWhileDisabled" then return function(self, on) rawset(self, "motion", on) end end
    return function() end end })
end
function CreateFrame(kind, name, parent, template)
  local m = mock(kind, name)
  rawset(m, "parent", parent)
  rawset(m, "template", template)
  if name then _G[name] = m end
  if kind == "EditBox" then edits[#edits + 1] = m elseif kind == "Button" then buttons[#buttons + 1] = m end
  return m
end
format = string.format
date = os.date
local clock = 1800000000
function time() return clock end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
UIParent = mock()
UISpecialFrames = {}
tinsert = table.insert
CANCEL = "Cancel"
GameTooltip = mock()
function issecretvalue() return false end
local inRaid, leader = false, false
function IsInGroup() return inRaid end
function IsInRaid() return inRaid end
function UnitIsGroupLeader() return leader end
function UnitIsGroupAssistant() return false end
function UnitName(u) if u == "player" then return "Gadios" end end
function UnitClass() return "Priest", "PRIEST" end
function GetNumGroupMembers() return 1 end
function GetRaidRosterInfo(i) if i == 1 then return "Gadios", 2, 3 end end
function GetTime() return 100 end
function InCombatLockdown() return false end
function GetNumClasses() return 0 end
function IsMouseButtonDown() return false end
function GetCursorPosition() return 0, 0 end
C_Timer = { After = function(_, fn) end }
C_Spell = { GetSpellInfo = function(id) return { name = "Spell " .. id, iconID = 1 } end }
RAID_CLASS_COLORS = {}
StaticPopupDialogs = {}
function StaticPopup_Show(key) return { key = key } end
local asked
function StaticPopup_ShowCustomGenericConfirmation(info) asked = info return { info = info } end
local pages, printed = {}, {}
local CRT = {
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end,
    Options = function() return { { key = "raid:r1", label = "Raid One", title = true }, { key = 3470, label = "Nek'zali" }, { key = 3480, label = "Fresh" } } end },
  db = { classCache = {}, roleCache = {}, notes = { list = {}, nextId = 1, history = {}, trustedOnly = true, personalText = "", editor = {},
    window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
    assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50 },
    alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100 } } },
  UI = { PAGE_W = 1026, PAGE_H = 560, SkinScrollBar = function() end, ScrollGutter = function(w) return 6 + (w or 18) end,
    Help = function(parent, title, text) local m = mock() rawset(m, "helpTitle", title) rawset(m, "helpText", text) return m end,
    Dropdown = function(parent, label, opts) local m = mock() rawset(m, "parent", parent) rawset(m, "label", label) rawset(m, "opts", opts)
      rawset(m, "refresh", function() rawset(m, "refreshes", (rawget(m, "refreshes") or 0) + 1) end) dropdowns[#dropdowns + 1] = m return m end,
    Slider = function() local m = mock() rawset(m, "refresh", function() end) return m end,
    RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end,
    SetFrameTitle = function() end, StyleWindow = function() end,RegisterTab = function() end, SetTabSelected = function() end, SkinTree = function() end,
    SkinButton = function() end, SkinCheckButton = function() end, SkinEditBox = function() end, PANEL_BUTTON_PAD = 14,
    LiftOver = function() end, ShownPopup = function(ret) return ret end,
    PanelButtonWidth = function(w) return math.max(40, math.ceil(w or 0) + 28) end },
  Alerts = { Settings = function() return { bars = {} } end, RegisterBlock = function() end, onPull = {}, OnChange = function() end, PeekNextPhase = function() return nil end },
  AlertRules = {},
  NoteReminders = { Build = function() end }, NotePhases = { Build = function() end },
  NoteAlertsTab = { Build = function() end, Select = function() end },
  NoteWindow = { FONTS = { { name = "Friz Quadrata" } }, Flash = function() end },
  NoteComm = { Sharing = function() return nil end, Share = function() end },
  NoteTargets = { List = function() return {} end, Get = function() return nil end },
  Groups = { NUM_SLOTS = 40, Normalize = function(n) return n end, CreatePreset = function() return nil end, Find = function() return nil end,
    Presets = function() return {} end, OnChange = function() end, ReadRoster = function() return {} end, CachedRole = function() return nil end },
}
function CRT:Print(msg) printed[#printed + 1] = msg end
CRT.UI.PanelButton = function(parent, label, h, fn)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b:SetText(label) b:SetScript("OnClick", fn) return b
end
CRT.UI.HeaderButton = function(parent, label, fn, opts)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate") b:SetText(label) b:SetScript("OnClick", fn)
  rawset(b, "header", true) rawset(b, "opts", opts)
  b.SetLabel = function(self, t) self:SetText(t) end
  return b
end
local windows = {}
function CRT.UI.Window(name, opts)
  local f = CreateFrame("Frame", name, UIParent)
  rawset(f, "opts", opts)
  f.content = CreateFrame("Frame", nil, f)
  f.strip = CreateFrame("Frame", nil, f)
  f.strip.SetTitle = function(self, t) rawset(f, "title", t) end
  f.strip.SetHelp = function(self, title, text) rawset(f, "helpTitle", title) rawset(f, "helpText", text) end
  rawset(f, "CloseButton", CreateFrame("Button", nil, f))
  if opts.kind == "popout" then rawset(f, "reset", CreateFrame("Button", nil, f)) end
  f.Place = function() end
  f:SetScript("OnShow", function(self) rawset(self, "styledShows", (rawget(self, "styledShows") or 0) + 1) end)
  f.shown = false
  windows[name] = f
  return f
end
CRT_THEME(CRT, CRT.UI)
for _, src in ipairs({ { parseSrc, "Parse.lua" }, { dataSrc, "Data.lua" }, { diffSrc, "Diff.lua" }, { engineSrc, "Engine.lua" }, { modelSrc, "EditModel.lua" } }) do
  assert(load(src[1], src[2]))("CowfeeRaidTools", CRT)
end
local Notes, Diff = CRT.Notes, CRT.NoteDiff
local passes = 0
local function ok(msg) passes = passes + 1 print("ok " .. msg) end

-- 1. The diff
do
  assert(Diff and Diff.Lines, "CRT.NoteDiff.Lines")
  local function ops(a, b)
    local lines, added, removed = Diff.Lines(a, b)
    local out = {}
    for i, l in ipairs(lines) do out[i] = (l.op == "add" and "+" or l.op == "remove" and "-" or "=") .. l.text end
    return table.concat(out, ","), added, removed
  end
  local s, a, r = ops("A\\nB\\nC", "A\\nB\\nC")
  assert(s == "=A,=B,=C" and a == 0 and r == 0, "the same text: " .. s)
  s, a, r = ops("A\\nB\\nC", "A\\nX\\nB\\nC\\nD")
  assert(s == "=A,+X,=B,=C,+D" and a == 2 and r == 0, "adds: " .. s)
  s, a, r = ops("A\\nB\\nC\\nD", "A\\nC")
  assert(s == "=A,-B,=C,-D" and a == 0 and r == 2, "removes: " .. s)
  s, a, r = ops("A\\nB\\nC", "A\\nY\\nC")
  assert(s == "=A,-B,+Y,=C" and a == 1 and r == 1, "a changed line is removed then added: " .. s)
  s, a, r = ops("", "A\\nB")
  assert(s == "+A,+B" and a == 2 and r == 0, "from empty: " .. s)
  s, a, r = ops("A\\nB", "")
  assert(s == "-A,-B" and a == 0 and r == 2, "to empty: " .. s)
  s, a, r = ops("", "")
  assert(s == "" and a == 0 and r == 0, "both empty")
  s, a, r = ops("A\\nB\\nC", "C\\nA\\nB")
  assert(a == 1 and r == 1 and s == "+C,=A,=B,-C", "reordered: one line moved is one removed and one added: " .. s)
  s, a, r = ops("A\\r\\nB\\r\\n", "A\\nB")
  assert(a == 0 and r == 0 and s == "=A,=B", "line ends and a last line end don't count: " .. s)
  s, a, r = ops("A\\n\\nB", "A\\nB")
  assert(r == 1 and s == "=A,-,=B", "a blank line counts: " .. s)
  -- past 500 x 500 lines the middle isn't matched: all removed, then all added (a shared line too)
  local old, new = { "head" }, { "head" }
  for i = 1, 600 do old[#old + 1] = "o" .. i new[#new + 1] = "n" .. i end
  table.insert(old, 300, "shared") table.insert(new, 400, "shared")
  old[#old + 1] = "tail" new[#new + 1] = "tail"
  local lines, added, removed = Diff.Lines(table.concat(old, "\\n"), table.concat(new, "\\n"))
  assert(added == 601 and removed == 601, "the big middle: all removed then all added: " .. added .. " " .. removed)
  assert(lines[1].op == "same" and lines[2].op == "remove" and lines[602].op == "remove" and lines[603].op == "add" and lines[#lines].op == "same" and lines[#lines].text == "tail", "the common start and end kept, removes before adds")
  -- under the cap the shared line is matched
  local o2, n2 = {}, {}
  for i = 1, 40 do o2[#o2 + 1] = "o" .. i n2[#n2 + 1] = "n" .. i end
  table.insert(o2, 10, "shared") table.insert(n2, 30, "shared")
  local _, a2, r2 = Diff.Lines(table.concat(o2, "\\n"), table.concat(n2, "\\n"))
  assert(a2 == 40 and r2 == 40, "a small middle matches its shared line")
  ok("the diff: adds, removes, unchanged lines, empty texts, reordered lines and line ends; past 500 x 500 lines all removed then added")
end

-- 2. The store: a version per path, with how and who
local NOTE = "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali\\ntime:10;text:Soak;\\nTanks: Abu"
local id
do
  id = Notes:Import(NOTE, nil, nil, nil, "Imported")
  assert(Notes:HistoryCount(id) == 0, "a new note has no history")
  clock = clock + 60
  Notes:UpdateRaw(id, NOTE)
  assert(Notes:HistoryCount(id) == 0, "a save that doesn't change the text adds nothing")
  Notes:UpdateRaw(id, NOTE .. "\\nHealers: Gadios")
  local h = Notes:History(id)
  assert(#h == 1 and h[1].text == NOTE and h[1].how == "edited" and h[1].who == "Gadios" and h[1].at == clock, "an edit keeps the text before, by you")
  clock = clock + 60
  local again = Notes:Import(NOTE .. "\\nImported: line", nil, nil, nil, "Imported")
  assert(again == id, "the same boss's import replaces the note")
  h = Notes:History(id)
  assert(#h == 2 and h[1].how == "imported" and h[1].who == "Gadios" and h[1].text == NOTE .. "\\nHealers: Gadios", "an import keeps the text before")
  assert(h[2].how == "edited", "newest first")
  clock = clock + 60
  local got = Notes:Import(NOTE .. "\\nSent by: Rixxy", "Rixxy", nil, nil, "CRT")
  assert(got == id, "a share from your guild's source replaces it")
  h = Notes:History(id)
  assert(#h == 3 and h[1].how == "received" and h[1].who == "Rixxy" and h[1].text == NOTE .. "\\nImported: line", "a received note keeps the text before, from its sender")
  -- line changes (the Timeline, the alert editor): one entry for a run of them by you
  clock = clock + 60
  local before = Notes:Get(id).raw
  assert(Notes:AddLineTo(id, "time:20;text:Move;"), "a line added")
  assert(Notes:ReplaceLine(id, 2, "time:12;text:Soak;", "time:10;text:Soak;"), "a line changed")
  h = Notes:History(id)
  assert(#h == 4 and h[1].how == "edited" and h[1].lines and h[1].text == before, "line changes in a row keep one entry, the text before the first")
  clock = clock + 400
  assert(Notes:RemoveLine(id, 2, "time:12;text:Soak;"), "a line removed later")
  assert(Notes:HistoryCount(id) == 5, "a later line change is a new entry")
  -- the Timeline's Ctrl+Z writes whole records: Notes:RememberRaw keeps the text first, like a line change
  local n = Notes:HistoryCount(id)
  Notes:RememberRaw(id, Notes:Get(id).raw, "edited", { lines = true })
  assert(Notes:HistoryCount(id) == n, "the same text: nothing kept")
  Notes:RememberRaw(id, "undone text", "edited", { lines = true })
  assert(Notes:HistoryCount(id) == n, "within a run of line changes: one entry, as for the Timeline's own edits")
  ok("versions kept per path: edited, imported, received, line changes and undo, with how and who; none on an unchanged save")

  -- at most 5, the oldest dropped
  local oldest = Notes:History(id)[5]
  clock = clock + 60
  Notes:UpdateRaw(id, "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali\\nSix")
  h = Notes:History(id)
  assert(#h == 5 and h[5] ~= oldest and h[5].how == "imported", "the 6th drops the oldest")
  ok("at most 5 versions; the 6th drops the oldest")
end

-- 3. Restore and its undo
do
  local nowText = Notes:Get(id).raw
  local target = Notes:History(id)[3]
  local wanted = target.text
  assert(Notes:Restore(id, 3), "restored")
  local h = Notes:History(id)
  assert(Notes:Get(id).raw == wanted, "the version is the note's text again")
  assert(h[1].how == "restored" and h[1].text == nowText and h[1].from == target.at and h[1].who == "Gadios", "the text before is kept as a restored entry, naming the version")
  assert(Notes:Parsed(id).encounterID == 3470, "the note is parsed again")
  assert(Notes:Restore(id, 1), "restoring that entry")
  assert(Notes:Get(id).raw == nowText and Notes:History(id)[1].how == "restored" and Notes:History(id)[1].text == wanted, "undoes the restore")
  assert(not Notes:Restore(id, 9) and not Notes:Restore(999, 1), "a version or note that isn't there")
  -- the oldest (5th): put back, though its row drops off as the restored entry goes on top
  local before5 = Notes:Get(id).raw
  local oldest = Notes:History(id)[5]
  local oldestText, oldestAt = oldest.text, oldest.at
  assert(Notes:HistoryCount(id) == 5 and Notes:Restore(id, 5), "the 5th restored")
  h = Notes:History(id)
  assert(Notes:Get(id).raw == oldestText and #h == 5 and h[1].how == "restored" and h[1].text == before5 and h[1].from == oldestAt, "its text is back; the text before kept on top, naming it")
  assert(Notes:Restore(id, 1) and Notes:Get(id).raw == before5, "and that undoes it")
  ok("restore puts a version back, keeps the text before as a restored entry, and restoring that undoes it; the oldest too")
end

-- 4. Delete removes a note's history; the total size cap
do
  local other = Notes:Import("EncounterID:3471;Name:Other\\nA")
  Notes:UpdateRaw(other, "EncounterID:3471;Name:Other\\nB")
  assert(Notes:HistoryCount(other) == 1 and CRT.db.notes.history[other], "another note's history")
  Notes:Delete(other)
  assert(CRT.db.notes.history[other] == nil and Notes:HistoryCount(other) == 0, "Delete removes it")
  -- big texts: two notes over the cap together; the one whose history holds the most text loses its oldest first
  assert(type(Notes.HISTORY_BYTES) == "number" and Notes.HISTORY_BYTES > 0, "a named size cap")
  local big = string.rep("x", math.floor(Notes.HISTORY_BYTES / 4))
  local a = Notes:Import("EncounterID:4001;Name:Longer A\\n" .. big .. "1")
  local b = Notes:Import("EncounterID:4002;Name:B\\n" .. big .. "1")
  Notes:UpdateRaw(a, "EncounterID:4001;Name:Longer A\\n" .. big .. "2")
  Notes:UpdateRaw(a, "EncounterID:4001;Name:Longer A\\n" .. big .. "3")
  Notes:UpdateRaw(b, "EncounterID:4002;Name:B\\n" .. big .. "2")
  assert(Notes:HistoryCount(a) == 2 and Notes:HistoryCount(b) == 1, "under the cap: all kept")
  Notes:UpdateRaw(b, "EncounterID:4002;Name:B\\n" .. big .. "3")
  local total = 0
  for _, entries in pairs(CRT.db.notes.history) do for _, e in ipairs(entries) do total = total + #e.text end end
  assert(total <= Notes.HISTORY_BYTES, "the total fits the cap: " .. total)
  assert(Notes:HistoryCount(a) == 1 and Notes:History(a)[1].text:find("2$") and Notes:HistoryCount(b) == 2, "the note with the most text in its history lost its oldest")
  assert(Notes:HistoryCount(id) == 5, "a small note's history is untouched")
  Notes:Delete(a) Notes:Delete(b)
  ok("Delete removes a note's history; the total size cap drops the oldest of the note with the most history text first")
end

-- The page ------------------------------------------------------------------------------------------------------
for _, src in ipairs({ { renderSrc, "Render.lua" }, { historySrc, "HistoryWindow.lua" }, { windowSrc, "EditorWindow.lua" }, { settingsSrc, "Settings.lua" }, { pageSrc, "Page.lua" } }) do
  assert(load(src[1], src[2]))("CowfeeRaidTools", CRT)
end
local function button(text) for _, b in ipairs(buttons) do if rawget(b, "text") == text then return b end end end
local function buttonsLike(pattern) local out = {} for _, b in ipairs(buttons) do if (rawget(b, "text") or ""):find(pattern) then out[#out + 1] = b end end return out end
local fresh = Notes:Import("EncounterID:3480;Difficulty:Heroic;Name:Fresh\\nTanks: Abu")
Notes:SetActive(fresh)
local pf = mock()
pages.notes(pf)
pf:Show()
CRT.NotesPage.Open("notes")
local function redraw() for _, fn in ipairs(Notes.listeners) do fn() end end
-- the note's detail lines under the box: the page's tiny-font string
local statusFs
for _, f in ipairs(fontStrings) do if rawget(f, "font") == "CRTFontDisableTiny" or rawget(f, "font") == "CRTFontDisableSmall" then statusFs = statusFs or f end end
local function statusText() return statusFs and statusFs:GetText() end
-- picks a note in the list, as a click on its row does
local function pick(noteId)
  for _, b in ipairs(buttons) do
    if rawget(b, "id") == noteId and b.scripts.OnClick then b.scripts.OnClick(b) return true end
  end
end

-- 5. History (N) left of Pop out editor, greyed with none; the footer line
local P = CRT.NotesPage
do
  local hist = buttonsLike("^History %(")
  assert(#hist == 1, "one History button on the page (none on the personal note): " .. #hist)
  local h = hist[1]
  local pop = button("Pop out editor")
  assert(rawget(h, "text") == "History (0)" and not h:IsEnabled(), "History (0), greyed with no earlier version")
  local p = h.points[#h.points]
  assert(p[1] == "RIGHT" and p[2] == pop and p[3] == "LEFT", "left of Pop out editor")
  local editor = edits[1] -- the note text's raw box
  local save = button("Save text changes")
  editor:SetText("EncounterID:3480;Difficulty:Heroic;Name:Fresh\\nTanks: Abu, Cheo")
  save.scripts.OnClick(save)
  editor:SetText("EncounterID:3480;Difficulty:Heroic;Name:Fresh\\nTanks: Abu, Cheo\\nHealers: Gadios")
  save.scripts.OnClick(save)
  redraw()
  assert(Notes:HistoryCount(fresh) == 2, "two saves, two versions")
  assert(rawget(h, "text") == "History (2)" and h:IsEnabled(), "History (2), enabled: " .. tostring(rawget(h, "text")))
  assert(rawget(h, "width") == CRT.UI.PanelButtonWidth(#"History (2)" * 6), "sized from its label")
  ok("History (N) left of Pop out editor, greyed with none, counts the versions")
end

-- 6. The layout: the box shrunk by the footer line; the details, Save and History inside the tab
do
  assert(P.NOTE_BOX_H and P.STATUS_LINE_H and P.STATUS_LINES, "the layout's numbers")
  assert(P.STATUS_LINES == 4, "room for Last updated, Shared by, Roster and the History line")
  assert(P.NOTE_BOX_H == P.TAB_H - 36 - 44 - P.STATUS_LINE_H, "the box is one detail line shorter than before")
  assert(P.NOTE_BOX_TOP + P.NOTE_BOX_H + 8 + P.STATUS_LINES * P.STATUS_LINE_H <= P.TAB_H, "the details fit under the box")
  assert(P.NOTE_BOX_TOP + P.NOTE_BOX_H + 6 + 24 <= P.TAB_H, "Save fits under the box")
  -- History and Pop out editor sit over the box's right end; the Note text heading and its two (?) at its left
  local TEXT_W = CRT.UI.PAGE_W - 8 - 250 - 14 - (8 + 250 + 14)
  local popW = CRT.UI.PanelButtonWidth(#"Pop out editor" * 6)
  local histW = CRT.UI.PanelButtonWidth(#"History (5)" * 6)
  local headingRight = #"Note text" * 6 + 2 * (CRT.UI.HELP_GAP + CRT.UI.HELP_SIZE)
  assert(TEXT_W - popW - 6 - histW > headingRight + 8, "History clear of the heading's (?) icons")
  ok("the note text box is shrunk by the footer line; the details, Save and History stay inside the tab")
end

-- 7. The footer line
do
  local text = statusText()
  assert(text, "the page's detail lines")
  assert(text:find("2 earlier versions in History", 1, true), "the footer line: " .. text)
  assert(rawget(statusFs, "maxLines") == P.STATUS_LINES, "never more lines than the room under the box")
  local lines = {} for l in (text .. "\\n"):gmatch("(.-)\\n") do lines[#lines + 1] = l end
  assert(lines[1]:find("^Last updated") and lines[#lines]:find("earlier versions"), "under Last updated")
  assert(#lines <= P.STATUS_LINES, "within the lines the box leaves room for")
  local solo = Notes:Import("EncounterID:3490;Name:Solo\\nA")
  local hist = buttonsLike("^History %(")[1]
  assert(pick(solo), "picked")
  text = statusText()
  assert(not text:find("earlier version", 1, true), "no footer line with none: " .. text)
  assert(rawget(hist, "text") == "History (0)" and not hist:IsEnabled(), "and History greyed")
  assert(pick(fresh), "picked back")
  -- everything at once: shared by someone, a roster, a share going out and a run: still at most STATUS_LINES lines
  local got = Notes:Import("EncounterID:3495;Name:Busy\\nA", "Rixxy", nil, "pug:Rixxy", "CRT")
  Notes:Get(got).presetId = "r1"
  Notes:UpdateRaw(got, "EncounterID:3495;Name:Busy\\nB")
  local find, sharing, phase = CRT.Groups.Find, CRT.NoteComm.Sharing, CRT.NoteEngine.CurrentPhase
  CRT.Groups.Find = function(_, key) return key == "r1" and {} or nil end
  assert(pick(got), "picked")
  text = statusText()
  local function count(t) local n = 0 for _ in (t .. "\\n"):gmatch("(.-)\\n") do n = n + 1 end return n end
  assert(count(text) == 4 and text:find("in History", 1, true), "four details with the History line: " .. text)
  CRT.NoteComm.Sharing = function() return 1, 3 end
  redraw()
  text = statusText()
  assert(count(text) == 4 and text:find("Sharing: 1 of 3", 1, true) and not text:find("in History", 1, true), "a share going out takes the History line's place: " .. text)
  CRT.NoteEngine.running, CRT.NoteEngine.CurrentPhase = true, function() return 1 end
  redraw()
  text = statusText()
  assert(count(text) == 4 and text:find("Sharing: 1 of 3 parts sent; Running: phase 1", 1, true), "a share and a run share a line: " .. text)
  CRT.Groups.Find, CRT.NoteComm.Sharing, CRT.NoteEngine.CurrentPhase, CRT.NoteEngine.running = find, sharing, phase, false
  Notes:Delete(got)
  assert(pick(fresh), "picked back")
  ok("the footer line under Last updated, hidden with no earlier version; never more than the lines under the box")
end

-- 8. The window: rows, Compare, Restore asks and can be undone
local H = CRT.NoteHistory
do
  local hist = buttonsLike("^History %(")[1]
  hist.scripts.OnClick(hist)
  local win = windows.CowfeeRaidToolsNoteHistory
  assert(win and win.shown, "History opens the window")
  assert(rawget(win, "styledShows") == 1 and H.rows[1].shown, "its own OnShow is kept, and the rows are drawn")
  assert(win.opts.kind == "dialog" and (win.opts.layer or "popups") == "popups", "a dialog on the popups layer")
  assert(rawget(win, "title") == "History: Fresh (Heroic)", "titled with the note: " .. tostring(rawget(win, "title")))
  assert(rawget(win, "helpTitle") and rawget(win, "helpText"):find("5", 1, true), "its (?) on the title")
  assert(H.rows[1].shown and H.rows[1].when:GetText() == "Now" and not H.rows[1].restore.shown and not H.rows[1].compare.shown, "the note now first, no buttons")
  assert(H.rows[1].lines:GetText() == "3", "its line count")
  assert(H.rows[2].shown and H.rows[3].shown and not H.rows[4].shown, "then its two versions")
  assert(H.rows[2].how:GetText() == "Edited by Gadios" and H.rows[2].when:GetText() == os.date("%Y-%m-%d %H:%M", clock), "when, how and who")
  assert(H.rows[2].lines:GetText() == "2" and H.rows[3].lines:GetText() == "2", "line counts")
  assert(H.HowText({ how = "received", who = "Rixxy-Other" }) == "Received from Rixxy", "a received version names its sender")
  assert(H.HowText({ how = "imported", who = "Gadios" }) == "Imported by Gadios" and H.HowText({ how = "edited", lines = true, who = "Gadios" }) == "Lines changed by Gadios", "imported and line changes")
  assert(H.HowText({ how = "restored", who = "Gadios", from = clock }):find("^Restored by Gadios %(the version from "), "restored names the version")
  assert(H.summary:GetText():find("Click Compare", 1, true), "nothing compared yet")
  -- Compare the oldest version against now: Healers added, Tanks changed
  H.rows[3].compare.scripts.OnClick(H.rows[3].compare)
  assert(H.compared == Notes:History(fresh)[2] and H.rows[3].sel.shown, "the version picked")
  assert(H.summary:GetText():find("2 added, 1 removed", 1, true), "the counts: " .. H.summary:GetText())
  local d = H.diff:GetText()
  assert(d:find(CRT.UI.GoodText("+ Healers: Gadios"), 1, true) and d:find(CRT.UI.GoodText("+ Tanks: Abu, Cheo"), 1, true), "added lines in the good colour")
  assert(d:find(CRT.UI.BadText("- Tanks: Abu"), 1, true), "removed lines in the bad colour")
  assert(d:find(CRT.UI.ColorText("  EncounterID:3480;Difficulty:Heroic;Name:Fresh", "muted"), 1, true), "unchanged lines muted")
  assert(rawget(H.diffChild, "height") > 12, "the scroll child holds every line")
  -- worked out once per version and text
  local calls, lines0 = 0, Diff.Lines
  Diff.Lines = function(...) calls = calls + 1 return lines0(...) end
  redraw() redraw()
  assert(calls == 0, "a redraw with nothing changed reuses the diff")
  local keep = Notes:Get(fresh).raw
  Notes:Get(fresh).raw = keep .. "\\nNew: line"
  redraw()
  assert(calls == 1 and H.summary:GetText():find("3 added", 1, true), "a changed text works it out again: " .. H.summary:GetText())
  Notes:Get(fresh).raw = keep
  redraw()
  Diff.Lines = lines0
  assert(H.HowText({ how = "edited", who = "Ab|cffu" }) == "Edited by Ab||cffu", "a name shows as written")
  local piped = H.DiffText("a|cffff0000b", "")
  assert(piped:find("a||cffff0000b", 1, true), "a | in the note shows as written")
  ok("the window: the note now, then each version with when, how and who; Compare's coloured diff and counts")

  -- Restore asks, then restores; the restored entry undoes it
  local nowText = Notes:Get(fresh).raw
  local wanted = Notes:History(fresh)[2].text
  asked = nil
  H.rows[3].restore.scripts.OnClick(H.rows[3].restore)
  assert(asked and asked.text:find("Restore the version of Fresh", 1, true) and asked.acceptText == "Restore this version", "it asks first")
  assert(Notes:Get(fresh).raw == nowText, "nothing changes before the answer")
  asked.callback()
  assert(Notes:Get(fresh).raw == wanted, "restored")
  assert(printed[#printed]:find("Share to raid", 1, true), "says how to send it")
  assert(H.rows[2].how:GetText():find("^Restored by Gadios") and H.rows[4].shown, "a Restored entry on top, three versions now")
  assert(H.compared == Notes:History(fresh)[3] and H.rows[4].sel.shown, "the compared version followed to its new row")
  assert(H.summary:GetText():find("is the same as the note now", 1, true), "and is now the same as the note")
  assert(not H.rows[4].restore:IsEnabled(), "Restore greyed on the version that is the note now")
  assert(rawget(hist, "text") == "History (3)", "the page's count follows")
  H.rows[2].restore.scripts.OnClick(H.rows[2].restore)
  asked.callback()
  assert(Notes:Get(fresh).raw == nowText, "restoring the Restored entry undoes it")
  -- a raider who can't change the raid note can't restore into it
  inRaid, leader = true, false
  redraw()
  assert(not H.rows[2].restore:IsEnabled() and H.rows[2].restore.why, "greyed, saying why")
  asked = nil
  H.AskRestore(1)
  assert(asked == nil, "and it doesn't ask")
  inRaid, leader = false, false
  redraw()
  win:Hide()
  local pipe = Notes:Import("EncounterID:3496;Name:Pipe|Name\\nA")
  Notes:UpdateRaw(pipe, "EncounterID:3496;Name:Pipe|Name\\nB")
  assert(H.Open(pipe) and rawget(win, "title") == "History: Pipe||Name", "the title shows the name as written: " .. tostring(rawget(win, "title")))
  win:Hide()
  Notes:Delete(pipe)
  ok("Restore asks, restores only your copy, keeps the text before, and restoring that entry undoes it")
end

-- 9. The pop-out editor's History, and none for the personal note
do
  local Editor = CRT.NoteEditor
  assert(Editor.Open({ id = fresh }), "the editor opens")
  local W = Editor.state
  local b = W.history
  assert(b and rawget(b, "header") and b:GetParent() == W.window.strip, "a header button in the title bar")
  assert(rawget(b, "motion") == true, "its tooltip shows while greyed")
  local p = b.points[#b.points]
  assert(p[1] == "RIGHT" and p[2] == W.window.reset and p[3] == "LEFT", "left of Reset")
  assert(b.shown and rawget(b, "text") == "History (" .. Notes:HistoryCount(fresh) .. ")" and b:IsEnabled(), "History (N): " .. tostring(rawget(b, "text")))
  local win = windows.CowfeeRaidToolsNoteHistory
  b.scripts.OnClick(b)
  assert(win.shown and H.id == fresh, "it opens the same window on the note")
  win:Hide()
  W.window:Hide()
  assert(Editor.Open({ personal = true }), "the personal note's editor")
  assert(not b.shown, "no History on the personal note")
  W.window:Hide()
  ok("the pop-out editor's History opens the same window; none on the personal note")
end

-- 10. Import/New: the dialog saves any text as a new note; strict callers still refuse it
do
  local id, err = Notes:Import("Kite adds to the left")
  assert(id == nil and err and err:find("doesn't look like a raid note", 1, true), "strict callers still refuse plain text")
  local a = Notes:Import("  Kite adds to the left\\nsecond line", nil, nil, nil, "Imported", true)
  assert(a and Notes:Get(a).name == "Kite adds to the left" and Notes:Get(a).via == "Imported", "plain text saved, named from its first line")
  assert(Notes:Get(a).encounterID == nil and Notes:Get(a).difficulty == nil and not Notes:Get(a).personal, "no boss or difficulty")
  local _, msg = Notes:Import("Kite adds to the left", nil, nil, nil, "Imported", true)
  assert(msg == "Saved as a new note: Kite adds to the left.", "message: " .. tostring(msg))
  local b = Notes:Import("Kite adds to the left", nil, nil, nil, "Imported", true)
  assert(b ~= a and Notes:Get(a) and Notes:Get(b), "twice makes two notes, never replaces")
  local e = Notes:Import("", nil, nil, nil, "Imported", true)
  assert(e and Notes:Get(e).name == "New note " .. e and Notes:Get(e).raw == "", "empty text: an empty New note N")
  local long = Notes:Import(string.rep("x", 60), nil, true, nil, "Imported", true)
  assert(#Notes:Get(long).name == 40 and Notes:Get(long).personal == true, "name cut to 40; personal stays yours")
  -- a proper note still replaces the same boss's note
  local p1 = Notes:Import("EncounterID:3999;Name:Proper\\nA", nil, nil, nil, "Imported", true)
  local p2 = Notes:Import("EncounterID:3999;Name:Proper\\nB", nil, nil, nil, "Imported", true)
  assert(p1 == p2, "a real note replaces as before")
  ok("Import accepts any text as a new note only when asked; strict callers refuse it")

  -- the page's button and dialog
  local nb = button("Import/New")
  assert(nb and not button("Import"), "the button reads Import/New")
  local del = button("Delete")
  assert(del.points[1][1] == "LEFT" and del.points[1][2] == nb, "Delete stays after it")
  nb.scripts.OnClick(nb)
  local save
  for _, b in ipairs(buttons) do if rawget(b, "text") == "Save" and rawget(b, "parent") == CowfeeRaidToolsNoteImport then save = b end end
  assert(save, "the dialog's OK reads Save")
  local box = edits[#edits]
  box:SetText("Pull at 3 stacks")
  save.scripts.OnClick(save)
  local said
  for _, m in ipairs(printed) do if m == "Saved as a new note: Pull at 3 stacks." then said = true end end
  assert(said, "dialog message, last: " .. tostring(printed[#printed]))
  ok("the Import/New button and its Save dialog")
end

-- 11. Import/New's Boss and Difficulty row: pick the boss when the text doesn't name one
do
  local d = CowfeeRaidToolsNoteImport
  local nb = button("Import/New")
  local save
  for _, b in ipairs(buttons) do if rawget(b, "text") == "Save" and rawget(b, "parent") == d then save = b end end
  local function typed(text) d.edit:SetText(text) d.edit.scripts.OnTextChanged(d.edit, true) end
  local function said(msg) for _, m in ipairs(printed) do if m == msg then return true end end end
  local function options(o) return type(o.options) == "function" and o.options() or o.options end
  local function labelOf(o, key) for _, x in ipairs(options(o)) do if x.key == key then return x.label end end end
  local bossRow, diffRow
  for _, dd in ipairs(dropdowns) do
    if rawget(dd, "parent") == d and rawget(dd, "label") == "Boss" then bossRow = dd end
    if rawget(dd, "parent") == d and rawget(dd, "label") == "Difficulty" then diffRow = dd end
  end
  assert(bossRow and diffRow, "a Boss and a Difficulty dropdown in the dialog")
  local bo, dopt = bossRow.opts, diffRow.opts
  local list = options(bo)
  assert(list[1].key == "none" and list[1].label == "No boss" and list[2].title and list[2].label == "Raid One" and list[3].key == 3470 and list[4].key == 3480, "No boss, then the raid route with its headings")
  local dl = options(dopt)
  assert(#dl == 3 and dl[1].key == "Mythic" and dl[2].key == "Heroic" and dl[3].key == "Normal", "Mythic, Heroic, Normal")
  assert(d.bossHelp and rawget(d.bossHelp, "helpText") == "Pick the boss this note is for, so it shows under that difficulty and runs on that boss's pull. A note whose text starts with an EncounterID line uses that boss instead.", "the (?)")
  local L = CRT.NotesPage.IMPORT
  assert(L and L.H > 420 and L.H <= 470 and rawget(d, "height") == L.H and rawget(d, "width") == L.W, "the dialog grew, under 470 high")
  assert(L.PAD + L.BOSS_LABEL_W + 5 + L.BOSS_W + L.DIFF_GAP + L.DIFF_LABEL_W + 5 + L.DIFF_W + CRT.UI.HELP_GAP + CRT.UI.HELP_SIZE <= L.W - L.PAD, "the row fits across the dialog")
  assert(L.SCROLL_TOP <= L.ROW_Y - 32 - L.READ_H, "the text box under the row and its line")
  ok("Import/New: Boss (No boss, then the route with raid headings), Difficulty and a (?) in one row over the text box")

  -- No boss each time it opens; Difficulty greyed until a boss is picked
  bo.set(3470)
  nb.scripts.OnClick(nb)
  assert(bo.get() == "none" and bo.enabledIf() and not dopt.enabledIf(), "opens on No boss, Difficulty greyed")
  assert(not d.readLine:IsShown(), "no Read from line")
  bo.set(3470)
  assert(dopt.enabledIf() and dopt.get() == "Mythic", "a boss picked: Difficulty on, Mythic first")
  -- text with an EncounterID line fills both and greys them
  typed("EncounterID:3480;Difficulty:Heroic;Name:Fresh\\ntime:5;text:Go;")
  assert(bo.get() == 3480 and dopt.get() == "Heroic" and not bo.enabledIf() and not dopt.enabledIf(), "read from the text, both greyed")
  assert(d.readLine:IsShown() and d.readLine:GetText() == "Read from the note's EncounterID line", "the Read from line")
  typed("EncounterID:9999;Difficulty:Mythic;Name:Elsewhere\\nA")
  assert(bo.get() == 9999 and labelOf(bo, 9999) == "Elsewhere", "a boss outside the library shows its Name")
  typed("EncounterID:9998\\nA")
  assert(bo.get() == 9998 and labelOf(bo, 9998) == "Boss 9998", "and with no Name, Boss <id>")
  assert(dopt.get() ~= nil and labelOf(dopt, dopt.get()), "no Difficulty: the dropdown still shows something")
  typed("plain again")
  assert(bo.get() == 3470 and bo.enabledIf() and dopt.enabledIf() and dopt.get() == "Mythic" and not d.readLine:IsShown(), "plain text again: your pick is back")
  ok("Import/New: No boss on open, Difficulty greyed; an EncounterID line fills and greys both, with the Read from line")

  -- No boss: saved exactly as before
  nb.scripts.OnClick(nb)
  typed("Just a plain line")
  local nextId = CRT.db.notes.nextId
  save.scripts.OnClick(save)
  assert(said("Saved as a new note: Just a plain line."), "No boss: the old message")
  local plain = Notes:Get(nextId)
  assert(plain and plain.raw == "Just a plain line" and plain.encounterID == nil, "No boss: plain text, no boss")
  -- text with its own EncounterID line imports as today, replacing that boss's note, whatever was picked first
  local count = 0 for _ in pairs(CRT.db.notes.list) do count = count + 1 end
  nb.scripts.OnClick(nb)
  bo.set(3480)
  typed("EncounterID:3470;Difficulty:Mythic;Name:Nek'zali\\nReplaced")
  save.scripts.OnClick(save)
  local after = 0 for _ in pairs(CRT.db.notes.list) do after = after + 1 end
  assert(after == count and Notes:Get(id).raw == "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali\\nReplaced", "its EncounterID line replaces that boss's note")
  assert(said("Imported Nek'zali (Mythic)."), "the import message")
  ok("Import/New: No boss and text with an EncounterID line save as before")

  -- a picked boss: always a new note, with the header line, even when that boss already has one
  nb.scripts.OnClick(nb)
  typed("Soak on the left\\nsecond")
  bo.set(3470)
  dopt.set("Mythic")
  nextId = CRT.db.notes.nextId
  local activeBefore = Notes:Active()
  save.scripts.OnClick(save)
  local new = Notes:Get(nextId)
  assert(new and nextId ~= id and Notes:Get(id).raw == "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali\\nReplaced", "a second note; the existing one is kept")
  assert(new.raw == "EncounterID:3470;Difficulty:Mythic;Name:Soak on the left\\nSoak on the left\\nsecond", "the header line, named by the text's first line, then the text: " .. new.raw)
  assert(new.name == "Soak on the left" and Notes:Get(id).name == "Nek'zali", "the two notes for the boss are told apart by name")
  assert(Notes:Active() == activeBefore, "not made the active note")
  assert(new.encounterID == 3470 and new.difficulty == "Mythic" and not new.personal and Notes.DifficultyGroup(new) == "Mythic", "the boss's fields, listed under Mythic")
  assert(Notes:HistoryCount(nextId) == 0, "a new note has no earlier version")
  Notes:UpdateRaw(nextId, new.raw .. "\\nthird")
  assert(Notes:Get(nextId).name == "Soak on the left", "a later save keeps the name")
  assert(said("Saved as a new note for Nek'zali (Mythic): Soak on the left."), "the message names the boss: " .. tostring(printed[#printed]))
  assert(not d:IsShown(), "the dialog closes")
  -- again on Heroic, with no text: still a new note
  nb.scripts.OnClick(nb)
  bo.set(3470)
  dopt.set("Heroic")
  local third = CRT.db.notes.nextId
  save.scripts.OnClick(save)
  assert(Notes:Get(third) and Notes:Get(third).raw == "EncounterID:3470;Difficulty:Heroic;Name:Nek'zali\\n" and Notes:Get(third).difficulty == "Heroic", "no text: the header line alone, named for the boss")
  assert(said("Saved as a new note for Nek'zali (Heroic)."), "no text: the message without a name")
  -- a ; in the first line would end the Name field: left out of the name
  nb.scripts.OnClick(nb)
  typed("  Soak; then run  \\nmore")
  bo.set(3470)
  local semi = CRT.db.notes.nextId
  save.scripts.OnClick(save)
  assert(Notes:Get(semi).name == "Soak then run" and Notes:Get(semi).raw:find("^EncounterID:3470;Difficulty:Heroic;Name:Soak then run\\n"), "a ; left out of the name: " .. Notes:Get(semi).raw)
  assert(said("Saved as a new note for Nek'zali (Heroic): Soak then run."), "and in the message")
  Notes:Delete(semi)
  assert(Notes.FirstLineName("\\n  Kite left  \\nb") == "Kite left" and Notes.FirstLineName("  \\n ") == nil and #Notes.FirstLineName(string.rep("y", 50)) == 40, "Notes.FirstLineName: the first line, trimmed, at most 40")
  ok("Import/New: a picked boss saves a second note with the header line and the boss's fields, and says so")

  -- the Personal tab: the same, as your own note
  local personalTab
  for _, f in ipairs(fontStrings) do
    local p = rawget(f, "parent")
    if rawget(f, "text") == "Personal" and p and p.scripts.OnClick then personalTab = p end
  end
  assert(personalTab, "the Personal tab")
  personalTab.scripts.OnClick(personalTab)
  local mine = Notes:MakePersonal(3470, "Mythic", "Nek'zali")
  nb.scripts.OnClick(nb)
  assert(bo.get() == "none", "No boss again")
  typed("My own line")
  bo.set(3470)
  dopt.set("Mythic")
  nextId = CRT.db.notes.nextId
  save.scripts.OnClick(save)
  local own = Notes:Get(nextId)
  assert(own and nextId ~= mine and Notes:Get(mine) and own.personal == true and own.encounterID == 3470 and own.difficulty == "Mythic", "a second personal note for the boss")
  assert(own.raw == "EncounterID:3470;Difficulty:Mythic;Name:My own line\\nMy own line", "with the header line")
  assert(said("Saved as a new note for Nek'zali (Mythic): My own line."), "the message")
  -- two personal notes for the boss: the pull and the Timeline use the newest, the same whatever order pairs() gives
  assert(Notes:Get(mine).updated == own.updated, "made in the same minute")
  assert(Notes:PersonalFor(3470, "Mythic") == nextId and Notes:PersonalFor(3470, "mythic") == nextId, "the same minute: the one made later, the picked-boss note")
  assert(Notes:MakePersonal(3470, "Mythic", "Nek'zali") == nextId, "MakePersonal finds that one too, and makes none")
  local keepUpdated = Notes:Get(mine).updated
  Notes:Get(mine).updated = "2099-01-01 00:00"
  assert(Notes:PersonalFor(3470, "Mythic") == mine and Notes:MakePersonal(3470, "Mythic") == mine, "a later updated wins over the higher id")
  Notes:Get(mine).updated = keepUpdated
  -- shared notes for one boss in the same minute: the one made later (FindForEncounter's tie-break)
  local savedActive = Notes:Active()
  Notes:SetActive(nil)
  local s1 = Notes:Import("EncounterID:5101;Difficulty:Mythic;Name:Tie\\nA", nil, nil, nil, "Imported", true, true)
  local s2 = Notes:Import("EncounterID:5101;Difficulty:Mythic;Name:Tie\\nB", nil, nil, nil, "Imported", true, true)
  assert(s1 ~= s2 and Notes:Get(s1).updated == Notes:Get(s2).updated and Notes:FindForEncounter(5101, "Mythic") == s2, "the same minute: the higher id")
  Notes:Get(s1).updated = "2099-01-01 00:00"
  assert(Notes:FindForEncounter(5101, "Mythic") == s1, "else the later updated")
  Notes:Delete(s1) Notes:Delete(s2)
  Notes:SetActive(savedActive)
  for _, f in ipairs(fontStrings) do
    local p = rawget(f, "parent")
    if rawget(f, "text") == "Shared" and p and p.scripts.OnClick then p.scripts.OnClick(p) end
  end
  ok("Import/New on the Personal tab: a picked boss saves a new personal note")
end
print(passes .. " passed, 0 failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2, 12);
for (const f of files) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
