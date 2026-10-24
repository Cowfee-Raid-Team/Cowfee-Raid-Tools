local ADDON, CRT = ...

-- Cooldown changes proposed to the raid lead (CRT.NoteProposals). A healer who moved their own casts on
-- Healer CDs (Notes/Shifts.lua) presses Send to raid lead; the raid leader and assistants see each change in a
-- Proposed changes box on their Healer CDs (Timeline/HealerPanel.lua) and Accept it (the note line is
-- rewritten through the note's own line write, Notes:ReplaceLine, and the lead shares the note as usual) or
-- Decline it (nothing is sent back). With "Accept healers' cooldown changes automatically"
-- (CRTDB.notes.autoAcceptCooldowns, off by default) a change that checks out is applied at once.
-- Proposals live for the session only.
--
-- The message, under the prefix CRTCDMove, one per moved line, to the RAID or PARTY channel:
--   P|<version>|<encounterID>|<difficulty>|<line>|<spellID>|<old phase>|<old seconds>|<new phase>|<new seconds>
--   e.g. "P|1|3001|Mythic|1f2e3d4c25|64843|1|171|1|185"
-- The note is named by its boss and difficulty (each computer numbers its notes its own way), the line by the
-- fingerprint of its text (Shifts.Key), the times as the note writes them (phase, seconds into it, to a
-- tenth). A later minor version may add fields after these, which are skipped; a higher major version or
-- anything else is dropped. Strict: every field must read as it should, the sender must be in your group and
-- the line, found in your note for that boss, must be the sender's own (its tags name the sender) and for that
-- spell. A line your note no longer has (you changed it since) is kept as stale: it can't be accepted.
-- Taken only by someone who may change the raid note (Notes:CanEditRaid).
--
-- Sending: never in combat (sent when it ends), never in a finder group; while the game holds addon
-- messages or throttles them, tried again every RETRY seconds, LOCK_TRIES and TRIES times, as Season Stats'
-- reports are.
--
-- Game calls (warcraft.wiki.gg, read 2026-10-24): C_ChatInfo.RegisterAddonMessagePrefix, SendAddonMessage
-- (Enum.SendAddonMessageResult), InChatMessagingLockdown, CHAT_MSG_ADDON (prefix, text, channel, sender),
-- PLAYER_REGEN_ENABLED, IsInRaid, IsInGroup (LE_PARTY_CATEGORY_INSTANCE), GetNumGroupMembers,
-- GetNumSubgroupMembers, GetRaidRosterInfo, UnitName, GetNormalizedRealmName, InCombatLockdown, Ambiguate.

local Notes = CRT.Notes
local P = { list = {} }
CRT.NoteProposals = P

P.PREFIX = "CRTCDMove"
P.VERSION = 1
P.MAX_SECONDS = 3600 -- a time past an hour into its phase is not a raid note time
P.MAX_PHASE = 20
P.MAX_DIFFICULTY = 24
P.TRIES = 3 -- tries of a throttled message
P.LOCK_TRIES = 15 -- tries while the game holds addon messages
P.RETRY = 2 -- seconds before trying again
P.CHAT_DELAY = 1 -- seconds of proposals from one player added up into one chat line

local TEXT = {
    proposed = "%s proposed %d cooldown change%s: /crt timeline",
    accepted = "Accepted %s's %s time: %s to %s. Share the note to send it to the raid.",
    autoAccepted = "Accepted %s's %s time automatically: %s to %s. Share the note to send it to the raid.",
    stale = "That line of the raid note changed since %s sent it, so it can't be accepted.",
    notLead = "Only the raid leader or an assistant can accept a change.",
    failed = "That change could not be written to the raid note.",
    noGroup = "You need to be in a group to send your times to the raid lead.",
    nothing = "You have no moved casts to send.",
    sent = "Sent %d moved cast%s to the raid lead.",
    afterCombat = "Your moved casts go to the raid lead once combat ends.",
    cooldown = "cooldown",
}
P.TEXT = TEXT

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local THROTTLED = RESULT.AddonMessageThrottle or 3
local CHANNEL_THROTTLED = RESULT.ChannelThrottle or 8
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(P.PREFIX)
end

local function readable(v)
    if issecretvalue then
        local ok, secret = pcall(issecretvalue, v)
        if not ok or secret then
            return false
        end
    end
    return true
end

local function tenth(t)
    return math.floor(t * 10 + 0.5) / 10
end

-- A time as the message writes it: whole seconds, or one decimal.
local function seconds(t)
    t = tenth(t)
    if t == math.floor(t) then
        return string.format("%d", t)
    end
    return string.format("%.1f", t)
end

-- m:ss, or m:ss.s with tenths.
local function clock(t)
    t = tenth(t)
    local m = math.floor(t / 60)
    if t == math.floor(t) then
        return string.format("%d:%02d", m, t % 60)
    end
    return string.format("%d:%04.1f", m, t - m * 60)
end

-- A time in its phase: "2:51" in phase 1, "P2 +0:51" after.
function P.FormatTime(ph, t)
    if ph == 1 then
        return clock(t)
    end
    return "P" .. tostring(ph) .. " +" .. clock(t)
end

-- "Name-Realm" as one key, lower case: your realm added when missing, the realm's spaces and dashes left out.
local function key(name)
    if not (readable(name) and type(name) == "string" and name ~= "") then
        return nil
    end
    local base, realm = name:match("^([^%-]+)%-(.+)$")
    if not base then
        base = name
        realm = GetNormalizedRealmName and GetNormalizedRealmName() or ""
        if not (readable(realm) and type(realm) == "string") then
            realm = ""
        end
    end
    return base:lower() .. "-" .. realm:lower():gsub("[%s%-]", "")
end
P.Key = key

local function spellLabel(spellID)
    local info = Notes.SpellInfo and Notes:SpellInfo(spellID)
    if info and type(info.name) == "string" then
        return info.name
    end
    if C_Spell and C_Spell.GetSpellName then
        local ok, name = pcall(C_Spell.GetSpellName, spellID)
        if ok and readable(name) and type(name) == "string" and name ~= "" then
            return name
        end
    end
    return TEXT.cooldown
end
P.SpellLabel = spellLabel

-- The message ----------------------------------------------------------------------------------------------

-- e: { encounterID, difficulty, hash, spellID, oldPh, oldT, newPh, newT }.
function P.Encode(e)
    local difficulty = tostring(e.difficulty or ""):gsub("[|%c]", ""):sub(1, P.MAX_DIFFICULTY)
    return table.concat({ "P", P.VERSION, e.encounterID, difficulty, e.hash, e.spellID, e.oldPh, seconds(e.oldT),
        e.newPh, seconds(e.newT) }, "|")
end

local function phaseOf(s)
    local n = s and s:match("^%d%d?$") and tonumber(s)
    return n and n >= 1 and n <= P.MAX_PHASE and n or nil
end

local function secondsOf(s)
    local n = s and (s:match("^%d+$") or s:match("^%d+%.%d$")) and tonumber(s)
    return n and n >= 0 and n <= P.MAX_SECONDS and n or nil
end

-- The proposal in a message, or nil for anything that isn't one this CRT reads.
function P.Decode(text)
    if not (readable(text) and type(text) == "string") or #text > 255 then
        return nil
    end
    local fields = {}
    for f in (text .. "|"):gmatch("([^|]*)|") do
        fields[#fields + 1] = f
    end
    if fields[1] ~= "P" or #fields < 10 then
        return nil
    end
    local version = fields[2]:match("^%d+$") and tonumber(fields[2])
    if not version or version < 1 or version > P.VERSION then
        return nil
    end
    local e = {
        encounterID = fields[3]:match("^%d+$") and tonumber(fields[3]),
        difficulty = fields[4],
        hash = fields[5]:match("^%x+$") and #fields[5] <= 16 and fields[5] or nil,
        spellID = fields[6]:match("^%d+$") and tonumber(fields[6]),
        oldPh = phaseOf(fields[7]),
        oldT = secondsOf(fields[8]),
        newPh = phaseOf(fields[9]),
        newT = secondsOf(fields[10]),
    }
    if not (e.encounterID and e.encounterID > 0 and e.hash and e.spellID and e.spellID > 0 and e.oldPh and e.oldT
        and e.newPh and e.newT) then
        return nil
    end
    if #e.difficulty > P.MAX_DIFFICULTY or e.difficulty:find("%c") then
        return nil
    end
    if e.difficulty == "" then
        e.difficulty = nil
    end
    return e
end

-- The group ------------------------------------------------------------------------------------------------

-- The channel to send on: RAID or PARTY, never a finder group's; nil out of a group.
local function channel()
    if IsInGroup and LE_PARTY_CATEGORY_INSTANCE and IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return nil
    end
    if IsInRaid and IsInRaid() then
        return "RAID"
    elseif IsInGroup and IsInGroup() then
        return "PARTY"
    end
    return nil
end
P.Channel = channel

-- Whether a player (by key) is in your group now. A secret name is never compared.
local function inGroup(who)
    if not who then
        return false
    end
    if IsInRaid and IsInRaid() then
        for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do
            local ok, name = pcall(GetRaidRosterInfo, i)
            if ok and key(name) == who then
                return true
            end
        end
        return false
    end
    for i = 1, (GetNumSubgroupMembers and GetNumSubgroupMembers() or 0) do
        local ok, name, realm = pcall(UnitName, "party" .. i)
        if ok and readable(name) and readable(realm) and type(name) == "string" then
            local full = (type(realm) == "string" and realm ~= "") and (name .. "-" .. realm) or name
            if key(full) == who then
                return true
            end
        end
    end
    return false
end

-- Sending ----------------------------------------------------------------------------------------------------

local queue = {} -- messages waiting to go: { text, throttles, locks }
local driver = CreateFrame("Frame")
P.events = driver
local combatWait, timerSet = false, false
local sendNext

local function held()
    if C_ChatInfo and C_ChatInfo.InChatMessagingLockdown then
        local ok, locked = pcall(C_ChatInfo.InChatMessagingLockdown)
        return ok and readable(locked) and locked == true
    end
    return false
end

local function later()
    if not timerSet then
        timerSet = true
        C_Timer.After(P.RETRY, function()
            timerSet = false
            sendNext()
        end)
    end
end

sendNext = function()
    local item = queue[1]
    if not item then
        return
    end
    local ch = channel()
    if not ch or not (C_ChatInfo and C_ChatInfo.SendAddonMessage) then
        queue = {}
        return
    end
    if InCombatLockdown() then
        combatWait = true
        driver:RegisterEvent("PLAYER_REGEN_ENABLED")
        return
    end
    local result
    if held() then
        result = LOCKDOWN
    else
        local ok, r = pcall(C_ChatInfo.SendAddonMessage, P.PREFIX, item.text, ch)
        result = ok and r or nil
    end
    if result == THROTTLED or result == CHANNEL_THROTTLED then
        item.throttles = item.throttles + 1
        if item.throttles < P.TRIES then
            return later()
        end
    elseif result == LOCKDOWN then
        item.locks = item.locks + 1
        if item.locks < P.LOCK_TRIES then
            return later()
        end
    end
    table.remove(queue, 1)
    if queue[1] then
        sendNext()
    end
end

-- Your moved casts of these notes (ids) as proposals: one message for each line still in its note. Returns
-- how many were queued.
function P:Send(ids)
    if not channel() then
        CRT:Print(TEXT.noGroup)
        return 0
    end
    local Shifts = CRT.NoteShifts
    local n = 0
    for _, id in ipairs(ids or {}) do
        local record = Notes:Get(id)
        local note = Notes:Parsed(id)
        local moved = record and Shifts and Shifts:ByLine(id)
        if moved and type(record.encounterID) == "number" then
            for _, timer in ipairs(note and note.timers or {}) do
                local e = moved[timer.line]
                if e and type(timer.spellId) == "number" then
                    queue[#queue + 1] = { throttles = 0, locks = 0, text = P.Encode({
                        encounterID = record.encounterID, difficulty = record.difficulty, hash = Shifts.Key(e.raw),
                        spellID = timer.spellId, oldPh = timer.ph, oldT = timer.time, newPh = e.ph, newT = e.t,
                    }) }
                    n = n + 1
                end
            end
        end
    end
    if n == 0 then
        CRT:Print(TEXT.nothing)
        return 0
    end
    CRT:Print(InCombatLockdown() and TEXT.afterCombat or string.format(TEXT.sent, n, n == 1 and "" or "s"))
    sendNext()
    return n
