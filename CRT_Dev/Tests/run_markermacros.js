// Raid Notes > Marker macros (CRT_Modules/Markers/MacrosTab.lua) on mock frames, with the real macro engine
// (CRT_Core/Macros.lua and its Marker calls set), the real marker display (Markers/Database.lua, Display.lua) and
// the real boss library (Bosses/Registry.lua with the Midnight pack's Season.lua and Sszorak.lua): the boss
// dropdown, the help text, the live preview and its facts, making one macro by clicking it, Generate all macros,
// Remove macros, and the test with /say.
// usage: node run_markermacros.js <addon folder>
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = require('./theme_stub')(process.argv.slice(2)) + require('./placement_stub')(process.argv.slice(2)) + `
local engineSrc, setSrc, dbSrc, displaySrc, regSrc, seasonSrc, bossSrc, tabSrc, markerTextSrc = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end

-- Frames: every method a no-op unless set here; what the tab sets is kept to read back.
local frames, named = {}, {}
local function mock(kind)
  local m = { kind = kind, shown = true, events = {} }
  frames[#frames + 1] = m
  return setmetatable(m, { __index = function(t, k)
    if k:match("^%l") then return nil end
    if k == "CreateFontString" or k == "CreateTexture" or k == "CreateLine" then return function(self) local r = mock(k == "CreateFontString" and "FontString" or "Texture") rawset(r, "parent", self) return r end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "GetStringWidth" then return function(self) return #(tostring(rawget(self, "text") or "")) * 7 end end
    if k == "GetFontString" then return function(self) return self end end
    if k == "Show" then return function(self) rawset(self, "shown", true) if rawget(self, "OnShow") then self.OnShow(self) end end end
    if k == "Hide" then return function(self) rawset(self, "shown", false) end end
    if k == "SetShown" then return function(self, on) rawset(self, "shown", on and true or false) end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "RegisterEvent" then return function(self, e) rawget(self, "events")[e] = true end end
    if k == "UnregisterEvent" then return function() end end
    if k == "SetEnabled" then return function(self, on) rawset(self, "enabled", on and true or false) end end
    if k == "SetTexture" then return function(self, tex) rawset(self, "texture", tex) end end
    if k == "SetDesaturated" then return function(self, on) rawset(self, "desaturated", on and true or false) end end
    if k == "SetScale" then return function(self, s) rawset(self, "scale", s) end end
    if k == "SetSize" then return function(self, w, h) rawset(self, "w", w) rawset(self, "h", h) end end
    if k == "SetPoint" then return function(self, ...) rawset(self, "point", { ... }) end end
    if k == "GetPoint" then return function() return "CENTER", nil, "CENTER", 0, 0 end end
    return function() end end })
end
function CreateFrame(kind, name) local m = mock(kind) if name then named[name] = m end return m end
function CreateFont() return mock("font") end
UIParent = mock("UIParent")
GameFontHighlight = mock("font")
CANCEL = "Cancel"
tinsert = table.insert
UISpecialFrames = {}
C_Timer = { After = function() end }
Ambiguate = function(k) return (k:gsub("%-.*$", "")) end
GameTooltip = setmetatable({ lines = {} }, { __index = function(t, k)
  if k == "SetText" or k == "AddLine" then return function(self, s) table.insert(self.lines, s) end end
  if k == "SetOwner" then return function(self) self.lines = {} end end
  return function() end end })

-- The game's macro lists, as in run_macros.js: sorted by name, account 1 to 120, character from 121.
local MAX_ACCOUNT, MAX_CHAR = 120, 30
Constants = { MacroConsts = { MAX_ACCOUNT_MACROS = MAX_ACCOUNT, MAX_CHARACTER_MACROS = MAX_CHAR } }
local account, char = {}, {}
local combat = false
local function sortList(t) table.sort(t, function(a, b) return a.name:lower() < b.name:lower() end) end
local function listOf(i) if i > MAX_ACCOUNT then return char, i - MAX_ACCOUNT end return account, i end
function InCombatLockdown() return combat end
function GetNumMacros() return #account, #char end
function GetMacroInfo(i) local list, j = listOf(i) local m = list[j] if m then return m.name, m.icon, m.body end end
function CreateMacro(name, icon, body, perCharacter)
  if combat then error("blocked") end
  local list, max, base = account, MAX_ACCOUNT, 0
  if perCharacter then list, max, base = char, MAX_CHAR, MAX_ACCOUNT end
  if #list >= max then error("too many macros") end
  local m = { name = name, icon = icon, body = body }
  list[#list + 1] = m sortList(list)
  for i, x in ipairs(list) do if x == m then return base + i end end
end
function EditMacro(i, _, _, body) local list, j = listOf(i) list[j].body = body return i end
function DeleteMacro(i) if combat then error("blocked") end local list, j = listOf(i) table.remove(list, j) end
local function find(name, list) for _, m in ipairs(list or account) do if m.name == name then return m end end end
local function fill(list, n, prefix) for i = 1, n do list[#list + 1] = { name = prefix .. string.format("%03d", i), icon = 1, body = "/say" } end sortList(list) end

-- Chat: what the tab sends, and the game's icon replacement for the display.
local sent = {}
C_ChatInfo = {
  SendChatMessage = function(msg, chatType) sent[#sent + 1] = { msg = msg, chatType = chatType } end,
  ReplaceIconAndGroupExpressions = function(s) return (s:gsub("{rt(%d)}", "|Tmarker%1|t")) end,
}
local popup
function StaticPopup_ShowCustomGenericConfirmation(data) popup = data end

local printed = {}
local CRT = { db = { macros = { owned = {} }, markers = { disabled = {} }, ui = {} } }
function CRT:Print(msg) printed[#printed + 1] = msg end
function CRT:FontPath() return "Fonts\\\\FRIZQT__.TTF" end
-- The UI helpers the tab uses, as small stand-ins; the dropdown and the (?) texts are kept by label.
local dropdowns, helps = {}, {}
CRT.UI = { PAGE_W = 1026, PAGE_H = 560,
  RegisterThemed = function() end, RegisterLayer = function() end, RegisterPreview = function() end, ResetButton = function() return mock() end,
  Tint = function() end, Color = function() return 1, 1, 1, 1 end,
  HeadingText = function(s) return s end, GoodText = function(s) return "good:" .. s end, WarnText = function(s) return "warn:" .. s end, BadText = function(s) return "bad:" .. s end,
  PanelButtonWidth = function(w) return math.ceil(w) + 28 end,
  Dropdown = function(_, label, opts) local r = mock("Dropdown") r.refresh = function() end dropdowns[label] = opts return r end,
  HelpRight = function(target, title, text, opts) local b = (function(_, title, text) helps[title] = text return mock("Help") end)(opts and opts.parent or target, title, text) rawset(b, "helpTarget", target) return b end, HELP_GAP = 4, HELP_SIZE = 20, Help = function(_, title, text) helps[title] = text return mock("Help") end,
  LiftOver = function() end, ShownPopup = function(ret) return ret end,
  PreviewButton = function(_, label, keys) local b = mock("Button") rawset(b, "previewLabel", label) rawset(b, "previewKeys", keys) return b end,
}

assert(load(engineSrc, "CRT_Core/Macros.lua"))("CowfeeRaidTools", CRT)
assert(load(setSrc, "CRT_Modules/Markers/Macros.lua"))("CowfeeRaidTools", CRT)
assert(load(dbSrc, "CRT_Modules/Markers/Database.lua"))("CowfeeRaidTools", CRT)
CRT_PLACEMENT(CRT) -- CRT_Core/UI/Placement.lua, which the display is placed by
assert(load(markerTextSrc, "CRT_Core/MarkerText.lua"))("CowfeeRaidTools", CRT) -- the marker codes the display reads
assert(load(displaySrc, "CRT_Modules/Markers/Display.lua"))("CowfeeRaidTools", CRT)
assert(load(regSrc, "CRT_Data/Bosses/Registry.lua"))("CowfeeRaidTools", CRT)
assert(load(seasonSrc, "Season.lua"))("CowfeeRaidTools", CRT)
assert(load(bossSrc, "Sszorak.lua"))("CowfeeRaidTools", CRT)
-- A second boss with no marker display, but help text, to switch to.
local OTHER = 99001
CRT.Bosses:Register({ encounterID = OTHER, name = "Other Boss", season = "sample", markerHelp = "Stand on your marker." })
for _, f in ipairs(frames) do if rawget(f, "events").ADDON_LOADED and rawget(f, "OnEvent") then f.OnEvent(f, "ADDON_LOADED", "CowfeeRaidTools") end end
check(CRT.MarkerDisplayDB.displays[3420] ~= nil, "the registry ships Sszorak's marker display")
check(CRT.MarkerDisplayDB.help[OTHER] == "Stand on your marker.", "the registry ships a boss file's markerHelp")
CRT_TOOLTIP(CRT) -- UI.TooltipOwner, the real CRT_Core/UI/Tooltip.lua
assert(load(tabSrc, "CRT_Modules/Markers/MacrosTab.lua"))("CowfeeRaidTools", CRT)
local Tab = CRT.MarkerMacrosTab
local M = CRT.MarkerDisplay

local tab = mock("Frame")
Tab.Build(tab)
local function texts() local out = {} for _, f in ipairs(frames) do local t = rawget(f, "text") if type(t) == "string" then out[#out + 1] = t end end return out end
local function hasText(want) for _, t in ipairs(texts()) do if t == want then return true end end return false end
local function withText(part) for _, f in ipairs(frames) do local t = rawget(f, "text") if type(t) == "string" and t:find(part, 1, true) then return f end end end
local function button(label) for _, f in ipairs(frames) do if f.kind == "Button" and rawget(f, "text") == label then return f end end end

-- The layout: boss dropdown on the route, the headings, the eight macros and the buttons.
check(dropdowns.Boss ~= nil, "a Boss dropdown")
local opts = dropdowns.Boss.options()
local listed = false for _, o in ipairs(opts) do if o.key == 3420 then listed = true end end
check(listed, "the Boss dropdown lists the route's bosses")
check(Tab.Boss() == 3420, "it starts on the first boss with a marker display (Sszorak)")
check(hasText("How it works on this boss") and hasText("Marker display") and hasText("Your macros"), "the three headings")
check(helps["How it works on this boss"] and helps["Your macros"] and helps["Test markers"], "each heading and the test have a (?)")
check(button("Generate all macros") and button("Remove macros") and button("Test markers") and button("Stop test"), "Generate all macros, Remove macros, Test markers and Stop test")
for _, label in ipairs({ "Generate all macros", "Remove macros", "Test markers", "Stop test" }) do
  local b = button(label)
  check(b and b.w == #label * 7 + 28, label .. " is as wide as its label")
end
local names = 0 for i, n in ipairs({ "Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull" }) do if hasText("CRT " .. n) and hasText("/raid {rt" .. i .. "}") then names = names + 1 end end
check(names == 8, "the eight macros, each with its name and body")

-- Help text: none shipped for Sszorak yet, so the line says so; the other boss's own text.
check(hasText("No marker calls are planned on this boss yet."), "no markerHelp: the tab says so")
-- Preview and facts for Sszorak's display (4 slots in a row, cleared after 10 s and on a new phase).
local function shownCells()
  local n = 0
  for _, f in ipairs(frames) do if f.kind == "Frame" and rawget(f, "w") == 80 and rawget(f, "shown") and rawget(f, "point") and rawget(f, "point")[1] == "TOPLEFT" and rawget(f, "point")[3] == "TOPLEFT" then n = n + 1 end end
  return n
end
local facts = withText("Slots")
check(facts and facts.text:find("Slots  4", 1, true) and facts.text:find("Row", 1, true), "facts: 4 slots in a row")
check(facts and facts.text:find("10 seconds", 1, true) and facts.text:find("new phase", 1, true) and facts.text:find("pull", 1, true), "facts: what clears it")
local hiddenHelp = helps["Marker display"]
check(type(hiddenHelp) == "function" and hiddenHelp():find("hides chat", 1, true) and hiddenHelp():find("any hidden group message", 1, true), "the hidden-chat note is in the display's (?), for its setting")
check(withText("|Tmarker1|t") ~= nil, "the preview shows sample markers")
local noDisplay = withText("This boss has no marker display.")
check(noDisplay and not noDisplay.shown, "Sszorak has a display: no empty line")

-- Switch boss: help, preview and facts follow.
dropdowns.Boss.set(OTHER)
check(hasText("Stand on your marker."), "boss switch: the help text follows")
check(noDisplay.shown and facts.text == "", "boss switch: no display, so the empty line and no facts")
check(button("Test markers").enabled == false, "boss switch: Test markers is off without a display")
dropdowns.Boss.set(3420)
check(not noDisplay.shown and facts.text:find("Slots  4", 1, true), "back to Sszorak: the preview and facts again")

-- The macro icons: missing ones are greyed; clicking one makes just that one.
local function cellButton(i)
  local n = 0
  for _, f in ipairs(frames) do if f.kind == "Button" and rawget(f, "check") then n = n + 1 if n == i then return f end end end
end
local diamond = cellButton(3)
check(diamond and diamond.icon.texture == 137003 and diamond.icon.desaturated and not diamond.check.shown, "a macro not made yet: its icon greyed, no check")
diamond.OnEnter(diamond)
local tip = table.concat(GameTooltip.lines, " ")
check(tip:find("Click to make this macro", 1, true) ~= nil, "its tooltip says a click makes it")
diamond.OnClick(diamond)
check(#account == 1 and account[1].name == "CRT Diamond", "clicking it makes just CRT Diamond")
check(diamond.check.shown and not diamond.icon.desaturated and withText("good:Made") ~= nil, "it shows a check and Made")
check(withText("1 of 8 created") ~= nil, "the status follows")
cellButton(3).OnClick(cellButton(3))
check(#account == 1, "clicking a made one makes nothing")

-- Generate all macros: the other seven.
button("Generate all macros").OnClick(button("Generate all macros"))
check(#account == 8 and withText("8 of 8 created") ~= nil, "Generate all macros makes the rest")

-- Dragging a made icon puts its macro on the cursor, for an action bar; never in combat, never one not made.
local picked = {}
function PickupMacro(slot) picked[#picked + 1] = slot end
cellButton(1).OnDragStart(cellButton(1))
check(#picked == 1 and GetMacroInfo(picked[1]) == "CRT Star", "dragging CRT Star picks up CRT Star")
combat = true
printed = {}
cellButton(1).OnDragStart(cellButton(1))
check(#picked == 1 and (printed[1] or ""):find("Not in combat", 1, true) ~= nil, "in combat: no pickup, and chat says why")
combat = false
account[#account + 1] = { name = "My Own", icon = 1, body = "/say hi" }
table.sort(account, function(x, y) return x.name:lower() < y.name:lower() end)
cellButton(8).OnDragStart(cellButton(8))
check(#picked == 2 and GetMacroInfo(picked[2]) == "CRT Skull", "the slot is read again after the list moves")
for i = #account, 1, -1 do if account[i].name == "My Own" then table.remove(account, i) end end

-- Changed and blocked states.
find("CRT Moon").body = "/raid {rt5} mine"
button("Generate all macros").OnClick(button("Generate all macros"))
check(withText("warn:Changed by you") ~= nil and find("CRT Moon").body == "/raid {rt5} mine", "an edited macro shows Changed by you and is kept")
check(cellButton(5).check.shown and not cellButton(5).icon.desaturated, "an edited macro still shows its check")

-- Remove macros asks first, then removes only ours.
popup = nil
button("Remove macros").OnClick(button("Remove macros"))
check(popup and #account == 8, "Remove macros asks first")
popup.callback()
check(#account == 1 and account[1].name == "CRT Moon", "accepting removes only ours")

-- General Macros full: Generate all puts them in the character's macros; the cells say so.
account = {} fill(account, 118, "Mine ")
button("Generate all macros").OnClick(button("Generate all macros"))
check(#char == 8 and #account == 118, "General full: all 8 made in the character's macros")
check(withText("good:Made (this character)") ~= nil, "the cells say this character")
-- Remove takes them from there.
popup = nil
button("Remove macros").OnClick(button("Remove macros"))
popup.callback()
check(#char == 0 and #account == 118, "Remove takes ours from the character's macros")
-- Both full: nothing made, chat says how many to free.
fill(char, 29, "Char ")
printed = {}
button("Generate all macros").OnClick(button("Generate all macros"))
check(#account == 118 and #char == 29 and printed[1] and printed[1]:find("Free 5 more", 1, true), "both full: nothing made, chat says to free 5 (" .. tostring(printed[1]) .. ")")
account, char = {}, {}

-- Combat: the buttons grey out.
combat = true
for _, f in ipairs(frames) do if rawget(f, "events").PLAYER_REGEN_DISABLED and rawget(f, "OnEvent") then f.OnEvent(f, "PLAYER_REGEN_DISABLED") end end
check(button("Generate all macros").enabled == false and button("Remove macros").enabled == false, "in combat Generate and Remove are greyed")
combat = false
for _, f in ipairs(frames) do if rawget(f, "events").PLAYER_REGEN_ENABLED and rawget(f, "OnEvent") then f.OnEvent(f, "PLAYER_REGEN_ENABLED") end end
check(button("Generate all macros").enabled == true, "after combat they come back")

-- Test markers: the display listens to /say; clicking an icon sends its marker there.
local displayEvents
for _, f in ipairs(frames) do if rawget(f, "events").CHAT_MSG_SAY then displayEvents = f end end
button("Test markers").OnClick(button("Test markers"))
check(M:Testing() and button("Stop test").enabled == true and button("Test markers").enabled == false, "Test markers starts the display's test")
local skull = cellButton(8)
skull.OnEnter(skull)
check(table.concat(GameTooltip.lines, " "):find("/say", 1, true) ~= nil, "while testing, the tooltip says a click sends to /say")
skull.OnClick(skull)
check(#sent == 1 and sent[1].msg == "{rt8}" and sent[1].chatType == "SAY", "clicking the skull sends {rt8} to /say")
check(#account == 0, "while testing, a click makes no macro")
displayEvents.OnEvent(displayEvents, "CHAT_MSG_SAY", sent[1].msg, "Solex-Area52")
check(#M:Filled() == 1, "the /say message fills the display")
local filledCell = withText("|Tmarker8|t")
check(filledCell ~= nil and withText("|Tmarker1|t") == nil, "the preview shows the filled slot, not the samples")
check(hasText("Solex"), "with who sent it")
displayEvents.OnEvent(displayEvents, "CHAT_MSG_SAY", "hello there", "Solex-Area52")
check(#M:Filled() == 1, "a /say with no marker code fills nothing")
combat = true
skull.OnClick(skull)
check(#sent == 1, "in combat the click sends nothing")
combat = false
button("Stop test").OnClick(button("Stop test"))
check(not M:Testing() and withText("|Tmarker1|t") ~= nil, "Stop test ends it and the samples come back")

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
for (const p of ['CRT_Core/Macros.lua', 'CRT_Modules/Markers/Macros.lua', 'CRT_Modules/Markers/Database.lua', 'CRT_Modules/Markers/Display.lua', 'CRT_Data/Bosses/Registry.lua', 'CRT_Dev/Tests/SamplePack/Season.lua', 'CRT_Dev/Tests/SamplePack/Sszorak.lua', 'CRT_Modules/Markers/MacrosTab.lua', 'CRT_Core/MarkerText.lua'])
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/' + p, 'utf8')));
if (lua.lua_pcall(L, 9, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
