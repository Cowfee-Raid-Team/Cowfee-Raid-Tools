// Draws CRT's own art for CRT_Media/Media and writes it as TGA files. Node only, no packages.
//
//     Skull.tga   the Timeline's death skull (CRT_Modules/Timeline/View.lua and Lanes.lua): a white skull with
//                 eye sockets, a nose and a jaw with tooth gaps, on clear alpha, centred inside the round mask
//     DiscLarge.tga  a filled white circle, 254 px across: the Timeline's death ring, its black disc, the face mask
//                 and the reference rows' type dots (View.lua), smooth at every UI scale (Disc.tga is only 32 px)
//
// Each shape is a set of simple geometric parts (circles, ellipses, rounded boxes, a triangle) tested per point.
// Every pixel takes SUPER x SUPER samples and its alpha is the share inside the shape, so the edges are smooth at
// any size the game draws it. The colour is white everywhere: the game tints it (Texture:SetVertexColor).
// 32-bit uncompressed TGA, top-left origin, the same layout as the Ring and Disc files beside it.
//
// Run from anywhere: node CRT_Dev/Tools/make-media.mjs [out folder]   (defaults to CRT_Media/Media)
// The output is the same bytes every run (plain + - * / only, no ** or Math.pow, so every Node version agrees);
// the view test (CRT_Dev/Tests/run_timeline_view.js) checks the committed files against a fresh run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const SUPER = 8; // samples per pixel along each side

// Writes a white SIZE x SIZE TGA whose alpha is the coverage of inside(x, y), x and y in pixels from the top left.
function render(inside) {
  const out = Buffer.alloc(18 + SIZE * SIZE * 4);
  out[2] = 2; // uncompressed true-colour
  out.writeUInt16LE(SIZE, 12);
  out.writeUInt16LE(SIZE, 14);
  out[16] = 32;
  out[17] = 0x28; // 8 alpha bits, top-left origin
  const total = SUPER * SUPER;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPER; sy++) {
        const y = py + (sy + 0.5) / SUPER;
        for (let sx = 0; sx < SUPER; sx++) {
          if (inside(px + (sx + 0.5) / SUPER, y)) hits++;
        }
      }
      const o = 18 + (py * SIZE + px) * 4;
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
      out[o + 3] = Math.round((hits / total) * 255);
    }
  }
  return out;
}

// The parts, each a point test.
function circle(cx, cy, r) {
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
}
function ellipse(cx, cy, rx, ry) {
  return (x, y) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };
}
function roundBox(left, top, right, bottom, r) {
  return (x, y) => {
    if (x < left || x > right || y < top || y > bottom) return false;
    const dx = Math.max(left + r - x, 0, x - (right - r));
    const dy = Math.max(top + r - y, 0, y - (bottom - r));
    return dx * dx + dy * dy <= r * r;
  };
}
function triangle(ax, ay, bx, by, cx, cy) {
  const side = (x1, y1, x2, y2, x, y) => (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
  return (x, y) => {
    const d1 = side(ax, ay, bx, by, x, y);
    const d2 = side(bx, by, cx, cy, x, y);
    const d3 = side(cx, cy, ax, ay, x, y);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
}

// The skull, drawn in a 256 box and scaled up by SKULL_SCALE about the centre: a round cranium over a narrower jaw,
// about 35 to 221 high, so every corner stays well inside the circle the Timeline masks it with. Cut out: two eye
// sockets, a nose pointing up, and two wide gaps between three teeth that run out through the bottom of the jaw, wide
// enough to read with the skull about 20 px on screen.
const SKULL_SCALE = 1.1;
function skull() {
  const head = [circle(128, 114, 70), roundBox(84, 150, 172, 212, 14)];
  const holes = [
    ellipse(98, 120, 21, 23),
    ellipse(158, 120, 21, 23),
    triangle(128, 142, 115, 168, 141, 168),
    roundBox(104, 184, 118, 220, 4),
    roundBox(138, 184, 152, 220, 4),
  ];
  return (px, py) => {
    const x = 128 + (px - 128) / SKULL_SCALE;
    const y = 128 + (py - 128) / SKULL_SCALE;
    return head.some((part) => part(x, y)) && !holes.some((part) => part(x, y));
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, '..', '..', 'CRT_Media', 'Media');
fs.mkdirSync(outDir, { recursive: true });
const files = { 'Skull.tga': skull(), 'DiscLarge.tga': circle(128, 128, 127) };
for (const [name, inside] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), render(inside));
  console.log('wrote ' + path.join(outDir, name));
}
