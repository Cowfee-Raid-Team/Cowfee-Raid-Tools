// CRT_Modules/Groups/Sort.lua: Raid Groups' Sort by methods on a fixed 20-player and 13-player roster (role counts,
// healer spread, class and spec spread, sides placement, the same grid on a second sort); the Left and right sides
// list (only blocks with exactly two rows of players, from the current season's notes); the group changes post (who is
// new per group, groups skipped, nothing when nothing changed, the line format, long lines split under the chat
// limit) and Arrange Groups posting it once, when it is done (CRT_Modules/Groups/Apply.lua).
// Usage: node run_groups_sort.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local frames, timers = {}, {}
function CreateFrame()
  local f = { events = {}, scripts = {} }
  function f:RegisterEvent(ev) self.events[ev] = true end
  function f:UnregisterEvent(ev) self.events[ev] = nil end
  function f:SetScript(k, fn) self.scripts[k] = fn end
  frames[#frames + 1] = f
  return f
end
local combat, encounter = false, false
function InCombatLockdown() return combat end
function IsEncounterInProgress() return encounter end
C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
function GetTime() return 1000 end
function issecretvalue() return false end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
tinsert = table.insert
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function date() return "2026-11-11 12:00" end
function UnitName(u) if u == "player" then return "Solex" end end
GetNormalizedRealmName = function() return "Area52" end
Ambiguate = function(k) return (k:gsub("%-Area52$", "")) end
local CLASSES = { { "Warrior", "WARRIOR" }, { "Paladin", "PALADIN" }, { "Hunter", "HUNTER" }, { "Rogue", "ROGUE" },
  { "Priest", "PRIEST" }, { "Death Knight", "DEATHKNIGHT" }, { "Shaman", "SHAMAN" }, { "Mage", "MAGE" }, { "Warlock", "WARLOCK" },
  { "Monk", "MONK" }, { "Druid", "DRUID" }, { "Demon Hunter", "DEMONHUNTER" }, { "Evoker", "EVOKER" } }
function GetNumClasses() return #CLASSES end
function GetClassInfo(i) local c = CLASSES[i] return c[1], c[2], i end
C_Spell = { GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }

-- the raid, for Sort.Read and Arrange Groups: { name, subgroup, class, role }
local raid = {}
local lead = true
function IsInRaid() return #raid > 0 end
function IsInGroup() return #raid > 0 end
function GetNumGroupMembers() return #raid end
function GetRaidRosterInfo(i) local r = raid[i] if r then return r[1], nil, r[2], nil, nil, r[3] end end
function UnitGroupRolesAssigned(unit) local r = raid[tonumber(unit:match("%d+") or 0)] return r and r[4] or "NONE" end
function UnitIsUnit() return false end
function UnitIsGroupLeader() return lead end
function UnitIsGroupAssistant() return false end
function UnitAffectingCombat() return false end
function SetRaidSubgroup(i, g) raid[i][2] = g end
function SwapRaidSubgroup(i, j) raid[i][2], raid[j][2] = raid[j][2], raid[i][2] end
local sent = {}
C_ChatInfo = { SendChatMessage = function(msg, channel) sent[#sent + 1] = { msg = msg, channel = channel } end }

local CRT = {
  db = { notes = { list = {}, nextId = 1, trustedOnly = true, alert = { enabled = true, seconds = 10 } },
    groups = { presets = {}, nextId = 1, keepChanges = false, source = "raid", working = {}, roles = {}, sortMethod = "roles", postChanges = false },
    classCache = {}, roleCache = {}, specCache = {}, ui = {}, readycheck = {} },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end },
}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
for i = 1, #sources, 2 do
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
end
local Sort, Groups, A, Notes, Bosses = CRT.GroupSort, CRT.Groups, CRT.NoteAssign, CRT.Notes, CRT.Bosses
assert(Sort and Groups and A and Notes and Bosses and CRT.RaidReport and CRT.Apply, "modules exist")

local failed = 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)) failed = failed + 1 end
end

