// Loot Master's G part (CRT_Modules/LootMaster/Comm.lua with CRT_Core/Gear.lua): a raider's full equipped
// items after their answer. Several CRTs in one raid, each its own copy of the files, messages caught and
// handed to every one of them: a new looter and raider, an old raider (no G), an old looter (1.1.0's Comm,
// CRT_Dev/Tests/old_Comm.lua) that drops G, rings split across messages, parts for an unknown session or
// item, and the sender check. Usage: node run_lootmaster_gear.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local gearSrc, dataSrc, commSrc, oldCommSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
GetTime = function() return 100 end
time = function() return 1790000000 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
Ambiguate = function(n) return (n:gsub("%-.*$", "")) end
geterrorhandler = function() return function(e) print("ERROR " .. tostring(e)) fails = fails + 1 end end
-- one raid on Sargeras: Halo leads; ME is whichever CRT is acting now
local ME = "Halo"
local NAMES = { "Halo-Sargeras", "Quick-Sargeras", "Arrow-Sargeras" }
UnitName = function(u)
  if u == "player" then return ME end
  local i = tonumber((u or ""):match("^raid(%d+)$"))
  if i and NAMES[i] then return (NAMES[i]:match("^(.-)%-")) end
end
GetNormalizedRealmName = function() return "Sargeras" end
IsInGroup = function() return true end
IsInRaid = function() return true end
GetNumGroupMembers = function() return #NAMES end
GetNumSubgroupMembers = function() return 0 end
GetRaidRosterInfo = function(i) return NAMES[i] end
UnitIsGroupLeader = function(u) return (u == "player" and ME == "Halo") or u == "raid1" end
UnitClass = function() return "Paladin", "PALADIN" end
IsInGuild = function() return false end
C_Timer = { After = function() end, NewTicker = function() return { Cancel = function() end } end }
CRTDBChar = {}
-- the raider's rings: long item strings (bonus IDs, gems, enchant, crafter), so two pieces need two messages
local TAIL = ":28:12:12667:12793:6652:13577:13333:10354:10255:10256:10257:10258:10259:10260:2:28:2462:29:40:::Player-3299-0050F7FB"
local RING1 = "item:600:7364:213746:213746:213746::::90:577::28" .. TAIL
local RING2 = "item:601:7365:213747:213747:213747::::90:577::28" .. TAIL
local LINKS = { [11] = "|cffa335ee|H" .. RING1 .. "::|h[Band]|h|r", [12] = "|cffa335ee|H" .. RING2 .. "|h[Loop]|h|r" }
local ILVL = { [LINKS[11]] = 289, [LINKS[12]] = 276 }
GetInventoryItemLink = function(_, slot) return LINKS[slot] end
GetInventoryItemID = function(_, slot) return LINKS[slot] and tonumber(LINKS[slot]:match("item:(%d+)")) end
C_Item = {
  GetItemInfo = function() return nil end,
  GetDetailedItemLevelInfo = function(link) return ILVL[link] end,
  GetItemInfoInstant = function(s) local id = tonumber((s or ""):match("item:(%d+)")) return id, "Armor", "Misc", id == 500 and "INVTYPE_FINGER" or "", 0, 4, 0 end,
}
-- every message sent, with who sent it
local outbox = {}
C_ChatInfo = { RegisterAddonMessagePrefix = function() end,
  SendAddonMessage = function(_, text) outbox[#outbox + 1] = { text = text, from = ME } return 0 end }
local lastHandler
CreateFrame = function() return { RegisterEvent = function() end, SetScript = function(_, _, fn) lastHandler = fn end } end
GameTooltip = nil

-- one player's CRT: the gear engine (new only), Data.lua and a Comm.lua
local function boot(name, comm, new)
  local CRT = { db = { lootmaster = { authority = { leader = true, names = {} } } } }
  function CRT:Print() end
  CRT.Groups = { Normalize = function(n) if not n:find("-") then return n .. "-Sargeras" end return n end }
  if new then assert(load(gearSrc, "Gear.lua"))("CowfeeRaidTools", CRT) end
  assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
  local LM = CRT.LootMaster
  function LM:MyRole() return "D" end
  function LM:MyItemLevel() return "285.0" end
  if new then
    function LM:MyGear(s) return CRT.Gear:ForItem(s) end -- as Popup.lua's
  else
    function LM:MyGear() return { { id = 9, ilvl = 276 } } end -- 1.1.0's: ID and item level only
  end
  assert(load(comm, "Comm.lua"))("CowfeeRaidTools", CRT)
  return { name = name, full = name .. "-Sargeras", CRT = CRT, LM = LM, on = lastHandler }
end
local function as(p, fn) local prev = ME ME = p.name local r = fn() ME = prev return r end
local raid
-- hands everything sent to every CRT (raid messages come back to the sender too), until nothing is left
local function deliver()
  while #outbox > 0 do
    local box = outbox outbox = {}
    for _, m in ipairs(box) do
      for _, p in ipairs(raid) do
        as(p, function() p.on(nil, "CHAT_MSG_ADDON", p.LM.PREFIX, m.text, "RAID", m.from .. "-Sargeras") end)
      end
    end
  end
end
local function sent(kind) local out = {} for _, m in ipairs(outbox) do if m.text:sub(1, 2) == kind .. "|" then out[#out + 1] = m.text end end return out end
local function inject(text, from) outbox[#outbox + 1] = { text = text, from = from } deliver() end
local function gearOf(p, who) local s = p.LM.current return s.players[who].answers[1].gear end

-- 1. A new looter and a new raider: the R as before, then G parts with the full rings
local halo, quick, arrow = boot("Halo", commSrc, true), boot("Quick", commSrc, true), boot("Arrow", oldCommSrc, false)
raid = { halo, quick, arrow }
eq(halo.LM.VERSION, "0.30.0", "this Loot Master is 0.30.0")
local s = as(halo, function() return halo.LM:Start({ { itemString = "item:500", ilvl = 300 } }, true) end)
check(s ~= nil, "the looter starts a session")
deliver()
check(quick.LM.incoming and quick.LM.incoming.checked, "the raider got the session")
as(quick, function() quick.LM:Answer(1, "bis") end)
local rs, gs = sent("R"), sent("G")
eq(#rs, 1, "one answer")
local _, rf = halo.LM.Wire.Decode(rs[1])
eq(rf[7], "601:276", "the answer still carries id:ilvl (lowest first)")
eq(rf[8], "600:289", "for both rings")
eq(#rf, 11, "the answer's fields are unchanged")
eq(#gs, 2, "two long rings: two G parts")
check(outbox[1].text:sub(1, 2) == "R|", "the answer goes first, the G parts after it")
for _, m in ipairs(outbox) do check(#m.text <= 255, "every message is 255 bytes or less (" .. #m.text .. ")") end
check(gs[1]:find("^G|" .. s.id .. ":1|") ~= nil, "G names the session and the item")
deliver()
local g = gearOf(halo, "Quick-Sargeras")
eq(g[1].itemString, RING2 , "looter: the lower ring's exact item string")
eq(g[2].itemString, RING1, "looter: the higher ring's, empty tail dropped")
eq(g[1].slot, 12, "looter: its slot")
eq(g[2].ilvl, 289, "looter: its item level")
eq(halo.CRT.Gear:Of("Quick-Sargeras", 11).itemString, RING1, "looter: the gear engine remembers it")
eq(select(2, halo.CRT.Gear:When("Quick-Sargeras")), "lootmaster", "looter: from Loot Master")
local vg = quick.LM.incoming.view.players["Quick-Sargeras"].answers[1].gear
eq(vg[2].itemString, RING1, "raider window: the full item too")
-- the tooltip: the exact ring by its item string
local tip = {}
GameTooltip = { SetOwner = function() end, SetHyperlink = function(_, l) tip.link = l end, SetItemByID = function(_, id) tip.byID = id end,
  AddLine = function(_, t) tip.line = t end, Show = function() end }
halo.CRT.Gear.ShowTooltip({}, g[2])
eq(tip.link, RING1, "tooltip: the exact item")
eq(tip.line, "Equipped at item level 289", "tooltip: with the item level")
-- a changed answer: the R resets the pieces to IDs, its G fills them again
as(quick, function() quick.LM:Answer(1, "up") end)
deliver()
g = gearOf(halo, "Quick-Sargeras")
eq(halo.LM.current.players["Quick-Sargeras"].answers[1].response, "up", "changed answer arrived")
eq(g[2].itemString, RING1, "changed answer: the full item again")

-- 2. An old raider (1.1.0): no G, so the ID tooltip
as(arrow, function() arrow.LM:Answer(1, "bis") end)
eq(#sent("G"), 0, "an old raider sends no G")
deliver()
local ag = gearOf(halo, "Arrow-Sargeras")
eq(ag[1].id, 9, "old raider: the item ID from the answer")
eq(ag[1].itemString, nil, "old raider: no item string")
tip = {}
halo.CRT.Gear.ShowTooltip({}, ag[1])
eq(tip.byID, 9, "old raider: the tooltip by ID")
eq(tip.link, nil, "old raider: no hyperlink")
eq(halo.CRT.Gear:When("Arrow-Sargeras"), nil, "old raider: nothing remembered")

-- 3. Parts that don't fit an answer are ignored
local function quickRing() return gearOf(halo, "Quick-Sargeras")[2].itemString end
inject("G|nosuch:1|11~item:600:1~289", "Quick")
eq(quickRing(), RING1, "an unknown session changes nothing")
inject("G|" .. s.id .. ":5|11~item:600:1~289", "Quick")
eq(quickRing(), RING1, "an unknown item changes nothing")
eq(halo.CRT.Gear:Of("Quick-Sargeras", 11).itemString, RING1, "and is not remembered")
inject("G|" .. s.id .. ":1|11~item:777:1~289", "Quick")
eq(quickRing(), RING1, "an item the answer doesn't have changes nothing")
eq(halo.CRT.Gear:Of("Quick-Sargeras", 11).id, 600, "and is not remembered")
inject("G|" .. s.id .. ":1|garbage;11~spell:5~1;;", "Quick")
eq(quickRing(), RING1, "junk changes nothing")
inject("G|" .. s.id .. "|11~item:600:1~289", "Quick")
inject("G|", "Quick")
eq(quickRing(), RING1, "a malformed head changes nothing")

-- 4. Only the answering raider's own G counts
inject("G|" .. s.id .. ":1|11~item:600:9:9~289", "Arrow")
eq(quickRing(), RING1, "another raider can't change Quick's gear")
eq(gearOf(halo, "Arrow-Sargeras")[1].itemString, nil, "nor is it put on their own answer (a different item)")
eq(halo.CRT.Gear:When("Arrow-Sargeras"), nil, "nor remembered for them")
inject("G|" .. s.id .. ":1|11~item:600:9:9~289", "Halo")
eq(quickRing(), RING1, "the looter's own CRT can't either")
local ha = halo.LM.current.players["Halo-Sargeras"].answers[1]
check(not (ha and ha.gear), "and nothing is put on the looter's own unanswered row")
inject("G|" .. s.id .. ":1|13~item:9:5:6~276", "Arrow")
eq(gearOf(halo, "Arrow-Sargeras")[1].itemString, "item:9:5:6", "a raider's own G fills their own answer")
eq(quickRing(), RING1, "and leaves the others alone")

-- 5. An old looter (1.1.0's Comm) drops G; the new raider's answer still arrives
local errors = fails
local oldHalo, newQuick = boot("Halo", oldCommSrc, false), boot("Quick", commSrc, true)
raid = { oldHalo, newQuick }
outbox = {}
local os = as(oldHalo, function() return oldHalo.LM:Start({ { itemString = "item:500", ilvl = 300 } }, true) end)
deliver()
as(newQuick, function() newQuick.LM:Answer(1, "bis") end)
eq(#sent("G"), 2, "the new raider sends G to the old looter too")
deliver()
eq(fails, errors, "old looter: no error from the unknown part")
local oa = os.players["Quick-Sargeras"].answers[1]
eq(oa.response, "bis", "old looter: the answer arrived")
eq(oa.gear[1].id, 601, "old looter: the items by ID, as before")
eq(oa.gear[1].itemString, nil, "old looter: no item string")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Core/Gear.lua', 'CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Dev/Tests/old_Comm.lua']) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(dir, f), 'utf8')));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
