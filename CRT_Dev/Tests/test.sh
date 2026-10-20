#!/usr/bin/env bash
# Runs the suite and the Lua syntax check, then prints one verdict. Exit 0 only when all pass.
#   bash CRT_Dev/Tests/test.sh [addon folder]             the whole suite (about two minutes); output in CRT_Dev/Tests/last-run.txt
#   bash CRT_Dev/Tests/test.sh "<group>" [addon folder]   one group plus the syntax check, in seconds, for work in progress;
#                                                          output in CRT_Dev/Tests/last-group.txt. The name is the g "..."
#                                                          on the group's line in run_all.sh (the Timeline groups are store,
#                                                          record, journal, reference, probe, lanes, view and page)
# The factory's builders run one group while they work and the whole suite once before reporting; so can you.
# First run: cd CRT_Dev/Tests && npm install.
here="$(cd "$(dirname "$0")" && pwd)"
root=""
only=""
for a in "$@"; do
    if [ -d "$a" ]; then root="$a"; else only="$a"; fi
done
root="${root:-$(cd "$here/../.." && (pwd -W 2>/dev/null || pwd))}"
out="$here/last-run.txt"
[ -n "$only" ] && out="$here/last-group.txt"

# node_modules is not in Git, so a fresh worktree borrows the main checkout's (git's common dir is
# <main checkout>/.git). A main checkout from before the CRT_Dev move still has it in Tests/.
mods="$here/node_modules"
if [ ! -d "$mods/fengari" ]; then
    common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
    if [ -n "$common" ]; then
        main="$(dirname "$common")"
        mods="$main/CRT_Dev/Tests/node_modules"
        [ -d "$mods/fengari" ] || mods="$main/Tests/node_modules"
    fi
fi
if [ ! -d "$mods/fengari" ]; then
    echo "Tests: run 'npm install' in CRT_Dev/Tests/ of the main checkout first."
    exit 2
fi
export NODE_PATH="$mods"

ONLY="$only" bash "$here/run_all.sh" "$root" > "$out" 2>&1
groups=$(grep -ac '^== ' "$out") # -a: a harness may print NUL bytes; without it grep reads the log as binary and misses lines
if [ -n "$only" ] && [ "$groups" = "0" ]; then
    echo "No test group named \"$only\". The groups are:"
    { grep -oE 'g "[^"$]+"' "$here/run_all.sh" | sed 's/^g "//; s/"$//'; echo "store, record, journal, reference, probe, lanes, view, page (Timeline)"; } | paste -sd '|' | sed 's/|/, /g'
    exit 2
fi
passed=$(grep -acE '^(ok|PASS) ' "$out")
# a group fails on a FAIL line, a Lua error, a non-zero exit, or an "N failed" summary with N > 0
fails=$(grep -anE '^FAIL |LUA ERROR|^exit [1-9]|^[0-9]+ passed, [1-9][0-9]* failed|^[1-9][0-9]* failed' "$out")

syntax=$(cd "$root" && node "$here/lua-syntax-check.cjs" . 2>&1 | grep -v '^OK')

label="Tests"
[ -n "$only" ] && label="Tests (group \"$only\")"
echo "$label: $groups groups, $passed checks passed."
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
echo "RESULT: FAIL (full output in $out)"
exit 1
