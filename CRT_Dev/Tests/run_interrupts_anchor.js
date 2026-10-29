// Interrupts' wave anchors (CRT_Modules/Interrupts/Anchor.lua) with a mocked clock: arming on a matching pull only
// while the module is on, counting the anchor boss's casts across six waves, other units left out, the fallback
// times from the pull when nothing was counted, the window's end, Test on trash (numbered
// by cast order), another boss's pull leaving test mode alone, a matching pull winning over it, the events registered
// only while armed, a secret payload, and disarming on a zone change or the switch turning off mid-pull.
// Usage: node run_interrupts_anchor.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, setupSrc, dataSrc, anchorSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
local clock = 1000
GetTime = function() return clock end
local frames = {}
CreateFrame = function() local f = { events = {} } function f:RegisterEvent(e) self.events[e] = true end function f:UnregisterEvent(e) self.events[e] = nil end function f:UnregisterAllEvents() self.events = {} end function f:SetScript(_, fn) self.fn = fn end frames[#frames + 1] = f return f end
local function listening(event) for _, f in ipairs(frames) do if f.events[event] then return true end end return false end
UnitName = function() return "Solex" end
local secrets = {}
issecretvalue = function(v) return secrets[v] == true end

local CRT = { db = { interrupts = { enabled = false, own = {}, shared = {}, use = {}, accept = true, test = false,
  plates = {}, reminder = {} } } }
for _, src in ipairs({ registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, setupSrc, dataSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
CRT.Bosses:Get(3470).interrupts = { { difficulty = 16, label = "Kick", groups = { { key = "left", label = "Left", slots = 5 }, { key = "right", label = "Right", slots = 5 } },
  timing = { anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25 } } }
assert(load(anchorSrc))("CowfeeRaidTools", CRT)
local I, A = CRT.Interrupts, CRT.InterruptAnchor
check(A ~= nil, "CRT.InterruptAnchor is made")
local id = 3470
local function H(...) A:HandleEvent(...) end
local waves, arms = {}, {}
A:OnWave(function(wave, at) waves[#waves + 1] = { wave = wave, at = at } end)
A:OnArm(function(on, mode) arms[#arms + 1] = { on = on, mode = mode } end)

check(not listening("ENCOUNTER_START"), "off: no event registered")
H("ENCOUNTER_START", id, "Boss", 16)
check(not A.armed, "arm: off by default means inert")
I:SetEnabled(true)
check(listening("ENCOUNTER_START") and listening("ENCOUNTER_END") and listening("PLAYER_ENTERING_WORLD"), "on: the pull events registered")
check(not listening("UNIT_SPELLCAST_START"), "on: no cast events while disarmed")
H("ENCOUNTER_END"); H("ENCOUNTER_START", id, "Boss", 15)
check(not A.armed, "arm: another difficulty doesn't arm")
H("ENCOUNTER_START", id, "Boss", 16)
check(A.armed and A.pullTime == 1000, "arm: matching pull arms")
eq(A.encounterID, id, "arm: the encounter")
check(A.def and A.def.label == "Kick", "arm: the block")
check(listening("UNIT_SPELLCAST_START"), "arm: the cast events registered")
check(arms[#arms].on and arms[#arms].mode == "pull", "arm: listeners told")
for i = 1, 4 do H("UNIT_SPELLCAST_START", "boss2") end
eq(waves[1], nil, "anchor: four casts no wave")
eq(select(1, A:For(1030)), nil, "for: nothing counted and before the first fallback")
clock = 1033; H("UNIT_SPELLCAST_START", "boss2")
eq(waves[1] and waves[1].at, 1033, "anchor: cast 5 is wave 1")
eq(waves[1] and waves[1].wave, 1, "anchor: wave 1")
local at, lenient = A:For(1037.5)
eq(at, 1033, "for: counted anchor in window"); check(not lenient, "for: a pull is never lenient")
for i = 6, 12 do clock = 1040 + i; H("UNIT_SPELLCAST_START", "boss2") end
eq(waves[2] and waves[2].wave, 2, "anchor: cast 12 is wave 2")
eq(waves[2] and waves[2].at, 1052, "anchor: at cast 12's time")
H("UNIT_SPELLCAST_START", "boss1")
H("UNIT_SPELLCAST_START", "nameplate3")
eq(#waves, 2, "anchor: other units not counted")
secrets.boss2s = true
H("UNIT_SPELLCAST_START", "boss2s")
eq(#waves, 2, "anchor: a secret unit is left alone")
for w = 3, 6 do for i = 1, 7 do clock = clock + 1; H("UNIT_SPELLCAST_START", "boss2") end end
eq(#waves, 6, "anchor: six waves")
eq(waves[6] and waves[6].wave, 6, "anchor: cast 40 is wave 6")
eq(select(1, A:For(clock + 24.9)), clock, "for: inside the window")
check(A:For(clock + 25) ~= clock, "for: past the window, not the counted anchor")
A:Reset(); eq(select(1, A:For(1095)), 1094, "for: fallback from the pull when nothing counted")
eq(A:For(1150), nil, "for: between fallback waves is nil")
H("ENCOUNTER_START", 1234, "Other", 16)
check(not A.armed, "arm: other boss doesn't arm")
check(not listening("UNIT_SPELLCAST_START"), "disarm: the cast events go")

-- Test on trash
CRT.db.interrupts.test = true; A:StartTest()
check(A.armed and A.pullTime == nil, "test: armed without a pull")
check(arms[#arms].mode == "test", "test: listeners told")
H("ENCOUNTER_START", 1234, "Other", 16)
check(A.armed and A.def ~= nil, "anchor: other boss keeps test mode")
check(A.pullTime == nil, "anchor: other boss starts no pull")
clock = 1999; H("UNIT_SPELLCAST_START", "boss2")
eq(#waves, 6, "test: no real anchor counted")
eq(A:For(2000), nil, "test: no time anchor on trash")
local orderNumbers = {}
for i, t in ipairs({ 2000, 2000.2, 2009, 2009.1, 2010 }) do local n, start = A:TestNumber(t) orderNumbers[i] = n .. "@" .. start end
eq(table.concat(orderNumbers, " "), "1@2000 1@2000 2@2000 2@2000 3@2000", "test: numbered by cast order, in the lattice's pairs")
eq(select(1, A:TestNumber(2030)), 1, "test: a new pack after the window starts at 1")
for _ = 1, 9 do A:TestNumber(2031) end
eq(select(1, A:TestNumber(2032)), 1, "test: after a wave's adds, a new pack starts at 1")
H("ENCOUNTER_START", id, "Boss", 16)
check(A.pullTime ~= nil, "arm: matching pull wins over test mode")
check(not select(2, A:For(A.pullTime + 40)), "arm: the pull is not lenient")
H("ENCOUNTER_END", id, "Boss", 16, 20, 0)
check(A.armed and A.pullTime == nil, "end: back to test mode while it is on")
A:StopTest()
check(not A.armed and CRT.db.interrupts.test == false, "test: stopped")

H("ENCOUNTER_START", id, "Boss", 16)
H("PLAYER_ENTERING_WORLD"); check(not A.armed, "disarm: zone change")
CRT.db.interrupts.test = true; A:StartTest()
H("PLAYER_ENTERING_WORLD"); check(not A.armed, "disarm: zone change ends test mode")
eq(CRT.db.interrupts.test, false, "disarm: and unticks it")
secrets[id] = true
H("ENCOUNTER_START", id, "Boss", 16)
check(not A.armed, "arm: a secret encounter ID never arms")
secrets[id] = nil
H("ENCOUNTER_START", id, "Boss", 16); I:SetEnabled(false)
check(not A.armed, "disarm: switching off mid-pull")
check(not listening("ENCOUNTER_START") and not listening("UNIT_SPELLCAST_START"), "off: every event unregistered")
CRT.db.interrupts.test = true; A:StartTest()
check(not A.armed, "test: off means test can't arm")
CRT.db.interrupts.test = false

-- an untimed setup on another difficulty: it arms on its own difficulty, counts nothing, and Test on trash takes the
-- setup it is given
I:SetEnabled(true)
CRT.Bosses:Get(3470).interrupts[2] = { difficulty = 15, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 } } }
I:ClearCache()
H("ENCOUNTER_START", id, "Boss", 15)
check(A.armed and A.mode == "pull", "untimed: a Heroic pull arms its setup")
eq(A.key, "3470:15", "untimed: the setup's key")
eq(A.def and A.def.groups[1].key, "skull", "untimed: the setup")
local before = #waves
for i = 1, 14 do H("UNIT_SPELLCAST_START", "boss2") end
eq(#waves, before, "untimed: no waves counted")
eq(A:For(1040), nil, "untimed: no anchor")
H("ENCOUNTER_END")
H("ENCOUNTER_START", id, "Boss", 16)
eq(A.key, "3470:16", "timed: Mythic still its own setup")
H("ENCOUNTER_END")
CRT.db.interrupts.test = true; A:StartTest("3470:15")
eq(A.key, "3470:15", "test: the setup it is given")
eq(A:TestNumber(5000), nil, "test: an untimed setup numbers no cast order")
A:StopTest()
CRT.db.interrupts.test = true; A:StartTest()
eq(A.key, "3470:15", "test: the last setup given is kept")
A:StopTest()

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const FILES = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Comm.lua', 'CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Setup.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/Anchor.lua'];
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
