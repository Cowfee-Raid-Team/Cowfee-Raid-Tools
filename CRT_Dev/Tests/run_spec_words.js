// Spec words in raid notes (CRT_Modules/Notes/SpecWords.lua): the one table of spec words ("RestoDruid", "RestoDruid2"),
// read in any case, numbered words, unknown words left alone; who a word means for the alerts (Notes/Engine.lua IsMine):
// a plain word by your spec, a numbered word only for the one player of that spec while the boss has one slot of it,
// others by their cached spec, unknown spec never; Preview as; the rendered note (Notes/Render.lua) showing the one
// player's name or the label; and the raw text kept as written (the parser's fields, FormatLine).
// Usage: node run_spec_words.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const W = process.argv[2];
const FILES = ['CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/SpecWords.lua', 'CRT_Modules/Notes/Engine.lua',
  'CRT_Modules/Notes/Render.lua'];
const harness = `
local src = { ... }
local FILES = ${'{'}${FILES.map(f => JSON.stringify(f)).join(', ')}${'}'}
local fails = 0
local function check(ok, what) if ok then print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local now = 100
function GetTime() return now end
function issecretvalue(v) return v == "SECRET" end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
format = string.format
function GetNumClasses() return 0 end
function UnitName() return "Me" end
function UnitClass() return "Druid", "DRUID" end
function UnitGroupRolesAssigned() return "HEALER" end
function IsInRaid() return true end
function GetNumGroupMembers() return 0 end
local mySpec = 105
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return mySpec, "Spec", "", 0, "HEALER" end }
RAID_CLASS_COLORS = { DRUID = { r = 1, g = 0.49, b = 0.04, colorStr = "ffff7c0a" }, PRIEST = { r = 1, g = 1, b = 1, colorStr = "ffffffff" } }
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
-- the roster (AlertRoster:Players) and the spec cache (Groups.CachedSpec): you, Leafy (a druid), Bark (a druid)
local roster = { { key = "Me-Home", name = "Me", class = "DRUID" }, { key = "Leafy-Home", name = "Leafy", class = "DRUID" },
  { key = "Halo-Home", name = "Halo", class = "PRIEST" } }
local cache = { ["leafy-home"] = 105, ["halo-home"] = 256 }
local function normalize(n) if not n:find("-", 1, true) then n = n .. "-Home" end return n end
local slotCounts = {}
local CRT = {
  db = {},
  Groups = { Normalize = normalize, CachedSpec = function(n) return cache[normalize(n):lower()] end,
    PlayerSpecID = function() return mySpec end },
  AlertRoster = { Players = function() return roster end },
  TimelineHealerSlots = { CountOf = function(enc, spec) return (slotCounts[enc] or {})[spec] or 0 end },
  Notes = {}, AlertRules = {},
  UI = { OnTheme = function() end, HeadingText = function(s) return s end },
}
local previewAs
CRT.Alerts = { RegisterBlock = function() end, onPull = {}, OnChange = function() end, PreviewAs = function() return previewAs end }
local function run(name) for i, f in ipairs(FILES) do if f == name then return assert(load(src[i], f))("CowfeeRaidTools", CRT) end end error(name) end
for _, f in ipairs(FILES) do run(f) end
local S, P, E, R = CRT.NoteSpecs, CRT.NoteParser, CRT.NoteEngine, CRT.NoteRender
check(S ~= nil, "CRT.NoteSpecs is loaded")

-- The table: every word, any case, numbered words, unknown words left alone ------------------------------------------
do
  local want = { { "RestoDruid", 105, "DRUID", "Resto Druid" }, { "PresEvoker", 1468, "EVOKER", "Preservation Evoker" },
    { "Mistweaver", 270, "MONK", "Mistweaver Monk" }, { "HolyPaladin", 65, "PALADIN", "Holy Paladin" },
    { "DiscPriest", 256, "PRIEST", "Disc Priest" }, { "HolyPriest", 257, "PRIEST", "Holy Priest" },
    { "RestoShaman", 264, "SHAMAN", "Resto Shaman" } }
  check(#S.List() == 7, "seven healer specs, in menu order")
  for i, w in ipairs(want) do
    local e = S.List()[i]
    check(e.word == w[1] and e.spec == w[2] and e.class == w[3] and e.label == w[4], w[1] .. " is " .. w[4] .. " (" .. w[2] .. ")")
    for _, spelled in ipairs({ w[1], w[1]:lower(), w[1]:upper() }) do
      local got, n = S.Read(spelled)
      check(got == e and n == nil, spelled .. " reads as " .. w[4] .. ", no slot")
    end
    local got, n = S.Read(w[1]:lower() .. "2")
    check(got == e and n == 2, w[1] .. "2 is slot 2")
    check(S.ByID(w[2]) == e, "ByID " .. w[2])
  end
  local _, n12 = S.Read("RESTODRUID12")
  check(n12 == 12, "a two-digit slot")
  for _, bad in ipairs({ "Resto", "Druid", "RestoDruid0", "RestoDruid-Home", "Resto Druid", "xRestoDruid", "RestoDruidx", "", "SECRET" }) do
    check(S.Read(bad) == nil, "not a spec word: '" .. bad .. "'")
  end
  check(S.Read(nil) == nil and S.Read(5) == nil, "nil and numbers are not words")
  check(S.Word(105) == "RestoDruid" and S.Word(105, 2) == "RestoDruid2" and S.Word(1) == nil, "Word")
  check(S.Label(105) == "Resto Druid" and S.Label(256, 3) == "Disc Priest 3", "Label")
end

-- The parser keeps the words as written, with the note's slot counts -------------------------------------------------
local NOTE = table.concat({ "EncounterID:3001;Name:Nek",
  "time:10;tag:RestoDruid;spellid:740;",
  "time:20;tag:restodruid2;spellid:740;",
  "time:30;tag:Halo;spellid:62618;",
  "time:40;tag:RestoDruid2;spellid:33891;" }, "\\n")
do
  local n = P.Parse(NOTE)
  check(n.timers[1].tags[1] == "RestoDruid" and n.timers[2].tags[1] == "restodruid2", "the tags stay as written")
  local info = n.timers[1].specInfo
  check(info and info.encounterID == 3001 and info.counts[105] == 1, "the note names one numbered Resto Druid slot (2, twice)")
  check(n.timers[2].specInfo == info and n.timers[3].specInfo == nil, "one table for the note; a line with no spec word has none")
  check(P.FormatLine(n.timers[2]) == "time:20;ph:1;tag:restodruid2;spellid:740;", "FormatLine writes the word back as it was: " .. P.FormatLine(n.timers[2]))
end

-- IsMine ---------------------------------------------------------------------------------------------------------------
local function item(tags, counts, enc) local t = { tags = tags } if counts then t.specInfo = { encounterID = enc or 3001, counts = counts } end return t end
do
  -- a plain word: your spec now
  check(E:IsMine(item({ "RestoDruid" })), "RestoDruid is yours while you play Restoration")
  check(E:IsMine(item({ "restodruid" })), "in any case")
  check(not E:IsMine(item({ "DiscPriest" })), "DiscPriest is not")
  mySpec = 102 -- Balance
  check(not E:IsMine(item({ "RestoDruid" })), "not when you play another spec")
  mySpec = nil
  check(not E:IsMine(item({ "RestoDruid" })), "nor when the game gives no spec")
  mySpec = 105
  -- a numbered word: you and Leafy both play Restoration, so it means nobody
  S.Reset()
  check(not E:IsMine(item({ "RestoDruid2" }, {})), "RestoDruid2 with two Resto Druids in the raid: nobody")
  -- Leafy's spec unknown: you are the only one known
  cache["leafy-home"] = nil
  S.Reset()
  check(E:IsMine(item({ "RestoDruid2" }, {})), "the only Resto Druid known, the boss with no other slot: yours")
  check(E:IsMine(item({ "RestoDruid2" }, { [105] = 1 })), "the note naming one slot: yours")
  check(not E:IsMine(item({ "RestoDruid2" }, { [105] = 2 })), "the note naming two slots (1 and 2): nobody")
  slotCounts[3001] = { [105] = 2 }
  check(not E:IsMine(item({ "RestoDruid2" }, { [105] = 1 })), "two slots planned here: nobody")
  check(E:IsMine(item({ "RestoDruid2" }, { [105] = 1 }, 3002)), "another boss's slots don't count")
  slotCounts[3001] = { [105] = 1 }
  check(E:IsMine(item({ "RestoDruid2" }, { [105] = 1 })), "one slot planned here: yours")
  slotCounts = {}
  -- your spec changing is read again after the words are reset
  mySpec = 102
  check(E:IsMine(item({ "RestoDruid2" }, {})), "kept a few seconds")
  E:ResetTokens()
  check(not E:IsMine(item({ "RestoDruid2" }, {})), "read again once reset: not yours as Balance")
  mySpec = 105
  now = now + 10
  -- another spec's word, a name and a class still work beside it
  check(E:IsMine(item({ "DiscPriest", "Me" })), "your name beside another spec's word")
  check(E:IsMine(item({ "HolyPriest", "Druid" })), "your class beside it")
  check(not E:IsMine(item({ "HolyPriest" })), "Holy Priest: nobody here")
  cache["leafy-home"] = 105
  S.Reset()
end

-- Preview as ------------------------------------------------------------------------------------------------------------
do
  previewAs = "Halo"
  check(E:IsMine(item({ "DiscPriest" })), "Preview as Halo: DiscPriest by Halo's cached spec")
  check(not E:IsMine(item({ "RestoDruid" })), "not RestoDruid")
  check(E:IsMine(item({ "DiscPriest2" }, {})), "DiscPriest2: Halo is the only Disc Priest")
  previewAs = "Leafy-Home"
  check(E:IsMine(item({ "RestoDruid" })) and not E:IsMine(item({ "RestoDruid2" }, {})), "Leafy: RestoDruid, but not RestoDruid2 (two Resto Druids)")
  previewAs = "Stranger"
  check(not E:IsMine(item({ "RestoDruid" })) and not E:IsMine(item({ "DiscPriest" })), "unknown spec: never a match")
  previewAs = nil
end

-- The rendered note: the one player's name, else the label ----------------------------------------------------------
do
  local function names(text, ctx)
    local out = {}
    for _, row in ipairs(R.Rows(text, ctx or {})) do
      if row.kind == "timer" then
        local list = {}
        for _, n in ipairs(row.names) do list[#list + 1] = n.text .. "/" .. tostring(n.class) .. (n.me and "/me" or "") end
        out[#out + 1] = table.concat(list, " ")
      end
    end
    return table.concat(out, "|")
  end
  -- two Resto Druids: labels; one Disc Priest: Halo
  local text = "time:10;tag:RestoDruid;spellid:740;\\ntime:20;tag:RestoDruid2;spellid:740;\\ntime:30;tag:DiscPriest;spellid:62618;"
  local got = names(text, { me = "me" })
  check(got == "Resto Druid/DRUID|Resto Druid 2/DRUID|Halo/PRIEST", "two Resto Druids show the label, the one Disc Priest by name: " .. got)
  cache["leafy-home"] = nil
  S.Reset()
  got = names(text, { me = "me" })
  check(got == "Me/DRUID/me|Me/DRUID/me|Halo/PRIEST", "you, the one Resto Druid: your name, marked as you: " .. got)
  cache["leafy-home"] = 105
  S.Reset()
  -- the tests' stand-in for who a word means
  got = names("time:10;tag:HolyPaladin3 Halo;spellid:31821;", { specWho = function() return {} end })
  check(got == "Holy Paladin 3/PALADIN Halo/nil", "nobody known: the label in the class colour, other names as before: " .. got)
  -- the raw text stays as written
  check(R.Rows(text, {}) and text:find("tag:RestoDruid2;", 1, true), "the source text is unchanged")
end

if fails > 0 then error(fails .. " spec word checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, f), 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
