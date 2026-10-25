// CRT_Modules/Alerts/Special.lua: a boss's special alerts (its boss file's special list), read and checked, their
// times, who gets each cast (everyone, a rotation of groups or roles, a note's label lines), your choices, and the
// "special" block on the alerts engine.
// Usage: node run_alerts_special.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua
//   CRT_Modules/Timeline/Lanes.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Speech.lua
//   CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Notes/Engine.lua CRT_Modules/Alerts/Reminders.lua
//   CRT_Modules/Alerts/Special.lua CRT_Dev/Dev/SpecialSample.lua CRT_Data/Bosses/Registry.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local registry = table.remove(sources)
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
local clock = 100
function GetTime() return clock end
function issecretvalue() return false end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
function date() return "2026-10-24 12:00" end
SOUNDKIT = { RAID_WARNING = 8959, READY_CHECK = 8960 }
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
C_VoiceChat = { SpeakText = function() end }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end,
  GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
-- you: Cheoeqar, a damage dealer in raid group 3
function UnitName(u) if u == "player" then return "Cheoeqar" end end
local role = "DAMAGER"
function UnitGroupRolesAssigned() return role end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
function UnitClass(u) if u == "player" then return "Mage", "MAGE", 8 end end
local subgroup = 3
function IsInRaid() return true end
function GetNumGroupMembers() return 2 end
function UnitIsUnit(a, b) return a == "raid2" and b == "player" end
function GetRaidRosterInfo(i) if i == 2 then return "Cheoeqar", 0, subgroup end return "Other", 0, 1 end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic" })[id] end
-- no addon may set a raid marker (protected since 12.0): the special alerts never call it
local markerCalls = 0
function SetRaidTarget() markerCalls = markerCalls + 1 error("ADDON_ACTION_BLOCKED SetRaidTarget") end

