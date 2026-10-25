// The spec cache (CRT_Modules/Groups/Data.lua): CRTDB.specCache[name in lower case] = SpecializationID, fed by your
// own spec, a Gear Checker inspect and CRT's hello. Names with and without a realm, secret and wrong values left
// out, your own spec read live, a spec's name and icon, the spec of a damage meter's spec icon, the saved default
// in Core.lua, shared by every profile and left out of Export settings.
// Usage: node run_spec_cache.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, coreSrc, profilesSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
issecretvalue = function(v) return v == "SECRET" end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
GetNormalizedRealmName = function() return "Sargeras" end
UnitName = function(u) if u == "player" then return "Solex" end end
-- the game's specs: Paladin (class 2) Holy 65 and Retribution 70, Priest (class 5) Discipline 256
local SPECS = { [65] = { "Holy", 135920, "PALADIN", "Paladin" }, [70] = { "Retribution", 135873, "PALADIN", "Paladin" },
  [256] = { "Discipline", 135940, "PRIEST", "Priest" } }
GetSpecializationInfoByID = function(id) local s = SPECS[id] if s then return id, s[1], "", s[2], "HEALER", s[3], s[4] end end
GetNumClasses = function() return 5 end
local listed = 0
C_SpecializationInfo = {
  GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function(i) return i == 1 and 65 or 0 end,
  GetNumSpecializationsForClassID = function(c) listed = listed + 1 return (c == 2 or c == 5) and 2 or 0 end,
}
local BY_CLASS = { [2] = { 65, 70 }, [5] = { 256, 0 } }
GetSpecializationInfoForClassID = function(c, i) local id = BY_CLASS[c] and BY_CLASS[c][i] local s = SPECS[id] if s then return id, s[1], "", s[2] end end
CreateFrame = function() return setmetatable({}, { __index = function() return function() end end }) end
local CRT = { db = { groups = {} } }
assert(load(dataSrc, "Groups/Data.lua"))("CowfeeRaidTools", CRT)
local G = CRT.Groups

-- 1. The cache
G.CacheSpec("Holy-Sargeras", 65)
eq(CRT.db.specCache["holy-sargeras"], 65, "kept under the name in lower case")
eq(G.CachedSpec("Holy-Sargeras"), 65, "read back")
eq(G.CachedSpec("Holy"), 65, "a name without its realm is on your realm")
G.CacheSpec("Other-Aerie Peak", 256)
eq(G.CachedSpec("other-aerie peak"), 256, "another realm's name, any case")
G.CacheSpec("Holy-Sargeras", 70)
eq(G.CachedSpec("Holy-Sargeras"), 70, "a new spec replaces the old")
for _, bad in ipairs({ { "SECRET", 65, "a secret name" }, { "Bad-Sargeras", "SECRET", "a secret spec" }, { "Bad-Sargeras", 0, "spec 0 (inspect not ready)" },
  { "Bad-Sargeras", "65", "a spec as text" }, { "Bad-Sargeras", 6.5, "a fraction" }, { "Bad-Sargeras", -1, "below 0" }, { "", 65, "an empty name" }, { nil, 65, "no name" } }) do
  G.CacheSpec(bad[1], bad[2])
  eq(G.CachedSpec("Bad-Sargeras"), nil, bad[3] .. " is left out")
end
eq(G.CachedSpec("Nobody"), nil, "an unknown name has none")
CRT.db.specCache["junk-sargeras"] = "x"
eq(G.CachedSpec("Junk"), nil, "a damaged saved value reads as none")
CRT.db.specCache = nil
eq(G.CachedSpec("Holy"), nil, "saved data from before the cache: none, no error")
check(type(CRT.db.specCache) == "table", "and the table is made")

-- 2. Your own spec, live
eq(G.PlayerSpecID(), 65, "your spec from the game")
eq(G.CachedSpec("Solex"), 65, "and remembered under your name")
C_SpecializationInfo.GetSpecialization = function() return "SECRET" end
eq(G.PlayerSpecID(), nil, "a secret spec index: none")
C_SpecializationInfo.GetSpecialization = function() error("not ready") end
eq(G.PlayerSpecID(), nil, "an error: none")
C_SpecializationInfo.GetSpecialization = function() return 1 end

-- 3. A spec's name and icon
local name, icon, classFile, className = G.SpecInfo(65)
eq(name .. "|" .. icon .. "|" .. classFile .. "|" .. className, "Holy|135920|PALADIN|Paladin", "a spec's name, icon and class")
eq(G.SpecInfo(9999), nil, "an unknown spec: nothing")
eq(G.SpecInfo("SECRET"), nil, "a secret spec: nothing")

-- 4. The spec of a spec icon (the damage meter gives icons)
eq(G.SpecOfIcon(135873), 70, "the icon of Retribution")
eq(G.SpecOfIcon(135940), 256, "and of Discipline")
local once = listed
G.SpecOfIcon(135920)
eq(listed, once, "the game's spec list is read once")
eq(G.SpecOfIcon(0), nil, "icon 0 is none")
eq(G.SpecOfIcon("SECRET"), nil, "a secret icon is none")
eq(G.SpecOfIcon(1), nil, "an icon of no spec is none")

-- 5. Saved data
check(coreSrc:find("\\n    specCache = {},", 1, true) ~= nil, "Core.lua has the specCache default")
check(profilesSrc:find("specCache = true", 1, true) ~= nil, "shared by every profile, like the class cache")
check(profilesSrc:find("\\n    specCache = false,", 1, true) ~= nil, "left out of Export settings only")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/Groups/Data.lua', 'CRT_Core/Core.lua', 'CRT_Core/Profiles.lua'];
for (const f of files) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
