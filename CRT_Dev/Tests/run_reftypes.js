// CRT_Dev/Dev/ReferenceTypes.lua: ApplyTypes rewrites only the (type ...) option; the result parses.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const A = process.argv[2];
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local refSrc, typesSrc, regSrc, seasonSrc, nekSrc, sszSrc = ...
local CRT = { UI = {}, Timeline = { Settings = function() return {} end, Fire = function() end } }
CRT.TimelineDB = { references = {} }
assert(load(refSrc))("CowfeeRaidTools", CRT)
assert(load(typesSrc))("CowfeeRaidTools", CRT)
local R, E = CRT.TimelineReference, CRT.ReferenceTypes
local shipped = {}
CRT.Bosses = { Register = function(_, b) for _, t in ipairs(b.references or {}) do shipped[b.name] = t end end }
assert(load(nekSrc))("CowfeeRaidTools", CRT)
assert(load(sszSrc))("CowfeeRaidTools", CRT)
local fails = 0
local function check(name, ok) print((ok and "PASS " or "FAIL ") .. name) if not ok then fails = fails + 1 end end

-- Sszorak parses: 7 rows, encounter 3420, no types yet.
local s = assert(R.Parse(shipped.Sszorak))
check("Sszorak parses with 7 rows", #s.rows == 7)
check("Sszorak encounter 3420", s.encounterID == 3420)
check("Sszorak casts", #s.rows[1].casts == 6 and s.rows[1].casts[1].dur == 19 and #s.rows[7].casts == 3)
check("Sszorak length 6:32", s.length == 392)

-- Setting types: main first, then the others; the rest of each line is kept.
local out = E.ApplyTypes(shipped.Sszorak, { { "raid" }, {}, { "soak", "spread" }, {}, { "dispel" }, {}, { "raid", "mythic" } })
local p = assert(R.Parse(out))
check("Mutilate raid", p.rows[1].types and p.rows[1].types[1] == "raid" and p.rows[1].casts[1].dur == 19)
check("Ravage untyped", p.rows[2].types == nil)
check("Tempest soak spread", p.rows[3].types[1] == "soak" and p.rows[3].types[2] == "spread")
check("Dig In raid mythic, bars kept", p.rows[7].types[2] == "mythic" and p.rows[7].casts[1].dur == 27)
check("comments kept", out:find("# Left out", 1, true) ~= nil)
check("line written", out:find("Tempest (type soak spread): 0:12", 1, true) ~= nil)

-- Nek'zali round trip: its own types back give the same text; leads with m:ss survive.
local n = assert(R.Parse(shipped["Nek'zali the Soulcoiler"]))
local list = {}
for i, row in ipairs(n.rows) do list[i] = row.types or {} end
check("Nek'zali round trip identical", E.ApplyTypes(shipped["Nek'zali the Soulcoiler"], list) == shipped["Nek'zali the Soulcoiler"])
list[9] = {}
local cleared = E.ApplyTypes(shipped["Nek'zali the Soulcoiler"], list)
check("clearing a type keeps the lead", cleared:find("Possession Barrage (type falloff, lead 7)", 1, true) and cleared:find("Ritual of Awakening (type generic)", 1, true) and cleared:find("Soul Transfer (type generic, lead 26)", 1, true) and cleared:find("Hungering Pyre (lead 6):", 1, true) ~= nil)
-- spell IDs and a lead written as m:ss
local t = E.ApplyTypes("Boss: X\\nFoo [spell 123] (lead 0:07, type raid): 0:10\\n", { { "soak" } })
check("spell and m:ss lead kept", t == "Boss: X\\nFoo [spell 123] (type soak, lead 0:07): 0:10\\n")
local d = R.Parse("Boss: X\\nFoo (type dodge heavydot): 0:10\\n")
check("dodge and heavydot read", d and d.rows[1].types[1] == "dodge" and d.rows[1].types[2] == "heavydot")
check("Sszorak types shipped", s.rows[1].types[1] == "raid" and s.rows[2].types[1] == "soak" and s.rows[5].types[1] == "raid")
-- Export removals: one line per marked shipped reference (boss file, encounter ID, difficulty, header).
check("boss file from name", E.BossFile("Kith'ix") == "Kithix.lua" and E.BossFile("Nek'zali the Soulcoiler") == "NekzaliTheSoulcoiler.lua")
CRT.Bosses.Get = function(_, id) if id == 3513 then return { encounterID = 3513, name = "Kith'ix", season = "sample" } end end
check("boss file in its season folder when the registry knows it", E.BossFile("Kith'ix", 3513) == "CRT_Data/Seasons/Sample/Kithix.lua")
local line = E.RemovalLine({ boss = "Kith'ix", encounterID = 3513, difficulty = "Mythic", header = "Boss: Kith'ix / Difficulty: Mythic / Length: 7:00" })
check("removal line format", line == "CRT_Data/Seasons/Sample/Kithix.lua; encounter 3513; Mythic; Boss: Kith'ix / Difficulty: Mythic / Length: 7:00")
check("removal line, no encounter or difficulty", E.RemovalLine({ boss = "X", header = "Boss: X" }) == "X.lua; encounter ?; any difficulty; Boss: X")
check("removal line, already gone", E.RemovalLine({ boss = "X", header = "Boss: X", gone = true }) == "X.lua; encounter ?; any difficulty; Boss: X; already gone")
CRT.db = { timeline = {}, dev = { removedReferences = {
  ["3513|Mythic|Boss: Kith'ix / Difficulty: Mythic / Length: 7:00"] = { boss = "Kith'ix", encounterID = 3513, difficulty = "Mythic", header = "Boss: Kith'ix / Difficulty: Mythic / Length: 7:00" },
  ["3420|Heroic|Boss: Sszorak / Difficulty: Heroic / Length: 6:32"] = { boss = "Sszorak", encounterID = 3420, difficulty = "Heroic", header = "Boss: Sszorak / Difficulty: Heroic / Length: 6:32" },
} } }
CRT.Timeline.Settings = function() return CRT.db.timeline end
CRT.TimelineDB.references = { "Boss: Kith'ix\\nDifficulty: Mythic\\nLength: 7:00\\nEncounter: 3513\\nX: 0:10" }
local lines = E.RemovalLines()
check("removal lines sorted by boss", #lines == 2 and lines[1] == "CRT_Data/Seasons/Sample/Kithix.lua; encounter 3513; Mythic; Boss: Kith'ix / Difficulty: Mythic / Length: 7:00" and lines[2] == "Sszorak.lua; encounter 3420; Heroic; Boss: Sszorak / Difficulty: Heroic / Length: 6:32; already gone")
CRT.db.dev.removedReferences = nil
check("no removals, no lines", #E.RemovalLines() == 0)
-- /crt dev mechhidden: the mechHidden line to paste into each changed boss file
local printed = {}
CRT.Print = function(_, m) printed[#printed + 1] = m end
CRT.Timeline.MechHiddenNames = function(_, id) if id == 3513 then return { "Latent Cultist", "Void \\"Rift\\"" } end return {} end
E:PrintMechHidden()
check("mech hidden: nothing changed says how", #printed == 1 and printed[1]:find("No abilities hidden from Mech Alerts", 1, true) ~= nil and printed[1]:find("/crt dev", 1, true) ~= nil)
printed = {}
CRT.db.dev.mechHidden = { ["3513"] = { ["latent cultist"] = "Latent Cultist" } }
E:PrintMechHidden()
check("mech hidden: the boss file line", #printed == 1 and printed[1] == "Kith'ix (3513): mechHidden = { \\"Latent Cultist\\", \\"Void \\\\\\"Rift\\\\\\"\\" },")
printed = {}
CRT.db.dev.mechHidden = { ["3513"] = { ["latent cultist"] = false } }
CRT.Timeline.MechHiddenNames = function() return {} end
E:PrintMechHidden()
check("mech hidden: all shown again prints an empty list", #printed == 1 and printed[1] == "Kith'ix (3513): mechHidden = {  },")
print(fails == 0 and "all passed" or (fails .. " failed"))
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Timeline/Reference.lua', 'CRT_Dev/Dev/ReferenceTypes.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua', 'CRT_Dev/Tests/SamplePack/Sszorak.lua'])
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(A + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 6, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
