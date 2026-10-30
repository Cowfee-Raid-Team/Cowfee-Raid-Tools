// The addon check and older CRTs (CRT_Core/AddonCheck.lua with CRT_Core/Team.lua): a raider on a CRT from before the
// addon check never answers its CRTCheck1 ask, but does speak the CRTHello hello, which carries the addon version.
// Several CRTs in one raid, each its own copy of the files, every message handed to every one of them: the check
// asks both ways (its own ask, and a hello with A through Team's send path, no new prefix, the hello as it was), the
// old raider answers with a plain hello, and their row shows their version with blank module cells; No CRT only for
// a member with neither answer, after the longer wait the hello needs; the counts, filters and Announce treat the
// old raider as having CRT; a leaver's hello version is dropped; in a party (no hellos) the check waits as before.
// Usage: node run_addoncheck_hello.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local teamSrc, checkSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
issecretvalue = function(v) return v == "SECRET" end
time = function() return 1000 end
LE_PARTY_CATEGORY_HOME, LE_PARTY_CATEGORY_INSTANCE = 1, 2
Enum = { SendAddonMessageResult = { Success = 0, AddonMessageThrottle = 3, ChannelThrottle = 8, AddOnMessageLockdown = 11 } }
local CLOCK = 100
GetTime = function() return CLOCK end
local timers = {}
local ME
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

-- the raid on Sargeras
local raid = {
  { name = "Solex", online = true, class = "DEMONHUNTER" },
  { name = "Quick", online = true, class = "ROGUE" },
  { name = "Olden", online = true, class = "DEATHKNIGHT" },
  { name = "Nocrt", online = true, class = "HUNTER" },
}
local shape = "raid"
local function inGroup(name) for _, m in ipairs(raid) do if m.name == name then return m end end end
UnitName = function(u) if u == "player" then return ME end end
local function unitMember(u)
  if u == "player" then return inGroup(ME) end
  local i = tonumber(u:match("^party(%d+)$"))
  if not i then return nil end
  local n = 0
  for _, m in ipairs(raid) do if m.name ~= ME then n = n + 1 if n == i then return m end end end
end
UnitFullName = function(u) local m = unitMember(u) if m then return m.name, "Sargeras" end end
Ambiguate = function(name) return (name:gsub("%-Sargeras$", "")) end
UnitClass = function(u) local m = unitMember(u) if m then return "x", m.class end end
UnitIsConnected = function() return true end
UnitIsGroupLeader = function(u) return u == "raid1" end
GetInstanceInfo = function() return "Somewhere", "none" end
GetNormalizedRealmName = function() return "Sargeras" end
IsInRaid = function() return shape == "raid" and inGroup(ME) ~= nil end
IsInGroup = function(cat) if cat == LE_PARTY_CATEGORY_INSTANCE then return false end return shape ~= "solo" and inGroup(ME) ~= nil end
GetNumGroupMembers = function() return #raid end
GetNumSubgroupMembers = function() return #raid - 1 end
GetRaidRosterInfo = function(i)
  local m = raid[i]
  if not m or not IsInRaid() then return nil end
  return m.name, 0, 1, 90, "Class", m.class, "Zone", m.online and 1 or nil
