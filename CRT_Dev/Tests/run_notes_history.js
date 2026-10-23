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
local buttons, edits, fontStrings = {}, {}, {}
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
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end },
  db = { classCache = {}, roleCache = {}, notes = { list = {}, nextId = 1, history = {}, trustedOnly = true, personalText = "", editor = {},
    window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
    assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50 },
    alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100 } } },
  UI = { PAGE_W = 1026, PAGE_H = 560, SkinScrollBar = function() end, ScrollGutter = function(w) return 6 + (w or 18) end,
    Help = function(parent, title, text) local m = mock() rawset(m, "helpTitle", title) rawset(m, "helpText", text) return m end,
    Dropdown = function(_, label, opts) local m = mock() rawset(m, "label", label) rawset(m, "opts", opts) rawset(m, "refresh", function() end) return m end,
    Slider = function() local m = mock() rawset(m, "refresh", function() end) return m end,
    RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end,
    SetFrameTitle = function() end, RegisterTab = function() end, SetTabSelected = function() end, SkinTree = function() end,
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
  ok("the diff: adds, removes, unchanged lines, empty texts, reordered lines and line ends")
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
  ok("versions kept per path: edited, imported, received and line changes, with how and who; none on an unchanged save")

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
  ok("restore puts a version back, keeps the text before as a restored entry, and restoring that undoes it")
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
  assert(text:find("2 earlier versions: click History to compare or restore", 1, true), "the footer line: " .. text)
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
  ok("the footer line under Last updated, hidden with no earlier version")
end

-- 8. The window: rows, Compare, Restore asks and can be undone
local H = CRT.NoteHistory
do
  local hist = buttonsLike("^History %(")[1]
  hist.scripts.OnClick(hist)
  local win = windows.CowfeeRaidToolsNoteHistory
  assert(win and win.shown, "History opens the window")
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
  ok("Restore asks, restores only your copy, keeps the text before, and restoring that entry undoes it")
end

-- 9. The pop-out editor's History, and none for the personal note
do
  local Editor = CRT.NoteEditor
  assert(Editor.Open({ id = fresh }), "the editor opens")
  local W = Editor.state
  local b = W.history
  assert(b and rawget(b, "header") and b:GetParent() == W.window.strip, "a header button in the title bar")
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
print(passes .. " passed, 0 failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2, 12);
for (const f of files) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
