// CRT_Modules/Notes/AlertShareWindows.lua: the players' Export and Import windows of Mech Alerts, on mock frames, over the
// real share engine (CRT_Core/Share.lua, CRT_Modules/Alerts/Share.lua). Export: the boss, every alert ticked, the code of the
// ticked ones selected; All bosses under headings. Import: the From line, each alert's tag and tick (same as yours unticked),
// Import N writes only the ticked ones, bad codes and combat say so in the error line, a code's unshipped definitions never
// reach a player; the list scrolls and long names cut short with the whole name in the tooltip.
// Usage: node run_alerts_sharewin.js <addon folder>
const fs = require('fs');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const FILES = [
  'CRT_Modules/Timeline/Data.lua', 'CRT_Modules/Timeline/Database.lua', 'CRT_Modules/Timeline/Reference.lua', 'CRT_Modules/Timeline/Lanes.lua',
  'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Speech.lua',
  'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Data.lua', 'CRT_Modules/Notes/Engine.lua',
  'CRT_Modules/Alerts/Reminders.lua', 'CRT_Modules/Alerts/Special.lua', 'CRT_Modules/Alerts/Draft.lua',
  'CRT_Core/Share.lua', 'CRT_Modules/Alerts/Share.lua', 'CRT_Modules/Notes/AlertShareWindows.lua',
  'CRT_Data/Bosses/Registry.lua',
];
const d = process.argv[2];
const harness = themeLua(d) + `
local sources = { ... }
local registry = table.remove(sources)
local function mock(kind, parent, template)
  local m = { kind = kind, parent = parent, template = template, shown = true, enabled = true, checked = false, text = "", pts = {}, w = 0, h = 0 }
  return setmetatable(m, { __index = function(t, k)
    if type(k) ~= "string" or not k:find("^%u") then return nil end
    if k == "CreateFontString" then return function(self, _, _, font) local f = mock("FontString", self) rawset(f, "font", font) return f end end
    if k == "CreateTexture" then return function(self) return mock("Texture", self) end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "HookScript" then return function(self, n, fn) rawset(self, "hook" .. n, fn) end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetFocus" then return function(self) rawset(self, "focused", true) end end
    if k == "ClearFocus" then return function(self) rawset(self, "focused", false) end end
    if k == "HighlightText" then return function(self) rawset(self, "highlighted", true) end end
    -- the game fires OnTextChanged(self, false) when code sets an edit box's text
    if k == "SetText" then return function(self, s)
      rawset(self, "text", s) rawset(self, "highlighted", false)
      if self.kind == "EditBox" and rawget(self, "OnTextChanged") then self.OnTextChanged(self, false) end end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on and true or false) end end
    if k == "GetChecked" then return function(self) return self.checked end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "IsEnabled" then return function(self) return self.enabled end end
    if k == "SetWordWrap" then return function(self, on) rawset(self, "wordWrap", on) end end
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
CRTFontNormal, CRTFontSmall, CRTFontEdit, CRTFontEditSmall = {}, {}, {}, {}
local tip = { lines = {} }
GameTooltip = { SetText = function(_, s) tip.title = s tip.lines = {} end, AddLine = function(_, s) tip.lines[#tip.lines + 1] = s end,
  Show = function() tip.shown = true end, Hide = function() tip.shown = false end }

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

-- CRT.UI: the helpers the windows use, recorded --------------------------------------------------
local windows, dropdowns, helps, skinned = {}, {}, {}, { scroll = 0, check = 0 }
local UI = { pages = {}, WINDOW_DEFAULTS = { inset = 8, titleHeight = 26 },
  RegisterLayer = function() end, RegisterPreview = function() end,
  ScrollGutter = function() return 14 end,
  SkinScrollBar = function() skinned.scroll = skinned.scroll + 1 end,
  SkinCheckButton = function() skinned.check = skinned.check + 1 end,
  TooltipOwner = function() end,
  PanelButtonWidth = function(w) return math.max(40, math.ceil(w or 0) + 28) end,
}
function UI.PanelButton(parent, label, height, onClick)
  local b = mock("Button", parent, "UIPanelButtonTemplate")
  rawset(b, "text", label) rawset(b, "OnClick", onClick)
  b:SetSize(UI.PanelButtonWidth(#label * 6), height)
  return b
end
function UI.Dropdown(parent, label, opts)
  local r = mock("Row", parent) rawset(r, "label", label) rawset(r, "opts", opts)
  rawset(r, "refresh", function() rawset(r, "value", opts.get()) end)
  dropdowns[label] = r
  return r
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
    notes = { list = {}, nextId = 1, alert = { enabled = true } },
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
local B, S, R, AS, Share, Win = CRT.Bosses, CRT.AlertSpecial, CRT.AlertReminders, CRT.AlertShare, CRT.Share, CRT.NoteAlertShare
B:Season({ key = "T", name = "Test season", current = true, raids = { { key = "r", name = "Raid", bosses = { 9001, 9002 } } } })
B:Register({ encounterID = 9001, name = "Test Boss", season = "T", special = {
  { key = "soaks", label = "Orb soaks", when = { row = "Orb Burst" }, who = { mode = "everyone" }, show = { callout = true, bar = true } },
} })
B:Register({ encounterID = 9002, name = "Plain Boss", season = "T" })
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
local FEAST = { spellID = 4242, text = "Ravenous Feast", group = "mythic", outputs = { alert = true, bar = true, speech = true }, ticks = { 1.5, 3.5 }, warn = 6 }
local RUN = { text = "Run out", times = "P1 0:20, 1:00", group = "mythic", outputs = { alert = true, bar = false, speech = true } }
local function mine()
  CRT.db.alerts.reminders = { [9001] = { [1] = copy(FEAST), [2] = copy(RUN) } }
  CRT.db.alerts.nextId = 3
  CRT.db.alerts.special = {}
  S.dev = {}
end
local function click(b) assert(b and b.OnClick, "clickable") b.OnClick(b, "LeftButton") end
local function strip(s) return (tostring(s or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")) end
local function colorOf(s) return tostring(s or ""):match("^|cff(%x%x%x%x%x%x)") end
-- the list's shown rows: { entry, row } in order
local function shownRows(list)
  local out = {}
  for _, row in ipairs(list.rows) do if row.shown and row.entry then out[#out + 1] = row end end
  return out
end
local function rowNamed(list, name)
  for _, row in ipairs(shownRows(list)) do if strip(row.name.text) == name then return row end end
end
local function paste(win, text)
  local edit = win.paste.edit
  edit.text = text
  edit.OnTextChanged(edit, true)
end

check("windows: made by UI.Window, help in the title strip", function()
  mine()
  Win.OpenExport(9001)
  Win.OpenImport()
  local e, i = windows.CowfeeRaidToolsAlertShareExport, windows.CowfeeRaidToolsAlertShareImport
  assert(e and e.opts.kind == "dialog" and e.opts.title == "Export Mech Alerts", "the Export window")
  assert(i and i.opts.kind == "dialog" and i.opts.title == "Import Mech Alerts", "the Import window")
  assert(helps.CowfeeRaidToolsAlertShareExport and helps.CowfeeRaidToolsAlertShareImport, "each has its (?) on the title")
  assert(skinned.scroll >= 4, "every scroll bar skinned: " .. skinned.scroll)
  e.frame:Hide() i.frame:Hide()
end)

check("export: opens on the boss on show, every alert ticked, the code selected for Ctrl+C", function()
  mine()
  local win = Win.OpenExport(9001)
  assert(win.shown, "shown")
  assert(dropdowns.Boss.opts.get() == 9001, "on the boss")
  local rows = shownRows(win.list)
  assert(#rows == 3, "Ravenous Feast, Run out and Orb soaks: " .. #rows)
  for _, row in ipairs(rows) do assert(row.check.checked and row.check.shown, "ticked: " .. strip(row.name.text)) end
  assert(strip(rowNamed(win.list, "Orb soaks").tag.text) == "Special alert" and strip(rowNamed(win.list, "Run out").tag.text) == "Mech Alert", "each says what it is")
  local edit = win.code.edit
  assert(edit.text:find("^!CRT:alerts:1:"), "the code: " .. tostring(edit.text))
  assert(edit.highlighted and edit.focused, "selected, for Ctrl+C")
  assert(strip(win.status.text):find("3 ticked", 1, true), "the line under the list: " .. strip(win.status.text))
  win:Hide()
end)

check("export: the code holds only the ticked alerts", function()
  mine()
  local win = Win.OpenExport(9001)
  click(rowNamed(win.list, "Run out").check.checked and rowNamed(win.list, "Run out") or nil)
  local soaks = rowNamed(win.list, "Orb soaks")
  soaks.check.checked = false
  soaks.check.OnClick(soaks.check)
  local data = Share.Decode(win.code.edit.text, "alerts", 1, AS.CAPS)
  local m = data.boss[9001].mythic
  assert(#m.reminders == 1 and m.reminders[1].text == "Ravenous Feast" and same(m.reminders[1].ticks, { 1.5, 3.5 }), "only Ravenous Feast")
  assert(data.boss[9001].any == nil, "no special choices")
  assert(win.code.edit.highlighted, "selected again")
  assert(strip(win.status.text):find("1 ticked", 1, true), strip(win.status.text))
  -- the ticks stay while the window is open
  win.refresh()
  assert(not rowNamed(win.list, "Run out").check.checked, "unticked stays unticked")
  for _, name in ipairs({ "Run out", "Orb soaks" }) do click(rowNamed(win.list, name)) end
  win:Hide()
end)

check("export: nothing ticked says so, and the box is empty", function()
  mine()
  local win = Win.OpenExport(9001)
  for _, row in ipairs(shownRows(win.list)) do if row.check.checked then click(row) end end
  assert(win.code.edit.text == "", "no code")
  assert(strip(win.status.text) == "Nothing ticked." and colorOf(win.status.text) == UI.Hex("bad"), "said in the bad colour: " .. tostring(win.status.text))
  for _, row in ipairs(shownRows(win.list)) do click(row) end
  CRT.db.alerts.reminders = {}
  dropdowns.Boss.opts.set(9002)
  assert(strip(win.status.text) == AS.TEXT.nothing, "a boss with nothing: " .. strip(win.status.text))
  win:Hide()
end)

check("export: All bosses lists each boss under its heading, in route order", function()
  mine()
  CRT.db.alerts.reminders[9002] = { [5] = { text = "Plain", times = "0:10", outputs = { alert = true } } }
  local win = Win.OpenExport(9001)
  dropdowns.Boss.opts.set("all")
  local rows = shownRows(win.list)
  assert(rows[1].entry.heading and strip(rows[1].name.text) == "Test Boss" and not rows[1].check.shown, "Test Boss's heading first: " .. strip(rows[1].name.text))
  local plainHead
  for i, row in ipairs(rows) do if row.entry.heading and strip(row.name.text) == "Plain Boss" then plainHead = i end end
  assert(plainHead and strip(rows[plainHead + 1].name.text) == "Plain", "then Plain Boss with its alert")
  local data = Share.Decode(win.code.edit.text, "alerts", 1, AS.CAPS)
  assert(data.boss[9001] and data.boss[9002], "both bosses in the code")
  win:Hide()
end)

check("export: typing in the code box puts the code back", function()
  mine()
  local win = Win.OpenExport(9001)
  local code = win.code.edit.text
  win.code.edit.text = "oops"
  win.code.edit.OnTextChanged(win.code.edit, true)
  assert(win.code.edit.text == code and win.code.edit.highlighted, "the code, selected")
  win:Hide()
end)

local code
check("import: the From line, and each alert's tag and tick", function()
  mine()
  local ex = Win.OpenExport(9001)
  code = ex.code.edit.text
  ex:Hide()
  -- Ravenous Feast's ticks changed, Run out deleted, Orb soaks as it was
  CRT.db.alerts.reminders[9001][1].ticks = { 9 }
  CRT.db.alerts.reminders[9001][2] = nil
  local win = Win.OpenImport()
  assert(win.shown and win.paste.edit.text == "" and win.paste.edit.focused, "the box empty, ready to paste")
  assert(strip(win.status.text) == "Paste a code in the box.", strip(win.status.text))
  assert(not win.importBtn.enabled, "nothing to import yet")
  paste(win, code)
  assert(win.from.text == "From Solex · Test Boss · Mythic", "the From line: " .. tostring(win.from.text))
  local feast, run, soaks = rowNamed(win.list, "Ravenous Feast"), rowNamed(win.list, "Run out"), rowNamed(win.list, "Orb soaks")
  assert(feast and run and soaks, "every alert in the code")
  assert(strip(feast.tag.text) == "replaces yours" and colorOf(feast.tag.text) == UI.Hex("warn") and feast.check.checked, "Ravenous Feast replaces yours, amber, ticked")
  assert(strip(run.tag.text) == "new" and colorOf(run.tag.text) == UI.Hex("good") and run.check.checked, "Run out is new, green, ticked")
  assert(strip(soaks.tag.text) == "same as yours" and colorOf(soaks.tag.text) == UI.Hex("muted") and not soaks.check.checked, "Orb soaks is the same as yours, grey, unticked")
  assert(win.importBtn.text == "Import 2" and win.importBtn.enabled, "Import 2: " .. win.importBtn.text)
  assert(win.importBtn.w == UI.PanelButtonWidth(#"Import 2" * 6), "sized from its label")
  assert(win.cancelBtn.text == "Cancel", "and Cancel")
  assert(#R:List(9001) == 1 and same(R:Get(9001, 1).ticks, { 9 }), "reading changes nothing")
end)

check("import: Import N writes only the ticked alerts", function()
  local _, win = Win.Windows()
  click(rowNamed(win.list, "Run out"))
  assert(win.importBtn.text == "Import 1", "Import 1 after unticking Run out: " .. win.importBtn.text)
  click(win.importBtn)
  assert(same(R:Get(9001, 1).ticks, { 1.5, 3.5 }), "the old ticks are back")
  assert(#R:List(9001) == 1, "Run out, unticked, was not imported")
  assert(strip(win.status.text) == "Imported 1." and colorOf(win.status.text) == UI.Hex("good"), "says so: " .. tostring(win.status.text))
  local feast = rowNamed(win.list, "Ravenous Feast")
  assert(strip(feast.tag.text) == "same as yours" and not feast.check.checked, "read again: Ravenous Feast is the same as yours now")
  assert(strip(rowNamed(win.list, "Run out").tag.text) == "new", "Run out still new")
end)

check("import: the same code again: same as yours, unticked; Import 0 does nothing", function()
  mine()
  local _, win = Win.Windows()
  paste(win, code)
  for _, row in ipairs(shownRows(win.list)) do
    assert(strip(row.tag.text) == "same as yours" and not row.check.checked, "same as yours and unticked: " .. strip(row.name.text))
  end
  assert(win.importBtn.text == "Import 0" and not win.importBtn.enabled, "Import 0, greyed")
  local before = copy(CRT.db.alerts)
  click(win.importBtn)
  assert(same(before, CRT.db.alerts), "nothing changed")
end)

check("import: a code that doesn't read shows the engine's error", function()
  local _, win = Win.Windows()
  paste(win, "hello there")
  assert(strip(win.status.text) == "Not a CRT alerts code." and colorOf(win.status.text) == UI.Hex("bad"), "the error line: " .. tostring(win.status.text))
  assert(#shownRows(win.list) == 0 and win.from.text == "" and not win.importBtn.enabled, "an empty list, nothing to import")
  paste(win, code:sub(1, #code - 6))
  assert(strip(win.status.text):find("^Damaged code"), strip(win.status.text))
end)

check("import: refused during combat, and it says so", function()
  mine()
  CRT.db.alerts.reminders[9001][1].ticks = { 9 }
  local _, win = Win.Windows()
  paste(win, code)
  combat = true
  click(win.importBtn)
  combat = false
  assert(strip(win.status.text) == AS.TEXT.combat and colorOf(win.status.text) == UI.Hex("bad"), "the error line: " .. tostring(win.status.text))
  assert(same(R:Get(9001, 1).ticks, { 9 }), "nothing written")
  assert(rowNamed(win.list, "Ravenous Feast").check.checked, "the ticks stay")
end)

check("import: a special alert definition this CRT doesn't ship never reaches a player", function()
  mine()
  local payload = { v = 1, from = "Dev", boss = { [9001] = { any = {
    defs = { { key = "newOne", label = "Brand new", when = { times = "0:10" }, who = { mode = "everyone" } } },
    special = { newOne = { on = true }, soaks = { on = false } } } } } }
  local _, win = Win.Windows()
  paste(win, Share.Encode("alerts", 1, payload))
  assert(not rowNamed(win.list, "Brand new") and not rowNamed(win.list, "newOne"), "not listed")
  assert(rowNamed(win.list, "Orb soaks"), "the shipped one's choice is")
  click(win.importBtn)
  assert(S:Get(9001, "newOne") == nil and next(S.dev) == nil, "no definition loaded")
  assert((CRT.db.alerts.special[9001] or {}).newOne == nil, "no choice saved for it")
end)

check("lists: a long list scrolls; long names cut short, the whole name in the tooltip", function()
  mine()
  local long = "A reminder with a very long name that runs on well past the edge of the list"
  for i = 1, 30 do CRT.db.alerts.reminders[9001][10 + i] = { text = long .. " " .. i, times = "0:" .. (10 + i), outputs = { alert = true } } end
  local win = Win.OpenExport(9001)
  local list = win.list
  assert(list.child.h > list.h, "the rows are taller than the box, so it scrolls: " .. list.child.h .. " > " .. list.h)
  assert(list.scroll.scrollChild == list.child, "in a scroll frame")
  local row = rowNamed(list, long .. " 1")
  assert(row.name.wordWrap == false, "one line")
  local left, right
  for _, p in ipairs(row.name.pts) do if p[1] == "LEFT" then left = p end if p[1] == "RIGHT" then right = p end end
  assert(left and right and right[2] == row.tag, "the name ends at the tag, so the game cuts it short")
  row.OnEnter(row)
  assert(tip.shown and tip.title == long .. " 1", "the tooltip has the whole name: " .. tostring(tip.title))
  assert(tip.lines[1] == "Test Boss" and tip.lines[2] == "Any difficulty" and tip.lines[3] == "Mech Alert", "and its boss, difficulty and kind")
  win:Hide()
end)

check("windows: everything sits inside the window", function()
  local Lw = Win.L
  local e, i = windows.CowfeeRaidToolsAlertShareExport.frame, windows.CowfeeRaidToolsAlertShareImport.frame
  local exportUsed = Lw.listTop + Lw.exportListH + 6 + Lw.statusH + 4
  assert(exportUsed + 60 <= e.content.h, "Export leaves the code box room: " .. exportUsed .. " of " .. e.content.h)
  local importUsed = Lw.pasteH + 6 + Lw.fromH + 4 + Lw.importListH + 6 + Lw.statusH + Lw.buttonH
  assert(importUsed <= i.content.h, "Import fits: " .. importUsed .. " of " .. i.content.h)
  local bw = i.importBtn.w + Lw.buttonGap + i.cancelBtn.w
  assert(bw < i.content.w, "the buttons fit")
end)

check("no errors raised", function()
  assert(#errors == 0, tostring(errors[1]))
end)

print(ok_ .. " passed, " .. fail .. " failed")
if fail > 0 then error(fail .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_checkstack(L, FILES.length + 2);
for (const p of FILES) lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, FILES.length, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
