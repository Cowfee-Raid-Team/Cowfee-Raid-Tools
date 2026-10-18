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

local NSRT = {
    key = "nsrt",
    label = "Northern Sky",
    help = "Northern Sky (NSRT) puts the note in NSRT's shared reminder note: its timed lines become NSRT reminders and the rest shows in NSRT's note frame, for every raider running NSRT. CRT's own raid note is not changed. In a raid you must be the leader or an assistant; in a party, the leader. It needs a group: NSRT takes a shared note only from a group leader or assistant, so it can't be sent to yourself.",
}
CRT.NSRT = NSRT

local function aceComm()
    return LibStub and LibStub("AceComm-3.0", true)
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

local pairsOf = Targets.Fields

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

local function encode(text)
    local payload = { event = WIRE.event, args = { n = WIRE.argCount, senderUnit(), text, nil, WIRE.manual } }
    local cbor = C_EncodingUtil.SerializeCBOR(payload)
    local packed = C_EncodingUtil.CompressString(cbor, Enum.CompressionMethod.Deflate,
        Enum.CompressionLevel.OptimizeForSize)
    return C_EncodingUtil.EncodeBase64(packed, Enum.Base64Variant.StandardUrlSafe)
end

local function send(text, done)
    local ok, message = pcall(encode, text)
    if not ok or type(message) ~= "string" then
        done(false, "encoding failed (" .. tostring(message) .. ").")
        return
    end
    local chan = IsInRaid() and "RAID" or "PARTY"
    local reported = false
    aceComm().SendCommMessage(NSRT, WIRE.prefix, message, chan, nil, "NORMAL", function(_, sent, total)
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
