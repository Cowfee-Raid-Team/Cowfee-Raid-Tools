// The kick block in a note, shown to read (CRT_Modules/Interrupts/NoteBlock.lua's View and Expand, used by Notes/Render.lua
// and Notes/EditModel.lua): "Kick order" heading, then one "<label>: <names>" line per group, labels from the kick setup
// for the note's boss and difficulty (their raid marker icon before them), "Group N" with no setup or past the groups, the
// names in class colours, the marker lines not shown, and the note's raw text never changed.
// Usage: node run_kick_view.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const dir = process.argv[2];
const FILES = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Comm.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Interrupts/Lattice.lua',
  'CRT_Modules/Interrupts/Setup.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/NoteBlock.lua',
  'CRT_Modules/Notes/Render.lua', 'CRT_Modules/Notes/EditModel.lua', 'CRT_Modules/Notes/Links.lua', 'CRT_Modules/Notes/MechNote.lua',
  'CRT_Modules/Notes/Assign.lua'];
const harness = themeLua([path.join(dir, 'CRT_Core/Themes.lua')]) + `
local sources = { ... }
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
date = function() return "2026-10-29 12:00" end
GetTime = function() return 1000 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
issecretvalue = function() return false end
InCombatLockdown = function() return false end
C_InstanceEncounter = { IsEncounterInProgress = function() return false end }
C_Timer = { After = function() end }
CreateFrame = function() local f = {} function f:RegisterEvent() end function f:UnregisterEvent() end function f:SetScript() end return f end
UnitName = function(u) if u == "player" then return "Solex" end end
IsInRaid = function() return false end
IsInGroup = function() return false end
C_Spell = { GetSpellInfo = function() return nil end }
RAID_CLASS_COLORS = { MAGE = { colorStr = "ff3fc7eb" }, PRIEST = { colorStr = "ffffffff" }, ROGUE = { colorStr = "fffff468" } }

local CRT = { UI = {}, db = { classCache = {}, notes = { list = {}, nextId = 1 }, interrupts = { enabled = true, own = {}, shared = {}, use = {}, accept = true, test = false, plates = {}, reminder = {} } } }
CRT_THEME(CRT, CRT.UI)
for i = 1, #sources, 2 do assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT) end
local I, B, R, M = CRT.Interrupts, CRT.InterruptNote, CRT.NoteRender, CRT.NoteEditModel
check(B and B.View and B.Expand, "the shared helper is made")
CRT.Bosses:Get(3470).interrupts = {
  { difficulty = 16, groups = { { key = "skull", label = "Skull add", marker = 8, slots = 4 }, { key = "cross", label = "Cross add", marker = 7, slots = 4 } } },
  { difficulty = 15, groups = { { key = "l", label = "Left", marker = 1, slots = 5 }, { key = "r", label = "Right", marker = 2, slots = 5 } } },
}
I:ClearCache()
local classOf = function(n) return ({ Xuelan = "MAGE", Durayn = "PRIEST", Sarrantha = "ROGUE" })[n] end
local function head(diff) return "EncounterID:3470;Difficulty:" .. diff .. "\\n" end
local BLOCK = "intstart\\nXuelan Sixz\\nDurayn Sarrantha\\nintend\\n"

-- the helper: view and expand
local items = B.View(head("Heroic") .. BLOCK)
eq(items[2].kind, "heading", "view: intstart is the heading")
eq(items[2].text, "Kick order", "view: its text")
eq(items[3].label, "Left", "view: a line takes its group's label")
eq(table.concat(items[3].names, " "), "Xuelan Sixz", "view: its names")
eq(items[5].kind, "hidden", "view: intend is not shown")
eq(items[3].marker, 1, "view: its raid marker")
local mythic = B.View(head("Mythic") .. BLOCK)
eq(mythic[3].label, "Skull add", "view: the Mythic setup's first label")
eq(mythic[3].marker, 8, "view: its raid marker")
eq(mythic[4].label, "Cross add", "view: the second label")
eq(B.Expand(head("Heroic") .. BLOCK), head("Heroic") .. "Kick order\\n{rt1} Left: Xuelan Sixz\\n{rt2} Right: Durayn Sarrantha\\n", "expand: heading and label lines, no marker lines")
eq(B.Expand(head("Mythic") .. BLOCK), head("Mythic") .. "Kick order\\n{rt8} Skull add: Xuelan Sixz\\n{rt7} Cross add: Durayn Sarrantha\\n", "expand: the marker as a token")
eq(B.Expand("EncounterID:3470;Difficulty:Normal\\n" .. BLOCK), "EncounterID:3470;Difficulty:Normal\\nKick order\\nGroup 1: Xuelan Sixz\\nGroup 2: Durayn Sarrantha\\n", "expand: no setup gives Group N")
eq(B.Expand(head("Heroic") .. "intstart\\nA\\n\\nC\\nintend\\n"), head("Heroic") .. "Kick order\\n{rt1} Left: A\\n{rt2} Right:\\nGroup 3: C\\n", "expand: an empty group keeps its place, past the groups is Group N")
eq(B.Expand("Melee: a\\nintstart\\nA\\n"), "Melee: a\\nintstart\\nA\\n", "expand: a start with no end is no block")
eq(B.Expand("Melee: a\\n"), "Melee: a\\n", "expand: no block, same text")
local rawIn = head("Heroic") .. BLOCK
B.Expand(rawIn)
eq(rawIn, head("Heroic") .. "intstart\\nXuelan Sixz\\nDurayn Sarrantha\\nintend\\n", "the raw text is unchanged")
-- the bug of #1212: a Twin Fangs Mythic note read "Group 1 / Group 2" while the Interrupts tracker was switched off
-- (Alex's saved data: interrupts.enabled = false, the note's header "EncounterID:3421;Difficulty:Mythic"). The setup is
-- the boss's data, there with the tracker off too, so it still names the groups.
I:SetEnabled(false)
eq(B.Expand(head("Heroic") .. BLOCK), head("Heroic") .. "Kick order\\n{rt1} Left: Xuelan Sixz\\n{rt2} Right: Durayn Sarrantha\\n", "expand: the setup's labels with the tracker off")
eq(B.View(head("Mythic") .. BLOCK)[3].label, "Skull add", "view: the Mythic label with the tracker off")
I:SetEnabled(true)
-- a text with no header: the note record's boss and difficulty, when given, name the groups
eq(B.View(BLOCK, { encounterID = 3470, difficulty = "Heroic" })[2].label, "Left", "view: the record's boss for a text with no header")
eq(B.View(BLOCK)[2].label, "Group 1", "view: no header and no record, Group N")
eq(B.View("EncounterID:3470;Difficulty:Mythic\\n" .. BLOCK, { encounterID = 3470, difficulty = "Heroic" })[3].label, "Skull add", "view: the header wins over the record")
eq(B.Expand("Name:Free\\n" .. BLOCK), "Name:Free\\nKick order\\nGroup 1: Xuelan Sixz\\nGroup 2: Durayn Sarrantha\\n", "expand: a note with no boss and difficulty, Group N")

-- the rendered note view
local rows = R.Rows(head("Heroic") .. BLOCK, { classOf = classOf })
local out = {}
for _, r in ipairs(rows) do out[#out + 1] = r.kind .. ":" .. (r.text or r.label or "") end
local text = table.concat(out, "|")
check(not text:find("intstart", 1, true) and not text:find("intend", 1, true), "render: no marker lines: " .. text)
check(text:find("heading:Kick order|label:Left|label:Right", 1, true), "render: heading then the labels: " .. text)
local left
for _, r in ipairs(rows) do if r.label == "Left" then left = r end end
eq(left and left.parts[1].class, "MAGE", "render: a name in its class colour")
eq(left and R.Markup(left):find("|cff3fc7ebXuelan|r", 1, true) ~= nil, true, "render: the colour code")
local mrows = R.Rows(head("Mythic") .. BLOCK, { classOf = classOf })
local skull
for _, r in ipairs(mrows) do if r.label == "Skull add" then skull = r end end
eq(skull and skull.marker, 8, "render: the marker on its label row")
local brows = R.Rows(BLOCK, { classOf = classOf, boss = { encounterID = 3470, difficulty = "Heroic" } })
local blabels = {}
for _, r in ipairs(brows) do if r.kind == "label" then blabels[#blabels + 1] = r.label end end
eq(table.concat(blabels, ","), "Left,Right", "render: the record's boss names the groups of a text with no header")
local n0 = R.Rows("Melee: Xuelan\\nSpread out\\n", { classOf = classOf })
eq(#n0, 2, "render: a note with no block is as before")

-- the note editor's rows (#1212): the block's groups are rows of names, as the assignment lines are
local s = M.New(head("Heroic") .. BLOCK)
eq(s.rows[2].kind, "heading", "editor: intstart row is the heading")
eq(s.rows[2].text, "Kick order", "editor: its text")
check(s.rows[2].kicks, "editor: the heading is the kick block's (its help)")
eq(s.rows[3].kind, "kick", "editor: a block line is a row of names")
eq(s.rows[3].label, "Left", "editor: labelled from the setup")
eq(s.rows[3].marker, 1, "editor: its raid marker")
eq(s.rows[3].cap, 5, "editor: at most the group's slots")
check(s:Editable(3), "editor: it takes names")
eq(table.concat(s:Names(3), " "), "Xuelan Sixz", "editor: its names in kick order")
eq(s.rows[5].kind, "blank", "editor: intend shows nothing")
local sm = M.New(head("Mythic") .. BLOCK)
eq(sm.rows[3].label, "Skull add", "editor: the Mythic label")
eq(sm.rows[3].marker, 8, "editor: the marker")
eq(s:Text(), head("Heroic") .. BLOCK, "editor: the raw text is unchanged")
check(not s:Dirty(), "editor: not dirty as opened")
eq(M.New("Melee: a\\n").rows[1].kind, "label", "editor: other rows as before")

-- the editor's edits: drop from the palette, reorder, move between rows, x, the cap, and the text they write
do
  local raw = head("Heroic") .. "Melee: Abu\\n" .. BLOCK .. "Spread out\\n"
  local e = M.New(raw)
  local L, Rt = 4, 5 -- the Left and Right rows (line 2 is Melee, 3 intstart)
  eq(e.rows[L].label, "Left", "edit: the Left row")
  check(e:Add(L, "Solex", "player"), "edit: a player from the palette")
  eq(table.concat(e:Names(L), " "), "Xuelan Sixz Solex", "edit: on the end")
  check(not e:Add(L, "everyone", "general"), "edit: no tag word: a kick is a player's")
  check(not e:Add(L, "Solex", "player"), "edit: a name once per row")
  check(e:Move(L, 3, L, 1), "edit: reorder within the row")
  eq(table.concat(e:Names(L), " "), "Solex Xuelan Sixz", "edit: Solex first")
  check(e:Move(L, 2, Rt, 1), "edit: move to the Right row, at a place")
  eq(table.concat(e:Names(Rt), " "), "Xuelan Durayn Sarrantha", "edit: Xuelan first on Right")
  eq(table.concat(e:Names(L), " "), "Solex Sixz", "edit: gone from Left")
  check(e:Remove(Rt, 3), "edit: x removes")
  eq(e:Text(), head("Heroic") .. "Melee: Abu\\nintstart\\nSolex Sixz\\nXuelan Durayn\\nintend\\nSpread out\\n", "edit: the block in the new order, the rest as written")
  check(e:Dirty(), "edit: dirty")
  -- the cap: Left takes five
  for _, n in ipairs({ "A", "B", "C" }) do e:Add(L, n, "player") end
  eq(#e:Names(L), 5, "cap: Left is full")
  local ok, why = e:Add(L, "Sixth", "player")
  check(not ok, "cap: a sixth name is refused")
  eq(why, "Left takes 5 names at most.", "cap: and says why")
  e:BeginDrag({ row = Rt, index = 1 })
  local dok, dwhy = e:Drop(L, 1)
  check(not dok and dwhy == "Left takes 5 names at most.", "cap: a drop on a full row is refused, saying why")
  eq(table.concat(e:Names(Rt), " "), "Xuelan Durayn", "cap: nothing lost from the row it came from")
  check(e:Move(L, 5, L, 1), "cap: a full row still reorders")
  -- with the names back, the line is written exactly as it was
  local back = M.New(raw)
  back:Add(L, "Solex", "player")
  back:Remove(L, 3)
  eq(back:Text(), raw, "edit: back to the names it had, the text as written")
  check(not back:Dirty(), "edit: not dirty then")
  -- a CRLF note keeps its line ends
  local crlf = (head("Heroic") .. BLOCK):gsub("\\n", "\\r\\n")
  local c = M.New(crlf)
  c:Remove(3, 1)
  eq(c:Text(), (head("Heroic") .. "intstart\\nSixz\\nDurayn Sarrantha\\nintend\\n"):gsub("\\n", "\\r\\n"), "edit: CRLF kept")
end

-- a block that leaves trailing empty groups out still shows a row for each group, which takes names
do
  local raw = head("Heroic") .. "intstart\\nXuelan Sixz\\nintend\\nSpread out\\n"
  local e = M.New(raw)
  local order, rightAt = e:Order(), nil
  local kinds = {}
  for n, i in ipairs(order) do
    kinds[#kinds + 1] = e.rows[i].kind .. (e.rows[i].label and (":" .. e.rows[i].label) or "")
    if e.rows[i].label == "Right" then rightAt = i end
  end
  eq(table.concat(kinds, ","), "header,heading,kick:Left,kick:Right,blank,heading,blank", "missing: Right shown before the end line")
  check(rightAt and e:Editable(rightAt), "missing: it takes names")
  eq(e:Text(), raw, "missing: nothing written while it is empty")
  e:Add(rightAt, "Durayn", "player")
  eq(e:Text(), head("Heroic") .. "intstart\\nXuelan Sixz\\nDurayn\\nintend\\nSpread out\\n", "missing: its line written in group order")
  -- every name out: the block is taken out, as the Interrupts page's write does
  local x = M.New(raw)
  x:Remove(3, 1)
  x:Remove(3, 1)
  eq(x:Text(), head("Heroic") .. "Spread out\\n", "empty: no block")
end

-- no setup: Group N rows, no cap
do
  local e = M.New("EncounterID:3470;Difficulty:Normal\\n" .. BLOCK)
  eq(e.rows[3].label, "Group 1", "no setup: Group N")
  eq(e.rows[3].cap, nil, "no setup: no cap")
  for _, n in ipairs({ "A", "B", "C", "D", "E", "F" }) do e:Add(3, n, "player") end
  eq(#e:Names(3), 8, "no setup: any number of names")
  -- the record's boss, for a text with no header
  local r = M.New(BLOCK, { boss = { encounterID = 3470, difficulty = "Heroic" } })
  eq(r.rows[2].label, "Left", "editor: the record's boss names the rows")
end

-- read-only: no drag, no x
do
  local e = M.New(head("Heroic") .. BLOCK, { readOnly = true })
  check(not e:Editable(3), "read-only: takes no names")
  check(not e:Add(3, "Solex", "player"), "read-only: no add")
  check(not e:Remove(3, 1), "read-only: no x")
  check(not e:BeginDrag({ row = 3, index = 1 }), "read-only: no drag")
end

-- after a save: Interrupts' lists for that boss and difficulty follow (Block.Saved)
do
  local Notes = CRT.Notes
  CRT.db.notes.list, CRT.db.notes.nextId, CRT.db.notes.active = {}, 1, nil
  local before = head("Heroic") .. "intstart\\nA1 A2 A3 A4 A5\\nB1 B2 B3 B4 B5\\nintend\\n"
  local id = Notes:Import(before)
  local fired = 0
  I:OnChange(function(what) if what == "list" then fired = fired + 1 end end)
  local after = head("Heroic") .. "intstart\\nA2 A1 A3 A4 A5\\nB1 B2 B3 B4 B5\\nintend\\n"
  Notes:UpdateRaw(id, after)
  fired = 0
  check(B.Saved(id, before, after), "sync: the block changed, the lists follow")
  local key = I.Key(3470, 15)
  eq(table.concat(I:Own(key)[1], " "), "A2 A1 A3 A4 A5", "sync: your own list in the new order")
  local list, from = I:List(key)
  eq(from, "raid", "sync: the raid's list is in use")
  eq(table.concat(list[1], " "), "A2 A1 A3 A4 A5", "sync: the raid's list read back from the note")
  eq(fired, 1, "sync: one change, so an open page refreshes once")
  -- a row with names short of its slots: your own list follows, the raid's can't be read from it
  local short = head("Heroic") .. "intstart\\nA2 A1\\nB1 B2 B3 B4 B5\\nintend\\n"
  Notes:UpdateRaw(id, short)
  fired = 0
  B.Saved(id, after, short)
  eq(table.concat(I:Own(key)[1], ","), "A2,A1,,,", "sync: own list with the empty slots")
  local l2, f2 = I:List(key)
  eq(f2, "own", "sync: your own list in use, since the raid's no longer matches the note")
  eq(fired, 1, "sync: one change")
  -- nothing in the block changed: nothing follows
  fired = 0
  check(not B.Saved(id, short, short .. "Spread out\\n"), "sync: the block as it was, nothing done")
  eq(fired, 0, "sync: no change fired")
  -- a personal note never holds the raid's block: left alone
  local mine = Notes:Import(head("Heroic") .. "intstart\\nZ1\\nintend\\n", nil, true)
  fired = 0
  check(not B.Saved(mine, before, after), "sync: a personal note, nothing done")
  eq(fired, 0, "sync: nothing fired for it")
end

-- review round 1 (#1212)
do
  local Notes = CRT.Notes
  -- a start with no end is no block: the lines are the editor's usual rows, the text as written
  local open = head("Heroic") .. "intstart\\nXuelan Sixz\\nSpread out\\n"
  local e = M.New(open)
  check(e.kick == nil and e.rows[3].kind ~= "kick", "no intend: no kick rows")
  eq(e:Text(), open, "no intend: the text as written")
  -- more lines than the setup has groups: the extra one is Group 3, with no cap
  local more = head("Heroic") .. "intstart\\nA B\\nC D\\nE F\\nintend\\n"
  local m = M.New(more)
  eq(m.rows[5].label, "Group 3", "more lines: past the groups is Group N")
  eq(m.rows[5].cap, nil, "more lines: no cap")
  eq(m:Text(), more, "more lines: unchanged, as written")
  check(m:Move(5, 1, 5, nil), "more lines: a drop on the row's empty part moves it to the end")
  eq(m:Text(), head("Heroic") .. "intstart\\nA B\\nC D\\nF E\\nintend\\n", "more lines: every line written again, in order")
  -- a CRLF note opens clean
  local crlf = (head("Heroic") .. BLOCK .. "Melee: Abu\\n"):gsub("\\n", "\\r\\n")
  check(not M.New(crlf):Dirty(), "CRLF: not dirty as opened")
  -- the personal note shows the block read-only, as #1210 did
  local p = M.New(head("Heroic") .. BLOCK, { markdown = true })
  eq(p.rows[2].kind, "heading", "personal: the Kick order heading")
  check(p.rows[3].kind == "text" and p.rows[3].text:find("Left: Xuelan Sixz", 1, true) and not p.rows[3].editable, "personal: a read-only line: " .. tostring(p.rows[3].text))
  eq(p.rows[5].kind, "blank", "personal: no intend line")
  check(p.kick == nil, "personal: no kick rows")

  -- SetOwn: a name clean() empties leaves no gap; the list in use is decided even when no name changed
  CRT.db.notes.list, CRT.db.notes.nextId, CRT.db.notes.active = {}, 1, nil
  local key = I.Key(3470, 15)
  I:Clear(key)
  I:SetOwn(key, { { "-Gone", "A1" }, {} }, true)
  eq(table.concat(I:Own(key)[1], ","), "A1,,,,", "SetOwn: no gap")
  I:ReceiveShared(key, { { "X1", "X2", "X3", "X4", "X5" }, { "Y1", "Y2", "Y3", "Y4", "Y5" } }, "Lead")
  eq(select(2, I:List(key)), "raid", "the raid's list in use")
  check(I:SetOwn(key, { { "A1" }, {} }, true), "SetOwn: the same names, the list in use changes")
  eq(select(2, I:List(key)), "own", "SetOwn: your own, since the raid's differs from it")

  local fired = 0
  I:OnChange(function(what) if what == "list" then fired = fired + 1 end end)
  local before = head("Heroic") .. "intstart\\nA1 A2 A3 A4 A5\\nB1 B2 B3 B4 B5\\nintend\\n"
  local after = head("Heroic") .. "intstart\\nA5 A2 A3 A4 A1\\nB1 B2 B3 B4 B5\\nintend\\n"
  local id = Notes:Import(after)
  -- a note the pull doesn't read (another note for that boss and difficulty is the one in use): nothing follows
  local other = Notes:Import("EncounterID:3470;Difficulty:Heroic;Name:Other\\nSpread out\\n", "Someone", nil, "pug:Someone")
  Notes:SetActive(other)
  check(Notes:FindForEncounter(3470, "Heroic") == other, "setup: the other note is the one the pull reads")
  fired = 0
  check(not B.Saved(id, before, after), "sync: a note the pull doesn't read, nothing done")
  eq(fired, 0, "sync: nothing fired")
  Notes:SetActive(id)
  -- the tracker off: the lists still follow, ready for when it is on
  I:SetEnabled(false)
  fired = 0
  check(B.Saved(id, before, after), "sync with the tracker off")
  eq(table.concat(I:Own(key)[1], " "), "A5 A2 A3 A4 A1", "tracker off: your own list follows")
  I:SetEnabled(true)
  -- in a fight: the note is saved, the lists wait until it is over, then follow once
  local frameScripts, events = nil, {}
  local realCreate = CreateFrame
  CreateFrame = function()
    local f = realCreate()
    function f:SetScript(name, fn) if name == "OnEvent" then frameScripts = fn end end
    function f:RegisterEvent(ev) events[ev] = true end
    return f
  end
  local inFight = true
  InCombatLockdown = function() return inFight end
  local later = head("Heroic") .. "intstart\\nA1 A2 A3 A4 A5\\nB5 B2 B3 B4 B1\\nintend\\n"
  Notes:UpdateRaw(id, later)
  fired = 0
  local ok, how = B.Saved(id, after, later)
  check(ok and how == "held", "in a fight: held")
  eq(table.concat(I:Own(key)[2], " "), "B1 B2 B3 B4 B5", "in a fight: your own list not yet changed")
  eq(fired, 0, "in a fight: nothing fired")
  check(events.PLAYER_REGEN_ENABLED and events.ENCOUNTER_END and frameScripts, "it waits for the fight's end")
  frameScripts(nil, "ENCOUNTER_END")
  eq(fired, 0, "still in combat: still held")
  inFight = false
  frameScripts(nil, "PLAYER_REGEN_ENABLED")
  eq(table.concat(I:Own(key)[2], " "), "B5 B2 B3 B4 B1", "out of the fight: your own list follows")
  eq(table.concat(I:List(key)[2], " "), "B5 B2 B3 B4 B1", "and the list in use")
  eq(fired, 1, "once")
  frameScripts(nil, "PLAYER_REGEN_ENABLED")
  eq(fired, 1, "and only once")
  CreateFrame = realCreate
  InCombatLockdown = function() return false end
end

-- a kick block and an assignment block (Notes/Assign.lua) in one note: each reads as its own, neither takes the other's
-- lines, both directly after each other with no blank line between them
do
  local A = CRT.NoteAssign
  local casts = { { ph = 1, t = 36 }, { ph = 1, t = 96 } }
  local feast = { name = "Ravenous Feast", spellID = 1234, rows = {
    { label = "Soak", text = "", tokens = { "Xuelan", "Sixz" }, casts = "all" },
    { label = "Back", text = "", tokens = { "Durayn" }, casts = { 2 } } } }
  local assignText = table.concat(A.Lines(feast, casts, { mech = "1234" }), "\\n") .. "\\n"
  for _, order in ipairs({ "kick first", "assign first" }) do
    local raw = order == "kick first" and (head("Heroic") .. BLOCK .. assignText) or (head("Heroic") .. assignText .. BLOCK)
    -- the rendered view: Kick order with its group labels, the Assign heading with its rows and timer lines
    local view = {}
    for _, r in ipairs(R.Rows(raw, { classOf = classOf })) do view[#view + 1] = r.kind .. ":" .. (r.text or r.label or "") end
    local v = table.concat(view, "|")
    check(v:find("heading:Kick order|label:Left|label:Right", 1, true), order .. ": render: Kick order and its groups: " .. v)
    check(v:find("heading:Ravenous Feast|label:Soak|label:Back", 1, true), order .. ": render: the Assign heading and its rows: " .. v)
    check(not v:find("assign:", 1, true) and not v:find("intstart", 1, true), order .. ": render: no marker shown: " .. v)
    eq(select(2, v:gsub("timer:", "")), 3, order .. ": render: the block's three timer lines")
    -- the note editor: the kick lines rows of names, the Assign heading a heading, its rows editable
    local s = M.New(raw)
    local kinds = {}
    for i, row in ipairs(s.rows) do kinds[i] = row.kind .. (row.assign and "*" or "") end
    local k = table.concat(kinds, ",")
    if order == "kick first" then
      eq(k, "header,heading,kick,kick,blank,heading*,label,label,timer,timer,timer,blank", "editor rows")
    else
      eq(k, "header,heading*,label,label,timer,timer,timer,heading,kick,kick,blank,blank", "editor rows (assign first)")
    end
    eq(s:Text(), raw, order .. ": editor: the raw text unchanged")
    -- the Assign block reads only its own rows, the kick block only its own lines
    local b = A.Read(raw, "ravenous feast", casts)
    check(b and #b.rows == 2 and table.concat(b.rows[1].tokens, " ") == "Xuelan Sixz" and table.concat(b.rows[2].tokens, " ") == "Durayn",
      order .. ": the Assign block's two rows")
    local items = B.View(raw)
    local groups = {}
    for _, it in pairs(items) do if it.kind == "kick" then groups[#groups + 1] = it.label .. "=" .. table.concat(it.names, " ") end end
    table.sort(groups)
    eq(table.concat(groups, ","), "Left=Xuelan Sixz,Right=Durayn Sarrantha", order .. ": the kick block's two groups")
    -- changing the Assign block leaves the kick block byte for byte, and Expand leaves the Assign lines as written
    b.rows[1].tokens = { "Sarrantha" }
    local changed = A.Replace(raw, "ravenous feast", A.Lines(b, casts, { mech = "1234" }), "ravenous feast")
    check(changed:find(BLOCK, 1, true) ~= nil, order .. ": the kick block untouched by the Assign write")
    check(B.Expand(raw):find(assignText, 1, true) ~= nil, order .. ": the Assign lines untouched by Expand")
  end
end

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, 64);
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(f));
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length * 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
