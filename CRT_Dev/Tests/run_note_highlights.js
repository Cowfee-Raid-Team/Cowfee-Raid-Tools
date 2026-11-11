// Assignment highlights (CRT_Modules/Highlights/Data.lua, Page.lua) in the raid note windows (CRT_Modules/Notes/Window.lua).
// Runs the note windows on mocked frames, with the module loaded and without it. Checks:
//   - name match: your name as a whole word, with or without a realm, any case; never inside another word;
//   - group match: G3, Group3 and "group 3" while you are in raid group 3; none for group 4; none outside a raid;
//   - the band and the accent colour only on marked lines, in the assignments window and the timers window;
//   - each option off takes its effect away; the module off draws exactly as the windows without the module;
//   - the glow: only on marked lines a new note changed, never on the first display or after the window opens again;
//   - the preview: the assignments window with the sample note, its lines marked and the line with you glowing;
//   - the page: the switch, the options greyed while it is off, and the preview button.
// usage: node run_note_highlights.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const W = process.argv[2];
if (!W) { console.error('usage: node run_note_highlights.js <addon folder>'); process.exit(2); }
const read = (p) => fs.readFileSync(path.join(W, p), 'utf8');

const harness = themeLua(W) + `
local mode = ...
local files = { select(2, ...) }
local clock = 1000
function GetTime() return clock end
format = string.format
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function date() return "2026-11-11 12:00" end
function InCombatLockdown() return false end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function Ambiguate(name) return name end
function GetNormalizedRealmName() return "Area52" end
function UnitName(u) if u == "player" then return "Cheoeqar" end return nil end
function UnitFullName(u) if u == "player" then return "Cheoeqar", "Area52" end end
function UnitClass(u) if u == "player" then return "Mage", "MAGE" end end
function UnitGroupRolesAssigned() return "DAMAGER" end
C_SpecializationInfo = { GetSpecialization = function() return 1 end,
  GetSpecializationInfo = function() return 62, "Arcane", "", 0, "DAMAGER" end }
-- the raid: you are raid2, in raid group myGroup; raid = false is no raid at all
local raid, myGroup = false, 3
function IsInRaid() return raid end
function IsInInstance() return true, "raid" end
function GetNumGroupMembers() return raid and 5 or 1 end
function GetNumSubgroupMembers() return 0 end
-- you sit at raid index myIndex (slots can have gaps, so it may be past GetNumGroupMembers); rosterFail makes the
-- roster read fail, as a hidden value mid-fight would
local myIndex, rosterFail = 2, false
function UnitInRaid(u) if raid and u == "player" then return myIndex end return nil end
function UnitIsUnit(a, b) return raid and a == "raid" .. myIndex and b == "player" end
function GetRaidRosterInfo(i) if rosterFail then error("hidden") end if i == myIndex then return "Cheoeqar", 0, myGroup end return "Other" .. i, 0, 1 end
function GetDifficultyInfo(id) return ({ [16] = "Mythic" })[id] end
C_Spell = { GetSpellInfo = function(id) return { name = "Spell" .. id, iconID = 100000 + id } end }
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = tostring(e) end end
RAID_CLASS_COLORS = { MAGE = { colorStr = "ff3fc7eb" }, PRIEST = { colorStr = "ffffffff" }, WARRIOR = { colorStr = "ffc69b6d" } }

-- Mock frames: 7 pixels a character, 14 a line.
local all = {}
local methods = {}
local function newObj(kind, parent, layer, sub)
  local o = setmetatable({ kind = kind, parent = parent, shown = true, scripts = {}, events = {}, strings = {}, textures = {},
    children = {}, points = {}, text = "", layer = layer, sub = sub }, { __index = function(t, k)
      local m = methods[k]
      if m then return m end
      return function() end
    end })
  if parent and type(parent) == "table" and parent.children then
    if kind == "FontString" then parent.strings[#parent.strings + 1] = o
    elseif kind == "Texture" then parent.textures[#parent.textures + 1] = o
    else parent.children[#parent.children + 1] = o end
  end
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
function methods.CreateFontString(o, _, layer) return newObj("FontString", o, layer) end
function methods.CreateTexture(o, _, layer, _, sub) return newObj("Texture", o, layer, sub) end
function methods.CreateAnimationGroup(o) local g = newObj("AnimationGroup", o) g.anims = {} return g end
function methods.CreateAnimation(o, kind) local a = newObj("Animation", o) a.animKind = kind o.anims[#o.anims + 1] = a return a end
function methods.SetOrder(o, n) o.order = n end
function methods.SetDuration(o, d) o.duration = d end
function methods.SetStartDelay(o, d) o.delay = d end
function methods.Play(o) o.playing = true o.plays = (rawget(o, "plays") or 0) + 1 end
function methods.Stop(o) o.playing = false end
function methods.IsPlaying(o) return rawget(o, "playing") or false end
-- Text is measured at its font object's size (half the size a character, the size a line), wrapped to its width. A
-- font string's own height, when none is set, is measured when its text or width is set, as the game's are: a new
-- size on its font object alone leaves it as it was.
local function fontSize(o) local f = rawget(o, "font") return type(f) == "table" and rawget(f, "size") or 14 end
local function measureW(o) return #plain(o.text) * fontSize(o) / 2 end
local function measureH(o)
  local w = measureW(o)
  if w == 0 then return 0 end
  local lines = 1
  if rawget(o, "wrap") ~= false and (rawget(o, "width") or 0) > 0 then lines = math.ceil(w / o.width) end
  return lines * fontSize(o)
end
function methods.SetText(o, t) o.text = t o.autoH = measureH(o) end
function methods.GetText(o) return o.text end
function methods.SetFont(o, _, size) o.size = size end
function methods.GetFont(o) return "font", rawget(o, "size") or 14 end
function methods.SetWordWrap(o, v) o.wrap = v end
function methods.GetUnboundedStringWidth(o) return measureW(o) end
function methods.GetStringWidth(o) return measureW(o) end
function methods.GetStringHeight(o) return measureH(o) end
function methods.SetSize(o, w, h)
  o.width, o.height = w, h
  if o.scripts.OnSizeChanged then o.scripts.OnSizeChanged(o, w, h) end
end
function methods.SetWidth(o, w) o.width = w if o.kind == "FontString" then o.autoH = measureH(o) end end
function methods.SetHeight(o, h) o.height = h end
function methods.GetWidth(o) return o.width or 0 end
function methods.GetHeight(o) return rawget(o, "height") or rawget(o, "autoH") or 0 end
function methods.ClearAllPoints(o) o.points = {} end
function methods.SetPoint(o, p, to, rel, x, y) o.points[#o.points + 1] = { p, to, rel, x, y } end
function methods.GetPoint() return "CENTER", nil, "CENTER", 0, 0 end
function methods.SetColorTexture(o, r, g, b, a) o.color = { r, g, b, a } end
function methods.SetTextColor(o, r, g, b, a) o.textColor = { r, g, b, a } end
function methods.SetChecked(o, v) o.checked = v and true or false end
function methods.GetChecked(o) return o.checked or false end
function methods.SetEnabled(o, v) o.enabled = v and true or false end
function methods.SetFontObject(o, f) o.font = f end
function methods.SetAlpha(o, a) o.alpha = a end
function CreateFrame(kind, name, parent) return newObj(kind, parent) end
function CreateFont() return newObj("Font") end
UIParent = newObj("Frame")
GameFontHighlight = newObj("Font")
CRTFontSmall, CRTFontDisableSmall = "CRTFontSmall", "CRTFontDisableSmall"

local function fire(ev, ...)
  for _, o in ipairs(all) do
    if o.events[ev] and o.scripts.OnEvent then o.scripts.OnEvent(o, ev, ...) end
  end
end

local NOTE = table.concat({
  "EncounterID:3470;Difficulty:Mythic;Name:Big Boss",
  "time:10;ph:1;tag:Cheoeqar;spellid:31884;",
  "time:20;ph:1;tag:Rixxy;spellid:31885;",
  "time:30;ph:1;tag:G3;text:Stack left;",
  "time:5;ph:2;tag:Cheoeqar;spellid:31890;",
  "Soak 1: Cheoeqar Gadios",
  "Soak 2: Rixxy Djaztech",
  "Kicks G3: Rixxy Gadios",
  "Group 4: stack right",
  "Cheoeqarson goes home",
}, "\\n")

local previews, pages = {}, {}
local CRT = {
  PALETTE = {},
  db = {
    ui = { outline = "" }, classCache = { ["cheoeqar-area52"] = "MAGE", ["rixxy-area52"] = "PRIEST", ["gadios-area52"] = "WARRIOR" }, roleCache = {},
    groups = { presets = {}, nextId = 1, working = {}, source = "raid" },
    notes = {
      list = { [1] = { raw = NOTE, name = "Big Boss", encounterID = 3470, difficulty = "Mythic" } },
      nextId = 2, trustedOnly = true, active = 1, showOutsideRaid = true,
      window = { shown = true, locked = true, hidePassed = true, onlyMe = false, fontSize = 14, alpha = 100, bgAlpha = 50, width = 900, height = 3000 },
      assignments = { shown = true, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, width = 500, height = 600 },
      personal = { shown = false, locked = true, fontSize = 14, alpha = 100, bgAlpha = 50, width = 500, height = 800 },
      personalText = "",
      alert = { enabled = false, seconds = 10, tts = false, ttsSeconds = 3, ttsVolume = 100, ttsRate = 0, iconPosition = "left" },
    },
    alerts = { bars = { shown = true, noteLines = true, cap = 5, ahead = 20, width = 240, height = 20 },
      reminders = {}, phases = {}, overrides = {}, nextId = 1 },
    highlights = { enabled = false, name = true, group = true, glow = true },
  },
  UI = { RegisterLayer = function() end,
    RegisterPreview = function(_, key, fn) previews[key] = fn end,
    RegisterPage = function(_, key, title, build) pages[key] = { title = title, build = build } end,
    HelpRight = function(target, title, text) target.help = { title = title, text = text } end,
    PreviewButton = function(parent, label, keys, opts)
      local b = newObj("Button", parent)
      b.label, b.keys, b.opts = label, keys, opts
      function b.refresh() local ok = not opts.enabledIf or opts.enabledIf() b.enabled = ok and true or false end
      b.refresh()
      return b
    end,
    ResetButtonWidth = function() return 44 end, ResetButton = function(p) return newObj("Button", p) end },
  FONTS = {},
  FontPath = function() return "font" end,
  Print = function() end,
}
CRT_THEME(CRT, CRT.UI)
for i = 1, #files, 2 do
  assert(load(files[i + 1], "@" .. files[i]))("CowfeeRaidTools", CRT)
end
fire("PLAYER_LOGIN")

local NW, Notes, H = CRT.NoteWindow, CRT.Notes, CRT.NoteHighlights
local fails, passes = 0, 0
local function check(ok, what)
  if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end
end
local function step() clock = clock + 6 NW:RefreshAll() end
local function rowsOf(key) return NW:Get(key).order end
local function rowWith(key, text)
  for _, row in ipairs(rowsOf(key)) do if plain(row.text.text):find(text, 1, true) then return row end end
end
local function banded(row) return row ~= nil and row.band ~= nil and row.band.shown end
local function glowing(row) return row ~= nil and row.glowAnim ~= nil and row.glowAnim:IsPlaying() and row.glow.shown end
local function anyGlow(key)
  for _, row in ipairs(rowsOf(key)) do if glowing(row) then return true end end
  return false
end
local function drawn()
  local out = {}
  for _, key in ipairs({ "window", "assignments", "personal" }) do
    local w = NW:Get(key)
    out[#out + 1] = key .. "|" .. tostring(w.frame.shown) .. "|" .. tostring(w.frame.strings[1].text) .. "|" .. w:DrawnText()
  end
  return table.concat(out, "\\n")
end

step()
local offText = drawn()
if mode == "bare" then
  -- the same windows with no module loaded: the reference for "module off draws as before"
  raid = true
  fire("GROUP_ROSTER_UPDATE")
  step()
  return offText .. "\\n=====\\n" .. drawn(), "", passes, fails
end

local accent = "|cff" .. CRT.UI.Hex("accent")
local S = CRT.db.highlights

-- module off ------------------------------------------------------------------------------------
check(H:Spans("Soak 1: Cheoeqar Gadios") == nil, "module off: no line is marked")
local bandsOff = false
for _, key in ipairs({ "window", "assignments" }) do for _, row in ipairs(rowsOf(key)) do if row.band then bandsOff = true end end end
check(not bandsOff, "module off: no band is made")

-- matching ---------------------------------------------------------------------------------------
S.enabled = true
H:ResetGroup()
local function marks(line) return H:Spans(line) ~= nil end
check(marks("Soak 1: Cheoeqar Gadios"), "name: a whole word marks the line")
check(marks("soak: cheoeqar") and marks("CHEOEQAR soaks"), "name: any case")
check(marks("Soak: Cheoeqar-Area52 Gadios") and marks("Soak: Cheoeqar-Silvermoon"), "name: with a realm")
check(not marks("Cheoeqarson goes home") and not marks("XCheoeqar soaks") and not marks("Soak: Cheo"), "name: never inside another word")
local sp = H:Spans("Soak 1: Cheoeqar Gadios")
check(sp and sp[9] and not sp[18], "name: only the name's word is painted")
check(not marks("Kicks G3: Rixxy") and not marks("Group 3 left"), "group: none outside a raid")
raid = true
H:ResetGroup()
check(marks("Kicks G3: Rixxy") and marks("Group3 left") and marks("Grp3 soaks"), "group: G3, Group3 and Grp3 with you in group 3")
local g = H:Spans("group 3 stacks left")
check(g and g[1] and g[7], "group: \\"group 3\\" paints both words")
check(not marks("Kicks G4: Rixxy") and not marks("group 4 left") and not marks("G 13 is far"), "group: none for group 4")
check(not marks("Group: 3 people") , "group: a word between Group and the number breaks it")
check(H:TagSpans({ "Cheoeqar-Area52" }) ~= nil and H:TagSpans({ "G3" }) ~= nil and H:TagSpans({ "Group", "3" })[2] == true, "tags: a name with a realm, G3 and Group 3")
check(H:TagSpans({ "G4", "Rixxy" }) == nil, "tags: another group and another player are not marked")
myGroup = 4
H:ResetGroup()
check(marks("Group 4: stack right") and not marks("Kicks G3: Rixxy"), "group: follows the roster's group")
myGroup = 3
H:ResetGroup()

-- rendering ---------------------------------------------------------------------------------------
NW:Changed()
step()
local mine, other, kick, four, son = rowWith("assignments", "Soak 1"), rowWith("assignments", "Soak 2"), rowWith("assignments", "Kicks G3"),
  rowWith("assignments", "Group 4"), rowWith("assignments", "Cheoeqarson")
check(banded(mine) and banded(kick), "band: the lines with your name and your group")
check(not banded(other) and not banded(four) and not banded(son), "band: none on lines about others")
check(mine and mine.band.layer == "ARTWORK" and mine.band.sub == 1 and mine.band.color and math.abs(mine.band.color[4] - H.BAND_ALPHA) < 1e-6,
  "band: the accent at low alpha, under the text")
check(mine and mine.text.text:find(accent .. "Cheoeqar|r", 1, true) ~= nil, "colour: your name in the accent")
check(kick and kick.text.text:find(accent .. "G3|r", 1, true) ~= nil, "colour: your group's word in the accent")
check(other and not other.text.text:find(accent, 1, true) and son and not son.text.text:find(accent, 1, true), "colour: lines about others keep their colours")
local tmine, tother, tgroup = rowWith("window", "Spell31884"), rowWith("window", "Spell31885"), rowWith("window", "Stack left")
check(banded(tmine) and banded(tgroup) and not banded(tother), "timers window: the band on your timers and your group's")
check(tmine and tmine.text.text:find(accent .. "Cheoeqar|r", 1, true) ~= nil, "timers window: your name in the accent")
check(not anyGlow("assignments") and not anyGlow("window"), "glow: none on the first display with the module on")

-- options ------------------------------------------------------------------------------------------
S.name = false
NW:Changed()
step()
mine = rowWith("assignments", "Soak 1")
check(not banded(mine) and banded(rowWith("assignments", "Kicks G3")), "Highlight my name off: no band for your name, still for your group")
check(mine and not mine.text.text:find(accent, 1, true) and mine.text.text:find("|cff" .. CRT.UI.Hex("heading") .. "Cheoeqar|r", 1, true) ~= nil,
  "Highlight my name off: your name back in the heading colour, as before")
S.name, S.group = true, false
NW:Changed()
step()
check(banded(rowWith("assignments", "Soak 1")) and not banded(rowWith("assignments", "Kicks G3")), "Highlight my group off: no band for your group, still for your name")
check(not rowWith("assignments", "Kicks G3").text.text:find(accent, 1, true), "Highlight my group off: the group word not painted")
S.group = true
S.enabled = false
NW:Changed()
step()
-- compared in JS with the windows without the module, in the same raid
local offAgain = drawn()
local bandsLeft = false
for _, key in ipairs({ "window", "assignments" }) do for _, row in ipairs(rowsOf(key)) do if banded(row) then bandsLeft = true end end end
check(not bandsLeft, "module off again: no band left on screen")
S.enabled = true
NW:Changed()
step()
check(drawn() ~= offAgain, "module on: the windows draw differently from off")

-- changes --------------------------------------------------------------------------------------------
check(not anyGlow("assignments"), "glow: switching the module on glows nothing")
local function edit(from, to)
  local r = CRT.db.notes.list[1]
  r.raw = r.raw:gsub(from, to)
  Notes:Fire()
  -- a moment later, inside the glow (a ghost lasts as long as its glow)
  clock = clock + 0.5
  NW:RefreshAll()
end
local function stopGlows()
  for _, key in ipairs({ "window", "assignments" }) do
    for _, row in ipairs(rowsOf(key)) do if row.glowAnim then row.glowAnim:Stop() end end
  end
end
local function kindOf(row) return glowing(row) and row.glowKind or nil end
local function tagColour(row, key)
  local c, p = row and row.tag and row.tag.textColor, CRT.PALETTE[key]
  return c ~= nil and math.abs(c[1] - p[1]) < 1e-6 and math.abs(c[2] - p[2]) < 1e-6 and math.abs(c[3] - p[3]) < 1e-6
end

-- only other names changed on your line: no change to your assignment
edit("Soak 1: Cheoeqar Gadios", "Soak 1: Cheoeqar Djaztech")
check(not anyGlow("assignments"), "no glow: only other names changed on your line")
edit("Soak 2: Rixxy Djaztech", "Soak 2: Rixxy Teronhorefnd")
check(not anyGlow("assignments"), "no glow: a changed line about others")

-- Added
edit("Soak 2: Rixxy Teronhorefnd", "Soak 2: Rixxy Cheoeqar")
local added = rowWith("assignments", "Soak 2")
check(kindOf(added) == "added" and added.tag.text == H.TEXT.added and tagColour(added, "good") and added.tag.shown and added.tagAnim:IsPlaying(),
  "Added: a line you were put on glows with Added in the good colour")
check(not glowing(rowWith("assignments", "Soak 1")) and not glowing(rowWith("assignments", "Kicks G3")), "Added: your other lines stay still")
local total = 0
for _, a in ipairs(added.glowAnim.anims) do total = total + (a.duration or 0) end
check(math.abs(total - H.GLOW_SECONDS) < 1e-6 and H.GLOW_SECONDS >= 2.5 and H.GLOW_SECONDS <= 3.5, "glow: about 3 seconds of pulses")
stopGlows()

-- Removed, the line still there
edit("Soak 2: Rixxy Cheoeqar", "Soak 2: Rixxy Teronhorefnd")
local removed = rowWith("assignments", "Soak 2")
check(kindOf(removed) == "removed" and removed.tag.text == H.TEXT.removed and tagColour(removed, "bad") and not banded(removed),
  "Removed: a line you were taken off glows with Removed in the bad colour, with no band")
stopGlows()

-- Removed, the line gone: a muted ghost of it, at its place, until its glow ends
edit("Soak 1: Cheoeqar Djaztech\\n", "")
local ghost = rowWith("assignments", "Soak 1: Cheoeqar Djaztech")
check(ghost ~= nil and ghost.line.hlGhost and kindOf(ghost) == "removed" and tagColour(ghost, "bad")
  and ghost.text.text:find("|cff" .. CRT.UI.Hex("muted"), 1, true) == 1, "Removed: a line gone shows as a muted ghost with Removed")
check(rowsOf("assignments")[1] == ghost, "Removed: the ghost stands where the line was")
ghost.glowAnim:Stop()
ghost.glowAnim.scripts.OnFinished()
step()
check(rowWith("assignments", "Soak 1: Cheoeqar Djaztech") == nil, "Removed: the ghost goes once its glow ends")

-- Moved: off one line and onto another in one change
edit("Soak 2: Rixxy Teronhorefnd", "Soak 1: Cheoeqar Gadios\\nSoak 2: Rixxy Teronhorefnd")
check(kindOf(rowWith("assignments", "Soak 1")) == "added", "Added: a new line naming you")
stopGlows()
do
  local r = CRT.db.notes.list[1]
  r.raw = r.raw:gsub("Soak 1: Cheoeqar Gadios", "Soak 1: Gadios Djaztech"):gsub("Soak 2: Rixxy Teronhorefnd", "Soak 2: Rixxy Cheoeqar")
  Notes:Fire()
  step()
end
local moved = rowWith("assignments", "Soak 2")
check(kindOf(moved) == "moved" and moved.tag.text == H.TEXT.moved and tagColour(moved, "warn"), "Moved: the line you moved to glows with Moved in the warn colour")
check(not glowing(rowWith("assignments", "Soak 1")) and not (rowWith("assignments", "Soak 1: Cheoeqar") and rowWith("assignments", "Soak 1: Cheoeqar").line.hlGhost),
  "Moved: the line you left shows no Removed, and the moved line no Added")
stopGlows()
edit("time:10;ph:1;tag:Cheoeqar;spellid:31884;", "time:12;ph:1;tag:Cheoeqar;spellid:31884;")
check(kindOf(rowWith("window", "Spell31884")) == "moved", "Moved: your timer at a new time says Moved in the timers window")
check(not glowing(rowWith("window", "Stack left")), "glow: an unchanged timer for your group stays still")
stopGlows()

-- the window closed and opened again: its first draw glows nothing
CRT.db.notes.assignments.shown = false
step()
edit("Group 4: stack right", "Group 4: stack right with Cheoeqar")
CRT.db.notes.assignments.shown = true
NW:Changed()
step()
local g4 = rowWith("assignments", "Group 4")
check(banded(g4) and not glowing(g4), "glow: none on the first display after the window opens again")
S.glow = false
NW:Changed()
step()
edit("Group 4: stack right with Cheoeqar", "Group 4: stack right")
edit("Soak 1: Gadios Djaztech", "Soak 1: Gadios Cheoeqar")
check(not anyGlow("assignments") and banded(rowWith("assignments", "Soak 1")), "Glow when a line with me changes off: the band but no glow")
local aw = NW:Get("assignments")
check(rowWith("assignments", "Kicks G3").text.width == 500 - 16, "Glow off: a marked line keeps no room for the tag")
S.glow = true
NW:Changed()
step()
local roomRow = rowWith("assignments", "Kicks G3")
check(H.Room(aw) > 0 and roomRow.text.width == 500 - 16 - H.Room(aw) and rowWith("assignments", "Group 4").text.width == 500 - 16,
  "tag room: a marked line's text leaves room at its end for the tag; other lines keep the whole width")
edit("Group 4: stack right", "Group 4: stack right with Cheoeqar")
local tagged = rowWith("assignments", "Group 4")
local tp = tagged.tag and tagged.tag.points[1]
check(glowing(tagged) and tp and tp[1] == "LEFT" and tp[2] == tagged.text and tp[3] == "TOPRIGHT" and tp[5] == -7,
  "tag: after the line's text, centred on its first line")

-- heights: a row's band and glow cover exactly its text, at any font size, wrapped lines too
local function bandHeight(row, region)
  local top, bottom
  for _, p in ipairs(region.points) do
    if p[1] == "TOPLEFT" then top = p elseif p[1] == "BOTTOMRIGHT" then bottom = p end
  end
  if not (top and bottom) or bottom[2] ~= row.text then return nil end
  -- the band's top is on the text, or on the time cell the text sits level with
  local tp1 = row.text.points[1]
  local level = top[2] == row.text or (top[2] == row.time and tp1 and tp1[2] == row.time and tp1[5] == 0)
  if not level then return nil end
  return row.text:GetHeight() + top[5] - bottom[5]
end
local function heightsAt(size, what)
  local checked, bad = 0, nil
  for _, key in ipairs({ "window", "assignments" }) do
    for _, row in ipairs(rowsOf(key)) do
      local want = math.max(size, row.text:GetStringHeight())
      if row.text.shown and row.text:GetHeight() ~= want then bad = bad or (key .. " row " .. plain(row.text.text) .. " is " .. row.text:GetHeight() .. " for " .. want) end
      if banded(row) then
        checked = checked + 1
        local h = bandHeight(row, row.band)
        if h ~= want then bad = bad or (key .. " band " .. tostring(h) .. " for " .. want) end
      end
      if glowing(row) then
        local h = bandHeight(row, row.glow)
        if h ~= want then bad = bad or (key .. " glow " .. tostring(h) .. " for " .. want) end
      end
    end
  end
  check(checked >= 4 and bad == nil, what .. (bad and (": " .. bad) or ""))
end
edit("Soak 1: Gadios Cheoeqar", "Soak 1: Gadios Cheoeqar\\nSoak 9: Cheoeqar and then a long walk around the left side of the room")
local long = rowWith("assignments", "a long walk")
check(long and long.text:GetStringHeight() == 28 and glowing(long), "height: the long line wraps to two lines at 14 pt")
heightsAt(14, "height at 14 pt: every band and glow covers exactly its row's text, the wrapped line too")
CRT.db.notes.assignments.fontSize, CRT.db.notes.window.fontSize = 22, 22
Notes:Fire()
step()
long = rowWith("assignments", "a long walk")
check(long and long.text:GetStringHeight() >= 44, "height: the long line still wraps at 22 pt")
heightsAt(22, "height at 22 pt: every band and glow covers exactly its row's text, the wrapped line too")
local tp22 = long.tag.points[1]
check(tp22 and tp22[1] == "LEFT" and tp22[5] == -11, "tag: centred on the first line at 22 pt")
CRT.db.notes.assignments.fontSize, CRT.db.notes.window.fontSize = 14, 14
Notes:Fire()
step()
heightsAt(14, "height back at 14 pt: the rows and bands follow the font back")
stopGlows()

-- lines coming into view are not changes
CRT.db.notes.window.onlyMe = true
NW:Changed()
step()
CRT.db.notes.window.onlyMe = false
NW:Changed()
step()
check(not anyGlow("window"), "glow: lines Show only me hid never glow when they come back")
fire("ENCOUNTER_START", 3470, "Big Boss", 16)
step()
check(rowWith("window", "Spell31890") == nil and rowWith("window", "Phase 2 starts") ~= nil, "pull: phase 2's timer waits for Next phase")
check(not anyGlow("window"), "glow: none at the pull")
CRT.NoteEngine:NextPhase()
clock = clock + 1 -- the phase 2 timer comes 5 s after the phase start
NW:RefreshAll()
check(banded(rowWith("window", "Spell31890")) and not glowing(rowWith("window", "Spell31890")), "glow: none on your phase 2 timer at the phase start")
for _ = 1, 8 do step() end
check(rowWith("window", "Spell31884") == nil, "pull: passed and cut lines are gone")
fire("ENCOUNTER_END", 3470, "Big Boss", 16, 20, 0)
step()
check(rowWith("window", "Spell31884") ~= nil and not anyGlow("window"), "glow: none when a wipe brings every line back")

-- another note is not a change; the same boss's note shared again is
CRT.db.notes.list[2] = { raw = "EncounterID:3471;Difficulty:Mythic;Name:Next Boss\\ntime:5;ph:1;tag:Cheoeqar;spellid:31891;\\nSoak 1: Cheoeqar Rixxy", name = "Next Boss", encounterID = 3471, difficulty = "Mythic" }
Notes:SetActive(2)
step()
check(banded(rowWith("assignments", "Soak 1")) and not anyGlow("assignments") and not anyGlow("window"), "glow: none when another note becomes the one shown")
Notes:SetActive(1)
step()
check(not anyGlow("assignments") and not anyGlow("window"), "glow: none when switching back to the first note")
CRT.db.notes.list[3] = { raw = CRT.db.notes.list[1].raw:gsub("Soak 2: Rixxy Cheoeqar", "Soak 2: Rixxy Djaztech"), name = "Big Boss", encounterID = 3470, difficulty = "Mythic" }
Notes:SetActive(3)
step()
check(kindOf(rowWith("assignments", "Soak 2")) == "removed" and not glowing(rowWith("assignments", "Soak 1")), "glow: the same boss's note shared again as a new record shows your change")
Notes:SetActive(1)
step()
stopGlows()

-- your group: the raid index from UnitInRaid, and a failed read keeps the last group
myIndex = 7
H:ResetGroup()
check(H:MyGroup() == 3, "group: read at the raid index UnitInRaid gives, past the member count")
rosterFail, myGroup = true, 5
H:ResetGroup()
check(H:MyGroup() == 3, "group: a failed roster read in a raid keeps the last group")
rosterFail = false
H:ResetGroup()
check(H:MyGroup() == 5, "group: read again once the roster can be read")
myIndex, myGroup = 2, 3
H:ResetGroup()

-- nothing runs with the module off
local keyCalls, timerKey = 0, H.TimerKey
H.TimerKey = function(...) keyCalls = keyCalls + 1 return timerKey(...) end
S.enabled = false
NW:Changed()
step()
check(keyCalls == 0, "module off: no timer key is worked out")
local keysLeft = false
for _, row in ipairs(rowsOf("assignments")) do if row.line.hlId or row.line.hl then keysLeft = true end end
check(not keysLeft, "module off: no line keeps a mark or a key")
H.TimerKey = timerKey
S.enabled = true
NW:Changed()
step()

-- preview ---------------------------------------------------------------------------------------------
CRT.db.notes.assignments.shown = false
step()
previews[H.PREVIEW_KEY](true)
local w = NW:Get("assignments")
check(w.frame.shown and tostring(w.frame.strings[1].text):find("sample", 1, true) ~= nil, "preview: the assignments window shows the sample")
check(banded(rowWith("assignments", "Soak 1: Cheoeqar")) and banded(rowWith("assignments", "Kicks G3")), "preview: the sample's lines with you and your group are marked")
check(kindOf(rowWith("assignments", "Soak 1: Cheoeqar")) == "added" and kindOf(rowWith("assignments", "Kicks G3")) == "moved" and not banded(rowWith("assignments", "Soak 2")),
  "preview: Added and Moved on the sample's lines; others unchanged")
local sghost = rowWith("assignments", "Soak 3: Cheoeqar")
check(sghost and sghost.line.hlGhost and kindOf(sghost) == "removed" and rowsOf("assignments")[4] == sghost and not glowing(rowWith("assignments", "Group 3")),
  "preview: a Removed ghost under Soak 2; the group line only banded")
previews[H.PREVIEW_KEY](false)
check(not w.frame.shown, "preview off: the window goes back to hidden")
CRT.db.notes.assignments.shown = true
-- out of a raid: the sample's group 1 stays in the sample; the note in use never glows against the sample
raid = false
H:ResetGroup()
NW:Changed()
step()
stopGlows()
previews[H.PREVIEW_KEY](true)
check(banded(rowWith("assignments", "Kicks G1")) and H:MyGroup() == nil and H:Spans("Kicks G1: Rixxy") == nil,
  "preview out of a raid: the sample matches group 1, the real note does not")
stopGlows()
previews[H.PREVIEW_KEY](false)
check(w.frame.shown and tostring(w.frame.strings[1].text):find("Big Boss", 1, true) and not anyGlow("assignments"),
  "preview off: the note in use comes back with no glow")
raid = true
H:ResetGroup()
NW:Changed()
step()

-- page -------------------------------------------------------------------------------------------------
local pf = newObj("Frame", UIParent)
check(pages.highlights ~= nil and pages.highlights.title == "Assignment highlights", "page: registered as Assignment highlights")
pages.highlights.build(pf)
local P = pf
check(P.enable and P.enable.label.text == "Use assignment highlights" and P.enable.label.help and P.enable.label.help.text ~= "", "page: the switch with its (?)")
S.enabled = false
pf.scripts.OnShow(pf)
check(P.name.enabled == false and P.group.enabled == false and P.glow.enabled == false and P.name.label.font == "CRTFontDisableSmall",
  "page: the three options greyed while the switch is off")
check(P.preview.enabled == false, "page: Preview highlights greyed while the switch is off")
P.enable:SetChecked(true)
P.enable.scripts.OnClick(P.enable)
check(S.enabled == true and P.name.enabled and P.group.enabled and P.glow.enabled and P.name.label.font == "CRTFontSmall", "page: ticking the switch turns the module on and the options back")
P.preview.refresh()
check(P.preview.enabled == true and P.preview.keys[1] == H.PREVIEW_KEY, "page: Preview highlights works once it is on")
P.group:SetChecked(false)
P.group.scripts.OnClick(P.group)
check(S.group == false, "page: Highlight my group sets its setting")
S.group = true

for _, e in ipairs(errors) do fails = fails + 1 print("FAIL error " .. e) end
return offText .. "\\n=====\\n" .. offAgain, "", passes, fails
`;

