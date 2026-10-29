// The kick list in the raid note (CRT_Modules/Interrupts/NoteBlock.lua) over the real notes store (Notes/Parse.lua,
// Notes/Data.lua): the intstart block's lines (one per group, names in kick order, empty slots left out), the block
// replaced in place with every other line kept byte for byte or added at the end, taken out for an empty list, read
// back only when each line is empty or fills its group (a gap never shifts the numbers), Write going into the note a
// pull reads when it is for that difficulty or none (never a new note hiding it), else the exact-difficulty note,
// refused for a raider and during a fight, only the button writing, and opening a boss reading the block into the
// raid's list. Usage: node run_interrupts_note.js <addon folder>
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
local fit = B.Fit(def, B.Rows("intstart\\nA B C D\\n\\nintend"))
eq(fit and fit[1][4], "D", "fit: four names on a group of four"); eq(fit and fit[2][2], "", "fit: an empty line is an empty group")
eq(B.Fit(def, B.Rows("intstart\\nA B C D\\nE\\nintend")), nil, "fit: one name on a group of four doesn't fit (where were the gaps?)")
eq(B.Fit(def, B.Rows("intstart\\nA B C D E\\nintend")), nil, "fit: five names on a group of four don't fit")
eq(B.Fit(def, B.Rows("intstart\\nA\\nB\\nC\\nintend")), nil, "fit: more lines than groups don't fit")
local short = B.Fit(def, B.Rows("intstart\\nA B C D\\nintend"))
check(short and short[2][1] == "", "fit: a missing last line is an empty group")
eq(B.DifficultyName(16), "Mythic", "difficulty: Mythic"); eq(B.DifficultyName(15), "Heroic", "difficulty: Heroic"); eq(B.DifficultyName(99), nil, "difficulty: unknown")
-- a gap never shifts the kick numbers: written without it, the block is not read back
do
  local gap = { { "Solex", "", "Brenn", "Mara" }, { "" , "", "", "" } }
  local text = B.Replace("", B.Lines(def, gap))
  eq(text, "intstart\\nSolex Brenn Mara\\nintend", "gap: written with the empty slot left out")
  eq(B.Fit(def, B.Rows(text)), nil, "gap: not read back, so Brenn is never #2")
  local whole = { { "Solex", "Tovi", "Brenn", "Mara" }, { "A", "B", "C", "D" } }
  local back = B.Fit(def, B.Rows(B.Replace("", B.Lines(def, whole))))
  check(back and back[1][3] == "Brenn" and back[2][4] == "D", "round trip: a full list comes back slot for slot")
end

-- Write: a boss with no note at all gets one for exactly that difficulty
for s, n in ipairs({ "Solex", "Brenn", "Mara", "Tovi" }) do I:SetName(M, 1, s, n) end
I:SetName(M, 2, 1, "Hale")
local ok, noteID, _, written = B.Write(M)
check(ok and noteID, "write: done")
local rec = Notes:Get(noteID)
eq(rec.difficulty, "Mythic", "write: a Mythic note made, the boss having none")
eq(written, rec.name, "write: names the note it wrote to")
check(rec.raw:find("intstart\\nSolex Brenn Mara Tovi\\nHale\\nintend", 1, true) ~= nil, "write: the block in it: " .. rec.raw)
eq(rec.via, "Interrupts", "write: a note made here says so")
I:SetName(M, 1, 1, "Quick")
B.Write(M)
local _, count = Notes:Get(noteID).raw:gsub("intstart", "")
eq(count, 1, "write: written again, one block")
check(Notes:Get(noteID).raw:find("Quick Brenn", 1, true), "write: with the new name")
local function noteCount() local n = 0 for _ in pairs(CRT.db.notes.list) do n = n + 1 end return n end

-- the Heroic pull reads the Mythic note: refused, no note made to hide it
for s, n in ipairs({ "H1", "H2", "H3", "H4" }) do I:SetName("3470:15", 1, s, n) end
local before = noteCount()
eq(Notes:FindForEncounter(3470, "Heroic"), noteID, "other: (the Heroic pull reads the Mythic note)")
local okH, whyH = B.Write("3470:15")
check(not okH, "other: refused")
eq(whyH, "The Heroic pull reads the Mythic note. Make a Heroic note first (Raid Notes), then write.", "other: and says what to do")
eq(noteCount(), before, "other: no note made")
eq(Notes:FindForEncounter(3470, "Heroic"), noteID, "other: the Heroic pull still reads what it did")
local _, mythicBlocks = Notes:Get(noteID).raw:gsub("intstart", "")
eq(mythicBlocks, 1, "other: the Mythic note's block untouched")
eq(B.ReadInto("3470:15"), false, "other: nothing read back from another difficulty's note")
-- once there is a Heroic note, it is written there
local heroicID = Notes:Import("EncounterID:3470;Difficulty:Heroic;Name:Boss\\nKeep heroic\\n")
check(B.Write("3470:15"), "other: with a Heroic note, written")
check(Notes:Get(heroicID).raw:find("Keep heroic\\nintstart\\nH1 H2 H3 H4\\nintend", 1, true), "other: into the Heroic note")
check(Notes:Get(noteID).raw:find("Quick Brenn", 1, true) and not Notes:Get(noteID).raw:find("H1", 1, true), "other: the Mythic note left alone")

