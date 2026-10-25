local ADDON, CRT = ...

-- DEVELOPER ONLY. Finds out whether a boss's absorb shield can be read during an encounter, for a shield
-- bar. /crt dev absorbprobe on logs every boss pull, from ENCOUNTER_START to ENCOUNTER_END, one line per
-- reading, with the seconds from the pull and each value as it came, or <secret> when the game hid it.
-- /crt dev absorbprobe show prints a count per kind (and which fields were secret) and opens the whole
-- log in a window to copy (Ctrl+C). /crt dev absorbprobe off stops it; the log stays. Nothing is shown
-- on screen during the pull.
--
-- Logged, for boss1 to boss5 (every name checked on warcraft.wiki.gg, 2026-10-25):
--   UNIT_ABSORB_AMOUNT_CHANGED (payload unitTarget): UnitGetTotalAbsorbs(unit) as it came, its type(),
--     whether it is secret, and what canaccessvalue says when that function exists
--   UNIT_AURA (payload unitTarget, updateInfo; updateInfo is not read): each HELPFUL aura from
--     C_UnitAuras.GetAuraDataByIndex(unit, i, "HELPFUL"), i up to 40: spellId, name, points, and whether the
--     aura table itself is secret. A spell is logged once per 5 s.
--   FORMAT, twice per pull at most, tagged kind="readable" (the first readable absorb that is not 0) or
--     kind="secret" (the first secret one): AbbreviateNumbers
--     and AbbreviateLargeNumbers (a native API since 12.0.0), string.format("%d") and tostring, each in a
--     pcall: the result, its type, whether it is secret, or the error text
--   BAR, same moments and tags: whether StatusBar:SetMinMaxValues(0, value) and SetValue(value) on a
--     hidden bar take the value (pcall)
--   UNIT_SPELLCAST_START for boss1 (payload unitTarget, castGUID, spellID, castBarID): UnitCastingInfo's
--     name, startTimeMs and endTimeMs, readable or secret
--   APIS, at the pull's start: which of these functions the game has at all
-- A value is never compared, added or used as a table key before the secret check. A secret table is
-- never indexed.
--
-- Saved in CRTDB.dev.absorbProbe: on, and last = { encounterID, name, difficultyID, started (time()),
-- lines, counts[kind] = { n, secret[field] = n }, throttled, dropped }, the last pull only.
--
-- Boss debug (Dev/BossDebug.lua) turns it on through Follow without its own switch: then each line also
-- goes to the boss's record, section "absorb", and CRTDB.dev.absorbProbe is left alone unless on too.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.AbsorbProbe = Probe

Probe.MAX_LINES = 3000
Probe.AURA_GAP = 5 -- seconds before the same aura is logged again
local MAX_AURAS = 40
local MAX_POINTS = 8
local BOSS_UNITS = { boss1 = true, boss2 = true, boss3 = true, boss4 = true, boss5 = true }

local DURING = { "UNIT_ABSORB_AMOUNT_CHANGED", "UNIT_AURA", "UNIT_SPELLCAST_START" }

local frame, bar
local pulling = false
local startedAt = 0
local seenAura, seenSecretUnit = {}, {}
local probed -- which kinds of value already ran the format and bar probes this pull: probed.readable, probed.secret
local follow = false -- Boss debug is on: log every pull into its record too

local function store()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.absorbProbe = CRT.db.dev.absorbProbe or { on = false }
    return CRT.db.dev.absorbProbe
end

local function isSecret(v)
    if not issecretvalue then
        return false
    end
    local ok, secret = pcall(issecretvalue, v)
    return not ok or secret and true or false
end

local function readable(v)
    return not isSecret(v) and v ~= nil
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

