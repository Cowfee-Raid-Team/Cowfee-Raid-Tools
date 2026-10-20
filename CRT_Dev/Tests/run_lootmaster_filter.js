// CRT_Modules/LootMaster/Filter.lua, FilterTab.lua and the filter's use in Test.lua and Page.lua: the defaults (from
// CRT_Core/Core.lua), every kind of item, both sources, the quality and item level thresholds, facts the game can't
// give (the item is left out, with a chat line), cleaning, /crt loot test's sampling, and the Loot filter tab
// on stand-in frames, placed before Settings. Usage: node run_lootmaster_filter.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local coreSrc, dataSrc, filterSrc, testSrc, tabSrc, pageSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end

-- a stand-in frame: any method is a no-op, unless set here
local function mock(kind)
  local m = { kind = kind, shown = true, pts = {}, scripts = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock("Region") end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 7 end end
    if k == "GetFont" then return function() return "f", 12, "" end end
    if k == "GetTextColor" then return function() return 1, 1, 1 end end
    if k == "GetFrameLevel" then return function() return 2 end end
    if k == "GetHeight" then return function() return 26 end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on) end end
    if k == "GetChecked" then return function(self) return rawget(self, "checked") end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" or k == "IsVisible" then return function(self) return self.shown end end
    return function() end
  end })
end
CreateFrame = function(kind, name, parent, template) local f = mock(kind) rawset(f, "template", template) return f end
CreateFont = function() return mock("Font") end
for _, n in ipairs({ "GameFontNormal", "GameFontHighlight", "GameFontDisable", "GameFontHighlightSmall", "GameFontDisableSmall",
  "GameFontNormalLarge", "GameFontNormalSmall", "ChatFontNormal" }) do _G[n] = mock("Font") end

local CRT = {}
assert(load(coreSrc, "CRT_Core/Core.lua"))("CowfeeRaidTools", CRT)
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
local function deepCopy(t) if type(t) ~= "table" then return t end local o = {} for k, v in pairs(t) do o[k] = deepCopy(v) end return o end
CRT.db = { lootmaster = deepCopy(CRT.defaults.lootmaster) }
GetTime = function() return 100 end
time = function() return 1790000000 end
geterrorhandler = function() return print end
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
local LM = CRT.LootMaster
assert(load(filterSrc, "Filter.lua"))("CowfeeRaidTools", CRT)

