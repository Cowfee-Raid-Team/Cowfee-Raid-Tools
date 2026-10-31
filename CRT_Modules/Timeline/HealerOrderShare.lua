local ADDON, CRT = ...

-- Healer CDs' order sent with a pushed note: when the raid leader or an assistant shares a boss's note (Notes/Comm.lua,
-- every Share and Push note path), their healer order for that boss and the spell order of the healers on it go too
-- (Timeline/HealerOrder.lua), so raiders see the healers as the lead laid them out (Alex, 2026-10-31).
-- Sending (Share:Push(encounterID)): nothing when the lead has no saved order for the boss or its healers, so a lead
-- who never reorders changes nobody's view. Not sent again when it is the one last sent to that channel this session.
-- Never in combat or a boss fight (Notes.Busy), only by the leader or an assistant, through CRT.Comm:Send on the group
-- channel.
-- Receiving (Share.Receive): never while you lead the group (the leader keeps their own order, as with the roster);
-- else only from the leader or an assistant, never your own (CRT.NoteComm.Sender). It replaces your order for that
-- boss and those healers' spell orders; anything else of yours stays. Parts that don't all arrive within TIMEOUT
-- seconds, don't add up to their hash, or don't read are dropped.
--
-- Message under the prefix CRTHealOrd1: "<hash>|<part>|<total>|<data>", as the roster's (Groups/Share.lua). The text:
--   line 1  the encounter ID
--   line 2  the healer keys in order, tab-separated (may be empty: the lead's healers in the default order)
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
    thisBoss = "this boss",
}
Share.TEXT = TEXT

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
end

local lastSent = {} -- channel .. ":" .. encounterID -> hash of the order last sent there this session
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

-- The keys of the healers on a boss whose spell order may go: the boss's saved order's, the roster's healers' (by
-- HealerView.Players) and the boss's slots' (Timeline/HealerSlots.lua). Each once.
function Share.BossKeys(encounterID)
    local out, seen = {}, {}
    local function add(k)
        if goodKey(k) and not seen[k] then
            seen[k] = true
            out[#out + 1] = k
        end
    end
    local O = Order()
    for _, k in ipairs(O and O.Healers(encounterID) or {}) do
        add(k)
    end
    local HV = CRT.TimelineHealerView
    local ok, players = false, nil
    if HV and HV.Players then
        ok, players = pcall(HV.Players)
    end
    for _, p in ipairs(ok and type(players) == "table" and players or {}) do
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
    local healers = {}
    for _, k in ipairs(O.Healers(encounterID) or {}) do
        if goodKey(k) and #healers < MAX_KEYS then
            healers[#healers + 1] = k
        end
    end
    local lines = { tostring(encounterID), table.concat(healers, "\t") }
    for _, k in ipairs(Share.BossKeys(encounterID)) do
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

-- Sends the boss's order to the group, as a note of it is shared. Returns whether it went.
function Share:Push(encounterID)
    if busy() or type(encounterID) ~= "number" then
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
    local messages, hash = Share.Pack(text)
    if #messages > MAX_PARTS then
        return false
    end
    local key = channel .. ":" .. encounterID
    if lastSent[key] == hash then
        return false
    end
    lastSent[key] = hash -- first: a drop while it waits on the throttle (WHAT.dropped) clears it again
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

-- Takes a received order: the boss's healer order and those healers' spell orders replaced. True when anything changed.
function Share.Apply(encounterID, healers, spells)
    local O = Order()
    if not O then
        return false
    end
    local changed = not same(O.Healers(encounterID), healers)
    O.SetHealers(encounterID, #healers > 0 and healers or nil)
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
