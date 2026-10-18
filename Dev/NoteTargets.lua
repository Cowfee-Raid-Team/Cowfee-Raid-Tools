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
