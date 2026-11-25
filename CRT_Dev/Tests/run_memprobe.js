// CRT_Dev/Dev/MemProbe.lua (/crt dev mem [seconds], #1315) on mock frames and a mock heap: it wraps only CRT's own frames' scripts (OnClick, OnShow and the rest too), CRT.UI:Show, and their
// OnUpdate and OnEvent scripts (by name or source location; never another addon's, never a protected frame) and the
// C_Timer callbacks CRT schedules (never another caller's), measures each call's heap growth, prints the top 10 by KB
// with call counts and the total, and puts every script and C_Timer function back when it ends. Not running, it has no
// effect; a script CRT set or hooked meanwhile is never overwritten; it never starts in combat; the command is only
// in the dev block of Slash.lua and the Development page's help.
// Usage: node run_memprobe.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const root = process.argv[2];
const src = fs.readFileSync(path.join(root, 'CRT_Dev/Dev/MemProbe.lua'), 'utf8');
const slash = fs.readFileSync(path.join(root, 'CRT_Core/Slash.lua'), 'utf8');
const toc = fs.readFileSync(path.join(root, 'CowfeeRaidTools.toc'), 'utf8');
const devPage = fs.readFileSync(path.join(root, 'CRT_Dev/Dev/DevPage.lua'), 'utf8');

let failed = 0;
function ok(cond, what) { if (cond) console.log('ok ' + what); else { failed++; console.log('FAIL ' + what); } }

