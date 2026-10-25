local ADDON, CRT = ...

-- Catching up after a /reload, a disconnect or a log out and back in. Each CRT keeps its own part of a
-- session per character (Comm.lua's CRTDBChar.lootSession), but the messages sent while it was away are
-- lost. So once its saved state is back (LM:Fire("restored"), Comm.lua):
--   a raider asks the group "what's running?" (V), and the looter answers once: the session again (S, B
--     and I, as at its start) when the raider doesn't have it, then everything it holds now (D parts and a
--     C to end them). A raider whose saved session the looter no longer runs is sent its end (E). The raid
--     leader also sends its loot authority list again (U) and, while CRT Looting is on, a heartbeat
--     (LootMaster/Looting.lua, through LM:Fire("resync")), so the raider's auto-pass gate isn't left waiting.
--   the looter sends everything it holds (D and C) to the group, and each raider sends again any answer of
--     its own the looter doesn't have (an R and its G parts, as at first), so nothing answered during the
--     looter's reload is lost.
-- Nothing is sent in combat or during a boss encounter's chat lockdown: it waits for both to end. A raider
-- asks at most once every RESYNC_SECONDS; the looter waits RESYNC_DELAY so asks close together get one
-- answer, and answers at most once every RESYNC_SECONDS.
--
-- Messages, on LM.PREFIX (an older CRT drops a kind it doesn't know, so it never asks or answers):
--   V|<version>|<session id>|<looter>            what's running? The raider's saved session and its looter
--                                                (both empty when it has none)
--   D|<session id>:<stamp>|<entries>             what the looter holds, packed (Wire.Pack), each entry
--                                                  w,<item index>,<Name-Realm>,<response>   given out
--                                                  a,<item index>,<Name-Realm>,<response>,<roll>   an answer
--   C|<session id>|<stamp>|<entries>|<version>   the end of one D: how many entries it had
-- A raider takes D and C only from its session's looter, for that session. Every entry is applied once: an
-- answer or roll it already has, or an item already given out, changes nothing. An item given out is closed
-- on the popup. A raider sends an answer again only when the C's count matches the entries it got (none
-- lost), so it never answers twice for an item the looter already has.

local LM = CRT.LootMaster
local Wire = LM.Wire

LM.RESYNC_SECONDS = 10
LM.RESYNC_DELAY = 1

-- Whether a message may go now: in a group, out of combat and out of an encounter's chat lockdown.
local function canSend()
    if not IsInGroup() or LM.ChatLocked() then
        return false
    end
    return not (InCombatLockdown and InCombatLockdown())
end

-- Things waiting for combat or the lockdown to end: run once, in order, when canSend says yes (tried when
-- combat or an encounter ends, and every RETRY seconds). Leaving the group drops them.
local RETRY = 5
local waiting, retrying = {}, false

local runWaiting
local function retry()
    if not retrying and #waiting > 0 then
        retrying = true
        C_Timer.After(RETRY, function()
            retrying = false
            runWaiting()
        end)
    end
end

runWaiting = function()
    if not IsInGroup() then
        waiting = {}
        return
    end
    if not canSend() then
        retry()
        return
    end
    local list = waiting
    waiting = {}
    for _, fn in ipairs(list) do
        fn()
    end
end

