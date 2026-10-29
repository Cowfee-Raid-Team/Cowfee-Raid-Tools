local ADDON, CRT = ...

-- DEVELOPER ONLY. Checks a boss's interrupts block (its season-pack file) against a real pull, so a hotfix that
-- moves the adds' first casts can be read off one wipe and written into the block. /crt dev kicks on logs every
-- armed run of the Interrupts module (a matching pull, or Test on trash): each counted wave anchor, and each
-- nameplate's first cast with its offset from the anchor it was numbered from and the number it got:
--   +37.7 nameplate4 anchor+4.50 -> 1      numbered
--   +38.2 nameplate6 anchor+5.00 -> ignored  off the lattice (or outside the wave)
--   +40.1 nameplate9 anchor+none -> ignored  no anchor for it
--   +39.0 nameplate2 not an add            a player, a boss, or a secret answer
--   +33.2 anchor wave 1                    a counted anchor
--   +33.2 boss2 cast 5                     every cast start of the anchor unit, with its count
-- An untimed setup (numbers by raid marker) logs each cast of a candidate plate and the number its group moved to:
--   +12.0 nameplate4 Skull add -> 2        numbered
--   +12.4 nameplate6 no group's marker     no marker, a secret one, or one no group has
-- And every nameplate cast start, in both kinds, logs what the game let the addon read of it (Alex's first pull
-- answers whether raid markers and the cast can be read in a raid fight):
--   +12.0 nameplate4 read: marker 8, cast Wail of Terror, cast spell 1234, event spell 1234
--   +12.0 (secret token) read: marker secret, cast secret, cast spell secret, event spell secret
-- Each part is the value, "secret", "none" (nothing came back) or "error" (the call raised).
-- Seconds are from the pull (from the start of Test on trash in test mode). /crt dev kicks show prints the count and
-- opens the log to copy; /crt dev kicks off stops it, the log stays. Saved in CRTDB.dev.kickProbe: on, and last =
-- { encounterID, mode, started (time()), lines }, the last run only. Only the moment a cast started is read; the
-- cast's own values are only checked for secrets and logged when readable, never compared.
-- Game calls (warcraft.wiki.gg, read 2026-10-29): GetRaidTargetIndex(unit) (SecretReturns), UnitCastingInfo(unit) ->
-- name, ..., 9th castingSpellID (SecretWhenUnitSpellCastRestricted), UNIT_SPELLCAST_START (unitTarget, castGUID,
-- spellID), issecretvalue.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.KickProbe = Probe

Probe.MAX_LINES = 2000

local startedAt = 0

local function store()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.kickProbe = CRT.db.dev.kickProbe or { on = false }
    return CRT.db.dev.kickProbe
end

