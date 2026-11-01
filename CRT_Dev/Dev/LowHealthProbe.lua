local ADDON, CRT = ...

-- DEVELOPER ONLY. Finds out, in game, what an addon can see of your health going under the low-health threshold
-- (#1242), for the LOW HEALTH banner (QoL/LowHealth.lua) and its sound (QoL/LowHealthSound.lua, WIP).
--   /crt dev lowhp        on (or the state when already on)
--   /crt dev lowhp on     logs while on: each UNIT_HEALTH and UNIT_MAXHEALTH of yours, each combat start and end,
--                         death and release, and each call of the game's Combat Audio Alerts health pulse
--   /crt dev lowhp off    stops; the log stays
--   /crt dev lowhp show   opens the log to copy (Ctrl+C)
-- A health line says: combat on or off, the event's unit, UnitHealthPercent with the banner's curve ("curve result"),
-- UnitHealthPercent without one and UnitHealth, each "<secret number>", a plain value or "error"; then the banner's
-- path and its last error (LowHealth:State: curve, plain, off, dead or preview) and whether its alpha is secret. A pulse
-- line says the kit the game picked (CombatAudioAlertManager:SetHealthPulseSoundKit, "<secret number>", a number or
-- nil) or a stop (StopHealthPulse), and a settings line the game's CAAEnabled and CAAPulsePlayerHealthPercent. The same
-- line twice in a row is counted, not logged again.
-- Nothing is compared, joined, turned into text or used as a key before its issecretvalue check; every game call is
-- in a pcall. It changes no game setting: the pulse lines come only when the game's own pulse is on (Options >
-- Accessibility > Combat Audio Alerts). The hooks (hooksecurefunc) can't be taken off; while off they log nothing.
-- Game calls (warcraft.wiki.gg, read 2026-11-01): UnitHealthPercent(unit, usePredicted, curve) (SecretReturns,
-- SecretWhenCurveSecret), UnitHealth, issecretvalue, C_CVar.GetCVar, InCombatLockdown, hooksecurefunc; the pulse
-- manager's methods from Gethe/wow-ui-source live, Blizzard_CombatAudioAlerts/Blizzard_CombatAudioAlertManager.lua.
-- Saved in CRTDB.dev.lowhpProbe: on, and last = { started (time()), lines }, the last run only, at most MAX_LINES.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.LowHealthProbe = Probe

Probe.MAX_LINES = 1500

local TEXT = {
    on = "Low-health probe on. Drop under your threshold out of combat, then in combat, then heal. /crt dev lowhp show after.",
    off = "Low-health probe off. The last log is kept.",
    state = "Low-health probe is %s. /crt dev lowhp on, off or show.",
    none = "The low-health probe has no log yet. Run /crt dev lowhp on first.",
    title = "Low-health probe log (Ctrl+C to copy, paste to Claude)",
    head = "Low-health probe, started %s",
}

local frame, hooked

local function store()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.lowhpProbe = CRT.db.dev.lowhpProbe or { on = false }
    return CRT.db.dev.lowhpProbe
end

local function isSecret(v)
    if not issecretvalue then
        return false
    end
    local ok, s = pcall(issecretvalue, v)
    return not ok or s == true
end

-- A value as the log shows it: a secret by its type only.
local function show(v)
    if isSecret(v) then
        return "<secret " .. type(v) .. ">"
    elseif v == nil then
        return "nil"
    elseif type(v) == "number" then
        -- a sound kit's ID in full; a fraction (a percent or the curve's result) to 3 places
        return v == math.floor(v) and string.format("%d", v) or string.format("%.3f", v)
    elseif type(v) == "string" or type(v) == "boolean" then
        return tostring(v)
    end
    return "<" .. type(v) .. ">"
end

-- A game call's first result as the log shows it, or "error".
local function call(fn, ...)
    if type(fn) ~= "function" then
        return "missing"
    end
    local ok, v = pcall(fn, ...)
    return ok and show(v) or "error"
end

