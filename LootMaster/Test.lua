local ADDON, CRT = ...

-- Testing Loot Master with no boss: /crt loot test starts a session of sample items marked TEST. You get
-- the looter window straight away, and everyone in the group with CRT (you too) gets the raider popup.
-- The answers, the /rolls, Award, show again and roll again all work as in a real session; nothing is
-- passed, traded or written to Loot History. The items are real ones from your own loot: the newest
-- items in Loot History and RCLootCouncil's awards, so their icons and tooltips work; FALLBACK is only
-- used when you have none.
--   /crt loot test [count]   start a test (count 1-8, default 4)
--   /crt loot window         show the looter window again
--   /crt loot popup          show your raider popup again
--   /crt loot end            end the session
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

local function samples(count)
    local out, seen = {}, {}
    local function add(itemString, link)
        local id = Loot.ItemID(itemString)
        if id and not seen[id] and #out < count then
            seen[id] = true
            local ilvl = C_Item.GetDetailedItemLevelInfo(link or itemString)
            out[#out + 1] = { itemString = short(itemString), link = link, ilvl = ilvl }
        end
    end
    Loot:Each(function(rec)
        add(rec[R.ITEM])
    end)
    for _, a in ipairs(CRT.LootRCLC and CRT.LootRCLC.unmatched or {}) do
        add(a.itemString, a.link)
    end
    for _, id in ipairs(FALLBACK) do
        add("item:" .. id)
    end
    return out
end

function LM:Test(count)
    count = math.max(1, math.min(LM.MAX_ITEMS, tonumber(count) or DEFAULT_COUNT))
    local items = samples(count)
    local s = self:Start(items, true)
    if s then
        CRT:Print(string.format("Loot Master test: %d sample items sent to %s. Nothing is passed or traded.",
            #items, IsInGroup() and "the group" or "you (not in a group)"))
    end
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
    elseif verb == "end" then
        self:End()
    elseif verb == "settings" or verb == "master" then
        CRT.UI:Show("lootmaster")
    else
        return false
    end
    return true
end
