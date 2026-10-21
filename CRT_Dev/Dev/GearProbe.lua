local ADDON, CRT = ...

-- DEVELOPER ONLY. Prints the IDs a season gear check is written with, to paste into the season pack's
-- GearChecks.lua. This file never ships: its .toc line is inside the do-not-package block.
--   /crt dev gear          your equipped items: slot, item ID, enchant, gems and bonus IDs, and the item string
--   /crt dev gear <name>   the same for a player the Gear Checker has seen (a reply or an inspect), by name
-- Each line also says which of the season's checks the item trips. Reads only CRT.Gear; nothing is saved.

local Gear = CRT.Gear
local Probe = {}
CRT.GearProbe = Probe

Probe.TEXT = {
    head = "Gear probe: %s (%d %s). Paste the IDs into the season's GearChecks.lua.",
    none = "Gear probe: nothing known for %s. Refresh the Gear Checker first.",
    line = "  %s: item %s, enchant %s, gems %s, bonus %s%s",
    trips = " | trips: %s",
    raw = "    %s",
}

local function list(t)
    return (t and #t > 0) and table.concat(t, ",") or "-"
end

-- The probe's lines for a set of pieces (no printing, so the tests can read them).
function Probe.Lines(who, pieces)
    if #pieces == 0 then
        return { string.format(Probe.TEXT.none, who) }
    end
    local out = { string.format(Probe.TEXT.head, who, #pieces, #pieces == 1 and "item" or "items") }
    local rules = CRT.GearChecker and CRT.GearChecker:Rules()
    for _, p in ipairs(pieces) do
        local parts = CRT.GearChecker.PartsOf(p)
        local gems = {}
        for g = 1, 4 do
            if parts and parts.gems[g] then
                gems[#gems + 1] = parts.gems[g]
            end
        end
        local trips = {}
        for _, c in ipairs(rules and rules.checks or {}) do
            if c.slots[p.slot] and CRT.GearChecker.CheckTrips(c, p, parts) then
                trips[#trips + 1] = c.key
            end
        end
        local slot = Gear.Slot(p.slot)
        out[#out + 1] = string.format(Probe.TEXT.line, slot and slot.name or tostring(p.slot), tostring(p.id or "?"),
            tostring(parts and parts.enchant or "-"), list(gems), list(parts and parts.bonusIds),
            #trips > 0 and string.format(Probe.TEXT.trips, table.concat(trips, ",")) or "")
        out[#out + 1] = string.format(Probe.TEXT.raw, tostring(p.itemString or "(no item string)"))
    end
    return out
end

-- A remembered player by full or short name, or nil.
local function seen(name)
    local lower = name:lower()
    for full in pairs(Gear.others) do
        if full:lower() == lower or full:lower():match("^([^%-]+)") == lower then
            return full
        end
    end
end

-- Handles "dev gear ...". Returns true when the command was one.
function Probe:Command(msg, raw)
    local rest = msg:match("^dev%s+gear$") and "" or msg:match("^dev%s+gear%s+(.-)$")
    if not rest then
        return false
    end
    local who, pieces
    if rest == "" then
        who, pieces = "you", Gear:MineAll()
    else
        local name = (raw or msg):match("^%S+%s+%S+%s+(.-)%s*$") or rest
        local full = seen(name)
        who, pieces = full or name, full and Gear:OfAll(full) or {}
    end
    for _, line in ipairs(Probe.Lines(who, pieces)) do
        print(line)
    end
    return true
end
