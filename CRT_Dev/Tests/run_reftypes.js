// CRT_Dev/Dev/ReferenceTypes.lua, the Manage ability timelines window: its removal lines, /crt dev mechhidden, and no type
// editing (an ability's types are its right-click label, Timeline:SetAbility). The sample ability timelines parse.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const A = process.argv[2];
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local refSrc, typesSrc, regSrc, seasonSrc, nekSrc, sszSrc = ...
local CRT = { UI = {}, Timeline = { Settings = function() return {} end, Fire = function() end } }
CRT.TimelineDB = { references = {} }
assert(load(refSrc))("CowfeeRaidTools", CRT)
assert(load(typesSrc))("CowfeeRaidTools", CRT)
local R, E = CRT.TimelineReference, CRT.ReferenceTypes
local shipped = {}
CRT.Bosses = { Register = function(_, b) for _, t in ipairs(b.references or {}) do shipped[b.name] = t end end }
assert(load(nekSrc))("CowfeeRaidTools", CRT)
assert(load(sszSrc))("CowfeeRaidTools", CRT)
local fails = 0
local function check(name, ok) print((ok and "PASS " or "FAIL ") .. name) if not ok then fails = fails + 1 end end

-- Sszorak parses: 7 rows, encounter 3420, no types yet.
local s = assert(R.Parse(shipped.Sszorak))
check("Sszorak parses with 7 rows", #s.rows == 7)
check("Sszorak encounter 3420", s.encounterID == 3420)
check("Sszorak casts", #s.rows[1].casts == 6 and s.rows[1].casts[1].dur == 19 and #s.rows[7].casts == 3)
check("Sszorak length 6:32", s.length == 392)

local d = R.Parse("Boss: X\\nFoo (type dodge heavydot): 0:10\\n")
check("dodge and heavydot read", d and d.rows[1].types[1] == "dodge" and d.rows[1].types[2] == "heavydot")
check("Sszorak types shipped", s.rows[1].types[1] == "raid" and s.rows[2].types[1] == "soak" and s.rows[5].types[1] == "raid")
-- Export removals: one line per marked shipped reference (boss file, encounter ID, difficulty, header).
check("boss file from name", E.BossFile("Kith'ix") == "Kithix.lua" and E.BossFile("Nek'zali the Soulcoiler") == "NekzaliTheSoulcoiler.lua")
CRT.Bosses.Get = function(_, id) if id == 3513 then return { encounterID = 3513, name = "Kith'ix", season = "sample" } end end
check("boss file in its season folder when the registry knows it", E.BossFile("Kith'ix", 3513) == "CRT_Data/Seasons/Sample/Kithix.lua")
local line = E.RemovalLine({ boss = "Kith'ix", encounterID = 3513, difficulty = "Mythic", header = "Boss: Kith'ix / Difficulty: Mythic / Length: 7:00" })
check("removal line format", line == "CRT_Data/Seasons/Sample/Kithix.lua; encounter 3513; Mythic; Boss: Kith'ix / Difficulty: Mythic / Length: 7:00")
check("removal line, no encounter or difficulty", E.RemovalLine({ boss = "X", header = "Boss: X" }) == "X.lua; encounter ?; any difficulty; Boss: X")
check("removal line, already gone", E.RemovalLine({ boss = "X", header = "Boss: X", gone = true }) == "X.lua; encounter ?; any difficulty; Boss: X; already gone")
CRT.db = { timeline = {}, dev = { removedReferences = {
  ["3513|Mythic|Boss: Kith'ix / Difficulty: Mythic / Length: 7:00"] = { boss = "Kith'ix", encounterID = 3513, difficulty = "Mythic", header = "Boss: Kith'ix / Difficulty: Mythic / Length: 7:00" },
  ["3420|Heroic|Boss: Sszorak / Difficulty: Heroic / Length: 6:32"] = { boss = "Sszorak", encounterID = 3420, difficulty = "Heroic", header = "Boss: Sszorak / Difficulty: Heroic / Length: 6:32" },
} } }
CRT.Timeline.Settings = function() return CRT.db.timeline end
CRT.TimelineDB.references = { "Boss: Kith'ix\\nDifficulty: Mythic\\nLength: 7:00\\nEncounter: 3513\\nX: 0:10" }
local lines = E.RemovalLines()
check("removal lines sorted by boss", #lines == 2 and lines[1] == "CRT_Data/Seasons/Sample/Kithix.lua; encounter 3513; Mythic; Boss: Kith'ix / Difficulty: Mythic / Length: 7:00" and lines[2] == "Sszorak.lua; encounter 3420; Heroic; Boss: Sszorak / Difficulty: Heroic / Length: 6:32; already gone")
CRT.db.dev.removedReferences = nil
check("no removals, no lines", #E.RemovalLines() == 0)
-- /crt dev mechhidden: the mechHidden line to paste into each changed boss file
local printed = {}
CRT.Print = function(_, m) printed[#printed + 1] = m end
CRT.Timeline.MechHiddenNames = function(_, id) if id == 3513 then return { "Latent Cultist", "Void \\"Rift\\"" } end return {} end
E:PrintMechHidden()
check("mech hidden: nothing changed says how", #printed == 1 and printed[1]:find("No abilities hidden from Mech Alerts", 1, true) ~= nil and printed[1]:find("/crt dev", 1, true) ~= nil)
printed = {}
CRT.db.dev.mechHidden = { ["3513"] = { ["latent cultist"] = "Latent Cultist" } }
E:PrintMechHidden()
check("mech hidden: the boss file line", #printed == 1 and printed[1] == "Kith'ix (3513): mechHidden = { \\"Latent Cultist\\", \\"Void \\\\\\"Rift\\\\\\"\\" },")
printed = {}
CRT.db.dev.mechHidden = { ["3513"] = { ["latent cultist"] = false } }
CRT.Timeline.MechHiddenNames = function() return {} end
E:PrintMechHidden()
check("mech hidden: all shown again prints an empty list", #printed == 1 and printed[1] == "Kith'ix (3513): mechHidden = {  },")
-- No type editing: the Main and Also rows, Save as my copy and Export are gone; Manage ability timelines is the window
check("no type editing left", E.ApplyTypes == nil and E.SaveAsCopy == nil)
do
  local made, dropdowns, buttons, texts = {}, {}, {}, {}
  local function frame()
    local f = { shown = false, points = {} }
    return setmetatable(f, { __index = function(t, k)
      if k == "Show" then return function(self) self.shown = true if rawget(self, "onShow") then self.onShow(self) end end end
      if k == "Hide" then return function(self) self.shown = false end end
      if k == "IsShown" then return function(self) return self.shown end end
      if k == "SetShown" then return function(self, v) if v then self:Show() else self:Hide() end end end
      if k == "SetText" then return function(self, v) self.text = v end end
      if k == "SetEnabled" then return function(self, v) self.enabled = v end end
      if k == "HookScript" then return function(self, n, fn) if n == "OnShow" then self.onShow = fn end end end
      if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
      if k == "GetWidth" then return function() return 400 end end
      if k == "GetFontString" then return function() return { GetStringWidth = function() return 50 end } end end
      if k == "CreateFontString" then return function() local x = frame() texts[#texts + 1] = x return x end end
      return function() end
    end })
  end
  CreateFrame = function(kind) local f = frame() if kind == "Button" then buttons[#buttons + 1] = f end return f end
  CRTFontButtonSmall, CRTFontButtonSmallHighlight, CRTFontButtonSmallDisable = {}, {}, {}
  CRT.UI.Window = function(name, o) local w = frame() w.name, w.opts = name, o made[#made + 1] = w return w end
  CRT.UI.Dropdown = function(_, label, o) local d = frame() d.label, d.opts = label, o d.refresh = function() end dropdowns[#dropdowns + 1] = d return d end
  CRT.UI.HelpRight = function() return frame() end
  CRT.UI.SkinScrollBar = function() end
  CRT.UI.SkinTree = function() end
  CRT.Bosses.Options = function() return { { key = "raid:x", label = "Sample Raid", title = true }, { key = 3513, label = "Kith'ix" }, { key = 3420, label = "Sszorak" } } end
  CRT.TimelineDB.references = { "Boss: Kith'ix\\nDifficulty: Mythic\\nLength: 7:00\\nEncounter: 3513\\nX: 0:10" }
  CRT.db.timeline.references = { { id = 1, text = "Boss: Kith'ix\\nDifficulty: Heroic\\nEncounter: 3513\\nY: 0:20" } }
  E:Toggle()
  local w = made[1]
  check("one window: Manage ability timelines", #made == 1 and w.shown and w.opts.title == "Manage ability timelines (dev)")
  local pick = dropdowns[1]
  check("a Boss picker, the boss file's bosses under their raid", #dropdowns == 1 and pick.label == "Boss" and #pick.opts.options() == 3)
  check("it opens on the first boss with ability timelines", pick.opts.get() == 3513)
  local function shownText(t) for _, x in ipairs(texts) do if x.text and x.text:find(t, 1, true) then return x end end end
  local labels = {}
  for _, b in ipairs(buttons) do if b.text then labels[#labels + 1] = b.text end end
  local all = table.concat(labels, ",")
  check("no Save as my copy, Export or Main type: " .. all, not all:find("Save as my copy", 1, true) and not all:find("Delete my copy", 1, true)
    and all:find("Delete all my copies", 1, true) and all:find("Export removals", 1, true))
  for _, x in ipairs(texts) do check("no type headers", x.text ~= "Main type" and x.text ~= "Also") end
  check("your copy and the shipped one are listed", shownText("Heroic") ~= nil and shownText("Mythic") ~= nil and all:find("Delete", 1, true) and all:find("Remove from addon", 1, true))
  pick.opts.set(3420)
  check("another boss: its ability timelines", pick.opts.get() == 3420 and shownText("No ability timelines").shown)
  CRT.db.timeline.references = {}
end
print(fails == 0 and "all passed" or (fails .. " failed"))
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const f of ['CRT_Modules/Timeline/Reference.lua', 'CRT_Dev/Dev/ReferenceTypes.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua', 'CRT_Dev/Tests/SamplePack/Sszorak.lua'])
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(A + '/' + f, 'utf8')));
if (lua.lua_pcall(L, 6, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
