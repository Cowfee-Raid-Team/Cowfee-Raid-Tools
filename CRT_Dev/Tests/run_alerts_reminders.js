// CRT_Modules/Alerts/Reminders.lua: your own reminders, as a block on the alerts engine.
// Usage: node run_alerts_reminders.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Reminders.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
-- Boss library wiring (CRT_Data/Bosses/Registry.lua, then the season pack, then the ADDON_LOADED the game fires once every file has loaded).
local function loadBosses(CRT, reg, season, nek)
  local real, handler = CreateFrame, nil
  CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
  assert(load(reg, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
  CreateFrame = real
  assert(load(season, "CRT_Data/Seasons/Midnight-S1/Season.lua"))("CowfeeRaidTools", CRT)
  assert(load(nek, "CRT_Data/Seasons/Midnight-S1/NekzaliTheSoulcoiler.lua"))("CowfeeRaidTools", CRT)
  handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
end
local nek, season, reg = table.remove(sources), table.remove(sources), table.remove(sources)
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
local clock = 100
function GetTime() return clock end
local secrets = {}
function issecretvalue(v) return secrets[v] == true end
local SECRET = {}
secrets[SECRET] = true
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
local function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local spellNames = { [777] = "Real Name" }
C_Spell = {
  GetSpellName = function(id) if id == 888 then return SECRET end return spellNames[id] end,
  GetSpellTexture = function(id) return "tex" .. tostring(id) end,
}
local CRT = {
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {} },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
}
local journalRows = { { spellID = 5001, name = "Grasping Depths", icon = "texG" } }
CRT.TimelineJournal = { Rows = function() return journalRows end, IsHidden = function() return false end }
for i, src in ipairs(sources) do
  assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
end
loadBosses(CRT, reg, season, nek)
local R, A = CRT.AlertReminders, CRT.Alerts
assert(R, "AlertReminders exists")
local function fresh()
  A:Stop(true)
  CRT.db.alerts.reminders = {}
  CRT.db.alerts.overrides = {}
  CRT.db.alerts.nextId = 1
  wipe(errors)
end
local function block(run) return A.blocks.mine.Entries(run) end
local MYTHIC = { encounterID = 3001, difficultyName = "Mythic" }
local NEK = "Nek'zali the Soulcoiler"

do
  assert(R.PhaseNumber("P1.5") == 1.5 and R.PhaseNumber("P2") == 2 and R.PhaseNumber("Phase 3") == 3
    and R.PhaseNumber("Intermission") == nil and R.PhaseNumber(nil) == nil, "phase numbers")
  print("ok phase number from labels")
end

do
  local ref = CRT.TimelineReference:List()[1].ref
  local row = { casts = { { t = 370 } } }
  local l = R.FromReference(ref, row)
  assert(#l == 1 and l[1].ph == 1.5 and l[1].t == 370 - 197, "6:10 -> 1.5 / " .. tostring(l[1] and l[1].t))
  local soul
  for _, r in ipairs(ref.rows) do if r.name == "Soulcoil Rite" then soul = r end end
  local s = R.FromReference(ref, soul)
  assert(#s == 6 and s[1].ph == 1 and s[1].t == 2 and s[3].t == 148 and s[4].ph == 2 and s[4].t == 18, "Soulcoil Rite split")
  assert(s[2].ph == 1 and s[2].t == 77, "before any numbered phase")
  print("ok from reference: unnumbered line keeps phase")
end

do
  local l = R.ParseTimes("P1 0:02, 1:17; P2 +0:18")
  assert(l and #l == 3 and l[1].ph == 1 and l[1].t == 2 and l[2].t == 77 and l[3].ph == 2 and l[3].t == 18)
  assert(R.FormatTimes(l) == "P1 0:02, 1:17; P2 +0:18", R.FormatTimes(l))
  local p = R.ParseTimes("45, 1:05")
  assert(#p == 2 and p[1].ph == 1 and p[1].t == 45 and p[2].t == 65, "no P is phase 1")
  print("ok times: parse and format round trip")
end

do
  local l, err = R.ParseTimes("P1 0:02; P2 1:7x")
  assert(l == nil and err == "bad time '1:7x' in P2", tostring(err))
  local l2, err2 = R.ParseTimes("0:xx")
  assert(l2 == nil and err2 == "bad time '0:xx' in P1", tostring(err2))
  print("ok times: bad time is reported")
end

do
  fresh()
  local id = R:Save(3001, nil, { boss = NEK, text = "Soulcoil Rite", times = "P1 0:30" })
  assert(id == 1 and CRT.db.alerts.nextId == 2 and R:Get(3001, id).warn == 5 and R:Get(3001, id).speech == "text"
    and R:Get(3001, id).enabled == true and R:Get(3001, id).priority == "normal", "save defaults")
  R:Save(3001, nil, { boss = NEK, text = "Soulcoil Rite", spellID = 0 })
  assert(#R:List(3001) == 2 and R:List(3001)[1].id == 1)
  local times, source = R:Times(3001, R:Get(3001, id))
  assert(source == "typed" and #times == 1 and times[1].t == 30)
  local rt, rs = R:Times(3001, R:Get(3001, 2))
  assert(rs == "reference" and #rt == 6, "reference by name: " .. tostring(rs) .. #rt)
  local items = block(MYTHIC)
  assert(#items == 1 + 6, "typed wins and reference both give items: " .. #items)
  local fired = 0
  A:OnChange(function() fired = fired + 1 end)
  R:Save(3001, 1, { boss = "x", text = "t", times = "5" }); R:Delete(3001, 1)
  assert(fired == 2 and R:Get(3001, 1) == nil and #R:List(3001) == 1, "save and delete fire")
  print("ok reminders: typed times win over reference")
end

do
  fresh()
  R:Save(3001, nil, { boss = "Unknown Boss", text = "Nothing" })
  local t, s = R:Times(3001, R:Get(3001, 1))
  assert(#t == 0 and s == "none", s)
  assert(#block(MYTHIC) == 0, "no items")
  -- a spell-id match through the Journal row of the same name
  R:Save(3001, nil, { boss = NEK, spellID = 5001, text = "x" })
  local t2, s2 = R:Times(3001, R:Get(3001, 2))
  assert(s2 == "reference" and #t2 == 10, "spell id match: " .. #t2)
  print("ok reminders: no reference and no times never fires")
end

do
  fresh()
  R:Save(3001, nil, { boss = NEK, text = "x", times = "10", difficulty = "Mythic" })
  assert(#block({ encounterID = 3001, difficultyName = "Heroic" }) == 0, "mythic on heroic")
  assert(#block({ encounterID = 3001, difficultyName = "mythic" }) == 1, "case-insensitive")
  assert(#block({ encounterID = 3001 }) == 0, "unknown difficulty")
  R:Save(3001, nil, { boss = "b", text = "any", times = "10" })
  assert(#block({ encounterID = 3001, difficultyName = "Heroic" }) == 1, "any difficulty")
  assert(#block({ encounterID = 9999, difficultyName = "Heroic" }) == 0, "other boss")
  R:Save(3001, nil, { boss = "b", text = "off", times = "10", enabled = false })
  assert(#block({ encounterID = 3001, difficultyName = "Heroic" }) == 1, "disabled left out")
  print("ok reminders: difficulty filter")
end

do
  fresh()
  local base = { text = "a", warn = 5, outputs = { alert = true, bar = true, speech = false } }
  local plain = R:Effective("mine", 7, base)
  assert(plain.text == "a" and plain.warn == 5 and plain ~= base)
  CRT.db.alerts.overrides.mine = { [7] = { warn = 9, outputs = { speech = true } } }
  local e = R:Effective("mine", 7, base)
  assert(e.warn == 9 and e.text == "a" and e.outputs.speech == true and e.outputs.alert == true)
  assert(base.warn == 5 and base.outputs.speech == false, "base untouched")
  e.outputs.bar = false
  assert(base.outputs.bar == true, "effective outputs are a copy")
  local id = R:Save(3001, nil, { boss = "b", text = "w", times = "10" })
  CRT.db.alerts.overrides.mine = { [id] = { warn = 12 } }
  assert(block(MYTHIC)[1].warn == 12, "block uses override")
  print("ok overrides lay over without touching base")
end

do
  fresh()
  local id = R:Save(3001, nil, { boss = "b", text = "Boom", times = "P1 0:20, 0:40; P2 +0:10", speech = "textcount", warn = 6,
    outputs = { alert = true, bar = true, speech = true }, priority = "high" })
  local items = block(MYTHIC)
  assert(#items == 3 and items[1].id == "mine:1:1" and items[3].id == "mine:1:3" and items[3].ph == 2 and items[3].time == 10)
  local it = items[1]
  assert(#it.speech == 4 and it.speech[1].text == "Boom" and it.speech[1].offset == 6 and it.speech[2].text == "3"
    and it.speech[2].offset == 3 and it.speech[4].text == "1" and it.speech[4].offset == 1, "textcount")
  assert(it.hold == 0.5 and it.priority == 33 and it.warn == 6 and it.outputs.speech == true and it.text == "Boom")
  R:Save(3001, id, { boss = "b", text = "Boom", times = "10", speech = "count", outputs = { alert = true, bar = true, speech = true } })
  assert(#block(MYTHIC)[1].speech == 3 and block(MYTHIC)[1].speech[1].text == "3", "count")
  R:Save(3001, id, { boss = "b", text = "Boom", times = "10", speech = "text", outputs = { alert = true, bar = true, speech = true } })
  assert(#block(MYTHIC)[1].speech == 1, "text")
  A:Start(3001, "Mythic", "test")
  assert(#A:Lines(100) == 1 and A:Lines(100)[1].block == "mine")
  A:Stop()
  print("ok block: textcount gives four speech items")
end

do
  fresh()
  R:Save(3001, nil, { boss = "b", spellID = 888, times = "10" })
  local it = block(MYTHIC)[1]
  assert(it.text == "Spell 888" and it.icon == "tex888", "secret name, no label: " .. tostring(it.text))
  R:Save(3001, nil, { boss = "b", spellID = 888, text = "Mine", times = "10" })
  assert(block(MYTHIC)[2].text == "Mine", "secret name falls back to text")
  assert(#errors == 0)
  print("ok reminders: secret spell name falls back to text")
end

do
  fresh()
  R:Save(3001, nil, { boss = "b", spellID = 777, text = "My label", times = "10" })
  R:Save(3001, nil, { boss = "b", spellID = 777, text = "   ", times = "10" })
  R:Save(3001, nil, { boss = "b", times = "10" })
  local items = block(MYTHIC)
  assert(items[1].text == "My label", "label wins")
  print("ok text: label wins over spell name")
  assert(items[2].text == "Real Name", "blank label shows spell name")
  assert(items[3].text == "Reminder", "no spell, no label")
  print("ok text: blank label shows spell name")
  R:Save(3001, nil, { boss = "b", spellID = 777, times = "10", speech = "text", outputs = { speech = true } })
  R:Save(3001, nil, { boss = "b", spellID = 777, text = "My label", times = "10", speech = "textcount" })
  local it = block(MYTHIC)
  assert(it[4].speech[1].text == "Real Name" and it[4].speech[1].text == it[4].text, "speech with no label")
  assert(it[5].speech[1].text == "My label" and it[5].speech[1].text == it[5].text, "speech says item text")
  print("ok speech: says the item text")
end

do
  fresh()
  local id = R:Save(3001, nil, { boss = "  ", difficulty = "", text = "x", times = "10" })
  local r = R:Get(3001, id)
  assert(r.difficulty == nil and r.boss == nil and #block({ encounterID = 3001, difficultyName = "Heroic" }) == 1, "blank difficulty is any")
  CRT.db.alerts.reminders = nil
  local nid = R:Save(3001, nil, { text = "y", times = "5" })
  assert(nid ~= nil and R:Get(3001, nid) ~= nil, "save creates missing reminders table")
  local saved = CRT.db.alerts
  CRT.db.alerts = nil
  assert(R:Save(3001, nil, { text = "z" }) == nil, "no settings: no throw")
  CRT.db.alerts = saved
  print("ok save: missing tables and blank fields")
end
do
  fresh()
  local Rules = CRT.AlertRules
  R:Save(3001, nil, { boss = "b", text = "Show", times = "10", warn = 5, speech = "text", outputs = { speech = true } })
  R:Save(3001, nil, { boss = "b", text = "Zero", times = "10", warn = 5, speech = "text", speakAt = "zero", outputs = { speech = true } })
  R:Save(3001, nil, { boss = "b", text = "Count", times = "10", warn = 5, speech = "textcount", speakAt = "zero", outputs = { speech = true } })
  local it = block(MYTHIC)
  assert(#it == 3, "three items")
  assert(#it[1].speech == 1 and it[1].speech[1].offset == 5, "on show: at the warning, 5 s before")
  assert(#it[2].speech == 1 and it[2].speech[1].offset == 0 and it[2].speech[1].text == "Zero", "at 0: at the cast")
  local c = it[3].speech
  assert(#c == 4 and c[1].offset == 0 and c[2].text == "3" and c[2].offset == 3 and c[4].offset == 1, "count down unchanged")
  -- the queue: the text comes due at the cast, not at the warning
  local function line(item)
    local l = { id = item.id, at = 10, outputs = item.outputs, speech = {} }
    for i, s in ipairs(item.speech) do l.speech[i] = { at = 10 - s.offset, text = s.text } end
    return l
  end
  local spoken = {}
  local lines = { line(it[1]), line(it[2]) }
  local early = Rules.SpeechDue(lines, 5, spoken)
  assert(#early == 1 and early[1].text == "Show", "at the warning only On show speaks")
  assert(#Rules.SpeechDue(lines, 9.9, spoken) == 0, "nothing more before the cast")
  local due = Rules.SpeechDue(lines, 10, spoken)
  assert(#due == 1 and due[1].text == "Zero" and due[1].at == 10, "At 0 speaks at the cast")
  assert(Rules.SpeechItems("x", 5, true, false, true)[1].offset == 0 and Rules.SpeechItems("x", 5, true, false)[1].offset == 5, "SpeechItems")
  print("ok speak at: at 0 speaks at the cast, on show at the warning")
end

-- One source of truth: a reminder that follows an ability timeline gets the same cast times the
-- Timeline's row (and the Rehearsal, built from those lanes) shows, and its alert counts down to the
-- same moment as the Rehearsal's cast bar.
local HEROIC_REF = table.concat({
  "Boss: " .. NEK, "Difficulty: Heroic", "Length: 9:48",
  "Phase: P1.5 3:17", "Phase: P2 7:10 (planned 7:20)",
  "Soulcoil Rite (type raid): 0:02, 1:17, 7:38, 8:26",
  "Possession Barrage (type falloff, lead 7): 0:33, 1:12, 8:13",
}, "\\n")
local function laneTimes(ref, name, group)
  local lanes = CRT.TimelineLanes.Build({ reference = ref }, journalRows, CRT.db.timeline, 3001, nil, group)
  for _, lane in ipairs(lanes) do
    if lane.label == name then
      local out = {}
      for i, m in ipairs(lane.marks) do out[i] = m.t end
      return out
    end
  end
  return {}
end
local function absolute(ref, list)
  local out = {}
  for i, e in ipairs(list) do out[i] = R.AbsoluteTime(ref, e.ph, e.t) end
  table.sort(out)
  return out
end
local function same(a, b) return table.concat(a, ",") == table.concat(b, ",") end
local function ownRef(text)
  CRT.db.timeline.references = {}
  CRT.db.timeline.nextRef = 1
  local key = CRT.TimelineReference:Add(text)
  return CRT.TimelineReference:Find(key).ref
end

do
  fresh()
  local ref = ownRef(HEROIC_REF)
  local id = R:Save(3001, nil, { boss = NEK, text = "Soulcoil Rite", difficulty = "Heroic" })
  local list, source = R:Times(3001, R:Get(3001, id))
  local row = laneTimes(ref, "Soulcoil Rite", "nh")
  assert(source == "reference" and same(absolute(ref, list), row),
    "the moved P2 line moves the alerts' times as it moves the row: " .. table.concat(absolute(ref, list), ",") .. " vs " .. table.concat(row, ","))
  assert(row[3] == 448, "7:38 moves 10 s earlier with its P2 line: " .. tostring(row[3]))
  CRT.db.timeline.references = {}
  print("ok one source: a moved phase line moves the alert times with the row")
end

do
  fresh()
  ownRef(HEROIC_REF)
  local shipped
  for _, e in ipairs(CRT.TimelineReference:List()) do if not e.own then shipped = e.ref end end
  -- Difficulty Any: each run reads the ability timeline of its own difficulty, as the Timeline and the Rehearsal show it
  R:Save(3001, nil, { boss = NEK, text = "Possession Barrage" })
  local function firstTime(run)
    local t
    for _, it in ipairs(block(run)) do if it.ph == 1 and (not t or it.time < t) then t = it.time end end
    return t
  end
  assert(firstTime({ encounterID = 3001, difficultyName = "Heroic" }) == 33, "Heroic reads the Heroic timeline")
  assert(firstTime({ encounterID = 3001, difficultyName = "Mythic" }) == 36,
    "Mythic reads the Mythic timeline, not your Heroic one: " .. tostring(firstTime({ encounterID = 3001, difficultyName = "Mythic" })))
  assert(same(absolute(shipped, R:Times(3001, { boss = NEK, text = "Possession Barrage" }, nil, "Mythic")), laneTimes(shipped, "Possession Barrage", "mythic")),
    "the Mythic list matches the Mythic row")
  CRT.db.timeline.references = {}
  print("ok one source: a reminder on Any reads the run's difficulty")
end

do
  fresh()
  local ref = ownRef(HEROIC_REF)
  R:Save(3001, nil, { boss = NEK, text = "Soulcoil Rite", difficulty = "Heroic", outputs = { bar = true } })
  -- a rehearsal run as the window drives it: phases start at their lines
  local fight = 0
  A:Start(3001, "Heroic", "rehearsal", { clock = function() return fight end, speed = function() return 1 end })
  for _, cast in ipairs(laneTimes(ref, "Soulcoil Rite", "nh")) do
    for _, before in ipairs({ 4.5, 2.5, 0.5 }) do
      fight = cast - before
      for _, p in ipairs(ref.phases) do
        local n = R.PhaseNumber(p.label)
        if n and n ~= 1 and p.t <= fight and not A:PhaseStart(n) then A:StartPhase(n, "rehearsal", A:TimeAt(p.t)) end
      end
      local found
      for _, l in ipairs(A:Lines(A:Now())) do
        if l.block == "mine" and math.abs((l.at - A:Now()) - before) < 1e-6 then found = l end
      end
      assert(found, "the alert counts down with the cast bar: " .. before .. " s before the cast at " .. cast)
    end
  end
  A:Stop(true)
  CRT.db.timeline.references = {}
  print("ok one source: the alert's time left equals the cast bar's")
end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
