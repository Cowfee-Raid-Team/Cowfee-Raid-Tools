// CRT_Modules/LootMaster/Data.lua: the session model, the sorted rows, re-roll rules and the message format, with no
// frames. Usage: node run_lootmaster_data.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local src, testSrc, filterSrc = ...
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
eq(s:NeedsRoll("Solex-Sargeras", 1), true, "every answer gets a roll, the last button too")
eq(s:NeedsRoll("Quick-Sargeras", 1), true, "BiS needs a roll")
eq(s:NeedsRoll("Brew-Sargeras", 1), false, "no answer, no roll")
eq(s:SetRoll("Quick-Sargeras", 1, 5), false, "a second roll never replaces the first")
eq(s:Row("Quick-Sargeras", 1).roll, 71, "the first stays")
eq(s:CanReroll("Quick-Sargeras", 1), true, "the looter can roll again for an answer with a roll")
eq(s:SetRoll("Quick-Sargeras", 1, 5, true), true, "Roll again replaces it")
eq(s:CanReroll("Solex-Sargeras", 1), false, "no roll drawn yet: nothing to roll again")
s:SetRoll("Solex-Sargeras", 1, 12)
eq(s:CanReroll("Solex-Sargeras", 1), true, "a weight-0 answer's roll can be rolled again")
eq(s:Rows(1)[4].name, "Solex-Sargeras", "weight still sorts first: the weight-0 answer stays after Offspec")
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

