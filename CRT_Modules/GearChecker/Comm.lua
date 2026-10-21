local ADDON, CRT = ...

-- Gear Checker over addon messages (prefix CRTGearCheck): one CRT asks the group for their gear, and every
-- CRT in the group answers with its whole equipped set, so their rows show the exact items, gems and
-- enchants even out of inspect range. Everything goes to the group channel, never a whisper, so one answer
-- reaches every CRT that asked. A CRT without the Gear Checker never registers the prefix and never sees a
-- message; a newer CRT's extra fields are left for it.
--
-- Messages, "<kind>|<version>|..." with Comm.VERSION as version:
--   Q|<version>|<request id>                     asks the group for their gear
--   G|<version>|<set id>|<part>|<parts>|<pieces>  one part of a whole equipped set: CRT.Gear.Encode's
--                                                 "<slot>~<item string>~<item level>" joined with ";", split
--                                                 by CRT.Gear.PackMany so each message is 255 bytes or less.
--                                                 Fields after pieces are for later versions.
-- A CRT answers only in a group, at most once per Comm.REPLY_WINDOW (asks in between are answered together
-- when it ends, and that one answer reaches everyone), and not in combat: an ask then is answered when
-- combat ends. Sends wait a second on the game's throttle and hold during an encounter's message lockdown,
-- as Loot Master's do (LootMaster/Comm.lua).
--
-- Game calls (warcraft.wiki.gg, read 2026-10-14 and 2026-10-20): C_ChatInfo.RegisterAddonMessagePrefix,
-- C_ChatInfo.SendAddonMessage(prefix, message, chatType) -> Enum.SendAddonMessageResult (255 bytes a
-- message, 16 for the prefix), CHAT_MSG_ADDON (prefix, text, channel, sender), IsInGroup, IsInRaid,
-- InCombatLockdown, PLAYER_REGEN_ENABLED, C_Timer.After, GetTime.

local GC = CRT.GearChecker
local Gear = CRT.Gear

local Comm = { crt = {}, sets = {}, parts = {} }
GC.Comm = Comm

Comm.PREFIX = "CRTGearCheck"
Comm.VERSION = 1
Comm.MAX = 255 -- bytes a message may hold
Comm.REPLY_WINDOW = 10 -- seconds: a CRT answers at most once in this time
Comm.REQUEST_GAP = 5 -- seconds between two asks of your own
Comm.REPLY_WAIT = 3 -- seconds after an ask before those who didn't answer are inspected
Comm.HEAD_MAX = 24 -- the longest "G|<version>|<set id>|<part>|<parts>|" head, so PackMany leaves it room

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local SUCCESS = RESULT.Success or 0
local THROTTLED = RESULT.AddonMessageThrottle or 3
local CHANNEL_THROTTLED = RESULT.ChannelThrottle or 8
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11
local OFFLINE = RESULT.TargetOffline or 12
local LOCKDOWN_RETRY = 10 -- seconds between tries while messages are held

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(Comm.PREFIX)
end

local function secret(v)
    return issecretvalue and issecretvalue(v) or false
end

local function now()
    return GetTime and GetTime() or 0
end

local function channel()
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return "INSTANCE_CHAT"
    elseif IsInRaid() then
        return "RAID"
    elseif IsInGroup() then
        return "PARTY"
    end
    return nil
end

local function me()
    return GC.FullName("player")
end

-- A sender's full Name-Realm; the game leaves your own realm off.
local function fullSender(name)
    if secret(name) or type(name) ~= "string" or name == "" then
        return nil
    end
    if not name:find("-", 1, true) then
        local realm = GetNormalizedRealmName and GetNormalizedRealmName() or ""
        name = realm ~= "" and (name .. "-" .. realm) or name
    end
    return name
end

