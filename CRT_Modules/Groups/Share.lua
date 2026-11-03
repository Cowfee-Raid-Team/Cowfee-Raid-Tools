local ADDON, CRT = ...

-- The roster sent with a shared note: every share of a note (Notes > Share to raid and the note editor's Push note,
-- through CRT.NotesPage.ShareNote) sends the active Raid Groups layout too while "Send my roster with the note" is on
-- (CRTDB.notes.pushRoster), so every raider runs with the same group and their Late Tracker expects the same people
-- (Alex, 2026-10-31; on every share, 2026-11-02).
-- Sending (Share:Push): the active layout's name and 40 slots, empty ones kept, as Groups:Export writes them, cut
-- into parts and sent through CRT.Comm:Send on the group channel. Sent on every share, changed or not, so a raider who
-- opened their own layout since is switched back; only not queued again while the same roster still waits in the
-- send queue (CRT.Comm:Queued). It follows only a note CRT's own sharing has under way. Never in combat or a boss
-- fight (Notes.Busy, as Push note), and only by the leader or an assistant.
-- Receiving (Share.Receive): never while you lead the group; else only from the leader or an assistant, never your
-- own (CRT.NoteComm.Sender, the check shared notes use). Kept as one layout per sender (preset.from, their
-- Name-Realm), named "<layout> (from <sender>)", replaced by the next one they send, made the active layout and opened
-- on Raid Groups (Groups:StoreFrom), replacing an Unsaved layout; unsaved edits to an open saved layout are kept, and
-- then it is only made active (Groups:HasUnsavedEdits). The same people in the same slots as your active layout make
-- no copy; that layout is only opened again. A shared note's invite list makes no layout of its own (Notes:Import),
-- so this is the one layout a share makes. Your own layouts are never touched. Parts that don't all arrive within
-- TIMEOUT seconds, or don't add up to their hash, are dropped.
--
-- Message under the prefix CRTRoster1: "<hash>|<part>|<total>|<data>". hash is the fingerprint of the whole text
-- (CRT.Comm.Fingerprint) and so its id; data is a part of the text, at most CHUNK bytes.
-- Game calls (warcraft.wiki.gg, read 2026-10-31): C_ChatInfo.RegisterAddonMessagePrefix(prefix), at most 16
-- characters; CHAT_MSG_ADDON (prefix, text, channel, sender, ...), taken only on RAID, PARTY or INSTANCE_CHAT; GetTime.

local Groups = CRT.Groups
local Shared = CRT.Comm

local Share = {}
CRT.RosterShare = Share

local PREFIX = "CRTRoster1"
-- Data bytes a part. The header is at most 21 characters (a 14-digit hash and two 2-digit numbers with their
-- separators), so a message stays under 255.
local CHUNK = 200
local MAX_PARTS = 20
local TIMEOUT = 30 -- seconds the parts of one roster may take to arrive
-- the group channels a roster is taken from
local CHANNELS = { RAID = true, PARTY = true, INSTANCE_CHAT = true }
Share.PREFIX = PREFIX

local TEXT = {
    sent = "Roster '%s' sent.",
    failed = "Roster '%s' not sent: the game refused it.",
    noLayout = "Roster not sent: no Raid Groups layout is active.",
    empty = "Roster not sent: the layout '%s' has no names.",
    noGroup = "Roster not sent: you're not in a group.",
    notLead = "Roster not sent: only the raid leader or an assistant can send it.",
    busy = "Roster not sent: not in combat or a boss fight.",
    stored = "%s (from %s)",
    unnamed = "Roster",
    received = "Roster '%s' from %s is now your active group.",
    receivedKept = "Roster '%s' from %s is now your active group. Your unsaved changes on '%s' are kept; pick it in Quick Load to see it.",
    receivedOwn = "Roster '%s' from %s is now your active group. Your unsaved changes on it are kept.",
    queued = "Roster '%s' is already on its way.",
}
Share.TEXT = TEXT

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
end

-- how CRT.Comm names a roster in its chat lines
local WHAT = { what = "the roster", locked = "Rosters" }
local incoming = {} -- sender -> { hash, total, parts, count, started }, one roster arriving per sender

-- The messages for a layout, in order, and the hash of its text.
function Share.Pack(name, slots)
    local text = Groups:Export(name, slots)
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

-- The name and 40 slots of a received text, each name through Groups.Normalize (Groups:Import); nil when it isn't
-- a layout.
function Share.Unpack(text)
    if type(text) ~= "string" or not text:find("^CRT1;") then
        return nil
    end
    local ok, name, slots = pcall(Groups.Import, Groups, text)
    if not (ok and type(name) == "string" and type(slots) == "table") then
        return nil
    end
    return name, slots
end

local function hasNames(slots)
    for i = 1, Groups.NUM_SLOTS do
        if type(slots[i]) == "string" and slots[i] ~= "" then
            return true
        end
    end
    return false
end

local function busy()
    local Notes = CRT.Notes
    if Notes and Notes.Busy then
        return Notes.Busy()
    end
    return InCombatLockdown and InCombatLockdown() or false
