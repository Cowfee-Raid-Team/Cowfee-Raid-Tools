// Text buttons size from their labels (UX rule 7, job 20261125-ux-text-fit): a lint over CRT_Core and CRT_Modules that
// flags a text button or tab given a fixed width, a number or a layout constant (SetSize(120, 22), SetWidth(TAB_W),
// SetSize(L.tabW, 26)), instead of UI.FitButton, UI.PanelButton, UI:FitTab / UI:RegisterTab or a width worked out
// from its label. A text button here is a frame the file makes as a Button (CreateFrame("Button", ...) or a call to a
// function named ...Button / ...button) that it also gives a label (SetText, or a .text font string). The ones with a
// fixed width on purpose are in ALLOWED, each with its reason. Two planted mistakes check the lint finds them.
// Usage: node run_textfit_lint.js <addon folder>
const fs = require('fs');
const path = require('path');
const root = process.argv[2];

// file (from the addon folder) -> identifiers whose fixed width is deliberate, and why
const ALLOWED = {
  'CRT_Core/UI/Controls.lua': { 'b': "the spot picker's 10 px squares (UI.SpotPicker): no label, they name themselves in a tooltip" },
  'CRT_Modules/Consumables/Page.lua': { 'row': 'Icon order: a list row as wide as its column, its name inside it' },
  'CRT_Modules/LootMaster/Page.lua': { 'b': 'smallButton: an 18 px square with one character (move up / down)' },
  'CRT_Modules/Interrupts/Page.lua': { 'b': 'a colour swatch: no label (its name is the font string left of it)' },
  'CRT_Modules/Notes/Palette.lua': { 'b.remove': 'the x on a palette chip: one character on a fixed square' },
  'CRT_Modules/ReadyCheck/Window.lua': { 'h': "a column header, as wide as its table column (a grid cell)" },
  'CRT_Modules/Timeline/View.lua': { 'plus': 'the + chip: one character on a fixed square' },
};

function lint(file, src) {
  const out = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const code = lines.map(l => l.replace(/--.*$/, ''));
  const made = new Set();
  const labelled = new Set();
  for (const l of code) {
    let m = l.match(/(?:local\s+)?([\w.]+)\s*=\s*(?:[\w.:]*[bB]utton\s*\(|CreateFrame\(\s*"Button")/);
    if (m) made.add(m[1]);
    for (const t of l.matchAll(/([\w.]+?)(?:\.text)?:SetText\(/g)) labelled.add(t[1]);
    for (const t of l.matchAll(/([\w.]+)\.text\s*=\s*[\w.]+:CreateFontString/g)) labelled.add(t[1]);
    for (const t of l.matchAll(/([\w.]+):SetFontString\(/g)) labelled.add(t[1]);
  }
  // a width that is a number or a constant: 120, TAB_W, L.tabW, L.TEST_W (not a call, sum or label measure)
  const fixed = /^\s*(\d+(\.\d+)?|[A-Z][A-Z0-9_]*|L\.\w+|LAYOUT\.\w+)\s*$/;
  code.forEach((l, i) => {
    const m = l.match(/([\w.]+):Set(Size|Width)\(([^,)]+)/);
    if (!m) return;
    const id = m[1];
    if (!made.has(id) || !labelled.has(id)) return;
    if (!fixed.test(m[3])) return;
    const allow = ALLOWED[file] && ALLOWED[file][id];
    if (allow) return;
    out.push(file + ':' + (i + 1) + ': ' + lines[i].trim());
  });
  return out;
}

// planted mistakes: both must be found; a width from the label must not be
const planted = [
  lint('planted.lua', 'local b = CreateFrame("Button", nil, p, "UIPanelButtonTemplate")\nb:SetText("Go")\nb:SetSize(120, 22)\n'),
  lint('planted.lua', 'local t = CreateFrame("Button", nil, p, "BackdropTemplate")\nt.text = t:CreateFontString(nil, "OVERLAY")\nt:SetSize(TAB_W, 26)\n'),
];
const fine = lint('planted.lua', 'local b = makeButton(p, "Go")\nb:SetText("Go")\nb:SetWidth(UI.PanelButtonWidth(w))\n');
let bad = [];
if (planted.some(r => r.length !== 1) || fine.length !== 0) {
  console.log('FAIL the lint misses a planted fixed width, or flags a width from the label');
  process.exit(1);
}
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.lua')) continue;
    const rel = path.relative(root, p).replace(/\\/g, '/');
    bad = bad.concat(lint(rel, fs.readFileSync(p, 'utf8')));
  }
})(path.join(root, 'CRT_Core'));
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.lua')) continue;
    const rel = path.relative(root, p).replace(/\\/g, '/');
    bad = bad.concat(lint(rel, fs.readFileSync(p, 'utf8')));
  }
})(path.join(root, 'CRT_Modules'));
if (bad.length) {
  console.log('FAIL a text button with a fixed width (size it from its label: UI.FitButton, UI.PanelButton or UI:FitTab):');
  for (const b of bad) console.log('  ' + b);
  process.exit(1);
}
console.log('all passed');
