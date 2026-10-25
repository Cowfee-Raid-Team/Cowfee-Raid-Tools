// Module switches (CRT_Core/Modules.lua): the whole addon, every file the .toc lists (the season pack's Season.xml
// and the dev block included), loaded in order in a stand-in game client, once with every module on and once
// with each module off (CRTDB.modules[key] = false), then ADDON_LOADED and PLAYER_LOGIN. Each run checks the
// files load and the events run with no Lua error, the module's pages, menu entries and /crt words are gone or
// say it is off, its event frames are quiet, the others keep working, and the raider-side handlers (Gear Checker
// answers, repair reports, Pace plans, the loot popup's messages) still answer. With all on, everything is there.
// Usage: node run_modules.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const root = process.argv[2];
if (!root) { console.error('usage: node run_modules.js <addon folder>'); process.exit(2); }

// The .toc's files in order, the season pack's Season.xml expanded, the dev block kept (a dev build).
function tocFiles() {
  const out = [];
  for (const raw of fs.readFileSync(path.join(root, 'CowfeeRaidTools.toc'), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const rel = line.replace(/\\/g, '/');
    if (rel.endsWith('.xml')) {
      const dir = path.posix.dirname(rel);
      const xml = fs.readFileSync(path.join(root, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      for (const m of xml.matchAll(/<Script\s+file="([^"]+)"/g)) out.push(dir + '/' + m[1].replace(/\\/g, '/'));
    } else {
      out.push(rel);
    }
  }
  return out;
}

const harness = `
local files, sources, scenario = ...
local unpack = unpack or table.unpack
local errors = {}
local function report(where, err) errors[#errors + 1] = where .. ": " .. tostring(err) end

-- The stand-in client ---------------------------------------------------------------------------------------
-- Anything not stubbed below is a "thing": callable, indexable by name, and 0 in arithmetic, so a file that
-- reads a game table it never really uses here still loads. Numbered keys are nil, so ipairs over one ends.
local thing
local thingMeta = {
  __index = function(_, k) if type(k) == "string" then return thing end return nil end,
  __newindex = function() end,
  __call = function() return thing end,
  __add = function() return 0 end, __sub = function() return 0 end, __mul = function() return 0 end,
  __div = function() return 0 end, __mod = function() return 0 end, __unm = function() return 0 end,
  __pow = function() return 0 end, __idiv = function() return 0 end,
  __concat = function(a, b) return (a == thing and "" or tostring(a)) .. (b == thing and "" or tostring(b)) end,
  __lt = function() return false end, __le = function() return false end, __len = function() return 0 end,
  __tostring = function() return "" end,
}
thing = setmetatable({}, thingMeta)

local env
local loadingFile = "?"
local frames = {} -- every frame made, in order: { frame, file }
local sent = {}   -- C_ChatInfo.SendAddonMessage calls: { prefix, text, channel, target }
local timers = {} -- C_Timer callbacks waiting: run by runTimers()
local printed = {}

local NUMERIC = { Width = true, Height = true, Scale = true, EffectiveScale = true, Alpha = true, FrameLevel = true,
  Left = true, Right = true, Top = true, Bottom = true, StringWidth = true, StringHeight = true, NumLines = true,
  Value = true, ID = true, VerticalScroll = true, HorizontalScroll = true, VerticalScrollRange = true,
  HorizontalScrollRange = true, Cursor = true, NumPoints = true, LineHeight = true, TextHeight = true, Spacing = true }
local function mock(kind, name, parent)
  local f = { kind = kind or "Frame", name = name, parent = parent, events = {}, scripts = {}, shown = true, regions = {}, children = {} }
  local m = {}
  function m:RegisterEvent(e) self.events[e] = true return true end
  function m:RegisterUnitEvent(e) self.events[e] = true return true end
  function m:UnregisterEvent(e) self.events[e] = nil end
  function m:UnregisterAllEvents() self.events = {} end
  function m:IsEventRegistered(e) return self.events[e] == true end
  function m:SetScript(k, fn) self.scripts[k] = fn end
  function m:GetScript(k) return self.scripts[k] end
  function m:HookScript(k, fn) local old = self.scripts[k] self.scripts[k] = function(...) if old then old(...) end return fn(...) end end
  function m:HasScript() return true end
  function m:Show() self.shown = true end
  function m:Hide() self.shown = false end
  function m:SetShown(v) self.shown = v and true or false end
  function m:IsShown() return self.shown end
  function m:IsVisible() return self.shown end
  function m:GetName() return self.name end
  function m:GetParent() return self.parent end
  function m:GetObjectType() return self.kind end
  function m:IsObjectType(k) return self.kind == k end
  function m:GetPoint() return nil end
  function m:GetSize() return 0, 0 end
  function m:GetCenter() return 0, 0 end
  function m:GetRect() return 0, 0, 0, 0 end
  function m:GetFont() return "Fonts\\\\FRIZQT__.TTF", 12, "" end
  function m:GetTextColor() return 1, 1, 1, 1 end
  function m:GetText() return rawget(self, "text") end
  function m:SetText(t) rawset(self, "text", t) end
  function m:GetChecked() return false end
  function m:GetRegions() return unpack(self.regions) end
  function m:GetChildren() return unpack(self.children) end
  function m:GetNumRegions() return #self.regions end
  function m:GetNumChildren() return #self.children end
  function m:IsMouseOver() return false end
  function m:IsProtected() return false end
  function m:IsForbidden() return false end
  function m:CreateTexture() local t = mock("Texture", nil, self) table.insert(self.regions, t) return t end
  function m:CreateFontString() local t = mock("FontString", nil, self) table.insert(self.regions, t) return t end
  function m:CreateLine() local t = mock("Line", nil, self) table.insert(self.regions, t) return t end
  function m:CreateMaskTexture() return mock("MaskTexture", nil, self) end
  function m:CreateAnimationGroup() return mock("AnimationGroup", nil, self) end
  function m:CreateAnimation() return mock("Animation", nil, self) end
  function m:GetFontObject() return mock("Font") end
  return setmetatable(f, { __index = function(t, k)
    if m[k] then return m[k] end
    if type(k) ~= "string" then return nil end
    local what = k:match("^Get(.+)$")
    if what and NUMERIC[what] then return function() return 0 end end
    if k:match("^Is") or k:match("^Has") or k:match("^Can") then return function() return false end end
    if k:match("^%u") then return function() return nil end end
    return nil
  end })
end

local function newFrame(kind, name, parent, template)
  local f = mock(kind, name, parent, template)
  if parent and type(parent) == "table" and rawget(parent, "children") then table.insert(parent.children, f) end
  frames[#frames + 1] = { frame = f, file = loadingFile }
  if name then env[name] = f end
  -- the templates' parts the addon reaches for
  if template and template:find("ScrollFrameTemplate") then rawset(f, "ScrollBar", mock("Slider", nil, f)) end
  if template and template:find("BasicFrameTemplate") then rawset(f, "CloseButton", mock("Button", nil, f)) rawset(f, "TitleText", mock("FontString", nil, f)) rawset(f, "Inset", mock("Frame", nil, f)) end
  return f
end

local function fontObject()
  local o = { size = 12 }
  function o:CopyFontObject() end
  function o:GetFont() return "Fonts\\\\FRIZQT__.TTF", self.size, "" end
  function o:SetFont(_, s) self.size = s or self.size end
  function o:GetTextColor() return 1, 1, 1 end
  function o:SetTextColor() end
  function o:SetShadowColor() end
  function o:SetShadowOffset() end
  function o:GetShadowColor() return 0, 0, 0, 1 end
  function o:GetShadowOffset() return 0, 0 end
  function o:SetJustifyH() end
  function o:SetJustifyV() end
  function o:SetSpacing() end
  return o
end

local stubs = {}
stubs.CreateFrame = newFrame
stubs.CreateFont = function(name) local o = fontObject() env[name] = o return o end
stubs.CreateColor = function(r, g, b, a) return { r = r, g = g, b = b, a = a, GetRGB = function(c) return c.r, c.g, c.b end, GetRGBA = function(c) return c.r, c.g, c.b, c.a end } end
stubs.UIParent = mock("Frame", "UIParent")
stubs.WorldFrame = mock("Frame", "WorldFrame")
stubs.Minimap = mock("Frame", "Minimap")
stubs.GameTooltip = mock("GameTooltip", "GameTooltip")
stubs.ItemRefTooltip = mock("GameTooltip", "ItemRefTooltip")
stubs.UISpecialFrames = {}
stubs.SlashCmdList = {}
stubs.StaticPopupDialogs = {}
stubs.RAID_CLASS_COLORS = setmetatable({}, { __index = function() return { r = 1, g = 1, b = 1, colorStr = "ffffffff" } end })
stubs.issecretvalue = function() return false end
stubs.InCombatLockdown = function() return false end
stubs.IsEncounterInProgress = function() return false end
stubs.IsInGroup = function() return false end
stubs.IsInRaid = function() return false end
stubs.IsInInstance = function() return false, "none" end
stubs.GetInstanceInfo = function() return "Somewhere", "none", 0, "", 0, 0, false, 0 end
stubs.UnitIsGroupLeader = function() return false end
stubs.UnitIsGroupAssistant = function() return false end
stubs.UnitName = function(u) if u == "player" then return "Me", nil end return nil end
stubs.UnitFullName = function(u) if u == "player" then return "Me", "Realm" end return nil end
stubs.GetRealmName = function() return "Realm" end
stubs.GetNormalizedRealmName = function() return "Realm" end
stubs.UnitClass = function() return "Warrior", "WARRIOR", 1 end
stubs.UnitGUID = function() return "Player-1-0001" end
stubs.UnitExists = function(u) return u == "player" end
stubs.UnitLevel = function() return 80 end
stubs.UnitGroupRolesAssigned = function() return "NONE" end
stubs.GetNumGroupMembers = function() return 0 end
stubs.GetNumSubgroupMembers = function() return 0 end
stubs.GetSpecialization = function() return nil end
stubs.GetTime = function() return 1000 end
stubs.GetServerTime = function() return 1800000000 end
stubs.GetLocale = function() return "enUS" end
stubs.GetBuildInfo = function() return "12.0.5", "1", "Oct 1 2026", 120005 end
stubs.GetCVar = function() return nil end
stubs.GetCVarBool = function() return false end
stubs.time = function(t) return os.time(t) end
stubs.date = os.date
stubs.debugprofilestop = function() return 0 end
stubs.strtrim = function(s) return ((s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end
stubs.strsplit = function(sep, s, n) local out = {} for part in (s .. sep):gmatch("(.-)" .. sep:gsub("%p", "%%%0")) do out[#out + 1] = part end return unpack(out) end
stubs.strjoin = function(sep, ...) return table.concat({ ... }, sep) end
stubs.strlower, stubs.strupper, stubs.strlen, stubs.strsub, stubs.strfind = string.lower, string.upper, string.len, string.sub, string.find
stubs.strmatch, stubs.strrep, stubs.strbyte, stubs.strchar, stubs.gsub, stubs.format = string.match, string.rep, string.byte, string.char, string.gsub, string.format
stubs.tinsert, stubs.tremove, stubs.tconcat, stubs.sort = table.insert, table.remove, table.concat, table.sort
stubs.wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
stubs.tContains = function(t, v) for _, x in ipairs(t) do if x == v then return true end end return false end
stubs.CopyTable = function(t) local o = {} for k, v in pairs(t) do o[k] = v end return o end
stubs.floor, stubs.ceil, stubs.abs, stubs.max, stubs.min, stubs.sqrt = math.floor, math.ceil, math.abs, math.max, math.min, math.sqrt
stubs.mod = math.fmod
stubs.Ambiguate = function(name) return (name or ""):gsub("%-.*$", "") end
stubs.hooksecurefunc = function(t, name, fn)
  if type(t) == "string" then name, fn, t = t, name, env end
  local old = rawget(t, name)
  if type(old) == "function" then rawset(t, name, function(...) local r = { old(...) } fn(...) return unpack(r) end) end
end
stubs.geterrorhandler = function() return function(err) report("error handler", err) end end
stubs.seterrorhandler = function() end
stubs.securecallfunction = function(fn, ...) return fn(...) end
stubs.print = function(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end printed[#printed + 1] = table.concat(t, " ") end
stubs.C_Timer = {
  After = function(_, fn) timers[#timers + 1] = fn end,
  NewTimer = function(_, fn) local t = { Cancel = function() end, IsCancelled = function() return false end } timers[#timers + 1] = fn return t end,
  NewTicker = function() return { Cancel = function() end, IsCancelled = function() return false end } end,
}
local prefixes = {}
stubs.C_ChatInfo = {
  RegisterAddonMessagePrefix = function(p) prefixes[p] = true return true end,
  IsAddonMessagePrefixRegistered = function(p) return prefixes[p] == true end,
  SendAddonMessage = function(prefix, text, channel, target) sent[#sent + 1] = { prefix = prefix, text = text, channel = channel, target = target } return 0 end,
  InChatMessagingLockdown = function() return false end,
}
stubs.C_AddOns = {
  GetAddOnMetadata = function(_, field) if field == "Version" then return "1.1.3" end return nil end,
  IsAddOnLoaded = function() return false end,
  GetAddOnEnableState = function() return 0 end,
}
stubs.C_EncodingUtil = nil
stubs.LibStub = nil
stubs.Enum = setmetatable({}, { __index = function() return setmetatable({}, { __index = function() return 0 end }) end })
stubs.CRTDBChar = nil

env = setmetatable({}, { __index = function(_, k)
  local v = stubs[k]
  if v ~= nil then return v end
  v = _G[k]
  if v ~= nil then return v end
  -- the game's fonts and frames by name, constants, C_ namespaces: a thing
  return thing
end })
env._G = env
-- the stubs that must read as missing (nil), so the addon takes its no-game path
for _, k in ipairs({ "C_EncodingUtil", "LibStub", "CRTDB", "CRTDBChar", "CRTLootDB", "BigWigsLoader", "DBM", "NSAPI", "VMRT", "RCLootCouncil", "WeakAuras", "C_EncounterTimeline", "C_DamageMeter" }) do
  rawset(stubs, k, nil)
end
local missing = { C_EncodingUtil = true, LibStub = true, CRTDB = true, CRTDBChar = true, CRTLootDB = true, BigWigsLoader = true, DBM = true, NSAPI = true, VMRT = true, RCLootCouncil = true, WeakAuras = true, C_EncounterTimeline = true, C_DamageMeter = true }
getmetatable(env).__index = function(_, k)
  if missing[k] then return nil end
  local v = stubs[k]
  if v ~= nil then return v end
  v = _G[k]
  if v ~= nil then return v end
  return thing
end

-- Load the addon -------------------------------------------------------------------------------------------
local CRT = {}
for i, file in ipairs(files) do
  loadingFile = file
  local fn, err = load(sources[i], "@" .. file, "t", env)
  if not fn then
    report(file, err)
  else
    local ok, e = pcall(fn, "CowfeeRaidTools", CRT)
    if not ok then report(file .. " (load)", e) end
  end
end
loadingFile = "(events)"

-- The saved data this run starts with: the module switch under test
env.CRTDB = { modules = {} }
for key, on in pairs(scenario.modules or {}) do env.CRTDB.modules[key] = on end

local function fire(event, ...)
  for _, rec in ipairs(frames) do
    local f = rec.frame
    local fn = f.scripts.OnEvent
    if f.events[event] and fn then
      local ok, e = pcall(fn, f, event, ...)
      if not ok then report(rec.file .. " " .. event, e) end
    end
  end
end
local function runTimers()
  for _ = 1, 5 do
    local list = timers
    timers = {}
    for _, fn in ipairs(list) do
      local ok, e = pcall(fn)
      if not ok then report("timer", e) end
    end
    if #timers == 0 then break end
  end
end
fire("ADDON_LOADED", "CowfeeRaidTools")
fire("PLAYER_LOGIN")
fire("PLAYER_ENTERING_WORLD", true, false)
runTimers()

-- Checks ---------------------------------------------------------------------------------------------------
local fails, passes = 0, 0
local name = scenario.name
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. name .. ": " .. what) end end

for _, e in ipairs(errors) do check(false, "a Lua error: " .. e) end

local M = CRT.Modules
check(type(M) == "table" and type(M.IsOn) == "function", "CRT.Modules is loaded")
if type(M) ~= "table" then print(passes .. " passed, " .. fails .. " failed") MODULES_FAILS = fails return end
check(M.started == true, "the registry started on ADDON_LOADED")
check(type(CRT.db) == "table" and type(CRT.db.modules) == "table", "CRTDB.modules is there")

-- the modules and what each owns
local want = { loot = "Loot", timeline = "Timeline", raidlead = "Raid Lead" }
for key, label in pairs(want) do
  local def = M:Get(key)
  check(def and def.label == label, key .. " is registered as " .. label)
end
check(M:IsOn("core") == true, "Core is always on")

local function hasFile(list, file) for _, f in ipairs(list or {}) do if f == file then return true end end return false end
local tocSet = {}
for _, f in ipairs(files) do tocSet[f] = true end
local owner = {}
for _, def in ipairs(M:List()) do
  for _, part in ipairs({ "files", "raider", "core" }) do
    for _, f in ipairs(def[part] or {}) do
      check(tocSet[f], def.key .. "." .. part .. " lists " .. f .. ", which the .toc loads")
      check(owner[f] == nil, f .. " is listed once, got " .. tostring(owner[f]) .. " and " .. def.key .. "." .. part)
      owner[f] = def.key .. "." .. part
    end
  end
end

-- each module's on state is the saved switch
for key in pairs(want) do
  local on = not (scenario.modules and scenario.modules[key] == false)
  check(M:IsOn(key) == on, key .. (on and " is on" or " is off"))
end

local UI = CRT.UI
-- the main window isn't drawn here (run_menu.js tests it): UI:Show only says which page it was asked for
local shownPages = {}
UI.Show = function(_, key) shownPages[#shownPages + 1] = key or "?" end
local function slash(msg)
  local before = #printed
  local ok, e = pcall(env.SlashCmdList.COWFEERAIDTOOLS, msg)
  if not ok then report("/crt " .. msg, e) check(false, "/crt " .. msg .. " runs: " .. tostring(e)) end
  return table.concat(printed, "\\n", before + 1)
end

for _, def in ipairs(M:List()) do
  local on = M:IsOn(def.key)
  -- pages and menu entries
  for _, page in ipairs(def.pages or {}) do
    check((UI.pages[page] ~= nil) == on, def.key .. ": page " .. page .. (on and " is there" or " is gone"))
    local inOrder = false
    for _, k in ipairs(UI.order) do if k == page then inOrder = true end end
    check(inOrder == on, def.key .. ": page " .. page .. (on and " is in" or " is out of") .. " the page order")
    local inMenu = false
    for _, g in ipairs(UI.MenuGroups()) do for _, k in ipairs(g.keys) do if k == page then inMenu = true end end end
    check(inMenu == on, def.key .. ": page " .. page .. (on and " is in" or " is out of") .. " the menu")
  end
  -- /crt words
  for _, word in ipairs(def.words or {}) do
    local pagesBefore = #shownPages
    local out = slash(word)
    local offLine = out:find(def.label .. " is turned off. Turn it on in Modules.", 1, true) ~= nil
    check(offLine == not on, "/crt " .. word .. (on and " runs" or " says " .. def.label .. " is turned off") .. ": " .. out)
    check(not out:find("Unknown command", 1, true), "/crt " .. word .. " is a known command")
    check((#shownPages > pagesBefore) == on, "/crt " .. word .. (on and " opens its page" or " opens nothing"))
  end
  -- /crt help lists a module's words only while it is on
  local help = slash("help")
  for _, word in ipairs(def.words or {}) do
    check((help:find("/crt " .. word .. "|r", 1, true) ~= nil) == on, "/crt help " .. (on and "lists" or "leaves out") .. " /crt " .. word)
  end
  -- event frames: a turned-off module's files have none that listen; its raider and core files keep theirs
  for _, rec in ipairs(frames) do
    if hasFile(def.files, rec.file) and not on then
      check(next(rec.frame.events) == nil and rec.frame.scripts.OnEvent == nil and rec.frame.scripts.OnUpdate == nil, def.key .. " off: the frame made in " .. rec.file .. " is quiet")
    end
  end
end

-- the module files' event frames all listen when their module is on, and so do the raider and core ones always
local listening = {}
for _, rec in ipairs(frames) do
  if next(rec.frame.events) ~= nil and rec.frame.scripts.OnEvent ~= nil then listening[rec.file] = true end
end
for _, file in ipairs(scenario.listen or {}) do
  check(listening[file], file .. " still listens to its events")
end

-- Core's pages and words never depend on a switch
for _, page in ipairs({ "settings", "qol", "notes", "readycheck" }) do
  check(UI.pages[page] ~= nil, "Core's page " .. page .. " is there")
end
for _, msg in ipairs({ "notes", "reminders", "qol", "settings", "readycheck" }) do
  local before = #shownPages
  local out = slash(msg)
  check(not out:find("turned off", 1, true) and not out:find("Unknown command", 1, true), "/crt " .. msg .. " is Core's: " .. out)
end
check(slash("nonsense"):find("Unknown command", 1, true) ~= nil, "an unknown word is still unknown")
check(slash("late nonsense"):find(M:IsOn("raidlead") and "Unknown command" or "Raid Lead is turned off", 1, true) ~= nil, "an unknown word of a module: unknown when on, off when off")

-- Loot off: the leader's CRT Looting can't be turned on, and says why; Raider Score still follows the Late Tracker
do
  local LM = CRT.LootMaster
  env.UnitIsGroupLeader = function() return true end
  stubs.UnitIsGroupLeader = env.UnitIsGroupLeader
  local ok, why = LM:CanRunLooting()
  if M:IsOn("loot") then
    check(why ~= "Loot is turned off", "Loot on: CRT Looting isn't refused for Loot")
    local hooked = false
    for _, fn in ipairs(CRT.Late.listeners or {}) do if fn == LM.ScoreChanged then hooked = true end end
    check(hooked, "Loot on: Raider Score follows the Late Tracker's changes, whatever loaded first")
  else
    check(ok == false and why == "Loot is turned off", "Loot off: CRT Looting can't be led: " .. tostring(why))
  end
  stubs.UnitIsGroupLeader = function() return false end
  env.UnitIsGroupLeader = stubs.UnitIsGroupLeader
end

-- Raid Lead off: Season Stats counts no pull (its Timeline hook is never made)
do
  local S, T = CRT.SeasonStats, CRT.Timeline
  local counted = 0
  local real = S.Record
  S.Record = function() counted = counted + 1 end
  check(type(T.saveListeners) == "table", "the Timeline's save hooks are there (Timeline/Data.lua, Core)")
  for _, fn in ipairs(T.saveListeners or {}) do pcall(fn, { encounterID = 1 }) end
  S.Record = real
  check((counted > 0) == M:IsOn("raidlead"), "Season Stats " .. (M:IsOn("raidlead") and "counts" or "doesn't count") .. " a saved pull")
end

-- /crt dev modules (Dev/Modules.lua): sets a switch for after a /reload; this session keeps running as it was
do
  local was = M:IsOn("loot")
  local out = slash("dev modules loot " .. (was and "off" or "on"))
  check(CRT.db.modules.loot == not was, "/crt dev modules saves the switch: " .. out)
  check(M:IsOn("loot") == was, "the session keeps running as it started")
  check(out:find("after a /reload", 1, true) ~= nil, "it says the change waits for a /reload: " .. out)
  local list = slash("dev modules")
  check(list:find("Loot (loot)", 1, true) and list:find("Timeline (timeline)", 1, true) and list:find("Raid Lead (raidlead)", 1, true), "/crt dev modules lists them: " .. list)
  check(slash("dev modules nope off"):find("No module 'nope'", 1, true) ~= nil, "an unknown module is named")
  slash("dev modules loot " .. (was and "on" or "off"))
  check(CRT.db.modules.loot == was, "and back")
  check(M:Set("core", false) == false and M:IsOn("core"), "Core can't be turned off")
end

-- raider-side answers
local function addonMessage(prefix, text, sender)
  local before = #sent
  fire("CHAT_MSG_ADDON", prefix, text, "RAID", sender or "Leader-Realm")
  runTimers()
  return before
end
-- Gear Checker: an ask (Q) from the leader is answered with your gear (G parts), in a group
env.IsInGroup = function() return true end
env.IsInRaid = function() return true end
stubs.IsInGroup, stubs.IsInRaid = env.IsInGroup, env.IsInRaid
do
  local before = addonMessage("CRTGearCheck", "Q|1|ask1")
  local answered = false
  for i = before + 1, #sent do if sent[i].prefix == "CRTGearCheck" and sent[i].text:find("^G|") then answered = true end end
  check(answered, "a Gear Checker ask is answered with your gear")
end
check(prefixes.CRTGearCheck and prefixes.CRTRepair and prefixes.CRTPace1 and prefixes.CRTLootRemaster, "the raider-side prefixes are registered: CRTGearCheck, CRTRepair, CRTPace1, CRTLootRemaster")
-- Loot Master: the looter's session reaches the raider's CRT (LM.incoming)
do
  local LM = CRT.LootMaster
  check(LM and type(LM.Handle) == "function", "Loot Master's message handler is there")
end

print(passes .. " passed, " .. fails .. " failed")
MODULES_FAILS = fails
`;

// CRT_Dev/Dev/Build.lua is made by the build script and not in Git, so a checkout may not have it
const files = tocFiles().filter(f => fs.existsSync(path.join(root, f)) || f !== 'CRT_Dev/Dev/Build.lua');
const sources = files.map(f => fs.readFileSync(path.join(root, f), 'utf8'));

// The files whose event frames must keep listening whatever the switches say (raider side and Core).
const ALWAYS = ['CRT_Modules/GearChecker/Comm.lua', 'CRT_Modules/SeasonStats/Repairs.lua', 'CRT_Modules/Pace/Comm.lua',
  'CRT_Modules/Pace/Display.lua', 'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/Rolls.lua',
  'CRT_Modules/LootMaster/Looting.lua', 'CRT_Modules/LootMaster/Resync.lua', 'CRT_Modules/Requests/Data.lua',
  'CRT_Modules/Notes/Comm.lua', 'CRT_Modules/Alerts/Engine.lua'];
const scenarios = [
  { name: 'all on', modules: {}, listen: ALWAYS.concat(['CRT_Modules/Loot/Capture.lua', 'CRT_Modules/Late/Data.lua',
    'CRT_Modules/Tattlebot/Data.lua', 'CRT_Modules/Timeline/RehearsalWindow.lua', 'CRT_Modules/GearChecker/Inspect.lua']) },
  { name: 'loot off', modules: { loot: false }, listen: ALWAYS.concat(['CRT_Modules/Late/Data.lua', 'CRT_Modules/Timeline/RehearsalWindow.lua']) },
  { name: 'timeline off', modules: { timeline: false }, listen: ALWAYS.concat(['CRT_Modules/Loot/Capture.lua', 'CRT_Modules/Late/Data.lua']) },
  { name: 'raidlead off', modules: { raidlead: false }, listen: ALWAYS.concat(['CRT_Modules/Loot/Capture.lua', 'CRT_Modules/Timeline/RehearsalWindow.lua']) },
  { name: 'all off', modules: { loot: false, timeline: false, raidlead: false }, listen: ALWAYS },
];

let failed = 0;
for (const sc of scenarios) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
  // files and sources as Lua tables, the scenario as a table
  for (const list of [files, sources]) {
    lua.lua_createtable(L, list.length, 0);
    list.forEach((s, i) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_rawseti(L, -2, i + 1); });
  }
  lua.lua_createtable(L, 0, 3);
  lua.lua_pushstring(L, to_luastring(sc.name)); lua.lua_setfield(L, -2, to_luastring('name'));
  lua.lua_createtable(L, 0, 3);
  for (const [k, v] of Object.entries(sc.modules)) { lua.lua_pushboolean(L, v); lua.lua_setfield(L, -2, to_luastring(k)); }
  lua.lua_setfield(L, -2, to_luastring('modules'));
  lua.lua_createtable(L, sc.listen.length, 0);
  sc.listen.forEach((s, i) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_rawseti(L, -2, i + 1); });
  lua.lua_setfield(L, -2, to_luastring('listen'));
  if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR (' + sc.name + '):', lua.lua_tojsstring(L, -1)); process.exit(1); }
  lua.lua_getglobal(L, to_luastring('MODULES_FAILS'));
  const n = lua.lua_tonumber(L, -1);
  if (n > 0) failed++; else console.log('ok modules: ' + sc.name);
}
process.exit(failed > 0 ? 1 : 0);
