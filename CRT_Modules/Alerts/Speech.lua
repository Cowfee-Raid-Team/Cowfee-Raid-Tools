local ADDON, CRT = ...

-- The speech queue: every block's spoken lines play one at a time through the game's text to speech.
-- A line plays until the game says it finished (or SPEECH_TIMEOUT seconds pass), then the next starts.
-- When the queue falls behind, the lowest priority line is dropped first: raid-wide lines go first,
-- your note lines are kept longer, and your reminders are kept longest. The Raid Notes "Read them out" switch
-- (notes.alert.tts) keeps quiet only a raid note's plain lines, which have no speech setting of their own
-- (readOutOnly): an alert's own Speak the text or Count down always speaks, and so does a note line with its own
-- tts: or count: (Alex, 2026-11-01). A line's sound cue plays once at zero; a plain note line's only while the
-- switch is on, like its speech, and whether or not the note callout is on (ruling B2).
-- In a rehearsal run the queue ticks on the engine's time (Alerts:Now()), and speech plays only at 1x: a
-- change away from 1x stops what is being said and drops the queue, and lines that come due at 2x or 4x
-- are never said. What was queued at 1x stays while the speed stays 1x. Sound cues play at any speed.
-- Both go through the sound engine (Sound/Engine.lua): a cue is any sound reference, and a line is said
-- with CRT.Sound:Speak at the Raid Notes rate and volume. A line the chosen voice has a clip for plays the clip
-- (Sound/Voices.lua); no finished event comes for a clip, so the next line waits the clip's own length. While a clip
-- plays, the game's speech-finished event frees nothing: it is for an earlier spoken line, or not ours.
-- A count says one number on each second (Alex, 2026-11-01, #1244): each number is its own line, due on its second.
-- A spoken line never holds a number (the number starts on its second); a clip holds it at most for the clip's own
-- length, and a number that can't start within NUMBER_LATE of its second is dropped rather than said late, so the
-- rhythm stays clean. The number clips are under a second (1.4x), so they never run into each other. With Count down
-- on, the text comes after "1" (Rules.SpeechItems marks it afterCount, due at 0): it starts the moment "1" ends and
-- not before 0; after a spoken "1" the game's finished event runs it.
-- Every line starts at its exact moment, not at the next tick: when the next line's start (its own time, and the
-- moment the speaker frees for it: a clip's end, a count's next number) is within CUE_AHEAD, a timer (wake) runs
-- the tick then.
-- A cue plays at its exact moment, not at the next tick: once it is within CUE_AHEAD of zero, the tick schedules
-- it with C_Timer.After for the real seconds left (engine seconds over the rehearsal's speed). When the timer
-- comes, the cue plays if it is still in this run's lines and due (within Rules.ZERO_EPSILON, the tolerance the
-- displays draw 0 in); a stop, a new run or the line going away leaves it unplayed. A timer that came early (a
-- rehearsal seek or a slower speed) is scheduled again once for the time left while the clock plays; a paused
-- one waits for a later tick, and a speed change makes the next tick schedule it again. A cue no timer played is
-- still played by the tick that finds it due. Each plays once (its key in `spoken`), never waits for speech, and
-- the displays that registered with OnZero redraw as it plays, at most once a frame, so their 0 is the same
-- moment (Rules.Countdown). OnTiming hooks (a dev probe) hear each cue and each line said.
-- C_Timer.After (warcraft.wiki.gg): the callback runs in the first frame its time has passed.

local Rules = CRT.AlertRules
local Alerts = CRT.Alerts

local TICK = 0.1
local SOUND_LATE = 1  -- a sound whose time passed more than this many seconds ago is not played
local CUE_AHEAD = 2 * TICK -- a cue this many real seconds from zero is scheduled: the next tick may come a slow frame after TICK
local CUE_EARLY = Rules.ZERO_EPSILON -- a cue this close before its time plays: the tolerance the displays draw 0 in
local CLIP_HOLD = 1 -- seconds a clip of unknown length holds the queue
-- A count's number that can't start within this many seconds of its own second (a clip before it still playing) is
-- dropped, not said late: a quarter second late still sounds on the beat, later breaks the count's rhythm.
local NUMBER_LATE = 0.25
local WAKE_LATE = 0.001 -- a wake timer comes this much after its moment, so the moment has surely passed

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
    clip = false,     -- whether the line being said is a voice clip, which no finished event ends
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

