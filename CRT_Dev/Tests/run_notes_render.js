// Raid Notes shows a note rendered: the real CRT_Modules/Notes/Parse.lua, Data.lua, Render.lua, Settings.lua and Page.lua
// on mock frames. Rows from the note parser (timers by phase and time, tags class coloured, the line's colour
// swatch, the display type, a spell's icon or its ID until loaded), label and heading lines, unknown lines
// kept, the invite list folded, the class lookup order, and both boxes: a click shows the raw text, Save shows
// it rendered again, and unsaved typing stays raw.
// Usage: node run_notes_render.js <Parse.lua> <Data.lua> <Render.lua> <Settings.lua> <Page.lua>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local parseSrc, dataSrc, renderSrc, settingsSrc, pageSrc = ...
local edits, buttons, frames, scrolls, events = {}, {}, {}, {}, {}
local focused
local function mock(kind, name)
  local m = { shown = true, kind = kind, name = name, scripts = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function(self, _, _, font) local f = mock("FontString") rawset(f, "font", font) rawset(f, "parent", self) return f end end
    if k == "CreateTexture" then return function(self) local f = mock("Texture") rawset(f, "parent", self) return f end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") or "" end end
    if k == "Show" then return function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) if on then self:Show() else self:Hide() end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "IsVisible" then return function(self) local f = self while f do if not f.shown then return false end f = rawget(f, "parent") end return true end end
    if k == "HasFocus" then return function(self) return focused == self end end
    if k == "SetFocus" then return function(self) if focused and focused ~= self then focused:ClearFocus() end focused = self end end
    if k == "ClearFocus" then return function(self) if focused == self then focused = nil if self.scripts.OnEditFocusLost then self.scripts.OnEditFocusLost(self) end end end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return rawget(self, "enabled") ~= false end end
    if k == "EnableMouse" then return function(self, on) rawset(self, "mouse", on and true or false) end end
    if k == "SetMultiLine" then return function(self, v) rawset(self, "multi", v) end end
    if k == "SetTexture" then return function(self, v) rawset(self, "texture", v) end end
    if k == "SetTextColor" then return function(self, r, g, b, a) rawset(self, "textColor", { r, g, b, a }) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "height", h) end end
    if k == "GetStringHeight" then return function(self) return 12 end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "GetWidth" then return function(self) return 200 end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "GetScript" then return function(self, n) return self.scripts[n] end end
    if k == "HookScript" then return function(self, n, fn) local old = self.scripts[n] self.scripts[n] = function(...) if old then old(...) end fn(...) end end end
    if k == "RegisterEvent" then return function(self, e) events[e] = self end end
    return function() end end })
