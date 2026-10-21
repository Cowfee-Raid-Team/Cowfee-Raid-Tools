// CRT_Modules/Groups/Invite.lua (the shared invite helper) and Apply:MoveOne (the single-player move on join),
// on Data.lua and Apply.lua with a mock group: skips members, converts a party at 6, stops at 40, refuses in
// combat and when not lead or assist, the states, and the move (free spot, full group, combat, nobody else).
// usage: node run_invites.js <addon folder>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, applySrc, inviteSrc, lateSrc = ...
local fails, passed = 0, 0
local function check(ok, what) if ok then passed = passed + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- The mock group. raid = { { name, subgroup, combat }, ... }; mode is "solo", "party" or "raid".
local G = { mode = "raid", raid = {}, leader = true, assist = false, combat = false }
local frames = {}
function CreateFrame() local f = { events = {} } function f:RegisterEvent(e) self.events[e] = true end function f:SetScript(n, fn) self[n] = fn end frames[#frames + 1] = f return f end
local function fire(event, ...) for _, f in ipairs(frames) do if f.events[event] and f.OnEvent then f.OnEvent(f, event, ...) end end end
-- Timers keep their delay: flush() runs the short ones (a roster read, a move's roster update) until none
-- are left, and runLong() runs the long ones once (a move's check, an invite's timeout).
local timers = {}
C_Timer = { After = function(d, fn) timers[#timers + 1] = { d = d, fn = fn } end }
local function flush()
  for _ = 1, 20 do
    local run, keep = {}, {}
    for _, t in ipairs(timers) do if t.d <= 1 then run[#run + 1] = t else keep[#keep + 1] = t end end
    timers = keep
    if #run == 0 then return end
    for _, t in ipairs(run) do t.fn() end
  end
end
local function runLong() local t = timers timers = {} for _, x in ipairs(t) do x.fn() end flush() end
format = string.format
tinsert = table.insert
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
GetNormalizedRealmName = function() return "Area52" end
Ambiguate = function(k) return (k:gsub("%-Area52$", "")) end
RAID_CLASS_COLORS = {}
local now = 1000
time = function() return now end
IsInRaid = function() return G.mode == "raid" end
IsInGroup = function() return G.mode ~= "solo" end
GetNumGroupMembers = function() if G.mode == "solo" then return 0 end return #G.raid end
GetNumSubgroupMembers = function() return G.mode == "party" and #G.raid - 1 or 0 end
GetRaidRosterInfo = function(i) local r = G.raid[i] if r then return r[1], 0, r[2], 80, "Mage", "MAGE" end end
UnitFullName = function(unit) local i = unit == "player" and 1 or tonumber(unit:match("%d+")) + 1 local r = G.raid[i] if not r then return nil end local n, realm = r[1]:match("^([^-]+)-?(.*)$") return n, realm end
UnitClass = function() return "Mage", "MAGE" end
UnitGroupRolesAssigned = function() return "DAMAGER" end
UnitIsUnit = function(a, b) return a == b end
UnitIsGroupLeader = function() return G.leader end
UnitIsGroupAssistant = function() return G.assist end
InCombatLockdown = function() return G.combat end
UnitAffectingCombat = function(unit) local r = G.raid[tonumber(unit:match("%d+"))] return r and r[3] or false end
local invites, converts, sets, swaps = {}, 0, {}, 0
C_PartyInfo = {
  InviteUnit = function(name) invites[#invites + 1] = name end,
  ConvertToRaid = function() converts = converts + 1 end,
}
-- A move lands with a roster update a moment later, unless G.refuse (the server drops it) or G.late (the
-- harness applies it by hand with land()).
local held = {}
SetRaidSubgroup = function(i, g)
  sets[#sets + 1] = { i, g, G.raid[i][1] }
  if G.refuse then return end
  if G.late then held[#held + 1] = { i, g } return end
  C_Timer.After(0.2, function() G.raid[i][2] = g fire("GROUP_ROSTER_UPDATE") end)
end
local function land() for _, h in ipairs(held) do G.raid[h[1]][2] = h[2] end held = {} fire("GROUP_ROSTER_UPDATE") flush() end
SwapRaidSubgroup = function() swaps = swaps + 1 end
ERR_DECLINE_GROUP_S = "%s declines your group invitation."
ERR_BAD_PLAYER_NAME_S = "Cannot find player '%s'."
ERR_ALREADY_IN_GROUP_S = "%s is already in a group."
ERR_IGNORING_YOU_S = "%s is ignoring you."

date = os.date
local CRT = { db = { groups = { presets = {}, nextId = 1, working = {} }, classCache = {}, roleCache = {}, ui = {},
  late = { days = {}, hour = 20, minute = 0, grace = 0, history = {}, nextId = 1, lastAuto = "" } }, UI = {} }
function CRT:Print(m) print("  [chat] " .. m) end
CRT_THEME(CRT, CRT.UI)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(applySrc, "Apply.lua"))("CowfeeRaidTools", CRT)
assert(load(inviteSrc, "Invite.lua"))("CowfeeRaidTools", CRT)
assert(load(lateSrc, "Late/Data.lua"))("CowfeeRaidTools", CRT)
local Invite, Apply = CRT.Invite, CRT.Apply
check(Invite ~= nil and type(Invite.Send) == "function", "CRT.Invite:Send exists")
check(type(Apply.MoveOne) == "function", "CRT.Apply:MoveOne exists")

local function reset(mode, raid)
  G.mode, G.raid, G.leader, G.assist, G.combat, G.refuse, G.late = mode, raid, true, false, false, false, false
  invites, converts, sets, swaps, timers, held = {}, 0, {}, 0, {}, {}
  Invite:Reset()
end
local function has(list, x) for _, v in ipairs(list) do if v == x then return true end end return false end
local function slotsWith(t) local s = {} for i = 1, 40 do s[i] = "" end for k, v in pairs(t) do s[k] = v end return s end
local function state(key) local e = Invite:Entry(key) return e and e.state end
local function plain(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end

-- 1. Skips members, invites by full Name-Realm.
reset("raid", { { "Solex", 1 }, { "Abu-KelThuzad", 1 } })
local layout = slotsWith({ [1] = "Solex-Area52", [2] = "Abu-KelThuzad", [11] = "Mesmertism-Stormrage", [16] = "Gadios-Area52" })
local n = Invite:Send({ "Solex-Area52", "Abu-KelThuzad", "Mesmertism-Stormrage", "Gadios-Area52" }, layout, "Main Raid")
check(n == 2 and #invites == 2, "skips the two already in the raid: " .. tostring(n) .. " sent, invites " .. table.concat(invites, ","))
check(has(invites, "Mesmertism-Stormrage") and has(invites, "Gadios-Area52"), "invites by full Name-Realm")
check(state("Mesmertism-Stormrage") == "invited" and Invite:Entry("Mesmertism-Stormrage").group == 3, "Mesmertism is invited, bound for group 3")
check(state("Solex-Area52") == nil, "a member gets no invite state")
check(plain(Invite:Summary()):find('Invited 2 from "Main Raid". Each one moves to their group when they join.', 1, true) ~= nil, "status: " .. plain(Invite:Summary()))

-- 2. A party converts to a raid when a sixth person is needed; the rest go out once it is a raid.
reset("party", { { "Solex", 1 }, { "Abu-KelThuzad", 1 }, { "Bale", 1 } })
Invite:Send({ "One-Area52", "Two-Area52" }, nil)
check(converts == 0 and #invites == 2, "party of 3 plus 2: no conversion, both invited")
reset("party", { { "Solex", 1 }, { "Abu-KelThuzad", 1 }, { "Bale", 1 } })
Invite:Send({ "One-Area52", "Two-Area52", "Three-Area52" }, nil)
check(converts == 1 and #invites == 0, "party of 3 plus 3: converts to a raid first (" .. converts .. " conversions, " .. #invites .. " invites)")
check(state("Three-Area52") == "waiting", "the names wait for the raid")
G.mode = "raid" fire("GROUP_ROSTER_UPDATE") flush()
check(#invites == 3, "once it is a raid all three go out: " .. #invites)
-- Solo: four go out, the group becomes a raid when one joins, then the rest.
reset("solo", { { "Solex", 1 } })
Invite:Send({ "A-Area52", "B-Area52", "C-Area52", "D-Area52", "E-Area52", "F-Area52" }, nil)
check(#invites == 4 and converts == 0 and state("E-Area52") == "waiting", "solo: four invited, two waiting (" .. #invites .. ")")
check(plain(Invite:Summary()):find("2 more go out once the group is a raid.", 1, true) ~= nil, "status says two wait: " .. plain(Invite:Summary()))
G.mode = "party" G.raid[2] = { "A", 1 } fire("GROUP_ROSTER_UPDATE") flush()
check(converts == 1 and state("A-Area52") == "joined", "the first to join makes a party, which converts")
G.mode = "raid" fire("GROUP_ROSTER_UPDATE") flush()
check(#invites == 6, "then the last two go out: " .. #invites)

-- 3. Stops at 40.
local big = {} for i = 1, 38 do big[i] = { "P" .. i, math.ceil(i / 5) } end
reset("raid", big)
n = Invite:Send({ "X1-Area52", "X2-Area52", "X3-Area52", "X4-Area52", "X5-Area52" }, nil)
check(n == 2 and #invites == 2, "38 in the raid: only 2 invited (" .. tostring(n) .. ")")
check(state("X3-Area52") == "failed" and Invite:Entry("X3-Area52").reason == "the raid is full", "the rest fail: the raid is full")

-- 4. Refuses in combat, nothing queued.
reset("raid", { { "Solex", 1 } })
G.combat = true
local r, why = Invite:Send({ "A-Area52" }, nil)
check(r == nil and why == "Invites wait until combat ends." and #invites == 0 and state("A-Area52") == nil, "in combat: refused, nothing queued (" .. tostring(why) .. ")")
check(plain(Invite:Summary()) == "Invites wait until combat ends.", "status in combat: " .. plain(Invite:Summary()))
local ok, reason = Invite.CanInvite()
check(not ok and reason == "Invites wait until combat ends.", "CanInvite says combat")
G.combat = false

-- 5. Only the leader or an assist; anyone not in a group.
reset("raid", { { "Solex", 1 }, { "Abu-KelThuzad", 1 } })
G.leader = false
r, why = Invite:Send({ "A-Area52" }, nil)
check(r == nil and why == "Only the raid leader or an assist can invite." and #invites == 0, "not lead or assist: refused (" .. tostring(why) .. ")")
G.assist = true
check(Invite.CanInvite() == true, "an assist can invite")
G.mode, G.assist = "party", false
check(Invite.CanInvite() == false, "a party member who isn't the leader can't")
G.mode = "solo"
check(Invite.CanInvite() == true, "not in a group: can invite (you become the leader)")

-- 6. States from the system messages; secret text is ignored.
reset("raid", { { "Solex", 1 } })
Invite:Send({ "Decliner-Stormrage", "Typo-Area52", "Busy-Area52", "Waits-Area52" }, nil, "Main Raid")
fire("CHAT_MSG_SYSTEM", "Decliner-Stormrage declines your group invitation.")
fire("CHAT_MSG_SYSTEM", "Cannot find player 'Typo-Area52'.")
fire("CHAT_MSG_SYSTEM", "Busy is already in a group.")
check(state("Decliner-Stormrage") == "declined", "declined from ERR_DECLINE_GROUP_S")
check(state("Typo-Area52") == "failed" and Invite:Entry("Typo-Area52").reason == "not found", "not found from ERR_BAD_PLAYER_NAME_S")
check(state("Busy-Area52") == "failed" and Invite:Entry("Busy-Area52").reason == "already in a group", "a same-realm name without its realm matches")
local s = plain(Invite:Summary())
check(s:find("Not coming: Decliner-Stormrage (declined), Typo (not found), Busy (already in a group).", 1, true) ~= nil, "status lists who isn't coming: " .. s)
issecretvalue = function() return true end
local okSecret = pcall(fire, "CHAT_MSG_SYSTEM", "Waits declines your group invitation.")
issecretvalue = nil
check(okSecret and state("Waits-Area52") == "invited", "a secret system message is ignored")
now = now + 75
check(plain(Invite:StateText("Waits-Area52", now)) == "invited 1:15", "row text: " .. plain(Invite:StateText("Waits-Area52", now)))
check(plain(Invite:StateText("Decliner-Stormrage", now)) == "declined", "row text declined")
check(Invite:StateText("Nobody-Area52", now) == nil, "no row text for someone not invited")
check(Invite:StateText("Waits-Area52", now):find("|cff" .. CRT.UI.Hex("accent"), 1, true) == 1, "invited is the theme's accent")
check(Invite:StateText("Decliner-Stormrage", now):find("|cff" .. CRT.UI.Hex("bad"), 1, true) == 1, "declined is the theme's bad colour")

-- 7. The move on join: only that player, only into a free spot.
reset("raid", { { "Solex", 1 }, { "Abu-KelThuzad", 2 }, { "B2", 2 }, { "C2", 2 }, { "D2", 2 }, { "E2", 2 } })
layout = slotsWith({ [11] = "Mesmertism-Stormrage", [6] = "Gadios-Area52", [1] = "Solex-Area52" })
Invite:Send({ "Mesmertism-Stormrage", "Gadios-Area52" }, layout, "Main Raid")
G.raid[7] = { "Mesmertism-Stormrage", 1 }
fire("GROUP_ROSTER_UPDATE") flush()
check(#sets == 1 and sets[1][1] == 7 and sets[1][2] == 3, "Mesmertism moves from group 1 to their group 3 (" .. #sets .. " moves)")
check(state("Mesmertism-Stormrage") == "moved" and plain(Invite:StateText("Mesmertism-Stormrage", now)) == "moved to 3", "state moved, row 'moved to 3'")
check(Invite:StateText("Mesmertism-Stormrage", now):find("|cff" .. CRT.UI.Hex("good"), 1, true) == 1, "moved is the theme's good colour")
G.raid[8] = { "Gadios", 1 }
fire("GROUP_ROSTER_UPDATE") flush()
check(#sets == 1, "Gadios's group 2 is full: nobody moved")
check(state("Gadios-Area52") == "joined" and plain(Invite:StateText("Gadios-Area52", now)) == "stayed in 1", "Gadios stays where he joined: " .. plain(Invite:StateText("Gadios-Area52", now)))
s = plain(Invite:Summary())
check(s:find("Left where they joined: Gadios (group 2 is full).", 1, true) ~= nil, "status says the group was full: " .. s)
check(swaps == 0, "nobody is ever swapped")
for i = 1, 6 do check(G.raid[i][2] == (i == 1 and 1 or 2), "member " .. G.raid[i][1] .. " untouched") end
-- In combat when they join: they wait, and move once combat ends.
reset("raid", { { "Solex", 1 }, { "Other", 2 } })
Invite:Send({ "Late-Area52" }, slotsWith({ [21] = "Late-Area52" }), "Main Raid")
check(plain(Invite:Summary()) == "Invited Late. They move to group 5 when they join.", "one invite's status: " .. plain(Invite:Summary()))
G.raid[3] = { "Late", 1 }
G.combat = true
fire("PLAYER_REGEN_DISABLED")
fire("GROUP_ROSTER_UPDATE") flush()
check(#sets == 0 and state("Late-Area52") == "joined" and not Invite:Entry("Late-Area52").stayed, "joined in combat: not moved yet, and not left for good")
check(plain(Invite:StateText("Late-Area52", now)) == "moves after combat", "row: " .. plain(Invite:StateText("Late-Area52", now)))
now = now + 60 -- a long fight: the retry window starts when combat ends, not at the join
G.combat = false
s = plain(Invite:Summary())
check(s:find("Moving when combat ends: Late.", 1, true) ~= nil, "status says they move after combat: " .. s)
fire("PLAYER_REGEN_ENABLED") flush()
check(#sets == 1 and sets[1][3] == "Late" and sets[1][2] == 5 and state("Late-Area52") == "moved", "combat ends: Late moves to group 5 (" .. #sets .. " moves)")
check(G.raid[1][2] == 1 and G.raid[2][2] == 2, "nobody else moved")
-- They are in combat themselves: tried again on the next roster read after their combat clears.
reset("raid", { { "Solex", 1 } })
Invite:Send({ "Fighter-Area52" }, slotsWith({ [21] = "Fighter-Area52" }), "Main Raid")
G.raid[2] = { "Fighter", 1, true }
fire("GROUP_ROSTER_UPDATE") flush()
check(#sets == 0 and not Invite:Entry("Fighter-Area52").stayed, "they joined in combat: waiting")
G.raid[2][3] = false
fire("GROUP_ROSTER_UPDATE") flush()
check(#sets == 1 and state("Fighter-Area52") == "moved", "their combat cleared: moved on the next roster read")
-- A full group by the time combat ends: they stay, with the usual reason.
reset("raid", { { "Solex", 1 }, { "F1", 5 }, { "F2", 5 }, { "F3", 5 }, { "F4", 5 } })
Invite:Send({ "Slow-Area52" }, slotsWith({ [21] = "Slow-Area52" }), "Main Raid")
G.raid[6] = { "Slow", 1 }
G.combat = true
fire("GROUP_ROSTER_UPDATE") flush()
G.raid[7] = { "Walkin", 5 }
G.combat = false
fire("PLAYER_REGEN_ENABLED") flush()
check(#sets == 0 and Invite:Entry("Slow-Area52").stayed == "group 5 is full", "group 5 filled up during combat: Slow stays (" .. tostring(Invite:Entry("Slow-Area52").stayed) .. ")")
for i = 1, 7 do check(G.raid[i][2] == ({ 1, 5, 5, 5, 5, 1, 5 })[i], "member " .. G.raid[i][1] .. " untouched") end

-- A night's start drops only finished invites: open ones keep going and still move (Late/Data.lua).
reset("raid", { { "Solex", 1 } })
CRT.db.late = { days = {}, hour = 20, minute = 0, grace = 0, history = {}, nextId = 1, lastAuto = "" }
date = os.date
CRT.Groups:SetActive(CRT.Groups:CreatePreset("Main", slotsWith({ [1] = "Solex-Area52", [16] = "Open-Area52", [17] = "Nope-Area52" })))
Invite:Send({ "Open-Area52", "Nope-Area52" }, CRT.Groups:Find(CRT.Groups:Active()).slots, "Main")
fire("CHAT_MSG_SYSTEM", "Nope declines your group invitation.")
CRT.Late:Start("button", now)
check(Invite:Entry("Nope-Area52") == nil, "the start drops the finished (declined) invite")
check(state("Open-Area52") == "invited", "and keeps the open one")
G.raid[2] = { "Open", 1 }
fire("GROUP_ROSTER_UPDATE") flush()
check(state("Open-Area52") == "moved" and sets[1] and sets[1][2] == 4, "who joins after the start still moves to their group")
CRT.Late:End("button", now)
check(Invite:Entry("Open-Area52") == nil, "the night's end forgets every invite")

-- 8. Apply:MoveOne on its own.
reset("raid", { { "Solex", 1 }, { "Abu-KelThuzad", 2 }, { "New", 1 } })
check(Apply:MoveOne("New-Area52", 4) == "sent" and #sets == 1 and sets[1][1] == 3, "MoveOne asks to move the one player into a free group")
flush()
check(Apply:MoveOne("New-Area52", 4) == "moved" and #sets == 1, "already there: no second move")
check(Apply:MoveOne("Nobody-Area52", 4) == "absent", "someone not in the raid: absent")
check(Apply:MoveOne("New-Stormrage", 4) == "absent", "matches the exact Name-Realm only, never a same-named player")
check(Apply:MoveOne("Solex-Area52", 2, { [2] = 4 }) == "full" and #sets == 1, "moves already on their way count: 1 in group 2 plus 4 moving is full")
G.combat = true
check(Apply:MoveOne("Abu-KelThuzad", 4) == "combat" and #sets == 1, "in combat: no move")
G.combat = false
G.raid[2][3] = true
check(Apply:MoveOne("Abu-KelThuzad", 4) == "combat", "the player in combat: no move")
G.leader = false
check(Apply:MoveOne("Solex-Area52", 4) == "denied", "not lead or assist: denied")

-- 9. Moves are async: two joiners for one free spot, a move that lands late, a move the server drops.
reset("raid", { { "Solex", 1 }, { "G3a", 3 }, { "G3b", 3 }, { "G3c", 3 }, { "G3d", 3 } })
layout = slotsWith({ [11] = "Ann-Area52", [12] = "Bob-Area52" })
Invite:Send({ "Ann-Area52", "Bob-Area52" }, layout, "Main Raid")
G.late = true
G.raid[6] = { "Ann", 1 } G.raid[7] = { "Bob", 1 }
fire("GROUP_ROSTER_UPDATE") flush()
check(#sets == 1 and sets[1][3] == "Ann", "two join for group 3's last spot: only one move is asked for (" .. #sets .. ")")
check(state("Ann-Area52") == "moving" and plain(Invite:StateText("Ann-Area52", now)) == "moving to 3", "Ann is moving, not yet moved: " .. plain(Invite:StateText("Ann-Area52", now)))
check(Invite:Entry("Bob-Area52").stayed == "group 3 is full", "Bob stays: the moving Ann takes the spot")
land()
check(state("Ann-Area52") == "moved" and plain(Invite:StateText("Ann-Area52", now)) == "moved to 3", "the roster shows Ann in group 3: moved")
reset("raid", { { "Solex", 1 } })
Invite:Send({ "Cat-Area52" }, slotsWith({ [16] = "Cat-Area52" }), "Main Raid")
G.refuse = true
G.raid[2] = { "Cat", 1 }
fire("GROUP_ROSTER_UPDATE") flush()
check(state("Cat-Area52") == "moving", "a move the server drops: still moving at first")
runLong()
check(state("Cat-Area52") == "joined" and Invite:Entry("Cat-Area52").stayed == "the move didn't go through", "then stays, saying the move didn't go through")
check(plain(Invite:StateText("Cat-Area52", now)) == "stayed in 1", "row: stayed in 1")
G.raid[2][2] = 4
fire("GROUP_ROSTER_UPDATE") flush()
check(state("Cat-Area52") == "moved" and not Invite:Entry("Cat-Area52").stayed, "the move lands after the check after all: moved")

-- 10. Unanswered invites time out: no answer, the room comes back, and a solo queue doesn't stall.
reset("raid", { { "Solex", 1 } })
Invite:Send({ "Quiet-Area52" }, nil)
now = now + 121
runLong()
check(state("Quiet-Area52") == "failed" and Invite:Entry("Quiet-Area52").reason == "no answer", "no answer after the timeout")
check(plain(Invite:StateText("Quiet-Area52", now)) == "no answer", "row: no answer")
reset("solo", { { "Solex", 1 } })
Invite:Send({ "A-Area52", "B-Area52", "C-Area52", "D-Area52", "E-Area52", "F-Area52" }, nil)
check(#invites == 4, "solo: four go out")
now = now + 121
runLong()
check(state("A-Area52") == "failed" and #invites == 6 and state("F-Area52") == "invited", "after the four time out, the two waiting go out (" .. #invites .. ")")

-- 11. Joiners match by exact Name-Realm; a move that can't be made yet is retried only for a short while.
reset("raid", { { "Solex", 1 } })
Invite:Send({ "Busy-Stormrage" }, slotsWith({ [6] = "Busy-Stormrage" }), "Main Raid")
G.raid[2] = { "Busy", 1 }
fire("GROUP_ROSTER_UPDATE") flush()
check(state("Busy-Stormrage") == "invited" and #sets == 0, "a same-named player from another realm isn't taken for the invited one")
reset("raid", { { "Solex", 1 } })
Invite:Send({ "Dan-Area52" }, slotsWith({ [6] = "Dan-Area52" }), "Main Raid")
G.leader = false
G.raid[2] = { "Dan", 1 }
fire("GROUP_ROSTER_UPDATE") flush()
check(state("Dan-Area52") == "joined" and not Invite:Entry("Dan-Area52").stayed, "can't move yet (not lead): tried again on the next roster change")
now = now + 31
fire("GROUP_ROSTER_UPDATE") flush()
check(Invite:Entry("Dan-Area52").stayed == "the move didn't go through", "past the retry window: stays, and is no longer tried")
G.leader = true
fire("GROUP_ROSTER_UPDATE") flush()
check(#sets == 0, "not moved later")

-- 12. pump checks it may still invite; %1$s placeholders match too.
reset("solo", { { "Solex", 1 } })
Invite:Send({ "A-Area52", "B-Area52", "C-Area52", "D-Area52", "E-Area52" }, nil)
G.mode, G.leader = "raid", false
G.raid[2] = { "A", 1 }
fire("GROUP_ROSTER_UPDATE") flush()
check(#invites == 4 and state("E-Area52") == "waiting", "no longer lead or assist: the waiting invite isn't sent")
now = now + 31
runLong()
check(state("E-Area52") == "failed" and Invite:Entry("E-Area52").reason == "Only the raid leader or an assist can invite.", "and after the retry window it fails with why, instead of waiting forever")
reset("raid", { { "Solex", 1 } })
Invite:Send({ "Eve-Area52" }, nil)
local oldDecline = ERR_DECLINE_GROUP_S
ERR_DECLINE_GROUP_S = "%1$s declines your group invitation."
fire("CHAT_MSG_SYSTEM", "Eve declines your group invitation.")
ERR_DECLINE_GROUP_S = oldDecline
check(state("Eve-Area52") == "declined", "a %1$s placeholder matches")

print(passed .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " invite checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
const read = (f) => fs.existsSync(d + '/' + f) ? fs.readFileSync(d + '/' + f, 'utf8') : 'error("missing ' + f + '")';
for (const f of ['CRT_Modules/Groups/Data.lua', 'CRT_Modules/Groups/Apply.lua', 'CRT_Modules/Groups/Invite.lua', 'CRT_Modules/Late/Data.lua']) lua.lua_pushstring(L, to_luastring(read(f)));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
