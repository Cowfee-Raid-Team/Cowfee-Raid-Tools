#!/usr/bin/env bash
# Speeds up the number clips 0.mp3 to 9.mp3 of every voice in CRT_Media/Media/Sounds/<voice>/ (Sound/Voices.lua),
# in place, so a count is a quick phrase (#1238). ffmpeg's atempo keeps the pitch. Word clips are left alone.
# Developer only: CRT_Dev is never packaged.
#   bash CRT_Dev/Tools/tempo-numbers.sh [voice folder ...]    default: every folder under CRT_Media/Media/Sounds
# Settings, as environment variables:
#   TEMPO   how much faster (default 1.4, Alex 2026-11-01; atempo takes 0.5 to 100, 1.0 changes nothing)
#   FFMPEG  ffmpeg.exe (default: the winget Gyan.FFmpeg install; ffprobe.exe is read from beside it)
# Each clip is decoded, sped up and encoded again at its own sample rate and bitrate, with no ID3 tag or other
# metadata. Every run speeds them up again, so run it once on clips that are at their recorded speed (git checkout
# the folder first to start over). Afterwards: update each voice's `seconds` in CRT_Core/Sound/Voices.lua
# (run_voices.js prints any that differ from the files) and run bash CRT_Dev/Tests/test.sh voices.
# Prints each clip: folder/number, seconds before, seconds after.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sounds="$here/../../CRT_Media/Media/Sounds"
FFMPEG="${FFMPEG:-/c/Users/Alex/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe}"
FFPROBE="${FFPROBE:-$(dirname "$FFMPEG")/ffprobe.exe}"
TEMPO="${TEMPO:-1.4}"
[ -x "$FFMPEG" ] || { echo "ffmpeg not found: $FFMPEG (set FFMPEG)"; exit 1; }

folders=("$@")
if [ ${#folders[@]} -eq 0 ]; then
    for d in "$sounds"/*/; do folders+=("$d"); done
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
probe() { "$FFPROBE" -v error "$@" -of default=nw=1:nk=1 "$f"; }
for dir in "${folders[@]}"; do
    for n in 0 1 2 3 4 5 6 7 8 9; do
        f="$dir/$n.mp3"
        [ -e "$f" ] || continue
        rate=$(probe -select_streams a:0 -show_entries stream=sample_rate)
        bits=$(probe -select_streams a:0 -show_entries stream=bit_rate)
        before=$(probe -show_entries format=duration)
        out="$work/$n.mp3"
        "$FFMPEG" -v error -y -i "$f" -af "atempo=$TEMPO" -c:a libmp3lame -b:a "$bits" -ar "$rate" \
            -map_metadata -1 -id3v2_version 0 -write_id3v1 0 -write_xing 0 "$out"
        mv -f "$out" "$f"
        after=$(probe -show_entries format=duration)
        printf '%s/%s\t%s\t%s\n' "$(basename "$dir")" "$n" "$before" "$after"
    done
done
