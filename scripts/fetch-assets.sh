#!/usr/bin/env bash
#
# Fetch and process the Shisha Companion media assets into assets/dist/.
# Upload with scripts/sync-assets.sh. Media is never committed to the repo.
#
# THE MASCOT PIPELINE (why it is different from the rest):
#   The original Higgsfield mascot clips are animated *character reference sheets* —
#   every frame also contains line-art sketches, a lantern icon, and colour-palette
#   swatches, on a flat cream background. Dropped into the app they looked like a
#   picture-in-picture card, not a character in the scene.
#
#   Fix: each clip was run through Higgsfield's video_background_remover (1 credit
#   each), which isolates the cat and returns it on PURE BLACK — H.264 cannot carry
#   an alpha channel. The MASCOT urls below are those matted outputs. We then key the
#   black out and re-encode to two transparent formats (see encode_mascot).
#
# Safe + idempotent to re-run: downloads are cached, assets/dist/ is rebuilt.
set -euo pipefail

CDN="https://d8j0ntlcm91z4.cloudfront.net/user_3FzL8wE21wNR5RGr3tsFrLLSrkP"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW="$PROJECT_DIR/assets/raw"     # untouched originals (backgrounds, stills)
NOBG="$PROJECT_DIR/assets/nobg"   # mascot clips, background already removed
OUT="$PROJECT_DIR/assets/dist"
BGM_SRC="/Users/jaycpantinople/Claude-test/shisha/BGM"

rm -rf "$OUT/mascot" "$OUT/bg" "$OUT/stills" "$OUT/bgm"
mkdir -p "$RAW" "$NOBG" "$OUT/mascot" "$OUT/bg" "$OUT/stills" "$OUT/bgm"

# Mascot loops — these are the BACKGROUND-REMOVED outputs (cat on pure black).
MASCOT="
idle:hf_20260714_095907_3951fc33-ce18-49be-a7b1-4bd6ad2120a9.mp4
idle-variant:hf_20260714_101529_f90256ad-8ec5-46f1-bfc3-91dfe321cb71.mp4
talking:hf_20260714_101539_91a772e5-b372-400d-a22b-4296c27069bd.mp4
smoking:hf_20260714_101556_17a152be-0d5e-47fb-b11e-daed0665ef31.mp4
alert:hf_20260714_101605_be65d8cc-969e-4d2c-8fc2-c516f9d57503.mp4
thinking:hf_20260714_101727_4cc3ed63-5db1-49b1-9c1a-ec32fd36fe8b.mp4
happy:hf_20260714_101736_1b09eb04-b154-402f-aa52-bb8b9e8c1471.mp4
easy-there:hf_20260714_101750_75afb362-eca5-4065-94b4-fcc6bbd4ed26.mp4
sleepy:hf_20260714_101900_388535bd-c713-4e8c-9779-dee121609349.mp4
greeting:hf_20260714_101910_323984b4-dcfb-4743-a8c1-42e37fdf58b9.mp4
goodbye:hf_20260714_101918_70a8e5de-8346-400a-872f-5dba12ad1bba.mp4
"

# Background loops (5s). lounge-hero is the approved default scene.
BACKGROUNDS="
lounge-hero:hf_20260712_190025_7a319dfe-4907-411f-ab94-c606a4f849ca.mp4
lounge-normal:hf_20260712_152524_d283f883-d9f4-448f-82da-76853c31117a.mp4
village-dusk:hf_20260712_151949_66a28578-a374-414f-8dc6-26f87b1d07d1.mp4
"

# Reference stills — used as <video poster> images while a clip loads.
STILLS="
cat-master:hf_20260712_143216_52811f80-733e-468d-a78c-08f33479b0c3.png
lounge-master:hf_20260712_185648_e607fd6e-3d6c-49fb-a616-e933696c9540.png
"