-- a note for every difficulty: only on a boss with setups for one difficulty
do
  CRT.Bosses:Register({ encounterID = 4100, name = "One Boss", season = "sample",
    interrupts = { { difficulty = 16, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 2 } } } } })
  I:ClearCache()
  local anyID = Notes:Import("EncounterID:4100;Name:One Boss\\nKeep me\\n")
  eq(Notes:FindForEncounter(4100, "Mythic"), anyID, "any: a Mythic pull reads the note for every difficulty")
  local n0 = noteCount()
  I:SetName("4100:16", 1, 1, "Solex"); I:SetName("4100:16", 1, 2, "Brenn")
  local okA, idA = B.Write("4100:16")
  check(okA and idA == anyID, "any: one difficulty with a setup, written into the note the pull reads")
  eq(noteCount(), n0, "any: no new note made")
  eq(Notes:FindForEncounter(4100, "Mythic"), anyID, "any: the pull still reads it")
  check(Notes:Get(anyID).raw:find("Keep me\\nintstart\\nSolex Brenn\\nintend", 1, true), "any: its lines kept, the block added")
  eq(B.NoteOf("4100:16"), anyID, "any: read back from the same note")
  -- a second difficulty with a setup: the shared note is refused for both
  CRT.Bosses:Get(4100).interrupts[2] = { difficulty = 15, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 2 } } }
  I:ClearCache()
  local okB, whyB = B.Write("4100:16")
  check(not okB and whyB and whyB:find("for every difficulty", 1, true) and whyB:find("Make a Mythic note first", 1, true), "any: refused with two difficulties: " .. tostring(whyB))
  I:SetName("4100:15", 1, 1, "X"); I:SetName("4100:15", 1, 2, "Y")
  check(not B.Write("4100:15"), "any: Heroic refused too, so neither overwrites the other's block")
  eq(noteCount(), n0, "any: still no new note")
  eq(B.ReadInto("4100:15"), false, "any: never read back on a boss with several difficulties")
  -- a share's shape for another difficulty counts as a setup too
  CRT.Bosses:Get(4100).interrupts[2] = nil
  I:ClearCache()
  check(B.Write("4100:16"), "any: one difficulty again, written")
  I:ReceiveShared("4100:14", { { "A", "B" } }, "Brenn", CRT.InterruptSetup.FromShape(14, "skull:8:2:Skull add", "Kick"))
  check(not B.Write("4100:16"), "any: a share's setup on Normal makes two difficulties")
end

-- refused for a raider, in a fight and in combat
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

-- only the button writes: a change of your list leaves the note alone
I:SetName(M, 2, 2, "Ruun"); runTimers()
check(not Notes:Get(noteID).raw:find("Ruun", 1, true), "no auto write: your change stays off the note")
eq(#timers, 0, "no auto write: nothing waiting")

-- reading the raid note into the raid's list
Notes:UpdateRaw(noteID, "EncounterID:3470;Difficulty:Mythic\\nintstart\\nA B C D\\nE F G H\\nintend\\n")
check(B.ReadInto(M), "read: the block fills the raid's list")
eq(select(2, I:List(M)), "raid", "read: in use")
eq(I:Shared(M).list[2][2], "F", "read: the names")
eq(I:Shared(M).from, B.TEXT.fromNote, "read: from the raid note")
check(not B.ReadInto(M), "read: the same block again changes nothing")
check(B.ReadInto("3470:15"), "read: the Heroic note's block for the Heroic setup")
eq(I:Shared("3470:15").list[1][1], "H1", "read: its names")
Notes:UpdateRaw(noteID, "EncounterID:3470;Difficulty:Mythic\\nintstart\\nA B C\\nintend\\n")
local okR, whyR = B.ReadInto(M)
check(not okR and whyR and whyR:find("doesn't fit", 1, true), "read: a line with a gap left out is not read, and says why: " .. tostring(whyR))
eq(I:Shared(M).list[1][1], "A", "read: (the raid's list kept)")
eq(I:Shared(M).list[2][1], "E", "read: (nothing put in use from it)")
-- a share's shape in use: the note read back in it keeps it
I:ReceiveShared("3470:15", { { "A", "B", "C" } }, "Brenn", CRT.InterruptSetup.FromShape(15, "skull:8:3:Skull add", "Kick"))
eq(I:Def("3470:15").groups[1].slots, 3, "shape: a three-kicker share over the shipped four")
Notes:UpdateRaw(heroicID, "EncounterID:3470;Difficulty:Heroic\\nintstart\\nP Q R\\nintend\\n")
check(B.ReadInto("3470:15"), "shape: the note's block read back in it")
eq(I:Def("3470:15").groups[1].slots, 3, "shape: the shape kept after the read-back")
eq(I:Shared("3470:15").list[1][3], "R", "shape: the names")

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
