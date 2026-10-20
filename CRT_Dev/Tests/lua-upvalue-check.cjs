#!/usr/bin/env node
// Lua 5.1 (the WoW client) allows at most 60 upvalues per function: outer local variables a function
// uses, counting those its nested functions use from further out, since they pass through it. Newer
// Lua (fengari, used by the test harnesses) allows 255, so the harnesses never catch this. This script
// parses every .lua file under a folder with luaparse and lists any function over the limit.
//
// Usage: NODE_PATH=<folder with luaparse> node lua-upvalue-check.cjs <addon folder> [limit]
// Prints "OK <file>" for each clean file and "OVER <file>:<line> <count> upvalues" otherwise; exits 1
// when any function is over. The default limit is 60; a warning line is printed from 50 up.

const fs = require('fs');
const path = require('path');
const luaparse = require('luaparse');

const root = process.argv[2] || '.';
const LIMIT = Number(process.argv[3] || 60);
const WARN = Math.min(50, LIMIT);

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // Tests/ holds old copies kept as fixtures, not addon code
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'Tests') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (e.name.endsWith('.lua')) out.push(p);
  }
  return out;
}

// A scope is { vars: Set, fn: functionRecord }. A function record collects the outer locals it needs.
function check(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = luaparse.parse(src, { luaVersion: '5.1', locations: true, comments: false });
  const results = [];
  const chunk = { line: 1, ups: new Set(), parent: null, depthVars: [] };

  // scopes: array of { vars: Set<string>, fn }
  function resolve(scopes, name, fn) {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].vars.has(name)) {
        const owner = scopes[i].fn;
        // every function from fn up to (not including) owner needs it as an upvalue
        let f = fn;
        while (f && f !== owner) {
          f.ups.add(owner.id + ':' + name + ':' + i);
          f = f.parent;
        }
        return;
      }
    }
    // a global: no upvalue
  }

  let nextId = 1;
  chunk.id = 0;

  function walk(node, scopes, fn) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, scopes, fn)); return; }
    switch (node.type) {
      case 'LocalStatement': {
        node.init.forEach((n) => walk(n, scopes, fn));
        node.variables.forEach((v) => scopes[scopes.length - 1].vars.add(v.name));
        return;
      }
      case 'FunctionDeclaration': {
        // local function f: f is visible inside its own body
        if (node.isLocal && node.identifier && node.identifier.type === 'Identifier') {
          scopes[scopes.length - 1].vars.add(node.identifier.name);
        } else if (node.identifier) {
          walk(node.identifier, scopes, fn);
        }
        const rec = { id: nextId++, line: node.loc.start.line, ups: new Set(), parent: fn };
        const inner = scopes.concat([{ vars: new Set(node.parameters.filter((p) => p.type === 'Identifier').map((p) => p.name)), fn: rec }]);
        const isMethod = node.identifier && node.identifier.type === 'MemberExpression' && node.identifier.indexer === ':';
        if (isMethod) inner[inner.length - 1].vars.add('self');
        walk(node.body, inner, rec);
        results.push(rec);
        return;
      }
      case 'Identifier':
        resolve(scopes, node.name, fn);
        return;
      case 'DoStatement':
      case 'WhileStatement':
      case 'RepeatStatement': {
        if (node.condition && node.type === 'WhileStatement') walk(node.condition, scopes, fn);
        const inner = scopes.concat([{ vars: new Set(), fn }]);
        walk(node.body, inner, fn);
        if (node.type === 'RepeatStatement') walk(node.condition, inner, fn);
        return;
      }
      case 'IfStatement':
        node.clauses.forEach((c) => {
          if (c.condition) walk(c.condition, scopes, fn);
          walk(c.body, scopes.concat([{ vars: new Set(), fn }]), fn);
        });
        return;
      case 'ForNumericStatement': {
        walk(node.start, scopes, fn); walk(node.end, scopes, fn); walk(node.step, scopes, fn);
        walk(node.body, scopes.concat([{ vars: new Set([node.variable.name]), fn }]), fn);
        return;
      }
      case 'ForGenericStatement': {
        walk(node.iterators, scopes, fn);
        walk(node.body, scopes.concat([{ vars: new Set(node.variables.map((v) => v.name)), fn }]), fn);
        return;
      }
      case 'MemberExpression':
        walk(node.base, scopes, fn);
        return; // the member name is not a variable
      case 'TableKeyString':
        walk(node.value, scopes, fn);
        return;
      default:
        for (const k of Object.keys(node)) {
          if (k === 'loc' || k === 'range') continue;
          const v = node[k];
          if (v && typeof v === 'object') walk(v, scopes, fn);
        }
    }
  }

  walk(ast.body, [{ vars: new Set(), fn: chunk }], chunk);
  return results;
}

let bad = 0;
for (const f of files(root)) {
  let res;
  try { res = check(f); } catch (e) { console.log('SKIP ' + f + ' (' + e.message + ')'); continue; }
  const rel = path.relative(root, f);
  const over = res.filter((r) => r.ups.size > LIMIT);
  const warn = res.filter((r) => r.ups.size >= WARN && r.ups.size <= LIMIT);
  for (const r of over) { console.log('OVER ' + rel + ':' + r.line + ' ' + r.ups.size + ' upvalues (limit ' + LIMIT + ')' + (process.env.NAMES ? ': ' + [...r.ups].map((u) => u.split(':')[1]).sort().join(' ') : '')); bad++; }
  for (const r of warn) console.log('NEAR ' + rel + ':' + r.line + ' ' + r.ups.size + ' upvalues');
  if (!over.length && !warn.length) console.log('OK ' + rel);
}
process.exit(bad ? 1 : 0);
