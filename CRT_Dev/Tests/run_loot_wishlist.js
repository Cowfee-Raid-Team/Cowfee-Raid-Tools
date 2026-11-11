// Loot Master wishlists (CRT_Modules/LootMaster/Wishlist.lua and WishlistJournal.lua, Issue #1263). One Lua state plays
// every client in turn (who you are, your rank in the group and your saved list are swapped), with the messages caught
// and delivered by hand: the list kept per character (add, change, remove, rank order, keyed by item ID only); the X
// message's round trip in parts that fit, bad input ignored; only the loot master, the leader and assists keep lists
// they hear; a list held during a boss encounter and sent after it; the loot master's ask; the roll windows' Wishlist
// column and its tiebreak (Session:Rows); the Encounter Journal's right-click menu hooked onto the loot rows without
// replacing the game's mixin or scripts (a stand-in Journal); the item tooltip line, and none for a secret item ID;
// and the Journal's loot read for a boss with the Journal's own choices put back.
// Usage: node run_loot_wishlist.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, commSrc, wishSrc, journalSrc, winSrc = ...
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
local SECRET = setmetatable({}, { __tostring = function() return "secret" end })
issecretvalue = function(v) return v == SECRET end
local ME = "Solex"
-- the group: Solex leads, Halo is an assist, Quick and Arrow are raiders
local GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras", "Arrow-Sargeras" }, leader = "Solex-Sargeras", assists = { ["Halo-Sargeras"] = true } }
local function fullOf(u)
  if u == "player" then return ME .. "-Sargeras" end
  local i = tonumber((u or ""):match("^raid(%d+)$"))
  return GROUP and i and GROUP.names[i]
end
UnitName = function(u)
  if u == "player" then return ME end
  local f = fullOf(u)
  if f then local n = f:match("^(.-)%-") return n end
