local ADDON, CRT = ...

-- Team raids (CRT.Team): which team tonight's raid is, so Season Stats, Tattlebot and the Late Tracker can keep a
-- team's numbers apart from a night with other players. One owner every module asks.
--
-- The rule: tonight's team is picked on General Settings > Team raids (Pug or a team you added; the list is
-- TeamList.lua) or set by the raid leader's push. In a raid group (not a party, not solo, not a finder group) the
-- group is a team raid when tonight's team isn't Pug; outside one there is no team (nil). Team:IsTeam() answers now,
-- Team:Tonight() is the name,
-- Team:Snapshot() gives { team = name or nil, isTeam, crt, online, raid, setBy, lead }, Team:AtPull(encounterID, startedAt) the
-- snapshot taken at that pull's ENCOUNTER_START (so a pull keeps the team it started with), Team:PullTeam the name at
-- a pull, Team:OnChange(fn) fires when IsTeam flips, Team:OnRecount(fn) on any change of the snapshot and
-- Team:OnNewGroup(fn) when you join a new raid group (TeamPopup.lua asks which team it is).
--
-- Per character, in CRTDBChar.team (a character's group is its own): tonight (the name; "Team", the built-in team
-- from before it left the list, none, or a removed team reads as last, the last of your teams picked, else Pug),
-- last, picked (tonight was picked outside a raid group; read no more: a new group always starts on the team you
-- last had), groupKey (set while in a raid group, so a /reload in the same group is no new group), setBy and setByKey
-- (the raid leader who pushed tonight's team: the pick is locked until you leave the group, or that player stops
-- leading), pushed (the team you pushed as the raid leader, sent again to joiners) and asked (the group the popup
-- was shown in, so it asks once).
--
-- Who runs CRT: every raid member a hello was heard from (you count). Members who leave the group or go offline
-- are dropped on GROUP_ROSTER_UPDATE (or UNIT_CONNECTION), so they count again once they say hello again; the set
-- resets when you leave the group. The count is for the status line ("pushed to N CRT users").
--
-- The messages, under the prefix CRTHello, to and heard on the RAID channel only:
--   H|<version>|<addon version>[|A]          the hello, e.g. "H|1|1.1.2" or "H|1|1.1.2|A"
--   H|<version>|<addon version>|[A]|<spec>   with the sender's SpecializationID when the game gives one, e.g.
--                                            "H|1|1.1.2||65" or "H|1|1.1.2|A|65" (kept in CRT.Groups' spec cache)
--   T|<version>|<team name>                  the raid leader's push of tonight's team, e.g. "T|1|Cowfee Mythic"
--                                            (a name is 1 to 24 characters with no |; TeamList.lua)
-- A later minor version may add fields after these, which are skipped; a higher major version or another kind is
-- left alone. A CRT from before the spec field reads the same version, addon version and A from a hello with it,
-- and a CRT from before T reads it as no hello (its Decode matches H only) and drops it.
-- A push is taken only from the current raid leader: the roster row whose name is the sender's, asked with
-- UnitIsGroupLeader("raidN"); never from anyone else, never from a secret name.
-- The spec goes only with the hellos below: a spec change sends none of its own.
-- A, answer me, is sent by a CRT that knows nobody: on login, on a reload and on joining a raid group
-- (joiners announce themselves; no other roster change sends a hello). Entering a raid instance sends a plain
-- hello. Every CRT answers a hello with A, and a plain hello only from someone it doesn't know yet (a joiner, or
-- someone heard again after going offline), so a run back after a wipe sends no answers. Answers are plain.
-- The raid leader who pushed a team answers a hello with A with the push again, so a joiner gets it.
-- Each kind goes at most once per WINDOW seconds, DEBOUNCE seconds after the first reason, so a burst of joiners
-- or hellos gets one answer, never one per joiner. Never in combat (sent when it ends), never during the game's
-- addon message lockdown (tried again every LOCK_RETRY seconds, as Gear Checker's and Season Stats' messages
-- are, and once more at ENCOUNTER_END when the lockdown outlasts the tries), never in a finder group
-- (IsInGroup(LE_PARTY_CATEGORY_INSTANCE)) or outside a raid group. A sender's name
-- is never compared when secret; names are folded to "name-realm" (lower case, the realm's spaces and dashes
-- left out), the roster's and the senders' alike.
--
-- Cheap: no OnUpdate. The addon message, connection and leader events are listened to only in a raid group, and
-- the roster is read (at most 40 rows) on roster, connection, leader and message events and at a pull's start.
--
-- Game calls (warcraft.wiki.gg, read 2026-10-24 and 2026-10-27): C_ChatInfo.RegisterAddonMessagePrefix,
-- SendAddonMessage (Enum.SendAddonMessageResult), InChatMessagingLockdown, CHAT_MSG_ADDON (prefix, text, channel,
-- sender), GetRaidRosterInfo (8th return online: 1 or nil), UnitIsGroupLeader (unit), PARTY_LEADER_CHANGED,
-- PLAYER_ENTERING_WORLD (isInitialLogin, isReloadingUi), UNIT_CONNECTION (unit, isConnected), GROUP_ROSTER_UPDATE,
-- ENCOUNTER_START (encounterID, ...), IsInRaid, IsInGroup, InCombatLockdown, GetInstanceInfo,
-- GetNormalizedRealmName, UnitName, GetTime, time.

