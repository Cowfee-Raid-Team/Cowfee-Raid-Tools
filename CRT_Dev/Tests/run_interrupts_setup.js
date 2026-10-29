// Interrupts' kick setups (CRT_Modules/Interrupts/Setup.lua), pure functions with no game calls: a block of setups
// per difficulty, the groups (keys, labels, raid markers, slots), timed and untimed setups, what doesn't read, the
// shape a share carries and a setup made from it, new group keys, marker icons, and The Coiled Altar's shipped
// block (Mythic: Skull and Cross groups of four; Heroic: one Skull group; untimed; no guessed spell ID).
// Usage: node run_interrupts_setup.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local latticeSrc, setupSrc, altarSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local function copy(t) if type(t) ~= "table" then return t end local o = {} for k, v in pairs(t) do o[k] = copy(v) end return o end

local CRT = {}
assert(load(latticeSrc))("CowfeeRaidTools", CRT)
assert(load(setupSrc))("CowfeeRaidTools", CRT)
local S = CRT.InterruptSetup
check(S ~= nil, "CRT.InterruptSetup is made")

local TIMING = { anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33 } }, firstCast = 4.5, spacing = 1, tolerance = 0.3,
  adds = 10, perNumber = 2, window = 25 }
local BLOCK = {
  { difficulty = 16, spell = { name = "Wail", spellID = 1234 }, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 },
    { key = "cross", label = "Cross add", marker = 7, slots = 3 } } },
  { difficulty = 15, label = "Stop", groups = { { key = "left", label = "Left", slots = 5 }, { key = "right", label = "Right", slots = 5 } }, timing = TIMING, note = "n" },
}
local list, why = S.Read(BLOCK)
check(list ~= nil, "read: a block of two setups " .. tostring(why))
eq(#list, 2, "read: two setups, in order")
local m, h = list[1], list[2]
eq(m.difficulty, 16, "read: the difficulty")
eq(m.label, "Kick", "read: Kick when no label is given")
eq(h.label, "Stop", "read: the label given")
eq(m.spell.name .. "/" .. m.spell.spellID, "Wail/1234", "read: the spell")
eq(h.spell, nil, "read: no spell is fine")
eq(m.timing, nil, "read: untimed without timing")
check(h.timing and h.timing.adds == 10 and h.timing ~= TIMING, "read: the timing, a copy")
eq(m.groups[1].marker, 8, "read: a group's marker"); eq(h.groups[1].marker, nil, "read: no marker")
eq(S.Total(m), 7, "total: every slot"); eq(S.MaxSlots(m), 4, "max slots: the longest group")
check(m.groups ~= BLOCK[1].groups and m.groups[1] ~= BLOCK[1].groups[1], "read: copies")
eq(select(1, S.GroupOfMarker(m, 7)), 2, "marker: Cross is the second group")
eq(S.GroupOfMarker(m, 1), nil, "marker: no group has Star")
eq(S.GroupOfMarker(m, "8"), nil, "marker: only a number")
eq(h.note, "n", "read: the note")

-- what doesn't read
local function bad(mut, what) local b = copy(BLOCK) mut(b) check(S.Read(b) == nil, "refused: " .. what) end
bad(function(b) b[2].difficulty = 16 end, "two setups for one difficulty")
bad(function(b) b[1].difficulty = "16" end, "a difficulty that isn't a number")
bad(function(b) b[1].groups = {} end, "no groups")
bad(function(b) b[1].groups[2].key = "skull" end, "two groups with one key")
bad(function(b) b[1].groups[2].key = "2x" end, "a key starting with a digit")
bad(function(b) b[1].groups[2].key = "a b" end, "a key with a space")
bad(function(b) b[1].groups[2].marker = 8 end, "two groups with one marker")
bad(function(b) b[1].groups[2].marker = 9 end, "a marker past 8")
bad(function(b) b[1].groups[2].slots = 0 end, "no slots")
bad(function(b) b[1].groups[2].slots = S.MAX_SLOTS + 1 end, "too many slots")
bad(function(b) b[1].groups[2].label = "A|B" end, "a label with a bar")
bad(function(b) b[1].groups[2].label = "" end, "an empty label")
bad(function(b) b[1].spell = { spellID = -3 } end, "a bad spell ID")
bad(function(b) b[2].timing.adds = 11 end, "timing with more adds than numbers")
bad(function(b) b[2].timing.anchor = nil end, "timing without an anchor")
bad(function(b) local g = {} for i = 1, S.MAX_GROUPS + 1 do g[i] = { key = "g" .. i, label = "G" .. i, slots = 1 } end b[1].groups = g end, "too many groups")
check(S.Read({}) == nil and S.Read(nil) == nil, "refused: no block")
check(select(2, S.Read({ { difficulty = 16 } })) ~= nil, "refused: with a reason")
check(S.Read({ { difficulty = 16, groups = { { key = "a", label = "A", slots = S.MAX_SLOTS } } } }) ~= nil, "read: as many slots as allowed")

-- shapes
local shape = S.Shape(m)
eq(shape, "skull:8:4:Skull add/cross:7:3:Cross add", "shape: key, marker, slots and label per group")
eq(S.Shape(h), "left:0:5:Left/right:0:5:Right", "shape: marker 0 for none")
local back = S.ParseShape(shape)
eq(back and #back, 2, "shape: read back")
eq(back and back[2].key .. back[2].marker .. back[2].slots .. back[2].label, "cross73Cross add", "shape: every field")
eq(S.ParseShape("left:0:5:Left")[1].marker, nil, "shape: 0 is no marker")
check(S.ParseShape("") == nil and S.ParseShape("a:b:c") == nil and S.ParseShape(nil) == nil, "shape: what doesn't read")
check(S.ParseShape("a:0:5:A/a:0:5:B") == nil, "shape: one key twice refused")
local made = S.FromShape(16, shape, "Kick")
check(made and made.difficulty == 16 and #made.groups == 2 and made.timing == nil, "from shape: an untimed setup")
eq(made and made.groups[1].label, "Skull add", "from shape: its labels")
eq(S.FromShape(16, "nonsense"), nil, "from shape: nothing from a bad shape")
eq(S.CleanLabel("  a:b/c|d, e  "), "a b c d e", "clean label: the share's separators taken out")

-- keys for new groups, and the marker icon
eq(S.KeyFor("Skull add"), "skull_add", "key: from the label")
eq(S.KeyFor("Skull add", { skull_add = true }), "skull_add2", "key: not one taken")
eq(S.KeyFor("1st"), "group1st", "key: starts with a letter")
check(S.ValidKey(S.KeyFor(string.rep("long", 10))), "key: short enough")
eq(S.MarkerIcon(8, 14), "|TInterface\\\\TargetingFrame\\\\UI-RaidTargetingIcon_8:14|t", "icon: the game's raid target icon")
eq(S.MarkerIcon(nil), "", "icon: none")

-- The Coiled Altar ships its block
local shipped
CRT.Bosses = { Register = function(_, d) shipped = d end }
assert(load(altarSrc))("CowfeeRaidTools", CRT)
local altar, err = S.Read(shipped and shipped.interrupts)
check(altar ~= nil, "coiled altar: the block reads " .. tostring(err))
if altar then
  eq(#altar, 2, "coiled altar: Mythic and Heroic")
  local my, he = altar[1], altar[2]
  eq(my.difficulty, 16, "coiled altar: Mythic first"); eq(he.difficulty, 15, "coiled altar: then Heroic")
  eq(S.Shape(my), "skull:8:4:Skull add/cross:7:4:Cross add", "coiled altar: Mythic, Skull and Cross adds of four")
  eq(S.Shape(he), "skull:8:4:Skull add", "coiled altar: Heroic, one Skull add of four")
  check(my.timing == nil and he.timing == nil, "coiled altar: untimed")
  eq(my.spell and my.spell.name, "Wail of Terror", "coiled altar: Wail of Terror")
  eq(my.spell and my.spell.spellID, nil, "coiled altar: no guessed spell ID")
end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const FILES = ['CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Setup.lua', 'CRT_Data/Seasons/Midnight-S2/TheCoiledAltar.lua'];
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
