// Timer lines that follow an assignment line: the real CRT_Modules/Notes/Parse.lua, Data.lua, EditModel.lua and
// Links.lua, on a raid lead's note (three group rows and 18 timer lines listing the same players, one row's lines
// with an extra player). Rows, timer lines and their match (exact links, near-misses), Link saving links by note,
// the one obvious fix, a row change rewriting only the names of the lines that follow it, implicit links with no
// saved data, a hand-edited line that stops following, the note format unchanged, Not now, and a deleted note.
// Usage: node run_notes_links.js <Parse.lua> <Data.lua> <EditModel.lua> <Links.lua> <CRT_Core/MarkerText.lua>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local parseSrc, dataSrc, modelSrc, linksSrc, markerSrc = ...
local function stub() return setmetatable({}, { __index = function() return function() end end }) end
function CreateFrame() return stub() end
function issecretvalue(v) return type(v) == "string" and v:find("^SECRET") ~= nil end
function UnitName() return "Solex" end
C_Timer = { After = function() end }
date, time, format = os.date, os.time, string.format
local CRT = { db = { notes = { list = {}, nextId = 1, history = {} } } }
CRT.Bosses = { OnRouteChange = function() end, RouteIndex = function() end }
assert(load(markerSrc, "MarkerText.lua"))("CowfeeRaidTools", CRT)
assert(load(parseSrc, "Parse.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "Data.lua"))("CowfeeRaidTools", CRT)
assert(load(modelSrc, "EditModel.lua"))("CowfeeRaidTools", CRT)
assert(load(linksSrc, "Links.lua"))("CowfeeRaidTools", CRT)
local Links, Model, Parser, Notes = CRT.NoteLinks, CRT.NoteEditModel, CRT.NoteParser, CRT.Notes
assert(Links and Links.Rows and Links.Lines and Links.Match and Links.Rewrite, "CRT.NoteLinks with Rows, Lines, Match and Rewrite")

local passed, failed = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then passed = passed + 1 print("ok " .. name) else failed = failed + 1 print("FAIL " .. name .. ": " .. tostring(err)) end
end

-- The note: an assignment block of three rows, then the timer lines, Left at each time, Right 2 s later and
-- Center 4 s later with Notkvr, who isn't in the Center row.
local LEFT = { "Solex", "Rixxy", "Xuelan", "Crazyoio", "Sixz", "Gadios" }
local RIGHT = { "Dotsanhots", "Sarrantha", "Durayn", "Abu", "Granddh", "Dyspepsia" }
local CENTER = { "Cheoeqar", "Thisisfartaa", "Skarghan", "Balevolence", "Lichkingstoy", "Djaztech" }
local TIMES = { 61, 122, 216, 277, 371, 432 }
local lines = {
  "EncounterID:9999;Difficulty:Mythic;Name:Test boss",
  "Ravenous Feast and Tainted Blood Groups",
  "Left: " .. table.concat(LEFT, ", "),
  "Right: " .. table.concat(RIGHT, ", "),
  "Center: " .. table.concat(CENTER, ", "),
  "",
}
for _, t in ipairs(TIMES) do
  lines[#lines + 1] = "time:" .. t .. ";ph:1;tag:" .. table.concat(LEFT, " ") .. ";text:Soak First, Knock Left;colors:0 1 0 1;DisplayType:Text;"
  lines[#lines + 1] = "time:" .. (t + 2) .. ";ph:1;tag:" .. table.concat(RIGHT, " ") .. ";text:Soak Second, Knock Right;DisplayType:Text;"
  lines[#lines + 1] = "time:" .. (t + 4) .. ";ph:1;tag:Notkvr " .. table.concat(CENTER, " ") .. ";text:Soak Third, Knock Center;DisplayType:Text;"
end
local NOTE = table.concat(lines, "\r\n")
local ROW = { Left = 3, Right = 4, Center = 5 }

local function count(t) local n = 0 for _ in pairs(t) do n = n + 1 end return n end
local function match(s, key) return Links.Match(Links.Rows(s), Links.Lines(s), Links.Saved(key)) end
local function split(text) local out = {} for l in (text .. "\n"):gmatch("(.-)\r?\n") do out[#out + 1] = l end return out end
local function tagOf(line) return Parser.Field(line, "tag") end
local function withoutTag(line) return (line:gsub("[Tt][Aa][Gg]:[^;]*;", "")) end
-- the timer lines whose text has knock (Left, Right or Center)
local function linesOf(text, which)
  local out = {}
  for n, l in ipairs(split(text)) do if l:find("Knock " .. which, 1, true) then out[#out + 1] = { n = n, line = l } end end
  return out
end
-- every timer the same but its names: the format is unchanged
local function sameButNames(a, b)
  local pa, pb = Parser.Parse(a), Parser.Parse(b)
  assert(#pa.timers == #pb.timers, "same number of timers")
  for k, t in ipairs(pa.timers) do
    local u = pb.timers[k]
    for _, f in ipairs({ "time", "ph", "text", "kind", "spellId", "dur", "line" }) do
      assert(t[f] == u[f], "timer " .. k .. " keeps its " .. f)
    end
    assert((t.color == nil) == (u.color == nil), "timer " .. k .. " keeps its colour")
  end
  assert(table.concat(pa.lines, "\n") ~= nil and pa.encounterID == pb.encounterID, "the header kept")
end

check("rows: one block of three rows, its label and names", function()
  local rows = Links.Rows(NOTE)
  assert(#rows == 3, "three rows, got " .. #rows)
  for k, label in ipairs({ "Left", "Right", "Center" }) do
    assert(rows[k].label == label and rows[k].block == "Ravenous Feast and Tainted Blood Groups", "row " .. k .. ": " .. tostring(rows[k].label) .. " / " .. tostring(rows[k].block))
    assert(rows[k].index == ROW[label] and #rows[k].names == 6, "row " .. label .. " at its line with 6 names")
  end
end)

check("lines: the 18 timer lines with their names; their keys survive a name change", function()
  local ls = Links.Lines(NOTE)
  assert(#ls == 18, "18 lines, got " .. #ls)
  assert(#ls[3].names == 7 and ls[3].names[1] == "Notkvr", "a Center line lists Notkvr first")
  local other = NOTE:gsub("tag:Solex Rixxy", "tag:Abu Rixxy")
  local ls2 = Links.Lines(other)
  for k = 1, 18 do assert(ls[k].sig == ls2[k].sig, "line " .. k .. " keeps its key") end
  local seen = {}
  for _, l in ipairs(ls) do assert(not seen[l.sig], "every key is its own") seen[l.sig] = true end
end)

check("match: 12 exact (6 Left, 6 Right), 6 near-misses on Center naming Notkvr", function()
  local m = match(Model.New(NOTE), "none")
  assert(#m.exact == 12, "12 exact, got " .. #m.exact)
  assert(#m.near == 6, "6 near, got " .. #m.near)
  for _, n in ipairs(m.near) do
    assert(n.row.label == "Center" and #n.extra == 1 and n.extra[1] == "Notkvr" and #n.missing == 0, "near Center with Notkvr extra")
  end
  assert(#(m.byRow[ROW.Left] or {}) == 6 and #(m.byRow[ROW.Right] or {}) == 6 and m.byRow[ROW.Center] == nil, "6 follow Left, 6 Right, none Center")
  local sum = Links.Summary(m)
  assert(sum.total == 18 and sum.exactCount == 12 and sum.nearCount == 6, "the totals")
  assert(#sum.exact == 2 and sum.exact[1].row.label == "Left" and #sum.exact[1].lines == 6 and sum.exact[2].row.label == "Right", "exact by row")
  assert(#sum.near == 1 and #sum.near[1].lines == 6, "near grouped")
  assert(sum.fix and sum.fix.row.label == "Center" and #sum.fix.add == 1 and sum.fix.add[1] == "Notkvr", "the one obvious fix: add Notkvr to Center")
end)

check("names compare case-insensitively and without the realm", function()
  local text = "Soak: Solex, Rixxy-Sargeras\ntime:5;tag:solex-Draenor RIXXY;text:x;\nKick: Abu\ntime:6;tag:Abu;text:y;"
  local m = match(Model.New(text), "none")
  assert(m.exact[1].row.label == "Soak" and m.follow[2] and m.follow[2].row.label == "Soak", "the realm and case don't matter")
  assert(#m.near == 0, "no near-miss")
end)

-- #1288: a row of one name links its player's lines by the same player and wording (Alex, 2026-11-15)
local ONE = table.concat({
  "Orb Carriers",                                                -- 1
  "{cross} purple orb: Whitecrows",                              -- 2
  "{square} purple orb: Sixz",                                   -- 3
  "side green orb: Dotsanhots",                                  -- 4
  "",                                                            -- 5
  "CC Mindcontrol",                                              -- 6
  "1st CC on Mindcontrol: Balevolence",                          -- 7
  "3rd CC on Mindcontrol: Dotsanhots",                           -- 8
  "4th CC on Mindcontrol: Lulu",                                 -- 9
  "",                                                            -- 10
  "Soak Ghosts",                                                 -- 11
  "Soak Ghost at {square}: Lulu",                                -- 12
  "Soak Ghost at {cross}: Cheoeqar",                             -- 13
  "time:7;ph:3;tag:Whitecrows;text:Grab {cross} purple orb;dur:12;", -- 14 wording: the label inside the text
  "time:7;ph:3;tag:Sixz;text:Grab {square} purple orb;",          -- 15
  "time:7;ph:3;tag:Dotsanhots;text:Grab side green orb;",         -- 16 Dotsanhots on two rows: the wording settles it
  "time:9;ph:2;tag:Balevolence;text:CC Mindcontrol;",             -- 17 the text's words in the label
  "time:9;ph:2;tag:Lulu;text:CC Mindcontrol;",                    -- 18 Lulu on two rows: the wording settles it
  "time:5;ph:2.5;tag:Lulu;text:Soak Ghost at {square};",          -- 19 the same text
  "time:9;ph:2;tag:Dotsanhots;text:CC Mindcontrol;",              -- 20
  "time:7;ph:1;tag:Sixz;text:Grab {cross} purple orb;",           -- 21 another row's wording ({cross}: Whitecrows): never Sixz's row
  "time:7;ph:1;tag:Lulu;text:Grab side green orb;",               -- 22 Lulu on two rows, neither's wording: left alone
  "time:3;ph:1;tag:Cheoeqar;spellid:200183;",                     -- 23 a cooldown: no wording, never linked
  "time:30;ph:1;tag:Whitecrows;text:Use a healthstone;",          -- 24 Whitecrows on one row only, but no word of its label: unlinked
  "time:30;ph:1;tag:Cheoeqar;spellid:64843;text:Hymn;",           -- 25 a spell line with a text of its own: never by the one row rule
  "time:40;ph:1;tag:Nobody;text:Grab {square} purple orb;",       -- 26 a player on no row
  "time:50;ph:1;tag:Whitecrows;text:Watch the purple add;",       -- 27 his only row, a word of its label (purple): follows it
}, "\n")

check("one name: a line follows its player's row by the wording, else his only row (#1288)", function()
  local s = Model.New(ONE)
  local m = match(s, "none")
  local function row(i) return m.follow[i] and m.follow[i].row.label end
  assert(row(14) == "{cross} purple orb" and row(15) == "{square} purple orb", "the label inside the text: " .. tostring(row(14)) .. " / " .. tostring(row(15)))
  assert(row(16) == "side green orb" and row(20) == "3rd CC on Mindcontrol", "Dotsanhots by the wording: " .. tostring(row(16)) .. " / " .. tostring(row(20)))
  assert(row(17) == "1st CC on Mindcontrol", "the text's words in the label: " .. tostring(row(17)))
  assert(row(18) == "4th CC on Mindcontrol" and row(19) == "Soak Ghost at {square}", "Lulu by the wording: " .. tostring(row(18)) .. " / " .. tostring(row(19)))
  assert(row(24) == nil, "his only row, no word of its label: unlinked (Alex, 2026-11-15): " .. tostring(row(24)))
  assert(row(27) == "{cross} purple orb", "his only row, sharing a word: " .. tostring(row(27)))
  assert(Links.Fits("Stack at 10%", "1") == nil and Links.Fits("Soak at 1.", "1") == "strong", "a label fits on word bounds only")
  assert(Links.Fits("Grab the orb, now", "the orb") == "strong", "a word's comma left out")
  -- never a row of another player; ambiguous or another row's callout: unlinked
  assert(row(21) == nil, "Sixz's line with Whitecrows's wording follows nothing: " .. tostring(row(21)))
  assert(row(22) == nil, "Lulu on two rows, neither's wording: ambiguous, unlinked: " .. tostring(row(22)))
  assert(row(23) == nil and row(25) == nil, "spell lines never by the one row rule")
  assert(row(26) == nil, "a player on no row")
  for i, f in pairs(m.follow) do
    local names = s:TimerNames(i)
    assert(#f.row.names == 1 and names[1]:lower() == f.row.names[1]:lower(), "line " .. i .. " follows a row of its own player")
  end
  assert(#m.near == 0, "one name is never a near-miss")
  -- the banner: every new link asks once, grouped by row
  local sum = Links.Summary(m)
  assert(sum.exactCount == 8 and sum.nearCount == 0 and sum.fix == nil, "eight lines to link: " .. sum.exactCount)
end)

check("one name: a row's names change and its one-name lines follow; saved links still win (#1288)", function()
  local s = Model.New(ONE)
  local snap = Links.Snapshot(s, nil)
  assert(s:Remove(2, 1) and s:Add(2, "Abu"), "Whitecrows swapped for Abu")
  assert(Links.Apply(s, snap) == 2, "both of Whitecrows's lines rewritten")
  local out = split(s:Text())
  assert(tagOf(out[14]) == "Abu" and tagOf(out[27]) == "Abu" and tagOf(out[24]) == "Whitecrows" and tagOf(out[21]) == "Sixz", "only the lines that followed: " .. out[14] .. " / " .. out[21])
  -- a saved link wins over the wording: line 17 saved on the Lulu CC row is a near-miss there, not Balevolence's
  CRT.db.notes.links = nil
  local t = Model.New(ONE)
  local lines = Links.Lines(t)
  local sig
  for _, l in ipairs(lines) do if l.index == 17 then sig = l.sig end end
  CRT.db.notes.links = { one = { links = { { block = "CC Mindcontrol", row = "4th CC on Mindcontrol", sigs = { sig } } } } }
  local m = match(t, "one")
  assert(m.follow[17] == nil and m.near[1] and m.near[1].line.index == 17 and m.near[1].saved, "the saved link names the row")
  CRT.db.notes.links = nil
end)

check("two rows of the same players: every line follows the first, as before #1288 (Alex, 2026-11-15)", function()
  local text = table.concat({ "Guillotine Soaks", "P1 Soak 1: Sixz Lichkingstoy Rixxy", "P1 Soak 2: Abu Cheo", "P3 Soak 2: Sixz Lichkingstoy Rixxy",
    "time:48;ph:1;tag:Sixz Lichkingstoy Rixxy;text:Soak;", "time:133;ph:1;tag:Abu Cheo;text:Soak;", "time:86;ph:3;tag:Rixxy Sixz Lichkingstoy;text:Soak;" }, "\n")
  local m = match(Model.New(text), "none")
  assert(m.follow[5].row.label == "P1 Soak 1" and m.follow[7].row.label == "P1 Soak 1" and m.follow[6].row.label == "P1 Soak 2", "the first row")
end)

check("a block's rows are the lines right under its heading; a row after a blank line is a typed row (#1288)", function()
  local text = table.concat({ "assign:orbs;name:Orbs;", "{cross} orb: Abu", "{square} orb: Cheo", "", "Kicks: Abu", "Text line", "Soaks: Kip" }, "\n")
  local rows = Links.Rows(Model.New(text))
  assert(#rows == 4, "four rows: " .. #rows)
  assert(rows[1].assign == "orbs" and rows[2].assign == "orbs", "the block's two rows")
  assert(rows[3].label == "Kicks" and rows[3].assign == nil, "after the blank line: a typed row")
  assert(rows[4].label == "Soaks" and rows[4].assign == nil, "after a text line too")
  -- so its one-name line follows it, though the block names Abu too
  local m = match(Model.New(text .. "\ntime:30;ph:1;tag:Abu;text:Kicks;"), "none")
  assert(m.follow[8] and m.follow[8].row.label == "Kicks", "Abu's Kicks line follows the typed row")
end)

check("one name: a block's rows never take a typed line, the kick block is no row (#1288)", function()
  local text = table.concat({
    "assign:orbs;name:Orbs;times:1@7;",                                   -- 1
    "{cross} purple orb: Sixz",                                           -- 2
    "time:7;ph:1;tag:Sixz;text:{cross} purple orb;assign:orbs/1/1;",       -- 3 the block's own line
    "time:7;ph:1;tag:Sixz;text:Grab {cross} purple orb;",                  -- 4 an old line the block replaced
    "intstart", "Sixz", "intend",                                          -- 5-7
    "Spare: Sixz",                                                        -- 8
  }, "\n")
  local s = Model.New(text)
  local m = match(s, "none")
  assert(m.follow[3] == nil and m.follow[4] == nil, "the block's wording: neither follows the spare row")
  local rows = Links.Rows(s)
  assert(rows[1].assign == "orbs" and rows[2].assign == nil and #rows == 2, "a row knows its block's key")
end)

check("Link saves links by note: the 12 exact lines then follow from saved data", function()
  CRT.db.notes.links = nil -- old saved data, before links
  local s = Model.New(NOTE)
  local m = match(s, 1)
  local idx = {}
  for _, e in ipairs(m.exact) do idx[#idx + 1] = e.line.index end
  assert(Links.Link(1, s, idx) == 12, "12 linked")
  local saved = Links.Saved(1)
  assert(#saved == 2, "two links, got " .. #saved)
  assert(saved[1].block == "Ravenous Feast and Tainted Blood Groups" and saved[1].row == "Left" and #saved[1].sigs == 6, "the Left link: block, row and its 6 lines")
  assert(saved[2].row == "Right" and #saved[2].sigs == 6, "the Right link")
  m = match(s, 1)
  assert(#m.exact == 0 and #m.near == 6 and count(m.follow) == 12, "no longer asked; 12 follow, 6 still near")
  for _, f in pairs(m.follow) do assert(f.saved, "followed from saved data") end
  assert(Links.Link(1, s, idx) == 12 and #Links.Saved(1) == 2 and #Links.Saved(1)[1].sigs == 6, "linking again adds nothing twice")
  assert(s:Text() == NOTE, "linking leaves the note text alone")
end)

check("the fix adds Notkvr to Center and links all 18; moving Skarghan rewrites Center and Left lines", function()
  local s = Model.New(NOTE)
  local sum = Links.Summary(match(s, 1))
  local snap = Links.Snapshot(s, Links.Saved(1))
  assert(s:Add(sum.fix.row.index, "Notkvr"), "Notkvr added")
  assert(Links.Apply(s, snap) == 0, "no line followed Center, so none rewritten")
  local all = {}
  for _, l in ipairs(Links.Lines(s)) do all[#all + 1] = l.index end
  assert(Links.Link(1, s, all) == 18, "all 18 linked")
  assert(#Links.Saved(1) == 3 and Links.Saved(1)[3].row == "Center", "three links")
  local m = match(s, 1)
  assert(count(m.follow) == 18 and #m.near == 0 and #m.exact == 0, "18 follow, nothing to ask")
  assert(s:Names(ROW.Center)[7] == "Notkvr", "Notkvr at the end of Center")
  local afterFix = s:Text()
  assert(split(afterFix)[ROW.Center] == "Center: " .. table.concat(CENTER, ", ") .. ", Notkvr", "only the Center row changed")
  -- move Skarghan (Center's 3rd) to Left
  snap = Links.Snapshot(s, Links.Saved(1))
  assert(s:Move(ROW.Center, 3, ROW.Left), "Skarghan moved")
  assert(Links.Apply(s, snap) == 12, "12 lines rewritten")
  local text = s:Text()
  for _, l in ipairs(linesOf(text, "Left")) do
    assert(tagOf(l.line) == table.concat(LEFT, " ") .. " Skarghan", "a Left line lists Skarghan, in the row's order: " .. l.line)
  end
  for _, l in ipairs(linesOf(text, "Center")) do
    assert(tagOf(l.line) == "Cheoeqar Thisisfartaa Balevolence Lichkingstoy Djaztech Notkvr", "a Center line without Skarghan: " .. l.line)
  end
  for _, l in ipairs(linesOf(text, "Right")) do assert(tagOf(l.line) == table.concat(RIGHT, " "), "Right untouched") end
  local before, after = split(NOTE), split(text)
  for n = 1, #before do
    if before[n]:find("^time:") then
      assert(withoutTag(before[n]) == withoutTag(after[n]), "line " .. n .. ": only the names changed")
    end
  end
  sameButNames(NOTE, text)
  assert(select(2, text:gsub("\r\n", "")) == select(2, NOTE:gsub("\r\n", "")), "line ends kept")
  assert(count(match(s, 1).follow) == 18, "all 18 still follow")
  -- and back: the lines are written as they were
  snap = Links.Snapshot(s, Links.Saved(1))
  assert(s:Move(ROW.Left, 7, ROW.Center), "moved back to the end of Center")
  Links.Apply(s, snap)
  for _, l in ipairs(linesOf(s:Text(), "Left")) do assert(tagOf(l.line) == table.concat(LEFT, " "), "Left back as it was") end
end)

check("implicit links: no saved data, a row change still rewrites the lines that list its players", function()
  local s = Model.New(NOTE)
  assert(#Links.Saved("other") == 0, "nothing saved for this note")
  local snap = Links.Snapshot(s, Links.Saved("other"))
  assert(s:Move(ROW.Left, 1, ROW.Right), "Solex moved to Right")
  assert(Links.Apply(s, snap) == 12, "Left and Right lines rewritten")
  local text = s:Text()
  for _, l in ipairs(linesOf(text, "Left")) do assert(tagOf(l.line) == "Rixxy Xuelan Crazyoio Sixz Gadios", l.line) end
  for _, l in ipairs(linesOf(text, "Right")) do assert(tagOf(l.line) == table.concat(RIGHT, " ") .. " Solex", l.line) end
  for _, l in ipairs(linesOf(text, "Center")) do assert(tagOf(l.line) == "Notkvr " .. table.concat(CENTER, " "), "Center lines don't follow: untouched") end
  -- a remove and an add
  snap = Links.Snapshot(s, nil)
  assert(s:Remove(ROW.Right, 1))
  Links.Apply(s, snap)
  for _, l in ipairs(linesOf(s:Text(), "Right")) do assert(tagOf(l.line) == "Sarrantha Durayn Abu Granddh Dyspepsia Solex", l.line) end
  -- a row emptied: its lines keep their names
  local t = Model.New("Pair: Abu, Cheo\ntime:5;tag:Abu Cheo;text:x;")
  snap = Links.Snapshot(t, nil)
  assert(t:Remove(1, 1) and t:Remove(1, 1))
  Links.Apply(t, snap)
  assert(tagOf(split(t:Text())[2]) == "Abu Cheo", "an emptied row leaves its lines' names")
end)

check("a line edited by hand stops following and shows as a near-miss", function()
  local edited = NOTE:gsub("(time:122;ph:1;tag:Solex Rixxy Xuelan Crazyoio Sixz) Gadios", "%1")
  assert(edited ~= NOTE, "the fixture edit happened")
  local s = Model.New(edited)
  local m = match(s, 1)
  local lineNo
  for n, l in ipairs(split(edited)) do if l:find("^time:122;") then lineNo = n end end
  assert(m.follow[lineNo] == nil, "it doesn't follow Left")
  local found
  for _, n in ipairs(m.near) do if n.line.index == lineNo then found = n end end
  assert(found and found.row.label == "Left" and found.saved and found.missing[1] == "Gadios" and #found.extra == 0, "a near-miss on its saved row, leaving out Gadios")
  local snap = Links.Snapshot(s, Links.Saved(1))
  assert(s:Remove(ROW.Left, 2), "Rixxy taken off Left")
  Links.Apply(s, snap)
  assert(tagOf(split(s:Text())[lineNo]) == "Solex Rixxy Xuelan Crazyoio Sixz", "the edited line isn't rewritten")
  assert(Links.Summary(m).fix == nil, "two kinds of near-misses: no single fix")
end)

check("rewrite: only the tag's value changes, every other byte as written", function()
  assert(Parser.ReplaceField("  Time:34; ph:1 ;Tag: Cheoeqar  Abu-Sargeras ;spellid:64843;Custom:keep me;  ", "tag", "Abu Cheo")
    == "  Time:34; ph:1 ;Tag: Abu Cheo ;spellid:64843;Custom:keep me;  ", "the spaces around the value and the other fields kept")
  assert(Parser.ReplaceField("time:1;tag:A", "tag", "B C") == "time:1;tag:B C", "a last field with no ;")
  assert(Parser.ReplaceField("time:1;text:tag:A;", "tag", "B") == nil, "tag inside another field's text isn't a tag")
  local text = Links.Rewrite(NOTE, { 7, 10 }, { "Abu", "Cheo" })
  local a, b = split(NOTE), split(text)
  assert(tagOf(b[7]) == "Abu Cheo" and tagOf(b[10]) == "Abu Cheo", "both lines rewritten")
  for n = 1, #a do if n ~= 7 and n ~= 10 then assert(a[n] == b[n], "line " .. n .. " untouched") end end
  assert(select(2, text:gsub("\r\n", "")) == select(2, NOTE:gsub("\r\n", "")), "CRLF kept")
  -- a name that can't go in a tag is never written
  local s = Model.New("Pair: Abu, Cheo\ntime:5;tag:Abu Cheo;text:x;")
  local snap = Links.Snapshot(s, nil)
  s.rows[1].field.items[2].word = "Ch;eo" -- as if the line held it
  Links.Apply(s, snap)
  assert(split(s:Text())[2] == "time:5;tag:Abu Cheo;text:x;", "no ; written into a tag")
end)

check("no edit: the note comes back byte for byte", function()
  local s = Model.New(NOTE)
  local snap = Links.Snapshot(s, Links.Saved(1))
  Links.Apply(s, snap)
  assert(s:Text() == NOTE and not s:Dirty(), "unchanged")
  -- names written back to what they were: the line as it was
  assert(s:SetTimerNames(7, { "Abu" }) and s:Dirty())
  assert(s:SetTimerNames(7, LEFT) and s:Text() == NOTE and not s:Dirty(), "the line as written again")
  assert(not Model.New(NOTE, { readOnly = true }):SetTimerNames(7, { "Abu" }), "read-only: no rewrite")
end)

check("Not now hides the banner for this note until its text changes", function()
  assert(not Links.Dismissed(1, NOTE), "not dismissed yet")
  Links.Dismiss(1, NOTE)
  assert(Links.Dismissed(1, NOTE), "dismissed for this text")
  assert(not Links.Dismissed(1, NOTE .. "x"), "shown again once the text changes")
  assert(not Links.Dismissed(2, NOTE), "only for this note")
end)

check("a deleted note's links go with it", function()
  local id = 5
  CRT.db.notes.list[id] = { raw = NOTE, name = "Test boss" }
  local s = Model.New(NOTE)
  Links.Link(id, s, { 7 })
  assert(#Links.Saved(id) == 1, "saved")
  Notes:Delete(id)
  assert(#Links.Saved(id) == 0 and CRT.db.notes.links[id] == nil, "gone with the note")
end)

print(passed .. " passed, " .. failed .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2, 7);
for (const f of files) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch (e) { console.error('cannot read ' + f); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
