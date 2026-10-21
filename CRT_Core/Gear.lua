local ADDON, CRT = ...

-- The gear engine: one source of truth for equipped gear. Your own gear is read from the game and kept in
-- a cache; other players' gear is what a feature hands in after they sent it. No feature reads equipped
-- items on its own: it asks here. Nothing here knows any feature.
--
-- A piece is { slot, id, itemString, link, ilvl }: slot an inventory slot id (Gear.SLOTS), itemString the
-- link's "item:..." part with its empty tail dropped (bonus IDs, gems and enchant kept), link only on your
-- own pieces, ilvl the item level with upgrades (C_Item.GetDetailedItemLevelInfo).
--
--   Gear:Mine(slot)               your piece in a slot, or nil when it is empty
--   Gear:MineAll()                your pieces, in Gear.SLOTS order (empty slots left out)
--   Gear:ForItem(itemString)      your pieces in the slots that item goes in (read live), lowest item level first
--   Gear:OnChange(fn)             fn(slot) when your piece in a slot changes
--   Gear:Remember(player, pieces, source, replace), Gear:Of(player, slot), Gear:OfAll(player), Gear:When(player)
--                                 other players' pieces, by full Name-Realm, as a feature received them
--                                 (replace: the pieces are the whole set, so slots left out are empty)
--   Gear:ReadUnit(unit)           the pieces another unit wears, read now (an inspected player)
--   Gear.Encode(piece), Gear.Decode(text)    "<slot>~<itemString>~<ilvl>", for any message
--   Gear.PackMany(pieces, budget) encoded pieces in chunks that each fit a byte budget
--   Gear.Parts(itemString)        the enchant, gem and bonus IDs written in an item string
--   Gear.Sockets(itemString)      how many sockets the item has
--   Gear.IsWeapon(equipLoc), Gear.AverageLevel(pieces)   a weapon's equip location; the equipped item level
--   Gear.ShowTooltip(owner, piece, anchor)   the exact item when its item string is known, else by ID
--   Gear.QualityColor(quality)    the game's r, g, b for an item quality (Enum.ItemQuality), or nil
--
-- Game calls (warcraft.wiki.gg, read 2026-10-20): GetInventoryItemLink(unit, slot) -> link or nil;
-- GetInventoryItemID(unit, slot) -> id or nil; C_Item.GetDetailedItemLevelInfo(link) -> actual item level
-- (may return nothing); C_Item.RequestLoadItemDataByID(id) fires ITEM_DATA_LOAD_RESULT (itemID, success);
-- PLAYER_EQUIPMENT_CHANGED (equipmentSlot, hasCurrent); PLAYER_ENTERING_WORLD; GameTooltip:SetHyperlink
-- takes a full link or only its "item:..." part; GameTooltip:SetItemByID(itemID). C_Item.GetItemNumSockets
-- (itemInfo) -> socketCount (ItemDocumentation.lua, live), which Blizzard's own inspect frame calls on an
-- inspected player's link (PaperDollItemSocketDisplayMixin:SetItem, PaperDollFrame.lua). Each is called in pcall.

local Gear = { others = {}, listeners = {} }
CRT.Gear = Gear

