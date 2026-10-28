// The team raid check (CRT_Core/Team.lua): several CRTs in one raid, each its own copy of the file, every hello
// handed to every other one. The hello's encode and decode, the batching and the window (a burst of joiners gets one
// answer, never one per joiner, and the answers stop), no hello in combat, a finder group, a party, solo or during
// the game's lockdown (tried again until it lifts), the set following the roster (leaving, going offline, a reload),
// the count with offline members and players without CRT, tonight's team and Pug, OnChange, the snapshot at a pull's start, the
// realm folded in names, secret senders, the saved default, the share and the .toc.
// Usage: node run_team.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local teamSrc, coreSrc, profilesSrc, tocSrc, slashSrc, listSrc = ...
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
-- CRTDBChar is per character: each client's own, read and written as the one acting now
setmetatable(_G, {
  __index = function(_, k) if k == "CRTDBChar" then local c = clients[ME] return c and c.char end end,
  __newindex = function(t, k, v) if k == "CRTDBChar" then clients[ME].char = v else rawset(t, k, v) end end,
})
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
  local c = { name = name, realm = realm or "Sargeras", frames = {}, CRT = { db = { team = { threshold = 0.75, list = {} } }, version = version or "1.2.0" } }
  function c.CRT:Print() end
  clients[name] = c
  order[#order + 1] = name
  local was = ME ME = name
  assert(load(teamSrc, "Team.lua"))("CowfeeRaidTools", c.CRT)
  assert(load(listSrc, "TeamList.lua"))("CowfeeRaidTools", c.CRT)
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
eq(T.Encode(true), "H|1|1.2.0|A", "asking for answers: the A field")
eq(select(3, T.Decode("H|1|1.2.0|A")), true, "decoded as asking")
eq(select(3, T.Decode("H|1|1.2.0")), false, "a plain hello doesn't ask")
eq(select(3, T.Decode("H|1|1.2.0|B")), false, "another field isn't an ask")
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
-- the sender's spec: a field after the answer-me field (empty for a plain hello), only when the game gives one
A.CRT.Groups = { PlayerSpecID = function() return 65 end }
eq(T.Encode(), "H|1|1.2.0||65", "a plain hello with your spec")
eq(T.Encode(true), "H|1|1.2.0|A|65", "asking for answers, with your spec")
A.CRT.version = string.rep("9", 40) check(#T.Encode(true) < 40, "with a spec still a small message") A.CRT.version = "1.2.0"
A.CRT.Groups = { PlayerSpecID = function() return nil end }
eq(T.Encode(true), "H|1|1.2.0|A", "no spec known: the hello as before")
A.CRT.Groups = nil
eq(T.Encode(), "H|1|1.2.0", "no spec reader: the hello as before")
local function spec(text) return select(4, T.Decode(text)) end
eq(spec("H|1|1.2.0||65"), 65, "the spec read from a plain hello")
eq(select(3, T.Decode("H|1|1.2.0||65")), false, "which doesn't ask")
eq(spec("H|1|1.2.0|A|257"), 257, "and from one that asks")
eq(select(3, T.Decode("H|1|1.2.0|A|257")), true, "which asks")
eq(spec("H|1|1.2.0|A"), nil, "a hello from before the spec field: no spec")
eq(spec("H|1|1.2.0"), nil, "a plain one from before it: no spec")
eq(spec("H|1|1.2.0||x65"), nil, "a spec that isn't a number is left out")
eq(spec("H|1|1.2.0||0"), nil, "spec 0 is none")
eq(spec("H|1|1.2.0||6.5"), nil, "a fraction is none")
eq(spec("H|1.4|1.5.0|A|65|later"), 65, "a later minor version's extra fields after it are skipped")
-- the CRTs already out there read the new hello as before: v1.1.3's Decode, the first release with the hello,
-- copied exactly from git show v1.1.3:CRT_Core/Team.lua (with its readable and Team.VERSION 1), takes a hello
-- with the spec field as the same version, addon version and ask
local OLD_V113 = [[
local readable = function() return true end
local Team = { VERSION = 1 }
function Team.Decode(text)
    if not readable(text) or type(text) ~= "string" or #text > 255 then
        return nil
    end
    local version, addon, rest = text:match("^H|(%d+%.?%d*)|([^|]*)(.*)$")
    version = tonumber(version)
    if not version or version < 1 or math.floor(version) > Team.VERSION then
        return nil
    end
    if rest ~= "" and rest:sub(1, 1) ~= "|" then
        return nil
    end
    return version, addon, rest:match("^|([^|]*)") == "A"
end
return Team.Decode
]]
do
  local decode = assert(load(OLD_V113))()
  local v1, a1, ask1 = decode("H|1|1.2.0||65")
  eq(tostring(v1) .. " " .. tostring(a1), "1 1.2.0", "v1.1.3 parser: a plain hello with a spec is read")
  eq(ask1, false, "v1.1.3 parser: the plain one doesn't ask")
  local v2, a2, ask2 = decode("H|1|1.2.0|A|65")
  eq(tostring(v2) .. " " .. tostring(a2), "1 1.2.0", "v1.1.3 parser: an asking hello with a spec is read")
  eq(ask2, true, "v1.1.3 parser: the asking one asks")
end

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
eq(T.StatusLine(), "Now: Not in a raid group.", "solo: the status line")
check(not A.frames[1].events.CHAT_MSG_ADDON, "out of a raid group: addon messages not listened to")
shape = "party"
on("Solex", "GROUP_ROSTER_UPDATE")
advance(30)
eq(#sent, 0, "a party: nothing sent")
eq(T:IsTeam(), false, "a party: never a team raid")
on("Solex", "ENCOUNTER_START", 3002, "Boss", 14, 5)
eq(T:PullTeam(3002, time()), nil, "a party's pull in a raid instance has no team")
eq(T:Snapshot().team, nil, "nor has the snapshot now")
shape = "finder"
on("Solex", "GROUP_ROSTER_UPDATE")
advance(30)
eq(#sent, 0, "a finder group: nothing sent")
eq(T:IsTeam(), false, "a finder group: never a team raid")
-- a Raid Finder pull belongs to no team: no name in the snapshot, so Season Stats counts it in All only
on("Solex", "ENCOUNTER_START", 3001, "Boss", 17, 25)
eq(T:AtPull(3001, time()) and T:AtPull(3001, time()).team, nil, "a Raid Finder pull's snapshot has no team")
eq(T:PullTeam(3001, time()), nil, "and PullTeam gives none")
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
eq(T:IsTeam(), true, "a raid group on tonight's default team, Team: a team raid")
eq(T:Tonight(), "Team", "a new raid group starts on Team")
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
-- tonight's team decides, not how many run CRT
eq(T:IsTeam(), true, "6 of 8 running CRT on Team: a team raid")
eq(T.StatusText(), "Team", "the status: tonight's team")
eq(T.StatusLine(), "Now: Team.", "the status line General Settings and /crt team show")

-- 5. Pug, offline members, OnChange --------------------------------------------------------------------------------
local flips = {}
T:OnChange(function(team, s) flips[#flips + 1] = tostring(team) .. ":" .. tostring(s.team) end)
local recounts = 0
T:OnRecount(function() recounts = recounts + 1 end)
join("Pug3", "Sargeras", false)
eq(T:IsTeam(), true, "players without CRT joining don't change the team")
eq(#flips, 0, "and nothing flips")
check(recounts >= 1, "OnRecount on a new count")
check(T:SetTonight("pug"), "Pug picked (any case)")
eq(T:Tonight(), "Pug", "saved as the built-in name")
eq(T:IsTeam(), false, "Pug: not a team raid")
eq(flips[#flips], "false:Pug", "OnChange fires when the answer flips")
eq(T.StatusLine(), "Now: Pug.", "the status says so")
check(not T:SetTonight("Nobody"), "a team not in the list can't be picked")
eq(T:Tonight(), "Pug", "and tonight stays")
-- a player without CRT going offline: online members only
raid[#raid].online = false
on("Solex", "UNIT_CONNECTION", "raid9", false)
eq(snap("Solex").crt .. "/" .. snap("Solex").online, "6/8", "an offline member is left out of the count")
T:SetTonight("Team")
eq(T:IsTeam(), true, "Team again: a team raid")
eq(flips[#flips], "true:Team", "and OnChange says so")
local nflips = #flips
on("Solex", "GROUP_ROSTER_UPDATE")
eq(#flips, nflips, "OnChange only on a flip")
eq(T.Percent, nil, "no threshold any more")
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
assert(load(listSrc, "TeamList.lua"))("CowfeeRaidTools", Hay.CRT)
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
local reloadHello
for i = before + 1, afterReload do if sent[i].from == "Hay" then reloadHello = reloadHello or sent[i].text end end
eq(reloadHello, "H|1|1.2.0|A", "a reload's hello asks for answers")
-- two reloads 5 seconds apart: everyone just answered the first, and the second still learns everyone
local function reload(name)
  local c = clients[name]
  c.frames = {}
  local w = ME ME = name
  assert(load(teamSrc, "Team.lua"))("CowfeeRaidTools", c.CRT)
  assert(load(listSrc, "TeamList.lua"))("CowfeeRaidTools", c.CRT)
  ME = w
  c.Team = c.CRT.Team
  on(name, "PLAYER_ENTERING_WORLD", false, true)
end
advance(60)
reload("Moo")
advance(5)
reload("Hay")
advance(60)
eq(snap("Moo").crt .. "/" .. snap("Moo").online, "6/8", "the first reloader learns everyone")
eq(snap("Hay").crt .. "/" .. snap("Hay").online, "6/8", "and so does the second, 5 seconds later")
local afterTwo = #sent
advance(300)
eq(#sent, afterTwo, "and the answers stop")
-- a run back after a wipe: out of the raid instance and in again, a plain hello; everyone knows the sender
instanceKind = "none"
on("Bell", "PLAYER_ENTERING_WORLD", false, false)
advance(60)
instanceKind = "raid"
before = #sent
on("Bell", "PLAYER_ENTERING_WORLD", false, false)
advance(60)
eq(sentBy("Bell", before + 1), 1, "back in the raid instance: one plain hello")
local runHello for i = before + 1, #sent do if sent[i].from == "Bell" then runHello = sent[i].text end end
eq(runHello, "H|1|1.2.0", "which doesn't ask for answers")
eq(#sent - before, 1, "and nobody answers it: no answer storm")

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
-- a lockdown longer than every try: kept, and sent when the encounter ends
leave("Late3")
locked = true
before = #sent
join("Late3", "Sargeras", true)
advance(T.LOCK_RETRY * (T.LOCK_TRIES + 3))
eq(sentBy("Late3", before + 1), 0, "held past every try: nothing sent")
locked = false
advance(60)
eq(snap("Late3").crt, 1, "and it waits, not tried on a timer")
on("Late3", "ENCOUNTER_END", 3129, "Boss", 16, 20, 0)
advance(60)
eq(snap("Late3").crt, 9, "the encounter's end sends it, and the others answer")
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
local pugKey = T.Key("Pug1")
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.0", "PARTY", "Pug1-Sargeras")
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.0", "WHISPER", "Pug1-Sargeras")
eq(T:Runs(pugKey), false, "a hello on any channel but RAID is left alone")
-- a hello's spec goes to the spec cache under the sender's name; none without the field, none from a stranger
local cached = {}
A.CRT.Groups = { CacheSpec = function(name, s) cached[#cached + 1] = tostring(name) .. "=" .. tostring(s) end }
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.2.0||65", "RAID", "Moo-Sargeras")
eq(table.concat(cached, ","), "Moo-Sargeras=65", "a hello's spec is remembered for its sender")
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.2.0|A", "RAID", "Moo-Sargeras")
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.2.0||70", "RAID", "Stranger-Sargeras")
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.2.0||70", "PARTY", "Moo-Sargeras")
eq(#cached, 1, "no spec from an old hello, a stranger or another channel")
A.CRT.Groups = nil
on("Solex", "CHAT_MSG_ADDON", "CRTHello", "H|1|1.2.0||65", "RAID", "Moo-Sargeras")
check(true, "no spec cache loaded: the hello is still taken without error")
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
eq(atPull and atPull.isTeam, true, "the pull's snapshot: a team raid")
eq(atPull and atPull.team, "Team", "and its team's name")
T:SetTonight("Pug")
eq(T:IsTeam(), false, "Pug picked after the pull: not a team raid now")
eq(T:PullTeam(3129, pullAt), "Team", "the pull keeps the team it started with")
eq(T:PullTeam(9999, pullAt + 600), "Pug", "no snapshot: tonight's team now")
eq(T:PullIsTeam(3129, pullAt), true, "but the pull keeps its answer from the start")
eq(T:AtPull(3129, pullAt + 600), nil, "a start far from any pull: none")
eq(T:AtPull(9999, pullAt), nil, "another boss: none")
eq(T:PullIsTeam(9999, pullAt + 600), false, "no snapshot: the answer now")
on("Solex", "ENCOUNTER_START", "SECRET", "Boss", 16, 20)
eq(T:AtPull(nil, time()) and T:AtPull(nil, time()).isTeam, false, "a secret encounter ID is kept as none, matched by time")
T:SetTonight("Team")
-- leaving the group forgets the pulls' snapshots too
shape = "solo"
on("Solex", "GROUP_ROSTER_UPDATE")
eq(T:AtPull(3129, pullAt), nil, "out of the group: no snapshot left")
shape = "raid"
on("Solex", "GROUP_ROSTER_UPDATE")

-- 10. Cheap, saved data, the share, the .toc ----------------------------------------------------------------------
check(not teamSrc:find('"OnUpdate"', 1, true), "no OnUpdate")
check(not teamSrc:find("WHISPER", 1, true) and not teamSrc:find("GUILD", 1, true), "only the raid channel")
local coreDefault = coreSrc:match("\\n    team = (%b{}),")
check(coreDefault ~= nil, "Core.lua has a team default")
local def = assert(load("return " .. (coreDefault or "{}")))()
eq(def.threshold, 0.75, "the old threshold keeps its default, unread")
check(type(def.list) == "table" and #def.list == 0, "default: no teams of your own")
check(profilesSrc:find("\\n    team = { threshold = false, list = false, popup = true, keepApart = false },", 1, true) ~= nil, "your team names (and the look-alikes kept apart) stay yours in Export settings only")
check(not teamSrc:find("threshold", 1, true), "Team.lua never reads the threshold")
local listAt = tocSrc:find("CRT_Core\\\\TeamList.lua", 1, true)
check(listAt and listAt > tocSrc:find("CRT_Core\\\\Team.lua", 1, true), "TeamList.lua in the .toc, after Team.lua")
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
const files = ['CRT_Core/Team.lua', 'CRT_Core/Core.lua', 'CRT_Core/Profiles.lua', 'CowfeeRaidTools.toc', 'CRT_Core/Slash.lua', 'CRT_Core/TeamList.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
