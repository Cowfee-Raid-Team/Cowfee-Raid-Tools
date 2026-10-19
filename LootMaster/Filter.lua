local ADDON, CRT = ...

-- Loot Master's loot filter: which items open a loot session (the Loot filter tab, LootMaster/FilterTab.lua).
-- Loot Master only: Loot History keeps its own minimum quality. The setting is CRTDB.lootmaster.filter, with
-- its defaults in Core.lua:
--   boss, trash   where the item dropped: from a boss, or from any other enemy (trash)
--   quality       the lowest quality (Enum.ItemQuality: 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary)
--   ilvl          the lowest item level, 0 for any
--   kinds[key]    the kinds of items that pass (LM.FILTER_KINDS); every item is one kind (LM.ItemKind)
-- LM.ItemFacts reads an item's facts from the game, and LM.PassesFilter decides with no game calls. An item
-- whose facts can't be read fails closed: it is left out, and LM:FilterLoot says so in chat. /crt loot test
-- samples items that pass (LootMaster/Test.lua); the session start from real loot is to call LM:FilterLoot.
-- Sync Master Loot sends it as its F part (LootMaster/Sync.lua), cleaned on receipt by LM.CleanFilter.
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
--     a tier token (tokens have no item class of their own)

local LM = CRT.LootMaster

-- The kinds, in the tab's order. Labels are the tab's (FilterTab.lua).
LM.FILTER_KINDS = { "bop", "tier", "boe", "wue", "toy", "mount", "cosmetic", "other" }
LM.FILTER_QUALITIES = { 2, 3, 4, 5 } -- the quality dropdown's choices (Enum.ItemQuality)
LM.LIMITS.filterIlvl = { 0, 1000, 5 } -- the item level slider; 0 is any

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

-- Your filter, cleaned (a missing one is the defaults).
function LM:Filter()
    return LM.CleanFilter(self:Settings().filter)
end

-- Saves a filter (cleaned) and tells the page.
function LM:SetFilter(t)
    self:Settings().filter = LM.CleanFilter(t, self:Filter())
    self:Fire("filter")
end

-- The one kind an item is, checked in this order: a toy; a mount or pet; a cosmetic; a tier token or a set
-- piece; then gear (a weapon or armor) by how it binds: on pickup, on equip, warbound until equipped.
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
    if f.isToken or (gear and type(f.setID) == "number" and f.setID > 0) then
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

-- Whether an item with these facts (LM.ItemFacts) opens a session under filter. Pure. Returns true, or
-- false and why: "unreadable" (no facts, or one missing), "source", "quality", "ilvl" or "kind"; the item's
-- kind third when it is known.
function LM.PassesFilter(facts, filter)
    if type(facts) ~= "table" then
        return false, "unreadable"
    end
    filter = LM.CleanFilter(filter)
    if facts.source == "boss" then
        if not filter.boss then
            return false, "source"
        end
    elseif facts.source == "trash" then
        if not filter.trash then
            return false, "source"
        end
    else
        return false, "unreadable"
    end
    if type(facts.quality) ~= "number" then
        return false, "unreadable"
    end
    if facts.quality < filter.quality then
        return false, "quality"
    end
    if filter.ilvl > 0 then
        if type(facts.ilvl) ~= "number" then
            return false, "unreadable"
        end
        if facts.ilvl < filter.ilvl then
            return false, "ilvl"
        end
    end
    local kind = LM.ItemKind(facts)
    if not filter.kinds[kind] then
        return false, "kind", kind
    end
    return true, nil, kind
end

-- Reading the facts --------------------------------------------------------------------------------------

LM.FILTER_WHY = {
    source = "where it dropped is unknown",
    notLoaded = "the game hadn't loaded its details",
    toy = "the game didn't say if it is a toy",
    mount = "the game didn't say if it is a mount",
    pet = "the game didn't say if it is a pet",
    cosmetic = "the game didn't say if it is a cosmetic",
    token = "the game didn't give its tooltip, so CRT can't tell if it is a tier token",
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
-- quality, ilvl, classID, subClassID, bindType, setID, isToy, isMount, isPet, isCosmetic, isToken. Returns
-- nil and why (LM.FILTER_WHY) when any of them can't be read.
function LM.ItemFacts(itemString, source)
    if source ~= "boss" and source ~= "trash" then
        return nil, WHY.source
    end
    local itemID = tonumber(tostring(itemString or ""):match("item:(%d+)"))
    if not (itemID and C_Item) then
        return nil, WHY.notLoaded
    end
    local ok, _, _, quality, baseIlvl, _, _, _, _, _, _, _, classID, subClassID, bindType, _, setID =
        pcall(C_Item.GetItemInfo, itemString)
    if not ok or type(quality) ~= "number" or type(classID) ~= "number" or type(bindType) ~= "number"
        or secret(quality) or secret(classID) or secret(subClassID) or secret(bindType) or secret(setID) then
        return nil, WHY.notLoaded
    end
    local f = { source = source, quality = quality, classID = classID, subClassID = subClassID,
        bindType = bindType, setID = type(setID) == "number" and setID or nil }
    local okL, ilvl = ask(C_Item.GetDetailedItemLevelInfo, itemString)
    f.ilvl = (okL and type(ilvl) == "number") and ilvl or (not secret(baseIlvl) and tonumber(baseIlvl)) or nil

    local okT, toyID, toyName = ask(C_ToyBox and C_ToyBox.GetToyInfo, itemID)
    if not okT then
        return nil, WHY.toy
    end
    f.isToy = toyID ~= nil and toyName ~= nil -- as Blizzard's toy box reads it
    local okM, mountID = ask(C_MountJournal and C_MountJournal.GetMountFromItem, itemID)
    if not okM then
        return nil, WHY.mount
    end
    f.isMount = mountID ~= nil or (classID == ITEM_CLASS.MISC and subClassID == MISC_MOUNT)
    local okP, petName = ask(C_PetJournal and C_PetJournal.GetPetInfoByItemID, itemID)
    if not okP then
        return nil, WHY.pet
    end
    f.isPet = petName ~= nil or classID == ITEM_CLASS.BATTLE_PET or (classID == ITEM_CLASS.MISC and subClassID == MISC_PET)
    local okC, cosmetic = ask(C_Item.IsCosmeticItem, itemString)
    if not okC then
        return nil, WHY.cosmetic
    end
    f.isCosmetic = cosmetic == true or (classID == ITEM_CLASS.ARMOR and subClassID == ARMOR_COSMETIC)
    -- warbound until equipped: bindType says it; this second word is only taken when it says yes
    if f.bindType ~= BIND_WUE and (classID == ITEM_CLASS.WEAPON or classID == ITEM_CLASS.ARMOR) then
        local okW, wue = ask(C_Item.IsItemBindToAccountUntilEquip, itemString)
        if okW and wue == true then
            f.bindType = BIND_WUE
        end
    end
    f.isToken = false
    if classID == ITEM_CLASS.MISC and not (f.isMount or f.isPet or f.isToy) then
        local classes = hasClassesLine(itemString)
        if classes == nil then
            return nil, WHY.token
        end
        f.isToken = classes
    end
    return f
end

-- Whether an item that dropped (source "boss" or "trash") opens a session under your filter. One that
-- can't be read is left out, and the leader is told in chat which and why. Returns as LM.PassesFilter.
function LM:FilterLoot(itemString, source, link)
    local facts, why = LM.ItemFacts(itemString, source)
    if not facts then
        CRT:Print(string.format("Loot Master left out %s: %s.", link or itemString or "?", why))
        return false, "unreadable"
    end
    return LM.PassesFilter(facts, self:Filter())
end
