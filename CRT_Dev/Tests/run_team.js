// The team raid check (CRT_Core/Team.lua): several CRTs in one raid, each its own copy of the file, every hello
// handed to every other one. The hello's encode and decode, the batching and the window (a burst of joiners gets one
// answer, never one per joiner, and the answers stop), no hello in combat, a finder group, a party, solo or during
// the game's lockdown (tried again until it lifts), the set following the roster (leaving, going offline, a reload),
// the threshold maths with offline members and players without CRT, OnChange, the snapshot at a pull's start, the
// realm folded in names, secret senders, the saved default, the share and the .toc.
// Usage: node run_team.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local teamSrc, coreSrc, profilesSrc, tocSrc, slashSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
issecretvalue = function(v) return v == "SECRET" end
LE_PARTY_CATEGORY_HOME, LE_PARTY_CATEGORY_INSTANCE = 1, 2
Enum = { SendAddonMessageResult = { Success = 0, AddonMessageThrottle = 3, ChannelThrottle = 8, AddOnMessageLockdown = 11 } }
local CLOCK = 1000
GetTime = function() return CLOCK end
time = function() return 1790000000 + CLOCK end

-- the clients: each its own CRT and frames; ME is the one acting now
local ME
local clients, order = {}, {}
-- the raid: { name, realm, online, crt (has a client) }; party = a party, not a raid
local raid = {}
local shape = "raid" -- "raid", "party", "solo", "finder"
local function inGroup(name) for _, m in ipairs(raid) do if m.name == name then return m end end end
UnitName = function(u) if u == "player" then return ME end end
GetNormalizedRealmName = function() return clients[ME] and clients[ME].realm or "Sargeras" end
IsInRaid = function() return inGroup(ME) ~= nil and (shape == "raid" or shape == "finder") end
IsInGroup = function(cat)
  if not inGroup(ME) or shape == "solo" then return false end
  if cat == LE_PARTY_CATEGORY_INSTANCE then return shape == "finder" end
  return true
end
local secretRow = false
GetRaidRosterInfo = function(i)
  if not IsInRaid() then return nil end
  local m = raid[i]
  if not m then return nil end
  if secretRow then return "SECRET" end
  -- your own realm is left off; another realm is written the game's way, with its space
  local name = m.realm == GetNormalizedRealmName() and m.name or (m.name .. "-" .. (m.realm == "AeriePeak" and "Aerie Peak" or m.realm))
  return name, 0, 1, 90, "Paladin", "PALADIN", "Zone", m.online and 1 or nil
end
local instanceKind = "raid"
GetInstanceInfo = function() return "Raid One", instanceKind, 16 end
InCombatLockdown = function() return clients[ME].combat == true end

-- timers run as the client that set them
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = CLOCK + s, fn = fn, who = ME } end }
local function advance(s)
  local target = CLOCK + s
  while true do
    table.sort(timers, function(a, b) return a.at < b.at end)
    local t = timers[1]
    if not t or t.at > target then break end
    table.remove(timers, 1)
    CLOCK = t.at
    local was = ME ME = t.who t.fn() ME = was
  end
  CLOCK = target
end

