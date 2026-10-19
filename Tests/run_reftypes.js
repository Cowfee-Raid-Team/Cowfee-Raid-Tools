// Dev/ReferenceTypes.lua: ApplyTypes rewrites only the (type ...) option; the result parses.
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
print(fails == 0 and "all passed" or (fails .. " failed"))
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['Timeline/Reference.lua', 'Dev/ReferenceTypes.lua', 'Bosses/Registry.lua', 'Seasons/Midnight-S1/Season.lua', 'Seasons/Midnight-S1/NekzaliTheSoulcoiler.lua', 'Seasons/Midnight-S1/Sszorak.lua'])
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(A + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 6, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
