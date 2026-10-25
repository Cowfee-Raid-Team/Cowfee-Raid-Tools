// CRT_Dev/Dev/AbsorbProbe.lua on mock events: /crt dev absorbprobe logs, during one pull, what a boss's absorb shield
// gives under secret values: UnitGetTotalAbsorbs, the boss's helpful auras, the number formatters, a status bar and
// UnitCastingInfo. Secret values are proxies that raise an error on any use the game forbids (arithmetic, comparison,
// indexing, concatenation, calling, tostring), so code that touches one before its secret check fails the check.
// usage: node run_absorbprobe.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local probeSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

local SECRET = {}
local function forbidden() error("used a secret value") end
SECRET.__index = forbidden
SECRET.__newindex = forbidden
SECRET.__len = forbidden
SECRET.__concat = forbidden
SECRET.__lt = forbidden
SECRET.__le = forbidden
SECRET.__eq = forbidden
SECRET.__add = forbidden
SECRET.__sub = forbidden
SECRET.__mul = forbidden
SECRET.__div = forbidden
SECRET.__unm = forbidden
SECRET.__call = forbidden
SECRET.__tostring = forbidden
local function secret(v) return setmetatable({ inner = v }, SECRET) end
function issecretvalue(v) return getmetatable(v) == SECRET end
-- The game's type() reports the real type of a secret value.
local realType = type
function type(v) if getmetatable(v) == SECRET then return realType(rawget(v, "inner")) end return realType(v) end

