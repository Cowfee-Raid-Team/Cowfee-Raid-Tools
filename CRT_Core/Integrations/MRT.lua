local ADDON, CRT = ...

-- Note target: Method Raid Tools' raid note (see Integrations/NoteTargets.lua for the interface). Every
-- raider running MRT sees the note in their MRT note window, with its {time:} lines counting down.
--
-- MRT has no public send call, so this speaks its addon-message format with the game's own
-- C_ChatInfo.SendAddonMessage, through one queue so the parts arrive in order, waiting a second only
-- when the game reports the throttle (the same way Notes/Comm.lua sends). Reading back uses MRT's
-- globals GMRT (its callbacks) and VMRT (its saved note), only after checking they exist.

local Targets = CRT.NoteTargets

-- MRT's wire format, VERSION-SENSITIVE. Worked out against MRT 5335. If an MRT update stops notes
-- arriving, this block is the one place to fix.
--   each message is "<subcommand>\t<field>\t<field>..." under PREFIX, so a note may hold no tabs
--   the note: "multiline\t<index>\t<part>" for each part in order, all with the same index
--   then: "multiline_add\t<index>\t<encounterID or ->\t<note name>", the note's boss and name
--   a single space as the note text clears it
--   receivers in a raid take it only from the leader or an assistant (MRT's default "only promoted")
--   solo, it goes as a WHISPER to yourself, which MRT accepts from its own character
local WIRE = {
    addon = "MRT",
    prefix = "EXRTADD",
    note = "multiline",
    meta = "multiline_add",
    noBoss = "-",
    clearText = " ",
    maxMessage = 255,
    maxPart = 220,
    receivedCallback = "Note_ReceivedText",
}

local MRT = {
    key = "mrt",
    label = "MRT",
    help = "Sends the note to everyone running MRT, as their raid note: timed lines become countdowns, and lines for a role, group or class show only to them. CRT's own note stays as it is. In a raid, only the leader or an assistant can send; in a party, anyone. Out of a group it goes to your own MRT, to try it.",
}
CRT.MRTTarget = MRT

local RESULT = Enum and Enum.SendAddonMessageResult or {}
local SUCCESS = RESULT.Success or 0
local THROTTLED = RESULT.AddonMessageThrottle or 3
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11

-- The channel, and the whisper target when you are on your own (only your own MRT gets it).
local function channel()
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return "INSTANCE_CHAT"
    elseif IsInRaid() then
        return "RAID"
    elseif IsInGroup() then
        return "PARTY"
    end
    return "WHISPER", UnitName("player")
end

-- CRT note text into MRT's -----------------------------------------------------------------------
--
-- Samples (CRT line -> MRT line), also printed by /crt dev mrt samples:
--   time:75;tag:Abu Sixz;spellid:64843;text:Hymn;  -> {time:1:15} {spell:64843} Abu Sixz - Hymn
--   time:20;ph:2;tag:healer;text:Spread;           -> {H}{time:0:20,p2} - Spread{/H}
--   time:34;tag:all;text:Defensives;               -> {everyone} {time:0:34} - Defensives
--   time:48;tag:group2;text:Soak left;             -> {g2}{time:0:48} - Soak left{/g}
--   time:60;tag:PRIEST PALADIN;text:Dispel;        -> {c:Priest,Paladin}{time:1:00} - Dispel{/c}
--   EncounterID:3470;Name:Nek'zali;                -> (dropped; sent as the note's boss and name)
--   {star} Group 1 left                            -> {star} Group 1 left

local ROLE_BLOCK = { tank = "T", healer = "H", heal = "H", dps = "D", damager = "D", damage = "D" }

