local ADDON, CRT = ...

-- Interrupts: sharing the kick list (CRT.InterruptComm). Only the raid leader or an assistant can share, and a list
-- is only taken from one. Share sends your own list for a boss (the page's fields); a received one is saved as the
-- raid's list for that boss (Interrupts:ReceiveShared) and put in use, your own left as it is, and your number and
-- side follow at once, with one chat line. Lists are taken only while Enable Interrupts and Accept kick lists are
-- both on. Addon messages are blocked during a boss encounter, so share before the pull.
--
-- Messages under the prefix CRTKick1, through the shared send queue (CRT_Core/Comm.lua), in parts as Pace's plans go:
--   L|<version>|<encounterID>|<hash>|<part>|<total>|<text>|<difficultyID>|<shape>|<label>
-- text is a part of the names, in group order, then slot order, joined by ",", an empty slot an empty field; hash is
-- CRT.Comm.Fingerprint of all the names, so a list that arrives damaged is dropped with one chat line. version is
-- VERSION; a later minor version only adds fields after the ones it knows, a higher major version is skipped. Each
-- part is at most 255 bytes; ten names usually fit one. A half-received list is dropped after PARTS_TIMEOUT seconds
-- and on a zone change (PLAYER_ENTERING_WORLD).
-- Version 1.1 added the last three fields, on every part: the setup's difficulty, its shape (Setup.Shape: each
-- group's key, marker, slots and label) and its label word. The names are read by group key, so a raider whose setup
-- has the same groups in another order reads them right. A raider whose setup the shape doesn't fit (the leader's own
-- setup over the shipped one), or who has none for that boss and difficulty, reads the list in the shape and keeps
-- the shape as the setup while that list is in use (Interrupts:ReceiveShared). Only Normal, Heroic and Mythic are
-- taken (Setup.SHARE_DIFFICULTIES). A 1.0 message (an older CRT: no difficulty, no shape) is read in order into the
-- boss's first setup with as many slots; an older CRT reads a 1.1 message as 1.0 (its extra fields after the text are
-- left). A list that fits neither is dropped quietly.
--
-- Game calls (warcraft.wiki.gg, read 2026-10-28): C_ChatInfo.RegisterAddonMessagePrefix, CHAT_MSG_ADDON (prefix,
-- text, channel, sender), Ambiguate(name, "none"), UnitName, UnitIsGroupLeader, UnitIsGroupAssistant,
-- C_InstanceEncounter.IsEncounterInProgress (the global IsEncounterInProgress on older clients).

local Interrupts = CRT.Interrupts
local Setup = CRT.InterruptSetup
local Shared = CRT.Comm
local KickComm = {}
CRT.InterruptComm = KickComm

KickComm.PREFIX = "CRTKick1"
KickComm.VERSION = "1.1"
KickComm.MAX_BYTES = 255
KickComm.CHUNK = 200 -- the most names' bytes in one part (fewer when the head and the shape need the room)
KickComm.MIN_CHUNK = 40 -- a setup whose shape leaves less room than this for names is too big to share
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
    tooBig = "This kick setup has too many groups to share.",
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