-- Rosters -------------------------------------------------------------------------------------------------------------
-- { key, role, class, spec, place }; the grid's order is the list's order (index), mixed on purpose
local function P(key, role, class, spec, place) return { key = key .. "-Area52", role = role, class = class, spec = spec, place = place } end
local R20 = {
  P("Rmage1", "DAMAGER", "MAGE", 63, "ranged"), P("Tank1", "TANK", "WARRIOR", 73, "melee"), P("Heal1", "HEALER", "PRIEST", 257, "ranged"),
  P("Mrogue1", "DAMAGER", "ROGUE", 259, "melee"), P("Rmage2", "DAMAGER", "MAGE", 63, "ranged"), P("Heal2", "HEALER", "SHAMAN", 264, "ranged"),
  P("Mrogue2", "DAMAGER", "ROGUE", 260, "melee"), P("Rhunt", "DAMAGER", "HUNTER", 253, "ranged"), P("Tank2", "TANK", "PALADIN", 66, "melee"),
  P("Mwar", "DAMAGER", "WARRIOR", 72, "melee"), P("Rlock", "DAMAGER", "WARLOCK", 267, "ranged"), P("Heal3", "HEALER", "DRUID", 105, "ranged"),
  P("Mdk", "DAMAGER", "DEATHKNIGHT", 251, "melee"), P("Rmage3", "DAMAGER", "MAGE", 62, "ranged"), P("Mdh", "DAMAGER", "DEMONHUNTER", 577, "melee"),
  P("Rpriest", "DAMAGER", "PRIEST", 258, "ranged"), P("Heal4", "HEALER", "PALADIN", 65, "melee"), P("Mmonk", "DAMAGER", "MONK", 269, "melee"),
  P("Revo", "DAMAGER", "EVOKER", 1467, "ranged"), P("Rsham", "DAMAGER", "SHAMAN", 262, "ranged"),
}
local R13 = {
  P("Ra", "DAMAGER", "MAGE", 63, "ranged"), P("Tk", "TANK", "DEATHKNIGHT", 250, "melee"), P("Rb", "DAMAGER", "MAGE", 63, "ranged"),
  P("Ha", "HEALER", "PRIEST", 257, "ranged"), P("Ma", "DAMAGER", "ROGUE", 259, "melee"), P("Rc", "DAMAGER", "MAGE", 63, "ranged"),
  P("Rd", "DAMAGER", "MAGE", 62, "ranged"), P("Hb", "HEALER", "SHAMAN", 264, "ranged"), P("Mb", "DAMAGER", "WARRIOR", 72, "melee"),
  P("Re", "DAMAGER", "MAGE", 62, "ranged"), P("Rf", "DAMAGER", "HUNTER", 253, "ranged"), P("Rg", "DAMAGER", "WARLOCK", 265, "ranged"),
  P("Rh", "DAMAGER", "EVOKER", 1467, "ranged"),
}
local function index(list) for i, p in ipairs(list) do p.index = i end return list end
index(R20) index(R13)
local function byKey(list) local m = {} for _, p in ipairs(list) do m[p.key] = p end return m end
-- the players again from a sorted grid, in its slot order, as Sort.Read would give them
local function reread(slots, map)
  local out = {}
  for i = 1, 40 do if slots[i] ~= "" then local p = map[slots[i]] local c = {} for k, v in pairs(p) do c[k] = v end c.index = #out + 1 out[#out + 1] = c end end
  return out
