#!/bin/sh
# Compress a screen recording for a GitHub README (under 10 MB for about 2 minutes).
#   sh compress-video.sh in.mov out.mp4 [width=1920] [fps=20] [crf=23]
# Uses $FFMPEG or ffmpeg on PATH. Silent output (no audio), H.264, yuv420p, faststart.
set -eu
IN="${1:?usage: compress-video.sh in.mov out.mp4 [width] [fps] [crf]}"
OUT="${2:?usage: compress-video.sh in.mov out.mp4 [width] [fps] [crf]}"
WIDTH="${3:-1920}"
FPS="${4:-20}"
CRF="${5:-23}"
FF="${FFMPEG:-ffmpeg}"
command -v "$FF" >/dev/null 2>&1 || { echo "ffmpeg not found: brew install ffmpeg, or set FFMPEG=/path/to/ffmpeg" >&2; exit 1; }

"$FF" -hide_banner -loglevel error -y -i "$IN" \
  -vf "scale='min($WIDTH,iw)':-2:flags=lanczos,fps=$FPS" \
  -c:v libx264 -preset slow -crf "$CRF" -pix_fmt yuv420p -movflags +faststart -an "$OUT"

SIZE=$(wc -c < "$OUT" | tr -d ' ')
MB=$(awk "BEGIN { printf \"%.1f\", $SIZE / 1048576 }")
echo "✔ $OUT ($MB MB)"
if [ "$SIZE" -gt 10485760 ]; then
  echo "! Over 10 MB: try a smaller width or fps, e.g. sh $0 \"$IN\" \"$OUT\" 1280 15 26" >&2
fi
