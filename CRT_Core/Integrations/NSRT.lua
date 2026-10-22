local ADDON, CRT = ...

-- Note target: Northern Sky Raid Tools' shared reminder note (see Integrations/NoteTargets.lua for the
-- interface). Every raider running NSRT sees the note in their NSRT note frames.
--
-- NSRT has no public send call, so this speaks its addon-message format. Nothing of NSRT's is loaded
-- or changed: AceComm-3.0 (with ChatThrottleLib, which splits and paces long messages) is borrowed
-- through LibStub from NSRT's own copy, the same way CRT reads LibSharedMedia, since without NSRT
-- there is nobody to send to. It is looked up at send time, so no OptionalDeps is needed. Reading back
-- uses NSRT's public NSAPI (GetReminderString, RegisterCallback).

local Targets = CRT.NoteTargets

-- NSRT's wire format, VERSION-SENSITIVE. Worked out against NorthernSkyRaidTools 12.1.31. If an NSRT
-- update stops notes arriving, this block is the one place to fix.
--   message: AceComm under PREFIX, to RAID (PARTY when not in a raid); WHISPER_PREFIX carries NSRT's
--            "whispers", sent to RAID with the target as the payload's second argument
--   payload: { event = EVENT, args = { n = ARG_COUNT, <sender unit>, <note text>, <assignments>, <manual> } }
--            CBOR, then Deflate (optimised for size), then URL-safe Base64
--   <sender unit> is "raid<N>" in a raid, else your name; NSRT checks it is the leader or an assistant
--   <manual> true lets an assistant send and skips NSRT's Heroic/Mythic check; <assignments> stays nil
--   a single space as the note text clears it
--   a receiver drops a payload with any character outside URL-safe Base64, or args.n outside 1 to 16
local WIRE = {
    addon = "NorthernSkyRaidTools",
    prefix = "NSI_MSG",
    whisperPrefix = "NSI_WHISPER",
    validText = "[^A-Za-z0-9_%-=]",
    maxArgs = 16,
    event = "NSI_REM_SHARE",
    manual = true,
    clearText = " ",
    changedCallback = "NSRT_REMINDER_CHANGED",
}

local NSRT = {
    key = "nsrt",
    label = "Northern Sky",
    help = "Sends the note to everyone running Northern Sky as their shared note: timed lines become reminders, the rest shows in their note frame. Only a group leader or assistant can send it.",
}
CRT.NSRT = NSRT

local function aceComm()
    return LibStub and LibStub("AceComm-3.0", true)
end

-- CRT note text into NSRT's ----------------------------------------------------------------------

-- Fields only CRT reads. NSRT has its own words for some of these ideas (TTS:, countdown:, sound:,
-- glowunit:) but not the same values, so they are left out rather than guessed.
local CRT_ONLY = { show = true, tts = true, ttsat = true, count = true, glow = true, warn = true, linger = true,
    icon = true, sound = true }

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

