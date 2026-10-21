// CRT_Dev/Dev/ClearProbe.lua on mock events: /crt dev clearprobe logs, during one pull, every event that could mark a
// boss's reset, with the time from the pull and each value as it came or <secret>. Secret values are proxies that
// raise an error on any use the game forbids, so code that reads one fails the check.
// usage: node run_clearprobe.js <addon folder>
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
SECRET.__len = forbidden
SECRET.__concat = forbidden
SECRET.__lt = forbidden
SECRET.__le = forbidden
SECRET.__eq = forbidden
SECRET.__add = forbidden
SECRET.__sub = forbidden
SECRET.__call = forbidden
local function secret(v) return setmetatable({ inner = v }, SECRET) end
function issecretvalue(v) return getmetatable(v) == SECRET end

local frame
function CreateFrame()
  local f = { events = {} }
  function f:RegisterEvent(e) self.events[e] = true end
  function f:UnregisterEvent(e) self.events[e] = nil end
  function f:UnregisterAllEvents() self.events = {} end
  function f:SetScript(n, fn) self[n] = fn end
  frame = f
  return f
end
local now = 100
function GetTime() return now end
function time() return 1792540800 end
date = os.date
local states, tracks = {}, {}
C_EncounterTimeline = { GetEventState = function(id) return states[id] end, GetEventTrack = function(id) return tracks[id], 1 end }
C_Spell = { GetSpellName = function(id) return id == 111 and "Arena Reset" or nil end }
local exists = { boss1 = true }
function UnitExists(u) return exists[u] or false end
function UnitGUID(u) return exists[u] and secret("Creature-0-1") or nil end
function UnitName(u) return exists[u] and "Sszorak" or nil end
function UnitCanAttack(a, u) return u == "boss1" end
local health = {}
function UnitHealthPercent(u) return health[u] end

