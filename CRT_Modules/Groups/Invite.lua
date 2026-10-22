local ADDON, CRT = ...

-- Invites, shared by Raid Groups (Invite missing, the slot menu) and the Late Tracker's Tonight tab.
-- Invite:Send(fullNames, layoutSlots) invites each Name-Realm who isn't in your group yet. When one of
-- them joins, Apply:MoveOne puts only that player into the group the layout gives them, if it has a free
-- spot; anyone else is never moved. Only out of combat, and only as the leader or an assist (or with no
-- group, where you become the leader). A party becomes a raid before a sixth person is needed: with no
-- group, PARTY_SIZE - 1 invites go out, and the rest once the group is a raid.
-- Each name has a state: waiting (not sent yet), invited, joined, moving (a move was asked for), moved
-- (the roster shows them in their group), declined or failed (with a reason). Declines and "player not
-- found" come from the game's system messages (CHAT_MSG_SYSTEM); an invite with no answer after
-- INVITE_TIMEOUT fails with "no answer". Joiners match by their exact Name-Realm only. A player who
-- joins while you or they are in combat is moved once combat ends.

local Groups = CRT.Groups
local UI = CRT.UI

local Invite = { listeners = {} }
CRT.Invite = Invite

local MAX_RAID = 40
local PARTY_SIZE = 5
local ROSTER_DELAY = 0.5 -- seconds after a roster change before reading who joined, so the groups are filled in
-- Seconds before an unanswered invite counts as "no answer", freeing its spot. The game's own invite
-- timeout is about two minutes; confirm in game.
local INVITE_TIMEOUT = 120
local MOVE_CHECK = 3 -- seconds after asking for a move before a roster that doesn't show it means it failed
-- Seconds that a move which can't be made yet (not lead, Arrange Groups running, they're in combat) is
-- tried again, from the join or from the end of combat; also how long an invite waits while you
-- aren't the leader or an assist before it fails.
local MOVE_RETRY = 30
local COMBAT_RECHECK = 5 -- seconds between tries to move a joiner who is in combat themselves

local TEXT = {
    combat = "Invites wait until combat ends.",
    notLead = "Only the raid leader or an assist can invite.",
    nobody = "Everyone is already in the group.",
    invitedMany = 'Invited %d from "%s". Each one moves to their group when they join.',
    invitedManyFree = "Invited %d.",
    invitedOne = "Invited %s. They move to group %d when they join.",
    invitedOneFree = "Invited %s.",
    waiting = "%d more go out once the group is a raid.",
    notComing = "Not coming: %s.",
    stayed = "Left where they joined: %s.",
    afterCombat = "Moving when combat ends: %s.",
    nameReason = "%s (%s)",
    -- reasons
    raidFull = "the raid is full",
    notFound = "not found",
    inGroup = "already in a group",
    ignoring = "ignoring you",
    declined = "declined",
    noInvite = "the game didn't take the invite",
    noAnswer = "no answer",
    notLeadShort = "you aren't lead or assist",
    groupFull = "group %d is full",
    inCombat = "they stayed in combat",
    moveFailed = "the move didn't go through",
    -- a row's state on the Late Tracker
    stateWaiting = "waiting",
    stateInvited = "invited %s",
    stateMoving = "moving to %d",
    stateMoved = "moved to %d",
    stateJoined = "joined",
    stateStayed = "stayed in %d",
    stateAfterCombat = "moves after combat",
}
Invite.TEXT = TEXT

-- The game's system messages that answer an invite: the global string's name, the state and the reason.
local ANSWERS = {
    { global = "ERR_DECLINE_GROUP_S", state = "declined" },
    { global = "ERR_BAD_PLAYER_NAME_S", state = "failed", reason = TEXT.notFound },
    { global = "ERR_ALREADY_IN_GROUP_S", state = "failed", reason = TEXT.inGroup },
    { global = "ERR_IGNORING_YOU_S", state = "failed", reason = TEXT.ignoring },
}

local entries, order = {}, {} -- lower key -> entry, and the keys in the order they were first sent
local batch -- the last Send: { keys = { lower, ... }, from = label }
local refusal -- the reason the last Send was refused, shown until the next one
local converting = false -- ConvertToRaid was called and the roster hasn't changed since
local blockedSince, blockedTimer -- when pump first found you not the leader or an assist, and its timer
local recheckTimer -- a timer to try moves again while a joiner is in combat themselves

local function isTrue(v)
    if issecretvalue and issecretvalue(v) then
        return false
    end
    return v and true or false
