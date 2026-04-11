#!/bin/bash
#
# Mimiq Examples E2E Runner
# Runs all example tests, generates recordings, GIFs, and evaluation reports
#
# Usage:
#   ./run-all.sh              # Run everything
#   ./run-all.sh --runs 3     # Run each test 3 times (default)
#   ./run-all.sh --skip-gifs  # Skip GIF generation
#   ./run-all.sh --only playwright  # Only run playwright tests
#   ./run-all.sh --only agent        # Only run agent tests
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUTS_DIR="$SCRIPT_DIR/outputs"

# Defaults
NUM_RUNS=${NUM_RUNS:-3}
SKIP_GIFS=false
ONLY=""
LLM_MODEL=${LLM_MODEL:-"openai/gpt-4o"}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --runs)
      NUM_RUNS="$2"
      shift 2
      ;;
    --skip-gifs)
      SKIP_GIFS=true
      shift
      ;;
    --only)
      ONLY="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "============================================"
echo "Mimiq Examples E2E Runner"
echo "============================================"
echo "Runs per test: $NUM_RUNS"
echo "LLM Model: $LLM_MODEL"
echo "Output dir: $OUTPUTS_DIR"
echo ""

# Clean previous outputs
echo "Cleaning previous outputs..."
rm -rf "$OUTPUTS_DIR/recordings"/*/ 2>/dev/null || true
rm -rf "$OUTPUTS_DIR/reports/playwright"/* 2>/dev/null || true
rm -rf "$OUTPUTS_DIR/reports/cypress"/* 2>/dev/null || true
rm -rf "$OUTPUTS_DIR/test-results"/* 2>/dev/null || true
mkdir -p "$OUTPUTS_DIR/recordings"
mkdir -p "$OUTPUTS_DIR/reports/playwright"
mkdir -p "$OUTPUTS_DIR/reports/cypress"
mkdir -p "$OUTPUTS_DIR/gifs"
mkdir -p "$OUTPUTS_DIR/evals"

# Ensure package is built
echo "Building mimiq package..."
cd "$ROOT_DIR"
npm run build

# Start test app
echo "Starting test application..."
cd "$ROOT_DIR/test/app"
npm run dev &
APP_PID=$!
sleep 3

# Verify app is running
if ! curl -s http://localhost:5173 > /dev/null; then
  echo "ERROR: Test app failed to start"
  kill $APP_PID 2>/dev/null || true
  exit 1
fi
echo "Test app running on http://localhost:5173"

cleanup() {
  echo "Stopping test app..."
  kill $APP_PID 2>/dev/null || true
}
trap cleanup EXIT

# ============================================
# Run Playwright Tests
# ============================================
run_playwright() {
  echo ""
  echo "============================================"
  echo "Running Playwright Tests ($NUM_RUNS runs each)"
  echo "============================================"

  cd "$SCRIPT_DIR/playwright"

  for run in $(seq 1 $NUM_RUNS); do
    echo ""
    echo "--- Playwright Run $run of $NUM_RUNS ---"
    MIMIQ_RECORDING=1 LLM_MODEL="$LLM_MODEL" npx playwright test --config=playwright.config.ts 2>&1 || true
  done

  echo "Playwright tests complete."
}

# ============================================
# Run Cypress Tests
# ============================================
run_cypress() {
  echo ""
  echo "============================================"
  echo "Running Cypress Tests ($NUM_RUNS runs each)"
  echo "============================================"

  cd "$SCRIPT_DIR/cypress"

  for run in $(seq 1 $NUM_RUNS); do
    echo ""
    echo "--- Cypress Run $run of $NUM_RUNS ---"
    MIMIQ_RECORDING=1 LLM_MODEL="$LLM_MODEL" npx cypress run 2>&1 || true
  done

  echo "Cypress tests complete."
}

# ============================================
# Run Stagehand Tests
# ============================================
run_stagehand() {
  echo ""
  echo "============================================"
  echo "Running Stagehand Tests ($NUM_RUNS runs each)"
  echo "============================================"

  cd "$SCRIPT_DIR/stagehand"

  # Install dependencies including stagehand if not present
  if [ ! -d "node_modules" ] || ! npm list @browserbasehq/stagehand 2>/dev/null | grep -q stagehand; then
    echo "Installing stagehand dependencies..."
    npm install && npm link @gojiplus/mimiq 2>&1 || {
      echo "WARNING: Failed to install @browserbasehq/stagehand"
      echo "Skipping stagehand tests."
      return
    }
  fi

  # Check for required API key
  if [ -z "$OPENAI_API_KEY" ] && [ -z "$BROWSERBASE_API_KEY" ]; then
    echo "WARNING: No API key found (OPENAI_API_KEY or BROWSERBASE_API_KEY)"
    echo "Stagehand tests may fail without proper credentials."
  fi

  # Test for playwright conflict
  TEST_OUTPUT=$(MIMIQ_RECORDING=1 npx playwright test --config=playwright.config.ts 2>&1 || true)
  if echo "$TEST_OUTPUT" | grep -q "Requiring @playwright/test second time"; then
    echo ""
    echo "WARNING: Stagehand tests skipped due to playwright version conflict."
    echo "This is a known issue when using @playwright/test with @browserbasehq/stagehand."
    echo ""
    echo "To run stagehand tests manually, use Browserbase cloud:"
    echo "  BROWSERBASE_API_KEY=xxx npm test"
    echo ""
    return
  fi

  for run in $(seq 1 $NUM_RUNS); do
    echo ""
    echo "--- Stagehand Run $run of $NUM_RUNS ---"
    MIMIQ_RECORDING=1 LLM_MODEL="$LLM_MODEL" npx playwright test --config=playwright.config.ts 2>&1 || true
  done

  echo "Stagehand tests complete."
}

# ============================================
# Run Agent Tests
# ============================================
run_agent() {
  echo ""
  echo "============================================"
  echo "Running Agent Evaluation ($NUM_RUNS runs each)"
  echo "============================================"

  cd "$SCRIPT_DIR"

  local agent_scenes_dir="$SCRIPT_DIR/agent-scenes"

  if [ ! -d "$agent_scenes_dir" ]; then
    echo "WARNING: No agent-scenes directory found, skipping agent tests."
    return
  fi

  local scene_count=$(ls -1 "$agent_scenes_dir"/*.yaml "$agent_scenes_dir"/*.yml 2>/dev/null | wc -l | tr -d ' ')
  if [ "$scene_count" -eq 0 ]; then
    echo "WARNING: No agent scene files found, skipping agent tests."
    return
  fi

  echo "Found $scene_count agent scene(s)"

  mkdir -p "$OUTPUTS_DIR/recordings/stagehand"
  mkdir -p "$OUTPUTS_DIR/evals/stagehand"
  mkdir -p "$OUTPUTS_DIR/reports/stagehand"

  npx mimiq agent \
    --scenes "$agent_scenes_dir" \
    --runs $NUM_RUNS \
    --output "$OUTPUTS_DIR" \
    --framework stagehand \
    --headless || true

  echo "Agent tests complete."
}

# ============================================
# Generate GIFs from Recordings
# ============================================
generate_gifs() {
  if [ "$SKIP_GIFS" = true ]; then
    echo "Skipping GIF generation (--skip-gifs)"
    return
  fi

  echo ""
  echo "============================================"
  echo "Generating GIFs from Recordings"
  echo "============================================"

  cd "$SCRIPT_DIR"

  if ! command -v ffmpeg &> /dev/null; then
    echo "WARNING: ffmpeg not found, skipping GIF generation"
    echo "Install with: brew install ffmpeg"
    return
  fi

  # Generate GIF for each framework/scene/run
  for framework_dir in "$OUTPUTS_DIR/recordings"/*/; do
    if [ -d "$framework_dir" ]; then
      framework_name=$(basename "$framework_dir")

      for scene_dir in "$framework_dir"*/; do
        if [ -d "$scene_dir" ]; then
          scene_name=$(basename "$scene_dir")
          mkdir -p "$OUTPUTS_DIR/gifs/$framework_name/$scene_name"

          for run_dir in "$scene_dir"run-*/; do
            if [ -d "$run_dir/screenshots" ]; then
              run_name=$(basename "$run_dir")
              screenshot_count=$(ls -1 "$run_dir/screenshots"/*.png 2>/dev/null | wc -l | tr -d ' ')

              if [ "$screenshot_count" -gt 0 ]; then
                echo "Generating GIF for $framework_name/$scene_name/$run_name ($screenshot_count screenshots)..."

                ffmpeg -y -framerate 1 -pattern_type glob -i "$run_dir/screenshots/*.png" \
                  -vf "scale=800:-1:flags=lanczos" \
                  -loop 0 \
                  "$OUTPUTS_DIR/gifs/$framework_name/$scene_name/${run_name}.gif" 2>/dev/null || echo "  Failed to generate GIF"
              fi
            fi
          done
        fi
      done
    fi
  done

  echo "GIF generation complete."
  find "$OUTPUTS_DIR/gifs" -name "*.gif" -type f | head -30
}

# ============================================
# Run LayoutLens Evaluations
# ============================================
run_layoutlens_evals() {
  echo ""
  echo "============================================"
  echo "Running LayoutLens Visual Evaluations"
  echo "============================================"

  cd "$SCRIPT_DIR"

  # Run eval on each framework/scene/run
  for framework_dir in "$OUTPUTS_DIR/recordings"/*/; do
    if [ -d "$framework_dir" ]; then
      framework_name=$(basename "$framework_dir")
      mkdir -p "$OUTPUTS_DIR/evals/$framework_name"
      EVAL_FILE="$OUTPUTS_DIR/evals/$framework_name/visual-evals.json"
      echo '{"evaluations": []}' > "$EVAL_FILE"

      for scene_dir in "$framework_dir"*/; do
        if [ -d "$scene_dir" ]; then
          scene_name=$(basename "$scene_dir")

          for run_dir in "$scene_dir"run-*/; do
            if [ -d "$run_dir" ]; then
              run_name=$(basename "$run_dir")
              screenshots_dir="$run_dir/screenshots"

              if [ -d "$screenshots_dir" ] && [ "$(ls -A $screenshots_dir 2>/dev/null)" ]; then
                echo "Evaluating $framework_name/$scene_name/$run_name..."

                node --experimental-modules "$SCRIPT_DIR/eval-screenshots.mjs" \
                  "$scene_name" "$run_name" "$screenshots_dir" "$EVAL_FILE" 2>/dev/null || true
              fi
            fi
          done
        fi
      done
    fi
  done

  echo "LayoutLens evaluations complete."
}

