local ADDON, CRT = ...

-- Automatic combat logging (off by default): with Log combat automatically ticked, the game's combat log is started in
-- the content the player ticked, and the game's Advanced Combat Logging is switched on. Settings in CRTDB.qol.combatLog
-- (defaults in Core.lua): enabled, raid = { lfr, normal, heroic, mythic }, dungeon = { keys, mythic, normal } (normal
-- covers Heroic and Normal dungeons), stopOnLeave and announce. The tab is Quality of Life's Combat log
-- (QoL/CombatLogTab.lua); this file has no UI.
--
-- The rate limit: LoggingCombat is allowed 5 calls per 10 seconds, shared by every addon and /combatlog, queries too;
-- over it, it returns nil and changes nothing. So nothing here polls. A decision runs only DECIDE_DELAY seconds after a
-- zone change (PLAYER_ENTERING_WORLD, ZONE_CHANGED_NEW_AREA, CHALLENGE_MODE_START; a burst of them makes one decision),
-- and only calls the game when it matters: in ticked content one query, then a start if it is off; on leaving, one
-- stop, only for a log CRT started this session (a log the player started, by /combatlog or Start logging now, is never
-- stopped). A nil answer is tried once more RETRY_DELAY seconds later, never again. The manual buttons make one call each.
-- The last known state is kept for the tab. Every call is in pcall: if the game refuses it, chat says so once.
--
-- Game facts (read 2026-11-14):
--   LoggingCombat([newState]) -> isLogging, nil when rate limited; called with no argument to query, since an explicit
--   nil means false (warcraft.wiki.gg API_LoggingCombat).
--   The CVar advancedCombatLogging, the Advanced Combat Logging checkbox of the Network settings (Gethe/wow-ui-source
--   live, Interface/AddOns/Blizzard_SettingsDefinitions_Shared/Network.lua: Settings.SetupCVarCheckbox(category,
--   "advancedCombatLogging", ADVANCED_COMBAT_LOGGING, ...)); C_CVar.GetCVarBool(name) -> value?, C_CVar.SetCVar(name,
--   value) -> success (nil for a secure CVar in combat), and the GetCVarBool / SetCVar globals (warcraft.wiki.gg, and
--   Blizzard_APIDocumentationGenerated/CVarDocumentation.lua). Set out of combat only (InCombatLockdown), read back after.
--   GetInstanceInfo() -> name, instanceType ("none", "party", "raid", "scenario", "pvp", "arena"), difficultyID, ...
--   (warcraft.wiki.gg API_GetInstanceInfo); DifficultyID: raid 17 Looking For Raid, 14 Normal, 15 Heroic, 16 Mythic;
--   party 8 Mythic Keystone, 23 Mythic, 2 Heroic, 1 Normal; 24 and 33 Timewalking, 205 Follower, 208 Delves (scenario)
--   and the rest never log (warcraft.wiki.gg DifficultyID).
--   C_ChallengeMode.IsChallengeModeActive() -> boolean, and event CHALLENGE_MODE_START (mapID) (warcraft.wiki.gg, and
--   Blizzard_APIDocumentationGenerated/ChallengeModeInfoDocumentation.lua): a key starts in difficulty 23, so a running
--   key counts as Mythic+ keys. Events PLAYER_LOGIN, PLAYER_ENTERING_WORLD, ZONE_CHANGED_NEW_AREA, PLAYER_REGEN_ENABLED;
--   C_Timer.After(seconds, callback).

local CombatLog = {}
CRT.CombatLog = CombatLog

