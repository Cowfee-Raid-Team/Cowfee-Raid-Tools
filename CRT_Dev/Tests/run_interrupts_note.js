// The kick list in the raid note (CRT_Modules/Interrupts/NoteBlock.lua) over the real notes store (Notes/Parse.lua,
// Notes/Data.lua): the intstart block's lines (one per group, names in kick order, empty slots left out), the block
// replaced in place with every other line kept byte for byte or added at the end, taken out for an empty list, read
// back and fitted to the setup, Write making the note for exactly that difficulty and leaving the other difficulty's
// alone, refused for a raider and during a fight, written a moment after your own changes, and opening a boss
// reading the block into the raid's list. Usage: node run_interrupts_note.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
date = function() return "2026-10-29 12:00" end
GetTime = function() return 1000 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
issecretvalue = function() return false end
local combat, fight = false, false
InCombatLockdown = function() return combat end
C_InstanceEncounter = { IsEncounterInProgress = function() return fight end }
local timers = {}
C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
local function runTimers() local t = timers timers = {} for _, fn in ipairs(t) do fn() end end
CreateFrame = function() local f = {} function f:RegisterEvent() end function f:UnregisterEvent() end function f:SetScript() end return f end
UnitName = function(u) if u == "player" then return "Solex" end end
local raid, lead = false, true
IsInRaid = function() return raid end
IsInGroup = function() return raid end
UnitIsGroupLeader = function() return lead end
UnitIsGroupAssistant = function() return false end
C_Spell = { GetSpellInfo = function() return nil end }

local CRT = { db = { notes = { list = {}, nextId = 1 }, interrupts = { enabled = true, own = {}, shared = {}, use = {}, accept = true, test = false, plates = {}, reminder = {} } } }
for i = 1, #sources, 2 do assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT) end
local I, B, Notes = CRT.Interrupts, CRT.InterruptNote, CRT.Notes
check(B ~= nil, "CRT.InterruptNote is made")
CRT.Bosses:Get(3470).interrupts = {
  { difficulty = 16, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 }, { key = "cross", label = "Cross add", marker = 7, slots = 4 } } },
  { difficulty = 15, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 } } },
}
I:ClearCache()
local M = "3470:16"
local def = I:Def(M)

