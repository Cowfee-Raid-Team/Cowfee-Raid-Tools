local ADDON, CRT = ...

-- DEVELOPER ONLY. Measures how a sound cue lines up with its alert's zero. /crt dev soundtiming starts a fresh log
-- and logs every alert run (a rehearsal, an editor Test, a pull) until /crt dev soundtiming off; /crt dev soundtiming
-- show opens the log to copy. Each line starts with the real milliseconds since the run started (debugprofilestop,
-- finer than a frame), then the fight seconds, then what happened:
--   [  5031.2]   5.000 cue mine:7:1#sound played +3 ms after 0 (timer, 1x)
--   [  5031.4]   5.000 texts shows 0 for mine:7:1, +3 ms after 0
--   [  5040.0]   5.000 said "Soak": started +12 ms after its time
-- "timer" is a cue its scheduled timer played, "tick" one the 0.1 s tick played (no timer came in time). The ms after
-- 0 are on the game's frame clock (GetTime, or the rehearsal's clock), so they move in whole frames: the header gives
-- the frame rate. At 2x or 4x they are fight ms; the real ms are in brackets after. Saved in CRTDB.dev.soundTiming:
-- on, started (time()) and lines. Game calls (warcraft.wiki.gg, read 2026-10-31): debugprofilestop() (ms since
-- profiling started, high precision), GetFramerate() (frames per second).
--
-- This file never ships: its .toc line is inside the do-not-package block.

local Probe = {}
CRT.SoundTimingProbe = Probe

Probe.MAX_LINES = 2000

local Alerts, Rules, Speech = CRT.Alerts, CRT.AlertRules, CRT.AlertSpeech

local runId       -- the run the log last headed
local runReal     -- debugprofilestop() when that run started
local shown = {}  -- [display .. "|" .. line id] = true once its first 0 is logged, this run

local function store()
    CRT.db.dev = CRT.db.dev or {}
    CRT.db.dev.soundTiming = CRT.db.dev.soundTiming or { on = false }
    return CRT.db.dev.soundTiming
end

local function on()
    return CRT.db ~= nil and store().on == true
end

local function realMs()
    local ok, ms = pcall(debugprofilestop)
    return ok and type(ms) == "number" and ms or 0
end

local function fps()
    local ok, f = pcall(GetFramerate)
    return ok and type(f) == "number" and f or 0
end

local function speed()
    return Alerts.RehearsalSpeed and Alerts:RehearsalSpeed() or 1
end

local function add(text)
    local s = store()
    s.lines = s.lines or {}
    if #s.lines >= Probe.MAX_LINES then
        s.dropped = (s.dropped or 0) + 1
        return
    end
    s.lines[#s.lines + 1] = text
end

-- A new run gets a header the first time anything of it is logged.
local function head()
    if runId == Alerts.runId then
        return
    end
    runId, runReal = Alerts.runId, realMs()
    wipe(shown)
    local run = Alerts.run
    add(string.format("-- run %d: %s, encounter %s, %sx, %.0f fps (a frame is about %.0f ms)", runId,
        tostring(run and run.reason or "?"), tostring(run and run.encounterID or "-"), tostring(speed()), fps(),
        fps() > 0 and 1000 / fps() or 0))
end

-- seconds into the fight of an engine time
local function fight(at)
    local first = Alerts.run and Alerts.run.firstAt
    return first and (at - first) or 0
end

-- "+12 ms", with the real ms after it off 1x
function Probe.Gap(seconds, rate)
    local ms = seconds * 1000
    if math.abs(ms) < 0.5 then
        ms = 0 -- never "-0 ms"
    end
    local text = string.format("%+.0f ms", ms)
    if rate and rate ~= 1 and rate > 0 then
        text = text .. string.format(" (%+.0f ms real)", ms / rate)
    end
    return text
end

local function line(at, what)
    head()
    add(string.format("[%8.1f] %7.3f %s", realMs() - runReal, fight(at), what))
end

local function readable(text)
    if issecretvalue and issecretvalue(text) then
        return "(secret)"
    end
    return tostring(text)
end

-- What the speech queue tells (Alerts/Speech.lua OnTiming).
function Probe.OnTiming(kind, info)
    if not on() or not Alerts.running then
        return
    end
    if kind == "cue" then
        line(info.at, string.format("cue %s %s %s after 0 (%s, %sx)", tostring(info.key),
            info.played and "played" or "not played (over a second late):", Probe.Gap(info.now - info.at, info.speed),
            tostring(info.how), tostring(info.speed)))
    elseif kind == "speech" then
        line(info.at, string.format("said \"%s\": started %s after its time", readable(info.text),
            Probe.Gap(info.now - info.at, speed())))
    end
end

-- A display drawing a line's 0 (Rules.Countdown); the first time per display, line and moment in a run. `at` is
-- the moment it counted to when that isn't the line's (a bar counting to each impact).
function Probe.ZeroShown(display, l, remaining, at)
    if not on() or not Alerts.running or type(remaining) ~= "number" or type(l) ~= "table" then
        return
    end
    at = type(at) == "number" and at or l.at
    if type(at) ~= "number" then
        return
    end
    head()
    local key = tostring(display) .. "|" .. tostring(l.id) .. "|" .. tostring(at)
    if shown[key] then
        return
    end
    shown[key] = true
    line(at, string.format("%s shows 0 for %s, %s after 0", tostring(display), tostring(l.id), Probe.Gap(-remaining, speed())))
end

if Speech and Speech.OnTiming then
    Speech:OnTiming(Probe.OnTiming)
end
if Rules then
    Rules.zeroShown = Probe.ZeroShown
end

function Probe:SetOn(value)
    local s = store()
    s.on = value and true or false
    if value then
        s.lines, s.dropped, s.started = {}, nil, time and time() or nil
        runId = nil
        CRT:Print("Sound timing probe on, with a fresh log: rehearse a boss or Test an alert with a sound, then /crt dev soundtiming show.")
    else
        CRT:Print("Sound timing probe off. The log is kept.")
    end
end

function Probe:Text()
    local s = store()
    if not s.lines or #s.lines == 0 then
        return nil
    end
    local when = date and s.started and date("%Y-%m-%d %H:%M", s.started) or "?"
    local text = "Sound timing probe, started " .. when .. "\n" .. table.concat(s.lines, "\n")
    if s.dropped then
        text = text .. "\n... " .. s.dropped .. " more lines dropped (the log keeps " .. Probe.MAX_LINES .. ")"
    end
    return text
end

function Probe:Show()
    local text = self:Text()
    if not text then
        CRT:Print("The sound timing probe has no log yet. Run /crt dev soundtiming, then rehearse a boss or Test an alert.")
        return
    end
    CRT.ConsumablesTools:ShowText("Sound timing log (Ctrl+C to copy, paste to Claude)", text)
end

-- Handles "dev soundtiming [off|show]". Returns false for any other command.
function Probe:Command(msg)
    local rest = msg:match("^dev%s+soundtiming%s*$") and "" or msg:match("^dev%s+soundtiming%s+(.-)%s*$")
    if not rest then
        return false
    end
    if rest == "" or rest == "on" then
        self:SetOn(true)
    elseif rest == "off" then
        self:SetOn(false)
    elseif rest == "show" then
        self:Show()
    else
        CRT:Print("/crt dev soundtiming (a fresh log), off, or show.")
    end
    return true
end
