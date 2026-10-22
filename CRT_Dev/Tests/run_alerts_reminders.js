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
  -- your own reminder (its text names no ability row) keeps typed times
  local id = R:Save(3001, nil, { boss = NEK, text = "Soak call", times = "P1 0:30" })
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

-- Saved per difficulty group: a reminder's group ("nh" Normal/Heroic or "mythic"), matched through the
-- Timeline's group of the pull (its difficulty ID first). Older difficulty text reads as its group.
local function texts(run)
  local t = {}
  for _, it in ipairs(block(run)) do t[#t + 1] = it.text end
  table.sort(t)
  return table.concat(t, ",")
end
do
  fresh()
  local nh = R:Save(3001, nil, { boss = "b", text = "nh", times = "10" }, "nh")
  local my = R:Save(3001, nil, { boss = "b", text = "my", times = "10" }, "mythic")
  assert(R:Get(3001, nh).group == "nh" and R:Get(3001, my).group == "mythic", "saved with its group")
  assert(texts({ encounterID = 3001, difficultyID = 15, difficultyName = "Heroisch" }) == "nh", "a Heroic pull: " .. texts({ encounterID = 3001, difficultyID = 15 }))
  assert(texts({ encounterID = 3001, difficultyID = 14 }) == "nh", "a Normal pull")
  assert(texts({ encounterID = 3001, difficultyID = 17 }) == "nh", "Raid Finder is in the helper's Normal/Heroic group")
  assert(texts({ encounterID = 3001, difficultyID = 16, difficultyName = "Mythisch" }) == "my", "a Mythic pull")
  assert(texts({ encounterID = 3001, difficultyName = "Heroic" }) == "nh" and texts({ encounterID = 3001, difficultyName = "Mythic" }) == "my", "by name with no ID")
  assert(texts({ encounterID = 3001 }) == "", "a pull of no known difficulty: neither")
  assert(texts({ encounterID = 3001, anyDifficulty = true }) == "my,nh", "anyDifficulty sees all")
  -- older saved values
  fresh()
  R:Save(3001, nil, { boss = "b", text = "N", times = "10", difficulty = "Normal" })
  R:Save(3001, nil, { boss = "b", text = "H", times = "10", difficulty = "Heroic" })
  R:Save(3001, nil, { boss = "b", text = "M", times = "10", difficulty = "Mythic" })
  assert(texts({ encounterID = 3001, difficultyID = 15 }) == "H,N", "old Normal and Heroic on a Heroic pull: " .. texts({ encounterID = 3001, difficultyID = 15 }))
  assert(texts({ encounterID = 3001, difficultyID = 14 }) == "H,N", "and on a Normal pull")
  assert(texts({ encounterID = 3001, difficultyID = 16 }) == "M", "old Mythic on a Mythic pull only")
  -- the game's own word for Mythic, on a client in another language
  GetDifficultyInfo = function(id) if id == 16 then return "Mythisch" end return "Heroisch" end
  R:Save(3001, nil, { boss = "b", text = "L", times = "10", difficulty = "Mythisch" })
  assert(texts({ encounterID = 3001, difficultyID = 16 }) == "L,M" and texts({ encounterID = 3001, difficultyID = 15 }) == "H,N", "the game's Mythic word")
  GetDifficultyInfo = nil
  assert(R.GroupOf({ difficulty = "Heroic" }) == "nh" and R.GroupOf({ group = "mythic", difficulty = "Heroic" }) == "mythic"
    and R.GroupOf({}) == nil and R.GroupOf({ group = "bad" }) == nil, "GroupOf")
  -- a group saved over an older difficulty of the other group: the group wins, the text goes
  local id = R:Save(3001, nil, { boss = "b", text = "x", times = "10", difficulty = "Heroic", group = "mythic" })
  assert(R:Get(3001, id).group == "mythic" and R:Get(3001, id).difficulty == nil, "group over old text")
  local keep = R:Save(3001, nil, { boss = "b", text = "y", times = "10", difficulty = "Heroic", group = "nh" })
  assert(R:Get(3001, keep).difficulty == "Heroic", "text of the same group kept")
  print("ok reminders: saved per difficulty group")
end

-- An older reminder on any difficulty (none saved) becomes one per group, once, with a backup.
do
  fresh()
  CRT.db.alerts.anyBackup = nil
  local any = R:Save(3001, nil, { boss = "b", text = "Any", times = "10", warn = 7 })
  local only = R:Save(3001, nil, { boss = "b", text = "Only", times = "10" }, "mythic")
  local old = R:Save(3001, nil, { boss = "b", text = "Old", times = "10", difficulty = "Heroic" })
  CRT.db.alerts.overrides.mine = { [any] = { warn = 9 } }
  assert(R:Get(3001, any).group == nil, "saved with no group: any")
  R.ResetMigration()
  R.MigratePass()
  local list = R:List(3001)
  assert(#list == 4, "one more reminder: " .. #list)
  local copyID = list[4].id
  local a1, a2 = R:Get(3001, any), R:Get(3001, copyID)
  assert(a1.group == "nh" and a2.group == "mythic", "one per group: " .. tostring(a1.group) .. " " .. tostring(a2.group))
  assert(a2.text == "Any" and a2.warn == 7 and a2.times == "10" and a2.boss == "b" and a2.enabled == true, "the same settings")
  assert(CRT.db.alerts.overrides.mine[copyID] and CRT.db.alerts.overrides.mine[copyID].warn == 9, "its display overrides too")
  assert(R:Get(3001, only).group == "mythic" and R:Get(3001, old).group == nil and R:Get(3001, old).difficulty == "Heroic", "single-group reminders untouched")
  local b = CRT.db.alerts.anyBackup
  assert(b and b[3001] and b[3001][any] and b[3001][any].text == "Any" and b[3001][any].group == nil and not b[3001][only], "the backup keeps it as it was")
  assert(texts({ encounterID = 3001, difficultyID = 15 }) == "Any,Old", "a Heroic pull still fires it: " .. texts({ encounterID = 3001, difficultyID = 15 }))
  assert(texts({ encounterID = 3001, difficultyID = 16 }) == "Any,Only", "and a Mythic pull: " .. texts({ encounterID = 3001, difficultyID = 16 }))
  -- once: a second pass splits nothing more
  local nextId = CRT.db.alerts.nextId
  R.ResetMigration()
  R.MigratePass()
  assert(#R:List(3001) == 4 and CRT.db.alerts.nextId == nextId, "runs once")
  -- a reminder on any difficulty saved for one group is split first: the other group keeps it as it was
  fresh()
  local id = R:Save(3001, nil, { boss = "b", text = "A", times = "10" })
  local got = R:Save(3001, id, { boss = "b", text = "A2", times = "10" }, "mythic")
  assert(got ~= id and R:Get(3001, got).text == "A2" and R:Get(3001, got).group == "mythic", "saved for Mythic")
  assert(R:Get(3001, id).text == "A" and R:Get(3001, id).group == "nh", "Normal/Heroic keeps it")
  print("ok reminders: any difficulty becomes one per group")
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
  assert(same(absolute(shipped, R:Times(3001, { boss = NEK, text = "Possession Barrage" }, nil, "mythic")), laneTimes(shipped, "Possession Barrage", "mythic")),
    "the Mythic list matches the Mythic row")
  -- the one picker: a reference with no Encounter: line is found by the boss library's name for the ID
  local T = CRT.Timeline
  local m, h = T:ReferenceFor(3470, "mythic"), T:ReferenceFor(3470, "nh")
  assert(m and m.ref == shipped and h and h.own and h.ref.difficulty == "Heroic", "picked by group, by the library's name")
  assert(T:ReferenceFor(3470, "nh", nil, "Normal").key == h.key, "no Normal one: the group's first")
  assert(T:GroupOf(16) == "mythic" and T:GroupOf(15, "Mythic") == "nh" and T:GroupOf(nil, "Mythic") == "mythic" and T:GroupOf() == nil, "GroupOf")
  -- on a client in another language: the pull's difficulty ID decides, not its translated name
  A:Start(3001, "Mythisch", "encounter", { difficultyID = 16 })
  assert(A:RunGroup() == "mythic" and firstTime(A.run) == 36, "ID 16 is Mythic whatever its name")
  A:Start(3001, "Heroisch", "encounter", { difficultyID = 15 })
  assert(A:RunGroup() == "nh" and firstTime(A.run) == 33, "ID 15 is Normal/Heroic")
  R:Save(3001, nil, { boss = NEK, text = "Only mythic", times = "10", difficulty = "Mythic" })
  local function has(run, text) for _, it in ipairs(block(run)) do if it.text == text then return true end end return false end
  assert(has({ encounterID = 3001, difficultyName = "Mythisch", difficultyID = 16 }, "Only mythic")
    and not has({ encounterID = 3001, difficultyName = "Heroisch", difficultyID = 15 }, "Only mythic"), "a reminder's own difficulty by ID too")
  A:Stop(true)
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

-- Typed times on a boss ability's alert move onto its casts once, out of combat after login, kept aside
do
  fresh()
  local said = {}
  CRT.Print = function(_, s) said[#said + 1] = s end
  CRT.db.alerts.reminders = { [3001] = {
    -- as Alex's saved Possession Barrage: 0:33, three seconds before the 0:36 cast
    [4] = { enabled = false, speech = "text", warn = 5, text = "Possession Barrage", boss = NEK, times = "P1 0:33",
      priority = "normal", spellID = 1284103, outputs = { bar = true, alert = true } },
    -- one time near a cast, one near none (5:00: the casts are at 2:58 and 8:13)
    [5] = { text = "Possession Barrage", boss = NEK, times = "P1 1:13, 5:00", spellID = 1284103 },
    -- your own reminder (no spell, its text names no row) keeps its typed times
    [6] = { text = "Gate", boss = NEK, times = "P1 0:10.8" },
    -- no spell, but named after a spell-less row ("Soulcoil Rite" has none in this Journal): it follows too
    [7] = { text = "Soulcoil Rite", boss = NEK, times = "P1 1:16" },
  } }
  CRT.db.alerts.nextId = 8
  local all = CRT.db.alerts.reminders[3001]
  -- never at a pull: a run reads the reminders without moving anything
  R.ResetMigration()
  A:Start(3001, "Mythic", "encounter", { difficultyID = 16 })
  A:Stop(true)
  assert(all[4].times == "P1 0:33" and all[4].timesMigrated == nil, "nothing moved at the pull")
  -- in combat it waits; out of combat it runs once, quietly for undo, then fires the change event
  local quietRuns, fired = 0, 0
  CRT.TimelineUndo = { Quietly = function(_, fn) quietRuns = quietRuns + 1 fn() end }
  local stop = A:OnChange(function() fired = fired + 1 end)
  InCombatLockdown = function() return true end
  R.MigratePass()
  assert(all[4].times == "P1 0:33" and quietRuns == 0, "waits for combat to end")
  InCombatLockdown = function() return false end
  R.MigratePass()
  assert(quietRuns == 1 and fired >= 1, "ran once, outside undo, and fired: " .. quietRuns .. " " .. fired)
  CRT.TimelineUndo = nil
  local a = all[4]
  assert(a.times == nil and a.timesBackup == "P1 0:33" and a.timesMigrated == true, "kept aside: " .. tostring(a.timesBackup))
  assert(a.shifts == nil and a.timesUnmatched == nil, "0:33 snaps onto the 0:36 cast, no shift")
  assert(a.enabled == false and a.text == "Possession Barrage" and a.warn == 5, "every other field as it was")
  local list, source = R:Times(3001, a)
  assert(source == "reference" and #list == 8 and list[1].t == 36 and list[1].shift == nil and list[2].t == 72,
    "follows every cast of the timeline, on the casts: " .. #list .. " " .. tostring(list[1] and list[1].t))
  assert(list[1].key == "P1@0:36" and list[6].key == "P2@0:53", "stable keys: " .. tostring(list[1].key) .. " " .. tostring(list[6].key))
  assert(R.FormatCasts(list):find("^P1 0:36, 1:12, ") ~= nil, "the list: the casts: " .. R.FormatCasts(list))
  -- a shift only comes from dragging a flag afterwards, for that group and cast, and the list shows it
  assert(R:SetTime(3001, 4, 1, 1, 33), "dragged")
  all = CRT.db.alerts.reminders[3001]
  local moved = R:Times(3001, all[4])
  assert(all[4].shifts.mythic["P1@0:36"] == -3 and moved[1].t == 33 and R.FormatCasts(moved):find("^P1 0:33 %(%-3 s%), 1:12, ") ~= nil,
    "a dragged shift: " .. R.FormatCasts(moved))
  local b = all[5]
  assert(b.timesBackup == "P1 1:13, 5:00" and b.shifts == nil and b.timesUnmatched == "P1 5:00", "one snapped, one kept as unmatched")
  assert(#said == 1 and said[1]:find("Possession Barrage", 1, true) and said[1]:find("5:00", 1, true), "said once in chat: " .. tostring(said[1]))
  assert(all[6].times == "P1 0:10.8" and all[6].timesBackup == nil and all[6].timesMigrated == nil, "your own reminder untouched")
  assert(all[7].times == nil and all[7].timesBackup == "P1 1:16" and #R:Times(3001, all[7]) == 6, "a spell-less row's alert follows its casts")
  -- only once
  R.MigratePass()
  R.ResetMigration()
  R.MigratePass()
  assert(#said == 1 and all[4].timesBackup == "P1 0:33" and all[4].shifts.mythic["P1@0:36"] == -3, "nothing moves twice, the drag kept")
  -- Save never loses typed times: on the caller's group's row, the rest kept and said, timesBackup only added to
  local id = R:Save(3001, nil, { text = "Possession Barrage", boss = NEK, spellID = 1284103, times = "P1 1:47" }, "mythic")
  local n = R:Get(3001, id)
  assert(n.times == nil and n.shifts == nil and n.timesBackup == "P1 1:47" and #R:Times(3001, n) == 8, "on the 1:47 cast: no shift, every cast")
  local again = {}
  for k, v in pairs(n) do again[k] = v end
  again.times = "P1 4:00"
  R:Save(3001, id, again, "mythic")
  n = R:Get(3001, id)
  assert(n.timesBackup == "P1 1:47; P1 4:00" and n.timesUnmatched == "P1 4:00" and #said == 2, "added, never overwritten: " .. tostring(n.timesBackup))
  CRT.Print = nil
  print("ok typed times on an ability move onto its casts once")
end

-- Shifts and turned-off casts are per difficulty group and per cast, by the cast's written time in its phase
do
  fresh()
  CRT.db.timeline.references, CRT.db.timeline.nextRef = {}, 1
  local key = CRT.TimelineReference:Add(table.concat({ "Boss: " .. NEK, "Difficulty: Heroic", "Length: 9:48",
    "Possession Barrage (type falloff): 0:33, 1:12, 2:00" }, "\\n"))
  local id = R:Save(3001, nil, { text = "Possession Barrage", boss = NEK, spellID = 1284103 })
  -- a drag on Heroic's 1:12 cast
  assert(R:SetTime(3001, id, 2, 1, 70, nil, "nh"), "dragged on Heroic")
  local r = R:Get(3001, id)
  assert(r.shifts.nh["P1@1:12"] == -2 and r.shifts.mythic == nil, "Heroic's own: " .. tostring(r.shifts.nh["P1@1:12"]))
  local function at(group, i) return R:Times(3001, R:Get(3001, id), nil, group)[i].t end
  assert(at("nh", 2) == 70 and at("mythic", 2) == 72, "Mythic's 1:12 cast as it was")
  assert(R:RemoveTime(3001, id, 3, nil, "mythic"), "a Mythic cast off")
  assert(#R:Times(3001, R:Get(3001, id), nil, "mythic") == 7 and #R:Times(3001, R:Get(3001, id), nil, "nh") == 3, "off on Mythic only")
  -- a season update adds a cast before it: the shift stays on the 1:12 cast
  CRT.TimelineReference:Update(key, table.concat({ "Boss: " .. NEK, "Difficulty: Heroic", "Length: 9:48",
    "Possession Barrage (type falloff): 0:20, 0:33, 1:12, 2:00" }, "\\n"))
  local list = R:Times(3001, R:Get(3001, id), nil, "nh")
  assert(#list == 4 and list[1].t == 20 and list[2].t == 33 and list[3].t == 70 and list[3].shift == -2, "the shift stayed on its cast")
  -- a reminder on any difficulty is matched against both groups' rows: 2:58 is only Mythic's cast
  local anyR = { text = "Possession Barrage", boss = NEK, spellID = 1284103, times = "P1 2:58, 0:34" }
  assert(R.MigrateOne(3001, anyR) == nil and anyR.timesUnmatched == nil and anyR.timesBackup == "P1 2:58, 0:34", "both matched")
  local heroicOnly = { text = "Possession Barrage", boss = NEK, spellID = 1284103, times = "P1 2:58", difficulty = "Heroic" }
  assert(R.MigrateOne(3001, heroicOnly) == "P1 2:58", "a Heroic reminder: Heroic's row only")
  CRT.db.timeline.references = {}
  print("ok shifts and off are per group and per cast")
end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
