// Gear Checker's rules, rows and inspect queue (CRT_Modules/GearChecker/Data.lua and Inspect.lua, with the
// gear engine and the season's gearChecks): missing enchants and gems, a slot that needs no enchant, an
// off hand that is a shield, low item levels, the filters, the shift-click, whisper, raid and chat box
// text, the chat sends (and the encounter lockdown), and the inspect queue (one at a time, never in combat,
// out of range and offline skipped, a timeout, an item not loaded yet, the game's own inspect window).
// Usage: node run_gearchecker_data.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local gearSrc, registrySrc, seasonSrc, dataSrc, inspectSrc, commSrc = ...
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
r = GC.CheckSlot(1, piece(1, "item:101", 280), R, 280)
check(r.missingEnchant and r.issues == 1, "head with no enchant: missing enchant")
eq(GC.Problems(r), "missing enchant", "the words")
r = GC.CheckSlot(2, piece(2, "item:102:::::", 280), R, 280)
check(not r.needsEnchant and not r.missingEnchant, "a neck needs no enchant")
eq(r.emptySockets, 2, "a neck with two empty sockets")
eq(GC.Problems(r), "missing 2 gems", "two gems missing")
r = GC.CheckSlot(11, piece(11, "item:111:7364:213746", 280), R, 280)
eq(r.sockets .. "/" .. r.gems .. "/" .. r.emptySockets, "2/1/1", "a ring with one of two gems")
eq(GC.Problems(r), "missing gem", "one gem missing")
r = GC.CheckSlot(11, piece(11, "item:111:7364:213746:213747", 280), R, 280)
check(r.issues == 0 and r.gems == 2, "a ring with both gems and an enchant: no issue")
r = GC.CheckSlot(17, piece(17, "item:117", 280), R, 280)
check(not r.needsEnchant and r.issues == 0, "an off-hand shield takes no enchant")
r = GC.CheckSlot(17, piece(17, "item:119", 280), R, 280)
check(not r.needsEnchant, "nor an off-hand held item")
r = GC.CheckSlot(17, piece(17, "item:118", 280), R, 280)
check(r.missingEnchant, "an off-hand weapon needs one")
r = GC.CheckSlot(9, piece(9, "item:109", 268), R, 280)
check(r.low and r.issues == 1, "12 under the average is low")
eq(GC.Problems(r), "low item level", "the words")
r = GC.CheckSlot(9, piece(9, "item:109", 269), R, 280)
check(not r.low, "11 under is not")
r = GC.CheckSlot(1, { slot = 1, id = 101, ilvl = 280 }, R, 280)
check(r.needsEnchant and not r.missingEnchant and r.issues == 0, "an ID-only piece is never flagged for enchant or gems")
r = GC.CheckSlot(1, nil, R, 280)
check(r.empty and r.issues == 0, "an empty slot")
local sockets = C_Item.GetItemNumSockets
C_Item.GetItemNumSockets = function() error("no") end
r = GC.CheckSlot(2, piece(2, "item:102", 280), R, 280)
eq(r.emptySockets, 0, "sockets the game can't count: no finding")
C_Item.GetItemNumSockets = sockets

-- 3. Rows and filters
MINE[1] = "|cffa335ee|Hitem:101:7364::::::::ilvl280|h[Helm]|h|r"
MINE[11] = "|cffa335ee|Hitem:111:7364:213746:213747|h[ilvl280]|h|r"
Gear:Refresh()
local function remember(name, list) Gear:Remember(name .. "-Sargeras", list, "gearcheck", true) end
remember("Quick", { piece(1, "item:101:7364", 289), piece(11, "item:111:7364:213746", 289) }) -- a ring gem missing
remember("Arrow", { piece(1, "item:101", 280), piece(11, "item:111:7364:213746:213747", 280) }) -- no head enchant
remember("Far", { piece(1, "item:101:7364", 280) })
remember("Off", { piece(1, "item:101:7364", 280) })
local all = GC:Rows("all")
eq(#all, 6, "everyone: you and the five others")
eq(all[1].name, "Solex-Sargeras", "you first")
check(all[1].me and all[1].seen, "your row is seen at once")
eq(all[1].issues, 0, "your gear has no issue")
local halo
for _, row in ipairs(all) do if row.name == "Halo-Sargeras" then halo = row end end
check(halo and not halo.seen, "a player with no gear yet is not seen")
local function names(rows) local out = {} for _, row in ipairs(rows) do out[#out + 1] = (row.name:gsub("%-.*", "")) end return table.concat(out, ",") end
eq(names(GC:Rows("issues")), "Quick,Arrow", "only issues")
eq(names(GC:Rows("gems")), "Quick", "missing gems")
eq(names(GC:Rows("enchants")), "Arrow", "missing enchants")
local quick = GC:Rows("gems")[1]
eq(quick.missingGems, 1, "Quick: one gem")
eq(quick.class, "ROGUE", "Quick: the class from the group")
eq(math.floor(quick.avg * 16 + 0.5), 578, "Quick: the average from the pieces")

-- 4. Chat text
local arrow = GC:Rows("enchants")[1]
local line = GC.SlotLine(quick, quick.slots[11])
eq(line, "[Quick] Finger |cffa335ee|Hitem:111:7364:213746|h[Band]|h|r 289 - missing gem", "shift-click: name, slot, item link, item level, the issue")
eq(GC.SlotLine(quick, quick.slots[1]), nil, "shift-click: a slot with no issue has no line")
local w = GC.WhisperLines(arrow)
eq(#w, 1, "whisper: one line per slot with an issue")
eq(w[1], "Gear check: Head |cffa335ee|Hitem:101|h[Helm]|h|r 280 - missing enchant", "whisper: the slot, the item and what is missing")
eq(GC.RaidLines(quick)[1], line, "raid: the shift-click line")
NAMES[111] = nil
check(GC.SlotLine(quick, quick.slots[11]):find("[item 111]", 1, true) ~= nil, "an item the game hasn't loaded is named by its ID")
NAMES[111] = "Band"
local many = { name = "Many-Sargeras", slots = {} }
for _, s in ipairs(Gear.SLOTS) do many.slots[s.id] = GC.CheckSlot(s.id, piece(s.id, "item:111", 280), R, 280) end
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
eq(Gear:Of("Arrow-Sargeras", 1).itemString, "item:101", "combat: an answer that comes anyway is ignored (Arrow's last reply stays)")
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

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/Gear.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Data/Seasons/Midnight-S1/Season.lua',
  'CRT_Modules/GearChecker/Data.lua', 'CRT_Modules/GearChecker/Inspect.lua', 'CRT_Modules/GearChecker/Comm.lua']) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
}
if (lua.lua_pcall(L, 6, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
