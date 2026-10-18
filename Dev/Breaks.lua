local ADDON, CRT = ...

-- DEVELOPER ONLY. Test commands for the break timer's other-addon formats (Integrations/Breaks.lua).
-- This file never ships: its .toc line is inside the do-not-package block.
--   /crt dev break send <minutes>   send a break in the ticked formats only: no CRT message, no bar here
--   /crt dev break cancel           send a cancel the same way
--   /crt dev break status           each format, the bridge, the running break and the last one received

local Formats = CRT.BreakFormats
local Break = CRT.BreakTimer
local Dev = {}
CRT.BreaksDev = Dev

local function report(sent, failed)
    if not sent then
        CRT:Print("Break formats: not sent, " .. failed .. ".")
        return
    end
    CRT:Print("Break formats: sent as " .. (#sent > 0 and table.concat(sent, ", ") or "nothing (none ticked)") .. "."
        .. (#failed > 0 and (" Failed: " .. table.concat(failed, ", ") .. ".") or ""))
end

local function status()
    CRT:Print("Break formats:")
    for _, f in ipairs(Formats.FORMATS) do
        local ok, note = Formats.Available(f)
        print(format("  %s: %s, %s%s", f.label, Formats.Enabled(f.key) and "ticked" or "not ticked",
            ok and "can send" or "can't send", note and (" (" .. note .. ")") or ""))
    end
    local s = CRT.db.qol.breakTimer
    print("  bridge: " .. (s.bridge and "on" or "off") .. ", you are the leader: "
        .. (UnitIsGroupLeader("player") and "yes" or "no"))
    local left = Break:Remaining()
    print("  running: " .. (left and (format("%d:%02d left", math.floor(left / 60), left % 60)
        .. (s.from and (" from " .. Ambiguate(s.from, "short")) or "")) or "no"))
    local last = Break.lastReceived
    if last then
        print(format("  last received: %s from %s, %s, %d seconds ago", Formats.Label(last.source),
            Ambiguate(last.sender, "short"), last.seconds > 0 and (last.seconds .. " seconds") or "a cancel",
            time() - last.at))
    else
        print("  last received: nothing since the /reload")
    end
end

-- Handles "dev break ...". Returns true when the command was one.
function Dev:Command(msg)
    local rest = msg:match("^dev%s+break%s*(.-)$")
    if not rest then
        return false
    end
    local verb, arg = rest:match("^(%S*)%s*(.-)$")
    if verb == "send" and tonumber(arg) and tonumber(arg) > 0 then
        local seconds = math.floor(tonumber(arg) * 60 + 0.5)
        report(Formats:SendAll(seconds, seconds))
    elseif verb == "cancel" then
        report(Formats:SendAll(0, 0))
    elseif verb == "status" or verb == "" then
        status()
    else
        CRT:Print("Use /crt dev break send <minutes>, cancel or status.")
    end
    return true
end
