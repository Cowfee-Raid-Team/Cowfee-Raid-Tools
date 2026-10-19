// Timeline/Rehearsal.lua: the rehearsal clock and model.
// Usage: node run_timeline_rehearsal.js Timeline/Rehearsal.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local src = ...
local now = 100
function GetTime() return now end
local CRT = {}
assert(load(src, "Timeline/Rehearsal.lua"))("CowfeeRaidTools", CRT)
local R = CRT.TimelineRehearsal
assert(R and R.CAST == 5 and R.STRIP_SPAN == 40, "constants")
local function near(a, b) return math.abs(a - b) < 1e-9 end
local function ok(name) print("ok " .. name) end

do
  local c = R.NewClock()
  assert(c:Now() == 0 and not c:Playing() and c:Speed() == 1, "starts paused at 0")
  now = 200; assert(c:Now() == 0, "paused does not move")
  c:Play(); now = 203; assert(near(c:Now(), 3) and c:Playing(), "plays at 1x")
  c:SetSpeed(2); now = 205; assert(near(c:Now(), 7), "plays at 2x: " .. c:Now())
  c:SetSpeed(4); now = 206; assert(near(c:Now(), 11), "plays at 4x")
end
ok("clock plays at speed")

do
  local c = R.NewClock(); now = 0
  c:Play(); now = 5; c:Pause()
  assert(near(c:Now(), 5) and not c:Playing(), "pause holds")
  now = 50; assert(near(c:Now(), 5), "still held")
  c:Play(); now = 51; assert(near(c:Now(), 6), "resume continues")
end
ok("clock pauses")

do
  local c = R.NewClock(); now = 0
  c:Play(); now = 10; local before = c:Now()
  c:SetSpeed(4); assert(near(c:Now(), before) and c:Speed() == 4, "speed change keeps the time")
  now = 11; assert(near(c:Now(), before + 4), "new speed applies after")
  c:Pause(); c:SetSpeed(2); assert(near(c:Now(), before + 4), "paused speed change keeps the time")
end
ok("clock speed change keeps the time")

do
  local c = R.NewClock(); c:SetLength(100); now = 0
  c:Play(); now = 10; c:Seek(50)
  assert(near(c:Now(), 50) and c:Playing(), "seek keeps playing")
  now = 12; assert(near(c:Now(), 52), "continues from the seek")
  c:Seek(500); assert(near(c:Now(), 100), "clamped high")
  c:Seek(-5); assert(near(c:Now(), 0), "clamped low")
  c:Pause(); c:Seek(30); assert(near(c:Now(), 30) and not c:Playing(), "seek while paused stays paused")
end
ok("clock seek while playing")

do
  local c = R.NewClock(); c:SetLength(60); now = 0
  c:Play(); now = 59; assert(near(c:Now(), 59) and c:Playing(), "before the end")
  now = 80; assert(near(c:Now(), 60) and not c:Playing(), "holds at the length and stops")
  now = 90; assert(near(c:Now(), 60), "stays")
  local d = R.NewClock(); now = 0; d:Play(); now = 1000
  assert(near(d:Now(), 1000) and d:Playing(), "no length: no clamp")
end
ok("clock stops at the length")

local lanes = {
  { kind = "deaths", label = "Deaths", marks = { { t = 5 } } },
  { kind = "reference", key = "a", label = "Slam", icon = "iconA", color = { 1, 0, 0 }, marks = { { t = 30, dur = 2 }, { t = 10, dur = 2 } } },
  { kind = "reference", key = "b", label = "Breath", icon = "iconB", marks = { { t = 20 } } },
  { kind = "spell", key = "c", label = "Pulse", icon = "iconC", marks = { { t = 21, spellID = 1, dur = 0, age = 0 } } },
  { kind = "unnamed", label = "Boss casts (unnamed)", marks = { { t = 1 } } },
  { kind = "ticks", label = "Pull", marks = { { t = 2 } } },
  { kind = "personal", label = "Me", marks = { { t = 3 } } },
  { kind = "notes", label = "Notes", marks = { { t = 4 } } },
}
local extra = { length = 0, phases = { { t = 300, planned = 300, label = "P2" }, { t = 0, planned = 0, label = "P1" }, { t = 150, planned = 150 } } }
local m = R.Build(lanes, extra)

