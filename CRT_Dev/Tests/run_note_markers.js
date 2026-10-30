// Raid marker icons in shown note text (#1223): CRT_Core/MarkerText.lua's CRT.MarkerText turns {rt1} to {rt8} and the
// marker names the game's chat takes ({cross}, {SKULL}, {x}) into |T icons as tall as the line's font, and every place
// a note's text is shown uses it, while the raw text, the boxes you type in, the note sent to another addon and speech
// keep the codes as written. Real files on mock frames: the helper; the Raid Notes read view and the note editor's
// drawn rows (Notes/Render.lua); the note windows' lines (Notes/Window.lua); speech (Alerts/Rules.lua, Engine.lua,
// Speech.lua and CRT_Core/Sound/Engine.lua). The other display paths (the callout, the alert areas, the pop-out
// editor's rows and banners, the Timeline's note flags) are read from their code: each must call the helper.
// usage: node run_note_markers.js <addon folder>
const fs = require('fs');
const path = require('path');
const themeLua = require('./theme_stub');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
if (!root) { console.error('usage: node run_note_markers.js <addon folder>'); process.exit(1); }
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const FILES = ['CRT_Core/MarkerText.lua', 'CRT_Modules/Notes/Parse.lua', 'CRT_Modules/Notes/Render.lua', 'CRT_Modules/Notes/Window.lua',
  'CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Core/Sound/Engine.lua', 'CRT_Modules/Alerts/Speech.lua',
  'CRT_Modules/Markers/Display.lua', 'CRT_Modules/Interrupts/Setup.lua', 'CRT_Modules/Notes/Alert.lua', 'CRT_Modules/Alerts/Areas.lua',
  'CRT_Modules/Alerts/Texts.lua', 'CRT_Modules/Alerts/Icons.lua', 'CRT_Modules/Alerts/Circles.lua', 'CRT_Modules/Alerts/Bars.lua',
  'CRT_Modules/Alerts/TimelineArea.lua', 'CRT_Modules/Alerts/GameTimeline.lua', 'CRT_Modules/Notes/EditorWindow.lua',
  'CRT_Modules/Notes/EditorLinks.lua', 'CRT_Modules/Notes/EditorAssign.lua', 'CRT_Modules/Timeline/View.lua',
  'CRT_Core/Integrations/NoteTargets.lua', 'CRT_Core/Integrations/NSRT.lua', 'CRT_Core/Integrations/MRT.lua', 'CRT_Modules/Notes/Comm.lua',
  'CRT_Modules/Notes/Page.lua'];

// Every Lua file of the addon outside the tests, for the "one list" and "no chat post" checks.
function luaFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.claude' || e.name === 'node_modules' || e.name === '.git' || p.endsWith(path.join('CRT_Dev', 'Tests'))) continue;
      luaFiles(p, out);
    } else if (e.name.endsWith('.lua')) out.push(p);
  }
  return out;
}