-- the lines
local list = { { "Solex", "", "Brenn-Illidan", "Mara" }, { "", "", "", "" } }
local lines = B.Lines(def, list)
eq(table.concat(lines, "|"), "intstart|Solex Brenn-Illidan Mara|intend", "lines: one per group, names in order, empty slots left out, an empty last group left out")
lines = B.Lines(def, { { "", "", "", "" }, { "A", "B", "", "" } })
eq(table.concat(lines, "|"), "intstart||A B|intend", "lines: an empty group before another is an empty line")
eq(#B.Lines(def, { {}, {} }), 0, "lines: none for an empty list")

-- replacing in a note's text
local RAW = "EncounterID:3470;Difficulty:Mythic\\r\\n{time:10}Spread\\r\\nintstart\\r\\nOld One\\r\\nintend\\r\\nKeep: me \\r\\n"
local new = B.Replace(RAW, { "intstart", "A B", "C", "intend" })
eq(new, "EncounterID:3470;Difficulty:Mythic\\r\\n{time:10}Spread\\r\\nintstart\\r\\nA B\\r\\nC\\r\\nintend\\r\\nKeep: me \\r\\n", "replace: in place, in the note's line ends, the rest byte for byte")
eq(B.Replace(RAW, {}), "EncounterID:3470;Difficulty:Mythic\\r\\n{time:10}Spread\\r\\nKeep: me \\r\\n", "replace: no lines takes the block out")
eq(B.Replace("Header\\nLine", { "intstart", "A", "intend" }), "Header\\nLine\\nintstart\\nA\\nintend", "replace: at the end when there is none")
eq(B.Replace("Header\\n", { "intstart", "A", "intend" }), "Header\\nintstart\\nA\\nintend\\n", "replace: before a trailing line end")
eq(B.Replace("", { "intstart", "A", "intend" }), "intstart\\nA\\nintend", "replace: an empty note")
eq(B.Replace("  IntStart \\nX\\n INTEND\\nrest", { "intstart", "Y", "intend" }), "intstart\\nY\\nintend\\nrest", "replace: the words in any case and spacing")
eq(B.Replace("intstart\\nX\\nrest", {}), "intstart\\nX\\nrest", "replace: a start with no end is left alone")

-- reading back
local rows = B.Rows(new)
eq(rows and #rows, 2, "rows: two lines"); eq(rows and rows[1][2], "B", "rows: the names")
eq(B.Rows("no block"), nil, "rows: none")
local fit = B.Fit(def, B.Rows("intstart\\nA B C D\\nE\\nintend"))
eq(fit and fit[1][4], "D", "fit: four names on a group of four"); eq(fit and fit[2][2], "", "fit: the rest empty")
eq(B.Fit(def, B.Rows("intstart\\nA B C D E\\nintend")), nil, "fit: five names on a group of four don't fit")
eq(B.Fit(def, B.Rows("intstart\\nA\\nB\\nC\\nintend")), nil, "fit: more lines than groups don't fit")
check(B.Fit(def, B.Rows("intstart\\nA\\nintend")) ~= nil, "fit: fewer lines than groups fit")
eq(B.DifficultyName(16), "Mythic", "difficulty: Mythic"); eq(B.DifficultyName(15), "Heroic", "difficulty: Heroic"); eq(B.DifficultyName(99), nil, "difficulty: unknown")

-- Write: the note for exactly that difficulty, made when there is none
for s, n in ipairs({ "Solex", "Brenn", "Mara", "Tovi" }) do I:SetName(M, 1, s, n) end
I:SetName(M, 2, 1, "Hale")
local heroicID = Notes:Import("EncounterID:3470;Difficulty:Heroic;Name:Boss\\nintstart\\nHeroic Line\\nintend\\n")
local ok, noteID = B.Write(M)
check(ok and noteID, "write: done")
local rec = Notes:Get(noteID)
eq(rec.difficulty, "Mythic", "write: a Mythic note")
check(rec.raw:find("intstart\\nSolex Brenn Mara Tovi\\nHale\\nintend", 1, true) ~= nil, "write: the block in it: " .. rec.raw)
eq(rec.via, "Interrupts", "write: a note made here says so")
check(Notes:Get(heroicID).raw:find("Heroic Line", 1, true), "write: the Heroic note untouched")
I:SetName(M, 1, 1, "Quick")
B.Write(M)
local _, count = Notes:Get(noteID).raw:gsub("intstart", "")
eq(count, 1, "write: written again, one block")
check(Notes:Get(noteID).raw:find("Quick Brenn", 1, true), "write: with the new name")
-- refused
raid, lead = true, false
local ok2, why = B.Write(M)
check(not ok2 and why:find("leader", 1, true), "write: refused for a raider: " .. tostring(why))
raid, lead = false, true
fight = true
ok2, why = B.Write(M)
check(not ok2 and why == B.TEXT.busy, "write: refused in a boss fight")
fight = false; combat = true
check(not B.Write(M), "write: refused in combat")
combat = false

-- written a moment after your own changes
runTimers() -- the writes the edits above queued
I:SetName(M, 2, 2, "Ruun"); I:SetName(M, 2, 3, "Pell")
eq(#timers, 1, "auto: one timer for several changes")
check(not Notes:Get(noteID).raw:find("Ruun", 1, true), "auto: not yet")
runTimers()
check(Notes:Get(noteID).raw:find("Hale Ruun Pell", 1, true), "auto: written after the moment")
raid, lead = true, false
I:SetName(M, 2, 4, "Nobody"); eq(#timers, 0, "auto: nothing for a raider")
raid, lead = false, true
I:ReceiveShared(M, { { "X" }, {} }, "Brenn"); eq(#timers, 0, "auto: a share is not written")
I:Clear(M); runTimers()
check(not Notes:Get(noteID).raw:find("intstart", 1, true), "auto: an empty list takes the block out")

-- reading the raid note into the raid's list
Notes:UpdateRaw(noteID, "EncounterID:3470;Difficulty:Mythic\\nintstart\\nA B C D\\nE F\\nintend\\n")
check(B.ReadInto(M), "read: the block fills the raid's list")
eq(select(2, I:List(M)), "raid", "read: in use")
eq(I:Shared(M).list[2][2], "F", "read: the names")
eq(I:Shared(M).from, B.TEXT.fromNote, "read: from the raid note")
check(not B.ReadInto(M), "read: the same block again changes nothing")
check(B.ReadInto("3470:15"), "read: the Heroic note's block for the Heroic setup")
eq(I:Shared("3470:15").list[1][1], "Heroic", "read: its names")
Notes:UpdateRaw(noteID, "EncounterID:3470;Difficulty:Mythic\\nintstart\\nA B C D E\\nintend\\n")
check(not B.ReadInto(M), "read: a block that doesn't fit is left")
eq(I:Shared(M).list[1][1], "A", "read: (the raid's list kept)")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, 64);
const FILES = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Comm.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Interrupts/Lattice.lua',
  'CRT_Modules/Interrupts/Setup.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/NoteBlock.lua'];
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(f));
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length * 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
