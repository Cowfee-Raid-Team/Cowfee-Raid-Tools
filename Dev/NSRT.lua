local ADDON, CRT = ...

-- DEVELOPER ONLY, a test path. /crt dev nsrt sends one of CRT's raid notes into Northern Sky Raid
-- Tools' shared reminder note, so every raider running NSRT sees it in their NSRT note frames. This
-- file never ships: its .toc line is inside the do-not-package block.
--   /crt dev nsrt send [note]   send that note (by name or number), or the note in use
--   /crt dev nsrt clear         clear the shared NSRT note for the group
--   /crt dev nsrt status        NSRT loaded, your rank, chat lockdown, and the NSRT note you have now
--
-- NSRT has no public send call, so this speaks its addon-message format. Nothing of NSRT's is loaded
-- or changed: AceComm-3.0 (with ChatThrottleLib, which splits and paces long messages) is borrowed
-- through LibStub from NSRT's own copy, the same way CRT reads LibSharedMedia, since without NSRT
-- there is nobody to send to. It is only looked up at send time, so no OptionalDeps is needed.
-- Reading back uses NSRT's public NSAPI (GetReminderString, RegisterCallback).

local NSRT = {}
CRT.NSRT = NSRT

-- NSRT's wire format, VERSION-SENSITIVE. Worked out against NorthernSkyRaidTools 12.1.31. If an NSRT
-- update stops notes arriving, this block is the one place to fix.
--   message: AceComm under PREFIX, to RAID (PARTY when not in a raid)
--   payload: { event = EVENT, args = { n = ARG_COUNT, <sender unit>, <note text>, <assignments>, <manual> } }
--            CBOR, then Deflate (optimised for size), then URL-safe Base64
--   <sender unit> is "raid<N>" in a raid, else your name; NSRT checks it is the leader or an assistant
--   <manual> true lets an assistant send and skips NSRT's Heroic/Mythic check; <assignments> stays nil
--   a single space as the note text clears it
local WIRE = {
    addon = "NorthernSkyRaidTools",
    prefix = "NSI_MSG",
    event = "NSI_REM_SHARE",
    argCount = 4,
    manual = true,
    clearText = " ",
    changedCallback = "NSRT_REMINDER_CHANGED",
}

local CONFIRM_WINDOW = 60 -- seconds after a send that NSRT's change callback is reported as its arrival

local pending -- { text, at } of the last send, until NSRT reports a change

local function say(msg)
    CRT:Print("NSRT: " .. msg)
end

local function nsrtLoaded()
    return C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded(WIRE.addon) and true or false
end

local function aceComm()
    return LibStub and LibStub("AceComm-3.0", true)
end

local function rank()
    if UnitIsGroupLeader("player") then
        return "leader"
    elseif IsInRaid() and UnitIsGroupAssistant("player") then
        return "assistant"
    end
    return nil
end

local function chatLocked()
    return C_ChatInfo and C_ChatInfo.InChatMessagingLockdown and C_ChatInfo.InChatMessagingLockdown() and true
        or false
end

-- CRT note text into NSRT's ----------------------------------------------------------------------

-- Fields only CRT reads. NSRT has its own words for some of these ideas (TTS:, countdown:, sound:,
-- glowunit:) but not the same values, so they are left out rather than guessed.
local CRT_ONLY = { show = true, tts = true, count = true, glow = true, warn = true, linger = true, icon = true,
    sound = true }

local classIDs -- "DEATHKNIGHT" -> 6, built on first use

local function classID(word)
    if not classIDs then
        classIDs = {}
        for id = 1, GetNumClasses() do
            local _, file = GetClassInfo(id)
            if file then
                classIDs[file] = id
            end
        end
    end
    return classIDs[word:upper()]
end

-- A CRT tag word in NSRT's words: "all" is "everyone", a class file name is its class ID, and names,
-- roles, melee and ranged are the same in both.
local function nsrtTag(word)
    if word:lower() == "all" then
        return "everyone"
    end
    return classID(word) or word
end

