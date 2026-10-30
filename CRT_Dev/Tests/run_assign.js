// CRT_Modules/Notes/Assign.lua: an assignment block (a heading, rows of players with their text and casts) as raid
// note lines. Lines for every cast pattern (all, a list, rotate) and an untimed block; the block read back from the
// text (round trips, typed times); Replace in place with every other line byte for byte (CRLF kept), a rename, a
// removal; Write into the boss's note for exactly one difficulty, its timed lines linked to their rows so a name change
// in the note editor rewrites them (Notes/Links.lua); a pasted note's group list recognised and made a block.
// Usage: node run_assign.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
function CreateFrame()
  local f = { events = {} }
  function f:RegisterEvent(ev) self.events[ev] = true end
  function f:UnregisterEvent(ev) self.events[ev] = nil end
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
function date() return "2026-10-29 12:00" end
function UnitName(u) if u == "player" then return "Cheoeqar" end end
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
local P, M, Notes, A, Model, Links = CRT.NoteParser, CRT.MechNote, CRT.Notes, CRT.NoteAssign, CRT.NoteEditModel, CRT.NoteLinks
assert(P and M and Notes and A and Model and Links, "modules exist")

local failed = 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)) failed = failed + 1 end
end
local function reset()
  CRT.db.notes.list = {} CRT.db.notes.nextId = 1 CRT.db.notes.active = nil CRT.db.notes.links = nil CRT.db.notes.history = nil