# ============================================
# Generate Aggregate Report
# ============================================
generate_report() {
  echo ""
  echo "============================================"
  echo "Generating Aggregate Report"
  echo "============================================"

  cd "$SCRIPT_DIR"

  # Generate HTML report
  node --experimental-modules "$SCRIPT_DIR/generate-report.mjs" \
    "$OUTPUTS_DIR" 2>/dev/null || echo "Report generation skipped (script not found)"

  echo ""
  echo "============================================"
  echo "E2E Run Complete!"
  echo "============================================"
  echo ""
  echo "Outputs:"
  echo "  Recordings: $OUTPUTS_DIR/recordings/"
  echo "  GIFs:       $OUTPUTS_DIR/gifs/"
  echo "  Evals:      $OUTPUTS_DIR/evals/"
  echo "  Reports:    $OUTPUTS_DIR/reports/"
  echo ""

  # Summary by framework
  echo "Recording Summary:"
  for framework_dir in "$OUTPUTS_DIR/recordings"/*/; do
    if [ -d "$framework_dir" ]; then
      framework_name=$(basename "$framework_dir")
      echo "  $framework_name:"
      for scene_dir in "$framework_dir"*/; do
        if [ -d "$scene_dir" ]; then
          scene_name=$(basename "$scene_dir")
          run_count=$(ls -d "$scene_dir"run-* 2>/dev/null | wc -l | tr -d ' ')
          echo "    $scene_name: $run_count runs"
        fi
      done
    fi
  done
}

# ============================================
# Main
# ============================================

case "$ONLY" in
  playwright)
    run_playwright
    ;;
  cypress)
    run_cypress
    ;;
  stagehand)
    run_stagehand
    ;;
  agent)
    run_agent
    ;;
  "")
    # Run all
    run_playwright
    run_cypress
    run_stagehand
    run_agent
    generate_gifs
    run_layoutlens_evals
    generate_report
    ;;
  *)
    echo "Unknown test suite: $ONLY"
    echo "Options: playwright, cypress, stagehand, agent"
    exit 1
    ;;
esac

echo ""
echo "Done!"
