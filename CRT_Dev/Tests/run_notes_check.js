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

-- COILED: the line numbers of the fixture. The 48 phase 1 "Grab ... orb" lines from before the Orb Carriers P1 block,
-- six per player: Sixz 6-11, Notkvr 12-17, Sarrantha 18-23, Dotsanhots 24-29, Gadios 30-35, Lichkingstoy 36-41,
-- Granddh 42-47, Lulu 48-53
local OLD_FIRST, OLD_LAST = 6, 35 -- the ones in a block row's words: Sixz, Notkvr, Sarrantha (their own rows),
                                  -- Dotsanhots ({diamond} purple orb) and Gadios ({star} green orb)

check("Alex's note: the Lulu double, the old P1 lines in the block's words, the missing 3:40, no orphan", function()
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
  -- old lines: 30, those whose text fits a row of the block. Lulu's "Grab side green orb" fits none of its rows,
  -- nor do Lichkingstoy's {skull} and Granddh's side green orb lines: they stay for Alex to judge
  assert(#r.old == 30, "30 old lines: " .. #r.old)
  for k, i in ipairs(r.old) do assert(i == OLD_FIRST + k - 1, "line " .. i .. " in order, from " .. OLD_FIRST) end
  -- missing: cast 6 of Orb Carriers P1, which Add missing casts can write (every row was on every other cast)
  assert(#r.missing == 1 and r.missing[1].key == "orb carriers p1" and r.missing[1].name == "Orb Carriers P1" and r.missing[1].fixable, "the block")
  assert(#r.missing[1].casts == 1 and r.missing[1].casts[1] == 6 and r.missing[1].times[1].ph == 1 and r.missing[1].times[1].t == 220, "cast 6, P1 3:40")
  assert(not Check.Clean(r), "not clean")
end)

check("Alex's note: Remove old lines, then Add missing casts: the cast back; Lulu's six doubles left to judge", function()
  local r = Check.Run(COILED)
  local text = Check.RemoveOld(COILED, r)
  assert(#lines(text) == #lines(COILED) - 30, "30 lines out")
  for _, who in ipairs({ "Sixz", "Notkvr", "Sarrantha", "Dotsanhots", "Gadios" }) do
    assert(not text:find("ph:1;tag:" .. who .. ";text:Grab ", 1, true), who .. "'s old P1 lines out")
  end
  assert(count(text, "ph:1;tag:Lulu;text:Grab side green orb;") == 6 and count(text, "ph:1;tag:Granddh;text:Grab side green orb;") == 6, "not in the block's words: kept")
  assert(text:find("time:7;ph:3;tag:Dotsanhots;text:Grab side green orb;", 1, true), "phase 3's lines stay")
  local mid = Check.Run(text)
  assert(#mid.doubles == 6 and #mid.old == 0 and #mid.missing == 1, "after Remove: Lulu's doubles and the missing cast: " .. summary(mid))
  text = Check.AddMissing(text)
  local after = Check.Run(text)
  assert(#after.missing == 0 and #after.old == 0 and #after.orphans == 0 and #after.doubles == 6, "the cast back: " .. summary(after))
  for _, d in ipairs(after.doubles) do assert(d.name == "Lulu" and not d.planned, "only Lulu's") end
  assert(count(text, "assign:orb carriers p1/") == 30, "6 casts of 5 rows: " .. count(text, "assign:orb carriers p1/"))
  assert(text:find("time:220;ph:1;tag:Lulu;text:{diamond} purple orb;assign:orb carriers p1/4/6;", 1, true), "Lulu at 3:40")
  -- Alex takes Lulu's six old lines out by hand: clean
  local done = text:gsub("time:[%d%.]+;ph:1;tag:Lulu;text:Grab side green orb;[^\n]*\n", "")
  assert(Check.Clean(Check.Run(done)), "clean: " .. summary(Check.Run(done)))
  -- the other order gives the same note
  local other = Check.RemoveOld(Check.AddMissing(COILED), Check.Run(Check.AddMissing(COILED)))
  assert(other == text, "Add, then Remove: the same note")
  -- the lists are still there to make blocks of
  assert(#A.Candidates(text) == 5, "five lists to make blocks")
end)

check("old lines: a line of another list's row, or for a role, is never old (review, #1288)", function()
  local typed = { { ph = 1, t = 30 }, { ph = 1, t = 47.97 } }
  local orbs = table.concat(A.Lines({ name = "Orbs", times = typed, rows = { { label = "{cross} orb", text = "", tokens = { "Abu" }, casts = "all" } } }, typed), "\n")
  local guill = table.concat(A.Lines({ name = "Guillotine", times = typed, rows = { { label = "Soak Guillotine", text = "", tokens = { "Cheo", "Kip" }, casts = "all" } } }, typed), "\n")
  local text = table.concat({ orbs, guill, "",
    "Kicks: Abu",
    "time:30;ph:1;tag:Abu;text:Kicks;",                         -- follows the Kicks row, at the Orbs block's cast
    "time:47.97;ph:1;tag:healers;text:Raid CD for Guillotine;", -- a role line, at the Guillotine block's cast
    "time:47.97;ph:1;tag:Zed;text:Soak Guillotine;",            -- a player's line in the block's words: old
  }, "\n")
  local r = Check.Run(text)
  local kicks, healers, zed
  for n, l in ipairs(lines(text)) do
    if l == "time:30;ph:1;tag:Abu;text:Kicks;" then kicks = n end
    if l:find("tag:healers", 1, true) then healers = n end
    if l:find("tag:Zed", 1, true) then zed = n end
  end
  local isOld = {}
  for _, i in ipairs(r.old) do isOld[i] = true end
  assert(not isOld[kicks], "Abu's Kicks line follows its own row: never old")
  assert(not isOld[healers], "a role line is never old")
  assert(isOld[zed] and #r.old == 1, "Zed's line in the block's words is: " .. table.concat(r.old, ","))
  local doubleAbu
  for _, d in ipairs(r.doubles) do if d.name == "Abu" then doubleAbu = d end end
  assert(doubleAbu and doubleAbu.block == "orbs", "Abu's two callouts at 0:30 still show as a double")
  local out = Check.RemoveOld(text, r)
  assert(out:find("time:30;ph:1;tag:Abu;text:Kicks;", 1, true) and out:find("Raid CD for Guillotine", 1, true) and not out:find("tag:Zed", 1, true), out)
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
  -- cast 3's line taken out by hand: missing, but picked-cast rows never get it (Alex, 2026-11-15): the warning stays
  local cut = text:gsub("\ntime:150;[^\n]*", "")
  local r = Check.Run(cut)
  assert(#r.missing == 1 and r.missing[1].casts[1] == 3 and not r.missing[1].fixable, summary(r))
  assert(Check.AddMissing(cut) == cut, "no row is put on cast 3")
  assert(#Check.Run(cut).missing == 1, "still missing")
  -- rotate rows: the same
  local T4 = { { ph = 1, t = 30 }, { ph = 1, t = 90 }, { ph = 1, t = 150 }, { ph = 1, t = 210 } }
  local rot = table.concat(A.Lines({ name = "Turns", times = T4, rows = { { label = "Odd", text = "", tokens = { "Abu" }, casts = "rotate" },
    { label = "Even", text = "", tokens = { "Cheo" }, casts = "rotate" } } }, T4), "\n")
  local rotCut = rot:gsub("\ntime:210;[^\n]*", "")
  assert(#Check.Run(rotCut).missing == 1 and Check.AddMissing(rotCut) == rotCut, "a rotate block's lost cast isn't given to every row")
  -- a row on every cast but the lost one: back on all of them; a picked row beside it stays as it was
  local mixed = table.concat(A.Lines({ name = "Mixed", times = typed, rows = { { label = "Left", text = "", tokens = { "Abu" }, casts = "all" },
    { label = "Right", text = "", tokens = { "Cheo" }, casts = { 1 } } } }, typed), "\n")
  local mixedCut = mixed:gsub("\ntime:150;[^\n]*", "")
  local back = Check.AddMissing(mixedCut)
  assert(back:find("time:150;ph:1;tag:Abu;text:Left;assign:mixed/1/3;", 1, true) and not back:find("time:150;ph:1;tag:Cheo", 1, true), back)
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
