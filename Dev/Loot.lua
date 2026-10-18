local ADDON, CRT = ...

-- DEVELOPER ONLY. Test commands for Loot History. This file never ships: its .toc line is inside the
-- do-not-package block.
--   /crt dev loot add <itemID> [player]   one fake record now (player defaults to you)
--   /crt dev loot fill <count>            that many fake records spread over the last 12 months
--   /crt dev loot stats                   records, months, names and the saved table's rough size
--   /crt dev loot rc                      re-scan RCLootCouncil and print the match report

local Loot = CRT.Loot
local Dev = {}
CRT.LootDev = Dev

local SAMPLE_ITEMS = { 212409, 212395, 212444, 212424, 212400, 225614, 225615, 225616, 211452, 211453 }
local SAMPLE_PLAYERS = { "Abu", "Sixz", "Rixxy", "Durayn", "Notkvr", "Sarrantha", "Xuelan", "Granddh", "Djaztech", "Whitecrows" }
local CLASSES = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 }

local function realm()
    return GetNormalizedRealmName and GetNormalizedRealmName() or "Realm"
end

local function fake(itemID, player, t)
    return {
        time = t or time(), encounterID = 3470, instance = "Test Raid", difficultyID = 16,
        player = player .. "-" .. realm(), classID = CLASSES[math.random(#CLASSES)], quantity = 1,
        itemString = "item:" .. itemID, rollType = math.random(0, 5),
    }
end

-- The saved table's rough size: the characters it would take written out.
local function size(v, seen)
    local kind = type(v)
    if kind == "table" then
        local n = 2
        for k, x in pairs(v) do
            n = n + size(k) + size(x) + 2
        end
        return n
    elseif kind == "string" then
        return #v + 2
    end
    return #tostring(v)
end

function Dev:Command(msg, raw)
    local rest = msg:match("^dev%s+loot%s*(.-)$")
    if not rest then
        return false
    end
    local rawRest = (raw or msg):match("^%S+%s+%S+%s*(.-)$") or rest
    local verb, a, b = rawRest:match("^(%S*)%s*(%S*)%s*(.-)$")
    verb = (verb or ""):lower()
    if verb == "add" and tonumber(a) then
        Loot:SetBoss(3470, Loot:Boss(3470) or "Test Boss")
        Loot:Add(fake(tonumber(a), (b ~= "" and b) or UnitName("player")))
        CRT:Print("Loot History: added a fake item " .. a .. ".")
    elseif verb == "fill" and tonumber(a) then
        Loot:SetBoss(3470, Loot:Boss(3470) or "Test Boss")
        local n, now = math.min(20000, tonumber(a)), time()
        -- straight into the months, then one rebuild: a fill is not n separate loot events
        local listeners = Loot.listeners
        Loot.listeners = {}
        for i = 1, n do
            local t = now - math.random(0, 360 * 24 * 3600)
            Loot:Add(fake(SAMPLE_ITEMS[math.random(#SAMPLE_ITEMS)], SAMPLE_PLAYERS[math.random(#SAMPLE_PLAYERS)], t))
        end
        Loot.listeners = listeners
        Loot:Fire("reset")
        CRT:Print("Loot History: added " .. n .. " fake items. Delete all on its Settings tab removes them.")
    elseif verb == "stats" or verb == "" then
        local d = CRTLootDB
        CRT:Print(string.format("Loot History: %d records in %d months, %d players, %d instances, schema %d, about %.0f KB saved.",
            Loot:Count(), #Loot:Months(), #d.players, #d.instances, d.version or 0, size(d) / 1024))
        for _, m in ipairs(Loot:Months()) do
            print("  " .. m .. ": " .. #d.months[m])
        end
    elseif verb == "rc" then
        CRT.LootRCLC:Scan()
        CRT:Print(CRT.LootRCLC:ReportText())
    else
        CRT:Print("Use /crt dev loot add <itemID> [player], fill <count>, stats or rc.")
    end
    return true
end
