// CRT_Modules/Alerts/InstantRelease.lua: Instantly release after wipe (Mech Alerts > Special), ticked per boss in
// CRTDB.alerts.instantReleaseBosses[encounterID], the same on every difficulty.
// With the setting on, a wipe (ENCOUNTER_END success 0) on any boss in a raid instance (never a dungeon), while you are dead and not a ghost, calls RepopMe
// once, RELEASE_DELAY seconds later, after checking again. Never after a kill, with the setting off, alive, as a ghost,
// with a resurrection on the way or offered, while you can resurrect yourself, or with a nil or secret encounter. Also:
// the default in Core.lua (off, under alerts; no qol.autoRelease), no boss file carries autoRelease and the boss
// library has no autoRelease accessors, and Quality of Life has its tabs (Battle res added in #1262) with no release box. The check box
// on Mech Alerts > Special is checked in run_mechalerts.js.
// Usage: node run_instantrelease.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local coreText, releaseSrc, pageSrc, nShipped = ...
local args = { select(5, ...) }
local passed, failed = 0, 0
local function check(name, cond, detail)
  if cond then passed = passed + 1 print("ok " .. name)
  else failed = failed + 1 print("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or "")) end
end
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
local SECRET = setmetatable({}, { __eq = function() error("secret compared", 2) end })
function issecretvalue(v) return rawequal(v, SECRET) end
local clock = 100
function GetTime() return clock end
local timers = {}
C_Timer = { After = function(d, fn) timers[#timers + 1] = { due = clock + d, fn = fn } end }
local function step(dt)
  local stop = clock + dt
  while true do
    local first
    for i, t in ipairs(timers) do if t.due <= stop + 1e-9 and (not first or t.due < timers[first].due) then first = i end end
    if not first then break end
    local t = table.remove(timers, first)
    clock = math.max(clock, t.due)
    t.fn()
  end
  clock = stop
end
local dead, ghost, incoming = true, false, false
function UnitIsDead(u) if u == "player" then return dead end return false end
function UnitIsGhost(u) if u == "player" then return ghost end return false end
function UnitHasIncomingResurrection(u) if u == "player" then return incoming end return false end
selfRes = nil -- what C_DeathInfo.GetSelfResurrectOptions gives; "error" makes it error
C_DeathInfo = { GetSelfResurrectOptions = function() if selfRes == "error" then error("no") end return selfRes end }
corpseDelay = nil -- what GetCorpseRecoveryDelay gives (nil: 0)
function GetCorpseRecoveryDelay() return corpseDelay or 0 end
instanceType = "raid" -- what IsInInstance gives as its second value; "error" makes it error
function IsInInstance() if instanceType == "error" then error("no") end return instanceType ~= "none", instanceType end
local repops = 0
function RepopMe() repops = repops + 1 ghost = true dead = false end
local function mock()
  local m = { pts = {} }
  return setmetatable(m, { __index = function(t, k)
    if type(k) == "string" and k:match("^%l") then return nil end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock() end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetStringWidth" then return function(self) return #(rawget(self, "text") or "") * 7 end end
    if k == "GetFontString" then return function(self) return self end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on) end end
    if k == "GetChecked" then return function(self) return rawget(self, "checked") end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "IsShown" then return function() return true end end
    return function() end
  end })
end
local frames = {}
function CreateFrame()
  local f = mock()
  rawset(f, "events", {})
  f.RegisterEvent = function(self, ev) self.events[ev] = true end
  frames[#frames + 1] = f
  return f
end
local function fire(ev, ...)
  for _, f in ipairs(frames) do if f.events[ev] and f.OnEvent then f.OnEvent(f, ev, ...) end end
end
local CRT = { db = { qol = { lowHealth = {}, breakTimer = {} }, alerts = {}, dev = {} } }
function CRT:Print() end

-- No boss data: every boss counts, so no boss file has autoRelease and the library has no accessor for it -----------
do
  local shipped = {}
  for i = 1, nShipped do
    local name, src = args[2 * i - 1], args[2 * i]
    local ok, err = pcall(function() assert(load(src, "@" .. name))("CowfeeRaidTools", shipped) end)
    if not ok then check(name .. " loads", false, err) end
  end
  local with = {}
  for _, def in ipairs(shipped.Bosses and shipped.Bosses:List() or {}) do if def.autoRelease ~= nil then with[#with + 1] = def.name end end
  check("the shipped packs load", shipped.Bosses ~= nil and #shipped.Bosses:List() > 0)
  check("no boss file has autoRelease", #with == 0, table.concat(with, ","))
  check("no Bosses:AutoRelease or AutoReleaseNames", shipped.Bosses and shipped.Bosses.AutoRelease == nil and shipped.Bosses.AutoReleaseNames == nil)
end

-- The default: off, with the other Mech Alerts settings ------------------------------------------------------------
local alerts = coreText:match("\n    alerts = (%b{})")
check("Core.lua's alerts defaults have instantReleaseBosses = {}, and no old instantRelease", alerts ~= nil
  and alerts:find("\n        instantReleaseBosses = {},", 1, true) ~= nil and not alerts:find("instantRelease =", 1, true))
local qol = coreText:match("\n    qol = (%b{})")
check("Core.lua's qol defaults have no autoRelease", qol ~= nil and not qol:find("autoRelease", 1, true))
local fangs, other = 3421, 3470 -- two encounter IDs: fangs ticked, other not
-- the per-boss store is declared for the season purge (Bosses:DeclareField)
local declared = {}
CRT.Bosses = { DeclareField = function(_, label, area, field) declared[#declared + 1] = area .. "." .. field end }

-- The behaviour ----------------------------------------------------------------------------------------------
local ok, err = pcall(function() assert(load(releaseSrc, "@InstantRelease.lua"))("CowfeeRaidTools", CRT) end)
check("InstantRelease.lua loads", ok and CRT.InstantRelease ~= nil, err)
if not (ok and CRT.InstantRelease) then print(passed .. " passed, " .. failed .. " failed") error("no module") end
local AR = CRT.InstantRelease
check("the delay is half a second", AR.RELEASE_DELAY == 0.5, AR.RELEASE_DELAY)
check("its per-boss ticks are declared for the season purge", table.concat(declared, ",") == "alerts.instantReleaseBosses", table.concat(declared, ","))
-- on: fangs ticked; false: none ticked; nil: no table at all
local function reset(on)
  dead, ghost, incoming, repops, timers = true, false, false, 0, {}
  if on == nil then CRT.db.alerts.instantReleaseBosses = nil else CRT.db.alerts.instantReleaseBosses = on and { [fangs] = true } or {} end
end

-- IsOn and Set, for the page and the dev tool
reset(false)
check("IsOn: no boss is ticked by default", AR.IsOn(fangs) == false and AR.IsOn(other) == false)
check("Set ticks one boss only", AR.Set(fangs, true) == true and AR.IsOn(fangs) == true and AR.IsOn(other) == false
  and CRT.db.alerts.instantReleaseBosses[fangs] == true)
check("Set off clears it", AR.Set(fangs, false) == true and AR.IsOn(fangs) == false and CRT.db.alerts.instantReleaseBosses[fangs] == nil)
check("a nil, secret or non-number ID is off and can't be set", AR.IsOn(nil) == false and AR.IsOn(SECRET) == false and AR.IsOn("3421") == false
  and AR.Set(nil, true) == false and AR.Set(SECRET, true) == false and AR.Set("3421", true) == false)
CRT.db.alerts.instantReleaseBosses = nil
check("Set makes the table when there is none", AR.Set(other, true) == true and AR.IsOn(other) == true)
CRT.db.alerts.instantReleaseBosses = true -- an old boolean in its place is never read as a table
check("a non-table store is off, no error", AR.IsOn(fangs) == false)
local ticked = (AR.Set(fangs, true) and AR.Ticked()) or {}
check("Ticked lists the ticked IDs, sorted", table.concat(ticked, ",") == "3421", table.concat(ticked, ","))
local function wipeOn(id, success) fire("ENCOUNTER_END", id, "Boss", 16, 20, success) end

reset(true)
wipeOn(fangs, 0)
check("on, a wipe while dead: not released at once", repops == 0)
step(0.4)
check("not before the delay", repops == 0)
step(0.1)
check("released once after half a second", repops == 1, repops)
step(5)
check("only once", repops == 1, repops)

reset(true) wipeOn(fangs, 1) step(2)
check("a kill: not released", repops == 0)
reset(true) wipeOn(other, 0) step(2)
check("a raid wipe on an unticked boss: not released", repops == 0, repops)
reset(false) wipeOn(fangs, 0) step(2)
check("no boss ticked: not released", repops == 0)
reset(nil) wipeOn(fangs, 0) step(2)
check("no ticks saved at all: not released", repops == 0)
reset(true) dead = false wipeOn(fangs, 0) step(2)
check("alive at the end: not released", repops == 0)
reset(true) dead, ghost = false, true wipeOn(fangs, 0) step(2)
check("already a ghost at the end: not released", repops == 0)
reset(true) wipeOn(fangs, 0) step(0.2) dead = false step(2)
check("alive again by the time the delay ends: not released", repops == 0)
reset(true) wipeOn(fangs, 0) step(0.2) dead, ghost = false, true step(2)
check("a ghost by the time the delay ends: not released", repops == 0)
reset(true) wipeOn(fangs, 0) step(0.2) AR.Set(fangs, false) step(2)
check("the boss unticked during the delay: not released", repops == 0)
reset(true) wipeOn(fangs, 0) step(0.2) AR.Set(fangs, false) AR.Set(other, true) step(2)
check("after the delay it asks about the same boss, not another ticked one", repops == 0)
reset(true) incoming = true wipeOn(fangs, 0) step(2)
check("a resurrection being cast on you: not released", repops == 0)
reset(true) wipeOn(fangs, 0) step(0.2) incoming = true step(2)
check("a resurrection cast started during the delay: not released", repops == 0)
reset(true) fire("RESURRECT_REQUEST", "Healer") step(10) wipeOn(fangs, 0) step(2)
check("a resurrection offered: not released", repops == 0)
reset(true) step(61) wipeOn(fangs, 0) step(2)
check("an offer over a minute old no longer holds it back", repops == 1, repops)
reset(true) fire("RESURRECT_REQUEST", "Healer") step(5) fire("PLAYER_DEAD") wipeOn(fangs, 0) step(2)
check("an offer from before your last death no longer holds it back", repops == 1, repops)
-- the game's offer lasts the corpse delay plus 60 s (GetCorpseRecoveryDelay, read when the offer comes)
corpseDelay = 30
reset(true) fire("PLAYER_DEAD") fire("RESURRECT_REQUEST", "Healer") step(75) wipeOn(fangs, 0) step(2)
check("with a 30 s corpse delay, an offer 75 s old still holds it back", repops == 0, repops)
reset(true) step(15) wipeOn(fangs, 0) step(2)
check("and one past 90 s doesn't", repops == 1, repops)
for _, case in ipairs({ { SECRET, "secret" }, { "x", "not a number" }, { -5, "below 0" } }) do
  corpseDelay = case[1]
  reset(true) fire("PLAYER_DEAD") fire("RESURRECT_REQUEST", "Healer") step(61) wipeOn(fangs, 0) step(2)
  check("a corpse delay that is " .. case[2] .. " counts as 0, no error", repops == 1, repops)
end
corpseDelay = nil
local keepDelay = GetCorpseRecoveryDelay
GetCorpseRecoveryDelay = function() error("no") end
reset(true) fire("PLAYER_DEAD") fire("RESURRECT_REQUEST", "Healer") step(61) wipeOn(fangs, 0) step(2)
check("a corpse delay call that errors counts as 0", repops == 1, repops)
GetCorpseRecoveryDelay = nil
reset(true) fire("PLAYER_DEAD") fire("RESURRECT_REQUEST", "Healer") step(61) wipeOn(fangs, 0) step(2)
check("no corpse delay call counts as 0", repops == 1, repops)
GetCorpseRecoveryDelay = keepDelay
fire("PLAYER_DEAD")
-- A self-resurrect (soulstone, Reincarnation): Alex, 2026-11-02, "Hold if I have one"
local option = { name = "Use Soulstone", optionType = 1, id = 1, canUse = true, isLimited = false, priority = 1 }
selfRes = { option }
reset(true) wipeOn(fangs, 0) step(2)
check("a self-resurrect at the end: not released", repops == 0)
selfRes = {}
reset(true) wipeOn(fangs, 0) step(0.2) selfRes = { option } step(2)
check("a self-resurrect by the time the delay ends: not released", repops == 0)
for _, case in ipairs({ { {}, "empty" }, { nil, "nil" } }) do
  selfRes = case[1]
  reset(true) wipeOn(fangs, 0) step(2)
  check("self-resurrect options " .. case[2] .. ": released", repops == 1, repops)
end
selfRes = SECRET
reset(true) wipeOn(fangs, 0) step(2)
check("a secret self-resurrect answer holds, no error", repops == 0)
selfRes = "error"
reset(true) wipeOn(fangs, 0) step(2)
check("a self-resurrect call that errors holds", repops == 0)
selfRes = nil
local keepDeath = C_DeathInfo
C_DeathInfo = {}
reset(true) wipeOn(fangs, 0) step(2)
check("no GetSelfResurrectOptions on the client: released", repops == 1, repops)
C_DeathInfo = nil
reset(true) wipeOn(fangs, 0) step(2)
check("no C_DeathInfo on the client: released", repops == 1, repops)
C_DeathInfo = keepDeath
-- Raids only: Alex, 2026-11-02, "Raids only" (IsInInstance's instanceType "raid")
for _, case in ipairs({ { "party", "a dungeon (party) wipe" }, { "none", "outside an instance" }, { "scenario", "a scenario" },
    { SECRET, "a secret instance type" }, { "error", "an IsInInstance error" } }) do
  instanceType = case[1]
  reset(true) wipeOn(fangs, 0) step(2)
  check(case[2] .. ": not released", repops == 0, repops)
end
instanceType = "raid"
reset(true) wipeOn(fangs, 0) step(0.2) instanceType = "none" step(2)
check("left the raid by the time the delay ends: not released", repops == 0)
instanceType = "raid"
local keepInstance = IsInInstance
IsInInstance = nil
reset(true) wipeOn(fangs, 0) step(2)
check("no IsInInstance on the client: not released", repops == 0)
IsInInstance = keepInstance
reset(true) wipeOn(fangs, 0) step(2)
check("a raid wipe: released", repops == 1, repops)
reset(true) wipeOn(nil, 0) wipeOn(fangs, nil) wipeOn(SECRET, 0) wipeOn(fangs, SECRET) step(2)
check("a nil or secret encounter or result: nothing, no error", repops == 0)
reset(true) dead = SECRET wipeOn(fangs, 0) step(2)
check("a secret death state: not released, no error", repops == 0)
reset(true) wipeOn(fangs, 0) wipeOn(fangs, 0) step(2)
check("two ends at once: released once", repops == 1, repops)
reset(true) local keep = RepopMe RepopMe = nil wipeOn(fangs, 0)
local okNo, errNo = pcall(step, 2)
check("RepopMe missing: no error", okNo, errNo)
RepopMe = keep
reset(true) RepopMe = function() error("blocked") end wipeOn(fangs, 0)
local okErr, errErr = pcall(step, 2)
check("RepopMe erroring: no error out", okErr, errErr)
RepopMe = keep
local code = releaseSrc:gsub("%-%-[^\n]*", "")
check("the file names no boss and reads no boss data (the ticks are the player's)", not code:find("Twin Fangs", 1, true) and not code:find("3421", 1, true)
  and not code:find("Bosses:Get", 1, true) and not code:find("AutoRelease", 1, true))

-- Quality of Life: its tabs, and no release box ----------------------------------------------------------
local helps, tabs, build = {}, {}, nil
CRT.UI = {
  RegisterPage = function(_, key, title, fn) build = fn end,
  Dropdown = function() local r = mock() r.refresh = function() end return r end,
  Slider = function() local r = mock() r.refresh = function() end return r end,
  HelpRight = function(target, title, text) helps[#helps + 1] = { target = target, title = title, text = text } return mock() end,
  PreviewButton = function() return mock() end,
  RegisterTab = function(_, b) tabs[#tabs + 1] = b end, SetTabSelected = function() end,
  GoodText = function(s) return s end, BadText = function(s) return s end,
}
CRT.LowHealth = {}
CRT.LowHealthSound = { StopPreview = function() end }
CRT.DebuffsPage = { Build = function() end }
CRT.BreakFormats = { FORMATS = {} }
CRT.Sound = { VoiceChoices = function() return {} end, VoiceKey = function() return "tts" end, CustomFiles = function() return {} end }
CRT.db.sound = {}
assert(load(pageSrc, "@Page.lua"))("CowfeeRaidTools", CRT)
build(mock())
local labels = {}
for _, b in ipairs(tabs) do labels[#labels + 1] = tostring(b.text and rawget(b.text, "text")) end
check("Quality of Life has its five tabs, no Settings", table.concat(labels, ",") == "Low health,Debuffs,Break timer,Battle res,Sounds", table.concat(labels, ","))
local box = false
for _, h in ipairs(helps) do if tostring(h.title):find("elease", 1, true) then box = true end end
check("and no release box or (?)", not box and not pageSrc:find("autoRelease", 1, true))
print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error(failed .. " checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
const read = (f) => { const p = path.join(d, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
// the registry with each shipped pack's files in its Season.xml order
const pack = ['CRT_Data/Bosses/Registry.lua'];
const seasons = path.join(d, 'CRT_Data/Seasons');
for (const p of fs.readdirSync(seasons).sort()) {
  const xml = path.join(seasons, p, 'Season.xml');
  if (!fs.existsSync(xml)) continue;
  const text = fs.readFileSync(xml, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of text.matchAll(/<Script\s+file="([^"]+)"\s*\/>/g)) pack.push('CRT_Data/Seasons/' + p + '/' + m[1].replace(/\\/g, '/'));
}
if (!lua.lua_checkstack(L, 2 * pack.length + 8)) { console.error('LUA ERROR: no stack room'); process.exit(1); }
for (const s of [read('CRT_Core/Core.lua'), read('CRT_Modules/Alerts/InstantRelease.lua'), read('CRT_Modules/QoL/Page.lua')]) lua.lua_pushstring(L, to_luastring(s));
lua.lua_pushinteger(L, pack.length);
for (const f of pack) { lua.lua_pushstring(L, to_luastring(f)); lua.lua_pushstring(L, to_luastring(read(f))); }
if (lua.lua_pcall(L, 4 + 2 * pack.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
