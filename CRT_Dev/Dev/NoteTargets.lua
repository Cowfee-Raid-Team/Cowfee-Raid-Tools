local ADDON, CRT = ...

-- DEVELOPER ONLY. Test commands for the note targets (Integrations/NoteTargets.lua), on the same code
-- Share Notes' Send to dropdown uses. This file never ships: its .toc line is inside the
-- do-not-package block.
--   /crt dev <target> send [note]     send that note (by name or number), or the note in use
--   /crt dev <target> clear           clear the group's note in that addon
--   /crt dev <target> status          loaded, your rank, chat lockdown, and the note it holds now
--   /crt dev <target> preview [note]  the note as that addon's text, printed, not sent
--   /crt dev <target> samples         sample CRT lines and what they become, for targets that have them
--   /crt dev all send [note]          send to every target that is loaded
--   /crt dev nsrt selftest            NSRT.Encode then NSRT.Decode round trips, and Decode's rejections
-- <target> is a target's key: nsrt or mrt.

local Targets = CRT.NoteTargets
local Dev = {}
CRT.NoteTargetsDev = Dev

local function say(msg)
    CRT:Print(msg)
end

-- Picks a CRT note: by its number, by its name (any case: the slash command is lowercased), or the
-- note in use when there is no word.
local function findNote(word)
    local Notes = CRT.Notes
    if not word or word == "" then
        local id, record = Notes:Active()
        if not id then
            say("No note is in use. Pick one on the Raid Notes page, or name one.")
        end
        return id, record
    end
    local num = tonumber(word)
    if num and Notes:Get(num) then
        return num, Notes:Get(num)
    end
    local matches = {}
    for _, entry in ipairs(Notes:List()) do
        if (entry.record.name or ""):lower() == word:lower() then
            matches[#matches + 1] = entry
        end
    end
    if #matches == 1 then
        return matches[1].id, matches[1].record
    end
    say(#matches == 0 and ("No note is named '" .. word .. "'. Your notes:")
        or ("More than one note is named '" .. word .. "'. Use its number:"))
    for _, entry in ipairs(#matches > 0 and matches or Notes:List()) do
        print(format("  %d  %s%s", entry.id, entry.record.name or "?",
            entry.record.difficulty and (" (" .. entry.record.difficulty .. ")") or ""))
    end
    return nil
end

local function status(target)
    local available, why = target.IsAvailable()
    say(target.label .. ": available: " .. (available and "yes" or ("no, " .. why)))
    local group = IsInRaid() and "raid" or (IsInGroup() and "party" or "not in a group")
    print("  group: " .. group .. ", you are: " .. (Targets.Rank() or "neither leader nor assistant"))
    print("  chat lockdown: " .. (Targets.ChatLocked() and "yes" or "no") .. ", in combat: "
        .. (InCombatLockdown() and "yes" or "no"))
    if available then
        local ok, reason = target.CanSend()
        print("  can send: " .. (ok and "yes" or ("no, " .. reason)))
        if target.Current then
            print("  its note now: " .. Targets.Preview(target.Current()))
        end
    end
end

local function preview(target, word)
    local id, record = findNote(word)
    if not id then
        return
    end
    local text, meta = target.Format(record)
    say(format("%s: '%s' as %s text (boss %s), not sent:", target.label, record.name or "?", target.label,
        tostring(meta and meta.encounterID or "-")))
    for line in (text .. "\n"):gmatch("(.-)\n") do
        print("  " .. line)
    end
end

local function samples(target)
    if not target.Samples then
        say(target.label .. " has no samples.")
        return
    end
    say(target.label .. " samples (CRT line, then what it becomes):")
    for _, sample in ipairs(target.Samples) do
        local text = target.Format({ raw = sample[2] })
        print("  " .. sample[1] .. ": " .. sample[2])
        print("    -> " .. (text ~= "" and text or "(dropped)"))
    end
end

-- Encodes any table the way NSRT's wire does, for payloads NSRT.Encode would never make.
local function encodeRaw(payload)
    local cbor = C_EncodingUtil.SerializeCBOR(payload)
    local packed = C_EncodingUtil.CompressString(cbor, Enum.CompressionMethod.Deflate, Enum.CompressionLevel.OptimizeForSize)
    return C_EncodingUtil.EncodeBase64(packed, Enum.Base64Variant.StandardUrlSafe)
end

-- NSRT.Decode against what it must accept and reject. Prints each case and the total.
local function selftest()
    local NSRT = CRT.NSRT
    local passed, total = 0, 0
    local function case(name, ok)
        total = total + 1
        if ok then
            passed = passed + 1
        end
        print(string.format("  %s %s", ok and "|cff60ff60pass|r" or "|cffff6060FAIL|r", name))
    end
    CRT:Print("NSRT Decode self-test:")
    local good = NSRT.Encode("CRT_SELFTEST", "text", 42, true)
    local back = NSRT.Decode(good)
    case("round trip keeps the event", back and back.event == "CRT_SELFTEST")
    case("round trip keeps the arguments", back and back.args.n == 4 and back.args[2] == "text" and back.args[3] == 42
        and back.args[4] == true and type(back.args[1]) == "string")
    case("a character outside URL-safe Base64 is rejected", NSRT.Decode(good:sub(1, 4) .. "*" .. good:sub(6)) == nil)
    case("a truncated message is rejected", NSRT.Decode(good:sub(1, math.floor(#good / 2))) == nil)
    case("an empty string is rejected", NSRT.Decode("") == nil)
    case("not a string is rejected", NSRT.Decode(nil) == nil and NSRT.Decode(5) == nil)
    case("args.n = 0 is rejected", NSRT.Decode(encodeRaw({ event = "X", args = { n = 0 } })) == nil)
    case("args.n = 17 is rejected", NSRT.Decode(encodeRaw({ event = "X", args = { n = 17 } })) == nil)
    case("args.n = 1.5 is rejected", NSRT.Decode(encodeRaw({ event = "X", args = { n = 1.5 } })) == nil)
    case("args.n = 16 is accepted", NSRT.Decode(encodeRaw({ event = "X", args = { n = 16 } })) ~= nil)
    case("args.n = 1 is accepted", NSRT.Decode(encodeRaw({ event = "X", args = { n = 1 } })) ~= nil)
    case("no event is rejected", NSRT.Decode(encodeRaw({ args = { n = 1 } })) == nil)
    case("no args is rejected", NSRT.Decode(encodeRaw({ event = "X" })) == nil)
    case("a value that isn't a table is rejected", NSRT.Decode(encodeRaw("just text")) == nil)
    CRT:Print(string.format("NSRT Decode self-test: %d of %d passed.", passed, total))
end

local function run(target, verb, arg)
    if verb == "send" then
        local id, record = findNote(arg)
        if id then
            Targets:Share(target.key, record)
        end
    elseif verb == "clear" then
        Targets:Clear(target.key)
    elseif verb == "status" or verb == "" then
        status(target)
    elseif verb == "preview" then
        preview(target, arg)
    elseif verb == "selftest" and target.key == "nsrt" then
        local ok, err = pcall(selftest)
        if not ok then
            CRT:Print("NSRT Decode self-test stopped: " .. tostring(err))
        end
    elseif verb == "samples" then
        samples(target)
    else
        say("Use /crt dev " .. target.key .. " send [note], clear, status, preview [note] or samples.")
    end
end

-- Handles "dev <target> ..." and "dev all send ...". Returns true when the command was one of these.
function Dev:Command(msg)
    local key, rest = msg:match("^dev%s+(%a+)%s*(.-)$")
    if not key then
        return false
    end
    local verb, arg = rest:match("^(%S*)%s*(.-)$")
    if key == "all" then
        if verb ~= "send" then
            say("Use /crt dev all send [note].")
            return true
        end
        local id, record = findNote(arg)
        if not id then
            return true
        end
        for _, target in ipairs(Targets:List()) do
            local available, why = target.IsAvailable()
            if available then
                Targets:Share(target.key, record)
            else
                say(target.label .. ": skipped, " .. why)
            end
        end
        return true
    end
    local target = Targets:Get(key)
    if not target then
        return false
    end
    run(target, verb, arg)
    return true
end