local function later(fn)
    if canSend() then
        fn()
    elseif IsInGroup() then
        waiting[#waiting + 1] = fn
        retry()
    end
end

-- The raider -------------------------------------------------------------------------------------------

local wantAsk, lastAsk = false, nil

-- Asks once, when it may; a fresh login out of a group yet asks at its first group event.
local function ask()
    if not wantAsk or not IsInGroup() then
        return
    end
    if lastAsk and GetTime() - lastAsk < LM.RESYNC_SECONDS then
        wantAsk = false
        return
    end
    wantAsk = false
    later(function()
        lastAsk = GetTime()
        local inc = LM.incoming
        local own = inc and not inc.test and inc.leader ~= LM:Me() and inc or nil
        LM.SendText(Wire.Encode("V", { LM.VERSION, own and own.id or "", own and own.leader or "" }))
    end)
end

-- The catch-up coming in: { id, stamp, n (entries got), mine = { [item index] = the looter's answer for you } }
local caught

-- An answer from the looter's digest into the raider window's copy, and into your own when it is yours.
-- Returns whether anything changed.
local function takeAnswer(inc, index, name, response, roll)
    local changed = false
    local view = inc.view
    if view then
        local p = view.players[name]
        local a = p and p.answers[index]
        if not (a and a.response == response) and view:Answer(name, index, { response = response }) then
            changed = true
        end
        p = view.players[name]
        a = p and p.answers[index]
        if roll and a and a.response and a.roll ~= roll then
            view:SetRoll(name, index, roll, true)
            changed = true
        end
    end
    if name == LM:Me() then
        local mine = inc.mine[index]
        if not (mine and mine.response) then
            inc.mine[index] = { response = response, roll = roll, closed = mine and mine.closed or nil }
            changed = true
        elseif roll and mine.response == response and mine.roll ~= roll then
            mine.roll = roll
            changed = true
        end
    end
    return changed
end

-- An item given out: kept, and closed on the popup.
local function takeAward(inc, index, name, response)
    local it = inc.items[index]
    if it.award and it.award.name == name and it.award.response == response then
        return false
    end
    it.award = { name = name, response = response }
    local mine = inc.mine[index] or {}
    mine.closed = true
    inc.mine[index] = mine
    return true
end

LM.Handle("D", function(f, sender)
    local id, stamp = tostring(f[1] or ""):match("^([^:]+):(%d+)$")
    local inc = LM.incoming
    if not (id and inc and inc.id == id and inc.leader == sender) or sender == LM:Me() then
        return
    end
    if not (caught and caught.id == id and caught.stamp == stamp) then
        caught = { id = id, stamp = stamp, n = 0, mine = {} }
    end
    local me, changed = LM:Me(), false
    for _, e in ipairs(Wire.Unpack(f[2])) do
        caught.n = caught.n + 1
        local index = tonumber(e[2])
        local name, response = e[3] or "", e[4] or ""
        if index and inc.items[index] and name ~= "" and response ~= "" then
            if e[1] == "w" then
                changed = takeAward(inc, index, name, response) or changed
            elseif e[1] == "a" then
                if name == me then
                    caught.mine[index] = response
                end
                changed = takeAnswer(inc, index, name, response, tonumber(e[5])) or changed
            end
        end
    end
    if changed then
        LM:Fire("incoming")
        LM.Save()
    end
end)

LM.Handle("C", function(f, sender)
    local inc = LM.incoming
    if not (inc and inc.id == f[1] and inc.leader == sender) or sender == LM:Me() then
        return
    end
    local c, count = caught, tonumber(f[3])
    caught = nil
    local got = (c and c.id == f[1] and c.stamp == f[2]) and c.n or 0
    if count ~= got then
        return -- part of it was lost: nothing is sent again
    end
    local mine = c and c.mine or {}
    local again = {}
    for index, m in pairs(inc.mine) do
        local it = inc.items[index]
        if it and not it.award and m.response and mine[index] ~= m.response then
            again[#again + 1] = index
        end
    end
    table.sort(again)
    if #again > 0 then
        later(function()
            for _, index in ipairs(again) do
                LM.SendAnswerAgain(index)
            end
        end)
    end
end)

-- The looter (and the raid leader) ----------------------------------------------------------------------

local want = { ended = {} } -- what the next answer sends: ended ids, session, digest, leader
local scheduled, lastAnswer = false, nil
local stamp = 0

-- Everything the looter holds now, to the group: D parts, then C with how many entries went.
local function sendDigest(s)
    stamp = (stamp % 9999) + 1
    local entries = {}
    for index, it in ipairs(s.items) do
        if it.award then
            entries[#entries + 1] = { "w", index, it.award.name, it.award.response }
        end
    end
    for _, name in ipairs(s.order) do
        local p = s.players[name]
        for index in ipairs(s.items) do
            local a = p.answers[index]
            if a and a.response then
                entries[#entries + 1] = { "a", index, name, a.response, a.roll or "" }
            end
        end
    end
    local messages, tooLong = Wire.Pack("D", s.id .. ":" .. stamp, entries)
    for _, text in ipairs(messages) do
        LM.SendText(text)
    end
    LM.SendText(Wire.Encode("C", { s.id, stamp, #entries - #tooLong, LM.VERSION }))
end

local function answer()
    scheduled = false
    later(function()
        lastAnswer = GetTime()
        local w = want
        want = { ended = {} }
        for id in pairs(w.ended) do
            LM.SendText(Wire.Encode("E", { id }))
        end
        local s = LM.current
        if s and w.digest then
            if w.session then
                LM.SendSession(s)
            end
            sendDigest(s)
        end
        if w.leader and IsInGroup() and UnitIsGroupLeader("player") then
            LM:SendAuthority()
            LM:Fire("resync") -- CRT Looting's heartbeat (LootMaster/Looting.lua)
        end
    end)
end

local function schedule()
    if scheduled then
        return
    end
    scheduled = true
    local wait = LM.RESYNC_DELAY
    if lastAnswer then
        wait = math.max(wait, lastAnswer + LM.RESYNC_SECONDS - GetTime())
    end
    C_Timer.After(wait, answer)
end

LM.Handle("V", function(f, sender)
    local me = LM:Me()
    if not sender or sender == me then
        return
    end
    local id, looter = f[2] or "", f[3] or ""
    local s = LM.current
    local any = false
    if id ~= "" and looter == me and not (s and s.id == id) then
        want.ended[id], any = true, true -- the session it saved is over
    end
    if s then
        want.digest, any = true, true
        want.session = want.session or id ~= s.id
    end
    if IsInGroup() and UnitIsGroupLeader("player") then
        want.leader, any = true, true
    end
    if any then
        schedule()
    end
end)

-- Events -----------------------------------------------------------------------------------------------

LM:OnChange(function(what)
    if what ~= "restored" then
        return
    end
    local s = LM.current
    if s and not s.test and IsInGroup() then
        want.digest = true -- the looter's own reload: raiders send what it missed
        schedule()
    end
    if not s then
        wantAsk = true
        ask()
    end
end)

local events = CreateFrame("Frame")
for _, e in ipairs({ "GROUP_ROSTER_UPDATE", "PLAYER_REGEN_ENABLED", "ENCOUNTER_END" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event)
    if event == "GROUP_ROSTER_UPDATE" then
        ask()
    end
    runWaiting()
end)
