local ADDON, CRT = ...

-- Trading an item to its winner: double-click a given-out item in the looter window. CRT opens a trade with
-- the winner (InitiateTrade, they must be in range), and when the trade window opens with that player it
-- puts the item from your bags into the first free trade slot (C_Container.PickupContainerItem and
-- ClickTradeButton). You press Trade: AcceptTrade needs your own click (#hwevent on the wiki). The steps
-- are the ones /crt dev loot probe trade tests; both are on the decision note's "proven in game" list.
-- A row is one copy, so from a stack (an item added from your bags) CRT puts one in:
-- C_Container.SplitContainerItem(bag, slot, 1) (https://warcraft.wiki.gg/wiki/API_C_Container.SplitContainerItem,
-- the call the game's own stack split makes) puts one on the cursor, then ClickTradeButton as above.

local LM = CRT.LootMaster

local TRADE_SLOTS = 6 -- the trade window's slots for your items (the 7th never trades)
local PENDING_SECONDS = 20 -- how long CRT waits for the trade window to open

local TEXT = {
    notGiven = "Loot Master: give the item out first, then double-click it to trade.",
    notHere = "Loot Master: %s is not in your group.",
    opening = "Loot Master: opening a trade with %s for %s...",
    failed = "Loot Master: the trade could not be opened (%s).",
    notInBags = "Loot Master: %s is not in your bags, so it can't be put in the trade.",
    placed = "Loot Master: %s is in the trade window. Press Trade.",
    full = "Loot Master: the trade window is full.",
    other = "Loot Master: the trade is with %s, not %s; nothing was put in it.",
    noSplit = "Loot Master: CRT couldn't take one %s off its stack. Put one in the trade yourself.",
    noCount = "Loot Master: CRT couldn't read how many %s you have, so nothing was put in the trade. Put one in yourself.",
    noPickup = "Loot Master: CRT couldn't pick up %s. Put it in the trade yourself.",
    notPlaced = "Loot Master: %s couldn't be put in the trade, so it is back in your bags. Put it in yourself.",
}

local pending -- { name, itemString, link, at }

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- Whether the cursor holds an item (GetCursorInfo's first return, https://warcraft.wiki.gg/wiki/API_GetCursorInfo).
local function cursorItem()
    local ok, kind = pcall(GetCursorInfo)
    return ok and not secret(kind) and kind == "item"
end

-- Whether the cursor holds anything at all.
local function cursorBusy()
    local ok, kind = pcall(GetCursorInfo)
    return not ok or kind ~= nil
end

-- The bag and slot of the item: the same item string first, else the same item ID.
local function findInBags(itemString)
    local id = tonumber((itemString or ""):match("item:(%d+)"))
    local byId
    for bag = 0, (NUM_BAG_SLOTS or 4) + 1 do
        for slot = 1, (C_Container.GetContainerNumSlots(bag) or 0) do
            local info = C_Container.GetContainerItemInfo(bag, slot)
            if info and info.itemID == id then
                local s = info.hyperlink and info.hyperlink:match("item:[%-%d:]+")
                if s and itemString and (s == itemString or s:find(itemString, 1, true) == 1) then
                    return bag, slot, info.hyperlink
                end
                byId = byId or { bag, slot, info.hyperlink }
            end
        end
    end
    if byId then
        return byId[1], byId[2], byId[3]
    end
    return nil
end

function LM:TradeItem(index)
    local s = self.current
    local it = s and s.items[index]
    if not (it and it.award) then
        CRT:Print(TEXT.notGiven)
        return
    end
    local name = it.award.name
    local unit = self.UnitOf(name)
    if not unit then
        CRT:Print(string.format(TEXT.notHere, Ambiguate(name, "short")))
        return
    end
    local _, link = C_Item.GetItemInfo(it.itemString or "")
    pending = { name = name, itemString = it.itemString, link = it.link or link or it.itemString, at = GetTime() }
    CRT:Print(string.format(TEXT.opening, Ambiguate(name, "short"), pending.link))
    local ok, err = pcall(InitiateTrade, unit)
    if not ok then
        pending = nil
        CRT:Print(string.format(TEXT.failed, tostring(err)))
    end
end

local function place()
    local p = pending
    pending = nil
    if not p or GetTime() - p.at > PENDING_SECONDS then
        return
    end
    local with = LM.FullName(GetUnitName("NPC", true))
    if with ~= p.name then
        CRT:Print(string.format(TEXT.other, tostring(with), Ambiguate(p.name, "short")))
        return
    end
    local bag, slot = findInBags(p.itemString)
    if not bag then
        CRT:Print(string.format(TEXT.notInBags, p.link))
        return
    end
    local free
    for i = 1, TRADE_SLOTS do
        if not GetTradePlayerItemLink(i) then
            free = i
            break
        end
    end
    if not free then
        CRT:Print(TEXT.full)
        return
    end
    ClearCursor()
    -- each row is one copy: from a stack, one is split off (the game's own stack split call), never the
    -- stack. A stack size that can't be read puts nothing in, so a whole stack is never traded by mistake.
    local info = C_Container.GetContainerItemInfo(bag, slot)
    local count = type(info) == "table" and info.stackCount or nil
    if type(count) ~= "number" or secret(count) then
        CRT:Print(string.format(TEXT.noCount, p.link))
        return
    end
    -- the item must be on the cursor before the trade slot is clicked; ClearCursor puts it back in its slot
    if count > 1 then
        local ok = type(C_Container.SplitContainerItem) == "function" and pcall(C_Container.SplitContainerItem, bag, slot, 1)
        if not ok or not cursorItem() then
            ClearCursor()
            CRT:Print(string.format(TEXT.noSplit, p.link))
            return
        end
    else
        local ok = pcall(C_Container.PickupContainerItem, bag, slot)
        if not ok or not cursorItem() then
            ClearCursor()
            CRT:Print(string.format(TEXT.noPickup, p.link))
            return
        end
    end
    ClickTradeButton(free)
    if cursorBusy() then
        ClearCursor() -- still on the cursor: the trade didn't take it, so it goes back to your bags
        CRT:Print(string.format(TEXT.notPlaced, p.link))
        return
    end
    CRT:Print(string.format(TEXT.placed, p.link))
end

local events = CreateFrame("Frame")
events:RegisterEvent("TRADE_SHOW")
events:SetScript("OnEvent", function()
    local ok, err = pcall(place)
    if not ok then
        pcall(ClearCursor) -- nothing is left on the cursor when it failed halfway
        CRT:Print(string.format(TEXT.failed, tostring(err)))
    end
end)