end

-- The raid lead's side ----------------------------------------------------------------------------------------

-- Where a proposal's line is in your note now: the note id and line number, or nil when your note for that
-- boss has no line with that text (stale).
function P:Locate(p)
    local id = Notes:FindForEncounter(p.encounterID, p.difficulty)
    if not id then
        return nil
    end
    local Shifts = CRT.NoteShifts
    for i, raw in ipairs(Notes:RawLines(id)) do
        if Shifts.Key(raw) == p.hash then
            return id, i, raw
        end
    end
    return nil
end

-- Marks each proposal stale or not, from the notes as they are now (the Healer CDs box asks once per draw).
function P:Check()
    for _, p in ipairs(self.list) do
        p.stale = self:Locate(p) == nil
    end
end

-- The proposals for one boss, oldest first.
function P:ForEncounter(encounterID)
    local out = {}
    for _, p in ipairs(self.list) do
        if p.encounterID == encounterID then
            out[#out + 1] = p
        end
    end
    return out
end

local function redraw()
    local HV = CRT.TimelineHealerView
    if HV and HV.Changed then
        HV.Changed()
    end
end

local function remove(p)
    for i = #P.list, 1, -1 do
        if P.list[i] == p then
            table.remove(P.list, i)
        end
    end
end

-- Writes a proposal into your note: the line at its new time, every other field kept. auto: applied by
-- auto-accept, which the chat line says. True when written.
function P:Accept(p, auto)
    local can, why = Notes:CanEditRaid()
    if not can then
        CRT:Print(why or TEXT.notLead)
        return false
    end
    local id, line, raw = self:Locate(p)
    local timer = id and Notes:TimerAt(id, line)
    if not timer then
        p.stale = true
        CRT:Print(string.format(TEXT.stale, p.short))
        redraw()
        return false
    end
    local Parser = CRT.NoteParser
    local moved = {}
    for k, v in pairs(timer) do
        moved[k] = v
    end
    moved.ph, moved.time = p.newPh, p.newT
    -- out of the list first, so the redraw the write fires no longer shows it
    remove(p)
    if not Notes:ReplaceLine(id, line, Parser.FormatLine(moved) .. Parser.UnknownFields(raw), raw) then
        self.list[#self.list + 1] = p
        CRT:Print(TEXT.failed)
        redraw()
        return false
    end
    CRT:Print(string.format(auto and TEXT.autoAccepted or TEXT.accepted, p.short, spellLabel(p.spellID),
        P.FormatTime(p.oldPh, p.oldT), P.FormatTime(p.newPh, p.newT)))
    redraw()
    return true
end

-- Drops a proposal; nothing is sent back.
function P:Decline(p)
    remove(p)
    redraw()
end

function P.AutoAccept()
    local db = CRT.db and CRT.db.notes
    return db and db.autoAcceptCooldowns == true or false
end

function P.SetAutoAccept(on)
    Notes:Set(nil, "autoAcceptCooldowns", on and true or false)
    redraw()
end

-- The chat line per sender, once their burst of proposals is in.
local told = {} -- short name -> count waiting to be told
local chatSet = false

local function tell()
    chatSet = false
    for short, n in pairs(told) do
        CRT:Print(string.format(TEXT.proposed, short, n, n == 1 and "" or "s"))
    end
    told = {}
end

-- One message heard: kept as a proposal when it is one, from a group member about their own line.
-- Returns the proposal, or nil when it was dropped.
function P:Hear(prefix, text, ch, sender)
    if not (readable(prefix) and prefix == P.PREFIX and readable(ch) and (ch == "RAID" or ch == "PARTY")) then
        return nil
    end
    if not Notes:CanEditRaid() then
        return nil
    end
    local who = key(sender)
    local me = UnitName and key(UnitName("player"))
    if not who or who == me or not inGroup(who) then
        return nil
    end
    local e = P.Decode(text)
    if not e then
        return nil
    end
    local short = Ambiguate and Ambiguate(sender, "none") or sender
    e.sender, e.who, e.short = sender, who, short
    local id, line = self:Locate(e)
    if id then
        local timer = Notes:TimerAt(id, line)
        local Shifts = CRT.NoteShifts
        if not (timer and timer.spellId == e.spellID and Shifts.TagsName(timer.tags, sender)) then
            return nil -- not the sender's own line for that spell
        end
    end
    e.stale = id == nil
    -- a newer proposal for the same line replaces the older
    for i = #self.list, 1, -1 do
        local old = self.list[i]
        if old.who == who and old.hash == e.hash and old.encounterID == e.encounterID then
            table.remove(self.list, i)
        end
    end
    self.list[#self.list + 1] = e
    if not e.stale and P.AutoAccept() and self:Accept(e, true) then
        return e
    end
    told[short] = (told[short] or 0) + 1
    if not chatSet then
        chatSet = true
        C_Timer.After(P.CHAT_DELAY, tell)
    end
    redraw()
    return e
end

driver:RegisterEvent("CHAT_MSG_ADDON")
driver:SetScript("OnEvent", function(_, event, ...)
    if event == "CHAT_MSG_ADDON" then
        P:Hear(...)
    elseif event == "PLAYER_REGEN_ENABLED" then
        driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
        if combatWait then
            combatWait = false
            sendNext()
        end
    end
end)
