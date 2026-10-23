// CRT_Modules/Notes/Window.lua on a large note during a pull: the cost of each refresh, and the same look as before.
// Runs CRT_Dev/Tests/old_Window.lua (the note windows before they kept their lines, the reference for what they
// show) and the current CRT_Modules/Notes/Window.lua in two Lua states on the same mocked clock, 0.1 s a refresh,
// with a 60-line timers note, assignment lines and personal reminders, through Show only me, a phase start, Hide
// lines once passed, a spell named late, a roster change and a theme switch. Checks:
//   - golden: each window's title and text (colours included) are the same as the reference's at every refresh;
//   - the rows: the font strings on screen hold exactly those lines, time cells only where a line has a time;
//   - per refresh: no IsMine, spell or class colour lookups while nothing changed; no SetText when nothing on
//     screen changed; when only seconds changed, SetText only on the time cells that changed;
//   - the class cache is read again only when it changes (Groups/Data.lua counts what it saves);
//   - rows that don't fit the window are hidden; each row sits under the one before.
// Prints the measured costs (per refresh, old and new) as "measure" lines.
// Args: CRT_Modules/Alerts/Rules.lua CRT_Modules/Alerts/Engine.lua CRT_Modules/Notes/Parse.lua CRT_Modules/Notes/Data.lua
//       CRT_Modules/Notes/Engine.lua CRT_Modules/Groups/Data.lua CRT_Modules/Notes/Window.lua
// The reference changes only when the windows' look is meant to change: then update old_Window.lua with it.
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const a = process.argv.slice(2);
if (a.length < 7) { console.error('usage: node run_note_window_perf.js Rules AlertsEngine Parse Data Engine GroupsData Window'); process.exit(2); }
const [rules, alertsEngine, parse, data, engine, groups, windowSrc] = a;
const oldWindow = path.join(__dirname, 'old_Window.lua');
const read = (p) => fs.readFileSync(p, 'utf8');

