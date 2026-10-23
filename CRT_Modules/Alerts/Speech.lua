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

local Rules = CRT.AlertRules
local Alerts = CRT.Alerts

local TICK = 0.1
local SOUND_LATE = 1  -- a sound whose time passed more than this many seconds ago is not played

local NOTICE = {
    speech = "Raid Notes: your note lines are now read out even with the note callout off. Untick 'Read them out' on Raid Notes > Alert Settings to stop it.",
}

local Speech = {
    queue = {},     -- items waiting, oldest first
    spoken = {},    -- keys Rules.SpeechDue has already handled
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

function Speech:Tick(now)
    if not Alerts.running then
        if #self.queue > 0 or next(self.spoken) then
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

    -- Sound cues: each member plays its own, once, keyed like speech so a changing line never replays one.
    for _, line in ipairs(lines) do
        for _, member in ipairs(line.members or { line }) do
            local at = member.at or line.at
            local allowed = member.block ~= "note" or settings().tts
            if member.sound and at <= now and allowed then
                local key = tostring(member.id) .. "#sound"
                if not self.spoken[key] then
                    self.spoken[key] = true
                    if now - at <= SOUND_LATE then
                        CRT.Sound:Play(member.sound) -- any reference; an old bare name is a game sound
                    end
                end
            end
        end
    end

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
    end
end

-- The engine's time (the rehearsal's clock in one), or GetTime() without it.
local function engineNow()
    return Alerts and Alerts.Now and Alerts:Now() or GetTime()
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
