// CRT_Core/Names.lua: CRT.ShortName, the name every window draws. A plain name stays, Name-Realm loses its realm
// (an apostrophe, a space or digits in the realm too), nil and non-strings come back as given, and a secret value is
// handed back untouched, never indexed or matched. Also: the .toc loads Names.lua right after Core.lua.
// Usage: node run_names.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local namesSrc, toc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end

-- secret values: a table the mock says is secret (any index, match or concat on it errors), and a string the
-- mock calls secret, which must come back with its "realm" still on (never matched)
local SECRET = setmetatable({}, { __index = function() error("indexed a secret") end, __concat = function() error("joined a secret") end })
local SECRET_TEXT = "Hidden-Realm"
issecretvalue = function(v) return v == SECRET or v == SECRET_TEXT end

local CRT = {}
assert(load(namesSrc, "CRT_Core/Names.lua"))("CowfeeRaidTools", CRT)
local S = CRT.ShortName
check(type(S) == "function", "CRT.ShortName exists")
eq(S("Thisisfartaa"), "Thisisfartaa", "a plain name stays")
eq(S("Thisisfartaa-Kil'jaeden"), "Thisisfartaa", "a realm with an apostrophe goes")
eq(S("Abu-Area 52"), "Abu", "a realm with a space goes")
eq(S("Abu-Area52"), "Abu", "a realm with digits goes")
eq(S("Abu-Twisting-Nether"), "Abu", "only the name before the first dash stays")
eq(S("Ärzte-Sargeras"), "Ärzte", "a name with accented letters keeps them")
eq(S(nil), nil, "nil stays nil")
eq(S(""), "", "an empty name stays empty")
eq(S("-Sargeras"), "-Sargeras", "nothing before the dash: as given")
eq(S(42), 42, "a non-string comes back as given")
local ok, out = pcall(S, SECRET)
check(ok and out == SECRET, "a secret value comes back untouched: " .. tostring(ok and "same" or out))
eq(S(SECRET_TEXT), SECRET_TEXT, "a secret string comes back as given, never stripped")
issecretvalue = function() error("issecretvalue failed") end
eq(S("Abu-Sargeras"), "Abu", "an issecretvalue that errors counts as not secret")
-- with no issecretvalue (an older client) it still works
issecretvalue = nil
eq(S("Rixxy-TwistingNether"), "Rixxy", "works without issecretvalue")

-- the .toc: Names.lua right after Core.lua, so every module can draw a name
check(toc:find("\\nCRT_Core\\\\Core%.lua\\r?\\nCRT_Core\\\\Names%.lua\\r?\\n") ~= nil, "the .toc loads Names.lua right after Core.lua")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/Names.lua', 'CowfeeRaidTools.toc']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
