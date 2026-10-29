local ADDON, CRT = ...

-- Interrupts: sharing the kick list (CRT.InterruptComm). Only the raid leader or an assistant can share, and a list
-- is only taken from one. Share sends your own list for a boss (the page's fields); a received one is saved as the
-- raid's list for that boss (Interrupts:ReceiveShared) and put in use, your own left as it is, and your number and
-- side follow at once, with one chat line. Lists are taken only while Enable Interrupts and Accept kick lists are
-- both on. Addon messages are blocked during a boss encounter, so share before the pull.
--
-- Messages under the prefix CRTKick1, through the shared send queue (CRT_Core/Comm.lua), in parts as Pace's plans go:
--   L|<version>|<encounterID>|<hash>|<part>|<total>|<text>
-- text is a part of the names, in group order, then slot order, joined by ",", an empty slot an empty field; hash is
-- CRT.Comm.Fingerprint of all the names, so a list that arrives damaged is dropped with one chat line. version is
-- VERSION; a later minor version only adds fields after the text, a higher major version is skipped. Each part is
-- at most 255 bytes; ten names usually fit one. A half-received list is dropped after PARTS_TIMEOUT seconds and on a
-- zone change (PLAYER_ENTERING_WORLD). A list for a boss this CRT has no block for, or in another shape,
-- is dropped quietly (an older or newer CRT's boss data).
--
-- Game calls (warcraft.wiki.gg, read 2026-10-28): C_ChatInfo.RegisterAddonMessagePrefix, CHAT_MSG_ADDON (prefix,
-- text, channel, sender), Ambiguate(name, "none"), UnitName, UnitIsGroupLeader, UnitIsGroupAssistant,
-- C_InstanceEncounter.IsEncounterInProgress (the global IsEncounterInProgress on older clients).

local Interrupts = CRT.Interrupts
local Shared = CRT.Comm
local KickComm = {}
CRT.InterruptComm = KickComm

KickComm.PREFIX = "CRTKick1"
KickComm.VERSION = 1
KickComm.MAX_BYTES = 255
KickComm.CHUNK = 200 -- the names' bytes in one part
KickComm.MAX_PARTS = 8
KickComm.PARTS_TIMEOUT = 30 -- seconds a half-received list waits for its other parts

local TEXT = {
    what = "the kick list",
    group = "You need to be in a group to share the kick list.",
    lead = "Only the raid leader or an assistant can share the kick list.",
    slots = "Fill all %d slots first.",
    fight = "The kick list can't be shared during a boss fight. Share it before the pull.",
    noBoss = "This boss has no kick numbers.",
    badName = "A name holds a comma or a bar.",
    shared = "Shared the kick list for %s with the group.",
    got = "%s shared the kick list for %s. Your kick: #%d %s.",
    notOn = "%s shared the kick list for %s. You are not on it.",
    damaged = "A kick list from %s arrived damaged. Ask them to share it again.",
}
KickComm.TEXT = TEXT

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(KickComm.PREFIX)
end

local function inEncounter()
    local fn = (C_InstanceEncounter and C_InstanceEncounter.IsEncounterInProgress) or IsEncounterInProgress
    if not fn then
        return false
    end
    local ok, on = pcall(fn)
    -- a secret or failed answer counts as in a fight: never send into the lockdown
    return not ok or not Shared.Readable(on) or on == true
end

-- The messages for a boss's list, in order, or nil and why not.
function KickComm.Encode(encounterID, def, list)
    if not def then
        return nil, TEXT.noBoss
    end
    local names = {}
    for g = 1, #def.groups do
        for s = 1, def.slots do
            local name = type(list[g]) == "table" and list[g][s] or ""
            name = type(name) == "string" and name or ""
            if name:find("[,|]") then
                return nil, TEXT.badName
            end
            names[#names + 1] = name
        end
    end
    local body = table.concat(names, ",")
    local hash = Shared.Fingerprint(body)
    local parts = {}
    for pos = 1, math.max(#body, 1), KickComm.CHUNK do
        parts[#parts + 1] = body:sub(pos, pos + KickComm.CHUNK - 1)
    end
    local out = {}
    for i, part in ipairs(parts) do
        out[i] = string.format("L|%d|%d|%s|%d|%d|%s", KickComm.VERSION, encounterID, hash, i, #parts, part)
    end
    return out
end

-- One message's fields: { id, hash, part, total, text }, or nil for anything this CRT doesn't read (another kind, a
-- higher major version, a bad part number).
function KickComm.Parse(message)
    if type(message) ~= "string" or #message > KickComm.MAX_BYTES then
        return nil
    end
    local version, id, hash, part, total, text = message:match("^L|([%d%.]+)|(%d+)|(%x+)|(%d+)|(%d+)|([^|]*)")
    local major = tonumber(version and version:match("^(%d+)"))
    id, part, total = tonumber(id), tonumber(part), tonumber(total)
    if not (major and id and part and total) or major > KickComm.VERSION or part < 1 or part > total or total > KickComm.MAX_PARTS then
        return nil
    end
    return { id = id, hash = hash, part = part, total = total, text = text }
end

-- A whole list's names (body) read into a list for def: the list, or nil and "damaged" (the hash fails) or "shape"
-- (no block, or another number of names).
function KickComm.Read(def, hash, body)
    if Shared.Fingerprint(body) ~= hash then
        return nil, "damaged"
    end
    if not def then
        return nil, "shape"
    end
    local names = {}
    for name in (body .. ","):gmatch("([^,]*),") do
        names[#names + 1] = name
    end
    if #names ~= #def.groups * def.slots then
        return nil, "shape"
    end
    local list, i = {}, 0
    for g = 1, #def.groups do
        list[g] = {}
        for s = 1, def.slots do
            i = i + 1
            list[g][s] = names[i]
        end
    end
    return list
end

-- Messages (a list, in any order) read into the boss and its list, or nil and why not ("damaged", "shape", or nil
-- for messages this CRT doesn't read or a list not yet whole). def is the boss's block, or a function from encounter
-- ID to block.
function KickComm.Decode(messages, def)
    local parts, first = {}, nil
    for _, m in ipairs(type(messages) == "table" and messages or { messages }) do
        local p = KickComm.Parse(m)
        if not p or (first and (p.id ~= first.id or p.hash ~= first.hash or p.total ~= first.total)) then
            return nil
        end
        first = first or p
        parts[p.part] = p.text
    end
    if not first then
        return nil
    end
    for i = 1, first.total do
        if not parts[i] then
            return nil
        end
    end
    if type(def) == "function" then
        def = def(first.id)
    end
    local list, why = KickComm.Read(def, first.hash, table.concat(parts, "", 1, first.total))
    if not list then
        return nil, why
    end
    return first.id, list
end

-- Whether you can share this boss's list now: true, or false and why.
function KickComm:CanShare(encounterID)
    if not Shared.Channel() then
        return false, TEXT.group
    end
    if not Shared.IsLeaderOrAssist("player") then
        return false, TEXT.lead
    end
    local def = Interrupts:Def(encounterID)
    if not def then
        return false, TEXT.noBoss
    end
    if not Interrupts:Complete(encounterID, Interrupts:Own(encounterID)) then
        return false, string.format(TEXT.slots, #def.groups * def.slots)
    end
    if inEncounter() then
        return false, TEXT.fight
    end
    return true
end

-- Shares your own list for a boss. Returns true when it was sent (or waits on the game's throttle).
function KickComm:Share(encounterID)
    local ok, why = self:CanShare(encounterID)
    if not ok then
        CRT:Print(why)
        return false
    end
    local messages, err = self.Encode(encounterID, Interrupts:Def(encounterID), Interrupts:Own(encounterID))
    if not messages then
        CRT:Print(err)
        return false
    end
    if not Shared:Send(self.PREFIX, messages, TEXT.what) then
        return false
    end
    CRT:Print(string.format(TEXT.shared, Interrupts:BossName(encounterID)))
    return true
end

local incoming = {} -- sender .. id .. hash -> { total, parts, count, at }
local finished = {} -- the same key -> { at, parts } once whole: a late copy of one of its parts is ignored for PARTS_TIMEOUT

-- Half-received lists older than PARTS_TIMEOUT are dropped; all = true drops every one (a zone change).
local function forget(all)
    local now = GetTime()
    for key, buffer in pairs(incoming) do
        if all or now - buffer.at > KickComm.PARTS_TIMEOUT then
            incoming[key] = nil
        end
    end
    for key, done in pairs(finished) do
        if all or now - done.at > KickComm.PARTS_TIMEOUT then
            finished[key] = nil
        end
    end
end

-- How many half-received lists are waiting (the tests).
function KickComm.Pending()
    local n = 0
    for _ in pairs(incoming) do
        n = n + 1
    end
    return n
end

function KickComm:Receive(message, sender)
    -- off, or not taking lists: nothing is read at all
    if not (Interrupts:Enabled() and Interrupts:Settings().accept) then
        return
    end
    local short = Ambiguate(sender, "none")
    local okMe, me = pcall(UnitName, "player")
    if okMe and Shared.Readable(me) and short == me then
        return
    end
    if not Shared.IsLeaderOrAssist(short) then
        return
    end
    local p = self.Parse(message)
    if not p then
        return
    end
    forget(false)
    local key = short .. ":" .. p.id .. ":" .. p.hash
    local done = finished[key]
    if done and done.parts[p.part] == p.text then
        return -- a late copy of a part of a list already taken
    end
    local buffer = incoming[key]
    if not buffer or buffer.total ~= p.total then
        buffer = { total = p.total, parts = {}, count = 0, at = GetTime() }
        incoming[key] = buffer
    end
    if not buffer.parts[p.part] then
        buffer.parts[p.part] = p.text
        buffer.count = buffer.count + 1
    end
    if buffer.count < buffer.total then
        return
    end
    incoming[key] = nil
    finished[key] = { at = GetTime(), parts = buffer.parts }
    local list, why = self.Read(Interrupts:Def(p.id), p.hash, table.concat(buffer.parts, "", 1, buffer.total))
    if not list then
        if why == "damaged" then
            CRT:Print(string.format(TEXT.damaged, short))
        end
        return -- another boss or shape: an older or newer CRT's data, quietly
    end
    Interrupts:ReceiveShared(p.id, list, short)
    local n, group = Interrupts:Mine(p.id)
    local boss = Interrupts:BossName(p.id)
    if n then
        CRT:Print(string.format(TEXT.got, short, boss, n, group or ""))
    else
        CRT:Print(string.format(TEXT.notOn, short, boss))
    end
end

-- Listening only while the module is on: off, a shared list is never even read.
local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(_, event, prefix, message, _, sender)
    if event == "PLAYER_LOGIN" then
        KickComm.Listen()
        return
    elseif event == "PLAYER_ENTERING_WORLD" then
        forget(true) -- a zone change: the rest of a half-received list won't come
        return
    end
    -- secrets first: nothing is compared or matched before
    if not (Shared.Readable(prefix) and Shared.Readable(message) and Shared.Readable(sender)) then
        return
    end
    if prefix ~= KickComm.PREFIX or type(message) ~= "string" or type(sender) ~= "string" then
        return
    end
    KickComm:Receive(message, sender)
end)
events:RegisterEvent("PLAYER_LOGIN")

function KickComm.Listen()
    for _, e in ipairs({ "CHAT_MSG_ADDON", "PLAYER_ENTERING_WORLD" }) do
        if Interrupts:Enabled() then
            events:RegisterEvent(e)
        else
            events:UnregisterEvent(e)
        end
    end
    if not Interrupts:Enabled() then
        forget(true)
    end
end

Interrupts:OnChange(function(what)
    if what == "enabled" then
        KickComm.Listen()
    end
end)
if CRT.db then
    KickComm.Listen()
end
