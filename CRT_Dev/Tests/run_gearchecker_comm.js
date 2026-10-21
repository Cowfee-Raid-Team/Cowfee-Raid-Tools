// Gear Checker's request and reply (CRT_Modules/GearChecker/Comm.lua with the gear engine): several CRTs in
// one raid, each its own copy of the files, every message handed to every one of them. A full equipped set
// with long item strings in parts of 255 bytes or less, the round trip into CRT.Gear, the CRT count, the
// reply window, combat, out of a group, the throttle, an emptied slot, junk and a later version's message,
// your own messages, and a frozen old client (1.1.0's Loot Master Comm, CRT_Dev/Tests/old_Comm.lua, with no
// Gear Checker) that ignores the prefix. Usage: node run_gearchecker_comm.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local gearSrc, dataSrc, inspectSrc, commSrc, lmDataSrc, oldCommSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
local CLOCK = 100
GetTime = function() return CLOCK end
time = function() return 1790000000 + CLOCK end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = CLOCK + s, fn = fn } end, NewTicker = function() return { Cancel = function() end } end }
local function advance(s)
  local target = CLOCK + s
  while true do
    table.sort(timers, function(a, b) return a.at < b.at end)
    local t = timers[1]
    if not t or t.at > target then break end
    table.remove(timers, 1)
    CLOCK = t.at
    t.fn()
  end
  CLOCK = target
end

-- one raid on Sargeras; ME is whichever CRT is acting now
local ME = "Solex"
local NAMES = { "Solex", "Quick", "Old" }
UnitFullName = function(u)
  if u == "player" then return ME end
  local i = tonumber((u or ""):match("^raid(%d+)$"))
  return i and NAMES[i]
end
UnitName = UnitFullName
UnitClass = function() return "Paladin", "PALADIN" end
UnitIsUnit = function(a, b) return UnitFullName(a) == UnitFullName(b) end
UnitIsGroupLeader = function(u) return u == "raid1" or (u == "player" and ME == "Solex") end
GetNormalizedRealmName = function() return "Sargeras" end
local grouped = true
LE_PARTY_CATEGORY_INSTANCE = 2
IsInGroup = function(c) return grouped and c == nil end
IsInRaid = function() return grouped end
GetNumGroupMembers = function() return #NAMES end
GetNumSubgroupMembers = function() return 0 end
GetRaidRosterInfo = function(i) return NAMES[i] end
IsInGuild = function() return false end
local combat = {}
InCombatLockdown = function() return combat[ME] == true end
CRTDBChar = {}

-- each player's gear: a full set of 16 with long item strings (bonus IDs, gems, enchant, crafter)
local TAIL = ":28:12:12667:12793:6652:13577:13333:10354:10255:10256:10257:10258:10259:10260:2:28:2462:29:40:::Player-3299-0050F7FB"
local GEAR = {}
local SLOTS = { 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17 }
for _, who in ipairs({ "Solex", "Quick" }) do
  GEAR[who] = {}
  for i, slot in ipairs(SLOTS) do
    local id = (who == "Quick" and 700 or 600) + i
    GEAR[who][slot] = "|cffa335ee|Hitem:" .. id .. ":7364:213746:213746:213746::::90:577::28" .. TAIL .. "|h[x]|h|r"
  end
