// CRT_Modules/LootMaster/Rolls.lua: the game's loot rolls with CRT Looting on. One Lua state plays the raid leader and a
// raider in turn. A raider's boss roll is passed once (RollOnLoot(id, 0)) straight away on START_LOOT_ROLL, with the
// chat line; the gate's no gives one chat line per kill; off says nothing; a test never passes; the 3 second watch for
// CANCEL_LOOT_ROLL, arriving and missing; an old leader's CRT gets no pass. The leader rolls Need, else Greed, else
// Transmog, confirms only its own rolls, and 2 seconds after the last roll starts one session of the items that pass
// the loot filter (none: a chat line), waiting for a running session to end. Usage: node run_lootmaster_rolls.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, commSrc, gateSrc, lootingSrc, rollsSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local NOW, CLOCK = 100, 1790000000
GetTime = function() return NOW end
time = function() return CLOCK end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
local ME = "Halo"
local GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras" }, leader = "Solex-Sargeras" }
local function split(full) local n, r = full:match("^(.-)%-(.*)$") return n, r ~= "Sargeras" and r or nil end
UnitName = function(u)
  if u == "player" then return ME end
  local i = tonumber((u or ""):match("^raid(%d+)$"))
  if i and GROUP.names[i] then return split(GROUP.names[i]) end
end
GetNormalizedRealmName = function() return "Sargeras" end
LE_PARTY_CATEGORY_HOME, LE_PARTY_CATEGORY_INSTANCE = 1, 2
IsInGroup = function(cat) if cat == 2 then return false end return true end
IsInRaid = function() return true end
GetNumGroupMembers = function() return #GROUP.names end
GetNumSubgroupMembers = function() return 0 end
GetRaidRosterInfo = function(i) return GROUP.names[i] end
UnitIsGroupLeader = function(u)
  if u == "player" then return GROUP.leader == ME .. "-Sargeras" end
  local n = UnitName(u)
  return n and (n .. "-Sargeras") == GROUP.leader
