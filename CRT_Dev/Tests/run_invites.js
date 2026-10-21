// CRT_Modules/Groups/Invite.lua (the shared invite helper) and Apply:MoveOne (the single-player move on join),
// on Data.lua and Apply.lua with a mock group: skips members, converts a party at 6, stops at 40, refuses in
// combat and when not lead or assist, the states, and the move (free spot, full group, combat, nobody else).
// usage: node run_invites.js <addon folder>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, applySrc, inviteSrc = ...
local fails, passed = 0, 0
local function check(ok, what) if ok then passed = passed + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- The mock group. raid = { { name, subgroup, combat }, ... }; mode is "solo", "party" or "raid".
local G = { mode = "raid", raid = {}, leader = true, assist = false, combat = false }
local frames = {}
function CreateFrame() local f = { events = {} } function f:RegisterEvent(e) self.events[e] = true end function f:SetScript(n, fn) self[n] = fn end frames[#frames + 1] = f return f end
local function fire(event, ...) for _, f in ipairs(frames) do if f.events[event] and f.OnEvent then f.OnEvent(f, event, ...) end end end
local timers = {}
C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
local function flush() for _ = 1, 10 do local t = timers timers = {} if #t == 0 then return end for _, fn in ipairs(t) do fn() end end end
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
SetRaidSubgroup = function(i, g) sets[#sets + 1] = { i, g, G.raid[i][1] } G.raid[i][2] = g end
SwapRaidSubgroup = function() swaps = swaps + 1 end
ERR_DECLINE_GROUP_S = "%s declines your group invitation."
ERR_BAD_PLAYER_NAME_S = "Cannot find player '%s'."
ERR_ALREADY_IN_GROUP_S = "%s is already in a group."
ERR_IGNORING_YOU_S = "%s is ignoring you."

local CRT = { db = { groups = { presets = {}, nextId = 1, working = {} }, classCache = {}, roleCache = {}, ui = {} }, UI = {} }
function CRT:Print(m) print("  [chat] " .. m) end
CRT_THEME(CRT, CRT.UI)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(applySrc, "Apply.lua"))("CowfeeRaidTools", CRT)
assert(load(inviteSrc, "Invite.lua"))("CowfeeRaidTools", CRT)
local Invite, Apply = CRT.Invite, CRT.Apply
check(Invite ~= nil and type(Invite.Send) == "function", "CRT.Invite:Send exists")
check(type(Apply.MoveOne) == "function", "CRT.Apply:MoveOne exists")

local function reset(mode, raid)
  G.mode, G.raid, G.leader, G.assist, G.combat = mode, raid, true, false, false
  invites, converts, sets, swaps, timers = {}, 0, {}, 0, {}
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
-- In combat when they join: left where they joined, and said so.
reset("raid", { { "Solex", 1 } })
Invite:Send({ "Late-Area52" }, slotsWith({ [21] = "Late-Area52" }), "Main Raid")
check(plain(Invite:Summary()) == "Invited Late. They move to group 5 when they join.", "one invite's status: " .. plain(Invite:Summary()))
G.raid[2] = { "Late", 1 }
G.combat = true
fire("GROUP_ROSTER_UPDATE") flush()
G.combat = false
check(#sets == 0 and state("Late-Area52") == "joined", "joined in combat: not moved")
s = plain(Invite:Summary())
check(s:find("Left where they joined: Late (you were in combat).", 1, true) ~= nil, "status says combat: " .. s)
fire("GROUP_ROSTER_UPDATE") flush()
check(#sets == 0, "and not moved later either")

-- 8. Apply:MoveOne on its own.
reset("raid", { { "Solex", 1 }, { "Abu-KelThuzad", 2 }, { "New", 1 } })
check(Apply:MoveOne("New-Area52", 4) == "moved" and #sets == 1 and sets[1][1] == 3, "MoveOne moves the one player into a free group")
check(Apply:MoveOne("New-Area52", 4) == "moved" and #sets == 1, "already there: no second move")
check(Apply:MoveOne("Nobody-Area52", 4) == "absent", "someone not in the raid: absent")
G.combat = true
check(Apply:MoveOne("Abu-KelThuzad", 4) == "combat" and #sets == 1, "in combat: no move")
G.combat = false
G.raid[2][3] = true
check(Apply:MoveOne("Abu-KelThuzad", 4) == "combat", "the player in combat: no move")
G.leader = false
check(Apply:MoveOne("Solex-Area52", 4) == "denied", "not lead or assist: denied")

print(passed .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " invite checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
const read = (f) => fs.existsSync(d + '/' + f) ? fs.readFileSync(d + '/' + f, 'utf8') : 'error("missing ' + f + '")';
for (const f of ['CRT_Modules/Groups/Data.lua', 'CRT_Modules/Groups/Apply.lua', 'CRT_Modules/Groups/Invite.lua']) lua.lua_pushstring(L, to_luastring(read(f)));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
