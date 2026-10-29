local ADDON, CRT = ...

-- Cooldown changes proposed to the raid lead (CRT.NoteProposals). A healer who moved their own casts on
-- Healer CDs (Notes/Shifts.lua) presses Send to raid lead; the raid leader and assistants see each change in a
-- Proposed changes box on their Healer CDs (Timeline/HealerPanel.lua) and Accept it (the note line is
-- rewritten through Notes:MoveLine, and the lead shares the note as usual) or Decline it (nothing is sent
-- back). With "Accept healers' cooldown changes automatically" (CRTDB.notes.autoAcceptCooldowns, off by
-- default) a change that checks out, to a line naming no other player, is applied at once (out of combat and
-- out of an encounter: held until both end). Proposals live for the session only, at most MAX_PER_SENDER per
-- sender and MAX_TOTAL in all, the oldest dropped first.
--
-- The message, under the prefix CRTCDMove, one per moved line, to the RAID or PARTY channel:
--   P|<version>|<encounterID>|<difficulty>|<line>|<occurrence>|<spellID>|<old phase>|<old seconds>|<new phase>|<new seconds>
--   e.g. "P|1|3001|Mythic|1f2e3d4c25|1|64843|1|171|1|185"
-- The note is named by its boss and difficulty (each computer numbers its notes its own way), the line by the
-- fingerprint of its text (Shifts.Key) and which line of that text it is (1 for the first), the times as the
-- note writes them (phase, seconds into it, to a tenth). A later minor version may add fields after these,
-- which are skipped; a higher major version or anything else is dropped. Strict: every field must read as it
-- should; the sender must be in your group; the new phase must be one the boss's ability timeline or note has.
-- The line, found in your note for that boss, must be the sender's (Owns: its tags name the sender, for that
-- spell, at the old time) when it is checked on arrival, on every draw of the box (one that fails is dropped)
-- and again by Accept. A line your note doesn't have (changed since) is kept as stale: it can't be accepted.
-- A line naming several players (an assignment) can be proposed by any of them, but only a manual Accept takes
-- it (shared): the lead's row says accepting moves everyone's timer on it.
-- Taken only by someone who may change the raid note (Notes:CanEditRaid).
--
-- Sending: never in combat (sent when it ends), never in a finder group; while the game holds addon
-- messages or throttles them, tried again every RETRY seconds, LOCK_TRIES and TRIES times, as Season Stats'
-- reports are.
--
-- Game calls (warcraft.wiki.gg, read 2026-10-24): C_ChatInfo.RegisterAddonMessagePrefix, SendAddonMessage
-- (Enum.SendAddonMessageResult), InChatMessagingLockdown, CHAT_MSG_ADDON (prefix, text, channel, sender),
-- PLAYER_REGEN_ENABLED, ENCOUNTER_END, IsEncounterInProgress, IsInRaid, IsInGroup (LE_PARTY_CATEGORY_INSTANCE),
-- GetNumGroupMembers, GetNumSubgroupMembers, GetRaidRosterInfo, UnitName, InCombatLockdown, Ambiguate.

local Notes = CRT.Notes
local Shifts = CRT.NoteShifts
local P = { list = {} }
CRT.NoteProposals = P

P.PREFIX = "CRTCDMove"
P.VERSION = 1
P.MAX_SECONDS = 3600 -- a time past an hour into its phase is not a raid note time
P.MAX_PHASE = 20
P.MAX_DIFFICULTY = 24
P.MAX_OCCURRENCE = 99
P.MAX_PER_SENDER = 20 -- proposals kept per sender, and in all: the oldest go first
P.MAX_TOTAL = 100
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
}
P.TEXT = TEXT

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local THROTTLED = RESULT.AddonMessageThrottle or 3
local CHANNEL_THROTTLED = RESULT.ChannelThrottle or 8
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11

if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(P.PREFIX)
end

local readable, key = Shifts.Readable, Shifts.PlayerKey
P.Key = key
P.SpellLabel = Shifts.SpellLabel

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

