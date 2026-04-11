#!/bin/bash
#
# Generate GIFs from recorded screenshots.
#
# Prerequisites:
#   brew install gifski
#   or: brew install ffmpeg
#
# Usage:
#   ./scripts/generate-gifs.sh [sceneId]
#   ./scripts/generate-gifs.sh track_order_via_button
#   ./scripts/generate-gifs.sh --all
#
# Looks for screenshots in:
#   - examples/outputs/screenshots/$sceneId/*.png (legacy)
#   - examples/outputs/recordings/$sceneId/run-*/screenshots/*.png (new)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCREENSHOTS_DIR="$PROJECT_ROOT/examples/outputs/screenshots"
RECORDINGS_DIR="$PROJECT_ROOT/examples/outputs/recordings"
GIFS_DIR="$PROJECT_ROOT/examples/outputs/gifs"

FPS="${GIF_FPS:-2}"
WIDTH="${GIF_WIDTH:-800}"
QUALITY="${GIF_QUALITY:-90}"

mkdir -p "$GIFS_DIR"

do_generate_gif() {
  local scene_id="$1"
  local run_name="$2"
  local screenshots_path="$3"
  local output_subdir="$4"

  local png_count
  png_count=$(ls -1 "$screenshots_path"/*.png 2>/dev/null | wc -l | tr -d ' ')

  if [ "$png_count" -eq 0 ]; then
    echo "  No PNG files in: $screenshots_path"
    return 1
  fi

  echo "Generating GIF for: $scene_id/$run_name"
  echo "  Screenshots: $png_count"
  echo "  FPS: $FPS, Width: $WIDTH, Quality: $QUALITY"

  mkdir -p "$GIFS_DIR/$output_subdir"
  local output_gif="$GIFS_DIR/$output_subdir/${run_name}.gif"

  if command -v gifski &> /dev/null; then
    gifski \
      --fps "$FPS" \
      --width "$WIDTH" \
      --quality "$QUALITY" \
      --output "$output_gif" \
      "$screenshots_path"/*.png

    echo "  Created: $output_gif"
    echo "  Size: $(du -h "$output_gif" | cut -f1)"
  elif command -v ffmpeg &> /dev/null; then
    echo "  Using ffmpeg (gifski not found)"

    local palette="/tmp/palette-${scene_id}-${run_name}.png"
    ffmpeg -y -framerate "$FPS" -pattern_type glob -i "$screenshots_path/*.png" \
      -vf "fps=$FPS,scale=$WIDTH:-1:flags=lanczos,palettegen" \
      "$palette" 2>/dev/null

    ffmpeg -y -framerate "$FPS" -pattern_type glob -i "$screenshots_path/*.png" \
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

generate_gif_for_scene() {
  local scene_id="$1"
  local found=0

  # Check legacy screenshots directory
  if [ -d "$SCREENSHOTS_DIR/$scene_id" ]; then
    local png_count
    png_count=$(ls -1 "$SCREENSHOTS_DIR/$scene_id"/*.png 2>/dev/null | wc -l | tr -d ' ')
    if [ "$png_count" -gt 0 ]; then
      do_generate_gif "$scene_id" "$scene_id" "$SCREENSHOTS_DIR/$scene_id" "" || true
      found=1
    fi
  fi

  # Check recordings directory (new structure)
  if [ -d "$RECORDINGS_DIR/$scene_id" ]; then
    for run_dir in "$RECORDINGS_DIR/$scene_id"/run-*/; do
      if [ -d "$run_dir/screenshots" ]; then
        local run_name
        run_name=$(basename "$run_dir")
        do_generate_gif "$scene_id" "$run_name" "$run_dir/screenshots" "$scene_id" || true
        found=1
      fi
    done
  fi

  # Check framework-specific directories (cypress, playwright, stagehand)
  for framework in cypress playwright stagehand; do
    if [ -d "$RECORDINGS_DIR/$framework/$scene_id" ]; then
      for run_dir in "$RECORDINGS_DIR/$framework/$scene_id"/run-*/; do
        if [ -d "$run_dir/screenshots" ]; then
          local run_name
          run_name=$(basename "$run_dir")
          do_generate_gif "$scene_id" "$run_name" "$run_dir/screenshots" "$framework/$scene_id" || true
          found=1
        fi
      done
    fi
  done

  if [ "$found" -eq 0 ]; then
    echo "No screenshots found for: $scene_id"
    return 1
  fi
}

generate_all() {
  echo "Generating GIFs for all recorded scenes..."
  echo ""

  # Legacy screenshots
  if [ -d "$SCREENSHOTS_DIR" ]; then
    for scene_dir in "$SCREENSHOTS_DIR"/*/; do
      if [ -d "$scene_dir" ]; then
        local scene_id
        scene_id=$(basename "$scene_dir")
        generate_gif_for_scene "$scene_id" || true
      fi
    done
  fi

  # New recordings structure
  if [ -d "$RECORDINGS_DIR" ]; then
    for item in "$RECORDINGS_DIR"/*/; do
      if [ -d "$item" ]; then
        local name
        name=$(basename "$item")
        # Skip framework directories, handle them separately
        if [[ "$name" != "cypress" && "$name" != "playwright" && "$name" != "stagehand" ]]; then
          generate_gif_for_scene "$name" || true
        fi
      fi
    done

    # Framework-specific recordings
    for framework in cypress playwright stagehand; do
      if [ -d "$RECORDINGS_DIR/$framework" ]; then
        for scene_dir in "$RECORDINGS_DIR/$framework"/*/; do
          if [ -d "$scene_dir" ]; then
            local scene_id
            scene_id=$(basename "$scene_dir")
            generate_gif_for_scene "$scene_id" || true
          fi
        done
      fi
    done
  fi
}

list_available() {
  echo "Available scenes:"
  echo ""

  local found=0

  # Legacy screenshots
  if [ -d "$SCREENSHOTS_DIR" ]; then
    for scene_dir in "$SCREENSHOTS_DIR"/*/; do
      if [ -d "$scene_dir" ]; then
        local scene_id
        scene_id=$(basename "$scene_dir")
        local count
        count=$(ls -1 "$scene_dir"/*.png 2>/dev/null | wc -l | tr -d ' ')
        if [ "$count" -gt 0 ]; then
          echo "  - $scene_id ($count screenshots)"
          found=1
        fi
      fi
    done
  fi

  # New recordings structure
  if [ -d "$RECORDINGS_DIR" ]; then
    for item in "$RECORDINGS_DIR"/*/; do
      if [ -d "$item" ]; then
        local name
        name=$(basename "$item")
        if [[ "$name" != "cypress" && "$name" != "playwright" && "$name" != "stagehand" && "$name" != ".gitkeep" ]]; then
          for run_dir in "$item"/run-*/; do
            if [ -d "$run_dir/screenshots" ]; then
              local count
              count=$(ls -1 "$run_dir/screenshots"/*.png 2>/dev/null | wc -l | tr -d ' ')
              if [ "$count" -gt 0 ]; then
                local run_name
                run_name=$(basename "$run_dir")
                echo "  - $name/$run_name ($count screenshots)"
                found=1
              fi
            fi
          done
        fi
      fi
    done

    # Framework recordings
    for framework in cypress playwright stagehand; do
      if [ -d "$RECORDINGS_DIR/$framework" ]; then
        for scene_dir in "$RECORDINGS_DIR/$framework"/*/; do
          if [ -d "$scene_dir" ]; then
            local scene_id
            scene_id=$(basename "$scene_dir")
            for run_dir in "$scene_dir"/run-*/; do
              if [ -d "$run_dir/screenshots" ]; then
                local count
                count=$(ls -1 "$run_dir/screenshots"/*.png 2>/dev/null | wc -l | tr -d ' ')
                if [ "$count" -gt 0 ]; then
                  local run_name
                  run_name=$(basename "$run_dir")
                  echo "  - $framework/$scene_id/$run_name ($count screenshots)"
                  found=1
                fi
              fi
            done
          fi
        done
      fi
    done
  fi

  if [ "$found" -eq 0 ]; then
    echo "  (no recordings found)"
  fi
}

if [ "$1" == "--all" ] || [ "$1" == "-a" ]; then
  generate_all
elif [ -n "$1" ]; then
  generate_gif_for_scene "$1"
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
  list_available
fi
