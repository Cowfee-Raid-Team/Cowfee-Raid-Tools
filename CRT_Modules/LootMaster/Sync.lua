local ADDON, CRT = ...

-- Sync Master Loot: the raid leader sends their Loot Master settings to a player they pick and to every
-- name on their loot authority list who is in the group (Settings tab). Synced: the response buttons, time
-- to answer, the award message, Send to, the no-roll text, the Raider Score weights, the loot filter and the
-- authority list.
-- Never synced: window places, sort, showAllItems, the Score column switch, anything of a session.
--
-- One message kind, M, on LM.PREFIX to the group channel: "M|<id>:<part>|<fields>". An older CRT drops a
-- kind it doesn't know (Comm.lua's receive), so it ignores every M. Parts of one sync share its id:
--   H  the header: version, then how many N, B, A and T parts' entries follow, then responseSeconds,
--      awardChannel, noRoll, the score weights (LM.SCORE_WEIGHTS order), the authority leader flag (1/0)
--      and (since 0.28) how many F parts follow (1). A header without it (an older leader) has none, and the
--      receiver keeps its own filter.
--   N  who it is for, packed (Wire.Pack): index, Name-Realm
--   B  the buttons, packed like a session's B: index, key, colour, weight, icon, label
--   A  the authority names, packed: index, Name-Realm
--   T  the award message in pieces, so commas and long texts come through: index, text
--   F  the loot filter (LootMaster/Filter.lua), since 0.28: boss (1/0), trash (1/0), quality, item level, and
--      the ticked kinds' keys joined by commas. An older receiver drops a part it doesn't know (below), and
--      the extra header field, so it still applies the rest.
--   P  the leader asks who has a CRT that takes a sync; K is the answer, and also "applied" after a sync. From
--      0.28 K carries the sender's version, so the leader can tell who took the loot filter (an older K has
--      none: that CRT is older than LM.FILTER_SYNC_SINCE and dropped the F part)
-- A receiver keeps the parts until all are in (in any order), then applies them only when the sender is
-- its current raid leader and it is named in N. Every value is cleaned with the Settings tab's own rules,
-- and a Send to the receiver can't post to (LM.CanPostTo) becomes Raid. Parts still missing SYNC_KEEP seconds
-- after the first, or when the leader changes, are dropped.

local LM = CRT.LootMaster
local Wire = LM.Wire

LM.SYNC_WAIT = 5 -- seconds the leader waits for answers before saying who was reached
LM.SYNC_PING_SECONDS = 30 -- at most one "who has CRT" ask this often
LM.SYNC_KEEP = 60 -- seconds a receiver keeps an unfinished sync
LM.SYNC_HELD = "Addon messages are held during a boss encounter."
local CHUNK = 180 -- bytes of award message a T part carries
local LIST_MAX = 40 -- entries of one list a receiver keeps; a header promising more never completes

-- Sending ---------------------------------------------------------------------------------------------

local function newId()
    return string.format("%x", time() % 0xFFFFFF) .. string.format("%02x", math.random(0, 255))
end

-- Whether you can sync now: the raid leader, in a group.
function LM:CanSync()
    return IsInGroup() and UnitIsGroupLeader("player") and true or false
end

-- Why a sync can't start now, or nil: while chat is locked (C_ChatInfo.InChatMessagingLockdown, a boss
-- encounter) addon messages are held, so the answers couldn't come back in time.
function LM:SyncBlocked()
    return LM.ChatLocked() and LM.SYNC_HELD or nil
end

