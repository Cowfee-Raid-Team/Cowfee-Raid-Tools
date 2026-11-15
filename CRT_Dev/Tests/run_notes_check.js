// CRT_Modules/Notes/Check.lua: the note check (#1288). Double callouts (one player, two callouts at the same moment,
// and the old lines an Assign block replaced), missing casts (a block's typed cast with no line in any row) and
// orphan lines (timed text lines for players no row mentions), on Alex's Coiled Altar Mythic note
// (coiled_altar_note.txt) and small notes; Remove old lines and Add missing casts, after which the check is clean.
// Spell lines and the kick block are never doubles or orphans.
// Usage: node run_notes_check.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local sources = { ... }
function CreateFrame()
  local f = {}
  function f:RegisterEvent() end
  function f:UnregisterEvent() end
  function f:SetScript() end
  return f
end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
function GetTime() return 1000 end
function issecretvalue() return false end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
function date() return "2026-11-15 12:00" end
function UnitName(u) if u == "player" then return "Solex" end end
function IsInRaid() return false end
function IsInGroup() return false end
function GetNumGroupMembers() return 1 end
local CLASSES = { { "Warrior", "WARRIOR" }, { "Demon Hunter", "DEMONHUNTER" } }
function GetNumClasses() return #CLASSES end
function GetClassInfo(i) local c = CLASSES[i] return c[1], c[2], i end
C_Spell = { GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
local CRT = {
  db = { notes = { list = {}, nextId = 1, trustedOnly = true, alert = { enabled = true, seconds = 10 } } },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end },
  Print = function() end,
}
for i = 1, #sources, 2 do
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
end
local A, Model, Check = CRT.NoteAssign, CRT.NoteEditModel, CRT.NoteCheck
assert(A and Model and Check and Check.Run and Check.RemoveOld and Check.AddMissing, "CRT.NoteCheck with Run, RemoveOld and AddMissing")

