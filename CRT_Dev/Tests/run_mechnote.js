// CRT_Modules/Notes/MechNote.lua: a Mech Alert saved as Raid note. A reminder becomes one raid note line per cast time
// (every look and sound field, the For tag, a mech:<key>; marker), the marked lines are found, replaced in place and
// taken out with the rest of the note kept byte for byte, the boss's note for the difficulty is found or made, and the
// lines' new optional fields (ticks:, fill:, countto:) run on the alerts and survive an older CRT.
// Usage: node run_mechnote.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
function CreateFrame()
  local f = { events = {} }
  function f:RegisterEvent(ev) self.events[ev] = true end
  function f:UnregisterEvent(ev) self.events[ev] = nil end
  function f:SetScript() end
  return f
end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
function GetTime() return 1000 end
function issecretvalue() return false end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
function date() return "2026-10-29 12:00" end
local group = { "Cheoeqar" }
function UnitName(u)
  if u == "player" then return "Cheoeqar" end
  local i = tonumber(u:match("^raid(%d+)$") or "")
  if i and group[i] then return group[i]:match("^([^%-]+)"), group[i]:match("%-(.+)$") end
  return nil
end
function IsInRaid() return #group > 1 end
function GetNumGroupMembers() return #group end
function UnitIsUnit() return false end
function UnitGroupRolesAssigned() return "HEALER" end
C_Spell = { GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
SOUNDKIT = { RAID_WARNING = 8959 }

local CRT = {
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {} },
    notes = { list = {}, nextId = 1, trustedOnly = true,
      alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3 } },
    alerts = { bars = { shown = true, noteLines = true }, reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end },
  PlaySound = function() return 1 end,
  Print = function() end,
}
for i = 1, #sources, 2 do
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
end
local P, M, Notes, R, NE, A = CRT.NoteParser, CRT.MechNote, CRT.Notes, CRT.AlertReminders, CRT.NoteEngine, CRT.Alerts
assert(P and M and Notes and R and NE and A, "modules exist")

local failed = 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)) failed = failed + 1 end
end
local function reset()
  CRT.db.notes.list = {} CRT.db.notes.nextId = 1 CRT.db.notes.active = nil CRT.db.notes.history = nil
  CRT.db.alerts.reminders = {} CRT.db.alerts.nextId = 1
end
local function count(t) local n = 0 for _ in pairs(t) do n = n + 1 end return n end

-- every panel setting a note line can hold
local FULL = { spellID = 1234, text = "Spread; now", color = { 1, 0, 0, 1 },
  outputs = { alert = true, text = true, icon = false, bar = true, circle = false, timeline = true, speech = true },
  speech = "textcount", speakAt = "zero", glow = true, sound = "RAID_WARNING", warn = 8, linger = 3, iconID = 135940,
  ticks = { 4, 2 }, fill = "up", countTo = "impact", auraSound = true, enabled = true, group = "mythic", priority = "high" }
local TIMES = { { ph = 2, t = 20 }, { ph = 1, t = 96 }, { ph = 1, t = 36.5 }, { t = 10 } }

check("mechnote: the ability's key", function()
  assert(M.Key(1234, "Venomous Emergence") == "1234", "a spell: its ID")
  assert(M.Key(nil, "  Venomous;  Emer:gence ") == "venomous emergence", "no spell: its name in lower case, cleaned: " .. tostring(M.Key(nil, "  Venomous;  Emer:gence ")))
  assert(M.Key(0, "") == nil and M.Key(nil, nil) == nil, "nothing to key")
  assert(M.IsMarked("time:1;text:x;mech:1234;", "1234") and M.IsMarked("time:1;MECH: Venomous Emergence ;", "venomous emergence"), "read in any case and spacing")
  assert(not M.IsMarked("time:1;mech:12345;", "1234") and not M.IsMarked("time:1;text:mech:1234;", "1234"), "only its own field")
end)

