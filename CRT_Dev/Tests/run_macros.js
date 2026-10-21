// CRT_Core/Macros.lua (the macro engine) and CRT_Modules/Markers/Macros.lua (its first set) against a mock of the
// game's macro API: account macros in slots 1 to 120 and character macros from 121, each list kept sorted by name
// as the game does, so slots move when a macro is made, renamed or deleted. Every macro call errors in combat and
// CreateMacro errors when the list is full, as the game's do.
// usage: node run_macros.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local engineSrc, markersSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- The game's macro lists.
local MAX_ACCOUNT, MAX_CHAR = 120, 30
Constants = { MacroConsts = { MAX_ACCOUNT_MACROS = MAX_ACCOUNT, MAX_CHARACTER_MACROS = MAX_CHAR } }
local account, char = {}, {}
local combat = false
local calls = 0 -- macro changes made through the API
local function sortList(t) table.sort(t, function(a, b) if a.name:lower() == b.name:lower() then return a.seq < b.seq end return a.name:lower() < b.name:lower() end) end
local seq = 0
local function listOf(i) if i > MAX_ACCOUNT then return char, i - MAX_ACCOUNT, MAX_ACCOUNT end return account, i, 0 end
local function indexOf(list, m, base) for i, x in ipairs(list) do if x == m then return base + i end end end
local function guard() if combat then error("ADDON_ACTION_BLOCKED: macros can't change in combat") end end
function InCombatLockdown() return combat end
function GetNumMacros() return #account, #char end
function GetMacroInfo(i)
  local list, j = listOf(i)
  local m = list[j]
  if m then return m.name, m.icon, m.body end
