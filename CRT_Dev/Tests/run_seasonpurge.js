// The season purge (CRT_Dev/Dev/SeasonTools.lua, /crt dev seasons) and the per-boss store declarations
// (Bosses:DeclareStore, CRT_Data/Bosses/Registry.lua): every known per-encounter saved table is declared by the
// module that owns it, a purge clears each one for the purged season's bosses (and the season-keyed ones), and
// long-term data (Season Stats, Tattlebot, raid notes and their history, the Late Tracker, loot history, the
// longTerm area) is never touched. Also /crt dev seasons clearstats <key>: one season's Season Stats counters,
// asked first. Each module file is loaded with stand-ins for whatever it reads at load, so only the
// declarations it makes count. Sample pack only, never shipped data.
// Usage: node run_seasonpurge.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const files = [
  'CRT_Data/Bosses/Registry.lua',
  'CRT_Modules/Timeline/Data.lua',
  'CRT_Modules/Alerts/Reminders.lua',
  'CRT_Modules/Alerts/Special.lua',
  'CRT_Modules/SeasonStats/Data.lua',
  'CRT_Modules/Alerts/Phases.lua',
  'CRT_Modules/Markers/Display.lua',
  'CRT_Modules/Pace/Data.lua',
  'CRT_Dev/Tests/SamplePack/Season.lua',
  'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Dev/Tests/SamplePack/Sszorak.lua',
  'CRT_Dev/Dev/MarkerEditor.lua',
  'CRT_Dev/Dev/SeasonTools.lua',
  'CRT_Dev/Dev/BossOrder.lua',
  'CRT_Core/Slash.lua',
  'CRT_Core/Core.lua',
];
const harness = String.raw`
local srcs = { ... }
local names = { ` + files.map(f => JSON.stringify(f)).join(', ') + String.raw` }
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("PASS " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end

-- Stand-ins: anything a file reads at load that isn't loaded here is a table that answers every field and call.
local proxyMT = {}
local function proxy() return setmetatable({}, proxyMT) end
proxyMT.__index = function(t, k) local p = proxy() rawset(t, k, p) return p end
proxyMT.__call = function() return proxy() end
setmetatable(_G, { __index = function(_, k) return proxy() end })
strtrim = function(s) return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end
CANCEL = "Cancel"
SlashCmdList = {}
UISpecialFrames = {}
issecretvalue = function() return false end
local asked
StaticPopup_ShowCustomGenericConfirmation = function(info) asked = info end
local printed = {}
local CRT = setmetatable({ db = {}, name = "CowfeeRaidTools" }, { __index = function(t, k) local p = proxy() rawset(t, k, p) return p end })
function CRT:Print(t) printed[#printed + 1] = t end

local loaded = {}
for i, src in ipairs(srcs) do
  if names[i] ~= "CRT_Core/Core.lua" then
    local fn, err = load(src, names[i])
    if not fn then print("LUA ERROR " .. tostring(err)) fails = fails + 1 else
      local ok, e = pcall(fn, "CowfeeRaidTools", CRT)
      check(ok, "loads " .. names[i] .. (ok and "" or (": " .. tostring(e))))
    end
  end
  loaded[names[i]] = src
end
local B, Tools, Stats = CRT.Bosses, CRT.SeasonTools, CRT.SeasonStats
-- an older season of the test's own, so a purge is seen to leave the other season alone
B:Season({ key = "older", name = "Older Season", order = 0 })
B:Register({ encounterID = 9100, name = "Old Boss", season = "older" })

-- 1. Every known per-encounter store is declared -------------------------------------------------------------------
-- path, how it is keyed ("id" encounter ID, "text" the ID as text, "season" the season key)
local KNOWN = {
  { "timeline.bosses", "id" }, { "timeline.rows", "id" }, { "timeline.reviewRefs", "id" }, { "timeline.orders", "id" },
  { "timeline.ignored", "text" }, { "timeline.abilities", "text" }, { "timeline.pullNumberBackup", "id" },
  { "alerts.reminders", "id" }, { "alerts.anyBackup", "id" }, { "alerts.phases", "id" }, { "alerts.special", "id" },
  { "pace.own", "id" }, { "pace.shared", "id" }, { "pace.use", "id" }, { "pace.disabled", "id" },
  { "markers.disabled", "id" },
  { "dev.markerDisplays", "id" }, { "dev.hiddenAbilities", "text" }, { "dev.mechHidden", "text" },
  { "dev.bossRoute", "season" },
}
local function at(db, p, make)
  local t = db
  for part in p:gmatch("[^.]+") do
    if t[part] == nil and make then t[part] = {} end
    t = t[part]
    if t == nil then return nil end
  end
  return t
end
local db = {}
for _, k in ipairs(KNOWN) do at(db, k[1], true) end
local declared = B:Stores()
for _, k in ipairs(KNOWN) do
  local want, found = at(db, k[1]), nil
  for _, s in ipairs(declared) do
    local ok, t = pcall(s.getter, db)
    if ok and t == want then found = s end
  end
  check(found ~= nil, k[1] .. " is declared")
  if found then
    eq(found.bySeason, k[2] == "season", k[1] .. " is keyed by " .. (k[2] == "season" and "season" or "encounter ID"))
    check(type(found.label) == "string" and found.label ~= "", k[1] .. " has a label")
  end
end
eq(#declared, #KNOWN, "no store declared twice or unknown to this list")
-- a getter with no saved data yet is nil, never an error
for _, s in ipairs(declared) do
  local ok, t = pcall(s.getter, {})
  check(ok and t == nil, s.label .. ": nothing saved yet reads as nil")
end
-- a store declared again (a file loaded twice) replaces itself
local n0 = #B:Stores()
B:DeclareStore(declared[1].label, declared[1].getter)
eq(#B:Stores(), n0, "declaring a label again replaces it")

-- 2. A purge clears each one, for the purged season only ---------------------------------------------------------
local SSZ, NEK, OLD = 3420, 3470, 9100
CRT.db = {}
for _, k in ipairs(KNOWN) do
  local t = at(CRT.db, k[1], true)
  if k[2] == "season" then
    t.sample = { { key = "r", bosses = { SSZ } } }
    t.older = { { key = "o", bosses = { OLD } } }
  elseif k[2] == "text" then
    t[tostring(SSZ)] = { x = true }
    t[tostring(NEK)] = { x = true }
    t[tostring(OLD)] = { x = true }
  else
    t[SSZ] = { x = true }
    t[NEK] = { x = true }
    t[OLD] = { x = true }
  end
end
-- long-term data, which a purge never touches
CRT.db.seasonStats = { bosses = { [SSZ] = { name = "Sszorak", nh = { pulls = 4 } }, [OLD] = { name = "Old Boss", nh = { pulls = 9 } } } }
CRT.db.tattle = { history = { { id = 1, season = "Season 1", pulls = { { encounterID = SSZ } } } }, custom = { [555] = { name = "Puddle", encounterID = SSZ } } }
CRT.db.late = { history = { { id = 1 } } }
CRT.db.notes = { list = { [1] = { raw = "x", encounterID = SSZ } }, history = { [1] = { "old" } }, personalShifts = { [1] = { k = { ph = 1, t = 5, raw = "x" } } } }
CRT.db.longTerm = { kept = { [SSZ] = true } }
CRTLootDB = { bosses = { [SSZ] = "Sszorak" }, records = { { encounterID = SSZ } } }
local counts, total, bosses = Tools:PurgeCounts("sample")
eq(bosses, 2, "the sample season has two bosses with files")
eq(#counts, #KNOWN, "the purge would clear something in every declared store")
eq(total, (#KNOWN - 1) * 2 + 1, "two bosses in each store, and the season's own boss order")
local n = Tools:Purge("sample")
eq(n, total, "the purge deletes what it counted")
for _, k in ipairs(KNOWN) do
  local t = at(CRT.db, k[1])
  if k[2] == "season" then
    eq(t.sample, nil, k[1] .. ": the purged season's entry is gone")
    check(t.older ~= nil, k[1] .. ": the other season's is kept")
  else
    local key = function(id) return k[2] == "text" and tostring(id) or id end
    eq(t[key(SSZ)], nil, k[1] .. ": Sszorak's entry is gone")
    eq(t[key(NEK)], nil, k[1] .. ": Nek'zali's entry is gone")
    check(t[key(OLD)] ~= nil, k[1] .. ": the other season's boss is kept")
  end
end
check(CRT.db.seasonStats.bosses[SSZ] ~= nil, "Season Stats are kept")
eq(#CRT.db.tattle.history, 1, "Tattlebot's history is kept")
check(CRT.db.tattle.custom[555] ~= nil, "Tattlebot's own tracked spells are kept")
eq(#CRT.db.late.history, 1, "the Late Tracker is kept")
check(CRT.db.notes.list[1] ~= nil and CRT.db.notes.history[1] ~= nil, "raid notes and note history are kept")
check(CRT.db.notes.personalShifts[1] ~= nil, "your own Healer CDs times (by note) are kept with their notes")
check(CRT.db.longTerm.kept[SSZ], "the longTerm area is kept")
check(CRTLootDB.bosses[SSZ] ~= nil and #CRTLootDB.records == 1, "loot history is kept")
local _, again = Tools:PurgeCounts("sample")
eq(again, 0, "nothing left to purge")
-- the purge confirmation names what is kept
printed, asked = {}, nil
CRT.db.timeline.bosses[SSZ] = { name = "Sszorak", pulls = {} }
Tools:ConfirmPurge(B.seasons.sample)
check(asked ~= nil and asked.text:find("recorded Timeline pulls", 1, true) ~= nil, "the confirmation lists the store it clears")
check(asked ~= nil and asked.text:find("Season Stats", 1, true) ~= nil, "and says Season Stats are kept")
-- the (?) text lists every declared store
local help = Tools:PurgeHelp()
for _, s in ipairs(declared) do
  check(help:find(s.label, 1, true) ~= nil, "the purge help lists " .. s.label)
end

-- 3. Season Stats: clear one season's counters, asked first --------------------------------------------------------
CRT.db.seasonStats = { filled = true, bosses = { [SSZ] = { name = "Sszorak", nh = { pulls = 4 } }, [NEK] = { name = "Nek", mythic = { pulls = 1 } }, [OLD] = { name = "Old Boss", nh = { pulls = 9 } } } }
eq(Stats:ClearSeason("older"), 1, "ClearSeason clears the season's bosses with counters")
eq(CRT.db.seasonStats.bosses[OLD], nil, "the older season's counters are gone")
check(CRT.db.seasonStats.bosses[SSZ] ~= nil and CRT.db.seasonStats.bosses[NEK] ~= nil, "the other season's are kept")
eq(CRT.db.seasonStats.filled, true, "and the one-time fill is not run again")
CRT.db.seasonStats.bosses[OLD] = { name = "Old Boss", nh = { pulls = 9 } }
printed, asked = {}, nil
SlashCmdList.COWFEERAIDTOOLS("dev seasons clearstats SAMPLE")
check(asked ~= nil, "/crt dev seasons clearstats asks first")
check(CRT.db.seasonStats.bosses[SSZ] ~= nil, "and clears nothing before the answer")
check(asked and asked.text:find("Sample Season", 1, true) or (asked and asked.text_arg1 == "Sample Season"), "the question names the season")
if asked then asked.callback() end
eq(CRT.db.seasonStats.bosses[SSZ], nil, "accepted: Sszorak's counters are gone")
eq(CRT.db.seasonStats.bosses[NEK], nil, "and Nek'zali's")
check(CRT.db.seasonStats.bosses[OLD] ~= nil, "the other season's are kept")
check(printed[#printed] and printed[#printed]:find("2", 1, true) ~= nil, "it says how many bosses were cleared")
printed, asked = {}, nil
SlashCmdList.COWFEERAIDTOOLS("dev seasons clearstats nope")
eq(asked, nil, "an unknown season key asks nothing")
check(printed[1] and printed[1]:find("sample", 1, true) ~= nil, "and lists the season keys")
printed, asked = {}, nil
SlashCmdList.COWFEERAIDTOOLS("dev seasons clearstats sample")
eq(asked, nil, "a season with no counters asks nothing")
check(printed[1] ~= nil, "and says so")
local slash = loaded["CRT_Core/Slash.lua"]
local a, b = slash:find("--@do-not-package@", 1, true), slash:find("--@end-do-not-package@", 1, true)
local c = slash:find("clearstats", 1, true)
check(a and b and c and c > a and c < b, "the command is inside the do-not-package block")

-- 4. The longTerm area and the store list in Core.lua --------------------------------------------------------------
local core = loaded["CRT_Core/Core.lua"]
check(core:find("\n    longTerm = {},", 1, true) ~= nil, "Core.lua has a longTerm default")
for _, s in ipairs({ "seasonStats", "tattle.history", "notes.list", "notes.history", "notes.personalShifts", "timeline.healerRows", "late.history", "CRTLootDB" }) do
  check(core:find(s, 1, true) ~= nil, "Core.lua's store list names " .. s)
end
check(core:find("DeclareStore", 1, true) ~= nil, "Core.lua says per-season stores are declared")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
