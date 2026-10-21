// The one table of ability types, Reference.ABILITY_TYPES in CRT_Modules/Timeline/Reference.lua: it is well formed,
// everything built from it (TYPES, TYPE_ORDER, TAG_TYPES, the legend, the tooltip lines) follows it, an old key in
// TYPE_ALIASES still reads, and no other file writes a type's colour (as rrggbb or as r, g, b).
// Usage: node run_ability_types.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const W = process.argv[2];
const refSrc = fs.readFileSync(path.join(W, 'CRT_Modules/Timeline/Reference.lua'), 'utf8');
// the same file with one old key renamed: frontal now reads as dodge
const aliasSrc = refSrc.replace('Reference.TYPE_ALIASES = {}', 'Reference.TYPE_ALIASES = { frontal = "dodge" }');
const harness = `
local refSrc, aliasSrc = ...
local function loadRef(src)
  local CRT = { UI = {}, Timeline = { Settings = function() return {} end, Fire = function() end } }
  CRT.TimelineDB = { references = {} }
  assert(load(src, "Reference.lua"))("CowfeeRaidTools", CRT)
  return CRT.TimelineReference
end
local R = loadRef(refSrc)
local fails = 0
local function check(name, ok) print((ok and "PASS " or "FAIL ") .. name) if not ok then fails = fails + 1 end end

local seen, order, wellFormed, tagsKnown = {}, true, true, true
for i, def in ipairs(R.ABILITY_TYPES) do
  local good = type(def.key) == "string" and def.key:match("^%l+$") and not seen[def.key]
    and type(def.label) == "string" and def.label ~= "" and type(def.desc) == "string" and def.desc ~= ""
    and type(def.hex) == "string" and def.hex:match("^%x%x%x%x%x%x$")
  if not good then wellFormed = false print("  bad entry " .. i .. ": " .. tostring(def.key)) end
  seen[def.key or i] = true
  if R.TYPE_ORDER[i] ~= def.key then order = false end
  for _, tag in ipairs(def.tags or {}) do
    if not R.TAGS[tag] then tagsKnown = false print("  unknown tag " .. tostring(tag)) end
  end
end
check("each type has a lowercase key, a label, a description and an rrggbb colour", wellFormed and #R.ABILITY_TYPES > 0)
check("TYPE_ORDER is the table's order", order and #R.TYPE_ORDER == #R.ABILITY_TYPES)
check("a type's tags are Journal icons", tagsKnown)

local colours = true
for _, def in ipairs(R.ABILITY_TYPES) do
  local t, h = R.TYPES[def.key], def.hex
  local want = { tonumber(h:sub(1, 2), 16) / 255, tonumber(h:sub(3, 4), 16) / 255, tonumber(h:sub(5, 6), 16) / 255 }
  for c = 1, 3 do
    if math.abs(t.color[c] - want[c]) > 1e-9 then colours = false end
  end
  if t.label ~= def.label or t.desc ~= def.desc or t.key ~= def.key or t.hex ~= h:upper() then colours = false end
end
check("TYPES: each type's colour from its hex, with its label and description", colours)
check("TAG_TYPES from the tags", R.TAG_TYPES.magic == "dispel" and R.TAG_TYPES.poison == "dispel" and R.TAG_TYPES.mythic == "mythic"
  and R.TAG_TYPES.heroic == "heroic" and R.TAG_TYPES.tank == nil)
local line, c = R.TypeLine("soak")
check("a tooltip line: label, then the description", line == "Soak: stack to share the damage" and c == R.TYPES.soak.color)
check("no tooltip line for no type", R.TypeLine(nil) == nil and R.TypeLine("nope") == nil)
local legend = R.Legend()
local all = true
for _, key in ipairs(R.TYPE_ORDER) do
  local t = R.TYPES[key]
  if not legend:find("|cff" .. t.hex .. t.label .. " (" .. key .. "): " .. t.desc, 1, true) then all = false end
end
check("the legend lists every type in its colour", all)

for old, new in pairs(R.TYPE_ALIASES) do
  check("alias " .. old .. " points at a type", R.TYPES[new] ~= nil and R.TYPES[old] == R.TYPES[new])
end
local A = loadRef(aliasSrc)
check("an old key reads as its new type", A.TYPES.frontal == A.TYPES.dodge)
local ref = A.Parse("Boss: X\\nCone (type frontal soak): 0:10")
check("an ability timeline with the old key reads, as the new key", ref and ref.rows[1].types[1] == "dodge"
  and ref.rows[1].types[2] == "soak" and ref.rows[1].color[1] == A.TYPES.dodge.color[1])
local listed = false
for _, key in ipairs(A.TYPE_ORDER) do if key == "frontal" then listed = true end end
check("an old key is not listed in the menus", not listed and not A.Legend():find("frontal", 1, true))
print(fails == 0 and "all passed" or (fails .. " failed"))
`;
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
let failed = false;
if (lauxlib.luaL_loadstring(L, to_luastring(harness)) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(refSrc));
lua.lua_pushstring(L, to_luastring(aliasSrc));
if (lua.lua_pcall(L, 2, 0, 0) !== lua.LUA_OK) { console.error('LUA ERROR:', lua.lua_tojsstring(L, -1)); process.exit(1); }

