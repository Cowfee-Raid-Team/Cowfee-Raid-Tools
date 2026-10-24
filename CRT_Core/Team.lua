local ADDON, CRT = ...

-- The team raid check (CRT.Team): whether the group is your raid team, so Season Stats, Tattlebot and the Late
-- Tracker can keep a team's numbers apart from a night with other players. One owner every module asks.
--
-- The rule: in a raid group (not a party, not solo, not a finder group), a team raid is one where at least
-- CRTDB.team.threshold (0.75 by default, 50% to 100% on General Settings) of the raid members online run CRT and
-- talk to each other. Team:IsTeam() answers now, Team:Snapshot() gives { team, crt, online, raid, percent },
-- Team:AtPull(encounterID, startedAt) the snapshot taken at that pull's ENCOUNTER_START (so a pull keeps the
-- answer it started with), Team:OnChange(fn) fires when the answer flips and Team:OnRecount(fn) on any new count.
--
-- Who runs CRT: every raid member a hello was heard from (you count). Members who leave the group or go offline
-- are dropped on GROUP_ROSTER_UPDATE (or UNIT_CONNECTION), so they count again once they say hello again; the set
-- resets when you leave the group.
--
-- The hello, under the prefix CRTHello, to the RAID channel only:   H|<version>|<addon version>   e.g. "H|1|1.1.2"
-- A later minor version may add fields after these, which are skipped; a higher major version or another kind is
-- left alone. A CRT says hello when it joins a raid group, logs in or reloads in one, and enters a raid instance.
-- Hearing a hello from someone not yet known (a joiner, or someone heard again after going offline), or from a
-- known member while your own last hello is older than WINDOW (they reloaded and know nobody), it says hello back.
-- Hellos go at most once per WINDOW seconds, DEBOUNCE seconds after the first reason, so a burst of joiners or
-- hellos gets one answer, never one per joiner. Never in combat (sent when it ends), never during the game's
-- addon message lockdown (tried again every LOCK_RETRY seconds, as Gear Checker's and Season Stats' messages
-- are), never in a finder group (IsInGroup(LE_PARTY_CATEGORY_INSTANCE)) or outside a raid group. A sender's name
-- is never compared when secret; names are folded to "name-realm" (lower case, the realm's spaces and dashes
-- left out), the roster's and the senders' alike.
--
-- Cheap: no OnUpdate. The addon message and connection events are listened to only in a raid group, and the
-- roster is read (at most 40 rows) on roster, connection and hello events and at a pull's start.
--
-- Game calls (warcraft.wiki.gg, read 2026-10-24): C_ChatInfo.RegisterAddonMessagePrefix, SendAddonMessage
-- (Enum.SendAddonMessageResult), InChatMessagingLockdown, CHAT_MSG_ADDON (prefix, text, channel, sender),
-- GetRaidRosterInfo (8th return online: 1 or nil), PLAYER_ENTERING_WORLD (isInitialLogin, isReloadingUi),
-- UNIT_CONNECTION (unit, isConnected), GROUP_ROSTER_UPDATE, ENCOUNTER_START (encounterID, ...), IsInRaid,
-- IsInGroup, InCombatLockdown, GetInstanceInfo, GetNormalizedRealmName, UnitName, GetTime, time.

local Team = { listeners = {}, recounts = {} }
CRT.Team = Team

Team.PREFIX = "CRTHello"
Team.VERSION = 1
Team.WINDOW = 10 -- seconds: at most one hello in this time
Team.DEBOUNCE = 2 -- seconds after the first reason before a hello goes, so a burst sends one
Team.LOCK_RETRY = 10 -- seconds between tries while the game holds addon messages
Team.LOCK_TRIES = 30 -- about five minutes of tries, past any encounter
Team.THROTTLE_RETRY = 2
Team.THROTTLE_TRIES = 3
Team.KEEP = 4 -- pulls whose snapshot is kept
Team.MATCH = 10 -- seconds between a pull's start and its snapshot
Team.DEFAULT = 0.75
Team.MIN_PERCENT, Team.MAX_PERCENT, Team.STEP = 50, 100, 5
Team.MAX_RAID = 40
Team.MAX_VERSION_TEXT = 24

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local SUCCESS = RESULT.Success or 0
local THROTTLED = RESULT.AddonMessageThrottle or 3
local CHANNEL_THROTTLED = RESULT.ChannelThrottle or 8
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(Team.PREFIX)
end

