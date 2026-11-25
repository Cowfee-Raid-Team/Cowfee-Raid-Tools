# Sourced by run_all.sh. Every harness runs through this node wrapper: when node exits non-zero (a harness that
# crashes, fails to load its Lua or fails a check), it prints a "FAIL" line naming the group, as the last line of the
# group's output, so test.sh reports it whatever tail window or exit echo the group's line uses. CRT_GROUP is set by g.
# It also preloads locale_preload.js (when it sits beside this file): every addon file a harness loads gets the real
# CRT_Core/Locale.lua in its CRT first, as the .toc gives it in the game (see that file).
CRT_LOCALE_PRELOAD=""
[ -f ./locale_preload.js ] && CRT_LOCALE_PRELOAD="$(pwd -W 2>/dev/null || pwd)/locale_preload.js"
node() {
  if [ -n "$CRT_LOCALE_PRELOAD" ]; then command node -r "$CRT_LOCALE_PRELOAD" "$@"; else command node "$@"; fi
  local rc=$?
  if [ "$rc" -ne 0 ]; then echo "FAIL group \"$CRT_GROUP\" exited with code $rc (crash or load error)"; fi
  return $rc
}
