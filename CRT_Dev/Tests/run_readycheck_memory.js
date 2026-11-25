// Memory over many ready checks: loads the real ready check modules (ReadyCheck/Report.lua, Window.lua, BuffLock.lua,
// EarlyPull.lua) and the ready check bar (Consumables/Data.lua, Ants.lua, Bar.lua, Display.lua, with
// CRT_Core/UI/StatusMark.lua for its marks) on mock frames, then runs
// a 20-player raid through many ready checks: READY_CHECK, the game's window, durability and weapon oil replies,
// answers, UNIT_AURA bursts while people buff (the Ready lock on), READY_CHECK_FINISHED, a pull timer every other check,
// and the window timing out, then a quiet minute.
// It tells a leak from churn:
//   - kept (a leak): after each check it walks everything the addon can still reach (from CRT, the frames and _G,
//     through tables, metatables and function upvalues) and counts tables, entries and string bytes, plus the frames
//     and regions made. All of them must stay flat after the first checks.
//   - churn (garbage the collector takes back): it counts every Lua table made (fengari's luaH_new), per second while
//     the window is open, per UNIT_AURA burst, and per second while nothing is shown. Each has a budget.
// Behaviour checks next to it, so fewer tables never means a different answer: a secret or unreadable aura still makes
// the player "couldn't check", buffs found by fallback name or by a raid buff's name still count, the shared missing
// cell is never changed, tooltips follow a redraw, the Ready lock still locks and unlocks, and a new rank or fleeting
// item in the bags is still the one a click uses.
// Prints the numbers as "measure" lines, with Node's heap after a full collect.
// Re-baseline: after a change that is meant to make more or fewer tables, run this file, read the "measure churn" line,
// and set openBudget, auraBudget and checkBudget (at the bottom) to about 15% over its numbers.
// Usage: node run_readycheck_memory.js <addon folder>
const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const vm = require('vm');
const themeLua = require('./theme_stub');
const placementLua = require('./placement_stub');
const fengari = require('fengari');
const { lua, lauxlib, lualib, to_luastring } = fengari;
const ltable = require('fengari/src/ltable.js');

const root = process.argv[2];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Every Lua table made, counted (constructors, and tables made by the API).
let tablesMade = 0;
const newTable = ltable.luaH_new;
ltable.luaH_new = function (L) { tablesMade++; return newTable(L); };
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');

const panel = read('CRT_Core/UI/Panel.lua');
function slice(from, to) {
  const a = panel.indexOf(from), b = panel.indexOf(to);
  if (a < 0 || b < a) { console.error('FAIL ' + from + ' not found in Panel.lua'); process.exit(1); }
  return 'local ADDON, CRT = ...\nlocal UI = CRT.UI\n' + panel.slice(a, b);
}