local Team = { listeners = {}, recounts = {}, newGroups = {} }
CRT.Team = Team

Team.PREFIX = "CRTHello"
Team.VERSION = 1
Team.TEAM_VERSION = 1 -- the T message's
Team.WINDOW = 10 -- seconds: at most one message of a kind in this time
Team.DEBOUNCE = 2 -- seconds after the first reason before a message goes, so a burst sends one
Team.LOCK_RETRY = 10 -- seconds between tries while the game holds addon messages
Team.LOCK_TRIES = 30 -- about five minutes of tries, past any encounter
Team.THROTTLE_RETRY = 2
Team.THROTTLE_TRIES = 3
Team.KEEP = 4 -- pulls whose snapshot is kept
Team.MATCH = 10 -- seconds between a pull's start and its snapshot
Team.LOGIN_WAIT = 10 -- seconds a fresh login out of a raid group waits for the group before it counts as left
Team.MAX_RAID = 40
Team.MAX_VERSION_TEXT = 24
Team.TEAM, Team.PUG = "Team", "Pug" -- the two built-in teams (TeamList.lua)

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
Team.Readable = readable

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

local function unitLeads(unit)
    if not UnitIsGroupLeader then
        return nil
    end
    local ok, lead = pcall(UnitIsGroupLeader, unit)
    if not ok or not readable(lead) then
        return nil
    end
    return lead and true or false
end

-- Whether you lead your raid group.
function Team.AmLeader()
    return Team.InRaidGroup() and unitLeads("player") == true
end

-- Whether the raid member with this key leads the raid: true or false, or nil when it can't be told (a secret
-- roster row, or a secret answer). A key not in the raid is false.
function Team.IsLeaderKey(key)
    if not key then
        return false
    end
    local unsure = false
    for i = 1, Team.MAX_RAID do
        local ok, name = pcall(GetRaidRosterInfo, i)
        if ok and name ~= nil then
            if not readable(name) then
                unsure = true
            elseif Team.Key(name) == key then
                return unitLeads("raid" .. i)
            end
        end
    end
    if unsure then
        return nil
    end
    return false
end

-- Tonight's team ---------------------------------------------------------------------------------------------------

-- Your character's team state (CRTDBChar.team), made when missing.
local function state()
    CRTDBChar = type(CRTDBChar) == "table" and CRTDBChar or {}
    if type(CRTDBChar.team) ~= "table" then
        CRTDBChar.team = {}
    end
    return CRTDBChar.team
end
Team.State = state