-- "a|b||c" into its fields, empty ones kept.
local function split(text)
    local out = {}
    for field in (text .. "|"):gmatch("([^|]*)|") do
        out[#out + 1] = field
    end
    return out
end

-- Sending ------------------------------------------------------------------------------------------------

local queue, sending, held = {}, false, false
local warned = {}

local pump
local function resume()
    if held then
        held = false
        pump()
    end
end

pump = function()
    while queue[1] do
        local ch = channel()
        if not ch then
            wipe(queue) -- left the group: no one to send to
            break
        end
        local ok, result = pcall(C_ChatInfo.SendAddonMessage, Comm.PREFIX, queue[1], ch)
        if ok and (result == THROTTLED or result == CHANNEL_THROTTLED) then
            C_Timer.After(1, pump)
            return
        elseif ok and result == LOCKDOWN then
            if not held then
                held = true
                C_Timer.After(LOCKDOWN_RETRY, resume)
            end
            return
        elseif not ok or not (result == nil or result == true or result == SUCCESS or result == OFFLINE) then
            local key = tostring(ok and result or "error")
            if not warned[key] then
                warned[key] = true
                CRT:Print("Gear Checker: a message could not be sent (" .. key .. ").")
            end
        end
        table.remove(queue, 1)
    end
    sending = false
end

local function send(text)
    if not channel() then
        return false
    end
    queue[#queue + 1] = text
    if not sending and not held then
        sending = true
        pump()
    end
    return true
end

-- The whole equipped set as G messages, each 255 bytes or less; an empty set is one part with no pieces.
function Comm.SetMessages(pieces, setId)
    local chunks = Gear.PackMany(pieces, Comm.MAX - Comm.HEAD_MAX)
    if #chunks == 0 then
        chunks = { {} }
    end
    local out = {}
    for i, chunk in ipairs(chunks) do
        out[i] = table.concat({ "G", Comm.VERSION, setId, i, #chunks, table.concat(chunk, ";") }, "|")
    end
    return out
end

-- Answering ------------------------------------------------------------------------------------------------

local lastReply, replyWaiting, combatWaiting = nil, false, false
local nextSet = 0

local function reply()
    if not channel() then
        return
    end
    if InCombatLockdown() then
        combatWaiting = true -- answered when combat ends
        return
    end
    local wait = lastReply and (lastReply + Comm.REPLY_WINDOW - now()) or 0
    if wait > 0 then
        if not replyWaiting then
            replyWaiting = true
            C_Timer.After(wait, function()
                replyWaiting = false
                reply()
            end)
        end
        return
    end
    lastReply = now()
    nextSet = nextSet + 1
    for _, text in ipairs(Comm.SetMessages(Gear:MineAll(), tostring(nextSet))) do
        send(text)
    end
end

-- Receiving --------------------------------------------------------------------------------------------------

-- A G part; the set is remembered once every part of it has come.
local function takePart(sender, f)
    local setId, part, parts = f[3], tonumber(f[4]), tonumber(f[5])
    if not (setId and setId ~= "" and part and parts and part >= 1 and part <= parts and parts <= 64) then
        return
    end
    local p = Comm.parts[sender]
    if not p or p.id ~= setId or p.n ~= parts then
        p = { id = setId, n = parts, got = {}, count = 0 }
        Comm.parts[sender] = p
    end
    if not p.got[part] then
        p.got[part] = f[6] or ""
        p.count = p.count + 1
    end
    if p.count < p.n then
        return
    end
    Comm.parts[sender] = nil
    local pieces = {}
    for i = 1, p.n do
        for text in (p.got[i] .. ";"):gmatch("([^;]*);") do
            local piece = text ~= "" and Gear.Decode(text)
            if piece then
                pieces[#pieces + 1] = piece
            end
        end
    end
    Comm.sets[sender] = now()
    if #pieces > 0 then
        Gear:Remember(sender, pieces, GC.SOURCE_REPLY, true)
    end
    GC:Fire("reply")
end

function Comm:Receive(text, sender)
    sender = fullSender(sender)
    if secret(text) or type(text) ~= "string" or not sender or sender == me() then
        return
    end
    local f = split(text)
    local version = tonumber(f[2])
    if not version or version < 1 then
        return
    end
    if f[1] == "Q" then
        self.crt[sender] = true
        reply()
    elseif f[1] == "G" then
        self.crt[sender] = true
        takePart(sender, f)
    end
    -- any other kind is a later version's: left alone
end

-- Asking ------------------------------------------------------------------------------------------------------

local lastAsk, nextAsk = nil, 0

-- Asks the group for their gear; false when not in a group or asked less than REQUEST_GAP ago.
function Comm:Request()
    if not channel() or (lastAsk and now() - lastAsk < self.REQUEST_GAP) then
        return false
    end
    lastAsk = now()
    nextAsk = nextAsk + 1
    return send(table.concat({ "Q", self.VERSION, tostring(nextAsk) }, "|"))
end

-- Whether a player has CRT (a message of theirs came on this prefix), and whether their whole set came.
function Comm:HasCRT(name)
    return self.crt[name] == true
end

function Comm:HasSet(name)
    return self.sets[name] ~= nil
end

-- How many of the roster have CRT (you count), and the roster's size.
function Comm:Count(roster)
    local n = 0
    for _, m in ipairs(roster) do
        if m.me or self.crt[m.name] then
            n = n + 1
        end
    end
    return n, #roster
end

-- Refresh: asks every CRT in the group, then inspects those who didn't answer within REPLY_WAIT (or
-- everyone but you, out of a group's messages). Inspect.lua waits out combat on its own.
function GC:Refresh()
    Comm:Request()
    C_Timer.After(Comm.REPLY_WAIT, function()
        local names = {}
        for _, m in ipairs(GC:Roster()) do
            if not m.me and not Comm:HasSet(m.name) then
                names[#names + 1] = m.name
            end
        end
        GC.Inspect:Queue(names)
    end)
    GC:Fire("refresh")
end

-- The game's events (also called by the tests).
function Comm:OnEvent(event, prefix, text, _, sender)
    if event == "CHAT_MSG_ADDON" then
        if not secret(prefix) and prefix == self.PREFIX then
            self:Receive(text, sender)
        end
    elseif event == "PLAYER_REGEN_ENABLED" then
        if combatWaiting then
            combatWaiting = false
            reply()
        end
    elseif event == "ENCOUNTER_END" then
        resume()
    end
end

if CreateFrame then
    local events = CreateFrame("Frame")
    events:RegisterEvent("CHAT_MSG_ADDON")
    events:RegisterEvent("PLAYER_REGEN_ENABLED")
    events:RegisterEvent("ENCOUNTER_END")
    events:SetScript("OnEvent", function(_, ...)
        Comm:OnEvent(...)
    end)
end
