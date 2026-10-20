// Timeline/Journal.lua: ability rows from a mocked Encounter Journal plus own spells.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local src = ...
local combat, ejShown = false, false
local selected = 777
local selectCalls = 0
function InCombatLockdown() return combat end
EncounterJournal = { IsShown = function() return ejShown end }
local onEvent
function CreateFrame() return { RegisterEvent = function() end, SetScript = function(_, _, fn) onEvent = fn end } end
C_Map = { GetBestMapForUnit = function() return 1 end }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end }
local sections = {
  [10] = { spellID = 0, title = "Root", firstChildSectionID = 11 },
  [11] = { spellID = 5001, title = "A", abilityIcon = 1, siblingSectionID = 12 },
  [12] = { spellID = 5002, title = "B", abilityIcon = 2, siblingSectionID = 13 },
  [13] = { spellID = 5001, title = "A again", abilityIcon = 1 },
}
C_EncounterJournal = { GetSectionInfo = function(id) return sections[id] end }
-- instance 100 (not the player's map instance) holds a decoy; 200 holds journal encounter 900 = dungeon 3001
local encs = { [100] = { { "Decoy", 800, 20, 3999 } }, [200] = { { "Boss", 900, 10, 3001 } } }
function EJ_GetInstanceForMap(map) return nil end
function EJ_GetCurrentTier() return 1 end
function EJ_GetInstanceByIndex(i, raid) local l = { 100, 200 }; return l[i] end
function EJ_GetCurrentInstance() return selected end
function EJ_SelectInstance(id) selected = id; selectCalls = selectCalls + 1 end
function EJ_GetEncounterInfoByIndex(j)
  local e = encs[selected] and encs[selected][j]
  if e then return e[1], "", e[2], e[3] end
end
function EJ_GetEncounterInfo(jid)
  for _, list in pairs(encs) do for _, e in ipairs(list) do
    if e[2] == jid then return e[1], "", e[2], e[3], "", 0, e[4], 0 end
  end end
end
local function defaults() return { rows = {} } end
local CRT = { db = { timeline = defaults() }, Timeline = {} }
local fired = 0
function CRT.Timeline:Settings() return CRT.db.timeline end
function CRT.Timeline:Fire() fired = fired + 1 end
assert(load(src, "Timeline/Journal.lua"))("CowfeeRaidTools", CRT)
local J = CRT.TimelineJournal
local function ids(rows) local t = {} for i, r in ipairs(rows) do t[i] = r.spellID end return table.concat(t, ",") end

local rows = J:Rows(3001)
assert(ids(rows) == "5001,5002" and rows[1].name == "Spell5001" and rows[1].icon == "tex5001" and not rows[1].own, "journal rows in order without duplicates")
print("ok journal rows in order without duplicates")
assert(selected == 777, "instance restored")
print("ok instance restored")

local before = fired
J:AddCustom(3001, 9999)
rows = J:Rows(3001)
assert(ids(rows) == "5001,5002,9999" and rows[3].own == true and fired > before, "custom rows appended")
print("ok custom rows appended")
J:RemoveCustom(3001, 9999)
assert(ids(J:Rows(3001)) == "5001,5002", "custom rows removed")
print("ok custom rows removed")

J:SetHidden(3001, 5002, true)
assert(J:IsHidden(3001, 5002) and not J:IsHidden(3001, 5001) and ids(J:Rows(3001)) == "5001,5002", "hidden flag")
J:SetHidden(3001, 5002, false)
assert(not J:IsHidden(3001, 5002) and not J:IsHidden(4242, 1), "hidden flag cleared")
print("ok hidden flag")

assert(#J:Rows(4242) == 0 and selected == 777, "journal: unknown encounter gives no rows")
print("ok journal: unknown encounter gives no rows")

do
  local calls = selectCalls
  assert(#J:Rows("ref:x") == 0 and #J:Rows(nil) == 0 and selectCalls == calls, "journal: string key gives no rows and no walk")
  print("ok journal: string key gives no rows and no walk")
end

do
  onEvent()
  local calls = selectCalls
  J:Rows(4242)
  local after = selectCalls
  J:Rows(4242)
  assert(after > calls and selectCalls == after, "miss cached: second call does not walk")
  onEvent()
  J:Rows(4242)
  assert(selectCalls > after, "miss cache cleared on zone change")
  print("ok miss cached until zone change")
end

J:SetHidden(3001, 1, false) -- clears cache
combat = true
assert(#J:Rows(3001) == 0, "no lookup in combat")
combat = false
assert(ids(J:Rows(3001)) == "5001,5002", "no lookup in combat: later call works")
print("ok no lookup in combat")

J:AddCustom(3001, 9998) -- clears cache
ejShown = true
assert(#J:Rows(3001) == 0, "no lookup while the journal is shown")
ejShown = false
assert(ids(J:Rows(3001)) == "5001,5002,9998", "journal shown: later call works")
print("ok no lookup while the journal is shown")

-- no EJ_GetCurrentInstance: the previous instance comes from EncounterJournal.instanceID
do
  local saved = EJ_GetCurrentInstance
  EJ_GetCurrentInstance = nil
  EncounterJournal.instanceID = 321
  selected = 321
  onEvent()
  J:Rows(4243)
  assert(selected == 321, "instance restored from EncounterJournal.instanceID")
  EJ_GetCurrentInstance = saved
  EncounterJournal.instanceID = nil
  print("ok instance restored without EJ_GetCurrentInstance")
end

-- map-based lookup is tried first
J:RemoveCustom(3001, 9998)
function EJ_GetInstanceForMap(map) return 200 end
selected = 555
J:SetHidden(3001, 1, false)
assert(ids(J:Rows(3001)) == "5001,5002" and selected == 555, "map lookup")
print("ok map lookup")

-- a boss found by its Journal name (for a reference with no Encounter line)
function EJ_GetInstanceForMap(map) return nil end
encs[200][2] = { "Nek\\226\\128\\153zali the Soulcoiler", 901, 10, 3470 }
selected = 777
onEvent()
local calls = selectCalls
assert(J:EncounterByName("  nek'zali THE soulcoiler ") == 3470, "by name: found, trimmed, any case, curly apostrophe")
assert(selected == 777, "by name: instance restored")
print("ok journal boss found by name")
calls = selectCalls
assert(J:EncounterByName("Nek'zali the Soulcoiler") == 3470 and selectCalls == calls, "by name: cached")
print("ok journal name lookup cached")
assert(J:EncounterByName("Nobody") == nil, "by name: unknown boss")
calls = selectCalls
assert(J:EncounterByName("Nobody") == nil and selectCalls == calls, "by name: miss remembered")
onEvent()
J:EncounterByName("Nobody")
assert(selectCalls > calls, "by name: miss tried again after a zone change")
print("ok journal name miss remembered until zone change")
combat = true
assert(J:EncounterByName("Boss") == nil, "by name: nothing in combat")
combat = false
assert(J:EncounterByName("Boss") == 3001, "by name: combat result not cached")
print("ok journal name lookup waits for combat to end")
assert(J:ResolveID(3001, nil) == 3001, "resolve: number key")
assert(J:ResolveID("ref:x", { encounterID = 42, boss = "Boss" }) == 42, "resolve: Encounter line first")
assert(J:ResolveID("ref:nek", { boss = "Nek'zali the Soulcoiler" }) == 3470, "resolve: by boss name")
assert(J:ResolveID("ref:x", nil) == nil, "resolve: nothing to go on")
print("ok resolve id")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
let src; try { src = fs.readFileSync(process.argv[2], 'utf8'); } catch (e) { console.error('cannot read ' + process.argv[2]); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
