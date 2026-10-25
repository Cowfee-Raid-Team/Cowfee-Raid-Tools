local ADDON, CRT = ...

-- Trading an item to its winner: double-click a given-out item in the looter window. CRT opens a trade with
-- the winner (InitiateTrade, they must be in range), and when the trade window opens with that player it
-- puts the item from your bags into the first free trade slot (C_Container.PickupContainerItem and
-- ClickTradeButton). You press Trade: AcceptTrade needs your own click (#hwevent on the wiki). The steps
-- are the ones /crt dev loot probe trade tests; both are on the decision note's "proven in game" list.
-- A row is one copy, so from a stack (an item added from your bags) CRT puts one in:
-- C_Container.SplitContainerItem(bag, slot, 1) (https://warcraft.wiki.gg/wiki/API_C_Container.SplitContainerItem,
-- the call the game's own stack split makes) puts one on the cursor, then ClickTradeButton as above.
-- LM:TradeOne(name, itemString, link, opts) is the same one-copy trade for any page: Requests (Requests/Page.lua)
-- trades one to each player who needs one. opts.label starts its chat lines ("Loot Master" by default);
-- opts.done(name) is called once the trade with that player completes with the item still in it.
-- InitiateTrade(unit) has no restriction listed on https://warcraft.wiki.gg/wiki/API_InitiateTrade (only
-- AllowedWhenUntainted), and the game's own unit menu calls it from a click (UnitPopupTradeButtonMixin:OnClick,
-- Blizzard_UnitPopupShared/UnitPopupSharedButtonMixins.lua, Gethe/wow-ui-source live, 2026-10-22).
-- A completed trade: TRADE_CLOSED (no payload) fires for a completed trade and a cancelled one alike
-- (https://warcraft.wiki.gg/wiki/TRADE_CLOSED), so it can't tell them apart. The game's own "Trade complete."
-- line can: UI_INFO_MESSAGE (errorType, message) with message equal to the client's ERR_TRADE_COMPLETE
-- (https://warcraft.wiki.gg/wiki/UI_INFO_MESSAGE says to match on the string, as the index shifts between
-- patches; the string is in the client's GlobalStrings). Whether the item was still in the trade is read with
-- GetTradePlayerItemLink on every TRADE_PLAYER_ITEM_CHANGED and TRADE_ACCEPT_UPDATE (TradeInfoDocumentation)
-- while the trade is open. The line may come just before or just after TRADE_CLOSED, so a closed trade is
-- remembered for DONE_SECONDS.

local LM = CRT.LootMaster

local TRADE_SLOTS = 6 -- the trade window's slots for your items (the 7th never trades)
local PENDING_SECONDS = 20 -- how long CRT waits for the trade window to open
local DONE_SECONDS = 2 -- how long after TRADE_CLOSED the game's "Trade complete." line still counts

local TEXT = {
    notGiven = "give the item out first, then double-click it to trade.",
    notHere = "%s is not in your group.",
    opening = "opening a trade with %s for %s...",
    failed = "the trade could not be opened (%s).",
    notInBags = "%s is not in your bags, so it can't be put in the trade.",
    placed = "%s is in the trade window. Press Trade.",
    full = "the trade window is full.",
    other = "the trade is with %s, not %s; nothing was put in it.",
    noSplit = "CRT couldn't take one %s off its stack. Put one in the trade yourself.",
    noCount = "CRT couldn't read how many %s you have, so nothing was put in the trade. Put one in yourself.",
    noPickup = "CRT couldn't pick up %s. Put it in the trade yourself.",
    notPlaced = "%s couldn't be put in the trade, so it is back in your bags. Put it in yourself.",
}

local pending -- { name, itemString, link, at, label, done }
local active -- the trade CRT put an item in: { name, id, label, done, inTrade, closedAt }

-- A chat line, starting with the trade's label.
local function say(label, text, ...)
    CRT:Print((label or "Loot Master") .. ": " .. string.format(text, ...))
end

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

local function itemID(s)
    return tonumber(tostring(s or ""):match("item:(%d+)"))
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

-- Opens a trade with name (a full Name-Realm in your group) and puts one copy of the item in it when the
-- trade window opens. Returns true when the trade was asked for.
function LM:TradeOne(name, itemString, link, opts)
    opts = opts or {}
    local unit = self.UnitOf(name)
    if not unit then
        say(opts.label, TEXT.notHere, Ambiguate(name, "short"))
        return false
    end
    if not link then
        local _, l = C_Item.GetItemInfo(itemString or "")
        link = l or itemString
    end
    pending = { name = name, itemString = itemString, link = link, at = GetTime(), label = opts.label, done = opts.done }
    say(opts.label, TEXT.opening, Ambiguate(name, "short"), link)
    local ok, err = pcall(InitiateTrade, unit)
    if not ok then
        pending = nil
        say(opts.label, TEXT.failed, tostring(err))
        return false
    end
    return true
end

function LM:TradeItem(index)
    local s = self.current
    local it = s and s.items[index]
    if not (it and it.award) then
        say(nil, TEXT.notGiven)
        return
    end
    self:TradeOne(it.award.name, it.itemString, it.link)
end

local function place()
    local p = pending
    pending = nil
    if not p or GetTime() - p.at > PENDING_SECONDS then
        return
    end
    local with = LM.FullName(GetUnitName("NPC", true))
    if with ~= p.name then
        say(p.label, TEXT.other, tostring(with), Ambiguate(p.name, "short"))
        return
    end
    local bag, slot = findInBags(p.itemString)
    if not bag then
        say(p.label, TEXT.notInBags, p.link)
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
        say(p.label, TEXT.full)
        return
    end
    ClearCursor()
    -- each row is one copy: from a stack, one is split off (the game's own stack split call), never the
    -- stack. A stack size that can't be read puts nothing in, so a whole stack is never traded by mistake.
    local info = C_Container.GetContainerItemInfo(bag, slot)
    local count = type(info) == "table" and info.stackCount or nil
    if type(count) ~= "number" or secret(count) then
        say(p.label, TEXT.noCount, p.link)
        return
    end
    -- the item must be on the cursor before the trade slot is clicked; ClearCursor puts it back in its slot
    if count > 1 then
        local ok = type(C_Container.SplitContainerItem) == "function" and pcall(C_Container.SplitContainerItem, bag, slot, 1)
        if not ok or not cursorItem() then
            ClearCursor()
            say(p.label, TEXT.noSplit, p.link)
            return
        end
    else
        local ok = pcall(C_Container.PickupContainerItem, bag, slot)
        if not ok or not cursorItem() then
            ClearCursor()
            say(p.label, TEXT.noPickup, p.link)
            return
        end
    end
    ClickTradeButton(free)
    if cursorBusy() then
        ClearCursor() -- still on the cursor: the trade didn't take it, so it goes back to your bags
        say(p.label, TEXT.notPlaced, p.link)
        return
    end
    say(p.label, TEXT.placed, p.link)
    active = { name = p.name, id = itemID(p.itemString), label = p.label, done = p.done, inTrade = true }
end

-- Whether the item is in one of your trade slots now.
local function stillInTrade(id)
    for i = 1, TRADE_SLOTS do
        local ok, l = pcall(GetTradePlayerItemLink, i)
        if ok and type(l) == "string" and not secret(l) and itemID(l) == id then
            return true
        end
    end
    return false
end

-- The game's "Trade complete." line: the trade CRT put the item in gave it, if the item was still there.
local function completed(message)
    local a = active
    if not a or secret(message) or type(ERR_TRADE_COMPLETE) ~= "string" or message ~= ERR_TRADE_COMPLETE then
        return
    end
    active = nil
    if a.closedAt and GetTime() - a.closedAt > DONE_SECONDS then
        return
    end
    if a.inTrade and a.done then
        a.done(a.name)
    end
end

local events = CRT.Modules and CRT.Modules:Frame("loot") or CreateFrame("Frame") -- quiet while the module is off (CRT_Core/Modules.lua)
for _, e in ipairs({ "TRADE_SHOW", "TRADE_CLOSED", "TRADE_PLAYER_ITEM_CHANGED", "TRADE_ACCEPT_UPDATE", "UI_INFO_MESSAGE" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event, _, message)
    if event == "TRADE_SHOW" then
        active = nil -- a new trade: CRT's item is in it only if place() puts it there
        local label = pending and pending.label
        local ok, err = pcall(place)
        if not ok then
            pcall(ClearCursor) -- nothing is left on the cursor when it failed halfway
            say(label, TEXT.failed, tostring(err))
        end
    elseif event == "TRADE_CLOSED" then
        if active and not active.closedAt then
            active.closedAt = GetTime()
        end
    elseif event == "UI_INFO_MESSAGE" then
        local ok, err = pcall(completed, message)
        if not ok and geterrorhandler then
            pcall(geterrorhandler(), err)
        end
    elseif active and not active.closedAt then
        active.inTrade = stillInTrade(active.id)
    end
end)
