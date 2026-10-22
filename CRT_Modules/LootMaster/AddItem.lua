local ADDON, CRT = ...

-- Add item: items from your bags onto the Boss loot list (Alex, 2026-10-22: "drag and drop and also
-- shift-click from bags to add to a session list just in case someone messes it up later and wants to start
-- a new session"). Loot Master > Tonight has an item slot under Held boss loot (LM.BuildAddItem, placed by
-- LootMaster/Page.lua). An item goes in by dragging it from your bags onto the slot, or by shift-clicking it
-- in your bags while the slot is shown (the Tonight tab open) and no chat or other text box has the
-- keyboard. Only an item you can still trade goes in; the slot's status line says why one doesn't. One that
-- does goes through BL:AddFromBags (LootMaster/BossLoot.lua): a real row, won, ticked, "from your bags",
-- leaving when the game's trade time for it is over, kept and given out like any other row. An item can't
-- be listed more times than you have it in your bags (rows, waiting items and the running session count).
--
-- From the game (checked 2026-10-22 on warcraft.wiki.gg and Blizzard's UI source, Gethe/wow-ui-source live):
--   GetCursorInfo() -> "item", itemID, itemLink: https://warcraft.wiki.gg/wiki/API_GetCursorInfo. The
--     cursor doesn't say which bag slot; the slot the game locked while the item is picked up does
--     (C_Container.GetContainerItemInfo's isLocked), else the first slot with the same link. ClearCursor
--     puts the item back.
--   Shift-click: a bag item button's modified click (ContainerFrameItemButtonMixin:OnModifiedClick,
--     Blizzard_UIPanels_Game/Mainline/ContainerFrame.lua) calls the global HandleModifiedItemClick(link,
--     itemLocation) (Blizzard_ItemButton/Mainline/ItemButtonTemplate.lua), which puts the link in a chat box
--     when one is open (ChatFrameUtil.InsertLink). CRT only hooks it after it ran (hooksecurefunc, never a
--     replacement) and does nothing while ChatFrameUtil.GetActiveWindow() (Blizzard_ChatFrameBase/Shared/
--     ChatFrameUtil.lua) or GetCurrentKeyBoardFocus() (https://warcraft.wiki.gg/wiki/API_GetCurrentKeyBoardFocus)
--     says a text box is typing, so the link goes into chat as usual. ItemLocation:IsBagAndSlot and
--     GetBagAndSlot: Blizzard_ObjectAPI/Mainline/ItemLocation.lua.
--   Can it still be traded: C_Container.GetContainerItemInfo(bag, slot).isBound (ContainerDocumentation),
--     and C_TooltipInfo.GetBagItem(bag, slot) (https://warcraft.wiki.gg/wiki/API_C_TooltipInfo.GetBagItem):
--     a bound item you can still trade has a line of type Enum.TooltipDataLineType.TradeTimeRemaining (36,
--     added in 12.0.1; TooltipInfoSharedDocumentation). The game has no API for the time itself, so the
--     time is read from that line's numbers (in English: each number's unit; otherwise the first two
--     numbers as hours and minutes, one alone as minutes), never past LM.TRADE_SECONDS. A bound item without
--     the line can't be traded: a bind-on-pickup one (C_Item.GetItemInfo's 14th return, Enum.ItemBind.
--     OnAcquire = 1) because its trade time is over, any other because it is soulbound. An item that isn't
--     bound can be traded; it stays LM.TRADE_SECONDS like a won drop.

local LM = CRT.LootMaster
local UI = CRT.UI

local L = { slot = 36, gap = 8 }

local TEXT = {
    label = "Add item: drag an item from your bags here, or shift-click it in your bags while this is open. Only items you can still trade.",
    added = "Added %s to Held boss loot.",
    refused = "%s can't be added: %s.",
    that = "That item",
    tradeOver = "its trade time is over",
    soulbound = "it's soulbound",
    notInBags = "it isn't in your bags",
    already = "it's already in the list",
    cantRead = "CRT can't read its trade time",
}

local BIND_ON_PICKUP = 1 -- Enum.ItemBind.OnAcquire
local UNITS = { h = 3600, m = 60, s = 1 } -- English time words by their first letter

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

local function bagsLast()
    return (NUM_BAG_SLOTS or 4) + 1 -- the bags and the reagent bag, as Trade.lua searches
end

-- Seconds left in the trade time line's text, at most LM.TRADE_SECONDS; nil when it holds no number.
function LM.TradeSecondsFromText(text)
    if type(text) ~= "string" or secret(text) then
        return nil
    end
    local okL, locale = pcall(GetLocale)
    local english = okL and type(locale) == "string" and locale:sub(1, 2) == "en"
    local nums, total, known = {}, 0, true
    for n, unit in text:gmatch("(%d+)%s*(%a*)") do
        n = tonumber(n)
        nums[#nums + 1] = n
        local each = english and UNITS[unit:sub(1, 1):lower()] or nil
        if each then
            total = total + n * each
        else
            known = false
        end
    end
    if #nums == 0 then
        return nil
    end
    if not known then
        total = #nums >= 2 and (nums[1] * 3600 + nums[2] * 60) or nums[1] * 60
    end
    return math.max(1, math.min(total, LM.TRADE_SECONDS))
end

local function bagInfo(bag, slot)
    local ok, info = pcall(C_Container.GetContainerItemInfo, bag, slot)
    if not ok or type(info) ~= "table" or secret(info.hyperlink) or secret(info.isBound) or secret(info.isLocked) then
        return nil
    end
    return type(info.hyperlink) == "string" and info or nil
end

-- Whether the item in the bag slot can still be traded: true, its link and the seconds left (nil: no trade
-- time, it isn't bound), or false, its link (or nil) and why.
function LM.BagTradeState(bag, slot)
    if type(bag) ~= "number" or type(slot) ~= "number" or bag < 0 or bag > bagsLast() then
        return false, nil, TEXT.notInBags
    end
    local info = bagInfo(bag, slot)
    if not info then
        return false, nil, TEXT.notInBags
    end
    local link = info.hyperlink
    if not info.isBound then
        return true, link, nil
    end
    local lineType = Enum and Enum.TooltipDataLineType and Enum.TooltipDataLineType.TradeTimeRemaining
    local okT, data = false, nil
    if lineType and C_TooltipInfo and C_TooltipInfo.GetBagItem then
        okT, data = pcall(C_TooltipInfo.GetBagItem, bag, slot)
    end
    if not okT or type(data) ~= "table" or type(data.lines) ~= "table" then
        return false, link, TEXT.cantRead
    end
    for _, line in ipairs(data.lines) do
        if type(line) == "table" and not secret(line.type) and line.type == lineType then
            return true, link, LM.TradeSecondsFromText(line.leftText)
        end
    end
    local okI, _, _, _, _, _, _, _, _, _, _, _, _, _, bindType = pcall(C_Item.GetItemInfo, link)
    if okI and bindType == BIND_ON_PICKUP then
        return false, link, TEXT.tradeOver
    end
    return false, link, TEXT.soulbound
end

-- How many of this item string are in your bags.
local function copiesInBags(s)
    local n = 0
    for bag = 0, bagsLast() do
        local okN, slots = pcall(C_Container.GetContainerNumSlots, bag)
        for slot = 1, (okN and type(slots) == "number") and slots or 0 do
            local info = bagInfo(bag, slot)
            if info and LM.LinkItemString(info.hyperlink) == s then
                n = n + (type(info.stackCount) == "number" and not secret(info.stackCount) and info.stackCount or 1)
            end
        end
    end
    return n
end

-- How many times the item string is listed already: real rows, waiting items, the running real session.
local function listed(s)
    local BL, n = LM.BossLoot, 0
    for _, r in ipairs(BL.rows) do
        if not r.test and r.itemString == s then
            n = n + 1
        end
    end
    for _, w in ipairs(BL.waiting) do
        for _, it in ipairs(w.test and {} or w.items) do
            if it.itemString == s then
                n = n + 1
            end
        end
    end
    local cur = LM.current
    for _, it in ipairs((cur and not cur.test) and cur.items or {}) do
        if it.itemString == s then
            n = n + 1
        end
    end
    return n
end

local target -- the slot and its status line, once Tonight is built

local function say(text, good)
    if target then
        target.status:SetText(good and UI.GoodText(text) or UI.BadText(text))
    end
end

local function refuse(link, why)
    say(TEXT.refused:format(link or TEXT.that, why), false)
    return nil, why
end

-- Adds the item in the bag slot to the Boss loot list. Returns the row, or nil and why (the status line
-- says it).
function LM:AddFromBag(bag, slot)
    local ok, link, more = LM.BagTradeState(bag, slot)
    if not ok then
        return refuse(link, more)
    end
    local s = LM.LinkItemString(link)
    if not s or listed(s) >= copiesInBags(s) then
        return refuse(link, TEXT.already)
    end
    local r = self.BossLoot:AddFromBags(link, more)
    if not r then
        return refuse(link, TEXT.already)
    end
    say(TEXT.added:format(link), true)
    return r
end

-- The bag slot of the item on the cursor (its link): the slot the game locked for it, else the first with
-- the same link.
local function cursorSlot(link)
    local first
    for bag = 0, bagsLast() do
        local okN, slots = pcall(C_Container.GetContainerNumSlots, bag)
        for slot = 1, (okN and type(slots) == "number") and slots or 0 do
            local info = bagInfo(bag, slot)
            if info and info.hyperlink == link then
                if info.isLocked then
                    return bag, slot
                end
                first = first or { bag, slot }
            end
        end
    end
    if first then
        return first[1], first[2]
    end
    return nil
end

-- An item dropped on the slot. Nothing happens without an item on the cursor.
function LM:AddFromCursor()
    local ok, kind, _, link = pcall(GetCursorInfo)
    if not ok or kind ~= "item" or type(link) ~= "string" or secret(link) then
        return nil
    end
    local bag, slot = cursorSlot(link)
    ClearCursor() -- the item goes back to its slot
    if not bag then
        return refuse(link, TEXT.notInBags)
    end
    return self:AddFromBag(bag, slot)
end

-- Whether a text box has the keyboard (an open chat box): a shift-click there links the item instead.
local function typing()
    local okF, focus = pcall(GetCurrentKeyBoardFocus)
    if okF and focus then
        return true
    end
    local util = ChatFrameUtil
    if util and util.GetActiveWindow then
        local okA, box = pcall(util.GetActiveWindow)
        if okA and box then
            return true
        end
    end
    return false
end

-- After the game's HandleModifiedItemClick(link, itemLocation): a shift-click on a bag item while the slot
-- shows and nothing is typing adds it. Returns true when it tried.
function LM:BagShiftClick(link, itemLocation)
    if not (target and target.slot:IsVisible()) then
        return false
    end
    local okM, chatLink = pcall(IsModifiedClick, "CHATLINK")
    if not (okM and chatLink) or typing() then
        return false
    end
    if type(itemLocation) ~= "table" or type(itemLocation.IsBagAndSlot) ~= "function" or not itemLocation:IsBagAndSlot() then
        return false
    end
    local bag, slot = itemLocation:GetBagAndSlot()
    self:AddFromBag(bag, slot)
    return true
end

-- The slot and its lines at x, y on parent (Tonight's tab frame); width: the lines' width. skin(frame,
-- alpha): the page's box look.
function LM.BuildAddItem(parent, x, y, width, skin)
    local slot = CreateFrame("Button", nil, parent, "BackdropTemplate")
    slot:SetSize(L.slot, L.slot)
    slot:SetPoint("TOPLEFT", x, y)
    skin(slot, 0.35)
    local plus = slot:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    plus:SetPoint("CENTER", 0, 1)
    plus:SetText("+")
    local hl = slot:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.08)
    slot:SetScript("OnReceiveDrag", function()
        LM:AddFromCursor()
    end)
    slot:SetScript("OnMouseUp", function()
        LM:AddFromCursor() -- a click with an item on the cursor drops it here too
    end)
    local label = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    label:SetPoint("TOPLEFT", slot, "TOPRIGHT", L.gap, -2)
    label:SetWidth(width)
    label:SetJustifyH("LEFT")
    label:SetText(TEXT.label)
    local status = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("BOTTOMLEFT", slot, "BOTTOMRIGHT", L.gap, 2)
    status:SetWidth(width)
    status:SetJustifyH("LEFT")
    status:SetWordWrap(false)
    target = { slot = slot, label = label, status = status }
    return slot
end

-- The shift-click hook, once the game's function exists (at load, else at login).
local hooked = false
local function hook()
    if hooked or not hooksecurefunc or type(HandleModifiedItemClick) ~= "function" then
        return
    end
    hooked = true
    hooksecurefunc("HandleModifiedItemClick", function(link, itemLocation)
        local ok, err = pcall(LM.BagShiftClick, LM, link, itemLocation)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end)
end
hook()
if not hooked then
    local events = CreateFrame("Frame")
    events:RegisterEvent("PLAYER_LOGIN")
    events:SetScript("OnEvent", hook)
end
