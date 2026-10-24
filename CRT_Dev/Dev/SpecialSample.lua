local ADDON, CRT = ...

-- Developer builds only: /crt dev special adds a sample special alert (Alerts/Special.lua) to the boss shown
-- on Raid Notes > Mech Alerts, so its Special list, panel and Test can be tried before any boss file has one.
-- It lives in CRT.AlertSpecial.dev, never in the saved data, so a /reload takes it away; /crt dev special off
-- takes it away at once. It times itself on a row of the boss's ability timeline with at least two casts
-- (the first such row), else on typed times.

local Dev = {}
CRT.SpecialSampleDev = Dev

local TEXT = {
    noBoss = "No boss to add the sample to. Open Raid Notes > Mech Alerts and pick one.",
    added = "Added a sample special alert to %s: Raid Notes > Mech Alerts > Special. A /reload takes it away.",
    removed = "Took the sample special alert off %s.",
    label = "Sample: soak rotation",
    help = "A developer sample: groups 1 and 2 soak the first cast, groups 3 and 4 the next, and so on.",
}

local SAMPLE_TIMES = "P1 0:20, 0:50, 1:20, 1:50"

-- The first row of the boss's first ability timeline with two casts or more, or nil.
local function sampleRow(encounterID, name)
    local Ref = CRT.TimelineReference
    local ok, found = pcall(Ref.ForBoss, Ref, encounterID, name)
    local entry = ok and type(found) == "table" and found[1]
    for _, row in ipairs(entry and entry.ref.rows or {}) do
        if type(row.name) == "string" and type(row.casts) == "table" and #row.casts >= 2 then
            return row.name
        end
    end
    return nil
end

function Dev:Command(msg)
    if msg ~= "dev special" and msg ~= "dev special off" then
        return false
    end
    local S, Notes = CRT.AlertSpecial, CRT.NoteReminders
    local enc = S and Notes and Notes.Boss and Notes.Boss()
    local def = enc and CRT.Bosses:Get(enc)
    if not def then
        CRT:Print(TEXT.noBoss)
        return true
    end
    if msg == "dev special off" then
        S.dev[enc] = nil
        CRT.Alerts:Fire() -- Mech Alerts draws again
        CRT:Print(string.format(TEXT.removed, def.name))
        return true
    end
    local row = sampleRow(enc, def.name)
    S.dev[enc] = { {
        key = "devSample",
        label = TEXT.label,
        help = TEXT.help,
        type = "soak",
        when = row and { row = row } or { times = SAMPLE_TIMES },
        lead = 5,
        who = { mode = "rotation", rotation = { { 1, 2 }, { 3, 4 } } },
        text = "Soak now: {group}",
        show = { callout = true, bar = true, text = true, speech = true },
        markers = { marks = { "star", "circle" }, on = "who" },
    } }
    CRT.Alerts:Fire()
    CRT:Print(string.format(TEXT.added, def.name))
    return true
end
