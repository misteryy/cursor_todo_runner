#!/usr/bin/env bash
# Loop: resolve next step -> run Cursor CLI agent with fixed prompt -> repeat.
# Run from project root, or pass project root as last arg.
# Requires Cursor CLI: https://cursor.com/docs/cli/installation
#
# Options:
#   --once          Run at most one step, then exit.
#   --steps N       Run at most N steps, then exit.
#   --phase ID      Only run steps whose id starts with ID (e.g. P1_03).
#   [ROOT]          Project root (default: current directory).

set -e
RUNNER_DIR="$(cd "$(dirname "$0")" && pwd)"

ONCE=""
STEPS=""
PHASE=""
ROOT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once)   ONCE=1; shift ;;
    --steps)  STEPS="$2"; shift 2 ;;
    --phase)  PHASE="$2"; shift 2 ;;
    *)        ROOT="$1"; shift ;;
  esac
done
ROOT="${ROOT:-$(pwd)}"
cd "$ROOT"

export PATH="$HOME/.local/bin:$PATH"
if ! command -v agent &>/dev/null; then
  echo "Cursor CLI not found. Install: curl -fsSL https://cursor.com/install | bash"
  exit 127
fi

NEXT_ARGS=()
[[ -n "$PHASE" ]] && NEXT_ARGS+=(--phase "$PHASE")

AGENT_LOG="$ROOT/docs/TODO/runner/agent_output.log"
RUNS=0
while true; do
  if ! node "$RUNNER_DIR/todo-next-step.mjs" "${NEXT_ARGS[@]}"; then
    exit 0
  fi
  echo ""
  echo "Running Cursor agent for step (streaming to stdout and $AGENT_LOG) ..."
  agent -p --force --model auto \
    --output-format stream-json --stream-partial-output \
    "$(cat "$ROOT/docs/TODO/runner/RUNNER_PROMPT.txt")" 2>&1 | tee -a "$AGENT_LOG"
  RUNS=$((RUNS + 1))
  [[ -n "$ONCE" ]] && exit 0
  if [[ -n "$STEPS" && "$RUNS" -ge "$STEPS" ]]; then
    echo "Reached --steps $STEPS; stopping."
    exit 0
  fi
done
