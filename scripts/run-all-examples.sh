#!/bin/bash
#
# Run all mimiq examples and generate demo outputs.
#
# Usage:
#   ./scripts/run-all-examples.sh
#   ./scripts/run-all-examples.sh --skip-gifs
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

SKIP_GIFS=false
if [ "$1" == "--skip-gifs" ]; then
  SKIP_GIFS=true
fi

echo "=================================="
echo "mimiq Examples Runner"
echo "=================================="
echo ""

cd "$PROJECT_ROOT"
echo "Building mimiq..."
npm run build
echo ""

EXAMPLES=("playwright-basic" "stagehand-autonomous" "layoutlens-visual")

run_example() {
  local example="$1"
  local example_dir="$PROJECT_ROOT/examples/$example"

  if [ ! -d "$example_dir" ]; then
    echo "Example not found: $example"
    return 1
  fi

  echo "=================================="
  echo "Running: $example"
  echo "=================================="

  cd "$example_dir"

  if [ -f "package.json" ]; then
    echo "Installing dependencies..."
    npm install 2>/dev/null || true
  fi

  echo "Running tests..."
  MIMIQ_RECORDING=1 npm test -- --reporter=list 2>&1 || {
    echo "Warning: Some tests may have failed (continuing...)"
  }

  echo ""
}

for example in "${EXAMPLES[@]}"; do
  run_example "$example" || true
done

cd "$PROJECT_ROOT"

if [ "$SKIP_GIFS" = false ]; then
  echo "=================================="
  echo "Generating GIFs"
  echo "=================================="

  chmod +x "$SCRIPT_DIR/generate-gifs.sh"
  "$SCRIPT_DIR/generate-gifs.sh" --all || {
    echo "GIF generation failed or no screenshots found"
  }
fi

echo ""
echo "=================================="
echo "Summary"
echo "=================================="
echo ""
echo "Outputs:"
echo "  Videos:      examples/outputs/videos/"
echo "  GIFs:        examples/outputs/gifs/"
echo "  Screenshots: examples/outputs/screenshots/"
echo "  Reports:     examples/outputs/reports/"
echo ""

if [ -d "$PROJECT_ROOT/examples/outputs/gifs" ]; then
  echo "Generated GIFs:"
  ls -la "$PROJECT_ROOT/examples/outputs/gifs"/*.gif 2>/dev/null || echo "  (none)"
fi

echo ""
echo "Done!"
