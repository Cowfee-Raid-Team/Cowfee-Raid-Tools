// A lint of the shipped season packs' special alerts (CRT_Data/Seasons/<pack>/, the boss files' special lists), so a
// season file can't ship broken data. Every pack's files load in their Season.xml order, Bosses:Register wrapped to
// note each boss and its file; then each special entry must read (Alerts/Special.lua's Special.Read), its key must
// be its own, its type an ability type (Timeline/Reference.lua TYPES), and a when.row must name a row of every
// ability timeline the entry follows (each of the boss's references, parsed with the Timeline's reader, or only
// those of its difficulty group) with at least one cast there (Special:Times, the reminders' placement). An entry
// on a spell (when.spellID) is only read: its row comes from the Journal, which the harness has no data for.
// Usage: node run_season_special.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = String.raw`
local nModules = ...
local args = { select(2, ...) }
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
function GetTime() return 100 end
function issecretvalue() return false end
function geterrorhandler() return function() end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
function date() return "2026-10-25 12:00" end
function time() return 1000000 end
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end }
function UnitName(u) if u == "player" then return "Tester" end end
function UnitGroupRolesAssigned() return "DAMAGER" end
function UnitClass(u) if u == "player" then return "Mage", "MAGE", 8 end end
function IsInRaid() return false end
function GetNumGroupMembers() return 0 end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic", [14] = "Normal" })[id] end
local CRT = {
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    notes = { list = {}, nextId = 1, trustedOnly = true, alert = { enabled = true } },
    alerts = { bars = {}, reminders = {}, phases = {}, overrides = {}, nextId = 1, special = {} },
  },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end, pages = {} },
  PlaySound = function() return 1 end,
}
function CRT:Print() end
CRT.TimelineJournal = { Rows = function() return {} end, IsHidden = function() return false end }
for i = 1, nModules do
  local name, src = args[2 * i - 1], args[2 * i]
  assert(load(src, name))("CowfeeRaidTools", CRT)
end
local B, S, Ref = CRT.Bosses, CRT.AlertSpecial, CRT.TimelineReference
assert(B and S and Ref, "the registry, Special.lua and Reference.lua loaded")

