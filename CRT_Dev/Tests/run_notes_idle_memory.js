// Memory while idle with the note windows unable to show (#1315): the real CRT_Modules/Alerts/Rules.lua,
// Alerts/Engine.lua, Notes/Parse.lua, Data.lua, Engine.lua, Groups/Data.lua and Notes/Window.lua on mock frames, with
// a 60-line note in use, a personal note and personal reminders for its boss. The windows' one updater (an OnUpdate
// that never stops) runs every frame; out of a raid instance, with Show outside of raid off, no window can show.
// It counts every Lua table made (fengari's luaH_new) while that updater runs for a minute, and checks:
//   - out of a raid, nothing is built: under IDLE_TABLES tables a minute (before the fix
//     each window built its whole text every 5 s while hidden: about 5000 tables a minute here);
//   - the same windows in a raid still show the note, and the first draw after coming back in builds it again;
//   - Show outside of raid ticked, they show out of a raid too; a preview shows a window wherever you are.
// Prints the counts as "measure" lines.
// Usage: node run_notes_idle_memory.js <Rules.lua> <Alerts/Engine.lua> <Parse.lua> <Data.lua> <Notes/Engine.lua> <Groups/Data.lua> <Window.lua>
const fs = require('fs');
const ltable = require('fengari/src/ltable.js');
let tablesMade = 0;
const newTable = ltable.luaH_new;
ltable.luaH_new = function (L) { tablesMade++; return newTable(L); };
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const a = process.argv.slice(2);
if (a.length < 7) { console.error('usage: node run_notes_idle_memory.js Rules AlertsEngine Parse Data Engine GroupsData Window'); process.exit(2); }
const names = ['CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua',
  'CRT_Modules/Notes/Engine.lua', 'CRT_Modules/Groups/Data.lua', 'CRT_Modules/Notes/Window.lua'];

