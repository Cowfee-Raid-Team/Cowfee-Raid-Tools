// CRT_Modules/QoL/CombatLog.lua and CombatLogTab.lua: automatic combat logging. ShouldLog decides per instance kind,
// difficulty and key; on a zone change (debounced, never polled) it starts the log in ticked content, and on leaving it
// stops only a log CRT started; a rate-limited call (nil) is tried once more and never loops; ticking the master box and
// logging in with it on turn the game's Advanced Combat Logging on, never in combat; chat lines follow Say in chat. The
// Quality of Life tab sits between Battle res and Sounds, greys its ticks while the master is off, and its buttons make
// one call each.
// Usage: node run_combatlog.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
const harness = `
local logSrc, tabSrc, pageSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end

-- frames: any method is a no-op, a few remember what they were given
local function mock()
  local m = { pts = {}, events = {}, scripts = {} }
  return setmetatable(m, { __index = function(t, k)
    if type(k) == "string" and k:match("^%l") then return nil end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock() end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 7 end end
    if k == "GetFontString" then return function(self) return self end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return rawget(self, "checked") end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return rawget(self, "enabled") ~= false end end
    if k == "SetFontObject" then return function(self, f) rawset(self, "font", f) end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "RegisterEvent" then return function(self, e) self.events[e] = true end end
    if k == "UnregisterEvent" then return function(self, e) self.events[e] = nil end end
    if k == "IsShown" then return function() return true end end
    return function() end
  end })
end
local frames = {}
CreateFrame = function(kind, name, parent, template)
  local f = mock()
  rawset(f, "kind", kind)
  rawset(f, "template", template)
  frames[#frames + 1] = f
  return f
end
CRTFontSmall, CRTFontDisableSmall, CRTFontNormal = "small", "disabled", "normal"

-- the game: an instance, a key, combat, the CVar and LoggingCombat with its rate limit
local itype, diff, key, combat = "none", 0, false, false
GetInstanceInfo = function() return "Somewhere", itype, diff end
C_ChallengeMode = { IsChallengeModeActive = function() return key end }
InCombatLockdown = function() return combat end
local cvars = { advancedCombatLogging = false }
local cvarSets = {}
C_CVar = {
  GetCVarBool = function(name) return cvars[name] end,
  SetCVar = function(name, value) cvarSets[#cvarSets + 1] = { name, value } if combat then return nil end cvars[name] = value == "1" return true end,
}
local logging = false
local calls = {} -- every LoggingCombat call: "query", true or false
local busy = 0 -- the next this many calls are rate limited (nil, no change)
local refuse = false
LoggingCombat = function(...)
  local n = select("#", ...)
  local arg = ...
  calls[#calls + 1] = n == 0 and "query" or arg
  if refuse then error("LoggingCombat is not allowed") end
  if busy > 0 then busy = busy - 1 return nil end
  if n > 0 then logging = arg and true or false end
  return logging
end
local timers = {}
C_Timer = { After = function(sec, fn) timers[#timers + 1] = { sec = sec, fn = fn } end }
local function runTimers() local due = timers timers = {} for _, t in ipairs(due) do t.fn() end return #due end
local function settle() for _ = 1, 5 do if runTimers() == 0 then return end end end

local defaults = { enabled = false, raid = { lfr = true, normal = true, heroic = true, mythic = true }, dungeon = { keys = true, mythic = false, normal = false }, stopOnLeave = true, announce = true }
local function copy(t) local o = {} for k, v in pairs(t) do o[k] = type(v) == "table" and copy(v) or v end return o end
local CRT = { db = { qol = { combatLog = copy(defaults), lowHealth = {}, breakTimer = {}, battleRes = {} }, sound = {} } }
local printed = {}
function CRT:Print(t) printed[#printed + 1] = t end
local function lastPrint() return printed[#printed] end
CRT.UI = {}
assert(load(logSrc, "@CombatLog.lua"))("CowfeeRaidTools", CRT)
local C = CRT.CombatLog
check(C ~= nil, "CRT.CombatLog exists")
local events
for _, f in ipairs(frames) do if f.events.ZONE_CHANGED_NEW_AREA then events = f end end
check(events ~= nil, "it listens to ZONE_CHANGED_NEW_AREA")
for _, e in ipairs({ "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "CHALLENGE_MODE_START" }) do
  check(events and events.events[e], "it listens to " .. e)
end
check(events and not events.events.PLAYER_REGEN_ENABLED, "no combat event until it waits for combat to end")
local function fire(e, ...) events.scripts.OnEvent(events, e, ...) end
local s = CRT.db.qol.combatLog

-- ShouldLog: the pure decision -------------------------------------------------------------------------------------
local on = copy(defaults) on.enabled = true
local SL = C.ShouldLog
local want, label = SL("raid", 17, false, on) check(want and label == "Raid Finder raid", "Raid Finder (17) logs: " .. tostring(label))
want, label = SL("raid", 14, false, on) check(want and label == "Normal raid", "Normal raid (14) logs")
want, label = SL("raid", 15, false, on) check(want and label == "Heroic raid", "Heroic raid (15) logs")
want, label = SL("raid", 16, false, on) check(want and label == "Mythic raid", "Mythic raid (16) logs")
want, label = SL("party", 8, false, on) check(want and label == "Mythic+ key", "a keystone dungeon (8) logs as Mythic+ keys")
want, label = SL("party", 23, true, on) check(want and label == "Mythic+ key", "Mythic (23) with a key running counts as Mythic+ keys")
check(not SL("party", 23, false, on), "Mythic (no key) is off by default")
check(not SL("party", 2, false, on) and not SL("party", 1, false, on), "Heroic and Normal dungeons are off by default")
local every = copy(on) every.dungeon.mythic, every.dungeon.normal = true, true
want, label = SL("party", 23, false, every) check(want and label == "Mythic dungeon", "Mythic (no key) ticked logs")
want, label = SL("party", 2, false, every) check(want and label == "Heroic dungeon", "Heroic dungeon (2) under Heroic and Normal")
want, label = SL("party", 1, false, every) check(want and label == "Normal dungeon", "Normal dungeon (1) under Heroic and Normal")
for _, other in ipairs({ { "raid", 33, "raid timewalking" }, { "party", 24, "dungeon timewalking" }, { "party", 205, "a follower dungeon" }, { "scenario", 208, "a delve" }, { "none", 0, "the open world" }, { "pvp", 0, "a battleground" }, { "party", 150, "difficulty 150" } }) do
  check(not SL(other[1], other[2], false, every), other[3] .. " never logs")
end
check(not SL("raid", 33, true, every), "a key flag outside a dungeon changes nothing")
local noHeroic = copy(on) noHeroic.raid.heroic = false
check(not SL("raid", 15, false, noHeroic) and SL("raid", 16, false, noHeroic), "an unticked raid difficulty doesn't log, the others still do")
local noKeys = copy(on) noKeys.dungeon.keys = false
check(not SL("party", 8, false, noKeys) and not SL("party", 23, true, noKeys), "Mythic+ keys unticked: no key logs")
check(not SL("raid", 16, false, defaults), "the master tick off: nothing logs")
check(defaults.enabled == false, "(the master defaults off)")
local okS, errS = pcall(SL, "raid", nil, false, on)
check(okS and not errS, "no difficulty: no log, no error")

-- Off: no call at all on zone changes --------------------------------------------------------------------------------
fire("PLAYER_LOGIN")
itype, diff = "raid", 15
fire("PLAYER_ENTERING_WORLD")
settle()
check(#calls == 0, "master off: a zone change into a raid makes no LoggingCombat call: " .. #calls)
check(#cvarSets == 0, "master off: Advanced Combat Logging untouched")

-- Ticking the master: Advanced Combat Logging on, one chat line; then the zone is decided ---------------------------
itype, diff = "none", 0
printed = {}
C:SetEnabled(true)
check(s.enabled == true, "SetEnabled saves the tick")
check(cvars.advancedCombatLogging == true and cvarSets[1] and cvarSets[1][1] == "advancedCombatLogging" and cvarSets[1][2] == "1", "ticking turns Advanced Combat Logging on")
check(#printed == 1 and printed[1]:find("Advanced Combat Logging", 1, true), "and says so in chat once: " .. tostring(printed[1]))
settle()
check(#calls == 0, "ticking in the open world: no LoggingCombat call: " .. #calls)
printed = {}
C:SetEnabled(true)
check(#printed == 0 and #cvarSets == 1, "already on: nothing set, nothing said")
settle()
check(C:AdvancedOn() == true, "AdvancedOn reads the CVar")

-- Entering a ticked raid: one query, one start, the chat line, the Now reason --------------------------------------
calls, printed = {}, {}
itype, diff = "raid", 15
fire("PLAYER_ENTERING_WORLD")
fire("ZONE_CHANGED_NEW_AREA")
check(#calls == 0, "nothing is called at the event itself (debounced)")
check(#timers == 1 and timers[1].sec > 0, "two zone events: one delayed decision: " .. #timers)
settle()
local function callList() local t = {} for i, c in ipairs(calls) do t[i] = tostring(c) end return table.concat(t, ",") end
check(callList() == "query,true", "entering a Heroic raid: one query, then start: " .. callList())
check(logging == true, "the log is on")
check(lastPrint() == "Combat log on: Heroic raid.", "the chat line: " .. tostring(lastPrint()))
check(C:Status().logging == true and C:Status().ours == true, "CRT knows it started it")
check(C:NowText():find("started by CRT in Heroic raid", 1, true), "the Now line: " .. C:NowText())

-- Another zone change inside: already on, nothing started again
calls = {}
fire("ZONE_CHANGED_NEW_AREA")
settle()
check(#calls == 1 and calls[1] == "query", "a zone change inside: one query, no second start")

-- Leaving: CRT stops the log it started, one call
calls, printed = {}, {}
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()
check(#calls == 1 and calls[1] == false, "leaving: one call, the stop: " .. #calls)
check(logging == false and lastPrint() == "Combat log off: you left the instance.", "the log is off and chat says so: " .. tostring(lastPrint()))
check(not C:Status().ours, "no longer CRT's")

-- Out in the world again: no calls
calls = {}
fire("ZONE_CHANGED_NEW_AREA")
settle()
check(#calls == 0, "the open world, nothing of CRT's running: no call")

-- A log the player started: never stopped
logging = true
calls, printed = {}, {}
itype, diff = "raid", 16
fire("PLAYER_ENTERING_WORLD")
settle()
check(#calls == 1 and calls[1] == "query", "the player's log already on: a query, no start")
check(#printed == 0, "nothing said")
check(not C:Status().ours, "not CRT's")
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()
check(logging == true and #calls == 1, "leaving: the player's log is left on, no stop call")

-- Stop when I leave off: CRT's log stays on
logging = false
s.stopOnLeave = false
itype, diff = "raid", 14
fire("PLAYER_ENTERING_WORLD")
settle()
check(logging == true and C:Status().ours, "(set up) CRT started it")
calls = {}
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()
check(logging == true and #calls == 0, "Stop when I leave off: still on, no call")
s.stopOnLeave = true
-- then it is stopped on the next leave with it on again (still CRT's this session)
itype, diff = "raid", 14
fire("PLAYER_ENTERING_WORLD")
settle()
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()
check(logging == false, "Stop when I leave on again: CRT's log stops on the next leave")

-- An unticked difficulty: no start
calls = {}
itype, diff = "party", 23
fire("PLAYER_ENTERING_WORLD")
settle()
check(logging == false, "Mythic (no key) unticked: not started")
-- the key starts: logging starts (Mythic+ keys)
key = true
fire("CHALLENGE_MODE_START", 2648)
settle()
check(logging == true and lastPrint() == "Combat log on: Mythic+ key.", "a key starting starts the log: " .. tostring(lastPrint()))
key = false
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()
check(logging == false, "leaving the key: stopped")

-- Rate limited: nil is tried once more, a little later, and never loops ---------------------------------------------
calls = {}
busy = 1
itype, diff = "raid", 15
fire("PLAYER_ENTERING_WORLD")
runTimers()
check(#calls == 1 and #timers == 1 and timers[1].sec >= 5, "a busy query: one retry is scheduled, some seconds later")
runTimers()
check(logging == true and C:Status().ours, "the retry starts the log")
check(#timers == 0, "no further timer")
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()
calls = {}
busy = 99
itype, diff = "raid", 15
fire("PLAYER_ENTERING_WORLD")
settle()
check(#calls == 2 and #timers == 0, "busy twice: exactly two calls, then it stops trying: " .. #calls)
check(C:Status().logging == nil and C:NowText():find("busy", 1, true), "the Now line says the game was busy: " .. C:NowText())
busy = 0
-- the start busy: also once more
calls = {}
busy = 0
local realLC = LoggingCombat
local startBusy = 1
LoggingCombat = function(...)
  if select("#", ...) > 0 and startBusy > 0 then startBusy = startBusy - 1 calls[#calls + 1] = "busy start" return nil end
  return realLC(...)
end
fire("ZONE_CHANGED_NEW_AREA")
settle()
check(logging == true and #timers == 0, "a busy start: tried once more, then on")
LoggingCombat = realLC
-- the stop busy on leave: once more, then off
calls = {}
busy = 0
itype, diff = "none", 0
local stopBusy = 1
LoggingCombat = function(...)
  if select("#", ...) > 0 and stopBusy > 0 then stopBusy = stopBusy - 1 calls[#calls + 1] = "busy stop" return nil end
  return realLC(...)
end
fire("PLAYER_ENTERING_WORLD")
settle()
check(logging == false and #calls == 2, "a busy stop: tried once more, then off: " .. #calls)
LoggingCombat = realLC

-- A refused call (Midnight): said once in chat, shown, no error
refuse = true
printed = {}
itype, diff = "raid", 15
fire("PLAYER_ENTERING_WORLD")
local okR, errR = pcall(settle)
check(okR, "a refused call raises no error: " .. tostring(errR))
fire("ZONE_CHANGED_NEW_AREA")
settle()
local said = 0
for _, p in ipairs(printed) do if p:find("/combatlog", 1, true) then said = said + 1 end end
check(said == 1, "the refusal is said once: " .. said)
check(C:Status().refused, "and kept for the Setup line")
refuse = false
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()

-- No LoggingCombat at all: no error
local keepLC = LoggingCombat
LoggingCombat = nil
itype, diff = "raid", 15
local okN, errN = pcall(function() fire("PLAYER_ENTERING_WORLD") settle() end)
check(okN, "no LoggingCombat: no error: " .. tostring(errN))
LoggingCombat = keepLC
itype, diff = "none", 0

-- Say in chat off: no announce lines
logging = false
s.announce = false
printed = {}
itype, diff = "raid", 15
fire("PLAYER_ENTERING_WORLD")
settle()
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()
check(#printed == 0, "Say in chat off: logging starts and stops without a line: " .. tostring(printed[1]))
s.announce = true

-- Manual buttons: one call each; a log started by hand is never stopped on leave ---------------------------------
calls = {}
local okM, msgM = C:StartNow()
check(okM and logging == true and #calls == 1 and calls[1] == true, "Start logging now: one call, on")
check(type(msgM) == "string" and msgM ~= "", "it says what happened")
check(not C:Status().ours, "a log started by hand is the player's")
itype, diff = "raid", 15
fire("PLAYER_ENTERING_WORLD")
settle()
itype, diff = "none", 0
fire("PLAYER_ENTERING_WORLD")
settle()
check(logging == true, "the hand-started log is left on after a raid")
calls = {}
local okStop = C:StopNow()
check(okStop and logging == false and #calls == 1 and calls[1] == false, "Stop logging: one call, off")
busy = 1
calls = {}
local okB, msgB = C:StartNow()
check(not okB and #calls == 1 and type(msgB) == "string" and msgB:find("busy", 1, true), "a busy Start: one call, says busy, no retry: " .. tostring(msgB))
check(#timers == 0, "no timer for a manual call")
busy = 0

-- Advanced Combat Logging at login, and never in combat ------------------------------------------------------------
cvars.advancedCombatLogging = false
cvarSets, printed = {}, {}
fire("PLAYER_LOGIN")
check(cvars.advancedCombatLogging == true and #printed == 1, "login with the master on: Advanced Combat Logging on, one line")
cvars.advancedCombatLogging = false
cvarSets, printed = {}, {}
combat = true
fire("PLAYER_LOGIN")
check(#cvarSets == 0 and cvars.advancedCombatLogging == false, "in combat: not set")
check(events.events.PLAYER_REGEN_ENABLED, "it waits for combat to end")
combat = false
fire("PLAYER_REGEN_ENABLED")
check(cvars.advancedCombatLogging == true, "combat ends: set then")
check(not events.events.PLAYER_REGEN_ENABLED, "and stops waiting")
s.enabled = false
cvars.advancedCombatLogging = false
cvarSets = {}
fire("PLAYER_LOGIN")
check(#cvarSets == 0, "login with the master off: the CVar is left alone")
-- the CVar can't be set: says so, no error
s.enabled = true
C_CVar.SetCVar = function() error("secure") end
printed = {}
local okC, errC = pcall(function() C:TurnOnAdvanced() end)
check(okC and cvars.advancedCombatLogging == false and printed[1] and printed[1]:find("Options", 1, true), "a refused CVar: no error, says where to turn it on: " .. tostring(printed[1]) .. tostring(errC))
C_CVar.SetCVar = function(name, value) cvars[name] = value == "1" return true end
local keepCV = C_CVar
C_CVar = nil
GetCVarBool = function(name) return cvars[name] end
SetCVar = function(name, value) cvars[name] = value == "1" end
C:TurnOnAdvanced()
check(cvars.advancedCombatLogging == true, "without C_CVar: the global GetCVarBool and SetCVar")
C_CVar = keepCV

-- The tab: Quality of Life > Combat log ---------------------------------------------------------------------------
local helps, tabs, build, buttons, controls = {}, {}, nil, {}, {}
CRT.UI = {
  RegisterPage = function(_, k, title, fn) build = fn end,
  Dropdown = function() local r = mock() r.refresh = function() end return r end,
  Slider = function() local r = mock() r.refresh = function() end return r end,
  HelpRight = function(target, title, text) helps[#helps + 1] = { target = target, title = title, text = text } return mock() end,
  PreviewButton = function() return mock() end,
  PanelButton = function(parent, label, h, onClick) local b = CreateFrame("Button") b:SetText(label) b:SetWidth(#label * 7 + 28) rawset(b, "onClick", onClick) buttons[label] = b return b end,
  PanelButtonWidth = function(w) return math.ceil(w) + 28 end,
  RegisterTab = function(_, b) tabs[#tabs + 1] = b end, SetTabSelected = function() end,
  GoodText = function(t) return "<good>" .. t end, BadText = function(t) return "<bad>" .. t end,
}
CRT.LowHealth = {}
CRT.LowHealthSound = { StopPreview = function() end }
CRT.DebuffsPage = { Build = function() end }
CRT.BreakFormats = { FORMATS = {} }
CRT.Sound = { VoiceChoices = function() return {} end, VoiceKey = function() return "tts" end, CustomFiles = function() return {} end }
assert(load(tabSrc, "@CombatLogTab.lua"))("CowfeeRaidTools", CRT)
check(CRT.CombatLogTab and CRT.CombatLogTab.Build, "CRT.CombatLogTab.Build exists")
assert(load(pageSrc, "@Page.lua"))("CowfeeRaidTools", CRT)
local pf = mock()
build(pf)
local labels = {}
for _, b in ipairs(tabs) do labels[#labels + 1] = tostring(rawget(b.text, "text")) end
check(table.concat(labels, ",") == "Low health,Debuffs,Break timer,Battle res,Combat log,Sounds", "the tabs: " .. table.concat(labels, ","))

-- the check boxes on the tab, by label
local checks = {}
for _, f in ipairs(frames) do
  if f.kind == "CheckButton" and rawget(f, "label") then checks[rawget(f.label, "text")] = f end
end
local master = checks["Log combat automatically"]
check(master ~= nil, "a Log combat automatically box")
local deps = { "Raid Finder", "Normal", "Heroic", "Mythic", "Mythic+ keys", "Mythic (no key)", "Heroic and Normal", "Stop when I leave" }
for _, l in ipairs(deps) do check(checks[l] ~= nil, "a " .. l .. " box") end
check(checks["Say in chat when logging starts or stops"] ~= nil, "a Say in chat box")
local function refreshAll() pf.scripts.OnShow() end
s.enabled = false
refreshAll()
local grey = true
for _, l in ipairs(deps) do local c = checks[l] if not c or c:IsEnabled() or rawget(c.label, "font") ~= "disabled" then grey = false end end
check(grey, "master off: every dependent box is greyed")
check(master:IsEnabled(), "the master box itself stays clickable")
-- ticking the master through the box
cvars.advancedCombatLogging = false
printed = {}
master:SetChecked(true)
master.scripts.OnClick(master)
check(s.enabled == true and cvars.advancedCombatLogging == true, "ticking the box turns the setting and Advanced Combat Logging on")
local live = true
for _, l in ipairs(deps) do local c = checks[l] if not c or not c:IsEnabled() then live = false end end
check(live, "master on: the dependent boxes are live")
-- a raid tick saves its key
local heroicBox = checks["Heroic"]
heroicBox:SetChecked(false)
heroicBox.scripts.OnClick(heroicBox)
check(s.raid.heroic == false, "unticking Heroic saves raid.heroic")
heroicBox:SetChecked(true) heroicBox.scripts.OnClick(heroicBox)
local hn = checks["Heroic and Normal"]
hn:SetChecked(true) hn.scripts.OnClick(hn)
check(s.dungeon.normal == true, "Heroic and Normal saves dungeon.normal")
hn:SetChecked(false) hn.scripts.OnClick(hn)

-- the Setup buttons
local aclBtn = buttons["Turn on advanced logging"]
check(aclBtn ~= nil, "a Turn on advanced logging button")
refreshAll()
check(aclBtn and not aclBtn:IsEnabled(), "with it on, the button is greyed")
cvars.advancedCombatLogging = false
refreshAll()
check(aclBtn and aclBtn:IsEnabled(), "with it off, the button is live (the CVar read on show)")
aclBtn.onClick(aclBtn)
check(cvars.advancedCombatLogging == true, "the button turns it on")
local toggle = buttons["Start logging now"]
check(toggle ~= nil, "a Start logging now button")
logging = false
calls = {}
toggle.onClick(toggle)
check(#calls == 1 and logging == true, "Start logging now: one call")
check(rawget(toggle, "text") == "Stop logging", "then it reads Stop logging: " .. tostring(rawget(toggle, "text")))
toggle.onClick(toggle)
check(#calls == 2 and logging == false and rawget(toggle, "text") == "Start logging now", "Stop logging: one call, back to Start")
local wantW = #"Start logging now" * 7 + 28
check(rawget(toggle, "w") == wantW, "the button is sized from its label: " .. tostring(rawget(toggle, "w")))
-- every (?) on the tab
local titles = {}
for _, h in ipairs(helps) do titles[h.title] = true end
check(titles["Log combat automatically"] and titles["Setup"] and titles["Stop when I leave"], "a (?) on the master, Setup and Stop when I leave")
print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " combat log checks failed") end
`;
const read = (f) => { const p = path.join(root, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
let srcFails = 0;
const fail = (m) => { console.log('FAIL ' + m); srcFails++; };
const logSrc = read('CRT_Modules/QoL/CombatLog.lua'), tabSrc = read('CRT_Modules/QoL/CombatLogTab.lua'), pageSrc = read('CRT_Modules/QoL/Page.lua');
if (!logSrc) fail('CRT_Modules/QoL/CombatLog.lua is missing');
if (!tabSrc) fail('CRT_Modules/QoL/CombatLogTab.lua is missing');
for (const [f, s] of [['CombatLog.lua', logSrc], ['CombatLogTab.lua', tabSrc]]) {
  if (!/^local TEXT = \{/m.test(s)) fail(f + ' has no TEXT table');
  if (/BigWigs|DBM|Northern Sky|NSRT|\bMRT\b|WeakAuras|Details!/i.test(s)) fail(f + ' names another addon');
  // never polled: no OnUpdate and no repeating ticker
  if (/OnUpdate|NewTicker/.test(s)) fail(f + ' polls (OnUpdate or a ticker)');
}
if (!logSrc.includes('"advancedCombatLogging"')) fail('CombatLog.lua does not name the advancedCombatLogging CVar');
const core = read('CRT_Core/Core.lua');
if (!/combatLog = \{ enabled = false, raid = \{ lfr = true, normal = true, heroic = true, mythic = true \}, dungeon = \{ keys = true, mythic = false, normal = false \}, stopOnLeave = true, announce = true \}/.test(core)) fail('Core.lua lacks the qol.combatLog defaults');
const toc = read('CowfeeRaidTools.toc');
if (!/CRT_Modules\\QoL\\BattleRes\.lua\r?\nCRT_Modules\\QoL\\CombatLog\.lua\r?\nCRT_Modules\\QoL\\CombatLogTab\.lua\r?\nCRT_Modules\\QoL\\Page\.lua/.test(toc)) fail('the .toc lacks CombatLog.lua and CombatLogTab.lua before QoL\\Page.lua');
if (!/\{ key = "brez", label = "Battle res" \},\s*\{ key = "combatlog", label = "Combat log" \},\s*\{ key = "sounds"/.test(pageSrc)) fail('Page.lua: the Combat log tab is not between Battle res and Sounds');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (const s of [logSrc, tabSrc, pageSrc]) lua.lua_pushstring(L, to_luastring(s));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
if (srcFails > 0) process.exit(1);
console.log('ok combat log: logs in ticked content, stops only its own log, respects the rate limit');
