local ADDON, CRT = ...

-- The speech queue: every block's spoken lines play one at a time through the game's text to speech.
-- A line plays until the game says it finished (or SPEECH_TIMEOUT seconds pass), then the next starts.
-- When the queue falls behind, the lowest priority line is dropped first: raid-wide lines go first,
-- your note lines are kept longer, and your reminders are kept longest. Speech plays only while the
-- Raid Notes "Read them out" switch (notes.alert.tts) is on, for every block. A line's sound cue plays once
-- at zero, whatever that switch says; a raid note line's sound only while it is on, like its speech, and
-- whether or not the note callout is on (ruling B2).
-- In a rehearsal run the queue ticks on the engine's time (Alerts:Now()), and speech plays only at 1x: a
-- change away from 1x stops what is being said and drops the queue, and lines that come due at 2x or 4x
-- are never said. What was queued at 1x stays while the speed stays 1x. Sound cues play at any speed.
-- Both go through the sound engine (Sound/Engine.lua): a cue is any sound reference, and a line is said
-- with CRT.Sound:Speak at the Raid Notes rate and volume.
-- A cue plays at its exact moment, not at the next tick: once it is within CUE_AHEAD of zero, the tick schedules
-- it with C_Timer.After for the real seconds left (engine seconds over the rehearsal's speed). When the timer
-- comes, the cue plays if it is still in this run's lines and due (within CUE_EARLY); a stop, a new run or the
-- line going away leaves it unplayed, and one that isn't due yet (a paused or jumped rehearsal) is scheduled
-- again by a later tick. A cue no timer played is still played by the tick that finds it due. Each plays once
-- (its key in `spoken`), never waits for speech, and the displays that registered with OnZero redraw as it
-- plays, so their 0 is the same moment (Rules.Countdown). OnTiming hooks (a dev probe) hear each cue and
-- each line said.
-- C_Timer.After (warcraft.wiki.gg): the callback runs in the first frame its time has passed.

local Rules = CRT.AlertRules
local Alerts = CRT.Alerts

local TICK = 0.1
local SOUND_LATE = 1  -- a sound whose time passed more than this many seconds ago is not played
local CUE_AHEAD = 2 * TICK -- a cue this many real seconds from zero is scheduled: the next tick may come a slow frame after TICK
local CUE_EARLY = 0.005    -- a timer this close before the cue's time plays it (the frame clock's rounding)

local NOTICE = {
    speech = "Raid Notes: your note lines are now read out even with the note callout off. Untick 'Read them out' on Raid Notes > Alert Settings to stop it.",
}

local Speech = {
    queue = {},     -- items waiting, oldest first
    spoken = {},    -- keys Rules.SpeechDue has already handled, and "<id>#sound" for each cue played or passed
    pending = {},   -- [cue key] = the token of the timer scheduled for it
    zero = {},      -- functions called the moment a cue plays (OnZero)
    timing = {},    -- functions (kind, info) told of each cue and each line said (OnTiming)
    playing = false,
    playingUntil = 0,
    runId = nil,
    speed = 1,      -- the rehearsal speed at the last tick (1 outside a rehearsal)
}
CRT.AlertSpeech = Speech

-- Note lines used to be read out only with the note callout on (ruling B2 changed that). A save with
-- the alert off and the speech on is told once, on login; the flag keeps it to once per profile.
function Speech:SpeechNotice()
    local db = CRT.db
    local alert = db and db.notes and db.notes.alert
    local alerts = db and db.alerts
    if not (alert and alerts) or alerts.speechNotice then
        return false
    end
    if alert.enabled == false and alert.tts ~= false then
        alerts.speechNotice = true
        CRT:Print(NOTICE.speech)
        return true
    end
    return false
end

local function settings()
    local notes = CRT.db and CRT.db.notes
    return notes and notes.alert or {}
end

-- Speaks now, outside the queue (the Test speech button uses this), at the Raid Notes rate and volume.
function Speech:SpeakNow(text)
    local s = settings()
    local ok, why = CRT.Sound:Speak(text, { rate = s.ttsRate or 0, volume = s.ttsVolume or 100 })
    if not ok and why then
        CRT:Print(why)
    end
end

-- A new run: nothing from the last one is waiting or marked.
function Speech:Reset()
    wipe(self.queue)
    wipe(self.spoken)
    wipe(self.pending) -- a timer still coming finds its token gone and plays nothing
    self.playing = false
    self.playingUntil = 0
end

-- Stops what is being said now and drops the queue.
function Speech:Hush()
    CRT.Sound:StopSpeaking()
    wipe(self.queue)
    self.playing = false
    self.playingUntil = 0
end

-- Oldest first; at the same time the higher priority goes first, then arrival order.
local function before(a, b)
    if a.at ~= b.at then return a.at < b.at end
    if (a.priority or 0) ~= (b.priority or 0) then return (a.priority or 0) > (b.priority or 0) end
    return a.seq < b.seq
end

local arrivals = 0

