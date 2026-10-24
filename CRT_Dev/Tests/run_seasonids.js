// The dev encounter ID check (CRT_Dev/Dev/SeasonTools.lua, /crt dev seasons ids): each loaded boss file's
// encounterID and name against the Timeline's saved pulls, one line per boss, and the Copy box text.
// Sample pack and stub saved pulls only, never shipped data.
// Usage: node run_seasonids.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = String.raw`
local registrySrc, seasonSrc, nekSrc, sszSrc, toolsSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("PASS " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function() end } end
local printed, shown = {}, nil
local CRT = { db = {}, UI = {} }
function CRT:Print(t) printed[#printed + 1] = t end
CRT.ConsumablesTools = { ShowText = function(_, title, text) shown = { title = title, text = text } end }
assert(load(registrySrc, "Registry.lua"))("CowfeeRaidTools", CRT)
assert(load(seasonSrc, "Season.lua"))("CowfeeRaidTools", CRT)
assert(load(nekSrc, "Nekzali.lua"))("CowfeeRaidTools", CRT)
assert(load(sszSrc, "Sszorak.lua"))("CowfeeRaidTools", CRT)
assert(load(toolsSrc, "SeasonTools.lua"))("CowfeeRaidTools", CRT)
local B, Tools = CRT.Bosses, CRT.SeasonTools
-- two more sample bosses, registered here: one whose ID was saved under another name, one never pulled
B:Register({ encounterID = 3445, name = "Entombed Sentinels", season = "sample" })
B:Register({ encounterID = 3455, name = "Vashnik the Malignant", season = "sample" })

-- nothing saved at all
local lines, counts = Tools:IdsReport()
eq(#lines, 4, "one line per boss, nothing saved")
eq(lines[1], "Nek'zali the Soulcoiler (3470): never pulled", "route order, never pulled")
eq(counts.never, 4, "every boss never pulled")

CRT.db.timeline = { bosses = {
    [3420] = { name = "Sszorak", pulls = { {}, {} } },                -- same ID, same name
    [3999] = { name = "Nek’zali the Soulcoiler", pulls = { {} } },     -- same name (curly apostrophe), another ID
    [3445] = { name = "Somebody Else", pulls = { {} } },               -- same ID, another name
    [5000] = { name = "Mystery Boss", pulls = { {}, {}, {} } },        -- no boss file
} }
lines, counts = Tools:IdsReport()
eq(lines[1], "Nek'zali the Soulcoiler (3470): mismatched, the game pulled it as 3999 (1 saved pull)", "same name, another ID")
eq(lines[2], "Entombed Sentinels (3445): mismatched, the saved pull with this ID is named Somebody Else", "same ID, another name")
eq(lines[3], "Vashnik the Malignant (3455): never pulled", "no saved pull")
eq(lines[4], "Sszorak (3420): confirmed (2 saved pulls)", "same ID and name")
eq(lines[5], "Mystery Boss (5000): saved pulls (3), no boss file", "a saved boss with no file is listed after")
eq(lines[6], nil, "the mismatched name isn't listed again as having no file")
eq(counts.confirmed, 1, "confirmed count")
eq(counts.mismatched, 2, "mismatched count")
eq(counts.never, 1, "never pulled count")

-- the command: a heading and every line in chat, the same text in the Copy box
printed, shown = {}, nil
Tools:Ids()
eq(printed[1], "Encounter ID check: 1 confirmed, 2 mismatched, 1 never pulled.", "the heading")
eq(printed[2], "  " .. lines[1], "each line in chat")
eq(#printed, 6, "heading and five lines")
check(shown and shown.title:find("Encounter ID check") ~= nil, "the Copy box opens")
check(shown and shown.text == printed[1] .. "\n" .. table.concat(lines, "\n"), "the Copy box holds the same text")

-- broken saved data never errors
CRT.db.timeline = { bosses = { [3420] = "junk", [77] = { name = 5 } } }
lines = Tools:IdsReport()
eq(lines[4], "Sszorak (3420): never pulled", "a saved entry that isn't a table counts as no pull")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua', 'CRT_Dev/Tests/SamplePack/Sszorak.lua', 'CRT_Dev/Dev/SeasonTools.lua'];
for (const f of files) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
