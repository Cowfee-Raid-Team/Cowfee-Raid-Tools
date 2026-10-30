// The whole addon, every file the .toc lists (the season pack's Season.xml and the dev block included; also as a
// release build, without it), loaded in order in a stand-in game client, then ADDON_LOADED and PLAYER_LOGIN.
// Checks the files load and the events run with no Lua error, every event frame registers at file load, every
// page is registered and in the menu, every /crt word runs and is in /crt help, and the raider side answers
// (Gear Checker asks, a leader's loot session, repair reports, Pace plans).
// Usage: node run_addon.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const root = process.argv[2];
if (!root) { console.error('usage: node run_addon.js <addon folder>'); process.exit(2); }

// The .toc's files in order, the season pack's Season.xml expanded, the dev block kept (a dev build) or, for a
// release build, left out as the packager does.
function tocFiles(release) {
  const out = [];
  let inDev = false;
  for (const raw of fs.readFileSync(path.join(root, 'CowfeeRaidTools.toc'), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '#@do-not-package@') inDev = true;
    if (line === '#@end-do-not-package@') inDev = false;
    if (release && inDev) continue;
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
  function m:GetChecked() return rawget(self, "checked") == true end
  function m:SetChecked(v) rawset(self, "checked", v and true or false) end
  function m:SetEnabled(v) rawset(self, "enabled", v and true or false) end
  function m:Enable() rawset(self, "enabled", true) end
  function m:Disable() rawset(self, "enabled", false) end
  function m:IsEnabled() return rawget(self, "enabled") ~= false end
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
  if template and template:find("UIPanelButtonTemplate") then for _, k in ipairs({ "Left", "Middle", "Right" }) do rawset(f, k, mock("Texture", nil, f)) end end
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

-- What each file's frames listen to right after it loaded, before any event: every event frame registers
local registered = {}
for _, rec in ipairs(frames) do
  if next(rec.frame.events) ~= nil and rec.frame.scripts.OnEvent ~= nil then registered[rec.file] = true end
end

-- The saved data this run starts with
env.CRTDB = {}

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
check(type(CRT.db) == "table", "the saved data is in on ADDON_LOADED")

-- every event frame registers its events at file load
for _, file in ipairs(scenario.listen or {}) do
  check(registered[file], file .. " has an event frame that listens")
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

-- every page is registered, in the page order and in the menu
local PAGES = { "settings", "qol", "timeline", "notes", "pace", "readycheck", "groups", "gearcheck", "late",
  "lootmaster", "loot", "requests", "seasonstats", "tattle" }
local inMenu = {}
for _, g in ipairs(UI.MenuGroups()) do for _, k in ipairs(g.keys) do inMenu[k] = true end end
for _, page in ipairs(PAGES) do
  check(UI.pages[page] ~= nil, "page " .. page .. " is there")
  local inOrder = false
  for _, k in ipairs(UI.order) do if k == page then inOrder = true end end
  check(inOrder, "page " .. page .. " is in the page order")
  check(inMenu[page], "page " .. page .. " is in the menu")
end
check(UI.pages.modules == nil and not inMenu.modules, "no Modules page")
local row = false
for _, g in ipairs(UI.LAYER_GROUPS) do if g.key == "timeline" then row = true end end
check(row, "the Timeline window's layer row is there")

-- every module word: registered, runs for everyone, opens its page, and is in /crt help
local WORDS = { groups = "groups", gear = "gearcheck", late = "late", pace = "pace", tattle = "tattle", timeline = "timeline" }
local help = slash("help")
for word, page in pairs(WORDS) do
  check(CRT.Slash.words[word] ~= nil, "/crt " .. word .. " is registered")
  local before = #shownPages
  local out = slash(word)
  check(not out:find("Unknown command", 1, true) and not out:find("turned off", 1, true), "/crt " .. word .. " runs: " .. out)
  check(shownPages[before + 1] == page, "/crt " .. word .. " opens " .. page .. ", got " .. tostring(shownPages[before + 1]))
  check(help:find("/crt " .. word .. "|r", 1, true) ~= nil, "/crt help lists /crt " .. word)
end
-- /crt interrupts: the optional module is off on a fresh install, so the word says so and opens General Settings;
-- switched on, its page is in the menu after Pace and the word opens it
do
  check(CRT.Slash.words.interrupts ~= nil, "/crt interrupts is registered")
  check(help:find("/crt interrupts|r", 1, true) ~= nil, "/crt help lists /crt interrupts")
  check(UI.pages.interrupts ~= nil and UI.pages.interrupts.hidden, "the Interrupts page is there, hidden while the module is off")
  local before = #shownPages
  local out = slash("interrupts")
  check(shownPages[before + 1] == "settings" and out:find("Enable Interrupts", 1, true) ~= nil, "/crt interrupts while off opens General Settings: " .. out)
  CRT.Interrupts:SetEnabled(true)
  local after, pace = nil, nil
  for _, g in ipairs(UI.MenuGroups()) do for i, k in ipairs(g.keys) do if k == "interrupts" then after = g.keys[i - 1] end end end
  check(after == "pace", "the Interrupts page is in the menu after Pace, got " .. tostring(after))
  before = #shownPages
  slash("interrupts")
  check(shownPages[before + 1] == "interrupts", "/crt interrupts opens the page once it is on")
  CRT.Interrupts:SetEnabled(false)
end
local count = 0
for _ in pairs(CRT.Slash.words) do count = count + 1 end
check(count == 8, "eight registered words (the six above, loot and interrupts), got " .. count)
check(not help:find("turned off", 1, true), "/crt help names nothing turned off")
for _, def in pairs(CRT.Slash.words) do
  check(def.module == nil and def.raider == nil and def.raiderHelp == nil, "a registered word has only run, help and top")
end

-- Core's pages and words
for _, msg in ipairs({ "notes", "reminders", "qol", "settings", "readycheck" }) do
  local out = slash(msg)
  check(not out:find("Unknown command", 1, true), "/crt " .. msg .. " is Core's: " .. out)
end
check(slash("nonsense"):find("Unknown command", 1, true) ~= nil, "an unknown word is still unknown")
check(slash("late nonsense"):find("Unknown command", 1, true) ~= nil, "an unknown word after a module word is unknown")
check(slash("modules"):find("Unknown command", 1, true) ~= nil, "/crt modules is unknown")
check(slash("dev modules"):find("Unknown command", 1, true) ~= nil, "/crt dev modules is unknown")
-- the kick probe's word, in a dev build only
local kicks = slash("dev kicks")
if scenario.release then
  check(kicks:find("Unknown command", 1, true) ~= nil, "/crt dev kicks is not in a release build")
else
  check(kicks:find("Kick probe is", 1, true) ~= nil, "/crt dev kicks answers: " .. kicks)
end
-- the ability labels window's word, in a dev build only: it opens the window (Dev/AbilityLabels.lua)
local labels = slash("dev labels")
if scenario.release then
  check(labels:find("Unknown command", 1, true) ~= nil and CRT.AbilityLabelsDev == nil, "/crt dev labels is not in a release build")
else
  check(not labels:find("Unknown command", 1, true) and CRT.AbilityLabelsDev.window ~= nil and CRT.AbilityLabelsDev.window:IsShown(), "/crt dev labels opens its window: " .. labels)
  slash("dev labels")
end

-- /crt loot alone: your loot popup and All Loot Rolls. Loot History has no word (it opens from the menu); the
-- leader's words come after /crt loot.
do
  local LM = CRT.LootMaster
  local calls = { popup = 0, answers = 0 }
  local realPopup, realAnswers, was = LM.ShowPopup, LM.ShowAnswers, LM.incoming
  LM.ShowPopup = function() calls.popup = calls.popup + 1 end
  LM.ShowAnswers = function() calls.answers = calls.answers + 1 end
  LM.incoming = { id = "t1", items = {}, mine = {}, view = {} }
  local before = #shownPages
  local out = slash("loot")
  check(calls.popup == 1 and calls.answers == 1, "/crt loot opens your loot popup and All Loot Rolls")
  check(not out:find("Unknown command", 1, true), "/crt loot runs: " .. out)
  check(#shownPages == before, "/crt loot opens no page (Loot History has no word)")
  LM.incoming = nil
  out = slash("loot")
  check(calls.answers == 2 and calls.popup == 1, "/crt loot with no session opens All Loot Rolls (the last session, or none yet), no answer popup")
  LM.ShowPopup, LM.ShowAnswers, LM.incoming = realPopup, realAnswers, was
  before = #shownPages
  out = slash("loot settings")
  check(shownPages[before + 1] == "lootmaster" and not out:find("turned off", 1, true), "/crt loot settings opens Loot Master: " .. out)
  out = slash("loot test")
  check(not out:find("turned off", 1, true) and not out:find("Unknown command", 1, true), "/crt loot test runs: " .. out)
  check(help:find("/crt loot|r - open your loot popup and All Loot Rolls", 1, true) ~= nil, "/crt help lists /crt loot")
  check(help:find("/crt loot test|r", 1, true) ~= nil, "/crt help lists /crt loot test")
  check(not help:find("Loot History", 1, true), "/crt help names no Loot History word")
  if LM.current then LM:End() end
end

-- the leader may lead CRT Looting; Raider Score follows the Late Tracker, whatever loaded first
do
  local LM = CRT.LootMaster
  env.UnitIsGroupLeader = function() return true end
  stubs.UnitIsGroupLeader = env.UnitIsGroupLeader
  local _, why = LM:CanRunLooting()
  check(why == nil or not tostring(why):find("turned off", 1, true), "CRT Looting is never refused for a switch: " .. tostring(why))
  local hooked = false
  for _, fn in ipairs(CRT.Late.listeners or {}) do if fn == LM.ScoreChanged then hooked = true end end
  check(hooked, "Raider Score follows the Late Tracker's changes")
  stubs.UnitIsGroupLeader = function() return false end
  env.UnitIsGroupLeader = stubs.UnitIsGroupLeader
end

-- Season Stats counts every saved pull
do
  local S, T = CRT.SeasonStats, CRT.Timeline
  local counted = 0
  local real = S.Record
  S.Record = function() counted = counted + 1 end
  check(type(T.saveListeners) == "table", "the Timeline's save hooks are there (Timeline/Data.lua)")
  for _, fn in ipairs(T.saveListeners or {}) do pcall(fn, { encounterID = 1 }) end
  S.Record = real
  check(counted > 0, "Season Stats counts a saved pull")
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
-- /crt help: Raid Groups right under /crt, the other module words after Core's notes lines
do
  local lines = {}
  for line in (slash("help") .. "\\n"):gmatch("(.-)\\n") do lines[#lines + 1] = line end
  local at = {}
  for i, l in ipairs(lines) do
    for _, w in ipairs({ "groups", "readycheck", "note test", "late", "timeline" }) do
      if not at[w] and l:find("/crt " .. w .. "|r", 1, true) then at[w] = i end
    end
  end
  check(at.groups and at.readycheck and at.groups < at.readycheck, "/crt help lists /crt groups near the top")
  check(at.late and at["note test"] and at.late > at["note test"], "the other module words come after Core's notes lines")
end
local errorsBefore = #errors
-- The rest is driven through the frame of the one file that owns it, so no other handler sees the stand-in raid.
local function fireIn(file, event, ...)
  local n = 0
  for _, rec in ipairs(frames) do
    local f = rec.frame
    if rec.file == file and f.events[event] and f.scripts.OnEvent then
      n = n + 1
      local ok, e = pcall(f.scripts.OnEvent, f, event, ...)
      if not ok then check(false, file .. " " .. event .. ": " .. tostring(e)) end
    end
  end
  runTimers()
  return n
end
local function sentWith(before, prefix, pattern)
  for i = before + 1, #sent do
    if sent[i].prefix == prefix and (not pattern or sent[i].text:find(pattern)) then return sent[i] end
  end
  return nil
end
-- what follows sets stand-ins in stubs: a raw value the checks above left in env would hide them
for _, k in ipairs({ "IsInGroup", "IsInRaid", "UnitIsGroupLeader", "UnitName", "GetNumGroupMembers" }) do
  local v = rawget(env, k)
  if v ~= nil then stubs[k] = v rawset(env, k, nil) end
end
-- your own raid group, not a finder group
stubs.LE_PARTY_CATEGORY_HOME, stubs.LE_PARTY_CATEGORY_INSTANCE = 1, 2
stubs.IsInGroup = function(category) return category ~= 2 end
-- a raid of two: you (raid1) and Leader-Realm (raid2), who leads
stubs.GetNumGroupMembers = function() return 2 end
stubs.GetRaidRosterInfo = function(i) if i == 1 then return "Me" elseif i == 2 then return "Leader-Realm" end end
stubs.UnitName = function(u)
  if u == "player" or u == "raid1" then return "Me", nil end
  if u == "raid2" then return "Leader", "Realm" end
  return nil
end
stubs.UnitIsGroupLeader = function(u) return u == "raid2" or u == "Leader" or u == "Leader-Realm" end

-- Loot Master: a leader's session (S) reaches your CRT (LM.incoming) and your CRT says hello (K)
do
  local LM = CRT.LootMaster
  local before = #sent
  local text = LM.Wire.Encode("S", { "sess1", 0, 1, LM.VERSION, 60, 2, 0 })
  local n = fireIn("CRT_Modules/LootMaster/Comm.lua", "CHAT_MSG_ADDON", LM.PREFIX, text, "RAID", "Leader-Realm")
  check(n > 0, "Loot Master's message frame still listens")
  check(LM.incoming and LM.incoming.id == "sess1" and LM.incoming.leader == "Leader-Realm", "a leader's loot session reaches your CRT (LM.incoming)")
  check(sentWith(before, LM.PREFIX, "^K|") ~= nil, "your CRT answers a loot session with its hello (K)")
end

-- Repairs: one pull in a raid instance, and your bill goes to the raid under CRTRepair
do
  local cost, cur = 1000, 90
  stubs.GetInstanceInfo = function() return "Raid", "raid", 16, "Mythic", 20, 0, false, 2900 end
  stubs.IsInInstance = function() return true, "raid" end
  stubs.GetInventoryItemDurability = function(slot) if slot == 1 then return cur, 100 end return nil end
  stubs.GetInventoryItemID = function(_, slot) if slot == 1 then return 12345 end return nil end
  stubs.C_TooltipInfo = { GetInventoryItem = function() return { repairCost = cost } end }
  local file = "CRT_Modules/SeasonStats/Repairs.lua"
  check(fireIn(file, "PLAYER_ENTERING_WORLD", false, false) > 0, "the repair reports still listen")
  local before = #sent
  fireIn(file, "ENCOUNTER_START", 3129, "Boss", 16, 20)
  cost, cur = 8000, 60
  fireIn(file, "ENCOUNTER_END", 3129, "Boss", 16, 20, 0)
  local msg = sentWith(before, "CRTRepair")
  check(msg ~= nil and msg.text:find("|7000$") ~= nil, "a pull's repair bill goes to the raid (CRTRepair): " .. tostring(msg and msg.text))
  stubs.IsInInstance = function() return false, "none" end
  stubs.GetInstanceInfo = function() return "Somewhere", "none", 0, "", 0, 0, false, 0 end
end

-- Pace: the leader's plan (CRTPace1) is taken as the raid's plan, and its bars run on the pull
do
  local Pace = CRT.Pace
  local id = 3129
  local plan = "mode phase;1 30 boss1 72"
  local h, a = 5381, 1
  for i = 1, #plan do local b = plan:byte(i) h = (h * 33 + b) % 16777216 a = (a * 7 + b) % 65521 end
  local hash = string.format("%06x%04x%x", h, a, #plan)
  local n = fireIn("CRT_Modules/Pace/Comm.lua", "CHAT_MSG_ADDON", "CRTPace1", id .. "|" .. hash .. "|1|1|" .. plan, "RAID", "Leader-Realm")
  check(n > 0, "the Pace plans still listen")
  local got = Pace:Plan(id)
  check(got and got.from == "Leader" and got.rows and got.rows[1] and got.rows[1].hp == 72, "the leader's pace plan is the plan in use")
  fireIn("CRT_Modules/Pace/Display.lua", "ENCOUNTER_START", id, "Boss", 16, 20)
  -- the bars' window is made on first use (Pace/Display.lua's build), during the event
  local running = false
  for _, rec in ipairs(frames) do if rec.file == "(events)" and rec.frame.scripts.OnUpdate and rec.frame.shown then running = true end end
  check(running, "the Pace bars run on the pull")
  fireIn("CRT_Modules/Pace/Display.lua", "ENCOUNTER_END", id)
end
for i = errorsBefore + 1, #errors do check(false, "a Lua error while driving the raider side: " .. errors[i]) end

print(passes .. " passed, " .. fails .. " failed")
ADDON_FAILS = fails
`;

// CRT_Dev/Dev/Build.lua is made by the build script and not in Git, so a checkout may not have it
// A release build: the .toc's dev block left out, and every Lua do-not-package block cut, as the packager does
function build(release) {
  const files = tocFiles(release).filter(f => fs.existsSync(path.join(root, f)) || f !== 'CRT_Dev/Dev/Build.lua');
  const sources = files.map(f => {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    return release ? text.replace(/--@do-not-package@[\s\S]*?--@end-do-not-package@/g, '') : text;
  });
  return { files, sources };
}
const builds = { dev: build(false), release: build(true) };

// The files that make an event frame at load: each must have one that listens, in every build.
const LISTEN = [
  'CRT_Modules/GearChecker/Comm.lua', 'CRT_Modules/GearChecker/Inspect.lua', 'CRT_Modules/GearChecker/Page.lua',
  'CRT_Modules/SeasonStats/Repairs.lua', 'CRT_Modules/Pace/Comm.lua', 'CRT_Modules/Pace/Display.lua',
  'CRT_Modules/LootMaster/Comm.lua', 'CRT_Modules/LootMaster/Rolls.lua', 'CRT_Modules/LootMaster/Looting.lua',
  'CRT_Modules/LootMaster/Resync.lua', 'CRT_Modules/LootMaster/BossLoot.lua', 'CRT_Modules/LootMaster/Trade.lua',
  'CRT_Modules/Requests/Data.lua', 'CRT_Modules/Requests/Page.lua',
  'CRT_Modules/Loot/Store.lua', 'CRT_Modules/Loot/Capture.lua', 'CRT_Modules/Loot/RCLC.lua',
  'CRT_Modules/Groups/Apply.lua', 'CRT_Modules/Groups/Invite.lua', 'CRT_Modules/Late/Data.lua',
  'CRT_Modules/Tattlebot/Data.lua', 'CRT_Modules/Timeline/RehearsalWindow.lua', 'CRT_Modules/Timeline/JournalExport.lua',
  'CRT_Modules/Notes/Comm.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Interrupts/Data.lua',
  'CRT_Modules/Interrupts/Anchor.lua', 'CRT_Modules/Interrupts/Comm.lua'];
const scenarios = [
  { name: 'dev build', listen: LISTEN },
  { name: 'release build', release: true, listen: LISTEN },
];

let failed = 0;
for (const sc of scenarios) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
  // files and sources as Lua tables, the scenario as a table
  const { files, sources } = builds[sc.release ? 'release' : 'dev'];
  for (const list of [files, sources]) {
    lua.lua_createtable(L, list.length, 0);
    list.forEach((s, i) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_rawseti(L, -2, i + 1); });
  }
  lua.lua_createtable(L, 0, 3);
  lua.lua_pushstring(L, to_luastring(sc.name)); lua.lua_setfield(L, -2, to_luastring('name'));
  lua.lua_createtable(L, sc.listen.length, 0);
  sc.listen.forEach((s, i) => { lua.lua_pushstring(L, to_luastring(s)); lua.lua_rawseti(L, -2, i + 1); });
  lua.lua_setfield(L, -2, to_luastring('listen'));
  lua.lua_pushboolean(L, sc.release === true); lua.lua_setfield(L, -2, to_luastring('release'));
  if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR (' + sc.name + '):', lua.lua_tojsstring(L, -1)); process.exit(1); }
  lua.lua_getglobal(L, to_luastring('ADDON_FAILS'));
  const n = lua.lua_tonumber(L, -1);
  if (n > 0) failed++; else console.log('ok addon: ' + sc.name);
}
process.exit(failed > 0 ? 1 : 0);