end
GetInventoryItemLink = function(unit, slot) return unit == "player" and GEAR[ME] and GEAR[ME][slot] or nil end
GetInventoryItemID = function(unit, slot) local l = GetInventoryItemLink(unit, slot) return l and tonumber(l:match("item:(%d+)")) end
C_Item = {
  GetDetailedItemLevelInfo = function() return 289 end,
  GetItemInfoInstant = function(s) return 1, "Armor", "Misc", "INVTYPE_CHEST", 0, 4, 0 end,
  GetItemInfo = function() return nil end,
  RequestLoadItemDataByID = function() end,
}
-- every addon message sent, with who sent it; result is what the game answers
local outbox, result = {}, 0
C_ChatInfo = { RegisterAddonMessagePrefix = function() end,
  SendAddonMessage = function(prefix, text) if result ~= 0 then local r = result result = 0 return r end outbox[#outbox + 1] = { prefix = prefix, text = text, from = ME } return 0 end }
local handlers
CreateFrame = function()
  local f = { events = {} }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:SetScript(_, fn) self.fn = fn if self.events.CHAT_MSG_ADDON then handlers[#handlers + 1] = fn end end
  return f
end

-- a CRT with the Gear Checker
local function boot(name)
  handlers = {}
  local CRT = { db = { gearChecker = { filter = "all", popout = {} } } }
  function CRT:Print() end
  for _, src in ipairs({ gearSrc, dataSrc, inspectSrc, commSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
  return { name = name, full = name .. "-Sargeras", CRT = CRT, GC = CRT.GearChecker, on = handlers }
end
-- 1.1.0: Loot Master's Comm only, no Gear Checker
local function bootOld(name)
  handlers = {}
  local CRT = { db = { lootmaster = { authority = { leader = true, names = {} } } } }
  function CRT:Print() end
  CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
  assert(load(lmDataSrc))("CowfeeRaidTools", CRT)
  local LM = CRT.LootMaster
  function LM:MyRole() return "D" end
  function LM:MyItemLevel() return "285.0" end
  function LM:MyGear() return {} end
  assert(load(oldCommSrc))("CowfeeRaidTools", CRT)
  return { name = name, full = name .. "-Sargeras", CRT = CRT, LM = LM, on = handlers, old = true }
end
local function as(p, fn) local prev = ME ME = p.name local r = { fn() } ME = prev return table.unpack(r) end
local raid
-- hands everything sent to every CRT (group messages come back to the sender too)
-- deliverOnce hands on only what was sent so far (the answers it causes wait in the outbox)
local function deliverOnce()
  local box = outbox outbox = {}
  for _, m in ipairs(box) do
    for _, p in ipairs(raid) do
      as(p, function() for _, fn in ipairs(p.on) do fn(nil, "CHAT_MSG_ADDON", m.prefix, m.text, "RAID", m.from) end end)
    end
  end
end
local function deliver()
  while #outbox > 0 do deliverOnce() end
end
local function kinds() local out = {} for _, m in ipairs(outbox) do out[#out + 1] = m.text:sub(1, 1) end return table.concat(out) end

local solex, quick, old = boot("Solex"), boot("Quick"), bootOld("Old")
raid = { solex, quick, old }
eq(solex.GC.Comm.PREFIX, "CRTGearCheck", "the prefix")
check(#solex.GC.Comm.PREFIX <= 16, "the prefix fits the game's 16 characters")

-- 1. Ask and answer: Quick's whole set arrives in parts of 255 bytes or less
check(as(solex, function() return solex.GC.Comm:Request() end), "the ask is sent")
eq(kinds(), "Q", "one ask")
eq(outbox[1].text, "Q|1|1", "the ask carries the version and an ID")
deliverOnce()
local parts = 0
for _, m in ipairs(outbox) do
  parts = parts + 1
  check(#m.text <= 255, "every reply part is 255 bytes or less (" .. #m.text .. ")")
  check(m.text:find("^G|1|%d+|%d+|%d+|") ~= nil, "each part says its version, set, part and part count")
end
check(parts > 1, "a full set of long items takes several parts (" .. parts .. ")")
eq(#outbox, parts, "only Quick answers: you don't answer yourself, the old client doesn't know the prefix")
for _, m in ipairs(outbox) do check(m.from == "Quick", "the answer is Quick's") end
deliver()
local G = solex.CRT.Gear
eq(#G:OfAll("Quick-Sargeras"), 16, "the round trip: all 16 pieces")
eq(G:Of("Quick-Sargeras", 11).itemString, (GEAR.Quick[11]:match("item:[%w:%-]+")), "the exact item string, gems, enchant and bonus IDs")
eq(G:Of("Quick-Sargeras", 11).ilvl, 289, "its item level")
eq(select(2, G:When("Quick-Sargeras")), "gearcheck", "remembered as the Gear Checker's")
check(solex.GC.Comm:HasCRT("Quick-Sargeras") and solex.GC.Comm:HasSet("Quick-Sargeras"), "Quick has CRT and sent the set")
check(quick.GC.Comm:HasCRT("Solex-Sargeras"), "and Quick knows Solex has CRT from the ask")
local n, m = as(solex, function() return solex.GC.Comm:Count(solex.GC:Roster()) end)
eq(n .. "/" .. m, "2/3", "2 of the 3 have CRT")
eq(old.LM.incoming, nil, "the old client: nothing changed")

-- 2. The reply window: asks within it get one answer, when it ends
advance(solex.GC.Comm.REQUEST_GAP)
eq(as(solex, function() return solex.GC.Comm:Request() end), true, "a second ask after the gap")
check(not as(solex, function() return solex.GC.Comm:Request() end), "a third right away is refused")
deliverOnce()
eq(#outbox, 0, "Quick answered moments ago: no answer yet")
advance(quick.GC.Comm.REPLY_WINDOW)
check(#outbox > 0 and kinds():match("^G+$") ~= nil, "the window ends: one answer")
local first = #outbox
deliver()
advance(30)
eq(#outbox, 0, "and no more")

-- 3. Combat: an ask is answered when combat ends
advance(solex.GC.Comm.REQUEST_GAP)
combat.Quick = true
as(solex, function() solex.GC.Comm:Request() end)
deliverOnce()
eq(#outbox, 0, "in combat: no answer")
combat.Quick = nil
as(quick, function() quick.GC.Comm:OnEvent("PLAYER_REGEN_ENABLED") end)
check(#outbox > 0, "combat over: the answer")
deliver()

-- 4. An emptied slot: the whole set replaces what was there
advance(30)
GEAR.Quick[12] = nil
as(quick, function() quick.CRT.Gear:Refresh() end)
as(solex, function() solex.GC.Comm:Request() end)
deliver() deliver()
eq(G:Of("Quick-Sargeras", 12), nil, "the ring taken off is gone")
eq(#G:OfAll("Quick-Sargeras"), 15, "the other 15 stay")

-- 5. The throttle: the message waits a second and goes
advance(30)
result = 3 -- AddonMessageThrottle
as(solex, function() solex.GC.Comm:Request() end)
eq(#outbox, 0, "throttled: held")
advance(1)
eq(kinds(), "Q", "a second later: sent")
outbox = {}

-- 6. Out of a group: no ask, no answer
advance(30)
grouped = false
check(not as(solex, function() return solex.GC.Comm:Request() end), "out of a group: no ask")
as(quick, function() quick.GC.Comm:Receive("Q|1|9", "Solex-Sargeras") end)
eq(#outbox, 0, "out of a group: no answer")
grouped = true

-- 7. Your own messages, junk and a later version
advance(30)
as(quick, function() quick.GC.Comm:Receive("Q|1|9", "Quick-Sargeras") end)
eq(#outbox, 0, "your own ask is not answered")
local before = G:Of("Quick-Sargeras", 1).itemString
for _, junk in ipairs({ "", "G", "G|x", "G|0|1|1|1|1~item:5~1", "G|1|1|3|2|1~item:5~1", "G|1||1|1|1~item:5~1", "Z|1|whatever", "G|1|8|1|1|garbage;;" }) do
  as(solex, function() solex.GC.Comm:Receive(junk, "Quick-Sargeras") end)
end
eq(G:Of("Quick-Sargeras", 1).itemString, before, "junk and unknown kinds change nothing")
eq(#outbox, 0, "and send nothing")
as(solex, function() solex.GC.Comm:Receive("G|2|76|1|1|1~item:998:5~300", "Quick-Sargeras") end)
eq(G:Of("Quick-Sargeras", 1).itemString, before, "a higher major version is skipped")
as(solex, function() solex.GC.Comm:Receive("Q|2|76", "Quick-Sargeras") end)
eq(#outbox, 0, "and its ask isn't answered")
as(solex, function() solex.GC.Comm:Receive("G|1.2|77|1|1|1~item:999:5~300|a field for later", "Quick-Sargeras") end)
eq(G:Of("Quick-Sargeras", 1).itemString, "item:999:5", "a later minor version's set is read, its extra field left")
eq(#G:OfAll("Quick-Sargeras"), 1, "and is a whole set")
as(solex, function() solex.GC.Comm:Receive("G|1|78|1|2|1~item:111~1", "Quick-Sargeras") end)
eq(G:Of("Quick-Sargeras", 1).itemString, "item:999:5", "half a set: kept until the rest comes")
as(solex, function() solex.GC.Comm:Receive("G|1|78|2|2|2~item:112~1", "Quick-Sargeras") end)
eq(G:Of("Quick-Sargeras", 1).itemString, "item:111", "the rest: the set")
eq(G:Of("Quick-Sargeras", 2).itemString, "item:112", "both parts")

-- 8. The old client never breaks
local errs = fails
advance(30)
as(solex, function() solex.GC.Comm:Request() end)
deliver() deliver()
eq(fails, errs, "the old client takes every Gear Checker message without an error")
eq(old.LM.incoming, nil, "and does nothing with them")

-- 9. PackMany for a full set: every message fits, nothing is lost
local pieces = {}
for i, slot in ipairs(SLOTS) do pieces[i] = { slot = slot, itemString = "item:" .. (900 + i) .. ":7364:213746:213746:213746::::90:577::28" .. TAIL, ilvl = 289 } end
local msgs = solex.GC.Comm.SetMessages(pieces, "123456")
local count = 0
for _, text in ipairs(msgs) do
  check(#text <= 255, "a full set's message is 255 bytes or less (" .. #text .. ")")
  local body = text:match("^G|%d+|%d+|%d+|%d+|(.*)$")
  for _ in (body .. ";"):gmatch("([^;]+);") do count = count + 1 end
end
eq(count, 16, "all 16 pieces are in the messages")
-- a piece too long for a message on its own goes by its ID, so the set stays whole
local hugeString = "item:950:7364:213746:213746:213746::::90:577::28" .. string.rep(":12667", 30)
check(#hugeString <= 230 and #("1~" .. hugeString .. "~289") > 255 - solex.GC.Comm.HEAD_MAX, "a piece too long for a message's room (" .. #hugeString .. ")")
local withHuge = { { slot = 1, id = 950, itemString = hugeString, ilvl = 289 }, { slot = 2, id = 951, itemString = "item:951:5", ilvl = 288 } }
local hm = solex.GC.Comm.SetMessages(withHuge, "9")
local all = table.concat(hm, ";")
check(all:find("1~item:950~289", 1, true) ~= nil, "the long piece is sent as slot~item:id~ilvl")
check(all:find("2~item:951:5~288", 1, true) ~= nil, "the others as they are")
for _, text in ipairs(hm) do check(#text <= 255, "still 255 bytes or less (" .. #text .. ")") end
local empty = solex.GC.Comm.SetMessages({}, "5")
eq(#empty == 1 and empty[1], "G|1|5|1|1|", "nothing worn: one empty part")

-- 10. Refresh: your own slots read again at once (an enchant changes a link with no event), then the
-- group asked, then whoever has no set from the last Comm.STALE seconds inspected
local queued
solex.GC.Inspect.Queue = function(_, names) queued = table.concat(names, ",") end
outbox, timers = {}, {}
advance(60)
as(solex, function() solex.CRT.Gear:Refresh() end)
GEAR.Solex[1] = GEAR.Solex[1]:gsub("item:601:7364", "item:601:9999")
eq(solex.CRT.Gear:Mine(1).itemString:match("^item:%d+:(%d+)"), "7364", "refresh: the cache still has the old enchant")
local fired = {}
solex.GC:OnChange(function(what) fired[#fired + 1] = what end)
as(solex, function() solex.GC:Refresh() end)
eq(solex.CRT.Gear:Mine(1).itemString:match("^item:%d+:(%d+)"), "9999", "refresh: your new enchant, read at once")
check(table.concat(fired, ","):find("mine", 1, true) ~= nil, "refresh: the page is told your gear changed")
eq(kinds(), "Q", "refresh: the group is asked")
outbox = {}
as(solex, function() advance(solex.GC.Comm.REPLY_WAIT) end)
eq(queued, "Quick-Sargeras,Old-Sargeras", "refresh: no answer, Quick's set older than Comm.STALE: both inspected")
-- Quick answers this time: a fresh set, not inspected; someone inspected moments ago isn't either
advance(30)
solex.CRT.Gear:Remember("Old-Sargeras", { { slot = 1, id = 5 } }, solex.GC.SOURCE_INSPECT, true)
queued = nil
as(solex, function() solex.GC:Refresh() end)
deliver()
as(solex, function() advance(solex.GC.Comm.REPLY_WAIT) end)
eq(queued, "", "refresh: a fresh answer and a fresh inspect: no one inspected")
advance(solex.GC.Comm.STALE)
as(solex, function() solex.GC:Refresh() end)
outbox = {}
as(solex, function() advance(solex.GC.Comm.REPLY_WAIT) end)
eq(queued, "Quick-Sargeras,Old-Sargeras", "refresh: both stale again: both inspected")
solex.CRT.Gear:Remember("Old-Sargeras", { { slot = 1, id = 5 } }, "lootmaster")
advance(solex.GC.Comm.STALE)
as(solex, function() solex.GC:Refresh() deliver() advance(solex.GC.Comm.REPLY_WAIT) end)
eq(queued, "Old-Sargeras", "refresh: a part set from another feature is no whole set: inspected")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/Gear.lua', 'CRT_Modules/GearChecker/Data.lua', 'CRT_Modules/GearChecker/Inspect.lua',
  'CRT_Modules/GearChecker/Comm.lua', 'CRT_Modules/LootMaster/Data.lua', 'CRT_Dev/Tests/old_Comm.lua']) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
}
if (lua.lua_pcall(L, 6, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
