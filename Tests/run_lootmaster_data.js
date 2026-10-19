// LootMaster/Data.lua: the session model, the sorted rows, re-roll rules and the message format, with no
// frames. Usage: node run_lootmaster_data.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local src = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local NOW = 1000
GetTime = function() return NOW end
time = function() return 1790000000 end
local CRT = { db = { lootmaster = {} } }
geterrorhandler = function() return print end
assert(load(src, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster

-- responses
eq(#LM:Responses(), 6, "six default responses")
eq(LM:Responses()[1].key, "bis", "BiS first")
eq(LM:Responses()[6].key, "pass", "Pass last")
eq(LM:Response("up").weight, 80, "Upgrade weight")
eq(LM:Response("nope"), nil, "unknown response")
eq(LM:ResponseSeconds(), 60, "default answer time")
CRT.db.lootmaster.responseSeconds = 90
eq(LM:ResponseSeconds(), 90, "answer time from settings")
CRT.db.lootmaster.responseSeconds = nil

-- editing the set
eq(CRT.db.lootmaster.responses, nil, "nothing saved until you change something")
local k = LM:AddResponse()
eq(k, "r1", "a new key")
local list = LM:Responses()
eq(#list, 7, "added")
eq(list[6].key, "r1", "added before Pass")
eq(list[7].key, "pass", "Pass still last")
eq(LM:AddResponse(), "r2", "a second new key")
eq(LM:AddResponse(), nil, "no more than 8")
eq(LM:RemoveResponse("pass"), false, "Pass can't be removed")
eq(LM:RemoveResponse("r2"), true, "removed")
eq(LM:MoveResponse("r1", 1), false, "nothing moves below Pass")
eq(LM:MoveResponse("bis", -1), false, "the first can't go up")
eq(LM:MoveResponse("up", -1), true, "moved up")
eq(LM:Responses()[1].key, "up", "Upgrade now first")
LM:UpdateResponse("r1", { label = "A very long label for a button", weight = 250, icon = "need" })
local r1 = LM:Response("r1")
eq(#r1.label, LM.LABEL_MAX, "label cut to fit")
eq(r1.weight, LM.WEIGHT_MAX, "weight capped")
eq(r1.icon, "need", "a known icon is kept")
LM:UpdateResponse("r1", { icon = "Greed" })
eq(LM:Response("r1").icon, "greed", "an icon typed by name becomes its key")
LM:UpdateResponse("r1", { icon = "Interface/Icons/INV_Misc_QuestionMark" })
eq(LM:Response("r1").icon, nil, "an unknown icon is dropped")
eq(#LM.ICONS, 5, "five icons: Need, Greed, Transmog, Disenchant, Pass")
check(LM.IconMarkup("transmog"):find("^|A:lootroll") ~= nil, "transmog is an atlas")
check(LM.IconMarkup("need"):find("Dice") ~= nil, "need is the dice")
eq(LM.IconMarkup("nope"), "", "no markup for an unknown icon")
LM:UpdateResponse("r1", { icon = "de" })
LM:UpdateResponse("r1", { icon = "" })
eq(LM:Response("r1").icon, nil, "empty icon removes it")
LM:UpdateResponse("pass", { weight = 50 })
eq(LM:Response("pass").weight, 0, "Pass always weighs 0")
local clean = LM.CleanResponses({ { key = "pass", label = "Pass" }, { key = "x", label = "X", weight = 5 }, { key = "x", label = "dup" } })
eq(#clean, 2, "duplicates dropped")
eq(clean[2].key, "pass", "Pass moved last")
eq(#LM.CleanResponses({}), 1, "an empty set still has Pass")
LM:ResetResponses()
eq(#LM:Responses(), 6, "reset to the defaults")

-- a session
local s = LM.Session.New({ id = "a1", test = true, leader = "Solex-Sargeras",
  items = { { itemString = "item:111", ilvl = 289 }, { itemString = "item:222", ilvl = 289 } } })
eq(s.id, "a1", "session id")
eq(#s.items, 2, "items")
s:Expect({ "Solex-Sargeras", "Quick-Sargeras", "Arrow-Sargeras", "Halo-Sargeras", "Nocrt-Sargeras", "Brew-Sargeras" })
for _, n in ipairs({ "Solex-Sargeras", "Quick-Sargeras", "Arrow-Sargeras", "Halo-Sargeras", "Brew-Sargeras" }) do s:Ack(n, "0.25.0") end
eq(s:Row("Brew-Sargeras", 1).state, "loading", "said hello, items still arriving: loading")
for _, n in ipairs({ "Solex-Sargeras", "Quick-Sargeras", "Arrow-Sargeras", "Halo-Sargeras", "Brew-Sargeras" }) do s:Ready(n) end
eq(#s:NotReady(), 0, "everyone ready")
s:Answer("Quick-Sargeras", 1, { response = "bis", role = "D", class = "ROGUE", gear = { { id = 9, ilvl = 276 } }, note = "4pc" })
s:Answer("Arrow-Sargeras", 1, { response = "bis", role = "D", class = "HUNTER", gear = { { id = 8, ilvl = 281 } } })
s:Answer("Halo-Sargeras", 1, { response = "os", role = "H", class = "PRIEST" })
s:Answer("Solex-Sargeras", 1, { response = "pass", role = "T", class = "PALADIN" })
eq(s:SetRoll("Quick-Sargeras", 1, 71), true, "a roll is set")
s:SetRoll("Arrow-Sargeras", 1, 88)
s:SetRoll("Halo-Sargeras", 1, 93)
eq(s:SetRoll("Nobody-Sargeras", 1, 50), false, "no roll for someone with no answer")
NOW = NOW + 10
s:MarkNoCRT() -- after the hello wait
-- weight, then score, then roll: Quick (BiS, 96) before Arrow (BiS, 58) though Arrow rolled higher
local rows = s:Rows(1, function(name) return name == "Quick-Sargeras" and 96 or (name == "Arrow-Sargeras" and 58 or 100) end)
eq(rows[1].name, "Quick-Sargeras", "BiS, higher score first")
eq(rows[2].name, "Arrow-Sargeras", "BiS, lower score second")
eq(rows[3].name, "Halo-Sargeras", "Offspec after BiS")
eq(rows[4].name, "Solex-Sargeras", "Pass after answers")
eq(rows[5].state, "waiting", "Brew has CRT and has not answered")
eq(rows[6].name, "Nocrt-Sargeras", "no CRT last")
eq(rows[6].state, "nocrt", "no CRT state")
rows = s:Rows(1) -- no score: roll breaks the tie
eq(rows[1].name, "Arrow-Sargeras", "without scores the higher roll first")
eq(rows[1].diff, 289 - 281, "item level difference against their gear")

-- rolls, re-roll and re-send rules
eq(s:NeedsRoll("Solex-Sargeras", 1), false, "a pass needs no roll")
eq(s:NeedsRoll("Quick-Sargeras", 1), true, "BiS needs a roll")
eq(s:SetRoll("Quick-Sargeras", 1, 5), false, "a second roll never replaces the first")
eq(s:Row("Quick-Sargeras", 1).roll, 71, "the first stays")
eq(s:CanReroll("Quick-Sargeras", 1), true, "the looter can roll again for an answer with a roll")
eq(s:SetRoll("Quick-Sargeras", 1, 5, true), true, "Roll again replaces it")
eq(s:CanReroll("Solex-Sargeras", 1), false, "no roll again for a pass")
eq(s:CanReroll("Nocrt-Sargeras", 1), false, "no CRT: nothing to roll")
eq(s:CanResend("Nocrt-Sargeras", 1), false, "no CRT: no popup to re-send")
eq(s:CanResend("Brew-Sargeras", 1), true, "CRT, no answer: popup can be re-sent")
eq(s:CanResend("Quick-Sargeras", 1), false, "an answer is never wiped by showing the popup again")
s:Answer("Brew-Sargeras", 1, { response = "up", role = "D", class = "WARLOCK" })
s:Clear("Halo-Sargeras", 1)
eq(s:Row("Halo-Sargeras", 1).state, "waiting", "cleared answer waits again")
eq(s:Row("Halo-Sargeras", 1).roll, nil, "cleared answer drops its roll")
NOW = NOW + s.seconds + 1
s:Tick()
eq(s:Row("Halo-Sargeras", 1).state, "timeout", "no answer in time")
eq(s:CanResend("Halo-Sargeras", 1), true, "a timed-out raider can be sent the popup again")
eq(s:Missing(1)[1], "Halo-Sargeras", "missing answers for the item")
-- the clock starts at ready, not at the session's start
local s5 = LM.Session.New({ id = "r", items = { { itemString = "item:1" } } })
s5:Expect({ "Late-Sargeras" })
s5:Ack("Late-Sargeras", "0.25.0")
NOW = NOW + s5.seconds + 5
s5:Tick()
eq(s5:Row("Late-Sargeras", 1).state, "loading", "not ready: no timeout yet")
eq(s5:NotReady()[1], "Late-Sargeras", "listed as not ready")
s5:Ready("Late-Sargeras")
s5:Tick()
eq(s5:Row("Late-Sargeras", 1).state, "waiting", "ready now: a full answer time from here")
NOW = NOW + s5.seconds + 1
s5:Tick()
eq(s5:Row("Late-Sargeras", 1).state, "timeout", "then it times out")

-- awards
s:Award(1, "Quick-Sargeras", "bis")
eq(s.items[1].award.name, "Quick-Sargeras", "awarded")
eq(s.items[1].award.response, "bis", "awarded for")
eq(s:Answered(2), 0, "item 2 has no answers")

-- sorting
local sr = s:Rows(1)
LM.SortRows(sr, "roll", 1)
eq(sr[1].roll, 5, "roll low to high: lowest first")
eq(sr[#sr].roll, nil, "no roll last, low to high")
LM.SortRows(sr, "roll", -1)
check((sr[1].roll or 0) >= (sr[2].roll or 0), "roll high to low")
eq(sr[#sr].roll, nil, "no roll last, high to low too")
LM.SortRows(sr, "name", 1)
eq(sr[1].name, "Arrow-Sargeras", "names A to Z")
LM.SortRows(sr, "name", -1)
eq(sr[#sr].name, "Arrow-Sargeras", "names Z to A")
eq(#LM.SortRows(sr, "nope", 1), #sr, "an unknown column changes nothing")

-- the award message
eq(LM.FormatAward(LM.AWARD_DEFAULT, { item = "[Fang]", player = "Quick", response = "BiS", roll = 71 }), "[Fang] awarded to Quick for BiS with a 71 roll.", "default message")
eq(LM.FormatAward(LM.AWARD_DEFAULT, { item = "[Fang]", player = "Quick", response = "BiS" }), "[Fang] awarded to Quick for BiS with a - roll.", "no roll is -")
eq(LM.FormatAward("%p gets %i (%v)", { item = "[Fang]", player = "Quick", noRoll = "no" }), "Quick gets [Fang] (no)", "own template and no-roll text")
eq(LM.FormatAward("100%% %x", {}), "100%% %x", "unknown codes are left alone")

-- response button sizes and their row (Popup.lua lays the buttons out with these)
local function placed(widths, maxW)
  local pos, rows = LM.ButtonLayout(widths, maxW, 4, 2)
  local ok = true
  for i, p in ipairs(pos) do
    if p.x < 0 or p.x + widths[i] > maxW then ok = false end
    for j = i + 1, #pos do
      local q = pos[j]
      if q.row == p.row and not (p.x + widths[i] <= q.x or q.x + widths[j] <= p.x) then ok = false end
    end
  end
  return ok, rows, pos
end
local w = LM.ButtonWidth(52, true)
check(w >= 52 + 14 + 3 + 2 * 6, "a button holds its label, icon and padding (" .. w .. ")")
eq(LM.ButtonWidth(30, false), 30 + 2 * 6, "no icon: label and padding")
check(LM.ButtonWidth(5, false) >= LM.BUTTON_MIN_W, "never narrower than the minimum")
-- the six defaults with icons, at roughly the game's widths
local defaults = {}
for _, label in ipairs({ 20, 47, 33, 44, 57, 28 }) do defaults[#defaults + 1] = LM.ButtonWidth(label, true) end
local ok, rows = placed(defaults, 464)
check(ok, "defaults: inside the panel, no overlap")
eq(rows, 1, "defaults fit on one line")
-- a long custom name and eight buttons wrap instead of overlapping
local many = {}
for _, label in ipairs({ 20, 47, 33, 44, 57, 110, 90, 28 }) do many[#many + 1] = LM.ButtonWidth(label, true) end
ok, rows = placed(many, 464)
check(ok, "eight buttons with a long name: inside, no overlap")
check(rows >= 2, "they wrap to a second line")
local tight = { 100, 100, 100, 100, 56 } -- 456: 472 with gap 4, 464 with gap 2
ok, rows = placed(tight, 464)
check(ok and rows == 1, "a row that only fits with the smaller gap stays on one line")
local wide = { 600 }
ok, rows, pos = placed(wide, 464)
eq(pos[1].x, 0, "a button wider than the panel starts at the edge")

-- the auto-pass rule: only a loaded item with a non-empty spec list holding none of your specs
local mine = { [62] = true, [63] = true, [64] = true } -- a mage
local v, why = LM.SpecVerdict({ 73, 66, 250 }, mine, true)
eq(v, "auto", "a tank trinket on a mage: auto")
eq(why, "nospec", "reason")
eq(LM.SpecVerdict({ 73, 64 }, mine, true), "show", "one of your specs is listed: show")
eq(LM.SpecVerdict({}, mine, true), "show", "empty list: show")
eq(LM.SpecVerdict(nil, mine, true), "show", "nil: show")
eq(LM.SpecVerdict("x", mine, true), "show", "not a table: show")
eq(LM.SpecVerdict({ 73 }, mine, false), "show", "not loaded: show")
eq(LM.SpecVerdict({ 73 }, {}, true), "show", "you have no specs known: show")
eq(LM.SpecVerdict({ 73 }, nil, true), "show", "no spec list of yours: show")
eq(LM.SpecVerdict({ "73" }, mine, true), "show", "odd values: show")
local s2 = LM.Session.New({ id = "b", items = { { itemString = "item:1" } } })
eq(s2:AutoResponse(), "tmog", "auto answers Transmog")
local noTmog = LM.Session.New({ id = "c", items = { { itemString = "item:1" } }, responses = { { key = "bis", label = "BiS" }, { key = "pass", label = "Pass" } } })
eq(noTmog:AutoResponse(), "pass", "without Transmog, Pass")
s2:Expect({ "Frost-Sargeras" })
s2:Answer("Frost-Sargeras", 1, { response = "tmog", auto = true, autoSpecs = { 73, 66 } })
local ar = s2:Row("Frost-Sargeras", 1)
eq(ar.auto, true, "the row knows it was automatic")
eq(ar.autoSpecs and ar.autoSpecs[2], 66, "and which specs the game listed")
eq(s2:NeedsRoll("Frost-Sargeras", 1), false, "no roll for an automatic answer")

-- class limits: not your armor type, and items locked to other classes
local function cv(f) return (LM.ClassVerdict(f)) end
eq(cv({ loaded = true, itemClass = 4, subClass = 4, equipLoc = "INVTYPE_CHEST", myClass = "MAGE" }), "auto", "plate chest for a mage")
eq(cv({ loaded = true, itemClass = 4, subClass = 2, equipLoc = "INVTYPE_LEGS", myClass = "WARRIOR" }), "auto", "leather legs for a warrior: not their armor type")
eq(cv({ loaded = true, itemClass = 4, subClass = 2, equipLoc = "INVTYPE_LEGS", myClass = "DRUID" }), "show", "leather legs for a druid")
eq(cv({ loaded = true, itemClass = 4, subClass = 1, equipLoc = "INVTYPE_CLOAK", myClass = "WARRIOR" }), "show", "a cloak is for everyone")
eq(cv({ loaded = true, itemClass = 4, subClass = 0, equipLoc = "INVTYPE_FINGER", myClass = "MAGE" }), "show", "a ring has no armor type")
eq(cv({ loaded = true, itemClass = 4, subClass = 4, equipLoc = "INVTYPE_CHEST", myClass = "SOMETHINGNEW" }), "show", "a class CRT doesn't know: show")
eq(cv({ loaded = false, itemClass = 4, subClass = 4, equipLoc = "INVTYPE_CHEST", myClass = "MAGE" }), "show", "not loaded: show")
eq(cv({ loaded = true, itemClass = 4, subClass = 6, equipLoc = "INVTYPE_SHIELD", myClass = "MAGE" }), "show", "shields aren't judged by armor type")
local known = { Paladin = true, Warrior = true, Mage = true, ["Death Knight"] = true, Druid = true, Krieger = true, Kriegerin = true }
eq(cv({ loaded = true, classes = { "Paladin", "Warrior" }, myClassNames = { Mage = true }, knownClassNames = known, myClass = "MAGE" }), "auto", "a token for other classes")
eq(cv({ loaded = true, classes = { "Warrior", "Paladin", "Death Knight" }, myClassNames = { Druid = true }, knownClassNames = known, myClass = "DRUID" }), "auto", "Alex's Venomforged Idol on a druid")
eq(cv({ loaded = true, classes = { "Paladin", "Mage" }, myClassNames = { Mage = true }, knownClassNames = known, myClass = "MAGE" }), "show", "a token that names your class")
eq(cv({ loaded = true, classes = { "Krieger", "Paladin" }, myClassNames = { Krieger = true, Kriegerin = true }, knownClassNames = known, myClass = "WARRIOR" }), "show", "the male name on the line, a female warrior: still yours")
eq(cv({ loaded = true, classes = { "Paladin", "Warriorz" }, myClassNames = { Mage = true }, knownClassNames = known, myClass = "MAGE" }), "show", "a name that isn't a known class: show")
eq(cv({ loaded = true, classes = {}, myClassNames = { Mage = true }, knownClassNames = known, myClass = "MAGE" }), "show", "an empty class list: show")
eq(cv({ loaded = true, classes = { "Paladin" }, myClass = "MAGE", knownClassNames = known }), "show", "your class names unknown: show")
eq(cv({ loaded = true, classes = { "Paladin" }, myClassNames = { Mage = true }, myClass = "MAGE" }), "show", "the class list unknown: show")
local _, why = LM.ClassVerdict({ loaded = true, itemClass = 4, subClass = 4, equipLoc = "INVTYPE_HEAD", myClass = "PRIEST" })
eq(why, "armor", "reason: armor")
local names = LM.ParseClassesLine("Classes: Paladin, Warrior, Death Knight", "Classes: %s")
eq(names and #names, 3, "three classes read from the line")
eq(names and names[3], "Death Knight", "a two-word class name")
eq(LM.ParseClassesLine("Requires Level 80", "Classes: %s"), nil, "another line is not a class list")

-- packing lists into messages, and back
local entries = {}
for i = 1, 8 do entries[i] = { i, 289, "item:" .. (240000 + i) .. "::::::::90:102::3:4:6652:12667:13577:13333:12788:1:28:3608" } end
local msgs, long = LM.Wire.Pack("I", "abc", entries)
check(#msgs <= 3, "eight long items fit in three messages or fewer (" .. #msgs .. ")")
eq(#long, 0, "none too long")
local back = {}
for _, m in ipairs(msgs) do
  check(#m <= 255, "a packed message fits")
  local kind, f = LM.Wire.Decode(m)
  eq(kind, "I", "kind")
  eq(f[1], "abc", "session id")
  for _, e in ipairs(LM.Wire.Unpack(f[2])) do back[#back + 1] = e end
end
eq(#back, 8, "every item back")
eq(back[8][3], entries[8][3], "the item string intact")
local bm = LM.Wire.Pack("B", "abc", { { 1, "bis", "3ddc5a", 100, "need", "Bi,S;x|y" } })
local _, bf = LM.Wire.Decode(bm[1])
eq(LM.Wire.Unpack(bf[2])[1][6], "Bi S x y", "a label can't break the packing")
local _, tooLong = LM.Wire.Pack("I", "abc", { { 1, 1, string.rep("9", 300) } })
eq(#tooLong, 1, "an entry too long on its own is refused, not cut")
-- a saved session comes back with fresh clocks
local saved = { id = "z", items = { { itemString = "item:1" } }, players = { ["A-R"] = { name = "A-R", crt = true, ready = true, answers = { { asked = -999, state = "timeout" } } } }, order = { "A-R" }, responses = { { key = "pass", label = "Pass", weight = 0, color = { 1, 1, 1 } } }, seconds = 60 }
local rv = LM.Revive(saved)
eq(rv and rv.byKey.pass and rv.byKey.pass.label, "Pass", "responses usable again")
eq(rv.players["A-R"].answers[1].asked, NOW, "the clock starts again")
eq(rv.players["A-R"].answers[1].state, nil, "and the timeout is cleared")
eq(LM.Revive({}), nil, "a broken save is ignored")

-- the message format
local m = LM.Wire.Encode("R", { "a1", 1, "bis", "D", "ROGUE", 280.5, "9:276", "", "four|piece" })
check(#m <= 255, "a message fits")
local kind, f = LM.Wire.Decode(m)
eq(kind, "R", "kind back")
eq(f[1], "a1", "field 1")
eq(f[3], "bis", "field 3")
eq(f[9], "four/piece", "a | in a note can't split the message")
local long = LM.Wire.Encode("R", { "a1", 1, "bis", "D", "ROGUE", 280, "9:276", "8:281", string.rep("x", 400) })
check(#long <= 255, "a long note is cut to fit (" .. #long .. ")")
eq(LM.Wire.Decode("garbage"), nil, "a bad message is ignored")
local g = LM.Wire.Gear("9:276")
eq(g and g.id, 9, "gear id")
eq(g and g.ilvl, 276, "gear ilvl")
eq(LM.Wire.Gear(""), nil, "no gear")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, 'LootMaster/Data.lua'), 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
