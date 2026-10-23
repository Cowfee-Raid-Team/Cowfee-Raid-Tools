// CRT_Modules/Timeline/Journal.lua's reading of a boss's Journal sections, on a stub Journal shaped like Nek'zali's: an
// Overview (role summaries that repeat abilities) first, then the stages. The Overview is left out, a spell
// listed twice keeps one row with both icons, and the stages are listed in order. Also the export's Phase
// lines from those stages (CRT_Modules/Timeline/JournalExport.lua), pinned byte for byte. Then the older raids'
// Abilities page (Journal.Layout, from the Journal's boss list): Magmaw-shaped and Theralion and Valiona-shaped
// trees export every spell with "#" header lines.
// Usage: node run_journal_walk.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local journalSrc, refSrc, exportSrc = ...
function CreateFrame() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function() end } end
function InCombatLockdown() return false end
function GetDifficultyInfo() return "Mythic" end
Enum = { JournalEncounterIconFlags = { Tank = 0, Dps = 1, Healer = 2, Heroic = 3, Deadly = 4, Important = 5, Interruptible = 6, Magic = 7, Mythic = 12 } }
-- sections: id -> info; flags: id -> list
local S, F = {}, {}
local function sec(id, t) S[id] = t end
sec(10, { title = "Overview", spellID = 0, headerType = 3, firstChildSectionID = 11, siblingSectionID = 20 })
sec(11, { title = "Healer", spellID = 0, headerType = 3, firstChildSectionID = 12 })
sec(12, { title = "Essence Rend", spellID = 500, headerType = 3 })            F[12] = { 2 }
sec(20, { title = "Stage One: Soulcoiler Initiation", spellID = 0, headerType = 0, firstChildSectionID = 21, siblingSectionID = 30 })
sec(21, { title = "Soulcoil Rite", spellID = 400, headerType = 0, siblingSectionID = 22 })   F[21] = { 2 }
sec(22, { title = "Essence Rend", spellID = 500, headerType = 0, siblingSectionID = 23 })    F[22] = { 7 }
sec(23, { title = "Essence Rend (again)", spellID = 500, headerType = 0, siblingSectionID = 24 }) F[23] = { 2, 7 }
sec(24, { title = "Heroic only", spellID = 900, headerType = 0, filteredByDifficulty = true })
sec(30, { title = "Intermission: Ritual of Awakening", spellID = 0, headerType = 0, firstChildSectionID = 31, siblingSectionID = 40 })
sec(31, { title = "Ritual Burn", spellID = 600, headerType = 0 })                 F[31] = { 12 }
sec(40, { title = "Stage Two: Awakened", spellID = 0, headerType = 0, firstChildSectionID = 41 })
sec(41, { title = "Soul Transfer", spellID = 700, headerType = 0 })               F[41] = { 0 }
-- boss 2800: everything under one header; stages a level down; an add header; a stage with its own spell
sec(100, { title = "Nek'zali", spellID = 0, headerType = 0, firstChildSectionID = 110 })
sec(110, { title = "Stage One: Soulcoiler Initiation", spellID = 0, headerType = 0, firstChildSectionID = 111, siblingSectionID = 120 })
sec(111, { title = "Essence Rend", spellID = 500, headerType = 0, siblingSectionID = 112 })   F[111] = { 7 }
sec(112, { title = "Soulcoil Rite", spellID = 400, headerType = 0 })
sec(120, { title = "Intermission: Ritual of Awakening", spellID = 0, headerType = 0, firstChildSectionID = 121, siblingSectionID = 130 })
sec(121, { title = "Echo of Jawae", spellID = 0, headerType = 0, firstChildSectionID = 122 })
sec(122, { title = "Soul Transfer", spellID = 700, headerType = 0, siblingSectionID = 123 })
sec(123, { title = "Hungering Pyre", spellID = 710, headerType = 0 })
sec(130, { title = "Phase Two: Uncoiling", spellID = 800, headerType = 0, firstChildSectionID = 131 })
sec(131, { title = "Essence Rend", spellID = 500, headerType = 0 })   F[131] = { 2 }
C_EncounterJournal = {
  GetSectionInfo = function(id) local t = S[id] if not t then return nil end local o = {} for k, v in pairs(t) do o[k] = v end o.filteredByDifficulty = t.filteredByDifficulty or false return o end,
  GetSectionIconFlags = function(id) return F[id] end,
}
function EJ_GetEncounterInfo(id) if id == 2700 then return "Nek'zali the Soulcoiler", "", 2700, 10, "", 1, 3470 end if id == 2800 then return "Nested Boss", "", 2800, 100, "", 1, 3480 end end
C_Spell = { GetSpellName = function(id) return ({ [400] = "Soulcoil Rite", [500] = "Essence Rend", [600] = "Ritual Burn", [700] = "Soul Transfer" })[id] end, GetSpellTexture = function() return 1 end }
local CRT = { Timeline = { Settings = function() return {} end } }
assert(load(journalSrc, "Journal.lua"))("CowfeeRaidTools", CRT)
assert(load(refSrc, "Reference.lua"))("CowfeeRaidTools", CRT)
assert(load(exportSrc, "JournalExport.lua"))("CowfeeRaidTools", CRT)
local J = CRT.TimelineJournal
local fails = 0
local function check(name, ok) print((ok and "ok " or "FAIL ") .. name) if not ok then fails = fails + 1 end end