end
UnitIsConnected = function(u) return UnitName(u) ~= nil end
UnitClass = function() return "Paladin", "PALADIN" end
IsInGuild = function() return false end
local WHERE = { inside = true, kind = "raid", difficulty = 16, id = 2810 }
IsInInstance = function() return WHERE.inside, WHERE.kind end
GetInstanceInfo = function() return "A Raid", WHERE.kind, WHERE.difficulty, "Mythic", 20, 0, false, WHERE.id, 20, nil end
local HERE = "2810-16"
-- timers run when their time comes (advance)
local timers, tickers = {}, {}
C_Timer = {
  After = function(s, fn) timers[#timers + 1] = { at = NOW + s, fn = fn } end,
  NewTicker = function(s, fn) local t = { seconds = s, fn = fn } t.Cancel = function(me) me.cancelled = true end tickers[#tickers + 1] = t return t end,
}
local function advance(s)
  NOW = NOW + s
  local again = true
  while again do
    again = false
    for i, t in ipairs(timers) do
      if t.at <= NOW then table.remove(timers, i) t.fn() again = true break end
    end
  end
end
local outbox = {}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return false end,
  SendAddonMessage = function(p, text) outbox[#outbox + 1] = text return 0 end }
UIErrorsFrame = { AddMessage = function() end }
local frames = {}
local function onEvent(event, ...) for _, f in ipairs(frames) do if f.events[event] and f.fn then f.fn(f, event, ...) end end end
function CreateFrame()
  local f = { events = {} }
  f.RegisterEvent = function(me, e) me.events[e] = true end
  f.SetScript = function(me, _, fn) me.fn = fn end
  frames[#frames + 1] = f
  return f
end
-- the game's rolls: ITEMS[rollID] = { name, can = "ngt" letters for Need, Greed, Transmog }
local ITEMS = {}
local function item(id, name, can)
  ITEMS[id] = { name = name, link = "|cffa335ee|Hitem:" .. (5000 + id) .. "::::::::80:::::|h[" .. name .. "]|h|r", can = can or "n" }
  return ITEMS[id].link
end
GetLootRollItemLink = function(id) return ITEMS[id] and ITEMS[id].link end
GetLootRollItemInfo = function(id)
  local it = ITEMS[id]
  if not it then return nil end
  return 132344, it.name, 1, 4, true, it.can:find("n") ~= nil, it.can:find("g") ~= nil, false, 0, 0, 0, 0, it.can:find("t") ~= nil
end
local rolls, confirms = {}, {}
local ROLL_ERROR, CONFIRM_INSIDE = {}, {}
RollOnLoot = function(id, rollType)
  if ROLL_ERROR[id] then error("blocked") end
  rolls[#rolls + 1] = { id = id, type = rollType }
  if CONFIRM_INSIDE[id] then onEvent("CONFIRM_LOOT_ROLL", id, rollType, "bop") end
end
ConfirmLootRoll = function(id, rollType) confirms[#confirms + 1] = { id = id, type = rollType } end
local function rollsOf(id) local n, t = 0, nil for _, r in ipairs(rolls) do if r.id == id then n, t = n + 1, r.type end end return n, t end
local function confirmsOf(id) local n = 0 for _, c in ipairs(confirms) do if c.id == id then n = n + 1 end end return n end
C_Item = { GetItemInfo = function() return nil end, GetDetailedItemLevelInfo = function() return 250 end }
local printed = {}
CRTDBChar = {}
local CRT = { db = { lootmaster = { authority = { leader = true, names = {} }, enableInParty = false } } }
function CRT:Print(m) printed[#printed + 1] = m end
CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(gateSrc, "AutoPass.lua"))("CowfeeRaidTools", CRT)
assert(load(lootingSrc, "Looting.lua"))("CowfeeRaidTools", CRT)
assert(load(rollsSrc, "Rolls.lua"))("CowfeeRaidTools", CRT)
-- the loot filter: an item named "Junk" fails it
local filtered = {}
function LM:FilterLoot(itemString, source, link)
  filtered[#filtered + 1] = { itemString = itemString, source = source, link = link }
  return not link:find("Junk", 1, true)
end
LM.AskLooting = function() end
local function msg(text, sender) onEvent("CHAT_MSG_ADDON", LM.PREFIX, text, "RAID", sender) end
local function deliver(box, sender) for _, text in ipairs(box) do msg(text, sender) end end
local function take() local box = outbox outbox = {} return box end
local function lastPrint() return printed[#printed] end
local function kill(name) CLOCK = CLOCK + 5 onEvent("ENCOUNTER_END", 3001, name or "Big Boss", 16, 20, 1) take() end
local V = LM.VERSION

eq(LM.VERSION, "0.29.0", "version 0.29.0")
eq(LM.LOOTING_SINCE, "0.29.0", "a raider passes only for a leader whose CRT rolls (0.29.0)")
eq(LM.CLOSE_SECONDS, 3, "the game gets 3 s to close a roll")
eq(LM.COLLECT_SECONDS, 2, "the session starts 2 s after the last roll")

-- the leader enters and says Yes; the raider hears it
ME = "Solex"
onEvent("PLAYER_ENTERING_WORLD", true, false)
take()
LM:SetLooting(true)
local ON = take()
ME = "Halo"
onEvent("PLAYER_ENTERING_WORLD", true, false)
deliver(ON, "Solex-Sargeras")
eq(LM:LootingHeardOn(), true, "raider: heard on")
kill()
eq(CRTDBChar.lootmaster.lastKill.instance, HERE, "the kill keeps its instance")
eq(LM:LastKill() and LM:LastKill().name, "Big Boss", "the last kill")

-- 1. A raider's boss roll: passed straight away, once, said in chat
printed = {}
local sword = item(11, "Sword")
onEvent("START_LOOT_ROLL", 11, 60000, 1)
eq(rollsOf(11), 1, "raider: one pass")
eq(select(2, rollsOf(11)), 0, "raider: rollType 0, pass")
eq(lastPrint(), "CRT Looting passed " .. sword .. " for Solex.", "raider: the passed line")
eq(LM:LootingState().passed[11], true, "raider: recorded in passed")
onEvent("START_LOOT_ROLL", 11, 60000, 1)
eq(rollsOf(11), 1, "raider: the same roll again isn't passed again")
eq(#printed, 1, "raider: nothing said for the repeat")
-- the game closes it in time: nothing more said
onEvent("CANCEL_LOOT_ROLL", 11)
advance(3)
eq(#printed, 1, "raider: CANCEL_LOOT_ROLL in time: nothing more")
-- the game keeps it open: said after 3 s, not before
local axe = item(12, "Axe")
onEvent("START_LOOT_ROLL", 12, 60000, 1)
advance(2.9)
eq(lastPrint(), "CRT Looting passed " .. axe .. " for Solex.", "raider: no word before 3 s")
advance(0.2)
eq(lastPrint(), "CRT Looting couldn't pass " .. axe .. " (the game kept the roll open), so roll it yourself.", "raider: the roll kept open")
-- a CANCEL_ALL_LOOT_ROLLS closes every watch
item(10, "Wand")
onEvent("START_LOOT_ROLL", 10, 60000, 1)
onEvent("CANCEL_ALL_LOOT_ROLLS")
local n = #printed
advance(3)
eq(#printed, n, "raider: CANCEL_ALL_LOOT_ROLLS closes the watch")
-- the call fails: said, with the error, and never tried again
local mace = item(13, "Mace")
ROLL_ERROR[13] = true
onEvent("START_LOOT_ROLL", 13, 60000, 1)
check(lastPrint():find("^CRT Looting couldn't pass " .. mace:gsub("%p", "%%%0") .. " %(.*blocked%), so roll it yourself%.$") ~= nil, "raider: a failed call is said with the error: " .. tostring(lastPrint()))
ROLL_ERROR[13] = nil
onEvent("START_LOOT_ROLL", 13, 60000, 1)
eq(rollsOf(13), 0, "raider: a failed pass isn't tried again")

-- 2. The gate says no: no call, one line per kill. An old leader's CRT is the reason here
deliver({ "O|0.28.0|" .. HERE }, "Solex-Sargeras")
printed = {}
local ring = item(14, "Ring")
onEvent("START_LOOT_ROLL", 14, 60000, 1)
eq(rollsOf(14), 0, "old leader: no pass")
eq(lastPrint(), "CRT Looting didn't pass " .. ring .. ": the raid leader's CRT is too old, so roll it yourself.", "old leader: the line")
item(15, "Cloak")
onEvent("START_LOOT_ROLL", 15, 60000, 1)
eq(rollsOf(15), 0, "old leader: no pass for the next either")
eq(#printed, 1, "one line per kill")
kill("Second Boss")
local neck = item(16, "Neck")
onEvent("START_LOOT_ROLL", 16, 60000, 1)
eq(#printed, 2, "a new kill: a new line")
eq(lastPrint(), "CRT Looting didn't pass " .. neck .. ": the raid leader's CRT is too old, so roll it yourself.", "a new kill: the line")

-- 3. CRT Looting off: nothing at all
deliver({ "F|" .. V .. "|off" }, "Solex-Sargeras")
kill()
printed = {}
item(17, "Belt")
onEvent("START_LOOT_ROLL", 17, 60000, 1)
eq(rollsOf(17), 0, "off: no pass")
eq(#printed, 0, "off: nothing said")
advance(3)
eq(#printed, 0, "off: nothing said later either")

-- 4. A test session never passes (said, as CRT Looting is on)
deliver(ON, "Solex-Sargeras")
LM.incoming = { test = true }
printed = {}
local boots = item(18, "Boots")
onEvent("START_LOOT_ROLL", 18, 60000, 1)
eq(rollsOf(18), 0, "test: no pass")
eq(lastPrint(), "CRT Looting didn't pass " .. boots .. ": a test can't pass, so roll it yourself.", "test: said why")
LM.incoming = nil

-- 5. Not a boss's roll (no kill in the last 10 minutes): no pass, nothing said
CLOCK = CLOCK + LM.BOSS_SECONDS + 1
printed = {}
item(19, "Gloves")
onEvent("START_LOOT_ROLL", 19, 60000, 1)
eq(rollsOf(19), 0, "no boss: no pass")
eq(#printed, 0, "no boss: nothing said")
-- a kill in another instance isn't this one's
WHERE.difficulty = 15
kill()
WHERE.difficulty = 16
printed = {}
item(20, "Bracers")
onEvent("START_LOOT_ROLL", 20, 60000, 1)
eq(rollsOf(20), 0, "a kill in another instance: no pass")
eq(#printed, 0, "a kill in another instance: nothing said")

-- 6. The leader: Need, else Greed, else Transmog; confirms only its own rolls
ME = "Solex"
kill("Big Boss")
printed = {}
local helm = item(21, "Helm", "ngt")
onEvent("START_LOOT_ROLL", 21, 60000, 1)
eq(select(2, rollsOf(21)), 1, "leader: Need when allowed")
eq(lastPrint(), "CRT Looting rolled Need on " .. helm .. ".", "leader: the rolled line")
onEvent("START_LOOT_ROLL", 21, 60000, 1)
eq(rollsOf(21), 1, "leader: the same roll again isn't rolled again")
onEvent("CONFIRM_LOOT_ROLL", 21, 1, "bop")
eq(confirmsOf(21), 1, "leader: CRT's own roll confirmed")
onEvent("CONFIRM_LOOT_ROLL", 21, 1, "bop")
eq(confirmsOf(21), 1, "leader: confirmed once")
local legs = item(22, "Legs", "gt")
onEvent("START_LOOT_ROLL", 22, 60000, 1)
eq(select(2, rollsOf(22)), 2, "leader: Greed when Need isn't allowed")
eq(lastPrint(), "CRT Looting rolled Greed on " .. legs .. ".", "leader: the Greed line")
onEvent("CONFIRM_LOOT_ROLL", 22, 1, "bop")
eq(confirmsOf(22), 0, "leader: a confirm for another kind of roll isn't answered")
eq(lastPrint(), "CRT Looting didn't confirm " .. legs .. ": the game asked about another kind of roll, so answer it yourself.", "leader: said so")
local junk = item(23, "Junk Shoulders", "t")
onEvent("START_LOOT_ROLL", 23, 60000, 1)
eq(select(2, rollsOf(23)), 4, "leader: Transmog when only that is allowed")
eq(lastPrint(), "CRT Looting rolled Transmog on " .. junk .. ".", "leader: the Transmog line")
local chest = item(24, "Chest", "")
onEvent("START_LOOT_ROLL", 24, 60000, 1)
eq(rollsOf(24), 0, "leader: no roll when none is allowed")
eq(lastPrint(), "CRT Looting didn't roll on " .. chest .. ": the game allows no Need, Greed or Transmog on it, so roll it yourself.", "leader: said why")
-- a confirm the game asks for inside the roll call
item(25, "Trinket", "n")
CONFIRM_INSIDE[25] = true
onEvent("START_LOOT_ROLL", 25, 60000, 1)
eq(confirmsOf(25), 1, "leader: a confirm asked inside the call is answered")
-- a roll you made yourself is never confirmed
onEvent("CONFIRM_LOOT_ROLL", 99, 1, "bop")
eq(confirmsOf(99), 0, "leader: a roll you made by hand isn't confirmed")
for _, id in ipairs({ 21, 22, 23, 25 }) do onEvent("CANCEL_LOOT_ROLL", id) end

-- 7. The session: 2 s after the last roll, the items that pass the filter, not a test
eq(LM.current, nil, "session: none yet")
advance(1.9)
eq(LM.current, nil, "session: not before 2 s")
advance(0.2)
check(LM.current ~= nil, "session: started after 2 s")
local s = LM.current
eq(s and s.test, false, "session: not a test")
eq(s and #s.items, 3, "session: the three items that pass the filter")
eq(s and s.items[1].itemString, "item:5021::::::::80", "session: the item string, its empty tail dropped")
eq(s and s.items[1].link, helm, "session: the link")
eq(s and s.items[1].ilvl, 250, "session: the item level")
eq(s and s.boss, "Big Boss", "session: the boss")
eq(filtered[1] and filtered[1].source, "boss", "session: filtered as boss loot")
eq(#filtered, 4, "session: each rolled item through the filter once")
-- nothing passes: said, no session
filtered = {}
kill("Third Boss")
printed = {}
item(31, "Junk Ring", "n")
onEvent("START_LOOT_ROLL", 31, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 31)
advance(2)
eq(lastPrint(), "No loot passed the loot filter for Third Boss.", "session: nothing passed the filter")
eq(LM.current, s, "session: no new one")
-- a session already running: the new items wait until it ends
printed = {}
local staff = item(32, "Staff", "n")
onEvent("START_LOOT_ROLL", 32, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 32)
advance(2)
eq(LM.current, s, "running: the new items wait")
eq(lastPrint(), "Loot Master: the boss loot starts once the running session ends.", "running: said")
LM:End()
check(LM.current ~= nil and LM.current ~= s, "running: the waiting session starts when it ends")
eq(LM.current and #LM.current.items, 1, "running: with the waiting item")
eq(LM.current and LM.current.items[1].link, staff, "running: the staff")
LM:End()
-- a test session: the leader doesn't roll, and the boss loot isn't mixed into it
LM:Start({ { itemString = "item:5001", link = "x" } }, true)
kill()
printed = {}
local orb = item(41, "Orb", "n")
onEvent("START_LOOT_ROLL", 41, 60000, 1)
eq(rollsOf(41), 0, "leader, test running: no roll")
eq(lastPrint(), "CRT Looting didn't roll on " .. orb .. ": a test session is running, so roll it yourself.", "leader, test running: said")
advance(3)
eq(LM.current and LM.current.test, true, "leader, test running: still only the test")
LM:End()
-- the leader's CRT Looting off: nothing at all
LM:SetLooting(false, "off")
take()
printed = {}
item(42, "Dagger", "n")
onEvent("START_LOOT_ROLL", 42, 60000, 1)
advance(3)
eq(rollsOf(42), 0, "leader off: no roll")
eq(#printed, 0, "leader off: nothing said")
eq(LM.current, nil, "leader off: no session")
-- more than 8 items: a second session after the first
LM:SetLooting(true)
take()
kill()
for id = 51, 60 do item(id, "Piece" .. id, "n") onEvent("START_LOOT_ROLL", id, 60000, 1) onEvent("CANCEL_LOOT_ROLL", id) end
advance(2)
eq(LM.current and #LM.current.items, 8, "ten items: the first session has 8")
LM:End()
eq(LM.current and #LM.current.items, 2, "ten items: the second has 2")
LM:End()

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/AutoPass.lua',
  'CRT_Modules/LootMaster/Looting.lua', 'CRT_Modules/LootMaster/Rolls.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
