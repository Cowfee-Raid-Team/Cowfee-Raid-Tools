local ADDON, CRT = ...

-- DEVELOPER ONLY. Export on the Interrupts page's setup editor (Interrupts/SetupEditor.lua): the boss's kick setups in
-- use, every difficulty (your own saved ones in place of the shipped ones), as the boss file's interrupts block, to
-- paste into CRT_Data/Seasons/<season>/<Boss>.lua so the setup ships for everyone (the crt-season-data skill's "Kick
-- setups" says how). Save in the editor first: Export writes what is saved, not the fields being edited. A timed
-- setup's timing goes with it as it is.
--
-- This file never ships: its .toc line is inside the do-not-package block.

local Export = {}
CRT.KickSetupExport = Export

local INDENT = "    "

local function value(v)
    if type(v) == "string" then
        return string.format("%q", v)
    end
    return tostring(v)
end

-- A plain table (the timing) on one line: its list part in order, then its other keys sorted.
local function inline(t)
    if type(t) ~= "table" then
        return value(t)
    end
    local parts = {}
    for _, v in ipairs(t) do
        parts[#parts + 1] = inline(v)
    end
    local keys = {}
    for k in pairs(t) do
        if type(k) == "string" then
            keys[#keys + 1] = k
        end
    end
    table.sort(keys)
    for _, k in ipairs(keys) do
        parts[#parts + 1] = k .. " = " .. inline(t[k])
    end
    if #parts == 0 then
        return "{}"
    end
    return "{ " .. table.concat(parts, ", ") .. " }"
end

local TIMING_ORDER = { "anchor", "firstCast", "spacing", "tolerance", "adds", "perNumber", "window" }

-- The interrupts block for a list of setups (Interrupts:Setups), as the boss file writes it.
function Export.Text(setups)
    local out = { INDENT .. "interrupts = {" }
    local function line(depth, text)
        out[#out + 1] = string.rep(INDENT, depth) .. text
    end
    for _, s in ipairs(setups or {}) do
        line(2, "{")
        line(3, "difficulty = " .. s.difficulty .. ",")
        line(3, "label = " .. value(s.label or "Kick") .. ",")
        if s.spell and (s.spell.name or s.spell.spellID) then
            local parts = {}
            if s.spell.name then
                parts[#parts + 1] = "name = " .. value(s.spell.name)
            end
            if s.spell.spellID then
                parts[#parts + 1] = "spellID = " .. s.spell.spellID
            end
            line(3, "spell = { " .. table.concat(parts, ", ") .. " },"
                .. (s.spell.spellID and "" or " -- TODO id: Journal Export Abilities or /crt dev kicks"))
        end
        line(3, "groups = {")
        for _, g in ipairs(s.groups) do
            local marker = g.marker and (", marker = " .. g.marker) or ""
            line(4, string.format("{ key = %s, label = %s%s, slots = %d },", value(g.key), value(g.label), marker, g.slots))
        end
        line(3, "},")
        if s.timing then
            line(3, "timing = {")
            for _, k in ipairs(TIMING_ORDER) do
                if s.timing[k] ~= nil then
                    line(4, k .. " = " .. inline(s.timing[k]) .. ",")
                end
            end
            line(3, "},")
        end
        if s.note then
            line(3, "note = " .. value(s.note) .. ",")
        end
        line(2, "},")
    end
    line(1, "},")
    return table.concat(out, "\n")
end

-- The export of a boss's setups in use, with a head line naming the boss.
function Export.ForBoss(encounterID)
    local setups = CRT.Interrupts:Setups(encounterID)
    if #setups == 0 then
        return nil
    end
    return Export.Text(setups)
end

local Editor = CRT.InterruptSetupEditor
if Editor and Editor.AddDevButton then
    Editor:AddDevButton("Export", function(ed)
        local d = ed.Draft()
        local text = d and d.boss and Export.ForBoss(d.boss)
        if not text then
            CRT:Print("This boss has no kick setup to export. Save one first.")
            return
        end
        CRT.ConsumablesTools:ShowText("Kick setups for " .. CRT.Interrupts:BossName(d.boss) .. " (Ctrl+C, paste into the boss file)", text)
    end)
end
