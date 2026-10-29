// Interrupts' kick lists (CRT_Modules/Interrupts/Data.lua) on the sample season pack, one boss given an
// interrupts block here: which bosses have one, your own list and the raid's, the list in use and a share
// switching you back to the raid's, your number from a name typed with its realm and in another case, a
// received list for one boss leaving the others alone, the season purge's declarations, the switch, Test on
// trash cleared at login, and the Addon check column. Then setups per difficulty and their keys, lists kept per
// group key, the lists from before group keys read in once, your own setups (in place of the shipped one until
// dropped), and a share's shape making a setup for a boss with none. Usage: node run_interrupts_data.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local registrySrc, seasonSrc, bossSrc, coreSrc, latticeSrc, dataSrc, commSrc, setupSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
local frames = {}
CreateFrame = function() local f = { events = {} } function f:RegisterEvent(e) self.events[e] = true end function f:UnregisterEvent(e) self.events[e] = nil end function f:SetScript(_, fn) self.fn = fn end frames[#frames + 1] = f return f end
local function fire(event, ...) for _, f in ipairs(frames) do if f.events[event] and f.fn then f.fn(f, event, ...) end end end
local ME = "Solex"
UnitName = function(u) if u == "player" then return ME end end
local secrets = {}
issecretvalue = function(v) return secrets[v] == true end

local CRT = {}
-- the defaults as Core.lua writes them: its file is read for the interrupts table only
local defaults = assert(load("return " .. assert(coreSrc:match("\\n    (interrupts = %b{})")):gsub("^interrupts = ", "")))()
CRT.db = { interrupts = defaults }
local registered
CRT.AddonCheck = { Register = function(_, def) registered = def end }
for _, src in ipairs({ registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, setupSrc, dataSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
local I = CRT.Interrupts
check(I ~= nil, "CRT.Interrupts is made")

-- the defaults
local d = CRT.db.interrupts
check(d.enabled == false, "defaults: off")
check(d.accept == true and d.test == false, "defaults: accept on, test off")
eq(d.plates.size, 50, "defaults: box size"); eq(d.plates.font, 24, "defaults: number size"); eq(d.plates.offset, 20, "defaults: height")
check(d.plates.on == true and d.plates.all == false, "defaults: numbers on, only yours")
eq(table.concat(d.plates.mineBox, ","), "0,1,0,1", "defaults: your box green")
eq(table.concat(d.plates.mineText, ","), "1,0,0,1", "defaults: your number red")
eq(table.concat(d.plates.box, ","), "1,0,0,1", "defaults: other boxes red")
eq(table.concat(d.plates.text, ","), "1,1,1,1", "defaults: other numbers white")
check(d.reminder.on == true and d.reminder.size == 48, "defaults: reminder on, 48")
eq(d.reminder.sound, "none", "defaults: no sound")

-- the season purge clears the per-boss tables
local labels = {}
for _, s in ipairs(CRT.Bosses:Stores()) do labels[s.label] = s.getter end
check(labels["own kick lists"] and labels["own kick lists"](CRT.db) == d.own, "purge: own kick lists declared")
check(labels["shared kick lists"] and labels["shared kick lists"](CRT.db) == d.shared, "purge: shared kick lists declared")
check(labels["kick list choices"] and labels["kick list choices"](CRT.db) == d.use, "purge: kick list choices declared")
check(labels["kick lists"] and labels["kick lists"](CRT.db) == d.kicks, "purge: the kick lists by group key declared")
check(labels["your kick setups"] and labels["your kick setups"](CRT.db) == d.setups, "purge: your own setups declared")
check(type(d.kicks) == "table" and type(d.setups) == "table", "defaults: kicks and setups")

-- one sample boss gets a block
eq(#I:Bosses(), 0, "bosses: none without a block")
local RAW = { { difficulty = 16, label = "Kick", groups = { { key = "left", label = "Left", slots = 5 }, { key = "right", label = "Right", slots = 5 } },
  timing = { anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25 } } }
CRT.Bosses:Get(3470).interrupts = RAW
CRT.Bosses:Register({ encounterID = 3421, name = "The Twin Fangs", season = "sample", interrupts = { { difficulty = 16 } } }) -- a block that does not read
I:ClearCache()
eq(#I:Bosses(), 1, "bosses: only the boss with a block")
local id = 3470
eq(I:Bosses()[1].key, "3470:16", "bosses: keyed by encounter and difficulty")
eq(I:Bosses()[1].encounterID, 3470, "bosses: its encounter ID")
eq(I:Bosses()[1].difficulty, 16, "bosses: its difficulty")
eq(I.Key(3470, 16), "3470:16", "key: made")
eq(select(2, I.SplitKey("3470:16")), 16, "key: split")
eq(select(1, I:Resolve(3470)), "3470:16", "key: a bare encounter ID is the boss's first setup")
eq(I:Bosses()[1].label, "Nek'zali the Soulcoiler", "bosses: its name")
check(I:Def(id) and I:Def(id).label == "Kick", "def: read")
check(I:Def(3421) == nil and I:Def(9999) == nil, "def: none for a bad block or another boss")
eq(I:BossName(id), "Nek'zali the Soulcoiler", "boss name")

-- your own list
eq(select(2, I:List(id)), nil, "list: none yet")
eq(#I:Own(id), 2, "own: two groups")
eq(#I:Own(id)[2], 5, "own: five slots")
eq(I:Own(id)[2][5], "", "own: empty slots")
local fired = 0
I:OnChange(function() fired = fired + 1 end)
I:SetName(id, 1, 3, "  Solex-Illidan ")
eq(I:Own(id)[1][3], "Solex", "set: trimmed and realm stripped")
check(fired > 0, "set: fires")
eq(select(2, I:List(id)), "own", "list: your own once a name is in")
ME = "solex"
eq(select(1, I:Mine(id)), 3, "mine: realm and case ignored")
eq(select(2, I:Mine(id)), "Left", "mine: group label")
eq(select(3, I:Mine(id)), 1, "mine: group index")
ME = "Solex"
check(not I:Complete(id, I:Own(id)), "complete: nine empty slots")
I:SetName(id, 1, 3, "Solex-Illidan")
ME = "Solex-Illidan"
eq(select(1, I:Mine(id)), 3, "mine: your own name with a realm")
ME = "Solex"
secrets.Solex = true
eq(I:Mine(id), nil, "mine: a secret name finds nothing")
secrets.Solex = nil

local function full(withSolexAt)
  local l = { {}, {} }
  local n = 0
  for g = 1, 2 do for s = 1, 5 do n = n + 1 l[g][s] = "P" .. n end end
  if withSolexAt then l[withSolexAt[1]][withSolexAt[2]] = "Solex" end
  return l
end
local FULL = full({ 2, 2 })
check(I:Complete(id, FULL), "complete: ten names")
I:ReceiveShared(id, FULL, "Brenn")
eq(select(2, I:List(id)), "raid", "list: the raid's wins")
eq(select(1, I:Mine(id)), 2, "mine: from the raid's list")
eq(select(2, I:Mine(id)), "Right", "mine: its group")
FULL[2][2] = "changed"
eq(select(1, I:List(id))[2][2], "Solex", "receive: a copy is kept")
FULL = full({ 2, 2 })
I:SetUse(id, "own"); eq(select(2, I:List(id)), "own", "use: back to own")
eq(select(1, I:Mine(id)), 3, "use: your number from your own")
I:ReceiveShared(id, FULL, "Brenn")
eq(select(2, I:List(id)), "raid", "use: a new share switches back")
fired = 0
I:SetName(id, 1, 3, I:Own(id)[1][3]); I:SetName(id, 1, 3, " " .. I:Own(id)[1][3] .. "-Realm ")
eq(select(2, I:List(id)), "raid", "set: the same name again (a field left unchanged) keeps the raid's list in use")
eq(fired, 0, "set: and changes nothing")
I:ReceiveShared(9999, full(), "Brenn")
eq(select(1, I:Mine(id)), 2, "receive: other bosses untouched")
I:Clear(id); eq(I:Own(id)[1][3], "", "clear: empties own only")
eq(select(2, I:List(id)), "raid", "clear: the raid's still in use")
eq(I:Shared(id).from, "Brenn", "receive: sender kept")
eq(I:Shared(id).at, 1790000000, "receive: when")
eq(CRT.db.interrupts.kicks[3470][16].shared.lists.right[2], "Solex", "receive: kept by group key")
eq(CRT.db.interrupts.kicks[3470][16].own.left[3], "", "own: kept by group key")
I:CopyRaids(id)
eq(I:Own(id)[2][2], "Solex", "copy: the raid's list over your own")
I:SetName(id, 2, 2, "Brenn")
eq(I:Own(id)[2][2], "Brenn", "copy: your own is a copy")
eq(select(1, I:List(id))[2][2], "Brenn", "edit: editing your own puts it in use")
eq(select(2, I:List(id)), "own", "edit: your own in use")
I:SetUse(id, "raid")
eq(select(1, I:Mine(id)), 2, "use: the raid's again")
I:SetName(id, 9, 9, "x")
eq(I:Own(id)[9], nil, "set: a slot outside the grid is ignored")
ME = "Nobody"
eq(I:Mine(id), nil, "mine: not on the list")
ME = "Solex"

-- what a change says: the key and where it came from
local said
I:OnChange(function(what, key, source) if what == "list" then said = tostring(key) .. "/" .. tostring(source) end end)
I:SetName(id, 1, 1, "Zed"); eq(said, "3470:16/own", "fire: your own edit, with its key")
I:ReceiveShared("3470:16", full(), "Brenn"); eq(said, "3470:16/raid", "fire: the raid's list")
I:Clear(id); eq(said, "3470:16/own", "fire: clear is your own")

-- a second difficulty, and setups of your own
RAW[2] = { difficulty = 15, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 } } }
I:ClearCache()
eq(#I:Bosses(), 2, "setups: one entry per difficulty")
eq(I:Bosses()[1].key .. " " .. I:Bosses()[2].key, "3470:16 3470:15", "setups: Mythic first")
eq(#I:Own("3470:15"), 1, "setups: each its own shape")
eq(#I:Own("3470:15")[1], 4, "setups: four slots")
I:SetName("3470:15", 1, 2, "Solex")
eq(select(1, I:Mine("3470:15")), 2, "setups: lists apart per difficulty")
eq(select(1, I:Mine("3470:16")), nil, "setups: (the Mythic list untouched)")
check(not I:IsCustom("3470:15"), "custom: none yet")
local ok, why = I:SetCustom("3470:15", { label = "Kick", spell = { name = "Wail" }, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 3 },
  { key = "cross", label = "Cross add", marker = 7, slots = 2 } } })
check(ok, "custom: saved " .. tostring(why))
check(I:IsCustom("3470:15"), "custom: in use")
eq(#I:Def("3470:15").groups, 2, "custom: replaces the shipped setup")
eq(I:Def("3470:15").timing, nil, "custom: untimed")
eq(I:Def("3470:15").spell.name, "Wail", "custom: its spell")
eq(CRT.db.interrupts.setups[3470][15].groups[2].key, "cross", "custom: saved per boss and difficulty")
eq(#I:Own("3470:15")[1], 3, "custom: the list follows its shape")
eq(I:Own("3470:15")[1][2], "Solex", "custom: the names kept by group key")
eq(I:ShippedDef("3470:15").groups[1].slots, 4, "custom: the shipped one still there")
check(not I:SetCustom("3470:15", { groups = {} }), "custom: a setup that doesn't read is refused")
I:SetCustom("3470:15", { groups = { { key = "a", label = "A", slots = 2 } }, timing = RAW[1].timing })
eq(I:Def("3470:15").timing, nil, "custom: never timed")
check(not I:SetCustom("3470:14", { groups = { { key = "x", label = "X", slots = 1 } } }), "custom: a group without a raid marker is refused")
check(I:SetCustom("3470:14", { groups = { { key = "x", label = "X", marker = 2, slots = 1 } } }), "custom: a difficulty with no shipped setup")
local okT, whyT = I:SetCustom("3470:16", { groups = { { key = "left", label = "Left", marker = 1, slots = 5 } } })
check(not okT and whyT == I.TEXT.timed, "custom: a timed shipped setup is never replaced (its lattice kept)")
check(not I:IsCustom("3470:16") and I:Def("3470:16").timing ~= nil, "custom: the timed setup still in use")
eq(#I:OwnedSetups(3470), 3, "owned: the shipped and your own setups")
eq(#I:Bosses(), 3, "custom: listed with the rest")
I:DropCustom("3470:15")
check(not I:IsCustom("3470:15"), "custom: back to the shipped setup")
eq(#I:Def("3470:15").groups, 1, "custom: the shipped shape again")
I:DropCustom("3470:14")
eq(#I:Bosses(), 2, "custom: gone from the list with nothing shipped")

-- a share whose shape doesn't fit the setup here: its shape is the setup while the raid's list is in use
do
  local three = CRT.InterruptSetup.FromShape(15, "skull:8:3:Skull add", "Kick")
  check(I:ReceiveShared("3470:15", { { "A", "Solex", "C" } }, "Brenn", three), "shape: a three-kicker list over a shipped four")
  eq(I:Def("3470:15").groups[1].slots, 3, "shape: the share's shape is in use")
  eq(select(1, I:Mine("3470:15")), 2, "shape: your number from it")
  eq(I:ShippedDef("3470:15").groups[1].slots, 4, "shape: the shipped one kept")
  eq(#I:OwnedSetups(3470), 2, "owned: never a share's shape")
  I:SetUse("3470:15", "own")
  eq(I:Def("3470:15").groups[1].slots, 4, "shape: your own list in use, the shipped setup again")
  I:SetUse("3470:15", "raid")
  eq(I:Def("3470:15").groups[1].slots, 3, "shape: the raid's again")
  -- the same shape shared again (no new shape needed to read it): it stays
  I:ReceiveShared("3470:15", { { "A", "Solex", "Z" } }, "Brenn")
  eq(I:Def("3470:15").groups[1].slots, 3, "shape: the same setup shared again keeps its shape")
  eq(I:Shared("3470:15").list[1][3], "Z", "shape: with the new names")
  -- your own list kept whole while a smaller shape is in use, and back
  for s4, n in ipairs({ "O1", "O2", "O3", "O4" }) do CRT.db.interrupts.kicks[3470][15].own.skull[s4] = n end
  eq(#I:Own("3470:15")[1], 3, "own: seen in the shape in use")
  I:SetName("3470:15", 1, 1, "O1b")
  eq(CRT.db.interrupts.kicks[3470][15].own.skull[4], "O4", "own: your fourth name never cut")
  eq(select(2, I:List("3470:15")), "own", "own: editing it puts it in use")
  eq(I:Def("3470:15").groups[1].slots, 4, "own: the shipped shape again")
  eq(I:Own("3470:15")[1][4], "O4", "own: and your fourth name is there")
  eq(I:Own("3470:15")[1][1], "O1b", "own: with the edit")
  I:SetUse("3470:15", "raid")
  -- a share in the shipped shape brings it back
  I:ReceiveShared("3470:15", { { "A", "B", "C", "D" } }, "Brenn", CRT.InterruptSetup.FromShape(15, "skull:8:4:Skull add", "Kick"))
  eq(I:Def("3470:15").groups[1].slots, 4, "shape: a share in the shipped shape replaces it")
end
RAW[2] = nil
I:ClearCache()

-- a share's shape for a boss with no setup here
local S = CRT.InterruptSetup
local shapeSetup = S.FromShape(16, "skull:8:2:Skull add", "Kick")
check(I:ReceiveShared("4000:16", { { "Solex", "Brenn" } }, "Brenn", shapeSetup), "shape: a list for a boss with no setup is taken with its shape")
eq(I:Def("4000:16") and I:Def("4000:16").groups[1].label, "Skull add", "shape: the shape is its setup")
eq(select(1, I:Mine("4000:16")), 1, "shape: your number from it")
check(not I:ReceiveShared("4001:16", { { "A" } }, "Brenn"), "shape: none without a shape")

-- the lists from before group keys: read in once, the old fields kept
do
  local db = CRT.db.interrupts
  db.kicks[3470] = nil
  db.own[3470] = { { "A1", "A2", "A3", "A4", "A5" }, { "B1", "B2", "Solex", "B4", "B5" } }
  db.shared[3470] = { list = { { "R1", "", "", "", "" }, { "", "", "", "", "R10" } }, from = "Brenn", at = 5 }
  db.use[3470] = "own"
  eq(I:Own(id)[2][3], "Solex", "migrate: your own list read in")
  eq(db.kicks[3470][16].own.right[3], "Solex", "migrate: by group key")
  eq(I:Shared(id).list[2][5], "R10", "migrate: the raid's list")
  eq(I:Shared(id).from, "Brenn", "migrate: and who sent it")
  eq(select(2, I:List(id)), "own", "migrate: your choice of list")
  check(db.own[3470] and db.shared[3470] and db.use[3470] == "own", "migrate: the old fields left as they were")
  db.own[3470] = { { "X" } }
  eq(I:Own(id)[1][1], "A1", "migrate: only once")
end

-- the switch and the Addon check column
eq(registered and registered.key, "interrupts", "addon check: column registered")
eq(registered and registered.label, "Interrupts", "addon check: its label")
eq(registered and registered.order, 45, "addon check: after Pace")
check(not registered.on(), "addon check: off by default")
check(not I:Enabled(), "enabled: off by default")
fired = 0
I:SetEnabled(true); check(registered.on() and I:Enabled(), "addon check: on follows the switch")
check(fired > 0, "enabled: the switch fires")
I:SetEnabled(false); check(not registered.on(), "addon check: off again")
local hidden
CRT.UI = { SetPageHidden = function(_, key, h) if key == "interrupts" then hidden = h end end }
I:SetEnabled(true); eq(hidden, false, "switch: shows the page")
I:SetEnabled(false); eq(hidden, true, "switch: hides the page")
-- at login: Test on trash is off, and the page follows the switch
CRT.db.interrupts.test = true
CRT.db.interrupts.enabled = true
hidden = nil
fire("PLAYER_LOGIN")
eq(CRT.db.interrupts.test, false, "login: test off")
eq(hidden, false, "login: the page follows the switch")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Core.lua', 'CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Core/Comm.lua',
  'CRT_Modules/Interrupts/Setup.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 8, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
