// Task 3: the note timers on the alerts engine. Runs the old CRT_Modules/Notes/Engine.lua + CRT_Modules/Notes/Alert.lua (from main)
// and the new ones (on CRT.Alerts) in two separate Lua states with the same mocked clock, and compares
// what the player sees: the alert frame (shown, label, countdown), the timers window and the spoken text.
// Args: old_Engine.lua old_Alert.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua
//       CRT_Modules/Notes/Engine.lua CRT_Modules/Notes/Window.lua CRT_Modules/Notes/Alert.lua  CRT_Modules/Alerts/Speech.lua (last, optional, loaded after CRT_Modules/Alerts/Engine.lua)
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const a = process.argv.slice(2);
if (a.length < 9) { console.error('usage: node run_alerts_notes.js old_Engine old_Alert Rules AlertsEngine Parse Data Engine Window Alert'); process.exit(2); }
const [oldEngine, oldAlert, rules, alertsEngine, parse, data, engine, windowSrc, alert, speech, soundEngine] = a;
const read = (p) => fs.readFileSync(p, 'utf8');

// The lint folder's sample note plus: a text line of yours with dur:8, a line for another player,
// a spell of yours at the pull and one that passed before the pull.
const noteText = read(path.join(__dirname, 'sample_note.txt')).replace(/\r/g, '').replace(
  'time:3;ph:1;tag:Crazyoio;spellid:31884;',
  'time:3;ph:1;tag:Crazyoio;spellid:31884;\n' +
  'time:15;ph:1;tag:Rixxy;text:Other player line;dur:8;\n' +
  'time:20;ph:1;tag:Cheoeqar;text:Move out;dur:8;colors:1 1 0 1;\n' +
  'time:0;ph:1;tag:Cheoeqar;spellid:1022;\n' +
  'time:-5;ph:1;tag:Cheoeqar;spellid:1044;\n' +
  'time:57;ph:1;tag:Cheoeqar;text:Short line;\n' +
  'time:44;ph:1.5;tag:Cheoeqar;text:Later phase text;dur:8;');