end
local function lines(text) local out = {} for l in (text .. "\\n"):gmatch("(.-)\\r?\\n") do out[#out + 1] = l end return out end
local function joined(list) return table.concat(list, "\\n") end

-- Ravenous Feast: three casts in phase 1, one in phase 2
local CASTS = { { ph = 2, t = 20 }, { ph = 1, t = 96 }, { ph = 1, t = 36 }, { ph = 1, t = 156 } }
local function feast()
  return { name = "Ravenous Feast", spellID = 1234, rows = {
    { label = "Left", text = "Soak left", tokens = { "Solex", "Rixxy" }, casts = "all" },
    { label = "Right", text = "", tokens = { "Abu" }, casts = "all" },
    { label = "Center", text = "Stack", tokens = { "Cheo", "Demon Hunter" }, casts = { 2, 4 } },
  } }
end

check("assign: names, labels, keys and casts as text", function()
  assert(A.CleanName("  Ravenous: Feast; ") == "Ravenous Feast" and A.CleanName("") == "Assignment", "a heading has no colon: " .. A.CleanName("  Ravenous: Feast; "))
  assert(A.Key("Ravenous  Feast") == "ravenous feast" and A.Key("A/B") == "ab", "the key")
  assert(A.CleanLabel("Left side, {star}", 1) == "Left side star" and A.CleanLabel("", 3) == "Row 3", A.CleanLabel("Left side, {star}", 1))
  assert(A.CleanLabel("Phase 2", 2) == "Row 2" and A.CleanLabel("one two three four five", 1) == "one two three four", "a label reads as one")
  assert(A.ParseCasts("") == "all" and A.ParseCasts("Rotate") == "rotate", "all and rotate")
  local l = A.ParseCasts("4, 1 4,2")
  assert(l and table.concat(l, ",") == "1,2,4" and A.FormatCasts(l) == "1, 2, 4", "a list, sorted, each once")
  assert(A.ParseCasts("0") == nil and A.ParseCasts("x") == nil and A.ParseCasts("1.5") == nil, "bad lists don't read")
end)

check("assign: lines for all, a list and rotate; a row with no one has no timed lines", function()
  local out = A.Lines(feast(), CASTS)
  assert(out[1] == "assign:ravenous feast;name:Ravenous Feast;" and out[2] == "Left: Solex Rixxy" and out[3] == "Right: Abu" and out[4] == "Center: Cheo Demon Hunter", joined(out))
  -- cast order 1@36, 1@96, 1@156, 2@20: Left and Right on all four, Center on 2 and 4
  assert(#out == 4 + 4 + 4 + 2, "timed lines: " .. (#out - 4))
  assert(out[5] == "time:36;ph:1;tag:Solex Rixxy;spellid:1234;text:Soak left;assign:ravenous feast/1/1;", out[5])
  assert(out[6] == "time:36;ph:1;tag:Abu;spellid:1234;text:Right;assign:ravenous feast/2/1;", "an empty text: the label: " .. out[6])
  assert(out[7] == "time:96;ph:1;tag:Solex Rixxy;spellid:1234;text:Soak left;assign:ravenous feast/1/2;", out[7])
  assert(out[9] == "time:96;ph:1;tag:Cheo Demon Hunter;spellid:1234;text:Stack;assign:ravenous feast/3/2;", out[9])
  local t = P.Parse(out[9]).timers[1]
  assert(t.time == 96 and t.ph == 1 and t.text == "Stack" and P.Field(out[9], "assign") == "ravenous feast/3/2", "reads as a timed line")
  -- rotate: the rotate rows take the casts in turn
  local b = feast()
  b.rows[1].casts, b.rows[2].casts, b.rows[3].casts = "rotate", "rotate", "all"
  local per = A.RowLines(b, CASTS)
  local function casts(r) local o = {} for i, e in ipairs(per[r]) do o[i] = e.cast end return table.concat(o, ",") end
  assert(casts(1) == "1,3" and casts(2) == "2,4" and casts(3) == "1,2,3,4", casts(1) .. " / " .. casts(2) .. " / " .. casts(3))
  -- no one in a row: its label line only
  b.rows[2].tokens = {}
  out = A.Lines(b, CASTS)
  assert(out[3] == "Right:" and not joined(out):find("feast/2/", 1, true), "an empty row writes no timed line")
  -- untimed: the heading and the rows only
  out = A.Lines(feast(), nil)
  assert(#out == 4 and out[1] == "assign:ravenous feast;name:Ravenous Feast;", "untimed: " .. joined(out))
  out = A.Lines(feast(), {}, { key = "x#2", mech = "1234" })
  assert(#out == 4 and out[1] == "assign:x#2;name:Ravenous Feast;for:1234;", "no times, no timed lines; the mechanic: " .. out[1])
  -- typed times ride on the heading, so they stay with no one in a row
  local typed = { name = "Mine", times = { { ph = 2, t = 5 }, { ph = 1, t = 20 } }, rows = { { label = "Left", text = "", tokens = {}, casts = "all" } } }
  out = A.Lines(typed, typed.times)
  assert(out[1] == "assign:mine;name:Mine;times:1@20,2@5;" and #out == 2, joined(out))
  local back = A.Read(joined(out), "mine", nil)
  assert(back.times and #back.times == 2 and back.times[1].t == 20 and back.times[2].ph == 2, "the typed times read back with no players")
  -- every reader shows the heading as its name
  assert(P.Parse(joined(out)).lines[1] == "Mine" and Model.New(joined(out)).rows[1].kind == "heading" and Model.New(joined(out)).rows[1].text == "Mine", "a heading")
end)

check("assign: a block read back from its lines (all, a list, rotate; typed times; untimed)", function()
  local text = "Intro\\n" .. joined(A.Lines(feast(), CASTS)) .. "\\nOutro"
  local b = A.Read(text, "ravenous feast", CASTS)
  assert(b and b.name == "Ravenous Feast" and #b.rows == 3, "three rows")
  assert(b.rows[1].label == "Left" and table.concat(b.rows[1].tokens, ",") == "Solex,Rixxy" and b.rows[1].text == "Soak left" and b.rows[1].casts == "all", "Left")
  assert(b.rows[2].text == "" and b.rows[2].casts == "all", "Right's text was its label: read as empty")
  assert(table.concat(b.rows[3].tokens, ",") == "Cheo,Demon Hunter" and type(b.rows[3].casts) == "table" and table.concat(b.rows[3].casts, ",") == "2,4", "Center's list")
  assert(b.spellID == 1234 and b.times == nil, "the spell; times are the mechanic's")
  assert(joined(A.Lines(b, CASTS)) == joined(A.Lines(feast(), CASTS)), "written again, the same lines")
  -- rotate
  local r = feast()
  r.rows[1].casts, r.rows[2].casts = "rotate", "rotate"
  local back = A.Read(joined(A.Lines(r, CASTS)), "ravenous feast", CASTS)
  assert(back.rows[1].casts == "rotate" and back.rows[2].casts == "rotate", "rotate read back")
  -- typed times: the lines' own
  local typed = feast()
  typed.times = { { ph = 1, t = 10 }, { ph = 1, t = 70 } }
  typed.rows[3].casts = { 2 }
  back = A.Read(joined(A.Lines(typed, typed.times)), "ravenous feast", nil)
  assert(back.times and #back.times == 2 and back.times[2].t == 70, "typed times read from the lines")
  assert(table.concat(back.rows[3].casts, ",") == "2", "and the list against them")
  -- untimed
  back = A.Read(joined(A.Lines(feast(), nil)), "ravenous feast", nil)
  assert(back and #back.rows == 3 and back.times == nil and back.rows[1].casts == "all" and table.concat(back.rows[2].tokens, ",") == "Abu", "untimed read back")
  assert(A.Read("Ravenous Feast\\nLeft: Abu, Cheo", "ravenous feast") == nil, "a plain heading with rows is never a block")
  assert(b.hasHeading and b.hasLines, "Read says what it found")
  -- the ability timeline moved the second cast (96 -> 100): its lines are still that cast's, written at the new time
  local moved = { { ph = 2, t = 20 }, { ph = 1, t = 100 }, { ph = 1, t = 36 }, { ph = 1, t = 156 } }
  back = A.Read(text, "ravenous feast", moved)
  assert(back.rows[1].casts == "all" and table.concat(back.rows[3].casts, ",") == "2,4", "the casts kept by number")
  local again = joined(A.Lines(back, moved))
  assert(again:find("time:100;ph:1;tag:Cheo Demon Hunter;", 1, true) and not again:find("time:96;", 1, true), "the lines move with the cast")
end)

check("assign: Replace in place, every other line byte for byte; rename; remove", function()
  local base = table.concat({ "EncounterID:3470;Difficulty:Mythic;Name:Twin Fangs", "time:12;ph:1;tag:all;text:Other;mech:999;",
    "  Kicks: Abu , Cheo  ", "" }, "\\r\\n")
  local first = A.Replace(base, "ravenous feast", A.Lines(feast(), CASTS))
  local a = lines(first)
  assert(a[1] == "EncounterID:3470;Difficulty:Mythic;Name:Twin Fangs" and a[3] == "  Kicks: Abu , Cheo  " and a[4] == "" and a[5] == "assign:ravenous feast;name:Ravenous Feast;", "added at the end after a blank line, before the trailing line end")
  assert(first:sub(1, #base - 2) == base:sub(1, #base - 2) and first:find("\\r\\n\\r\\nassign:ravenous feast;name:Ravenous Feast;\\r\\nLeft: Solex Rixxy\\r\\n", 1, true), "CRLF kept, the lines in its style")
  -- a change replaces them where they are; the rest stays byte for byte
  local withMore = first .. "Trailer line"
  local b = feast()
  b.rows[1].tokens = { "Solex", "Kip" }
  local second = A.Replace(withMore, "ravenous feast", A.Lines(b, CASTS))
  local s2 = lines(second)
  assert(s2[5] == "assign:ravenous feast;name:Ravenous Feast;" and s2[6] == "Left: Solex Kip" and s2[#s2] == "Trailer line", "in place")
  assert(not second:find("Rixxy", 1, true) and select(2, second:gsub("assign:", "")) == 11, "the old lines gone, the new there (the heading and ten)")
  local kept = second:gsub("assign:ravenous feast;name:Ravenous Feast;\\r\\n", ""):gsub("[^\\r\\n]*assign:[^\\r\\n]*\\r\\n", ""):gsub("Left: [^\\r\\n]*\\r\\nRight: [^\\r\\n]*\\r\\nCenter: [^\\r\\n]*\\r\\n", "")
  assert(kept == base:sub(1, #base - 2) .. "\\r\\n\\r\\nTrailer line", "every other line as it was (and the blank line before the block):\\n" .. kept)
  -- renamed: the old block's place, the new name
  b.name = "Feast soaks"
  local third = A.Replace(second, A.Key(b.name), A.Lines(b, CASTS), "ravenous feast")
  local s3 = lines(third)
  assert(s3[5] == "assign:feast soaks;name:Feast soaks;" and not third:find("Ravenous Feast", 1, true) and not third:find("assign:ravenous", 1, true), "renamed in place")
  -- removed
  local gone = A.Replace(third, "feast soaks", {})
  assert(gone == base:sub(1, #base - 2) .. "\\r\\n\\r\\nTrailer line", "removed: the note as it was, the blank line before the trailer kept")
  -- another block and a Raid note alert's lines live side by side
  local two = A.Replace(third, "second", A.Lines({ name = "Second", rows = { { label = "Left", text = "", tokens = { "Zed" }, casts = "all" } } }, CASTS))
  assert(A.Read(two, "feast soaks", CASTS) and A.Read(two, "second", CASTS) and two:find("mech:999;", 1, true), "both blocks and the alert line")
  assert(table.concat(A.Keys(two), ",") == "feast soaks,second", table.concat(A.Keys(two), ","))
end)

check("assign: a new block in the note's own form: names without realms, spaces between them, a blank line before it", function()
  -- Alex, 2026-10-30: an Add assignment group glued under the Kick order with "Kill Group: Whitecrows-Stormrage, Gadios-Silvermoon"
  local kick = "EncounterID:3421;Difficulty:Mythic;Name:Twin Fangs\\nintstart\\nSolex Rixxy\\nAbu Cheo\\nintend\\nSent by: Lulu-Kel'Thuzad"
  local b = { name = "Testing a new Assignment", rows = { { label = "Kill Group", text = "", tokens = {}, casts = "all" } } }
  for _, who in ipairs({ "Whitecrows-Stormrage", "Gadios-Silvermoon", "Lichkingstoy-Sentinels" }) do
    assert(A.AddToken(b, 1, who), "added " .. who)
  end
  assert(not A.AddToken(b, 1, "Gadios") and not A.AddToken(b, 1, "gadios-otherrealm"), "a name the row has, with or without a realm, is refused")
  local out = A.Lines(b, nil)
  assert(out[2] == "Kill Group: Whitecrows Gadios Lichkingstoy", "the row's line as the kick lines write theirs: " .. tostring(out[2]))
  local text = A.Replace(kick, A.Key(b.name), out)
  assert(text == kick .. "\\n\\nassign:testing a new assignment;name:Testing a new Assignment;\\nKill Group: Whitecrows Gadios Lichkingstoy",
    "a blank line between the note and the new block: " .. text)
  -- timed lines carry the same names
  local timed = A.Lines(b, { { ph = 1, t = 30 } })
  assert(timed[3] == "time:30;ph:1;tag:Whitecrows Gadios Lichkingstoy;text:Kill Group;assign:testing a new assignment/1/1;", tostring(timed[3]))
  -- a block read back from an older note keeps its realm names; written again, they go
  local old = A.Read("assign:x;name:X;\\nLeft: Abu-Sargeras, Cheo", "x")
  assert(table.concat(old.rows[1].tokens, ",") == "Abu-Sargeras,Cheo" and A.Lines(old)[2] == "Left: Abu Cheo", "rewritten: " .. A.Lines(old)[2])
  -- comparing two texts, how the names are written never counts; a time or a text does
  local oldForm = "Left: Abu-Sargeras, Cheo\\ntime:36;ph:1;tag:Abu-Sargeras  Cheo;text:Soak;"
  assert(A.NameForm(oldForm) == A.NameForm("Left: Abu Cheo\\ntime:36;ph:1;tag:Abu Cheo;text:Soak;"), "the same names: " .. A.NameForm(oldForm))
  assert(A.NameForm(oldForm) ~= A.NameForm("Left: Abu Cheo\\ntime:40;ph:1;tag:Abu Cheo;text:Soak;"), "a moved time counts")
  assert(A.NameForm(oldForm) ~= A.NameForm("Left: Abu Kip\\ntime:36;ph:1;tag:Abu Cheo;text:Soak;"), "another name counts")
  -- written again in place: one blank line, never another
  b.rows[1].tokens = { "Solex" }
  local again = A.Replace(text, A.Key(b.name), A.Lines(b, nil))
  assert(again == kick .. "\\n\\nassign:testing a new assignment;name:Testing a new Assignment;\\nKill Group: Solex", "in place: " .. again)
  -- a block that follows another: a blank line between them; a trailing line end stays the note's last
  local second = A.Replace(again .. "\\n", "two", A.Lines({ name = "Two", rows = { { label = "Right", text = "", tokens = { "Kip" }, casts = "all" } } }, nil))
  assert(second == again .. "\\n\\nassign:two;name:Two;\\nRight: Kip\\n", "between two blocks: " .. second)
  -- no blank line after the header, after a blank line, or into an empty note
  local header = "EncounterID:3421;Difficulty:Mythic;Name:Twin Fangs\\n"
  assert(A.Replace(header, "two", { "assign:two;name:Two;" }) == header .. "assign:two;name:Two;\\n", "after the header: " .. A.Replace(header, "two", { "assign:two;name:Two;" }))
  assert(A.Replace("Intro\\n\\n", "two", { "assign:two;name:Two;" }) == "Intro\\n\\nassign:two;name:Two;\\n", "after a blank line")
  assert(A.Replace("", "two", { "assign:two;name:Two;" }) == "assign:two;name:Two;", "an empty note")
  -- taken out again: its blank line goes with it, so the note is as it was
  assert(A.Replace(second, "two", {}) == again .. "\\n", "removed at the end: " .. A.Replace(second, "two", {}))
  assert(A.Replace(again, A.Key(b.name), {}) == kick .. "\\n", "removed: the note as it was, ending in a line end")
end)

check("assign: Write into the boss's note for exactly that difficulty, lines linked to their rows", function()
  reset()
  local heroic = Notes:Import("EncounterID:3470;Difficulty:Heroic;Name:Twin Fangs\\nHeroic stuff")
  -- the Mythic pull reads the Heroic note: refused, with what to do (Notes:WriteTarget)
  local none, why = A.Write(3470, "Mythic", "Twin Fangs", "ravenous feast", A.Lines(feast(), CASTS))
  assert(none == nil and why and why:find("Make a Mythic note first", 1, true), tostring(why))
  local mythic = Notes:Import("EncounterID:3470;Difficulty:Mythic;Name:Twin Fangs\\n")
  local id = A.Write(3470, "Mythic", "Twin Fangs", "ravenous feast", A.Lines(feast(), CASTS))
  assert(id == mythic, "the Mythic note, never the Heroic one")
  local rec = Notes:Get(id)
  assert(rec.difficulty == "Mythic" and rec.raw:find("Left: Solex Rixxy", 1, true) and A.CountIn(rec.raw, "ravenous feast") == 10, "written")
  assert(Notes:Get(heroic).raw == "EncounterID:3470;Difficulty:Heroic;Name:Twin Fangs\\nHeroic stuff", "the Heroic note untouched")
  -- the links: in the editor's session, every timed line follows its row, even Right with one name
  local s = Model.New(rec.raw)
  local m = Links.Match(Links.Rows(s), Links.Lines(s), Links.Saved(id))
  local rows = Links.Rows(s)
  local count = {}
  for _, row in ipairs(rows) do count[row.label] = #(m.byRow[row.index] or {}) end
  assert(count.Left == 4 and count.Right == 4 and count.Center == 2, "followers: " .. tostring(count.Left) .. " " .. tostring(count.Right) .. " " .. tostring(count.Center))
  -- a name change on Right (in the editor) rewrites its lines
  local snap = Links.Snapshot(s, Links.Saved(id))
  local right = rows[2].index
  assert(s:Add(right, "Kip"), "add Kip to Right")
  assert(Links.Apply(s, snap) == 4, "Right's four lines rewritten")
  local after = s:Text()
  assert(select(2, after:gsub("tag:Abu Kip;", "")) == 4, "with the new names")
  local back = A.Read(after, "ravenous feast", CASTS)
  assert(table.concat(back.rows[2].tokens, ",") == "Abu,Kip", "the block reads the new names")
  -- writing again (a change in the tab) keeps one copy, in place
  local id2 = A.Write(3470, "Mythic", "Twin Fangs", "ravenous feast", A.Lines(back, CASTS), "ravenous feast")
  assert(id2 == id and A.CountIn(Notes:Get(id).raw, "ravenous feast") == 10, "the same note, the same count")
end)

check("assign: a pasted note's group list recognised and made a block", function()
  reset()
  local pasted = table.concat({
    "EncounterID:3470;Difficulty:Mythic;Name:Twin Fangs",
    "Caustic Deluge Orbs",
    "Odd: Solex, Rixxy",
    "Even: Abu, Cheo",
    "time:30;ph:1;tag:Solex Rixxy;text:Orbs;",
    "time:90;ph:1;tag:Abu Cheo;text:Orbs;",
    "time:150;ph:1;tag:Solex Rixxy;text:Orbs;",
    "time:210;ph:1;tag:Abu Cheo;text:Orbs;",
    "time:999;ph:1;tag:Abu Cheo;text:Off pattern;",
    "Notes for the raid",
  }, "\\n")
  local c = A.Candidates(pasted)
  assert(#c == 1 and c[1].name == "Caustic Deluge Orbs" and c[1].heading == 2 and c[1].lines == 5, "one group list, five lines follow it")
  local casts = { { ph = 1, t = 30 }, { ph = 1, t = 90 }, { ph = 1, t = 150 }, { ph = 1, t = 210 } }
  local b, taken = A.FromRows(pasted, 2, casts)
  assert(b.rows[1].label == "Odd" and b.rows[1].casts == "rotate" and b.rows[2].casts == "rotate", "odd and even: rotate")
  assert(b.rows[1].text == "Orbs" and taken[5] and not taken[9], "the text; the line on no cast stays")
  local text, block = A.Adopt(pasted, 2, casts, { spellID = 4321 })
  assert(block and block.key == "caustic deluge orbs", "the block's key")
  local back = A.Read(text, "caustic deluge orbs", casts)
  assert(back and back.rows[1].casts == "rotate" and table.concat(back.rows[2].tokens, ",") == "Abu,Cheo", "read back as a block")
  assert(text:find("time:999;ph:1;tag:Abu Cheo;text:Off pattern;", 1, true) and text:find("Notes for the raid", 1, true), "the rest kept")
  assert(select(2, text:gsub("assign:caustic deluge orbs/", "")) == 4 and text:find("spellid:4321;", 1, true), "marked, with the mechanic's spell")
  assert(#A.Candidates(text) == 0, "no longer a candidate")
  -- with no casts given: the lines' own times, in turn
  local typed = A.FromRows(pasted, 2, nil)
  assert(typed.times and #typed.times == 5 and type(typed.rows[2].casts) == "table", "typed times, a list where it isn't in turn")
end)

check("assign: a typed group list is never a block; a block's heading belongs to it alone", function()
  -- (a) a raider's own "Ravenous Feast" list with no markers: no block, and the mechanic's blocks are none
  local own = "EncounterID:3470;Difficulty:Mythic;Name:Twin Fangs\\nRavenous Feast\\nLeft: Abu, Cheo\\ntime:36;tag:Abu Cheo;text:Soak;"
  assert(A.Read(own, "ravenous feast", CASTS) == nil and #A.BlocksFor(own, "1234") == 0 and #A.Keys(own) == 0, "no block")
  assert(A.Replace(own, "ravenous feast", {}) == own, "taking out a block that isn't there leaves it byte for byte")
  -- its name is taken for a new block, so a new one gets the next free name
  assert(A.KeyTaken(own, "ravenous feast") and A.FreeName(own, "Ravenous Feast") == "Ravenous Feast 2", "the next free name")
  -- (c) that list earlier in the note and a block of the same name after it: a write touches only the block's lines
  local withBlock = own .. "\\n" .. joined(A.Lines(feast(), CASTS, { mech = "1234" }))
  local b = A.Read(withBlock, "ravenous feast", CASTS)
  b.rows[1].tokens = { "Kip" }
  local after = A.Replace(withBlock, "ravenous feast", A.Lines(b, CASTS, { mech = "1234" }), "ravenous feast")
  assert(after:sub(1, #own) == own, "the typed list byte for byte")
  assert(after:find("\\nLeft: Kip\\n", 1, true) and select(2, after:gsub("assign:ravenous feast/1/", "")) == 4, "the block's own rows and lines changed")
  assert(table.concat(A.BlocksFor(withBlock, "1234"), ",") == "ravenous feast", "found by its mechanic")
  -- (b) the block's heading renamed by hand in the raw text: found by its key, no timed line lost
  local renamed = withBlock:gsub("name:Ravenous Feast;", "name:Feast by hand;")
  local back = A.Read(renamed, "ravenous feast", CASTS)
  assert(back and back.name == "Feast by hand" and back.hasHeading and back.hasLines and #back.rows == 3, "read")
  local again = A.Replace(renamed, "ravenous feast", A.Lines(back, CASTS, { mech = "1234" }), "ravenous feast")
  assert(select(2, again:gsub("assign:feast by hand/", "")) == 10 and not again:find("assign:ravenous feast", 1, true)
    and again:find("assign:feast by hand;name:Feast by hand;", 1, true), "no timed line lost, the key follows the name")
  -- the heading line gone by hand: the rows' names come from the lines' tag:
  local headless = withBlock:gsub("assign:ravenous feast;name:Ravenous Feast;for:1234;\\n", ""):gsub("\\nLeft: Solex Rixxy\\nRight: Abu\\nCenter: Cheo Demon Hunter", "")
  back = A.Read(headless, "ravenous feast", CASTS)
  assert(back and not back.hasHeading and back.hasLines and table.concat(back.rows[1].tokens, ",") == "Solex,Rixxy"
    and table.concat(back.rows[3].tokens, ",") == "Cheo,Demon Hunter", "names from the tags")
end)

check("assign: keys unique in the note; Write refuses a taken name; links on a saved note only", function()
  reset()
  local id = Notes:Import("EncounterID:3470;Difficulty:Mythic;Name:Twin Fangs\\nSoaks\\nLeft: Abu, Cheo")
  local raw0 = Notes:Get(id).raw
  -- a new block named like the typed list, or like another block, is refused with the reason; its own key is fine
  local none, why = A.Write(3470, "Mythic", "Twin Fangs", "soaks", A.Lines({ name = "Soaks", rows = { A.NewRow(1) } }, nil))
  assert(none == nil and why == "The note already has an assignment or a group list named soaks. Pick another name.", tostring(why))
  assert(Notes:Get(id).raw == raw0, "nothing written")
  assert(A.Write(3470, "Mythic", "Twin Fangs", "a", A.Lines({ name = "A", rows = { A.NewRow(1) } }, nil)) == id, "a free name")
  none, why = A.Write(3470, "Mythic", "Twin Fangs", "a", A.Lines({ name = "A", rows = { A.NewRow(1) } }, nil))
  assert(none == nil and why, "a second block A refused")
  assert(A.Write(3470, "Mythic", "Twin Fangs", "a", A.Lines({ name = "A", rows = { A.NewRow(1), A.NewRow(2) } }, nil), "a") == id, "A itself writes again")
  -- two abilities with the same name: each its own key
  local text = Notes:Get(id).raw
  local first = A.FreeName(text, "Twin Bite")
  text = A.Replace(text, A.Key(first), A.Lines({ name = first, rows = { A.NewRow(1) } }, nil, { mech = "111" }))
  local second = A.FreeName(text, "Twin Bite")
  assert(first == "Twin Bite" and second == "Twin Bite 2", second)
  text = A.Replace(text, A.Key(second), A.Lines({ name = second, rows = { A.NewRow(1) } }, nil, { mech = "222" }))
  assert(table.concat(A.BlocksFor(text, "111"), ",") == "twin bite" and table.concat(A.BlocksFor(text, "222"), ",") == "twin bite 2", "each its own")
  -- LinkAll links a saved text's blocks; nothing is saved before
  reset()
  local blockText = "EncounterID:3470;Difficulty:Mythic;Name:Twin Fangs\\n" .. joined(A.Lines(feast(), CASTS))
  assert(#Links.Saved(9) == 0, "nothing saved")
  assert(A.LinkAll(9, blockText) == 10 and #Links.Saved(9) == 3, "linked on save: " .. #Links.Saved(9))
end)

check("assign: what making a typed list a block changes", function()
  local pasted = table.concat({ "Orbs", "Odd: Solex, Rixxy", "Even: Abu, Cheo",
    "time:30;ph:1;tag:Solex Rixxy;text:Orbs;colors:1 0 0 1;", "time:90;ph:1;tag:Abu Cheo;text:Orbs;",
    "time:150;ph:1;tag:Solex Rixxy;text:Orbs now;", "time:999;ph:1;tag:Abu Cheo;text:Late;" }, "\\n")
  local casts = { { ph = 1, t = 30 }, { ph = 1, t = 90 }, { ph = 1, t = 150 } }
  local c = A.AdoptChanges(pasted, 1, casts)
  assert(c.lines == 3 and c.off == 1 and c.dropped == 1 and table.concat(c.texts, ",") == "Odd", "3 lines, 1 off, 1 loses its colours, Odd's texts become one")
end)

check("no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)
if failed > 0 then error(failed .. " failed") end
`;
const W = process.argv[2];
if (!W) { console.error('usage: node run_assign.js <addon folder>'); process.exit(2); }
const names = ['CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/EditModel.lua',
  'CRT_Modules/Notes/Links.lua', 'CRT_Modules/Notes/MechNote.lua', 'CRT_Modules/Notes/Assign.lua'];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, names.length * 2 + 2);
for (const n of names) { lua.lua_pushstring(L, to_luastring(n)); lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, n), 'utf8'))); }
if (lua.lua_pcall(L, names.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
