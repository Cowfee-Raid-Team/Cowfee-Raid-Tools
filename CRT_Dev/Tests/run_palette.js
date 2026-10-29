// The palette keys (CRT_Core/Themes.lua), named for what they colour, and CRT.PALETTE, the theme in use.
//   1. The keys, in CRT.THEME_KEYS's order.
//   2. Every theme's colour for every key is the one it had before the keys were renamed (the snapshot below, by
//      role), so the rename changed nothing on screen; CRT:UseTheme fills CRT.PALETTE with it. A job that changes a
//      theme's colours on purpose updates that theme here; a new theme needs no entry.
//   3. Every key a call site names (UI.Tint, UI.Color, UI.Hex, UI.ColorText, UI.PaintShape, UI.StripColor, the
//      Timeline's themed and rgba helpers, a CRT.PALETTE read, and the key tables in Panel.lua, Window.lua and
//      ScrollBar.lua) is in CRT.THEME_KEYS.
//   4. No old key name or CRT.MOCHA left in CRT_Core, CRT_Modules or CRT_Data.
// Usage: node run_palette.js <addon folder>
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const root = process.argv[2];
let passes = 0, fails = 0;
function check(ok, what) { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } }

const KEYS = ['background', 'surface', 'border', 'selected', 'accent', 'label', 'heading', 'text', 'good', 'warn', 'bad',
  'knob', 'knobBorder', 'knobShine', 'knobText', 'check', 'checkBorder', 'titleTop', 'titleBottom', 'muted', 'outline', 'steelLight', 'steelDark'];
// The old name of each key, for the lint.
const OLD = {
  espresso: 'background', roast: 'surface', edge: 'border', mocha: 'selected', caramel: 'accent', latte: 'label',
  cream: 'text', matcha: 'good', walnut: 'knob', walnutEdge: 'knobBorder', walnutShine: 'knobShine',
  walnutText: 'knobText', tick: 'check', checkEdge: 'checkBorder', stripTop: 'titleTop', stripBottom: 'titleBottom',
  note: 'muted',
};