local printed, shown = {}, nil
local CRT = { db = { dev = {} } }
function CRT:Print(s) printed[#printed + 1] = s end
CRT.ConsumablesTools = { ShowText = function(_, title, text) shown = { title = title, text = text } end }
local listeners, phase = {}, nil
CRT.Alerts = { OnChange = function(_, fn) listeners[#listeners + 1] = fn end, CurrentPhase = function() return phase end }
assert(load(probeSrc, "ClearProbe.lua"))("CowfeeRaidTools", CRT)
local P = CRT.ClearProbe
local function fire(e, ...) if frame and frame.OnEvent then frame.OnEvent(frame, e, ...) end end
local function log() local l = CRT.db.dev.clearProbe and CRT.db.dev.clearProbe.last return l and l.lines or {} end
local function has(s) for _, l in ipairs(log()) do if l:find(s, 1, true) then return true end end return false end

-- Off: nothing is logged.
fire("ENCOUNTER_START", 3001, "Sszorak", 16, 20)
check(#log() == 0, "off: a pull logs nothing")
check(P:Command("dev clearprobe on") and CRT.db.dev.clearProbe.on == true, "/crt dev clearprobe on turns it on, saved")
check(P:Command("dev markers") == false, "another command is not the probe's")
check(frame.events.ENCOUNTER_START and frame.events.CHAT_MSG_RAID_BOSS_EMOTE and not frame.events.UNIT_HEALTH, "on: it listens for the pull; unit events wait for it")
fire("CHAT_MSG_RAID_BOSS_EMOTE", "before the pull", "Sszorak")
check(#log() == 0, "nothing is logged before the pull")

-- The pull.
now = 200
fire("ENCOUNTER_START", 3001, "Sszorak", 16, 20)
check(log()[1] == '+0.0 ENCOUNTER_START encounterID=3001 name="Sszorak" difficultyID=16 groupSize=20', "the pull's first line: " .. tostring(log()[1]))
check(frame.events.UNIT_SPELLCAST_SUCCEEDED and frame.events.UNIT_HEALTH, "during the pull it listens to boss units' events")
now = 212.34
fire("CHAT_MSG_RAID_BOSS_EMOTE", secret("The arena resets!"), secret("Sszorak"), "", "")
check(log()[2] == "+12.3 CHAT_MSG_RAID_BOSS_EMOTE text=<secret> sender=<secret>", "a secret emote: " .. tostring(log()[2]))
fire("RAID_BOSS_EMOTE", "The arena|nresets!", "Sszorak", 5, true)
check(has('RAID_BOSS_EMOTE text="The arena|nresets!" sender="Sszorak" displayTime=5'), "a readable emote is logged as it came")
fire("CHAT_MSG_MONSTER_YELL", "Line one\\nline two", "Sszorak")
check(has('CHAT_MSG_MONSTER_YELL text="Line one line two"'), "a line break in a text becomes a space, one line per event")
fire("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 7, source = 0, spellID = secret(111), spellName = secret("Arena Reset"), duration = 30, isApproximate = false })
check(has("ENCOUNTER_TIMELINE_EVENT_ADDED id=7 source=0 spellID=<secret> spellName=<secret> duration=30 isApproximate=false"), "a timeline event: its fields, secret or not")
fire("ENCOUNTER_TIMELINE_EVENT_ADDED", secret({}))
check(has("ENCOUNTER_TIMELINE_EVENT_ADDED info=<secret>"), "a secret timeline info table")
states[7] = 2
fire("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 7)
check(has("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED eventID=7 state=2"), "a state change, read with GetEventState")
tracks[7] = secret(1)
fire("ENCOUNTER_TIMELINE_EVENT_TRACK_CHANGED", 7)
check(has("ENCOUNTER_TIMELINE_EVENT_TRACK_CHANGED eventID=7 track=<secret>"), "a track change, read with GetEventTrack")
fire("ENCOUNTER_TIMELINE_EVENT_HIGHLIGHT", 7)
fire("ENCOUNTER_TIMELINE_VIEW_ACTIVATED", 1)
check(has("ENCOUNTER_TIMELINE_EVENT_HIGHLIGHT eventID=7") and has("ENCOUNTER_TIMELINE_VIEW_ACTIVATED viewType=1"), "highlight and view events")
fire("UNIT_SPELLCAST_SUCCEEDED", "boss1", "Cast-1", 111)
check(has('UNIT_SPELLCAST_SUCCEEDED unit="boss1" spellID=111 spell="Arena Reset"'), "a boss cast with its spell name")
fire("UNIT_SPELLCAST_START", "boss2", secret("Cast-2"), secret(111))
check(has('UNIT_SPELLCAST_START unit="boss2" spellID=<secret>'), "a boss cast with a secret spell")
local n = #log()
fire("UNIT_SPELLCAST_SUCCEEDED", "raid4", "Cast-3", 222)
fire("UNIT_HEALTH", "raid4")
check(#log() == n, "other units' casts and health are left out")
fire("UNIT_SPELLCAST_CHANNEL_START", secret("boss1"), "Cast-4", 333)
check(has("UNIT_SPELLCAST_CHANNEL_START unit=<secret> spellID=333"), "a cast whose unit is secret is kept, it might be the boss")
fire("UNIT_TARGETABLE_CHANGED", "boss1")
check(has('UNIT_TARGETABLE_CHANGED unit="boss1" exists=true canAttack=true'), "a boss's targetable change")
fire("INSTANCE_ENCOUNTER_ENGAGE_UNIT")
check(has('INSTANCE_ENCOUNTER_ENGAGE_UNIT boss1.name="Sszorak" boss1.guid=<secret>'), "engage: each boss unit there, name and GUID")
health.boss1 = 80
fire("UNIT_HEALTH", "boss1")
health.boss1 = 79.5
fire("UNIT_HEALTH", "boss1")
health.boss1 = 100
fire("UNIT_HEALTH", "boss1")
health.boss1 = 60
fire("UNIT_HEALTH", "boss1")
local healthLines = 0
for _, l in ipairs(log()) do if l:find("UNIT_HEALTH", 1, true) then healthLines = healthLines + 1 end end
check(healthLines == 3 and has('UNIT_HEALTH unit="boss1" percent=80') and has('UNIT_HEALTH unit="boss1" percent=100 jump="up"') and has('percent=60 jump="down"'), "boss health: the first value and each jump, not every tick")
health.boss2 = secret(50)
fire("UNIT_HEALTH", "boss2")
fire("UNIT_HEALTH", "boss2")
local secretHealth = 0
for _, l in ipairs(log()) do if l:find('UNIT_HEALTH unit="boss2" percent=<secret>', 1, true) then secretHealth = secretHealth + 1 end end
check(secretHealth == 1, "secret boss health is logged once")
phase = 2
for _, fn in ipairs(listeners) do fn() end
for _, fn in ipairs(listeners) do fn() end
local phaseLines = 0
for _, l in ipairs(log()) do if l:find("CRT_PHASE", 1, true) then phaseLines = phaseLines + 1 end end
check(phaseLines == 1 and has("CRT_PHASE phase=2"), "CRT's own phase change, once")
now = 300
fire("ENCOUNTER_END", 3001, "Sszorak", 16, 20, 0)
check(log()[#log()] == "+100.0 ENCOUNTER_END encounterID=3001 success=0", "the pull's last line: " .. tostring(log()[#log()]))
check(not frame.events.UNIT_HEALTH and frame.events.ENCOUNTER_START, "after the pull: unit events dropped, still on for the next")
n = #log()
fire("CHAT_MSG_RAID_BOSS_EMOTE", "after", "Sszorak")
check(#log() == n, "nothing is logged after the pull")

-- Show: a summary in chat and the whole log in a window to copy.
printed = {}
P:Command("dev clearprobe show")
check(shown and shown.title:find("Ctrl+C", 1, true) and shown.text:find("encounter 3001", 1, true) and shown.text:find("+12.3 CHAT_MSG_RAID_BOSS_EMOTE", 1, true), "show: the log in a window to copy")
local summary = table.concat(printed, "|")
check(summary:find("CHAT_MSG_RAID_BOSS_EMOTE: 1 (secret: sender 1, text 1)", 1, true) and summary:find("UNIT_TARGETABLE_CHANGED: 1 (all readable)", 1, true), "show: a summary per event in chat: " .. summary)

-- A new pull replaces the log; off stops listening.
now = 400
fire("ENCOUNTER_START", 3002, "Other", 16, 20)
check(#log() == 1 and log()[1]:find("3002", 1, true), "the next pull replaces the last one")
P:Command("dev clearprobe off")
check(CRT.db.dev.clearProbe.on == false and next(frame.events) == nil, "off: listens to nothing")
check(CRT.db.dev.clearProbe.last ~= nil, "off keeps the last log")

-- A long pull stops at the cap and says how many lines it dropped.
P:Command("dev clearprobe on")
fire("ENCOUNTER_START", 3001, "Sszorak", 16, 20)
for i = 1, P.MAX_LINES + 10 do fire("ENCOUNTER_TIMELINE_EVENT_HIGHLIGHT", i) end
fire("ENCOUNTER_END", 3001, "Sszorak", 16, 20, 1)
check(#log() == P.MAX_LINES + 1 and log()[#log()]:find("12 more lines dropped", 1, true), "the log is capped: " .. tostring(log()[#log()]))

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Dev/Dev/ClearProbe.lua', 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
