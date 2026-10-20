// CRT_Modules/Notes/Data.lua: Notes:List() follows the raid route by each note's EncounterID, Mythic before
// Heroic, notes for bosses outside the route last by name.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local reg, season, data = ...
function CreateFrame() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function() end } end
local CRT = { db = { notes = { list = {}, nextId = 1 } }, NoteParser = {} }
assert(load(reg, "Registry.lua"))("CowfeeRaidTools", CRT)
assert(load(season, "Season.lua"))("CowfeeRaidTools", CRT)
assert(load(data, "Data.lua"))("CowfeeRaidTools", CRT)
local B = CRT.Bosses
for _, b in ipairs({ { 3470, "Nek'zali the Soulcoiler" }, { 3445, "Entombed Sentinels" }, { 3420, "Sszorak" }, { 3421, "The Twin Fangs" }, { 3455, "Vashnik the Malignant" } }) do
  B:Register({ encounterID = b[1], name = b[2], season = "midnight-s1" })
end
local list = CRT.db.notes.list
list[1] = { name = "Vashnik the Malignant", encounterID = 3455, difficulty = "Mythic" }
list[2] = { name = "Kith'ix", encounterID = 1111, difficulty = "Heroic" }
list[3] = { name = "Sszorak", encounterID = 3420, difficulty = "Mythic" }
list[4] = { name = "Twin Fangs", encounterID = 3421, difficulty = "Mythic" }
list[5] = { name = "Sentinels", encounterID = 3445, difficulty = "Heroic" }
list[6] = { name = "Nek'zali", encounterID = 3470, difficulty = "Mythic" }
list[7] = { name = "Sentinels", encounterID = 3445, difficulty = "Mythic" }
list[8] = { name = "Aardvark", difficulty = "Mythic" }
local out = {}
for _, e in ipairs(CRT.Notes:List()) do out[#out + 1] = e.record.name .. " (" .. (e.record.difficulty or "") .. ")" end
local got = table.concat(out, ", ")
local want = "Nek'zali (Mythic), Sentinels (Mythic), Sentinels (Heroic), Vashnik the Malignant (Mythic), Sszorak (Mythic), Twin Fangs (Mythic), Aardvark (Mythic), Kith'ix (Heroic)"
print((got == want and "PASS " or "FAIL ") .. "notes in route order: " .. got)
print(got == want and "all passed" or "1 failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Data/Bosses/Registry.lua', 'CRT_Data/Seasons/Midnight-S1/Season.lua', 'CRT_Modules/Notes/Data.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2] + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
