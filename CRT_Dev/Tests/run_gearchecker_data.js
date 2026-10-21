// Gear Checker's rules, rows and inspect queue (CRT_Modules/GearChecker/Data.lua and Inspect.lua, with the
// gear engine and the season's gearChecks): missing enchants and gems, a slot that needs no enchant, an
// off hand that is a shield, low item levels, the filters, the shift-click, whisper, raid and chat box
// text, the issues tooltip's lines, where the issues can go (group, guild, officer rights), each channel's
// send and Say in the open world, the chat sends (and the encounter lockdown), and the inspect queue (one at a time, never in combat,
// out of range and offline skipped, a timeout, an item not loaded yet, the game's own inspect window).
// Usage: node run_gearchecker_data.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local gearSrc, registrySrc, seasonSrc, gearChecksSrc, tracksSrc, dataSrc, inspectSrc, commSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
local CLOCK = 100
GetTime = function() return CLOCK end
time = function() return 1790000000 + CLOCK end
-- timers: run when the clock passes them
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers + 1] = { at = CLOCK + s, fn = fn } end }
local function advance(s)
  local target = CLOCK + s
  while true do
    table.sort(timers, function(a, b) return a.at < b.at end)
    local t = timers[1]
    if not t or t.at > target then break end
    table.remove(timers, 1)
    CLOCK = t.at
    t.fn()
  end
  CLOCK = target
end

