// Timeline: the saved alerts strip under the track (chips, drag a chip onto the track, chip menu, "+"),
// and the track's right-click menu (New alert here, Place a saved alert), and the Cooldowns row under the templates.
// Usage: node run_alerts_strip.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua CRT_Modules/Timeline/Lanes.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Alerts/Reminders.lua CRT_Modules/Alerts/Saved.lua CRT_Modules/Timeline/View.lua CRT_Data/Bosses/Registry.lua CRT_Data/Seasons/Midnight-S1/Season.lua CRT_Data/Seasons/Midnight-S1/NekzaliTheSoulcoiler.lua CRT_Core/UI/Panel.lua CRT_Modules/Alerts/Cooldowns.lua CRT_Core/UI/Controls.lua CRT_Modules/Alerts/CooldownData.lua CRT_Modules/Groups/Data.lua CRT_Modules/Alerts/Draft.lua CRT_Modules/Alerts/Roster.lua CRT_Core/Sound/Engine.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local dataSrc, dbSrc, refSrc, lanesSrc, rulesSrc, engineSrc, parseSrc, notesSrc, remSrc, savedSrc, viewSrc, regSrc, seasonSrc, nekSrc, panelSrc, cdSrc, controlsSrc, cdDataSrc, groupsSrc, draftSrc, rosterSrc, soundSrc = ...
local buttons = 0
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
    if k == "SetFrameStrata" then return function(self, v) rawset(self, "strata", v) end end
    if k == "GetFrameStrata" then return function(self) return rawget(self, "strata") or "MEDIUM" end end
    if k == "SetHighlightTexture" then return function(self, tx) local t = mock("Texture") rawset(t, "path", tx) rawset(self, "hl", t) return t end end
    if k == "GetHighlightTexture" then return function(self) local t = rawget(self, "hl") if not t then t = mock("Texture") rawset(self, "hl", t) end return t end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "IsVisible" then return function(self) return rawget(self, "shown") end end
    if k == "GetWidth" then return function(self) return rawget(self, "w") or 600 end end
    if k == "GetHeight" then return function(self) return rawget(self, "h") or 300 end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, a, rel, b, x, y)
      rawset(self, "pt", { a, rel, b, x, y })
      local pts = rawget(self, "pts") or {} pts[a] = { a, rel, b, x, y } rawset(self, "pts", pts) end end
    if k == "ClearAllPoints" then return function(self) rawset(self, "pt", nil) rawset(self, "pts", nil) end end
    if k == "SetColorTexture" then return function(self, r, g, b, a) rawset(self, "color", { r, g, b, a }) end end
    if k == "SetVertexColor" then return function(self, r, g, b) rawset(self, "vcolor", { r, g, b }) end end
    -- retail: a font string with a width set measures at most that width; the unbounded width is the text's own
    if k == "GetStringWidth" then return function(self) local w = #(rawget(self, "text") or "") * 6 local set = rawget(self, "w") return set and math.min(w, set) or w end end
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
    if k == "SetScrollChild" then return function(self, c) rawset(self, "child", c) end end
    if k == "GetValue" then return function(self) return rawget(self, "value") or 0 end end
    if k == "SetValue" then return function(self, v) rawset(self, "value", v) local fn = rawget(self, "OnValueChanged") if fn then fn(self, v) end end end
    if k == "SetScript" then return function(self, name, fn) rawset(self, name, fn) end end
    if k == "GetScript" then return function(self, name) return rawget(self, name) end end
    if k == "HookScript" then return function(self, name, fn) rawset(self, "hook" .. name, fn) end end
    if k == "EnableMouse" then return function(self, on) rawset(self, "mouse", on) end end
    if k == "EnableMouseWheel" then return function(self, on) rawset(self, "wheel", on) end end
    if k == "Raise" then return function(self) rawset(self, "raised", true) end end
    return function() end end })
end
function CreateFrame(kind, name, parent)
  if kind == "Button" then buttons = buttons + 1 end
  local f = mock(kind)
  rawset(f, "parent", parent)
  -- the game's dropdown keeps its menu generator; the test runs it on a root description
  if kind == "DropdownButton" then rawset(f, "SetupMenu", function(self, gen) rawset(self, "gen", gen) end) end
  return f