const harness = themeLua(a) + `
local files = { ... }
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 else fails = fails + 1 print("FAIL " .. what) end end
local clock = 1000
function GetTime() return clock end
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-11-25 20:00" end
function InCombatLockdown() return false end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function Ambiguate(name) return name end
function GetNormalizedRealmName() return "Area52" end
function UnitName(u) if u == "player" then return "Cheoeqar" end end
function UnitFullName(u) if u == "player" then return "Cheoeqar", "Area52" end end
function UnitClass(u) if u == "player" then return "Mage", "MAGE" end end
function UnitGroupRolesAssigned() return "DAMAGER" end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
function IsInRaid() return false end
local instanceType = "none" -- a city: no window may show unless Show outside of raid is ticked
function IsInInstance() return instanceType ~= "none", instanceType end
function GetNumGroupMembers() return 1 end
function GetNumSubgroupMembers() return 0 end
function UnitIsUnit() return false end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
C_Spell = { GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
RAID_CLASS_COLORS = { MAGE = { colorStr = "ff3fc7eb" }, PRIEST = { colorStr = "ffffffff" }, WARRIOR = { colorStr = "ffc69b6d" } }

-- Mock frames: shown until hidden, visible while every parent is shown.
local all = {}
local methods = {}
local function newObj(kind, parent, name)
  local o = setmetatable({ kind = kind, parent = parent, shown = true, scripts = {}, events = {}, text = "" },
    { __index = function(_, k) return methods[k] or function() end end })
  all[#all + 1] = o
  return o
end
function methods.Show(o) o.shown = true end
function methods.Hide(o) o.shown = false end
function methods.SetShown(o, v) o.shown = v and true or false end
function methods.IsShown(o) return o.shown end
function methods.IsVisible(o) local f = o while f do if not rawget(f, "shown") then return false end f = rawget(f, "parent") end return true end
function methods.SetScript(o, k, fn) o.scripts[k] = fn end
function methods.HookScript(o, k, fn) local was = o.scripts[k] o.scripts[k] = was and function(...) was(...) fn(...) end or fn end
function methods.GetScript(o, k) return o.scripts[k] end
function methods.RegisterEvent(o, ev) o.events[ev] = true end
function methods.UnregisterEvent(o, ev) o.events[ev] = nil end
function methods.CreateFontString(o) return newObj("FontString", o) end
function methods.CreateTexture(o) return newObj("Texture", o) end
function methods.CreateAnimationGroup(o) return newObj("AnimationGroup", o) end
function methods.CreateAnimation(o) return newObj("Animation", o) end
function methods.IsPlaying() return false end
function methods.SetText(o, t) o.text = t end
function methods.GetText(o) return o.text end
function methods.GetFont() return "font", 14 end
function methods.GetStringWidth(o) return #tostring(o.text or "") * 7 end
function methods.GetUnboundedStringWidth(o) return #tostring(o.text or "") * 7 end
function methods.GetStringHeight(o) return o.text ~= "" and 14 or 0 end
function methods.SetSize(o, w, h) o.width, o.height = w, h end
function methods.SetWidth(o, w) o.width = w end
function methods.SetHeight(o, h) o.height = h end
function methods.GetWidth(o) return o.width or 0 end
function methods.GetHeight(o) return o.height or 0 end
function methods.GetPoint() return "CENTER", nil, "CENTER", 0, 0 end
function CreateFrame(kind, name, parent) return newObj(kind, parent, name) end
function CreateFont(name) return newObj("Font", nil, name) end
UIParent = newObj("Frame")
GameFontHighlight = newObj("Font")
local function fire(ev, ...)
  for _, o in ipairs(all) do
    if o.events[ev] and o.scripts.OnEvent then o.scripts.OnEvent(o, ev, ...) end
  end
end

-- A 60-line timers note for a boss you have reminders for, then assignment lines.
local TAGS = { "Cheoeqar", "Rixxy Djaztech", "ranged", "Gadios", "", "Mage", "G1", "healer" }
local function bigNote()
  local L = { "EncounterID:3470;Difficulty:Mythic;Name:Big Boss" }
  for i = 1, 60 do
    local ph = i <= 40 and 1 or 2
    local t = ph == 1 and (3 + i * 2.5) or (5 + (i - 40) * 3)
    local tag = TAGS[i % #TAGS + 1]
    local body = (i % 3 == 0) and ("text:Left Range Kick " .. i .. ";dur:4;colors:1 0.5 0 1;") or ("spellid:" .. (31884 + i) .. ";")
    L[#L + 1] = "time:" .. t .. ";ph:" .. ph .. ";" .. (tag ~= "" and ("tag:" .. tag .. ";") or "") .. body
  end
  for _, line in ipairs({ "Kick order", "Kicks G1: Rixxy Gadios Cheoeqar", "", "Soak: priest, mage, Newguy" }) do L[#L + 1] = line end
  return table.concat(L, "\\n")
end

local CRT = {
  PALETTE = { accent = { 0.78, 0.56, 0.36 } },
  db = {
    ui = { outline = "" }, classCache = { ["rixxy-area52"] = "PRIEST", ["gadios-area52"] = "WARRIOR" }, roleCache = {},
    groups = { presets = {}, nextId = 1, working = {}, source = "raid" },
    notes = {
      list = { [1] = { raw = bigNote(), name = "Big Boss", encounterID = 3470, difficulty = "Mythic" } },
      nextId = 2, trustedOnly = true, active = 1, showOutsideRaid = false,
      window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, width = 900, height = 3000 },
      assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, width = 500, height = 600 },
      personal = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, width = 500, height = 800 },
      personalText = "Heal CDs: Cheoeqar\\n\\n# My part\\n- **Soak** with Rixxy",
      alert = { enabled = false, seconds = 10, tts = false, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" },
    },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
  UI = { Tint = function() end, OnTheme = function() end, RegisterLayer = function() end, RegisterPreview = function(_, key, fn) PREVIEWS = PREVIEWS or {} PREVIEWS[key] = fn end,
    ResetButtonWidth = function() return 44 end, ResetButton = function(p) return newObj("Button", p) end },
  FONTS = {},
  FontPath = function() return "font" end,
  Print = function() end,
}
CRT_THEME(CRT, CRT.UI)
for i = 1, #files, 2 do
  assert(load(files[i + 1], "@" .. files[i]))("CowfeeRaidTools", CRT)
end
-- Your reminders for the note's boss (the personal window lists them out of a run): a stand-in for Alerts/Reminders.lua.
local remList = {}
for i = 1, 12 do remList[i] = { id = "r" .. i, r = { boss = "Big Boss", text = "Reminder " .. i } } end
CRT.AlertReminders = {
  List = function(_, encounterID) return encounterID == 3470 and remList or {} end,
  Effective = function(_, _, _, r) return r end,
  Items = function(_, _, id) return { { id = id .. ":1", ph = 1, time = 20, text = "Soak " .. id, icon = 136000 }, { id = id .. ":2", ph = 2, time = 40, text = "Move " .. id } } end,
}
fire("PLAYER_LOGIN")
local NW = CRT.NoteWindow
local KEYS = { "window", "assignments", "personal" }

-- The game's frame loop: every visible frame's OnUpdate, dt seconds a frame.
local function tick(seconds, dt)
  dt = dt or 1 / 30
  for _ = 1, math.floor(seconds / dt + 0.5) do
    clock = clock + dt
    for _, o in ipairs(all) do
      local s = o.scripts.OnUpdate
      if s and o:IsVisible() then s(o, dt) end
    end
  end
end
-- Zoning in or out: the game fires ZONE_CHANGED_NEW_AREA, which the windows follow.
local function zone(kind) instanceType = kind fire("ZONE_CHANGED_NEW_AREA") end
local function shown() local n = 0 for _, k in ipairs(KEYS) do if NW:Get(k).frame.shown then n = n + 1 end end return n end
local function cost(seconds)
  local t0 = COUNTS()
  tick(seconds)
  return COUNTS() - t0
end

-- In a raid first: the windows show the note (so their text is built and kept).
zone("raid")
tick(1)
check(shown() == 3, "in a raid the three windows show: " .. shown())
check((NW:Get("window"):DrawnText() or ""):find("Left Range Kick 3", 1, true) ~= nil, "the timers window shows the note")

-- Out of the raid, a city: no window may show. A minute of idle frames.
zone("none")
tick(1)
check(shown() == 0, "out of a raid no window shows: " .. shown())
local tables = cost(60)
print(format("measure idle out of a raid, every window hidden: %d tables a minute", tables))
local IDLE_TABLES = 60
check(tables <= IDLE_TABLES, format("nothing is built while no window can show: at most %d tables a minute, got %d", IDLE_TABLES, tables))

-- Back in a raid: the windows show the note again at once (the next updater pass), with the note as it is now.
CRT.db.notes.list[1].raw = CRT.db.notes.list[1].raw:gsub("Left Range Kick 3;", "Left Range Kick Three;")
zone("raid")
tick(0.2)
check(shown() == 3, "back in a raid the three windows show again: " .. shown())
check((NW:Get("window"):DrawnText() or ""):find("Left Range Kick Three", 1, true) ~= nil, "with the note as it is now")

-- Show outside of raid ticked: they show in the city too; unticked, they hide again.
zone("none")
tick(0.2)
CRT.Notes:Set(nil, "showOutsideRaid", true)
tick(0.2)
check(shown() == 3, "Show outside of raid: the windows show out of a raid: " .. shown())
CRT.Notes:Set(nil, "showOutsideRaid", false)
tick(0.2)
check(shown() == 0, "unticked, they hide again: " .. shown())

-- A preview shows its window wherever you are, and stops building once it ends.
PREVIEWS["note-timers"](true)
tick(0.2)
check(NW:Get("window").frame.shown and not NW:Get("assignments").frame.shown, "the timers preview shows the timers window only")
PREVIEWS["note-timers"](false)
tick(0.2)
check(shown() == 0, "the preview over, it hides: " .. shown())
tables = cost(30)
check(tables <= IDLE_TABLES / 2, format("and builds nothing after: %d tables in 30 s", tables))

-- A window turned off (Show unticked) builds nothing either, even in a raid.
zone("raid")
for _, k in ipairs(KEYS) do CRT.db.notes[k].shown = false end
NW:Changed()
tick(1)
check(shown() == 0, "every window turned off: none shows in a raid: " .. shown())
tables = cost(30)
check(tables <= IDLE_TABLES / 2, format("and none builds: %d tables in 30 s", tables))

for _, e in ipairs(errors) do check(false, "a Lua error: " .. e) end
print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error(fails .. " idle memory checks failed") end
`;

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
lua.lua_pushcfunction(L, (L) => { lua.lua_pushnumber(L, tablesMade); return 1; });
lua.lua_setglobal(L, to_luastring('COUNTS'));
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
for (let i = 0; i < names.length; i++) {
  lua.lua_pushstring(L, to_luastring(names[i]));
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(a[i], 'utf8')));
}
if (lua.lua_pcall(L, names.length * 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
console.log('ok notes idle memory: nothing is built while no note window can show');
