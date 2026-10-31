// Timeline: your own order of the healers and their spell rows on Healer CDs (CRT_Modules/Timeline/HealerOrder.lua, built
// in by HealerView.lua) and the order sent with a pushed note (HealerOrderShare.lua, from Notes/Comm.lua's Share):
//   a saved order applies and healers not in it come after; a dragged block takes its spell rows and never lands
//   inside another block; a spell drag stays in its block and holds on another boss; a click with no movement, Esc,
//   combat and a release off the list change nothing; + Add healer stays last; the order goes with a pushed note,
//   a raider takes it, the leader ignores it, a non-lead's is ignored, malformed data is dropped.
// Usage: node run_healer_order.js <addon folder>
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
  'CRT_Core/Comm.lua', 'CRT_Modules/Notes/Comm.lua', 'CRT_Modules/Timeline/HealerOrder.lua', 'CRT_Modules/Timeline/HealerOrderShare.lua',
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
wipe = wipe or function(t) for k in pairs(t) do t[k] = nil end return t end
format = format or string.format
function IsInGuild() return false end
function GetGuildInfo() return nil end
run("CRT_Core/Comm.lua", CRT)
run("CRT_Modules/Notes/Comm.lua", CRT)
run("CRT_Modules/Timeline/HealerOrder.lua", CRT)
run("CRT_Modules/Timeline/HealerOrderShare.lua", CRT)

local fails = 0
local function check(ok, what) if ok then print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local View, HV, N = CRT.TimelineView, CRT.TimelineHealerView, CRT.Notes
local O, Share = CRT.TimelineHealerOrder, CRT.HealerOrderShare
check(O ~= nil and Share ~= nil, "CRT.TimelineHealerOrder and CRT.HealerOrderShare are loaded")

local function parse(id, name)
  return assert(CRT.TimelineReference.Parse("Boss: " .. name .. "\\nEncounter: " .. id .. "\\nLength: 5:00\\nPhase: P1 0:00\\nSurge [spell 4242] (type raid): 0:20"))
end
local ref, ref2 = parse(3001, "Nek"), parse(3002, "Two")
local function setLayout(names) local w = {} for i = 1, 40 do w[i] = names[i] or "" end
  CRT.db.groups.presets = { { id = 1, name = "Main", slots = w } } CRT.db.groups.active = 1 end
-- Halo (a priest healer, spec unknown: every priest major), Rain (damage), you (a Holy paladin healer); a Resto Druid slot
setLayout({ "Halo-Home", "Rain-Home", "Me-Home" })
liveRoster = { { "Halo", "PRIEST", "HEALER" }, { "Rain", "SHAMAN", "DAMAGER" }, { "Me", "PALADIN", "HEALER" } }
local function setNote(lines)
  CRT.db.notes.list = { [1] = { raw = "EncounterID:3001;Name:Nek\\n" .. table.concat(lines, "\\n"), encounterID = 3001, name = "Nek" } }
  CRT.db.notes.nextId = 2
end
setNote({})
CRT.db.timeline.healerSlots = { [3001] = { { spec = 105, n = 1 } } }
CRT.db.specCache = {}
CRT.PALETTE.warn = { 1, 0.6, 0.2 }
local over = true
local function newView(r, id)
  local v = View.Create(mock("Frame"))
  v:SetData({ reference = r or ref }, id or 3001, nil, "Nek")
  v:SetMode("healers")
  v.vscroll.IsMouseOver = function() return over end
  return v
