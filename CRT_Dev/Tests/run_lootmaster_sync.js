// CRT_Modules/LootMaster/Sync.lua: the raid leader's Sync Master Loot. One Lua state plays every client in turn (who
// you are and your saved settings are swapped), with the messages caught and delivered by hand: an older
// client drops the new message kind, the round trip, who may send and who takes it, bad values cleaned,
// the split into messages that fit, the "who has CRT" ask and the status line. The loot filter's F part:
// its round trip, an older leader's sync without it, bad values cleaned, and a 0.27 receiver (old_Sync.lua,
// Sync.lua as it was before the F part) taking a new sync without an error.
// Usage: node run_lootmaster_sync.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, commSrc, syncSrc, filterSrc, oldSyncSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local NOW = 100
GetTime = function() return NOW end
time = function() return 1790000000 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
local ME = "Solex"
local GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras", "Arrow-Kazzak" }, leader = "Solex-Sargeras" }
UnitName = function(u)
  if u == "player" then return ME end
  local i = tonumber((u or ""):match("^raid(%d+)$"))
  if GROUP and i and GROUP.names[i] then local n, r = GROUP.names[i]:match("^(.-)%-(.*)$") return n, r ~= "Sargeras" and r or nil end
end
GetNormalizedRealmName = function() return "Sargeras" end
IsInGroup = function() return GROUP ~= nil end
IsInRaid = function() return GROUP ~= nil end
GetNumGroupMembers = function() return GROUP and #GROUP.names or 0 end
GetNumSubgroupMembers = function() return 0 end
GetRaidRosterInfo = function(i) return GROUP and GROUP.names[i] end
UnitIsGroupLeader = function(u)
  if not GROUP then return false end
  if u == "player" then return GROUP.leader == ME .. "-Sargeras" end
  local n, r = UnitName(u)
  return n and ((r and (n .. "-" .. r)) or (n .. "-Sargeras")) == GROUP.leader