const harness = themeLua([root]) + placementLua([root]) + `
local SRC = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function measureLine(text) print("measure " .. text) end
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function date() return "2026-11-20 20:00" end

-- Mock frames: one shared method table, so a frame is only its own fields. Anchors are kept by point, as the game
-- replaces an anchor set again on the same point.
local frames, regionCount = {}, 0
local noop = function() end
local methods = {}
local MT = { __index = function(_, k) return methods[k] or (type(k) == "string" and k:find("^%u") and noop) or nil end }
local function mock(kind, parent, name)
  local m = setmetatable({ kind = kind, parent = parent, name = name, shown = true, pts = {}, scripts = {}, alpha = 1, w = 10, h = 10 }, MT)
  return m
end
function methods.SetPoint(self, point) self.pts[point or "CENTER"] = true end
function methods.ClearAllPoints(self) wipe(self.pts) end
function methods.GetPoint(self) local p = next(self.pts) if p then return p, UIParent, p, 0, 0 end end
function methods.GetNumPoints(self) local n = 0 for _ in pairs(self.pts) do n = n + 1 end return n end
function methods.SetSize(self, w, h) self.w, self.h = w, h end
function methods.SetWidth(self, w) self.w = w end
function methods.SetHeight(self, h) self.h = h end
function methods.GetWidth(self) return self.w end
function methods.GetHeight(self) return self.h end
function methods.GetSize(self) return self.w, self.h end
function methods.GetCenter() return 960, 540 end
function methods.GetLeft() return 900 end
function methods.GetRight() return 1020 end
function methods.GetTop() return 600 end
function methods.GetBottom() return 480 end
function methods.GetEffectiveScale() return 1 end
function methods.GetScale(self) return self.scale or 1 end
function methods.SetScale(self, s) self.scale = s end
function methods.GetName(self) return self.name end
function methods.GetParent(self) return self.parent end
function methods.Show(self) if not self.shown then self.shown = true local s = self.scripts.OnShow if s then s(self) end end end
function methods.Hide(self) if self.shown then self.shown = false local s = self.scripts.OnHide if s then s(self) end end end
function methods.SetShown(self, on) if on then self:Show() else self:Hide() end end
function methods.IsShown(self) return self.shown end
function methods.IsVisible(self) local f = self while f do if not f.shown then return false end f = f.parent end return true end
function methods.SetScript(self, k, fn) self.scripts[k] = fn end
function methods.GetScript(self, k) return self.scripts[k] end
function methods.HookScript(self, k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end fn(...) end end
function methods.RegisterEvent(self, e) self.events = self.events or {} self.events[e] = true end
function methods.RegisterUnitEvent(self, e, unit) self.events = self.events or {} self.events[e] = unit or true end
function methods.UnregisterEvent(self, e) if self.events then self.events[e] = nil end end
function methods.IsEventRegistered(self, e) return self.events and self.events[e] ~= nil or false end
function methods.CreateTexture(self) regionCount = regionCount + 1 return mock("Texture", self) end
function methods.CreateFontString(self) regionCount = regionCount + 1 return mock("FontString", self) end
function methods.SetText(self, t) self.text = t end
function methods.GetText(self) return self.text end
function methods.GetStringWidth(self) return #(tostring(self.text or "")) * 6 end
function methods.GetUnboundedStringWidth(self) return #(tostring(self.text or "")) * 6 end
function methods.SetAlpha(self, a) self.alpha = a end
function methods.GetAlpha(self) return self.alpha end
function methods.GetFrameLevel(self) return self.level or 1 end
function methods.SetFrameLevel(self, l) self.level = l end
function methods.IsMouseOver() return false end
function methods.SetAttribute(self, k, v) self.attrs = self.attrs or {} self.attrs[k] = v end
function methods.GetAttribute(self, k) return self.attrs and self.attrs[k] end
function methods.GetHighlightTexture(self) self.hl = self.hl or methods.CreateTexture(self) return self.hl end
function methods.IsEnabled(self) return self.enabled ~= false end
function methods.Enable(self) self.enabled = true end
function methods.Disable(self) self.enabled = false end
function methods.SetEnabled(self, on) self.enabled = on and true or false end

UIParent = mock("Frame", nil, "UIParent")
WorldFrame = mock("Frame", nil, "WorldFrame")
function CreateFrame(kind, name, parent)
  local f = mock(kind, parent, name)
  frames[#frames + 1] = f
  if name then _G[name] = f end
  return f
end

-- The game -------------------------------------------------------------------------------------------------
local clock = 1000
function GetTime() return clock end
function time() return math.floor(clock) end
function GetServerTime() return math.floor(clock) end
local SECRET = setmetatable({}, { __tostring = function() return "secret" end })
function issecretvalue(v) return rawequal(v, SECRET) end
function InCombatLockdown() return false end
function IsShiftKeyDown() return false end
function GetCursorPosition() return 0, 0 end
local timers = {}
C_Timer = { After = function(delay, fn) timers[#timers + 1] = { at = clock + delay, fn = fn } end }
local function runTimers()
  local i = 1
  while i <= #timers do
    local t = timers[i]
    if t.at <= clock then table.remove(timers, i) t.fn() else i = i + 1 end
  end
end
local function fire(event, ...)
  local unit = ...
  for _, f in ipairs(frames) do
    local reg = f.events and f.events[event]
    if reg and f.scripts.OnEvent and (reg == true or reg == unit) then f.scripts.OnEvent(f, event, ...) end
  end
end
local STEP = 0.1
local function tick(seconds)
  for _ = 1, math.floor(seconds / STEP + 0.5) do
    clock = clock + STEP
    runTimers()
    for _, f in ipairs(frames) do
      local s = f.scripts.OnUpdate
      if s and f:IsVisible() then s(f, STEP) end
    end
  end
end

GameTooltip = mock("GameTooltip")
UIErrorsFrame = mock("Frame")
ReadyCheckFrame = CreateFrame("Frame", "ReadyCheckFrame", UIParent)
ReadyCheckListenerFrame = CreateFrame("Frame", "ReadyCheckListenerFrame", ReadyCheckFrame)
ReadyCheckFrameYesButton = CreateFrame("Button", "ReadyCheckFrameYesButton", ReadyCheckListenerFrame)
ReadyCheckFrame:Hide()

-- A 20-player raid: raid1 is you (a mage, so the Ready lock looks for Arcane Intellect). Half the names come with a realm.
local RAID = 20
local CLASSES = { "MAGE", "PRIEST", "WARRIOR", "DRUID", "SHAMAN", "EVOKER", "PALADIN", "ROGUE", "HUNTER", "WARLOCK" }
local function unitIndex(unit) return tonumber(type(unit) == "string" and unit:match("^raid(%d+)$") or "") end
local function fullName(i) if i == 1 then return "Me" end return "Raider" .. i .. ((i % 2 == 0) and "-OtherRealm" or "") end
function IsInRaid() return true end
function IsInGroup() return true end
function GetNumGroupMembers() return RAID end
function GetNumSubgroupMembers() return 4 end
function GetUnitName(unit) local i = unitIndex(unit) if unit == "player" then i = 1 end return i and fullName(i) or nil end
function UnitName(unit) local n = GetUnitName(unit) return n and n:gsub("%-.*", "") end
function UnitGUID(unit) return "Player-1-" .. tostring(unitIndex(unit) or 1) end
function Ambiguate(name) return (name:gsub("%-.*", "")) end
function UnitIsUnit(a, b) local ia, ib = (a == "player") and 1 or unitIndex(a), (b == "player") and 1 or unitIndex(b) return ia ~= nil and ia == ib end
function UnitClass(unit) local i = (unit == "player") and 1 or unitIndex(unit) or 1 local c = CLASSES[(i - 1) % #CLASSES + 1] return c, c end
function UnitIsConnected() return true end
function UnitIsVisible() return true end
function UnitGroupRolesAssigned(unit) local i = unitIndex(unit) or 1 return i <= 2 and "TANK" or (i <= 6 and "HEALER" or "DAMAGER") end
function UnitIsGroupLeader(unit) return unit == "player" end
function UnitIsGroupAssistant() return false end
function UnitAffectingCombat() return false end
function GetRaidRosterInfo(i) return fullName(i), 0, math.floor((i - 1) / 5) + 1 end
function GetInstanceInfo() return "Raid", "raid", 16 end
local readyAnswers = {}
function GetReadyCheckStatus(unit) local i = unitIndex(unit) return i and (readyAnswers[i] or "waiting") or nil end
function GetInventoryItemDurability() return 80, 100 end
function GetInventoryItemTexture() return 135000 end
GetNormalizedRealmName = function() return "Realm" end
RAID_CLASS_COLORS = {}
for _, c in ipairs(CLASSES) do RAID_CLASS_COLORS[c] = { r = 1, g = 1, b = 1 } end

-- Auras: about thirty on each player, each read a new table as the game gives it. Two players lack Arcane Intellect
-- until the mage buffs them.
local BUFFS = {
  { key = "intellect", spell = 1459, class = "MAGE", label = "Arcane Intellect", short = "Int" },
  { key = "stamina", spell = 21562, class = "PRIEST", label = "Power Word: Fortitude", short = "Sta" },
  { key = "attack", spell = 6673, class = "WARRIOR", label = "Battle Shout", short = "AP" },
  { key = "versatility", spell = 1126, class = "DRUID", label = "Mark of the Wild", short = "Vers" },
  { key = "mastery", spell = 462854, class = "SHAMAN", label = "Skyfury", short = "Mast" },
  { key = "movement", spell = 381748, class = "EVOKER", label = "Blessing of the Bronze", short = "Move" },
}
local buffed = false
local function auraIds(i)
  local ids = { 1001, 1002, 1006 }
  for _, b in ipairs(BUFFS) do
    if not (b.key == "intellect" and (i == 5 or i == 9) and not buffed) then ids[#ids + 1] = b.spell end
  end
  for n = 1, 24 do ids[#ids + 1] = 50000 + n end
  return ids
end
local auraLists = {}
for i = 1, RAID do auraLists[i] = auraIds(i) end
local function refreshAuras() for i = 1, RAID do auraLists[i] = auraIds(i) end end
local auraOverride = {} -- raid index -> function(index) returning that unit's aura, for the behaviour checks
local function auraData(id)
  return { spellId = id, name = (id == 1001) and "Well Fed" or ("Spell" .. id), expirationTime = clock + 1800, icon = id }
end
C_UnitAuras = {
  GetAuraDataByIndex = function(unit, index)
    local i = (unit == "player") and 1 or unitIndex(unit)
    if i and auraOverride[i] then return auraOverride[i](index) end
    local id = i and auraLists[i][index]
    return id and auraData(id) or nil
  end,
  GetPlayerAuraBySpellID = function(id)
    for _, v in ipairs(auraLists[1]) do if v == id then return auraData(id) end end
  end,
}
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return id end }
C_Item = {
  GetItemInfoInstant = function(id) return id, nil, nil, nil, 130000 + id, 0 end,
  GetItemCount = function() return 3 end,
  GetItemSpell = function() return nil end,
  GetItemNameByID = function(id) return "Item" .. id end,
}
local bagExtra = {} -- { itemID, itemName } after the six listed items, for the behaviour checks
-- Crafted quality: rank 3 for the new rank the behaviour checks put in the bags, 1 for the rest.
C_TradeSkillUI = { GetItemCraftedQualityByItemInfo = function(id) return id == 3102 and 3 or 1 end }
C_Container = {
  GetContainerNumSlots = function(bag) return bag == 0 and (6 + #bagExtra) or 0 end,
  GetContainerItemInfo = function(_, slot)
    local extra = bagExtra[slot - 6]
    if extra then return { itemID = extra[1], itemName = extra[2] } end
    return { itemID = 2000 + slot, itemName = "Item" .. (2000 + slot) }
  end,
}
C_PaperDollInfo = { GetTemporaryEnchantmentInfo = function(slot) if slot == 16 then return { remainingTimeMs = 1800000, hasExpirationTime = true } end end }
local sent = 0
C_ChatInfo = { RegisterAddonMessagePrefix = function() end, SendAddonMessage = function() sent = sent + 1 end }
SendChatMessage = function() end

-- A stand-in CRT, with the saved settings' defaults (CRT_Core/Core.lua) ----------------------------------------
local CRT = { db = {
  ui = {}, roleCache = {}, classCache = {},
  consumables = { enabled = true, notStarter = false, lowMinutes = 10, categoryOrder = {}, itemOrder = {}, extra = {}, learned = {} },
  readycheck = {
    tab = "window", auto = true, onPull = false, output = "self", raidsOnly = true, notLFR = true,
    include = { food = true, flask = true, rune = true, vantus = false, buffs = true },
    buffLock = true, fadeOnPull = true, earlyPull = true, earlyPullOutput = "self", flaskWarn = 5, lowFlask = true,
    window = { enabled = true, leadOnly = true, seconds = 30, scale = 100, groupBuffsOnly = true, order = {}, sort = "group",
      classBars = true, locked = false, holdOnHover = true, opacity = 90, border = true,
      columns = { food = true, flask = true, rune = true, vantus = false, intellect = true, stamina = true, attack = true,
        versatility = true, mastery = true, movement = true, durability = true, weapon = true } },
  },
} }
function CRT:Print() end
local CONSUMABLES = { foodBuffs = { { buff = 1001 } }, categories = {
  food = { { item = 2001, buff = 1001 } },
  flask = { { item = 2002, buff = 1002 }, { item = 2003, buff = 1003, low = true } },
  potion = { { item = 2004 } },
  weapon = { { item = 2005 } },
  rune = { { item = 2006, buff = 1006 } },
} }
CRT.Bosses = { RaidBuffs = function() return BUFFS end, Consumables = function() return CONSUMABLES end }
CRT.Groups = { CachedRole = function() return nil end, Normalize = function(n) return n end }
local UI = { PAGE_W = 1026, PAGE_H = 560 }
CRT.UI = UI
function UI:RegisterLayer() end
function UI:SkinCloseButton() end
function UI:RegisterPreview() end
function UI:IsModern() return false end
function UI.ResetButton(parent) return CreateFrame("Button", nil, parent) end
CRT_THEME(CRT, UI)
assert(load(SRC.fade, "Fade"))("CowfeeRaidTools", CRT)
assert(load(SRC.themed, "Themed"))("CowfeeRaidTools", CRT)
CRT_PLACEMENT(CRT)
for _, f in ipairs({ "data", "mark", "ants", "bar", "display", "report", "window", "bufflock", "earlypull" }) do
  assert(load(SRC[f], f))("CowfeeRaidTools", CRT)
end
check(CRT.ReadyCheckWindow and CRT.BuffLock and CRT.EarlyPull and CRT.ConsumablesDisplay, "the ready check modules load")
fire("PLAYER_LOGIN")
fire("PLAYER_ENTERING_WORLD")
tick(1)

-- What the addon can still reach: tables, entries, functions and string bytes, from CRT, the frames and _G.
local function reachable()
  local seen, stack = {}, {}
  local tables, entries, funcs, bytes = 0, 0, 0, 0
  local function push(v)
    local t = type(v)
    if (t == "table" or t == "function") and not seen[v] then
      seen[v] = true
      stack[#stack + 1] = v
    elseif t == "string" and not seen[v] then
      seen[v] = true
      bytes = bytes + #v
    end
  end
  push(CRT) push(frames) push(_G)
  while #stack > 0 do
    local v = stack[#stack]
    stack[#stack] = nil
    if type(v) == "table" then
      tables = tables + 1
      local mt = debug.getmetatable(v)
      if mt then push(mt) end
      for k, x in next, v do
        entries = entries + 1
        push(k) push(x)
      end
    else
      funcs = funcs + 1
      local i = 1
      while true do
        local name, up = debug.getupvalue(v, i)
        if not name then break end
        push(up)
        i = i + 1
      end
    end
  end
  return { tables = tables, entries = entries, funcs = funcs, bytes = bytes, frames = #frames, regions = regionCount }
end

local function snapshot()
  local before = TABLES_MADE()
  local r = reachable()
  r.heap = HEAP_KB()
  TABLES_SKIP(TABLES_MADE() - before) -- the walk's own tables are not the addon's
  return r
end

-- One ready check, as a raid leader sees it. Returns the tables made while the window was open, per second, and per
-- UNIT_AURA burst.
local window = CRT.ReadyCheckWindow

local function cycle(n)
  buffed = false
  refreshAuras()
  wipe(readyAnswers)
  readyAnswers[2] = "ready"
  ReadyCheckFrame:Show()
  local openStart = TABLES_MADE()
  local openAt = clock
  fire("READY_CHECK", "Raider2-OtherRealm", 35)
  tick(0.5)
  for i = 2, RAID do
    local sender = fullName(i):find("-", 1, true) and fullName(i) or (fullName(i) .. "-Realm")
    fire("CHAT_MSG_ADDON", "CRTReady", "D:" .. (60 + i), "RAID", sender)
    fire("CHAT_MSG_ADDON", "CRTReady", "W:" .. (1000 + i) .. ":n", "RAID", sender)
  end
  fire("CHAT_MSG_ADDON", "CRTReady", "Q", "RAID", "Raider3-Realm")
  local auraTables, bursts = 0, 0
  for s = 1, 30 do
    tick(1)
    if s % 3 == 0 and s <= 15 then
      if s == 12 then buffed = true refreshAuras() end
      -- the burst itself: the events, and the Ready lock's one look again 0.25 s after (its cover's OnUpdate)
      local before = TABLES_MADE()
      for i = 1, RAID do fire("UNIT_AURA", "raid" .. i) end
      fire("UNIT_AURA", "player")
      local cover
      for _, f in ipairs(frames) do if f.parent == ReadyCheckFrameYesButton then cover = f end end
      if cover and cover:IsVisible() then cover.scripts.OnUpdate(cover, 0.3) end
      auraTables, bursts = auraTables + (TABLES_MADE() - before), bursts + 1
      tick(0.3)
    end
    if s % 2 == 0 and s <= 20 then
      local i = s / 2 + 2
      readyAnswers[i] = "ready"
      fire("READY_CHECK_CONFIRM", "raid" .. i, true)
    end
  end
  local openSeconds = clock - openAt
  local openTables = TABLES_MADE() - openStart
  if n % 2 == 0 then fire("START_PLAYER_COUNTDOWN", "Player-1-2", 10, 10, nil, "Raider2-OtherRealm") end
  tick(2)
  fire("READY_CHECK_FINISHED")
  ReadyCheckFrame:Hide()
  tick(13)
  check(not _G.CowfeeRaidToolsReadyCheckWindow.shown, "check " .. n .. ": the window has closed by itself")
  return (openTables - auraTables) / openSeconds, auraTables / bursts, TABLES_MADE() - openStart
end

-- The quiet time after a check: nothing shown, so nothing should be built.
local function quiet(seconds)
  local before = TABLES_MADE()
  tick(seconds)
  return (TABLES_MADE() - before) / seconds
end

local CYCLES = 8
local snaps, perSecond, perBurst, perCheck, idle = {}, {}, {}, {}, {}
snaps[0] = snapshot()
for n = 1, CYCLES do
  perSecond[n], perBurst[n], perCheck[n] = cycle(n)
  idle[n] = quiet(30)
  snaps[n] = snapshot()
end
for _, n in ipairs({ 0, 1, 2, 3, CYCLES }) do
  local s = snaps[n]
  measureLine(format("after check %d: %d tables, %d entries, %d functions, %d string bytes, %d frames, %d regions; heap %.0f KB",
    n, s.tables, s.entries, s.funcs, s.bytes, s.frames, s.regions, s.heap))
end
measureLine(format("churn: %d tables per ready check (READY_CHECK to the window closing); %.0f a second while the window is open, %.0f per UNIT_AURA burst (20 players), %.1f a second while nothing shows",
  perCheck[CYCLES], perSecond[CYCLES], perBurst[CYCLES], idle[CYCLES]))
-- Where the churn comes from: the tables one call makes.
do
  local function cost(fn) local before = TABLES_MADE() fn() return TABLES_MADE() - before end
  ReadyCheckFrame:Show()
  window:Show(nil, false, true)
  local refresh = cost(function() window:Refresh() end)
  local reply = cost(function() fire("CHAT_MSG_ADDON", "CRTReady", "D:70", "RAID", "Raider3-Realm") end)
  local group = cost(function() CRT.RaidReport:ReadGroup() end)
  window:Hide()
  local display = CRT.ConsumablesDisplay
  display:SetPreview(true)
  local bar = cost(function() display:Refresh() end)
  display:SetPreview(false)
  local run = cost(function() CRT.RaidReport:Run(CRT.RaidReport:Included()) end)
  -- every player's two replies and an answer in the same moment: one refresh soon after, not one each
  ReadyCheckFrame:Show()
  window:Show(nil, false, true)
  local refreshes, real = 0, window.Refresh
  window.Refresh = function(...) refreshes = refreshes + 1 return real(...) end
  tick(1.05) -- past the refresh on show's second
  refreshes = 0
  for i = 2, RAID do
    fire("CHAT_MSG_ADDON", "CRTReady", "D:" .. (10 + i), "RAID", fullName(i))
    fire("CHAT_MSG_ADDON", "CRTReady", "W:" .. (1000 + i) .. ":n", "RAID", fullName(i))
    fire("READY_CHECK_CONFIRM", "raid" .. i, true)
  end
  local during = refreshes
  tick(0.3)
  window.Refresh = real
  check(during == 0 and refreshes == 1, format("%d replies and answers at once make one refresh, soon after: %d during, %d within 0.3 s", 3 * (RAID - 1), during, refreshes))
  local shown
  for _, f in ipairs(frames) do
    local fs = rawget(f, "text")
    if type(fs) == "table" and type(fs.text) == "string" and fs.text:find("13%", 1, true) then shown = fs end
  end
  check(shown ~= nil, "and the window shows the replies after it")
  window:Hide()
  ReadyCheckFrame:Hide()
  measureLine(format("one window refresh %d tables (reading the group %d), one addon reply %d, one bar refresh %d, one raid report %d",
    refresh, group, reply, bar, run))
end

-- Kept: flat from the third check on (the first ones build the frames and the caches; the first pull timer, in check 2,
-- makes the shared fade's driver, reused after).
local a, b = snaps[3], snaps[CYCLES]
check(b.frames == snaps[2].frames and b.regions == snaps[2].regions, format("no frames or regions made after the second check: %d -> %d frames, %d -> %d regions", snaps[2].frames, b.frames, snaps[2].regions, b.regions))
check(b.tables == a.tables, format("reachable tables stay flat over %d checks: %d -> %d", CYCLES - 3, a.tables, b.tables))
check(b.entries == a.entries, format("reachable table entries stay flat: %d -> %d", a.entries, b.entries))
check(b.funcs == a.funcs, format("reachable functions stay flat: %d -> %d", a.funcs, b.funcs))
check(b.bytes == a.bytes, format("reachable string bytes stay flat: %d -> %d", a.bytes, b.bytes))
check(#timers == 0, "no timers left waiting after a check: " .. #timers)

-- Churn budgets: about 15% over what the fixed code makes (before the fix: about 194000 tables a check, 6200 a second
-- open; the window redrew on every reply and answer, each redraw reading every buff of every player).
local OPEN_BUDGET, AURA_BUDGET, CHECK_BUDGET, IDLE_BUDGET = tonumber(SRC.openBudget), tonumber(SRC.auraBudget), tonumber(SRC.checkBudget), 1
check(perCheck[CYCLES] <= CHECK_BUDGET, format("a ready check makes at most %d tables with 20 players: %d", CHECK_BUDGET, perCheck[CYCLES]))
check(perSecond[CYCLES] <= OPEN_BUDGET, format("the open window makes at most %d tables a second with 20 players: %.0f", OPEN_BUDGET, perSecond[CYCLES]))
check(perBurst[CYCLES] <= AURA_BUDGET, format("a UNIT_AURA burst from 20 players makes at most %d tables: %.0f", AURA_BUDGET, perBurst[CYCLES]))
check(idle[CYCLES] <= IDLE_BUDGET, format("nothing is built while nothing shows: %.1f tables a second", idle[CYCLES]))

-- Behaviour: fewer tables, the same answers ---------------------------------------------------------------------
do
  local Report = CRT.RaidReport
  local function filler(id) return { spellId = id, name = "Spell" .. id, expirationTime = clock + 1800, icon = id } end
  local function memberOf(list, i) for _, m in ipairs(list) do if m.unit == "raid" .. i then return m end end end
  -- a 25th aura the game hides, after 24 the filter drops: the player still can't be checked
  auraOverride[7] = function(index)
    if index <= 24 then return filler(50000 + index) end
    if index == 25 then return { spellId = SECRET, name = "Hidden", expirationTime = SECRET, icon = SECRET } end
  end
  -- a read that errors
  auraOverride[8] = function(index) if index == 3 then error("unreadable aura") end return filler(50000 + index) end
  -- buffs found only by their fallback names
  auraOverride[10] = function(index)
    local list = { { 70001, "Flask of X" }, { 70002, "Hearty Well Fed" }, { 70003, "Vantus Rune: Y" } }
    local a = list[index]
    if a then return { spellId = a[1], name = a[2], expirationTime = clock + 1800, icon = a[1] } end
    if index <= 30 then return filler(50000 + index) end
  end
  -- Arcane Intellect under another spell ID, with the same spell name
  auraOverride[11] = function(index)
    if index == 1 then return { spellId = 99999, name = "Spell1459", expirationTime = clock + 1800, icon = 1 } end
    if index <= 30 then return filler(50000 + index) end
  end
  local group = Report:ReadGroup()
  local m7, m8, m10, m11 = memberOf(group, 7), memberOf(group, 8), memberOf(group, 10), memberOf(group, 11)
  check(m7 and m7.auras == nil and m7.why == "hidden by the game", "a secret 25th aura after 24 dropped ones: hidden by the game: " .. tostring(m7 and m7.why))
  check(m8 and m8.auras == nil and m8.why == "unreadable", "an aura read that errors: unreadable: " .. tostring(m8 and m8.why))
  check(m7 and Report.Cell(m7, "flask").state == "unknown", "and their cells say couldn't check")
  for _, key in ipairs({ "flask", "food", "vantus" }) do
    local state = m10 and Report.Cell(m10, key).state
    check(state == "ok", "a buff found only by its fallback name counts: " .. key .. " " .. tostring(state))
  end
  check(m11 and Report.Cell(m11, "intellect").state == "ok", "a raid buff under another spell ID with the same name counts")
  local named = false
  for _, line in ipairs(Report:Run({ "buffs" })) do if line:find("^Spell1459 missing") and line:find("Raider11", 1, true) then named = true end end
  check(not named, "and the raid report doesn't list that player as missing Arcane Intellect")
  wipe(auraOverride)

  -- the shared missing cell stays as it is, and a cell's tooltip follows a redraw
  local W = CRT.ReadyCheckWindow
  local parent = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
  W.Dress(parent)
  local t = W.NewTable(parent, false)
  local cols = { { key = "food", short = "Food", label = "Food" }, { key = "flask", short = "Flask", label = "Flask" } }
  local a, b = { name = "Aaa", order = 1, cells = {} }, { name = "Bbb", order = 2, cells = {} }
  local shared
  for n = 1, 4 do
    t:Draw((n % 2 == 1) and { a, b } or { b, a }, cols)
    shared = shared or t.rows[1].cells[1].tipCell
  end
  local keys = 0
  for _ in pairs(shared or {}) do keys = keys + 1 end
  check(shared and shared.state == "missing" and keys == 1, 'the shared missing cell is still { state = "missing" } after several draws')
  check(t.rows[2].cells[2].tipCell == shared, "every missing cell is that one table")
  local cell = t.rows[1].cells[2]
  cell.scripts.OnEnter(cell)
  check(GameTooltip.text == "Bbb: Flask", "after a redraw, a cell's tooltip names its player and check: " .. tostring(GameTooltip.text))

  -- the Ready lock: you a mage, raid5 without Arcane Intellect
  buffed = false
  refreshAuras()
  local yes = ReadyCheckFrameYesButton
  yes.enabled = true
  ReadyCheckFrame:Show()
  -- #1297: half the raid has a realm on its name; the window draws every name without it
  local drawn, realSetText = {}, methods.SetText
  methods.SetText = function(self, s) if type(s) == "string" then drawn[#drawn + 1] = s end return realSetText(self, s) end
  fire("READY_CHECK", "Raider2-OtherRealm", 35)
  tick(0.3)
  methods.SetText = realSetText
  local all = table.concat(drawn, "|")
  check(all:find("Raider2", 1, true) ~= nil and not all:find("OtherRealm", 1, true), "the ready check window draws names without realms")
  check(yes.enabled == false, "Ready is greyed out while raid5 lacks your Arcane Intellect")
  buffed = true
  refreshAuras()
  fire("UNIT_AURA", "raid5")
  tick(0.5)
  check(yes.enabled == true, "and works again once they have it")
  fire("READY_CHECK_FINISHED")
  ReadyCheckFrame:Hide()
  tick(35)

  -- the bags: a new rank, then a fleeting one, is what a click uses
  local C = CRT.Consumables
  local function nextId() local item = C:NextItem("flask") return item and item.id end
  C:RefreshBags(true)
  check(nextId() == 2002, "a flask click uses the listed flask in your bags: " .. tostring(nextId()))
  bagExtra[1] = { 3102, "Item2002" }
  fire("BAG_UPDATE_DELAYED")
  C:RefreshBags()
  check(nextId() == 3102, "after the bags change, a higher rank of it is used: " .. tostring(nextId()))
  bagExtra[2] = { 3002, "Fleeting Item2002" }
  fire("BAG_UPDATE_DELAYED")
  C:RefreshBags()
  check(nextId() == 3002, "a fleeting one comes first: " .. tostring(nextId()))
  wipe(bagExtra)
  fire("BAG_UPDATE_DELAYED")
  C:RefreshBags()
  check(nextId() == 2002, "and once they are gone, the listed flask again: " .. tostring(nextId()))
end

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " ready check memory checks failed") end
`;

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
let skipped = 0;
lua.lua_pushcfunction(L, (L) => { lua.lua_pushnumber(L, tablesMade - skipped); return 1; });
lua.lua_setglobal(L, to_luastring('TABLES_MADE'));
lua.lua_pushcfunction(L, (L) => { skipped += lua.lua_tonumber(L, 1); return 0; });
lua.lua_setglobal(L, to_luastring('TABLES_SKIP'));
lua.lua_pushcfunction(L, (L) => { gc(); gc(); lua.lua_pushnumber(L, process.memoryUsage().heapUsed / 1024); return 1; });
lua.lua_setglobal(L, to_luastring('HEAP_KB'));
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_newtable(L);
const SRC = {
  fade: slice('local fades = {}', 'function UI.SetFrameTitle'),
  themed: slice('UI.themed = {}', "-- The game's grey stone"),
  mark: read('CRT_Core/UI/StatusMark.lua') + '\n' + read('CRT_Core/UI/Fonts.lua'), // with Fonts.lua: UI.CapFontSize
  data: read('CRT_Modules/Consumables/Data.lua'), ants: read('CRT_Modules/Consumables/Ants.lua'),
  bar: read('CRT_Modules/Consumables/Bar.lua'), display: read('CRT_Modules/Consumables/Display.lua'),
  report: read('CRT_Modules/ReadyCheck/Report.lua'), window: read('CRT_Modules/ReadyCheck/Window.lua'),
  bufflock: read('CRT_Modules/ReadyCheck/BuffLock.lua'), earlypull: read('CRT_Modules/ReadyCheck/EarlyPull.lua'),
  openBudget: '1800', auraBudget: '700', checkBudget: '60000',
};
for (const [k, v] of Object.entries(SRC)) { lua.lua_pushstring(L, to_luastring(v)); lua.lua_setfield(L, -2, to_luastring(k)); }
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
console.log('ok ready check memory: flat over many ready checks (frames, regions, reachable tables and strings), churn within budget');
