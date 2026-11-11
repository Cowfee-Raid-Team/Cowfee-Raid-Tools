// One paragraph per option (the crt-ui-elements catalog's Help row): a tooltip that explains several options gives
// each its own paragraph, the option's name first in the heading colour, through the list form UI.AddTooltipText
// draws ({ "Intro.", { "Role blocks", "tanks first..." }, ... }, CRT_Core/UI/Panel.lua). This lint flags a plain
// string in CRT_Core or CRT_Modules that still packs several options into one text: two or more "Name: " heads at
// sentence starts (the text's start, after a full stop, ! or ?, or after a line break). Literals joined with ..
// count as one text, and colour codes are left out first.
// It can't tell a tooltip from a chat line or a sentence that happens to start "Note: ", so ALLOW lists the texts
// that are fine as they are: [file, a piece of the text, the reason].
// Usage: node run_help_options.js <addon folder>
const fs = require('fs');
const path = require('path');

const ALLOW = [
  // chat diagnostics, one line of settings each, never a tooltip
  ['CRT_Modules/Debuffs/Panel.lua', 'Settings: size %d', 'a /crt diagnostics line in chat'],
  ['CRT_Modules/Debuffs/Panel.lua', 'Look: swipe %s', 'a /crt diagnostics line in chat'],
  // one subject: the Mech Alerts list, explained in order ("Alerts are saved per difficulty: ... On the left: ..."),
  // with no options to pick between
  ['CRT_Modules/Notes/Reminders.lua', 'Alerts are saved per difficulty: Normal/Heroic', 'sentences about one list, not options'],
  // a sample of the ability timeline's text format, one "Key: value" line each, as it is typed
  ['CRT_Modules/Timeline/ReferencePage.lua', 'One line per thing:', 'a format sample, typed as shown'],
];

const BS = String.fromCharCode(92);

// every string text in a Lua source, with adjacent literals joined by .. as one: [{ line, text }]
function texts(src) {
  const out = [];
  let i = 0, cur = null, lastEnd = -1;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  while (i < src.length) {
    const c = src[i];
    if (src.startsWith('--', i)) {
      const long = src.slice(i + 2).match(/^\[(=*)\[/);
      const e = long ? src.indexOf(']' + long[1] + ']', i) : src.indexOf('\n', i);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === BS ? 2 : 1;
      const raw = src.slice(i + 1, j);
      const between = lastEnd >= 0 ? src.slice(lastEnd, i) : null;
      if (cur && between !== null && /^\s*\.\.\s*$/.test(between)) cur.text += raw;
      else { flush(); cur = { line: src.slice(0, i).split('\n').length, text: raw }; }
      i = j + 1;
      lastEnd = i;
      continue;
    }
    i++;
  }
  flush();
  return out;
}

// the option heads in a text: "Name: " at the start, after . ! ? or a line break
function heads(raw) {
  const t = raw.split(BS + 'n').join('\n').replace(/\|c[0-9a-fA-F]{8}/g, '').split('|r').join('').split(BS + '"').join('"');
  const found = [];
  const re = /(?:^|[.!?]["')]?\s+|\n\s*)([A-Z][\w'+/-]*(?: [\w'+/-]+){0,4}): (?=[\w"'(%])/g;
  for (const m of t.matchAll(re)) found.push(m[1]);
  return found;
}

function lint(sources, allow) {
  const bad = [];
  for (const rel of Object.keys(sources)) {
    for (const { line, text } of texts(sources[rel])) {
      const h = heads(text);
      if (h.length < 2) continue;
      if (allow.some(([f, piece]) => f === rel && text.includes(piece))) continue;
      bad.push(rel + ':' + line + ': ' + h.length + ' option heads (' + h.join(', ') + ') in one text: ' + text.slice(0, 120));
    }
  }
  return bad;
}

// the lint on its own fixture first
{
  const fixture = {
    'A.lua': [
      'local TEXT = {',
      '    sortHelp = "Sort grid rearranges the grid.\\n\\nRole blocks: tanks first. Spread duplicates: apart.",',
      '    joined = "Timer: the countdown. " ..',
      '        "Swipe: a dark shade.",',
      '    list = { "Intro.", { "Role blocks", "tanks first." }, { "Spread duplicates", "apart." } },',
      '    one = "Note: only one head here. It has a time like P1 0:30 and a ratio 1:2.",',
      '    colour = "|cffffd100Food:|r any food. |cffffd100Flask:|r any flask.",',
      '    allowed = "Settings: size %d. Look: %s",',
      '}',
    ].join('\n'),
  };
  const got = lint(fixture, [['A.lua', 'Settings: size', 'test']]).map((b) => b.split(': ')[0]);
  const want = ['A.lua:2', 'A.lua:3', 'A.lua:7'];
  const missing = want.filter((w) => !got.includes(w));
  const extra = got.filter((g) => !want.includes(g));
  if (missing.length || extra.length) {
    console.log('FAIL the lint on its own fixture: missing ' + JSON.stringify(missing) + ', extra ' + JSON.stringify(extra));
    process.exit(1);
  }
  console.log('ok the lint finds several option heads in one text, joined literals and colour codes included');
}

const root = process.argv[2];
const sources = {};
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.lua')) sources[path.relative(root, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  }
};
for (const d of ['CRT_Core', 'CRT_Modules']) walk(path.join(root, d));
const n = Object.keys(sources).length;
const bad = lint(sources, ALLOW);
if (n < 50) bad.push('only ' + n + ' Lua files found: is the scan looking in the right folder?');
// every allow entry still matches something, so the list doesn't keep stale entries
for (const [f, piece] of ALLOW) {
  if (!sources[f] || !sources[f].includes(piece)) bad.push('ALLOW entry no longer matches: ' + f + ' "' + piece + '"');
}
if (bad.length) {
  console.log('FAIL a text with several options in one block (use the list form, CRT_Core/UI/Panel.lua UI.AddTooltipText):');
  for (const b of bad) console.log(b);
  process.exit(1);
}
console.log(n + ' Lua files, no text packs several options into one block');
console.log('all passed');
