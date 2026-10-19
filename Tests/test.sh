#!/usr/bin/env bash
# Runs the whole suite and the Lua syntax check, then prints one verdict. Exit 0 only when all pass.
#   bash Tests/test.sh [addon folder]      the full output is kept in Tests/last-run.txt
# The factory's tester runs this; so can you. First run: cd Tests && npm install.
here="$(cd "$(dirname "$0")" && pwd)"
root="${1:-$(cd "$here/.." && (pwd -W 2>/dev/null || pwd))}"
out="$here/last-run.txt"

# node_modules is not in Git, so a fresh worktree borrows the main checkout's (git's common dir is
# <main checkout>/.git)
mods="$here/node_modules"
if [ ! -d "$mods/fengari" ]; then
    common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
    [ -n "$common" ] && mods="$(dirname "$common")/Tests/node_modules"
fi
if [ ! -d "$mods/fengari" ]; then
    echo "Tests: run 'npm install' in Tests/ of the main checkout first."
    exit 2
fi
export NODE_PATH="$mods"

bash "$here/run_all.sh" "$root" > "$out" 2>&1
groups=$(grep -c '^== ' "$out")
passed=$(grep -cE '^(ok|PASS) ' "$out")
# a group fails on a FAIL line, a Lua error, a non-zero exit, or an "N failed" summary with N > 0
fails=$(grep -nE '^FAIL |LUA ERROR|^exit [1-9]|^[0-9]+ passed, [1-9][0-9]* failed|^[1-9][0-9]* failed' "$out")

syntax=$(cd "$root" && node "$here/lua-syntax-check.cjs" . 2>&1 | grep -v '^OK')

echo "Tests: $groups groups, $passed checks passed."
if [ -n "$fails" ]; then
    echo "FAILED:"
    echo "$fails" | head -40
fi
if [ -n "$syntax" ]; then
    echo "SYNTAX:"
    echo "$syntax" | head -40
fi
if [ -z "$fails" ] && [ -z "$syntax" ]; then
    echo "RESULT: PASS"
    exit 0
fi
echo "RESULT: FAIL (full output in Tests/last-run.txt)"
exit 1
