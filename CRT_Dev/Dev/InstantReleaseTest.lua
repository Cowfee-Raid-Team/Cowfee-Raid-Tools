local ADDON, CRT = ...

-- DEVELOPER ONLY. Tests Instantly release after wipe (Alerts/InstantRelease.lua) outside a raid (#1248, #1249):
--   /crt dev autorelease          the same as status
--   /crt dev autorelease status   one line per check the release makes, with its answer now, then the verdict
--   /crt dev autorelease now      runs the real end-of-encounter path as a wipe (InstantRelease:OnEncounterEnd, with
--                                 its dev opts.done); says what it decided and, after the delay, whether RepopMe was
--                                 called
--   /crt dev autorelease arm      the next death (PLAYER_DEAD) within ARM_SECONDS does what now does, ARM_WAIT after it
--   /crt dev autorelease off      disarms
-- It never fakes being dead, and the setting must be on (Mech Alerts > Special): with it off nothing happens,
-- which is part of the test. Every game call is in a pcall; a secret answer shows as <secret>, never compared.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local ARM_SECONDS = 600 -- how long arm waits for a death
local ARM_WAIT = 1 -- seconds after the death before the wipe, as the encounter's end comes a moment after it

local Test = { ARM_SECONDS = ARM_SECONDS, ARM_WAIT = ARM_WAIT }
CRT.InstantReleaseTest = Test

local TEXT = {
    prefix = "Auto release test: ",
    setting = "Setting: %s",
    dead = "Dead: %s",
    ghost = "Ghost: %s",
    incoming = "Incoming resurrection: %s",
    offerOpen = "Resurrection offer: open, %d s left",
    offerNone = "Resurrection offer: none",
    selfRes = "Self-resurrect options: %s",
    repop = "RepopMe: %s",
    armed = "Armed: %d s left",
    release = "Would release.",
    hold = "Would hold: %s.",
    mismatch = "The release code answers differently (%s): tell Claude.",
    holdOff = "the setting is off (Mech Alerts > Special)",
    holdUnknown = "your death state can't be read",
    holdAlive = "you're alive",
    holdGhost = "you're already a ghost",
    holdIncoming = "a resurrection is being cast on you",
    holdOffer = "a resurrection offer is open",
    holdSelf = "you can resurrect yourself",
    holdRepop = "RepopMe is missing on this client",
    holdBusy = "a release is already waiting",
    releasing = "Wipe sent. Releasing in %s s.",
    called = "RepopMe called.",
    notReleased = "Not released: %s.",
    notReleasedWhy = "the checks changed during the delay",
    armOn = "Armed for %d minutes: die and it acts as a boss wipe.",
    armFired = "Death seen. Sending the wipe in %s s.",
    armTimeout = "Disarmed: no death in %d minutes.",
    disarmed = "Disarmed.",
    usage = "/crt dev autorelease status, now, arm or off.",
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

local function enabled()
    return CRT.db and CRT.db.alerts and CRT.db.alerts.instantRelease == true
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

-- Why the release would hold now, in InstantRelease's own order, or nil when it would release.
local function holdReason()
    local AR = CRT.InstantRelease
    if not enabled() then
        return TEXT.holdOff
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
local armToken = 0 -- each arm's own number, so an old timeout never disarms a newer arm

function Test:Status()
    local AR = CRT.InstantRelease
    say(TEXT.setting:format(enabled() and "on" or "off"))
    say(TEXT.dead:format((ask(UnitIsDead, "player"))))
    say(TEXT.ghost:format((ask(UnitIsGhost, "player"))))
    say(TEXT.incoming:format((ask(UnitHasIncomingResurrection, "player"))))
    local left = AR.OfferLeft()
    say(left and TEXT.offerOpen:format(math.ceil(left)) or TEXT.offerNone)
    say(TEXT.selfRes:format(selfResText()))
    say(TEXT.repop:format(type(RepopMe) == "function" and "present" or "missing"))
    if armedUntil and GetTime() < armedUntil then
        say(TEXT.armed:format(math.ceil(armedUntil - GetTime())))
    end
    local why = holdReason()
    say(why and TEXT.hold:format(why) or TEXT.release)
    -- the release code's own answer, so a check this file reads differently shows up
    local waiting = enabled() and AR.Waiting() and type(RepopMe) == "function"
    if waiting ~= (why == nil) then
        say(TEXT.mismatch:format(waiting and "would release" or "would hold"))
    end
end

-- The real end-of-encounter path, as a wipe (success 0).
function Test:Now()
    if not enabled() then
        say(TEXT.hold:format(TEXT.holdOff))
        return false
    end
    local sent = CRT.InstantRelease:OnEncounterEnd(0, 0, {
        done = function(released)
            if released then
                say(TEXT.called)
            else
                say(TEXT.notReleased:format(holdReason() or TEXT.notReleasedWhy))
            end
        end,
    })
    if sent then
        say(TEXT.releasing:format(tostring(CRT.InstantRelease.RELEASE_DELAY)))
    else
        say(TEXT.hold:format(holdReason() or TEXT.holdBusy))
    end
    return sent
end

local events = CreateFrame("Frame")
events:SetScript("OnEvent", function()
    events:UnregisterEvent("PLAYER_DEAD")
    local live = armedUntil and GetTime() < armedUntil
    armedUntil = nil
    if not live then
        return
    end
    say(TEXT.armFired:format(tostring(ARM_WAIT)))
    C_Timer.After(ARM_WAIT, function()
        Test:Now()
    end)
end)

function Test:Arm()
    armToken = armToken + 1
    local token = armToken
    armedUntil = GetTime() + ARM_SECONDS
    events:RegisterEvent("PLAYER_DEAD")
    say(TEXT.armOn:format(math.floor(ARM_SECONDS / 60)))
    C_Timer.After(ARM_SECONDS, function()
        if token == armToken and armedUntil then
            armedUntil = nil
            events:UnregisterEvent("PLAYER_DEAD")
            say(TEXT.armTimeout:format(math.floor(ARM_SECONDS / 60)))
        end
    end)
end

function Test:Off()
    armToken = armToken + 1
    armedUntil = nil
    events:UnregisterEvent("PLAYER_DEAD")
    say(TEXT.disarmed)
end

-- Handles "dev autorelease ...". Returns false for any other command.
function Test:Command(msg)
    local rest = msg:match("^dev%s+autorelease%s*$") and "" or msg:match("^dev%s+autorelease%s+(.-)%s*$")
    if not rest then
        return false
    end
    if rest == "" or rest == "status" then
        self:Status()
    elseif rest == "now" then
        self:Now()
    elseif rest == "arm" then
        self:Arm()
    elseif rest == "off" then
        self:Off()
    else
        say(TEXT.usage)
    end
    return true
end
