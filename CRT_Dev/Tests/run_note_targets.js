// The Raid Notes integrations' note text: the real CRT_Modules/Notes/Parse.lua (the shared class words) and
// CRT_Core/Integrations/NoteTargets.lua, NSRT.lua and MRT.lua, turning a CRT note into each target's text.
// Only the text bridge is checked here; nothing is sent.
// Usage: node run_note_targets.js CRT_Modules/Notes/Parse.lua CRT_Core/Integrations/NoteTargets.lua CRT_Core/Integrations/NSRT.lua CRT_Core/Integrations/MRT.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
function CreateFrame() return { RegisterEvent = function() end, SetScript = function() end } end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
format = string.format
-- the game's classes by class ID, as GetClassInfo gives them on an English client
local CLASSES = { { "Warrior", "WARRIOR" }, { "Paladin", "PALADIN" }, { "Hunter", "HUNTER" }, { "Rogue", "ROGUE" },
  { "Priest", "PRIEST" }, { "Death Knight", "DEATHKNIGHT" }, { "Shaman", "SHAMAN" }, { "Mage", "MAGE" },
  { "Warlock", "WARLOCK" }, { "Monk", "MONK" }, { "Druid", "DRUID" }, { "Demon Hunter", "DEMONHUNTER" }, { "Evoker", "EVOKER" } }
function GetNumClasses() return #CLASSES end
function GetClassInfo(i) local c = CLASSES[i] if c then return c[1], c[2], i end end
local CRT = {}
for i = 1, #sources, 2 do
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
end
local P, NSRT, MRT = CRT.NoteParser, CRT.NSRT, CRT.MRTTarget
assert(P and NSRT and NSRT.ToNSRTText and MRT and MRT.ToMRTText, "modules exist")

local checks = {}
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)); checks.failed = (checks.failed or 0) + 1 end
end
local function lines(text) local out = {} for l in (text .. "\\n"):gmatch("(.-)\\n") do out[#out + 1] = l end return out end
local function same(got, want)
  local g, w = lines(got), lines(want)
  for i = 1, math.max(#g, #w) do
    assert(g[i] == w[i], "line " .. i .. ":\\n  got  " .. tostring(g[i]) .. "\\n  want " .. tostring(w[i]))
  end
end

-- Alex's Nymrissa note (2026-10-21), with a line the old editor wrote by file name and some timed lines
local NOTE = table.concat({
  "EncounterID:3176;Difficulty:Mythic;Name:Nymrissa;",
  "time:20;ph:1;tag:Demon Hunter Abu;text:Orb;",
  "time:30;tag:DEMONHUNTER;text:Orb;",
  "time:35;tag:Demon Hunter;text:Orb;",
  "time:40;tag:Hunter;text:Trap;",
  "time:45;tag:Death Knight Priest;text:Grip;",
  "Orb Soak 1: Demon Hunter Warlock Priest Monk",
  "Orb Soak 2: Shaman Monk Druid Rogue",
  "Orb Soak 3: Mage Warlock Death Knight Warrior",
  "Orb Soak 4: Hunter",
  "Old: DEMONHUNTER, DeathKnight PRIEST",
  "Phase 2: the DEMONHUNTER kites",
  "invitelist:Abu,Cheo;",
}, "\\n")

check("class words: one table, every spelling", function()
  assert(P.ClassName("DEMONHUNTER") == "Demon Hunter" and P.ClassName("DEATHKNIGHT") == "Death Knight" and P.ClassName("HUNTER") == "Hunter", "English names")
  for _, w in ipairs({ "Demon Hunter", "DemonHunter", "DEMONHUNTER", "demon hunter", "demonhunter" }) do
    assert(P.ClassOf(w) == "DEMONHUNTER", w)
  end
  assert(P.ClassOf("Hunter") == "HUNTER" and P.ClassOf("Death Knight") == "DEATHKNIGHT" and P.ClassOf("Demon") == nil and P.ClassOf("Abu") == nil, "others")
  local file, n = P.ClassAt({ "Demon", "Hunter", "Warlock" }, 1)
  assert(file == "DEMONHUNTER" and n == 2, "two words: " .. tostring(file) .. " " .. tostring(n))
  file, n = P.ClassAt({ "Demon", "Hunter", "Warlock" }, 2)
  assert(file == "HUNTER" and n == 1, "from the second word it is Hunter")
  assert(P.ClassAt({ "Abu" }, 1) == nil, "a name is no class")
  assert(table.concat(P.JoinClassWords({ "Demon", "Hunter", "Abu", "Death", "Knight" }), "/") == "Demon Hunter/Abu/Death Knight", "joined")
end)

check("NSRT: classes as class IDs in tags, as English names in assignments", function()
  same(NSRT.ToNSRTText(NOTE), table.concat({
    "EncounterID:3176;Name:Nymrissa;Difficulty:Mythic;",
    "time:20;ph:1;tag:12 Abu;text:Orb;",
    "time:30;tag:12;text:Orb;",
    "time:35;tag:12;text:Orb;",
    "time:40;tag:3;text:Trap;",
    "time:45;tag:6 5;text:Grip;",
    "Orb Soak 1: Demon Hunter Warlock Priest Monk",
    "Orb Soak 2: Shaman Monk Druid Rogue",
    "Orb Soak 3: Mage Warlock Death Knight Warrior",
    "Orb Soak 4: Hunter",
    "Old: Demon Hunter, Death Knight Priest",
    "Phase 2: the DEMONHUNTER kites",
  }, "\\n"))
end)

check("MRT: a two-word class is one class block", function()
  same(MRT.ToMRTText(NOTE), table.concat({
    "{time:0:20} Demon Hunter Abu - Orb",
    "{c:Demon Hunter}{time:0:30} - Orb{/c}",
    "{c:Demon Hunter}{time:0:35} - Orb{/c}",
    "{c:Hunter}{time:0:40} - Trap{/c}",
    "{c:Death Knight,Priest}{time:0:45} - Grip{/c}",
    "Orb Soak 1: Demon Hunter Warlock Priest Monk",
    "Orb Soak 2: Shaman Monk Druid Rogue",
    "Orb Soak 3: Mage Warlock Death Knight Warrior",
    "Orb Soak 4: Hunter",
    "Old: DEMONHUNTER, DeathKnight PRIEST",
    "Phase 2: the DEMONHUNTER kites",
  }, "\\n"))
end)

if checks.failed then error(checks.failed .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const names = ['CRT_Modules/Notes/Parse.lua', 'CRT_Core/Integrations/NoteTargets.lua', 'CRT_Core/Integrations/NSRT.lua', 'CRT_Core/Integrations/MRT.lua'];
const files = process.argv.slice(2);
if (files.length !== names.length) { console.error('usage: node run_note_targets.js ' + names.join(' ')); process.exit(2); }
files.forEach((p, i) => { lua.lua_pushstring(L, to_luastring(names[i])); lua.lua_pushstring(L, to_luastring(fs.readFileSync(p, 'utf8'))); });
if (lua.lua_pcall(L, files.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
