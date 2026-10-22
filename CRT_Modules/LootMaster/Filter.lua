local ADDON, CRT = ...

-- Loot Master's loot filter: which items open a loot session (the Loot filter tab, LootMaster/FilterTab.lua).
-- Loot Master only: Loot History keeps its own minimum quality. The setting is CRTDB.lootmaster.filter, with
-- its defaults in Core.lua:
--   boss, trash   where the item dropped: from a boss, or from any other enemy (trash)
--   quality       the lowest quality (Enum.ItemQuality: 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary)
--   ilvl          the lowest item level, 0 for any
--   kinds[key]    the kinds of items that pass (LM.FILTER_KINDS); every item is one kind (LM.ItemKind)
-- LM.ItemFacts reads an item's facts from the game, and LM.PassesFilter decides with no game calls. A part of
-- the filter whose fact can't be read (not loaded yet, a secret value, a failing call) is skipped, so such an
-- item is let through (Alex, 2026-10-19: "Let it through"), and LM:FilterLoot says so in chat. The parts that
-- can be read still count. /crt loot test samples items that pass (LootMaster/Test.lua); the session start
-- from real loot is to call LM:FilterLoot.
-- Sync Master Loot sends it as its F part (LootMaster/Sync.lua), cleaned on receipt by LM.CleanFilter.
-- CRT Looting sends the leader's filter with its O and H messages (LM.FilterFields, LM.ParseFilterFields;
-- LootMaster/Looting.lua): the leader's CRT rolls only on items in it, and a raider's passes only those
-- (LootMaster/Rolls.lua). Alex, 2026-10-21: an item outside the filter gets the game's normal roll.
--
-- The game's facts, each checked on warcraft.wiki.gg (2026-10-19):
--   C_Item.GetItemInfo: quality, classID, subclassID, bindType (Enum.ItemBind), setID (an item set's piece);
--     nil while the item isn't cached
--   C_Item.GetDetailedItemLevelInfo: the item level with upgrades
--   C_ToyBox.GetToyInfo(itemID): a toy's item ID and name first; the wiki doesn't say what a non-toy gives,
--     and Blizzard's own toy box (Blizzard_ToyBox.lua) shows nothing when either is nil, so that is not a toy
--   C_MountJournal.GetMountFromItem(itemID): the mount ID, or nil
--   C_PetJournal.GetPetInfoByItemID(itemID): the pet's name first (an item ID only; a link raises an error)
--   C_Item.IsCosmeticItem(itemInfo): true for a cosmetic item (nil counts as not cosmetic)
--   C_Item.IsItemBindToAccountUntilEquip(itemInfo): warbound until equipped, besides bindType 9
--   C_TooltipInfo.GetHyperlink: a "Classes: ..." line (ITEM_CLASSES_ALLOWED) on a Miscellaneous item marks
--     a tier token (tokens have no item class of their own). A token for every class has no Classes line and
--     nothing else in its data says it is one, so it counts as "other" (the Kinds help says so).
--   A class set's piece: gear with a setID and a Classes line. No API says an item set is a class set:
--     C_Item.GetItemSetInfo(setID) gives only the set's name, and C_TransmogSets.GetSetInfo (with classMask)
--     takes a transmog set ID, not an item set's. A set piece without a Classes line counts by its binding.

local LM = CRT.LootMaster

-- The kinds, in the tab's order. Labels are the tab's (FilterTab.lua).
LM.FILTER_KINDS = { "bop", "tier", "boe", "wue", "toy", "mount", "cosmetic", "other" }
LM.FILTER_QUALITIES = { 2, 3, 4, 5 } -- the quality dropdown's choices (Enum.ItemQuality)

-- Enum values, with the wiki's numbers when the enum isn't there (a test, or an older client).
local ITEM_CLASS = { WEAPON = 2, ARMOR = 4, MISC = 15, BATTLE_PET = 17 } -- Enum.ItemClass
local ARMOR_COSMETIC = 5 -- Enum.ItemArmorSubclass.Cosmetic
local MISC_PET, MISC_MOUNT = 2, 5 -- Enum.ItemMiscellaneousSubclass.CompanionPet, .Mount
local function bind(name, fallback)
    local e = Enum and Enum.ItemBind
    return e and type(e[name]) == "number" and e[name] or fallback
end
local BIND_PICKUP = bind("OnAcquire", 1)
local BIND_EQUIP = bind("OnEquip", 2)
local BIND_WUE = bind("ToBnetAccountUntilEquipped", 9)

-- The defaults (Core.lua's, the one place they are written).
function LM.FilterDefaults()
    return LM.CleanFilter(CRT.defaults.lootmaster.filter, { kinds = {} })
end

local function isOne(list, v)
    for _, x in ipairs(list) do
        if x == v then
            return true
        end
    end
    return false
end

-- A filter made safe: true or false for boss, trash and each known kind (unknown kinds dropped), a quality
-- of the dropdown's, an item level within its limits. A missing or bad value is fallback's (a clean filter;
-- the defaults when not given).
function LM.CleanFilter(t, fallback)
    t = type(t) == "table" and t or {}
    fallback = fallback or LM.FilterDefaults()
    local kinds, fk = type(t.kinds) == "table" and t.kinds or {}, fallback.kinds or {}
    local out = { kinds = {} }
    for _, k in ipairs({ "boss", "trash" }) do
        if type(t[k]) == "boolean" then
            out[k] = t[k]
        else
            out[k] = fallback[k] == true
        end
    end
    local q = tonumber(t.quality)
    out.quality = (q and isOne(LM.FILTER_QUALITIES, q)) and q or (fallback.quality or LM.FILTER_QUALITIES[#LM.FILTER_QUALITIES])
    out.ilvl = LM.Clamp("filterIlvl", t.ilvl, fallback.ilvl)
    for _, k in ipairs(LM.FILTER_KINDS) do
        if type(kinds[k]) == "boolean" then
            out.kinds[k] = kinds[k]
        else
            out.kinds[k] = fk[k] == true
        end
    end
    return out
end

-- A filter as message fields: boss (1/0), trash (1/0), quality, item level, the kinds that pass joined by ",".
function LM.FilterFields(filter)
    local kinds = {}
    for _, k in ipairs(LM.FILTER_KINDS) do
        if filter.kinds[k] then
            kinds[#kinds + 1] = k
        end
    end
    return { filter.boss and 1 or 0, filter.trash and 1 or 0, filter.quality, filter.ilvl, table.concat(kinds, ",") }
end

-- The filter in fields f[first] to f[first + 4] (LM.FilterFields), or nil when any is missing or bad: a raider
-- takes nothing it can't read, so it passes nothing (an unknown kind is just off).
function LM.ParseFilterFields(f, first)
    local boss, trash = tostring(f[first]), tostring(f[first + 1])
    local quality, ilvl = tonumber(f[first + 2]), tonumber(f[first + 3])
    local names = f[first + 4]
    if (boss ~= "0" and boss ~= "1") or (trash ~= "0" and trash ~= "1") or not quality or not ilvl or type(names) ~= "string" then
        return nil
    end
    if not isOne(LM.FILTER_QUALITIES, quality) or ilvl < 0 then
        return nil
    end
    local kinds = {}
    for _, k in ipairs(LM.FILTER_KINDS) do
        kinds[k] = false
    end
    for k in (names .. ","):gmatch("%s*(.-)%s*,") do
        if kinds[k] ~= nil then
            kinds[k] = true
        end
    end
    return { boss = boss == "1", trash = trash == "1", quality = quality, ilvl = ilvl, kinds = kinds }
end

-- Whether a raider may count an item as in its leader's filter: only when every fact was read and it passes.
-- Anything unread is a no, unlike LM:FilterLoot's "let it through", so a raider never passes an item its
-- leader's CRT might not roll on. Pure.
function LM.StrictlyPasses(facts, filter)
    if type(facts) ~= "table" or type(filter) ~= "table" or #(facts.unreadable or { true }) > 0 then
        return false
    end
    return LM.PassesFilter(facts, filter) == true
end

-- Your filter, cleaned (a missing one is the defaults).
function LM:Filter()
    return LM.CleanFilter(self:Settings().filter)
end

-- Saves a filter (cleaned) and tells the page.
function LM:SetFilter(t)
    self:Settings().filter = LM.CleanFilter(t, self:Filter())
    self:Fire("filter")
end

-- The one kind an item is, checked in this order: a toy; a mount or pet; a cosmetic; a tier token or a class
-- set's piece (isClassSet: a setID and a Classes line); then gear (a weapon or armor) by how it binds: on pickup, on equip, warbound until equipped.
-- Anything else (recipes, reagents, warbound or unbound gear) is "other". Pure.
function LM.ItemKind(f)
    if f.isToy then
        return "toy"
    end
    if f.isMount or f.isPet then
        return "mount"
    end
    if f.isCosmetic then
        return "cosmetic"
    end
    local gear = f.classID == ITEM_CLASS.WEAPON or f.classID == ITEM_CLASS.ARMOR
    if f.isToken or (gear and type(f.setID) == "number" and f.setID > 0 and f.isClassSet) then
        return "tier"
    end
    if gear then
        if f.bindType == BIND_PICKUP then
            return "bop"
        elseif f.bindType == BIND_EQUIP then
            return "boe"
        elseif f.bindType == BIND_WUE then
            return "wue"
        end
    end
    return "other"
end

-- Whether an item with these facts (LM.ItemFacts) opens a session under filter. Pure. A part whose fact is
-- missing (facts.source not "boss" or "trash", no quality, no item level, facts.kindUnknown) is skipped:
-- the item is let through on it. Returns true, or false and why ("source", "quality", "ilvl" or "kind"); a
-- pass with a part skipped gives "unreadable" as why. The item's kind third when it is known.
function LM.PassesFilter(facts, filter)
    if type(facts) ~= "table" then
        return true, "unreadable"
    end
    filter = LM.CleanFilter(filter)
    local skipped = false
    if facts.source == "boss" then
        if not filter.boss then
            return false, "source"
        end
    elseif facts.source == "trash" then
        if not filter.trash then
            return false, "source"
        end
    else
        skipped = true
    end
    if type(facts.quality) ~= "number" then
        skipped = true
    elseif facts.quality < filter.quality then
        return false, "quality"
    end
    if filter.ilvl > 0 then
        if type(facts.ilvl) ~= "number" then
            skipped = true
        elseif facts.ilvl < filter.ilvl then
            return false, "ilvl"
        end
    end
    if facts.kindUnknown then
        return true, "unreadable"
    end
    local kind = LM.ItemKind(facts)
    if not filter.kinds[kind] then
        return false, "kind", kind
    end
    return true, skipped and "unreadable" or nil, kind
end

-- Reading the facts --------------------------------------------------------------------------------------

-- What couldn't be read, as the chat line names it: "couldn't read [item] (<these, joined>)".
LM.FILTER_WHY = {
    source = "where it dropped",
    notLoaded = "its details, not loaded yet",
    ilvl = "its item level",
    toy = "whether it is a toy",
    mount = "whether it is a mount",
    pet = "whether it is a pet",
    cosmetic = "whether it is a cosmetic",
    token = "its tooltip, for a tier token",
    setPiece = "its tooltip, for a tier set piece",
}
local WHY = LM.FILTER_WHY

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- Calls fn(...) safely. Returns true and its first two values, or false when the call is missing, fails or
-- gives a secret value.
local function ask(fn, ...)
    if type(fn) ~= "function" then
        return false
    end
    local ok, v, w = pcall(fn, ...)
    if not ok or secret(v) or secret(w) then
        return false
    end
    return true, v, w
end

-- Whether the item's tooltip data has a "Classes: ..." line: true or false, or nil when it can't be read.
local function hasClassesLine(itemString)
    if not (C_TooltipInfo and ITEM_CLASSES_ALLOWED) then
        return nil
    end
    local ok, data = ask(C_TooltipInfo.GetHyperlink, itemString)
    if not ok or type(data) ~= "table" or type(data.lines) ~= "table" then
        return nil
    end
    for _, line in ipairs(data.lines) do
        local text = type(line) == "table" and line.leftText
        if type(text) == "string" and not secret(text) then
            local classes = LM.ParseClassesLine(text, ITEM_CLASSES_ALLOWED)
            if classes and #classes > 0 then
                return true
            end
        end
    end
    return false
end

-- An item's facts for LM.PassesFilter, from the game: source ("boss" or "trash", given by the caller),
-- quality, ilvl, classID, subClassID, bindType, setID, isToy, isMount, isPet, isCosmetic, isToken,
-- isClassSet. Always a
-- table: what can't be read is left nil with its reason in facts.unreadable (LM.FILTER_WHY), and
-- facts.kindUnknown is set when the item's kind can't be told.
function LM.ItemFacts(itemString, source)
    local f = { unreadable = {} }
    local function miss(why)
        f.unreadable[#f.unreadable + 1] = why
    end
    if source == "boss" or source == "trash" then
        f.source = source
    else
        miss(WHY.source)
    end
    local itemID = tonumber(tostring(itemString or ""):match("item:(%d+)"))
    local ok, quality, baseIlvl, classID, subClassID, bindType, setID, _
    if itemID and C_Item then
        ok, _, _, quality, baseIlvl, _, _, _, _, _, _, _, classID, subClassID, bindType, _, setID =
            pcall(C_Item.GetItemInfo, itemString)
    end
    if not ok or type(quality) ~= "number" or type(classID) ~= "number" or type(bindType) ~= "number"
        or secret(quality) or secret(classID) or secret(subClassID) or secret(bindType) or secret(setID) then
        miss(WHY.notLoaded)
        f.kindUnknown = true
        if itemID then
            local okL, ilvl = ask(C_Item and C_Item.GetDetailedItemLevelInfo, itemString)
            f.ilvl = (okL and type(ilvl) == "number") and ilvl or nil
        end
        return f
    end
    f.quality, f.classID, f.subClassID, f.bindType = quality, classID, subClassID, bindType
    f.setID = type(setID) == "number" and setID or nil
    local okL, ilvl = ask(C_Item.GetDetailedItemLevelInfo, itemString)
    f.ilvl = (okL and type(ilvl) == "number") and ilvl or (not secret(baseIlvl) and tonumber(baseIlvl)) or nil
    if not f.ilvl then
        miss(WHY.ilvl)
    end

    local okT, toyID, toyName = ask(C_ToyBox and C_ToyBox.GetToyInfo, itemID)
    if okT then
        f.isToy = toyID ~= nil and toyName ~= nil -- as Blizzard's toy box reads it
    else
        miss(WHY.toy)
    end
    local okM, mountID = ask(C_MountJournal and C_MountJournal.GetMountFromItem, itemID)
    if okM then
        f.isMount = mountID ~= nil or (classID == ITEM_CLASS.MISC and subClassID == MISC_MOUNT)
    else
        miss(WHY.mount)
    end
    local okP, petName = ask(C_PetJournal and C_PetJournal.GetPetInfoByItemID, itemID)
    if okP then
        f.isPet = petName ~= nil or classID == ITEM_CLASS.BATTLE_PET or (classID == ITEM_CLASS.MISC and subClassID == MISC_PET)
    else
        miss(WHY.pet)
    end
    local okC, cosmetic = ask(C_Item.IsCosmeticItem, itemString)
    if okC then
        f.isCosmetic = cosmetic == true or (classID == ITEM_CLASS.ARMOR and subClassID == ARMOR_COSMETIC)
    else
        miss(WHY.cosmetic)
    end
    -- warbound until equipped: bindType says it; this second word is only taken when it says yes
    if f.bindType ~= BIND_WUE and (classID == ITEM_CLASS.WEAPON or classID == ITEM_CLASS.ARMOR) then
        local okW, wue = ask(C_Item.IsItemBindToAccountUntilEquip, itemString)
        if okW and wue == true then
            f.bindType = BIND_WUE
        end
    end
    local tokenRead = true
    f.isToken = false
    if classID == ITEM_CLASS.MISC and not (f.isMount or f.isPet or f.isToy) then
        local classes = hasClassesLine(itemString)
        if classes == nil then
            tokenRead = false
            miss(WHY.token)
        else
            f.isToken = classes
        end
    end
    -- a set piece is tier only when it is a class set's: it has a Classes line too
    f.isClassSet = false
    if f.setID and f.setID > 0 and (classID == ITEM_CLASS.WEAPON or classID == ITEM_CLASS.ARMOR) then
        local classes = hasClassesLine(itemString)
        if classes == nil then
            tokenRead = false
            miss(WHY.setPiece)
        else
            f.isClassSet = classes
        end
    end
    if not (okT and okM and okP and okC and tokenRead) then
        f.kindUnknown = true
    end
    return f
end

-- Whether an item that dropped (source "boss" or "trash") opens a session under your filter. A part that
-- can't be read is skipped, so the item is let through on it; when it is let through with something
-- unread, the leader is told in chat what. Returns as LM.PassesFilter.
function LM:FilterLoot(itemString, source, link)
    local facts = LM.ItemFacts(itemString, source)
    local pass, why, kind = LM.PassesFilter(facts, self:Filter())
    if pass and #facts.unreadable > 0 then
        CRT:Print(string.format("Loot Master couldn't read %s (%s), so it's included.", link or itemString or "?",
            table.concat(facts.unreadable, "; ")))
    end
    return pass, why, kind
end
