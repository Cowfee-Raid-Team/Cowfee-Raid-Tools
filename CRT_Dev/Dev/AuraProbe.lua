local ADDON, CRT = ...

-- DEVELOPER ONLY. Finds out what the game lets an addon read of a debuff on the group's players, for a debuff list
-- (Alerts/DebuffList.lua). Run it on a real pull: whether the list can fill in is only known there.
--   /crt dev aura <spellID>        one snapshot now, in a window to copy
--   /crt dev aura on [spellID]     logs while on: a snapshot at each pull's start and end and each combat start, every
--                                  UNIT_AURA of a group unit, and a lookup line each time a unit's answer changes. The
--                                  spells: the one given, else the last one, else every debuff list's of the loaded bosses
--   /crt dev aura off              stops; the log stays
--   /crt dev aura show             opens the log to copy (Ctrl+C)
-- A snapshot logs the state (combat, lockdown, encounter, group), then per spell its name and whether the game calls it
-- a private aura, then per group unit the two lookups:
--   byID   C_UnitAuras.GetUnitAuraBySpellID(unit, spellID)
--   byName C_UnitAuras.GetAuraDataBySpellName(unit, name, "HARMFUL")
-- each "error <text>", "nothing", "secret <type>" (the whole answer hidden) or "readable", and for a readable aura
-- table each field read: its value, "secret" (issecretvalue) or "noaccess" (canaccessvalue false). Then the tier the
-- debuff list would use (DL.Classify: readable, secret, private or unreadable), which is saved for the Looks tab's
-- notice (DL:SetSeen). A UNIT_AURA line says the unit (or <secret>) and whether updateInfo was readable.
-- Nothing is compared, indexed or joined before its secret check; every game call is in a pcall.
-- Saved in CRTDB.dev.auraProbe: on, spells, and last = { started (time()), lines, dropped }, the last run only.
-- Game calls (warcraft.wiki.gg and Blizzard's UnitAuraDocumentation.lua, live, read 2026-10-30):
-- C_UnitAuras.GetUnitAuraBySpellID (AllowedWhenTainted, RequiresNonSecretAura, SecretWhenUnitAuraRestricted),
-- C_UnitAuras.GetAuraDataBySpellName(unit, spellName, filter) (AllowedWhenUntainted: secret arguments only from
-- untainted code; ours are plain), C_UnitAuras.AuraIsPrivate(spellID), C_Spell.GetSpellName(spellID), issecretvalue,
-- canaccessvalue (12.0.0), InCombatLockdown, UnitAffectingCombat, C_InstanceEncounter.IsEncounterInProgress, IsInRaid,
-- IsInGroup, UnitExists, UnitName, UNIT_AURA (unitTarget, updateInfo; fully secret while auras are secret, 12.1.0),
-- ENCOUNTER_START, ENCOUNTER_END, PLAYER_REGEN_DISABLED.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.AuraProbe = Probe

Probe.MAX_LINES = 3000
local FIELDS = { "spellId", "name", "auraInstanceID", "isHarmful", "applications", "duration", "expirationTime", "sourceUnit" }

local frame
local startedAt = 0
local lastAnswer = {} -- unit .. ":" .. spellID -> the last lookup line's text, so a line is logged only on a change

local function store()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.auraProbe = CRT.db.dev.auraProbe or { on = false }
    return CRT.db.dev.auraProbe
end

local function isSecret(v)
    if not issecretvalue then
        return false
    end
    local ok, s = pcall(issecretvalue, v)
    return not ok or s == true
end

-- A value as the log shows it.
local function show(v)
    if isSecret(v) then
        return "<secret>"
    elseif v == nil then
        return "nil"
    elseif type(v) == "string" then
        return '"' .. v:gsub("[\r\n]+", " ") .. '"'
    elseif type(v) == "number" or type(v) == "boolean" then
        return tostring(v)
    end
    return "<" .. type(v) .. ">"
end

-- A game call's first result, or nil and the error text.
local function call(fn, ...)
    if type(fn) ~= "function" then
        return nil, "missing"
    end
    local ok, v = pcall(fn, ...)
    if not ok then
        return nil, tostring(v)
    end
    return v
end

local function plain(v)
    return not isSecret(v) and v or nil
end

local function stamp()
    return string.format("+%.1f", (GetTime() or 0) - startedAt)
end

-- Adds a line to the open log (a snapshot alone opens a fresh one).
local function add(line)
    local last = store().last
    if not last then
        return
    end
    if #last.lines >= Probe.MAX_LINES then
        last.dropped = (last.dropped or 0) + 1
        return
    end
    last.lines[#last.lines + 1] = line
end

local function fresh()
    startedAt = GetTime() or 0
    lastAnswer = {}
    store().last = { started = time and time() or 0, lines = {} }
end

-- The group's units: raid1 to raid40, else you and party1 to party4, each that exists.
function Probe.Units()
    local out = {}
    if plain(call(IsInRaid)) then
        for i = 1, 40 do
            local unit = "raid" .. i
            if plain(call(UnitExists, unit)) then
                out[#out + 1] = unit
            end
        end
    else
        out[1] = "player"
        for i = 1, 4 do
            local unit = "party" .. i
            if plain(call(UnitExists, unit)) then
                out[#out + 1] = unit
            end
        end
    end
    return out
end

-- One field of an aura table: its value, "secret" or "noaccess", or "error".
local function field(aura, key)
    local ok, v = pcall(function()
        return aura[key]
    end)
    if not ok then
        return "error"
    end
    if isSecret(v) then
        return "secret"
    end
    if type(canaccessvalue) == "function" then
        local okA, can = pcall(canaccessvalue, v)
        if okA and not isSecret(can) and can == false then
            return "noaccess"
        end
    end
    return show(v)
end

-- One lookup as text: "error <text>", "nothing", "secret <type>" or "readable <fields>".
function Probe.Describe(v, err)
    if err then
        return "error " .. show(err)
    end
    if isSecret(v) then
        return "secret " .. type(v)
    end
    if v == nil then
        return "nothing"
    end
    if type(v) ~= "table" then
        return "readable " .. show(v)
    end
    if type(canaccesstable) == "function" then
        local ok, can = pcall(canaccesstable, v)
        if ok and not isSecret(can) and can == false then
            return "readable table, noaccess"
        end
    end
    local parts = {}
    for _, k in ipairs(FIELDS) do
        parts[#parts + 1] = k .. "=" .. field(v, k)
    end
    return "readable " .. table.concat(parts, " ")
end

local function spellName(spellID)
    local n = call(C_Spell and C_Spell.GetSpellName, spellID)
    return type(n) == "string" and not isSecret(n) and n or nil
end

-- The lookups of one unit for one spell, as a line's text (without the time).
local function lookup(unit, spellID, name)
    local api = C_UnitAuras or {}
    local unitName = call(UnitName, unit)
    local byID = Probe.Describe(call(api.GetUnitAuraBySpellID, unit, spellID))
    local byName = name and Probe.Describe(call(api.GetAuraDataBySpellName, unit, name, "HARMFUL")) or "no spell name"
    return string.format("%s %s spell %d byID: %s | byName: %s", unit, show(unitName), spellID, byID, byName)
end

local function stateLine()
    local enc = call(C_InstanceEncounter and C_InstanceEncounter.IsEncounterInProgress)
    return string.format("%s STATE combat=%s lockdown=%s encounter=%s raid=%s group=%s", stamp(), show(call(UnitAffectingCombat, "player")),
        show(call(InCombatLockdown)), show(enc), show(call(IsInRaid)), show(call(IsInGroup)))
end

-- The tier a debuff list would use now, saved for the Looks tab; its line.
local function tierLine(spellID, units)
    local DL = CRT.AlertDebuffList
    if not DL then
        return nil
    end
    local states = {}
    for _, unit in ipairs(units) do
        local state = DL.ReadUnit(unit, spellID)
        states[unit] = { state = state }
    end
    local private = DL.IsPrivate(spellID)
    local tier, any = DL.Classify(states, private)
    if tier ~= "readable" or any then
        DL:SetSeen(spellID, tier)
    end
    return string.format("%s TIER spell %d %s%s", stamp(), spellID, tier, any and " (someone has it)" or "")
end

-- The spells to watch: the ones given, else every debuff list's of the loaded bosses.
function Probe.Spells()
    local s = store()
    if type(s.spells) == "table" and #s.spells > 0 then
        return s.spells
    end
    local out, seen = {}, {}
    local B, DL = CRT.Bosses, CRT.AlertDebuffList
    for _, def in ipairs(B and B.List and B:List() or {}) do
        for _, e in ipairs(DL and DL.Entries(def.encounterID) or {}) do
            if not seen[e.spellID] then
                seen[e.spellID] = true
                out[#out + 1] = e.spellID
            end
        end
    end
    return out
end

-- A snapshot of every group unit for the spells, into the open log.
function Probe:Snapshot(spells, why)
    add(stateLine() .. (why and (" (" .. why .. ")") or ""))
    local units = Probe.Units()
    for _, spellID in ipairs(spells) do
        local name = spellName(spellID)
        add(string.format("%s SPELL %d name=%s private=%s", stamp(), spellID, show(name),
            show(call(C_UnitAuras and C_UnitAuras.AuraIsPrivate, spellID))))
        for _, unit in ipairs(units) do
            local text = lookup(unit, spellID, name)
            lastAnswer[unit .. ":" .. spellID] = text
            add(stamp() .. " " .. text)
        end
        local t = tierLine(spellID, units)
        if t then
            add(t)
        end
    end
end

-- A UNIT_AURA while on: its line, then a lookup line per spell when the unit's answer changed.
function Probe.OnAura(unit, info)
    local infoText = isSecret(info) and "secret" or (info == nil and "nil" or (type(info) == "table" and "readable" or show(info)))
    if infoText == "readable" then
        local okF, full = pcall(function()
            return info.isFullUpdate
        end)
        infoText = infoText .. " isFullUpdate=" .. (okF and show(full) or "error")
    end
    add(string.format("%s UNIT_AURA unit=%s updateInfo=%s", stamp(), show(unit), infoText))
    if isSecret(unit) or type(unit) ~= "string" then
        return
    end
    for _, spellID in ipairs(Probe.Spells()) do
        local text = lookup(unit, spellID, spellName(spellID))
        local key = unit .. ":" .. spellID
        if lastAnswer[key] ~= text then
            lastAnswer[key] = text
            add(stamp() .. " " .. text)
        end
    end
end

local function groupUnit(unit)
    return unit == "player" or unit:match("^raid%d+$") ~= nil or unit:match("^party%d$") ~= nil
end

function Probe.HandleEvent(event, a1, a2)
    if not (CRT.db and store().on) then
        return
    end
    if event == "ENCOUNTER_START" then
        fresh()
        add(string.format("%s ENCOUNTER_START encounterID=%s name=%s", stamp(), show(a1), show(a2)))
        Probe:Snapshot(Probe.Spells(), "pull start")
    elseif event == "ENCOUNTER_END" then
        add(string.format("%s ENCOUNTER_END encounterID=%s", stamp(), show(a1)))
        Probe:Snapshot(Probe.Spells(), "pull end")
    elseif event == "PLAYER_REGEN_DISABLED" then
        if not store().last then
            fresh()
        end
        Probe:Snapshot(Probe.Spells(), "combat start")
    elseif event == "UNIT_AURA" then
        if not store().last then
            return
        end
        if isSecret(a1) or (type(a1) == "string" and groupUnit(a1)) then
            Probe.OnAura(a1, a2)
        end
    end
end

local function listen(on)
    if not frame then
        frame = CreateFrame("Frame")
        frame:SetScript("OnEvent", function(_, event, ...)
            Probe.HandleEvent(event, ...)
        end)
    end
    for _, e in ipairs({ "ENCOUNTER_START", "ENCOUNTER_END", "PLAYER_REGEN_DISABLED", "UNIT_AURA" }) do
        if on then
            frame:RegisterEvent(e)
        else
            frame:UnregisterEvent(e)
        end
    end
end

function Probe:SetOn(on, spellID)
    local s = store()
    s.on = on and true or false
    if spellID then
        s.spells = { spellID }
    end
    listen(s.on)
    if s.on then
        fresh()
        local spells = Probe.Spells()
        local list = {}
        for i, id in ipairs(spells) do
            list[i] = tostring(id)
        end
        CRT:Print("Aura probe on, for spell " .. (#list > 0 and table.concat(list, ", ") or "none (give one: /crt dev aura on <spellID>)")
            .. ". It logs the next pull. /crt dev aura show after it.")
    else
        CRT:Print("Aura probe off. The last log is kept.")
    end
end

function Probe:Text()
    local last = store().last
    if not last then
        return nil
    end
    local when = date and last.started and date("%Y-%m-%d %H:%M", last.started) or "?"
    local text = "Aura probe, started " .. when .. "\n" .. table.concat(last.lines, "\n")
    if last.dropped then
        text = text .. "\n... " .. last.dropped .. " more lines dropped (the log keeps " .. Probe.MAX_LINES .. ")"
    end
    return text
end

function Probe:Show()
    local text = self:Text()
    if not text then
        CRT:Print("The aura probe has no log yet. Run /crt dev aura <spellID>, or /crt dev aura on before a pull.")
        return
    end
    CRT.ConsumablesTools:ShowText("Aura probe log (Ctrl+C to copy, paste to Claude)", text)
end

-- Handles "dev aura ...". Returns false for any other command.
function Probe:Command(msg)
    local rest = msg:match("^dev%s+aura%s*$") and "" or msg:match("^dev%s+aura%s+(.-)%s*$")
    if not rest then
        return false
    end
    local onID = rest:match("^on%s+(%d+)$")
    if rest == "on" or onID then
        self:SetOn(true, tonumber(onID))
    elseif rest == "off" then
        self:SetOn(false)
    elseif rest == "show" then
        self:Show()
    elseif rest:match("^%d+$") then
        local id = tonumber(rest)
        store().spells = { id }
        fresh()
        self:Snapshot({ id }, "snapshot")
        self:Show()
    else
        CRT:Print("Aura probe is " .. (store().on and "on" or "off") .. ". /crt dev aura <spellID>, on [spellID], off or show.")
    end
    return true
end

-- On stays on through a /reload.
local login = CreateFrame("Frame")
login:RegisterEvent("PLAYER_LOGIN")
login:SetScript("OnEvent", function()
    if CRT.db and CRT.db.dev and CRT.db.dev.auraProbe and CRT.db.dev.auraProbe.on then
        listen(true)
    end
end)
