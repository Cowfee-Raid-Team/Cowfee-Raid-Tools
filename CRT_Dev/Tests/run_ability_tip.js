// The shared ability tooltip (CRT_Modules/Timeline/AbilityTip.lua) and the Journal text it reads
// (CRT_Modules/Timeline/Journal.lua, Journal:AbilitySection) on a stub Encounter Journal: a boss's sections found by
// spell, by name or by an explicit section ID, read once per boss and difficulty at that difficulty with the
// Journal's own put back, never in combat or with the Journal open; the tooltip's lines in order and colour (the
// spell, the caller's lines, the Journal heading and text, the types, the tags); and the callers (Timeline, Mech
// Alerts, Season Stats) using it, with no other spell tooltip built on those surfaces.
// Usage: node run_ability_tip.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local journalSrc, refSrc, tipSrc, viewSrc, mechSrc, statsSrc, tocSrc, allSrc = ...
local fails, passes = 0, 0
local function check(name, ok) if ok then passes = passes + 1 print("ok " .. name) else fails = fails + 1 print("FAIL " .. name) end end

-- the game ------------------------------------------------------------------------------------------------------
local combat, ejShown = false, false
function InCombatLockdown() return combat end
EncounterJournal = { IsShown = function() return ejShown end }
local frameScripts = {}
function CreateFrame() local f = { events = {} } f.RegisterEvent = function(self, e) self.events[e] = true end
  f.SetScript = function(self, n, fn) if n == "OnEvent" then frameScripts[#frameScripts + 1] = { frame = self, fn = fn } end end
  return f end
local function fire(event, ...) for _, s in ipairs(frameScripts) do if event == nil or s.frame.events[event] then s.fn(s.frame, event, ...) end end end
C_Map = { GetBestMapForUnit = function() return 1 end }
C_Spell = { GetSpellName = function(id) return ({ [1234] = "Mark of Acid", [2222] = "Mark of Blood", [500] = "Overview Rend" })[id] end,
  GetSpellTexture = function(id) return "tex" .. id end }
function GetDifficultyInfo(id) return ({ [15] = "Heroic", [16] = "Mythic", [14] = "Normal" })[id] end
Enum = { JournalEncounterIconFlags = { Tank = 0, Healer = 2, Magic = 7 } }
local difficulty, setCalls, reads = 15, {}, 0
function EJ_GetDifficulty() return difficulty end
function EJ_SetDifficulty(d) setCalls[#setCalls + 1] = d difficulty = d end
local loaded = { [1234] = true, [2222] = true }
-- sections: the text follows the Journal's difficulty, as the game's does
local function sec(id)
  local t = ({
    [10] = { title = "Overview", spellID = 0, headerType = 3, firstChildSectionID = 11, siblingSectionID = 20 },
    [11] = { title = "Overview Rend", spellID = 500, headerType = 3, description = "Role summary" },
    [20] = { title = "Stage One", spellID = 0, headerType = 0, firstChildSectionID = 21 },
    [21] = { title = "Mark of Acid", spellID = 1234, headerType = 1, abilityIcon = 901, siblingSectionID = 24 },
    [24] = { title = "Mark of Acid", spellID = 1234, headerType = 1, siblingSectionID = 22, filtered = 16, description = "Normal only text" },
    [22] = { title = "Mark of Blood", spellID = 2222, headerType = 1, abilityIcon = 902, siblingSectionID = 23 },
    [23] = { title = "Toxic Droplets", spellID = 0, headerType = 1, abilityIcon = 903, description = "Drops of poison $bullet;Dodge them" },
    [30] = { title = "Mark of Acid (explicit)", spellID = 1234, headerType = 1, description = "Explicit text" },
  })[id]
  if not t then return nil end
  local o = {}
  for k, v in pairs(t) do o[k] = v end
  o.filteredByDifficulty = t.filtered == difficulty
  if id == 21 then o.description = loaded[1234] and ((difficulty == 16 and "Mythic: 5,000 damage" or "Heroic: 3,000 damage") .. " |cffffffffMark|r") or nil end
  if id == 22 then o.description = loaded[2222] and "Blood text" or nil end
  return o
end
C_EncounterJournal = { GetSectionInfo = function(id) reads = reads + 1 return sec(id) end, GetSectionIconFlags = function(id) return ({ [21] = { 7, 2 } })[id] end }
local selected, selects = 777, 0
function EJ_GetInstanceForMap() return 200 end
function EJ_GetCurrentInstance() return selected end
function EJ_SelectInstance(id) selected = id selects = selects + 1 end
function EJ_GetEncounterInfoByIndex(j) if selected == 200 and j == 1 then return "Entombed", "", 900, 10 end end
function EJ_GetEncounterInfo(jid) if jid == 900 then return "Entombed", "", 900, 10, "", 0, 3001, 0 end end

-- the addon ----------------------------------------------------------------------------------------------------------
local routeFns = {}
local owned = {}
local CRT = { db = { timeline = { rows = {} } }, Timeline = { GROUP_NAMES = { nh = "Normal/Heroic", mythic = "Mythic" } },
  Bosses = { OnRouteChange = function(_, fn) routeFns[#routeFns + 1] = fn end },
  UI = { TooltipOwner = function(tip, owner, anchor, x, y, how) owned[#owned + 1] = { tip = tip, owner = owner, area = how } end } }
function CRT.Timeline:Settings() return CRT.db.timeline end
function CRT.Timeline:Fire() end
assert(load(journalSrc, "Journal.lua"))("CowfeeRaidTools", CRT)
assert(load(refSrc, "Reference.lua"))("CowfeeRaidTools", CRT)
assert(load(tipSrc, "AbilityTip.lua"))("CowfeeRaidTools", CRT)
local J, R, Tip = CRT.TimelineJournal, CRT.TimelineReference, CRT.AbilityTip
check("CRT.AbilityTip and Journal:AbilitySection exist", Tip and Tip.Show and J.AbilitySection)

-- 1. The Journal text map -----------------------------------------------------------------------------------------------
local s, at = J:AbilitySection(3001, "mythic", 1234, "Mark of Acid")
check("by spell, at Mythic: " .. tostring(s and s.description), s and s.sectionID == 21 and s.description:find("Mythic: 5,000", 1, true) and at == 16)
check("the difficulty was set for the read and put back: " .. table.concat(setCalls, ","), table.concat(setCalls, ",") == "16,15" and difficulty == 15)
check("the Journal's instance put back", selected == 777)
check("a section the difficulty hides doesn't replace the shown one", s and s.description ~= "Normal only text")
check("the section's icon and tags", s and s.icon == 901 and s.tags and s.tags[1] == "magic" and s.tags[2] == "healer")
local r0, sel0, set0 = reads, selects, #setCalls
local blood = J:AbilitySection(3001, "mythic", 0, "  MARK of blood ")
check("by name, trimmed and any case, with no spell", blood and blood.sectionID == 22 and blood.description == "Blood text")
local blood2 = J:AbilitySection(3001, "mythic", 2222, nil)
check("by spell again", blood2 and blood2.sectionID == 22)
check("no walk and no difficulty change after the first build", reads == r0 and selects == sel0 and #setCalls == set0)
local ex = J:AbilitySection(3001, "mythic", 1234, "Mark of Acid", 30)
check("an explicit section wins over the spell: " .. tostring(ex and ex.description), ex and ex.sectionID == 30 and ex.description == "Explicit text")
check("a section with no spell found by its title", (J:AbilitySection(3001, "mythic", nil, "Toxic Droplets") or {}).sectionID == 23)
check("the Overview's repeats are not read", J:AbilitySection(3001, "mythic", 500, "Overview Rend") == nil)
setCalls = {}
local h, hat = J:AbilitySection(3001, "nh", 1234, "Mark of Acid")
check("Normal/Heroic reads at Heroic, the Journal already on it: no change", h and h.description:find("Heroic: 3,000", 1, true) and hat == 15 and #setCalls == 0)
-- a missing Journal: nothing, remembered until the zone changes
local sel1 = selects
check("an unknown boss: no section", J:AbilitySection(4242, "mythic", 1234, "Mark of Acid") == nil)
local sel2 = selects
J:AbilitySection(4242, "mythic", 1234, "Mark of Acid")
check("the miss is remembered", sel2 > sel1 and selects == sel2)
fire(nil)
J:AbilitySection(4242, "mythic", 1234, "Mark of Acid")
check("and tried again after a zone change", selects > sel2)
check("no number, no lookup", J:AbilitySection("ref:x", "mythic", 1234, "Mark of Acid") == nil and J:AbilitySection(nil, "mythic", 1234) == nil)
-- combat and the open Journal: what is kept shows, nothing new is read
combat = true
local selC, setC = selects, #setCalls
check("in combat: the kept text still shows", (J:AbilitySection(3001, "mythic", 1234, "Mark of Acid") or {}).sectionID == 21)
check("in combat: a boss not read yet gives nothing, and nothing is walked", J:AbilitySection(3002, "mythic", 1, "X") == nil and selects == selC and #setCalls == setC)
combat = false
ejShown = true
difficulty = 15
for _, fn in ipairs(routeFns) do fn() end -- a route change: everything read again
setCalls = {}
check("with the Journal open nothing is read", J:AbilitySection(3001, "mythic", 1234, "Mark of Acid") == nil and #setCalls == 0 and selected == 777)
ejShown = false
setCalls = {}
check("closed again: read, after the route change cleared the kept text", (J:AbilitySection(3001, "mythic", 1234, "Mark of Acid") or {}).sectionID == 21 and #setCalls == 2)
-- a spell whose text had not loaded: read again on the next hover, once it has
for _, fn in ipairs(routeFns) do fn() end
loaded[2222] = false
local miss = J:AbilitySection(3001, "mythic", 2222, nil)
check("text not loaded yet: the section, no text", miss and miss.sectionID == 22 and miss.description == nil)
loaded[2222] = true
setCalls = {}
local got = J:AbilitySection(3001, "mythic", 2222, nil)
check("loaded later: read again at the difficulty, then put back", got and got.description == "Blood text" and table.concat(setCalls, ",") == "16,15")
-- the game says a spell's text changed: its kept text is read again on the next hover
local before = reads
fire("SPELL_TEXT_UPDATE", 1234)
J:AbilitySection(3001, "mythic", 1234, "Mark of Acid")
check("SPELL_TEXT_UPDATE: that spell's text read again", reads > before)
before = reads
J:AbilitySection(3001, "mythic", 1234, "Mark of Acid")
check("and only once", reads == before)
local kept = J:AbilitySection(3001, "mythic", 2222, nil, nil, true)
check("cached only: a kept boss answers", kept and kept.sectionID == 22)
check("cached only: a boss not read yet gives nothing, and nothing is walked", J:AbilitySection(3003, "mythic", 1, "X", nil, true) == nil)

-- 2. The tooltip --------------------------------------------------------------------------------------------------------
local said
local function stub(refuse)
  said = {}
  return setmetatable({}, { __index = function(_, k)
    if k == "SetSpellByID" and refuse then return function() error("no such spell") end end
    return function(_, a, r, g, b, w) said[#said + 1] = { k = k, text = a, r = r, g = g, b = b, wrap = w } end
  end })
end
local function kinds() local t = {} for i, x in ipairs(said) do t[i] = x.k .. (x.text ~= nil and (":" .. tostring(x.text)) or "") end return table.concat(t, " | ") end
local function find(pattern) for i, x in ipairs(said) do if type(x.text) == "string" and x.text:find(pattern, 1, true) then return i, x end end end
local tip = stub()
owned = {}
Tip:Show(tip, "OWNER", "timeline", { encounterID = 3001, group = "mythic", spellID = 1234, name = "Mark of Acid", types = { "dispel", "raid" },
  tags = { "magic", "healer" }, lines = { { "Planned at 0:10", 1, 1, 1 } } })
check("placed by UI.TooltipOwner with the caller's area", owned[1] and owned[1].owner == "OWNER" and owned[1].area == "timeline" and owned[1].tip == tip)
check("the spell first: " .. kinds(), said[1].k == "SetSpellByID" and said[1].text == 1234)
local iPlan = find("Planned at")
local iHead, head = find("Encounter Journal (Mythic)")
local iText, text = find("Mythic: 5,000")
local iDispel, dispel = find(R.TypeLine("dispel"))
local iRaid, raid = find(R.TypeLine("raid"))
local iTags, tags = find("icons_16x16_magic")
check("then the caller's lines, the Journal heading and text, the types, the tags: " .. kinds(),
  iPlan == 2 and iHead == 3 and iText == 4 and iDispel == 5 and iRaid == 6 and iTags == 7 and said[8].k == "Show")
check("the heading in the tooltip's gold", head and head.r == 1 and head.g == 0.82 and head.b == 0)
check("the Journal's text in white, wrapped", text and text.r == 1 and text.g == 1 and text.b == 1 and text.wrap == true)
check("each type in its colour", dispel and dispel.r == R.TYPES.dispel.color[1] and dispel.b == R.TYPES.dispel.color[3] and raid.r == R.TYPES.raid.color[1])
check("the tags on one line, each with its icon and name", tags and tags.text:find("Magic", 1, true) and tags.text:find("icons_16x16_heal", 1, true) and tags.text:find("Healer", 1, true))
-- the section's own tags when the caller has none
tip = stub()
Tip:Show(tip, "OWNER", nil, { encounterID = 3001, group = "mythic", spellID = 1234, name = "Mark of Acid" })
check("no tags given: the Journal section's", find("icons_16x16_magic") ~= nil)
check("no types given: no type lines", find(R.TypeLine("dispel")) == nil)
-- Journal bullets read as lines
tip = stub()
Tip:Show(tip, "OWNER", nil, { encounterID = 3001, group = "mythic", name = "Toxic Droplets", spellID = 0 })
local _, bul = find("Drops of poison")
check("no spell: the name as a gold title: " .. kinds(), said[1].k == "SetText" and said[1].text == "Toxic Droplets" and said[1].g == 0.82)
check("the Journal's bullets as lines", bul and bul.text:find("\n", 1, true) and not bul.text:find("$bullet;", 1, true))
-- no Journal: the rest still shows
tip = stub()
Tip:Show(tip, "OWNER", nil, { encounterID = 4242, group = "mythic", spellID = 1234, name = "Mark of Acid", types = { "soak" } })
check("no Journal: no heading, the spell and types still shown: " .. kinds(), find("Encounter Journal") == nil and said[1].k == "SetSpellByID" and find(R.TypeLine("soak")) ~= nil)
-- the game refuses the spell: the name stands in
tip = stub(true)
local ok = pcall(Tip.Show, Tip, tip, "OWNER", nil, { encounterID = 3001, group = "mythic", spellID = 1234, name = "Mark of Acid" })
check("spell refused: the name as a gold title, then the Journal: " .. kinds(), ok and said[1].k == "SetText" and said[1].text == "Mark of Acid" and said[1].r == 1 and said[1].g == 0.82 and find("Encounter Journal (Mythic)") ~= nil)
-- a line for no type, when the caller asks
tip = stub()
Tip:Show(tip, "OWNER", nil, { encounterID = 4242, spellID = 1234, name = "Mark of Acid", empty = "No type yet." })
check("no types: the caller's empty line", find("No type yet.") ~= nil)
tip = stub()
Tip:Show(tip, "OWNER", nil, { encounterID = 4242, spellID = 1234, name = "Mark of Acid", types = { "raid" }, empty = "No type yet." })
check("with types: no empty line", find("No type yet.") == nil)
-- the row's types and tags when the caller gives a row
tip = stub()
Tip:Show(tip, "OWNER", nil, { encounterID = 4242, spellID = 1234, name = "Mark of Acid", row = { types = { "spread" }, tags = { "tank" } } })
check("a row's types and tags", find(R.TypeLine("spread")) ~= nil and find("icons_16x16_tank") ~= nil)
-- the row's section, written [section N]
tip = stub()
Tip:Show(tip, "OWNER", nil, { encounterID = 3001, group = "mythic", spellID = 1234, name = "Mark of Acid", row = { sectionID = 30 } })
check("a row's [section N] picks the Journal text", find("Explicit text") ~= nil)

-- 3. The callers -------------------------------------------------------------------------------------------------------
check("the Timeline's icons and rows use it", viewSrc:find("AbilityTip:Show(", 1, true) ~= nil)
check("Mech Alerts' rows use it", mechSrc:find("AbilityTip:Show(", 1, true) ~= nil)
check("Season Stats' causes use it", statsSrc:find("AbilityTip:Show(", 1, true) ~= nil)
check("no spell tooltip built anywhere else in the modules: " .. allSrc, allSrc == "")
local tocTip = tocSrc:find("CRT_Modules\\Timeline\\AbilityTip.lua", 1, true)
check("in the .toc after the Journal and Reference, before View", tocTip and tocTip > tocSrc:find("CRT_Modules\\Timeline\\Reference.lua", 1, true)
  and tocTip > tocSrc:find("CRT_Modules\\Timeline\\Journal.lua", 1, true) and tocTip < tocSrc:find("CRT_Modules\\Timeline\\View.lua", 1, true))
print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error(fails .. " failed", 0) end
`;
const dir = process.argv[2];
const read = (f) => { const p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
// every module file but the helper that builds a spell tooltip: "file: line" for each
const others = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.name.endsWith('.lua') && !p.replace(/\\/g, '/').endsWith('Timeline/AbilityTip.lua')) {
    fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (l.includes('SetSpellByID')) others.push(path.relative(dir, p) + ':' + (i + 1)); }); } } };
walk(path.join(dir, 'CRT_Modules'));
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Timeline/Journal.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/AbilityTip.lua']) {
  const src = read(f); lua.lua_pushstring(L, to_luastring(src || 'error("missing ' + f + '")'));
}
for (const f of ['CRT_Modules/Timeline/View.lua', 'CRT_Modules/Notes/Reminders.lua', 'CRT_Modules/SeasonStats/Page.lua', 'CowfeeRaidTools.toc']) lua.lua_pushstring(L, to_luastring(read(f)));
lua.lua_pushstring(L, to_luastring(others.join(', ')));
if (lua.lua_pcall(L, 8, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
