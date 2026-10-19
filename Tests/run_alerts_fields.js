// Alerts stage 2a fields: text/icon/circle outputs, glow, sound, linger, icon ID, Rules.Area, Rules.SpeechItems, Speech.SOUNDS.
// Usage: node run_alerts_fields.js Timeline/Data.lua Timeline/Database.lua Timeline/Reference.lua Timeline/Lanes.lua Alerts/Rules.lua Alerts/Engine.lua Alerts/Reminders.lua Alerts/Speech.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local frames = {}
function CreateFrame()
  local f = { events = {}, scripts = {} }
  function f:RegisterEvent(ev) self.events[ev] = true end
  function f:SetScript(k, fn) self.scripts[k] = fn end
  frames[#frames + 1] = f
  return f
end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
local clock = 100
function GetTime() return clock end
local secrets = {}
function issecretvalue(v) return secrets[v] == true end
local SECRET = {}
secrets[SECRET] = true
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
C_Spell = {
  GetSpellName = function(id) return "Spell" .. tostring(id) end,
  GetSpellTexture = function(id) return "tex" .. tostring(id) end,
}
SOUNDKIT = { RAID_WARNING = 8959, READY_CHECK = 8960, ALARM_CLOCK_WARNING_3 = 12867, UI_BNET_TOAST = 18019,
  IG_PLAYER_INVITE = 880, MAP_PING = 3175 }
local played = {}
PlaySound = function(kit) played[#played + 1] = kit; return true, 1 end
local CRT = {
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {} },
    notes = { alert = { tts = false } },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
  PlaySound = function(_, kit) played[#played + 1] = kit; return 1 end,
}
for i, src in ipairs(sources) do
  assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
end
local R, A, Rules, S = CRT.AlertReminders, CRT.Alerts, CRT.AlertRules, CRT.AlertSpeech
assert(R and A and Rules and S, "modules exist")
local function step(dt)
  clock = clock + dt
  for _, f in ipairs(frames) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, dt) end end
end

local n = 0
local function e(t)
  n = n + 1
  local d = { block = "mine", id = "e" .. n, at = 0, text = "x", priority = 21, hold = 0.5, warn = 10,
    outputs = { alert = true }, speech = {} }
  for k, v in pairs(t) do d[k] = v end
  return d
end
local function ids(list) local t = {} for _, l in ipairs(list) do t[#t + 1] = l.id end return table.concat(t, ",") end

do
  local lines = Rules.Lines({
    e({ id = "a", at = 20, warn = 5, hold = 1, outputs = { text = true } }),
    e({ id = "b", at = 30, warn = 5, hold = 1, outputs = { text = true } }),
    e({ id = "c", at = 20, warn = 5, hold = 1, outputs = { icon = true } }),
  }, nil)
  assert(ids(Rules.Area(lines, 10, "text", 5)) == "", "before warn")
  assert(ids(Rules.Area(lines, 15, "text", 5)) == "a", "from at - warn: " .. ids(Rules.Area(lines, 15, "text", 5)))
  assert(ids(Rules.Area(lines, 20.5, "text", 5)) == "a", "still inside hold")
  assert(ids(Rules.Area(lines, 21, "text", 5)) == "", "gone at at + hold")
  assert(ids(Rules.Area(lines, 26, "text", 5)) == "b", "next one")
  assert(ids(Rules.Area(lines, 15, "icon", 5)) == "c", "other output")
  print("ok rules: area shows from warn to hold")
end

do
  local list = {}
  for i = 1, 5 do list[i] = e({ id = "l" .. i, at = 20 + i * 3, warn = 30, hold = 1, outputs = { circle = true } }) end
  local lines = Rules.Lines(list, nil)
  local out, left = Rules.Area(lines, 10, "circle", 3)
  assert(ids(out) == "l1,l2,l3" and left == 2, "cap and leftover: " .. ids(out) .. " " .. tostring(left))
  local all, none = Rules.Area(lines, 10, "circle", 9)
  assert(#all == 5 and none == 0, "no leftover under cap")
  assert(#Rules.Area({}, 0, "text", 3) == 0, "empty")
  print("ok rules: area cap and leftover")
end

do
  local lines = Rules.Lines({
    e({ id = "a", at = 20, text = "A", outputs = { alert = true }, sound = "RAID_WARNING" }),
    e({ id = "b", at = 20.5, text = "B", outputs = { text = true, icon = true, circle = true }, glow = true, sound = "READY_CHECK" }),
  }, { mine = true })
  assert(#lines == 1, "merged")
  local l = lines[1]
  assert(l.outputs.alert and l.outputs.text and l.outputs.icon and l.outputs.circle, "outputs or-ed")
  assert(l.glow == true, "glow kept from any member")
  assert(l.sound == "RAID_WARNING", "earliest member's sound: " .. tostring(l.sound))
  local lone = Rules.Lines({ e({ id = "z", glow = true, sound = "READY_CHECK", outputs = { text = true } }) }, nil)[1]
  assert(lone.glow == true and lone.sound == "READY_CHECK" and lone.outputs.text, "single line copies fields")
  print("ok rules: merged line keeps glow and first sound")
end

do
  local function flat(list) local t = {} for _, s in ipairs(list) do t[#t + 1] = s.offset .. ":" .. s.text end return table.concat(t, ",") end
  assert(flat(Rules.SpeechItems("Go", 5, true, false)) == "5:Go")
  assert(flat(Rules.SpeechItems("Go", 2, true, true)) == "4:Go,3:3,2:2,1:1")
  assert(flat(Rules.SpeechItems("Go", 7, true, true)) == "7:Go,3:3,2:2,1:1")
  assert(flat(Rules.SpeechItems("Go", 5, false, true)) == "3:3,2:2,1:1")
  assert(flat(Rules.SpeechItems("Go", 5, false, false)) == "")
  for _, mode in ipairs({ "text", "textcount", "count" }) do
    local r = { text = "Go", spellID = 0, times = "P1 0:30", warn = 6, speech = mode, outputs = { speech = true } }
    local it = R:Items(1, 1, r)[1]
    local want = Rules.SpeechItems("Go", 6, mode ~= "count", mode ~= "text")
    assert(flat(it.speech) == flat(want), "reminder speech " .. mode .. ": " .. flat(it.speech))
  end
  print("ok rules: speech items")
end

do
  local r = { text = "Go", spellID = 123, times = "P1 0:30", warn = 6, speech = "text", color = "ff0000", sound = "RAID_WARNING", glow = true,
    outputs = { alert = true, text = true, icon = true, circle = true } }
  local it = R:Items(1, 1, r)[1]
  assert(it.outputs.text == true and it.outputs.icon == true and it.outputs.circle == true and it.outputs.alert == true
    and it.outputs.bar == false and it.outputs.speech == false, "outputs map")
  assert(it.sound == "RAID_WARNING" and it.glow == true and it.color == "ff0000", "sound, glow, color")
  local plain = R:Items(1, 2, { text = "P", times = "P1 0:30" })[1]
  assert(plain.outputs.text == false and plain.outputs.icon == false and plain.outputs.circle == false and not plain.glow and not plain.sound, "defaults off")
  print("ok reminders: new outputs and fields reach items")
end

do
  assert(R:Items(1, 1, { text = "a", times = "P1 0:30" })[1].hold == 0.5, "default hold")
  assert(R:Items(1, 1, { text = "a", times = "P1 0:30", linger = 0 })[1].hold == 0.5)
  assert(R:Items(1, 1, { text = "a", times = "P1 0:30", linger = 0.2 })[1].hold == 0.5, "floor")
  assert(R:Items(1, 1, { text = "a", times = "P1 0:30", linger = 4 })[1].hold == 4, "linger sets hold")
  print("ok reminders: linger sets hold")
end

do
  local function icon(r) r.text = "a"; r.times = "P1 0:30"; return R:Items(1, 1, r)[1].icon end
  assert(icon({ spellID = 55 }) == "tex55", "spell icon")
  assert(icon({ spellID = 55, iconID = 136048 }) == 136048, "icon ID wins")
  assert(icon({ spellID = 55, iconID = 0 }) == "tex55", "zero ignored")
  assert(icon({ spellID = 55, iconID = "x" }) == "tex55", "non-number ignored")
  assert(icon({ iconID = 7 }) == 7, "icon ID without spell")
  print("ok reminders: icon ID wins over spell icon")
end

do
  -- the sound list now lives in the sound engine (Sound/Engine.lua): CRT.Sound:Choices
  local list = CRT.Sound:Choices()
  assert(type(list) == "table" and #list >= 5 and #list <= 12, "sounds list size " .. #list)
  assert(list[1].key == "kit:RAID_WARNING" and type(list[1].label) == "string", "entry shape")
  for _, s in ipairs(list) do
    local name = s.key:match("^kit:(.+)$")
    local src = CRT.Sound:Resolve(s.key)
    assert(name and src and src.kind == "kit" and type(src.id) == "number", "plays a game sound id: " .. s.key)
    if SOUNDKIT[name] then assert(src.id == SOUNDKIT[name], "kit from SOUNDKIT: " .. s.key) end
  end
  assert(CRT.Sound:Choices({ none = "No sound" })[1].key == "none", "none first")
  local saved = SOUNDKIT
  SOUNDKIT = { RAID_WARNING = 1 }
  local names = {}
  for _, s in ipairs(CRT.Sound:Choices()) do names[s.key] = true end
  assert(names["kit:RAID_WARNING"] and not names["kit:UI_BNET_TOAST"], "names the client lacks, with no id of the engine's own, skipped")
  SOUNDKIT = saved
  print("ok sound: list built from SOUNDKIT")
end

do
  local items = {}
  A:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })
  local function start(list) items = list; played = {}; A:Start(1, "Mythic", "test") end
  start({ { id = "s1", ph = 1, time = 2, text = "x", priority = 21, outputs = { text = true }, sound = "READY_CHECK" } })
  step(1)
  assert(#played == 0, "not before zero")
  step(1.2)
  assert(#played == 1 and played[1] == 8960, "plays at zero through PlaySound: " .. #played)
  for i = 1, 40 do step(0.1) end
  assert(#played == 1, "once")
  start({ { id = "s1", ph = 1, time = 2, text = "x", priority = 21, outputs = { text = true }, sound = "READY_CHECK" } })
  step(2.2)
  assert(#played == 1, "plays again on a new run")
  -- too late: more than 1 s past zero
  start({ { id = "s2", ph = 1, time = -5, text = "x", priority = 21, outputs = { text = true }, sound = "READY_CHECK" } })
  step(0.2)
  assert(#played == 0, "more than a second late plays nothing")
  print("ok sound: plays once at zero")
end

do
  local items = { { id = "u1", ph = 1, time = 1, text = "x", priority = 21, outputs = { alert = true }, sound = "NOPE" },
    { id = "u2", ph = 1, time = 1, text = "x", priority = 21, outputs = { alert = true } } }
  A:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })
  played = {}
  A:Start(1, "Mythic", "test")
  step(2)
  assert(#played == 0 and #errors == 0, "unknown key plays nothing, no error")
  print("ok sound: unknown key plays nothing")
end
do
  local items = {}
  local def = { label = "t", group = true, Entries = function() return items end }
  A:RegisterBlock("t", def)
  local function it(id, time, sound) return { id = id, ph = 1, time = time, text = id, spellID = 0, priority = 21,
    outputs = { alert = true }, sound = sound } end
  -- membership change: A plays, then an earlier Z joins A's line
  items = { it("A", 2, "READY_CHECK") }
  played = {}
  A:Start(1, "Mythic", "test")
  step(2.2)
  assert(#played == 1, "A plays")
  local z = it("Z", 1.5, nil); z.block = "t"
  A.items[#A.items + 1] = z
  A:RegisterBlock("t", def)
  step(0.2)
  assert(#played == 1, "membership change does not replay: " .. #played)
  print("ok sound: membership change does not replay")
  -- each member plays its own
  items = { it("A", 2, nil), it("B", 2.5, "RAID_WARNING") }
  played = {}
  A:Start(1, "Mythic", "test")
  step(2.2)
  assert(#played == 0, "A has no sound")
  step(0.5)
  assert(#played == 1 and played[1] == 8959, "B plays at its own time: " .. #played)
  print("ok sound: each member plays its own")
  A:Stop(true)
end
do
  -- Note-line sounds follow the Raid Notes speech switch (tts), checked live, with or without the alert
  -- (ruling B2); other blocks' sounds always play.
  local items = {}
  A:RegisterBlock("note", { label = "Raid note", group = false, Entries = function() return items.note or {} end })
  A:RegisterBlock("t", { label = "t", group = false, Entries = function() return items.t or {} end })
  local function it(id, time, sound) return { id = id, ph = 1, time = time, text = id, priority = 21,
    outputs = { text = true }, sound = sound } end
  local alert = CRT.db.notes.alert
  alert.enabled = false
  alert.tts = false
  items = { note = { it("n1", 1, "READY_CHECK") }, t = { it("r1", 1, "RAID_WARNING") } }
  played = {}
  A:Start(1, "Mythic", "test")
  step(1.2)
  assert(#played == 1 and played[1] == 8959, "only the reminder sound with speech off: " .. #played)
  alert.tts = true
  items = { note = { it("n2", 1, "READY_CHECK") }, t = {} }
  played = {}
  A:Start(1, "Mythic", "test")
  step(1.2)
  assert(#played == 1 and played[1] == 8960, "note sound with speech on and the alert off: " .. #played)
  alert.enabled = nil
  alert.tts = false
  A:Stop(true)
  print("ok sound: note line sound follows the speech switch")
end
assert(#errors == 0, table.concat(errors, "; "))
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