check("mechnote: a full reminder becomes one line per time, each field", function()
  local lines = M.Lines(FULL, TIMES, "all", "1234")
  assert(#lines == 4, "four lines: " .. #lines)
  local want = "time:10;ph:1;tag:all;spellid:1234;text:Spread now;colors:1 0 0 1;show:alert,text,bar,timeline;tts:1;ttsat:0;count:1;sound:RAID_WARNING;glow:1;warn:8;linger:3;icon:135940;ticks:2,4;fill:up;countto:impact;prio:high;mech:1234;"
  assert(lines[1] == want, "the first line:\\n" .. lines[1] .. "\\n" .. want)
  -- phase then time order; a time with no phase is phase 1
  local order = {}
  for i, line in ipairs(lines) do local t = P.Parse(line).timers[1] order[i] = t.ph .. "@" .. t.time end
  assert(table.concat(order, " ") == "1@10 1@36.5 1@96 2@20", table.concat(order, " "))
  local t = P.Parse(lines[4]).timers[1]
  assert(t.ph == 2 and t.time == 20 and t.tags[1] == "all" and t.spellId == 1234 and t.text == "Spread now", "time, phase, tag, spell, text")
  assert(t.color[1] == 1 and t.color[2] == 0 and t.show.alert and t.show.text and t.show.bar and t.show.timeline and not t.show.icon and not t.show.circle, "colour and show")
  assert(t.tts and t.count and t.speakAt == "zero" and t.glow and t.sound == "RAID_WARNING", "speech, count, speak at 0, glow, sound")
  assert(t.warn == 8 and t.linger == 3 and t.iconID == 135940, "show from, linger, icon")
  assert(t.ticks and t.ticks[1] == 2 and t.ticks[2] == 4 and t.fill == "up" and t.countTo == "impact", "ticks, fill, count down to")
  assert(t.prio == "high", "priority")
  -- the one mapping: the panel's draft as a note line (Alerts/Draft.lua NoteTimer) gives the same fields
  local D = CRT.AlertDraft
  local viaDraft = D.NoteTimer(nil, D.ForReminder(FULL))
  viaDraft.tags, viaDraft.ph, viaDraft.time, viaDraft.prio = { "all" }, 1, 10, "high"
  assert(P.FormatLine(viaDraft) .. "mech:1234;" == lines[1], "the same as the draft's note line")
  assert(P.Field(lines[4], "mech") == "1234", "the marker")
  assert(not lines[1]:find("aura", 1, true), "the aura sound stays yours")
end)

check("mechnote: defaults write nothing extra, speech choices map", function()
  local plain = M.Lines({ text = "Soak", outputs = { alert = true, bar = true, speech = true }, warn = 5 }, { { ph = 1, t = 30 } }, nil, "soak")[1]
  assert(plain == "time:30;ph:1;tag:all;text:Soak;show:alert,bar;tts:1;warn:5;mech:soak;", plain)
  local countOnly = M.Lines({ text = "x", outputs = { alert = true }, speech = "count", speakAt = "zero" }, { { ph = 1, t = 1 } }, "healer", "x")[1]
  assert(countOnly:find("count:1;", 1, true) and not countOnly:find("tts:", 1, true) and not countOnly:find("ttsat", 1, true), "count alone: " .. countOnly)
  assert(countOnly:find("tag:healer;", 1, true), "a role tag")
  local quiet = M.Lines({ text = "x", outputs = { alert = true, speech = false } }, { { ph = 1, t = 1 } }, "Abu Cheo", "x")[1]
  assert(not quiet:find("tts:", 1, true) and not quiet:find("count:", 1, true) and quiet:find("tag:Abu Cheo;", 1, true), quiet)
  -- a shield bar: shield: written, its ticks and fill left off
  local sh = M.Lines({ text = "Break", outputs = { bar = true }, absorb = { unit = "boss2", length = 15, anyDifficulty = true },
    ticks = { 2 }, fill = "up", countTo = "impact" }, { { ph = 1, t = 5 } }, "all", "b")[1]
  assert(sh:find("shield:boss2,15,any;", 1, true) and not sh:find("ticks", 1, true) and not sh:find("fill", 1, true) and not sh:find("countto", 1, true), sh)
  -- count down to needs ticks
  local nt = M.Lines({ text = "x", outputs = { bar = true }, countTo = "impact" }, { { ph = 1, t = 5 } }, "all", "x")[1]
  assert(not nt:find("countto", 1, true), nt)
  assert(#M.Lines(FULL, {}, "all", "1234") == 0, "no times, no lines")
end)

check("mechnote: For tags", function()
  assert(table.concat(M.TagWords(nil), " ") == "all" and table.concat(M.TagWords(" "), " ") == "all", "nothing is everyone")
  assert(M.IsRole("all") and M.IsRole("Healer") and M.IsRole("melee") and not M.IsRole("Abu") and not M.IsRole("Abu Cheo"), "roles")
  local tag = M.TogglePlayer("all", "Abu")
  assert(tag == "Abu", "a player replaces a role: " .. tag)
  tag = M.TogglePlayer(tag, "Cheo-Realm")
  assert(tag == "Abu Cheo-Realm" and M.HasPlayer(tag, "cheo-realm") and M.HasPlayer(tag, "Abu"), tag)
  tag = M.TogglePlayer(tag, "abu")
  assert(tag == "Cheo-Realm", "taken out in any case: " .. tag)
  assert(M.TogglePlayer(tag, "Cheo-Realm") == "all", "the last one out leaves everyone")
  assert(not M.HasPlayer("healer", "healer"), "a role names no player")
  -- the players offered: you and your raid, with realms, once each
  group = { "Cheoeqar", "Abu-Other", "Zed" }
  local names = M.GroupNames()
  assert(table.concat(names, ",") == "Abu-Other,Cheoeqar,Zed", table.concat(names, ","))
  group = { "Cheoeqar" }
  assert(table.concat(M.GroupNames(), ",") == "Cheoeqar", "solo: you")
end)

check("mechnote: replace and remove touch only the marked lines", function()
  local raw = "EncounterID:3470;Difficulty:Mythic;Name:Boss\\r\\nFree text; keep\\r\\ntime:5;text:Other;\\r\\n" ..
    "time:10;text:Old;mech:1234;\\r\\ntime:20;text:Old;mech:1234;\\r\\ntime:30;text:Mine;mech:999;\\r\\nlast line"
  local new = M.Replace(raw, "1234", { "time:11;text:A;mech:1234;", "time:21;text:B;mech:1234;", "time:31;text:C;mech:1234;" })
  assert(new == "EncounterID:3470;Difficulty:Mythic;Name:Boss\\r\\nFree text; keep\\r\\ntime:5;text:Other;\\r\\n" ..
    "time:11;text:A;mech:1234;\\r\\ntime:21;text:B;mech:1234;\\r\\ntime:31;text:C;mech:1234;\\r\\ntime:30;text:Mine;mech:999;\\r\\nlast line", "in place, CRLF kept:\\n" .. new)
  assert(M.Count(new, "1234") == 3 and M.Count(new, "999") == 1, "counts")
  assert(M.Replace(new, "1234", { "time:11;text:A;mech:1234;", "time:21;text:B;mech:1234;", "time:31;text:C;mech:1234;" }) == new, "the same lines again change nothing")
  local gone = M.Replace(new, "1234", {})
  assert(gone == "EncounterID:3470;Difficulty:Mythic;Name:Boss\\r\\nFree text; keep\\r\\ntime:5;text:Other;\\r\\ntime:30;text:Mine;mech:999;\\r\\nlast line", "removed:\\n" .. gone)
  assert(M.Count(gone, "1234") == 0, "none left")
  -- none there yet: at the end, after a newline in the note's style
  assert(M.Replace("A\\nB", "k", { "L1", "L2" }) == "A\\nB\\nL1\\nL2", M.Replace("A\\nB", "k", { "L1", "L2" }))
  assert(M.Replace("A\\nB\\n", "k", { "L1" }) == "A\\nB\\nL1\\n", "before a trailing newline")
  assert(M.Replace("", "k", { "L1" }) == "L1", "an empty note")
  assert(M.Replace("A\\ntime:1;mech:k;", "k", {}) == "A\\n", "the last line taken out")
  assert(M.Replace("A\\ntime:1;mech:k;", "k", { "time:2;mech:k;" }) == "A\\ntime:2;mech:k;", "the last line replaced, no newline added")
  assert(M.Replace("A\\nB", "k", {}) == "A\\nB", "nothing marked, nothing to take out")
end)

check("mechnote: a missing note is made, named after the boss; the active note stays", function()
  reset()
  local other = Notes:Import("EncounterID:5000;Difficulty:Mythic;Name:Elsewhere\\ntime:1;text:x;")
  Notes:SetActive(other)
  local lines = M.Lines(FULL, { { ph = 1, t = 36 }, { ph = 1, t = 97 } }, "all", "1234")
  local id, n = M.Write(3470, "Mythic", "The Twin Fangs", "1234", lines)
  assert(id and id ~= other and n == 2, "a new note: " .. tostring(id))
  local rec = Notes:Get(id)
  assert(rec.raw == "EncounterID:3470;Difficulty:Mythic;Name:The Twin Fangs\\n" .. lines[1] .. "\\n" .. lines[2] .. "\\n", rec.raw)
  assert(rec.name == "The Twin Fangs" and rec.difficulty == "Mythic" and rec.encounterID == 3470 and not rec.personal, "its record")
  assert(rec.via == "Mech Alerts", "made here: " .. tostring(rec.via))
  assert(Notes:Active() == other, "the active note is unchanged")
  assert(Notes:FindForEncounter(3470, "Mythic") == id and #Notes:Parsed(id).timers == 2, "the note a Mythic pull reads")
  assert(M.CountIn(3470, "Mythic", "1234") == 2 and M.CountIn(3470, "Heroic", "1234") == 0, "counted for its difficulty only")
  -- no lines and no note: nothing made
  local before = count(CRT.db.notes.list)
  assert(M.Write(3999, "Mythic", "None", "1234", {}) == nil and count(CRT.db.notes.list) == before, "nothing made to hold nothing")
end)

check("mechnote: a note with an EncounterID header keeps it and its other lines", function()
  reset()
  local raw = "EncounterID:3470;Difficulty:Mythic;Name:Fangs\\nTanks: Abu, Cheo\\ntime:30;tag:Abu;spellid:55;\\n"
  local id = Notes:Import(raw)
  local lines = M.Lines(FULL, { { ph = 1, t = 36 } }, "healer", "1234")
  assert(M.Write(3470, "mythic", "Ignored", "1234", lines) == id, "the boss's Mythic note, any case")
  assert(Notes:Get(id).raw == raw .. lines[1] .. "\\n", Notes:Get(id).raw)
  assert(Notes:Get(id).name == "Fangs" and Notes:Get(id).encounterID == 3470, "the header kept")
  assert(Notes:History(id)[1] and Notes:History(id)[1].lines == true, "kept in its history as a line change")
  -- written again: replaced, never added twice
  local again = M.Lines(FULL, { { ph = 1, t = 40 } }, "healer", "1234")
  M.Write(3470, "Mythic", nil, "1234", again)
  assert(Notes:Get(id).raw == raw .. again[1] .. "\\n" and M.CountIn(3470, "Mythic", "1234") == 1, "no duplicates")
  -- a note for any difficulty is never written (Mythic times would run on a Heroic pull): a Mythic note is made
  local anyId = Notes:Import("EncounterID:3480;Name:Loose\\nfree")
  local loose = M.Write(3480, "Mythic", "Loose", "k", { "time:1;mech:k;" })
  assert(loose and loose ~= anyId and Notes:Get(anyId).raw == "EncounterID:3480;Name:Loose\\nfree", "the any-difficulty note untouched")
  assert(Notes:Get(loose).difficulty == "Mythic" and Notes:FindForEncounter(3480, "Mythic") == loose, "a Mythic pull reads the new Mythic note")
  -- (a Heroic pull, with no Heroic note, falls back to the boss's newest note of any difficulty: Notes:FindForEncounter,
  -- unchanged here)
  -- a Heroic note only: a Mythic note is made, the Heroic one untouched
  local h = Notes:Import("EncounterID:3490;Difficulty:Heroic;Name:H\\ntime:1;text:x;")
  local m = M.Write(3490, "Mythic", "H", "k", { "time:1;mech:k;" })
  assert(m and m ~= h and Notes:Get(h).raw == "EncounterID:3490;Difficulty:Heroic;Name:H\\ntime:1;text:x;" and Notes:Get(m).difficulty == "Mythic", "a Mythic note of its own")
  assert(M.NoteDifficulty({ difficulty = "Heroic" }, "nh") == "Heroic" and M.NoteDifficulty(nil, "mythic") == "Mythic" and M.NoteDifficulty({}, "nh") == "Heroic", "the note's Difficulty")
end)

check("mechnote: Sync follows the reminder; turned off or Only me takes the lines out", function()
  reset()
  local r = {}
  for k, v in pairs(FULL) do r[k] = v end
  r.spellID, r.times, r.boss = nil, "P1 0:36, 1:37, 3:11; P2 0:20", "The Twin Fangs"
  r.raidNote = { tag = "all", key = "spread" }
  local id = R:Save(3470, nil, r, "mythic")
  local nid, n = M.Sync(3470, id, { group = "mythic" })
  assert(nid and n == 4, "four times, four lines: " .. tostring(n))
  assert(R:Get(3470, id).raidNote.difficulty == "Mythic", "the difficulty the lines went to is kept")
  local timers = Notes:Parsed(nid).timers
  assert(#timers == 4 and timers[4].ph == 2 and timers[4].time == 20, "phase 2 kept")
  -- a change: rewritten in place
  local saved = R:Get(3470, id)
  saved.text, saved.raidNote.tag = "Spread out", "healer"
  M.Sync(3470, id, { group = "mythic" })
  timers = Notes:Parsed(nid).timers
  assert(#timers == 4 and timers[1].text == "Spread out" and timers[1].tags[1] == "healer", "the four lines changed, none added")
  -- Times from on a Heroic ability timeline: the lines move to the Heroic note
  local hid = M.Sync(3470, id, { group = "nh", ref = { difficulty = "Heroic" } })
  assert(hid ~= nid and M.CountIn(3470, "Mythic", "spread") == 0 and M.CountIn(3470, "Heroic", "spread") == 4, "moved")
  M.Sync(3470, id, { group = "mythic", ref = { difficulty = "Mythic" } })
  assert(M.CountIn(3470, "Heroic", "spread") == 0 and M.CountIn(3470, "Mythic", "spread") == 4, "and back")
  -- turned off: taken out
  R:Get(3470, id).enabled = false
  M.Sync(3470, id, { group = "mythic" })
  assert(M.CountIn(3470, "Mythic", "spread") == 0 and Notes:Get(nid).raw:find("EncounterID:3470", 1, true), "off: out, the note stays")
  R:Get(3470, id).enabled = true
  M.Sync(3470, id, { group = "mythic" })
  assert(M.CountIn(3470, "Mythic", "spread") == 4, "on again")
  -- Only me: Leave takes them out
  assert(M.Leave(3470, R:Get(3470, id)) == 4 and M.CountIn(3470, "Mythic", "spread") == 0, "left")
  local plain = R:Save(3470, nil, { text = "x", times = "P1 0:10" }, "mythic")
  assert(M.Sync(3470, plain, { group = "mythic" }) == nil and M.Leave(3470, R:Get(3470, plain)) == 0, "Only me has nothing in the note")
end)

check("mechnote: InStep tells a note out of date; Sync with no ability timeline keeps the note's difficulty", function()
  reset()
  local id = R:Save(3470, nil, { text = "Spread", times = "P1 0:36, 1:37", outputs = { alert = true }, raidNote = { tag = "all", key = "spread" } }, "nh")
  M.Sync(3470, id, { group = "nh", ref = { difficulty = "Normal" } })
  assert(M.CountIn(3470, "Normal", "spread") == 2 and M.InStep(3470, id, { group = "nh", ref = { difficulty = "Normal" } }), "in step")
  -- an import or another client: no ref, the note it went to
  assert(M.InStep(3470, id, { group = "nh" }), "no ref: the Normal note, in step")
  R:Get(3470, id).text = "Spread out"
  assert(not M.InStep(3470, id, { group = "nh" }), "changed: out of step")
  M.Sync(3470, id, { group = "nh" })
  assert(M.InStep(3470, id, { group = "nh" }) and M.CountIn(3470, "Normal", "spread") == 2 and M.CountIn(3470, "Heroic", "spread") == 0, "written into the Normal note again")
  -- the note replaced by a share: out of step
  local nid = M.FindNote(3470, "Normal")
  Notes:UpdateRaw(nid, "EncounterID:3470;Difficulty:Normal;Name:B\\n")
  assert(not M.InStep(3470, id, { group = "nh" }), "lines gone: out of step")
  assert(M.InStep(3470, R:Save(3470, nil, { text = "x", times = "P1 0:01" }, "nh"), {}), "Only me: nothing to be in step with")
end)

check("mechnote: two reminders that would share a marker each get their own", function()
  reset()
  -- the ability row and your own reminder on the same spell
  local a = R:Save(3470, nil, { spellID = 1234, text = "Row", times = "P1 0:10", raidNote = { tag = "all", key = "1234" } }, "mythic")
  local b = R:Save(3470, nil, { spellID = 1234, text = "Mine", times = "P1 0:20", raidNote = { tag = "all", key = "1234" } }, "mythic")
  M.Sync(3470, a, { group = "mythic" })
  M.Sync(3470, b, { group = "mythic" })
  local ka, kb = R:Get(3470, a).raidNote.key, R:Get(3470, b).raidNote.key
  assert(ka ~= kb, "own markers: " .. ka .. ", " .. kb)
  assert(M.CountIn(3470, "Mythic", ka) == 1 and M.CountIn(3470, "Mythic", kb) == 1, "one line each")
  -- a change to one leaves the other's line alone
  R:Get(3470, a).text = "Row changed"
  M.Sync(3470, a, { group = "mythic" })
  local raw = Notes:Get(M.FindNote(3470, "Mythic")).raw
  assert(raw:find("text:Row changed;", 1, true) and raw:find("text:Mine;", 1, true), raw)
  assert(M.Leave(3470, R:Get(3470, b)) == 1 and M.CountIn(3470, "Mythic", ka) == 1, "Only me on one keeps the other's")
  -- two spell-less reminders with the same text
  local c = R:Save(3470, nil, { text = "Soak", times = "P1 0:30", raidNote = { tag = "all", key = M.Key(nil, "Soak") } }, "mythic")
  local d = R:Save(3470, nil, { text = "Soak", times = "P1 0:40", raidNote = { tag = "all", key = M.Key(nil, "Soak") } }, "mythic")
  M.Sync(3470, c, { group = "mythic" }) M.Sync(3470, d, { group = "mythic" })
  local kc, kd = R:Get(3470, c).raidNote.key, R:Get(3470, d).raidNote.key
  assert(kc ~= kd, "the same text, two markers")
  assert(M.CountIn(3470, "Mythic", kc) == 1 and M.CountIn(3470, "Mythic", kd) == 1, "one line each")
end)

-- Two saved reminders with the same marker (Reminders.SplitOne copies an older reminder's raidNote into both halves):
-- the lowest id keeps it, the other moves to its own, and the note never holds a line twice
check("mechnote: a shared marker is untangled without duplicate lines; the lowest id keeps it", function()
  reset()
  local old = R:Save(3470, nil, { text = "Spread", times = "P1 0:36, 1:37", outputs = { alert = true },
    raidNote = { tag = "all", key = "spread", difficulty = "Mythic" } })
  CRT.db.alerts.reminders[3470][old].group = nil -- an older reminder on any difficulty
  local ids = R.SplitOne(3470, old)
  local a, b = ids.nh, ids.mythic
  assert(a < b and R:Get(3470, a).raidNote.key == "spread" and R:Get(3470, b).raidNote.key == "spread", "both halves carry the marker")
  -- the Mythic half was changed and written under the shared marker before the untangling
  R:Get(3470, b).text = "Spread B"
  local raw0 = "EncounterID:3470;Difficulty:Mythic;Name:B\\n" .. table.concat(M.Lines(R:Get(3470, b), { { ph = 1, t = 36 }, { ph = 1, t = 97 } }, "all", "spread"), "\\n")
  Notes:Import(raw0)
  -- the higher id synced first: it moves to its own marker, the lower keeps "spread" and its lines
  M.Sync(3470, b, { group = "mythic" })
  assert(R:Get(3470, b).raidNote.key == "spread#" .. b and R:Get(3470, a).raidNote.key == "spread", "the lowest id keeps the bare marker")
  local raw = Notes:Get(M.FindNote(3470, "Mythic")).raw
  -- no alert's line twice, whatever its marker
  local seen = {}
  for line in (raw .. "\\n"):gmatch("(.-)\\n") do
    local bare = line:gsub("mech:[^;]*;", "")
    assert(not seen[bare], "a line twice: " .. line .. "\\n" .. raw)
    seen[bare] = true
  end
  assert(select(2, raw:gsub("text:Spread B;", "")) == 2 and select(2, raw:gsub("text:Spread;", "")) == 2, raw)
  assert(M.CountIn(3470, "Mythic", "spread") == 2 and M.CountIn(3470, "Mythic", "spread#" .. b) == 2, "two lines each:\\n" .. raw)
  -- synced again either way round: nothing changes
  M.Sync(3470, a, { group = "mythic" }) M.Sync(3470, b, { group = "mythic" })
  assert(Notes:Get(M.FindNote(3470, "Mythic")).raw == raw, "stable")
  -- the lower id synced first in a fresh tangle: the same result
  R:Get(3470, b).raidNote.key = "spread"
  M.Sync(3470, a, { group = "mythic" })
  assert(R:Get(3470, a).raidNote.key == "spread" and R:Get(3470, b).raidNote.key == "spread#" .. b, "lower first: the same markers")
  assert(M.CountIn(3470, "Mythic", "spread") == 2 and M.CountIn(3470, "Mythic", "spread#" .. b) == 2, "two lines each")
end)

check("notes: Busy is combat or a boss encounter, read safely", function()
  local wasCombat, wasEnc, wasC = InCombatLockdown, IsEncounterInProgress, C_InstanceEncounter
  InCombatLockdown = function() return false end
  IsEncounterInProgress, C_InstanceEncounter = nil, nil
  assert(Notes.Busy() == false, "neither")
  IsEncounterInProgress = function() return true end
  assert(Notes.Busy() == true, "an encounter (the older global)")
  C_InstanceEncounter = { IsEncounterInProgress = function() return false end }
  assert(Notes.Busy() == false, "the namespaced call wins")
  C_InstanceEncounter = { IsEncounterInProgress = function() error("no") end }
  assert(Notes.Busy() == false, "an error counts as no")
  InCombatLockdown = function() return true end
  assert(Notes.Busy() == true, "combat")
  InCombatLockdown, IsEncounterInProgress, C_InstanceEncounter = wasCombat, wasEnc, wasC
end)

check("note fields: prio: high or low ranks a note line; older CRTs keep it", function()
  local t = P.Parse("time:5;text:x;show:alert;prio:HIGH;").timers[1]
  assert(t.prio == "high" and P.FormatLine(t):find("prio:high;", 1, true), "read and written")
  assert(P.Parse("time:5;text:x;prio:urgent;").timers[1].prio == nil, "anything else is none")
  assert(NE.ItemFor(t, 1, true).priority == CRT.AlertRules.Priority(2, "high"), "a high note line")
  assert(NE.ItemFor(P.Parse("time:5;text:x;").timers[1], 1, true).priority == CRT.AlertRules.Priority(2, "normal"), "normal by default")
  assert(not M.Lines({ text = "x", outputs = { alert = true }, priority = "normal" }, { { ph = 1, t = 1 } }, "all", "x")[1]:find("prio", 1, true), "normal writes nothing")
end)

check("mechnote: your own alerts step aside while the alert is in the raid note", function()
  reset()
  local id = R:Save(3470, nil, { text = "Spread", times = "P1 0:36", raidNote = { tag = "all", key = "spread", difficulty = "Mythic" } }, "mythic")
  local other = R:Save(3470, nil, { text = "Mine", times = "P1 0:50" }, "mythic")
  local run = { encounterID = 3470, anyDifficulty = true }
  local ids = {}
  for _, it in ipairs(A.blocks.mine.Entries(run)) do ids[#ids + 1] = it.id end
  assert(table.concat(ids, ",") == "mine:" .. other .. ":1", "only the Only me one runs: " .. table.concat(ids, ","))
  R:Get(3470, id).raidNote = nil
  assert(#A.blocks.mine.Entries(run) == 2, "Only me again: it runs")
end)

check("note fields: ticks, fill and count down to run on a note line's bar", function()
  local line = "time:30;ph:1;tag:all;text:Soak;show:bar;warn:8;ticks:2, 4;fill:UP;countto:Impact;mech:1;"
  local t = P.Parse(line).timers[1]
  assert(t.ticks and #t.ticks == 2 and t.ticks[1] == 2 and t.fill == "up" and t.countTo == "impact", "read")
  assert(P.FormatLine(t) == "time:30;ph:1;tag:all;text:Soak;show:bar;warn:8;ticks:2,4;fill:up;countto:impact;", P.FormatLine(t))
  assert(P.UnknownFields(line) == "mech:1;", "the new fields are known, the marker rides along: " .. P.UnknownFields(line))
  for _, bad in ipairs({ "ticks:x;", "ticks:-2;", "ticks:;", "fill:down;", "countto:cast;" }) do
    local b = P.Parse("time:1;text:x;" .. bad).timers[1]
    assert(b and b.time == 1 and b.ticks == nil and b.fill == nil and b.countTo == nil, bad .. " reads as none")
  end
  local item = NE.ItemFor(t, 1, true)
  assert(item.warn == 8 and item.barStart == -8 and item.barEnd == 0, "a bar from Show from to the cast")
  assert(item.ticks and item.ticks[1] == -6 and item.ticks[2] == -4, "ticks as seconds after the cast")
  assert(item.fill == "up" and item.countTo == "impact", "fill and count down to")
  local past = NE.ItemFor(P.Parse("time:30;text:x;show:bar;warn:3;ticks:5;").timers[1], 1, true)
  assert(past.ticks == nil and past.barStart == nil, "a tick past the bar changes nothing")
  local shield = NE.ItemFor(P.Parse("time:30;text:x;show:bar;warn:8;ticks:2;fill:up;shield:boss1,10;").timers[1], 1, true)
  assert(shield.ticks == nil and shield.absorb, "a shield bar has no ticks")
  local plain = NE.ItemFor(P.Parse("time:30;text:x;").timers[1], 1, true)
  assert(plain.ticks == nil and plain.fill == nil, "a line without show: as before")
  local others = NE.ItemFor(t, 1, false)
  assert(others.ticks == nil, "someone else's line carries no outputs")
end)

-- A raider on an older CRT (the v1.1.5 parser, old_Parse.lua) reads a Mech Alerts line as any timed line, and writing
-- it back keeps the marker and the new fields (UnknownFields), so the panel still finds it.
check("mechnote: an older CRT reads the lines and keeps the marker", function()
  local Old = {}
  assert(load(OLD_PARSE, "@old_Parse.lua"))("CowfeeRaidTools", Old)
  local line = M.Lines(FULL, { { ph = 1, t = 36 } }, "all", "1234")[1]
  local t = Old.NoteParser.Parse(line).timers[1]
  assert(t and t.time == 36 and t.ph == 1 and t.spellId == 1234 and t.text == "Spread now" and t.show.bar and t.tts and t.warn == 8, "the same timer")
  local kept = Old.NoteParser.UnknownFields(line)
  assert(kept:find("mech:1234;", 1, true) and kept:find("prio:high;", 1, true) and kept:find("ticks:2,4;", 1, true) and kept:find("fill:up;", 1, true) and kept:find("countto:impact;", 1, true), kept)
  t.time = 40
  local rewritten = Old.NoteParser.FormatLine(t) .. kept
  assert(M.IsMarked(rewritten, "1234"), "still marked")
  local back = P.Parse(rewritten).timers[1]
  assert(back.time == 40 and back.ticks[2] == 4 and back.fill == "up", "the fields survive")
end)

check("no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)
if failed > 0 then error(failed .. " failed") end
`;
const W = process.argv[2];
if (!W) { console.error('usage: node run_mechnote.js <addon folder>'); process.exit(2); }
const names = ['CRT_Modules/Timeline/Data.lua', 'CRT_Modules/Timeline/Database.lua', 'CRT_Modules/Timeline/Reference.lua',
  'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua',
  'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/Engine.lua', 'CRT_Modules/Alerts/Reminders.lua',
  'CRT_Core/Sound/Engine.lua', 'CRT_Modules/Alerts/Draft.lua', 'CRT_Modules/Notes/MechNote.lua'];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(__dirname, 'old_Parse.lua'), 'utf8')));
lua.lua_setglobal(L, to_luastring('OLD_PARSE'));
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, names.length * 2 + 2);
for (const n of names) { lua.lua_pushstring(L, to_luastring(n)); lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, n), 'utf8'))); }
if (lua.lua_pcall(L, names.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