local printed = {}
local CRT = {
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    notes = { list = {}, nextId = 1, trustedOnly = true,
      alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" } },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1, special = {} },
  },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end, pages = {} },
  PlaySound = function() return 1 end,
}
function CRT:Print(m) printed[#printed + 1] = m end
CRT.TimelineJournal = { Rows = function() return {} end, IsHidden = function() return false end }
for i, src in ipairs(sources) do
  assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
end
-- the boss library: CRT_Data/Bosses/Registry.lua, a season and one boss file, then the ADDON_LOADED the game fires
local handler
local realCF = CreateFrame
CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end,
  SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
assert(load(registry, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
CreateFrame = realCF
local B, S, A, Ref, Notes = CRT.Bosses, CRT.AlertSpecial, CRT.Alerts, CRT.TimelineReference, CRT.Notes
assert(S, "CRT.AlertSpecial exists")
B:Season({ key = "T", name = "Test season", current = true, raids = { { key = "r", name = "Raid", bosses = { 9001, 9002 } } } })
local SPECIAL = {
  { key = "soaks", label = "Orb soaks", help = "Two groups soak each orb.", type = "soak",
    when = { row = "Orb Burst" }, lead = 6, who = { mode = "rotation", rotation = { { 1, 2 }, { 3, 4 } } },
    text = "Soak now: {group}", show = { callout = true, bar = false, text = true, speech = true },
    markers = { marks = { "star", "circle" } }, unknownField = "ignored" },
  { key = "everyone", label = "Everyone hides", when = { times = "P1 0:20; P2 0:10, 0:40" }, who = { mode = "everyone" }, default = true },
  { key = "tanks", label = "Tank swap", difficulty = "mythic", when = { spellID = 4242 }, who = { mode = "rotation", rotation = { "tank", "healer" } } },
  { key = "kicks", label = "Kicks", when = { times = "0:15, 0:45, 1:15" }, who = { mode = "note", note = "Kick" } },
  -- malformed: each is skipped
  { label = "No key", when = { times = "0:10" } },
  { key = "nolabel", when = { times = "0:10" } },
  { key = "badwhen", label = "Bad when", when = {} },
  { key = "badtimes", label = "Bad times", when = { times = "soon" } },
  { key = "badmode", label = "Bad mode", when = { times = "0:10" }, who = { mode = "sometimes" } },
  { key = "badgroup", label = "Bad group", when = { times = "0:10" }, who = { mode = "rotation", rotation = { { 9 } } } },
  { key = "nonote", label = "No note label", when = { times = "0:10" }, who = { mode = "note" } },
  { key = "baddiff", label = "Bad difficulty", difficulty = "heroic", when = { times = "0:10" } },
  { key = "soaks", label = "Second soaks", when = { times = "0:10" } },
  "not a table",
}
B:Register({ encounterID = 9001, name = "Test Boss", season = "T", special = SPECIAL })
B:Register({ encounterID = 9002, name = "Plain Boss", season = "T" })
handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Mythic\\nEncounter: 9001\\nLength: 4:00\\nPhase: P2 2:00\\nOrb Burst: 0:30, 1:10, 1:50, 2:30\\nSwap [spell 4242]: 0:40, 1:40"))
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Heroic\\nEncounter: 9001\\nLength: 3:00\\nOrb Burst: 0:45, 1:45"))

local ok_, fail = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then ok_ = ok_ + 1 print("ok " .. name) else fail = fail + 1 print("FAIL " .. name .. ": " .. tostring(err)) end
end
local function keys(list) local out = {} for _, e in ipairs(list) do out[#out + 1] = e.key end return table.concat(out, ",") end
local function fresh()
  A:Stop(true)
  CRT.db.alerts.special = {}
  subgroup, role = 3, "DAMAGER"
  S.dev = {}
  CRT.NoteEngine:ResetTokens()
end

check("special: the boss file's list is read; a malformed entry is skipped", function()
  fresh()
  local list = S:List(9001)
  assert(keys(list) == "soaks,everyone,tanks,kicks", "the four good ones, in order: " .. keys(list))
  local e = list[1]
  assert(e.label == "Orb soaks" and e.help == "Two groups soak each orb." and e.type == "soak" and e.lead == 6, "its fields")
  assert(e.who.mode == "rotation" and #e.who.steps == 2 and e.who.steps[2].tags[1] == "G3", "the rotation's steps")
  assert(e.show.alert and e.show.text and not e.show.bar and not e.show.icon and e.speak, "Show as from callout, text and speech")
  assert(e.marks[1] == 1 and e.marks[2] == 2, "markers by their names")
  assert(e.unknownField == nil, "unknown fields are ignored")
  assert(list[2].lead == 5 and list[2].show.alert and list[2].show.bar and list[2].speak and list[2].text == "Everyone hides", "the defaults")
  assert(#S:List(9002) == 0 and #S:List(1234) == 0, "a boss with none, and no boss")
  assert(#printed == 0, "no warning in a player's build: " .. tostring(printed[1]))
end)

check("special: a developer build says why an entry was skipped", function()
  fresh()
  CRT.UI.pages.dev = { hidden = true }
  local fresh9 = {} for i, d in ipairs(SPECIAL) do fresh9[i] = d end -- a new list is read again
  B:Register({ encounterID = 9001, name = "Test Boss", season = "T", special = fresh9 })
  S:List(9001)
  CRT.UI.pages.dev = nil
  local all = table.concat(printed, "\\n")
  for _, why in ipairs({ "no key", "no label", "when needs", "don't read", "who.mode", "rotation step 1", "note's label", "difficulty", "second entry", "not a table" }) do
    assert(all:find(why, 1, true), "says " .. why .. ": " .. all)
  end
  assert(#printed == 10, "one line per skipped entry: " .. #printed)
  S:List(9001)
  assert(#printed == 10, "said once")
  wipe(printed)
end)

check("special: times from the ability timeline row, by spell, or typed", function()
  fresh()
  local e = S:Get(9001, "soaks")
  local m = S:Times(9001, e, "mythic")
  assert(#m == 4 and m[1].ph == 1 and m[1].t == 30 and m[3].t == 110 and m[4].ph == 2 and m[4].t == 30, "Mythic's casts, P2 counted from its phase line")
  local h = S:Times(9001, e, "nh")
  assert(#h == 2 and h[1].t == 45 and h[2].t == 105, "Normal/Heroic's ability timeline")
  local sw = S:Times(9001, S:Get(9001, "tanks"), "mythic")
  assert(#sw == 2 and sw[1].t == 40 and sw[2].t == 100, "the row of the spell: " .. #sw)
  local ty = S:Times(9001, S:Get(9001, "everyone"), "mythic")
  assert(#ty == 3 and ty[1].ph == 1 and ty[1].t == 20 and ty[3].ph == 2 and ty[3].t == 40, "typed times in phase order")
  local ref = Ref:List()[2].ref
  assert(#S:Times(9001, e, "mythic", ref) == 2, "a run's own ability timeline wins")
end)

check("special: a rotation steps once per cast and wraps", function()
  fresh()
  local steps = S:Get(9001, "soaks").who.steps
  assert(S.StepAt(steps, 1) == steps[1] and S.StepAt(steps, 2) == steps[2] and S.StepAt(steps, 3) == steps[1] and S.StepAt(steps, 4) == steps[2], "1, 2, 1, 2")
  assert(S.StepAt({}, 1) == nil and S.StepAt(nil, 1) == nil, "no steps, no step")
end)

check("special: only your step's casts are yours", function()
  fresh()
  local e = S:Get(9001, "soaks")
  local items = S:Items(9001, e, { group = "mythic" })
  assert(#items == 2 and items[1].id == "special:soaks:2" and items[2].id == "special:soaks:4", "group 3: casts 2 and 4")
  assert(items[1].text == "Soak now: G3, G4 (Star, Circle)", "the step and the marks in the text: " .. items[1].text)
  subgroup = 1 CRT.NoteEngine:ResetTokens()
  local g1 = S:Items(9001, e, { group = "mythic" })
  assert(#g1 == 2 and g1[1].id == "special:soaks:1" and g1[2].id == "special:soaks:3", "group 1: casts 1 and 3")
  subgroup = 6 CRT.NoteEngine:ResetTokens()
  assert(#S:Items(9001, e, { group = "mythic" }) == 0, "group 6: nothing")
  assert(#S:Items(9001, e, { group = "mythic", all = true }) == 4, "all: every cast, as a test reads them")
  -- roles, as the note's tags read them
  local t = S:Get(9001, "tanks")
  assert(#S:Items(9001, t, { group = "mythic" }) == 0, "a damage dealer gets no tank or healer step")
  role = "TANK" CRT.NoteEngine:ResetTokens()
  local tk = S:Items(9001, t, { group = "mythic" })
  assert(#tk == 1 and tk[1].id == "special:tanks:1" and tk[1].text == "Tank swap", "the tank's step: " .. #tk)
  -- everyone: every cast
  local ev = S:Items(9001, S:Get(9001, "everyone"), { group = "mythic" })
  assert(#ev == 3 and ev[1].text == "Everyone hides", "everyone gets every cast")
end)

check("special: note mode reads the active note's label lines", function()
  fresh()
  local e = S:Get(9001, "kicks")
  assert(#S:Items(9001, e, {}) == 0, "no note: nobody")
  local id = Notes:Import("EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\nKick 1: Cheoeqar, Bob\\nKick 2: Alice\\nNote: stack on the boss\\n")
  local list = S:Items(9001, e, {})
  assert(#list == 2 and list[1].id == "special:kicks:1" and list[2].id == "special:kicks:3", "steps 1 and 1 again: " .. #list)
  assert(list[1].text == "Kicks", "the label as the text")
  local steps = S.NoteSteps(Notes:Parsed(id), "kick")
  assert(#steps == 2 and steps[1].tags[1] == "Cheoeqar" and steps[1].tags[2] == "Bob" and steps[2].tags[1] == "Alice", "numbered lines in order")
  Notes:Import("EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\nKick: Alice Mage\\n")
  local all = S:Items(9001, e, {})
  assert(#all == 3, "one Kick: line is every cast (the class names you): " .. #all)
  assert(#S.NoteSteps(Notes:Parsed(id), "Soak") == 0, "a label the note doesn't have: no steps")
  -- a raid group on the line, as "Group 3" or "G3": your subgroup is 3
  Notes:Import("EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\nKick 1: Group 3\\nKick 2: G5\\n")
  local g = S:Items(9001, e, {})
  assert(#g == 2 and g[1].id == "special:kicks:1" and g[2].id == "special:kicks:3", "Group 3 is your group, G5 is not: " .. #g)
  assert(S.NoteSteps(S.NoteFor(nil, 9001), "Kick")[1].tags[2] == "3", "the number stays after its group word")
  CRT.db.notes.list = {} CRT.db.notes.active = nil
end)

check("special: the block runs your entries on for the run's difficulty", function()
  fresh()
  assert(A.blocks.special and A.blocks.special.group == true, "registered as the special block")
  local run = { encounterID = 9001, group = "mythic" }
  local items = A.blocks.special.Entries(run)
  assert(#items == 3 and items[1].special == "everyone", "only the entry on by default: " .. #items)
  S:SetChoice(9001, S:Get(9001, "soaks"), "on", true)
  S:SetChoice(9001, S:Get(9001, "tanks"), "on", true)
  role = "TANK" CRT.NoteEngine:ResetTokens()
  local n = 0
  for _, it in ipairs(A.blocks.special.Entries(run)) do if it.special == "tanks" then n = n + 1 end end
  assert(n == 1, "the Mythic entry on a Mythic run")
  n = 0
  for _, it in ipairs(A.blocks.special.Entries({ encounterID = 9001, group = "nh" })) do if it.special == "tanks" then n = n + 1 end end
  assert(n == 0, "a Mythic entry never runs on Normal/Heroic")
  assert(#A.blocks.special.Entries({ encounterID = 9002, group = "mythic" }) == 0, "another boss: nothing")
  -- the item, as the engine and the displays read it
  role = "DAMAGER" CRT.NoteEngine:ResetTokens()
  local soak
  for _, it in ipairs(A.blocks.special.Entries(run)) do if it.special == "soaks" then soak = soak or it end end
  assert(soak and soak.ph == 1 and soak.time == 70 and soak.warn == 6 and soak.abilityType == "soak", "time, lead and type")
  assert(soak.outputs.alert and soak.outputs.text and not soak.outputs.bar and soak.outputs.speech, "outputs from the choices")
  assert(soak.speech[1].offset == 6 and soak.speech[1].text == soak.text, "read out at its lead")
  -- through the engine: a real pull collects them
  A:Start(9001, "Mythic", "encounter", { difficultyID = 16 })
  local got = 0
  for _, it in ipairs(A.items) do if it.block == "special" then got = got + 1 end end
  assert(got == 3 + 2, "the pull's items: " .. got)
  A:Stop(true)
  assert(markerCalls == 0, "never sets a raid marker")
  assert(#errors == 0, tostring(errors[1]))
end)

check("special: your choices default from the data and save whole", function()
  fresh()
  local e = S:Get(9001, "soaks")
  local c = S:Choices(9001, e)
  assert(c.on == false and c.show.alert and c.show.text and not c.show.bar and c.speak and c.markers == false, "the data's defaults, off")
  assert(S:Choices(9001, S:Get(9001, "everyone")).on == true, "default = true starts on")
  local fired = 0
  A:OnChange(function() fired = fired + 1 end)
  S:SetChoice(9001, e, "bar", true, true)
  local saved = CRT.db.alerts.special[9001].soaks
  assert(saved and saved.on == false and saved.show.bar == true and saved.show.alert == true and saved.speak == true, "saved whole")
  assert(fired >= 1, "the engine is told")
  S:SetChoice(9001, e, "on", true)
  assert(CRT.db.alerts.special[9001].soaks.on == true and S:Choices(9001, e).show.bar == true, "on, the bar kept")
end)

check("special: a test plays your first cast, else the first", function()
  fresh()
  local e = S:Get(9001, "soaks")
  local it = S:TestItem(9001, e, "mythic")
  assert(it and it.id == "special:soaks:2", "group 3's first cast")
  subgroup = 7 CRT.NoteEngine:ResetTokens()
  it = S:TestItem(9001, e, "mythic")
  assert(it and it.id == "special:soaks:1", "not in any step: the first cast")
  assert(S:TestItem(9002, { key = "x", label = "x", text = "x", lead = 5, when = { row = "Nothing" }, who = { mode = "everyone" }, show = e.show, speak = true }, "mythic") == nil, "no times: nothing")
end)

check("special: markers are never set, the text names them", function()
  fresh()
  assert(S.MARKING and S.MARKING.allowed == false, "an addon can't set raid markers (protected since 12.0)")
  RAID_TARGET_1 = "Etoile"
  assert(S.MarkName(1) == "Etoile" and S.MarkName(8) == "Skull", "the game's name, else English")
  RAID_TARGET_1 = nil
  assert(markerCalls == 0, "SetRaidTarget never called")
end)

check("special: the dev sample is listed for its boss only, never saved", function()
  fresh()
  S.dev[9002] = { { key = "sample", label = "Sample", when = { times = "0:10" } } }
  assert(keys(S:List(9002)) == "sample" and #S:List(9001) == 4, "listed on its boss only")
  assert(CRT.db.alerts.special[9002] == nil, "nothing saved")
end)

check("special: /crt dev special adds a sample to the boss on show, off takes it away", function()
  fresh()
  local D = CRT.SpecialSampleDev
  assert(D, "CRT_Dev/Dev/SpecialSample.lua is loaded")
  assert(D:Command("dev specials") == false and D:Command("dev markers") == false, "other commands are not its")
  CRT.NoteReminders = { Boss = function() return 9002 end }
  assert(D:Command("dev special") == true, "its command")
  local list = S:List(9002)
  assert(#list == 1 and list[1].key == "devSample" and list[1].when.times and list[1].who.mode == "rotation" and list[1].marks, "a typed sample on a boss with no ability timeline")
  assert(next(CRT.db.alerts.special) == nil, "nothing saved")
  CRT.NoteReminders.Boss = function() return 9001 end
  D:Command("dev special")
  local sample = S:Get(9001, "devSample")
  assert(sample and sample.when.row == "Orb Burst" and #S:List(9001) == 5, "on its ability timeline's first row with casts")
  assert(#S:Items(9001, sample, { group = "mythic", all = true }) == 4, "its casts")
  local first = S:Items(9001, sample, { group = "mythic", all = true })[1]
  assert(first.ticks and #first.ticks == 2 and first.barStart == -3 and first.barEnd == 5, "its bar has two impact ticks")
  D:Command("dev special off")
  assert(S:Get(9001, "devSample") == nil and #S:List(9002) == 1, "off: gone from that boss only")
  CRT.NoteReminders.Boss = function() return nil end
  wipe(printed)
  assert(D:Command("dev special") == true and printed[1] and printed[1]:find("No boss", 1, true), "no boss: says so")
  CRT.NoteReminders = nil
  wipe(printed)
end)

check("special: ticks and barTo, or a bar of its own, are read", function()
  fresh()
  local e = assert(S.Read({ key = "feast", label = "Feast", when = { times = "0:30" }, ticks = { 2.5, 0 } }))
  assert(e.impacts and e.impacts.ticks[1] == 0 and e.impacts.ticks[2] == 2.5 and e.impacts.barTo == "last", "ticks in order, barTo last by default")
  assert(S.Read({ key = "c", label = "C", when = { times = "0:30" }, ticks = { 1 }, barTo = "cast" }).impacts.barTo == "cast", "barTo cast")
  local b = assert(S.Read({ key = "b", label = "B", when = { times = "0:30" }, bar = { length = 8, ticks = { 6.5, 4.5 } } }))
  local i = b.impacts
  assert(i.ticks[1] == 4.5 and i.ticks[2] == 6.5 and i.barStart == 0 and i.barEnd == 8 and i.length == 8 and i.inBar[1] == 4.5, "a bar from the cast, 8 s")
  local early = S.Read({ key = "b", label = "B", when = { times = "0:30" }, bar = { start = -3, length = 8, ticks = { 4.5, 6.5 } } }).impacts
  assert(early.ticks[1] == 1.5 and early.ticks[2] == 3.5 and early.barStart == -3 and early.barEnd == 5, "from 3 s before the cast: the ticks counted from the bar's start")
  assert(S.Read({ key = "n", label = "N", when = { times = "0:30" } }).impacts == nil, "none: nil")
  for why, def in pairs({
    ["not both"] = { ticks = { 1 }, bar = { length = 8 } },
    ["length over 0"] = { bar = { length = 0 } },
    ["inside its length"] = { bar = { length = 8, ticks = { 9 } } },
    ["seconds after the cast"] = { ticks = { -1 } },
    ["barTo must"] = { ticks = { 1 }, barTo = "sometime" },
    ["covers must"] = { covers = { "Feast" } },
    ["fill must"] = { fill = "sideways" },
  }) do
    def.key, def.label, def.when = "x", "X", { times = "0:30" }
    local ok, err = S.Read(def)
    assert(ok == nil and tostring(err):find(why, 1, true), why .. ": " .. tostring(err))
  end
end)

check("special: the bar fills up by default; the data and each player may choose", function()
  fresh()
  S.dev[9002] = { { key = "up", label = "Up", when = { times = "0:30" } }, { key = "down", label = "Down", when = { times = "0:30" }, fill = "down" } }
  local up, down = S:Get(9002, "up"), S:Get(9002, "down")
  assert(up.fill == "up" and down.fill == "down", "read: up unless the data says down")
  assert(S:Choices(9002, up).fill == "up" and S:Choices(9002, down).fill == "down", "your choice starts as the data's")
  assert(S:Items(9002, up, {})[1].fill == "up" and S:Items(9002, down, {})[1].fill == "down", "the item carries it")
  S:SetChoice(9002, up, "fill", "down")
  assert(CRT.db.alerts.special[9002].up.fill == "down" and S:Items(9002, up, {})[1].fill == "down", "saved with your choices")
  assert(CRT.db.alerts.special[9002].up.on == false, "the rest saved whole")
  S:SetChoice(9002, up, "fill", "nonsense")
  assert(S:Choices(9002, up).fill == "up", "anything else: up")
  CRT.db.alerts.special[9002] = { down = { fill = 7 } }
  assert(S:Choices(9002, down).fill == "down", "a bad saved value: the data's")
  local k = S:ListKey(9002)
  S.dev[9002] = { { key = "other", label = "Other", when = { times = "0:30" } } }
  assert(S:ListKey(9002) ~= k, "a new sample changes the list's key")
end)

check("special: an item carries its ticks, its bar and the spells it covers", function()
  fresh()
  S.dev[9002] = { { key = "feast", label = "Feast", when = { times = "0:30, 1:10" }, ticks = { 0, 2.5 }, covers = { 77 } },
    { key = "own", label = "Own bar", when = { times = "0:30" }, bar = { start = -3, length = 8, ticks = { 4.5, 6.5 } } } }
  local list = S:Items(9002, S:Get(9002, "feast"), { group = "mythic" })
  assert(#list == 2 and list[1].ticks[1] == 0 and list[1].ticks[2] == 2.5 and list[1].barTo == "last", "ticks and barTo")
  assert(list[1].ticks ~= S:Get(9002, "feast").impacts.ticks, "a copy, so a display can't change the entry")
  assert(list[1].covers[77] and list[2].covers == list[1].covers, "the spells it covers, one set per entry")
  local o = S:Items(9002, S:Get(9002, "own"), { group = "mythic" })[1]
  assert(o.barStart == -3 and o.barEnd == 5 and o.ticks[1] == 1.5 and o.barTo == nil, "a bar of its own")
  -- the spells: covers, when.spellID, and the spell of when.row
  local c = S:Covers(9001, { when = { row = "Swap" }, covers = { 77 } }, "mythic")
  assert(c[4242] and c[77], "the row's spell and covers")
  assert(S:Covers(9001, S:Get(9001, "tanks"), "mythic")[4242], "when.spellID")
  assert(S:CoveredBy(9001, "mythic", 4242) == S:Get(9001, "tanks"), "the ability's special alert")
  assert(S:CoveredBy(9001, "nh", 4242) == nil, "a Mythic-only one doesn't cover Normal/Heroic")
  assert(S:CoveredBy(9001, "mythic", nil, "orb burst") == S:Get(9001, "soaks"), "by its row's name")
  assert(S:CoveredBy(9001, "mythic", 999, "Other") == nil, "an ability none covers")
end)

check("special: no double alerts: your own reminder steps aside for the casts the special one alerts", function()
  fresh()
  -- the real blocks, fed test items: your reminders (coverable), your personal note (own, not coverable), the raid note
  local mineDef, personalDef, noteDef = A.blocks.mine, A.blocks.personal, A.blocks.note
  assert(mineDef and mineDef.coverable == true and mineDef.own == true, "your reminders are the coverable block")
  assert(personalDef and personalDef.own == true and not personalDef.coverable, "your personal note is yours, but never covered")
  assert(noteDef and not noteDef.coverable, "nor is the raid note")
  local saved = { mineDef.Entries, personalDef.Entries, noteDef.Entries }
  local function it(id, ph, t, spell) return { id = id, ph = ph, time = t, spellID = spell or 4242, text = id, outputs = { alert = true } } end
  local mine = { it("mine:a:1", 1, 40.5), it("mine:b:1", 1, 100), it("mine:c:1", 1, 70), it("mine:d:1", 2, 40), it("mine:e:1", 1, 40, 5555) }
  mineDef.Entries = function() return mine end
  personalDef.Entries = function() return { it("personal:1", 1, 40) } end
  noteDef.Entries = function() return { it("note:1", 1, 40) } end
  local function ids()
    local out = {}
    for _, x in ipairs(A.items) do if x.block == "mine" or x.block == "special" or x.block == "personal" or x.block == "note" then out[#out + 1] = x.id end end
    table.sort(out) return table.concat(out, ",")
  end
  -- a tank: the Tank swap rotation gives you its first cast (0:40) only
  role = "TANK" CRT.NoteEngine:ResetTokens()
  CRT.db.alerts.special[9001] = { everyone = { on = false } }
  A:Start(9001, "Mythic", "encounter", { difficultyID = 16 })
  assert(ids() == "mine:a:1,mine:b:1,mine:c:1,mine:d:1,mine:e:1,note:1,personal:1", "special off: all of yours: " .. ids())
  local tanks = S:Get(9001, "tanks")
  S:SetChoice(9001, tanks, "on", true)
  A:Start(9001, "Mythic", "encounter", { difficultyID = 16 })
  assert(ids() == "mine:b:1,mine:c:1,mine:d:1,mine:e:1,note:1,personal:1,special:tanks:1",
    "both on: the shared cast once, by the special alert; your personal note and the raid note keep theirs: " .. ids())
  -- outside the window it is another cast
  mine[1].time = 41.5
  A:Start(9001, "Mythic", "encounter", { difficultyID = 16 })
  assert(ids():find("mine:a:1", 1, true), "1.5 s apart: both")
  mine[1].time = 40.5
  -- a special alert that shows nowhere covers nothing
  for _, k in ipairs(S.SHOW_KEYS) do S:SetChoice(9001, tanks, k, false, true) end
  S:SetChoice(9001, tanks, "speak", false)
  A:Start(9001, "Mythic", "encounter", { difficultyID = 16 })
  assert(ids():find("mine:a:1", 1, true), "every output off: your reminder still alerts: " .. ids())
  A:Stop(true)
  mineDef.Entries, personalDef.Entries, noteDef.Entries = saved[1], saved[2], saved[3]
  assert(#errors == 0, tostring(errors[1]))
end)

print(ok_ .. " passed, " .. fail .. " failed")
if fail > 0 then error("special alerts: " .. fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
