// CRT_Modules/QoL/AutoRelease.lua: Release my spirit after a wipe. With the setting on, a wipe (ENCOUNTER_END success 0)
// on a boss whose file has autoRelease = true, while you are dead and not a ghost, calls RepopMe once, RELEASE_DELAY
// seconds later, after checking again. Never after a kill, on another boss, with the setting off, alive, as a ghost, with
// a resurrection on the way or offered, or with a nil or secret encounter. Also the boss library's accessors
// (Bosses:AutoRelease, Bosses:AutoReleaseNames) on the sample pack (CRT_Dev/Tests/SamplePack) with test bosses, the
// default in Core.lua (off), the check box on Quality of Life > Settings with its (?), which names the bosses from the
// data, and, apart, which shipped bosses have the field (that check changes at a season rollover).
// Usage: node run_autorelease.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = String.raw`
local coreText, releaseSrc, pageSrc, nSample, nShipped = ...
local args = { select(6, ...) }
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
corpseDelay = nil -- what GetCorpseRecoveryDelay gives (nil: 0)
function GetCorpseRecoveryDelay() return corpseDelay or 0 end
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
local CRT = { db = { qol = { lowHealth = {}, breakTimer = {} }, dev = {} } }
function CRT:Print() end

-- The boss library on the sample pack, and test bosses -----------------------------------------------------------
local function loadFiles(into, from, n)
  for i = from, from + n - 1 do
    local name, src = args[2 * i - 1], args[2 * i]
    local ok, err = pcall(function() assert(load(src, "@" .. name))("CowfeeRaidTools", into) end)
    if not ok then check(name .. " loads", false, err) end
  end