// Every theme's colours before the rename, by role (Default: Blizzard's heading, good, warn and bad are the
// fallbacks: the harness has no game colour globals).
const SNAPSHOT = {
  blizzard: {
    background: [0.11, 0.078, 0.063],
    surface: [0.165, 0.122, 0.098],
    border: [0.3, 0.235, 0.188],
    selected: [0.44, 0.31, 0.22],
    accent: [0.78, 0.56, 0.36],
    label: [0.87, 0.73, 0.56],
    heading: [1, 0.82, 0],
    text: [0.95, 0.9, 0.84],
    good: [0.09803921568627451, 1, 0.09803921568627451],
    warn: [1, 0.5019607843137255, 0.25098039215686274],
    bad: [1, 0.12549019607843137, 0.12549019607843137],
    knob: [0.2901960784313726, 0.20392156862745098, 0.1411764705882353],
    knobBorder: [0.10196078431372549, 0.07058823529411765, 0.047058823529411764],
    knobShine: [0.47843137254901963, 0.35294117647058826, 0.24313725490196078],
    knobText: [1, 1, 1],
    check: [1, 1, 1],
    checkBorder: [0.10196078431372549, 0.07058823529411765, 0.047058823529411764],
    titleTop: [0.353, 0.247, 0.173],
    titleBottom: [0.227, 0.165, 0.122],
    muted: [0.8, 0.71, 0.6],
    outline: [0.10196078431372549, 0.07058823529411765, 0.047058823529411764],
    steelLight: [0.788235294117647, 0.8, 0.8196078431372549],
    steelDark: [0.1803921568627451, 0.18823529411764706, 0.2],
  },
  midnight: {
    background: [0.0196078431372549, 0.0196078431372549, 0.0196078431372549],
    surface: [0.07058823529411765, 0.07058823529411765, 0.07058823529411765],
    border: [0.1803921568627451, 0.1803921568627451, 0.1803921568627451],
    selected: [0.16470588235294117, 0.16470588235294117, 0.16470588235294117],
    accent: [0.9019607843137255, 0.9019607843137255, 0.9019607843137255],
    label: [0.7411764705882353, 0.7411764705882353, 0.7411764705882353],
    heading: [0.7411764705882353, 0.7411764705882353, 0.7411764705882353],
    text: [0.9490196078431372, 0.9490196078431372, 0.9490196078431372],
    good: [0.4980392156862745, 0.7490196078431373, 0.4980392156862745],
    warn: [0.9019607843137255, 0.7058823529411765, 0.3137254901960784],
    bad: [0.8784313725490196, 0.4235294117647059, 0.4235294117647059],
    knob: [0.11764705882352941, 0.11764705882352941, 0.11764705882352941],
    knobBorder: [0, 0, 0],
    knobShine: [0.22745098039215686, 0.22745098039215686, 0.22745098039215686],
    knobText: [0.9490196078431372, 0.9490196078431372, 0.9490196078431372],
    check: [0.9019607843137255, 0.9019607843137255, 0.9019607843137255],
    checkBorder: [0.9019607843137255, 0.9019607843137255, 0.9019607843137255],
    titleTop: [0.10980392156862745, 0.10980392156862745, 0.10980392156862745],
    titleBottom: [0.054901960784313725, 0.054901960784313725, 0.054901960784313725],
    muted: [0.6196078431372549, 0.6196078431372549, 0.6196078431372549],
    outline: [0, 0, 0],
    steelLight: [0.6196078431372549, 0.6196078431372549, 0.6196078431372549],
    steelDark: [0.1803921568627451, 0.1803921568627451, 0.1803921568627451],
  },
  nitro: {
    background: [0.023529411764705882, 0.03137254901960784, 0.0392156862745098],
    surface: [0.06666666666666667, 0.08235294117647059, 0.10196078431372549],
    border: [0.1568627450980392, 0.19215686274509805, 0.23137254901960785],
    selected: [0.11764705882352941, 0.16470588235294117, 0.21176470588235294],
    accent: [0.4980392156862745, 0.7019607843137254, 0.8509803921568627],
    label: [0.6627450980392157, 0.7333333333333333, 0.796078431372549],
    heading: [0.6627450980392157, 0.7333333333333333, 0.796078431372549],
    text: [0.9333333333333333, 0.9490196078431372, 0.9607843137254902],
    good: [0.5607843137254902, 0.8117647058823529, 0.6274509803921569],
    warn: [1, 0.8784313725490196, 0.4],
    bad: [1, 0.6039215686274509, 0.30196078431372547],
    knob: [0.09411764705882353, 0.12549019607843137, 0.16470588235294117],
    knobBorder: [0, 0, 0],
    knobShine: [0.20392156862745098, 0.2549019607843137, 0.30980392156862746],
    knobText: [0.9333333333333333, 0.9490196078431372, 0.9607843137254902],
    check: [0.4980392156862745, 0.7019607843137254, 0.8509803921568627],
    checkBorder: [0.4980392156862745, 0.7019607843137254, 0.8509803921568627],
    titleTop: [0.10196078431372549, 0.1411764705882353, 0.18823529411764706],
    titleBottom: [0.054901960784313725, 0.07450980392156863, 0.09803921568627451],
    muted: [0.5411764705882353, 0.615686274509804, 0.6901960784313725],
    outline: [0, 0, 0],
    steelLight: [0.5411764705882353, 0.615686274509804, 0.6901960784313725],
    steelDark: [0.1568627450980392, 0.19215686274509805, 0.23137254901960785],
  },
  cowfee: {
    background: [0.09019607843137255, 0.06666666666666667, 0.054901960784313725],
    surface: [0.16862745098039217, 0.11764705882352941, 0.09019607843137255],
    border: [0.35294117647058826, 0.25882352941176473, 0.19215686274509805],
    selected: [0.5490196078431373, 0.30980392156862746, 0.16862745098039217],
    accent: [0.8862745098039215, 0.6313725490196078, 0.29411764705882354],
    label: [0.8509803921568627, 0.7058823529411765, 0.5411764705882353],
    heading: [0.8509803921568627, 0.7058823529411765, 0.5411764705882353],
    text: [0.9568627450980393, 0.9215686274509803, 0.8666666666666667],
    good: [0.5607843137254902, 0.6588235294117647, 0.4627450980392157],
    warn: [0.9490196078431372, 0.7568627450980392, 0.3058823529411765],
    bad: [0.3568627450980392, 0.6078431372549019, 0.9019607843137255],
    knob: [0.2901960784313726, 0.20392156862745098, 0.1411764705882353],
    knobBorder: [0.10196078431372549, 0.07058823529411765, 0.047058823529411764],
    knobShine: [0.47843137254901963, 0.35294117647058826, 0.24313725490196078],
    knobText: [1, 1, 1],
    check: [1, 1, 1],
    checkBorder: [0.10196078431372549, 0.07058823529411765, 0.047058823529411764],
    titleTop: [0.353, 0.247, 0.173],
    titleBottom: [0.227, 0.165, 0.122],
    muted: [0.8, 0.71, 0.6],
    outline: [0.09019607843137255, 0.06666666666666667, 0.054901960784313725],
    steelLight: [0.8509803921568627, 0.7058823529411765, 0.5411764705882353],
    steelDark: [0.35294117647058826, 0.25882352941176473, 0.19215686274509805],
  },
};

