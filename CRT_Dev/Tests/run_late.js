// Runs CRT_Modules/Late/Data.lua through a simulated raid night with stubbed game functions.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local src = ...
local NOW = 0
local inGroup = false
local roster = {}
local pending = {}
time = function(t) if t then return os.time(t) end return NOW end
date = os.date
format = string.format
function IsInGroup() return inGroup end
Ambiguate = function(k) return k end
C_Timer = { After = function(s, fn) pending[#pending+1] = fn end, NewTicker = function() end }
local handler
function CreateFrame() return { RegisterEvent = function() end, SetScript = function(_, _, fn) handler = fn end } end
local printed = {}
local resets = 0
local CRT ={ db = { groups = { selected = 7 }, late = { days = { [4] = true }, hour = 20, minute = 0, grace = 0, history = {}, nextId = 1, lastAuto = "" } } }
function CRT:Print(m) print("  [print] " .. m) end
local layout = { id = 7, name = "Mythic main", slots = {} }
for i, n in ipairs({ "Gadios-Area52", "Sixz-Area52", "Abu-Area52", "Cheoeqar-Area52", "Djaztech-Area52" }) do layout.slots[i] = n end
for i = 6, 40 do layout.slots[i] = "" end
CRT.Groups = { NUM_SLOTS = 40, Find = function(_, id) return id == 7 and layout or nil end, Active = function() return CRT.db.late.layoutId end,
  ReadRoster = function() local out = {} for _, k in ipairs(roster) do out[#out+1] = { key = k } end return out end,
  OnChange = function(_, fn) groupsChanged = fn end,
  Normalize = function(k) if k ~= "" and not k:find("-") then return k .. "-Area52" end return k end,
  MakeLookup = function(r) local m = {} for _, e in ipairs(r) do m[e.key:lower()] = e end return function(k) return m[k:lower()] end end }
CRT.Invite = { Reset = function() resets = resets + 1 end }
assert(load(src, "Data.lua"))("CowfeeRaidTools", CRT)
local Late = CRT.Late
local s = CRT.db.late
s.layoutId = 7
local function at(h, m) return os.time({ year = 2026, month = 10, day = 14, hour = h, min = m, sec = 0 }) end
local function flush() local p = pending pending = {} for _, fn in ipairs(p) do fn() end end
print("2026-10-14 is wday " .. os.date("*t", at(12,0)).wday .. " (" .. os.date("%a", at(12,0)) .. ")")
NOW = at(19, 58); Late:Tick(); print("19:58 tick, running: " .. tostring(Late:Current() ~= nil))
NOW = at(20, 1); inGroup = true; roster = { "Gadios-Area52", "Sixz-Area52", "Abu-Area52" }; Late:Tick()
local n = Late:Current(); print("20:01 tick, running: " .. tostring(n ~= nil) .. ", how " .. n.how .. ", start " .. os.date("%H:%M", n.startedAt))
for _, p in ipairs(n.players) do print("   " .. p.key .. " joined " .. (p.joinedAt and os.date("%H:%M", p.joinedAt) or "-")) end
NOW = at(20, 14); roster[#roster+1] = "Cheoeqar-Area52"; handler(nil, "GROUP_ROSTER_UPDATE")
print("20:14 Cheoeqar joins, late seconds " .. Late.Seconds(n, n.players[4]))
NOW = at(20, 30); print("20:30 Djaztech live seconds " .. Late.Seconds(n, n.players[5], NOW) .. ", late " .. tostring(Late.IsLate(n, n.players[5], NOW)))
NOW = at(21, 0); inGroup = false; handler(nil, "GROUP_ROSTER_UPDATE"); NOW = at(21, 0) + 2; inGroup = true; handler(nil, "GROUP_ROSTER_UPDATE"); flush()
print("21:00 brief roster gap, still running: " .. tostring(Late:Current() ~= nil))
NOW = at(22, 30); inGroup = false; roster = {}; handler(nil, "GROUP_ROSTER_UPDATE"); NOW = NOW + 3; flush()
print("22:30 disband, running: " .. tostring(Late:Current() ~= nil) .. ", history " .. #s.history .. ", reason " .. s.history[1].endReason .. ", ended " .. os.date("%H:%M", s.history[1].endedAt))
NOW = at(22, 40); inGroup = true; Late:Tick(); print("22:40 tick same day, running: " .. tostring(Late:Current() ~= nil))
for _, t in ipairs(Late:Totals()) do print(format("   total %s late %d/%d never %d seconds %d", t.key, t.late, t.nights, t.never, t.seconds)) end
-- Next Wednesday: not in a group at the start, so the window passes.
local wed2 = at(20, 0) + 7 * 86400
inGroup = false; NOW = wed2 + 2 * 60; Late:Tick(); print("next Wed 20:02 solo, running: " .. tostring(Late:Current() ~= nil))
NOW = wed2 + 6 * 60; Late:Tick(); print("next Wed 20:06, lastAuto " .. s.lastAuto)
print("next scheduled from Thu: " .. os.date("%a %Y-%m-%d %H:%M", Late:NextScheduled(at(12, 0) + 86400)))
-- Manual start with no layout picked, then with one, then a timeout.
s.layoutId = nil; print("start without layout: " .. tostring(Late:Start("button", NOW)))
s.layoutId = 7; Late:Start("button", NOW); NOW = NOW + 9 * 3600; Late:Tick()
print("after 9 h: running " .. tostring(Late:Current() ~= nil) .. ", last reason " .. s.history[#s.history].endReason)
s.grace = 15; Late:Start("button", NOW); roster = { "Gadios-Area52", "Sixz-Area52", "Abu-Area52", "Cheoeqar-Area52" }
local g = Late:Current(); NOW = NOW + 10 * 60; inGroup = true; roster[#roster+1] = "Djaztech-Area52"; handler(nil, "GROUP_ROSTER_UPDATE")
print("grace 15, joined after 10 min, late: " .. tostring(Late.IsLate(g, g.players[5])))
-- Editing tonight's roster.
local function names(night) local out = {} for _, p in ipairs(night.players) do out[#out+1] = p.key:gsub("%-Area52", "") .. (p.joinedAt and (p.joinedAt == night.startedAt and ":ontime" or ":joined") or ":missing") end return table.concat(out, " ") end
print("before edits: " .. names(g))
roster[#roster+1] = "Balevolence-Area52"
print("add Balevolence (in group): " .. tostring(Late:AddPlayer("Balevolence")) .. " -> " .. names(g))
print("add Sixz again: " .. tostring(select(2, Late:AddPlayer("sixz"))))
print("add Benched (not in group): " .. tostring(Late:AddPlayer("Benched")) .. " -> " .. names(g))
Late:SetOnTime("Balevolence-Area52") Late:RemovePlayer("benched-area52")
print("Balevolence on time, Benched removed: " .. names(g))
-- The layout changes during the night: Sixz swapped for Newbie (in the group) and Absent (not).
layout.slots[2] = "Newbie-Area52" layout.slots[6] = "Absent-Area52"
roster[#roster+1] = "Newbie-Area52"
groupsChanged()
print("after layout change: " .. names(g))
Late:RemovePlayer("Absent-Area52") groupsChanged()
print("Absent removed by hand stays off after another save: " .. names(g))
-- Checks: Late.Status is the one rule for on time, late and no-show, and the totals follow it.
local fails, passes = 0, 0
local function eq(a, b, what) if a == b then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end end
Late:End("button", NOW)
s.history = {}
s.grace = 10
layout.slots[2] = "Sixz-Area52" layout.slots[6] = ""
-- A test night on your own: started 17:33, ended 17:34, nobody seen in your group.
inGroup = false roster = {}
local t0 = os.time({ year = 2026, month = 10, day = 19, hour = 17, min = 33, sec = 0 })
NOW = t0 Late:Start("button", t0) NOW = t0 + 60 Late:End("button", NOW)
local short = s.history[1]
eq(short.players[1].never, true, "saved: never joined")
for _, p in ipairs(short.players) do eq(Late.Status(short, p), "ontime", p.key .. " ended inside the grace: on time") end
for _, t in ipairs(Late:Totals()) do eq(t.never, 0, t.key .. " no no-show in the totals") eq(t.late, 0, t.key .. " not late in the totals") end
-- A night past the grace: Gadios on time, Sixz 25 minutes late, the rest never come.
local t1 = t0 + 86400
inGroup = true roster = { "Gadios-Area52" }
NOW = t1 Late:Start("button", t1)
NOW = t1 + 25 * 60 roster[#roster+1] = "Sixz-Area52" Late:Scan(NOW)
NOW = t1 + 2 * 3600 Late:End("button", NOW)
local long = s.history[2]
local status = {} for _, p in ipairs(long.players) do status[p.key] = Late.Status(long, p) end
eq(status["Gadios-Area52"], "ontime", "joined at the start")
eq(status["Sixz-Area52"], "late", "joined after the grace")
eq(status["Abu-Area52"], "noshow", "never joined, past the grace")
eq(Late.Status(long, { key = "X", joinedAt = t1 + 5 * 60 }), "ontime", "joined inside the grace")
local tot = {} for _, t in ipairs(Late:Totals()) do tot[t.key] = t end
eq(tot["Gadios-Area52"].late, 0, "totals: on time")
eq(tot["Sixz-Area52"].late, 1, "totals: late once") eq(tot["Sixz-Area52"].never, 0, "totals: late is not a no-show") eq(tot["Sixz-Area52"].seconds, 25 * 60, "totals: 25 minutes")
eq(tot["Abu-Area52"].never, 1, "totals: one no-show") eq(tot["Abu-Area52"].late, 1, "totals: a no-show counts in Late too") eq(tot["Abu-Area52"].nights, 2, "totals: two nights")
-- A night's start and end forget the invites (Groups/Invite.lua).
local r0 = resets
NOW = NOW + 60 Late:Start("button", NOW) eq(resets, r0 + 1, "a night's start resets the invites")
Late:End("button", NOW + 60) eq(resets, r0 + 2, "its end resets them too")
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2], 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
