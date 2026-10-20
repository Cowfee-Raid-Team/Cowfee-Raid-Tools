// Lua 5.1 syntax check for addon files, since the WoW client is the only real Lua runtime here.
// Usage: NODE_PATH=<folder with node_modules/luaparse> node lua-syntax-check.cjs <addon folder>
// In the repository it is CRT_Dev/Tests/lua-syntax-check.cjs, run by CRT_Dev/Tests/test.sh (npm install in
// CRT_Dev/Tests/ once).
// Catches syntax errors only. Wrong API names and runtime errors still need the game.
const luaparse = require('luaparse');
const fs = require('fs');
const path = require('path');

let bad = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    // other checkouts (.claude/worktrees), Git, packages and the test fixtures (CRT_Dev/Tests) are not the
    // addon; CRT_Dev/Dev is in the .toc, so it is checked
    if (entry.isDirectory()) {
      const rel = path.relative(process.argv[2], p).split(path.sep).join('/');
      if (!['.claude', '.git', 'node_modules', '.release'].includes(entry.name) && rel !== 'CRT_Dev/Tests') walk(p);
      continue;
    }
    if (!p.endsWith('.lua')) continue;
    try {
      luaparse.parse(fs.readFileSync(p, 'utf8'), { luaVersion: '5.1' });
      console.log('OK  ', path.relative(process.argv[2], p));
    } catch (e) {
      bad++;
      console.log('FAIL', p, e.message);
    }
  }
}

if (!process.argv[2]) { console.error('usage: node lua-syntax-check.cjs <addon folder>'); process.exit(2); }
walk(process.argv[2]);
process.exit(bad ? 1 : 0);