local name, dungeon, rows, stages = J.FromJournalEncounter(2700)
local names = {}
for _, r in ipairs(rows) do names[#names + 1] = r.name end
check("the boss and its encounter", name == "Nek'zali the Soulcoiler" and dungeon == 3470)
check("abilities from the stages, the Overview's repeat and the hidden difficulty left out: " .. table.concat(names, ","), table.concat(names, ",") == "Soulcoil Rite,Essence Rend,Ritual Burn,Soul Transfer")
local rend = rows[2]
check("a spell listed twice keeps one row with its icons merged: " .. table.concat(rend.tags, " "), rend.stage == "Stage One: Soulcoiler Initiation" and table.concat(rend.tags, " ") == "magic healer")
check("each row keeps its first Journal section", rows[1].sectionID == 21 and rend.sectionID == 22 and rows[4].sectionID == 41)
check("stages in order, no Overview", table.concat(stages, "|") == "Stage One: Soulcoiler Initiation|Intermission: Ritual of Awakening|Stage Two: Awakened")
check("Interruptible is the tag interrupt, Mythic mythic", rows[3].tags[1] == "mythic" and rows[4].tags[1] == "tank")

local text = CRT.TimelineJournalExport.Build(2700, 16)
check("the first stage a heading, no Phase line", text:find("# Stage One: Soulcoiler Initiation\nSoulcoil Rite", 1, true) ~= nil)
check("the intermission is P1.5, the next stage P2, with no start yet", text:find("\nPhase: P1.5 (Intermission: Ritual of Awakening)\n", 1, true) and text:find("\nPhase: P2 (Stage Two: Awakened)\n", 1, true))
check("the intermission's own abilities under its heading", text:find("\nPhase: P1.5 (Intermission: Ritual of Awakening)\nRitual Burn [spell 600] [section 31]", 1, true) and text:find("\nPhase: P2 (Stage Two: Awakened)\nSoul Transfer [spell 700] [section 41]", 1, true))
check("Essence Rend typed dispel, tagged magic healer, a real line", text:find("\nEssence Rend [spell 500] [section 22] (type dispel, tags magic healer):", 1, true) ~= nil and not text:find("# Essence Rend", 1, true))

-- stages at any depth, abilities with their nearest stage, an ability in two stages in both
C_Spell.GetSpellName = function(id) return ({ [400] = "Soulcoil Rite", [500] = "Essence Rend", [600] = "Ritual Burn", [700] = "Soul Transfer", [710] = "Hungering Pyre", [800] = "Uncoiling" })[id] end
local _, _, nrows, nstages = J.FromJournalEncounter(2800)
local got = {}
for _, r in ipairs(nrows) do got[#got + 1] = r.name .. "@" .. (r.stage or "-") end
check("stages a level down are found, the add header is not one: " .. table.concat(nstages, "|"), table.concat(nstages, "|") == "Stage One: Soulcoiler Initiation|Intermission: Ritual of Awakening|Phase Two: Uncoiling")
check("an add's abilities belong to the stage above it", table.concat(got, ","):find("Soul Transfer@Intermission: Ritual of Awakening,Hungering Pyre@Intermission: Ritual of Awakening", 1, true) ~= nil)
check("a stage header with its own spell is a stage and an ability of it", table.concat(got, ","):find("Uncoiling@Phase Two: Uncoiling", 1, true) ~= nil)
check("an ability in two stages is in both, with each stage's icons: " .. table.concat(got, ","), table.concat(got, ","):find("Essence Rend@Stage One: Soulcoiler Initiation", 1, true) and table.concat(got, ","):find("Essence Rend@Phase Two: Uncoiling", 1, true)
  and nrows[1].tags[1] == "magic" and nrows[#nrows].tags[1] == "healer")
check("an ability is only listed once within its stage", #nrows == 6)
check("Journal.IsStage: by title, any numbering and case", J.IsStage({ title = "2. phase two" }) and J.IsStage({ title = "INTERMISSION" }) and not J.IsStage({ title = "Echo of Jawae", spellID = 0, firstChildSectionID = 122 }) and not J.IsStage({ title = "Overview", headerType = 3 }))
local ntext = CRT.TimelineJournalExport.Build(2800, 16)
check("the export: the intermission's block, then Phase Two's with its Essence Rend", ntext:find("\nPhase: P1.5 (Intermission: Ritual of Awakening)\nSoul Transfer", 1, true) and ntext:find("\nPhase: P2 (Phase Two: Uncoiling)\nUncoiling [spell 800] [section 130]:\nEssence Rend [spell 500] [section 131] (tags healer):", 1, true))

-- A current raid's boss export, pinned byte for byte: the old raids' layout must never change it.
local function exact(label, got, want)
  check(label, got == want)
  if got ~= want then print(string.format("  got  %q", tostring(got))) print(string.format("  want %q", tostring(want))) end
end
local HELP = "# From the Encounter Journal. Add each ability's times after its colon, as m:ss or seconds: 0:02, 1:17\n"
  .. "# A Phase line with no time yet is the stage's start to fill in: Phase: P1.5 3:17 (Intermission: ...)\n"
local PIN_2700 = "Boss: Nek'zali the Soulcoiler\nDifficulty: Mythic\nEncounter: 3470\n" .. HELP
  .. "# Stage One: Soulcoiler Initiation\nSoulcoil Rite [spell 400] [section 21] (tags healer):\nEssence Rend [spell 500] [section 22] (type dispel, tags magic healer):\n"
  .. "Phase: P1.5 (Intermission: Ritual of Awakening)\nRitual Burn [spell 600] [section 31] (type mythic, tags mythic):\n"
  .. "Phase: P2 (Stage Two: Awakened)\nSoul Transfer [spell 700] [section 41] (tags tank):"
local PIN_2800 = "Boss: Nested Boss\nDifficulty: Mythic\nEncounter: 3480\n" .. HELP
  .. "# Stage One: Soulcoiler Initiation\nEssence Rend [spell 500] [section 111] (type dispel, tags magic):\nSoulcoil Rite [spell 400] [section 112]:\n"
  .. "Phase: P1.5 (Intermission: Ritual of Awakening)\nSoul Transfer [spell 700] [section 122]:\nHungering Pyre [spell 710] [section 123]:\n"
  .. "Phase: P2 (Phase Two: Uncoiling)\nUncoiling [spell 800] [section 130]:\nEssence Rend [spell 500] [section 131] (tags healer):"
exact("a current raid's boss, the Journal's boss list unknown: the export as before", CRT.TimelineJournalExport.Build(2700, 16), PIN_2700)
exact("a boss with stages a level down, boss list unknown: as before", CRT.TimelineJournalExport.Build(2800, 16), PIN_2800)
check("no boss list: the layout is unknown", J.Layout(2700) == nil)

-- The Journal's boss lists. Instance 1 is a current raid (a boss with an Overview root); 2 and 3 are older
-- raids, every boss's page only an Abilities list. Their sections' headerType is their depth, so a spell three
-- levels down has headerType 3, the Overview's number.
local BOSSES = { [1] = { 2700, 2800 }, [2] = { 3000 }, [3] = { 3100, 3200 } }
local INFO = {
  [2700] = { "Nek'zali the Soulcoiler", 10, 1, 3470 }, [2800] = { "Nested Boss", 100, 1, 3480 },
  [3000] = { "Magmaw", 300, 2, 1024 }, [3100] = { "Theralion and Valiona", 400, 3, 1032 }, [3200] = { "Halfus Wyrmbreaker", 500, 3, 1030 },
}
function EJ_GetEncounterInfo(id) local i = INFO[id] if i then return i[1], "", id, i[2], "", i[3], i[4] end end
-- before the Journal has selected an instance this session, listing one by its ID gives nothing
function EJ_GetEncounterInfoByIndex() return nil end
check("an instance not listed yet: the layout is unknown", J.Layout(2700) == nil)
exact("an instance not listed yet: the export as before", CRT.TimelineJournalExport.Build(2700, 16), PIN_2700)
local calls = 0
function EJ_GetEncounterInfoByIndex(index, instanceID)
  calls = calls + 1
  local id = (BOSSES[instanceID or 1] or {})[index]
  if id then local i = INFO[id] return i[1], "", id, i[2], "", i[3], i[4] end
end
-- Magmaw: abilities straight under the root, one with an ability of its own under it, an add's header, a
-- heroic-only header left out, an entry with no spell, and an ability after the add's header
sec(300, { title = "Magma Spit", spellID = 3001, headerType = 0, siblingSectionID = 301 })
sec(301, { title = "Lava Spew", spellID = 3002, headerType = 0, siblingSectionID = 302 })   F[301] = { 5 }
sec(302, { title = "Mangle", spellID = 3003, headerType = 0, firstChildSectionID = 320, siblingSectionID = 303 }) F[302] = { 0 }
sec(320, { title = "Swelter", spellID = 3004, headerType = 1 })
sec(303, { title = "Pillar of Flame", spellID = 0, headerType = 0, siblingSectionID = 307 })
-- entries with no spell whose titles the reference reader would reject as ability lines
sec(307, { title = "Exposed Head (Heroic)", spellID = 0, headerType = 0, siblingSectionID = 308 })
sec(308, { title = "Phase 2: Molten", spellID = 0, headerType = 0, siblingSectionID = 309 })
sec(309, { title = "Order", spellID = 0, headerType = 0, siblingSectionID = 304 })
sec(304, { title = "Lava Parasite", spellID = 0, headerType = 0, firstChildSectionID = 340, siblingSectionID = 305 })
sec(340, { title = "Parasitic Infection", spellID = 3005, headerType = 1 })
sec(305, { title = "Blazing Bone Construct", spellID = 0, headerType = 0, filteredByDifficulty = true, firstChildSectionID = 350, siblingSectionID = 306 })
sec(350, { title = "Armageddon", spellID = 3006, headerType = 1 })
sec(306, { title = "Massive Crash", spellID = 3007, headerType = 0 })
-- Theralion and Valiona: two creatures, each with Grounded and Airborne headers; a spell a level under another
-- (headerType 3); a spell listed twice under one header; the same spell under both creatures
sec(400, { title = "Theralion", spellID = 0, headerType = 0, firstChildSectionID = 410, siblingSectionID = 450 })
sec(410, { title = "Grounded Abilities", spellID = 0, headerType = 1, firstChildSectionID = 411, siblingSectionID = 420 })
sec(411, { title = "Engulfing Magic", spellID = 4001, headerType = 2, siblingSectionID = 412 }) F[411] = { 7 }
sec(412, { title = "Engulfing Magic", spellID = 4001, headerType = 2 })                       F[412] = { 2 }
sec(420, { title = "Airborne Abilities", spellID = 0, headerType = 1, firstChildSectionID = 421 })
sec(421, { title = "Fabulous Flames", spellID = 4002, headerType = 2, siblingSectionID = 422 })
sec(422, { title = "Deep Breath", spellID = 4003, headerType = 2, firstChildSectionID = 423 })
sec(423, { title = "Twilight Flames", spellID = 4004, headerType = 3 })
sec(450, { title = "Valiona", spellID = 0, headerType = 0, firstChildSectionID = 460 })
sec(460, { title = "Grounded Abilities", spellID = 0, headerType = 1, firstChildSectionID = 461, siblingSectionID = 470 })
sec(461, { title = "Blackout", spellID = 4005, headerType = 2, siblingSectionID = 462 })      F[461] = { 7 }
sec(462, { title = "Devouring Flames", spellID = 4006, headerType = 2 })
sec(470, { title = "Airborne Abilities", spellID = 0, headerType = 1, firstChildSectionID = 471 })
sec(471, { title = "Twilight Meteorite", spellID = 4007, headerType = 2, siblingSectionID = 472 })
sec(472, { title = "Deep Breath", spellID = 4003, headerType = 2 })
sec(500, { title = "Shadow Nova", spellID = 5001, headerType = 0 })

check("detection: a current raid's boss has the Overview layout", J.Layout(2700) == "overview")
check("detection: a boss with no Overview of its own in a current raid still has it", J.Layout(2800) == "overview")
check("detection: an older raid's bosses have the Abilities layout", J.Layout(3000) == "abilities" and J.Layout(3100) == "abilities" and J.Layout(3200) == "abilities")
check("detection: a boss its instance's list doesn't hold is unknown", J.Layout(9999) == nil)
local callsBefore = calls
exact("a current raid's boss with the boss list known: the export as before", CRT.TimelineJournalExport.Build(2700, 16), PIN_2700)
exact("stages a level down with the boss list known: as before", CRT.TimelineJournalExport.Build(2800, 16), PIN_2800)

exact("Magmaw: every ability in Journal order, the add under its header, the boss's name before what follows it",
  CRT.TimelineJournalExport.Build(3000, 16),
  "Boss: Magmaw\nDifficulty: Mythic\nEncounter: 1024\n" .. HELP
  .. "Magma Spit [spell 3001] [section 300]:\nLava Spew [spell 3002] [section 301] (tags important):\nMangle [spell 3003] [section 302] (tags tank):\nSwelter [spell 3004] [section 320]:\n"
  .. "# Pillar of Flame (no spell)\n# Exposed Head (Heroic) (no spell)\n# Phase 2: Molten (no spell)\n# Order (no spell)\n"
  .. "# Lava Parasite\nParasitic Infection [spell 3005] [section 340]:\n# Magmaw\nMassive Crash [spell 3007] [section 306]:")
exact("Theralion and Valiona: each creature's headers as # lines, no Phase lines",
  CRT.TimelineJournalExport.Build(3100, 16),
  "Boss: Theralion and Valiona\nDifficulty: Mythic\nEncounter: 1032\n" .. HELP
  .. "# Theralion\n# Grounded Abilities\nEngulfing Magic [spell 4001] [section 411] (type dispel, tags magic healer):\n"
  .. "# Airborne Abilities\nFabulous Flames [spell 4002] [section 421]:\nDeep Breath [spell 4003] [section 422]:\nTwilight Flames [spell 4004] [section 423]:\n"
  .. "# Valiona\n# Grounded Abilities\nBlackout [spell 4005] [section 461] (type dispel, tags magic):\nDevouring Flames [spell 4006] [section 462]:\n"
  .. "# Airborne Abilities\nTwilight Meteorite [spell 4007] [section 471]:\nDeep Breath [spell 4003] [section 472]:")
local _, _, orows, ostages = J.FromJournalEncounter(3100)
check("an older raid's boss has no stages, and its rows no stage", #ostages == 0 and orows[1].stage == nil and #orows == 8)
local oref, oerrs = CRT.TimelineReference.Parse(CRT.TimelineJournalExport.Build(3100, 16))
check("its export reads as a reference at once: " .. table.concat(oerrs or {}, "; "), oref and #oref.rows == 8 and #(oref.pending or {}) == 0)
local mref, merrs = CRT.TimelineReference.Parse(CRT.TimelineJournalExport.Build(3000, 16))
check("Magmaw's whole export reads as a reference, the entries with no spell only # lines: " .. table.concat(merrs or {}, "; "), mref and #mref.rows == 6)
-- the Journal is asked about an instance once per session
check("an instance's layout is kept: no second listing", calls == callsBefore)
-- a boss the kept list doesn't hold (one the list only gives at another difficulty) has the instance listed again
INFO[3300] = { "Sinestra", 600, 3, 1082 }
sec(600, { title = "Wrack", spellID = 6001, headerType = 0 })
check("a boss missing from the kept list, still missing on a new listing: unknown", J.Layout(3300) == nil and calls > callsBefore)
BOSSES[3][3] = 3300
check("a boss missing from the kept list, found on a new listing: its layout", J.Layout(3300) == "abilities")
local callsAfter = calls
check("the new listing is kept", J.Layout(3300) == "abilities" and J.Layout(3100) == "abilities" and calls == callsAfter)
print(fails == 0 and "all passed" or (fails .. " failed"))
if fails > 0 then error(fails .. " failed", 0) end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Timeline/Journal.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/JournalExport.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
