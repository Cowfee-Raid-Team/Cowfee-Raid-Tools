local ADDON, CRT = ...

-- Trading an item to its winner: double-click a given-out item in the looter window. CRT opens a trade with
-- the winner (InitiateTrade, they must be in range), and when the trade window opens with that player it
-- puts the item from your bags into the first free trade slot (C_Container.PickupContainerItem and
-- ClickTradeButton). You press Trade: AcceptTrade needs your own click (#hwevent on the wiki). The steps
-- are the ones /crt dev loot probe trade tests; both are on the decision note's "proven in game" list.

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
}

local pending -- { name, itemString, link, at }

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
    C_Container.PickupContainerItem(bag, slot)
    ClickTradeButton(free)
    CRT:Print(string.format(TEXT.placed, p.link))
end

local events = CreateFrame("Frame")
events:RegisterEvent("TRADE_SHOW")
events:SetScript("OnEvent", function()
    local ok, err = pcall(place)
    if not ok then
        CRT:Print(string.format(TEXT.failed, tostring(err)))
    end
end)