-- The message ----------------------------------------------------------------------------------------------

-- e: { encounterID, difficulty, hash, occ, spellID, oldPh, oldT, newPh, newT }.
function P.Encode(e)
    local difficulty = tostring(e.difficulty or ""):gsub("[|%c]", ""):sub(1, P.MAX_DIFFICULTY)
    return table.concat({ "P", P.VERSION, e.encounterID, difficulty, e.hash, e.occ or 1, e.spellID, e.oldPh,
        seconds(e.oldT), e.newPh, seconds(e.newT) }, "|")
end

local function wholeOf(s, low, high)
    local n = s and s:match("^%d+$") and #s <= 9 and tonumber(s)
    return n and n >= low and n <= high and n or nil
end

local function secondsOf(s)
    local n = s and (s:match("^%d+$") or s:match("^%d+%.%d$")) and #s <= 8 and tonumber(s)
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
    if fields[1] ~= "P" or #fields < 11 then
        return nil
    end
    local version = wholeOf(fields[2], 1, P.VERSION)
    if not version then
        return nil
    end
    local e = {
        encounterID = wholeOf(fields[3], 1, 999999999),
        difficulty = fields[4],
        hash = fields[5]:match("^%x+$") and #fields[5] <= 16 and fields[5] or nil,
        occ = wholeOf(fields[6], 1, P.MAX_OCCURRENCE),
        spellID = wholeOf(fields[7], 1, 999999999),
        oldPh = wholeOf(fields[8], 1, P.MAX_PHASE),
        oldT = secondsOf(fields[9]),
        newPh = wholeOf(fields[10], 1, P.MAX_PHASE),
        newT = secondsOf(fields[11]),
    }
    if not (e.encounterID and e.hash and e.occ and e.spellID and e.oldPh and e.oldT and e.newPh and e.newT) then
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

