// Timeline/Data.lua store: saving, pruning, queries, death filter, profile reset.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local src = ...
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
C_Timer = { After = function() end }
function issecretvalue() return false end
local function defaults()
  return { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3,
    overlayOn = false, hideEmpty = false, nextId = 1 }
end
local CRT = { db = { timeline = defaults() } }
assert(load(src, "Timeline/Data.lua"))("CowfeeRaidTools", CRT)
local T = CRT.Timeline
local fired = 0
T:OnChange(function() fired = fired + 1 end)
for i = 1, 12 do T:SavePull({ encounterID = 3001, name = "Boss", difficultyID = 16, startedAt = i, length = 100, kill = false, casts = {}, deaths = { { t = i } } }) end
T:SavePull({ encounterID = 3002, name = "Alpha", difficultyID = 16, startedAt = 1, length = 100, kill = true, casts = {}, deaths = {} })
assert(#T:Pulls(3001) == 10 and T:Pulls(3001)[1].id == 12 and T:Pulls(3001)[10].id == 3 and #T:Pulls(3002) == 1, "store: keeps 10 per boss")
print("ok store: keeps 10 per boss")
local b = T:Bosses()
assert(b[1].name == "Alpha" and b[1].count == 1 and b[2].name == "Boss" and b[2].count == 10, "store: bosses sorted")
print("ok store: bosses sorted")
assert(T:Pull(3001, 12).id == 12 and T:Pull(3001, 1) == nil and #T:Pulls(9999) == 0, "store: pull lookup")
print("ok store: pull lookup")
local rd = T:RecentDeaths(3001, 3)
assert(#rd == 3 and rd[1].pull.id == 12 and rd[2].pull.id == 11 and rd[3].pull.id == 10 and rd[1].deaths[1].t == 12, "recent deaths: newest first, capped")
print("ok recent deaths: newest first, capped")
rd = T:RecentDeaths(3001, 3, 11)
assert(#rd == 3 and rd[1].pull.id == 11 and rd[2].pull.id == 10 and rd[3].pull.id == 9, "recent deaths: from a given pull")
print("ok recent deaths: from a given pull")
assert(T.DifficultyGroup(16) == "mythic" and T.DifficultyGroup(14) == "nh" and T.DifficultyGroup(15) == "nh" and T.DifficultyGroup(17) == "nh" and T.DifficultyGroup(nil) == "nh", "difficulty group")
print("ok difficulty group")
local order = { 16, 16, 15, 16, 16, 16, 16, 15, 16, 16, 16, 16, 15, 16, 16 }
local ids = {}
for i, d in ipairs(order) do ids[i] = T:SavePull({ encounterID = 3010, name = "Mixed", difficultyID = d, startedAt = i, length = 100, kill = false, casts = {}, deaths = { { t = i } } }) end
assert(#T:Pulls(3010, "mythic") == 10 and #T:Pulls(3010, "nh") == 3 and #T:Pulls(3010) == 13, "keep 10 per group")
print("ok keep 10 per group")
local m = T:Pulls(3010, "mythic")
assert(m[1].id == ids[15] and m[10].id == ids[4] and T:Pulls(3010, "nh")[1].id == ids[13], "keep 10 per group")
local rm = T:RecentDeaths(3010, 3, ids[15], "mythic")
assert(#rm == 3 and rm[1].pull.id == ids[15] and rm[2].pull.id == ids[14] and rm[3].pull.id == ids[12] and rm[3].deaths[1].t == 12, "recent deaths stay in group")
rm = T:RecentDeaths(3010, 2, nil, "nh")
assert(#rm == 2 and rm[1].pull.id == ids[13] and rm[2].pull.id == ids[8], "recent deaths stay in group")
print("ok recent deaths stay in group")
local rx = T:RecentDeaths(3010, 5, ids[15], "nh")
assert(#rx == 3 and rx[1].pull.id == ids[13] and rx[2].pull.id == ids[8] and rx[3].pull.id == ids[3], "recent deaths from a pull of the other group: only the asked group")
for _, e in ipairs(rx) do assert(e.pull.difficultyID == 15, "recent deaths from a pull of the other group: no Mythic pull") end
print("ok recent deaths from a pull of the other group")
local legacy = T:SavePull({ encounterID = 3020, name = "Old", startedAt = 1, length = 100, kill = false, casts = {}, deaths = {} })
assert(#T:Pulls(3020, "nh") == 1 and T:Pulls(3020, "nh")[1].id == legacy and #T:Pulls(3020, "mythic") == 0, "pull with no difficultyID is grouped as nh")
print("ok pull with no difficultyID is grouped as nh")
local nhBosses, nhAlpha = T:Bosses("nh")
for _, bo in ipairs(nhBosses) do if bo.name == "Alpha" then nhAlpha = bo end end
assert(nhAlpha and nhAlpha.count == 0, "boss with pulls only in the other group")
for _, bo in ipairs(T:Bosses("mythic")) do if bo.name == "Mixed" then assert(bo.count == 10, "boss with pulls only in the other group") end end
for _, bo in ipairs(T:Bosses()) do if bo.name == "Mixed" then assert(bo.count == 13, "boss with pulls only in the other group") end end
print("ok boss with pulls only in the other group")
local f = T.FilterDeaths({ { t = 50, role = "HEALER" }, { t = 20, role = "TANK" }, { t = 30, role = "DAMAGER" }, { role = "DAMAGER" } },
  { roles = { TANK = false, HEALER = true, DAMAGER = true }, firstDeaths = 2 })
assert(#f == 2 and f[1].t == 30 and f[2].t == 50, "filter: roles and first N")
local g = T.FilterDeaths({ { t = 5, role = "NONE" }, { role = "HEALER" }, { t = 1, role = "HEALER" } }, { roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0 })
assert(#g == 3 and g[1].t == 1 and g[2].t == 5 and g[3].t == nil, "filter: no t goes last, NONE kept")
local h = T.FilterDeaths({ { t = 5, role = "NONE" }, { t = 6, role = "TANK" } }, { roles = { TANK = false, HEALER = true, DAMAGER = true }, firstDeaths = 0 })
assert(#h == 1 and h[1].role == "NONE", "filter: NONE always kept")
print("ok filter: roles and first N")
local before = fired
T:DeleteBoss(3001)
assert(#T:Pulls(3001) == 0 and fired > before, "store: delete boss")
print("ok store: delete boss")
T:Set("span", 120)
assert(T:Settings().span == 120 and fired > before + 1, "settings: Set fires")
print("ok settings: Set fires")
CRT.db = { timeline = defaults() }
assert(next(T:Settings().bosses) == nil and #T:Pulls(3001) == 0, "profile reset gives a fresh timeline table")
print("ok profile reset gives a fresh timeline table")
do
  -- hidden abilities: shipped in the boss file, changed on a developer's computer, gone from the lanes
  CRT.Bosses = { Get = function(_, id) if id == 4001 then return { name = "Turtle", hidden = { "Disgusting Fish" } } end end }
  assert(T.DevMode() == false, "dev mode: off with no Development page")
  CRT.UI = { pages = { dev = { hidden = true } } }
  assert(T.DevMode() == false, "dev mode: off while the Development page is closed")
  CRT.UI.pages.dev.hidden = false
  assert(T.DevMode() == true, "dev mode: on with /crt dev open")
  CRT.UI = nil
  assert(T:Hidden(4001, "disgusting fish") and not T:Hidden(4001, "Shell Spin") and not T:Hidden(4002, "Disgusting Fish"), "hidden: the boss file's list, by name in any case, per boss")
  local lanes = { { kind = "reference", label = "Disgusting Fish" }, { kind = "spell", label = "Shell Spin", spellID = 1 },
    { kind = "deaths", label = "Disgusting Fish" }, { kind = "reference", label = "My fish", baseLabel = "Disgusting Fish" } }
  local shown = T:WithoutHidden(lanes, 4001)
  assert(#shown == 2 and shown[1].label == "Shell Spin" and shown[2].kind == "deaths", "hidden: left out of the lanes, renamed or not; deaths never")
  local before = fired
  T:SetHidden(4001, "Shell Spin", true)
  assert(T:Hidden(4001, "Shell Spin") and fired > before and CRT.db.dev.hiddenAbilities["4001"]["shell spin"] == "Shell Spin", "hidden: set on this computer")
  T:SetHidden(4001, "Disgusting Fish", false)
  assert(not T:Hidden(4001, "Disgusting Fish") and CRT.db.dev.hiddenAbilities["4001"]["disgusting fish"] == false, "hidden: a shipped one shown again")
  local names = T:HiddenNames(4001)
  assert(#names == 1 and names[1] == "Shell Spin", "hidden: the list to ship drops the shown one and adds the new one")
  T:SetHidden(4001, "Disgusting Fish", true)
  T:SetHidden(4001, "Shell Spin", false)
  assert(CRT.db.dev.hiddenAbilities["4001"] == nil and T:Hidden(4001, "Disgusting Fish"), "hidden: back to shipped keeps nothing")
  names = T:HiddenNames(4001)
  assert(#names == 1 and names[1] == "Disgusting Fish", "hidden: the shipped list again")
  CRT.Bosses = nil
  assert(not T:Hidden(4001, "Disgusting Fish") and #T:WithoutHidden(lanes, 4001) == 4, "hidden: nothing without the boss library")
end
print("ok hidden abilities: shipped, set in dev, left out of the lanes")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
let src; try { src = fs.readFileSync(process.argv[2], 'utf8'); } catch (e) { console.error('cannot read ' + process.argv[2]); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
