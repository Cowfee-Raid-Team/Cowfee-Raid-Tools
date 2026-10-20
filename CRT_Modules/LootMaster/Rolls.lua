local ADDON, CRT = ...

-- The game's group loot rolls while CRT Looting is on. Design: decisions/2026-10-18 Cowfee Raid Tools Loot
-- Master.md ("Auto-pass reliability", "The looter") in the vault.
--   A raider: on START_LOOT_ROLL, straight away, the gate (AutoPass:ShouldPass) decides and AutoPass:Pass
--     passes the roll. If the game hasn't closed the roll (CANCEL_LOOT_ROLL) within CLOSE_SECONDS, chat
--     says so and the game's roll frame stays up for you.
--   The raid leader (the looter): AutoPass:LeaderRoll picks Need, else Greed, else Transmog, and
--     AutoPass:Roll rolls it. The game's "are you sure" (CONFIRM_LOOT_ROLL) is answered only for a roll CRT
--     made, with the same type. The items CRT rolled on are collected, and once no new one has started for
--     COLLECT_SECONDS they go through the loot filter (LM:FilterLoot, as boss loot) into one Loot Master
--     session (LM:Start, never a test). A session already running (a test too) is never mixed with: the
--     items wait until it ends. More than LM.MAX_ITEMS items make a second session after the first.
-- A roll counts as a boss's when it starts within LM.BOSS_SECONDS of a kill in the same raid instance
-- (LM:LastKill). Every pass, roll and refusal is said in chat, so a raid shows what the game did; nothing
-- is said while CRT Looting is off. The game's roll and confirm calls are made only in AutoPass.lua.
-- Blizzard's loot frames are never touched: a pass or roll makes the game close its own frame.
--
-- The game's API, checked 2026-10-20 (warcraft.wiki.gg, and Blizzard's code in Gethe/wow-ui-source):
--   START_LOOT_ROLL: rollID, rollTime, lootHandle (nilable): https://warcraft.wiki.gg/wiki/START_LOOT_ROLL,
--     Blizzard_APIDocumentationGenerated/LootDocumentation.lua
--   CANCEL_LOOT_ROLL: rollID: https://warcraft.wiki.gg/wiki/CANCEL_LOOT_ROLL; Blizzard's GroupLootFrame.lua
--     removes that roll's frame on it, and every frame on CANCEL_ALL_LOOT_ROLLS
--   CONFIRM_LOOT_ROLL: rollID, rollType, confirmReason: https://warcraft.wiki.gg/wiki/CONFIRM_LOOT_ROLL
--   GetLootRollItemInfo(rollID): texture, name, count, quality, bindOnPickUp, canNeed, canGreed,
--     canDisenchant, reasonNeed, reasonGreed, reasonDisenchant, deSkillRequired, canTransmog:
--     https://warcraft.wiki.gg/wiki/API_GetLootRollItemInfo, read the same way by GroupLootFrame_OnShow
--   GetLootRollItemLink(rollID): the item's link: https://warcraft.wiki.gg/wiki/API_GetLootRollItemLink

local LM = CRT.LootMaster
local AutoPass = LM.AutoPass

LM.CLOSE_SECONDS = 3 -- seconds the game gets to close a roll CRT passed or rolled
LM.COLLECT_SECONDS = 2 -- seconds with no new boss roll before the leader's session starts

local TEXT = {
    passed = "CRT Looting passed %s for %s.",
    passKept = "CRT Looting couldn't pass %s (the game kept the roll open), so roll it yourself.",
    passFailed = "CRT Looting couldn't pass %s (%s), so roll it yourself.",
    notPassed = "CRT Looting didn't pass %s: %s, so roll it yourself.",
    rolled = "CRT Looting rolled %s on %s.",
    rollKept = "CRT Looting couldn't roll on %s (the game kept the roll open), so roll it yourself.",
    rollFailed = "CRT Looting couldn't roll on %s (%s), so roll it yourself.",
    notRolled = "CRT Looting didn't roll on %s: %s, so roll it yourself.",
    confirmType = "CRT Looting didn't confirm %s: the game asked about another kind of roll, so answer it yourself.",
    confirmFailed = "CRT Looting couldn't confirm %s (%s), so answer it yourself.",
    noLoot = "No loot passed the loot filter for %s.",
    thisBoss = "this boss",
    anItem = "an item",
    waiting = "Loot Master: the boss loot starts once the running session ends.",
}