// The lint: the type colours, read from the table's own lines, appear in no other file.
const types = [];
for (const m of refSrc.matchAll(/\{ key = "(\w+)", label = "[^"]*", hex = "([0-9A-Fa-f]{6})"/g)) types.push({ key: m[1], hex: m[2].toUpperCase() });
if (types.length === 0) { console.log('FAIL the lint found no types in Reference.lua'); process.exit(1); }
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255);
const skipDir = new Set(['.claude', '.git', 'node_modules', 'factory']);
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!skipDir.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (/\.(lua|md)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}
const rel = (f) => path.relative(W, f).split(path.sep).join('/');
const bad = [];
const num = String.raw`(\d*\.\d+|\d+)`;
const triple = new RegExp(String.raw`(^|[^\d.])` + num + String.raw`\s*,\s*` + num + String.raw`\s*,\s*` + num + String.raw`(?![\d.])`, 'g');
for (const f of walk(W, [])) {
  const r = rel(f);
  if (r.startsWith('CRT_Dev/Tests/') || r === 'CRT_Modules/Timeline/Reference.lua') continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((text, i) => {
    for (const t of types) {
      if (!new RegExp(t.hex, 'i').test(text)) continue;
      // in a document only a line naming the type counts (the theme table's text colour shares generic's hex)
      if (r.endsWith('.md') && !new RegExp('\\b' + t.key + '\\b', 'i').test(text)) continue;
      // the Default theme's text colour is generic's too: the theme file keeps it
      if (r === 'CRT_Core/Themes.lua') continue;
      bad.push(`${r}:${i + 1}: ${t.key} ${t.hex}: ${text.trim()}`);
    }
    if (!r.endsWith('.lua') || r === 'CRT_Core/Themes.lua') return;
    for (const m of text.matchAll(triple)) {
      const v = [m[2], m[3], m[4]].map(Number);
      for (const t of types) {
        const c = rgb(t.hex);
        // a type colour written as numbers (to two places, as the old table had them); the theme text colour
        // that generic shares is allowed on a line that says so
        if (v.every((x, k) => Math.abs(x - c[k]) < 0.006) && !(t.key === 'generic' && /not a theme colour/.test(text))) {
          bad.push(`${r}:${i + 1}: ${t.key} as numbers: ${text.trim()}`);
        }
      }
    }
  });
}
if (bad.length) {
  console.log('FAIL a type colour written outside Reference.ABILITY_TYPES (read Reference.TYPES[key].color instead):');
  for (const b of bad) console.log('  ' + b);
  failed = true;
} else {
  console.log('PASS no other file writes a type colour');
}
process.exit(failed ? 1 : 0);