-- False for a secret value, which can't be compared.
local function readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return true
end

local function now()
    return GetTime and GetTime() or 0
end

local function fire(list, ...)
    for _, fn in ipairs(list) do
        -- a listener failing must never stop the check
        local ok, err = pcall(fn, ...)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

-- Names --------------------------------------------------------------------------------------------------------

-- "Name" or "Name-Realm" as one key, "name-realm": your own realm added when missing, the realm's spaces and dashes
-- left out (the roster and chat may write a realm either way). Nil for a secret or empty name.
function Team.Key(name)
    if not readable(name) or type(name) ~= "string" or name == "" then
        return nil
    end
    local base, realm = name:match("^([^%-]+)%-(.+)$")
    if not base then
        base = name
        realm = GetNormalizedRealmName and GetNormalizedRealmName() or ""
        if not readable(realm) or type(realm) ~= "string" then
            realm = ""
        end
    end
    return base:lower() .. "-" .. realm:lower():gsub("[%s%-]", "")
end

local function me()
    local ok, name = pcall(UnitName, "player")
    return ok and Team.Key(name) or nil
end

-- The group ----------------------------------------------------------------------------------------------------

-- True in your own raid group: not a party, not solo, not a finder group.
function Team.InRaidGroup()
    if not (IsInRaid and IsInRaid()) then
        return false
    end
    return not (IsInGroup and IsInGroup(LE_PARTY_CATEGORY_INSTANCE))
end
Team.CanSend = Team.InRaidGroup

-- The raid's members, { [key] = online }, or false when a row was secret (the last count then stands).
local function readRoster()
    local out = {}
    for i = 1, Team.MAX_RAID do
        local ok, name, _, _, _, _, _, _, online = pcall(GetRaidRosterInfo, i)
        if ok and name ~= nil then
            if not (readable(name) and readable(online)) then
                return false
            end
            local key = Team.Key(name)
            if key then
                out[key] = online and true or false
            end
        end
    end
    return out
end

-- The setting --------------------------------------------------------------------------------------------------

local function settings()
    local db = CRT.db
    return db and db.team
end

-- The share of online raid members that must run CRT, 0.5 to 1.
function Team.Threshold()
    local s = settings()
    local v = s and tonumber(s.threshold)
    if not v then
        return Team.DEFAULT
    end
    return math.max(Team.MIN_PERCENT / 100, math.min(Team.MAX_PERCENT / 100, v))
end

-- The threshold as a whole percent, on the slider's steps.
function Team.Percent()
    return math.floor(Team.Threshold() * 100 + 0.5)
end

-- The count ----------------------------------------------------------------------------------------------------

local heard = {} -- [key] = true: raid members a hello came from (you included)
local members = {} -- [key] = online, the last roster read
local snap = { team = false, crt = 0, online = 0, raid = false }

local function copy(t)
    return { team = t.team, crt = t.crt, online = t.online, raid = t.raid, percent = t.percent }
end

-- crt of online at percent or more, in whole numbers so 15 of 20 at 75% is a team raid.
function Team.Rule(crt, online, percent)
    return online > 0 and crt * 100 >= (percent or Team.Percent()) * online
end

local function set(raid, crt, online)
    local percent = Team.Percent()
    local team = raid and Team.Rule(crt, online, percent) or false
    local changed = team ~= snap.team
    local moved = changed or raid ~= snap.raid or crt ~= snap.crt or online ~= snap.online or percent ~= snap.percent
    snap = { team = team, crt = crt, online = online, raid = raid, percent = percent }
    if changed then
        fire(Team.listeners, team, copy(snap))
    end
    if moved then
        fire(Team.recounts, copy(snap))
    end
end

-- The count from the last roster read, without reading it again.
local function count()
    local mine = me()
    if mine and members[mine] ~= nil then
        heard[mine] = true
    end
    local crt, online = 0, 0
    for key, on in pairs(members) do
        if on then
            online = online + 1
            if heard[key] then
                crt = crt + 1
            end
        end
    end
    set(true, crt, online)
end

local reset -- below, with the sending

-- Reads the roster again: members who left or went offline are dropped from who runs CRT. Out of a raid group
-- everything resets.
function Team:Recount()
    if not Team.InRaidGroup() then
        if snap.raid or next(heard) then
            reset()
        end
        set(false, 0, 0)
        return
    end
    local roster = readRoster()
    if roster == false then
        return
    end
    members = roster
    for key in pairs(heard) do
        if not roster[key] then
            heard[key] = nil
        end
    end
    count()
