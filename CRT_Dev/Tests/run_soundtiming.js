// CRT_Dev/Dev/SoundTiming.lua: the dev sound timing probe. Real Rules + Engine + Sound + Speech + the probe, a
// mocked clock, C_Timer and debugprofilestop.
// Args: Rules.lua Engine.lua Sound/Engine.lua Speech.lua Dev/SoundTiming.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local files = { ... }
local clock = 100
function GetTime() return clock end
function debugprofilestop() return clock * 1000 end
function GetFramerate() return 100 end
function time() return 0 end
function date() return "today" end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
C_TTSSettings = { GetVoiceOptionID = function() return 7 end }
C_VoiceChat = { SpeakText = function() end }
local timers = {}
C_Timer = { After = function(d, fn) timers[#timers + 1] = { due = clock + d, fn = fn } end }
local played = 0
function PlaySound() played = played + 1 return true end
local frames = {}
function CreateFrame()
  local f = { events = {}, scripts = {} }
  function f:RegisterEvent(ev) self.events[ev] = true end
  function f:SetScript(k, fn) self.scripts[k] = fn end
  frames[#frames + 1] = f
  return f
end
local function step(dt)
  clock = clock + dt
  for i = #timers, 1, -1 do
    if timers[i].due <= clock + 1e-9 then table.remove(timers, i).fn() end
  end
  for _, f in ipairs(frames) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, dt) end end
end
local function run(seconds) for _ = 1, math.floor(seconds / 0.01 + 0.5) do step(0.01) end end
local printed, shownText = {}, nil
local CRT = { db = { notes = { alert = { tts = true } }, alerts = {} },
  Print = function(_, m) printed[#printed + 1] = m end,
  ConsumablesTools = { ShowText = function(_, title, text) shownText = text end } }
for i, src in ipairs(files) do assert(load(src, "@f" .. i))("CowfeeRaidTools", CRT) end
local A, R, P = CRT.Alerts, CRT.AlertRules, CRT.SoundTimingProbe
assert(P and P.Command, "probe loaded")

local items = {}
A:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })

-- off: nothing is logged; the command words
assert(P:Command("dev soundtiming show") and printed[#printed]:find("no log yet"), "no log yet")
assert(P:Command("dev sound") == false and P:Command("dev soundtimingx") == false, "other commands are not its")
items = { { id = "c", ph = 1, time = 1.03, text = "Soak", sound = "RAID_WARNING", outputs = { alert = true, text = true },
  speech = { { offset = 0, text = "Soak" } } } }
items[1].outputs.speech = true
A:Start(1, "Mythic", "test")
run(2)
assert(played == 1 and (CRT.db.dev == nil or CRT.db.dev.soundTiming == nil or #(CRT.db.dev.soundTiming.lines or {}) == 0), "off logs nothing")

-- on: a fresh log of the cue, the display's first 0 and the spoken line
P:Command("dev soundtiming")
assert(CRT.db.dev.soundTiming.on == true, "on")
A:Start(1, "Mythic", "test")
run(1.03)
-- a display draws the line's 0 twice: logged once
local line = A:Lines(A:Now())[1]
R.Countdown(line.at - A:Now(), false, "texts", line)
run(0.01)
R.Countdown(line.at - A:Now(), false, "texts", line)
-- a bar counting to an impact half a second before the line's own time: logged against the impact
R.Countdown(-0.002, nil, "bars", line, line.at - 0.5)
run(1)
P:Command("dev soundtiming show")
assert(shownText, "log shown")
local lines = CRT.db.dev.soundTiming.lines
local all = table.concat(lines, "\\n")
assert(lines[1]:find("^%-%- run %d+: test, encounter 1, 1x, 100 fps"), "run header: " .. lines[1])
assert(all:find("cue c#sound played %+0 ms after 0 %(timer, 1x%)"), "the cue, on time by its timer: " .. all)
local zeros = 0
for _, l in ipairs(lines) do if l:find("texts shows 0 for c") then zeros = zeros + 1 end end
assert(zeros == 1 and all:find("texts shows 0 for c, %+0 ms after 0"), "the display's first 0, once: " .. all)
assert(all:find("0%.530 bars shows 0 for c, %+2 ms after 0"), "a bar's impact, at the impact's time: " .. all)
assert(all:find('said "Soak": started %+%d+ ms after its time'), "the spoken line: " .. all)
assert(all:find("%[%s*%d+%.%d%]%s+1%.030 cue"), "real ms and fight seconds: " .. all)
print("ok soundtiming: cue, display zero and speech logged")

-- off keeps the log; a rate off 1x gives the real ms too
P:Command("dev soundtiming off")
assert(#CRT.db.dev.soundTiming.lines == #lines and CRT.db.dev.soundTiming.on == false, "off keeps the log")
assert(P.Gap(0.02, 2) == "+20 ms (+10 ms real)" and P.Gap(-0.005, 1) == "-5 ms", P.Gap(0.02, 2))
print("ok soundtiming: off keeps the log, real ms off 1x")
assert(#errors == 0, table.concat(errors, "; "))
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
if (files.length < 5) { console.error('usage: node run_soundtiming.js Rules Engine SoundEngine Speech SoundTiming'); process.exit(2); }
for (const f of files) lua.lua_pushstring(L, to_luastring(fs.readFileSync(f, 'utf8')));
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
