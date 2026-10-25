// Loot Master through a /reload, a disconnect and a log out and back in, for the whole raid night
// (CRT_Modules/LootMaster/Comm.lua's saved session, Looting.lua's saved Yes and answered prompt, BossLoot.lua's
// list, Resync.lua's catch-up, and Loot History's capture, CRT_Modules/Loot/Capture.lua). Three CRTs in one
// raid, each its own copy of the files and its own CRTDBChar, messages caught and handed to every CRT that is
// online; a /reload or login loads a CRT's files again with only its saved data kept, and it misses every
// message sent while it was away. Covers: the raid leader (the looter) reloading mid-session, a raider
// reloading mid-session (its popup back with its answers), a raider's disconnect and relog within the night
// (the session ended meanwhile), the next day (everything cleared), the leader changing mid-raid, and a
// Loot History record not added twice after a /reload. Usage: node run_lootmaster_persist.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local SRC = ...
local unpack = table.unpack or unpack
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local NOW = 1000
GetTime = function() return NOW end
time = function() return 1790000000 + NOW end -- the clock moves with GetTime
date = os.date
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end

-- the raid: Solex leads and runs loot, Halo and Quick are raiders; ME is whichever CRT is acting now
local ME = "Solex"
local LEADER = "Solex-Sargeras"
local NAMES = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras" }
local NOGROUP = {} -- [name] = true: that CRT doesn't know its group yet (a fresh login)
local OFFLINE = {}
local COMBAT = false
UnitName = function(u)
  if u == "player" then return ME end
  local i = tonumber((u or ""):match("^raid(%d+)$"))
  if i and NAMES[i] then return (NAMES[i]:match("^(.-)%-")) end
end
GetNormalizedRealmName = function() return "Sargeras" end
LE_PARTY_CATEGORY_HOME, LE_PARTY_CATEGORY_INSTANCE = 1, 2
IsInGroup = function(cat) if cat == 2 then return false end return not NOGROUP[ME] end
IsInRaid = function() return not NOGROUP[ME] end
GetNumGroupMembers = function() return NOGROUP[ME] and 0 or #NAMES end
GetNumSubgroupMembers = function() return 0 end
GetRaidRosterInfo = function(i) return not NOGROUP[ME] and NAMES[i] or nil end
UnitIsGroupLeader = function(u)
  if NOGROUP[ME] then return false end
  if u == "player" then return LEADER == ME .. "-Sargeras" end
  local n = UnitName(u)
  return n ~= nil and n .. "-Sargeras" == LEADER
