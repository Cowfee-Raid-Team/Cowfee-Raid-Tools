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
  'CRT_Modules/Notes/Render.lua', 'CRT_Modules/Notes/EditModel.lua'];
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
I:SetEnabled(false)
eq(B.Expand(head("Heroic") .. BLOCK), head("Heroic") .. "Kick order\\nGroup 1: Xuelan Sixz\\nGroup 2: Durayn Sarrantha\\n", "expand: Group N when the module is off")
I:SetEnabled(true)
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
local n0 = R.Rows("Melee: Xuelan\\nSpread out\\n", { classOf = classOf })
eq(#n0, 2, "render: a note with no block is as before")

-- the note editor's rows
local s = M.New(head("Heroic") .. BLOCK)
eq(s.rows[2].kind, "heading", "editor: intstart row is the heading")
eq(s.rows[2].text, "Kick order", "editor: its text")
eq(s.rows[3].kind, "text", "editor: a block line is a read-only row")
check(s.rows[3].text:find("UI-RaidTargetingIcon_1", 1, true) and s.rows[3].text:find("Left: Xuelan Sixz", 1, true), "editor: labelled the same way: " .. s.rows[3].text)
check(not s.rows[3].editable, "editor: not editable")
eq(s.rows[5].kind, "blank", "editor: intend shows nothing")
local sm = M.New(head("Mythic") .. BLOCK)
check(sm.rows[3].text:find("UI-RaidTargetingIcon_8", 1, true) ~= nil, "editor: the marker icon")
eq(s:Text(), head("Heroic") .. BLOCK, "editor: the raw text is unchanged")
eq(M.New("Melee: a\\n").rows[1].kind, "label", "editor: other rows as before")

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
