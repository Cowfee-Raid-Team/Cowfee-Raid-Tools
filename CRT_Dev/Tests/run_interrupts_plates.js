// Interrupts' nameplate numbers (CRT_Modules/Interrupts/Plates.lua) with mocked nameplates and units: a plate
// numbered at its first cast, a re-cast keeping the number, only your pair shown by default, Show every number,
// a removed plate's number parked on the target and given back when the add's plate returns, a retarget clearing
// it, a raising or secret UnitIsUnit survived, players, bosses and plates off screen never numbered, Test on trash
// on any pack, the box's place and colours, the pool, and Stop hiding everything. Then the kick probe
// (CRT_Dev/Dev/KickProbe.lua): its log lines, on, off and show. Usage: node run_interrupts_plates.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, dataSrc, anchorSrc, platesSrc, probeSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
date = function() return "2026-10-28 20:00" end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
STANDARD_TEXT_FONT = "Fonts\\\\FRIZQT__.TTF"
local clock = 1000
GetTime = function() return clock end
-- frames: every one made, with what the code set on it
local made = 0
local function region(kind)
  local r = { kind = kind, shown = true, points = {} }
  function r:SetShown(v) self.shown = v and true or false end
  function r:Show() self.shown = true end
  function r:Hide() self.shown = false end
  function r:IsShown() return self.shown end
  function r:SetPoint(...) self.points[#self.points + 1] = { ... } end
  function r:ClearAllPoints() self.points = {} end
  function r:SetAllPoints() end
  function r:SetSize(w, h) self.w, self.h = w, h end
  function r:SetWidth(w) self.w = w end
  function r:SetHeight(h) self.h = h end
  function r:SetColorTexture(...) self.color = { ... } end
  function r:SetFont(f, s, o) self.font = { f, s, o } return true end
  function r:SetText(t) self.text = t end
  function r:SetTextColor(...) self.textColor = { ... } end
  function r:SetDrawLayer() end
  function r:SetFrameStrata(s) self.strata = s end
  function r:SetFrameLevel() end
  function r:SetIgnoreParentScale(v) self.ignoreScale = v end
  function r:SetScale() end
  function r:EnableMouse() end
  function r:CreateTexture() return region("Texture") end
  function r:CreateFontString() return region("FontString") end
  function r:SetParent(p) self.parent = p end
  function r:GetParent() return self.parent end
  function r:IsAnchoringRestricted() return self.restricted == true end
  return r
end
local frames = {}
CreateFrame = function(kind, name, parent)
  made = made + 1
  local f = region(kind or "Frame")
  f.parent = parent
  f.events = {}
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  function f:UnregisterAllEvents() self.events = {} end
  function f:SetScript(_, fn) self.fn = fn end
  frames[#frames + 1] = f
  return f
end
local function listening(event) for _, f in ipairs(frames) do if f.events[event] then return true end end return false end
UIParent = region("Frame")
local secrets = {}
issecretvalue = function(v) return secrets[v] == true end
UnitName = function() return "Solex" end

-- the units: plates on screen, who is a player, who is the target
local plates, players, bosses = {}, {}, {}
local same = {} -- handle -> the plate token it points at
local frameless = {} -- plates whose frame the game hasn't given yet
C_NamePlate = { GetNamePlateForUnit = function(u) if frameless[u] then return nil end return plates[u] end }
local soon = {}
C_Timer = { After = function(_, fn) soon[#soon + 1] = fn end }
local function runSoon() local list = soon soon = {} for _, fn in ipairs(list) do fn() end end
UnitExists = function(u) return plates[u] ~= nil or same[u] ~= nil end
UnitIsPlayer = function(u) return players[u] == true end
UnitCanAttack = function(a, b) return a == "player" and plates[b] ~= nil end
UnitLevel = function(u) return bosses[u] and -1 or 90 end
local UnitIsUnitReal = function(a, b) return same[a] ~= nil and same[a] == b end
UnitIsUnit = UnitIsUnitReal
local inRaid, members = true, 3
IsInRaid = function() return inRaid end
GetNumGroupMembers = function() return members end
GetNumSubgroupMembers = function() return members - 1 end
local function plate(u) plates[u] = region("Frame") plates[u].name = u end
local function playerPlate(u) plate(u) players[u] = true end
local function targetIs(u) same.target = u end
local function sameUnit(h, u) same[h] = u end

local CRT = { db = { interrupts = { enabled = false, own = {}, shared = {}, use = {}, accept = true, test = false,
  plates = { on = true, all = false, size = 50, font = 24, offset = 20, mineBox = { 0, 1, 0, 1 }, mineText = { 1, 0, 0, 1 }, box = { 1, 0, 0, 1 }, text = { 1, 1, 1, 1 } },
  reminder = {} } } }
local previews = {}
CRT.UI = { RegisterPreview = function(_, key, fn) previews[key] = fn end }
local printed, shownText = {}, nil
function CRT:Print(m) printed[#printed + 1] = m end
CRT.ConsumablesTools = { ShowText = function(_, title, text) shownText = text end }
for _, src in ipairs({ registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, dataSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
CRT.Bosses:Get(3470).interrupts = { difficulty = 16, anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25,
  groups = { "Left", "Right" }, slots = 5, label = "Kick" }
for _, src in ipairs({ anchorSrc, platesSrc, probeSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
local I, A, P, K = CRT.Interrupts, CRT.InterruptAnchor, CRT.InterruptPlates, CRT.KickProbe
check(P ~= nil, "CRT.InterruptPlates is made")
check(K ~= nil, "CRT.KickProbe is made")
local mine = nil
I.Mine = function() return mine, mine and "Left" or nil end
local function H(event, unit) P.HandleEvent(event, unit) end
local function shownOf(u) local b = P.boxes[u] return b ~= nil and b:IsShown() end
local function arm() I:SetEnabled(true) clock = 1000 A:HandleEvent("ENCOUNTER_START", 3470, "Boss", 16) end

check(not listening("NAME_PLATE_UNIT_ADDED"), "off: no plate events")
arm(); mine = 3; P:Refresh()
check(listening("NAME_PLATE_UNIT_ADDED") and listening("NAME_PLATE_UNIT_REMOVED") and listening("PLAYER_TARGET_CHANGED")
  and listening("PLAYER_FOCUS_CHANGED") and listening("UNIT_TARGET"), "armed: the plate events registered")
plate("nameplate1"); clock = 1037.5; H("UNIT_SPELLCAST_START", "nameplate1")
eq(P:NumberOf("nameplate1"), 1, "plates: first cast numbers the plate")
clock = 1038.6; H("UNIT_SPELLCAST_START", "nameplate1")
eq(P:NumberOf("nameplate1"), 1, "plates: a re-cast keeps the number")
plate("nameplate2"); clock = 1041.5; H("UNIT_SPELLCAST_START", "nameplate2")
eq(P:NumberOf("nameplate2"), 3, "plates: pair 3")
check(shownOf("nameplate2") and not shownOf("nameplate1"), "plates: only my pair shows by default")
local box = P.boxes.nameplate2
eq(box.text and box.text.text, "3", "box: the number")
local pt = box.points[1]
check(pt and pt[1] == "BOTTOM" and pt[2] == plates.nameplate2 and pt[3] == "TOP" and pt[4] == 0 and pt[5] == 20, "box: above the plate, 20 up")
eq(box.w, 50, "box: 50 wide"); eq(box.h, 50, "box: 50 high")
eq(box.parent, UIParent, "box: on UIParent, so the plate's scale never reaches it")
do
  local f, pl = P.NewBox(), region("Frame")
  pl.restricted = true
  check(P.Attach(f, pl) and f.parent == pl, "box: a plate that refuses anchors from outside takes the box as its child")
  f.SetPoint = function() error("restricted") end
  check(P.Attach(f, region("Frame")) == false, "box: a raising SetPoint leaves it unplaced")
end
-- a plate whose frame reads nil at its first cast: drawn on the next plate event, or by a short timer
plate("nameplate30"); frameless.nameplate30 = true; clock = 1041.5; H("UNIT_SPELLCAST_START", "nameplate30")
eq(P:NumberOf("nameplate30"), 3, "frameless: numbered all the same")
check(not shownOf("nameplate30"), "frameless: nothing to draw on yet")
frameless.nameplate30 = nil
plate("nameplate31"); H("NAME_PLATE_UNIT_ADDED", "nameplate31")
check(shownOf("nameplate30"), "frameless: drawn on the next plate event")
plate("nameplate32"); frameless.nameplate32 = true; clock = 1041.6; H("UNIT_SPELLCAST_START", "nameplate32")
check(#soon > 0, "frameless: a short timer is set")
frameless.nameplate32 = nil; runSoon()
check(shownOf("nameplate32"), "frameless: drawn by the timer")
H("NAME_PLATE_UNIT_REMOVED", "nameplate30"); H("NAME_PLATE_UNIT_REMOVED", "nameplate31"); H("NAME_PLATE_UNIT_REMOVED", "nameplate32")
plates.nameplate30, plates.nameplate31, plates.nameplate32 = nil, nil, nil
eq(box.text.font[2], 24, "box: the number's size"); eq(box.text.font[3], "OUTLINE", "box: outlined")
eq(table.concat(box.bg.color, ","), "0,1,0,1", "box: your pair in your box colour")
eq(table.concat(box.text.textColor, ","), "1,0,0,1", "box: and your number colour")
CRT.db.interrupts.plates.all = true; P:Refresh()
check(shownOf("nameplate1"), "plates: show all shows the rest")
eq(table.concat(P.boxes.nameplate1.bg.color, ","), "1,0,0,1", "box: another pair in the other box colour")
eq(table.concat(P.boxes.nameplate1.text.textColor, ","), "1,1,1,1", "box: and the other number colour")
CRT.db.interrupts.plates.size = 70; CRT.db.interrupts.plates.offset = -10; P:Refresh()
eq(P.boxes.nameplate1.w, 70, "refresh: a new size")
eq(P.boxes.nameplate1.points[1][5], -10, "refresh: a new height")
CRT.db.interrupts.plates.on = false; P:Refresh()
check(not shownOf("nameplate1") and not shownOf("nameplate2"), "plates: numbers off hides every box")
CRT.db.interrupts.plates.on = true; CRT.db.interrupts.plates.size = 50; CRT.db.interrupts.plates.offset = 20; P:Refresh()

-- a plate that leaves the screen and comes back
targetIs("nameplate2"); H("NAME_PLATE_UNIT_REMOVED", "nameplate2"); plates.nameplate2 = nil
eq(P:NumberOf("nameplate2"), nil, "plates: removed plate has no number")
check(not shownOf("nameplate2"), "plates: its box hidden")
same.target = nil
plate("nameplate7"); sameUnit("target", "nameplate7"); H("NAME_PLATE_UNIT_ADDED", "nameplate7")
eq(P:NumberOf("nameplate7"), 3, "plates: number recalled through the target handle")
check(shownOf("nameplate7"), "plates: and drawn")
H("PLAYER_TARGET_CHANGED"); same.target = nil
H("NAME_PLATE_UNIT_REMOVED", "nameplate7"); plates.nameplate7 = nil
plate("nameplate8"); sameUnit("target", "nameplate8"); H("NAME_PLATE_UNIT_ADDED", "nameplate8")
eq(P:NumberOf("nameplate8"), nil, "plates: cleared handle recalls nothing")
-- a raid member's target keeps it, until they retarget
same.target = nil
plate("nameplate3"); clock = 1042.5; H("UNIT_SPELLCAST_START", "nameplate3")
eq(P:NumberOf("nameplate3"), 3, "plates: pair 3 again")
sameUnit("raid2target", "nameplate3"); H("NAME_PLATE_UNIT_REMOVED", "nameplate3"); plates.nameplate3 = nil
same.raid2target = nil
plate("nameplate4"); sameUnit("raid2target", "nameplate4"); H("NAME_PLATE_UNIT_ADDED", "nameplate4")
eq(P:NumberOf("nameplate4"), 3, "plates: recalled through a raid member's target")
sameUnit("raid3target", "nameplate4"); H("NAME_PLATE_UNIT_REMOVED", "nameplate4"); plates.nameplate4 = nil
H("UNIT_TARGET", "raid3")
plate("nameplate5"); sameUnit("raid3target", "nameplate5"); H("NAME_PLATE_UNIT_ADDED", "nameplate5")
eq(P:NumberOf("nameplate5"), nil, "plates: a retarget clears that handle")
same.raid3target, same.raid2target = nil, nil
UnitIsUnit = function() error("restricted") end
H("NAME_PLATE_UNIT_REMOVED", "nameplate1")
check(true, "plates: a raising UnitIsUnit is survived")
plate("nameplate6"); H("NAME_PLATE_UNIT_ADDED", "nameplate6")
eq(P:NumberOf("nameplate6"), nil, "plates: and recalls nothing")
secrets.hidden = true
UnitIsUnit = function() return "hidden" end
plate("nameplate11"); clock = 1043.5; H("UNIT_SPELLCAST_START", "nameplate11")
H("NAME_PLATE_UNIT_REMOVED", "nameplate11"); plates.nameplate11 = nil
plate("nameplate12"); H("NAME_PLATE_UNIT_ADDED", "nameplate12")
eq(P:NumberOf("nameplate12"), nil, "plates: a secret UnitIsUnit counts as no")
UnitIsUnit = UnitIsUnitReal

-- never numbered
playerPlate("nameplate9"); clock = 1042.5; H("UNIT_SPELLCAST_START", "nameplate9")
eq(P:NumberOf("nameplate9"), nil, "plates: players are never numbered")
plate("nameplate10"); bosses.nameplate10 = true; H("UNIT_SPELLCAST_START", "nameplate10")
eq(P:NumberOf("nameplate10"), nil, "plates: a boss (level -1) is never numbered")
plate("nameplate13"); clock = 1044.0; H("UNIT_SPELLCAST_START", "nameplate13")
eq(P:NumberOf("nameplate13"), nil, "plates: a cast off the lattice is not numbered")
clock = 1044.5; H("UNIT_SPELLCAST_START", "nameplate13")
eq(P:NumberOf("nameplate13"), nil, "plates: only the first cast counts")
H("UNIT_SPELLCAST_START", "boss2"); H("UNIT_SPELLCAST_START", "raid1")
eq(P:NumberOf("boss2"), nil, "plates: only nameplate tokens")
secrets.nameplate14 = true; plate("nameplate14"); H("UNIT_SPELLCAST_START", "nameplate14")
eq(P:NumberOf("nameplate14"), nil, "plates: a secret token is left alone")
UnitLevel = function() return "hidden" end
plate("nameplate15"); clock = 1045.5; H("UNIT_SPELLCAST_START", "nameplate15")
eq(P:NumberOf("nameplate15"), nil, "plates: a secret level is not a candidate")
UnitLevel = function(u) return bosses[u] and -1 or 90 end

-- the pool: Stop hides every box, and the next pull makes no new frames
P:Stop(); local any = false for u in pairs(P.boxes) do if shownOf(u) then any = true end end
check(not any, "stop: every box hidden")
check(next(P.boxes) == nil, "stop: back to the pool")
check(not listening("NAME_PLATE_UNIT_ADDED"), "stop: the plate events go")
local function wave() for i = 1, 4 do plate("nameplate" .. i); clock = 1037.5 + i; H("UNIT_SPELLCAST_START", "nameplate" .. i) end end
arm(); wave()
eq(P:NumberOf("nameplate4"), 3, "pool: a wave numbered")
A:HandleEvent("ENCOUNTER_END")
arm()
local before = made
wave()
eq(made, before, "pool: no new frames for the next pull's boxes")
A:HandleEvent("ENCOUNTER_END")
check(next(P.boxes) == nil, "end: disarming stops the boxes")

-- Test on trash: any pack, the first cast starts a wave
CRT.db.interrupts.test = true; A:StartTest()
mine = 1
plate("nameplate1"); clock = 2000; H("UNIT_SPELLCAST_START", "nameplate1")
plate("nameplate2"); clock = 2001; H("UNIT_SPELLCAST_START", "nameplate2")
plate("nameplate3"); clock = 2002; H("UNIT_SPELLCAST_START", "nameplate3")
eq(P:NumberOf("nameplate1"), 1, "test: the first cast is 1")
eq(P:NumberOf("nameplate2"), 1, "test: the second is 1 too")
eq(P:NumberOf("nameplate3"), 2, "test: the third is 2")
A:StopTest()
check(next(P.boxes) == nil, "test: off and they go")

-- the preview: one sample box of your number
I:SetEnabled(true)
check(previews["interrupts-box"] ~= nil, "preview: registered")
previews["interrupts-box"](true)
check(P.preview and P.preview:IsShown(), "preview: shown")
eq(P.preview.text.text, "1", "preview: your number")
previews["interrupts-box"](false)
check(not P.preview:IsShown(), "preview: hidden")
I:SetEnabled(false)
previews["interrupts-box"](true)
check(not P.preview:IsShown(), "preview: not while the module is off")
I:SetEnabled(true)

-- the kick probe
eq(K:Command("dev kicks on"), true, "probe: dev kicks on")
check(CRT.db.dev.kickProbe.on, "probe: on saved")
arm(); mine = 2
A:HandleEvent("UNIT_SPELLCAST_START", "boss2") for i = 2, 4 do A:HandleEvent("UNIT_SPELLCAST_START", "boss2") end
clock = 1033.2; A:HandleEvent("UNIT_SPELLCAST_START", "boss2")
plate("nameplate1"); clock = 1037.7; H("UNIT_SPELLCAST_START", "nameplate1")
plate("nameplate2"); clock = 1038.2; H("UNIT_SPELLCAST_START", "nameplate2")
playerPlate("nameplate9"); clock = 1039; H("UNIT_SPELLCAST_START", "nameplate9")
local lines = CRT.db.dev.kickProbe.last.lines
local log = table.concat(lines, "\\n")
check(log:find("33.2 anchor wave 1", 1, true) ~= nil, "probe: the counted anchor logged: " .. log)
check(log:find("+0.0 boss2 cast 1", 1, true) ~= nil and log:find("+33.2 boss2 cast 5", 1, true) ~= nil, "probe: every anchor-unit cast logged with its count")
check(log:find("37.7 nameplate1 anchor+4.50 -> 1", 1, true) ~= nil, "probe: a numbered cast logged")
check(log:find("38.2 nameplate2 anchor+5.00 -> ignored", 1, true) ~= nil, "probe: an off-lattice cast logged")
check(log:find("39.0 nameplate9 not an add", 1, true) ~= nil, "probe: a player's cast logged")
K:Command("dev kicks show")
check(shownText and shownText:find("nameplate1", 1, true), "probe: show opens the log")
check(table.concat(printed, " "):find("9 lines", 1, true), "probe: show prints the count")
K:Command("dev kicks off")
check(not CRT.db.dev.kickProbe.on, "probe: off")
plate("nameplate3"); clock = 1039.5; H("UNIT_SPELLCAST_START", "nameplate3")
eq(#CRT.db.dev.kickProbe.last.lines, #lines, "probe: off logs nothing")
eq(K:Command("dev other"), false, "probe: other words are not its")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const FILES = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Comm.lua', 'CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/Anchor.lua',
  'CRT_Modules/Interrupts/Plates.lua', 'CRT_Dev/Dev/KickProbe.lua'];
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