end
UIParent = mock("Frame")
local tip = {}
GameTooltip = mock("GameTooltip")
GameTooltip.SetOwner = function() for i = #tip, 1, -1 do tip[i] = nil end end
GameTooltip.SetText = function(_, s) tip[#tip + 1] = s end
GameTooltip.AddLine = function(_, s) tip[#tip + 1] = s end
local cx, cy, now = 400, 300, 100
function GetCursorPosition() return cx, cy end
function GetTime() return now end
local mouseDown = true
function IsMouseButtonDown() return mouseDown end
function IsShiftKeyDown() return false end
function IsAltKeyDown() return false end
function date() return "2026-10-16 12:00" end
function InCombatLockdown() return false end
local SECRET = setmetatable({}, { __tostring = function() return "secret" end })
local secretStrings = {}
function issecretvalue(v) return v == SECRET or (type(v) == "string" and secretStrings[v] == true) end
function geterrorhandler() return function(e) error(e) end end
function GetNumClasses() return 0 end
-- the group, as the game reports it: you lead the raid by default (you may change the raid note)
local group = { raid = true, party = true, leader = true, assist = false }
function IsInRaid() return group.raid end
function IsInGroup() return group.party or group.raid end
function UnitIsGroupLeader(unit) return unit == "player" and group.leader end
function UnitIsGroupAssistant(unit) return unit == "player" and group.assist end
C_Timer = { After = function() end }
-- the live raid, as GetRaidRosterInfo reports it: { name (no realm on your own), class file }
local liveRoster = {}
function GetNumGroupMembers() return #liveRoster end
function GetRaidRosterInfo(i) local p = liveRoster[i] if p then return p[1], nil, 1, nil, nil, p[2] end end
function UnitGroupRolesAssigned() return "NONE" end
function UnitIsUnit() return false end
function GetNumSubgroupMembers() return 0 end
function UnitFullName() return "Me", "Home" end
function GetNormalizedRealmName() return "Home" end
function Ambiguate(key) return (key:gsub("%-Home$", "")) end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function UnitClass(unit) return "Shaman", "SHAMAN" end
LOCALIZED_CLASS_NAMES_MALE = { SHAMAN = "Shaman", PRIEST = "Priest", DRUID = "Druid", WARRIOR = "Warrior" }
local NOTE_ICON = "Interface\\\\Icons\\\\INV_Misc_Note_02"
C_Spell = {
  GetSpellName = function(id) if id == 999 then return nil end return "Spell" .. id end,
  -- 999 no longer exists; 998's icon is secret
  GetSpellTexture = function(id) if id == 999 then return nil end if id == 998 then return SECRET end return "tex" .. id end,
}
RAID_CLASS_COLORS = {}
CRTFontSmall, CRTFontNormal, CRTFontHighlight = {}, {}, {}
CANCEL, ACCEPT = "Cancel", "Accept"
-- the game's context menu: the generator runs at once on a root description; buttons keep their callbacks
local menus = {}
local function description(kind, text, fn)
  local d = { kind = kind, text = text, fn = fn, items = {} }
  function d:CreateTitle(s) local x = description("title", s) table.insert(self.items, x) return x end
  function d:CreateButton(s, f) local x = description("button", s, f) table.insert(self.items, x) return x end
  function d:CreateDivider() local x = description("divider") table.insert(self.items, x) return x end
  function d:CreateRadio(s, isSel, set, key) local x = description("radio", s, function() set(key) end) x.selected = function() return isSel(key) end table.insert(self.items, x) return x end
  function d:SetScrollMode(h) self.scrollH = h end
  function d:SetEnabled(on) self.enabled = on and true or false end
  return d
end
MenuUtil = { CreateContextMenu = function(owner, gen)
  local root = description("root")
  gen(owner, root)
  menus[#menus + 1] = { owner = owner, root = root }
  return {}
end }
local function item(d, text) for _, x in ipairs(d.items) do if x.text == text then return x end end end
local function texts(d) local out = {} for _, x in ipairs(d.items) do out[#out + 1] = x.kind .. ":" .. tostring(x.text) end return table.concat(out, "|") end
local function click(x) assert(x and x.kind == "button" and x.fn, "a menu button") x.fn() end
-- popups: DIALOG strata, as the game's are
local popups = {}
StaticPopup1 = { strata = "DIALOG", shown = false, hooks = {},
  SetFrameStrata = function(self, v) self.strata = v end, GetFrameStrata = function(self) return self.strata end,
  Raise = function(self) self.raised = true end, IsShown = function(self) return self.shown end,
  HookScript = function(self, name, fn) self.hooks[name] = self.hooks[name] or {} table.insert(self.hooks[name], fn) end,
  Hide = function(self) self.shown = false for _, fn in ipairs(self.hooks.OnHide or {}) do fn(self) end end }
function StaticPopup_ShowCustomGenericConfirmation(info) popups[#popups + 1] = info StaticPopup1.which, StaticPopup1.shown = "GENERIC_CONFIRMATION", true end
-- retail: hides the shown popup of that kind
function StaticPopup_Hide(which) if StaticPopup1.shown and StaticPopup1.which == which then StaticPopup1:Hide() end end
StaticPopupDialogs = {}
StaticPopup1.EditBox = { text = "", SetText = function(self, s) self.text = s end, GetText = function(self) return self.text end,
  HighlightText = function() end, GetParent = function() return StaticPopup1 end }
StaticPopup1.accept = function() local def = StaticPopupDialogs[StaticPopup1.which] def.OnAccept(StaticPopup1, StaticPopup1.data) StaticPopup1:Hide() end
function StaticPopup_Visible(which) if StaticPopup1.shown and StaticPopup1.which == which then return "StaticPopup1" end end
function StaticPopup_Show(which, a, b, data)
  local def = assert(StaticPopupDialogs[which], "popup defined")
  StaticPopup1.which, StaticPopup1.data, StaticPopup1.shown = which, data, true
  StaticPopup1.EditBox:SetText("")
  if def.OnShow then def.OnShow(StaticPopup1, data) end
  return StaticPopup1
end
local CRT = {
  db = { timeline = { record = true, minPull = 15, keep = 10, bosses = {}, rows = {}, span = 300, grid = 30, iconSize = 22,
    deathRows = "combined", roles = { TANK = true, HEALER = true, DAMAGER = true }, firstDeaths = 0, overlay = 3,
    overlayOn = false, hideEmpty = true, nextId = 1 },
    notes = { list = {}, nextId = 1, alert = {}, window = {} },
    groups = { presets = {}, nextId = 1, working = {} }, classCache = {}, roleCache = {}, ui = {} },
  PALETTE = { accent = { 0.78, 0.56, 0.36 }, label = { 0.87, 0.73, 0.56 }, surface = { 0.165, 0.122, 0.098 }, text = { 0.95, 0.90, 0.84 } },
  Groups = { ClassColor = function() return 1, 1, 1 end },
}
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
local journalRows = {}
CRT.TimelineJournal = { ResolveID = function(_, k, r) if type(k) == "number" then return k end if r and type(r.encounterID) == "number" then return r.encounterID end end,
  Rows = function() return journalRows end,
  IsHidden = function() return false end,
}
CRT.db.alerts = { bars = {}, reminders = {}, phases = {}, overrides = {}, nextId = 1, saved = {}, nextSavedId = 1, starters = { healthstone = true, healthpotion = true, gate = true }, cooldownFilter = "mine" }
-- CRT_Core/UI/Panel.lua loads first, as in the .toc (the popup helpers), then CRT_Core/UI/Controls.lua (UI.Dropdown)
assert(load(panelSrc, "CRT_Core/UI/Panel.lua"))("CowfeeRaidTools", CRT)
assert(load(controlsSrc, "CRT_Core/UI/Controls.lua"))("CowfeeRaidTools", CRT)
-- CRT_Modules/Groups/Data.lua loads early, as in the .toc (the Raid Groups layouts and the live roster)
assert(load(groupsSrc, "CRT_Modules/Groups/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(rosterSrc, "CRT_Modules/Alerts/Roster.lua"))("CowfeeRaidTools", CRT)
assert(load(dataSrc, "CRT_Modules/Timeline/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(dbSrc, "CRT_Modules/Timeline/Database.lua"))("CowfeeRaidTools", CRT)
assert(load(refSrc, "CRT_Modules/Timeline/Reference.lua"))("CowfeeRaidTools", CRT)
assert(load(lanesSrc, "CRT_Modules/Timeline/Lanes.lua"))("CowfeeRaidTools", CRT)
local function loadBosses(CRT, reg, season, nek)
  local real, handler = CreateFrame, nil
  CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end, SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
  assert(load(reg, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
  CreateFrame = real
  assert(load(season, "CRT_Data/Seasons/Midnight-S1/Season.lua"))("CowfeeRaidTools", CRT)
  assert(load(nek, "CRT_Data/Seasons/Midnight-S1/NekzaliTheSoulcoiler.lua"))("CowfeeRaidTools", CRT)
  handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
end
loadBosses(CRT, regSrc, seasonSrc, nekSrc)
assert(load(rulesSrc, "CRT_Modules/Alerts/Rules.lua"))("CowfeeRaidTools", CRT)
assert(load(engineSrc, "CRT_Modules/Alerts/Engine.lua"))("CowfeeRaidTools", CRT)
assert(load(parseSrc, "CRT_Modules/Notes/Parse.lua"))("CowfeeRaidTools", CRT)
assert(load(notesSrc, "CRT_Modules/Notes/Data.lua"))("CowfeeRaidTools", CRT)
assert(load(remSrc, "CRT_Modules/Alerts/Reminders.lua"))("CowfeeRaidTools", CRT)
-- CooldownData.lua and Cooldowns.lua load before View.lua, as in the .toc
assert(load(cdDataSrc, "CRT_Modules/Alerts/CooldownData.lua"))("CowfeeRaidTools", CRT)
assert(load(cdSrc, "CRT_Modules/Alerts/Cooldowns.lua"))("CowfeeRaidTools", CRT)
assert(load(viewSrc, "CRT_Modules/Timeline/View.lua"))("CowfeeRaidTools", CRT)
-- Draft.lua (the alert draft and its saves, frame-free) loads after View.lua and before Saved.lua, as in the .toc
assert(load(soundSrc, "CRT_Core/Sound/Engine.lua"))("CowfeeRaidTools", CRT) -- the sound engine, before the files that use CRT.Sound
assert(load(draftSrc, "CRT_Modules/Alerts/Draft.lua"))("CowfeeRaidTools", CRT)
-- Saved.lua loads after View.lua, as in the .toc
assert(load(savedSrc, "CRT_Modules/Alerts/Saved.lua"))("CowfeeRaidTools", CRT)
local opened, editedSaved = {}, {}
CRT.AlertEditor = {
  Open = function(_, enc, id, prefill) opened[#opened + 1] = { enc = enc, id = id, prefill = prefill } end,
  OpenNote = function() end,
  EditSaved = function(_, id) editedSaved[#editedSaved + 1] = { id = id } return true end,
}
-- the alert editor window, for a release over it (MouseIsOver goes by its rectangle, shown or not)
local editorFrame = mock("Frame")
editorFrame:Hide()
local overEditor = false
function MouseIsOver(f) return overEditor and f == editorFrame end
CRT.AlertEditor.Frame = function() return editorFrame end
local View, S = CRT.TimelineView, CRT.AlertSaved
local function reset()
  for _, l in ipairs({ opened, editedSaved, printed, menus, popups }) do for i = #l, 1, -1 do l[i] = nil end end
  mouseDown = true
  now = now + 10
end
local function screenX(v, t) return 100 - v.hscroll:GetHorizontalScroll() + t * 600 / 300 end
local function laneY(i) return 500 - (i - 1) * 30 - 15 end
local function laneIndex(v, label) for i, l in ipairs(v.lanes) do if l.label == label then return i end end error("no lane " .. label) end
local function chips(v)
  local out = {}
  for _, c in ipairs(v.chips or {}) do if c:IsShown() then out[#out + 1] = c end end
  return out
end
local function chipFor(v, id) for _, c in ipairs(chips(v)) do if c.savedID == id then return c end end end

local ref = assert(CRT.TimelineReference.Parse("Boss: Nek\\nEncounter: 3001\\nLength: 3:00\\nPhase: P1 0:00\\nPhase: P2 1:00\\nSoulcoil [spell 4242]: 0:10, 1:15\\nPlain: 0:30"), "ref parses")
local soakID = S:Save(nil, { name = "Soak", text = "Soak now", spellID = 777, saveAs = "note", tags = "everyone", color = { 1, 0, 0, 1 }, outputs = { alert = true, bar = true } })
local moveID = S:Save(nil, { name = "Move out", text = "Move", outputs = { text = true } })
local aID = S:Save(nil, { name = "A first", text = "A", spellID = 888, outputs = { icon = true } })

local function newView(base, enc, boss)
  local v = View.Create(mock("Frame"))
  v:SetData(base or { reference = ref }, enc or 3001, nil, boss or "Nek")
  reset()
  return v
end
-- a chip dragged from the strip (below the track) to screen x, y and let go there
local function dragChip(v, c, x, y, opts)
  opts = opts or {}
  cx, cy = 150, 150
  c.OnMouseDown(c, "LeftButton")
  cx, cy = x, y
  v.frame.OnUpdate(v.frame)
  if opts.check then opts.check() end
  if opts.foundUp then
    mouseDown = false
    v.frame.OnUpdate(v.frame)
    mouseDown = true
  else
    c.OnMouseUp(c, "LeftButton")
  end
end

do
  local v = newView()
  assert(v.strip and v.strip:IsShown(), "the strip shows for a boss")
  assert(v.strip.label and v.strip.label:GetText() == "Templates", "label: " .. tostring(v.strip.label and v.strip.label:GetText()))
  local list = chips(v)
  assert(#list == 3, "one chip per saved alert: " .. #list)
  assert(list[1].savedID == aID and list[2].savedID == moveID and list[3].savedID == soakID, "sorted by name")
  assert(list[3].name:GetText() == "Soak" and list[1].name:GetText() == "A first", "names")
  assert(list[3].icon:IsShown() and list[3].icon.texture == "tex777" and list[3].icon.w == 16, "spell icon, 16 px")
  assert(list[2].icon:IsShown() and list[2].icon.texture == NOTE_ICON, "no spell: the note icon")
  local c = list[3].edge.color
  assert(c[1] == 1 and c[2] == 0 and c[3] == 0, "the saved alert's colour on the edge")
  local car = CRT.PALETTE.accent
  assert(list[1].edge.color[1] == car[1] and list[1].edge.color[2] == car[2], "no colour: accent edge")
  -- laid out left to right without overlap, the + chip after the last
  for i = 2, #list do
    assert(list[i].pt[4] >= list[i - 1].pt[4] + list[i - 1].w, "chip " .. i .. " right of chip " .. (i - 1))
  end
  assert(v.plus and v.plus:IsShown() and v.plus.pt[4] >= list[3].pt[4] + list[3].w, "+ chip last")
  -- the tooltip: its name, text, how it shows, who it is for
  list[3].OnEnter(list[3])
  local all = table.concat(tip, "|")
  assert(tip[1] == "Soak" and all:find("Soak now", 1, true) and all:find("Bar", 1, true) and all:find("Everyone", 1, true), "chip tip: " .. all)
  -- pooled, redrawn on a change, and a longer name widens a reused chip (bounded width)
  local made = buttons
  v:Refresh() v:Refresh()
  assert(buttons == made, "chips come from the pool")
  local w0 = list[1].w
  S:Rename(aID, "A first but now a much longer name")
  local again = chipFor(v, aID)
  assert(again and again.w > w0 + 60, "renamed chip widens: " .. tostring(again and again.w) .. " from " .. w0)
  local extra = S:Save(nil, { name = "Zed", text = "Zed", outputs = { alert = true } })
  assert(#chips(v) == 4, "a new saved alert adds a chip")
  S:Delete(extra)
  assert(#chips(v) == 3, "deleting removes it")
  -- no boss: the strip hides
  local blank = View.Create(mock("Frame"))
  blank:SetData(nil, nil, nil, nil)
  assert(not blank.strip:IsShown(), "no boss: no strip")
  -- many chips wrap onto rows; the strip no longer scrolls sideways
  local many = {}
  for i = 1, 12 do many[i] = S:Save(nil, { name = "Saved alert number " .. i, text = "x", outputs = { alert = true } }) end
  assert(v.chipRows > 1, "chips wrap: " .. tostring(v.chipRows))
  assert(v.chipScroll.wheel, "the chip strip takes the wheel")
  v.chipScroll.OnMouseWheel(v.chipScroll, -1)
  assert(v.chipScroll:GetHorizontalScroll() == 0, "never sideways")
  for _, id in ipairs(many) do S:Delete(id) end
  S:Rename(aID, "A first")
end
print("ok strip: one chip per saved alert")

do
  local gone = S:Save(nil, { name = "Gone spell", text = "", spellID = 999, outputs = { alert = true } })
  local secret = S:Save(nil, { name = "Secret icon", text = "", spellID = 998, outputs = { alert = true } })
  local v = newView()
  local g, s = chipFor(v, gone), chipFor(v, secret)
  assert(g and s, "both chips")
  assert(g.icon:IsShown() and g.icon.texture == NOTE_ICON and g.name:GetText() == "Gone spell", "missing spell: name, the note icon")
  assert(s.icon:IsShown() and s.icon.texture == NOTE_ICON, "secret icon: the note icon, never the secret")
  local car = CRT.PALETTE.accent
  assert(g.icon.vcolor[1] == car[1] and s.icon.vcolor[2] == car[2], "no colour: tinted accent")
  assert(g.name.pt[4] > 16, "the name after the icon: " .. tostring(g.name.pt[4]))
  -- dropping it still works and keeps its own spell
  dragChip(v, g, screenX(v, 40), laneY(laneIndex(v, "Plain")))
  assert(#opened == 1 and opened[1].prefill.saved == gone and opened[1].prefill.spellID == 999, "drop still opens")
  S:Delete(gone) S:Delete(secret)
end
print("ok strip: missing spell chip")

do
  local v = newView()
  local c = chipFor(v, soakID)
  local plain = laneIndex(v, "Plain")
  dragChip(v, c, screenX(v, 70), laneY(plain), { check = function()
    assert(v.chipGhost and v.chipGhost:IsShown(), "a ghost chip follows the cursor")
    assert(v.chipGhost.pt[1] == "CENTER" and v.chipGhost.pt[4] == screenX(v, 70) and v.chipGhost.pt[5] == laneY(plain), "ghost at the cursor")
    assert(v.dropLine and v.dropLine:IsShown() and v.dropLine.pt[4] == View.TimeToX(70, ref.length, v.trackW), "dashed line at the drop time")
    assert(v.dropLine.label:GetText() == "Place at 1:10", "label: " .. tostring(v.dropLine.label:GetText()))
  end })
  assert(not v.chipGhost:IsShown() and not v.dropLine:IsShown(), "ghost and line gone after the drop")
  assert(#opened == 1, "the drop opens the editor")
  local o = opened[1]
  assert(o.enc == 3001 and o.id == nil, "a new alert for the boss")
  local p = o.prefill
  assert(p.saved == soakID and p.ph == 2 and p.time == 10 and p.boss == "Nek" and p.spellID == 777 and p.saveAs == "note",
    "prefill: " .. tostring(p.saved) .. " " .. tostring(p.ph) .. " " .. tostring(p.time) .. " " .. tostring(p.spellID))
  -- the label stays inside the visible track at both edges
  CRT.db.timeline.span = 60
  v:Refresh()
  v:ScrollTo(200)
  local hs, vis = v.hscroll:GetHorizontalScroll(), v:VisibleWidth()
  for _, sx in ipairs({ 101, 699 }) do
    reset()
    dragChip(v, c, sx, laneY(1), { check = function()
      local lx, w = v.dropLine.label.pt[4], #v.dropLine.label:GetText() * 6
      assert(lx >= hs and lx + w <= hs + vis, "label inside the visible track: " .. lx .. " w " .. w)
    end })
  end
  CRT.db.timeline.span = 300
  v:Refresh()
  v:ScrollTo(0)
  -- a click on a chip without moving does nothing
  reset()
  cx, cy = 150, 150
  c.OnMouseDown(c, "LeftButton")
  cx = cx + 2
  v.frame.OnUpdate(v.frame)
  assert(not (v.chipGhost and v.chipGhost:IsShown()), "no ghost under 4 px")
  c.OnMouseUp(c, "LeftButton")
  assert(#opened == 0 and #editedSaved == 0, "a click opens nothing")
  -- a recorded pull: phase 1 from the pull
  journalRows = { { spellID = 5001, name = "Named Spell", icon = 1 } }
  local rv = newView({ id = 1, encounterID = 3001, length = 200, casts = { { t = 10, spellID = 5001 } }, deaths = {} }, 3001, "Alpha")
  dragChip(rv, chipFor(rv, moveID), screenX(rv, 42), laneY(1))
  assert(opened[1] and opened[1].prefill.ph == 1 and opened[1].prefill.time == 42 and opened[1].prefill.boss == "Alpha", "recorded pull drop")
  journalRows = {}
  -- a boss known only by name prints and opens nothing
  local nameOnly = assert(CRT.TimelineReference.Parse("Boss: Named\\nA: 0:10"))
  local nv = newView({ reference = nameOnly }, "ref:named", "Named")
  dragChip(nv, chipFor(nv, moveID), screenX(nv, 5), laneY(1))
  assert(#opened == 0 and #printed == 1, "no encounter: one chat line")
  -- the button found up over the track (released outside the chip) drops too
  reset()
  dragChip(v, c, screenX(v, 50), laneY(plain), { foundUp = true })
  assert(#opened == 1 and opened[1].prefill.time == 50, "found up over the track drops")
end
print("ok strip: drop opens the editor at the drop time")

do
  local v = newView()
  local soul = laneIndex(v, "Soulcoil")
  dragChip(v, chipFor(v, soakID), screenX(v, 10) + 3, laneY(soul) - 2)
  assert(opened[1] and opened[1].prefill.spellID == 4242 and opened[1].prefill.saved == soakID, "dropped on the cast icon: its spell: " .. tostring(opened[1] and opened[1].prefill.spellID))
  assert(opened[1].prefill.time == 11.5, "time from the cursor, not the icon: " .. tostring(opened[1].prefill.time))
  reset()
  -- beside the icon (more than half its size away): the saved alert's own spell
  dragChip(v, chipFor(v, soakID), screenX(v, 10) + 20, laneY(soul))
  assert(opened[1] and opened[1].prefill.spellID == 777, "beside the icon: own spell")
  reset()
  -- the same time on another row: no icon there
  dragChip(v, chipFor(v, moveID), screenX(v, 10), laneY(laneIndex(v, "Plain")))
  assert(opened[1] and opened[1].prefill.spellID == nil, "no icon, no spell")
  reset()
  -- a death icon gives no spell
  local p = { id = 1, encounterID = 3001, length = 200, casts = {}, deaths = { { t = 50, name = "Abu", class = "MAGE", role = "DAMAGER", spellID = 4242 } } }
  local dv = newView(p, 3001, "Alpha")
  dragChip(dv, chipFor(dv, moveID), screenX(dv, 50), laneY(laneIndex(dv, "Deaths")))
  assert(opened[1] and opened[1].prefill.spellID == nil, "a death icon gives no spell")
end
print("ok strip: drop on an icon takes its spell")

do
  local v = newView()
  local c = chipFor(v, soakID)
  dragChip(v, c, screenX(v, 70), 150)
  assert(#opened == 0 and not v.chipGhost:IsShown() and not (v.dropLine and v.dropLine:IsShown()), "released below the track: nothing")
  dragChip(v, c, 750, laneY(2))
  assert(#opened == 0, "released right of the track: nothing")
  dragChip(v, c, 60, laneY(2))
  assert(#opened == 0, "released over the row names: nothing")
  dragChip(v, c, 750, laneY(2), { foundUp = true })
  assert(#opened == 0 and v.chipMove == nil, "found up off the track: nothing")
  -- off the track the time line hides while the ghost still follows
  cx, cy = 150, 150
  c.OnMouseDown(c, "LeftButton")
  cx, cy = 400, 150
  v.frame.OnUpdate(v.frame)
  assert(v.chipGhost:IsShown() and not (v.dropLine and v.dropLine:IsShown()), "off the track: ghost, no line")
  v.frame.OnHide(v.frame)
  assert(v.chipMove == nil and not v.chipGhost:IsShown(), "hiding the view cancels")
end
print("ok strip: drop off the track does nothing")

do
  local v = newView()
  local c = chipFor(v, soakID)
  cx, cy = 150, 150
  c.OnMouseDown(c, "RightButton") c.OnMouseUp(c, "RightButton")
  assert(#menus == 1 and menus[1].owner == c, "right-click opens the chip's menu")
  local root = menus[1].root
  assert(item(root, "Edit") and item(root, "Rename") and item(root, "Delete"), "menu: " .. texts(root))
  click(item(root, "Edit"))
  assert(#editedSaved == 1 and editedSaved[1].id == soakID, "Edit opens the saved alert")
  click(item(root, "Rename"))
  assert(StaticPopup1.shown and StaticPopup1.EditBox.text == "Soak", "rename popup with the name: " .. tostring(StaticPopup1.EditBox.text))
  assert(StaticPopup1.strata == "FULLSCREEN_DIALOG" and StaticPopup1.raised, "lifted above the editor")
  StaticPopup1.EditBox:SetText("  Soak it ")
  StaticPopup1.accept()
  assert(S:Get(soakID).name == "Soak it" and chipFor(v, soakID).name:GetText() == "Soak it", "renamed and redrawn")
  assert(StaticPopup1.strata == "DIALOG", "strata back after it hides")
  -- Enter: retail calls the handler as (editBox, dialog.data); the box sits in a holder, not the dialog
  click(item(root, "Rename"))
  local def = StaticPopupDialogs.COWFEE_RAID_TOOLS_SAVED_ALERT_RENAME
  local box = StaticPopup1.EditBox
  box.GetParent = function() return { Hide = function() end } end
  box:SetText("Soak by Enter")
  def.EditBoxOnEnterPressed(box, StaticPopup1.data)
  assert(S:Get(soakID).name == "Soak by Enter" and not StaticPopup1.shown, "Enter renames and closes: " .. S:Get(soakID).name)
  click(item(root, "Rename"))
  box:SetText("Not this")
  def.EditBoxOnEscapePressed(box, StaticPopup1.data)
  assert(S:Get(soakID).name == "Soak by Enter" and not StaticPopup1.shown, "Escape closes, renames nothing")
  -- no data argument: the dialog's own
  box.GetParent = function() return StaticPopup1 end
  click(item(root, "Rename"))
  box:SetText("Soak it")
  def.EditBoxOnEnterPressed(box)
  assert(S:Get(soakID).name == "Soak it" and not StaticPopup1.shown, "falls back to the dialog's data")
  click(item(root, "Delete"))
  assert(#popups == 1 and popups[1].text:find("Soak it", 1, true) and S:Get(soakID), "a confirmation first: " .. tostring(popups[1] and popups[1].text))
  popups[1].callback()
  assert(S:Get(soakID) == nil and chipFor(v, soakID) == nil, "deleted, chip gone")
  StaticPopup1:Hide()
  -- the + chip makes a new one
  v.plus.OnClick(v.plus, "LeftButton")
  assert(#editedSaved == 2 and editedSaved[2].id == nil, "+ opens a blank saved alert")
  -- the left button on a chip never opens a menu; no menu API: a chat line
  reset()
  local m = chipFor(v, moveID)
  m.OnMouseDown(m, "LeftButton") m.OnMouseUp(m, "LeftButton")
  assert(#menus == 0, "left click: no menu")
  local real = MenuUtil
  MenuUtil = nil
  m.OnMouseDown(m, "RightButton") m.OnMouseUp(m, "RightButton")
  assert(#printed == 1, "no menu API: one chat line")
  MenuUtil = real
  soakID = S:Save(nil, { name = "Soak", text = "Soak now", spellID = 777, saveAs = "note", tags = "everyone", color = { 1, 0, 0, 1 }, outputs = { alert = true, bar = true } })
end
print("ok strip: chip menu edit rename delete")

do
  local v = newView()
  CRT.db.timeline.span = 60
  v:Refresh()
  v:ScrollTo(40)
  reset()
  local soul = laneIndex(v, "Soulcoil")
  local hs = v.hscroll
  -- a right-click that moves 4 px and lets go within 0.3 s opens the menu, and the view stays put
  cx, cy = 300, laneY(soul)
  hs.OnMouseDown(hs, "RightButton")
  cx = cx + 4
  v.frame.OnUpdate(v.frame)
  now = now + 0.2
  hs.OnMouseUp(hs, "RightButton")
  assert(#menus == 1, "small move opens the menu")
  assert(hs:GetHorizontalScroll() == 40, "the small scroll is undone: " .. hs:GetHorizontalScroll())
  -- the time where the button went down, at the scroll it had then
  local root = menus[1].root
  assert(root.items[1].kind == "title" and root.items[1].text == "0:24 \\194\\183 Soulcoil", "title: " .. tostring(root.items[1].text))
  assert(item(root, "New alert here") and item(root, "Place"), "menu: " .. texts(root))
  click(item(root, "New alert here"))
  assert(#opened == 1 and opened[1].prefill.ph == 1 and opened[1].prefill.time == 24 and opened[1].prefill.spellID == nil and opened[1].prefill.saved == nil, "New alert here is the double-click: blank, at the time")
  -- 10 px: scrolls, no menu
  reset()
  v:ScrollTo(40)
  cx = 300
  hs.OnMouseDown(hs, "RightButton")
  cx = cx - 10
  v.frame.OnUpdate(v.frame)
  hs.OnMouseUp(hs, "RightButton")
  assert(#menus == 0 and hs:GetHorizontalScroll() == 50, "a 10 px drag scrolls and opens nothing: " .. hs:GetHorizontalScroll())
  -- held still for longer than 0.3 s: no menu
  reset()
  cx = 300
  hs.OnMouseDown(hs, "RightButton")
  now = now + 0.5
  hs.OnMouseUp(hs, "RightButton")
  assert(#menus == 0, "a slow press opens nothing")
  -- an up-and-down move counts too
  cx, cy = 300, laneY(soul)
  hs.OnMouseDown(hs, "RightButton")
  cy = cy - 8
  hs.OnMouseUp(hs, "RightButton")
  assert(#menus == 0, "8 px up: nothing")
  -- the left button never opens it
  hs.OnMouseDown(hs, "LeftButton") hs.OnMouseUp(hs, "LeftButton")
  assert(#menus == 0, "left click: no menu")
  -- a right-click on a cast icon opens it too
  v:ScrollTo(0)
  local icon
  for _, b in ipairs(v.icons) do if b:IsShown() and b.lane.label == "Soulcoil" and b.mark.t == 10 then icon = b end end
  cx, cy = 100 + View.TimeToX(10, 180, v.trackW), laneY(soul)
  icon.OnMouseDown(icon, "RightButton") icon.OnMouseUp(icon, "RightButton")
  assert(#menus == 1 and menus[1].root.items[1].text == "0:10 \\194\\183 Soulcoil", "on an icon: " .. tostring(menus[1] and menus[1].root.items[1].text))
  CRT.db.timeline.span = 300
  v:Refresh()
  -- no pull shown: no menu
  reset()
  local blank = View.Create(mock("Frame"))
  blank:SetData(nil, nil, nil, nil)
  blank.hscroll.OnMouseDown(blank.hscroll, "RightButton") blank.hscroll.OnMouseUp(blank.hscroll, "RightButton")
  assert(#menus == 0, "nothing shown: no menu")
end
print("ok menu: small move opens, drag scrolls")

do
  local v = newView()
  local soul = laneIndex(v, "Soulcoil")
  local hs = v.hscroll
  local function menuAt(x, y)
    reset()
    cx, cy = x, y
    hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
    assert(#menus == 1, "menu opened")
    return menus[1].root
  end
  local root = menuAt(screenX(v, 70), laneY(laneIndex(v, "Plain")))
  local place = item(root, "Place")
  assert(texts(place) == "button:A first|button:Move out|button:Soak|button:Cooldowns", "Place lists the templates by name, then Cooldowns: " .. texts(place))
  -- the cursor moves to the menu before the click: the time is where it opened
  cx, cy = 650, 450
  click(item(place, "Soak"))
  assert(#opened == 1 and opened[1].enc == 3001, "Place opens the editor")
  local p = opened[1].prefill
  assert(p.saved == soakID and p.ph == 2 and p.time == 10 and p.spellID == 777 and p.boss == "Nek", "placed at the menu's time with its own spell: " .. tostring(p.time) .. " " .. tostring(p.spellID))
  -- on a cast icon: its spell
  root = menuAt(screenX(v, 10), laneY(soul))
  click(item(item(root, "Place"), "Move out"))
  assert(opened[1] and opened[1].prefill.saved == moveID and opened[1].prefill.spellID == 4242, "placed on an icon takes its spell")
  -- no saved alerts: Place says so
  local keep = CRT.db.alerts.saved
  CRT.db.alerts.saved = {}
  root = menuAt(screenX(v, 70), laneY(1))
  place = item(root, "Place")
  assert(#place.items == 2 and place.items[1].kind == "title" and place.items[2].text == "Cooldowns", "empty Place: " .. texts(place))
  CRT.db.alerts.saved = keep
  -- the empty space under the lanes: the time alone in the title
  root = menuAt(screenX(v, 70), 500 - 290)
  assert(root.items[1].text == "1:10", "no row: " .. tostring(root.items[1].text))
end
print("ok menu: place a saved alert")

do
  -- New alert here over a cast icon takes that icon's spell (as the icon's double-click does); elsewhere blank
  local v = newView()
  local soul = laneIndex(v, "Soulcoil")
  local hs = v.hscroll
  cx, cy = screenX(v, 10) + 3, laneY(soul) - 2
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  assert(#menus == 1, "menu on the icon")
  click(item(menus[1].root, "New alert here"))
  local p = opened[1] and opened[1].prefill
  assert(p and p.spellID == 4242 and p.text == "Spell4242" and p.time == 11.5 and p.saved == nil,
    "New alert here on an icon: its spell at the click's time: " .. tostring(p and p.spellID) .. " " .. tostring(p and p.time))
  reset()
  cx, cy = screenX(v, 10) + 3, laneY(laneIndex(v, "Plain"))
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  click(item(menus[1].root, "New alert here"))
  assert(opened[1] and opened[1].prefill.spellID == nil and opened[1].prefill.text == nil, "elsewhere: blank")
end
print("ok menu: new alert here on an icon takes its spell")

do
  -- a chip released over the open alert editor (it sits above the track) cancels
  local v = newView()
  local c = chipFor(v, moveID)
  editorFrame:Show() overEditor = true
  dragChip(v, c, screenX(v, 70), laneY(1))
  assert(#opened == 0 and v.chipMove == nil and not v.chipGhost:IsShown(), "released over the open editor: nothing")
  dragChip(v, c, screenX(v, 70), laneY(1), { foundUp = true })
  assert(#opened == 0, "found up over the open editor: nothing")
  -- the editor open but not under the cursor: drops
  overEditor = false
  dragChip(v, c, screenX(v, 70), laneY(1))
  assert(#opened == 1, "editor elsewhere: drops")
  -- a hidden editor never counts
  reset()
  editorFrame:Hide() overEditor = true
  dragChip(v, c, screenX(v, 70), laneY(1))
  assert(#opened == 1, "hidden editor: drops")
  overEditor = false
end
print("ok strip: release over the editor cancels")

do
  -- the ghost is filled once, when the drag starts
  local v = newView()
  local c = chipFor(v, moveID)
  cx, cy = 150, 150
  c.OnMouseDown(c, "LeftButton")
  cx, cy = 400, 150
  v.frame.OnUpdate(v.frame)
  assert(v.chipGhost:IsShown() and v.chipGhost.name:GetText() == "Move out", "ghost filled")
  local s = S:Get(moveID)
  s.name = "Changed underneath" -- no redraw: only a refill would show it
  cx = 420
  v.frame.OnUpdate(v.frame)
  assert(v.chipGhost.name:GetText() == "Move out", "not refilled every frame: " .. tostring(v.chipGhost.name:GetText()))
  assert(v.chipGhost.pt[4] == 420, "but it still follows the cursor")
  s.name = "Move out"
  v:CancelChipMove()
end
print("ok strip: ghost filled once")

do
  -- the lanes scrolled up: the track's top is above the lanes' window, and the part of the track
  -- outside that window (under the axis, or below it behind the strip) is not the track
  local v = newView()
  local c = chipFor(v, moveID)
  rawset(v.hscroll, "GetTop", function() return 600 end)
  rawset(v.vscroll, "GetTop", function() return 500 end)
  rawset(v.vscroll, "GetHeight", function() return 100 end) -- the track: 300..600, the window: 400..500
  dragChip(v, c, screenX(v, 70), 550)
  assert(#opened == 0, "inside the track but above the lanes' window: nothing")
  dragChip(v, c, screenX(v, 70), 350)
  assert(#opened == 0, "inside the track but below the lanes' window: nothing")
  dragChip(v, c, screenX(v, 70), 450)
  assert(#opened == 1, "inside both: drops")
  rawset(v.hscroll, "GetTop", nil) rawset(v.vscroll, "GetTop", nil) rawset(v.vscroll, "GetHeight", nil)
end
print("ok strip: over the track needs the lanes' window")

do
  -- Personal notes: a saved alert dropped or Placed there is your own, whatever its Save as
  local v = newView()
  local personal = laneIndex(v, "Personal notes")
  assert(personal == #v.lanes, "Personal notes is the last lane")
  dragChip(v, chipFor(v, soakID), screenX(v, 70), laneY(personal))
  local p = opened[1] and opened[1].prefill
  assert(p and p.saved == soakID and p.saveAs == "mine" and p.ph == 2 and p.time == 10 and p.spellID == 777, "dropped on Personal notes: only me: " .. tostring(p and p.saveAs))
  assert(S:Get(soakID).saveAs == "note", "the saved alert itself is unchanged")
  reset()
  local hs = v.hscroll
  cx, cy = screenX(v, 70), laneY(personal)
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  assert(menus[1].root.items[1].text == "1:10 \\194\\183 Personal notes", "menu title: " .. tostring(menus[1].root.items[1].text))
  click(item(item(menus[1].root, "Place"), "Soak"))
  assert(opened[1] and opened[1].prefill.saveAs == "mine", "Placed on Personal notes: only me")
  -- New alert here on Personal notes: your own too
  reset()
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  click(item(menus[1].root, "New alert here"))
  assert(opened[1] and opened[1].prefill.saveAs == "mine", "New alert here on Personal notes: only me")
  -- the leader, elsewhere: the saved alert's own Save as
  reset()
  dragChip(v, chipFor(v, soakID), screenX(v, 70), laneY(laneIndex(v, "Plain")))
  assert(opened[1] and opened[1].prefill.saveAs == "note", "the leader elsewhere keeps Raid note")
  -- a raid member: a Raid note saved alert is your own anywhere (P2), checked at the drop
  group.leader = false
  reset()
  dragChip(v, chipFor(v, soakID), screenX(v, 70), laneY(laneIndex(v, "Plain")))
  assert(opened[1] and opened[1].prefill.saveAs == "mine", "a member's drop of a Raid note saved alert: only me")
  reset()
  cx, cy = screenX(v, 70), laneY(laneIndex(v, "Plain"))
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  click(item(item(menus[1].root, "Place"), "Soak"))
  assert(opened[1] and opened[1].prefill.saveAs == "mine", "a member's Place of a Raid note saved alert: only me")
  -- promoted: the raid note again, no reload
  group.assist = true
  reset()
  dragChip(v, chipFor(v, soakID), screenX(v, 70), laneY(laneIndex(v, "Plain")))
  assert(opened[1] and opened[1].prefill.saveAs == "note", "promoted: Raid note")
  group.leader, group.assist = true, false
end
print("ok personal: drop forces only me")

-- Templates, an icon on every chip, and the Cooldowns row ----------------------------------------------
local function cdChips(v)
  local out = {}
  for _, c in ipairs(v.cdChips or {}) do if c:IsShown() then out[#out + 1] = c end end
  return out
end
local function cdChipFor(v, id) for _, c in ipairs(cdChips(v)) do if c.cooldown and c.cooldown.spellID == id then return c end end end
local function cdIDs(v) local out = {} for i, c in ipairs(cdChips(v)) do out[i] = c.cooldown.spellID end return table.concat(out, ",") end
local function filterMenu(v)
  local drop = assert(v.cdFilter and v.cdFilter.Dropdown, "the filter dropdown")
  local root = description("root")
  assert(drop.gen, "its menu")
  drop.gen(drop, root)
  return root
end

do
  local v = newView()
  assert(v.strip.label:GetText() == "Templates", "the strip says Templates")
  v.plus.OnEnter(v.plus)
  assert(tip[1] == "New template", "+ says New template: " .. tostring(tip[1]))
  -- the chip menu's Rename and Delete say template
  local c = chipFor(v, moveID)
  c.OnMouseDown(c, "RightButton") c.OnMouseUp(c, "RightButton")
  click(item(menus[1].root, "Rename"))
  assert(StaticPopupDialogs.COWFEE_RAID_TOOLS_SAVED_ALERT_RENAME.text == "Rename this template:", "rename prompt")
  StaticPopup1:Hide()
  click(item(menus[1].root, "Delete"))
  assert(popups[1].text:find("^Delete the template ") and popups[1].text:find("Move out", 1, true), "delete confirm: " .. tostring(popups[1].text))
  StaticPopup1:Hide()
  -- Place with none says so
  reset()
  local keep = CRT.db.alerts.saved
  CRT.db.alerts.saved = {}
  local hs = v.hscroll
  cx, cy = screenX(v, 70), laneY(1)
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  local place = item(menus[1].root, "Place")
  assert(place.items[1].kind == "title" and place.items[1].text == "No templates yet", "empty Place: " .. texts(place))
  CRT.db.alerts.saved = keep
  -- the default name of a template with no text or spell
  local blank = S:Save(nil, { outputs = { alert = true } })
  assert(S:Get(blank).name == "Template", "default name: " .. tostring(S:Get(blank).name))
  S:Delete(blank)
end
print("ok templates: strip and editor say Templates and Save As Template")

do
  local green = S:Save(nil, { name = "B green", text = "Green", color = { 0, 1, 0, 1 }, outputs = { alert = true } })
  local v = newView()
  local car = CRT.PALETTE.accent
  local m = chipFor(v, moveID)
  assert(m.icon:IsShown() and m.icon.texture == NOTE_ICON, "no spell: the Personal notes icon")
  assert(m.icon.vcolor[1] == car[1] and m.icon.vcolor[2] == car[2] and m.icon.vcolor[3] == car[3], "no colour: accent tint")
  local g = chipFor(v, green)
  assert(g.icon.texture == NOTE_ICON and g.icon.vcolor[1] == 0 and g.icon.vcolor[2] == 1 and g.icon.vcolor[3] == 0, "tinted in its colour")
  assert(g.name.pt[4] == m.name.pt[4], "names start after the icon on every chip")
  -- the ghost too
  cx, cy = 150, 150
  m.OnMouseDown(m, "LeftButton")
  cx, cy = 400, 150
  v.frame.OnUpdate(v.frame)
  assert(v.chipGhost.icon.texture == NOTE_ICON and v.chipGhost.icon.vcolor[1] == car[1], "ghost: tinted note icon")
  v:CancelChipMove()
  -- the hover still has the details
  m.OnEnter(m)
  assert(tip[1] == "Move out" and table.concat(tip, "|"):find("Text", 1, true), "hover: " .. table.concat(tip, "|"))
  S:Delete(green)
end
print("ok templates: chip without a spell shows the tinted note icon")

do
  local v = newView()
  -- chip 1 is A first (spell 888), chip 2 Move out (no spell, tinted), chip 3 Soak (spell 777)
  local list = chips(v)
  assert(list[2].savedID == moveID and list[2].icon.vcolor[1] ~= 1, "chip 2 tinted")
  local pooledChip = list[2]
  local keepA = S:Get(aID)
  S:Delete(aID) -- now chip 1 is Move out and chip 2 (the same pooled frame) is Soak with its spell
  local again = chips(v)
  assert(again[2] == pooledChip and again[2].savedID == soakID, "the pooled chip reused for Soak")
  assert(again[2].icon.texture == "tex777", "its spell's icon")
  local c = again[2].icon.vcolor
  assert(c[1] == 1 and c[2] == 1 and c[3] == 1, "untinted after reuse: " .. table.concat(c, ","))
  -- the ghost: a tinted drag, then a spell drag
  local m = chipFor(v, moveID)
  cx, cy = 150, 150 m.OnMouseDown(m, "LeftButton") cx, cy = 400, 150 v.frame.OnUpdate(v.frame) v:CancelChipMove()
  local sk = chipFor(v, soakID)
  cx, cy = 150, 150 sk.OnMouseDown(sk, "LeftButton") cx, cy = 400, 150 v.frame.OnUpdate(v.frame)
  local gc = v.chipGhost.icon.vcolor
  assert(v.chipGhost.icon.texture == "tex777" and gc[1] == 1 and gc[2] == 1 and gc[3] == 1, "ghost untinted for a spell")
  v:CancelChipMove()
  aID = S:Save(nil, { name = "A first", text = "A", spellID = 888, outputs = { icon = true } })
end
print("ok templates: chip with a spell untinted after reuse")

do
  -- the shaman's cooldowns by default (in list order), each with its icon and the game's name
  local v = newView()
  assert(cdIDs(v) == "108280,98008,114052", "your class: " .. cdIDs(v))
  local htt = cdChipFor(v, 108280)
  assert(htt.name:GetText() == "Spell108280" and htt.icon.texture == "tex108280", "the game's name and icon")
  assert(htt.icon.vcolor[1] == 1 and htt.icon.vcolor[2] == 1, "a real icon is untinted")
  -- hover: the name, the class, the hint
  htt.OnEnter(htt)
  assert(tip[1] == "Spell108280" and tip[2] == "Shaman" and tip[3] == "Drag onto the timeline to place an alert", "hover: " .. table.concat(tip, "|"))
  -- the menu: the four, then the classes; Your class is picked
  local root = filterMenu(v)
  local labels = {}
  for i, x in ipairs(root.items) do labels[i] = x.text end
  assert(table.concat(labels, "|", 1, 4) == "Your class|All|Healer cooldowns|Raid defensives", "options: " .. table.concat(labels, "|"))
  assert(root.items[1].selected() and not root.items[4].selected(), "Your class selected")
  -- pick Raid defensives: saved, and the row redraws
  root.items[4].fn()
  assert(CRT.db.alerts.cooldownFilter == "raid", "the choice is kept: " .. tostring(CRT.db.alerts.cooldownFilter))
  assert(cdIDs(v) == "374227,97462,196718,51052,106898", "raid defensives drawn: " .. cdIDs(v))
  assert(filterMenu(v).items[4].selected(), "Raid defensives now selected")
  -- a class
  for _, x in ipairs(filterMenu(v).items) do if x.text == "Druid" then x.fn() end end
  assert(CRT.db.alerts.cooldownFilter == "DRUID" and cdIDs(v) == "740,33891,391528,197721,106898", "druid: " .. cdIDs(v))
  -- a new view reads the kept choice
  local v2 = newView()
  assert(cdIDs(v2) == "740,33891,391528,197721,106898", "kept for the next view")
  -- the row wraps, and the wheel scrolls its rows
  for _, x in ipairs(filterMenu(v).items) do if x.text == "All" then x.fn() end end
  assert(v.cdRows > 3 and v.cdShown == 3, "all wrap onto rows: " .. tostring(v.cdRows))
  assert(v.cdScroll.wheel, "the row takes the wheel")
  v.cdScroll.OnMouseWheel(v.cdScroll, -1)
  assert(v.cdFirst == 1 and v.cdScroll:GetVerticalScroll() == 26 and v.cdScroll:GetHorizontalScroll() == 0, "wheel scrolls a row")
  for _ = 1, 200 do v.cdScroll.OnMouseWheel(v.cdScroll, -1) end
  local last = v.cdRows - v.cdShown
  assert(v.cdFirst == last and v.cdScroll:GetVerticalScroll() == last * 26, "stops at the last row")
  -- a redraw does not make new chips
  local made = buttons
  v:Refresh() v:Refresh()
  assert(buttons == made, "cooldown chips come from the pool")
  assert(v.cdFirst == last, "a redraw keeps the rows' scroll")
  for _, x in ipairs(filterMenu(v).items) do if x.text == "Raid defensives" then x.fn() end end
  assert(v.cdFirst == 0 and v.cdScroll:GetVerticalScroll() == 0, "a new filter starts at the first row")
  CRT.db.alerts.cooldownFilter = "mine"
end
print("ok cooldowns: filter saved and redraws the row")

-- a dropped cooldown is saved at once (CRT_Modules/Alerts/Draft.lua's cooldown defaults): no editor
local R, N, D = CRT.AlertReminders, CRT.Notes, CRT.AlertDraft
local function clearSaves()
  CRT.db.alerts.reminders = {} CRT.db.alerts.nextId = 1
  CRT.db.notes.list = {} CRT.db.notes.nextId = 1
end
local function reminders() return R:List(3001) end
local function noteCount() local n = 0 for _ in pairs(CRT.db.notes.list) do n = n + 1 end return n end
-- the one line of the boss's note (line 2, under the header), parsed
local function noteLine(n) local id = N:FindForEncounter(3001, nil) return id and N:TimerAt(id, n or 2), id end
local function lastPrint() return printed[#printed] end
-- the cooldown defaults on a reminder: Text only, read out, 5 s, nothing else
local function textAndSpeech(r, what)
  local o = r.outputs
  assert(o.text == true and o.alert == false and o.icon == false and o.bar == false and o.circle == false, what .. ": Text only")
  assert(o.speech == true and r.speech == "text", what .. ": speaks the text: " .. tostring(r.speech))
  assert(r.warn == 5 and r.linger == nil and r.glow == nil and r.sound == nil and r.color == nil and r.iconID == nil, what .. ": 5 s, nothing else")
end
local function textAndSpeechLine(t, what)
  assert(t.show and t.show.text and not t.show.alert and not t.show.icon and not t.show.bar and not t.show.circle, what .. ": Text only")
  assert(t.tts and not t.count and not t.glow and not t.sound and t.warn == 5 and not t.linger and not t.iconID and not t.color, what .. ": speaks, 5 s, nothing else")
end

do
  -- a raid member's drop: saved at once as Only me (a leader's drop asks who it is for: the assign tests)
  clearSaves()
  group.leader = false
  local v = newView()
  local plain = laneIndex(v, "Plain")
  local c = cdChipFor(v, 108280)
  dragChip(v, c, screenX(v, 70), laneY(plain), { check = function()
    assert(v.chipGhost:IsShown() and v.chipGhost.name:GetText() == "Spell108280", "the ghost is the cooldown")
    assert(v.dropLine:IsShown() and v.dropLine.label:GetText() == "Place at 1:10", "the same dashed line and label")
  end })
  assert(not v.chipGhost:IsShown() and not v.dropLine:IsShown(), "gone after the drop")
  assert(#opened == 0 and #menus == 0, "no editor, no menu")
  local list = reminders()
  assert(#list == 1, "one reminder saved: " .. #list)
  local r = list[1].r
  assert(r.spellID == 108280 and r.text == "Spell108280" and r.times == "P2 +0:10" and r.boss == "Nek",
    "spell, name, drop time: " .. tostring(r.spellID) .. " " .. tostring(r.text) .. " " .. tostring(r.times))
  assert(noteCount() == 0, "no raid note")
  assert(lastPrint() == "Spell108280 placed at 1:10 for you.", "chat: " .. tostring(lastPrint()))
  -- the flag shows on the Timeline (the change listeners redraw it)
  local found
  for _, m in ipairs(v.marks or {}) do if m.spellID == 108280 or m.text == "Spell108280" then found = m end end
  assert(found, "a flag for the new reminder")
  -- dropped on a boss cast icon: still its own spell
  clearSaves() reset()
  dragChip(v, c, screenX(v, 10) + 3, laneY(laneIndex(v, "Soulcoil")) - 2)
  assert(#opened == 0 and reminders()[1] and reminders()[1].r.spellID == 108280, "a cast icon does not replace the cooldown's spell")
  -- the chosen order: the time goes through WrittenTime with its spell and name
  clearSaves() reset()
  local seen
  rawset(v, "WrittenTime", function(_, spellID, text, t) seen = { spellID, text, t } return t + 5 end)
  dragChip(v, c, screenX(v, 70), laneY(plain))
  assert(seen and seen[1] == 108280 and seen[2] == "Spell108280" and seen[3] == 70, "WrittenTime asked")
  assert(reminders()[1] and reminders()[1].r.times == "P2 +0:15", "the written time: " .. tostring(reminders()[1] and reminders()[1].r.times))
  rawset(v, "WrittenTime", nil)
  -- a click, a release off the track, over the editor: nothing
  clearSaves() reset()
  cx, cy = 150, 150 c.OnMouseDown(c, "LeftButton") c.OnMouseUp(c, "LeftButton")
  dragChip(v, c, screenX(v, 70), 150)
  editorFrame:Show() overEditor = true
  dragChip(v, c, screenX(v, 70), laneY(plain))
  editorFrame:Hide() overEditor = false
  assert(#opened == 0 and #reminders() == 0, "click, off the track and over the editor save nothing")
  -- no encounter number: one chat line
  local nameOnly = assert(CRT.TimelineReference.Parse("Boss: Named\\nA: 0:10"))
  local nv = newView({ reference = nameOnly }, "ref:named", "Named")
  dragChip(nv, cdChipFor(nv, 108280), screenX(nv, 5), laneY(1))
  assert(#opened == 0 and #printed == 1, "no encounter: a chat line")
  -- the leader too, with no encounter number: the chat line, no menu
  group.leader = true
  reset()
  dragChip(nv, cdChipFor(nv, 108280), screenX(nv, 5), laneY(1))
  assert(#opened == 0 and #printed == 1 and #menus == 0, "no encounter, leader: a chat line")
  clearSaves()
end
print("ok cooldown: drop saves at once, no editor")

do
  -- the defaults, in one place: a fresh table each call
  local a, b = D.CooldownDefaults(), D.CooldownDefaults()
  assert(a ~= b and a.show ~= b.show, "a fresh table each call")
  assert(a.show.text == true and not a.show.alert and not a.show.icon and not a.show.bar and not a.show.circle, "Show as: Text only")
  assert(a.speak == true and not a.count and not a.glow and a.sound == nil, "Also: Speak the text only")
  assert(a.warn == 5 and a.linger == 0 and a.color == nil, "5 s, Linger 0, default colour")
  a.show.bar = true
  assert(not D.CooldownDefaults().show.bar, "changing one leaves the next alone")
  -- what a drop saves carries them, with the spell's icon (no icon ID)
  clearSaves()
  group.leader = false
  local v = newView()
  dragChip(v, cdChipFor(v, 98008), screenX(v, 70), laneY(laneIndex(v, "Plain")))
  group.leader = true
  local r = reminders()[1] and reminders()[1].r
  assert(r, "saved")
  textAndSpeech(r, "the drop")
  clearSaves()
end
print("ok cooldown: defaults are text and speech only")

do
  -- Personal notes, as a member and as the leader: Only me, no menu
  clearSaves()
  local v = newView()
  local personal = laneIndex(v, "Personal notes")
  group.leader = false
  dragChip(v, cdChipFor(v, 114052), screenX(v, 70), laneY(personal))
  local list = reminders()
  assert(#opened == 0 and #list == 1 and list[1].r.spellID == 114052 and list[1].r.times == "P2 +0:10", "member on Personal notes: mine")
  group.leader = true
  reset()
  dragChip(v, cdChipFor(v, 114052), screenX(v, 70), laneY(personal))
  assert(#opened == 0 and #menus == 0 and #reminders() == 2 and noteCount() == 0, "the leader on Personal notes: mine")
  clearSaves()
end
print("ok cooldown: non-admin and personal lane save only me")

do
  local v = newView()
  local before = #S:List()
  local c = cdChipFor(v, 98008)
  c.OnMouseDown(c, "RightButton") c.OnMouseUp(c, "RightButton")
  assert(#menus == 1 and menus[1].owner == c, "a menu on the cooldown")
  local root = menus[1].root
  local buttonsIn = {}
  for _, x in ipairs(root.items) do if x.kind == "button" then buttonsIn[#buttonsIn + 1] = x.text end end
  assert(#buttonsIn == 1 and buttonsIn[1] == "Save as template", "only Save as template: " .. texts(root))
  -- the editor's new-alert defaults are not used: the cooldown defaults are
  CRT.AlertEditor.NewDefaults = function() error("the editor's defaults were asked") end
  click(item(root, "Save as template"))
  CRT.AlertEditor.NewDefaults = nil
  local list = S:List()
  assert(#list == before + 1, "one template more")
  local made
  for _, e in ipairs(list) do if e.s.spellID == 98008 then made = e end end
  assert(made, "the template has its spell")
  local s = made.s
  assert(s.name == "Spell98008" and s.text == "Spell98008" and s.saveAs == "mine", "name and text: " .. tostring(s.name))
  assert(s.outputs.text and s.outputs.speech and not s.outputs.alert and not s.outputs.icon and not s.outputs.bar
    and not s.outputs.circle, "shows Text and speaks")
  assert(s.speech == "text" and s.warn == 5 and s.linger == nil and s.glow == nil and s.sound == nil and s.iconID == nil,
    "the cooldown defaults: " .. tostring(s.speech) .. " " .. tostring(s.warn))
  assert(s.color == nil, "default colour (its chip tints accent as any uncoloured template)")
  assert(chipFor(v, made.id), "its chip shows on the templates row")
  assert(#opened == 0 and #editedSaved == 0, "nothing opened")
  -- the built-in cooldown is unchanged: still listed, still read-only
  assert(cdChipFor(v, 98008) and cdChipFor(v, 98008).cooldown.name == "Spell98008", "the cooldown stays")
  -- a left click on a cooldown chip never opens a menu
  reset()
  c.OnMouseDown(c, "LeftButton") c.OnMouseUp(c, "LeftButton")
  assert(#menus == 0, "left click: no menu")
  S:Delete(made.id)
end
print("ok cooldown: save as template uses the cooldown defaults")

do
  clearSaves()
  local v = newView()
  local hs = v.hscroll
  cx, cy = screenX(v, 70), laneY(laneIndex(v, "Plain"))
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  local place = item(menus[1].root, "Place")
  local sub = item(place, "Cooldowns")
  assert(sub, "Place has Cooldowns: " .. texts(place))
  assert(texts(sub) == "button:Spell108280|button:Spell98008|button:Spell114052", "the filter's cooldowns: " .. texts(sub))
  cx, cy = 650, 450 -- the cursor moves to the menu
  click(item(item(sub, "Spell98008"), "Just me"))
  local list = reminders()
  assert(#opened == 0 and #list == 1 and list[1].r.spellID == 98008 and list[1].r.text == "Spell98008" and list[1].r.times == "P2 +0:10",
    "placed like a drop, at once")
  textAndSpeech(list[1].r, "Place")
  assert(lastPrint() == "Spell98008 placed at 1:10 for you.", "chat: " .. tostring(lastPrint()))
  -- on Personal notes, as a raid member: mine
  reset()
  group.leader = false
  cx, cy = screenX(v, 70), laneY(laneIndex(v, "Personal notes"))
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  click(item(item(item(menus[1].root, "Place"), "Cooldowns"), "Spell108280"))
  assert(#opened == 0 and #reminders() == 2 and noteCount() == 0, "Personal notes: mine")
  group.leader = true
  -- the filter's list follows the dropdown
  CRT.db.alerts.cooldownFilter = "WARRIOR"
  reset()
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  assert(texts(item(item(menus[1].root, "Place"), "Cooldowns")) == "button:Spell97462", "warrior")
  CRT.db.alerts.cooldownFilter = "mine"
  clearSaves()
end
print("ok cooldown: place submenu saves at once")

do
  local blank = View.Create(mock("Frame"))
  blank:SetData(nil, nil, nil, nil)
  assert(not blank.strip:IsShown(), "no boss: the strip hides")
  assert(blank.cdScroll and blank.cdScroll.parent == blank.strip, "the cooldown row is inside the strip")
  assert(blank.cdFilter and blank.cdFilter.parent == blank.strip, "and its dropdown")
  -- a boss, then none: hidden again; a boss again: shown with its chips
  local v = newView()
  assert(v.strip:IsShown() and #cdChips(v) == 3, "a boss: shown")
  v:SetData(nil, nil, nil, nil)
  assert(not v.strip:IsShown(), "boss gone: hidden")
  v:SetData({ reference = ref }, 3001, nil, "Nek")
  assert(v.strip:IsShown() and #cdChips(v) == 3, "back")
end
print("ok cooldowns: row hidden with no boss")

do
  local v = newView()
  local strip = v.strip
  local top = 2 + strip.h -- the strip sits 2 px up from the bottom
  assert(strip.h == 52, "two rows of 26: " .. tostring(strip.h))
  assert(v.unknownText.pts.BOTTOMLEFT[5] >= top, "Time unknown above the strip: " .. v.unknownText.pts.BOTTOMLEFT[5])
  assert(v.bar.pts.BOTTOMLEFT[5] >= v.unknownText.pts.BOTTOMLEFT[5] + 16, "the bar above Time unknown")
  local lanesBottom = v.vscroll.pts.BOTTOMRIGHT[5]
  assert(lanesBottom >= v.bar.pts.BOTTOMLEFT[5] + 10, "the lanes above the bar: " .. lanesBottom)
  -- inside the strip: the templates on the first row, the cooldowns on the second
  local t, c = v.chipScroll.pts, v.cdScroll.pts
  assert(t.TOPLEFT[5] <= 0 and t.BOTTOMRIGHT[5] >= -26, "templates in row 1")
  assert(c.RIGHT[2] == strip and c.RIGHT[5] == -39 and v.cdScroll.h == 20, "cooldowns centred in row 2, a chip high")
  assert(v.cdLabel.pt[5] < -26 and v.cdLabel.pt[5] > -52, "the label on row 2")
  -- the lanes still show at least three rows docked (holder 552 px) and in the smallest pop-out (208 px)
  for _, h in ipairs({ 552, 208 }) do
    local rows = math.floor((h - 20 - lanesBottom) / 30)
    assert(rows >= 3, h .. " px shows " .. rows .. " rows")
  end
end
print("ok layout: strip with two rows doesn't overlap the lanes")

do
  -- the cooldown chips start 6 px after the dropdown, whatever the label's width
  local v = newView()
  local c = v.cdScroll.pts
  assert(c.LEFT and c.LEFT[2] == v.cdFilter.Dropdown and c.LEFT[3] == "RIGHT" and c.LEFT[4] == 6, "after the dropdown button")
  assert(c.RIGHT and c.RIGHT[2] == v.strip and c.RIGHT[4] == 0, "to the strip's right end")
  assert(c.TOPLEFT == nil, "no fixed x")
  -- no dropdown (no UI.Dropdown): after the (?)
  local real = CRT.UI.Dropdown
  CRT.UI.Dropdown = nil
  local nd = newView()
  local lp = nd.cdScroll.pts.LEFT
  assert(nd.cdFilter == nil and lp and lp[2] ~= nil and lp[2] ~= nd.cdLabel and lp[3] == "RIGHT", "after the (?)")
  -- no (?) either: after the label
  local realHelp = CRT.UI.HelpRight
  CRT.UI.HelpRight = nil
  local nh = newView()
  assert(nh.cdScroll.pts.LEFT[2] == nh.cdLabel, "after the label")
  CRT.UI.Dropdown, CRT.UI.HelpRight = real, realHelp
  assert(#cdChips(nh) == 3, "chips still drawn")
end
print("ok cooldowns: chips start after the dropdown")

-- strip rows: the templates and the cooldowns wrap onto rows, up to 3 shown per group
local function longTemplates(n)
  local ids = {}
  for i = 1, n do ids[i] = S:Save(nil, { name = "Saved alert number " .. i, text = "x", outputs = { alert = true } }) end
  return ids
end
local function groupH(s) local p = s.pts if p.TOPLEFT and p.BOTTOMRIGHT then return p.TOPLEFT[5] - p.BOTTOMRIGHT[5] end return s.h end
local function deleteAll(ids) for _, id in ipairs(ids) do S:Delete(id) end end
local function pickFilter(v, text) for _, x in ipairs(filterMenu(v).items) do if x.text == text then x.fn() end end end

do
  local v = newView()
  assert(v.chipRows == 1 and v.chipShown == 1, "three templates fit one row: " .. tostring(v.chipRows))
  local many = longTemplates(4)
  local list = chips(v)
  local width = v.chipScroll:GetWidth()
  local rows = {}
  for _, c in ipairs(list) do
    assert(c.pt[1] == "TOPLEFT" and c.pt[2] == v.chipRow, "anchored in the group")
    assert(c.pt[4] >= 0 and c.pt[4] + c.w <= width, "inside the group's width: " .. c.pt[4] .. "+" .. c.w)
    local r = -c.pt[5] / 26 + 1
    assert(r == math.floor(r), "on a row: " .. c.pt[5])
    rows[r] = (rows[r] or 0) + 1
  end
  assert(rows[1] and rows[2], "chips on rows 1 and 2")
  assert(v.chipRows == 2, "two rows: " .. tostring(v.chipRows))
  -- in order: a chip after another on its row, or first on the next row
  for i = 2, #list do
    local a, b = list[i - 1], list[i]
    assert((b.pt[5] == a.pt[5] and b.pt[4] >= a.pt[4] + a.w) or (b.pt[5] == a.pt[5] - 26 and b.pt[4] == 0), "chip " .. i .. " follows")
  end
  -- the + chip stays last
  local last = list[#list]
  local p = v.plus.pt
  assert((p[5] == last.pt[5] and p[4] >= last.pt[4] + last.w) or (p[5] == last.pt[5] - 26 and p[4] == 0), "+ last")
  assert(p[4] + 22 <= width, "+ inside the width")
  deleteAll(many)
  assert(v.chipRows == 1, "back to one row")
end
print("ok strip rows: chips wrap onto a second row")

do
  local v = newView()
  local mine = longTemplates(12)
  local timers = {}
  C_Timer.After = function(_, fn) timers[#timers + 1] = fn end
  local realW = v.chipScroll.GetWidth
  v.chipScroll.GetWidth = function() return 0 end
  v:DrawStrip()
  assert(v.chipRows == 1 and #timers == 1, "no width yet: one row and a rewrap queued: " .. v.chipRows .. " " .. #timers)
  v:DrawStrip()
  assert(#timers == 1, "the rewrap is queued once")
  v.chipScroll.GetWidth = realW
  timers[1]()
  assert(v.chipRows > 1, "rewrapped once the width is known: " .. v.chipRows)
  C_Timer.After = function() end
  deleteAll(mine)
end
print("ok strip rows: the first draw rewraps once the width is known")

do
  local v = newView()
  local many = longTemplates(12)
  assert(v.chipRows > 3, "more than three rows: " .. v.chipRows)
  assert(v.chipShown == 3 and groupH(v.chipScroll) == 3 * 26 - 6, "three shown: " .. v.chipShown .. " h " .. tostring(groupH(v.chipScroll)))
  assert(v.chipFirst == 0 and v.chipScroll:GetVerticalScroll() == 0, "from the first row")
  assert(v.chipScroll.wheel, "the group takes the wheel")
  v.chipScroll.OnMouseWheel(v.chipScroll, -1)
  assert(v.chipFirst == 1 and v.chipScroll:GetVerticalScroll() == 26, "one row per notch")
  assert(v.chipScroll:GetHorizontalScroll() == 0, "never sideways")
  for _ = 1, 50 do v.chipScroll.OnMouseWheel(v.chipScroll, -1) end
  local most = v.chipRows - 3
  assert(v.chipFirst == most and v.chipScroll:GetVerticalScroll() == most * 26, "clamped at the last row")
  for _ = 1, 50 do v.chipScroll.OnMouseWheel(v.chipScroll, 1) end
  assert(v.chipFirst == 0 and v.chipScroll:GetVerticalScroll() == 0, "clamped at the first row")
  -- the cooldowns the same way
  pickFilter(v, "All")
  assert(v.cdRows > 3 and v.cdShown == 3 and v.cdScroll.h == 3 * 26 - 6, "cooldowns: three of " .. v.cdRows)
  v.cdScroll.OnMouseWheel(v.cdScroll, -1)
  assert(v.cdFirst == 1 and v.cdScroll:GetVerticalScroll() == 26, "cooldowns: one row per notch")
  for _ = 1, 50 do v.cdScroll.OnMouseWheel(v.cdScroll, -1) end
  assert(v.cdFirst == v.cdRows - 3, "cooldowns: clamped")
  -- a group that fits does not scroll
  pickFilter(v, "Your class")
  v.cdScroll.OnMouseWheel(v.cdScroll, -1)
  assert(v.cdFirst == 0 and v.cdScroll:GetVerticalScroll() == 0, "nothing to scroll")
  -- the templates scrolled to their end, then fewer: back in range
  for _ = 1, 50 do v.chipScroll.OnMouseWheel(v.chipScroll, -1) end
  deleteAll(many)
  assert(v.chipFirst == 0 and v.chipScroll:GetVerticalScroll() == 0, "fewer rows: back in range")
  CRT.db.alerts.cooldownFilter = "mine"
end
print("ok strip rows: at most 3 rows, wheel scrolls the rest")

do
  local v = newView()
  assert(v.chipBar and v.cdBar, "an indicator per group")
  assert(not v.chipBar.track:IsShown() and not v.chipBar.thumb:IsShown(), "templates fit: no indicator")
  assert(not v.cdBar.track:IsShown() and not v.cdBar.thumb:IsShown(), "cooldowns fit: no indicator")
  local many = longTemplates(12)
  local bar = v.chipBar
  assert(bar.track:IsShown() and bar.thumb:IsShown(), "more rows: the indicator shows")
  local tp = bar.track.pts.TOPRIGHT
  assert(tp and tp[2] == v.chipScroll and tp[3] == "TOPRIGHT", "at the group's right end")
  assert(bar.track.w == 3 and bar.thumb.w == 3, "3 px wide")
  local h = groupH(v.chipScroll)
  assert(bar.track.h == h, "as tall as the group")
  assert(math.abs(bar.thumb.h - h * 3 / v.chipRows) < 0.01, "thumb shows the share on screen: " .. bar.thumb.h)
  assert(bar.thumb.pts.TOPRIGHT[5] == 0, "at the top first")
  for _ = 1, 50 do v.chipScroll.OnMouseWheel(v.chipScroll, -1) end
  local y = bar.thumb.pts.TOPRIGHT[5]
  assert(math.abs(y + h * (v.chipRows - 3) / v.chipRows) < 0.01, "at the bottom last: " .. y)
  assert(math.abs(-y + bar.thumb.h - h) < 0.01, "its end at the group's end")
  -- the chips leave room for it
  for _, c in ipairs(chips(v)) do assert(c.pt[4] + c.w <= v.chipScroll:GetWidth() - 3, "clear of the indicator") end
  assert(v.plus.pt[4] + 22 <= v.chipScroll:GetWidth() - 3, "+ clear of the indicator")
  deleteAll(many)
  assert(not bar.track:IsShown() and not bar.thumb:IsShown(), "fits again: hidden")
  pickFilter(v, "All")
  assert(v.cdBar.track:IsShown() and v.cdBar.track.pts.TOPRIGHT[2] == v.cdScroll, "cooldowns: at their right end")
  CRT.db.alerts.cooldownFilter = "mine"
end
print("ok strip rows: indicator only when there is more")

local function checkLayout(v, stripH)
  assert(v.stripH == stripH and v.strip.h == stripH, "strip " .. tostring(v.stripH) .. " / " .. tostring(v.strip.h) .. ", want " .. stripH)
  assert(v.unknownText.pts.BOTTOMLEFT[5] == stripH + 2 and v.unknownText.pts.BOTTOMRIGHT[5] == stripH + 2, "Time unknown on the strip")
  assert(v.bar.pts.BOTTOMLEFT[5] == stripH + 16 + 2 and v.bar.pts.BOTTOMRIGHT[5] == stripH + 16 + 2, "the bar above it")
  assert(v.vscroll.pts.BOTTOMRIGHT[5] == stripH + 16 + 10 + 4, "the lanes above the bar")
end

do
  local v = newView()
  v.frame.h = 552 -- docked: room for 3 rows of each
  v:Refresh()
  checkLayout(v, 52)
  local many = longTemplates(12)
  checkLayout(v, 4 * 26)
  -- the cooldowns sit under the templates' rows: label on their first row, chips centred in their rows
  assert(v.cdLabel.pt[5] == -3 * 26 - 13, "the label on the cooldowns' first row: " .. v.cdLabel.pt[5])
  local c = v.cdScroll.pts
  assert(c.RIGHT[2] == v.strip and c.RIGHT[5] == -3 * 26 - 13 and v.cdScroll.h == 20, "one row of cooldowns under three")
  assert(c.LEFT[2] == v.cdFilter.Dropdown and c.LEFT[4] == 6 and c.LEFT[5] == 0, "after the dropdown, level with it")
  pickFilter(v, "All")
  checkLayout(v, 6 * 26)
  c = v.cdScroll.pts
  assert(c.RIGHT[5] == -3 * 26 - 39 and v.cdScroll.h == 3 * 26 - 6, "three rows of cooldowns: " .. c.RIGHT[5])
  assert(c.LEFT[5] == -26, "the left edge level with the middle: " .. c.LEFT[5])
  assert(v.chipScroll.pts.BOTTOMRIGHT[5] == -3 * 26 + 3, "templates: three rows")
  deleteAll(many)
  checkLayout(v, 4 * 26)
  pickFilter(v, "Your class")
  checkLayout(v, 52)
  assert(v.cdLabel.pt[5] == -39, "back on row 2")
  v.frame.h = nil
  CRT.db.alerts.cooldownFilter = "mine"
end
print("ok strip rows: strip height follows the rows")

do
  local many = longTemplates(12)
  local v = newView()
  pickFilter(v, "All")
  local function lanesShown(h)
    v.frame.h = h
    v:Refresh()
    return math.floor((h - (v.axisH or 20) - v.vscroll.pts.BOTTOMRIGHT[5]) / 30)
  end
  -- docked (holder 552 px): every row they need, up to 3 each
  assert(lanesShown(552) >= 3 and v.chipShown == 3 and v.cdShown == 3, "docked: 3 and 3")
  -- in between: fewer rows shown, still 3 lanes
  for _, h in ipairs({ 300, 260, 230 }) do
    local n = lanesShown(h)
    assert(n >= 3, h .. " px shows " .. n .. " lanes")
    assert(v.chipShown >= 1 and v.cdShown >= 1, "a row each")
  end
  -- the smallest pop-out (208 px): one row each, and they scroll
  assert(lanesShown(208) >= 3, "208 px: 3 lanes")
  assert(v.chipShown == 1 and v.cdShown == 1 and v.stripH == 52, "one row each: " .. v.chipShown .. "/" .. v.cdShown)
  assert(v.chipBar.track:IsShown() and v.cdBar.track:IsShown(), "both show there is more")
  v.chipScroll.OnMouseWheel(v.chipScroll, -1)
  assert(v.chipFirst == 1 and v.chipScroll:GetVerticalScroll() == 26, "and scroll a row")
  for _ = 1, 50 do v.chipScroll.OnMouseWheel(v.chipScroll, -1) end
  assert(v.chipFirst == v.chipRows - 1, "to the last row")
  -- growing again keeps the first row in range
  lanesShown(552)
  assert(v.chipFirst == v.chipRows - 3, "clamped when more rows show: " .. v.chipFirst)
  v.frame.h = nil
  deleteAll(many)
  CRT.db.alerts.cooldownFilter = "mine"
end
print("ok strip rows: lanes keep 3 rows at the smallest pop-out")

do
  local many = longTemplates(12)
  local v = newView()
  local plain = laneIndex(v, "Plain")
  local function onRow(r)
    for _, c in ipairs(chips(v)) do if c.pt[5] == -(r - 1) * 26 then return c end end
  end
  local c = assert(onRow(2), "a chip on row 2")
  dragChip(v, c, screenX(v, 70), laneY(plain), { check = function()
    assert(v.chipGhost:IsShown() and v.chipGhost.name:GetText() == c.name:GetText(), "its ghost")
  end })
  assert(#opened == 1 and opened[1].prefill.saved == c.savedID and opened[1].prefill.time == 10, "dropped from row 2")
  -- scrolled down a row, a chip on row 4 drops too
  reset()
  v.chipScroll.OnMouseWheel(v.chipScroll, -1)
  local d = assert(onRow(4), "a chip on row 4")
  dragChip(v, d, screenX(v, 70), laneY(plain))
  assert(#opened == 1 and opened[1].prefill.saved == d.savedID, "dropped from row 4")
  -- its right-click menu still opens
  reset()
  d.OnMouseUp(d, "RightButton")
  assert(#menus == 1, "its menu")
  deleteAll(many)
end
print("ok strip rows: drag from a wrapped chip still drops")

-- Assigning a dropped cooldown to a player ------------------------------------------------------------
local function setLayout(names) local w = {} for i = 1, 40 do w[i] = names[i] or "" end
  CRT.db.groups.presets = { { id = 1, name = "Main", slots = w } } CRT.db.groups.active = 1 end
local function setWorking(names) local w = {} for i = 1, 40 do w[i] = names[i] or "" end CRT.db.groups.working = w end
local function plainText(s) return (tostring(s):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
local function ptexts(d) local out = {} for _, x in ipairs(d.items) do out[#out + 1] = x.kind .. ":" .. plainText(x.text) end return table.concat(out, "|") end
local function pitem(d, text) for _, x in ipairs(d.items) do if plainText(x.text) == text then return x end end end
-- the layout: two shamans (one live, one known from the class cache), a live priest, a warrior from the
-- cache, and a name whose class nobody knows
local function assignSetup()
  RAID_CLASS_COLORS.SHAMAN = { r = 0, g = 0.44, b = 0.87, colorStr = "ff0070dd" }
  RAID_CLASS_COLORS.PRIEST = { r = 1, g = 1, b = 1 }
  setLayout({ "Rain-Home", "Bob-Home", "Tide-Other", "Zed-Home", "Ann-Home" })
  liveRoster = { { "Rain", "SHAMAN" }, { "Bob", "PRIEST" } }
  CRT.db.classCache["tide-other"] = "SHAMAN"
  CRT.db.classCache["zed-home"] = "WARRIOR"
end
local function assignTeardown()
  RAID_CLASS_COLORS.SHAMAN, RAID_CLASS_COLORS.PRIEST = nil, nil
  setLayout({})
  setWorking({})
  liveRoster = {}
  CRT.db.classCache = {}
  group.leader, group.assist = true, false
end
local FULL = "title:Shaman|button:Rain|button:Tide-Other|divider:nil|button:Anyone else|divider:nil|button:Just me"
local function dropCooldown(v, id, laneLabel)
  dragChip(v, cdChipFor(v, id), screenX(v, 70), laneY(laneIndex(v, laneLabel or "Plain")))
end

do
  assignSetup()
  local v = newView()
  dropCooldown(v, 108280)
  assert(#opened == 0, "a leader's drop opens a menu, not the editor")
  assert(#menus == 1, "one menu")
  local root = menus[1].root
  assert(ptexts(root) == FULL, "the class's players first: " .. ptexts(root))
  assert(root.items[2].text == "|cff0070ddRain|r", "class-coloured: " .. tostring(root.items[2].text))
  assignTeardown()
end
print("ok assign: drop menu lists the class's players first")

do
  assignSetup()
  clearSaves()
  local v = newView()
  local seen
  rawset(v, "WrittenTime", function(_, spellID, text, t) seen = { spellID, text, t } return t end)
  dropCooldown(v, 108280)
  cx, cy = 650, 450 -- the cursor moves to the menu
  click(pitem(menus[1].root, "Rain"))
  assert(#opened == 0, "no editor")
  local t, id = noteLine()
  assert(t and t.tags[1] == "Rain" and #t.tags == 1, "a raid note line for Rain: " .. tostring(t and t.tags[1]))
  assert(t.spellId == 108280 and t.text == "Spell108280" and t.ph == 2 and t.time == 10, "spell, text, drop time")
  textAndSpeechLine(t, "for Rain")
  local record = N:Get(id)
  assert(record.encounterID == 3001 and record.name == "Nek", "a new note for this boss")
  assert(#reminders() == 0, "no reminder")
  assert(lastPrint() == "Spell108280 placed at 1:10 for Rain.", "chat: " .. tostring(lastPrint()))
  assert(seen and seen[1] == 108280 and seen[3] == 70, "WrittenTime asked")
  rawset(v, "WrittenTime", nil)
  -- a second one goes to the same note (the one FindForEncounter gives), under the first
  reset()
  dropCooldown(v, 108280)
  click(pitem(menus[1].root, "Tide-Other"))
  local t2, id2 = noteLine(3)
  assert(id2 == id and noteCount() == 1 and t2 and t2.tags[1] == "Tide-Other", "another realm keeps its realm, same note")
  -- the boss's note for the difficulty you are in is the one written to (S18)
  clearSaves()
  local heroic = N:Import("EncounterID:3001;Difficulty:Heroic;Name:Nek\\n")
  local mythic = N:Import("EncounterID:3001;Difficulty:Mythic;Name:Nek\\n")
  GetInstanceInfo = function() return "Raid", "raid", 16, "Mythic" end
  GetDifficultyInfo = function(d) if d == 16 then return "Mythic" end end
  reset()
  dropCooldown(v, 108280)
  click(pitem(menus[1].root, "Rain"))
  GetInstanceInfo, GetDifficultyInfo = nil, nil
  assert(N:TimerAt(mythic, 2) and N:TimerAt(mythic, 2).tags[1] == "Rain" and not N:TimerAt(heroic, 2), "the Mythic note")
  clearSaves()
  assignTeardown()
end
print("ok cooldown: picked player makes a raid note line for them")

do
  assignSetup()
  clearSaves()
  setLayout({ "Bob-Home", "Ann-Home" })
  liveRoster = { { "Bob", "PRIEST" } }
  local v = newView()
  dropCooldown(v, 108280)
  local root = menus[1].root
  assert(ptexts(root) == "title:Shaman|button:No Shaman on this roster|button:Leave unassigned|divider:nil|button:Anyone else|divider:nil|button:Just me",
    "no shaman: " .. ptexts(root))
  local none = pitem(root, "No Shaman on this roster")
  assert(none.enabled == false and none.fn == nil, "greyed and disabled")
  click(pitem(root, "Leave unassigned"))
  assert(#opened == 0, "no editor")
  local t = noteLine()
  assert(t and #t.tags == 0 and t.spellId == 108280 and t.ph == 2 and t.time == 10, "a raid note line for no one: " .. tostring(t and t.tags[1]))
  textAndSpeechLine(t, "unassigned")
  assert(#reminders() == 0, "no reminder")
  assert(lastPrint() == "Spell108280 placed at 1:10 unassigned.", "chat: " .. tostring(lastPrint()))
  clearSaves()
  assignTeardown()
end
print("ok assign: no one of that class greys the title and offers Leave unassigned")
print("ok cooldown: leave unassigned makes a line for no one")

do
  assignSetup()
  clearSaves()
  local v = newView()
  dropCooldown(v, 108280)
  local sub = pitem(menus[1].root, "Anyone else")
  assert(ptexts(sub) == "button:Ann|button:Bob|button:Zed", "every other player, alphabetical: " .. ptexts(sub))
  assert(pitem(sub, "Ann").text == "Ann", "an unknown class is not coloured")
  assert(pitem(sub, "Bob").text == "|cffffffffBob|r", "class-coloured: " .. tostring(pitem(sub, "Bob").text))
  click(pitem(sub, "Bob"))
  local t = noteLine()
  assert(#opened == 0 and t and t.tags[1] == "Bob" and t.spellId == 108280, "a raid note line for Bob")
  clearSaves()
  assignTeardown()
end
print("ok assign: anyone else submenu")

do
  assignSetup()
  clearSaves()
  local v = newView()
  dropCooldown(v, 108280)
  click(pitem(menus[1].root, "Just me"))
  local list = reminders()
  assert(#opened == 0 and #list == 1 and list[1].r.spellID == 108280 and list[1].r.text == "Spell108280" and list[1].r.times == "P2 +0:10",
    "an Only me reminder at the drop")
  assert(noteCount() == 0, "no raid note")
  assert(lastPrint() == "Spell108280 placed at 1:10 for you.", "chat: " .. tostring(lastPrint()))
  clearSaves()
  assignTeardown()
end
print("ok assign: just me saves an only me reminder")

do
  assignSetup()
  clearSaves()
  group.leader = false
  local v = newView()
  dropCooldown(v, 108280)
  assert(#menus == 0 and #opened == 0, "no menu, no editor for a member")
  local list = reminders()
  assert(#list == 1 and list[1].r.spellID == 108280 and list[1].r.times == "P2 +0:10" and noteCount() == 0, "saved as Only me")
  clearSaves()
  assignTeardown()
end
print("ok assign: non-admin gets no menu")

do
  assignSetup()
  clearSaves()
  local v = newView()
  dropCooldown(v, 108280, "Personal notes")
  assert(#menus == 0 and #opened == 0, "no menu on Personal notes")
  assert(#reminders() == 1 and noteCount() == 0, "Only me")
  clearSaves()
  assignTeardown()
end
print("ok assign: personal lane gets no menu")

do
  -- the raid note is asked again at the moment of saving: demoted while the menu is open
  assignSetup()
  clearSaves()
  local v = newView()
  dropCooldown(v, 108280)
  local rain = pitem(menus[1].root, "Rain")
  group.leader = false
  printed[#printed + 1] = "(before)"
  click(rain)
  assert(#opened == 0 and noteCount() == 0 and #reminders() == 0, "nothing saved, nothing opened")
  local _, why = N:CanEditRaid()
  assert(why and lastPrint() ~= "(before)" and lastPrint():find(why, 1, true), "says why: " .. tostring(lastPrint()))
  -- a reminder that can't be saved says so too
  reset()
  local realSave = R.Save
  R.Save = function() return nil end
  dropCooldown(v, 108280)
  R.Save = realSave
  assert(#opened == 0 and #reminders() == 0, "nothing saved, nothing opened")
  assert(#printed == 1 and printed[1]:find(D.TEXT.saveFailed, 1, true), "says why: " .. tostring(printed[1]))
  -- an error inside the save is caught and said the same way
  reset()
  R.Save = function() error("boom") end
  dropCooldown(v, 108280)
  R.Save = realSave
  assert(#opened == 0 and #printed == 1 and #reminders() == 0, "an error says why: " .. tostring(printed[1]))
  clearSaves()
  assignTeardown()
end
print("ok cooldown: a failed save says why and opens nothing")

do
  assignSetup()
  setLayout({})
  local v = newView()
  dropCooldown(v, 108280)
  assert(ptexts(menus[1].root) == "title:Shaman|button:Rain|divider:nil|button:Anyone else|divider:nil|button:Just me",
    "the live group: " .. ptexts(menus[1].root))
  assert(ptexts(pitem(menus[1].root, "Anyone else")) == "button:Bob", "live: " .. ptexts(pitem(menus[1].root, "Anyone else")))
  -- nobody anywhere: Leave unassigned and Just me
  liveRoster = {}
  reset()
  dropCooldown(v, 108280)
  assert(ptexts(menus[1].root) == "button:Leave unassigned|divider:nil|button:Just me", "empty: " .. ptexts(menus[1].root))
  assignTeardown()
end
print("ok assign: roster falls back to the live group")

do
  assignSetup()
  local v = newView()
  local hs = v.hscroll
  cx, cy = screenX(v, 70), laneY(laneIndex(v, "Plain"))
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  local cds = item(item(menus[1].root, "Place"), "Cooldowns")
  local sub = item(cds, "Spell108280")
  assert(sub and sub.fn == nil and ptexts(sub) == FULL, "the same choices: " .. (sub and ptexts(sub) or "none"))
  cx, cy = 650, 450
  clearSaves()
  click(pitem(sub, "Rain"))
  local t = noteLine()
  assert(#opened == 0 and t and t.tags[1] == "Rain" and t.spellId == 108280 and t.ph == 2 and t.time == 10, "placed for Rain")
  clearSaves()
  reset()
  cx, cy = screenX(v, 70), laneY(laneIndex(v, "Plain"))
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  click(item(item(item(item(menus[1].root, "Place"), "Cooldowns"), "Spell108280"), "Just me"))
  assert(#opened == 0 and #reminders() == 1 and noteCount() == 0, "Just me from Place")
  -- a member, or the Personal notes lane: the cooldown is a plain button, Only me
  for _, case in ipairs({ { leader = false, lane = "Plain" }, { leader = true, lane = "Personal notes" } }) do
    clearSaves()
    reset()
    group.leader = case.leader
    cx, cy = screenX(v, 70), laneY(laneIndex(v, case.lane))
    hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
    local b = item(item(item(menus[1].root, "Place"), "Cooldowns"), "Spell108280")
    assert(#b.items == 0, "no choices: " .. case.lane)
    click(b)
    assert(#opened == 0 and #reminders() == 1 and noteCount() == 0, "Only me: " .. case.lane)
  end
  clearSaves()
  assignTeardown()
end
print("ok assign: place submenu offers the same choices")

do
  assignSetup()
  -- a draft on the Raid Groups page (the working grid) with another shaman: not the roster
  setWorking({ "Wave-Home", "Rain-Home" })
  CRT.db.classCache["wave-home"] = "SHAMAN"
  local v = newView()
  dropCooldown(v, 108280)
  assert(ptexts(menus[1].root) == FULL, "the active layout, not the draft: " .. ptexts(menus[1].root))
  assignTeardown()
end
print("ok assign: roster is the active layout")

do
  assignSetup()
  setWorking({ "Wave-Home" })
  CRT.db.classCache["wave-home"] = "SHAMAN"
  CRT.db.groups.active = nil
  local v = newView()
  dropCooldown(v, 108280)
  local want = "title:Shaman|button:Rain|divider:nil|button:Anyone else|divider:nil|button:Just me"
  assert(ptexts(menus[1].root) == want, "no active layout: the live group: " .. ptexts(menus[1].root))
  -- an active id whose layout was deleted: the live group too
  CRT.db.groups.active = 7
  reset()
  dropCooldown(v, 108280)
  assert(ptexts(menus[1].root) == want, "deleted active layout: " .. ptexts(menus[1].root))
  assignTeardown()
end
print("ok assign: no active layout falls back to the live group")

do
  assignSetup()
  local v = newView()
  local calls, real = 0, v.AssignRoster
  rawset(v, "AssignRoster", function(self) calls = calls + 1 return real(self) end)
  local hs = v.hscroll
  cx, cy = screenX(v, 70), laneY(laneIndex(v, "Plain"))
  hs.OnMouseDown(hs, "RightButton") hs.OnMouseUp(hs, "RightButton")
  local cds = item(item(menus[1].root, "Place"), "Cooldowns")
  assert(#cds.items == 3 and ptexts(item(cds, "Spell98008")) == FULL, "every cooldown has its choices")
  assert(calls == 1, "the roster read once for the Place menu: " .. calls)
  rawset(v, "AssignRoster", nil)
  assignTeardown()
end
print("ok assign: place menu reads the roster once")

do
  assignSetup()
  local v = newView()
  dropCooldown(v, 108280)
  assert(pitem(menus[1].root, "Anyone else").scrollH == 400, "Anyone else scrolls past 400 px")
  assignTeardown()
end
print("ok assign: anyone else submenu scrolls past 400 px")

do
  assignSetup()
  -- a cached class that reads as a secret is not used: the name goes under Anyone else
  CRT.db.classCache["tide-other"] = "SHAMAN_SECRET"
  secretStrings["SHAMAN_SECRET"] = true
  RAID_CLASS_COLORS.SHAMAN_SECRET = { r = 1, g = 0, b = 0 }
  local v = newView()
  dropCooldown(v, 108280)
  assert(ptexts(menus[1].root) == "title:Shaman|button:Rain|divider:nil|button:Anyone else|divider:nil|button:Just me", ptexts(menus[1].root))
  local tide = pitem(pitem(menus[1].root, "Anyone else"), "Tide-Other")
  assert(tide and tide.text == "Tide-Other", "not coloured by a secret class: " .. tostring(tide and tide.text))
  secretStrings["SHAMAN_SECRET"] = nil
  RAID_CLASS_COLORS.SHAMAN_SECRET = nil
  assignTeardown()
end
print("ok assign: a secret cached class is not used")

do
  assignSetup()
  clearSaves()
  local v = newView()
  local real = MenuUtil
  MenuUtil = nil
  dropCooldown(v, 108280)
  MenuUtil = real
  local list = reminders()
  assert(#opened == 0 and #list == 1 and list[1].r.spellID == 108280 and list[1].r.times == "P2 +0:10",
    "no menus: the leader's drop is saved as Only me")
  clearSaves()
  assignTeardown()
end
print("ok assign: no menus, a leader's drop saves as only me")
do
  -- a chip held over the track shows the bands of its spell's cooldown on the lane under the cursor
  clearSaves()
  local v = newView()
  local red, text, accent = { 0.89, 0.29, 0.29 }, CRT.PALETTE.text, CRT.PALETTE.accent
  local function shown() local out = {} for _, t in ipairs(v.bandTex or {}) do if t:IsShown() then out[#out + 1] = t end end return out end
  local function same(c, want) return c and math.abs(c[1] - want[1]) < 1e-6 and math.abs(c[2] - want[2]) < 1e-6 and math.abs(c[3] - want[3]) < 1e-6 end
  local function bandAt(x0, x1, color)
    for _, t in ipairs(shown()) do
      if math.abs(t.pts.TOPLEFT[4] - x0) < 0.01 and math.abs(t.w - (x1 - x0)) < 0.01 and (not color or same(t.color, color)) then return t end
    end
  end
  local function rowY(i) return -(i - 1) * 30 - 2 end
  -- a raid member's cooldown (saved as their own): Healing Tide Totem, 180 s in the list; one of theirs at 0:20
  group.leader = false
  R:Save(3001, nil, { spellID = 108280, times = "P1 0:20", boss = "Nek" })
  local plain, personal = laneIndex(v, "Plain"), laneIndex(v, "Personal notes")
  local c = cdChipFor(v, 108280)
  dragChip(v, c, screenX(v, 70), laneY(plain), { check = function()
    -- 1:10, so -1:50 to 1:10 and 1:10 to 4:10, clamped to the 3:00 view (x = 2t)
    local before, after = bandAt(0, 140, text), bandAt(140, 360, text)
    assert(before and after, "both bands, in your own colour")
    assert(before.pts.TOPLEFT[5] == rowY(plain) and after.pts.TOPLEFT[5] == rowY(plain), "on the lane under the cursor")
    assert(bandAt(40, 140, red), "your 0:20 Healing Tide is inside: red")
    assert(v.dropLine.label:GetText() == "Place at 1:10 \\194\\183 too soon", "too soon: " .. tostring(v.dropLine.label:GetText()))
  end })
  assert(#shown() == 0, "gone after the drop")
  assert(#reminders() == 2, "dropping too soon is still allowed")
  -- the Personal notes lane: that lane
  dragChip(v, c, screenX(v, 170), laneY(personal), { check = function()
    assert(bandAt(0, 340) and bandAt(0, 340).pts.TOPLEFT[5] == rowY(personal), "on Personal notes")
  end, foundUp = true })
  assert(#shown() == 0, "gone after a release elsewhere")
  -- off the track: none; cancelled: none
  clearSaves() reset()
  dragChip(v, c, screenX(v, 70), 150, { check = function() assert(#shown() == 0, "off the track: none") end })
  cx, cy = 150, 150 c.OnMouseDown(c, "LeftButton") cx, cy = screenX(v, 70), laneY(plain) v.frame.OnUpdate(v.frame)
  assert(#shown() > 0, "held over the track")
  v:CancelChipMove()
  assert(#shown() == 0 and not v.bandLabel:IsShown(), "cancelled: none")
  clearSaves() reset()
  -- a template with a spell: the game's base cooldown (777: 45 s); a raid note for everyone, in the note colour
  group.leader = true
  local realBase = GetSpellBaseCooldown
  GetSpellBaseCooldown = function(id) if id == 777 then return 45000 end return 0 end
  CRT.AlertCooldowns:ResetLengths() -- lengths asked during earlier drags are remembered
  dragChip(v, chipFor(v, soakID), screenX(v, 70), laneY(plain), { check = function()
    assert(bandAt(50, 140, accent) and bandAt(140, 230, accent), "the template's spell: 45 s each way")
    assert(v.bandLabel:IsShown() and v.bandLabel:GetText() == "0:45", "its length: " .. tostring(v.bandLabel:GetText()))
    assert(v.dropLine.label:GetText() == "Place at 1:10", "nothing too soon")
  end })
  -- a template without a spell: none
  reset()
  dragChip(v, chipFor(v, moveID), screenX(v, 70), laneY(plain), { check = function() assert(#shown() == 0, "no spell: none") end })
  GetSpellBaseCooldown = realBase
  CRT.AlertCooldowns:ResetLengths()
  for i = #opened, 1, -1 do opened[i] = nil end
  clearSaves() reset()
end
print("ok bands: chip drag shows bands on the lane under the cursor")

do
  -- a refusal with no reason still says why; a missing draft module or spell says it wasn't placed
  clearSaves() reset()
  local v = newView()
  local e = { spellID = 108280, name = "Spell108280", class = "SHAMAN" }
  local realPlace = D.PlaceCooldown
  D.PlaceCooldown = function() return false end
  assert(v:PlaceCooldownAt(70, e) == false, "refused")
  assert(lastPrint() == "Spell108280 was not placed: it could not be saved.", "a reason when none is given: " .. tostring(lastPrint()))
  D.PlaceCooldown = function() return false, "no right" end
  v:PlaceCooldownAt(70, e)
  assert(lastPrint() == "Spell108280 was not placed: no right", "the given reason: " .. tostring(lastPrint()))
  D.PlaceCooldown = realPlace
  reset()
  CRT.AlertDraft = nil
  assert(v:PlaceCooldownAt(70, e) == false and lastPrint() == "Spell108280 was not placed: it could not be saved.", "no draft module: " .. tostring(lastPrint()))
  CRT.AlertDraft = D
  reset()
  assert(v:PlaceCooldownAt(70, { name = "Nothing" }) == false and lastPrint() == "Nothing was not placed: it could not be saved.", "no spell: " .. tostring(lastPrint()))
  assert(#reminders() == 0, "nothing saved")
  clearSaves() reset()
end
print("ok cooldown: a refused or impossible place always says why")

do
  -- the cooldown draft clears a sound and a colour the spell draft might carry
  local realFor = D.ForSpell
  D.ForSpell = function(...) local d = realFor(...) d.sound, d.color = "bell", { 1, 0, 0, 1 } return d end
  local d = D.ForCooldown(108280, nil, "Nek")
  D.ForSpell = realFor
  assert(d.sound == nil and d.color == nil, "no sound, the default colour: " .. tostring(d.sound))
  local keys = D.CooldownDefaults()
  assert(rawget(keys, "sound") == nil and rawget(keys, "color") == nil, "no nil-valued keys")
end
print("ok cooldown: the draft clears sound and colour")

do
  -- (fix 4) a chip drag looks up the cast icon only when the cursor's row or x moves, the other casts
  -- only when its lane changes
  clearSaves() reset()
  group.leader = false
  local v = newView()
  local plain, soul = laneIndex(v, "Plain"), laneIndex(v, "Soulcoil")
  local icons, casts = 0, 0
  local realIcon, realCasts = v.IconSpellAt, v.OtherCasts
  rawset(v, "IconSpellAt", function(...) icons = icons + 1 return realIcon(...) end)
  rawset(v, "OtherCasts", function(...) casts = casts + 1 return realCasts(...) end)
  local c = chipFor(v, soakID)
  cx, cy = 150, 150 c.OnMouseDown(c, "LeftButton")
  cx, cy = screenX(v, 70), laneY(plain)
  for _ = 1, 10 do v.frame.OnUpdate(v.frame) end
  assert(icons == 1 and casts == 1, "one look each while still: " .. icons .. " " .. casts)
  cx = cx + 0.2 v.frame.OnUpdate(v.frame)
  assert(icons == 1, "under a pixel: no new look")
  cx = cx + 5 v.frame.OnUpdate(v.frame)
  assert(icons == 2 and casts == 1, "along the lane: the icon looked up, the casts kept: " .. icons .. " " .. casts)
  cy = laneY(soul) v.frame.OnUpdate(v.frame)
  assert(icons == 3 and casts == 2, "another lane: both again: " .. icons .. " " .. casts)
  v:CancelChipMove()
  rawset(v, "IconSpellAt", nil) rawset(v, "OtherCasts", nil)
  group.leader = true
  clearSaves() reset()
end
print("ok bands: a chip drag looks things up only when they change")

do
  -- the chips follow the theme: Default: Blizzard the roll frame's grey stone, a Modern theme its own
  -- flat colour; a theme switch repaints them at once (template chips, the + chip, cooldowns, the ghost)
  local UI = CRT.UI
  CRT.db.ui.modern = false
  local v = newView()
  local function look(c, what)
    assert(c.stone and c.bg, what .. ": a stone and a flat background")
    return c.stone:IsShown(), c.bg:IsShown()
  end
  local function all() local out = chips(v) out[#out + 1] = v.plus for _, c in ipairs(cdChips(v)) do out[#out + 1] = c end return out end
  assert(#cdChips(v) > 0, "some cooldown chips")
  for i, c in ipairs(all()) do
    local stone, flat = look(c, "chip " .. i)
    assert(stone and not flat, "Default: Blizzard: chip " .. i .. " on the stone")
    assert(c.stone.texture == UI.STONE.file, "chip " .. i .. ": the shared stone texture")
  end
  local m = chipFor(v, soakID)
  assert(m.edge.color[1] == 1 and m.edge.color[2] == 0, "the coloured edge stays on the stone")
  assert(m.name:GetText() == "Soak" and m.icon:IsShown(), "the name and icon stay")
  -- the ghost too
  cx, cy = 150, 150 m.OnMouseDown(m, "LeftButton") cx, cy = 400, 150 v.frame.OnUpdate(v.frame)
  assert(v.chipGhost.stone:IsShown() and not v.chipGhost.bg:IsShown(), "the ghost on the stone")
  v:CancelChipMove()
  -- a Modern theme: no game art, the theme's surface; repainted live
  local surface = CRT.PALETTE.surface
  local keep = { surface[1], surface[2], surface[3] }
  surface[1], surface[2], surface[3] = 0.2, 0.3, 0.4
  CRT.db.ui.modern = true
  UI:RepaintTheme()
  for i, c in ipairs(all()) do
    local stone, flat = look(c, "chip " .. i)
    assert(flat and not stone, "Modern: chip " .. i .. " flat, no stone")
    assert(c.bg.color[1] == 0.2 and c.bg.color[3] == 0.4, "chip " .. i .. ": the theme's surface")
  end
  cx, cy = 150, 150 m.OnMouseDown(m, "LeftButton") cx, cy = 400, 150 v.frame.OnUpdate(v.frame)
  assert(not v.chipGhost.stone:IsShown() and v.chipGhost.bg:IsShown(), "the ghost flat in Modern")
  v:CancelChipMove()
  -- back: the stone again
  surface[1], surface[2], surface[3] = keep[1], keep[2], keep[3]
  CRT.db.ui.modern = false
  UI:RepaintTheme()
  for i, c in ipairs(all()) do
    local stone, flat = look(c, "chip " .. i)
    assert(stone and not flat, "back to Default: Blizzard: chip " .. i .. " on the stone")
  end
  -- a chip made while Modern is flat from the start
  CRT.db.ui.modern = true
  local late = S:Save(nil, { name = "Zz late", text = "x", outputs = { alert = true } })
  local lc = chipFor(v, late)
  assert(lc.bg:IsShown() and not lc.stone:IsShown(), "a new chip in Modern: flat")
  S:Delete(late)
  CRT.db.ui.modern = false
  UI:RepaintTheme()
end
print("ok theme: chips on the stone in Default: Blizzard, flat in Modern, repainted live")

`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, 40); // 22 sources and the chunk: past the default 20 slots
for (const p of process.argv.slice(2, 24)) {
  let src; try { src = fs.readFileSync(p, 'utf8'); } catch (e) { console.error('cannot read ' + p); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, 22, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
