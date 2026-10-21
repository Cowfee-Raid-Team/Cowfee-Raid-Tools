// CRT_Core/Gear.lua, the gear engine: the slots, your gear from stand-ins for the game's calls, the cache
// and its events, the wire format (Encode, Decode, PackMany) with long, junk and secret input, other
// players' gear, and the tooltip. Usage: node run_gear.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local gearSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local CLOCK = 1790000000
time = function() return CLOCK end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
HEADSLOT = "Kopf" -- the game's own slot name wins over the English one
-- your gear: links by slot, item levels by link
local LINKS, ILVL, requested = {}, {}, {}
local reads = 0
GetInventoryItemLink = function(unit, slot) reads = reads + 1 assert(unit == "player") return LINKS[slot] end
GetInventoryItemID = function(unit, slot) local l = LINKS[slot] return l and tonumber(l:match("item:(%d+)")) end
C_Item = {
  GetDetailedItemLevelInfo = function(link) return ILVL[link] end,
  RequestLoadItemDataByID = function(id) requested[#requested + 1] = id end,
  GetItemInfoInstant = function(s)
    local id = tonumber((s or ""):match("item:(%d+)"))
    local loc = ({ [500] = "INVTYPE_FINGER", [501] = "INVTYPE_HEAD", [502] = "INVTYPE_2HWEAPON", [503] = "INVTYPE_TRINKET" })[id] or ""
    return id, "Armor", "Misc", loc, 0, 4, 0
  end,
}
local onEvent, registered = nil, {}
CreateFrame = function() return { RegisterEvent = function(_, e) registered[e] = true end, SetScript = function(_, _, fn) onEvent = fn end } end
local CRT = {}
assert(load(gearSrc, "Gear.lua"))("CowfeeRaidTools", CRT)
local Gear = CRT.Gear
check(Gear ~= nil, "CRT.Gear exists")
check(registered.PLAYER_EQUIPMENT_CHANGED and registered.PLAYER_ENTERING_WORLD and registered.ITEM_DATA_LOAD_RESULT, "listens for the gear events")

-- 1. The slots map
local ids = {}
for _, s in ipairs(Gear.SLOTS) do ids[#ids + 1] = s.id end
eq(table.concat(ids, ","), "1,2,3,5,6,7,8,9,10,11,12,13,14,15,16,17", "slots: worn gear, no shirt or tabard")
eq(Gear.Slot(1).name, "Kopf", "slots: the game's own name")
eq(Gear.Slot(15).name, "Back", "slots: English when the game has none")
eq(Gear.Slot(4), nil, "slots: the shirt is not one")
eq(table.concat(Gear.SLOTS_FOR("INVTYPE_FINGER"), ","), "11,12", "rings go in both ring slots")
eq(table.concat(Gear.SLOTS_FOR("INVTYPE_TRINKET"), ","), "13,14", "trinkets in both")
eq(table.concat(Gear.SLOTS_FOR("INVTYPE_WEAPON"), ","), "16,17", "one-handers in either hand")
eq(table.concat(Gear.SLOTS_FOR("INVTYPE_2HWEAPON"), ","), "16", "two-handers in the main hand")
eq(table.concat(Gear.SLOTS_FOR("INVTYPE_ROBE"), ","), "5", "a robe is a chest")
eq(#Gear.SLOTS_FOR(""), 0, "no slot for an empty equip location")
eq(#Gear.SLOTS_FOR(nil), 0, "nor for nil")
eq(#Gear.SLOTS_FOR("INVTYPE_BAG"), 0, "nor for a bag")
local sf = Gear.SLOTS_FOR("INVTYPE_FINGER") sf[1] = 99
eq(Gear.EQUIP_LOCS.INVTYPE_FINGER[1], 11, "SLOTS_FOR gives a copy, the map can't be changed through it")

-- 2. Encode and Decode
local LONG = "item:249329:7364:213746:213746:::::90:577::28:6:12667:12793:6652:13577:13333:10354:2:28:2462:29:40:::Player-3299-0050F7FB"
local p = Gear.Decode(Gear.Encode({ slot = 11, itemString = LONG, ilvl = 288.6 }))
eq(p and p.slot, 11, "round trip: the slot")
eq(p and p.id, 249329, "round trip: the item ID")
eq(p and p.itemString, LONG, "round trip: the whole item string, bonus IDs, gems, enchant and crafter")
eq(p and p.ilvl, 289, "round trip: the item level, whole")
eq(Gear.Encode({ slot = 1, link = "|cffa335ee|Hitem:501:7364::::::::90:577::::::::|h[Helm]|h|r", ilvl = 280 }), "1~item:501:7364::::::::90:577~280", "encode: a link becomes its item string, empty tail dropped")
eq(Gear.Encode({ slot = 2, itemString = "item:7", ilvl = nil }), "2~item:7~", "encode: no item level is empty")
local p2 = Gear.Decode("2~item:7~")
check(p2 and p2.ilvl == nil and p2.id == 7, "decode: an empty item level is nil")
eq(Gear.Encode({ slot = 4, itemString = "item:7" }), nil, "encode: a slot that isn't one")
eq(Gear.Encode({ slot = 1.5, itemString = "item:7" }), nil, "encode: a fraction is no slot")
eq(Gear.Encode({ slot = 1, itemString = "spell:7" }), nil, "encode: not an item")
eq(Gear.Encode({ slot = 1, itemString = "item:0" }), nil, "encode: item 0")
eq(Gear.Encode({ slot = 1, itemString = "item:7|h" }), "1~item:7~", "encode: a stray pipe ends the item string")
eq(Gear.Encode({ slot = 1, itemString = "item:" .. string.rep("1", 300) }), nil, "encode: too long")
eq(Gear.Encode(nil), nil, "encode: nil")
eq(Gear.Encode("1~item:7~1"), nil, "encode: a string")
eq(Gear.Encode({ slot = 1, itemString = "item:7", ilvl = -5 }), "1~item:7~", "encode: a negative item level is unknown")
eq(Gear.Encode({ slot = 1, itemString = "item:7", ilvl = 0/0 }), "1~item:7~", "encode: NaN is unknown")
local junk = { "", "x", "1~item:7", "1~item:7~abc", "99~item:7~1", "4~item:7~1", "1~item:abc~1", "1~item:7;x~1",
  "1~item:7~1~2", "1~ item:7~1", "1~item:7,8~1", "-1~item:7~1", "1~item:0~1", string.rep("1", 300) }
for _, j in ipairs(junk) do eq(Gear.Decode(j), nil, "decode junk: '" .. j:sub(1, 20) .. "'") end
eq(Gear.Decode(nil), nil, "decode: nil")
eq(Gear.Decode(42), nil, "decode: a number")
eq(Gear.Decode({}), nil, "decode: a table")
-- secret values: never read
issecretvalue = function(v) return v == "SECRET" or v == 7777 end
eq(Gear.Decode("SECRET"), nil, "decode: a secret")
eq(Gear.Encode({ slot = 1, itemString = "SECRET" }), nil, "encode: a secret item string")
eq(Gear.Encode({ slot = 1, itemString = "item:7", ilvl = 7777 }), nil, "encode: a secret item level")
eq(Gear.Encode({ slot = 7777, itemString = "item:7" }), nil, "encode: a secret slot")
eq(Gear.ItemString("SECRET"), nil, "item string: a secret")
issecretvalue = nil

-- 3. PackMany: every chunk within the budget, nothing lost that fits
local pieces = {}
for i = 1, 16 do pieces[i] = { slot = Gear.SLOTS[i].id, itemString = LONG, ilvl = 280 + i } end
pieces[17] = { slot = 4, itemString = "item:1" } -- not a slot: left out
for _, budget in ipairs({ 242, 120, 255 }) do
  local chunks, left = Gear.PackMany(pieces, budget)
  local n = 0
  for _, c in ipairs(chunks) do
    check(#table.concat(c, ";") <= budget, "pack " .. budget .. ": a chunk fits (" .. #table.concat(c, ";") .. ")")
    n = n + #c
  end
  if budget >= #Gear.Encode(pieces[1]) then
    eq(n, 16, "pack " .. budget .. ": every piece is in a chunk")
    eq(#left, 1, "pack " .. budget .. ": the bad piece is left out")
  else
    eq(n, 0, "pack " .. budget .. ": nothing fits a tiny budget")
    eq(#left, 17, "pack " .. budget .. ": all left out")
  end
end
local short = Gear.PackMany({ { slot = 1, itemString = "item:1" }, { slot = 2, itemString = "item:2" } }, 255)
eq(#short, 1, "pack: short pieces share a chunk")
eq(#Gear.PackMany(nil, 255), 0, "pack: nil is no chunks")

-- 4. Your gear: Mine, MineAll, ForItem
local RING1 = "|cffa335ee|Hitem:600:7364:213746::::::90:577::28:3:12667:12793:6652::::::|h[Band]|h|r"
local RING2 = "|cffa335ee|Hitem:601::::::::90:577::28:2:12667:6652::::::|h[Loop]|h|r"
LINKS[11], LINKS[12], LINKS[1] = RING1, RING2, "|cff0070dd|Hitem:700::::::::90:577::::::::|h[Hat]|h|r"
ILVL[RING1], ILVL[RING2], ILVL[LINKS[1]] = 289, 276, 250
local m = Gear:Mine(11)
eq(m and m.id, 600, "mine: the ring's ID")
eq(m and m.itemString, "item:600:7364:213746::::::90:577::28:3:12667:12793:6652", "mine: its item string, empty tail dropped")
eq(m and m.link, RING1, "mine: its link")
eq(m and m.ilvl, 289, "mine: its item level")
eq(m and m.slot, 11, "mine: its slot")
eq(Gear:Mine(15), nil, "mine: an empty slot")
m.ilvl = 1
eq(Gear:Mine(11).ilvl, 289, "mine: a copy, the cache can't be changed through it")
eq(#Gear:MineAll(), 3, "mine all: the three filled slots")
eq(Gear:MineAll()[1].slot, 1, "mine all: in slot order")
local fi = Gear:ForItem("item:500")
eq(#fi, 2, "for item: a ring compares both rings")
eq(fi[1].id, 601, "for item: lowest item level first")
eq(fi[2].id, 600, "for item: then the higher")
eq(#Gear:ForItem("item:502"), 0, "for item: an empty main hand")
eq(#Gear:ForItem("item:999"), 0, "for item: no slot")
eq(#Gear:ForItem(nil), 0, "for item: nil")
-- the cache: no new reads until an event
local before = reads
Gear:Mine(11) Gear:MineAll()
eq(reads, before, "cache: reading again asks the game nothing")

-- 5. The cache refreshes on the events, and OnChange fires
local changes = {}
Gear:OnChange(function(slot) changes[#changes + 1] = slot end)
Gear:OnChange(function() error("a broken listener") end)
local errs = fails
geterrorhandler = function() return function() errs = errs + 1 end end
local NEW = "|cffa335ee|Hitem:602::::::::90:577::28:1:13577::::::|h[New Ring]|h|r"
LINKS[11], ILVL[NEW] = NEW, 300
onEvent(nil, "PLAYER_EQUIPMENT_CHANGED", 11, false)
eq(Gear:Mine(11).id, 602, "equipment changed: the new ring")
eq(Gear:Mine(11).ilvl, 300, "equipment changed: its item level")
eq(table.concat(changes, ","), "11", "equipment changed: OnChange for that slot")
check(errs > fails, "a broken listener is reported, the others still run")
table.remove(Gear.listeners)
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
changes = {}
onEvent(nil, "PLAYER_EQUIPMENT_CHANGED", 11, false)
eq(#changes, 0, "the same ring again: no change")
LINKS[1] = nil
onEvent(nil, "PLAYER_EQUIPMENT_CHANGED", 1, true)
eq(Gear:Mine(1), nil, "a slot emptied")
eq(table.concat(changes, ","), "1", "and OnChange for it")
changes = {}
-- an item level not loaded yet: asked of the game, read again on ITEM_DATA_LOAD_RESULT
local SLOW = "|cffa335ee|Hitem:603::::::::90:577|h[Slow]|h|r"
LINKS[13] = SLOW
onEvent(nil, "PLAYER_EQUIPMENT_CHANGED", 13, false)
eq(Gear:Mine(13).ilvl, nil, "not loaded: no item level yet")
eq(requested[#requested], 603, "not loaded: asked of the game")
ILVL[SLOW] = 282
changes = {}
onEvent(nil, "ITEM_DATA_LOAD_RESULT", 999, true)
eq(Gear:Mine(13).ilvl, nil, "another item loading changes nothing")
onEvent(nil, "ITEM_DATA_LOAD_RESULT", 603, true)
eq(Gear:Mine(13).ilvl, 282, "loaded: the item level is read")
eq(table.concat(changes, ","), "13", "loaded: OnChange")
-- PLAYER_ENTERING_WORLD reads every slot; a secret slot number does too
LINKS[15] = "|cffa335ee|Hitem:604|h[Cape]|h|r"
ILVL[LINKS[15]] = 270
onEvent(nil, "PLAYER_ENTERING_WORLD", false, true)
eq(Gear:Mine(15) and Gear:Mine(15).id, 604, "entering world: every slot read")
issecretvalue = function(v) return v == "SECRET" end
LINKS[2] = "SECRET"
onEvent(nil, "PLAYER_EQUIPMENT_CHANGED", "SECRET", false)
eq(Gear:Mine(2), nil, "a secret link reads as empty")
issecretvalue = nil
LINKS[2] = nil
GetInventoryItemLink = function() error("boom") end
onEvent(nil, "PLAYER_EQUIPMENT_CHANGED", 11, false)
eq(Gear:Mine(11), nil, "a failing game call reads as empty, no error")
GetInventoryItemLink = function(_, slot) return LINKS[slot] end
onEvent(nil, "PLAYER_EQUIPMENT_CHANGED", 11, false)
eq(Gear:Mine(11).id, 602, "and reads again after")
-- ForItem reads its slots live: a slot empty at login, or changed with no event (an upgrade, a gem),
-- is still right when you answer
LINKS[16] = nil
onEvent(nil, "PLAYER_ENTERING_WORLD", false, true)
eq(#Gear:ForItem("item:502"), 0, "live: the main hand empty at login")
local STAFF = "|cffa335ee|Hitem:605::::::::90:577|h[Staff]|h|r"
LINKS[16], ILVL[STAFF] = STAFF, 291
local live = Gear:ForItem("item:502")
eq(#live, 1, "live: the main hand that arrived with no event")
eq(live[1] and live[1].ilvl, 291, "live: its item level")
local UP = "|cffa335ee|Hitem:602::::::::90:577::28:1:13578::::::|h[New Ring]|h|r"
LINKS[11], ILVL[UP] = UP, 304
eq(Gear:ForItem("item:500")[2].ilvl, 304, "live: a ring upgraded with no event")
eq(Gear:Mine(11).ilvl, 304, "live: and the cache keeps it")

-- 6. Other players: Remember, Of, When
eq(Gear:When("Quick-Sargeras"), nil, "never remembered")
eq(Gear:Of("Quick-Sargeras", 11), nil, "no piece")
check(Gear:Remember("Quick-Sargeras", { Gear.Decode("11~" .. LONG .. "~289"), { slot = 12, id = 601, ilvl = 276 } }, "lootmaster"), "remember: stored")
local q = Gear:Of("Quick-Sargeras", 11)
eq(q and q.itemString, LONG, "of: the exact item")
eq(q and q.ilvl, 289, "of: its item level")
eq(Gear:Of("Quick-Sargeras", 12).id, 601, "of: an ID-only piece")
eq(Gear:Of("Quick-Sargeras", 12).itemString, nil, "of: with no item string")
local at, source = Gear:When("Quick-Sargeras")
eq(at, CLOCK, "when: the time")
eq(source, "lootmaster", "when: the source")
q.itemString = "changed"
eq(Gear:Of("Quick-Sargeras", 11).itemString, LONG, "of: a copy")
CLOCK = CLOCK + 60
Gear:Remember("Quick-Sargeras", { { slot = 12, id = 605, ilvl = 290 } }, "audit")
eq(Gear:Of("Quick-Sargeras", 12).id, 605, "remember again: the slot is replaced")
eq(Gear:Of("Quick-Sargeras", 11).itemString, LONG, "remember again: other slots kept")
eq(select(2, Gear:When("Quick-Sargeras")), "audit", "remember again: the newer source")
eq(Gear:When("Quick-Sargeras"), CLOCK, "remember again: the newer time")
eq(Gear:Remember("Quick-Sargeras", { { slot = 4, id = 1 } }, "x"), false, "remember: nothing valid is no change")
eq(Gear:Remember("", { { slot = 1, id = 1 } }), false, "remember: no name")
eq(Gear:Remember(nil, {}), false, "remember: nil name")
issecretvalue = function(v) return v == "SECRET" end
eq(Gear:Remember("SECRET", { { slot = 1, id = 1 } }), false, "remember: a secret name")
issecretvalue = nil
Gear:Remember("Halo-Sargeras", { { slot = 1, id = 9, itemString = "bad|string" } }, "x")
eq(Gear:Of("Halo-Sargeras", 1).itemString, nil, "remember: a bad item string is dropped, the ID kept")

-- 7. ShowTooltip: SetHyperlink with an item string, SetItemByID without
local tip
GameTooltip = {
  SetOwner = function(_, o, a) tip.owner, tip.anchor = o, a end,
  SetHyperlink = function(_, s) tip.link = s end,
  SetItemByID = function(_, id) tip.byID = id end,
  AddLine = function(_, t) tip.lines[#tip.lines + 1] = t end,
  Show = function() tip.shown = true end,
}
local owner = {}
tip = { lines = {} }
eq(Gear.ShowTooltip(owner, { id = 249329, itemString = LONG, ilvl = 289 }), true, "tooltip: exact")
eq(tip.link, LONG, "tooltip: SetHyperlink with the item string")
eq(tip.byID, nil, "tooltip: not by ID")
eq(tip.lines[1], "Equipped at item level 289", "tooltip: the item level line")
eq(tip.anchor, "ANCHOR_RIGHT", "tooltip: right of the owner by default")
check(tip.owner == owner and tip.shown, "tooltip: owned and shown")
tip = { lines = {} }
eq(Gear.ShowTooltip(owner, { id = 55, ilvl = 610 }, "ANCHOR_LEFT"), false, "tooltip: by ID")
eq(tip.byID, 55, "tooltip: SetItemByID")
eq(tip.link, nil, "tooltip: no hyperlink")
eq(tip.lines[1], "Equipped at item level 610", "tooltip: the line by ID too")
eq(tip.anchor, "ANCHOR_LEFT", "tooltip: the anchor asked for")
tip = { lines = {} }
Gear.ShowTooltip(owner, { link = RING1, ilvl = 289 })
eq(tip.link, "item:600:7364:213746::::::90:577::28:3:12667:12793:6652", "tooltip: a link is shown by its item string")
tip = { lines = {} }
GameTooltip.SetHyperlink = function() error("Unknown link type") end
eq(Gear.ShowTooltip(owner, { id = 600, itemString = "item:600:1" }), false, "tooltip: a refused hyperlink falls back")
eq(tip.byID, 600, "tooltip: to the ID")
eq(#tip.lines, 0, "tooltip: no item level, no line")
tip = { lines = {} }
eq(Gear.ShowTooltip(owner, {}), false, "tooltip: nothing to show")
eq(tip.owner, nil, "tooltip: not opened")
eq(Gear.ShowTooltip(owner, nil), false, "tooltip: nil piece")

-- 8. Replace-all Remember and OfAll
CLOCK = CLOCK + 60
Gear:Remember("Rune-Sargeras", { { slot = 1, id = 11, ilvl = 280 }, { slot = 11, id = 12, ilvl = 281 }, { slot = 16, id = 13 } }, "inspect")
local all = Gear:OfAll("Rune-Sargeras")
eq(#all, 3, "of all: every remembered piece")
eq(all[1].slot .. "," .. all[2].slot .. "," .. all[3].slot, "1,11,16", "of all: in slot order")
all[1].id = 99
eq(Gear:OfAll("Rune-Sargeras")[1].id, 11, "of all: copies")
eq(#Gear:OfAll("Nobody-Sargeras"), 0, "of all: no one is an empty list")
check(Gear:Remember("Rune-Sargeras", { { slot = 1, id = 21, ilvl = 290 } }, "gearcheck", true), "replace: stored")
eq(#Gear:OfAll("Rune-Sargeras"), 1, "replace: the slots not sent are gone (an emptied slot)")
eq(Gear:Of("Rune-Sargeras", 11), nil, "replace: the old ring is forgotten")
eq(Gear:Of("Rune-Sargeras", 1).id, 21, "replace: the new head")
eq(select(2, Gear:When("Rune-Sargeras")), "gearcheck", "replace: the source")
eq(Gear:Remember("Rune-Sargeras", { { slot = 4, id = 1 } }, "x", true), false, "replace: nothing valid keeps what was there")
eq(Gear:Of("Rune-Sargeras", 1).id, 21, "replace: still the head")

-- 9. Parts: the enchant and gems in an item string
local pt = Gear.Parts("item:600:7364:213746::213747:::90:577")
eq(pt and pt.id, 600, "parts: the item ID")
eq(pt and pt.enchant, 7364, "parts: the enchant ID")
eq(pt and pt.gems[1], 213746, "parts: the first gem")
eq(pt and pt.gems[2], nil, "parts: an empty socket field")
eq(pt and pt.gems[3], 213747, "parts: the third gem")
eq(pt and pt.gemCount, 2, "parts: two gems")
local bare = Gear.Parts("item:7")
check(bare and bare.enchant == nil and bare.gemCount == 0, "parts: an item with nothing in it")
eq(Gear.Parts("|cffa335ee|Hitem:8:55|h[x]|h|r").enchant, 55, "parts: from a link")
eq(Gear.Parts(nil), nil, "parts: nil")
eq(Gear.Parts("spell:5"), nil, "parts: not an item")
eq(Gear.Parts("item:9:0:0").enchant, nil, "parts: a zero is no enchant")

-- 10. Sockets (C_Item.GetItemNumSockets, as Blizzard's own inspect frame reads them)
C_Item.GetItemNumSockets = function(s) if s == "item:600:1" then return 2 elseif s == "item:601" then error("boom") end return 0 end
eq(Gear.Sockets("item:600:1"), 2, "sockets: the count")
eq(Gear.Sockets("item:602"), 0, "sockets: none")
eq(Gear.Sockets("item:601"), nil, "sockets: a failing call is unknown")
eq(Gear.Sockets(nil), nil, "sockets: no item")
issecretvalue = function(v) return v == 7777 end
C_Item.GetItemNumSockets = function() return 7777 end
eq(Gear.Sockets("item:600"), nil, "sockets: a secret count is unknown")
issecretvalue = nil
C_Item.GetItemNumSockets = nil
eq(Gear.Sockets("item:600"), nil, "sockets: no game call is unknown")

-- 11. Weapons and the average item level
check(Gear.IsWeapon("INVTYPE_WEAPON") and Gear.IsWeapon("INVTYPE_2HWEAPON") and Gear.IsWeapon("INVTYPE_WEAPONOFFHAND"), "weapons: one- and two-handers")
check(not Gear.IsWeapon("INVTYPE_SHIELD") and not Gear.IsWeapon("INVTYPE_HOLDABLE") and not Gear.IsWeapon(nil), "weapons: not a shield or an off-hand item")
local set = {}
for i, s in ipairs(Gear.SLOTS) do set[i] = { slot = s.id, id = 1000 + i, ilvl = 280 } end
eq(Gear.AverageLevel(set), 280, "average: every slot at 280")
set[15] = { slot = 16, id = 502, itemString = "item:502", ilvl = 296 } -- a two-hander
table.remove(set, 16) -- and no off hand
eq(Gear.AverageLevel(set), 282, "average: a two-hander with no off hand counts twice")
table.remove(set, 1)
eq(Gear.AverageLevel(set), 264.5, "average: an empty slot counts 0")
eq(Gear.AverageLevel({}), nil, "average: no pieces")
eq(Gear.AverageLevel({ { slot = 1, id = 1 } }), nil, "average: no item level read")

-- 12. ReadUnit: another player's gear while inspected (the same reads as yours, any unit)
local THEIRS = { [1] = "|cffa335ee|Hitem:800:7364::::::::90:577|h[Their Hat]|h|r", [11] = "|cffa335ee|Hitem:801|h[Ring]|h|r" }
ILVL[THEIRS[1]], ILVL[THEIRS[11]] = 285, 279
GetInventoryItemLink = function(unit, slot) if unit == "raid3" then return THEIRS[slot] end return LINKS[slot] end
GetInventoryItemID = function(unit, slot)
  if unit == "raid3" then if slot == 12 then return 802 end local l = THEIRS[slot] return l and tonumber(l:match("item:(%d+)")) end
  local l = LINKS[slot] return l and tonumber(l:match("item:(%d+)"))
end
local got, missing = Gear:ReadUnit("raid3")
eq(#got, 2, "read unit: the two linked pieces")
eq(got[1].itemString, "item:800:7364::::::::90:577", "read unit: the exact item string")
eq(got[1].ilvl, 285, "read unit: its item level")
eq(got[2].slot, 11, "read unit: in slot order")
eq(missing, 1, "read unit: a slot with an item but no link yet is counted as missing")
THEIRS[3] = "|cffa335ee|Hitem:803|h[Pads]|h|r" -- no item level loaded yet
local got3, missing3 = Gear:ReadUnit("raid3")
eq(#got3, 3, "read unit: a piece with no item level yet is still read")
eq(missing3, 2, "read unit: and counted as missing, to be read again")
THEIRS[3] = nil
eq(Gear:Mine(1) and Gear:Mine(1).id or nil, nil, "read unit: your own cache is untouched")
eq(#Gear:ReadUnit(nil), 0, "read unit: no unit")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, 'CRT_Core/Gear.lua'), 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
