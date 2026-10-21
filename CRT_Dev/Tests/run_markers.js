// CRT_Modules/Markers/Database.lua and Display.lua on mock frames: which group chat messages fill a slot.
// A readable message fills one only when it holds a raid marker code, and shows just the marker icons. A hidden
// (secret) message can't be read: it follows the display's "hidden" setting, unless the game says readably
// whether its icon replacement changed it. Secret values here are proxies that raise an error on any use the game
// forbids (indexing, length, arithmetic, concatenation, ordering), so code that reads one fails the check.
// usage: node run_markers.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local dbSrc, displaySrc, editorSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- Secret values: a proxy around the real text that errors on anything but storing and passing.
local SECRET = {}
local function forbidden() error("used a secret value") end
SECRET.__index = forbidden
SECRET.__len = forbidden
SECRET.__concat = forbidden
SECRET.__lt = forbidden
SECRET.__le = forbidden
SECRET.__add = forbidden
SECRET.__sub = forbidden
SECRET.__call = forbidden
local function secret(v) return setmetatable({ inner = v }, SECRET) end
local function reveal(v) if getmetatable(v) == SECRET then return rawget(v, "inner") end return v end
function issecretvalue(v) return getmetatable(v) == SECRET end

local lines = {} -- every line drawn (the freeform canvas outline)
local function mock(kind)
  local m = { shown = false, kind = kind, events = {}, alpha = 1 }
  return setmetatable(m, { __index = function(t, k)
    if k:match("^%l") then return nil end -- a field the code never set, as on a game frame; methods are capitalised
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock("r") end end
    if k == "CreateLine" then return function() local l = mock("line") l.shown = true lines[#lines + 1] = l return l end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "Show" then return function(self) rawset(self, "shown", true) end end
    if k == "Hide" then return function(self) rawset(self, "shown", false) end end
    if k == "SetShown" then return function(self, on) rawset(self, "shown", on and true or false) end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "RegisterEvent" then return function(self, e) rawget(self, "events")[e] = true end end
    if k == "GetPoint" then return function() return "CENTER", nil, "CENTER", 0, 0 end end
    if k == "SetPoint" then return function(self, ...) rawset(self, "point", { ... }) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetAlpha" then return function(self, a) rawset(self, "alpha", a) end end
    if k == "EnableMouse" then return function(self, on) rawset(self, "mouse", on and true or false) end end
    if k == "SetChecked" then return function(self, on) rawset(self, "checked", on) end end
    if k == "GetChecked" then return function(self) return rawget(self, "checked") end end
    return function() end end })
end
local frames, named = {}, {}
function CreateFrame(kind, name) local m = mock(kind) frames[#frames + 1] = m if name then named[name] = m end return m end
tinsert = table.insert
UISpecialFrames = {}
function CreateFont() return mock("font") end
UIParent = mock()
GameFontHighlight = mock()
C_Timer = { After = function() end }
Ambiguate = function(k) return (k:gsub("%-.*$", "")) end
UnitName = function() return "Solex" end

-- The game's icon replacement: {rtN} and the named tags to a texture, case-insensitive. A secret input gives a
-- secret output. noIconReplacement and noGroupReplacement as in ChatInfoDocumentation.lua.
local NAMES = { star = 1, circle = 2, diamond = 3, triangle = 4, moon = 5, square = 6, cross = 7, x = 7, skull = 8 }
local function icon(i) return "|TInterface\\\\TargetingFrame\\\\UI-RaidTargetingIcon_" .. i .. ":0|t" end
local function replace(s, noIcon)
  if noIcon then return s end
  return (s:gsub("{([^{}]*)}", function(tag)
    local t = tag:lower()
    local i = NAMES[t] or tonumber(t:match("^rt(%d)$"))
    if i and i >= 1 and i <= 8 then return icon(i) end
  end))
end
C_ChatInfo = { ReplaceIconAndGroupExpressions = function(s, noIcon)
  if issecretvalue(s) then return secret(replace(reveal(s), noIcon)) end
  return replace(s, noIcon)
end }

-- The game's tag table (ChatFrameConstants.lua), keys lower case.
ICON_TAG_LIST = { rt1 = 1, star = 1, rt2 = 2, circle = 2, rt3 = 3, diamond = 3, rt4 = 4, triangle = 4, rt5 = 5, moon = 5,
  rt6 = 6, square = 6, rt7 = 7, cross = 7, x = 7, rt8 = 8, skull = 8 }

local CRT = { db = { markers = { disabled = {} }, ui = {} } }
function CRT:Print() end
function CRT:FontPath() return "Fonts\\\\FRIZQT__.TTF" end
-- The dev editor's controls, by label, so a check can turn them like a hand would.
local sliders, dropdowns, tints = {}, {}, {}
CRT.UI = { RegisterThemed = function() end, RegisterLayer = function() end, RegisterPreview = function() end,
  ResetButton = function() return mock() end,
  Tint = function(region, method, key, alpha) tints[#tints + 1] = { region = region, method = method, key = key } end,
  Slider = function(_, label, opts) local r = mock() r.refresh = function() end sliders[label] = opts return r end,
  Dropdown = function(_, label, opts) local r = mock() r.refresh = function() end dropdowns[label] = opts return r end,
  Help = function() return mock() end, StyleWindow = function() end, SetFrameTitle = function() end, SkinTree = function() end }
local exported
CRT.ConsumablesTools = { ShowText = function(_, title, text) exported = text end }
assert(load(dbSrc, "Database.lua"))("CowfeeRaidTools", CRT)
assert(load(displaySrc, "Display.lua"))("CowfeeRaidTools", CRT)
local M = CRT.MarkerDisplay

local events
for _, f in ipairs(frames) do if rawget(f, "events").CHAT_MSG_RAID then events = f end end
local function fire(e, a1, a2) events.OnEvent(events, e, a1, a2) end

local ENC = 3001
CRT.MarkerDisplayDB.displays[ENC] = { name = "Test", slots = 4 }
local function pull() fire("ENCOUNTER_END") fire("ENCOUNTER_START", ENC) end
local function shown() local out = {} for i, s in ipairs(M:Filled()) do out[i] = s.text end return out end
local function say(text, sender) fire("CHAT_MSG_RAID", text, sender or "Solex-Area52") end

-- Readable messages
pull()
say("hello")
check(#M:Filled() == 0, "a message with no marker code fills nothing")
say("{rt8}")
check(#M:Filled() == 1 and shown()[1] == icon(8), "{rt8} fills a slot with the skull")
say("{SKULL}")
check(#M:Filled() == 2 and shown()[2] == icon(8), "{SKULL} (named, upper case) fills a slot with the skull")
say("go {star} now {x} please")
check(#M:Filled() == 3 and shown()[3] == icon(1) .. " " .. icon(7), "mixed text shows only its icons: star then cross")
say("{rt9} {nothing} {rt}")
check(#M:Filled() == 3, "codes that aren't markers fill nothing")
check(M:Filled()[1].sender == "Solex-Area52", "the sender is kept")

-- Without the game's table: the numbered codes and the English names still match.
ICON_TAG_LIST = nil
pull()
say("{Diamond}")
say("{rt5}")
say("diamond")
check(#M:Filled() == 2 and shown()[1] == icon(3) and shown()[2] == icon(5), "without the game's tag list, {Diamond} and {rt5} match and plain words don't")

-- Hidden messages, no readable answer from the game: the display's setting decides.
pull()
say(secret("oops typo"), secret("Solex-Area52"))
check(#M:Filled() == 1, "hidden: by default any message fills a slot (today's behaviour)")
check(issecretvalue(M:Filled()[1].text), "hidden: the shown text stays secret")
CRT.MarkerDisplayDB.displays[ENC].hidden = "ignore"
pull()
say(secret("{rt8}"), secret("Solex-Area52"))
say(secret("oops"), secret("Solex-Area52"))
check(#M:Filled() == 0, "hidden, set to ignore: no hidden message fills a slot")
say("{rt2}")
check(#M:Filled() == 1, "set to ignore: a readable marker still fills a slot")

-- Hidden messages where the game compares readably (C_Intl.CompareStrings): the message fills a slot only when
-- the icon replacement changed it.
local compared = 0
C_Intl = { CompareStrings = function(a, b, strength)
  compared = compared + 1
  if strength ~= 4 then error("expected the Identical strength") end
  return reveal(a) == reveal(b) and 0 or 1
end }
CRT.MarkerDisplayDB.displays[ENC].hidden = nil
pull()
say(secret("oops"), secret("Solex-Area52"))
check(#M:Filled() == 0 and compared == 1, "hidden, readable comparison: a message with no marker fills nothing, even set to fill")
say(secret("{rt8}"), secret("Solex-Area52"))
check(#M:Filled() == 1, "hidden, readable comparison: a message with a marker fills a slot")
CRT.MarkerDisplayDB.displays[ENC].hidden = "ignore"
pull()
say(secret("{rt8}"), secret("Solex-Area52"))
check(#M:Filled() == 1, "hidden, readable comparison: a marker fills a slot even set to ignore")

-- A secret comparison is no answer: back to the setting.
C_Intl = { CompareStrings = function(a, b) return secret(0) end }
CRT.MarkerDisplayDB.displays[ENC].hidden = nil
pull()
say(secret("oops"), secret("Solex-Area52"))
check(#M:Filled() == 1, "hidden, secret comparison: set to fill, the message fills a slot")
C_Intl = { CompareStrings = function() error("refused") end }
CRT.MarkerDisplayDB.displays[ENC].hidden = "ignore"
pull()
say(secret("oops"), secret("Solex-Area52"))
check(#M:Filled() == 0, "hidden, comparison refused: set to ignore, nothing fills")
C_Intl = nil

-- Row, column and grid lay out as they always have (cells 80 wide, 86 high with numbers and names at size 40).
local function near(a, b) return math.abs(a - b) < 0.01 end
local function same(a, b)
  if #a ~= #b then return false end
  for i = 1, #a do if not (near(a[i][1], b[i][1]) and near(a[i][2], b[i][2])) then return false end end
  return true
end
local function shownLines() local n = 0 for _, l in ipairs(lines) do if rawget(l, "shown") then n = n + 1 end end return n end
CRT.MarkerDisplayDB.displays[ENC] = { name = "Test", slots = 4 }
pull()
local p = M:SlotFrame(2).point
check(p[1] == "TOPLEFT" and p[3] == "TOPLEFT" and p[4] == 86 and p[5] == -4, "row: slot 2 sits where it always did")
check(M:Frame().w == 332 and M:Frame().h == 94, "row: the window is the size it always was")
check(shownLines() == 0, "row: no canvas outline")
CRT.MarkerDisplayDB.displays[ENC] = { name = "Test", slots = 6, layout = "grid" }
pull()
p = M:SlotFrame(5).point
check(p[1] == "TOPLEFT" and p[4] == 6 and p[5] == -90, "grid: slot 5 starts the second row")

-- Freeform geometry: places are fractions of the canvas, clamped to it.
local cx, cy = M.ClampPlace(-0.2, 1.7)
check(cx == 0 and cy == 1, "a place outside the canvas is clamped to its edge")
cx, cy = M.ClampPlace("x", nil)
check(cx == 0.5 and cy == 0.5, "a broken place falls back to the middle")
check(same(M.RingPlaces(4), { { 0.5, 0 }, { 1, 0.5 }, { 0.5, 1 }, { 0, 0.5 } }), "snap to ring: four slots evenly round the ring, from the top, clockwise")
check(same(M.GridPlaces(4), { { 0.25, 0.25 }, { 0.75, 0.25 }, { 0.25, 0.75 }, { 0.75, 0.75 } }), "spread evenly: four slots in a 2 by 2 grid")
check(#M.GridPlaces(5) == 5 and same({ M.GridPlaces(5)[4] }, { { 1 / 6, 0.75 } }), "spread evenly: five slots in 3 columns, 2 rows")
local FREE = { name = "Free", slots = 4, layout = "free", shape = "circle", canvas = 200, places = { { 0.5, 0.1 } } }
local x, y = M.SlotCenter(FREE, 1)
check(near(x, 146) and near(y, 67), "slot 1's centre is its place on the canvas")
x, y = M.SlotCenter(FREE, 2)
check(near(x, 246) and near(y, 147), "a slot without a place takes its ring place on a circle")
FREE.canvas = 300
x, y = M.SlotCenter(FREE, 1)
check(near(x, 196) and near(y, 77), "a bigger canvas scales the place")
FREE.iconSize = 60
local fx, fy = M.PlaceAt(FREE, M.SlotCenter(FREE, 1))
check(near(fx, 0.5) and near(fy, 0.1), "another icon size keeps the place")
fx, fy = M.PlaceAt(FREE, -50, 9999)
check(fx == 0 and fy == 1, "a place dragged off the canvas is clamped")
FREE.canvas, FREE.iconSize = 200, nil

-- Freeform in a pull: messages fill slots in order, each at its place; the canvas outline follows the shape.
CRT.MarkerDisplayDB.displays[ENC] = FREE
pull()
say("{rt3}")
say("{rt5}")
p = M:SlotFrame(1).point
check(p[1] == "CENTER" and p[3] == "TOPLEFT" and near(p[4], 146) and near(p[5], -67), "freeform: slot 1 sits at its place")
check(M:SlotFrame(1).icon.text == icon(3) and M:SlotFrame(2).icon.text == icon(5), "freeform: messages fill slots in order")
check(near(M:Frame().w, 292) and near(M:Frame().h, 294), "freeform: the window holds the canvas and half a slot round it")
check(shownLines() == 64, "circle: the outline is drawn")
check(#tints > 0 and tints[1].key == "border", "the outline takes the theme's border colour")
FREE.shape = "square"
pull()
say("{rt3}")
check(shownLines() == 4, "square: four sides")
FREE.shape = "none"
pull()
say("{rt3}")
check(shownLines() == 0, "none: no outline")
FREE.shape = "circle"
fire("ENCOUNTER_END")

-- The dev editor (loaded like the game would in a dev build).
CRT.Bosses = { Options = function() return { { key = ENC, label = "Boss" } } end, FirstKey = function(list) return list[1].key end }
assert(load(editorSrc, "MarkerEditor.lua"))("CowfeeRaidTools", CRT)
local E = CRT.MarkerEditor
CRT.MarkerDisplayDB.displays[ENC] = { name = "Shipped", slots = 4 }
E:Toggle()
local win = named.CowfeeRaidToolsMarkerEditor
check(M:EditorView() == nil and not M:Frame().shown, "editor open on a row display: nothing on screen")
win.preview.OnClick(win.preview)
check(M:EditorView() == "sample" and M:Frame().shown, "Show preview: the display shows")
check(M:SlotFrame(1).icon.text == icon(1) and M:SlotFrame(1).name.text ~= "" and M:SlotFrame(4).name.text ~= "", "the preview fills every slot with a sample marker and a sample name")
check(win.preview.text == "Hide preview", "the button turns to Hide preview")
sliders["Icon size"].set(60)
check(M:SlotFrame(1).h == 106, "the preview follows a new icon size at once")
sliders["Slots"].set(6)
check(M:SlotFrame(6).shown and M:SlotFrame(6).icon.text == icon(3), "the preview follows a new slot count at once")
win.preview.OnClick(win.preview)
check(M:EditorView() == nil and not M:Frame().shown and win.preview.text == "Show preview", "Hide preview hides it")
dropdowns["Layout"].set("free")
check(M:EditorView() == "ghost" and M:Frame().shown, "freeform: the editor shows the slots to drag")
check(M:SlotFrame(1).icon.alpha < 1 and M:SlotFrame(1).number.shown and M:SlotFrame(1).mouse, "each slot is a faint numbered marker that takes the mouse")
dropdowns["Shape"].set("circle")
sliders["Canvas size"].set(200)
sliders["Icon size"].set(40)
sliders["Slots"].set(4)

-- Drag slot 2 to the canvas's top left corner and past it: the place is clamped.
local f = M:Frame()
f.GetLeft = function() return 100 end
f.GetTop = function() return 500 end
f.GetEffectiveScale = function() return 1 end
GetCursorPosition = function() return 100 + 46 + 50, 500 - 47 - 20 end
local s2 = M:SlotFrame(2)
s2.OnDragStart(s2)
s2.OnUpdate(s2)
local d = E:Draft()
check(near(d.places[2][1], 0.25) and near(d.places[2][2], 0.1), "dragging a slot sets its place from the cursor")
check(#d.places == 4 and near(d.places[1][1], 0.5) and near(d.places[1][2], 0), "the other slots keep where they were shown")
p = s2.point
check(near(p[4], 96) and near(p[5], -67), "the slot follows the cursor while dragged")
GetCursorPosition = function() return 0, 0 end
s2.OnDragStop(s2)
check(d.places[2][1] == 0 and d.places[2][2] == 1 and rawget(s2, "OnUpdate") == nil, "dropped off the canvas: clamped, and the drag ends")
win.spread.OnClick(win.spread)
check(same(d.places, M.GridPlaces(4)), "Spread evenly puts the slots in a grid")
win.snap.OnClick(win.snap)
check(same(d.places, M.RingPlaces(4)), "Snap to ring spaces the slots evenly on the ring")
d.places[1] = { 0.5, 0.1 }

-- Export, then read the line back as the boss file would.
win.export.OnClick(win.export)
local line = exported:match("\\n(%[%d+%] = [^\\n]+)")
check(line and line:find('layout = "free"', 1, true) and line:find('shape = "circle"', 1, true) and line:find("canvas = 200", 1, true), "Export writes the layout, shape and canvas")
check(line and line:find("places = { { 0.5, 0.1 }, { 1, 0.5 }", 1, true), "Export writes the places: " .. tostring(line))
local back = line and load("return { " .. line .. " }")()[ENC]
check(back and same(back.places, d.places), "the exported places read back the same")
x, y = M.SlotCenter(back, 1)
check(near(x, 146) and near(y, 67), "a shipped freeform display puts its slots at the exported places")

-- Save draft, then pick the boss again: the places come back, as a copy.
win.save.OnClick(win.save)
local saved = CRT.db.dev.markerDisplays[ENC]
check(saved and saved.places ~= d.places and same(saved.places, d.places), "Save draft keeps a copy of the places")
dropdowns["Boss"].set(ENC)
check(same(E:Draft().places, saved.places) and E:Draft().places ~= saved.places and E:Draft().layout == "free", "the saved draft loads back with its places")

-- Test stops the preview; the test fills the slots in order.
win.preview.OnClick(win.preview)
check(M:EditorView() == "sample", "preview on again")
win.test.OnClick(win.test)
check(M:Testing() and M:EditorView() == nil and win.preview.text == "Show preview", "Test stops the preview")
check(not M:SlotFrame(1).mouse, "a test's slots don't take the mouse")
fire("CHAT_MSG_SAY", "{rt7}", "Solex")
check(M:SlotFrame(1).icon.text == icon(7) and M:SlotFrame(1).icon.alpha == 1, "the test fills slot 1 first")
win.preview.OnClick(win.preview)
check(not M:Testing() and M:EditorView() == "sample", "Show preview during a test stops the test")
win:Hide()
win.OnHide(win)
check(M:EditorView() == nil and not M:Frame().shown, "closing the editor hides the preview")

-- A row display exports as before, with no canvas fields.
dropdowns["Layout"].set("row")
win.export.OnClick(win.export)
check(not exported:find("places", 1, true) and not exported:find("shape", 1, true), "a row display's export has no canvas fields")

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Markers/Database.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Markers/Display.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Dev/Dev/MarkerEditor.lua', 'utf8')));
if (lua.lua_pcall(L, 3, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
