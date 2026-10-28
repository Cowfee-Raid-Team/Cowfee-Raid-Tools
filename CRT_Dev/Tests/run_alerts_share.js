// CRT_Modules/Alerts/Share.lua (CRT.AlertShare): your Mech Alerts and special alert choices as a !CRT:alerts:1: code
// (CRT_Core/Share.lua) and back. The round trip with ticks, fill and bar end; what to put in (Special alerts, My Mech
// Alerts, both; one boss or all); invalid fields and entries dropped and counted; the compare with what you have (new,
// replaces yours, same as yours) and apply; the dev definitions; and the dev window's Lua for shipping
// (CRT_Dev/Dev/AlertExport.lua), which must read back through the boss file loader's Register and Special.Read.
// Usage: node run_alerts_share.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const FILES = [
  'CRT_Modules/Timeline/Data.lua', 'CRT_Modules/Timeline/Database.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/Lanes.lua',
  'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua',
  'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/Engine.lua',
  'CRT_Modules/Alerts/Reminders.lua', 'CRT_Modules/Alerts/Special.lua', 'CRT_Modules/Alerts/Draft.lua',
  'CRT_Core/Share.lua', 'CRT_Modules/Alerts/Share.lua', 'CRT_Dev/Dev/AlertExport.lua',
  'CRT_Data/Bosses/Registry.lua',
];
const harness = `
local sources = { ... }
local registry = table.remove(sources)
function CreateFrame() return setmetatable({}, { __index = function() return function() end end }) end
local combat = false
function InCombatLockdown() return combat end
C_Timer = { After = function() end }
function GetTime() return 100 end
function issecretvalue() return false end
function geterrorhandler() return function() end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
function date(f) return f == "%Y-%m-%d" and "2026-10-25" or "2026-10-25 12:00" end
SOUNDKIT = { RAID_WARNING = 8959 }
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
C_VoiceChat = { SpeakText = function() end }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end }
function UnitName(u) if u == "player" then return "Solex" end end
function UnitGroupRolesAssigned() return "DAMAGER" end
function UnitClass() return "Mage", "MAGE", 8 end
function IsInRaid() return false end
function GetNumGroupMembers() return 0 end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic" })[id] end
Enum = { CompressionMethod = { Deflate = 0, Zlib = 1 } }

-- The stand-in encoder (as run_share.js) ----------------------------------------------------------
local function ser(v, out)
  local t = type(v)
  if t == "number" then out[#out + 1] = "n" .. string.format("%.17g", v) .. ";"
  elseif t == "string" then out[#out + 1] = "s" .. #v .. ":" .. v
  elseif t == "boolean" then out[#out + 1] = v and "T" or "F"
  elseif t == "table" then out[#out + 1] = "{" for k, x in pairs(v) do ser(k, out) ser(x, out) end out[#out + 1] = "}"
  else error("can't serialize " .. t) end
end
local function des(s, i)
  local c = s:sub(i, i)
  if c == "n" then local j = s:find(";", i, true) return assert(tonumber(s:sub(i + 1, j - 1))), j + 1
  elseif c == "s" then local j = s:find(":", i, true) local n = tonumber(s:sub(i + 1, j - 1)) if j + n > #s then error("cut") end return s:sub(j + 1, j + n), j + n + 1
  elseif c == "T" then return true, i + 1 elseif c == "F" then return false, i + 1
  elseif c == "{" then local t = {} i = i + 1
    while s:sub(i, i) ~= "}" do if i > #s then error("cut table") end local k, x k, i = des(s, i) x, i = des(s, i) t[k] = x end
    return t, i + 1
  else error("bad byte " .. c) end
end
local function sum(s) local a = 0 for i = 1, #s do a = (a * 31 + s:byte(i)) % 1000003 end return a end
local B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function b64(s)
  local out = {}
  for i = 1, #s, 3 do
    local a, b, c = s:byte(i, i + 2)
    local n = a * 65536 + (b or 0) * 256 + (c or 0)
    local q = { math.floor(n / 262144) % 64, math.floor(n / 4096) % 64, math.floor(n / 64) % 64, n % 64 }
    out[#out + 1] = B:sub(q[1] + 1, q[1] + 1) .. B:sub(q[2] + 1, q[2] + 1) .. (b and B:sub(q[3] + 1, q[3] + 1) or "=") .. (c and B:sub(q[4] + 1, q[4] + 1) or "=")
  end
  return table.concat(out)
end
local function unb64(s)
  if #s % 4 ~= 0 or s:find("[^%w%+/=]") then error("bad base64") end
  local out = {}
  for i = 1, #s, 4 do
    local n, pad = 0, 0
    for j = 0, 3 do local ch = s:sub(i + j, i + j) local v if ch == "=" then v = 0 pad = pad + 1 else v = B:find(ch, 1, true) - 1 end n = n * 64 + v end
    out[#out + 1] = string.char(math.floor(n / 65536) % 256, math.floor(n / 256) % 256, n % 256):sub(1, 3 - pad)
  end
  return table.concat(out)
end
C_EncodingUtil = {
  SerializeCBOR = function(v) local out = {} ser(v, out) return table.concat(out) end,
  DeserializeCBOR = function(s) local v, i = des(s, 1) if i ~= #s + 1 then error("trailing") end return v end,
  CompressString = function(s) return "Z" .. sum(s) .. ":" .. s end,
  DecompressString = function(s) local c, body = s:match("^Z(%d+):(.*)$") if not c or tonumber(c) ~= sum(body) then error("checksum") end return body end,
  EncodeBase64 = b64, DecodeBase64 = unb64,
}

local printed = {}
local CRT = {
  version = "1.1.4",
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    notes = { list = {}, nextId = 1, alert = { enabled = true } },
    alerts = { bars = { shown = true }, reminders = {}, phases = {}, overrides = {}, nextId = 1, special = {} },
  },
  UI = { RegisterLayer = function() end, RegisterPreview = function() end, pages = {} },
  PlaySound = function() return 1 end,
}
function CRT:Print(m) printed[#printed + 1] = m end
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
local B, S, A, Ref, R = CRT.Bosses, CRT.AlertSpecial, CRT.Alerts, CRT.TimelineReference, CRT.AlertReminders
local AS, Share, Dev = CRT.AlertShare, CRT.Share, CRT.AlertExportDev
B:Season({ key = "T", name = "Test season", current = true, raids = { { key = "r", name = "Raid", bosses = { 9001, 9002 } } } })
local SPECIAL = {
  { key = "soaks", label = "Orb soaks", help = "Two groups soak each orb.", type = "soak",
    when = { row = "Orb Burst" }, lead = 6, who = { mode = "rotation", rotation = { { 1, 2 }, { 3, 4 } } },
    text = "Soak now: {group}", show = { callout = true, bar = false, text = true, speech = true },
    markers = { marks = { "star", "circle" } }, ticks = { 0, 2.5 }, barTo = "cast" },
  { key = "tanks", label = "Tank swap", difficulty = "mythic", when = { spellID = 4242 }, who = { mode = "rotation", rotation = { "tank", "healer" } },
    bar = { start = -3, length = 8, ticks = { 4.5, 6.5 } }, fill = "down", covers = { 5151 } },
}
B:Register({ encounterID = 9001, name = "Test Boss", season = "T", special = SPECIAL })
B:Register({ encounterID = 9002, name = "Plain Boss", season = "T" })
handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Mythic\\nEncounter: 9001\\nLength: 4:00\\nPhase: P2 2:00\\nOrb Burst: 0:30, 1:10, 1:50, 2:30\\nSwap [spell 4242]: 0:40, 1:40"))
assert(Ref:Add("Boss: Test Boss\\nDifficulty: Heroic\\nEncounter: 9001\\nLength: 3:00\\nOrb Burst: 0:45, 1:45"))

local ok_, fail = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then ok_ = ok_ + 1 print("ok " .. name) else fail = fail + 1 print("FAIL " .. name .. ": " .. tostring(err)) end
end
local function copy(v) if type(v) ~= "table" then return v end local o = {} for k, x in pairs(v) do o[k] = copy(x) end return o end
local function same(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= "table" then return a == b end
  for k, v in pairs(a) do if not same(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end
-- the sender's Mech Alerts and choices
local SWAP = { spellID = 4242, text = "Swap", group = "mythic", outputs = { alert = true, bar = true, speech = true, text = false, icon = true, circle = false, timeline = false },
  warn = 6, speech = "textcount", priority = "high", enabled = true, linger = 2, glow = true, color = { 1, 0.5, 0.25, 1 }, speakAt = "zero",
  ticks = { 1.5, 3.5 }, fill = "up", countTo = "impact", barTo = "cast", shifts = { mythic = { ["P1@0:40"] = 2 } }, off = { mythic = { ["P1@1:40"] = true } }, sound = "kit:RAID_WARNING" }
local RUN = { text = "Run out", times = "P1 0:20, 1:00", group = "nh", outputs = { alert = true, bar = false, speech = true }, warn = 5, speech = "text", priority = "normal", enabled = true }
local function sender()
  CRT.db.alerts.reminders = {} CRT.db.alerts.nextId = 1 CRT.db.alerts.special = {} S.dev = {}
  CRT.db.alerts.reminders[9001] = { [1] = copy(SWAP), [2] = copy(RUN) }
  CRT.db.alerts.nextId = 3
  CRT.db.alerts.special[9001] = { soaks = { on = true, show = { alert = true, text = false, icon = false, bar = true, circle = false, timeline = false }, speak = false, markers = false, fill = "down", countTo = "impact" } }
end
local function receiver()
  CRT.db.alerts.reminders = {} CRT.db.alerts.nextId = 1 CRT.db.alerts.special = {} S.dev = {}
end
local function byText(enc) local out = {} for _, e in ipairs(R:List(enc)) do out[e.r.text] = e end return out end

check("alerts share: the module and the dev tool exist", function()
  assert(AS and AS.Export and AS.Read and AS.Apply and AS.Summary, "CRT.AlertShare with Export, Read, Apply and Summary")
  assert(Dev and Dev.LuaFor, "CRT.AlertExportDev.LuaFor")
end)

local code
check("alerts share: Export gives a !CRT:alerts:1: code with your reminders and choices", function()
  sender()
  local err
  code, err = AS:Export({ special = true, reminders = true })
  assert(type(code) == "string" and code:find("^!CRT:alerts:1:"), "a code: " .. tostring(err))
  local data = Share.Decode(code, "alerts", 1, AS.CAPS)
  assert(data and data.v == 1 and data.from == "Solex", "the payload's version and sender")
  local m = data.boss[9001].mythic
  assert(m and m.reminders[1].spellID == 4242 and same(m.reminders[1].ticks, { 1.5, 3.5 }) and m.reminders[1].fill == "up" and m.reminders[1].countTo == "impact", "the Mythic reminder with its ticks, fill and Count down to")
  assert(m.reminders[1].barTo == nil, "an old saved bar end is not written: it is ignored now")
  assert(m.special.tanks and m.special.tanks.on == false, "the Mythic-only special alert's choices sit under Mythic")
  local any = data.boss[9001].any
  assert(any and any.special.soaks.on == true and any.special.soaks.fill == "down" and any.special.soaks.countTo == "impact", "a special alert for both difficulties sits under any, with your choices")
  assert(data.boss[9001].nh.reminders[1].times == "P1 0:20, 1:00", "the Normal/Heroic typed reminder")
  assert(m.defs == nil and any.defs == nil, "no shipped definitions unless asked")
end)

check("alerts share: what goes in: special alerts, my Mech Alerts, one boss", function()
  sender()
  local onlySpecial = Share.Decode(AS:Export({ special = true }), "alerts", 1, AS.CAPS)
  assert(onlySpecial.boss[9001].any.special.soaks and onlySpecial.boss[9001].mythic.reminders == nil and onlySpecial.boss[9001].nh == nil, "Special alerts: no reminders")
  local onlyMine = Share.Decode(AS:Export({ reminders = true }), "alerts", 1, AS.CAPS)
  assert(onlyMine.boss[9001].mythic.reminders[1] and onlyMine.boss[9001].mythic.special == nil and onlyMine.boss[9001].any == nil, "My Mech Alerts: no special choices")
  CRT.db.alerts.reminders[9002] = { [5] = { text = "Plain", times = "0:10", outputs = { alert = true } } }
  local one = Share.Decode(AS:Export({ reminders = true, bosses = { 9001 } }), "alerts", 1, AS.CAPS)
  assert(one.boss[9001] and one.boss[9002] == nil, "one boss: only that boss")
  local all = Share.Decode(AS:Export({ reminders = true }), "alerts", 1, AS.CAPS)
  assert(all.boss[9002] and all.boss[9002].any.reminders[1].text == "Plain", "all bosses: every boss with a reminder, an older one on any difficulty under any")
  local none, why = AS:Export({ reminders = true, bosses = { 1234 } })
  assert(none == nil and why == AS.TEXT.nothing, "nothing to export says so: " .. tostring(why))
end)

check("alerts share: into a fresh CRT, every reminder is new; Import writes them where the panel saves", function()
  sender()
  code = AS:Export({ special = true, reminders = true })
  receiver()
  local info, err = AS:Read(code)
  assert(info, "reads: " .. tostring(err))
  assert(info.from == "Solex" and info.counts.new == 2, "two new reminders: " .. tostring(info.counts.new))
  assert(info.counts.replace == 1 and info.counts.same == 1, "soaks replaces your default choices, tanks is the same as yours: " .. info.counts.replace .. " " .. info.counts.same)
  assert(next(CRT.db.alerts.reminders) == nil and next(CRT.db.alerts.special) == nil, "Read changes nothing")
  local line = AS.Summary(info)
  assert(line:find("Solex", 1, true) and line:find("Test Boss", 1, true) and line:find("2 new", 1, true) and line:find("1 replaces yours", 1, true) and line:find("1 same as yours", 1, true), "the summary: " .. line)
  local n = AS:Apply(info)
  assert(n == 3, "three applied: " .. tostring(n))
  local mine = byText(9001)
  local swap, run = mine.Swap and mine.Swap.r, mine["Run out"] and mine["Run out"].r
  assert(swap and run, "both saved in alerts.reminders")
  assert(same(swap.ticks, { 1.5, 3.5 }) and swap.fill == "up" and swap.countTo == "impact" and swap.barTo == nil and swap.group == "mythic" and swap.warn == 6 and swap.speech == "textcount"
    and swap.linger == 2 and swap.glow == true and swap.color[2] == 0.5 and swap.speakAt == "zero" and swap.shifts.mythic["P1@0:40"] == 2 and swap.off.mythic["P1@1:40"] == true
    and swap.sound == "kit:RAID_WARNING" and swap.priority == "high" and swap.outputs.icon == true, "every field of the Swap reminder came across")
  assert(run.times == "P1 0:20, 1:00" and run.group == "nh", "the typed reminder keeps its times (it follows no ability)")
  assert(CRT.db.alerts.special[9001].soaks.on == true and CRT.db.alerts.special[9001].soaks.fill == "down" and CRT.db.alerts.special[9001].soaks.countTo == "impact" and CRT.db.alerts.special[9001].soaks.show.bar == true, "the soaks choices, with Count down to")
  assert(CRT.db.alerts.special[9001].tanks == nil, "a choice the same as yours is not written")
  local again = AS:Read(code)
  assert(again.counts.new == 0 and again.counts.replace == 0 and again.counts.same == 4, "read again: everything the same as yours")
end)

check("alerts share: change the ticks, import the code: 1 replaces yours, the old ticks come back", function()
  local mine = byText(9001)
  local id = mine.Swap.id
  local r = CRT.db.alerts.reminders[9001][id]
  r.ticks = { 9 } r.timesBackup = "P1 0:39" -- something only this computer has
  local info = AS:Read(code)
  assert(info.counts.replace == 1 and info.counts.new == 0, "one replaces yours: " .. info.counts.replace)
  assert(AS.Summary(info):find("1 replaces yours", 1, true), "the summary says so")
  local item
  for _, it in ipairs(info.items) do if it.status == "replace" then item = it end end
  assert(item.kind == "reminder" and item.target == id, "it names the reminder it replaces")
  AS:Apply(info)
  local back = CRT.db.alerts.reminders[9001][id]
  assert(same(back.ticks, { 1.5, 3.5 }), "the old ticks are back")
  assert(back.timesBackup == "P1 0:39", "fields that never travel stay as they were")
  assert(#R:List(9001) == 2, "replaced, not added")
end)

check("alerts share: apply only what is picked", function()
  receiver()
  local info = AS:Read(code)
  local n = AS:Apply(info, function(item) return item.kind == "special" end)
  assert(n == 1 and #R:List(9001) == 0 and CRT.db.alerts.special[9001].soaks.on == true, "only the special choice: " .. tostring(n))
end)

check("alerts share (players): Parts lists your alerts, in the order Export writes them", function()
  sender()
  local parts = AS:Parts({ special = true, reminders = true, bosses = { 9001 } })
  local byId = {}
  for _, p in ipairs(parts) do byId[p.id] = p end
  assert(#parts == 4, "two Mech Alerts and two special alerts: " .. #parts)
  assert(byId["r:9001:1"] and byId["r:9001:1"].kind == "reminder" and byId["r:9001:1"].label == "Swap" and byId["r:9001:1"].group == "mythic", "the Swap reminder")
  assert(byId["r:9001:2"] and byId["r:9001:2"].group == "nh", "the typed reminder")
  assert(byId["s:9001:soaks"] and byId["s:9001:soaks"].kind == "special" and byId["s:9001:soaks"].label == "Orb soaks" and byId["s:9001:soaks"].group == "any", "the soaks special alert")
  assert(byId["s:9001:tanks"] and byId["s:9001:tanks"].group == "mythic", "the Mythic-only special alert")
  for _, p in ipairs(parts) do assert(p.enc == 9001, "each part names its boss") end
  CRT.db.alerts.reminders[9001][3] = { spellID = 4242, outputs = { alert = true } }
  local spellOnly
  for _, p in ipairs(AS:Parts({ reminders = true, bosses = { 9001 } })) do if p.id == "r:9001:3" then spellOnly = p end end
  assert(spellOnly and spellOnly.label == "Spell4242", "a reminder with no text is named by its spell: " .. tostring(spellOnly and spellOnly.label))
end)

check("alerts share (players): Export with a pick holds only the ticked alerts", function()
  sender()
  local code, n = AS:Export({ special = true, reminders = true, bosses = { 9001 }, pick = function(p) return p.id == "r:9001:1" end })
  assert(code and n == 1, "one part: " .. tostring(n))
  local data = Share.Decode(code, "alerts", 1, AS.CAPS)
  assert(data.boss[9001].mythic.reminders[1].text == "Swap" and #data.boss[9001].mythic.reminders == 1, "only Swap")
  assert(data.boss[9001].nh == nil and data.boss[9001].any == nil and data.boss[9001].mythic.special == nil, "nothing else")
  local none, why = AS:Export({ special = true, reminders = true, pick = function() return false end })
  assert(none == nil and why == AS.TEXT.nothing, "nothing ticked says so: " .. tostring(why))
end)

check("alerts share (players): Read without definitions leaves a code's new definitions and their choices out", function()
  sender()
  S.dev[9001] = { { key = "devSample", label = "Sample", when = { times = "P1 0:20, 0:50" }, who = { mode = "everyone" } } }
  CRT.db.alerts.special[9001].devSample = { on = true }
  local dcode = AS:Export({ special = true, defs = true, bosses = { 9001 } })
  receiver()
  local info = AS:Read(dcode, { defs = false })
  assert(info, "reads")
  for _, it in ipairs(info.items) do
    assert(it.kind ~= "def", "no definitions: " .. tostring(it.key))
    assert(it.key ~= "devSample", "no choice for a definition this CRT doesn't ship")
  end
  assert(info.kinds.special == 2 and info.dropped == 0, "the two shipped choices, nothing counted as not valid: " .. info.kinds.special .. " " .. info.dropped)
  AS:Apply(info)
  assert(S:Get(9001, "devSample") == nil and next(S.dev) == nil, "no definition loaded")
  local dev = AS:Read(dcode)
  local defs = 0
  for _, it in ipairs(dev.items) do if it.kind == "def" then defs = defs + 1 end end
  assert(defs == 3, "the dev read still reads them: " .. defs)
end)

check("alerts share (players): the From line names the sender, the boss and the difficulty", function()
  sender()
  local mythic = AS:Read(AS:Export({ reminders = true, bosses = { 9001 }, pick = function(p) return p.id == "r:9001:1" end }), { defs = false })
  assert(AS.FromLine(mythic) == "From Solex · Test Boss · Mythic", AS.FromLine(mythic))
  local nh = AS:Read(AS:Export({ reminders = true, bosses = { 9001 }, pick = function(p) return p.id == "r:9001:2" end }), { defs = false })
  assert(AS.FromLine(nh) == "From Solex · Test Boss · Normal/Heroic", AS.FromLine(nh))
  local both = AS:Read(AS:Export({ reminders = true, bosses = { 9001 } }), { defs = false })
  assert(AS.FromLine(both) == "From Solex · Test Boss · Normal/Heroic and Mythic", AS.FromLine(both))
  local any = AS:Read(AS:Export({ special = true, bosses = { 9001 }, pick = function(p) return p.id == "s:9001:soaks" end }), { defs = false })
  assert(AS.FromLine(any) == "From Solex · Test Boss", AS.FromLine(any))
  CRT.db.alerts.reminders[9002] = { [5] = { text = "Plain", times = "0:10", outputs = { alert = true } } }
  local two = AS:Read(AS:Export({ reminders = true }), { defs = false })
  assert(AS.FromLine(two):find("^From Solex · 2 bosses"), AS.FromLine(two))
end)

check("alerts share: invalid fields and entries are dropped and counted", function()
  receiver()
  local payload = { v = 1, from = "Hand|cffff0000made|r", boss = {
    [9001] = {
      mythic = { reminders = {
        { spellID = 4242, text = "Swap", group = "mythic", outputs = { alert = true, bar = "yes", madeUp = true }, warn = "soon", speech = "loud", priority = "urgent",
          ticks = { 2, -1, "a", 1 }, fill = "sideways", countTo = "sideways", barTo = "middle", color = { 2, 0, 0 }, linger = 99, shifts = { mythic = { ["P1@0:40"] = "far" } }, unknownField = 1 },
        { text = "Bad times", times = "soon", spellID = 77, outputs = { alert = true } },
        { text = "Shows nothing", times = "0:10", outputs = { alert = false, bar = false, speech = false } },
        { outputs = { alert = true }, times = "0:10" },
        "not a reminder",
      }, special = {
        tanks = { on = true, fill = "sideways", countTo = "sideways", show = { bar = "no" } },
        nosuch = { on = true },
      } },
      sometimes = { reminders = { { text = "Wrong group", times = "0:10", outputs = { alert = true } } } },
    },
    ["abc"] = { nh = { reminders = { { text = "x", times = "0:10", outputs = { alert = true } } } } },
  } }
  local info, err = AS:Read(Share.Encode("alerts", 1, payload))
  assert(info, "a hand-made code still reads: " .. tostring(err))
  assert(not info.from:find("|", 1, true), "the sender's name loses its escape codes: " .. info.from)
  local rems, specials = {}, {}
  for _, it in ipairs(info.items) do if it.kind == "reminder" then rems[#rems + 1] = it.value elseif it.kind == "special" then specials[it.key] = it.value end end
  assert(#rems == 2, "Swap and Bad times are kept (Bad times has a spell): " .. #rems)
  local r = rems[1].text == "Swap" and rems[1] or rems[2]
  assert(r.warn == nil and r.speech == nil and r.priority == nil and r.fill == nil and r.countTo == nil and r.barTo == nil and r.color == nil and r.linger == nil and r.unknownField == nil and r.shifts == nil, "each bad field is left out")
  assert(same(r.ticks, { 1, 2 }), "only the good ticks, in order")
  assert(r.outputs.alert == true and r.outputs.bar == nil and r.outputs.madeUp == nil, "only the good outputs")
  local bt = rems[1].text == "Bad times" and rems[1] or rems[2]
  assert(bt.times == nil and bt.spellID == 77, "times that don't read are left out")
  assert(specials.tanks and specials.tanks.on == true and specials.tanks.fill == "down" and specials.tanks.countTo == nil and specials.tanks.show.bar == true, "a bad choice field falls back to yours")
  assert(specials.nosuch == nil, "a choice for a special alert this CRT doesn't have is left out")
  assert(info.dropped >= 18, "every dropped part is counted: " .. info.dropped)
  assert(AS.Summary(info):find("left out", 1, true), "the summary says some was left out: " .. AS.Summary(info))
end)

check("alerts share: your Show from travels with your special choices; a bad one is dropped", function()
  sender()
  local soaks = S:Get(9001, "soaks") -- shipped lead 6
  S:SetChoice(9001, soaks, "lead", 9)
  local code = AS:Export({ special = true, bosses = { 9001 } })
  local data = Share.Decode(code, "alerts", 1, AS.CAPS)
  assert(data.boss[9001].any.special.soaks.lead == 9, "in the code")
  assert(data.boss[9001].mythic.special.tanks.lead == nil, "none for an alert at its shipped lead")
  receiver()
  local info = AS:Read(code, { defs = false })
  local item
  for _, it in ipairs(info.items) do if it.key == "soaks" then item = it end end
  assert(item and item.value.lead == 9 and item.status == "replace", "read: yours would be 9")
  AS:Apply(info)
  assert(CRT.db.alerts.special[9001].soaks.lead == 9 and S:Lead(9001, soaks) == 9, "applied: saved where the panel saves it")
  assert(AS:Read(code, { defs = false }).counts.same == 2, "read again: the same as yours")
  -- hand-made: the shipped value, out of range, not a number
  receiver()
  local function readLead(v)
    local payload = { v = 1, from = "Hand", boss = { [9001] = { any = { special = { soaks = { on = true, lead = v } } } } } }
    local got = assert(AS:Read(Share.Encode("alerts", 1, payload), { defs = false }))
    return got.items[1].value, got.dropped
  end
  local v, dropped = readLead(6)
  assert(v.lead == nil and dropped == 0, "the shipped value: none of yours, nothing dropped")
  v, dropped = readLead(60)
  assert(v.lead == 60 and dropped == 0, "60 s: the top of the range")
  for _, bad in ipairs({ 0, 0.5, 61, -3, "8", true }) do
    v, dropped = readLead(bad)
    assert(v.lead == nil and v.on == true and dropped == 1, tostring(bad) .. ": dropped and counted, the rest read")
  end
  -- yours kept when the code's is bad
  S:SetChoice(9001, soaks, "lead", 20)
  v = readLead(99)
  assert(v.lead == 20, "a bad lead keeps yours: " .. tostring(v.lead))
end)

check("alerts share: an older code's barTo still reads, and is left out quietly", function()
  receiver()
  local payload = { v = 1, from = "Old", boss = { [9001] = { mythic = { reminders = {
    { spellID = 4242, text = "Old swap", group = "mythic", outputs = { alert = true, bar = true }, ticks = { 1, 2 }, barTo = "cast" } } } } } }
  local info, err = AS:Read(Share.Encode("alerts", 1, payload))
  assert(info, "reads: " .. tostring(err))
  assert(info.dropped == 0, "nothing counted as left out: " .. info.dropped)
  local r
  for _, it in ipairs(info.items) do if it.kind == "reminder" then r = it.value end end
  assert(r and same(r.ticks, { 1, 2 }) and r.barTo == nil, "its ticks kept, its bar end not")
  assert(AS.REMINDER_FIELDS.barTo == nil, "barTo is no longer a field that travels")
end)

check("alerts share: codes that don't read change nothing", function()
  receiver()
  local i, e = AS:Read("CRTS1:abcd")
  assert(i == nil and e == "Not a CRT alerts code.", "a profile text: " .. tostring(e))
  i, e = AS:Read(Share.Encode("alerts", 2, { v = 2, boss = {} }))
  assert(i == nil and e:find("^Made by a newer CRT"), "a newer code: " .. tostring(e))
  i, e = AS:Read(code:sub(1, #code - 6))
  assert(i == nil and e:find("^Damaged code"), "a cut-off code: " .. tostring(e))
  i, e = AS:Read(Share.Encode("alerts", 1, { v = 9, boss = {} }))
  assert(i == nil and e:find("^Made by a newer CRT"), "a newer payload inside a version 1 code: " .. tostring(e))
  i, e = AS:Read(Share.Encode("alerts", 1, { v = 1 }))
  assert(i == nil and e:find("^Damaged code"), "a payload with no bosses: " .. tostring(e))
  assert(next(CRT.db.alerts.reminders) == nil, "nothing was written")
end)

check("alerts share: no import during combat", function()
  receiver()
  local info = AS:Read(code)
  combat = true
  local n, why = AS:Apply(info)
  combat = false
  assert(n == nil and why == AS.TEXT.combat and next(CRT.db.alerts.reminders) == nil, "refused: " .. tostring(why))
end)

check("alerts share: the dev code carries the boss file's definitions; a new one loads for this session", function()
  sender()
  S.dev[9001] = { { key = "devSample", label = "Sample", when = { times = "P1 0:20, 0:50" }, who = { mode = "everyone" } } }
  local dcode = AS:Export({ special = true, defs = true, bosses = { 9001 } })
  local data = Share.Decode(dcode, "alerts", 1, AS.CAPS)
  local keys = {}
  for _, g in pairs(data.boss[9001]) do for _, d in ipairs(g.defs or {}) do keys[d.key] = d end end
  assert(keys.soaks and keys.tanks and keys.devSample, "every definition, the dev sample's too")
  assert(same(keys.soaks.who.rotation, { { 1, 2 }, { 3, 4 } }) and keys.tanks.bar.length == 8, "as the boss file writes them")
  receiver()
  local info = AS:Read(dcode)
  local st = {}
  for _, it in ipairs(info.items) do if it.kind == "def" then st[it.key] = it.status end end
  assert(st.soaks == "same" and st.tanks == "same" and st.devSample == "new", "shipped ones are the same, the sample is new")
  AS:Apply(info)
  assert(S:Get(9001, "devSample") ~= nil and S.dev[9001] and next(CRT.db.alerts.reminders) == nil, "the sample is on the boss for this session, never saved")
end)

check("alerts share: Lua for shipping reads back through the boss file loader", function()
  sender()
  local text = Dev.LuaFor(9001, { special = true, reminders = true })
  assert(type(text) == "string", "Lua text")
  local first = text:match("^[^\\n]+")
  assert(first:find("^%-%-") and first:find("Test Boss", 1, true) and first:find("9001", 1, true) and first:find("season T", 1, true) and text:find("2026%-10%-25"), "a header comment with the boss, encounter, season and date: " .. first)
  local got
  local fake = { Register = function(_, def) got = def end }
  local chunk, err = load("local CRT = ...\\nCRT.Bosses:Register({ encounterID = 9001, name = \\"Test Boss\\", season = \\"T\\",\\n" .. text .. "\\n})", "export")
  assert(chunk, "it parses: " .. tostring(err) .. "\\n" .. text)
  chunk({ Bosses = fake })
  assert(got and type(got.special) == "table", "a special list")
  local byKey = {}
  for _, def in ipairs(got.special) do
    local entry, why = S.Read(def)
    assert(entry, "each entry reads: " .. tostring(def.key) .. " " .. tostring(why))
    byKey[def.key] = def
  end
  assert(same(byKey.soaks, SPECIAL[1]) and same(byKey.tanks, SPECIAL[2]), "the shipped entries come back as they were written")
  local swap = byKey.swap
  assert(swap and swap.label == "Swap" and swap.when.spellID == 4242 and swap.difficulty == "mythic" and swap.lead == 6, "the Swap reminder as an entry: " .. tostring(swap and swap.key))
  assert(same(swap.ticks, { 1.5, 3.5 }) and swap.barTo == nil and swap.fill == nil, "its ticks, no bar end (a reminder's is ignored); a bar that fills up is the default")
  assert(swap.show.callout == true and swap.show.icon == true and swap.show.text == false and swap.show.speech == true, "its Show as")
  local run = byKey.runOut
  assert(run and run.when.times == "P1 0:20, 1:00" and run.difficulty == "nh" and run.fill == "down" and run.show.bar == false, "the typed reminder: its times, and its bar empties")
  local onlyMine = Dev.LuaFor(9001, { reminders = true })
  assert(not onlyMine:find("soaks", 1, true) and onlyMine:find("swap", 1, true), "My Mech Alerts only: no shipped entries")
  assert(Dev.LuaFor(9002, { special = true }) == nil, "a boss with nothing gives nothing")
end)

check("alerts share: Lua for every boss is one block per boss", function()
  sender()
  CRT.db.alerts.reminders[9002] = { [5] = { text = "Plain", times = "0:10", outputs = { alert = true } } }
  local text = Dev.LuaForAll({ special = true, reminders = true })
  local n = 0 for _ in text:gmatch("special = {") do n = n + 1 end
  assert(n == 2 and text:find("Plain Boss", 1, true), "two blocks: " .. n)
end)

check("alerts share: a shield bar's absorb is written in its place and reads back", function()
  sender()
  local shield = { key = "shield", label = "Shield", when = { row = "Orb Burst" }, fill = "down",
    covers = { 5151 }, absorb = { anyDifficulty = true, length = 15, unit = "boss2" } }
  local list = { SPECIAL[1], SPECIAL[2], shield }
  B:Register({ encounterID = 9001, name = "Test Boss", season = "T", special = list })
  local ok, err = pcall(function()
    local text = Dev.LuaFor(9001, { special = true })
    assert(text:find('absorb = { unit = "boss2", length = 15, anyDifficulty = true }', 1, true), "absorb in its own order: " .. text)
    assert(text:find("covers", 1, true) < text:find("absorb", 1, true), "after covers, as Special.lua lists it")
    local got
    local chunk = assert(load("local CRT = ...\\nCRT.Bosses:Register({ encounterID = 9001, name = \\"Test Boss\\", season = \\"T\\",\\n" .. text .. "\\n})", "export"))
    chunk({ Bosses = { Register = function(_, def) got = def end } })
    local back
    for _, def in ipairs(got.special) do if def.key == "shield" then back = def end end
    assert(back and same(back.absorb, shield.absorb), "it comes back as written")
    local entry = S.Read(back)
    assert(entry and entry.absorb.unit == "boss2" and entry.absorb.anyDifficulty == true, "and reads")
  end)
  B:Register({ encounterID = 9001, name = "Test Boss", season = "T", special = SPECIAL })
  assert(ok, tostring(err))
end)

print(ok_ .. " passed, " .. fail .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const p of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