do
  local t = {}
  for i, c in ipairs(m.casts) do t[i] = c.t .. c.name end
  assert(table.concat(t, ",") == "10Slam,20Breath,21Pulse,30Slam", "order: " .. table.concat(t, ","))
  assert(m.casts[1].icon == "iconA" and m.casts[1].color[1] == 1 and m.casts[1].lane == lanes[2], "cast fields")
  assert(m.casts[2].color == nil, "no color stays nil")
  assert(m.length == 30, "length falls back to the last cast: " .. m.length)
  assert(R.Build(lanes, { length = 600 }).length == 600, "extra.length wins")
  assert(#m.phases == 3 and m.phases[1].label == "P1" and m.phases[2].label == nil and m.phases[3].t == 300, "phases sorted, unlabeled kept")
end
ok("model keeps reference casts in time order")

do
  for _, c in ipairs(m.casts) do assert(c.t ~= 1 and c.t ~= 2 and c.t ~= 3 and c.t ~= 4 and c.t ~= 5, "left out " .. c.t) end
  assert(#m.casts == 4, "only reference and spell casts")
end
ok("model leaves out deaths and ticks")

do
  local mm = { casts = { { t = 10, name = "A" }, { t = 11, name = "B" }, { t = 20, name = "C" } }, phases = {}, length = 30 }
  local r = R.CastAt(mm, 9.5)
  assert(r.cast.name == "A" and near(r.progress, 0.9) and near(r.remaining, 0.5), "ends first wins: " .. r.cast.name)
  r = R.CastAt(mm, 5); assert(r.cast.name == "A" and near(r.progress, 0) and near(r.remaining, 5), "starts at 0")
  r = R.CastAt(mm, 10.5); assert(r.cast.name == "B" and near(r.progress, 0.9), "A is over, B shows")
  assert(R.CastAt(mm, 4.99) == nil, "before")
end
ok("cast bar shows the cast ending first")

do
  local mm = { casts = { { t = 10 }, { t = 20 } }, phases = {}, length = 30 }
  assert(R.CastAt(mm, 12) == nil and R.CastAt(mm, 14.9) == nil and R.CastAt(mm, 25) == nil, "empty between")
  assert(R.CastAt({ casts = {}, phases = {}, length = 0 }, 5) == nil, "no casts")
end
ok("cast bar empty between casts")

do
  local mm = { casts = { { t = 1 }, { t = 5 }, { t = 6 }, { t = 7 }, { t = 9 } }, phases = {}, length = 10 }
  local n = R.NextUp(mm, 5, 3)
  assert(#n == 3 and n[1].t == 5 and n[2].t == 6 and n[3].t == 7, "next 3 from 5 inclusive")
  assert(#R.NextUp(mm, 8, 3) == 1 and #R.NextUp(mm, 0, 0) == 0, "short and zero")
  local s = R.NextUp(mm, 5, 3, mm.casts[2])
  assert(#s == 3 and s[1].t == 6 and s[3].t == 9, "the cast bar's cast is left out")
end
ok("next up gives 3")

do
  local mm = { casts = {}, length = 100, phases = { { t = 0, label = "P1" }, { t = 40, label = "P2" }, { t = 80, label = "P3" } } }
  local p = R.PhasesUpTo(mm, 40)
  assert(#p == 2 and p[2].label == "P2", "inclusive")
  assert(#R.PhasesUpTo(mm, -1) == 0 and #R.PhasesUpTo(mm, 500) == 3, "bounds")
end
ok("phases up to a time")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const srcs = process.argv.slice(2).map(f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); } });
srcs.forEach(s => lua.lua_pushstring(L, to_luastring(s)));
if (lua.lua_pcall(L, srcs.length, 0, 0) !== lua.LUA_OK) { console.error('FAIL LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