-- Whether "Read them out" (notes.alert.tts) keeps a line quiet: only a raid note's plain line, from the note
-- block with no speech setting of its own (own: its tts: or count: field, Notes/Engine.lua ownSpeech). An alert's
-- own Speak the text or Count down, and a note line with its own, always speak (Alex, 2026-11-01). The one rule for
-- the speech and the sound cue.
local function readOutOnly(block, own)
    return block == "note" and not own and not settings().tts
end

-- Speaks now, outside the queue (the Test speech button uses this), at the Raid Notes rate and volume.
-- Returns what Sound:Speak did: true, or true, "clip" and its seconds when a voice clip said it.
function Speech:SpeakNow(text)
    local s = settings()
    local ok, why, seconds = CRT.Sound:Speak(text, { rate = s.ttsRate or 0, volume = s.ttsVolume or 100 })
    if not ok and why then
        CRT:Print(why)
    end
    return ok, why, seconds
end

-- A new run: nothing from the last one is waiting or marked.
function Speech:Reset()
    wipe(self.queue)
    wipe(self.spoken)
    wipe(self.pending) -- a timer still coming finds its token gone and plays nothing
    self.playing = false
    self.playingUntil = 0
    self.clip = false
    self.wakeAt = nil -- a wake timer still coming finds the run gone and does nothing
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