local passes, fails = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("PASS " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- Every boss a pack registers, with the file it came from (the stub over Bosses:Register).
local registered, current = {}, nil
local realRegister = B.Register
B.Register = function(self, def)
  registered[#registered + 1] = { def = def, file = current }
  return realRegister(self, def)
end

local function trim(s) return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end

-- The problems of one boss's special list, as lines ("<key>: why"); {} when it is clean.
local function lint(def)
  local out = {}
  local function bad(key, why) out[#out + 1] = tostring(key) .. ": " .. why end
  if def.special == nil then return out end
  if type(def.special) ~= "table" then bad("special", "must be a list") return out end
  local refs = {}
  for i, text in ipairs(type(def.references) == "table" and def.references or {}) do
    local ref, errs = Ref.Parse(text)
    if ref then
      refs[#refs + 1] = ref
    else
      bad("reference " .. i, "doesn't read (" .. tostring(type(errs) == "table" and errs[1] or errs) .. ")")
    end
  end
  local seen = {}
  for i, raw in ipairs(def.special) do
    local name = type(raw) == "table" and raw.key or ("#" .. i)
    local entry, why = S.Read(raw)
    if not entry then
      bad(name, "doesn't read (" .. tostring(why) .. ")")
    elseif seen[entry.key] then
      bad(name, "a second entry with this key")
    else
      seen[entry.key] = true
      if entry.type and not Ref.TYPES[entry.type] then
        bad(name, "type " .. entry.type .. " is not an ability type")
      end
      if entry.when.row then
        local follows = 0
        for _, ref in ipairs(refs) do
          local group = Ref.Group(ref)
          if entry.difficulty == nil or entry.difficulty == group then
            follows = follows + 1
            local found
            for _, row in ipairs(ref.rows or {}) do
              if type(row.name) == "string" and trim(row.name):lower() == entry.when.row:lower() then found = row break end
            end
            local where = "the " .. tostring(ref.difficulty or "untitled") .. " ability timeline"
            if not found then
              bad(name, "row " .. entry.when.row .. " is not on " .. where)
            elseif #S:Times(def.encounterID, entry, group, ref) == 0 then
              bad(name, "row " .. entry.when.row .. " has no casts on " .. where)
            end
          end
        end
        if follows == 0 then
          bad(name, "row " .. entry.when.row .. " but no ability timeline for " .. tostring(entry.difficulty or "any difficulty"))
        end
      end
    end
  end
  return out
end

-- The lint itself finds each kind of mistake (a made-up boss, never registered).
local probe = lint({ encounterID = 1, name = "Probe", season = "x",
  references = { "Boss: Probe\nDifficulty: Mythic\nLength: 3:00\nOrb Burst: 0:30, 1:30" },
  special = {
    { key = "good", label = "Good", when = { row = "orb burst" }, type = "soak" },
    { key = "typed", label = "Typed", when = { times = "P1 -0:15" } },
    { key = "missing", label = "Missing", when = { row = "Orb Bursts" } },
    { key = "unread", label = "Unread", when = { times = "soon" } },
    { key = "good", label = "Again", when = { times = "0:10" } },
    { key = "badtype", label = "Bad type", when = { times = "0:10" }, type = "tankbuster" },
    { key = "heroic", label = "Heroic only", when = { row = "Orb Burst" }, difficulty = "nh" },
  } })
local said = table.concat(probe, "\n")
check(#probe == 5, "the lint finds the five broken entries of its probe, and only those: " .. said)
check(said:find("missing: row Orb Bursts is not on the Mythic ability timeline", 1, true) ~= nil, "a row the reference doesn't have")
check(said:find("unread: doesn't read", 1, true) ~= nil, "an entry Special.Read skips")
check(said:find("good: a second entry", 1, true) ~= nil, "a key used twice")
check(said:find("badtype: type tankbuster", 1, true) ~= nil, "a type that isn't an ability type")
check(said:find("heroic: row Orb Burst but no ability timeline for nh", 1, true) ~= nil, "a row with no ability timeline of its group")

-- The shipped packs.
local packs, packFiles, i = {}, {}, 2 * nModules + 1
while args[i] do
  local pack, src = args[i]:match("^([^/]+)/"), args[i + 1]
  if not packFiles[pack] then packs[#packs + 1] = pack packFiles[pack] = 0 end
  current = args[i]
  local fn, err = load(src, args[i])
  local ok, runErr = false, err
  if fn then ok, runErr = pcall(fn, "CowfeeRaidTools", CRT) end
  check(ok, "loads: CRT_Data/Seasons/" .. args[i] .. (ok and "" or (" (" .. tostring(runErr) .. ")")))
  packFiles[pack] = packFiles[pack] + 1
  i = i + 2
end
check(#packs > 0, "found the season packs: " .. table.concat(packs, ", "))
local entries = 0
for _, r in ipairs(registered) do
  local problems = lint(r.def)
  local n = type(r.def.special) == "table" and #r.def.special or 0
  entries = entries + n
  check(#problems == 0, r.def.name .. " (" .. tostring(r.file) .. "): " .. n .. " special alerts"
    .. (#problems == 0 and "" or (": " .. table.concat(problems, "; "))))
end
check(entries > 0, "the packs ship special alerts to check (" .. entries .. ")")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error("season special alerts: " .. fails .. " failed") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
const modules = ['CRT_Modules/Timeline/Data.lua', 'CRT_Modules/Timeline/Database.lua', 'CRT_Modules/Timeline/Reference.lua',
  'CRT_Modules/Timeline/Lanes.lua', 'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua',
  'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/Engine.lua', 'CRT_Modules/Alerts/Reminders.lua',
  'CRT_Data/Bosses/Registry.lua', 'CRT_Modules/Alerts/Special.lua'];
// Each pack's files in the order its Season.xml lists them, as "<pack>/<file>".
const seasons = path.join(dir, 'CRT_Data/Seasons');
const packFiles = [];
for (const pack of fs.readdirSync(seasons).sort()) {
  const xml = path.join(seasons, pack, 'Season.xml');
  if (!fs.existsSync(xml)) continue;
  for (const m of fs.readFileSync(xml, 'utf8').matchAll(/<Script\s+file="([^"]+)"\s*\/>/g))
    packFiles.push(pack + '/' + m[1].replace(/\\/g, '/'));
}
// every file is two arguments, more than the stack's default room
if (!lua.lua_checkstack(L, 2 * (modules.length + packFiles.length) + 2)) { console.error('LUA ERROR: no stack room'); process.exit(1); }
lua.lua_pushinteger(L, modules.length);
for (const f of modules) {
  lua.lua_pushstring(L, to_luastring(f));
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
}
for (const f of packFiles) {
  lua.lua_pushstring(L, to_luastring(f));
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(seasons, f), 'utf8')));
}
if (lua.lua_pcall(L, 1 + 2 * (modules.length + packFiles.length), 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