const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = themeLua(root) + `
local SRC, ALL = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function icon(n, size) return "|TInterface\\\\TargetingFrame\\\\UI-RaidTargetingIcon_" .. n .. ":" .. (size or 0) .. "|t" end
local function has(s, part) return type(s) == "string" and s:find(part, 1, true) ~= nil end
local function count(s, part) local n, at = 0, 1 while true do local a, b = s:find(part, at, true) if not a then return n end n, at = n + 1, b + 1 end end
local function load(path, CRT) assert(_G.load(SRC[path], "@" .. path))("CowfeeRaidTools", CRT) end

format = string.format
wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
tinsert = table.insert
-- a value the game hides: any string starting SECRET
function issecretvalue(v) return type(v) == "string" and v:find("^SECRET") ~= nil end
function InCombatLockdown() return false end
local myName = "Gadios"
function UnitName(u) if u == "player" then return myName end end
local clock = 100
function GetTime() return clock end
-- not theme colours: the game's class colours
RAID_CLASS_COLORS = { MAGE = { colorStr = "ff3fc7eb" }, PRIEST = { colorStr = "ffffffff" }, ROGUE = { colorStr = "fffff468" }, DRUID = { colorStr = "ffff7c0a" } }

local frames = {}
local function mock(kind)
  local m = { shown = true, kind = kind, scripts = {}, events = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" or k == "CreateTexture" or k == "CreateLine" or k == "CreateMaskTexture" then
      return function(self) local f = mock(k) rawset(f, "parent", self) return f end end
    if k == "CreateAnimationGroup" or k == "CreateAnimation" then return function() return mock(k) end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") or "" end end
    if k == "Show" then return function(self) self.shown = true end end
    if k == "Hide" then return function(self) self.shown = false end end
    if k == "SetShown" then return function(self, on) self.shown = on and true or false end end
    if k == "IsShown" or k == "IsVisible" then return function(self) return self.shown end end
    if k == "GetStringHeight" then return function() return 12 end end
    if k == "GetStringWidth" or k == "GetUnboundedStringWidth" then return function(self) return #(rawget(self, "text") or "") * 6 end end
    if k == "GetWidth" or k == "GetHeight" then return function() return 300 end end
    if k == "GetFont" then return function() return "Fonts\\\\FRIZQT__.TTF", 14, "" end end
    if k == "SetScript" then return function(self, n, fn) self.scripts[n] = fn end end
    if k == "GetScript" then return function(self, n) return self.scripts[n] end end
    if k == "RegisterEvent" then return function(self, e) self.events[e] = true end end
    if k == "HasFocus" then return function() return false end end
    if k == "GetCursorPosition" then return function() return 0 end end
    if k == "IsPlaying" then return function() return false end end
    return function() end end })
end
function CreateFrame(kind) local f = mock(kind) frames[#frames + 1] = f return f end
UIParent = mock()

-- 1. The helper ---------------------------------------------------------------------------------------------------
local H = { UI = {} }
load("CRT_Core/MarkerText.lua", H)
local MT, Codes = H.MarkerText, H.MarkerCodes
check(type(MT) == "function" and Codes and Codes.Number and Codes.Icon and Codes.InBraces, "CRT.MarkerText and CRT.MarkerCodes exist")
do
  local names = { star = 1, circle = 2, diamond = 3, triangle = 4, moon = 5, square = 6, cross = 7, x = 7, skull = 8 }
  local all = true
  for name, n in pairs(names) do
    if MT("{" .. name .. "}") ~= icon(n) then all = false print("  " .. name .. " -> " .. tostring(MT("{" .. name .. "}"))) end
  end
  for n = 1, 8 do if MT("{rt" .. n .. "}") ~= icon(n) then all = false end end
  check(all, "every marker name and {rt1} to {rt8} becomes its icon")
  check(MT("{CROSS} {Skull} {RT8} {X}") == icon(7) .. " " .. icon(8) .. " " .. icon(8) .. " " .. icon(7), "any case")
  local unknown = "{rt9} {rt0} {rt} {nothing} {time:5} {} {cross"
  check(MT(unknown) == unknown, "unknown codes are left as written")
  check(MT("Grab {cross} purple orb, then {star} and {rt8}.") == "Grab " .. icon(7) .. " purple orb, then " .. icon(1) .. " and " .. icon(8) .. ".", "several on one line, the words kept")
  check(MT("{skull}", 14) == icon(8, 14), "a size is passed on")
  check(MT("{skull}") == icon(8, 0), "no size: 0, as tall as the line's font")
  check(MT("no codes here") == "no codes here" and MT("") == "", "text with no code is unchanged")
  check(MT("SECRET {cross}") == "SECRET {cross}", "a secret text is passed back as it is")
  check(MT(nil) == nil and MT(42) == 42, "a non-text value is passed back")
  check(Codes.Number("Cross") == 7 and Codes.Number("rt3") == 3 and Codes.Number("rt9") == nil and Codes.Number("orb") == nil, "Number reads a code without braces")
  check(Codes.Icon(7, 14) == icon(7, 14) and Codes.Icon(9) == "" and Codes.Icon(nil) == "" and Codes.Icon(1.5) == "", "Icon: 1 to 8 only")
  local s = "at {cross} Cross"
  check(Codes.InBraces(s, 5, 10) and not Codes.InBraces(s, 12, 17), "InBraces: the code in braces, not the bare word")
  -- the game's own list adds the client's names; the English ones stay
  ICON_TAG_LIST = { stern = 1, rt1 = 1, kreuz = 7 }
  check(MT("{Stern} {kreuz} {cross}") == icon(1) .. " " .. icon(7) .. " " .. icon(7), "the game's ICON_TAG_LIST adds its names, English still read")
  ICON_TAG_LIST = nil
  check(MT("{Stern}") == "{Stern}", "a name only the game's list had goes with it")
end

-- 2. One list: the marker display reads the helper's, and Interrupts' icon is the helper's ----------------------------
do
  -- Alerts/Special.lua keeps its own words for a boss file's marks (data, not shown text), so it is left out here
  local holders = {}
  for file, src in pairs(ALL) do
    local code = src:gsub("%-%-[^\\n]*", "")
    if code:find("cross%s*=%s*7") and code:find("skull%s*=%s*8") and not file:find("Alerts[/\\\\]Special%.lua$") then holders[#holders + 1] = file end
  end
  check(#holders == 1 and holders[1]:find("CRT_Core[/\\\\]MarkerText%.lua$"), "the marker names table for shown text lives only in CRT_Core/MarkerText.lua: " .. table.concat(holders, ", "))
  local display = SRC["CRT_Modules/Markers/Display.lua"]
  check(has(display, "CRT.MarkerCodes.Number(") and not has(display, "ICON_NAMES"), "Markers/Display.lua reads codes with CRT.MarkerCodes.Number")
  local setup = SRC["CRT_Modules/Interrupts/Setup.lua"]
  check(has(setup, "CRT.MarkerCodes.Icon(") and not has(setup, "UI-RaidTargetingIcon"), "Interrupts/Setup.lua's MarkerIcon uses the helper")
  local S = { UI = {} }
  load("CRT_Core/MarkerText.lua", S)
  load("CRT_Modules/Interrupts/Setup.lua", S)
  check(S.InterruptSetup and S.InterruptSetup.MarkerIcon and S.InterruptSetup.MarkerIcon(8, 14) == icon(8, 14) and S.InterruptSetup.MarkerIcon(9, 14) == "",
    "Setup.MarkerIcon(8, 14) is the helper's skull")
end

-- 3. The Raid Notes read view and the note editor's drawn rows: Notes/Render.lua --------------------------------------
local classCache = { ["whitecrows-area52"] = "MAGE", ["mesmertism-area52"] = "PRIEST", ["cross-area52"] = "ROGUE", ["moon-area52"] = "DRUID" }
local R = { db = { classCache = classCache }, UI = { SkinScrollBar = function() end, ScrollGutter = function() return 24 end },
  Notes = { SpellInfo = function() return nil end } }
CRT_THEME(R, R.UI)
load("CRT_Core/MarkerText.lua", R)
load("CRT_Modules/Notes/Parse.lua", R)
load("CRT_Modules/Notes/Render.lua", R)
local Render = R.NoteRender
do
  local view = Render.View(mock(), { key = "Markers", width = 400, onClick = function() end })
  local raw = table.concat({
    "time:5;ph:1;tag:Whitecrows;text:Grab {cross} purple orb;DisplayType:Text;",
    "{cross} purple orb: Whitecrows",
    "Soak Ghost at {cross}: Mesmertism",
    "Soak: {cross} Cross {MOON} Moon",
    "{skull} Kill first",
    "Odd: {rt9} {time:5}",
  }, "\\n")
  view:SetText(raw)
  local function row(kind, n)
    local i = 0
    for k, data in ipairs(view.rows) do if data.kind == kind then i = i + 1 if i == (n or 1) then return view.pool[k], data end end end
  end
  local timer = row("timer")
  local t = timer and rawget(timer.text, "text")
  check(has(t, icon(7)) and not has(t, "{cross}") and has(t, "|cff3fc7ebWhitecrows|r"), "a timer row: the icon in its text, the name in class colour: " .. tostring(t))
  local orb, orbData = row("label", 1)
  local label = orb and rawget(orb.label, "text")
  check(has(label, icon(7) .. " purple orb:") and has(rawget(orb.text, "text"), "|cff3fc7ebWhitecrows|r"), "an assignment's label shows the icon, its names still coloured: " .. tostring(label))
  check(orbData.label == "{cross} purple orb", "the row keeps the code as written; only the drawn text has the icon")
  local ghost = row("label", 2)
  check(has(rawget(ghost.label, "text"), "Soak Ghost at " .. icon(7) .. ":") and has(rawget(ghost.text, "text"), "|cffffffffMesmertism|r"), "Soak Ghost at {cross}: the icon, Mesmertism coloured")
  local soak, soakData = row("label", 3)
  local st = rawget(soak.text, "text")
  check(has(st, icon(7) .. " |cfffff468Cross|r " .. icon(5) .. " |cffff7c0aMoon|r"), "players named Cross and Moon keep their colour and the codes still draw: " .. tostring(st))
  local named = 0
  for _, p in ipairs(soakData.parts) do if p.class then named = named + 1 end end
  check(named == 2, "a code in braces is never taken as a name: " .. named .. " names")
  local heading = row("heading")
  check(has(rawget(heading.heading, "text"), icon(8) .. " Kill first"), "a heading line shows the icon")
  local odd = row("label", 4)
  check(has(rawget(odd.text, "text"), "{rt9} {time:5}"), "unknown codes stay as written in the view")
  check(Render.Markup(orbData) == rawget(orb.text, "text"), "Render.Markup is what the row draws")
  -- the box behind the view, and the editor's raw text, stay raw
  local edit = mock("EditBox")
  local pair = Render.Bind(view, mock("ScrollFrame"), edit, function() return true end)
  pair:Update(raw, 1, nil)
  check(edit:GetText() == raw, "the raw edit box under the view keeps the codes as typed")
end

-- 4. The note windows: Notes/Window.lua -----------------------------------------------------------------------------
local Wn = { db = { classCache = classCache }, UI = {}, FONTS = {},
  Notes = { OnChange = function() end, ShowOutsideRaid = function() return true end, SpellInfo = function() return nil end },
  NoteEngine = { ClassLineIsMine = function() return false end, WordIsMe = function(_, w) return w:lower() == "gadios" end,
    IsMine = function() return false end } }
CRT_THEME(Wn, Wn.UI)
Wn.UI.RegisterPreview = function() end
load("CRT_Core/MarkerText.lua", Wn)
load("CRT_Modules/Notes/Parse.lua", Wn)
load("CRT_Modules/Notes/Window.lua", Wn)
do
  local NW = Wn.NoteWindow
  local text = NW.FormatText({ "Orb Carriers", "{cross} purple orb: Whitecrows", "Soak Ghost at {cross}: Mesmertism", "{moon} Moon: soak", "{skull} first" })
  check(has(text, icon(7) .. " purple orb: |cff3fc7ebWhitecrows|r"), "the Assignments window: {cross} purple orb shows the icon, Whitecrows coloured")
  check(has(text, "Soak Ghost at " .. icon(7) .. ": |cffffffffMesmertism|r"), "Soak Ghost at {cross}: Mesmertism")
  check(has(text, icon(5) .. " |cffff7c0aMoon|r: soak"), "a player named Moon keeps the colour beside {moon}")
  check(has(text, icon(8) .. " first") and not has(text, "{"), "a heading line shows its icon, no code left: " .. text)
  local personal = NW.PersonalNoteBlock("time:5;ph:1;tag:Whitecrows;text:Grab {cross} purple orb;\\n# {skull} Boss\\n- **{star}** stack")
  check(has(personal, "Grab " .. icon(7) .. " purple orb") and has(personal, "|cff3fc7ebWhitecrows|r"), "the timers line: icon in the text, the name coloured")
  check(has(personal, icon(8) .. " Boss") and has(personal, icon(1)), "the personal note's heading and bold bullet show icons")
  check(NW.PersonalLine("plain words: none") == "plain words: none", "a line with no code is as before")
end
check(has(SRC["CRT_Modules/Notes/Window.lua"], "markers(tostring(item.text or TEXT.reminder))") and has(SRC["CRT_Modules/Notes/Window.lua"], "markers(tostring(it.text or TEXT.reminder))"),
  "the personal window's reminder lines go through the helper, planned and running")

-- 5. Speech: the line is read as written, never a texture path ------------------------------------------------------
do
  local said = {}
  C_TTSSettings = { GetVoiceOptionID = function() return 7 end }
  C_VoiceChat = { SpeakText = function(_, text) said[#said + 1] = text end }
  local S = { db = { notes = { alert = { tts = true, ttsRate = 0, ttsVolume = 100, ttsSeconds = 3 } }, alerts = {} }, UI = {}, Print = function() end }
  load("CRT_Core/MarkerText.lua", S)
  for _, f in ipairs({ "CRT_Modules/Alerts/Rules.lua", "CRT_Modules/Alerts/Engine.lua", "CRT_Core/Sound/Engine.lua", "CRT_Modules/Alerts/Speech.lua" }) do load(f, S) end
  local A = S.Alerts
  local items = { { id = "note:1", ph = 1, time = 1, text = "Soak Ghost at {cross}", priority = 21,
    outputs = { alert = true, speech = true }, speech = { { offset = 0, text = "Soak Ghost at {cross}" } } } }
  A:RegisterBlock("t", { label = "t", group = false, Entries = function() return items end })
  A:Start(1, "Mythic", "test")
  for _ = 1, 15 do clock = clock + 0.1 for _, f in ipairs(frames) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 0.1) end end end
  check(#said == 1 and said[1] == "Soak Ghost at {cross}", "speech gets the line as written: " .. tostring(said[1]))
  check(not has(said[1], "|T"), "speech never gets a |T texture")
  check(not has(SRC["CRT_Modules/Alerts/Speech.lua"], "MarkerText") and not has(SRC["CRT_Core/Sound/Engine.lua"], "MarkerText"), "the speech code never calls the helper")
end

-- 6. The other display paths call the helper (read from their code) ------------------------------------------------
local function code(path) return (SRC[path]:gsub("%-%-[^\\n]*", "")) end
check(has(code("CRT_Modules/Notes/Alert.lua"), "label:SetText(CRT.MarkerText and CRT.MarkerText(text) or text)"), "the note callout's text")
local areas = code("CRT_Modules/Alerts/Areas.lua")
check(has(areas, "function Areas.ShownText(line)") and has(areas, "CRT.MarkerText(text)"), "Areas.ShownText: LineText through the helper")
check(has(code("CRT_Modules/Alerts/Texts.lua"), "Areas.ShownText(line)"), "the texts area")
check(has(code("CRT_Modules/Alerts/Icons.lua"), "Areas.ShownText(line)"), "the icons area")
check(has(code("CRT_Modules/Alerts/Circles.lua"), "Areas.ShownText(line)"), "the circles area")
check(count(code("CRT_Modules/Alerts/Bars.lua"), "text = Areas.ShownText(line)") == 2 and not has(code("CRT_Modules/Alerts/Bars.lua"), "Areas.LineText"), "the bars, plain and shield")
check(has(code("CRT_Modules/Alerts/TimelineArea.lua"), "Areas.ShownText(line)"), "the timeline area")
check(has(code("CRT_Modules/Alerts/GameTimeline.lua"), "overrideName = Areas.LineText(line)"), "the game's own timeline gets the text as written")
local editor = code("CRT_Modules/Notes/EditorWindow.lua")
check(has(editor, "return markers(out)") and has(editor, "(markers(row.label) .. \\":\\")") and has(editor, "f.heading:SetText(markers(text))"),
  "the pop-out editor's drawn rows: timers, group labels, headings and text")
local raw = {}
for line in editor:gmatch("[^\\n]+") do if line:find("markers(", 1, true) and (line:lower():find("edit") or line:find("W.raw", 1, true) or line:find("Raw", 1, true)) then raw[#raw + 1] = line end end
check(#raw == 0, "nothing the player types in goes through the helper: " .. table.concat(raw, " | "))
check(has(code("CRT_Modules/Notes/EditorLinks.lua"), "fs:SetText(markers(text))"), "the editor's linked groups banner")
check(has(code("CRT_Modules/Notes/EditorAssign.lua"), "CRT.MarkerText(title)"), "the editor's assignments banner")
local view = code("CRT_Modules/Timeline/View.lua")
check(has(view, "GameTooltip:SetText(shownText(m.text)") and has(view, "local title = shownText(tostring(m.text"), "the Timeline's note flags: tooltip and menu title")
local page = code("CRT_Modules/Notes/Page.lua")
check(has(page, "Render.View(") and not has(page, "MarkerText"), "the Raid Notes page shows notes through the read view only (its boxes stay raw)")

-- 7. What stays raw: the note sent to another addon, sharing, chat posts ---------------------------------------------
for _, p in ipairs({ "CRT_Core/Integrations/NoteTargets.lua", "CRT_Core/Integrations/NSRT.lua", "CRT_Core/Integrations/MRT.lua", "CRT_Modules/Notes/Comm.lua" }) do
  check(not has(SRC[p], "MarkerText") and not has(SRC[p], "MarkerCodes"), p .. " sends the text as written")
end
do
  local bad = {}
  for file, src in pairs(ALL) do
    if src:find("SendChatMessage", 1, true) and src:find("MarkerText", 1, true) then bad[#bad + 1] = file end
  end
  check(#bad == 0, "no chat post goes through the helper: " .. table.concat(bad, ", "))
end

print(passes .. " passed, " .. fails .. " failed")
if fails > 0 then error("note markers: " .. fails .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_createtable(L, 0, FILES.length);
for (const f of FILES) {
  let src = '';
  try { src = read(f); } catch (e) { src = ''; }
  lua.lua_pushstring(L, to_luastring(src));
  lua.lua_setfield(L, -2, to_luastring(f));
}
lua.lua_createtable(L, 0, 0);
for (const f of luaFiles(root, [])) {
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(f, 'utf8')));
  lua.lua_setfield(L, -2, to_luastring(path.relative(root, f)));
}
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
