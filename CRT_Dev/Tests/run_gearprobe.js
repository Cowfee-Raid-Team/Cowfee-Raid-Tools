// The dev gear probe (CRT_Dev/Dev/GearProbe.lua, /crt dev gear): your items' and a seen player's item, enchant,
// gem and bonus IDs, which season checks each trips, and the slash command routing.
// Usage: node run_gearprobe.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local gearSrc, registrySrc, dataSrc, probeSrc = ...
local fails, passes = 0, 0
local realPrint = print -- the probe prints with print, so the harness catches it below
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 realPrint("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
local printed = {}
print = function(t) printed[#printed + 1] = t end
local LINKS = { [1] = "|cffa335ee|Hitem:101:7364:213746:::::::::28:2:5001:9|h[Helm]|h|r", [2] = "|cffa335ee|Hitem:102|h[Chain]|h|r" }
GetInventoryItemLink = function(unit, slot) return LINKS[slot] end
GetInventoryItemID = function(unit, slot) local l = LINKS[slot] return l and tonumber(l:match("item:(%d+)")) end
C_Item = { GetDetailedItemLevelInfo = function() return 280 end, GetItemInfoInstant = function() return 1, "", "", "INVTYPE_HEAD" end }
CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function() end } end
local CRT = { db = { gearChecker = {} } }
function CRT:Print(t) printed[#printed + 1] = t end
for _, src in ipairs({ gearSrc, registrySrc, dataSrc, probeSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
local Probe, Gear, B = CRT.GearProbe, CRT.Gear, CRT.Bosses
B:Season({ key = "t", name = "T", order = 1, current = true })
B:SeasonData("t", "gearChecks", { checks = { { key = "glow", label = "Glow", kind = "bonusIds", ids = { 5001 } } } })

check(Probe:Command("dev gear", "dev gear"), "dev gear is its command")
eq(printed[1], "Gear probe: you (2 items). Paste the IDs into the season's GearChecks.lua.", "the heading")
eq(printed[2], "  Head: item 101, enchant 7364, gems 213746, bonus 5001,9 | trips: glow", "your head: every ID, and the check it trips")
eq(printed[3], "    item:101:7364:213746:::::::::28:2:5001:9", "and its item string")
eq(printed[4], "  Neck: item 102, enchant -, gems -, bonus -", "nothing in it: dashes")
printed = {}
Gear:Remember("Quick-Sargeras", { { slot = 2, id = 102, itemString = "item:102" } }, "gearcheck", true)
check(Probe:Command("dev gear quick", "dev gear Quick"), "dev gear <name>")
eq(printed[1], "Gear probe: Quick-Sargeras (1 item). Paste the IDs into the season's GearChecks.lua.", "a seen player, by short name")
printed = {}
Probe:Command("dev gear nobody", "dev gear Nobody")
eq(printed[1], "Gear probe: nothing known for Nobody. Refresh the Gear Checker first.", "a player not seen")
check(not Probe:Command("dev gearx", "dev gearx"), "dev gearx is not this one")
check(not Probe:Command("dev loot", "dev loot"), "another dev command is not this one")

print = realPrint
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Gear.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Modules/GearChecker/Data.lua', 'CRT_Dev/Dev/GearProbe.lua'];
for (const f of files) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