-- Hooks: fn() the moment a cue plays (the displays redraw); fn(kind, info) for each cue ("cue": key, at, now,
-- how = "timer" or "tick", played, speed) and each line said ("speech": text, at, now, real).
function Speech:OnZero(fn)
    self.zero[#self.zero + 1] = fn
end

function Speech:OnTiming(fn)
    self.timing[#self.timing + 1] = fn
end

local function tell(self, kind, info)
    for _, fn in ipairs(self.timing) do
        pcall(fn, kind, info)
    end
end

local function cueKey(member)
    return tostring(member.id) .. "#sound"
end

-- A member's cue, with its time, when it has one that may play: a raid note line's only with speech on.
local function cueOf(line, member)
    if not member.sound or (member.block == "note" and not settings().tts) then
        return nil
    end
    return member.at or line.at
end

-- Plays a cue now, once; past SOUND_LATE it is only marked. Then the displays redraw.
local function playCue(self, member, at, now, how)
    self.spoken[cueKey(member)] = true
    self.pending[cueKey(member)] = nil
    local late = now - at > SOUND_LATE
    if not late then
        CRT.Sound:Play(member.sound) -- any reference; an old bare name is a game sound
    end
    for _, fn in ipairs(self.zero) do
        local ok, err = pcall(fn)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
    if #self.timing > 0 then
        tell(self, "cue", { key = cueKey(member), at = at, now = now, how = how, played = not late,
            speed = Alerts.RehearsalSpeed and Alerts:RehearsalSpeed() or 1 })
    end
end

-- The engine's time (the rehearsal's clock in one), or GetTime() without it.
local function engineNow()
    return Alerts and Alerts.Now and Alerts:Now() or GetTime()
end

-- A scheduled cue's timer: it plays if it is still this run's, still in the lines and due.
local function fireCue(key, token, runId)
    local self = Speech
    if self.pending[key] ~= token then
        return -- reset or played since
    end
    self.pending[key] = nil
    if not Alerts.running or Alerts.runId ~= runId or self.runId ~= runId or self.spoken[key] then
        return
    end
    local now = engineNow()
    for _, line in ipairs(Alerts:Lines(now)) do
        for _, member in ipairs(line.members or { line }) do
            if cueKey(member) == key then
                local at = cueOf(line, member)
                if at and at - now <= CUE_EARLY then
                    playCue(self, member, at, now, "timer")
                end
                return -- not due yet: a later tick schedules it again
            end
        end
    end
end

local tokens = 0

-- Sound cues: each member plays its own, once, keyed like speech so a changing line never replays one. A cue
-- due now plays; one within CUE_AHEAD of its time is scheduled for it.
local function cues(self, lines, now)
    local after = C_Timer and C_Timer.After
    local speed
    for _, line in ipairs(lines) do
        for _, member in ipairs(line.members or { line }) do
            local at = cueOf(line, member)
            local key = at and cueKey(member)
            if key and not self.spoken[key] then
                if at <= now then
                    playCue(self, member, at, now, "tick")
                elseif after and not self.pending[key] then
                    -- real seconds: the ticks come every TICK real seconds at any speed
                    speed = speed or (Alerts.RehearsalSpeed and Alerts:RehearsalSpeed() or 1)
                    local wait = (at - now) / speed
                    if wait <= CUE_AHEAD then
                        tokens = tokens + 1
                        local token, runId = tokens, self.runId
                        self.pending[key] = token
                        after(wait, function()
                            fireCue(key, token, runId)
                        end)
                    end
                end
            end
        end
    end
end

function Speech:Tick(now)
    if not Alerts.running then
        if #self.queue > 0 or next(self.spoken) or next(self.pending) then
            self:Reset()
        end
        self.runId = nil
        return
    end
    if self.runId ~= Alerts.runId then
        self:Reset()
        self.runId = Alerts.runId
    end
    local lines = Alerts:Lines(now)
    cues(self, lines, now)

    -- A rehearsal off 1x says nothing; the lines coming due are marked so they are never said late.
    local speed = Alerts.RehearsalSpeed and Alerts:RehearsalSpeed() or 1
    if speed ~= 1 then
        if self.speed == 1 then
            self:Hush()
        end
        self.speed = speed
        Rules.SpeechDue(lines, now, self.spoken)
        return
    end
    self.speed = 1

    if not settings().tts then
        return
    end

    local due = Rules.SpeechDue(lines, now, self.spoken)
    if #due > 0 then
        for _, item in ipairs(due) do
            -- An empty or unreadable text is skipped.
            local text = item.text
            local readable = not (CRT.Timeline and CRT.Timeline.readable) or CRT.Timeline.readable(text)
            if readable and type(text) == "string" and text ~= "" then
                arrivals = arrivals + 1
                item.seq = arrivals
                item.text = text
                self.queue[#self.queue + 1] = item
            end
        end
        table.sort(self.queue, before)
    end
    Rules.Behind(self.queue, now)

    -- The speaker's timeout is real time, which the rehearsal's clock is not.
    local real = (Alerts.IsRehearsal and Alerts:IsRehearsal()) and GetTime() or now
    if self.playing and real >= self.playingUntil then
        self.playing = false
    end
    if not self.playing and self.queue[1] then
        local item = table.remove(self.queue, 1)
        self.playing = true
        self.playingUntil = real + Rules.SPEECH_TIMEOUT
        self:SpeakNow(item.text or "")
        if #self.timing > 0 then
            tell(self, "speech", { text = item.text, at = item.at, now = now, real = real })
        end
    end
end

local elapsed = 0
local driver = CreateFrame("Frame")
driver:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed < TICK then
        return
    end
    elapsed = 0
    if Alerts.running or #Speech.queue > 0 then
        Speech:Tick(engineNow())
    end
end)

-- Only the event itself matters: the speaker is free again. If this client does not know the event,
-- the timeout above keeps the queue moving.
-- This event can fire for any game speech, not only ours, so the timeout is the real guard.
driver:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_LOGIN" then
        Speech:SpeechNotice()
        return
    end
    Speech.playing = false
    if Alerts.running then
        Speech:Tick(engineNow())
    end
end)
pcall(driver.RegisterEvent, driver, "VOICE_CHAT_TTS_PLAYBACK_FINISHED")
driver:RegisterEvent("PLAYER_LOGIN")
