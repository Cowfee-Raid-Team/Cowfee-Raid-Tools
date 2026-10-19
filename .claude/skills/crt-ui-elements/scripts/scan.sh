#!/usr/bin/env bash
# Lists where CRT makes controls by hand and where it uses the shared helpers, by file, so an audit
# can compare it with references/catalog.md's review queue. Run from anywhere: bash scan.sh [addon dir]
ADDON="${1:-/c/Program Files (x86)/World of Warcraft/_retail_/Interface/AddOns/CowfeeRaidTools}"
cd "$ADDON" || exit 1
files=$(git ls-files '*.lua' | grep -v '^Tests/')

echo "== Hand-made templates (outside UI/), with whether the file also skins them"
for f in $files; do
  case "$f" in UI/*) continue ;; esac
  hits=$(grep -n 'UIPanelButtonTemplate\|UIPanelCloseButton\|InputBoxTemplate' "$f" | grep -v '^\s*[0-9]*:\s*--')
  [ -z "$hits" ] && continue
  skin=$(grep -c 'SkinButton\|SkinCloseButton\|SkinEditBox\|SkinTree' "$f")
  page=$(case "$f" in */Page.lua|*Page.lua|*Tab.lua) echo "page (SkinTree)";; *) echo "window/overlay";; esac)
  echo "-- $f [$page, skin calls: $skin]"
  echo "$hits" | sed 's/^/   /'
done

echo
echo "== Helper calls, by helper"
for h in 'UI.HeaderButton' 'UI.ResetButton' 'UI.PanelButton' 'UI.Help' 'UI.Dropdown' 'UI.Slider' 'UI.Window' 'SkinEditBox' 'SetBadge'; do
  n=$(grep -l "$h" $files 2>/dev/null | wc -l)
  echo "$h: $n files"
done
