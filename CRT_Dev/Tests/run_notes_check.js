// CRT_Modules/Notes/Check.lua: the note check (#1288). Double callouts (one player, two callouts at the same moment,
// and the old lines an Assign block replaced) and orphan lines (timed text lines for players no row mentions), on
// Alex's Coiled Altar Mythic note (coiled_altar_note.txt) and small notes; Remove old lines. A block cast with no
// lines is deliberate (Alex, 2026-11-15) and no warning. Spell lines and the kick block are never doubles or orphans.
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
assert(A and Model and Check and Check.Run and Check.RemoveOld, "CRT.NoteCheck with Run and RemoveOld")
assert(Check.AddMissing == nil, "no Add missing casts (Alex, 2026-11-15)")

local passed, failed = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then passed = passed + 1 print("ok " .. name) else failed = failed + 1 print("FAIL " .. name .. ": " .. tostring(err)) end
end
local function lines(text) local out = {} for l in (text .. "\n"):gmatch("(.-)\r?\n") do out[#out + 1] = l end return out end
local function count(text, needle) return select(2, text:gsub((needle:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?{}]", "%%%0")), "")) end
local function summary(r) return #r.doubles .. " doubles, " .. #r.old .. " old, " .. #(r.stale or {}) .. " stale, " .. #r.orphans .. " orphans" .. (r.missing and ", a missing list" or "") end

-- COILED: the line numbers of the fixture. The 48 phase 1 "Grab ... orb" lines from before the Orb Carriers P1 block,
-- six per player: Sixz 6-11, Notkvr 12-17, Sarrantha 18-23, Dotsanhots 24-29, Gadios 30-35, Lichkingstoy 36-41,
-- Granddh 42-47, Lulu 48-53
local OLD_FIRST, OLD_LAST = 6, 35 -- the ones in a block row's words: Sixz, Notkvr, Sarrantha (their own rows),
                                  -- Dotsanhots ({diamond} purple orb) and Gadios ({star} green orb)

check("Alex's note: the Lulu doubles, the old P1 lines in the block's words, nothing about 3:40, no orphan", function()
  local r = Check.Run(COILED)
  assert(#r.orphans == 0 and r.missing == nil, "no orphans, no missing casts: " .. summary(r))
  -- double callouts: Sixz, Notkvr, Sarrantha and Lulu at the five casts the block has lines for; at 3:40 the block
  -- calls no one (its lines there went, which Alex means), so nothing doubles there
  assert(#r.doubles == 20, summary(r))
  local lulu = {}
  for _, d in ipairs(r.doubles) do
    if d.name == "Lulu" then lulu[#lulu + 1] = d end
    assert(d.block == "orb carriers p1", "every double is the block's: " .. tostring(d.block))
    assert(d.t ~= 220, "none at 3:40")
  end
  assert(#lulu == 5, "Lulu twice at each of five casts: " .. #lulu)
  local first = lulu[1]
  assert(first.ph == 1 and first.t == 7 and #first.lines == 2, "P1 0:07: two lines")
  local texts = {}
  for _, i in ipairs(first.lines) do texts[#texts + 1] = lines(COILED)[i] end
  assert(table.concat(texts, "\n"):find("text:{diamond} purple orb;", 1, true) and table.concat(texts, "\n"):find("text:Grab side green orb;", 1, true), table.concat(texts, "\n"))
  -- old lines: 30, those whose text fits a row of the block (3:40's too: still the callout from before the block).
  -- Lulu's "Grab side green orb" fits none of its rows, nor do Lichkingstoy's {skull} and Granddh's side green orb
  -- lines: they stay for Alex to judge
  assert(#r.old == 30, "30 old lines: " .. #r.old)
  for k, i in ipairs(r.old) do assert(i == OLD_FIRST + k - 1, "line " .. i .. " in order, from " .. OLD_FIRST) end
  assert(not Check.Clean(r), "not clean")
end)

check("Alex's note: Remove old lines; Lulu's five doubles left to judge; 3:40 stays without lines", function()
  local r = Check.Run(COILED)
  local text = Check.RemoveOld(COILED, r)
  assert(#lines(text) == #lines(COILED) - 30, "30 lines out")
  for _, who in ipairs({ "Sixz", "Notkvr", "Sarrantha", "Dotsanhots", "Gadios" }) do
    assert(not text:find("ph:1;tag:" .. who .. ";text:Grab ", 1, true), who .. "'s old P1 lines out")
  end
  assert(count(text, "ph:1;tag:Lulu;text:Grab side green orb;") == 6 and count(text, "ph:1;tag:Granddh;text:Grab side green orb;") == 6, "not in the block's words: kept")
  assert(text:find("time:7;ph:3;tag:Dotsanhots;text:Grab side green orb;", 1, true), "phase 3's lines stay")
  assert(count(text, "assign:orb carriers p1/") == 25 and not text:find("time:220;ph:1;tag:Lulu;text:{diamond}", 1, true), "the block as Alex left it")
  local after = Check.Run(text)
  assert(#after.doubles == 5 and #after.old == 0 and #after.orphans == 0, "Lulu's doubles: " .. summary(after))
  for _, d in ipairs(after.doubles) do assert(d.name == "Lulu", "only Lulu's") end
  -- Alex takes Lulu's old lines out by hand: Lichkingstoy's and Granddh's 12 stale lines left (#1294), then clean
  local done = text:gsub("time:[%d%.]+;ph:1;tag:Lulu;text:Grab side green orb;[^\n]*\n", "")
  local left = Check.Run(done)
  assert(#left.stale == 12 and #left.doubles == 0 and #left.old == 0 and #left.orphans == 0, "12 stale: " .. summary(left))
  assert(Check.Clean(Check.Run(Check.RemoveStale(done, left))), "clean: " .. summary(Check.Run(Check.RemoveStale(done, left))))
  -- the lists are still there to make blocks of
  assert(#A.Candidates(text) == 5, "five lists to make blocks")
end)

check("old lines: a line naming players off the block's row stays, still a double (review, #1288)", function()
  local typed = { { ph = 1, t = 30 } }
  local blk = table.concat(A.Lines({ name = "Orbs", times = typed, rows = { { label = "{cross} orb", text = "", tokens = { "Abu" }, casts = "all" } } }, typed), "\n")
  local text = blk .. "\ntime:30;ph:1;tag:Abu Cheo;text:Grab {cross} orb;"
  local r = Check.Run(text)
  assert(#r.old == 0, "Cheo isn't on the row: not removed")
  assert(#r.doubles == 1 and r.doubles[1].name == "Abu" and r.doubles[1].block == "orbs", "still Abu's double: " .. summary(r))
  assert(Check.RemoveOld(text, r) == text, "nothing removed")
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
  assert(#r.doubles == 0 and #r.old == 0, summary(r))
end)

check("a block cast with no lines is deliberate: no warning (Alex, 2026-11-15)", function()
  local typed = { { ph = 1, t = 30 }, { ph = 1, t = 90 }, { ph = 1, t = 150 } }
  local b = { name = "Orbs", times = typed, rows = { { label = "Odd", text = "", tokens = { "Abu" }, casts = "all" },
    { label = "Even", text = "", tokens = { "Cheo" }, casts = { 2 } } } }
  local text = table.concat(A.Lines(b, typed), "\n")
  -- the heading lists 2:30; every line of it taken out: nothing to say
  local cut = text:gsub("\ntime:150;[^\n]*", "")
  assert(cut ~= text and cut:find("times:1@30,1@90,1@150;", 1, true), "the heading still lists the cast")
  local r = Check.Run(cut)
  assert(Check.Clean(r), "no warning: " .. summary(r))
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

-- #1294: stale lines (Alex, 2026-11-15): typed lines for players at one of a block's casts, in none of its rows' words,
-- following no row; the shared line remover; the editor's line helpers
local STALE_FIRST, STALE_LAST = 36, 53 -- Lichkingstoy 36-41, Granddh 42-47, Lulu 48-53

check("stale: Alex's note: Lichkingstoy's, Granddh's and Lulu's 18 P1 lines, nothing else (#1294)", function()
  local r = Check.Run(COILED)
  assert(r.stale and #r.stale == 18, "18 stale lines: " .. (r.stale and #r.stale or "none"))
  for k, i in ipairs(r.stale) do assert(i == STALE_FIRST + k - 1, "line " .. i .. " in order, from " .. STALE_FIRST) end
  assert(#r.old == 30 and #r.orphans == 0 and #r.doubles == 20, "the rest as before: " .. summary(r))
  -- Remove stale lines takes exactly them; with Remove old lines too, the note is clean
  local text = Check.RemoveStale(COILED, r)
  assert(#lines(text) == #lines(COILED) - 18, "18 lines out")
  local kept = lines(COILED)
  for n = STALE_LAST, STALE_FIRST, -1 do table.remove(kept, n) end
  assert(table.concat(kept, "\n") == text, "every other line as it was")
  assert(count(text, "ph:1;tag:Lulu;text:Grab side green orb;") == 0 and count(text, "ph:1;tag:Granddh;") == 0
    and count(text, "ph:1;tag:Lichkingstoy;") == 0, "their P1 lines out")
  assert(text:find("time:7;ph:3;tag:Lichkingstoy;text:Grab {star} green orb;", 1, true) and text:find("time:7;ph:3;tag:Granddh;", 1, true), "their P3 lines stay")
  local after = Check.Run(text)
  assert(#after.stale == 0 and #after.old == 30 and #after.doubles == 15, "Lulu's doubles went with them: " .. summary(after))
  local clean = Check.RemoveOld(text, after)
  assert(Check.Clean(Check.Run(clean)), "clean: " .. summary(Check.Run(clean)))
  assert(not Check.Clean({ doubles = {}, old = {}, orphans = {}, stale = { 1 } }), "a stale line is something to say")
end)

check("stale: never a spell, a role, a line that follows a row, a near-miss, or a line off the block's casts (#1294)", function()
  local typed = { { ph = 1, t = 30 }, { ph = 1, t = 90 } }
  local blk = table.concat(A.Lines({ name = "Orbs", times = typed, rows = { { label = "{cross} orb", text = "", tokens = { "Abu" }, casts = "all" } } }, typed), "\n")
  local text = table.concat({ "EncounterID:1;Name:Stale", blk, "",
    "Kicks: Zed",
    "Healers: Kip, Ned",
    "Soaks",
    "Left: Cheo, Kip, Quin, Rob",
    "time:30;ph:1;tag:Kip;text:Use a defensive;",          -- a player, at a cast, in no row's words: stale
    "time:90.03;ph:1;tag:Quin;text:Move out;",            -- within the same-time tolerance: stale
    "time:30;ph:1;tag:Zed;text:Kicks;",                   -- follows Kicks: Zed
    "time:30;ph:1;tag:healers;text:Raid CD;",             -- a role
    "time:30;ph:1;tag:Warrior;text:Shout;",               -- a class
    "time:30;ph:1;tag:Kip;spellid:740;",                  -- a cooldown
    "time:30;ph:1;tag:Kip;spellid:740;text:Tranq now;",   -- a cooldown with a text
    "time:30;ph:1;tag:Cheo Kip Quin;text:Soak left;",      -- close to Left (Rob missing): a near-miss
    "time:60;ph:1;tag:Kip;text:Use a defensive;",         -- off the block's casts
    "time:30;ph:2;tag:Kip;text:Use a defensive;",         -- the same time in another phase
    "time:30;ph:1;tag:Abu;text:Grab {cross} orb;",        -- in the block's words: old, never stale
  }, "\n")
  local s = Model.New(text)
  local L = CRT.NoteLinks
  local m = L.Match(L.Rows(s), L.Lines(s))
  local at = {}
  for n, l in ipairs(lines(text)) do at[l] = n end
  local near = false
  for _, e in ipairs(m.near) do if e.line.index == at["time:30;ph:1;tag:Cheo Kip Quin;text:Soak left;"] then near = true end end
  assert(near, "the fixture's near-miss is one")
  assert(m.follow[at["time:30;ph:1;tag:Zed;text:Kicks;"]], "the fixture's Kicks line follows its row")
  local r = Check.Run(text)
  local want = { at["time:30;ph:1;tag:Kip;text:Use a defensive;"], at["time:90.03;ph:1;tag:Quin;text:Move out;"] }
  table.sort(want)
  assert(table.concat(r.stale, ",") == table.concat(want, ","), "only Kip's and Quin's: " .. table.concat(r.stale, ",") .. " want " .. table.concat(want, ","))
  assert(#r.old == 1 and r.old[1] == at["time:30;ph:1;tag:Abu;text:Grab {cross} orb;"], "the old line stays old")
  local out = Check.RemoveStale(text, r)
  assert(#lines(out) == #lines(text) - 2 and not out:find("Move out", 1, true) and out:find("time:60;ph:1;tag:Kip;text:Use a defensive;", 1, true), out)
  -- a stale line for a player no row lists is stale, not an orphan as well
  local lone = text .. "\ntime:90;ph:1;tag:Nobody;text:Stand here;"
  local r2 = Check.Run(lone)
  assert(r2.stale[#r2.stale] == #lines(lone) and #r2.orphans == 0, "stale, no orphan: " .. summary(r2))
end)

check("RemoveLines: one helper for every delete; every other byte kept, CRLF and the last line end too (#1294)", function()
  assert(Check.RemoveLines, "Check.RemoveLines")
  local text = "a\r\nb\r\nc\r\nd"
  assert(Check.RemoveLines(text, { 2 }) == "a\r\nc\r\nd", "one line")
  assert(Check.RemoveLines(text, { 4 }) == "a\r\nb\r\nc", "the last line: the one before ends the note")
  assert(Check.RemoveLines(text, { [3] = true, [4] = true }) == "a\r\nb", "a set works too")
  assert(Check.RemoveLines(text, {}) == text, "nothing")
  assert(Check.RemoveLines("a\nb\n", { 1 }) == "b\n", "a trailing line end kept")
end)

check("SameLines: every line with the same players and text, any time and phase (#1294)", function()
  local same = Check.SameLines(COILED, 48)
  assert(table.concat(same, ",") == "48,49,50,51,52,53", "Lulu's six: " .. table.concat(same, ","))
  assert(#Check.SameLines(COILED, 42) == 6, "Granddh's six, not Lulu's")
  assert(#Check.SameLines(COILED, 85) == 3, "Whitecrows' P3 three")
  assert(#Check.SameLines(COILED, 158) == 0, "a heading: none")
end)

check("Groups and InBlocks: what a confirm lists (#1294)", function()
  local g = Check.Groups(COILED, { 36, 48, 49, 50, 51, 52, 53 })
  assert(#g == 2 and g[1].who == "Lichkingstoy" and g[1].n == 1 and g[2].who == "Lulu" and g[2].n == 6, "two groups")
  assert(g[2].text == "Grab side green orb" and g[2].first.time == 7 and g[2].last.time == 220 and (g[2].first.ph or 1) == 1, "with when")
  local b = Check.InBlocks(COILED, { 60, 61, 48, 65 })
  assert(#b == 1 and b[1].name == "Orb Carriers P1" and b[1].n == 3 and b[1].key == "orb carriers p1", "3 in the block: " .. tostring(b[1] and b[1].n))
  assert(#Check.InBlocks(COILED, { 48 }) == 0, "none")
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
