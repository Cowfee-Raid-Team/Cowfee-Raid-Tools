// Timeline: the pop-out's Healer CDs view (CRT_Modules/Timeline/HealerView.lua drawn by CRT_Modules/Timeline/View.lua):
// the rows from the roster's roles (a role set by hand wins), the rows a raid note assignment adds, the major
// cooldowns per spec or class, the casts from the note lines, the cooldown bands and the red edge, dragging a cast
// (its note line is rewritten), double-clicking a row (a cast is added), and the hint line.
// Usage: node run_timeline_healers.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const W = process.argv[2];
const FILES = [
  'CRT_Core/UI/Panel.lua', 'CRT_Core/UI/Controls.lua', 'CRT_Modules/Groups/Data.lua', 'CRT_Modules/Alerts/Roster.lua',
  'CRT_Modules/Timeline/Data.lua', 'CRT_Modules/Timeline/Database.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/Lanes.lua',
  'CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Dev/Tests/SamplePack/GameIDs.lua',
  'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua',
  'CRT_Modules/Alerts/Reminders.lua', 'CRT_Modules/Alerts/CooldownData.lua', 'CRT_Modules/Alerts/Cooldowns.lua',
  'CRT_Modules/Timeline/AbilityTip.lua', 'CRT_Modules/Timeline/View.lua', 'CRT_Modules/Timeline/HealerView.lua',
  'CRT_Core/Sound/Engine.lua', 'CRT_Modules/Alerts/Draft.lua', 'CRT_Modules/Alerts/Saved.lua', 'CRT_Modules/Timeline/Undo.lua',
];
const harness = require('./theme_stub')(W) + `
local src = { ... }
local FILES = ${'{'}${FILES.map(f => JSON.stringify(f)).join(', ')}${'}'}
local function run(name, CRT)
  for i, f in ipairs(FILES) do if f == name then return assert(load(src[i], f))("CowfeeRaidTools", CRT) end end
  error("no file " .. name)
end
local function mock(kind)
  local m = { shown = true, kind = kind, children = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" then return function() return mock("FontString") end end
    if k == "CreateTexture" then return function() return mock("Texture") end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "SetTexture" then return function(self, s) rawset(self, "texture", s) end end
    if k == "Show" then return function(self) rawset(self, "shown", true) end end
    if k == "Hide" then return function(self) rawset(self, "shown", false) end end
    if k == "SetShown" then return function(self, on) rawset(self, "shown", on and true or false) end end
    if k == "SetFrameLevel" then return function(self, v) rawset(self, "level", v) end end
    if k == "GetFrameLevel" then return function(self) return rawget(self, "level") or 1 end end
    if k == "GetHighlightTexture" then return function(self) local t = rawget(self, "hl") if not t then t = mock("Texture") rawset(self, "hl", t) end return t end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "IsVisible" then return function(self) return rawget(self, "shown") end end
    if k == "GetWidth" then return function(self) return rawget(self, "w") or 600 end end
    if k == "GetHeight" then return function(self) return rawget(self, "h") or 300 end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, a, rel, b, x, y) rawset(self, "pt", { a, rel, b, x, y }) end end
    if k == "ClearAllPoints" then return function(self) rawset(self, "pt", nil) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetTextColor" then return function(self, r, g, b) rawset(self, "tcolor", { r, g, b }) end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "GetUnboundedStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "GetLeft" then return function() return 100 end end
    if k == "GetTop" then return function() return 500 end end
    if k == "GetEffectiveScale" then return function() return 1 end end
    if k == "IsMouseOver" then return function() return false end end
    if k == "SetHorizontalScroll" then return function(self, v) rawset(self, "hs", v) end end
    if k == "GetHorizontalScroll" then return function(self) return rawget(self, "hs") or 0 end end
    if k == "SetVerticalScroll" then return function(self, v) rawset(self, "vs", v) end end
    if k == "GetVerticalScroll" then return function(self) return rawget(self, "vs") or 0 end end
    if k == "GetVerticalScrollRange" then return function() return 0 end end
    if k == "GetValue" then return function(self) return rawget(self, "value") or 0 end end
    if k == "SetValue" then return function(self, v) rawset(self, "value", v) end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    if k == "GetScript" then return function(self, name) return rawget(self, name) end end
    if k == "SetChecked" then return function(self, v) rawset(self, "checked", v) end end
    return function() end end })
end
function CreateFrame(kind, name, parent)
  local f = mock(kind)
  rawset(f, "parent", parent)
  if kind == "DropdownButton" then rawset(f, "SetupMenu", function(self, gen) rawset(self, "gen", gen) end) end
  return f
end
UIParent = mock("Frame")
local tip = {}
GameTooltip = mock("GameTooltip")
GameTooltip.SetOwner = function() for i = #tip, 1, -1 do tip[i] = nil end end
GameTooltip.SetText = function(_, s) tip[#tip + 1] = s end
GameTooltip.AddLine = function(_, s) tip[#tip + 1] = s end
GameTooltip.SetSpellByID = function(_, id) tip[#tip + 1] = "spell:" .. id end
local cx, cy, now = 400, 300, 100
function GetCursorPosition() return cx, cy end
function GetTime() return now end
local mouseDown = true
function IsMouseButtonDown() return mouseDown end
function IsShiftKeyDown() return false end
function IsAltKeyDown() return false end
function IsControlKeyDown() return false end
function date() return "2026-10-24 12:00" end
function time() return 1000 end
function InCombatLockdown() return false end
function issecretvalue(v) return false end
function geterrorhandler() return function(e) error(e) end end
function GetNumClasses() return 0 end
local group = { raid = true, party = true, leader = true, assist = false }
function IsInRaid() return group.raid end
function IsInGroup() return group.party or group.raid end
function UnitIsGroupLeader(unit) return unit == "player" and group.leader end
function UnitIsGroupAssistant(unit) return unit == "player" and group.assist end
-- timers wait until flush() runs them
local timers = {}
C_Timer = { After = function(_, fn) timers[#timers + 1] = fn end }
local function flush() local list = timers timers = {} for _, fn in ipairs(list) do fn() end return #list end
-- the live raid: { name (no realm on your own), class file, role }
local liveRoster = {}
function GetNumGroupMembers() return #liveRoster end
function GetRaidRosterInfo(i) local p = liveRoster[i] if p then return p[1], nil, 1, nil, nil, p[2] end end
function UnitGroupRolesAssigned(unit) local i = tonumber(tostring(unit):match("^raid(%d+)$")) local p = i and liveRoster[i] return p and p[3] or "NONE" end
function UnitIsUnit() return false end
function GetNumSubgroupMembers() return 0 end
function UnitFullName() return "Me", "Home" end
function UnitName() return "Me" end
function GetNormalizedRealmName() return "Home" end
function Ambiguate(key) return (key:gsub("%-Home$", "")) end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function UnitClass() return "Paladin", "PALADIN" end
-- you play Holy (65)
local mySpec = 65
C_SpecializationInfo = { GetSpecialization = function() return 1 end, GetSpecializationInfo = function() return mySpec, "Spec" end }
function GetSpecializationInfoByID(id) local names = { [65] = "Holy", [257] = "Holy", [264] = "Restoration" } return id, names[id] end
LOCALIZED_CLASS_NAMES_MALE = { SHAMAN = "Shaman", PRIEST = "Priest", DRUID = "Druid", WARRIOR = "Warrior", PALADIN = "Paladin", DEATHKNIGHT = "Death Knight" }
C_Spell = {
  GetSpellName = function(id) return "Spell" .. id end,
  GetSpellTexture = function(id) return "tex" .. id end,
}
RAID_CLASS_COLORS = { PRIEST = { r = 1, g = 1, b = 1 }, SHAMAN = { r = 0, g = 0.44, b = 0.87 }, PALADIN = { r = 0.96, g = 0.55, b = 0.73 },
  WARRIOR = { r = 0.78, g = 0.61, b = 0.43 }, DRUID = { r = 1, g = 0.49, b = 0.04 } }
CRTFontSmall, CRTFontNormal, CRTFontHighlight = {}, {}, {}
CANCEL, ACCEPT = "Cancel", "Accept"
local menus = {}
local function description(kind, text, fn)
  local d = { kind = kind, text = text, fn = fn, items = {} }
  function d:CreateTitle(s) local x = description("title", s) table.insert(self.items, x) return x end
  function d:CreateButton(s, f) local x = description("button", s, f) table.insert(self.items, x) return x end
  function d:CreateDivider() local x = description("divider") table.insert(self.items, x) return x end
  function d:CreateRadio(s, isSel, set, key) local x = description("radio", s, function() set(key) end) table.insert(self.items, x) return x end
  function d:SetScrollMode() end
  function d:SetEnabled() end
  return d
end
MenuUtil = { CreateContextMenu = function(owner, gen) local root = description("root") gen(owner, root) menus[#menus + 1] = root return {} end }
StaticPopupDialogs = {}
local CRT = {
  db = { timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3,
    overlayOn = false, hideEmpty = true, nextId = 1 },
    notes = { list = {}, nextId = 1, alert = {}, window = {} },
    groups = { presets = {}, nextId = 1, working = {} }, classCache = {}, roleCache = {}, ui = {} },
  PALETTE = { accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, surface = { 0.165, 0.122, 0.098 }, text = { 0.95, 0.90, 0.84 } },
}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
CRT.TimelineJournal = { ResolveID = function(_, k, r) if type(k) == "number" then return k end if r and type(r.encounterID) == "number" then return r.encounterID end end,
  Rows = function() return {} end, IsHidden = function() return false end }
CRT.db.alerts = { bars = {}, reminders = {}, phases = {}, overrides = {}, nextId = 1, saved = {}, nextSavedId = 1, starters = {}, cooldownFilter = "mine" }
run("CRT_Core/UI/Panel.lua", CRT)
CRT_TOOLTIP(CRT)
run("CRT_Core/UI/Controls.lua", CRT)
run("CRT_Modules/Groups/Data.lua", CRT)
run("CRT_Modules/Alerts/Roster.lua", CRT)
run("CRT_Modules/Timeline/Data.lua", CRT)
run("CRT_Modules/Timeline/Database.lua", CRT)
run("CRT_Modules/Timeline/Reference.lua", CRT)
run("CRT_Modules/Timeline/Lanes.lua", CRT)
do
  local real, handler = CreateFrame, nil
  CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
  run("CRT_Data/Bosses/Registry.lua", CRT)
  CreateFrame = real
  run("CRT_Dev/Tests/SamplePack/Season.lua", CRT)
  run("CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua", CRT)
  run("CRT_Dev/Tests/SamplePack/GameIDs.lua", CRT) -- the cooldowns (Bosses:Cooldowns()): the sample pack, never the shipped one
  handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
end
run("CRT_Modules/Alerts/Rules.lua", CRT)
run("CRT_Modules/Alerts/Engine.lua", CRT)
run("CRT_Modules/Notes/Parse.lua", CRT)
run("CRT_Modules/Notes/Data.lua", CRT)
run("CRT_Modules/Alerts/Reminders.lua", CRT)
run("CRT_Modules/Alerts/CooldownData.lua", CRT)
run("CRT_Modules/Alerts/Cooldowns.lua", CRT)
run("CRT_Modules/Timeline/AbilityTip.lua", CRT)
run("CRT_Modules/Timeline/View.lua", CRT)
run("CRT_Modules/Timeline/HealerView.lua", CRT)
run("CRT_Core/Sound/Engine.lua", CRT)
run("CRT_Modules/Alerts/Draft.lua", CRT)
run("CRT_Modules/Alerts/Saved.lua", CRT)
run("CRT_Modules/Timeline/Undo.lua", CRT)
CRT.AlertEditor = { Open = function() end, OpenNote = function() end, Frame = function() return nil end }

local fails = 0
local function check(ok, what) if ok then print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local View, HV, G, N, R = CRT.TimelineView, CRT.TimelineHealerView, CRT.Groups, CRT.Notes, CRT.AlertReminders
check(HV ~= nil, "CRT.TimelineHealerView is loaded")

-- the boss: 5:00 long, phase 2 at 2:00; Surge is raid damage, Plain is not
local ref = assert(CRT.TimelineReference.Parse("Boss: Nek\\nEncounter: 3001\\nLength: 5:00\\nPhase: P1 0:00\\nPhase: P2 2:00\\nSurge [spell 4242] (type raid): 0:20, 1:40\\nPlain: 0:30"), "ref parses")
local function setLayout(names) local w = {} for i = 1, 40 do w[i] = names[i] or "" end
  CRT.db.groups.presets = { { id = 1, name = "Main", slots = w } } CRT.db.groups.active = 1 end
-- the layout: Halo (a live priest healer), Rain (a live shaman playing damage), Tanky (a live warrior tank),
-- Off (a druid not in the group: no role) and you (a paladin healer, Holy)
setLayout({ "Halo-Home", "Rain-Home", "Tanky-Home", "Off-Home", "Me-Home", "Zorp-Elsewhere" }) -- Zorp: never seen, class unknown
liveRoster = { { "Halo", "PRIEST", "HEALER" }, { "Rain", "SHAMAN", "DAMAGER" }, { "Tanky", "WARRIOR", "TANK" }, { "Me", "PALADIN", "HEALER" } }
CRT.db.classCache["off-home"] = "DRUID"
local NOTE = "EncounterID:3001;Name:Nek\\n"
local function setNote(lines)
  CRT.db.notes.list = { [1] = { raw = NOTE .. table.concat(lines, "\\n"), encounterID = 3001, name = "Nek" } }
  CRT.db.notes.nextId = 2
end
setNote({})
local function newView()
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  v:SetMode("healers")
  return v
end
local function labels(v) local out = {} for i, l in ipairs(v.lanes) do out[i] = l.label end return table.concat(out, "|") end
local function laneIndex(v, key) for i, l in ipairs(v.lanes) do if l.key == key then return i end end end
local function flagsOn(v, row) local out = {} for _, f in ipairs(v.flags) do if f:IsShown() and f.mark.row == row then out[#out + 1] = f end end return out end
local function screenX(v, t) return 100 - v.hscroll:GetHorizontalScroll() + t * v.trackW / 300 end
local function laneY(i) return 500 - (i - 1) * 30 - 15 end
local DOT = " " .. string.char(194, 183) .. " "

-- The major cooldowns per spec, else per class -------------------------------------------------------------
do
  local function ids(list) local out = {} for i, e in ipairs(list) do out[i] = e.spellID end return table.concat(out, ",") end
  check(ids(HV.Majors("PRIEST", 257)) == "64843,200183", "Holy Priest: Divine Hymn, Apotheosis: " .. ids(HV.Majors("PRIEST", 257)))
  check(ids(HV.Majors("PRIEST", 256)) == "62618,421453", "Discipline: Barrier, Ultimate Penitence")
  check(ids(HV.Majors("PRIEST")) == "64843,200183,62618,421453", "no spec: every major priest cooldown")
  check(ids(HV.Majors("PRIEST", 258)) == "64843,200183,62618,421453", "a spec with none (Shadow): the class's")
  check(#HV.Majors("WARRIOR") == 0, "a class with no healer spec has none")
  -- the list is the season's game IDs (Bosses:Cooldowns()): a season without them has none
  local B = CRT.Bosses
  B.seasons["sample"].current = false
  B:Season({ key = "plain", name = "Plain", order = 2, current = true })
  check(B:Cooldowns() == nil and #HV.Majors("PRIEST") == 0, "a season without game IDs: no major cooldowns")
  B.seasons["plain"] = nil
  B.seasons["sample"].current = true
  check(#HV.Majors("PRIEST") == 4, "the sample season's again")
  check(HV.Listed(97462) and HV.Listed(97462).class == "WARRIOR" and HV.Listed(1) == nil, "Listed finds any listed cooldown")
end

-- The rows: healers from the roles, a role set by hand winning -------------------------------------------------
do
  local v = newView()
  check(v:Mode() == "healers", "the view is in Healer CDs")
  check(labels(v) == "Raid damage|Halo|Spell64843|Spell200183|Spell62618|Spell421453|Me" .. DOT .. "Holy|Spell31821|Spell31884|Spell216331",
    "Raid damage, then each healer and their majors (yours by your spec): " .. labels(v))
  local halo = v.lanes[laneIndex(v, "healers:halo-home")]
  check(halo.kind == "healer" and halo.class == "PRIEST", "a healer's row is in their class")
  local l = v.labels[2]
  check(l.text:GetText() == "Halo" and l.text.tcolor[1] == 1 and l.check.shown == false, "the name in class colour, no show tick")
  -- the raid damage row: Surge's casts only, with its icon
  local raid = v.lanes[1]
  check(raid.kind == "raid" and #raid.marks == 2 and raid.marks[1].t == 20 and raid.marks[2].t == 100, "Raid damage holds the raid rows' casts")
  local icon
  for _, b in ipairs(v.icons) do if b:IsShown() and b.lane == raid then icon = b end end
  check(icon and icon.tex.texture == "tex4242", "its icons are the ability's: " .. tostring(icon and icon.tex.texture))
  icon.OnEnter(icon)
  check(table.concat(tip, "|"):find("Planned at", 1, true), "an icon's tooltip is the ability's own: " .. table.concat(tip, "|"))
  -- a role set by hand wins: Rain as healer, Halo as damage
  G:SetHandRole("Rain-Home", "HEALER")
  G:SetHandRole("Halo-Home", "DAMAGER")
  v:Refresh()
  check(labels(v) == "Raid damage|Me" .. DOT .. "Holy|Spell31821|Spell31884|Spell216331|Rain|Spell108280|Spell98008|Spell114052",
    "the role set by hand wins both ways: " .. labels(v))
  G:SetHandRole("Halo-Home", nil)
  G:SetHandRole("Rain-Home", nil)
  -- Off is not in the group and has no role set: left out until set by hand
  G:SetHandRole("Off-Home", "HEALER")
  v:Refresh()
  check(laneIndex(v, "healers:off-home") ~= nil and labels(v):find("Spell740", 1, true), "out of the group, set by hand: shown with the class's majors")
  G:SetHandRole("Off-Home", nil)
  v:Refresh()
  check(laneIndex(v, "healers:off-home") == nil, "out of the group, no role: left out")
  -- a role set by hand redraws an open Healer CDs view by itself, once per burst of changes
  flush()
  G:SetHandRole("Rain-Home", "HEALER")
  G:SetHandRole("Rain-Home", "HEALER")
  check(laneIndex(v, "healers:rain-home") == nil and #timers == 1, "one redraw waits for the burst to end")
  flush()
  check(laneIndex(v, "healers:rain-home:98008") ~= nil, "Set role redraws the open view")
  G:SetHandRole("Rain-Home", nil)
  flush()
  check(laneIndex(v, "healers:rain-home") == nil, "and again when it is cleared")
  -- the group changing redraws it too (GROUP_ROSTER_UPDATE, PLAYER_ROLES_ASSIGNED)
  liveRoster[2][3] = "HEALER"
  HV.events.OnEvent(HV.events, "PLAYER_ROLES_ASSIGNED")
  flush()
  check(laneIndex(v, "healers:rain-home") ~= nil, "a role the game gives redraws it")
  liveRoster[2][3] = "DAMAGER"
  HV.events.OnEvent(HV.events, "GROUP_ROSTER_UPDATE")
  flush()
  check(laneIndex(v, "healers:rain-home") == nil, "so does a roster change")
  -- a docked view (not in Healer CDs) is left alone
  v:SetMode(nil)
  local drawn = 0
  local realRefresh = v.Refresh
  rawset(v, "Refresh", function(self) drawn = drawn + 1 return realRefresh(self) end)
  G:SetHandRole("Rain-Home", "HEALER")
  flush()
  check(drawn == 0, "a view on Abilities is not redrawn")
  rawset(v, "Refresh", nil)
  G:SetHandRole("Rain-Home", nil)
  flush()
  v:SetMode("healers")
  -- a healer set by hand whose class nobody knows: their name row with a muted hint
  G:SetHandRole("Zorp-Elsewhere", "HEALER")
  flush()
  local zi = laneIndex(v, "healers:zorp-elsewhere")
  check(zi ~= nil and v.lanes[zi].note == HV.TEXT.classUnknown and v.lanes[zi + 1] == nil, "a class-unknown healer gets a name row, no cooldowns")
  local hint
  for _, fs in ipairs(v.hvNotes or {}) do if fs:IsShown() and fs.text == HV.TEXT.classUnknown then hint = fs end end
  check(hint and hint.pt[5] == -(zi - 1) * 30 - 15, "with the hint on its row")
  G:SetHandRole("Zorp-Elsewhere", nil)
  flush()
  -- a role the game hides is not compared, and counts as unknown
  local realRole = UnitGroupRolesAssigned
  local SECRET = {}
  issecretvalue = function(x) return x == SECRET end
  UnitGroupRolesAssigned = function() return SECRET end
  v:Refresh()
  check(labels(v) == "Raid damage", "a secret role: nobody is a healer: " .. labels(v))
  check(v.unknownText:GetText() == HV.TEXT.noHealers, "and the hint line says how to set one")
  UnitGroupRolesAssigned = realRole
  issecretvalue = function() return false end
  v:Refresh()
  check(v.unknownText:GetText() == HV.TEXT.hint, "the hint line: " .. tostring(v.unknownText:GetText()))
  check(#HV.TEXT.hint * 6 <= 760 - 16, "the hint fits the pop-out at its smallest")
end

-- The casts: the raid note's cooldown lines, on their player's row ------------------------------------------------
do
  setNote({
    "time:20;ph:1;tag:Halo;spellid:64843;",          -- Halo's Divine Hymn at 0:20
    "time:100;ph:1;tag:Halo;spellid:64843;",         -- again at 1:40: inside its 3:00 cooldown
    "time:10;ph:2;tag:Halo;spellid:200183;",         -- Apotheosis at 2:10 (phase 2 + 10)
    "time:30;ph:1;tag:Tanky;spellid:97462;",         -- the tank's Rallying Cry: their rows show
    "time:50;ph:1;tag:Ghost;spellid:740;",           -- someone not on the roster: a druid by the spell
    "time:60;ph:1;tag:everyone;spellid:64843;",      -- for everyone: no player's row
    "time:70;ph:1;tag:Halo;spellid:4242;",           -- not a listed cooldown
  })
  local v = newView()
  local hymn = laneIndex(v, "healers:halo-home:64843")
  local apo = laneIndex(v, "healers:halo-home:200183")
  local f = flagsOn(v, hymn)
  table.sort(f, function(a, b) return a.mark.t < b.mark.t end)
  check(#f == 2 and f[1].mark.t == 20 and f[2].mark.t == 100, "Halo's two Divine Hymns on its row")
  check(f[1].icon.texture == "tex64843" and f[1].icon.shown, "each with the spell's icon")
  local fa = flagsOn(v, apo)
  check(#fa == 1 and fa[1].mark.t == 130, "phase 2 + 10 is placed by the phase lines: " .. tostring(fa[1] and fa[1].mark.t))
  -- the note's assignments add rows
  check(labels(v):find("Tanky|Spell97462", 1, true) and labels(v):find("Ghost|Spell740", 1, true), "a note assignment adds that player's rows: " .. labels(v))
  local ghost = v.lanes[laneIndex(v, "healers:ghost")]
  check(ghost and ghost.class == "DRUID", "a name off the roster takes its cooldown's class")
  local shown = 0
  for _, x in ipairs(v.flags) do if x:IsShown() then shown = shown + 1 end end
  check(shown == 5, "only cooldown lines for a player are drawn: " .. shown)
  -- bands: one from each cast for its cooldown, cut at the end; a line where it is up again
  local bands = {}
  for _, t in ipairs(v.hvBands or {}) do if t:IsShown() then bands[#bands + 1] = t end end
  local first
  for _, t in ipairs(bands) do if t.pt and t.pt[4] == 20 * v.trackW / 300 and t.w > 2 then first = t end end
  check(first and math.abs(first.w - 180 * v.trackW / 300) < 0.01 and first.pt[5] == -(hymn - 1) * 30 - 4, "a band for the 3:00 cooldown on the cast's row")
  check(first.color[4] < 1, "see-through")
  -- red edge: the second Hymn is cast inside the first one's cooldown
  check(f[2].mark.tooSoon == true and not f[1].mark.tooSoon, "the second cast is too soon")
  check(f[2].edge.color[1] > 0.8 and f[2].edge.color[2] < 0.4, "with a red edge")
  check(f[1].edge.color[1] == CRT.PALETTE.accent[1], "the first keeps its accent edge")
  -- the cooldown row's tooltip is the spell's, with its length
  local lab = v.labels[hymn]
  lab.OnEnter(lab)
  local all = table.concat(tip, "|")
  check(all:find("spell:64843", 1, true) and all:find("Cooldown 3:00", 1, true), "a cooldown row's tooltip: " .. all)
end

-- Drag a cast: its note line is rewritten -----------------------------------------------------------------------------
do
  -- the note written straight into the saved data above is where Undo starts from (as if received from the raid)
  CRT.TimelineUndo:Quietly(function() end)
  local v = newView()
  local hymn = laneIndex(v, "healers:halo-home:64843")
  local f
  for _, x in ipairs(flagsOn(v, hymn)) do if x.mark.t == 20 then f = x end end
  cx, cy = screenX(v, 20), 300
  f.OnMouseDown(f, "LeftButton")
  cx = screenX(v, 45)
  v.frame.OnUpdate(v.frame)
  f.OnMouseUp(f, "LeftButton")
  local t = N:TimerAt(1, 2)
  check(t and t.time == 45 and t.ph == 1 and t.tags[1] == "Halo" and t.spellId == 64843, "dragging moves the note line: " .. tostring(t and t.time))
  local moved
  for _, x in ipairs(flagsOn(v, hymn)) do if x.mark.t == 45 then moved = x end end
  check(moved ~= nil, "the flag redraws at the new time")
  -- Ctrl+Z puts the line back
  now = now + 5
  CRT.TimelineUndo:Undo()
  t = N:TimerAt(1, 2)
  check(t and t.time == 20 and t.tags[1] == "Halo", "Undo puts the line back: " .. tostring(t and t.time))
  local back
  for _, x in ipairs(flagsOn(v, hymn)) do if x.mark.t == 20 then back = x end end
  check(back ~= nil, "and its flag")
  -- not the raid leader or an assistant: a raid note line can't be dragged
  group.leader = false
  now = now + 5
  cx, cy = screenX(v, 20), 300
  back.OnMouseDown(back, "LeftButton")
  cx = screenX(v, 70)
  v.frame.OnUpdate(v.frame)
  back.OnMouseUp(back, "LeftButton")
  t = N:TimerAt(1, 2)
  check(t and t.time == 20, "a drag by anyone else leaves the line: " .. tostring(t and t.time))
  group.leader = true
end

-- Double-click a cooldown row: a cast for that player at that time -----------------------------------------------------------
do
  local v = newView()
  local apo = laneIndex(v, "healers:halo-home:200183")
  local hs = v.hscroll
  local before = N:RawLines(1)
  local function dbl(t, row)
    cx, cy = screenX(v, t), laneY(row)
    now = now + 5
    hs.OnMouseDown(hs, "LeftButton") hs.OnMouseUp(hs, "LeftButton")
    now = now + 0.1
    hs.OnMouseDown(hs, "LeftButton") hs.OnMouseUp(hs, "LeftButton")
  end
  dbl(60, apo)
  local lines = N:RawLines(1)
  local added = N:TimerAt(1, #lines)
  check(#lines == #before + 1 and added and added.tags[1] == "Halo" and added.spellId == 200183 and added.time == 60, "a raid note line for Halo's Apotheosis at 1:00: " .. tostring(added and added.time))
  check(printed[#printed]:find("for Halo", 1, true), "the chat line says for whom: " .. tostring(printed[#printed]))
  -- not the raid leader or an assistant: nothing on another player's row, and chat says why
  group.leader = false
  dbl(80, apo)
  check(#N:RawLines(1) == #lines and #R:List(3001) == 0, "anyone else: nothing on another player's row")
  check(printed[#printed] == HV.TEXT.notLead, "and why: " .. tostring(printed[#printed]))
  -- on your own row: one of your reminders, as a dropped cooldown
  dbl(80, laneIndex(v, "healers:me-home:31821"))
  check(#N:RawLines(1) == #lines and #R:List(3001) == 1, "your own row: one of your reminders, no note line")
  check(printed[#printed]:find("for you", 1, true), "for you: " .. tostring(printed[#printed]))
  group.leader = true
  -- a player's name row does nothing
  local n = #N:RawLines(1)
  dbl(90, laneIndex(v, "healers:halo-home"))
  check(#N:RawLines(1) == n and #R:List(3001) == 1, "a name row places nothing")
  CRT.db.alerts.reminders = {}
end

-- Back to the ability timeline ------------------------------------------------------------------------------------------
do
  local v = newView()
  v:SetMode(nil)
  check(v:Mode() == nil and v.lanes[1].kind ~= "raid" and laneIndex(v, "healers:halo-home") == nil, "SetMode(nil) draws the ability rows again")
  local any = false
  for _, t in ipairs(v.hvBands or {}) do if t:IsShown() then any = true end end
  check(not any, "and no cooldown bands")
  -- a pull with no ability timeline: rows still come from the roster
  local p = View.Create(mock("Frame"))
  p:SetData({ id = 1, encounterID = 3001, length = 200, casts = {}, deaths = {} }, 3001, nil, "Nek")
  p:SetMode("healers")
  check(p.lanes[1].kind == "raid" and laneIndex(p, "healers:halo-home") ~= nil, "a recorded pull shows the healers too")
end

if fails > 0 then error(fails .. " healer view checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, FILES.length + 4); // more files than the stack holds by default
for (const f of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, f), 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
