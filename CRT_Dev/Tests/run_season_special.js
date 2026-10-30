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
              bad(name, "row " .. entry.when.row .. " is not on " .. where .. ' (or give the entry difficulty = "mythic" or "nh")')
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
check(said:find('missing: row Orb Bursts is not on the Mythic ability timeline (or give the entry difficulty = "mythic" or "nh")', 1, true) ~= nil,
  "a row the reference doesn't have, and how to fix it")
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
for _, r in ipairs(registered) do
  local problems = lint(r.def)
  local n = type(r.def.special) == "table" and #r.def.special or 0
  check(#problems == 0, r.def.name .. " (" .. tostring(r.file) .. "): " .. n .. " special alerts"
    .. (#problems == 0 and "" or (": " .. table.concat(problems, "; "))))
end
-- the files did register bosses (a pack with no special alerts yet is fine: the probe above shows the lint works)
check(#registered > 0, "the packs register bosses to check (" .. #registered .. ")")

-- The Coiled Altar (Alex, 2026-10-27): a Heroic ability timeline beside the Mythic one, every special alert on both,
-- each difficulty reading its own times, and the Shield a shield bar on boss2.
local altar
for _, r in ipairs(registered) do if r.def.encounterID == 3429 then altar = r.def end end
check(altar ~= nil, "The Coiled Altar is registered")
if altar then
  local byGroup, heroic = {}, nil
  for _, text in ipairs(altar.references or {}) do
    local ref = Ref.Parse(text)
    if ref then byGroup[Ref.Group(ref)] = ref if ref.difficulty == "Heroic" then heroic = ref end end
  end
  check(#altar.references == 2 and byGroup.mythic and byGroup.nh, "two ability timelines, Mythic and Normal/Heroic")
  check(heroic and #heroic.rows == 21, "the Heroic block reads, 21 rows: " .. tostring(heroic and #heroic.rows))
  local casts = 0
  for _, row in ipairs(heroic and heroic.rows or {}) do casts = casts + #row.casts end
  check(casts == 82, "the Heroic block's casts: " .. casts)
  local starts = {}
  for _, p in ipairs(heroic and heroic.phases or {}) do starts[#starts + 1] = tostring(p.label) .. "@" .. tostring(p.t) end
  check(table.concat(starts, ",") == "P2@167,P2.5@268,P3@303", "the Heroic phase lines: " .. table.concat(starts, ","))
  local list = S:List(3429)
  local all = #list > 0
  for _, e in ipairs(list) do if e.difficulty ~= nil then all = false end end
  check(all, "every Coiled Altar special alert plays on every difficulty")
  local shield = S:Get(3429, "shield")
  check(shield and shield.absorb and shield.absorb.unit == "boss2" and shield.absorb.length == 15 and shield.absorb.anyDifficulty, "the Shield is a shield bar on boss2, 15 s")
  local function abs(ref, ph, t)
    if ph == 1 then return t end
    for _, p in ipairs(ref.phases or {}) do
      local num = tonumber(tostring(p.label):match("%d+%.%d+") or tostring(p.label):match("%d+"))
      if num == ph then return p.t + t end
    end
    return nil
  end
  local function first(group)
    local ref = CRT.AlertReminders.ReferenceFor(3429, { boss = "The Coiled Altar" }, group) or byGroup[group]
    local times = shield and S:Times(3429, shield, group, ref) or {}
    return times[1] and abs(byGroup[group], times[1].ph, times[1].t), #times
  end
  local h, hn = first("nh")
  local m, mn = first("mythic")
  check(h == 237 and hn == 3, "a Heroic run: Eternal Nightfall from the Heroic timeline, first at 3:57: " .. tostring(h) .. ", " .. tostring(hn) .. " casts")
  check(m == 245 and mn == 4, "a Mythic run: from the Mythic timeline, first at 4:05: " .. tostring(m) .. ", " .. tostring(mn) .. " casts")
end

-- Ula'tek's Grasping Fangs (Alex, 2026-10-30): a debuff list on every difficulty, Left groups 1 and 3, Right 2 and 4,
-- spell 1301117, in the mockup's colours (on brighter than off on each side).
do
  local fangs = S:Get(3492, "graspingFangs")
  check(fangs and S.IsDebuffList(fangs) and fangs.spellID == 1301117 and fangs.difficulty == nil, "Ula'tek: Grasping Fangs is a debuff list on spell 1301117, every difficulty")
  local sides = fangs and fangs.sides or {}
  check(#sides == 2 and sides[1].label == "Left" and table.concat(sides[1].groups, ",") == "1,3" and sides[2].label == "Right" and table.concat(sides[2].groups, ",") == "2,4",
    "its sides: Left 1, 3 and Right 2, 4")
  local function sum(c) return c[1] + c[2] + c[3] end
  local c = fangs and fangs.colors or {}
  check(c.left and c.right and sum(c.left.on) > sum(c.left.off) and sum(c.right.on) > sum(c.right.off) and c.left.on[1] > c.left.on[2] and c.right.on[3] > c.right.on[1],
    "magenta and blue when on, darker when off")
  check(fangs and #S:Times(3492, fangs, "mythic") == 0, "no times: the debuff drives it")
end

-- Heroic ability timelines (Alex, 2026-10-28): each boss file carries a Heroic block after its Mythic one. Rows, casts, phase lines.
do
  local want = {
    [3497] = { 16, 91, 4 }, [3445] = { 8, 92, 5 }, [3420] = { 6, 36, 0 }, [3455] = { 12, 146, 0 },
    [3421] = { 9, 41, 0 }, [3379] = { 7, 67, 0 }, [3513] = { 15, 79, 1 },
  }
  for _, r in ipairs(registered) do
    local w = want[r.def.encounterID]
    if w then
      local heroic, mythic
      for _, text in ipairs(r.def.references or {}) do
        local ref = Ref.Parse(text)
        if ref and ref.difficulty == "Heroic" then heroic = ref elseif ref and ref.difficulty == "Mythic" then mythic = ref end
      end
      local casts = 0
      for _, row in ipairs(heroic and heroic.rows or {}) do casts = casts + #row.casts end
      local got = (heroic and #heroic.rows or -1) .. "/" .. casts .. "/" .. (heroic and #(heroic.phases or {}) or -1)
      check(heroic ~= nil and mythic ~= nil and got == w[1] .. "/" .. w[2] .. "/" .. w[3],
        r.def.name .. ": Heroic block after the Mythic one, rows/casts/phase lines " .. w[1] .. "/" .. w[2] .. "/" .. w[3] .. ", got " .. got)
    end
  end
end

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error("season special alerts: " .. fails .. " failed") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
const modules = ['CRT_Modules/Timeline/Data.lua', 'CRT_Modules/Timeline/Database.lua', 'CRT_Modules/Timeline/Reference.lua',
  'CRT_Modules/Timeline/Lanes.lua', 'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua',
  'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/Engine.lua', 'CRT_Modules/Alerts/Reminders.lua',
  'CRT_Data/Bosses/Registry.lua', 'CRT_Modules/Alerts/Special.lua'];
// Each pack's files in the order its Season.xml lists them, as "<pack>/<file>". A Script or Include tag written any
// other way than <Script file="..."/> fails the group, so no pack file can slip past the lint unread.
const seasons = path.join(dir, 'CRT_Data/Seasons');
const packFiles = [], unread = [];
for (const pack of fs.readdirSync(seasons).sort()) {
  const xml = path.join(seasons, pack, 'Season.xml');
  if (!fs.existsSync(xml)) continue;
  const text = fs.readFileSync(xml, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of text.match(/<\s*(Script|Include)\b[^>]*>/gi) || []) {
    const m = tag.match(/^<Script\s+file="([^"]+)"\s*\/>$/);
    if (m) packFiles.push(pack + '/' + m[1].replace(/\\/g, '/'));
    else unread.push(pack + '/Season.xml: ' + tag);
  }
}
for (const u of unread) console.log('FAIL a tag the lint does not read, so its files go unchecked: ' + u);
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
if (unread.length > 0) process.exit(1);
