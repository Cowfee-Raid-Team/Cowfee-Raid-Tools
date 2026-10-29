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
  "time:50;tag:Deathknight;text:Kick;",
  "time:55;tag:priest;text:Dispel;",
  "Orb Soak 1: Demon Hunter Warlock Priest Monk",
  "Orb Soak 2: Shaman Monk Druid Rogue",
  "Orb Soak 3: Mage Warlock Death Knight Warrior",
  "Orb Soak 4: Hunter",
  "Old: DEMONHUNTER, DeathKnight PRIEST",
  "Phase 2: the DEMONHUNTER kites",
  "Kicks: Deathknight, Abu",
  "Note: the hunter kites",
  "Note: the Hunter kites",
  "Soak: priest, monk",
  "Soak 1: {star} Abu PRIEST",
  "Kicks: Abu > MAGE > rogue",
  "Kicks: 1 mage 2 ROGUE",
  "Soak: Abu (left), priest",
  "Soak: |cffff0000Abu|r / priest -> {rt1}",
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
  -- sure only when it reads as a class name: several words, the capitals of a class file, or the name as written
  local function strong(words) return select(3, P.ClassAt(words, 1)) end
  assert(P.ClassAt({ "Deathknight" }, 1) == "DEATHKNIGHT" and not strong({ "Deathknight" }), "a name like a player's is not sure")
  assert(not strong({ "hunter" }) and not strong({ "demonhunter" }), "lower case alone is not sure")
  assert(strong({ "DEATHKNIGHT" }) and strong({ "Hunter" }) and strong({ "death", "knight" }) and strong({ "Demon", "Hunter" }), "sure ones")
  local runs = P.ClassRuns("Demon Hunter, Death   Knight Abu\tHunter Demon\tHunter", "[^%s,]+")
  local got = {}
  for i, r in ipairs(runs) do got[i] = r.text .. "=" .. tostring(r.class) end
  assert(table.concat(got, "/") == "Demon Hunter=DEMONHUNTER/Death   Knight=DEATHKNIGHT/Abu=nil/Hunter=HUNTER/Demon=nil/Hunter=HUNTER", table.concat(got, "/"))
  assert(runs[2].start == 15 and runs[2].stop == 29, "where each is: " .. runs[2].start .. " " .. runs[2].stop)
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
    "time:50;tag:6;text:Kick;",
    "time:55;tag:5;text:Dispel;",
    "Orb Soak 1: Demon Hunter Warlock Priest Monk",
    "Orb Soak 2: Shaman Monk Druid Rogue",
    "Orb Soak 3: Mage Warlock Death Knight Warrior",
    "Orb Soak 4: Hunter",
    "Old: Demon Hunter, DeathKnight Priest",
    "Phase 2: the DEMONHUNTER kites",
    "Kicks: Deathknight, Abu",
    "Note: the hunter kites",
    "Note: the Hunter kites",
    "Soak: Priest, Monk",
    "Soak 1: {star} Abu Priest",
    "Kicks: Abu > Mage > Rogue",
    "Kicks: 1 Mage 2 Rogue",
    "Soak: Abu (left), Priest",
    "Soak: |cffff0000Abu|r / Priest -> {rt1}",
  }, "\\n"))
end)

check("MRT: a two-word class is one class block", function()
  same(MRT.ToMRTText(NOTE), table.concat({
    "{time:0:20} Demon Hunter Abu - Orb",
    "{c:Demon Hunter}{time:0:30} - Orb{/c}",
    "{c:Demon Hunter}{time:0:35} - Orb{/c}",
    "{c:Hunter}{time:0:40} - Trap{/c}",
    "{c:Death Knight,Priest}{time:0:45} - Grip{/c}",
    "{c:Death Knight}{time:0:50} - Kick{/c}",
    "{c:Priest}{time:0:55} - Dispel{/c}",
    "Orb Soak 1: Demon Hunter Warlock Priest Monk",
    "Orb Soak 2: Shaman Monk Druid Rogue",
    "Orb Soak 3: Mage Warlock Death Knight Warrior",
    "Orb Soak 4: Hunter",
    "Old: DEMONHUNTER, DeathKnight PRIEST",
    "Phase 2: the DEMONHUNTER kites",
    "Kicks: Deathknight, Abu",
    "Note: the hunter kites",
    "Note: the Hunter kites",
    "Soak: priest, monk",
    "Soak 1: {star} Abu PRIEST",
    "Kicks: Abu > MAGE > rogue",
    "Kicks: 1 mage 2 ROGUE",
    "Soak: Abu (left), priest",
    "Soak: |cffff0000Abu|r / priest -> {rt1}",
  }, "\\n"))
end)

