// Sharing the kick list (CRT_Modules/Interrupts/Comm.lua): two CRTs in one raid, each its own copy of the files,
// every message handed to the other. The message's head, a round trip, a damaged hash, a higher major version
// skipped and a later minor one read, a name with a comma, a list over 255 bytes, who may share and why not (out
// of a group, not leader or assistant, empty slots, a boss fight), a leader's list taken and its chat line, a
// raider's refused, your own message, a secret message or sender dropped before any pattern, the module off and
// Accept lists off. Usage: node run_interrupts_comm.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, dataSrc, kickSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
GetTime = function() return 100 end
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

local RAW = { difficulty = 16, anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25,
  groups = { "Left", "Right" }, slots = 5, label = "Kick" }
local function boot(name)
  handlers = {}
  local CRT = { db = { interrupts = { enabled = true, own = {}, shared = {}, use = {}, accept = true, test = false, plates = {}, reminder = {} } } }
  local printed = {}
  function CRT:Print(m) printed[#printed + 1] = m end
  for _, src in ipairs({ registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, dataSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
  CRT.Bosses:Get(3470).interrupts = RAW
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
eq(C.VERSION, 1, "message version 1")
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
local msg = assert(C.Encode(id, def, FULL))
check(msg:find("^L|1|" .. id .. "|%x+|") ~= nil, "encode: head " .. msg)
check(msg:find("|Player1,Player2,Player3,Player4,Player5,Player6,Player7,Player8,Solex,Player10$") ~= nil, "encode: names in group then slot order")
local gotId, list = C.Decode(msg, def)
eq(gotId, id, "decode: id"); eq(list and list[2][5], FULL[2][5], "decode: last name")
eq(list and list[2][4], "Solex", "decode: Solex at Right 4")
check(C.Decode(msg:sub(1, -3), def) == nil, "decode: damaged hash refused")
check(C.Decode("L|2|" .. id .. "|00|a", def) == nil, "decode: higher major version skipped")
local names = msg:match("^L|1|%d+|%x+|(.*)$")
local hash = msg:match("^L|1|%d+|(%x+)|")
local later = "L|1.3|" .. id .. "|" .. hash .. "|" .. names .. "|a field for later"
eq(select(1, C.Decode(later, def)), id, "decode: a later minor version is read, its extra field left")
check(C.Decode("X|1|" .. id .. "|" .. hash .. "|" .. names, def) == nil, "decode: another kind skipped")
check(C.Decode("L|1|" .. id .. "|" .. A.CRT.Comm.Fingerprint("a,b") .. "|a,b", def) == nil, "decode: the wrong number of names refused")
local empty = full(); empty[1][2] = ""
local withEmpty = assert(C.Encode(id, def, empty))
local _, back = C.Decode(withEmpty, def)
eq(back and back[1][2], "", "decode: an empty slot stays empty")
check(C.Encode(id, def, full({ ["Bad,Name"] = { 1, 1 } })) == nil, "encode: comma refused")
check(select(2, C.Encode(id, def, full({ ["Bad|Name"] = { 1, 1 } }))) == "A name holds a comma or a bar.", "encode: bar refused with the reason")
local LONG = full()
for g = 1, 2 do for s = 1, 5 do LONG[g][s] = string.rep("x", 24) .. g .. s end end
check(C.Encode(id, def, LONG) == nil, "encode: over 255 bytes refused")
eq(select(2, C.Encode(id, def, LONG)), "The list is too long to send; shorten the names.", "encode: its reason")

-- who may share
for g = 1, 2 do for s = 1, 5 do as(A, function() A.I:SetName(id, g, s, FULL[g][s]) end) end end
check(as(A, function() return C:CanShare(id) end), "share: the leader with a full list")
grouped = false
local ok, why = as(A, function() return C:CanShare(id) end)
check(not ok and why:find("in a group", 1, true), "share: refused out of a group: " .. tostring(why))
grouped = true
ok, why = as(B, function() return B.C:CanShare(id) end)
check(not ok and why:find("raid leader or an assistant", 1, true), "share: refused for a raider: " .. tostring(why))
as(A, function() A.I:SetName(id, 1, 1, "") end)
ok, why = as(A, function() return C:CanShare(id) end)
check(not ok and why:find("all 10", 1, true), "share: refused with an empty slot: " .. tostring(why))
as(A, function() A.I:SetName(id, 1, 1, "Player1") end)
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
deliver(B, outbox[1].text, "Brenn-Illidan")
eq(select(2, IB:List(id)), "raid", "receive: accepted from the leader")
eq(as(B, function() return (IB:Mine(id)) end), 4, "receive: your number")
eq(as(B, function() return select(2, IB:Mine(id)) end), "Right", "receive: your side")
eq(received, 1, "receive: one change")
eq(B.CRT.db.interrupts.shared[id].from, "Brenn", "receive: the sender without realm")
eq(B.printed[#B.printed], "Brenn shared the kick list for Nek'zali the Soulcoiler. Your kick: #4 Right.", "receive: the chat line")
deliver(A, outbox[1].text, "Brenn")
eq(A.CRT.db.interrupts.shared[id], nil, "receive: your own message is skipped")
deliver(B, msg, "Nobody"); eq(received, 1, "receive: not from a non-leader")
local hidden = setmetatable({}, { __index = function() error("a secret was read") end })
secrets[hidden] = true
deliver(B, hidden, "Brenn-Illidan"); eq(received, 1, "comm: secret values dropped")
local who = setmetatable({}, { __index = function() error("a secret sender was read") end })
secrets[who] = true
deliver(B, msg, who); eq(received, 1, "comm: a secret sender dropped")
deliver(B, msg:sub(1, -3), "Brenn"); eq(received, 1, "receive: damaged, dropped")
local msg2 = assert(C.Encode(id, def, full()))
IB:SetEnabled(false); deliver(B, msg2, "Brenn-Illidan"); eq(received, 1, "receive: module off ignores"); IB:SetEnabled(true)
IB:Settings().accept = false; deliver(B, msg2, "Brenn-Illidan"); eq(received, 1, "receive: accept off ignores")
IB:Settings().accept = true
eq(as(B, function() return (IB:Mine(id)) end), 4, "receive: your number kept through the ignored ones")
deliver(B, msg2, "Brenn-Illidan")
eq(received, 2, "receive: a new list")
eq(as(B, function() return (IB:Mine(id)) end), nil, "receive: off the new list, no number")
eq(B.printed[#B.printed], "Brenn shared the kick list for Nek'zali the Soulcoiler. You are not on it.", "receive: the not-on-it line")
deliver(B, "L|1|9999|" .. hash .. "|" .. names, "Brenn")
eq(received, 2, "receive: a boss without a block is skipped")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const FILES = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Comm.lua', 'CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/Comm.lua'];
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
