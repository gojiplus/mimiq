#!/bin/bash
#
# Generate GIFs from recorded screenshots.
#
# Prerequisites:
#   brew install gifski
#
# Usage:
#   ./scripts/generate-gifs.sh [sceneId]
#   ./scripts/generate-gifs.sh track_order_via_button
#   ./scripts/generate-gifs.sh --all
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCREENSHOTS_DIR="$PROJECT_ROOT/examples/outputs/screenshots"
GIFS_DIR="$PROJECT_ROOT/examples/outputs/gifs"

FPS="${GIF_FPS:-2}"
WIDTH="${GIF_WIDTH:-800}"
QUALITY="${GIF_QUALITY:-90}"

mkdir -p "$GIFS_DIR"

generate_gif() {
  local scene_id="$1"
  local scene_dir="$SCREENSHOTS_DIR/$scene_id"

  if [ ! -d "$scene_dir" ]; then
    echo "No screenshots found for: $scene_id"
    echo "  Expected: $scene_dir"
    return 1
  fi

  local png_count
  png_count=$(ls -1 "$scene_dir"/*.png 2>/dev/null | wc -l | tr -d ' ')

  if [ "$png_count" -eq 0 ]; then
    echo "No PNG files in: $scene_dir"
    return 1
  fi

  echo "Generating GIF for: $scene_id"
  echo "  Screenshots: $png_count"
  echo "  FPS: $FPS, Width: $WIDTH, Quality: $QUALITY"

  local output_gif="$GIFS_DIR/${scene_id}.gif"

  if command -v gifski &> /dev/null; then
    gifski \
      --fps "$FPS" \
      --width "$WIDTH" \
      --quality "$QUALITY" \
      --output "$output_gif" \
      "$scene_dir"/*.png

    echo "  Created: $output_gif"
    echo "  Size: $(du -h "$output_gif" | cut -f1)"
  elif command -v ffmpeg &> /dev/null; then
    echo "  Using ffmpeg (gifski not found)"

    local palette="/tmp/palette-$scene_id.png"
    ffmpeg -y -framerate "$FPS" -pattern_type glob -i "$scene_dir/*.png" \
      -vf "fps=$FPS,scale=$WIDTH:-1:flags=lanczos,palettegen" \
      "$palette" 2>/dev/null

    ffmpeg -y -framerate "$FPS" -pattern_type glob -i "$scene_dir/*.png" \
      -i "$palette" \
      -lavfi "fps=$FPS,scale=$WIDTH:-1:flags=lanczos [x]; [x][1:v] paletteuse" \
      "$output_gif" 2>/dev/null

    rm -f "$palette"
    echo "  Created: $output_gif"
    echo "  Size: $(du -h "$output_gif" | cut -f1)"
  else
    echo "Error: Neither gifski nor ffmpeg found."
    echo "Install with: brew install gifski"
    return 1
  fi
}

generate_all() {
  echo "Generating GIFs for all recorded scenes..."

  for scene_dir in "$SCREENSHOTS_DIR"/*/; do
    if [ -d "$scene_dir" ]; then
      local scene_id
      scene_id=$(basename "$scene_dir")
      generate_gif "$scene_id" || true
    fi
  done
}

if [ "$1" == "--all" ] || [ "$1" == "-a" ]; then
  generate_all
elif [ -n "$1" ]; then
  generate_gif "$1"
else
  echo "Usage: $0 [sceneId] | --all"
  echo ""
  echo "Arguments:"
  echo "  sceneId    Generate GIF for specific scene"
  echo "  --all      Generate GIFs for all recorded scenes"
  echo ""
  echo "Environment variables:"
  echo "  GIF_FPS=2       Frames per second (default: 2)"
  echo "  GIF_WIDTH=800   Width in pixels (default: 800)"
  echo "  GIF_QUALITY=90  Quality 1-100 (default: 90)"
  echo ""
  echo "Available scenes:"

  if [ -d "$SCREENSHOTS_DIR" ]; then
    for scene_dir in "$SCREENSHOTS_DIR"/*/; do
      if [ -d "$scene_dir" ]; then
        local scene_id
        scene_id=$(basename "$scene_dir")
        local count
        count=$(ls -1 "$scene_dir"/*.png 2>/dev/null | wc -l | tr -d ' ')
        echo "  - $scene_id ($count screenshots)"
      fi
    done
  else
    echo "  (no recordings found)"
  fi
fi