local TEXT = {
    on = "Combat log on: %s.",
    off = "Combat log off: you left the instance.",
    aclOn = "Advanced Combat Logging was off, so CRT turned it on (Options > System > Network).",
    aclLater = "Advanced Combat Logging is off. CRT turns it on when combat ends.",
    aclFailed = "CRT couldn't turn on Advanced Combat Logging. Turn it on in Options > System > Network.",
    refused = "The game didn't let CRT start or stop the combat log. Type /combatlog instead.",
    busy = "The game is busy with combat log calls. Try again in a few seconds.",
    manualOn = "Combat log on.",
    manualOff = "Combat log off.",
    -- the Now line
    nowUnknown = "Not checked yet. CRT checks when you enter content you ticked.",
    nowBusy = "Unknown: the game was busy. CRT checks again on the next zone change.",
    nowRefused = "The game refused CRT's combat log call. Use /combatlog.",
    nowCRT = "On: started by CRT in %s.",
    nowManual = "On: started with Start logging now.",
    nowOther = "On: not started by CRT, so CRT leaves it on.",
    nowLeft = "Off: CRT stopped it when you left.",
    nowStopped = "Off: stopped with Stop logging.",
    nowOff = "Off.",
    -- the ticks, and where a log was started (chat and the Now line)
    lfr = "Raid Finder",
    normal = "Normal",
    heroic = "Heroic",
    mythic = "Mythic",
    keys = "Mythic+ keys",
    mythicNoKey = "Mythic (no key)",
    heroicNormal = "Heroic and Normal",
    lfrRaid = "Raid Finder raid",
    normalRaid = "Normal raid",
    heroicRaid = "Heroic raid",
    mythicRaid = "Mythic raid",
    key = "Mythic+ key",
    mythicDungeon = "Mythic dungeon",
    heroicDungeon = "Heroic dungeon",
    normalDungeon = "Normal dungeon",
}

CombatLog.ACL_CVAR = "advancedCombatLogging"
local DECIDE_DELAY = 2 -- seconds after a zone change, so the instance's difficulty has settled
local RETRY_DELAY = 10 -- the rate limit's window

-- The ticks, in the tab's order: group is the settings table (raid or dungeon), key its field.
CombatLog.TICKS = {
    raid = {
        { key = "lfr", label = TEXT.lfr },
        { key = "normal", label = TEXT.normal },
        { key = "heroic", label = TEXT.heroic },
        { key = "mythic", label = TEXT.mythic },
    },
    dungeon = {
        { key = "keys", label = TEXT.keys },
        { key = "mythic", label = TEXT.mythicNoKey },
        { key = "normal", label = TEXT.heroicNormal },
    },
}

-- Instance kind -> difficultyID -> the tick it falls under. Anything not here never logs.
local KEY_PLACE = { group = "dungeon", key = "keys", label = TEXT.key }
local PLACES = {
    raid = {
        [17] = { group = "raid", key = "lfr", label = TEXT.lfrRaid },
        [14] = { group = "raid", key = "normal", label = TEXT.normalRaid },
        [15] = { group = "raid", key = "heroic", label = TEXT.heroicRaid },
        [16] = { group = "raid", key = "mythic", label = TEXT.mythicRaid },
    },
    party = {
        [8] = KEY_PLACE,
        [23] = { group = "dungeon", key = "mythic", label = TEXT.mythicDungeon },
        [2] = { group = "dungeon", key = "normal", label = TEXT.heroicDungeon },
        [1] = { group = "dungeon", key = "normal", label = TEXT.normalDungeon },
    },
}

-- What CRT knows. logging is the last state the game gave (nil: unknown); ours, whether CRT's zone logic started the
-- running log this session; now, the Now line's key; label, where CRT started it.
local state = { logging = nil, ours = false, now = "unknown", label = nil, refused = false }
local refusalSaid = false
local gen = 0 -- each zone change bumps it, so an older retry does nothing
local pending = false -- a decision is waiting on its timer
local waitingForCombat = false

local function settings()
    return CRT.db and CRT.db.qol and CRT.db.qol.combatLog
end

local function isSecret(value)
    if not issecretvalue then
        return false
    end
    local ok, s = pcall(issecretvalue, value)
    return not ok or s == true
end

