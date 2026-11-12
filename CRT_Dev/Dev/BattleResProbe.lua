local ADDON, CRT = ...

-- DEVELOPER ONLY. Finds out, in a boss fight, what an addon can read of the shared battle res charges, for the battle
-- res icon (QoL/BattleRes.lua).
--   /crt dev brez   prints, for Rebirth (20484): each field of C_Spell.GetSpellCharges, whether it is secret
--                   (issecretvalue), whether an encounter is active, combat, the group and the instance kind, and whether the game's charge duration object
--                   (C_Spell.GetSpellChargeDuration) has secrets and is taken by Cooldown:SetCooldownFromDurationObject
-- Nothing is compared, joined, turned into text or kept before its issecretvalue check; every game call is in a pcall.
-- The duration test uses its own hidden cooldown frame, never the icon's.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.BattleResProbe = Probe

local FIELDS = { "currentCharges", "maxCharges", "cooldownStartTime", "cooldownDuration", "chargeModRate", "isActive" }

local TEXT = {
    head = "Battle res probe (spell %d). Paste these lines to Claude.",
    missing = "C_Spell.GetSpellCharges is missing on this client.",
    failed = "C_Spell.GetSpellCharges raised an error: %s",
    none = "C_Spell.GetSpellCharges gave nothing (no shared charges now: outside a boss fight, or not charge-based).",
    field = "  %s: %s",
    encounter = "Encounter active: our flag %s, IsEncounterInProgress %s. Combat flag %s, in a group %s, instance %s.",
    duration = "Charge duration object: %s",
    icon = "Icon: setting %s, shown %s.",
}

local testCooldown

local function isSecret(v)
    if not issecretvalue then
        return false
    end
    local ok, s = pcall(issecretvalue, v)
    return not ok or s == true
end

-- A value as the probe prints it: a secret by its type only.
local function show(v)
    if isSecret(v) then
        return "<secret " .. type(v) .. ">"
    elseif v == nil then
        return "nil"
    elseif type(v) == "number" then
        return v == math.floor(v) and string.format("%d", v) or string.format("%.3f", v)
    end
    return tostring(v)
end

local function durationLine(id)
    local get = C_Spell and C_Spell.GetSpellChargeDuration
    if not get then
        return "C_Spell.GetSpellChargeDuration is missing"
    end
    local ok, duration = pcall(get, id)
    if not ok then
        return "GetSpellChargeDuration raised an error: " .. tostring(duration)
    end
    if type(duration) == "nil" then
        return "none"
    end
    local parts = { type(duration) .. (isSecret(duration) and " (secret)" or "") }
    if duration.HasSecretValues then
        local okS, has = pcall(duration.HasSecretValues, duration)
        parts[#parts + 1] = "HasSecretValues " .. (okS and show(has) or "error")
    end
    if not testCooldown then
        testCooldown = CreateFrame("Cooldown", nil, UIParent, "CooldownFrameTemplate")
        testCooldown:SetSize(1, 1)
        testCooldown:SetPoint("TOPLEFT", UIParent, "BOTTOMRIGHT", 10, -10) -- off screen
    end
    if testCooldown.SetCooldownFromDurationObject then
        local okSet, err = pcall(testCooldown.SetCooldownFromDurationObject, testCooldown, duration)
        parts[#parts + 1] = "SetCooldownFromDurationObject " .. (okSet and "ok" or ("refused: " .. tostring(err)))
        testCooldown:Clear()
    else
        parts[#parts + 1] = "SetCooldownFromDurationObject is missing"
    end
    return table.concat(parts, ", ")
end

function Probe:Run()
    local id = CRT.BattleRes and CRT.BattleRes.SPELL_ID or 20484
    CRT:Print(string.format(TEXT.head, id))
    local get = C_Spell and C_Spell.GetSpellCharges
    if not get then
        print(TEXT.missing)
    else
        local ok, info = pcall(get, id)
        if not ok then
            print(string.format(TEXT.failed, tostring(info)))
        elseif type(info) ~= "table" then
            print(TEXT.none)
        else
            for _, name in ipairs(FIELDS) do
                print(string.format(TEXT.field, name, show(info[name])))
            end
        end
    end
    local state = CRT.BattleRes and CRT.BattleRes.State() or {}
    local inProgress = "missing"
    if IsEncounterInProgress then
        local ok, v = pcall(IsEncounterInProgress)
        inProgress = ok and show(v) or "error"
    end
    print(string.format(TEXT.encounter, tostring(state.encounter), inProgress, tostring(state.combat), tostring(state.group), tostring(state.instance)))
    print(string.format(TEXT.duration, durationLine(id)))
    local s = CRT.db.qol.battleRes
    local parts = CRT.BattleRes and CRT.BattleRes.Parts() or {}
    print(string.format(TEXT.icon, (s.enabled and "on" or "off") .. ", " .. tostring(s.show) .. (s.groupOnly and ", only in a group" or ""),tostring(parts.frame and parts.frame:IsShown() or false)))
end

-- Handles "dev brez". Returns true when the command was one.
function Probe:Command(msg)
    if msg ~= "dev brez" then
        return false
    end
    self:Run()
    return true
end
