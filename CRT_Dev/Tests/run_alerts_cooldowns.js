// CRT_Modules/Alerts/Cooldowns.lua: the built-in healer cooldowns and raid defensives the Timeline's Cooldowns row lists.
// Usage: node run_alerts_cooldowns.js CRT_Modules/Alerts/CooldownData.lua CRT_Modules/Alerts/Cooldowns.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local dataSrc, cdSrc = ...
local SECRET = setmetatable({}, { __tostring = function() return "secret" end })
function issecretvalue(v) return v == SECRET end
-- the game: unknown IDs give nil; 47536 (Rapture) is gone; 98008's name is secret; 108280's icon is secret
local gone = { [47536] = true }
C_Spell = {
  GetSpellName = function(id)
    if gone[id] or id == 999 then return nil end
    if id == 98008 then return SECRET end
    return "Spell" .. id
  end,
  GetSpellTexture = function(id)
    if gone[id] then return nil end
    if id == 108280 then return SECRET end
    return 1000 + id
  end,
}
local class = { "Shaman", "SHAMAN" }
function UnitClass(unit) assert(unit == "player") return class[1], class[2] end
LOCALIZED_CLASS_NAMES_MALE = { SHAMAN = "Shaman", PRIEST = "Priest", DRUID = "Druid", MONK = "Monk", PALADIN = "Paladin",
  EVOKER = "Evoker", WARRIOR = "Warrior", DEMONHUNTER = "Demon Hunter", DEATHKNIGHT = "Death Knight" }
local CRT = { db = { alerts = { cooldownFilter = "mine" } },
  Timeline = { readable = function(v) return not issecretvalue(v) end } }
