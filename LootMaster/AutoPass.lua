local ADDON, CRT = ...

-- The auto-pass gate: one pure function that decides whether a raider's CRT may pass a group loot roll.
-- Design: decisions/2026-10-18 Cowfee Raid Tools Loot Master.md ("Auto-pass reliability") in the vault.
-- It reads no game state and no global, and changes nothing it is given: the caller collects every fact
-- (LootMaster/Looting.lua, LM:LootingState) and the harness tries every combination
-- (Tests/run_lootmaster_autopass.js). Any doubt is a no, so the game's own roll frame stays up.
--
-- This file is the only place allowed to call RollOnLoot (the lint in Tests/run_all.sh fails the build if
-- it appears in any other file but the dev probe). It doesn't call it yet: that waits for the in-game
-- proofs (START_LOOT_ROLL in a raid, a pass from an event, CANCEL_LOOT_ROLL closing the frame).
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
