// Text buttons size from their labels (UX rule 7, job 20261125-ux-text-fit): a lint over CRT_Core and CRT_Modules that
// flags a text button or tab given a fixed width, a number or a layout constant (SetSize(120, 22), SetWidth(TAB_W),
// SetSize(L.tabW, 26)), instead of UI.FitButton, UI.PanelButton, UI:FitTab / UI:RegisterTab or a width worked out
// from its label. A text button here is a frame the file makes as a Button (CreateFrame("Button", ...) or a call to a
// function named ...Button / ...button) that it also gives a label (SetText, or a .text font string). It also flags a
// local button helper that takes a width (local function makeButton(parent, label, width)): its callers would pass
// fixed widths. A fixed width on purpose says so on its own line with its reason, in a comment: "-- fixed width: why".
// Planted mistakes check the lint finds them, and that the marker and a width from the label pass.
// Usage: node run_textfit_lint.js <addon folder>
const fs = require('fs');
const path = require('path');
const root = process.argv[2];

// the marker a deliberate fixed width carries on its line
const MARK = /--\s*fixed width:\s*\S/;

function lint(file, src) {
  const out = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const code = lines.map(l => l.replace(/--.*$/, ''));
  const made = new Set();
  const labelled = new Set();
  for (const l of code) {
    const m = l.match(/(?:local\s+)?([\w.]+)\s*=\s*(?:[\w.:]*[bB]utton\s*\(|CreateFrame\(\s*"Button")/);
    if (m) made.add(m[1]);
    for (const t of l.matchAll(/([\w.]+?)(?:\.text)?:SetText\(/g)) labelled.add(t[1]);
    for (const t of l.matchAll(/([\w.]+)\.text\s*=\s*[\w.]+:CreateFontString/g)) labelled.add(t[1]);
    for (const t of l.matchAll(/([\w.]+):SetFontString\(/g)) labelled.add(t[1]);
  }
  // a width that is a number or a constant: 120, TAB_W, L.tabW, L.TEST_W (not a call, sum or label measure)
  const fixed = /^\s*(\d+(\.\d+)?|[A-Z][A-Z0-9_]*|L\.\w+|LAYOUT\.\w+)\s*$/;
  code.forEach((l, i) => {
    if (MARK.test(lines[i])) return;
    // a button helper that takes a width
    const h = l.match(/^\s*local\s+function\s+\w*[bB]utton\s*\(([^)]*)\)/);
    if (h && /\b(width|w)\b/.test(h[1])) {
      out.push(file + ':' + (i + 1) + ': ' + lines[i].trim() + '   (a button helper that takes a width)');
      return;
    }
    const m = l.match(/([\w.]+):Set(Size|Width)\(([^,)]+)/);
    if (!m) return;
    const id = m[1];
    if (!made.has(id) || !labelled.has(id)) return;
    if (!fixed.test(m[3])) return;
    out.push(file + ':' + (i + 1) + ': ' + lines[i].trim());
  });
  return out;
}

// planted mistakes: each must be found once; a width from the label, and a marked fixed width, must not be
const planted = [
  lint('planted.lua', 'local b = CreateFrame("Button", nil, p, "UIPanelButtonTemplate")\nb:SetText("Go")\nb:SetSize(120, 22)\n'),
  lint('planted.lua', 'local t = CreateFrame("Button", nil, p, "BackdropTemplate")\nt.text = t:CreateFontString(nil, "OVERLAY")\nt:SetSize(TAB_W, 26)\n'),
  lint('planted.lua', 'local function makeButton(parent, label, width, height)\n    local b = CreateFrame("Button", nil, parent)\nend\n'),
];
const fine = lint('planted.lua', 'local b = makeButton(p, "Go")\nb:SetText("Go")\nb:SetWidth(UI.PanelButtonWidth(w))\n'
  + 'local s = CreateFrame("Button", nil, p)\ns:SetText("x")\ns:SetSize(18, 18) -- fixed width: one character on a square\n');
let bad = [];
if (planted.some(r => r.length !== 1) || fine.length !== 0) {
  console.log('FAIL the lint misses a planted fixed width, or flags a width from the label or a marked one');
  process.exit(1);
}
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.lua')) continue;
    const rel = path.relative(root, p).replace(/\\/g, '/');
    bad = bad.concat(lint(rel, fs.readFileSync(p, 'utf8')));
  }
}
walk(path.join(root, 'CRT_Core'));
walk(path.join(root, 'CRT_Modules'));
if (bad.length) {
  console.log('FAIL a text button with a fixed width (size it from its label: UI.FitButton, UI.PanelButton or UI:FitTab;');
  console.log('a deliberate one says "-- fixed width: why" on its line):');
  for (const b of bad) console.log('  ' + b);
  process.exit(1);
}
console.log('all passed');
