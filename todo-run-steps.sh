#!/usr/bin/env bash
# Loop: resolve next step -> run Cursor CLI agent with fixed prompt -> repeat.
# Run from project root, or pass project root as first arg.
# Requires Cursor CLI: https://cursor.com/docs/cli/installation

set -e
RUNNER_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$(pwd)}"
cd "$ROOT"

export PATH="$HOME/.local/bin:$PATH"
if ! command -v agent &>/dev/null; then
  echo "Cursor CLI not found. Install: curl -fsSL https://cursor.com/install | bash"
  exit 127
fi

AGENT_LOG="$ROOT/docs/TODO/runner/agent_output.log"
while true; do
  if ! node "$RUNNER_DIR/todo-next-step.mjs"; then
    exit 0
  fi
  echo ""
  echo "Running Cursor agent for step (streaming to stdout and $AGENT_LOG) ..."
  agent -p --force --model auto \
    --output-format stream-json --stream-partial-output \
    "$(cat "$ROOT/docs/TODO/runner/RUNNER_PROMPT.txt")" 2>&1 | tee -a "$AGENT_LOG"
done
