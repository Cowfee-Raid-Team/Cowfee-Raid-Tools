// Bosses/Registry.lua: the raid progression route (Route, RouteList, RouteIndex, OnRouteChange), from
// the season's raids, with the dev's order laid over it.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local reg, season = ...
local handler
function CreateFrame() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
local CRT = { db = {} }
assert(load(reg, "Registry.lua"))("CowfeeRaidTools", CRT)
assert(load(season, "Season.lua"))("CowfeeRaidTools", CRT)
local B = CRT.Bosses
-- three of the season's bosses, registered out of route order, and one the route doesn't list
B:Register({ encounterID = 3420, name = "Sszorak", season = "midnight-s1" })
B:Register({ encounterID = 3470, name = "Nek'zali the Soulcoiler", season = "midnight-s1" })
B:Register({ encounterID = 3445, name = "Entombed Sentinels", season = "midnight-s1" })
B:Register({ encounterID = 9999, name = "New Boss", season = "midnight-s1" })
local fails = 0
local function check(name, ok) print((ok and "PASS " or "FAIL ") .. name) if not ok then fails = fails + 1 end end
local function names(list) local out = {} for _, d in ipairs(list) do out[#out + 1] = d.name end return table.concat(out, ", ") end

local r = B:RouteList("midnight-s1")
check("shipped route order, an unlisted boss last: " .. names(r), names(r) == "Nek'zali the Soulcoiler, Entombed Sentinels, Sszorak, New Boss")
local g = B:Route("midnight-s1")
check("one raid heading, from Season.lua", #g == 1 and g[1].raid.name == "Midnight Season 2" and #g[1].bosses == 4)
check("current season by default", names(B:RouteList()) == names(r))
check("RouteIndex", B:RouteIndex(3445) == 2 and B:RouteIndex(1) == nil)

-- the dev's order, two raids, laid over the shipped one; route IDs with no file are skipped
local fired = 0
B:OnRouteChange(function() fired = fired + 1 end)
CRT.db.dev = { bossRoute = { ["midnight-s1"] = {
  { key = "a", name = "Raid A", bosses = { 3445, 1234 } },
  { key = "b", name = "Raid B", bosses = { 3420, 3470 } },
} } }
B:FireRoute()
check("change event fires", fired == 1)
g = B:Route("midnight-s1")
check("dev order applies, grouped by raid", #g == 2 and g[1].raid.name == "Raid A" and names(g[1].bosses) == "Entombed Sentinels" and names(g[2].bosses) == "Sszorak, Nek'zali the Soulcoiler, New Boss")
local _, custom = B:Raids("midnight-s1")
check("Raids says the order is the dev's", custom == true)
CRT.db.dev.bossRoute = {}
check("reset: shipped order again", names(B:RouteList("midnight-s1")) == "Nek'zali the Soulcoiler, Entombed Sentinels, Sszorak, New Boss")
-- a boss added for a .5 or .7 patch: named in the route only, { id, name }, with no boss file
CRT.db.dev = { bossRoute = { ["midnight-s1"] = {
  { key = "a", name = "Raid A", bosses = { 3445, { id = 3601, name = "Patch Boss" }, { id = 3602 } } },
} } }
g = B:Route("midnight-s1")
check("a route-only boss is listed where it was added: " .. names(g[1].bosses), names(g[1].bosses):find("^Entombed Sentinels, Patch Boss") ~= nil)
check("a route-only boss is a stub of its season", B:Get(3601) and B:Get(3601).stub and B:Get(3601).season == "midnight-s1")
check("an entry with no name stays skipped", B:Get(3602) == nil)
check("EntryID reads both forms", B.EntryID(3445) == 3445 and B.EntryID({ id = 3601 }) == 3601 and B.EntryID("x") == nil)
B:Register({ encounterID = 3601, name = "Patch Boss", season = "midnight-s1", references = {} })
check("its boss file replaces the stub", B:Get(3601).stub == nil and B:Get(3601).references ~= nil)
local n601 = 0 for _, id in ipairs(B.order) do if id == 3601 then n601 = n601 + 1 end end
check("listed once", n601 == 1)
B:Season({ key = "s9", name = "Next", raids = { { key = "r", name = "R", bosses = { { id = 4100, name = "Shipped Stub" }, 3445 } } } })
check("Season.lua can name a boss with no file", B:Get(4100) and B:Get(4100).stub and B:Get(4100).season == "s9" and B:Get(3445).stub == nil)
CRT.db.dev = nil
print(fails == 0 and "all passed" or (fails .. " failed"))
if fails > 0 then error(fails .. " failed", 0) end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['Bosses/Registry.lua', 'Seasons/Midnight-S1/Season.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
