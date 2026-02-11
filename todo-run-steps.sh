#!/usr/bin/env bash
# Loop: resolve next step -> run Cursor CLI agent with fixed prompt -> repeat.
# Run from project root, or pass project root as last arg.
# Requires Cursor CLI: https://cursor.com/docs/cli/installation
#
# Options:
#   --once           Run at most one step, then exit.
#   --steps N        Run at most N steps, then exit.
#   --phase ID       Only run steps whose id starts with ID (e.g. P1_03).
#   --skip_summary   Skip summary generation at the end.
#   --no-summary     Alias for --skip_summary.
#   [ROOT]           Project root (default: current directory).

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Use CURSOR_TODO_RUNNER_DIR if set and it contains required scripts; else use script dir if complete
REQUIRED="accept-step.mjs todo-next-step.mjs todo-generate-summary.mjs"
if [[ -n "${CURSOR_TODO_RUNNER_DIR:-}" ]]; then
  all_ok=1
  for f in $REQUIRED; do [[ -f "${CURSOR_TODO_RUNNER_DIR}/$f" ]] || all_ok=0; done
  [[ $all_ok -eq 1 ]] && RUNNER_DIR="$CURSOR_TODO_RUNNER_DIR"
fi
if [[ -z "${RUNNER_DIR:-}" ]]; then
  all_ok=1
  for f in $REQUIRED; do [[ -f "$SCRIPT_DIR/$f" ]] || all_ok=0; done
  [[ $all_ok -eq 1 ]] && RUNNER_DIR="$SCRIPT_DIR"
fi
if [[ -z "${RUNNER_DIR:-}" ]]; then
  echo "Runner scripts not found. Either copy the full cursor_todo_runner (including accept-step.mjs, todo-next-step.mjs, todo-generate-summary.mjs) into your project, or set CURSOR_TODO_RUNNER_DIR to the runner repo root."
  exit 127
fi

ONCE=""
STEPS=""
PHASE=""
ROOT=""
NO_SUMMARY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once)         ONCE=1; shift ;;
    --steps)        STEPS="$2"; shift 2 ;;
    --phase)        PHASE="$2"; shift 2 ;;
    --skip_summary) NO_SUMMARY=1; shift ;;
    --no-summary)   NO_SUMMARY=1; shift ;;
    *)              ROOT="$1"; shift ;;
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
RUNNER_PROMPT="$ROOT/docs/TODO/runner/RUNNER_PROMPT.txt"
SUMMARY_PROMPT="$ROOT/docs/TODO/runner/SUMMARY_PROMPT.txt"
SESSION_FILE="$ROOT/docs/TODO/runner/session_todos.json"
RUNS=0
SESSION_TODOS=()

# Track TODO IDs touched in this session
track_todo() {
  local step_file="$1"
  # Extract TODO ID from step filename (P1_02 from P1_02.03_something.md)
  local todo_id
  todo_id=$(basename "$step_file" | sed -n 's/^\(P[0-9]*_[0-9]*\)\.[0-9]*_.*/\1/p')
  if [[ -n "$todo_id" ]]; then
    # Add to array if not already present
    local found=0
    for t in "${SESSION_TODOS[@]}"; do
      [[ "$t" == "$todo_id" ]] && found=1 && break
    done
    [[ $found -eq 0 ]] && SESSION_TODOS+=("$todo_id")
  fi
}

# Save session TODOs to JSON file
save_session() {
  if [[ ${#SESSION_TODOS[@]} -gt 0 ]]; then
    local json_array
    json_array=$(printf '%s\n' "${SESSION_TODOS[@]}" | jq -R . | jq -s .)
    echo "{\"todos\": $json_array, \"timestamp\": \"$(date -Iseconds)\"}" > "$SESSION_FILE"
  fi
}

# Generate summary once per run, at exit; one summary file per phase (TODO) touched.
generate_summary() {
  if [[ -n "$NO_SUMMARY" ]]; then
    echo "Skipping summary generation (--skip_summary)."
    return
  fi
  if [[ ${#SESSION_TODOS[@]} -eq 0 ]]; then
    echo "No TODOs touched in this session; skipping summary."
    return
  fi

  save_session
  echo ""
  echo "=== Generating execution summary (once per run, one per phase touched) ==="

  for todo_id in "${SESSION_TODOS[@]}"; do
    echo "Generating summary for $todo_id..."
    if node "$RUNNER_DIR/todo-generate-summary.mjs" --todo "$todo_id"; then
      echo "Running Cursor agent to write summary..."
      agent -p --force --model auto \
        --output-format stream-json --stream-partial-output \
        "$(cat "$SUMMARY_PROMPT")" 2>&1 | tee -a "$AGENT_LOG"
    fi
  done

  # Clean up session file
  rm -f "$SESSION_FILE"
}

# Trap to generate summary on exit (normal or interrupted)
cleanup() {
  local exit_code=$?
  generate_summary
  exit $exit_code
}
trap cleanup EXIT

while true; do
  node "$RUNNER_DIR/todo-next-step.mjs" "${NEXT_ARGS[@]}"
  NEXT_EXIT=$?
  case "$NEXT_EXIT" in
    0) ;; # Next step written; proceed to run agent
    2) echo "No pending steps; stopping."
       exit 0 ;;
    1) echo "Step blocked or action required; resolve then re-run."
       echo "  If you just ran a step, the agent may not have moved it — from project root run: node $RUNNER_DIR/accept-step.mjs (or yarn todo:accept), then re-run."
       exit 1 ;;
    *) echo "todo-next-step.mjs exited with $NEXT_EXIT; stopping."
       exit "$NEXT_EXIT" ;;
  esac
  # Resolve step file path from RUNNER_PROMPT (line 1: "... @docs/TODO/active/steps/STEP.md")
  STEP_FILE="$ROOT/$(sed -n '1s/.* @\([^[:space:]]*\).*/\1/p' "$RUNNER_PROMPT")"
  if [[ -z "$STEP_FILE" || ! -f "$STEP_FILE" ]]; then
    echo "Step file missing or unreadable; stopping to avoid loop."
    exit 0
  fi

  # Track this TODO for summary generation
  track_todo "$STEP_FILE"

  echo ""
  echo "Running Cursor agent for step (streaming to stdout and $AGENT_LOG) ..."
  set +e
  agent -p --force --model auto \
    --output-format stream-json --stream-partial-output \
    "$(cat "$RUNNER_PROMPT")" 2>&1 | tee -a "$AGENT_LOG"
  set -e
  RUNS=$((RUNS + 1))

  # Move step to completed so next iteration can run the following step (agent may not have moved it).
  ACTION_REQUIRED_DIR="$ROOT/docs/TODO/action_required"
  if [[ ! -d "$ACTION_REQUIRED_DIR" || -z "$(find "$ACTION_REQUIRED_DIR" -maxdepth 1 -name '*.md' -print 2>/dev/null)" ]]; then
    if (cd "$ROOT" && node "$RUNNER_DIR/accept-step.mjs"); then
      echo "Step marked completed (accept-step)."
    fi
  fi

  [[ -n "$ONCE" ]] && exit 0
  if [[ -n "$STEPS" && "$RUNS" -ge "$STEPS" ]]; then
    echo "Reached --steps $STEPS; stopping."
    exit 0
  fi
done