-- A line that is only a whole number (a count's), as that number; nil for anything else or a secret text.
local function numberOf(text)
    if type(text) ~= "string" or (issecretvalue and issecretvalue(text)) or not text:match("^%s*%d+%s*$") then
        return nil
    end
    return tonumber(text)
end

-- Hooks: fn() the moment a cue plays (the displays redraw); fn(kind, info) for each cue ("cue": key, at, now,
-- how = "timer" or "tick", played, speed) and each line said ("speech": text, at, now, real, clip).
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

-- A member's cue, with its time, when it has one that may play: a raid note's plain line's only with Read them out on.
local function cueOf(line, member)
    if not member.sound or readOutOnly(member.block, member.ownSpeech) then
        return nil
    end
    return member.at or line.at
end

local zeroFrame -- GetTime() of the frame the displays last redrew for a cue: at most once a frame

-- The displays redraw (OnZero), once a frame however many cues play in it: every cue playing in this frame is due
-- by its clock, so one redraw draws all their 0s.
local function redraw(self)
    local frame = GetTime()
    if zeroFrame == frame then
        return
    end
    zeroFrame = frame
    for _, fn in ipairs(self.zero) do
        local ok, err = pcall(fn)
        if not ok and geterrorhandler then
            geterrorhandler()(err)
        end
    end
end

-- Plays a cue now, once, and the displays redraw; past SOUND_LATE it is only marked, and nothing redraws.
local function playCue(self, member, at, now, how)
    self.spoken[cueKey(member)] = true
    self.pending[cueKey(member)] = nil
    local late = now - at > SOUND_LATE
    if not late then
        CRT.Sound:Play(member.sound) -- any reference; an old bare name is a game sound
        redraw(self)
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

local function speedNow()
    return Alerts.RehearsalSpeed and Alerts:RehearsalSpeed() or 1
end

-- Whether the clock moves: always outside a rehearsal, not while one is paused.
local function clockPlays()
    if not (Alerts.IsRehearsal and Alerts:IsRehearsal() and Alerts.RehearsalTick) then
        return true
    end
    return not Alerts:RehearsalTick()
end

local tokens = 0
local fireCue

-- The real moment a line due at `at` (engine time) with `text` can start: its own time, and while something plays,
-- the moment Tick frees the speaker for it: a clip's end, or for a count's number its own second (a spoken line never
-- holds a number). Nil while a spoken line plays that only the game's finished event (or the timeout) frees.
local function startsAt(self, at, text, now, real)
    local from = real + math.max(0, at - now)
    if not self.playing then
        return from
    end
    if self.clip then
        return math.max(from, self.playingUntil)
    end
    return numberOf(text) and from or nil
end

-- A line starts at its moment, not at the next tick: when the queue's head (or, with none, the next line coming due)
-- can start within CUE_AHEAD, a timer runs the tick then. A spoken line ends with the game's finished event, which
-- runs the tick itself. One timer per moment; a new run drops it. While a rehearsal is paused no line's time comes,
-- so only a line already waiting is woken for.
local function wake(self, lines, now, real)
    local head = self.queue[1]
    local due
    if head then
        due = startsAt(self, head.at, head.text, now, real)
    elseif clockPlays() then
        local at, text = Rules.NextSpeech(lines, now, self.spoken)
        if at then
            due = startsAt(self, at, text, now, real)
        end
    end
    if not (due and due - real <= CUE_AHEAD and C_Timer and C_Timer.After) then
        return
    end
    local wait = math.max(0, due - real)
    if self.wakeAt and math.abs(self.wakeAt - due) < WAKE_LATE then
        return
    end
    self.wakeAt = due
    local runId = self.runId
    C_Timer.After(wait + WAKE_LATE, function()
        if Speech.wakeAt == due then
            Speech.wakeAt = nil
        end
        if Alerts.running and Alerts.runId == runId and Speech.runId == runId then
            Speech:Tick(engineNow())
        end
    end)
end

-- Schedules a cue's timer for `wait` real seconds; again marks the one second try (see fireCue).
local function arm(self, key, wait, speed, again)
    tokens = tokens + 1
    local token, runId = tokens, self.runId
    self.pending[key] = { token = token, speed = speed, again = again }
    C_Timer.After(wait, function()
        fireCue(key, token, runId)
    end)
end

-- A scheduled cue's timer: it plays if it is still this run's, still in the lines and due (within the shared
-- tolerance, Rules.ZERO_EPSILON). One that came earlier than that (a rehearsal seek or a slower speed) is
-- scheduled again once for the time left while the clock plays; otherwise a later tick schedules it again.
function fireCue(key, token, runId)
    local self = Speech
    local p = self.pending[key]
    if not p or p.token ~= token then
        return -- reset, played or scheduled again since
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
                elseif at and not p.again and clockPlays() then
                    local speed = speedNow()
                    arm(self, key, (at - now) / speed, speed, true)
                end
                return
            end
        end
    end
end

-- Sound cues: each member plays its own, once, keyed like speech so a changing line never replays one. A cue
-- due now (within the shared tolerance) plays; one within CUE_AHEAD real seconds of its time is scheduled for it,
-- and scheduled again when the rehearsal's speed changed since.
local function cues(self, lines, now)
    local timers = C_Timer and C_Timer.After
    local speed
    for _, line in ipairs(lines) do
        for _, member in ipairs(line.members or { line }) do
            local at = cueOf(line, member)
            local key = at and cueKey(member)
            if key and not self.spoken[key] then
                if at - now <= CUE_EARLY then
                    playCue(self, member, at, now, "tick")
                elseif timers then
                    -- real seconds: the ticks come every TICK real seconds at any speed
                    speed = speed or speedNow()
                    local p = self.pending[key]
                    local wait = (at - now) / speed
                    if (not p or p.speed ~= speed) and wait <= CUE_AHEAD then
                        arm(self, key, wait, speed, false)
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

    local due = Rules.SpeechDue(lines, now, self.spoken)
    if #due > 0 then
        for _, item in ipairs(due) do
            -- An empty or unreadable text is skipped, and a plain note line while Read them out is off.
            local text = item.text
            local readable = not (CRT.Timeline and CRT.Timeline.readable) or CRT.Timeline.readable(text)
            if readable and type(text) == "string" and text ~= "" and not readOutOnly(item.block, item.own) then
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
    if self.playing and not self.clip and self.queue[1] and numberOf(self.queue[1].text) then
        self.playing = false -- a spoken line never holds a count's number past its second
    end
    -- a count's number that comes up too late to sound on its second is dropped, not said late
    while not self.playing and self.queue[1] and numberOf(self.queue[1].text) and now - self.queue[1].at > NUMBER_LATE do
        local late = table.remove(self.queue, 1)
        if #self.timing > 0 then
            tell(self, "dropped", { text = late.text, at = late.at, now = now })
        end
    end
    if not self.playing and self.queue[1] then
        local item = table.remove(self.queue, 1)
        self.playing = true
        self.playingUntil = real + Rules.SPEECH_TIMEOUT
        local _, how, seconds = self:SpeakNow(item.text or "")
        self.clip = how == "clip"
        if self.clip then
            self.playingUntil = real + (seconds or CLIP_HOLD)
        end
        if #self.timing > 0 then
            tell(self, "speech", { text = item.text, at = item.at, now = now, real = real, clip = how == "clip" })
        end
    end
    wake(self, lines, now, real)
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
    -- a clip has no finished event: this one is for an earlier spoken line, or not ours
    if not Speech.clip then
        Speech.playing = false
    end
    if Alerts.running then
        Speech:Tick(engineNow())
    end
end)
pcall(driver.RegisterEvent, driver, "VOICE_CHAT_TTS_PLAYBACK_FINISHED")
driver:RegisterEvent("PLAYER_LOGIN")
