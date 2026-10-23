// CRT_Modules/Timeline/Reference.lua: the reference timeline text parser and the store of own and shipped references.
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
local CRT = { db = { timeline = { references = {}, nextRef = 1 } }, Timeline = {} }
local fired = 0
function CRT.Timeline:Settings() return CRT.db.timeline end
function CRT.Timeline:Fire() fired = fired + 1 end
for _, src in ipairs(sources) do
  assert(load(src))("CowfeeRaidTools", CRT)
end
loadBosses(CRT, reg, season, nek)
local R = CRT.TimelineReference
local NEKZALI = R:List()[1].text

do
  local list = R:List()
  assert(#list == 1 and list[1].own == false and list[1].key == "ship:1", "shipped: Nek'zali parses (one shipped reference, not your own)")
  local ref = list[1].ref
  assert(ref.boss == "Nek'zali the Soulcoiler" and ref.difficulty == "Mythic" and ref.length == 588, "shipped: Nek'zali parses (header)")
  assert(#ref.rows == 11 and ref.rows[1].name == "Soulcoil Rite", "shipped: Nek'zali parses (11 rows, Soulcoil Rite first)")
  assert(ref.rows[5].name == "Restless Amani" and #ref.rows[5].casts == 10, "shipped: Nek'zali parses (Restless Amani has 10 casts)")
  assert(#ref.phases == 3, "shipped: Nek'zali parses (3 phases)")
  local want = { "raid", "dispel", "falloff", "mythic", "generic", "heroic raid", "generic", "generic", "soak", "generic", "mythic" }
  for i, row in ipairs(ref.rows) do
    assert(table.concat(row.types or {}, " ") == want[i], "shipped: Nek'zali types: " .. row.name .. " is " .. table.concat(row.types or {}, " "))
  end
  print("ok shipped: Nek'zali parses")
end

local function ser(v)
  if type(v) ~= "table" then return tostring(v) end
  local keys = {}
  for k in pairs(v) do if k ~= "line" then keys[#keys + 1] = k end end -- where a line sits isn't what it says
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local out = {}
  for _, k in ipairs(keys) do out[#out + 1] = tostring(k) .. "=" .. ser(v[k]) end
  return "{" .. table.concat(out, ",") .. "}"
end
local function has(errors, pat)
  for _, e in ipairs(errors or {}) do if e:find(pat) then return true end end
  return false
end

local EXAMPLE = table.concat({
  "Boss: Nek'zali the Soulcoiler",
  "Difficulty: Mythic",
  "Length: 9:48",
  "Phase: P1.5 3:17",
  "Phase: 5:53",
  "Phase: P2 7:20",
  "Soulcoil Rite (color ff6b7d): 0:02+45, 1:17+45, 2:28+45, 7:38, 8:26, 8:58",
  "Possession Barrage (lead 7, color 7ddc6a): 0:36, 1:12, 1:47",
  "Grasping Depths [spell 123456]: 0:42, 1:53",
}, "\\n")

do
  local ref, errs = R.Parse(EXAMPLE)
  assert(ref, "parse: full example: " .. ser(errs))
  assert(ref.boss == "Nek'zali the Soulcoiler" and ref.difficulty == "Mythic" and ref.length == 588, "parse: full example header")
  assert(#ref.phases == 3 and ref.phases[1].t == 197 and ref.phases[1].label == "P1.5"
    and ref.phases[2].t == 353 and ref.phases[2].label == nil
    and ref.phases[3].t == 440 and ref.phases[3].label == "P2", "parse: full example phases")
  assert(#ref.rows == 3 and ref.rows[1].name == "Soulcoil Rite", "parse: full example rows")
  assert(ref.rows[1].casts[1].t == 2 and ref.rows[1].casts[1].dur == 45 and ref.rows[1].casts[4].t == 458 and ref.rows[1].casts[4].dur == nil, "parse: full example casts")
  assert(ref.rows[2].lead == 7 and math.abs(ref.rows[2].color[1] - 0x7d / 255) < 0.001
    and math.abs(ref.rows[2].color[2] - 0xdc / 255) < 0.001 and math.abs(ref.rows[2].color[3] - 0x6a / 255) < 0.001, "parse: full example lead and color")
  assert(ref.rows[3].spellID == 123456 and ref.rows[3].color == nil and ref.rows[3].lead == nil, "parse: full example spell")
  print("ok parse: full example")
end

do
  local ref = R.Parse("Boss: B\\nAbility: 65, 70+5")
  assert(ref and #ref.rows[1].casts == 2 and ref.rows[1].casts[1].t == 65 and ref.rows[1].casts[1].dur == nil
    and ref.rows[1].casts[2].t == 70 and ref.rows[1].casts[2].dur == 5, "parse: plain seconds")
  assert(R.ParseTime("1:05") == 65 and R.ParseTime("65") == 65 and R.ParseTime("0:00") == 0
    and R.ParseTime("1:7a") == nil and R.ParseTime("") == nil and R.ParseTime("x") == nil and R.ParseTime(nil) == nil, "parse: ParseTime")
  print("ok parse: plain seconds")
end

do
  local clean = R.Parse(EXAMPLE)
  local dirty = "\\r\\n\\r\\n   " .. EXAMPLE:gsub("\\n", "   \\r\\n\\r\\n\\t") .. "  \\r\\n\\r\\n"
  local ref, errs = R.Parse(dirty)
  assert(ref, "parse: CRLF: " .. ser(errs))
  assert(ser(ref) == ser(clean), "parse: CRLF, tabs and blank lines")
  print("ok parse: CRLF, tabs and blank lines")
end

do
  local ref = R.Parse("# a comment: with (stuff)\\nBoss: B\\n  # another\\nX: 1")
  assert(ref and #ref.rows == 1 and ref.boss == "B", "parse: comments skipped")
  print("ok parse: comments skipped")
end

do
  local ref = R.Parse("Boss: B\\nLength: 1:00\\nX: 0:50, 0:10, 1:30+10")
  local c = ref.rows[1].casts
  assert(c[1].t == 10 and c[2].t == 50 and c[3].t == 90 and ref.length == 100, "parse: unsorted times and late cast extend length")
  local ref2 = R.Parse("Boss: B\\nX: 0:50, 1:10+5")
  assert(ref2.length == 75, "parse: length without a Length line")
  local ref3 = R.Parse("Boss: B\\nLength: 5:00\\nX: 1")
  assert(ref3.length == 300, "parse: Length kept when longer")
  local ref4 = R.Parse("Boss: B\\nEncounter: 3001\\nPhase: 2:00\\nPhase: P3 1:00\\nX: 1")
  assert(ref4 and ref4.encounterID == 3001 and ref4.phases[1].t == 60 and ref4.phases[2].t == 120, "parse: encounter and phase sort")
  print("ok parse: unsorted times and late cast extend length")
end

do
  local ref, errs = R.Parse("Difficulty: Mythic\\nX: 1")
  assert(ref == nil and has(errs, "Boss"), "parse: no Boss line")
  ref, errs = R.Parse("Boss: B\\nX: 1:7a")
  assert(ref == nil and has(errs, "^Line 2: "), "parse: bad time has line number")
  ref, errs = R.Parse("Boss: B\\nPhase: P2\\nX: 1")
  assert(ref and #ref.phases == 0 and ref.pending[1].label == "P2", "parse: a phase without a time waits for its start")
  ref, errs = R.Parse("Boss: B\\nPhase:\\nX: 1")
  assert(ref == nil and has(errs, "^Line 2: "), "parse: an empty Phase line is an error")
  ref = R.Parse("Boss: B\\nX:\\nY: 1")
  assert(ref and #ref.rows == 2 and #ref.rows[1].casts == 0, "parse: an ability with no times yet")
  ref, errs = R.Parse("Boss: B\\nX (blink 3): 1")
  assert(ref == nil and has(errs, "^Line 2: ") and has(errs, "blink"), "parse: unknown option")
  ref, errs = R.Parse("Boss: B\\nDifficulty: Mythic")
  assert(ref == nil and #errs >= 1, "parse: no ability lines")
  ref, errs = R.Parse("Boss: B\\nX (color 12): 1")
  assert(ref == nil and has(errs, "^Line 2: "), "parse: bad color")
  ref, errs = R.Parse("Boss: B\\nX:\\nY: 1:00, 2")
  assert(ref and #ref.rows[1].casts == 0 and #ref.rows[2].casts == 2, "parse: an ability without times reads, its row empty")
  ref, errs = R.Parse("Boss: B\\nLength: abc\\nX: 1")
  assert(ref == nil and has(errs, "^Line 2: "), "parse: bad length")
  ref, errs = R.Parse("Boss: B\\nX: 1\\nbad line without colon")
  assert(ref == nil and has(errs, "^Line 3: "), "parse: line without a colon")
  ref, errs = R.Parse(nil)
  assert(ref == nil and #errs >= 1, "parse: nil text")
  print("ok parse: errors with line numbers")
end

do
  local k, errs = R:Add("Boss: B\\nX: 1")
  assert(k == "own:1" and fired == 1 and R:List()[1].own == true and R:List()[1].key == "own:1", "store: add")
  local k2, e2 = R:Add("nonsense")
  assert(k2 == nil and #e2 >= 1 and #CRT.db.timeline.references == 1 and fired == 1 and CRT.db.timeline.nextRef == 2, "store: invalid add saves nothing")
  CRT.TimelineDB = { references = { "Boss: Shipped\\nY: 5", "broken", "Boss: Shipped Two\\nZ: 9" } }
  local list = R:List()
  assert(#list == 3 and list[1].key == "own:1" and list[2].key == "ship:1" and list[3].key == "ship:3" and not list[2].own
    and list[2].text == "Boss: Shipped\\nY: 5" and list[1].ref.boss == "B", "store: list order, broken shipped skipped")
  assert(R:Find("ship:3").ref.boss == "Shipped Two" and R:Find("own:1").ref.boss == "B" and R:Find("own:9") == nil and R:Find("junk") == nil, "store: find")
  local f = fired
  R:Delete("ship:1")
  assert(#R:List() == 3 and fired == f, "store: delete shipped does nothing")
  local ok, e3 = R:Update("own:1", "Boss: C\\nX: 2")
  assert(ok and R:Find("own:1").ref.boss == "C" and fired == f + 1, "store: update")
  ok, e3 = R:Update("own:1", "bad")
  assert(not ok and #e3 >= 1 and R:Find("own:1").ref.boss == "C" and fired == f + 1, "store: invalid update keeps old")
  ok = R:Update("ship:1", "Boss: C\\nX: 2")
  assert(not ok and R:Find("ship:1").ref.boss == "Shipped", "store: shipped cannot be updated")
  R:Delete("own:1")
  assert(#R:List() == 2 and R:Find("own:1") == nil and fired == f + 2, "store: delete own")
  local k3 = R:Add("Boss: D\\nX: 1")
  assert(k3 == "own:2", "store: ids are not reused")
  CRT.TimelineDB = nil
  CRT.db.timeline.references = nil
  CRT.db.timeline.nextRef = nil
  local k4 = R:Add("Boss: E\\nX: 1")
  assert(k4 and #R:List() == 1, "store: missing saved fields are made")
  print("ok store: add, list order, delete")
end

do
  CRT.db.timeline.references = {}
  CRT.db.timeline.nextRef = 1
  CRT.TimelineDB = nil
  R:Add("Boss: Nek'zali the Soulcoiler\\nDifficulty: Mythic\\nEncounter: 3001\\nX: 1")
  R:Add("Boss: Nek'zali the Soulcoiler\\nX: 1")
  local a = R:ForBoss(3001, "x")
  assert(#a == 1 and a[1].ref.encounterID == 3001, "for boss: by encounter")
  local b = R:ForBoss(9, "  nek'zali THE soulcoiler ")
  assert(#b == 1 and b[1].ref.encounterID == nil, "for boss: by name")
  assert(#R:ForBoss(3001, "nek'zali the soulcoiler") == 2, "for boss: both")
  assert(#R:ForBoss(nil, nil) == 0, "for boss: nothing")
  print("ok for boss: by encounter and by name")
end

do
  local e = R:ForBoss(9, "Nek'zali the Soulcoiler")[1]
  assert(R:BossKey(e, {}) == "ref:nek'zali the soulcoiler", "boss key: own key")
  assert(R:BossKey(e, { { key = 3470, name = "Nek'zali the Soulcoiler" } }) == 3470, "boss key: listed by name")
  local e2 = R:ForBoss(3001, "x")[1]
  assert(R:BossKey(e2, { { key = 1, name = "Other" }, { key = 3001, name = "Different" } }) == 3001, "boss key: listed by encounter")
  assert(R:BossKey(e2, { { key = 1, name = "Other" } }) == "ref:nek'zali the soulcoiler", "boss key: not listed")
  -- an encounter ID wins: a same-named listed boss with another ID does not take it (as ForBoss)
  local listed = { { key = 3470, name = "Nek'zali the Soulcoiler" } }
  assert(R:BossKey(e2, listed) == "ref:nek'zali the soulcoiler", "boss key: encounter ID is not matched by name")
  for _, x in ipairs(R:ForBoss(3470, "Nek'zali the Soulcoiler")) do
    assert(R:BossKey(x, listed) == 3470, "boss key: agrees with ForBoss")
  end
  print("ok boss key: encounter ID is not matched by name")
  print("ok for boss: name-only reference gets its own key")
end

do
  -- NBSP between words and a zero-width space inside a number
  local text = "Boss:\\194\\160Pasted\\nDifficulty:\\194\\160Mythic\\nRite\\194\\160One: 1:0\\226\\128\\1392, 1:30"
  local ref, errs = R.Parse(text)
  assert(ref, "paste: NBSP and zero-width space: " .. tostring(errs and errs[1]))
  assert(ref.boss == "Pasted" and ref.difficulty == "Mythic", "paste: NBSP and zero-width space: header")
  assert(ref.rows[1].name == "Rite One" and ref.rows[1].casts[1].t == 62, "paste: NBSP and zero-width space: row")
end
print("ok paste: NBSP and zero-width space")

do
  local curly = "Nek\\226\\128\\153zali the Soulcoiler"
  local ref = R.Parse("Boss: " .. curly .. "\\nX: 1")
  assert(ref, "paste: curly apostrophe boss name matches: parses")
  local ref2 = R.Parse("Boss: Nek'zali the Soulcoiler\\nX: 1")
  R:Add("Boss: " .. curly .. "\\nX: 1")
  assert(#R:ForBoss(1, "Nek'zali the Soulcoiler") >= 1, "paste: curly apostrophe boss name matches: ForBoss")
  assert(R:BossKey({ ref = ref }, { { key = 3470, name = "Nek'zali the Soulcoiler" } }) == 3470, "paste: curly apostrophe boss name matches: BossKey")
  assert(R:BossKey({ ref = ref2 }, { { key = 3470, name = curly } }) == 3470, "paste: curly apostrophe boss name matches: listed name curly")
  local left = "Nek\\226\\128\\152zali"
  assert(R:BossKey({ ref = { boss = left } }, { { key = 9, name = "Nek'zali" } }) == 9, "paste: curly apostrophe boss name matches: left quote")
end
print("ok paste: curly apostrophe boss name matches")

do
  local ref, errs = R.Parse("Boss: B\\nX: 1, 2,, 3,")
  assert(ref and #ref.rows[1].casts == 3, "paste: stray commas skipped: " .. tostring(errs and errs[1]))
  ref, errs = R.Parse("Boss: B\\nX: ,")
  assert(ref and #ref.rows[1].casts == 0, "paste: only commas is an ability with no times yet")
end
print("ok paste: stray commas skipped")

do
  local ref = R.Parse(EXAMPLE)
  assert(R.Label(ref) == "Abilities \\194\\183 Mythic \\194\\183 9:48", "label")
  ref.difficulty = nil
  assert(R.Label(ref) == "Abilities \\194\\183 9:48", "label without difficulty")
  print("ok label")
end

do
  local boss, enc = R.Header("Boss:  Nek'zali the Soulcoiler \\r\\nEncounter: 3470\\nX: broken")
  assert(boss == "Nek'zali the Soulcoiler" and enc == 3470, "header: boss and encounter from unparsed text")
  boss, enc = R.Header("X: 1:00")
  assert(boss == nil and enc == nil, "header: none")
  print("ok header read loosely")
end

do
  local rows = { { spellID = 111, name = "Soulcoil Rite" }, { spellID = 222, name = "Grasping Depths" }, { spellID = 333, name = "Invoke" }, { spellID = 0, name = "No Spell" } }
  local text = "Boss: Soulcoil Rite\\r\\nSoulcoil Rite (color ff6b7d): 0:02+45\\r\\nGrasping Depths [spell 9]: 0:42\\r\\nUnknown Thing: 1:00\\r\\n# Invoke: 1:00\\r\\n  invoke: 7:38\\r\\nNo Spell: 5\\r\\nPhase: P2 7:20"
  local out, n = R.FillSpellIDs(text, rows)
  assert(n == 2, "fill: two lines filled, got " .. n)
  local lines = {}
  for l in (out .. "\\n"):gmatch("([^\\n]*)\\n") do lines[#lines + 1] = l end
  assert(lines[1] == "Boss: Soulcoil Rite\\r", "fill: header untouched")
  assert(lines[2] == "Soulcoil Rite [spell 111] (color ff6b7d): 0:02+45\\r", "fill: id before the options: " .. lines[2])
  assert(lines[3] == "Grasping Depths [spell 9]: 0:42\\r", "fill: a given [spell] is kept")
  assert(lines[4] == "Unknown Thing: 1:00\\r", "fill: no match left alone")
  assert(lines[5] == "# Invoke: 1:00\\r", "fill: comment untouched")
  assert(lines[6] == "  invoke [spell 333]: 7:38\\r", "fill: any case, indent kept: " .. lines[6])
  assert(lines[7] == "No Spell: 5\\r", "fill: a Journal row with no spell is skipped")
  assert(lines[8] == "Phase: P2 7:20", "fill: last line kept")
  local ref = R.Parse(out)
  assert(ref and ref.rows[1].spellID == 111 and ref.rows[4].spellID == 333, "fill: result parses with the ids")
  local again, n2 = R.FillSpellIDs(out, rows)
  assert(again == out and n2 == 0, "fill: running it twice changes nothing")
  print("ok fill spell IDs from the Journal")
end

do
  -- [section N]: the row's Encounter Journal section, beside [spell N] in either order
  local ref, errs = R.Parse("Boss: S\\nMark of Acid [spell 1234] [section 5678] (type dispel): 0:10\\nToxic Drops [section 42][spell 77]: 0:20\\nPlain (type raid) [section 9]: 0:30\\nNone: 0:40")
  assert(ref, "section: parses: " .. tostring(errs and errs[1]))
  local a, b, c, d = ref.rows[1], ref.rows[2], ref.rows[3], ref.rows[4]
  assert(a.spellID == 1234 and a.sectionID == 5678 and a.types[1] == "dispel", "section: after the spell")
  assert(b.spellID == 77 and b.sectionID == 42 and b.name == "Toxic Drops", "section: before the spell, no space")
  assert(c.spellID == nil and c.sectionID == 9 and c.types[1] == "raid", "section: after the options, no spell")
  assert(d.sectionID == nil, "section: none written, none read")
  assert(R.Parse("Boss: S\\nX [section ab]: 0:10") == nil, "section: a bad number is an error")
  local _, bad = R.Parse("Boss: S\\nX [sec 1]: 0:10")
  assert(bad and bad[1]:find("[section N]", 1, true), "section: the error names both brackets: " .. tostring(bad and bad[1]))
  -- the text is what is saved, so a round trip through FillSpellIDs keeps it
  local rows = { { spellID = 1234, name = "Mark of Acid", sectionID = 5678 }, { spellID = 77, name = "Toxic Drops", sectionID = 42 }, { spellID = 88, name = "New One", sectionID = 4 } }
  local text = "Boss: S\\nMark of Acid [spell 1234]: 0:10\\nToxic Drops [section 42] [spell 77]: 0:20\\nNew One (type raid): 0:30\\nOther [spell 77]: 0:40"
  local out, n = R.FillSpellIDs(text, rows)
  local lines = {}
  for l in (out .. "\\n"):gmatch("([^\\n]*)\\n") do lines[#lines + 1] = l end
  assert(lines[2] == "Mark of Acid [spell 1234] [section 5678]: 0:10", "fill: a section added after a given spell: " .. lines[2])
  assert(lines[3] == "Toxic Drops [section 42] [spell 77]: 0:20", "fill: a given section kept: " .. lines[3])
  assert(lines[4] == "New One [spell 88] [section 4] (type raid): 0:30", "fill: spell and section both added: " .. lines[4])
  assert(lines[5] == "Other [spell 77] [section 42]: 0:40", "fill: a line's own spell finds its section: " .. lines[5])
  assert(n == 3, "fill: three lines changed, got " .. n)
  local again, n2 = R.FillSpellIDs(out, rows)
  assert(again == out and n2 == 0, "fill: twice changes nothing")
  local back = R.Parse(out)
  assert(back and back.rows[1].sectionID == 5678 and back.rows[3].sectionID == 4 and back.rows[4].sectionID == 42, "section: round trip")
  print("ok [section N] read in either order, written by Fill spell IDs")
end

do
  local ref, errs = R.Parse("Boss: T\\nA (type Mythic soak, lead 6): 0:10\\nB (color 112233, type raid): 0:20\\nC (type raid): 0:30\\nD: 0:40")
  assert(ref, "types: parse: " .. tostring(errs and errs[1]))
  local a, b, c, d = ref.rows[1], ref.rows[2], ref.rows[3], ref.rows[4]
  assert(a.types[1] == "mythic" and a.types[2] == "soak" and a.lead == 6, "types: several, any case, with other options")
  assert(a.color[1] == R.TYPES.mythic.color[1] and a.color[3] == R.TYPES.mythic.color[3], "types: the first type colors the row")
  assert(math.abs(b.color[1] - 0x11 / 255) < 0.001, "types: a color option wins over the type")
  assert(c.color[1] == R.TYPES.raid.color[1], "types: raid color")
  assert(d.types == nil and d.color == nil, "types: none given leaves the row plain")
  ref, errs = R.Parse("Boss: T\\nA (type soak blinky): 0:10")
  assert(ref == nil and errs[1]:find("^Line 2: unknown type 'blinky'"), "types: unknown type is an error: " .. tostring(errs and errs[1]))
  local legend = R.Legend()
  local n = 0
  for line in (legend .. "\\n"):gmatch("([^\\n]*)\\n") do n = n + 1 assert(line:find("^|cff%x%x%x%x%x%x"), "types: legend line colored: " .. line) end
  assert(n == 10 and legend:find("Soak %(soak%)") and legend:find("Dodge %(dodge%)") and legend:find("Heavy DoT %(heavydot%): heavy damage over time"), "types: legend has the ten types")
  print("ok ability types")
end

do
  local text = "Boss: T\\r\\nPhase: P2 1:00\\r\\nPhase: P3 2:00 (planned 2:10)\\r\\nA: 0:10, 1:05"
  local ref = assert(R.Parse(text), "phase planned: parses")
  assert(ref.phases[1].t == 60 and ref.phases[1].planned == 60 and ref.phases[1].label == "P2", "phase planned: an unmoved phase is planned at its own time")
  assert(ref.phases[2].t == 120 and ref.phases[2].planned == 130 and ref.phases[2].label == "P3", "phase planned: a moved phase keeps its planned time")
  local s = R.PhaseStarts(ref)
  assert(#s == 3 and s[1] == 0 and s[2] == 60 and s[3] == 120, "phase starts: the pull, then each phase's current start")
  local bad = select(2, R.Parse("Boss: T\\nPhase: P2 1:00 (planned x)\\nA: 1"))
  assert(bad and bad[1]:find("^Line 2: bad planned time"), "phase planned: a bad planned time is an error")
  print("ok phase lines keep their planned time")

  local moved = R.MovePhaseText(text, 1, 50)
  assert(moved:find("Phase: P2 0:50 (planned 1:00)\\r\\n", 1, true), "move phase: first phase moved, planned kept, line end kept: " .. moved)
  local back = R.MovePhaseText(moved, 1, 60)
  assert(back:find("Phase: P2 1:00\\r\\n", 1, true) and not back:find("planned 1:00", 1, true), "move phase: back at its planned time the note goes away")
  local p3 = R.MovePhaseText(text, 2, 130)
  assert(p3:find("Phase: P3 2:10\\r\\n", 1, true) or p3:find("Phase: P3 2:10$"), "move phase: a moved phase moved back to plan")
  assert(R.MovePhaseText(text, 5, 10) == nil, "move phase: no such phase gives nil")
  print("ok phase lines move in the reference text")

  local own = R:Add("Boss: Own\\nPhase: P2 1:00\\nA: 1")
  local key, copied = R:MovePhase(own, 1, 70)
  assert(key == own and copied == false and R:Find(own).text:find("Phase: P2 1:10 (planned 1:00)", 1, true), "move phase: your own reference changes in place")
  local shipKey
  CRT.TimelineDB = CRT.TimelineDB or {}
  CRT.TimelineDB.references = CRT.TimelineDB.references or {}
  if not R:Find("ship:1") then CRT.TimelineDB.references[1] = "Boss: S\\nPhase: P2 3:17\\nA: 1" end
  shipKey = "ship:1"
  local before = #CRT.db.timeline.references
  local newKey, made = R:MovePhase(shipKey, 1, 190)
  assert(newKey and made == true and newKey:find("^own:") and #CRT.db.timeline.references == before + 1, "move phase: a shipped reference becomes a copy of your own: " .. tostring(shipKey) .. " " .. tostring(newKey) .. " " .. tostring(made) .. " " .. before .. "->" .. #CRT.db.timeline.references)
  assert(R:Find(newKey).text:find("(planned 3:17)", 1, true), "move phase: the copy holds the move")
  assert(not R:Find(shipKey).text:find("planned", 1, true), "move phase: the shipped text is unchanged")
  R:Delete(newKey) R:Delete(own)
  print("ok moving a phase saves into the reference")
end
do
  local function d(difficulty) return { difficulty = difficulty } end
  assert(R.Group(d("Mythic")) == "mythic" and R.Group(d(" mythic ")) == "mythic" and R.Group(d("Heroic")) == "nh"
    and R.Group(d("Normal")) == "nh" and R.Group({}) == "nh", "reference group")
  print("ok reference group")

  local crlf = "Boss: T\\r\\ndifficulty:  mythic\\r\\nA (type mythic): 1\\r\\n"
  local s = R.StampDifficulty(crlf, "nh")
  assert(s == "Boss: T\\r\\nDifficulty: Heroic\\r\\nA (type mythic): 1\\r\\n", "stamp difficulty in odd forms: CRLF line replaced, CR kept: ")
  local none = R.StampDifficulty("Boss: T\\nA: 1", "mythic")
  assert(none == "Boss: T\\nDifficulty: Mythic\\nA: 1", "stamp difficulty in odd forms: inserted after Boss: " .. none)
  assert(R.StampDifficulty("A: 1", "nh") == "Difficulty: Heroic\\nA: 1", "stamp difficulty in odd forms: no Boss line goes at the top")
  assert(R.StampDifficulty("Boss: T\\r\\nA: 1", "nh") == "Boss: T\\r\\nDifficulty: Heroic\\r\\nA: 1", "stamp difficulty in odd forms: inserted line takes CRLF")
  assert(R.StampDifficulty("Boss: T\\nDifficulty: Normal\\nA: 1", "nh") == "Boss: T\\nDifficulty: Normal\\nA: 1", "stamp difficulty in odd forms: Normal stays Normal")
  local moved = "Boss: T\\r\\nPhase: P2 2:53 (planned 3:03)\\r\\nA (type mythic): 1\\r\\nB: 2"
  local st, cp = R.StampDifficulty(moved, "nh"), R.CopyTo(moved, "nh")
  assert(st:find("Phase: P2 2:53 (planned 3:03)\\r\\n", 1, true) and cp:find("Phase: P2 2:53 (planned 3:03)\\r\\n", 1, true)
    and not cp:find("type mythic", 1, true), "stamp and copy keep a moved phase line byte for byte")
  print("ok stamp difficulty in odd forms")

  for _, odd in ipairs({ "Difficulty\\194\\160: Mythic", "\\194\\160Difficulty: Mythic", "\\226\\128\\139Difficulty: Mythic" }) do
    local o = R.StampDifficulty("Boss: T\\n" .. odd .. "\\nA: 1", "nh")
    assert(o == "Boss: T\\nDifficulty: Heroic\\nA: 1" or o == "Boss: T\\n Difficulty: Heroic\\nA: 1", "stamp difficulty folds NBSP and zero-width space: one line, restamped: " .. o)
    local c = R.CopyTo("Boss: T\\n" .. odd .. "\\nA: 1\\nPhase\\194\\160: P2 1:00", "nh")
    local _, n = c:gsub("ifficulty", "")
    assert(n == 1 and c:find("Heroic", 1, true) and c:find("Phase", 1, true), "stamp difficulty folds NBSP and zero-width space: copy keeps one line: " .. c)
  end
  print("ok stamp difficulty folds NBSP and zero-width space")

  local nek = NEKZALI
  local text, removed = R.CopyTo(nek, "nh")
  local ref, errs = R.Parse(text)
  assert(ref, "copy to nh: parses: " .. ser(errs))
  assert(removed == 2 and #ref.rows == 9 and ref.difficulty == "Heroic", "copy to nh drops mythic-only rows: " .. removed .. " " .. #ref.rows .. " " .. tostring(ref.difficulty))
  local blight
  for _, row in ipairs(ref.rows) do
    assert(not R.MythicOnly(row), "copy to nh drops mythic-only rows: " .. row.name .. " is left")
    if row.name:find("Corpse Blight") then blight = row end
  end
  assert(blight and table.concat(blight.types, " ") == "heroic raid", "copy to nh drops mythic-only rows: Corpse Blight keeps heroic raid")
  assert(#ref.phases == 3, "copy to nh drops mythic-only rows: phases kept")
  print("ok copy to nh drops mythic-only rows")

  local heroic = "Boss: T\\nDifficulty: Heroic\\nA (type mythic): 1\\nB: 2"
  local mtext, mremoved = R.CopyTo(heroic, "mythic")
  local mref = R.Parse(mtext)
  assert(mremoved == 0 and mref and mref.difficulty == "Mythic" and #mref.rows == 2, "copy to mythic keeps all")
  print("ok copy to mythic keeps all")

  local before = #CRT.db.timeline.references
  local k1, k2 = R:Add((R.CopyTo(nek, "nh"))), R:Add((R.CopyTo(nek, "nh")))
  assert(k1 and k2 and k1 ~= k2 and #CRT.db.timeline.references == before + 2, "copy twice makes two")
  R:Delete(k1) R:Delete(k2)
  print("ok copy twice makes two")

  assert(R.MythicOnly({ types = { "mythic", "soak" } }) == true and R.MythicOnly({ types = { "heroic", "raid" } }) == false
    and R.MythicOnly(nil) == false and R.MythicOnly({}) == false, "mythic only")
  print("ok mythic only")

  local list = R:List()
  local nh, my = R:ForGroup(list, "nh"), R:ForGroup(list, "mythic")
  assert(#nh + #my == #list and #my >= 1 and R:ForGroup(my, "mythic")[1] == my[1], "for group splits the entries")
  print("ok for group")
  -- chosen order: an Order line and (part ...) rows
  local ot = "Boss: T\\nPhase: E1 1:00\\nPhase: E2 3:00\\nPhase: E3 4:30\\nPhase: 7:00\\nOrder: E1, E2, E3 = Gebbo, Nama, Iku\\n"
    .. "Shared: 0:30, 1:30, 3:30\\nToss (part Gebbo): 1:10, 1:40\\nThud (part nama): 3:15\\nVolley (part Iku): 5:20, 6:55\\nEarly (part Gebbo): 0:20"
  local oref, oerr = R.Parse(ot)
  assert(oref, "order parses: " .. tostring(oerr and oerr[1]))
  assert(oref.order and #oref.order.parts == 3 and oref.order.phases[1] == 1 and oref.order.phases[3] == 3, "order phases resolved")
  assert(oref.rows[3].part == "Nama", "part matched to the Order's spelling")
  print("ok order line and parts parse")

  local _, e1 = R.Parse("Boss: T\\nPhase: E1 1:00\\nOrder: E1, E9 = A, B\\nX (part A): 1")
  assert(e1 and e1[1]:find("no Phase line called 'E9'"), "order names a missing phase: " .. tostring(e1 and e1[1]))
  local _, e2 = R.Parse("Boss: T\\nPhase: E1 1:00\\nPhase: E2 2:00\\nOrder: E1, E2 = A, B\\nX (part C): 1")
  assert(e2 and e2[1]:find("part 'C' is not on an Order line"), "unknown part")
  local _, e3 = R.Parse("Boss: T\\nPhase: E1 1:00\\nPhase: E2 2:00\\nOrder: E1, E2 = A1, B\\nX: 1")
  assert(e3 and e3[1]:find("digit"), "part with a digit")
  local _, e4 = R.Parse("Boss: T\\nPhase: E1 1:00\\nPhase: E2 2:00\\nOrder: E1, E2 = A\\nX: 1")
  assert(e4 and e4[1]:find("as many parts"), "count mismatch")
  local _, e5 = R.Parse("Boss: T\\nX (part A): 1")
  assert(e5 and e5[1]:find("not on an Order line"), "part without an Order line")
  print("ok order errors")

  local orders = R.Orders(oref)
  assert(#orders == 6 and R.OrderKey(orders[1]) == "Gebbo > Nama > Iku", "six orders, written first")
  local seen, n = {}, 0
  for _, o in ipairs(orders) do seen[R.OrderKey(o)] = true end
  for _ in pairs(seen) do n = n + 1 end
  assert(n == 6, "all different")
  assert(#R.Orders(R.Parse("Boss: T\\nX: 1")) == 0, "no order line, no orders")
  assert(R.OrderKey(R.ResolveOrder(oref, "Iku > Gebbo > Nama")) == "Iku > Gebbo > Nama"
    and R.OrderKey(R.ResolveOrder(oref, "Bogus > X")) == "Gebbo > Nama > Iku"
    and R.OrderKey(R.ResolveOrder(oref, nil)) == "Gebbo > Nama > Iku", "resolve order")
  print("ok orders listed and resolved")

  local move, parts = R.PartMover(oref, "Iku > Gebbo > Nama")
  local orows = oref.rows
  assert(move(orows[1], 30) == 30 and move(orows[1], 210) == 210, "shared rows stay")
  assert(move(orows[2], 70) == 190 and move(orows[2], 100) == 220, "Gebbo moves from E1 to E2")
  assert(move(orows[3], 195) == 285, "Nama moves from E2 to E3")
  assert(move(orows[4], 320) == 110, "Iku moves from E3 to E1")
  assert(move(orows[4], 415) == false, "a cast past its new window is hidden")
  assert(move(orows[5], 20) == 20, "a part cast outside its window stays")
  assert(parts[1] == "Iku" and parts[2] == "Gebbo" and parts[3] == "Nama" and parts[4] == nil, "parts by phase")
  local _, _, unmove = R.PartMover(oref, "Iku > Gebbo > Nama")
  assert(unmove(orows[2], 190) == 70 and unmove(orows[3], 285) == 195 and unmove(orows[4], 110) == 320, "unmove reverses move")
  assert(unmove(orows[2], 70) == false and unmove(orows[1], 70) == 70, "unmove: outside the chosen window is false; shared rows stay")
  local same = R.PartMover(oref, nil)
  assert(same(orows[2], 70) == 70, "written order moves nothing")
  local plain = R.PartMover(R.Parse("Boss: T\\nX: 1"), "A > B")
  assert(plain({}, 5) == 5, "no order line moves nothing")
  print("ok part mover")

  local mt, mr = R.CopyTo("Boss: T\\nDifficulty: Mythic\\nPhase: E1 1:00\\nPhase: E2 2:00\\nOrder: E1, E2 = A, B\\nX (part A, type mythic): 1:10\\nY (part B): 2:10", "nh")
  assert(mr == 1 and not mt:find("X %(") and mt:find("Order: E1, E2 = A, B"), "copy to nh drops a mythic part row, keeps Order")
  print("ok copy to keeps the order line")
  local w1 = R.Parse("Boss: T\\nPhase: Empowered 1 1:04\\nPhase: Empowered 2 3:03\\nX: 1")
  assert(w1 and w1.warnings and w1.warnings[1]:find("reads as phase 1") and #w1.warnings == 1, "a label that reads as phase 1 warns")
  local w2 = R.Parse("Boss: T\\nPhase: P2 1:00\\nPhase: P2 again 2:00\\nPhase: P2.5 2:30\\nPhase: P3 3:00\\nX: 1")
  assert(w2 and #w2.warnings == 1 and w2.warnings[1]:find("Line 3"), "a repeated number warns once")
  local w3 = R.Parse("Boss: T\\nPhase: Empowered A 1:04\\nPhase: P2 2:00\\nPhase: 3:00\\nX: 1")
  assert(w3 and w3.warnings == nil, "no digits, or new numbers: no warning")
  print("ok phase labels that clash with alert phase numbers warn")
  -- List parses each text once: a second List with nothing changed parses nothing
  do
    local real, count = R.Parse, 0
    R.Parse = function(text) count = count + 1 return real(text) end
    R:List()
    count = 0
    local a = R:List()
    assert(count == 0, "a second List parses nothing: " .. count)
    assert(R:List()[1].ref == a[1].ref, "the same text gives the same parsed ref")
    local key = R:Add("Boss: Cache\\nC: 1")
    count = 0
    R:List()
    assert(count == 1, "an added reference is parsed once: " .. count)
    R:Update(key, "Boss: Cache\\nC: 2")
    count = 0
    local b = R:List()
    local found
    for _, e in ipairs(b) do if e.key == key then found = e end end
    assert(count == 1 and found.ref.rows[1].casts[1].t == 2, "an updated reference is parsed again")
    R:Delete(key)
    count = 0
    R:List()
    assert(count == 0, "a delete parses nothing")
    R.Parse = real
  end
  print("ok List parses each text once")
  do
    local both = R.Parse("Boss: T\\nPhase: P1.5 3:07 (Intermission: Ritual) (planned 3:17)\\nX: 1")
    local ph = both and both.phases[1]
    assert(ph and ph.t == 187 and ph.planned == 197 and ph.title == "Intermission: Ritual" and ph.label == "P1.5", "a moved phase keeps its title and planned time")
    local moved = R.MovePhaseText("Boss: T\\nPhase: P1.5 3:17 (Intermission: Ritual)\\nX: 1", 1, 187)
    assert(moved and moved:find("Phase: P1.5 3:07 (Intermission: Ritual) (planned 3:17)", 1, true), "moving a titled phase keeps the title: " .. tostring(moved))
    local again = R.Parse(moved)
    assert(again and again.phases[1].title == "Intermission: Ritual" and again.phases[1].planned == 197, "the moved line reads back")
    local back = R.MovePhaseText(moved, 1, 197)
    assert(back and back:find("Phase: P1.5 3:17 (Intermission: Ritual)", 1, true) and not back:find("planned", 1, true), "moving it back drops only the planned time")
  end
  print("ok a titled phase line moves with its title")
end
do
  -- Shipped references marked for removal (dev.removedReferences): left out of the list, Keep brings them back.
  for _, e in ipairs(R:List()) do if e.own then R:Delete(e.key) end end
  CRT.TimelineDB = { references = { NEKZALI } }
  local NAME = "Nek'zali the Soulcoiler"
  local shippedEntry = R:List()[1]
  assert(shippedEntry and not shippedEntry.own, "marks: one shipped reference to start")
  assert(CRT.db.dev == nil or CRT.db.dev.removedReferences == nil, "marks: none stored to start")
  assert(not R:IsRemoved(shippedEntry), "marks: an unmarked shipped reference is not removed")
  local own = R:Add(NEKZALI)
  local ownEntry = R:Find(own)
  R:SetRemoved(ownEntry, true)
  assert(CRT.db.dev == nil or CRT.db.dev.removedReferences == nil, "marks: your own copy cannot be marked")
  local before = fired
  R:SetRemoved(shippedEntry, true)
  assert(fired == before + 1, "marks: marking redraws the Timeline")
  local marks = CRT.db.dev and CRT.db.dev.removedReferences
  local n = 0
  for _ in pairs(marks or {}) do n = n + 1 end
  assert(n == 1, "marks: one mark stored in dev.removedReferences")
  local list = R:List()
  assert(#list == 1 and list[1].own and list[1].key == own, "marks: the marked shipped reference leaves the list, your copy stays")
  assert(R:Find(shippedEntry.key) == nil, "marks: Find skips a marked shipped reference")
  assert(#R:ForBoss(nil, NAME) == 1, "marks: ForBoss leaves it out")
  local all = R:List(true)
  assert(#all == 2 and all[2].removed and not all[1].removed, "marks: List(true) still has it, flagged removed")
  assert(#R:ForBoss(nil, NAME, true) == 2, "marks: ForBoss(..., true) still has it")
  assert(R:IsRemoved(all[2]) and not R:IsRemoved(all[1]), "marks: IsRemoved")
  -- the mark is keyed by the block's header, not its place in the list, so it survives a /reload
  local key = R.RemovalKey(shippedEntry.ref, shippedEntry.text)
  assert(marks[key] and key:find("Boss: Nek'zali the Soulcoiler / Difficulty: Mythic / Length: 9:48", 1, true), "marks: keyed by the header: " .. key)
  local removed = R:Removed()
  assert(#removed == 1 and removed[1].boss == NAME and removed[1].difficulty == "Mythic" and removed[1].header == "Boss: Nek'zali the Soulcoiler / Difficulty: Mythic / Length: 9:48", "marks: Removed lists the mark")
  -- Keep
  R:SetRemoved(all[2], false)
  assert(#R:List() == 2 and R:Find(shippedEntry.key), "marks: Keep brings it back")
  assert(CRT.db.dev.removedReferences == nil, "marks: no marks left, the store is dropped")
  assert(#R:Removed() == 0, "marks: Removed is empty")
  print("ok shipped references marked for removal leave the list, Keep restores them")

  -- Delete all my copies for a boss leaves the shipped references (and other bosses' copies) alone.
  local other = R:Add("Boss: Someone Else\\nX: 0:10")
  R:Add(NEKZALI)
  R:SetRemoved(shippedEntry, true)
  local before2 = fired
  local count = R:DeleteOwn(nil, NAME)
  assert(count == 2, "delete all: two copies deleted, got " .. tostring(count))
  assert(fired == before2 + 1, "delete all: one redraw")
  local left = R:List(true)
  assert(#left == 2, "delete all: the other boss's copy and the shipped one are left")
  local sawShipped, sawOther = false, false
  for _, e in ipairs(left) do
    if e.key == other then sawOther = true end
    if not e.own and e.ref.boss == NAME then sawShipped = e.removed end
  end
  assert(sawOther and sawShipped, "delete all: the shipped reference keeps its mark, the other boss's copy stays")
  assert(R:DeleteOwn(nil, NAME) == 0, "delete all: nothing left to delete")
  R:SetRemoved(R:List(true)[2], false)
  R:Delete(other)
  print("ok Delete all my copies leaves shipped references alone")

  -- your copies keep when their text last changed
  local now = 1000
  time = function() return now end
  local saved = R:Add(NEKZALI)
  assert(R:Find(saved).saved == 1000, "saved: Add stamps the time")
  now = 2000
  assert(R:Update(saved, NEKZALI) and R:Find(saved).saved == 1000, "saved: an Update with no change keeps the date")
  assert(R:Update(saved, NEKZALI .. "\\n# changed") and R:Find(saved).saved == 2000, "saved: an Update with new text refreshes it")
  R:Delete(saved)
  time = nil
  print("ok your copies keep when they last changed")

  -- marks whose block is already gone from the boss files
  CRT.TimelineDB = { references = { NEKZALI } }
  R:SetRemoved(R:List()[1], true)
  local m = R:Removed()
  assert(#m == 1 and not m[1].gone and m[1].encounterID == 3470, "gone: a shipped block's mark is not gone (encounter from the boss file)")
  CRT.TimelineDB.references = {}
  m = R:Removed()
  assert(#m == 1 and m[1].gone, "gone: no shipped block has its header")
  local realLoaded = CRT.Bosses.Loaded
  CRT.Bosses.Loaded = function() return false end
  assert(not R:Removed()[1].gone and R:PruneRemoved() == 0, "gone: a boss whose season isn't loaded can't tell, kept")
  CRT.Bosses.Loaded = realLoaded
  local before3 = fired
  assert(R:PruneRemoved() == 1 and fired == before3 + 1, "gone: PruneRemoved drops it")
  assert(#R:Removed() == 0 and CRT.db.dev.removedReferences == nil, "gone: nothing left")
  assert(R:PruneRemoved() == 0, "gone: nothing to prune")
  print("ok marks whose blocks are gone are flagged and pruned")
end
do
  -- the In use pick's key: two shipped blocks with the same Boss, Difficulty and Length never share one
  local a = "Boss: Twin\\nDifficulty: Mythic\\nLength: 5:00\\nSmash: 0:10"
  local b = "Boss: Twin\\nDifficulty: Mythic\\nLength: 5:00\\nSmash: 0:20"
  local ea = { own = false, key = "ship:1", ref = R.Parse(a), text = a }
  local eb = { own = false, key = "ship:2", ref = R.Parse(b), text = b }
  assert(R.RemovalKey(ea.ref, a) == R.RemovalKey(eb.ref, b), "the two share a header")
  local ka, kb = R.ChoiceKey(ea), R.ChoiceKey(eb)
  assert(ka and kb and ka ~= kb, "choice key: a tiebreak from the text keeps them apart: " .. tostring(ka))
  local moved = { own = false, key = "ship:9", ref = R.Parse(a), text = a }
  assert(R.ChoiceKey(moved) == ka, "choice key: the same block in another list place keeps its key")
  assert(R.ChoiceKey({ own = true, key = "own:3", ref = ea.ref, text = a }) == "own:3", "choice key: yours by its own key")
  print("ok the In use key keeps same-header shipped blocks apart")
end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
// Each file named on the command line is loaded in order (Database.lua before Reference.lua).
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