end
UnitClass = function() return "Paladin", "PALADIN" end
C_Item = { GetItemInfo = function() return nil end }
-- where the receiver can post: a guild whose rank may speak in Guild and Officer, the channel Loot, one guild channel
local PLACES = { guild = true, guildSpeak = true, officer = true, channels = { Loot = 3 } }
IsInGuild = function() return PLACES.guild end
GetGuildInfo = function(u) if PLACES.guild then return "Cowfee", "Officer", 1 end end
C_GuildInfo = {
  CanSpeakInGuildChat = function() return PLACES.guildSpeak end,
  GuildControlGetRankFlags = function(order) if order ~= 2 then error("rank order " .. tostring(order)) end return { true, true, true, PLACES.officer } end,
}
GetChannelName = function(name) return PLACES.channels[name] or 0 end
C_Club = { GetGuildClubId = function() return PLACES.guild and 77 or nil end,
  GetStreams = function(club) return { { streamId = 5, name = "Loot council", streamType = 4 } } end }
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers+1] = fn end, NewTicker = function(s, fn) return { Cancel = function() end } end }
local function runTimers() local t = timers timers = {} for _, fn in ipairs(t) do fn() end end
local outbox, result = {}, 0
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function(p, text, ch) if result ~= 0 then return result end outbox[#outbox+1] = text return 0 end }
local onEvent
-- each file's event frame gets the events it registered, as in the game
local frames = {}
onEvent = function(self, event, ...) for _, f in ipairs(frames) do if f.events[event] and f.fn then f.fn(self, event, ...) end end end
function CreateFrame()
  local f = { events = {} }
  f.RegisterEvent = function(me, e) me.events[e] = true end
  f.SetScript = function(me, _, fn) me.fn = fn end
  frames[#frames + 1] = f
  return f
end
local printed = {}
CRTDBChar = {}
-- each player's saved Loot Master settings, swapped in as CRT.db.lootmaster
local function settings()
  return { window = { point = "CENTER", x = 1 }, popup = { x = 2 }, answers = { x = 3 }, responseSeconds = 60,
    score = { show = true, late = 5, per10 = 1, noShow = 15, recover = 5, weeks = 8 },
    awardMessage = "%i awarded to %p for %r with a %v roll.", awardChannel = "RAID", noRoll = "-",
    showAllItems = false, authority = { leader = true, names = {} }, sort = { scoreKey = "name" } }
end
local DB = { Solex = settings(), Halo = settings(), Quick = settings(), Arrow = settings() }
local CRT = { db = { lootmaster = DB.Solex } }
-- CRT_Core/Core.lua's loot filter defaults (run_lootmaster_filter.js checks CRT_Core/Core.lua's own)
CRT.defaults = { lootmaster = { filter = { boss = true, trash = false, quality = 4, ilvl = 0,
  kinds = { bop = true, tier = true, boe = false, wue = false, toy = false, mount = false, cosmetic = false, other = false } } } }
local function be(name) ME = name CRT.db.lootmaster = DB[name] end
function CRT:Print(m) printed[#printed+1] = m end
CRT.Groups = { Normalize = function(n) n = strtrim(n) if n == "" then return "" end if not n:find("-") then return n .. "-Sargeras" end return n end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(filterSrc, "Filter.lua"))("CowfeeRaidTools", CRT)
local scoreChanged = 0
LM.ScoreChanged = function() scoreChanged = scoreChanged + 1 end
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
local function msg(text, sender) onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, text, "RAID", sender) end
local function deliver(box, sender) for _, text in ipairs(box) do msg(text, sender) end end
local function take() local box = outbox outbox = {} return box end

-- 1. An older client (no Sync.lua): every M message, and any other unknown kind, is dropped without an error
be("Halo")
local before = fails
msg("M|abc12:H|0.26.0|1|1|0|0|90|OFFICER|no|9|2|20|6|10|1", "Solex-Sargeras")
msg("M|abc12:B|1,pass,888888,0,,Pass", "Solex-Sargeras")
msg("M|abc12:N|1,Halo-Sargeras", "Solex-Sargeras")
msg("Z|anything|at|all", "Solex-Sargeras")
msg("M", "Solex-Sargeras")
eq(fails, before, "old client: unknown kinds raise no error")
eq(DB.Halo.responseSeconds, 60, "old client: nothing changed")
eq(#outbox, 0, "old client: nothing answered")

assert(load(syncSrc, "Sync.lua"))("CowfeeRaidTools", CRT)

-- the leader's settings: 8 buttons with the longest labels (12 letters, in a multibyte script), a long award message in a multibyte script, every other synced field changed
be("Solex")
local S = DB.Solex
S.responses = {}
for i = 1, 7 do S.responses[i] = { key = "k" .. i, label = string.rep("\\208\\159", 11) .. i, color = { 0.1 * i, 0.5, 1 }, weight = 100 - i * 10, icon = i == 1 and "need" or nil } end
S.responses[8] = { key = "pass", label = "Transmog", color = { 0.5, 0.5, 0.5 }, weight = 0 }
S.responseSeconds = 95
S.awardMessage = string.rep("\\208\\159", 150) .. " %i to %p, %r; %v"
S.awardChannel = "OFFICER"
S.noRoll = "no"
S.score = { show = false, late = 9, per10 = 2, noShow = 20, recover = 6, weeks = 12 }
S.authority = { leader = false, names = { "Halo-Sargeras", "Gone-Sargeras" } }
S.filter = { boss = true, trash = true, quality = 3, ilvl = 245,
  kinds = { bop = false, tier = true, boe = true, wue = true, toy = true, mount = false, cosmetic = true, other = false } }

-- 2. Who has CRT: the leader asks, raiders with this version answer
eq(LM:SyncPing(), true, "ping: the leader asks")
eq(LM:SyncPing(), false, "ping: not again so soon")
local ping = take()
eq(#ping, 1, "ping: one message")
for _, name in ipairs({ "Halo", "Quick" }) do
  be(name)
  deliver(ping, "Solex-Sargeras")
  be("Solex")
  deliver(take(), name .. "-Sargeras")
end
local targets = LM:SyncTargets()
eq(#targets, 2, "ping: two group members with CRT")
eq(targets[1], "Halo-Sargeras", "ping: sorted by name")
eq(targets[2], "Quick-Sargeras", "ping: Quick too")
be("Arrow")
deliver(ping, "Quick-Sargeras")
eq(#outbox, 0, "ping: not answered when it isn't from the raid leader")
be("Solex")

-- 3. Sending: the picked player plus the authority list names in the group
local status = LM:SyncTo("Quick")
check(status ~= nil, "send: the leader can sync")
local box = take()
check(#box >= 5, "send: split into several messages (" .. #box .. ")")
local buttonsMsgs = 0
for _, text in ipairs(box) do
  check(#text <= 255, "send: every message fits 255 bytes (" .. #text .. ")")
  check(text:sub(1, 2) == "M|", "send: every message is the one new kind")
  if text:find("^M|[%w]+:B|") then buttonsMsgs = buttonsMsgs + 1 end
end
check(buttonsMsgs >= 2, "send: the buttons are split like a session's (" .. buttonsMsgs .. ")")
local out = LM.syncOut
eq(out and #out.sent, 2, "send: two players in the group")
eq(out.sent[1], "Quick-Sargeras", "send: the picked player first")
eq(out.sent[2], "Halo-Sargeras", "send: then the authority list")
eq(out.missing[1], "Gone-Sargeras", "send: a name not in the group isn't reached")
check(LM:SyncStatus():find("Sending", 1, true) ~= nil, "status: sending while waiting: " .. LM:SyncStatus())

-- 4. Halo, on the leader's list: takes it, every field the same, own window places and sort kept
be("Halo")
printed = {}
local scoreBefore = scoreChanged
deliver(box, "Solex-Sargeras")
local H = DB.Halo
eq(#H.responses, 8, "round trip: 8 buttons")
eq(H.responses[1].label, string.rep("\\208\\159", 11) .. "1", "round trip: a 12 letter label in another script, whole")
eq(H.responses[1].icon, "need", "round trip: the icon")
eq(H.responses[3].weight, 70, "round trip: weights")
eq(string.format("%.1f", H.responses[2].color[1]), "0.2", "round trip: colours")
eq(H.responses[8].key, "pass", "round trip: Pass last")
eq(H.responses[8].label, "Transmog", "round trip: a renamed Pass")
eq(H.responseSeconds, 95, "round trip: time to answer")
eq(H.awardMessage, S.awardMessage, "round trip: the long award message, joined from its pieces, commas and all")
eq(H.awardChannel, "OFFICER", "round trip: Send to")
eq(H.noRoll, "no", "round trip: no-roll text")
for _, k in ipairs({ "late", "per10", "noShow", "recover", "weeks" }) do eq(H.score[k], S.score[k], "round trip: score " .. k) end
eq(H.score.show, true, "never synced: the Score column switch")
eq(H.authority.leader, false, "round trip: the leader flag")
eq(H.authority.names[1], "Halo-Sargeras", "round trip: authority names")
eq(H.authority.names[2], "Gone-Sargeras", "round trip: names not in the group stay on the list")
eq(H.window.point, "CENTER", "never synced: window place")
eq(H.popup.x, 2, "never synced: popup place")
eq(H.answers.x, 3, "never synced: the raider window's place")
eq(H.sort.scoreKey, "name", "never synced: sort")
eq(H.showAllItems, false, "never synced: showAllItems")
check(H.filter ~= nil and H.filter ~= S.filter, "round trip: the loot filter, a copy")
eq(H.filter and H.filter.trash, true, "round trip: filter trash loot")
eq(H.filter and H.filter.boss, true, "round trip: filter boss loot")
eq(H.filter and H.filter.quality, 3, "round trip: filter quality")
eq(H.filter and H.filter.ilvl, 245, "round trip: filter item level")
for k, v in pairs(S.filter.kinds) do eq(H.filter and H.filter.kinds[k], v, "round trip: filter kind " .. k) end
local fParts = 0
for _, text in ipairs(box) do if text:find("^M|[%w]+:F|") then fParts = fParts + 1 end end
eq(fParts, 1, "send: one F part")
check(H.responses ~= S.responses and H.score ~= S.score, "round trip: copies, not the leader's tables")
eq(printed[1], "Loot Master settings synced from Solex.", "round trip: told who synced it")
eq(scoreChanged, scoreBefore + 1, "round trip: Raider Score worked out again")
local ack = take()
eq(#ack, 1, "round trip: one answer back")
eq(ack[1]:match("^M|[%w]+:K|(.*)$"), LM.VERSION, "round trip: the answer carries the version")
eq(LM.VERSION, "0.31.0", "this version is 0.31.0")
check(LM.VersionAtLeast(LM.VERSION, LM.FILTER_SYNC_SINCE), "this version takes the loot filter in a sync")

-- 5. Quick, the picked player, isn't on the list: takes it too
be("Quick")
deliver(box, "Solex-Sargeras")
eq(DB.Quick.responseSeconds, 95, "picked player: takes it though not on the list")
local ackQ = take()

-- 6. Arrow, in the group but not named: refuses
be("Arrow")
printed = {}
deliver(box, "Solex-Sargeras")
eq(DB.Arrow.responseSeconds, 60, "not named: refused")
eq(#printed, 0, "not named: nothing said")
eq(#outbox, 0, "not named: no answer")

-- 7. The status after the wait: Halo and Quick answered; Gone wasn't in the group
be("Solex")
deliver(ack, "Halo-Sargeras")
deliver(ackQ, "Quick-Sargeras")
printed = {}
runTimers()
eq(LM:SyncStatus(), "Synced to 2 players: Quick, Halo.\\nNot reached: Gone.", "status: synced and not reached")
eq(printed[1], "Loot Master: Synced to 2 players: Quick, Halo. Not reached: Gone.", "status: printed too")
-- a named player in the group who never answers (no CRT, or an older one) isn't reached
LM:SyncTo("Arrow-Kazzak")
take()
deliver({ "M|" .. LM.syncOut.id .. ":K|0.28.0" }, "Halo-Sargeras")
runTimers()
eq(LM:SyncStatus(), "Synced to 1 player: Halo.\\nNot reached: Arrow, Gone.", "status: no answer is not reached")
-- a typed name that isn't in the group
S.authority.names = {}
LM:SyncTo("Nobody")
take()
runTimers()
eq(LM:SyncStatus(), "Not synced to anyone.\\nNot reached: Nobody.", "status: nobody in the group to sync")
S.authority.names = { "Halo-Sargeras", "Gone-Sargeras" }

-- 8. Refused from someone who isn't the raid leader (Quick sends Solex's messages as their own)
be("Halo")
DB.Halo = settings()
be("Halo")
deliver(box, "Quick-Sargeras")
eq(DB.Halo.responseSeconds, 60, "non-leader: refused")
-- and after the lead moves, the old leader's sync is refused
GROUP.leader = "Quick-Sargeras"
deliver(box, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 60, "old leader: refused")
GROUP.leader = "Solex-Sargeras"
take()
-- a non-leader can't send one
be("Halo")
eq(LM:SyncTo("Quick"), nil, "non-leader: can't sync")
eq(#outbox, 0, "non-leader: nothing sent")
eq(LM:SyncPing(), false, "non-leader: doesn't ask")
GROUP = nil
be("Solex")
eq(LM:SyncTo("Quick"), nil, "out of a group: can't sync")
GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras", "Arrow-Kazzak" }, leader = "Solex-Sargeras" }

-- 9. Bad values are cleaned with the Settings tab's own rules
be("Halo")
printed = {}
deliver({
  "M|bad01:H|0.99.0|1|3|8|0|999|BOGUS|maybe|500|-4|abc|7.4|0|1",
  "M|bad01:N|1,Halo-Sargeras",
  "M|bad01:B|1,up,zzzzzz,500,nosuchicon,An extremely long label here;2,up,ffffff,5,,Dupe;3,x,ffffff,9,,X",
  "M|bad01:A|1,Halo;2,halo-sargeras;3,A;4,B;5,C;6,D;7,E;8,F",
}, "Solex-Sargeras")
H = DB.Halo
eq(H.responseSeconds, 180, "clean: time to answer at most 180")
eq(H.awardChannel, "RAID", "clean: an unknown Send to is Raid")
eq(H.noRoll, "-", "clean: an unknown no-roll text is -")
eq(H.score.late, 30, "clean: late at most 30")
eq(H.score.per10, 0, "clean: per 10 min at least 0")
eq(H.score.noShow, 15, "clean: not a number keeps your own")
eq(H.score.recover, 7, "clean: whole points")
eq(H.score.weeks, 1, "clean: weeks at least 1")
eq(H.awardMessage, LM.AWARD_DEFAULT, "clean: no award message is the default")
eq(H.responses[1].weight, 100, "clean: weight at most 100")
eq(H.responses[1].icon, nil, "clean: an unknown icon is dropped")
eq(#H.responses[1].label, LM.LABEL_MAX, "clean: label cut to 12")
eq(H.responses[2].key, "x", "clean: a repeated key is dropped")
eq(H.responses[#H.responses].key, "pass", "clean: Pass added last")
eq(#H.authority.names, LM.AUTHORITY_MAX, "clean: at most 6 names, a repeat dropped")
eq(H.authority.names[2], "A-Sargeras", "clean: names get their realm")
eq(H.authority.leader, true, "clean: leader flag")
-- a header promising more than the limits never completes, and nothing changes
DB.Halo = settings()
be("Halo")
deliver({ "M|bad02:H|0.99.0|1|999|0|0|90|RAID|-|5|1|15|5|8|1", "M|bad02:N|1,Halo-Sargeras", "M|bad02:B|1,a,ffffff,1,,A" }, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 60, "clean: a header promising too many parts never completes")
-- more buttons than fit: cut to 8, Pass last
deliver({ "M|bad03:H|0.99.0|1|9|0|0|90|RAID|-|5|1|15|5|8|1", "M|bad03:N|1,Halo-Sargeras",
  "M|bad03:B|1,a,ffffff,1,,A;2,b,ffffff,1,,B;3,c,ffffff,1,,C;4,d,ffffff,1,,D;5,e,ffffff,1,,E;6,f,ffffff,1,,F;7,g,ffffff,1,,G;8,h,ffffff,1,,H;9,i,ffffff,1,,I" }, "Solex-Sargeras")
eq(#DB.Halo.responses, LM.MAX_RESPONSES, "clean: 9 buttons cut to 8")
eq(DB.Halo.responses[LM.MAX_RESPONSES].key, "pass", "clean: with Pass last")
-- the parts in any order still apply once all are in
deliver({ "M|ord01:N|1,Halo-Sargeras", "M|ord01:T|2|world", "M|ord01:B|1,pass,888888,0,,Pass", "M|ord01:T|1|hello ", "M|ord01:H|0.99.0|1|1|0|2|40|SELF|0|5|1|15|5|8|1" }, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 40, "order: applied once every part is in")
eq(DB.Halo.awardMessage, "hello world", "order: pieces joined by their number")
eq(#DB.Halo.authority.names, 0, "order: an empty list empties yours")
eq(DB.Halo.filter, nil, "an older leader's sync (no F count in its header): your filter untouched")
-- the F part: waited for when the header counts it, cleaned on receipt
DB.Halo = settings()
be("Halo")
DB.Halo.filter = { boss = true, trash = false, quality = 5, ilvl = 100, kinds = { toy = true } }
deliver({ "M|fil01:H|0.99.0|1|1|0|0|40|RAID|-|5|1|15|5|8|1|1", "M|fil01:N|1,Halo-Sargeras", "M|fil01:B|1,pass,888888,0,,Pass" }, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 60, "filter: a header counting an F part waits for it")
deliver({ "M|fil01:F|0|1|9|99999|toy, mount,bogus,,other" }, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 40, "filter: applied once the F part is in")
local HF = DB.Halo.filter
eq(HF.boss, false, "filter clean: boss off")
eq(HF.trash, true, "filter clean: trash on")
eq(HF.quality, 5, "filter clean: an unknown quality keeps yours")
eq(HF.ilvl, 500, "filter clean: item level at most 500")
eq(HF.kinds.toy, true, "filter clean: a named kind on")
eq(HF.kinds.mount, true, "filter clean: spaces around a kind trimmed")
eq(HF.kinds.other, true, "filter clean: the last kind")
eq(HF.kinds.bop, false, "filter clean: a kind not named is off")
eq(HF.kinds.bogus, nil, "filter clean: an unknown kind dropped")
take()
deliver({ "M|fil02:F|1|0|4|abc|", "M|fil02:N|1,Halo-Sargeras", "M|fil02:B|1,pass,888888,0,,Pass", "M|fil02:H|0.99.0|1|1|0|0|45|RAID|-|5|1|15|5|8|1|1" }, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 45, "filter: the F part first still applies")
eq(DB.Halo.filter.ilvl, 500, "filter clean: an item level that isn't a number keeps yours")
eq(DB.Halo.filter.quality, 4, "filter: quality 4")
eq(DB.Halo.filter.kinds.toy, false, "filter: no kinds named, all off")
take()

-- 10. The Clamp and cleaners on their own
eq(LM.Clamp("responseSeconds", 62), 60, "clamp: to the 5 s step")
eq(LM.Clamp("responseSeconds", 0 / 0, 90), 90, "clamp: not a number uses the fallback")
eq(LM.Clamp("weeks", math.huge), 26, "clamp: infinity to the maximum")
eq(LM.CleanAwardChannel("CHANNEL:Trade - City"), "CHANNEL:Trade - City", "clean: a chat channel")
eq(LM.CleanAwardChannel("COMMUNITY:123:4"), "COMMUNITY:123:4", "clean: a guild channel")
eq(LM.CleanAwardMessage(string.rep("ab", 150)):len(), LM.AWARD_MAX, "clean: award message cut to 200 letters")
eq(LM.CleanAwardMessage(string.rep("\\208\\159", 250)):len(), LM.AWARD_MAX * 2, "clean: cut by letters, not bytes")


-- 11. A late answer updates the line; the wait starts only when the last part has left the queue
local fired = {}
LM:OnChange(function(what) fired[#fired + 1] = what end)
be("Solex")
timers = {}
take()
result = 3 -- the game throttles: everything waits in the queue
LM:SyncTo("Quick")
local id = LM.syncOut.id
eq(#outbox, 0, "queue: nothing sent yet")
eq(#timers, 1, "queue: only the queue's retry is waiting, not the answer wait")
result = 0
runTimers() -- the queue sends everything; the last part starts the wait
check(#outbox >= 5, "queue: all sent")
check(LM:SyncStatus():find("Sending", 1, true) ~= nil, "queue: still waiting for answers once sent")
take()
runTimers()
eq(LM:SyncStatus(), "Not synced to anyone.\\nNot reached: Quick, Halo, Gone.", "queue: then the line says who got it")
fired = {}
deliver({ "M|" .. id .. ":K|0.28.0" }, "Quick-Sargeras")
eq(fired[#fired], "sync", "late answer: the page is told")
eq(LM:SyncStatus(), "Synced to 1 player: Quick.\\nNot reached: Halo, Gone.", "late answer: the line changes")
-- an answer with no version is from a CRT older than the loot filter: synced, but the status says so
deliver({ "M|" .. id .. ":K" }, "Halo-Sargeras")
eq(LM:SyncStatus(), "Synced to 2 players: Quick, Halo.\\nNot reached: Gone.\\nSynced, but their CRT is too old for the loot filter: Halo.", "old answer: too old for the loot filter")
deliver({ "M|" .. id .. ":K|0.27.0" }, "Halo-Sargeras")
check(LM:SyncStatus():find("too old for the loot filter: Halo", 1, true) ~= nil, "a 0.27 version: too old for the loot filter")
deliver({ "M|" .. id .. ":K|0.28.0" }, "Halo-Sargeras")
eq(LM:SyncStatus(), "Synced to 2 players: Quick, Halo.\\nNot reached: Gone.", "a 0.28 answer: no note")
-- the ask's answer carries the version too
be("Halo")
deliver({ "M|ask01:P" }, "Solex-Sargeras")
local pong = take()
eq(pong[1], "M|ask01:K|" .. LM.VERSION, "ask: the answer carries the version")
be("Solex")
fired = {}
deliver({ "M|other:K" }, "Halo-Sargeras")
eq(#fired, 0, "an answer to another sync changes nothing")

-- 12. Chat lockdown (a boss encounter): no sync, no ask, the reason given
C_ChatInfo.InChatMessagingLockdown = function() return true end
eq(LM:SyncBlocked(), "Addon messages are held during a boss encounter.", "lockdown: the reason")
local outBefore = LM.syncOut
local shown = {}
UIErrorsFrame = { AddMessage = function(self, text, r, g, b) shown[#shown + 1] = { text, r, g, b } end }
eq(LM:SyncTo("Quick"), nil, "lockdown: no sync")
eq(shown[1] and shown[1][1], "Can't do that during a boss encounter.", "lockdown: red error text on the click")
eq(shown[1] and shown[1][2], 1, "lockdown: the text is red")
eq(#outbox, 0, "lockdown: nothing sent")
eq(LM.syncOut, outBefore, "lockdown: the last line stays")
NOW = NOW + LM.SYNC_PING_SECONDS + 1
eq(LM:SyncPing(), false, "lockdown: no ask either")
C_ChatInfo.InChatMessagingLockdown = function() return false end
eq(LM:SyncBlocked(), nil, "after the encounter: free")
be("Halo")
shown = {}
C_ChatInfo.InChatMessagingLockdown = function() return true end
LM:SyncTo("Quick")
eq(#shown, 0, "lockdown: a non-leader's click shows no error (it can't sync anyway)")
C_ChatInfo.InChatMessagingLockdown = function() return false end
be("Solex")
C_ChatInfo.InChatMessagingLockdown = function() error("boom") end
eq(LM:SyncBlocked(), nil, "lockdown check failing: not blocked")
C_ChatInfo.InChatMessagingLockdown = nil

-- 13. An unfinished sync is dropped: when the lead changes, after 60 seconds
be("Halo")
DB.Halo = settings()
be("Halo")
deliver({ "M|part1:H|0.99.0|1|1|0|0|40|RAID|-|5|1|15|5|8|1", "M|part1:N|1,Halo-Sargeras" }, "Solex-Sargeras")
eq(LM.SyncPending(), true, "pending: waiting for the buttons")
GROUP.leader = "Quick-Sargeras"
onEvent(nil, "PARTY_LEADER_CHANGED")
eq(LM.SyncPending(), false, "pending: dropped when the lead changes")
GROUP.leader = "Solex-Sargeras"
deliver({ "M|part1:B|1,pass,888888,0,,Pass" }, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 60, "pending: the rest alone applies nothing")
timers = {}
deliver({ "M|part2:H|0.99.0|1|1|0|0|40|RAID|-|5|1|15|5|8|1", "M|part2:N|1,Halo-Sargeras" }, "Solex-Sargeras")
NOW = NOW + LM.SYNC_KEEP + 1
deliver({ "M|part2:B|1,pass,888888,0,,Pass" }, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 60, "pending: a part after 60 seconds applies nothing")
deliver({ "M|part3:H|0.99.0|1|1|0|0|40|RAID|-|5|1|15|5|8|1" }, "Solex-Sargeras")
eq(LM.SyncPending(), true, "pending: a new one waiting")
runTimers()
eq(LM.SyncPending(), false, "pending: dropped by its 60 second timer")
deliver({ "M|part4:H|0.99.0|1|1|0|0|40|RAID|-|5|1|15|5|8|1", "M|part4:N|1,Halo-Sargeras", "M|part4:B|1,pass,888888,0,,Pass" }, "Solex-Sargeras")
eq(DB.Halo.responseSeconds, 40, "pending: a whole sync in time still applies")
take()

-- 14. Send to: a place the receiver can't post to becomes Raid, and the chat line says so
local syncN = 0
local function syncSendTo(channel)
  printed = {}
  DB.Halo = settings()
  be("Halo")
  syncN = syncN + 1
  local sid = "ch" .. syncN
  deliver({ "M|" .. sid .. ":H|0.99.0|1|1|0|0|40|" .. channel .. "|-|5|1|15|5|8|1", "M|" .. sid .. ":N|1,Halo-Sargeras", "M|" .. sid .. ":B|1,pass,888888,0,,Pass" }, "Solex-Sargeras")
  take()
  return DB.Halo.awardChannel, printed[1]
end
local got, line = syncSendTo("GUILD")
eq(got, "GUILD", "Guild: kept when you may speak there")
eq(line, "Loot Master settings synced from Solex.", "Guild: nothing more said")
PLACES.guildSpeak = false
got, line = syncSendTo("GUILD")
eq(got, "RAID", "Guild: Raid when your rank can't speak")
eq(line, "Loot Master settings synced from Solex. Send to: Guild isn't open to you, so Raid.", "Guild: said in the chat line")
PLACES.guildSpeak = true
eq((syncSendTo("OFFICER")), "OFFICER", "Officer: kept with the Officerchat Speak flag")
PLACES.officer = false
got, line = syncSendTo("OFFICER")
eq(got, "RAID", "Officer: Raid without the flag")
eq(line, "Loot Master settings synced from Solex. Send to: Officer isn't open to you, so Raid.", "Officer: said")
PLACES.officer = true
PLACES.guild = false
eq((syncSendTo("GUILD")), "RAID", "Guild: Raid with no guild")
eq((syncSendTo("OFFICER")), "RAID", "Officer: Raid with no guild")
eq((syncSendTo("COMMUNITY:77:5")), "RAID", "guild channel: Raid with no guild")
PLACES.guild = true
eq((syncSendTo("CHANNEL:Loot")), "CHANNEL:Loot", "channel: kept when joined")
got, line = syncSendTo("CHANNEL:Trade")
eq(got, "RAID", "channel: Raid when not joined")
eq(line, "Loot Master settings synced from Solex. Send to: Trade isn't open to you, so Raid.", "channel: said by name")
eq((syncSendTo("COMMUNITY:77:5")), "COMMUNITY:77:5", "guild channel: kept when it is one of your guild's")
got, line = syncSendTo("COMMUNITY:99:1")
eq(got, "RAID", "guild channel: Raid when not your guild's")
eq(line, "Loot Master settings synced from Solex. Send to: that guild channel isn't open to you, so Raid.", "guild channel: said")
eq((syncSendTo("SELF")), "SELF", "other places: kept")

-- 15. A 0.27 receiver (Sync.lua before the F part) takes a new leader's sync: the F part and the header's
-- extra field are dropped without an error, and the rest applies
local before27 = fails
assert(load(oldSyncSrc, "old_Sync.lua"))("CowfeeRaidTools", CRT)
DB.Halo = settings()
be("Halo")
DB.Halo.filter = { boss = true, trash = false, quality = 5, ilvl = 100, kinds = { toy = true } }
printed = {}
deliver(box, "Solex-Sargeras")
eq(fails, before27, "0.27 receiver: no error")
eq(DB.Halo.responseSeconds, 95, "0.27 receiver: the rest of the sync applies")
eq(DB.Halo.awardChannel, "OFFICER", "0.27 receiver: Send to applies")
eq(DB.Halo.filter.quality, 5, "0.27 receiver: its filter untouched")
eq(printed[1], "Loot Master settings synced from Solex.", "0.27 receiver: told who synced it")
local oldAck = take()
eq(#oldAck, 1, "0.27 receiver: answers that it applied")
eq(oldAck[1]:find("^M|[%w]+:K$") ~= nil, true, "0.27 receiver: its answer has no version, so the leader says it is too old for the filter")
deliver({ "M|only1:F|1|1|2|0|toy" }, "Solex-Sargeras")
eq(fails, before27, "0.27 receiver: an F part alone is dropped without an error")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/Sync.lua', 'CRT_Modules/LootMaster/Filter.lua', 'CRT_Dev/Tests/old_Sync.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