-- the group: you are raid1
local UNITS = {
  raid1 = { name = "Solex", class = "PALADIN", guid = "G1" },
  raid2 = { name = "Quick", class = "ROGUE", guid = "G2" },
  raid3 = { name = "Arrow", class = "HUNTER", guid = "G3" },
  raid4 = { name = "Far", class = "MAGE", guid = "G4", far = true },
  raid5 = { name = "Off", class = "PRIEST", guid = "G5", offline = true },
  raid6 = { name = "Halo", class = "DRUID", guid = "G6" },
}
local function u(unit) if unit == "player" then return UNITS.raid1 end return UNITS[unit] end
UnitFullName = function(unit) local x = u(unit) return x and x.name, nil end
UnitClass = function(unit) local x = u(unit) return x and x.class, x and x.class end
UnitIsUnit = function(a, b) return u(a) == u(b) end
UnitGUID = function(unit) local x = u(unit) return x and x.guid end
UnitIsConnected = function(unit) local x = u(unit) return x and not x.offline end
GetNormalizedRealmName = function() return "Sargeras" end
local inRaid = true
IsInRaid = function() return inRaid end
LE_PARTY_CATEGORY_INSTANCE = 2
IsInGroup = function(category) return inRaid and category == nil end -- not an instance group
GetNumGroupMembers = function() return 6 end
GetNumSubgroupMembers = function() return 0 end
local combat = false
InCombatLockdown = function() return combat end
local log = { notify = {}, cleared = 0, distanceInCombat = 0 }
CanInspect = function(unit) return u(unit) ~= nil end
CheckInteractDistance = function(unit, i) if combat then log.distanceInCombat = log.distanceInCombat + 1 end assert(i == 1) return not u(unit).far end
NotifyInspect = function(unit) log.notify[#log.notify + 1] = unit end
ClearInspectPlayer = function() log.cleared = log.cleared + 1 end

-- items: an ID's equip location and sockets; links and item levels by link
local LOC = { [101] = "INVTYPE_HEAD", [102] = "INVTYPE_NECK", [111] = "INVTYPE_FINGER", [116] = "INVTYPE_WEAPON",
  [117] = "INVTYPE_SHIELD", [118] = "INVTYPE_WEAPON", [119] = "INVTYPE_HOLDABLE" }
local SOCKETS = { [102] = 2, [111] = 2, [112] = 1 }
local NAMES = { [101] = "Helm", [102] = "Chain", [111] = "Band", [112] = "Loop" }
C_Item = {
  GetDetailedItemLevelInfo = function(link) return tonumber(link:match("ilvl(%d+)")) end,
  GetItemInfoInstant = function(s) local id = tonumber(tostring(s):match("item:(%d+)") or s) return id, "Armor", "Misc", LOC[id] or "INVTYPE_CHEST", 0, 4, 0 end,
  GetItemNumSockets = function(s) local id = tonumber(s:match("item:(%d+)")) return SOCKETS[id] or 0 end,
  GetItemInfo = function(s) local id = tonumber(s:match("item:(%d+)")) if NAMES[id] then return NAMES[id], "|cffa335ee|H" .. s .. "|h[" .. NAMES[id] .. "]|h|r" end end,
  RequestLoadItemDataByID = function() end,
}
local MINE = {}
GetInventoryItemLink = function(unit, slot) if unit == "player" then return MINE[slot] end local x = u(unit) return x and x.links and x.links[slot] end
GetInventoryItemID = function(unit, slot) local l = GetInventoryItemLink(unit, slot) if l then return tonumber(l:match("item:(%d+)")) end local x = u(unit) return x and x.ids and x.ids[slot] end
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function() return 0 end }
local frames = {}
CreateFrame = function() local f = { events = {} } f.RegisterEvent = function(self, e) self.events[e] = true end f.SetScript = function(self, _, fn) self.fn = fn end frames[#frames + 1] = f return f end
local printed = {}
local CRT = { db = { gearChecker = { filter = "all", popout = {} } } }
function CRT:Print(t) printed[#printed + 1] = t end
for name, src in pairs({ Gear = gearSrc }) do assert(load(src, name))("CowfeeRaidTools", CRT) end
assert(load(registrySrc, "Registry.lua"))("CowfeeRaidTools", CRT)
assert(load(seasonSrc, "Season.lua"))("CowfeeRaidTools", CRT)
assert(load(gearChecksSrc, "GearChecks.lua"))("CowfeeRaidTools", CRT)
assert(load(tracksSrc, "Tracks.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(inspectSrc, "Inspect.lua"))("CowfeeRaidTools", CRT)
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
local GC, Gear, Inspect = CRT.GearChecker, CRT.Gear, CRT.GearChecker.Inspect
check(GC ~= nil and Inspect ~= nil, "the Gear Checker loads")

-- 1. The season's rules
local R = GC:Rules()
check(R.enchant[1] and R.enchant[3] and R.enchant[5] and R.enchant[7] and R.enchant[8] and R.enchant[11] and R.enchant[16], "rules: the season's enchant slots")
check(not R.enchant[2] and not R.enchant[15] and not R.enchant[13], "rules: neck, back and trinkets take none this season")
check(R.weaponOnly[17], "rules: the off hand only when it is a weapon")
check(R.sockets[2] and R.sockets[11] and R.sockets[1], "rules: sockets count everywhere")
eq(GC.LOW_ILVL, 12, "low: 12 levels under the average")

-- 2. One slot
local function piece(slot, s, ilvl) return { slot = slot, id = tonumber(s:match("item:(%d+)")), itemString = s, ilvl = ilvl } end
local r = GC.CheckSlot(1, piece(1, "item:101:7364", 280), R, 280)
check(r.needsEnchant and not r.missingEnchant and r.issues == 0, "enchanted head: no issue")
r = GC.CheckSlot(1, piece(1, "item:101::::::::90", 280), R, 280)
check(r.missingEnchant and r.issues == 1, "head with no enchant: missing enchant")
eq(GC.Problems(r), "missing enchant", "the words")
r = GC.CheckSlot(2, piece(2, "item:102::::::::90", 280), R, 280)
check(not r.needsEnchant and not r.missingEnchant, "a neck needs no enchant")
eq(r.emptySockets, 2, "a neck with two empty sockets")
eq(GC.Problems(r), "missing 2 gems", "two gems missing")
r = GC.CheckSlot(11, piece(11, "item:111:7364:213746", 280), R, 280)
eq(r.sockets .. "/" .. r.gems .. "/" .. r.emptySockets, "2/1/1", "a ring with one of two gems")
eq(GC.Problems(r), "missing gem", "one gem missing")
r = GC.CheckSlot(11, piece(11, "item:111:7364:213746:213747", 280), R, 280)
check(r.issues == 0 and r.gems == 2, "a ring with both gems and an enchant: no issue")
r = GC.CheckSlot(17, piece(17, "item:117::::::::90", 280), R, 280)
check(not r.needsEnchant and r.issues == 0, "an off-hand shield takes no enchant")
r = GC.CheckSlot(17, piece(17, "item:119::::::::90", 280), R, 280)
check(not r.needsEnchant, "nor an off-hand held item")
r = GC.CheckSlot(17, piece(17, "item:118::::::::90", 280), R, 280)
check(r.missingEnchant, "an off-hand weapon needs one")
r = GC.CheckSlot(9, piece(9, "item:109", 268), R, 280)
check(r.low and r.issues == 1, "12 under the average is low")
eq(GC.Problems(r), "12 item levels under average", "the words: how far under")
r = GC.CheckSlot(9, piece(9, "item:109", 260), R, 280.6)
eq(GC.Problems(r), "20 item levels under average", "whole item levels under")
r = GC.CheckSlot(9, piece(9, "item:109", 269), R, 280)
check(not r.low, "11 under is not")
r = GC.CheckSlot(1, { slot = 1, id = 101, ilvl = 280 }, R, 280)
check(r.needsEnchant and not r.missingEnchant and r.issues == 0, "an ID-only piece is never flagged for enchant or gems")
-- a bare item:<id> (an ID-only piece, as Comm.SetMessages sends one too long for a message) says nothing
r = GC.CheckSlot(1, piece(1, "item:101", 280), R, 280)
check(r.unknown and r.needsEnchant and not r.missingEnchant and r.issues == 0, "a bare item:<id> head: never a missing enchant")
r = GC.CheckSlot(2, piece(2, "item:102", 280), R, 280)
check(r.unknown and r.emptySockets == 0 and r.issues == 0, "a bare item:<id> neck with sockets: never a missing gem")
eq(GC.PartsOf({ itemString = "item:101::::::::90" }).id, 101, "a real item string has parts")
eq(GC.PartsOf({ itemString = "item:101" }), nil, "a bare one has none")
eq(GC.PartsOf({ id = 101 }), nil, "nor a piece with no item string")
r = GC.CheckSlot(1, nil, R, 280)
check(r.empty and r.issues == 0, "an empty slot")
local sockets = C_Item.GetItemNumSockets
C_Item.GetItemNumSockets = function() error("no") end
r = GC.CheckSlot(2, piece(2, "item:102::::::::90", 280), R, 280)
eq(r.emptySockets, 0, "sockets the game can't count: no finding")
C_Item.GetItemNumSockets = sockets

-- 3. Rows and filters
MINE[1] = "|cffa335ee|Hitem:101:7364::::::::ilvl280|h[Helm]|h|r"
MINE[11] = "|cffa335ee|Hitem:111:7364:213746:213747|h[ilvl280]|h|r"
Gear:Refresh()
local function remember(name, list) Gear:Remember(name .. "-Sargeras", list, "gearcheck", true) end
remember("Quick", { piece(1, "item:101:7364", 289), piece(11, "item:111:7364:213746", 289) }) -- a ring gem missing
remember("Arrow", { piece(1, "item:101::::::::90", 280), piece(11, "item:111:7364:213746:213747", 280) }) -- no head enchant
remember("Far", { piece(1, "item:101:7364", 280) })
remember("Off", { piece(1, "item:101:7364", 280) })
Gear:Remember("Halo-Sargeras", { piece(11, "item:111", 280) }, "lootmaster") -- one piece from a loot answer
local all = GC:Rows("all")
eq(#all, 6, "everyone: you and the five others")
eq(all[1].name, "Solex-Sargeras", "you first")
check(all[1].me and all[1].seen, "your row is seen at once")
eq(all[1].issues, 0, "your gear has no issue")
local halo
for _, row in ipairs(all) do if row.name == "Halo-Sargeras" then halo = row end end
check(halo and not halo.seen, "a player with only a loot answer's pieces is not seen")
eq(halo and #halo.pieces, 0, "and their few pieces aren't shown as a set")
eq(halo and halo.issues, 0, "nor checked")
local function names(rows) local out = {} for _, row in ipairs(rows) do out[#out + 1] = (row.name:gsub("%-.*", "")) end return table.concat(out, ",") end
eq(names(GC:Rows("issues")), "Quick,Arrow", "only issues")
eq(names(GC:Rows("gems")), "Quick", "missing gems")
eq(names(GC:Rows("enchants")), "Arrow", "missing enchants")
local quick = GC:Rows("gems")[1]
eq(quick.missingGems, 1, "Quick: one gem")
eq(quick.class, "ROGUE", "Quick: the class from the group")
eq(math.floor(quick.avg * 16 + 0.5), 578, "Quick: the average from the pieces")

-- 3b. Which cells a filter shows: every cell under Everyone, only the cells with that kind of issue otherwise
local function rowNamed(n) for _, row in ipairs(GC:Rows("all")) do if row.name == n .. "-Sargeras" then return row end end end
local qr, ar = rowNamed("Quick"), rowNamed("Arrow")
check(GC.CellShows(qr.slots[1], "all") and GC.CellShows(qr.slots[11], "all") and GC.CellShows(qr.slots[3], "all"), "everyone: every cell, empty slots too")
check(not GC.CellShows(qr.slots[1], "issues") and GC.CellShows(qr.slots[11], "issues"), "only issues: only the ring with its missing gem")
check(not GC.CellShows(qr.slots[3], "issues"), "only issues: an empty slot is drawn empty")
check(GC.CellShows(qr.slots[11], "gems") and not GC.CellShows(ar.slots[1], "gems") and not GC.CellShows(qr.slots[1], "gems"), "missing gems: the cells with an empty socket only")
check(GC.CellShows(ar.slots[1], "enchants") and not GC.CellShows(qr.slots[11], "enchants") and not GC.CellShows(ar.slots[11], "enchants"), "missing enchants: the cells with no enchant only")
local lowSlot = GC.CheckSlot(9, piece(9, "item:109", 260), R, 280)
check(GC.CellShows(lowSlot, "issues") and not GC.CellShows(lowSlot, "gems") and not GC.CellShows(lowSlot, "enchants"), "a low item: shown under Only issues, not under gems or enchants")
check(not GC.CellShows(nil, "issues") and GC.CellShows(nil, "all"), "no findings: only Everyone draws it")

-- 4. Chat text
local arrow = GC:Rows("enchants")[1]
local line = GC.SlotLine(quick, quick.slots[11])
eq(line, "[Quick] Finger |cffa335ee|Hitem:111:7364:213746|h[Band]|h|r 289 - missing gem", "shift-click: name, slot, item link, item level, the issue")
eq(GC.SlotLine(quick, quick.slots[1]), nil, "shift-click: a slot with no issue has no line")
local w = GC.WhisperLines(arrow)
eq(#w, 1, "whisper: one line per slot with an issue")
eq(w[1], "Gear check: Head |cffa335ee|Hitem:101::::::::90|h[Helm]|h|r 280 - missing enchant", "whisper: the slot, the item and what is missing")
eq(GC.RaidLines(quick)[1], line, "raid: the shift-click line")
NAMES[111] = nil
check(GC.SlotLine(quick, quick.slots[11]):find("[item 111]", 1, true) ~= nil, "an item the game hasn't loaded is named by its ID")
NAMES[111] = "Band"
local many = { name = "Many-Sargeras", slots = {} }
for _, s in ipairs(Gear.SLOTS) do many.slots[s.id] = GC.CheckSlot(s.id, piece(s.id, "item:111::::::::90", 280), R, 280) end
local box = GC.ChatBoxText(many)
check(#box <= 255, "chat box: one message (" .. #box .. ")")
check(box:find("%(%+%d+ more%)$") ~= nil, "chat box: says how many were left out")
eq(GC.ChatBoxText(arrow), (w[1]:gsub("^Gear check: ", "[Arrow] ")), "chat box: a single issue in full")

-- 5. Sending to chat: only on a click, held during an encounter
local said = {}
C_ChatInfo.SendChatMessage = function(text, chatType, lang, target) said[#said + 1] = { text, chatType, target } end
eq(GC.Say(w, "WHISPER", "Arrow-Sargeras"), 1, "say: sent")
check(said[1] and said[1][2] == "WHISPER" and said[1][3] == "Arrow-Sargeras" and said[1][1] == w[1], "say: a whisper to the player")
local errors = {}
UIErrorsFrame = { AddMessage = function(_, t) errors[#errors + 1] = t end }
C_ChatInfo.InChatMessagingLockdown = function() return true end
said, printed = {}, {}
eq(GC.Say(w, "RAID"), 0, "lockdown: nothing sent")
eq(#said, 0, "lockdown: no chat call")
eq(errors[1], "Chat is locked during the boss encounter.", "lockdown: red error text")
check(printed[1] and printed[1]:find(w[1], 1, true), "lockdown: the line shown to you")
C_ChatInfo.InChatMessagingLockdown = function() return false end
C_ChatInfo.SendChatMessage = function() error("not allowed") end
printed = {}
eq(GC.Say(w, "RAID"), 0, "a refused send")
eq(#printed, 1, "is shown to you")
C_ChatInfo.SendChatMessage = nil
SendChatMessage = function(text, chatType) said[#said + 1] = { text, chatType } end
said = {}
GC.Say({ "x" }, "PARTY")
eq(said[1] and said[1][2], "PARTY", "the global SendChatMessage when C_ChatInfo has none")
eq(GC.GroupChat(), "RAID", "the group chat in a raid")
-- several lines: spaced out, each 255 bytes or less
said = {}
local long = "Gear check: Head |cffa335ee|Hitem:101:" .. string.rep("1:", 100) .. "|h[Helm]|h|r 280 - " .. string.rep("missing enchant, ", 3)
check(#long > 255, "the long line is over the limit (" .. #long .. ")")
eq(GC.Say({ "a", "b", long }, "PARTY"), 3, "three lines on their way")
eq(#said, 1, "the first goes now")
advance(GC.CHAT_GAP)
eq(#said, 2, "the second a moment later")
advance(GC.CHAT_GAP)
eq(#said, 3, "then the third")
check(said[3] and #said[3][1] <= 255, "a long line is cut to 255 bytes or less")
check(said[3] and said[3][1]:find("[Helm]", 1, true) and not said[3][1]:find("|H", 1, true), "by naming the item without its link")
eq(#GC.CapLine(string.rep("x", 400)), 255, "text with no link is cut at 255 bytes")
eq(GC.CapLine("short"), "short", "a short line is as it was")
eq(GC.CapLine(string.rep("x", 254) .. "||"), string.rep("x", 254), "no pipe is left at the cut")

-- 5b. The issues tooltip's lines: one per issue, red for missing, orange for low
local tipLines = GC.IssueLines(arrow)
eq(#tipLines, 1, "tooltip: Arrow's one issue")
eq(tipLines[1].text, "Head |cffa335ee|Hitem:101::::::::90|h[Helm]|h|r 280 - missing enchant", "tooltip: the slot, the item and what is missing")
eq(tipLines[1].kind, "bad", "tooltip: a missing enchant is red")
local mixed = { name = "Mix-Sargeras", seen = true, slots = {} }
mixed.slots[1] = GC.CheckSlot(1, piece(1, "item:101::::::::90", 260), R, 280)
mixed.slots[11] = GC.CheckSlot(11, piece(11, "item:111:7364", 280), R, 280)
tipLines = GC.IssueLines(mixed)
eq(#tipLines, 3, "tooltip: a missing enchant and a low item on one slot are two lines, and the gems a third")
eq(tipLines[1].text .. "|" .. tipLines[1].kind, "Head |cffa335ee|Hitem:101::::::::90|h[Helm]|h|r 260 - missing enchant|bad", "tooltip: the enchant first")
eq(tipLines[2].text .. "|" .. tipLines[2].kind, "Head |cffa335ee|Hitem:101::::::::90|h[Helm]|h|r 260 - 20 item levels under average|low", "tooltip: then the low item, orange")
eq(tipLines[3].text .. "|" .. tipLines[3].kind, "Finger |cffa335ee|Hitem:111:7364|h[Band]|h|r 280 - missing 2 gems|bad", "tooltip: the gems, red")
eq(#GC.IssueLines(all[1]), 0, "tooltip: no issues, no lines")
eq(GC.IssueLines(halo), nil, "tooltip: not seen yet, nothing known")

-- 5c. Where the issues can go: the group, Guild and Officer when you may speak there, a whisper, Say
local GUILD = { in_ = false, speak = true, rank = 2, flags = {} }
IsInGuild = function() return GUILD.in_ end
GetGuildInfo = function(unit) if GUILD.in_ and unit == "player" then return "Cowfee", "Raider", GUILD.rank end end
C_GuildInfo = { CanSpeakInGuildChat = function() return GUILD.speak end,
  GuildControlGetRankFlags = function(order) GUILD.asked = order return GUILD.flags end }
local function targets(row) local out = {} for _, t in ipairs(GC.SendTargets(row)) do out[#out + 1] = t.chatType .. (t.target and (":" .. t.target) or "") end return table.concat(out, ",") end
eq(targets(arrow), "RAID,WHISPER:Arrow-Sargeras,SAY", "send to: no guild, a raid")
GUILD.in_ = true
eq(targets(arrow), "RAID,GUILD,WHISPER:Arrow-Sargeras,SAY", "send to: in a guild, Guild")
eq(GUILD.asked, 3, "officer: your rank's flags (GetGuildInfo counts from 0, the flags from 1)")
GUILD.flags = { [3] = true }
check(not GC.CanOfficer(), "officer: reading officer chat isn't speaking there")
GUILD.flags = { [4] = true }
eq(targets(arrow), "RAID,GUILD,OFFICER,WHISPER:Arrow-Sargeras,SAY", "send to: a rank that speaks in officer chat, Officer")
GUILD.speak = false
eq(targets(arrow), "RAID,OFFICER,WHISPER:Arrow-Sargeras,SAY", "send to: a rank muted in guild chat, no Guild")
GUILD.speak = true
C_GuildInfo.GuildControlGetRankFlags = function() error("no rank yet") end
check(not GC.CanOfficer(), "officer: flags the game can't give are no")
C_GuildInfo.GuildControlGetRankFlags = function() return GUILD.flags end
issecretvalue = function(v) return v == 2 end
check(not GC.CanOfficer(), "officer: a secret rank is never used")
issecretvalue = nil
eq(targets(all[1]), "RAID,GUILD,OFFICER,SAY", "send to: your own row, no whisper")
inRaid = false
eq(targets(arrow), "GUILD,OFFICER,WHISPER:Arrow-Sargeras,SAY", "send to: out of a group, no group channel")
local party = true
IsInGroup = function(category) return party and category == nil end
eq(targets(arrow):match("^[^,]+"), "PARTY", "send to: a party")
IsInGroup = function(category) return category == LE_PARTY_CATEGORY_INSTANCE or category == nil end
eq(targets(arrow):match("^[^,]+"), "INSTANCE_CHAT", "send to: an instance group")
inRaid = true
IsInGroup = function(category) return inRaid and category == nil end
GUILD.in_ = false
check(not GC.CanGuild() and not GC.CanOfficer(), "out of a guild: neither")

-- 5d. Each channel's send, and Say in the open world (the game takes it only from a key press or click)
said, timers = {}, {}
C_ChatInfo.SendChatMessage = function(text, chatType, lang, target) said[#said + 1] = { text, chatType, target } end
local WHERE = { inside = true, kind = "raid" }
IsInInstance = function() return WHERE.inside, WHERE.kind end
local opened = {}
ChatFrameUtil = { OpenChat = function(t) opened[#opened + 1] = t end, GetActiveWindow = function() end, InsertLink = function() end }
for _, ch in ipairs({ "RAID", "GUILD", "OFFICER", "SAY" }) do
  said = {}
  eq(GC.Send(mixed, { chatType = ch }), 2, ch .. ": both slots' lines on their way")
  advance(GC.CHAT_GAP)
  check(#said == 2 and said[1][2] == ch and said[2][2] == ch, ch .. ": sent there, spaced out")
  check(said[1] and said[1][1]:find("^%[Mix%] Head ") ~= nil, ch .. ": the named lines")
end
said = {}
GC.Send(mixed, { chatType = "WHISPER", target = "Mix-Sargeras" })
advance(GC.CHAT_GAP)
check(#said == 2 and said[1][2] == "WHISPER" and said[1][3] == "Mix-Sargeras" and said[1][1]:find("^Gear check: ") ~= nil, "whisper: the player's own lines to them")
check(not GC.NeedsHardware("SAY") and not GC.NeedsHardware("GUILD"), "in a raid instance: Say needs no key press")
WHERE.inside, WHERE.kind = false, "none"
check(GC.NeedsHardware("SAY") and GC.NeedsHardware("YELL"), "the open world: Say and Yell need a key press")
check(not GC.NeedsHardware("GUILD") and not GC.NeedsHardware("OFFICER") and not GC.NeedsHardware("WHISPER") and not GC.NeedsHardware("RAID"), "the open world: the others don't")
check(GC.NeedsHardware("CHANNEL"), "a channel always does")
WHERE.inside, WHERE.kind = true, "neighborhood"
check(GC.NeedsHardware("SAY"), "a housing neighborhood counts as the world")
issecretvalue = function(v) return v == "raid" end
WHERE.inside, WHERE.kind = true, "raid"
check(GC.NeedsHardware("SAY"), "a secret instance type: treated as the world")
issecretvalue = nil
WHERE.inside, WHERE.kind = false, "none"
said, timers, opened = {}, {}, {}
local sent, how = GC.Send(mixed, { chatType = "SAY" })
advance(GC.CHAT_GAP * 3)
eq(#said, 0, "say in the world: no send the game would block")
eq(sent .. "/" .. tostring(how), "0/chatbox", "say in the world: it goes to the chat box")
check(opened[1] and opened[1]:find("^/s %[Mix%] Head ") ~= nil, "say in the world: every line in a new chat box after /s, to send with Enter")
check(opened[1] and opened[1]:find("missing 2 gems", 1, true) ~= nil, "with the last line too")
check(#opened[1] <= 255, "and it fits the chat box (" .. #opened[1] .. ")")
opened = {}
GC.Say(GC.RaidLines(many), "SAY")
check(opened[1] and #opened[1] <= 255 and opened[1]:find("%(%+%d+ more%)$") ~= nil, "a long list: as many as fit, then how many were left out")
WHERE.inside, WHERE.kind = true, "raid"
said, opened = {}, {}
eq(GC.Send({ name = "Ok-Sargeras", seen = true, slots = {} }, { chatType = "GUILD" }), 0, "no issues: nothing sent")
eq(#said + #opened, 0, "no issues: no chat call, no chat box")

-- 5e. Season checks, from the season's data only
local B = CRT.Bosses
local shipped = B:GearChecks()
check(shipped and type(shipped.checks) == "table" and #shipped.checks >= 2, "the season's topic file declares its checks")
check(shipped and shipped.enchant and shipped.enchant[1] == 1, "and its enchant rules, moved there from Season.lua")
eq(#GC:SeasonChecks(), 0, "the shipped checks have no IDs yet: none is active")
eq(#GC:Filters(), 4, "so no extra filters")
local shippedTracks = B:Tracks()
check(shippedTracks and type(shippedTracks.list) == "table" and #shippedTracks.list >= 5, "the season's tracks topic lists its tracks")
local tl = {}
for _, t in ipairs(shippedTracks and shippedTracks.list or {}) do
  tl[#tl + 1] = t.letter
  check(type(t.key) == "string" and type(t.label) == "string" and (type(t.quality) == "number" or type(t.color) == "table"), "shipped track " .. tostring(t.key) .. ": a key, a label and a colour")
end
eq(table.concat(tl), "EAVCHM", "the shipped tracks, lowest first")
eq(shippedTracks and next(shippedTracks.bonus), nil, "the shipped bonus ID map is empty until filled from the game")
check(not GC:Tracks().usable and GC:FilterKey("below") == "all", "so no Below chip yet")
-- a season with no gear rules at all
B.seasons["midnight-s1"].current = false
B:Season({ key = "test-s8", name = "Plain", order = 8, current = true })
eq(B:GearChecks(), nil, "a season without gear data: the accessor gives nothing")
eq(B:Tracks(), nil, "nor tracks")
check(GC:Tracks() and #GC:Tracks().list == 0 and not GC:Tracks().usable, "no tracks: an empty list")
eq(#GC:SeasonChecks(), 0, "no checks")
eq(#GC:Filters(), 4, "no extra filters")
B.seasons["test-s8"].current = false
-- a season that writes its rules in Season.lua: still read; a topic file wins over it
B:Season({ key = "test-s7", name = "Old", order = 7, current = true, gearChecks = { enchant = { 5 } } })
check(B:GearChecks() and B:GearChecks().enchant[1] == 5, "a Season.lua field is read as the topic")
B:SeasonData("test-s7", "gearChecks", { enchant = { 7 } })
eq(B:GearChecks().enchant[1], 7, "the topic file wins")
B.seasons["test-s7"].current = false
-- a season with one check of each kind
local function bonusString(id, enchant, bonuses)
  return "item:" .. id .. ":" .. (enchant or "") .. string.rep(":", 11) .. #bonuses .. (#bonuses > 0 and (":" .. table.concat(bonuses, ":")) or "")
end
eq(table.concat(Gear.Parts(bonusString(105, "", { 5001, 9 })).bonusIds, ","), "5001,9", "the test item strings carry their bonus IDs")
B:Season({ key = "test-s9", name = "Checks", order = 9, current = true })
B:SeasonData("test-s9", "gearChecks", { enchant = { 1 }, checks = {
  { key = "cursed", label = "Cursed", help = "Shows who wears a cursed item. Click it to see only those items.", kind = "itemIds", ids = { 101 }, severity = "info" },
  { key = "pair", label = "Pair", kind = "itemIds", ids = { 111, 112 }, require = 2, slots = { 11, 12 } },
  { key = "glow", label = "Glow", kind = "bonusIds", ids = { 5001 }, severity = "low" },
  { key = "rune", label = "Wrong enchant", kind = "enchantIds", ids = { 7364 }, slots = { 1 } },
  { key = "track", label = "No track", kind = "missingBonus", ids = { 6001, 6002 }, slots = { 2 } },
  { key = "none", label = "None yet", kind = "itemIds", ids = {} },
  { key = "odd", label = "Odd", kind = "nonsense", ids = { 1 } },
  { label = "No key", kind = "itemIds", ids = { 1 } },
  { key = "cursed", label = "Twice", kind = "itemIds", ids = { 1 } },
} })
local active = {}
for _, c in ipairs(GC:SeasonChecks()) do active[#active + 1] = c.key end
eq(table.concat(active, ","), "cursed,pair,glow,rune,track", "active: the checks with a known kind, a key and IDs, each key once")
local fl = {}
for _, f in ipairs(GC:Filters()) do fl[#fl + 1] = f.key .. "=" .. f.label end
eq(table.concat(fl, ","), "all=Everyone,issues=Only issues,gems=Missing gems,enchants=Missing enchants,check:cursed=Cursed,check:pair=Pair,check:glow=Glow,check:rune=Wrong enchant,check:track=No track", "a filter per check, after Missing enchants, labelled from the data")
eq(GC:Filters()[5].help, "Shows who wears a cursed item. Click it to see only those items.", "a check's filter carries its help")
eq(GC:FilterKey("check:glow"), "check:glow", "a saved check filter that exists is kept")
eq(GC:FilterKey("check:gone"), "all", "a saved filter of a check the season no longer has is Everyone")
eq(GC:FilterKey(nil), "all", "no saved filter is Everyone")
local R9 = GC:Rules()
local function keys(r) local out = {} for _, c in ipairs(r.checks) do out[#out + 1] = c.key end return table.concat(out, ",") end
-- itemIds, flagging each match
r = GC.CheckSlot(1, piece(1, "item:101:7364", 280), R9, 280)
eq(keys(r), "cursed", "itemIds: the item is one of them")
eq(r.issues, 0, "info: a check to know about is no issue")
eq(GC.Problems(r), nil, "info: not in the issue words (chat, whispers)")
eq(GC.Notes(r), "Cursed", "info: the check's label in the note words")
check(GC.CellShows(r, "check:cursed") and not GC.CellShows(r, "issues") and not GC.CellShows(r, "check:glow") and not GC.CellShows(r, "enchants"), "info: drawn under its own filter only, not Only issues")
eq(GC.TopCheck(r).key, "cursed", "itemIds: the cell's tag")
r = GC.CheckSlot(5, piece(5, bonusString(105, "", { 5001 }), 280), R9, 280)
check(r.issues == 1 and GC.Problems(r) == "Glow" and GC.Notes(r) == nil, "a low check still counts, in the issue words")
r = GC.CheckSlot(3, piece(3, "item:103", 280), R9, 280)
check(keys(r) == "" and r.issues == 0 and GC.TopCheck(r) == nil, "itemIds: another item, no finding")
r = GC.CheckSlot(1, { slot = 1, id = 101, ilvl = 280 }, R9, 280)
eq(keys(r), "cursed", "itemIds: an ID-only piece still matches by its ID")
-- bonusIds
r = GC.CheckSlot(5, piece(5, bonusString(105, "", { 9, 5001 }), 280), R9, 280)
eq(keys(r), "glow", "bonusIds: the item carries one")
eq(GC.TopCheck(r).severity, "low", "bonusIds: its severity")
r = GC.CheckSlot(5, piece(5, bonusString(105, "", { 9 }), 280), R9, 280)
eq(keys(r), "", "bonusIds: none of them, no finding")
-- enchantIds
r = GC.CheckSlot(1, piece(1, "item:101:9999", 280), R9, 280)
eq(keys(r), "cursed,rune", "enchantIds: an enchant not on the list")
eq(GC.TopCheck(r).key, "rune", "the tag shows the most severe check (bad over info)")
r = GC.CheckSlot(1, piece(1, "item:101::::::::90", 280), R9, 280)
check(keys(r) == "cursed" and r.missingEnchant and r.issues == 1, "enchantIds: no enchant is the enchant rule's issue, not the check's (and cursed is info)")
r = GC.CheckSlot(16, piece(16, "item:116:9999", 280), R9, 280)
eq(keys(r), "", "enchantIds: only on the check's slots")
-- missingBonus
r = GC.CheckSlot(2, piece(2, bonusString(102, "", { 6002 }), 280), R9, 280)
eq(keys(r), "", "missingBonus: the item carries one")
r = GC.CheckSlot(2, piece(2, "item:102::::::::90", 280), R9, 280)
eq(keys(r), "track", "missingBonus: none of them")
r = GC.CheckSlot(2, { slot = 2, id = 102, ilvl = 280 }, R9, 280)
eq(keys(r), "", "missingBonus: an ID-only piece can't tell, no finding")
r = GC.CheckSlot(2, piece(2, "item:102", 280), R9, 280)
eq(keys(r), "", "missingBonus: a bare item:<id> can't tell either")
r = GC.CheckSlot(1, piece(1, "item:101", 280), R9, 280)
check(keys(r) == "cursed" and not r.missingEnchant, "a bare item:<id>: itemIds still matches by ID, the enchant rule says nothing")
r = GC.CheckSlot(3, piece(3, "item:103", 280), R9, 280)
eq(keys(r), "", "missingBonus: only on the check's slots")
-- itemIds with require: fewer than that many is one issue on the row
remember("Quick", { piece(1, "item:101:7364", 289), piece(11, "item:111:7364", 289) })
local q9 = rowNamed("Quick")
eq(q9.checkHits.cursed, 1, "row: the cursed head")
eq(q9.checkHits.pair, 1, "row: one of two of the pair is an issue")
eq(q9.issues, 1, "row: the pair counts in Issues, the info check doesn't")
check(not q9.slots[11].checks[1], "require: the ring itself is no issue")
check(GC.CellShows(q9.slots[11], "check:pair") and not GC.CellShows(q9.slots[1], "check:pair"), "require: its filter draws the matching item")
check(not GC.CellShows(q9.slots[11], "issues"), "require: the matching item is no issue on its own")
check(GC.CellShows(q9.slots[11], "issues", q9), "require: but Only issues draws it on a row short of the check")
-- bonusIds with require: an ID-only piece may hold the bonus, so it never makes a shortfall
B:SeasonData("test-s9", "gearChecks", { checks = { { key = "glow2", label = "Glow", kind = "bonusIds", ids = { 5001 }, require = 2, slots = { 1, 3 } } } })
remember("Quick", { piece(1, bonusString(101, "", { 5001 }), 289), piece(3, "item:103", 289) })
q9 = rowNamed("Quick")
check(q9.issues == 0 and #q9.rowFindings == 0, "bonusIds require: one match and a bare item:<id> is no shortfall")
remember("Quick", { piece(1, bonusString(101, "", { 5001 }), 289), piece(3, bonusString(103, "", { 9 }), 289) })
q9 = rowNamed("Quick")
eq(#q9.rowFindings, 1, "bonusIds require: one match and a known miss is")
B:SeasonData("test-s9", "gearChecks", { enchant = { 1 }, checks = {
  { key = "cursed", label = "Cursed", kind = "itemIds", ids = { 101 }, severity = "info" },
  { key = "pair", label = "Pair", kind = "itemIds", ids = { 111, 112 }, require = 2, slots = { 11, 12 } },
} })
remember("Quick", { piece(1, "item:101:7364", 289), piece(11, "item:111:7364", 289) })
q9 = rowNamed("Quick")
local qnames = names(GC:Rows("check:pair"))
check(qnames:find("Quick", 1, true) ~= nil, "require: Quick under the check's filter")
eq(names(GC:Rows("check:glow")), "", "a check nobody trips: no rows")
local qt = GC.IssueLines(q9)
eq(#qt, 1, "tooltip: a line per check issue, the info check not among them")
eq(qt[1].text .. "|" .. qt[1].kind, "Pair: 1 of 2 worn|bad", "tooltip: the row's check")
local qn = GC.NoteLines(q9)
eq(#qn, 1, "not an issue: the info check")
eq(qn[1].text .. "|" .. qn[1].kind, "Head |cffa335ee|Hitem:101:7364|h[Helm]|h|r 289 - Cursed|info", "not an issue: the slot's check, in its severity")
local ql = GC.RaidLines(q9)
eq(#ql, 1, "raid lines: no line for the info check")
eq(ql[#ql], "[Quick] Pair: 1 of 2 worn", "raid lines: the row's check")
local qw = GC.WhisperLines(q9)
eq(#qw, 1, "whisper: no line for the info check")
eq(qw[#qw], "Gear check: Pair: 1 of 2 worn", "whisper: the row's check")
check(GC.Passes(q9, "check:cursed"), "info: its own chip still lists the row")
-- an info check short of its require: a note, not an issue
B:SeasonData("test-s9", "gearChecks", { checks = { { key = "set", label = "Set", kind = "itemIds", ids = { 111, 112 }, require = 2, severity = "info", slots = { 11, 12 } } } })
q9 = rowNamed("Quick")
check(q9.issues == 0 and #q9.rowFindings == 1 and GC.Passes(q9, "check:set") and not GC.Passes(q9, "issues"), "info require: a shortfall is no issue, but its chip lists the row")
check(not GC.CellShows(q9.slots[11], "issues", q9), "info require: Only issues doesn't draw its items")
eq(#GC.IssueLines(q9) .. "/" .. #GC.NoteLines(q9), "0/1", "info require: in the notes, not the issues")
eq(#GC.RaidLines(q9), 0, "info require: nothing to post")
B:SeasonData("test-s9", "gearChecks", { enchant = { 1 }, checks = {
  { key = "cursed", label = "Cursed", kind = "itemIds", ids = { 101 }, severity = "info" },
  { key = "pair", label = "Pair", kind = "itemIds", ids = { 111, 112 }, require = 2, slots = { 11, 12 } },
} })
remember("Quick", { piece(1, "item:103:7364", 289), piece(11, "item:111:7364", 289), piece(12, "item:112:7364", 289) })
q9 = rowNamed("Quick")
check(q9.issues == 0 and (q9.checkHits.pair or 0) == 0, "require: both worn, no issue")
check(GC.CellShows(q9.slots[11], "check:pair") and GC.CellShows(q9.slots[12], "check:pair"), "require: its filter still draws them")
check(not GC.Passes(q9, "check:pair"), "require: but the row doesn't show under it")

-- 5f. Upgrade tracks, from the season's data only: read from bonus IDs, the cell's tag, the row's counts, Below
ITEM_QUALITY_COLORS = { [2] = { r = 0.12, g = 1, b = 0 }, [3] = { r = 0, g = 0.44, b = 0.87 }, [4] = { r = 0.64, g = 0.21, b = 0.93 } }
B:SeasonData("test-s9", "tracks", { default = "hero", list = {
  { key = "vet", label = "Veteran", letter = "V", quality = 2 },
  { key = "champion", label = "Champion", letter = "C", quality = 3 },
  { key = "hero", label = "Hero", letter = "H", quality = 4 },
  { key = "myth", label = "Myth", letter = "M", color = { 1, 0.5, 0 } },
  { label = "No key", letter = "X" },
}, bonus = { [7001] = { track = "champion", rank = 4, max = 6 }, [7002] = { track = "hero", rank = 2, max = 6 },
  [7003] = { track = "myth", rank = 1, max = 6 }, [7004] = { track = "hero", rank = 6, max = 6 }, [7009] = { track = "nope", rank = 1, max = 6 } } })
local T = GC:Tracks()
local tk = {} for _, t in ipairs(T.list) do tk[#tk + 1] = t.key end
eq(table.concat(tk, ","), "vet,champion,hero,myth", "tracks: the season's list in its order, a track with no key left out")
check(T.usable, "tracks: usable once a bonus ID is known")
local info = GC.TrackOf(Gear.Parts(bonusString(101, "", { 9, 7001 })))
eq(info and (info.track.key .. " " .. info.rank .. "/" .. info.max), "champion 4/6", "tracks: a known bonus ID gives the track and rank")
eq(GC.TrackTag(info), "C4", "tracks: the cell's tag, letter and rank")
eq(GC.TrackWords(info), "Champion 4/6", "tracks: in words")
eq(GC.TrackOf(Gear.Parts(bonusString(101, "", { 9 }))), nil, "tracks: no known bonus ID, no track")
eq(GC.TrackOf(Gear.Parts(bonusString(101, "", { 7009 }))), nil, "tracks: a bonus ID on a track the list doesn't have, no track")
eq(GC.TrackOf(nil), nil, "tracks: an ID-only piece has no track")
local cr = { GC.TrackColor(T.byKey.hero) }
check(math.abs(cr[1] - 0.64) < 0.001 and math.abs(cr[3] - 0.93) < 0.001, "tracks: a track's colour from the game's item quality colour")
cr = { GC.TrackColor(T.byKey.myth) }
check(cr[1] == 1 and cr[2] == 0.5 and cr[3] == 0, "tracks: else the data's own colour")
r = GC.CheckSlot(1, piece(1, bonusString(101, "7364", { 7002 }), 289), GC:Rules(), 289)
eq(r.track and r.track.track.key, "hero", "tracks: a slot knows its piece's track")
r = GC.CheckSlot(1, piece(1, "item:101", 289), GC:Rules(), 289)
check(r.unknown and r.track == nil, "tracks: a bare item:<id> shows no track")
r = GC.CheckSlot(1, { slot = 1, id = 101, ilvl = 289 }, GC:Rules(), 289)
eq(r.track, nil, "tracks: nor a piece known only by its ID")
-- a row: Myth, Hero, Hero, Champion and an unknown piece
B:SeasonData("test-s9", "gearChecks", { enchant = { 1 }, checks = { { key = "cursed", label = "Cursed", kind = "itemIds", ids = { 101 }, severity = "info" } } })
NAMES[121] = "Band"
remember("Quick", { piece(1, bonusString(122, "7364", { 7002 }), 289), piece(2, bonusString(120, "", { 7003 }), 289),
  piece(3, bonusString(103, "", { 7004 }), 289), piece(11, bonusString(121, "7364", { 7001 }), 289), piece(5, "item:105", 289) })
q9 = rowNamed("Quick")
eq(q9.trackCounts.hero .. "/" .. q9.trackCounts.champion .. "/" .. q9.trackCounts.myth, "2/1/1", "row: the pieces on each track")
eq(GC.TrackText(q9), "1M 2H 1C", "row: the Tracks column, highest first")
eq(GC.TrackText({ trackCounts = {} }), "", "row: no known tracks, empty")
eq(GC.TrackText(q9, false, 2), "1M 2H +", "row: only room for two, the lowest track dropped with a +")
eq(GC.TrackText(q9, false, 3), "1M 2H 1C", "row: room for all three, no +")
local ts = {}
for _, p in ipairs(GC.TrackCounts(q9)) do ts[#ts + 1] = p.n .. " " .. p.track.label end
eq(table.concat(ts, ", "), "1 Myth, 2 Hero, 1 Champion", "row: the full counts for the badge's tooltip, highest first")
eq(q9.issues, 0, "below: an item below the track is no issue")
eq(q9.below, 1, "below Hero (the season's default): the Champion ring")
check(GC.CellShows(q9.slots[11], "below") and not GC.CellShows(q9.slots[1], "below") and not GC.CellShows(q9.slots[2], "below") and not GC.CellShows(q9.slots[5], "below"), "below: only the cells under the track are drawn")
check(GC.Passes(q9, "below") and not GC.Passes(q9, "issues"), "below: the row shows under Below, not under Only issues")
local bf = GC:Filters()
eq(bf[#bf].key .. "=" .. bf[#bf].label, "below=Below Hero", "below: the last chip, named for the track")
eq(GC:FilterKey("below"), "below", "below: a saved Below filter is kept while the season has tracks")
local nl = GC.NoteLines(q9)
eq(#nl, 1, "below: a note line for the lower item")
eq(nl[1] and (nl[1].text .. "|" .. nl[1].kind), "Finger |cffa335ee|H" .. bonusString(121, "7364", { 7001 }) .. "|h[Band]|h|r 289 - Champion 4/6|track", "below: Slot [item] - Champion 4/6")
check(nl[1] and nl[1].track == T.byKey.champion, "below: in its track's colour")
eq(#GC.RaidLines(q9) + #GC.WhisperLines(q9), 0, "below: never in chat")
CRT.db.gearChecker.belowTrack = "myth"
q9 = rowNamed("Quick")
eq(q9.below, 3, "below Myth: the two Hero items and the Champion ring")
eq(GC:Filters()[#GC:Filters()].label, "Below Myth", "below: the chip names the saved track")
CRT.db.gearChecker.belowTrack = "gone"
eq(GC:BelowTrack().key, "hero", "below: a saved track the season doesn't have is the season's default")
CRT.db.gearChecker.belowTrack = nil
local bc = {} for _, t in ipairs(GC:BelowChoices()) do bc[#bc + 1] = t.label end
eq(table.concat(bc, ","), "Champion,Hero,Myth", "below: the choices, every track but the lowest")
B:SeasonData("test-s9", "tracks", { list = T.source.list, bonus = {} })
check(not GC:Tracks().usable and GC:FilterKey("below") == "all", "no bonus IDs: no Below chip, a saved Below is Everyone")
eq(GC:Filters()[#GC:Filters()].key, "check:cursed", "no bonus IDs: the season checks are the last chips")
-- back to the shipped season
B.seasons["test-s9"].current = false
B.seasons["midnight-s1"].current = true
eq(#GC:Filters(), 4, "the shipped season again: four filters")
remember("Quick", { piece(1, "item:101:7364", 289), piece(11, "item:111:7364:213746", 289) })

-- 6. The inspect queue
UNITS.raid2.links = { [1] = "|cffa335ee|Hitem:101:7364::::::::ilvl290|h[Helm]|h|r", [2] = "|cffa335ee|Hitem:102::213746|h[ilvl286]|h|r" }
UNITS.raid3.links = { [1] = "|cffa335ee|Hitem:101::::::::ilvl281|h[Helm]|h|r" }
UNITS.raid6.links = { [1] = "|cffa335ee|Hitem:101:7364|h[ilvl277]|h|r" }
UNITS.raid6.ids = { [11] = 111 } -- a ring the game has no link for yet
local fired = 0
GC:OnChange(function() fired = fired + 1 end)
Inspect:Queue({ "Quick-Sargeras", "Far-Sargeras", "Off-Sargeras", "Arrow-Sargeras" })
eq(#log.notify, 1, "one at a time: one NotifyInspect")
eq(log.notify[1], "raid2", "the first player's unit")
Inspect:Queue({ "Quick-Sargeras" })
eq(#Inspect.queue, 3, "a player already queued or being inspected isn't added again")
Inspect:OnEvent("INSPECT_READY", "G9")
eq(log.cleared, 0, "another player's INSPECT_READY changes nothing")
Inspect:OnEvent("INSPECT_READY", "G2")
eq(Gear:Of("Quick-Sargeras", 2).itemString, "item:102::213746", "inspect: the exact item read from the game")
eq(Gear:Of("Quick-Sargeras", 11), nil, "inspect: the whole set replaces what was remembered")
eq(select(2, Gear:When("Quick-Sargeras")), "inspect", "inspect: the source")
eq(log.cleared, 1, "inspect: ClearInspectPlayer once read")
check(fired > 0, "inspect: the page is told")
eq(#log.notify, 1, "the next player waits for the pause")
advance(Inspect.DELAY)
eq(Inspect.skipped["Far-Sargeras"], "range", "out of range: skipped")
eq(Inspect.skipped["Off-Sargeras"], "offline", "offline: skipped")
eq(#log.notify, 2, "then the next one in range")
eq(log.notify[2], "raid3", "Arrow next")
-- no answer: the timeout moves on
advance(Inspect.TIMEOUT)
eq(log.cleared, 2, "timeout: let go")
eq(Inspect.current, nil, "timeout: nobody is being inspected")
-- combat: nothing starts, and a running inspect is let go and tried again after
combat = true
Inspect:Queue({ "Arrow-Sargeras" })
eq(#log.notify, 2, "combat: no inspect starts")
eq(log.distanceInCombat, 0, "combat: no range check either")
combat = false
Inspect:OnEvent("PLAYER_REGEN_ENABLED")
eq(#log.notify, 3, "combat over: the queue goes on")
combat = true
Inspect:OnEvent("PLAYER_REGEN_DISABLED")
eq(log.cleared, 3, "combat starts mid-inspect: let go")
Inspect:OnEvent("INSPECT_READY", "G3")
eq(Gear:Of("Arrow-Sargeras", 1).itemString, "item:101::::::::90", "combat: an answer that comes anyway is ignored (Arrow's last reply stays)")
advance(10)
eq(#log.notify, 3, "combat: nothing in the meantime")
combat = false
Inspect:OnEvent("PLAYER_REGEN_ENABLED")
eq(log.notify[4], "raid3", "after combat: the same player again")
Inspect:OnEvent("INSPECT_READY", "G3")
eq(Gear:Of("Arrow-Sargeras", 1).itemString, "item:101::::::::ilvl281", "after combat: read")
eq(log.distanceInCombat, 0, "never a range check in combat")
-- an item not loaded yet: read again before letting go
advance(Inspect.DELAY)
Inspect:Queue({ "Halo-Sargeras" })
eq(log.notify[#log.notify], "raid6", "Halo inspected")
local cleared = log.cleared
Inspect:OnEvent("INSPECT_READY", "G6")
eq(log.cleared, cleared, "a ring with no link yet: waits")
UNITS.raid6.links[11] = "|cffa335ee|Hitem:111:7364|h[ilvl277]|h|r"
advance(Inspect.RETRY)
eq(Gear:Of("Halo-Sargeras", 11) and Gear:Of("Halo-Sargeras", 11).id, 111, "the ring read on the second try")
eq(log.cleared, cleared + 1, "then let go")
-- the game's own inspect window open: ours waits, and never clears the game's inspect
advance(Inspect.DELAY)
InspectFrame = { IsShown = function() return true end }
local before = #log.notify
Inspect:Queue({ "Quick-Sargeras" })
eq(#log.notify, before, "the game's inspect window is open: ours waits")
InspectFrame = nil
advance(Inspect.DELAY)
eq(#log.notify, before + 1, "and goes on when it closes")
-- a player whose CRT sent their set meanwhile is not inspected
Inspect:Clear()
GC.Comm.sets["Arrow-Sargeras"] = 1
before = #log.notify
Inspect:Queue({ "Arrow-Sargeras" })
eq(#log.notify, before, "their CRT's set came: no inspect")
-- a name added during the pause between players waits for the pause
GC.Comm.sets["Arrow-Sargeras"] = nil
Inspect:Queue({ "Arrow-Sargeras" })
Inspect:OnEvent("INSPECT_READY", "G3")
local n0 = #log.notify
Inspect:Queue({ "Quick-Sargeras" })
eq(#log.notify, n0, "a name added during the pause doesn't start at once")
advance(Inspect.DELAY - 0.1)
eq(#log.notify, n0, "nor before the pause ends")
advance(0.1)
eq(#log.notify, n0 + 1, "it goes when the pause ends")
eq(log.notify[#log.notify], "raid2", "Quick")
-- an item with no item level yet is read again, as one with no link
UNITS.raid2.links[3] = "|cffa335ee|Hitem:103|h[Pads]|h|r"
cleared = log.cleared
Inspect:OnEvent("INSPECT_READY", "G2")
eq(log.cleared, cleared, "no item level yet: waits")
UNITS.raid2.links[3] = "|cffa335ee|Hitem:103|h[ilvl284]|h|r"
advance(Inspect.RETRY)
eq(Gear:Of("Quick-Sargeras", 3) and Gear:Of("Quick-Sargeras", 3).ilvl, 284, "the item level read on the second try")
eq(log.cleared, cleared + 1, "then let go")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Gear.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Data/Seasons/Midnight-S1/Season.lua',
  'CRT_Data/Seasons/Midnight-S1/GearChecks.lua', 'CRT_Data/Seasons/Midnight-S1/Tracks.lua', 'CRT_Modules/GearChecker/Data.lua', 'CRT_Modules/GearChecker/Inspect.lua',
  'CRT_Modules/GearChecker/Comm.lua'];
for (const f of files) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
