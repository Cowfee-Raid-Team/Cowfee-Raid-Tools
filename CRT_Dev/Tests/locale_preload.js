// The translation table for every harness, as the .toc gives it to the game. In the game CRT_Core/Locale.lua loads
// before every file with a TEXT table, so CRT.Locale always exists when a file wraps its TEXT table in it. A harness
// builds its own CRT table and loads only the files it tests, so this does what the .toc does: runner_lib.sh's node
// wrapper preloads this file (node -r), and every Lua chunk a harness then loads that starts like an addon file
// ("local ADDON, CRT = ..." on its first line) first loads the real Locale.lua into its CRT, when that CRT is a table
// with no CRT.Locale yet. A harness that loads Locale.lua itself (run_locale.js) keeps its own; Locale.lua is never
// given to itself. The added code sits on the chunk's first line in a do block of its own, so line numbers in errors,
// the file's locals and upvalues stay as written. No CRT.LOCALE overrides are set, so every TEXT table reads English.
// It patches fengari's lua_load before lua.js copies it, so the harness's loads (luaL_loadbuffer, luaL_loadstring,
// Lua's load, loadstring and dofile) all pass through it.
const fs = require('fs');
const path = require('path');

const lapi = require('fengari/src/lapi.js');
const { to_luastring } = require('fengari/src/fengaricore.js');

const LOCALE_FILE = path.join(__dirname, '..', '..', 'CRT_Core', 'Locale.lua');
const HEADER = /^local[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*,[ \t]*CRT[ \t]*=[ \t]*\.\.\./;
const SELF = 'function CRT.Locale(';

let prefix = null;
function getPrefix() {
  if (prefix !== null) return prefix;
  const src = fs.readFileSync(LOCALE_FILE, 'utf8');
  // Locale.lua as one quoted Lua string, so the whole prefix stays on the chunk's first line
  const quoted = '"' + src.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n') + '"';
  // load Locale.lua into the chunk's CRT (its second argument) when that has none; its locals end with the do block,
  // and a CRT that has a Locale reads no global but type (a harness may load a file with almost no globals)
  prefix = to_luastring('do local _, crt = ... if type(crt) == "table" and crt.Locale == nil then '
    + 'assert(load(' + quoted + ', "CRT_Core/Locale.lua"))(...) end end ');
  return prefix;
}

const origLoad = lapi.lua_load;
lapi.lua_load = function (L, reader, data, chunkname, mode) {
  // read the whole chunk first, so its first line and its body can be looked at
  const parts = [];
  let total = 0;
  for (;;) {
    const piece = reader(L, data);
    if (piece === null || piece === undefined || piece.length === 0) break;
    const bytes = typeof piece === 'string' ? to_luastring(piece) : piece;
    parts.push(bytes);
    total += bytes.length;
  }
  let buf = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { buf.set(p, at); at += p.length; }
  if (buf.length > 0 && buf[0] !== 0x1b) {
    const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 200))).toString('latin1');
    if (HEADER.test(head) && !Buffer.from(buf).toString('latin1').includes(SELF) && fs.existsSync(LOCALE_FILE)) {
      const pre = getPrefix();
      const joined = new Uint8Array(pre.length + buf.length);
      joined.set(pre, 0);
      joined.set(buf, pre.length);
      buf = joined;
    }
  }
  let done = false;
  return origLoad(L, () => { if (done) return null; done = true; return buf; }, null, chunkname, mode);
};
