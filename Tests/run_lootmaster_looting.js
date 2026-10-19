// LootMaster/Looting.lua: CRT Looting on and off. One Lua state plays the leader and the raiders in turn
// (who you are is swapped), with the messages caught and delivered by hand: an older client drops the new
// kinds, the instance prompt (who is asked and when), on, off and the heartbeat, raiders taking them only
// from the current raid leader, the state line in chat and on the page, the gate's state, and nothing saved.
// Usage: node run_lootmaster_looting.js <addon folder>
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
time = function() return 1790000000 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
local ME = "Solex"
local GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras" }, leader = "Solex-Sargeras" }
UnitName = function(u)
  if u == "player" then return ME end
  local i = tonumber((u or ""):match("^raid(%d+)$"))
  if GROUP and i and GROUP.names[i] then local n, r = GROUP.names[i]:match("^(.-)%-(.*)$") return n, r ~= "Sargeras" and r or nil end
end
GetNormalizedRealmName = function() return "Sargeras" end
LE_PARTY_CATEGORY_HOME, LE_PARTY_CATEGORY_INSTANCE = 1, 2
IsInGroup = function(cat) if cat == 2 then return GROUP ~= nil and GROUP.lfg == true end return GROUP ~= nil end
IsInRaid = function() return GROUP ~= nil end
GetNumGroupMembers = function() return GROUP and #GROUP.names or 0 end
GetNumSubgroupMembers = function() return 0 end
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
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function(p, text, ch) if result ~= 0 then return result end outbox[#outbox+1] = text return 0 end }
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
local CRT = { db = { lootmaster = { authority = { leader = true, names = {} } } } }
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

-- 1. An older client (no Looting.lua): the new kinds are dropped without an error
local before = fails
ME = "Halo"
msg("O|0.27.0|" .. HERE, "Solex-Sargeras")
msg("H|0.27.0|" .. HERE .. "|" .. HERE, "Solex-Sargeras")
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

-- 3. The prompt: the raid leader entering a raid instance, once per entry
ME = "Solex"
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 1, "prompt: the leader entering a raid instance is asked")
onEvent("PLAYER_ENTERING_WORLD", false, false)
onEvent("ZONE_CHANGED_NEW_AREA")
onEvent("GROUP_ROSTER_UPDATE")
eq(asked, 1, "prompt: not again in the same instance")
WHERE.inside, WHERE.kind = false, "none"
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 1, "prompt: not outside")
WHERE.inside, WHERE.kind = true, "raid"
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 2, "prompt: asked again on coming back in")
WHERE.difficulty = 15
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 3, "prompt: another difficulty is another instance")
WHERE.difficulty = 16
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(asked, 4, "prompt: back to Mythic")
-- not asked: a raider, a dungeon, a finder group, no group
local function askedOn(setup, undo)
  WHERE.inside, WHERE.kind = false, "none"
  onEvent("PLAYER_ENTERING_WORLD", false, false)
  setup()
  local n = asked
  onEvent("PLAYER_ENTERING_WORLD", false, false)
  local got = asked - n
  undo()
  return got
end
eq(askedOn(function() ME = "Halo" WHERE.inside, WHERE.kind = true, "raid" end, function() ME = "Solex" end), 0, "prompt: a raider isn't asked")
eq(askedOn(function() WHERE.inside, WHERE.kind = true, "party" end, function() end), 0, "prompt: not in a dungeon")
eq(askedOn(function() WHERE.inside, WHERE.kind = true, "raid" GROUP.lfg = true end, function() GROUP.lfg = nil end), 0, "prompt: not in a finder group")
local saved = GROUP
eq(askedOn(function() WHERE.inside, WHERE.kind = true, "raid" GROUP = nil end, function() GROUP = saved end), 0, "prompt: not alone")
-- becoming the leader inside asks then
WHERE.inside, WHERE.kind = true, "raid"
GROUP.leader = "Halo-Sargeras"
onEvent("PLAYER_ENTERING_WORLD", false, false)
local n = asked
GROUP.leader = "Solex-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(asked, n + 1, "prompt: asked on becoming the leader inside")
-- a /reload inside: off again, and asked again
loadLooting()
LM.AskLooting = function() asked = asked + 1 end
n = asked
onEvent("PLAYER_ENTERING_WORLD", false, true)
eq(asked, n + 1, "prompt: asked again after a /reload")
take()

