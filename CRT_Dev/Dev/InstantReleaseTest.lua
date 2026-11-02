local ADDON, CRT = ...

-- DEVELOPER ONLY. Tests Instantly release after wipe (Alerts/InstantRelease.lua) outside a raid (#1248, #1249, #1250):
--   /crt dev autorelease               the same as status
--   /crt dev autorelease status        the boss on show on Mech Alerts and whether it is ticked, the ticked bosses, one
--                                      line per check the release makes with its answer now, then the verdict
--   /crt dev autorelease now [id]      runs the real end-of-encounter path as a wipe on the boss on show on Mech Alerts
--                                      (CRT.NoteReminders.Boss), or on the encounter ID given (InstantRelease:
--                                      OnEncounterEnd, with its dev opts: done, and anyInstance past the raid check, so
--                                      it works in town); says what it decided and, after the delay, whether RepopMe
--                                      was called
--   /crt dev autorelease arm [id]      the next death (PLAYER_DEAD) within ARM_SECONDS does what now does for that boss,
--                                      ARM_WAIT after it
--   /crt dev autorelease off           disarms
-- It never fakes being dead, and the boss must be ticked (Mech Alerts > Special): an unticked boss does nothing, which
-- is part of the test. Every game call is in a pcall; a secret answer shows as <secret>, never compared.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local ARM_SECONDS = 600 -- how long arm waits for a death
local ARM_WAIT = 1 -- seconds after the death before the wipe, as the encounter's end comes a moment after it

local Test = { ARM_SECONDS = ARM_SECONDS, ARM_WAIT = ARM_WAIT }
CRT.InstantReleaseTest = Test

local TEXT = {
    prefix = "Auto release test: ",
    onShow = "Boss on show: %s (%d), %s",
    onShowNone = "Boss on show: none",
    tickedOn = "ticked",
    tickedOff = "not ticked",
    tickedList = "Ticked bosses: %s",
    none = "none",
    dead = "Dead: %s",
    ghost = "Ghost: %s",
    incoming = "Incoming resurrection: %s",
    offerOpen = "Resurrection offer: open, %d s left",
    offerNone = "Resurrection offer: none",
    selfRes = "Self-resurrect options: %s",
    repop = "RepopMe: %s",
    raid = "Raid instance: %s (%s). A real wipe counts only in a raid; now and arm go past it.",
    armed = "Armed: %d s left",
    release = "Would release.",
    hold = "Would hold: %s.",
    mismatch = "The release code answers differently (%s): tell Claude.",
    holdOff = "%s isn't ticked (Mech Alerts > Special)",
    holdNoBoss = "no boss on show (open Raid Notes > Mech Alerts, or give an encounter ID)",
    holdUnknown = "your death state can't be read",
    holdAlive = "you're alive",
    holdGhost = "you're already a ghost",
    holdIncoming = "a resurrection is being cast on you",
    holdOffer = "a resurrection offer is open",
    holdSelf = "you can resurrect yourself",
    holdRepop = "RepopMe is missing on this client",
    holdBusy = "a release is already waiting",
    releasing = "Wipe sent on %s. Releasing in %s s.",
    called = "RepopMe called.",
    notReleased = "Not released: %s.",
    notReleasedWhy = "the checks changed during the delay",
    armOn = "Armed for %d minutes: die and it acts as a wipe on %s.",
    armFired = "Death seen. Sending the wipe in %s s.",
    armTimeout = "Disarmed: no death in %d minutes.",
    disarmed = "Disarmed.",
    usage = "/crt dev autorelease status, now [encounterID], arm [encounterID] or off.",
}

local function say(line)
    CRT:Print(TEXT.prefix .. line)
end

local function secret(v)
    return issecretvalue ~= nil and issecretvalue(v) == true
end

-- A game call's answer as text and, when readable, the value: "no API", "error", "<secret>" or the value.
local function ask(fn, ...)
    if type(fn) ~= "function" then
        return "no API"
    end
    local ok, v = pcall(fn, ...)
    if not ok then
        return "error"
    end
    if secret(v) then
        return "<secret>"
    end
    return tostring(v), true, v
end

-- IsInInstance's instance type as text: "no API", "error", "<secret>" or the type ("raid", "party", "none", ...).
local function instanceText()
    if type(IsInInstance) ~= "function" then
        return "no API"
    end
    local ok, _, instanceType = pcall(IsInInstance)
    if not ok then
        return "error"
    end
    if secret(instanceType) then
        return "<secret>"
    end
    return tostring(instanceType)
end

-- The boss on show on Mech Alerts (Notes/Reminders.lua), or nil.
local function bossOnShow()
    local Notes = CRT.NoteReminders
    if not (Notes and Notes.Boss) then
        return nil
    end
    local ok, enc = pcall(Notes.Boss)
    return ok and type(enc) == "number" and enc or nil
end

-- A boss's name from the boss library, or its ID when the library doesn't know it.
local function bossName(encounterID)
    local def = CRT.Bosses and CRT.Bosses.Get and CRT.Bosses:Get(encounterID)
    return def and def.name or tostring(encounterID)
end

local function ticked(encounterID)
    return CRT.InstantRelease.IsOn(encounterID)
end

local function selfResText()
    local getOptions = C_DeathInfo and C_DeathInfo.GetSelfResurrectOptions
    local text, readable, options = ask(getOptions)
    if not readable then
        return text == "no API" and "no API (counts as none)" or (text .. " (holds)")
    end
    if type(options) ~= "table" or #options == 0 then
        return "none"
    end
    local names = {}
    for _, o in ipairs(options) do
        local name = type(o) == "table" and o.name
        names[#names + 1] = (type(name) == "string" and not secret(name)) and name or "?"
    end
    return #options .. " (" .. table.concat(names, ", ") .. ")"
end

-- Why the release would hold now for the boss, in InstantRelease's own order, or nil when it would release.
local function holdReason(encounterID)
    local AR = CRT.InstantRelease
    if not encounterID then
        return TEXT.holdNoBoss
    end
    if not ticked(encounterID) then
        return TEXT.holdOff:format(bossName(encounterID))
    end
    local _, okDead, dead = ask(UnitIsDead, "player")
    local _, okGhost, ghost = ask(UnitIsGhost, "player")
    if not (okDead and okGhost) then
        return TEXT.holdUnknown
    end
    if ghost == true then
        return TEXT.holdGhost
    end
    if dead ~= true then
        return TEXT.holdAlive
    end
    local _, okRes, incoming = ask(UnitHasIncomingResurrection, "player")
    if okRes and incoming == true then
        return TEXT.holdIncoming
    end
    if AR.OfferLeft() then
        return TEXT.holdOffer
    end
    if AR.CanResurrectSelf() then
        return TEXT.holdSelf
    end
    if type(RepopMe) ~= "function" then
        return TEXT.holdRepop
    end
    return nil
end

local armedUntil -- GetTime() when arm runs out, or nil
local armedBoss -- the encounter ID arm acts on
local armToken = 0 -- each arm's own number, so an old timeout never disarms a newer arm

function Test:Status()
    local AR = CRT.InstantRelease
    local enc = bossOnShow()
    if enc then
        say(TEXT.onShow:format(bossName(enc), enc, ticked(enc) and TEXT.tickedOn or TEXT.tickedOff))
    else
        say(TEXT.onShowNone)
    end
    local names = {}
    for _, id in ipairs(AR.Ticked()) do
        names[#names + 1] = bossName(id)
    end
    say(TEXT.tickedList:format(#names > 0 and table.concat(names, ", ") or TEXT.none))
    say(TEXT.dead:format((ask(UnitIsDead, "player"))))
    say(TEXT.ghost:format((ask(UnitIsGhost, "player"))))
    say(TEXT.incoming:format((ask(UnitHasIncomingResurrection, "player"))))
    local left = AR.OfferLeft()
    say(left and TEXT.offerOpen:format(math.ceil(left)) or TEXT.offerNone)
    say(TEXT.selfRes:format(selfResText()))
    say(TEXT.repop:format(type(RepopMe) == "function" and "present" or "missing"))
    say(TEXT.raid:format(AR.InRaid() and "yes" or "no", instanceText()))
    if armedUntil and GetTime() < armedUntil then
        say(TEXT.armed:format(math.ceil(armedUntil - GetTime())))
    end
    local why = holdReason(enc)
    say(why and TEXT.hold:format(why) or TEXT.release)
    -- the release code's own answer, so a check this file reads differently shows up
    local waiting = ticked(enc) and AR.Waiting() and type(RepopMe) == "function"
    if waiting ~= (why == nil) then
        say(TEXT.mismatch:format(waiting and "would release" or "would hold"))
    end
end

-- The real end-of-encounter path, as a wipe (success 0) on the boss given, else the boss on show.
function Test:Now(encounterID)
    local enc = encounterID or bossOnShow()
    if not (enc and ticked(enc)) then
        say(TEXT.hold:format(holdReason(enc)))
        return false
    end
    local sent = CRT.InstantRelease:OnEncounterEnd(enc, 0, {
        anyInstance = true, -- in town too: the dev path past the raid check
        done = function(released)
            if released then
                say(TEXT.called)
            else
                say(TEXT.notReleased:format(holdReason(enc) or TEXT.notReleasedWhy))
            end
        end,
    })
    if sent then
        say(TEXT.releasing:format(bossName(enc), tostring(CRT.InstantRelease.RELEASE_DELAY)))
    else
        say(TEXT.hold:format(holdReason(enc) or TEXT.holdBusy))
    end
    return sent
end

local events = CreateFrame("Frame")
events:SetScript("OnEvent", function()
    events:UnregisterEvent("PLAYER_DEAD")
    local live = armedUntil and GetTime() < armedUntil
    local enc = armedBoss
    armedUntil, armedBoss = nil, nil
    if not live then
        return
    end
    say(TEXT.armFired:format(tostring(ARM_WAIT)))
    C_Timer.After(ARM_WAIT, function()
        Test:Now(enc)
    end)
end)

-- Arms the boss given, else the boss on show; an unticked one is refused.
function Test:Arm(encounterID)
    local enc = encounterID or bossOnShow()
    if not (enc and ticked(enc)) then
        say(TEXT.hold:format(holdReason(enc)))
        return false
    end
    armToken = armToken + 1
    local token = armToken
    armedUntil, armedBoss = GetTime() + ARM_SECONDS, enc
    events:RegisterEvent("PLAYER_DEAD")
    say(TEXT.armOn:format(math.floor(ARM_SECONDS / 60), bossName(enc)))
    C_Timer.After(ARM_SECONDS, function()
        if token == armToken and armedUntil then
            armedUntil, armedBoss = nil, nil
            events:UnregisterEvent("PLAYER_DEAD")
            say(TEXT.armTimeout:format(math.floor(ARM_SECONDS / 60)))
        end
    end)
end

function Test:Off()
    armToken = armToken + 1
    armedUntil, armedBoss = nil, nil
    events:UnregisterEvent("PLAYER_DEAD")
    say(TEXT.disarmed)
end

-- Handles "dev autorelease ...". Returns false for any other command.
function Test:Command(msg)
    local rest = msg:match("^dev%s+autorelease%s*$") and "" or msg:match("^dev%s+autorelease%s+(.-)%s*$")
    if not rest then
        return false
    end
    local word, id = rest:match("^(%a+)%s*(%d*)$")
    id = tonumber(id)
    if rest == "" or rest == "status" then
        self:Status()
    elseif word == "now" then
        self:Now(id)
    elseif word == "arm" then
        self:Arm(id)
    elseif rest == "off" then
        self:Off()
    else
        say(TEXT.usage)
    end
    return true
end