const harness = `
local mode, noteText = ...
-- A note with only ph:2 lines: today its first phase (2) starts at the pull.
local ph2Text = [[
EncounterID:3471;Difficulty:Mythic;Name:Phase two boss
time:5;ph:2;tag:Cheoeqar;spellid:31884;
time:8;ph:2;tag:Rixxy;spellid:363534;
time:12;ph:2;tag:Cheoeqar;text:Phase two text;dur:4;
time:30;ph:2;tag:ranged;text:Spread;
]]
local files = { select(3, ...) }
local clock = 1000
function GetTime() return clock end
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-15 12:00" end
function InCombatLockdown() return false end
function UnitName(u) if u == "player" then return "Cheoeqar" end return nil end
function UnitGroupRolesAssigned() return "DAMAGER" end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
function IsInRaid() return false end
function GetNumGroupMembers() return 1 end
function UnitIsUnit() return false end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
C_Spell = { GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
RAID_CLASS_COLORS = {}
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end

local said = {}
local pullAt = clock
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
C_VoiceChat = { SpeakText = function(id, text) said[#said + 1] = format("%d %.1f %s", pullAt, clock - pullAt, text) end }

-- Mock frames: track shown state, text, scripts, events, children and font strings.
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
    elseif kind == "Texture" then -- not a child frame
    else parent.children[#parent.children + 1] = o end
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
function methods.CreateFontString(o) return newObj("FontString", o) end
function methods.CreateTexture(o) return newObj("Texture", o) end
-- the note windows' "note updated" stamp: an animation group with one Alpha animation; Play records it
function methods.CreateAnimationGroup(o) return newObj("AnimationGroup", o) end
function methods.CreateAnimation(o) return newObj("Animation", o) end
function methods.Play(o) o.played = (rawget(o, "played") or 0) + 1 end
function methods.SetText(o, t) o.text = t end
function methods.SetTexture(o, t) o.texture = t end
function methods.SetTextColor(o, r, g, b) o.color = { r, g, b } end
function methods.GetText(o) return o.text end
function methods.GetFont() return "font", 18 end
function methods.GetStringWidth(o) return #tostring(o.text) * 8 end
function methods.GetUnboundedStringWidth(o) return #tostring(o.text) * 8 end
function methods.SetWidth(o, w) o.width = w end
function methods.GetWidth(o) return 100 end
function methods.GetHeight() return 100 end
function methods.GetCenter() return 0, 0 end
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

local printed = {}
local CRT = {
  MOCHA = { caramel = { 0.78, 0.56, 0.36 } },
  db = {
    ui = { outline = "" }, classCache = {},
    notes = {
      list = { [1] = { raw = noteText, name = "Nek'zali", encounterID = 3470, difficulty = "Mythic" },
        [2] = { raw = ph2Text, name = "Phase two boss", encounterID = 3471, difficulty = "Mythic" } },
      nextId = 3, trustedOnly = true,
      window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, width = 420, height = 300, font = "Friz Quadrata" },
      assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
      personal = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, font = "Friz Quadrata" },
      personalText = "",
      alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" },
    },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
  UI = { RegisterLayer = function() end, RegisterPreview = function(_, k, fn) CRT_previewFns = CRT_previewFns or {} CRT_previewFns[k] = fn end,
    ResetButtonWidth = function() return 44 end, ResetButton = function(p) return newObj("Button", p) end },
  FONTS = {},
  FontPath = function() return "font" end,
  Print = function(_, m) printed[#printed + 1] = m end,
}
for i = 1, #files, 2 do
  assert(load(files[i + 1], "@" .. files[i]))("CowfeeRaidTools", CRT)
end
fire("PLAYER_LOGIN")

local Engine, Notes = CRT.NoteEngine, CRT.Notes
local alertFrame = named.CowfeeRaidToolsNoteAlert
local block = alertFrame.children[1]
local label, countdown = block.strings[1], block.strings[2]
local win = named.CowfeeRaidToolsNote_window
local winTitle, winBody = win.strings[1], win.strings[2]

local out = {}
local speechDriver
local function snap(tag)
  CRT.NoteWindow:RefreshAll()
  -- The speech queue's own 0.1 s ticker (new side only); the game's finished event follows each line.
  if CRT.AlertSpeech then
    if not speechDriver then
      for _, o in ipairs(all) do if o.events.VOICE_CHAT_TTS_PLAYBACK_FINISHED then speechDriver = o end end
    end
    speechDriver.scripts.OnUpdate(speechDriver, 0.1)
    speechDriver.scripts.OnEvent(speechDriver, "VOICE_CHAT_TTS_PLAYBACK_FINISHED")
  end
  CRT.NoteAlert:Refresh()
  out[#out + 1] = format("%s|t=%.1f|alert=%s|%s|%s|win=%s|%s|%s|said=%d", tag, clock - pullAt,
    tostring(alertFrame.shown), tostring(label.text), tostring(countdown.text),
    tostring(win.shown), tostring(winTitle.text), tostring(winBody.text), #said)
end

local results = {}

-- A: a pull, no Next phase, 0 to 120 s.
pullAt = 1000; clock = pullAt
fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
for i = 0, 1200 do clock = pullAt + i / 10; snap("A") end
fire("ENCOUNTER_END", 3470)
clock = clock + 0.1; snap("A-end")
out[#out + 1] = "A-running=" .. tostring(Engine.running) .. " note=" .. tostring(Engine:Note() ~= nil)

-- B: a pull, Next phase at 40 s (1.5) and at 80 s (1.75).
pullAt = 5000; clock = pullAt
fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
for i = 0, 1200 do
  clock = pullAt + i / 10
  if i == 400 then
    local ph = Engine:NextPhase()
    out[#out + 1] = "B-next40=" .. tostring(ph) .. " current=" .. tostring(Engine:CurrentPhase())
    results.next40 = ph
    snap("B-after-next40")
    results.win40 = winBody.text
  elseif i == 800 then
    local ph = Engine:NextPhase()
    out[#out + 1] = "B-next80=" .. tostring(ph) .. " started1.75=" .. tostring(Engine:PhaseStarted(1.75)) .. " started2=" .. tostring(Engine:PhaseStarted(2))
  end
  snap("B")
end
fire("ENCOUNTER_END", 3470)
clock = clock + 0.1; snap("B-end")

-- C: a test run for 20 s, Next phase, then Stop.
pullAt = 9000; clock = pullAt
Engine:Start(Notes:Parsed(1), "test")
for i = 0, 200 do clock = pullAt + i / 10; snap("C") end
fire("ENCOUNTER_END", 3470)
out[#out + 1] = "C-after-end running=" .. tostring(Engine.running)
out[#out + 1] = "C-next=" .. tostring(Engine:NextPhase())
clock = clock + 0.1; snap("Mask-C")
Engine:Stop()
clock = clock + 0.1; snap("C-stop")
out[#out + 1] = "C-stopped running=" .. tostring(Engine.running) .. " note=" .. tostring(Engine:Note() ~= nil) .. " next=" .. tostring(Engine:NextPhase())

-- D: a pull of a boss with no note: nothing runs for the note, as before.
pullAt = 12000; clock = pullAt
fire("ENCOUNTER_START", 9999, "Other boss", 16)
for i = 0, 100 do clock = pullAt + i / 10; snap("C-nonote") end
out[#out + 1] = "C-nonote running=" .. tostring(Engine.running) .. " phase=" .. tostring(Engine.running and Engine:CurrentPhase()) .. " next=" .. tostring(Engine:NextPhase())
fire("ENCOUNTER_END", 9999)

-- E: a pull of the boss whose note has only ph:2 lines: it counts from the pull.
pullAt = 15000; clock = pullAt
fire("ENCOUNTER_START", 3471, "Phase two boss", 16)
for i = 0, 400 do clock = pullAt + i / 10; snap("C-ph2") end
out[#out + 1] = "C-ph2 phase=" .. tostring(Engine:CurrentPhase()) .. " started2=" .. tostring(Engine:PhaseStarted(2)) .. " next=" .. tostring(Engine:NextPhase())
fire("ENCOUNTER_END", 3471)
clock = clock + 0.1; snap("C-ph2-end")

-- F: the Next spell alert off but speech on. The old addon said nothing; since ruling B2 the new one
-- reads the note lines out anyway. What F says is kept out of the old-vs-new comparison.
-- G: speech off as well: nothing is spoken (old and new alike).
local function pullQuiet(base)
  local saidBefore = #said
  pullAt = base; clock = pullAt
  fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
  for i = 0, 1200 do clock = pullAt + i / 10; snap("F") end
  fire("ENCOUNTER_END", 3470)
  local n = #said - saidBefore
  for i = #said, saidBefore + 1, -1 do table.remove(said, i) end
  return n
end
CRT.db.notes.alert.enabled = false
results.silent = pullQuiet(20000)
CRT.db.notes.alert.tts = false
results.mute = pullQuiet(30000)
CRT.db.notes.alert.tts = true
CRT.db.notes.alert.enabled = true

for _, s in ipairs(said) do out[#out + 1] = "said " .. s end
for _, e in ipairs(errors) do out[#out + 1] = "error " .. e end

-- New-side checks.
if mode == "new" then
  local A = CRT.Alerts
  -- test run and stop
  Engine:Start(Notes:Parsed(1), "test")
  assert(A.running and Engine.running and A.run.reason == "test" and Engine.runId == A.runId, "test run started")
  -- other player's line has no outputs; your lines have the brief's outputs
  local note = Engine:Note()
  local byId = {}
  for _, it in ipairs(A.items) do if it.block == "note" then byId[it.id] = it end end
  local other, mine = 0, 0
  for index, t in ipairs(note.timers) do
    local it = byId["note:" .. index]
    assert(it, "item for timer " .. index)
    assert(it.ph == t.ph and it.time == t.time, "item timing")
    if Engine:IsMine(t) then
      mine = mine + 1
      local s = Notes:Alert()
      assert(it.outputs and it.outputs.alert == true and it.outputs.bar == true and it.outputs.speech == true, "mine outputs")
      assert(it.priority == CRT.AlertRules.Priority(2, "normal") and it.warn == s.seconds, "mine rank/warn")
      assert(it.hold == (t.kind == "text" and (t.dur or 0) or 0.5), "mine hold")
      assert(it.speech and #it.speech == 1 and it.speech[1].offset == s.ttsSeconds, "mine speech")
      assert(it.speech[1].text == (t.kind == "spell" and ("Spell" .. t.spellId) or t.text), "speech text")
    else
      other = other + 1
      assert(not (it.outputs and (it.outputs.alert or it.outputs.bar or it.outputs.speech)), "other has outputs: " .. index)
      assert(not (it.speech and #it.speech > 0), "other has speech")
    end
  end
  assert(other > 0 and mine > 0)
  -- bars gating
  CRT.db.alerts.bars.noteLines = false
  Engine:Start(Notes:Parsed(1), "test")
  for _, it in ipairs(A.items) do assert(not (it.outputs and it.outputs.bar), "noteLines off") end
  CRT.db.alerts.bars.noteLines = true
  Engine:Stop()
  assert(not A.running and not Engine.running and Engine:Note() == nil, "stopped")
  results.testStop = true
  -- PhasesFor without a run finds the note for the boss
  local ph = A:PhasesFor({ encounterID = 3470, difficultyName = "Mythic" })
  assert(#ph == 4 and ph[2] == 1.5 and ph[3] == 1.75 and ph[4] == 2, "phasesFor without a run")
  -- PhasesFor another boss during a running pull uses that boss's note, not the running one
  fire("ENCOUNTER_START", 3470, "Nek'zali", 16)
  assert(A.running and Engine:Note() == Notes:Parsed(1))
  local other2 = A:PhasesFor({ encounterID = 3471, difficultyName = "Mythic" })
  assert(#other2 == 1 and other2[1] == 2, "phasesFor other boss during a pull: " .. table.concat(other2, ","))
  local same = A:PhasesFor({ encounterID = 3470, difficultyName = "Mythic" })
  assert(#same == 4 and same[1] == 1, "phasesFor same boss during a pull")
  local cur = A:Phases()
  assert(#cur == 4 and cur[1] == 1, "current run phases")
  fire("ENCOUNTER_END", 3470)
  results.other = other

  -- A block of reminders (grouping on, like "mine"), handed out only while remOn is set.
  local remOn = false
  local function rem(id, ph, t, text)
    return { id = id, ph = ph, time = t, spellID = 31884, text = text, priority = CRT.AlertRules.Priority(3, "normal"),
      warn = 10, hold = 0.5, outputs = { alert = true, bar = true, speech = false } }
  end
  A:RegisterBlock("rem", { label = "Reminders", group = true, Entries = function(run)
    if not remOn then return {} end
    local p2 = rem("r2", 2, 20, "P2 soak")
    p2.spellID = nil
    return { rem("r1", 1, 5, "Soak"), p2 }
  end })

  -- a pull with reminders but no note: Next phase (what /crt note next calls) starts P2
  remOn = true
  pullAt = 30000; clock = pullAt
  fire("ENCOUNTER_START", 9999, "Other boss", 16)
  assert(A.running and not Engine.running and Engine:Note() == nil, "reminders-only run, no note")
  assert(Engine:PeekNextPhase() == 2, "peek names P2")
  clock = pullAt + 2
  assert(Engine:NextPhase() == 2, "reminders-only: Next phase starts P2")
  assert(A:PhaseStart(2) == pullAt + 2, "P2 started now")
  local hasP2 = false
  for _, l in ipairs(A:Lines(clock)) do if l.text == "P2 soak" then hasP2 = true end end
  assert(hasP2, "P2 reminder is a line")
  results.remNext = true
  fire("ENCOUNTER_END", 9999)

  -- the alert shows a reminder's own text, not the spell's name
  pullAt = 31000; clock = pullAt
  fire("ENCOUNTER_START", 9999, "Other boss", 16)
  clock = pullAt + 1
  CRT.NoteAlert:Refresh()
  assert(alertFrame.shown and label.text == "Soak", "reminder text on the alert: " .. tostring(label.text))
  results.remText = true
  -- the Next spell alert's drag box is wide enough for its whole title and Reset (44 wide)
  if mode == "new" then
    local handle, title
    for _, c in ipairs(alertFrame.children) do
      for _, fs in ipairs(c.strings) do if tostring(fs.text):find("drag to move") then handle, title = c, fs end end
    end
    assert(handle, "drag box with the title")
    local need = 6 + (#'Your next spell: drag to move' * 8) + 4 + 44
    assert(handle.width and handle.width >= need, "drag box fits the title: " .. tostring(handle.width) .. " < " .. need)
    -- a font change shows as a longer title: measured again when Previews turn on
    local before = handle.width
    title.text = string.rep("w", 60) .. " drag to move"
    CRT_previewFns.alert(true)
    local need2 = 6 + (#title.text * 8) + 4 + 44
    assert(handle.width > before and handle.width >= need2, "drag box measured again on Previews: " .. before .. " -> " .. tostring(handle.width))
    CRT_previewFns.alert(false)
  end
  fire("ENCOUNTER_END", 9999)

  -- a /crt note test run replaced by another test run (the editor's Test) drops the note
  remOn = false
  Engine:Start(Notes:Parsed(1), "test")
  assert(Engine.running and Engine:Note() ~= nil, "note test running")
  remOn = true
  A:Start(3470, nil, "test", { blocks = { rem = true } })
  assert(A.running and not Engine.running and Engine:Note() == nil, "note dropped when another test replaces it")
  A:Stop()
  remOn = false
  results.replaced = true

  -- a note line with show: puts its own text, icon and colour on the Next spell alert; without show:
  -- the same spell line keeps the spell's name and icon
  CRT.db.notes.list[3] = { raw = "EncounterID:3472;Name:Show boss\\n"
    .. "time:5;ph:1;tag:Cheoeqar;spellid:31884;text:Dodge now;colors:1 0 0 1;show:alert;icon:135940;\\n"
    .. "time:30;ph:1;tag:Cheoeqar;spellid:31884;text:Ignored;", name = "Show boss", encounterID = 3472 }
  local alertIcon
  for _, o in ipairs(all) do if o.kind == "Texture" and o.parent == alertFrame then alertIcon = o end end
  pullAt = 32000; clock = pullAt
  fire("ENCOUNTER_START", 3472, "Show boss", 16)
  clock = pullAt + 1
  CRT.NoteAlert:Refresh()
  assert(alertFrame.shown and label.text == "Dodge now", "show: line's own text: " .. tostring(label.text))
  assert(alertIcon and alertIcon.texture == 135940, "show: line's own icon: " .. tostring(alertIcon and alertIcon.texture))
  assert(label.color and label.color[1] == 1 and label.color[2] == 0 and label.color[3] == 0, "show: line's own colour")
  clock = pullAt + 25
  CRT.NoteAlert:Refresh()
  assert(alertFrame.shown and label.text == "Spell31884" and alertIcon.texture == 131884, "no show: keeps the spell: " .. tostring(label.text))
  fire("ENCOUNTER_END", 3472)
  results.ownLabel = true
end

return table.concat(out, "\\n"), tostring(results.next40), tostring(results.win40), tostring(results.testStop), tostring(results.other), tostring(results.silent) .. "/" .. tostring(results.mute),
  tostring(results.remNext) .. "," .. tostring(results.remText) .. "," .. tostring(results.replaced) .. "," .. tostring(results.ownLabel)
`;

