// An ignored mechanic plays no mechanic alerts (#1292): unticking a row on the Timeline (Timeline:SetIgnored) leaves
// that mechanic's Mech Alerts (your reminders) and its special alerts out of a pull, a rehearsal and the pull timer's
// countdown run, and out of the shield bar watches; raid note lines and your personal note still play. The engine
// reads the ignored list at a run's start and again when it changes mid-run (Alerts/Engine.lua, Timeline/Data.lua's
// IgnoreMatcher), matched by name, and a spell through the boss's ability timeline rows and the spell's own name.
// Usage: node run_alerts_ignored.js CRT_Modules/Timeline/Data.lua CRT_Modules/Timeline/Database.lua CRT_Modules/Timeline/Reference.lua
//   CRT_Modules/Timeline/Lanes.lua CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Alerts/Speech.lua
//   CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua CRT_Modules/Notes/Engine.lua CRT_Modules/Alerts/Reminders.lua
//   CRT_Modules/Alerts/Special.lua CRT_Modules/Alerts/Countdown.lua CRT_Data/Bosses/Registry.lua
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local sources = { ... }
local registry = table.remove(sources)
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
function InCombatLockdown() return false end
C_Timer = { After = function() end }
local clock = 100
function GetTime() return clock end
function issecretvalue() return false end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
function date() return "2026-11-15 12:00" end
function time() return 1000000 end
SOUNDKIT = { RAID_WARNING = 8959, READY_CHECK = 8960 }
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
C_VoiceChat = { SpeakText = function() end }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end,
  GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
function UnitName(u) if u == "player" then return "Cheoeqar" end end
function UnitGroupRolesAssigned() return "DAMAGER" end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
function UnitClass(u) if u == "player" then return "Mage", "MAGE", 8 end end
function IsInRaid() return true end
function GetNumGroupMembers() return 2 end
function UnitIsUnit(a, b) return a == "raid2" and b == "player" end
function GetRaidRosterInfo(i) if i == 2 then return "Cheoeqar", 0, 3 end return "Other", 0, 1 end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic" })[id] end

local CRT = {
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    notes = { list = {}, nextId = 1, trustedOnly = true,
      alert = { enabled = true, seconds = 10, tts = true, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" } },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1, special = {} },
  },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end, pages = {} },
  PlaySound = function() return 1 end,
}
function CRT:Print() end
CRT.TimelineJournal = { Rows = function() return {} end, IsHidden = function() return false end }
for i, src in ipairs(sources) do
  assert(load(src, "src" .. i))("CowfeeRaidTools", CRT)
end
local handler
local realCF = CreateFrame
CreateFrame = function() return { RegisterEvent = function() end, UnregisterEvent = function() end,
  SetScript = function(_, n, fn) if n == "OnEvent" then handler = fn end end } end