function run(mode, withModule) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L); lua.lua_checkstack(L, 40);
  if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
  lua.lua_pushstring(L, to_luastring(mode));
  const files = ['CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua',
    'CRT_Modules/Notes/Engine.lua', 'CRT_Modules/Groups/Data.lua', 'CRT_Modules/Notes/Window.lua'];
  if (withModule) files.push('CRT_Modules/Highlights/Data.lua', 'CRT_Modules/Highlights/Changes.lua', 'CRT_Modules/Highlights/Page.lua');
  for (const f of files) { lua.lua_pushstring(L, to_luastring(f)); lua.lua_pushstring(L, to_luastring(read(f))); }
  if (lua.lua_pcall(L, 1 + files.length * 2, 4, 0) !== lua.LUA_OK) throw new Error(mode + ': ' + lua.lua_tojsstring(L, -1));
  return { text: lua.lua_tojsstring(L, -4), passes: lua.lua_tonumber(L, -2), fails: lua.lua_tonumber(L, -1) };
}

let failed = 0;
try {
  const bare = run('bare', false);
  const mod = run('module', true);
  failed += mod.fails;
  // the module loaded but off draws every window as the windows with no module at all: out of a raid, and in a raid
  // after it was on and off again
  let same = 0;
  const [off, offAgain] = mod.text.split('\n=====\n');
  const [ref, refRaid] = bare.text.split('\n=====\n');
  for (const [name, got, want] of [['module off', off, ref], ['module off again, in a raid', offAgain, refRaid]]) {
    if (got === want) { same++; console.log('ok ' + name + ': the windows draw exactly as without the module'); }
    else { failed++; console.log('FAIL ' + name + ': the windows draw differently\n  without: ' + want + '\n  off:     ' + got); }
  }
  console.log(`${mod.passes + same} passed, ${failed} failed`);
} catch (e) {
  failed++;
  console.log('FAIL ' + e.message);
}
process.exit(failed ? 1 : 0);