-- A saved name as it reads now: the built-in or listed team it names (TeamList.lua's Find, any case), else Team
-- (a team removed since, or none saved).
local function resolve(name)
    -- a stamp's name, never tonight's (Team:Tonight): the built-in Team is the scope of the counts from before teams
    local found = Team.Find and Team:Find(name)
    return found or Team.TEAM
end
Team.Resolve = resolve

-- Tonight's team: Pug or one of your teams, never the built-in Team (the scope of the counts from before teams).
-- A saved "Team", none, or a team removed since reads as the last of your teams picked (state().last), else Pug.
function Team:Tonight()
    local s = state()
    local found = Team.Find and Team:Find(s.tonight)
    if found and found ~= Team.TEAM then
        return found
    end
    local last = Team.Find and Team:Find(s.last)
    if last and last ~= Team.TEAM and last ~= Team.PUG then
        return last
    end
    return Team.PUG
end

-- Notes the last of your teams picked (or pushed), which a saved "Team" or a removed team reads as.
local function noteLast(name)
    if name ~= Team.TEAM and name ~= Team.PUG then
        state().last = name
    end
end

-- The raid leader who set tonight's team, while it is locked: the name they sent from (no realm), else nil.
function Team:LockedBy()
    local s = state()
    if s.setByKey and s.groupKey and Team.InRaidGroup() then
        return s.setBy or "?"
    end
    return nil
end

function Team:IsLocked()
    return self:LockedBy() ~= nil
end

-- The count ----------------------------------------------------------------------------------------------------

local heard = {} -- [key] = true: raid members a hello came from (you included)
local members = {} -- [key] = online, the last roster read
local snap = { team = nil, isTeam = false, crt = 0, online = 0, raid = false, lead = false }

local function copy(t)
    return { team = t.team, isTeam = t.isTeam, crt = t.crt, online = t.online, raid = t.raid, setBy = t.setBy, lead = t.lead }
end

-- A raid group is a team raid unless tonight's team is Pug. Out of a raid group (solo, a party, a finder group such
-- as Raid Finder) there is no team: team is nil, so a pull there counts under no team (Season Stats' All only).
-- lead: whether you lead the raid group, so the settings page's Push to raid follows a change of leader.
local function set(raid, crt, online)
    local team = raid and Team:Tonight() or nil
    local isTeam = raid and team ~= Team.PUG or false
    local setBy = raid and Team:LockedBy() or nil
    local lead = raid and Team.AmLeader() or false
    local changed = isTeam ~= snap.isTeam
    local moved = changed or raid ~= snap.raid or crt ~= snap.crt or online ~= snap.online or team ~= snap.team or setBy ~= snap.setBy
        or lead ~= snap.lead
    snap = { team = team, isTeam = isTeam, crt = crt, online = online, raid = raid, setBy = setBy, lead = lead }
    if changed then
        fire(Team.listeners, isTeam, copy(snap))
    end
    if moved then
        fire(Team.recounts, copy(snap))
    end
end

-- The snapshot again after tonight's team or its lock changed.
local function update()
    set(snap.raid, snap.crt, snap.online)
end
Team.Update = update

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

-- New and left groups ----------------------------------------------------------------------------------------------

-- settled: whether being out of a raid group can be believed. A fresh login may not know its group yet, so until
-- the first roster event (or LOGIN_WAIT seconds) a saved group isn't given up.
local settled = false

local function newGroup()
    local s = state()
    s.groupKey = string.format("%d", time())
    s.setBy, s.setByKey, s.pushed, s.asked, s.extra = nil, nil, nil, nil, nil
    s.picked = nil -- the new group starts on the team you last had
    fire(Team.newGroups)
end

local function leftGroup()
    local s = state()
    s.groupKey, s.setBy, s.setByKey, s.pushed, s.asked = nil, nil, nil, nil, nil
    s.extra = nil -- a pushed team your full list couldn't keep is gone with the group
end

-- In a raid group: a new one when none was saved, and the lock lifted when its leader no longer leads (the team is
-- kept). Out of one (once settled): the saved group is left, which lifts the lock.
local function checkGroup()
    local s = state()
    if Team.InRaidGroup() then
        if not s.groupKey then
            newGroup()
        elseif s.setByKey and Team.IsLeaderKey(s.setByKey) == false then
            s.setBy, s.setByKey = nil, nil
        end
    elseif settled and s.groupKey then
        leftGroup()
    end
end

function Team:GroupKey()
    return Team.InRaidGroup() and state().groupKey or nil
end

-- Whether the new raid group popup was shown (or answered by a push) in this group; MarkAsked notes it.
function Team:Asked()
    local s = state()
    return s.groupKey ~= nil and s.asked == s.groupKey
end

function Team:MarkAsked()
    local s = state()
    s.asked = s.groupKey
end

function Team:OnNewGroup(fn)
    self.newGroups[#self.newGroups + 1] = fn
end

local reset -- below, with the sending

-- Reads the roster again: members who left or went offline are dropped from who runs CRT. Out of a raid group
-- everything resets.
function Team:Recount()
    checkGroup()
    if not Team.InRaidGroup() then
        if snap.raid or next(heard) then
            reset()
        end
        set(false, 0, 0)
        return
    end
    local roster = readRoster()
    if roster == false then
        update()
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
    return snap.isTeam == true
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

-- Picks tonight's team (Pug or a listed name, any case; never the built-in Team). Refused while a raid leader's
-- push locks it. Returns true when it was set.
function Team:SetTonight(name)
    if self:IsLocked() then
        return false
    end
    local found = Team.Find and Team:Find(name)
    if not found or found == Team.TEAM then
        return false
    end
    local s = state()
    s.tonight = found
    noteLast(found)
    s.picked = not Team.InRaidGroup() or nil
    if s.pushed ~= found then
        s.pushed = nil -- a joiner never gets a team you've moved off; Push to raid sends the new one
    end
    update()
    return true
end

-- Tonight's team in a raid group, else nil (no team: solo, a party, a finder group). What the Late Tracker
-- stamps on a night.
function Team:TeamNow()
    return Team.InRaidGroup() and self:Tonight() or nil
end

-- The status line --------------------------------------------------------------------------------------------------

Team.TEXT = {
    none = "Not in a raid group",
    pushed = "%s pushed to %d CRT %s",
    user = "user", users = "users",
    line = "Now: %s.",
}

-- Other raid members heard running CRT.
local function others()
    local n = 0
    local mine = me()
    for key in pairs(heard) do
        if key ~= mine and members[key] then
            n = n + 1
        end
    end
    return n
end

-- "Cowfee Mythic pushed to 18 CRT users" (you pushed it), "Cowfee Mythic" or "Not in a raid group".
function Team.StatusText()
    if not Team.InRaidGroup() then
        return Team.TEXT.none
    end
    local tonight = Team:Tonight()
    local s = state()
    if s.pushed and s.pushed == tonight and Team.AmLeader() then
        local n = others()
        return string.format(Team.TEXT.pushed, tonight, n, n == 1 and Team.TEXT.user or Team.TEXT.users)
    end
    return tonight
end

-- General Settings' status line and /crt team: "Now: Cowfee Mythic."
function Team.StatusLine()
    return string.format(Team.TEXT.line, Team.StatusText())
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
    return s.isTeam == true
end

-- The team a pull started with: its snapshot at the start, else the team now. Nil for a pull outside a raid group
-- (Raid Finder, a party, solo), which belongs to no team.
function Team:PullTeam(encounterID, startedAt)
    local s = self:AtPull(encounterID, startedAt) or snap
    return s.team
end

-- The message ----------------------------------------------------------------------------------------------------

-- Your spec for the hello: CRT.Groups' reader (CRT_Modules/Groups/Data.lua), nil when the game gives none.
local function mySpec()
    local Groups = CRT.Groups
    if not (Groups and Groups.PlayerSpecID) then
        return nil
    end
    local ok, spec = pcall(Groups.PlayerSpecID)
    return ok and type(spec) == "number" and spec or nil
end

-- ask adds the answer-me field, "H|1|1.1.2|A": sent on login, reload and joining a raid group, when this CRT
-- knows nobody. Your spec follows as one more field when the game gives it, "H|1|1.1.2||65" or "H|1|1.1.2|A|65",
-- for the Timeline's death icons. A CRT from before either field skips them (later fields of the same version).
function Team.Encode(ask)
    local version = tostring(CRT.version or "dev"):gsub("[|%c]", ""):sub(1, Team.MAX_VERSION_TEXT)
    local spec = mySpec()
    if spec then
        return "H|" .. Team.VERSION .. "|" .. version .. "|" .. (ask and "A" or "") .. "|" .. string.format("%d", spec)
    end
    return "H|" .. Team.VERSION .. "|" .. version .. (ask and "|A" or "")
end

-- The message's version, addon version, whether it asks for answers and the sender's spec (nil when it has
-- none), or nil for anything that isn't a hello this CRT reads.
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
    local flag = rest:match("^|([^|]*)")
    local spec = tonumber(rest:match("^|[^|]*|(%d+)$") or rest:match("^|[^|]*|(%d+)|"))
    if spec and spec <= 0 then
        spec = nil
    end
    return version, addon, flag == "A", spec
end

-- The leader's push, "T|1|Cowfee Mythic", or nil for a name TeamList.lua refuses.
function Team.EncodeTeam(name)
    local clean = Team.Clean and Team.Clean(name)
    if not clean then
        return nil
    end
    return "T|" .. Team.TEAM_VERSION .. "|" .. clean
end

-- The pushed team's name, or nil for anything that isn't a push this CRT reads (a later minor version's fields
-- after the name are skipped).
function Team.DecodeTeam(text)
    if not readable(text) or type(text) ~= "string" or #text > 255 then
        return nil
    end
    local version, name = text:match("^T|(%d+%.?%d*)|([^|]*)")
    version = tonumber(version)
    if not version or version < 1 or math.floor(version) > Team.TEAM_VERSION then
        return nil
    end
    return Team.Clean and Team.Clean(name) or nil
end

-- Sending --------------------------------------------------------------------------------------------------------

-- One queue per kind of message: the hello and the push. Each waits, retries and holds the same way.
local driver = CreateFrame("Frame")
local senders = {}

local function newSender(build)
    local q = { build = build, wanted = false, ask = false, timerSet = false, combatWait = false, encounterWait = false, throttle = 0, lock = 0 }
    senders[#senders + 1] = q
    return q
end

local flush

-- One message, DEBOUNCE seconds from now and at least WINDOW after the last; ask makes a hello ask for answers.
local function request(q, ask)
    q.wanted = true
    q.ask = q.ask or ask == true
    if q.timerSet or q.combatWait or q.encounterWait then
        return
    end
    local wait = Team.DEBOUNCE
    if q.lastSent then
        wait = math.max(wait, q.lastSent + Team.WINDOW - now())
    end
    q.timerSet = true
    C_Timer.After(wait, function()
        flush(q)
    end)
end

local function later(q, seconds)
    q.timerSet = true
    C_Timer.After(seconds, function()
        flush(q)
    end)
end

local function chatLocked()
    if C_ChatInfo and C_ChatInfo.InChatMessagingLockdown then
        local ok, locked = pcall(C_ChatInfo.InChatMessagingLockdown)
        return ok and readable(locked) and locked == true
    end
    return false
end

flush = function(q)
    q.timerSet = false
    if not q.wanted then
        return
    end
    if not Team.CanSend() or not (C_ChatInfo and C_ChatInfo.SendAddonMessage) then
        q.wanted = false
        return
    end
    if InCombatLockdown() then
        q.combatWait = true
        driver:RegisterEvent("PLAYER_REGEN_ENABLED")
        return
    end
    local text = q.build(q.ask)
    if not text then
        q.wanted, q.ask = false, false
        return
    end
    local result
    if chatLocked() then
        result = LOCKDOWN
    else
        local ok, r = pcall(C_ChatInfo.SendAddonMessage, Team.PREFIX, text, "RAID")
        result = ok and r or "error"
    end
    if (result == THROTTLED or result == CHANNEL_THROTTLED) and q.throttle < Team.THROTTLE_TRIES then
        q.throttle = q.throttle + 1
        return later(q, Team.THROTTLE_RETRY)
    elseif result == LOCKDOWN then
        if q.lock < Team.LOCK_TRIES then
            q.lock = q.lock + 1
            return later(q, Team.LOCK_RETRY)
        end
        -- held past every retry: kept, and tried again when the encounter ends
        q.lock = 0
        q.encounterWait = true
        return
    end
    q.wanted, q.ask = false, false
    q.throttle, q.lock = 0, 0
    if result == nil or result == true or result == SUCCESS then
        q.lastSent = now()
    end
end

local hello = newSender(function(ask)
    return Team.Encode(ask)
end)
-- the push goes only while you still lead, with the team you pushed
local push = newSender(function()
    local pushed = state().pushed
    return pushed and Team.AmLeader() and Team.EncodeTeam(pushed) or nil
end)

Team.Request = function(ask)
    request(hello, ask)
end

-- A queue held by combat or an encounter: sent now if it still waits.
local function resume(field)
    for _, q in ipairs(senders) do
        if q[field] then
            q[field] = false
            if q.wanted then
                request(q)
            end
        end
    end
end

reset = function()
    heard, members, pulls = {}, {}, {}
    for _, q in ipairs(senders) do
        q.wanted, q.ask, q.combatWait, q.encounterWait = false, false, false, false
        q.lastSent = nil
        q.throttle, q.lock = 0, 0
    end
    driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
end

-- Whether you can push now: the raid leader of a raid group.
function Team.CanPush()
    return Team.AmLeader()
end

-- The raid leader sends tonight's team to the raid (General Settings' Push to raid, the popup's Save and push).
-- Every CRT in the raid takes it and locks its pick. Returns true when it was queued.
function Team:Push()
    if not Team.CanPush() then
        return false
    end
    local s = state()
    s.pushed = self:Tonight()
    s.setBy, s.setByKey = nil, nil -- the leader is never locked by an older push
    s.asked = s.groupKey
    request(push)
    update()
    return true
end

-- Receiving ------------------------------------------------------------------------------------------------------

-- A push from key (a raid member whose name was readable): taken only from the current raid leader. Tonight's team
-- becomes it (added to your list when new) and is locked until you leave the group. Returns true when taken.
local function hearPush(sender, key, name)
    if Team.IsLeaderKey(key) ~= true then
        return false
    end
    local found = Team.Ensure and Team:Ensure(name)
    if not found then
        return false
    end
    local s = state()
    s.tonight = found
    noteLast(found)
    s.setBy = sender:match("^([^%-]+)") or sender
    s.setByKey = key
    s.pushed = nil
    s.asked = s.groupKey -- no popup in this group: the leader answered it
    return true
end

-- Takes one message. A hello: the sender, a raid member, runs CRT. A hello that asks for answers (the sender
-- logged in, reloaded or joined, and knows nobody) is always answered; a plain one only when its sender wasn't known
-- yet. Either way at most once in the window, with any others; a leader who pushed a team sends it again to a hello
-- with A. A push: tonight's team, from the raid leader only. Returns true when the message was taken.
function Team:Hear(sender, text)
    if not Team.InRaidGroup() then
        return false
    end
    local pushed = Team.DecodeTeam(text)
    local version, addon, ask, spec
    if not pushed then
        version, addon, ask, spec = Team.Decode(text)
        if not version then
            return false
        end
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
    if pushed then
        local taken = hearPush(sender, key, pushed)
        if taken then
            heard[key] = true
            count()
        end
        return taken
    end
    -- the sender's spec, for the Timeline's death icons (the sender's name is readable: Key read it)
    local Groups = CRT.Groups
    if spec and Groups and Groups.CacheSpec then
        pcall(Groups.CacheSpec, sender, spec)
    end
    local known = heard[key]
    heard[key] = true
    if ask or not known then
        request(hello)
    end
    if ask and state().pushed and Team.AmLeader() then
        request(push) -- a joiner, or a reload: it gets tonight's team
    end
    count()
    return true
end

-- Events -----------------------------------------------------------------------------------------------------------

local RAID_EVENTS = { "CHAT_MSG_ADDON", "UNIT_CONNECTION", "ENCOUNTER_START", "ENCOUNTER_END", "PARTY_LEADER_CHANGED" }
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
        -- a roster event in a raid group settles it; out of one, a fresh login's group may still be coming, so
        -- only LOGIN_WAIT's timer (or a loading screen that isn't the first) settles it
        if Team.InRaidGroup() then
            settled = true
        end
        local was = snap.raid
        Team:Recount()
        listen(snap.raid)
        if snap.raid and not was then
            request(hello, true) -- joined a raid group (or the party became one): knows nobody yet
        end
    elseif event == "PLAYER_ENTERING_WORLD" then
        local login, reload = ...
        -- a fresh login may not know its group yet: out of one, it waits LOGIN_WAIT seconds before leaving the
        -- saved group
        if login and not Team.InRaidGroup() and not settled then
            C_Timer.After(Team.LOGIN_WAIT, function()
                settled = true
                Team:Recount()
            end)
        else
            settled = true
        end
        local wasInside = inRaidInstance
        inRaidInstance = raidInstance()
        Team:Recount()
        listen(snap.raid)
        if snap.raid and (login or reload) then
            request(hello, true) -- a new copy of the addon knows nobody
        elseif snap.raid and inRaidInstance and not wasInside then
            request(hello) -- into the raid instance: a plain hello, answered only by those who don't know you
        end
    elseif event == "CHAT_MSG_ADDON" then
        local prefix, text, channel, sender = ...
        if readable(prefix) and prefix == Team.PREFIX and readable(channel) and channel == "RAID" then
            Team:Hear(sender, text)
        end
    elseif event == "UNIT_CONNECTION" or event == "PARTY_LEADER_CHANGED" then
        Team:Recount()
    elseif event == "ENCOUNTER_START" then
        startPull((...))
    elseif event == "ENCOUNTER_END" then
        resume("encounterWait")
    elseif event == "PLAYER_REGEN_ENABLED" then
        driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
        resume("combatWait")
    end
end

driver:RegisterEvent("GROUP_ROSTER_UPDATE")
driver:RegisterEvent("PLAYER_ENTERING_WORLD")
driver:SetScript("OnEvent", function(_, event, ...)
    Team.HandleEvent(event, ...)
end)