end
function CreateMacro(name, icon, body, perCharacter)
  guard() calls = calls + 1
  local list, max, base = account, MAX_ACCOUNT, 0
  if perCharacter then list, max, base = char, MAX_CHAR, MAX_ACCOUNT end
  if #list >= max then error("too many macros") end
  seq = seq + 1
  local m = { name = name, icon = icon, body = (body or ""):sub(1, 255), seq = seq }
  list[#list + 1] = m
  sortList(list)
  return indexOf(list, m, base)
end
function EditMacro(i, name, icon, body)
  guard() calls = calls + 1
  local list, j, base = listOf(i)
  local m = list[j]
  if name then m.name = name end
  if icon then m.icon = icon end
  if body then m.body = body:sub(1, 255) end
  sortList(list)
  return indexOf(list, m, base)
end
function DeleteMacro(i)
  guard() calls = calls + 1
  local list, j = listOf(i)
  table.remove(list, j)
end
local function find(name, list) for _, m in ipairs(list or account) do if m.name == name then return m end end end
local function playerMacro(name, body, perCharacter)
  local list = perCharacter and char or account
  seq = seq + 1
  list[#list + 1] = { name = name, icon = 134400, body = body, seq = seq }
  sortList(list)
end
local function reset()
  account, char = {}, {}
  combat = false
  CRT.db.macros.owned = {}
  CRTDBChar = {}
end

-- A frame stand-in for the engine's event frame.
local eventFrames = {}
function CreateFrame()
  local f = { events = {} }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:SetScript(n, fn) self[n] = fn end
  eventFrames[#eventFrames + 1] = f
  return f
end
local printed = {}
CRT = { db = { macros = { owned = {} } } }
function CRT:Print(msg) printed[#printed + 1] = msg end

assert(load(engineSrc, "CRT_Core/Macros.lua"))("CowfeeRaidTools", CRT)
assert(load(markersSrc, "CRT_Modules/Markers/Macros.lua"))("CowfeeRaidTools", CRT)
local M = CRT.Macros
check(type(M) == "table", "CRT.Macros exists")

-- The Marker calls set, registered by the Markers module.
local NAMES = { "Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull" }
do
  local sets = M:Sets()
  local set
  for _, s in ipairs(sets) do if s.key == "markers" then set = s end end
  check(set ~= nil, "the markers set is registered")
  local good = set and #set.macros == 8
  for i, name in ipairs(NAMES) do
    local m = set and set.macros[i]
    good = good and m and m.name == "CRT " .. name and m.body == "/raid {rt" .. i .. "}" and m.icon == 137000 + i
  end
  check(good, "the markers set: CRT Star to CRT Skull, /raid {rt1} to {rt8}, the raid target icons' file IDs")
  check(set and type(set.label) == "string" and set.label ~= "", "the markers set has a label")
end

-- Registering checks the names and bodies.
do
  check(not M:Register({ key = "bad1", label = "Bad", macros = { { name = "Star", icon = 1, body = "/say hi" } } }), "a name without the CRT prefix is refused")
  check(not M:Register({ key = "bad2", label = "Bad", macros = { { name = "CRT A very long name", icon = 1, body = "/say hi" } } }), "a name over 16 characters is refused")
  check(not M:Register({ key = "bad3", label = "Bad", macros = { { name = "CRT Long", icon = 1, body = string.rep("x", 256) } } }), "a body over 255 characters is refused")
  check(not M:Register({ key = "bad4", label = "Bad", macros = { { name = "CRT A", icon = 1, body = "/say a" }, { name = "CRT A", icon = 1, body = "/say b" } } }), "a set naming one macro twice is refused")
  local n = 0 for _, s in ipairs(M:Sets()) do if s.key:find("^bad") then n = n + 1 end end
  check(n == 0, "refused sets are not listed")
end

-- A fresh list.
do
  local st = M:Status("markers")
  check(st and #st.missing == 8 and st.created == 0, "fresh: all 8 missing")
  check(M:StatusText("markers") == "none", "fresh: status says none (got " .. tostring(M:StatusText("markers")) .. ")")
end

-- Create.
do
  local ok, msg = M:Create("markers")
  check(ok, "create: succeeds")
  check(#account == 8 and #char == 0, "create: 8 general (account) macros, no character macros")
  local good = true
  for i, name in ipairs(NAMES) do
    local m = find("CRT " .. name)
    good = good and m and m.body == "/raid {rt" .. i .. "}" and m.icon == 137000 + i
  end
  check(good, "create: each macro has its body and icon")
  check(CRT.db.macros.owned.markers and CRT.db.macros.owned.markers["CRT Star"] and CRT.db.macros.owned.markers["CRT Star"].body == "/raid {rt1}", "create: what was made is saved as ours")
  check(M:StatusText("markers") == "8 of 8 created", "create: status 8 of 8 created (got " .. tostring(M:StatusText("markers")) .. ")")
  check(type(msg) == "string" and msg:find("8") ~= nil, "create: the message says how many (" .. tostring(msg) .. ")")
end

-- Create again: nothing new.
do
  local before = calls
  local ok, msg = M:Create("markers")
  check(ok and #account == 8 and calls == before, "create again: no new macros, no macro calls")
  check(type(msg) == "string" and msg ~= "", "create again: says so (" .. tostring(msg) .. ")")
end

-- Remove: all 8 go, a macro of the player's stays.
do
  playerMacro("Zed", "/say zed")
  playerMacro("Assist", "/assist focus")
  local ok = M:Remove("markers")
  check(ok and #account == 2 and find("Zed") and find("Assist"), "remove: only ours go (left " .. #account .. ")")
  check(next(CRT.db.macros.owned.markers or {}) == nil, "remove: nothing is saved as ours any more")
  check(M:StatusText("markers") == "none", "remove: status none")
end

-- A player's own macro with one of our names: never overwritten, reported.
do
  reset()
  playerMacro("CRT Moon", "/say my moon")
  local ok, msg = M:Create("markers")
  check(#account == 8 and find("CRT Moon").body == "/say my moon", "conflict: 7 made, the player's CRT Moon kept as it was")
  local st = M:Status("markers")
  check(st.created == 7 and #st.conflicts == 1 and st.conflicts[1] == "CRT Moon", "conflict: status lists CRT Moon")
  check(type(msg) == "string" and msg:find("CRT Moon", 1, true) ~= nil, "conflict: the message names it (" .. tostring(msg) .. ")")
  check(not (CRT.db.macros.owned.markers or {})["CRT Moon"], "conflict: CRT Moon is not saved as ours")
  check(M:StatusText("markers"):find("7 of 8", 1, true) ~= nil, "conflict: status 7 of 8 (" .. M:StatusText("markers") .. ")")
  -- a character macro with one of our names is the player's too
  playerMacro("CRT Skull", "/say my skull", true)
  local st2 = M:Status("markers")
  local named = false for _, n in ipairs(st2.conflicts) do if n == "CRT Skull" then named = true end end
  check(not named, "conflict: our own CRT Skull still counts as ours beside a character macro of that name")
end

-- A macro the player edited, and one they renamed, are kept by Remove.
do
  reset()
  M:Create("markers")
  find("CRT Star").body = "/raid {rt1} on me"
  local skull = find("CRT Skull") skull.name = "My Skull" sortList(account)
  local st = M:Status("markers")
  check(#st.changed == 1 and st.changed[1] == "CRT Star", "edited: status lists CRT Star as changed by you")
  check(M:StatusText("markers"):find("1 changed by you", 1, true) ~= nil, "edited: status text says 1 changed by you (" .. M:StatusText("markers") .. ")")
  local ok, msg = M:Remove("markers")
  check(#account == 2 and find("CRT Star") and find("CRT Star").body == "/raid {rt1} on me" and find("My Skull"), "remove: the edited CRT Star and the renamed My Skull stay")
  check(type(msg) == "string" and msg:find("CRT Star", 1, true) ~= nil, "remove: the message names the kept one (" .. tostring(msg) .. ")")
  -- an edited macro is not ours to rewrite either
  check(not M:Update("markers") or find("CRT Star").body == "/raid {rt1} on me", "update: the edited CRT Star is not rewritten")
end

-- General Macros without room: all 8 go to the character's macros together.
local function fillAccount(n) for i = 1, n do playerMacro(string.format("Mine %03d", i), "/say " .. i) end end
local function fillChar(n) for i = 1, n do playerMacro(string.format("Char %03d", i), "/say c" .. i, true) end end
do
  reset()
  fillAccount(115)
  local ok, msg = M:Create("markers")
  check(ok and #account == 115 and #char == 8, "general full: all 8 made in the character's macros (account " .. #account .. ", char " .. #char .. ")")
  check(type(msg) == "string" and msg:find("character", 1, true) ~= nil, "general full: the message says where (" .. tostring(msg) .. ")")
  local st = M:Status("markers")
  check(st.created == 8 and #st.missing == 0, "general full: all 8 count as ours")
  check(st.entries[1].perCharacter == true, "general full: an entry says it lives in the character's macros")
  check(CRTDBChar.macros and CRTDBChar.macros.owned.markers["CRT Star"] and not (CRT.db.macros.owned.markers or {})["CRT Star"], "general full: ownership kept per character (CRTDBChar), not in the account list")
  -- the player edits one in the character list: changed, kept by Remove
  find("CRT Moon", char).body = "/say mine"
  check(#M:Status("markers").changed == 1, "character macro edited: changed by you")
  M:Remove("markers")
  check(#char == 1 and char[1].name == "CRT Moon" and #account == 115, "remove takes only ours from the character's macros")
end

-- Neither list has room for all 8 alone: split, General first, then the character's; all 8 made.
do
  reset()
  fillAccount(117) -- 3 free
  fillChar(25)     -- 5 free
  local ok, msg = M:Create("markers")
  check(ok and #account == 120 and #char == 30, "split: 3 in General, 5 in the character's macros")
  check(M:Status("markers").created == 8, "split: all 8 are ours")
  check(type(msg) == "string" and msg:find("3", 1, true) and msg:find("5", 1, true), "split: the message gives both counts (" .. tostring(msg) .. ")")
  local ok2 = M:Remove("markers")
  check(ok2 and #account == 117 and #char == 25 and M:Status("markers").created == 0, "split: remove takes ours from both places")
end

-- Both lists together have no room: none made, and how many to free.
do
  reset()
  fillAccount(117) -- 3 free
  fillChar(27)     -- 3 free
  local before = calls
  local ok, msg = M:Create("markers")
  check(not ok and calls == before and #account == 117 and #char == 27, "both full: none of the 8 are made")
  check(type(msg) == "string" and msg:find("2", 1, true) ~= nil and msg:lower():find("free", 1, true) ~= nil, "both full: the message says to free 2 (" .. tostring(msg) .. ")")
end

-- One macro at a time: Create with a name makes just that one.
do
  reset()
  local ok, msg = M:Create("markers", "CRT Diamond")
  check(ok and #account == 1 and account[1].name == "CRT Diamond", "one: only CRT Diamond is made")
  check(M:Status("markers").created == 1, "one: status counts 1")
  M:Create("markers", "CRT Diamond")
  check(#account == 1, "one again: nothing new")
  M:Create("markers")
  check(#account == 8, "generate all after one: the other 7 are made")
end

-- Old saved data (no place recorded) still reads as General Macros.
do
  reset()
  M:Create("markers")
  for _, rec in pairs(CRT.db.macros.owned.markers) do rec.perCharacter = nil end
  check(M:Status("markers").created == 8, "old ownership records still count as ours")
end

-- Combat: nothing changes, and it says why.
do
  reset()
  combat = true
  local before = calls
  local ok1, m1 = M:Create("markers")
  local ok2, m2 = M:Remove("markers")
  local ok3, m3 = M:Update("markers")
  check(not ok1 and not ok2 and not ok3 and calls == before and #account == 0, "combat: create, remove and update refuse, no macro calls")
  check(type(m1) == "string" and m1:lower():find("combat") and type(m2) == "string" and type(m3) == "string", "combat: a message says why (" .. tostring(m1) .. ")")
  check(M:InCombat(), "combat: M:InCombat reports it for the page")
  combat = false
end

-- Update: rewrites ours whose body changed in the addon; leaves the player's edits.
do
  reset()
  M:Create("markers")
  local set for _, s in ipairs(M:Sets()) do if s.key == "markers" then set = s end end
  local oldMoon, oldSquare = set.macros[5].body, set.macros[6].body
  set.macros[5].body = "/raid {rt5} moon"
  set.macros[6].body = "/raid {rt6} square"
  find("CRT Square").body = "/raid {rt6} mine"
  local st = M:Status("markers")
  check(st.outdated == 1, "update: one of ours is out of date (got " .. tostring(st.outdated) .. ")")
  check(M:StatusText("markers"):find("1 out of date", 1, true) ~= nil, "update: status text says 1 out of date (" .. M:StatusText("markers") .. ")")
  local ok, msg = M:Update("markers")
  check(ok and find("CRT Moon").body == "/raid {rt5} moon", "update: CRT Moon rewritten")
  check(find("CRT Square").body == "/raid {rt6} mine", "update: the player's edited CRT Square kept")
  check(CRT.db.macros.owned.markers["CRT Moon"].body == "/raid {rt5} moon", "update: the new body saved as ours")
  check(M:Status("markers").outdated == 0 and #account == 8, "update: nothing left out of date, still 8 macros")
  local before = calls
  M:Update("markers")
  check(calls == before, "update again: no macro calls")
  set.macros[5].body, set.macros[6].body = oldMoon, oldSquare
end

-- Character macros: a set marked perCharacter goes there, and counts the character limit.
do
  reset()
  check(M:Register({ key = "charset", label = "Test", perCharacter = true, macros = { { name = "CRT Test", icon = 134400, body = "/say test" } } }), "a per-character set registers")
  M:Create("charset")
  check(#char == 1 and #account == 0 and char[1].name == "CRT Test", "per-character set made among character macros")
  playerMacro("CRT Test", "/say mine") -- an account macro of the same name: not ours
  check(M:Status("charset").created == 1, "per-character: ours found among character macros")
  M:Remove("charset")
  check(#char == 0 and #account == 1, "per-character: remove takes only ours")
end

-- The page hears about changes.
do
  local heard = 0
  M:OnChange(function() heard = heard + 1 end)
  for _, f in ipairs(eventFrames) do if f.events.UPDATE_MACROS and f.OnEvent then f.OnEvent(f, "UPDATE_MACROS") end end
  for _, f in ipairs(eventFrames) do if f.events.PLAYER_REGEN_DISABLED and f.OnEvent then f.OnEvent(f, "PLAYER_REGEN_DISABLED") end end
  check(heard >= 2, "listeners hear UPDATE_MACROS and combat changes")
end

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Core/Macros.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Markers/Macros.lua', 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
