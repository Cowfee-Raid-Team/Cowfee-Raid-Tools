local ADDON, CRT = ...

-- The auto-pass gate: one pure function that decides whether a raider's CRT may pass a group loot roll.
-- Design: decisions/2026-10-18 Cowfee Raid Tools Loot Master.md ("Auto-pass reliability") in the vault.
-- It (and the leader's LeaderRoll) reads no game state and no global, and changes nothing it is given: the caller collects every fact
-- (LootMaster/Looting.lua, LM:LootingState) and the harness tries every combination
-- (CRT_Dev/Tests/run_lootmaster_autopass.js). Any doubt is a no, so the game's own roll frame stays up.
--
-- This file is the only place allowed to call RollOnLoot and ConfirmLootRoll (the lint in
-- CRT_Dev/Tests/run_all.sh fails the build if either appears in any other file but the dev probe):
-- AutoPass:Pass, AutoPass:Roll and AutoPass:Confirm, each in pcall, called by LootMaster/Rolls.lua on the
-- game's roll events. AutoPass:LeaderRoll is the raid leader's own gate, as pure as ShouldPass.
--
-- The game's API, checked 2026-10-20:
--   RollOnLoot(rollID, rollType): https://warcraft.wiki.gg/wiki/API_RollOnLoot gives 0 pass, 1 Need,
--     2 Greed, 3 Disenchant. Blizzard's own roll buttons (Gethe/wow-ui-source,
--     Blizzard_UIPanels_Game/Mainline/GroupLootFrame.xml) call RollOnLoot(rollID, self:GetID()) with
--     PassButton id 0, NeedButton 1, GreedButton 2 and TransmogButton 4: those are the numbers used here.
--   ConfirmLootRoll(rollID, rollType): https://warcraft.wiki.gg/wiki/API_ConfirmLootRoll; Blizzard's
--     CONFIRM_LOOT_ROLL popup (Blizzard_StaticPopup_Game/GameDialogDefs.lua) calls it with the event's
--     rollID and rollType.
--
-- state: test (a test session is running), me and leader (full names; leader nil out of a group),
--   myInstance (your raid instance's key, nil outside a raid instance), finder (false only when you are
--   not in a finder group), inRaid (true in a raid group), enableInParty (your "Enable in party" setting:
--   true lets a party group pass too), on (the leader's last word: true
--   only when it said on), from (who sent it), version (the sender's CRT), yesInstance (the instance it
--   said Yes for), leaderOnline (true only when the game says so), leaderInstance (where its last
--   heartbeat said it was: nil when not in a raid instance), leaderOpenWorld (true only when that
--   heartbeat said the open world), leaderAway (seconds it has been out, counted to now), heartbeatAt and
--   now (GetTime() seconds), passed ({ [rollID] = true }).
-- A leader in the open world (a wipe: dead, released, running back) still counts for up to
-- LM.LOOTING_AWAY seconds; a leader in any other instance never does. You must be in the instance it said
-- Yes for.
-- roll: id (the rollID), test, instance (your instance's key when it started), bossInstance (the
--   instance key of the boss kill it follows, or nil).

local LM = CRT.LootMaster
local AutoPass = {}
LM.AutoPass = AutoPass

AutoPass.STALE = 90 -- seconds after the leader's last heartbeat (sent every 30) before passing stops

-- Words for each reason, for "CRT Looting: off: <why>".
AutoPass.WHY = {
    pass = "on",
    nostate = "nothing known yet",
    test = "a test can't pass",
    notraid = "you are not in a raid instance",
    nogroup = "you are not in a group",
    finder = "a finder group has no raid leader to follow",
    party = "you are in a party, and Enable in party is off",
    looter = "you are the looter",
    unheard = "the raid leader hasn't turned it on",
    off = "the raid leader turned it off",
    notleader = "the message didn't come from the raid leader",
    version = "the raid leader's CRT is too old",
    instance = "the raid leader said Yes for another instance",
    offline = "the raid leader is offline",
    away = "the raid leader is not in this instance",
    quiet = "no word from the raid leader for 90 seconds",
    noroll = "no roll to pass",
    once = "this roll was passed already",
    rollplace = "the roll started outside this instance",
    notboss = "the roll isn't from a boss in this instance",
}

