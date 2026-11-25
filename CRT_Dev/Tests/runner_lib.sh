# Sourced by run_all.sh. Every harness runs through this node wrapper: when node exits non-zero (a harness that
# crashes, fails to load its Lua or fails a check), it prints a "FAIL" line naming the group, as the last line of the
# group's output, so test.sh reports it whatever tail window or exit echo the group's line uses. CRT_GROUP is set by g.
node() {
  command node "$@"
  local rc=$?
  if [ "$rc" -ne 0 ]; then echo "FAIL group \"$CRT_GROUP\" exited with code $rc (crash or load error)"; fi
  return $rc
}
