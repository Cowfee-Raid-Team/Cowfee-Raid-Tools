local ADDON, CRT = ...

-- The game's group loot rolls while CRT Looting is on. Design: decisions/2026-10-18 Cowfee Raid Tools Loot
-- Master.md ("Auto-pass reliability", "The looter") in the vault.
--   A raider: on START_LOOT_ROLL, straight away, the gate (AutoPass:ShouldPass) decides and AutoPass:Pass
--     passes the roll. If the game hasn't closed the roll (CANCEL_LOOT_ROLL) within CLOSE_SECONDS, chat
--     says so and the game's roll frame stays up for you. A roll refused only because the leader's
--     heartbeat was late ("quiet") is tried once more when the leader's next word arrives, while the
--     game still has time on it (GetLootRollTimeLeft) and you haven't rolled it yourself.
--   The raid leader (the looter): AutoPass:LeaderRoll picks Need, else Greed, else Transmog, and
--     AutoPass:Roll rolls it. The game's "are you sure" (CONFIRM_LOOT_ROLL) is answered only for a roll
--     CRT's own call made, with the same type, within CLOSE_SECONDS, and not reported kept open. Each boss
--     roll goes on the Boss loot list (LootMaster/BossLoot.lua): the leader picks what goes into the
--     session there. A boss item CRT can't roll on is a red row and a chat warning.
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
--   GetLootRollTimeLeft(rollID): the time left, or nil: https://warcraft.wiki.gg/wiki/API_GetLootRollTimeLeft
--     (its unit is unclear there; Blizzard's GroupLootFrame_OnUpdate sets it on a bar whose max is
--     START_LOOT_ROLL's rollTime). Only "more than 0" is used here.

local LM = CRT.LootMaster
local AutoPass = LM.AutoPass
local BL = LM.BossLoot

LM.CLOSE_SECONDS = AutoPass.CLOSE_SECONDS

local TEXT = {
    passed = "CRT Looting passed %s for %s.",
    passKept = "CRT Looting couldn't pass %s (the game kept the roll open), so roll it yourself.",
    passFailed = "CRT Looting couldn't pass %s (%s), so roll it yourself.",
    notPassed = "CRT Looting didn't pass %s: %s, so roll it yourself.",
    waitingWord = "CRT Looting is waiting for word from the raid leader on %s; roll it yourself if you'd rather not wait.",
    rolled = "CRT Looting rolled %s on %s.",
    rollKept = "CRT Looting couldn't roll on %s (the game kept the roll open), so roll it yourself.",
    rollFailed = "CRT Looting couldn't roll on %s (%s), so roll it yourself.",
    notRolled = "CRT Looting didn't roll on %s: %s, so roll it yourself.",
    cantRoll = "CRT Looting: you can't roll on %s (%s); tell the raid to roll on it.",
    noLink = "Loot Master couldn't read the link of %s, so it isn't on the boss loot list.",
    confirmType = "CRT Looting didn't confirm %s: the game asked about another kind of roll, so answer it yourself.",
    confirmFailed = "CRT Looting couldn't confirm %s (%s), so answer it yourself.",
    anItem = "an item",
}

local open = {} -- rolls CRT passed or rolled, waiting for the game to close them: { [rollID] = text }
local toldKill -- the kill (its time) a raider was last told about a roll CRT didn't pass
local toldLeader = {} -- the leader's "didn't roll" lines said: { [reason] = the kill's time }
local quiet = {} -- a raider's rolls refused only for a quiet leader: { [rollID] = { roll, text } }

-- The short word a red Boss loot row shows (the whole reason goes to chat).
local SHORT = { cant = "the game doesn't allow it", noinfo = "no roll info", failed = "the roll call failed" }

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- The item as chat shows it: its link, else its name, else "an item"; the link second when there is one.
local function itemText(rollID)
    local ok, link = pcall(GetLootRollItemLink, rollID)
    if ok and not secret(link) and type(link) == "string" and link ~= "" then
        return link, link
    end
    local okI, _, name = pcall(GetLootRollItemInfo, rollID)
    if okI and not secret(name) and type(name) == "string" and name ~= "" then
        return name
    end
    return TEXT.anItem
end

-- What the game allows you to roll: { canNeed, canGreed, canTransmog }, each exactly true or false, or nil
-- when it can't be read. A secret value counts as not allowed.
local function rollInfo(rollID)
    local ok, _, name, _, _, _, canNeed, canGreed, _, _, _, _, _, canTransmog = pcall(GetLootRollItemInfo, rollID)
    if not ok or secret(name) or type(name) ~= "string" then
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

-- Waits CLOSE_SECONDS for the game to close the roll; says so when it doesn't (and runs onKept).
local function watchClose(rollID, line, onKept)
    open[rollID] = line
    C_Timer.After(LM.CLOSE_SECONDS, function()
        local text = open[rollID]
        if text then
            open[rollID] = nil
            if onKept then
                onKept()
            end
            CRT:Print(text)
        end
    end)
end

-- The raider -------------------------------------------------------------------------------------------

local function pass(rollID, text, state)
    local done, err = AutoPass:Pass(rollID, state.passed)
    if done then
        CRT:Print(TEXT.passed:format(text, Ambiguate(state.leader, "short")))
        watchClose(rollID, TEXT.passKept:format(text))
    elseif err ~= "once" then
        CRT:Print(TEXT.passFailed:format(text, err))
    end
end

local function raiderRoll(rollID, roll, kill, state)
    local text = itemText(rollID)
    local ok, why = AutoPass:ShouldPass(state, roll)
    if ok then
        pass(rollID, text, state)
        return
    end
    if why == "quiet" then
        quiet[rollID] = { roll = roll, text = text }
        -- tried again on the leader's next word, so said for each roll, not once per kill
        if LM:LootingHeardOn() and bossRoll(roll) then
            CRT:Print(TEXT.waitingWord:format(text))
        end
        return
    end
    -- said once per kill, only while the leader's word is on, only for a boss's roll here
    if why == "once" or not LM:LootingHeardOn() or not bossRoll(roll) or (kill and toldKill == kill.at) then
        return
    end
    toldKill = kill and kill.at
    CRT:Print(TEXT.notPassed:format(text, AutoPass.WHY[why] or why))
end

-- The leader's next word (O, H or F): each roll refused for a quiet leader is tried once more, while the
-- game still has time on it.
local function retryQuiet()
    local list = quiet
    quiet = {}
    for rollID, q in pairs(list) do
        local okT, left = pcall(GetLootRollTimeLeft, rollID)
        if okT and not secret(left) and type(left) == "number" and left > 0 then
            local state = LM:LootingState()
            if state.me ~= state.leader and AutoPass:ShouldPass(state, q.roll) then
                pass(rollID, q.text, state)
            end
        end
    end
end

-- The leader -------------------------------------------------------------------------------------------

-- The leader's "didn't roll" line, once per kill for each reason.
local function tellLeader(why, kill, line)
    local at = kill and kill.at or true
    if toldLeader[why] == at then
        return
    end
    toldLeader[why] = at
    CRT:Print(line)
end

local function addRow(rollID, text, link, fields, kill)
    if not BL:Add(rollID, link, fields, kill) then
        CRT:Print(TEXT.noLink:format(text))
    end
end

local function leaderRoll(rollID, roll, kill, state)
    local rollType, why = AutoPass:LeaderRoll(state, roll, rollInfo(rollID))
    local text, link = itemText(rollID)
    if rollType then
        local done, err = AutoPass:Roll(rollID, rollType, state.rolled, GetTime())
        if done then
            CRT:Print(TEXT.rolled:format(AutoPass.ROLL_NAME[rollType], text))
            local mine = state.rolled[rollID]
            watchClose(rollID, TEXT.rollKept:format(text), function()
                mine.kept = true -- a confirm after this is never CRT's
            end)
            addRow(rollID, text, link, { status = "rolling", rollType = rollType }, kill)
        elseif err ~= "once" then
            CRT:Print(TEXT.rollFailed:format(text, err))
            addRow(rollID, text, link, { status = "cant", reason = SHORT.failed }, kill)
        end
        return
    end
    if why == "once" or not state.leading or not bossRoll(roll) then
        return
    end
    if why == "cant" or why == "noinfo" then
        CRT:Print(TEXT.cantRoll:format(text, AutoPass.LEADER_WHY[why]))
        addRow(rollID, text, link, { status = "cant", reason = SHORT[why] }, kill)
        return
    end
    tellLeader(why, kill, TEXT.notRolled:format(text, AutoPass.LEADER_WHY[why] or why))
end

-- Events -----------------------------------------------------------------------------------------------

local function started(rollID)
    if secret(rollID) or type(rollID) ~= "number" then
        return -- fail closed: no roll to act on
    end
    local roll, kill = rollOf(rollID)
    local state = LM:LootingState()
    if state.me ~= nil and state.me == state.leader then
        leaderRoll(rollID, roll, kill, state)
    else
        raiderRoll(rollID, roll, kill, state)
    end
end

local function confirm(rollID, rollType)
    if secret(rollID) or secret(rollType) then
        return
    end
    local ok, why = AutoPass:Confirm(rollID, rollType, LM:LootingState().rolled, GetTime())
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

LM:OnChange(function(what)
    if what == "heard" then
        retryQuiet()
    end
end)

local events = CreateFrame("Frame")
for _, e in ipairs({ "START_LOOT_ROLL", "CANCEL_LOOT_ROLL", "CANCEL_ALL_LOOT_ROLLS", "CONFIRM_LOOT_ROLL",
    "PLAYER_ENTERING_WORLD" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event, a1, a2)
    if event == "START_LOOT_ROLL" then
        started(a1)
    elseif event == "CANCEL_LOOT_ROLL" then
        if not secret(a1) and a1 ~= nil then
            open[a1] = nil
            quiet[a1] = nil -- rolled by hand, or over: never passed later
        end
    elseif event == "CANCEL_ALL_LOOT_ROLLS" or event == "PLAYER_ENTERING_WORLD" then
        open, quiet = {}, {}
    elseif event == "CONFIRM_LOOT_ROLL" then
        confirm(a1, a2)
    end
end)