end

function Team:IsTeam()
    return snap.team == true
end

function Team:Snapshot()
    return copy(snap)
end

-- Whether a player was heard running CRT (key: Team.Key of their name).
function Team:Runs(key)
    return heard[key] == true
end

function Team:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function Team:OnRecount(fn)
    self.recounts[#self.recounts + 1] = fn
end

-- "Team raid, 18 of 20 running CRT (90%)", "Not a team raid, 3 of 20 ..." or "Not in a raid group".
function Team.StatusText(s)
    s = s or snap
    if not s.raid then
        return "Not in a raid group"
    end
    local share = s.online > 0 and math.floor(s.crt * 100 / s.online + 0.5) or 0
    return string.format("%s, %d of %d running CRT (%d%%)", s.team and "Team raid" or "Not a team raid", s.crt, s.online, share)
end

-- General Settings' status line and /crt team: "Now: Team raid, 18 of 20 running CRT (90%)."
function Team.StatusLine(s)
    return "Now: " .. Team.StatusText(s) .. "."
end

-- Saves the threshold from the slider's percent and counts again.
function Team:SetPercent(percent)
    local s = settings()
    if not s or type(percent) ~= "number" then
        return
    end
    percent = math.max(Team.MIN_PERCENT, math.min(Team.MAX_PERCENT, math.floor(percent / Team.STEP + 0.5) * Team.STEP))
    s.threshold = percent / 100
    set(snap.raid, snap.crt, snap.online)
end

-- Pulls --------------------------------------------------------------------------------------------------------

local pulls = {} -- the last KEEP pulls' snapshots, newest last: { encounterID, at = time(), snap }

local function startPull(encounterID)
    Team:Recount()
    pulls[#pulls + 1] = { encounterID = readable(encounterID) and type(encounterID) == "number" and encounterID or nil, at = time(), snap = copy(snap) }
    while #pulls > Team.KEEP do
        table.remove(pulls, 1)
    end
end

-- The snapshot taken at a pull's start: the newest of that boss (any, for nil) starting within MATCH seconds of
-- startedAt (any time, for nil). Nil when there is none.
function Team:AtPull(encounterID, startedAt)
    for i = #pulls, 1, -1 do
        local p = pulls[i]
        local boss = encounterID == nil or p.encounterID == nil or p.encounterID == encounterID
        local when = type(startedAt) ~= "number" or math.abs(p.at - startedAt) <= Team.MATCH
        if boss and when then
            return copy(p.snap)
        end
    end
    return nil
end

-- Whether a pull was a team raid: its snapshot at the start, else the answer now.
function Team:PullIsTeam(encounterID, startedAt)
    local s = self:AtPull(encounterID, startedAt) or snap
    return s.team == true
end

-- The message ----------------------------------------------------------------------------------------------------

function Team.Encode()
    local version = tostring(CRT.version or "dev"):gsub("[|%c]", ""):sub(1, Team.MAX_VERSION_TEXT)
    return "H|" .. Team.VERSION .. "|" .. version
end

-- The message's version and addon version, or nil for anything that isn't a hello this CRT reads.
function Team.Decode(text)
    if not readable(text) or type(text) ~= "string" or #text > 255 then
        return nil
    end
    local version, addon, rest = text:match("^H|(%d+%.?%d*)|([^|]*)(.*)$")
    version = tonumber(version)
    if not version or version < 1 or math.floor(version) > Team.VERSION then
        return nil
    end
    if rest ~= "" and rest:sub(1, 1) ~= "|" then
        return nil
    end
    return version, addon
end

-- Sending --------------------------------------------------------------------------------------------------------

local driver = CreateFrame("Frame")
local wanted, timerSet, combatWait = false, false, false
local lastSent -- GetTime() of your last hello
local tries = { throttle = 0, lock = 0 }

local flush

-- One hello, DEBOUNCE seconds from now and at least WINDOW after the last.
local function request()
    wanted = true
    if timerSet or combatWait then
        return
    end
    local wait = Team.DEBOUNCE
    if lastSent then
        wait = math.max(wait, lastSent + Team.WINDOW - now())
    end
    timerSet = true
    C_Timer.After(wait, flush)
end
Team.Request = request

local function later(seconds)
    timerSet = true
    C_Timer.After(seconds, flush)
end

local function chatLocked()
    if C_ChatInfo and C_ChatInfo.InChatMessagingLockdown then
        local ok, locked = pcall(C_ChatInfo.InChatMessagingLockdown)
        return ok and readable(locked) and locked == true
    end
    return false
end

flush = function()
    timerSet = false
    if not wanted then
        return
    end
    if not Team.CanSend() or not (C_ChatInfo and C_ChatInfo.SendAddonMessage) then
        wanted = false
        return
    end
    if InCombatLockdown() then
        combatWait = true
        driver:RegisterEvent("PLAYER_REGEN_ENABLED")
        return
    end
    local result
    if chatLocked() then
        result = LOCKDOWN
    else
        local ok, r = pcall(C_ChatInfo.SendAddonMessage, Team.PREFIX, Team.Encode(), "RAID")
        result = ok and r or "error"
    end
    if (result == THROTTLED or result == CHANNEL_THROTTLED) and tries.throttle < Team.THROTTLE_TRIES then
        tries.throttle = tries.throttle + 1
        return later(Team.THROTTLE_RETRY)
    elseif result == LOCKDOWN and tries.lock < Team.LOCK_TRIES then
        tries.lock = tries.lock + 1
        return later(Team.LOCK_RETRY)
    end
    wanted = false
    tries.throttle, tries.lock = 0, 0
    if result == nil or result == true or result == SUCCESS then
        lastSent = now()
    end
end

reset = function()
    heard, members = {}, {}
    wanted, combatWait = false, false
    lastSent = nil
    tries.throttle, tries.lock = 0, 0
    driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
end

-- Receiving ------------------------------------------------------------------------------------------------------

-- Takes one hello: the sender, a raid member, runs CRT. A hello from someone not yet known, or from a known member
-- while your own last hello is older than WINDOW, is answered (once, with any others in the window). Returns true
-- when the hello was taken.
function Team:Hear(sender, text)
    if not Team.InRaidGroup() or not Team.Decode(text) then
        return false
    end
    local key = Team.Key(sender)
    if not key or key == me() then
        return false
    end
    if members[key] == nil then
        self:Recount() -- the roster may not have caught up with a joiner yet
        if members[key] == nil then
            return false
        end
    end
    local known = heard[key]
    heard[key] = true
    if not known or not lastSent or now() - lastSent >= Team.WINDOW then
        request()
    end
    count()
    return true
end

-- Events -----------------------------------------------------------------------------------------------------------

local RAID_EVENTS = { "CHAT_MSG_ADDON", "UNIT_CONNECTION", "ENCOUNTER_START" }
local listening = false
local inRaidInstance = false

local function listen(on)
    if on == listening then
        return
    end
    listening = on
    for _, event in ipairs(RAID_EVENTS) do
        if on then
            driver:RegisterEvent(event)
        else
            driver:UnregisterEvent(event)
        end
    end
end

local function raidInstance()
    local ok, _, kind = pcall(GetInstanceInfo)
    return ok and readable(kind) and kind == "raid" or false
end

-- The driver's OnEvent body, exposed so the tests can drive it.
function Team.HandleEvent(event, ...)
    if event == "GROUP_ROSTER_UPDATE" then
        local was = snap.raid
        Team:Recount()
        listen(snap.raid)
        if snap.raid and not was then
            request() -- joined a raid group (or the party became one)
        end
    elseif event == "PLAYER_ENTERING_WORLD" then
        local login, reload = ...
        local wasInside = inRaidInstance
        inRaidInstance = raidInstance()
        Team:Recount()
        listen(snap.raid)
        if snap.raid and (login or reload or (inRaidInstance and not wasInside)) then
            request()
        end
    elseif event == "CHAT_MSG_ADDON" then
        local prefix, text, _, sender = ...
        if readable(prefix) and prefix == Team.PREFIX then
            Team:Hear(sender, text)
        end
    elseif event == "UNIT_CONNECTION" then
        Team:Recount()
    elseif event == "ENCOUNTER_START" then
        startPull((...))
    elseif event == "PLAYER_REGEN_ENABLED" then
        driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
        if combatWait then
            combatWait = false
            if wanted then
                request()
            end
        end
    end
end

driver:RegisterEvent("GROUP_ROSTER_UPDATE")
driver:RegisterEvent("PLAYER_ENTERING_WORLD")
driver:SetScript("OnEvent", function(_, event, ...)
    Team.HandleEvent(event, ...)
end)