end
loadFiles(CRT, 1, nSample)
local B = CRT.Bosses
check("the sample pack loads", B ~= nil and #B:List() > 0)
-- a boss of the sample route with the field, and one of a season that isn't loaded
local fangs, other, oldBoss = 3421, 3470, 9001
B:Register({ encounterID = fangs, name = "Sample Release Boss", season = "sample", autoRelease = true })
B:Season({ key = "old", name = "Old Season", order = 0, current = false, raids = { { key = "old", name = "Old Raid", bosses = { oldBoss } } } })
B:Register({ encounterID = oldBoss, name = "Old Release Boss", season = "old", autoRelease = true })
check("Bosses:AutoRelease: a boss with it is true", type(B.AutoRelease) == "function" and B:AutoRelease(fangs) == true)
if type(B.AutoRelease) ~= "function" then print(passed .. " passed, " .. failed .. " failed") error("no accessor") end
check("Bosses:AutoRelease: a boss without the field is false", B:Get(other) ~= nil and B:AutoRelease(other) == false)
check("Bosses:AutoRelease: an unknown or nil ID is false", B:AutoRelease(1) == false and B:AutoRelease(nil) == false)
check("Bosses:AutoRelease: a boss of a season that isn't loaded is false", B:AutoRelease(oldBoss) == false)
local names = type(B.AutoReleaseNames) == "function" and B:AutoReleaseNames() or {}
check("Bosses:AutoReleaseNames lists the loaded bosses with it", #names == 1 and names[1] == "Sample Release Boss", table.concat(names, ","))

-- The shipped packs: which bosses have autoRelease. Shipped data, so this check changes at a season rollover (or when
-- Alex asks for another boss): The Twin Fangs was Alex's request on 2026-11-02. It reads the field over every pack's
-- bosses, loaded or not, so a new current season alone doesn't break it.
do
  local shipped = {}
  loadFiles(shipped, nSample + 1, nShipped)
  local with = {}
  for _, def in ipairs(shipped.Bosses and shipped.Bosses:List() or {}) do if def.autoRelease == true then with[#with + 1] = def.name end end
  check("shipped: only The Twin Fangs has autoRelease", #with == 1 and with[1] == "The Twin Fangs", table.concat(with, ","))
end

-- The default: off -------------------------------------------------------------------------------------------
local qol = coreText:match("\n    qol = (%b{})")
check("Core.lua's qol defaults have autoRelease = false", qol ~= nil and qol:find("\n        autoRelease = false,", 1, true) ~= nil)
CRT.db.qol.autoRelease = false

-- The behaviour ----------------------------------------------------------------------------------------------
local ok, err = pcall(function() assert(load(releaseSrc, "@AutoRelease.lua"))("CowfeeRaidTools", CRT) end)
check("AutoRelease.lua loads", ok and CRT.AutoRelease ~= nil, err)
if not (ok and CRT.AutoRelease) then print(passed .. " passed, " .. failed .. " failed") error("no module") end
local AR = CRT.AutoRelease
check("the delay is half a second", AR.RELEASE_DELAY == 0.5, AR.RELEASE_DELAY)
local function reset(on) dead, ghost, incoming, repops, timers = true, false, false, 0, {} CRT.db.qol.autoRelease = on end
local function wipeOn(id, success) fire("ENCOUNTER_END", id, "Boss", 16, 20, success) end

reset(true)
wipeOn(fangs, 0)
check("on, a wipe on an autoRelease boss while dead: not released at once", repops == 0)
step(0.4)
check("not before the delay", repops == 0)
step(0.1)
check("released once after half a second", repops == 1, repops)
step(5)
check("only once", repops == 1, repops)

reset(true) wipeOn(fangs, 1) step(2)
check("a kill: not released", repops == 0)
reset(true) wipeOn(other, 0) step(2)
check("a boss without autoRelease: not released", repops == 0)
reset(false) wipeOn(fangs, 0) step(2)
check("the setting off: not released", repops == 0)
reset(nil) wipeOn(fangs, 0) step(2)
check("the setting unset: not released", repops == 0)
reset(true) dead = false wipeOn(fangs, 0) step(2)
check("alive at the end: not released", repops == 0)
reset(true) dead, ghost = false, true wipeOn(fangs, 0) step(2)
check("already a ghost at the end: not released", repops == 0)
reset(true) wipeOn(fangs, 0) step(0.2) dead = false step(2)
check("alive again by the time the delay ends: not released", repops == 0)
reset(true) wipeOn(fangs, 0) step(0.2) dead, ghost = false, true step(2)
check("a ghost by the time the delay ends: not released", repops == 0)
reset(true) wipeOn(fangs, 0) step(0.2) CRT.db.qol.autoRelease = false step(2)
check("turned off during the delay: not released", repops == 0)
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
check("the file names no boss and no encounter ID", not code:find("Twin Fangs", 1, true) and not code:find("3421", 1, true))

-- Quality of Life > Settings: the check box and its (?) ----------------------------------------------------------
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
local page = mock()
build(page)
check("the last tab is Settings", #tabs >= 1 and rawget(tabs[#tabs].text or {}, "text") == "Settings", tabs[#tabs] and tabs[#tabs].text and rawget(tabs[#tabs].text, "text"))
local help
for _, h in ipairs(helps) do if h.title == "Release my spirit after a wipe" then help = h end end
check("the check box has its (?)", help ~= nil and rawget(help.target, "text") == "Release my spirit after a wipe")
local function read() local t = help and (type(help.text) == "function" and help.text() or help.text) return type(t) == "string" and t or "" end
check("its (?) says what it does", read() == "On bosses set up for it (Sample Release Boss), releases your spirit half a second after a wipe. Never after a kill.", read())
local was = B.AutoReleaseNames
B.AutoReleaseNames = function() return { "Boss A", "Boss B" } end
check("the names come from the data", read():find("(Boss A, Boss B)", 1, true) ~= nil, read())
B.AutoReleaseNames = was
local box
for _, f in ipairs(frames) do if rawget(f, "label") and rawget(f.label, "text") == "Release my spirit after a wipe" then box = f end end
check("the check box is there", box ~= nil and box.OnClick ~= nil)
if box then
  CRT.db.qol.autoRelease = false
  page.OnShow(page)
  check("it shows the saved setting (off)", box.checked == false)
  box.checked = true
  box.OnClick(box)
  check("ticking it saves autoRelease = true", CRT.db.qol.autoRelease == true)
  box.checked = false
  box.OnClick(box)
  check("unticking it saves false", CRT.db.qol.autoRelease == false)
end
print(passed .. " passed, " .. failed .. " failed")
if failed > 0 then error(failed .. " checks failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
const read = (f) => { const p = path.join(d, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
// the sample pack (the tests' own season), then the registry again with each shipped pack's files in its Season.xml order
const sample = ['CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/NekzaliTheSoulcoiler.lua', 'CRT_Dev/Tests/SamplePack/Sszorak.lua'];
const pack = ['CRT_Data/Bosses/Registry.lua'];
const seasons = path.join(d, 'CRT_Data/Seasons');
for (const p of fs.readdirSync(seasons).sort()) {
  const xml = path.join(seasons, p, 'Season.xml');
  if (!fs.existsSync(xml)) continue;
  const text = fs.readFileSync(xml, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of text.matchAll(/<Script\s+file="([^"]+)"\s*\/>/g)) pack.push('CRT_Data/Seasons/' + p + '/' + m[1].replace(/\\/g, '/'));
}
const files = sample.concat(pack);
if (!lua.lua_checkstack(L, 2 * files.length + 8)) { console.error('LUA ERROR: no stack room'); process.exit(1); }
for (const s of [read('CRT_Core/Core.lua'), read('CRT_Modules/QoL/AutoRelease.lua'), read('CRT_Modules/QoL/Page.lua')]) lua.lua_pushstring(L, to_luastring(s));
lua.lua_pushinteger(L, sample.length);
lua.lua_pushinteger(L, pack.length);
for (const f of files) { lua.lua_pushstring(L, to_luastring(f)); lua.lua_pushstring(L, to_luastring(read(f))); }
if (lua.lua_pcall(L, 5 + 2 * files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
