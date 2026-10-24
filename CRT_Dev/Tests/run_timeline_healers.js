// Timeline: the pop-out's Healer CDs view (CRT_Modules/Timeline/HealerView.lua drawn by CRT_Modules/Timeline/View.lua):
// every ability row on top, the rows from the roster's roles (a role set by hand wins), the rows a raid note
// assignment adds, the major cooldowns per spec or class, the casts from the note lines, the cooldown bands and the
// red edge, dragging a cast (its note line is rewritten), double-clicking a row (a cast is added), and the hint line.
// Then your own casts for a non-lead (CRT_Modules/Notes/Shifts.lua): moved for you only, the others locked, the alerts'
// note block using your time, Undo, the bar (Timeline/HealerPanel.lua) with Reset mine, a changed line dropping your
// time; and the proposals to the raid lead (CRT_Modules/Notes/Proposals.lua): the message, strict reading, sending,
// Accept, Decline, stale changes and auto-accept.
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
  'CRT_Modules/Notes/Engine.lua', 'CRT_Modules/Notes/Shifts.lua', 'CRT_Modules/Notes/Proposals.lua', 'CRT_Modules/Timeline/HealerPanel.lua',
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
    if k == "GetChecked" then return function(self) return rawget(self, "checked") end end
    if k == "SetEnabled" then return function(self, v) rawset(self, "enabled", v and true or false) end end
    if k == "IsEnabled" then return function(self) return rawget(self, "enabled") ~= false end end
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
local inCombat = false
function InCombatLockdown() return inCombat end
hooksecurefunc = function() end
function issecretvalue(v) return false end
function geterrorhandler() return function(e) error(e) end end
function GetNumClasses() return 0 end
local group = { raid = true, party = true, leader = true, assist = false }
function IsInRaid() return group.raid end
LE_PARTY_CATEGORY_INSTANCE = 2
function IsInGroup(category) if category == LE_PARTY_CATEGORY_INSTANCE then return false end return group.party or group.raid end
-- addon messages: what was sent, and the game holding them (InChatMessagingLockdown)
local sent, chatLocked = {}, false
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, InChatMessagingLockdown = function() return chatLocked end,
  SendAddonMessage = function(prefix, text, ch) sent[#sent + 1] = { prefix, text, ch } return 0 end }
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
run("CRT_Modules/Notes/Engine.lua", CRT)
run("CRT_Modules/Notes/Shifts.lua", CRT)
run("CRT_Modules/Notes/Proposals.lua", CRT)
run("CRT_Modules/Alerts/Reminders.lua", CRT)
run("CRT_Modules/Alerts/CooldownData.lua", CRT)
run("CRT_Modules/Alerts/Cooldowns.lua", CRT)
run("CRT_Modules/Timeline/AbilityTip.lua", CRT)
run("CRT_Modules/Timeline/View.lua", CRT)
run("CRT_Modules/Timeline/HealerView.lua", CRT)
run("CRT_Modules/Timeline/HealerPanel.lua", CRT)
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
-- the rows the Abilities layout shows (without its Notes and Personal notes rows), as Healer CDs shows them on top
local function abilityLabels()
  local a = View.Create(mock("Frame"))
  a:SetData({ reference = ref }, 3001, nil, "Nek")
  local out = {}
  for _, l in ipairs(a.lanes) do if l.kind ~= "notes" and l.kind ~= "personal" then out[#out + 1] = l.label end end
  return table.concat(out, "|"), #out
end
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
  local ABIL, nAbil = abilityLabels()
  check(nAbil >= 2 and ABIL:find("Surge", 1, true) and ABIL:find("Plain", 1, true), "the Abilities layout's rows: " .. ABIL)
  check(labels(v) == ABIL .. "|Halo|Spell64843|Spell200183|Spell62618|Spell421453|Me" .. DOT .. "Holy|Spell31821|Spell31884|Spell216331",
    "every ability row, then each healer and their majors (yours by your spec): " .. labels(v))
  check(not labels(v):find("Raid damage", 1, true), "no Raid damage summary row")
  local halo = v.lanes[laneIndex(v, "healers:halo-home")]
  check(halo.kind == "healer" and halo.class == "PRIEST", "a healer's row is in their class")
  local l = v.labels[laneIndex(v, "healers:halo-home")]
  check(l.text:GetText() == "Halo" and l.text.tcolor[1] == 1 and l.check.shown == false, "the name in class colour, no show tick")
  -- the ability rows are the Abilities layout's own: Surge with its casts, icons, type colour and show tick
  local surge
  for i, lane in ipairs(v.lanes) do if lane.label == "Surge" then surge = i end end
  local raid = v.lanes[surge]
  check(raid.kind == "reference" and #raid.marks == 2 and raid.marks[1].t == 20 and raid.marks[2].t == 100, "Surge keeps its own casts")
  check(raid.color ~= nil and v.labels[surge].check.shown == true, "with its type's colour and its show tick")
  local icon
  for _, b in ipairs(v.icons) do if b:IsShown() and b.lane == raid then icon = b end end
  check(icon and icon.tex.texture == "tex4242", "its icons are the ability's: " .. tostring(icon and icon.tex.texture))
  icon.OnEnter(icon)
  check(table.concat(tip, "|"):find("Planned at", 1, true), "an icon's tooltip is the ability's own: " .. table.concat(tip, "|"))
  check(v.phaseLines[1] and v.phaseLines[1]:IsShown(), "the phase lines are drawn too")
  -- a role set by hand wins: Rain as healer, Halo as damage
  G:SetHandRole("Rain-Home", "HEALER")
  G:SetHandRole("Halo-Home", "DAMAGER")
  v:Refresh()
  check(labels(v) == ABIL .. "|Me" .. DOT .. "Holy|Spell31821|Spell31884|Spell216331|Rain|Spell108280|Spell98008|Spell114052",
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
  check(labels(v) == ABIL, "a secret role: nobody is a healer, the ability rows stay: " .. labels(v))
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
  check(shown == 7, "the cooldown lines for a player, the boss ability's line on its row and the everyone line on Notes: " .. shown)
  local notesRow = laneIndex(v, "notes")
  check(notesRow and notesRow < laneIndex(v, "healers:halo-home") and #flagsOn(v, notesRow) == 1 and flagsOn(v, notesRow)[1].mark.t == 60,
    "the Notes row stays under the ability rows, as Abilities shows it, with the line no healer row took")
  local surgeRow
  for i, lane in ipairs(v.lanes) do if lane.label == "Surge" then surgeRow = i end end
  check(#flagsOn(v, surgeRow) == 1 and flagsOn(v, surgeRow)[1].mark.t == 70, "the Surge line on the Surge row, as Abilities draws it")
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
  check(v:Mode() == nil and laneIndex(v, "healers:halo-home") == nil and laneIndex(v, "personal") ~= nil, "SetMode(nil) draws the ability rows again")
  local any = false
  for _, t in ipairs(v.hvBands or {}) do if t:IsShown() then any = true end end
  check(not any, "and no cooldown bands")
  -- a pull with no ability timeline: rows still come from the roster
  local p = View.Create(mock("Frame"))
  p:SetData({ id = 1, encounterID = 3001, length = 200, casts = {}, deaths = {} }, 3001, nil, "Nek")
  p:SetMode("healers")
  check(laneIndex(p, "healers:halo-home") ~= nil, "a recorded pull shows the healers too")
end

-- Your own casts, for a healer who may not change the raid note ----------------------------------------------------
local Shifts, P = CRT.NoteShifts, CRT.NoteProposals
local OWN_LINES = {
  "time:20;ph:1;tag:Halo;spellid:64843;", -- line 2: Halo's Divine Hymn at 0:20
  "time:30;ph:1;tag:Me;spellid:31821;",   -- line 3: your Aura Mastery at 0:30
  "time:10;ph:2;tag:Me;spellid:31884;",   -- line 4: your Avenging Wrath at 2:10
}
local function drag(v, f, from, to)
  cx, cy = screenX(v, from), 300
  f.OnMouseDown(f, "LeftButton")
  cx = screenX(v, to)
  v.frame.OnUpdate(v.frame)
  f.OnMouseUp(f, "LeftButton")
end
local function item(spellID)
  for _, it in ipairs(CRT.Alerts.blocks.note.Entries({ encounterID = 3001 })) do
    if it.spellID == spellID then return it end
  end
end
local function shownLabels(v)
  local out = {}
  for _, fs in ipairs(v.hvMoveLabels or {}) do if fs:IsShown() then out[#out + 1] = fs.text end end
  return table.concat(out, "|")
end
do
  CRT.db.notes.personalShifts = {}
  setNote(OWN_LINES)
  CRT.TimelineUndo:Quietly(function() end)
  group.leader = false
  now = now + 5
  local v = newView()
  local aura = laneIndex(v, "healers:me-home:31821")
  local hymn = laneIndex(v, "healers:halo-home:64843")
  check(v.lanes[laneIndex(v, "healers:me-home")].label == "Me" .. DOT .. "Holy" .. DOT .. HV.TEXT.yours, "your name row says yours: " .. v.lanes[laneIndex(v, "healers:me-home")].label)
  check(v.lanes[laneIndex(v, "healers:halo-home")].label == "Halo" .. DOT .. HV.TEXT.locked, "another healer's says locked")
  local name = v.labels[laneIndex(v, "healers:halo-home")]
  name.OnEnter(name)
  check(table.concat(tip, "|"):find("Only Halo, the raid leader or an assistant", 1, true), "its tooltip says who can move them: " .. table.concat(tip, "|"))
  local hf = flagsOn(v, hymn)[1]
  hf.OnEnter(hf)
  check(table.concat(tip, "|"):find("Only Halo can move this", 1, true), "so does a locked cast's: " .. table.concat(tip, "|"))
  -- your own cast: moved for you, the raid note as it was
  local raw3 = N:RawLines(1)[3]
  drag(v, flagsOn(v, aura)[1], 30, 50)
  local t = N:TimerAt(1, 3)
  check(t and t.time == 30 and N:RawLines(1)[3] == raw3, "the raid note keeps your line at 0:30")
  local s = Shifts:Find(1, 3)
  check(s and s.ph == 1 and s.t == 50 and s.raw == raw3 and s.occ == 1 and s.who == "me-home" and s.spellID == 31821, "your time is saved by note and line, as yours: " .. tostring(s and s.t))
  check(CRT.db.notes.personalShifts[1]["me-home|" .. Shifts.Key(raw3) .. "#1"] == s, "under your character, the line's text and which copy of it")
  local f = flagsOn(v, aura)[1]
  check(f and f.mark.t == 50 and f.mark.raidT == 30 and f.mark.moved ~= nil, "the cast draws at your time")
  check(shownLabels(v) == "0:30 to 0:50", "with the raid's time and yours beside it: " .. shownLabels(v))
  local ghost
  for _, tx in ipairs(v.hvBands) do if tx:IsShown() and tx.w == 18 and tx.pt[4] == 30 * v.trackW / 300 - 9 then ghost = tx end end
  check(ghost and ghost.pt[5] == -(aura - 1) * 30 - 1, "and a ghost at the raid's time on its row")
  local dashes = 0
  for _, tx in ipairs(v.hvBands) do if tx:IsShown() and tx.w == 2 and tx.pt[4] == 30 * v.trackW / 300 - 1 then dashes = dashes + 1 end end
  check(dashes >= 3, "its pole dashed: " .. dashes)
  f.OnEnter(f)
  check(table.concat(tip, "|"):find("Raid note time: 0:30", 1, true), "its tooltip gives the raid's time: " .. table.concat(tip, "|"))
  -- another healer's cast won't move
  drag(v, flagsOn(v, hymn)[1], 20, 70)
  check(N:TimerAt(1, 2).time == 20 and Shifts:Find(1, 2) == nil, "Halo's cast stays, in the note and for you")
  -- the alerts: your item at your time, everyone else's at the raid's
  check(item(31821) and item(31821).time == 50 and item(31821).outputs ~= nil, "your callout comes at your time: " .. tostring(item(31821) and item(31821).time))
  check(item(64843) and item(64843).time == 20, "Halo's line keeps the raid's time")
  -- a time kept for someone else's line is never used
  local otherKey = "me-home|" .. Shifts.Key(N:RawLines(1)[2]) .. "#1"
  CRT.db.notes.personalShifts[1][otherKey] = { ph = 1, t = 99, raw = N:RawLines(1)[2], occ = 1, who = "me-home" }
  check(item(64843).time == 20, "a time for a line that isn't yours does nothing")
  CRT.db.notes.personalShifts[1][otherKey] = nil
  -- the saved data is the account's: another character's time for your line is not yours
  local altKey = "alt-home|" .. Shifts.Key(raw3) .. "#1"
  CRT.db.notes.personalShifts[1][altKey] = { ph = 1, t = 77, raw = raw3, occ = 1, who = "alt-home" }
  v:Refresh()
  check(Shifts:Find(1, 3).t == 50 and Shifts:Count({ 1 }) == 1 and item(31821).time == 50, "another character's time is never yours")
  CRT.db.notes.personalShifts[1][altKey] = nil
  -- Alt+drag adds a raid note line, which only a lead may do: refused with the reason
  local altDown = IsAltKeyDown
  IsAltKeyDown = function() return true end
  now = now + 5
  local nLines = #N:RawLines(1)
  drag(v, flagsOn(v, aura)[1], 50, 70)
  IsAltKeyDown = altDown
  check(#N:RawLines(1) == nLines and Shifts:Find(1, 3).t == 50 and printed[#printed] == "Only the raid leader or assistants can change the raid note.",
    "a non-lead's Alt+drag of their own cast is refused: " .. tostring(printed[#printed]))
  -- the hint line says what a non-lead may drag
  check(v.unknownText:GetText() == HV.TEXT.hintOwn, "the hint for a non-lead: " .. tostring(v.unknownText:GetText()))
  -- the bar: one moved cast
  v:Refresh()
  local barRow
  for i, lane in ipairs(v.lanes) do if lane.kind == "hvpanel" and lane.panel == "bar" then barRow = i end end
  check(barRow == #v.lanes and v.hvBar and v.hvBar:IsShown(), "a bar under the healer rows")
  check(v.hvBar.text.text == "You moved 1 cast from the raid note.", "it counts: " .. tostring(v.hvBar.text.text))
  check(v.hvBar.pt and v.hvBar.pt[5] == -(barRow - 1) * 30, "on its own row")
  -- Ctrl+Z puts your move back, Ctrl+Y again
  now = now + 5
  CRT.TimelineUndo:Undo()
  check(Shifts:Find(1, 3) == nil and flagsOn(v, aura)[1].mark.t == 30, "Undo puts your cast back at the raid's time")
  check(not v.hvBar:IsShown(), "and the bar goes")
  now = now + 5
  CRT.TimelineUndo:Redo()
  check(Shifts:Find(1, 3) and Shifts:Find(1, 3).t == 50, "Redo moves it again")
  -- a second cast: the bar counts two; Reset mine puts both back
  now = now + 5
  local wrath = laneIndex(v, "healers:me-home:31884")
  drag(v, flagsOn(v, wrath)[1], 130, 140)
  check(Shifts:Find(1, 4) and Shifts:Find(1, 4).ph == 2 and Shifts:Find(1, 4).t == 20, "a phase 2 cast keeps its phase: 2:10 to P2 +0:20")
  check(v.hvBar.text.text == "You moved 2 casts from the raid note.", "the bar counts two: " .. tostring(v.hvBar.text.text))
  -- dragged back onto the raid's time: yours again
  now = now + 5
  drag(v, flagsOn(v, wrath)[1], 140, 130)
  check(Shifts:Find(1, 4) == nil, "dropped on the raid's time, your time goes")
  now = now + 5
  v.hvBar.buttons.reset.OnClick(v.hvBar.buttons.reset)
  check(Shifts:Count({ 1 }) == 0 and flagsOn(v, aura)[1].mark.t == 30 and not v.hvBar:IsShown(), "Reset mine puts every cast back")
  check(N:TimerAt(1, 3).time == 30, "the raid note never changed")
  -- the raid note changes that line: your time goes, and chat says so
  Shifts:Set(1, 3, 1, 50, 31821)
  CRT.TimelineUndo:Quietly(function() N:ReplaceLine(1, 3, "time:35;ph:1;tag:Me;spellid:31821;", N:RawLines(1)[3]) end)
  check(Shifts:Count({ 1 }) == 0, "a changed line drops your time")
  check(printed[#printed] == "Your moved Spell31821 time was reset: the raid note changed that line.", "chat: " .. tostring(printed[#printed]))
  check(item(31821).time == 35, "your alert follows the raid note again")
  -- the lead took your time: chat says that instead
  Shifts:Set(1, 3, 1, 48, 31821)
  CRT.TimelineUndo:Quietly(function() N:ReplaceLine(1, 3, "time:48;ph:1;tag:Me;spellid:31821;", N:RawLines(1)[3]) end)
  check(Shifts:Count({ 1 }) == 0 and printed[#printed] == "The raid note now has your Spell31821 time.", "taken: " .. tostring(printed[#printed]))
  -- a note that goes takes its times with it, quietly
  Shifts:Set(1, 3, 1, 60, 31821)
  local before = #printed
  local keep = CRT.db.notes.list[1]
  CRT.db.notes.list[1] = nil
  N:Fire()
  check(CRT.db.notes.personalShifts[1] == nil and #printed == before, "a deleted note's times go without a word")
  CRT.db.notes.list[1] = keep
  N:Fire()
  -- the raid leader: drag rewrites the raid note as before, no markers, nothing kept
  group.leader = true
  v:Refresh()
  check(v.lanes[laneIndex(v, "healers:me-home")].label == "Me" .. DOT .. "Holy" and v.lanes[laneIndex(v, "healers:halo-home")].label == "Halo", "a lead sees no markers")
  now = now + 5
  drag(v, flagsOn(v, aura)[1], 48, 58)
  check(N:TimerAt(1, 3).time == 58 and Shifts:Count({ 1 }) == 0, "a lead's drag moves the raid note line")
  now = now + 5
  drag(v, flagsOn(v, hymn)[1], 20, 25)
  check(N:TimerAt(1, 2).time == 25, "and anyone's")
end

-- The same line twice: each copy keeps its own time ------------------------------------------------------------
do
  setNote({ "time:30;ph:1;tag:Me;spellid:31821;", "time:30;ph:1;tag:Me;spellid:31821;" })
  CRT.TimelineUndo:Quietly(function() end)
  group.leader = false
  check(Shifts.Occurrence(1, 2) == 1 and Shifts.Occurrence(1, 3) == 2, "the second copy of a line is its occurrence 2")
  Shifts:Set(1, 3, 1, 70, 31821)
  check(Shifts:Find(1, 2) == nil and Shifts:Find(1, 3) and Shifts:Find(1, 3).t == 70, "a time for the second copy is that copy's only")
  local times = {}
  for _, it in ipairs(CRT.Alerts.blocks.note.Entries({ encounterID = 3001 })) do times[#times + 1] = it.time end
  table.sort(times)
  check(table.concat(times, ",") == "30,70", "the alerts: one at the raid's time, one at yours: " .. table.concat(times, ","))
  -- the note drops the second copy: that time goes
  CRT.TimelineUndo:Quietly(function() N:RemoveLine(1, 3, N:RawLines(1)[3]) end)
  check(Shifts:Count({ 1 }) == 0, "a copy that goes takes its time with it")
  group.leader = true
end

-- The proposal message --------------------------------------------------------------------------------------------
do
  local e = { encounterID = 3001, difficulty = "Mythic", hash = "1f2e3d4c25", occ = 2, spellID = 64843, oldPh = 1, oldT = 171, newPh = 2, newT = 18.5 }
  local text = P.Encode(e)
  check(text == "P|1|3001|Mythic|1f2e3d4c25|2|64843|1|171|2|18.5", "the message: " .. text)
  local d = P.Decode(text)
  check(d and d.encounterID == 3001 and d.difficulty == "Mythic" and d.hash == "1f2e3d4c25" and d.occ == 2 and d.spellID == 64843 and d.oldPh == 1
    and d.oldT == 171 and d.newPh == 2 and d.newT == 18.5, "reads back")
  check(P.Decode("P|1|3001||1f2e3d4c25|1|64843|1|171|1|185").difficulty == nil, "no difficulty")
  check(P.Decode(text .. "|later") ~= nil, "a later field of the same version is skipped")
  for _, bad in ipairs({ "P|2|3001|Mythic|1f2e|1|64843|1|171|1|185", "X|1|3001|Mythic|1f2e|1|64843|1|171|1|185", "P|1|3001|Mythic|1f2e|1|64843|1|171|1",
    "P|1|0|Mythic|1f2e|1|64843|1|171|1|185", "P|1|3001|Mythic|xyz|1|64843|1|171|1|185", "P|1|3001|Mythic|1f2e|1|-5|1|171|1|185",
    "P|1|3001|Mythic|1f2e|1|64843|0|171|1|185", "P|1|3001|Mythic|1f2e|1|64843|1|171|1|9999", "P|1|3001|Mythic|1f2e|1|64843|1|1.25|1|185",
    "P|1|3001|Mythic|11112222333344445|1|64843|1|171|1|185", "P|1|3001|My\tthic|1f2e|1|64843|1|171|1|185", "P|1|3001|Mythic|1f2e|0|64843|1|171|1|185",
    "P|1|3001|Mythic|1f2e|x|64843|1|171|1|185", "", "P" }) do
    check(P.Decode(bad) == nil, "not read: " .. bad)
  end
  check(P.Decode({}) == nil and P.Decode(string.rep("P|", 200)) == nil, "nor anything else")
end

-- Send to raid lead ------------------------------------------------------------------------------------------------
do
  setNote(OWN_LINES)
  CRT.TimelineUndo:Quietly(function() end)
  group.leader = false
  local raw3 = N:RawLines(1)[3]
  Shifts:Set(1, 3, 1, 50, 31821)
  local v = newView()
  for i = #sent, 1, -1 do sent[i] = nil end
  v.hvBar.buttons.send.OnClick(v.hvBar.buttons.send)
  check(#sent == 1 and sent[1][1] == "CRTCDMove" and sent[1][3] == "RAID", "one message, on the raid channel: " .. tostring(sent[1] and sent[1][3]))
  local d = sent[1] and P.Decode(sent[1][2])
  check(d and d.encounterID == 3001 and d.hash == Shifts.Key(raw3) and d.occ == 1 and d.spellID == 31821 and d.oldPh == 1 and d.oldT == 30 and d.newT == 50,
    "with the note's boss, the line, the spell and both times: " .. tostring(sent[1] and sent[1][2]))
  check(printed[#printed] == "Sent 1 moved cast to the raid lead.", "chat: " .. tostring(printed[#printed]))
  -- in combat: sent once it ends
  sent[1] = nil
  inCombat = true
  P:Send(v.hvNoteIds)
  check(#sent == 0 and printed[#printed] == P.TEXT.afterCombat, "never in combat")
  inCombat = false
  P.events.OnEvent(P.events, "PLAYER_REGEN_ENABLED")
  check(#sent == 1, "sent when combat ends")
  -- the game holding addon messages: tried again
  sent[1] = nil
  chatLocked = true
  P:Send(v.hvNoteIds)
  check(#sent == 0, "held while the game locks addon messages")
  chatLocked = false
  flush()
  check(#sent == 1, "and sent on the next try")
  -- a party: the party channel
  sent[1] = nil
  group.raid = false
  P:Send(v.hvNoteIds)
  check(sent[1] and sent[1][3] == "PARTY", "in a party, PARTY")
  group.raid = true
  -- out of a group: chat says why
  sent[1] = nil
  group.raid, group.party = false, false
  P:Send(v.hvNoteIds)
  check(#sent == 0 and printed[#printed] == P.TEXT.noGroup, "not in a group: nothing sent")
  group.raid, group.party = true, true
  Shifts:ClearNotes({ 1 })
end

-- The raid lead's side: proposals ---------------------------------------------------------------------------------
do
  setNote(OWN_LINES)
  CRT.TimelineUndo:Quietly(function() end)
  group.leader = true
  P.list = {}
  flush()
  local raw2 = N:RawLines(1)[2]
  local function msg(newT, spellID, hash)
    return P.Encode({ encounterID = 3001, hash = hash or Shifts.Key(raw2), spellID = spellID or 64843, oldPh = 1, oldT = 20, newPh = 1, newT = newT })
  end
  check(P:Hear("CRTCDMove", msg(45), "RAID", "Rain-Home") == nil, "Rain can't propose Halo's line")
  check(P:Hear("CRTCDMove", msg(45), "RAID", "Zed-Home") == nil, "nor someone not in the group")
  check(P:Hear("CRTCDMove", msg(45), "WHISPER", "Halo-Home") == nil, "only the RAID and PARTY channels")
  check(P:Hear("CRTCDMove", msg(45, 200183), "RAID", "Halo-Home") == nil, "the line's spell must match")
  check(P:Hear("CRTNote2", msg(45), "RAID", "Halo-Home") == nil, "only its own prefix")
  check(P:Hear("CRTCDMove", "P|1|garbage", "RAID", "Halo-Home") == nil and #P.list == 0, "nothing broken is kept")
  group.leader = false
  check(P:Hear("CRTCDMove", msg(45), "RAID", "Halo-Home") == nil, "someone who can't change the raid note keeps none")
  group.leader = true
  local p = P:Hear("CRTCDMove", msg(45), "RAID", "Halo-Home")
  check(p and not p.stale and #P.list == 1 and p.short == "Halo", "Halo's own line: a proposal")
  check(P:Hear("CRTCDMove", msg(47), "RAID", "Halo-Home") and #P.list == 1 and P.list[1].newT == 47, "a newer one for the same line replaces it")
  flush()
  check(printed[#printed] == "Halo proposed 2 cooldown changes: /crt timeline", "one chat line for the burst: " .. tostring(printed[#printed]))
  -- the box on Healer CDs
  local v = newView()
  check(v.hvHead and v.hvHead:IsShown() and v.hvHead.text.text == "Proposed changes (1)", "a Proposed changes box")
  check(v.hvHead.auto.checked == false, "its auto-accept box, off")
  local pf = v.hvProps[1]
  check(pf and pf:IsShown() and pf.text.text == "Halo" .. DOT .. "Spell64843 0:20 to 0:47", "a row per change: " .. tostring(pf and pf.text.text))
  check(pf.buttons.accept.enabled ~= false and pf.buttons.decline and pf.buttons.show, "Accept, Decline, Show on Timeline")
  -- Show on Timeline selects that cast
  pf.buttons.show.OnClick(pf.buttons.show)
  local sel = v:SelectedMark()
  check(sel and sel.noteID == 1 and sel.line == 2, "Show on Timeline selects the cast")
  -- Accept writes the note line
  now = now + 5
  pf.buttons.accept.OnClick(pf.buttons.accept)
  check(N:TimerAt(1, 2).time == 47 and N:TimerAt(1, 2).tags[1] == "Halo" and #P.list == 0, "Accept moves the raid note line: " .. tostring(N:TimerAt(1, 2).time))
  check(printed[#printed] == "Accepted Halo's Spell64843 time: 0:20 to 0:47. Share the note to send it to the raid.", "chat: " .. tostring(printed[#printed]))
  check(not v.hvHead:IsShown() and not pf:IsShown(), "the box goes with the last change")
  -- Undo covers it
  now = now + 5
  CRT.TimelineUndo:Undo()
  check(N:TimerAt(1, 2).time == 20, "Undo puts the line back")
  -- Decline drops it and changes nothing
  P:Hear("CRTCDMove", msg(60), "RAID", "Halo-Home")
  v:Refresh()
  local n = #sent
  v.hvProps[1].buttons.decline.OnClick(v.hvProps[1].buttons.decline)
  check(#P.list == 0 and N:TimerAt(1, 2).time == 20 and #sent == n, "Decline: gone, the note as it was, nothing sent back")
  -- a change to a line that changed since: stale, can't be accepted
  local stale = P:Hear("CRTCDMove", msg(60, 64843, "abcdef12"), "RAID", "Halo-Home")
  check(stale and stale.stale, "a line the note doesn't have: stale")
  P:Hear("CRTCDMove", msg(61), "RAID", "Halo-Home")
  CRT.TimelineUndo:Quietly(function() N:ReplaceLine(1, 2, "time:22;ph:1;tag:Halo;spellid:64843;", raw2) end)
  v:Refresh()
  check(#P.list == 2 and P.list[2].stale, "a line changed after it came: stale too")
  check(v.hvProps[2].buttons.accept.enabled == false and v.hvProps[2].text.text:find("changed since", 1, true), "its Accept is off and it says why")
  check(P:Accept(P.list[2]) == false and N:TimerAt(1, 2).time == 22, "a stale change is never written")
  P.list = {}
  -- auto-accept: a good change is applied at once, a stale one waits
  v:Refresh()
  CRT.db.notes.autoAcceptCooldowns = false
  local raw2b = N:RawLines(1)[2]
  P:Hear("CRTCDMove", P.Encode({ encounterID = 3001, hash = Shifts.Key(raw2b), spellID = 64843, oldPh = 1, oldT = 22, newPh = 1, newT = 33 }), "RAID", "Halo-Home")
  check(#P.list == 1 and N:TimerAt(1, 2).time == 22, "auto-accept off: it waits")
  P.list = {}
  v:Refresh()
  CRT.db.notes.autoAcceptCooldowns = true
  P:Hear("CRTCDMove", P.Encode({ encounterID = 3001, hash = Shifts.Key(raw2b), spellID = 64843, oldPh = 1, oldT = 22, newPh = 1, newT = 33 }), "RAID", "Halo-Home")
  check(#P.list == 0 and N:TimerAt(1, 2).time == 33, "auto-accept on: written at once")
  check(printed[#printed] == "Accepted Halo's Spell64843 time automatically: 0:22 to 0:33. Share the note to send it to the raid.", "chat says so: " .. tostring(printed[#printed]))
  P:Hear("CRTCDMove", msg(70, 64843, "abcdef12"), "RAID", "Halo-Home")
  check(#P.list == 1 and P.list[1].stale, "a stale one still waits")
  -- the box's check box sets it
  v:Refresh()
  local cb = v.hvHead.auto
  check(cb.checked == true, "the box shows it on")
  cb:SetChecked(false)
  cb.OnClick(cb)
  check(CRT.db.notes.autoAcceptCooldowns == false, "and turns it off")
  P.list = {}
end

-- Proposals: ownership is checked on arrival, on every draw and by Accept ---------------------------------------------
do
  setNote(OWN_LINES)
  CRT.TimelineUndo:Quietly(function() end)
  group.leader = true
  CRT.db.notes.autoAcceptCooldowns = false
  P.list = {}
  local rainLine = "time:20;ph:1;tag:Rain;spellid:64843;"
  local function about(line, newT, extra)
    local e = { encounterID = 3001, hash = Shifts.Key(line), spellID = 64843, oldPh = 1, oldT = 20, newPh = 1, newT = newT }
    for k, x in pairs(extra or {}) do e[k] = x end
    return P.Encode(e)
  end
  -- Halo proposes a line the note doesn't have yet: stale on arrival
  local p = P:Hear("CRTCDMove", about(rainLine, 44), "RAID", "Halo-Home")
  check(p and p.stale, "a line the note doesn't have: stale on arrival")
  -- then the note gets that line, naming Rain: never Halo's to move
  CRT.TimelineUndo:Quietly(function() N:AddLineTo(1, rainLine) end)
  local rainAt = #N:RawLines(1)
  check(P:Accept(p) == false and N:TimerAt(1, rainAt).time == 20, "Accept refuses a line that names another player")
  check(#P.list == 0, "and drops it")
  local q = P:Hear("CRTCDMove", about("time:20;ph:1;tag:Nobody;spellid:64843;", 45), "RAID", "Halo-Home")
  check(q and q.stale, "another stale one")
  CRT.TimelineUndo:Quietly(function() N:AddLineTo(1, "time:20;ph:1;tag:Nobody;spellid:64843;") end)
  local v = newView()
  check(#P.list == 0 and not (v.hvHead and v.hvHead:IsShown()), "a draw drops one whose line came back naming someone else")
  -- a phase the boss doesn't have is refused on arrival
  check(P:Hear("CRTCDMove", about(N:RawLines(1)[2], 44, { newPh = 5 }), "RAID", "Halo-Home") == nil, "phase 5: the boss has no such phase")
  check(P:Hear("CRTCDMove", about(N:RawLines(1)[2], 4, { newPh = 2 }), "RAID", "Halo-Home") ~= nil, "phase 2, which the note uses: taken")
  -- the old time must be the line's
  P.list = {}
  check(P:Hear("CRTCDMove", about(N:RawLines(1)[2], 44, { oldT = 21 }), "RAID", "Halo-Home") == nil, "an old time that isn't the line's is refused")
end

-- Proposals: a shared assignment ----------------------------------------------------------------------------------
do
  setNote({ "time:40;ph:1;tag:Halo Rain;spellid:64843;", "time:50;ph:1;tag:Halo healer;spellid:64843;" })
  CRT.TimelineUndo:Quietly(function() end)
  group.leader = true
  P.list = {}
  CRT.db.notes.autoAcceptCooldowns = true
  local shared = N:RawLines(1)[2]
  local p = P:Hear("CRTCDMove", P.Encode({ encounterID = 3001, hash = Shifts.Key(shared), spellID = 64843, oldPh = 1, oldT = 40, newPh = 1, newT = 55 }), "RAID", "Rain-Home")
  check(p and p.shared and #p.players == 2 and not p.stale, "a line naming two players: any of them may propose it, and it is shared")
  check(N:TimerAt(1, 2).time == 40 and #P.list == 1, "auto-accept never takes a shared assignment")
  local own = P:Hear("CRTCDMove", P.Encode({ encounterID = 3001, hash = Shifts.Key(N:RawLines(1)[3]), spellID = 64843, oldPh = 1, oldT = 50, newPh = 1, newT = 58 }), "RAID", "Halo-Home")
  check(own and not own.shared and N:TimerAt(1, 3).time == 58, "a line naming only the sender (and a role) is auto-accepted")
  local v = newView()
  local pf = v.hvProps[1]
  check(pf.text.text:find("Shared assignment (2 players): accepting moves everyone's timer on this line", 1, true), "the row says so: " .. tostring(pf.text.text))
  check(pf.text.text:find("|c", 1, true) ~= nil, "in the warn colour")
  pf.OnEnter(pf)
  check(table.concat(tip, "|"):find("Halo, Rain", 1, true), "with the names in its tooltip: " .. table.concat(tip, "|"))
  pf.buttons.accept.OnClick(pf.buttons.accept)
  check(N:TimerAt(1, 2).time == 55 and N:TimerAt(1, 2).tags[2] == "Rain", "a manual Accept moves the shared line")
  CRT.db.notes.autoAcceptCooldowns = false
  P.list = {}
end

-- Proposals: auto-accept waits for the end of combat and of the encounter ------------------------------------------
do
  setNote(OWN_LINES)
  CRT.TimelineUndo:Quietly(function() end)
  group.leader = true
  P.list = {}
  CRT.db.notes.autoAcceptCooldowns = true
  local raw2 = N:RawLines(1)[2]
  local function hear(newT) return P:Hear("CRTCDMove", P.Encode({ encounterID = 3001, hash = Shifts.Key(raw2), spellID = 64843, oldPh = 1, oldT = 20, newPh = 1, newT = newT }), "RAID", "Halo-Home") end
  inCombat = true
  local p = hear(31)
  check(p and p.held and N:TimerAt(1, 2).time == 20, "in combat: held, the note untouched")
  inCombat = false
  P.events.OnEvent(P.events, "PLAYER_REGEN_ENABLED")
  check(N:TimerAt(1, 2).time == 31 and #P.list == 0, "applied once combat ends")
  local encounter = true
  IsEncounterInProgress = function() return encounter end
  raw2 = N:RawLines(1)[2]
  local function hear2(newT) return P:Hear("CRTCDMove", P.Encode({ encounterID = 3001, hash = Shifts.Key(raw2), spellID = 64843, oldPh = 1, oldT = 31, newPh = 1, newT = newT }), "RAID", "Halo-Home") end
  p = hear2(36)
  check(p and p.held and N:TimerAt(1, 2).time == 31, "in an encounter: held")
  P.events.OnEvent(P.events, "ENCOUNTER_END")
  check(N:TimerAt(1, 2).time == 31, "ENCOUNTER_END while it still counts as in progress: still held")
  encounter = false
  flush()
  check(N:TimerAt(1, 2).time == 36, "applied once the encounter is over")
  IsEncounterInProgress = nil
  CRT.db.notes.autoAcceptCooldowns = false
  P.list = {}
end

-- Proposals: at most 20 per sender and 100 in all, and a few rows of frames ------------------------------------------
do
  setNote(OWN_LINES)
  CRT.TimelineUndo:Quietly(function() end)
  group.leader = true
  P.list = {}
  local function stale(i, who)
    return P:Hear("CRTCDMove", P.Encode({ encounterID = 3001, hash = string.format("%08x", i), spellID = 64843, oldPh = 1, oldT = 20, newPh = 1, newT = 30 }), "RAID", who)
  end
  for i = 1, 25 do stale(i, "Halo-Home") end
  check(#P.list == P.MAX_PER_SENDER and P.list[1].hash == string.format("%08x", 6), "20 kept per sender, the oldest dropped: " .. #P.list)
  local keep = liveRoster
  liveRoster = {}
  for i = 1, 7 do liveRoster[i] = { "S" .. string.char(96 + i), "PRIEST", "HEALER" } end
  P.list = {}
  for s = 1, 7 do for i = 1, 20 do stale(s * 100 + i, "S" .. string.char(96 + s) .. "-Home") end end
  check(#P.list == P.MAX_TOTAL and P.list[1].who == "sc-home", "100 in all, the oldest dropped: " .. #P.list .. " " .. tostring(P.list[1].who))
  liveRoster = keep
  local v = newView()
  check(#(v.hvProps or {}) == CRT.TimelineHealerPanel.MAX_ROWS, "only a few rows of frames are made: " .. #(v.hvProps or {}))
  check(v.hvHead.text.text == "Proposed changes (100, the first 8 shown)", "the box says how many: " .. tostring(v.hvHead.text.text))
  P.list = {}
  flush()
end

-- Deaths and the end of a picked pull, in both layouts --------------------------------------------------------------
do
  setNote({})
  group.leader = true
  CRT.PALETTE.good, CRT.PALETTE.bad = { 0.4, 0.8, 0.4 }, { 0.9, 0.3, 0.3 } -- the theme's status colours
  for _, kill in ipairs({ false, true }) do
    local pull = { id = 5, encounterID = 3001, length = 250, kill = kill, casts = { { t = 10, spellID = 0 } },
      deaths = { { t = 90, name = "Halo", class = "PRIEST", role = "HEALER", spellID = 0 } } }
    local v = View.Create(mock("Frame"))
    v:SetData({ reference = ref }, 3001, pull, "Nek")
    for _, mode in ipairs({ "nil", "healers" }) do
      v:SetMode(mode == "healers" and "healers" or nil)
      local skull
      for _, b in ipairs(v.icons) do if b:IsShown() and b.mark and b.mark.death then skull = b end end
      check(skull and skull.mark.t == 90, mode .. ": the picked pull's deaths show")
      if mode == "healers" then
        check(laneIndex(v, "healers:halo-home") ~= nil and skull.lane.kind ~= "healer", "Healer CDs keeps the deaths row above the healers")
      end
      local line, want = v.endLine, kill and CRT.PALETTE.good or CRT.PALETTE.bad
      check(line and line:IsShown() and line.w == 3 and line.h == #v.lanes * 30, mode .. ": the end line, 3 px, across every row")
      check(line.color[1] == want[1] and line.color[2] == want[2] and line.color[3] == want[3], mode .. ": in the " .. (kill and "good" or "bad") .. " colour")
      check(v.endTag:IsShown() and v.endTag.text.text == (kill and "Kill 4:10" or "Wipe 4:10"), mode .. ": tagged on the axis: " .. tostring(v.endTag.text.text))
    end
  end
end

if fails > 0 then error(fails .. " healer view checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, FILES.length + 4); // more files than the stack holds by default
for (const f of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, f), 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
