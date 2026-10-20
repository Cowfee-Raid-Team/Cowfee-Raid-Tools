// Lua 5.1 syntax check for addon files, since the WoW client is the only real Lua runtime here.
// Usage: NODE_PATH=<folder with node_modules/luaparse> node lua-syntax-check.cjs <addon folder>
// In the repository it is Tests/lua-syntax-check.cjs, run by Tests/test.sh (npm install in Tests/ once).
// Catches syntax errors only. Wrong API names and runtime errors still need the game.
const luaparse = require('luaparse');
const fs = require('fs');
const path = require('path');

let bad = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    // other checkouts (.claude/worktrees), Git, packages and the test fixtures are not the addon
    if (entry.isDirectory()) { if (!['.claude', '.git', 'node_modules', 'Tests', '.release'].includes(entry.name)) walk(p); continue; }
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
