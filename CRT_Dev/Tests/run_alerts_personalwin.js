// CRT_Modules/Notes/Window.lua: your personal reminders (CRT.AlertReminders, "Only me") in the personal note window,
// above the free text: the current boss's, by phase, counting down during a run.
// Args (in the TOC's order): CRT_Data/Bosses/Registry.lua CRT_Dev/Tests/SamplePack/Season.lua CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua
//   CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Notes/Engine.lua CRT_Modules/Notes/Window.lua
//   CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Alerts/Reminders.lua
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const files = process.argv.slice(2);
if (files.length < 13) { console.error('usage: node run_alerts_personalwin.js <13 files in TOC order>'); process.exit(2); }

const harness = themeLua(process.argv.slice(2)) + `
local sources = { ... }
local clock = 1000
function GetTime() return clock end
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-16 12:00" end
function time() return 1700000000 end
function InCombatLockdown() return false end
function UnitName(u) if u == "player" then return "Cheoeqar" end return nil end
function UnitGroupRolesAssigned() return "DAMAGER" end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
function IsInRaid() return false end
local instType = "none"
function IsInInstance() return instType ~= "none", instType end
function IsInGroup() return false end
function GetNumGroupMembers() return 1 end
function UnitIsUnit() return false end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
C_Timer = { After = function() end, NewTicker = function() return { Cancel = function() end } end }
local secrets = {}
function issecretvalue(v) return secrets[v] == true end
local SECRET = {}
secrets[SECRET] = true
C_Spell = {
  GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end,
  GetSpellName = function(id) return "Spell" .. id end,
  GetSpellTexture = function(id) return 100000 + id end,
}
RAID_CLASS_COLORS = {}
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end

-- Mock frames: shown state, text, scripts, events, children and font strings.
local all, named = {}, {}
local methods = {}
local function newObj(kind, parent, name)
  local o = setmetatable({ kind = kind, parent = parent, shown = true, scripts = {}, events = {},
    strings = {}, children = {}, text = "" }, { __index = function(t, k)
      local m = methods[k]
      if m then return m end
      return function() end
    end })
  if parent and type(parent) == "table" and parent.children then
    if kind == "FontString" then parent.strings[#parent.strings + 1] = o
    elseif kind ~= "Texture" then parent.children[#parent.children + 1] = o end
  end
  if name then named[name] = o end
  all[#all + 1] = o
  return o
end
function methods.Show(o) o.shown = true end
function methods.Hide(o) o.shown = false end
function methods.SetShown(o, v) o.shown = v and true or false end
function methods.IsShown(o) return o.shown end
function methods.SetScript(o, k, fn) o.scripts[k] = fn end
function methods.GetScript(o, k) return o.scripts[k] end
function methods.RegisterEvent(o, ev) o.events[ev] = true end
function methods.UnregisterEvent(o, ev) o.events[ev] = nil end
function methods.CreateFontString(o) return newObj("FontString", o) end
function methods.CreateTexture(o) return newObj("Texture", o) end
-- the note windows' "note updated" stamp: an animation group with one Alpha animation; Play records it
function methods.CreateAnimationGroup(o) return newObj("AnimationGroup", o) end
function methods.CreateAnimation(o) return newObj("Animation", o) end
function methods.Play(o) o.played = (rawget(o, "played") or 0) + 1 o.playing = true end
function methods.Stop(o) o.playing = false end
function methods.IsPlaying(o) return rawget(o, "playing") or false end
function methods.SetText(o, t) o.text = t end
function methods.GetText(o) return o.text end
function methods.GetFont() return "font", 14 end
function methods.GetStringWidth(o) return #tostring(o.text) * 8 end
function methods.GetWidth() return 100 end
function methods.GetHeight() return 100 end
function methods.GetPoint() return "CENTER", nil, "CENTER", 0, 0 end
function CreateFrame(kind, name, parent) return newObj(kind, parent, name) end
function CreateFont(name) return newObj("Font", nil, name) end
UIParent = newObj("Frame")
GameFontHighlight = newObj("Font")

local function fire(ev, ...)
  for _, o in ipairs(all) do
    if o.events[ev] and o.scripts.OnEvent then o.scripts.OnEvent(o, ev, ...) end
  end
end

local previewFns = {}
local noteText = "EncounterID:3470;Difficulty:Mythic;Name:Nek'zali\\ntime:10;ph:1;tag:Rixxy;text:Raid line;\\n"
local CRT = {
  PALETTE = { accent = { 0.78, 0.56, 0.36 } },
  db = {
    ui = { outline = "" }, classCache = {},
    timeline = { references = {}, nextRef = 1, record = false, rows = {}, bosses = {}, keep = 5 },
    notes = {
      list = { [1] = { raw = noteText, name = "Nek'zali note", encounterID = 3470, difficulty = "Mythic" } },
      nextId = 2, trustedOnly = true, active = 1,
      window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
      assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
      personal = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
      personalText = "Heal CDs: Cheoeqar",
      alert = { enabled = false, seconds = 10, tts = false, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" },
    },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
  UI = { Tint = function() end, OnTheme = function() end, RegisterLayer = function() end, RegisterPreview = function(_, k, fn) previewFns[k] = fn end,
    ResetButtonWidth = function() return 44 end, ResetButton = function(p) return newObj("Button", p) end },
  FONTS = {},
  FontPath = function() return "font" end,
  Print = function() end,
}
CRT_THEME(CRT, CRT.UI)
for i = 1, #sources, 2 do
  local before = #all
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
  -- The Timeline's recorder is not under test: its frames hear no events here.
  if sources[i]:find("CRT_Modules/Timeline/Data.lua", 1, true) then
    for j = before + 1, #all do all[j].events = {} end
  end
end
fire("ADDON_LOADED", "CowfeeRaidTools")
fire("PLAYER_LOGIN")

local R, A, Notes, NW = CRT.AlertReminders, CRT.Alerts, CRT.Notes, CRT.NoteWindow
local win = named.CowfeeRaidToolsNote_personal
-- the window draws its lines as rows; what it shows, as one text, is its DrawnText
local title = win.strings[1]
local body = setmetatable({}, { __index = function(_, k) if k == "text" then return NW:Get("personal"):DrawnText() end end })
local function show()
  NW:RefreshAll()
  return body.text
end
local function fresh()
  if A.running then fire("ENCOUNTER_END", 0) end
  A:Stop(true)
  CRT.db.alerts.reminders = {}
  CRT.db.alerts.nextId = 1
  CRT.db.notes.active = 1
  CRT.db.notes.personalText = "Heal CDs: Cheoeqar"
  CRT.db.notes.showOutsideRaid = true
  instType = "none"
  A:Fire()
end
local function at(text, s) return (text:find(s, 1, true)) end
local function before(text, a, b)
  local i, j = at(text, a), at(text, b)
  assert(i, "missing: " .. a .. "\\nin:\\n" .. text)
  assert(j, "missing: " .. b .. "\\nin:\\n" .. text)
  assert(i < j, a .. " not before " .. b .. "\\nin:\\n" .. text)
end
local function GOLD_NOW() return "|cff" .. CRT.UI.Hex("heading") end -- the theme's heading colour
local GOLD = GOLD_NOW()
local ICON = "|T131884:0|t "

local results, failures = {}, {}
local function test(name, fn)
  fresh()
  local ok, err = pcall(fn)
  if ok and #errors > 0 then ok, err = false, "error handler: " .. errors[1] end
  wipe(errors)
  results[#results + 1] = (ok and "ok " or "FAIL ") .. name .. (ok and "" or (": " .. tostring(err)))
end

test("window: lists the boss's reminders by phase", function()
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Soak", spellID = 31884, times = "P1 0:30, 1:15; P2 0:20" })
  -- the window follows a reminder saved now, without waiting for its safety rebuild
  local text = show()
  assert(win.shown, "window shown")
  assert(title.text == "Personal note", "title: " .. tostring(title.text))
  assert(at(text, GOLD .. "Nek'zali the Soulcoiler|r"), "boss heading from the boss library:\\n" .. text)
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Move", times = "P1 0:45" })
  text = show()
  before(text, "Nek'zali the Soulcoiler", GOLD .. "Phase 1|r")
  before(text, GOLD .. "Phase 1|r", "0:30|r  " .. ICON .. "Soak")
  before(text, "0:30|r  " .. ICON .. "Soak", "0:45|r  Move")
  before(text, "0:45|r  Move", "1:15|r  " .. ICON .. "Soak")
  before(text, "1:15|r  " .. ICON .. "Soak", GOLD .. "Phase 2|r")
  before(text, GOLD .. "Phase 2|r", "0:20|r  " .. ICON .. "Soak")
  -- the free text stays, below the reminders
  before(text, "0:20|r  " .. ICON .. "Soak", "Heal CDs:")
  -- out of a run nothing is marked as next
  assert(not at(text, GOLD .. "> 0:") and not at(text, GOLD .. "> 1:"), "no next marker out of a run:\\n" .. text)
  -- a turned-off reminder isn't listed
  R:Save(3470, 2, { boss = "Nek'zali the Soulcoiler", text = "Move", times = "P1 0:45", enabled = false })
  assert(not at(show(), "Move"), "disabled reminder listed")
end)

test("window: out of a run, only the note's difficulty group", function()
  -- the note in use is Mythic: Mythic's own reminders, not Normal/Heroic's (saved per group or as older text)
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Mythic one", times = "P1 0:31" }, "mythic")
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Heroic one", times = "P1 0:32" }, "nh")
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Old normal", times = "P1 0:33", difficulty = "Normal" })
  local text = show()
  assert(at(text, "Mythic one") and not at(text, "Heroic one") and not at(text, "Old normal"), "Mythic's only:\\n" .. text)
end)

test("window: a note of no difficulty lists a split reminder once", function()
  -- a reminder split into one per group: outside a raid, a note of no difficulty reads Normal/Heroic's
  local id = R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Split one", times = "P1 0:34" })
  assert(R.SplitOne(3470, id), "split")
  local was = CRT.db.notes.list[1].difficulty
  CRT.db.notes.list[1].difficulty = nil
  Notes:Fire()
  local text = show()
  CRT.db.notes.list[1].difficulty = was
  Notes:Fire()
  local _, n = text:gsub("Split one", "")
  assert(n == 1, "listed once, not " .. n .. " times:\\n" .. text)
end)

test("window: a pasted raid note shows as its boss and timed lines", function()
  CRT.db.notes.active = nil
  CRT.db.notes.personalText = table.concat({
    "EncounterID:3379;Difficulty:Mythic;Name:Nymrissa Wavecaller;",
    "ph:1;time:76.3;tag:Solex;spellid:383410;",
    "ph:1;time:34.0;tag:Solex;spellid:383410;",
    "ph:2;time:12;tag:Solex;text:Move out;",
    "Soak with group 2",
  }, "\\n")
  Notes:Fire()
  local text = show()
  assert(not at(text, "EncounterID:") and not at(text, "time:34"), "the raw lines are not shown:\\n" .. text)
  before(text, GOLD .. "Nymrissa Wavecaller|r", "(Mythic)")
  before(text, "(Mythic)", GOLD .. "Phase 1|r")
  before(text, GOLD .. "Phase 1|r", "0:34")
  before(text, "0:34", "1:16")
  before(text, "1:16", GOLD .. "Phase 2|r")
  before(text, GOLD .. "Phase 2|r", "Move out")
  before(text, "Move out", "Soak with group 2")
end)

test("window: markdown in the personal note", function()
  CRT.db.notes.active = nil
  CRT.db.notes.personalText = table.concat({ "# Tank swaps", "- **Taunt** at 3 stacks", "---", "plain: line" }, "\\n")
  Notes:Fire()
  local text = show()
  assert(at(text, GOLD .. "Tank swaps|r") and not at(text, "# Tank"), "a heading:\\n" .. text)
  assert(at(text, "\\226\\128\\162 ") and at(text, "|cffffb84dTaunt|r") and not at(text, "**"), "a bullet with bold:\\n" .. text)
  assert(not at(text, GOLD .. "  \\226\\128\\162"), "a bullet is not made a heading:\\n" .. text)
  assert(at(text, "------"), "a divider:\\n" .. text)
  assert(at(text, "plain: line"), "plain text kept:\\n" .. text)
end)

test("window: display my notes first", function()
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Soak", spellID = 31884, times = "P1 0:30" })
  local text = show()
  before(text, "Soak", "Heal CDs:")
  CRT.db.notes.personalFirst = true
  Notes:Fire()
  text = show()
  before(text, "Heal CDs:", "Soak")
  CRT.db.notes.personalFirst = nil
end)

test("window: counts down in a run", function()
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Soak", spellID = 31884, times = "P1 0:30; P2 0:20" })
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Move", times = "P1 0:45" })
  local pullAt = 5000
  clock = pullAt
  fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
  assert(A.running, "run started")
  clock = pullAt + 10
  local text = show()
  assert(at(text, GOLD .. "> 0:20|r  " .. ICON .. "Soak"), "next one marked, counting down:\\n" .. text)
  assert(at(text, "0:35|r  Move") and not at(text, "> 0:35"), "later one plain:\\n" .. text)
  before(text, "Soak", "Move")
  assert(at(text, "Phase 2 starts on Next phase"), "phase 2 waits:\\n" .. text)
  before(text, "Move", "Heal CDs:")
  -- the clock moves: the window redraws each refresh while the run goes (no content change)
  clock = pullAt + 11
  assert(at(show(), "> 0:19|r"), "live countdown:\\n" .. body.text)
  -- once passed, hidden like the timers window's Hide lines once passed
  clock = pullAt + 40
  text = show()
  assert(not at(text, "Soak"), "passed one hidden:\\n" .. text)
  assert(at(text, GOLD .. "> 0:05|r  Move"), "next is now Move:\\n" .. text)
  CRT.db.notes.window.hidePassed = false
  text = show()
  assert(at(text, "0:00|r  " .. ICON .. "Soak"), "passed one kept with Hide off:\\n" .. text)
  before(text, "Soak", "> 0:05|r  Move")
  CRT.db.notes.window.hidePassed = true
  -- Next phase starts P2: its reminder counts from there
  clock = pullAt + 50
  A:NextPhase()
  clock = pullAt + 52
  text = show()
  assert(at(text, GOLD .. "> 0:18|r  " .. ICON .. "Soak"), "P2 counting:\\n" .. text)
  assert(not at(text, "starts on Next phase"), "P2 no longer waits:\\n" .. text)
  fire("ENCOUNTER_END", 3470)
  assert(not A.running)
  text = show()
  assert(at(text, "0:30|r  " .. ICON .. "Soak") and not at(text, GOLD .. "> 0:"), "back to the full list after the pull:\\n" .. text)
end)

test("window: a later phase hides an earlier phase's reminders", function()
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Move", times = "P1 0:45" })
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Early", times = "P1 0:20" })
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Soak", spellID = 31884, times = "P2 0:20" })
  CRT.db.notes.window.hidePassed = false
  local pullAt = 7000
  clock = pullAt
  fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
  clock = pullAt + 30
  assert(at(show(), "0:15|r  Move"), "before phase 2 Move counts down:\\n" .. body.text)
  A:NextPhase()
  clock = pullAt + 31
  local text = show()
  assert(not at(text, "Move"), "Move (P1 0:45) hidden once phase 2 starts at 0:30:\\n" .. text)
  assert(at(text, "Early"), "Early (P1 0:20, before the cut) still listed with Hide off:\\n" .. text)
  assert(at(text, GOLD .. "> 0:19|r  " .. ICON .. "Soak"), "phase 2 counts:\\n" .. text)
  CRT.db.notes.window.hidePassed = true
  fire("ENCOUNTER_END", 3470)
end)

test("window: no boss, text only", function()
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Soak", times = "P1 0:30" })
  CRT.db.notes.active = nil
  Notes:Fire()
  local text = show()
  assert(win.shown, "shown for the text")
  assert(text == NW.FormatText({ "Heal CDs: Cheoeqar" }), "only the free text:\\n" .. text)
  -- a pull whose boss can't be read (a secret value), and no note in use: still only the text
  clock = 9000
  fire("ENCOUNTER_START", SECRET, "x", 16)
  text = show()
  assert(text == NW.FormatText({ "Heal CDs: Cheoeqar" }), "secret encounter, text only:\\n" .. text)
  fire("ENCOUNTER_END", 0)
  -- no text and no boss: nothing to show
  CRT.db.notes.personalText = ""
  Notes:Fire()
  show()
  assert(not win.shown, "hidden with nothing to show")
end)

test("window: other boss's reminders not shown", function()
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Soak", times = "P1 0:30" })
  R:Save(3471, nil, { boss = "Other Boss", text = "Elsewhere", times = "P1 0:40" })
  local text = show()
  assert(at(text, "Soak") and not at(text, "Elsewhere"), "only the note's boss:\\n" .. text)
  -- the running encounter wins over the note in use
  clock = 12000
  fire("ENCOUNTER_START", 3471, "Other Boss", 16)
  clock = 12001
  text = show()
  assert(at(text, "Elsewhere") and not at(text, "Soak"), "the running boss's:\\n" .. text)
  assert(at(text, GOLD .. "Other Boss|r"), "a boss outside the library is named by its reminder:\\n" .. text)
  fire("ENCOUNTER_END", 3471)
  -- an editor Test run isn't a boss: the note's boss stays
  A:Start(3471, nil, "test", { blocks = {} })
  text = show()
  assert(at(text, "Soak") and not at(text, "Elsewhere"), "a test run keeps the note's boss:\\n" .. text)
  A:Stop()
end)

test("theme: the headings follow a live switch (Blackout: Midnight's heading, then the game's gold again)", function()
  R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Soak", spellID = 31884, times = "P1 0:30" })
  assert(at(show(), GOLD .. "Phase 1|r"), "the game's gold first")
  CRT.UI.SwitchTheme("midnight")
  local text = body.text
  CRT.UI.SwitchTheme("blizzard")
  assert(at(text, "|cffbdbdbdPhase 1|r") and at(text, "|cffbdbdbdNek'zali the Soulcoiler|r"), "Midnight's heading, redrawn by the switch:\\n" .. text)
  assert(GOLD == "|cffffd100", "Default: Blizzard's heading is the game's gold")
end)

test("window: a run with no reminders is not live", function()
  -- each rebuild reads the free text once: count them
  local builds, orig = 0, Notes.Personal
  Notes.Personal = function(...) builds = builds + 1 return orig(...) end
  local ok, err = pcall(function()
    clock = 15000
    fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
    assert(A.running, "run started")
    show() show()
    builds = 0
    for i = 1, 5 do clock = 15000 + i / 10 show() end
    assert(builds == 0, "no reminders: the normal refresh, not every 0.1 s: " .. builds)
    fire("ENCOUNTER_END", 3470)
    -- a reminder for the running boss: live again
    R:Save(3470, nil, { boss = "Nek'zali the Soulcoiler", text = "Soak", times = "P1 0:30" })
    clock = 16000
    fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
    show() show()
    builds = 0
    for i = 1, 5 do clock = 16000 + i / 10 show() end
    assert(builds == 5, "with a reminder: live: " .. builds)
    fire("ENCOUNTER_END", 3470)
    -- the boss from the note, not a run: not live even with reminders
    clock = 17000
    A:Start(3471, nil, "test", { blocks = {} })
    show() show()
    builds = 0
    for i = 1, 5 do clock = 17000 + i / 10 show() end
    assert(builds == 0, "a test run of another boss: not live: " .. builds)
    A:Stop()
  end)
  Notes.Personal = orig
  assert(ok, err)
end)

test("show outside of raid: hides the note windows in the open world, not in a raid or a preview", function()
  local assign = named.CowfeeRaidToolsNote_assignments
  CRT.db.notes.showOutsideRaid = nil
  assert(not NW.AllowedHere(), "no setting counts as off")
  CRT.db.notes.showOutsideRaid = true
  Notes:Fire()
  assert(NW.AllowedHere(), "ticked: allowed outside")
  show()
  assert(win.shown, "shown outside a raid when ticked")
  CRT.db.notes.showOutsideRaid = false
  Notes:Fire()
  assert(not NW.AllowedHere(), "not allowed in the open world")
  show()
  assert(not win.shown, "hidden outside a raid when unticked")
  instType = "party"
  Notes:Fire()
  show()
  assert(not win.shown, "a dungeon counts as outside")
  instType = "raid"
  fire("PLAYER_ENTERING_WORLD")
  assert(NW.AllowedHere() and win.shown, "entering a raid shows it without waiting")
  instType = "none"
  fire("ZONE_CHANGED_NEW_AREA")
  assert(not win.shown, "a zone change out of the raid hides it")
  previewFns.note(true)
  NW:RefreshAll()
  assert(win.shown, "a preview shows it anyway")
  previewFns.note(false)
  NW:RefreshAll()
  assert(not win.shown, "hidden again after the preview")
  CRT.db.notes.showOutsideRaid = true
  Notes:Fire()
  show()
  assert(win.shown, "ticked: shown outside")
end)

test("stamp: a cleared note keeps the shared windows up for the stamp, then hides", function()
  local assign = named.CowfeeRaidToolsNote_assignments
  CRT.db.notes.list[9] = { raw = "EncounterID:3513;Difficulty:Heroic;Name:Kith'ix", name = "Kith'ix", encounterID = 3513, difficulty = "Heroic" }
  CRT.db.notes.active = 9
  Notes:Fire()
  NW:RefreshAll()
  assert(not assign.shown, "a note with nothing for the window: hidden")
  NW:Flash()
  NW:RefreshAll()
  local w = NW:Get("assignments")
  assert(assign.shown and w:DrawnText() == "" and assign.strings[1].text == "", "up for the stamp, blank (no title, no text): " .. tostring(assign.strings[1].text) .. " / " .. tostring(w:DrawnText()))
  assert(rawget(w.stamp, "playing"), "the stamp plays")
  NW:RefreshAll()
  assert(assign.shown, "stays up while the stamp plays")
  w.stamp.playing = false
  w.stamp.scripts.OnFinished(w.stamp)
  NW:RefreshAll()
  assert(not assign.shown, "hidden again once the stamp ends")
  -- Keep up when empty: the window stays up, blank, before and after the stamp
  CRT.db.notes.assignments = CRT.db.notes.assignments or {}
  CRT.db.notes.assignments.keepEmpty = true
  Notes:Fire()
  NW:RefreshAll()
  assert(assign.shown and w:DrawnText() == "" and assign.strings[1].text == "", "kept up when empty, blank")
  CRT.db.notes.assignments.keepEmpty = nil
  CRT.db.notes.list[9] = nil
  CRT.db.notes.active = 1
  Notes:Fire()
end)

test("assignment lines: your class marks the line, a sentence never does", function()
  local ORB = { "Orb Soak 1: Demon Hunter Warlock Priest Monk", "Orb Soak 2: Shaman Monk Druid Rogue",
    "Orb Soak 3: Mage Warlock Death Knight Warrior", "Orb Soak 4: Hunter", "Note: the hunter kites",
    "Note: the Hunter kites", "Soak: priest, monk",
    "Soak 1: {star} Abu PRIEST", "Kicks: Abu > MAGE > rogue", "Kicks: 1 mage 2 ROGUE", "Soak: Abu (left), priest",
    "Soak: |cffff0000Abu|r / priest -> {rt1}" }
  local function marked(file)
    UnitClass = function(u) if u == "player" then return "x", file end end
    clock = clock + 10
    local out = {}
    for i, line in ipairs(ORB) do
      local mark = CRT.UI.HeadingText("> ") -- the line's own mark, not an arrow in its text
      if NW.FormatText({ line }):sub(1, #mark) == mark then out[#out + 1] = i end
    end
    return table.concat(out, ",")
  end
  assert(marked("DEMONHUNTER") == "1", "a Demon Hunter: " .. marked("DEMONHUNTER"))
  assert(marked("HUNTER") == "4", "a Hunter, not on Demon Hunter nor the sentence: " .. marked("HUNTER"))
  assert(marked("DEATHKNIGHT") == "3", "a Death Knight: " .. marked("DEATHKNIGHT"))
  assert(marked("MONK") == "1,2,7", "a Monk, the lower-case list too: " .. marked("MONK"))
  assert(marked("PRIEST") == "1,7,8,11,12", "a Priest, with icons, brackets and colour codes: " .. marked("PRIEST"))
  assert(marked("MAGE") == "3,9,10", "a Mage, with arrows and numbers: " .. marked("MAGE"))
  assert(marked("ROGUE") == "2,9,10", "a Rogue: " .. marked("ROGUE"))
  UnitClass = nil
  clock = clock + 10
end)

return table.concat(results, "\\n")
`;

const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.log('FAIL load: ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, files.length * 2 + 8);
for (const p of files) {
  const rel = p.replace(/\\/g, '/').replace(/^.*?\/(Bosses|Seasons|Alerts|Notes|Timeline)\//, '$1/');
  lua.lua_pushstring(L, to_luastring(rel));
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(p, 'utf8')));
}
if (lua.lua_pcall(L, files.length * 2, 1, 0) !== lua.LUA_OK) { console.log('FAIL run: ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
const out = lua.lua_tojsstring(L, -1);
console.log(out);
const failed = out.split('\n').filter((l) => l.startsWith('FAIL')).length;
if (failed) { console.log(failed + ' failed'); process.exit(1); }
