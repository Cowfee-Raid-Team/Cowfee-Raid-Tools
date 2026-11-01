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

-- The alert speech queue: a count says 3, 2, 1 with the number clips, on time ---------------------------
local items = {}
Alerts:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })
local spoken = {}
for i, s in ipairs(Rules.SpeechItems("Soak", 5, true, true)) do spoken[i] = s end
items = { { id = "c", ph = 1, time = 10, text = "Soak", priority = 21, outputs = { alert = true, speech = true }, speech = spoken } }
reset()
Alerts:Start(1, "Mythic", "test")
local start = clock
for i = 1, 120 do step(0.1) end
local seq = {}
for _, p in ipairs(played) do seq[#seq + 1] = p.path:match("([^\\\\]+)%.mp3$") .. "@" .. string.format("%.1f", p.at - start) end
check("the count plays 3, 2, 1, then Soak, as clips", #played == 4 and #said == 0 and seq[1]:find("^3@") and seq[2]:find("^2@") and seq[3]:find("^1@") and seq[4]:find("^Soak@"), table.concat(seq, " "))
local function near(i, t) local p = played[i] return p and math.abs((p.at - start) - t) <= 0.15 end
check("each number on its second, not held by the speech timeout", near(1, 7) and near(2, 8) and near(3, 9), table.concat(seq, " "))
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
-- a word clip longer than a second right before the count (Speak at: Before 0, at 4 s): the numbers keep their second
local tight = {}
for i, s in ipairs(Rules.SpeechItems("Soak", 4, true, true, false, { before = 4 })) do tight[i] = s end
items = { { id = "e", ph = 1, time = 10, text = "Soak", priority = 21, outputs = { speech = true }, speech = tight } }
reset()
Alerts:Start(1, "Mythic", "test")
start = clock
for i = 1, 120 do step(0.1) end
local gaps = {}
for i = 2, #played do gaps[#gaps + 1] = string.format("%.1f", played[i].at - played[i - 1].at) end
check("Soak (over a second) then 3: 3 starts in Soak's last quarter second, and 3, 2, 1 are each on their second",
  #played == 4 and played[2].at - played[1].at >= X.seconds.Soak - 0.25 - 1e-6 and near(2, 7) and near(3, 8) and near(4, 9), table.concat(gaps, " ") .. " last at " .. (played[4] and string.format("%.2f", played[4].at - start) or "-"))
CRT.db.sound.voice = "tts"
items = { { id = "d", ph = 1, time = 6, text = "Soak", priority = 21, outputs = { speech = true }, speech = spoken } }
reset()
Alerts:Start(1, "Mythic", "test")
for i = 1, 80 do step(0.1) fire("VOICE_CHAT_TTS_PLAYBACK_FINISHED") end
check("the tts voice reads the count out", #played == 0 and #said == 4)
CRT.db.sound.voice = "xavier"
Alerts:Stop()

-- Counts from 5 and from 10 (Rules.SpeechItems opts.countFrom), and Speak at: Before 0 (opts.before)
local function runCount(text, warn, opts, seconds)
  local list = {}
  for i, s in ipairs(Rules.SpeechItems(text, warn, true, true, false, opts)) do list[i] = s end
  items = { { id = "k" .. tostring(opts.countFrom) .. tostring(opts.before), ph = 1, time = 20, text = text, priority = 21,
    outputs = { speech = true }, speech = list } }
  reset()
  Alerts:Start(1, "Mythic", "test")
  local t0 = clock
  for i = 1, (seconds or 25) * 10 do step(0.1) end
  local out = {}
  for _, p in ipairs(played) do out[#out + 1] = { what = p.path:match("([^\\\\]+)%.mp3$"), at = p.at - t0 } end
  for _, s in ipairs(said) do out[#out + 1] = { what = "tts:" .. tostring(s.text), at = s.at - t0 } end
  table.sort(out, function(a, b) return a.at < b.at end)
  return out
end
local function show(out) local t = {} for _, o in ipairs(out) do t[#t + 1] = o.what .. "@" .. string.format("%.1f", o.at) end return table.concat(t, " ") end
local function find(out, what) for _, o in ipairs(out) do if o.what == what then return o end end end
local function onSecond(out, n) local o = find(out, tostring(n)) return o and math.abs(o.at - (20 - n)) <= 0.15 end

local c5 = runCount("Soak", 8, { countFrom = 5 })
check("a count from 5 plays 5, 4, 3, 2, 1 as clips, each on its second",
  find(c5, "Soak") and onSecond(c5, 5) and onSecond(c5, 4) and onSecond(c5, 3) and onSecond(c5, 2) and onSecond(c5, 1) and #said == 0
    and find(c5, "5seconds321") == nil, show(c5))
local function exactSecond(out, n) local o = find(out, tostring(n)) return o and math.abs(o.at - (20 - n)) <= 0.005 end
check("a count from 5: each number within 5 ms of its second",
  exactSecond(c5, 5) and exactSecond(c5, 4) and exactSecond(c5, 3) and exactSecond(c5, 2) and exactSecond(c5, 1), show(c5))
local c10 = runCount("Soak", 12, { countFrom = 10 })
local ten = find(c10, "tts:10")
check("a count from 10: 10 has no clip and is read out", ten ~= nil and math.abs(ten.at - 10) <= 0.15, show(c10))
check("then 9 is still on its second, with the 9 clip, and so on down to 1",
  onSecond(c10, 9) and onSecond(c10, 8) and onSecond(c10, 5) and onSecond(c10, 1) and find(c10, "5seconds321") == nil, show(c10))
local cb = runCount("Soak", 8, { countFrom = 5, before = 3 })
check("Speak at Before 3 inside a count from 5: Soak at 3 s, then 2 and 1 each on their second",
  find(cb, "Soak") and math.abs(find(cb, "Soak").at - 17) <= 0.15 and find(cb, "3") == nil
    and onSecond(cb, 2) and onSecond(cb, 1) and find(cb, "2").at - find(cb, "Soak").at >= X.seconds.Soak - 0.25 - 1e-6, show(cb))
-- a late finished event (for the read-out 10) while the 9 clip plays frees nothing: Spread, due mid-clip, waits for the clip
do
  local list = {}
  for i, s in ipairs(Rules.SpeechItems("Soak", 12, true, true, false, { countFrom = 10 })) do list[i] = s end
  items = {
    { id = "f10", ph = 1, time = 20, text = "Soak", priority = 21, outputs = { speech = true }, speech = list },
    { id = "fs", ph = 1, time = 11.2, text = "Spread", priority = 21, outputs = { speech = true }, speech = { { offset = 0, text = "Spread" } } },
  }
  reset()
  Alerts:Start(1, "Mythic", "test")
  local t0 = clock
  for i = 1, 113 do step(0.1) end -- 9 started at 11; Spread is queued
  fire("VOICE_CHAT_TTS_PLAYBACK_FINISHED")
  for i = 1, 30 do step(0.1) end
  local nine, spread
  for _, p in ipairs(played) do
    if p.path:find("9%.mp3$") and not nine then nine = p.at - t0 end
    if p.path:find("Spread%.mp3$") then spread = p.at - t0 end
  end
  check("a finished event while a clip plays doesn't free the speaker", nine and spread and spread - nine >= 0.95,
    tostring(nine) .. " " .. tostring(spread))
end
Alerts:Stop()

-- With Count down on: the numbers, then the text, straight after "1" (Alex, 2026-11-01) -----------------------
local function countThenText(voice, atZero, sound)
  CRT.db.sound.voice = voice
  local list = {}
  for i, s in ipairs(Rules.SpeechItems("Soak", 8, true, true, atZero, { countFrom = 5 })) do list[i] = s end
  items = { { id = "ct" .. voice .. tostring(atZero), ph = 1, time = 20, text = "Soak", priority = 21, sound = sound,
    outputs = { speech = true }, speech = list } }
  reset()
  kits = {}
  Alerts:Start(1, "Mythic", "test")
  local t0 = clock
  for i = 1, 250 do step(0.1) end
  Alerts:Stop()
  local out = {}
  for _, p in ipairs(played) do out[#out + 1] = { what = p.path:match("([^\\\\]+)%.mp3$"), at = p.at - t0 } end
  for _, s in ipairs(said) do out[#out + 1] = { what = "tts:" .. tostring(s.text), at = s.at - t0 } end
  table.sort(out, function(a, b) return a.at < b.at end)
  return out, t0
end
local function names(out) local t = {} for _, o in ipairs(out) do t[#t + 1] = o.what .. "@" .. string.format("%.2f", o.at) end return table.concat(t, " ") end
local function of(out, what) for _, o in ipairs(out) do if o.what == what then return o end end end
for _, case in ipairs({ { "xavier", false }, { "xavier", true }, { "lola", false } }) do
  local voice, atZero = case[1], case[2]
  local out = countThenText(voice, atZero)
  local order = {}
  for _, o in ipairs(out) do order[#order + 1] = o.what end
  local one, soak = of(out, "1"), of(out, "Soak")
  local secs = byKey[voice].seconds["1"]
  local want = one and math.max(20, one.at + secs)
  check(voice .. (atZero and ", At 0" or ", On show") .. ": 5, 4, 3, 2, 1, then Soak", table.concat(order, ",") == "5,4,3,2,1,Soak", names(out))
  check(voice .. (atZero and ", At 0" or ", On show") .. ": Soak starts as the 1 clip ends, at 0 at the earliest, without waiting a tick",
    soak and want and soak.at >= want - 1e-6 and soak.at <= want + 0.01, names(out))
end
do
  local out, t0 = countThenText("xavier", false, "kit:RAID_WARNING")
  local cue = kits[1]
  check("the Sound cue still plays at 0, with the text after the count", cue and math.abs(cue.at - t0 - 20) <= 0.01 and of(out, "Soak") ~= nil,
    cue and string.format("%.3f", cue.at - t0))
end
CRT.db.sound.voice = "xavier"

-- A count's text, Lola (her "1" ends before 0, so the text waits for its own time)
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

-- a wake timer left from a run says nothing: after Stop, and after a new Start
for _, how in ipairs({ "stop", "start" }) do
  CRT.db.sound.voice = "lola"
  items = textItems("stale" .. how)
  reset()
  Alerts:Start(1, "Mythic", "test")
  local t0 = clock
  while clock - t0 < 19.95 do step(0.01) end -- the text's timer is armed, under a tick away
  if how == "stop" then
    Alerts:Stop()
  else
    items = {}
    Alerts:Start(1, "Mythic", "test")
  end
  for i = 1, 50 do step(0.01) end
  check("a wake timer from a run that ended (" .. how .. ") says nothing", soaks() == 0 and (Speech.wakeAt == nil or how == "start"), soaks())
  Alerts:Stop()
end

-- the game's text to speech: the text waits for the finished event after "1", and never starts before 0
for _, finishAt in ipairs({ 19.5, 20.3 }) do
  CRT.db.sound.voice = "tts"
  items = textItems("tts" .. finishAt)
  reset()
  Alerts:Start(1, "Mythic", "test")
  local t0 = clock
  local fired = false
  local soakAt
  while clock - t0 < 22 do
    step(0.01)
    if not fired and clock - t0 >= finishAt then fired = true fire("VOICE_CHAT_TTS_PLAYBACK_FINISHED") end
    if not soakAt then for _, s in ipairs(said) do if s.text == "Soak" then soakAt = s.at - t0 end end end
  end
  local want = math.max(20, finishAt)
  check("text to speech: 1 finished at " .. finishAt .. " s, the text at " .. want .. " s", soakAt and soakAt >= want - 1e-6 and soakAt <= want + 0.015,
    tostring(soakAt))
  Alerts:Stop()
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