download() {
  local name="$1" remote="$2" dir="$3"
  local out="$dir/$name.${remote##*.}"
  if [ -f "$out" ]; then
    echo "  have    $name"
  else
    echo "  fetch   $name"
    curl -fsS "$CDN/$remote" -o "$out"
  fi
}

# Key the pure-black matte out to transparency and emit BOTH transparent formats.
#
# Transparent video on the web is fragmented — there is no single file that works
# everywhere:
#   .webm  VP9 + alpha   -> Chrome, Firefox, Edge
#   .mov   HEVC + alpha  -> Safari / iOS, which cannot do alpha in WebM
# The <video> element lists the .mov source first; browsers that cannot decode hvc1
# skip it and fall through to the .webm.
#
# colorkey similarity is kept LOW (0.06): the cat's outlines are dark brown, not pure
# black, so a tight threshold lifts the background without punching holes in the line
# work. The blend value softens the cutout edge so it does not look jagged.
encode_mascot() {
  local src="$1" base="$2"
  local key="colorkey=0x000000:0.06:0.10,scale=480:-2,format=yuva420p"

  ffmpeg -nostdin -y -loglevel error -i "$src" -an \
    -vf "$key" \
    -c:v libvpx-vp9 -pix_fmt yuva420p -crf 36 -b:v 0 -auto-alt-ref 0 \
    "$base.webm"

  ffmpeg -nostdin -y -loglevel error -i "$src" -an \
    -vf "$key" \
    -c:v hevc_videotoolbox -allow_sw 1 -alpha_quality 0.9 -vtag hvc1 -q:v 45 \
    "$base.mov"
}

# Opaque clips (backgrounds): plain H.264, audio stripped.
encode_clip() {
  local src="$1" dest="$2" width="$3" crf="$4"
  ffmpeg -nostdin -y -loglevel error -i "$src" -an \
    -vf "scale=${width}:-2" \
    -c:v libx264 -crf "$crf" -preset slow -pix_fmt yuv420p -movflags +faststart \
    "$dest"
}

encode_still() {
  local src="$1" dest="$2" width="$3"
  ffmpeg -nostdin -y -loglevel error -i "$src" -vf "scale=${width}:-2" -q:v 4 "$dest"
}

echo "== Mascot loops (transparent) =="
while IFS=: read -r name remote; do
  [ -z "$name" ] && continue
  download "$name" "$remote" "$NOBG"
  encode_mascot "$NOBG/$name.mp4" "$OUT/mascot/$name"
  echo "  encode  $name.webm + $name.mov"
done <<< "$MASCOT"
echo ""

echo "== Backgrounds =="
while IFS=: read -r name remote; do
  [ -z "$name" ] && continue
  download "$name" "$remote" "$RAW"
  encode_clip "$RAW/$name.mp4" "$OUT/bg/$name.mp4" 1280 30
  echo "  encode  $name.mp4"
done <<< "$BACKGROUNDS"
echo ""

echo "== Stills =="
while IFS=: read -r name remote; do
  [ -z "$name" ] && continue
  download "$name" "$remote" "$RAW"
  encode_still "$RAW/$name.png" "$OUT/stills/$name.jpg" 960
  echo "  encode  $name.jpg"
done <<< "$STILLS"
echo ""

echo "== BGM =="
if [ -d "$BGM_SRC" ]; then
  for src in "$BGM_SRC"/*.mp3; do
    base="$(basename "$src")"
    # Ambient loops under a UI at low volume: 96kbps is transparent enough.
    ffmpeg -nostdin -y -loglevel error -i "$src" -c:a libmp3lame -b:a 96k \
      "$OUT/bgm/$base"
    echo "  encode  $base"
  done
else
  echo "  BGM source not found at $BGM_SRC — skipped"
fi
echo ""

echo "== Sizes =="
du -sh "$OUT/mascot" "$OUT/bg" "$OUT/stills" "$OUT/bgm"
echo "---"
du -sh "$OUT"