-- A CRT tag in NSRT's words: "all" is "everyone", a class is its class ID, and names, roles, melee and ranged
-- are the same in both. A class is one only when surely named (Notes/Parse.lua's class words: "Demon Hunter" as
-- one, "DEMONHUNTER", "Priest"), so a player called "Deathknight" stays a name.
local function nsrtTags(value)
    local out = {}
    for _, item in ipairs(CRT.NoteParser.ClassRuns(value, "%S+")) do
        local id = item.class and item.sure and classID(item.class)
        out[#out + 1] = id or (item.text:lower() == "all" and "everyone") or item.text
    end
    return table.concat(out, " ")
end

-- An assignment line ("Orb Soak 1: DEMONHUNTER Warlock") with each surely named class written as NSRT notes
-- name it, the English name with its spaces ("Demon Hunter"); a single word in mixed or lower case ("Deathknight",
-- "the hunter kites") and everything else as written. Any other line as it is.
local function assignmentLine(line)
    local Parser = CRT.NoteParser
    local label, rest = line:match("^([^:]+:)(.*)$")
    if not (label and Parser.LooksLikeLabel(label:sub(1, -2))) then
        return line
    end
    local out, pos = {}, 1
    for _, item in ipairs(Parser.ClassRuns(rest, "[^%s,]+")) do
        out[#out + 1] = rest:sub(pos, item.start - 1)
        out[#out + 1] = (item.class and item.sure) and Parser.ClassName(item.class) or item.text
        pos = item.stop
    end
    out[#out + 1] = rest:sub(pos)
    return label .. table.concat(out)
end

local pairsOf = Targets.Fields

local function timedLine(line)
    local out = {}
    for _, f in ipairs(pairsOf(line)) do
        local k = f.key:lower()
        if k == "tag" then
            out[#out + 1] = "tag:" .. nsrtTags(f.value) .. ";"
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
-- frame with the same {star} and {rt1} raid icons; an assignment line's classes are written by name.
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
            out[#out + 1] = assignmentLine(line)
        end
    end
    while #out > 0 and out[#out] == "" do
        out[#out] = nil
    end
    return table.concat(out, "\n")
end

-- The interface ---------------------------------------------------------------------------------

function NSRT.IsAvailable()
    if not Targets.AddonLoaded(WIRE.addon) then
        return false, "Northern Sky Raid Tools is not loaded."
    elseif not aceComm() then
        return false, "AceComm-3.0 was not found (it comes with NSRT)."
    elseif not (C_EncodingUtil and C_EncodingUtil.SerializeCBOR and C_EncodingUtil.CompressString
        and C_EncodingUtil.EncodeBase64) then
        return false, "the game's encoding functions are missing."
    end
    return true
end

function NSRT.CanSend()
    -- No solo send: NSRT only takes a shared note from a group's leader or assistant.
    local why = Targets.Blocked()
    if why then
        return false, why
    elseif not Targets.Rank() then
        return false, IsInRaid() and "only the raid leader or an assistant can send." or "only the party leader can send."
    end
    return true
end

function NSRT.Format(record)
    return NSRT.ToNSRTText(record.raw), { encounterID = record.encounterID, name = record.name }
end

local function senderUnit()
    local index = IsInRaid() and UnitInRaid("player")
    if index then
        return "raid" .. index
    end
    return UnitName("player")
end

-- NSRT's transport, shared by the note target and the break timer (Integrations/Breaks.lua) ----------

-- An NSRT message: the event and its arguments, with your own unit put first, encoded for the wire.
function NSRT.Encode(event, ...)
    local payload = { event = event, args = { n = select("#", ...) + 1, senderUnit(), ... } }
    local cbor = C_EncodingUtil.SerializeCBOR(payload)
    local packed = C_EncodingUtil.CompressString(cbor, Enum.CompressionMethod.Deflate,
        Enum.CompressionLevel.OptimizeForSize)
    return C_EncodingUtil.EncodeBase64(packed, Enum.Base64Variant.StandardUrlSafe)
end

-- Each step unwraps one layer of NSRT's wire format; any failure means "not an NSRT message".
local UNWRAP = {
    function(s) return C_EncodingUtil.DecodeBase64(s, Enum.Base64Variant.StandardUrlSafe) end,
    function(s) return C_EncodingUtil.DecompressString(s, Enum.CompressionMethod.Deflate) end,
    function(s) return C_EncodingUtil.DeserializeCBOR(s) end,
}

-- True when a decoded value has the shape NSRT sends: an event name and a counted argument list.
local function isMessage(value)
    if type(value) ~= "table" then return false end
    local event, args = value.event, value.args
    if type(event) ~= "string" or type(args) ~= "table" then return false end
    local count = args.n
    return type(count) == "number" and count % 1 == 0 and count >= 1 and count <= WIRE.maxArgs
end

-- A received NSRT message back into { event, args }, or nil if it isn't a well-formed one.
function NSRT.Decode(text)
    if type(text) ~= "string" or text:find(WIRE.validText) then
        return nil
    end
    local value = text
    for _, step in ipairs(UNWRAP) do
        local ok, out = pcall(step, value)
        if not ok or out == nil then
            return nil
        end
        value = out
    end
    return isMessage(value) and value or nil
end

-- Sends an encoded message to the group (or, whisper = true, under NSRT's whisper prefix). done(sent,
-- total) is called as AceComm sends it, so the caller can tell when the last of it is out.
function NSRT.SendRaw(message, whisper, done)
    local chan = IsInRaid() and "RAID" or "PARTY"
    aceComm().SendCommMessage(NSRT, whisper and WIRE.whisperPrefix or WIRE.prefix, message, chan, nil, "NORMAL",
        done and function(_, sent, total)
            done(sent, total, chan)
        end)
end

-- Calls fn(payload, sender) for every well-formed NSRT message ("whisper" ones too, with whisper true),
-- through NSRT's own AceComm. Returns false when NSRT isn't loaded.
local listener = {}
function NSRT.Listen(fn)
    local comm = Targets.AddonLoaded(WIRE.addon) and aceComm()
    if not comm then
        return false
    end
    comm.RegisterComm(listener, WIRE.prefix, function(_, text, _, sender)
        local payload = NSRT.Decode(text)
        if payload then
            fn(payload, sender, false)
        end
    end)
    comm.RegisterComm(listener, WIRE.whisperPrefix, function(_, text, _, sender)
        local payload = NSRT.Decode(text)
        if payload then
            fn(payload, sender, true)
        end
    end)
    return true
end

local function send(text, done)
    local ok, message = pcall(NSRT.Encode, WIRE.event, text, nil, WIRE.manual)
    if not ok or type(message) ~= "string" then
        done(false, "encoding failed (" .. tostring(message) .. ").")
        return
    end
    local reported = false
    NSRT.SendRaw(message, false, function(sent, total, chan)
        if sent >= total and not reported then
            reported = true
            done(true, format("sent to %s (%d characters of text, %d on the wire).", chan, #text, total))
        end
    end)
end

function NSRT.Send(text, meta, done)
    send(text, done)
end

function NSRT.Clear(done)
    send(WIRE.clearText, done)
end

function NSRT.Current()
    if not (Targets.AddonLoaded(WIRE.addon) and NSAPI and NSAPI.GetReminderString) then
        return nil
    end
    local ok, _, shared = pcall(NSAPI.GetReminderString, NSAPI)
    return ok and shared or nil
end

-- NSRT fires its change callback with the personal and the shared note, shared last; whether the event
-- name and an owner come first depends on CallbackHandler, so the last argument is read.
function NSRT.OnReceived(fn)
    if NSAPI and NSAPI.RegisterCallback then
        NSAPI.RegisterCallback(NSRT, WIRE.changedCallback, function(...)
            fn((select(select("#", ...), ...)))
        end)
    end
end

Targets:Register(NSRT)
