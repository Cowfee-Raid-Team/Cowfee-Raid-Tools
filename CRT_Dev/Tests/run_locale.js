// CRT_Core/Locale.lua: CRT.Locale(ns, english), the translation table every file's TEXT table goes through.
// With no overrides for the client's language (or for the namespace, or with no GetLocale at all) it hands back the
// English table itself; a fake CRT.LOCALE.xxXX override replaces one key and leaves the rest English, a table-valued
// key is replaced whole, a key English lacks or an override of another type is ignored, and GetLocale erroring counts
// as no language. Then the lint: every addon file (not the CRT_Dev/Tests fixtures) that keeps a TEXT table wraps it
// in CRT.Locale (no plain "local TEXT = {"), no two files share a namespace, and the .toc loads Locale.lua before
// every file that calls CRT.Locale. The lint's first inputs are planted mistakes it must find.
// Usage: node run_locale.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const dir = process.argv[2];
let passes = 0, fails = 0;
function check(ok, what) { if (ok) { passes++; console.log('ok ' + what); } else { fails++; console.log('FAIL ' + what); } }

// ---- CRT.Locale itself, in Lua ----
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
local src = ...
local fails, passes = 0, 0
local function check(ok, what) if ok then passes = passes + 1 print("ok " .. what) else fails = fails + 1 print("FAIL " .. what) end end
local function load_locale()
  local CRT = {}
  assert(load(src, "CRT_Core/Locale.lua"))("CowfeeRaidTools", CRT)
  return CRT
end

local function english()
  return { title = "Notes", count = "%d of %d", options = { "intro", { "Name", "text" } }, size = 12 }
end

-- an English client, nothing translated: the English table itself
GetLocale = function() return "enUS" end
local CRT = load_locale()
check(type(CRT.Locale) == "function" and type(CRT.LOCALE) == "table" and next(CRT.LOCALE) == nil, "CRT.Locale exists and CRT.LOCALE starts empty")
local en = english()
check(CRT.Locale("Notes.Page", en) == en, "no overrides: the English table comes back unchanged (no copy)")
check(getmetatable(CRT.Locale("Notes.Page", en)) == nil, "no overrides: no metatable either")

-- a fake language: one key replaced, the rest English
GetLocale = function() return "xxXX" end
CRT.LOCALE.xxXX = { ["Notes.Page"] = { title = "Notizen" } }
en = english()
local T = CRT.Locale("Notes.Page", en)
check(T ~= en and T.title == "Notizen", "an override replaces its key")
check(T.count == "%d of %d" and T.size == 12 and T.options == en.options, "every other key stays English")
check(en.title == "Notes", "the English table is never changed")
check(getmetatable(T) == nil, "the translated table is a plain table")

-- another namespace in the same language: untouched
local other = english()
check(CRT.Locale("Groups.Page", other) == other, "a namespace the language leaves out: the English table unchanged")