-- The messages for a setup's list (key "encounterID:difficultyID", or a bare encounter ID), in order, or nil and why not.
function KickComm.Encode(key, def, list)
    local encounterID = Interrupts.SplitKey(key)
    if not (def and encounterID) then
        return nil, TEXT.noBoss
    end
    local names = {}
    for g, grp in ipairs(def.groups) do
        for s = 1, grp.slots do
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
    local tail = string.format("|%d|%s|%s", def.difficulty, Setup.Shape(def), Setup.CleanLabel(def.label))
    local head = string.format("L|%s|%d|%s|%d|%d|", KickComm.VERSION, encounterID, hash, KickComm.MAX_PARTS, KickComm.MAX_PARTS)
    local chunk = math.min(KickComm.CHUNK, KickComm.MAX_BYTES - #head - #tail)
    if chunk < KickComm.MIN_CHUNK then
        return nil, TEXT.tooBig
    end
    local parts = {}
    for pos = 1, math.max(#body, 1), chunk do
        parts[#parts + 1] = body:sub(pos, pos + chunk - 1)
    end
    if #parts > KickComm.MAX_PARTS then
        return nil, TEXT.tooBig
    end
    local out = {}
    for i, part in ipairs(parts) do
        out[i] = string.format("L|%s|%d|%s|%d|%d|%s%s", KickComm.VERSION, encounterID, hash, i, #parts, part, tail)
    end
    return out
end

local MAJOR = tonumber(KickComm.VERSION:match("^(%d+)"))

-- One message's fields: { id, hash, part, total, text, difficulty, shape, label } (the last three nil from a 1.0
-- message), or nil for anything this CRT doesn't read (another kind, a higher major version, a bad part number).
function KickComm.Parse(message)
    if type(message) ~= "string" or #message > KickComm.MAX_BYTES then
        return nil
    end
    local version, id, hash, part, total, text, rest = message:match("^L|([%d%.]+)|(%d+)|(%x+)|(%d+)|(%d+)|([^|]*)(.*)$")
    local major = tonumber(version and version:match("^(%d+)"))
    id, part, total = tonumber(id), tonumber(part), tonumber(total)
    if not (major and id and part and total) or major > MAJOR or part < 1 or part > total or total > KickComm.MAX_PARTS then
        return nil
    end
    local difficulty, shape, label = rest:match("^|(%d+)|([^|]*)|([^|]*)")
    return { id = id, hash = hash, part = part, total = total, text = text, difficulty = tonumber(difficulty),
        shape = shape ~= "" and shape or nil, label = label ~= "" and label or nil }
end

local function split(body)
    local names = {}
    for name in (body .. ","):gmatch("([^,]*),") do
        names[#names + 1] = name
    end
    return names
end

-- A whole list's names (body) read into a list for def, in its group order: the list, or nil and "damaged" (the
-- hash fails) or "shape" (no setup, or groups and slots that don't fit it). shape is the sender's (Setup.Shape): the
-- names are taken by group key, each group here needing the sender's group of that key with as many slots. With no
-- shape (a 1.0 message) they are read in order, and must be as many as def's slots.
function KickComm.Read(def, hash, body, shape)
    if Shared.Fingerprint(body) ~= hash then
        return nil, "damaged"
    end
    if not def then
        return nil, "shape"
    end
    local names = split(body)
    local list = {}
    if shape then
        local groups = Setup.ParseShape(shape)
        local byKey, i = {}, 0
        for _, grp in ipairs(groups or {}) do
            local col = {}
            for s = 1, grp.slots do
                i = i + 1
                col[s] = names[i]
            end
            byKey[grp.key] = { slots = grp.slots, names = col }
        end
        if not groups or i ~= #names then
            return nil, "shape"
        end
        for g, grp in ipairs(def.groups) do
            local theirs = byKey[grp.key]
            if not theirs or theirs.slots ~= grp.slots then
                return nil, "shape"
            end
            list[g] = theirs.names
        end
        return list
    end
    if #names ~= Setup.Total(def) then
        return nil, "shape"
    end
    local i = 0
    for g, grp in ipairs(def.groups) do
        list[g] = {}
        for s = 1, grp.slots do
            i = i + 1
            list[g][s] = names[i]
        end
    end
    return list
end

-- The setup a received list is for: its key, the setup in use (or one made from the message's shape, then also given
-- third, to be kept), from the message's encounter ID, difficulty, shape and label. A 1.0 message names no difficulty:
-- the boss's first setup with count slots. nil when there is none.
function KickComm.SetupFor(id, difficulty, shape, label, count)
    if difficulty and not Setup.SHARE_DIFFICULTIES[difficulty] then
        return nil
    end
    if difficulty then
        local key = Interrupts.Key(id, difficulty)
        local def = Interrupts:Def(key)
        if def then
            return key, def, nil
        end
        local made = shape and Setup.FromShape(difficulty, shape, label)
        if made then
            return key, made, made
        end
        return nil
    end
    for _, s in ipairs(Interrupts:Setups(id)) do
        if Setup.Total(s) == count then
            return Interrupts.Key(id, s.difficulty), s, nil
        end
    end
    return nil
end

-- Messages (a list, in any order) read into the boss and its list, or nil and why not ("damaged", "shape", or nil
-- for messages this CRT doesn't read or a list not yet whole). def is the setup, or a function from the encounter ID,
-- difficulty, shape, label and the count of names to a setup.
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
    local body = table.concat(parts, "", 1, first.total)
    if type(def) == "function" then
        def = def(first.id, first.difficulty, first.shape, first.label, #split(body))
    end
    local list, why = KickComm.Read(def, first.hash, body, first.shape)
    if not list then
        return nil, why
    end
    return first.id, list
end

-- Whether you can share a setup's list now: true, or false and why.
function KickComm:CanShare(key)
    if not Shared.Channel() then
        return false, TEXT.group
    end
    if not Shared.IsLeaderOrAssist("player") then
        return false, TEXT.lead
    end
    local def = Interrupts:Def(key)
    if not def then
        return false, TEXT.noBoss
    end
    if not Interrupts:Complete(key, Interrupts:Own(key)) then
        return false, string.format(TEXT.slots, Setup.Total(def))
    end
    if inEncounter() then
        return false, TEXT.fight
    end
    return true
end

-- Shares your own list for a setup. Returns true when it was sent (or waits on the game's throttle).
function KickComm:Share(key)
    local ok, why = self:CanShare(key)
    if not ok then
        CRT:Print(why)
        return false
    end
    key = Interrupts:Resolve(key)
    local messages, err = self.Encode(key, Interrupts:Def(key), Interrupts:Own(key))
    if not messages then
        CRT:Print(err)
        return false
    end
    if not Shared:Send(self.PREFIX, messages, TEXT.what) then
        return false
    end
    CRT:Print(string.format(TEXT.shared, Interrupts:BossName(key)))
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
    local key = short .. ":" .. p.id .. ":" .. tostring(p.difficulty or "") .. ":" .. p.hash
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
    local body = table.concat(buffer.parts, "", 1, buffer.total)
    if Shared.Fingerprint(body) ~= p.hash then
        CRT:Print(string.format(TEXT.damaged, short))
        return
    end
    local key, def, made = self.SetupFor(p.id, p.difficulty, p.shape, p.label, #split(body))
    local list = self.Read(def, p.hash, body, p.shape)
    if not list and key and not made and p.shape then
        -- the sender's setup isn't the one here (their own over the shipped one): read it in their shape
        made = Setup.FromShape(p.difficulty, p.shape, p.label)
        list = made and self.Read(made, p.hash, body, p.shape)
    end
    if not list then
        return -- another boss or shape: an older or newer CRT's data, quietly
    end
    Interrupts:ReceiveShared(key, list, short, made)
    local n, group = Interrupts:Mine(key)
    local boss = Interrupts:BossName(key)
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
