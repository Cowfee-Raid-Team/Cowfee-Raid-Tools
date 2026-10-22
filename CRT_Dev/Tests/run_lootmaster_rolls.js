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
local dataSrc, commSrc, gateSrc, filterSrc, lootingSrc, bossSrc, rollsSrc = ...
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
local function goOut() WHERE.inside, WHERE.kind = false, "none" end
local function goIn() WHERE.inside, WHERE.kind = true, "raid" end
local HISTORY = {}
C_LootHistory = { GetSortedInfoForDrop = function(enc, list) return HISTORY[enc .. ":" .. list] end }
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
local ITEMS, FACTS = {}, {}
local function item(id, name, can)
  ITEMS[id] = { name = name, link = "|cffa335ee|Hitem:" .. (5000 + id) .. "::::::::80:::::|h[" .. name .. "]|h|r", can = can or "n" }
  FACTS[5000 + id] = { junk = name:find("Junk", 1, true) ~= nil, unread = name:find("Unread", 1, true) ~= nil }
  return ITEMS[id].link
end
GetLootRollItemLink = function(id) return ITEMS[id] and ITEMS[id].link end
local TIMELEFT = {}
GetLootRollTimeLeft = function(id) return TIMELEFT[id] or 60000 end
local SECRET = setmetatable({}, { __eq = function() error("compared a secret value") end })
issecretvalue = function(v) return rawequal(v, SECRET) end
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
local CRT = { db = { lootmaster = { authority = { leader = true, names = {} }, enableInParty = false } },
  defaults = { lootmaster = { filter = { boss = true, trash = false, quality = 2, ilvl = 0,
    kinds = { bop = true, tier = true, boe = true, wue = true, toy = true, mount = true, cosmetic = true, other = true } } } } }
