// The alert settings table (CRT_Modules/Alerts/Fields.lua) and its document (CRT_Dev/AlertSettings.md, the
// crt-alert-settings skill's table): every entry is whole, and every key is in the document, so it can't drift.
// Usage: node run_alert_settings.js <addon folder>          the checks
//        node run_alert_settings.js <addon folder> table    prints the table from the data, for AlertSettings.md
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const root = process.argv[2];
const mode = process.argv[3] || 'check';
if (!root) { console.error('usage: node run_alert_settings.js <addon folder> [table]'); process.exit(2); }
const files = ['CRT_Modules/Alerts/Rules.lua', 'CRT_Modules/Alerts/Engine.lua', 'CRT_Modules/Alerts/Reminders.lua',
  'CRT_Modules/Alerts/Draft.lua', 'CRT_Modules/Alerts/SubTabs.lua', 'CRT_Modules/Alerts/Fields.lua'];
const doc = fs.readFileSync(path.join(root, 'CRT_Dev', 'AlertSettings.md'), 'utf8');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const harness = `
local MODE, DOC = ...
local sources = { select(3, ...) }
function CreateFrame() return { SetScript = function() end, RegisterEvent = function() end } end
function GetTime() return 0 end
C_Timer = { After = function() end }
local CRT = { db = { alerts = { reminders = {}, phases = {}, overrides = {}, nextId = 1 }, notes = {} }, UI = {} }
for i = 1, #sources, 2 do
  assert(load(sources[i + 1], "@" .. sources[i]))("CowfeeRaidTools", CRT)
end
local F = CRT.AlertFields
assert(F and F.LIST and F.TEXT, "CRT.AlertFields loads")
if MODE == "table" then
  print(F.Table())
  return
end
local failed = 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then print("ok " .. name) else print("FAIL " .. name .. ": " .. tostring(err)); failed = failed + 1 end
end
local TABS = { when = true, looks = true, sound = true, shield = true }
check("every setting is whole: key, tab, kind, label, meaning, default, where it lives", function()
  local seen = {}
  for i, f in ipairs(F.LIST) do
    local at = tostring(f.key or i)
    assert(type(f.key) == "string" and not seen[f.key], at .. ": a key, once")
    seen[f.key] = true
    assert(TABS[f.tab], at .. ": a tab of Alerts/SubTabs.lua")
    assert(type(f.kind) == "string" and type(f.label) == "string" and f.label ~= "", at .. ": kind and label")
    assert(type(f.meaning) == "string" and f.meaning ~= "", at .. ": what it means")
    assert(f.default ~= nil, at .. ": a default")
    assert(type(f.lives) == "table" and f.lives.reminder, at .. ": where it lives (a reminder at least)")
    assert((f.note ~= nil) == (f.lives.note == true), at .. ": a note line field exactly when a line can carry it")
    if f.range then
      assert(f.range.min < f.range.max and f.range.step > 0 and f.default >= f.range.min and f.default <= f.range.max, at .. ": its range")
    end
    if f.help then assert(type(f.help) == "string" and f.help ~= "", at .. ": its (?)") end
  end
  assert(F.BY_KEY.countFrom.range == CRT.AlertReminders.COUNT_FROM and F.BY_KEY.speakBefore.range == CRT.AlertReminders.SPEAK_BEFORE,
    "the ranges are the reminders' own (Alerts/Reminders.lua)")
end)
check("the document (CRT_Dev/AlertSettings.md) has every key in its table", function()
  local missing = {}
  for _, f in ipairs(F.LIST) do
    if not DOC:find("| \`" .. f.key .. "\` |", 1, true) then missing[#missing + 1] = f.key end
  end
  assert(#missing == 0, "not in the table: " .. table.concat(missing, ", ") .. " (node run_alert_settings.js <addon> table prints it)")
end)
check("the document's table is the data's", function()
  assert(DOC:find(F.Table(), 1, true), "the table differs from the data: print it with node run_alert_settings.js <addon> table and paste it in")
end)
if failed > 0 then error(failed .. " failed") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(mode));
lua.lua_pushstring(L, to_luastring(doc.split('\r\n').join('\n')));
for (const f of files) {
  lua.lua_pushstring(L, to_luastring(f));
  lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(root, f), 'utf8')));
}
if (lua.lua_pcall(L, 2 + files.length * 2, 0, 0) !== lua.LUA_OK) { console.log('FAIL ' + lua.lua_tojsstring(L, -1)); process.exit(1); }
