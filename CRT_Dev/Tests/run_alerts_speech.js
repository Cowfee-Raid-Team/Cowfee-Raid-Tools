// CRT_Modules/Alerts/Speech.lua: the speech queue. Real Rules + Engine + Speech with a mocked clock and TTS.
// Args: CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Speech.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local files = { ... }
local clock = 100
function GetTime() return clock end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
local SECRET = {}
local said = {}
C_TTSSettings = { GetVoiceOptionID = function() return 7 end }
C_VoiceChat = { SpeakText = function(id, text, rate, vol, interrupt)
  said[#said + 1] = { id = id, text = text, rate = rate, vol = vol, interrupt = interrupt, at = clock } end }
local frames = {}
function CreateFrame()
  local f = { events = {}, scripts = {} }
  function f:RegisterEvent(ev) self.events[ev] = true end
  function f:SetScript(k, fn) self.scripts[k] = fn end
  frames[#frames + 1] = f
  return f
end
local function fire(ev, ...)
  for _, f in ipairs(frames) do if f.events[ev] and f.scripts.OnEvent then f.scripts.OnEvent(f, ev, ...) end end
end
-- C_Timer.After: a timer runs in the first frame whose time has reached it (timing is limited to the frame rate)
-- early[1], when set, makes the next timer come that many seconds before its time (once)
local timers, asked, early = {}, {}, {}
C_Timer = { After = function(d, fn)
  asked[#asked + 1] = { d = d, at = clock }
  local soon = table.remove(early, 1) or 0
  timers[#timers + 1] = { due = clock + d - soon, fn = fn }
end }
local function runTimers()
  local due = {}
  for i = #timers, 1, -1 do
    if timers[i].due <= clock + 1e-9 then due[#due + 1] = table.remove(timers, i) end
  end
  for i = #due, 1, -1 do due[i].fn() end
end
-- every game sound played, with the time it played
local played = {}
function PlaySound(id, channel) played[#played + 1] = { id = id, at = clock } return true end
local function step(dt)
  clock = clock + dt
  runTimers()
  for _, f in ipairs(frames) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, dt) end end
end
local printed = {}
local CRT = { db = { notes = { alert = { tts = true, ttsRate = 2, ttsVolume = 80, ttsSeconds = 3 } }, alerts = {} },
  Print = function(_, m) printed[#printed + 1] = m end }
for i, src in ipairs(files) do assert(load(src, "@f" .. i))("CowfeeRaidTools", CRT) end
local A, S, R = CRT.Alerts, CRT.AlertSpeech, CRT.AlertRules
assert(S and S.Tick and S.Reset and S.SpeakNow, "Speech API")

local items = {}
A:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })
local function speechItem(id, time, text, priority)
  return { id = id, ph = 1, time = time, text = text, priority = priority,
    outputs = { alert = true, bar = true, speech = true }, speech = { { offset = 0, text = text } } }
end
local function start(list)
  items = list
  said = {}
  A:Start(1, "Mythic", "test")
end
local function finished() fire("VOICE_CHAT_TTS_PLAYBACK_FINISHED") end
local function texts() local t = {} for _, s in ipairs(said) do t[#t + 1] = s.text end return table.concat(t, ",") end

-- one at a time
start({ speechItem("a", 1, "first", 21), speechItem("b", 1, "second", 21) })
step(1) -- both due
assert(texts() == "first", "only one plays: " .. texts())
step(0.1); step(0.1)
assert(texts() == "first", "still held")
finished()
step(0.1)
assert(texts() == "first,second", "second after finished: " .. texts())
assert(said[1].id == 7 and said[1].rate == 2 and said[1].vol == 80 and said[1].interrupt == false, "SpeakText args")
print("ok speech: one at a time")

-- timeout starts next
start({ speechItem("a", 1, "first", 21), speechItem("b", 1, "second", 21) })
step(1)
assert(texts() == "first")
for i = 1, 35 do step(0.1) end
assert(texts() == "first", "not before the timeout: " .. texts() .. " " .. (clock - 101))
for i = 1, 6 do step(0.1) end
assert(texts() == "first,second", "after 4s: " .. texts())
print("ok speech: timeout starts next")

-- behind drops lowest: raid-wide (11) dropped, own reminder (31) and note (21) kept
start({ speechItem("r", 1, "raid", 11), speechItem("n", 1, "note", 21), speechItem("m", 1, "mine", 31) })
step(1)
assert(texts() == "mine", "highest first? " .. texts())
for i = 1, 20 do step(0.1) end -- held for 2 seconds, no finished event
finished()
step(0.1)
assert(texts() == "mine,note", "raid-wide dropped: " .. texts())
finished()
for i = 1, 5 do step(0.1) end
assert(texts() == "mine,note", "raid never spoken: " .. texts())
print("ok speech: behind drops lowest")

-- a note line speaks once at ttsSeconds before its time
local entry = speechItem("note:1", 10, "Spell", 21)
entry.speech = { { offset = 3, text = "Spell" } }
start({ entry })
local startAt = clock
for i = 1, 150 do
  step(0.1)
  if #said > 0 and said[1].at then break end
end
assert(#said == 1 and math.abs((said[1].at - startAt) - 7) < 0.15, "spoken at 3 seconds left: " .. tostring(said[1] and said[1].at - startAt))
for i = 1, 100 do step(0.1) end
assert(#said == 1, "once")
print("ok speech: note line spoken once at ttsSeconds")

-- extras: tts off plays nothing; SpeakNow is outside the queue; new run clears; late item skipped
CRT.db.notes.alert.tts = false
start({ speechItem("a", 1, "quiet", 21) })
step(2)
assert(#said == 0, "tts off")
CRT.db.notes.alert.tts = true
S:SpeakNow("test phrase")
assert(texts() == "test phrase", "SpeakNow outside queue")
start({ speechItem("a", 1, "x", 21), speechItem("b", 1, "y", 21) })
step(1)
assert(#said == 1)
start({})
step(2)
assert(#said == 0 and (S.queue == nil or #S.queue == 0), "run change clears the queue")
-- empty text skipped; every block, the note's too, follows only tts (ruling B2)
local e1 = speechItem("e", 1, "", 21)
local e2 = speechItem("f", 1, "after empty", 21)
e2.speech[1].text = "after empty"
start({ e1, e2 })
step(1)
assert(texts() == "after empty", "empty text skipped: " .. texts())
print("ok speech: empty text skipped")
CRT.db.notes.alert.enabled = false
A:RegisterBlock("note", { label = "n", group = false, Entries = function() return { speechItem("n1", 1, "noteline", 21) } end })
A:RegisterBlock("t", { label = "t", group = false, Entries = function() return { speechItem("t1", 1, "other", 21) } end })
said = {}
A:Start(1, "Mythic", "test")
step(1) finished() step(0.1) finished() step(0.1)
local heard = texts()
assert(heard:find("noteline") and heard:find("other"), "note block speaks with the alert off: " .. heard)
CRT.db.notes.alert.enabled = true
CRT.db.notes.alert.tts = false
said = {}
A:Start(1, "Mythic", "test")
step(1) finished() step(0.1) finished() step(0.1)
assert(texts() == "", "tts off silences the note block and the others: " .. texts())
CRT.db.notes.alert.tts = true
print("ok speech: note block follows only tts")

-- the one-time notice: alert off and speech on, once per profile; not in the other cases
local function login(enabled, tts, flag)
  CRT.db.notes.alert.enabled = enabled
  CRT.db.notes.alert.tts = tts
  CRT.db.alerts.speechNotice = flag
  printed = {}
  fire("PLAYER_LOGIN")
  return #printed
end
assert(login(false, true, false) == 1, "shown for alert off, speech on")
assert(printed[1]:find("read out even with the note callout off", 1, true) and printed[1]:find("Untick 'Read them out'", 1, true), printed[1])
assert(CRT.db.alerts.speechNotice == true, "remembered")
printed = {} fire("PLAYER_LOGIN")
assert(#printed == 0, "not shown twice")
assert(login(false, true, true) == 0, "flag already set")
assert(login(true, true, false) == 0, "alert on: nothing changed for them")
assert(login(false, false, false) == 0, "speech off: nothing to stop")
assert(CRT.db.alerts.speechNotice == false, "flag left alone when not shown")
assert(login(false, nil, false) == 1, "speech unset counts as on")
CRT.db.notes.alert.enabled = true CRT.db.notes.alert.tts = true
print("ok speech: one-time notice")
assert(#errors == 0, table.concat(errors, "; "))
print("ok speech: tts off, SpeakNow, reset")

-- Sound cues on time: a cue is scheduled for its exact moment once it is within a tick of it, not left to the
-- next 0.1 s tick. Frames here are 10 ms, so "on time" is within one frame.
local FRAME = 0.01
A:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })
A:RegisterBlock("note", { label = "n", group = false, Entries = function() return {} end })
local function cueItem(id, time, ph)
  return { id = id, ph = ph or 1, time = time, text = id, sound = "RAID_WARNING", outputs = { alert = true } }
end
local function run(seconds) for _ = 1, math.floor(seconds / FRAME + 0.5) do step(FRAME) end end
local function clearCues() wipe(played) wipe(asked) wipe(timers) said = {} end
local function untilScheduled() local stop = clock + 5 while #timers == 0 and clock < stop do step(FRAME) end end
local function near(a, b) return math.abs(a - b) <= FRAME + 1e-6 end

clearCues()
start({ cueItem("c1", 1.03) })
local t0 = clock
run(3)
assert(#played == 1, "plays once: " .. #played)
assert(near(played[1].at, t0 + 1.03), "on time, not at the next tick: " .. (played[1].at - t0))
assert(#asked >= 1 and math.abs(asked[1].at + asked[1].d - (t0 + 1.03)) < 1e-6, "scheduled for its exact offset")
finished() run(1)
assert(#played == 1, "a finished speech event never replays it")
print("ok cues: scheduled for the exact offset, played once")

-- stopped, reset, or the line gone before its moment: never played
clearCues()
start({ cueItem("c1", 1.03) })
untilScheduled()
A:Stop()
run(2)
assert(#played == 0, "stopped: not played")
clearCues()
start({ cueItem("c1", 1.03) })
untilScheduled()
run(0.02)
start({ cueItem("c1", 1.03) }) -- a new run with the same alert
local t1 = clock
run(3)
assert(#played == 1 and near(played[1].at, t1 + 1.03), "reset: only the new run's cue, at its own time: "
  .. #played .. " " .. tostring(played[1] and (played[1].at - t1)))
clearCues()
start({ cueItem("c3", 1.03, 1), { id = "p2", ph = 2, time = 5, text = "later", outputs = { alert = true } } })
untilScheduled()
A:StartPhase(2, "next") -- phase 2 starts before the cue: its phase 1 line is cut
run(2)
assert(#played == 0, "a line that went away: not played")
print("ok cues: cancelled on stop, reset and a line going away")

-- rehearsal at 2x and 4x: the cue is at engine time, so it waits (at - now) / speed real seconds
for _, speed in ipairs({ 2, 4 }) do
  clearCues()
  items = { cueItem("r" .. speed, 1.03 * speed) }
  local base0 = clock
  A:Start(1, "Mythic", "rehearsal", { clock = function() return (clock - base0) * speed end,
    speed = function() return speed end })
  run(3)
  assert(#played == 1, speed .. "x plays once: " .. #played)
  assert(near(played[1].at, base0 + 1.03), speed .. "x on time: " .. (played[1].at - base0))
  A:Stop()
  run(0.2)
end
print("ok cues: rehearsal at 2x and 4x")

-- The displays redraw (OnZero) the moment a cue plays, once a frame; each redraw records whether a display would
-- draw 0 for every line whose cue has played (Rules.Countdown, as the displays use it).
local zeroAt, zeroDrawsNow = {}, {}
S:OnZero(function()
  zeroAt[#zeroAt + 1] = clock
  local now, all = A:Now(), true
  for _, l in ipairs(A:Lines(now)) do
    if S.spoken[tostring(l.id) .. "#sound"] and R.Countdown(l.at - now) ~= nil then all = false end
  end
  zeroDrawsNow[#zeroDrawsNow + 1] = all
end)
local function clearZero() wipe(zeroAt) wipe(zeroDrawsNow) end

-- SOUND_LATE kept: a cue that passed more than a second ago never plays; one just passed still does. A cue only
-- marked (too late) redraws nothing.
clearCues() clearZero()
items = { cueItem("late", 1), cueItem("recent", 2.5) }
A:Start(1, "Mythic", "test", { firstAt = clock - 3 })
run(1)
assert(#played == 1, "only the recent one: " .. #played)
assert(#zeroAt == 1, "one redraw, for the one that played: " .. #zeroAt)
clearCues() clearZero()
items = { cueItem("late", 1) }
A:Start(1, "Mythic", "test", { firstAt = clock - 3 })
run(1)
assert(#played == 0 and #zeroAt == 0, "a cue too late to play redraws nothing")
print("ok cues: SOUND_LATE kept")

-- the displays redraw the moment the cue plays, so their 0 and the sound are the same moment
clearCues() clearZero()
start({ cueItem("z", 1.03) })
t0 = clock
run(2)
assert(#played == 1 and #zeroAt == 1 and zeroAt[1] == played[1].at, "the displays redraw as it plays")
assert(zeroDrawsNow[1], "and they draw 0 then")
-- two cues in the same frame: both play, one redraw
clearCues() clearZero()
start({ cueItem("y1", 1.03), cueItem("y2", 1.03) })
run(2)
assert(#played == 2 and #zeroAt == 1, "two cues in one frame, one redraw: " .. #played .. " " .. #zeroAt)
print("ok cues: displays redraw at the sound, once a frame")

-- a timer 3 ms early (inside the shared tolerance) plays, and the displays draw 0 with it
clearCues() clearZero()
early[1] = 0.003
start({ cueItem("e3", 1.033) })
t0 = clock
run(2)
assert(#played == 1 and near(played[1].at, t0 + 1.03), "3 ms early plays: " .. tostring(played[1] and played[1].at - t0))
assert(zeroDrawsNow[1] == true, "and 0 is drawn as it plays, not 0.1")
-- a timer 50 ms early is scheduled again once for the time left, and plays on time (not at the next tick)
clearCues() clearZero()
early[1] = 0.05
start({ cueItem("e50", 1.03) })
t0 = clock
run(2)
assert(#played == 1 and near(played[1].at, t0 + 1.03), "50 ms early: again for the time left, on time: "
  .. tostring(played[1] and played[1].at - t0))
assert(#asked == 2, "scheduled twice: " .. #asked)
print("ok cues: an early timer within the tolerance plays, one earlier is scheduled again")

-- a member's cue: keyed and timed by the member, not by the line it merged into (whose id is the first member's)
local groupItems = {}
A:RegisterBlock("t", { label = "t", group = false, Entries = function() return {} end })
A:RegisterBlock("g", { label = "g", group = true, Entries = function() return groupItems end })
clearCues()
groupItems = { { id = "lead", ph = 1, time = 1, text = "Lead", outputs = { alert = true } }, cueItem("member", 1.03) }
start({})
t0 = clock
local merged = A:Lines(A:Now())
assert(#merged == 1 and merged[1].id == "lead" and #merged[1].members == 2, "one merged line, led by another id")
run(2)
assert(#played == 1 and near(played[1].at, t0 + 1.03), "the member's cue, once, at its own time: " .. #played
  .. " " .. tostring(played[1] and played[1].at - t0))
groupItems = {}
A:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })
print("ok cues: a merged line's member cue, at the member's time")

-- a rehearsal clock that can pause, seek and change speed while a cue is scheduled
local rf, rs, rp = 0, 1, true
local function rrun(seconds, until_)
  for _ = 1, math.floor(seconds / FRAME + 0.5) do
    if rp then rf = rf + FRAME * rs end
    step(FRAME)
    if until_ and until_() then return end
  end
end
local gaps = {}
S:OnTiming(function(kind, info) if kind == "cue" then gaps[#gaps + 1] = info.now - info.at end end)
local function rehearse(time)
  clearCues() wipe(gaps)
  rf, rs, rp = 0, 1, true
  items = { cueItem("rh", time) }
  A:Start(1, "Mythic", "rehearsal", { clock = function() return rf end, speed = function() return rs end })
end
local function scheduled() return #timers > 0 end
-- paused while it is scheduled: nothing plays until the clock moves on, then once, on time
rehearse(1.03)
rrun(2, scheduled)
rp = false
rrun(1)
assert(#played == 0, "paused: not played")
rp = true
rrun(1)
assert(#played == 1 and math.abs(gaps[1]) <= FRAME + 1e-6, "resumed: once, on time: " .. tostring(gaps[1]))
-- seek back while it is scheduled: not played at the old moment; once, on time, when the clock gets there again
rehearse(1.03)
rrun(2, scheduled)
rf = 0.2
rrun(0.5)
assert(#played == 0, "seeked back: not played")
rrun(1)
assert(#played == 1 and math.abs(gaps[1]) <= FRAME + 1e-6, "played once when reached again: " .. tostring(gaps[1]))
-- 2x to 1x after it was scheduled: its timer comes early, is scheduled again and plays on time
rehearse(2.06)
rs = 2
rrun(2, scheduled)
rs = 1
rrun(1)
assert(#played == 1 and math.abs(gaps[1]) <= FRAME + 1e-6, "slowed down: on time: " .. tostring(gaps[1]))
-- 1x to 4x after it was scheduled: once, never early, at most a tick (in fight seconds) late
rehearse(1.03)
rrun(2, scheduled)
rs = 4
rrun(1)
assert(#played == 1 and gaps[1] >= -R.ZERO_EPSILON and gaps[1] <= (0.1 + 2 * FRAME) * 4, "sped up: " .. tostring(gaps[1]))
A:Stop() run(0.2)
print("ok cues: rehearsal pause, seek and speed change while scheduled")

-- a cue never waits behind speech: a line still being said (no finished event) doesn't hold it
clearCues()
start({ speechItem("s", 1, "a long line being said", 21), cueItem("c5", 1.53) })
t0 = clock
run(3)
assert(texts() == "a long line being said", "the line is said: " .. texts())
assert(#played == 1 and near(played[1].at, t0 + 1.53), "the cue plays on time while it is said: "
  .. tostring(played[1] and (played[1].at - t0)))
-- and a cue coming due with no C_Timer (or a timer that never comes) still plays at the next tick
clearCues()
local after = C_Timer.After
C_Timer.After = function() end
start({ cueItem("c6", 1.03) })
t0 = clock
run(2)
C_Timer.After = after
assert(#played == 1 and played[1].at - t0 >= 1.03 and played[1].at - t0 < 1.03 + 0.1 + 2 * FRAME, "the tick still plays it")
print("ok cues: never behind speech, and the tick plays one no timer did")
assert(#errors == 0, table.concat(errors, "; "))

-- a file: sound is looked for in the companion addon only (the old CRT_Media\\Sounds is gone)
local found = CRT.Sound:Resolve("file:horn.ogg")
local AD = "Interface\\\\AddOns\\\\"
assert(found and found.kind == "file" and #found.paths == 1, "one place tried")
assert(found.paths[1] == AD .. "CowfeeRaidTools_Media\\\\Sounds\\\\horn.ogg", found.paths[1])
assert(CRT.Sound.BUNDLED_FOLDER == AD .. "CowfeeRaidTools\\\\CRT_Media\\\\Media\\\\Sounds\\\\", CRT.Sound.BUNDLED_FOLDER)
print("ok speech: file sounds looked for in the companion addon only")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
if (files.length < 3) { console.error('usage: node run_alerts_speech.js Rules Engine Speech'); process.exit(2); }
for (const f of files) lua.lua_pushstring(L, to_luastring(fs.readFileSync(f, 'utf8')));
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