-- One line: the seconds from the pull, the kind and its fields. A field is { name, value }, or
-- { name, value, text, hasSecret } when the text is made by the caller (a list of values).
function Probe.Line(seconds, kind, fields)
    local parts = { string.format("+%.1f", seconds), kind }
    for _, f in ipairs(fields) do
        parts[#parts + 1] = f[1] .. "=" .. (f[3] or show(f[2]))
    end
    return table.concat(parts, " ")
end

local function add(kind, fields)
    local s = store()
    local last = s.on and s.last or nil
    if not last and not follow then
        return
    end
    local line = Probe.Line(GetTime() - startedAt, kind, fields)
    if follow and CRT.BossDebug then
        local secrets = 0
        for _, f in ipairs(fields) do
            if f[4] or isSecret(f[2]) then
                secrets = secrets + 1
            end
        end
        CRT.BossDebug:Append("absorb", line, secrets)
    end
    if not last then
        return
    end
    local c = last.counts[kind]
    if not c then
        c = { n = 0, secret = {} }
        last.counts[kind] = c
    end
    c.n = c.n + 1
    for _, f in ipairs(fields) do
        if f[4] or isSecret(f[2]) then
            c.secret[f[1]] = (c.secret[f[1]] or 0) + 1
        end
    end
    if #last.lines >= Probe.MAX_LINES then
        last.dropped = (last.dropped or 0) + 1
        return
    end
    last.lines[#last.lines + 1] = line
end

-- An aura left out as a repeat: counted in the probe's own log only.
local function throttled()
    local s = store()
    if s.on and s.last then
        s.last.throttled = (s.last.throttled or 0) + 1
    end
end

-- A game call's first result, or the text "error" when it fails, "missing" when there is no such function.
local function ask(fn, ...)
    if type(fn) ~= "function" then
        return "missing"
    end
    local ok, v = pcall(fn, ...)
    if not ok then
        return "error"
    end
    return v
end

local function setUnitEvents(on)
    for _, e in ipairs(DURING) do
        if on then
            frame:RegisterEvent(e)
        else
            frame:UnregisterEvent(e)
        end
    end
end

-- Which functions the game has. A missing one is logged and the probe goes on without it.
local function logApis()
    local list = {
        { "UnitGetTotalAbsorbs", UnitGetTotalAbsorbs }, { "AbbreviateNumbers", AbbreviateNumbers },
        { "AbbreviateLargeNumbers", AbbreviateLargeNumbers }, { "issecretvalue", issecretvalue },
        { "canaccessvalue", canaccessvalue }, { "UnitCastingInfo", UnitCastingInfo },
        { "C_UnitAuras.GetAuraDataByIndex", C_UnitAuras and C_UnitAuras.GetAuraDataByIndex },
    }
    local fields = {}
    for _, e in ipairs(list) do
        fields[#fields + 1] = { e[1], type(e[2]) == "function" }
    end
    add("APIS", fields)
end

local function startPull(encounterID, name, difficultyID, groupSize)
    pulling = true
    startedAt = GetTime()
    seenAura, seenSecretUnit = {}, {}
    probed = {}
    if store().on then
        store().last = { encounterID = readable(encounterID) and encounterID or nil, name = readable(name) and name or nil,
            difficultyID = readable(difficultyID) and difficultyID or nil, started = time(), lines = {}, counts = {}, throttled = 0 }
    end
    if follow and CRT.BossDebug then
        CRT.BossDebug:Open(encounterID, name, difficultyID)
    end
    setUnitEvents(true)
    add("ENCOUNTER_START", { { "encounterID", encounterID }, { "name", name }, { "difficultyID", difficultyID }, { "groupSize", groupSize } })
    logApis()
end

local function endPull(encounterID, success)
    add("ENCOUNTER_END", { { "encounterID", encounterID }, { "success", success } })
    local last = store().on and store().last
    if last then
        last.length = GetTime() - startedAt
        last.success = readable(success) and success or nil
        if last.dropped then
            last.lines[#last.lines + 1] = "... " .. last.dropped .. " more lines dropped (the log keeps " .. Probe.MAX_LINES .. ")"
        end
    end
    pulling = false
    setUnitEvents(false)
end

-- What the number formatters and string functions do with the value, each in a pcall.
local function probeFormat(value, kind)
    local tries = {
        { "AbbreviateNumbers", AbbreviateNumbers },
        { "AbbreviateLargeNumbers", AbbreviateLargeNumbers },
        { "string.format %d", function(v) return string.format("%d", v) end },
        { "tostring", tostring },
    }
    for _, t in ipairs(tries) do
        if type(t[2]) ~= "function" then
            add("FORMAT", { { "kind", kind }, { "fn", t[1] }, { "present", false } })
        else
            local ok, result = pcall(t[2], value)
            if ok then
                add("FORMAT", { { "kind", kind }, { "fn", t[1] }, { "ok", true }, { "result", result }, { "type", type(result) }, { "secret", isSecret(result) } })
            else
                add("FORMAT", { { "kind", kind }, { "fn", t[1] }, { "ok", false }, { "error", result } })
            end
        end
    end
end

-- Whether a status bar takes the value: it is the display call the game allows for hidden numbers.
local function probeBar(value, kind)
    if not bar then
        local ok, made = pcall(CreateFrame, "StatusBar", nil, UIParent)
        if not ok then
            add("BAR", { { "kind", kind }, { "create", false }, { "error", made } })
            return
        end
        bar = made
        bar:Hide()
    end
    local fields = { { "kind", kind } }
    local ok1, err1 = pcall(bar.SetMinMaxValues, bar, 0, value)
    fields[#fields + 1] = { "SetMinMaxValues", ok1 }
    if not ok1 then
        fields[#fields + 1] = { "minMaxError", err1 }
    end
    local ok2, err2 = pcall(bar.SetValue, bar, value)
    fields[#fields + 1] = { "SetValue", ok2 }
    if not ok2 then
        fields[#fields + 1] = { "valueError", err2 }
    end
    add("BAR", fields)
end

local function onAbsorb(unit)
    local total = ask(UnitGetTotalAbsorbs, unit)
    local fields = { { "unit", unit }, { "total", total }, { "type", type(total) }, { "secret", isSecret(total) } }
    if type(canaccessvalue) == "function" then
        fields[#fields + 1] = { "canaccess", ask(canaccessvalue, total) }
    end
    add("UNIT_ABSORB_AMOUNT_CHANGED", fields)
    if type(total) == "number" then
        -- Twice a pull at most: the first secret value, and the first readable one that is not 0 (a 0
        -- before the shield lands must not use the slot). The comparison comes after the secret check.
        local kind = isSecret(total) and "secret" or total ~= 0 and "readable" or nil
        if kind and not probed[kind] then
            probed[kind] = true
            probeFormat(total, kind)
            probeBar(total, kind)
        end
    end
end

-- A table of numbers as text, each value readable or <secret>. Returns the text and whether any was secret.
local function pointsText(points)
    if isSecret(points) then
        return "<secret>", true
    end
    if type(points) ~= "table" then
        return show(points), false
    end
    local parts, anySecret = {}, false
    for i = 1, math.min(#points, MAX_POINTS) do
        local v = points[i]
        anySecret = anySecret or isSecret(v)
        parts[#parts + 1] = show(v)
    end
    return "{" .. table.concat(parts, ",") .. "}", anySecret
end

local function onAura(unit)
    local api = C_UnitAuras and C_UnitAuras.GetAuraDataByIndex
    if type(api) ~= "function" then
        return
    end
    local now = GetTime()
    for i = 1, MAX_AURAS do
        local ok, aura = pcall(api, unit, i, "HELPFUL")
        if not ok then
            add("UNIT_AURA", { { "unit", unit }, { "index", i }, { "error", aura } })
            return
        end
        if not isSecret(aura) and aura == nil then
            return
        end
        if isSecret(aura) then
            -- The table is hidden whole: there is no spell to key on, so the slot is.
            local key = unit .. ":secret:" .. i
            if seenAura[key] and now - seenAura[key] < Probe.AURA_GAP then
                throttled()
            else
                seenAura[key] = now
                add("UNIT_AURA", { { "unit", unit }, { "index", i }, { "auraSecret", true } })
            end
        elseif type(aura) == "table" then
            local spellId, name, points = aura.spellId, aura.name, aura.points
            local key = unit .. ":" .. (readable(spellId) and type(spellId) == "number" and spellId or ("secret:" .. i))
            if seenAura[key] and now - seenAura[key] < Probe.AURA_GAP then
                throttled()
            else
                seenAura[key] = now
                local text, anySecret = pointsText(points)
                add("UNIT_AURA", { { "unit", unit }, { "index", i }, { "auraSecret", false }, { "spellId", spellId }, { "name", name },
                    { "points", points, text, anySecret } })
            end
        end
    end
end

local function onCast(unit)
    if type(UnitCastingInfo) ~= "function" then
        return
    end
    local ok, name, _, _, startMs, endMs = pcall(UnitCastingInfo, unit)
    if not ok then
        add("UNIT_SPELLCAST_START", { { "unit", unit }, { "error", name } })
        return
    end
    local fields = { { "unit", unit }, { "name", name }, { "startTimeMs", startMs }, { "endTimeMs", endMs },
        { "endSecret", isSecret(endMs) } }
    if readable(startMs) and readable(endMs) and type(startMs) == "number" and type(endMs) == "number" then
        fields[#fields + 1] = { "castSeconds", (endMs - startMs) / 1000 }
    end
    add("UNIT_SPELLCAST_START", fields)
end

function Probe.HandleEvent(event, ...)
    if not CRT.db or not (store().on or follow) then
        return
    end
    local a1, a2, a3, a4, a5 = ...
    if event == "ENCOUNTER_START" then
        startPull(a1, a2, a3, a4)
        return
    end
    if not pulling then
        return
    end
    if event == "ENCOUNTER_END" then
        endPull(a1, a5)
        return
    end
    if isSecret(a1) then
        -- A hidden unit might be a boss: say so once per event, then leave it.
        if not seenSecretUnit[event] then
            seenSecretUnit[event] = true
            add(event, { { "unit", a1 } })
        end
        return
    end
    if type(a1) ~= "string" or not BOSS_UNITS[a1] then
        return
    end
    if event == "UNIT_ABSORB_AMOUNT_CHANGED" then
        onAbsorb(a1)
    elseif event == "UNIT_AURA" then
        onAura(a1)
    elseif event == "UNIT_SPELLCAST_START" and a1 == "boss1" then
        onCast(a1)
    end
end

local function listen(on)
    if not frame then
        frame = CreateFrame("Frame")
        frame:SetScript("OnEvent", function(_, event, ...)
            Probe.HandleEvent(event, ...)
        end)
    end
    frame:UnregisterAllEvents()
    pulling = false
    if on then
        frame:RegisterEvent("ENCOUNTER_START")
        frame:RegisterEvent("ENCOUNTER_END")
    end
end

function Probe:SetOn(on)
    store().on = on and true or false
    listen(on or follow)
    CRT:Print(on and "Absorb probe on: it logs the next boss pull. /crt dev absorbprobe show after it." or "Absorb probe off. The last log is kept.")
end

-- Boss debug on or off: listens while it or the probe's own switch is on. Prints nothing.
function Probe:Follow(on)
    follow = on and true or false
    listen(store().on or follow)
end

-- The whole log: a header, then one line per reading.
function Probe:Text()
    local last = store().last
    if not last then
        return nil
    end
    local when = date and last.started and date("%Y-%m-%d %H:%M", last.started) or "?"
    local result = last.success == 1 and "kill" or last.success == 0 and "wipe" or "not ended"
    local head = string.format('Absorb probe: encounter %s "%s", difficulty %s, pulled %s, %s, %s',
        tostring(last.encounterID or "?"), tostring(last.name or "?"), tostring(last.difficultyID or "?"), when,
        last.length and string.format("%.1f s", last.length) or "still going", result)
    return head .. "\n<secret> is a value the game hid; nil is a missing one. An aura is logged once per "
        .. Probe.AURA_GAP .. " s (" .. (last.throttled or 0) .. " repeats left out).\n" .. table.concat(last.lines, "\n")
end

-- One line per kind: how many came, and which fields were secret how often.
function Probe:Summary()
    local last = store().last
    local out = {}
    if not last then
        return out
    end
    local kinds = {}
    for k in pairs(last.counts) do
        kinds[#kinds + 1] = k
    end
    table.sort(kinds)
    for _, k in ipairs(kinds) do
        local c = last.counts[k]
        local names = {}
        for f in pairs(c.secret) do
            names[#names + 1] = f
        end
        table.sort(names)
        local parts = {}
        for _, f in ipairs(names) do
            parts[#parts + 1] = f .. " " .. c.secret[f]
        end
        out[#out + 1] = k .. ": " .. c.n .. (#parts > 0 and (" (secret: " .. table.concat(parts, ", ") .. ")") or " (all readable)")
    end
    return out
end

function Probe:Show()
    local text = self:Text()
    if not text then
        CRT:Print("The absorb probe has no log yet. Run /crt dev absorbprobe on, then pull a boss.")
        return
    end
    CRT:Print("Absorb probe, last pull:")
    for _, line in ipairs(self:Summary()) do
        CRT:Print("  " .. line)
    end
    CRT.ConsumablesTools:ShowText("Absorb probe log (Ctrl+C to copy, paste to Claude)", text)
end

-- Handles "dev absorbprobe [on|off|show]". Returns false for any other command.
function Probe:Command(msg)
    local rest = msg:match("^dev%s+absorbprobe%s*$") and "" or msg:match("^dev%s+absorbprobe%s+(.-)%s*$")
    if not rest then
        return false
    end
    if rest == "on" or rest == "off" then
        self:SetOn(rest == "on")
    elseif rest == "show" then
        self:Show()
    else
        local last = store().last
        CRT:Print("Absorb probe is " .. (store().on and "on" or "off") .. (last and (", with a log of " .. #last.lines .. " lines") or ", no log yet")
            .. ". /crt dev absorbprobe on, off or show.")
    end
    return true
end

-- On stays on through a /reload.
local login = CreateFrame("Frame")
login:RegisterEvent("PLAYER_LOGIN")
login:SetScript("OnEvent", function()
    if CRT.db and CRT.db.dev and CRT.db.dev.absorbProbe and CRT.db.dev.absorbProbe.on then
        listen(true)
    end
end)