-- messages: every send is handed to every other client in the group
local sent = {} -- { from, prefix, text, channel }
local sendResult = 0
local locked = false
local prefixes = {}
C_ChatInfo = {
  RegisterAddonMessagePrefix = function(p) prefixes[#prefixes + 1] = p return true end,
  InChatMessagingLockdown = function() return locked end,
  SendAddonMessage = function(prefix, text, channel)
    if sendResult ~= 0 then return sendResult end
    sent[#sent + 1] = { from = ME, prefix = prefix, text = text, channel = channel, at = CLOCK }
    local from = ME
    local m = inGroup(from)
    for _, name in ipairs(order) do
      local c = clients[name]
      if name ~= from and inGroup(name) and c.loaded then
        local was = ME ME = name
        c.Team.HandleEvent("CHAT_MSG_ADDON", prefix, text, channel, from .. "-" .. m.realm)
        ME = was
      end
    end
    return 0
  end,
}
local function mock()
  local o = { events = {}, scripts = {} }
  o.RegisterEvent = function(self, e) self.events[e] = true end
  o.UnregisterEvent = function(self, e) self.events[e] = nil end
  o.SetScript = function(self, n, fn) self.scripts[n] = fn end
  return o
end
CreateFrame = function() local f = mock() clients[ME].frames[#clients[ME].frames + 1] = f return f end

local function newClient(name, realm, version)
  local c = { name = name, realm = realm or "Sargeras", frames = {}, CRT = { db = { team = { threshold = 0.75 } }, version = version or "1.2.0" } }
  function c.CRT:Print() end
  clients[name] = c
  order[#order + 1] = name
  local was = ME ME = name
  assert(load(teamSrc, "Team.lua"))("CowfeeRaidTools", c.CRT)
  ME = was
  c.Team = c.CRT.Team
  c.loaded = true
  return c
end
-- an event on one client
local function on(name, event, ...) local was = ME ME = name clients[name].Team.HandleEvent(event, ...) ME = was end
local function rosterAll() for _, name in ipairs(order) do if inGroup(name) then on(name, "GROUP_ROSTER_UPDATE") end end end
local function join(name, realm, crt)
  raid[#raid + 1] = { name = name, realm = realm or "Sargeras", online = true }
  if crt and not clients[name] then newClient(name, realm) end
  rosterAll()
end
local function leave(name)
  for i, m in ipairs(raid) do if m.name == name then table.remove(raid, i) break end end
  rosterAll()
  if clients[name] then on(name, "GROUP_ROSTER_UPDATE") end
end
local function snap(name) return clients[name].Team:Snapshot() end
local function sentBy(name, from) local n = 0 for i = from or 1, #sent do if sent[i].from == name then n = n + 1 end end return n end

-- 1. The message ---------------------------------------------------------------------------------------------------
local A = newClient("Solex")
local T = A.Team
check(T ~= nil, "CRT.Team exists")
eq(T.PREFIX, "CRTHello", "the prefix")
check(#T.PREFIX <= 16, "the prefix fits the game's 16 characters")
eq(#prefixes, 1, "registered once, as the file loads")
eq(T.Encode(), "H|1|1.2.0", "the hello: kind, version, addon version")
local v, addon = T.Decode("H|1|1.2.0")
eq(tostring(v) .. " " .. tostring(addon), "1 1.2.0", "decoded")
eq(T.Decode("H|1.3|1.4.0|more|fields"), 1.3, "a later minor version with more fields is read")
eq(T.Decode("H|2|9.0.0"), nil, "a higher major version is left alone")
eq(T.Decode("Q|1|x"), nil, "another kind is left alone")
eq(T.Decode("H|0|1.0"), nil, "version 0 is no version")
eq(T.Decode("H|1"), nil, "a cut-off hello is dropped")
eq(T.Decode("H1|1.0"), nil, "junk is dropped")
eq(T.Decode("SECRET"), nil, "a secret text is never read")
eq(T.Decode(nil), nil, "nothing is dropped")
A.CRT.version = "1|2" eq(T.Encode(), "H|1|12", "a | in the version is left out") A.CRT.version = "1.2.0"
check(#T.Encode() < 40, "a small message")

-- 2. Names --------------------------------------------------------------------------------------------------------
ME = "Solex"
eq(T.Key("Moo"), "moo-sargeras", "your realm added")
eq(T.Key("Bob-Aerie Peak"), "bob-aeriepeak", "a realm's spaces left out")
eq(T.Key("Bob-AeriePeak"), "bob-aeriepeak", "so the roster's and chat's names agree")
eq(T.Key("Zed-Azjol-Nerub"), "zed-azjolnerub", "and a realm's dash")
eq(T.Key("SECRET"), nil, "a secret name is never read")
eq(T.Key(""), nil, "an empty name")

-- 3. Solo, party, finder: nothing sent, never a team raid -----------------------------------------------------------
shape = "solo"
raid = { { name = "Solex", realm = "Sargeras", online = true } }
on("Solex", "PLAYER_ENTERING_WORLD", true, false)
advance(30)
eq(#sent, 0, "solo: nothing sent")
eq(T:IsTeam(), false, "solo: not a team raid")
eq(T.StatusText(), "Not in a raid group", "solo: the status")
check(not A.frames[1].events.CHAT_MSG_ADDON, "out of a raid group: addon messages not listened to")
shape = "party"
on("Solex", "GROUP_ROSTER_UPDATE")
advance(30)
eq(#sent, 0, "a party: nothing sent")
eq(T:IsTeam(), false, "a party: never a team raid")
shape = "finder"
on("Solex", "GROUP_ROSTER_UPDATE")
advance(30)
eq(#sent, 0, "a finder group: nothing sent")
eq(T:IsTeam(), false, "a finder group: never a team raid")
shape = "solo"
on("Solex", "GROUP_ROSTER_UPDATE")

-- 4. A raid forms: one hello each, the answers batched, and they stop ---------------------------------------------
shape = "raid"
raid = {}
join("Solex", "Sargeras", true)
check(A.frames[1].events.CHAT_MSG_ADDON, "in a raid group: addon messages listened to")
advance(1)
eq(#sent, 0, "a hello waits the debounce")
advance(5)
eq(sentBy("Solex"), 1, "joining a raid group: one hello")
eq(sent[1].channel, "RAID", "to the raid channel")
eq(sent[1].prefix, "CRTHello", "under CRTHello")
eq(snap("Solex").crt .. "/" .. snap("Solex").online, "1/1", "alone: 1 of 1")
eq(T:IsTeam(), true, "1 of 1 running CRT is a team raid")
-- five more CRTs join within a few seconds, two players without CRT
local start = #sent + 1
for i, name in ipairs({ "Moo", "Bell", "Hay", "Dot" }) do join(name, "Sargeras", true) advance(1) end
join("Bob", "AeriePeak", true)
join("Pug1", "Sargeras", false)
join("Pug2", "Sargeras", false)
advance(120)
local total = #sent - start + 1
for _, name in ipairs(order) do
  local s = snap(name)
  eq(s.crt .. "/" .. s.online, "6/8", name .. " knows every CRT: 6 of 8")
end
for _, name in ipairs(order) do
  check(sentBy(name, start) <= 3, name .. " sent few hellos for five joiners (" .. sentBy(name, start) .. ")")
end
check(total <= 18, "a raid of six CRTs forming sends a handful of hellos, not one per joiner each (" .. total .. ")")
local quiet = #sent
advance(300)
eq(#sent, quiet, "once everyone is known, the hellos stop")
-- the window: no client sent twice within 10 seconds
local last = {}
local tooSoon = 0
for _, m in ipairs(sent) do
  if last[m.from] and m.at - last[m.from] < T.WINDOW then tooSoon = tooSoon + 1 end
  last[m.from] = m.at
end
eq(tooSoon, 0, "no CRT sent two hellos within the window")
-- 6 of 8 is 75%: a team raid
eq(T:IsTeam(), true, "6 of 8 (75%) is a team raid")
eq(T.StatusText(), "Team raid, 6 of 8 running CRT (75%)", "the status")
eq(T.StatusLine(), "Now: Team raid, 6 of 8 running CRT (75%).", "the status line General Settings and /crt team show")

-- 5. The threshold, offline members, OnChange ---------------------------------------------------------------------
local flips = {}
T:OnChange(function(team, s) flips[#flips + 1] = tostring(team) .. ":" .. s.crt .. "/" .. s.online end)
local recounts = 0
T:OnRecount(function() recounts = recounts + 1 end)
join("Pug3", "Sargeras", false)
eq(T:IsTeam(), false, "6 of 9 (67%) is not a team raid")
eq(flips[#flips], "false:6/9", "OnChange fires when the answer flips")
check(recounts >= 1, "OnRecount on a new count")
eq(T.StatusText(), "Not a team raid, 6 of 9 running CRT (67%)", "the status says so")
-- a player without CRT going offline: online members only
raid[#raid].online = false
on("Solex", "UNIT_CONNECTION", "raid9", false)
eq(snap("Solex").crt .. "/" .. snap("Solex").online, "6/8", "an offline member is left out of the count")
eq(T:IsTeam(), true, "6 of 8 online: a team raid again")
eq(flips[#flips], "true:6/8", "and OnChange says so")
local nflips = #flips
on("Solex", "GROUP_ROSTER_UPDATE")
eq(#flips, nflips, "OnChange only on a flip")
-- the threshold is adjustable
T:SetPercent(80)
eq(A.CRT.db.team.threshold, 0.8, "the slider saves a fraction")
eq(T:IsTeam(), false, "at 80%, 6 of 8 isn't a team raid")
T:SetPercent(50)
eq(T:IsTeam(), true, "at 50% it is")
T:SetPercent(33) eq(T.Percent(), 50, "never under 50%")
T:SetPercent(120) eq(T.Percent(), 100, "never over 100%")
T:SetPercent(77) eq(T.Percent(), 75, "on the slider's steps")
A.CRT.db.team.threshold = nil eq(T.Percent(), 75, "no saved threshold: 75%")
A.CRT.db.team.threshold = 0.75
check(T.Rule(15, 20, 75) and not T.Rule(14, 20, 75) and T.Rule(3, 4, 75) and not T.Rule(0, 0, 75), "whole-number maths: 15 of 20 is 75%, 14 is not")
-- a CRT going offline is dropped, and counts again only after its hello
for _, m in ipairs(raid) do if m.name == "Dot" then m.online = false end end
on("Solex", "UNIT_CONNECTION", "raid5", false)
eq(snap("Solex").crt .. "/" .. snap("Solex").online, "5/7", "a CRT that went offline is out of both")
eq(T:Runs("dot-sargeras"), false, "and dropped from who runs CRT")
for _, m in ipairs(raid) do if m.name == "Dot" then m.online = true end end
on("Solex", "UNIT_CONNECTION", "raid5", true)
eq(snap("Solex").crt .. "/" .. snap("Solex").online, "5/8", "back online but not heard yet")
-- Dot logs back in: its CRT starts afresh and says hello; the others answer
local D = clients.Dot
local before = #sent
on("Dot", "PLAYER_ENTERING_WORLD", true, false)
advance(60)
eq(snap("Solex").crt, 6, "Dot's hello: counted again")
eq(snap("Dot").crt .. "/" .. snap("Dot").online, "6/8", "and Dot's CRT learns everyone from the answers")
check(#sent - before <= 8, "one round of answers (" .. (#sent - before) .. ")")
-- a reload: known to everyone, knowing nobody
before = #sent
local Hay = clients.Hay
-- Hay's addon reloads: a new copy of the file, its old set gone
Hay.frames = {}
local was = ME ME = "Hay"
assert(load(teamSrc, "Team.lua"))("CowfeeRaidTools", Hay.CRT)
ME = was
Hay.Team = Hay.CRT.Team
on("Hay", "PLAYER_ENTERING_WORLD", false, true)
eq(snap("Hay").crt, 1, "after a reload, Hay knows only itself")
advance(60)
eq(snap("Hay").crt .. "/" .. snap("Hay").online, "6/8", "the others answer a reloaded member's hello")
local afterReload = #sent
advance(300)
eq(#sent, afterReload, "and the answers stop")
check(afterReload - before <= 8, "a reload costs one round of answers (" .. (afterReload - before) .. ")")

-- 6. Leaving, and the set resetting ------------------------------------------------------------------------------
leave("Bell")
eq(T:Runs("bell-sargeras"), false, "a member who left is dropped")
eq(snap("Solex").crt .. "/" .. snap("Solex").online, "5/7", "and out of the count")
eq(snap("Bell").raid, false, "Bell, out of the group: not in a raid group")
eq(clients.Bell.Team:Runs("solex-sargeras"), false, "and Bell's set reset")
check(not clients.Bell.frames[1].events.CHAT_MSG_ADDON, "and Bell stops listening")
before = #sent
join("Bell", "Sargeras", true)
advance(60)
eq(snap("Bell").crt .. "/" .. snap("Bell").online, "6/8", "rejoining: Bell learns everyone again")
eq(snap("Solex").crt, 6, "and is counted again")

-- 7. Combat, the lockdown, the throttle ----------------------------------------------------------------------------
-- a new CRT joins while everyone is in combat: nothing is sent until it ends
newClient("Late1")
for _, name in ipairs(order) do clients[name].combat = true end
before = #sent
join("Late1", "Sargeras", true)
advance(60)
eq(#sent, before, "in combat: no hello")
for _, name in ipairs(order) do clients[name].combat = false on(name, "PLAYER_REGEN_ENABLED") end
advance(60)
check(#sent > before, "combat over: the hellos go")
eq(snap("Late1").crt, 7, "and the joiner learns everyone")
-- the lockdown: tried again until it lifts
locked = true
before = #sent
join("Late2", "Sargeras", true)
advance(30)
eq(#sent, before, "during the game's lockdown nothing is sent")
locked = false
advance(60)
check(#sent > before, "once it lifts, the hellos go")
eq(snap("Late2").crt, 8, "and the joiner learns everyone")
sendResult = 11
before = #sent
join("Late3", "Sargeras", true)
advance(30)
sendResult = 0
advance(60)
eq(snap("Late3").crt, 9, "a send the game held is tried again")
-- the throttle
sendResult = 3
leave("Late3") join("Late3", "Sargeras", true)
advance(1)
sendResult = 0
advance(60)
eq(snap("Late3").crt, 9, "a throttled send is tried again")

-- 8. Secret and stranger senders ---------------------------------------------------------------------------------
local now = snap("Solex").crt
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.0", "RAID", "SECRET")
eq(snap("Solex").crt, now, "a secret sender is never compared")
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.0", "RAID", "Stranger-Sargeras")
eq(snap("Solex").crt, now, "a sender not in the raid isn't counted")
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|2|1.0", "RAID", "Pug1-Sargeras")
eq(snap("Solex").crt, now, "a hello this CRT can't read isn't counted")
on("Solex", "CHAT_MSG_ADDON", "OtherPrefix", "H|1|1.0", "RAID", "Pug1-Sargeras")
eq(snap("Solex").crt, now, "another prefix is left alone")
on("Solex", "CHAT_MSG_ADDON", "SECRET", "H|1|1.0", "RAID", "Pug1-Sargeras")
eq(snap("Solex").crt, now, "a secret prefix is left alone")
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.0", "RAID", "Solex-Sargeras")
eq(snap("Solex").crt, now, "your own echo counts once")
-- a secret roster row keeps the last count
secretRow = true
on("Solex", "GROUP_ROSTER_UPDATE")
eq(snap("Solex").crt, now, "a secret roster row: the last count stands")
secretRow = false

-- 9. The snapshot at a pull --------------------------------------------------------------------------------------
check(A.frames[1].events.ENCOUNTER_START, "a pull's start is listened to in a raid group")
local pullAt = time()
on("Solex", "ENCOUNTER_START", 3129, "Boss", 16, 20)
local atPull = T:AtPull(3129, pullAt)
eq(atPull and atPull.team, true, "the pull's snapshot: a team raid")
for i = 1, 6 do join("PugX" .. i, "Sargeras", false) end
eq(T:IsTeam(), false, "pugs joined after the pull: not a team raid now")
eq(T:PullIsTeam(3129, pullAt), true, "but the pull keeps its answer from the start")
eq(T:AtPull(3129, pullAt + 600), nil, "a start far from any pull: none")
eq(T:AtPull(9999, pullAt), nil, "another boss: none")
eq(T:PullIsTeam(9999, pullAt + 600), false, "no snapshot: the answer now")
on("Solex", "ENCOUNTER_START", "SECRET", "Boss", 16, 20)
eq(T:AtPull(nil, time()) and T:AtPull(nil, time()).team, false, "a secret encounter ID is kept as none, matched by time")

-- 10. Cheap, saved data, the share, the .toc ----------------------------------------------------------------------
check(not teamSrc:find('"OnUpdate"', 1, true), "no OnUpdate")
check(not teamSrc:find("WHISPER", 1, true) and not teamSrc:find("GUILD", 1, true), "only the raid channel")
local coreDefault = coreSrc:match("\\n    team = (%b{}),")
check(coreDefault ~= nil, "Core.lua has a team default")
local def = assert(load("return " .. (coreDefault or "{}")))()
eq(def.threshold, 0.75, "default: 75%")
check(profilesSrc:find("\\n    team = true,", 1, true) ~= nil, "the threshold is shared in Export settings only")
local coreAt = tocSrc:find("CRT_Core\\\\Core.lua", 1, true)
local teamAt = tocSrc:find("CRT_Core\\\\Team.lua", 1, true)
check(teamAt and teamAt > coreAt and teamAt < tocSrc:find("CRT_Modules\\\\Late\\\\Data.lua", 1, true), "Team.lua in the .toc, after Core and before the modules")
check(slashSrc:find('msg == "team"', 1, true) ~= nil, "/crt team")
for _, name in ipairs({ "Midnight", "Season 1", "Nek'zali" }) do check(not teamSrc:find(name, 1, true), "no season fact: " .. name) end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Team.lua', 'CRT_Core/Core.lua', 'CRT_Core/Profiles.lua', 'CowfeeRaidTools.toc', 'CRT_Core/Slash.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
