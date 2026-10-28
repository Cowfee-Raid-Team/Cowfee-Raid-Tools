local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev shieldbar (or "on") draws the shield bar from your own absorb, to try it between raids on
-- a target dummy (no boss, no encounter). The first UNIT_ABSORB_AMOUNT_CHANGED for "player" starts one bar, "Shield
-- (test)", 15 s long, through the same code as a real shield bar (Alerts/Absorb.lua, drawn by Alerts/Bars.lua); a new
-- one starts only after the events stopped for its gap. /crt dev shieldbar off stops it and clears the bar. It also
-- stops at /reload and when a real pull starts. Nothing is saved.
--
-- This file never ships: its .toc line and its command in Slash.lua are inside the do-not-package blocks.

local Dev = {}
CRT.ShieldBarDev = Dev

local UNIT = "player"
local LABEL = "Shield (test)"
local LENGTH = 15

function Dev:Command(msg)
    local rest = msg:match("^dev%s+shieldbar%s*$") and "" or msg:match("^dev%s+shieldbar%s+(.-)%s*$")
    if not rest then
        return false
    end
    local Absorb = CRT.AlertAbsorb
    if not Absorb or not Absorb.DevWatch then
        CRT:Print("The shield bar is not loaded.")
    elseif rest == "off" then
        Absorb:DevStop()
        CRT:Print("Shield bar test off.")
    else
        Absorb:DevWatch(UNIT, LABEL, LENGTH)
        CRT:Print("Shield bar test on: put an absorb on yourself and hit a dummy.")
    end
    return true
end
