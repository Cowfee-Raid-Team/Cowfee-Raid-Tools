// Sharing the kick list (CRT_Modules/Interrupts/Comm.lua): two CRTs in one raid, each its own copy of the files,
// every message handed to the other. The message's head, a round trip, a damaged hash, a higher major version
// skipped and a later minor one read, a name with a comma, a list over 255 bytes, who may share and why not (out
// of a group, not leader or assistant, empty slots, a boss fight), a leader's list taken and its chat line, a
// raider's refused, your own message, a secret message or sender dropped before any pattern, the module off and
// Accept lists off. Then version 1.1: the difficulty, shape and label on every part, names read by group key (another
// order of groups), a 1.0 message from an older CRT read in order, a shape that doesn't fit dropped, and a raider
// with no setup for that boss taking the shape as its setup. Usage: node run_interrupts_comm.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, setupSrc, dataSrc, kickSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
local clock = 100
GetTime = function() return clock end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
C_Timer = { After = function() end }
local secrets = {}
issecretvalue = function(v) return secrets[v] == true end
local ME = "Brenn"
UnitName = function(u) if u == "player" then return ME end end
local leader = "Brenn"
UnitIsGroupLeader = function(u) return (u == "player" and ME == leader) or u == leader end
UnitIsGroupAssistant = function() return false end
local grouped = true
LE_PARTY_CATEGORY_INSTANCE = 2
IsInGroup = function(c) return grouped and c ~= 2 end
IsInRaid = function() return grouped end
local inCombat = false
C_InstanceEncounter = { IsEncounterInProgress = function() return inCombat end }
local outbox = {}
local prefixes = {}
C_ChatInfo = { RegisterAddonMessagePrefix = function(p) prefixes[p] = true end,
  SendAddonMessage = function(prefix, text, channel) outbox[#outbox + 1] = { prefix = prefix, text = text, channel = channel, from = ME } return 0 end }
local handlers
CreateFrame = function()
  local f = { events = {} }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  function f:SetScript(_, fn) self.fn = fn end
  handlers[#handlers + 1] = f
  return f
end

local RAW = { { difficulty = 16, label = "Kick", groups = { { key = "left", label = "Left", slots = 5 }, { key = "right", label = "Right", slots = 5 } },
  timing = { anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25 } } }
local function copy(t) if type(t) ~= "table" then return t end local o = {} for k, v in pairs(t) do o[k] = copy(v) end return o end
local function boot(name)
  handlers = {}
  local CRT = { db = { interrupts = { enabled = true, own = {}, shared = {}, use = {}, accept = true, test = false, plates = {}, reminder = {} } } }
  local printed = {}
  function CRT:Print(m) printed[#printed + 1] = m end
  for _, src in ipairs({ registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, setupSrc, dataSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
  CRT.Bosses:Get(3470).interrupts = copy(RAW)
  assert(load(kickSrc))("CowfeeRaidTools", CRT)
  return { name = name, CRT = CRT, I = CRT.Interrupts, C = CRT.InterruptComm, on = handlers, printed = printed }
end
local A, B = boot("Brenn"), boot("Solex")
local function as(p, fn) local prev = ME ME = p.name local r = { fn() } ME = prev return table.unpack(r) end
-- handed to every frame of that CRT listening to CHAT_MSG_ADDON now
local function deliver(p, msg, sender) as(p, function() for _, f in ipairs(p.on) do if f.events.CHAT_MSG_ADDON and f.fn then f.fn(f, "CHAT_MSG_ADDON", A.C.PREFIX, msg, "RAID", sender) end end end) end
local received = 0
B.I:OnChange(function(what) if what == "list" then received = received + 1 end end)
local C, IB = A.C, B.I
check(C ~= nil, "CRT.InterruptComm is made")
eq(C.PREFIX, "CRTKick1", "the prefix")
check(#C.PREFIX <= 16, "the prefix fits the game's 16 characters")
check(prefixes.CRTKick1, "the prefix is registered")
eq(C.VERSION, "1.1", "message version 1.1")
local id = 3470
local def = A.I:Def(id)

local function full(over)
  local l = { {}, {} }
  local n = 0
  for g = 1, 2 do for s = 1, 5 do n = n + 1 l[g][s] = "Player" .. n end end
  for k, v in pairs(over or {}) do l[v[1]][v[2]] = k end
  return l
end
local FULL = full({ Solex = { 2, 4 } })
local msgs = assert(C.Encode(id, def, FULL))
eq(#msgs, 1, "encode: ten short names are one message")
local msg = msgs[1]
check(msg:find("^L|1%.1|" .. id .. "|%x+|1|1|") ~= nil, "encode: head " .. msg)
check(msg:find("|Player1,Player2,Player3,Player4,Player5,Player6,Player7,Player8,Solex,Player10|", 1, true) ~= nil, "encode: names in group then slot order")
check(msg:find("|16|left:0:5:Left/right:0:5:Right|Kick$") ~= nil, "encode: then the difficulty, the shape and the label")
local gotId, list = C.Decode(msgs, def)
eq(gotId, id, "decode: id"); eq(list and list[2][5], FULL[2][5], "decode: last name")
eq(list and list[2][4], "Solex", "decode: Solex at Right 4")
local _, why0 = C.Decode({ (msg:gsub("Player10|", "Player1|")) }, def)
eq(why0, "damaged", "decode: a damaged list refused as damaged")
check(C.Decode({ "L|2|" .. id .. "|00|1|1|a" }, def) == nil, "decode: higher major version skipped")
local names = msg:match("^L|1%.1|%d+|%x+|1|1|([^|]*)|")
local hash = msg:match("^L|1%.1|%d+|(%x+)|")
local later = "L|1.3|" .. id .. "|" .. hash .. "|1|1|" .. names .. "|a field for later"
eq(select(1, C.Decode({ later }, def)), id, "decode: a later minor version is read, its extra field left")
check(C.Decode({ "X|1|" .. id .. "|" .. hash .. "|1|1|" .. names }, def) == nil, "decode: another kind skipped")
local _, whyShape = C.Decode({ "L|1|" .. id .. "|" .. A.CRT.Comm.Fingerprint("a,b") .. "|1|1|a,b" }, def)
eq(whyShape, "shape", "decode: the wrong number of names refused, quietly")
local empty = full(); empty[1][2] = ""
local _, back = C.Decode(assert(C.Encode(id, def, empty)), def)
eq(back and back[1][2], "", "decode: an empty slot stays empty")
check(C.Encode(id, def, full({ ["Bad,Name"] = { 1, 1 } })) == nil, "encode: comma refused")
check(select(2, C.Encode(id, def, full({ ["Bad|Name"] = { 1, 1 } }))) == "A name holds a comma or a bar.", "encode: bar refused with the reason")
-- long names: split in parts of 255 bytes or less, as Pace's plans are, and whole again in any order
local LONG = full()
for g = 1, 2 do for s = 1, 5 do LONG[g][s] = string.rep("x", 24) .. g .. s end end
local long = assert(C.Encode(id, def, LONG))
check(#long > 1, "encode: a long list goes in parts (" .. #long .. ")")
for _, m in ipairs(long) do check(#m <= 255, "encode: each part 255 bytes or less (" .. #m .. ")") end
local backwards = {}
for i = #long, 1, -1 do backwards[#backwards + 1] = long[i] end
local _, longBack = C.Decode(backwards, def)
eq(longBack and longBack[2][5], LONG[2][5], "decode: the parts make the list again, in any order")
check(C.Decode({ long[1] }, def) == nil, "decode: half a list is no list")

-- who may share
for g = 1, 2 do for s = 1, 5 do as(A, function() A.I:SetName(id, g, s, FULL[g][s]) end) end end
check(as(A, function() return C:CanShare(id) end), "share: the leader with a full list")
grouped = false
local ok, why = as(A, function() return C:CanShare(id) end)
check(not ok and why:find("in a group", 1, true), "share: refused out of a group: " .. tostring(why))
grouped = true
ok, why = as(B, function() return B.C:CanShare(id) end)
check(not ok and why:find("raid leader or an assistant", 1, true), "share: refused for a raider: " .. tostring(why))
as(A, function() A.I:SetName(id, 1, 5, "") end) -- the last slot: your own list keeps no gap, so an empty slot is at its end
ok, why = as(A, function() return C:CanShare(id) end)
check(not ok and why:find("all 10", 1, true), "share: refused with an empty slot: " .. tostring(why))
as(A, function() A.I:SetName(id, 1, 5, FULL[1][5]) end)
inCombat = true; eq(select(1, as(A, function() return C:CanShare(id) end)), false, "share: refused in an encounter")
check(select(2, as(A, function() return C:CanShare(id) end)):find("boss fight", 1, true), "share: its reason")
eq(as(A, function() return C:Share(id) end), false, "share: Share refuses too")
eq(#outbox, 0, "share: nothing sent")
inCombat = false

-- a leader's share reaches the raider
eq(as(A, function() return C:Share(id) end), true, "share: sent")
eq(#outbox, 1, "share: one message")
eq(outbox[1].prefix, "CRTKick1", "share: under the prefix")
eq(outbox[1].text, msg, "share: your own list")
outbox = {}
as(A, function() for g = 1, 2 do for s = 1, 5 do A.I:SetName(id, g, s, LONG[g][s]) end end end)
eq(as(A, function() return C:Share(id) end), true, "share: a long list is sent")
eq(#outbox, #long, "share: in its parts")
for _, m in ipairs(outbox) do deliver(B, m.text, "Brenn") end
eq(IB:Shared(id) and IB:Shared(id).list[2][5], LONG[2][5], "receive: a list in parts")
received = 0
B.CRT.db.interrupts.kicks[id][16].shared = nil
outbox = { { text = msg } }
deliver(B, outbox[1].text, "Brenn-Illidan")
eq(select(2, IB:List(id)), "raid", "receive: accepted from the leader")
eq(as(B, function() return (IB:Mine(id)) end), 4, "receive: your number")
eq(as(B, function() return select(2, IB:Mine(id)) end), "Right", "receive: your side")
eq(received, 1, "receive: one change")
eq(IB:Shared(id).from, "Brenn", "receive: the sender without realm")
eq(B.printed[#B.printed], "Brenn shared the kick list for Nek'zali the Soulcoiler. Your kick: #4 Right.", "receive: the chat line")
deliver(A, outbox[1].text, "Brenn")
eq(A.I:Shared(id), nil, "receive: your own message is skipped")
deliver(B, msg, "Nobody"); eq(received, 1, "receive: not from a non-leader")
local hidden = setmetatable({}, { __index = function() error("a secret was read") end })
secrets[hidden] = true
deliver(B, hidden, "Brenn-Illidan"); eq(received, 1, "comm: secret values dropped")
local who = setmetatable({}, { __index = function() error("a secret sender was read") end })
secrets[who] = true
deliver(B, msg, who); eq(received, 1, "comm: a secret sender dropped")
local damaged = msg:gsub("Player1,", "Player9,")
deliver(B, damaged, "Brenn"); eq(received, 1, "receive: damaged, dropped")
eq(B.printed[#B.printed], "A kick list from Brenn arrived damaged. Ask them to share it again.", "receive: a damaged list says so")
local msg2 = assert(C.Encode(id, def, full()))[1]
local lines = #B.printed
IB:SetEnabled(false); deliver(B, msg2, "Brenn-Illidan"); eq(received, 1, "receive: module off ignores")
as(B, function() B.C:Receive(damaged, "Brenn") end)
eq(#B.printed, lines, "receive: module off reads nothing, not even to say it's damaged")
IB:SetEnabled(true)
IB:Settings().accept = false; deliver(B, msg2, "Brenn-Illidan"); eq(received, 1, "receive: accept off ignores")
deliver(B, damaged, "Brenn"); eq(#B.printed, lines, "receive: accept off reads nothing")
IB:Settings().accept = true
eq(as(B, function() return (IB:Mine(id)) end), 4, "receive: your number kept through the ignored ones")
deliver(B, msg2, "Brenn-Illidan")
eq(received, 2, "receive: a new list")
eq(as(B, function() return (IB:Mine(id)) end), nil, "receive: off the new list, no number")
eq(B.printed[#B.printed], "Brenn shared the kick list for Nek'zali the Soulcoiler. You are not on it.", "receive: the not-on-it line")
lines = #B.printed
deliver(B, "L|1|9999|" .. hash .. "|1|1|" .. names, "Brenn")
eq(received, 2, "receive: a boss without a block is skipped")
eq(#B.printed, lines, "receive: quietly")
deliver(B, "L|1|" .. id .. "|" .. A.CRT.Comm.Fingerprint("a,b") .. "|1|1|a,b", "Brenn")
eq(#B.printed, lines, "receive: another slot shape, quietly")

-- parts duplicated and out of order make one list, once
do
  local parts = assert(C.Encode(id, def, LONG))
  check(#parts >= 2, "parts: the long list has " .. #parts .. " parts")
  local before = received
  local order = {}
  for i = #parts, 1, -1 do order[#order + 1] = parts[i] order[#order + 1] = parts[i] end
  for _, m in ipairs(order) do as(B, function() B.C:Receive(m, "Brenn") end) end
  eq(received, before + 1, "parts: duplicated and out of order, taken once")
  eq(IB:Shared(id).list[2][5], LONG[2][5], "parts: the whole list")
  eq(B.C.Pending(), 0, "parts: nothing left waiting")

  as(B, function() B.C:Receive(parts[1], "Brenn") end)
  eq(received, before + 1, "parts: a late copy of a part is ignored")
  clock = clock + B.C.PARTS_TIMEOUT + 1 -- (the same list shared again later is a new share)
  -- half a list is forgotten on a zone change
  as(B, function() B.C:Receive(parts[1], "Brenn") end)
  eq(B.C.Pending(), 1, "half: one list waiting")
  as(B, function() for _, f in ipairs(B.on) do if f.events.PLAYER_ENTERING_WORLD and f.fn then f.fn(f, "PLAYER_ENTERING_WORLD") end end end)
  eq(B.C.Pending(), 0, "half: a zone change forgets it")
  before = received
  for i = 2, #parts do as(B, function() B.C:Receive(parts[i], "Brenn") end) end
  eq(received, before, "half: the rest alone makes no list")
  eq(B.C.Pending(), 1, "half: (the rest waits)")
  -- and after PARTS_TIMEOUT seconds
  check(B.C.PARTS_TIMEOUT and B.C.PARTS_TIMEOUT >= 20 and B.C.PARTS_TIMEOUT <= 60, "half: a named timeout (" .. tostring(B.C.PARTS_TIMEOUT) .. ")")
  clock = clock + B.C.PARTS_TIMEOUT + 1
  as(B, function() B.C:Receive(parts[#parts], "Brenn") end)
  eq(B.C.Pending(), 1, "half: an old half list is dropped when the next part comes (only the new one waits)")
  as(B, function() B.C:Receive(parts[1], "Brenn") end)
  if #parts > 2 then eq(received, before, "half: and the old parts don't complete it") end
end

-- version 1.1: the setup's shape
clock = clock + 100
do
  -- a 1.0 message from an older CRT: no difficulty, no shape, read in order into the setup with as many slots
  local old = "L|1|" .. id .. "|" .. hash .. "|1|1|" .. names
  local before = received
  as(B, function() B.C:Receive(old, "Brenn") end)
  eq(received, before + 1, "1.0: an older CRT's list is read")
  eq(IB:Shared("3470:16").list[2][4], "Solex", "1.0: in order, into the Mythic setup")
  local p = C.Parse(old)
  check(p and p.difficulty == nil and p.shape == nil, "1.0: no difficulty or shape parsed")
  p = C.Parse(msg)
  eq(p and p.difficulty, 16, "parse: the difficulty"); eq(p and p.shape, "left:0:5:Left/right:0:5:Right", "parse: the shape"); eq(p and p.label, "Kick", "parse: the label")
end
-- the same groups in another order here: read by key
do
  local mine = B.CRT.Bosses:Get(3470).interrupts[1]
  mine.groups = { mine.groups[2], mine.groups[1] }
  IB:ClearCache()
  local before = received
  local fresh = assert(C.Encode(id, def, full({ Solex = { 1, 2 } })))
  as(B, function() B.C:Receive(fresh[1], "Brenn") end)
  eq(received, before + 1, "by key: taken")
  eq(IB:Def(id).groups[1].key, "right", "by key: (B's groups are Right, Left)")
  eq(IB:Shared(id).list[2][2], "Solex", "by key: Solex lands in Left, B's second group")
  eq(as(B, function() return select(2, IB:Mine(id)) end), "Left", "by key: B's side is Left")
  mine.groups = { mine.groups[2], mine.groups[1] }
  IB:ClearCache()
end
-- a shape that doesn't fit: a group of another size
do
  local other = copy(RAW[1]); other.groups[2].slots = 4
  local msgs4 = assert(C.Encode(id, A.CRT.InterruptSetup.ReadOne(other), { { "a", "b", "c", "d", "e" }, { "f", "g", "h", "i" } }))
  local before = received
  as(B, function() B.C:Receive(msgs4[1], "Brenn") end)
  eq(received, before, "shape: another number of slots in a group, dropped")
  local _, why = C.Decode(msgs4, IB:Def(id))
  eq(why, "shape", "shape: why")
end
-- a raider with no setup for that boss and difficulty takes the shape
do
  local altar = A.CRT.InterruptSetup.ReadOne({ difficulty = 15, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 },
    { key = "cross", label = "Cross add", marker = 7, slots = 4 } } })
  as(A, function() A.I:SetCustom("3470:15", altar) end)
  check(A.I:IsCustom("3470:15") and IB:Def("3470:15") == nil, "no setup: A has its own Heroic setup, B none")
  local list = { { "P1", "Solex", "P3", "P4" }, { "P5", "P6", "P7", "P8" } }
  for g = 1, 2 do for s = 1, 4 do as(A, function() A.I:SetName("3470:15", g, s, list[g][s]) end) end end
  outbox = {}
  eq(as(A, function() return C:Share("3470:15") end), true, "no setup: shared")
  check(outbox[1] and outbox[1].text:find("|15|skull:8:4:Skull add/cross:7:4:Cross add|Kick", 1, true), "no setup: the message carries the shape")
  local before = received
  deliver(B, outbox[1].text, "Brenn")
  eq(received, before + 1, "no setup: B takes it")
  local d = IB:Def("3470:15")
  check(d and #d.groups == 2 and d.groups[1].marker == 8, "no setup: the shape is B's setup now")
  eq(as(B, function() return (IB:Mine("3470:15")) end), 2, "no setup: B's number")
  eq(B.printed[#B.printed], "Brenn shared the kick list for Nek'zali the Soulcoiler. Your kick: #2 Skull add.", "no setup: the chat line")
  eq(IB:Def("3470:16").groups[1].key, "left", "no setup: the Mythic setup untouched")
end
-- a leader's own setup reaches a raider who has the shipped one (Normal here: Skull add of four on both)
do
  for _, side in ipairs({ A, B }) do
    side.CRT.Bosses:Get(3470).interrupts[2] = { difficulty = 14, spell = { name = "Wail of Terror" },
      groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 } } }
    side.I:ClearCache()
  end
  check(as(A, function() return A.I:SetCustom("3470:14", { groups = { { key = "skull", label = "Skull add", marker = 8, slots = 3 } } }) end), "custom over shipped: A's own three-kicker setup")
  for s, n in ipairs({ "P1", "Solex", "P3" }) do as(A, function() A.I:SetName("3470:14", 1, s, n) end) end
  outbox = {}
  eq(as(A, function() return C:Share("3470:14") end), true, "custom over shipped: shared")
  local before = received
  deliver(B, outbox[1].text, "Brenn")
  eq(received, before + 1, "custom over shipped: B takes it")
  eq(IB:ShippedDef("3470:14").groups[1].slots, 4, "custom over shipped: B has the shipped four")
  eq(IB:Def("3470:14").groups[1].slots, 3, "custom over shipped: the share's shape is B's setup while it is in use")
  eq(IB:Shared("3470:14").list[1][3], "P3", "custom over shipped: the whole list")
  eq(as(B, function() return (IB:Mine("3470:14")) end), 2, "custom over shipped: B's number")
  -- the same setup shared again, a name changed: B keeps the shape
  as(A, function() A.I:SetName("3470:14", 1, 3, "P9") end)
  outbox = {}
  as(A, function() return C:Share("3470:14") end)
  before = received
  deliver(B, outbox[1].text, "Brenn")
  eq(received, before + 1, "re-share: taken")
  eq(IB:Def("3470:14").groups[1].slots, 3, "re-share: the shape kept")
  eq(IB:Shared("3470:14").list[1][3], "P9", "re-share: the new name")
  -- a share for a difficulty no raid share has
  local m17 = outbox[1].text:gsub("|14|skull", "|17|skull")
  before = received
  deliver(B, m17, "Brenn")
  eq(received, before, "difficulty: Looking For Raid's is not taken")
  eq(C.SetupFor(3470, 17, "skull:8:3:Skull add", "Kick", 3), nil, "difficulty: SetupFor refuses it")
end

-- a setup too big for a message's room
do
  local groups = {}
  for i = 1, 8 do groups[i] = { key = "group_number_" .. i, label = "A long group label " .. i, marker = i, slots = 10 } end
  local big = A.CRT.InterruptSetup.ReadOne({ difficulty = 16, groups = groups })
  local m2, why = C.Encode(id, big, {})
  check(m2 == nil and why == C.TEXT.tooBig, "too big: refused with a reason")
end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const FILES = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Comm.lua', 'CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Setup.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/Comm.lua'];
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