local frame, barFrame
function CreateFrame(kind)
  local f = { events = {}, kind = kind, shown = true }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  function f:UnregisterAllEvents() self.events = {} end
  function f:SetScript(n, fn) self[n] = fn end
  function f:Hide() self.shown = false end
  if kind == "StatusBar" then
    barFrame = f
    f.calls = {}
    function f:SetMinMaxValues(a, b) f.calls[#f.calls + 1] = "minmax" end
    function f:SetValue(v) f.calls[#f.calls + 1] = "value" end
  else
    frame = f
  end
  return f
end
local now = 100
function GetTime() return now end
function time() return 1792540800 end
date = os.date

-- Game state the fakes read.
local absorbs = {}
function UnitGetTotalAbsorbs(u) return absorbs[u] end
function canaccessvalue(v) return not issecretvalue(v) end
local auras = {}
C_UnitAuras = { GetAuraDataByIndex = function(u, i, filter) return auras[u] and auras[u][i] end }
-- The native formatter takes a secret and gives a secret string; the large-number one refuses it.
function AbbreviateNumbers(v) if issecretvalue(v) then return secret("1.2M") end return "1.5M" end
function AbbreviateLargeNumbers(v) if issecretvalue(v) then error("bad argument: secret") end return "1.5M" end
local casting = {}
function UnitCastingInfo(u) local c = casting[u] if not c then return nil end return c.name, c.name, 1, c.start, c["end"] end

local printed, shown = {}, nil
local CRT = { db = { dev = {} } }
function CRT:Print(s) printed[#printed + 1] = s end
CRT.ConsumablesTools = { ShowText = function(_, title, text) shown = { title = title, text = text } end }
assert(load(probeSrc, "AbsorbProbe.lua"))("CowfeeRaidTools", CRT)
local P = CRT.AbsorbProbe
local function fire(e, ...) if frame and frame.OnEvent then frame.OnEvent(frame, e, ...) end end
local function log() local l = CRT.db.dev.absorbProbe and CRT.db.dev.absorbProbe.last return l and l.lines or {} end
local function has(s) for _, l in ipairs(log()) do if l:find(s, 1, true) then return true end end return false end
local function countOf(s) local n = 0 for _, l in ipairs(log()) do if l:find(s, 1, true) then n = n + 1 end end return n end

-- Off: nothing is logged.
fire("ENCOUNTER_START", 3001, "Sszorak", 16, 20)
check(#log() == 0, "off: a pull logs nothing")
check(P:Command("dev absorbprobe on") and CRT.db.dev.absorbProbe.on == true, "/crt dev absorbprobe on turns it on, saved")
check(P:Command("dev clearprobe on") == false and P:Command("dev markers") == false, "another command is not the probe's")
check(frame.events.ENCOUNTER_START and frame.events.ENCOUNTER_END and not frame.events.UNIT_AURA, "on: it listens for the pull; unit events wait for it")
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(#log() == 0, "nothing is logged before the pull")

-- The pull.
now = 200
fire("ENCOUNTER_START", 3001, "Sszorak", 16, 20)
check(log()[1] == '+0.0 ENCOUNTER_START encounterID=3001 name="Sszorak" difficultyID=16 groupSize=20', "the pull's first line: " .. tostring(log()[1]))
check(has("APIS UnitGetTotalAbsorbs=true AbbreviateNumbers=true AbbreviateLargeNumbers=true issecretvalue=true canaccessvalue=true UnitCastingInfo=true C_UnitAuras.GetAuraDataByIndex=true"), "the APIS line says which functions exist")
check(frame.events.UNIT_ABSORB_AMOUNT_CHANGED and frame.events.UNIT_AURA and frame.events.UNIT_SPELLCAST_START, "during the pull it listens to the unit events")
check(barFrame == nil, "no status bar is made before a value comes")

-- A readable absorb: the first one also runs the formatter and bar probes, once.
now = 203.4
absorbs.boss1 = 5000000
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(has('+3.4 UNIT_ABSORB_AMOUNT_CHANGED unit="boss1" total=5000000 type="number" secret=false canaccess=true'), "a readable absorb as it came, with its type and canaccessvalue")
check(has('FORMAT kind="readable" fn="AbbreviateNumbers" ok=true result="1.5M" type="string" secret=false'), "AbbreviateNumbers on a readable value")
check(has('FORMAT kind="readable" fn="AbbreviateLargeNumbers" ok=true result="1.5M"'), "AbbreviateLargeNumbers on a readable value")
check(has('FORMAT kind="readable" fn="string.format %d" ok=true result="5000000"') and has('FORMAT kind="readable" fn="tostring" ok=true result="5000000"'), "string.format and tostring on a readable value")
check(has('BAR kind="readable" SetMinMaxValues=true SetValue=true') and barFrame.shown == false and #barFrame.calls == 2, "the hidden status bar took the value")
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(countOf('FORMAT kind="readable" fn=') == 4 and countOf(' BAR kind="readable"') == 1, "the readable formatter and bar probes run once per pull")

-- A secret absorb: logged as <secret>, nothing compared, errors recorded.
absorbs.boss1 = secret(4000000)
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(has("UNIT_ABSORB_AMOUNT_CHANGED unit=\\"boss1\\" total=<secret> type=\\"number\\" secret=true canaccess=false"), "a secret absorb: <secret>, type number, canaccessvalue false")
absorbs.boss2 = nil
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss2")
check(has('unit="boss2" total=nil type="nil" secret=false'), "a boss with no absorb value: nil")
local n = #log()
fire("UNIT_ABSORB_AMOUNT_CHANGED", "raid4")
fire("UNIT_ABSORB_AMOUNT_CHANGED", "player")
fire("UNIT_AURA", "party2", {})
fire("UNIT_SPELLCAST_START", "boss2", "Cast-1", 111)
check(#log() == n, "other units' events, and boss2's cast, are left out")
fire("UNIT_ABSORB_AMOUNT_CHANGED", secret("boss1"))
fire("UNIT_ABSORB_AMOUNT_CHANGED", secret("boss1"))
check(#log() == n + 1 and has("UNIT_ABSORB_AMOUNT_CHANGED unit=<secret>"), "a secret unit is logged once per event: it might be a boss")

-- The first absorb of a pull being secret: the formatters see the secret.
now = 300
fire("ENCOUNTER_END", 3001, "Sszorak", 16, 20, 0)
check(log()[#log()]:find("ENCOUNTER_END encounterID=3001 success=0", 1, true) and not frame.events.UNIT_AURA and frame.events.ENCOUNTER_START, "after the pull: unit events dropped, still on for the next")
n = #log()
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(#log() == n, "nothing is logged after the pull")

now = 400
absorbs.boss1 = secret(7000000)
fire("ENCOUNTER_START", 3002, "Other", 16, 20)
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(has('FORMAT kind="secret" fn="AbbreviateNumbers" ok=true result=<secret> type="string" secret=true'), "AbbreviateNumbers takes a secret and gives a secret string")
check(has('FORMAT kind="secret" fn="AbbreviateLargeNumbers" ok=false error="'), "AbbreviateLargeNumbers refusing a secret: the error text is logged")
check(has('FORMAT kind="secret" fn="string.format %d" ok=false error="') and has('FORMAT kind="secret" fn="tostring" ok=false error="'), "string.format and tostring refusing a secret: the error text is logged")
check(has('BAR kind="secret" SetMinMaxValues=true SetValue=true'), "the status bar takes a secret")
check(#log() > 5 and not has("3001"), "the next pull replaces the last one")

-- A bar that refuses the secret.
barFrame.SetMinMaxValues = function() error("secret not allowed here") end
now = 410
fire("ENCOUNTER_END", 3002, "Other", 16, 20, 1)
fire("ENCOUNTER_START", 3003, "Third", 16, 20)
absorbs.boss1 = secret(1)
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(has('BAR kind="secret" SetMinMaxValues=false minMaxError="'), "a bar that refuses: ok false and the error text")

-- Auras: readable, secret points, a secret table, once per spell per 5 s.
now = 500
fire("ENCOUNTER_END", 3003, "Third", 16, 20, 1)
fire("ENCOUNTER_START", 3004, "Fourth", 16, 20)
auras.boss1 = {
  { spellId = 1111, name = "Veil of Twilight", points = { secret(900000), 5 } },
  { spellId = secret(2222), name = secret("Hidden"), points = secret({}) },
  secret({}),
}
now = 501
fire("UNIT_AURA", "boss1", { isFullUpdate = true })
check(has('+1.0 UNIT_AURA unit="boss1" index=1 auraSecret=false spellId=1111 name="Veil of Twilight" points={<secret>,5}'), "an aura: spell, name, points each readable or <secret>: " .. tostring(log()[#log() - 2]))
check(has("index=2 auraSecret=false spellId=<secret> name=<secret> points=<secret>"), "an aura whose fields are secret")
check(has("UNIT_AURA unit=\\"boss1\\" index=3 auraSecret=true"), "an aura table that is secret whole")
check(countOf("UNIT_AURA unit=") == 3, "three aura lines")
now = 504
fire("UNIT_AURA", "boss1", {})
check(countOf("UNIT_AURA unit=") == 3 and CRT.db.dev.absorbProbe.last.throttled == 3, "the same spells within 5 s are not logged again, and counted")
now = 507
fire("UNIT_AURA", "boss1", {})
check(countOf("UNIT_AURA unit=") == 6, "after 5 s they are logged again")
auras.boss1 = nil
fire("UNIT_AURA", "boss1", {})
auras.boss3 = {}
for i = 1, 60 do auras.boss3[i] = { spellId = 10000 + i, name = "A", points = {} } end
fire("UNIT_AURA", "boss3", {})
check(countOf('unit="boss3"') == 40, "at most 40 auras are read")
check(has('unit="boss3" index=1 auraSecret=false spellId=10001 name="A" points={}'), "an empty points list")

-- Casts: boss1 only; endTimeMs readable or secret.
casting.boss1 = { name = "Eternal Nightfall", start = 507000, ["end"] = 512500 }
now = 508
fire("UNIT_SPELLCAST_START", "boss1", "Cast-9", 333)
check(has('UNIT_SPELLCAST_START unit="boss1" name="Eternal Nightfall" startTimeMs=507000 endTimeMs=512500 endSecret=false castSeconds=5.5'), "a boss1 cast with readable times")
casting.boss1 = { name = secret("X"), start = secret(1), ["end"] = secret(2) }
fire("UNIT_SPELLCAST_START", "boss1", "Cast-10", 333)
check(has("UNIT_SPELLCAST_START unit=\\"boss1\\" name=<secret> startTimeMs=<secret> endTimeMs=<secret> endSecret=true") and not has("castSeconds=nan"), "a boss1 cast with secret times: no arithmetic on them")
casting.boss1 = nil
fire("UNIT_SPELLCAST_START", "boss1", "Cast-11", 333)
check(has('unit="boss1" name=nil startTimeMs=nil endTimeMs=nil endSecret=false'), "no cast: nil")

-- Show: a summary in chat and the whole log in a window to copy.
now = 600
fire("ENCOUNTER_END", 3004, "Fourth", 16, 20, 0)
printed = {}
P:Command("dev absorbprobe show")
check(shown and shown.title:find("Ctrl+C", 1, true) and shown.text:find("encounter 3004", 1, true) and shown.text:find("wipe", 1, true) and shown.text:find("UNIT_AURA unit", 1, true), "show: the log in a window to copy")
local summary = table.concat(printed, "|")
check(summary:find("UNIT_AURA: 46 (secret: name 2, points 4, spellId 2)", 1, true), "show: counts per kind, with the secret fields: " .. summary)
check(summary:find("UNIT_SPELLCAST_START: 3 (secret: endTimeMs 1, name 1, startTimeMs 1)", 1, true), "show: secret fields counted per kind: " .. summary)
check(summary:find("UNIT_ABSORB_AMOUNT_CHANGED", 1, true) == nil, "show: only the last pull is counted (no absorb event in the fourth)")
check(summary:find("APIS: 1 (all readable)", 1, true) and summary:find("ENCOUNTER_START: 1", 1, true), "show: every kind is counted")

-- Missing functions are logged and skipped.
P:Command("dev absorbprobe off")
check(CRT.db.dev.absorbProbe.on == false and next(frame.events) == nil, "off: listens to nothing")
check(CRT.db.dev.absorbProbe.last ~= nil, "off keeps the last log")
canaccessvalue, AbbreviateLargeNumbers, UnitCastingInfo, C_UnitAuras = nil, nil, nil, nil
barFrame = nil
P:Command("dev absorbprobe on")
now = 700
absorbs.boss1 = 42
fire("ENCOUNTER_START", 3005, "Fifth", 16, 20)
check(has("canaccessvalue=false") and has("UnitCastingInfo=false") and has("C_UnitAuras.GetAuraDataByIndex=false"), "the APIS line names the missing functions")
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
fire("UNIT_AURA", "boss1", {})
fire("UNIT_SPELLCAST_START", "boss1", "Cast-1", 1)
check(has('total=42 type="number" secret=false') and not has("canaccess=") and has('FORMAT kind="readable" fn="AbbreviateLargeNumbers" present=false'), "a missing function is skipped, the rest still runs")
check(countOf("UNIT_AURA") == 0 and countOf("UNIT_SPELLCAST_START") == 0, "no aura or cast line without their functions")

-- Two probe runs a pull at most: the first readable value that is not 0, and the first secret one.
fire("ENCOUNTER_END", 3005, "Fifth", 16, 20, 1)
fire("ENCOUNTER_START", 3007, "Seventh", 16, 20)
absorbs.boss1 = 0
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(has("total=0 type=\\"number\\" secret=false") and countOf("FORMAT ") == 0 and countOf("BAR ") == 0, "a readable 0 runs no probe: it must not use the slot")
absorbs.boss1 = 5000
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(countOf("FORMAT kind=\\"readable\\"") == 4 and countOf("BAR kind=\\"readable\\"") == 1 and has('kind="readable" fn="tostring" ok=true result="5000"'), "the first readable value that is not 0 runs the probes, tagged readable")
absorbs.boss1 = 6000
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
absorbs.boss1 = secret(7000)
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(countOf("UNIT_ABSORB_AMOUNT_CHANGED") == 4 and countOf("FORMAT kind=\\"secret\\"") == 4 and countOf("BAR kind=\\"secret\\"") == 1, "the first secret value runs them again, tagged secret")
absorbs.boss1 = secret(8000)
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
absorbs.boss1 = 9000
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
check(countOf("FORMAT ") == 8 and countOf("BAR ") == 2, "two runs a pull at most: " .. countOf("FORMAT ") .. " FORMAT lines, " .. countOf("BAR ") .. " BAR lines")

-- Each kind other than UNIT_AURA stops at its own cap, and the log says how many lines of it were dropped.
fire("ENCOUNTER_END", 3005, "Fifth", 16, 20, 1)
fire("ENCOUNTER_START", 3006, "Sixth", 16, 20)
for i = 1, P.KIND_MAX + 10 do fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1") end
fire("ENCOUNTER_END", 3006, "Sixth", 16, 20, 1)
check(P.MAX_LINES == 3000 and P.KIND_MAX == 600, "caps: 3000 aura lines, 600 of each other kind")
check(countOf("UNIT_ABSORB_AMOUNT_CHANGED unit=") == P.KIND_MAX and log()[#log()] == "... 10 more UNIT_ABSORB_AMOUNT_CHANGED lines dropped (the log keeps 600 of them)", "a kind is capped on its own: " .. tostring(log()[#log()]))

-- An aura error: one line per unit per pull, its count kept up to date, and the unit is not asked again.
local auraCalls = {}
C_UnitAuras = { GetAuraDataByIndex = function(u, i, filter)
  auraCalls[u] = (auraCalls[u] or 0) + 1
  if u == "boss2" then error("Auras cannot be accessed when secret while tainted by 'CowfeeRaidTools'") end
  return auras[u] and auras[u][i]
end }
auras.boss1 = { { spellId = 1111, name = "Veil", points = {} } }
auras.boss3 = { { spellId = 3333, name = "Odd", points = setmetatable({}, { __len = function() error("bad points") end }) } }
now = 800
fire("ENCOUNTER_START", 3008, "Eighth", 16, 20)
for i = 1, 50 do fire("UNIT_AURA", "boss2", {}) end
check(countOf('UNIT_AURA unit="boss2"') == 1 and auraCalls.boss2 == 1, "an aura error on every event: one line, and the unit is asked once: " .. countOf('UNIT_AURA unit="boss2"') .. " lines, " .. tostring(auraCalls.boss2) .. " calls")
check(has('UNIT_AURA unit="boss2" index=1 error="') and has("tainted by 'CowfeeRaidTools'\\" count=50"), "the line has the error and count=50")
fire("UNIT_AURA", "boss1", {})
check(has('UNIT_AURA unit="boss1" index=1 auraSecret=false spellId=1111'), "another unit's auras are still read")
fire("UNIT_AURA", "boss3", {})
fire("UNIT_AURA", "boss3", {})
check(countOf('UNIT_AURA unit="boss3"') == 1 and has('UNIT_AURA unit="boss3" error="') and has("bad points\\" count=2"), "any other error on the aura path: once per unit, counted")
fire("ENCOUNTER_END", 3008, "Eighth", 16, 20, 1)
now = 900
fire("ENCOUNTER_START", 3009, "Ninth", 16, 20)
fire("UNIT_AURA", "boss2", {})
check(auraCalls.boss2 == 2 and has('unit="boss2" index=1 error=') and has("count=1"), "the next pull asks again")
fire("ENCOUNTER_END", 3009, "Ninth", 16, 20, 1)

-- 3000 aura lines fill the aura cap; the absorb, FORMAT, BAR and cast lines after them are kept.
now = 1000
fire("ENCOUNTER_START", 3010, "Tenth", 16, 20)
auras.boss3 = {}
for i = 1, 40 do auras.boss3[i] = { spellId = 20000 + i, name = "B", points = {} } end
for i = 1, 80 do now = now + 6 fire("UNIT_AURA", "boss3", {}) end
absorbs.boss1 = 77000
fire("UNIT_ABSORB_AMOUNT_CHANGED", "boss1")
casting.boss1 = { name = "Late Cast", start = 1, ["end"] = 2 }
UnitCastingInfo = function(u) local c = casting[u] if not c then return nil end return c.name, c.name, 1, c.start, c["end"] end
fire("UNIT_SPELLCAST_START", "boss1", "Cast-20", 1)
fire("ENCOUNTER_END", 3010, "Tenth", 16, 20, 0)
check(countOf('UNIT_AURA unit="boss3"') == 3000, "aura lines stop at 3000: " .. countOf('UNIT_AURA unit="boss3"'))
check(has("UNIT_ABSORB_AMOUNT_CHANGED unit=\\"boss1\\" total=77000") and countOf('FORMAT kind="readable"') == 4 and countOf('BAR kind="readable"') == 1 and has('UNIT_SPELLCAST_START unit="boss1" name="Late Cast"'), "the absorb, FORMAT, BAR and cast lines after them are kept")
check(log()[#log()] == "... 200 more UNIT_AURA lines dropped (the log keeps 3000 of them)", "the end says which kind was capped: " .. tostring(log()[#log()]))
printed = {}
P:Command("dev absorbprobe show")
check(shown.text:find("Capped: UNIT_AURA 200 past 3000", 1, true) ~= nil, "the header says which kind was capped")
check(table.concat(printed, "|"):find("UNIT_AURA: 3200 (all readable), 200 past the cap", 1, true) ~= nil, "the chat summary too: " .. table.concat(printed, "|"))

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Dev/Dev/AbsorbProbe.lua', 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
