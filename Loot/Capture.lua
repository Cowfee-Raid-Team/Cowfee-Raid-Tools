local ADDON, CRT = ...

-- Recording loot, from what the game reports to everyone in the group (each player records their own
-- copy; nothing is sent):
--   ENCOUNTER_START, BOSS_KILL           the boss's name, by encounter ID
--   ENCOUNTER_LOOT_RECEIVED              (encounterID, itemID, itemLink, quantity, playerName, className)
--                                        someone got an item from a boss
--   LOOT_HISTORY_UPDATE_DROP             (encounterID, lootListID) a group loot roll changed; the drop is
--                                        read with C_LootHistory.GetSortedDropsForEncounter: lootListID,
--                                        itemHyperlink, winner, rollInfos (each with state and isWinner)
-- A record is keyed by encounter, difficulty and loot list ID, so a roll result updates the record the
-- item made instead of adding another; an item with no loot list ID (personal loot, or the receive
-- event first) is matched by encounter, difficulty and item ID to a record still without a winner or
-- loot list. Both events can come in either order.
-- Only raids are recorded unless Dungeons is ticked, and only items of minQuality (epic) or better. An
-- item the game hasn't cached is loaded first (Item:CreateFromItemLink, ContinueOnItemLoad). Any value
-- the game made secret is skipped.

local Loot = CRT.Loot
local R = Loot.R
local Capture = {}
CRT.LootCapture = Capture

local MATCH_SECONDS = 1800 -- how long a record still waits for its roll result or receive event

local byKey = {} -- "enc-diff-lootListID" -> record, this session
local recent = {} -- { rec, enc, diff, itemID, at }, this session, for matching without a loot list ID

local function isSecret(v)
    return issecretvalue and issecretvalue(v) or false
end

local function readable(...)
    for i = 1, select("#", ...) do
        if isSecret((select(i, ...))) then
            return false
        end
    end
    return true
end

-- Where you are: instance name, difficulty, and whether that kind of instance is recorded.
local function where()
    local name, instanceType, difficultyID = GetInstanceInfo()
    local s = Loot:Settings()
    local wanted = instanceType == "raid" or (instanceType == "party" and s.dungeons)
    return wanted, name, difficultyID
end

local function itemString(link)
    return type(link) == "string" and link:match("item:[%-%d:]+") or nil
end

local function classID(classFile)
    if type(classFile) ~= "string" then
        return 0
    end
    for id = 1, GetNumClasses() do
        local localized, file = GetClassInfo(id)
        if file == classFile or localized == classFile then
            return id
        end
    end
    return 0
end

-- A full player name: the game sends a name without a realm for your own realm.
local function fullName(name)
    if type(name) ~= "string" or name == "" then
        return nil
    end
    if not name:find("-", 1, true) then
        local realm = GetNormalizedRealmName and GetNormalizedRealmName()
        if realm and realm ~= "" then
            name = name .. "-" .. realm
        end
    end
    return name
end

-- Calls fn(quality) once the item is cached.
local function withQuality(link, fn)
    local ok, item = pcall(Item.CreateFromItemLink, Item, link)
    if not ok or not item or item:IsItemEmpty() then
        return
    end
    item:ContinueOnItemLoad(function()
        fn(item:GetItemQuality() or 0)
    end)
end

