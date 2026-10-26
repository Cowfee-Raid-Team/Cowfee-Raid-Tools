local ADDON, CRT = ...

-- Testing Loot Master with no boss: /crt loot test starts a session of sample items marked TEST. You get
-- the Master Loot Window straight away, and everyone in the group with CRT (you too) gets the raider popup.
-- The answers, the rolls (drawn silently by the looter's CRT), Award, show again, roll again, the raider
-- window and double-click trading all work as in a real session; nothing is passed or written to Loot
-- History, and the award message is shown only to you. The items are real ones from your own loot: picked at
-- random from Loot History and RCLootCouncil's awards, so their icons and tooltips work, one per slot (or kind
-- of item) first so each test shows a mix; FALLBACK is only used when you have none. Items that pass your loot
-- filter are picked first, and the chat says when too few do. Loot Master > Tonight's Test boss kill
-- (LM:TestBossKill, below) holds samples in Boss loot instead, as a boss kill would.
--   /crt loot                your popup and All Loot Rolls (LM:OpenMyLoot, LootMaster/RaiderWindow.lua)
--   /crt loot test [count]   start a test (count 1-8, default 4)
--   /crt loot window         show the Master Loot Window again
--   /crt loot popup          show your raider popup again
--   /crt loot answers        everyone's answers and rolls (the raider window)
--   /crt loot end            end the session and the items waiting to start, after asking
--   /crt loot boss           the raid leader's Boss loot window (LootMaster/BossLootWindow.lua)
--   /crt loot settings       open the Loot Master page (also /crt loot master)

local LM = CRT.LootMaster
local Loot = CRT.Loot
local R = Loot.R

local DEFAULT_COUNT = 4
local FALLBACK = { 270162, 249329, 249275 } -- items seen in this guild's loot, for a test with no history

-- Short item strings: the link's "item:..." with its empty tail dropped, so a message stays small.
local function short(itemString)
    return (itemString or ""):gsub(":+$", "")
end