local function add(line)
    local s = store()
    local last = s.last
    if not (s.on and last) then
        return
    end
    local lines = last.lines
    -- the same line again: counted on it, not added
    if last.prev == line then
        last.repeats = (last.repeats or 0) + 1
        lines[#lines] = line .. " (x" .. (last.repeats + 1) .. ")"
        return
    end
    last.prev, last.repeats = line, 0
    if #lines < Probe.MAX_LINES then
        lines[#lines + 1] = line
    end
end

local function combat()
    local ok, on = pcall(InCombatLockdown)
    return (ok and on == true) and "on" or "off"
end

local function getCVar(name)
    return call(C_CVar and C_CVar.GetCVar, name)
end

local function settingsLine()
    add("settings: CAAEnabled " .. getCVar("CAAEnabled") .. ", CAAPulsePlayerHealthPercent " .. getCVar("CAAPulsePlayerHealthPercent"))
end

-- One health line: every way an addon might see the dip, each shown only by its secret-ness or plain value.
local function healthLine(event, unit)
    local LH = CRT.LowHealth
    local st = LH and LH.State and LH:State() or {}
    local curveResult = "no curve"
    if st.curve then
        curveResult = call(UnitHealthPercent, "player", true, st.curve)
    end
    local alpha = "no banner"
    if st.frame then
        local ok, a = pcall(st.frame.GetAlpha, st.frame)
        alpha = ok and (isSecret(a) and "<secret>" or "plain") or "error"
    end
    add(string.format("%s %s, combat %s: curve result %s, percent %s, UnitHealth %s; banner %s%s, alpha %s",
        event, show(unit), combat(), curveResult, call(UnitHealthPercent, "player", true), call(UnitHealth, "player"),
        tostring(st.path or "none"), st.error and (" (" .. st.error .. ")") or "", alpha))
end

-- The game's pulse: the kit it picked, by its secret-ness, or its stop.
local function hook()
    local M = _G.CombatAudioAlertManager
    if hooked or not (M and hooksecurefunc) then
        return
    end
    hooked = true
    pcall(hooksecurefunc, M, "SetHealthPulseSoundKit", function(_, kit)
        if store().on then
            add("pulse kit " .. show(kit) .. ", combat " .. combat())
        end
    end)
    pcall(hooksecurefunc, M, "StopHealthPulse", function()
        if store().on then
            add("pulse stop, combat " .. combat())
        end
    end)
end

function Probe.HandleEvent(event, unit)
    if not store().on then
        return
    end
    if event == "UNIT_HEALTH" or event == "UNIT_MAXHEALTH" then
        healthLine(event, unit)
    elseif event == "PLAYER_REGEN_DISABLED" or event == "PLAYER_REGEN_ENABLED" then
        add(event .. ": combat " .. (event == "PLAYER_REGEN_DISABLED" and "on" or "off"))
        settingsLine()
        healthLine("now", "player")
    else
        add(event)
        healthLine("now", "player")
    end
end

local EVENTS = { "UNIT_HEALTH", "UNIT_MAXHEALTH", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "PLAYER_DEAD", "PLAYER_ALIVE",
    "PLAYER_UNGHOST" }

local function listen(on)
    if not frame then
        frame = CreateFrame("Frame")
        frame:SetScript("OnEvent", function(_, event, ...)
            local ok = pcall(Probe.HandleEvent, event, ...)
            if not ok then
                add(event .. ": the probe could not log it")
            end
        end)
    end
    for _, e in ipairs(EVENTS) do
        if on then
            frame:RegisterEvent(e)
        else
            frame:UnregisterEvent(e)
        end
    end
end

function Probe:SetOn(on)
    local s = store()
    s.on = on and true or false
    listen(s.on)
    if s.on then
        hook()
        s.last = { started = time(), lines = {} }
        local LH = CRT.LowHealth
        local q = CRT.db.qol and CRT.db.qol.lowHealth or {}
        add("banner on " .. tostring(q.enabled == true) .. ", threshold " .. tostring(q.threshold) .. "%, pulse manager "
            .. tostring(_G.CombatAudioAlertManager ~= nil) .. ", hooked " .. tostring(hooked == true) .. ", State " .. tostring(LH and LH.State ~= nil))
        settingsLine()
        healthLine("start", "player")
        CRT:Print(TEXT.on)
    else
        CRT:Print(TEXT.off)
    end
end

function Probe:Text()
    local last = store().last
    if not last then
        return nil
    end
    local when = date and last.started and date("%Y-%m-%d %H:%M", last.started) or "?"
    return string.format(TEXT.head, when) .. "\n" .. table.concat(last.lines, "\n")
end

function Probe:Show()
    local text = self:Text()
    if not text then
        CRT:Print(TEXT.none)
        return
    end
    CRT.ConsumablesTools:ShowText(TEXT.title, text)
end

-- Handles "dev lowhp ...". Returns false for any other command.
function Probe:Command(msg)
    local rest = msg:match("^dev%s+lowhp%s*$") and "" or msg:match("^dev%s+lowhp%s+(.-)%s*$")
    if not rest then
        return false
    end
    if rest == "on" or (rest == "" and not store().on) then
        self:SetOn(true)
    elseif rest == "off" then
        self:SetOn(false)
    elseif rest == "show" then
        self:Show()
    else
        CRT:Print(string.format(TEXT.state, store().on and "on" or "off"))
    end
    return true
end

-- On stays on through a /reload.
local login = CreateFrame("Frame")
login:RegisterEvent("PLAYER_LOGIN")
login:SetScript("OnEvent", function()
    if CRT.db and store().on then
        listen(true)
        hook()
    end
end)
