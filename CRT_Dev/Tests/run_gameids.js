// The season's game IDs (topic gameIDs: consumables, class cooldowns, raid buffs) and their readers: the registry's
// accessors Bosses:Consumables(), Bosses:Cooldowns() and Bosses:RaidBuffs() (present, and nil for a season without
// them), the consumables list (Consumables/Data.lua) with /crt consumables check and scan (Consumables/Tools.lua),
// the raid report's buffs (ReadyCheck/Report.lua), the ready check window's buff columns (ReadyCheck/Window.lua) and
// the Ready button lock (ReadyCheck/BuffLock.lua). Loads the files in the .toc's order, the season pack last, as the
// game does; the pack is the tests' sample (CRT_Dev/Tests/SamplePack), never the shipped one.
// Usage: node run_gameids.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const W = process.argv[2];
const FILES = [
  'CRT_Data/Bosses/Registry.lua',
  'CRT_Modules/Consumables/Database.lua', 'CRT_Modules/Consumables/Data.lua', 'CRT_Modules/Consumables/Tools.lua',
  'CRT_Modules/ReadyCheck/Report.lua', 'CRT_Modules/ReadyCheck/Window.lua', 'CRT_Modules/ReadyCheck/BuffLock.lua',
  'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/GameIDs.lua',
];
const harness = `
local src = { ... }
local FILES = ${'{'}${FILES.map(f => JSON.stringify(f)).join(', ')}${'}'}
local passes, fails = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. (a == b and "" or (": got " .. tostring(a) .. ", want " .. tostring(b)))) end

-- a frame or widget: methods (capitalised keys) do nothing unless named below; SetText keeps its text
local function stub()
  local t = { scripts = {}, events = {} }
  return setmetatable(t, { __index = function(_, k)
    if type(k) ~= "string" or not k:match("^[A-Z]") then return nil end
    if k == "SetText" then return function(s, v) s.text = v end end
    if k == "GetText" then return function(s) return s.text end end
    if k == "SetScript" then return function(s, n, fn) s.scripts[n] = fn end end
    if k == "RegisterEvent" then return function(s, e) s.events[e] = true end end
    if k == "UnregisterEvent" then return function(s, e) s.events[e] = nil end end
    if k == "GetFrameLevel" then return function() return 1 end end
    if k:match("^Create") then return function() return stub() end end
    return function() end
  end })
end
CreateFrame = function() return stub() end
UIParent, UISpecialFrames, CRTFontEdit = stub(), {}, {}
tinsert, wipe, format = table.insert, function(t) for k in pairs(t) do t[k] = nil end return t end, string.format
function GetTime() return 1000 end
function time() return 0 end
function InCombatLockdown() return false end
function issecretvalue() return false end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
C_Timer = { After = function(_, fn) fn() end }
C_Item = {
  GetItemInfoInstant = function(id) if id == 999999 then return nil end return id, "", "Food", "", 100 + id, 0 end,
  GetItemSpell = function(id) return "Use", 5000 + id end,
  GetItemCount = function() return 0 end,
  GetItemNameByID = function(id) return "Item" .. id end,
}
C_Spell = {
  GetSpellTexture = function(id) return 200 + id end,
  GetSpellName = function(id) return "Spell" .. id end,
}
local myAuras = {}
C_UnitAuras = {
  GetAuraDataByIndex = function(_, i) return myAuras[i] end,
  GetPlayerAuraBySpellID = function(id) for _, a in ipairs(myAuras) do if a.spellId == id then return a end end end,
}
C_Container = { GetContainerNumSlots = function() return 0 end, GetContainerItemInfo = function() return nil end }
local playerClass = "MAGE"
function UnitClass() return "Mage", playerClass end
local yes = stub()
local yesDisabled = false
yes.IsVisible = function() return true end
yes.Disable = function() yesDisabled = true end
_G.ReadyCheckFrameYesButton = yes

local CRT = { UI = stub() }
function CRT:Print() end
CRT.db = {
  consumables = { enabled = true, lowMinutes = 10, categoryOrder = {}, itemOrder = {}, extra = {}, learned = {} },
  readycheck = { buffLock = true, include = {}, output = "self", flaskWarn = 0,
    window = { order = {}, columns = { food = true, intellect = true, stamina = true, durability = true } } },
}
local registryEvents
for i, f in ipairs(FILES) do
  if f == "CRT_Data/Bosses/Registry.lua" then
    local real = CreateFrame
    CreateFrame = function() registryEvents = stub() return registryEvents end
    assert(load(src[i], f))("CowfeeRaidTools", CRT)
    CreateFrame = real
  else
    assert(load(src[i], f))("CowfeeRaidTools", CRT)
  end
end
registryEvents.scripts.OnEvent(registryEvents, "ADDON_LOADED", "CowfeeRaidTools")
local B, Consumables, Report, Window, BuffLock = CRT.Bosses, CRT.Consumables, CRT.RaidReport, CRT.ReadyCheckWindow, CRT.BuffLock

-- 1. The accessors
local consumables, cooldowns, buffs = B:Consumables(), B:Cooldowns(), B:RaidBuffs()
check(type(consumables) == "table" and consumables.expansion == "Sample" and type(consumables.categories) == "table", "Bosses:Consumables(): the season's consumables")
check(type(cooldowns) == "table" and #cooldowns == 32 and cooldowns[1].spellID == 740, "Bosses:Cooldowns(): the season's class cooldowns")
check(type(buffs) == "table" and #buffs == 6 and buffs[1].key == "intellect", "Bosses:RaidBuffs(): the season's raid buffs")
check(#(CRT.ConsumablesDB.categories or {}) == 0 and next(CRT.ConsumablesDB.categories or {}) == nil, "Consumables/Database.lua keeps only an empty list")
eq(#Report.BUFFS, 0, "ReadyCheck/Report.lua keeps only an empty list")

local function withSeason(def, topic, fn)
  B.seasons["sample"].current = false
  B:Season(def)
  if topic then B:SeasonData(def.key, "gameIDs", topic) end
  Consumables:Fire()
  fn()
  B.seasons[def.key] = nil
  B.topics[def.key] = nil
  B.seasons["sample"].current = true
  Consumables:Fire()
end

withSeason({ key = "plain", name = "Plain", order = 2, current = true }, nil, function()
  eq(B:Consumables(), nil, "a season without game IDs: no consumables")
  eq(B:Cooldowns(), nil, "nor cooldowns")
  eq(B:RaidBuffs(), nil, "nor raid buffs")
  eq(#Consumables:Entries("flask"), 0, "no consumables: an empty flask list")
  eq(Consumables:Status("flask").state, "unset", "so the flask icon is unset")
  eq(#Report.Buffs(), 0, "no raid buffs to check")
  eq(Report.Buff("intellect"), nil, "and no buff by key")
  local keys = {}
  for i, c in ipairs(Window:OrderedColumns()) do keys[i] = c.key end
  eq(table.concat(keys, ","), "food,flask,weapon,rune,vantus,durability", "the window has no buff columns")
  check(Consumables:CheckText():find("0 entries checked, 0 with problems.", 1, true) ~= nil, "check: nothing to check, no error")
end)
withSeason({ key = "half", name = "Half", order = 3, current = true }, { raidBuffs = { { key = "x", spell = 1, class = "MAGE", label = "X", short = "X" } } }, function()
  eq(B:Consumables(), nil, "a topic with only raid buffs: no consumables")
  eq(B:Cooldowns(), nil, "nor cooldowns")
  check(B:RaidBuffs() and B:RaidBuffs()[1].key == "x", "but its raid buffs")
  check(Window:OrderedColumns()[6].key == "x", "the window follows the season's buffs")
end)
check(Window:OrderedColumns()[6].key == "intellect", "and back to the sample's")

-- 2. Consumables read the season's list
local flasks = Consumables:Entries("flask")
eq(#flasks, 2, "the flask list is the season's")
eq(flasks[1].item, 241324, "in its order")
check(Consumables:FoodBuffIds()[456410] and Consumables:FoodBuffIds()[1233724], "the food buffs are the season's")
eq(Consumables:Database(), consumables, "Consumables:Database() is Bosses:Consumables()")
check(Consumables:BuffIds("rune")[1264426], "the rune's listed buff")
myAuras = { { spellId = 1264426, name = "Void-Touched", expirationTime = 1000 + 1800, icon = 7 } }
eq(Consumables:Status("rune").state, "active", "the rune's buff on you: active")
myAuras = {}

-- 3. /crt consumables check and scan
check(CRT.ConsumablesTools ~= nil, "the tools load")
CRT.ConsumablesTools:Check()
local text = Consumables:CheckText()
check(text:find("Consumables list: Sample, updated 2026-10-24", 1, true) ~= nil, "check names the season's list")
check(text:find("Flask (2 listed)", 1, true) ~= nil and text:find("Augment rune (1 listed)", 1, true) ~= nil, "check counts each category")
check(text:find("ok       Well Fed (456410)", 1, true) ~= nil, "check lists the food buffs")
check(text:find("9 entries checked, 0 with problems.", 1, true) ~= nil, "check: every sample entry is found: " .. (text:match("%d+ entries checked[^\\n]*") or "?"))
C_Item.GetItemInfoInstant = (function(real) return function(id) if id == 241326 then return nil end return real(id) end end)(C_Item.GetItemInfoInstant)
Consumables:Fire()
text = Consumables:CheckText()
check(text:find("PROBLEM  Flask of the Shattered Sun: ITEM ID NOT FOUND", 1, true) ~= nil, "check flags an unknown item")
CRT.ConsumablesTools:Scan()
check(Consumables:ScanText():find("Helpful buffs on you right now", 1, true) ~= nil, "scan still writes its lines")
check(Consumables:ScanText():find("GameIDs.lua", 1, true) ~= nil, "scan says where the lines go")

-- 4. The raid report and the window read the season's raid buffs
eq(#Report.Buffs(), 6, "Report.Buffs() is the season's")
eq(Report.Buff("stamina").spell, 21562, "Report.Buff(key)")
local member = { name = "Pal", class = "PALADIN", auras = { { id = 1459, name = "Spell1459", left = 3000 } } }
eq(Report.Cell(member, "intellect").state, "ok", "a cell finds the season's buff")
eq(Report.Cell(member, "stamina").state, "missing", "and sees it missing")
local keys = {}
for i, c in ipairs(Window:OrderedColumns()) do keys[i] = c.key end
eq(table.concat(keys, ","), "food,flask,weapon,rune,vantus,intellect,stamina,attack,versatility,mastery,movement,durability", "the window's columns: the season's buffs between Vantus and Durability")
check(Window:OrderedColumns()[6].buff == Report.Buff("intellect"), "a buff column carries its buff")
local sample = Window.SampleMembers()
check(sample[1].cells.intellect and sample[1].cells.intellect.icon == 200 + 1459, "the sample players have the buff's icon")
-- the report on a group of one: you, with Arcane Intellect on
function IsInRaid() return false end
function GetNumSubgroupMembers() return 0 end
function UnitIsConnected() return true end
function UnitIsUnit() return true end
function UnitIsVisible() return true end
function GetUnitName() return "Pal" end
function Ambiguate(n) return n end
function UnitGroupRolesAssigned() return "DAMAGER" end
myAuras = { { spellId = 1459, name = "Spell1459", expirationTime = 1000 + 3000 } }
playerClass = "PALADIN"
local lines = Report:Run({ "buffs" })
check(table.concat(lines, "|"):find("Spell21562 missing", 1, true) == nil, "nobody gives Fortitude: not reported")
playerClass = "PRIEST"
lines = Report:Run({ "buffs" })
check(table.concat(lines, "|"):find("Spell21562 missing: Pal", 1, true) ~= nil, "a priest in the group: Fortitude missing is reported: " .. table.concat(lines, "|"))
myAuras = {}
Report.ReadGroup = function() return { member } end

-- 5. The Ready button lock: your class's buff from the season's list
playerClass = "PRIEST"
yesDisabled = false
BuffLock:Check()
check(yesDisabled, "a priest's Fortitude missing on someone: Ready locks")
BuffLock:Unlock()
playerClass = "WARLOCK"
yesDisabled = false
BuffLock:Check()
check(not yesDisabled, "a class with no buff in the list: no lock")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, f), 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
