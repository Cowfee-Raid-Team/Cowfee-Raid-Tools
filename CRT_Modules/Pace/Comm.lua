local ADDON, CRT = ...

-- Sharing pace plans with the group through addon messages, like raid notes. Only the raid leader or
-- an assistant can share, and plans are only accepted from them. A received plan is saved as the
-- raid's plan for that boss (CRTDB.pace.shared[encounterID]), apart from your own plan, and becomes
-- the plan in use: a new share always switches you back to the raid's plan, and your own is never
-- changed. Addon messages are blocked during a boss encounter, so share before the pull.
--
-- Message under the prefix CRTPace1: "<encounterID>|<hash>|<part>|<total>|<text>", where text is a part
-- of the plan as Pace:Export writes it (plain text, its lines joined by ";"), and hash is its
-- fingerprint, so a plan that arrives damaged is dropped. The send queue, throttle and lockdown handling are
-- CRT_Core/Comm.lua's (CRT.Comm), shared with the other modules that send.

local Pace = CRT.Pace
local Comm = {}
CRT.PaceComm = Comm
local Shared = CRT.Comm

local PREFIX = "CRTPace1"
local CHUNK = 200
-- how CRT.Comm names a pace plan in its chat lines
local WHAT = { what = "the pace plan", locked = "Pace plans" }

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
end

local incoming = {} -- sender .. id .. hash -> { total, parts, count }

function Comm:CanShare()
    if not Shared.Channel() then
        return false, "You need to be in a group to share pace plans."
    end
    if not Shared.IsLeaderOrAssist("player") then
        return false, "Only the raid leader or an assistant can share pace plans."
    end
    return true
end

-- Adds one boss's plan in use to list. Returns true when there was one.
local function queuePlan(encounterID, list)
    -- Line breaks travel as ";" (plan text has none of its own).
    local text = (Pace:Export(encounterID):gsub("\n", ";"))
    if text == "" then
        return false
    end
    local hash = Shared.Fingerprint(text)
    local parts = {}
    for pos = 1, #text, CHUNK do
        parts[#parts + 1] = text:sub(pos, pos + CHUNK - 1)
    end
    for i, part in ipairs(parts) do
        list[#list + 1] = encounterID .. "|" .. hash .. "|" .. i .. "|" .. #parts .. "|" .. part
    end
    return true
end

-- Shares one boss's plan in use, or with ids a list of bosses. Returns how many were shared.
function Comm:Share(ids)
    local ok, why = self:CanShare()
    if not ok then
        CRT:Print(why)
        return 0
    end
    local n, list = 0, {}
    for _, id in ipairs(ids) do
        if queuePlan(id, list) then
            n = n + 1
        end
    end
    if n == 0 then
        CRT:Print("There is no pace plan to share.")
        return 0
    end
    Shared:Send(PREFIX, list, WHAT)
    CRT:Print(string.format("Shared %d pace plan%s with the group.", n, n == 1 and "" or "s"))
    return n
end

-- Every boss with a plan in use, for Share all.
function Comm:AllPlanned()
    local seen, out = {}, {}
    local function add(id)
        if not seen[id] and Pace:Plan(id) then
            seen[id] = true
            out[#out + 1] = id
        end
    end
    for id in pairs(CRT.db.pace.own) do
        add(id)
    end
    for id in pairs(CRT.db.pace.shared) do
        add(id)
    end
    for id in pairs(CRT.PaceDB.bosses) do
        add(id)
    end
    table.sort(out)
    return out
end

local events = CreateFrame("Frame")
events:RegisterEvent("CHAT_MSG_ADDON")
events:SetScript("OnEvent", function(_, _, prefix, message, _, sender)
    if prefix ~= PREFIX or type(message) ~= "string" or type(sender) ~= "string" then
        return
    end
    if (issecretvalue and (issecretvalue(message) or issecretvalue(sender))) then
        return
    end
    local short = Ambiguate(sender, "none")
    if short == UnitName("player") or not Shared.IsLeaderOrAssist(short) then
        return
    end
    local id, hash, part, total, data = message:match("^(%d+)|(%x+)|(%d+)|(%d+)|(.*)$")
    id, part, total = tonumber(id), tonumber(part), tonumber(total)
    if not (id and hash and part and total) or part < 1 or part > total or total > 50 then
        return
    end
    local key = sender .. ":" .. id .. ":" .. hash
    local buffer = incoming[key]
    if not buffer then
        buffer = { total = total, parts = {}, count = 0 }
        incoming[key] = buffer
    end
    if not buffer.parts[part] then
        buffer.parts[part] = data
        buffer.count = buffer.count + 1
    end
    if buffer.count < buffer.total then
        return
    end
    incoming[key] = nil
    local text = table.concat(buffer.parts, "", 1, buffer.total)
    if Shared.Fingerprint(text) ~= hash then
        CRT:Print("A pace plan from " .. short .. " arrived damaged. Ask them to share it again.")
        return
    end
    local n, err = Pace:ReceiveShared(id, (text:gsub(";", "\n")), short)
    if n then
        CRT:Print(string.format("%s shared the pace plan for %s (%d checkpoint%s). It's now your plan in use; your own plan is kept.", short, Pace:BossName(id), n, n == 1 and "" or "s"))
    else
        CRT:Print("A pace plan from " .. short .. " could not be read: " .. tostring(err))
    end
end)