function runState(mode, files) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L); lua.lua_checkstack(L, 200); // the files go in as arguments
  if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { throw new Error(lua.lua_tojsstring(L, -1)); }
  lua.lua_pushstring(L, to_luastring(mode));
  lua.lua_pushstring(L, to_luastring(noteText));
  for (const [name, p] of files) {
    lua.lua_pushstring(L, to_luastring(name));
    lua.lua_pushstring(L, to_luastring(read(p)));
  }
  if (lua.lua_pcall(L, 2 + files.length * 2, 7, 0) !== lua.LUA_OK) { throw new Error(mode + ' side: ' + lua.lua_tojsstring(L, -1)); }
  const r = [];
  for (let i = -7; i <= -1; i++) r.push(lua.lua_tojsstring(L, i));
  return { lines: r[0].split('\n'), next40: r[1], win40: r[2], testStop: r[3], other: r[4], silent: r[5], extra: r[6] };
}

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}

const oldR = runState('old', [['CRT_Modules/Notes/Parse.lua', parse], ['CRT_Modules/Notes/Data.lua', data], ['CRT_Modules/Notes/Engine.lua', oldEngine], ['CRT_Modules/Notes/Window.lua', windowSrc], ['CRT_Modules/Notes/Alert.lua', oldAlert]]);
let newR, newErr;
try {
  newR = runState('new', [['CRT_Core/Sound/Engine.lua', soundEngine], ['CRT_Modules/Alerts/Rules.lua', rules], ['CRT_Modules/Alerts/Engine.lua', alertsEngine], ['CRT_Modules/Alerts/Speech.lua', speech], ['CRT_Modules/Notes/Parse.lua', parse], ['CRT_Modules/Notes/Data.lua', data], ['CRT_Modules/Notes/Engine.lua', engine], ['CRT_Modules/Notes/Window.lua', windowSrc], ['CRT_Modules/Notes/Alert.lua', alert]]);
} catch (e) { newErr = e; void 0; }