-- The inventory slots worn gear goes in (the wiki's InventorySlotId; the shirt and tabard are left out).
-- name is the game's own slot name (the GlobalStrings HEADSLOT, ...), English when it has none.
Gear.SLOTS = {
    { id = 1, key = "HEADSLOT", name = "Head" },
    { id = 2, key = "NECKSLOT", name = "Neck" },
    { id = 3, key = "SHOULDERSLOT", name = "Shoulder" },
    { id = 5, key = "CHESTSLOT", name = "Chest" },
    { id = 6, key = "WAISTSLOT", name = "Waist" },
    { id = 7, key = "LEGSSLOT", name = "Legs" },
    { id = 8, key = "FEETSLOT", name = "Feet" },
    { id = 9, key = "WRISTSLOT", name = "Wrist" },
    { id = 10, key = "HANDSSLOT", name = "Hands" },
    { id = 11, key = "FINGER0SLOT", name = "Finger" },
    { id = 12, key = "FINGER1SLOT", name = "Finger" },
    { id = 13, key = "TRINKET0SLOT", name = "Trinket" },
    { id = 14, key = "TRINKET1SLOT", name = "Trinket" },
    { id = 15, key = "BACKSLOT", name = "Back" },
    { id = 16, key = "MAINHANDSLOT", name = "Main Hand" },
    { id = 17, key = "SECONDARYHANDSLOT", name = "Off Hand" },
}
local SLOT = {} -- by id
for _, s in ipairs(Gear.SLOTS) do
    local own = _G[s.key]
    if type(own) == "string" and own ~= "" then
        s.name = own
    end
    SLOT[s.id] = s
end

-- Where each kind of gear is worn (C_Item.GetItemInfoInstant's equip location). Rings, trinkets and
-- one-handers go in either of two slots.
Gear.EQUIP_LOCS = {
    INVTYPE_HEAD = { 1 }, INVTYPE_NECK = { 2 }, INVTYPE_SHOULDER = { 3 }, INVTYPE_CHEST = { 5 },
    INVTYPE_ROBE = { 5 }, INVTYPE_WAIST = { 6 }, INVTYPE_LEGS = { 7 }, INVTYPE_FEET = { 8 },
    INVTYPE_WRIST = { 9 }, INVTYPE_HAND = { 10 }, INVTYPE_FINGER = { 11, 12 }, INVTYPE_TRINKET = { 13, 14 },
    INVTYPE_CLOAK = { 15 }, INVTYPE_WEAPON = { 16, 17 }, INVTYPE_2HWEAPON = { 16 },
    INVTYPE_WEAPONMAINHAND = { 16 }, INVTYPE_WEAPONOFFHAND = { 17 }, INVTYPE_HOLDABLE = { 17 },
    INVTYPE_SHIELD = { 17 }, INVTYPE_RANGED = { 16 }, INVTYPE_RANGEDRIGHT = { 16 },
}

-- The slots an equip location goes in (a new list each call); none for anything else.
function Gear.SLOTS_FOR(equipLoc)
    local out = {}
    for i, id in ipairs(type(equipLoc) == "string" and Gear.EQUIP_LOCS[equipLoc] or {}) do
        out[i] = id
    end
    return out
end

-- A slot's row of Gear.SLOTS, or nil.
function Gear.Slot(id)
    return SLOT[id]
end

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- The wire format -----------------------------------------------------------------------------------------

Gear.ITEM_STRING_MAX = 230 -- bytes; a longer item string is refused, so one piece always fits a message

-- An item string: "item:" and its numbers, colons and a crafter's GUID (letters, digits, hyphens).
local function cleanItemString(s)
    if type(s) ~= "string" or #s > Gear.ITEM_STRING_MAX or not s:match("^item:%d+[%w:%-]*$") then
        return nil
    end
    local id = tonumber(s:match("^item:(%d+)"))
    return (id and id > 0) and s or nil
end

-- The "item:..." part of a link (or of an item string), with its empty tail dropped; nil for anything
-- else, or a secret.
function Gear.ItemString(link)
    if secret(link) or type(link) ~= "string" then
        return nil
    end
    local s = link:match("item:[%w:%-]+")
    return s and cleanItemString((s:gsub(":+$", ""))) or nil
end

local function wholeNumber(v)
    if secret(v) or type(v) ~= "number" or v ~= v or v < 0 or v == math.huge then
        return nil
    end
    return math.floor(v + 0.5)
end

-- A slot id of Gear.SLOTS (a whole number), or nil.
local function slotOf(v)
    if secret(v) or type(v) ~= "number" or v ~= math.floor(v) then
        return nil
    end
    return SLOT[v] and v or nil
end

-- "<slot>~<itemString>~<ilvl>" for a piece (its itemString, or its link's), ilvl empty when unknown.
-- nil when the slot or item can't be read, or any of it is secret.
function Gear.Encode(piece)
    if type(piece) ~= "table" or secret(piece) then
        return nil
    end
    local slot = slotOf(piece.slot)
    if not slot then
        return nil
    end
    local s = Gear.ItemString(piece.itemString) or Gear.ItemString(piece.link)
    if not s then
        return nil
    end
    if piece.ilvl ~= nil and secret(piece.ilvl) then
        return nil
    end
    local ilvl = wholeNumber(piece.ilvl)
    return slot .. "~" .. s .. "~" .. (ilvl or "")
end

-- The piece in an encoded text: { slot, id, itemString, ilvl }, or nil for anything malformed.
function Gear.Decode(text)
    if secret(text) or type(text) ~= "string" or #text > 255 then
        return nil
    end
    local slot, s, ilvl = text:match("^(%d+)~(item:[%w:%-]+)~(%d*)$")
    slot, s = tonumber(slot), cleanItemString(s)
    if not (slot and SLOT[slot] and s) then
        return nil
    end
    return { slot = slot, id = tonumber(s:match("^item:(%d+)")), itemString = s, ilvl = tonumber(ilvl) }
end

-- The pieces encoded and split into chunks: each chunk a list of encoded texts whose length, joined with
-- a one-byte separator, is at most budget bytes. The second list is the pieces left out (unreadable, or
-- too long for a chunk on their own).
function Gear.PackMany(pieces, budget)
    budget = tonumber(budget) or 255
    local chunks, left = {}, {}
    local cur, size
    for _, p in ipairs(type(pieces) == "table" and pieces or {}) do
        local text = Gear.Encode(p)
        if not text or #text > budget then
            left[#left + 1] = p
        elseif cur and size + 1 + #text <= budget then
            cur[#cur + 1] = text
            size = size + 1 + #text
        else
            cur, size = { text }, #text
            chunks[#chunks + 1] = cur
        end
    end
    return chunks, left
end

-- What an item string holds ---------------------------------------------------------------------------------

-- An item string's fields, from the ItemLink page (warcraft.wiki.gg, read 2026-10-21): item:itemID:enchantID:
-- gemID1:gemID2:gemID3:gemID4:suffixID:uniqueID:linkLevel:specializationID:modifiersMask:itemContext:
-- numBonusIDs[:bonusID1:...]:numModifiers[:type:value...]:... An empty field (or a 0) is nothing set.
-- Gear.Parts(itemString or link): { id, enchant (nil when none), gems = { [1..4] = gem item ID or nil },
-- gemCount, bonusIds = { in order }, bonus = { [bonusID] = true } }, or nil for anything that isn't an item.
Gear.MAX_BONUS_IDS = 32 -- a count past this is junk; real items carry well under it

function Gear.Parts(link)
    local s = Gear.ItemString(link)
    if not s then
        return nil
    end
    local f = {}
    for field in (s .. ":"):gmatch("([^:]*):") do
        f[#f + 1] = field
    end
    local function num(i)
        local n = tonumber(f[i] or "")
        return (n and n > 0) and n or nil
    end
    local out = { id = num(2), enchant = num(3), gems = {}, gemCount = 0, bonusIds = {}, bonus = {} }
    for g = 1, 4 do
        out.gems[g] = num(3 + g)
        if out.gems[g] then
            out.gemCount = out.gemCount + 1
        end
    end
    -- f[1] is "item", so itemContext is f[13] and numBonusIDs f[14]
    for i = 1, math.min(num(14) or 0, Gear.MAX_BONUS_IDS) do
        local id = num(14 + i)
        if id then
            out.bonusIds[#out.bonusIds + 1] = id
            out.bonus[id] = true
        end
    end
    return out
end

-- How many sockets an item has (C_Item.GetItemNumSockets on its item string, so sockets added by bonus IDs
-- should count), or nil when the game can't say.
function Gear.Sockets(link)
    local s = Gear.ItemString(link)
    if not (s and C_Item and C_Item.GetItemNumSockets) then
        return nil
    end
    local ok, n = pcall(C_Item.GetItemNumSockets, s)
    if not ok then
        return nil
    end
    return wholeNumber(n)
end

-- The equip locations of weapons (the game's INVTYPE names); a shield or an off-hand item is not one.
Gear.WEAPON_LOCS = {
    INVTYPE_WEAPON = true, INVTYPE_2HWEAPON = true, INVTYPE_WEAPONMAINHAND = true, INVTYPE_WEAPONOFFHAND = true,
    INVTYPE_RANGED = true, INVTYPE_RANGEDRIGHT = true,
}
-- The ones that take both hands, so an empty off hand counts as the same item
Gear.TWO_HAND_LOCS = { INVTYPE_2HWEAPON = true, INVTYPE_RANGED = true, INVTYPE_RANGEDRIGHT = true }

function Gear.IsWeapon(equipLoc)
    return type(equipLoc) == "string" and Gear.WEAPON_LOCS[equipLoc] == true
end

-- A piece's equip location (C_Item.GetItemInfoInstant, which needs no loaded item), or nil.
function Gear.EquipLoc(piece)
    local key = type(piece) == "table" and (Gear.ItemString(piece.itemString) or Gear.ItemString(piece.link) or wholeNumber(piece.id))
    if not key or not (C_Item and C_Item.GetItemInfoInstant) then
        return nil
    end
    local ok, _, _, _, loc = pcall(C_Item.GetItemInfoInstant, key)
    if not ok or secret(loc) or type(loc) ~= "string" then
        return nil
    end
    return loc
end

-- The equipped item level of a set of pieces, as the character sheet counts it: every worn slot's item
-- level over the 16 slots, an empty one counting 0 and a two-hander with the off hand empty counting twice.
-- nil when no piece has an item level.
function Gear.AverageLevel(pieces)
    local sum, any, offHand, twoHand = 0, false, false, nil
    for _, p in ipairs(type(pieces) == "table" and pieces or {}) do
        local ilvl = type(p) == "table" and wholeNumber(p.ilvl)
        if ilvl then
            sum, any = sum + ilvl, true
            if p.slot == 16 and Gear.TWO_HAND_LOCS[Gear.EquipLoc(p) or ""] then
                twoHand = ilvl
            end
        end
        if type(p) == "table" and p.slot == 17 then
            offHand = true
        end
    end
    if not any then
        return nil
    end
    if twoHand and not offHand then
        sum = sum + twoHand
    end
    return sum / #Gear.SLOTS
end

-- Your gear ------------------------------------------------------------------------------------------------

local mine, ready = {}, false -- by slot id; ready once every slot has been read
local waiting = {} -- item IDs asked of the game for their item level

local function copy(p)
    if not p then
        return nil
    end
    return { slot = p.slot, id = p.id, itemString = p.itemString, link = p.link, ilvl = p.ilvl }
end

-- One slot of a unit (yours unless unit is given): the piece, or nil and whether the slot holds an item the
-- game has no link for yet (an inspected player's item not loaded).
local function read(slot, unit)
    unit = unit or "player"
    local okL, link = pcall(GetInventoryItemLink, unit, slot)
    local okI, id = pcall(GetInventoryItemID, unit, slot)
    if not okI or secret(id) or type(id) ~= "number" then
        id = nil
    end
    if not okL or secret(link) or type(link) ~= "string" then
        return nil, id ~= nil
    end
    id = id or tonumber(link:match("item:(%d+)"))
    local okV, ilvl = pcall(C_Item.GetDetailedItemLevelInfo, link)
    if not okV or secret(ilvl) or type(ilvl) ~= "number" then
        ilvl = nil
        if id and C_Item.RequestLoadItemDataByID then
            if unit == "player" then
                waiting[id] = true -- read again on ITEM_DATA_LOAD_RESULT
            end
            pcall(C_Item.RequestLoadItemDataByID, id)
        end
    end
    return { slot = slot, id = id, itemString = Gear.ItemString(link), link = link, ilvl = ilvl }
end

local function fire(slot)
    for _, fn in ipairs(Gear.listeners) do
        local ok, err = pcall(fn, slot)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

-- Reads one slot again, or every slot; fires OnChange for each slot whose piece changed. Returns whether
-- anything changed.
function Gear:Refresh(slot)
    local changed = {}
    for _, s in ipairs(Gear.SLOTS) do
        if not slot or s.id == slot then
            local old, new = mine[s.id], read(s.id)
            if (old and old.link) ~= (new and new.link) or (old and old.ilvl) ~= (new and new.ilvl) then
                changed[#changed + 1] = s.id
            end
            mine[s.id] = new
        end
    end
    if not slot then
        ready = true
    end
    for _, id in ipairs(changed) do
        fire(id)
    end
    return #changed > 0
end

function Gear:Mine(slot)
    if not ready then
        self:Refresh()
    end
    return copy(mine[slot])
end

function Gear:MineAll()
    local out = {}
    for _, s in ipairs(Gear.SLOTS) do
        local p = self:Mine(s.id)
        if p then
            out[#out + 1] = p
        end
    end
    return out
end

function Gear:ForItem(itemString)
    local ok, _, _, _, equipLoc = pcall(C_Item.GetItemInfoInstant, itemString or "")
    local out = {}
    if not ok or secret(equipLoc) then
        return out
    end
    -- Read live: a slot empty at login, or changed with no PLAYER_EQUIPMENT_CHANGED (an upgrade, a gem),
    -- would otherwise answer from a stale cache.
    for _, slot in ipairs(Gear.SLOTS_FOR(equipLoc)) do
        self:Refresh(slot)
        out[#out + 1] = self:Mine(slot)
    end
    table.sort(out, function(a, b)
        return (a.ilvl or 0) < (b.ilvl or 0)
    end)
    return out
end

function Gear:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

-- The game's events (also called by the tests).
function Gear:OnEvent(event, a1)
    if event == "PLAYER_EQUIPMENT_CHANGED" then
        local slot = not secret(a1) and type(a1) == "number" and SLOT[a1] and a1 or nil
        if ready and slot then
            self:Refresh(slot)
        else
            self:Refresh()
        end
    elseif event == "PLAYER_ENTERING_WORLD" then
        self:Refresh()
    elseif event == "ITEM_DATA_LOAD_RESULT" then
        if secret(a1) or not waiting[a1] then
            return -- another addon's request, or one already answered
        end
        waiting[a1] = nil
        for _, s in ipairs(Gear.SLOTS) do
            if mine[s.id] and mine[s.id].id == a1 then
                self:Refresh(s.id)
            end
        end
    end
end

if CreateFrame then
    local events = CreateFrame("Frame")
    events:RegisterEvent("PLAYER_ENTERING_WORLD")
    events:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
    events:RegisterEvent("ITEM_DATA_LOAD_RESULT")
    events:SetScript("OnEvent", function(_, event, a1)
        Gear:OnEvent(event, a1)
    end)
end

-- Other players' gear ----------------------------------------------------------------------------------------

-- Kept in memory only, by full Name-Realm: { slots = { [slot] = piece }, at = time(), source }. A later
-- save in CRTDB would plug in here (a table under CRTDB with its default in CRT_Core/Core.lua), loaded
-- into Gear.others at login; it isn't built yet.
-- With replace, pieces is the player's whole equipped set (an inspect, or a full set sent by their CRT), so
-- a slot it leaves out is empty now; without it, only the slots given change.
function Gear:Remember(player, pieces, source, replace)
    if secret(player) or type(player) ~= "string" or player == "" or type(pieces) ~= "table" then
        return false
    end
    local rec = (not replace and self.others[player]) or { slots = {} }
    local n = 0
    for _, p in ipairs(pieces) do
        local slot = type(p) == "table" and slotOf(p.slot)
        local id = type(p) == "table" and wholeNumber(p.id)
        if slot and id and id > 0 then
            rec.slots[slot] = { slot = slot, id = id, itemString = cleanItemString(p.itemString), ilvl = wholeNumber(p.ilvl) }
            n = n + 1
        end
    end
    if n == 0 then
        return false
    end
    rec.at, rec.source = time(), source
    self.others[player] = rec
    return true
end

-- A player's piece in a slot, as last remembered, or nil.
function Gear:Of(player, slot)
    local rec = self.others[player]
    return rec and copy(rec.slots[slot]) or nil
end

-- Every piece remembered for a player, copies in Gear.SLOTS order (an empty list when none).
function Gear:OfAll(player)
    local rec, out = self.others[player], {}
    if rec then
        for _, s in ipairs(Gear.SLOTS) do
            if rec.slots[s.id] then
                out[#out + 1] = copy(rec.slots[s.id])
            end
        end
    end
    return out
end

-- The pieces another unit wears, read from the game now (for a player being inspected, once the game
-- has their items: INSPECT_READY), in Gear.SLOTS order, and how many slots hold an item the game has no
-- link or no item level for yet (worth reading again shortly). Kept nowhere: hand them to Remember. Your
-- own unit reads your cache instead.
function Gear:ReadUnit(unit)
    local out, missing = {}, 0
    if secret(unit) or type(unit) ~= "string" or unit == "" then
        return out, 0
    end
    if unit == "player" then
        return self:MineAll(), 0
    end
    for _, s in ipairs(Gear.SLOTS) do
        local p, waitingFor = read(s.id, unit)
        if p then
            out[#out + 1] = p
            if p.ilvl == nil then
                missing = missing + 1
            end
        elseif waitingFor then
            missing = missing + 1
        end
    end
    return out, missing
end

-- When a player's gear was last remembered (time()) and from where; nil when never.
function Gear:When(player)
    local rec = self.others[player]
    if not rec then
        return nil
    end
    return rec.at, rec.source
end

-- Display ------------------------------------------------------------------------------------------------------

Gear.TEXT = { equippedAt = "Equipped at item level %d" }

-- The game tooltip for a piece, owned by owner (anchor: SetOwner's anchor, ANCHOR_RIGHT when nil). The
-- exact item (upgrades, gems, enchant) when its item string or link is known, else the item by its ID; then
-- the "Equipped at item level N" line. Returns true when the exact item was shown; false and no tooltip
-- for a piece with neither.
function Gear.ShowTooltip(owner, piece, anchor)
    if type(piece) ~= "table" or not GameTooltip then
        return false
    end
    local s = Gear.ItemString(piece.itemString) or Gear.ItemString(piece.link)
    local id = wholeNumber(piece.id)
    if not s and not id then
        return false
    end
    GameTooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT")
    local exact = s and pcall(GameTooltip.SetHyperlink, GameTooltip, s) or false
    if not exact and id then
        pcall(GameTooltip.SetItemByID, GameTooltip, id)
    end
    local ilvl = wholeNumber(piece.ilvl)
    if ilvl and ilvl > 0 then
        GameTooltip:AddLine(string.format(Gear.TEXT.equippedAt, ilvl), 0.85, 0.85, 0.85)
    end
    GameTooltip:Show()
    return exact
end

-- The game's colour for an item quality (Enum.ItemQuality): ColorManager.GetColorDataForItemQuality(quality)
-- (12.0, in pcall), else the older ITEM_QUALITY_COLORS table. Returns r, g, b, or nil for a quality the game
-- has no colour for, or a secret one (never looked up).
function Gear.QualityColor(quality)
    if type(quality) ~= "number" or (issecretvalue and issecretvalue(quality)) then
        return nil
    end
    local get = ColorManager and ColorManager.GetColorDataForItemQuality
    local c
    if get then
        local ok, data = pcall(get, quality)
        c = ok and data or nil
    end
    c = c or (ITEM_QUALITY_COLORS and ITEM_QUALITY_COLORS[quality])
    if type(c) == "table" and c.r then
        return c.r, c.g, c.b
    end
    return nil
end