local function remember(rec, enc, diff, itemID, listID)
    if listID then
        byKey[enc .. "-" .. diff .. "-" .. listID] = rec
    end
    recent[#recent + 1] = { rec = rec, enc = enc, diff = diff, itemID = itemID, at = GetTime() }
    -- keep the list short: drop what is too old to match
    while recent[1] and GetTime() - recent[1].at > MATCH_SECONDS do
        table.remove(recent, 1)
    end
end

-- A record of this encounter and item still waiting for what this event knows. wantWinner: one with no
-- player yet (a roll result); else one with no loot list ID, or with the same player (a receive event).
local function findOpen(enc, diff, itemID, player, wantWinner)
    for i = #recent, 1, -1 do
        local e = recent[i]
        if e.enc == enc and e.diff == diff and e.itemID == itemID and GetTime() - e.at <= MATCH_SECONDS then
            local recPlayer = Loot:Name("players", e.rec[R.PLAYER])
            if wantWinner then
                if not recPlayer or recPlayer == player then
                    return e.rec
                end
            elseif recPlayer == player or (not recPlayer and not e.rec[R.LIST]) then
                return e.rec
            end
        end
    end
    return nil
end

-- ENCOUNTER_LOOT_RECEIVED: someone received an item from a boss.
local function received(encounterID, itemID, link, quantity, playerName, className)
    if not readable(encounterID, itemID, link, quantity, playerName, className) then
        return
    end
    local wanted, instance, diff = where()
    if not wanted or type(link) ~= "string" then
        return
    end
    local player = fullName(playerName)
    withQuality(link, function(quality)
        if quality < (Loot:Settings().minQuality or 4) then
            return
        end
        local rec = findOpen(encounterID, diff, itemID, player, false)
        if rec then
            Loot:Update(rec, { player = player, classID = classID(className), quantity = quantity })
            return
        end
        rec = Loot:Add({
            encounterID = encounterID, instance = instance, difficultyID = diff, player = player,
            classID = classID(className), quantity = quantity, itemString = itemString(link),
        })
        remember(rec, encounterID, diff, itemID, nil)
    end)
end

-- The winner and how they rolled, from a drop: the roll marked as the winner's, else your own state when
-- you won.
local function winnerOf(drop)
    local winner = type(drop.winner) == "table" and drop.winner or nil
    if not winner or not readable(winner.playerName) then
        return nil
    end
    local state
    for _, roll in ipairs(type(drop.rollInfos) == "table" and drop.rollInfos or {}) do
        if roll.isWinner and readable(roll.state) then
            state = roll.state
        end
    end
    if state == nil and winner.isSelf and readable(drop.playerRollState) then
        state = drop.playerRollState
    end
    return fullName(winner.playerName), winner.playerClass, state
end

-- LOOT_HISTORY_UPDATE_DROP: a group loot roll changed. Only a drop with a winner is recorded.
local function dropChanged(encounterID, lootListID)
    if not readable(encounterID, lootListID) or not (C_LootHistory and C_LootHistory.GetSortedDropsForEncounter) then
        return
    end
    local wanted, instance, diff = where()
    if not wanted then
        return
    end
    local ok, drops = pcall(C_LootHistory.GetSortedDropsForEncounter, encounterID)
    if not ok or type(drops) ~= "table" then
        return
    end
    for _, drop in ipairs(drops) do
        if drop.lootListID == lootListID and readable(drop.itemHyperlink) then
            local player, classFile, state = winnerOf(drop)
            if not player then
                return
            end
            local link = drop.itemHyperlink
            local itemID = Loot.ItemID(itemString(link))
            local fields = { player = player, classID = classID(classFile), rollType = state, lootListID = lootListID }
            local rec = byKey[encounterID .. "-" .. diff .. "-" .. lootListID]
                or findOpen(encounterID, diff, itemID, player, true)
            if rec then
                Loot:Update(rec, fields)
                remember(rec, encounterID, diff, itemID, lootListID)
                return
            end
            withQuality(link, function(quality)
                if quality < (Loot:Settings().minQuality or 4) then
                    return
                end
                fields.encounterID, fields.instance, fields.difficultyID = encounterID, instance, diff
                fields.itemString = itemString(link)
                local added = Loot:Add(fields)
                remember(added, encounterID, diff, itemID, lootListID)
            end)
            return
        end
    end
end

local events = CreateFrame("Frame")
events:RegisterEvent("ENCOUNTER_START")
events:RegisterEvent("BOSS_KILL")
events:RegisterEvent("ENCOUNTER_LOOT_RECEIVED")
pcall(events.RegisterEvent, events, "LOOT_HISTORY_UPDATE_DROP")
events:SetScript("OnEvent", function(_, event, ...)
    if event == "ENCOUNTER_START" or event == "BOSS_KILL" then
        local encounterID, name = ...
        if readable(encounterID, name) then
            Loot:SetBoss(encounterID, name)
        end
    elseif event == "ENCOUNTER_LOOT_RECEIVED" then
        received(...)
    elseif event == "LOOT_HISTORY_UPDATE_DROP" then
        dropChanged(...)
    end
end)