end
GetNormalizedRealmName = function() return "Sargeras" end
IsInGroup = function() return GROUP ~= nil end
IsInRaid = function() return GROUP ~= nil end
GetNumGroupMembers = function() return GROUP and #GROUP.names or 0 end
GetNumSubgroupMembers = function() return 0 end
GetRaidRosterInfo = function(i) return GROUP and GROUP.names[i] end
UnitIsGroupLeader = function(u) return GROUP ~= nil and fullOf(u) == GROUP.leader end
UnitIsGroupAssistant = function(u) return GROUP ~= nil and GROUP.assists[fullOf(u) or ""] == true end
UnitClass = function() return "Paladin", "PALADIN", 2 end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers+1] = fn end, NewTicker = function(s, fn) return { Cancel = function() end } end }
local function runTimers() for _ = 1, 5 do local t = timers timers = {} for _, fn in ipairs(t) do fn() end end end
local outbox, LOCKED = {}, false
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return LOCKED end,
  SendAddonMessage = function(p, text, ch) outbox[#outbox+1] = text return 0 end }
local frames = {}
local function onEvent(event, ...) for _, f in ipairs(frames) do if f.events[event] and f.fn then f.fn(f, event, ...) end end end
function CreateFrame()
  local f = { events = {} }
  f.RegisterEvent = function(me, e) me.events[e] = true end
  f.UnregisterEvent = function(me, e) me.events[e] = nil end
  f.SetScript = function(me, _, fn) me.fn = fn end
  frames[#frames + 1] = f
  return f
end
local NAMES = { [212401] = "Coiled Fang", [212402] = "Venom Ring", [212403] = "Scale Mantle" }
C_Item = { GetItemInfo = function(id) id = tonumber(tostring(id):match("(%d+)")) if NAMES[id] then return NAMES[id], "|Hitem:" .. id .. "|h[" .. NAMES[id] .. "]|h", 4 end end,
  GetItemIconByID = function(id) return 5000 end, GetItemInfoInstant = function(id) return id, "Armor", "Plate", "INVTYPE_SHOULDER" end }
INVTYPE_SHOULDER = "Shoulder"
-- the tooltip hook
local tooltipCalls = {}
Enum = { TooltipDataType = { Item = 0 } }
TooltipDataProcessor = { AddTooltipPostCall = function(kind, fn) tooltipCalls[#tooltipCalls + 1] = { kind = kind, fn = fn } end }
-- the menus opened: the owner and what the generator put in
local menus = {}
local function fakeRoot()
  local root = { items = {} }
  function root:CreateTitle(t) self.items[#self.items + 1] = { kind = "title", text = t } end
  function root:CreateButton(t, fn) local b = fakeRoot() b.kind, b.text, b.fn = "button", t, fn self.items[#self.items + 1] = b return b end
  function root:CreateRadio(t, isSel, setSel, data) local r = { kind = "radio", text = t, isSel = isSel, setSel = setSel, data = data } self.items[#self.items + 1] = r return r end
  return root
end
local CRT = { UI = {
  ContextMenu = function(owner, fill) local root = fakeRoot() fill(root) menus[#menus + 1] = { owner = owner, root = root } return {} end,
  Color = function(key) local c = ({ good = { 0, 1, 0 }, warn = { 1, 0.5, 0 }, muted = { 0.5, 0.5, 0.5 } })[key] or { 1, 1, 1 } return c[1], c[2], c[3], 1 end,
  ColorText = function(text, key) return "<" .. key .. ">" .. text end,
} }
local function settings() return { responseSeconds = 60, authority = { leader = true, names = {} }, sort = {} } end
CRT.db = { lootmaster = settings() }
local CHARS = { Solex = {}, Halo = {}, Quick = {}, Arrow = {} }
CRTDBChar = CHARS.Solex
local function be(name) ME = name CRTDBChar = CHARS[name] end
function CRT:Print() end
CRT.Groups = { Normalize = function(n) return n end }
local slashWords = {}
CRT.Slash = { Register = function(_, word, def) slashWords[word] = def end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(wishSrc, "Wishlist.lua"))("CowfeeRaidTools", CRT)
local W = LM.Wishlist
check(W ~= nil, "Wishlist.lua makes LM.Wishlist")
check(slashWords.wishlist ~= nil, "/crt wishlist is registered")
local function msg(text, sender) onEvent("CHAT_MSG_ADDON", LM.PREFIX, text, "RAID", sender) end
local function deliver(box, sender) for _, text in ipairs(box) do msg(text, sender) end end
local function take() local box = outbox outbox = {} return box end
-- each player keeps their own heard lists: swap W.lists with who you are
local HEARD = { Solex = {}, Halo = {}, Quick = {}, Arrow = {} }
local function as(name) HEARD[ME] = W.lists be(name) W.lists = HEARD[name] end

-- 1. Your list: add, change, remove, rank order, item ID only
be("Quick") W.lists = HEARD.Quick
eq(W.Count(), 0, "store: empty at first")
eq(W.Set(212401, "big"), true, "store: add")
eq(W.Rank(212401), "big", "store: its rank")
check(type(CHARS.Quick.lootmaster) == "table" and type(CHARS.Quick.lootmaster.wishlist[212401]) == "table", "store: per character, CRTDBChar.lootmaster.wishlist")
eq(CHARS.Quick.lootmaster.wishlist[212401].at, 1790000000, "store: when it was added")
eq(W.Set("|cffa335ee|Hitem:212401::::::::80:::3:6652:10356:1498|h[Coiled Fang]|h|r", "small"), true, "store: a Journal link with bonus IDs changes the same item")
eq(W.Rank("item:212401:0:0"), "small", "store: any difficulty is the same item")
eq(W.Set(212401, "small"), false, "store: the same rank changes nothing")
eq(W.Set(212402, "bogus"), false, "store: a bad rank is refused")
eq(W.Set("nonsense", "big"), false, "store: a bad item is refused")
eq(W.Set(SECRET, "big"), false, "store: a secret item is refused")
W.Set(212402, "off") W.Set(212403, "big")
local items = W.Items()
eq(#items, 3, "store: three items")
eq(items[1].id, 212403, "order: Big upgrade first")
eq(items[2].id, 212401, "order: then Small upgrade")
eq(items[3].id, 212402, "order: then Off spec")
eq(W.Order("big") > W.Order("small") and W.Order("small") > W.Order("off") and W.Order(nil) == 0, true, "order: big > small > off > none")
eq(W.Remove(212402), true, "store: remove")
eq(W.Rank(212402), nil, "store: removed")
eq(W.Count(), 2, "store: two left")
eq(W.Label("big"), "Big upgrade", "label: Big upgrade")
eq(W.Label("small"), "Small upgrade", "label: Small upgrade")
eq(W.Label("off"), "Off spec", "label: Off spec")
runTimers() take()

-- 2. The message: round trip in parts that fit, every part 255 bytes or less
local many = {}
for i = 1, 150 do many[#many + 1] = { id = 900000 + i, rank = W.RANKS[(i % 3) + 1] } end
local box = W.Encode("a1", many)
check(#box >= 3, "encode: 150 items in several parts (" .. #box .. ")")
for i, text in ipairs(box) do
  check(#text <= 255, "encode: part " .. i .. " fits (" .. #text .. ")")
  check(text:find("^X|a1:" .. string.format("%02d/%02d", i, #box) .. "|") ~= nil, "encode: part " .. i .. " head " .. text:sub(1, 14))
end
local stamp, i, n = W.ParseHead("a1:02/05")
eq(stamp == "a1" and i == 2 and n == 5, true, "head: reads")
eq(W.ParseHead("a1:06/05"), nil, "head: a part past the count is refused")
eq(W.ParseHead("zz:01/01"), nil, "head: a stamp that isn't hex is refused")
eq(W.ParseHead("a1:01/99"), nil, "head: too many parts is refused")
eq(W.ParseHead(nil), nil, "head: nothing is refused")
local parts = {}
for _, text in ipairs(box) do local _, f = LM.Wire.Decode(text) parts[#parts + 1] = f[2] end
local back = W.Decode(parts)
local count = 0 for _ in pairs(back) do count = count + 1 end
eq(count, 150, "decode: every item back")
eq(back[900003], "big", "decode: ranks back")
local bad = W.Decode({ "12,b;abc,s;0,o;55,x;;77;-4,b;88,o" })
eq(bad[12], "big", "decode: a good entry kept")
eq(bad[88], "off", "decode: the last good entry kept")
local nBad = 0 for _ in pairs(bad) do nBad = nBad + 1 end
eq(nBad, 2, "decode: bad IDs and ranks left out")
local empty = W.Encode("b2", {})
eq(#empty, 1, "encode: an empty list is one part")
eq(empty[1], "X|b2:01/01|", "encode: with no entries")

-- 3. Sending in a group, and who keeps it: Halo (assist) and Solex (leader) keep, Arrow (raider) doesn't
be("Quick")
W.Set(212402, "big")
eq(W.Pending(), true, "send: a change waits to go")
eq(#outbox, 0, "send: not at once")
runTimers()
local sent = take()
eq(#sent, 1, "send: one message after the delay")
eq(W.status, "sent", "send: the window's line says sent")
eq(W.StatusText(), "Sent to the loot master.", "send: wording")
as("Halo") deliver(sent, "Quick-Sargeras")
eq(W.RankFor("Quick-Sargeras", 212402), "big", "assist: keeps Quick's list")
eq(W.RankFor("Quick-Sargeras", "item:212401:::"), "small", "assist: by item ID")
eq(W.RankFor("Quick-Sargeras", 1), nil, "assist: an item not on it")
as("Solex") deliver(sent, "Quick-Sargeras")
eq(W.RankFor("Quick-Sargeras", 212403), "big", "leader: keeps it too")
as("Arrow") deliver(sent, "Quick-Sargeras")
eq(W.RankFor("Quick-Sargeras", 212403), nil, "raider: ignores it")
check(next(W.lists) == nil, "raider: keeps nothing")
GROUP.authority = true
-- a looter the leader named (not leader, not assist) keeps lists too
as("Solex") CRT.db.lootmaster.authority = { leader = true, names = { "Arrow-Sargeras" } }
LM:SendAuthority() local auth = take()
as("Arrow") deliver(auth, "Solex-Sargeras")
deliver(sent, "Quick-Sargeras")
eq(W.RankFor("Quick-Sargeras", 212403), "big", "named looter: keeps it")
-- a list in parts: kept only once every part is in; a new stamp replaces an unfinished one
as("Halo")
local big = W.Encode("c3", many)
for k = 1, #big - 1 do msg(big[k], "Arrow-Sargeras") end
eq(W.lists["Arrow-Sargeras"], nil, "parts: not kept before the last part")
msg(big[#big], "Arrow-Sargeras")
eq(W.RankFor("Arrow-Sargeras", 900150), W.RANKS[(150 % 3) + 1], "parts: kept once all are in")
deliver({ "X|zz:01/01|5,b", "X|d4:02/01|5,b", "X|d4|5,b", "X||", "X" }, "Arrow-Sargeras")
eq(W.RankFor("Arrow-Sargeras", 5), nil, "bad heads: ignored")
eq(W.RankFor("Arrow-Sargeras", 900150) ~= nil, true, "bad heads: the list kept stays")
deliver(W.Encode("e5", {}), "Arrow-Sargeras")
eq(W.RankFor("Arrow-Sargeras", 900150), nil, "empty list: clears what was kept")

-- 4. During a boss encounter: held, sent after ENCOUNTER_END
as("Quick")
onEvent("ENCOUNTER_START", 3470, "Boss", 16, 20)
W.Set(212403, "off")
runTimers()
eq(#outbox, 0, "encounter: nothing sent during it")
eq(W.status, "held", "encounter: the line says it waits")
eq(W.StatusText(), "Will send after the fight.", "encounter: wording")
onEvent("ENCOUNTER_END", 3470, "Boss", 16, 20, 1)
runTimers()
local after = take()
eq(#after, 1, "encounter: sent after it ends")
as("Halo") deliver(after, "Quick-Sargeras")
eq(W.RankFor("Quick-Sargeras", 212403), "off", "encounter: the change arrived")
-- the chat lockdown alone holds it too
as("Quick") LOCKED = true
W.Set(212403, "small") runTimers()
eq(#outbox, 0, "lockdown: held")
LOCKED = false
onEvent("ENCOUNTER_END", 3470, "Boss", 16, 20, 0) runTimers()
eq(#take(), 1, "lockdown: sent once it ends")

-- 5. The ask: from the leader or an assist everyone sends (an empty list too); from a raider nobody does
as("Arrow")
eq(W.Count(), 0, "ask: Arrow has an empty list")
deliver({ "X|?" }, "Arrow-Sargeras") runTimers()
eq(#outbox, 0, "ask: your own ask is not answered")
as("Quick") deliver({ "X|?" }, "Arrow-Sargeras") runTimers()
eq(#outbox, 1, "ask: a named looter's ask is answered")
take()
as("Arrow") CRT.db.lootmaster.authority = { leader = true, names = {} }
as("Solex") LM:SendAuthority() auth = take()
as("Quick") deliver(auth, "Solex-Sargeras")
deliver({ "X|?" }, "Arrow-Sargeras") runTimers()
eq(#outbox, 0, "ask: a raider's ask is ignored")
as("Arrow") deliver(auth, "Solex-Sargeras") deliver({ "X|?" }, "Halo-Sargeras") runTimers()
local reply = take()
eq(#reply, 1, "ask: an assist's ask gets even an empty list")
eq(reply[1]:find("^X|%x+:01/01|$") ~= nil, true, "ask: the empty list " .. tostring(reply[1]))
-- the loot master asks at a session start
as("Solex")
LM:Fire("started", {})
local asked = take()
eq(asked[1], "X|?", "ask: the loot master asks at a session start")
LM:Fire("started", {})
eq(#take(), 0, "ask: not again so soon")
NOW = NOW + 60
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
LM:Fire("started", {})
eq(#take(), 0, "ask: held during an encounter")
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 1)
eq(take()[1], "X|?", "ask: sent after it")

-- 6. The roll windows: the Wishlist column and its tiebreak
as("Solex")
W.lists["Quick-Sargeras"] = { items = { [212401] = "small" }, at = 0 }
W.lists["Halo-Sargeras"] = { items = { [212401] = "big" }, at = 0 }
local s = LM.Session.New({ id = "s1", leader = "Solex-Sargeras", items = { { itemString = "item:212401::::::::80" } } })
s:Expect({ "Arrow-Sargeras", "Halo-Sargeras", "Quick-Sargeras", "Solex-Sargeras" })
s:Answer("Arrow-Sargeras", 1, { response = "up" })
s:Answer("Halo-Sargeras", 1, { response = "up" })
s:Answer("Quick-Sargeras", 1, { response = "bis" })
s:Answer("Solex-Sargeras", 1, { response = "up" })
CHARS.Solex.lootmaster = { wishlist = { [212401] = { rank = "off", at = 0 } } }
local plain = s:Rows(1)
eq(plain[1].name, "Quick-Sargeras", "rows: without wishlists, the weight first")
eq(plain[2].name, "Arrow-Sargeras", "rows: then by name, as before")
eq(plain[2].wish, nil, "rows: no wish without the lookup")
local rows = s:Rows(1, nil, W.RankFor)
eq(rows[1].name, "Quick-Sargeras", "tiebreak: a higher answer still wins over a better wish")
eq(rows[1].wish, "small", "column: Quick's Small upgrade")
eq(rows[2].name, "Halo-Sargeras", "tiebreak: Big upgrade first among equal answers")
eq(rows[3].name, "Solex-Sargeras", "tiebreak: then your own Off spec (from your own list)")
eq(rows[4].name, "Arrow-Sargeras", "tiebreak: Not listed last")
eq(rows[4].wish, nil, "column: Arrow not listed")
eq(W.Cell(rows[2].wish), "<good>Big upgrade", "cell: Big upgrade in the good colour")
eq(W.Cell("small"), "<warn>Small upgrade", "cell: Small upgrade in warn")
eq(W.Cell("off"), "<muted>Off spec", "cell: Off spec muted")
eq(W.Cell(nil), "<muted>Not listed", "cell: Not listed muted")
eq(LM.SORT_VALUES.wish(rows[2]), 3, "sort: the column sorts by rank")
eq(LM.SORT_VALUES.wish(rows[4]), 0, "sort: not listed is lowest")
local byName = LM.SortRows(s:Rows(1, nil, W.RankFor), "name", 1)
eq(byName[1].name, "Arrow-Sargeras", "sort: a header the looter picked wins")

-- 7. Leaving the group forgets the lists heard
GROUP = nil
onEvent("GROUP_ROSTER_UPDATE")
check(next(W.lists) == nil, "left the group: lists forgotten")
W.Set(212401, "big") runTimers()
eq(#outbox, 0, "solo: nothing sent out of a group")
eq(W.StatusText(), "Sends when you join a group.", "solo: wording")
GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras" }, leader = "Solex-Sargeras", assists = {} }
onEvent("GROUP_ROSTER_UPDATE") runTimers()
local joined = take()
local hasList = false
for _, t in ipairs(joined) do if t:find("^X|%x+:") then hasList = true end end
check(hasList, "joined a group: your list goes")

-- 8. The Encounter Journal: a stand-in, loaded after CRT (load-on-demand)
assert(load(journalSrc, "WishlistJournal.lua"))("CowfeeRaidTools", CRT)
eq(#tooltipCalls, 1, "tooltip: one post call")
eq(tooltipCalls[1].kind, 0, "tooltip: for item tooltips")
local origInit = function(self, data) self.itemID = data.itemID self.link = "|Hitem:" .. data.itemID .. "|h" end
EncounterJournalItemMixin = { Init = origInit }
local callbacks = {}
local box = { frames = {} }
function box:RegisterCallback(event, fn, owner) callbacks[#callbacks + 1] = { event = event, fn = fn, owner = owner } end
function box:ForEachFrame(fn) for _, f in ipairs(self.frames) do fn(f, f.data) end end
ScrollBoxListMixin = { Event = { OnInitializedFrame = "OnInitializedFrame" } }
ScrollUtil = { AddInitializedFrameCallback = function(sb, cb, owner, iterate)
  if iterate then sb:ForEachFrame(cb) end
  sb:RegisterCallback(ScrollBoxListMixin.Event.OnInitializedFrame, function(o, frame, data) cb(o, frame, data) end, owner)
end }
local function lootRow(isHeader)
  local f = { hooks = {}, scripts = {}, setScripts = 0 }
  if not isHeader then f.slot = {} f.icon = {} end
  f.HookScript = function(self, name, fn) self.hooks[name] = self.hooks[name] or {} table.insert(self.hooks[name], fn) end
  f.SetScript = function(self) self.setScripts = self.setScripts + 1 end
  return f
end
local early = lootRow()
box.frames[1] = early
EncounterJournal = { encounter = { info = { LootContainer = { ScrollBox = box } } }, IsShown = function() return true end }
onEvent("ADDON_LOADED", "Blizzard_EncounterJournal")
eq(#callbacks, 1, "journal: one initialized-frame callback on the loot list")
eq(EncounterJournalItemMixin.Init, origInit, "journal: the game's mixin is not replaced")
eq(early.hooks.OnMouseUp and #early.hooks.OnMouseUp, 1, "journal: a row made before is hooked too")
local row, header = lootRow(), lootRow(true)
origInit(row, { itemID = 212403 })
callbacks[1].fn(callbacks[1].owner, row, {})
callbacks[1].fn(callbacks[1].owner, row, {})
callbacks[1].fn(callbacks[1].owner, header, {})
eq(row.hooks.OnMouseUp and #row.hooks.OnMouseUp, 1, "journal: hooked once, however often it is drawn")
eq(row.setScripts, 0, "journal: no script of the game's replaced")
eq(header.hooks.OnMouseUp, nil, "journal: a header row is left alone")
onEvent("ADDON_LOADED", "Blizzard_EncounterJournal")
eq(#callbacks, 1, "journal: installed once")
be("Quick") W.lists = HEARD.Quick
W.Remove(212403)
menus = {}
row.hooks.OnMouseUp[1](row, "LeftButton") runTimers()
eq(#menus, 0, "journal: a left click opens no menu")
row.hooks.OnMouseUp[1](row, "RightButton")
eq(#menus, 0, "journal: the menu waits for the game's own click")
runTimers()
eq(#menus, 1, "journal: a right click opens the menu")
eq(menus[1] and menus[1].owner, EncounterJournal, "journal: over the Journal")
local root = menus[1].root
eq(root.items[1].kind, "title", "menu: a title")
eq(root.items[1].text, "Scale Mantle", "menu: the item's name")
local add = root.items[2]
eq(add.text, "Add to wishlist", "menu: Add to wishlist")
eq(#add.items, 3, "menu: three ranks")
eq(add.items[1].text, "Big upgrade", "menu: Big upgrade first")
eq(add.items[3].text, "Off spec", "menu: Off spec last")
eq(#root.items, 2, "menu: no Remove when it isn't listed")
add.items[1].setSel(add.items[1].data)
eq(W.Rank(212403), "big", "menu: picking a rank lists the item")
row.hooks.OnMouseUp[1](row, "RightButton") runTimers()
root = menus[2].root
eq(root.items[2].items[1].isSel(root.items[2].items[1].data), true, "menu: your rank ticked")
eq(root.items[2].items[2].isSel(root.items[2].items[2].data), false, "menu: the others not")
eq(root.items[3] and root.items[3].text, "Remove from wishlist", "menu: Remove when listed")
root.items[3].fn()
eq(W.Rank(212403), nil, "menu: Remove takes it off")

-- 9. The tooltip line
local lines = {}
local tip = { AddLine = function(self, text, r, g, b) lines[#lines + 1] = { text = text, r = r, g = g, b = b } end }
W.Set(212401, "big")
tooltipCalls[1].fn(tip, { id = 212401 })
eq(lines[1] and lines[1].text, "Wishlist: Big upgrade", "tooltip: the line for a listed item")
eq(lines[1] and lines[1].g, 1, "tooltip: in the rank's colour")
tooltipCalls[1].fn(tip, { id = 999 })
eq(#lines, 1, "tooltip: no line for an item not listed")
tooltipCalls[1].fn(tip, { id = SECRET })
eq(#lines, 1, "tooltip: no line for a secret item ID")
tooltipCalls[1].fn(tip, { hyperlink = "|Hitem:212401::::|h" })
eq(#lines, 2, "tooltip: read from the hyperlink without an id")
tooltipCalls[1].fn(tip, { id = SECRET, hyperlink = "|Hitem:212401::::|h" })
eq(#lines, 2, "tooltip: a secret id is never worked around")
tooltipCalls[1].fn(tip, SECRET)
eq(#lines, 2, "tooltip: secret data skipped")

-- 10. The Journal's loot for a boss: read, and the Journal's own choices put back
local EJ = { instance = 77, encounter = 501, class = 0, spec = 0, slot = 4, numCalls = 0 }
EncounterJournal.encounterID = 501
local INSTANCES = { 1300 }
local BOSSES = { [1300] = { { journal = 2601, dungeon = 3470 }, { journal = 2602, dungeon = 3497 } } }
local LOOT = { [2601] = { 212401, 212402, 212401 }, [2602] = {} }
local CLASS_LOOT = { [2601] = { 212402 } }
EJ_GetCurrentInstance = function() return EJ.instance end
EJ_GetInstanceByIndex = function(i, raid) if raid and INSTANCES[i] then return INSTANCES[i], "A Raid" end end
EJ_SelectInstance = function(id) EJ.instance = id EJ.encounter = nil end
EJ_GetEncounterInfoByIndex = function(j) local b = BOSSES[EJ.instance] and BOSSES[EJ.instance][j] if b then return "Boss", "", b.journal end end
EJ_GetEncounterInfo = function(jid) for _, list in pairs(BOSSES) do for _, b in ipairs(list) do if b.journal == jid then return "Boss", "", jid, 1, "", 1300, b.dungeon end end end end
EJ_SelectEncounter = function(jid) EJ.encounter = jid end
EJ_GetLootFilter = function() return EJ.class, EJ.spec end
EJ_SetLootFilter = function(c, sp) EJ.class, EJ.spec = c, sp end
local function list() local src = (EJ.class ~= 0 and CLASS_LOOT or LOOT)[EJ.encounter] or {} return src end
EJ_GetNumLoot = function() return EJ.slot == 0 and #list() or 0 end
C_EncounterJournal = {
  GetSlotFilter = function() return EJ.slot end, ResetSlotFilter = function() EJ.slot = 0 end, SetSlotFilter = function(v) EJ.slot = v end,
  GetLootInfoByIndex = function(i) local id = list()[i] if id then return { itemID = id, name = NAMES[id], icon = 7000, itemQuality = 4, slot = "Shoulder" } end end,
}
Item = { CreateFromItemID = function(_, id) return { ContinueOnItemLoad = function() end } end }
local loot, why = W.BossLoot(3470, false)
eq(loot and #loot, 2, "loot: the boss's items, each once (" .. tostring(why) .. ")")
eq(loot and loot[1].id, 212401, "loot: in the Journal's order")
eq(loot and loot[1].name, "Coiled Fang", "loot: the name")
eq(loot and loot[1].slot, "Shoulder", "loot: the slot")
eq(EJ.instance, 77, "loot: the Journal's instance put back")
eq(EJ.encounter, 501, "loot: the Journal's boss put back")
eq(EJ.slot, 4, "loot: the Journal's slot filter put back")
eq(EJ.class, 0, "loot: the Journal's class filter put back")
EJ.class, EJ.spec = 5, 0
local mine = W.BossLoot(3470, true)
eq(mine and #mine, 1, "loot: Only my class reads with your class's filter")
eq(mine and mine[1].id, 212402, "loot: your class's item")
eq(EJ.class, 5, "loot: a filter the Journal had is put back")
local none, why2 = W.BossLoot(3497, false)
eq(none, nil, "loot: none yet")
eq(why2, "loading", "loot: waiting for the Journal's data")
W.BossLoot(3497, false)
local none3 = W.BossLoot(3497, false)
eq(none3 and #none3, 0, "loot: still none after the Journal answered: the boss has none")
local _, why4 = W.BossLoot(9999, false)
eq(why4, "missing", "loot: a boss not in the Journal")

-- 11. The My wishlist window, on stand-in frames: rows once per pick, a tick lists the item, the rank dropdown, the line
local function mock(kind)
  local o = { kind = kind, shown = kind ~= "window", scripts = {}, points = {}, checked = false }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, v) self.text = v end, GetText = function(self) return self.text end,
      Show = function(self) self.shown = true if self.scripts.OnShow then self.scripts.OnShow(self) end end,
      Hide = function(self) self.shown = false end, IsShown = function(self) return self.shown end,
      SetShown = function(self, v) self.shown = v and true or false end,
      SetChecked = function(self, v) self.checked = v and true or false end, GetChecked = function(self) return self.checked end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      HookScript = function(self, name, fn) self.scripts[name] = fn end,
      SetPoint = function(self, ...) self.points[#self.points + 1] = { ... } end,
      CreateFontString = function() return mock("fs") end, CreateTexture = function() return mock("tex") end,
      SetDataProvider = function(self, rows) self.rows = rows end,
      SetElementInitializer = function(self, kind, fn) self.init = fn end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
CreateFrame = function(kind) return mock(kind) end
CreateScrollBoxListLinearView = function() return mock("view") end
local listView
ScrollUtil.InitScrollBoxListWithScrollBar = function(box, bar, view) box.view = view listView = box end
CreateDataProvider = function(rows) return rows end
GameTooltip = mock("tip")
local dropdowns = {}
CRT.UI.Window = function(name, opts) local w = mock("window") w.content, w.strip = mock(), mock() w.opts = opts return w end
CRT.UI.Dropdown = function(parent, text, opts) local d = mock("dropdown") d.opts = opts d.refresh = function() end dropdowns[#dropdowns + 1] = d return d end
CRT.UI.SkinCheckButton = function() end
CRT.UI.SkinScrollBar = function() end
CRT.UI.Tint = function() end
CRT.UI.TooltipOwner = function() end
CRT.UI.OnTheme = function() end
LM.LIST_SCROLL_GAP = 20
CRT.db.lootmaster.wishlistWindow = {}
CRT.Bosses = {
  Current = function() return { key = "s2" } end,
  Options = function() return { { key = "raid:s2", label = "A Raid", title = true }, { key = 3470, label = "First Boss" }, { key = 3497, label = "Second Boss" } } end,
  RouteList = function() return { { encounterID = 3470, name = "First Boss" }, { encounterID = 3497, name = "Second Boss" } } end,
  Get = function(_, id) return ({ [3470] = { encounterID = 3470, name = "First Boss" } })[id] end,
}
assert(load(winSrc, "WishlistWindow.lua"))("CowfeeRaidTools", CRT)
W.ForgetLoot()
EJ.class, EJ.spec = 0, 0
W.Remove(212401) W.Remove(212402)
LM:ShowWishlist()
local parts = LM.WishlistWindowParts()
check(parts.win and parts.win.shown, "window: opens")
eq(parts.win.opts.saved(), CRT.db.lootmaster.wishlistWindow, "window: its place kept in lootmaster.wishlistWindow")
local bossDrop = parts.boss
local opts = bossDrop.opts.options()
eq(opts[1].key, "all", "window: All bosses first")
eq(opts[1].label, "All bosses", "window: wording")
eq(opts[2].title, true, "window: then the season's raids and bosses in route order")
eq(opts[3].key, 3470, "window: the first boss")
eq(bossDrop.opts.get(), "all", "window: All bosses picked at first")
local rws = listView.rows
eq(rws and rws[1] and rws[1].header, "First Boss", "window: All bosses heads each boss")
eq(rws and rws[2] and rws[2].item and rws[2].item.id, 212401, "window: then its items")
eq(rws and #rws, 3, "window: a boss with no items gets no heading")
eq(parts.empty.shown, false, "window: no empty line with items")
bossDrop.opts.set(3470)
eq(CRT.db.lootmaster.wishlistWindow.boss, 3470, "window: the boss picked is kept")
rws = listView.rows
eq(rws[1].header, nil, "window: one boss has no heading")
eq(#rws, 2, "window: its two items")
-- a row drawn: the tick, the rank dropdown greyed with Not wanted, then ticked
local row = mock("row")
listView.view.init(row, rws[1])
eq(row.tick.checked, false, "row: unticked while not on your list")
local rankDrop = dropdowns[#dropdowns]
eq(rankDrop.opts.get(), "none", "row: the rank reads Not wanted")
eq(rankDrop.opts.options()[1].label, "Not wanted", "row: wording")
eq(rankDrop.opts.enabledIf(), false, "row: greyed while unticked")
eq(row.name.text, "Coiled Fang", "row: the item's name")
eq(row.slot.text, "Shoulder", "row: its slot")
row.tick.checked = true
row.tick.scripts.OnClick(row.tick)
eq(W.Rank(212401), "big", "row: a tick lists the item as Big upgrade")
eq(rankDrop.opts.enabledIf(), true, "row: the rank opens once ticked")
eq(#rankDrop.opts.options(), 3, "row: the three ranks")
rankDrop.opts.set("off")
eq(W.Rank(212401), "off", "row: the dropdown changes the rank")
rankDrop.opts.set("none")
eq(W.Rank(212401), "off", "row: a bad pick changes nothing")
row.tick.checked = false
row.tick.scripts.OnClick(row.tick)
eq(W.Rank(212401), nil, "row: unticking takes it off")
-- the journal menu's change shows in the window, and the status line
W.Set(212402, "small")
listView.view.init(row, listView.rows[2])
eq(row.tick.checked, true, "window: a change elsewhere shows on the next draw")
check(parts.status.text and parts.status.text:find("^1 item on your list%. ") ~= nil, "window: the line counts your list: " .. tostring(parts.status.text))
-- Only my class reads with your class filter
parts.classCheck.checked = true
parts.classCheck.scripts.OnClick(parts.classCheck)
eq(CRT.db.lootmaster.wishlistWindow.classOnly, true, "window: Only my class is kept")
eq(#listView.rows, 1, "window: only your class's item")
-- a boss not in the Journal
bossDrop.opts.set(9999)
eq(#listView.rows, 0, "window: no rows for a boss the Journal doesn't have")
eq(parts.empty.shown, true, "window: the empty line shows")
eq(parts.empty.text, "This boss isn't in the Adventure Guide's current expansion.", "window: and says why")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/Wishlist.lua', 'CRT_Modules/LootMaster/WishlistJournal.lua', 'CRT_Modules/LootMaster/WishlistWindow.lua']) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, 5, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
