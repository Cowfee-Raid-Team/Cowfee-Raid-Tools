local ADDON, CRT = ...

-- Release my spirit after a wipe (CRTDB.qol.autoRelease, off by default; the check box is on Quality of Life > Settings).
-- At ENCOUNTER_END (encounterID, encounterName, difficultyID, groupSize, success) with success 0, on a boss whose file
-- has autoRelease = true (CRT.Bosses:AutoRelease, season data: this file names no boss), while you are dead and not
-- yet a ghost, it waits RELEASE_DELAY seconds, checks again, then presses Release Spirit for you (RepopMe). Never after
-- a kill, so a mass resurrection after it still works. It holds back while a resurrection is being cast on you
-- (UnitHasIncomingResurrection) or was offered since your last death (RESURRECT_REQUEST), for as long as the game keeps
-- the offer open: the corpse delay (GetCorpseRecoveryDelay, read when the offer comes) plus OFFER_SECONDS. It also holds
-- while you can resurrect yourself (a soulstone, Reincarnation: C_DeathInfo.GetSelfResurrectOptions), so you release by
-- hand; Alex, 2026-11-02: "Hold if I have one". A death state the game keeps secret counts as unknown, and unknown never releases.
-- Dev only (CRT_Dev/Dev/AutoReleaseTest.lua, /crt dev autorelease): OnEncounterEnd's third argument, opts, where
-- force = true skips the boss lookup (nothing else) and done(released) hears the result after the delay; OfferLeft reads
-- the offer window. The game's ENCOUNTER_END passes no opts, so the shipped path is the same.

local RELEASE_DELAY = 0.5 -- seconds after the encounter ends
local OFFER_SECONDS = 60 -- a resurrection offer holds the release back this long after the corpse delay (the game's popup)

local AutoRelease = { RELEASE_DELAY = RELEASE_DELAY, OFFER_SECONDS = OFFER_SECONDS }
CRT.AutoRelease = AutoRelease

local offerUntil -- GetTime() when the last resurrection offer since your last death runs out, or nil
local pending = false -- a release is waiting for its delay

local function enabled()
    local qol = CRT.db and CRT.db.qol
    return qol ~= nil and qol.autoRelease == true
end

local function secret(v)
    return issecretvalue ~= nil and issecretvalue(v) == true
end

-- A game call's answer when it can be read: false and nil when the call is missing, errors or gives a secret.
local function read(fn, ...)
    if type(fn) ~= "function" then
        return false, nil
    end
    local ok, v = pcall(fn, ...)
    if not ok or secret(v) then
        return false, nil
    end
    return true, v
end

-- The seconds before a resurrection can be accepted (GetCorpseRecoveryDelay), or 0 when it can't be read or isn't a
-- number of 0 or more.
function AutoRelease.CorpseDelay()
    local ok, delay = read(GetCorpseRecoveryDelay)
    if ok and type(delay) == "number" and delay > 0 then
        return delay
    end
    return 0
end

-- Whether you have a self-resurrect (any entry in GetSelfResurrectOptions). An error or a secret answer is unknown and
-- counts as one, so it holds. A client without the call counts as none, so the setting still works there.
function AutoRelease.CanResurrectSelf()
    local getOptions = C_DeathInfo and C_DeathInfo.GetSelfResurrectOptions
    if type(getOptions) ~= "function" then
        return false
    end
    local ok, options = pcall(getOptions)
    if not ok or secret(options) then
        return true
    end
    return type(options) == "table" and #options > 0
end

-- Dead, not a ghost, and no resurrection on the way: the only state a release is for.
function AutoRelease.Waiting()
    local okDead, dead = read(UnitIsDead, "player")
    local okGhost, ghost = read(UnitIsGhost, "player")
    if not (okDead and okGhost) or dead ~= true or ghost == true then
        return false
    end
    local okRes, incoming = read(UnitHasIncomingResurrection, "player")
    if okRes and incoming == true then
        return false
    end
    if offerUntil and GetTime() < offerUntil then
        return false
    end
    return not AutoRelease.CanResurrectSelf()
end

-- The seconds left on an open resurrection offer, or nil (read only, for the dev status).
function AutoRelease.OfferLeft()
    if offerUntil and GetTime() < offerUntil then
        return offerUntil - GetTime()
    end
    return nil
end

-- After the delay: the same checks again, then Release Spirit. True when RepopMe was called without an error.
function AutoRelease:Release()
    pending = false
    if not enabled() or not self.Waiting() or type(RepopMe) ~= "function" then
        return false
    end
    return (pcall(RepopMe))
end

-- True when a release was set to run after the delay. opts is dev only (see the header).
function AutoRelease:OnEncounterEnd(encounterID, success, opts)
    if pending or not enabled() or encounterID == nil or success == nil or secret(encounterID) or secret(success) then
        return false
    end
    local force = opts ~= nil and opts.force == true
    if success ~= 0 or not (force or (CRT.Bosses and CRT.Bosses:AutoRelease(encounterID))) or not self.Waiting() then
        return false
    end
    pending = true
    C_Timer.After(RELEASE_DELAY, function()
        local released = AutoRelease:Release()
        if opts and opts.done then
            opts.done(released)
        end
    end)
    return true
end

local events = CreateFrame("Frame")
events:RegisterEvent("ENCOUNTER_END")
events:RegisterEvent("RESURRECT_REQUEST")
events:RegisterEvent("PLAYER_DEAD")
events:SetScript("OnEvent", function(_, event, encounterID, _, _, _, success)
    if event == "ENCOUNTER_END" then
        AutoRelease:OnEncounterEnd(encounterID, success)
    elseif event == "RESURRECT_REQUEST" then
        offerUntil = GetTime() + AutoRelease.CorpseDelay() + OFFER_SECONDS
    elseif event == "PLAYER_DEAD" then
        offerUntil = nil -- an offer from before this death is gone
    end
end)