local function isTrue(v)
    return v == true
end

local function key(v)
    return type(v) == "string" and v ~= ""
end

-- The leader's side, every check but the roll's: true, "pass" or false and the first reason that fails.
-- In this order, so the reason given is always the first one.
function AutoPass:Ready(state)
    if type(state) ~= "table" then
        return false, "nostate"
    end
    if state.test then
        return false, "test"
    end
    if not key(state.myInstance) then
        return false, "notraid"
    end
    if not key(state.leader) then
        return false, "nogroup"
    end
    if state.finder ~= false then
        return false, "finder"
    end
    if not (isTrue(state.inRaid) or isTrue(state.enableInParty)) then
        return false, "party"
    end
    if state.me == state.leader then
        return false, "looter"
    end
    if not isTrue(state.on) then
        return false, "off"
    end
    if state.from ~= state.leader then
        return false, "notleader"
    end
    if not LM.VersionAtLeast(state.version, LM.LOOTING_SINCE) then
        return false, "version"
    end
    if state.yesInstance ~= state.myInstance then
        return false, "instance"
    end
    if not isTrue(state.leaderOnline) then
        return false, "offline"
    end
    if state.leaderInstance ~= state.myInstance then
        local away = state.leaderAway
        if state.leaderInstance ~= nil or not isTrue(state.leaderOpenWorld) or type(away) ~= "number"
            or not (away >= 0 and away <= LM.LOOTING_AWAY) then
            return false, "away"
        end
    end
    local at, now = state.heartbeatAt, state.now
    if type(at) ~= "number" or type(now) ~= "number" or now < at or now - at > AutoPass.STALE then
        return false, "quiet"
    end
    return true, "pass"
end

-- Whether to pass this roll: true, "pass" or false and the first reason that fails. A test is a no
-- before anything else.
function AutoPass:ShouldPass(state, roll)
    if (type(roll) == "table" and roll.test) or (type(state) == "table" and state.test) then
        return false, "test"
    end
    local ok, why = self:Ready(state)
    if not ok then
        return false, why
    end
    if type(roll) ~= "table" or type(roll.id) ~= "number" then
        return false, "noroll"
    end
    if type(state.passed) == "table" and state.passed[roll.id] then
        return false, "once"
    end
    if roll.instance ~= state.myInstance then
        return false, "rollplace"
    end
    if roll.bossInstance ~= state.myInstance then
        return false, "notboss"
    end
    return true, "pass"
end

-- The raid leader's side ------------------------------------------------------------------------------

-- The roll types (see the top of this file), and the words for the ones the leader's CRT makes.
AutoPass.ROLL = { pass = 0, need = 1, greed = 2, disenchant = 3, transmog = 4 }
AutoPass.ROLL_NAME = { [1] = "Need", [2] = "Greed", [4] = "Transmog" }

-- Words for why the leader's CRT didn't roll: "CRT Looting didn't roll on [item]: <why>".
AutoPass.LEADER_WHY = {
    nostate = AutoPass.WHY.nostate,
    test = "a test session is running",
    notraid = AutoPass.WHY.notraid,
    notleader = "you are not the raid leader",
    off = "your CRT Looting is off",
    instance = "you said Yes for another instance",
    noroll = AutoPass.WHY.noroll,
    once = "CRT rolled on it already",
    rollplace = AutoPass.WHY.rollplace,
    notboss = AutoPass.WHY.notboss,
    noinfo = "the game didn't say which rolls you may make",
    cant = "the game allows no Need, Greed or Transmog on it",
}

