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
function PlaySound() return true end
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
C_Timer = { After = function() end }
local function step(dt) clock = clock + dt for _, f in ipairs(frames) do if f.OnUpdate then f.OnUpdate(f, dt) end end end

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
check("Xavier has 70 words, Lola 67", #X.words == 70 and #Lo.words == 67, #X.words .. " " .. #Lo.words)
local lolaHas = {}
for _, w in ipairs(Lo.words) do lolaHas[w] = true end
check("Lola has no Void, West or Yellow", not lolaHas.Void and not lolaHas.West and not lolaHas.Yellow and lolaHas.Soak)

-- crt: references, and the groups in every sound list ---------------------------------------------------
local soak = Sound:Resolve("crt:Xavier-Soak")
check("crt:Xavier-Soak plays Xavier's Soak.mp3", soak and soak.kind == "file" and soak.paths[1] == Sound.BUNDLED_FOLDER .. "Xavier\\\\Soak.mp3", soak and soak.paths[1])
check("crt:Lola-Run-Out resolves", Sound:Resolve("crt:Lola-Run-Out") ~= nil)
check("crt:Lola-Void is no sound", Sound:Resolve("crt:Lola-Void") == nil)
local list = Sound:Choices({ none = "None" })
local order, at = {}, {}
for i, c in ipairs(list) do if c.title then order[#order + 1] = c.label at[c.label] = i end end
check("titles Xavier, Lola, then Game sounds", table.concat(order, ",") == "Xavier,Lola,Game sounds", table.concat(order, ","))
check("None comes first", list[1].key == "none")
check("Xavier's clips under Xavier", list[at.Xavier + 1].key == "crt:Xavier-0" and at.Lola - at.Xavier - 1 == 70, list[at.Xavier + 1].key)
check("Lola's clips under Lola", list[at.Lola + 1].key == "crt:Lola-0" and at["Game sounds"] - at.Lola - 1 == 67)
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
  check("Lola's missing " .. w .. " falls back to text to speech", #played == 0 and said[1] and said[1].text == w)
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
check("the count plays Soak, 3, 2, 1 as clips", #played == 4 and #said == 0 and seq[1]:find("^Soak") and seq[2]:find("^3@") and seq[3]:find("^2@") and seq[4]:find("^1@"), table.concat(seq, " "))
local function near(i, t) local p = played[i] return p and math.abs((p.at - start) - t) <= 0.15 end
check("each number on its second, not held by the speech timeout", near(1, 5) and near(2, 7) and near(3, 8) and near(4, 9), table.concat(seq, " "))
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
-- a word clip longer than a second right before the count: the count's numbers keep their one second after it
local tight = {}
for i, s in ipairs(Rules.SpeechItems("Soak", 4, true, true)) do tight[i] = s end
items = { { id = "e", ph = 1, time = 10, text = "Soak", priority = 21, outputs = { speech = true }, speech = tight } }
reset()
Alerts:Start(1, "Mythic", "test")
start = clock
for i = 1, 120 do step(0.1) end
local gaps = {}
for i = 2, #played do gaps[#gaps + 1] = string.format("%.1f", played[i].at - played[i - 1].at) end
check("Soak (1.18 s) then 3 waits for Soak; 2 and 1 a second after the number before, late by no more than Soak ran over",
  #played == 4 and played[2].at - played[1].at >= X.seconds.Soak - 1e-6 and played[3].at - played[2].at <= 1.0 + 1e-6 and played[4].at - played[3].at <= 1.0 + 1e-6
    and played[4].at - start <= 9 + (X.seconds.Soak - 1) + 0.15, table.concat(gaps, " ") .. " last at " .. (played[4] and string.format("%.2f", played[4].at - start) or "-"))
CRT.db.sound.voice = "tts"
items = { { id = "d", ph = 1, time = 6, text = "Soak", priority = 21, outputs = { speech = true }, speech = spoken } }
reset()
Alerts:Start(1, "Mythic", "test")
for i = 1, 80 do step(0.1) fire("VOICE_CHAT_TTS_PLAYBACK_FINISHED") end
check("the tts voice reads the count out", #played == 0 and #said == 4)
CRT.db.sound.voice = "xavier"
Alerts:Stop()

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
  check("a (?) beside it says what the voice does, the missing words and that clips take no volume",
    read():find("text to speech", 1, true) and read():find("Lola has no Void, West or Yellow", 1, true) and read():find("volume", 1, true), read())
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
