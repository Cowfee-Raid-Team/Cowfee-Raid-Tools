// CRT_Modules/Timeline/ImportReminders.lua and ImportWindow.lua: reminders pasted from another addon's export (the importer names it), on
// mock frames over the real reminders (Alerts/Reminders.lua, Alerts/Draft.lua). The sample export parses (bosses, lines,
// empty text, phases, empty bosses); colours, keys in any order, unknown keys kept, junk lines skipped with a reason, CRLF;
// the tag rule; phase >1 times are phase-relative; Heroic to nh, Mythic to mythic, an unknown difficulty skipped; the
// import writes your reminders with import and never a note; Replace removes only imported ones; no duplicates; and the
// pop-out's preview counts, Import N, disabled with nothing to import, combat, and its status line.
// Usage: node run_timeline_import.js <addon folder>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const FILES = [
  'CRT_Modules/Timeline/Data.lua', 'CRT_Modules/Timeline/Database.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/Lanes.lua',
  'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua',
  'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/Engine.lua',
  'CRT_Modules/Alerts/Reminders.lua', 'CRT_Modules/Alerts/Draft.lua',
  'CRT_Core/UI/CodeBox.lua', 'CRT_Modules/Timeline/ImportReminders.lua', 'CRT_Modules/Timeline/ImportWindow.lua',
  'CRT_Data/Bosses/Registry.lua',
];
// The sample export of 2026-10-31 (factory/samples, not in Git), as it was pasted.
const SAMPLE = `EncounterID:3513;Difficulty:Heroic;Name:Kith'ix
ph:1;time:33.4;tag:11;dur:8;text:;
ph:1;time:70.2;tag:11;dur:8;text:;

EncounterID:3470;Difficulty:Heroic;Name:Nek'zali the Soulcoiler


EncounterID:3445;Difficulty:Heroic;Name:Entombed Sentinels


EncounterID:3497;Difficulty:Heroic;Name:The Lost Explorers
ph:1;time:59.7;tag:11;dur:8;text:Fish Gebbo;

EncounterID:3455;Difficulty:Heroic;Name:Vashnik the Malignant
ph:1;time:20.1;tag:11;dur:8;text:Purple Then Red;
ph:1;time:103.6;tag:11;dur:8;text:Purple Then Orange (grips);
ph:1;time:188.0;tag:11;dur:8;text:Orange Then Red (grips);
ph:1;time:271.5;tag:11;dur:8;text:Purple Then Red;
ph:1;time:355.8;tag:11;dur:8;text:Purple Then Orange (grips);
ph:1;time:439.4;tag:11;dur:8;text:(Last one) Orange Then Red (grips);

EncounterID:3420;Difficulty:Heroic;Name:Sszorak


EncounterID:3421;Difficulty:Heroic;Name:The Twin Fangs


EncounterID:3429;Difficulty:Heroic;Name:The Coiled Altar
ph:2;time:48.1;tag:11;dur:8;text:Last Chance to Incarn;
ph:3;time:161.9;tag:11;dur:8;text:Personal CDs;

EncounterID:3492;Difficulty:Heroic;Name:Ula'tek
ph:1;time:135.5;tag:11;dur:10;text:Damage Amp;
ph:1;time:312.9;tag:11;dur:8;text:Pick Up Eggs;
ph:1;time:322.4;tag:11;dur:8;text:Odds Soak;
ph:1;time:326.5;tag:11;dur:8;text:Evens Soak;
ph:1;time:330.1;tag:11;dur:8;text:Odds Soak;
ph:1;time:334.0;tag:11;dur:8;text:Evens Soak;
ph:1;time:337.7;tag:11;dur:8;text:Odds Soak;
ph:1;time:341.6;tag:11;dur:8;text:Evens Soak;
ph:1;time:371.1;tag:11;dur:8;text:Hard Focus Eggs;
ph:1;time:401.1;tag:11;dur:8;text:Hard Focus Eggs;
ph:1;time:407.5;tag:everyone;dur:20;text:Soak;colors:1.0000 0.0745 0.1529 1;
ph:1;time:412.4;tag:11;dur:8;text:Waves;colors:0.2510 1.0000 0.2980 1;
ph:1;time:435.4;tag:11;dur:8;text:Incoming Bad Overlap;
ph:1;time:445.9;tag:11;dur:8;text:Hard Focus Eggs;
ph:1;time:467.0;tag:11;dur:8;text:Waves;colors:0.2510 1.0000 0.2980 1;
ph:1;time:478.5;tag:everyone;dur:20;text:Soak;colors:1.0000 0.0745 0.1529 1;

EncounterID:3379;Difficulty:Heroic;Name:Nymrissa Wavecaller
`;
const d = process.argv[2];
const harness = themeLua(d) + `
local SAMPLE = select(1, ...)
local sources = { select(2, ...) }
local registry = table.remove(sources)
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, enabled = true, checked = false, text = "", pts = {}, w = 0, h = 0 }
  return setmetatable(m, { __index = function(t, k)
    if type(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" then return function(self, _, _, font) local f = mock("FontString", self) rawset(f, "font", font) return f end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetFocus" then return function(self) rawset(self, "focused", true) end end
    if k == "ClearFocus" then return function(self) rawset(self, "focused", false) end end
    if k == "SetText" then return function(self, s)
      rawset(self, "text", s)
      if self.kind == "EditBox" and rawget(self, "OnTextChanged") then self.OnTextChanged(self, false) end end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return self.enabled end end
    if k == "SetWidth" then return function(self, w) rawset(self, "w", w) end end
    if k == "SetHeight" then return function(self, h) rawset(self, "h", h) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "GetWidth" then return function(self) return self.w end end
    if k == "GetHeight" then return function(self) return self.h end end
    if k == "SetPoint" then return function(self, ...) table.insert(self.pts, { ... }) end end
    if k == "ClearAllPoints" then return function(self) self.pts = {} end end
    if k == "GetParent" then return function(self) return self.parent end end
    if k == "SetScrollChild" then return function(self, c) rawset(self, "scrollChild", c) end end
    if k == "GetFontString" then return function(self) return { GetStringWidth = function() return #(self.text or "") * 6 end } end end
    return function() end end })
end
UIParent = mock("Frame")
UISpecialFrames = {}
tinsert = table.insert
function CreateFrame(kind, name, parent, template) return mock(kind, parent, template) end
local combat = false
function InCombatLockdown() return combat end
C_Timer = { After = function() end }
function GetTime() return 100 end
function issecretvalue() return false end
local errors = {}
function geterrorhandler() return function(e) errors[#errors + 1] = e end end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
SOUNDKIT = { RAID_WARNING = 8959 }
C_TTSSettings = { GetVoiceOptionID = function() return 1 end }
C_VoiceChat = { SpeakText = function() end }
C_Spell = { GetSpellName = function(id) return "Spell" .. id end, GetSpellTexture = function(id) return "tex" .. id end }
function UnitName(u) if u == "player" then return "Solex" end end
function UnitGroupRolesAssigned() return "DAMAGER" end
local classID = 11
function UnitClass() return "Druid", "DRUID", classID end
function IsInRaid() return false end
function GetNumGroupMembers() return 0 end
function GetDifficultyInfo(id) return ({ [16] = "Mythic", [15] = "Heroic" })[id] end
CRTFontNormal, CRTFontSmall, CRTFontEdit, CRTFontEditSmall = {}, {}, {}, {}
local tip = { lines = {} }
GameTooltip = { SetText = function(_, s) tip.title = s tip.lines = {} end, AddLine = function(_, s) tip.lines[#tip.lines + 1] = s end,
  Show = function() tip.shown = true end, Hide = function() tip.shown = false end }

local windows, helps, skinned = {}, {}, { scroll = 0, check = 0 }
local UI = { pages = {}, WINDOW_DEFAULTS = { inset = 8, titleHeight = 26 },
  RegisterLayer = function() end,
  ScrollGutter = function() return 14 end,
  SkinScrollBar = function() skinned.scroll = skinned.scroll + 1 end,
  SkinCheckButton = function() skinned.check = skinned.check + 1 end,
  TooltipOwner = function() end,
  PanelButtonWidth = function(w) return math.max(40, math.ceil(w or 0) + 28) end,
}
function UI.HelpRight(target, title, text) local b = mock("Button", target) helps[title] = text return b end
function UI.PanelButton(parent, label, height, onClick)
  local b = mock("Button", parent, "UIPanelButtonTemplate")
  rawset(b, "text", label) rawset(b, "OnClick", onClick)
  b:SetSize(UI.PanelButtonWidth(#label * 6), height)
  return b
end
function UI.Window(name, opts)
  local f = mock("Frame", UIParent)
  f.shown = false
  rawset(f, "w", opts.width) rawset(f, "h", opts.height)
  f.content = mock("Frame", f)
  rawset(f.content, "w", opts.width - 16) rawset(f.content, "h", opts.height - 30 - 8)
  f.strip = { SetHelp = function(_, title, text) helps[name] = { title = title, text = text } end }
  windows[name] = { frame = f, opts = opts }
  return f
end
local printed = {}
local CRT = {
  version = "1.1.4",
  db = {
    timeline = { references = {}, nextRef = 1, record = true, rows = {}, bosses = {} },
    notes = { list = { [1] = { name = "Ula'tek raid note", encounterID = 3492, text = "{time:0:10} Raid line" } }, nextId = 2, alert = { enabled = true } },
    alerts = { bars = { shown = true }, reminders = {}, phases = {}, overrides = {}, nextId = 1, special = {} },
  },
  UI = UI,
  PlaySound = function() return 1 end,
}
function CRT:Print(m) printed[#printed + 1] = m end
CRT_THEME(CRT, UI)
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
local B, R, I, Win = CRT.Bosses, CRT.AlertReminders, CRT.TimelineImport, CRT.TimelineImportWindow
B:Season({ key = "T", name = "Test season", current = true, raids = { { key = "r", name = "Raid", bosses = { 3492, 3429, 3455 } } } })
B:Register({ encounterID = 3492, name = "Ula'tek", season = "T" })
B:Register({ encounterID = 3429, name = "The Coiled Altar", season = "T" })
B:Register({ encounterID = 3455, name = "Vashnik the Malignant", season = "T" })
handler({ UnregisterEvent = function() end }, "ADDON_LOADED", "CowfeeRaidTools")

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
local function near(a, b) return type(a) == "number" and math.abs(a - b) < 1e-6 end
local function strip(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
local function colorOf(s) return tostring(s or ""):match("^|cff(%x%x%x%x%x%x)") end
local function bossOf(parsed, id) for _, b in ipairs(parsed.bosses) do if b.encounterID == id then return b end end end
local function fresh() CRT.db.alerts.reminders = {} CRT.db.alerts.nextId = 1 combat = false classID = 11 end
local function count(enc) return #R:List(enc) end
local function click(b) assert(b and b.OnClick, "clickable") b.OnClick(b, "LeftButton") end
local function paste(win, text) local edit = win.paste.edit edit.text = text edit.OnTextChanged(edit, true) end

-- Parsing ---------------------------------------------------------------------------------------------------

check("parse: the sample has 10 bosses, with their lines", function()
  local p = I.Parse(SAMPLE)
  assert(#p.bosses == 10, "10 bosses: " .. #p.bosses)
  assert(#p.skipped == 0, "nothing skipped before a boss")
  local ula = bossOf(p, 3492)
  assert(ula.name == "Ula'tek" and ula.difficulty == "Heroic" and #ula.reminders == 16 and #ula.skipped == 0, "Ula'tek: 16 lines: " .. #ula.reminders)
  local kith = bossOf(p, 3513)
  assert(#kith.reminders == 2 and kith.reminders[1].text == "" and kith.reminders[2].text == "", "Kith'ix: 2 lines, empty text")
  assert(#bossOf(p, 3455).reminders == 6, "Vashnik: 6")
  assert(bossOf(p, 3455).reminders[6].text == "(Last one) Orange Then Red (grips)", "brackets and spaces kept: " .. bossOf(p, 3455).reminders[6].text)
  local altar = bossOf(p, 3429)
  assert(#altar.reminders == 2 and altar.reminders[1].ph == 2 and altar.reminders[2].ph == 3, "The Coiled Altar has phases 2 and 3")
  for _, id in ipairs({ 3470, 3445, 3420, 3421, 3379 }) do
    local b = bossOf(p, id)
    assert(b and #b.reminders == 0 and #b.skipped == 0, "an empty boss gives nothing: " .. id)
  end
  local first = ula.reminders[1]
  assert(first.ph == 1 and near(first.time, 135.5) and first.tag == "11" and first.dur == 10 and first.text == "Damage Amp", "a line's fields")
end)

check("parse: colours, keys in any order, unknown keys kept, CRLF", function()
  local text = "EncounterID:3492;Difficulty:Mythic;Name:Ula'tek;Season:12\\r\\n"
    .. "text:  Soak  ;tag:everyone;time:407.5;dur:20;colors:1.0000 0.0745 0.1529 1;ph:1;sound:Bell;\\r\\n"
    .. "time:10;tag:everyone;text:no ph or dur\\r\\n"
  local p = I.Parse(text)
  local b = p.bosses[1]
  assert(b and b.encounterID == 3492 and b.difficulty == "Mythic", "the header over CRLF")
  assert(b.extra and b.extra.Season == "12", "an unknown header field kept")
  local r = b.reminders[1]
  assert(r and r.text == "Soak" and near(r.time, 407.5) and r.dur == 20 and r.ph == 1 and r.tag == "everyone", "any order, text trimmed")
  assert(near(r.color[1], 1) and near(r.color[2], 0.0745) and near(r.color[3], 0.1529) and r.color[4] == 1, "the colour")
  assert(r.extra and r.extra.sound == "Bell", "an unknown key kept")
  local r2 = b.reminders[2]
  assert(r2 and r2.ph == 1 and r2.dur == nil and r2.text == "no ph or dur", "missing ph and dur, and no trailing ;")
end)

check("parse: junk lines are skipped with a reason, never an error", function()
  local text = "hello there\\nEncounterID:3492;Difficulty:Heroic;Name:Ula'tek\\njust words\\nph:1;tag:everyone;text:no time;\\n"
    .. "ph:1;time:soon;tag:everyone;\\nph:x;time:5;tag:everyone;\\nph:1;time:-5;tag:everyone;\\nph:1;time:12;tag:everyone;dur:8;text:ok;colors:red;\\n"
  local p = I.Parse(text)
  assert(#p.skipped == 1 and p.skipped[1].reason == I.TEXT.beforeBoss, "a line before any boss")
  local b = p.bosses[1]
  assert(#b.reminders == 1 and b.reminders[1].text == "ok", "the good line: " .. #b.reminders)
  assert(b.reminders[1].color == nil and b.reminders[1].extra.colors == "red", "a colour that doesn't read is kept as it was")
  local reasons = {}
  for _, s in ipairs(b.skipped) do reasons[#reasons + 1] = s.reason end
  assert(#b.skipped == 5, "5 skipped: " .. table.concat(reasons, " / "))
  assert(reasons[1] == I.TEXT.notReminder and reasons[2] == I.TEXT.noTime, "why: " .. reasons[1] .. ", " .. reasons[2])
  assert(reasons[3]:find("bad time", 1, true) and reasons[4]:find("bad phase", 1, true) and reasons[5]:find("before the pull", 1, true), "why: " .. table.concat(reasons, " / "))
  assert(#I.Parse(nil).bosses == 0 and #I.Parse("").bosses == 0, "nothing in, nothing out")
end)

-- The rules ---------------------------------------------------------------------------------------------------

check("tags: everyone and your own class are imported, another class skipped", function()
  assert(I.ForPlayer("everyone", 11) == true and I.ForPlayer("Everyone", 8) == true, "everyone")
  assert(I.ForPlayer("11", 11) == true, "your class")
  local ok, why = I.ForPlayer("11", 8)
  assert(ok == false and why == "for another tag (11)", "another class: " .. tostring(why))
  local okNone, whyNone = I.ForPlayer(nil, 11)
  assert(okNone == false and whyNone == I.TEXT.noTag, "no tag")
  assert(I.PlayerClassID() == 11, "the player's class from UnitClass")
  classID = 8
  local plan = I.Plan(I.Parse(SAMPLE), I.PlayerClassID())
  local ula
  for _, b in ipairs(plan.bosses) do if b.encounterID == 3492 then ula = b end end
  assert(#ula.reminders == 2 and #ula.skipped == 14, "a mage gets only the two Soaks: " .. #ula.reminders)
  assert(ula.skipped[1].reason == "for another tag (11)", ula.skipped[1].reason)
  assert(ula.reminders[1].import.tag == "everyone", "the tag kept")
  classID = 11
end)

check("times: phase 1 from the pull, a later phase from its start", function()
  assert(I.Times(1, 135.5) == "P1 2:15.5", I.Times(1, 135.5))
  assert(I.Times(2, 48.1) == "P2 +0:48.1", I.Times(2, 48.1))
  assert(I.Times(3, 161.9) == "P3 +2:41.9", I.Times(3, 161.9))
  local list = R.ParseTimes(I.Times(2, 48.1))
  assert(list[1].ph == 2 and near(list[1].t, 48.1), "read back as 48.1 s into phase 2")
  local ref = { phases = { { label = "P2", t = 120 } } }
  assert(near(R.AbsoluteTime(ref, 2, list[1].t), 168.1), "placed from the phase line")
  assert(I.Warn(8) == 8 and I.Warn(nil) == 5 and I.Warn(200) == 60 and I.Warn(0) == 1, "dur as Show from, within its range")
end)

check("difficulty: Heroic and Normal to nh, Mythic to mythic, an unknown one skipped", function()
  assert(I.Group("Heroic") == "nh" and I.Group("normal") == "nh" and I.Group("Mythic") == "mythic", "the groups")
  local g, why = I.Group("Looking For Raid")
  assert(g == nil and why == "unknown difficulty (Looking For Raid)", tostring(why))
  local plan = I.Plan(I.Parse("EncounterID:3492;Difficulty:Story;Name:Ula'tek\\nph:1;time:5;tag:everyone;text:Go;\\n"), 11)
  local b = plan.bosses[1]
  assert(b.reason and #b.reminders == 0 and #b.skipped == 1 and plan.count == 0, "the boss imports nothing, its line skipped")
  local m = I.Plan(I.Parse("EncounterID:3492;Difficulty:Mythic;Name:Ula'tek\\nph:1;time:5;tag:everyone;text:Go;\\n"), 11)
  assert(m.bosses[1].group == "mythic" and m.bosses[1].reminders[1].group == "mythic", "a Mythic reminder")
end)

check("plan: bosses the season knows, and not", function()
  local plan = I.Plan(I.Parse(SAMPLE), 11)
  assert(plan.count == 16 + 2 + 1 + 6 + 2, "27 to import: " .. plan.count)
  for _, b in ipairs(plan.bosses) do
    local want = (b.encounterID == 3492 or b.encounterID == 3429 or b.encounterID == 3455)
    assert(b.known == want, "known: " .. tostring(b.encounterID))
  end
  local kith = plan.bosses[1]
  assert(kith.encounterID == 3513 and kith.name == "Kith'ix" and #kith.reminders == 2, "an unknown boss still imports by its ID")
  local r = kith.reminders[1]
  assert(r.text == I.TEXT.placeholder and r.import.text == "", "empty text: the placeholder, the raw text kept")
end)

-- Writing ---------------------------------------------------------------------------------------------------

check("import: your reminders with import, on the Personal notes row, never a note", function()
  fresh()
  local notes = copy(CRT.db.notes)
  local res = I.Apply(I.Plan(I.Parse(SAMPLE), 11), { replace = true })
  assert(res.added == 27 and res.removed == 0 and res.duplicates == 0 and res.failed == 0, "27 added: " .. res.added)
  assert(same(notes, CRT.db.notes), "the notes are untouched")
  assert(count(3492) == 16 and count(3513) == 2 and count(3429) == 2 and count(3470) == 0, "per boss")
  local soak, waves, amp
  for _, e in ipairs(R:List(3492)) do
    if e.r.text == "Soak" and not soak then soak = e.r end
    if e.r.text == "Waves" and not waves then waves = e.r end
    if e.r.text == "Damage Amp" then amp = e.r end
  end
  assert(amp.times == "P1 2:15.5" and amp.warn == 10 and amp.group == "nh" and amp.color == nil, "Damage Amp: its time, Show from 10, Normal/Heroic")
  assert(amp.boss == "Ula'tek" and amp.enabled == true and amp.outputs.alert and amp.outputs.bar, "the new alert's defaults")
  assert(amp.raidNote == nil and not R.InNote(amp), "Only me, not a Raid note")
  assert(soak.warn == 20 and near(soak.color[1], 1) and near(soak.color[2], 0.0745) and soak.color[4] == 1, "Soak: 20 s, red")
  assert(near(waves.color[2], 1), "Waves: green")
  assert(soak.import.source == "timeline-reminders" and soak.import.tag == "everyone" and soak.import.dur == 20 and near(soak.import.time, 407.5), "import kept")
  local altar = R:List(3429)
  local incarn = altar[1].r
  assert(incarn.times == "P2 +0:48.1" and incarn.text == "Last Chance to Incarn", "48 s into phase 2: " .. incarn.times)
  local times = R:Times(3429, incarn)
  assert(times[1].ph == 2 and near(times[1].t, 48.1), "read as phase 2")
  local items = R:Items(3492, 1, soak)
  assert(#items == 1 and items[1].warn == 20 and items[1].text == "Soak", "the alert shows 20 s before")
end)

check("import: Replace removes only what it imported for those bosses", function()
  fresh()
  R:Save(3492, nil, { text = "My own", times = "P1 1:00", group = "nh", outputs = { alert = true } })
  R:Save(3492, nil, { text = "Old import, Mythic", times = "P1 1:10", group = "mythic", import = { source = "timeline-reminders" } })
  R:Save(3455, nil, { text = "Old import, other boss", times = "P1 1:20", group = "nh", import = { source = "timeline-reminders" } })
  R:Save(3492, nil, { text = "Old import", times = "P1 1:30", group = "nh", import = { source = "timeline-reminders" } })
  local text = "EncounterID:3492;Difficulty:Heroic;Name:Ula'tek\\nph:1;time:5;tag:everyone;text:New;\\n"
  local res = I.Apply(I.Plan(I.Parse(text), 11), { replace = true })
  assert(res.added == 1 and res.removed == 1, "one removed, one added: " .. res.removed .. ", " .. res.added)
  local names = {}
  for _, e in ipairs(R:List(3492)) do names[e.r.text] = true end
  assert(names["My own"] and names["Old import, Mythic"] and names.New and not names["Old import"], "your own and the other group stay")
  assert(count(3455) == 1, "another boss untouched")
end)

check("import: the same paste twice adds nothing, with or without Replace", function()
  fresh()
  local plan = I.Plan(I.Parse(SAMPLE), 11)
  I.Apply(plan, { replace = true })
  local again = I.Apply(I.Plan(I.Parse(SAMPLE), 11), { replace = true })
  assert(again.removed == 27 and again.added == 27 and count(3492) == 16, "replaced: " .. count(3492))
  local third = I.Apply(I.Plan(I.Parse(SAMPLE), 11), { replace = false })
  assert(third.added == 0 and third.duplicates == 27 and count(3492) == 16, "no duplicates without Replace: " .. count(3492))
  -- one you made yourself at the same time and text counts as the same too
  fresh()
  R:Save(3492, nil, { text = "Damage Amp", times = "P1 2:15.5", group = "nh", outputs = { alert = true } })
  local res = I.Apply(I.Plan(I.Parse(SAMPLE), 11), { replace = false })
  assert(res.duplicates == 1 and count(3492) == 16, "your own same reminder is not doubled")
end)

check("import: refused during combat", function()
  fresh()
  combat = true
  local res, err = I.Apply(I.Plan(I.Parse(SAMPLE), 11), { replace = true })
  combat = false
  assert(res == nil and err == I.TEXT.combat and count(3492) == 0, "nothing written")
end)

check("import: the same boss twice in one group (Normal and Heroic) keeps both", function()
  fresh()
  local text = "EncounterID:3492;Difficulty:Normal;Name:Ula'tek\\nph:1;time:5;tag:everyone;text:From Normal;\\n\\n"
    .. "EncounterID:3492;Difficulty:Heroic;Name:Ula'tek\\nph:1;time:9;tag:everyone;text:From Heroic;\\n"
  I.Apply(I.Plan(I.Parse(text), 11), { replace = true })
  local res = I.Apply(I.Plan(I.Parse(text), 11), { replace = true })
  local names = {}
  for _, e in ipairs(R:List(3492)) do names[e.r.text] = (names[e.r.text] or 0) + 1 end
  assert(names["From Normal"] == 1 and names["From Heroic"] == 1, "both kept, once each")
  assert(res.removed == 2 and res.added == 2, "each removed once: " .. res.removed .. ", " .. res.added)
end)

check("import: a line named like a spell-less ability row keeps its own time", function()
  fresh()
  local Ref = CRT.TimelineReference
  local key = assert(Ref:Add("Boss: Ula'tek\\nDifficulty: Heroic\\nEncounter: 3492\\nSoak: 6:40, 7:50"), "the ability timeline")
  -- a hand-made reminder with that name follows the row (the rule for your own reminders)
  local own = R:Save(3492, nil, { text = "Soak", times = "P1 6:41", group = "nh", outputs = { alert = true } })
  assert(R:Get(3492, own).times == nil, "a hand-made Soak moves onto the row")
  R:Delete(3492, own)
  local before = #printed
  local text = "EncounterID:3492;Difficulty:Heroic;Name:Ula'tek\\nph:1;time:407.5;tag:everyone;dur:20;text:Soak;\\n"
  local res = I.Apply(I.Plan(I.Parse(text), 11), { replace = false })
  assert(res.added == 1, "added")
  local r = R:List(3492)[1].r
  assert(r.times == "P1 6:47.5" and r.timesBackup == nil and r.timesMigrated == nil, "its time stays: " .. tostring(r.times))
  assert(not R.FollowsCasts(3492, r, nil, "nh"), "it follows no row")
  local times = R:Times(3492, r, nil, "nh")
  assert(#times == 1 and near(times[1].t, 407.5), "the alert at its own time")
  assert(#printed == before, "no chat line")
  local again = I.Apply(I.Plan(I.Parse(text), 11), { replace = false })
  assert(again.added == 0 and again.duplicates == 1 and #R:List(3492) == 1, "no duplicate")
  R.MigrateAll()
  assert(R:List(3492)[1].r.times == "P1 6:47.5", "the login pass leaves it too")
  Ref:Delete(key)
end)

check("import: the editor keeps an imported reminder's own time box; no name fallback onto the row", function()
  fresh()
  local Ref, D = CRT.TimelineReference, CRT.AlertDraft
  local key = assert(Ref:Add("Boss: Ula'tek\\nDifficulty: Heroic\\nEncounter: 3492\\nSoak: 6:40, 7:50"), "the ability timeline")
  local text = "EncounterID:3492;Difficulty:Heroic;Name:Ula'tek\\nph:1;time:407.5;tag:everyone;dur:20;text:Soak;\\n"
  I.Apply(I.Plan(I.Parse(text), 11), { replace = false })
  local e = R:List(3492)[1]
  local ctx = { encounterID = 3492, id = e.id, reminder = e.r }
  local draft = D.New()
  D.FromReminder(draft, e.r)
  draft.boss, draft.text = "Ula'tek", "Soak"
  assert(not D.FollowsCasts(ctx, draft), "the editor shows Relative to and Time, not the row's casts")
  assert(D.TimesProbe(draft, ctx).import ~= nil, "the probe carries import")
  local hand = D.New()
  hand.text, hand.boss = "Soak", "Ula'tek"
  D.SetGroup(hand, "nh")
  assert(D.FollowsCasts({ encounterID = 3492 }, hand), "a hand-made Soak still follows the row")
  -- an imported reminder with no typed times never takes the row's casts by its name
  local bare = { text = "Soak", group = "nh", import = { source = I.SOURCE } }
  local list, source = R:Times(3492, bare, nil, "nh")
  assert(#list == 0 and source == "none", "no fallback: " .. tostring(source))
  Ref:Delete(key)
end)

check("Alerts:Batch: nested fires once; an error releases the hold, fires and is raised again", function()
  local A = CRT.Alerts
  local fired, counting = 0, true
  A:OnChange(function() if counting then fired = fired + 1 end end)
  A:Batch(function()
    A:Fire()
    A:Batch(function() A:Fire() A:Fire() end)
    assert(fired == 0, "held inside the outer batch")
  end)
  assert(fired == 1, "once at the end: " .. fired)
  fired = 0
  local ok, err = pcall(A.Batch, A, function() A:Fire() error("boom", 0) end)
  assert(not ok and err == "boom", "raised again: " .. tostring(err))
  assert(fired == 1 and (A.batching or 0) == 0, "released and fired: " .. fired)
  A:Fire()
  assert(fired == 2, "Fire works after")
  A:Batch(function() end)
  assert(fired == 2, "a batch with no change fires nothing")
  counting = false
end)

check("parse: a phase must be a whole number", function()
  local p = I.Parse("EncounterID:3492;Difficulty:Heroic;Name:Ula'tek\\nph:1.5;time:5;tag:everyone;text:x;\\n")
  assert(#p.bosses[1].reminders == 0 and p.bosses[1].skipped[1].reason:find("bad phase", 1, true), "1.5 skipped")
end)

check("import: the alerts' change event fires once", function()
  fresh()
  I.Apply(I.Plan(I.Parse(SAMPLE), 11), { replace = true })
  local A = CRT.Alerts
  local fired, counting = 0, true
  A:OnChange(function() if counting then fired = fired + 1 end end)
  local res = I.Apply(I.Plan(I.Parse(SAMPLE), 11), { replace = true })
  counting = false
  assert(res.added == 27 and fired == 1, "one Fire for 27 deletes and 27 saves: " .. fired)
end)

-- The pop-out ---------------------------------------------------------------------------------------------------

check("window: made by UI.Window with a saved place, help in the title strip", function()
  fresh()
  local win = Win.Open()
  local w = windows.CowfeeRaidToolsTimelineImport
  assert(w and w.opts.kind == "dialog" and w.opts.title == "Import reminders" and w.opts.layer == "popups", "the window")
  local place = w.opts.saved()
  assert(type(place) == "table" and CRT.db.timeline.importWindow == place, "its place in timeline.importWindow")
  assert(helps.CowfeeRaidToolsTimelineImport and helps.CowfeeRaidToolsTimelineImport.text:find(I.FORMAT_NAME, 1, true), "its (?) names the format")
  assert(helps[Win.TEXT.replace], "the tick box has a (?)")
  assert(skinned.check >= 1 and skinned.scroll >= 2, "the shared check box and scroll bars")
  assert(win.shown and win.paste.edit.text == "" and win.paste.edit.focused, "empty, ready to paste")
  assert(win.replace.checked, "Replace on by default")
  assert(strip(win.status.text) == Win.TEXT.paste, strip(win.status.text))
  assert(not win.importBtn.enabled and win.importBtn.text == "Import 0", "nothing to import yet")
end)

check("window: the preview counts each boss, Import N", function()
  fresh()
  local win = Win.Window()
  paste(win, SAMPLE)
  local rows = {}
  for _, row in ipairs(win.list.rows) do if row.shown and row.boss then rows[#rows + 1] = row end end
  assert(#rows == 10, "a row per boss: " .. #rows)
  local ula
  for _, row in ipairs(rows) do if row.boss.encounterID == 3492 then ula = row end end
  assert(strip(ula.name.text) == "Ula'tek \\194\\183 Normal/Heroic", strip(ula.name.text))
  assert(strip(ula.count.text) == "16 to import", strip(ula.count.text))
  assert(strip(rows[1].name.text):find("not in this season", 1, true), "an unknown boss says so: " .. strip(rows[1].name.text))
  assert(win.importBtn.text == "Import 27" and win.importBtn.enabled, win.importBtn.text)
  assert(win.importBtn.w == UI.PanelButtonWidth(#"Import 27" * 6), "sized from its label")
  assert(win.closeBtn.text == "Close", "and Close")
  -- a mage: skipped lines, and why, on hover
  classID = 8
  paste(win, SAMPLE)
  for _, row in ipairs(win.list.rows) do if row.boss and row.boss.encounterID == 3492 then ula = row end end
  assert(strip(ula.count.text) == "2 to import \\194\\183 14 skipped", strip(ula.count.text))
  ula.OnEnter(ula)
  assert(tip.shown and tip.title == "Ula'tek" and tip.lines[1] == Win.TEXT.skippedTitle and tip.lines[2]:find("for another tag (11)", 1, true), "why, in the tooltip: " .. tostring(tip.lines[2]))
  assert(win.importBtn.text == "Import 2", win.importBtn.text)
  classID = 11
end)

check("window: the shared code box and scroll box; a long skipped list stops at 15 lines", function()
  local win = Win.Window()
  assert(win.paste.edit and win.paste.scroll and win.paste.innerW == Win.L.width - 16 - 2 * UI.SCROLL_BOX_PAD - 4 - 14, "the paste box is UI.CodeBox")
  assert(win.list.scroll and win.list.child, "the list is in a UI.ScrollBox")
  local lines = { "EncounterID:3492;Difficulty:Heroic;Name:Ula'tek" }
  for i = 1, 20 do lines[#lines + 1] = "ph:1;time:" .. (10 + i) .. ";tag:5;text:Line " .. i .. ";" end
  paste(win, table.concat(lines, "\\n"))
  local row = win.list.rows[1]
  row.OnEnter(row)
  assert(#tip.lines == 1 + 15 + 1, "a title, 15 lines and one more: " .. #tip.lines)
  assert(tip.lines[17] == "and 5 more", tostring(tip.lines[17]))
end)

check("window: disabled with nothing to import", function()
  fresh()
  local win = Win.Window()
  paste(win, "EncounterID:3470;Difficulty:Heroic;Name:Nek'zali the Soulcoiler\\n")
  assert(not win.importBtn.enabled and win.importBtn.text == "Import 0", "an empty boss")
  assert(strip(win.status.text) == Win.TEXT.nothing, strip(win.status.text))
  paste(win, "hello")
  assert(not win.importBtn.enabled and strip(win.status.text) == Win.TEXT.noBoss, strip(win.status.text))
  click(win.importBtn)
  assert(count(3470) == 0, "nothing written")
end)

check("window: Import writes, then the status line says what happened", function()
  fresh()
  local win = Win.Open()
  paste(win, SAMPLE)
  click(win.importBtn)
  assert(count(3492) == 16, "imported")
  assert(strip(win.status.text) == "Imported 27." and colorOf(win.status.text) == UI.Hex("good"), tostring(win.status.text))
  -- again, Replace off (saved), no duplicates
  win.replace.checked = false
  win.replace.OnClick(win.replace)
  assert(CRT.db.timeline.importReplace == false, "the tick is saved")
  click(win.importBtn)
  assert(count(3492) == 16 and strip(win.status.text) == "Imported 0. 27 you already had.", strip(win.status.text))
  win.replace.checked = true
  win.replace.OnClick(win.replace)
  click(win.importBtn)
  assert(count(3492) == 16 and strip(win.status.text) == "Imported 27. Replaced 27.", strip(win.status.text))
  -- a mage: the skipped lines are counted
  classID = 8
  paste(win, SAMPLE)
  click(win.importBtn)
  assert(strip(win.status.text):find("25 skipped.", 1, true), strip(win.status.text))
  classID = 11
  -- combat
  combat = true
  click(win.importBtn)
  combat = false
  assert(strip(win.status.text) == I.TEXT.combat and colorOf(win.status.text) == UI.Hex("bad"), strip(win.status.text))
end)

check("window: everything sits inside it", function()
  local Lw = Win.L
  local win = Win.Window()
  local used = Lw.pasteH + Lw.gap + Lw.listH + Lw.gap + Lw.checkSize + Lw.gap + Lw.statusH + Lw.buttonH
  assert(used <= win.content.h, "fits: " .. used .. " of " .. win.content.h)
  assert(win.importBtn.w + Lw.buttonGap + win.closeBtn.w < win.content.w, "the buttons fit")
end)

check("no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)

print(ok_ .. " passed, " .. fail .. " failed")
if fail > 0 then error(fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, FILES.length + 3);
lua.lua_pushstring(L, to_luastring(SAMPLE));
for (const p of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, FILES.length + 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