// 1 and 2: load Themes.lua and read its keys and palettes.
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const dump = `
local src = ...
local CRT = {}
assert(load(src, "Themes.lua"))("CowfeeRaidTools", CRT)
local out = {}
local function put(s) out[#out + 1] = s end
local function color(c) return type(c) == "table" and string.format("[%.17g,%.17g,%.17g]", c[1], c[2], c[3]) or "null" end
local function palette(p)
  local parts = {}
  for k, c in pairs(p) do parts[#parts + 1] = string.format("%q:%s", k, color(c)) end
  return "{" .. table.concat(parts, ",") .. "}"
end
put('{"keys":[')
for i, k in ipairs(CRT.THEME_KEYS) do put((i > 1 and "," or "") .. string.format("%q", k)) end
put('],"mocha":' .. tostring(CRT.MOCHA ~= nil) .. ',"themes":{')
for i, info in ipairs(CRT.THEME_LIST) do put((i > 1 and "," or "") .. string.format("%q:", info.key) .. palette(CRT.THEMES[info.key])) end
put('},"inUse":{')
local kept = CRT.PALETTE and CRT.PALETTE.accent
local same = true
for i, info in ipairs(CRT.THEME_LIST) do
  CRT:UseTheme(info.key)
  if CRT.PALETTE and CRT.PALETTE.accent ~= kept then same = false end
  put((i > 1 and "," or "") .. string.format("%q:", info.key) .. (CRT.PALETTE and palette(CRT.PALETTE) or "null"))
end
put('},"kept":' .. tostring(same and kept ~= nil) .. '}')
return table.concat(out)
`;
let data = null;
if (lauxlib.luaL_loadstring(L, to_luastring(dump)) !== lua.LUA_OK) { console.error(lua.lua_tojsstring(L, -1)); process.exit(1); }
lua.lua_pushstring(L, to_luastring(fs.readFileSync(path.join(root, 'CRT_Core/Themes.lua'), 'utf8')));
if (lua.lua_pcall(L, 1, 1, 0) !== lua.LUA_OK) console.log('FAIL Themes.lua: ' + lua.lua_tojsstring(L, -1));
else data = JSON.parse(lua.lua_tojsstring(L, -1));

const near = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 3 && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
if (data) {
  check(JSON.stringify(data.keys) === JSON.stringify(KEYS), 'CRT.THEME_KEYS is ' + KEYS.join(', ') + ' (got ' + data.keys.join(', ') + ')');
  check(!data.mocha, 'CRT.MOCHA is gone (CRT.PALETTE is the theme in use)');
  check(data.kept, 'CRT.PALETTE\'s tables are refilled in place, so a kept one follows a switch');
  for (const theme of Object.keys(SNAPSHOT)) {
    const pal = data.themes[theme] || {};
    const inUse = data.inUse[theme] || {};
    let same = true, filled = true;
    for (const k of KEYS) {
      if (!near(pal[k], SNAPSHOT[theme][k])) { same = false; console.log('FAIL ' + theme + '.' + k + ' is ' + JSON.stringify(pal[k]) + ', was ' + JSON.stringify(SNAPSHOT[theme][k])); }
      if (!near(inUse[k], SNAPSHOT[theme][k])) filled = false;
    }
    check(same, theme + ': every colour is the one it had before the rename');
    check(Object.keys(pal).length === KEYS.length, theme + ': no key beyond CRT.THEME_KEYS (' + Object.keys(pal).length + ')');
    check(filled, theme + ': CRT:UseTheme fills CRT.PALETTE with its colours');
  }
  console.log('ok palette: the keys and every theme\'s colours');
}

// 3 and 4: the source.
const DIRS = ['CRT_Core', 'CRT_Modules', 'CRT_Data'];
function luaFiles(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(luaFiles(p));
    else if (e.name.endsWith('.lua')) out.push(p);
  }
  return out;
}
const files = [].concat(...DIRS.map((d) => luaFiles(path.join(root, d))));
const keySet = new Set(KEYS);

