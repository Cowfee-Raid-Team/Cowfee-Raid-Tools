// CRT_Modules/Timeline/Journal.lua's reading of a boss's Journal sections, on a stub Journal shaped like Nek'zali's: an
// Overview (role summaries that repeat abilities) first, then the stages. The Overview is left out, a spell
// listed twice keeps one row with both icons, and the stages are listed in order. Also the export's Phase
// lines from those stages (CRT_Modules/Timeline/JournalExport.lua).
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
check("stages in order, no Overview", table.concat(stages, "|") == "Stage One: Soulcoiler Initiation|Intermission: Ritual of Awakening|Stage Two: Awakened")
check("Interruptible is the tag interrupt, Mythic mythic", rows[3].tags[1] == "mythic" and rows[4].tags[1] == "tank")

local text = CRT.TimelineJournalExport.Build(2700, 16)
check("the first stage a heading, no Phase line", text:find("# Stage One: Soulcoiler Initiation\nSoulcoil Rite", 1, true) ~= nil)
check("the intermission is P1.5, the next stage P2, with no start yet", text:find("\nPhase: P1.5 (Intermission: Ritual of Awakening)\n", 1, true) and text:find("\nPhase: P2 (Stage Two: Awakened)\n", 1, true))
check("the intermission's own abilities under its heading", text:find("\nPhase: P1.5 (Intermission: Ritual of Awakening)\nRitual Burn [spell 600]", 1, true) and text:find("\nPhase: P2 (Stage Two: Awakened)\nSoul Transfer [spell 700]", 1, true))
check("Essence Rend typed dispel, tagged magic healer, a real line", text:find("\nEssence Rend [spell 500] (type dispel, tags magic healer):", 1, true) ~= nil and not text:find("# Essence Rend", 1, true))

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
check("the export: the intermission's block, then Phase Two's with its Essence Rend", ntext:find("\nPhase: P1.5 (Intermission: Ritual of Awakening)\nSoul Transfer", 1, true) and ntext:find("\nPhase: P2 (Phase Two: Uncoiling)\nUncoiling [spell 800]:\nEssence Rend [spell 500] (tags healer):", 1, true))
print(fails == 0 and "all passed" or (fails .. " failed"))
if fails > 0 then error(fails .. " failed", 0) end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Timeline/Journal.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/JournalExport.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