end
local function groupOf(slots) local m = {} for i = 1, 40 do if slots[i] ~= "" then m[slots[i]] = math.ceil(i / 5) end end return m end
local function members(slots, map, g) local out = {} for pos = 1, 5 do local k = slots[(g - 1) * 5 + pos] if k ~= "" then out[#out + 1] = map[k] end end return out end
local function count(list, fn) local n = 0 for _, p in ipairs(list) do if fn(p) then n = n + 1 end end return n end
local function same(a, b) for i = 1, 40 do if a[i] ~= b[i] then return false end end return true end
local function used(slots) local n = 0 for g = 1, 8 do if slots[(g - 1) * 5 + 1] ~= "" then n = g end end return n end
local function total(slots) local n = 0 for i = 1, 40 do if slots[i] ~= "" then n = n + 1 end end return n end
local function names(list) local out = {} for _, p in ipairs(list) do out[#out + 1] = p.key:gsub("%-Area52$", "") end return table.concat(out, ",") end
local function stable(method, roster, opts)
  local map = byKey(roster)
  local first = Sort.Arrange(method, roster, opts)
  local second = Sort.Arrange(method, reread(first, map), opts)
  return same(first, second), first, second
end
local function isHealer(p) return p.role == "HEALER" end
local function isTank(p) return p.role == "TANK" end
local function ranged(p) return p.role == "DAMAGER" and p.place == "ranged" end
local function melee(p) return p.role == "DAMAGER" and p.place == "melee" end

check("the methods, in the dropdown's order, Role blocks the default", function()
  local keys, labels = {}, {}
  for _, m in ipairs(Sort.METHODS) do keys[#keys + 1] = m.key labels[#labels + 1] = m.label end
  assert(table.concat(keys, ",") == "roles,melee,spread,sides", table.concat(keys, ","))
  assert(table.concat(labels, "|") == "Role blocks|Melee and ranged groups|Spread duplicates|Left and right sides", table.concat(labels, "|"))
  assert(Sort.DEFAULT == "roles" and Sort.Valid("spread") and not Sort.Valid("nope"), "default and Valid")
end)

-- Role blocks ---------------------------------------------------------------------------------------------------------
check("role blocks, 20: tanks first, then melee, then ranged, one healer per group, groups 1-4", function()
  local map = byKey(R20)
  local s = Sort.Arrange("roles", R20)
  assert(total(s) == 20 and used(s) == 4, "20 in groups 1-4: " .. used(s))
  for g = 1, 4 do
    local m = members(s, map, g)
    assert(#m == 5 and count(m, isHealer) == 1, "group " .. g .. ": 5 with one healer: " .. names(m))
  end
  local g1, g2, g3, g4 = members(s, map, 1), members(s, map, 2), members(s, map, 3), members(s, map, 4)
  assert(names(g1) == "Tank1,Tank2,Mrogue1,Mrogue2,Heal1", "group 1, tanks then melee in grid order: " .. names(g1))
  assert(names(g2) == "Mwar,Mdk,Mdh,Mmonk,Heal2", "group 2 melee: " .. names(g2))
  assert(count(g3, ranged) == 4 and count(g4, ranged) == 4, "groups 3-4 ranged: " .. names(g3) .. " / " .. names(g4))
  assert(names(g3) == "Rmage1,Rmage2,Rhunt,Rlock,Heal3", "ranged in grid order: " .. names(g3))
end)

check("role blocks, 13: three groups, the healers in groups 1-2, the rest fill from group 1", function()
  local map = byKey(R13)
  local s = Sort.Arrange("roles", R13)
  assert(total(s) == 13 and used(s) == 3, "13 in groups 1-3: " .. used(s))
  assert(names(members(s, map, 1)) == "Tk,Ma,Mb,Ra,Ha", "group 1: " .. names(members(s, map, 1)))
  assert(count(members(s, map, 2), isHealer) == 1 and count(members(s, map, 3), isHealer) == 0, "one healer each in 1 and 2")
  assert(#members(s, map, 2) == 5 and #members(s, map, 3) == 3, "5, 5, 3")
end)

check("role blocks: extra healers fill from the last group back", function()
  local list = {}
  for i = 1, 6 do list[#list + 1] = P("H" .. i, "HEALER", "PRIEST", 257, "ranged") end
  for i = 1, 14 do list[#list + 1] = P("D" .. i, "DAMAGER", "MAGE", 63, "ranged") end
  index(list)
  local map = byKey(list)
  local s = Sort.Arrange("roles", list)
  local per = {}
  for g = 1, 4 do per[g] = count(members(s, map, g), isHealer) end
  assert(table.concat(per, ",") == "1,1,2,2", "healers per group: " .. table.concat(per, ","))
  assert(names(members(s, map, 4)):find("H5,H6", 1, true), "the extras keep the grid's order: " .. names(members(s, map, 4)))
end)

check("role blocks: the same grid on a second sort (20 and 13)", function()
  assert(stable("roles", R20), "20")
  assert(stable("roles", R13), "13")
end)

-- Melee and ranged groups -------------------------------------------------------------------------------------------
check("melee and ranged groups, 20: tanks and melee in 1-2, ranged in 3-4, a healer in each", function()
  local map = byKey(R20)
  local s = Sort.Arrange("melee", R20)
  assert(total(s) == 20 and used(s) == 4, "groups 1-4")
  for g = 1, 2 do local m = members(s, map, g) assert(count(m, ranged) == 0 and count(m, isHealer) == 1, "group " .. g .. ": " .. names(m)) end
  for g = 3, 4 do local m = members(s, map, g) assert(count(m, ranged) == 4 and count(m, isHealer) == 1, "group " .. g .. ": " .. names(m)) end
end)

check("melee and ranged groups, 13: ranged start a new group when they still fit", function()
  local list = index({ P("Tk", "TANK", "WARRIOR", 73, "melee"), P("Ha", "HEALER", "PRIEST", 257, "ranged"), P("Ma", "DAMAGER", "ROGUE", 259, "melee"),
    P("Hb", "HEALER", "DRUID", 105, "ranged"), P("Mb", "DAMAGER", "MONK", 269, "melee"), P("R1", "DAMAGER", "MAGE", 63, "ranged"),
    P("R2", "DAMAGER", "MAGE", 63, "ranged"), P("R3", "DAMAGER", "HUNTER", 253, "ranged"), P("R4", "DAMAGER", "WARLOCK", 267, "ranged"),
    P("R5", "DAMAGER", "EVOKER", 1467, "ranged"), P("R6", "DAMAGER", "PRIEST", 258, "ranged"), P("R7", "DAMAGER", "SHAMAN", 262, "ranged"),
    P("R8", "DAMAGER", "HUNTER", 254, "ranged") })
  local map = byKey(list)
  local roles = Sort.Arrange("roles", list)
  assert(names(members(roles, map, 1)) == "Tk,Ma,Mb,R1,Ha", "role blocks mixes the first ranged in: " .. names(members(roles, map, 1)))
  local s = Sort.Arrange("melee", list)
  assert(names(members(s, map, 1)) == "Tk,Ma,Mb,Ha", "melee group 1 has no ranged: " .. names(members(s, map, 1)))
  assert(names(members(s, map, 2)) == "R1,R2,R3,R4,Hb", "group 2: " .. names(members(s, map, 2)))
  assert(names(members(s, map, 3)) == "R5,R6,R7,R8", "group 3: " .. names(members(s, map, 3)))
  assert(stable("melee", list), "the same on a second sort")
end)

check("melee and ranged groups: mixes when the ranged would not fit, so 20 stay in groups 1-4", function()
  local list = {}
  for i = 1, 9 do list[#list + 1] = P("M" .. i, "DAMAGER", "ROGUE", 259, "melee") end
  for i = 1, 11 do list[#list + 1] = P("R" .. i, "DAMAGER", "MAGE", 63, "ranged") end
  index(list)
  local s = Sort.Arrange("melee", list)
  assert(total(s) == 20 and used(s) == 4, "20 in groups 1-4: " .. used(s))
end)

check("melee and ranged groups, 13: the same grid on a second sort", function()
  assert(stable("melee", R13), "13")
  assert(stable("melee", R20), "20")
end)

-- Spread duplicates -------------------------------------------------------------------------------------------------
check("spread duplicates, 20: no class twice in a group, one tank and one healer per group at most", function()
  local map = byKey(R20)
  local s = Sort.Arrange("spread", R20)
  assert(total(s) == 20 and used(s) == 4, "groups 1-4")
  for g = 1, 4 do
    local m = members(s, map, g)
    assert(#m == 5, "group " .. g .. " has 5: " .. names(m))
    assert(count(m, isTank) <= 1 and count(m, isHealer) == 1, "roles spread in group " .. g .. ": " .. names(m))
    local seen = {}
    for _, p in ipairs(m) do assert(not seen[p.class], "two " .. p.class .. " in group " .. g .. ": " .. names(m)) seen[p.class] = true end
  end
end)

check("spread duplicates, 13: five mages over three groups (2, 2, 1), each spec in different groups", function()
  local map = byKey(R13)
  local s = Sort.Arrange("spread", R13)
  assert(total(s) == 13 and used(s) == 3, "groups 1-3")
  local mages, specs = {}, {}
  for g = 1, 3 do
    local m = members(s, map, g)
    mages[g] = count(m, function(p) return p.class == "MAGE" end)
    for _, p in ipairs(m) do if p.class == "MAGE" then local k = g .. ":" .. p.spec assert(not specs[k], "two mages of spec " .. p.spec .. " in group " .. g) specs[k] = true end end
    assert(#m >= 4, "groups even: " .. #m)
  end
  table.sort(mages)
  assert(table.concat(mages, ",") == "1,2,2", "mages per group: " .. table.concat(mages, ","))
  assert(count(members(s, map, 1), isHealer) + count(members(s, map, 2), isHealer) + count(members(s, map, 3), isHealer) == 2, "healers")
  for g = 1, 3 do assert(count(members(s, map, g), isHealer) <= 1, "no group with both healers") end
end)

check("spread duplicates: the same grid on a second sort (20 and 13)", function()
  assert(stable("spread", R20), "20")
  assert(stable("spread", R13), "13")
end)

-- Left and right sides ----------------------------------------------------------------------------------------------
check("sides, 20: the first row in groups 1-2, the second in 3-4, everyone else after", function()
  local map = byKey(R20)
  local row1 = { "Rmage1-Area52", "Tank1-Area52", "Heal1-Area52", "Mrogue1-Area52", "Rmage2-Area52", "Heal2-Area52" }
  local row2 = { "Tank2-Area52", "Mwar-Area52", "Rlock-Area52", "Heal3-Area52" }
  local s = Sort.Arrange("sides", R20, { rows = { row1, row2 } })
  local at = groupOf(s)
  for _, k in ipairs(row1) do assert(at[k] == 1 or at[k] == 2, k .. " in 1-2: " .. tostring(at[k])) end
  for _, k in ipairs(row2) do assert(at[k] == 3 or at[k] == 4, k .. " in 3-4: " .. tostring(at[k])) end
  assert(total(s) == 20 and used(s) == 4, "20 fit groups 1-4")
  assert(names(members(s, map, 1)) == "Rmage1,Tank1,Heal1,Mrogue1,Rmage2", "group 1 in grid order: " .. names(members(s, map, 1)))
  local ok = stable("sides", R20, { rows = { row1, row2 } })
  assert(ok, "the same on a second sort")
end)

check("sides, 13: rows of three, the rest fill from group 1", function()
  local map = byKey(R13)
  local row1 = { "Ha-Area52", "Ma-Area52", "Re-Area52" }
  local row2 = { "Hb-Area52", "Tk-Area52", "Rh-Area52" }
  local s = Sort.Arrange("sides", R13, { rows = { row1, row2 } })
  local at = groupOf(s)
  for _, k in ipairs(row1) do assert(at[k] == 1 or at[k] == 2, k .. " in 1-2") end
  for _, k in ipairs(row2) do assert(at[k] == 3 or at[k] == 4, k .. " in 3-4") end
  assert(names(members(s, map, 1)) == "Ha,Ma,Re,Ra,Rb", "group 1: the row, then the rest in grid order: " .. names(members(s, map, 1)))
  assert(stable("sides", R13, { rows = { row1, row2 } }), "the same on a second sort")
end)

-- Sort.Read --------------------------------------------------------------------------------------------------------
check("Sort.Read: slot order, the role a slot shows (by hand first), class, spec and melee or ranged", function()
  raid = { { "Solex", 1, "MAGE", "DAMAGER" }, { "Brenn", 1, "WARRIOR", "DAMAGER" }, { "Abu-KelThuzad", 2, "PRIEST", "HEALER" } }
  CRT.db.groups.roles["brenn-area52"] = "TANK"
  CRT.db.classCache["gone-area52"] = "ROGUE"
  CRT.db.roleCache["gone-area52"] = "DAMAGER"
  CRT.db.specCache["solex-area52"] = 63
  CRT.InterruptsPage = { PlaceOf = function(p) if p.role == "TANK" then return "melee" end return p.class == "ROGUE" and "melee" or "ranged" end }
  local grid = {}
  for i = 1, 40 do grid[i] = "" end
  grid[1], grid[3], grid[7], grid[12], grid[13] = "Abu-KelThuzad", "Solex-Area52", "Brenn-Area52", "Gone-Area52", "solex-area52"
  local list = Sort.Read(grid)
  assert(#list == 4, "each player once: " .. #list)
  assert(list[1].key == "Abu-KelThuzad" and list[1].role == "HEALER" and list[1].class == "PRIEST" and list[1].index == 1, "Abu")
  assert(list[2].key == "Solex-Area52" and list[2].spec == 63 and list[2].place == "ranged", "Solex")
  assert(list[3].role == "TANK" and list[3].place == "melee", "Brenn: the role set by hand wins")
  assert(list[4].class == "ROGUE" and list[4].role == "DAMAGER" and list[4].place == "melee", "Gone: from the caches")
  CRT.db.groups.roles = {}
  raid = {}
end)

-- The Left and right sides list ------------------------------------------------------------------------------------
local function blockText(name, rows)
  local b = { name = name, rows = {} }
  for i, r in ipairs(rows) do b.rows[i] = { label = r[1], text = "", tokens = r[2], casts = "all" } end
  return table.concat(A.Lines(b, {}), "\\n")
end
check("sides list: only blocks with exactly two rows of players, as Boss: name, in route order", function()
  Bosses:Register({ encounterID = 3470, name = "Boss One", season = "sample" })
  Bosses:Register({ encounterID = 3420, name = "Boss Two", season = "sample" })
  local one = table.concat({ "EncounterID:3470;Difficulty:Mythic;Name:Boss One",
    blockText("Left Right", { { "Left", { "Solex", "Rixxy" } }, { "Right", { "Abu", "Cheo" } } }),
    "", blockText("Three Soaks", { { "Soak 1", { "Solex" } }, { "Soak 2", { "Abu" } }, { "Soak 3", { "Cheo" } } }),
    "", blockText("Healers Left", { { "Left", { "healer" } }, { "Right", { "Abu" } } }),
    "", blockText("Groups", { { "Left", { "Group1" } }, { "Right", { "Group2" } } }),
    "", blockText("One Empty", { { "Left", { "Solex", "healer" } }, { "Middle", {} }, { "Right", { "Abu" } } }),
  }, "\\n")
  local two = table.concat({ "EncounterID:3420;Difficulty:Mythic;Name:Boss Two",
    blockText("Orbs", { { "Odd", { "Rixxy" } }, { "Even", { "Cheo", "Demon Hunter" } } }) }, "\\n")
  CRT.db.notes.list = { [1] = { raw = two, encounterID = 3420, difficulty = "Mythic", name = "Boss Two" },
    [2] = { raw = one, encounterID = 3470, difficulty = "Mythic", name = "Boss One" },
    [3] = { raw = blockText("Mine", { { "A", { "Solex" } }, { "B", { "Abu" } } }), encounterID = 3470, difficulty = "Mythic", personal = true } }
  local list = Sort.SideBlocks()
  local labels = {}
  for _, b in ipairs(list) do labels[#labels + 1] = b.label end
  assert(table.concat(labels, "|") == "Boss One: Left Right|Boss One: One Empty|Boss Two: Orbs", table.concat(labels, "|"))
  assert(table.concat(list[1].rows[1], ",") == "Solex,Rixxy" and table.concat(list[1].rows[2], ",") == "Abu,Cheo", "the rows' names")
  assert(table.concat(list[2].rows[1], ",") == "Solex", "a role word is left out of a row: " .. table.concat(list[2].rows[1], ","))
  assert(table.concat(list[3].rows[2], ",") == "Cheo", "a class is left out: " .. table.concat(list[3].rows[2], ","))
  -- its rows as the grid's players: by name alone or Name-Realm; names not in the grid left out
  local rows = Sort.SideRows(list[1], { { key = "Solex-Area52" }, { key = "Abu-KelThuzad" }, { key = "Cheo-Area52" } })
  assert(table.concat(rows[1], ",") == "Solex-Area52" and table.concat(rows[2], ",") == "Abu-KelThuzad,Cheo-Area52", "rows: " .. table.concat(rows[1], ",") .. " / " .. table.concat(rows[2], ","))
  CRT.db.notes.list = {}
  assert(#Sort.SideBlocks() == 0, "none without notes")
end)

-- Group changes -----------------------------------------------------------------------------------------------------
check("changes: who is new in each group, groups with no one new skipped, in group order", function()
  local before = { a = 1, b = 1, c = 2, d = 3 }
  local after = { { key = "c", name = "Cee", subgroup = 1 }, { key = "a", name = "Ay", subgroup = 1 }, { key = "b", name = "Bee", subgroup = 4 },
    { key = "d", name = "Dee", subgroup = 3 }, { key = "e", name = "Eee", subgroup = 4 }, { key = "f", name = "Eff", subgroup = 2 } }
  local lines = Sort.ChangeLines(before, after)
  assert(table.concat(lines, "|") == "<Group 1 Changes>: Cee|<Group 2 Changes>: Eff|<Group 4 Changes>: Bee, Eee", table.concat(lines, "|"))
  assert(#Sort.ChangeLines(before, { { key = "a", name = "Ay", subgroup = 1 }, { key = "c", name = "Cee", subgroup = 2 } }) == 0, "nothing changed: no lines")
end)

check("changes: a long line splits under the 255-character chat limit, every name kept", function()
  local before, after, all = {}, {}, {}
  for i = 1, 40 do
    local name = "Averyveryverylongname" .. i
    before["k" .. i] = 2
    after[i] = { key = "k" .. i, name = name, subgroup = 1 }
    all[#all + 1] = name
  end
  local lines = Sort.ChangeLines(before, after)
  assert(#lines > 1, "split: " .. #lines)
  assert(lines[1]:find("^<Group 1 Changes>: ") ~= nil, "starts with the group")
  local joined = table.concat(lines, " ")
  for _, l in ipairs(lines) do assert(#l <= 255, "too long: " .. #l) end
  for _, n in ipairs(all) do assert(joined:find(n .. ",", 1, true) or joined:find(n .. "$"), "kept: " .. n) end
end)

-- Arrange Groups posts once, when it is done --------------------------------------------------------------------------
local applyFrame
for _, f in ipairs(frames) do if f.events.GROUP_ROSTER_UPDATE and f.events.PLAYER_REGEN_DISABLED then applyFrame = f end end
local function arrange(slots)
  sent = {}
  CRT.Apply:Start(slots) -- the first move, or done
  -- each move: the roster reports back, then the queued timers run (the stall check, then the next step)
  for _ = 1, 200 do
    if CRT.Apply:CanRun() then break end
    applyFrame.scripts.OnEvent(applyFrame, "GROUP_ROSTER_UPDATE")
    local list = timers
    timers = {}
    for _, fn in ipairs(list) do fn() end
  end
  timers = {}
end
local function grid(list) local s = {} for i = 1, 40 do s[i] = list[i] or "" end return s end
local function sixRaid()
  raid = { { "Aa", 1, "MAGE", "DAMAGER" }, { "Bb", 1, "MAGE", "DAMAGER" }, { "Cc", 2, "MAGE", "DAMAGER" }, { "Dd", 2, "MAGE", "DAMAGER" },
    { "Ee-Other", 3, "MAGE", "DAMAGER" }, { "Ff", 3, "MAGE", "DAMAGER" } }
end
-- Aa stays in 1, Cc joins 1; Bb and Ee go to 2; Dd and Ff go to 4
local TARGET = grid({ "Aa-Area52", "Cc-Area52", "", "", "", "Bb-Area52", "Ee-Other", "", "", "", "", "", "", "", "", "Dd-Area52", "Ff-Area52" })

check("arrange, post off: moves everyone, posts nothing", function()
  sixRaid()
  CRT.db.groups.postChanges = false
  arrange(TARGET)
  assert(raid[3][2] == 1 and raid[2][2] == 2 and raid[5][2] == 2 and raid[4][2] == 4 and raid[6][2] == 4, "moved")
  assert(#sent == 0, "nothing posted: " .. #sent)
end)

check("arrange, post on: one post when every move is done, a line per changed group", function()
  sixRaid()
  CRT.db.groups.postChanges = true
  local postedEarly = false
  local realSet = SetRaidSubgroup
  SetRaidSubgroup = function(i, g) if #sent > 0 then postedEarly = true end realSet(i, g) end
  arrange(TARGET)
  SetRaidSubgroup = realSet
  assert(not postedEarly, "nothing posted before the last move")
  local msgs = {}
  for _, m in ipairs(sent) do msgs[#msgs + 1] = m.msg assert(m.channel == "RAID", "to raid chat: " .. tostring(m.channel)) end
  assert(table.concat(msgs, "|") == "<Group 1 Changes>: Cc|<Group 2 Changes>: Bb, Ee-Other|<Group 4 Changes>: Dd, Ff", table.concat(msgs, "|"))
end)

check("arrange, post on, nobody moves: nothing posted", function()
  sixRaid()
  CRT.db.groups.postChanges = true
  arrange(grid({ "Aa-Area52", "Bb-Area52", "", "", "", "Cc-Area52", "Dd-Area52", "", "", "", "Ee-Other", "Ff-Area52" }))
  assert(#sent == 0, "nothing posted: " .. #sent)
end)

check("arrange, post on, during a boss encounter: nothing posted", function()
  sixRaid()
  CRT.db.groups.postChanges = true
  encounter = true
  arrange(TARGET)
  encounter = false
  assert(raid[3][2] == 1, "still moved")
  assert(#sent == 0, "nothing posted: " .. #sent)
end)

check("arrange, post on, combat starts: stopped, nothing posted", function()
  sixRaid()
  CRT.db.groups.postChanges = true
  sent = {}
  CRT.Apply:Start(TARGET)
  applyFrame.scripts.OnEvent(applyFrame, "PLAYER_REGEN_DISABLED")
  timers = {}
  assert(#sent == 0, "nothing posted: " .. #sent)
  CRT.db.groups.postChanges = false
end)

check("no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)
print(failed == 0 and "all passed" or (failed .. " failed"))
if failed > 0 then error(failed .. " failed") end
`;
const W = process.argv[2];
if (!W) { console.error('usage: node run_groups_sort.js <addon folder>'); process.exit(2); }
const names = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua',
  'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/EditModel.lua',
  'CRT_Modules/Notes/Links.lua', 'CRT_Modules/Notes/MechNote.lua', 'CRT_Modules/Notes/Assign.lua',
  'CRT_Modules/Groups/Data.lua', 'CRT_Modules/Groups/Sort.lua', 'CRT_Modules/Groups/Apply.lua', 'CRT_Modules/ReadyCheck/Report.lua'];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, names.length * 2 + 2);
for (const n of names) { lua.lua_pushstring(L, to_luastring(n)); lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, n), 'utf8'))); }
if (lua.lua_pcall(L, names.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