local open = {} -- rolls CRT passed or rolled, waiting for the game to close them: { [rollID] = text }
local toldKill -- the kill (its time) a raider was last told about a roll CRT didn't pass
local collected, collectRun = {}, 0 -- the leader's rolled items since the last session: { link }
local waiting = {} -- sessions to start once the running one ends: { items }

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- The item as chat shows it: its link, else its name, else "an item".
local function itemText(rollID)
    local ok, link = pcall(GetLootRollItemLink, rollID)
    if ok and type(link) == "string" and not secret(link) and link ~= "" then
        return link, link
    end
    local okI, _, name = pcall(GetLootRollItemInfo, rollID)
    if okI and type(name) == "string" and not secret(name) and name ~= "" then
        return name
    end
    return TEXT.anItem
end

-- What the game allows you to roll: { canNeed, canGreed, canTransmog }, each exactly true or false, or nil
-- when it can't be read. A secret value counts as not allowed.
local function rollInfo(rollID)
    local ok, _, name, _, _, _, canNeed, canGreed, _, _, _, _, _, canTransmog = pcall(GetLootRollItemInfo, rollID)
    if not ok or name == nil then
        return nil
    end
    local function yes(v)
        return not secret(v) and (v == true or v == 1)
    end
    return { canNeed = yes(canNeed), canGreed = yes(canGreed), canTransmog = yes(canTransmog) }
end

-- The roll as the gates read it.
local function rollOf(rollID)
    local kill = LM:LastKill()
    return { id = rollID, instance = LM.InstanceKey(), bossInstance = kill and kill.instance or nil, test = false }, kill
end

-- A boss's roll in the raid instance you are in (a kill there within LM.BOSS_SECONDS).
local function bossRoll(roll)
    return roll.instance ~= nil and roll.bossInstance == roll.instance
end

-- Waits CLOSE_SECONDS for the game to close the roll; says so when it doesn't.
local function watchClose(rollID, line)
    open[rollID] = line
    C_Timer.After(LM.CLOSE_SECONDS, function()
        local text = open[rollID]
        if text then
            open[rollID] = nil
            CRT:Print(text)
        end
    end)
end

-- The leader's session ------------------------------------------------------------------------------------

-- Short item strings: the link's "item:..." with its empty tail dropped, so a message stays small.
local function itemString(link)
    local s = type(link) == "string" and link:match("|H(item:[^|]+)|h")
    return s and (s:gsub(":+$", "")) or nil
end

local function startNext()
    if LM.current or #waiting == 0 then
        return
    end
    LM:Start(table.remove(waiting, 1))
end

