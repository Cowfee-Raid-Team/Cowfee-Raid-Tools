local ADDON, CRT = ...

-- Catching up after a /reload, a disconnect or a log out and back in. Each CRT keeps its own part of a
-- session per character (Comm.lua's CRTDBChar.lootSession), but the messages sent while it was away are
-- lost. So once its saved state is back (LM:Fire("restored"), Comm.lua):
--   a raider asks the group "what's running?" (V). The looter answers that raider alone, by whisper: the
--     end (E) of a saved session it no longer runs, then what that raider needs (D parts and a C to end
--     them: every item given out, and the raider's own answers and rolls), then the session again (S, B
--     and I, as at its start) when the raider doesn't have it. A whisper reaches only your realm and its
--     connected realms, so a raider with no answer within RESYNC_WAIT asks once more for an answer on the
--     group channel. The raid leader also sends its loot authority list again (U) and, while CRT Looting
--     is on, a heartbeat (LootMaster/Looting.lua, through LM:Fire("resync")), so the raider's auto-pass
--     gate isn't left waiting.
--   the looter, after its own restore, sends everything it holds (D and C, everyone's answers) once to the
--     group, and each raider sends again any answer of its own the looter doesn't have (an R and its G
--     parts, as at first), so nothing answered during the looter's reload is lost.
-- The looter answers one at a time: the next answer waits until the last message of the one before has
-- left the send queue, then one second for each message it sent (the game's allowance comes back at one a
-- second), so a raid of asks never clogs the queue that awards and new sessions use. Asks while its own
-- saved session is still to come back are ignored. Nothing is sent in combat or during a boss encounter's
-- chat lockdown: it waits for both to end. A raider asks at most once every RESYNC_SECONDS.
--
-- Messages, on LM.PREFIX (an older CRT drops a kind it doesn't know, so it never asks or answers):
--   V|<version>|<session id>|<looter>|<g>        what's running? The raider's saved session and its looter
--                                                (both empty when it has none); g: answer on the group channel
--   D|<session id>:<stamp>|<entries>             what the looter holds, packed (Wire.Pack), each entry
--                                                  w,<item index>,<Name-Realm>,<response>   given out
--                                                  a,<item index>,<Name-Realm>,<response>,<roll>   an answer
--   C|<session id>|<stamp>|<entries>|<version>   the end of one D: how many entries it had
-- A raider takes D and C only from its session's looter, for that session; D and C for a session it doesn't
-- have yet are kept a moment, from a sender who may run loot, and applied as the session's items come. Every
-- entry is applied once: an answer or roll it already has, or an item already given out, changes nothing.
-- An item given out is closed on the popup. A raider sends an answer again only when the C's count matches
-- the entries it got (none lost), so it never answers twice for an item the looter already has.

local LM = CRT.LootMaster
local Wire = LM.Wire

LM.RESYNC_SECONDS = 10 -- a raider asks at most this often
LM.RESYNC_DELAY = 1 -- the looter waits at least this long before an answer
LM.RESYNC_WAIT = 15 -- seconds a raider waits for an answer before asking once more, on the group channel
local QUEUE_MAX = 40 -- asks the looter keeps waiting at once (one per raider)
local EARLY_SECONDS = 30 -- how long D and C for a session not yet here are kept

-- Whether a message may go now: in a group, out of combat and out of an encounter's chat lockdown.
local function canSend()
    if not IsInGroup() or LM.ChatLocked() then
        return false
    end
    return not (InCombatLockdown and InCombatLockdown())
end

-- Things waiting for combat or the lockdown to end: run once, in order, when canSend says yes (tried when
-- combat or an encounter ends, and every RETRY seconds). Leaving the group drops them (gone runs).
local RETRY = 5
local waiting, retrying = {}, false
local gone -- set below: what leaving the group resets

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
        gone()
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
    else
        gone()
    end
end

-- A session ID as LM:Start makes them: hex digits, 8 at most.
local function sessionId(id)
    return type(id) == "string" and #id >= 1 and #id <= 8 and id:match("^%x+$") ~= nil
end

-- The raider -------------------------------------------------------------------------------------------

local wantAsk, lastAsk = false, nil
local expect -- an ask waiting for its answer: { at, again (asked on the group channel already) }

local function sendAsk(group)
    lastAsk = GetTime()
    local inc = LM.incoming
    local own = inc and not inc.test and inc.leader ~= LM:Me() and inc or nil
    LM.SendText(Wire.Encode("V", { LM.VERSION, own and own.id or "", own and own.leader or "", group and "g" or "" }))
end

-- Asks once, when it may; a fresh login out of a group yet asks at its first group event. No answer within
-- RESYNC_WAIT (a looter on a realm a whisper can't reach): asked once more, for an answer to the group.
local function ask()
    if not wantAsk or not IsInGroup() then
        return
    end
    wantAsk = false
    if lastAsk and GetTime() - lastAsk < LM.RESYNC_SECONDS then
        return
    end
    later(function()
        sendAsk(false)
        local mine = { at = GetTime() }
        expect = mine
        C_Timer.After(LM.RESYNC_WAIT, function()
            if expect == mine and not mine.again then
                mine.again = true
                later(function()
                    sendAsk(true)
                end)
            end
        end)
    end)
end

-- The catch-up coming in: { id, from, stamp, n (entries got), mine = { [item index] = the looter's answer
-- for you }, entries (kept for a session not here yet), done (its C came), at }
local caught

-- An answer from the looter's digest into the raider window's copy, and into your own when it is yours. A
-- changed answer keeps its note, item level and gear; the roll is the looter's. Returns whether anything
-- changed.
local function takeAnswer(inc, index, name, response, roll)
    local changed = false
    local view = inc.view
    if view and view:Response(response) then
        local p = view.players[name]
        local a = p and p.answers[index]
        if a and a.response and a.response ~= response then
            a.response, a.state = response, "answered"
            changed = true
        elseif not (a and a.response) and view:Answer(name, index, { response = response }) then
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

-- One entry into the session (true when it changed anything); false when its item isn't here (yet).
local function take(inc, e)
    local index = tonumber(e[2])
    local name, response = e[3] or "", e[4] or ""
    if not (index and inc.items[index] and name ~= "" and response ~= "") then
        return false
    end
    if e[1] == "w" then
        return takeAward(inc, index, name, response)
    elseif e[1] == "a" then
        return takeAnswer(inc, index, name, response, tonumber(e[5]))
    end
    return false
end

-- Whether D and C from sender are for your session (from its looter), or for one not here yet that you
-- asked about just now, from someone who may run loot.
local function forYou(id, sender)
    local inc = LM.incoming
    if inc and inc.id == id then
        return inc.leader == sender and "here" or nil
    end
    if expect and GetTime() - expect.at <= EARLY_SECONDS and LM.Allowed(sender) then
        return "early"
    end
    return nil
end

LM.Handle("D", function(f, sender)
    local id, stamp = tostring(f[1] or ""):match("^([^:]+):(%d+)$")
    if not (id and sessionId(id)) or sender == LM:Me() then
        return
    end
    local where = forYou(id, sender)
    if not where then
        return
    end
    if not (caught and caught.id == id and caught.from == sender and caught.stamp == stamp) then
        caught = { id = id, from = sender, stamp = stamp, n = 0, mine = {}, entries = {}, at = GetTime() }
    end
    local inc, me, changed = LM.incoming, LM:Me(), false
    for _, e in ipairs(Wire.Unpack(f[2])) do
        caught.n = caught.n + 1
        if e[1] == "a" and e[3] == me and tonumber(e[2]) then
            caught.mine[tonumber(e[2])] = e[4]
        end
        if where == "here" then
            changed = take(inc, e) or changed
        else
            caught.entries[#caught.entries + 1] = e
        end
    end
    if changed then
        LM:Fire("incoming")
        LM.Save()
    end
end)

LM.Handle("C", function(f, sender)
    local id = f[1]
    if not sessionId(id) or sender == LM:Me() then
        return
    end
    local where = forYou(id, sender)
    if not where then
        return
    end
    expect = nil -- answered
    local c, count = caught, tonumber(f[3])
    local got = (c and c.id == id and c.from == sender and c.stamp == f[2]) and c.n or 0
    if where == "early" then
        if c and count == got then
            c.done = true -- applied as the session comes (below)
        else
            caught = nil
        end
        return
    end
    caught = nil
    if count ~= got then
        return -- part of it was lost: nothing is sent again
    end
    local inc = LM.incoming
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

-- A catch-up that came before its session: applied to each item as it arrives (before the popup opens, as
-- this listener is added before Popup.lua's), dropped once the session is whole or after EARLY_SECONDS.
LM:OnChange(function(what, how)
    if what == "incoming" and how == "ended" then
        expect = nil
    end
    local c = caught
    if what ~= "incoming" or not (c and c.done and c.entries) then
        return
    end
    local inc = LM.incoming
    if GetTime() - c.at > EARLY_SECONDS then
        caught = nil
        return
    end
    if not (inc and inc.id == c.id and inc.leader == c.from) then
        return
    end
    local left = {}
    for _, e in ipairs(c.entries) do
        if not inc.items[tonumber(e[2]) or 0] then
            left[#left + 1] = e
        else
            take(inc, e)
        end
    end
    c.entries = left
    if #left == 0 or inc.got >= inc.n then
        caught = nil
    end
end)

-- The looter (and the raid leader) ----------------------------------------------------------------------

local asks = {} -- answers to send, in order: { name, to (whisper target, nil: the group), ended, session, all }
local busy, timerSet, nextAt = false, false, 0
local wantLeader = false
local stamp = 0
local run -- set below

gone = function()
    asks, busy, timerSet, wantLeader = {}, false, false, false
end

-- The digest for one raider (name; nil: everyone): every item given out, and that raider's answers (or
-- everyone's). Returns the D messages and the C.
local function digest(s, name)
    stamp = (stamp % 9999) + 1
    local entries = {}
    for index, it in ipairs(s.items) do
        if it.award then
            entries[#entries + 1] = { "w", index, it.award.name, it.award.response }
        end
    end
    for _, who in ipairs(s.order) do
        local p = s.players[who]
        if p and (name == nil or who == name) then
            for index in ipairs(s.items) do
                local a = p.answers[index]
                if a and a.response then
                    entries[#entries + 1] = { "a", index, who, a.response, a.roll or "" }
                end
            end
        end
    end
    local messages, tooLong = Wire.Pack("D", s.id .. ":" .. stamp, entries)
    return messages, Wire.Encode("C", { s.id, stamp, #entries - #tooLong, LM.VERSION })
end

-- The next answer goes once the one before has left the queue, one second a message after it.
local function kick()
    if busy or timerSet or (#asks == 0 and not wantLeader) then
        return
    end
    timerSet = true
    C_Timer.After(math.max(LM.RESYNC_DELAY, nextAt - GetTime()), run)
end

local function finish(n)
    busy = false
    nextAt = GetTime() + n
    kick()
end

run = function()
    timerSet = false
    if busy then
        return
    end
    busy = true
    later(function()
        local out = {} -- { text, to }
        if wantLeader then
            wantLeader = false
            if IsInGroup() and UnitIsGroupLeader("player") then
                LM:SendAuthority()
                LM:Fire("resync") -- CRT Looting's heartbeat (LootMaster/Looting.lua)
            end
        end
        local a = table.remove(asks, 1)
        local s = LM.current
        if a then
            if a.ended and not (s and s.id == a.ended) then
                out[#out + 1] = Wire.Encode("E", { a.ended }) -- the session it saved is over
            end
            if s then
                local ds, c = digest(s, not a.all and a.name or nil)
                for _, text in ipairs(ds) do
                    out[#out + 1] = text
                end
                out[#out + 1] = c
            end
        end
        local session = a and s and a.session and s.id ~= a.ended
        if #out == 0 and not session then
            finish(0)
            return
        end
        local n = #out
        for i, text in ipairs(out) do
            local last = i == #out and not session
            LM.SendText(text, last and function()
                finish(n)
            end or nil, a.to)
        end
        if session then
            -- after the D and C, so what was given out is known before the popup opens
            local more
            more = LM.SendSession(s, a.to, function()
                finish(n + (more or 0))
            end)
        end
    end)
end

-- Adds an answer, one per raider (a newer ask replaces theirs); the looter's own broadcast goes first.
local function queue(a)
    for i, q in ipairs(asks) do
        if q.name == a.name then
            table.remove(asks, i)
            break
        end
    end
    if #asks >= QUEUE_MAX then
        return
    end
    if a.all then
        table.insert(asks, 1, a)
    else
        asks[#asks + 1] = a
    end
end

LM.Handle("V", function(f, sender)
    local me = LM:Me()
    if not sender or sender == me or LM.RestorePending() then
        return -- your own saved session isn't back yet: nothing to tell
    end
    local id, looter, group = f[2] or "", f[3] or "", f[4] == "g"
    if id ~= "" and not sessionId(id) then
        return
    end
    local s = LM.current
    local ended = (id ~= "" and looter == me and not (s and s.id == id)) and id or nil
    if ended or s then
        queue({ name = sender, to = not group and sender or nil, ended = ended, session = s ~= nil and id ~= s.id })
    end
    if IsInGroup() and UnitIsGroupLeader("player") then
        wantLeader = true
    end
    kick()
end)

-- Events -----------------------------------------------------------------------------------------------

LM:OnChange(function(what)
    if what ~= "restored" then
        return
    end
    local s = LM.current
    if s and not s.test and IsInGroup() then
        queue({ all = true }) -- the looter's own reload: raiders send what it missed
        kick()
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
        if not IsInGroup() then
            gone()
        end
        ask()
    end
    runWaiting()
end)
