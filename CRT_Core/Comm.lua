local ADDON, CRT = ...

-- One send queue for the addon messages a module shares with the group (CRT.Comm), so the throttle, the
-- encounter lockdown and a left group are handled in one place. Pace plans (Pace/Comm.lua) and kick lists
-- (Interrupts/Comm.lua) go through it; each module keeps its own prefix and its own receive handler.
--   CRT.Comm.Channel()              "INSTANCE_CHAT", "RAID", "PARTY", or nil out of a group
--   CRT.Comm.IsLeaderOrAssist(unit) true for the group's leader or an assistant
--   CRT.Comm.Fingerprint(text)      a short hash of the text, so a message that arrives damaged is dropped
--   CRT.Comm.Readable(v)            false for nil and for a secret value, which can't be compared or read
--   CRT.Comm:Send(prefix, messages, what)  queues the messages and sends them in order on the group channel.
--     what names the thing in the chat lines ("the pace plan"), or is { what = "the pace plan", locked =
--     "Pace plans" } for a lockdown line of its own. Returns false when the messages were dropped.
-- A throttled message waits a second and goes again, the ones behind it waiting with it. During an encounter
-- the game holds addon messages (AddOnMessageLockdown): the queue is dropped with one line, so share before the
-- pull. A raised error or any other result drops the queue too, with its line.
--
-- Game calls (warcraft.wiki.gg, read 2026-10-28): C_ChatInfo.SendAddonMessage(prefix, message, chatType) ->
-- Enum.SendAddonMessageResult, IsInGroup(LE_PARTY_CATEGORY_INSTANCE), IsInRaid, UnitIsGroupLeader,
-- UnitIsGroupAssistant, C_Timer.After, issecretvalue.

local Comm = {}
CRT.Comm = Comm

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local SUCCESS = RESULT.Success or 0
local THROTTLED = RESULT.AddonMessageThrottle or 3
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11
local RETRY = 1 -- seconds a throttled message waits

local queue = {} -- { prefix, text, what }, in the order they go
local waiting = false -- a throttled message waits for its retry

function Comm.Channel()
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return "INSTANCE_CHAT"
    elseif IsInRaid() then
        return "RAID"
    elseif IsInGroup() then
        return "PARTY"
    end
end

function Comm.IsLeaderOrAssist(unit)
    return (UnitIsGroupLeader(unit) or UnitIsGroupAssistant(unit)) and true or false
end

-- Two small running sums (a djb2 kept under 2^24 and an Adler-style sum), plus the length, so a damaged
-- message practically never matches, with every number small enough for any Lua. Pace has always sent it.
function Comm.Fingerprint(text)
    local h, a = 5381, 1
    for i = 1, #text do
        local b = text:byte(i)
        h = (h * 33 + b) % 16777216
        a = (a * 7 + b) % 65521
    end
    return string.format("%06x%04x%x", h, a, #text)
end

-- The secret check comes first: a secret may not even be compared with nil.
function Comm.Readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return v ~= nil
end

local function name(what)
    return type(what) == "table" and what.what or tostring(what)
end

local function lockedLine(what)
    local text = type(what) == "table" and what.locked or nil
    if not text then
        local n = name(what)
        text = n:sub(1, 1):upper() .. n:sub(2)
    end
    return text .. " can't be shared during an encounter. Share again after the pull ends."
end

-- Drops the queue with one chat line for each module whose messages it held (line(what) writes it), in queue order.
local function drop(line)
    local seen, lines = {}, {}
    for _, m in ipairs(queue) do
        local key = name(m.what)
        if not seen[key] then
            seen[key] = true
            lines[#lines + 1] = line(m.what)
        end
    end
    wipe(queue)
    waiting = false
    local left = {}
    for _, text in ipairs(lines) do
        if not left[text] then -- "you left the group" once, whoever's messages they were
            left[text] = true
            CRT:Print(text)
        end
    end
    return false
end

local function leftGroup()
    return "Sharing stopped: you left the group."
end

-- Sends what is queued, in order. False when the queue was dropped.
local function pump()
    waiting = false
    while #queue > 0 do
        local m = queue[1]
        local ch = Comm.Channel()
        if not ch then
            return drop(leftGroup)
        end
        local ok, result = pcall(C_ChatInfo.SendAddonMessage, m.prefix, m.text, ch)
        if not ok then
            return drop(function(what)
                return "Sharing " .. name(what) .. " failed: " .. tostring(result)
            end)
        end
        if result == THROTTLED then
            waiting = true
            C_Timer.After(RETRY, pump)
            return true
        elseif result == LOCKDOWN then
            return drop(lockedLine)
        elseif not (result == true or result == nil or result == SUCCESS) then
            return drop(function(what)
                return "Sharing " .. name(what) .. " failed with result " .. tostring(result) .. "."
            end)
        end
        table.remove(queue, 1)
    end
    return true
end

function Comm:Send(prefix, messages, what)
    for _, text in ipairs(messages or {}) do
        queue[#queue + 1] = { prefix = prefix, text = text, what = what }
    end
    if waiting then
        return true -- they go after the throttled one, on its retry
    end
    return pump()
end