assert(load(registry, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
CreateFrame = realCF
local B, S, A, Ref, Notes, T = CRT.Bosses, CRT.AlertSpecial, CRT.Alerts, CRT.TimelineReference, CRT.Notes, CRT.Timeline
B:Season({ key = "T", name = "Test season", current = true, raids = { { key = "r", name = "Raid", bosses = { 9001 } } } })
local ALL = { callout = true, bar = true, text = true, speech = true }
B:Register({ encounterID = 9001, name = "Test Boss", season = "T", special = {
  { key = "orbs", label = "Orb soaks", when = { row = "Orb Burst" }, who = { mode = "everyone" }, default = true, show = ALL, text = "Soak" },
  { key = "slam", label = "Slam", when = { spellID = 5150 }, who = { mode = "everyone" }, default = true, show = ALL, text = "Slam" },
  { key = "veil", label = "Veil shield", when = { row = "Orb Burst" }, who = { mode = "everyone" }, default = true,
    show = { bar = true }, absorb = { unit = "boss2", length = 10 } },
  { key = "typed", label = "Typed", when = { times = "0:20" }, who = { mode = "everyone" }, default = true, show = ALL },
} })
handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Mythic\\nEncounter: 9001\\nLength: 4:00\\nOrb Burst: 0:30, 1:10\\nSwap [spell 4242]: 0:40, 1:40\\nSlam [spell 5150]: 0:50, 1:50"))
-- your Mech Alerts: one on the Swap ability by spell (with a shield bar), one on the spell-less Orb Burst row by name
local OUT = { alert = true, bar = true, speech = true, text = true }
CRT.db.alerts.reminders[9001] = {
  [1] = { spellID = 4242, text = "Swap now", group = "mythic", enabled = true, outputs = OUT, warn = 5,
    absorb = { unit = "boss3", length = 8 } },
  [2] = { text = "Orb Burst", group = "mythic", enabled = true, outputs = OUT, warn = 5 },
}
-- the raid note: a timed line on the Swap spell for everyone
Notes:Import("EncounterID:9001;Difficulty:Mythic;Name:Test Boss\\ntime:41;ph:1;tag:Cheoeqar;spellid:4242;text:Grab orb;\\n")

local ok_, fail = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then ok_ = ok_ + 1 print("ok " .. name) else fail = fail + 1 print("FAIL " .. name .. ": " .. tostring(err)) end
end
local function blocksOf(list)
  local seen = {}
  for _, it in ipairs(list) do
    local k = it.block == "special" and ("special:" .. tostring(it.special)) or it.block == "mine" and it.id:match("^(mine:%d+)") or it.block
    seen[k] = (seen[k] or 0) + 1
  end
  return seen
end
local function encounter() A:Start(9001, "Mythic", "encounter", { difficultyID = 16 }) end
local function clear()
  A:Stop(true)
  CRT.db.timeline.ignored = nil
end

check("ignored: nothing ignored, every mechanic alert plays", function()
  clear()
  encounter()
  local seen = blocksOf(A.items)
  assert(seen["special:orbs"] == 2 and seen["special:slam"] == 2 and seen["special:typed"] == 1, "the special alerts")
  -- the Orb Burst Mech Alert steps aside for the special alerts on the same row (no double alerts, #1306)
  assert(seen["mine:1"] == 2 and seen["mine:2"] == nil, "the Swap Mech Alert; the Orb Burst one covered by the special alerts")
  local saved = CRT.db.alerts.special
  CRT.db.alerts.special = { [9001] = { orbs = { on = false }, veil = { on = false } } }
  encounter()
  local off = blocksOf(A.items)["mine:2"]
  CRT.db.alerts.special = saved
  encounter()
  assert(off == 2, "Orb soaks and Veil shield off: the Orb Burst Mech Alert plays: " .. tostring(off))
  assert((seen.note or 0) >= 1, "the raid note line")
  local w = S:AbsorbWatches(A.run)
  assert(#w == 1 and w[1].key == "veil", "the special shield bar's watch")
  assert(#CRT.AlertReminders:AbsorbWatches(A.run) == 1, "your reminder's shield bar watch")
  assert(#errors == 0, tostring(errors[1]))
end)

check("ignored: a mechanic ticked off plays no Mech Alert or special alert; the raid note line still plays", function()
  clear()
  T:SetIgnored(9001, "Swap", true)
  encounter()
  local seen = blocksOf(A.items)
  assert(seen["mine:1"] == nil, "no Mech Alert on the Swap spell (mapped through its row)")
  assert(seen["special:orbs"] == 2 and seen["special:slam"] == 2 and seen["mine:2"] == nil and seen["special:typed"] == 1,
    "other mechanics play (the Orb Burst Mech Alert covered, as with nothing ignored)")
  assert((seen.note or 0) >= 1, "the raid note line on that spell still plays")
  -- nothing of it reaches the bars, the callout or the speech queue, which all read the run's lines
  A:StartPhase(1, "test", 0)
  for _, line in ipairs(A:Lines(clock)) do
    if line.spellID == 4242 then assert(line.block == "note", "only the note's line on Swap: " .. tostring(line.id)) end
  end
  assert(#CRT.AlertReminders:AbsorbWatches(A.run) == 0, "no shield bar watch for the ignored Mech Alert")
  assert(#errors == 0, tostring(errors[1]))
end)

check("ignored: a special alert on a spell, through the spell's row", function()
  clear()
  T:SetIgnored(9001, "Slam", true)
  encounter()
  local seen = blocksOf(A.items)
  assert(seen["special:slam"] == nil, "no special alert on the Slam spell")
  assert(seen["mine:1"] == 2 and seen["special:orbs"] == 2, "others play")
  assert(#errors == 0, tostring(errors[1]))
end)

check("ignored: by a row's name, the row's special alert and its shield bar watch go too", function()
  clear()
  T:SetIgnored(9001, "orb burst", true) -- any case, as the Timeline saves it
  encounter()
  local seen = blocksOf(A.items)
  assert(seen["special:orbs"] == nil and seen["mine:2"] == nil, "the Orb Burst special alert and Mech Alert are out")
  assert(seen["special:slam"] == 2 and seen["mine:1"] == 2, "Swap and Slam play")
  local w = S:AbsorbWatches(A.run)
  assert(#w == 0, "no shield bar watch for the row's special alert: " .. #w)
  assert(#errors == 0, tostring(errors[1]))
end)

check("ignored: a recorded pull's spell row (the spell's own name) counts for the same ability", function()
  clear()
  T:SetIgnored(9001, "Spell4242", true)
  T:SetIgnored(9001, "Spell5150", true)
  encounter()
  local seen = blocksOf(A.items)
  assert(seen["special:slam"] == nil and seen["mine:1"] == nil, "the spell's row name mutes its alerts")
  assert(seen["special:orbs"] == 2, "others play")
  assert(#errors == 0, tostring(errors[1]))
end)

check("ignored: ticking mid-run takes it out at once, and ticking it back brings it back", function()
  clear()
  encounter()
  local runId, v = A.runId, A.version
  T:SetIgnored(9001, "Swap", true)
  T:SetIgnored(9001, "Slam", true)
  local seen = blocksOf(A.items)
  assert(A.running and A.runId == runId, "the same run goes on")
  assert(A.version > v, "the lines are built again")
  assert(seen["special:slam"] == nil and seen["mine:1"] == nil and seen["special:orbs"] == 2, "taken out mid-run")
  T:SetIgnored(9001, "Swap", false)
  T:SetIgnored(9001, "Slam", false)
  seen = blocksOf(A.items)
  assert(seen["special:slam"] == 2 and seen["mine:1"] == 2, "ticked back: it plays again")
  -- another Timeline change (not the ignored list) changes nothing
  v = A.version
  T:Fire()
  assert(A.version == v, "only a change of the ignored list rebuilds")
  assert(#errors == 0, tostring(errors[1]))
end)

check("ignored: a rehearsal follows the same rule", function()
  clear()
  T:SetIgnored(9001, "Orb Burst", true)
  A:Start(9001, "Mythic", "rehearsal", { clock = function() return 0 end, speed = function() return 1 end, group = "mythic" })
  local seen = blocksOf(A.items)
  assert(seen["special:orbs"] == nil and seen["mine:2"] == nil, "no Orb Burst alerts in the rehearsal")
  assert(seen["special:slam"] == 2 and seen["mine:1"] == 2, "others play")
  -- the phases a rehearsal window asks for leave it out too
  local items = A:Collect({ encounterID = 9001, group = "mythic", reason = "rehearsal" })
  for _, it in ipairs(items) do assert(it.special ~= "orbs", "Collect for any run leaves it out") end
  assert(#errors == 0, tostring(errors[1]))
end)

check("ignored: the notes' blocks are never gated", function()
  assert(A.blocks.mine.ignorable and A.blocks.special.ignorable, "Mech Alerts and special alerts are gated")
  assert(not A.blocks.note.ignorable and not A.blocks.personal.ignorable, "the raid note and your personal note are not")
  clear()
end)

check("ignored: the matcher", function()
  clear()
  assert(T:IgnoreMatcher(9001, nil) == nil, "nothing ignored: no matcher")
  T:SetIgnored(9001, "Swap", true)
  local ref = Ref:ForBoss(9001)[1].ref
  local m = T:IgnoreMatcher(9001, ref)
  assert(m(4242, nil) and m(nil, "SWAP") and not m(1, "Orb Burst") and not m(nil, nil), "by spell through the row, and by name")
  assert(T:IgnoreMatcher(9001, nil)(4242) == false, "without the ability timeline a spell matches by its own name only")
  clear()
end)

print(ok_ .. " passed, " .. fail .. " failed")
if fail > 0 then error("ignored mechanics: " .. fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const files = process.argv.slice(2);
for (const file of files) {
  let src; try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.error('cannot read ' + file); process.exit(1); }
  lua.lua_pushstring(L, to_luastring(src));
}
if (lua.lua_pcall(L, files.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
