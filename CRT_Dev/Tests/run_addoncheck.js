// The addon check (CRT_Core/AddonCheck.lua): several CRTs in one raid, each its own copy of the file, every message
// handed to every one of them. The wire (encode, decode, a key a reader doesn't know, a key a sender doesn't send, a
// higher major version, junk, a secret), the version compare, the module registry and your own flags, an ask
// answered on the group channel by everyone but you, one answer per REPLY_WINDOW, no answer in combat (sent when
// it ends), the 3 s window turning no answer into No CRT, the ask gap and MaybeCheck, Status and Rows (you, same,
// older, newer, waiting, none, offline), the filters and counts, the roster dropping leavers, leaving the group,
// the throttle and the encounter lockdown, and a raider without CRT who never answers.
// Usage: node run_addoncheck.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local checkSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
issecretvalue = function(v) return v == "SECRET" end
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

-- the raid on Sargeras: { name, realm, online, class }; shape is "raid", "party", "solo"
local raid = {
  { name = "Solex", realm = "Sargeras", online = true, class = "DEMONHUNTER" },
  { name = "Quick", realm = "Sargeras", online = true, class = "ROGUE" },
  { name = "Olden", realm = "Aerie Peak", online = true, class = "DEATHKNIGHT" },
  { name = "Newer", realm = "Sargeras", online = true, class = "MAGE" },
  { name = "Nocrt", realm = "Sargeras", online = true, class = "HUNTER" },
  { name = "Gone", realm = "Sargeras", online = false, class = "PRIEST" },
}
local shape = "raid"
local function inGroup(name) for _, m in ipairs(raid) do if m.name == name then return m end end end
UnitName = function(u) if u == "player" then return ME end end
-- party1.. are the other members in order
local function unitMember(u)
  if u == "player" then return inGroup(ME) end
  local i = tonumber(u:match("^party(%d+)$"))
  if not i then return nil end
  local n = 0
  for _, m in ipairs(raid) do if m.name ~= ME then n = n + 1 if n == i then return m end end end
end
-- the game gives the player unit its own realm too; Ambiguate "none" drops your own realm and keeps another
UnitFullName = function(u) local m = unitMember(u) if m then return m.name, (m.realm:gsub("%s", "")) end end
Ambiguate = function(name, how) if how == "none" then return (name:gsub("%-Sargeras$", "")) end return name end
UnitClass = function(u) local m = unitMember(u) if m then return "x", m.class end end
UnitIsConnected = function() return true end
GetNormalizedRealmName = function() return "Sargeras" end
IsInRaid = function() return shape == "raid" and inGroup(ME) ~= nil end
IsInGroup = function(cat) if cat == LE_PARTY_CATEGORY_INSTANCE then return false end return shape ~= "solo" and inGroup(ME) ~= nil end
GetNumGroupMembers = function() return #raid end
GetNumSubgroupMembers = function() return #raid - 1 end
GetRaidRosterInfo = function(i)
  local m = raid[i]
  if not m or not IsInRaid() then return nil end
  local name = m.realm == "Sargeras" and m.name or (m.name .. "-" .. m.realm)
  return name, 0, 1, 90, "Class", m.class, "Zone", m.online and 1 or nil
