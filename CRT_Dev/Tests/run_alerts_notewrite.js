// Alerts stage 2a Task 7: add, replace and remove one raid note line (Notes:AddLine/ReplaceLine/RemoveLine/TimerAt).
// Usage: node run_alerts_notewrite.js CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
function InCombatLockdown() return false end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-16 12:00" end
C_Spell = { GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
local fired = 0
local CRT = { db = { notes = { list = {}, nextId = 1, trustedOnly = true } } }
for i = 1, #sources, 2 do
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
end
local P, Notes = CRT.NoteParser, CRT.Notes
assert(P and Notes, "modules exist")
Notes:OnChange(function() fired = fired + 1 end)

local checks = {}
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)); checks.failed = (checks.failed or 0) + 1 end
end
local function reset() CRT.db.notes.list = {}; CRT.db.notes.nextId = 1; CRT.db.notes.active = nil end
local function put(raw) reset(); local id = Notes:Import(raw); assert(id, "imported"); return id end
local L1 = "time:10;ph:1;text:Soak;"
local L2 = "time:20;ph:1;spellid:1234;tag:Tank;"

check("notes: add, replace, remove one line", function()
  reset()
  -- no note for the boss yet: one is made with the header, then the line is edited and deleted
  local id, n = Notes:AddLine(3000, "Mythic", "Boss", L1)
  assert(id and n == 2, "new note id and line 2, got " .. tostring(id) .. "," .. tostring(n))
  assert(Notes:Get(id).raw == "EncounterID:3000;Difficulty:Mythic;Name:Boss\\n" .. L1, "raw is header + line")
  assert(Notes:Get(id).encounterID == 3000 and Notes:Get(id).difficulty == "Mythic" and Notes:Get(id).name == "Boss", "record fields")
  local t, raw = Notes:TimerAt(id, 2)
  assert(t and t.time == 10 and t.text == "Soak" and raw == L1, "TimerAt loads the line")
  -- a second line goes onto the same note
  local id2, n2 = Notes:AddLine(3000, "Mythic", "Boss", L2)
  assert(id2 == id and n2 == 3, "second add: same note, line 3")
  assert(Notes:TimerAt(id, 3).spellId == 1234, "second line parsed")
  assert(Notes:Parsed(id).timers[1].line == 2 and Notes:Parsed(id).timers[2].line == 3, "parser agrees on numbers")
  -- replace the first line only
  local f = fired
  assert(Notes:ReplaceLine(id, 2, "time:12;ph:1;text:Move;", L1) == true, "replace ok")
  assert(fired > f, "UpdateRaw fires")
  assert(Notes:Get(id).raw == "EncounterID:3000;Difficulty:Mythic;Name:Boss\\ntime:12;ph:1;text:Move;\\n" .. L2, "only that line changed")
  assert(Notes:TimerAt(id, 2).time == 12, "re-parsed")
  -- remove it
  assert(Notes:RemoveLine(id, 2, "time:12;ph:1;text:Move;") == true, "remove ok")
  assert(Notes:Get(id).raw == "EncounterID:3000;Difficulty:Mythic;Name:Boss\\n" .. L2, "only that line removed")
  assert(#Notes:Parsed(id).timers == 1 and Notes:Parsed(id).timers[1].line == 2, "renumbered")
  -- a non-timed line has no timer; out-of-range is nil
  assert(Notes:TimerAt(id, 1) == nil and Notes:TimerAt(id, 9) == nil and Notes:TimerAt(99, 1) == nil, "TimerAt nil")
end)

check("notes: add makes a note with header", function()
  reset()
  local id, n = Notes:AddLine(3001, nil, "Other", L1)
  assert(Notes:Get(id).raw == "EncounterID:3001;Name:Other\\n" .. L1 and n == 2, "no Difficulty when nil: " .. Notes:Get(id).raw)
  assert(CRT.db.notes.list[id] and Notes:List()[1].id == id, "in the list")
  assert(Notes:Parsed(id).timers[1].line == 2, "parsed")
  -- (S18) a Heroic add while the boss has only this note goes to it: it is the note a Heroic pull reads
  local id2, n2 = Notes:AddLine(3001, "Heroic", "Other", L2)
  assert(id2 == id and n2 == 3 and Notes:FindForEncounter(3001, "Heroic") == id, "no second note: " .. tostring(id2))
  assert(Notes:Get(id).raw == "EncounterID:3001;Name:Other\\n" .. L1 .. "\\n" .. L2, Notes:Get(id).raw)
  local count = 0
  for _ in pairs(CRT.db.notes.list) do count = count + 1 end
  assert(count == 1, "still one note")
  -- an existing note without a trailing newline gets one before the line
  local a = put("EncounterID:5;Name:A\\ntime:1;text:x;")
  local ida, na = Notes:AddLine(5, nil, "A", L1)
  assert(ida == a and na == 3 and Notes:Get(a).raw == "EncounterID:5;Name:A\\ntime:1;text:x;\\n" .. L1, "newline added")
  -- with a trailing newline the line goes straight after it
  local b = put("EncounterID:6;Name:B\\ntime:1;text:x;\\n")
  local idb, nb = Notes:AddLine(6, nil, "B", L1)
  assert(Notes:Get(b).raw == "EncounterID:6;Name:B\\ntime:1;text:x;\\n" .. L1 and nb == 3, "no blank line: " .. Notes:Get(b).raw)
  -- CRLF notes get CRLF
  local c = put("EncounterID:7;Name:C\\r\\ntime:1;text:x;")
  local _, nc = Notes:AddLine(7, nil, "C", L1)
  assert(Notes:Get(c).raw == "EncounterID:7;Name:C\\r\\ntime:1;text:x;\\r\\n" .. L1 and nc == 3, "crlf kept")
  assert(Notes:Parsed(c).timers[2].line == 3, "parser line 3")
  -- a newline in the line is refused
  assert(Notes:AddLine(7, nil, "C", "a\\nb") == nil, "multi-line refused")
end)

check("notes: two difficulties saved: a Mythic add goes to the Mythic note", function()
  reset()
  -- (S18) two notes saved by Import, since an add no longer makes a second note for a boss
  local h = Notes:Import("EncounterID:3100;Difficulty:Heroic;Name:Boss\\n" .. L1)
  local m = Notes:Import("EncounterID:3100;Difficulty:Mythic;Name:Boss\\n" .. L1)
  assert(h and m and h ~= m, "two notes")
  local m2, n = Notes:AddLine(3100, "Mythic", "Boss", L2)
  assert(m2 == m and n == 3, "Mythic add went to the Mythic note")
  assert(Notes:Get(h).raw == "EncounterID:3100;Difficulty:Heroic;Name:Boss\\n" .. L1, "Heroic untouched")
  assert(Notes:AddLine(3100, "heroic", "Boss", L2) == h, "case-insensitive match")
  -- no difficulty, or one with no note: the note such a pull falls back to, never a new one
  assert(Notes:AddLine(3100, nil, "Boss", L1) == Notes:FindForEncounter(3100, nil), "nil goes to the fallback")
  assert(Notes:AddLine(3100, "Normal", "Boss", L1) == Notes:FindForEncounter(3100, "Normal"), "Normal goes to the fallback")
  local count = 0
  for _ in pairs(CRT.db.notes.list) do count = count + 1 end
  assert(count == 2, "still two notes")
end)

check("notes: a line goes where the pull reads it", function()
  reset()
  local h = Notes:Import("EncounterID:3300;Difficulty:Heroic;Name:Boss\\n" .. L1)
  -- a Mythic add with only a Heroic note: a Mythic pull runs the Heroic note, so the line goes there
  local id, n = Notes:AddLine(3300, "Mythic", "Boss", L2)
  assert(id == h and n == 3 and Notes:FindForEncounter(3300, "Mythic") == h, "Mythic add went to the Heroic note")
  assert(Notes:Get(h).difficulty == "Heroic" and Notes:TimerAt(h, 3).spellId == 1234, "Heroic note keeps its header")
  -- a boss with no note at all gets one
  local new, n2 = Notes:AddLine(3301, "Mythic", "Fresh", L1)
  assert(new ~= h and n2 == 2 and Notes:Get(new).difficulty == "Mythic", "new note for a boss with none")
  -- header words are trimmed and lose line ends and semicolons
  local w = Notes:AddLine(3200, "My;th\\nic", "Bo;ss\\r", L1)
  assert(Notes:Get(w).raw == "EncounterID:3200;Difficulty:Mythic;Name:Boss\\n" .. L1, Notes:Get(w).raw)
  local t = Notes:AddLine(3201, "  Heroic ", " Boss  ", L1)
  assert(Notes:Get(t).raw == "EncounterID:3201;Difficulty:Heroic;Name:Boss\\n" .. L1, "trimmed: " .. Notes:Get(t).raw)
  assert(Notes:AddLine(3201, " heroic", "Boss", L2) == t, "a trimmed difficulty finds the note")
end)

check("notes: header and free text lines can't be edited through line calls", function()
  local id = put("EncounterID:11;Name:G\\nfree\\n" .. L1)
  local before = Notes:Get(id).raw
  assert(Notes:ReplaceLine(id, 1, "EncounterID:12;Name:X") == false and Notes:RemoveLine(id, 1) == false, "header")
  assert(Notes:ReplaceLine(id, 2, "time:1;text:a;") == false and Notes:RemoveLine(id, 2) == false, "free text")
  assert(Notes:Get(id).raw == before, "unchanged")
  assert(Notes:ReplaceLine(id, 3, "time:2;text:b;") == true)
end)

check("notes: replace keeps other lines byte for byte", function()
  local raw = "EncounterID:8;Name:D\\r\\n\\r\\nfree text  \\ntime:1;text:a;\\r\\n   \\ntime:2;text:b;\\n\\n"
  local id = put(raw)
  local t = Notes:Parsed(id).timers
  assert(t[1].line == 4 and t[2].line == 6, "lines count blanks: " .. t[1].line .. "," .. t[2].line)
  assert(Notes:ReplaceLine(id, 4, "time:3;text:c;", "time:1;text:a;"))
  assert(Notes:Get(id).raw == "EncounterID:8;Name:D\\r\\n\\r\\nfree text  \\ntime:3;text:c;\\r\\n   \\ntime:2;text:b;\\n\\n", "CRLF/LF/blank/trailing kept")
  assert(Notes:ReplaceLine(id, 6, "time:9;text:z;"), "no expected given")
  assert(Notes:Get(id).raw == "EncounterID:8;Name:D\\r\\n\\r\\nfree text  \\ntime:3;text:c;\\r\\n   \\ntime:9;text:z;\\n\\n", "second")
  -- remove keeps the rest, including the trailing newline state
  assert(Notes:RemoveLine(id, 4))
  assert(Notes:Get(id).raw == "EncounterID:8;Name:D\\r\\n\\r\\nfree text  \\n   \\ntime:9;text:z;\\n\\n", "removed with its own end")
  -- no trailing newline stays absent after a replace of the last line
  local id2 = put("EncounterID:9;Name:E\\ntime:1;text:a;")
  assert(Notes:ReplaceLine(id2, 2, "time:2;text:b;"))
  assert(Notes:Get(id2).raw == "EncounterID:9;Name:E\\ntime:2;text:b;", "no newline added")
  -- removing an unterminated last line leaves the line before as it was
  assert(Notes:RemoveLine(id2, 2))
  assert(Notes:Get(id2).raw == "EncounterID:9;Name:E\\n", "previous end kept")
end)

check("notes: stale line number is refused", function()
  local id = put("EncounterID:10;Name:F\\n" .. L1 .. "\\n" .. L2 .. "\\n")
  local t, loaded = Notes:TimerAt(id, 2)
  assert(loaded == L1)
  -- someone else edits the note (a pasted import) so line 2 is now another line
  Notes:UpdateRaw(id, "EncounterID:10;Name:F\\n" .. L2 .. "\\n" .. L1 .. "\\n")
  local before, f = Notes:Get(id).raw, fired
  assert(Notes:ReplaceLine(id, 2, "time:99;text:no;", loaded) == false, "replace refused")
  assert(Notes:RemoveLine(id, 2, loaded) == false, "remove refused")
  assert(Notes:Get(id).raw == before and fired == f, "nothing changed, nothing fired")
  -- out of range and unknown notes
  assert(Notes:ReplaceLine(id, 40, "time:1;text:x;") == false and Notes:RemoveLine(id, 0) == false and Notes:RemoveLine(77, 1) == false, "bad targets")
  assert(Notes:ReplaceLine(id, 2, "a\\nb") == false, "multi-line refused")
  assert(Notes:Get(id).raw == before, "still unchanged")
  -- the right expected line works
  assert(Notes:RemoveLine(id, 2, L2) == true)
end)

check("notes: fields FormatLine doesn't know are kept", function()
  local raw = "time:48;ph:1;tag:Abu;text:Go in;dur:8;colors:0 1 1 1;DisplayType:Text; Custom : a b ;show:text;"
  assert(P.UnknownFields(raw) == "DisplayType:Text;Custom : a b;", "unknown pairs in order: " .. P.UnknownFields(raw))
  assert(P.UnknownFields("time:1;ph:1;text:x;TTS:1;Icon:5;") == "", "known keys in any case are not repeated")
  assert(P.UnknownFields(nil) == "" and P.UnknownFields("free text") == "", "nothing to keep")
  -- written back after FormatLine, the line parses to the same timer and keeps them
  local t = P.Parse(raw).timers[1]
  local line = P.FormatLine(t) .. P.UnknownFields(raw)
  assert(line:find("DisplayType:Text;Custom : a b;$"), line)
  local back = P.Parse(line).timers[1]
  assert(back.time == 48 and back.text == "Go in" and back.dur == 8 and back.show.text, "same timer")
end)

check("notes: AddLineTo adds to that very note, RawLines splits once", function()
  reset()
  local a = Notes:AddLine(4000, "Heroic", "B", L1)
  local b = Notes:Import("EncounterID:4000;Difficulty:Mythic;Name:B\\n" .. L1)
  assert(a and b and a ~= b, "two notes for the boss")
  local n = Notes:AddLineTo(a, L2)
  assert(n == 3 and Notes:Get(a).raw == "EncounterID:4000;Difficulty:Heroic;Name:B\\n" .. L1 .. "\\n" .. L2, "appended to a, line 3")
  assert(Notes:Get(b).raw == "EncounterID:4000;Difficulty:Mythic;Name:B\\n" .. L1, "b untouched")
  local lines = Notes:RawLines(a)
  assert(#lines == 3 and lines[2] == L1 and lines[3] == L2, "RawLines")
  assert(Notes:AddLineTo(a, "x\\ny") == nil and Notes:AddLineTo(99999, L1) == nil, "refuses a multi-line text or a missing note")
  Notes:UpdateRaw(a, "EncounterID:4000;Name:B\\r\\n" .. L1)
  assert(Notes:AddLineTo(a, L2) == 3 and Notes:Get(a).raw == "EncounterID:4000;Name:B\\r\\n" .. L1 .. "\\r\\n" .. L2, "keeps the note's line ends")
end)

check("speak at: a note line writes and reads ttsat:0", function()
  local t = P.Parse("time:30;ph:1;tag:Abu;text:Soak;show:text;tts:1;ttsat:0;warn:6;").timers[1]
  assert(t.speakAt == "zero", "ttsat:0 reads as speakAt zero: " .. tostring(t.speakAt))
  local line = P.FormatLine(t)
  assert(line:find("ttsat:0;", 1, true), "written back: " .. line)
  assert(P.Parse(line).timers[1].speakAt == "zero", "round trip")
  assert(P.UnknownFields("time:1;ttsat:0;Other:x;") == "Other:x;", "ttsat is a known field, not kept twice")
  local plain = P.FormatLine({ time = 5, ph = 1, kind = "text", text = "x", tts = true })
  assert(not plain:find("ttsat", 1, true), "only written for At 0: " .. plain)
  assert(P.Parse("time:5;text:x;tts:1;ttsat:5;").timers[1].speakAt == nil, "any other value is on show")
end)

-- shield:<unit>,<seconds>[,any]; a shield bar on the line (Alerts/Absorb.lua). Written by FormatLine, read back exactly
check("shield: a note line writes and reads its shield bar option", function()
  local line = P.FormatLine({ time = 183, ph = 1, tags = { "everyone" }, kind = "text", text = "Break it", show = { bar = true },
    absorb = { unit = "boss2", length = 15, anyDifficulty = true } })
  assert(line:find("shield:boss2,15,any;", 1, true), "written as shield:boss2,15,any; " .. line)
  local t = P.Parse(line).timers[1]
  assert(t.absorb and t.absorb.unit == "boss2" and t.absorb.length == 15 and t.absorb.anyDifficulty == true, "read back")
  assert(P.FormatLine(t) == line, "the same line again: " .. P.FormatLine(t))
  local off = P.FormatLine({ time = 5, kind = "text", text = "x", absorb = { unit = "boss1", length = 7.5, anyDifficulty = false } })
  assert(off:find("shield:boss1,7.5;", 1, true), "without any: " .. off)
  local b = P.Parse(off).timers[1].absorb
  assert(b.unit == "boss1" and b.length == 7.5 and b.anyDifficulty == false, "anyDifficulty off reads back off")
  assert(not P.FormatLine({ time = 5, kind = "text", text = "x" }):find("shield", 1, true), "no absorb: no shield field")
  assert(P.UnknownFields("time:1;shield:boss2,15,any;Other:x;") == "Other:x;", "shield is a known field, not kept twice")
  -- any spelling of the words, spaces too; a value that doesn't read is no shield, and the line still reads
  local s = P.Parse("time:9;text:x;shield: Boss3 , 20 , ANY ;").timers[1]
  assert(s.time == 9 and s.absorb and s.absorb.unit == "boss3" and s.absorb.length == 20 and s.absorb.anyDifficulty, "case and spaces")
  for _, bad in ipairs({ "boss9,15", "boss2", "boss2,0", "boss2,-3", "target,15", "boss2,abc", "" }) do
    local tb = P.Parse("time:9;text:x;shield:" .. bad .. ";").timers[1]
    assert(tb and tb.time == 9 and tb.text == "x" and tb.absorb == nil, "'" .. bad .. "' is no shield, the line reads")
  end
end)

-- A raider on an older CRT (the v1.1.5 parser, old_Parse.lua) reads the line as it always did: the same timer without
-- the shield, a plain bar; and writing that line back keeps the shield: field (UnknownFields).
check("shield: an older CRT ignores the option and keeps it", function()
  local Old = {}
  assert(load(OLD_PARSE, "@old_Parse.lua"))("CowfeeRaidTools", Old)
  local line = "time:183;ph:1;tag:everyone;text:Break it;show:bar;tts:1;warn:6;shield:boss2,15,any;"
  local t = Old.NoteParser.Parse(line).timers[1]
  assert(t and t.time == 183 and t.ph == 1 and t.text == "Break it" and t.show.bar and t.tts and t.warn == 6, "the same timer")
  assert(t.absorb == nil, "no absorb")
  assert(Old.NoteParser.UnknownFields(line) == "shield:boss2,15,any;", "kept on a rewrite: " .. Old.NoteParser.UnknownFields(line))
  local rewritten = Old.NoteParser.FormatLine(t) .. Old.NoteParser.UnknownFields(line)
  local back = P.Parse(rewritten).timers[1]
  assert(back.absorb and back.absorb.unit == "boss2" and back.absorb.length == 15, "the option survives an older CRT's edit")
end)

if checks.failed then error(checks.failed .. " failed") end
`;
// the v1.1.5 parser, as a raider on an older CRT has it (a fixture beside this file)
lua.lua_pushstring(L, to_luastring(fs.readFileSync(require('path').join(__dirname, 'old_Parse.lua'), 'utf8')));
lua.lua_setglobal(L, to_luastring('OLD_PARSE'));
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const names = ['CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua'];
const files = process.argv.slice(2);
if (files.length !== names.length) { console.error('usage: node run_alerts_notewrite.js ' + names.join(' ')); process.exit(2); }
files.forEach((p, i) => { lua.lua_pushstring(L, to_luastring(names[i])); lua.lua_pushstring(L, to_luastring(fs.readFileSync(p, 'utf8'))); });
if (lua.lua_pcall(L, files.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
