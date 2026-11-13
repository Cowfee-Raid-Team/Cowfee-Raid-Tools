// Timeline: healer slots on Healer CDs (CRT_Modules/Timeline/HealerSlots.lua, drawn by HealerView.lua and HealerPanel.lua):
// + Add healer adds a slot by spec with the next free number; a slot's rows are its spec's major cooldowns only; a cast
// planned on it is a note line tagged with its spec word (numbered with two slots of a spec) or its player's name;
// Assign rewrites its lines to the name and Clear back; Change spec keeps the lines the new spec has and asks before the
// rest leave; Remove asks before its lines leave; numbers stay as given; an assigned player on the roster shows once; a
// spec word in the note with no slot shows as one; and others' lanes by their cached spec (Groups.CachedSpec).
// Usage: node run_timeline_slots.js <addon folder>
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
  'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/SpecWords.lua', 'CRT_Modules/Notes/Data.lua',
  'CRT_Modules/Notes/Engine.lua', 'CRT_Modules/Notes/Shifts.lua', 'CRT_Modules/Notes/Proposals.lua', 'CRT_Modules/Timeline/HealerPanel.lua',
  'CRT_Modules/Alerts/Reminders.lua', 'CRT_Modules/Alerts/CooldownData.lua', 'CRT_Modules/Alerts/Cooldowns.lua',
  'CRT_Modules/Timeline/AbilityTip.lua', 'CRT_Modules/Timeline/View.lua', 'CRT_Modules/Timeline/HealerView.lua',
  'CRT_Core/Sound/Engine.lua', 'CRT_Modules/Alerts/Draft.lua', 'CRT_Modules/Alerts/Saved.lua', 'CRT_Modules/Timeline/Undo.lua',
  'CRT_Modules/Timeline/HealerRows.lua', 'CRT_Modules/Timeline/HealerSlots.lua',
  'CRT_Core/Core.lua', 'CRT_Core/Profiles.lua', // read as text only: the saved data's defaults and share rules
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
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
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
  function d:CreateCheckbox(s, isSel, set) local x = description("checkbox", s, set) x.isSel = isSel table.insert(self.items, x) return x end
  function d:SetScrollMode() end
  function d:SetEnabled(on) self.enabled = on and true or false end
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
CRT_MARKERS(CRT) -- CRT.MarkerText, the real CRT_Core/MarkerText.lua
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
run("CRT_Modules/Notes/SpecWords.lua", CRT)
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
run("CRT_Modules/Timeline/HealerRows.lua", CRT)
run("CRT_Modules/Timeline/HealerSlots.lua", CRT)
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
local Slots, S = CRT.TimelineHealerSlots, CRT.NoteSpecs
check(Slots ~= nil and S ~= nil, "CRT.TimelineHealerSlots and CRT.NoteSpecs are loaded")
local SLOTS_DEFAULT = src[#FILES - 1]:find("healerSlots = {},", 1, true) ~= nil
check(SLOTS_DEFAULT, "Core.lua gives timeline.healerSlots its default")
CRT.db.timeline.healerSlots = {}
CRT.db.specCache = {}
CRT.PALETTE.warn = { 1, 0.6, 0.2 }
-- popups: the confirm and the name box
local asked, typed = nil, nil
function StaticPopup_ShowCustomGenericConfirmation(info) asked = info return nil end
function StaticPopup_Show(name, text, _, data) typed = { name = name, text = text, data = data } return nil end
function StaticPopup_Hide() end
local function typeName(name)
  local edit = mock("EditBox") edit.text = name
  StaticPopupDialogs[typed.name].OnAccept({ EditBox = edit }, typed.data)
  typed = nil
end
local function lane(v, key) return v.lanes[laneIndex(v, key)] end
local function lastLine() local lines = N:RawLines(1) return lines[#lines], N:TimerAt(1, #lines) end
local function find(items, text) for _, x in ipairs(items) do if x.text and x.text:find(text, 1, true) then return x end end end
local function headerMenu(v, key)
  local l = v.labels[laneIndex(v, key)]
  check(HV.LabelMenu(v, l, l.lane), "a right-click on " .. key .. " opens its menu")
  return menus[#menus]
end
local function majorsOf(v, slotKey)
  local out = {}
  for _, l in ipairs(v.lanes) do
    local k = l.key and l.key:match("^healers:" .. slotKey:gsub("%p", "%%%0") .. ":(%d+)$")
    if k then out[#out + 1] = k end
  end
  return table.concat(out, ",")
end

-- Others' lanes by the spec seen last (Groups.CachedSpec) -------------------------------------------------------
do
  setNote({})
  CRT.db.specCache["halo-home"] = 256
  local v = newView()
  check(laneIndex(v, "healers:halo-home:62618") and laneIndex(v, "healers:halo-home:421453") and not laneIndex(v, "healers:halo-home:64843"),
    "Halo seen as Discipline: only Discipline's majors: " .. labels(v))
  CRT.db.specCache["halo-home"] = 257
  v:Refresh()
  check(lane(v, "healers:halo-home").label == "Halo" .. DOT .. "Holy" and laneIndex(v, "healers:halo-home:64843") and not laneIndex(v, "healers:halo-home:62618"),
    "seen as Holy: Holy's, with the spec's name: " .. tostring(lane(v, "healers:halo-home").label))
  CRT.db.specCache["halo-home"] = nil
  v:Refresh()
  check(laneIndex(v, "healers:halo-home:64843") and laneIndex(v, "healers:halo-home:62618"), "spec unknown: the whole class's, as before")
end

-- + Add healer: a slot by spec, its spec's majors only -------------------------------------------------------------
local v = newView()
do
  local addRow
  for i, l in ipairs(v.lanes) do if l.kind == "hvpanel" and l.panel == "add" then addRow = i end end
  check(addRow and addRow > laneIndex(v, "healers:me-home:31821"), "an add row under the healer rows")
  local f = v.hvAdd
  check(f and f.shown and f.buttons.add ~= nil, "with its + Add healer button")
  local n = #menus
  f.buttons.add.OnClick(f.buttons.add)
  local menu = menus[#menus]
  check(#menus == n + 1 and menu.items[1].kind == "title" and menu.items[1].text == "Add healer", "a click opens the specs' menu")
  local want = { "Resto Druid", "Preservation Evoker", "Mistweaver Monk", "Holy Paladin", "Disc Priest", "Holy Priest", "Resto Shaman" }
  local ok = #menu.items == 8
  for i, w in ipairs(want) do ok = ok and menu.items[i + 1].text:find(w, 1, true) ~= nil end
  check(ok, "the seven healer specs in order")
  check(menu.items[2].text:find("|c", 1, true) == 1, "each in its class colour: " .. menu.items[2].text)
  menu.items[2].fn()
  local saved = CRT.db.timeline.healerSlots[3001]
  check(saved and #saved == 1 and saved[1].spec == 105 and saved[1].n == 1 and saved[1].player == nil, "Resto Druid slot 1 is kept for the boss")
  local head = lane(v, "healers:slot:105:1")
  check(head and head.kind == "healer" and head.label == "Resto Druid" and head.class == "DRUID", "its name row: Resto Druid, in class colour")
  check(majorsOf(v, "slot:105:1") == "740,33891,391528", "Tranquility, Incarnation, Convoke: that spec's majors only: " .. majorsOf(v, "slot:105:1"))
  check(head.note == Slots.TEXT.open and not head.noteWarn, "no Resto Druid in the raid: " .. tostring(head.note))
  local b = v.labels[laneIndex(v, "healers:slot:105:1")].hvBorder
  check(b and b.dashes[1].shown and not b.solid[1].shown, "a dashed border with no player")
  check(b.dashes[1].color[1] == RAID_CLASS_COLORS.DRUID.r, "in the class colour")
  v.labels[laneIndex(v, "healers:slot:105:1")].lane.tip(v.labels[laneIndex(v, "healers:slot:105:1")])
  check(table.concat(tip, "|"):find("Right-click to assign", 1, true), "its tooltip says what a right-click does")
end

-- A cast on a slot: tagged with its spec word -----------------------------------------------------------------------
do
  local row = laneIndex(v, "healers:slot:105:1:740")
  check(HV.DoubleClick(v, 110, v.lanes[row]), "a double-click on Tranquility")
  local raw, t = lastLine()
  check(t and t.tags[1] == "RestoDruid" and t.spellId == 740 and t.time == 110, "writes RestoDruid Tranquility at 1:50: " .. tostring(raw))
  v:Refresh()
  row = laneIndex(v, "healers:slot:105:1:740")
  check(#flagsOn(v, row) == 1 and #flagsOn(v, laneIndex(v, "notes") or -1) == 0, "drawn on the slot's row, not on Notes")
end

-- One Resto Druid in the raid: named in the hint; Assign rewrites the line -----------------------------------------------
do
  setLayout({ "Halo-Home", "Rain-Home", "Tanky-Home", "Off-Home", "Me-Home", "Zorp-Elsewhere", "Leafy-Home" })
  liveRoster[#liveRoster + 1] = { "Leafy", "DRUID", "HEALER" }
  CRT.db.specCache["leafy-home"] = 105
  now = now + 10
  v:Refresh()
  local head = lane(v, "healers:slot:105:1")
  check(head.note == "Leafy" and not head.noteWarn, "the one Resto Druid is named in the hint: " .. tostring(head.note))
  check(laneIndex(v, "healers:leafy-home") ~= nil, "Leafy, not assigned, has her own rows")
  local menu = headerMenu(v, "healers:slot:105:1")
  check(menu.items[1].text == "Resto Druid", "the menu's title is the slot")
  local assign, change = find(menu.items, "Assign player"), find(menu.items, "Change spec")
  local clear, remove = find(menu.items, "Clear player"), find(menu.items, "Remove slot")
  check(assign and change and clear and remove and find(menu.items, "Rows"), "Assign player, Change spec, Clear player, Remove slot, Rows")
  check(clear.enabled == false, "Clear player is off with no player")
  check(assign.items[1].text:find("Leafy", 1, true) and find(assign.items, "Type a name"), "the raid's Resto Druids first, then Type a name...")
  assign.items[1].fn()
  local raw, t = lastLine()
  check(t.tags[1] == "Leafy" and t.spellId == 740, "assigned: the line names Leafy: " .. raw)
  check(CRT.db.timeline.healerSlots[3001][1].player == "Leafy-Home", "the slot keeps her name")
  head = lane(v, "healers:leafy-home")
  check(head and head.hvSlot and head.label == "Resto Druid" .. DOT .. "Leafy" and head.note == nil, "one lane: the slot's, Resto Druid · Leafy: " .. tostring(head and head.label))
  check(laneIndex(v, "healers:slot:105:1") == nil, "no open slot left")
  local n = 0
  for _, l in ipairs(v.lanes) do if l.key == "healers:leafy-home" then n = n + 1 end end
  check(n == 1 and majorsOf(v, "leafy-home") == "740,33891,391528", "Leafy shows once, with the slot's rows")
  check(#flagsOn(v, laneIndex(v, "healers:leafy-home:740")) == 1, "the cast stays on its row")
  local b = v.labels[laneIndex(v, "healers:leafy-home")].hvBorder
  check(b.solid[1].shown and not (b.dashes[1] and b.dashes[1].shown), "a solid border once assigned")
  -- a cast now names her
  HV.DoubleClick(v, 200, v.lanes[laneIndex(v, "healers:leafy-home:33891")])
  raw, t = lastLine()
  check(t.tags[1] == "Leafy" and t.spellId == 33891, "a new cast names the player: " .. raw)
  -- Clear player: both lines say RestoDruid again
  menu = headerMenu(v, "healers:leafy-home")
  find(menu.items, "Clear player").fn()
  local words = {}
  for _, tm in ipairs(N:Parsed(1).timers) do words[#words + 1] = tm.tags[1] end
  check(table.concat(words, ",") == "RestoDruid,RestoDruid", "Clear player puts RestoDruid back: " .. table.concat(words, ","))
  check(CRT.db.timeline.healerSlots[3001][1].player == nil and laneIndex(v, "healers:slot:105:1") and laneIndex(v, "healers:leafy-home"),
    "the slot is open again and Leafy has her own rows")
  -- Type a name: someone not in the raid
  menu = headerMenu(v, "healers:slot:105:1")
  find(find(menu.items, "Assign player").items, "Type a name").fn()
  check(typed and typed.text == "Who plays Resto Druid?", "Type a name asks who: " .. tostring(typed and typed.text))
  typeName("Bramble")
  words = {}
  for _, tm in ipairs(N:Parsed(1).timers) do words[#words + 1] = tm.tags[1] end
  check(table.concat(words, ",") == "Bramble,Bramble" and CRT.db.timeline.healerSlots[3001][1].player == "Bramble-Home",
    "the typed name is assigned: " .. table.concat(words, ","))
  check(lane(v, "healers:bramble-home") and lane(v, "healers:bramble-home").hvSlot, "the slot's lane follows the typed name")
  -- Leafy is on no slot; with Bramble on it, she is offered and not greyed
  find(headerMenu(v, "healers:bramble-home").items, "Clear player").fn()
end

-- Two Resto Druids: numbered, the hint says pick a player; Remove asks ------------------------------------------------
do
  v.hvAdd.buttons.add.OnClick(v.hvAdd.buttons.add)
  menus[#menus].items[2].fn()
  local saved = CRT.db.timeline.healerSlots[3001]
  check(#saved == 2 and saved[2].n == 2, "a second Resto Druid is slot 2")
  local h1, h2 = lane(v, "healers:slot:105:1"), lane(v, "healers:slot:105:2")
  check(h1.label == "Resto Druid 1" and h2.label == "Resto Druid 2", "the headers read Resto Druid 1 and 2")
  check(h2.noteWarn and h2.note == "Pick a player: 1 Resto Druid in the raid", "two slots, one Resto Druid: pick a player, in the warning colour: " .. tostring(h2.note))
  local fs
  for _, x in ipairs(v.hvNotes) do if x.shown and x.text == h2.note then fs = x end end
  check(fs and fs.tcolor[1] == CRT.PALETTE.warn[1], "drawn in the warn colour")
  HV.DoubleClick(v, 150, v.lanes[laneIndex(v, "healers:slot:105:2:740")])
  local raw, t = lastLine()
  check(t.tags[1] == "RestoDruid2", "a cast on slot 2 writes RestoDruid2: " .. raw)
  HV.DoubleClick(v, 30, v.lanes[laneIndex(v, "healers:slot:105:1:391528")])
  raw, t = lastLine()
  check(t.tags[1] == "RestoDruid1", "and on slot 1 RestoDruid1: " .. raw)
  check(#flagsOn(v, laneIndex(v, "healers:slot:105:1:740")) == 1 and #flagsOn(v, laneIndex(v, "healers:slot:105:2:740")) == 1,
    "the old RestoDruid line stays on slot 1, RestoDruid2 on slot 2")
  -- Assign submenu: someone on another slot is greyed with that slot's name
  find(find(headerMenu(v, "healers:slot:105:1").items, "Assign player").items, "Leafy").fn()
  local sub = find(headerMenu(v, "healers:slot:105:2").items, "Assign player")
  local leafy = find(sub.items, "Leafy")
  check(leafy and leafy.text == "Leafy (Resto Druid 1)" and leafy.enabled == false, "Leafy, on slot 1, is greyed: " .. tostring(leafy and leafy.text))
  -- remove slot 2 with its cast: asked first
  local before = #N:RawLines(1)
  find(headerMenu(v, "healers:slot:105:2").items, "Remove slot").fn()
  check(asked and asked.text == "Remove Resto Druid 2? Its 1 planned cast leaves the raid note." and asked.acceptText == "Remove",
    "Remove asks with the casts it takes: " .. tostring(asked and asked.text))
  check(#N:RawLines(1) == before and #CRT.db.timeline.healerSlots[3001] == 2, "nothing changes until it is answered")
  asked.callback()
  asked = nil
  local found = false
  for _, tm in ipairs(N:Parsed(1).timers) do if tm.tags[1] == "RestoDruid2" then found = true end end
  check(not found and #N:RawLines(1) == before - 1, "Remove: the line leaves the note")
  saved = CRT.db.timeline.healerSlots[3001]
  check(#saved == 1 and saved[1].n == 1 and saved[1].player == "Leafy-Home", "slot 1 stays, with Leafy")
  check(lane(v, "healers:leafy-home").label == "Resto Druid" .. DOT .. "Leafy", "one slot again: no number")
  -- stable numbers: add slot 2, remove slot 1; slot 2 keeps its number
  v.hvAdd.buttons.add.OnClick(v.hvAdd.buttons.add)
  menus[#menus].items[2].fn()
  find(headerMenu(v, "healers:leafy-home").items, "Remove slot").fn()
  check(asked and asked.text == "Remove Resto Druid 1? 3 planned casts leave the raid note: every cast of these cooldowns that names Leafy.",
    "slot 1's three casts, every one naming Leafy: " .. tostring(asked and asked.text))
  asked.callback()
  asked = nil
  saved = CRT.db.timeline.healerSlots[3001]
  check(#saved == 1 and saved[1].n == 2, "slot 2 keeps its number")
  local remaining = 0
  for _, tm in ipairs(N:Parsed(1).timers) do remaining = remaining + 1 end
  check(remaining == 0, "every line of slot 1 left the note (Leafy's, RestoDruid's and RestoDruid1's)")
  check(lane(v, "healers:slot:105:2") and lane(v, "healers:slot:105:2").label == "Resto Druid", "the lone slot 2 reads Resto Druid")
  HV.DoubleClick(v, 40, v.lanes[laneIndex(v, "healers:slot:105:2:740")])
  local _, t2 = lastLine()
  check(t2.tags[1] == "RestoDruid", "the only slot of its spec writes the word with no number")
  v:Refresh()
  check(#flagsOn(v, laneIndex(v, "healers:slot:105:2:740")) == 1, "and the plain word's cast is on it")
  -- adding again takes the free number 1
  v.hvAdd.buttons.add.OnClick(v.hvAdd.buttons.add)
  menus[#menus].items[2].fn()
  check(CRT.db.timeline.healerSlots[3001][2].n == 1, "the next free number is 1 again")
end

-- Change spec ---------------------------------------------------------------------------------------------------------
do
  setNote({})
  CRT.db.timeline.healerSlots[3001] = { { spec = 257, n = 1 } }
  v:Refresh()
  check(majorsOf(v, "slot:257:1") == "64843,200183", "a Holy Priest slot: Divine Hymn, Apotheosis")
  HV.DoubleClick(v, 20, v.lanes[laneIndex(v, "healers:slot:257:1:64843")])
  HV.DoubleClick(v, 60, v.lanes[laneIndex(v, "healers:slot:257:1:200183")])
  -- Divine Hymn for Discipline too, here: that line can stay
  local hymn = HV.Listed(64843)
  hymn.spec = { 257, 256 }
  local menu = headerMenu(v, "healers:slot:257:1")
  local change = find(menu.items, "Change spec")
  check(#change.items == 7 and find(change.items, "Holy Priest").enabled == false, "Change spec lists the seven, its own greyed")
  find(change.items, "Disc Priest").fn()
  check(asked and asked.text == "Change Holy Priest to Disc Priest? Its 1 planned cast leaves the raid note." and asked.acceptText == "Change",
    "asked first, with the casts the new spec has no cooldown for: " .. tostring(asked and asked.text))
  asked.callback()
  asked = nil
  local t = N:Parsed(1).timers
  check(#t == 1 and t[1].spellId == 64843 and t[1].tags[1] == "DiscPriest", "the Hymn stays as DiscPriest, Apotheosis leaves the note")
  local saved = CRT.db.timeline.healerSlots[3001][1]
  check(saved.spec == 256 and saved.n == 1, "the slot is a Disc Priest now")
  check(lane(v, "healers:slot:256:1") and majorsOf(v, "slot:256:1"):find("62618", 1, true), "drawn as Disc Priest, with its majors")
  hymn.spec = 257
  -- no lines lost: no question
  CRT.db.timeline.healerSlots[3001] = { { spec = 264, n = 1 } }
  setNote({})
  v:Refresh()
  find(find(headerMenu(v, "healers:slot:264:1").items, "Change spec").items, "Mistweaver").fn()
  check(asked == nil and CRT.db.timeline.healerSlots[3001][1].spec == 270, "with nothing to lose it changes at once")
end

-- A spec word in the note with no slot here shows as one ---------------------------------------------------------------
do
  CRT.db.timeline.healerSlots[3001] = nil
  setNote({ "time:20;ph:1;tag:RestoShaman2;spellid:108280;", "time:30;ph:1;tag:mistweaver;spellid:115310;" })
  v:Refresh()
  local head = lane(v, "healers:slot:264:2")
  check(head and head.label == "Resto Shaman" and #flagsOn(v, laneIndex(v, "healers:slot:264:2:108280")) == 1,
    "RestoShaman2 from the note: its slot and its cast")
  check(lane(v, "healers:slot:270:1") and #flagsOn(v, laneIndex(v, "healers:slot:270:1:115310")) == 1, "a plain word in any case: slot 1")
  check(CRT.db.timeline.healerSlots[3001] == nil, "not kept until it is changed")
  HV.DoubleClick(v, 90, v.lanes[laneIndex(v, "healers:slot:264:2:98008")])
  local saved = CRT.db.timeline.healerSlots[3001]
  check(saved and #saved == 1 and saved[1].spec == 264 and saved[1].n == 2, "a cast on it keeps it, with its number")
  check(laneIndex(v, "healers:rain-home") == nil, "Rain (a shaman playing damage) gets no rows from it")
end

-- Not the raid leader or an assistant: the slots are your own; the note stays -------------------------------------------
do
  setNote({ "time:20;ph:1;tag:RestoDruid;spellid:740;" })
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1 } }
  group.leader = false
  v:Refresh()
  check(lane(v, "healers:slot:105:1").label == "Resto Druid" .. DOT .. "locked", "an open slot is locked for you")
  local np = #printed
  HV.DoubleClick(v, 100, v.lanes[laneIndex(v, "healers:slot:105:1:740")])
  check(#N:RawLines(1) == 2 and #R:List(3001) == 1 and printed[#printed]:find("for you", 1, true),
    "a cast on an open slot: one of your reminders, the raid note as it was")
  CRT.db.alerts.reminders = {}
  find(find(headerMenu(v, "healers:slot:105:1").items, "Assign player").items, "Leafy").fn()
  check(CRT.db.timeline.healerSlots[3001][1].player == "Leafy-Home" and N:Parsed(1).timers[1].tags[1] == "RestoDruid",
    "Assign changes your slot, not the raid note")
  find(headerMenu(v, "healers:leafy-home").items, "Remove slot").fn()
  check(asked == nil and CRT.db.timeline.healerSlots[3001] == nil and N:Parsed(1).timers[1].tags[1] == "RestoDruid",
    "Remove takes your slot away at once; the note keeps its line")
  group.leader = true
  setNote({})
  CRT.db.timeline.healerSlots = {}
  v:Refresh()
  check(laneIndex(v, "healers:slot:105:1") == nil, "no slots, no slot rows")
end

-- #1225: Healer CDs follows Timeline > Settings > Icon size, as the Abilities layout does -----------------------------
do
  setNote({ "time:20;ph:1;tag:Halo;spellid:64843;", "time:40;ph:1;tag:RestoDruid;spellid:740;" })
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1 } }
  local function abilityIcon(a)
    for _, b in ipairs(a.icons) do if b:IsShown() and b.lane and b.lane.label == "Surge" then return b end end
  end
  for _, size in ipairs({ 18, 28 }) do
    CRT.Timeline:Set("iconSize", size)
    local a = View.Create(mock("Frame"))
    a:SetData({ reference = ref }, 3001, nil, "Nek")
    local ai = abilityIcon(a)
    local h = newView()
    for _, key in ipairs({ "healers:halo-home:64843", "healers:slot:105:1:740" }) do
      local row = laneIndex(h, key)
      local f = flagsOn(h, row)[1]
      check(ai and ai.w == size and f and f.w == size and f.h == size and f.icon.w == size - 2,
        size .. " px: a cast on " .. key .. " is the Abilities icon's size: " .. tostring(f and f.w) .. " vs " .. tostring(ai and ai.w))
      local p = h.hvPairs[View.BandKey(f.mark)]
      check(p and p.fill.h == size and p.fill.pt[5] == -(row - 1) * View.ROW_H - (View.ROW_H - size) / 2,
        size .. " px: its band is as tall as its icon, centred on its row")
      check(h.labels[row].h == a.labels[1].h, size .. " px: the row is as high as an Abilities row")
      h:Select(f.mark)
      local sel
      for _, tx in ipairs(h.bandTex or {}) do if tx:IsShown() and tx.h > 1 then sel = tx end end
      check(sel and sel.h == size, size .. " px: a selected cast's bands too: " .. tostring(sel and sel.h))
      h:ClearSelection()
    end
    local head = laneIndex(h, "healers:slot:105:1")
    check(h.labels[head].h == a.labels[1].h and h.labels[laneIndex(h, "healers:halo-home")].h == a.labels[1].h,
      size .. " px: the healer and slot name rows are Abilities rows' height")
    -- the rows follow the icon size too (View.RowHeight), every row of both layouts alike
    local rowH = View.RowHeight(size)
    check(View.ROW_H == rowH and rowH == size + (View.RowHeight(22) - 22) and View.RowHeight(22) == 30,
      size .. " px: rows are " .. rowH .. " high; the default's stay 30")
    local same, kinds = true, {}
    for i, l in ipairs(a.lanes) do
      kinds[l.kind] = true
      if a.labels[i].h ~= rowH then same = false end
    end
    for i in ipairs(h.lanes) do if h.labels[i].h ~= rowH then same = false end end
    check(same and kinds.notes and kinds.personal, size .. " px: every Abilities row (Notes and Personal notes too) and every Healer CDs row is " .. rowH)
    local si
    for i, l in ipairs(a.lanes) do if l.label == "Surge" then si = i end end
    check(ai.pt[5] == -(si - 1) * rowH - rowH / 2, size .. " px: an Abilities icon sits in the middle of its shorter or taller row")
    local hymn = laneIndex(h, "healers:halo-home:64843")
    local hf = flagsOn(h, hymn)[1]
    check(hf.pt[5] == -(hymn - 1) * rowH - rowH / 2, size .. " px: and a healer cast in the middle of its row")
    check(h:LaneAtY((hymn - 1) * rowH + 1) == h.lanes[hymn], size .. " px: the cursor finds the row at its new height")
    check(h:ContentHeight() == (h.axisH or 20) + #h.lanes * rowH + h.stripH + 16 + 10 + 4, size .. " px: the pop-out's height counts the new rows")
  end
  -- a live change: the open view drawn again follows it
  local h = newView()
  CRT.Timeline:Set("iconSize", 20)
  h:Refresh()
  check(flagsOn(h, laneIndex(h, "healers:halo-home:64843"))[1].w == 20 and HV.CastW() == 20, "the slider's new size on the next draw")
  CRT.Timeline:Set("iconSize", 22)
  setNote({})
  CRT.db.timeline.healerSlots = {}
end

-- Review round 1: only the shown note changes; a plain word keeps its meaning; a shared line keeps its others ------------
do
  -- a Mythic note and a Heroic note: Remove on the Mythic view leaves the Heroic note byte for byte
  local HEROIC = "EncounterID:3001;Difficulty:Heroic;Name:Nek\\r\\ntime:20;ph:1;tag:RestoDruid;spellid:740;\\r\\n"
  CRT.db.notes.list = {
    [1] = { raw = "EncounterID:3001;Difficulty:Mythic;Name:Nek\\ntime:30;ph:1;tag:RestoDruid;spellid:740;", encounterID = 3001,
      difficulty = "Mythic", name = "Nek" },
    [2] = { raw = HEROIC, encounterID = 3001, difficulty = "Heroic", name = "Nek" },
  }
  CRT.db.notes.nextId = 3
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1 } }
  local mv = View.Create(mock("Frame"))
  mv:SetData({ reference = ref }, 3001, nil, "Nek", "mythic")
  mv:SetMode("healers")
  local ids = table.concat(mv:ShownNoteIds(), ",")
  check(ids == "1", "the Mythic view shows the Mythic note only: " .. ids)
  find(headerMenu(mv, "healers:slot:105:1").items, "Remove slot").fn()
  check(asked and asked.text:find("Its 1 planned cast", 1, true), "it counts the Mythic note's cast only: " .. tostring(asked and asked.text))
  asked.callback()
  asked = nil
  check(#N:Parsed(1).timers == 0 and N:Get(2).raw == HEROIC, "the Mythic line left; the Heroic note is byte for byte as it was")
  -- Assign on the Mythic view leaves the Heroic note's word too
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1 } }
  mv:Refresh()
  find(find(headerMenu(mv, "healers:slot:105:1").items, "Assign player").items, "Type a name").fn()
  typeName("Bramble")
  check(N:Get(2).raw == HEROIC, "Assign on Mythic leaves the Heroic note as it was")

  -- a plain word keeps its meaning when its spec gets a second slot: RestoDruid becomes RestoDruid1
  setNote({ "time:20;ph:1;tag:RestoDruid;spellid:740;" })
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1 } }
  setLayout({ "Halo-Home", "Me-Home", "Leafy-Home", "Bark-Home" })
  liveRoster = { { "Halo", "PRIEST", "HEALER" }, { "Me", "PALADIN", "HEALER" }, { "Leafy", "DRUID", "HEALER" }, { "Bark", "DRUID", "HEALER" } }
  CRT.db.specCache["leafy-home"], CRT.db.specCache["bark-home"] = 105, 105
  now = now + 10
  S.Reset()
  v:Refresh()
  local function first() return N:Parsed(1).timers[1] end
  local e = S.Read("RestoDruid")
  check(#S.Matching(e, nil, first().specInfo) == 2, "before: RestoDruid alerts both Resto Druids")
  v.hvAdd.buttons.add.OnClick(v.hvAdd.buttons.add)
  menus[#menus].items[2].fn()
  check(first().tags[1] == "RestoDruid1", "a second slot: slot 1's line says RestoDruid1: " .. first().tags[1])
  check(#S.Matching(e, 1, first().specInfo) == 0, "and alerts neither Resto Druid (two of them in the raid)")
  check(#flagsOn(v, laneIndex(v, "healers:slot:105:1:740")) == 1, "still drawn on slot 1")
  -- the same when Change spec brings a second slot of a spec
  setNote({ "time:20;ph:1;tag:RestoDruid;spellid:740;" })
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1 }, { spec = 257, n = 1 } }
  v:Refresh()
  find(find(headerMenu(v, "healers:slot:257:1").items, "Change spec").items, "Resto Druid").fn()
  check(first().tags[1] == "RestoDruid1" and CRT.db.timeline.healerSlots[3001][2].n == 2,
    "Change spec into Resto Druid: the other's line says RestoDruid1, the changed slot is 2")

  -- Remove: a line naming others too keeps them, without the slot's word
  setNote({ "time:20;ph:1;tag:RestoDruid Bob;spellid:740;", "time:50;ph:1;tag:RestoDruid;spellid:33891;" })
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1 } }
  v:Refresh()
  find(headerMenu(v, "healers:slot:105:1").items, "Remove slot").fn()
  check(asked and asked.text:find("Its 2 planned casts", 1, true), "two lines are the slot's")
  asked.callback()
  asked = nil
  local t = N:Parsed(1).timers
  check(#t == 1 and #t[1].tags == 1 and t[1].tags[1] == "Bob" and t[1].spellId == 740, "the shared line stays for Bob; the other leaves")

  -- Change spec to another class takes the player off
  setNote({ "time:20;ph:1;tag:Leafy;spellid:740;" })
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1, player = "Leafy-Home" } }
  v:Refresh()
  find(find(headerMenu(v, "healers:leafy-home").items, "Change spec").items, "Holy Priest").fn()
  check(asked and asked.text == "Change Resto Druid to Holy Priest? 1 planned cast leaves the raid note: every cast of these cooldowns that names Leafy.",
    "asked, naming Leafy's casts: " .. tostring(asked and asked.text))
  asked.callback()
  asked = nil
  local saved = CRT.db.timeline.healerSlots[3001][1]
  check(saved.spec == 257 and saved.player == nil and #N:Parsed(1).timers == 0, "a Holy Priest slot with no player; Leafy's Tranquility left")
  setNote({})
  CRT.db.timeline.healerSlots = {}
  CRT.db.specCache["bark-home"] = nil
end

-- #1280: a player from another realm goes into the note without the realm, and Clear player still finds their lines
do
  setNote({ "time:20;ph:1;tag:RestoDruid;spellid:740;" })
  CRT.db.timeline.healerSlots[3001] = { { spec = 105, n = 1 } }
  v:Refresh()
  find(find(headerMenu(v, "healers:slot:105:1").items, "Assign player").items, "Type a name").fn()
  typeName("Bramble-Away")
  local t = N:Parsed(1).timers[1]
  check(CRT.db.timeline.healerSlots[3001][1].player == "Bramble-Away" and t.tags[1] == "Bramble",
    "the slot keeps the realm, the note's line has none: " .. tostring(N:Get(1).raw))
  find(headerMenu(v, "healers:bramble-away").items, "Clear player").fn()
  t = N:Parsed(1).timers[1]
  check(t.tags[1] == "RestoDruid", "Clear player finds the line by the plain name: " .. tostring(t.tags[1]))
  setNote({})
  CRT.db.timeline.healerSlots = {}
end

if fails > 0 then error(fails .. " healer slot checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, FILES.length + 4); // more files than the stack holds by default
for (const f of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, f), 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