-- The tags of a line that name players, as written: every tag but the role and raid words, classes and raid
-- groups (Parse.lua's words).
function P.PlayerTags(tags)
    local Parser = CRT.NoteParser
    local out, i = {}, 1
    while i <= #(tags or {}) do
        local tag = tags[i]
        local word = type(tag) == "string" and tag:lower() or ""
        local _, n = Parser.ClassAt(tags, i)
        local prefix = word:match("^(%a+)%d$")
        if n then
            i = i + n
        elseif Parser.TAG_WORDS[word] or (prefix and Parser.GROUP_WORDS[prefix]) then
            i = i + 1
        elseif Parser.GROUP_WORDS[word] and type(tags[i + 1]) == "string" and tags[i + 1]:match("^%d$") then
            i = i + 2
        else
            if word ~= "" then
                out[#out + 1] = tag
            end
            i = i + 1
        end
    end
    return out
end

-- Whether a line's tags name no other player than this one.
function P.OnlyPlayer(tags, name)
    for _, tag in ipairs(P.PlayerTags(tags)) do
        if not Shifts.TagsName({ tag }, name) then
            return false
        end
    end
    return true
end

-- Marks a proposal shared when its line is for anyone but the sender alone: another player, or a role, class
-- or raid group word beside them ("Rixxy healers"). It is part of an assignment, so accepting moves everyone's
-- timer on it, and it is never auto-accepted. players: every tag as written (the row's tooltip); playerCount:
-- how many name players; others: the role, class and group words.
local function share(p, timer)
    p.shared, p.players, p.playerCount, p.others = false, nil, nil, nil
    if not timer then
        return
    end
    for _, tag in ipairs(timer.tags or {}) do
        if not Shifts.TagsName({ tag }, p.sender) then
            p.shared = true
        end
    end
    if p.shared then
        local names, isName = P.PlayerTags(timer.tags), {}
        for _, n in ipairs(names) do
            isName[n] = true
        end
        local others = {}
        for _, tag in ipairs(timer.tags) do
            if not isName[tag] then
                others[#others + 1] = tag
            end
        end
        p.players, p.playerCount, p.others = timer.tags, #names, others
    end
end

-- The phases the boss has: 1, the note's own, and its ability timeline's (each difficulty group's when the
-- note names no difficulty).
local function knownPhases(p, id)
    local known = { [1] = true }
    local note = id and Notes:Parsed(id)
    for _, timer in ipairs(note and note.timers or {}) do
        known[timer.ph] = true
    end
    for _, ph in ipairs(note and note.phases or {}) do
        known[ph] = true
    end
    local T, Reminders = CRT.Timeline, CRT.AlertReminders
    if T and T.ReferenceFor and Reminders and Reminders.PhaseNumber then
        local group = p.difficulty and T.GroupFor and T:GroupFor(p.difficulty)
        for _, g in ipairs(group and { group } or { "nh", "mythic" }) do
            local ok, entry = pcall(T.ReferenceFor, T, p.encounterID, g)
            for _, ph in ipairs(ok and entry and entry.ref and entry.ref.phases or {}) do
                local n = Reminders.PhaseNumber(ph.label)
                if n then
                    known[n] = true
                end
            end
        end
    end
    return known
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
    local n = 0
    for _, id in ipairs(ids or {}) do
        local record = Notes:Get(id)
        local note = Notes:Parsed(id)
        local moved = record and Shifts:ByLine(id)
        if moved and type(record.encounterID) == "number" then
            for _, timer in ipairs(note and note.timers or {}) do
                local e = moved[timer.line]
                if e and type(timer.spellId) == "number" then
                    queue[#queue + 1] = { throttles = 0, locks = 0, text = P.Encode({
                        encounterID = record.encounterID, difficulty = record.difficulty, hash = Shifts.Key(e.raw),
                        occ = e.occ or 1, spellID = timer.spellId, oldPh = timer.ph, oldT = timer.time, newPh = e.ph,
                        newT = e.t,
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

-- Where a proposal's line is in your note now: the note id, line number and text, or nil when your note for
-- that boss has no such line (stale).
function P:Locate(p)
    local id = Notes:FindForEncounter(p.encounterID, p.difficulty)
    if not id then
        return nil
    end
    local seen = 0
    for i, raw in ipairs(Notes:RawLines(id)) do
        if Shifts.Key(raw) == p.hash then
            seen = seen + 1
            if seen == (p.occ or 1) then
                return id, i, raw
            end
        end
    end
    return nil
end

-- Whether a proposal's line, where Locate found it, is the sender's own: a timed line for that spell at the
-- old time, its tags naming the sender. The one check of arrival, every draw and Accept.
function P.Owns(p, id, line)
    local timer = id and line and Notes:TimerAt(id, line)
    return timer ~= nil and timer.spellId == p.spellID and timer.ph == p.oldPh and type(timer.time) == "number"
        and tenth(timer.time) == tenth(p.oldT)
        and Shifts.TagsName(timer.tags, p.sender), timer
end

local function remove(p)
    for i = #P.list, 1, -1 do
        if P.list[i] == p then
            table.remove(P.list, i)
        end
    end
end

-- From the notes as they are now: a proposal whose line is found but isn't the sender's own is dropped; one
-- whose line isn't found is stale; shared says the line names other players too. The box asks once per draw.
function P:Check()
    for i = #self.list, 1, -1 do
        local p = self.list[i]
        local id, line = self:Locate(p)
        local owns, timer = P.Owns(p, id, line)
        if id and not owns then
            table.remove(self.list, i)
        else
            p.stale = id == nil
            share(p, timer)
        end
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

-- Writes a proposal into your note: the line at its new time, every other field kept. auto: applied by
-- auto-accept, which the chat line says. True when written.
function P:Accept(p, auto)
    local can, why = Notes:CanEditRaid()
    if not can then
        CRT:Print(why or TEXT.notLead)
        return false
    end
    local id, line, raw = self:Locate(p)
    if not id then
        p.stale = true
        CRT:Print(string.format(TEXT.stale, p.short))
        redraw()
        return false
    end
    if not P.Owns(p, id, line) then
        remove(p) -- the line there now isn't the sender's
        CRT:Print(string.format(TEXT.stale, p.short))
        redraw()
        return false
    end
    -- out of the list first, so the redraw the write fires no longer shows it
    remove(p)
    if not Notes:MoveLine(id, line, p.newPh, p.newT, raw) then
        self.list[#self.list + 1] = p
        CRT:Print(TEXT.failed)
        redraw()
        return false
    end
    CRT:Print(string.format(auto and TEXT.autoAccepted or TEXT.accepted, p.short, Shifts.SpellLabel(p.spellID),
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

-- In combat or a boss encounter: auto-accept waits (the note isn't rewritten mid-pull). Notes/Data.lua's Busy.
local function busy()
    return Notes.Busy()
end

-- Applies the proposals auto-accept holds, once out of combat and encounter. Each is checked again.
function P:ApplyHeld()
    if busy() then
        for _, p in ipairs(self.list) do
            if p.held then
                -- still held: wait for the next end of combat too, not only the next encounter's end
                driver:RegisterEvent("PLAYER_REGEN_ENABLED")
                driver:RegisterEvent("ENCOUNTER_END")
                break
            end
        end
        return
    end
    local list = {}
    for i, p in ipairs(self.list) do
        list[i] = p -- a copy: Accept takes them out of the list
    end
    for _, p in ipairs(list) do
        if p.held then
            p.held = nil
            self:Check()
            if not p.stale and not p.shared and P.AutoAccept() then
                self:Accept(p, true)
            end
        end
    end
    redraw()
end

-- Keeps the list inside its caps: the sender's oldest past MAX_PER_SENDER, then anyone's oldest past MAX_TOTAL.
local function cap(who)
    local mine = 0
    for i = #P.list, 1, -1 do
        if P.list[i].who == who then
            mine = mine + 1
            if mine > P.MAX_PER_SENDER then
                table.remove(P.list, i)
            end
        end
    end
    while #P.list > P.MAX_TOTAL do
        table.remove(P.list, 1)
    end
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
    if not who or who == Shifts.Me() or not inGroup(who) then
        return nil
    end
    local e = P.Decode(text)
    if not e then
        return nil
    end
    local short = Ambiguate and Ambiguate(sender, "none") or sender
    e.sender, e.who, e.short = sender, who, short
    local id, line = self:Locate(e)
    local owns, timer = P.Owns(e, id, line)
    if id and not owns then
        return nil -- not the sender's own line for that spell at that time
    end
    local known = knownPhases(e, id or Notes:FindForEncounter(e.encounterID, e.difficulty))
    if not known[e.newPh] then
        return nil -- a phase the boss doesn't have
    end
    e.stale = id == nil
    share(e, timer)
    -- a newer proposal for the same line replaces the older
    for i = #self.list, 1, -1 do
        local old = self.list[i]
        if old.who == who and old.hash == e.hash and old.occ == e.occ and old.encounterID == e.encounterID then
            table.remove(self.list, i)
        end
    end
    self.list[#self.list + 1] = e
    cap(who)
    if not e.stale and not e.shared and P.AutoAccept() then
        if not busy() then
            if self:Accept(e, true) then
                return e
            end
        else
            e.held = true -- applied once combat and the encounter end
            driver:RegisterEvent("PLAYER_REGEN_ENABLED")
            driver:RegisterEvent("ENCOUNTER_END")
        end
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
    elseif event == "PLAYER_REGEN_ENABLED" or event == "ENCOUNTER_END" then
        if event == "PLAYER_REGEN_ENABLED" then
            driver:UnregisterEvent("PLAYER_REGEN_ENABLED")
        end
        if combatWait and not InCombatLockdown() then
            combatWait = false
            sendNext()
        end
        -- ENCOUNTER_END comes while the encounter still counts as in progress: try again once it has ended
        P:ApplyHeld()
        if C_Timer and C_Timer.After then
            C_Timer.After(P.RETRY, function()
                P:ApplyHeld()
            end)
        end
    end
end)