end
UnitIsConnected = function(u) local n = UnitName(u) return n ~= nil and not OFFLINE[n] end
UnitClass = function() return "Paladin", "PALADIN" end
IsInGuild = function() return false end
InCombatLockdown = function() return COMBAT end
local WHERE = { inside = true, kind = "raid", difficulty = 16, id = 2810 }
IsInInstance = function() return WHERE.inside, WHERE.kind end
GetInstanceInfo = function() return "A Raid", WHERE.kind, WHERE.difficulty, "Mythic", 20, 0, false, WHERE.id, 20, nil end
local HERE = "2810-16"
C_Item = { GetItemInfo = function() return nil end, GetDetailedItemLevelInfo = function() return 289 end }
local chat = {} -- award messages posted to the raid: { text, by }
SendChatMessage = function(text, kind) chat[#chat + 1] = { text = text, by = ME, kind = kind } end
local LOCKED = false
local outbox = {}
-- THROTTLE: the game's allowance per prefix, 10 messages coming back at one a second (each CRT its own)
local THROTTLE, allowance = false, {}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return LOCKED end,
  SendAddonMessage = function(_, text, ch, to)
    if THROTTLE then
      local a = allowance[ME] or { n = 10, at = NOW }
      a.n, a.at = math.min(10, a.n + (NOW - a.at)), NOW
      allowance[ME] = a
      if a.n < 1 then return 3 end
      a.n = a.n - 1
    end
    outbox[#outbox + 1] = { text = text, from = ME, to = ch == "WHISPER" and to or nil } return 0 end }

-- the CRTs: each its frames, timers, tickers and saved data
local clients, booting = {}, nil
local function current() return clients[ME] end
function CreateFrame()
  local f = { events = {} }
  f.RegisterEvent = function(me, e) me.events[e] = true end
  f.UnregisterEvent = function(me, e) me.events[e] = nil end
  f.SetScript = function(me, _, fn) me.fn = fn end
  local owner = booting or current()
  owner.frames[#owner.frames + 1] = f
  return f
end
local timers = {}
C_Timer = {
  After = function(s, fn) timers[#timers + 1] = { owner = current(), at = NOW + s, fn = fn } end,
  NewTicker = function(s, fn) local t = { owner = current(), seconds = s, fn = fn } t.Cancel = function(me) me.cancelled = true end
    local c = current() c.tickers[#c.tickers + 1] = t return t end,
}
local function as(p, fn, ...)
  local prevMe, prevDb = ME, CRTDBChar
  ME, CRTDBChar = p.name, p.db
  local r = { fn(...) }
  p.db = CRTDBChar
  ME, CRTDBChar = prevMe, prevDb
  return unpack(r)
end
local function fire(p, event, ...)
  local args = { ... }
  as(p, function()
    for _, f in ipairs(p.frames) do if f.events[event] and f.fn then f.fn(f, event, unpack(args)) end end
  end)
end
-- timers due by now, for CRTs that are still loaded (a /reload drops the old copy's)
local function runTimers()
  local ran = true
  while ran do
    ran = false
    for i, t in ipairs(timers) do
      if t.at <= NOW and clients[t.owner.name] == t.owner and t.owner.online then
        table.remove(timers, i)
        as(t.owner, t.fn)
        ran = true
        break
      end
    end
  end
end
local function tick(p, seconds) for _, t in ipairs(p.tickers) do if not t.cancelled and t.seconds == seconds then as(p, t.fn) end end end
-- hands everything sent to every CRT that is online (the sender too), until nothing is left
local function deliver()
  while #outbox > 0 do
    local box = outbox
    outbox = {}
    for _, m in ipairs(box) do
      for _, name in ipairs({ "Solex", "Halo", "Quick" }) do
        local p = clients[name]
        if p and p.online and (not m.to or m.to == name) then
          fire(p, "CHAT_MSG_ADDON", p.LM.PREFIX, m.text, m.to and "WHISPER" or "RAID", m.from .. "-Sargeras")
        end
      end
    end
  end
end
local function settle() for _ = 1, 6 do NOW = NOW + 2 runTimers() deliver() end end -- 12 seconds go by
local function sentBy(name, kind) local n = 0 for _, m in ipairs(outbox) do if m.from == name and m.text:sub(1, 2) == kind .. "|" then n = n + 1 end end return n end

-- one CRT loads (a login or /reload): its files run again; only db (CRTDBChar) and settings (CRTDB) are kept
local function boot(name, db, settings)
  local old = clients[name]
  if old then old.online = false end
  local p = { name = name, full = name .. "-Sargeras", db = db or {}, frames = {}, tickers = {}, printed = {}, asked = 0, online = true,
    settings = settings or { authority = { leader = true, names = {} }, enableInParty = false } }
  clients[name] = p
  booting = p
  as(p, function()
    local CRT = { db = { lootmaster = p.settings } }
    function CRT:Print(m) p.printed[#p.printed + 1] = m end
    CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
    assert(load(SRC.data, "Data.lua"))("CowfeeRaidTools", CRT)
    local LM = CRT.LootMaster
    function LM:MyRole() return "D" end
    function LM:MyItemLevel() return "285.0" end
    function LM:MyGear() return { { id = 9, ilvl = 276 } } end
    function LM:Filter() return { boss = true, trash = false, quality = 4, ilvl = 0, kinds = {} } end
    LM.FilterFields = function() return { 1, 0, 4, 0, "" } end
    LM.ParseFilterFields = function(f, first) if f[first] == "1" then return { boss = true } end end
    function LM:FilterLoot() return true end
    function LM:ShowWindow() end
    assert(load(SRC.comm, "Comm.lua"))("CowfeeRaidTools", CRT)
    assert(load(SRC.gate, "AutoPass.lua"))("CowfeeRaidTools", CRT)
    assert(load(SRC.looting, "Looting.lua"))("CowfeeRaidTools", CRT)
    LM.AskLooting = function() p.asked = p.asked + 1 end
    assert(load(SRC.boss, "BossLoot.lua"))("CowfeeRaidTools", CRT)
    assert(load(SRC.resync, "Resync.lua"))("CowfeeRaidTools", CRT)
    p.CRT, p.LM = CRT, LM
  end)
  booting = nil
  return p
end
-- a /reload or login: away (missing every message) until login, then PLAYER_LOGIN and the loading screen
local function goAway(p) p.online = false end
local function comeBack(p)
  local q = boot(p.name, p.db, p.settings)
  fire(q, "PLAYER_LOGIN")
  fire(q, "PLAYER_ENTERING_WORLD", true, false)
  return q
end
local function link(id) return "|cffa335ee|Hitem:" .. id .. "::::::::90:102|h[Item " .. id .. "]|h|r" end

local solex, halo, quick = boot("Solex"), boot("Halo"), boot("Quick")
for _, p in ipairs({ solex, halo, quick }) do fire(p, "PLAYER_LOGIN") fire(p, "PLAYER_ENTERING_WORLD", true, false) end
settle()

-- 1. The raid leader answers the prompt, holds boss loot and starts a session -------------------------------
eq(solex.asked, 1, "the leader is asked on entering the raid instance")
as(solex, function() solex.LM:ChooseLooting(true) end)
settle()
eq(as(halo, function() return select(2, halo.LM:LootingStatus()) end), true, "a raider hears it is on")
as(solex, function()
  for i = 1, 4 do solex.LM.BossLoot:AddFromBags(link(1000 + i), 7000) end
  local rows = solex.LM.BossLoot:Rows()
  solex.LM.BossLoot:SetTicked(rows[4].rollID, false) -- kept on the list for later
  solex.LM.BossLoot:Start()
end)
settle()
local s = solex.LM.current
check(s ~= nil and #s.items == 3, "a session with three items")
eq(#solex.LM.BossLoot:Rows(), 1, "one row stays on the boss loot list")
local sid = s.id
check(halo.LM.incoming and halo.LM.incoming.id == sid, "Halo has the session")
as(halo, function() halo.LM:Answer(1, "bis") halo.LM:Answer(2, "up") end)
as(quick, function() quick.LM:Answer(2, "bis") end)
settle()
local haloRoll = s.players["Halo-Sargeras"].answers[1].roll
check(haloRoll ~= nil, "the looter drew Halo's roll")
as(solex, function() solex.LM:Award(1, "Halo-Sargeras", "bis") end)
settle()
eq(#chat, 1, "the award is posted once")

-- 2. The raid leader (the looter) reloads mid-session: Quick answers while it is away ------------------------
goAway(solex)
NOW = NOW + 20
as(quick, function() quick.LM:Answer(3, "up") end)
deliver()
eq(halo.LM.incoming.view.players["Quick-Sargeras"].answers[3].response, "up", "the other raiders saw Quick's answer")
solex = comeBack(solex)
s = solex.LM.current
eq(s and s.id, sid, "leader reload: the session is back")
eq(s.items[1].award and s.items[1].award.name, "Halo-Sargeras", "leader reload: the award is kept")
eq(s.players["Halo-Sargeras"].answers[1].roll, haloRoll, "leader reload: Halo's answer and roll are kept")
eq(s.players["Quick-Sargeras"].answers[3] and s.players["Quick-Sargeras"].answers[3].response, nil, "leader reload: it missed Quick's answer")
eq(#solex.LM.BossLoot:Rows(), 1, "leader reload: the boss loot list is back")
local tl = solex.LM.BossLoot.TradeLeft(solex.LM.BossLoot:Rows()[1])
check(tl ~= nil and tl > 6900 and tl <= 7000, "leader reload: with its trade time (" .. tostring(tl) .. ")")
eq(solex.LM:LootingOn(), true, "leader reload: CRT Looting is back on")
eq(solex.asked, 0, "leader reload: not asked again")
eq(solex.LM.BossLoot:WaitingCount(), 0, "leader reload: nothing waits")
eq(sentBy("Solex", "S"), 0, "leader reload: no second session is started")
settle()
eq(#chat, 1, "leader reload: the award isn't posted again")
eq(s.players["Quick-Sargeras"].answers[3] and s.players["Quick-Sargeras"].answers[3].response, "up", "leader reload: Quick sent its missed answer again")
check(s.players["Quick-Sargeras"].answers[3].roll ~= nil, "leader reload: and it has a roll")
eq(s.players["Halo-Sargeras"].answers[1].roll, haloRoll, "leader reload: Halo's roll isn't drawn again")
eq(s.players["Quick-Sargeras"].answers[2].response, "bis", "leader reload: Quick's earlier answer is unchanged")

-- 3. A raider reloads mid-session: the popup back with its answers, and what it missed ---------------------
local inc = halo.LM.incoming
local shownBefore = inc.items[2].shownAt
goAway(halo)
NOW = NOW + 15
as(solex, function() solex.LM:Award(2, "Quick-Sargeras", "bis") end)
deliver()
halo = comeBack(halo)
inc = halo.LM.incoming
eq(inc and inc.id, sid, "raider reload: the session is back")
eq(inc.mine[1] and inc.mine[1].response, "bis", "raider reload: its answer for item 1")
eq(inc.mine[1].closed, true, "raider reload: item 1 was given out: closed")
eq(inc.mine[2] and inc.mine[2].response, "up", "raider reload: its answer for item 2")
check(inc.items[2].shownAt <= shownBefore + 0.5, "raider reload: an answered item keeps the time it had left")
eq(inc.items[3].shownAt, NOW, "raider reload: an item it hasn't answered gets a fresh timer")
eq(inc.items[2].award, nil, "raider reload: it missed item 2's award")
settle()
eq(inc.items[2].award and inc.items[2].award.name, "Quick-Sargeras", "raider reload: the looter's catch-up gives item 2's award")
eq(inc.mine[2].closed, true, "raider reload: item 2 is closed now")
eq(inc.mine[1].roll, haloRoll, "raider reload: its roll")
eq(inc.view.players["Quick-Sargeras"].answers[3].response, "up", "raider reload: everyone's answers on the raider window")
eq(select(2, as(halo, function() return halo.LM:LootingStatus() end)), true, "raider reload: CRT Looting heard on again at once")
check(halo.LM.authority ~= nil and halo.LM.authority.from == "Solex-Sargeras", "raider reload: the leader's authority list")
eq(#chat, 2, "raider reload: no award posted twice")
-- the raider's answers are never sent twice: the looter had them
local rFromHalo = 0
-- a second ask within RESYNC_SECONDS: not asked again
goAway(halo)
halo = comeBack(halo)
eq(sentBy("Halo", "V"), 1, "a second reload asks again")
deliver()
NOW = NOW + 2
runTimers()
eq(sentBy("Solex", "C"), 1, "the looter answers once")
local whisper = true
for _, m in ipairs(outbox) do if m.from == "Solex" and (m.text:sub(1, 2) == "D|" or m.text:sub(1, 2) == "C|") and m.to ~= "Halo" then whisper = false end end
check(whisper, "the answer is whispered to the raider who asked, not sent to the raid")
for _, m in ipairs(outbox) do if m.from == "Halo" and m.text:sub(1, 2) == "R|" then rFromHalo = rFromHalo + 1 end end
deliver()
for _, m in ipairs(outbox) do if m.from == "Halo" and m.text:sub(1, 2) == "R|" then rFromHalo = rFromHalo + 1 end end
eq(rFromHalo, 0, "a raider sends no answer again that the looter has")
settle()

-- failure paths: D and C from someone who isn't the looter; a C whose count doesn't match
local function inject(text, from, to) outbox[#outbox + 1] = { text = text, from = from, to = to } end
inject("D|" .. sid .. ":901|w,3,Quick-Sargeras,bis", "Quick")
inject("C|" .. sid .. "|901|1|" .. halo.LM.VERSION, "Quick")
deliver()
eq(halo.LM.incoming.items[3].award, nil, "a D from a raider who isn't the looter changes nothing")
halo.LM.incoming.mine[3] = { response = "minor" } -- an answer the looter doesn't have
local againR, realAgain = {}, halo.LM.SendAnswerAgain
halo.LM.SendAnswerAgain = function(i) againR[#againR + 1] = i return realAgain(i) end
inject("D|" .. sid .. ":902|a,1,Halo-Sargeras,bis," .. haloRoll, "Solex", "Halo")
inject("C|" .. sid .. "|902|3|" .. halo.LM.VERSION, "Solex", "Halo")
deliver()
eq(#againR, 0, "a C whose count doesn't match: no answer sent again")
inject("D|" .. sid .. ":903|a,1,Halo-Sargeras,bis," .. haloRoll, "Solex", "Halo")
inject("C|" .. sid .. "|903|1|" .. halo.LM.VERSION, "Solex", "Halo")
deliver()
halo.LM.SendAnswerAgain = realAgain
eq(table.concat(againR, ","), "3", "a matching C: only the missing answer is sent again, once")
settle()
eq(s.players["Halo-Sargeras"].answers[3] and s.players["Halo-Sargeras"].answers[3].response, "minor", "and the looter has it")
-- a changed answer in the digest keeps the raider window's note and gear
local va = halo.LM.incoming.view.players["Quick-Sargeras"].answers[2]
va.note, va.gear = "4pc", { { id = 7, ilvl = 280 } }
inject("D|" .. sid .. ":904|a,2,Quick-Sargeras,up,55", "Solex", "Halo")
inject("C|" .. sid .. "|904|1|" .. halo.LM.VERSION, "Solex", "Halo")
deliver()
eq(va.response, "up", "digest: the changed answer")
eq(va.note, "4pc", "digest: the note is kept")
eq(#va.gear, 1, "digest: the gear is kept")
eq(va.roll, 55, "digest: the looter's roll")
-- a bad session id in an ask is ignored
outbox = {}
inject("V|" .. halo.LM.VERSION .. "|not-an-id|Solex-Sargeras|", "Halo")
deliver()
NOW = NOW + 20
runTimers()
eq(sentBy("Solex", "E"), 0, "an ask with a bad session id: no end sent")
settle()

-- 4. Nothing in combat: the ask waits for combat to end ----------------------------------------------------
goAway(quick)
COMBAT = true
quick = comeBack(quick)
NOW = NOW + 30
runTimers()
eq(sentBy("Quick", "V"), 0, "in combat: nothing asked")
COMBAT = false
fire(quick, "PLAYER_REGEN_ENABLED")
eq(sentBy("Quick", "V"), 1, "after combat: asked")
settle()

-- 5. A raider disconnects and logs back in within the night; the session ended meanwhile -------------------
goAway(quick)
OFFLINE.Quick = true
NOW = NOW + 1800
as(solex, function() solex.LM:End() end)
deliver()
eq(halo.LM.incoming, nil, "end: the raiders online close it")
OFFLINE.Quick = nil
NOGROUP.Quick = true -- a fresh login: its group isn't known at PLAYER_LOGIN
quick = boot("Quick", quick.db, quick.settings)
fire(quick, "PLAYER_LOGIN")
fire(quick, "PLAYER_ENTERING_WORLD", true, false)
eq(quick.LM.incoming, nil, "relog: waits for its group")
check(quick.db.lootSession ~= nil, "relog: the saved session is kept while it waits")
NOW = NOW + 6
runTimers()
check(quick.db.lootSession ~= nil, "relog: still kept after the 5 second wait")
eq(quick.LM.RestorePending(), true, "relog: and still waiting for the group")
NOGROUP.Quick = nil
fire(quick, "GROUP_ROSTER_UPDATE")
check(quick.LM.incoming ~= nil and quick.LM.incoming.id == sid, "relog: the group is known, the saved session is back")
settle()
eq(quick.LM.incoming, nil, "relog: the looter says it ended: closed")
eq(quick.db.lootSession, nil, "relog: nothing left to restore")

-- 6. A fresh login with boss loot waiting behind a session: nothing starts before the saved session is back --
as(solex, function()
  solex.LM.BossLoot:SetTicked(solex.LM.BossLoot:Rows()[1].rollID, true)
  solex.LM.BossLoot:Start()
end)
settle()
local s2 = solex.LM.current
check(s2 ~= nil and s2.id ~= sid, "a second session from the held row")
as(solex, function() solex.LM.BossLoot:AddFromBags(link(2001), 7000) solex.LM.BossLoot:Start() end)
eq(solex.LM.BossLoot:WaitingCount(), 1, "a row waits behind it")
goAway(solex)
NOGROUP.Solex = true
solex = boot("Solex", solex.db, solex.settings)
fire(solex, "PLAYER_LOGIN")
fire(solex, "PLAYER_ENTERING_WORLD", true, false)
eq(solex.LM.current, nil, "fresh login: the session waits for the group")
eq(solex.LM.BossLoot:WaitingCount(), 1, "fresh login: the waiting row doesn't start a session alone")
eq(sentBy("Solex", "S"), 0, "fresh login: nothing started")
NOGROUP.Solex = nil
fire(solex, "GROUP_ROSTER_UPDATE")
eq(solex.LM.current and solex.LM.current.id, s2.id, "fresh login: the session is back once the group is known")
eq(solex.LM.BossLoot:WaitingCount(), 1, "fresh login: the row still waits for its turn")
settle()

-- an old raid's popup isn't brought back when its looter isn't in your group
goAway(quick)
quick.db.lootSession = { savedAt = time(), current = nil, incoming = { id = "abc123", leader = "Gone-Sargeras", items = { { itemString = "item:1" } },
  mine = {}, responses = {}, test = false } }
quick = comeBack(quick)
eq(quick.LM.incoming, nil, "a looter not in your group: no popup")
eq(quick.db.lootSession, nil, "a looter not in your group: the save is dropped")
settle()
-- an ask while the looter's own saved session isn't back yet is ignored: no end sent
local sentKinds = {}
local realSend = solex.LM.SendText
solex.LM.SendText = function(text, done, to) sentKinds[#sentKinds + 1] = text:sub(1, 1) return realSend(text, done, to) end
local realPending = solex.LM.RestorePending
solex.LM.RestorePending = function() return true end
fire(solex, "CHAT_MSG_ADDON", solex.LM.PREFIX, "V|" .. solex.LM.VERSION .. "|abc124|Solex-Sargeras|", "RAID", "Quick-Sargeras")
NOW = NOW + 20
runTimers()
solex.LM.RestorePending = realPending
local anyE = false
for _, k in ipairs(sentKinds) do if k == "E" then anyE = true end end
eq(anyE, false, "an ask during a pending restore: no end sent")
-- three asks 5 seconds apart with the game's allowance: one answer in flight at a time, an award not starved
THROTTLE = true
local inFlight, most, answers = 0, 0, 0
solex.LM.SendText = function(text, done, to)
  if text:sub(1, 2) == "C|" then
    inFlight = inFlight + 1
    answers = answers + 1
    most = math.max(most, inFlight)
    local d = done
    done = function(...) inFlight = inFlight - 1 if d then return d(...) end end
  end
  return realSend(text, done, to)
end
-- the queue is backed up (20 messages: two seconds of them for every ask below), then three asks 5 s apart
for i = 1, 20 do as(solex, function() solex.LM.SendText("X|filler" .. i) end) end
local cBeforeA, awardAt, t = 0, nil, 0
local function step()
  NOW = NOW + 1
  t = t + 1
  runTimers()
  for _, m in ipairs(outbox) do
    if m.from == "Solex" and m.text:sub(1, 2) == "C|" and not awardAt then cBeforeA = cBeforeA + 1 end
    if m.from == "Solex" and m.text:sub(1, 2) == "A|" then awardAt = awardAt or t end
  end
  deliver()
end
for n, who in ipairs({ "Halo", "Quick", "Halo" }) do
  fire(solex, "CHAT_MSG_ADDON", solex.LM.PREFIX, "V|" .. solex.LM.VERSION .. "|" .. s2.id .. "|Solex-Sargeras|", "RAID", who .. "-Sargeras")
  if n == 2 then as(solex, function() solex.LM:Award(1, "Quick-Sargeras", "bis") end) end
  for _ = 1, 5 do step() end
end
for _ = 1, 40 do step() end
check(answers >= 2, "throttled: the asks are answered (" .. answers .. ")")
check(most <= 1, "throttled: at most one answer in flight (" .. most .. ")")
check(awardAt ~= nil, "throttled: the award goes out")
check(cBeforeA <= 1, "throttled: at most one answer ahead of the award (" .. cBeforeA .. ")")
THROTTLE = false
solex.LM.SendText = realSend
settle()

-- 7. The next day: everything clears ----------------------------------------------------------------------
goAway(halo)
WHERE.inside, WHERE.kind = false, "none"
NOW = NOW + LM_HOURS
`;
// LM_HOURS is set below from the file (6 hours and a second)
const tail = `
halo = comeBack(halo)
eq(halo.LM.incoming, nil, "next day: no session")
eq(halo.db.lootSession, nil, "next day: the saved session is cleared")
eq(halo.db.lootmaster and halo.db.lootmaster.heardAuthority, nil, "next day: the authority list is cleared")
goAway(solex)
solex = comeBack(solex)
eq(solex.LM.current, nil, "next day: the looter has no session")
eq(solex.LM:LootingOn(), false, "next day: CRT Looting is off")
eq(solex.db.lootmaster.looting, nil, "next day: its saved Yes is cleared")
WHERE.inside, WHERE.kind = true, "raid"
for _, p in ipairs({ solex, halo, quick }) do fire(p, "PLAYER_ENTERING_WORLD", false, false) end
eq(solex.asked, 1, "next day: asked again in the instance")
settle()
-- No is an answer too: a /reload doesn't ask again
as(solex, function() solex.LM:ChooseLooting(false, "no") end)
settle()
goAway(solex)
solex = comeBack(solex)
settle()
eq(solex.asked, 0, "said No, then reload: not asked again")
eq(solex.LM:LootingOn(), false, "said No, then reload: still off")

-- 8. The leader changes mid-raid -------------------------------------------------------------------------
as(solex, function() solex.LM:ChooseLooting(true) end)
settle()
as(solex, function() solex.LM.BossLoot:AddFromBags(link(3001), 7000) solex.LM.BossLoot:Start() end)
settle()
local s3 = solex.LM.current
check(s3 ~= nil, "a session before the lead moves")
LEADER = "Halo-Sargeras"
for _, p in ipairs({ solex, halo, quick }) do fire(p, "PARTY_LEADER_CHANGED") end
settle()
eq(solex.LM:LootingOn(), false, "lead moved: the old leader's CRT Looting is off")
eq(solex.db.lootmaster.looting, nil, "lead moved: its saved Yes is cleared")
eq(halo.asked, 1, "lead moved: the new leader is asked")
as(halo, function() halo.LM:ChooseLooting(true) end)
settle()
goAway(halo)
halo = comeBack(halo)
settle()
eq(halo.LM:LootingOn(), true, "new leader reload: back on")
eq(halo.asked, 0, "new leader reload: not asked again")
check(halo.LM.incoming ~= nil and halo.LM.incoming.id == s3.id, "new leader reload: the old leader's session is still on its popup")
goAway(quick)
quick.db.lootmaster.heardAuthority.from = "Solex-Sargeras" -- as if it was last heard from the old leader
quick = comeBack(quick)
eq(quick.LM.authority and quick.LM.authority.from, "Solex-Sargeras", "raider reload after the lead moved: its kept list is the old leader's")
eq(as(quick, function() return quick.LM.Allowed("Solex-Sargeras") end), false, "and it counts for nothing: Solex no longer leads")
settle()
check(quick.LM.incoming ~= nil and quick.LM.incoming.id == s3.id, "raider reload after the lead moved: the session is back")
eq(quick.LM.authority and quick.LM.authority.from, "Halo-Sargeras", "raider reload after the lead moved: the new leader's list")
eq(select(2, as(quick, function() return quick.LM:LootingStatus() end)), true, "raider reload after the lead moved: CRT Looting heard from the new leader")

-- 9. Loot History: a record its item made before a /reload is updated by the roll result after it -----------
local function loadLoot()
  local fake = { name = "Solex", db = {}, frames = {}, tickers = {}, online = true }
  booting = fake
  local CRT = { db = { loot = { minQuality = 4 } } }
  assert(load(SRC.store, "Store.lua"))("CowfeeRaidTools", CRT)
  assert(load(SRC.capture, "Capture.lua"))("CowfeeRaidTools", CRT)
  booting = nil
  fire(fake, "ADDON_LOADED", "CowfeeRaidTools")
  fire(fake, "PLAYER_LOGIN")
  return fake, CRT.Loot
end
Item = { CreateFromItemLink = function() return { IsItemEmpty = function() return false end,
  ContinueOnItemLoad = function(_, fn) fn() end, GetItemQuality = function() return 4 end } end }
GetNumClasses = function() return 0 end
local item = link(5001)
C_LootHistory = { GetSortedDropsForEncounter = function() return { { lootListID = 7, itemHyperlink = item,
  winner = { playerName = "Halo", playerClass = "PALADIN" }, rollInfos = {} } } end }
local lootClient, Loot = loadLoot()
fire(lootClient, "ENCOUNTER_LOOT_RECEIVED", 3129, 5001, item, 1, "Halo", "PALADIN")
eq(Loot:Count(), 1, "loot history: the item is recorded")
NOW = NOW + 30
lootClient, Loot = loadLoot() -- a /reload: CRTLootDB is kept, nothing in memory
fire(lootClient, "LOOT_HISTORY_UPDATE_DROP", 3129, 7)
eq(Loot:Count(), 1, "loot history: the roll result after a /reload updates the record, not a second one")
local rec
Loot:Each(function(r) rec = r end)
eq(rec and rec[Loot.R.LIST], 7, "loot history: the record has its loot list now")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
const read = f => { const p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'; };
const src = { data: 'CRT_Modules/LootMaster/Data.lua', comm: 'CRT_Modules/LootMaster/Comm.lua', gate: 'CRT_Modules/LootMaster/AutoPass.lua',
  looting: 'CRT_Modules/LootMaster/Looting.lua', boss: 'CRT_Modules/LootMaster/BossLoot.lua', resync: 'CRT_Modules/LootMaster/Resync.lua',
  store: 'CRT_Modules/Loot/Store.lua', capture: 'CRT_Modules/Loot/Capture.lua' };
const code = harness.replace('NOW = NOW + LM_HOURS', 'NOW = NOW + 6 * 3600 + 1') + tail;
if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_newtable(L);
for (const k of Object.keys(src)) { lua.lua_pushstring(L, to_luastring(read(src[k]))); lua.lua_setfield(L, -2, to_luastring(k)); }
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
