// CRT_Modules/LootMaster/Looting.lua: CRT Looting on and off. One Lua state plays the leader and the raiders in turn
// (who you are is swapped), with the messages caught and delivered by hand: an older client drops the new
// kinds, the instance prompt (who is asked and when), on, off and the heartbeat, raiders taking them only
// from the current raid leader, wipes (the leader out of the instance for up to 10 minutes), finder groups
// and parties, red error text in a lockdown, the state line in chat and on the page, the gate's state, and
// the leader's on state kept through a /reload (CRTDBChar lootmaster.looting) until it is turned off or a
// safety off happens. Usage: node run_lootmaster_looting.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, commSrc, gateSrc, lootingSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local NOW = 100
GetTime = function() return NOW end
time = function() return 1790000000 + NOW end -- the clock moves with GetTime
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
-- the group: raid1..raidN in a raid; in a party (GROUP.raid == false) party1..partyN are the others
local ME = "Solex"
local GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras" }, leader = "Solex-Sargeras" }
local function split(full) local n, r = full:match("^(.-)%-(.*)$") return n, r ~= "Sargeras" and r or nil end
local function others() local out = {} for _, n in ipairs(GROUP.names) do if n ~= ME .. "-Sargeras" then out[#out + 1] = n end end return out end
UnitName = function(u)
  if u == "player" then return ME end
  if not GROUP then return nil end
  local i = tonumber((u or ""):match("^raid(%d+)$"))
  if i and GROUP.raid ~= false and GROUP.names[i] then return split(GROUP.names[i]) end
  local p = tonumber((u or ""):match("^party(%d+)$"))
  if p and GROUP.raid == false and others()[p] then return split(others()[p]) end
end
GetNormalizedRealmName = function() return "Sargeras" end
LE_PARTY_CATEGORY_HOME, LE_PARTY_CATEGORY_INSTANCE = 1, 2
IsInGroup = function(cat) if cat == 2 then return GROUP ~= nil and GROUP.lfg == true end return GROUP ~= nil end
IsInRaid = function() return GROUP ~= nil and GROUP.raid ~= false end
GetNumGroupMembers = function() return GROUP and #GROUP.names or 0 end
GetNumSubgroupMembers = function() return (GROUP and GROUP.raid == false) and #GROUP.names - 1 or 0 end
GetRaidRosterInfo = function(i) return GROUP and GROUP.names[i] end
UnitIsGroupLeader = function(u)
  if not GROUP then return false end
  if u == "player" then return GROUP.leader == ME .. "-Sargeras" end
  local n, r = UnitName(u)
  return n and ((r and (n .. "-" .. r)) or (n .. "-Sargeras")) == GROUP.leader
end
local OFFLINE = {}
UnitIsConnected = function(u) local n = UnitName(u) return n ~= nil and not OFFLINE[n] end
UnitClass = function() return "Paladin", "PALADIN" end
C_Item = { GetItemInfo = function() return nil end }
IsInGuild = function() return false end
-- where you are: a raid instance (Mythic, id 2810) unless changed
local WHERE = { inside = true, kind = "raid", difficulty = 16, id = 2810 }
local function goOutside() WHERE.inside, WHERE.kind = false, "none" end
local function goInside() WHERE.inside, WHERE.kind = true, "raid" end
IsInInstance = function() return WHERE.inside, WHERE.kind end
GetInstanceInfo = function() return "A Raid", WHERE.kind, WHERE.difficulty, "Mythic", 20, 0, false, WHERE.id, 20, nil end
local timers, tickers = {}, {}
C_Timer = {
  After = function(s, fn) timers[#timers+1] = fn end,
  NewTicker = function(s, fn) local t = { seconds = s, fn = fn } t.Cancel = function(me) me.cancelled = true end tickers[#tickers+1] = t return t end,
}
local function runTimers() local t = timers timers = {} for _, fn in ipairs(t) do fn() end end
local function live(seconds) local n = 0 for _, t in ipairs(tickers) do if not t.cancelled and (not seconds or t.seconds == seconds) then n = n + 1 end end return n end
local function tick(seconds) for _, t in ipairs(tickers) do if not t.cancelled and (not seconds or t.seconds == seconds) then t.fn() end end end
local outbox, result = {}, 0
local LOCKED = false
C_ChatInfo = { RegisterAddonMessagePrefix = function() end,
  InChatMessagingLockdown = function() return LOCKED end,
  SendAddonMessage = function(p, text, ch) if result ~= 0 then return result end outbox[#outbox+1] = text return 0 end }
local errors = {}
UIErrorsFrame = { AddMessage = function(self, text, r, g, b) errors[#errors + 1] = { text = text, r = r, g = g, b = b } end }
local frames = {}
local function onEvent(event, ...) for _, f in ipairs(frames) do if f.events[event] and f.fn then f.fn(f, event, ...) end end end
function CreateFrame()
  local f = { events = {} }
  f.RegisterEvent = function(me, e) me.events[e] = true end
  f.SetScript = function(me, _, fn) me.fn = fn end
  frames[#frames + 1] = f
  return f
end
local printed = {}
CRTDBChar = {}
local CRT = { db = { lootmaster = { authority = { leader = true, names = {} }, enableInParty = false } } }
function CRT:Print(m) printed[#printed+1] = m end
CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
local function msg(text, sender) onEvent("CHAT_MSG_ADDON", LM.PREFIX, text, "RAID", sender) end
local function deliver(box, sender) for _, text in ipairs(box) do msg(text, sender) end end
local function take() local box = outbox outbox = {} return box end
local function lastPrint() return printed[#printed] end
local HERE = "2810-16"
local V = LM.VERSION
-- the leader's loot filter as O and H carry it (LootMaster/Filter.lua isn't loaded here)
local FF = "|1|0|4|0|bop,tier"
function LM:Filter() return { boss = true, trash = false, quality = 4, ilvl = 0, kinds = { bop = true, tier = true } } end
LM.FilterFields = function() return { 1, 0, 4, 0, "bop,tier" } end
LM.ParseFilterFields = function(f, first) if f[first] == "1" then return { boss = true } end end

-- 1. An older client (no Looting.lua): the new kinds are dropped without an error
local before = fails
ME = "Halo"
msg("O|0.27.0|" .. HERE, "Solex-Sargeras")
msg("H|0.27.0|" .. HERE .. "|" .. HERE .. "|0", "Solex-Sargeras")
msg("F|0.27.0|off", "Solex-Sargeras")
eq(fails, before, "old client: no error")
eq(#outbox, 0, "old client: nothing answered")
eq(#printed, 0, "old client: nothing said")

assert(load(gateSrc, "AutoPass.lua"))("CowfeeRaidTools", CRT)
-- a /reload: the old file's frames and tickers stop, the file runs again with nothing kept
local lootingFrames = {}
local function loadLooting()
  for _, f in ipairs(lootingFrames) do f.fn = nil end
  for _, t in ipairs(tickers) do t.cancelled = true end
  local first = #frames + 1
  assert(load(lootingSrc, "Looting.lua"))("CowfeeRaidTools", CRT)
  lootingFrames = {}
  for i = first, #frames do lootingFrames[#lootingFrames + 1] = frames[i] end
end
loadLooting()
local asked = 0
LM.AskLooting = function() asked = asked + 1 end
local fired = {}
LM:OnChange(function(what) fired[what] = (fired[what] or 0) + 1 end)

-- 2. Off at the start, for everyone
ME = "Solex"
eq(LM:LootingOn(), false, "start: off for the leader")
ME = "Halo"
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader hasn't turned it on", "start: a raider is off")

-- 3. The prompt: the raid leader entering a raid instance, once per instance
ME = "Solex"
onEvent("PLAYER_ENTERING_WORLD", true, false)
eq(asked, 1, "prompt: the leader entering a raid instance is asked")
local first = take()
eq(first[1], "F|" .. V .. "|reload", "login: the leader tells raiders it starts off")
onEvent("PLAYER_ENTERING_WORLD", false, false)
onEvent("ZONE_CHANGED_NEW_AREA")
onEvent("GROUP_ROSTER_UPDATE")
eq(asked, 1, "prompt: not again in the same instance")
eq(#outbox, 0, "only the first loading screen sends the reload F")
goOutside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 1, "prompt: not outside")
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 1, "prompt: not again on running back into the same instance")
WHERE.difficulty = 15
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 2, "prompt: another difficulty is another instance")
WHERE.difficulty = 16
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 3, "prompt: back to Mythic is another instance again")
-- not asked: a raider, a dungeon, a finder group, no group, a party with Enable in party off
local nextId = 3000
local function askedOn(setup, undo)
  goOutside()
  onEvent("PLAYER_ENTERING_WORLD", false, false)
  nextId = nextId + 1
  WHERE.id = nextId
  goInside()
  setup()
  local n = asked
  onEvent("PLAYER_ENTERING_WORLD", false, false)
  local got = asked - n
  undo()
  return got
end
eq(askedOn(function() end, function() end), 1, "prompt: a new instance asks (the helper works)")
eq(askedOn(function() ME = "Halo" end, function() ME = "Solex" end), 0, "prompt: a raider isn't asked")
eq(askedOn(function() WHERE.kind = "party" end, function() end), 0, "prompt: not in a dungeon")
eq(askedOn(function() GROUP.lfg = true end, function() GROUP.lfg = nil end), 0, "prompt: not in a finder group")
local saved = GROUP
eq(askedOn(function() GROUP = nil end, function() GROUP = saved end), 0, "prompt: not alone")
eq(askedOn(function() GROUP.raid = false end, function() GROUP.raid = nil end), 0, "prompt: not in a party with Enable in party off")
eq(askedOn(function() GROUP.raid = false CRT.db.lootmaster.enableInParty = true end,
  function() GROUP.raid = nil CRT.db.lootmaster.enableInParty = false end), 1, "prompt: a party with Enable in party on")
-- becoming the leader inside asks then; losing the lead and getting it back asks again
nextId = nextId + 1
WHERE.id = nextId
GROUP.leader = "Halo-Sargeras"
onEvent("PLAYER_ENTERING_WORLD", false, false)
local n = asked
GROUP.leader = "Solex-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(asked, n + 1, "prompt: asked on becoming the leader inside")
GROUP.leader = "Halo-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
GROUP.leader = "Solex-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(asked, n + 2, "prompt: asked again on getting the lead back")
WHERE.id = 2810
onEvent("PLAYER_ENTERING_WORLD", false, false)
-- a /reload inside: off again, raiders told, and asked again
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
n = asked
take()
onEvent("PLAYER_ENTERING_WORLD", false, true)
eq(asked, n + 1, "prompt: asked again after a /reload")
eq(take()[1], "F|" .. V .. "|reload", "reload: F reload")
-- a raider's first loading screen sends nothing
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
ME = "Halo"
onEvent("PLAYER_ENTERING_WORLD", false, true)
eq(#outbox, 0, "reload: a raider sends nothing")
-- an F reload to a raider who was never on says nothing
printed = {}
deliver({ "F|" .. V .. "|reload" }, "Solex-Sargeras")
eq(#printed, 0, "reload F: nothing said to a raider who was never on")
ME = "Solex"
-- a leader who can't lead it (a finder group) sends no reload F
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
GROUP.lfg = true
onEvent("PLAYER_ENTERING_WORLD", false, true)
eq(#outbox, 0, "reload: a finder group's leader sends nothing")
GROUP.lfg = nil
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
onEvent("PLAYER_ENTERING_WORLD", false, true)
take()

-- 4. Yes: on for everyone, an O, then a heartbeat every 30 seconds
printed = {}
fired = {}
eq(LM:SetLooting(true), true, "yes: turned on")
eq(LM:LootingOn(), true, "yes: on")
local box = take()
eq(#box, 1, "yes: one message")
eq(box[1], "O|" .. V .. "|" .. HERE .. FF, "yes: O with the version, the instance and the loot filter")
eq(lastPrint(), "CRT Looting: on for everyone in the raid with CRT.", "yes: said in chat")
eq(LM:LootingStatus(), "CRT Looting: on for everyone in the raid with CRT", "yes: the leader's line")
check((fired.looting or 0) > 0, "yes: the page is told")
eq(live(LM.HEARTBEAT_SECONDS), 1, "yes: one heartbeat ticker")
eq(LM.HEARTBEAT_SECONDS, 30, "heartbeat every 30 s")
tick(30)
local beat = take()
eq(beat[1], "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0" .. FF, "heartbeat: H with the version, the Yes instance, where the leader is, 0 s away and the loot filter")
-- ordinary combat (trash) never stops a heartbeat
onEvent("PLAYER_REGEN_DISABLED")
tick(30)
eq(#take(), 1, "combat: the heartbeat still goes out")
onEvent("PLAYER_REGEN_ENABLED")
local regen = take()
eq(#regen, 1, "out of combat: a heartbeat straight away")
check(regen[1] and regen[1]:sub(1, 2) == "H|", "out of combat: it is an H")
-- in an encounter's chat lockdown no heartbeat piles up; one goes out when it ends
LOCKED = true
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
tick(30)
tick(30)
eq(#outbox, 0, "lockdown: no heartbeat queued")
-- a click that would send a message: red error text, nothing done
errors = {}
eq((LM:ChooseLooting(false, "off")), false, "lockdown: Turn off refused")
eq(LM:LootingOn(), true, "lockdown: still on")
eq(errors[1] and errors[1].text, "Can't do that during a boss encounter.", "lockdown: red error text")
eq(errors[1] and errors[1].r, 1, "error text: red")
eq(errors[1] and errors[1].g, 0.1, "error text: red, not orange")
eq(select(2, LM:ChooseLooting(true)), "locked", "lockdown: Turn on refused too, with the reason")
eq(#outbox, 0, "lockdown: nothing sent")
-- still locked when the encounter ends: tried again every 2 s, sent once the lockdown lifts
timers = {}
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 1)
eq(#outbox, 0, "encounter end, still locked: nothing yet")
runTimers()
eq(#outbox, 0, "still locked 2 s later: nothing yet")
LOCKED = false
runTimers()
local retried = take()
eq(#retried, 1, "lockdown lifted: the heartbeat goes out")
check(retried[1] and retried[1]:sub(1, 2) == "H|", "lockdown lifted: it is an H")
runTimers()
eq(#outbox, 0, "lockdown lifted: no more tries")
-- the retries give up after 20 s
LOCKED = true
timers = {}
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 1)
local tries = 0
while #timers > 0 and tries < 50 do tries = tries + 1 runTimers() end
eq(tries, 10, "retries: every 2 s for 20 s")
LOCKED = false
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 1)
local afterFight = take()
eq(#afterFight, 1, "encounter end: one heartbeat straight away")
check(afterFight[1] and afterFight[1]:sub(1, 2) == "H|", "encounter end: it is an H")
eq(LM:ChooseLooting(true), true, "after the encounter: a click works")
take()
eq(live(LM.HEARTBEAT_SECONDS), 1, "yes again: still one heartbeat ticker")

-- 5. A raider takes it from the current raid leader only
ME = "Halo"
printed = {}
deliver(box, "Quick-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader hasn't turned it on", "raider: not from someone who isn't the leader")
eq(#printed, 0, "raider: nothing said for a refused message")
fired = {}
deliver(box, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "raider: on from the leader")
eq(lastPrint(), "CRT Looting: on (leader Solex)", "raider: said in chat")
check((fired.looting or 0) > 0, "raider: the page is told")
local st = LM:LootingState()
eq((LM.AutoPass:Ready(st)), true, "raider: the gate's leader checks hold")
eq(st.me, "Halo-Sargeras", "state: me")
eq(st.leader, "Solex-Sargeras", "state: leader")
eq(st.from, "Solex-Sargeras", "state: from")
eq(st.myInstance, HERE, "state: my instance")
eq(st.finder, false, "state: not a finder group")
eq(st.inRaid, true, "state: in a raid")
eq(st.enableInParty, false, "state: Enable in party")
eq(st.yesInstance, HERE, "state: Yes instance")
eq(st.leaderInstance, HERE, "state: leader's instance")
eq(st.leaderOnline, true, "state: online")
eq(st.heartbeatAt, NOW, "state: heartbeat time")
eq(st.now, NOW, "state: now")
eq(st.test, false, "state: not a test")
eq(type(st.passed), "table", "state: the passed list")
local roll = { id = 1, test = false, instance = HERE, bossInstance = HERE, inFilter = true }
eq((LM.AutoPass:ShouldPass(st, roll)), true, "gate: a boss roll here would pass")
eq(LM:LeaderFilter() ~= nil, true, "the leader's loot filter came with its word")
-- the leader goes offline: off, said, and forgotten until its next word
printed = {}
OFFLINE.Solex = true
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader is offline", "raider: leader offline")
tick(LM.LOOTING_TICK)
eq(lastPrint(), "CRT Looting: off: the raid leader is offline", "offline: said in chat")
OFFLINE.Solex = nil
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader is offline", "offline: still off when back, until its next word")
deliver(beat, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "offline: the next heartbeat turns it on")
-- the heartbeat goes quiet: the 90 s keep counting through an encounter; said after it, with a 10 s grace
printed = {}
NOW = NOW + 60
tick(LM.LOOTING_TICK)
eq(#printed, 0, "quiet: 60 s is fine")
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
NOW = NOW + 31
eq(LM:LootingStatus(), "CRT Looting: off: no word from the raid leader for 90 seconds", "quiet: the clock didn't stop for the encounter")
tick(LM.LOOTING_TICK)
eq(#printed, 0, "quiet: nothing said during an encounter")
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 0)
tick(LM.LOOTING_TICK)
eq(#printed, 0, "quiet: nothing said in the grace after the encounter")
NOW = NOW + 5
deliver(beat, "Solex-Sargeras")
eq(#printed, 0, "quiet: the heartbeat in the grace: nothing said at all")
NOW = NOW + 91
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 0)
NOW = NOW + LM.QUIET_GRACE + 1
fired = {}
tick(LM.LOOTING_TICK)
eq(lastPrint(), "CRT Looting: off: no word from the raid leader for 90 seconds", "quiet: said after the grace")
check((fired.looting or 0) > 0, "quiet: the page is told when it flips")
deliver(beat, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "heartbeat: on again")
eq(lastPrint(), "CRT Looting: on (leader Solex)", "heartbeat: said in chat")
-- a test session can never pass
LM.incoming = { test = true }
eq(select(2, LM.AutoPass:ShouldPass(LM:LootingState(), roll)), "test", "test session: the gate says no first")
LM.incoming = nil
-- an O for another instance, or from an old CRT
deliver({ "O|" .. V .. "|2810-15" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader said Yes for another instance", "raider: another instance")
deliver({ "O|0.26.0|" .. HERE }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader's CRT is too old", "raider: an old leader")
deliver(box, "Solex-Sargeras")
-- the lead moves A to B and back to A with no new O: off, and the old word is gone
GROUP.leader = "Quick-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader changed", "raider: lead moved")
deliver(beat, "Solex-Sargeras")
eq(LM:LootingState().from, nil, "raider: the old leader's heartbeat is dropped")
GROUP.leader = "Solex-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader changed", "raider: lead back: still off without a new O")
eq((LM.AutoPass:Ready(LM:LootingState())), false, "raider: lead back: the gate says no")
deliver(box, "Solex-Sargeras")
-- the leader not known for a moment (the roster updating): the word is kept
GROUP.leader = nil
onEvent("GROUP_ROSTER_UPDATE")
GROUP.leader = "Solex-Sargeras"
eq(LM:LootingState().from, "Solex-Sargeras", "leader unknown for a moment: the word is kept")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "leader unknown for a moment: still on")
deliver(box, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "raider: on again after a new O")
-- the leader's reload: off before any heartbeat
deliver({ "F|" .. V .. "|reload" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader reloaded", "raider: the leader reloaded")
eq((LM.AutoPass:Ready(LM:LootingState())), false, "raider: after the leader's reload the gate says no")
deliver(box, "Solex-Sargeras")
-- off for everyone: said with the reason
printed = {}
deliver({ "F|" .. V .. "|off" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader turned it off", "raider: turned off")
eq(lastPrint(), "CRT Looting: off: the raid leader turned it off", "raider: said in chat")
deliver({ "F|" .. V .. "|no" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader said No", "raider: said No")
eq(lastPrint(), "CRT Looting: off: the raid leader turned it off", "raider: already off, a No says nothing more")
deliver(box, "Solex-Sargeras")
deliver({ "F|" .. V .. "|no" }, "Solex-Sargeras")
eq(lastPrint(), "CRT Looting: off: the raid leader said No", "raider: on, then said No in chat")
deliver({ "F|" .. V .. "|party" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: Enable in party was turned off", "raider: Enable in party turned off")
deliver({ "F|" .. V .. "|instance" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader entered another instance", "raider: leader entered another instance")
deliver({ "F|" .. V .. "|away" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader was out of the instance for over 10 minutes", "raider: leader away too long")
deliver({ "F|9.9.9|whatever" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader turned it off", "raider: an unknown reason is just off")
-- a finder group, or a party with Enable in party off, is refused on the raider's side too
deliver(box, "Solex-Sargeras")
GROUP.lfg = true
eq(LM:LootingState().finder, true, "finder: in the state")
eq(LM:LootingStatus(), "CRT Looting: off: a finder group has no raid leader to follow", "finder: off")
GROUP.lfg = nil
GROUP.raid = false
eq(LM:LootingState().inRaid, false, "party: in the state")
eq(LM:LootingStatus(), "CRT Looting: off: you are in a party, and Enable in party is off", "party: off")
CRT.db.lootmaster.enableInParty = true
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "party: on with Enable in party")
CRT.db.lootmaster.enableInParty = false
GROUP.raid = nil
-- a raider's wipe: still on when back in the same instance; another instance isn't the one said Yes for
goOutside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingStatus(), "CRT Looting: off: you are not in a raid instance", "raider outside: off")
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "raider back in: on again")
WHERE.difficulty = 15
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader said Yes for another instance", "raider in another instance: off")
WHERE.difficulty = 16
onEvent("PLAYER_ENTERING_WORLD", false, false)
-- the leader's wipe: outside for up to 10 minutes still counts
deliver({ "H|" .. V .. "|" .. HERE .. "|world|590" }, "Solex-Sargeras")
eq(LM:LootingState().leaderInstance, nil, "leader outside: no instance")
eq(LM:LootingState().leaderOpenWorld, true, "leader outside: in the open world")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "leader outside 590 s: on")
NOW = NOW + 10
eq(LM:LootingState().leaderAway, 600, "leader away: counted to now")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "leader outside 600 s: on")
NOW = NOW + 1
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader is not in this instance", "leader outside 601 s: off")
deliver({ "H|" .. V .. "|" .. HERE .. "|2810-15|0" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader is not in this instance", "leader in another raid instance: off")
deliver({ "H|" .. V .. "|" .. HERE .. "|world|" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader is not in this instance", "leader outside, no away time: off")
deliver({ "H|" .. V .. "|" .. HERE .. "||5" }, "Solex-Sargeras")
eq(LM:LootingState().leaderOpenWorld, false, "leader's place empty: not the open world")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader is not in this instance", "leader's place empty: off")
deliver({ "H|" .. V .. "|" .. HERE .. "|world|5" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "leader in the open world 5 s: on")
-- bad messages change nothing
deliver({ "F|" .. V .. "|off" }, "Solex-Sargeras")
deliver({ "O|" .. V, "H|" .. V, "O" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader turned it off", "raider: messages with no instance do nothing")
take()

-- 6. The leader: off for everyone, No, wipes, another instance, losing the lead
ME = "Solex"
printed = {}
eq(LM:SetLooting(false, "off"), true, "off: turned off")
eq(LM:LootingOn(), false, "off: off")
eq(take()[1], "F|" .. V .. "|off", "off: F with the reason")
eq(live(LM.HEARTBEAT_SECONDS), 0, "off: the heartbeat stops")
eq(lastPrint(), "CRT Looting: off for everyone.", "off: said in chat")
eq(LM:LootingStatus(), "CRT Looting: off", "off: the leader's line")
LM:SetLooting(false, "no")
eq(take()[1], "F|" .. V .. "|no", "no: F no")
eq(LM:LootingStatus(), "CRT Looting: off: you said No", "no: the leader's line")
-- a wipe: dead, released, running back. Still on, the heartbeat goes on, not asked again
LM:SetLooting(true)
take()
n = asked
goOutside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), true, "wipe: still on outside")
eq(take()[1], "H|" .. V .. "|" .. HERE .. "|world|0" .. FF, "wipe: a heartbeat straight away says the leader is in the open world")
NOW = NOW + 30
tick(30)
eq(take()[1], "H|" .. V .. "|" .. HERE .. "|world|30" .. FF, "wipe: the heartbeat goes on, with the time away")
eq(LM:LootingStatus(), "CRT Looting: on for everyone in the raid with CRT", "wipe: the leader's line")
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, n, "wipe: not asked again on the way back in")
eq(LM:LootingOn(), true, "wipe: still on inside")
eq(take()[1], "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0" .. FF, "wipe: back in, a heartbeat says so")
-- out for over 10 minutes: off
goOutside()
onEvent("ZONE_CHANGED_NEW_AREA")
take()
NOW = NOW + 590
tick(30)
eq(LM:LootingOn(), true, "away 590 s: still on")
NOW = NOW + 30
printed = {}
tick(30)
eq(LM:LootingOn(), false, "away 620 s: off")
local away = take()
eq(away[#away], "F|" .. V .. "|away", "away: F away")
eq(lastPrint(), "CRT Looting: off, you were out of the instance for over 10 minutes.", "away: said in chat")
eq(live(LM.HEARTBEAT_SECONDS), 0, "away: no heartbeat")
eq((LM:SetLooting(true)), false, "outside: can't turn it on")
eq(#outbox, 0, "outside: nothing sent")
eq(LM:LootingStatus(), "CRT Looting: off: you are not in a raid instance", "outside: the leader's line")
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
-- another raid instance while on: off, and asked there
LM:SetLooting(true)
take()
n = asked
WHERE.difficulty = 15
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), false, "another raid instance: off")
eq(take()[1], "F|" .. V .. "|instance", "another raid instance: F instance")
eq(asked, n + 1, "another raid instance: asked there")
WHERE.difficulty = 16
onEvent("PLAYER_ENTERING_WORLD", false, false)
take()
-- only the open world counts as outside: any other instance turns it off for everyone
for _, kind in ipairs({ "party", "scenario", "pvp", "arena", "neighborhood", "interior" }) do
  LM:SetLooting(true)
  take()
  printed = {}
  WHERE.inside, WHERE.kind = true, kind
  onEvent("PLAYER_ENTERING_WORLD", false, false)
  eq(LM:LootingOn(), false, kind .. ": off")
  eq(take()[1], "F|" .. V .. "|instance", kind .. ": F instance")
  eq(lastPrint(), "CRT Looting: off, you entered another instance.", kind .. ": said in chat")
  eq(live(LM.HEARTBEAT_SECONDS), 0, kind .. ": no heartbeat")
  goInside()
  onEvent("PLAYER_ENTERING_WORLD", false, false)
  take()
end
-- on in the open world, then into a dungeon: off
LM:SetLooting(true)
take()
goOutside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), true, "open world: still on")
WHERE.inside, WHERE.kind = true, "party"
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), false, "open world, then a dungeon: off")
local msgs = take()
eq(msgs[#msgs], "F|" .. V .. "|instance", "open world, then a dungeon: F instance")
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
take()
-- the lead lost
LM:SetLooting(true)
take()
GROUP.leader = "Halo-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(LM:LootingOn(), false, "lead lost: off")
eq(live(LM.HEARTBEAT_SECONDS), 0, "lead lost: no heartbeat")
eq(lastPrint(), "CRT Looting: off: you are not the raid leader.", "lead lost: said why")
eq((LM:SetLooting(true)), false, "not the leader: can't turn it on")
GROUP.leader = "Solex-Sargeras"
GROUP.lfg = true
eq((LM:SetLooting(true)), false, "finder group: can't turn it on")
GROUP.lfg = nil
GROUP.raid = false
eq((LM:SetLooting(true)), false, "party with Enable in party off: can't turn it on")
CRT.db.lootmaster.enableInParty = true
eq((LM:SetLooting(true)), true, "party with Enable in party on: turned on")
CRT.db.lootmaster.enableInParty = false
take()
LM.LootingRecheck("setting")
eq(LM:LootingOn(), false, "party: turning Enable in party off turns it off")
eq(take()[1], "F|" .. V .. "|party", "party: F party")
GROUP.raid = nil
take()
local own = GROUP
GROUP = nil
eq((LM:SetLooting(true)), false, "alone: can't turn it on")
GROUP = own
-- the leader's own messages coming back change nothing for it
LM:SetLooting(true)
deliver(take(), "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on for everyone in the raid with CRT", "leader: own O changes nothing")
eq(select(2, LM.AutoPass:Ready(LM:LootingState())), "looter", "leader: the gate never passes for the looter")

-- 7. Saved per character: the leader's Yes lasts through a /reload, until it is turned off or a safety off happens
local function keys(t) local out = {} for k in pairs(t or {}) do out[#out + 1] = tostring(k) end table.sort(out) return table.concat(out, ",") end
local function S() return CRTDBChar.lootmaster and CRTDBChar.lootmaster.looting end
eq(keys(CRTDBChar), "lootmaster", "CRTDBChar: only lootmaster")
eq(keys(CRTDBChar.lootmaster), "lastKill,looting", "CRTDBChar lootmaster: the last kill (Comm.lua's) and the saved Yes")
eq(keys(CRT.db.lootmaster), "authority,enableInParty", "nothing new in CRTDB lootmaster (a profile key)")
eq(keys(S()), "at,instance,on", "saved: on, instance and at only")
eq(S().on, true, "saved: on")
eq(S().instance, HERE, "saved: the instance said Yes for")
eq(S().at, time(), "saved: when it was last confirmed")
-- the heartbeat in the instance confirms it again
NOW = NOW + 30
take()
tick(30)
eq(S().at, time(), "saved: each heartbeat in the instance confirms it")
-- a /reload (or login) as the leader in the same instance: back on, O and a heartbeat, no prompt, no F reload
local function reload()
  loadLooting()
  LM.AskLooting = function() asked = asked + 1 end
  timers = {}
  take()
  printed = {}
  onEvent("PLAYER_ENTERING_WORLD", false, true)
end
n = asked
reload()
eq(LM:LootingOn(), true, "reload, same instance: back on")
eq(asked, n, "reload, same instance: not asked")
box = take()
eq(#box, 2, "reload, same instance: two messages")
eq(box[1], "O|" .. V .. "|" .. HERE .. FF, "reload, same instance: the O again, with the loot filter")
eq(box[2], "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0" .. FF, "reload, same instance: and a heartbeat")
eq(lastPrint(), "CRT Looting: still on for everyone in the raid with CRT.", "reload, same instance: said in chat")
eq(LM:LootingStatus(), "CRT Looting: on for everyone in the raid with CRT", "reload, same instance: the leader's line")
eq(live(LM.HEARTBEAT_SECONDS), 1, "reload, same instance: the heartbeat ticker runs")
onEvent("GROUP_ROSTER_UPDATE")
eq(asked, n, "reload, same instance: a roster update doesn't ask either")
-- a /reload during a boss encounter's chat lockdown: on, but nothing sent until it lifts
LOCKED = true
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
reload()
eq(LM:LootingOn(), true, "reload in a lockdown: back on")
eq(#outbox, 0, "reload in a lockdown: no O, no F reload, no heartbeat")
LOCKED = false
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 1)
box = take()
eq(#box, 1, "reload in a lockdown: one message when the encounter ends")
eq(box[1], "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0" .. FF, "reload in a lockdown: the heartbeat after ENCOUNTER_END")
LOCKED = true
reload()
eq(#outbox, 0, "reload in a lockdown again: nothing sent")
LOCKED = false
onEvent("PLAYER_REGEN_ENABLED")
box = take()
eq(box[1], "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0" .. FF, "reload in a lockdown: the heartbeat after combat ends")
-- Turn off for everyone clears it: the next /reload starts off, and isn't asked again (it was answered in
-- this instance tonight: CRTDBChar lootmaster.lootingAsked)
LM:SetLooting(false, "off")
eq(S(), nil, "turn off: the saved state is cleared")
n = asked
reload()
eq(LM:LootingOn(), false, "turn off, then reload: off")
eq(take()[1], "F|" .. V .. "|reload", "turn off, then reload: the F reload still goes")
eq(asked, n, "turn off, then reload: not asked again, it was answered here tonight")
eq(CRTDBChar.lootmaster.lootingAsked and CRTDBChar.lootmaster.lootingAsked.instance, HERE, "the answered instance is kept")
-- a login in another instance: off, cleared
LM:SetLooting(true)
WHERE.difficulty = 15
reload()
eq(LM:LootingOn(), false, "login in another instance: off")
eq(S(), nil, "login in another instance: cleared")
WHERE.difficulty = 16
onEvent("PLAYER_ENTERING_WORLD", false, false)
reload()
eq(LM:LootingOn(), false, "back in the first instance after that: still off")
-- a log out and back in inside its instance after the away limit, within the raid night: back on, no prompt
LM:SetLooting(true)
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
NOW = NOW + LM.LOOTING_AWAY + 1
take()
n = asked
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), true, "login inside after the away limit, same night: on")
eq(take()[1], "O|" .. V .. "|" .. HERE .. FF, "login inside after the away limit: the O")
eq(asked, n, "login inside after the away limit: not asked")
-- a log out, and back in later the same night outside: off (raiders told), kept; on again on entering
NOW = NOW + 30
tick(30)
goOutside()
NOW = NOW + 3600
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
take()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), false, "login outside an hour later: off")
eq(take()[1], "F|" .. V .. "|reload", "login outside an hour later: raiders told it starts off")
eq(S() and S().instance, HERE, "login outside an hour later: the Yes is kept for its instance")
WHERE.difficulty = 15
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), false, "then another instance: off")
eq(S(), nil, "then another instance: cleared")
WHERE.difficulty = 16
goOutside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
take()
LM:SetLooting(true) -- (outside, so refused: CanRunLooting needs the instance)
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
LM:SetLooting(true)
NOW = NOW + 30
tick(30)
goOutside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
NOW = NOW + 3600
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
onEvent("PLAYER_ENTERING_WORLD", false, false)
take()
n = asked
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), true, "re-entering its instance the same night: on again")
box = take()
eq(box[1], "O|" .. V .. "|" .. HERE .. FF, "re-entering: the O")
eq(box[2], "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0" .. FF, "re-entering: and a heartbeat")
eq(asked, n, "re-entering: not asked")
-- after the raid night (6 hours since it was last confirmed): off, cleared, asked again
NOW = NOW + LM.RESTORE_HOURS * 3600 + 1
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
take()
n = asked
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), false, "login the next day: off")
eq(S(), nil, "login the next day: cleared")
eq(take()[1], "F|" .. V .. "|reload", "login the next day: raiders told")
eq(asked, n + 1, "login the next day: asked again")
eq(CRTDBChar.lootmaster.lootingAsked, nil, "login the next day: the old answer is gone")
-- a weekly reset since it was last confirmed: a new lockout, cleared
C_DateAndTime = { GetSecondsUntilWeeklyReset = function() return 60 end }
LM:SetLooting(true)
C_DateAndTime = nil
NOW = NOW + 61
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
take()
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), false, "login after a weekly reset: off")
eq(S(), nil, "login after a weekly reset: cleared")
take()
-- a /reload in the open world on a wipe, within the away limit: on, away counted from the last confirm
LM:SetLooting(true)
take()
goOutside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
NOW = NOW + 60
reload()
eq(LM:LootingOn(), true, "reload in the open world within the limit: on")
box = take()
eq(#box, 1, "reload in the open world: only the heartbeat")
eq(box[1], "H|" .. V .. "|" .. HERE .. "|world|60" .. FF, "reload in the open world: a heartbeat with the time away")
NOW = NOW + LM.LOOTING_AWAY
tick(30)
eq(LM:LootingOn(), false, "reload in the open world: still turned off when out too long")
eq(S(), nil, "away off: cleared")
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
take()
-- losing the lead clears it
LM:SetLooting(true)
GROUP.leader = "Halo-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(S(), nil, "lead lost: cleared")
GROUP.leader = "Solex-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
reload()
eq(LM:LootingOn(), false, "lead lost, then reload: off")
-- a fresh login where the group isn't known yet: waits for the first group event
LM:SetLooting(true)
local savedGroup = GROUP
GROUP = nil
n = asked
reload()
eq(LM:LootingOn(), false, "login, group not known yet: not on yet")
eq(S() and S().on, true, "login, group not known yet: the saved Yes is kept")
eq(#outbox, 0, "login, group not known yet: nothing sent")
eq(asked, n, "login, group not known yet: not asked")
GROUP = savedGroup
onEvent("GROUP_ROSTER_UPDATE")
eq(LM:LootingOn(), true, "login, then the group: back on")
box = take()
eq(box[1], "O|" .. V .. "|" .. HERE .. FF, "login, then the group: the O")
eq(box[2], "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0" .. FF, "login, then the group: and a heartbeat")
eq(asked, n, "login, then the group: not asked")
runTimers()
eq(LM:LootingOn(), true, "login, then the group: the wait's end changes nothing")
eq(#outbox, 0, "login, then the group: nothing more sent")
-- the first group event says someone else leads: off, cleared, and raiders aren't told by a non-leader
reload()
take()
GROUP.leader = "Halo-Sargeras"
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
timers = {}
onEvent("PLAYER_ENTERING_WORLD", false, true)
eq(S() and S().on, true, "login not leading: kept until the group is known")
onEvent("PARTY_LEADER_CHANGED")
eq(LM:LootingOn(), false, "login not leading: off")
eq(S(), nil, "login not leading: cleared")
eq(#outbox, 0, "login not leading: nothing sent")
GROUP.leader = "Solex-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
-- no group event within the wait: given up at its end (the leader's raiders told it starts off)
LM:SetLooting(true)
GROUP = nil
reload()
eq(S() and S().on, true, "no group event: kept for the wait")
eq(LM.RESUME_WAIT, 5, "the wait is 5 seconds")
GROUP = savedGroup
GROUP.leader = "Halo-Sargeras"
runTimers()
eq(LM:LootingOn(), false, "no group event, not leading at the wait's end: off")
eq(S(), nil, "no group event: cleared at the wait's end")
GROUP.leader = "Solex-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
take()
-- another instance while on, and Enable in party turned off: cleared
reload()
LM:SetLooting(true)
WHERE.inside, WHERE.kind = true, "party"
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(S(), nil, "another instance: cleared")
goInside()
onEvent("PLAYER_ENTERING_WORLD", false, false)
GROUP.raid = false
CRT.db.lootmaster.enableInParty = true
LM:SetLooting(true)
CRT.db.lootmaster.enableInParty = false
LM.LootingRecheck("setting")
eq(S(), nil, "Enable in party turned off: cleared")
GROUP.raid = nil
eq(keys(CRT.db.lootmaster), "authority,enableInParty", "still nothing new in CRTDB lootmaster")
-- a raider's own /reload: off (the gate fails closed) until it hears the leader again
LM:SetLooting(true)
local on = take()
ME = "Halo"
deliver(on, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "raider: on before its reload")
CRTDBChar.lootmaster.looting = nil -- a raider's own character has no saved Yes
reload()
eq(#outbox, 0, "raider reload: sends nothing")
eq(LM:LootingOn(), false, "raider reload: never leads it")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader hasn't turned it on", "raider reload: off")
eq((LM.AutoPass:Ready(LM:LootingState())), false, "raider reload: the gate says no")
eq((LM.AutoPass:ShouldPass(LM:LootingState(), roll)), false, "raider reload: a boss roll isn't passed")
deliver({ "H|" .. V .. "|" .. HERE .. "|" .. HERE .. "|0" .. FF }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "raider reload: on again from the leader's heartbeat")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/AutoPass.lua', 'CRT_Modules/LootMaster/Looting.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
