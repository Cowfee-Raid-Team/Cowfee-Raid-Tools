// LootMaster/Comm.lua (prefix CRTLootRemaster): a session alone (messages handed straight back) and in a raid (messages
// caught and delivered by hand), the loot authority list, held messages, silent rolls, /reload, and the
// items a raider can't use. Usage: node run_lootmaster_comm.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local dataSrc, commSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
local NOW = 100
GetTime = function() return NOW end
local CLOCK = 1790000000
time = function() return CLOCK end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
-- the group: you are Solex; in a raid the members are raid1..raid4
local ME = "Solex"
local GROUP = nil -- nil: alone; else { names = {...}, leader = "Name-Sargeras" }
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
IsInGuild = function() return false end
local rolls = { 42, 7, 99, 63, 18, 77 }
local rollAt = 0
math.random = function(a, b) if a == 1 and b == 100 then rollAt = rollAt + 1 return rolls[(rollAt - 1) % #rolls + 1] end return a end
local timers = {}
C_Timer = { After = function(s, fn) timers[#timers+1] = fn end, NewTicker = function(s, fn) return { Cancel = function() end, fn = fn } end }
local function runTimers() local t = timers timers = {} for _, fn in ipairs(t) do fn() end end
local outbox, result = {}, 0
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function(p, text, ch) if result ~= 0 then return result end outbox[#outbox+1] = text return 0 end }
local onEvent
function CreateFrame() return { RegisterEvent = function() end, SetScript = function(_, _, fn) onEvent = fn end } end
local printed = {}
CRTDBChar = {}
local CRT = { db = { lootmaster = { authority = { leader = true, names = {} } } } }
function CRT:Print(m) printed[#printed+1] = m end
CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
function LM:MyRole() return "T" end
function LM:MyItemLevel() return "285.0" end
function LM:MyGear() return { { id = 9, ilvl = 276 } } end
assert(load(commSrc, "Comm.lua"))("CowfeeRaidTools", CRT)
local fired = {}
LM:OnChange(function(what, how) fired[#fired+1] = what .. ":" .. tostring(how) end)
local function firedHas(s) for _, f in ipairs(fired) do if f == s then return true end end return false end
-- delivers everything sent, as if from sender, until nothing is left
local function deliver(sender)
  local n = 0
  while #outbox > 0 do
    local box = outbox outbox = {}
    for _, text in ipairs(box) do onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, text, "RAID", sender) n = n + 1 end
  end
  return n
end

-- 1. Alone: everything comes straight back
local s = LM:Start({ { itemString = "item:111", ilvl = 289 }, { itemString = "item:222", ilvl = 289 } }, true)
check(s ~= nil, "a test starts alone")
eq(#outbox, 0, "alone, nothing goes over the network")
local inc = LM.incoming
eq(inc and inc.test, true, "you got the session as a raider too")
eq(inc and #inc.responses, 6, "the buttons arrived, packed")
eq(inc and inc.items[2] and inc.items[2].itemString, "item:222", "the items arrived, packed")
check(firedHas("incoming:shown"), "popup told to show")
eq(s.players["Solex-Sargeras"].ready, true, "you are ready")
check(inc.view ~= nil, "a copy of everyone's answers for the raider window")
LM:Answer(1, "bis", "4pc")
local a = s.players["Solex-Sargeras"].answers[1]
eq(a.response, "bis", "answer reached the looter")
eq(a.roll, 42, "the looter drew the roll, silently")
eq(inc.mine[1].roll, 42, "your popup knows your roll")
eq(inc.view.players["Solex-Sargeras"].answers[1].roll, 42, "and the raider window shows it")
eq(inc.view.players["Solex-Sargeras"].answers[1].note, "4pc", "with your note")
LM:Answer(1, "up")
eq(s.players["Solex-Sargeras"].answers[1].roll, 42, "changing your answer keeps your roll")
LM:Answer(2, "pass")
eq(s.players["Solex-Sargeras"].answers[2].roll, 7, "the weight-0 last button gets a roll too")
eq(LM:Reroll(1, { "Solex-Sargeras" }), 1, "the looter rolls again")
eq(s.players["Solex-Sargeras"].answers[1].roll, 99, "a new number")
eq(inc.view.players["Solex-Sargeras"].answers[1].roll, 99, "shown to everyone")
eq(LM:Resend(1, { "Solex-Sargeras" }), 0, "an answered item is not shown again")
LM:Award(1, "Solex-Sargeras", "up")
eq(inc.items[1].award and inc.items[1].award.name, "Solex-Sargeras", "raider sees the award")
check(printed[#printed]:find("with a 99 roll", 1, true) ~= nil, "award message carries the roll: " .. tostring(printed[#printed]))
check(CRTDBChar.lootSession ~= nil, "the session is saved for a /reload")
-- /reload: both sides come back, with fresh clocks
local savedId = s.id
LM.current, LM.incoming = nil, nil
NOW = NOW + 500
onEvent(nil, "PLAYER_LOGIN")
eq(LM.current and LM.current.id, savedId, "the looter's session is back")
eq(LM.incoming and LM.incoming.id, savedId, "the raider's session is back")
eq(LM.current.players["Solex-Sargeras"].answers[1].roll, 99, "answers and rolls kept")
eq(LM.incoming.items[2].shownAt, NOW, "the popup's clock starts again")
eq(LM.current:Response("bis").label, "BiS", "buttons usable again")
LM:End()
eq(LM.current, nil, "session ended")
eq(LM.incoming, nil, "popup session ended")
eq(CRTDBChar.lootSession, nil, "nothing left to restore")
-- an old save is not restored
CRTDBChar.lootSession = { savedAt = CLOCK - (LM.RESTORE_HOURS * 3600 + 10), current = { id = "old", items = {}, players = {} } }
onEvent(nil, "PLAYER_LOGIN")
eq(LM.current, nil, "a stale session is dropped")
eq(LM:Start({}, true), nil, "a session with no items is refused")
local long = LM:Start({ { itemString = "item:" .. string.rep("9", 300) } }, true)
eq(long, nil, "an item too long to send is left out, and nothing is left")

-- 2. In a raid: Solex leads, Halo is an officer on the list, Quick and Arrow are raiders
GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras", "Quick-Sargeras", "Arrow-Kazzak" }, leader = "Solex-Sargeras" }
CRT.db.lootmaster.authority.names = { "Halo" }
outbox = {}
local items8 = {}
for i = 1, 8 do items8[i] = { itemString = "item:" .. (240000 + i) .. "::::::::90:102::3:4:6652:12667:13577:13333", ilvl = 289 } end
s = LM:Start(items8, true)
local startMessages = #outbox
check(startMessages <= 10, "a start with 8 items fits the game's burst of 10 (" .. startMessages .. ")")
deliver("Solex-Sargeras")
inc = LM.incoming
eq(inc and inc.got, 8, "the leader's own popup got all 8 items")
eq(s.players["Solex-Sargeras"].ready, true, "the leader is ready")
-- a cross-realm raider answers: by the group channel, so it arrives
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "K|" .. s.id .. "|0.25.0", "RAID", "Arrow-Kazzak")
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "Y|" .. s.id, "RAID", "Arrow-Kazzak")
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "R|" .. s.id .. "|1|bis|D|HUNTER|281||||||", "RAID", "Arrow-Kazzak")
eq(s.players["Arrow-Kazzak"].answers[1].response, "bis", "a cross-realm answer reaches the looter")
deliver("Solex-Sargeras")
check(s.players["Arrow-Kazzak"].answers[1].roll ~= nil, "the looter drew a roll for them")
eq(inc.view.players["Arrow-Kazzak"].answers[1].roll, s.players["Arrow-Kazzak"].answers[1].roll, "and every window shows the same roll")
-- Quick said hello but never got everything: sent again once, after READY_SECONDS
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "K|" .. s.id .. "|0.25.0", "RAID", "Quick-Sargeras")
outbox = {}
runTimers()
check(#outbox > 0, "the session is sent again for a raider who never became ready")
eq(s:Row("Quick-Sargeras", 1).state, "loading", "and their clock hasn't started")
outbox = {}
-- 3. Encounter lockdown: messages are held, then sent
result = 11
LM:Award(1, "Arrow-Kazzak", "bis")
local told = false
for _, m in ipairs(printed) do if m:find("held during the encounter", 1, true) then told = true end end
check(told, "you are told once that messages are held")
eq(#outbox, 0, "nothing sent during the lockdown")
result = 0
onEvent(nil, "ENCOUNTER_END")
eq(#outbox, 1, "the award goes out when the encounter ends")
outbox = {}
result = 12
LM:Award(2, "Arrow-Kazzak", "bis")
result = 0
LM:Award(3, "Arrow-Kazzak", "bis")
eq(#outbox, 1, "an offline result drops quietly; the next message still goes")
outbox = {}
LM:End()
deliver("Solex-Sargeras")

-- 4. Loot authority
eq(LM:CanLoot(), true, "the leader may run loot")
CRT.db.lootmaster.authority.leader = false
eq(LM:CanLoot(), false, "unless their own list says the leader may not")
CRT.db.lootmaster.authority.leader = true
-- now Halo leads; Solex is a raider
GROUP.leader = "Halo-Sargeras"
LM.authority = nil
eq(LM:CanLoot(), false, "no list from the new leader: leader only")
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "S|evil|1|1|0.25.0|60|1|0", "RAID", "Quick-Sargeras")
eq(LM.incoming, nil, "a session from someone with no authority is ignored")
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "U|1:5|Solex-Sargeras;Quick-Sargeras", "RAID", "Arrow-Kazzak")
eq(LM.authority, nil, "a list from someone who isn't the leader is ignored")
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "U|1:5|Solex-Sargeras", "RAID", "Halo-Sargeras")
eq(LM:CanLoot(), true, "on the leader's list: you may run loot")
eq(LM.Allowed("Quick-Sargeras"), false, "Quick isn't on it")
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "S|ok1|1|1|0.25.0|60|1|0", "RAID", "Solex-Sargeras")
eq(LM.incoming and LM.incoming.id, "ok1", "a session from someone on the leader's list is accepted")
LM.incoming = nil
onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "U|0:6|", "RAID", "Halo-Sargeras")
eq(LM.Allowed("Halo-Sargeras"), false, "a leader can take themselves off")
eq(LM:CanLoot(), false, "a new list replaces the old one")
GROUP.leader = "Solex-Sargeras"

-- 5. Items you can't use (alone again)
GROUP = nil
LM.authority = nil
local SPECS = { [111] = { 73, 66, 250 }, [222] = { 62, 73 }, [333] = {}, [444] = nil }
local cached = { [111] = true, [222] = true, [333] = true, [444] = true, [555] = false, [666] = true, [777] = true, [778] = true, [779] = true, [780] = true, [781] = true }
local loadCallbacks = {}
C_Item.GetItemSpecInfo = function(str) local id = tonumber(str:match("item:(%d+)")) return SPECS[id] end
C_Item.GetItemInfoInstant = function(str)
  local id = tonumber(str:match("item:(%d+)"))
  if id == 666 then return 666, "Armor", "Leather", "INVTYPE_CHEST", 0, 4, 2 end
  if id == 779 or id == 780 or id == 781 then return id, "Weapon", "One-Handed Swords", "INVTYPE_WEAPON", 0, 2, 7 end
  return id, "Misc", "Junk", "", 0, 15, 0
end
ITEM_CLASSES_ALLOWED = "Classes: %s"
LOCALIZED_CLASS_NAMES_MALE = { WARRIOR = "Warrior", PALADIN = "Paladin", DEATHKNIGHT = "Death Knight", PRIEST = "Priest", MAGE = "Mage" }
LOCALIZED_CLASS_NAMES_FEMALE = LOCALIZED_CLASS_NAMES_MALE
C_TooltipInfo = { GetHyperlink = function(str)
  if str:find("item:777") then return { lines = { { leftText = "Classes: Warrior, Death Knight" } } } end
  if str:find("item:778") then return { lines = { { leftText = "Classes: Paladin, Priest" } } } end
  -- 779 a sword the game marks red (a colour object, as the game gives), 780 the same in white, 781 red as a secret
  if str:find("item:779") then return { lines = { { type = 21, leftText = "One-Hand", rightText = "Sword", rightColor = { GetRGB = function() return 1, 0.125, 0.125 end } } } } end
  if str:find("item:780") then return { lines = { { type = 21, leftText = "One-Hand", rightText = "Sword", rightColor = { r = 1, g = 1, b = 1 } } } } end
  if str:find("item:781") then return { lines = { { type = 21, leftText = "One-Hand", rightText = "Sword", rightColor = { r = "secret", g = 0.1, b = 0.1 } } } } end
  return { lines = {} } end }
Enum = { TooltipDataLineType = { EquipSlot = 21 } }
Item = { CreateFromItemID = function(_, id) return {
  IsItemDataCached = function() return cached[id] end,
  ContinueOnItemLoad = function(_, fn) loadCallbacks[#loadCallbacks + 1] = fn end } end }
GetNumSpecializations = function() return 3 end
GetSpecializationInfo = function(i) return ({ 62, 63, 64 })[i] end -- mage specs (the class names say Paladin)
timers = {}
local s3 = LM:Start({ { itemString = "item:111" }, { itemString = "item:222" }, { itemString = "item:333" }, { itemString = "item:444" }, { itemString = "item:555" }, { itemString = "item:666" }, { itemString = "item:777" }, { itemString = "item:778" } }, true)
local inc3 = LM.incoming
check(not inc3.checked, "the popup waits while item 555 loads")
eq(s3.players["Solex-Sargeras"].ready, nil, "and you are not ready yet")
for _, fn in ipairs(timers) do fn() end
check(inc3.checked, "after the wait the popup opens")
eq(s3.players["Solex-Sargeras"].ready, true, "and the looter hears you are ready")
eq(inc3.mine[1] and inc3.mine[1].auto, true, "spec: a tank-only item is answered for a mage")
eq(inc3.mine[1].closed, true, "and hidden")
eq(s3.players["Solex-Sargeras"].answers[1].response, "tmog", "the looter sees Transmog")
check(s3.players["Solex-Sargeras"].answers[1].roll ~= nil, "an automatic answer gets a roll too")
eq(inc3.mine[2], nil, "an item one of your specs can use is shown")
eq(inc3.mine[3], nil, "an empty spec list is shown")
eq(inc3.mine[4], nil, "no spec info is shown")
eq(inc3.mine[5], nil, "an item that never loaded is shown")
eq(inc3.mine[6] and inc3.mine[6].autoWhy, "armor", "leather for a paladin: not their armor type")
eq(inc3.mine[7] and inc3.mine[7].autoWhy, "classes", "a token for other classes")
eq(inc3.mine[8], nil, "a token naming your class is shown")
eq(s3.players["Solex-Sargeras"].answers[7].autoDetail, "Warrior/Death Knight", "the looter sees which classes")
LM:ShowAutoItems()
eq(inc3.mine[1].closed, nil, "Show brings it back, to look at")
LM:Answer(1, "bis")
eq(s3.players["Solex-Sargeras"].answers[1].auto, true, "you can't answer it yourself")
LM:End()
CRT.db.lootmaster.autoPass = false
LM:Start({ { itemString = "item:111" } }, true)
eq(LM.incoming.mine[1], nil, "leader switch off: nothing answered for you")
LM:End()
CRT.db.lootmaster.autoPass = nil
CRT.db.lootmaster.showAllItems = true
LM:Start({ { itemString = "item:111" } }, true)
eq(LM.incoming.mine[1] and LM.incoming.mine[1].closed, false, "seeing every item: shown, still answered for you")
LM:End()
CRT.db.lootmaster.showAllItems = nil
issecretvalue = function(v) return type(v) == "table" end
LM:Start({ { itemString = "item:111" } }, true)
eq(LM.incoming.mine[1], nil, "a secret value is shown")
LM:End()
issecretvalue = nil
C_Item.GetItemSpecInfo = function() error("boom") end
LM:Start({ { itemString = "item:111" } }, true)
eq(LM.incoming.mine[1], nil, "an error is shown")
LM:End()
local why = LM.CantUse("item:777", true)
eq(why, "classes", "CantUse: the token for warriors")
eq(LM.CantUse("item:778", true), nil, "CantUse: a token naming the paladin")
local wwhy, wdetail = LM.CantUse("item:779", true)
eq(wwhy, "weapon", "CantUse: a sword the tooltip marks red")
eq(wdetail, "Sword", "with the weapon type the tooltip shows")
eq(LM.CantUse("item:780", true), nil, "CantUse: a sword in white is shown")
issecretvalue = function(v) return v == "secret" end
eq(LM.CantUse("item:781", true), nil, "CantUse: a secret colour is shown")
issecretvalue = nil

-- 6. The auto answer and the looter's version: Halo runs loot, you are a raider
GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras" }, leader = "Halo-Sargeras" }
LM.authority = nil
local function autoSent(id, version, buttons)
  outbox = {}
  LM.incoming = nil
  onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "S|" .. id .. "|1|1|" .. version .. "|60|2|1", "RAID", "Halo-Sargeras")
  onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "B|" .. id .. "|" .. buttons, "RAID", "Halo-Sargeras")
  onEvent(nil, "CHAT_MSG_ADDON", LM.PREFIX, "I|" .. id .. "|1,289,item:666", "RAID", "Halo-Sargeras")
  for _, m in ipairs(outbox) do
    local kind, f = LM.Wire.Decode(m)
    if kind == "R" then return f[3] end
  end
end
local noTmogSet = "1,bis,ffffff,100,,BiS;2,pass,888888,0,,Pass"
eq(autoSent("v1", LM.VERSION, noTmogSet), "tmog", "a looter on this version: Transmog, with no Transmog button")
eq(LM.incoming.mine[1].response, "tmog", "your popup knows it too")
eq(autoSent("v2", "0.25.0", noTmogSet), "pass", "an older looter with no Transmog button: Pass, which it accepts")
eq(autoSent("v3", "", noTmogSet), "pass", "a looter whose version is unknown: Pass")
eq(autoSent("v4", "0.25.0", "1,bis,ffffff,100,,BiS;2,tmog,b48ce8,10,,Transmog"), "tmog", "an older looter with a Transmog button: Transmog")
eq(autoSent("v5", "0.25.0", "1,bis,ffffff,100,,BiS;2,pass,888888,0,transmog,Transmog"), "pass", "the last button is the Transmog: its key, which any looter accepts")
eq(autoSent("v6", LM.VERSION, "1,bis,ffffff,100,,BiS;2,pass,888888,0,,TRANSMOG"), "pass", "a new looter whose last button is Transmog: that one, never a second Transmog")
LM.incoming = nil
GROUP = nil
outbox = {}

-- 7. The boss's name in the title bar: each side's own last ENCOUNTER_END, no message carries it
GROUP = { names = { "Solex-Sargeras", "Halo-Sargeras" }, leader = "Solex-Sargeras" }
LM.authority = nil
local BOSS = "Plexus Sentinel"
onEvent(nil, "ENCOUNTER_END", 3129, BOSS, 16, 20, 1)
eq(CRTDBChar.lootmaster and CRTDBChar.lootmaster.lastKill and CRTDBChar.lootmaster.lastKill.name, BOSS, "boss: the kill is saved per character")
CLOCK = CLOCK + 120
local sb = LM:Start({ { itemString = "item:111" } }, false)
eq(sb and sb.boss, BOSS, "boss: a session within 10 minutes of a kill has its name")
deliver("Solex-Sargeras")
eq(LM.incoming and LM.incoming.boss, BOSS, "boss: the raider's popup has it from their own fight")
LM.current, LM.incoming = nil, nil
onEvent(nil, "PLAYER_LOGIN")
eq(LM.current and LM.current.boss, BOSS, "boss: kept after a /reload (looter)")
eq(LM.incoming and LM.incoming.boss, BOSS, "boss: kept after a /reload (raider)")
LM:End()
deliver("Solex-Sargeras")
onEvent(nil, "ENCOUNTER_END", 3130, "Wiped Boss", 16, 20, 0)
sb = LM:Start({ { itemString = "item:111" } }, false)
eq(sb and sb.boss, BOSS, "boss: a wipe doesn't replace the boss that was killed")
LM:End()
deliver("Solex-Sargeras")
sb = LM:Start({ { itemString = "item:111" } }, true)
eq(sb and sb.boss, nil, "boss: a test never has one")
deliver("Solex-Sargeras")
eq(LM.incoming and LM.incoming.boss, nil, "boss: nor the test's popup")
LM:End()
deliver("Solex-Sargeras")
issecretvalue = function(v) return v == "SECRET" end
onEvent(nil, "ENCOUNTER_END", 3131, "SECRET", 16, 20, 1)
issecretvalue = nil
sb = LM:Start({ { itemString = "item:111" } }, false)
eq(sb and sb.boss, BOSS, "boss: a secret name is never kept")
LM:End()
deliver("Solex-Sargeras")
CLOCK = CLOCK + LM.BOSS_SECONDS
sb = LM:Start({ { itemString = "item:111" } }, false)
eq(sb and sb.boss, nil, "boss: more than 10 minutes after the kill, none")
LM:End()
deliver("Solex-Sargeras")
-- a /reload between the kill and the session: the game loads the saved kill again, nothing in memory
CRTDBChar = { lootmaster = { lastKill = { name = "Saved Boss", at = CLOCK - 300 } } }
sb = LM:Start({ { itemString = "item:111" } }, false)
eq(sb and sb.boss, "Saved Boss", "boss: a kill from before a /reload still counts")
LM:End()
deliver("Solex-Sargeras")
CRTDBChar.lootmaster.lastKill.at = CLOCK + 50
sb = LM:Start({ { itemString = "item:111" } }, false)
eq(sb and sb.boss, nil, "boss: a kill dated in the future is ignored")
LM:End()
deliver("Solex-Sargeras")
LM.incoming = nil
GROUP = nil
outbox = {}

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['LootMaster/Data.lua', 'LootMaster/Comm.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
