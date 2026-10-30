local ADDON, CRT = ...

-- DEVELOPER ONLY. /crt dev kicks perf: times the Interrupts page (Interrupts/Page.lua). While it is on, each time the
-- page shows it prints how long the show took, then (a second later) how many refreshes ran since, how long each took,
-- and how often the group, the Raid Groups layouts and the note were read (Page.counts). /crt dev kicks perf again turns
-- it off. Game calls (warcraft.wiki.gg, read 2026-10-29): debugprofilestop() -> milliseconds, C_Timer.After.

local Perf = { on = false }
CRT.KickPerf = Perf

local REPORT_AFTER = 1 -- seconds after a show: its refreshes, and the Addon check's first answers, are in by then

local function page()
    return CRT.InterruptsPage
end

local function snapshot()
    local c = page().counts or {}
    return { roster = c.roster or 0, layouts = c.layouts or 0, refresh = c.refresh or 0, note = c.note or 0 }
end

local run -- the show being timed: { show = ms, refreshes = { ms } }
local base -- the counts at the last print (or when the probe was turned on): a print counts the work since

local function report()
    if not run then
        return
    end
    local now, from = snapshot(), base
    local times = {}
    for _, ms in ipairs(run.refreshes) do
        times[#times + 1] = string.format("%.1f", ms)
    end
    CRT:Print(string.format("Interrupts page: show %.1f ms; %d refreshes (%s ms); %d group reads, %d layout reads, %d note reads.",
        run.show or 0, #run.refreshes, table.concat(times, ", "), now.roster - from.roster, now.layouts - from.layouts,
        now.note - from.note))
    run, base = nil, now
end

-- A run starts with its first refresh (a show draws once before it is told it showed) and is printed a second later.
local function listen(what, ms)
    if not run then
        run = { refreshes = {} }
        C_Timer.After(REPORT_AFTER, report)
    end
    if what == "show" then
        run.show = ms
    elseif what == "refresh" then
        run.refreshes[#run.refreshes + 1] = ms
    end
end

function Perf:SetOn(on)
    self.on = on and true or false
    run, base = nil, snapshot()
    page().perf = self.on and listen or nil
    CRT:Print(self.on and "Kick perf on: switch to Interrupts, and each show prints its times. /crt dev kicks perf again turns it off."
        or "Kick perf off.")
end

-- Handles "dev kicks perf". Returns false for any other command.
function Perf:Command(msg)
    if not msg:match("^dev%s+kicks%s+perf%s*$") then
        return false
    end
    if not page() then
        CRT:Print("The Interrupts page isn't loaded.")
        return true
    end
    self:SetOn(not self.on)
    return true
end