// The code of a line, without its comment (a -- outside a string).
function code(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}
// The arguments of the call whose ( is at src[open], split at top-level commas.
function args(src, open) {
  const out = [];
  let depth = 0, q = null, start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) { out.push(src.slice(start, i)); return out; } }
    else if (c === ',' && depth === 1) { out.push(src.slice(start, i)); start = i + 1; }
  }
  return out;
}
const words = (s) => [...(s || '').matchAll(/"(\w+)"/g)].map((m) => m[1]);
// A call that takes a palette key, and which argument holds it.
const CALLS = [
  [/\bUI\.Tint\(/g, 2], [/\bthemed\(/g, 2],
  [/\bUI\.Color\(/g, 0], [/\bUI\.Hex\(/g, 0], [/\bColorText\(/g, 1], [/\bUI\.PaintShape\(/g, 1],
  [/\bUI\.StripColor\(/g, 0], [/\bstripColor\(/g, 0], [/\brgba\(/g, 0], [/\bhexOf\(/g, 0], [/\bcolorOf\(/g, 0],
];
// Tables that hold palette keys, and the fields that are keys.
const TABLES = [
  ['CRT_Core/UI/Panel.lua', /\nlocal DIVIDER = \{[\s\S]*?\n\}/, /\bkey = "(\w+)"/g],
  ['CRT_Core/UI/Window.lua', /\nlocal STRIP = \{[\s\S]*?\n\}/, /\b(?:top|bottom|line|title|note|bg|edge|text) = "(\w+)"/g],
  ['CRT_Core/UI/ScrollBar.lua', /\nUI\.SCROLL_BAR_LOOKS = \{[\s\S]*?\n\}/, /\b(?:rail|face|fill|border|faceEdge|shine|tick) = "(\w+)"/g],
  ['CRT_Modules/Alerts/Colors.lua', /\nlocal ACCENT = "\w+"/, /ACCENT = "(\w+)"/g],
];
const OLD_ANY = Object.keys(OLD).join('|');
const OLD_DISTINCT = Object.keys(OLD).filter((k) => !['edge', 'tick', 'note'].includes(k)).join('|');
let sites = 0;
const bad = [], old = [];
for (const file of files) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const src = lines.map(code).join('\n');
  for (const [re, at] of CALLS) {
    for (const m of src.matchAll(re)) {
      if (/[\w.:]$/.test(src.slice(0, m.index)) && !/UI\.$|CRT\.UI\.$/.test(src.slice(0, m.index))) continue; // another name ending the same
      if (/function\s+(?:[\w.:]+\s*)?$/.test(src.slice(Math.max(0, m.index - 40), m.index)) || /function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue; // its definition
      const line = src.slice(0, m.index).split('\n').length;
      for (const w of words(args(src, m.index + m[0].length - 1)[at])) {
        if (/^Set[A-Z]/.test(w)) continue; // a setter name, not a key
        sites++;
        if (!keySet.has(w)) bad.push(rel + ':' + line + ': "' + w + '"');
      }
    }
  }
  for (const m of src.matchAll(/\bPALETTE(?:\.(\w+)|\[\s*"(\w+)"\s*\])/g)) {
    sites++;
    const w = m[1] || m[2];
    if (!keySet.has(w)) bad.push(rel + ':' + (src.slice(0, m.index).split('\n').length) + ': PALETTE.' + w);
  }
  lines.forEach((l, i) => {
    const c = code(l);
    if (/\bMOCHA\b/.test(l)) old.push(rel + ':' + (i + 1) + ': ' + l.trim());
    else if (new RegExp('["\'](' + OLD_DISTINCT + ')["\']').test(c)) old.push(rel + ':' + (i + 1) + ': ' + l.trim());
    else if (new RegExp('\\bPALETTE(\\.(' + OLD_ANY + ')\\b|\\[\\s*"(' + OLD_ANY + ')"\\s*\\])').test(c)) old.push(rel + ':' + (i + 1) + ': ' + l.trim());
  });
}
for (const [rel, block, field] of TABLES) {
  const m = fs.readFileSync(path.join(root, rel), 'utf8').match(block);
  check(m !== null, rel + ': the key table is where the test looks');
  for (const f of (m ? m[0].matchAll(field) : [])) {
    sites++;
    if (!keySet.has(f[1])) bad.push(rel + ': "' + f[1] + '" in its key table');
  }
}
check(sites > 150, 'the scan found the call sites (' + sites + ')');
check(bad.length === 0, 'every palette key a call site names is in CRT.THEME_KEYS:\n  ' + bad.join('\n  '));
check(old.length === 0, 'no old key name or CRT.MOCHA in ' + DIRS.join(', ') + ':\n  ' + old.join('\n  '));
if (bad.length === 0 && old.length === 0) console.log('ok palette: ' + sites + ' key uses, all in CRT.THEME_KEYS, no old names');

console.log(passes + ' passed, ' + fails + ' failed');
if (fails > 0) process.exit(1);
