// CRT_Core/Sound/Voices.lua: the voice packs. The voice table against the clips on disk, the sound lists' groups,
// the Voice setting's dropdown on Quality of Life > Sounds, and the speech path: a whole text that is a clip's word
// plays the clip, anything else is read by text to speech, a word a voice lacks falls back, a count uses the number
// clips, and the "tts" voice never plays a clip. Real Sound/Engine.lua, Sound/Voices.lua, Alerts/Rules.lua,
// Alerts/Engine.lua, Alerts/Speech.lua and QoL/Page.lua, on a mocked clock, speech and frames.
//   node run_voices.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local onDisk, engineSrc, voicesSrc, rulesSrc, alertsSrc, speechSrc, pageSrc, lowHealthSrc = ...
local passed, failed = 0, 0
local function check(name, cond, detail)
  if cond then passed = passed + 1 print("ok " .. name)
  else failed = failed + 1 print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or "")) end
end

local clock = 100
function GetTime() return clock end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local said, played, stopped = {}, {}, {}
C_TTSSettings = { GetVoiceOptionID = function() return 7 end }
C_VoiceChat = { SpeakText = function(id, text, rate, vol) said[#said + 1] = { text = text, at = clock, rate = rate, vol = vol } end,
  StopSpeakingText = function() end }
local handles = 0
function PlaySoundFile(p, channel) handles = handles + 1 played[#played + 1] = { path = p, channel = channel, at = clock } return true, handles end
function StopSound(h) stopped[#stopped + 1] = h end
-- a mock frame: any method is a no-op unless set here; SetScript keeps the handler under its name
local function mock()
  local m = { pts = {} }
  return setmetatable(m, { __index = function(t, k)
    if type(k) == "string" and k:match("^%l") then return nil end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock() end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetStringWidth" or k == "GetUnboundedStringWidth" then return function(self) return #(rawget(self, "text") or "") * 7 end end
    if k == "GetFontString" then return function(self) return self end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "IsShown" then return function() return true end end
    return function() end
  end })
end
local frames = {}
function CreateFrame(kind, name, parent)
  local f = mock()
  rawset(f, "events", {})
  f.RegisterEvent = function(self, ev) self.events[ev] = true end
  frames[#frames + 1] = f
  return f
end
local function fire(ev) for _, f in ipairs(frames) do if f.events[ev] and f.OnEvent then f.OnEvent(f, ev) end end end
-- C_Timer.After: runs in the first step whose time has reached it, at that time (the clock moves to it first)
local timers = {}
local armed = 0 -- every C_Timer.After asked for
C_Timer = { After = function(d, fn) armed = armed + 1 timers[#timers + 1] = { due = clock + d, fn = fn } end }
local function step(dt)
  local stop = clock + dt
  while true do
    local first
    for i, t in ipairs(timers) do if t.due <= stop + 1e-9 and (not first or t.due < timers[first].due) then first = i end end
    if not first then break end
    local t = table.remove(timers, first)
    clock = math.max(clock, t.due)
    t.fn()
  end
  clock = stop
  for _, f in ipairs(frames) do if f.OnUpdate then f.OnUpdate(f, dt) end end
end
local kits = {}
function PlaySound(id) kits[#kits + 1] = { id = id, at = clock } return true end

local CRT = { db = { sound = { custom = {}, voice = "xavier" }, ui = { soundChannel = "Dialog" },
  notes = { alert = { tts = true, ttsRate = 0, ttsVolume = 100 } }, alerts = {}, qol = { lowHealth = {}, breakTimer = {} } },
  Print = function() end }
for i, src in ipairs({ engineSrc, voicesSrc, rulesSrc, alertsSrc, speechSrc }) do assert(load(src, "@f" .. i))("CowfeeRaidTools", CRT) end
local Sound, Speech, Rules, Alerts = CRT.Sound, CRT.AlertSpeech, CRT.AlertRules, CRT.Alerts
check("the voice table is there", type(Sound.VOICES) == "table" and #Sound.VOICES == 2)
if type(Sound.VOICES) ~= "table" or #Sound.VOICES == 0 then print(passed .. " passed, " .. failed .. " failed") return end

-- The table against the files on disk ------------------------------------------------------------------
local byKey = {}
for _, v in ipairs(Sound.VOICES) do byKey[v.key] = v end
local X, Lo = byKey.xavier, byKey.lola
check("Xavier and Lola, labelled", X and Lo and X.label == "Xavier (male)" and Lo.label == "Lola (female)" and X.folder == "Xavier" and Lo.folder == "Lola")
for _, v in ipairs(Sound.VOICES) do
  local files = onDisk[v.folder] or {}
  local missing, extra, listed = {}, {}, {}
  for _, w in ipairs(v.words) do listed[w .. ".mp3"] = true if not files[w .. ".mp3"] then missing[#missing + 1] = w end end
  for f in pairs(files) do if not listed[f] then extra[#extra + 1] = f end end
  check(v.key .. ": every listed word has its file", #missing == 0, table.concat(missing, ","))
  check(v.key .. ": every file is a listed word", #extra == 0, table.concat(extra, ","))
end
for _, v in ipairs(Sound.VOICES) do
  local files, wrong, tagged = onDisk[v.folder] or {}, {}, {}
  for _, w in ipairs(v.words) do
    local f = files[w .. ".mp3"]
    if not (f and type(v.seconds) == "table" and v.seconds[w] and math.abs(v.seconds[w] - f.seconds) <= 0.02) then
      wrong[#wrong + 1] = w .. "=" .. tostring(v.seconds and v.seconds[w]) .. "/" .. tostring(f and f.seconds)
    end
  end
  for name, f in pairs(files) do if f.tag or f.meta then tagged[#tagged + 1] = name end end
  check(v.key .. ": each clip's seconds match its mp3 frames", #wrong == 0, table.concat(wrong, ","))
  check(v.key .. ": no clip has an ID3 tag or a GEOB or c2pa frame", #tagged == 0, table.concat(tagged, ","))
end
check("Xavier and Lola have all 70 words", #X.words == 70 and #Lo.words == 70, #X.words .. " " .. #Lo.words)
local lolaHas = {}
for _, w in ipairs(Lo.words) do lolaHas[w] = true end
check("Lola has Void, West and Yellow", lolaHas.Void and lolaHas.West and lolaHas.Yellow and lolaHas.Soak)

-- crt: references, and the groups in every sound list ---------------------------------------------------
local soak = Sound:Resolve("crt:Xavier-Soak")
check("crt:Xavier-Soak plays Xavier's Soak.mp3", soak and soak.kind == "file" and soak.paths[1] == Sound.BUNDLED_FOLDER .. "Xavier\\\\Soak.mp3", soak and soak.paths[1])
check("crt:Lola-Run-Out resolves", Sound:Resolve("crt:Lola-Run-Out") ~= nil)
check("crt:Lola-Void resolves", Sound:Resolve("crt:Lola-Void") ~= nil)
check("a word no voice has is no sound", Sound:Resolve("crt:Lola-Nope") == nil)
local list = Sound:Choices({ none = "None" })
local order, at = {}, {}
for i, c in ipairs(list) do if c.title then order[#order + 1] = c.label at[c.label] = i end end
check("titles Xavier, Lola, then Game sounds", table.concat(order, ",") == "Xavier,Lola,Game sounds", table.concat(order, ","))
check("None comes first", list[1].key == "none")
check("Xavier's clips under Xavier", list[at.Xavier + 1].key == "crt:Xavier-0" and at.Lola - at.Xavier - 1 == 70, list[at.Xavier + 1].key)
check("Lola's clips under Lola", list[at.Lola + 1].key == "crt:Lola-0" and at["Game sounds"] - at.Lola - 1 == 70)
check("game sounds after the title", list[at["Game sounds"] + 1].key == "kit:RAID_WARNING")
local labels = {}
for _, c in ipairs(list) do if c.key then labels[c.key] = c.label end end
check("5seconds321's label is in the data", type(Sound.VOICE_LABELS) == "table" and Sound.VOICE_LABELS["5seconds321"] ~= nil
  and labels["crt:Xavier-5seconds321"] == Sound.VOICE_LABELS["5seconds321"])
check("clip labels read as words", labels["crt:Xavier-Run-Out"] == "Run out" and labels["crt:Xavier-HealAbsorb"] == "Heal absorb" and labels["crt:Lola-Soak"] == "Soak",
  tostring(labels["crt:Xavier-Run-Out"]) .. " " .. tostring(labels["crt:Xavier-HealAbsorb"]))
local filesOnly = Sound:Choices({ filesOnly = true })
local t2 = {}
for _, c in ipairs(filesOnly) do if c.title then t2[#t2 + 1] = c.label end end
check("files only: the voices without a Game sounds title", table.concat(t2, ",") == "Xavier,Lola", table.concat(t2, ","))

-- The speech path ---------------------------------------------------------------------------------------
local function reset() said, played = {}, {} end
local function lastFile() local p = played[#played] return p and p.path:match("([^\\\\]+\\\\[^\\\\]+)$") end
reset()
local ok, how, secs = Sound:Speak("Soak")
check("Soak plays Xavier's clip, not text to speech", ok and how == "clip" and lastFile() == "Xavier\\\\Soak.mp3" and #said == 0, lastFile())
check("Speak gives the clip's length", secs ~= nil and secs == X.seconds.Soak, tostring(secs))
check("the clip plays on the sound channel", played[1] and played[1].channel == "Dialog")
for _, t in ipairs({ "soak", "SOAK!", "  Soak.  ", "Run out", "run-out", "Run Out!", "heal absorb", "Drop pool?", "5 seconds, 3 2 1" }) do
  reset() Sound:Speak(t)
  check("'" .. t .. "' matches a clip", #played == 1 and #said == 0, lastFile())
end
reset() Sound:Speak("Soak now")
check("a longer text is read out", #played == 0 and said[1] and said[1].text == "Soak now")
reset() Sound:Speak("Soak on Abu")
check("a word inside a sentence is read out", #played == 0 and #said == 1)
CRT.db.sound.voice = "lola"
reset() Sound:Speak("Spread")
check("Lola says Spread with her clip", lastFile() == "Lola\\\\Spread.mp3" and #said == 0, lastFile())
for _, w in ipairs({ "Void", "West", "Yellow" }) do
  reset() Sound:Speak(w)
  check("Lola says " .. w .. " with her clip", lastFile() == "Lola\\\\" .. w .. ".mp3" and #said == 0, lastFile())
end
CRT.db.sound.voice = "tts"
reset() Sound:Speak("Soak") Sound:Speak("3")
check("the tts voice never plays a clip", #played == 0 and #said == 2)
CRT.db.sound.voice = nil
reset() Sound:Speak("Soak")
check("no saved voice is Xavier", lastFile() == "Xavier\\\\Soak.mp3")
CRT.db.sound.voice = "gone"
reset() Sound:Speak("Soak")
check("an unknown voice is Xavier", lastFile() == "Xavier\\\\Soak.mp3")
CRT.db.sound.voice = "xavier"
reset() Sound:Speak("Soak", { voice = "lola" })
check("opts.voice picks the voice (the Test button)", lastFile() == "Lola\\\\Soak.mp3")
local SECRET = setmetatable({}, { __tostring = function() return "secret" end })
function issecretvalue(v) return v == SECRET end
reset() Sound:Speak(SECRET)
check("a secret text goes straight to text to speech", #played == 0 and said[1] and said[1].text == SECRET)
issecretvalue = nil
local played0 = PlaySoundFile
PlaySoundFile = function() return false end
reset() Sound:Speak("Soak")
check("a clip that didn't play is read out instead", said[1] and said[1].text == "Soak")
PlaySoundFile = played0
reset() Sound:Play("tts:Stack")
check("a tts: sound uses the voice too", lastFile() == "Xavier\\\\Stack.mp3")
reset() local h = Sound:Play("tts:Stack") Sound:Stop(h)
check("stopping speech stops the clip", stopped[#stopped] == handles)

-- The alert speech queue: the count as one quick phrase ending at 0, then the text (Alex, 2026-11-01) -----------
local items = {}
Alerts:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })
local start
-- a clip, then a text with no clip, then a clip: the speaker is free after the clip
items = {
  { id = "a", ph = 1, time = 2, text = "Spread", priority = 21, outputs = { speech = true }, speech = { { offset = 0, text = "Spread" } } },
  { id = "b", ph = 1, time = 3, text = "Stack on Abu", priority = 21, outputs = { speech = true }, speech = { { offset = 0, text = "Stack on Abu" } } },
}
reset()
Alerts:Start(1, "Mythic", "test")
for i = 1, 40 do step(0.1) end
check("a clip then a text: the text is read out after it", #played == 1 and said[1] and said[1].text == "Stack on Abu" and said[1].at - played[1].at < 1.5)
-- a long clip, then a clip 1 s later: the second waits for the first to end
items = {
  { id = "h", ph = 1, time = 2, text = "Heal absorb", priority = 21, outputs = { speech = true }, speech = { { offset = 0, text = "Heal absorb" } } },
  { id = "s", ph = 1, time = 3, text = "Soak", priority = 21, outputs = { speech = true }, speech = { { offset = 0, text = "Soak" } } },
}
reset()
Alerts:Start(1, "Mythic", "test")
for i = 1, 60 do step(0.1) end
check("a clip line 1 s after a long clip starts once it ends", #played == 2 and played[2].at - played[1].at >= X.seconds.HealAbsorb - 1e-6,
  #played == 2 and string.format("%.2f", played[2].at - played[1].at) or #played)
check("the waiting line starts as the clip ends, not at the next tick", #played == 2 and played[2].at - played[1].at <= X.seconds.HealAbsorb + 0.01,
  #played == 2 and string.format("%.3f", played[2].at - played[1].at) or #played)
-- a line due between two ticks is said at its own time (a wake timer), not up to a tick later
items = { { id = "between", ph = 1, time = 2.05, text = "Spread", priority = 21, outputs = { speech = true }, speech = { { offset = 0, text = "Spread" } } } }
reset()
Alerts:Start(1, "Mythic", "test")
start = clock
for i = 1, 40 do step(0.1) end
check("a line due between ticks is said at its time", #played == 1 and math.abs(played[1].at - start - 2.05) <= 0.005,
  played[1] and string.format("%.3f", played[1].at - start) or "none")
CRT.db.sound.voice = "tts"
reset()
Alerts:Start(1, "Mythic", "test")
start = clock
for i = 1, 40 do step(0.1) end
check("text to speech too: a line due between ticks is said at its time", #said == 1 and math.abs(said[1].at - start - 2.05) <= 0.005,
  said[1] and string.format("%.3f", said[1].at - start) or "none")
CRT.db.sound.voice = "xavier"
CRT.db.notes.alert.ttsRate = 0
-- an alert at 20 s with Speak the text and Count down: what is played and said, from the run's start
local function runCount(voice, opts, extra)
  CRT.db.sound.voice = voice
  local list = {}
  for i, s in ipairs(Rules.SpeechItems(opts.text or "Soak", opts.warn or 8, opts.speak ~= false, true, opts.atZero, opts)) do list[i] = s end
  items = { { id = "q" .. tostring(math.random(1e9)), ph = 1, time = 20, text = opts.text or "Soak", priority = 21, sound = opts.sound,
    outputs = { speech = true }, speech = list } }
  for _, e in ipairs(extra or {}) do items[#items + 1] = e end
  reset()
  kits = {}
  Alerts:Start(1, "Mythic", "test")
  local t0 = clock
  for i = 1, 2500 do
    step(0.01)
    if opts.each then opts.each(clock - t0) end
  end
  Alerts:Stop()
  local out = {}
  for _, p in ipairs(played) do out[#out + 1] = { what = p.path:match("([^\\\\]+)%.mp3$"), at = p.at - t0 } end
  for _, s in ipairs(said) do out[#out + 1] = { what = "tts:" .. tostring(s.text), at = s.at - t0 } end
  table.sort(out, function(a, b) return a.at < b.at end)
  return out, list, t0
end
local function names(out) local t = {} for _, o in ipairs(out) do t[#t + 1] = o.what .. "@" .. string.format("%.3f", o.at) end return table.concat(t, " ") end
local function of(out, what) for _, o in ipairs(out) do if o.what == what then return o end end end
local function order(out) local t = {} for _, o in ipairs(out) do t[#t + 1] = o.what end return table.concat(t, ",") end

-- clips: back to back, each starting as the one before ends, the last ending at 0; then the text at 0
for _, case in ipairs({ { "xavier", 3, false }, { "xavier", 5, false }, { "xavier", 3, true }, { "lola", 3, false }, { "lola", 5, false } }) do
  local voice, from, atZero = case[1], case[2], case[3]
  local secs = byKey[voice].seconds
  local out = runCount(voice, { countFrom = from, atZero = atZero })
  local want, total = {}, 0
  for n = from, 1, -1 do want[#want + 1] = tostring(n) total = total + secs[tostring(n)] end
  want[#want + 1] = "Soak"
  local label = voice .. ", count from " .. from .. (atZero and ", At 0" or ", On show")
  check(label .. ": " .. table.concat(want, ", "), order(out) == table.concat(want, ","), names(out))
  local ok, at = #out == from + 1, 20 - total
  for i = 1, from do
    local o = out[i]
    if not (o and math.abs(o.at - at) <= 0.02) then ok = false end
    at = at + secs[tostring(from - i + 1)]
  end
  check(label .. ": the numbers back to back, the last ending at 0 (within 0.02 s)", ok and math.abs(at - 20) <= 1e-6, names(out))
  local soak = of(out, "Soak")
  check(label .. ": the text at 0", soak and math.abs(soak.at - 20) <= 0.02, names(out))
end
-- the phrase's length is what the alert's speech list says (its show time follows it)
do
  CRT.db.sound.voice = "xavier"
  local list = Rules.SpeechItems("Soak", 1, true, true, false, { countFrom = 5 })
  local total = 0
  for n = 5, 1, -1 do total = total + X.seconds[tostring(n)] end
  check("the count's item starts the phrase's length before 0", list[1].countFrom == 5 and math.abs(list[1].offset - total) <= 1e-9
    and list[2].afterCount and list[2].offset == 0, tostring(list[1].offset))
  check("Rules.CountSeconds is the same length", math.abs(Rules.CountSeconds(5) - total) <= 1e-9)
end
-- the Sound cue at 0 is unchanged
do
  local out, _, t0 = runCount("xavier", { countFrom = 3, sound = "kit:RAID_WARNING" })
  local cue = kits[1]
  check("the Sound cue still plays at 0, with the quick count", cue and math.abs(cue.at - t0 - 20) <= 0.01 and of(out, "Soak") ~= nil,
    cue and string.format("%.3f", cue.at - t0))
end
-- count without Speak the text: the phrase alone
do
  local out = runCount("xavier", { countFrom = 3, speak = false })
  check("count without the text: the phrase alone", order(out) == "3,2,1", names(out))
end
-- a count the voice has no clips for (from 10: no 10 clip): the whole count read out as one line
do
  local out = runCount("xavier", { countFrom = 10 })
  check("count from 10 with Xavier (no 10 clip): one line read out, numbers and text", #out == 1 and out[1].what == "tts:10, 9, 8, 7, 6, 5, 4, 3, 2, 1, Soak", names(out))
end

-- the game's text to speech: one line, the numbers and the text, started an estimate before 0
for _, rate in ipairs({ 0, 5 }) do
  CRT.db.notes.alert.ttsRate = rate
  local out = runCount("tts", { countFrom = 3 })
  local lead = 3 * Speech.TTS_COUNT_LEAD * 2 ^ (-rate / 10)
  check("text to speech at rate " .. rate .. ": one line, 3, 2, 1, Soak", #out == 1 and out[1].what == "tts:3, 2, 1, Soak", names(out))
  check("text to speech at rate " .. rate .. ": started " .. string.format("%.2f", lead) .. " s before 0", out[1] and math.abs(out[1].at - (20 - lead)) <= 0.02, names(out))
end
CRT.db.notes.alert.ttsRate = 0
do
  local _, list = runCount("tts", { countFrom = 5, text = "Stack" })
  check("the count's item carries the text said after it", list[1].thenText == "Stack")
end

-- the one line says the text once: another line holding the speaker across the lead, so the phrase and the text are
-- both queued by 0, and a run that starts inside the lead, so both come due on the first tick
do
  local fired = false
  local out = runCount("tts", { countFrom = 3, each = function(t)
    if not fired and t >= 20.2 then fired = true fire("VOICE_CHAT_TTS_PLAYBACK_FINISHED") end
  end }, { { id = "hold", ph = 1, time = 18.5, text = "Stack on Abu", priority = 21, outputs = { speech = true }, speech = { { offset = 0, text = "Stack on Abu" } } } })
  local lines, soak = 0, 0
  for _, o in ipairs(out) do
    if o.what == "tts:3, 2, 1, Soak" then lines = lines + 1 end
    if o.what == "tts:Soak" then soak = soak + 1 end
  end
  check("text to speech held across the lead: one line with the text, no separate Soak", lines == 1 and soak == 0, names(out))
end
do
  CRT.db.sound.voice = "tts"
  local list = {}
  for i, s in ipairs(Rules.SpeechItems("Soak", 8, true, true, false, { countFrom = 3 })) do list[i] = s end
  items = { { id = "inlead", ph = 1, time = 0.05, text = "Soak", priority = 21, outputs = { speech = true }, speech = list } }
  reset()
  Alerts:Start(1, "Mythic", "test")
  for i = 1, 300 do step(0.01) if i % 10 == 0 then fire("VOICE_CHAT_TTS_PLAYBACK_FINISHED") end end
  Alerts:Stop()
  local texts = {}
  for _, s in ipairs(said) do texts[#texts + 1] = tostring(s.text) end
  check("text to speech, phrase and text due on the same tick: one line, no separate Soak", table.concat(texts, "|") == "3, 2, 1, Soak", table.concat(texts, "|"))
end

-- a rehearsal speed change away from 1x, and Hush, mid-phrase drop the clips still to come
for _, how in ipairs({ "speed", "hush" }) do
  CRT.db.sound.voice = "xavier"
  local saved = { IsRehearsal = Alerts.IsRehearsal, Now = Alerts.Now, RehearsalTick = Alerts.RehearsalTick, RehearsalSpeed = Alerts.RehearsalSpeed }
  local speed = 1
  Alerts.IsRehearsal = function() return true end
  Alerts.RehearsalSpeed = function() return speed end
  Alerts.RehearsalTick = function() return false, speed, nil end
  Alerts.Now = function() return clock end
  local list = {}
  for i, s in ipairs(Rules.SpeechItems("Soak", 8, true, true, false, { countFrom = 5 })) do list[i] = s end
  items = { { id = "cut" .. how, ph = 1, time = 20, text = "Soak", priority = 21, outputs = { speech = true }, speech = list } }
  reset()
  Alerts:Start(1, "Mythic", "test")
  local t0 = clock
  local total = 0
  for n = 5, 1, -1 do total = total + X.seconds[tostring(n)] end
  local mid = 20 - total + X.seconds["5"] + 0.1 -- the 4 is playing
  while clock - t0 < mid do step(0.01) end
  local n0 = #played
  if how == "speed" then speed = 2 else Speech:Hush() end
  for i = 1, 300 do step(0.01) end
  Alerts:Stop()
  for k, fn in pairs(saved) do Alerts[k] = fn end
  local later = {}
  for i = n0 + 1, #played do later[#later + 1] = played[i].path:match("([^\\\\]+)%.mp3$") end
  local numbers = 0
  for _, w in ipairs(later) do if tonumber(w) then numbers = numbers + 1 end end
  check((how == "speed" and "a speed change to 2x" or "Hush") .. " mid-phrase drops the numbers still to come", n0 == 2 and numbers == 0,
    n0 .. " then " .. table.concat(later, ","))
end

-- Before 0 is unchanged: the text early, the numbers after it on their seconds
do
  local out = runCount("xavier", { countFrom = 5, before = 3 })
  local function sec(n) local o = of(out, tostring(n)) return o and math.abs(o.at - (20 - n)) <= 0.15 end
  check("Before 0 at 3 s, count from 5: Soak at 3 s, then 2 and 1 on their seconds", of(out, "Soak") and math.abs(of(out, "Soak").at - 17) <= 0.15
    and of(out, "3") == nil and sec(2) and sec(1), names(out))
end
-- a word clip right before the numbers at Before 0 (at 4 s): 3 starts in Soak's last quarter second
do
  local out = runCount("xavier", { countFrom = 3, before = 4, warn = 4 })
  local soak, three = of(out, "Soak"), of(out, "3")
  check("Before 0 at 4 s: 3 starts in Soak's last quarter second, then 2 and 1 a second apart",
    soak and three and three.at - soak.at >= X.seconds.Soak - 0.25 - 1e-6 and math.abs(of(out, "2").at - 18) <= 0.15 and math.abs(of(out, "1").at - 19) <= 0.15, names(out))
end

-- while the phrase plays, a finished event frees nothing: a line due mid-phrase waits for the phrase's end
do
  local total = X.seconds["3"] + X.seconds["2"] + X.seconds["1"]
  local fired = false
  local out = runCount("xavier", { countFrom = 3, speak = false, each = function(t)
    if not fired and t >= 19.5 then fired = true fire("VOICE_CHAT_TTS_PLAYBACK_FINISHED") end
  end }, { { id = "mid", ph = 1, time = 19.3, text = "Spread", priority = 21, outputs = { speech = true }, speech = { { offset = 0, text = "Spread" } } } })
  local spread = of(out, "Spread")
  check("a line due mid-phrase waits for its end, even with a finished event", spread and spread.at >= 20 - 1e-6, names(out))
end

-- A count's text, Lola: the phrase ends at 0, then the text
local function textItems(id)
  local list = {}
  for i, s in ipairs(Rules.SpeechItems("Soak", 8, true, true, false, { countFrom = 3 })) do list[i] = s end
  return { { id = id, ph = 1, time = 20, text = "Soak", priority = 21, outputs = { speech = true }, speech = list } }
end
local function soaks() local n = 0 for _, p in ipairs(played) do if p.path:find("Soak%.mp3$") then n = n + 1 end end for _, s in ipairs(said) do if s.text == "Soak" then n = n + 1 end end return n end

-- a paused rehearsal just before the text: no timer chain, nothing said; once it plays again, the text once
do
  CRT.db.sound.voice = "lola"
  local saved = { IsRehearsal = Alerts.IsRehearsal, Now = Alerts.Now, RehearsalTick = Alerts.RehearsalTick, RehearsalSpeed = Alerts.RehearsalSpeed }
  local paused, frozen, lost = false, nil, 0
  Alerts.IsRehearsal = function() return true end
  Alerts.RehearsalSpeed = function() return 1 end
  Alerts.RehearsalTick = function() return paused, 1, nil end
  Alerts.Now = function() return frozen or (clock - lost) end
  items = textItems("pause")
  reset()
  Alerts:Start(1, "Mythic", "test")
  local t0 = clock
  while clock - t0 < 19.94 do step(0.01) end
  paused, frozen = true, Alerts:Now()
  local before, n0 = armed, #played
  for i = 1, 200 do step(0.01) end
  local during = armed - before
  check("paused just before the text: no timer chain, nothing said", during <= 1 and #played == n0 and soaks() == 0,
    "timers " .. during .. ", played " .. (#played - n0))
  lost = clock - frozen
  paused, frozen = false, nil
  for i = 1, 100 do step(0.01) end
  check("playing again: the text, once", soaks() == 1, soaks())
  Alerts:Stop()
  for k, fn in pairs(saved) do Alerts[k] = fn end
end

-- a timer left from a run plays nothing: after Stop, and after a new Start, in the phrase and just before the text
for _, how in ipairs({ "stop", "start" }) do
  for _, cut in ipairs({ 19.5, 19.95 }) do
    CRT.db.sound.voice = "lola"
    items = textItems("stale" .. how .. cut)
    reset()
    Alerts:Start(1, "Mythic", "test")
    local t0 = clock
    while clock - t0 < cut do step(0.01) end
    local n0 = #played
    if how == "stop" then
      Alerts:Stop()
    else
      items = {}
      Alerts:Start(1, "Mythic", "test")
    end
    for i = 1, 100 do step(0.01) end
    check("a run that ended at " .. cut .. " s (" .. how .. ") plays nothing more", #played == n0 and soaks() == 0, names({}) .. (#played - n0))
    Alerts:Stop()
  end
end
CRT.db.sound.voice = "xavier"

-- Quality of Life > Sounds: the Voice dropdown, Test and (?) ---------------------------------------------
local dropdowns, helps, build = {}, {}, nil
CRT.UI = {
  RegisterPage = function(_, key, title, fn) build = fn end,
  Dropdown = function(parent, text, opts) local r = mock() rawset(r, "label", text) rawset(r, "opts", opts) r.refresh = function() end dropdowns[text] = r return r end,
  Slider = function() local r = mock() r.refresh = function() end return r end,
  HelpRight = function(target, title, text) helps[#helps + 1] = { target = target, title = title, text = text } return mock() end,
  PreviewButton = function() return mock() end,
  RegisterTab = function() end, SetTabSelected = function() end,
  GoodText = function(s) return s end, BadText = function(s) return s end,
}
CRT.LowHealth = {}
CRT.LowHealthSound = { Choices = function() return {} end, Outputs = {}, StopPreview = function() end }
CRT.DebuffsPage = { Build = function() end }
CRT.BreakFormats = { FORMATS = {} }
assert(load(pageSrc, "@page"))("CowfeeRaidTools", CRT)
check("QoL page registers", build ~= nil)
build(mock())
local v = dropdowns.Voice
check("Sounds has a Voice dropdown", v ~= nil)
if v then
  local opts = type(v.opts.options) == "function" and v.opts.options() or v.opts.options
  local keys = {}
  for _, o in ipairs(opts) do keys[#keys + 1] = o.key .. "=" .. o.label end
  check("its choices: Xavier, Lola, game text to speech", table.concat(keys, ",") == "xavier=Xavier (male),lola=Lola (female),tts=Game text to speech", table.concat(keys, ","))
  check("it shows the saved voice", v.opts.get() == "xavier")
  v.opts.set("lola")
  check("picking saves sound.voice", CRT.db.sound.voice == "lola")
  CRT.db.sound.voice = nil
  check("no saved voice shows Xavier", v.opts.get() == "xavier")
  CRT.db.sound.voice = "lola"
  check("the row has a Test button", v.test ~= nil and v.test.OnClick ~= nil)
  reset()
  if v.test and v.test.OnClick then v.test.OnClick(v.test) end
  check("Test speaks with the chosen voice", #played == 1 and lastFile():find("^Lola\\\\"), lastFile())
  CRT.db.sound.voice = "tts"
  CRT.db.notes.alert.ttsRate, CRT.db.notes.alert.ttsVolume = 3, 60
  reset()
  if v.test and v.test.OnClick then v.test.OnClick(v.test) end
  check("Test with the tts voice speaks at the Raid Notes rate and volume", said[1] and said[1].rate == 3 and said[1].vol == 60 and #played == 0)
  CRT.db.sound.voice = "lola"
  check("Test is sized from its label", v.test and v.test.w and v.test.w >= #(v.test.text or "") * 7)
  local note
  for _, h in ipairs(helps) do if h.target == (v.test or v) then note = h.text end end
  local function read() local t = type(note) == "function" and note() or note return type(t) == "string" and t or "" end
  check("a (?) beside it says what the voice does and that clips take no volume, with no missing words while none are",
    read():find("text to speech", 1, true) and read():find("has no", 1, true) == nil and read():find("volume", 1, true), read())
  local was = Lo.lacks
  Lo.lacks = { "Void" }
  check("the (?) reads voice names and missing words from the voice table", read():find("West", 1, true) == nil
    and read():find("Lola has no Void, so", 1, true) ~= nil and read():find("Xavier and Lola", 1, true) ~= nil, read())
  Lo.lacks = was
end

-- The low-health Sound list: the game's pulse sits under the Game sounds heading
CRT.LowHealthSound = nil
hooksecurefunc = function() end
local okLH, errLH = pcall(function() assert(load(lowHealthSrc, "@lowhealth"))("CowfeeRaidTools", CRT) end)
check("LowHealthSound.lua loads", okLH and CRT.LowHealthSound ~= nil, errLH)
if okLH and CRT.LowHealthSound then
  local lh, gi, n = CRT.LowHealthSound.Choices(), nil, 0
  for i, c in ipairs(lh) do
    if c.title and c.label == "Game sounds" then gi = i end
    if c.key == "pulse" then n = n + 1 end
  end
  check("Game pulse is first under Game sounds, once", gi and lh[gi + 1] and lh[gi + 1].key == "pulse" and n == 1, gi)
end
print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error(failed .. " checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
// An mp3's length from its MPEG-1 Layer III frame headers (after any ID3v2 tag), in seconds.
const BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], RATE = [44100, 48000, 32000];
function id3Length(b) { return b.length >= 10 && b.slice(0, 3).toString() === 'ID3' ? 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + ((b[5] & 0x10) ? 10 : 0) : 0; }
function seconds(b) {
  let i = id3Length(b), t = 0;
  while (i + 4 <= b.length) {
    if (b[i] === 0xFF && (b[i + 1] & 0xE0) === 0xE0) {
      const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bi = b[i + 2] >> 4, si = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
      if (ver === 3 && layer === 1 && bi > 0 && bi < 15 && si < 3) { t += 1152 / RATE[si]; i += Math.floor(144 * BITRATE[bi] * 1000 / RATE[si]) + pad; continue; }
    }
    i++;
  }
  return t;
}
// the files on disk, by folder: { Xavier = { ["Soak.mp3"] = { seconds, tag, meta }, ... } }
lua.lua_newtable(L);
for (const v of ['Xavier', 'Lola']) {
  lua.lua_newtable(L);
  const dir = path.join(d, 'CRT_Media', 'Media', 'Sounds', v);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const b = fs.readFileSync(path.join(dir, f));
    lua.lua_newtable(L);
    lua.lua_pushnumber(L, seconds(b)); lua.lua_setfield(L, -2, to_luastring('seconds'));
    lua.lua_pushboolean(L, id3Length(b) > 0 ? 1 : 0); lua.lua_setfield(L, -2, to_luastring('tag'));
    lua.lua_pushboolean(L, (b.indexOf('GEOB') >= 0 || b.indexOf('c2pa') >= 0) ? 1 : 0); lua.lua_setfield(L, -2, to_luastring('meta'));
    lua.lua_setfield(L, -2, to_luastring(f));
  }
  lua.lua_setfield(L, -2, to_luastring(v));
}
const files = ['CRT_Core/Sound/Engine.lua', 'CRT_Core/Sound/Voices.lua', 'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua', 'CRT_Modules/QoL/Page.lua', 'CRT_Modules/QoL/LowHealthSound.lua'];
for (const f of files) { const p = path.join(d, f); lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '')); }
if (lua.lua_pcall(L, files.length + 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