-- 4. Yes: on for everyone, an O, then a heartbeat every 30 seconds
printed = {}
fired = {}
eq(LM:SetLooting(true), true, "yes: turned on")
eq(LM:LootingOn(), true, "yes: on")
local box = take()
eq(#box, 1, "yes: one message")
eq(box[1], "O|" .. LM.VERSION .. "|" .. HERE, "yes: O with the version and the instance")
eq(lastPrint(), "CRT Looting: on for everyone in the raid with CRT.", "yes: said in chat")
eq(LM:LootingStatus(), "CRT Looting: on for everyone in the raid with CRT", "yes: the leader's line")
check((fired.looting or 0) > 0, "yes: the page is told")
eq(live(LM.HEARTBEAT_SECONDS), 1, "yes: one heartbeat ticker")
eq(LM.HEARTBEAT_SECONDS, 30, "heartbeat every 30 s")
tick(30)
local beat = take()
eq(beat[1], "H|" .. LM.VERSION .. "|" .. HERE .. "|" .. HERE, "heartbeat: H with the version, the Yes instance and where the leader is")
-- in an encounter's chat lockdown no heartbeat piles up; one goes out when it ends
C_ChatInfo.InChatMessagingLockdown = function() return true end
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
tick(30)
tick(30)
eq(#outbox, 0, "lockdown: no heartbeat queued")
C_ChatInfo.InChatMessagingLockdown = function() return false end
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 1)
local afterFight = take()
eq(#afterFight, 1, "encounter end: one heartbeat straight away")
check(afterFight[1] and afterFight[1]:sub(1, 2) == "H|", "encounter end: it is an H")
eq(LM:SetLooting(true), true, "yes again: fine")
take()
eq(live(LM.HEARTBEAT_SECONDS), 1, "yes again: still one heartbeat ticker")

-- 5. A raider takes it from the current raid leader only
ME = "Halo"
printed = {}
deliver(box, "Quick-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader hasn't turned it on", "raider: not from someone who isn't the leader")
eq(#printed, 0, "raider: nothing said for a refused message")
deliver(box, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "raider: on from the leader")
eq(lastPrint(), "CRT Looting: on (leader Solex)", "raider: said in chat")
local st = LM:LootingState()
local ok, why = LM.AutoPass:Ready(st)
eq(ok, true, "raider: the gate's leader checks hold")
eq(st.me, "Halo-Sargeras", "state: me")
eq(st.leader, "Solex-Sargeras", "state: leader")
eq(st.from, "Solex-Sargeras", "state: from")
eq(st.myInstance, HERE, "state: my instance")
eq(st.yesInstance, HERE, "state: Yes instance")
eq(st.leaderInstance, HERE, "state: leader's instance")
eq(st.leaderOnline, true, "state: online")
eq(st.heartbeatAt, NOW, "state: heartbeat time")
eq(st.now, NOW, "state: now")
eq(st.test, false, "state: not a test")
eq(type(st.passed), "table", "state: the passed list")
-- a roll: still never passed in this version, but the gate says what it would do
local roll = { id = 1, test = false, instance = HERE, bossInstance = HERE }
eq((LM.AutoPass:ShouldPass(st, roll)), true, "gate: a boss roll here would pass")
-- the leader goes offline, then comes back
OFFLINE.Solex = true
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader is offline", "raider: leader offline")
OFFLINE.Solex = nil
-- the heartbeat goes quiet: off after 90 seconds, said in chat (not during an encounter)
printed = {}
NOW = NOW + 60
tick(LM.LOOTING_TICK)
eq(#printed, 0, "quiet: 60 s is fine")
NOW = NOW + 31
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
tick(LM.LOOTING_TICK)
eq(#printed, 0, "quiet: nothing said during an encounter")
eq(LM:LootingStatus(), "CRT Looting: off: no word from the raid leader for 90 seconds", "quiet: the line says why")
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 0)
tick(LM.LOOTING_TICK)
eq(lastPrint(), "CRT Looting: off: no word from the raid leader for 90 seconds", "quiet: said after the encounter")
deliver(beat, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "heartbeat: on again")
eq(lastPrint(), "CRT Looting: on (leader Solex)", "heartbeat: said in chat")
-- a test session can never pass
LM.incoming = { test = true }
eq(select(2, LM.AutoPass:ShouldPass(LM:LootingState(), roll)), "test", "test session: the gate says no first")
LM.incoming = nil
-- an O for another instance, or from an old CRT
deliver({ "O|" .. LM.VERSION .. "|2810-15" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader said Yes for another instance", "raider: another instance")
deliver({ "O|0.26.0|" .. HERE }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader's CRT is too old", "raider: an old leader")
deliver(box, "Solex-Sargeras")
-- the lead moves: the old leader's word no longer counts, and its messages are dropped
GROUP.leader = "Quick-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(LM:LootingStatus(), "CRT Looting: off: the message didn't come from the raid leader", "raider: lead moved")
deliver(beat, "Solex-Sargeras")
eq(LM:LootingState().from, "Solex-Sargeras", "raider: the old leader's heartbeat changes nothing")
GROUP.leader = "Solex-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
deliver(box, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "raider: on again")
-- off for everyone: said with the reason
printed = {}
deliver({ "F|" .. LM.VERSION .. "|off" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader turned it off", "raider: turned off")
eq(lastPrint(), "CRT Looting: off: the raid leader turned it off", "raider: said in chat")
deliver({ "F|" .. LM.VERSION .. "|no" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader said No", "raider: said No")
eq(lastPrint(), "CRT Looting: off: the raid leader said No", "raider: said No in chat")
deliver({ "F|" .. LM.VERSION .. "|left" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader left the instance", "raider: leader left")
deliver({ "F|9.9.9|whatever" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader turned it off", "raider: an unknown reason is just off")
-- a zone change starts off, until the leader's next word
deliver(box, "Solex-Sargeras")
WHERE.difficulty = 15
onEvent("PLAYER_ENTERING_WORLD", false, false)
WHERE.difficulty = 16
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader hasn't turned it on", "raider: off after a zone change")
deliver(beat, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on (leader Solex)", "raider: the next heartbeat turns it on")
WHERE.inside, WHERE.kind = false, "none"
onEvent("ZONE_CHANGED_NEW_AREA")
eq(LM:LootingStatus(), "CRT Looting: off: you are not in a raid instance", "raider: outside")
WHERE.inside, WHERE.kind = true, "raid"
onEvent("ZONE_CHANGED_NEW_AREA")
-- bad messages change nothing
deliver({ "O|" .. LM.VERSION, "H|" .. LM.VERSION, "O" }, "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader hasn't turned it on", "raider: messages with no instance do nothing")
take()

-- 6. The leader: off for everyone, No, leaving, losing the lead
ME = "Solex"
printed = {}
eq(LM:SetLooting(false, "off"), true, "off: turned off")
eq(LM:LootingOn(), false, "off: off")
eq(take()[1], "F|" .. LM.VERSION .. "|off", "off: F with the reason")
eq(live(LM.HEARTBEAT_SECONDS), 0, "off: the heartbeat stops")
eq(lastPrint(), "CRT Looting: off for everyone.", "off: said in chat")
eq(LM:LootingStatus(), "CRT Looting: off", "off: the leader's line")
LM:SetLooting(false, "no")
eq(take()[1], "F|" .. LM.VERSION .. "|no", "no: F no")
eq(LM:LootingStatus(), "CRT Looting: off: you said No", "no: the leader's line")
LM:SetLooting(true)
take()
WHERE.inside, WHERE.kind = false, "none"
onEvent("PLAYER_ENTERING_WORLD", false, false)
eq(LM:LootingOn(), false, "leaving: off")
eq(take()[1], "F|" .. LM.VERSION .. "|left", "leaving: F left")
eq(live(LM.HEARTBEAT_SECONDS), 0, "leaving: no heartbeat")
eq(LM:SetLooting(true), false, "outside: can't turn it on")
eq(#outbox, 0, "outside: nothing sent")
eq(LM:LootingStatus(), "CRT Looting: off: you are not in a raid instance", "outside: the leader's line")
WHERE.inside, WHERE.kind = true, "raid"
onEvent("PLAYER_ENTERING_WORLD", false, false)
LM:SetLooting(true)
take()
GROUP.leader = "Halo-Sargeras"
onEvent("PARTY_LEADER_CHANGED")
eq(LM:LootingOn(), false, "lead lost: off")
eq(live(LM.HEARTBEAT_SECONDS), 0, "lead lost: no heartbeat")
eq(lastPrint(), "CRT Looting: off: you are not the raid leader.", "lead lost: said why")
eq(LM:SetLooting(true), false, "not the leader: can't turn it on")
GROUP.leader = "Solex-Sargeras"
GROUP.lfg = true
eq(LM:SetLooting(true), false, "finder group: can't turn it on")
GROUP.lfg = nil
take()
local own = GROUP
GROUP = nil
eq(LM:SetLooting(true), false, "alone: can't turn it on")
GROUP = own
-- the leader's own messages coming back change nothing for it
LM:SetLooting(true)
deliver(take(), "Solex-Sargeras")
eq(LM:LootingStatus(), "CRT Looting: on for everyone in the raid with CRT", "leader: own O changes nothing")
eq(select(2, LM.AutoPass:Ready(LM:LootingState())), "looter", "leader: the gate never passes for the looter")

-- 7. Memory only: nothing saved, and a /reload starts off
local function keys(t) local out = {} for k in pairs(t or {}) do out[#out + 1] = tostring(k) end table.sort(out) return table.concat(out, ",") end
eq(keys(CRTDBChar), "lootmaster", "nothing in CRTDBChar but the last kill")
eq(keys(CRTDBChar.lootmaster), "lastKill", "CRTDBChar lootmaster: only the last kill (Comm.lua's)")
eq(keys(CRT.db.lootmaster), "authority", "nothing in CRTDB lootmaster")
loadLooting()
eq(LM:LootingOn(), false, "reload: the leader starts off")
ME = "Halo"
eq(LM:LootingStatus(), "CRT Looting: off: the raid leader hasn't turned it on", "reload: a raider starts off")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['LootMaster/Data.lua', 'LootMaster/Comm.lua', 'LootMaster/AutoPass.lua', 'LootMaster/Looting.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