end
local function order(v)
  local out = {}
  for _, l in ipairs(v.lanes) do if l.kind == "healer" then out[#out + 1] = l.hvOrder and l.hvOrder.key or ("?" .. l.key) end end
  return table.concat(out, ",")
end
local function nameRow(v, key)
  for i, l in ipairs(v.lanes) do if l.kind == "healer" and l.hvOrder and l.hvOrder.key == key then return i end end
end
-- the spell rows right under key's name row, as spell IDs
local function spells(v, key)
  local out, i = {}, nameRow(v, key)
  if not i then return out end
  i = i + 1
  while v.lanes[i] and v.lanes[i].kind == "healercd" and v.lanes[i].hvOrder and v.lanes[i].hvOrder.key == key do
    out[#out + 1] = v.lanes[i].spellID
    i = i + 1
  end
  return out
end
local function ids(t) local out = {} for i, x in ipairs(t or {}) do out[i] = tostring(x) end return table.concat(out, ",") end
local function mid(v, i) return v:RowTop(i) + v:RowH(i) / 2 end
local function lineAt(v) local pt = v.hvDragFrame.line.pt return pt and -(pt[5] - 1) end
local function addRow(v) for i, l in ipairs(v.lanes) do if l.kind == "hvpanel" and l.panel == "add" then return i end end end
local function lastHealerRow(v) local n = 0 for i, l in ipairs(v.lanes) do if l.kind == "healer" or l.kind == "healercd" then n = i end end return n end
local function saved(id) return ids(CRT.db.timeline.healerOrder and CRT.db.timeline.healerOrder[id]) end
local DOT = " " .. string.char(194, 183) .. " "

-- The order ------------------------------------------------------------------------------------------------------
local v = newView()
check(order(v) == "halo-home,me-home,slot:105:1", "by default: the roster's healers, then the slots: " .. order(v))
check(v.lanes[nameRow(v, "slot:105:1")].hvOrder.spellKey == "spec:105" and v.lanes[nameRow(v, "halo-home")].hvOrder.spellKey == "halo-home",
  "a spell order is kept by the player's key, or an open slot's spec")
check(HV.TEXT.hint:find("drag a name to reorder", 1, true) and HV.TEXT.hintOwn:find("drag a name to reorder", 1, true),
  "the hint lines mention dragging names")
check(#HV.TEXT.hint * 6 <= 760 - 16 and #HV.TEXT.hintOwn * 6 <= 760 - 16, "both hints fit the pop-out at its smallest")
CRT.db.timeline.healerOrder = { [3001] = { "slot:105:1", "gone-home", "halo-home" } }
v:Refresh()
check(order(v) == "slot:105:1,halo-home,me-home", "a saved order applies; a healer not in it comes after: " .. order(v))
check(saved(3001) == "slot:105:1,gone-home,halo-home", "the key of a player who left is kept")
check(addRow(v) and addRow(v) > lastHealerRow(v), "+ Add healer stays under the healers")
local hs = spells(v, "halo-home")
check(#hs >= 3, "Halo has several spell rows: " .. ids(hs))
CRT.db.timeline.healerSpellOrder = { ["halo-home"] = { hs[3], 999999 } }
v:Refresh()
local hs2 = spells(v, "halo-home")
check(hs2[1] == hs[3] and hs2[2] == hs[1] and hs2[3] == hs[2], "a saved spell order applies; the rest after, in their order: " .. ids(hs2))
CRT.db.timeline.healerOrder, CRT.db.timeline.healerSpellOrder = {}, {}
v:Refresh()

-- A click with no movement -----------------------------------------------------------------------------------
do
  local i = nameRow(v, "me-home")
  check(O.Press(v, v.lanes[i], mid(v, i)), "a left press on a name row may drag")
  O.Move(v, mid(v, i) + 2)
  check(v.hvDrag and not v.hvDrag.started, "two pixels are not a drag")
  check(not O.Release(v), "let go: nothing saved")
  check(order(v) == "halo-home,me-home,slot:105:1" and CRT.db.timeline.healerOrder[3001] == nil, "the order stays as it was")
  check(not O.Press(v, v.lanes[addRow(v)], 0), "+ Add healer's row doesn't drag")
  check(HV.LabelMenu(v, v.labels[i], v.lanes[i]), "a right-click still opens the rows menu")
end

-- Dragging a block -------------------------------------------------------------------------------------------
do
  local meSpells = ids(spells(v, "me-home"))
  local i = nameRow(v, "me-home")
  local h = nameRow(v, "halo-home")
  O.Press(v, v.lanes[i], mid(v, i))
  -- over Halo's second spell row: inside Halo's block, so the line is at one of the blocks' edges
  O.Move(v, mid(v, h + 2))
  check(v.hvDrag.started, "past a few pixels it is a drag")
  local edges = {}
  for _, b in ipairs(O.Blocks(v)) do edges[v:RowTop(b.first)] = true edges[v:RowTop(b.last + 1)] = true end
  check(edges[lineAt(v)] == true, "the drop line sits between blocks, never inside one: " .. tostring(lineAt(v)))
  check(v.labels[i].alpha == 0.4 and v.labels[i + 1].alpha == 0.4, "the held block dims, its spell rows too")
  O.Move(v, mid(v, h))
  check(v.hvDrag.gap == 1 and lineAt(v) == v:RowTop(h), "over Halo's name: the line above Halo's block")
  check(O.Release(v), "let go over the list: saved")
  check(order(v) == "me-home,halo-home,slot:105:1", "Me's block moved above Halo: " .. order(v))
  check(ids(spells(v, "me-home")) == meSpells and nameRow(v, "me-home") == h, "Me's spell rows moved with Me's name")
  check(saved(3001) == "me-home,halo-home,slot:105:1", "the boss's order is saved: " .. saved(3001))
  local dimmed = false
  for _, l in ipairs(v.labels) do if l.alpha == 0.4 then dimmed = true end end
  check(not dimmed, "nothing stays dimmed")
  check(addRow(v) > lastHealerRow(v), "+ Add healer still last")
  -- the slot to the top, then Halo below everyone
  local s = nameRow(v, "slot:105:1")
  O.Press(v, v.lanes[s], mid(v, s))
  O.Move(v, 0)
  O.Release(v)
  check(order(v) == "slot:105:1,me-home,halo-home", "the slot to the top: " .. order(v))
  h = nameRow(v, "halo-home")
  O.Press(v, v.lanes[h], mid(v, h))
  O.Move(v, mid(v, addRow(v)) + 200)
  check(lineAt(v) == v:RowTop(lastHealerRow(v) + 1), "below the list: the line under the last block, over + Add healer")
  check(not O.Release(v), "Halo was already last: nothing saved")
  check(addRow(v) > lastHealerRow(v), "+ Add healer still last")
end

-- Dragging a spell ----------------------------------------------------------------------------------------------
do
  local h = nameRow(v, "halo-home")
  local before = spells(v, "halo-home")
  local healers = order(v)
  O.Press(v, v.lanes[h + 2], mid(v, h + 2))
  O.Move(v, mid(v, h) - 300) -- far above, past every block
  check(lineAt(v) == v:RowTop(h + 1), "a spell's line stays in its block: above its first spell row")
  O.Move(v, mid(v, addRow(v)) + 300)
  check(lineAt(v) == v:RowTop(h + #before + 1), "and under its last")
  check(v.labels[h + 2].alpha == 0.4 and v.labels[h].alpha ~= 0.4, "only the spell row dims")
  O.Move(v, v:RowTop(h + 1) + 1)
  check(O.Release(v), "dropped above the first spell: saved")
  local after = spells(v, "halo-home")
  check(after[1] == before[2] and after[2] == before[1] and #after == #before, "only that spell moved: " .. ids(after))
  check(order(v) == healers, "the healers' order is as it was")
  check(ids(CRT.db.timeline.healerSpellOrder["halo-home"]) == ids(after), "Halo's spell order is saved: " .. ids(CRT.db.timeline.healerSpellOrder["halo-home"]))
  local v2 = newView(ref2, 3002)
  check(ids(spells(v2, "halo-home")) == ids(after), "on another boss Halo's spells are in the same order")
  check(order(v2) == "halo-home,me-home", "and the healers in that boss's own order: " .. order(v2))
  -- a slot's spells, by its spec
  local s = nameRow(v, "slot:105:1")
  local slotSpells = spells(v, "slot:105:1")
  if #slotSpells >= 2 then
    O.Press(v, v.lanes[s + 2], mid(v, s + 2))
    O.Move(v, v:RowTop(s + 1) + 1)
    O.Release(v)
    check(ids(CRT.db.timeline.healerSpellOrder["spec:105"]) == ids(spells(v, "slot:105:1")) and spells(v, "slot:105:1")[1] == slotSpells[2],
      "an open slot's spell order is kept by its spec")
  else
    check(true, "the slot has one spell row: nothing to order")
  end
end

-- Cancelling ------------------------------------------------------------------------------------------------------
do
  local was, wasSpells = order(v), ids(spells(v, "halo-home"))
  local h = nameRow(v, "halo-home")
  O.Press(v, v.lanes[h], mid(v, h))
  O.Move(v, 0)
  local f = v.hvDragFrame
  f:GetScript("OnKeyDown")(f, "ESCAPE")
  check(v.hvDrag == nil and not f.line.shown, "Esc lets go of it")
  check(order(v) == was and v.labels[h].alpha ~= 0.4, "and the order is as it was")
  check(not O.Release(v), "a release after Esc does nothing")
  O.Press(v, v.lanes[h], mid(v, h))
  O.Move(v, 0)
  over = false
  check(not O.Release(v) and order(v) == was, "let go off the list: nothing changes")
  over = true
  O.Press(v, v.lanes[h + 1], mid(v, h + 1))
  O.Move(v, mid(v, h + 3))
  O.Cancel(v)
  check(ids(spells(v, "halo-home")) == wasSpells, "a cancelled spell drag changes nothing")
  inCombat = true
  check(not O.Press(v, v.lanes[h], mid(v, h)), "no drag in combat")
  inCombat = false
  O.Press(v, v.lanes[h], mid(v, h))
  O.Move(v, 0)
  inCombat = true
  O.Update(v)
  inCombat = false
  check(v.hvDrag == nil and order(v) == was, "combat cancels a held drag")
end

-- The labels' own scripts: press, the frame's update while held, release -------------------------------------------
do
  local h = nameRow(v, "halo-home")
  local l = v.labels[h]
  check(rawget(l, "OnMouseDown") ~= nil and rawget(l, "OnMouseUp") ~= nil and rawget(l, "hvGrip") ~= nil, "each label has the drag and its grip")
  cy = 500 - mid(v, h)
  l.OnMouseDown(l, "LeftButton")
  cy = 500 - 1
  mouseDown = true
  v.hvDragFrame.OnUpdate(v.hvDragFrame)
  check(v.hvDrag and v.hvDrag.started and v.hvDrag.gap == 1, "the frame follows the cursor while the button is held")
  l.OnMouseUp(l, "LeftButton")
  check(order(v):find("^halo%-home,") ~= nil, "let go: Halo is first: " .. order(v))
  -- a release the label never heard: the frame sees the button is up
  local s = nameRow(v, "slot:105:1")
  local ls = v.labels[s]
  cy = 500 - mid(v, s)
  ls.OnMouseDown(ls, "LeftButton")
  cy = 500 - 1
  v.hvDragFrame.OnUpdate(v.hvDragFrame)
  mouseDown = false
  v.hvDragFrame.OnUpdate(v.hvDragFrame)
  mouseDown = true
  check(v.hvDrag == nil and order(v):find("^slot:105:1,") ~= nil, "the button let go elsewhere still drops it: " .. order(v))
end

-- A drag held while the rows are built again, or the view leaves Healer CDs; the keyboard after a drag -------------
do
  local f = v.hvDragFrame
  f.EnableKeyboard = function(self, on) rawset(self, "kb", on and true or false) end
  local was = order(v)
  local h = nameRow(v, "halo-home")
  O.Press(v, v.lanes[h], mid(v, h))
  check(f.kb == true, "a press takes Esc from the keyboard")
  O.Move(v, 0)
  v:Refresh()
  local dimmed = false
  for _, l in ipairs(v.labels) do if l.alpha == 0.4 then dimmed = true end end
  check(v.hvDrag == nil and not dimmed and order(v) == was, "the rows built again: the held drag is dropped, nothing dimmed")
  check(f.kb == false and not f.shown, "and the keyboard is the game's again")
  O.Press(v, v.lanes[h], mid(v, h))
  O.Move(v, 0)
  v.mode = nil
  O.Update(v)
  v.mode = "healers"
  check(v.hvDrag == nil and order(v) == was and f.kb == false, "the view leaves Healer CDs: the drag is dropped")
end

-- A long list of players who left is cut, so a saved order never passes the limit -----------------------------------
do
  local long = {}
  for i = 1, 80 do long[i] = "gone" .. i .. "-home" end
  CRT.db.timeline.healerOrder[3001] = long
  v:Refresh()
  local h = nameRow(v, "me-home")
  O.Press(v, v.lanes[h], mid(v, h))
  O.Move(v, 0)
  O.Release(v)
  local list = CRT.db.timeline.healerOrder[3001]
  check(#list == O.MAX_KEYS and list[1] == "me-home" and list[4] == "gone1-home", "the shown order first, then players who left up to " .. O.MAX_KEYS .. ": " .. #list)
end

-- An open slot gets a player: the block keeps its place, and the player starts from the spec's spell order ----------
do
  local keepSlots, keepOrder, keepSpells = CRT.db.timeline.healerSlots, CRT.db.timeline.healerOrder, CRT.db.timeline.healerSpellOrder
  CRT.db.timeline.healerSlots = { [3001] = { { spec = 105, n = 1 } } }
  CRT.db.timeline.healerOrder = { [3001] = { "me-home", "slot:105:1", "halo-home" } }
  CRT.db.timeline.healerSpellOrder = { ["spec:105"] = { 740, 33891 } }
  v:Refresh()
  local Slots = CRT.TimelineHealerSlots
  Slots.Assign(Slots.Context(v), v.hvSlots[1], "Leafy")
  v:Refresh()
  check(saved(3001) == "me-home,leafy-home,halo-home", "the slot's place goes to Leafy: " .. saved(3001))
  check(ids(CRT.db.timeline.healerSpellOrder["leafy-home"]) == "740,33891", "Leafy starts from the Resto Druid slot's spell order")
  check(order(v) == "me-home,leafy-home,halo-home", "drawn in that order: " .. order(v))
  -- a player who has a spell order and a place already: their own spell order stays, the slot's place is theirs
  CRT.db.timeline.healerSlots = { [3001] = { { spec = 105, n = 1 } } }
  CRT.db.timeline.healerOrder = { [3001] = { "halo-home", "me-home", "slot:105:1" } }
  CRT.db.timeline.healerSpellOrder = { ["spec:105"] = { 740 }, ["halo-home"] = { 5 } }
  v:Refresh()
  Slots.Assign(Slots.Context(v), v.hvSlots[1], "Halo")
  check(saved(3001) == "me-home,halo-home" and ids(CRT.db.timeline.healerSpellOrder["halo-home"]) == "5",
    "once in the order, at the slot's place, with their own spells: " .. saved(3001))
  -- cleared: Halo is still a roster healer, so the slot comes back right after him
  v:Refresh()
  Slots.Clear(Slots.Context(v), v.hvSlots[1])
  check(saved(3001) == "me-home,halo-home,slot:105:1", "Clear: the slot back right after a roster healer: " .. saved(3001))
  -- Leafy (not a roster healer) at the slot's place; a second player takes Leafy's place; Clear puts the slot back there
  CRT.db.timeline.healerOrder = { [3001] = { "me-home", "slot:105:1", "halo-home" } }
  v:Refresh()
  Slots.Assign(Slots.Context(v), v.hvSlots[1], "Leafy")
  v:Refresh()
  Slots.Assign(Slots.Context(v), v.hvSlots[1], "Bramble")
  check(saved(3001) == "me-home,bramble-home,halo-home", "another player takes the old player's place: " .. saved(3001))
  v:Refresh()
  Slots.Clear(Slots.Context(v), v.hvSlots[1])
  check(saved(3001) == "me-home,slot:105:1,halo-home", "Clear: the slot key back at the player's place: " .. saved(3001))
  -- Change spec: the slot's new key keeps the place
  v:Refresh()
  check(Slots.ChangeSpec(Slots.Context(v), v.hvSlots[1], 264) == true, "the slot becomes a Resto Shaman")
  check(saved(3001) == "me-home,slot:264:1,halo-home", "Change spec: the new key keeps the place: " .. saved(3001))
  v:Refresh()
  check(order(v) == "me-home,slot:264:1,halo-home", "drawn there: " .. order(v))
  -- Remove: the key goes, so a new slot with the same number doesn't take the old place
  Slots.Remove(Slots.Context(v), v.hvSlots[1], true)
  check(saved(3001) == "me-home,halo-home", "Remove: the slot's key leaves the order: " .. saved(3001))
  v:Refresh()
  Slots.Add(Slots.Context(v), 264)
  v:Refresh()
  check(order(v) == "me-home,halo-home,slot:264:1", "a new slot with the old number comes at the bottom: " .. order(v))
  CRT.db.timeline.healerSlots, CRT.db.timeline.healerOrder, CRT.db.timeline.healerSpellOrder = keepSlots, keepOrder, keepSpells
  CRT.db.timeline.healerOrder[3001] = { "slot:105:1", "halo-home", "me-home" }
  v:Refresh()
end

-- Saved data ----------------------------------------------------------------------------------------------------------
do
  local core, profiles = src[#FILES - 1], src[#FILES]
  check(core:find("healerOrder = {},", 1, true) and core:find("healerSpellOrder = {},", 1, true), "Core.lua gives both their defaults")
  check(profiles:find("healerOrder = false", 1, true) and profiles:find("healerSpellOrder = false", 1, true), "Export settings only never takes them")
  local orderStore, spellStore = false, false
  for _, s in ipairs(CRT.Bosses:Stores()) do
    local ok, t = pcall(s.getter, CRT.db)
    if ok and t == CRT.db.timeline.healerOrder then orderStore = true end
    if ok and t == CRT.db.timeline.healerSpellOrder then spellStore = true end
  end
  check(orderStore and not spellStore, "the per-boss order is declared for the season purge; the spell order is not")
end

-- Sent with a pushed note -----------------------------------------------------------------------------------------
local others = {}
function UnitIsGroupLeader(u) if u == "player" then return group.leader end return others[u] == "lead" end
function UnitIsGroupAssistant(u) if u == "player" then return group.assist end return others[u] == "assist" end
local function ours() local out = {} for _, m in ipairs(sent) do if m[1] == "CRTHealOrd1" then out[#out + 1] = m[2] end end return out end
check(Share.PREFIX == "CRTHealOrd1" and #Share.PREFIX <= 16, "its own prefix, at most 16 characters")
do
  -- what is sent is the view as drawn: every healer in its place, every one's spell rows in theirs
  local function matches(view, id, note)
    local eid, healers, sp = Share.Read(Share.Text(id, note))
    local ok = eid == id and ids(healers) == order(view)
    for _, l in ipairs(view.lanes) do
      if l.kind == "healer" and l.hvOrder then
        local want = ids(spells(view, l.hvOrder.key))
        if want ~= "" and ids(sp and sp[l.hvOrder.spellKey]) ~= want then ok = false end
      end
    end
    return ok, ids(healers)
  end
  v:Refresh()
  local same, what = matches(v, 3001)
  check(same, "the text reads back as the view shows it: " .. what .. " vs " .. order(v))
  local keepSpells, keepOrder = CRT.db.timeline.healerSpellOrder, CRT.db.timeline.healerOrder
  CRT.db.timeline.healerSpellOrder, CRT.db.timeline.healerOrder = {}, {}
  local v2 = newView(ref2, 3002)
  same, what = matches(v2, 3002)
  check(same and what == "halo-home,me-home", "nothing saved: the default order is still sent, as drawn: " .. what)
  CRT.db.timeline.healerSpellOrder, CRT.db.timeline.healerOrder = keepSpells, keepOrder
  -- someone the raid note gives a listed cooldown, not on the roster, keeps their place; a deleted slot's key doesn't go
  setNote({ "time:20;ph:1;tag:Zed;spellid:" .. spells(v, "halo-home")[1] .. ";" })
  v:Refresh()
  check(nameRow(v, "zed") ~= nil, "the note gives Zed a block: " .. order(v))
  CRT.db.timeline.healerOrder[3001] = { "zed", "slot:257:4", "me-home", "halo-home", "slot:105:1" }
  v:Refresh()
  same, what = matches(v, 3001, 1)
  check(same and what == "zed,me-home,halo-home,slot:105:1", "Zed sent in his place, the deleted slot not: " .. what)
  CRT.db.timeline.healerOrder[3001] = keepOrder[3001]
  setNote({})
  v:Refresh()
  -- the raid leader shares the boss's note: the order goes with it
  group.leader, group.raid = true, true
  setNote({})
  for i = #sent, 1, -1 do sent[i] = nil end
  CRT.NoteComm:Share(1)
  local got = ours()
  check(#got >= 1, "sharing the boss's note sends its healer order: " .. #got .. " message(s)")
  for _, m in ipairs(got) do check(#m < 255, "a message under 255 bytes") end
  CRT.NoteComm:Share(1)
  check(#ours() == #got, "a second push straight after (a double click): not sent twice")
  now = now + 10
  check(Share:Push(3001) and #ours() == 2 * #got, "a push later goes again, unchanged: late joiners get it")
  -- players who left are never sent
  local keep = CRT.db.timeline.healerOrder[3001]
  CRT.db.timeline.healerOrder[3001] = { "gone-home", "me-home", "halo-home" }
  local _, healers = Share.Read(Share.Text(3001))
  check(ids(healers) == "me-home,halo-home,slot:105:1", "keys not on the boss aren't sent: " .. ids(healers))
  CRT.db.timeline.healerOrder[3001] = keep
  -- no boss order saved: the healers still go, in the default order
  CRT.db.timeline.healerOrder[3001] = nil
  local _, none, sp2 = Share.Read(Share.Text(3001))
  check(ids(none) == "halo-home,me-home,slot:105:1" and sp2["halo-home"] ~= nil, "no boss order: the default order goes: " .. ids(none))
  CRT.db.timeline.healerOrder[3001] = keep
  local n = #ours()
  group.leader = false
  check(not Share:Push(3001) and #ours() == n, "a raider sends nothing")
  group.leader = true
  now = now + 10
  inCombat = true
  local said = #printed
  check(not Share:Push(3001) and #ours() == n, "nothing in combat")
  check(#printed == said + 1 and printed[#printed] == "Healer order not sent during combat or a boss fight.", "and one chat line says why: " .. tostring(printed[#printed]))
  inCombat = false
  local realText = Share.Text
  Share.Text = function() return "3001\\n" .. string.rep("x", 2500) end
  said = #printed
  check(not Share:Push(3001) and #ours() == n and printed[#printed] == Share.TEXT.tooLong and #printed == said + 1,
    "too long for 10 parts: not sent, one chat line: " .. tostring(printed[#printed]))
  Share.Text = realText
  -- the game drops a waiting order (throttled, then the group is gone): the next push goes at once
  local realSend = C_ChatInfo.SendAddonMessage
  local throttled = false
  C_ChatInfo.SendAddonMessage = function(p, t, ch) if p == "CRTHealOrd1" and not throttled then throttled = true return 3 end return realSend(p, t, ch) end
  check(Share:Push(3001), "throttled: it waits")
  group.raid, group.party = false, false
  flush()
  group.raid, group.party = true, true
  C_ChatInfo.SendAddonMessage = realSend
  check(#ours() == n, "dropped: nothing went")
  check(Share:Push(3001) and #ours() > n, "the next push straight after sends it")
  -- a note push never breaks on the order
  local realPush = Share.Push
  Share.Push = function() error("boom") end
  now = now + 10
  local realHandler, reported = geterrorhandler, nil
  geterrorhandler = function() return function(e) reported = e end end
  local ok = pcall(CRT.NoteComm.Share, CRT.NoteComm, 1)
  Share.Push, geterrorhandler = realPush, realHandler
  check(ok and tostring(reported):find("boom", 1, true) ~= nil, "an error in the order's push never breaks the note's; it is reported")
end

-- Received -------------------------------------------------------------------------------------------------------------
do
  group.leader = false -- you are a raider now; Lead leads
  others.Lead = "lead"
  CRT.db.timeline.healerOrder = { [3001] = { "slot:105:1" }, [3002] = { "me-home", "halo-home" } }
  CRT.db.timeline.healerSpellOrder = { ["halo-home"] = { 1 }, ["mine-home"] = { 7, 8 } }
  local lead = Share.Pack("3001\\nme-home\\thalo-home\\nhalo-home\\t5,6")
  local function deliver(list, from, ch) for _, m in ipairs(list) do Share.Receive("CRTHealOrd1", m, ch or "RAID", from) end end
  local said = #printed
  deliver(lead, "Rando-Home")
  check(saved(3001) == "slot:105:1", "from someone who isn't the leader or an assistant: ignored")
  deliver(lead, "Lead-Home", "WHISPER")
  check(saved(3001) == "slot:105:1", "not on a group channel: ignored")
  deliver(lead, "Me-Home")
  check(saved(3001) == "slot:105:1", "your own: ignored")
  deliver(lead, "Lead-Home")
  check(saved(3001) == "me-home,halo-home", "from the leader: the boss's order is theirs")
  check(ids(CRT.db.timeline.healerSpellOrder["halo-home"]) == "5,6", "and the spell order of their healers")
  check(ids(CRT.db.timeline.healerSpellOrder["mine-home"]) == "7,8" and saved(3002) == "me-home,halo-home", "anything else of yours stays")
  check(#printed == said + 1 and printed[#printed]:find("Lead", 1, true), "one chat line: " .. tostring(printed[#printed]))
  check(flush() >= 1, "an open Healer CDs is told to draw again")
  deliver(lead, "Lead-Home")
  check(#printed == said + 1, "the same order again: no second line")
  -- the leader keeps their own, even from an assistant
  group.leader = true
  others.Lead = "assist"
  deliver(Share.Pack("3001\\nhalo-home"), "Lead-Home")
  check(saved(3001) == "me-home,halo-home", "the group's leader ignores it")
  group.leader = false
  deliver(Share.Pack("3001\\nhalo-home"), "Lead-Home")
  check(saved(3001) == "halo-home", "a raider takes an assistant's")
  -- an empty healer line: the lead has only spell orders, so your order for the boss stays
  deliver(Share.Pack("3001\\n\\nhalo-home\\t9,10"), "Lead-Home")
  check(saved(3001) == "halo-home" and ids(CRT.db.timeline.healerSpellOrder["halo-home"]) == "9,10",
    "no healers sent: your boss order stays, the spell order is taken")
  -- a long order in several parts, out of order; and parts that come too late
  local lines = { "3001", "me-home\\thalo-home" }
  for k = 1, 8 do local list = {} for s = 1, 30 do list[s] = tostring(100000 + k * 100 + s) end lines[#lines + 1] = "key" .. k .. "-home\\t" .. table.concat(list, ",") end
  local parts = Share.Pack(table.concat(lines, "\\n"))
  check(#parts > 3, "a long order goes in several parts: " .. #parts)
  for k = #parts, 1, -1 do Share.Receive("CRTHealOrd1", parts[k], "RAID", "Lead-Home") end
  check(saved(3001) == "me-home,halo-home" and CRT.db.timeline.healerSpellOrder["key8-home"] and #CRT.db.timeline.healerSpellOrder["key8-home"] == 30,
    "out of order: put together and taken")
  lines[2] = "halo-home\\tme-home"
  parts = Share.Pack(table.concat(lines, "\\n"))
  Share.Receive("CRTHealOrd1", parts[1], "RAID", "Lead-Home")
  now = now + 60
  for k = 2, #parts do Share.Receive("CRTHealOrd1", parts[k], "RAID", "Lead-Home") end
  check(saved(3001) == "me-home,halo-home", "the first part timed out: nothing taken")
  deliver(parts, "Lead-Home")
  check(saved(3001) == "halo-home,me-home", "sent whole again: taken")
  -- malformed: dropped, never an error
  local bad = { "garbage", "", "zz|1|1|x", "abc|0|1|x", "abc|2|1|x", "abc|1|99|x", "SECRET" }
  for _, text in ipairs({ "notanumber\\nx", "3001", "3001\\na\\ta", "3001\\nx\\nhalo-home\\t1,,2", "3001\\nx\\nhalo-home\\tabc",
    "3001\\nx\\nhalo-home\\t1\\nhalo-home\\t2" }) do
    for _, m in ipairs(Share.Pack(text)) do bad[#bad + 1] = m end
  end
  local damaged = Share.Pack("3001\\nrain-home")
  damaged[1] = damaged[1]:gsub("rain", "rian")
  bad[#bad + 1] = damaged[1]
  for _, m in ipairs(bad) do
    local ok, err = pcall(Share.Receive, "CRTHealOrd1", m, "RAID", "Lead-Home")
    check(ok, "malformed: no error for " .. m:gsub("\\n", "/") .. " " .. tostring(err))
  end
  check(pcall(Share.Receive, "CRTHealOrd1", nil, "RAID", "Lead-Home") and pcall(Share.Receive, "CRTHealOrd1", lead[1], "RAID", nil),
    "malformed: no error for no message or no sender")
  check(saved(3001) == "halo-home,me-home" and ids(CRT.db.timeline.healerSpellOrder["halo-home"]) == "9,10", "malformed: nothing taken")
end

if fails > 0 then error(fails .. " healer order checks failed") end
print("ok healer order: saved per boss and healer, dragged by block or spell, sent with a pushed note")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, FILES.length + 4); // more files than the stack holds by default
for (const f of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(W, f), 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