end
local combat = {}
InCombatLockdown = function() return combat[ME] == true end
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return false end }
local outbox = {}
C_ChatInfo.SendAddonMessage = function(prefix, text, ch)
  outbox[#outbox + 1] = { prefix = prefix, text = text, from = ME, channel = ch }
  return 0
end
local handlers
CreateFrame = function()
  local f = { events = {} }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  function f:SetScript(_, fn) self.fn = fn handlers[#handlers + 1] = fn end
  return f
end

-- a CRT at a version: withCheck loads the addon check too (a CRT from before it has only the hello)
local clients = {}
local function boot(name, version, withCheck)
  handlers = {}
  local CRT = { version = version, db = { addonCheck = { announceTo = "raid" } } }
  function CRT:Print() end
  local prev = ME ME = name
  assert(load(teamSrc, "CRT_Core/Team.lua"))("CowfeeRaidTools", CRT)
  if withCheck then
    assert(load(checkSrc, "CRT_Core/AddonCheck.lua"))("CowfeeRaidTools", CRT)
    CRT.AddonCheck:Register({ key = "pace", label = "Pace", order = 40, on = function() return true end })
  end
  ME = prev
  local c = { name = name, CRT = CRT, AC = CRT.AddonCheck, Team = CRT.Team, on = handlers }
  clients[name] = c
  return c
end
local function as(c, fn) local prev = ME ME = c.name local r = { fn() } ME = prev return table.unpack(r) end
local log = {}
local function deliver()
  while #outbox > 0 do
    local box = outbox outbox = {}
    for _, m in ipairs(box) do
      log[#log + 1] = m
      for _, c in pairs(clients) do
        if inGroup(c.name) then
          as(c, function() for _, fn in ipairs(c.on) do fn(nil, "CHAT_MSG_ADDON", m.prefix, m.text, m.channel, m.from) end end)
        end
      end
    end
  end
end
local function byName(rows) local out = {} for _, r in ipairs(rows) do out[r.name] = r end return out end

local solex = boot("Solex", "1.1.6", true)
local quick = boot("Quick", "1.1.6", true)
local olden = boot("Olden", "1.1.5", false) -- a CRT from before the addon check: it speaks only the hello
ME = "Solex"

-- 1. The check asks both ways; the old raider answers the hello it knows
check(as(solex, function() return solex.AC:Check() end), "the check goes")
deliver()
eq(#log, 2, "the ask and Quick's answer go at once")
eq(log[1].prefix .. " " .. log[1].text, "CRTCheck1 Q|1|1", "the ask")
local rows = byName(as(solex, function() return solex.AC:Rows() end))
eq(rows.Quick.state .. ":" .. rows.Quick.version, "same:1.1.6", "Quick answers the ask")
eq(rows.Olden.state, "waiting", "Olden, who can't read the ask, is waiting")
advance(solex.Team.DEBOUNCE)
deliver()
local hello
for _, m in ipairs(log) do if m.prefix == "CRTHello" and m.from == "Solex" then hello = m end end
check(hello ~= nil, "the check sends a hello too, through Team's send path")
eq(hello and hello.text, "H|1|1.1.6|A", "the hello as it always was, asking for answers")
eq(hello and hello.channel, "RAID", "on the raid channel, as every hello")
advance(solex.Team.DEBOUNCE)
deliver()
local oldHello
for _, m in ipairs(log) do if m.from == "Olden" then oldHello = m end end
eq(oldHello and (oldHello.prefix .. " " .. oldHello.text), "CRTHello H|1|1.1.5", "Olden answers with its plain hello")
for _, m in ipairs(log) do
  check(m.prefix == "CRTCheck1" or m.prefix == "CRTHello", "no other prefix: " .. m.prefix)
end
eq(as(solex, function() return solex.Team:VersionOf("olden-sargeras") end), "1.1.5", "Team keeps the hello's version")

-- 2. Olden's row: the version from the hello, blank modules, the reason in the tooltip text
rows = byName(as(solex, function() return solex.AC:Rows() end))
eq(rows.Olden.state .. ":" .. tostring(rows.Olden.version), "older:1.1.5", "Olden shows 1.1.5, older, not No CRT")
eq(rows.Olden.helloOnly, true, "known only from a hello")
eq(rows.Olden.modules, nil, "so no modules")
eq(rows.Quick.helloOnly, nil, "Quick's answer to the ask wins over its hello")
eq(tostring(rows.Quick.modules and rows.Quick.modules.pace), "true", "and keeps its modules")
eq(solex.AC.TEXT.helloOnly, "This version can't report its modules. Modules show once they update.", "the version cell's tooltip")
eq(rows.Nocrt.state, "waiting", "Nocrt still waits: the hello's answers need longer than an ask's")
advance(solex.AC.HELLO_WINDOW)
rows = byName(as(solex, function() return solex.AC:Rows() end))
eq(rows.Nocrt.state, "none", "neither answer after the wait: No CRT")
eq(rows.Olden.state, "older", "Olden stays on 1.1.5")

-- 3. Counts, filters, Announce
local list = as(solex, function() return solex.AC:Rows() end)
local c = solex.AC.Counts(list)
eq(c.same .. "/" .. c.older .. "/" .. c.none, "2/1/1", "2 on 1.1.6, 1 older, 1 without CRT")
local function names(l) local out = {} for _, r in ipairs(l) do out[#out + 1] = r.name end return table.concat(out, ",") end
eq(names(solex.AC.Filter(list, nil, "nocrt")), "Nocrt", "No CRT leaves Olden out")
eq(names(solex.AC.Filter(list, nil, "older")), "Olden", "Older version shows Olden")
local lines = solex.AC.AnnounceLines(list, "1.1.6")
eq(lines[1], "Missing Cowfee Raid Tools: Nocrt. Older version: Olden (1.1.5).", "Announce: only Nocrt is missing CRT")
eq(as(solex, function() return (solex.AC:CanAnnounce()) end), true, "Announce opens after the wait")

-- 4. Olden leaves: the hello's version goes with them
table.remove(raid, 3)
as(solex, function() solex.Team.HandleEvent("GROUP_ROSTER_UPDATE") end)
eq(as(solex, function() return solex.Team:VersionOf("olden-sargeras") end), nil, "a leaver's hello version is dropped")
table.insert(raid, 3, { name = "Olden", online = true, class = "DEATHKNIGHT" })

-- 5. In a party there is no hello: the check sends only its ask and waits its own window
shape = "party"
as(solex, function() solex.Team.HandleEvent("GROUP_ROSTER_UPDATE") end)
log, outbox = {}, {}
advance(solex.AC.ASK_GAP + solex.Team.WINDOW)
check(as(solex, function() return solex.AC:Check() end), "a check in a party")
deliver()
advance(solex.AC.WINDOW)
rows = byName(as(solex, function() return solex.AC:Rows() end))
eq(rows.Nocrt.state, "none", "in a party, No CRT after the ask's own window")
eq(rows.Quick.state, "same", "Quick answers the ask in a party too")
advance(solex.Team.WINDOW)
deliver()
local hellos = 0
for _, m in ipairs(log) do if m.prefix == "CRTHello" then hellos = hellos + 1 end end
eq(hellos, 0, "no hello in a party")
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, 'CRT_Core/Team.lua'), 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, 'CRT_Core/AddonCheck.lua'), 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