end
local combat = {}
InCombatLockdown = function() return combat[ME] == true end
local locked = false
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return locked end }
-- every addon message sent, with who sent it; result is what the game answers next
local outbox, result = {}, nil
-- the sender as chat writes it: Name-Realm (no space) from another realm, Name from your own
C_ChatInfo.SendAddonMessage = function(prefix, text, ch)
  if result then local r = result result = nil return r end
  local m = inGroup(ME)
  local from = (m and m.realm ~= "Sargeras") and (ME .. "-" .. m.realm:gsub("%s", "")) or ME
  outbox[#outbox + 1] = { prefix = prefix, text = text, from = from, channel = ch }
  return 0
end
local handlers
CreateFrame = function()
  local f = { events = {} }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:SetScript(_, fn) self.fn = fn handlers[#handlers + 1] = fn end
  return f
end

-- a CRT at a version, with its own switches (modules register as the real module files do)
local clients = {}
local function boot(name, version, flags)
  handlers = {}
  local CRT = { version = version, db = {} }
  local printed = {}
  function CRT:Print(s) printed[#printed + 1] = s end
  assert(load(checkSrc, "CRT_Core/AddonCheck.lua"))("CowfeeRaidTools", CRT)
  local AC = CRT.AddonCheck
  if flags then
    AC:Register({ key = "pace", label = "Pace", order = 40, on = function() return flags.pace end })
    AC:Register({ key = "notes", label = "Raid Notes", order = 10, on = function() return flags.notes end })
    if flags.interrupts ~= nil then
      AC:Register({ key = "interrupts", label = "Interrupts", order = 45, on = function() return flags.interrupts end })
    end
  end
  local c = { name = name, CRT = CRT, AC = AC, on = handlers, printed = printed, flags = flags }
  clients[name] = c
  return c
end
local function as(c, fn) local prev = ME ME = c.name local r = { fn() } ME = prev return table.unpack(r) end
local function deliverOnce()
  local box = outbox outbox = {}
  for _, m in ipairs(box) do
    for _, c in pairs(clients) do
      if inGroup(c.name) then
        as(c, function() for _, fn in ipairs(c.on) do fn(nil, "CHAT_MSG_ADDON", m.prefix, m.text, m.channel, m.from) end end)
      end
    end
  end
end
local function deliver() while #outbox > 0 do deliverOnce() end end
local function texts() local out = {} for _, m in ipairs(outbox) do out[#out + 1] = m.from:match("^[^-]+") .. ":" .. m.text end return table.concat(out, " ") end
local function event(c, e, ...) local args = { ... } as(c, function() for _, fn in ipairs(c.on) do fn(nil, e, table.unpack(args)) end end) end

local solex = boot("Solex", "1.1.5", { pace = true, notes = true })
local quick = boot("Quick", "1.1.5", { pace = false, notes = true })
local olden = boot("Olden", "1.1.4", { pace = nil, notes = true }) -- 1.1.4 knows no pace column
olden.AC.byKey.pace = nil for i, m in ipairs(olden.AC.modules) do if m.key == "pace" then table.remove(olden.AC.modules, i) end end
local newer = boot("Newer", "1.2.0", { pace = true, notes = false, interrupts = true })
ME = "Solex"

-- 1. The wire
eq(solex.AC.PREFIX, "CRTCheck1", "the prefix")
check(#solex.AC.PREFIX <= 16, "the prefix fits the game's 16 characters")
eq(solex.AC.EncodeAsk(7), "Q|1|7", "the ask")
local reply = as(solex, function() return solex.AC.EncodeReply(7, "1.1.5", solex.AC:Mine()) end)
eq(reply, "R|1|7|1.1.5|notes:1,pace:1", "the answer: version, then the modules in column order")
check(#reply <= 255, "an answer fits one message")
eq(as(quick, function() return quick.AC.EncodeReply(7, "1.1.5", quick.AC:Mine()) end), "R|1|7|1.1.5|notes:1,pace:0", "an off module is 0")
eq(as(olden, function() return olden.AC.EncodeReply(7, "1.1.4", olden.AC:Mine()) end), "R|1|7|1.1.4|notes:1", "a CRT without a module leaves its key out")
eq(solex.AC.EncodeReply(1, "1.1|5\\n", {}), "R|1|1|1.15|", "the version loses | and control characters")
do
  local kind, id = solex.AC.Decode("Q|1|7")
  eq(kind .. id, "Q7", "decode an ask")
  kind, id = solex.AC.Decode("Q|1.2|8|extra")
  eq(kind .. id, "Q8", "a later minor version's extra field is skipped")
  local v, addon, flags
  kind, id, addon, flags = solex.AC.Decode("R|1|7|1.2.0|notes:0,pace:1,interrupts:1,later")
  eq(kind .. id .. addon, "R71.2.0", "decode an answer")
  check(flags.notes == false and flags.pace == true, "its flags")
  eq(flags.interrupts, true, "a key this CRT doesn't know is still read (the page shows what it knows)")
  eq(solex.AC.Decode("R|2|7|1.3.0|notes:1"), nil, "a higher major version is left alone")
  eq(solex.AC.Decode("X|1|7"), nil, "another kind is left alone")
  eq(solex.AC.Decode("R|1|x|1.1.5|"), nil, "a bad id")
  eq(solex.AC.Decode("SECRET"), nil, "a secret text")
  eq(solex.AC.Decode(string.rep("Q|1|7", 60)), nil, "an oversized text")
  eq(solex.AC.Decode(42), nil, "not a string")
end

-- 2. Versions
local cmp = solex.AC.CompareVersions
eq(cmp("1.1.4", "1.1.5"), -1, "1.1.4 is older than 1.1.5")
eq(cmp("1.2.0", "1.1.5"), 1, "1.2.0 is newer")
eq(cmp("1.1.5", "1.1.5"), 0, "the same")
eq(cmp("1.1.10", "1.1.9"), 1, "numbers, not text: 1.1.10 is newer than 1.1.9")
eq(cmp("1.2", "1.2.0"), 0, "a missing number is 0")
eq(cmp("1.1.2 beta 2", "1.1.2"), -1, "a beta is older than its release")
eq(cmp("1.1.2 beta 2", "1.1.2 beta 3"), -1, "two betas compare by their numbers")
eq(cmp("dev", "1.1.5"), 0, "a developer copy is never flagged")
eq(cmp(nil, "1.1.5"), 0, "nil is never flagged")

-- 3. The registry
eq(#solex.AC:Modules(), 2, "two modules registered")
eq(solex.AC:Modules()[1].key .. "," .. solex.AC:Modules()[2].key, "notes,pace", "in order, not registration order")
check(not pcall(solex.AC.Register, solex.AC, { key = "pace", on = function() end }), "a key registered twice is refused")
check(not pcall(solex.AC.Register, solex.AC, { key = "Bad Key", on = function() end }), "a key must be lower-case letters")
check(not pcall(solex.AC.Register, solex.AC, { key = "nofn" }), "on is required")
solex.AC:Register({ key = "broken", label = "Broken", order = 99, on = function() error("boom") end })
eq(solex.AC:Mine().broken, false, "a module whose on() fails counts as off")
solex.AC.byKey.broken = nil table.remove(solex.AC.modules)

-- 4. A check: everyone but you answers, on the group channel, and the rows fill
eq(as(solex, function() return solex.AC:CanCheck() end), true, "can check in a raid")
check(as(solex, function() return solex.AC:Check() end), "the ask is sent")
eq(texts(), "Solex:Q|1|1", "one ask")
eq(outbox[1].channel, "RAID", "on the raid channel")
local rows = as(solex, function() return solex.AC:Rows() end)
eq(rows[1].name .. ":" .. rows[1].state, "Solex:you", "you are the first row")
eq(rows[2].state, "waiting", "the others wait inside the window")
eq(rows[6].state, "offline", "an offline member is offline, not waiting")
deliverOnce()
local answers = texts()
check(answers:find("Quick:R|1|1|1.1.5|notes:1,pace:0", 1, true) and answers:find("Olden:R|1|1|1.1.4|notes:1", 1, true) and answers:find("Newer:R|1|1|1.2.0|notes:0,pace:1,interrupts:1", 1, true), "Quick, Olden and Newer answer: " .. answers)
check(not answers:find("Solex:R", 1, true), "you don't answer your own ask")
eq(#outbox, 3, "three answers, each on the group channel")
eq(outbox[1].channel, "RAID", "answers go to the raid, not back to the asker")
deliver()
rows = as(solex, function() return solex.AC:Rows() end)
local byName = {} for _, r in ipairs(rows) do byName[r.name] = r end
eq(byName.Quick.state .. ":" .. byName.Quick.version, "same:1.1.5", "Quick is on your version")
eq(tostring(byName.Quick.modules.pace), "false", "Quick's pace is off")
eq(byName["Olden-Aerie Peak"] and byName["Olden-Aerie Peak"].state, "older", "Olden, cross-realm with a space in the realm, is older")
eq(tostring(byName["Olden-Aerie Peak"].modules.pace), "nil", "Olden's CRT doesn't report pace: nil, shown as a dash")
eq(byName.Newer.state, "newer", "Newer is newer")
eq(tostring(byName.Newer.modules.interrupts), "true", "a module you don't have yet is still kept")
eq(byName.Nocrt.state, "waiting", "no answer yet: still waiting inside the window")
advance(solex.AC.WINDOW)
rows = as(solex, function() return solex.AC:Rows() end)
byName = {} for _, r in ipairs(rows) do byName[r.name] = r end
eq(byName.Nocrt.state, "none", "no answer after the window: No CRT")
eq(byName.Gone.state, "offline", "offline stays offline")
-- every other CRT learned the answers too (a raider's Interrupts page needs no check of its own)
local qrows = as(quick, function() return quick.AC:Rows() end)
local qby = {} for _, r in ipairs(qrows) do qby[r.name] = r end
eq(qby.Newer.state .. ":" .. qby.Newer.version, "newer:1.2.0", "Quick learned Newer's answer from Solex's check")
eq(qby.Solex.state, "waiting", "Quick heard nothing from Solex (never asked): waiting, with no ask of Quick's own")
eq(as(quick, function() return quick.AC:Status("Newer") end), "newer", "Status by name")
eq(as(quick, function() return quick.AC:Status("newer-sargeras") end), "newer", "Status by a folded key")
eq(as(quick, function() return quick.AC:Status("SECRET") end), "waiting", "a secret name is waiting")

-- 5. Counts and filters
local counts = solex.AC.Counts(rows)
eq(counts.total .. "/" .. counts.same .. "/" .. counts.older .. "/" .. counts.newer .. "/" .. counts.none .. "/" .. counts.offline, "6/2/1/1/1/1", "the counts (you count as same)")
local function names(list) local out = {} for _, r in ipairs(list) do out[#out + 1] = r.name:match("^[^-]+") end return table.concat(out, ",") end
eq(names(solex.AC.Filter(rows, nil, "all")), "Solex,Quick,Olden,Newer,Nocrt,Gone", "Everyone")
eq(names(solex.AC.Filter(rows, nil, "nocrt")), "Nocrt", "No CRT")
eq(names(solex.AC.Filter(rows, nil, "older")), "Olden", "Older version")
eq(names(solex.AC.Filter(rows, "pace", "on")), "Solex,Newer", "Pace on")
eq(names(solex.AC.Filter(rows, "pace", "off")), "Quick,Olden", "Pace off, a CRT too old to report it included")
eq(names(solex.AC.Filter(rows, nil, "on")), "Solex,Quick,Olden,Newer,Nocrt,Gone", "Module on without a module shows everyone")

-- 6. The ask gap and MaybeCheck
local ok, why = as(solex, function() return solex.AC:Check() end)
eq(tostring(ok) .. ":" .. tostring(why), "false:gap", "a second ask inside the gap is refused")
eq(as(solex, function() return solex.AC:MaybeCheck() end), false, "MaybeCheck: the last ask is fresh")
advance(solex.AC.STALE)
outbox = {}
eq(as(solex, function() return solex.AC:MaybeCheck() end), true, "MaybeCheck asks again once stale")
eq(texts(), "Solex:Q|1|2", "the second ask")
deliver()

-- 7. One answer per REPLY_WINDOW: Quick asks right after Solex, so Olden and Newer (who just answered Solex)
-- answer Quick only when the window ends; Solex, who hasn't answered anyone yet, answers at once
outbox = {}
advance(solex.AC.ASK_GAP)
as(solex, function() solex.AC:Check() end)
deliverOnce()
eq(#outbox, 3, "the first ask is answered at once (the window has passed)")
outbox = {}
as(quick, function() quick.AC:Check() end)
deliverOnce()
eq(#outbox, 1, "an ask inside the reply window waits (only Solex, who hadn't answered, answers now)")
eq(outbox[1].from, "Solex", "Solex's answer")
advance(solex.AC.REPLY_WINDOW)
eq(#outbox, 3, "the others answer when the window ends")
deliver()

-- 8. Combat: no answer until it ends
outbox = {}
combat.Quick = true
advance(solex.AC.REPLY_WINDOW + solex.AC.ASK_GAP)
as(solex, function() solex.AC:Check() end)
deliverOnce()
eq(#outbox, 2, "Quick, in combat, doesn't answer yet")
combat.Quick = false
event(quick, "PLAYER_REGEN_ENABLED")
eq(#outbox, 3, "Quick answers when combat ends")
deliver()

-- 9. The throttle and the lockdown
outbox = {}
advance(solex.AC.REPLY_WINDOW + solex.AC.ASK_GAP)
result = 3
as(solex, function() solex.AC:Check() end)
eq(#outbox, 0, "throttled: nothing went")
advance(1)
eq(texts():match("^Solex:Q"), "Solex:Q", "sent a second later")
outbox = {}
locked = true
advance(solex.AC.ASK_GAP)
ok, why = as(solex, function() return solex.AC:Check() end)
eq(tostring(ok) .. ":" .. tostring(why), "false:lockdown", "no check during the encounter's lockdown")
locked = false
advance(solex.AC.ASK_GAP)
result = 11
as(solex, function() solex.AC:Check() end)
eq(#outbox, 0, "the game held the message")
advance(9)
eq(#outbox, 0, "still held")
advance(1)
eq(texts():match("^Solex:Q"), "Solex:Q", "sent once the hold lifts")
deliver()
outbox = {}
result = 99
advance(solex.AC.ASK_GAP)
as(solex, function() solex.AC:Check() end)
eq(#outbox, 0, "an unknown result drops the message")
check(solex.printed[#solex.printed] and solex.printed[#solex.printed]:find("could not be sent", 1, true) ~= nil, "with one chat line")
deliver()

-- 10. The roster: a leaver is dropped; leaving the group clears everything
table.remove(raid, 4) -- Newer leaves
event(solex, "GROUP_ROSTER_UPDATE")
eq(tostring(solex.AC.replies["newer-sargeras"]), "nil", "a leaver's answer is dropped")
check(solex.AC.replies["quick-sargeras"] ~= nil, "the others are kept")
local fired = {}
solex.AC:OnChange(function(what) fired[#fired + 1] = what end)
shape = "solo"
event(solex, "GROUP_ROSTER_UPDATE")
eq(next(solex.AC.replies), nil, "out of a group: everything cleared")
eq(tostring(solex.AC:AskedAt()), "nil", "and the last ask forgotten")
eq(fired[1], "roster", "the page is told")
rows = as(solex, function() return solex.AC:Rows() end)
eq(#rows .. ":" .. rows[1].state, "1:you", "solo: only you")
eq(rows[1].name, "Solex", "solo: your own realm is left off your name")
eq(rows[1].key, "solex-sargeras", "but the key keeps it")
ok, why = as(solex, function() return solex.AC:Check() end)
eq(tostring(ok) .. ":" .. tostring(why), "false:group", "no check out of a group")

-- 11. A party works too
shape = "party"
eq(as(solex, function() return solex.AC:CanCheck() end), true, "can check in a party")
rows = as(solex, function() return solex.AC:Rows() end)
eq(#rows, 5, "a party lists its members")
eq(rows[2].name .. "," .. rows[3].name, "Quick,Olden-AeriePeak", "a party member's own realm is left off, another realm kept")
as(solex, function() solex.AC:Check() end)
eq(outbox[#outbox].channel, "PARTY", "on the party channel")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, 'CRT_Core/AddonCheck.lua'), 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
