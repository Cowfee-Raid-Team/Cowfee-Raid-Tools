local ADDON, CRT = ...

-- CRT Looting on and off. Design: decisions/2026-10-18 Cowfee Raid Tools Loot Master.md ("Turning it on",
-- "Safety") in the vault. When the raid leader with CRT enters a raid instance, CRT asks "Use CRT Looting
-- in this instance?" (LootMaster/LootingPrompt.lua, through LM.AskLooting). Yes turns it on for everyone in
-- the raid with CRT, No leaves it off; the leader can turn it off and on again from the Tonight tab.
-- Raiders can't change it. A party group counts only with "Enable in party" (Settings), on both sides; a
-- finder group never does.
--
-- The leader's Yes is saved (CRTDB lootmaster.looting: on, the instance, who said it, and at, when it was
-- last confirmed: on Yes and each heartbeat in that instance), so it stays on through a /reload or login
-- until it is turned off or a safety off happens. The leader's first loading screen brings it back on,
-- with no prompt, an O and a heartbeat, when it is still the leader, the same character, in that instance
-- (or in the open world, a wipe's run back, the time away counted from at) and within LM.LOOTING_AWAY of
-- at; otherwise the saved state is cleared and raiders are told it starts off ("reload"). Raiders save
-- nothing: after their own /reload they are off until the leader's next O or heartbeat.
-- A wipe keeps it on: the leader may be in the open world (dead, released, running back) for up to
-- LM.LOOTING_AWAY seconds, and isn't asked again on the way back in. It turns off (and the saved state is
-- cleared) when the leader stays out longer, enters any other instance (a dungeon, delve, scenario,
-- battleground, arena, house or another raid), leaves the group, loses the lead, or turns it off. Only
-- IsInInstance's "none" is the open world.
--
-- Messages, on LM.PREFIX like the rest of Loot Master (an older CRT drops a kind it doesn't know):
--   O|<version>|<instance>                       on: the leader said Yes for this instance
--   F|<version>|<why>                            off: no (said No), off (turned off), instance (entered
--                                                another instance), away (out too long), lead (can't
--                                                lead it any more), party (Enable in party turned off),
--                                                reload (the leader's login or /reload, when its
--                                                saved Yes doesn't bring it back on)
--   H|<version>|<instance>|<instance>|<seconds>  the heartbeat, every HEARTBEAT_SECONDS while on: the
--                                                instance it said Yes for, where the leader is now (that
--                                                instance, or "world" for the open world), and the
--                                                seconds it has been out
-- An instance is "<instanceID>-<difficultyID>" (GetInstanceInfo). A raider takes these only from its
-- current raid leader, and forgets the leader's word when the lead moves or the leader goes offline.
-- Combat never stops a heartbeat; only the game's chat lockdown (a boss encounter) holds one, and a fresh
-- one goes out when the encounter ends (tried every BEAT_RETRY seconds while the lockdown lasts, for up
-- to BEAT_RETRIES tries) and when combat ends. A click that needs a message during the lockdown shows red error
-- text and does nothing.
--
-- Nothing here passes a roll: LM:LootingState() collects the facts the auto-pass gate
-- (LootMaster/AutoPass.lua) needs, and the state line says what the gate would say. The game's roll
-- events are handled in LootMaster/Rolls.lua.

local LM = CRT.LootMaster
local AutoPass = LM.AutoPass
local Wire = LM.Wire

LM.HEARTBEAT_SECONDS = 30
LM.LOOTING_TICK = 5 -- seconds between a raider's checks for a quiet or offline leader
LM.QUIET_GRACE = 10 -- seconds after an encounter before a quiet leader is reported in chat
LM.BEAT_RETRY = 2 -- seconds between tries of the heartbeat after an encounter, while chat is still locked
LM.BEAT_RETRIES = 10

local TEXT = {
    line = "CRT Looting: %s",
    raiderOn = "on (leader %s)",
    leaderOn = "on for everyone in the raid with CRT",
    off = "off",
    offWhy = "off: %s",
    saidNo = "you said No",
    turnedOn = "CRT Looting: on for everyone in the raid with CRT.",
    stillOn = "CRT Looting: still on for everyone in the raid with CRT.",
    turnedOff = "CRT Looting: off for everyone.",
    instance = "CRT Looting: off, you entered another instance.",
    away = "CRT Looting: off, you were out of the instance for over 10 minutes.",
    lead = "CRT Looting: off: %s.",
    cant = "CRT Looting: can't turn it on: %s.",
    notLead = "you are not the raid leader",
}

-- Why the leader turned it off, as a raider reads it (F's <why>); anything else is just off.
local OFF_WHY = {
    no = "the raid leader said No",
    off = AutoPass.WHY.off,
    instance = "the raid leader entered another instance",
    away = "the raid leader was out of the instance for over 10 minutes",
    lead = "the raid leader changed",
    party = "Enable in party was turned off",
    reload = "the raid leader reloaded",
}
-- Why a raider forgot the leader's word.
local FORGOT = { lead = OFF_WHY.lead, offline = AutoPass.WHY.offline }

local own = { on = false } -- the leader's choice: on, instance (said Yes for), why (when off), awaySince
local heard -- a raider's last word from the leader: { from, on, version, yes, here, world, away, at, why }
local forgot -- why heard was dropped (FORGOT's keys), until the leader's next word
-- rolls passed (a raider) or rolled (the leader: { type, confirmed }) in the raid instance passedIn
local passed, rolled, passedIn = {}, {}, nil
local lastKey = false -- the raid instance key last seen (false: no loading screen yet since loading)
local lastPlace = false -- where you were last seen: a raid instance's key, "world" or "elsewhere"
local askedFor -- the raid instance the leader was last asked about
local inEncounter, endedAt = false, nil
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

-- Whether you are in the open world: IsInInstance's "none". Anything else (or unreadable) is an instance.
local function openWorld()
    local inside, kind = IsInInstance()
    if secret(inside) or secret(kind) then
        return false
    end
    return not inside and kind == "none"
end

-- Where you are: your raid instance's key, "world" for the open world, or "elsewhere" (any other instance).
local function place()
    return LM.InstanceKey() or (openWorld() and "world" or "elsewhere")
end

local function isLeader()
    return IsInGroup() and UnitIsGroupLeader("player") and true or false
end

local function enableInParty()
    local set = LM:Settings()
    return type(set) == "table" and set.enableInParty == true
end

-- Whether you may lead CRT Looting wherever you are: the leader of your own raid (or party, with Enable
-- in party), not a finder group. Returns true, or false and the words why not.
local function canLead()
    if not IsInGroup() then
        return false, AutoPass.WHY.nogroup
    end
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return false, AutoPass.WHY.finder
    end
    if not UnitIsGroupLeader("player") then
        return false, TEXT.notLead
    end
    if not IsInRaid() and not enableInParty() then
        return false, AutoPass.WHY.party
    end
    return true
end

-- Whether you can turn CRT Looting on now: you may lead it, and you are in a raid instance.
function LM:CanRunLooting()
    local ok, why = canLead()
    if not ok then
        return false, why
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

-- The leader's saved Yes (CRTDB lootmaster.looting; its default is in CRT_Core/Core.lua), made if missing.
local function saved()
    local set = LM:Settings()
    if type(set) ~= "table" then
        return nil
    end
    if type(set.looting) ~= "table" then
        set.looting = {}
    end
    return set.looting
end

-- Saves the leader's on state (own) now, or clears it when off.
local function save()
    local s = saved()
    if not s then
        return
    end
    if own.on then
        s.on, s.instance, s.at, s.who = true, own.instance, time(), LM:Me()
    else
        s.on, s.instance, s.at, s.who = false, "", 0, ""
    end
end

local function stopBeat()
    if beatTicker then
        beatTicker:Cancel()
        beatTicker = nil
    end
end

local beat -- set below

-- Turns CRT Looting on or off for everyone (the leader only, in a raid instance, to turn it on). why
-- (when off): one of F's reasons (words: what you lost, for "lead"). Returns whether it changed anything.
-- Called by CRT itself; a click goes through LM:ChooseLooting.
function LM:SetLooting(on, why, words)
    if on then
        local ok, whyNot = self:CanRunLooting()
        if not ok then
            CRT:Print(string.format(TEXT.cant, whyNot))
            return false
        end
        own.on, own.instance, own.why, own.awaySince = true, LM.InstanceKey(), nil, nil
        save()
        LM.SendText(Wire.Encode("O", { LM.VERSION, own.instance }))
        if not beatTicker then
            beatTicker = C_Timer.NewTicker(LM.HEARTBEAT_SECONDS, beat)
        end
        CRT:Print(TEXT.turnedOn)
    else
        why = why or "off"
        own.on, own.instance, own.why, own.awaySince = false, nil, why, nil
        save()
        stopBeat()
        LM.SendText(Wire.Encode("F", { LM.VERSION, why }))
        local line = TEXT.turnedOff
        if why == "instance" then
            line = TEXT.instance
        elseif why == "away" then
            line = TEXT.away
        elseif why == "lead" then
            line = TEXT.lead:format(words or TEXT.notLead)
        end
        CRT:Print(line)
    end
    LM:Fire("looting")
    return true
end

-- A click on Yes, No, Turn on or Turn off for everyone: during the chat lockdown of a boss encounter the
-- message can't go, so it shows red error text and does nothing (returns false, "locked").
function LM:ChooseLooting(on, why)
    if LM.ChatLocked() then
        LM.ShowError(LM.LOCKDOWN_ERROR)
        return false, "locked"
    end
    return self:SetLooting(on, why)
end

beat = function()
    if not own.on then
        stopBeat()
        return
    end
    local away = own.awaySince and math.max(0, GetTime() - own.awaySince) or 0
    if away > LM.LOOTING_AWAY then
        LM:SetLooting(false, "away")
        return
    end
    local where = place()
    if where == own.instance then
        save() -- confirmed again: in the instance it was said Yes for (in an encounter too)
    end
    if LM.ChatLocked() then
        return -- held messages would pile up; ENCOUNTER_END sends a fresh one
    end
    LM.SendText(Wire.Encode("H", { LM.VERSION, own.instance, where ~= "elsewhere" and where or "", math.floor(away) }))
end

-- After an encounter: a heartbeat now, or, while chat is still locked, tried again every BEAT_RETRY
-- seconds, BEAT_RETRIES times at most. A newer encounter's end starts its own tries.
local retryRun = 0
local function beatAfterLockdown()
    retryRun = retryRun + 1
    local run, tries = retryRun, 0
    local function try()
        if run ~= retryRun or not own.on then
            return
        end
        if not LM.ChatLocked() then
            beat()
        elseif tries < LM.BEAT_RETRIES then
            tries = tries + 1
            C_Timer.After(LM.BEAT_RETRY, try)
        end
    end
    try()
end

-- Raider -----------------------------------------------------------------------------------------------

local function stopWatch()
    if watchTicker then
        watchTicker:Cancel()
        watchTicker = nil
    end
end

-- Whether the game says this unit is online: true, false, or nil when it can't tell.
local function online(unit)
    if not unit then
        return nil
    end
    local ok, v = pcall(UnitIsConnected, unit)
    if not ok or secret(v) then
        return nil
    end
    return v == true
end

-- Forgets the leader's word when it no longer counts: the lead moved, or the leader went offline. Only
-- its next word (O or H) turns it back on.
local function checkHeard()
    if not heard then
        return
    end
    local leader = LM.LeaderName()
    if leader ~= nil and heard.from ~= leader then -- a different leader known, not a roster still updating
        heard, forgot = nil, "lead"
    elseif online(LM.UnitOf(leader)) == false then
        heard, forgot = nil, "offline"
    end
    if not heard then
        stopWatch()
    end
end

-- Whether a raider's last word from its raid leader said on: CRT Looting is meant to be on, so a roll it
-- doesn't pass is reported in chat (LootMaster/Rolls.lua). Off, never heard or forgotten: silent.
function LM:LootingHeardOn()
    return heard ~= nil and heard.on == true
end

-- Everything the auto-pass gate and the leader's roll need, read now (AutoPass.lua lists the fields).
function LM:LootingState()
    local leader = LM.LeaderName()
    local h = heard or {}
    local now = GetTime()
    local test = (LM.current and LM.current.test) or (LM.incoming and LM.incoming.test)
    local away
    if h.on and h.here == nil and h.world and type(h.away) == "number" then
        away = h.away + math.max(0, now - h.at)
    end
    return {
        test = test and true or false, me = LM:Me(), leader = leader, myInstance = LM.InstanceKey(),
        finder = IsInGroup(LE_PARTY_CATEGORY_INSTANCE) and true or false, inRaid = IsInRaid() and true or false,
        enableInParty = enableInParty(), on = h.on == true, from = h.from, version = h.version,
        yesInstance = h.yes, leaderOnline = online(leader and LM.UnitOf(leader)), leaderInstance = h.here,
        leaderOpenWorld = h.world == true, leaderAway = away, heartbeatAt = h.on and h.at or nil, now = now, passed = passed,
        leading = own.on == true, leadingInstance = own.on and own.instance or nil, rolled = rolled,
        canLoot = LM:CanLoot() == true,
    }
end

-- The one-line state: "CRT Looting: on (leader X)" or "CRT Looting: off: <why>", whether it is on, and
-- the gate's reason.
function LM:LootingStatus()
    if isLeader() then
        local ok, whyNot = canLead()
        if own.on then
            return TEXT.line:format(TEXT.leaderOn), true, "pass"
        end
        if ok then
            ok, whyNot = self:CanRunLooting()
        end
        if not ok then
            return TEXT.line:format(TEXT.offWhy:format(whyNot)), false, "off"
        elseif own.why == "no" then
            return TEXT.line:format(TEXT.offWhy:format(TEXT.saidNo)), false, "off"
        end
        return TEXT.line:format(TEXT.off), false, "off"
    end
    local state = self:LootingState()
    state.test = false -- the line is about the leader; a test only stops the pass itself
    local ok, why = AutoPass:Ready(state)
    if ok then
        return TEXT.line:format(TEXT.raiderOn:format(Ambiguate(state.leader, "short"))), true, why
    end
    local words = AutoPass.WHY[why] or why
    if why == "off" then
        if heard then
            words = OFF_WHY[heard.why] or AutoPass.WHY.off
        else
            words = FORGOT[forgot] or AutoPass.WHY.unheard
        end
    elseif why == "notleader" then
        words = OFF_WHY.lead
    end
    return TEXT.line:format(TEXT.offWhy:format(words)), false, why
end

-- Says the raider's line in chat when on turns to off or back, and tells the page (force: say it
-- anyway, for the leader's off). Not during an encounter, and a quiet leader not until QUIET_GRACE after
-- one: the heartbeat held by the encounter comes right after it.
local function report(force)
    if isLeader() then
        return
    end
    local line, ok, why = LM:LootingStatus()
    local flipped = ok ~= (lastOk or false)
    if not force then
        if not flipped or inEncounter then
            return
        end
        if why == "quiet" and endedAt and GetTime() - endedAt < LM.QUIET_GRACE then
            return
        end
    end
    lastOk = ok
    CRT:Print(line)
    if flipped then
        LM:Fire("looting")
    end
end

local function watch()
    checkHeard()
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
    heard, forgot = entry, nil
    if heard.on and not watchTicker then
        watchTicker = C_Timer.NewTicker(LM.LOOTING_TICK, watch)
    end
    LM:Fire("looting")
    LM:Fire("heard") -- a roll refused for a quiet leader is tried once more (LootMaster/Rolls.lua)
end

LM.Handle("O", function(f, sender)
    if not fromLeader(sender) or (f[2] or "") == "" then
        return
    end
    hear({ from = sender, on = true, version = f[1], yes = f[2], here = f[2], world = false, away = 0, at = GetTime() })
    report(false)
end)

LM.Handle("H", function(f, sender)
    if not fromLeader(sender) or (f[2] or "") == "" then
        return
    end
    local world = f[3] == "world"
    local here = (not world and (f[3] or "") ~= "") and f[3] or nil
    hear({ from = sender, on = true, version = f[1], yes = f[2], here = here, world = world, away = tonumber(f[4]),
        at = GetTime() })
    report(false)
end)

LM.Handle("F", function(f, sender)
    if not fromLeader(sender) then
        return
    end
    local wasOn = lastOk == true or (heard ~= nil and heard.on == true)
    hear({ from = sender, on = false, version = f[1], why = f[2], at = GetTime() })
    stopWatch()
    report(wasOn) -- said only to a raider it was on for
end)

-- Events -----------------------------------------------------------------------------------------------

-- Asks the leader once per raid instance (also on becoming the leader inside); a wipe's run back into
-- the same instance doesn't ask again.
local function maybeAsk()
    if lastKey and askedFor ~= lastKey and not own.on and LM:CanRunLooting() then
        askedFor = lastKey
        if LM.AskLooting then
            LM.AskLooting()
        end
    end
end

-- The first loading screen after a login or /reload: the saved Yes brings it back on (an O when in its
-- instance; zoned sends the heartbeat) if this character said it, still leads, is in that instance or
-- the open world, and was last confirmed within LM.LOOTING_AWAY. Otherwise the saved state is cleared.
-- Returns whether it is on again.
local function resume(key, where)
    local s = saved()
    if not s or s.on ~= true then
        return false
    end
    local age = type(s.at) == "number" and time() - s.at or nil
    local ok = canLead() and s.who == LM:Me() and type(s.instance) == "string" and s.instance ~= ""
        and (key == s.instance or where == "world") and age ~= nil and age >= 0 and age <= LM.LOOTING_AWAY
    if not ok then
        save() -- own is still off: clears it
        return false
    end
    own.on, own.instance, own.why = true, s.instance, nil
    own.awaySince = key ~= s.instance and (GetTime() - age) or nil
    askedFor = s.instance -- not asked there again, even after a later Turn off
    if key == s.instance and not LM.ChatLocked() then
        LM.SendText(Wire.Encode("O", { LM.VERSION, own.instance }))
    end
    if not beatTicker then
        beatTicker = C_Timer.NewTicker(LM.HEARTBEAT_SECONDS, beat)
    end
    CRT:Print(TEXT.stillOn)
    return true
end

-- A loading screen or a new zone. The leader's first one after loading brings a saved Yes back on, or
-- tells raiders it starts off. In the open world the leader stays on (a wipe) and its heartbeat says so;
-- any other instance turns it off. Raiders keep the leader's word: the gate checks where they are.
local function zoned()
    local key, where = LM.InstanceKey(), place()
    if where == lastPlace then
        return
    end
    if lastPlace == false and not resume(key, where) and canLead() then
        LM.SendText(Wire.Encode("F", { LM.VERSION, "reload" }))
    end
    lastKey, lastPlace = key, where
    if key and key ~= passedIn then
        passed, rolled, passedIn = {}, {}, key
    end
    if own.on then
        if key == own.instance then
            own.awaySince = nil
            beat()
        elseif where == "world" then
            own.awaySince = own.awaySince or GetTime()
            beat()
        else
            LM:SetLooting(false, "instance")
        end
    end
    if key ~= askedFor and LM.HideLootingPrompt then
        LM.HideLootingPrompt()
    end
    report(false)
    LM:Fire("looting")
    maybeAsk()
end

-- The group changed (or Enable in party did: from "setting"): a leader who can't lead it any more turns
-- it off, a raider forgets a word that no longer counts.
local function regrouped(from)
    if not isLeader() then
        askedFor = nil -- asked again on getting the lead back
    end
    local ok, whyNot = canLead()
    if own.on and not ok then
        LM:SetLooting(false, (from == "setting" and whyNot == AutoPass.WHY.party) and "party" or "lead", whyNot)
    end
    checkHeard()
    report(false)
    LM:Fire("looting")
    maybeAsk()
end
LM.LootingRecheck = regrouped

local events = CreateFrame("Frame")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA", "GROUP_ROSTER_UPDATE", "PARTY_LEADER_CHANGED",
    "ENCOUNTER_START", "ENCOUNTER_END", "PLAYER_REGEN_ENABLED" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA" then
        zoned()
    elseif event == "ENCOUNTER_START" then
        inEncounter = true
    elseif event == "ENCOUNTER_END" then
        inEncounter, endedAt = false, GetTime()
        beatAfterLockdown()
        report(false)
    elseif event == "PLAYER_REGEN_ENABLED" then
        beat()
    else
        regrouped()
    end
end)
