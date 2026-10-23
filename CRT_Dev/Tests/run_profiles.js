// CRT_Core/Profiles.lua: swap at load, switch, copy, reset, delete, export and import.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local src = ...
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
local reloads = 0
function ReloadUI() reloads = reloads + 1 end
local store = {}
C_EncodingUtil = { SerializeCBOR = function(t) store[#store+1] = t return "cbor" .. #store end, CompressString = function(s) return s end, EncodeBase64 = function(s) return s end,
  DecodeBase64 = function(s) return s end, DecompressString = function(s) return s end, DeserializeCBOR = function(s) return store[tonumber(s:match("%d+"))] end }
local CRT = { defaults = { notes = { list = {}, history = {} }, ui = { font = "default" }, groups = { presets = {} }, late = { history = {} }, lastPage = "groups", classCache = {}, timeline = { bosses = {}, record = true }, alerts = { noteLines = { text = false, icon = false, circle = false }, bars = { cap = 5 }, areas = { texts = { cap = 3 }, icons = { cap = 5 }, circles = { cap = 3 } }, reminders = {}, nextId = 1, saved = {}, nextSavedId = 1 } } }
assert(load(src, "CRT_Core/Profiles.lua"))("CowfeeRaidTools", CRT)
local P = CRT.Profiles
local function fill(db, src) src = src or CRT.defaults for k, v in pairs(src) do if type(v) == "table" then if type(db[k]) ~= "table" then db[k] = {} end fill(db[k], v) elseif db[k] == nil then db[k] = v end end end
-- First load ever: an old CRTDB with no profiles becomes Default.
CRTDB = { ui = { font = "Expressway" }, groups = { presets = { "A" } }, late = { history = { 1, 2 } }, lastPage = "notes", classCache = { x = "MAGE" } }
CRTDBChar = nil
P:Load() fill(CRTDB)
print("first load: active " .. P:Current() .. ", font " .. CRTDB.ui.font .. ", char " .. CRTDBChar.profile)
-- Create Raid and switch: reload, then load puts a fresh profile on top.
P:Switch("Raid") P:Load() fill(CRTDB)
print("switched: active " .. P:Current() .. ", font " .. CRTDB.ui.font .. ", presets " .. #CRTDB.groups.presets .. ", classCache kept " .. tostring(CRTDB.classCache.x) .. ", list " .. table.concat(P:List(), ","))
CRTDB.ui.font = "Arial"
assert(type(CRTDB.timeline) == "table" and CRTDB.timeline.record == true, "new profile gets the timeline defaults")
CRTDB.timeline.bosses[3001] = { name = "Alpha", pulls = {} } CRTDB.timeline.record = false
assert(type(CRTDB.alerts) == "table" and CRTDB.alerts.bars.cap == 5, "new profile gets the alerts defaults")
CRTDB.alerts.reminders[1] = { id = 1 } CRTDB.alerts.saved[3] = { name = "Soak" } CRTDB.alerts.nextSavedId = 4 CRTDB.alerts.bars.cap = 8 CRTDB.alerts.areas.texts.cap = 7 CRTDB.alerts.areas.texts.position = { point = "CENTER", x = 5, y = 6 }
-- Another character with no profile uses the default (Default).
local raidChar = CRTDBChar
CRTDBChar = {} P:Load() fill(CRTDB)
print("other character: active " .. P:Current() .. ", font " .. CRTDB.ui.font .. ", history " .. #CRTDB.late.history)
-- Copy Raid into Default.
P:CopyFrom("Raid") fill(CRTDB)
print("copied Raid: font " .. CRTDB.ui.font .. ", presets " .. #CRTDB.groups.presets .. ", Raid still " .. CRTDB.profiles.Raid.ui.font)
assert(CRTDB.timeline and CRTDB.timeline.bosses[3001] and CRTDB.timeline.record == false, "profile copy carries timeline")
print("ok profile copy carries timeline")
assert(CRTDB.alerts.reminders[1] and CRTDB.alerts.bars.cap == 8, "profile copy carries alerts")
print("ok profile copy carries alerts")
assert(CRTDB.alerts.saved[3] and CRTDB.alerts.saved[3].name == "Soak" and CRTDB.alerts.nextSavedId == 4, "profile copy carries saved alerts")
print("ok saved: carried by profiles (copy)")
assert(CRTDB.alerts.areas.texts.cap == 7 and CRTDB.alerts.areas.texts.position.x == 5 and CRTDB.alerts.areas.icons.cap == 5, "profile copy carries alert areas")
print("ok profile copy carries alert areas")
CRTDB.ui.font = "Copied"
CRTDB.profiles.Raid.ui.font = "Arial"
-- Export and import. A note's earlier texts (notes.history) stay behind; the notes go.
CRTDB.notes.list[1] = { raw = "the note" } CRTDB.notes.history[1] = { { text = "an earlier text" } }
local text = P:Export()
print("export: " .. text:sub(1, 6) .. ", import as Raid: " .. tostring(select(2, P:Import(text, "Raid"))) .. ", as Copy: " .. tostring(P:Import(text, "Copy")) .. ", bad text: " .. tostring(select(2, P:Import("hello", "X"))))
print("imported font " .. CRTDB.profiles.Copy.ui.font)
assert(CRTDB.profiles.Copy.notes.list[1].raw == "the note" and CRTDB.profiles.Copy.notes.history == nil, "export carries the notes, not their history")
assert(CRTDB.notes.history[1][1].text == "an earlier text", "and the history stays in the profile")
print("ok note history: never in a profile export")
assert(CRTDB.profiles.Copy.alerts and CRTDB.profiles.Copy.alerts.reminders[1], "export carries alerts")
print("ok export carries alerts")
assert(CRTDB.profiles.Copy.alerts.saved[3] and CRTDB.profiles.Copy.alerts.saved[3].name == "Soak" and CRTDB.profiles.Copy.alerts.nextSavedId == 4, "export carries saved alerts")
print("ok saved: carried by profiles (export)")
-- Reset.
P:Reset() fill(CRTDB)
print("reset: font " .. CRTDB.ui.font .. ", presets " .. #CRTDB.groups.presets .. ", classCache " .. tostring(CRTDB.classCache.x))
assert(CRTDB.timeline and next(CRTDB.timeline.bosses) == nil and CRTDB.timeline.record == true, "profile reset gives a fresh timeline table")
print("ok profile reset gives a fresh timeline table")
assert(CRTDB.alerts and CRTDB.alerts.reminders[1] == nil and CRTDB.alerts.bars.cap == 5, "profile reset gives fresh alerts")
print("ok profile reset gives fresh alerts")
assert(next(CRTDB.alerts.saved) == nil and CRTDB.alerts.nextSavedId == 1, "reset clears saved alerts")
print("ok saved: profile reset gives none")
assert(CRTDB.alerts.areas.texts.cap == 3 and CRTDB.alerts.areas.texts.position == nil, "profile reset gives fresh alert areas")
print("ok profile reset gives fresh alert areas")
-- Delete, and the default moves off a deleted profile.
P:SetDefault("Copy") P:Delete("Copy")
print("deleted Copy: list " .. table.concat(P:List(), ",") .. ", default " .. P:Default() .. ", can't delete active: " .. tostring(P:Delete("Default") == nil and P:Exists("Default")))
-- The Raid character comes back.
CRTDBChar = raidChar P:Load() fill(CRTDB)
print("raid character back: active " .. P:Current() .. ", font " .. CRTDB.ui.font .. ", reloads " .. reloads)
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(process.argv[2], 'utf8')));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
