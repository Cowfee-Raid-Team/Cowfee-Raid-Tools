// Raid Groups' roster share (CRT_Modules/Groups/Share.lua): the active layout sent with a pushed note, on its own
// prefix through the shared send queue (CRT_Core/Comm.lua), and a raider taking it as their active layout. The real
// Groups/Data.lua, Notes/Comm.lua (its sender check) and Late/Data.lua (the Late Tracker's expected names).
//   Sending: the prefix, parts under 255 bytes, a 40-slot layout with empty slots and realm names round-trips in
//   several parts, dedupe per channel, nothing sent with no active layout, an empty one, out of a group, not the
//   leader or an assistant, or in combat.
//   Receiving: only from the leader or an assistant, never your own; stored tagged from the sender, replaced by
//   their next one, your own layouts untouched, made active with one chat line; malformed and incomplete (timed
//   out) messages dropped without an error.
// Usage: node run_roster_share.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local commSrc, groupsSrc, noteCommSrc, shareSrc, lateSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
GetNormalizedRealmName = function() return "Sargeras" end
Ambiguate = function(n) return (n:gsub("%-Sargeras$", "")) end
time = function(t) if t then return os.time(t) end return 1790000000 end
date = os.date
local CLOCK = 100
GetTime = function() return CLOCK end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = fn end, NewTicker = function() end }
LE_PARTY_CATEGORY_INSTANCE = 2
local grouped, raid = true, true
IsInGroup = function(c) if c == 2 then return false end return grouped end
IsInRaid = function() return raid end
IsInGuild = function() return false end
local leaders = {}
UnitIsGroupLeader = function(u) return leaders[u] == "lead" end
UnitIsGroupAssistant = function(u) return leaders[u] == "assist" end
local me = "Solex"
UnitName = function(u) if u == "player" then return me end end
local combat = false
InCombatLockdown = function() return combat end
GetNumGroupMembers = function() return 0 end
GetRaidRosterInfo = function() end
UnitGroupRolesAssigned = function() return "NONE" end
UnitIsUnit = function() return false end
issecretvalue = function(v) return v == "SECRET" end
local sent = {}
local prefixes = {}
C_ChatInfo = { RegisterAddonMessagePrefix = function(p) prefixes[#prefixes + 1] = p end,
  SendAddonMessage = function(prefix, text, channel) sent[#sent + 1] = { prefix = prefix, text = text, channel = channel } return 0 end }
CreateFrame = function() local f = {} function f:RegisterEvent() end function f:SetScript(_, fn) self.fn = fn end return f end

local function freshGroups() return { presets = {}, nextId = 1, keepChanges = true, source = "raid", working = {}, roles = {} } end
local CRT = { db = { groups = freshGroups(), classCache = {}, roleCache = {}, ui = {}, notes = { list = {} },
  late = { days = {}, hour = 20, minute = 0, grace = 0, onlyTeam = false, history = {}, nextId = 1, lastAuto = "" } } }
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
CRT.Notes = { Busy = function() return combat end, TrustedOnly = function() return true end }
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(groupsSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(noteCommSrc, "Notes/Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(shareSrc, "Share.lua"))("CowfeeRaidTools", CRT)
assert(load(lateSrc, "Late/Data.lua"))("CowfeeRaidTools", CRT)
local Groups, Share = CRT.Groups, CRT.RosterShare
check(Share ~= nil, "CRT.RosterShare is made")
local fired = 0
Groups:OnChange(function() fired = fired + 1 end)

-- the prefix
eq(Share.PREFIX, "CRTRoster1", "prefix: CRTRoster1")
check(#Share.PREFIX <= 16, "prefix: at most 16 characters")
local registered = false
for _, p in ipairs(prefixes) do if p == Share.PREFIX then registered = true end end
check(registered, "prefix: registered with the game")

-- the sender's layout: 40 slots, empty ones among them, names from several realms
local slots = {}
for i = 1, 40 do
  if i % 7 == 0 then slots[i] = ""
  elseif i % 3 == 0 then slots[i] = "Raider" .. i .. "-TwistingNether"
  else slots[i] = "Player" .. i .. "-Sargeras" end
end
local mainId = Groups:CreatePreset("Main; Mythic", slots)
Groups:SetActive(mainId)
leaders.player = "lead"

-- encode, then decode
local messages, hash = Share.Pack("Main; Mythic", slots)
check(#messages > 2, "pack: a 40-slot layout goes in several parts (" .. #messages .. ")")
for i, m in ipairs(messages) do
  check(#m < 255, "pack: part " .. i .. " under 255 bytes (" .. #m .. ")")
  check(m:find("^" .. hash .. "|" .. i .. "|" .. #messages .. "|") ~= nil, "pack: part " .. i .. " has the id, part and count")
end
local whole = {}
for i, m in ipairs(messages) do whole[i] = m:match("^%x+|%d+|%d+|(.*)$") end
local name2, slots2 = Share.Unpack(table.concat(whole))
eq(name2, "Main; Mythic", "unpack: the name back")
local same = true
for i = 1, 40 do if slots2[i] ~= slots[i] then same = false end end
check(same, "unpack: all 40 slots back, the empty ones empty")
eq(Share.Unpack("garbage"), nil, "unpack: not a layout")
eq(Share.Unpack(nil), nil, "unpack: nothing")

-- Push: sent on the group channel through the shared queue
local ok, line = Share:Push()
check(ok, "push: sent")
eq(line, "Roster 'Main; Mythic' sent.", "push: the status line")
eq(#sent, #messages, "push: every part sent")
for i, m in ipairs(sent) do
  eq(m.prefix, "CRTRoster1", "push: part " .. i .. " on the roster prefix")
  eq(m.channel, "RAID", "push: part " .. i .. " to the raid")
  eq(m.text, messages[i], "push: part " .. i .. " as packed")
end
local firstSent = {}
for i, m in ipairs(sent) do firstSent[i] = m.text end

-- dedupe: unchanged is not sent again; a change is; another channel is its own
ok, line = Share:Push()
check(not ok and #sent == #messages, "dedupe: an unchanged layout isn't sent again")
eq(line, "Roster 'Main; Mythic' not sent again: it hasn't changed.", "dedupe: the status line")
raid = false
ok = Share:Push()
check(ok and sent[#sent].channel == "PARTY", "dedupe: another channel gets it")
raid = true

-- not sent: no active layout, an empty one, out of a group, not the leader, in combat
local before = #sent
Groups:SetActive(nil)
ok, line = Share:Push()
check(not ok and #sent == before, "no active layout: nothing sent")
eq(line, "Roster not sent: no Raid Groups layout is active.", "no active layout: the status line")
local emptyId = Groups:CreatePreset("Empty", {})
Groups:SetActive(emptyId)
ok, line = Share:Push()
check(not ok and #sent == before, "an empty layout: nothing sent")
eq(line, "Roster not sent: the layout 'Empty' has no names.", "an empty layout: the status line")
Groups:SetActive(mainId)
grouped, raid = false, false
ok, line = Share:Push()
check(not ok and #sent == before, "solo: nothing sent")
eq(line, "Roster not sent: you're not in a group.", "solo: the status line")
grouped, raid = true, true
leaders.player = nil
ok, line = Share:Push()
check(not ok and #sent == before, "a raider: nothing sent")
eq(line, "Roster not sent: only the raid leader or an assistant can send it.", "a raider: the status line")
leaders.player = "lead"
combat = true
ok, line = Share:Push()
check(not ok and #sent == before, "combat: nothing sent")
eq(line, "Roster not sent: not in combat or a boss fight.", "combat: the status line")
combat = false

-- Receiving: now the raider Rixxy, with layouts of their own; Solex is the leader
me = "Rixxy"
leaders.player = nil
CRT.db.groups = freshGroups()
local ownId = Groups:CreatePreset("My alts", { "Alt-Sargeras" })
Groups:SetActive(ownId)
local function deliver(list, from) for _, m in ipairs(list) do Share.Receive("CRTRoster1", m, from) end end
local function count() return #Groups:Presets() end

-- from someone who isn't the leader or an assistant: ignored
deliver(firstSent, "Solex-Sargeras")
eq(count(), 1, "non-lead: nothing stored")
eq(Groups:Active(), ownId, "non-lead: your active layout kept")
-- your own messages: ignored, even as the leader
leaders.Rixxy = "lead"
deliver(firstSent, "Rixxy-Sargeras")
eq(count(), 1, "own messages: ignored")
leaders.Rixxy = nil

-- from the leader: stored, tagged, active, one chat line
leaders.Solex = "lead"
local firedBefore, printedBefore = fired, #printed
deliver(firstSent, "Solex-Sargeras")
eq(count(), 2, "lead: stored as a layout")
local got
for _, p in ipairs(Groups:Presets()) do if p.from then got = p end end
check(got ~= nil, "lead: tagged from")
eq(got and got.from, "Solex-Sargeras", "lead: from is the sender's name-realm")
eq(got and got.name, "Main; Mythic (from Solex)", "lead: named from the sender")
same = got ~= nil
for i = 1, 40 do if not got or got.slots[i] ~= slots[i] then same = false end end
check(same, "lead: the 40 slots as sent")
eq(Groups:Active(), got and got.id, "lead: it is the active layout")
check(fired > firedBefore, "lead: Raid Groups and the Late Tracker told")
eq(#printed, printedBefore + 1, "lead: one chat line")
eq(printed[#printed], "Roster 'Main; Mythic' from Solex is now your active layout.", "lead: the chat line")
local own = Groups:Find(ownId)
check(own and own.name == "My alts" and own.slots[1] == "Alt-Sargeras" and own.from == nil, "lead: your own layout untouched")

-- the Late Tracker expects the received layout's people
check(CRT.Late:Start("button", 1790000000), "late: a night starts")
local expected = {}
for _, k in ipairs(slots) do if k ~= "" then expected[#expected + 1] = k end end
local players = CRT.Late:Current().players
eq(#players, #expected, "late: as many expected as the received layout has")
same = true
for i, p in ipairs(players) do if p.key ~= expected[i] then same = false end end
check(same, "late: the expected names are the received layout's")
CRT.Late:End("button", 1790000100)

-- a changed layout from the same sender replaces the copy, not a second one; an assistant counts
me = "Solex"
leaders.player = "lead"
local copy = {}
for i = 1, 40 do copy[i] = slots[i] end
copy[7] = "Newbie-Sargeras"
local changed = Share.Pack("Main; Mythic", copy)
me = "Rixxy"
leaders.player = nil
leaders.Solex = "assist"
local edited = got
edited.slots[1] = "Mine-Sargeras" -- the raider's own edit, theirs until the next one arrives
deliver(changed, "Solex-Sargeras")
eq(count(), 2, "replace: still one copy from that sender")
local again
for _, p in ipairs(Groups:Presets()) do if p.from then again = p end end
eq(again and again.slots[7], "Newbie-Sargeras", "replace: the new slots")
eq(again and again.slots[1], slots[1], "replace: the raider's edit replaced")
eq(again and again.id, got.id, "replace: the same layout")
eq(Groups:Active(), got.id, "replace: still active")
-- a layout passed on keeps one (from ...): the newest sender's
local relayed = Share.Pack("Main; Mythic (from Solex)", copy)
leaders["Kip-TwistingNether"] = "assist" -- the group names a player of another realm with it
deliver(relayed, "Kip-TwistingNether")
eq(count(), 3, "another sender: a copy of their own")
local kip
for _, p in ipairs(Groups:Presets()) do if p.from == "Kip-TwistingNether" then kip = p end end
eq(kip and kip.name, "Main; Mythic (from Kip-TwistingNether)", "another sender: named from them, one (from ...)")
eq(Groups:Active(), kip and kip.id, "another sender: theirs is active now")

-- malformed messages: dropped, never an error
local n0, p0 = count(), #printed
for _, m in ipairs({ "garbage", "", "zz|1|1|x", "abc|0|1|x", "abc|2|1|x", "abc|1|99|x", "abc|1|1|not a layout", "SECRET" }) do
  local okCall, err = pcall(Share.Receive, "CRTRoster1", m, "Solex-Sargeras")
  check(okCall, "malformed: no error for " .. m .. " " .. tostring(err))
end
check(pcall(Share.Receive, "CRTRoster1", nil, "Solex-Sargeras"), "malformed: no error for nil")
check(pcall(Share.Receive, "CRTRoster1", firstSent[1], nil), "malformed: no error for no sender")
check(pcall(Share.Receive, "CRTRoster1", firstSent[1], "SECRET"), "malformed: no error for a secret sender")
-- damaged: the parts don't add up to their hash
local damaged = {}
for i, m in ipairs(firstSent) do damaged[i] = m end
damaged[2] = damaged[2]:gsub("Player", "Plyaer", 1)
deliver(damaged, "Solex-Sargeras")
eq(count(), n0, "damaged: nothing stored")
eq(#printed, p0, "damaged: nothing said")
-- incomplete: one part missing, then the rest after the timeout
Share.Receive("CRTRoster1", changed[1], "Solex-Sargeras")
eq(count(), n0, "incomplete: nothing stored yet")
CLOCK = CLOCK + 120
for i = 2, #changed do Share.Receive("CRTRoster1", changed[i], "Solex-Sargeras") end
eq(Groups:Active(), kip.id, "timed out: the late parts make nothing")
-- another prefix: not ours
deliver(changed, "Solex-Sargeras")
eq(Groups:Active(), got.id, "complete again: taken")
Groups:SetActive(kip.id)
for _, m in ipairs(changed) do Share.Receive("CRTNote2", m, "Solex-Sargeras") end
eq(Groups:Active(), kip.id, "another prefix: ignored")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
print("ok roster share: sent with its prefix in parts, deduped, taken only from the leader or an assistant, made active")
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Comm.lua', 'CRT_Modules/Groups/Data.lua', 'CRT_Modules/Notes/Comm.lua', 'CRT_Modules/Groups/Share.lua', 'CRT_Modules/Late/Data.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
