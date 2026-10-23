local ADDON, CRT = ...

-- Add item: items from your bags onto the Boss loot list (Alex, 2026-10-22: "drag and drop and also
-- shift-click from bags to add to a session list just in case someone messes it up later and wants to start
-- a new session"). Loot Master > Tonight has an item slot under Held boss loot (LM.BuildAddItem, placed by
-- LootMaster/Page.lua; the slot is the shared UI.ItemDropSlot, UI/ItemSlot.lua). An item goes in by
-- dragging it from your bags onto the slot, or by shift-clicking it in your bags while the slot is shown
-- (the Tonight tab open) and no chat or other text box has the keyboard. Any item you can still trade goes
-- in, gear or not (Alex, 2026-10-22: "remove the restriction for non gear and tier items. This would allow
-- me to auction off pots and funny things"); the slot's status line says why one doesn't. One that does goes through BL:AddFromBags (LootMaster/BossLoot.lua): a
-- real row, won, ticked, "from your bags", kept out of the loot filter (the leader's own choice) and given
-- out like any other row. It leaves when the game's trade time for it is over; one that isn't bound has no
-- trade time and leaves LM.TRADE_SECONDS after it was added.
-- A stack adds one row per drag, each row one copy (Trade.lua splits one off when it is traded). A
-- shift-click on a stack is the game's stack split, so it adds nothing; the slot's (?) says to drag a stack.
-- An item can't be listed more times than you have it in your bags (a stack counts each copy): rows that
-- are yours or may still be, waiting items and the running session count, matched by item ID and bonus IDs
-- (LM.ItemKey).
--
-- From the game (checked 2026-10-22 on warcraft.wiki.gg and Blizzard's UI source, Gethe/wow-ui-source live):
--   The drop slot, the cursor and the shift-click hook: UI.ItemDropSlot and CRT.Bags (UI/ItemSlot.lua).
--   The item string's fields (https://warcraft.wiki.gg/wiki/ItemLink): 1 itemID, 9 linkLevel, 10
--     specializationID, 13 numBonusIDs, then the bonus IDs.
--   Can it still be traded: C_Container.GetContainerItemInfo(bag, slot).isBound (ContainerDocumentation),
--     and C_TooltipInfo.GetBagItem(bag, slot) (https://warcraft.wiki.gg/wiki/API_C_TooltipInfo.GetBagItem):
--     a bound item you can still trade has a line of type Enum.TooltipDataLineType.TradeTimeRemaining (36,
--     added in 12.0.1; TooltipInfoSharedDocumentation). The game has no API for the time itself. The line is
--     the client's BIND_TRADE_TIME_REMAINING ("... for the next %s (including time offline).", the client's
--     GlobalStrings, as extracted in Ketho/BlizzardInterfaceResources); its %s is read with the unit words of
--     the client's own time formats (D_HOURS, INT_GENERAL_DURATION_HOURS, INT_SPELL_DURATION_HOURS,
--     HOURS_ABBR and the minute and second ones). Which of them the game fills %s with isn't published, so
--     every one counts; when the line doesn't read that way the row gets the full LM.TRADE_SECONDS. A bound
--     item without the line can't be traded: a bind-on-pickup one (C_Item.GetItemInfo's 14th return,
--     Enum.ItemBind.OnAcquire) because its trade time is over, any other because it is soulbound.

local LM = CRT.LootMaster
local UI = CRT.UI
local Bags = CRT.Bags

local TEXT = {
    -- one short line: the detail is in its (?), so it never wraps onto the status line under it
    label = "Add item: drag an item from your bags here, or shift-click it.",
    helpTitle = "Add item",
    help = "Drag an item from your bags onto the slot, or shift-click it in your bags while this tab is open.\n\n"
        .. "Any item you can still trade goes in: gear, tokens, flasks, potions, anything. Each one is open to every raider.\n\n"
        .. "A stack adds one copy each time you drag it, up to the number you have. Shift-click on a stack opens the game's split instead, so drag stacks.",
    added = "Added %s to Held boss loot.",
    refused = "%s can't be added: %s.",
    that = "That item",
    tradeOver = "its trade time is over",
    soulbound = "it's soulbound",
    notInBags = "it isn't in your bags",
    already = "it's already in the list",
    cantRead = "CRT can't read its trade time",
}

local BIND_ON_PICKUP = (Enum and Enum.ItemBind and type(Enum.ItemBind.OnAcquire) == "number") and Enum.ItemBind.OnAcquire or 1

-- The client's time formats, by the seconds each unit is worth.
local UNIT_FORMATS = {
    { 3600, { "D_HOURS", "INT_GENERAL_DURATION_HOURS", "INT_SPELL_DURATION_HOURS", "HOURS_ABBR" } },
    { 60, { "D_MINUTES", "INT_GENERAL_DURATION_MIN", "INT_SPELL_DURATION_MIN", "MINUTES_ABBR" } },
    { 1, { "D_SECONDS", "INT_GENERAL_DURATION_SEC", "INT_SPELL_DURATION_SEC", "SECONDS_ABBR" } },
}

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

local function trim(w)
    return (w:gsub("^%s+", ""):gsub("%s+$", ""))
end

-- The unit words of the client's time formats: "%d |4Hour:Hours;" gives hour and hours. A word two units
-- share is no unit (false).
local function unitWords()
    local words = {}
    local function add(w, each)
        w = trim((w:gsub("%p", ""))):lower() -- "Std." reads as the text's "Std"
        if w ~= "" then
            if words[w] == nil then
                words[w] = each
            elseif words[w] ~= each then
                words[w] = false
            end
        end
    end
    for _, u in ipairs(UNIT_FORMATS) do
        for _, name in ipairs(u[2]) do
            local f = _G[name]
            if type(f) == "string" then
                f = f:gsub("%%d", "")
                for forms in f:gmatch("|4([^;]*);") do
                    for w in (forms .. ":"):gmatch("([^:]*):") do
                        add(w, u[1])
                    end
                end
                add((f:gsub("|4[^;]*;", "")), u[1])
            end
        end
    end
    return words
end

local function escape(s)
    return (s:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0"))
end

-- Seconds left in the trade time line's text, at most LM.TRADE_SECONDS; nil when it doesn't read as the
-- client's BIND_TRADE_TIME_REMAINING with known time words (the caller then takes LM.TRADE_SECONDS).
function LM.TradeSecondsFromText(text)
    local template = BIND_TRADE_TIME_REMAINING
    if type(text) ~= "string" or secret(text) or type(template) ~= "string" then
        return nil
    end
    local pre, post = template:match("^(.-)%%s(.*)$")
    if not pre then
        return nil
    end
    local span = text:match("^" .. escape(pre) .. "(.+)" .. escape(post) .. "$")
    if not span then
        return nil
    end
    local words, total, found = unitWords(), 0, false
    local rest = span
    for n, w in span:gmatch("(%d+)%s*([^%d%s%p]+)") do
        local each = words[w:lower()]
        if not each then
            return nil
        end
        total, found = total + tonumber(n) * each, true
    end
    rest = rest:gsub("(%d+)%s*([^%d%s%p]+)", "")
    if not found or rest:find("%d") then
        return nil -- a number with no word: not read
    end
    return math.max(1, math.min(total, LM.TRADE_SECONDS))
end

-- An item's key for counting copies: its item ID and bonus IDs (sorted), without the fields that change
-- with you (linkLevel, specializationID); the item ID alone when the bonus IDs can't be read.
function LM.ItemKey(s)
    if type(s) ~= "string" then
        return nil
    end
    local body = s:match("item:([%-%d:]+)")
    if not body then
        return nil
    end
    local f = {}
    for v in (body .. ":"):gmatch("([^:]*):") do
        f[#f + 1] = v
    end
    local id = tonumber(f[1])
    if not id then
        return nil
    end
    local n = tonumber(f[13])
    if not n or n < 1 then
        return tostring(id)
    end
    local bonus = {}
    for i = 14, 13 + n do
        local b = tonumber(f[i])
        if not b then
            return tostring(id)
        end
        bonus[#bonus + 1] = b
    end
    table.sort(bonus)
    return id .. ":" .. table.concat(bonus, ":")
end

-- Whether the item in the bag slot can be added: true, its link, the seconds left (nil: read as
-- LM.TRADE_SECONDS) and whether it has no trade time (not bound); or false, its link (or nil) and why.
function LM.BagTradeState(bag, slot)
    if not Bags.InBags(bag) or type(slot) ~= "number" then
        return false, nil, TEXT.notInBags
    end
    local info = Bags.Info(bag, slot)
    if not info then
        return false, nil, TEXT.notInBags
    end
    local link = info.hyperlink
    if not info.isBound then
        return true, link, nil, true
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
            return true, link, LM.TradeSecondsFromText(line.leftText), false
        end
    end
    local okI, _, _, _, _, _, _, _, _, _, _, _, _, _, bindType = pcall(C_Item.GetItemInfo, link)
    if okI and not secret(bindType) and bindType == BIND_ON_PICKUP then
        return false, link, TEXT.tradeOver
    end
    return false, link, TEXT.soulbound
end

-- How many times the item (LM.ItemKey) is listed already: real rows that are yours or may still be (won
-- or rolling), waiting items, the running real session.
local function listed(key)
    local BL, n = LM.BossLoot, 0
    for _, r in ipairs(BL.rows) do
        if not r.test and BL.Tickable(r) and LM.ItemKey(r.itemString) == key then
            n = n + 1
        end
    end
    for _, w in ipairs(BL.waiting) do
        for _, it in ipairs(w.test and {} or w.items) do
            if LM.ItemKey(it.itemString) == key then
                n = n + 1
            end
        end
    end
    local cur = LM.current
    for _, it in ipairs((cur and not cur.test) and cur.items or {}) do
        if LM.ItemKey(it.itemString) == key then
            n = n + 1
        end
    end
    return n
end

local target -- the slot (UI.ItemDropSlot), once Tonight is built

local function say(text, good)
    if target then
        target.Say(text, good)
    end
end

local function refuse(link, why)
    say(TEXT.refused:format(link or TEXT.that, why), false)
    return nil, why
end

-- Adds the item in the bag slot to the Boss loot list. Returns the row, or nil and why (the status line
-- says it).
function LM:AddFromBag(bag, slot)
    local ok, link, seconds, untimed = LM.BagTradeState(bag, slot)
    if not ok then
        return refuse(link, seconds)
    end
    local key = LM.ItemKey(link)
    if not key or listed(key) >= Bags.Count(key, LM.ItemKey) then
        return refuse(link, TEXT.already)
    end
    local r = self.BossLoot:AddFromBags(link, seconds, untimed)
    if not r then
        return refuse(link, TEXT.already)
    end
    say(TEXT.added:format(link), true)
    return r
end

-- An item dropped on the slot. Nothing happens without an item on the cursor.
local function dropped(bag, slot, link)
    if not bag then
        return refuse(link, TEXT.notInBags)
    end
    return LM:AddFromBag(bag, slot)
end

function LM:AddFromCursor()
    local link, bag, slot = Bags.TakeCursor()
    if link then
        return dropped(bag, slot, link)
    end
    return nil
end

-- The slot and its lines at x, y on parent (Tonight's tab frame); width: the lines' width. A shift-click
-- in your bags while it shows adds the item (the shared hook in UI/ItemSlot.lua; a stack is left to the
-- game's split).
function LM.BuildAddItem(parent, x, y, width)
    target = UI.ItemDropSlot(parent, x, y, width, {
        label = TEXT.label, helpTitle = TEXT.helpTitle, help = TEXT.help,
        onDrop = dropped,
        onPick = function(bag, slot)
            LM:AddFromBag(bag, slot)
        end,
    })
    return target
end
