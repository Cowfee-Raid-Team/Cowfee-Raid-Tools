// CRT_Modules/Alerts/Colors.lua: every alert in its ability type's colour, found from the boss data the Timeline has
// (your own label, the ability timeline's row and its first type, the Journal's icons), for each source: a raid
// note line, a reminder and a saved alert (template) placed as a reminder. The theme's accent with no known type.
// Alerts:OwnColor: the raid leader's note colour always wins, yours only with Use custom colours on (default off,
// kept saved while off). Timeline: a reference row's own (color rrggbb) colour only with the box on.
// Usage: node run_alerts_colors.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua
//   CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua
//   CRT_Modules/Alerts/Speech.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Notes/Engine.lua
//   CRT_Modules/Alerts/Reminders.lua CRT_Modules/Alerts/Colors.lua CRT_Modules/Alerts/Saved.lua
//   CRT_Data/Bosses/Registry.lua CRT_Dev/Tests/SamplePack/Season.lua CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua
//   CRT_Core/Core.lua (read as text only: the default)
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local coreText = table.remove(sources)
local function loadBosses(CRT, reg, season, nek)
  local real, handler = CreateFrame, nil
  CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
  assert(load(reg, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
  CreateFrame = real
  assert(load(season, "CRT_Dev/Tests/SamplePack/Season.lua"))("CowfeeRaidTools", CRT)
  assert(load(nek, "CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua"))("CowfeeRaidTools", CRT)
  handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
end
local nek, season, reg = table.remove(sources), table.remove(sources), table.remove(sources)
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
function InCombatLockdown() return false end
C_Timer = { After = function() end, NewTicker = function() return { Cancel = function() end } end }
local clock = 1000
function GetTime() return clock end
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-21 12:00" end
function time() return 1700000000 end
function UnitName(u) if u == "player" then return "Cheoeqar" end return nil end
function UnitGroupRolesAssigned() return "DAMAGER" end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
function IsInRaid() return false end
function IsInGroup() return false end
function GetNumGroupMembers() return 1 end
function UnitIsUnit() return false end
function UnitClass(u) if u == "player" then return "Mage", "MAGE", 8 end end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic" })[id] end
local secrets = {}
function issecretvalue(v) return secrets[v] == true end
local SECRET = {}
secrets[SECRET] = true
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
local names = { [5001] = "Grasping Depths", [5002] = "Hungering Pyre", [5003] = "Essence Rend", [7001] = "Labelled Thing",
  [8001] = "Magic Bolt", [8002] = "Mythic Curse", [9999] = "Nothing Known" }
C_Spell = {
  GetSpellName = function(id) return names[id] end,
  GetSpellTexture = function(id) return 100000 + id end,
  GetSpellInfo = function(id) return names[id] and { name = names[id], iconID = 100000 + id } or nil end,
}
SOUNDKIT = { RAID_WARNING = 8959 }
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
C_VoiceChat = { SpeakText = function() end }

local NEK = "Nek'zali the Soulcoiler"
local noteText = "EncounterID:3001;Difficulty:Mythic;Name:Nek note\\n"
  .. "time:10;ph:1;tag:everyone;spellid:5001;\\n"
  .. "time:20;ph:1;tag:everyone;text:Hungering Pyre;colors:1 0 0;\\n"
local CRT = {
  Dev = {}, -- a developer build (the CRT_Dev files loaded): your own timeline layers are read (Timeline.DevBuild)
  PALETTE = { accent = { 0.78, 0.56, 0.36 } }, -- the theme's accent (the harness's own; Themes.lua fills it in the game)
  db = {
    ui = {}, classCache = {},
    timeline = { references = {}, nextRef = 1, record = false, rows = {}, bosses = {} },
    notes = {
      list = { [1] = { raw = noteText, name = "Nek note", encounterID = 3001, difficulty = "Mythic" } },
      nextId = 2, trustedOnly = true,
      alert = { enabled = true, seconds = 10, tts = false, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" },
    },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      noteLines = { text = true, icon = true, circle = true },
      reminders = {}, phases = {}, overrides = {}, nextId = 1, saved = {}, nextSavedId = 1, customColors = false },
  },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end, Tint = function() end, OnTheme = function() end },
  PlaySound = function() return 1 end,
  Print = function() end,
}
-- The Journal's rows for the boss: the reference's Grasping Depths (mythic) and Hungering Pyre (soak) by name, and
-- spells only the Journal knows, with its icons.
local journalRows = {
  { spellID = 5001, name = "Grasping Depths" },
  { spellID = 5002, name = "Hungering Pyre" },
  { spellID = 5003, name = "Essence Rend" },
  { spellID = 8001, name = "Magic Bolt", tags = { "tank", "magic" } },
  { spellID = 8002, name = "Mythic Curse", tags = { "mythic", "curse" } },
}
-- Rows walks the Journal (counted); CachedRows only gives what was read already (journalCached says whether it was).
local rowsCalls, journalCached = 0, true
CRT.TimelineJournal = { Rows = function() rowsCalls = rowsCalls + 1 return journalRows end, IsHidden = function() return false end,
  CachedRows = function() return journalCached and journalRows or nil end }