-- a table-valued key is replaced whole
CRT.LOCALE.xxXX = { ["Notes.Page"] = { options = { "einleitung" } } }
T = CRT.Locale("Notes.Page", english())
check(#T.options == 1 and T.options[1] == "einleitung" and T.options[2] == nil, "a table-valued key is replaced whole, never merged")

-- an override of another type, or a key English lacks, is ignored: a key in English never reads nil or the wrong kind
CRT.LOCALE.xxXX = { ["Notes.Page"] = { options = "nope", title = false, extra = "Extra" } }
T = CRT.Locale("Notes.Page", english())
check(type(T.options) == "table" and T.options[1] == "intro" and T.title == "Notes", "an override of another type is ignored")
check(T.extra == nil, "a key English doesn't have is ignored")

-- an empty namespace table costs nothing
CRT.LOCALE.xxXX = { ["Notes.Page"] = {} }
en = english()
check(CRT.Locale("Notes.Page", en) == en, "an empty override table: the English table unchanged")

-- a translated table can still be written into later (a file that adds to TEXT at run time)
CRT.LOCALE.xxXX = { ["Notes.Page"] = { title = "Notizen" } }
T = CRT.Locale("Notes.Page", english())
T.later = "added"
check(T.later == "added", "a translated table takes later writes")

-- a missing language, a missing GetLocale, a GetLocale that errors or returns no string: English unchanged
GetLocale = function() return "zzZZ" end
en = english()
check(CRT.Locale("Notes.Page", en) == en, "a language with no table: the English table unchanged")
GetLocale = nil
check(CRT.Locale("Notes.Page", en) == en, "no GetLocale: the English table unchanged")
GetLocale = function() error("no locale") end
check(CRT.Locale("Notes.Page", en) == en, "a GetLocale that errors: the English table unchanged")
GetLocale = function() return nil end
check(CRT.Locale("Notes.Page", en) == en, "a GetLocale with no answer: the English table unchanged")

-- loading Locale.lua again keeps a table a locale file already filled
local CRT2 = { LOCALE = { deDE = { ["Notes.Page"] = { title = "Notizen" } } } }
assert(load(src, "CRT_Core/Locale.lua"))("CowfeeRaidTools", CRT2)
check(CRT2.LOCALE.deDE ~= nil, "Locale.lua keeps a CRT.LOCALE already filled")

print(string.format("%d passed, %d failed", passes, fails))
if fails > 0 then error("failures") end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
const localePath = path.join(dir, 'CRT_Core/Locale.lua');
lua.lua_pushstring(L, to_luastring(fs.existsSync(localePath) ? fs.readFileSync(localePath, 'utf8') : 'error("missing CRT_Core/Locale.lua")'));
if (lua.lua_pcall(L, 1, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }

// ---- the harnesses' preload (locale_preload.js, through runner_lib.sh): an addon file gets the real CRT.Locale ----
{
  const preloaded = Object.keys(require.cache).some((k) => /locale_preload\.js$/.test(k));
  check(preloaded, 'the harnesses run with locale_preload.js (run this group through test.sh)');
  const P = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(P);
  const probe = `
local fileSrc = ...
local CRT = {}
assert(load(fileSrc, "Fake/File.lua"))("CowfeeRaidTools", CRT)
local kept = { Locale = function(ns, e) return { mine = true } end }
assert(load(fileSrc, "Fake/File.lua"))("CowfeeRaidTools", kept)
local ok, err = pcall(assert(load(fileSrc .. "\\nerror('on line 5')", "Fake/File.lua")), "CowfeeRaidTools", {})
return CRT.got, type(CRT.LOCALE), kept.got, tostring(err)
`;
  const file = 'local ADDON, CRT = ...\nlocal TEXT = CRT.Locale("Fake.File", { title = "Title" })\nCRT.got = TEXT.title or (TEXT.mine and "mine")\n-- line 4';
  if (lauxlib.luaL_loadstring(P, to_luastring(probe)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(P, -1)); process.exit(1); }
  lua.lua_pushstring(P, to_luastring(file));
  if (lua.lua_pcall(P, 1, 4, 0) !== lua.LUA_OK) {
    check(false, 'an addon file loads in a harness with no Locale.lua of its own: ' + lua.lua_tojsstring(P, -1));
  } else {
    check(lua.lua_tojsstring(P, -4) === 'Title' && lua.lua_tojsstring(P, -3) === 'table', 'an addon file loaded in a harness gets the real CRT.Locale (English)');
    check(lua.lua_tojsstring(P, -2) === 'mine', 'a CRT that has its own Locale keeps it');
    check(/Fake\/File\.lua"?\]?:5:/.test(lua.lua_tojsstring(P, -1)), 'line numbers in errors stay as written: ' + lua.lua_tojsstring(P, -1));
  }
}

// ---- the lint ----
// A file's code with its comments taken out (line comments and --[[ ]] blocks), lines kept in place.
function code(src) {
  return src.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, '');
}
// The plain TEXT tables in one file's code: "local TEXT = {" not wrapped in CRT.Locale.
function plainText(src) {
  const out = [];
  code(src).split('\n').forEach((line, i) => { if (/^\s*local\s+TEXT\s*=\s*\{/.test(line)) out.push(i + 1); });
  return out;
}
// The namespaces one file passes to CRT.Locale.
function namespaces(src) {
  const out = [];
  const re = /CRT\.Locale\(\s*"([^"]*)"/g;
  let m;
  const c = code(src);
  while ((m = re.exec(c))) out.push(m[1]);
  return out;
}
function usesLocale(src) { return /CRT\.Locale\(/.test(code(src)); }

// planted mistakes: the lint must find them
check(plainText('local ADDON, CRT = ...\nlocal TEXT = {\n  title = "x",\n}\n').length === 1, 'lint: finds a planted plain TEXT table');
check(plainText('local TEXT = CRT.Locale("A.B", {\n  title = "x",\n})\n').length === 0, 'lint: a wrapped TEXT table passes');
check(plainText('-- local TEXT = {\n').length === 0, 'lint: a commented-out TEXT table is not code');
check(namespaces('local TEXT = CRT.Locale("A.B", {})').join() === 'A.B', 'lint: reads a namespace');

// every addon .lua file, leaving out the test fixtures under CRT_Dev/Tests (and node_modules, .git and worktrees)
function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    const rel = path.relative(dir, p).split(path.sep).join('/');
    if (rel === 'CRT_Dev/Tests') continue;
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.lua')) out.push(rel);
  }
  return out;
}
const files = walk(dir, []);
const plain = [], seen = new Map(), dupes = [], users = [];
for (const rel of files) {
  const src = fs.readFileSync(path.join(dir, rel), 'utf8');
  for (const line of plainText(src)) plain.push(rel + ':' + line);
  for (const ns of namespaces(src)) {
    if (seen.has(ns)) dupes.push('"' + ns + '" in ' + seen.get(ns) + ' and ' + rel);
    else seen.set(ns, rel);
  }
  if (rel !== 'CRT_Core/Locale.lua' && usesLocale(src)) users.push(rel);
}
check(files.length > 100 && seen.size > 100, 'lint: reads the addon files (' + files.length + ' files, ' + seen.size + ' namespaces)');
check(plain.length === 0, 'every TEXT table goes through CRT.Locale' + (plain.length ? ': plain in ' + plain.join(', ') : ''));
check(dupes.length === 0, 'no two files share a namespace' + (dupes.length ? ': ' + dupes.join('; ') : ''));
const empty = [...seen.keys()].filter((ns) => !/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(ns));
check(empty.length === 0, 'every namespace reads Module.File' + (empty.length ? ': ' + empty.join(', ') : ''));

// the .toc: Locale.lua before every file that calls CRT.Locale (a season pack's files come later, through its Season.xml)
const toc = fs.readFileSync(path.join(dir, 'CowfeeRaidTools.toc'), 'utf8').split(/\r?\n/).map((l) => l.trim().replace(/\\/g, '/'));
const at = toc.indexOf('CRT_Core/Locale.lua');
check(at > 0, 'the .toc loads CRT_Core/Locale.lua');
const early = users.filter((rel) => { const i = toc.indexOf(rel); return i >= 0 && i < at; });
check(early.length === 0, 'the .toc loads Locale.lua before every file with a TEXT table' + (early.length ? ': before it ' + early.join(', ') : ''));

// every file that calls CRT.Locale loads: it is in the .toc or in a Season.xml the .toc lists (a file nothing loads
// would keep a TEXT table no one reads, and its namespace would hide a typo)
function xmlScripts(xmlRel) {
  const p = path.join(dir, xmlRel);
  if (!fs.existsSync(p)) return [];
  const base = path.posix.dirname(xmlRel);
  const xml = fs.readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  const re = /<Script\s+file="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml))) out.push(path.posix.join(base, m[1].replace(/\\/g, '/')));
  return out;
}
function loadedFiles(tocLines) {
  const set = new Set();
  for (const l of tocLines) {
    if (!l || l.startsWith('#')) continue;
    if (l.endsWith('.xml')) for (const f of xmlScripts(l)) set.add(f);
    else set.add(l);
  }
  return set;
}
const unlisted = (callers, loaded) => callers.filter((rel) => !loaded.has(rel));
check(unlisted(['A/B.lua', 'A/C.lua'], new Set(['A/B.lua'])).join() === 'A/C.lua', 'lint: finds a planted CRT.Locale caller nothing loads');
const loaded = loadedFiles(toc);
check(loaded.has('CRT_Data/Seasons/Midnight-S2/Season.lua') || [...loaded].some((f) => /^CRT_Data\/Seasons\//.test(f)), 'lint: reads the season packs\' Season.xml files');
const stray = unlisted(users, loaded);
check(stray.length === 0, 'every file that calls CRT.Locale is in the .toc or a Season.xml' + (stray.length ? ': not loaded ' + stray.join(', ') : ''));

console.log(passes + ' passed, ' + fails + ' failed');
if (fails > 0) process.exit(1);
