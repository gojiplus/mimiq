#!/bin/bash
#
# Mimiq Agent Test Runner
# Runs mimiq agent command against TechShop test app
#
# Usage:
#   ./run-agent.sh                           # Run all scenes in agent-scenes/
#   ./run-agent.sh ./agent-scenes/custom.yaml  # Run single scene
#   ./run-agent.sh ./agent-scenes/ 2         # Run all scenes 2 times each
#   HEADLESS=false ./run-agent.sh            # Run with visible browser

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SCENE=${1:-"./agent-scenes"}
RUNS=${2:-1}
OUTPUT="./outputs/agent-recordings"
HEADLESS=${HEADLESS:-true}

echo "============================================"
echo "Mimiq Agent Test Runner"
echo "============================================"
echo "Scene(s): $SCENE"
echo "Runs: $RUNS"
echo "Output: $OUTPUT"
echo "Headless: $HEADLESS"
echo ""

cd "$SCRIPT_DIR"

if [ -d "$SCENE" ]; then
  CMD="npx mimiq agent --scenes \"$SCENE\" --runs $RUNS --output \"$OUTPUT\""
else
  CMD="npx mimiq agent --scene \"$SCENE\" --runs $RUNS --output \"$OUTPUT\""
fi

if [ "$HEADLESS" = "true" ]; then
  CMD="$CMD --headless"
else
  CMD="$CMD --no-headless"
fi

echo "Running: $CMD"
echo ""

eval $CMD