local function add(line)
    local s = store()
    local last = s.on and s.last
    if not last then
        return
    end
    if #last.lines >= Probe.MAX_LINES then
        last.dropped = (last.dropped or 0) + 1
        return
    end
    last.lines[#last.lines + 1] = line
end

local function stamp(t)
    return string.format("+%.1f", t - startedAt)
end

-- One nameplate's first cast: at is the anchor it was numbered from (nil when none), n its number, why set when it
-- was no candidate. group is the group's label for an untimed setup's cast.
function Probe.CastLine(seconds, unit, at, castTime, n, why, group)
    if why then
        return string.format("+%.1f %s %s", seconds, unit, why)
    end
    if group then
        return string.format("+%.1f %s %s -> %s", seconds, unit, group, n and tostring(n) or "none")
    end
    local offset = at and string.format("anchor+%.2f", castTime - at) or "anchor+none"
    return string.format("+%.1f %s %s -> %s", seconds, unit, offset, n and tostring(n) or "ignored")
end

local function isSecret(v)
    return issecretvalue ~= nil and issecretvalue(v) == true
end

-- One value as the log shows it: itself, "secret" or "none".
local function shown(v)
    if isSecret(v) then
        return "secret"
    end
    if v == nil or v == "" then
        return "none"
    end
    return tostring(v)
end

-- What could be read of a cast start: the unit's raid marker, the cast's name and spell (UnitCastingInfo), and the
-- event's spell ID. Nil for a readable token that isn't a nameplate's (the boss units, the group).
function Probe.ReadLine(seconds, unit, spellID)
    local token
    if isSecret(unit) then
        token = "(secret token)"
    elseif type(unit) == "string" and unit:match("^nameplate%d+$") then
        token = unit
    else
        return nil
    end
    local marker = "error"
    local ok, m = pcall(GetRaidTargetIndex, unit)
    if ok then
        marker = shown(m)
    end
    local cast, castSpell = "error", "error"
    local ok2, name, _, _, _, _, _, _, _, castID = pcall(UnitCastingInfo, unit)
    if ok2 then
        cast, castSpell = shown(name), shown(castID)
    end
    return string.format("+%.1f %s read: marker %s, cast %s, cast spell %s, event spell %s", seconds, token, marker, cast,
        castSpell, shown(spellID))
end

local Anchor, Plates = CRT.InterruptAnchor, CRT.InterruptPlates
if Anchor and Plates then
    Anchor:OnArm(function(on, mode)
        if not (CRT.db and on) then
            return
        end
        startedAt = Anchor.pullTime or GetTime()
        if store().on then
            store().last = { encounterID = Anchor.encounterID, mode = mode, started = time(), lines = {} }
        end
    end)
    Anchor:OnCast(function(n, at)
        if CRT.db and Anchor.def and Anchor.def.timing then
            add(stamp(at) .. " " .. Anchor.def.timing.anchor.unit .. " cast " .. n)
        end
    end)
    Anchor:OnWave(function(wave, at)
        if CRT.db then
            add(stamp(at) .. " anchor wave " .. tostring(wave))
        end
    end)
    Plates:OnCast(function(unit, castTime, at, n, why, g)
        if CRT.db then
            local group = g and Anchor.def and Anchor.def.groups[g] and Anchor.def.groups[g].label
            add(Probe.CastLine(castTime - startedAt, unit, at, castTime, n, why, group))
        end
    end)
    if Plates.OnRawCast then
        Plates:OnRawCast(function(unit, _, spellID)
            if CRT.db and store().on then
                local line = Probe.ReadLine(GetTime() - startedAt, unit, spellID)
                if line then
                    add(line)
                end
            end
        end)
    end
end

function Probe:SetOn(on)
    store().on = on and true or false
    CRT:Print(on and "Kick probe on: it logs the next Interrupts run (a matching pull, or Test on trash). /crt dev kicks show after it."
        or "Kick probe off. The last log is kept.")
end

function Probe:Text()
    local last = store().last
    if not last then
        return nil
    end
    local when = date and last.started and date("%Y-%m-%d %H:%M", last.started) or "?"
    local head = string.format("Kick probe: encounter %s, %s, started %s", tostring(last.encounterID or "?"),
        last.mode == "test" and "Test on trash" or "pull", when)
    local text = head .. "\n" .. table.concat(last.lines, "\n")
    if last.dropped then
        text = text .. "\n... " .. last.dropped .. " more lines dropped (the log keeps " .. Probe.MAX_LINES .. ")"
    end
    return text
end

function Probe:Show()
    local text = self:Text()
    if not text then
        CRT:Print("The kick probe has no log yet. Run /crt dev kicks on, then pull the boss.")
        return
    end
    CRT:Print("Kick probe, last run: " .. #store().last.lines .. " lines.")
    CRT.ConsumablesTools:ShowText("Kick probe log (Ctrl+C to copy, paste to Claude)", text)
end

-- Handles "dev kicks [on|off|show]". Returns false for any other command.
function Probe:Command(msg)
    local rest = msg:match("^dev%s+kicks%s*$") and "" or msg:match("^dev%s+kicks%s+(.-)%s*$")
    if not rest then
        return false
    end
    if rest == "on" or rest == "off" then
        self:SetOn(rest == "on")
    elseif rest == "show" then
        self:Show()
    else
        local last = store().last
        CRT:Print("Kick probe is " .. (store().on and "on" or "off") .. (last and (", with a log of " .. #last.lines .. " lines") or ", no log yet")
            .. ". /crt dev kicks on, off or show.")
    end
    return true
end
