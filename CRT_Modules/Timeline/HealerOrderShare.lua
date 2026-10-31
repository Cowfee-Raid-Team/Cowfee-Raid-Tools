local ADDON, CRT = ...

-- Healer CDs' order sent with a pushed note: when the raid leader or an assistant shares a boss's note (Notes/Comm.lua,
-- every Share and Push note path), their healer order for that boss and the spell order of the healers on it go too
-- (Timeline/HealerOrder.lua), so raiders see the healers as the lead laid them out (Alex, 2026-10-31).
-- Sending (Share:Push(encounterID)): nothing when the lead has no saved order for the boss or its healers, so a lead
-- who never reorders changes nobody's view. Sent on every push (late joiners get it), only not twice within a few
-- seconds; players who left aren't sent. In combat, a boss fight, or too long, one chat line says it wasn't sent.
-- Never in combat or a boss fight (Notes.Busy), only by the leader or an assistant, through CRT.Comm:Send on the group
-- channel.
-- Receiving (Share.Receive): never while you lead the group (the leader keeps their own order, as with the roster);
-- else only from the leader or an assistant, never your own (CRT.NoteComm.Sender). It replaces your order for that
-- boss (unless none came) and those healers' spell orders; anything else of yours stays. Parts that don't all arrive within TIMEOUT
-- seconds, don't add up to their hash, or don't read are dropped.
--
-- Message under the prefix CRTHealOrd1: "<hash>|<part>|<total>|<data>", as the roster's (Groups/Share.lua). The text:
--   line 1  the encounter ID
--   line 2  the healer keys in order, tab-separated (may be empty: the lead has only spell orders; yours stays)
--   then    one line per healer with a spell order: its key, a tab, the spell IDs in order with commas
-- Game calls (warcraft.wiki.gg, read 2026-10-31): C_ChatInfo.RegisterAddonMessagePrefix(prefix), at most 16
-- characters; CHAT_MSG_ADDON (prefix, text, channel, sender, ...), taken only on RAID, PARTY or INSTANCE_CHAT;
-- UnitIsGroupLeader; GetTime.

local Shared = CRT.Comm

local Share = {}
CRT.HealerOrderShare = Share

local PREFIX = "CRTHealOrd1"
local CHUNK = 200 -- data bytes a part; the header is at most 21 characters, so a message stays under 255
local MAX_PARTS = 10
local MAX_KEYS = 60 -- healers, or spell lines, a message may hold
local MAX_SPELLS = 40 -- spells on one healer's line
local MAX_KEY_LEN = 64
local TIMEOUT = 30
local CHANNELS = { RAID = true, PARTY = true, INSTANCE_CHAT = true }
Share.PREFIX = PREFIX

local TEXT = {
    received = "Healer CDs: %s's healer order for %s is now yours.",
    busy = "Healer order not sent: not in combat or a boss fight.",
    tooLong = "Healer order not sent: it is too long to send.",
    thisBoss = "this boss",
}
Share.TEXT = TEXT

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
end

local GUARD = 3 -- seconds the same order isn't sent again on the same channel (a double click)
local lastSent = {} -- channel .. ":" .. encounterID -> { hash, at } of the order sent there last
local WHAT = { what = "the healer order", locked = "Healer orders", dropped = function()
    wipe(lastSent)
end }
local incoming = {} -- sender -> { hash, total, parts, count, started }

local function Order()
    return CRT.TimelineHealerOrder
end

-- A key that can go in a message: text with no tab, line break or bar, not too long.
local function goodKey(k)
    return type(k) == "string" and k ~= "" and #k <= MAX_KEY_LEN and not k:find("[\t\r\n|]")
end

-- The roster's players (HealerView.Players), or none.
local function rosterPlayers()
    local HV = CRT.TimelineHealerView
    local ok, players = false, nil
    if HV and HV.Players then
        ok, players = pcall(HV.Players)
    end
    return ok and type(players) == "table" and players or {}
end