-- Your synced settings, as messages for these recipients (full names). Pure but for LM:Settings().
function LM:SyncMessages(id, recipients)
    local set = self:Settings()
    local leaderOK, names = self:OwnAuthority()
    local out = {}
    local function pack(part, entries)
        for _, text in ipairs((Wire.Pack("M", id .. ":" .. part, entries))) do
            out[#out + 1] = text
        end
    end
    local rec, buttons, auth = {}, {}, {}
    for i, n in ipairs(recipients) do
        rec[i] = { i, n }
    end
    for i, r in ipairs(self:Responses()) do
        buttons[i] = { i, r.key, Wire.Color(r.color), r.weight, r.icon or "", r.label }
    end
    for i, n in ipairs(names) do
        auth[i] = { i, n }
    end
    local text, chunks = LM.CleanAwardMessage(set.awardMessage), {}
    for i = 1, #text, CHUNK do
        chunks[#chunks + 1] = text:sub(i, i + CHUNK - 1)
    end
    local score = set.score or {}
    local head = { id .. ":H", LM.VERSION, #rec, #buttons, #auth, #chunks, self:ResponseSeconds(),
        LM.CleanAwardChannel(set.awardChannel), LM.CleanNoRoll(set.noRoll) }
    for _, k in ipairs(LM.SCORE_WEIGHTS) do
        head[#head + 1] = LM.Clamp(k, score[k])
    end
    head[#head + 1] = leaderOK and 1 or 0
    head[#head + 1] = 1 -- one F part
    out[#out + 1] = Wire.Encode("M", head)
    pack("N", rec)
    pack("B", buttons)
    pack("A", auth)
    for i, c in ipairs(chunks) do
        out[#out + 1] = Wire.Encode("M", { id .. ":T", i, c })
    end
    local filter, ticked = self:Filter(), {}
    for _, k in ipairs(LM.FILTER_KINDS) do
        if filter.kinds[k] then
            ticked[#ticked + 1] = k
        end
    end
    out[#out + 1] = Wire.Encode("M", { id .. ":F", filter.boss and 1 or 0, filter.trash and 1 or 0, filter.quality,
        filter.ilvl, table.concat(ticked, ",") })
    return out
end

-- The last sync you sent: { id, sent = { names in the group }, missing = { names not in it },
-- acked = { [name] = the version their K gave, "" for none }, done }.
LM.syncOut = nil
-- Group members whose CRT answered an ask or a sync: { [Name-Realm] = true }.
LM.syncCapable = {}

local function short(list)
    local out = {}
    for i, n in ipairs(list) do
        out[i] = Ambiguate(n, "short")
    end
    return table.concat(out, ", ")
end

-- The status line for the last sync, or nil before the first. good, when given, wraps the "Synced to"
-- sentence (UI.GoodText on the page in a Modern theme, so it is matcha there; plain in Default: Blizzard).
function LM:SyncStatus(good)
    local o = self.syncOut
    if not o then
        return nil
    end
    if not o.done then
        return string.format("Sending to %s...", short(o.sent))
    end
    local reached, missed, old = {}, {}, {}
    for _, n in ipairs(o.sent) do
        if o.acked[n] then
            reached[#reached + 1] = n
            if not LM.VersionAtLeast(o.acked[n], LM.FILTER_SYNC_SINCE) then
                old[#old + 1] = n
            end
        else
            missed[#missed + 1] = n
        end
    end
    for _, n in ipairs(o.missing) do
        missed[#missed + 1] = n
    end
    local text
    if #reached == 0 then
        text = "Not synced to anyone."
    else
        text = string.format("Synced to %d %s: %s.", #reached, #reached == 1 and "player" or "players", short(reached))
        if good then
            text = good(text)
        end
    end
    if #missed > 0 then
        text = text .. "\nNot reached: " .. short(missed) .. "."
    end
    if #old > 0 then
        text = text .. "\nSynced, but their CRT is too old for the loot filter: " .. short(old) .. "."
    end
    return text
end

-- Sends your settings to target (a name, or nil) and every name on your authority list who is in the
-- group. Only the raid leader, in a group, out of chat lockdown. Returns the status line, or nil when you
-- can't sync; during the chat lockdown the leader's click shows red error text. The wait for answers
-- starts once the queue has sent the last part.
function LM:SyncTo(target)
    if not LM:CanSync() then
        return nil
    end
    if self:SyncBlocked() then
        LM.ShowError(LM.LOCKDOWN_ERROR)
        return nil
    end
    local roster, me = {}, self:Me():lower()
    for _, n in ipairs(self:Roster()) do
        roster[n:lower()] = n
    end
    local sent, missing, seen = {}, {}, {}
    local function want(name)
        name = type(name) == "string" and LM.NormalizeName(strtrim(name)) or nil
        if not name or name == "" or seen[name:lower()] or name:lower() == me then
            return
        end
        seen[name:lower()] = true
        local inGroup = roster[name:lower()]
        if inGroup then
            sent[#sent + 1] = inGroup
        else
            missing[#missing + 1] = name
        end
    end
    want(target)
    local _, names = self:OwnAuthority()
    for _, n in ipairs(names) do
        want(n)
    end
    local o = { id = newId(), sent = sent, missing = missing, acked = {}, done = #sent == 0 }
    self.syncOut = o
    if #sent > 0 then
        local function wait()
            C_Timer.After(LM.SYNC_WAIT, function()
                if LM.syncOut == o then
                    o.done = true
                    CRT:Print("Loot Master: " .. LM:SyncStatus():gsub("\n", " "))
                    LM:Fire("sync")
                end
            end)
        end
        local messages = self:SyncMessages(o.id, sent)
        for i, text in ipairs(messages) do
            LM.SendText(text, i == #messages and wait or nil)
        end
    end
    self:Fire("sync")
    return self:SyncStatus()
end

-- Asks the group who has a CRT that takes a sync (the answers fill syncCapable). At most once every
-- SYNC_PING_SECONDS; returns whether it asked.
local lastPing
function LM:SyncPing()
    if not LM:CanSync() or LM:SyncBlocked() or (lastPing and GetTime() - lastPing < LM.SYNC_PING_SECONDS) then
        return false
    end
    lastPing = GetTime()
    LM.SendText(Wire.Encode("M", { newId() .. ":P" }))
    return true
end

-- Group members (you left out) known to have a CRT that takes a sync, sorted by name.
function LM:SyncTargets()
    local out, me = {}, self:Me()
    for _, n in ipairs(self:Roster()) do
        if n ~= me and LM.syncCapable[n] then
            out[#out + 1] = n
        end
    end
    table.sort(out, function(a, b)
        return a:lower() < b:lower()
    end)
    return out
end

-- Receiving -------------------------------------------------------------------------------------------

local pending -- the sync coming in: { id, from, started, head, rec = {}, buttons = {}, names = {}, chunks = {} }

-- Drops an unfinished sync whose time ran out, or whose sender no longer leads.
local function dropStale()
    if pending and (GetTime() - pending.started > LM.SYNC_KEEP or pending.from ~= LM.LeaderName()) then
        pending = nil
    end
end

local function count(t)
    local n = 0
    for _ in pairs(t) do
        n = n + 1
    end
    return n
end

local function index(v)
    local i = tonumber(v)
    return i and i >= 1 and i <= LIST_MAX and math.floor(i) == i and i or nil
end

local PARTS = {}

PARTS.H = function(p, f)
    local h = { version = f[2], nRec = tonumber(f[3]), nButtons = tonumber(f[4]), nNames = tonumber(f[5]),
        nChunks = tonumber(f[6]), seconds = f[7], channel = f[8], noRoll = f[9], score = {} }
    if not (h.nRec and h.nButtons and h.nNames and h.nChunks) then
        return
    end
    for i, k in ipairs(LM.SCORE_WEIGHTS) do
        h.score[k] = f[9 + i]
    end
    h.leader = f[10 + #LM.SCORE_WEIGHTS] ~= "0"
    h.nFilter = f[11 + #LM.SCORE_WEIGHTS] == "1" and 1 or 0 -- missing from an older leader: no filter
    p.head = h
end

-- A packed list part into one of p's tables: index -> fields.
local function list(key, read)
    return function(p, f)
        for _, e in ipairs(Wire.Unpack(f[2])) do
            local i = index(e[1])
            if i and e[2] and e[2] ~= "" then
                p[key][i] = read(e)
            end
        end
    end
end

PARTS.N = list("rec", function(e)
    return e[2]
end)
PARTS.A = list("names", function(e)
    return e[2]
end)
PARTS.B = list("buttons", function(e)
    return { key = e[2], color = Wire.ParseColor(e[3]), weight = tonumber(e[4]) or 0,
        icon = e[5] ~= "" and e[5] or nil, label = e[6] or e[2] }
end)
-- The filter as sent: every kind this version knows is off unless named.
PARTS.F = function(p, f)
    local kinds = {}
    for _, k in ipairs(LM.FILTER_KINDS) do
        kinds[k] = false
    end
    for k in (tostring(f[6] or "") .. ","):gmatch("%s*(.-)%s*,") do
        if kinds[k] ~= nil then
            kinds[k] = true
        end
    end
    p.filter = { boss = f[2] == "1", trash = f[3] == "1", quality = f[4], ilvl = f[5], kinds = kinds }
end
PARTS.T = function(p, f)
    local i = index(f[2])
    if i then
        p.chunks[i] = f[3] or ""
    end
end

local function complete(p)
    local h = p.head
    return h and count(p.rec) >= h.nRec and count(p.buttons) >= h.nButtons and count(p.names) >= h.nNames
        and count(p.chunks) >= h.nChunks and (h.nFilter == 0 or p.filter ~= nil)
end

-- The values in order, 1 to n (all there: complete() checked).
local function ordered(t, n)
    local out = {}
    for i = 1, n do
        out[#out + 1] = t[i]
    end
    return out
end

-- Applies a complete sync, cleaned like the Settings tab, when you are named in it.
local function apply(p)
    local me, named = LM:Me():lower(), false
    for _, n in pairs(p.rec) do
        named = named or n:lower() == me
    end
    if not named then
        return
    end
    local h, set = p.head, LM:Settings()
    set.responses = LM.CleanResponses(ordered(p.buttons, h.nButtons))
    set.responseSeconds = LM.Clamp("responseSeconds", h.seconds, set.responseSeconds)
    set.awardMessage = LM.CleanAwardMessage(table.concat(ordered(p.chunks, h.nChunks)))
    local channel, closed = LM.CleanAwardChannel(h.channel), nil
    if not LM.CanPostTo(channel) then
        channel, closed = "RAID", channel
    end
    set.awardChannel = channel
    set.noRoll = LM.CleanNoRoll(h.noRoll)
    set.score = set.score or {}
    for _, k in ipairs(LM.SCORE_WEIGHTS) do
        set.score[k] = LM.Clamp(k, h.score[k], set.score[k])
    end
    local names, seen = {}, {}
    for _, n in ipairs(ordered(p.names, h.nNames)) do
        n = LM.NormalizeName(n)
        if n and n ~= "" and not seen[n:lower()] and #names < LM.AUTHORITY_MAX then
            seen[n:lower()] = true
            names[#names + 1] = n
        end
    end
    set.authority = { leader = h.leader, names = names }
    if h.nFilter > 0 then
        set.filter = LM.CleanFilter(p.filter, LM:Filter()) -- a bad quality or item level keeps your own
    end
    if LM.ScoreChanged then
        LM.ScoreChanged()
    end
    LM.SendText(Wire.Encode("M", { p.id .. ":K", LM.VERSION }))
    local line = string.format("Loot Master settings synced from %s.", Ambiguate(p.from, "short"))
    if closed then
        line = line .. string.format(" Send to: %s isn't open to you, so Raid.", LM.PlaceName(closed))
    end
    CRT:Print(line)
    LM:Fire("responses")
    LM:Fire("authority")
    LM:Fire("filter")
end

LM.Handle("M", function(f, sender)
    local id, part = tostring(f[1] or ""):match("^(%w+):(%u)$")
    if not id or not sender then
        return
    end
    if part == "K" then
        -- an answer to your ask, or a sync applied
        LM.syncCapable[sender] = true
        local o = LM.syncOut
        if o and o.id == id then
            o.acked[sender] = f[2] or "" -- the version; none from a CRT older than 0.28
            LM:Fire("sync") -- a late answer updates the line too
        end
        return
    end
    if sender == LM:Me() or sender ~= LM.LeaderName() then
        return -- only from your current raid leader (your own come back to you in a raid)
    end
    if part == "P" then
        LM.SendText(Wire.Encode("M", { id .. ":K", LM.VERSION }))
        return
    end
    local read = PARTS[part]
    if not read then
        return -- a part from a newer version
    end
    dropStale()
    if not pending or pending.id ~= id or pending.from ~= sender then
        local p = { id = id, from = sender, started = GetTime(), rec = {}, buttons = {}, names = {}, chunks = {} }
        pending = p
        C_Timer.After(LM.SYNC_KEEP, function()
            if pending == p then
                pending = nil
            end
        end)
    end
    read(pending, f)
    if complete(pending) then
        local p = pending
        pending = nil
        apply(p)
    end
end)

-- Whether a sync is coming in (for tests).
function LM.SyncPending()
    return pending ~= nil
end

-- A lead change drops an unfinished sync; entering or leaving combat or an encounter updates the button.
local events = CreateFrame("Frame")
for _, e in ipairs({ "GROUP_ROSTER_UPDATE", "PARTY_LEADER_CHANGED", "ENCOUNTER_START", "ENCOUNTER_END",
    "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED" }) do
    events:RegisterEvent(e)
end
events:SetScript("OnEvent", function(_, event)
    if event == "GROUP_ROSTER_UPDATE" or event == "PARTY_LEADER_CHANGED" then
        dropStale()
    end
    LM:Fire("sync")
end)