end
function CreateFrame(kind, name, parent)
  local m = mock(kind, name)
  rawset(m, "parent", parent)
  if kind == "EditBox" then edits[#edits + 1] = m elseif kind == "Button" then buttons[#buttons + 1] = m
  elseif kind == "ScrollFrame" then scrolls[#scrolls + 1] = m else frames[#frames + 1] = m end
  return m
end
format = string.format
date = os.date
UIParent = mock()
UISpecialFrames = {}
tinsert = table.insert
CANCEL = "Cancel"
-- a value the game hides: any string starting SECRET
function issecretvalue(v) return type(v) == "string" and v:find("^SECRET") ~= nil end
local inRaid, leader = false, false
function IsInGroup() return inRaid end
function IsInRaid() return inRaid end
function UnitIsGroupLeader() return leader end
function UnitIsGroupAssistant() return false end
local myName = "Gadios"
function UnitName(u) if u == "player" then return myName end end
function GetTime() return 100 end
function InCombatLockdown() return false end
local afters = {}
C_Timer = { After = function(_, fn) afters[#afters + 1] = fn end }
local function runTimers() local list = afters afters = {} for _, fn in ipairs(list) do fn() end end
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function() return 0 end }
-- spell 64843 is loaded at once; 99999 only after the game loads it
local loaded, requested = { [64843] = true }, {}
C_Spell = {
  GetSpellInfo = function(id) if loaded[id] then return { name = "Spell name " .. id, iconID = 1000 + id } end end,
  RequestLoadSpellData = function(id) requested[id] = (requested[id] or 0) + 1 end,
}
-- not theme colours: the game's class colours
RAID_CLASS_COLORS = { MAGE = { colorStr = "ff3fc7eb" }, PRIEST = { colorStr = "ffffffff" }, ROGUE = { colorStr = "fffff468" }, PALADIN = { colorStr = "fff48cba" },
  DEMONHUNTER = { colorStr = "ffa330c9" }, DEATHKNIGHT = { colorStr = "ffc41e3a" }, HUNTER = { colorStr = "ffaad372" }, WARLOCK = { colorStr = "ff8788ee" } }
local pages = {}
local CRT = {
  Bosses = { OnRouteChange = function() end, RouteIndex = function() end },
  db = { classCache = {}, notes = { list = {}, nextId = 1, trustedOnly = true, personalText = "",
    window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
    assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50 },
    alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100 } } },
  UI = { PAGE_W = 1026, PAGE_H = 560, SkinScrollBar = function() end, ScrollGutter = function(w) return 6 + (w or 18) end,
    Help = function(parent, title, text) local m = mock() rawset(m, "helpTitle", title) rawset(m, "helpText", text) return m end,
    Dropdown = function() local m = mock() rawset(m, "refresh", function() end) return m end,
    Slider = function() local m = mock() rawset(m, "refresh", function() end) return m end,
    RegisterLayer = function() end, RegisterPage = function(_, key, title, fn) pages[key] = fn end, Show = function() end,
    SetFrameTitle = function() end, RegisterTab = function() end, SetTabSelected = function() end, SkinTree = function() end },
  Alerts = { Settings = function() return { bars = {} } end },
  NoteReminders = { Build = function() end }, NotePhases = { Build = function() end },
  NoteEngine = { running = false, PeekNextPhase = function() return nil end, CurrentPhase = function() return 1 end },
  NoteAlertsTab = { Build = function() end, Select = function() end },
  NoteWindow = { FONTS = { { name = "Friz Quadrata" } }, Flash = function() end },
  NoteComm = { Sharing = function() return nil end, Share = function() end },
  NoteTargets = { List = function() return {} end, Get = function() return nil end },
  Groups = { NUM_SLOTS = 40, Normalize = function(n) return n end, CreatePreset = function() return "roster1" end,
    Find = function(_, id) return id == "roster1" and {} or nil end },
}
function CRT:Print() end
CRT_THEME(CRT, CRT.UI)
assert(load(parseSrc, "Parse.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(renderSrc, "Render.lua"))("CowfeeRaidTools", CRT)
assert(load(settingsSrc, "Settings.lua"))("CowfeeRaidTools", CRT)
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local Render, Notes = CRT.NoteRender, CRT.Notes
assert(Render and Render.Rows and Render.View and Render.ClassLookup, "CRT.NoteRender with Rows, View and ClassLookup")

local NOTE = table.concat({
  "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali",
  "time:48;ph:1;tag:Abu Gadios;text:Group 1 go in;dur:8;colors:0 1 1 1;DisplayType:Text;",
  "time:34;ph:1;tag:Cheoeqar;spellid:64843;",
  "ph:1.5;time:5;tag:healer;spellid:99999;",
  "time:2:10;ph:1;text:no time it can read;",
  "Melee: Cheoeqar, Abu",
  "",
  "Kick order",
  "Something odd ; with: colons",
  "invitelist:Cheoeqar-Sargeras,Abu-Sargeras,,Gadios-Sargeras;",
}, "\\n")
local classes = { cheoeqar = "ROGUE", abu = "MAGE" }
local function ctx(extra)
  local c = { classOf = function(n) return classes[(n:lower():gsub("%-.*$", ""))] end, me = "gadios",
    spell = function(id) return Notes:SpellInfo(id) end }
  for k, v in pairs(extra or {}) do c[k] = v end
  return c
end
local function find(rows, kind, n)
  local i = 0
  for _, r in ipairs(rows) do if r.kind == kind then i = i + 1 if i == (n or 1) then return r end end end
end
local function count(rows, kind) local n = 0 for _, r in ipairs(rows) do if r.kind == kind then n = n + 1 end end return n end

-- 1. Timers: sorted by phase then time, phase chips, tags, swatch, display type, spell icon or ID
do
  local rows = Render.Rows(NOTE, ctx())
  local header = rows[1]
  assert(header.kind == "header" and header.text:find("Nek'zali", 1, true) and header.text:find("Mythic", 1, true), "the header: boss and difficulty")
  assert(header.sub:find("3470", 1, true), "the header's small line has the encounter ID: " .. tostring(header.sub))
  assert(count(rows, "timer") == 3, "three timers (the one with no time it can read is not a timer)")
  local a, b, c = find(rows, "timer", 1), find(rows, "timer", 2), find(rows, "timer", 3)
  assert(a.time == "0:34" and b.time == "0:48" and c.time == "0:05", "sorted by phase then time: " .. a.time .. " " .. b.time .. " " .. c.time)
  assert(a.phase == "P1" and b.phase == "P1" and c.phase == "P1.5", "phase chips P1, P1, P1.5")
  assert(a.text == "Spell name 64843" and a.icon == 1000 + 64843 and not a.pending, "a loaded spell: its name and icon")
  assert(c.text == "Spell 99999" and c.pending and c.icon, "a spell not loaded yet: its ID and a placeholder icon")
  assert(b.text == "Group 1 go in" and b.color and b.color[2] == 1 and b.color[1] == 0, "a text line: its text and its colors swatch")
  assert(b.display == "Text" and a.display == nil, "the display type, only when the line has one")
  assert(#b.names == 2 and b.names[1].text == "Abu" and b.names[1].class == "MAGE" and not b.names[1].me, "tags class coloured")
  assert(b.names[2].text == "Gadios" and b.names[2].me, "your own name is marked as you")
  assert(c.names[1].text == "healer" and c.names[1].class == nil, "a role word stays plain")
  local markup = Render.Markup(b)
  assert(markup:find("|cff3fc7ebAbu|r", 1, true), "the names in their class colour: " .. markup)
  assert(markup:find("Group 1 go in", 1, true) and markup:find("|T", 1, true), "the swatch drawn inline before the text: " .. markup)
  assert(Render.Markup(a):find("|T" .. (1000 + 64843), 1, true), "a spell line shows its icon inline")
end
print("ok timers: sorted, phase chips, class coloured tags, swatch, display type, spell icon or its ID")

-- 2. Plain lines: label, heading, blank, unknown lines kept
do
  local rows = Render.Rows(NOTE, ctx())
  local label = find(rows, "label")
  assert(label and label.label == "Melee", "a label line keeps its label")
  local m = Render.Markup(label)
  assert(m:find("|cfffff468Cheoeqar|r", 1, true) and m:find("|cff3fc7ebAbu|r", 1, true) and m:find(", ", 1, true), "its names class coloured, the commas kept: " .. m)
  local heading = find(rows, "heading")
  assert(heading and heading.text == "Kick order", "a line with no colon is a heading")
  assert(count(rows, "blank") >= 1, "a blank line keeps its space")
  local texts = {}
  for _, r in ipairs(rows) do if r.kind == "text" then texts[#texts + 1] = Render.Markup(r) end end
  local all = table.concat(texts, "|")
  assert(all:find("time:2:10;ph:1;text:no time it can read;", 1, true), "a timer line it can't read is shown as written: " .. all)
  assert(all:find("Something odd ; with: colons", 1, true) or (find(rows, "label", 2) and find(rows, "label", 2).label == "Something odd ; with"), "an odd line is kept")
  -- every line of the note is somewhere in the rows
  local plain = Render.Rows("just words\\nwith: a colon\\n:starts with a colon", ctx())
  assert(#plain == 3 and plain[1].kind == "heading" and plain[2].kind == "label" and plain[3].kind == "text", "no line dropped")
end
print("ok label and heading lines, blank lines kept, unknown lines shown as written")

-- 2b. Class names in assignments and tags: each one class, a two-word name coloured as one
do
  local rows = Render.Rows(table.concat({ "Orb Soak 1: Demon Hunter Warlock Priest Monk", "Orb Soak 3: Mage Warlock Death Knight Warrior",
    "Orb Soak 4: Hunter", "Soak: DEMONHUNTER, Abu", "time:5;ph:1;tag:Demon Hunter Abu;text:Orb;" }, "\\n"), ctx())
  local function classed(row)
    local out = {}
    for _, p in ipairs(row.parts) do if p.class then out[#out + 1] = p.text .. "=" .. p.class end end
    return table.concat(out, ",")
  end
  local l1, l3, l4, l5 = find(rows, "label", 1), find(rows, "label", 2), find(rows, "label", 3), find(rows, "label", 4)
  assert(classed(l1) == "Demon Hunter=DEMONHUNTER,Warlock=WARLOCK,Priest=PRIEST,Monk=MONK", classed(l1))
  assert(Render.Markup(l1):find("|cffa330c9Demon Hunter|r |cff8788eeWarlock|r", 1, true), Render.Markup(l1))
  assert(classed(l3) == "Mage=MAGE,Warlock=WARLOCK,Death Knight=DEATHKNIGHT,Warrior=WARRIOR", classed(l3))
  assert(classed(l4) == "Hunter=HUNTER", "Hunter alone: " .. classed(l4))
  assert(classed(l5) == "DEMONHUNTER=DEMONHUNTER,Abu=MAGE", "the one-word spelling, a player still by name: " .. classed(l5))
  local t = find(rows, "timer")
  assert(#t.names == 2 and t.names[1].text == "Demon Hunter" and t.names[1].class == "DEMONHUNTER" and t.names[2].text == "Abu", "a tag's two words are one name")
  assert(Render.Markup(t):find("|cffa330c9Demon Hunter|r, |cff3fc7ebAbu|r", 1, true), Render.Markup(t))
  -- a player whose name is a class word keeps the player's colour
  local mine = Render.Rows("Soak: Hunter", ctx({ classOf = function(n) return n == "Hunter" and "ROGUE" or nil end }))
  assert(classed(mine[1]) == "Hunter=ROGUE", classed(mine[1]))
end
print("ok class names: one class each, Demon Hunter and Death Knight coloured as one")

-- 3. The invite list: folded to a count, open shows the names
do
  local rows = Render.Rows(NOTE, ctx())
  local inv = find(rows, "invite")
  assert(inv and inv.count == 3 and not inv.open, "Invite list (3), folded: " .. tostring(inv and inv.count))
  assert(Render.Markup(inv):find("Invite list (3)", 1, true), "its label")
  local last = rows[#rows]
  assert(last.kind == "invite", "folded: no names under it")
  local open = Render.Rows(NOTE, ctx({ inviteOpen = true }))
  local names = open[#open]
  assert(names.kind == "text" and Render.Markup(names):find("|cfffff468Cheoeqar-Sargeras|r", 1, true), "open: the names under it, class coloured")
end
print("ok the invite list folds to its count and opens to its names")

-- 4. Class colours: the group first, then the guild, then names seen before
do
  local group = { { key = "Abu-Sargeras", class = "MAGE" } }
  local guild = { { key = "Abu-Sargeras", class = "PRIEST" }, { key = "Rixxy-Sargeras", class = "PRIEST" } }
  local seen = { { key = "abu-sargeras", class = "ROGUE" }, { key = "rixxy-sargeras", class = "ROGUE" }, { key = "old-sargeras", class = "PALADIN" } }
  local classOf = Render.ClassLookup({ group, guild, seen })
  assert(classOf("Abu") == "MAGE" and classOf("Abu-Sargeras") == "MAGE", "the group first")
  assert(classOf("Rixxy") == "PRIEST", "then the guild")
  assert(classOf("Old") == "PALADIN", "then names seen before")
  assert(classOf("Nobody") == nil and classOf("Abu-OtherRealm") == nil, "else plain")
  -- a name or class the game hides is skipped, never compared
  local hidden = Render.ClassLookup({ { { key = "SECRETkey", class = "MAGE" }, { key = "Vis-Sargeras", class = "SECRETclass" } } })
  assert(hidden("SECRETkey") == nil and hidden("Vis") == nil, "secret keys and classes are skipped")
  -- the sources from the game: the live group and guild (Groups), the class cache, Loot Master's session
  CRT.Groups.ReadRoster = function() return { { key = "Abu-Sargeras", class = "MAGE" } } end
  CRT.Groups.ReadGuild = function() return { { key = "Abu-Sargeras", class = "PRIEST" }, { key = "Gil-Sargeras", class = "PRIEST" } } end
  CRT.db.classCache = { ["abu-sargeras"] = "ROGUE", ["old-sargeras"] = "PALADIN" }
  CRT.LootMaster = { current = { players = { ["Loot-Sargeras"] = { class = "ROGUE" } } } }
  local live = Render.ClassLookup()
  assert(live("Abu") == "MAGE" and live("Gil") == "PRIEST" and live("Old") == "PALADIN" and live("Loot") == "ROGUE", "from the game, in that order")
  -- in combat the group's names may be secret: only names seen before
  InCombatLockdown = function() return true end
  local fighting = Render.ClassLookup()
  assert(fighting("Abu") == "ROGUE" and fighting("Gil") == nil, "in combat, the group and guild are not read")
  InCombatLockdown = function() return false end
  CRT.Groups.ReadRoster, CRT.Groups.ReadGuild, CRT.LootMaster = nil, nil, nil
end
print("ok class colours: the group, then the guild, then names seen")

-- 5. The page: both boxes rendered, a click shows the raw text, Save renders it again
local id = Notes:Import(NOTE)
Notes:SetActive(id)
local pf = mock()
pages.notes(pf)
pf:Show()
CRT.NotesPage.Open("notes")
local editor, personal
for _, e in ipairs(edits) do if rawget(e, "multi") then if not editor then editor = e elseif not personal then personal = e end end end
assert(editor and personal, "the note text and personal note boxes")
local textScroll, personalScroll
for _, s in ipairs(scrolls) do
  if s.name == "CowfeeRaidToolsNoteTextScroll" then textScroll = s elseif s.name == "CowfeeRaidToolsPersonalNoteScroll" then personalScroll = s end
end
local textView, personalView = Render.views.Text, Render.views.Personal
assert(textView and personalView, "a rendered view for each box")
local function redraw() for _, fn in ipairs(Notes.listeners) do fn() end end
local function rawShown(view, scroll) return scroll.shown and not view.frame.shown end
do
  assert(textView.frame.shown and not textScroll.shown, "the note shows rendered")
  assert(editor:GetText() == NOTE, "the raw text is still loaded")
  assert(find(textView.rows, "timer") and find(textView.rows, "header"), "the rendered rows are the note's")
  assert(find(textView.rows, "header").sub:find("roster linked", 1, true), "the header says the roster is linked: " .. find(textView.rows, "header").sub)
  -- drawn once per change: a redraw with nothing changed draws nothing
  local draws = textView.draws
  redraw() redraw()
  assert(textView.draws == draws, "no redraw without a change (" .. textView.draws .. " vs " .. draws .. ")")
  -- a click anywhere: the raw text, with focus
  textView.frame.scripts.OnMouseDown(textView.frame)
  assert(rawShown(textView, textScroll) and editor:HasFocus(), "a click shows the raw text with focus")
  -- Escape with no changes: rendered again
  editor.scripts.OnEscapePressed(editor)
  assert(textView.frame.shown and not textScroll.shown, "Escape without changes renders it again")
  -- typing, then focus lost: stays raw, and a redraw keeps the typing
  textView.frame.scripts.OnMouseDown(textView.frame)
  editor:SetText(NOTE .. "\\nNew line")
  editor:ClearFocus()
  assert(rawShown(textView, textScroll), "unsaved typing keeps the raw box")
  redraw()
  assert(rawShown(textView, textScroll) and editor:GetText():find("New line", 1, true), "a redraw keeps the unsaved typing raw")
  -- Save: stored, rendered again with the new line
  local save
  for _, b in ipairs(buttons) do if rawget(b, "text") == "Save text changes" then save = b end end
  save.scripts.OnClick(save)
  assert(Notes:Get(id).raw:find("New line", 1, true), "Save stores the text")
  assert(textView.frame.shown and not textScroll.shown, "Save shows it rendered")
  local heading = false
  for _, r in ipairs(textView.rows) do if r.kind == "heading" and r.text == "New line" then heading = true end end
  assert(heading, "the rendered view has the new line")
end
print("ok the note text: rendered, a click shows the raw text, Save renders it, unsaved typing stays raw")

do
  assert(personalView.frame.shown and not personalScroll.shown, "the personal note shows rendered")
  personalView.frame.scripts.OnMouseDown(personalView.frame)
  assert(rawShown(personalView, personalScroll) and personal:HasFocus(), "a click shows the personal note's raw text")
  personal:SetText("# Healers\\nTanks: Abu\\ntime:10;ph:1;tag:Gadios;spellid:64843;")
  personal:ClearFocus()
  assert(rawShown(personalView, personalScroll), "unsaved personal typing stays raw")
  local psave
  for _, b in ipairs(buttons) do if rawget(b, "text") == "Save personal note" then psave = b end end
  psave.scripts.OnClick(psave)
  assert(Notes:Personal():find("Tanks: Abu", 1, true), "Save personal note stores it")
  assert(personalView.frame.shown and not personalScroll.shown, "Save shows the personal note rendered")
  local rows = personalView.rows
  assert(rows[1].kind == "timer" or find(rows, "timer"), "the personal note's timed line rendered")
  assert(find(rows, "heading") and find(rows, "heading").text == "Healers", "a # heading in the personal note")
  assert(find(rows, "label") and find(rows, "label").label == "Tanks", "a label line in the personal note")
end
print("ok the personal note: rendered, a click shows the raw text, Save renders it")

-- 6. The invite row opens and folds on a click, without leaving the rendered view
do
  local inviteRow
  for _, b in ipairs(buttons) do if rawget(b, "kind") == "Button" and rawget(b, "rowKind") == "invite" and b.shown then inviteRow = b end end
  assert(inviteRow, "the invite list's row")
  inviteRow.scripts.OnClick(inviteRow)
  assert(textView.frame.shown and textView.rows[#textView.rows].kind == "text", "a click opens it, still rendered")
  inviteRow.scripts.OnClick(inviteRow)
  assert(textView.rows[#textView.rows].kind == "invite", "a second click folds it")
end
print("ok the invite list opens and folds on a click")

-- 7. A spell loaded later: the row refreshes; a theme switch repaints
do
  assert(requested[99999], "the missing spell's data is asked for")
  loaded[99999] = true
  local draws = textView.draws
  local frame = events.SPELL_DATA_LOAD_RESULT
  assert(frame, "listens for SPELL_DATA_LOAD_RESULT")
  frame.scripts.OnEvent(frame, "SPELL_DATA_LOAD_RESULT", 99999, true)
  runTimers()
  assert(textView.draws > draws and find(textView.rows, "timer", 3).text == "Spell name 99999", "the row shows the spell once loaded")
  draws = textView.draws
  CRT.UI.SwitchTheme("nitro")
  assert(textView.draws > draws, "a theme switch repaints the rendered view")
  local heading = find(textView.rows, "header")
  assert(heading, "still the header after the switch")
  -- the group changes: drawn again on the page's next refresh, not at once
  draws = textView.draws
  events.GROUP_ROSTER_UPDATE.scripts.OnEvent(events.GROUP_ROSTER_UPDATE, "GROUP_ROSTER_UPDATE")
  assert(textView.draws == draws, "a roster change draws nothing at once")
  redraw()
  assert(textView.draws == draws + 1, "the next refresh draws it again, for the class colours")
end
print("ok a spell loaded later refreshes its row; a theme switch repaints")

-- 8. A spell that never loads: asked once, the redraws settle, it keeps showing its ID
do
  local fail, empty = 77777, 66666
  local text = "time:1;ph:1;spellid:" .. fail .. ";\\ntime:2;ph:1;spellid:" .. empty .. ";"
  textView:SetText(text)
  assert(requested[fail] == 1 and requested[empty] == 1, "each asked for once")
  local frame = events.SPELL_DATA_LOAD_RESULT
  local draws = textView.draws
  -- the load failed: nothing to draw, never asked again
  frame.scripts.OnEvent(frame, "SPELL_DATA_LOAD_RESULT", fail, false)
  runTimers()
  assert(textView.draws == draws, "a failed load draws nothing")
  -- loaded, but the game still gives no name: one more draw, then never asked again
  frame.scripts.OnEvent(frame, "SPELL_DATA_LOAD_RESULT", empty, true)
  runTimers()
  assert(textView.draws == draws + 1, "a load draws once")
  for _ = 1, 3 do
    frame.scripts.OnEvent(frame, "SPELL_DATA_LOAD_RESULT", empty, true)
    frame.scripts.OnEvent(frame, "SPELL_DATA_LOAD_RESULT", fail, true)
    runTimers()
    CRT.UI.SwitchTheme("midnight")
  end
  assert(requested[fail] == 1 and requested[empty] == 1, "never asked again: " .. requested[fail] .. ", " .. requested[empty])
  assert(#afters == 0, "no redraw left waiting")
  assert(find(textView.rows, "timer", 1).text == "Spell " .. fail and find(textView.rows, "timer", 2).text == "Spell " .. empty, "both keep showing their ID")
  textView:SetText(Notes:Get(id).raw)
end
print("ok a spell that fails to load, or loads with no name, is asked for once and the redraws settle")

-- 9. Muted texts follow the theme; a view off screen waits; one class lookup per change for both views
do
  local header = textView.pool[1]
  assert(header.rowKind == "header" and header.muted.shown, "the header's small line")
  local m = CRT.PALETTE.muted
  CRT.UI.SwitchTheme("cowfee")
  local c = header.muted.textColor
  assert(c and c[1] == m[1] and c[2] == m[2] and c[3] == m[3], "the header's small line in the theme's muted colour")
  -- the page closed: a switch draws nothing until it shows again
  local draws = textView.draws
  pf.shown = false
  CRT.UI.SwitchTheme("nitro")
  assert(textView.draws == draws, "a view off screen is not drawn on a switch")
  pf.shown = true
  redraw()
  assert(textView.draws == draws + 1, "it draws when the page refreshes again")
  -- both views read the group once per change
  local reads = 0
  CRT.Groups.ReadRoster = function() reads = reads + 1 return {} end
  CRT.UI.SwitchTheme("cowfee")
  assert(reads == 1, "one roster read for both views: " .. reads)
  CRT.Groups.ReadRoster = nil
end
print("ok muted texts follow the theme; views off screen wait; one class lookup for both views")

-- 10. A raider who can't change the raid note: the raw text read-only, Escape renders it again
do
  inRaid, leader = true, false
  redraw()
  local save
  for _, b in ipairs(buttons) do if rawget(b, "text") == "Save text changes" then save = b end end
  assert(textView.frame.shown and not save:IsEnabled(), "rendered, Save greyed")
  textView.frame.scripts.OnMouseDown(textView.frame)
  assert(rawShown(textView, textScroll) and editor:HasFocus(), "a click shows the raw text to read")
  local before = editor:GetText()
  editor:SetText(before .. "typed")
  editor.scripts.OnTextChanged(editor, true)
  assert(editor:GetText() == before, "typing is undone: read-only")
  editor.scripts.OnEscapePressed(editor)
  assert(textView.frame.shown and not textScroll.shown, "Escape renders it again")
  inRaid, leader = false, false
  redraw()
end
print("ok a raider who can't edit reads the raw text, read-only")

-- 11. Your name hidden by the game: never compared, so nothing is marked as you
do
  myName = "SECRETname"
  CRT.UI.SwitchTheme("midnight")
  for _, r in ipairs(textView.rows) do
    for _, n in ipairs(r.names or {}) do assert(not n.me, "nothing marked as you") end
  end
  myName = "Gadios"
end
print("ok a hidden name is skipped")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of process.argv.slice(2, 7)) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
