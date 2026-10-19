// Loot/RCLC.lua: reading RCLootCouncil's saved awards into Loot History, with stubbed game functions.
// Usage: node run_loot_rclc.js <addon folder>. The fixture below is made up, shaped like the saved data.
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local storeSrc, rcSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function(t) if t then return os.time(t) end return os.time({ year = 2026, month = 10, day = 18, hour = 12 }) end
date = os.date
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
geterrorhandler = function() return print end
GetTime = function() return 0 end
UnitFactionGroup = function() return "Alliance" end
GetRealmName = function() return "Sargeras" end
GetNormalizedRealmName = function() return "Sargeras" end
C_Timer = { After = function() end }
C_AddOns = { IsAddOnLoaded = function(n) return n == "RCLootCouncil" end }
local handlers = {}
function CreateFrame() local f = {} f.RegisterEvent = function() end f.UnregisterEvent = function() end f.SetScript = function(_, _, fn) handlers[#handlers+1] = fn end return f end
local CRT = { db = { loot = { minQuality = 4, keepMonths = 0, rcEnrich = true } } }
function CRT:Print() end
assert(load(storeSrc, "Store.lua"))("CowfeeRaidTools", CRT)
local Loot = CRT.Loot
CRTLootDB = {}
Loot:Migrate()
local function t(y, mo, d, h, mi) return os.time({ year = y, month = mo, day = d, hour = h, min = mi, sec = 0 }) end
local LINK_A = "|cnIQ4:|Hitem:111111::::::::90:102::3:2:6652:12667::::::|h[Fang]|h|r"
local LINK_B = "|cnIQ4:|Hitem:222222::::::::90:102::3:2:6652:12667::::::|h[Mantle]|h|r"
local LINK_OLD = "|cnIQ4:|Hitem:333333::::::::90:102::3:1:6652::::::|h[Old Mantle]|h|r"
local recA = Loot:Add({ time = t(2026, 10, 6, 20, 15), encounterID = 3001, instance = "Raid", difficultyID = 15, player = "Quickstab-Sargeras", classID = 4, itemString = "item:111111::::::::90:102" })
local recB = Loot:Add({ time = t(2026, 10, 6, 21, 2), encounterID = 3002, instance = "Raid", difficultyID = 15, player = "Halo-Sargeras", classID = 5, itemString = "item:222222::::::::90:102" })
RCLootCouncilLootDB = { factionrealm = { ["Alliance - Sargeras"] = {
  ["Quickstab-Sargeras"] = { {
    lootWon = LINK_A, date = "2026/10/06", time = "20:16:00", response = "Mainspec/Need", responseID = 1,
    color = { 0, 1, 0, 1 }, class = "ROGUE", boss = "Boss One", instance = "Raid-Heroic", mapID = 3004,
    difficultyID = 15, groupSize = 20, iClass = 2, iSubClass = 15, id = "1-1", owner = "Halo-Sargeras",
    isAwardReason = false, votes = 3, typeCode = "default", roll = 71, note = "4pc", ilvl = 280.5,
    itemReplaced1 = LINK_OLD, sessionResponses = {
      ["Quickstab-Sargeras"] = { response = 1, roll = 71, ilvl = 280.5, class = "ROGUE" },
      ["Arrowyn-Sargeras"] = { response = 2, roll = 88, ilvl = 281, class = "HUNTER" },
      ["Halo-Sargeras"] = { response = "PASS", ilvl = 285, class = "PRIEST" },
    },
  } },
  ["Halo-Sargeras"] = { {
    lootWon = LINK_B, date = "2026/10/06", time = "21:05:00", response = "Offspec/Greed", responseID = 2,
    color = { 1, 0.5, 0, 1 }, class = "PRIEST", boss = "Boss Two", difficultyID = 15, typeCode = "default", votes = 0,
  } },
  ["Arrowyn-Sargeras"] = { {
    lootWon = LINK_B, date = "2025/03/20", time = "22:16:00", response = "Personal Loot - Non tradeable", responseID = "PL",
    color = { 1, 1, 1, 1 }, class = "HUNTER", boss = "Old Boss", difficultyID = 14,
  }, {
    lootWon = LINK_A, date = "20/03/25", time = "22:17", response = "Mainspec/Need", responseID = 1, class = "HUNTER",
  }, {
    lootWon = LINK_A, date = "2026/13/40", time = "22:17:00", response = "Broken date", class = "HUNTER",
  } },
} } }
local RC = CRT.LootRCLC
if not RC then assert(load(rcSrc, "RCLC.lua"))("CowfeeRaidTools", CRT) RC = CRT.LootRCLC end

-- the date and time, in both formats RCLootCouncil has used
eq(RC.ParseTime and RC.ParseTime("2026/10/06", "20:16:00"), t(2026, 10, 6, 20, 16), "YYYY/MM/DD date")
eq(RC.ParseTime and RC.ParseTime("06/10/26", "20:16:00"), t(2026, 10, 6, 20, 16), "DD/MM/YY date")
eq(RC.ParseTime and RC.ParseTime("2026/10/06", "20:16"), t(2026, 10, 6, 20, 16), "time without seconds")
eq(RC.ParseTime and RC.ParseTime("2026/13/40", "20:16:00"), nil, "an impossible date is nil")
eq(RC.ParseTime and RC.ParseTime(nil, "20:16:00"), nil, "no date is nil")

local report = RC:Scan()
eq(report.awards, 5, "awards counted")
eq(report.matched, 2, "awards matched to records")
eq(report.unmatched, 3, "awards not matched")
local a = Loot.rc[recA]
check(a ~= nil, "record A has its award")
a = a or {}
eq(a.response, "Mainspec/Need", "response")
eq(a.color and a.color[2], 1, "colour")
eq(a.votes, 3, "votes")
eq(a.note, "4pc", "note")
eq(a.roll, 71, "roll")
eq(a.ilvl, 280.5, "item level")
eq(a.class, "ROGUE", "class")
eq(a.boss, "Boss One", "boss")
eq(a.instance, "Raid-Heroic", "instance")
eq(a.groupSize, 20, "group size")
eq(a.owner, "Halo-Sargeras", "owner")
eq(a.typeCode, "default", "type code")
eq(a.time, t(2026, 10, 6, 20, 16), "award time")
eq(a.winner, "Quickstab-Sargeras", "winner")
eq(a.link, LINK_A, "item link")
eq(a.replaced and a.replaced[1], LINK_OLD, "gear replaced 1")
eq(a.replaced and #a.replaced, 1, "only the replaced items there are")
eq(a.candidates and #a.candidates, 3, "every candidate")
local c1 = a.candidates and a.candidates[1] or {}
eq(c1.name, "Quickstab-Sargeras", "candidates sorted: the best response first")
eq(c1.response, "Mainspec/Need", "a candidate's response number named from the awards")
eq(c1.roll, 71, "candidate roll")
local c2 = a.candidates and a.candidates[2] or {}
eq(c2.name, "Arrowyn-Sargeras", "second candidate")
eq(c2.response, "Offspec/Greed", "response 2 named from another award")
local c3 = a.candidates and a.candidates[3] or {}
eq(c3.response, "PASS", "a text response stays as it is")
eq(Loot.rc[recB] and Loot.rc[recB].response, "Offspec/Greed", "record B matched")
eq(RC.ResponseName and RC:ResponseName("default", 9), "Response 9", "an unknown response number")

-- the awards CRT never recorded, newest first, for the History list
local un = RC.unmatched or {}
eq(#un, 3, "unmatched awards kept for the list")
eq(un[1] and un[1].time, t(2025, 3, 20, 22, 17), "newest unmatched first (the DD/MM/YY one)")
eq(un[#un] and un[#un].time, nil, "the broken date sorts last")
eq(un[2] and un[2].responseID, "PL", "personal loot award")

-- turning matching off clears everything
CRT.db.loot.rcEnrich = false
RC:Scan()
eq(next(Loot.rc), nil, "off: no matches")
eq(#(RC.unmatched or {}), 0, "off: no unmatched awards")
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, 'Loot/Store.lua'), 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, 'Loot/RCLC.lua'), 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
