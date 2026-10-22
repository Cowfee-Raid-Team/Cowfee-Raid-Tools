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
local dbSrc, displaySrc, editorSrc, clearOnSrc = ...
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
    if k == "UnregisterEvent" then return function(self, e) rawget(self, "events")[e] = nil end end
    if k == "UnregisterAllEvents" then return function(self) rawset(self, "events", {}) end end
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
  HelpRight = function(target, title, text, opts) local b = (function() return mock() end)(opts and opts.parent or target, title, text) rawset(b, "helpTarget", target) return b end, HELP_GAP = 4, HELP_SIZE = 20, Help = function() return mock() end, StyleWindow = function() end, SetFrameTitle = function() end, SkinTree = function() end }
local exported
CRT.ConsumablesTools = { ShowText = function(_, title, text) exported = text end }
assert(load(dbSrc, "Database.lua"))("CowfeeRaidTools", CRT)
assert(load(displaySrc, "Display.lua"))("CowfeeRaidTools", CRT)
assert(load(clearOnSrc, "ClearOn.lua"))("CowfeeRaidTools", CRT)
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

-- Clear on (Markers/ClearOn.lua): a boss moment in the display's clearOn list clears it. Secret payloads match
-- nothing and raise no error.
local CO = CRT.MarkerClearOn
local states = {}
C_EncounterTimeline = { GetEventState = function(id) return states[id] end }
CRT.MarkerDisplayDB.displays[ENC] = { name = "Test", slots = 4, clearOn = {
  { event = "cast", spellID = 111 },
  { event = "cast", spellID = 112, when = "start" },
  { event = "timeline", spellID = 222 },
  { event = "timeline", spellID = 223, when = "start" },
  { event = "emote", contains = "Arena RESETS" },
  { event = "targetable" },
  { event = "cast" }, { event = "emote", contains = " " }, { event = "nope", spellID = 1 }, { event = "timeline", spellID = 1.5 },
} }
pull()
check(#CO:Entries() == 6, "clearOn: entries without a spell ID or text, or of an unknown kind, are left out")
local coFrame
for _, f in ipairs(frames) do if rawget(f, "events").UNIT_TARGETABLE_CHANGED then coFrame = f end end
check(coFrame ~= nil and coFrame.events.UNIT_SPELLCAST_SUCCEEDED and coFrame.events.CHAT_MSG_RAID_BOSS_EMOTE and coFrame.events.ENCOUNTER_TIMELINE_EVENT_ADDED, "clearOn: armed, it listens to the events its entries need")
local function co(e, ...) if coFrame then local ok, err = pcall(coFrame.OnEvent, coFrame, e, ...) if not ok then check(false, e .. " raised an error: " .. tostring(err)) end end end
local function clears(what, ...)
  pull() say("{rt1}")
  local before = #M:Filled()
  co(...)
  check(before == 1 and #M:Filled() == 0, "clears: " .. what)
end
local function keeps(what, ...)
  pull() say("{rt1}")
  co(...)
  check(#M:Filled() == 1, "keeps: " .. what)
end
clears("a boss's cast succeeds", "UNIT_SPELLCAST_SUCCEEDED", "boss1", "Cast-1", 111)
keeps("that cast only starts (the entry waits for success)", "UNIT_SPELLCAST_START", "boss1", "Cast-1", 111)
clears("a when = start cast starts", "UNIT_SPELLCAST_START", "boss2", "Cast-2", 112)
clears("a when = start channel starts", "UNIT_SPELLCAST_CHANNEL_START", "boss5", "Cast-2", 112)
keeps("another unit casts it", "UNIT_SPELLCAST_SUCCEEDED", "raid3", "Cast-1", 111)
keeps("another spell", "UNIT_SPELLCAST_SUCCEEDED", "boss1", "Cast-1", 999)
keeps("a secret spell ID", "UNIT_SPELLCAST_SUCCEEDED", "boss1", secret("Cast-1"), secret(111))
keeps("a secret unit", "UNIT_SPELLCAST_SUCCEEDED", secret("boss1"), "Cast-1", 111)
pull() say("{rt1}")
co("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 5, source = 0, spellID = 222 })
check(#M:Filled() == 1, "keeps: a timeline event is added (the entry waits for it to finish)")
states[5] = 2
co("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 5)
check(#M:Filled() == 0, "clears: the timeline event finishes")
pull() say("{rt1}")
co("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 6, source = 0, spellID = 222 })
states[6] = 3
co("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 6)
check(#M:Filled() == 1, "keeps: the timeline event is canceled")
clears("a when = start timeline event is added", "ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 7, source = 0, spellID = 223 })
keeps("a script event (CRT's own alerts) with that spell", "ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 8, source = 1, spellID = 223 })
pull() say("{rt1}")
co("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 9, source = 0, spellID = secret(222) })
states[9] = 2
co("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 9)
check(#M:Filled() == 1, "keeps: a timeline event whose spell is secret")
keeps("a secret timeline info table", "ENCOUNTER_TIMELINE_EVENT_ADDED", secret({ id = 10, source = 0, spellID = 223 }))
pull() say("{rt1}")
co("ENCOUNTER_TIMELINE_EVENT_ADDED", { id = 11, source = 0, spellID = 222 })
co("ENCOUNTER_TIMELINE_EVENT_REMOVED", 11)
states[11] = 2
co("ENCOUNTER_TIMELINE_EVENT_STATE_CHANGED", 11)
check(#M:Filled() == 1, "keeps: a removed timeline event is forgotten")
clears("a boss emote holding the text, any case", "CHAT_MSG_RAID_BOSS_EMOTE", "The arena resets!", "Sszorak")
clears("the same on RAID_BOSS_EMOTE", "RAID_BOSS_EMOTE", "|cffff0000The ARENA resets|r", "Sszorak")
clears("a boss yell", "CHAT_MSG_MONSTER_YELL", "Now the arena resets.", "Sszorak")
keeps("an emote without the text", "CHAT_MSG_RAID_BOSS_EMOTE", "The boss roars.", "Sszorak")
keeps("a secret emote", "CHAT_MSG_RAID_BOSS_EMOTE", secret("The arena resets!"), secret("Sszorak"))
clears("a boss becomes untargetable", "UNIT_TARGETABLE_CHANGED", "boss1")
keeps("a nameplate unit changes", "UNIT_TARGETABLE_CHANGED", "nameplate3")
keeps("a secret unit changes", "UNIT_TARGETABLE_CHANGED", secret("boss1"))
fire("ENCOUNTER_END")
check(next(coFrame.events) == nil and #CO:Entries() == 0, "clearOn: the pull's end stops listening")
CRT.MarkerDisplayDB.displays[ENC] = { name = "Test", slots = 4, clearOn = { { event = "emote", contains = "resets" } } }
pull()
check(coFrame.events.CHAT_MSG_MONSTER_YELL and not coFrame.events.UNIT_SPELLCAST_SUCCEEDED and not coFrame.events.UNIT_TARGETABLE_CHANGED, "clearOn: only the kinds it holds are listened to")
CRT.MarkerDisplayDB.displays[ENC] = { name = "Test", slots = 4 }
pull()
say("{rt1}")
co("UNIT_TARGETABLE_CHANGED", "boss1")
check(next(coFrame.events) == nil and #M:Filled() == 1, "a display without clearOn listens to nothing and keeps its markers")
fire("ENCOUNTER_END")

-- Geometry: the same places the window uses, for the Marker macros tab's preview.
do
  local g = M.Geometry({ slots = 4 })
  check(g.width == 332 and g.height == 94 and g.cells[2].point == "TOPLEFT" and g.cells[2].x == 86 and g.cells[2].y == 4, "Geometry: a row's size and slot 2, as the window lays it out")
  g = M.Geometry(FREE)
  local fx1, fy1 = M.SlotCenter(FREE, 1)
  check(g.cells[1].point == "CENTER" and near(g.cells[1].x, fx1) and near(g.cells[1].y, fy1) and near(g.width, 292), "Geometry: a freeform slot's centre and the window's width")
  local mark, name = M.SampleSlot(1)
  check(mark == icon(1) and type(name) == "string" and name ~= "", "SampleSlot gives a sample marker and name")
  check(M.Settings({}).slots == 4 and M.Settings({}).clearGap == 10, "Settings fills in the defaults")
end

-- Listeners hear a fill, a clear and a disarm.
do
  CRT.MarkerDisplayDB.displays[ENC] = { name = "Test", slots = 4 }
  local heard = 0
  M:OnChange(function() heard = heard + 1 end)
  pull()
  local afterPull = heard
  say("{rt1}")
  check(heard > afterPull, "a fill tells the listeners")
  local n = heard
  M:Clear()
  check(heard > n, "a clear tells the listeners")
  fire("ENCOUNTER_END")
end

-- Help text: shipped in MarkerDisplayDB.help, nil when a boss has none.
CRT.MarkerDisplayDB.help[ENC] = "Shipped help."
check(M:Help(ENC) == "Shipped help." and M:Help(9999) == nil, "Help: the shipped text, or nil")
CRT.MarkerDisplayDB.help[ENC] = nil

-- The dev editor (loaded like the game would in a dev build).
CRT.Bosses = { Options = function() return { { key = ENC, label = "Boss" } } end, FirstKey = function(list) return list[1].key end,
  Get = function(_, id) if id == ENC then return { encounterID = ENC, name = "Test Boss", season = "test-s1" } end end }
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
local line = exported:match("\\n(markers = [^\\n]+)")
check(line and line:find('layout = "free"', 1, true) and line:find('shape = "circle"', 1, true) and line:find("canvas = 200", 1, true), "Export writes the layout, shape and canvas")
check(line and line:find("places = { { 0.5, 0.1 }, { 1, 0.5 }", 1, true), "Export writes the places: " .. tostring(line))
local header = exported:match("^(.-)\\nmarkers = ")
check(header and header:find("markers = { ... },", 1, true) and header:find("CRT_Data/Seasons/<season>/<Boss>.lua", 1, true) and header:find("not Database.lua", 1, true) and header:find("Test Boss", 1, true) and header:find(tostring(ENC), 1, true),
  "Export's header says to paste into the boss file's markers field, not Database.lua: " .. tostring(header))
check(not exported:find("Database.lua:", 1, true) and not exported:find("%[%d+%] = {"), "Export no longer writes a Database.lua line")
check(not exported:find("markerHelp", 1, true), "no help text: no markerHelp line")
local back = line and load("return { " .. line .. " }")().markers
check(back and same(back.places, d.places), "the exported places read back the same")
x, y = M.SlotCenter(back, 1)
check(near(x, 146) and near(y, 67), "a shipped freeform display puts its slots at the exported places")

-- Help text: typed into its box, exported as markerHelp, read back as Lua.
win.help:SetText("Each player in a ring calls their marker.")
win.help.OnTextChanged(win.help, true)
win.export.OnClick(win.export)
local helpLine = exported:match("\\n(markerHelp = [^\\n]+)")
check(helpLine == 'markerHelp = "Each player in a ring calls their marker.",', "Export writes markerHelp when the draft has help: " .. tostring(helpLine))
check(helpLine and load("return { " .. helpLine .. " }")().markerHelp == "Each player in a ring calls their marker.", "the exported markerHelp reads back")

-- Save draft, then pick the boss again: the places come back, as a copy.
win.save.OnClick(win.save)
check(M:Help(ENC) == "Each player in a ring calls their marker.", "a saved draft's help text is the boss's help")
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
check(not exported:find("clearOn", 1, true), "a display without clearOn exports none")

-- Clear on in the editor: add entries, see them listed, remove one, then Export and Save draft keep them.
win:Show()
win.OnShow(win)
dropdowns["Clear on"].set("cast")
win.clearValue:SetText("1234")
dropdowns["When"].set("start")
win.clearAdd.OnClick(win.clearAdd)
local list = E:Draft().clearOn
check(list and #list == 1 and list[1].event == "cast" and list[1].spellID == 1234 and list[1].when == "start", "Add puts a boss cast in the draft's clearOn")
check(win.clearValue:GetText() == "", "the box empties after Add")
win.clearValue:SetText("abc")
win.clearAdd.OnClick(win.clearAdd)
check(#E:Draft().clearOn == 1, "a spell ID that isn't a number is not added")
check(not dropdowns["When"].enabledIf or dropdowns["When"].enabledIf(), "When is on for a cast")
dropdowns["Clear on"].set("emote")
check(dropdowns["When"].enabledIf and not dropdowns["When"].enabledIf(), "When is greyed out for an emote")
win.clearValue:SetText("The arena resets")
win.clearAdd.OnClick(win.clearAdd)
dropdowns["Clear on"].set("targetable")
win.clearAdd.OnClick(win.clearAdd)
list = E:Draft().clearOn
check(#list == 3 and list[2].contains == "The arena resets" and list[3].event == "targetable", "an emote and a targetable change are added")
check(win.clearRows[1].label.text == "Boss cast 1234 (when it starts)" and win.clearRows[3].shown and not win.clearRows[4].shown, "the list shows each entry, one row each")
win.clearRows[1].remove.OnClick(win.clearRows[1].remove)
list = E:Draft().clearOn
check(#list == 2 and list[1].event == "emote" and not win.clearRows[3].shown, "Remove drops that entry")
win.export.OnClick(win.export)
line = exported:match("\\n(markers = [^\\n]+)")
check(line and line:find('clearOn = { { event = "emote", contains = "The arena resets" }, { event = "targetable" } }', 1, true), "Export writes clearOn inside the markers line: " .. tostring(line))
back = line and load("return { " .. line .. " }")().markers
check(back and #back.clearOn == 2 and CRT.MarkerClearOn.Valid(back.clearOn[1]) and CRT.MarkerClearOn.Valid(back.clearOn[2]), "the exported clearOn reads back as working entries")
win.save.OnClick(win.save)
saved = CRT.db.dev.markerDisplays[ENC]
check(saved.clearOn ~= list and saved.clearOn[1] ~= list[1] and saved.clearOn[1].contains == "The arena resets", "Save draft keeps a copy of clearOn")

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Markers/Database.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Markers/Display.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Dev/Dev/MarkerEditor.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Markers/ClearOn.lua', 'utf8')));
if (lua.lua_pcall(L, 4, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