-- the season data loads first, as in the .toc
assert(load(dataSrc, "CRT_Modules/Alerts/CooldownData.lua"))("CowfeeRaidTools", CRT)
assert(type(CRT.AlertCooldownData) == "table" and #CRT.AlertCooldownData == 33, "the data file holds the list")
assert(load(cdSrc, "CRT_Modules/Alerts/Cooldowns.lua"))("CowfeeRaidTools", CRT)
local C = assert(CRT.AlertCooldowns, "CRT.AlertCooldowns")
local function ids(list) local out = {} for i, e in ipairs(list) do out[i] = e.spellID end return table.concat(out, ",") end
local function find(list, id) for _, e in ipairs(list) do if e.spellID == id then return e end end end

do
  -- the shaman: Healing Tide Totem (icon secret: none), Spirit Link Totem left out (secret name), Ascendance
  local list = C:List("mine")
  assert(ids(list) == "108280,114052", "mine as a shaman: " .. ids(list))
  local htt = list[1]
  assert(htt.name == "Spell108280" and htt.class == "SHAMAN" and htt.kind == "healer" and htt.icon == nil, "secret icon: none")
  assert(list[2].icon == 1000 + 114052, "an icon")
  assert(ids(C:List()) == ids(list), "nil is mine")
  -- Rapture is gone from the game: the priest list skips it
  local priest = C:List("PRIEST")
  assert(not find(priest, 47536) and find(priest, 64843) and #priest == 7, "unknown spell skipped: " .. ids(priest))
  -- everything known, in list order
  local all = C:List("all")
  assert(#all == #C.LIST - 2, "all, less the two the game won't name: " .. #all)
  assert(all[1].spellID == 740 and all[#all].spellID == 106898, "list order")
  local raid = C:List("raid")
  assert(ids(raid) == "374227,97462,196718,51052,106898", "raid defensives: " .. ids(raid))
  for _, e in ipairs(C:List("healer")) do assert(e.kind == "healer", "healer only") end
  -- no C_Spell at all: nothing listed, no error
  local real = C_Spell
  C_Spell = nil
  assert(#C:List("all") == 0, "no API: empty")
  C_Spell = real
end
print("ok cooldowns: list skips unknown spells")

do
  -- a class with no entries, an unknown class and a secret class: the healer cooldowns
  local healers = ids(C:List("healer"))
  class = { "Warlock", "WARLOCK" }
  assert(ids(C:List("mine")) == healers and C.Resolve("mine") == "healer", "no entries: healers")
  class = { nil, nil }
  assert(ids(C:List("mine")) == healers, "unknown class: healers")
  class = { SECRET, SECRET }
  assert(ids(C:List("mine")) == healers, "secret class: healers")
  local realUC = UnitClass
  UnitClass = nil
  assert(ids(C:List("mine")) == healers, "no UnitClass: healers")
  UnitClass = realUC
  -- a warrior has one: Rallying Cry
  class = { "Warrior", "WARRIOR" }
  assert(ids(C:List("mine")) == "97462", "warrior: " .. ids(C:List("mine")))
  class = { "Shaman", "SHAMAN" }
end
print("ok cooldowns: mine falls back to healers")

do
  local f = C:Filters()
  local keys, labels = {}, {}
  for i, o in ipairs(f) do keys[i], labels[i] = o.key, o.label end
  assert(table.concat(keys, ",", 1, 4) == "mine,all,healer,raid", "the four first: " .. table.concat(keys, ","))
  assert(table.concat(labels, "|", 1, 4) == "Your class|All|Healer cooldowns|Raid defensives", table.concat(labels, "|"))
  assert(table.concat(labels, "|", 5) == "Death Knight|Demon Hunter|Druid|Evoker|Monk|Paladin|Priest|Shaman|Warrior",
    "classes with entries by name: " .. table.concat(labels, "|", 5))
  -- no localized names: the token
  local realN = LOCALIZED_CLASS_NAMES_MALE
  LOCALIZED_CLASS_NAMES_MALE = nil
  f = C:Filters()
  assert(f[5].label == "DEATHKNIGHT", "token without names: " .. tostring(f[5].label))
  LOCALIZED_CLASS_NAMES_MALE = realN
  -- the stored filter
  assert(C:Filter() == "mine", "default mine")
  C:SetFilter("raid")
  assert(CRT.db.alerts.cooldownFilter == "raid" and C:Filter() == "raid", "stored")
  CRT.db.alerts.cooldownFilter = nil
  assert(C:Filter() == "mine", "missing: mine")
end
print("ok cooldowns: filters")

do
  assert(C.LIST == CRT.AlertCooldownData, "Cooldowns reads the data file's list")
  class = { "Shaman", "SHAMAN" }
  -- stored values the list no longer knows: your class
  for _, stale in ipairs({ "WARLOCK", "HUNTER", "tank", "Mine", 5, true, "" }) do
    CRT.db.alerts.cooldownFilter = stale
    assert(C:Filter() == "mine", "stale " .. tostring(stale) .. ": " .. tostring(C:Filter()))
  end
  CRT.db.alerts.cooldownFilter = "WARLOCK"
  assert(ids(C:List(C:Filter())) == "108280,114052", "a stale filter lists your class")
  -- every real choice is kept
  for _, ok in ipairs({ "mine", "all", "healer", "raid", "PRIEST", "DEATHKNIGHT" }) do
    CRT.db.alerts.cooldownFilter = ok
    assert(C:Filter() == ok, "kept: " .. ok)
  end
  CRT.db.alerts.cooldownFilter = "mine"
end
print("ok cooldowns: a stale filter falls back to your class")

do
  -- every entry carries its length in seconds
  for _, e in ipairs(CRT.AlertCooldownData) do
    assert(type(e.cd) == "number" and e.cd > 0, "cd for " .. e.spellID)
  end
  local function cdOf(id) for _, e in ipairs(CRT.AlertCooldownData) do if e.spellID == id then return e.cd end end end
  assert(cdOf(740) == 180 and cdOf(265202) == 720 and cdOf(196718) == 300 and cdOf(363534) == 240 and cdOf(375576) == 60, "values")
  assert(type(C.Length) == "function", "Cooldowns:Length")
  -- the game: base cooldown in milliseconds; 0 for none; secret; errors
  local base = { [12345] = 45000, [222] = 0, [333] = SECRET }
  GetSpellBaseCooldown = function(id)
    if id == 444 then error("bad id") end
    return base[id]
  end
  -- the built-in list first, even when the game says otherwise
  base[740] = 999000
  assert(C:Length(740) == 180, "list first: " .. tostring(C:Length(740)))
  assert(C:Length(12345) == 45, "from the game: " .. tostring(C:Length(12345)))
  assert(C:Length(222) == nil, "zero: none")
  assert(C:Length(333) == nil, "secret: none")
  assert(C:Length(444) == nil, "error: none")
  assert(C:Length(555) == nil, "unknown: none")
  assert(C:Length(nil) == nil and C:Length("x") == nil, "no id: none")
  GetSpellBaseCooldown = nil
  C:ResetLengths() -- the game's answers are kept; asked afresh only after a reset
  assert(C:Length(12345) == nil and C:Length(740) == 180, "no API: list only")
end
print("ok bands: cooldown length from the list, then the game, else none")

do
  -- each spell is asked of the game once, a nil answer too, until the lengths are reset
  local C = CRT.AlertCooldowns
  C:ResetLengths()
  local asked = 0
  GetSpellBaseCooldown = function(id) asked = asked + 1 if id == 12345 then return 45000 end return 0 end
  for _ = 1, 5 do assert(C:Length(12345) == 45 and C:Length(222) == nil and C:Length(740) == 180, "same answers") end
  assert(asked == 2, "asked once per spell: " .. asked)
  C:ResetLengths()
  assert(C:Length(12345) == 45 and asked == 3, "asked again after a reset")
  GetSpellBaseCooldown = nil
  C:ResetLengths()
end
print("ok bands: cooldown lengths are remembered per spell")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
