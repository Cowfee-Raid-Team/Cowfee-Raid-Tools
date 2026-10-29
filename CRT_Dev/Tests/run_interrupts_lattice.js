// The Interrupts numbering lattice (CRT_Modules/Interrupts/Lattice.lua), pure functions with no game calls:
// reading a boss's interrupts block, every slot of a wave, both tolerance edges, the adds that cast on the
// whole seconds, slots outside the wave, a pair's offset, and the fallback wave times from the pull. Then the
// block The Twin Fangs ships (CRT_Data/Seasons/Midnight-S2/TheTwinFangs.lua) reads (Interrupts/Setup.lua) and
// matches the spec: Left and Right of five, with its timing.
// Usage: node run_interrupts_lattice.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local latticeSrc, bossSrc, setupSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local function copy(t) if type(t) ~= "table" then return t end local o = {} for k, v in pairs(t) do o[k] = copy(v) end return o end

local CRT = {}
assert(load(latticeSrc))("CowfeeRaidTools", CRT)
assert(load(setupSrc))("CowfeeRaidTools", CRT)
local Lattice = CRT.InterruptLattice
check(Lattice ~= nil, "CRT.InterruptLattice is made")

local RAW = { anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25 }
local def = assert(Lattice.Read(RAW, 5))
check(def ~= RAW and def.anchor ~= RAW.anchor, "read: a copy, not the block itself")
eq(def.anchor.times[6], 404, "read: the fallback times kept")

-- every add of a wave, in pairs
for i = 1, 10 do
  eq(Lattice.Number(def, 100, 104.5 + (i - 1)), math.ceil(i / 2), "number: add " .. i)
end
eq(Lattice.Number(def, 100, 104.5), 1, "number: add 1")
eq(Lattice.Number(def, 100, 105.5), 1, "number: add 2 is pair 1")
eq(Lattice.Number(def, 100, 113.5), 5, "number: add 10 is pair 5")
eq(Lattice.Number(def, 100, 114.5), nil, "number: add 11 is outside the wave")
eq(Lattice.Number(def, 100, 104.8), 1, "number: tolerance edges, 0.30 accepted")
eq(Lattice.Number(def, 100, 104.2), 1, "number: tolerance edges, 0.30 early accepted")
eq(Lattice.Number(def, 100, 104.81), nil, "number: tolerance edges, 0.31 rejected")
eq(Lattice.Number(def, 100, 104.19), nil, "number: tolerance edges, 0.31 early rejected")
eq(Lattice.Number(def, 100, 105.0), nil, "number: the whole-second offset is rejected")
for s = 5, 14 do
  eq(Lattice.Number(def, 100, 100 + s), nil, "number: a whole-second cast at +" .. s .. " is rejected")
end
for i = 0, 9 do eq(Lattice.SlotNumber(def, i), math.floor(i / 2) + 1, "slot number: slot " .. i) end
eq(Lattice.Number(def, 100, 103.9), nil, "number: before the first cast")
eq(Lattice.SlotNumber(def, 10), nil, "slot number: past the wave's adds")
eq(Lattice.Number(def, 100, 104.6), 1, "number: 0.1 s of jitter")
eq(Lattice.Number(def, 100, "x"), nil, "number: not a number")
eq(Lattice.Number(nil, 100, 104.5), nil, "number: no block")
eq(Lattice.PairOffset(def, 1), 4.5, "pair offset: pair 1")
eq(Lattice.PairOffset(def, 3), 8.5, "pair offset: pair 3")
eq(Lattice.PairOffset(def, 5), 12.5, "pair offset: pair 5")
eq(Lattice.Fallback(def, 1000, 1040), 1033, "fallback: wave 1")
eq(Lattice.Fallback(def, 1000, 1033), 1033, "fallback: the anchor itself")
eq(Lattice.Fallback(def, 1000, 1032), nil, "fallback: before wave 1")
eq(Lattice.Fallback(def, 1000, 1060), nil, "fallback: between waves")
eq(Lattice.Fallback(def, 1000, 1094 + 24.9), 1094, "fallback: inside the window")
eq(Lattice.Fallback(def, 1000, 1094 + 25), nil, "fallback: the window's end")
eq(Lattice.Fallback(def, 1000, 1410), 1404, "fallback: wave 6")
eq(Lattice.Fallback(def, nil, 1410), nil, "fallback: no pull time")

-- blocks that don't read
check(Lattice.Read({}) == nil, "read: empty block rejected")
check(Lattice.Read(nil) == nil, "read: no block rejected")
check(select(2, Lattice.Read({})) ~= nil, "read: with a reason")
local bad = copy(RAW); bad.adds = 12
check(Lattice.Read(bad, 5) == nil, "read: more adds than numbers rejected")
check(Lattice.Read(bad) ~= nil, "read: with no number count given, any adds")
bad = copy(RAW); bad.anchor.times = {}
check(Lattice.Read(bad) == nil, "read: no fallback times rejected")
bad = copy(RAW); bad.spacing = 0
check(Lattice.Read(bad) == nil, "read: no spacing rejected")
bad = copy(RAW); bad.anchor.ordinal = 8
check(Lattice.Read(bad) == nil, "read: an ordinal past the cycle rejected")
bad = copy(RAW); bad.perNumber = 2.5
check(Lattice.Read(bad) == nil, "read: a part number rejected")
check(Lattice.MAX_GROUPS == nil and Lattice.MAX_SLOTS == nil, "read: no page cap any more (the page scrolls)")

-- the shipped block
local shipped
CRT.Bosses = { Register = function(_, d) shipped = d end }
assert(load(bossSrc))("CowfeeRaidTools", CRT)
check(shipped and shipped.interrupts ~= nil, "twin fangs: ships an interrupts block")
local setups, why = CRT.InterruptSetup.Read(shipped and shipped.interrupts)
check(setups ~= nil, "twin fangs: the block reads " .. tostring(why))
eq(setups and #setups, 1, "twin fangs: one setup, Mythic only")
local s1 = setups and setups[1]
local tf = s1 and s1.timing
check(tf ~= nil, "twin fangs: timed")
if tf then
  eq(s1.difficulty, 16, "twin fangs: Mythic"); eq(s1.label, "Kick", "twin fangs: Kick")
  eq(#s1.groups, 2, "twin fangs: two groups")
  eq(s1.groups[1].key .. "," .. s1.groups[2].key, "left,right", "twin fangs: group keys")
  eq(s1.groups[1].slots .. "," .. s1.groups[2].slots, "5,5", "twin fangs: five slots each")
  eq(s1.groups[1].marker, nil, "twin fangs: no markers")
  for k, v in pairs({ firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25 }) do
    eq(tf[k], v, "twin fangs: " .. k)
  end
  eq(tf.anchor.unit, "boss2", "twin fangs: anchor unit")
  eq(tf.anchor.cycle, 7, "twin fangs: anchor cycle")
  eq(tf.anchor.ordinal, 5, "twin fangs: anchor ordinal")
  eq(table.concat(tf.anchor.times, ","), "33,94,188,249,343,404", "twin fangs: fallback times")
  eq(s1.groups[1].label .. "," .. s1.groups[2].label, "Left,Right", "twin fangs: groups")
end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Interrupts/Lattice.lua', 'CRT_Data/Seasons/Midnight-S2/TheTwinFangs.lua', 'CRT_Modules/Interrupts/Setup.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