local function inCombat()
    if not InCombatLockdown then
        return false
    end
    local ok, v = pcall(InCombatLockdown)
    return ok and v and true or false
end

-- True when the timer was set.
local function later(seconds, fn)
    if C_Timer and C_Timer.After then
        return pcall(C_Timer.After, seconds, fn) and true or false
    end
    return false
end

local function announce(line)
    local s = settings()
    if s and s.announce then
        CRT:Print(line)
    end
end

-- Whether the content counts. Pure: settings come in s (CRT.db.qol.combatLog when left out). Returns want, and the
-- place's label ("Heroic raid") when the content is one CRT knows.
function CombatLog.ShouldLog(instanceType, difficultyID, inKey, s)
    s = s or settings()
    if type(s) ~= "table" or not s.enabled then
        return false
    end
    if isSecret(instanceType) or isSecret(difficultyID) then
        return false
    end
    local place
    if instanceType == "party" and inKey then
        place = KEY_PLACE
    else
        local list = PLACES[instanceType]
        place = list and difficultyID and list[difficultyID]
    end
    if not place then
        return false
    end
    local group = s[place.group]
    return (type(group) == "table" and group[place.key]) and true or false, place.label
end

local function instanceNow()
    if not GetInstanceInfo then
        return "none", 0
    end
    local ok, _, kind, difficulty = pcall(GetInstanceInfo)
    if not ok then
        return "none", 0
    end
    return kind, difficulty
end

local function keyRunning()
    local active = C_ChallengeMode and C_ChallengeMode.IsChallengeModeActive
    if not active then
        return false
    end
    local ok, v = pcall(active)
    return ok and v == true
end

-- One LoggingCombat call: true/false, or nil and "busy" (rate limited) or "refused" (missing or raised an error).
-- No argument queries; newState starts or stops.
local function call(newState)
    if not LoggingCombat then
        state.refused = true
        return nil, "refused"
    end
    local ok, result
    if newState == nil then
        ok, result = pcall(LoggingCombat)
    else
        ok, result = pcall(LoggingCombat, newState and true or false)
    end
    if not ok then
        state.refused = true
        if not refusalSaid then
            refusalSaid = true
            CRT:Print(TEXT.refused)
        end
        return nil, "refused"
    end
    if result == nil then
        return nil, "busy"
    end
    state.refused = false
    return result and true or false
end

local decide

-- A nil answer: once more a little later, and then it is left unknown until the next zone change.
local function busyAgain(myGen, retried)
    if retried then
        state.logging = nil
        state.now = "busy"
        return
    end
    later(RETRY_DELAY, function()
        decide(myGen, true)
    end)
end

function decide(myGen, retried)
    if myGen ~= gen then
        return
    end
    local s = settings()
    if not (s and s.enabled) then
        return
    end
    local kind, difficulty = instanceNow()
    local want, label = CombatLog.ShouldLog(kind, difficulty, keyRunning(), s)
    if want then
        local now, why = call()
        if now == nil then
            if why == "busy" then
                busyAgain(myGen, retried)
            end
            return
        end
        state.logging = now
        if now then
            if not state.ours and state.now ~= "manual" then
                state.now = "other"
            end
            return
        end
        state.ours = false -- whatever CRT started was stopped since
        local started, why2 = call(true)
        if started then
            state.logging, state.ours, state.label, state.now = true, true, label, "crt"
            announce(string.format(TEXT.on, label))
        elseif started == nil and why2 == "busy" then
            busyAgain(myGen, retried)
        end
    elseif state.ours and s.stopOnLeave then
        local stopped, why = call(false)
        if stopped == false then
            state.logging, state.ours, state.now = false, false, "left"
            announce(TEXT.off)
        elseif stopped == nil and why == "busy" then
            busyAgain(myGen, retried)
        end
    end
end

