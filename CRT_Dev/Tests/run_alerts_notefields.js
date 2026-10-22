// Alerts stage 2a Task 2: display fields on raid note lines (show, tts, count, sound, glow, warn, linger, icon),
// Parser.FormatLine, line numbers, NoteEngine.ItemFor, and class tags.
// Usage: node run_alerts_notefields.js CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Speech.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Notes/Engine.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local frames = {}
function CreateFrame()
  local f = { events = {}, scripts = {} }
  function f:RegisterEvent(ev) self.events[ev] = true end
  function f:UnregisterEvent(ev) self.events[ev] = nil end
  function f:SetScript(k, fn) self.scripts[k] = fn end
  frames[#frames + 1] = f
  return f
end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
local clock = 1000
function GetTime() return clock end
local secrets = {}
function issecretvalue(v) return secrets[v] == true end
local SECRET = {}
secrets[SECRET] = true
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
function date() return "2026-10-16 12:00" end
function UnitName(u) if u == "player" then return "Cheoeqar" end return nil end
function UnitGroupRolesAssigned() return "DAMAGER" end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
function IsInRaid() return false end
function GetNumGroupMembers() return 1 end
function UnitIsUnit() return false end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
local classLocal, classFile = "Druid", "DRUID"
function UnitClass(u) if u == "player" then return classLocal, classFile, 11 end end
-- the client's class names, as the game lists them for its language (the class words read them)
local function setClass(localized, file)
  classLocal, classFile = localized, file
  LOCALIZED_CLASS_NAMES_MALE = { [file] = localized }
end
C_Spell = { GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
SOUNDKIT = { RAID_WARNING = 8959, READY_CHECK = 8960 }
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
C_VoiceChat = { SpeakText = function() end }

local CRT = {
  db = {
    notes = {
      list = {}, nextId = 1, trustedOnly = true,
      alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" },
    },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end },
  PlaySound = function() return 1 end,
  Print = function() end,
}
for i = 1, #sources, 2 do
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
end
local P, E, Rules, A, Notes = CRT.NoteParser, CRT.NoteEngine, CRT.AlertRules, CRT.Alerts, CRT.Notes
assert(P and E and Rules and A and Notes, "modules exist")

local function deepEq(a, b, path)
  path = path or "v"
  if type(a) ~= type(b) then return false, path .. ": " .. tostring(a) .. " vs " .. tostring(b) end
  if type(a) ~= "table" then
    if a == b then return true end
    return false, path .. ": " .. tostring(a) .. " vs " .. tostring(b)
  end
  for k, v in pairs(a) do
    local ok, why = deepEq(v, b[k], path .. "." .. tostring(k))
    if not ok then return false, why end
  end
  for k, v in pairs(b) do
    if a[k] == nil then return false, path .. "." .. tostring(k) .. " only on the right" end
  end
  return true
end
local function same(a, b, msg)
  local ok, why = deepEq(a, b)
  assert(ok, msg .. ": " .. tostring(why))
end
local function without(t, key)
  local c = {}
  for k, v in pairs(t) do if k ~= key then c[k] = v end end
  return c
end

local checks = {}
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)); checks.failed = (checks.failed or 0) + 1 end
end

-- What a note item looked like before display fields (copied from CRT_Modules/Notes/Engine.lua at c63e59f).
local function todayItem(t, index, mine)
  local s = Notes:Alert() or {}
  local bars = (A:Settings() or {}).bars or {}
  local info = t.kind == "spell" and Notes:SpellInfo(t.spellId) or nil
  local item = { id = "note:" .. index, ph = t.ph, time = t.time, spellID = t.spellId, icon = info and info.icon,
    text = t.kind == "spell" and (info and info.name or ("Spell " .. tostring(t.spellId))) or (t.text or ""), color = t.color }
  if mine then
    item.outputs = { alert = s.enabled and true or false, bar = (bars.shown and bars.noteLines) and true or false,
      speech = (s.enabled and s.tts) and true or false }
    item.priority = Rules.Priority(2, "normal")
    item.warn = s.seconds or 10
    item.hold = t.kind == "text" and (t.dur or 0) or 0.5
    item.speech = { { offset = s.ttsSeconds or 3, text = info and info.name or t.text or "" } }
  end
  return item
