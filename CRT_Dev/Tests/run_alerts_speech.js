// Alerts/Speech.lua: the speech queue. Real Rules + Engine + Speech with a mocked clock and TTS.
// Args: Alerts/Rules.lua Alerts/Engine.lua Alerts/Speech.lua
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
local function step(dt)
  clock = clock + dt
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
assert(printed[1]:find("read out even with the next-spell alert off", 1, true) and printed[1]:find("Untick 'Read them out'", 1, true), printed[1])
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
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
if (files.length < 3) { console.error('usage: node run_alerts_speech.js Rules Engine Speech'); process.exit(2); }
for (const f of files) lua.lua_pushstring(L, to_luastring(fs.readFileSync(f, 'utf8')));
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
