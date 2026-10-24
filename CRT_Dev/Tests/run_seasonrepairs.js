// Season Stats' repairs (CRT_Modules/SeasonStats/Repairs.lua): your own repair bill per pull, read from your gear's
// tooltip data (C_TooltipInfo.GetInventoryItem(...).repairCost) right at the pull and again out of combat after it,
// added to the boss's counters once, through the Timeline's save hook; the raid's costs, one small CRTRepair message
// per raider per pull (versioned), summed by every CRT client with duplicates, secret senders and finder groups left
// out; cheap: only damaged slots read, nothing read twice for the same durability, nothing at all outside a raid.
// Usage: node run_seasonrepairs.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local timelineSrc, registrySrc, dataSrc, repairsSrc, coreSrc, tocSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
issecretvalue = function(v) return v == "SECRET" end
format = string.format
date = os.date
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
local NOW = os.time({ year = 2026, month = 10, day = 20, hour = 20, min = 0, sec = 0 })
local now = NOW
time = function(t) if t then return os.time(t) end return now end
local serverNow = 1800000000
GetServerTime = function() return serverNow end
local clock = 1000
GetTime = function() return clock end
-- timers run when the test says so
local timers = {}
C_Timer = { After = function(d, fn) timers[#timers + 1] = fn end, NewTicker = function() return { Cancel = function() end } end }
local function runTimers() for _ = 1, 10 do local list = timers timers = {} if #list == 0 then return end for _, fn in ipairs(list) do fn() end end end

-- frames: events kept so the test sees what is registered
local made = {}
local function mock()
  local o = { shown = true, scripts = {}, events = {}, kids = {} }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      RegisterEvent = function(self, e) self.events[e] = true end,
      UnregisterEvent = function(self, e) self.events[e] = nil end,
      UnregisterAllEvents = function(self) self.events = {} end,
      IsEventRegistered = function(self, e) return self.events[e] == true end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
CreateFrame = function(_, name) local f = mock() f.name = name made[#made + 1] = f return f end
UIParent = mock()

-- the game: a raid instance, your gear, the group, addon messages
local instance = { "Raid One", "raid", 16 }
GetInstanceInfo = function() return instance[1], instance[2], instance[3] end
local combat = false
InCombatLockdown = function() return combat end
local inRaid, instanceGroup = true, false
IsInRaid = function() return inRaid end
IsInGroup = function(cat) if cat == LE_PARTY_CATEGORY_INSTANCE then return instanceGroup end return inRaid end
LE_PARTY_CATEGORY_HOME, LE_PARTY_CATEGORY_INSTANCE = 1, 2
GetNumGroupMembers = function() return 20 end
UnitName = function(u) if u == "player" then return "Cowfee" end return nil end
UnitFullName = function(u) if u == "player" then return "Cowfee", "Stormrage" end end
GetNormalizedRealmName = function() return "Stormrage" end
Ambiguate = function(name) return (name:gsub("%-.*$", "")) end
UnitGUID = function() return nil end
UnitGroupRolesAssigned = function() return "NONE" end
-- gear: slot -> { cur, max, cost }; the head, chest, legs and both weapons have durability, the neck none
local gear = {}
local function fullGear()
  gear = { [1] = { 100, 100, 0 }, [5] = { 120, 120, 0 }, [7] = { 100, 100, 0 }, [16] = { 80, 80, 0 }, [17] = { 60, 60, 0 } }
end
fullGear()
local function damage(slot, points, cost) local g = gear[slot] g[1] = g[1] - points g[3] = g[3] + cost end
local durabilityCalls, tipCalls = 0, 0
GetInventoryItemDurability = function(slot) durabilityCalls = durabilityCalls + 1 local g = gear[slot] if g then return g[1], g[2] end end
local itemIDs = {}
GetInventoryItemID = function(unit, slot) if gear[slot] then return itemIDs[slot] or (1000 + slot) end end
local secretCost = false
C_TooltipInfo = { GetInventoryItem = function(unit, slot)
  tipCalls = tipCalls + 1
  local g = gear[slot]
  if unit ~= "player" or not g then return nil end
  return { type = 0, lines = {}, repairCost = secretCost and "SECRET" or (g[3] > 0 and g[3] or nil) }
end }
local sent = {}
Enum = { SendAddonMessageResult = { Success = 0, AddonMessageThrottle = 3, AddOnMessageLockdown = 11 } }
local sendResult = 0
local prefixes = {}
local chatLocked = false
C_ChatInfo = {
  InChatMessagingLockdown = function() return chatLocked end,
  RegisterAddonMessagePrefix = function(p) prefixes[#prefixes + 1] = p return true end,
  SendAddonMessage = function(prefix, text, channel) sent[#sent + 1] = { prefix = prefix, text = text, channel = channel } return sendResult end,
}
C_DamageMeter = { GetCombatSessionFromType = function() return nil end }
GetMoneyString = function(copper, sep) return "M" .. tostring(copper) end

local CRT = { UI = {}, db = {
  ui = {},
  timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, nextId = 1 },
} }
function CRT:Print() end
CRT.Groups = { OnChange = function() end, ClassColor = function() return 1, 1, 1 end, ReportName = function(k) return k end }
local coreDefault = coreSrc:match("\\n    seasonStats = (%b{}),")
CRT.db.seasonStats = assert(load("return " .. (coreDefault or "{}")))()
CRT.db.seasonStats.filled = true -- the fill ran long ago
CRT.Alerts = { running = false, OnChange = function() end, Phases = function() return {} end, PhaseStart = function() end }

assert(load(timelineSrc, "Timeline/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(registrySrc, "Registry.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "SeasonStats/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(repairsSrc, "SeasonStats/Repairs.lua"))("CowfeeRaidTools", CRT)
local S, R, T = CRT.SeasonStats, CRT.SeasonRepairs, CRT.Timeline
check(R ~= nil, "CRT.SeasonRepairs exists")
local driver
for _, f in ipairs(made) do if f.scripts.OnEvent and f.events.PLAYER_ENTERING_WORLD and f.name == nil and not driver then
  local before = f.events.ENCOUNTER_START
  f.scripts.OnEvent(f, "PLAYER_ENTERING_WORLD")
  if f.events.CHAT_MSG_ADDON then driver = f end
end end
check(driver ~= nil, "Repairs has a driver that listens on entering the world")
local function fire(event, ...) if driver.events[event] then driver.scripts.OnEvent(driver, event, ...) end T.HandleEvent(event, ...) end
local prefixCount = 0
for _, p in ipairs(prefixes) do if p == R.PREFIX then prefixCount = prefixCount + 1 end end
eq(prefixCount, 1, "the CRTRepair prefix is registered once")
check(#R.PREFIX <= 16, "the prefix fits the game's 16 characters")

-- 1. Reading your repair bill -----------------------------------------------------------------------------------------
R.Forget()
durabilityCalls, tipCalls = 0, 0
eq(R.Read(), 0, "undamaged gear: no repair bill")
eq(tipCalls, 0, "undamaged gear: no tooltip data read")
check(durabilityCalls <= 17, "at most 17 durability reads (" .. durabilityCalls .. ")")
damage(1, 10, 1500) damage(16, 8, 2500)
tipCalls = 0
eq(R.Read(), 4000, "the damaged items' repair costs added up")
eq(tipCalls, 2, "only the damaged slots' tooltip data is read")
tipCalls = 0
eq(R.Read(), 4000, "the same durability again")
eq(tipCalls, 0, "is never read twice")
secretCost = true
damage(5, 1, 100)
eq(R.Read(), nil, "a secret repair cost: no read")
secretCost = false
gear[7] = { 50, 100, 0 } -- damaged, but the game gives no cost for it
eq(R.Read(), nil, "a damaged item with no readable cost: no read")
gear[7] = { 100, 100, 0 }
fullGear() damage(1, 10, 1500)
R.Forget()
eq(R.Read(), 1500, "a damaged helm")
itemIDs[1] = 7777 gear[1][3] = 2600 -- another helm, as worn, at the same durability
eq(R.Read(), 2600, "a swapped item is read again, though its durability is the same")
itemIDs[1] = nil
fullGear()
R.Forget()
check(not dataSrc:find("C_TooltipInfo", 1, true) and not repairsSrc:find("SetInventoryItem", 1, true), "tooltip data only, no tooltip drawn")
check(not repairsSrc:find('"OnUpdate"', 1, true), "no OnUpdate")

-- 2. One pull's bill -------------------------------------------------------------------------------------------------
local Gamma = 9101
fire("PLAYER_ENTERING_WORLD")
damage(5, 12, 3000) -- trash before the pull
combat = true
fire("PLAYER_REGEN_DISABLED")
tipCalls = 0
fire("ENCOUNTER_START", Gamma, "Gamma", 16, 20)
check(tipCalls <= 1, "the read at the pull: only the damaged slot")
clock = clock + 200 now = now + 200
damage(1, 10, 5000) damage(16, 8, 2000) -- you died
fire("ENCOUNTER_END", Gamma, "Gamma", 16, 20, 0)
eq(#sent, 0, "nothing sent in combat")
combat = false
fire("PLAYER_REGEN_ENABLED")
runTimers()
local g = S:Boss(Gamma, "mythic")
check(g ~= nil, "the pull counted")
eq(g and g.pulls, 1, "one pull")
eq(g and g.repairs, 7000, "your repairs: the bill grew by 7000 copper over the pull")
eq(g and g.repairPulls, 1, "one pull measured")
eq(#sent, 1, "one message to the raid")
local m = sent[1]
eq(m and m.prefix, R.PREFIX, "under the CRTRepair prefix")
eq(m and m.channel, "RAID", "to the raid")
local v, enc, grp, key, cost = (m and m.text or ""):match("^(%d+)|(%d+)|(%a+)|(%d+)|(%d+)")
eq(v, tostring(R.VERSION), "with the version first")
eq(tonumber(enc), Gamma, "the encounter")
eq(grp, "mythic", "the difficulty group")
eq(tonumber(key), serverNow, "the pull's start, on the server's clock")
eq(tonumber(cost), 7000, "and the cost in copper")
eq(g and g.raidRepairs, 7000, "your own cost is in the raid's")
eq(g and g.raidReporters, 1, "one reporter so far")
eq(g and g.raidPulls, 1, "on one pull")
-- the save hook again for the same pull counts nothing twice
R:Claim({ encounterID = Gamma, startedAt = NOW }, g)
eq(g.repairs, 7000, "a pull's bill is added once")

-- 3. The others' reports -----------------------------------------------------------------------------------------------
local function hear(sender, text) fire("CHAT_MSG_ADDON", R.PREFIX, text, "RAID", sender) end
hear("Moo-Stormrage", R.Encode(Gamma, "mythic", serverNow + 1, 12000))
hear("Bell-Silvermoon", R.Encode(Gamma, "mythic", serverNow - 1, 3000))
hear("Moo-Stormrage", R.Encode(Gamma, "mythic", serverNow + 1, 12000)) -- sent twice
hear("SECRET", R.Encode(Gamma, "mythic", serverNow, 99999))
hear("Cowfee-Stormrage", m.text) -- your own, echoed back
hear("Moo-Stormrage", "garbage")
fire("CHAT_MSG_ADDON", "OtherPrefix", R.Encode(Gamma, "mythic", serverNow, 55555), "RAID", "Hay-Stormrage")
eq(g.raidRepairs, 22000, "the raid's costs: every raider's once, yours included")
eq(g.raidReporters, 3, "three raiders reported")
eq(g.raidPulls, 1, "still one pull")
eq(g.repairs, 7000, "the others' never in your repairs")
local fired = 0
S:OnChange(function() fired = fired + 1 end)
hear("Hay-Stormrage", R.Encode(Gamma, "mythic", serverNow, 1000))
hear("Dot-Stormrage", R.Encode(Gamma, "mythic", serverNow, 1000))
eq(fired, 0, "reports are only added up as they arrive")
runTimers()
eq(fired, 1, "and the page is told once")
-- reports on pulls this computer never saw are dropped, and never make counters
local function snapshot() return g.raidRepairs .. "/" .. g.raidReporters .. "/" .. g.raidPulls end
local was = snapshot()
hear("Moo-Stormrage", R.Encode(Gamma, "mythic", serverNow + 300, 500))
eq(snapshot(), was, "a report on a pull you didn't see counts nothing")
hear("Moo-Stormrage", R.Encode(Gamma, "nh", serverNow, 800))
eq(S:Boss(Gamma, "nh"), nil, "a report on another difficulty makes no counters")
hear("Moo-Stormrage", R.Encode(77777, "mythic", serverNow, 800))
eq(S:Boss(77777, "mythic"), nil, "a report on a made-up boss makes no counters")
eq(CRT.db.seasonStats.bosses[77777], nil, "nor any saved boss")
-- one sender alternating starts around the pull's counts once at most
for i = 1, 6 do hear("Evil-Stormrage", R.Encode(Gamma, "mythic", serverNow + (i % 2 == 0 and 11 or 0), 100000)) end
for i = 1, 6 do hear("Evil2-Stormrage", R.Encode(Gamma, "mythic", serverNow + (i % 2 == 0 and 11 or -9), 100000)) end
eq(g.raidReporters, 7, "alternating starts: one report each, the far ones dropped")
eq(g.raidRepairs, 224000, "and their cost once each")
eq(g.raidPulls, 1, "still one pull")
-- outside a raid instance nothing is heard
instance = { "Dornogal", "none", 0 }
fire("PLAYER_ENTERING_WORLD")
check(not driver.events.CHAT_MSG_ADDON and not driver.events.ENCOUNTER_START, "outside a raid instance: no events listened to")
local before = g.raidRepairs
driver.scripts.OnEvent(driver, "CHAT_MSG_ADDON", R.PREFIX, R.Encode(Gamma, "mythic", serverNow, 4444), "RAID", "Zed-Stormrage")
eq(g.raidRepairs, before, "and a report there counts nothing")
instance = { "Raid One", "raid", 16 }
fire("PLAYER_ENTERING_WORLD")
check(driver.events.CHAT_MSG_ADDON and driver.events.ENCOUNTER_START, "back in the raid: listening again")

-- 4. The message ---------------------------------------------------------------------------------------------------------
local e1, g1, k1, c1 = R.Decode(R.Encode(1234, "nh", 1800000123, 45678))
eq(table.concat({ tostring(e1), tostring(g1), tostring(k1), tostring(c1) }, ","), "1234,nh,1800000123,45678", "encode and decode")
check(#R.Encode(99999, "mythic", 1800000123, 50000000) < 60, "a small message")
eq(R.Decode("0|1234|nh|1800000123|5"), nil, "an unknown older version is dropped")
eq(R.Decode("2|1234|nh|1800000123|5|more"), 1234, "a newer version with more fields still reads its first ones")
eq(R.Decode("1|1234|heroic|1800000123|5"), nil, "an unknown difficulty group is dropped")
eq(R.Decode("1|1234|nh|1800000123|-5"), nil, "a negative cost is dropped")
eq(R.Decode("1|1234|nh|1800000123|999999999999"), nil, "an absurd cost is dropped")
eq(R.Decode(nil), nil, "nothing is dropped")

-- 5. A drop, a secret read, a short pull, finder groups -----------------------------------------------------------------
-- repaired at a bot after the read at the start can't happen mid-pull; a smaller bill after is ignored
local Delta = 9102
sent = {}
fullGear() damage(1, 30, 9000)
fire("MERCHANT_CLOSED")
combat = true
fire("ENCOUNTER_START", Delta, "Delta", 15, 20)
fullGear() -- the bill went down
clock = clock + 100 now = now + 100
fire("ENCOUNTER_END", Delta, "Delta", 15, 20, 0)
combat = false
fire("PLAYER_REGEN_ENABLED")
runTimers()
local d = S:Boss(Delta, "nh")
eq(d and d.pulls, 1, "the pull counted")
eq(d and (d.repairs or 0), 0, "a smaller bill after the pull adds nothing")
eq(d and (d.repairPulls or 0), 0, "and isn't a measured pull")
eq(#sent, 0, "and nothing is sent for it")
-- the read at the pull is secret: the last read out of combat stands in
now = now + 600 clock = clock + 600 serverNow = serverNow + 600
fullGear() damage(5, 10, 2000)
fire("UPDATE_INVENTORY_DURABILITY") -- durability changed out of combat: read, 2000
R.Forget() -- so the read at the pull asks the game again
secretCost = true
combat = true
fire("ENCOUNTER_START", Delta, "Delta", 15, 20)
secretCost = false
damage(7, 10, 1000)
fire("UPDATE_INVENTORY_DURABILITY") -- in the pull: nothing read
clock = clock + 100 now = now + 100
fire("ENCOUNTER_END", Delta, "Delta", 15, 20, 0)
-- a raider's report before Season Stats counted the pull waits for it
hear("Moo-Stormrage", R.Encode(Delta, "nh", serverNow + 1, 333))
eq(d.raidRepairs or 0, 0, "a report before the pull is counted waits")
combat = false
fire("PLAYER_REGEN_ENABLED")
runTimers()
eq(d.pulls, 2, "the second pull counted")
eq(d.repairs, 1000, "a secret read at the pull: the last read out of combat is the start")
eq(#sent, 1, "one message for it")
eq(d.raidRepairs, 1333, "once counted, the waiting report and yours are the raid's costs")
eq(d.raidReporters .. "/" .. d.raidPulls, "2/1", "two reports on one pull")
-- a pull the Timeline doesn't keep (too short) adds nothing of yours, but the raid still hears your cost
now = now + 600 clock = clock + 600 serverNow = serverNow + 600
combat = true
fire("ENCOUNTER_START", Delta, "Delta", 15, 20)
damage(1, 5, 700)
clock = clock + 5 now = now + 5
fire("ENCOUNTER_END", Delta, "Delta", 15, 20, 0)
combat = false
fire("PLAYER_REGEN_ENABLED")
runTimers()
eq(d.pulls, 2, "a short pull isn't counted")
eq(d.repairs, 1000, "nor its bill in your repairs")
eq(#sent, 2, "but its cost is sent")
eq(d.raidRepairs, 1333, "and neither yours nor a raider's report of it is in the raid's costs")
hear("Moo-Stormrage", R.Encode(Delta, "nh", serverNow, 444))
eq(d.raidRepairs .. "/" .. d.raidPulls, "1333/1", "Raid costs counts the same pulls as Your repairs")
-- Raid Finder, a finder group and a party send nothing
local function pullOnce(enc, diff)
  now = now + 600 clock = clock + 600 serverNow = serverNow + 600
  combat = true
  fire("ENCOUNTER_START", enc, "Delta", diff, 25)
  damage(16, 1, 100)
  clock = clock + 60 now = now + 60
  fire("ENCOUNTER_END", enc, "Delta", diff, 25, 0)
  combat = false
  fire("PLAYER_REGEN_ENABLED")
  runTimers()
end
sent = {}
instance = { "Raid One", "raid", 17 }
pullOnce(Delta, 17)
eq(#sent, 0, "Raid Finder: nothing sent")
instance = { "Raid One", "raid", 15 }
instanceGroup = true
pullOnce(Delta, 15)
eq(#sent, 0, "a finder group: nothing sent")
instanceGroup = false
inRaid = false
pullOnce(Delta, 15)
eq(#sent, 0, "outside a raid group: nothing sent")
inRaid = true
local raidBefore = S:Boss(Delta, "nh").raidRepairs
hear("Moo-Stormrage", R.Encode(Delta, "nh", serverNow, 100))
instance = { "Raid One", "raid", 17 }
hear("Bell-Silvermoon", R.Encode(Delta, "nh", serverNow, 100))
instance = { "Raid One", "raid", 15 }
eq(S:Boss(Delta, "nh").raidRepairs, raidBefore + 100, "a report heard in Raid Finder counts nothing")
-- throttled: tried again later, never twice
sendResult = 3
sent = {}
pullOnce(Delta, 15)
check(#sent >= 1, "a throttled message is tried")
sendResult = 0
runTimers()
eq(#sent, R.TRIES, "and tried again a few times at most")
-- held by the game's lockdown: tried again until it lifts, sent once
sendResult = 11
sent = {}
pullOnce(Delta, 15)
runTimers() -- runTimers stops after 10 rounds
eq(#sent, R.LOCK_TRIES, "a message the game holds is tried LOCK_TRIES times")
sendResult = 0
sent = {}
chatLocked = true
local heldBy = {}
local realAfter = C_Timer.After
C_Timer.After = function(d, fn) heldBy[#heldBy + 1] = fn end
pullOnce(Delta, 15)
eq(#sent, 0, "during the chat lockdown nothing is sent")
check(#heldBy >= 1, "but a try is waiting")
chatLocked = false
C_Timer.After = realAfter
for _, fn in ipairs(heldBy) do fn() end
eq(#sent, 1, "after it lifts the message goes, once")

-- 6. Cheap: nothing read outside a raid, two reads a pull -------------------------------------------------------------
instance = { "Dornogal", "none", 0 }
fire("PLAYER_ENTERING_WORLD")
durabilityCalls, tipCalls = 0, 0
driver.scripts.OnEvent(driver, "ENCOUNTER_START", 2001, "Dungeon Boss", 8, 5)
driver.scripts.OnEvent(driver, "PLAYER_REGEN_ENABLED")
eq(durabilityCalls + tipCalls, 0, "outside a raid instance nothing is read")
instance = { "Raid One", "raid", 15 }
fire("PLAYER_ENTERING_WORLD")
check(not driver.events.PLAYER_REGEN_ENABLED, "combat's end is only listened to while a pull waits for its read")

-- 7. Saved data -------------------------------------------------------------------------------------------------------
-- counters saved before this update have none of the new fields: they still read as zeros
CRT.db.seasonStats.bosses[9001] = { name = "Alpha", nh = { pulls = 3, wipes = 3, kills = 0, killTime = 0, pullTime = 30, untimed = 0, nights = {}, causes = {}, deaths = {} } }
local row = S:Rows("none", "nh")
local okOld = pcall(function() S:Record({ encounterID = 9001, name = "Alpha", difficultyID = 14, startedAt = NOW + 9999, length = 30, kill = false, deaths = {} }) end)
check(okOld, "old counters take a pull")
eq(S:Boss(9001, "nh").pulls, 4, "and count it")
eq(S:Boss(9001, "nh").repairs or 0, 0, "with no repairs of their own")
check(tocSrc:find("CRT_Modules\\\\SeasonStats\\\\Data.lua\\r?\\nCRT_Modules\\\\SeasonStats\\\\Repairs.lua") ~= nil, "Repairs.lua loads right after Season Stats' data")
for _, name in ipairs({ "Midnight", "midnight-s2", "Season 1" }) do
  check(not repairsSrc:find(name, 1, true), "no season fact in Repairs.lua: " .. name)
end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/Timeline/Data.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Modules/SeasonStats/Data.lua',
  'CRT_Modules/SeasonStats/Repairs.lua', 'CRT_Core/Core.lua', 'CowfeeRaidTools.toc'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
