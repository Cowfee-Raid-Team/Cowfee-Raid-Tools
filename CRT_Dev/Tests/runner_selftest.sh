#!/usr/bin/env bash
# Proves the runner fails the suite on a harness that exits non-zero or fails to load. Builds a throwaway suite in a temp
# folder (the real test.sh and runner_lib.sh, a stub run_all.sh, one good and one broken harness), runs test.sh on it and
# checks the verdict. No failing harness is left in the real suite. Prints "ok ..." / "FAIL ..." lines.
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$here/test.sh" "$here/runner_lib.sh" "$here/lua-syntax-check.cjs" "$tmp/"
cat > "$tmp/run_all.sh" <<'STUB'
cd "$(dirname "$0")"
. ./runner_lib.sh
g() { [ -z "$ONLY" ] || [ "$1" = "$ONLY" ] || return 1; CRT_GROUP="$1"; echo "== $1"; }
g "good" && { node good.js 2>&1 | tail -5; echo "exit ${PIPESTATUS[0]}"; }
[ -n "$BREAK" ] && g "crashes" && { node crash.js 2>&1 | tail -1; }
[ -n "$BREAK" ] && g "load error" && { node loaderr.js 2>&1 | tail -5; echo "exit ${PIPESTATUS[0]}"; }
STUB
echo "console.log('ok fine');" > "$tmp/good.js"
echo "console.log('ok before'); process.exit(3);" > "$tmp/crash.js"
echo "throw new Error('cannot load');" > "$tmp/loaderr.js"
run() { env "$@" bash "$tmp/test.sh" "$tmp" 2>&1; }
n=0; bad=0
check() { n=$((n + 1)); if eval "$2"; then echo "ok $1"; else echo "FAIL $1"; bad=$((bad + 1)); fi; }
good=$(run BREAK=)
check "a suite of passing harnesses gives RESULT: PASS" '[[ "$good" == *"RESULT: PASS"* ]]'
broken=$(run BREAK=1)
check "a harness that exits non-zero gives RESULT: FAIL" '[[ "$broken" == *"RESULT: FAIL"* ]]'
check "the failure names the group that crashed with no exit echo" '[[ "$broken" == *"FAIL group \"crashes\" exited with code 3"* ]]'
check "the failure names the group that failed to load" '[[ "$broken" == *"FAIL group \"load error\" exited with code 1"* ]]'
check "the summary keeps the Tests: line" '[[ "$broken" == *"Tests: 3 groups"* ]]'
[ "$bad" = "0" ] || exit 1
