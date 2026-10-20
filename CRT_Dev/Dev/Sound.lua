local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev sound <ref> plays any sound reference (kit:RAID_WARNING, lsm:<name>,
-- file:<name>, tts:<text>) and prints what happened; /crt dev sound list prints every choice and your
-- files; /crt dev sound auras prints the aura sounds registered. This file never ships: its .toc line is
-- inside the do-not-package block.

local Dev = {}
CRT.SoundDev = Dev

local function list()
    local Sound = CRT.Sound
    CRT:Print("Sound choices (key, label):")
    for _, c in ipairs(Sound:Choices()) do
        print("  " .. c.key .. "  " .. c.label)
    end
    local loaded = C_AddOns and C_AddOns.IsAddOnLoaded and C_AddOns.IsAddOnLoaded(Sound.MEDIA_ADDON)
    print("  " .. Sound.MEDIA_ADDON .. ": " .. (loaded and "loaded" or "not installed") .. ", voice " .. tostring(Sound:Voice())
        .. ", channel " .. Sound:Channel())
    for _, f in ipairs(Sound:CustomFiles()) do
        print("  your file: " .. f.name .. " (" .. f.source .. ")")
    end
end

-- Handles "dev sound ...". raw is the command as typed, since a sound's name may have capitals.
function Dev:Command(msg, raw)
    if not msg:match("^dev%s+sound") then
        return false
    end
    local ref = (raw or msg):match("^%S+%s+%S+%s*(.-)$") or ""
    if ref == "" or ref:lower() == "list" then
        list()
    elseif ref:lower() == "auras" then
        if CRT.SoundAuras then
            CRT.SoundAuras:PrintStatus()
        else
            CRT:Print("Aura sounds aren't loaded.")
        end
    else
        local handle, info = CRT.Sound:Play(ref)
        CRT:Print(string.format("%s -> %s (%s)", ref, tostring(CRT.Sound.Normalize(ref)),
            handle and ("played: " .. tostring(info)) or ("didn't play: " .. tostring(info))))
    end
    return true
end
