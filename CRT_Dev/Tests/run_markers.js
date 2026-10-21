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
local dbSrc, displaySrc = ...
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

local function mock(kind)
  local m = { shown = false, kind = kind, events = {} }
  return setmetatable(m, { __index = function(t, k)
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock("r") end end
    if k == "SetText" then return function(self, s) rawset(self, "text", s) end end
    if k == "GetText" then return function(self) return rawget(self, "text") end end
    if k == "Show" then return function(self) rawset(self, "shown", true) end end
    if k == "Hide" then return function(self) rawset(self, "shown", false) end end
    if k == "SetShown" then return function(self, on) rawset(self, "shown", on and true or false) end end
    if k == "IsShown" then return function(self) return rawget(self, "shown") end end
    if k == "SetScript" then return function(self, n, fn) rawset(self, n, fn) end end
    if k == "RegisterEvent" then return function(self, e) rawget(self, "events")[e] = true end end
    if k == "GetPoint" then return function() return "CENTER", nil, "CENTER", 0, 0 end end
    return function() end end })
end
local frames = {}
function CreateFrame(kind) local m = mock(kind) frames[#frames + 1] = m return m end
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
CRT.UI = { RegisterThemed = function() end, RegisterLayer = function() end, RegisterPreview = function() end,
  ResetButton = function() return mock() end }
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

print(passes .. " passed, " .. fails .. " failed")
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const d = process.argv[2];
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Markers/Database.lua', 'utf8')));
lua.lua_pushstring(L, to_luastring(fs.readFileSync(d + '/CRT_Modules/Markers/Display.lua', 'utf8')));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