-- The raid leader's roll, when its raiders pass: Need when the game allows it, else Greed, else
-- Transmog. state (LM:LootingState): test, me, leader, myInstance, leading (your own CRT Looting is on),
-- leadingInstance (the instance you said Yes for), rolled ({ [rollID] = { type } }). roll: as ShouldPass's.
-- info: canNeed, canGreed, canTransmog (exactly true when allowed). Returns the roll type and its key
-- ("need", "greed", "transmog"), or false and the first reason that fails (LEADER_WHY). A test is a no
-- before anything else. The same boss and instance checks as ShouldPass, so the leader rolls on what its
-- raiders pass.
function AutoPass:LeaderRoll(state, roll, info)
    if (type(roll) == "table" and roll.test) or (type(state) == "table" and state.test) then
        return false, "test"
    end
    if type(state) ~= "table" then
        return false, "nostate"
    end
    if not key(state.myInstance) then
        return false, "notraid"
    end
    if not key(state.me) or state.me ~= state.leader then
        return false, "notleader"
    end
    if not isTrue(state.leading) then
        return false, "off"
    end
    if state.leadingInstance ~= state.myInstance then
        return false, "instance"
    end
    if type(roll) ~= "table" or type(roll.id) ~= "number" then
        return false, "noroll"
    end
    if type(state.rolled) == "table" and state.rolled[roll.id] ~= nil then
        return false, "once"
    end
    if roll.instance ~= state.myInstance then
        return false, "rollplace"
    end
    if roll.bossInstance ~= state.myInstance then
        return false, "notboss"
    end
    if type(info) ~= "table" then
        return false, "noinfo"
    end
    if isTrue(info.canNeed) then
        return self.ROLL.need, "need"
    elseif isTrue(info.canGreed) then
        return self.ROLL.greed, "greed"
    elseif isTrue(info.canTransmog) then
        return self.ROLL.transmog, "transmog"
    end
    return false, "cant"
end

-- The calls --------------------------------------------------------------------------------------------
-- Each marks the roll first (a confirm the game asks for inside the call finds it), so a roll is never
-- tried twice, and calls the game in pcall. Each returns true, or false and "once", "noroll" or the error.

-- Passes this roll for a raider whose gate said yes. passed: the state's passed list (required).
function AutoPass:Pass(rollID, passed)
    if type(rollID) ~= "number" or type(passed) ~= "table" then
        return false, "noroll"
    end
    if passed[rollID] then
        return false, "once"
    end
    passed[rollID] = true
    local ok, err = pcall(RollOnLoot, rollID, self.ROLL.pass)
    if not ok then
        return false, tostring(err)
    end
    return true
end

-- The leader's roll of rollType (Need, Greed or Transmog only). rolled: the state's rolled list (required).
function AutoPass:Roll(rollID, rollType, rolled)
    if type(rollID) ~= "number" or type(rolled) ~= "table" or not self.ROLL_NAME[rollType] then
        return false, "noroll"
    end
    if rolled[rollID] ~= nil then
        return false, "once"
    end
    rolled[rollID] = { type = rollType }
    local ok, err = pcall(RollOnLoot, rollID, rollType)
    if not ok then
        return false, tostring(err)
    end
    return true
end

-- Confirms a roll the game asks about (CONFIRM_LOOT_ROLL), only when CRT made it with this same type and
-- hasn't confirmed it yet: a roll you made by hand is never confirmed. Returns true, or false and
-- "notmine", "type" (CRT made it with another type), "once" or the error.
function AutoPass:Confirm(rollID, rollType, rolled)
    local mine = type(rolled) == "table" and type(rollID) == "number" and rolled[rollID] or nil
    if type(mine) ~= "table" then
        return false, "notmine"
    end
    if mine.type ~= rollType then
        return false, "type"
    end
    if mine.confirmed then
        return false, "once"
    end
    mine.confirmed = true
    local ok, err = pcall(ConfirmLootRoll, rollID, rollType)
    if not ok then
        return false, tostring(err)
    end
    return true
end