const harness = themeLua(a) + `
local mode = ...
local files = { select(2, ...) }
local clock = 1000
function GetTime() return clock end
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-10-23 12:00" end
function InCombatLockdown() return false end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function Ambiguate(name) return name end
function GetNormalizedRealmName() return "Area52" end
local party = {} -- { { name, class } }, as party1, party2...
local function member(u) local i = u:match("^party(%d+)$") return i and party[tonumber(i)] end
function UnitName(u) if u == "player" then return "Cheoeqar" end return member(u) and member(u)[1] or nil end
function UnitFullName(u) if u == "player" then return "Cheoeqar", "Area52" end if member(u) then return member(u)[1], "Area52" end end
function UnitClass(u) if u == "player" then return "Mage", "MAGE" end if member(u) then return member(u)[2], member(u)[2] end end
function UnitGroupRolesAssigned() return "DAMAGER" end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
function IsInRaid() return false end
function IsInInstance() return true, "raid" end
function GetNumGroupMembers() return 1 + #party end
function GetNumSubgroupMembers() return #party end
function UnitIsUnit() return false end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
-- spell 88888 is not known to the game until the scenario says so (a spell named late)
local lateKnown = false
C_Spell = { GetSpellInfo = function(id)
  if id == 88888 and not lateKnown then return nil end
  return { name = "Spell" .. id, iconID = 100000 + id }
end }
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end

-- What a refresh costs, counted.
local count = { isMine = 0, spellInfo = 0, colors = 0, classScan = 0, setText = 0, chars = 0 }
local setLog = {}
RAID_CLASS_COLORS = setmetatable({}, { __index = function(_, class)
  count.colors = count.colors + 1
  local c = ({ MAGE = "ff3fc7eb", PRIEST = "ffffffff", WARRIOR = "ffc69b6d", ROGUE = "fffff468", PALADIN = "fff48cba" })[class]
  return c and { colorStr = c } or nil
end })
-- The class cache: thousands of names, and every read of the whole of it counted.
local store = {}
for i = 1, 3000 do store["raider" .. i .. "-area52"] = ({ "MAGE", "PRIEST", "WARRIOR", "ROGUE" })[i % 4 + 1] end
store["cheoeqar-area52"], store["rixxy-area52"], store["djaztech-area52"], store["gadios-area52"] = "MAGE", "PRIEST", "WARRIOR", "ROGUE"
local classCache = setmetatable({}, { __index = store, __newindex = store,
  __pairs = function() count.classScan = count.classScan + 1 return next, store, nil end })

-- Mock frames, with text measured: 7 pixels a character (an icon counts 2), 14 a line, wrapped to the width.
local all, named = {}, {}
local methods = {}
local function newObj(kind, parent, name)
  local o = setmetatable({ kind = kind, parent = parent, shown = true, scripts = {}, events = {},
    strings = {}, children = {}, text = "" }, { __index = function(t, k)
      local m = methods[k]
      if m then return m end
      return function() end
    end })
  if parent and type(parent) == "table" and parent.children then
    if kind == "FontString" then parent.strings[#parent.strings + 1] = o
    elseif kind ~= "Texture" then parent.children[#parent.children + 1] = o end
  end
  if name then named[name] = o end
  all[#all + 1] = o
  return o
end
local function plain(t)
  return (tostring(t or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", "WW"))
end
function methods.Show(o) o.shown = true end
function methods.Hide(o) o.shown = false end
function methods.SetShown(o, v) o.shown = v and true or false end
function methods.IsShown(o) return o.shown end
function methods.SetScript(o, k, fn) o.scripts[k] = fn end
function methods.HookScript(o, k, fn)
  local was = o.scripts[k]
  o.scripts[k] = was and function(...) was(...) fn(...) end or fn
end
function methods.GetScript(o, k) return o.scripts[k] end
function methods.RegisterEvent(o, ev) o.events[ev] = true end
function methods.UnregisterEvent(o, ev) o.events[ev] = nil end
function methods.CreateFontString(o) return newObj("FontString", o) end
function methods.CreateTexture(o) return newObj("Texture", o) end
function methods.CreateAnimationGroup(o) return newObj("AnimationGroup", o) end
function methods.CreateAnimation(o) return newObj("Animation", o) end
function methods.Play(o) o.playing = true end
function methods.Stop(o) o.playing = false end
function methods.IsPlaying(o) return rawget(o, "playing") or false end
function methods.SetText(o, t)
  o.text = t
  count.setText = count.setText + 1
  count.chars = count.chars + #tostring(t or "")
  setLog[#setLog + 1] = o
end
function methods.GetText(o) return o.text end
function methods.GetFont() return "font", 14 end
function methods.SetWordWrap(o, v) o.wrap = v end
function methods.GetUnboundedStringWidth(o) return #plain(o.text) * 7 end
function methods.GetStringWidth(o) return #plain(o.text) * 7 end
function methods.GetStringHeight(o)
  local w = #plain(o.text) * 7
  if w == 0 then return 0 end
  local lines = 1
  if o.wrap ~= false and o.width and o.width > 0 then lines = math.ceil(w / o.width) end
  return lines * 14
end
function methods.SetSize(o, w, h)
  o.width, o.height = w, h
  if o.scripts.OnSizeChanged then o.scripts.OnSizeChanged(o, w, h) end
end
function methods.SetWidth(o, w) o.width = w end
function methods.SetHeight(o, h) o.height = h end
function methods.GetWidth(o) return o.width or 0 end
function methods.GetHeight(o) return o.height or 0 end
function methods.ClearAllPoints(o) o.point = nil end
function methods.SetPoint(o, p, to, rel, x, y) o.point = { p, to, rel, x, y } end
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

-- A 60-line timers note: spells and coloured text lines, for you, your role, your class, other players, a
-- group, no one in particular, and a spell the game names late; then assignment lines.
local TAGS = { "Cheoeqar", "Rixxy Djaztech", "ranged", "Gadios", "", "Mage", "Death Knight", "Newguy", "G1", "healer" }
local function bigNote()
  local L = { "EncounterID:3470;Difficulty:Mythic;Name:Big Boss" }
  for i = 1, 60 do
    local ph = i <= 40 and 1 or 2
    local t = ph == 1 and (3 + i * 2.5) or (5 + (i - 40) * 3)
    local tag = TAGS[i % #TAGS + 1]
    local body
    if i == 7 then
      tag, body = "", "spellid:88888;"
    elseif i % 3 == 0 then
      body = "text:Left Range Kick " .. i .. ";dur:4;colors:1 0.5 0 1;"
    else
      body = "spellid:" .. (31884 + i) .. ";"
    end
    L[#L + 1] = "time:" .. t .. ";ph:" .. ph .. ";" .. (tag ~= "" and ("tag:" .. tag .. ";") or "") .. body
  end
  for _, line in ipairs({ "Kick order", "Kicks G1: Rixxy Gadios Cheoeqar", "", "Soak: priest, mage, Newguy" }) do L[#L + 1] = line end
  return table.concat(L, "\\n")
end
local theirs = "EncounterID:3471;Difficulty:Mythic;Name:Their Boss\\ntime:5;ph:1;tag:Rixxy;text:Theirs;\\ntime:9;ph:1;tag:Gadios;spellid:31885;"

local CRT = {
  PALETTE = { accent = { 0.78, 0.56, 0.36 } },
  db = {
    ui = { outline = "" }, classCache = classCache, roleCache = {},
    groups = { presets = {}, nextId = 1, working = {}, source = "raid" },
    notes = {
      list = { [1] = { raw = bigNote(), name = "Big Boss", encounterID = 3470, difficulty = "Mythic" },
        [2] = { raw = theirs, name = "Their Boss", encounterID = 3471, difficulty = "Mythic" } },
      nextId = 3, trustedOnly = true, active = 1, showOutsideRaid = true,
      window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, width = 900, height = 3000 },
      assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, width = 500, height = 600 },
      personal = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, width = 500, height = 800 },
      personalText = "Heal CDs: Cheoeqar\\n\\n# My part\\n- **Soak** with Rixxy",
      alert = { enabled = false, seconds = 10, tts = false, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" },
    },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
  },
  UI = { Tint = function() end, OnTheme = function() end, RegisterLayer = function() end, RegisterPreview = function() end,
    ResetButtonWidth = function() return 44 end, ResetButton = function(p) return newObj("Button", p) end },
  FONTS = {},
  FontPath = function() return "font" end,
  Print = function() end,
}
CRT_THEME(CRT, CRT.UI)
for i = 1, #files, 2 do
  assert(load(files[i + 1], "@" .. files[i]))("CowfeeRaidTools", CRT)
end

-- Your reminders for the boss (the personal window): a stand-in for Alerts/Reminders.lua, and the run's
-- "mine" block with the same times.
local REMINDERS = {
  { id = "r1", text = "Soak", icon = 136000, times = { { 1, 12 }, { 1, 31 }, { 2, 6 } } },
  { id = "r2", text = "Move out", times = { { 1, 20 }, { 1, 44 } } },
  { id = "r3", text = "Defensive", icon = 136001, times = { { 2, 15 } } },
}
local remList = {}
for _, r in ipairs(REMINDERS) do remList[#remList + 1] = { id = r.id, r = { boss = "Big Boss itself", text = r.text } } end
local function remItems(id)
  local out = {}
  for _, r in ipairs(REMINDERS) do
    if r.id == id or id == nil then
      for n, t in ipairs(r.times) do
        out[#out + 1] = { id = r.id .. ":" .. n, ph = t[1], time = t[2], text = r.text, icon = r.icon,
          priority = CRT.AlertRules.Priority(3, "normal"), warn = 10, hold = 0.5, outputs = { alert = true, bar = true, speech = false } }
      end
    end
  end
  return out
end
CRT.AlertReminders = {
  List = function(_, encounterID) return encounterID == 3470 and remList or {} end,
  Effective = function(_, _, _, r) return r end,
  Items = function(_, _, id) return remItems(id) end,
}
CRT.Alerts:RegisterBlock("mine", { label = "Reminders", group = true, own = true, Entries = function(run)
  if run.encounterID ~= 3470 then return {} end
  return remItems(nil)
end })
fire("PLAYER_LOGIN")

local Engine, Notes, NW, A, G = CRT.NoteEngine, CRT.Notes, CRT.NoteWindow, CRT.Alerts, CRT.Groups
local isMine, spellInfo = Engine.IsMine, Notes.SpellInfo
Engine.IsMine = function(...) count.isMine = count.isMine + 1 return isMine(...) end
Notes.SpellInfo = function(...) count.spellInfo = count.spellInfo + 1 return spellInfo(...) end

local KEYS = { "window", "assignments", "personal" }
local function shownText(key)
  local w = NW:Get(key)
  if mode == "old" then return w.frame.strings[2].text end
  return w:DrawnText()
end

local out, failures, prev = {}, {}, {}
local function fail(msg) if #failures < 30 then failures[#failures + 1] = msg end end
local function snapCounts() local c = {} for k, v in pairs(count) do c[k] = v end return c end

-- The rows on screen (new only): every shown row is a line that is not blank, in order, its time cell shown
-- exactly when the line has a time, and every row fits (the windows here are tall enough for all).
local function checkRows(tag, key)
  local w = NW:Get(key)
  local want = {}
  for _, line in ipairs(w.lines) do
    if not (line.t == nil and line.x == "") then want[#want + 1] = line end
  end
  if #w.order ~= #want then return fail(tag .. " " .. key .. ": " .. #w.order .. " rows for " .. #want .. " lines") end
  for i, row in ipairs(w.order) do
    local line = want[i]
    if not row.text.shown then return fail(tag .. " " .. key .. ": row " .. i .. " hidden") end
    if row.text.text ~= line.x then return fail(tag .. " " .. key .. ": row " .. i .. " text " .. tostring(row.text.text) .. " ~= " .. line.x) end
    if (line.t ~= nil) ~= row.time.shown then return fail(tag .. " " .. key .. ": row " .. i .. " time cell shown " .. tostring(row.time.shown)) end
    if line.t and row.time.text ~= line.t then return fail(tag .. " " .. key .. ": row " .. i .. " time " .. tostring(row.time.text) .. " ~= " .. line.t) end
  end
end

-- Which of this refresh's SetText calls were on a time cell, a text cell or a title.
local function setKinds()
  local cells = {}
  for _, key in ipairs(KEYS) do
    local w = NW:Get(key)
    cells[w.frame.strings[1]] = "title"
    for _, row in ipairs(w.order or {}) do cells[row.time], cells[row.text] = "time", "text" end
    for _, row in ipairs(w.free or {}) do cells[row.time], cells[row.text] = "time", "text" end
  end
  local n = { time = 0, text = 0, title = 0, other = 0 }
  for _, o in ipairs(setLog) do local k = cells[o] or "other" n[k] = n[k] + 1 end
  return n
end

local steady = { ticks = 0, isMine = 0, spellInfo = 0, colors = 0, setText = 0, chars = 0 }
local function snap(tag, opts)
  opts = opts or {}
  for i = #setLog, 1, -1 do setLog[i] = nil end
  local before = snapCounts()
  local t0 = os.clock and os.clock() or 0
  NW:RefreshAll()
  local dt = (os.clock and os.clock() or 0) - t0
  local cur = {}
  for _, key in ipairs(KEYS) do
    local w = NW:Get(key)
    local shown = w.frame.shown
    local title = shown and tostring(w.frame.strings[1].text) or ""
    local text = shown and shownText(key) or ""
    -- one snapshot a line: the text's line breaks written as \\n
    out[#out + 1] = tag .. "|" .. key .. "|" .. tostring(shown) .. "|" .. title .. "|" .. text:gsub("\\n", "\\\\n")
    cur[key] = { shown = shown, title = title, text = text }
    if mode == "new" and shown then checkRows(tag, key) end
  end
  if opts.steady then
    steady.ticks = steady.ticks + 1
    steady.time = (steady.time or 0) + dt
    for _, k in ipairs({ "isMine", "spellInfo", "colors", "setText", "chars" }) do steady[k] = steady[k] + count[k] - before[k] end
  end
  -- the assignments window's rebuild every few seconds (out of a run, as before) reads names too
  local safety = NW:Get("assignments").drawnAt == clock
  if mode == "new" and opts.quiet then
    -- nothing changed but the clock: no lookups at all
    for _, k in ipairs(safety and { "isMine", "classScan" } or { "isMine", "colors", "classScan" }) do
      if count[k] ~= before[k] then fail(tag .. ": " .. k .. " " .. (count[k] - before[k]) .. " on a refresh with no change") end
    end
    if count.spellInfo - before.spellInfo > 1 then fail(tag .. ": spellInfo " .. (count.spellInfo - before.spellInfo)) end
    local same = true
    for _, key in ipairs(KEYS) do
      local p, c = prev[key], cur[key]
      if not p or p.shown ~= c.shown or p.title ~= c.title or p.text ~= c.text then same = false end
    end
    local kinds = setKinds()
    if same and count.setText ~= before.setText then
      fail(tag .. ": " .. (count.setText - before.setText) .. " SetText with nothing changed on screen")
    end
    -- only seconds changed: no text cell is set, and each changed time cell once
    if not same and kinds.text > 0 and not opts.lines then
      fail(tag .. ": " .. kinds.text .. " text cells set when only times changed")
    end
    if kinds.other > 0 then fail(tag .. ": " .. kinds.other .. " SetText outside the rows and titles") end
  end
  prev = cur
end

local marks = {}
-- Out of a run: the full list by phase, the assignments, the planned reminders.
snap("pre")
-- the same again, a moment later: nothing to rebuild
clock = clock + 0.1
snap("pre2", { quiet = true })

-- The pull: 100 s at 0.1 s a refresh.
local pullAt = 2000
clock = pullAt
fire("ENCOUNTER_START", 3470, "Big Boss", 16)
local events = {
  [150] = function() CRT.db.notes.window.onlyMe = true end,
  [220] = function() CRT.db.notes.window.onlyMe = false end,
  [100] = function() lateKnown = true end,
  [300] = function() Engine:NextPhase() end,
  [400] = function() CRT.db.notes.window.hidePassed = false end,
  [480] = function() CRT.db.notes.window.hidePassed = true end,
  [550] = function()
    party = { { "Newguy", "PALADIN" } }
    marks.versionBefore = G.classVersion
    marks.scansBefore = count.classScan
    G:ReadRoster()
    G:ReadRoster() -- the same roster again: nothing new to save
    marks.versionAfter = G.classVersion
    fire("GROUP_ROSTER_UPDATE")
  end,
  [700] = function() CRT.UI.SwitchTheme("midnight") end,
  [760] = function() CRT.UI.SwitchTheme("blizzard") end,
  -- the note saved again: every line's text is built once, and only once
  [850] = function() Notes:Fire() end,
}
marks.scansAtPull = count.classScan
for i = 0, 1000 do
  clock = pullAt + i / 10
  local ev = events[i]
  local before = snapCounts()
  if ev then ev() end
  -- a refresh is quiet when nothing but the clock moved since the last; a line coming or going (a phase
  -- start, a line passed) moves rows, which may set the text of a reused row
  snap("run" .. i, { quiet = i > 0 and not ev and not events[i - 1], steady = i > 0 and i < 100 })
  if i == 549 then marks.scansBefore549 = count.classScan end
  if i == 850 then marks.rebuild = { isMine = count.isMine - before.isMine, spellInfo = count.spellInfo - before.spellInfo } end
end
marks.scansAfter = count.classScan
fire("ENCOUNTER_END", 3470)
clock = clock + 0.1
snap("post")

-- Show only me with nothing for you: the message, before and during a pull.
CRT.db.notes.active = 2
CRT.db.notes.window.onlyMe = true
Notes:Fire()
clock = clock + 0.1
snap("theirs")
pullAt = clock
fire("ENCOUNTER_START", 3471, "Their Boss", 16)
for i = 0, 30 do clock = pullAt + i / 10 snap("theirs-run" .. i) end
fire("ENCOUNTER_END", 3471)
CRT.db.notes.window.onlyMe = false
CRT.db.notes.active = 1
Notes:Fire()
clock = clock + 0.1
snap("back")

-- The checks only the new windows can answer.
if mode == "new" then
  -- the class cache: read once for the pull's first draw at most, then only once more after the roster change
  if marks.scansBefore549 ~= marks.scansAtPull and marks.scansBefore549 - marks.scansAtPull > 1 then
    fail("class cache read " .. (marks.scansBefore549 - marks.scansAtPull) .. " times before the roster changed")
  end
  if marks.scansAfter - marks.scansBefore ~= 1 then
    fail("class cache read " .. (marks.scansAfter - marks.scansBefore) .. " times after the roster change (want 1)")
  end
  -- one content change: IsMine once a timer, the spell's name once a spell line (40 of the 60)
  if mode == "new" and not (marks.rebuild.isMine == 60 and marks.rebuild.spellInfo == 40) then
    fail("one content change: IsMine " .. marks.rebuild.isMine .. " (want 60), SpellInfo " .. marks.rebuild.spellInfo .. " (want 40)")
  end
  if marks.versionAfter - marks.versionBefore ~= 1 then
    fail("class version went up " .. (marks.versionAfter - marks.versionBefore) .. " times for one new class")
  end
  -- the roster's new class colours its name at once
  if not shownText("window"):find("|cfff48cbaNewguy|r", 1, true) then fail("Newguy not coloured after the roster change") end

  -- a short window: the rows that fit, each under the one before, the rest hidden
  CRT.db.notes.window.height = 120
  Notes:Fire()
  clock = clock + 0.1
  NW:RefreshAll()
  local w = NW:Get("window")
  local used, shownRows = 0, 0
  for i, row in ipairs(w.order) do
    used = used + row.gap * 14 + math.max(14, row.text:GetStringHeight())
    local fits = used <= 120 - 36
    if row.text.shown ~= fits then fail("short window: row " .. i .. " shown " .. tostring(row.text.shown) .. ", fits " .. tostring(fits)) break end
    if fits then shownRows = shownRows + 1 end
    local first = row.line.t and row.time or row.text
    local p = first.point
    if i == 1 then
      if not (p and p[2] == w.frame and p[3] == "TOPLEFT" and p[4] == 8 and p[5] == -28 - row.gap * 14) then fail("short window: the first row is not at the top left") end
    else
      local above = w.order[i - 1]
      if not (p and p[2] == above.text and p[3] == "BOTTOMLEFT" and p[4] == -above.cellW) then fail("short window: row " .. i .. " is not under row " .. (i - 1)) break end
    end
  end
  if shownRows < 2 or shownRows >= #w.order then fail("short window: " .. shownRows .. " of " .. #w.order .. " rows shown") end
  -- a resize places the rows again without a rebuild
  local isMineBefore = count.isMine
  w.frame:SetSize(900, 3000)
  NW:RefreshAll()
  if not w.order[#w.order].text.shown then fail("taller window: the last row is still hidden") end
  if count.isMine ~= isMineBefore then fail("a resize rebuilt the lines") end
  CRT.db.notes.window.height = 3000
end
for _, e in ipairs(errors) do failures[#failures + 1] = "error " .. e end

local summary = format("%d refreshes: IsMine %.1f, SpellInfo %.1f, class colours %.1f, SetText %.2f (%.0f characters), %.3f ms; class cache read %d times in the pull",
  steady.ticks, steady.isMine / steady.ticks, steady.spellInfo / steady.ticks, steady.colors / steady.ticks,
  steady.setText / steady.ticks, steady.chars / steady.ticks, (steady.time or 0) * 1000 / steady.ticks, marks.scansAfter - marks.scansAtPull)
return table.concat(out, "\\n"), table.concat(failures, "\\n"), summary
`;

