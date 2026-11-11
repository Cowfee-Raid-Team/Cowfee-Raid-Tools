local ADDON, CRT = ...

local Groups = CRT.Groups
local Apply = {}
CRT.Apply = Apply

local MAX_STEPS = 150
local STEP_TIMEOUT = 1.5
local MAX_STALLS = 3
local CHAT_GAP = 0.4 -- seconds between two group changes lines, as the Gear Checker spaces its posts (GC.CHAT_GAP)

local run -- state of the apply in progress, nil when idle
local held -- group changes lines waiting for combat, an encounter or the game's chat lockdown to end, or nil

local function inCombat(unit)
    local ok, value = pcall(UnitAffectingCombat, unit)
    if not ok then
        return false
    end
    if issecretvalue and issecretvalue(value) then
        return false
    end
    return value and true or false
end

local function readRaid()
    local members = {}
    for i = 1, GetNumGroupMembers() do
        local name, _, subgroup = GetRaidRosterInfo(i)
        if name then
            members[#members + 1] = {
                index = i,
                name = name,
                key = Groups.Normalize(name):lower(),
                subgroup = subgroup,
                combat = inCombat("raid" .. i),
            }
        end
    end
    return members
end

-- Decide which group every raid member should end up in.
-- Players named in the layout go where the layout says; everyone else keeps their
-- group when there is room and otherwise fills the first free seat.
-- Match the layout's names to actual raid members. Returns want (member key -> group)
-- and missing (display names of layout players who aren't in the raid).
-- Names pasted without a realm are stored with your own realm; if no exact match exists,
-- a bare name matches a raid member of that name when it is unambiguous (cross-realm players).
local function resolveLayout(members, slots)
    local byKey, byBase = {}, {}
    for _, m in ipairs(members) do
        byKey[m.key] = m
        local base = m.key:match("^[^-]+") or m.key
        byBase[base] = byBase[base] or {}
        tinsert(byBase[base], m)
    end
    local ownRealm = (GetNormalizedRealmName() or ""):lower()

    local want, used, pending, missing = {}, {}, {}, {}
    for i = 1, Groups.NUM_SLOTS do
        local key = slots[i]
        if key and key ~= "" then
            local lower = Groups.Normalize(key):lower()
            local group = math.ceil(i / 5)
            if byKey[lower] then
                want[lower] = group
                used[lower] = true
            else
                pending[#pending + 1] = { key = key, lower = lower, group = group }
            end
        end
    end
    for _, p in ipairs(pending) do
        local base = p.lower:match("^[^-]+") or p.lower
        local realm = p.lower:match("%-(.+)$")
        local found
        if realm == ownRealm then
            local candidates = {}
            for _, m in ipairs(byBase[base] or {}) do
                if not used[m.key] then
                    candidates[#candidates + 1] = m
                end
            end
            if #candidates == 1 then
                found = candidates[1]
            end
        end
        if found then
            want[found.key] = p.group
            used[found.key] = true
        else
            missing[#missing + 1] = Groups.Display(p.key)
        end
    end
    return want, missing
end

local function computeTargets(members, slots)
    local want, missing = resolveLayout(members, slots)

    local target, count, leftovers = {}, {}, {}
    for g = 1, 8 do
        count[g] = 0
    end
    for _, m in ipairs(members) do
        local g = want[m.key]
        if g then
            target[m.key] = g
            count[g] = count[g] + 1
        end
    end
    for _, m in ipairs(members) do
        if not target[m.key] then
            if count[m.subgroup] < 5 then
                target[m.key] = m.subgroup
                count[m.subgroup] = count[m.subgroup] + 1
            else
                leftovers[#leftovers + 1] = m
            end
        end
    end
    for _, m in ipairs(leftovers) do
        for g = 1, 8 do
            if count[g] < 5 then
                target[m.key] = g
                count[g] = count[g] + 1
                break
            end
        end
    end
    return target, missing
end

-- Pick one move that puts a misplaced player in the right group without
-- disturbing anyone who is already correct.
local function nextMove(members, target, failed)
    local bucket = {}
    for g = 1, 8 do
        bucket[g] = {}
    end
    for _, m in ipairs(members) do
        bucket[m.subgroup][#bucket[m.subgroup] + 1] = m
    end

    for _, p in ipairs(members) do
        local g = target[p.key]
        if g and p.subgroup ~= g and not p.combat and not failed[p.key] then
            if #bucket[g] < 5 then
                return "set", p, g
            end
            local best
            for _, q in ipairs(bucket[g]) do
                if target[q.key] ~= g and not q.combat then
                    if target[q.key] == p.subgroup then
                        best = q
                        break
                    end
                    best = best or q
                end
            end
            if best then
                return "swap", p, best
            end
            failed[p.key] = true
        end
    end
end

-- Whether chat must wait: combat or a boss encounter (Notes.Busy, which asks the game; in combat when the notes aren't
-- loaded), or the game holds chat messages (C_ChatInfo.InChatMessagingLockdown, as GearChecker/Data.lua asks it).
local function busy()
    local Notes = CRT.Notes
    if Notes and Notes.Busy then
        if Notes.Busy() then
            return true
        end
    elseif InCombatLockdown() then
        return true
    end
    if C_ChatInfo and C_ChatInfo.InChatMessagingLockdown then
        local ok, locked = pcall(C_ChatInfo.InChatMessagingLockdown)
        return ok and locked == true
    end
    return false
end

-- Sends lines to raid chat, the first now and the rest CHAT_GAP apart, only in a raid.
-- C_ChatInfo.SendChatMessage(message, chatType), else the older global (warcraft.wiki.gg), in pcall.
local function sendLines(lines)
    local send = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
    if not send or not IsInRaid() then
        return
    end
    for i, line in ipairs(lines) do
        if i == 1 then
            pcall(send, line, "RAID")
        else
            C_Timer.After((i - 1) * CHAT_GAP, function()
                if IsInRaid() then
                    pcall(send, line, "RAID")
                end
            end)
        end
    end
end

-- Post group changes to raid chat (CRTDB.groups.postChanges): when Arrange Groups is done, or stops part-way, one line
-- per group with someone new in it (Groups/Sort.lua's ChangeLines: "[CRT] <Group N Changes>: Name, Name"), the groups
-- everyone was in when it started (before) against the raid as it stands now (members). In combat, a boss encounter or
-- the game's chat lockdown the lines are held, sent once that ends (PLAYER_REGEN_ENABLED, ENCOUNTER_END), and dropped
-- if another Arrange starts first (Alex, 2026-11-11).
local function postChanges(before, members)
    local Sort = CRT.GroupSort
    if not (before and Sort and CRT.db.groups.postChanges) or not IsInRaid() then
        return
    end
    local after = {}
    for _, m in ipairs(members) do
        after[#after + 1] = { key = m.key, name = Groups.Display(m.name), subgroup = m.subgroup }
    end
    local lines = Sort.ChangeLines(before, after)
    if #lines == 0 then
        return
    end
    if busy() then
        held = lines
        return
    end
    sendLines(lines)
end

-- Held lines go once nothing holds chat any more.
local function sendHeld()
    if held and not busy() then
        local lines = held
        held = nil
        sendLines(lines)
    end
end

local function finish(members, reason)
    local state = run
    run = nil
    if reason then
        CRT:Print("Stopped: " .. reason .. ".")
        postChanges(state.before, members or readRaid())
        return
    end

    local stuck = {}
    for _, m in ipairs(members) do
        local g = state.target[m.key]
        if g and m.subgroup ~= g then
            stuck[#stuck + 1] = Groups.Display(m.name) .. (m.combat and " (in combat)" or "")
        end
    end
    if #stuck == 0 then
        CRT:Print("Groups applied.")
    else
        CRT:Print("Groups applied, but couldn't move: " .. table.concat(stuck, ", ") .. ".")
    end
    postChanges(state.before, members)
end

local step
step = function()
    if not run then
        return
    end
    if InCombatLockdown() then
        return finish(nil, "you entered combat")
    end
    if run.steps >= MAX_STEPS then
        return finish(nil, "too many moves, something is wrong")
    end

    local members = readRaid()
    local kind, p, x = nextMove(members, run.target, run.failed)
    if not kind then
        return finish(members)
    end

    run.steps = run.steps + 1
    run.waiting = true
    local token = run.steps
    if kind == "set" then
        SetRaidSubgroup(p.index, x)
    else
        SwapRaidSubgroup(p.index, x.index)
    end

    -- If the roster never reports back, try again, but give up after a few stalls.
    C_Timer.After(STEP_TIMEOUT, function()
        if run and run.waiting and run.steps == token then
            run.waiting = false
            run.stalls = run.stalls + 1
            if run.stalls >= MAX_STALLS then
                return finish(nil, "the server isn't accepting group moves")
            end
            step()
        end
    end)
end

function Apply:CanRun()
    if run then
        return false, "Already applying groups."
    end
    if not IsInRaid() then
        return false, "You need to be in a raid group to apply a layout."
    end
    if not (UnitIsGroupLeader("player") or UnitIsGroupAssistant("player")) then
        return false, "Only the raid leader or an assistant can move players."
    end
    if InCombatLockdown() then
        return false, "You can't move players while in combat."
    end
    return true
end

function Apply:Start(slots)
    local ok, why = self:CanRun()
    if not ok then
        CRT:Print(why)
        return
    end

    local members = readRaid()
    local target, missing = computeTargets(members, slots)
    if #missing > 0 then
        CRT:Print("Not in the raid: " .. table.concat(missing, ", ") .. ".")
    end

    -- before: the group each member is in now, for the group changes post when it is done
    local before = {}
    for _, m in ipairs(members) do
        before[m.key] = m.subgroup
    end
    held = nil -- a post an earlier Arrange holds is dropped
    run = { target = target, failed = {}, steps = 0, stalls = 0, waiting = false, before = before }
    step()
end

-- Moves one raid member into group if it has a free spot, for a player who just joined from an invite
-- (Groups/Invite.lua). Never moves or swaps anyone else. key must be the exact Name-Realm. pending, when
-- given, is { [group] = moves already asked for into it }, which count as taken spots: a move lands later,
-- with a roster update, so the roster read here doesn't show it yet.
-- Returns "sent" (the move was asked for; the roster shows later whether it landed), "moved" (they are
-- already there), "full", "combat" (you or they are in combat), "failed" (the game refused the call),
-- "busy" (Arrange Groups is running and places them), "absent" (not in the raid) or "denied" (not in a
-- raid, or not the leader or an assist).
function Apply:MoveOne(key, group, pending)
    if run then
        return "busy"
    end
    if not IsInRaid() or not (UnitIsGroupLeader("player") or UnitIsGroupAssistant("player")) then
        return "denied"
    end
    if InCombatLockdown() then
        return "combat"
    end
    local members = readRaid()
    local lower = Groups.Normalize(key):lower()
    local player, used = nil, (pending and pending[group]) or 0
    for _, m in ipairs(members) do
        if m.key == lower then
            player = m
        end
        if m.subgroup == group then
            used = used + 1
        end
    end
    if not player then
        return "absent"
    end
    if player.subgroup == group then
        return "moved"
    end
    if player.combat then
        return "combat"
    end
    if used >= 5 then
        return "full"
    end
    if not pcall(SetRaidSubgroup, player.index, group) then
        return "failed"
    end
    return "sent"
end

local events = CreateFrame("Frame")
events:RegisterEvent("GROUP_ROSTER_UPDATE")
events:RegisterEvent("PLAYER_REGEN_DISABLED")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("ENCOUNTER_END")
events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_REGEN_ENABLED" or event == "ENCOUNTER_END" then
        sendHeld()
        return
    end
    if not run then
        return
    end
    if event == "PLAYER_REGEN_DISABLED" then
        finish(nil, "combat started")
    elseif run.waiting then
        run.waiting = false
        run.stalls = 0
        C_Timer.After(0.15, step)
    end
end)