// The spoken count (said=) is a running total; once B's Next phase masks lines, it no longer matches.
function unsaid(lines) {
  const i = lines.findIndex((l) => l.startsWith('B-next40'));
  // what B (pull 5000) says from its Next phase at 40 s on is the mask's: left out here
  return lines.filter((l) => { const m = /^said 5000 (-?\d+\.\d)/.exec(l); return !(m && Number(m[1]) >= 40); })
    .map((l, k) => (i >= 0 && k > i ? l.replace(/\|said=\d+$/, '') : l));
}
function firstDiff(prefix) {
  const o = unsaid(oldR.lines).filter((l) => prefix.test(l)), n = unsaid(newR.lines).filter((l) => prefix.test(l));
  for (let i = 0; i < Math.max(o.length, n.length); i++) {
    if (o[i] !== n[i]) return `line ${i}\n  old: ${o[i]}\n  new: ${n[i]}`;
  }
  if (o.length < 100 && prefix.source.startsWith('^A')) return 'too few lines';
  return null;
}
const need = () => { if (newErr) throw newErr; };

// After a Next phase the phase mask (Alerts:IsCut) drops phase 1's lines at or after the new phase's
// start, which the old engine kept: those snapshots are checked on their own, not against the old.
function before(prefix, stopTag) {
  const cut = (lines) => { const i = lines.findIndex((l) => l.startsWith(stopTag)); return i < 0 ? lines : lines.slice(0, i); };
  return { o: cut(oldR.lines).filter((l) => prefix.test(l)), n: cut(newR.lines).filter((l) => prefix.test(l)) };
}
check('note only: new alert matches old alert every 0.1s', () => {
  need();
  const d = firstDiff(/^(A|C|said|error)/);
  if (d) throw new Error(d);
  const shownSteps = oldR.lines.filter((l) => /^A\|.*alert=true/.test(l)).length;
  if (shownSteps < 50) throw new Error('alert shown too rarely in old run: ' + shownSteps);
});
check('note only: Next phase starts the same phase', () => {
  need();
  if (oldR.next40 !== '1.5' || newR.next40 !== '1.5') throw new Error(`next at 40: old ${oldR.next40} new ${newR.next40}`);
  const { o, n } = before(/^B/, 'B-next40');
  for (let i = 0; i < Math.max(o.length, n.length); i++) {
    if (o[i] !== n[i]) throw new Error(`before Next phase, line ${i}\n  old: ${o[i]}\n  new: ${n[i]}`);
  }
  if (o.length < 300) throw new Error('too few lines before Next phase: ' + o.length);
});
check('mask: Next phase hides phase 1 lines at or after it, keeps the rest', () => {
  need();
  const w = newR.win40 || '';
  if (/Short line/.test(w)) throw new Error('a phase 1 line at 57 s still listed after phase 1.5 at 40 s:\n' + w);
  if (!/Later phase text/.test(w)) throw new Error('the new phase line is missing:\n' + w);
  if (!/Short line/.test(oldR.win40 || '')) throw new Error('the scenario no longer has a phase 1 line after 40 s');
  const m = newR.lines.find((l) => l.startsWith('Mask-C|'));
  if (!m || !/alert=false/.test(m)) throw new Error('Move out (phase 1, 20 s) still alerts once phase 1.5 starts at 20 s: ' + m);
});
check('note only: alert off still reads note lines out (ruling B2)', () => {
  need();
  const [oldOff] = oldR.silent.split('/'), [newOff] = newR.silent.split('/');
  if (oldOff !== '0') throw new Error(`old spoke with the alert off: ${oldOff}`);
  if (!(Number(newOff) > 0)) throw new Error(`new silent with the alert off and speech on: ${newOff}`);
});
check('note only: speech off keeps it silent, old and new', () => {
  need();
  const oldMute = oldR.silent.split('/')[1], newMute = newR.silent.split('/')[1];
  if (oldMute !== '0' || newMute !== '0') throw new Error(`spoken with speech off: old ${oldMute} new ${newMute}`);
});
check('note only: test run and stop', () => { need(); if (newR.testStop !== 'true') throw new Error('not checked'); });
check("note only: other player's line has no outputs", () => { need(); if (!(Number(newR.other) > 0)) throw new Error('no other lines checked'); });
check('reminders only: Next phase starts P2 with no note', () => { need(); if (newR.extra.split(',')[0] !== 'true') throw new Error('not checked'); });
check("alert: a reminder's own text shows, not the spell name", () => { need(); if (newR.extra.split(',')[1] !== 'true') throw new Error('not checked'); });
check('note test replaced by another test run drops the note', () => { need(); if (newR.extra.split(',')[2] !== 'true') throw new Error('not checked'); });
check("alert: a note line with show: shows its own text, icon and colour", () => { need(); if (newR.extra.split(',')[3] !== 'true') throw new Error('not checked'); });

if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, oldR.lines.join('\n') + '\n=====NEW=====\n' + (newR ? newR.lines.join('\n') : String(newErr)));
if (failed) { console.log(failed + ' failed'); process.exit(1); }
