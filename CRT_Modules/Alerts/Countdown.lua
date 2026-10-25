local ADDON, CRT = ...

-- The countdown run: special alerts before the pull. A special alert may have a phase 1 time before the pull
-- ("-0:15", Alerts/Special.lua). When the game's pull timer starts (START_PLAYER_COUNTDOWN; its seconds left, the
-- second argument, read only when readable and over 0, as ReadyCheck/EarlyPull.lua reads them) and no other run is
-- going, this starts a run with reason "countdown":
--   Alerts:Start(encounterID, difficultyName, "countdown", { firstAt = now + seconds left, difficultyID,
--     blocks = { special = true } })
-- so phase 1's clock is the pull moment, and an item at -15 is due 15 s before it. Only the special block runs, and
-- it gives a countdown run only its items before the pull (Special.lua's block). A boss with none gets no run.
-- The boss: the target's, else the focus's name (readable, out of combat) found by the Journal
-- (TimelineJournal:EncounterByName), a boss of a loaded season (Bosses:Get, Bosses:Loaded). Else the one boss of the
-- raid you are in (Journal:RaidBosses, in route order) with no kill the Timeline recorded on this difficulty since
-- the weekly reset, when there is exactly one. Else no run. The difficulty is the instance's (GetInstanceInfo's
-- difficultyID, in a raid, when readable).
-- It ends: CANCEL_PLAYER_COUNTDOWN stops it; ENCOUNTER_START replaces it, as Alerts:Start replaces any run, and
-- since no other run is given an item before the pull nothing shows twice; and on its own TIMEOUT seconds after
-- the pull moment when no encounter started. A new pull timer starts it again. No onPull hooks run for it (the
-- reason is neither "encounter" nor "rehearsal"), so the note engine's windows stay as they were, and the game
-- timeline bridge sends nothing for it (Alerts/GameTimeline.lua). A rehearsal never plays a pre-pull alert.

local Alerts = CRT.Alerts

local Countdown = {}
CRT.AlertCountdown = Countdown

local TIMEOUT = 5 -- seconds after the pull moment that a countdown run with no encounter ends
local WEEK = 7 * 24 * 3600
local REASON = "countdown"
local BLOCK = "special"

local function readable(v)
    local T = CRT.Timeline
    if T and T.readable then
        return T.readable(v)
    end
    return not (issecretvalue and issecretvalue(v))
end

local function inCombat()
    return InCombatLockdown and InCombatLockdown() and true or false
end

-- The instance's raid difficulty: its ID and the name a pull there gets (GetDifficultyInfo), or nil outside a raid.
local function difficulty()
    if not GetInstanceInfo then
        return nil
    end
    local ok, _, kind, id = pcall(GetInstanceInfo)
    if not (ok and readable(kind) and kind == "raid" and readable(id) and type(id) == "number" and id > 0) then
        return nil
    end
    local name
    if GetDifficultyInfo then
        local okName, n = pcall(GetDifficultyInfo, id)
        if okName and readable(n) and type(n) == "string" and n ~= "" then
            name = n
        end
    end
    return id, name
end

-- A boss of a loaded season by its encounter ID, or nil.
local function loaded(id)
    local Bosses = CRT.Bosses
    if type(id) ~= "number" or not (Bosses and Bosses.Get and Bosses:Get(id)) then
        return nil
    end
    if Bosses.Loaded and not Bosses:Loaded(id) then
        return nil
    end
    return id
end

-- The boss a unit's name names, through the Journal, or nil.
local function unitBoss(unit)
    local J = CRT.TimelineJournal
    if not (UnitName and J and J.EncounterByName) then
        return nil
    end
    local ok, name = pcall(UnitName, unit)
    if not (ok and readable(name) and type(name) == "string" and name ~= "") then
        return nil
    end
    local okID, id = pcall(J.EncounterByName, J, name)
    return okID and loaded(id) or nil
end

