// CRT_Modules/Timeline/Lanes.lua: the lanes of a recorded pull, a reference timeline and an overlaid pull.
// Usage: node run_timeline_lanes.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local dataSrc, dbSrc, refSrc, lanesSrc = ...
function CreateFrame() return { RegisterEvent = function() end, SetScript = function() end } end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
local CRT = {
  db = { timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3,
    overlayOn = false, hideEmpty = true, nextId = 1 } },
}
local hidden = {}
local rowsEnc, hiddenEnc
local journalRows = { { spellID = 5001, name = "Grasping Depths", icon = "texG", own = false }, { spellID = 5002, name = "Other", icon = "texO" } }
CRT.TimelineJournal = {
  Rows = function(_, eid) rowsEnc = eid return journalRows end,
  IsHidden = function(_, enc, id) hiddenEnc = enc return hidden[id] and true or false end,
  ResolveID = function(_, key, ref)
    if type(key) == "number" then return key end
    if ref and type(ref.encounterID) == "number" then return ref.encounterID end
    if ref and ref.boss == "Nek'zali the Soulcoiler" then return 3470 end
    return nil
  end,
}
assert(load(dataSrc, "CRT_Modules/Timeline/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(dbSrc, "CRT_Modules/Timeline/Database.lua"))("CowfeeRaidTools", CRT)
assert(load(refSrc, "CRT_Modules/Timeline/Reference.lua"))("CowfeeRaidTools", CRT)
assert(load(lanesSrc, "CRT_Modules/Timeline/Lanes.lua"))("CowfeeRaidTools", CRT)
local Lanes = CRT.TimelineLanes
local S = CRT.db.timeline
local function kinds(lanes) local t = {} for i, l in ipairs(lanes) do t[i] = l.kind end return table.concat(t, ",") end

-- phase 1 fixture
local rows = { { spellID = 5001, name = "A", icon = 1 }, { spellID = 5002, name = "B", icon = 2 } }
local pull = { id = 1, encounterID = 3001, length = 200, casts = { { t = 10, dur = 2, spellID = 5001 }, { t = 20, dur = 0, spellID = 0 } },
  deaths = { { t = 50, name = "Abu", class = "MAGE", role = "DAMAGER", spellID = 0 } } }

do
  local a, au, ax = Lanes.Build(pull, rows, S, 3001)
  assert(kinds(a) == "deaths,spell,unnamed" and #au == 0, "pull lanes unchanged: kinds " .. kinds(a))
  assert(#a[1].marks == 1 and a[2].spellID == 5001 and #a[2].marks == 1 and #a[3].marks == 1, "pull lanes unchanged: marks")
  assert(ax.length == 200 and ax.endLine == nil and (ax.phases == nil or #ax.phases == 0), "pull lanes unchanged: extra")
  local o = { id = 9, length = 999, casts = { { t = 1 } }, deaths = { { t = 2, name = "X" } } }
  local b = Lanes.Build(pull, rows, S, 3001, o)
  assert(kinds(b) == kinds(a) and #b[1].marks == 1, "pull lanes unchanged: overlay ignored")
  assert(rows[1].marks == nil, "pull lanes unchanged: cached rows untouched")
end
print("ok pull lanes unchanged")

local ref = { boss = "Nek", difficulty = "Mythic", length = 600, encounterID = 3001,
  phases = { { t = 0, label = "P1" }, { t = 300, label = "P2" } }, rows = {} }
local names = { "Grasping Depths", "Invoke", "C", "D", "E", "F", "G", "H", "I", "J", "K" }
for i, n in ipairs(names) do
  ref.rows[i] = { name = n, spellID = (n == "C") and 777 or 0, color = { i / 11, 0.5, 0.5 }, lead = i, casts = { { t = i * 10, dur = i }, { t = 400 + i, dur = 0 } } }
end

local function build(overlay) return Lanes.Build({ reference = ref }, journalRows, S, 3001, overlay) end

do
  local lanes, unknown, extra = build()
  assert(#lanes == 12 and #unknown == 0, "reference lanes in order: count " .. #lanes)
  assert(lanes[1].kind == "deaths" and #lanes[1].marks == 0, "reference lanes in order: empty deaths")
  assert(lanes[2].kind == "reference" and lanes[2].key == "ref:Grasping Depths" and lanes[2].label == "Grasping Depths", "reference lanes in order: first")
  assert(lanes[3].lead == 2 and lanes[3].color[1] == 2 / 11 and lanes[3].marks[1].t == 20 and lanes[3].marks[1].dur == 2, "reference lanes in order: lead, color, dur")
  assert(lanes[12].label == "K", "reference lanes in order: last")
  assert(extra.length == 600 and extra.endLine == nil and #extra.phases == 2 and extra.phases[2].label == "P2", "reference lanes in order: extra")
  assert(lanes[4].spellID == 777, "reference lanes in order: explicit spell id kept")
end
print("ok reference lanes in order")

do -- a row's own (color rrggbb) colour is drawn only with Use custom colours on; else its type's colour
  local parsed = CRT.TimelineReference.Parse("Boss: Nek\\nGrasping Depths (type soak, color 112233): 0:10\\nInvoke (color 445566): 0:20")
  local saved = ref.rows
  ref.rows = parsed.rows
  local custom = false
  CRT.Alerts = { CustomColors = function() return custom end }
  local lanes = build()
  assert(lanes[2].color[1] == CRT.TimelineReference.TYPES.soak.color[1] and lanes[3].color == nil, "off: the type's colour, or none")
  custom = true
  lanes = build()
  assert(math.abs(lanes[2].color[1] - 0x11 / 255) < 1e-6 and math.abs(lanes[3].color[1] - 0x44 / 255) < 1e-6, "on: the row's own colour")
  CRT.Alerts = nil
  ref.rows = saved
end
print("ok reference lanes: own colour only with custom colours")

do
  local lanes = build()
  assert(lanes[2].spellID == 5001 and lanes[2].icon == "texG", "journal name match: grasping")
  assert(lanes[3].spellID == 0 and lanes[3].icon ~= nil and lanes[3].icon ~= "texG", "journal name match: plain icon for no match")
  ref.rows[1].name = "  grasping DEPTHS "
  lanes = build()
  assert(lanes[2].spellID == 5001 and lanes[2].icon == "texG", "journal name match: case and trim")
  ref.rows[1].name = "Grasping Depths"
  assert(journalRows[1].marks == nil and #journalRows == 2, "journal name match: cache untouched")
end
print("ok journal name match")

do
  S.rows[3001] = { hiddenNames = { invoke = true } }
  local lanes = build()
  assert(#lanes == 11, "hidden by name: count " .. #lanes)
  for _, l in ipairs(lanes) do assert(l.label ~= "Invoke", "hidden by name") end
  S.rows[3001] = nil
  hidden[5001] = true
  lanes = build()
  assert(#lanes == 11 and lanes[2].label == "Invoke", "hidden by name: journal hidden spell dropped")
  hidden[5001] = nil
  S.hideEmpty = true
  ref.rows[2].casts = {}
  lanes = build()
  assert(#lanes == 12, "hidden by name: hideEmpty does not apply")
end
print("ok hidden by name")

local overlay = { id = 7, length = 450, casts = { { t = 1 }, { t = 2 }, { t = 3 }, { t = 4 }, { t = 5, spellID = 12 } },
  deaths = { { t = 50, name = "Abu", class = "MAGE", role = "DAMAGER" }, { t = 90, name = "Bo", class = "PRIEST", role = "HEALER" } } }
do
  local lanes, _, extra = build(overlay)
  assert(#lanes == 13 and #lanes[1].marks == 2, "overlay adds deaths, ticks and end line: deaths")
  assert(lanes[1].marks[1].overlay == true and lanes[1].marks[1].pull.id == 7, "overlay adds deaths, ticks and end line: deaths marked as the overlay")
  local last = lanes[#lanes]
  assert(last.kind == "ticks" and last.key == "overlay" and #last.marks == 5 and last.marks[5].t == 5, "overlay adds deaths, ticks and end line: ticks")
  assert(last.label == "Pull 7 casts", "overlay adds deaths, ticks and end line: label " .. last.label)
  assert(extra.endLine == 450 and extra.length == 600, "overlay adds deaths, ticks and end line: endLine")
end
print("ok overlay adds deaths, ticks and end line")

do
  overlay.length = 700
  local _, _, extra = build(overlay)
  assert(extra.length == 700 and extra.endLine == 700, "overlay longer than reference extends length")
end
print("ok overlay longer than reference extends length")

do
  overlay.length = 450
  S.deathRows = "player"
  local lanes = build(overlay)
  assert(#lanes == 14 and lanes[1].kind == "deaths" and lanes[2].kind == "deaths" and lanes[3].kind == "reference", "per-player deaths: two death lanes ahead of reference rows")
  assert(lanes[1].label == "Abu" and #lanes[1].marks == 1 and lanes[2].label == "Bo", "per-player deaths: lane per player")
  lanes = build()
  assert(#lanes == 11 and lanes[1].kind == "reference", "per-player deaths: none without overlay")
  S.deathRows = "combined"
end
print("ok per-player deaths on references")

do
  S.roles.HEALER = false
  local lanes = build(overlay)
  assert(#lanes[1].marks == 1 and lanes[1].marks[1].death.name == "Abu", "overlay deaths pass through FilterDeaths")
  S.roles.HEALER = true
  local o2 = { id = 8, length = 100, casts = {}, deaths = { { t = 5, name = "A", role = "TANK" }, { name = "Nil", role = "TANK" } } }
  local l2, unknown = build(o2)
  assert(#l2[1].marks == 1 and #unknown == 1 and unknown[1].name == "Nil", "overlay death with no time lands in unknown")
end
print("ok overlay deaths filtered and untimed ones in unknown")

do
  ref.rows[1].spellID = 4242
  local lanes = build()
  assert(lanes[2].spellID == 4242 and lanes[2].icon ~= "texG", "given spell with no journal row has no journal icon")
  assert(lanes[2].icon:find("QuestionMark", 1, true), "given spell with no journal row and no texture: plain icon")
  ref.rows[1].spellID = 5002
  lanes = build()
  assert(lanes[2].spellID == 5002 and lanes[2].icon == "texO", "given spell uses the journal row with that id")
  ref.rows[1].spellID = 0
end
print("ok given spell is not name matched")

do
  ref.rows[1].spellID = 4242
  C_Spell = { GetSpellTexture = function(id) return id == 4242 and "texSpell" or nil end }
  local lanes = build()
  assert(lanes[2].icon == "texSpell", "[spell] icon from GetSpellTexture: " .. tostring(lanes[2].icon))
  ref.rows[1].spellID = 5002
  lanes = build()
  assert(lanes[2].icon == "texO", "[spell] icon from GetSpellTexture: the journal icon wins")
  ref.rows[1].spellID = 4242
  C_Spell.GetSpellTexture = function() error("boom") end
  lanes = build()
  assert(lanes[2].icon:find("QuestionMark", 1, true), "[spell] icon from GetSpellTexture: an error falls back")
  C_Spell = nil
  ref.rows[1].spellID = 0
end
print("ok [spell] icon from GetSpellTexture")

do
  local r2 = { boss = "Nek", length = 100, encounterID = 3001, phases = {}, rows = { { name = "Grasping Depths", spellID = 0, casts = { { t = 5 } } } } }
  rowsEnc, hiddenEnc = nil, nil
  local lanes = Lanes.Build({ reference = r2 }, journalRows, S, "ref:nek")
  assert(rowsEnc == 3001 and hiddenEnc == 3001, "string boss key uses ref.encounterID for Journal: " .. tostring(rowsEnc) .. "," .. tostring(hiddenEnc))
  assert(lanes[2].spellID == 5001, "string boss key uses ref.encounterID for Journal: spell found")
  r2.encounterID = nil
  rowsEnc, hiddenEnc = nil, nil
  Lanes.Build({ reference = r2 }, journalRows, S, "ref:nek")
  assert(hiddenEnc == "ref:nek", "string boss key uses ref.encounterID for Journal: without one the key stays")
  rowsEnc, hiddenEnc = nil, nil
  Lanes.Build({ reference = ref }, journalRows, S, 3001)
  assert(hiddenEnc == 3001, "string boss key uses ref.encounterID for Journal: a numeric key is kept")
end
print("ok string boss key uses ref.encounterID for Journal")

do
  local r3 = { boss = "Nek'zali the Soulcoiler", length = 100, phases = {}, rows = { { name = "Grasping Depths", spellID = 0, casts = { { t = 5 } } } } }
  rowsEnc, hiddenEnc = nil, nil
  local lanes = Lanes.Build({ reference = r3 }, {}, S, "ref:nek'zali the soulcoiler")
  assert(rowsEnc == 3470 and hiddenEnc == 3470, "boss found by name gives Journal rows: " .. tostring(rowsEnc))
  assert(lanes[2].spellID == 5001 and lanes[2].icon == "texG", "boss found by name gives Journal rows: icon and spell")
end
print("ok reference boss found in the Journal by name")

do
  local curly = "Nek" .. "\\226\\128\\153" .. "s Rite"
  journalRows[3] = { spellID = 5003, name = "Nek's Rite", icon = "texN" }
  local r3 = { boss = "N", length = 10, phases = {}, rows = { { name = curly, spellID = 0, casts = { { t = 1 } } } } }
  local lanes = Lanes.Build({ reference = r3 }, journalRows, S, 3001)
  assert(lanes[2].spellID == 5003 and lanes[2].icon == "texN", "paste: curly apostrophe boss name matches (journal row name)")
  journalRows[3] = nil
end
print("ok paste: curly apostrophe journal name matches")

do
  assert(Lanes.RowSpell({ name = "  grasping DEPTHS " }, 3001) == 5001, "row spell: Journal match by name")
  assert(Lanes.RowSpell({ name = "Grasping Depths", spellID = 4242 }, 3001) == 4242, "row spell: given spell wins")
  assert(Lanes.RowSpell({ name = "Nothing" }, 3001) == 0, "row spell: no match is 0")
  assert(Lanes.RowSpell({ name = "Other" }, 3001, {}) == 0, "row spell: uses the rows given")
end
print("ok row spell")

do
  -- P2 planned at 60, P3 at 120. A's casts: 10 and 50 in P1, 65 and 100 in P2, 125 in P3.
  local function mk(p2, p3)
    return { boss = "M", length = 200, phases = { { t = p2, planned = 60, label = "P2" }, { t = p3, planned = 120, label = "P3" } },
      rows = { { name = "Nothing", spellID = 0, casts = { { t = 10 }, { t = 50 }, { t = 65 }, { t = 100 }, { t = 125, dur = 5 } } } } }
  end
  local function times(ref)
    local lanes, _, extra = Lanes.Build({ reference = ref }, {}, S, "ref:m")
    local out = {}
    for _, lane in ipairs(lanes) do if lane.kind == "reference" then for _, m in ipairs(lane.marks) do out[#out + 1] = m.t end end end
    return table.concat(out, ","), extra
  end
  local t, extra = times(mk(60, 120))
  assert(t == "10,50,65,100,125" and extra.masked == 0, "phase move: unmoved lines change nothing: " .. t)
  t, extra = times(mk(45, 120))
  assert(t == "10,50,85,125" and extra.masked == 1, "phase move: P2 15 s earlier moves P2's casts with it and hides P1's 50 past the line: " .. t .. " masked " .. extra.masked)
  t, extra = times(mk(45, 105))
  assert(t == "10,50,85,110" and extra.masked == 1, "phase move: P3 earlier too moves P3's cast; P2's moved casts still fit before it: " .. t)
  t, extra = times(mk(45, 80))
  assert(t == "10,50,85" and extra.masked == 2, "phase move: P3 at 80 hides P2's cast that would land at 85 and moves P3's to 85: " .. t .. " masked " .. extra.masked)
  t, extra = times(mk(70, 120))
  assert(t == "10,50,75,110,125" and extra.masked == 0, "phase move: P2 later moves its casts later and hides nothing: " .. t)
  t = times(mk(60, 120))
  assert(t == "10,50,65,100,125", "phase move: back at the planned times every cast is back")
  local lanes = Lanes.Build({ reference = mk(45, 120) }, {}, S, "ref:m")
  local last
  for _, lane in ipairs(lanes) do if lane.kind == "reference" then last = lane.marks[#lane.marks] end end
  assert(last.t == 125 and last.dur == 5, "phase move: a cast keeps its bar")
end
print("ok moved phase lines move and hide casts")

do
  -- the first two rows (Grasping Depths, Invoke) are Mythic-only
  ref.rows[1].types = { "mythic", "raid" }
  ref.rows[2].types = { "mythic" }
  ref.rows[3].types = { "raid" }
  local function refLanes(group)
    local lanes, _, extra = Lanes.Build({ reference = ref }, journalRows, S, 3001, nil, group)
    local out = {}
    for _, lane in ipairs(lanes) do if lane.kind == "reference" then out[#out + 1] = lane end end
    return out, extra
  end
  local nh, nhExtra = refLanes("nh")
  assert(#nh == 9 and nh[1].label == "C" and nh[1].types[1] == "raid", "nh hides mythic rows: " .. #nh)
  for _, lane in ipairs(nh) do assert(lane.label ~= "Grasping Depths" and lane.label ~= "Invoke", "nh hides mythic rows: " .. lane.label) end
  assert(nhExtra.masked == 0, "nh hides mythic rows: their casts are not counted as masked")
  print("ok nh hides mythic rows")
  assert(#refLanes("mythic") == 11, "mythic shows all")
  print("ok mythic shows all")
  assert(#refLanes(nil) == 11, "nil group unchanged")
  print("ok nil group unchanged")
  -- a hidden Mythic row's casts past a phase line are not counted either; a shown row's still are
  local masked = { boss = "M", length = 200, phases = { { t = 45, planned = 60, label = "P2" } }, rows = {
    { name = "Gone", types = { "mythic" }, casts = { { t = 50 }, { t = 55 } } },
    { name = "Kept", types = { "raid" }, casts = { { t = 50 } } } } }
  local _, _, mx = Lanes.Build({ reference = masked }, {}, S, "ref:m", nil, "nh")
  assert(mx.masked == 1, "nh hides mythic rows: only the shown row's masked cast counts, got " .. mx.masked)
  _, _, mx = Lanes.Build({ reference = masked }, {}, S, "ref:m", nil, "mythic")
  assert(mx.masked == 3, "mythic shows all: every masked cast counts, got " .. mx.masked)
  print("ok mythic row casts are not masked casts")
end

do
  local saved = { S.overlayOn, S.deathRows, S.bosses[3001] }
  S.overlayOn, S.deathRows = true, "combined"
  local function p(id, diff, name)
    return { id = id, difficultyID = diff, length = 100, casts = {}, deaths = { { t = id, name = name, class = "MAGE", role = "DAMAGER", spellID = 0 } } }
  end
  S.bosses[3001] = { pulls = { p(1, 15, "H1"), p(2, 16, "M1"), p(3, 15, "H2"), p(4, 16, "M2") } }
  local function names(group)
    local lanes = Lanes.Build(S.bosses[3001].pulls[4], rows, S, 3001, nil, group)
    local out = {}
    for _, m in ipairs(lanes[1].marks) do out[#out + 1] = m.death.name end
    return table.concat(out, ",")
  end
  assert(names("mythic") == "M2,M1", "overlay deaths stay in group: " .. names("mythic"))
  assert(names(nil) == "M2,H2,M1", "overlay deaths stay in group: no group takes every pull: " .. names(nil))
  S.overlayOn, S.deathRows, S.bosses[3001] = saved[1], saved[2], saved[3]
end
print("ok overlay deaths stay in group")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const srcs = process.argv.slice(2).map(f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); } });
srcs.forEach(s => lua.lua_pushstring(L, to_luastring(s)));
if (lua.lua_pcall(L, srcs.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
