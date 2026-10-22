local ADDON, CRT = ...

-- The item drop slot, shared by every page that takes an item from your bags (Loot Master's Add item,
-- LootMaster/AddItem.lua, and Requests, Requests/Page.lua): a 36 px square with a "+", a one-line
-- instruction beside it with its (?), and a status line under that. An item goes in by dragging it from your
-- bags onto the slot (or clicking the slot with it on the cursor), or by shift-clicking it in your bags while
-- the slot is shown and no chat or other text box has the keyboard. A shift-click on a stack is the game's
-- stack split, so it is left alone (each page's (?) says to drag a stack). The page decides what to do with
-- the item; the slot only finds its bag slot.
--   UI.ItemDropSlot(parent, x, y, width, opts) returns the slot (a Button); width is the lines' width. opts:
--     skin(frame, alpha)   the page's box look
--     label, helpTitle, help   the line beside the slot and its (?)
--     onDrop(bag, slot, link)  an item dropped on it (bag nil: it isn't in your bags; the cursor is clear)
--     onPick(bag, slot)        an item shift-clicked in your bags
--     shiftClick(link, itemLocation)  replaces the shift-click route (Loot Master keeps LM.BagShiftClick)
--   slot.label, slot.status (font strings), slot.Say(text, good) writes the status line in the good or bad
--   colour (nil good: as given), slot.ShowItem(link) shows the item's icon in the slot with its tooltip on
--   hover (nil: the "+" again).
-- CRT.Bags holds the bag reads both pages share.
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
--     replacement), inside pcall, and does nothing while ChatFrameUtil.GetActiveWindow() (Blizzard_ChatFrameBase/
--     Shared/ChatFrameUtil.lua) or GetCurrentKeyBoardFocus() (https://warcraft.wiki.gg/wiki/API_GetCurrentKeyBoardFocus)
--     says a text box is typing, so the link goes into chat as usual. ItemLocation:IsBagAndSlot and
--     GetBagAndSlot: Blizzard_ObjectAPI/Mainline/ItemLocation.lua. A click in a bank bag is left alone.
--   A stack's size: C_Container.GetContainerItemInfo(bag, slot).stackCount (ContainerDocumentation).
--   The slot's icon: C_Item.GetItemInfoInstant(item)'s fifth return (ItemDocumentation).

local UI = CRT.UI
local Bags = {}
CRT.Bags = Bags

local L = { slot = 36, gap = 8, lineGap = 4, iconInset = 3 }

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- The last bag searched: the bags and the reagent bag, as LootMaster/Trade.lua searches.
function Bags.Last()
    return (NUM_BAG_SLOTS or 4) + 1
end

function Bags.InBags(bag)
    return type(bag) == "number" and bag >= 0 and bag <= Bags.Last()
end

-- A bag slot's item info, or nil when empty, unreadable or secret.
function Bags.Info(bag, slot)
    local ok, info = pcall(C_Container.GetContainerItemInfo, bag, slot)
    if not ok or type(info) ~= "table" or secret(info.hyperlink) or secret(info.isBound) or secret(info.isLocked) or secret(info.stackCount) then
        return nil
    end
    return type(info.hyperlink) == "string" and info or nil
end

-- Calls fn(bag, slot, info) for every item in your bags.
function Bags.Each(fn)
    for bag = 0, Bags.Last() do
        local okN, slots = pcall(C_Container.GetContainerNumSlots, bag)
        for slot = 1, (okN and type(slots) == "number") and slots or 0 do
            local info = Bags.Info(bag, slot)
            if info then
                fn(bag, slot, info)
            end
        end
    end
end

-- How many copies of an item are in your bags (a stack counts each copy): those whose keyOf(link) is key.
function Bags.Count(key, keyOf)
    local n = 0
    if key == nil then
        return 0
    end
    Bags.Each(function(_, _, info)
        if keyOf(info.hyperlink) == key then
            n = n + (type(info.stackCount) == "number" and info.stackCount or 1)
        end
    end)
    return n
end

-- The bag slot of the item on the cursor (its link): the slot the game locked for it, else the first with
-- the same link.
function Bags.CursorSlot(link)
    local locked, first
    Bags.Each(function(bag, slot, info)
        if info.hyperlink == link then
            if info.isLocked and not locked then
                locked = { bag, slot }
            end
            first = first or { bag, slot }
        end
    end)
    local at = locked or first
    if at then
        return at[1], at[2]
    end
    return nil
end

-- The item on the cursor, put back in its bag slot: its link, bag and slot (bag nil when it isn't in your
-- bags). Nothing (and the cursor left alone) with no item on it.
function Bags.TakeCursor()
    local ok, kind, _, link = pcall(GetCursorInfo)
    if not ok or kind ~= "item" or type(link) ~= "string" or secret(link) then
        return nil
    end
    local bag, slot = Bags.CursorSlot(link)
    ClearCursor() -- the item goes back to its slot
    return link, bag, slot
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
-- shows and nothing is typing goes to its onPick. A click in the bank is left alone, and so is a stack: the
-- game opens its split, which is no mistake, so the status line stays as it was. Returns true when it tried.
function UI.ItemSlotShiftClick(slot, link, itemLocation)
    if not (slot and slot:IsVisible()) then
        return false
    end
    local okM, chatLink = pcall(IsModifiedClick, "CHATLINK")
    if not (okM and chatLink) or typing() then
        return false
    end
    if type(itemLocation) ~= "table" or type(itemLocation.IsBagAndSlot) ~= "function" or not itemLocation:IsBagAndSlot() then
        return false
    end
    local bag, bagSlot = itemLocation:GetBagAndSlot()
    if not Bags.InBags(bag) then
        return false -- the bank
    end
    local info = Bags.Info(bag, bagSlot)
    if info and type(info.stackCount) == "number" and info.stackCount > 1 then
        return false -- the split is the game's; nothing is taken
    end
    if slot.crtOnPick then
        slot.crtOnPick(bag, bagSlot)
    end
    return true
end

local slots = {} -- every slot made, for the shift-click hook

local function showTooltip(slot)
    local link = slot.crtItemLink
    if not (link and GameTooltip) then
        return
    end
    UI.TooltipOwner(GameTooltip, slot, "ANCHOR_RIGHT")
    pcall(GameTooltip.SetHyperlink, GameTooltip, link)
    GameTooltip:Show()
end

local function hideTooltip()
    if GameTooltip then
        GameTooltip:Hide()
    end
end

function UI.ItemDropSlot(parent, x, y, width, opts)
    opts = opts or {}
    local slot = CreateFrame("Button", nil, parent, "BackdropTemplate")
    slot:SetSize(L.slot, L.slot)
    slot:SetPoint("TOPLEFT", x, y)
    if opts.skin then
        opts.skin(slot, 0.35)
    end
    local plus = slot:CreateFontString(nil, "OVERLAY", "CRTFontLarge")
    plus:SetPoint("CENTER", 0, 1)
    plus:SetText("+")
    local icon = slot:CreateTexture(nil, "ARTWORK")
    icon:SetPoint("TOPLEFT", L.iconInset, -L.iconInset)
    icon:SetPoint("BOTTOMRIGHT", -L.iconInset, L.iconInset)
    icon:Hide()
    local hl = slot:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 1, 1, 0.08)
    local function drop()
        local link, bag, bagSlot = Bags.TakeCursor()
        if link and opts.onDrop then
            opts.onDrop(bag, bagSlot, link)
        end
    end
    slot:SetScript("OnReceiveDrag", drop)
    slot:SetScript("OnMouseUp", drop) -- a click with an item on the cursor drops it here too
    slot:SetScript("OnEnter", showTooltip)
    slot:SetScript("OnLeave", hideTooltip)
    -- the line and the status line under it each hold one line at a fixed width, the status anchored to the
    -- line's own bottom, so neither can run onto the other
    local label = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    label:SetPoint("TOPLEFT", slot, "TOPRIGHT", L.gap, -2)
    label:SetWidth(width)
    label:SetJustifyH("LEFT")
    label:SetWordWrap(false)
    label:SetText(opts.label or "")
    if opts.help then
        UI.HelpRight(label, opts.helpTitle, opts.help)
    end
    local status = parent:CreateFontString(nil, "OVERLAY", "CRTFontSmall")
    status:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 0, -L.lineGap)
    status:SetWidth(width)
    status:SetJustifyH("LEFT")
    status:SetWordWrap(false)
    slot.label, slot.status, slot.icon, slot.plus = label, status, icon, plus
    slot.crtOnPick = opts.onPick
    slot.crtShiftClick = opts.shiftClick or function(link, itemLocation)
        return UI.ItemSlotShiftClick(slot, link, itemLocation)
    end
    function slot.Say(text, good)
        if good == nil then
            status:SetText(text or "")
        else
            status:SetText(good and UI.GoodText(text) or UI.BadText(text))
        end
    end
    function slot.ShowItem(link)
        local tex
        if type(link) == "string" then
            local ok, _, _, _, _, t = pcall(C_Item.GetItemInfoInstant, link)
            tex = ok and not secret(t) and t or nil
        end
        slot.crtItemLink = type(link) == "string" and link or nil
        icon:SetTexture(tex)
        icon:SetShown(tex ~= nil)
        plus:SetShown(tex == nil)
    end
    slots[#slots + 1] = slot
    return slot
end

-- The shift-click hook, once the game's function exists (at load, else at login). A failing hook body is
-- reported and never stops the game's click (it has run already).
local hooked = false
local function hook()
    if hooked or not hooksecurefunc or type(HandleModifiedItemClick) ~= "function" then
        return
    end
    hooked = true
    hooksecurefunc("HandleModifiedItemClick", function(link, itemLocation)
        for _, slot in ipairs(slots) do
            local ok, err = pcall(slot.crtShiftClick, link, itemLocation)
            if not ok and geterrorhandler then
                pcall(geterrorhandler(), err)
            end
        end
    end)
end
hook()
if not hooked then
    local events = CreateFrame("Frame")
    events:RegisterEvent("PLAYER_LOGIN")
    events:SetScript("OnEvent", hook)
end