-- When this lockout began (time()), from the seconds to the weekly reset, or nil when they can't be read.
local function lockoutStart()
    if not (C_DateAndTime and C_DateAndTime.GetSecondsUntilWeeklyReset) then
        return nil
    end
    local ok, left = pcall(C_DateAndTime.GetSecondsUntilWeeklyReset)
    if not (ok and readable(left) and type(left) == "number") then
        return nil
    end
    return time() + math.floor(left) - WEEK
end

-- Whether the Timeline recorded a kill of a boss on a difficulty since a time.
local function killed(encounterID, difficultyID, since)
    local T = CRT.Timeline
    if not (T and T.Pulls) then
        return false
    end
    local ok, pulls = pcall(T.Pulls, T, encounterID)
    for _, p in ipairs(ok and type(pulls) == "table" and pulls or {}) do
        if p.kill == true and p.difficultyID == difficultyID and type(p.startedAt) == "number" and p.startedAt >= since then
            return true
        end
    end
    return false
end

-- The one boss of the raid you are in, in route order, with no kill this lockout on this difficulty, or nil.
local function routeBoss(difficultyID)
    local J, Bosses = CRT.TimelineJournal, CRT.Bosses
    local since = lockoutStart()
    if not (difficultyID and since and J and J.RaidBosses and Bosses and Bosses.RouteList) then
        return nil
    end
    local ok, here = pcall(J.RaidBosses, J)
    local inRaid = {}
    for _, b in ipairs(ok and type(here) == "table" and here or {}) do
        if type(b) == "table" and type(b.encounterID) == "number" then
            inRaid[b.encounterID] = true
        end
    end
    local found
    for _, def in ipairs(Bosses:RouteList()) do
        local id = def.encounterID
        if inRaid[id] and loaded(id) and not killed(id, difficultyID, since) then
            if found then
                return nil
            end
            found = id
        end
    end
    return found
end

-- The boss a pull timer is for: the target's, the focus's, else the raid's one boss left (see the top of this file).
function Countdown.Boss(difficultyID)
    return unitBoss("target") or unitBoss("focus") or routeBoss(difficultyID)
end

-- Whether the run going is a countdown run.
function Countdown.Running()
    return Alerts.running and Alerts.run and Alerts.run.reason == REASON or false
end

local function stopOwn()
    if Countdown.Running() then
        Alerts:Stop()
    end
end

-- A pull timer started with `remaining` seconds left (the event's second argument). Starts a countdown run, or
-- does nothing; true when one started.
function Countdown:Begin(remaining)
    if Alerts.running and not Countdown.Running() then
        return false -- out of a run only
    end
    stopOwn() -- a new pull timer replaces the last one's run
    if not (readable(remaining) and type(remaining) == "number" and remaining > 0) or inCombat() then
        return false
    end
    local difficultyID, difficultyName = difficulty()
    local encounterID = Countdown.Boss(difficultyID)
    if not encounterID then
        return false
    end
    local opts = { difficultyID = difficultyID, blocks = { [BLOCK] = true } }
    -- nothing before the pull for this boss: no run, so nothing else changes
    local probe = { encounterID = encounterID, difficultyID = difficultyID, difficultyName = difficultyName, reason = REASON }
    if #Alerts:Collect(probe, opts) == 0 then
        return false
    end
    opts.firstAt = GetTime() + remaining
    Alerts:Start(encounterID, difficultyName, REASON, opts)
    local runId = Alerts.runId
    if C_Timer and C_Timer.After then
        C_Timer.After(remaining + TIMEOUT, function()
            if Countdown.Running() and Alerts.runId == runId then
                Alerts:Stop()
            end
        end)
    end
    return true
end

function Countdown.HandleEvent(event, ...)
    if event == "START_PLAYER_COUNTDOWN" then
        local _, remaining = ...
        Countdown:Begin(remaining)
    elseif event == "CANCEL_PLAYER_COUNTDOWN" then
        stopOwn()
    end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("START_PLAYER_COUNTDOWN")
frame:RegisterEvent("CANCEL_PLAYER_COUNTDOWN")
frame:SetScript("OnEvent", function(_, event, ...)
    if CRT.db then
        Countdown.HandleEvent(event, ...)
    end
end)