check("assignment lines: which class words count", function()
  local function counted(rest)
    local out = {}
    for _, item in ipairs(P.AssignmentClasses(rest)) do
      if item.counts then out[#out + 1] = item.text .. "=" .. item.class end
    end
    return table.concat(out, ",")
  end
  assert(counted(" priest, monk") == "priest=PRIEST,monk=MONK", "a pure list, lower case: " .. counted(" priest, monk"))
  assert(counted(" the hunter kites") == "", "a sentence")
  assert(counted(" the Hunter kites") == "", "a sentence with a capital: " .. counted(" the Hunter kites"))
  assert(counted(" Demon Hunter Warlock Priest Monk") == "Demon Hunter=DEMONHUNTER,Warlock=WARLOCK,Priest=PRIEST,Monk=MONK", "Orb Soak 1")
  assert(counted(" Deathknight, Abu") == "", "a name like a player's")
  assert(counted(" priest, Abu, tank, Group2, G3, everyone") == "priest=PRIEST", "names, roles and groups keep it a list")
  assert(counted(" priest and Abu") == "", "a short lower-case word is a sentence")
  assert(counted(" kill the demon hunter") == "demon hunter=DEMONHUNTER", "a name of several words is always a class")
  -- markup and punctuation are neither names nor sentence words
  assert(counted(" {star} Abu priest") == "priest=PRIEST", "a raid icon")
  assert(counted(" Abu > mage -> rogue") == "mage=MAGE,rogue=ROGUE", "arrows")
  assert(counted(" 1 mage 2 rogue") == "mage=MAGE,rogue=ROGUE", "numbers")
  assert(counted(" Abu (left), priest") == "priest=PRIEST", "a bracketed note")
  assert(counted(" |cffff0000Abu|r / priest") == "priest=PRIEST", "a colour code and a slash")
  assert(counted(" {star} the priest") == "", "still a sentence")
  -- one cut decides the list for every user: the rendered note's word pattern sees the same list
  local cut = {}
  for _, item in ipairs(P.AssignmentClasses(" Abu (left), priest", "[%a]+")) do if item.counts then cut[#cut + 1] = item.text end end
  assert(table.concat(cut, ",") == "priest", "another word pattern, the same list: " .. table.concat(cut, ","))
end)

-- shield: (a shield bar) is CRT's own: never sent through the bridge, the rest of the line as before
check("NSRT: a line's shield: option is left out", function()
  local text = NSRT.ToNSRTText("EncounterID:3001;Name:Boss\\ntime:183;ph:1;tag:everyone;text:Break it;show:bar;shield:boss2,15,any;spellid:5;")
  assert(not text:find("shield", 1, true), "no shield field: " .. text)
  assert(text:find("time:183;ph:1;tag:everyone;text:Break it;spellid:5;", 1, true), "the rest as before: " .. text)
end)

-- a Mech Alerts line's bar ticks, priority and marker (Notes/MechNote.lua) are CRT's own too
check("NSRT: a Mech Alerts line's ticks:, fill:, countto:, prio: and mech: are left out", function()
  local text = NSRT.ToNSRTText("EncounterID:3001;Name:Boss\\ntime:36;ph:1;tag:all;spellid:5;text:Spread;show:bar;warn:8;ticks:2,4;fill:up;countto:impact;prio:high;mech:5;")
  for _, k in ipairs({ "ticks", "fill", "countto", "prio", "mech" }) do
    assert(not text:lower():find(k .. ":", 1, true), k .. ": reached the NSRT text: " .. text)
  end
  assert(text:find("time:36;ph:1;tag:everyone;spellid:5;text:Spread;", 1, true), "the rest as before: " .. text)
end)

-- an assignment block (Notes/Assign.lua): its timed lines' assign: marker is CRT's own, its heading line plain text
check("NSRT and MRT: an assignment block's assign: marker is left out, its heading is its name", function()
  local note = "EncounterID:3001;Name:Boss\\nassign:ravenous feast;name:Ravenous Feast;for:5;times:1@36;\\nLeft: Abu, Cheo\\n"
    .. "time:36;ph:1;tag:Abu Cheo;spellid:5;text:Soak;assign:ravenous feast/1/1;"
  local text = NSRT.ToNSRTText(note)
  assert(not text:lower():find("assign", 1, true) and not text:find("for:5", 1, true), "no marker reaches NSRT: " .. text)
  assert(text:find("\\nRavenous Feast\\nLeft: Abu, Cheo\\ntime:36;ph:1;tag:Abu Cheo;spellid:5;text:Soak;$"), text)
  local mrt = MRT.ToMRTText(note)
  assert(not mrt:lower():find("assign", 1, true) and mrt:find("^Ravenous Feast\\nLeft: Abu, Cheo\\n"), "MRT: " .. mrt)
  local parsed = CRT.NoteParser.Parse(note)
  assert(parsed.lines[1] == "Ravenous Feast" and #parsed.timers == 1, "CRT reads the heading as its name")
end)

if checks.failed then error(checks.failed .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const names = ['CRT_Modules/Notes/Parse.lua', 'CRT_Core/Integrations/NoteTargets.lua', 'CRT_Core/Integrations/NSRT.lua', 'CRT_Core/Integrations/MRT.lua'];
const files = process.argv.slice(2);
if (files.length !== names.length) { console.error('usage: node run_note_targets.js ' + names.join(' ')); process.exit(2); }
files.forEach((p, i) => { lua.lua_pushstring(L, to_luastring(names[i])); lua.lua_pushstring(L, to_luastring(fs.readFileSync(p, 'utf8'))); });
if (lua.lua_pcall(L, files.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