function runState(mode, win) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L); lua.lua_checkstack(L, 40);
  if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
  lua.lua_pushstring(L, to_luastring(mode));
  const files = [['CRT_Modules/Alerts/Rules.lua', rules], ['CRT_Modules/Alerts/Engine.lua', alertsEngine], ['CRT_Modules/Notes/Parse.lua', parse],
    ['CRT_Modules/Notes/Data.lua', data], ['CRT_Modules/Notes/Engine.lua', engine], ['CRT_Modules/Groups/Data.lua', groups], ['CRT_Modules/Notes/Window.lua', win]];
  for (const [name, p] of files) { lua.lua_pushstring(L, to_luastring(name)); lua.lua_pushstring(L, to_luastring(read(p))); }
  const t0 = Date.now();
  if (lua.lua_pcall(L, 1 + files.length * 2, 3, 0) !== lua.LUA_OK) throw new Error(mode + ' side: ' + lua.lua_tojsstring(L, -1));
  const ms = Date.now() - t0;
  return { lines: lua.lua_tojsstring(L, -3).split('\n'), failures: lua.lua_tojsstring(L, -2), summary: lua.lua_tojsstring(L, -1), ms };
}

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}

const oldR = runState('old', oldWindow);
let newR, newErr;
try { newR = runState('new', windowSrc); } catch (e) { newErr = e; }
const need = () => { if (newErr) throw newErr; };