-- A zone change: one decision a moment later, for where you are by then. A burst of zone events shares one timer, and
-- each change cancels an older retry (gen).
function CombatLog:Schedule()
    gen = gen + 1
    if pending then
        return
    end
    pending = later(DECIDE_DELAY, function()
        pending = false
        decide(gen, false)
    end)
end

-- Advanced Combat Logging ------------------------------------------------------------------------------------------

-- The CVar now: true, false, or nil when it can't be read.
function CombatLog:AdvancedOn()
    local get = (C_CVar and C_CVar.GetCVarBool) or GetCVarBool
    if not get then
        return nil
    end
    local ok, v = pcall(get, self.ACL_CVAR)
    if not ok or v == nil then
        return nil
    end
    return v and true or false
end

local events = CreateFrame("Frame")

-- Turns it on if it is off, out of combat, and says so in chat; in combat it waits for combat to end. True when on.
function CombatLog:TurnOnAdvanced()
    if self:AdvancedOn() then
        return true
    end
    if inCombat() then
        if not waitingForCombat then
            waitingForCombat = true
            events:RegisterEvent("PLAYER_REGEN_ENABLED")
            CRT:Print(TEXT.aclLater)
        end
        return false
    end
    local set = (C_CVar and C_CVar.SetCVar) or SetCVar
    if set then
        pcall(set, self.ACL_CVAR, "1")
    end
    if self:AdvancedOn() then
        CRT:Print(TEXT.aclOn)
        return true
    end
    CRT:Print(TEXT.aclFailed)
    return false
end

-- The master tick: on also turns Advanced Combat Logging on and decides for where you are now.
function CombatLog:SetEnabled(on)
    local s = settings()
    s.enabled = on and true or false
    if s.enabled then
        self:TurnOnAdvanced()
        self:Schedule()
    end
end

-- The manual buttons: one call each, no retry. A log started here is the player's: CRT never stops it on leaving.
-- Returns ok and a short line to show.
function CombatLog:StartNow()
    local on, why = call(true)
    if on then
        state.logging, state.ours, state.now = true, false, "manual"
        return true, TEXT.manualOn
    end
    return false, why == "busy" and TEXT.busy or TEXT.refused
end

function CombatLog:StopNow()
    local on, why = call(false)
    if on == false then
        state.logging, state.ours, state.now = false, false, "stopped"
        return true, TEXT.manualOff
    end
    return false, why == "busy" and TEXT.busy or TEXT.refused
end

-- For the tab and the tests: the last known state, never a fresh call.
function CombatLog:Status()
    return { logging = state.logging, ours = state.ours, now = state.now, label = state.label, refused = state.refused }
end

function CombatLog:NowText()
    if state.refused then
        return TEXT.nowRefused
    end
    local k = state.now
    if k == "crt" then
        return string.format(TEXT.nowCRT, state.label or "")
    elseif k == "manual" then
        return TEXT.nowManual
    elseif k == "other" then
        return TEXT.nowOther
    elseif k == "left" then
        return TEXT.nowLeft
    elseif k == "stopped" then
        return TEXT.nowStopped
    elseif k == "busy" then
        return TEXT.nowBusy
    elseif state.logging == false then
        return TEXT.nowOff
    end
    return TEXT.nowUnknown
end

events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("ZONE_CHANGED_NEW_AREA")
events:RegisterEvent("CHALLENGE_MODE_START") -- a key inserted: the dungeon now counts as Mythic+ keys
events:SetScript("OnEvent", function(_, event)
    local s = settings()
    if event == "PLAYER_REGEN_ENABLED" then
        waitingForCombat = false
        events:UnregisterEvent("PLAYER_REGEN_ENABLED")
        if s and s.enabled then
            CombatLog:TurnOnAdvanced()
        end
        return
    end
    if not (s and s.enabled) then
        return
    end
    if event == "PLAYER_LOGIN" then
        CombatLog:TurnOnAdvanced() -- every login with it on
    else
        CombatLog:Schedule()
    end
end)