end

check("note lines: no show field keeps today", function()
  assert(type(E.ItemFor) == "function", "NoteEngine.ItemFor exists")
  local plain = P.Parse("time:20;ph:1;tag:Cheoeqar;text:Move out;dur:8;colors:1 1 0 1;\\ntime:5;ph:1;tag:Cheoeqar;spellid:1022;\\ntime:9;ph:1;tag:Rixxy;text:Theirs;")
  local legacy = P.Parse("time:20;ph:1;tag:Cheoeqar;text:Move out;dur:8;colors:1 1 0 1;DisplayType:Text;\\ntime:5;ph:1;tag:Cheoeqar;spellid:1022;DisplayType:Bar;\\ntime:9;ph:1;tag:Rixxy;text:Theirs;DisplayType:Text;")
  assert(#legacy.timers == 3, "three timers")
  for i, t in ipairs(legacy.timers) do
    assert(t.show == nil and t.tts == nil and t.count == nil and t.glow == nil and t.sound == nil
      and t.warn == nil and t.linger == nil and t.iconID == nil and t.displaytype == nil, "no display fields on timer " .. i)
    same(without(t, "line"), without(plain.timers[i], "line"), "DisplayType ignored, timer " .. i)
    local mine = E:IsMine(t)
    local it = E.ItemFor(t, i, mine)
    same(it, todayItem(t, i, mine), "item as today, timer " .. i)
    if mine then assert(not (it.outputs.text or it.outputs.icon or it.outputs.circle), "no new area outputs") end
  end
  -- Through a run: the note block's items are those items, and nothing reaches the new areas.
  E:Start(legacy, "test")
  local n = 0
  for _, it in ipairs(A.items) do
    if it.block == "note" then
      n = n + 1
      local index = tonumber(it.id:match("^note:(%d+)$"))
      local t = legacy.timers[index]
      local want = todayItem(t, index, E:IsMine(t))
      local got = {}
      for k, v in pairs(it) do if k ~= "block" then got[k] = v end end
      same(got, want, "block item " .. it.id)
    end
  end
  assert(n == 3, "three note items, got " .. n)
  for s = 0, 300 do
    local now = clock + s / 10
    local lines = A:Lines(now)
    for _, out in ipairs({ "text", "icon", "circle" }) do
      local shown = Rules.Area(lines, now, out, 99)
      assert(#shown == 0, out .. " area shows a plain note line at " .. s / 10)
    end
  end
  E:Stop()
end)

check("note lines: show field picks outputs", function()
  local n = P.Parse(table.concat({
    "time:30;ph:1;tag:Cheoeqar;spellid:1022;show:icon, Text,bogus;tts:1;count:yes;sound:RAID_WARNING;glow:true;warn:6;linger:3;icon:12345;",
    "time:40;ph:1;tag:Cheoeqar;text:Soak;dur:8;show:ALERT,bar;",
    "time:50;ph:1;tag:Cheoeqar;text:Quiet;show:circle;count:1;tts:0;glow:no;",
    "time:60;ph:1;tag:Rixxy;text:Theirs;show:alert,text;tts:1;",
  }, "\\n"))
  local t1, t2, t3, t4 = n.timers[1], n.timers[2], n.timers[3], n.timers[4]
  same(t1.show, { icon = true, text = true }, "show set from a comma list")
  assert(t1.tts == true and t1.count == true and t1.glow == true and t1.sound == "RAID_WARNING", "flags and sound")
  assert(t1.warn == 6 and t1.linger == 3 and t1.iconID == 12345, "numbers")
  assert(t3.tts == nil and t3.glow == nil and t3.count == true, "0 and no are not true")
  local s = Notes:Alert()
  local i1 = E.ItemFor(t1, 1, true)
  same(i1.outputs, { alert = false, text = true, icon = true, bar = false, circle = false, timeline = false, speech = true }, "outputs 1")
  same(i1.speech, Rules.SpeechItems("Spell1022", 6, true, true), "speech 1")
  assert(i1.warn == 6 and i1.hold == 3 and i1.icon == 12345 and i1.sound == "RAID_WARNING" and i1.glow == true, "fields 1")
  assert(i1.text == "Spell1022" and i1.priority == Rules.Priority(2, "normal"), "text and rank 1")
  local i2 = E.ItemFor(t2, 2, true)
  same(i2.outputs, { alert = true, text = false, icon = false, bar = true, circle = false, timeline = false, speech = false }, "outputs 2")
  assert(i2.warn == s.seconds and i2.hold == 8 and i2.icon == nil and i2.sound == nil and i2.glow == nil, "fields 2")
  same(i2.speech, {}, "no speech 2")
  local i3 = E.ItemFor(t3, 3, true)
  same(i3.outputs, { alert = false, text = false, icon = false, bar = false, circle = true, timeline = false, speech = true }, "outputs 3")
  same(i3.speech, Rules.SpeechItems("Quiet", 10, false, true), "count only")
  assert(i3.hold == 0.5, "hold at least half a second")
  -- Someone else's line: no outputs even with show.
  local i4 = E.ItemFor(t4, 4, false)
  assert(i4.outputs == nil and i4.speech == nil and i4.warn == nil, "other's line carries no outputs")
  assert(E:IsMine(t4) == false, "Rixxy is not me")
  -- The block uses ItemFor.
  E:Start(n, "test")
  local byId = {}
  for _, it in ipairs(A.items) do if it.block == "note" then byId[it.id] = it end end
  for index, t in ipairs(n.timers) do
    local want = E.ItemFor(t, index, E:IsMine(t))
    local got = {}
    for k, v in pairs(byId["note:" .. index]) do if k ~= "block" then got[k] = v end end
    same(got, want, "block item " .. index)
  end
  -- The icon area shows timer 1 within its warn window and not before.
  local start = clock
  local lines = A:Lines(start + 25)
  assert(#Rules.Area(lines, start + 25, "icon", 5) == 1, "icon area shows the line 5s before")
  assert(#Rules.Area(lines, start + 23, "icon", 5) == 0, "icon area waits for warn")
  assert(#Rules.Area(lines, start + 32.9, "icon", 5) == 1, "icon area lingers 3s")
  assert(#Rules.Area(lines, start + 33.1, "icon", 5) == 0, "icon area done after linger")
  E:Stop()
end)

check("routing: defaults keep today", function()
  CRT.db.alerts.noteLines = { text = false, icon = false, circle = false }
  local n = P.Parse(table.concat({ "time:20;ph:1;tag:Cheoeqar;text:Move out;dur:8;", "time:5;ph:1;tag:Cheoeqar;spellid:1022;" }, string.char(10)))
  for i, t in ipairs(n.timers) do
    same(E.ItemFor(t, i, true), todayItem(t, i, true), "item as today " .. i)
  end
end)

check("routing: note line to circle and icon", function()
  CRT.db.alerts.noteLines = { text = false, icon = true, circle = true }
  local n = P.Parse(table.concat({ "time:20;ph:1;tag:Cheoeqar;text:Move out;dur:8;", "time:5;ph:1;tag:Cheoeqar;spellid:1022;", "time:9;ph:1;tag:Rixxy;text:Theirs;" }, string.char(10)))
  for i = 1, 2 do
    local it = E.ItemFor(n.timers[i], i, true)
    assert(it.outputs.icon and it.outputs.circle and not it.outputs.text, "routed outputs " .. i)
    assert(it.outputs.alert and it.outputs.bar and it.outputs.speech, "alert, bar, speech as before " .. i)
    assert(it.warn == 10, "shows from warn " .. i)
  end
  assert(E.ItemFor(n.timers[3], 3, false).outputs == nil, "someone else's line carries nothing")
  E:Start(n, "test")
  local start = clock
  local lines = A:Lines(start + 25)
  assert(#Rules.Area(lines, start + 25, "circle", 5) >= 1, "circle area shows the line")
  assert(#Rules.Area(lines, start + 25, "icon", 5) >= 1, "icon area shows the line")
  assert(#Rules.Area(lines, start + 25, "text", 5) == 0, "text area stays empty")
  E:Stop()
  CRT.db.alerts.noteLines = { text = true, icon = false, circle = false }
  assert(E.ItemFor(n.timers[1], 1, true).outputs.text == true, "text routed")
  CRT.db.alerts.noteLines = nil
end)

check("routing: show line ignores routing", function()
  CRT.db.alerts.noteLines = { text = true, icon = true, circle = true }
  local t = P.Parse("time:30;ph:1;tag:Cheoeqar;text:Soak;show:alert,bar;").timers[1]
  same(E.ItemFor(t, 1, true).outputs, { alert = true, text = false, icon = false, bar = true, circle = false, timeline = false, speech = false }, "show outputs only")
  CRT.db.alerts.noteLines = nil
end)

check("timeline: a note line's show:timeline and the routing", function()
  local t = P.Parse("time:30;ph:1;tag:Cheoeqar;text:Soak;show:timeline,alert;").timers[1]
  same(t.show, { timeline = true, alert = true }, "show:timeline reads")
  local it = E.ItemFor(t, 1, true)
  assert(it.outputs.timeline == true and it.outputs.alert == true and not it.outputs.bar, "the timeline output")
  local line = P.FormatLine(t)
  assert(line:find("show:alert,timeline;", 1, true), "written back: " .. line)
  -- a plain line goes there only when routed
  CRT.db.alerts.noteLines = { text = false, icon = false, circle = false }
  local plain = P.Parse("time:20;ph:1;tag:Cheoeqar;text:Move out;").timers[1]
  assert(not E.ItemFor(plain, 1, true).outputs.timeline, "an older save without the box: not on the timeline")
  CRT.db.alerts.noteLines = { text = false, icon = false, circle = false, timeline = true }
  assert(E.ItemFor(plain, 1, true).outputs.timeline == true, "routed to the timeline")
  E:Start(P.Parse("time:20;ph:1;tag:Cheoeqar;text:Move out;"), "test")
  local lines = A:Lines(clock + 15)
  local found = false
  for _, l in ipairs(lines) do if l.outputs.timeline then found = true end end
  assert(found, "the run's lines carry it")
  E:Stop()
  CRT.db.alerts.noteLines = nil
end)

check("routing: missing noteLines table is safe", function()
  CRT.db.alerts.noteLines = nil
  local t = P.Parse("time:20;ph:1;tag:Cheoeqar;text:Move out;").timers[1]
  same(E.ItemFor(t, 1, true), todayItem(t, 1, true), "as today")
  CRT.db.alerts.noteLines = true
  same(E.ItemFor(t, 1, true), todayItem(t, 1, true), "non-table is safe")
  CRT.db.alerts.noteLines = nil
end)

check("note lines: format and parse round trip", function()
  assert(type(P.FormatLine) == "function", "FormatLine exists")
  assert(P.FormatLine({ time = 34, ph = 1, tags = { "Cheoeqar" }, kind = "spell", spellId = 64843 })
    == "time:34;ph:1;tag:Cheoeqar;spellid:64843;", "spell line: " .. P.FormatLine({ time = 34, ph = 1, tags = { "Cheoeqar" }, kind = "spell", spellId = 64843 }))
  local full = { time = 48.5, ph = 1.5, tags = { "Abu", "Sixz" }, kind = "text", text = "Group 1 go in", dur = 8,
    color = { 0, 0.5, 1, 1 }, show = { circle = true, alert = true, bar = true, text = true, icon = true },
    tts = true, count = true, sound = "READY_CHECK", glow = true, warn = 7, linger = 2.5, iconID = 135940 }
  local line = P.FormatLine(full)
  assert(line == "time:48.5;ph:1.5;tag:Abu Sixz;text:Group 1 go in;dur:8;colors:0 0.5 1 1;show:alert,text,icon,bar,circle;"
    .. "tts:1;count:1;sound:READY_CHECK;glow:1;warn:7;linger:2.5;icon:135940;", "full line: " .. line)
  assert(P.FormatLine({ time = 5, tags = {}, kind = "text", text = "Hi" }) == "time:5;text:Hi;", "only the fields it has: "
    .. P.FormatLine({ time = 5, tags = {}, kind = "text", text = "Hi" }))
  local cases = {
    full,
    { time = 34, ph = 1, tags = { "Cheoeqar" }, kind = "spell", spellId = 64843 },
    { time = -5, ph = 2, tags = { "Death", "Knight", "G1" }, kind = "text", text = "Pre", show = { icon = true }, iconID = 1 },
    { time = 0, ph = 1, tags = {}, kind = "text", text = "All", color = { 1, 0.25, 0, 0.75 } },
    { time = 12, ph = 1, tags = { "healer" }, kind = "spell", spellId = 31884, show = {}, warn = 3 },
  }
  for i, t in ipairs(cases) do
    local back = P.Parse(P.FormatLine(t)).timers[1]
    assert(back, "parsed back " .. i)
    assert(back.line == 1, "line 1")
    same(without(back, "line"), t, "round trip " .. i .. " (" .. P.FormatLine(t) .. ")")
  end
  -- Every timer of a parsed note formats back to itself.
  local raw = "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali\\n"
    .. "time:48;ph:1;tag:Abu Sixz;text:Group 1 go in;dur:8;colors:0 1 1 1;DisplayType:Text;\\n"
    .. "time:30;ph:1;tag:Cheoeqar;spellid:1022;show:icon,text;tts:1;sound:RAID_WARNING;\\n"
  for _, t in ipairs(P.Parse(raw).timers) do
    same(without(P.Parse(P.FormatLine(t)).timers[1], "line"), without(t, "line"), "note timer round trip")
  end
end)

check("note lines: colours round trip exactly", function()
  local t = P.Parse("time:5;ph:1;text:c;colors:0.333 1 0.125 0.5;").timers[1]
  same(t.color, { 0.333, 1, 0.125, 0.5 }, "parsed colour")
  local line = P.FormatLine(t)
  assert(line == "time:5;ph:1;text:c;colors:0.333 1 0.125 0.5;", "colour written as read: " .. line)
  same(P.Parse(line).timers[1].color, t.color, "colour back")
end)

check("note lines: line numbers kept", function()
  local raw = table.concat({
    "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali",   -- 1
    "",                                                    -- 2
    "time:90;ph:1;tag:Cheoeqar;spellid:1022;",            -- 3
    "Some free text",                                      -- 4
    "time:10;ph:2;tag:Cheoeqar;text:Late;",               -- 5
    "time:10;ph:1;tag:Cheoeqar;text:Early;",              -- 6
    "invitelist:A-B,C-D;",                                 -- 7
    "time:5;ph:1;tag:all;text:First;",                    -- 8
  }, "\\r\\n")
  local n = P.Parse(raw)
  local got = {}
  for _, t in ipairs(n.timers) do got[#got + 1] = tostring(t.text or t.spellId) .. "@" .. tostring(t.line) end
  local s = table.concat(got, ",")
  assert(s == "First@8,Early@6,1022@3,Late@5", "line numbers: " .. s)
end)

check("tags: class matches timed lines only", function()
  setClass("Druid", "DRUID")
  clock = clock + 10
  assert(E:IsMine({ tags = { "Druid" } }), "Druid")
  assert(E:IsMine({ tags = { "druid" } }), "druid")
  assert(E:IsMine({ tags = { "Rixxy", "DRUID" } }), "with a name before")
  assert(not E:IsMine({ tags = { "Mage" } }), "Mage is not me")
  assert(E:IsForMe({ tags = { "Druid" } }) and not E:IsForMe({ tags = { "Priest" } }), "only me filter")
  assert(E:WordIsMe("Druid") == false and E:WordIsMe("druid") == false, "class word never marks free text")
  assert(E:WordIsMe("Cheoeqar") == true and E:WordIsMe("ranged") == true, "free text still knows name and role")
  -- A localized name that differs from the class file still works.
  setClass("Druide", "DRUID")
  clock = clock + 10
  assert(E:IsMine({ tags = { "Druide" } }) and E:IsMine({ tags = { "druid" } }), "localized and file name")
  -- No UnitClass: no class words, no error.
  local saved = UnitClass
  UnitClass = nil
  clock = clock + 10
  assert(not E:IsMine({ tags = { "Druid" } }), "no class without UnitClass")
  UnitClass = saved
  -- A secret class name is not used.
  setClass(SECRET, "DRUID")
  CRT.Timeline = { readable = function(v) return not issecretvalue(v) end }
  clock = clock + 10
  assert(E:IsMine({ tags = { "druid" } }), "class file still used")
  CRT.Timeline = nil
end)

check("tags: two-word class name", function()
  setClass("Death Knight", "DEATHKNIGHT")
  clock = clock + 10
  assert(E:IsMine({ tags = { "Death", "Knight" } }), "Death Knight")
  assert(E:IsMine({ tags = { "deathknight" } }), "deathknight")
  assert(E:IsMine({ tags = { "DeathKnight" } }), "DeathKnight")
  assert(E:IsMine({ tags = { "Rixxy", "death", "knight" } }), "after a name")
  assert(not E:IsMine({ tags = { "Death" } }) and not E:IsMine({ tags = { "Knight" } }), "half a name is not a match")
  assert(not E:IsMine({ tags = { "Demon", "Hunter" } }), "another two-word class")
  assert(E:WordIsMe("death") == false and E:WordIsMe("knight") == false and E:WordIsMe("deathknight") == false, "free text")
  -- A localized name of any number of words.
  setClass("Chevalier de la mort", "DEATHKNIGHT")
  clock = clock + 10
  assert(E:IsMine({ tags = { "chevalierdelamort" } }), "joined localized name")
  assert(E:IsMine({ tags = { "Chevalier", "de", "la", "mort" } }), "four-word tag")
  assert(E:IsMine({ tags = { "Rixxy", "chevalier", "de", "la", "mort" } }), "four words after a name")
  assert(not E:IsMine({ tags = { "Chevalier", "de", "la" } }), "part of the name")
  assert(E:IsMine({ tags = { "DeathKnight" } }), "file token still works")
  assert(E:WordIsMe("chevalier") == false and E:WordIsMe("mort") == false, "free text never")
  -- The same words through a parsed note line.
  local t = P.Parse("time:5;ph:1;tag:Death Knight;text:Grip;").timers[1]
  assert(E:IsMine(t), "parsed two-word tag")
end)

check("tags: Demon Hunter is one class, never Hunter", function()
  setClass("Demon Hunter", "DEMONHUNTER")
  clock = clock + 10
  for _, tags in ipairs({ { "Demon", "Hunter" }, { "DemonHunter" }, { "DEMONHUNTER" }, { "demonhunter" }, { "Rixxy", "demon", "HUNTER" } }) do
    assert(E:IsMine({ tags = tags }), "a Demon Hunter: " .. table.concat(tags, " "))
  end
  assert(not E:IsMine({ tags = { "Hunter" } }) and not E:IsMine({ tags = { "Demon" } }), "half the name is not a Demon Hunter")
  assert(E:IsMine(P.Parse("time:5;ph:1;tag:Demon Hunter Warlock;text:Orb;").timers[1]), "parsed")
  -- a localized client still reads the English and one-word spellings
  setClass("Chasseur de demons", "DEMONHUNTER")
  clock = clock + 10
  assert(E:IsMine({ tags = { "Demon", "Hunter" } }) and E:IsMine({ tags = { "DEMONHUNTER" } }), "English words on another client")
  assert(E:IsMine({ tags = { "Chasseur", "de", "demons" } }), "the client's own name")
  setClass("Hunter", "HUNTER")
  clock = clock + 10
  assert(not E:IsMine({ tags = { "Demon", "Hunter" } }), "a Hunter is not a Demon Hunter")
  assert(not E:IsMine({ tags = { "DEMONHUNTER" } }) and not E:IsMine({ tags = { "Death", "Knight" } }), "nor any other class")
  assert(E:IsMine({ tags = { "Hunter" } }) and E:IsMine({ tags = { "HUNTER" } }), "Hunter is")
  assert(E:IsMine({ tags = { "Demon", "Hunter", "Hunter" } }) and E:IsMine({ tags = { "Death", "Knight", "Hunter" } }), "Hunter after a two-word class")
  assert(not E:IsMine(P.Parse("time:5;ph:1;tag:Demon Hunter Warlock;text:Orb;").timers[1]), "parsed, not a Hunter's")
end)

check("note lines: show line text label wins", function()
  local n = P.Parse(table.concat({
    "time:30;ph:1;tag:Cheoeqar;spellid:1022;text:Soak now;show:icon,text;tts:1;",
    "time:31;ph:1;tag:Cheoeqar;spellid:1022;show:icon;",
    "time:32;ph:1;tag:Cheoeqar;spellid:1022;text:Soak now;",
  }, "\\n"))
  local a, b, c = E.ItemFor(n.timers[1], 1, true), E.ItemFor(n.timers[2], 2, true), E.ItemFor(n.timers[3], 3, true)
  assert(a.text == "Soak now" and a.icon == 101022 and a.spellID == 1022, "show: text is the label, spell gives the icon: " .. tostring(a.text))
  same(a.speech, Rules.SpeechItems("Soak now", a.warn, true, false), "speaks the label")
  assert(b.text == "Spell1022", "no text: the spell name")
  assert(c.text == "Spell1022", "no show: keeps the spell name as today")
  assert(E.ItemFor(n.timers[1], 1, false).text == "Soak now", "the same label for anyone's line")
end)

check("speak at: old lines without ttsat speak on show", function()
  local n = P.Parse(table.concat({
    "time:30;ph:1;tag:Cheoeqar;text:Old;show:text;tts:1;warn:6;",
    "time:40;ph:1;tag:Cheoeqar;text:New;show:text;tts:1;ttsat:0;warn:6;",
    "time:50;ph:1;tag:Cheoeqar;text:Both;show:text;tts:1;count:1;ttsat:0;warn:6;",
    "time:60;ph:1;tag:Cheoeqar;spellid:1022;",
  }, "\\n"))
  local old = E.ItemFor(n.timers[1], 1, true)
  assert(n.timers[1].speakAt == nil, "no ttsat: no speakAt")
  same(old.speech, { { offset = 6, text = "Old" } }, "old line speaks on show")
  local new = E.ItemFor(n.timers[2], 2, true)
  same(new.speech, { { offset = 0, text = "New" } }, "ttsat:0 speaks at the cast")
  local both = E.ItemFor(n.timers[3], 3, true)
  same(both.speech, { { offset = 0, text = "Both" }, { offset = 3, text = "3" }, { offset = 2, text = "2" }, { offset = 1, text = "1" } }, "count unchanged")
  local plain = E.ItemFor(n.timers[4], 4, true)
  same(plain.speech, { { offset = Notes:Alert().ttsSeconds or 3, text = "Spell1022" } }, "a line without show: as today")
end)

for _, e in ipairs(errors) do print("error " .. e) end
assert(#errors == 0, "errors: " .. #errors)
if checks.failed then error(checks.failed .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const names = ['CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/Engine.lua'];
const files = process.argv.slice(2);
if (files.length !== names.length) { console.error('usage: node run_alerts_notefields.js ' + names.join(' ')); process.exit(2); }
files.forEach((p, i) => { lua.lua_pushstring(L, to_luastring(names[i])); lua.lua_pushstring(L, to_luastring(fs.readFileSync(p, 'utf8'))); });
if (lua.lua_pcall(L, files.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