-- 1. The defaults, as in the approved mockup: boss loot, Epic and up, any item level, BoP gear and tier
local D = CRT.defaults.lootmaster.filter
eq(D.boss, true, "default: boss loot on")
eq(D.trash, false, "default: trash loot off")
eq(D.quality, 4, "default: Epic and up")
eq(D.ilvl, 0, "default: any item level")
local wantKinds = { bop = true, tier = true, boe = false, wue = false, toy = false, mount = false, cosmetic = false, other = false }
for k, v in pairs(wantKinds) do eq(D.kinds[k], v, "default kind " .. k) end
eq(#LM.FILTER_KINDS, 8, "eight kinds")
for _, k in ipairs(LM.FILTER_KINDS) do check(wantKinds[k] ~= nil, "every kind has a default: " .. k) end
local F = LM:Filter()
eq(F.quality, 4, "your filter: the defaults")
CRT.db.lootmaster.filter = nil
eq(LM:Filter().boss, true, "old saved data with no filter: the defaults")
eq(LM:Filter().kinds.bop, true, "old saved data with no filter: BoP gear on")
CRT.db.lootmaster.filter = deepCopy(D)

-- 2. Every kind, by the facts alone (pure)
local function facts(t) local f = { source = "boss", quality = 4, ilvl = 250, classID = 4, subClassID = 4, bindType = 1 } for k, v in pairs(t or {}) do f[k] = v end return f end
eq(LM.ItemKind(facts()), "bop", "kind: armor that binds on pickup")
eq(LM.ItemKind(facts({ classID = 2 })), "bop", "kind: a weapon that binds on pickup")
eq(LM.ItemKind(facts({ bindType = 2 })), "boe", "kind: bind on equip")
eq(LM.ItemKind(facts({ bindType = 9 })), "wue", "kind: warbound until equipped")
eq(LM.ItemKind(facts({ bindType = 8 })), "other", "kind: warbound gear is other")
eq(LM.ItemKind(facts({ setID = 1700, isClassSet = true })), "tier", "kind: a class set's piece")
eq(LM.ItemKind(facts({ setID = 1700, isClassSet = false })), "bop", "kind: a set piece of no class set counts by its binding")
eq(LM.ItemKind(facts({ setID = 0 })), "bop", "kind: set 0 is no set")
eq(LM.ItemKind(facts({ classID = 15, subClassID = 0, isToken = true })), "tier", "kind: a tier token")
eq(LM.ItemKind(facts({ classID = 15, subClassID = 0, isToy = true })), "toy", "kind: a toy")
eq(LM.ItemKind(facts({ classID = 15, subClassID = 5, isMount = true })), "mount", "kind: a mount")
eq(LM.ItemKind(facts({ classID = 15, subClassID = 2, isPet = true })), "mount", "kind: a pet (with mounts)")
eq(LM.ItemKind(facts({ subClassID = 5, isCosmetic = true, bindType = 2 })), "cosmetic", "kind: a cosmetic before its binding")
eq(LM.ItemKind(facts({ classID = 9, subClassID = 4, bindType = 0 })), "other", "kind: a recipe")
eq(LM.ItemKind(facts({ classID = 7, subClassID = 1, bindType = 0 })), "other", "kind: a reagent")
eq(LM.ItemKind(facts({ classID = 15, subClassID = 0, isToken = false })), "other", "kind: junk with no Classes line")

-- 3. The filter decides: sources, quality, item level, kinds
local function filt(t) local f = deepCopy(D) for k, v in pairs(t or {}) do f[k] = v end return f end
eq((LM.PassesFilter(facts(), filt())), true, "pass: boss BoP epic")
local ok, why = LM.PassesFilter(facts({ source = "trash" }), filt())
eq(ok, false, "trash off: left out") eq(why, "source", "trash off: why")
eq((LM.PassesFilter(facts({ source = "trash" }), filt({ trash = true }))), true, "trash on: passes")
ok, why = LM.PassesFilter(facts(), filt({ boss = false, trash = true }))
eq(ok, false, "boss off: left out") eq(why, "source", "boss off: why")
ok, why = LM.PassesFilter(facts({ quality = 3 }), filt())
eq(ok, false, "rare under Epic and up") eq(why, "quality", "quality: why")
eq((LM.PassesFilter(facts({ quality = 3 }), filt({ quality = 3 }))), true, "rare under Rare and up")
eq((LM.PassesFilter(facts({ quality = 5 }), filt())), true, "legendary under Epic and up")
eq((LM.PassesFilter(facts({ quality = 4 }), filt({ quality = 5 }))), false, "epic under Legendary and up")
eq((LM.PassesFilter(facts({ ilvl = 1 }), filt({ ilvl = 0 }))), true, "item level Any: everything")
ok, why = LM.PassesFilter(facts({ ilvl = 245 }), filt({ ilvl = 250 }))
eq(ok, false, "under the item level") eq(why, "ilvl", "item level: why")
eq((LM.PassesFilter(facts({ ilvl = 250 }), filt({ ilvl = 250 }))), true, "at the item level")
eq((LM.PassesFilter(facts({ ilvl = 251 }), filt({ ilvl = 250 }))), true, "over the item level")
local kindFacts = {
  bop = facts(), tier = facts({ setID = 9, isClassSet = true }), boe = facts({ bindType = 2 }), wue = facts({ bindType = 9 }),
  toy = facts({ classID = 15, isToy = true }), mount = facts({ classID = 15, isMount = true }),
  cosmetic = facts({ isCosmetic = true }), other = facts({ classID = 9, bindType = 0 }),
}
for _, k in ipairs(LM.FILTER_KINDS) do
  local only = filt({ kinds = {} })
  for _, x in ipairs(LM.FILTER_KINDS) do only.kinds[x] = x == k end
  for _, x in ipairs(LM.FILTER_KINDS) do
    local pass, w, kind = LM.PassesFilter(kindFacts[x], only)
    eq(pass, x == k, "only " .. k .. " ticked: " .. x .. (x == k and " passes" or " left out"))
    if x ~= k then eq(w, "kind", "only " .. k .. ": " .. x .. " left out for its kind") end
    eq(kind, x, "the kind is given back for " .. x)
  end
end
eq((LM.PassesFilter(facts({ source = "trash" }), filt({ trash = true, boss = false }))), true, "trash only: trash passes")
-- a part that can't be read is skipped: the item is let through on it (Alex: "Let it through")
ok, why = LM.PassesFilter(nil, filt())
eq(ok, true, "no facts: let through") eq(why, "unreadable", "no facts: why")
ok, why = LM.PassesFilter(facts({ source = "chest" }), filt())
eq(ok, true, "an unknown source: let through") eq(why, "unreadable", "an unknown source: why")
ok, why = LM.PassesFilter(facts({ source = "chest", quality = 2 }), filt())
eq(ok, false, "an unknown source: the readable quality still counts") eq(why, "quality", "an unknown source: left out for its quality")
local noQuality, noIlvl = facts(), facts()
noQuality.quality, noIlvl.ilvl = nil, nil
ok, why = LM.PassesFilter(noQuality, filt())
eq(ok, true, "no quality: let through") eq(why, "unreadable", "no quality: why")
ok, why = LM.PassesFilter(noQuality, filt({ boss = false }))
eq(ok, false, "no quality: the readable source still counts") eq(why, "source", "no quality: left out for its source")
ok, why = LM.PassesFilter(noIlvl, filt({ ilvl = 200 }))
eq(ok, true, "no item level with a minimum: let through") eq(why, "unreadable", "no item level: why")
eq((LM.PassesFilter(noIlvl, filt({ ilvl = 0 }))), true, "no item level with Any: passes")
ok, why = LM.PassesFilter(facts({ isToy = true, kindUnknown = true }), filt())
eq(ok, true, "kind unknown: let through, whatever the kinds ticked") eq(why, "unreadable", "kind unknown: why")
ok, why = LM.PassesFilter(facts({ kindUnknown = true, quality = 3 }), filt())
eq(ok, false, "kind unknown: the readable quality still counts")

-- 4. Cleaning (the tab and a sync use it)
local c = LM.CleanFilter({ boss = "yes", trash = true, quality = 7, ilvl = 1003, kinds = { toy = true, bogus = true, bop = 1 } }, D)
eq(c.boss, true, "clean: a non-boolean keeps the fallback")
eq(c.trash, true, "clean: a boolean kept")
eq(c.quality, 4, "clean: an unknown quality keeps the fallback")
eq(c.ilvl, 500, "clean: item level at most 500")
eq(c.kinds.toy, true, "clean: a kind kept")
eq(c.kinds.bogus, nil, "clean: an unknown kind dropped")
eq(c.kinds.bop, true, "clean: a non-boolean kind keeps the fallback")
eq(LM.CleanFilter({ ilvl = -5 }, D).ilvl, 0, "clean: item level at least 0")
eq(LM.CleanFilter({ ilvl = 252.4 }, D).ilvl, 252, "clean: a whole item level")
eq(LM.LIMITS.filterIlvl[2], 500, "item level: Data.lua's limit, up to 500")
eq(LM.LIMITS.filterIlvl[3], 1, "item level: in steps of 1")
eq(LM.CleanFilter({ quality = "3" }, D).quality, 3, "clean: a quality as text")
eq(LM.CleanFilter("junk").quality, 4, "clean: not a table is the defaults")

-- 5. Reading the facts from the game
Enum = { ItemBind = { None = 0, OnAcquire = 1, OnEquip = 2, OnUse = 3, Quest = 4, ToWoWAccount = 7, ToBnetAccount = 8, ToBnetAccountUntilEquipped = 9 } }
ITEM_CLASSES_ALLOWED = "Classes: %s"
local SECRET = setmetatable({}, { __eq = function() error("compared a secret value") end, __lt = function() error("compared a secret value") end,
  __le = function() error("compared a secret value") end })
issecretvalue = function(v) return rawequal(v, SECRET) end
-- id -> { quality, ilvl, class, sub, bind, set, toy, mount, pet, cosmetic, wue (the second word), classes line }
local ITEMS = {
  [101] = { q = 4, ilvl = 263, class = 4, sub = 4, bind = 1 },                     -- plate, BoP
  [102] = { q = 4, ilvl = 263, class = 2, sub = 7, bind = 2 },                     -- sword, BoE
  [103] = { q = 4, ilvl = 263, class = 4, sub = 1, bind = 9 },                     -- cloth, warbound until equipped
  [104] = { q = 4, ilvl = 263, class = 4, sub = 2, bind = 1, wue = true },         -- the second word says warbound until equipped
  [105] = { q = 4, ilvl = 263, class = 4, sub = 3, bind = 1, set = 1980, classes = true }, -- a tier piece
  [116] = { q = 4, ilvl = 263, class = 4, sub = 3, bind = 1, set = 1981 },         -- a set piece of no class set
  [106] = { q = 4, ilvl = 263, class = 15, sub = 0, bind = 1, classes = true },    -- a tier token
  [107] = { q = 4, ilvl = 1, class = 15, sub = 0, bind = 1, toy = true },          -- a toy
  [108] = { q = 4, ilvl = 1, class = 15, sub = 5, bind = 1, mount = 9001 },        -- a mount
  [109] = { q = 3, ilvl = 1, class = 15, sub = 2, bind = 0, pet = "Whelp" },       -- a pet
  [110] = { q = 4, ilvl = 1, class = 4, sub = 5, bind = 2 },                       -- cosmetic armor
  [111] = { q = 4, ilvl = 1, class = 4, sub = 0, bind = 9, cosmetic = true },      -- the game says cosmetic
  [112] = { q = 3, ilvl = 1, class = 9, sub = 4, bind = 0 },                       -- a recipe
  [113] = { q = 4, ilvl = 1, class = 15, sub = 0, bind = 1 },                      -- junk, no Classes line
  [114] = { q = 4, ilvl = 1, class = 15, sub = 5, bind = 1 },                      -- a mount by its subclass only
}
local broken = {} -- API name -> "error" or "missing" or "secret"
local function call(name, v) if broken[name] == "error" then error(name .. " failed") end if broken[name] == "secret" then return SECRET end return v end
local function idOf(s) return tonumber(tostring(s):match("item:(%d+)")) end
local function api(name, fn) return function(...) if broken[name] == "missing" then return nil end return fn(...) end end
C_Item = {
  GetItemInfo = function(s) local it = ITEMS[idOf(s)] if not it or it.uncached then return nil end
    return "Name", "[Name]", call("quality", it.q), it.ilvl, 0, "T", "S", 1, "", 1, 0, it.class, it.sub, it.bind, 11, it.set, false, "" end,
  GetDetailedItemLevelInfo = function(s) local it = ITEMS[idOf(s)] return it and it.ilvl + 3 end,
  IsCosmeticItem = function(s) return call("IsCosmeticItem", ITEMS[idOf(s)].cosmetic) end,
  IsItemBindToAccountUntilEquip = function(s) return call("IsItemBindToAccountUntilEquip", ITEMS[idOf(s)].wue or false) end,
  GetItemInfoInstant = function(s) local it = ITEMS[idOf(s)] return idOf(s), "T", "S", "", 1, it and it.class, it and it.sub end,
}
C_ToyBox = { GetToyInfo = function(id) check(type(id) == "number", "toy: asked by item ID") local it = ITEMS[id] if it and it.toy then return call("GetToyInfo", id), "Toy" end if it and it.halfToy then return id, nil end return call("GetToyInfo", nil) end }
C_MountJournal = { GetMountFromItem = function(id) check(type(id) == "number", "mount: asked by item ID") return call("GetMountFromItem", ITEMS[id] and ITEMS[id].mount) end }
C_PetJournal = { GetPetInfoByItemID = function(id) check(type(id) == "number", "pet: asked by item ID (a link raises an error)") return call("GetPetInfoByItemID", ITEMS[id] and ITEMS[id].pet) end }
C_TooltipInfo = { GetHyperlink = function(s) if broken.tooltip == "error" then error("tooltip") end if broken.tooltip == "nil" then return nil end
  local it = ITEMS[idOf(s)] local lines = { { leftText = "Name" }, { leftText = SECRET } }
  if it.classes then lines[#lines + 1] = { leftText = "Classes: Warrior, Paladin, Death Knight" } end return { lines = lines } end }
local function kindOf(id, source)
  local f, w = LM.ItemFacts("item:" .. id .. "::::", source or "boss")
  return (f and not f.kindUnknown) and LM.ItemKind(f) or nil, f, w
end
eq(kindOf(101), "bop", "game: BoP plate")
eq(kindOf(102), "boe", "game: BoE sword")
eq(kindOf(103), "wue", "game: warbound until equipped by bindType")
eq(kindOf(104), "wue", "game: warbound until equipped by C_Item.IsItemBindToAccountUntilEquip")
eq(kindOf(105), "tier", "game: a class set's piece (a setID and a Classes line)")
eq(kindOf(116), "bop", "game: a set piece with no Classes line counts by its binding")
eq(kindOf(106), "tier", "game: a token with a Classes line")
eq(kindOf(107), "toy", "game: a toy")
ITEMS[115] = { q = 4, ilvl = 1, class = 15, sub = 4, bind = 1, halfToy = true }
eq(kindOf(115), "other", "game: an item ID with no toy name is not a toy (as Blizzard's toy box reads it)")
eq(kindOf(108), "mount", "game: a mount")
eq(kindOf(109), "mount", "game: a pet")
eq(kindOf(110), "cosmetic", "game: cosmetic armor subclass")
eq(kindOf(111), "cosmetic", "game: C_Item.IsCosmeticItem")
eq(kindOf(112), "other", "game: a recipe")
eq(kindOf(113), "other", "game: junk without a Classes line")
eq(kindOf(114), "mount", "game: a mount by subclass")
local _, f101 = kindOf(101)
eq(f101.ilvl, 266, "game: the item level with upgrades")
eq(f101.quality, 4, "game: quality")
eq(f101.source, "boss", "game: the source given")
local _, ft = kindOf(101, "trash")
eq(ft.source, "trash", "game: trash")
-- unreadable: the facts that can be read are kept, the rest listed in f.unreadable
local function has(list, w) for _, x in ipairs(list) do if x == w then return true end end return false end
local function why(id, source) local _, f = kindOf(id, source) return f end
local f0 = LM.ItemFacts("item:101", nil)
eq(f0.source, nil, "unreadable: no source") check(has(f0.unreadable, LM.FILTER_WHY.source), "unreadable: no source, why")
eq(f0.quality, 4, "unreadable: no source, the quality still read")
eq(f0.kindUnknown, nil, "unreadable: no source, the kind still known")
ITEMS[101].uncached = true
f0 = why(101)
eq(f0.quality, nil, "unreadable: not loaded, no quality") eq(f0.kindUnknown, true, "unreadable: not loaded, kind unknown")
check(has(f0.unreadable, LM.FILTER_WHY.notLoaded), "unreadable: not loaded, why")
eq(f0.source, "boss", "unreadable: not loaded, the source still known")
eq(f0.ilvl, 266, "unreadable: not loaded, the item level still read when the game gives it")
ITEMS[101].uncached = nil
f0 = why(999)
eq(f0.kindUnknown, true, "unreadable: an unknown item")
f0 = LM.ItemFacts("garbage", "boss")
eq(f0.kindUnknown, true, "unreadable: not an item string")
for _, case in ipairs({ { "GetToyInfo", "toy" }, { "GetMountFromItem", "mount" }, { "GetPetInfoByItemID", "pet" }, { "IsCosmeticItem", "cosmetic" } }) do
  for _, how in ipairs({ "error", "secret" }) do
    broken[case[1]] = how
    f0 = why(101)
    eq(f0.kindUnknown, true, "unreadable: " .. case[1] .. " " .. how .. ", kind unknown")
    check(has(f0.unreadable, LM.FILTER_WHY[case[2]]), "unreadable: " .. case[1] .. " " .. how .. ", why")
    eq(f0.quality, 4, "unreadable: " .. case[1] .. " " .. how .. ", quality still read")
    broken[case[1]] = nil
  end
end
local saveToy = C_ToyBox
C_ToyBox = nil
f0 = why(101)
check(has(f0.unreadable, LM.FILTER_WHY.toy), "unreadable: no toy API at all")
C_ToyBox = saveToy
broken.quality = "secret"
f0 = why(101)
eq(f0.quality, nil, "unreadable: a secret quality is never kept") check(has(f0.unreadable, LM.FILTER_WHY.notLoaded), "unreadable: a secret quality, why")
broken.quality = nil
broken.IsItemBindToAccountUntilEquip = "error"
eq(kindOf(101), "bop", "the second warbound word failing changes nothing (bindType says it)")
broken.IsItemBindToAccountUntilEquip = nil
broken.tooltip = "error"
f0 = why(106)
eq(f0.kindUnknown, true, "unreadable: a Miscellaneous item with no tooltip") check(has(f0.unreadable, LM.FILTER_WHY.token), "unreadable: tooltip, why")
eq(kindOf(101), "bop", "gear with no set needs no tooltip")
f0 = why(105)
eq(f0.kindUnknown, true, "unreadable: a set piece with no tooltip") check(has(f0.unreadable, LM.FILTER_WHY.setPiece), "unreadable: set piece tooltip, why")
eq(kindOf(107), "toy", "a toy needs no tooltip")
broken.tooltip = "nil"
eq(why(113).kindUnknown, true, "unreadable: tooltip data missing")
broken.tooltip = nil
-- LM:FilterLoot: each unreadable case is let through, and the leader is told what couldn't be read
local function loot(id, source, link) printed = {} local a, b = LM:FilterLoot("item:" .. id, source, link) return a, b end
ITEMS[101].uncached = true
ok, why = loot(101, "boss", "[Plate Helm]")
eq(ok, true, "FilterLoot: not loaded, let through") eq(why, "unreadable", "FilterLoot: why")
eq(printed[1], "Loot Master couldn't read [Plate Helm] (its details, not loaded yet), so it's included.", "FilterLoot: a chat line")
ok = loot(101, "trash")
eq(ok, false, "FilterLoot: not loaded, but trash with trash off is still left out")
eq(#printed, 0, "FilterLoot: no chat line when left out")
ITEMS[101].uncached = nil
eq((loot(107, nil, "[Toy]")), false, "FilterLoot: no source, a toy is still left out by its kind")
eq((loot(101, nil, "[Helm]")), true, "FilterLoot: no source, BoP gear let through")
eq(printed[1], "Loot Master couldn't read [Helm] (where it dropped), so it's included.", "FilterLoot: no source, the chat line")
for _, case in ipairs({ { "GetToyInfo", "toy" }, { "GetMountFromItem", "mount" }, { "GetPetInfoByItemID", "pet" }, { "IsCosmeticItem", "cosmetic" } }) do
  for _, how in ipairs({ "error", "secret" }) do
    broken[case[1]] = how
    eq((loot(102, "boss", "[Sword]")), true, "FilterLoot: " .. case[1] .. " " .. how .. ", BoE gear let through")
    eq(printed[1], "Loot Master couldn't read [Sword] (" .. LM.FILTER_WHY[case[2]] .. "), so it's included.", "FilterLoot: " .. case[1] .. " " .. how .. ", the chat line")
    broken[case[1]] = nil
  end
end
broken.quality = "secret"
eq((loot(101, "boss")), true, "FilterLoot: a secret quality, let through")
broken.quality = nil
broken.tooltip = "error"
eq((loot(106, "boss")), true, "FilterLoot: a token whose tooltip can't be read, let through")
eq((loot(113, "boss")), true, "FilterLoot: junk whose tooltip can't be read, let through")
broken.tooltip = nil
eq((loot(113, "boss")), false, "FilterLoot: the same junk, read, is left out")
eq((loot(101, "boss")), true, "FilterLoot: a boss BoP epic passes with the defaults")
eq(#printed, 0, "FilterLoot: no chat line when everything was read")
eq((loot(107, "boss")), false, "FilterLoot: a toy is left out with the defaults")
eq((loot(101, "trash")), false, "FilterLoot: trash is left out with the defaults")
eq(#printed, 0, "FilterLoot: no chat line for an item the filter leaves out")

-- 6. /crt loot test samples items that pass the filter, else fills with others and says so
local HISTORY = {}
local function hist(id) HISTORY[#HISTORY + 1] = { [8] = "item:" .. id .. "::::" } end
for _, id in ipairs({ 101, 102, 103, 105, 106, 107, 108, 110, 112 }) do hist(id) end
CRT.Loot = { R = { ITEM = 8 }, ItemID = function(s) return idOf(s) end, Each = function(_, fn) for _, rec in ipairs(HISTORY) do fn(rec) end end }
CRT.LootRCLC = nil
IsInGroup = function() return false end
assert(load(testSrc, "Test.lua"))("CowfeeRaidTools", CRT)
local started
function LM:Start(items) started = items return { items = items } end
local function seeded(seed) return function(n) seed = (seed * 1103515245 + 12345) % 2147483648 return (seed % n) + 1 end end
local function kindsOf(items) local out = {} for _, it in ipairs(items) do out[#out + 1] = (kindOf(idOf(it.itemString))) end return out end
local function only(kind) local f = filt({ kinds = {} }) for _, x in ipairs(LM.FILTER_KINDS) do f.kinds[x] = x == kind end CRT.db.lootmaster.filter = f end
only("toy")
printed = {}
LM:Test(1, seeded(3))
eq(#started, 1, "test, toys only: one item")
eq(kindsOf(started)[1], "toy", "test, toys only: the toy")
eq(#printed, 1, "test: no note when enough pass")
printed = {}
LM:Test(3, seeded(3))
eq(#started, 3, "test, toys only, three asked: filled to three")
eq(kindsOf(started)[1], "toy", "test: the toy first")
eq(printed[1], "Loot Master test: only 1 of your sample items passes the loot filter, so the test adds 2 others.", "test: says it filled")
CRT.db.lootmaster.filter = deepCopy(D)
printed = {}
LM:Test(3, seeded(5))
local n = 0
for _, k in ipairs(kindsOf(started)) do if k == "bop" or k == "tier" then n = n + 1 end end
eq(n, 3, "test, defaults: the three boss items that pass (BoP gear, tier)")
eq(#printed, 1, "test, defaults: no note")
CRT.db.lootmaster.filter = filt({ boss = false, trash = true })
printed = {}
LM:Test(2, seeded(5))
eq(#started, 2, "test, trash only: still two items")
eq(printed[1], "Loot Master test: none of your sample items pass the loot filter, so the test uses others.", "test: samples count as boss loot, so none pass")
CRT.db.lootmaster.filter = deepCopy(D)
-- the pool is read only until count items pass
local reads = 0
local realInfo = C_Item.GetItemInfo
C_Item.GetItemInfo = function(...) reads = reads + 1 return realInfo(...) end
CRT.db.lootmaster.filter = deepCopy(D)
CRT.db.lootmaster.filter.quality = 2
for _, x in ipairs(LM.FILTER_KINDS) do CRT.db.lootmaster.filter.kinds[x] = true end
LM:Test(1, seeded(5))
eq(reads, 1, "test: with every item passing, one asked, only one item read")
reads = 0
only("toy")
LM:Test(1, seeded(5))
check(reads <= #HISTORY, "test: reading stops at the toy (" .. reads .. " of " .. #HISTORY .. " read)")
C_Item.GetItemInfo = realInfo
-- an item the game can't read is let through, after those it read in full
only("toy")
ITEMS[101].uncached = true
LM:Test(2, seeded(5))
eq(kindsOf(started)[1], "toy", "test: the toy read in full first")
eq(idOf(started[2].itemString), 101, "test: then the item that couldn't be read (let through)")
printed = {}
LM:Test(3, seeded(5))
eq(printed[1], "Loot Master test: only 2 of your sample items pass the loot filter, so the test adds 1 other.", "test: the unread item counts as passing")
ITEMS[101].uncached = nil

-- 7. The Loot filter tab: its checkboxes, quality dropdown, item level slider and Defaults
local fired = {}
LM:OnChange(function(what) fired[#fired + 1] = what end)
local drops, sliders, buttons, helps = {}, {}, {}, {}
CRT.UI = {
  PAGE_W = 1026, PAGE_H = 560,
  Dropdown = function(p, text, opts) local r = mock("Dropdown") rawset(r, "opts", opts) rawset(r, "refresh", function() end) rawset(r, "Dropdown", mock("DropdownButton")) drops[#drops + 1] = r return r end,
  Slider = function(p, text, opts) local r = mock("Slider") rawset(r, "opts", opts) rawset(r, "text", text) rawset(r, "refresh", function() end) sliders[#sliders + 1] = r return r end,
  PanelButton = function(p, label, h, fn) local b = mock("Button") rawset(b, "label", label) rawset(b, "click", fn) rawset(b, "h", h) buttons[#buttons + 1] = b return b end,
  Help = function(p, title, text) helps[title] = text return mock("Help") end,
}
assert(load(tabSrc, "FilterTab.lua"))("CowfeeRaidTools", CRT)
local checks, headings, refreshers = {}, {}, {}
local kit = {
  heading = function(f, x, y, text, help) headings[#headings + 1] = { text = text, help = help, x = x, y = y } return mock("FontString") end,
  check = function(f, x, y, text, get, set) checks[#checks + 1] = { text = text, get = get, set = set, x = x, y = y } end,
  refreshers = refreshers,
}
local tab = mock("Frame")
LM.BuildFilterTab(tab, kit)
local TEXT = LM.FILTER_TEXT
local byText = {}
for _, cb in ipairs(checks) do byText[cb.text] = cb end
eq(#checks, 10, "tab: two source boxes and eight kinds")
for _, label in ipairs({ "Boss loot", "Trash loot", "Gear that binds on pickup", "Tier tokens and set pieces", "Bind on equip gear",
  "Warbound until equipped", "Toys", "Mounts and pets", "Cosmetics (appearance only)", "Recipes, reagents and other items" }) do
  check(byText[label] ~= nil, "tab: a box for " .. label)
end
eq(checks[3].text, "Gear that binds on pickup", "tab: the kinds in the mockup's order")
eq(checks[10].text, "Recipes, reagents and other items", "tab: other last")
for _, h in ipairs(headings) do check(type(h.help) == "string" and #h.help > 20, "tab: (?) help on " .. h.text) end
eq(#headings, 4, "tab: four headings, each with help")
check(TEXT.kindsHelp:find("tick that box to be safe", 1, true) ~= nil, "tab: the Kinds help says a token for every class may be in the last box")
CRT.db.lootmaster.filter = deepCopy(D)
eq(byText["Boss loot"].get(), true, "tab: boss shows on")
eq(byText["Toys"].get(), false, "tab: toys shows off")
fired = {}
byText["Toys"].set(true)
eq(CRT.db.lootmaster.filter.kinds.toy, true, "tab: ticking Toys saves it")
eq(fired[#fired], "filter", "tab: the page is told")
byText["Trash loot"].set(true)
eq(CRT.db.lootmaster.filter.trash, true, "tab: ticking Trash saves it")
byText["Gear that binds on pickup"].set(false)
eq(CRT.db.lootmaster.filter.kinds.bop, false, "tab: unticking BoP gear saves it")
eq(#drops, 1, "tab: one dropdown (quality)")
C_Item.GetItemQualityColor = function(q) if q == 4 then return 0.64, 0.21, 0.93, "ffa335ee" end error("no colour") end
local qo = drops[1].opts.options()
eq(qo[3].label, "|cffa336edEpic and up|r", "quality: Epic in its colour")
eq(qo[1].label, "Uncommon and up", "quality: no colour when the game gives none")
eq(#qo, 4, "quality: four choices")
check(qo[1].label:find("Uncommon and up", 1, true) ~= nil, "quality: Uncommon and up first")
check(qo[3].label:find("Epic and up", 1, true) ~= nil, "quality: Epic and up")
eq(drops[1].opts.get(), 4, "quality: Epic and up by default")
drops[1].opts.set(3)
eq(CRT.db.lootmaster.filter.quality, 3, "quality: picking Rare saves it")
eq(#sliders, 1, "tab: one slider (item level)")
local so = sliders[1].opts
eq(so.min, 0, "item level: from 0") eq(so.format(0), "Any", "item level: 0 reads Any") eq(so.format(250), "250", "item level: a number")
so.set(250)
eq(CRT.db.lootmaster.filter.ilvl, 250, "item level: saved")
eq(so.get(), 250, "item level: read back")
eq(#buttons, 1, "tab: one button")
eq(buttons[1].label, "Defaults", "tab: Defaults")
buttons[1].click()
local after = CRT.db.lootmaster.filter
eq(after.trash, false, "Defaults: trash off again")
eq(after.quality, 4, "Defaults: Epic and up again")
eq(after.ilvl, 0, "Defaults: any item level again")
eq(after.kinds.toy, false, "Defaults: toys off again")
eq(after.kinds.bop, true, "Defaults: BoP gear on again")
check(after ~= CRT.defaults.lootmaster.filter and after.kinds ~= CRT.defaults.lootmaster.filter.kinds, "Defaults: a copy, never the defaults table itself")
for _, cb in ipairs(checks) do check(cb.x + 300 < CRT.UI.PAGE_W, "tab: " .. cb.text .. " inside the page") end
check(#refreshers >= 2, "tab: the dropdown and slider are refreshed with the page")

-- 8. The page: Tonight, Raider Score, Loot filter, Settings (Settings last)
local pageBuild
CRT.UI.RegisterPage = function(_, key, title, build) pageBuild = build end
CRT.UI.RegisterTab = function() end
CRT.UI.SetTabSelected = function() end
local tabs = {}
local realCreate = CreateFrame
CreateFrame = function(kind, name, parent, template)
  local f = realCreate(kind, name, parent, template)
  rawset(f, "CreateFontString", function() local fsx = mock("FontString") if kind == "Button" and template == "BackdropTemplate" and parent and rawget(parent, "isPage") then tabs[#tabs + 1] = fsx end return fsx end)
  return f
end
LM.AUTHORITY_MAX = LM.AUTHORITY_MAX or 6
CRT.UI.SortHeaders = function() return { refresh = function() end } end
CRT.UI.SkinEditBox = function() end
CRT.UI.SkinCloseButton = function() end
CreateScrollBoxListLinearView = function() return mock("View") end
ScrollUtil = { InitScrollBoxListWithScrollBar = function() end }
assert(load(pageSrc, "Page.lua"))("CowfeeRaidTools", CRT)
local built = {}
local realBuild = LM.BuildFilterTab
LM.BuildFilterTab = function(f, k) built.filter = k realBuild(f, k) end
-- every other tab's builder runs on stand-ins; it only matters that the tab bar is right
local pf = mock("Frame") rawset(pf, "isPage", true) rawset(pf, "shown", false)
local okBuild, err = pcall(pageBuild, pf)
if not okBuild then print("page build stopped early (other tabs need more stand-ins): " .. tostring(err)) end
local labels = {}
for _, t in ipairs(tabs) do if t.text then labels[#labels + 1] = t.text end end
eq(labels[3], "Loot filter", "page: Loot filter is the third tab")
eq(labels[#labels], "Settings", "page: Settings stays last")
check(built.filter and type(built.filter.heading) == "function" and type(built.filter.check) == "function", "page: the tab gets the page's heading and check helpers")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = ['CRT_Core/Core.lua', 'CRT_Modules/LootMaster/Data.lua', 'CRT_Modules/LootMaster/Filter.lua', 'CRT_Modules/LootMaster/Test.lua', 'CRT_Modules/LootMaster/FilterTab.lua', 'CRT_Modules/LootMaster/Page.lua'];
for (const f of files) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