end

function Invite:OnChange(fn)
    self.listeners[#self.listeners + 1] = fn
end

function Invite:Fire()
    for _, fn in ipairs(self.listeners) do
        fn()
    end
end

-- Forgets every invite: when a Late Tracker night ends, and in tests.
function Invite:Reset()
    entries, order, batch, refusal, converting = {}, {}, nil, nil, false
    blockedSince, blockedTimer, recheckTimer = nil, false, false -- an old timer still firing only finds nothing to do
    self:Fire()
end

-- Whether an entry is done: moved, declined, failed, left where they joined, or joined with no layout
-- group to move to.
local function finished(e)
    return e.state == "moved" or e.state == "declined" or e.state == "failed"
        or (e.state == "joined" and (e.stayed ~= nil or not e.group))
end

-- Forgets only the finished invites, keeping waiting, invited, moving and joined-not-moved ones, so they
-- still go out and move: when a Late Tracker night starts.
function Invite:Prune()
    local keep = {}
    for _, lower in ipairs(order) do
        if finished(entries[lower]) then
            entries[lower] = nil
        else
            keep[#keep + 1] = lower
        end
    end
    order = keep
    if batch then
        local keys = {}
        for _, lower in ipairs(batch.keys) do
            if entries[lower] then
                keys[#keys + 1] = lower
            end
        end
        batch.keys = keys
    end
    refusal = nil
    self:Fire()
end

function Invite:Entry(key)
    return key and entries[Groups.Normalize(key):lower()]
end

-- true, or false and the reason (TEXT.combat or TEXT.notLead).
function Invite.CanInvite()
    if InCombatLockdown() then
        return false, TEXT.combat
    end
    if IsInGroup() and not (isTrue(UnitIsGroupLeader("player")) or (IsInRaid() and isTrue(UnitIsGroupAssistant("player")))) then
        return false, TEXT.notLead
    end
    return true
end

-- The group a layout puts key in, or nil.
function Invite.GroupOf(slots, key)
    if type(slots) ~= "table" or not key then
        return nil
    end
    local lower = Groups.Normalize(key):lower()
    for i = 1, Groups.NUM_SLOTS do
        local s = slots[i]
        if type(s) == "string" and s ~= "" and s:lower() == lower then
            return math.ceil(i / 5)
        end
    end
end

-- The names in slots (or a list) who aren't in your group, in slot order, each once.
function Invite.Missing(names)
    local lookup = Groups.MakeLookup(Groups:ReadRoster())
    local out, seen = {}, {}
    for i = 1, Groups.NUM_SLOTS do
        local key = names[i]
        if type(key) == "string" and key ~= "" and not seen[key:lower()] and not lookup(key) then
            seen[key:lower()] = true
            out[#out + 1] = key
        end
    end
    return out
end

-- Sending --------------------------------------------------------------------------------------------

local function count(state)
    local n = 0
    for _, lower in ipairs(order) do
        if entries[lower].state == state then
            n = n + 1
        end
    end
    return n
end

local pump

-- Invites nobody answered within INVITE_TIMEOUT fail with "no answer", which frees their spot, so the
-- waiting ones can go out. Returns whether any did.
local function expire()
    local now, changed = time(), false
    for _, lower in ipairs(order) do
        local e = entries[lower]
        if e.state == "invited" and now - (e.at or now) >= INVITE_TIMEOUT then
            e.state, e.reason = "failed", TEXT.noAnswer
            changed = true
        end
    end
    return changed
end

local function sendOne(e)
    local fn = (C_PartyInfo and C_PartyInfo.InviteUnit) or InviteUnit
    if fn and pcall(fn, e.key) then
        e.state, e.at = "invited", time()
        C_Timer.After(INVITE_TIMEOUT + 1, function()
            if expire() then
                pump()
                Invite:Fire()
            end
        end)
    else
        e.state, e.reason = "failed", TEXT.noInvite
    end
end

local function convert()
    local fn = (C_PartyInfo and C_PartyInfo.ConvertToRaid) or ConvertToRaid
    if fn then
        converting = true
        pcall(fn)
    end
end

-- While you aren't the leader or an assist, waiting invites can't go out: after MOVE_RETRY seconds of
-- that they fail with the reason, instead of waiting forever. A timer checks again once.
local function failBlocked()
    local now = time()
    blockedSince = blockedSince or now
    if now - blockedSince > MOVE_RETRY then
        for _, lower in ipairs(order) do
            local e = entries[lower]
            if e.state == "waiting" then
                e.state, e.reason = "failed", TEXT.notLeadShort
            end
        end
    elseif not blockedTimer then
        blockedTimer = true
        C_Timer.After(MOVE_RETRY + 1, function()
            blockedTimer = false
            pump()
            Invite:Fire()
        end)
    end
end

-- Sends the waiting invites the group has room for, converting a party to a raid first when it would
-- need a sixth person. Called after a Send, on every roster change and when invites time out. Sends
-- nothing while you may not invite (combat, or no longer the leader or an assist).
pump = function()
    local ok, why = Invite.CanInvite()
    if not ok then
        if why == TEXT.notLead then
            failBlocked()
        end
        return
    end
    blockedSince = nil
    expire()
    local waiting = {}
    for _, lower in ipairs(order) do
        if entries[lower].state == "waiting" then
            waiting[#waiting + 1] = entries[lower]
        end
    end
    if #waiting == 0 then
        return
    end
    local room = #waiting
    if IsInRaid() then
        room = #waiting
    elseif IsInGroup() then
        if GetNumGroupMembers() + count("invited") + #waiting > PARTY_SIZE then
            if not converting and isTrue(UnitIsGroupLeader("player")) then
                convert()
            end
            return -- the roster change after the conversion sends them
        end
    else
        room = PARTY_SIZE - 1 - count("invited")
    end
    for i = 1, math.min(room, #waiting) do
        sendOne(waiting[i])
    end
end

-- Invites each of fullNames (Name-Realm) who isn't in your group; layoutSlots, when given, is the layout
-- whose groups they move into when they join, and from its name for the status. Returns how many are
-- invited (or wait for the raid), or nil and the reason nothing was sent.
function Invite:Send(fullNames, layoutSlots, from)
    local ok, why = self.CanInvite()
    if not ok then
        refusal = why
        self:Fire()
        return nil, why
    end
    refusal = nil
    expire()
    -- Skipping members uses MakeLookup on purpose: a bare own-realm name counts as here, as the grid
    -- shows it. Joins (Invite:Update) match the exact Name-Realm only.
    local lookup = Groups.MakeLookup(Groups:ReadRoster())
    local list, seen = {}, {}
    for _, name in ipairs(fullNames or {}) do
        local key = Groups.Normalize(name)
        local lower = key:lower()
        if key ~= "" and not seen[lower] and not lookup(key) then
            seen[lower] = true
            list[#list + 1] = key
        end
    end
    -- invites from an earlier Send that haven't been answered still take a spot
    local pending = 0
    for _, lower in ipairs(order) do
        local state = entries[lower].state
        if not seen[lower] and (state == "invited" or state == "waiting") then
            pending = pending + 1
        end
    end
    local room = math.max(0, MAX_RAID - math.max(1, GetNumGroupMembers()) - pending)
    batch = { keys = {}, from = from }
    for i, key in ipairs(list) do
        local lower = key:lower()
        if not entries[lower] then
            order[#order + 1] = lower
        end
        local e = { key = key, group = Invite.GroupOf(layoutSlots, key) }
        if i > room then
            e.state, e.reason = "failed", TEXT.raidFull
        else
            e.state = "waiting"
        end
        entries[lower] = e
        batch.keys[#batch.keys + 1] = lower
    end
    if #list == 0 then
        refusal = TEXT.nobody
    end
    pump()
    self:Fire()
    return math.min(#list, room)
end

-- Answers and joins ------------------------------------------------------------------------------------

-- Your group by exact Name-Realm (lowercase): joiners are never matched by a bare name, so a same-named
-- player from another realm isn't taken for the one invited.
local function rosterByKey()
    local out = {}
    for _, m in ipairs(Groups:ReadRoster()) do
        out[m.key:lower()] = m
    end
    return out
end

-- A move that was asked for and that the roster doesn't show MOVE_CHECK seconds later didn't go
-- through: the player stays where they joined.
local function checkMove(e, token)
    C_Timer.After(MOVE_CHECK, function()
        if e.state ~= "moving" or e.moveToken ~= token then
            return
        end
        local member = rosterByKey()[e.key:lower()]
        if member and member.subgroup == e.group then
            e.state = "moved"
        else
            e.state, e.stayed = "joined", TEXT.moveFailed
            e.subgroup = member and member.subgroup or e.subgroup
        end
        Invite:Fire()
    end)
end

-- Asks Apply:MoveOne to move a joined player into their group. pending counts the moves on their way
-- into each group, which the roster doesn't show yet.
local function tryMove(e, member, pending)
    local result = CRT.Apply:MoveOne(e.key, e.group, pending)
    if result == "sent" then
        e.state = "moving"
        e.moveToken = (e.moveToken or 0) + 1
        pending[e.group] = (pending[e.group] or 0) + 1
        checkMove(e, e.moveToken)
    elseif result == "moved" then
        e.state = "moved"
    elseif result == "full" then
        e.stayed = format(TEXT.groupFull, e.group)
    elseif result == "combat" then
        -- Not left for good: moved once combat ends. While you are in combat the retry window waits for
        -- PLAYER_REGEN_ENABLED; while only they are, it runs from now and a timer tries again.
        e.afterCombat = true
        if not InCombatLockdown() then
            e.retryFrom = e.retryFrom or time()
            if time() - e.retryFrom > MOVE_RETRY then
                e.stayed = TEXT.inCombat
            elseif not recheckTimer then
                recheckTimer = true
                C_Timer.After(COMBAT_RECHECK, function()
                    recheckTimer = false
                    Invite:Update()
                end)
            end
        end
    elseif result == "failed" or time() - (e.retryFrom or e.joinedAt or 0) > MOVE_RETRY then
        e.stayed = TEXT.moveFailed
    end -- busy, absent or denied: tried again on roster changes for MOVE_RETRY seconds
    if result ~= "combat" or e.stayed then
        e.afterCombat = nil
    end
    if e.stayed then
        e.subgroup = member.subgroup
    end
end

-- After a roster change: who joined, whose move landed, and moving the new ones into their layout group.
function Invite:Update()
    converting = false
    local roster = rosterByKey()
    local pending = {}
    for _, lower in ipairs(order) do
        local e = entries[lower]
        local member = roster[lower]
        if e.state == "moving" then
            if member and member.subgroup == e.group then
                e.state = "moved"
            else
                pending[e.group] = (pending[e.group] or 0) + 1
            end
        end
    end
    for _, lower in ipairs(order) do
        local e = entries[lower]
        local member = roster[lower]
        if member and e.state ~= "joined" and e.state ~= "moving" and e.state ~= "moved" then
            e.state, e.reason, e.subgroup, e.joinedAt = "joined", nil, member.subgroup, time()
        end
        if member and e.state == "joined" and e.stayed and member.subgroup == e.group then
            e.state, e.stayed = "moved", nil -- a move that landed after its check after all
        elseif member and e.state == "joined" and e.group and not e.stayed and IsInRaid() then
            tryMove(e, member, pending)
        end
    end
    pump()
    self:Fire()
end

-- "%s declines your group invitation." -> "^(.+) declines your group invitation%.$". A numbered
-- placeholder ("%1$s", used by some client languages) works the same.
local function answerPattern(fmt)
    if type(fmt) ~= "string" then
        return nil
    end
    local marked = fmt:gsub("%%%d*%$?s", "\001")
    local escaped = marked:gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1")
    escaped = escaped:gsub("\001", "(.+)")
    return "^" .. escaped .. "$"
end

-- The invited entry for a name in a system message: as written, with your realm added, or the one
-- invited player of that name.
local function invitedEntry(name)
    local e = entries[name:lower()] or entries[Groups.Normalize(name):lower()]
    if e then
        return e.state == "invited" and e or nil
    end
    local found
    for _, lower in ipairs(order) do
        local x = entries[lower]
        if x.state == "invited" and (lower:match("^[^-]+") or lower) == name:lower() then
            if found then
                return nil
            end
            found = x
        end
    end
    return found
end

function Invite:OnSystemMessage(text)
    if type(text) ~= "string" or (issecretvalue and issecretvalue(text)) then
        return
    end
    for _, answer in ipairs(ANSWERS) do
        local fmt = _G[answer.global]
        if answer.fmt ~= fmt then
            answer.fmt, answer.pattern = fmt, answerPattern(fmt)
        end
        local name = answer.pattern and text:match(answer.pattern)
        local e = name and invitedEntry(name)
        if e then
            e.state, e.reason = answer.state, answer.reason or TEXT.declined
            pump()
            self:Fire()
            return
        end
    end
end

-- Text -------------------------------------------------------------------------------------------------

local function clock(seconds)
    seconds = math.max(0, math.floor(seconds))
    return format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

-- A short coloured state for a row (the Late Tracker's grid), or nil when key wasn't invited.
function Invite:StateText(key, now)
    local e = self:Entry(key)
    if not e then
        return nil
    end
    if e.state == "waiting" then
        return UI.ColorText(TEXT.stateWaiting, "muted")
    elseif e.state == "invited" then
        return UI.ColorText(format(TEXT.stateInvited, clock((now or time()) - (e.at or 0))), "accent")
    elseif e.state == "declined" or e.state == "failed" then
        return UI.BadText(e.reason or TEXT.declined)
    elseif e.state == "moving" then
        return UI.ColorText(format(TEXT.stateMoving, e.group), "accent")
    elseif e.state == "moved" then
        return UI.GoodText(format(TEXT.stateMoved, e.group))
    elseif e.stayed then
        return UI.ColorText(format(TEXT.stateStayed, e.subgroup or 1), "muted")
    elseif e.afterCombat then
        return UI.ColorText(TEXT.stateAfterCombat, "muted")
    end
    return UI.GoodText(TEXT.stateJoined)
end

-- The status line for the pages: what the last Send did, who isn't coming and why, and who was left
-- where they joined. In combat, only that invites wait.
function Invite:Summary()
    if InCombatLockdown() then
        return UI.ColorText(TEXT.combat, "muted")
    end
    if refusal then
        return refusal == TEXT.nobody and refusal or UI.BadText(refusal)
    end
    if not batch or #batch.keys == 0 then
        return ""
    end
    local sent, waiting, notComing, stayed, later = 0, 0, {}, {}, {}
    for _, lower in ipairs(batch.keys) do
        local e = entries[lower]
        local name = Groups.Display(e.key)
        if e.state == "declined" or e.state == "failed" then
            notComing[#notComing + 1] = format(TEXT.nameReason, name, e.reason or TEXT.declined)
        end
        if e.reason ~= TEXT.raidFull and e.reason ~= TEXT.noInvite then
            sent = sent + 1
        end
        if e.state == "waiting" then
            waiting = waiting + 1
        end
        if e.stayed then
            stayed[#stayed + 1] = format(TEXT.nameReason, name, e.stayed)
        elseif e.afterCombat and e.state == "joined" then
            later[#later + 1] = name
        end
    end
    local lines = {}
    local first = entries[batch.keys[1]]
    if #batch.keys == 1 and sent == 1 then
        lines[1] = first.group and format(TEXT.invitedOne, Groups.Display(first.key), first.group) or format(TEXT.invitedOneFree, Groups.Display(first.key))
    elseif batch.from then
        lines[1] = format(TEXT.invitedMany, sent, batch.from)
    else
        lines[1] = format(TEXT.invitedManyFree, sent)
    end
    if waiting > 0 then
        lines[#lines + 1] = UI.ColorText(format(TEXT.waiting, waiting), "muted")
    end
    if #notComing > 0 then
        lines[#lines + 1] = UI.BadText(format(TEXT.notComing, table.concat(notComing, ", ")))
    end
    if #later > 0 then
        lines[#lines + 1] = UI.ColorText(format(TEXT.afterCombat, table.concat(later, ", ")), "muted")
    end
    if #stayed > 0 then
        lines[#lines + 1] = UI.ColorText(format(TEXT.stayed, table.concat(stayed, ", ")), "muted")
    end
    return table.concat(lines, " ")
end

-- Events -----------------------------------------------------------------------------------------------

local rosterToken = 0

-- Reads the roster ROSTER_DELAY seconds from now (the last call wins), then runs Invite:Update.
local function updateSoon()
    rosterToken = rosterToken + 1
    local token = rosterToken
    C_Timer.After(ROSTER_DELAY, function()
        if token == rosterToken then
            Invite:Update()
        end
    end)
end

-- Combat ended: the players who joined during it get their move now, and their retry window starts.
local function afterCombat()
    local now = time()
    for _, lower in ipairs(order) do
        local e = entries[lower]
        if e.afterCombat then
            e.retryFrom = now
        end
    end
    pump()
    updateSoon()
end

local events = CreateFrame("Frame")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:RegisterEvent("PARTY_LEADER_CHANGED")
events:RegisterEvent("PLAYER_REGEN_DISABLED")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("CHAT_MSG_SYSTEM")
events:SetScript("OnEvent", function(_, event, text)
    if event == "CHAT_MSG_SYSTEM" then
        Invite:OnSystemMessage(text)
    elseif event == "GROUP_ROSTER_UPDATE" then
        updateSoon()
    elseif event == "PLAYER_REGEN_ENABLED" then
        afterCombat()
        Invite:Fire()
    else
        Invite:Fire() -- who may invite changed: the pages grey or ungrey their buttons
    end
end)
