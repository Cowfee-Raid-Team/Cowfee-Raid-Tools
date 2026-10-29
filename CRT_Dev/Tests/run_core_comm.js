// The shared send queue (CRT_Core/Comm.lua): the group channel, leader or assistant, the fingerprint Pace has
// always written, the secret check, and Send's queue: messages in order, a wait of a second on the game's
// throttle, the queue dropped with one chat line on an encounter's lockdown, a raised error, another result or a
// left group. Then Pace/Comm.lua on top of it: its share goes through the queue and keeps its own wording.
// Usage: node run_core_comm.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local commSrc, paceSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
time = function() return 1790000000 end
local CLOCK = 100
GetTime = function() return CLOCK end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = CLOCK + s, fn = fn } end }
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
LE_PARTY_CATEGORY_INSTANCE = 2
local grouped, raid, instance = false, false, false
IsInGroup = function(c) if c == 2 then return instance end return grouped end
IsInRaid = function() return raid end
local leaders = {}
UnitIsGroupLeader = function(u) return leaders[u] == "lead" end
UnitIsGroupAssistant = function(u) return leaders[u] == "assist" end
UnitName = function() return "Solex" end
-- every message the game took, and a scripted result per call (0 when the list runs out)
local sent, results = {}, {}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end,
  SendAddonMessage = function(prefix, text, channel)
    local r = table.remove(results, 1) or 0
    if r == "raise" then error("bad argument", 0) end
    if r == 0 then sent[#sent + 1] = text end
    return r
  end }
CreateFrame = function() local f = {} function f:RegisterEvent() end function f:SetScript(_, fn) self.fn = fn end return f end
local secrets = {}
issecretvalue = function(v) return secrets[v] == true end

local CRT = {}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
assert(load(commSrc))("CowfeeRaidTools", CRT)
local Comm = CRT.Comm
check(Comm ~= nil, "CRT.Comm is made")

-- the pieces
eq(Comm.Fingerprint("abc"), "885c8b16f93", "fingerprint: known value")
eq(Comm.Fingerprint(""), "00150500010","fingerprint: empty text")
eq(Comm.Channel(), nil, "channel: solo is nil")
grouped = true
eq(Comm.Channel(), "PARTY", "channel: party")
raid = true
eq(Comm.Channel(), "RAID", "channel: raid")
instance = true
eq(Comm.Channel(), "INSTANCE_CHAT", "channel: a finder group")
instance = false
check(not Comm.IsLeaderOrAssist("player"), "leader: a raider is not")
leaders.player = "assist"
check(Comm.IsLeaderOrAssist("player"), "leader: an assistant is")
leaders.player = "lead"
check(Comm.IsLeaderOrAssist("player") == true, "leader: the leader is, as true")
check(not Comm.Readable(nil), "readable: nil is not")
check(Comm.Readable("x") and Comm.Readable(0) and Comm.Readable(false), "readable: plain values are")
secrets.hidden = true
check(not Comm.Readable("hidden"), "readable: a secret is not")

-- Send
check(Comm:Send("P", { "a", "b" }, "the test"), "send: two messages go")
eq(#sent, 2, "send: both sent")
eq(sent[1] .. sent[2], "ab", "send: in order")
results = { 3, 0 } -- throttled once, then success
check(Comm:Send("P", { "c" }, "the test"), "send: a throttled message waits, so it isn't dropped")
eq(#sent, 2, "send: held by the throttle")
check(Comm:Send("P", { "c2" }, "the test"), "send: a message behind a throttled one waits too")
eq(#sent, 2, "send: and is not sent ahead of it")
advance(1)
eq(sent[3], "c", "send: retried after the throttle")
eq(sent[4], "c2", "send: then the one behind it")
results = { 11 }
local before = #printed
eq(Comm:Send("P", { "d", "e" }, "the test"), false, "send: lockdown drops the queue")
eq(#sent, 4, "send: nothing of it went")
eq(printed[#printed], "The test can't be shared during an encounter. Share again after the pull ends.", "send: lockdown message")
results = { "raise" }
eq(Comm:Send("P", { "f" }, "the test"), false, "send: a raised error drops it")
eq(printed[#printed], "Sharing the test failed: bad argument", "send: the error's line")
results = { 9 }
eq(Comm:Send("P", { "g" }, "the test"), false, "send: another result drops it")
eq(printed[#printed], "Sharing the test failed with result 9.", "send: that result's line")
grouped, raid = false, false
eq(Comm:Send("P", { "h" }, "the test"), false, "send: out of a group drops it")
eq(printed[#printed], "Sharing stopped: you left the group.", "send: the left group's line")
grouped, raid = true, true
-- a throttled queue whose group goes before the retry
results = { 3 }
Comm:Send("P", { "i" }, "the test")
grouped, raid = false, false
advance(1)
eq(printed[#printed], "Sharing stopped: you left the group.", "send: left the group while throttled")
grouped, raid = true, true
check(Comm:Send("P", { "j" }, "the test") and sent[#sent] == "j", "send: works again after a drop")
check(Comm:Send("P", { "k" }, { what = "the plan", locked = "Plans" }) and sent[#sent] == "k", "send: what as a table")
results = { 11 }
Comm:Send("P", { "l" }, { what = "the plan", locked = "Plans" })
eq(printed[#printed], "Plans can't be shared during an encounter. Share again after the pull ends.", "send: the table's own lockdown wording")

-- a drop says so for every module whose messages it drops, once each
results = { 3, 11 }
Comm:Send("P", { "m1", "m2" }, "the first thing")
Comm:Send("Q", { "n1" }, { what = "the plan", locked = "Plans" })
Comm:Send("P", { "m3" }, "the first thing")
local before2 = #printed
advance(1)
eq(#printed - before2, 2, "drop: one line per module dropped")
eq(printed[before2 + 1], "The first thing can't be shared during an encounter. Share again after the pull ends.", "drop: the first module's line")
eq(printed[before2 + 2], "Plans can't be shared during an encounter. Share again after the pull ends.", "drop: the second module's line")
check(Comm:Send("P", { "o" }, "the test") and sent[#sent] == "o", "drop: the queue works after it")

-- Pace on top: its share goes through the queue, with its own lines
CRT.Pace = { Export = function() return "mode phase\\n1 30 boss1 72" end, BossName = function() return "Boss" end }
assert(load(paceSrc))("CowfeeRaidTools", CRT)
local PC = CRT.PaceComm
leaders.player = "lead"
local n = #sent
eq(PC:Share({ 3129 }), 1, "pace: one plan shared")
local text = "mode phase;1 30 boss1 72"
eq(sent[n + 1], "3129|" .. Comm.Fingerprint(text) .. "|1|1|" .. text, "pace: the message as before")
results = { 11 }
PC:Share({ 3129 })
check(table.concat(printed, "\\n"):find("Pace plans can't be shared during an encounter. Share again after the pull ends.", 1, true), "pace: its lockdown line kept")
leaders.player = nil
local ok, why = PC:CanShare()
check(not ok and why == "Only the raid leader or an assistant can share pace plans.", "pace: CanShare's reason kept")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/Comm.lua', 'CRT_Modules/Pace/Comm.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
