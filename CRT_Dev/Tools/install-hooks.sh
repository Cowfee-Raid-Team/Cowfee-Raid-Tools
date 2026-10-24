#!/bin/sh
# Installs the post-commit and post-merge hooks that keep CRT_Dev/Dev/Build.lua current. The hooks run the
# build number script only in the main checkout (the AddOns folder), never in a factory worktree.
hooks=$(git rev-parse --git-common-dir)/hooks
for h in post-commit post-merge; do
    cat > "$hooks/$h" <<'HOOK'
#!/bin/sh
top=$(git rev-parse --show-toplevel)
case "$top" in
    */Interface/AddOns/CowfeeRaidTools) sh "$top/CRT_Dev/Tools/build-number.sh" ;;
esac
exit 0
HOOK
    chmod +x "$hooks/$h"
done
echo "Installed post-commit and post-merge in $hooks"
