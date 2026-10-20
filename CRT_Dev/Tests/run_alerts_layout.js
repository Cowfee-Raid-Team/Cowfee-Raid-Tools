// Alerts stage 2a final fixes: the four alert areas' default places don't overlap each other, drag boxes
// included. Reads each file's DEFAULT_POSITION and lays out a rough box from the area defaults in Core.lua
// (a full cap of widgets growing their default way, and the drag box on the other side).
// Usage: node run_alerts_layout.js Alerts/Areas.lua Alerts/Icons.lua Alerts/Texts.lua Alerts/Bars.lua Alerts/Circles.lua Notes/Alert.lua
const fs = require('fs');
const [areasF, iconsF, textsF, barsF, circlesF, alertF] = process.argv.slice(2);
if (!alertF) { console.error('usage: node run_alerts_layout.js Areas Icons Texts Bars Circles NoteAlert'); process.exit(2); }

function num(src, name) {
  const m = src.match(new RegExp('local ' + name + '\\s*=\\s*(-?\\d+)'));
  if (!m) throw new Error('no ' + name);
  return Number(m[1]);
}
function pos(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/local DEFAULT_POSITION\s*=\s*\{[^}]*x\s*=\s*(-?\d+)\s*,\s*y\s*=\s*(-?\d+)/);
  if (!m) throw new Error('no DEFAULT_POSITION in ' + file);
  return { x: Number(m[1]), y: Number(m[2]) };
}
const areasSrc = fs.readFileSync(areasF, 'utf8');
const GAP = num(areasSrc, 'GAP'), HANDLE_H = num(areasSrc, 'HANDLE_HEIGHT'), HANDLE_W = num(areasSrc, 'HANDLE_MIN_WIDTH');
const TEXT_W = 160; // a short alert text beside an icon or under a circle, roughly

// The widgets' box from the first widget (w x h, centered on the position) and how many follow it, plus
// the drag box above the first widget (every default grows down or right).
function box(name, p, w, h, cap, grow, handleW) {
  const left = p.x - w / 2, top = p.y + h / 2;
  const b = { name, left, right: left + w, top, bottom: top - h };
  if (grow === 'down') b.bottom = top - (cap * h + (cap - 1) * GAP);
  if (grow === 'right') b.right = left + cap * w + (cap - 1) * GAP;
  const hw = Math.max(HANDLE_W, handleW || 0);
  b.left = Math.min(b.left, p.x - hw / 2);
  b.right = Math.max(b.right, p.x + hw / 2);
  b.top = top + 2 + HANDLE_H;
  return b;
}
const boxes = [
  // icons: 44 px, the text beside it; cap 5 down
  box('icons', pos(iconsF), 44 + 6 + TEXT_W + 4, 44, 5, 'down'),
  // texts: 36 px font, a line like "Stack on the boss" about 320 wide; cap 3 down
  box('texts', pos(textsF), 320, 40, 3, 'down'),
  // the Next spell alert (Notes/Alert.lua): up to ~400 wide, two lines of text, its drag box above
  box('next spell alert', pos(alertF), 400, 56, 1, 'down', 300),
  // bars: 240 x 20, cap 5 down
  box('bars', pos(barsF), 240, 20, 5, 'down', 240),
  // circles: 64 px ring with its text under it, cap 3 right; centred on the character by default (0, -40)
  box('circles', pos(circlesF), Math.max(64, TEXT_W * 0.6), 64 + 2 + 18, 3, 'right'),
];

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;
const show = (b) => `${b.name} x ${b.left}..${b.right} y ${b.bottom}..${b.top}`;
check('areas: default places and drag boxes do not overlap', () => {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlap(boxes[i], boxes[j])) throw new Error(show(boxes[i]) + ' overlaps ' + show(boxes[j]));
    }
  }
});
check('areas: defaults stay on a 16:9 screen (1366 x 768 UI units)', () => {
  for (const b of boxes) {
    if (b.left < -683 || b.right > 683 || b.bottom < -384 || b.top > 384) throw new Error(show(b));
  }
});
if (failed) { console.log(failed + ' failed'); process.exit(1); }
