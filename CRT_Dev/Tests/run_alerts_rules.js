// Alerts/Rules.lua: priority, duplicate/grouping lines, alert pick, bars, speech due, speech behind.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local src = ...
local CRT = {}
assert(load(src, "Alerts/Rules.lua"))("CowfeeRaidTools", CRT)
local R = CRT.AlertRules
assert(R, "CRT.AlertRules exists")
assert(R.DUPLICATE == 2 and R.GROUP == 1.5 and R.SPEECH_BEHIND == 1.5 and R.SPEECH_TIMEOUT == 4, "constants")
local n = 0
local function e(t)
  n = n + 1
  local d = { block = "mine", id = "e" .. n, at = 0, text = "x", priority = 21, hold = 0.5, warn = 10,
    outputs = { alert = true, bar = true, speech = true }, speech = {} }
  for k, v in pairs(t) do d[k] = v end
  return d
end

assert(R.Priority(3, "low") > R.Priority(1, "high"))
assert(R.Priority(2, "normal") == 22 and R.Priority(1, "high") == 13)
print("ok priority: own reminder beats raid-wide")

local g = { mine = true }
local l = R.Lines({ e{ spellID = 100, at = 10 }, e{ spellID = 100, at = 11.5 } }, g)
assert(#l == 1)
l = R.Lines({ e{ spellID = 100, at = 10 }, e{ spellID = 100, at = 12.5 } }, g)
assert(#l == 2)
l = R.Lines({ e{ text = "Same", at = 10 }, e{ text = "Same", at = 11 } }, g)
assert(#l == 1, "text key when no spell")
print("ok lines: duplicate in grouping block shows once")

local a, b = e{ text = "Soak", at = 10, warn = 5, hold = 2, outputs = { alert = true } }, e{ text = "Defensive", at = 11.2, priority = 31, icon = 2, warn = 8, hold = 1, outputs = { bar = true } }
a.icon = 1
l = R.Lines({ b, a }, g)
assert(#l == 1 and l[1].text == "Soak + Defensive" and l[1].at == 10 and l[1].icon == 1, l[1].text)
assert(l[1].priority == 31 and l[1].warn == 8 and l[1].hold == 2)
assert(l[1].outputs.alert and l[1].outputs.bar and not l[1].outputs.speech)
assert(#l[1].members == 2 and l[1].members[1] == a)
assert(a.text == "Soak" and a.outputs.bar == nil, "input not mutated")
print("ok lines: grouping joins within 1.5")

l = R.Lines({ e{ text = "A", at = 10 }, e{ text = "B", at = 11 }, e{ text = "C", at = 12 } }, g)
assert(#l == 2 and l[1].text == "A + B" and l[2].text == "C", "joins from the first of a run")
print("ok lines: run measured from first member")

l = R.Lines({ e{ text = "Soak", block = "mine", at = 10 }, e{ text = "Soak", block = "note", at = 10 } }, g)
assert(#l == 2)
print("ok lines: no grouping across blocks")

l = R.Lines({ e{ text = "A", block = "note", at = 10 }, e{ text = "B", block = "note", at = 10.5 } }, g)
assert(#l == 2 and #l[1].members == 1)
print("ok lines: note block never groups")

l = R.Lines({ e{ text = "L", at = 10, priority = 11 }, e{ text = "H", block = "note", at = 10, priority = 22 }, e{ text = "E", block = "note", at = 5 } }, g)
assert(l[1].text == "E" and l[2].text == "H" and l[3].text == "L")
print("ok lines: sorted by at then priority")

local ls = { e{ at = 8 }, e{ at = 12 } }
assert(R.Alert(ls, 5) == ls[1])
assert(R.Alert(ls, 8.4) == ls[1])
assert(R.Alert(ls, 8.6) == ls[2])
assert(R.Alert(ls, 12.6) == nil)
assert(R.Alert({ e{ at = 8, outputs = { bar = true } } }, 8) == nil)
assert(R.Alert({ e{ at = 30 } }, 5) == nil, "before warn")
print("ok alert: picks soonest within warn and hold")

local bl = {}
for i = 7, 1, -1 do bl[#bl + 1] = e{ at = i * 2 } end
local out, left = R.Bars(bl, 0, 20, 5)
assert(#out == 5 and left == 2 and out[1].at == 2 and out[5].at == 10)
out, left = R.Bars(bl, 0, 6, 5)
assert(#out == 3 and left == 0)
out = R.Bars({ e{ at = 1, outputs = { alert = true } }, e{ at = -1, hold = 0.5 } }, 0, 20, 5)
assert(#out == 0)
print("ok bars: cap and leftover")

local sp = {}
local sl = { e{ id = "s1", at = 10, speech = { { at = 7, text = "early" }, { at = 9.5, text = "now" }, { at = 12, text = "future" } } } }
local items = R.SpeechDue(sl, 10, sp)
assert(#items == 2 and items[1].text == "early" and items[2].text == "now" and items[2].key == "s1#2" and items[1].priority == 21, "entry still ahead is spoken")
assert(sp["s1#1"] and sp["s1#2"] and not sp["s1#3"])
assert(#R.SpeechDue(sl, 10, sp) == 0, "not repeated")
items = R.SpeechDue(sl, 12, sp)
assert(#items == 0 and sp["s1#3"], "entry passed 2 seconds ago is skipped and marked")
items = R.SpeechDue({ e{ id = "s2", at = 10, speech = { { at = 7, text = "just" } } } }, 11, {})
assert(#items == 1, "entry passed 1 second ago still spoken")
print("ok speech: late item skipped")

-- keyed by member, so a merged line changing membership keeps its keys
local ma = e{ id = "ma", at = 10, speech = { { at = 9.5, text = "A1" }, { at = 9.6, text = "A2" } } }
local mb = e{ id = "mb", at = 10, speech = { { at = 9.5, text = "B1" } } }
local merged = { e{ id = "line", at = 10, members = { ma, mb }, speech = {} } }
local ks = {}
local its = R.SpeechDue(merged, 10, ks)
local seen = {}
for _, it in ipairs(its) do seen[it.key] = it.text end
assert(seen["ma#1"] == "A1" and seen["ma#2"] == "A2" and seen["mb#1"] == "B1" and #its == 3, "keys by member")
local merged2 = { e{ id = "line", at = 10, members = { mb, ma }, speech = {} } }
assert(#R.SpeechDue(merged2, 10, ks) == 0, "same keys after membership order changes")
print("ok speech: keys by member")

local moff = e{ id = "moff", at = 10, outputs = { alert = true, speech = false }, speech = { { at = 9.5, text = "off" } } }
local mon = e{ id = "mon", at = 10, speech = { { at = 9.5, text = "on" } } }
local mixed = { e{ id = "mixed", at = 10, members = { moff, mon }, outputs = { speech = true }, speech = {} } }
local mi = R.SpeechDue(mixed, 10, {})
assert(#mi == 1 and mi[1].text == "on", "member with speech off adds nothing")
print("ok speech: member with speech off adds nothing")

local m1 = e{ id = "m1", at = 10, speech = { { at = 9.8, text = "late" }, { at = 9.2, text = "early" } } }
local m2 = e{ id = "m2", at = 10, speech = { { at = 9.5, text = "mid" }, { at = 9.5, text = "mid2" } } }
local order = R.SpeechDue({ e{ id = "l1", at = 10, members = { m1 }, speech = {} }, e{ id = "l2", at = 10, members = { m2 }, speech = {} } }, 10, {})
local txt = {}
for _, it in ipairs(order) do txt[#txt + 1] = it.text end
assert(table.concat(txt, ",") == "early,mid,mid2,late", "due items sorted by at, stable: " .. table.concat(txt, ","))
print("ok speech: due items sorted by at")

local q = { { at = 0, priority = 21 }, { at = 0.2, priority = 31 }, { at = 0.3, priority = 11 } }
local r = R.Behind(q, 2)
assert(r == q and #q == 1 and q[1].priority == 31)
q = { { at = 0, priority = 21 }, { at = 0.2, priority = 21 } }
R.Behind(q, 2)
assert(#q == 1 and q[1].at == 0.2, "earliest of equals goes")
q = { { at = 1, priority = 21 }, { at = 1.2, priority = 11 } }
R.Behind(q, 2)
assert(#q == 2, "not behind")
print("ok speech: behind drops lowest priority")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
let src; try { src = fs.readFileSync(process.argv[2], 'utf8'); } catch (e) { console.error('cannot read ' + process.argv[2]); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