// The command sits in Slash.lua's do-not-package block and the .toc's, and the dev help names it.
const devBlock = (slash.match(/--@do-not-package@([\s\S]*?)--@end-do-not-package@/) || [])[1] || '';
ok(devBlock.includes('CRT.MemProbe:Command(msg)'), 'the command is in the dev block of Slash.lua');
ok(!slash.replace(/--@do-not-package@[\s\S]*?--@end-do-not-package@/g, '').includes('MemProbe'), 'and nowhere outside it');
const tocDev = (toc.match(/#@do-not-package@([\s\S]*?)#@end-do-not-package@/) || [])[1] || '';
ok(tocDev.includes('CRT_Dev\\Dev\\MemProbe.lua'), "MemProbe.lua's .toc line is inside the do-not-package block");
ok(devPage.includes('/crt dev mem [seconds]'), "the Development page's help names /crt dev mem");

const harness = `
local SRC = ...
local fails, passes = 0, 0
local function check(okv, what) if okv then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local heap = 1000
collectgarbage = function(opt) if opt == "count" then return heap end end
local combat = false
function InCombatLockdown() return combat end
local stack = ""
function debugstack() return stack end
local printed = {}
function print(s) printed[#printed + 1] = tostring(s) end
local addonKB = 5000
function UpdateAddOnMemoryUsage() end
function GetAddOnMemoryUsage(name) return name == "CowfeeRaidTools" and addonKB or 0 end

-- frames: name, source, protected, scripts
local frames = {}
local function frame(name, source, protected)
  local f = { name = name, source = source, protected = protected, scripts = {} }
  function f:GetName() return self.name end
  function f:GetSourceLocation() return self.source end
  function f:IsProtected() return self.protected end
  function f:GetScript(k) return self.scripts[k] end
  function f:SetScript(k, fn) self.scripts[k] = fn end
  frames[#frames + 1] = f
  return f
end
function EnumerateFrames(after)
  if not after then return frames[1] end
  for i, f in ipairs(frames) do if f == after then return frames[i + 1] end end
end
-- timers: run by advance(); the game's C_Timer functions, kept to see they come back
local queue = {}
local function after(s, fn) queue[#queue + 1] = { fn = fn, left = s } end
local function newTimer(s, fn) queue[#queue + 1] = { fn = fn, left = s } return {} end
local function newTicker(s, fn) queue[#queue + 1] = { fn = fn, left = s } return {} end
C_Timer = { After = after, NewTimer = newTimer, NewTicker = newTicker }
local function advance(s)
  local list = queue
  queue = {}
  for _, t in ipairs(list) do
    t.left = t.left - s
    if t.left <= 0 then t.fn() else queue[#queue + 1] = t end
  end
end

local CRT_PATH = "Interface/AddOns/CowfeeRaidTools/"
local notesWin = frame(nil, CRT_PATH .. "CRT_Modules/Notes/Window.lua:1437")
local named = frame("CowfeeRaidToolsUndoToast", "UnknownFile")
local other = frame("OtherAddonFrame", "Interface/AddOns/SomeoneElse/Main.lua:10")
local secure = frame(nil, CRT_PATH .. "CRT_Modules/Consumables/Bar.lua:50", true)
local quiet = frame(nil, CRT_PATH .. "CRT_Core/Comm.lua:300")
-- each script makes some garbage: the heap grows by its size
local function grows(kb) return function() heap = heap + kb end end
local nwUpdate, nwEvent = grows(2), grows(5)
notesWin.scripts.OnUpdate, notesWin.scripts.OnEvent = nwUpdate, nwEvent
local namedUpdate = grows(0.5)
named.scripts.OnUpdate = namedUpdate
local otherUpdate = grows(100)
other.scripts.OnUpdate = otherUpdate
local secureEvent = grows(50)
secure.scripts.OnEvent = secureEvent

local CRT = {}
-- the main window's Show (a page built on its first show) and the note windows' rebuild counts
local uiShow = function(_, key) heap = heap + (key == "start" and 300 or 40) end
CRT.UI = { Show = uiShow }
CRT.NoteWindow = { rebuilds = { window = { changed = 2 }, assignments = {}, personal = {} } }
-- a CRT button's OnClick and a page's OnShow
local button = frame(nil, CRT_PATH .. "CRT_Core/UI/StartPage.lua:90")
local clickFn, showFn = grows(1.5), grows(20)
button.scripts.OnClick, button.scripts.OnShow = clickFn, showFn
-- round 3: a menu button's click changes the page, the page is built on its first show, and the dev layout editor
-- runs after each change: each on its own line, so one-time builds tell from what every click repeats
local built = {}
CRT.UI.BuildPage = function(_, page) heap = heap + 200 end
CRT.UI.SelectPage = function(self, key)
  heap = heap + 2
  if not built[key] then built[key] = true self:BuildPage({ key = key }) end
  CRT.Dev:ApplyAll()
end
local uiSelect, uiBuild = CRT.UI.SelectPage, CRT.UI.BuildPage
CRT.Dev = { ApplyAll = function() heap = heap + 4 end }
local devApply = CRT.Dev.ApplyAll
local menu = frame(nil, CRT_PATH .. "CRT_Core/UI/Panel.lua:2370")
menu.scripts.OnClick = function() heap = heap + 1 CRT.UI:SelectPage("notes") end
-- the game's tooltip: hiding it makes 25 KB (the game's and other addons' hooks)
UIParent = {}
GameTooltip = { shown = false }
function GameTooltip:IsShown() return self.shown end
function GameTooltip:SetOwner() end
function GameTooltip:SetText() end
function GameTooltip:Show() self.shown = true end
function GameTooltip:Hide() if self.shown then heap = heap + 25 end self.shown = false end
CRT.UI.TOOLTIP_KEEP = "keep"
CRT.UI.TooltipOwner = function(tip, owner) tip:SetOwner(owner) end
local said = {}
function CRT:Print(s) said[#said + 1] = s end
assert(load(SRC, "@CRT_Dev/Dev/MemProbe.lua"))("CowfeeRaidTools", CRT)
local Probe = CRT.MemProbe
check(Probe and Probe.Command, "CRT.MemProbe:Command")

-- not running: nothing is touched
check(notesWin.scripts.OnUpdate == nwUpdate and C_Timer.After == after, "loaded, it changes no script and no C_Timer function")
check(Probe:Command("dev memory") == false and Probe:Command("dev kicks perf") == false, "other commands aren't its own")

-- in combat it doesn't start
combat = true
check(Probe:Command("dev mem") == true and not Probe.state.running, "in combat it doesn't start")
check(said[#said]:find("combat", 1, true) ~= nil, "and says so: " .. tostring(said[#said]))
combat = false

-- a bad number: the usage line
check(Probe:Command("dev mem lots") == true and not Probe.state.running and said[#said]:find("Usage", 1, true), "a word that isn't seconds prints the usage")

-- start for 10 seconds
check(Probe:Command("dev mem 10") == true and Probe.state.running, "/crt dev mem 10 starts it")
check(said[#said]:find("10 s", 1, true) and said[#said]:find("4 of CRT", 1, true), "it says for how long, and how many of CRT's frames: " .. tostring(said[#said]))
check(notesWin.scripts.OnUpdate ~= nwUpdate and notesWin.scripts.OnEvent ~= nwEvent, "CRT's frame (by source location) is wrapped")
check(named.scripts.OnUpdate ~= namedUpdate, "a CRT frame by its name is wrapped")
check(other.scripts.OnUpdate == otherUpdate, "another addon's frame isn't")
check(secure.scripts.OnEvent == secureEvent, "a protected frame isn't")
check(quiet.scripts.OnUpdate == nil and quiet.scripts.OnEvent == nil, "a frame with no scripts gets none")
check(C_Timer.After ~= after and C_Timer.NewTimer ~= newTimer and C_Timer.NewTicker ~= newTicker, "C_Timer's functions are wrapped while it runs")

-- run: 30 updates, 3 events of two kinds, CRT's timers and another caller's
for _ = 1, 30 do notesWin.scripts.OnUpdate(notesWin, 0.1) named.scripts.OnUpdate(named, 0.1) other.scripts.OnUpdate(other, 0.1) end
notesWin.scripts.OnEvent(notesWin, "GROUP_ROSTER_UPDATE")
notesWin.scripts.OnEvent(notesWin, "GROUP_ROSTER_UPDATE")
notesWin.scripts.OnEvent(notesWin, "PLAYER_ENTERING_WORLD")
stack = '[string "@' .. CRT_PATH .. 'CRT_Core/UI/Confirm.lua"]:226: in function <...>'
C_Timer.After(1, grows(7))
stack = '[string "@' .. CRT_PATH .. 'CRT_Modules/Late/Data.lua"]:668: in function <...>'
C_Timer.NewTicker(1, grows(3))
stack = '[string "@Interface/AddOns/Blizzard_Something/X.lua"]:10: in function <...>'
C_Timer.After(1, grows(999))
-- a collector step during a call shrinks the heap: it counts 0, never less
local shrink = function() heap = heap - 400 end
notesWin.scripts.OnEvent(notesWin, "ZONE_CHANGED_NEW_AREA")
local wrappedEvent = notesWin.scripts.OnEvent
nwEvent = shrink
button.scripts.OnClick(button, "LeftButton")
button.scripts.OnClick(button, "LeftButton")
button.scripts.OnShow(button)
CRT.UI:Show("start")
CRT.UI:Show("notes")
for _ = 1, 3 do menu.scripts.OnClick(menu, "LeftButton") end
CRT.NoteWindow.rebuilds.window.changed = 5
CRT.NoteWindow.rebuilds.personal.live = 3
-- CRT sets a new script on its frame meanwhile: that one stays after the probe
local newer = function() end
named.scripts.OnUpdate = newer
advance(1)

-- the end: 10 seconds in
advance(9)
check(not Probe.state.running, "it ends by itself after the seconds given")
local list, total = Probe.Top()
local byKey = {}
for _, e in ipairs(list) do byKey[e.key] = e end
local upd = byKey["OnUpdate  CRT_Modules/Notes/Window.lua:1437"]
check(upd and upd.calls == 30 and math.abs(upd.kb - 60) < 0.01, "OnUpdate measured: 30 calls, 60 KB: " .. tostring(upd and upd.calls) .. " " .. tostring(upd and upd.kb))
local roster = byKey["OnEvent GROUP_ROSTER_UPDATE  CRT_Modules/Notes/Window.lua:1437"]
check(roster and roster.calls == 2 and math.abs(roster.kb - 10) < 0.01, "OnEvent measured per event: GROUP_ROSTER_UPDATE 2 calls, 10 KB")
check(byKey["OnEvent PLAYER_ENTERING_WORLD  CRT_Modules/Notes/Window.lua:1437"] ~= nil, "each event its own line")
local timer = byKey["timer  CRT_Core/UI/Confirm.lua:226"]
check(timer and timer.calls == 1 and math.abs(timer.kb - 7) < 0.01, "a CRT timer measured under the line that started it")
local ticker = byKey["timer  CRT_Modules/Late/Data.lua:668"]
check(ticker and ticker.calls == 1 and math.abs(ticker.kb - 3) < 0.01, "a CRT ticker too")
local named0 = byKey["OnUpdate  CowfeeRaidToolsUndoToast"]
check(named0 and named0.calls == 30, "the named frame measured")
local any999 = false
for _, e in ipairs(list) do if e.kb >= 999 or e.key:find("Blizzard", 1, true) or e.key:find("OtherAddon", 1, true) then any999 = true end end
check(not any999, "another caller's timer and another addon's frame aren't measured")
check(list[1].key == "UI:Show" and list[2].key == "UI:BuildPage notes (first build, once)" and list[3].key == "OnUpdate  CRT_Modules/Notes/Window.lua:1437", "the list is sorted by KB, the most first: " .. list[1].key)
local click = byKey["OnClick  CRT_Core/UI/StartPage.lua:90"]
check(click and click.calls == 2 and math.abs(click.kb - 3) < 0.01, "OnClick measured")
check(byKey["OnShow  CRT_Core/UI/StartPage.lua:90"] ~= nil, "OnShow measured")
local shows = byKey["UI:Show"]
check(shows and shows.calls == 2 and math.abs(shows.kb - 340) < 0.01, "CRT.UI:Show measured: " .. tostring(shows and shows.kb))
check(CRT.UI.Show == uiShow, "CRT.UI.Show put back")
local function near(e, calls, kb) return e and e.calls == calls and math.abs(e.kb - kb) < 0.01 end
local mclick = byKey["OnClick  CRT_Core/UI/Panel.lua:2370"]
check(near(mclick, 3, 3), "a menu click counts only its own KB, not the page change in it: " .. tostring(mclick and mclick.kb))
local sel = byKey["UI:SelectPage (page change, not the first build)"]
check(near(sel, 3, 6), "a page change counts without the first build and the layout editor: " .. tostring(sel and sel.kb))
local bld = byKey["UI:BuildPage notes (first build, once)"]
check(near(bld, 1, 200), "the page's first build on its own line, by page: " .. tostring(bld and bld.kb))
local apply = byKey["Dev:ApplyAll (dev layout editor, after a page change)"]
check(near(apply, 3, 12), "the dev layout editor on its own line: " .. tostring(apply and apply.kb))
check(CRT.UI.SelectPage == uiSelect and CRT.UI.BuildPage == uiBuild and CRT.Dev.ApplyAll == devApply, "SelectPage, BuildPage and ApplyAll put back")
local tipLine
for _, p in ipairs(printed) do if p:find("game's tooltip", 1, true) then tipLine = p end end
check(tipLine and tipLine:find("25.0 KB", 1, true), "it says what hiding the game's tooltip alone makes: " .. tostring(tipLine))
check(not GameTooltip.shown, "and leaves the tooltip hidden")
check(button.scripts.OnClick == clickFn and button.scripts.OnShow == showFn, "OnClick and OnShow put back")
local causes
for _, p in ipairs(printed) do if p:find("Note window rebuilds", 1, true) then causes = p end end
check(causes and causes:find("window: changed 3", 1, true) and causes:find("personal: live 3", 1, true) and causes:find("assignments: none", 1, true),
  "the note windows' rebuilds during the run, by cause: " .. tostring(causes))
-- the report: a total line, then the top lines with KB and calls
local report = said[#said]
check(report:find("Memory probe, 10 s", 1, true) and report:find("KB", 1, true), "the report's total line: " .. tostring(report))
local tops = 0
for _, p in ipairs(printed) do if p:find("KB", 1, true) and p:find("calls", 1, true) then tops = tops + 1 end end
check(tops >= 4 and tops <= 10, "it prints the top lines (at most 10): " .. tops)

-- everything put back
check(notesWin.scripts.OnUpdate == nwUpdate, "OnUpdate put back as it was")
check(named.scripts.OnUpdate == newer, "a script CRT set meanwhile is kept, never overwritten")
check(C_Timer.After == after and C_Timer.NewTimer == newTimer and C_Timer.NewTicker == newTicker, "C_Timer's functions put back")
-- a wrapper still around (a hook on top of it) only passes the call on once it ended
local before = heap
wrappedEvent(notesWin, "GROUP_ROSTER_UPDATE")
local _, totalAfter = Probe.Top()
check(totalAfter == total, "after it ended, a wrapper left in a hook measures nothing")

-- top 10 at most, with more than 10 lines
for i = 1, 12 do frame("CowfeeRaidToolsF" .. i, "UnknownFile").scripts.OnUpdate = grows(i) end
printed = {}
Probe:Command("dev mem")
check(Probe.state.seconds == 15, "the default is 15 seconds")
check(said[#said - 0]:find("enableSourceLocationLookup", 1, true) == nil, "with source locations on, no CVar hint")
for _, f in ipairs(frames) do if f.name and f.name:find("^CowfeeRaidToolsF") then f.scripts.OnUpdate(f, 0.1) end end
advance(15)
tops = 0
for _, p in ipairs(printed) do if p:find("calls", 1, true) then tops = tops + 1 end end
check(tops == 10, "never more than 10 lines: " .. tops)

-- source locations off: only named frames, and it says how to turn them on
for _, f in ipairs(frames) do f.source = "UnknownFile" end
Probe:Command("dev mem 2")
check(said[#said]:find("enableSourceLocationLookup", 1, true) ~= nil, "with source locations off it names the CVar")
check(notesWin.scripts.OnUpdate == nwUpdate, "and can't tell the unnamed frame is CRT's: left alone")
advance(2)
check(Probe.CrtPlace([[Interface\\AddOns\\CowfeeRaidTools\\CRT_Core\\Comm.lua:140]]) == "CRT_Core/Comm.lua:140", "a Windows path is read too")

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " memory probe checks failed") end
`;
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
// the Lua print is replaced inside the harness; keep a way out for its result lines
lua.lua_pushcfunction(L, (L) => { console.log(lua.lua_tojsstring(L, 1)); return 0; });
lua.lua_setglobal(L, to_luastring('OUT'));
const h = harness.replace(/print\(passes/, 'OUT(passes').replace(/print\("FAIL " \.\. what\)/, 'OUT("FAIL " .. what)');
if (lauxlib.luaL_loadstring(L, to_luastring(h)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(src));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('ok memory probe');