for i, src in ipairs(sources) do
  assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
end
loadBosses(CRT, reg, season, nek)
local A, R, C, Ref, Saved, T = CRT.Alerts, CRT.AlertReminders, CRT.AlertColors, CRT.TimelineReference, CRT.AlertSaved, CRT.Timeline
assert(A and R and C and Ref and Saved and T, "modules exist")
local TYPES = Ref.TYPES

local fails = 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)) fails = fails + 1 end
end
local function same(c, want) return c ~= nil and want ~= nil and math.abs(c[1] - want[1]) < 1e-6 and math.abs(c[2] - want[2]) < 1e-6 and math.abs(c[3] - want[3]) < 1e-6 end
local function pull()
  A.HandleEvent("ENCOUNTER_START", 3001, NEK, 16)
end
local function itemBy(pred)
  for _, it in ipairs(A.items) do if pred(it) then return it end end
end
-- the colour an area draws a line in without an area colour of its own (Areas.DrawColor's order)
local function drawn(it) return A:OwnColor(it) or C.TypeColor(it.abilityType) end

check("colors: the default is off", function()
  assert(coreText:find("customColors = false", 1, true), "CRT_Core/Core.lua has the default")
  assert(A:CustomColors() == false, "off")
end)

check("colors: the pull's boss name finds the ability timeline", function()
  pull()
  assert(A.run.bossName == NEK and A.run.difficultyName == "Mythic", "boss name kept: " .. tostring(A.run.bossName))
  A:Stop()
  secrets[NEK] = true
  pull()
  assert(A.run.bossName == nil and #errors == 0, "a secret name is left out")
  secrets[NEK] = nil
  A:Stop()
end)

check("colors: a raid note line takes its ability's type", function()
  pull()
  local spell = itemBy(function(it) return it.block == "note" and it.spellID == 5001 end)
  assert(spell and spell.abilityType == "mythic", "spell line through the timeline row by its Journal spell: " .. tostring(spell and spell.abilityType))
  assert(A:OwnColor(spell) == nil and same(drawn(spell), TYPES.mythic.color), "drawn in the Mythic only colour")
  A:Stop()
end)

check("colors: the raid leader's note colour wins, box or not", function()
  pull()
  local text = itemBy(function(it) return it.block == "note" and it.text == "Hungering Pyre" end)
  assert(text and text.abilityType == "soak", "text line by the row's name: " .. tostring(text and text.abilityType))
  assert(same(drawn(text), { 1, 0, 0 }), "off: the note's red")
  CRT.db.alerts.customColors = true
  assert(same(drawn(text), { 1, 0, 0 }), "on: the note's red")
  CRT.db.alerts.customColors = false
  A:Stop()
end)

check("colors: a reminder takes its type; its own colour only with the box", function()
  CRT.db.alerts.reminders = {}
  local id = R:Save(3001, nil, { boss = NEK, spellID = 5003, text = "Essence Rend", times = "P1 0:30", color = { 0, 1, 0, 1 } })
  pull()
  local it = itemBy(function(x) return x.block == "mine" end)
  assert(it and it.abilityType == "dispel", "Essence Rend is dispel: " .. tostring(it and it.abilityType))
  assert(same(drawn(it), TYPES.dispel.color), "off: dispel blue, your green ignored")
  assert(same(R:Get(3001, id).color, { 0, 1, 0 }), "off: your colour stays saved")
  CRT.db.alerts.customColors = true
  assert(same(drawn(it), { 0, 1, 0 }), "on: your green")
  CRT.db.alerts.customColors = false
  A:Stop()
end)

check("colors: a saved alert placed as a reminder takes its type", function()
  CRT.db.alerts.reminders = {}
  local sid = Saved:Save(nil, { name = "Pyre", saveAs = "mine", spellID = 5002, text = "Soak it", color = { 0, 0, 1, 1 },
    outputs = { alert = true, bar = true, circle = true } })
  local s = Saved:Get(sid)
  assert(s and same(s.color, { 0, 0, 1 }), "the template keeps its colour")
  R:Save(3001, nil, { boss = NEK, spellID = s.spellID, text = s.text, color = s.color, outputs = s.outputs, times = "P1 0:40" })
  pull()
  local it = itemBy(function(x) return x.block == "mine" end)
  assert(it and it.abilityType == "soak" and same(drawn(it), TYPES.soak.color), "soak pink: " .. tostring(it and it.abilityType))
  A:Stop()
end)

check("colors: your label, then the Journal's icons", function()
  CRT.db.alerts.reminders = {}
  T:SetAbility(3001, 7001, "type", "spread")
  T:SetAbility(3001, 5001, "type", "raid") -- your label wins over the timeline's mythic
  R:Save(3001, nil, { boss = NEK, spellID = 7001, text = "Labelled", times = "P1 0:10" })
  R:Save(3001, nil, { boss = NEK, spellID = 8001, text = "Bolt", times = "P1 0:11" })
  R:Save(3001, nil, { boss = NEK, spellID = 8002, text = "Curse", times = "P1 0:12" })
  R:Save(3001, nil, { boss = NEK, spellID = 5001, text = "Depths", times = "P1 0:13" })
  pull()
  local function typeOf(text) local it = itemBy(function(x) return x.text == text end) return it and it.abilityType end
  assert(typeOf("Labelled") == "spread", "your label: " .. tostring(typeOf("Labelled")))
  assert(typeOf("Depths") == "raid", "your label over the timeline: " .. tostring(typeOf("Depths")))
  assert(typeOf("Bolt") == "dispel", "a magic icon is dispel: " .. tostring(typeOf("Bolt")))
  assert(typeOf("Curse") == "mythic", "the first icon that is a type, as the Journal export writes it: " .. tostring(typeOf("Curse")))
  T:SetAbility(3001, 7001, "type", nil) T:SetAbility(3001, 5001, "type", nil)
  A:Stop()
end)

check("colors: the type lookup never walks the Journal during a run", function()
  CRT.db.alerts.reminders = {}
  R:Save(3001, nil, { boss = NEK, spellID = 8001, text = "Bolt", times = "P1 0:11" })
  R:Save(3001, nil, { boss = NEK, spellID = 5001, text = "Depths", times = "P1 0:13" })
  pull()
  for _, it in ipairs(A.items) do it.abilityType = nil end
  local before = rowsCalls
  C.Stamp(A.items, A.run)
  assert(rowsCalls == before, "Stamp asked the Journal: " .. (rowsCalls - before))
  local function typeOf(text) local it = itemBy(function(x) return x.text == text end) return it and it.abilityType end
  assert(typeOf("Bolt") == "dispel" and typeOf("Depths") == "mythic", "cached rows still give the types")
  -- rows not read yet this session: no Journal type, and still no walk
  journalCached = false
  for _, it in ipairs(A.items) do it.abilityType = nil end
  before = rowsCalls
  C.Stamp(A.items, A.run)
  assert(rowsCalls == before and typeOf("Bolt") == nil, "uncached: no walk, no Journal type")
  journalCached = true
  A:Stop()
end)

check("colors: each item gets its Journal icons, from the cached rows only", function()
  CRT.db.alerts.reminders = {}
  T:SetAbility(3001, 8002, "type", "spread") -- a type of its own still gets the icons
  R:Save(3001, nil, { boss = NEK, spellID = 8001, text = "Bolt", times = "P1 0:11" })
  R:Save(3001, nil, { boss = NEK, spellID = 8002, text = "Curse", times = "P1 0:12" })
  R:Save(3001, nil, { boss = NEK, spellID = 5003, text = "Rend", times = "P1 0:13" })
  pull()
  local function tagsOf(text) local it = itemBy(function(x) return x.text == text end) return it and it.abilityTags and table.concat(it.abilityTags, ",") end
  assert(tagsOf("Bolt") == "tank,magic", "the Journal's icons: " .. tostring(tagsOf("Bolt")))
  assert(tagsOf("Curse") == "mythic,curse", "with a labelled type too: " .. tostring(tagsOf("Curse")))
  assert(tagsOf("Rend") == nil, "none known: none")
  -- not read this session: no icons, and no walk
  journalCached = false
  for _, it in ipairs(A.items) do it.abilityType = nil it.abilityTags = nil end
  local before = rowsCalls
  C.Stamp(A.items, A.run)
  assert(rowsCalls == before and tagsOf("Bolt") == nil, "uncached: no icons, no walk")
  journalCached = true
  T:SetAbility(3001, 8002, "type", nil)
  A:Stop()
end)

check("colors: no known type is the theme's accent", function()
  CRT.db.alerts.reminders = {}
  R:Save(3001, nil, { boss = NEK, spellID = 9999, text = "Nothing Known", times = "P1 0:10", color = { 0, 1, 0, 1 } })
  pull()
  local it = itemBy(function(x) return x.block == "mine" end)
  assert(it and it.abilityType == nil, "no type")
  assert(drawn(it) == CRT.PALETTE.accent, "the accent, read live so a theme switch follows")
  -- a secret spell is never compared and gives no type
  assert(C.TypeOf(3001, SECRET, SECRET, NEK, "Mythic") == nil and #errors == 0, "secret values")
  A:Stop()
end)

check("colors: a reference row's own colour only with the box", function()
  local ref = Ref.Parse("Boss: T\\nA (type soak, color 112233): 0:10\\nB (color 445566): 0:20\\nC (type raid): 0:30")
  local a, b, c = ref.rows[1], ref.rows[2], ref.rows[3]
  assert(same(Ref.RowColor(a), TYPES.soak.color), "off: the type's colour")
  assert(Ref.RowColor(b) == nil, "off: no type, no colour")
  assert(same(Ref.RowColor(c), TYPES.raid.color), "a type alone")
  CRT.db.alerts.customColors = true
  assert(same(Ref.RowColor(a), { 0x11 / 255, 0x22 / 255, 0x33 / 255 }) and same(Ref.RowColor(b), { 0x44 / 255, 0x55 / 255, 0x66 / 255 }), "on: the row's own colour")
  assert(same(Ref.RowColor(c), TYPES.raid.color), "on: a type alone keeps it")
  CRT.db.alerts.customColors = false
end)

-- Every type of an ability, the main one first, for a list of the boss's abilities (the Mech Alerts list): the
-- boss's ability timelines are read once for the whole list.
check("colors: every type of an ability, main first, the boss read once", function()
  local forBoss, reads = Ref.ForBoss, 0
  Ref.ForBoss = function(...) reads = reads + 1 return forBoss(...) end
  local typesOf = C.Types(3001, NEK, "Mythic")
  local function list(spell, text) return table.concat(typesOf(spell, text), " ") end
  assert(list(nil, "Corpse Blight") == "heroic raid", "the timeline row's types in order: " .. list(nil, "Corpse Blight"))
  assert(list(5002, "Hungering Pyre") == "soak", "by spell: " .. list(5002, "Hungering Pyre"))
  assert(list(8002, "Mythic Curse") == "mythic dispel", "the Journal's icons, each type once: " .. list(8002, "Mythic Curse"))
  assert(list(9999, "Nothing Known") == "", "none known: an empty list")
  assert(reads == 1, "the boss read once: " .. reads)
  T:SetAbility(3001, 5001, "type", "raid")
  assert(table.concat(C.Types(3001, NEK, "Mythic")(5001, "Grasping Depths"), " ") == "raid", "your label is the one type")
  T:SetAbility(3001, 5001, "type", nil)
  assert(#C.Types(3001, NEK)(SECRET, SECRET) == 0 and #errors == 0, "secret values give none")
  Ref.ForBoss = forBoss
end)

check("colors: no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)
if fails > 0 then error(fails .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