-- The collected items through the loot filter, into one session (or more, LM.MAX_ITEMS each).
local function flush()
    local list = collected
    collected = {}
    local items = {}
    for _, link in ipairs(list) do
        local s = itemString(link)
        if s and LM:FilterLoot(s, "boss", link) then
            local ok, ilvl = pcall(C_Item.GetDetailedItemLevelInfo, link)
            items[#items + 1] = { itemString = s, link = link, ilvl = (ok and type(ilvl) == "number" and not secret(ilvl)) and ilvl or nil }
        end
    end
    if #items == 0 then
        CRT:Print(TEXT.noLoot:format(LM:RecentBoss() or TEXT.thisBoss))
        return
    end
    for i = 1, #items, LM.MAX_ITEMS do
        local chunk = {}
        for j = i, math.min(#items, i + LM.MAX_ITEMS - 1) do
            chunk[#chunk + 1] = items[j]
        end
        waiting[#waiting + 1] = chunk
    end
    if LM.current then
        CRT:Print(TEXT.waiting)
    end
    startNext()
end

local function collect(link)
    if not link then
        return
    end
    collected[#collected + 1] = link
    collectRun = collectRun + 1
    local run = collectRun
    C_Timer.After(LM.COLLECT_SECONDS, function()
        if run == collectRun then
            flush()
        end
    end)
end

LM:OnChange(function(what)
    if what == "ended" then
        startNext()
    end
end)

-- The roll events ----------------------------------------------------------------------------------------

local function raiderRoll(rollID, roll, kill, state)
    local ok, why = AutoPass:ShouldPass(state, roll)
    if ok then
        local text = itemText(rollID)
        local done, err = AutoPass:Pass(rollID, state.passed)
        if done then
            CRT:Print(TEXT.passed:format(text, Ambiguate(state.leader, "short")))
            watchClose(rollID, TEXT.passKept:format(text))
        elseif err ~= "once" then
            CRT:Print(TEXT.passFailed:format(text, err))
        end
        return
    end
    -- said once per kill, only while the leader's word is on, only for a boss's roll here
    if why == "once" or not LM:LootingHeardOn() or not bossRoll(roll) or (kill and toldKill == kill.at) then
        return
    end
    toldKill = kill and kill.at
    CRT:Print(TEXT.notPassed:format(itemText(rollID), AutoPass.WHY[why] or why))
end

local function leaderRoll(rollID, roll, state)
    local rollType, why = AutoPass:LeaderRoll(state, roll, rollInfo(rollID))
    local text, link = itemText(rollID)
    if rollType then
        local done, err = AutoPass:Roll(rollID, rollType, state.rolled)
        if done then
            CRT:Print(TEXT.rolled:format(AutoPass.ROLL_NAME[rollType], text))
            watchClose(rollID, TEXT.rollKept:format(text))
            collect(link)
        elseif err ~= "once" then
            CRT:Print(TEXT.rollFailed:format(text, err))
        end
        return
    end
    if why == "once" or not state.leading or not bossRoll(roll) then
        return
    end
    CRT:Print(TEXT.notRolled:format(text, AutoPass.LEADER_WHY[why] or why))
end

local function started(rollID)
    if secret(rollID) or type(rollID) ~= "number" then
        return -- fail closed: no roll to act on
    end
    local roll, kill = rollOf(rollID)
    local state = LM:LootingState()
    if state.me ~= nil and state.me == state.leader then
        leaderRoll(rollID, roll, state)
    else
        raiderRoll(rollID, roll, kill, state)
    end
end

local function confirm(rollID, rollType)
    if secret(rollID) or secret(rollType) then
        return
    end
    local ok, why = AutoPass:Confirm(rollID, rollType, LM:LootingState().rolled)
    if ok or why == "notmine" or why == "once" then
        return -- a roll you made yourself is left to you, silently
    end
    local text = itemText(rollID)
    if why == "type" then
        CRT:Print(TEXT.confirmType:format(text))
    else
        CRT:Print(TEXT.confirmFailed:format(text, why))
    end
end

local events = CreateFrame("Frame")
for _, e in ipairs({ "START_LOOT_ROLL", "CANCEL_LOOT_ROLL", "CANCEL_ALL_LOOT_ROLLS", "CONFIRM_LOOT_ROLL" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event, a1, a2)
    if event == "START_LOOT_ROLL" then
        started(a1)
    elseif event == "CANCEL_LOOT_ROLL" then
        if not secret(a1) and a1 ~= nil then
            open[a1] = nil
        end
    elseif event == "CANCEL_ALL_LOOT_ROLLS" then
        open = {}
    elseif event == "CONFIRM_LOOT_ROLL" then
        confirm(a1, a2)
    end
end)