local classNames -- "PRIEST" -> "Priest" (the game's class name), built on first use
local function className(word)
    if not classNames then
        classNames = {}
        for id = 1, GetNumClasses() do
            local name, file = GetClassInfo(id)
            if file and name then
                classNames[file] = name
            end
        end
    end
    return classNames[word:upper()]
end

-- What a tag's words ask for: "everyone", a single role, groups, classes, or names.
local function tagKind(words)
    if #words == 0 then
        return "none"
    end
    local roles, groups, classes, names = {}, {}, {}, {}
    for _, w in ipairs(words) do
        local lower = w:lower()
        if lower == "all" or lower == "everyone" then
            return "everyone"
        elseif ROLE_BLOCK[lower] then
            roles[ROLE_BLOCK[lower]] = true
        elseif lower:match("^group[1-8]$") then
            groups[#groups + 1] = lower:sub(-1)
        elseif className(w) then
            classes[#classes + 1] = className(w)
        else
            names[#names + 1] = w
        end
    end
    local roleList = {}
    for letter in pairs(roles) do
        roleList[#roleList + 1] = letter
    end
    if #names > 0 or (#roleList > 0 and (#groups > 0 or #classes > 0)) or (#groups > 0 and #classes > 0) then
        return "names"
    elseif #roleList == 1 then
        return "role", roleList[1]
    elseif #roleList > 1 then
        return "names" -- MRT's role blocks nest as "and", so several roles stay as words
    elseif #groups > 0 then
        return "groups", table.concat(groups)
    end
    return "classes", table.concat(classes, ",")
end

local function clock(seconds)
    seconds = math.max(0, math.floor(seconds + 0.5))
    return format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

local function timedLine(line)
    local f = {}
    for _, p in ipairs(Targets.Fields(line)) do
        f[p.key:lower()] = p.value
    end
    local t = tonumber(f.time)
    if not t then
        return line
    end
    local ph = tonumber(f.ph)
    local out = "{time:" .. clock(t) .. ((ph and ph > 1) and (",p" .. ph) or "") .. "}"
    local spell = tonumber(f.spellid)
    if spell then
        out = out .. " {spell:" .. spell .. "}"
    end
    local words = {}
    for w in (f.tag or ""):gmatch("%S+") do
        words[#words + 1] = w
    end
    local kind, value = tagKind(words)
    if kind == "names" then
        out = out .. " " .. table.concat(words, " ")
    end
    if f.text and f.text ~= "" then
        out = out .. " - " .. f.text
    end
    if kind == "everyone" then
        return "{everyone} " .. out
    elseif kind == "role" then
        return "{" .. value .. "}" .. out .. "{/" .. value .. "}"
    elseif kind == "groups" then
        return "{g" .. value .. "}" .. out .. "{/g}"
    elseif kind == "classes" then
        return "{c:" .. value .. "}" .. out .. "{/c}"
    end
    return out
end

-- The one place a CRT note becomes an MRT note. The header and the invite list are dropped (the boss
-- and name go in the multiline_add message), timed lines become {time:} lines with only what MRT can
-- show (CRT's and NSRT's display fields are left out), and every other line passes through. Tabs
-- become spaces, since a tab ends a field on the wire, and doubled pipes from an edit box are undone.
function MRT.ToMRTText(raw)
    local out = {}
    for rawLine in ((raw or "") .. "\n"):gmatch("(.-)\r?\n") do
        local line = strtrim(rawLine)
        local lower = line:lower()
        if lower:find("^time:") then
            out[#out + 1] = timedLine(line)
        elseif not (lower:find("^encounterid:") or lower:find("^invitelist:")) then
            out[#out + 1] = line
        end
    end
    while #out > 0 and out[#out] == "" do
        out[#out] = nil
    end
    return (table.concat(out, "\n"):gsub("\t", " "):gsub("||", "|"))
end

MRT.Samples = {
    { "names and a spell", "time:75;tag:Abu Sixz;spellid:64843;text:Hymn;" },
    { "a role, phase 2", "time:20;ph:2;tag:healer;text:Spread;" },
    { "everyone", "time:34;tag:all;text:Defensives;" },
    { "a group", "time:48;tag:group2;text:Soak left;" },
    { "classes", "time:60;tag:PRIEST PALADIN;text:Dispel;" },
    { "a header", "EncounterID:3470;Name:Nek'zali;Difficulty:Mythic;" },
    { "free text", "{star} Group 1 left" },
}

-- Sending -------------------------------------------------------------------------------------

local queue = {} -- { body, send } in order; send = { parts, done } shared by one send's messages
local waiting = false -- a throttle retry is scheduled

local function fail(send, message)
    for i = #queue, 1, -1 do
        if queue[i].send == send then
            table.remove(queue, i)
        end
    end
    send.done(false, message)
end

local function pump()
    waiting = false
    while queue[1] do
        local item = queue[1]
        local chan, whisperTo = channel()
        if item.send.chan ~= chan then
            fail(item.send, "your group changed while sending; send again.")
        else
            local ok, result = pcall(C_ChatInfo.SendAddonMessage, WIRE.prefix, item.body, chan, whisperTo)
            if ok and result == THROTTLED then
                waiting = true
                C_Timer.After(1, pump)
                return
            elseif not ok then
                fail(item.send, "the game refused the message (" .. tostring(result) .. ").")
            elseif result == LOCKDOWN then
                fail(item.send, "addon messages are locked down (an encounter); send again after it.")
            elseif not (result == true or result == nil or result == SUCCESS) then
                fail(item.send, "the game refused the message (result " .. tostring(result) .. ").")
            else
                table.remove(queue, 1)
                if item.last then
                    item.send.done(true, format("sent to %s in %d part%s.",
                        chan == "WHISPER" and "yourself only (not in a group)" or chan, item.send.parts,
                        item.send.parts == 1 and "" or "s"))
                end
            end
        end
    end
end

-- Cuts text into parts of at most size bytes, never inside a UTF-8 character.
local function parts(text, size)
    local out, pos = {}, 1
    while pos <= #text do
        local stop = math.min(pos + size - 1, #text)
        while stop > pos and stop < #text do
            local nextByte = text:byte(stop + 1)
            if nextByte >= 0x80 and nextByte < 0xC0 then
                stop = stop - 1
            else
                break
            end
        end
        out[#out + 1] = text:sub(pos, stop)
        pos = stop + 1
    end
    return out
end

local function send(text, meta, done)
    text = text:gsub("\t", " ")
    if text == "" then
        text = WIRE.clearText
    end
    -- One index per send, short because it is in every part.
    local index = format("%d%04d", time() % 100000, math.random(0, 9999))
    local head = WIRE.note .. "\t" .. index .. "\t"
    local pieces = parts(text, math.min(WIRE.maxPart, WIRE.maxMessage - #head))
    local s = { parts = #pieces, done = done, chan = (channel()) }
    for _, piece in ipairs(pieces) do
        queue[#queue + 1] = { body = head .. piece, send = s }
    end
    local name = ((meta and meta.name) or ""):gsub("\t", " ")
    local boss = meta and tonumber(meta.encounterID)
    local tail = WIRE.meta .. "\t" .. index .. "\t" .. (boss and tostring(boss) or WIRE.noBoss) .. "\t" .. name
    queue[#queue + 1] = { body = tail:sub(1, WIRE.maxMessage), send = s, last = true }
    if not waiting then
        pump()
    end
end

-- The interface ---------------------------------------------------------------------------------

function MRT.IsAvailable()
    if not Targets.AddonLoaded(WIRE.addon) then
        return false, "Method Raid Tools is not loaded."
    elseif not (C_ChatInfo and C_ChatInfo.SendAddonMessage) then
        return false, "the game's addon messages are missing."
    end
    return true
end

function MRT.CanSend()
    local why = Targets.Blocked(true)
    if why then
        return false, why
    elseif IsInRaid() and not Targets.Rank() then
        return false, "only the raid leader or an assistant can send in a raid (MRT ignores anyone else)."
    end
    return true
end

function MRT.Format(record)
    return MRT.ToMRTText(record.raw), { encounterID = record.encounterID, name = record.name }
end

function MRT.Send(text, meta, done)
    send(text, meta, done)
end

function MRT.Clear(done)
    send(WIRE.clearText, nil, done)
end

function MRT.Current()
    return type(VMRT) == "table" and type(VMRT.Note) == "table" and VMRT.Note.Text1 or nil
end

-- MRT fires this after each part with the note so far; Targets waits for the one that matches.
function MRT.OnReceived(fn)
    if type(GMRT) == "table" and type(GMRT.F) == "table" and GMRT.F.RegisterCallback then
        GMRT.F:RegisterCallback(WIRE.receivedCallback, function(_, text)
            fn(text)
        end, "CowfeeRaidTools")
    end
end

Targets:Register(MRT)