// Refreshes the reference shows later than the new windows, by design: the reference made its class table
// again only every 5 s, and asked again for a spell's name on every refresh (the new windows ask once a second).
function skipped(tag) {
  const m = /^run(\d+)\|/.exec(tag);
  if (!m) return false;
  const i = Number(m[1]);
  return (i >= 550 && i < 610) || (i >= 100 && i < 112);
}
check('golden: every window shows the same title and text as the reference, at every refresh', () => {
  need();
  if (oldR.lines.length !== newR.lines.length) throw new Error(`snapshots: old ${oldR.lines.length}, new ${newR.lines.length}`);
  let compared = 0;
  for (let i = 0; i < oldR.lines.length; i++) {
    if (skipped(oldR.lines[i])) continue;
    compared++;
    if (oldR.lines[i] !== newR.lines[i]) throw new Error(`snapshot ${i}\n  old: ${oldR.lines[i]}\n  new: ${newR.lines[i]}`);
  }
  if (compared < 2500) throw new Error('too few snapshots compared: ' + compared);
});
check('golden: the scenario shows what it is meant to (phases waiting, cut and passed lines, only me)', () => {
  need();
  const at = (tag, key) => newR.lines.find((l) => l.startsWith(tag + '|' + key + '|')) || '';
  if (!/Phase 2 starts on Next phase/.test(at('run100', 'window'))) throw new Error('no waiting phase 2 before Next phase');
  if (/Phase 2 starts on Next phase/.test(at('run310', 'window'))) throw new Error('phase 2 still waits after Next phase');
  if (!/only me/.test(at('run160', 'window'))) throw new Error('Show only me not in the title');
  if (/Left Range Kick 3\b/.test(at('run200', 'window'))) throw new Error('a passed line still shown');
  if (!/Left Range Kick 3\b/.test(at('run420', 'window'))) throw new Error('Hide lines once passed off: the passed line is missing');
  if (/Left Range Kick 15\b/.test(at('run320', 'window'))) throw new Error('a phase 1 line after the phase 2 start is still shown');
  if (!/Nothing in this note is for you/.test(at('theirs', 'window'))) throw new Error('the only me message is missing');
  if (!/Nothing in this note is for you/.test(at('theirs-run10', 'window'))) throw new Error('the only me message is missing during a pull');
  if (!/> 0:/.test(at('run50', 'personal')) || !/Phase 2 starts on Next phase/.test(at('run50', 'personal'))) throw new Error('the personal reminders are not counting: ' + at('run50', 'personal'));
  if (!/Spell88888/.test(at('run120', 'window'))) throw new Error('the late spell is not named');
  if (!/\|cffbdbdbd/.test(at('run720', 'window'))) throw new Error('the theme switch did not reach the timers window');
});
check('per refresh: no rebuild, lookups or SetText when nothing changed; rows hold the lines', () => {
  need();
  if (newR.failures) throw new Error(newR.failures);
});

console.log('measure old (before): ' + oldR.summary + `; whole run ${oldR.ms} ms`);
if (newR) console.log('measure new (after):  ' + newR.summary + `; whole run ${newR.ms} ms`);
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, oldR.lines.join('\n') + '\n=====NEW=====\n' + (newR ? newR.lines.join('\n') : String(newErr)));
if (failed) { console.log(failed + ' failed'); process.exit(1); }