end

-- Sends the active layout to the group. Returns whether it went, and a line for the note editor's status.
function Share:Push()
    if busy() then
        return false, TEXT.busy
    end
    local channel = Shared.Channel()
    if not channel then
        return false, TEXT.noGroup
    end
    if not Shared.IsLeaderOrAssist("player") then
        return false, TEXT.notLead
    end
    local id = Groups:Active()
    local preset = id and Groups:Find(id)
    if not preset then
        return false, TEXT.noLayout
    end
    if not hasNames(preset.slots or {}) then
        return false, string.format(TEXT.empty, preset.name)
    end
    local messages = Share.Pack(preset.name, preset.slots)
    -- the same roster still waiting in the send queue (throttled): not queued twice; once it has gone, it goes again
    if Shared.Queued and Shared:Queued(PREFIX, messages[#messages]) then
        return true, string.format(TEXT.queued, preset.name)
    end
    if not Shared:Send(PREFIX, messages, WHAT) then
        return false, string.format(TEXT.failed, preset.name)
    end
    return true, string.format(TEXT.sent, preset.name)
end

-- Receiving ---------------------------------------------------------------------------------------------------------

-- The sender's short name and whether they lead or assist, by the check shared notes use; nil for your own.
local function senderOf(sender)
    local NoteComm = CRT.NoteComm
    if not (NoteComm and NoteComm.Sender) then
        return nil
    end
    return NoteComm.Sender(sender)
end

-- The first n bytes of s, never cutting a character in two.
local function cut(s, n)
    while n > 0 and (s:byte(n + 1) or 0) >= 128 and (s:byte(n + 1) or 0) < 192 do
        n = n - 1
    end
    return s:sub(1, n)
end

-- A received layout's name and the name it is stored under. A layout passed on from someone else loses its
-- "(from ...)" and " (2)" endings (one or two digits, so a year stays), so it shows only the newest sender. The name
-- is cut first, so "(from <sender>)" always fits whole.
local function storedName(name, short)
    local before
    repeat
        before = name
        name = strtrim((name:gsub("%s*%(from [^()]*%)$", ""):gsub("%s*%(%d%d?%)$", "")))
    until name == before
    if name == "" then
        name = TEXT.unnamed
    end
    local suffix = string.format(TEXT.stored, "", short)
    name = strtrim(cut(name, math.max(1, Groups.FROM_NAME_MAX - #suffix)))
    return name, string.format(TEXT.stored, name, short)
end
Share.StoredName = storedName

-- Whether the slots are the active layout's already.
local function isActive(slots)
    local id = Groups:Active()
    local preset = id and Groups:Find(id)
    if not (preset and type(preset.slots) == "table") then
        return false
    end
    for i = 1, Groups.NUM_SLOTS do
        if (preset.slots[i] or "") ~= (slots[i] or "") then
            return false
        end
    end
    return true
end

local function store(sender, short, text)
    local name, slots = Share.Unpack(text)
    if not (name and hasNames(slots)) then
        return
    end
    local base, full = storedName(name, short)
    -- the same people in the same slots as your active layout: no copy and no switch; only opened again when another
    -- layout or an Unsaved layout is open, with no unsaved edits to a saved one
    if isActive(slots) then
        local id = Groups:Active()
        if Groups:Selected() ~= id and not Groups:HasUnsavedEdits() then
            Groups:Select(id)
            CRT:Print(string.format(TEXT.received, base, short))
        end
        return
    end
    local id, opened = Groups:StoreFrom(Groups.Normalize(sender), full, slots)
    if opened then
        CRT:Print(string.format(TEXT.received, base, short))
        return
    end
    -- not opened: a saved layout is open with unsaved edits (Groups:HasUnsavedEdits)
    local open = Groups:Find(Groups:Selected())
    if open and open.id == id then
        -- the edits are on this copy: picking it in Quick Load would throw them away, so it isn't suggested
        CRT:Print(string.format(TEXT.receivedOwn, base, short))
    else
        CRT:Print(string.format(TEXT.receivedKept, base, short, open and open.name or ""))
    end
end

function Share.Receive(prefix, message, channel, sender)
    if Shared.IsSecret(prefix) or Shared.IsSecret(message) or Shared.IsSecret(channel) or Shared.IsSecret(sender) then
        return
    end
    if prefix ~= PREFIX or type(message) ~= "string" or type(sender) ~= "string" or not CHANNELS[channel] then
        return
    end
    -- the group's leader keeps their own roster: never one from anyone, assistants included (Alex, 2026-10-31)
    if UnitIsGroupLeader("player") then
        return
    end
    local short, trusted = senderOf(sender)
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
    store(sender, short, text)
end

local events = CreateFrame("Frame")
events:RegisterEvent("CHAT_MSG_ADDON")
events:SetScript("OnEvent", function(_, _, prefix, message, channel, sender)
    Share.Receive(prefix, message, channel, sender)
end)