-- The boss's saved order without the players who left: a key goes when it is a roster player's (any role: the raid
-- note can give anyone a block), an assigned slot's player, or a slot's own ("slot:...", a key of this boss only).
function Share.ShownHealers(encounterID, players)
    local O = Order()
    local here = {}
    for _, p in ipairs(players or rosterPlayers()) do
        if type(p.key) == "string" then
            here[p.key:lower()] = true
        end
    end
    local Slots = CRT.TimelineHealerSlots
    for _, s in ipairs(Slots and Slots.List(encounterID) or {}) do
        if type(s.player) == "string" then
            here[s.player:lower()] = true
        end
    end
    local out = {}
    for _, k in ipairs(O and O.Healers(encounterID) or {}) do
        if goodKey(k) and (here[k] or k:find("^slot:")) and #out < MAX_KEYS then
            out[#out + 1] = k
        end
    end
    return out
end

-- The keys of the healers on a boss whose spell order may go: those in its order (healers, ShownHealers'), the roster's
-- healers' and the boss's slots' (Timeline/HealerSlots.lua; an open one's by its spec). Each once.
function Share.BossKeys(encounterID, healers, players)
    local out, seen = {}, {}
    local function add(k)
        if goodKey(k) and not seen[k] then
            seen[k] = true
            out[#out + 1] = k
        end
    end
    for _, k in ipairs(healers or {}) do
        if not k:find("^slot:") then
            add(k)
        end
    end
    for _, p in ipairs(players or rosterPlayers()) do
        if p.role == "HEALER" and type(p.key) == "string" then
            add(p.key:lower())
        end
    end
    local Slots = CRT.TimelineHealerSlots
    for _, s in ipairs(Slots and Slots.List(encounterID) or {}) do
        add(s.player and s.player:lower() or ("spec:" .. s.spec))
    end
    return out
end

-- The text for a boss's order: nil when nothing of it is saved.
function Share.Text(encounterID)
    local O = Order()
    if not (O and type(encounterID) == "number") then
        return nil
    end
    local players = rosterPlayers()
    local healers = Share.ShownHealers(encounterID, players)
    local lines = { tostring(encounterID), table.concat(healers, "\t") }
    for _, k in ipairs(Share.BossKeys(encounterID, healers, players)) do
        local ids = {}
        for _, id in ipairs(O.Spells(k) or {}) do
            if type(id) == "number" and id > 0 and id == math.floor(id) and #ids < MAX_SPELLS then
                ids[#ids + 1] = tostring(id)
            end
        end
        if #ids > 0 and #lines - 2 < MAX_KEYS then
            lines[#lines + 1] = k .. "\t" .. table.concat(ids, ",")
        end
    end
    if #healers == 0 and #lines == 2 then
        return nil
    end
    return table.concat(lines, "\n")
end

-- The encounter ID, healer keys and spell orders ({ [key] = { spellID, ... } }) of a text; nil when it doesn't read.
function Share.Read(text)
    if type(text) ~= "string" then
        return nil
    end
    local lines = {}
    for line in (text .. "\n"):gmatch("([^\n]*)\n") do
        lines[#lines + 1] = line
    end
    local encounterID = lines[1] and lines[1]:match("^%d+$") and tonumber(lines[1])
    if not (encounterID and lines[2] ~= nil) or #lines - 2 > MAX_KEYS then
        return nil
    end
    local healers, seen = {}, {}
    if lines[2] ~= "" then
        for k in (lines[2] .. "\t"):gmatch("([^\t]*)\t") do
            if not goodKey(k) or seen[k] then
                return nil
            end
            seen[k] = true
            healers[#healers + 1] = k
        end
    end
    if #healers > MAX_KEYS then
        return nil
    end
    local spells = {}
    for i = 3, #lines do
        local k, list = lines[i]:match("^([^\t]+)\t([%d,]+)$")
        if not (goodKey(k) and list) or spells[k] then
            return nil
        end
        local ids = {}
        for id in (list .. ","):gmatch("([^,]*),") do
            local n = id:match("^%d+$") and tonumber(id)
            if not n or n <= 0 or #ids >= MAX_SPELLS then
                return nil
            end
            ids[#ids + 1] = n
        end
        spells[k] = ids
    end
    return encounterID, healers, spells
end

-- The messages for a text, in order, and its hash.
function Share.Pack(text)
    local hash = Shared.Fingerprint(text)
    local parts = {}
    for pos = 1, #text, CHUNK do
        parts[#parts + 1] = text:sub(pos, pos + CHUNK - 1)
    end
    local out = {}
    for i, part in ipairs(parts) do
        out[i] = hash .. "|" .. i .. "|" .. #parts .. "|" .. part
    end
    return out, hash
end

local function busy()
    local Notes = CRT.Notes
    if Notes and Notes.Busy then
        return Notes.Busy()
    end
    return InCombatLockdown and InCombatLockdown() or false
end

-- Sends the boss's order to the group, as a note of it is shared: every push, so a raider who joined late or reordered
-- since gets it again (the receiver takes a repeat quietly). Only the same order on the same channel within GUARD
-- seconds (a double click) is not sent twice. In combat or a boss fight, or too long for MAX_PARTS, one chat line says
-- why. Returns whether it went.
function Share:Push(encounterID)
    if type(encounterID) ~= "number" then
        return false
    end
    local channel = Shared.Channel()
    if not (channel and Shared.IsLeaderOrAssist("player")) then
        return false
    end
    local text = Share.Text(encounterID)
    if not text then
        return false
    end
    if busy() then
        CRT:Print(TEXT.busy)
        return false
    end
    local messages, hash = Share.Pack(text)
    if #messages > MAX_PARTS then
        CRT:Print(TEXT.tooLong)
        return false
    end
    local key = channel .. ":" .. encounterID
    local last = lastSent[key]
    if last and last.hash == hash and GetTime() - last.at < GUARD then
        return false
    end
    lastSent[key] = { hash = hash, at = GetTime() } -- a drop while it waits on the throttle (WHAT.dropped) clears it
    if not Shared:Send(PREFIX, messages, WHAT) then
        lastSent[key] = nil
        return false
    end
    return true
end

-- Receiving ---------------------------------------------------------------------------------------------------------

local function bossName(encounterID)
    local B = CRT.Bosses
    local boss = B and B.Get and B:Get(encounterID)
    return boss and type(boss.name) == "string" and boss.name or TEXT.thisBoss
end

local function same(a, b)
    if #(a or {}) ~= #(b or {}) then
        return false
    end
    for i, v in ipairs(a or {}) do
        if b[i] ~= v then
            return false
        end
    end
    return true
end

-- Takes a received order: the boss's healer order replaced (none sent: yours stays, the lead had only spell orders)
-- and those healers' spell orders. True when anything changed.
function Share.Apply(encounterID, healers, spells)
    local O = Order()
    if not O then
        return false
    end
    local changed = false
    if #healers > 0 then
        changed = not same(O.Healers(encounterID), healers)
        O.SetHealers(encounterID, healers)
    end
    for k, ids in pairs(spells) do
        changed = changed or not same(O.Spells(k), ids)
        O.SetSpells(k, ids)
    end
    if changed and CRT.TimelineHealerView and CRT.TimelineHealerView.Changed then
        CRT.TimelineHealerView.Changed() -- an open Healer CDs draws again
    end
    return changed
end

local function store(short, text)
    local encounterID, healers, spells = Share.Read(text)
    if not encounterID then
        return
    end
    if Share.Apply(encounterID, healers, spells) then
        CRT:Print(string.format(TEXT.received, short, bossName(encounterID)))
    end
end

function Share.Receive(prefix, message, channel, sender)
    if Shared.IsSecret(prefix) or Shared.IsSecret(message) or Shared.IsSecret(channel) or Shared.IsSecret(sender) then
        return
    end
    if prefix ~= PREFIX or type(message) ~= "string" or type(sender) ~= "string" or not CHANNELS[channel] then
        return
    end
    -- the group's leader keeps their own order: never one from anyone, assistants included, as with the roster
    if UnitIsGroupLeader("player") then
        return
    end
    local NoteComm = CRT.NoteComm
    local short, trusted
    if NoteComm and NoteComm.Sender then
        short, trusted = NoteComm.Sender(sender)
    end
    if not (short and trusted) then
        return
    end
    local hash, part, total, data = message:match("^(%x+)|(%d+)|(%d+)|(.*)$")
    part, total = tonumber(part), tonumber(total)
    if not (hash and part and total) or total < 1 or total > MAX_PARTS or part < 1 or part > total or #data > CHUNK then
        return
    end
    local now = GetTime()
    for key, buffer in pairs(incoming) do
        if now - buffer.started > TIMEOUT then
            incoming[key] = nil
        end
    end
    local buffer = incoming[sender]
    if not buffer or buffer.hash ~= hash or buffer.total ~= total then
        buffer = { hash = hash, total = total, parts = {}, count = 0, started = now }
        incoming[sender] = buffer
    end
    if not buffer.parts[part] then
        buffer.parts[part] = data
        buffer.count = buffer.count + 1
    end
    if buffer.count < buffer.total then
        return
    end
    incoming[sender] = nil
    local text = table.concat(buffer.parts, "", 1, buffer.total)
    if Shared.Fingerprint(text) ~= hash then
        return
    end
    store(short, text)
end

local events = CreateFrame("Frame")
events:RegisterEvent("CHAT_MSG_ADDON")
events:SetScript("OnEvent", function(_, _, prefix, message, channel, sender)
    Share.Receive(prefix, message, channel, sender)
end)
