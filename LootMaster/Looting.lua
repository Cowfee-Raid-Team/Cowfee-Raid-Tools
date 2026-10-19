local ADDON, CRT = ...

-- CRT Looting on and off. Design: decisions/2026-10-18 Cowfee Raid Tools Loot Master.md ("Turning it on",
-- "Safety") in the vault. When the raid leader with CRT enters a raid instance, CRT asks "Use CRT Looting
-- in this instance?" (LootMaster/LootingPrompt.lua, through LM.AskLooting). Yes turns it on for everyone in
-- the raid with CRT, No leaves it off; the leader can turn it off and on again from the Tonight tab.
-- Raiders can't change it.
--
-- The on state lives in memory only, never saved: a login, /reload or zone change (another instance, or
-- leaving one) starts it off, for the leader and for raiders, until the leader's next word.
--
-- Messages, on LM.PREFIX like the rest of Loot Master (an older CRT drops a kind it doesn't know):
--   O|<version>|<instance>               on: the leader said Yes for this instance
--   F|<version>|<why>                    off: no (said No), off (turned off), left (left the instance),
--                                        lead (no longer the leader)
--   H|<version>|<instance>|<instance>    the heartbeat, every HEARTBEAT_SECONDS while on: the instance it
--                                        said Yes for, then the one the leader is in now
-- An instance is "<instanceID>-<difficultyID>" (GetInstanceInfo). A raider takes these only from its
-- current raid leader. During an encounter addon messages are held, so no heartbeat is queued then; one
-- goes out when the encounter ends.
--
-- Nothing here passes a roll: LM:LootingState() collects the facts the auto-pass gate
-- (LootMaster/AutoPass.lua) needs, and the state line says what the gate would say.

local LM = CRT.LootMaster
local AutoPass = LM.AutoPass
local Wire = LM.Wire

LM.HEARTBEAT_SECONDS = 30
LM.LOOTING_TICK = 5 -- seconds between a raider's checks for a quiet leader

local TEXT = {
    line = "CRT Looting: %s",
    raiderOn = "on (leader %s)",
    leaderOn = "on for everyone in the raid with CRT",
    off = "off",
    offWhy = "off: %s",
    saidNo = "you said No",
    turnedOn = "CRT Looting: on for everyone in the raid with CRT.",
    turnedOff = "CRT Looting: off for everyone.",
    left = "CRT Looting: off, you left the instance.",
    lead = "CRT Looting: off: %s.",
    cant = "CRT Looting: can't turn it on: %s.",
    notLead = "you are not the raid leader",
    finder = "a finder group has no raid leader to follow",
}

-- Why the leader turned it off, as a raider reads it (F's <why>); anything else is just off.
local OFF_WHY = {
    no = "the raid leader said No",
    off = AutoPass.WHY.off,
    left = "the raid leader left the instance",
    lead = "the raid leader changed",
}

local own = { on = false } -- the leader's choice: on, instance (the key it said Yes for), why (when off)
local heard -- a raider's last word from the leader: { from, on, version, yes, here, at, why }
local passed = {} -- rolls passed in this instance: { [rollID] = true } (filled by the gate's caller, later)
local lastKey = false -- the instance key last seen (false: none seen yet since loading)
local askedFor -- the instance key the leader was last asked about
local inEncounter = false
local beatTicker, watchTicker
local lastOk -- what a raider's chat line last said: true on, false off

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

-- Your raid instance as "<instanceID>-<difficultyID>", or nil outside a raid instance.
function LM.InstanceKey()
    local inside, kind = IsInInstance()
    if secret(inside) or secret(kind) or not inside or kind ~= "raid" then
        return nil
    end
    local _, _, difficulty, _, _, _, _, id = GetInstanceInfo()
    if secret(id) or secret(difficulty) or type(id) ~= "number" or type(difficulty) ~= "number" then
        return nil
    end
    return string.format("%d-%d", id, difficulty)
end

local function isLeader()
    return IsInGroup() and UnitIsGroupLeader("player") and true or false
end

-- Whether you can turn CRT Looting on: the leader of your own group (not a finder group), in a raid
-- instance. Returns true, or false and the words why not.
function LM:CanRunLooting()
    if not IsInGroup() then
        return false, AutoPass.WHY.nogroup
    end
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return false, TEXT.finder
    end
    if not UnitIsGroupLeader("player") then
        return false, TEXT.notLead
    end
    if not LM.InstanceKey() then
        return false, AutoPass.WHY.notraid
    end
    return true
end

function LM:LootingOn()
    return own.on == true
end

-- Leader -----------------------------------------------------------------------------------------------

local function locked()
    if C_ChatInfo and C_ChatInfo.InChatMessagingLockdown then
        local ok, yes = pcall(C_ChatInfo.InChatMessagingLockdown)
        return ok and yes == true
    end
    return false
end

local function stopBeat()
    if beatTicker then
        beatTicker:Cancel()
        beatTicker = nil
    end
end

local function beat()
    if not own.on then
        stopBeat()
        return
    end
    if locked() then
        return -- held messages would pile up; ENCOUNTER_END sends a fresh one
    end
    LM.SendText(Wire.Encode("H", { LM.VERSION, own.instance, LM.InstanceKey() or "" }))
end

-- Turns CRT Looting on or off for everyone (the leader only, in a raid instance, to turn it on). why
-- (when off): "no", "off", "left" or "lead" (words: what you lost, for "lead"). Returns whether it
-- changed anything.
function LM:SetLooting(on, why, words)
    if on then
        local ok, whyNot = self:CanRunLooting()
        if not ok then
            CRT:Print(string.format(TEXT.cant, whyNot))
            return false
        end
        own.on, own.instance, own.why = true, LM.InstanceKey(), nil
        LM.SendText(Wire.Encode("O", { LM.VERSION, own.instance }))
        if not beatTicker then
            beatTicker = C_Timer.NewTicker(LM.HEARTBEAT_SECONDS, beat)
        end
        CRT:Print(TEXT.turnedOn)
    else
        why = why or "off"
        own.on, own.instance, own.why = false, nil, why
        stopBeat()
        LM.SendText(Wire.Encode("F", { LM.VERSION, why }))
        CRT:Print(why == "left" and TEXT.left or (why == "lead" and TEXT.lead:format(words or TEXT.notLead) or TEXT.turnedOff))
    end
    LM:Fire("looting")
    return true
end

-- Raider -----------------------------------------------------------------------------------------------

-- Everything the auto-pass gate needs, read now (AutoPass.lua lists the fields).
function LM:LootingState()
    local leader = LM.LeaderName()
    local online
    local unit = leader and LM.UnitOf(leader)
    if unit then
        local ok, v = pcall(UnitIsConnected, unit)
        if ok and not secret(v) then
            online = v == true
        end
    end
    local h = heard or {}
    local test = (LM.current and LM.current.test) or (LM.incoming and LM.incoming.test)
    return {
        test = test and true or false, me = LM:Me(), leader = leader, myInstance = LM.InstanceKey(),
        on = h.on == true, from = h.from, version = h.version, yesInstance = h.yes, leaderOnline = online,
        leaderInstance = h.here, heartbeatAt = h.on and h.at or nil, now = GetTime(), passed = passed,
    }
end

-- The one-line state: "CRT Looting: on (leader X)" or "CRT Looting: off: <why>", and whether it is on.
function LM:LootingStatus()
    if isLeader() then
        local ok, whyNot = self:CanRunLooting()
        if own.on then
            return TEXT.line:format(TEXT.leaderOn), true
        elseif not ok then
            return TEXT.line:format(TEXT.offWhy:format(whyNot)), false
        elseif own.why == "no" then
            return TEXT.line:format(TEXT.offWhy:format(TEXT.saidNo)), false
        end
        return TEXT.line:format(TEXT.off), false
    end
    local state = self:LootingState()
    state.test = false -- the line is about the leader; a test only stops the pass itself
    local ok, why = AutoPass:Ready(state)
    if ok then
        return TEXT.line:format(TEXT.raiderOn:format(Ambiguate(state.leader, "short"))), true
    end
    local words = AutoPass.WHY[why] or why
    if why == "off" then
        words = not heard and AutoPass.WHY.unheard or (OFF_WHY[heard.why] or AutoPass.WHY.off)
    end
    return TEXT.line:format(TEXT.offWhy:format(words)), false
end

local function stopWatch()
    if watchTicker then
        watchTicker:Cancel()
        watchTicker = nil
    end
end

-- Says the raider's line in chat when on turns to off or back (force: say it anyway, for the leader's
-- off). Not during an encounter, when the heartbeat is held: it is checked again when it ends.
local function report(force)
    if isLeader() then
        return
    end
    local line, ok = LM:LootingStatus()
    if not force and (inEncounter or ok == (lastOk or false)) then
        if not inEncounter then
            lastOk = ok
        end
        return
    end
    lastOk = ok
    CRT:Print(line)
end

local function watch()
    report(false)
    if not (heard and heard.on) then
        stopWatch()
    end
end

-- A message from the leader: only from the current raid leader, never your own coming back.
local function fromLeader(sender)
    return sender and sender ~= LM:Me() and sender == LM.LeaderName()
end

local function hear(entry)
    heard = entry
    if heard.on and not watchTicker then
        watchTicker = C_Timer.NewTicker(LM.LOOTING_TICK, watch)
    end
    LM:Fire("looting")
end

LM.Handle("O", function(f, sender)
    if not fromLeader(sender) or (f[2] or "") == "" then
        return
    end
    hear({ from = sender, on = true, version = f[1], yes = f[2], here = f[2], at = GetTime() })
    report(false)
end)

LM.Handle("H", function(f, sender)
    if not fromLeader(sender) or (f[2] or "") == "" or (f[3] or "") == "" then
        return
    end
    hear({ from = sender, on = true, version = f[1], yes = f[2], here = f[3], at = GetTime() })
    report(false)
end)

LM.Handle("F", function(f, sender)
    if not fromLeader(sender) then
        return
    end
    hear({ from = sender, on = false, version = f[1], why = f[2], at = GetTime() })
    stopWatch()
    report(true)
end)

-- Events -----------------------------------------------------------------------------------------------

-- Asks the leader once per entry into a raid instance (also on becoming the leader inside).
local function maybeAsk()
    if lastKey and askedFor ~= lastKey and not own.on and LM:CanRunLooting() then
        askedFor = lastKey
        if LM.AskLooting then
            LM.AskLooting()
        end
    end
end

-- A loading screen or a new zone: another instance (or none) starts off, for the leader and raiders.
local function zoned()
    local key = LM.InstanceKey()
    if key == lastKey then
        return
    end
    lastKey, askedFor = key, nil
    passed = {}
    heard = nil
    stopWatch()
    if own.on then
        LM:SetLooting(false, "left")
    end
    if LM.HideLootingPrompt then
        LM.HideLootingPrompt()
    end
    report(false)
    LM:Fire("looting")
    maybeAsk()
end

local function regrouped()
    local ok, whyNot = LM:CanRunLooting()
    if own.on and not ok then
        LM:SetLooting(false, "lead", whyNot)
    end
    report(false)
    LM:Fire("looting")
    maybeAsk()
end

local events = CreateFrame("Frame")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA", "GROUP_ROSTER_UPDATE", "PARTY_LEADER_CHANGED",
    "ENCOUNTER_START", "ENCOUNTER_END" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA" then
        zoned()
    elseif event == "ENCOUNTER_START" then
        inEncounter = true
    elseif event == "ENCOUNTER_END" then
        inEncounter = false
        beat()
        report(false)
    else
        regrouped()
    end
end)