-- answers in of raiders with CRT, and whether the time ran out (the item tabs' "3/5 answered")
local sc = LM.Session.New({ id = "cnt", items = { { itemString = "item:1" }, { itemString = "item:2" } }, seconds = 60 })
sc:Expect({ "A", "B", "C", "D", "E", "NoAddon" })
for _, n in ipairs({ "A", "B", "C", "D", "E" }) do sc:Ack(n, "x") sc:Ready(n) end
sc:MarkNoCRT()
for _, n in ipairs({ "A", "B", "C" }) do sc:Answer(n, 1, { response = "bis" }) end
local x, y, late = sc:AnswerCount(1)
eq(x, 3, "AnswerCount: three answers in")
eq(y, 5, "AnswerCount: five raiders with CRT, not the one without")
eq(late, false, "AnswerCount: time left")
NOW = NOW + 61
x, y, late = sc:AnswerCount(1)
eq(late, true, "AnswerCount: the time ran out with answers missing")
sc:Answer("D", 2, { response = "bis", auto = true })
for _, n in ipairs({ "A", "B", "C", "E" }) do sc:Answer(n, 2, { response = "pass" }) end
x, y, late = sc:AnswerCount(2)
eq(x .. "/" .. y, "5/5", "AnswerCount: an automatic answer counts")
eq(late, false, "AnswerCount: everyone answered is never late")
sc:Tick()
NOW = NOW - 61
x, y, late = sc:AnswerCount(1)
eq(late, true, "AnswerCount: a timeout the looter marked")
-- someone said hello but never got the session: late once READY_SECONDS have passed
local sr = LM.Session.New({ id = "rdy", items = { { itemString = "item:1" } }, seconds = 60 })
sr:Expect({ "A", "Slow" })
sr:Ack("A", "x") sr:Ready("A") sr:Answer("A", 1, { response = "bis" })
sr:Ack("Slow", "x")
x, y, late = sr:AnswerCount(1)
eq(x .. "/" .. y, "1/2", "AnswerCount: a raider still loading counts in Y")
eq(late, false, "AnswerCount: still loading, not late yet")
NOW = NOW + LM.READY_SECONDS + 1
x, y, late = sr:AnswerCount(1)
eq(late, true, "AnswerCount: never got the session after READY_SECONDS is late")
NOW = NOW - LM.READY_SECONDS - 1
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
local noTmog = LM.Session.New({ id = "c", items = { { itemString = "item:1" } }, responses = { { key = "bis", label = "BiS", weight = 100 }, { key = "pass", label = "Pass" } } })
eq(noTmog:AutoResponse(), "tmog", "without a Transmog button, still Transmog")
eq(noTmog:Response("tmog").label, "Transmog", "the built-in Transmog")
eq(noTmog:Response("tmog").weight, 1, "weighs 1: below any button weighted above 0, above a weight-0 Pass")
eq(noTmog:Response("tmog").icon, "transmog", "with the transmog icon")
eq(#noTmog.responses, 2, "the built-in Transmog is not a raider button")
noTmog:Expect({ "Frost-Sargeras", "Bear-Sargeras", "Last-Sargeras" })
eq(noTmog:Answer("Frost-Sargeras", 1, { response = "tmog", auto = true, autoWhy = "armor" }), true, "Answer accepts tmog with no button")
noTmog:Answer("Bear-Sargeras", 1, { response = "pass" })
noTmog:Answer("Last-Sargeras", 1, { response = "bis" })
local nr = noTmog:Rows(1)
eq(nr[1].name, "Last-Sargeras", "BiS first")
eq(nr[2].name, "Frost-Sargeras", "the built-in Transmog sorts by its weight, before Pass")
eq(nr[2].weight, 1, "the row has its weight")
eq(noTmog:Answer("Frost-Sargeras", 1, { response = "nope" }), false, "an unknown answer is still refused")
-- a Transmog button of your own keeps its own label, colour and weight
local ownTmog = LM.Session.New({ id = "d", items = { { itemString = "item:1" } }, responses = { { key = "bis", label = "BiS", weight = 100 }, { key = "tmog", label = "Looks", weight = 40, color = { 0.1, 0.2, 0.3 } }, { key = "pass", label = "Pass" } } })
eq(ownTmog:AutoResponse(), "tmog", "your own Transmog button")
eq(ownTmog:Response("tmog").label, "Looks", "keeps its label")
eq(ownTmog:Response("tmog").weight, 40, "and its weight")
eq(ownTmog:Response("tmog").color[3], 0.3, "and its colour")
-- the last button relabelled Transmog: the auto answer uses it, so there is never a second Transmog
local lastTmog = LM.Session.New({ id = "e", items = { { itemString = "item:1" } }, responses = { { key = "major", label = "Major Upgrade", weight = 100 }, { key = "os", label = "Offspec", weight = 30 }, { key = "pass", label = "transmog", weight = 0 } } })
eq(lastTmog:AutoResponse(), "pass", "the last button named Transmog (any case) is the auto answer")
local iconTmog = LM.Session.New({ id = "f", items = { { itemString = "item:1" } }, responses = { { key = "bis", label = "BiS", weight = 100 }, { key = "os", label = "Offspec", icon = "transmog", weight = 2 }, { key = "pass", label = "Pass" } } })
eq(iconTmog:AutoResponse(), "tmog", "the transmog icon alone doesn't make Offspec the Transmog: the built-in is used")
iconTmog:Expect({ "Os-Sargeras", "Mog-Sargeras", "Pass-Sargeras" })
iconTmog:Answer("Os-Sargeras", 1, { response = "os" })
iconTmog:Answer("Mog-Sargeras", 1, { response = "tmog", auto = true })
iconTmog:Answer("Pass-Sargeras", 1, { response = "pass" })
local ir = iconTmog:Rows(1)
eq(ir[1].name .. "," .. ir[2].name .. "," .. ir[3].name, "Os-Sargeras,Mog-Sargeras,Pass-Sargeras", "the built-in Transmog sorts below a button weighted 2 and above Pass")
local function awardKeys(sess)
  local out = {}
  for _, r in ipairs(sess:AwardResponses()) do out[#out + 1] = r.key end
  return table.concat(out, ",")
end
eq(awardKeys(lastTmog), "major,os,pass", "Give for lists every button, the weight-0 last one too, and no second Transmog")
eq(awardKeys(noTmog), "bis,tmog,pass", "the built-in Transmog can be given for too, before the last button")
eq(awardKeys(ownTmog), "bis,tmog,pass", "your own Transmog button once")
eq(awardKeys(iconTmog), "bis,os,tmog,pass", "an icon-only button is not a Transmog: the built-in is listed too")
-- the version an auto answer needs from the looter
eq(LM.VersionAtLeast("0.26.0", "0.26.0"), true, "same version")
eq(LM.VersionAtLeast("0.26.1", "0.26.0"), true, "newer patch")
eq(LM.VersionAtLeast("0.30.0", "0.26.0"), true, "newer minor")
eq(LM.VersionAtLeast("1.0", "0.26.0"), true, "newer major, short")
eq(LM.VersionAtLeast("0.25.0", "0.26.0"), false, "older")
eq(LM.VersionAtLeast("0.25.9", "0.26.0"), false, "older, higher patch")
eq(LM.VersionAtLeast(nil, "0.26.0"), false, "unknown: old")
eq(LM.VersionAtLeast("garbage", "0.26.0"), false, "unreadable: old")
check(LM.VersionAtLeast(LM.VERSION, LM.AUTO_TMOG_SINCE), "this version sends Transmog")
s2:Expect({ "Frost-Sargeras" })
s2:Answer("Frost-Sargeras", 1, { response = "tmog", auto = true, autoSpecs = { 73, 66 } })
local ar = s2:Row("Frost-Sargeras", 1)
eq(ar.auto, true, "the row knows it was automatic")
eq(ar.autoSpecs and ar.autoSpecs[2], 66, "and which specs the game listed")
eq(s2:NeedsRoll("Frost-Sargeras", 1), true, "an automatic answer gets a roll too")

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
-- weapon types: the game's red weapon type on the tooltip's slot line
local RED, WHITE = { 1, 0.125, 0.125 }, { 1, 1, 1 }
local function weapon(text, color, extra)
  local f = { loaded = true, itemClass = 2, subClass = 7, subType = "One-Handed Swords", equipLoc = "INVTYPE_WEAPON", myClass = "DRUID", slotText = text, slotColor = color }
  for k, v in pairs(extra or {}) do f[k] = v end
  return LM.ClassVerdict(f)
end
local wv, wwhy = weapon("Sword", RED)
eq(wv, "auto", "a red Sword on a druid")
eq(wwhy, "weapon", "reason: weapon")
eq(weapon("One-Handed Swords", RED), "auto", "red text equal to the subtype")
eq(weapon("Dagger", { 1, 0.1, 0.1 }, { subType = "Daggers", subClass = 15 }), "auto", "a slightly different red still counts")
eq(weapon("Sword", WHITE), "show", "white: your class can use it")
eq(weapon("Sword", { 1, 0.82, 0 }), "show", "gold isn't red")
eq(weapon("Mace", RED), "show", "red text that isn't the item's weapon type")
eq(weapon(nil, nil), "show", "no slot line: show")
eq(weapon("Sword", nil), "show", "no colour: show")
eq(weapon("", RED), "show", "empty text: show")
eq(weapon("Sword", RED, { subType = false }), "show", "subtype unknown: show")
eq(weapon("Sword", { "x", 0, 0 }), "show", "odd colour values: show")
eq(weapon("Leather", RED, { itemClass = 4, subClass = 1, subType = "Leather", equipLoc = "INVTYPE_CLOAK" }), "show", "not a weapon: the weapon rule doesn't apply")
eq(weapon("Sword", RED, { loaded = false }), "show", "not loaded: show")
eq(LM.IsRed({ r = 1, g = 0.125, b = 0.125 }), true, "a colour with r g b fields")
eq(LM.IsRed(RED), true, "a colour as a list")
eq(LM.IsRed(nil), false, "no colour")
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

-- the test's sample items (Test.lua): random, one per slot first, then filled
local HISTORY = {}
local SLOT = {}
local function hist(id, equipLoc, itemClass) HISTORY[#HISTORY + 1] = { [8] = "item:" .. id .. "::::" } SLOT[id] = { equipLoc, itemClass } end
for i = 1, 4 do hist(1000 + i, "INVTYPE_HEAD", 4) end
for i = 1, 4 do hist(2000 + i, "INVTYPE_WEAPON", 2) end
hist(3001, "INVTYPE_TRINKET", 4)
hist(4001, "", 15) -- a token: no slot, judged by its item class
hist(1001, "INVTYPE_HEAD", 4) -- seen twice: once in the pool
CRT.Loot = { R = { ITEM = 8 }, ItemID = function(s) return tonumber((s or ""):match("item:(%d+)")) end,
  Each = function(_, fn) for _, rec in ipairs(HISTORY) do fn(rec) end end }
CRT.LootRCLC = { unmatched = { { itemString = "item:5001", link = "[Five]" } } }
SLOT[5001] = { "INVTYPE_HAND", 4 }
C_Item = { GetItemInfoInstant = function(s) local id = tonumber(s:match("item:(%d+)")) local sl = SLOT[id] if not sl then return id, "Misc", "Junk", "", 0, 15, 0 end return id, "x", "y", sl[1], 0, sl[2], 0 end,
  GetDetailedItemLevelInfo = function() return 289 end }
CRT.Print = function() end
IsInGroup = function() return false end
-- the loot filter (Filter.lua; run_lootmaster_filter.js tests it): these items can't be read here, so none
-- passes and the test fills with others, as before the filter
CRT.defaults = { lootmaster = { filter = { boss = true, quality = 4, ilvl = 0, kinds = { bop = true, tier = true } } } }
assert(load(filterSrc, "Filter.lua"))("CowfeeRaidTools", CRT)
assert(load(testSrc, "Test.lua"))("CowfeeRaidTools", CRT)
local started
function LM:Start(items, test) started = items return { items = items } end
-- a fixed random: a seeded generator, so each run is the same
local function seeded(seed)
  return function(n) seed = (seed * 1103515245 + 12345) % 2147483648 return (seed % n) + 1 end
end
local function slotsOf(items)
  local seen, n = {}, 0
  for _, it in ipairs(items) do
    local sl = SLOT[tonumber(it.itemString:match("item:(%d+)"))]
    local k = sl and (sl[1] ~= "" and sl[1] or ("class" .. sl[2])) or "?"
    if not seen[k] then seen[k] = true n = n + 1 end
  end
  return n
end
local function ids(items)
  local out = {}
  for _, it in ipairs(items) do out[#out + 1] = it.itemString end
  return table.concat(out, " ")
end
LM:Test(4, seeded(7))
eq(#started, 4, "four items")
eq(slotsOf(started), 4, "four different slots or kinds when the pool has them")
local first = ids(started)
local dupe = {}
for _, it in ipairs(started) do check(not dupe[it.itemString], "no item twice") dupe[it.itemString] = true end
eq(started[1].ilvl, 289, "item level read for the picked items")
eq(started[1].itemString:find(":$"), nil, "short item strings")
LM:Test(4, seeded(7))
eq(ids(started), first, "the same random gives the same items")
local differ = 0
for seed = 1, 10 do LM:Test(4, seeded(seed * 31)) if ids(started) ~= first then differ = differ + 1 end end
check(differ >= 5, "other tests usually show a different set (" .. differ .. " of 10)")
LM:Test(8, seeded(3))
eq(#started, 8, "eight items: every slot first, then filled")
eq(slotsOf(started), 5, "all five slots and kinds are in")
local picked = LM.PickSamples({ { id = 1, equipLoc = "A" }, { id = 2, equipLoc = "A" }, { id = 3, equipLoc = "B" } }, 2, function(n) return 1 end)
check(picked[1].equipLoc ~= picked[2].equipLoc, "PickSamples: two different slots before a second of one")
eq(#LM.PickSamples({}, 4, seeded(1)), 0, "an empty pool gives nothing")
HISTORY = {}
CRT.LootRCLC = nil
LM:Test(3, seeded(5))
eq(#started, 3, "no history: the fallback items")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Test.lua', 'CRT_Modules/LootMaster/Filter.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
