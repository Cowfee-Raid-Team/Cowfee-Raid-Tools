// CRT_Modules/Timeline/JournalExport.lua: the reference text it writes for the boss shown in the Encounter Journal, which
// the real CRT_Modules/Timeline/Reference.lua reads (every ability a # line until it has times), and Run's checks.
// Usage: node run_journal_export.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local refSrc, src = ...
local printed, shown = {}, {}
function CreateFrame() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function() end } end
function InCombatLockdown() return false end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic" })[id] end
local CRT = { Timeline = { Settings = function() return {} end } }
function CRT:Print(m) printed[#printed + 1] = m end
assert(load(refSrc, "Reference.lua"))("CowfeeRaidTools", CRT)
CRT.TimelineJournal = { FromJournalEncounter = function(id)
  if id == 2700 then return "Nek'zali the Soulcoiler", 3470, {
    { name = "Soulcoil Well", spellID = 1284032, sectionID = 31, tags = {}, stage = "Stage One: Soulcoiler Initiation" },
    { name = "Soulcoil Rite", spellID = 1284033, sectionID = 32, tags = { "healer" }, stage = "Stage One: Soulcoiler Initiation" },
    { name = "Essence Rend", spellID = 1287426, sectionID = 33, tags = { "magic", "healer" }, stage = "Stage One: Soulcoiler Initiation" },
    { name = "Ritual Burn", spellID = 1297624, tags = { "mythic" }, stage = "Intermission: Ritual of Awakening" },
    { name = "Soul Transfer", spellID = 1292248, sectionID = 35, tags = { "tank" }, stage = "Stage Two: Awakened" },
  }, { "Stage One: Soulcoiler Initiation", "Intermission: Ritual of Awakening", "Stage Two: Awakened" } end
end }
CRT.ConsumablesTools = { ShowText = function(_, title, text, action) shown = { title = title, text = text, action = action } end }
CRT.Timeline.OpenReferenceText = function(_, t) shown.sent = t end
CRT.Timeline.SaveReferenceText = function(_, t) shown.saved = t return "own:1" end
devMode = true -- /crt dev open: the Advanced tab is there to add the times on
CRT.Timeline.DevMode = function() return devMode end
assert(load(src, "JournalExport.lua"))("CowfeeRaidTools", CRT)
local X = CRT.TimelineJournalExport
local fails = 0
local function check(name, ok) print((ok and "ok " or "FAIL ") .. name) if not ok then fails = fails + 1 end end

local text, name = X.Build(2700, 16)
check("names the boss", name == "Nek'zali the Soulcoiler" and text:find("^Boss: Nek'zali the Soulcoiler\n"))
check("difficulty and encounter lines", text:find("\nDifficulty: Mythic\n", 1, true) and text:find("\nEncounter: 3470\n", 1, true))
check("each ability with its spell and Journal section IDs, a real line", text:find("\nSoulcoil Well [spell 1284032] [section 31]:", 1, true) and text:find("\nSoulcoil Rite [spell 1284033] [section 32] (tags healer):", 1, true) and not text:find("\n# Soulcoil", 1, true))
check("the Journal's icons as tags, dispel and Mythic as types too", text:find("\nEssence Rend [spell 1287426] [section 33] (type dispel, tags magic healer):", 1, true) and text:find("\nRitual Burn [spell 1297624] (type mythic, tags mythic):", 1, true))
check("a row with no section gets no [section]", not text:find("1297624] [section", 1, true))
check("the first stage a heading, the later ones Phase lines with no time yet", text:find("\n# Stage One: Soulcoiler Initiation\n", 1, true) and text:find("\nPhase: P1.5 (Intermission: Ritual of Awakening)\n", 1, true) and text:find("\nPhase: P2 (Stage Two: Awakened)\n", 1, true) and not text:find("Phase: P1 ", 1, true))
-- as written it is a reference: it saves at once, abilities without times and phases without a start
local ref, errs = CRT.TimelineReference.Parse(text)
check("it reads as a reference at once: " .. table.concat(errs or {}, "; "), ref and ref.boss == "Nek'zali the Soulcoiler" and ref.difficulty == "Mythic" and ref.encounterID == 3470 and #ref.rows == 5)
check("the sections read back", ref and ref.rows[1].sectionID == 31 and ref.rows[3].sectionID == 33 and ref.rows[4].sectionID == nil)
check("its rows have no casts yet, typed and tagged", ref and #ref.rows[3].casts == 0 and ref.rows[3].types[1] == "dispel" and ref.rows[3].tags[1] == "magic" and ref.rows[3].tags[2] == "healer")
check("the stages are phases waiting for a start, drawn nowhere yet", ref and #ref.phases == 0 and #ref.pending == 2 and ref.pending[1].label == "P1.5" and ref.pending[1].title == "Intermission: Ritual of Awakening")
-- given a start, a phase is drawn
local timed = CRT.TimelineReference.Parse((text:gsub("Phase: P1.5 %(", "Phase: P1.5 3:17 (")))
check("a phase given a start time is a phase, its title kept", timed and #timed.phases == 1 and timed.phases[1].t == 197 and timed.phases[1].title == "Intermission: Ritual of Awakening" and #timed.pending == 1)
check("an unknown tag is an error", CRT.TimelineReference.Parse("Boss: X\nA (tags wizard): 0:10") == nil)
check("an unknown boss gives nothing", X.Build(1, 16) == nil)

-- Run: needs a boss open, out of combat; Send to Timeline hands the text over
EncounterJournal = nil
X:Run()
check("no Journal boss: says so", printed[#printed] == "Open a boss in the Journal first.")
EncounterJournal = { encounterID = 2700 }
function EJ_GetDifficulty() return 15 end
X:Run()
check("opens the copy window titled with the boss", shown.title and shown.title:find("Nek'zali", 1, true) and shown.text:find("Difficulty: Heroic", 1, true))
check("with Send to Timeline", shown.action and shown.action.label == "Send to Timeline")
shown.action.onClick("edited text")
check("Send to Timeline saves it as a reference at once", shown.saved == "edited text" and printed[#printed]:find("Saved the abilities for Nek'zali", 1, true))
-- without /crt dev the Timeline says where it went (Timeline:SaveReferenceText); this adds no line naming the hidden tab
devMode = false
local before = #printed
shown.action.onClick("other text")
check("Send to Timeline outside dev: saved, no line about the Advanced tab", shown.saved == "other text" and #printed == before)
devMode = true
-- the helpers the Advanced tab's list edits a reference with
local R = CRT.TimelineReference
check("a phase line, with and without its time", R.PhaseLine("P2", "7:20", "Stage Two") == "Phase: P2 7:20 (Stage Two)" and R.PhaseLine("P1.5", nil, nil) == "Phase: P1.5")
check("insert and replace lines", R.InsertLine("a\nb", 2, "x") == "a\nx\nb" and R.ReplaceLine("a\nb\nc", 2, "y") == "a\ny\nc" and R.ReplaceLine("a\nb", 1, nil) == "b")
local twoStage = R.Parse("Boss: X\nA: 0:10\nPhase: P2 2:00\nB: 2:10\nC: 3:00")
check("the next phase's label: an intermission after phase 1, a phase after P2", R.NextPhaseLabel(twoStage, 2, true) == "P1.5" and R.NextPhaseLabel(twoStage, 5, false) == "P3" and R.NextPhaseLabel(twoStage, 5, true) == "P2.5")
InCombatLockdown = function() return true end
X:Run()
check("not in combat", printed[#printed] == "The Journal can't be read in combat.")
print(fails == 0 and "all passed" or (fails .. " failed"))
if fails > 0 then error(fails .. " failed", 0) end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/JournalExport.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