-- Picks count entries of the pool ({ equipLoc, itemClass, ... }) at random: first one per slot (an item
-- with no slot, such as a token, counts by its item class), then any others. random(n) gives 1..n, as
-- math.random does; a test passes its own to make the picks the same each run.
function LM.PickSamples(pool, count, random)
    random = random or math.random
    local order = {}
    for i, e in ipairs(pool) do
        order[i] = e
    end
    for i = #order, 2, -1 do
        local j = random(i)
        order[i], order[j] = order[j], order[i]
    end
    local out, used, kinds = {}, {}, {}
    for i, e in ipairs(order) do
        local kind = (e.equipLoc and e.equipLoc ~= "") and e.equipLoc or ("class" .. tostring(e.itemClass))
        if #out < count and not kinds[kind] then
            kinds[kind], used[i] = true, true
            out[#out + 1] = e
        end
    end
    for i, e in ipairs(order) do
        if #out < count and not used[i] then
            out[#out + 1] = e
        end
    end
    return out
end

-- Every item you have looted (Loot History, then RCLootCouncil's awards), once each; FALLBACK too when that is
-- fewer than count.
local function pool(count)
    local out, seen = {}, {}
    local function add(itemString, link)
        local id = Loot.ItemID(itemString)
        if id and not seen[id] then
            seen[id] = true
            local ok, _, _, _, equipLoc, _, itemClass = pcall(C_Item.GetItemInfoInstant, itemString)
            out[#out + 1] = { itemString = itemString, link = link, equipLoc = ok and equipLoc or nil, itemClass = ok and itemClass or nil }
        end
    end
    Loot:Each(function(rec)
        add(rec[R.ITEM])
    end)
    for _, a in ipairs(CRT.LootRCLC and CRT.LootRCLC.unmatched or {}) do
        add(a.itemString, a.link)
    end
    if #out < count then
        for _, id in ipairs(FALLBACK) do
            add("item:" .. id)
        end
    end
    return out
end

-- The picks: items that pass your loot filter (LootMaster/Filter.lua; a sample counts as boss loot), those
-- the game described in full first, then those let through on a part it couldn't read; then others when too
-- few pass. The pool is shuffled and read only until count items pass in full, so a long Loot History
-- isn't read item by item (a token's tooltip each). Returns the items and how many passed.
local function samples(count, random)
    random = random or math.random
    local order = pool(count)
    for i = #order, 2, -1 do
        local j = random(i)
        order[i], order[j] = order[j], order[i]
    end
    local filter, pass, unread, rest = LM:Filter(), {}, {}, {}
    for _, e in ipairs(order) do
        if #pass >= count then
            break
        end
        local ok, why = LM.PassesFilter(LM.ItemFacts(e.itemString, "boss"), filter)
        if ok and why == "unreadable" then
            unread[#unread + 1] = e
        elseif ok then
            pass[#pass + 1] = e
        else
            rest[#rest + 1] = e
        end
    end
    local picked = LM.PickSamples(pass, count, random)
    local passed = #picked
    for _, list in ipairs({ unread, rest }) do
        if list == rest then
            passed = #picked
        end
        if #picked < count then
            for _, e in ipairs(LM.PickSamples(list, count - #picked, random)) do
                picked[#picked + 1] = e
            end
        end
    end
    local out = {}
    for i, e in ipairs(picked) do
        out[i] = { itemString = short(e.itemString), link = e.link, ilvl = C_Item.GetDetailedItemLevelInfo(e.link or e.itemString) }
    end
    return out, passed
end

-- random: optional, for tests (see LM.PickSamples).
function LM:Test(count, random)
    count = math.max(1, math.min(LM.MAX_ITEMS, tonumber(count) or DEFAULT_COUNT))
    local items, passed = samples(count, random)
    if passed == 0 then
        CRT:Print("Loot Master test: none of your sample items pass the loot filter, so the test uses others.")
    elseif passed < #items then
        CRT:Print(string.format("Loot Master test: only %d of your sample items %s the loot filter, so the test adds %d %s.",
            passed, passed == 1 and "passes" or "pass", #items - passed, #items - passed == 1 and "other" or "others"))
    end
    local s = self:Start(items, true)
    if s then
        CRT:Print(string.format("Loot Master test: %d sample items sent to %s. Nothing is passed; you can test trading a given-out item by double-clicking it.",
            #items, IsInGroup() and "the group" or "you (not in a group)"))
    end
end

-- Test boss kill (Loot Master > Tonight): each click is one boss kill. It adds KILL_ITEMS sample items,
-- picked as above, to the Boss loot list through BL:AddReceived, the way a kill with no roll adds yours,
-- flagged test: won, ticked, marked TEST, from "Test boss N". Start session gives them out in a test
-- session (LootMaster/BossLoot.lua). N counts from 1 again once no TEST rows are held.
local KILL_ITEMS = { 2, 4 } -- the fewest and most items a test kill drops
local testKills = 0

local TEXT = {
    boss = "Test boss %d",
    unknown = "Item %d",
    killed = "Loot Master test: %s dropped %d %s. Tick them and press Start session.",
    item = "item", items = "items",
}

-- A link for the row: the sample's own, else the game's, else one made from the item string (its name
-- comes once the game has the item).
local function linkOf(it)
    if it.link then
        return it.link
    end
    local ok, _, link = pcall(C_Item.GetItemInfo, it.itemString)
    if ok and type(link) == "string" then
        return link
    end
    return "|cffffffff|H" .. it.itemString .. "|h[" .. TEXT.unknown:format(Loot.ItemID(it.itemString) or 0) .. "]|h|r" -- the game's white item link, not a theme colour
end

-- random: optional, for tests (see LM.PickSamples). Returns the rows added.
function LM:TestBossKill(random)
    random = random or math.random
    local BL = self.BossLoot
    if not BL:HasTests() then
        testKills = 0
    end
    testKills = testKills + 1
    local count = KILL_ITEMS[1] + random(KILL_ITEMS[2] - KILL_ITEMS[1] + 1) - 1
    local items = samples(count, random)
    local kill = { name = TEXT.boss:format(testKills), at = time(), test = true }
    local rows = {}
    for _, it in ipairs(items) do
        rows[#rows + 1] = BL:AddReceived(linkOf(it), kill, true)
    end
    CRT:Print(TEXT.killed:format(kill.name, #rows, #rows == 1 and TEXT.item or TEXT.items))
    return rows
end

-- /crt loot <verb>. Returns true when it handled the command.
function LM:Command(msg)
    local verb, arg = msg:match("^loot%s+(%S+)%s*(.-)$")
    if verb == "test" then
        self:Test(arg)
    elseif verb == "window" then
        self:ShowWindow()
    elseif verb == "popup" then
        self:ShowPopup()
    elseif verb == "answers" then
        self:ShowAnswers()
    elseif verb == "end" then
        self:AskEnd() -- asks first, as every End session does (LootMaster/EndAll.lua)
    elseif verb == "boss" then
        self:ShowBossLoot()
    elseif verb == "settings" or verb == "master" then
        CRT.UI:Show("lootmaster")
    else
        return false
    end
    return true
end

-- The /crt loot word is registered in LootMaster/RaiderWindow.lua: /crt loot alone opens your loot; with a
-- word after it, it runs LM:Command. Loot History has no word of its own: it opens from the menu.
