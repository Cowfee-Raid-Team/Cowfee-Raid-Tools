#!/bin/sh
# Writes CRT_Dev/Dev/Build.lua: the internal build number shown after the version in the title bar
# ("v1.1.2 build#004"), on Alex's computer only. It counts the commits on main's first-parent line since the
# last release tag (v*), so it starts again at every release. The file is git-ignored and inside the .toc's
# do-not-package block, so it never ships. Run by the post-commit and post-merge hooks in the main checkout
# (install them with CRT_Dev/Tools/install-hooks.sh); safe to run by hand.
top=$(git rev-parse --show-toplevel) || exit 0
tag=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null)
if [ -n "$tag" ]; then
    n=$(git rev-list --count --first-parent "$tag..HEAD")
else
    n=$(git rev-list --count --first-parent HEAD)
fi
# v1.1.2's count starts at the commit that added the build number (Alex, 2026-10-24: "do a v1.1.2 build#001"):
# the 20 commits on main before it don't count. Gone with the next release tag.
if [ "$tag" = "v1.1.2" ]; then
    n=$((n - 20))
fi
[ "$n" -lt 0 ] && n=0
printf 'local ADDON, CRT = ...\n-- Written by CRT_Dev/Tools/build-number.sh after each commit or merge on main. Never shipped.\nCRT.BUILD = %d\n' "$n" > "$top/CRT_Dev/Dev/Build.lua"