function CRT:Print(m) printed[#printed + 1] = m end
CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(gateSrc, "AutoPass.lua"))("CowfeeRaidTools", CRT)
assert(load(filterSrc, "Filter.lua"))("CowfeeRaidTools", CRT)
-- an item's facts: read unless "Unread" is in its name; "Junk" fails the filter (the raider's side)
LM.ItemFacts = function(s) local f = FACTS[tonumber(s:match("item:(%d+)"))] or {} return { unreadable = f.unread and { "not loaded" } or {}, junk = f.junk } end
local realPasses = LM.PassesFilter
LM.PassesFilter = function(facts, filter) if facts.junk then return false, "quality" end return true end
assert(load(lootingSrc, "Looting.lua"))("CowfeeRaidTools", CRT)
assert(load(bossSrc, "BossLoot.lua"))("CowfeeRaidTools", CRT)
assert(load(rollsSrc, "Rolls.lua"))("CowfeeRaidTools", CRT)
-- the loot filter: an item named "Junk" fails it
local filtered = {}
function LM:FilterLoot(itemString, source, link)
  filtered[#filtered + 1] = { itemString = itemString, source = source, link = link }
  if link:find("Junk", 1, true) then return false, "quality" end
  return true
end
local BL = LM.BossLoot
local blFired = {}
LM:OnChange(function(what, sub) if what == "bossloot" then blFired[#blFired + 1] = sub end end)
LM.AskLooting = function() end
local function msg(text, sender) onEvent("CHAT_MSG_ADDON", LM.PREFIX, text, "RAID", sender) end
local function deliver(box, sender) for _, text in ipairs(box) do msg(text, sender) end end
local function take() local box = outbox outbox = {} return box end
local function lastPrint() return printed[#printed] end
local function kill(name) CLOCK = CLOCK + 5 onEvent("ENCOUNTER_END", 3001, name or "Big Boss", 16, 20, 1) take() end
local V = LM.VERSION

eq(LM.VERSION, "0.31.0", "version 0.31.0")
eq(LM.LOOTING_SINCE, "0.31.0", "a raider passes only for a leader whose CRT sends its loot filter (0.31.0)")
eq(LM.CLOSE_SECONDS, 3, "the game gets 3 s to close a roll")

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

-- 6. The leader: Need, else Greed, else Transmog; confirms only its own rolls; each boss roll on the Boss loot list
eq(#BL:Rows(), 0, "a raider's rolls never fill the boss loot list")
ME = "Solex"
kill("Big Boss")
printed = {}
local helm = item(21, "Helm", "ngt")
onEvent("START_LOOT_ROLL", 21, 60000, 1)
eq(select(2, rollsOf(21)), 1, "leader: Need when allowed")
eq(lastPrint(), "CRT Looting rolled Need on " .. helm .. ".", "leader: the rolled line")
eq(blFired[1], "open", "window: opens on the first leader roll")
local row = BL:Row(21)
eq(row and row.status, "rolling", "row: rolling")
eq(row and row.rollType, 1, "row: rolled Need")
eq(row and row.ticked, true, "row: pre-ticked, it passed the filter")
eq(row and row.itemString, "item:5021::::::::80", "row: the item string, its empty tail dropped")
eq(row and row.ilvl, 250, "row: the item level")
eq(BL.boss, "Big Boss", "window: the boss")
eq(BL.difficulty, "Mythic", "window: the difficulty")
onEvent("START_LOOT_ROLL", 21, 60000, 1)
eq(rollsOf(21), 1, "leader: the same roll again isn't rolled again")
eq(#BL:Rows(), 1, "row: once")
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
local shoulders = item(23, "Shoulders", "t")
onEvent("START_LOOT_ROLL", 23, 60000, 1)
eq(select(2, rollsOf(23)), 4, "leader: Transmog when only that is allowed")
eq(lastPrint(), "CRT Looting rolled Transmog on " .. shoulders .. ".", "leader: the Transmog line")
eq(BL:Row(23).ticked, true, "row: ticked")
local chest = item(24, "Chest", "")
onEvent("START_LOOT_ROLL", 24, 60000, 1)
eq(rollsOf(24), 0, "leader: no roll when none is allowed")
eq(lastPrint(), "CRT Looting: you can't roll on " .. chest .. " (the game allows no Need, Greed or Transmog on it); tell the raid to roll on it.", "can't roll: the warning")
eq(BL:Row(24).status, "cant", "can't roll: a red row")
eq(BL:Row(24).reason, "the game doesn't allow it", "can't roll: a short word in the row")
eq(BL:Row(24).ticked, false, "can't roll: unticked")
BL:SetTicked(24, true)
eq(BL:Row(24).ticked, false, "can't roll: can't be ticked")
item(25, "Trinket", "n")
CONFIRM_INSIDE[25] = true
onEvent("START_LOOT_ROLL", 25, 60000, 1)
eq(confirmsOf(25), 1, "leader: a confirm asked inside the call is answered")
onEvent("CONFIRM_LOOT_ROLL", 99, 1, "bop")
eq(confirmsOf(99), 0, "leader: a roll you made by hand isn't confirmed")
-- outside the loot filter: the game's normal roll, no row
local junk = item(26, "Junk Cloak", "n")
onEvent("START_LOOT_ROLL", 26, 60000, 1)
eq(rollsOf(26), 0, "leader: no roll on an item outside the loot filter")
eq(lastPrint(), "CRT Looting left " .. junk .. " to the normal roll: it isn't in your loot filter.", "leader: said so")
eq(BL:Row(26), nil, "leader: an item outside the filter isn't listed")
for _, id in ipairs({ 21, 22, 23, 25, 26 }) do onEvent("CANCEL_LOOT_ROLL", id) end

-- 7. Nothing starts by itself; who won; Start sends only the ticked items you won
advance(5)
eq(LM.current, nil, "nothing starts a session by itself")
local ticked, total, rolling = BL:Counts()
eq(ticked, 4, "counts: 4 ticked")
eq(total, 5, "counts: 5 rows")
eq(rolling, 4, "counts: 4 ticked still rolling")
eq(select(2, BL:CanStart()), "rolling", "Start waits while a ticked row is still rolling")
eq((BL:Start()), false, "Start: refused")
HISTORY["3001:1"] = { itemHyperlink = helm, winner = { playerName = "Solex", isSelf = true }, allPassed = false }
onEvent("LOOT_HISTORY_UPDATE_DROP", 3001, 1)
eq(BL:Row(21).status, "won", "won: from the loot history")
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 5022, legs, 1, "Quick", "MAGE")
eq(BL:Row(22).status, "lost", "won by someone else")
eq(BL:Row(22).winner, "Quick", "won by: the name")
eq(BL:Row(22).ticked, false, "won by someone else: unticked")
BL:SetTicked(22, true)
eq(BL:Row(22).ticked, false, "won by someone else: can't be ticked")
HISTORY["3001:3"] = { itemHyperlink = shoulders, allPassed = true }
onEvent("LOOT_HISTORY_UPDATE_DROP", 3001, 3)
eq(BL:Row(23).status, "nowinner", "everyone passed")
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 5025, ITEMS[25].link, 1, "Solex-Sargeras", "PALADIN")
eq(BL:Row(25).status, "won", "won: from the receive event")
eq(select(4, BL:Counts()), 2, "counts: 2 ticked won")
eq((BL:CanStart()), true, "Start: ready")
eq(BL:Start(), 2, "Start: 2 items")
local s = LM.current
eq(s and s.test, false, "session: not a test")
eq(s and #s.items, 2, "session: only the ticked items you won")
eq(s and s.items[1].link, helm, "session: the helm")
eq(s and s.items[2].link, ITEMS[25].link, "session: the trinket")
eq(s and s.boss, "Big Boss", "session: the boss")
eq(#BL:Rows(), 3, "Start: the sent rows leave the list")
eq(BL:Busy(), true, "a real session is running: Busy")
LM:End()
blFired = {}
BL:Clear()
eq(#BL:Rows(), 0, "Clear: empty")
eq(blFired[1], "cleared", "Clear: the window is told")
-- a winner that can't be read stays rolling
kill()
local staff = item(31, "Staff", "n")
onEvent("START_LOOT_ROLL", 31, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 31)
HISTORY["3001:5"] = { itemHyperlink = staff, winner = { playerName = SECRET, isSelf = SECRET } }
onEvent("LOOT_HISTORY_UPDATE_DROP", 3001, 5)
eq(BL:Row(31).status, "rolling", "a winner that can't be read: still rolling")
-- each row leaves 10 minutes after its kill
advance(LM.BOSS_SECONDS - 10)
eq(#BL:Rows(), 1, "expiry: not before 10 minutes")
advance(11)
eq(#BL:Rows(), 0, "expiry: gone 10 minutes after the kill")
-- more than 8: a second session after the first; one that waited too long is dropped
local function tenWon(base)
  kill()
  for id = base, base + 9 do
    item(id, "Piece" .. id, "n") onEvent("START_LOOT_ROLL", id, 60000, 1) onEvent("CANCEL_LOOT_ROLL", id)
    HISTORY["3001:" .. id] = { itemHyperlink = ITEMS[id].link, winner = { playerName = "Solex", isSelf = true } }
    onEvent("LOOT_HISTORY_UPDATE_DROP", 3001, id)
  end
end
tenWon(51)
eq(BL:Start(), 10, "ten items: sent")
eq(LM.current and #LM.current.items, 8, "ten items: the first session has 8")
LM:End()
eq(LM.current and #LM.current.items, 2, "ten items: the second has 2")
LM:End()
tenWon(61)
BL:Start()
advance(LM.BOSS_SECONDS + 1)
LM:End()
eq(LM.current and #LM.current.items, 2, "waiting items still in their trade time: they start")
LM:End()
tenWon(611)
BL:Start()
advance(LM.TRADE_SECONDS + 1)
printed = {}
LM:End()
eq(LM.current, nil, "waiting items past their trade time: dropped")
eq(#printed, 2, "dropped: each item said")
eq(lastPrint(), "Loot Master dropped the waiting boss loot: " .. ITEMS[620].link .. ": the game's 2 hours to trade it are over.", "dropped: said")

-- 8. A confirm is answered only for CRT's own roll, made, still open, within 3 s
kill("Fourth Boss")
printed = {}
ROLL_ERROR[71] = true
item(71, "Plate", "n")
onEvent("START_LOOT_ROLL", 71, 60000, 1)
ROLL_ERROR[71] = nil
check((printed[1] or ""):find("^CRT Looting couldn't roll on") ~= nil, "failed roll: said")
eq(BL:Row(71) and BL:Row(71).status, "cant", "failed roll: a red row")
eq(BL:Row(71) and BL:Row(71).reason, "the roll call failed", "failed roll: a short word in the row, the error only in chat")
check((printed[1] or ""):find("blocked", 1, true) ~= nil, "failed roll: the error in chat")
onEvent("CONFIRM_LOOT_ROLL", 71, 1, "bop") -- the player's own Need, by hand
eq(confirmsOf(71), 0, "failed roll: the confirm of the hand roll isn't answered")
local mail = item(72, "Mail", "n")
onEvent("START_LOOT_ROLL", 72, 60000, 1)
advance(3)
eq(lastPrint(), "CRT Looting couldn't roll on " .. mail .. " (the game kept the roll open), so roll it yourself.", "kept open: said")
onEvent("CONFIRM_LOOT_ROLL", 72, 1, "bop")
eq(confirmsOf(72), 0, "kept open: a confirm after it isn't answered")
item(73, "Wrist", "n")
onEvent("START_LOOT_ROLL", 73, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 73)
advance(3.5)
onEvent("CONFIRM_LOOT_ROLL", 73, 1, "bop")
eq(confirmsOf(73), 0, "a confirm over 3 s after CRT's roll isn't answered")
item(74, "Waist", "n")
onEvent("START_LOOT_ROLL", 74, 60000, 1)
advance(1)
onEvent("CONFIRM_LOOT_ROLL", 74, 1, "bop")
eq(confirmsOf(74), 1, "a confirm within 3 s is answered")
onEvent("CANCEL_LOOT_ROLL", 74)
advance(3)
BL:Clear()

-- 9. A roll with no readable link: said, not on the list; a secret name is never compared
kill("Fifth Boss")
item(75, "Ghost", "n")
ITEMS[75].link = nil
onEvent("START_LOOT_ROLL", 75, 60000, 1)
eq(lastPrint(), "Loot Master couldn't read the link of Ghost, so it isn't on the boss loot list.", "no link: said")
eq(#BL:Rows(), 0, "no link: no row")
onEvent("CANCEL_LOOT_ROLL", 75)
item(76, "x", "n")
ITEMS[76].link, ITEMS[76].name = nil, SECRET
printed = {}
onEvent("START_LOOT_ROLL", 76, 60000, 1)
eq(rollsOf(76), 0, "secret name: no roll (the game's roll info can't be read)")
eq(printed[1], "CRT Looting: you can't roll on an item (the game didn't say which rolls you may make); tell the raid to roll on it.", "secret name: warned")
advance(3)

-- 10. The leader's "didn't roll" line: once per kill per reason (here, no loot authority)
local function count(pat) local c = 0 for _, l in ipairs(printed) do if l:find(pat, 1, true) then c = c + 1 end end return c end
CRT.db.lootmaster.authority.leader = false
kill("Sixth Boss")
printed = {}
local sash = item(81, "Sash", "n")
item(82, "Hood", "n")
onEvent("START_LOOT_ROLL", 81, 60000, 1)
onEvent("START_LOOT_ROLL", 82, 60000, 1)
eq(rollsOf(81) + rollsOf(82), 0, "no loot authority: no roll")
eq(count("didn't roll on"), 1, "leader: one line per kill per reason")
eq(printed[1], "CRT Looting didn't roll on " .. sash .. ": your loot authority setting doesn't let you run loot, so roll it yourself.", "no loot authority: said")
eq(#BL:Rows(), 0, "no loot authority: no rows")
kill("Seventh Boss")
item(83, "Mask", "n")
onEvent("START_LOOT_ROLL", 83, 60000, 1)
eq(count("didn't roll on"), 2, "leader: a new kill, a new line")
CRT.db.lootmaster.authority.leader = true
advance(3)

-- 11. The list empties when CRT Looting turns off, and on leaving the instance
kill()
item(91, "Gauntlet", "n")
onEvent("START_LOOT_ROLL", 91, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 91)
eq(#BL:Rows(), 1, "a row")
LM:SetLooting(false, "off")
take()
eq(#BL:Rows(), 1, "CRT Looting off: the list stays")
LM:SetLooting(true)
take()
kill()
item(92, "Girdle", "n")
onEvent("START_LOOT_ROLL", 92, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 92)
eq(#BL:Rows(), 2, "a second row")
goOut()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(#BL:Rows(), 2, "leaving the instance: the list stays")
goIn()
onEvent("PLAYER_ENTERING_WORLD", false, false)
take()
eq(LM:LootingOn(), true, "back in after a wipe: still on")
BL:Clear()

-- 12. Each drop's result counts once, for its own boss; the badge follows the newest kill; a failed start keeps the rows
ME = "Solex"
kill("Twin Boss")
eq(BL.boss, nil, "an empty list: no boss yet")
local twin = item(201, "Twin", "n")
item(202, "Twin", "n")
ITEMS[202].link = twin
onEvent("START_LOOT_ROLL", 201, 60000, 1)
onEvent("START_LOOT_ROLL", 202, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 201) onEvent("CANCEL_LOOT_ROLL", 202)
eq(BL.boss, "Twin Boss", "badge: the kill's boss")
HISTORY["3001:7"] = { itemHyperlink = twin, winner = { playerName = "Solex", isSelf = true } }
onEvent("LOOT_HISTORY_UPDATE_DROP", 3001, 7)
eq(BL:Row(201).status, "won", "twins: drop A won")
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 5201, twin, 1, "Solex", "PALADIN")
eq(BL:Row(202).status, "rolling", "twins: drop A's receive event isn't applied again")
onEvent("LOOT_HISTORY_UPDATE_DROP", 3001, 7)
eq(BL:Row(202).status, "rolling", "twins: a repeated history update changes nothing")
HISTORY["4002:8"] = { itemHyperlink = twin, winner = { playerName = "Quick", isSelf = false } }
onEvent("LOOT_HISTORY_UPDATE_DROP", 4002, 8)
eq(BL:Row(202).status, "rolling", "another boss's drop isn't this one's")
HISTORY["3001:8"] = { itemHyperlink = twin, winner = { playerName = "Quick", isSelf = false } }
onEvent("LOOT_HISTORY_UPDATE_DROP", 3001, 8)
eq(BL:Row(202).status, "lost", "twins: drop B won by someone else")
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 5201, twin, 1, "Quick", "MAGE")
eq(BL:Row(201).status, "won", "twins: drop B's receive event changes nothing")
-- the receive event alone (no history yet) still tells
kill("Next Boss")
local orb2 = item(203, "Orb", "n")
onEvent("START_LOOT_ROLL", 203, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 203)
eq(BL.boss, "Next Boss", "badge: a new kill's rows show the new boss")
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 5203, orb2, 1, "Solex", "PALADIN")
eq(BL:Row(203).status, "won", "receive event first: won")
HISTORY["3001:9"] = { itemHyperlink = orb2, winner = { playerName = "Solex", isSelf = true } }
onEvent("LOOT_HISTORY_UPDATE_DROP", 3001, 9)
eq(BL:Row(203).status, "won", "the same drop from the history: no change")
-- LM:Start refuses (no loot authority): the rows stay
CRT.db.lootmaster.authority.leader = false
eq((BL:Start()), false, "a failed start: refused")
eq(BL:Row(201) ~= nil and BL:Row(203) ~= nil, true, "a failed start: the rows stay")
eq(LM.current, nil, "a failed start: no session")
CRT.db.lootmaster.authority.leader = true
-- won rows that expire: said
printed = {}
advance(LM.BOSS_SECONDS + 1)
eq(#BL:Rows(), 2, "won rows stay past 10 minutes")
advance(LM.TRADE_SECONDS - LM.BOSS_SECONDS - LM.TRADE_WARN)
eq(#printed, 2, "15 minutes before: each won row warned once")
eq(lastPrint(), "Loot Master: " .. orb2 .. " can be traded for about 15 more minutes. Start a session soon or it can't be given out.", "the warning")
eq(BL.TradeLeft(BL:Row(203)) <= LM.TRADE_WARN, true, "the time left is in the warning")
advance(LM.TRADE_WARN + 1)
eq(#BL:Rows(), 0, "expired")
eq(lastPrint(), "Loot Master: 2 won items left the boss loot list: the game's 2 hours to trade them are over.", "expired won rows: said")

-- 13. The heartbeat race: a roll refused only for a quiet leader is tried once more on the leader's next word
ME = "Halo"
local H = { "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0|1|0|2|0|bop,tier,boe,wue,toy,mount,cosmetic,other" }
deliver(H, "Solex-Sargeras")
kill()
NOW = NOW + 91
printed = {}
local gem = item(101, "Gem", "n")
onEvent("START_LOOT_ROLL", 101, 60000, 1)
eq(rollsOf(101), 0, "quiet: no pass yet")
eq(lastPrint(), "CRT Looting is waiting for word from the raid leader on " .. gem .. "; roll it yourself if you'd rather not wait.", "quiet: said")
deliver(H, "Solex-Sargeras")
eq(rollsOf(101), 1, "quiet: passed on the next heartbeat")
eq(lastPrint(), "CRT Looting passed " .. gem .. " for Solex.", "quiet: the passed line")
deliver(H, "Solex-Sargeras")
eq(rollsOf(101), 1, "quiet: tried once only")
onEvent("CANCEL_LOOT_ROLL", 101)
NOW = NOW + 91
item(102, "Shard", "n")
onEvent("START_LOOT_ROLL", 102, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 102) -- you rolled it yourself
item(103, "Dust", "n")
TIMELEFT[103] = 0
onEvent("START_LOOT_ROLL", 103, 60000, 1)
deliver(H, "Solex-Sargeras")
eq(rollsOf(102), 0, "quiet: a roll you made yourself isn't passed later")
eq(rollsOf(103), 0, "quiet: a roll with no time left isn't passed")
NOW = NOW + 91
item(104, "Ore", "n")
onEvent("START_LOOT_ROLL", 104, 60000, 1)
deliver({ "F|" .. V .. "|off" }, "Solex-Sargeras")
eq(rollsOf(104), 0, "quiet: the next word says off: no pass")
deliver(ON, "Solex-Sargeras")
eq(rollsOf(104), 0, "quiet: tried once only, even after off")
advance(3)
-- a loading screen forgets the rolls waiting for word
NOW = NOW + 91
item(105, "Bone", "n")
onEvent("START_LOOT_ROLL", 105, 60000, 1)
onEvent("PLAYER_ENTERING_WORLD", false, false)
deliver(H, "Solex-Sargeras")
eq(rollsOf(105), 0, "quiet: a loading screen forgets it")
advance(3)

-- 14. Received loot: an old raid with no rolls hands items straight out; yours go on the list as won
ME = "Solex"
LM:End()
BL:Clear()
eq(LM:LootingOn(), true, "received: CRT Looting still on")
kill("Old Boss")
local belt = "|cffa335ee|Hitem:6001::::::::80:::::|h[Belt]|h|r"
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6001, belt, 1, "Quick", "MAGE")
eq(#BL:Rows(), 0, "received: someone else's item isn't listed")
local markedWhenDrawn
LM:OnChange(function(what) if what == "bossloot" and BL:Rows()[1] and markedWhenDrawn == nil then markedWhenDrawn = BL:Rows()[1].received == true end end)
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6001, belt, 1, "Solex", "PALADIN")
eq(markedWhenDrawn, true, "received: marked before the window draws it")
local rr = BL:Rows()[1]
eq(rr and rr.status, "won", "received: yours is won")
eq(rr and rr.received, true, "received: marked as received")
eq(rr and rr.ticked, true, "received: ticked when it passes the filter")
eq(rr and rr.rollID < 0, true, "received: CRT's own rollID, below 0")
eq(BL.boss, "Old Boss", "received: the badge shows the boss")
onEvent("ENCOUNTER_LOOT_RECEIVED", 4002, 6002, "|cffa335ee|Hitem:6002::::::::80:::::|h[Ring]|h|r", 1, "Solex", "PALADIN")
eq(#BL:Rows(), 1, "received: another boss's item isn't this kill's")
local junk2 = "|cff9d9d9d|Hitem:6003::::::::80:::::|h[Junk Rag]|h|r"
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6003, junk2, 1, "Solex", "PALADIN")
eq(#BL:Rows(), 1, "received: an item outside the loot filter isn't listed")
eq(BL:Start(), 1, "received: Start sends the ticked won item")
eq(LM.current and LM.current.items[1].link, belt, "received: the belt is in the session")
LM:End()
BL:Clear()
-- a kill the game rolled on never adds received rows
kill("Rolled Boss")
item(301, "Cloak", "n")
onEvent("START_LOOT_ROLL", 301, 60000, 1)
onEvent("CANCEL_LOOT_ROLL", 301)
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6004, "|cffa335ee|Hitem:6004::::::::80:::::|h[Wrist]|h|r", 1, "Solex", "PALADIN")
eq(#BL:Rows(), 1, "received: a rolled kill adds no received row")
BL:Clear()
-- Start session in all cases: a test running is ended first; a real one keeps going and these wait
local shown = 0
LM.ShowWindow = function() shown = shown + 1 end
kill("Old Boss")
LM:Start({ { itemString = "item:7001", link = "|cffa335ee|Hitem:7001|h[Test Helm]|h|r" } }, true)
eq(LM.current and LM.current.test, true, "a test session is running")
eq(BL:Busy(), false, "a test session doesn't make it Busy")
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6001, belt, 1, "Solex", "PALADIN")
eq((BL:CanStart()), true, "Start: ready while a test runs")
printed = {}
eq(BL:Start(), 1, "Start over a test: sent")
eq(LM.current and LM.current.test, false, "the test ended and the real session started")
eq(LM.current and LM.current.items[1].link, belt, "the real session has the belt")
eq(printed[1], "Loot Master ended the test session to start this one.", "the test ending is said")
local first = LM.current
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6005, "|cffa335ee|Hitem:6005::::::::80:::::|h[Cuffs]|h|r", 1, "Solex", "PALADIN")
eq((BL:CanStart()), true, "Start: ready while a real session runs")
eq(BL:Start(), 1, "Start behind a real session: queued")
eq(LM.current, first, "the running session keeps going")
eq(#BL:Rows(), 0, "queued rows leave the list")
eq(lastPrint(), "Loot Master: 1 item will start when the running session ends.", "queued: said")
eq(shown, 1, "queued: the Loot Master window shows")
LM:End()
eq(LM.current and LM.current.items[1].link:find("Cuffs", 1, true) ~= nil, true, "the queued items start when it ends")
LM:End()
BL:Clear()

-- The list is kept for a /reload: saved per character with each time left as a clock time
kill("Old Boss")
local addClock = CLOCK
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6001, belt, 1, "Solex", "PALADIN")
advance(600) CLOCK = CLOCK + 600
local saved = CRTDBChar.lootmaster.bossLootList
eq(saved and #saved.rows, 1, "saved: the row")
eq(saved and saved.rows[1].endsAt, addClock + LM.TRADE_SECONDS, "saved: its end as a clock time")
BL.rows = {}
NOW, CLOCK = 5, CLOCK + 300 -- a /reload: the game's clock starts again; five minutes went by
BL:Load()
local back = BL:Rows()[1]
eq(back and back.link, belt, "after a /reload: the row is back")
eq(back and back.rollID < 0, true, "after a /reload: CRT's own rollID")
eq(back and math.floor(BL.TradeLeft(back) + 0.5), LM.TRADE_SECONDS - 900, "after a /reload: the time it had left")
eq(back and back.received, true, "after a /reload: still received")
BL.rows = {}
CLOCK = CLOCK + LM.TRADE_SECONDS
printed = {}
BL:Load()
eq(#BL:Rows(), 0, "after a long logout: the row's time is over")
eq(lastPrint(), "Loot Master: 1 won item left the boss loot list: the game's 2 hours to trade it are over.", "after a long logout: said")
eq(CRTDBChar.lootmaster.bossLootList, nil, "an empty list isn't kept")

-- 15. A raider passes only items in the filter its leader sent, every fact read
ME = "Halo"
deliver(ON, "Solex-Sargeras")
kill()
printed = {}
item(401, "Bracers", "n")
onEvent("START_LOOT_ROLL", 401, 60000, 1)
eq(rollsOf(401), 1, "raider: an item in the leader's filter is passed")
item(402, "Junk Belt", "n")
onEvent("START_LOOT_ROLL", 402, 60000, 1)
eq(rollsOf(402), 0, "raider: an item outside the leader's filter is left to the normal roll")
eq(lastPrint(), "CRT Looting didn't pass " .. ITEMS[402].link .. ": the item isn't in the raid leader's loot filter, so roll it yourself.", "raider: said once")
item(403, "Unread Ring", "n")
onEvent("START_LOOT_ROLL", 403, 60000, 1)
eq(rollsOf(403), 0, "raider: an item it can't read isn't passed")
deliver({ "O|" .. V .. "|" .. HERE }, "Solex-Sargeras")
item(404, "Gloves", "n")
onEvent("START_LOOT_ROLL", 404, 60000, 1)
eq(rollsOf(404), 0, "raider: no filter in the leader's word, no pass")
deliver({ "O|" .. V .. "|" .. HERE .. "|1|0|9|0|bop" }, "Solex-Sargeras")
item(405, "Hat", "n")
onEvent("START_LOOT_ROLL", 405, 60000, 1)
eq(rollsOf(405), 0, "raider: a filter that can't be read (quality 9), no pass")
eq(LM.ParseFilterFields({ "1", "0", "4", "0", "bop,tier,wat" }, 1).kinds.tier, true, "parse: a named kind passes")
eq(LM.ParseFilterFields({ "1", "0", "4", "0", "bop" }, 1).kinds.boe, false, "parse: an unnamed kind is off")
eq(LM.ParseFilterFields({ "1", "0", "4", "x", "bop" }, 1), nil, "parse: a bad item level is nothing")
local back = LM.ParseFilterFields(LM.FilterFields(LM:Filter()), 1)
eq(back and back.quality == LM:Filter().quality and back.kinds.other == true, true, "parse: what FilterFields sends comes back")
for _, id in ipairs({ 401, 402, 403, 404, 405 }) do onEvent("CANCEL_LOOT_ROLL", id) end
advance(3)

-- CRT Looting off, or a raider: nothing
kill("Old Boss")
LM:SetLooting(false)
take()
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6001, belt, 1, "Solex", "PALADIN")
eq(#BL:Rows(), 0, "received: CRT Looting off adds nothing")
ME = "Halo"
onEvent("ENCOUNTER_LOOT_RECEIVED", 3001, 6001, belt, 1, "Halo", "PALADIN")
eq(#BL:Rows(), 0, "received: a raider adds nothing")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/AutoPass.lua',
  'CRT_Modules/LootMaster/Filter.lua', 'CRT_Modules/LootMaster/Looting.lua', 'CRT_Modules/LootMaster/BossLoot.lua', 'CRT_Modules/LootMaster/Rolls.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