-- "key:value;key:value;" into an ordered list of { key, value }, the key as written.
local function pairsOf(line)
    local out = {}
    for part in line:gmatch("[^;]+") do
        local key, value = part:match("^%s*([^:]-)%s*:(.*)$")
        if key and key ~= "" then
            out[#out + 1] = { key = key, value = strtrim(value) }
        end
    end
    return out
end

local function timedLine(line)
    local out = {}
    for _, f in ipairs(pairsOf(line)) do
        local k = f.key:lower()
        if k == "tag" then
            local tags = {}
            for word in f.value:gmatch("%S+") do
                tags[#tags + 1] = nsrtTag(word)
            end
            out[#out + 1] = "tag:" .. table.concat(tags, " ") .. ";"
        elseif not CRT_ONLY[k] then
            out[#out + 1] = f.key .. ":" .. f.value .. ";"
        end
    end
    return table.concat(out)
end

-- NSRT needs a name whenever there is a header, so a header without one (or without an ID) is dropped.
local function headerLine(line)
    local f = {}
    for _, p in ipairs(pairsOf(line)) do
        f[p.key:lower()] = p.value
    end
    local id, name = tonumber(f.encounterid), f.name
    if not id or not name or name == "" then
        return nil
    end
    local out = "EncounterID:" .. id .. ";Name:" .. name .. ";"
    if f.difficulty and f.difficulty ~= "" then
        out = out .. "Difficulty:" .. f.difficulty .. ";"
    end
    return out
end

-- The one place a CRT note becomes an NSRT note. Header and timed lines are rewritten, the invite list
-- is dropped (NSRT has none), and every other line is free text, which NSRT shows in its extra note
-- frame with the same {star} and {rt1} raid icons.
function NSRT.ToNSRTText(raw)
    local out = {}
    for rawLine in ((raw or "") .. "\n"):gmatch("(.-)\r?\n") do
        local line = strtrim(rawLine)
        local lower = line:lower()
        if lower:find("^encounterid:") then
            out[#out + 1] = headerLine(line)
        elseif lower:find("^time:") then
            out[#out + 1] = timedLine(line)
        elseif not lower:find("^invitelist:") then
            out[#out + 1] = line
        end
    end
    while #out > 0 and out[#out] == "" do
        out[#out] = nil
    end
    return table.concat(out, "\n")
end

-- Sending ---------------------------------------------------------------------------------------

-- Why a send can't go now, or nil.
local function blocked()
    if not nsrtLoaded() then
        return "Northern Sky Raid Tools is not loaded."
    elseif not aceComm() then
        return "AceComm-3.0 was not found (it comes with NSRT)."
    elseif not (C_EncodingUtil and C_EncodingUtil.SerializeCBOR and C_EncodingUtil.CompressString
        and C_EncodingUtil.EncodeBase64) then
        return "the game's encoding functions are missing."
    elseif InCombatLockdown() then
        return "you are in combat."
    elseif not IsInGroup() then
        return "you are not in a group."
    elseif not rank() then
        return IsInRaid() and "only the raid leader or an assistant can send." or "only the party leader can send."
    elseif chatLocked() then
        return "addon messages are locked down right now (an encounter or a Mythic+ run)."
    end
    return nil
end

local function senderUnit()
    local index = IsInRaid() and UnitInRaid("player")
    if index then
        return "raid" .. index
    end
    return UnitName("player")
end

local function encode(text)
    local payload = { event = WIRE.event, args = { n = WIRE.argCount, senderUnit(), text, nil, WIRE.manual } }
    local cbor = C_EncodingUtil.SerializeCBOR(payload)
    local packed = C_EncodingUtil.CompressString(cbor, Enum.CompressionMethod.Deflate,
        Enum.CompressionLevel.OptimizeForSize)
    return C_EncodingUtil.EncodeBase64(packed, Enum.Base64Variant.StandardUrlSafe)
end

-- Sends text as the group's shared NSRT note. Returns true if it went out.
local function send(text, label)
    local why = blocked()
    if why then
        say("can't send: " .. why)
        return false
    end
    local ok, message = pcall(encode, text)
    if not ok or type(message) ~= "string" then
        say("can't send: encoding failed (" .. tostring(message) .. ").")
        return false
    end
    local chan = IsInRaid() and "RAID" or "PARTY"
    pending = { text = text, at = GetTime() }
    local reported = false
    aceComm().SendCommMessage(NSRT, WIRE.prefix, message, chan, nil, "NORMAL", function(_, sent, total)
        if sent >= total and not reported then
            reported = true
            say(format("%s sent to %s (%d characters of text, %d on the wire).", label, chan, #text, total))
        end
    end)
    return true
end

function NSRT:SendNoteToNSRT(text, label)
    if type(text) ~= "string" or strtrim(text) == "" then
        say("can't send: the note is empty.")
        return false
    end
    return send(text, label or "Note")
end

function NSRT:ClearNSRTNote()
    return send(WIRE.clearText, "Clear")
end

-- Picks a CRT note: by its number, by its name (any case), or the note in use when there is no word.
local function findNote(word)
    local Notes = CRT.Notes
    if not word or word == "" then
        local id, record = Notes:Active()
        if not id then
            say("no note is in use. Pick one on the Raid Notes page, or name one.")
        end
        return id, record
    end
    local num = tonumber(word)
    if num and Notes:Get(num) then
        return num, Notes:Get(num)
    end
    local matches = {}
    for _, entry in ipairs(Notes:List()) do
        if (entry.record.name or ""):lower() == word then
            matches[#matches + 1] = entry
        end
    end
    if #matches == 1 then
        return matches[1].id, matches[1].record
    end
    say(#matches == 0 and ("no note is named '" .. word .. "'. Your notes:")
        or ("more than one note is named '" .. word .. "'. Use its number:"))
    for _, entry in ipairs(#matches > 0 and matches or Notes:List()) do
        print(format("  %d  %s%s", entry.id, entry.record.name or "?",
            entry.record.difficulty and (" (" .. entry.record.difficulty .. ")") or ""))
    end
    return nil
end

function NSRT:SendCRTNote(word)
    local id, record = findNote(word)
    if not id then
        return
    end
    local text = self.ToNSRTText(record.raw)
    self:SendNoteToNSRT(text, "'" .. (record.name or ("Note " .. id)) .. "'")
end

-- Reading back ----------------------------------------------------------------------------------

local function sharedNote()
    if not (nsrtLoaded() and NSAPI and NSAPI.GetReminderString) then
        return nil
    end
    local ok, _, shared = pcall(NSAPI.GetReminderString, NSAPI)
    return ok and shared or nil
end

local function preview(text)
    if type(text) ~= "string" or strtrim(text) == "" then
        return "(empty)"
    end
    local lines, count = {}, 0
    for line in (text .. "\n"):gmatch("(.-)\n") do
        count = count + 1
        if count <= 3 then
            lines[#lines + 1] = "    " .. line
        end
    end
    local more = count > 3 and ("\n    ... " .. (count - 3) .. " more lines") or ""
    return format("%d characters, %d lines:\n%s%s", #text, count, table.concat(lines, "\n"), more)
end

function NSRT:Status()
    say("loaded: " .. (nsrtLoaded() and "yes" or "no") .. ", AceComm: " .. (aceComm() and "yes" or "no"))
    local group = IsInRaid() and "raid" or (IsInGroup() and "party" or "not in a group")
    print("  group: " .. group .. ", you are: " .. (rank() or "neither leader nor assistant"))
    print("  chat lockdown: " .. (chatLocked() and "yes" or "no") .. ", in combat: "
        .. (InCombatLockdown() and "yes" or "no"))
    local why = blocked()
    print("  can send: " .. (why and ("no, " .. why) or "yes"))
    if nsrtLoaded() then
        print("  NSRT shared note: " .. preview(sharedNote()))
    end
end

-- NSRT's own change callback, so a send can be seen landing on this client. NSRT fires it with the
-- personal and the shared note, shared last; whether the event name and an owner come first depends
-- on CallbackHandler, so the last argument is read.
local function onChanged(...)
    local shared = select(select("#", ...), ...)
    if not pending then
        return
    end
    local sent = pending
    pending = nil
    if GetTime() - sent.at > CONFIRM_WINDOW then
        return
    end
    if sent.text == WIRE.clearText then
        say("NSRT reports its shared note changed; it is now " .. preview(shared))
    elseif shared == sent.text then
        say("arrived: NSRT's shared note is now exactly the text sent.")
    else
        say("NSRT's shared note changed, but not to the text sent. It is now " .. preview(shared))
    end
end

local registered = false
local function register()
    if registered or not (nsrtLoaded() and NSAPI and NSAPI.RegisterCallback) then
        return
    end
    local ok = pcall(NSAPI.RegisterCallback, NSRT, WIRE.changedCallback, onChanged)
    registered = ok
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", register)

function NSRT:Command(rest)
    register()
    local verb, arg = (rest or ""):match("^(%S*)%s*(.-)$")
    if verb == "send" then
        self:SendCRTNote(arg)
    elseif verb == "clear" then
        self:ClearNSRTNote()
    elseif verb == "status" or verb == "" then
        self:Status()
    else
        say("use /crt dev nsrt send [note], clear or status.")
    end
end
