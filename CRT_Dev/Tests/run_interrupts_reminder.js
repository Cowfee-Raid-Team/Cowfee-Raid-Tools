// Interrupts' countdown (CRT_Modules/Interrupts/Reminder.lua) with a mocked clock and timers: one timer per wave
// from the pull, a counted anchor moving its wave's timer, the reminder shown at the lead with "Kick #3 Left" and
// the seconds left, a reminder already on screen moved to the new end, hidden at 0 with the chosen sound (none for
// "none"), no timers without a number or with the reminder off, Preview's one 5 second countdown, the size, the
// icon by spec, then class, then the game's kick icon, and the placement (Previews, saved per character).
// Usage: node run_interrupts_reminder.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, dataSrc, anchorSrc, reminderSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local function eq(a, b, what) check(a == b, what .. " (got " .. tostring(a) .. ", want " .. tostring(b) .. ")") end
time = function() return 1790000000 end
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
STANDARD_TEXT_FONT = "Fonts\\\\FRIZQT__.TTF"
local clock = 1000
GetTime = function() return clock end
-- live timers, earliest first; advance(to) runs them in order up to the time given
local timers = {}
local function sortTimers() table.sort(timers, function(a, b) return a.at < b.at end) end
C_Timer = {
  NewTimer = function(s, fn)
    local t = { at = clock + s, fn = fn }
    function t:Cancel() for i, x in ipairs(timers) do if x == self then table.remove(timers, i) break end end self.cancelled = true end
    function t:IsCancelled() return self.cancelled == true end
    timers[#timers + 1] = t sortTimers() return t
  end,
  After = function(s, fn) C_Timer.NewTimer(s, fn) end,
}
local updating = {}
local function advance(to)
  while true do
    sortTimers()
    local t = timers[1]
    if not t or t.at > to then break end
    table.remove(timers, 1)
    clock = t.at
    t.fn()
  end
  clock = to
  for f, fn in pairs(updating) do fn(f, 0.1) end
end
local function region(kind)
  local r = { kind = kind, shown = true, points = {}, scripts = {} }
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
  function r:GetWidth() return self.w or 0 end
  function r:GetHeight() return self.h or 0 end
  function r:SetColorTexture(...) self.color = { ... } end
  function r:SetTexture(t) self.texture = t end
  function r:SetTexCoord() end
  function r:SetFont(f, s, o) self.font = { f, s, o } return true end
  function r:SetFontObject(o) self.fontObject = o end
  function r:SetText(t) self.text = t end
  function r:GetText() return self.text end
  function r:SetTextColor(...) self.textColor = { ... } end
  function r:SetJustifyH() end
  function r:SetWordWrap() end
  function r:SetFrameLevel(l) self.level = l end
  function r:GetFrameLevel() return self.level or 1 end
  function r:SetReverse(v) self.reverse = v end
  function r:SetHideCountdownNumbers(v) self.hideNumbers = v end
  function r:SetDrawEdge() end
  function r:SetCooldown(s, d) self.cooldown = { s, d } end
  function r:Clear() self.cooldown = nil end
  function r:EnableMouse() end
  function r:SetScript(k, fn) self.scripts[k] = fn if k == "OnUpdate" then updating[self] = fn end end
  function r:CreateTexture() return region("Texture") end
  function r:CreateFontString() return region("FontString") end
  -- anything else the code sets (a backdrop, a strata, clamping): taken and ignored
  return setmetatable(r, { __index = function(_, k) if type(k) == "string" and k:match("^%u") then return function() end end end })
end
CreateFrame = function(kind, name, parent, template)
  local f = region(kind or "Frame")
  f.template = template
  f.events = {}
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  return f
end
UIParent = region("Frame")
issecretvalue = function() return false end
UnitName = function() return "Solex" end
local classFile, specID = "WARRIOR", nil
UnitClass = function() return "Warrior", classFile end
local textures = { [6552] = 132938, [187707] = 1376045, [96231] = 523893 }
C_Spell = { GetSpellTexture = function(id) return textures[id] end }
CRTDBChar = nil

local CRT = { db = { interrupts = { enabled = false, own = {}, shared = {}, use = {}, accept = true, test = false,
  plates = {}, reminder = { on = true, sound = "none", size = 48 } } } }
-- the UI pieces the reminder uses: the window helper, the placement helper, Previews
local windowOpts, placed, previews = nil, nil, {}
CRT.UI = {
  Window = function(name, opts) windowOpts = opts local f = region("Frame") f.content = f f.name = name f:Hide() return f end,
  RegisterPreview = function(_, key, fn) previews[key] = fn end,
  Placement = { Define = function(key, spec) placed = { key = key, spec = spec } return { Attach = function(_, f, h) placed.frame, placed.handle = f, h end, Reset = function() placed.reset = true end, Apply = function() end } end,
    FitHandle = function() end },
  ResetButton = function() return region("Button") end,
  RegisterThemed = function() end,
  RegisterLayer = function() end,
}
local played = {}
CRT.Sound = { Play = function(_, key) played[#played + 1] = key return 1 end }
CRT.Groups = { PlayerSpecID = function() return specID end }
local printed = {}
function CRT:Print(m) printed[#printed + 1] = m end
for _, src in ipairs({ registrySrc, seasonSrc, bossSrc, commSrc, latticeSrc, dataSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
CRT.Bosses:Get(3470).interrupts = { difficulty = 16, anchor = { unit = "boss2", cycle = 7, ordinal = 5, times = { 33, 94, 188, 249, 343, 404 } },
  firstCast = 4.5, spacing = 1.0, tolerance = 0.3, adds = 10, perNumber = 2, window = 25,
  groups = { "Left", "Right" }, slots = 5, label = "Kick" }
-- the class interrupts as the season's game IDs carry them
CRT.Bosses:SeasonData("sample", "gameIDs", { kicks = { classes = { WARRIOR = 6552, HUNTER = 147362, PALADIN = 96231 }, specs = { [255] = 187707, [65] = false } } })
for _, src in ipairs({ anchorSrc, reminderSrc }) do assert(load(src))("CowfeeRaidTools", CRT) end
local I, A, R = CRT.Interrupts, CRT.InterruptAnchor, CRT.InterruptReminder
check(R ~= nil, "CRT.InterruptReminder is made")
eq(R.LEAD, 5, "the lead is 5 seconds")
local mine = nil
I.Mine = function() return mine, mine and "Left" or nil end
I:SetEnabled(true)
local function arm(at) clock = at A:HandleEvent("ENCOUNTER_START", 3470, "Boss", 16) end
local function waveFired(wave, at) clock = at R:Resync(wave, at) end
local function frame() return R.frame end
local function shownFrame() return R.frame ~= nil and R.frame:IsShown() end

eq(windowOpts and windowOpts.kind, "overlay", "window: an overlay made by UI.Window")
check(placed and placed.key == "kickreminder", "placement: defined with the helper")
CRTDBChar = {}
local store = placed.spec.store()
check(CRTDBChar.interrupts and CRTDBChar.interrupts.reminder == store, "placement: saved per character, in CRTDBChar.interrupts.reminder")
check(previews["interrupts-reminder"] ~= nil, "preview: registered")

mine = 3; arm(1000)
eq(#timers, 6, "schedule: one timer per wave")
eq(timers[1] and timers[1].at, 1000 + 33 + 8.5 - 5, "schedule: wave 1 at pull + 33 + 8.5 - 5")
eq(timers[6] and timers[6].at, 1000 + 404 + 8.5 - 5, "schedule: wave 6")
waveFired(1, 1033.4)
eq(#timers, 6, "resync: still six")
eq(timers[1] and timers[1].at, 1033.4 + 8.5 - 5, "resync: wave 1 moved to the real anchor")
advance(timers[1].at); check(shownFrame(), "show: visible at the lead")
eq(R.label:GetText(), "Kick #3 Left", "show: text from the label, number and group")
eq(R.count:GetText(), "5", "show: 5 seconds left")
check(R.cooldown.reverse == true and R.cooldown.hideNumbers == true, "show: a reversed swipe without the game's numbers")
eq(R.cooldown.cooldown and R.cooldown.cooldown[2], 5, "show: a 5 second swipe")
advance(1033.4 + 8.5 - 2.5); eq(R.count:GetText(), "3", "show: the seconds left, rounded up")
-- the anchor of the wave on screen comes late: the end moves
R:Resync(1, 1034)
advance(1033.4 + 8.5 + 0.1)
check(shownFrame(), "resync: a reminder on screen moved to the new end")
advance(1034 + 8.5); check(not shownFrame(), "end: hidden at 0")
eq(#played, 0, "end: no sound when none")
-- with a sound
CRT.db.interrupts.reminder.sound = "kit:8960"
advance(timers[1].at)
check(shownFrame(), "wave 2: shown")
advance(1000 + 94 + 8.5)
check(not shownFrame(), "wave 2: hidden")
eq(played[1], "kit:8960", "end: the chosen sound")
-- an anchor counted for a wave long gone changes nothing
local n = #timers
R:Resync(1, 1033); eq(#timers, n, "resync: a wave already shown is left alone")
A:HandleEvent("ENCOUNTER_END")
eq(#timers, 0, "stop: the pull's end cancels the rest")
check(not shownFrame(), "stop: nothing on screen")

mine = nil; arm(2000)
eq(#timers, 0, "schedule: no number, no timers")
A:HandleEvent("ENCOUNTER_END")
CRT.db.interrupts.reminder.on = false; mine = 3; arm(3000)
eq(#timers, 0, "schedule: reminder off, no timers")
A:HandleEvent("ENCOUNTER_END")
CRT.db.interrupts.reminder.on = true
CRT.db.interrupts.test = true; A:StartTest()
eq(#timers, 0, "schedule: Test on trash has no pull, no timers")
A:StopTest()
-- an anchor counted after its reminder's lead began: shown at once, with the seconds left
arm(4000)
clock = 4000 + 33 + 8.5 - 5 - 1 -- the fallback's timer for wave 1 is a second away
R:Resync(1, 4000 + 30) -- but the real anchor was 3 s early: its lead began 2 s ago
check(shownFrame(), "late: shown at once")
eq(R.count:GetText(), "3", "late: with the seconds left")
advance(4000 + 30 + 8.5)
check(not shownFrame(), "late: hidden at 0")
A:HandleEvent("ENCOUNTER_END")

-- a counted wave the fallback table has no timer for (a seventh wave): its reminder starts from the counted anchor
arm(6000)
local before7 = #timers
clock = 6450; R:Resync(7, 6450)
eq(#timers, before7 + 1, "counted: a wave with no fallback timer gets one")
check(timers[#timers].at == 6450 + 8.5 - 5 or timers[1].at == 6450 + 8.5 - 5 or (function() for _, t in ipairs(timers) do if t.at == 6450 + 8.5 - 5 then return true end end end)(), "counted: at the counted anchor + 8.5 - 5")
advance(6450 + 8.5 - 5); check(shownFrame(), "counted: shown")
advance(6450 + 8.5)
local after7 = #timers
R:Resync(7, 6450); eq(#timers, after7, "counted: a wave already shown is not shown again")
check(not shownFrame(), "counted: and not on screen again")
A:HandleEvent("ENCOUNTER_END")

-- Preview reminder: one 5 second countdown, with the sound
played = {}
CRT.db.interrupts.reminder.sound = "kit:8960"
clock = 5000; R:Preview()
check(shownFrame(), "preview: shown")
eq(R.label:GetText(), "Kick #3 Left", "preview: your kick")
eq(R.count:GetText(), "5", "preview: from 5")
advance(5005)
check(not shownFrame(), "preview: gone at 0")
eq(played[1], "kit:8960", "preview: with the sound")
mine = nil; R:Preview()
eq(R.label:GetText(), "Kick #1 Left", "preview: a sample kick when you have none")
advance(5011)

-- size
CRT.db.interrupts.reminder.size = 80; R:Refresh()
eq(R.icon.w, 80, "size: the icon follows the size")

-- Previews: the drag box and a still sample, kept up while placing
previews["interrupts-reminder"](true)
check(shownFrame() and placed.handle:IsShown(), "previews: shown with its drag box")
advance(5030)
check(shownFrame(), "previews: stays while placing")
previews["interrupts-reminder"](false)
check(not shownFrame() and not placed.handle:IsShown(), "previews: hidden after")
I:SetEnabled(false)
previews["interrupts-reminder"](true)
check(not shownFrame(), "previews: not while the module is off")
previews["interrupts-reminder"](false)
I:SetEnabled(true)

-- the icon: by spec, then class, then the game's kick icon
eq(R.KickIcon(), 132938, "icon: the class's interrupt")
classFile, specID = "HUNTER", 255
eq(R.KickIcon(), 1376045, "icon: the spec's own")
classFile, specID = "PALADIN", 65
eq(R.KickIcon(), "Interface\\\\Icons\\\\ability_kick", "icon: a spec with none falls back")
classFile, specID = "MAGE", 63
eq(R.KickIcon(), "Interface\\\\Icons\\\\ability_kick", "icon: a class not listed falls back")
C_Spell.GetSpellTexture = function() error("no") end
classFile, specID = "WARRIOR", nil
eq(R.KickIcon(), "Interface\\\\Icons\\\\ability_kick", "icon: a raising call falls back")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
const dir = process.argv[2];
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const FILES = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua',
  'CRT_Core/Comm.lua', 'CRT_Modules/Interrupts/Lattice.lua', 'CRT_Modules/Interrupts/Data.lua', 'CRT_Modules/Interrupts/Anchor.lua',
  'CRT_Modules/Interrupts/Reminder.lua'];
for (const f of FILES) {
  const p = path.join(dir, f);
  lua.lua_pushstring(L, to_luastring(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : 'error("missing ' + f + '")'));
}
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