local passed, failed = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then passed = passed + 1 print("ok " .. name) else failed = failed + 1 print("FAIL " .. name .. ": " .. tostring(err)) end
end
local function lines(text) local out = {} for l in (text .. "\n"):gmatch("(.-)\r?\n") do out[#out + 1] = l end return out end
local function count(text, needle) return select(2, text:gsub((needle:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?{}]", "%%%0")), "")) end
local function summary(r) return #r.doubles .. " doubles, " .. #r.old .. " old, " .. #r.missing .. " missing, " .. #r.orphans .. " orphans" end

-- COILED: the line numbers of the fixture
local OLD_FIRST, OLD_LAST = 6, 53 -- the 48 phase 1 "Grab ... orb" lines from before the Orb Carriers P1 block

check("Alex's note: the Lulu double, the old P1 lines a block replaced, the missing 3:40, no orphan", function()
  local r = Check.Run(COILED)
  assert(#r.orphans == 0, "no orphans: " .. summary(r))
  -- double callouts: Sixz, Notkvr, Sarrantha and Lulu at each of the block's six casts (3:40 as it will be written)
  assert(#r.doubles == 24, summary(r))
  local lulu = {}
  for _, d in ipairs(r.doubles) do
    if d.name == "Lulu" then lulu[#lulu + 1] = d end
    assert(d.block == "orb carriers p1", "every double is the block's: " .. tostring(d.block))
  end
  assert(#lulu == 6, "Lulu twice at each cast: " .. #lulu)
  local first = lulu[1]
  assert(first.ph == 1 and first.t == 7 and #first.lines == 2, "P1 0:07: two lines")
  local texts = {}
  for _, i in ipairs(first.lines) do texts[#texts + 1] = lines(COILED)[i] end
  assert(table.concat(texts, "\n"):find("text:{diamond} purple orb;", 1, true) and table.concat(texts, "\n"):find("text:Grab side green orb;", 1, true), table.concat(texts, "\n"))
  -- old lines: all 48 of them, Gadios, Dotsanhots, Lichkingstoy and Granddh's too (the block's casts, its wording)
  assert(#r.old == 48, "48 old lines: " .. #r.old)
  for k, i in ipairs(r.old) do assert(i == OLD_FIRST + k - 1, "line " .. i .. " in order, from " .. OLD_FIRST) end
  -- missing: cast 6 of Orb Carriers P1
  assert(#r.missing == 1 and r.missing[1].key == "orb carriers p1" and r.missing[1].name == "Orb Carriers P1", "the block")
  assert(#r.missing[1].casts == 1 and r.missing[1].casts[1] == 6 and r.missing[1].times[1].ph == 1 and r.missing[1].times[1].t == 220, "cast 6, P1 3:40")
  assert(not Check.Clean(r), "not clean")
end)

check("Alex's note: Remove old lines, then Add missing casts: clean; Lulu once per cast", function()
  local r = Check.Run(COILED)
  local text = Check.RemoveOld(COILED, r)
  assert(#lines(text) == #lines(COILED) - 48, "48 lines out")
  for _, l in ipairs(lines(text)) do assert(not l:find("^time:[%d%.]+;ph:1;tag:%w+;text:Grab "), "an old phase 1 line left: " .. l) end
  assert(text:find("time:7;ph:3;tag:Dotsanhots;text:Grab side green orb;", 1, true), "phase 3's lines stay")
  local mid = Check.Run(text)
  assert(#mid.doubles == 0 and #mid.old == 0 and #mid.missing == 1, "after Remove: the missing cast left: " .. summary(mid))
  text = Check.AddMissing(text)
  local after = Check.Run(text)
  assert(Check.Clean(after), "clean: " .. summary(after))
  assert(count(text, "assign:orb carriers p1/") == 30, "6 casts of 5 rows: " .. count(text, "assign:orb carriers p1/"))
  assert(text:find("time:220;ph:1;tag:Lulu;text:{diamond} purple orb;assign:orb carriers p1/4/6;", 1, true), "Lulu at 3:40")
  for _, t in ipairs({ 7, 50, 92, 135, 177, 220 }) do
    assert(count(text, "time:" .. t .. ";ph:1;tag:Lulu;") == 1, "Lulu once at " .. t)
  end
  -- the other order gives the same note
  local other = Check.RemoveOld(Check.AddMissing(COILED), Check.Run(Check.AddMissing(COILED)))
  assert(other == text, "Add, then Remove: the same note")
  -- the lists are still there to make blocks of
  assert(#A.Candidates(text) == 5, "five lists to make blocks")
end)

check("doubles: spell lines and two typed lines; only a block's double has old lines", function()
  local text = table.concat({
    "EncounterID:1;Difficulty:Mythic;Name:Test",
    "time:20;ph:1;tag:Abu;spellid:740;",                 -- 2 two cooldowns at once: never a double
    "time:20;ph:1;tag:Abu;spellid:98008;text:Link;",       -- 3
    "time:30;ph:1;tag:Cheo;text:Soak left;",               -- 4 two typed lines for Cheo at once: a double, nothing to remove
    "time:30;ph:1;tag:Cheo Kip;text:Stack;",               -- 5
    "time:30;ph:2;tag:Cheo;text:Soak left;",               -- 6 the same time in another phase: no double
  }, "\n")
  local r = Check.Run(text)
  assert(#r.doubles == 1 and r.doubles[1].name == "Cheo" and #r.doubles[1].lines == 2 and r.doubles[1].block == nil, summary(r))
  assert(#r.old == 0, "nothing a block replaced")
  assert(Check.RemoveOld(text, r) == text, "nothing removed")
end)

check("orphans: a text line for a player no row mentions; never a spell, a role word, everyone or the kick block", function()
  local text = table.concat({
    "Soaks",                                             -- 1
    "Left: Abu Cheo",                                    -- 2
    "intstart", "Zed Quin", "intend",                    -- 3-5
    "time:10;ph:1;tag:Abu Cheo;text:Soak left;",         -- 6 follows Left
    "time:12;ph:1;tag:Kip;text:Use a defensive;",        -- 7 Kip is on no row: an orphan
    "time:14;ph:1;tag:Zed;spellid:740;",                 -- 8 a cooldown
    "time:16;ph:1;tag:healer;text:Spread;",              -- 9 a role word
    "time:18;ph:1;text:Everyone stack;",                 -- 10 no tag: everyone
    "time:20;ph:1;tag:Abu;text:Grab an orb;",            -- 11 Abu is on a row
    "time:22;ph:1;tag:Quin;text:Kick the add;",          -- 12 Quin is in the kick block
  }, "\n")
  local r = Check.Run(text)
  assert(#r.orphans == 1 and r.orphans[1] == 7, "only Kip's line: " .. table.concat(r.orphans, ","))
  assert(#r.doubles == 0 and #r.missing == 0 and #r.old == 0, summary(r))
end)

check("missing casts: only a block with typed times; a cast some row is on is no missing cast", function()
  local typed = { { ph = 1, t = 30 }, { ph = 1, t = 90 }, { ph = 1, t = 150 } }
  local b = { name = "Orbs", times = typed, rows = { { label = "Odd", text = "", tokens = { "Abu" }, casts = { 1, 3 } },
    { label = "Even", text = "", tokens = { "Cheo" }, casts = { 2 } } } }
  local text = table.concat(A.Lines(b, typed), "\n")
  assert(#Check.Run(text).missing == 0, "every cast has a row on it")
  -- cast 3's line taken out by hand: missing; added back on the rows that are on a list of casts
  local cut = text:gsub("\ntime:150;[^\n]*", "")
  local r = Check.Run(cut)
  assert(#r.missing == 1 and r.missing[1].casts[1] == 3, summary(r))
  local back = Check.AddMissing(cut)
  assert(back:find("time:150;ph:1;tag:Abu;text:Odd;assign:orbs/1/3;", 1, true) and back:find("time:150;ph:1;tag:Cheo;text:Even;assign:orbs/2/3;", 1, true), back)
  assert(#Check.Run(back).missing == 0, "none missing")
  -- a mechanic's block (for:, no typed times): its casts aren't in the note, so nothing is missing
  local mech = table.concat(A.Lines({ name = "Feast", rows = { { label = "Left", text = "", tokens = { "Abu" }, casts = { 1 } } } }, typed, { mech = "1234" }), "\n")
  assert(#Check.Run(mech).missing == 0, "a mechanic's block")
  -- a block with no one in it: nothing missing
  local empty = table.concat(A.Lines({ name = "Empty", times = typed, rows = { A.NewRow(1) } }, typed), "\n")
  assert(#Check.Run(empty).missing == 0, "no one in it")
end)

check("Remove old lines: a note that ended on one ends as before", function()
  local typed = { { ph = 1, t = 30 } }
  local blk = table.concat(A.Lines({ name = "Orbs", times = typed, rows = { { label = "{cross} orb", text = "", tokens = { "Abu" }, casts = "all" } } }, typed), "\n")
  local text = blk .. "\ntime:30;ph:1;tag:Abu;text:Grab {cross} orb;colors:1 0 0 1;"
  local r = Check.Run(text)
  assert(#r.old == 1 and #r.doubles == 1, summary(r))
  assert(Check.RemoveOld(text, r) == blk, "the note as it was: " .. Check.RemoveOld(text, r))
  local crlf = blk:gsub("\n", "\r\n") .. "\r\ntime:30;ph:1;tag:Abu;text:Grab {cross} orb;\r\n"
  assert(Check.RemoveOld(crlf, Check.Run(crlf)) == blk:gsub("\n", "\r\n") .. "\r\n", "CRLF, a trailing line end kept")
end)

check("no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)
print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error(failed .. " failed") end
`;
const W = process.argv[2];
if (!W) { console.error('usage: node run_notes_check.js <addon folder>'); process.exit(2); }
const names = ['CRT_Core/MarkerText.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/EditModel.lua',
  'CRT_Modules/Notes/Links.lua', 'CRT_Modules/Notes/MechNote.lua', 'CRT_Modules/Notes/Assign.lua', 'CRT_Modules/Notes/Check.lua'];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, 'CRT_Dev/Tests/coiled_altar_note.txt'), 'utf8').replace(/\r\n/g, '\n')));
lua.lua_setglobal(L, to_luastring('COILED'));
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, names.length * 2 + 2);
for (const n of names) {
  let src; try { src = fs.readFileSync(path.join(W, n), 'utf8'); } catch (e) { console.log('FAIL cannot read ' + n); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(n)); lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, names.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
