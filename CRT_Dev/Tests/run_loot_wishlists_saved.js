// Saved raider wishlists, guild sync and the Wishlists tab (CRT_Modules/LootMaster/Wishlist.lua, WishlistSaved.lua,
// WishlistViews.lua and WishlistTab.lua, Issue #1269). One Lua state plays every client in turn (who you are, your
// guild rank, your group and your own list are swapped), with the messages caught (with their channel) and delivered
// by hand: who keeps lists (officer, assist, loot master, not a plain raider); the saved copy, newer wins, older or
// equal ignored, the cap, Forget and Forget all; the guild channel: a list on change (debounced) and on login
// (jittered), the officer's ask (rate limited) and the answers (jittered, at most once a minute); stray senders per
// channel; no guild traffic out of a guild; the encounter hold; and the tab's numbers: Bosses (counts, value, sort),
// Boss detail (who by rank), Raiders (counts, age, no list) and the Team filter, on stand-in frames.
// Usage: node run_loot_wishlists_saved.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const themeLua = require('./theme_stub');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = themeLua(process.argv.slice(2)) + `
local dataSrc, commSrc, wishSrc, savedSrc, viewsSrc, tabSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local NOW, CLOCK = 100, 1790000000
GetTime = function() return NOW end
time = function() return CLOCK end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
strtrim = function(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
local SECRET = setmetatable({}, { __tostring = function() return "secret" end })
issecretvalue = function(v) return v == SECRET end
local ME = "Solex"
-- the group: Solex leads, Halo is an assist, Quick and Arrow are raiders; Gild is a guild officer outside the group
local GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras", "Arrow-Sargeras" }, leader = "Solex-Sargeras", assists = { ["Halo-Sargeras"] = true } }
local CLASSES = { ["Quick-Sargeras"] = "ROGUE", ["Arrow-Sargeras"] = "HUNTER", ["Halo-Sargeras"] = "PRIEST", ["Solex-Sargeras"] = "PALADIN" }
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
LE_PARTY_CATEGORY_INSTANCE = 2
IsInGroup = function(category) return GROUP ~= nil and category ~= LE_PARTY_CATEGORY_INSTANCE end
IsInRaid = function() return GROUP ~= nil end
GetNumGroupMembers = function() return GROUP and #GROUP.names or 0 end
GetNumSubgroupMembers = function() return 0 end
GetRaidRosterInfo = function(i) return GROUP and GROUP.names[i] end
UnitIsGroupLeader = function(u) return GROUP ~= nil and fullOf(u) == GROUP.leader end
UnitIsGroupAssistant = function(u) return GROUP ~= nil and GROUP.assists[fullOf(u) or ""] == true end
UnitClass = function(u) local c = CLASSES[fullOf(u) or ""] return c and "Class", c end
-- the guild: who is in it, and who may edit officer notes
local GUILD = { Solex = true, Halo = true, Quick = true, Arrow = true, Gild = true }
local OFFICERS = { Gild = true }
IsInGuild = function() return GUILD[ME] == true end
C_GuildInfo = { CanEditOfficerNote = function() return OFFICERS[ME] == true end }
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers+1] = { s = s, fn = fn } end, NewTicker = function(s, fn) return { Cancel = function() end } end }
local function runTimers() for _ = 1, 6 do local t = timers timers = {} for _, e in ipairs(t) do e.fn() end end end
local outbox, LOCKED, RESULTS = {}, false, {} -- RESULTS[channel]: what the game answers there instead of sending
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return LOCKED end,
  SendAddonMessage = function(p, text, ch) local r = RESULTS[ch] if r then return r end outbox[#outbox+1] = { text = text, ch = ch } return 0 end }
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
C_Item = { GetItemInfo = function() end, GetItemIconByID = function() return 5000 end }
local popups = {}
local CRT = { UI = {
  Color = function(key) local c = ({ good = { 0, 1, 0 }, warn = { 1, 0.5, 0 }, muted = { 0.5, 0.5, 0.5 } })[key] or { 1, 1, 1 } return c[1], c[2], c[3], 1 end,
  ColorText = function(text, key) return "<" .. key .. ">" .. text end,
  LiftOver = function() end, ShownPopup = function(f) return f end,
} }
StaticPopup_ShowCustomGenericConfirmation = function(info) popups[#popups + 1] = info return {} end
local function settings() return { responseSeconds = 60, authority = { leader = true, names = {} }, sort = {}, wishlists = {}, wishlistsAsked = 0, wishlistsTab = {} } end
CRT.db = { lootmaster = settings(), classCache = { ["gild-sargeras"] = "MAGE" } }
local CHARS = { Solex = {}, Halo = {}, Quick = {}, Arrow = {}, Gild = {}, Lone = {} }
CRTDBChar = CHARS.Solex
local function be(name) ME = name CRTDBChar = CHARS[name] end
function CRT:Print() end
CRT.Groups = { Normalize = function(n) return n end }
CRT.Slash = { Register = function() end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
assert(load(wishSrc, "Wishlist.lua"))("CowfeeRaidTools", CRT)
local W = LM.Wishlist
assert(load(savedSrc, "WishlistSaved.lua"))("CowfeeRaidTools", CRT)
assert(load(viewsSrc, "WishlistViews.lua"))("CowfeeRaidTools", CRT)
local V = W.Views
check(type(W.Keep) == "function" and type(V) == "table", "the saved copies and the views load")
local function msg(text, sender, ch) onEvent("CHAT_MSG_ADDON", LM.PREFIX, text, ch or "RAID", sender) end
local function deliver(box, sender, ch) for _, m in ipairs(box) do msg(type(m) == "table" and m.text or m, sender, ch or (type(m) == "table" and m.ch)) end end
local function take() local box = outbox outbox = {} return box end
local function on(box, ch) local out = {} for _, m in ipairs(box) do if m.ch == ch then out[#out + 1] = m end end return out end
local function store() return CRT.db.lootmaster.wishlists end
local jitters = {}
W.Jitter = function(max) jitters[#jitters + 1] = max return max end

-- 1. Who keeps lists
be("Gild")
eq(W.Officer(), true, "who: a guild officer (may edit officer notes)")
eq(W.Keeps(), true, "who: an officer keeps lists")
be("Halo")
eq(W.Officer(), false, "who: an assist who isn't an officer")
eq(W.Keeps(), true, "who: an assist keeps lists")
be("Solex")
eq(W.Keeps(), true, "who: the raid leader keeps lists")
be("Quick")
eq(W.Keeps(), false, "who: a plain raider doesn't")
be("Arrow") CRT.db.lootmaster.authority = { leader = true, names = { "Arrow-Sargeras" } }
be("Solex") LM:SendAuthority() local auth = take()
be("Arrow") deliver(auth, "Solex-Sargeras")
eq(W.Keeps(), true, "who: a named loot master keeps lists")
CRT.db.lootmaster.authority = { leader = true, names = {} }
be("Solex") LM:SendAuthority() auth = take()
be("Arrow") deliver(auth, "Solex-Sargeras")
eq(W.Keeps(), false, "who: and not once off the list")
be("Gild") local api = C_GuildInfo C_GuildInfo = nil
eq(W.Officer(), false, "who: no guild API, no officer")
C_GuildInfo = { CanEditOfficerNote = function() return SECRET end }
eq(W.Officer(), false, "who: a secret answer is no")
C_GuildInfo = api
GUILD.Gild = nil
eq(W.Officer(), false, "who: out of a guild, no officer")
GUILD.Gild = true

-- 2. The saved copy: newer wins, older or equal ignored, the class, the cap, Forget
be("Gild")
eq(W.Keep("Quick-Sargeras", { [101] = "big", [102] = "small" }, 1000), true, "saved: a first copy")
local e = store()["Quick-Sargeras"]
check(e and e.items[101] == "big" and e.items[102] == "small", "saved: its items")
eq(e and e.at, 1000, "saved: the raider's stamp")
eq(e and e.got, CLOCK, "saved: when it arrived")
eq(e and e.class, "ROGUE", "saved: the class from the group")
eq(W.Keep("Quick-Sargeras", { [101] = "off" }, 999), false, "saved: an older list is ignored")
eq(W.Keep("Quick-Sargeras", { [101] = "off" }, 1000), false, "saved: an equal stamp is ignored")
eq(store()["Quick-Sargeras"].items[101], "big", "saved: the copy kept")
eq(W.Keep("Quick-Sargeras", { [101] = "off", [5] = "bogus" }, 1001), true, "saved: a newer list wins")
eq(store()["Quick-Sargeras"].items[101], "off", "saved: replaced")
eq(store()["Quick-Sargeras"].items[5], nil, "saved: a bad rank left out")
W.Keep("Gild-Sargeras", {}, 5)
eq(store()["Gild-Sargeras"].class, "MAGE", "saved: the class from the class cache outside the group")
eq(W.RankFor("Quick-Sargeras", 101), "off", "saved: the roll windows read the saved copy when none was heard")
W.lists["Quick-Sargeras"] = { items = { [101] = "small" }, at = 0 }
eq(W.RankFor("Quick-Sargeras", 101), "small", "saved: a list heard this login wins")
W.lists = {}
-- the cap: past SAVED_MAX the copy that arrived longest ago goes
CRT.db.lootmaster.wishlists = {}
for i = 1, W.SAVED_MAX do CLOCK = 1790000000 + i W.Keep("R" .. i .. "-Sargeras", { [1] = "big" }, 10) end
local n = 0 for _ in pairs(store()) do n = n + 1 end
eq(n, W.SAVED_MAX, "cap: " .. W.SAVED_MAX .. " kept")
CLOCK = 1790000000 + W.SAVED_MAX + 1
W.Keep("Newest-Sargeras", { [1] = "big" }, 10)
n = 0 for _ in pairs(store()) do n = n + 1 end
eq(n, W.SAVED_MAX, "cap: still " .. W.SAVED_MAX .. " after one more")
eq(store()["R1-Sargeras"], nil, "cap: the oldest arrival dropped")
check(store()["R2-Sargeras"] ~= nil and store()["Newest-Sargeras"] ~= nil, "cap: the rest kept")
eq(W.Forget("R2-Sargeras"), true, "forget: one raider")
eq(store()["R2-Sargeras"], nil, "forget: gone")
eq(W.Forget("Nobody-Sargeras"), false, "forget: nobody to forget")
W.AskForgetAll()
eq(#popups, 1, "forget all: asks first")
check(next(store()) ~= nil, "forget all: nothing gone before the click")
eq(popups[1].acceptText, "Forget all", "forget all: the button says Forget all")
popups[1].callback()
check(next(store()) == nil, "forget all: everything gone after the click")
CLOCK = 1790000000

-- 3. The guild: a list on change, debounced; with a group it goes to both
GROUP_SAVE = GROUP GROUP = nil
be("Quick") take() timers = {}
W.Set(201, "big") W.Set(202, "small") W.Set(203, "off")
eq(#outbox, 0, "guild: not at once")
eq(W.GuildPending(), true, "guild: the change waits")
runTimers()
local sent = take()
eq(#on(sent, "GUILD"), 1, "guild: three changes, one list on GUILD")
eq(#on(sent, "RAID"), 0, "guild: no group, nothing on RAID")
eq(W.status, "guild", "guild: the line says the guild got it")
eq(W.StatusText(), "Sent to your guild's officers.", "guild: wording")
local stamp1 = tonumber(sent[1].text:match("^X|(%x+):"), 16)
eq(stamp1, CHARS.Quick.lootmaster.wishlistAt, "guild: the stamp is when the list changed")
check(stamp1 >= CLOCK, "guild: a time, not a counter")
be("Gild") deliver(sent, "Quick-Sargeras", "GUILD")
eq(store()["Quick-Sargeras"] and store()["Quick-Sargeras"].items[201], "big", "officer: keeps a list from the guild, not grouped")
eq(store()["Quick-Sargeras"].at, stamp1, "officer: with the raider's stamp")
-- a change in the same second still counts as newer
be("Quick") W.Set(201, "small") runTimers()
local sent2 = take()
local stamp2 = tonumber(sent2[1].text:match("^X|(%x+):"), 16)
check(stamp2 > stamp1, "stamp: a second change in one second is still newer (" .. stamp1 .. " -> " .. stamp2 .. ")")
be("Gild") deliver(sent2, "Quick-Sargeras", "GUILD")
eq(store()["Quick-Sargeras"].items[201], "small", "officer: the newer list replaces the copy")
deliver(sent, "Quick-Sargeras", "GUILD")
eq(store()["Quick-Sargeras"].items[201], "small", "officer: the older list again changes nothing")
-- the echo of your own list on GUILD isn't kept
be("Gild") deliver(sent2, "Gild-Sargeras", "GUILD")
eq(store()["Gild-Sargeras"], nil, "officer: your own echo isn't kept")
GROUP = GROUP_SAVE
be("Quick") W.Set(204, "big") runTimers()
sent = take()
eq(#on(sent, "GUILD"), 1, "guild and group: one on GUILD")
eq(#on(sent, "RAID"), 1, "guild and group: one on RAID")
eq(on(sent, "GUILD")[1].text, on(sent, "RAID")[1].text, "guild and group: the same message")
-- both copies reach a keeper in the group: kept once
be("Halo") W.lists = {}
deliver(on(sent, "RAID"), "Quick-Sargeras", "RAID")
deliver(on(sent, "GUILD"), "Quick-Sargeras", "GUILD")
eq(W.lists["Quick-Sargeras"] and W.lists["Quick-Sargeras"].items[204], "big", "assist: the group's list for the roll windows")
eq(store()["Quick-Sargeras"].items[204], "big", "assist: saved too")

-- 4. Stray senders per channel; not in a guild, no guild traffic
be("Halo")
deliver(W.Encode("abc", { { id = 4242, rank = "big" } }), "Stranger-Elsewhere", "RAID")
eq(store()["Stranger-Elsewhere"], nil, "stray: a list on RAID from outside the group is ignored")
deliver(W.Encode("abc", { { id = 4242, rank = "big" } }), "Stranger-Elsewhere", "GUILD")
eq(store()["Stranger-Elsewhere"] and store()["Stranger-Elsewhere"].items[4242], "big", "stray: on GUILD a guild member counts")
W.Forget("Stranger-Elsewhere")
be("Arrow") -- a plain raider ignores lists on any channel
deliver(W.Encode("abd", { { id = 4243, rank = "big" } }), "Quick-Sargeras", "GUILD")
eq(store()["Quick-Sargeras"].items[4243], nil, "stray: a plain raider keeps nothing from the guild")
be("Lone") GROUP_SAVE = GROUP GROUP = nil take() timers = {}
W.Set(301, "big") runTimers()
eq(#take(), 0, "no guild: nothing sent anywhere")
eq(W.StatusText(), "Sends when you join a group.", "no guild: wording as before")
eq(LM.SendGuild("X|?"), false, "no guild: LM.SendGuild refuses")
eq(#take(), 0, "no guild: nothing queued")
eq(W.AskGuild(), false, "no guild: no ask")
GROUP = GROUP_SAVE

-- 4b. Two queues: a throttled guild channel never holds the group's loot messages; NotInGuild drops quietly
be("Quick") take() timers = {}
RESULTS.GUILD = 8 -- ChannelThrottle, on GUILD only
for i = 1, 20 do LM.SendGuild("X|ab:" .. string.format("%02d", i) .. "/20|1,b") end
LM.Send("K", { "hello" })
eq(#on(outbox, "RAID"), 1, "queues: a group message goes while the guild channel is throttled")
eq(#on(outbox, "GUILD"), 0, "queues: the guild's wait")
RESULTS.GUILD = nil
runTimers()
eq(#on(take(), "GUILD"), 20, "queues: the guild's go once the throttle lifts, every part")
local printed = 0
local realPrint = CRT.Print
CRT.Print = function() printed = printed + 1 end
RESULTS.GUILD = 10 -- NotInGuild: you left the guild
LM.SendGuild("X|?") LM.SendGuild("X|?")
RESULTS.GUILD = nil
runTimers()
eq(#take(), 0, "not in guild: what waits for the guild is dropped")
eq(printed, 0, "not in guild: without a word")
RESULTS.GUILD = 9 -- GeneralError: reported once
LM.SendGuild("X|?") LM.SendGuild("X|?")
RESULTS.GUILD = nil
eq(printed, 1, "another failure: reported once")
CRT.Print = realPrint

-- 5. The encounter hold applies to the guild too
be("Quick") GROUP_SAVE = GROUP GROUP = nil take() timers = {}
onEvent("ENCOUNTER_START", 1, "Boss", 16, 20)
W.Set(205, "big") runTimers()
eq(#on(take(), "GUILD"), 0, "hold: nothing on GUILD during an encounter")
eq(W.status, "held", "hold: the line says it waits")
onEvent("ENCOUNTER_END", 1, "Boss", 16, 20, 1) runTimers()
eq(#on(take(), "GUILD"), 1, "hold: sent once it ends")
LOCKED = true
W.Set(206, "big") runTimers()
eq(#take(), 0, "hold: the chat lockdown holds it too")
LOCKED = false
runTimers()
eq(#on(take(), "GUILD"), 1, "hold: tried again and sent once the lockdown lifts")
GROUP = GROUP_SAVE

-- 6. Login: your list once, jittered; an officer asks, rate limited
be("Quick") GROUP_SAVE = GROUP GROUP = nil take() timers = {} jitters = {}
onEvent("PLAYER_LOGIN")
local loginTimer
for _, t in ipairs(timers) do if t.s >= W.LOGIN_DELAY then loginTimer = t end end
check(loginTimer ~= nil, "login: your list waits a while")
eq(jitters[1], W.LOGIN_JITTER, "login: spread out by a random wait")
eq(loginTimer and loginTimer.s, W.LOGIN_DELAY + W.LOGIN_JITTER, "login: the delay plus the jitter")
runTimers()
local loginSent = on(take(), "GUILD")
eq(#loginSent, 1, "login: your list goes to the guild once")
check(loginSent[1] and loginSent[1].text:find("^X|%x+:01/01|") ~= nil, "login: as one X list")
be("Arrow") CHARS.Arrow.lootmaster = nil timers = {}
onEvent("PLAYER_LOGIN") runTimers()
eq(#on(take(), "GUILD"), 0, "login: no list, nothing sent")
be("Gild") CRT.db.lootmaster.wishlistsAsked = 0 timers = {}
onEvent("PLAYER_LOGIN")
local askTimer
for _, t in ipairs(timers) do if t.s == W.LOGIN_ASK_DELAY then askTimer = t end end
check(askTimer ~= nil, "ask: the officer asks a while after login")
runTimers()
local asks = on(take(), "GUILD")
local askCount = 0 for _, m in ipairs(asks) do if m.text == "X|?" then askCount = askCount + 1 end end
eq(askCount, 1, "ask: X|? on GUILD")
eq(CRT.db.lootmaster.wishlistsAsked, CLOCK, "ask: when, kept across logins")
eq(W.AskGuild(), false, "ask: not again within ten minutes")
CLOCK = CLOCK + W.GUILD_ASK_SECONDS - 1
eq(W.AskGuild(), false, "ask: not a second early")
CLOCK = CLOCK + 1
eq(W.AskGuild(), true, "ask: again after ten minutes")
take()
-- the guild's rank data late: the ask waits for the guild's events, still once per login
be("Gild") CRT.db.lootmaster.wishlistsAsked = 0 OFFICERS.Gild = nil timers = {} take()
onEvent("PLAYER_LOGIN") runTimers()
local function asksIn(box) local k = 0 for _, m in ipairs(box) do if m.text == "X|?" and m.ch == "GUILD" then k = k + 1 end end return k end
eq(asksIn(take()), 0, "late rank: no officer rank read yet, no ask")
onEvent("GUILD_ROSTER_UPDATE")
eq(asksIn(take()), 0, "late rank: a roster update that still says no, no ask")
OFFICERS.Gild = true
onEvent("PLAYER_GUILD_UPDATE")
eq(asksIn(take()), 1, "late rank: asked once the guild's data says officer")
CRT.db.lootmaster.wishlistsAsked = 0
onEvent("GUILD_ROSTER_UPDATE") onEvent("PLAYER_GUILD_UPDATE")
eq(asksIn(take()), 0, "late rank: once per login")
be("Quick") timers = {}
eq(W.AskGuild(), false, "ask: a raider who isn't an officer doesn't ask")
-- the answers: every raider with a list, after a short random wait, at most once a minute
be("Quick") take() timers = {} jitters = {}
msg("X|?", "Gild-Sargeras", "GUILD")
eq(jitters[1], W.ASK_JITTER, "answer: a random wait of up to " .. W.ASK_JITTER .. " s")
eq(timers[1] and timers[1].s, W.ASK_JITTER, "answer: waits that long")
eq(#outbox, 0, "answer: not at once")
runTimers()
eq(#on(take(), "GUILD"), 1, "answer: your list on GUILD")
msg("X|?", "Gild-Sargeras", "GUILD") runTimers()
eq(#take(), 0, "answer: not again within a minute")
NOW = NOW + W.GUILD_ANSWER_SECONDS
msg("X|?", "Gild-Sargeras", "GUILD") runTimers()
eq(#on(take(), "GUILD"), 1, "answer: again a minute later")
be("Arrow") CHARS.Arrow.lootmaster = nil
msg("X|?", "Gild-Sargeras", "GUILD") runTimers()
eq(#take(), 0, "answer: no list, no answer")
be("Gild") msg("X|?", "Gild-Sargeras", "GUILD") runTimers()
eq(#take(), 0, "answer: your own ask isn't answered")
GROUP = GROUP_SAVE

-- 7. The views: Bosses, Boss detail, Raiders, the Team filter
NOW = NOW + 100
CRT.Bosses = {
  Current = function() return { key = "s2" } end,
  RouteList = function() return { { encounterID = 1, name = "First Boss" }, { encounterID = 2, name = "Second Boss" }, { encounterID = 3, name = "Third Boss" } } end,
  Options = function() return { { key = "raid:s2", label = "A Raid", title = true }, { key = 1, label = "First Boss" }, { key = 2, label = "Second Boss" }, { key = 3, label = "Third Boss" } } end,
}
local LOOT = { [1] = { 11, 12 }, [2] = { 21, 22, 23 }, [3] = {} }
local reads = 0
W.BossLoot = function(id) reads = reads + 1 local out = {} for _, i in ipairs(LOOT[id] or {}) do out[#out + 1] = { id = i, name = "Item " .. i, quality = 4 } end return out end
be("Gild") CHARS.Gild.lootmaster = nil
CRT.db.lootmaster.wishlists = {}
local DAY = 86400
W.Keep("Quick-Sargeras", { [11] = "big", [21] = "small", [22] = "off" }, CLOCK - 2 * DAY)
W.Keep("Halo-Sargeras", { [11] = "small", [21] = "big", [23] = "big", [999] = "big" }, CLOCK - 9 * DAY)
W.Keep("Faraway-Sargeras", { [12] = "big" }, CLOCK)
V.ForgetMap()
local everyone = V.Raiders("all")
local names = {} for i, r in ipairs(everyone) do names[i] = r.name .. (r.items and "" or "(none)") end
eq(table.concat(names, " "), "Faraway-Sargeras Halo-Sargeras Quick-Sargeras Arrow-Sargeras(none) Gild-Sargeras(none) Solex-Sargeras(none)", "team: everyone kept, then your raid with no list")
local A = V.BossRows(everyone)
eq(#A, 3, "bosses: one row per boss of the season")
eq(A[1].name, "First Boss", "bosses: route order")
eq(A[1].big .. "/" .. A[1].small .. "/" .. A[1].off, "2/1/0", "bosses: First Boss counts (Quick and Faraway big, Halo small)")
eq(A[2].big .. "/" .. A[2].small .. "/" .. A[2].off, "2/1/1", "bosses: Second Boss counts")
eq(A[3].big + A[3].small + A[3].off, 0, "bosses: a boss nobody wants")
eq(A[1].value, 7, "value: Big 3, Small 1 (2*3 + 1)")
eq(A[2].value, 7.5, "value: Off counts 0.5 (2*3 + 1 + 0.5)")
local byValue = V.SortBossRows(A, "value", -1)
eq(byValue[1].name, "Second Boss", "sort: by value, high first")
eq(byValue[3].name, "Third Boss", "sort: lowest last")
local route = V.SortBossRows(byValue, nil, 1)
eq(route[1].name .. "," .. route[2].name, "First Boss,Second Boss", "sort: back to route order")
local byBig = V.SortBossRows(A, "big", 1)
eq(byBig[1].name, "Third Boss", "sort: by Big, low first")
eq(byBig[2].name, "First Boss", "sort: ties keep route order")
local before = reads
V.BossRows(everyone) V.RaiderRows(everyone) V.Detail(everyone, 2)
eq(reads, before, "map: the Journal is read once, not per view or row")
V.ForgetMap() V.BossRows(everyone)
eq(reads, before + 3, "map: read again after the Journal's data changed")
local B = V.Detail(everyone, 2)
eq(#B, 3, "detail: the boss's three wanted items")
eq(B[1].item.id, 21, "detail: most value first (21: big + small)")
eq(#B[1].wants.big, 1, "detail: one Big")
eq(B[1].wants.big[1].name, "Halo-Sargeras", "detail: Halo's Big")
eq(B[1].wants.small[1].name, "Quick-Sargeras", "detail: Quick's Small")
eq(B[3].item.id, 22, "detail: Off spec only last")
eq(#V.Detail(everyone, 3), 0, "detail: a boss nobody wants has no rows")
eq(#V.Detail(everyone, 77), 0, "detail: a boss not in the season has none")
local C = V.RaiderRows(everyone)
local halo, quick, arrow
for _, r in ipairs(C) do if r.name == "Halo-Sargeras" then halo = r elseif r.name == "Quick-Sargeras" then quick = r elseif r.name == "Arrow-Sargeras" then arrow = r end end
eq(quick.counts[1].big, 1, "raiders: Quick's First Boss Big")
eq(quick.counts[2].small .. "/" .. quick.counts[2].off, "1/1", "raiders: Quick's Second Boss Small/Off")
eq(quick.counts[3], nil, "raiders: only bosses with any")
eq(halo.counts[2].big, 2, "raiders: Halo's two Second Boss Bigs")
eq(quick.age, 2, "raiders: Quick's list is 2 days old")
eq(quick.old, false, "raiders: not old")
eq(halo.age, 9, "raiders: Halo's is 9 days old")
eq(halo.old, true, "raiders: older than 7 days is old")
eq(arrow.noList, true, "raiders: Arrow, in your raid, has no list")
eq(halo.class, "PRIEST", "raiders: the class kept")
-- the Team filter
local inRaid = V.Raiders("raid")
names = {} for i, r in ipairs(inRaid) do names[i] = r.name end
eq(table.concat(names, " "), "Halo-Sargeras Quick-Sargeras Arrow-Sargeras Gild-Sargeras Solex-Sargeras", "team: in my raid now (Faraway left out)")
eq(V.HasTeam("team"), false, "team: no Raid Groups layout in use")
CRT.Groups.ActiveNames = function() return { "Quick-Sargeras", "Faraway-Sargeras", "Bench-Sargeras" } end
eq(V.HasTeam("team"), true, "team: a layout in use")
local team = V.Raiders("team")
names = {} for i, r in ipairs(team) do names[i] = r.name .. (r.items and "" or "(none)") end
eq(table.concat(names, " "), "Faraway-Sargeras Quick-Sargeras Bench-Sargeras(none)", "team: the layout's players, those with no list too")
eq(V.BossRows(team)[1].big, 2, "team: the counts follow the filter")
-- your own list counts as yours
W.Set(23, "small") runTimers() take()
local mine
for _, r in ipairs(V.Raiders("all")) do if r.name == "Gild-Sargeras" then mine = r end end
eq(mine and mine.items and mine.items[23], "small", "team: your own list counts")
W.Remove(23) runTimers() take()

-- 8. The tab, on stand-in frames: who sees it, the three views, a click on a boss
local function mock(kind)
  local o = { kind = kind, shown = true, scripts = {}, points = {} }
  return setmetatable(o, { __index = function(t, k)
    local m = ({
      SetText = function(self, v) self.text = v end, GetText = function(self) return self.text end,
      Show = function(self) self.shown = true end, Hide = function(self) self.shown = false end,
      IsShown = function(self) return self.shown end, IsVisible = function(self) return self.shown end,
      SetShown = function(self, v) self.shown = v and true or false end,
      SetScript = function(self, name, fn) self.scripts[name] = fn end,
      SetPoint = function(self, ...) self.points[#self.points + 1] = { ... } end,
      CreateFontString = function() return mock("fs") end, CreateTexture = function() return mock("tex") end,
      SetDataProvider = function(self, rows) self.rows = rows end,
      SetElementInitializer = function(self, kind, fn) self.init = fn end,
      SetWidth = function(self, w) self.width = w end,
    })[k]
    if m then return m end
    if type(k) == "string" and k:match("^%u") then return function() end end
    return nil
  end })
end
CreateFrame = function(kind) return mock(kind) end
CreateScrollBoxListLinearView = function() return mock("view") end
ScrollUtil = { InitScrollBoxListWithScrollBar = function(box, bar, view) box.view = view end }
CreateDataProvider = function(rows) return rows end
GameTooltip = mock("tip")
C_ClassColor = { GetClassColor = function(c) return { WrapTextInColorCode = function(_, t) return "[" .. c .. "]" .. t end } end }
local drops = {}
CRT.UI.Dropdown = function(parent, text, opts) local d = mock("dropdown") d.opts = opts d.refresh = function() end drops[text] = d return d end
CRT.UI.SortHeaders = function(parent, cols, opts) return { refresh = function() end, opts = opts, cols = cols } end
CRT.UI.PanelButton = function(parent, label, h, fn) local b = mock("button") b.text = label b.scripts.OnClick = fn return b end
CRT.UI.SkinScrollBar = function() end
CRT.UI.SkinCloseButton = function() end
CRT.UI.Tint = function() end
CRT.UI.TooltipOwner = function() end
CRT.UI.OnTheme = function() end
CRT.UI.HelpRight = function(target, title, text) target.help = text end
CRT.UI.PAGE_W = 1026
-- the real value bar (CRT_Core/UI/Panel.lua's helpers), painted from the real theme
local themed = {}
CRT_THEME({}, themed)
CRT.UI.ValueBar, CRT.UI.SetValueBar = themed.ValueBar, themed.SetValueBar
local helps = {}
assert(load(tabSrc, "WishlistTab.lua"))("CowfeeRaidTools", CRT)
local tab = mock("frame")
local refreshers = {}
LM.BuildWishlistsTab(tab, { heading = function(f, x, y, text, help) helps[text] = help end, refreshers = refreshers })
local parts, rows = LM.WishlistTabParts()
check(helps["Raiders' wishlists"] ~= nil, "tab: a heading with its (?)")
be("Arrow") GROUP_SAVE = GROUP
refreshers[1]()
eq(parts.note.shown, true, "tab: a plain raider sees the note")
eq(parts.note.text, "Only officers and raid assists keep raiders' lists.", "tab: the note's wording")
check(parts.note.help ~= nil, "tab: the note has a (?)")
eq(parts.controls.shown, false, "tab: and no views")
be("Gild") CRT.Groups.ActiveNames = nil
refreshers[1]()
eq(parts.note.shown, false, "tab: an officer sees no note")
eq(parts.controls.shown, true, "tab: an officer sees the views")
eq(rows.view, "bosses", "tab: Bosses first")
eq(parts.views.bosses.shown and not parts.views.detail.shown and not parts.views.raiders.shown, true, "tab: only the Bosses list shown")
local bl = parts.views.bosses.list
eq(#bl.rows, 3, "tab: three boss rows")
eq(rows.maxValue, 7.5, "tab: the value bar scale")
local opts = drops.View.opts.options
eq(opts[1].label .. "/" .. opts[2].label .. "/" .. opts[3].label, "Bosses/Boss detail/Raiders", "tab: the view dropdown")
local tOpts = drops.Team.opts.options()
eq(tOpts[1].label .. "/" .. tOpts[2].label .. "/" .. tOpts[3].label, "Everyone kept/In my raid now/Raid Groups layout", "tab: the team dropdown")
eq(tOpts[3].disabled(), true, "tab: Raid Groups layout greyed with no layout in use")
-- a boss row drawn, then clicked: Boss detail for it
local row = mock("row")
bl.view.init(row, bl.rows[2])
eq(row.name.text, "Second Boss", "tab: the boss row's name")
eq(row.big.text, "<good>2", "tab: Big in the good colour")
eq(row.off.text, "<muted>1", "tab: Off in the muted colour")
eq(row.bar.fill.width, 300, "tab: the top value fills the bar")
eq(row.bar.value.text, "7.5", "tab: the value on the bar's right")
check(row.bar.track ~= nil and row.bar.w == 300, "tab: the shared value bar (track and fill)")
bl.view.init(row, bl.rows[1])
eq(row.bar.fill.width, 300 * 7 / 7.5, "tab: a smaller value, a shorter bar")
bl.view.init(row, bl.rows[2])
local reads0 = reads
row.scripts.OnClick(row)
runTimers()
eq(rows.view, "detail", "tab: a click on a boss opens Boss detail")
eq(CRT.db.lootmaster.wishlistsTab.boss, 2, "tab: for that boss")
eq(parts.bossRow.shown, true, "tab: the boss dropdown shows in Boss detail")
eq(#parts.views.detail.list.rows, 3, "tab: its three items")
eq(reads, reads0, "tab: no Journal read for a redraw")
local drow = mock("row")
parts.views.detail.list.view.init(drow, parts.views.detail.list.rows[1])
eq(drow.wants.text, "<good>Big: [PRIEST]Halo  <warn>Small: [ROGUE]Quick", "tab: who wants it, by rank, in class colour")
eq(drow.name.text, "Item 21", "tab: the item's name")
-- Raiders
drops.View.opts.set("raiders")
eq(rows.view, "raiders", "tab: the Raiders view")
local rl = parts.views.raiders.list
local rrow = mock("row")
local haloRow, arrowRow
for _, r in ipairs(rl.rows) do if r.name == "Halo-Sargeras" then haloRow = r elseif r.name == "Arrow-Sargeras" then arrowRow = r end end
rl.view.init(rrow, haloRow)
eq(rrow.name.text, "[PRIEST]Halo", "tab: the raider in class colour")
eq(rrow.cells[1].text, "<good>0/<warn>1/<muted>0", "tab: B/S/O for First Boss")
eq(rrow.cells[3].text, "", "tab: blank for a boss with none")
eq(rrow.updated.text, "<warn>9 days", "tab: an old list in warn")
eq(rrow.forget.shown, true, "tab: a raider's list can be forgotten")
rl.view.init(rrow, arrowRow)
eq(rrow.updated.text, "<muted>no list", "tab: no list, muted")
eq(rrow.forget.shown, false, "tab: nothing to forget with no list")
eq(LM.WishlistAgeText({ age = 0 }), "today", "age: today")
eq(LM.WishlistAgeText({ age = 1 }), "1 day", "age: 1 day")
eq(LM.WishlistAgeText({ age = 7, old = false }), "7 days", "age: 7 days is not old")
rl.view.init(rrow, haloRow)
rrow.forget.scripts.OnClick(rrow.forget)
runTimers()
eq(store()["Halo-Sargeras"], nil, "tab: the X forgets that list")
local stillHalo = false
for _, r in ipairs(rl.rows) do if r.name == "Halo-Sargeras" and not r.noList then stillHalo = true end end
eq(stillHalo, false, "tab: and the rows are worked out again")
parts.forgetAll.scripts.OnClick()
eq(#popups, 2, "tab: Forget all asks first")
-- the Team filter on the tab
drops.Team.opts.set("raid")
local hasFar = false
for _, r in ipairs(rl.rows) do if r.name == "Faraway-Sargeras" then hasFar = true end end
eq(hasFar, false, "tab: In my raid now leaves out who isn't in your raid")
drops.Team.opts.set("team")
eq(drops.Team.opts.get(), "all", "tab: no layout in use reads as Everyone kept")
drops.Team.opts.set("all")
-- a boss kept from another season: Boss detail falls back to the season's first
CRT.db.lootmaster.wishlistsTab.boss = 777
drops.View.opts.set("detail")
eq(drops.Boss.opts.get(), 1, "detail: a boss not in this season reads as the first")
check(#rows.detail > 0, "detail: and shows its items")
check(helps["Raiders' wishlists"]:find("Team: everyone you keep", 1, true) ~= nil and not helps["Raiders' wishlists"]:find("everyone kept", 1, true), "help: the Team wording")

-- 9. The shared drawing helpers, and the roll windows' Wishlist cell: a saved list's age on hover
check(type(W.ItemIcon) == "function" and type(W.QualityColor) == "function" and type(W.CellTip) == "function", "shared: the icon, quality colour and cell helpers")
CLOCK = CLOCK + 3 * 86400
W.lists = {}
W.Keep("Quick-Sargeras", { [11] = "big" }, CLOCK - 3 * 86400 + 1) -- newer than the copy kept
local cellRow = mock("row")
local tip = W.CellTip(cellRow, mock("fs"))
W.SetCellTip(tip, "Quick-Sargeras", 11, "big")
eq(tip.shown, true, "cell: a rank from the saved copy has a tooltip")
eq(tip.days, 2, "cell: its age in days")
eq(W.AgeLine(2), "From a list made 2 days ago.", "cell: the age line")
eq(W.AgeLine(1), "From a list made 1 day ago.", "cell: one day")
eq(W.AgeLine(0), "From a list made today.", "cell: today")
W.lists["Quick-Sargeras"] = { items = { [11] = "big" }, at = 0 }
W.SetCellTip(tip, "Quick-Sargeras", 11, "big")
eq(tip.shown, false, "cell: a list heard this login shows no age")
W.lists = {}
W.SetCellTip(tip, "Quick-Sargeras", 11, "big", false)
eq(tip.shown, false, "cell: none while the column is hidden")
W.SetCellTip(tip, "Gild-Sargeras", 11, nil)
eq(tip.shown, false, "cell: no rank, no tooltip")
local clicked
cellRow.scripts.OnClick = function(_, b) clicked = b end
cellRow.GetScript = function(self, name) return self.scripts[name] end
tip.scripts.OnClick(tip, "RightButton")
eq(clicked, "RightButton", "cell: its clicks go to the row")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/Wishlist.lua',
  'CRT_Modules/LootMaster/WishlistSaved.lua', 'CRT_Modules/LootMaster/WishlistViews.lua', 'CRT_Modules/LootMaster/WishlistTab.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
// the item icon and quality colour are shared, not copied: neither window keeps its own
for (const f of ['CRT_Modules/LootMaster/WishlistTab.lua', 'CRT_Modules/LootMaster/WishlistWindow.lua']) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  if (/local function qualityColor|GetItemQualityColor|"BackdropTemplate"/.test(src)) { console.log('FAIL ' + f + ' draws its own item icon or quality colour'); process.exitCode = 1; }
  else console.log('ok ' + f + ' uses the shared item icon');
}
