#!/usr/bin/env bash
# Loop: resolve next step -> run Cursor CLI agent with fixed prompt -> repeat.
# Run from project root, or pass project root as last arg.
# Requires Cursor CLI: https://cursor.com/docs/cli/installation
#
# Options:
#   --once           Run at most one step, then exit.
#   --steps N        Run at most N steps, then exit.
#   --phase ID       Only run steps whose id starts with ID (e.g. P1_03).
#   --no-summary     When phase finishes, do not generate execution summary (still move TODO to completed).
#   --quiet          Send agent output only to agent_output.log (no stdout). Use for faster/quieter runs; debug with: tail -f docs/TODO/runner/agent_output.log
#   [ROOT]           Project root (default: current directory).
#
# Env: CURSOR_TODO_QUIET=1 same effect as --quiet.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Use CURSOR_TODO_RUNNER_DIR if set (prefer bin/ then root); else use script dir if complete
REQUIRED="accept-step.mjs next-step.mjs"
if [[ -n "${CURSOR_TODO_RUNNER_DIR:-}" ]]; then
  all_ok=1
  for f in $REQUIRED; do [[ -f "${CURSOR_TODO_RUNNER_DIR}/bin/runner/$f" ]] || all_ok=0; done
  [[ $all_ok -eq 1 ]] && RUNNER_DIR="${CURSOR_TODO_RUNNER_DIR}/bin/runner"
fi
if [[ -z "${RUNNER_DIR:-}" ]] && [[ -n "${CURSOR_TODO_RUNNER_DIR:-}" ]]; then
  all_ok=1
  for f in $REQUIRED; do [[ -f "${CURSOR_TODO_RUNNER_DIR}/bin/$f" ]] || all_ok=0; done
  [[ $all_ok -eq 1 ]] && RUNNER_DIR="${CURSOR_TODO_RUNNER_DIR}/bin"
fi
if [[ -z "${RUNNER_DIR:-}" ]] && [[ -n "${CURSOR_TODO_RUNNER_DIR:-}" ]]; then
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
  echo "Runner scripts not found. Either copy the full cursor_todo_runner (including bin/runner/) into your project, or set CURSOR_TODO_RUNNER_DIR to the runner repo root."
  exit 127
fi

ONCE=""
STEPS=""
PHASE=""
ROOT=""
NO_SUMMARY=""
QUIET="${CURSOR_TODO_QUIET:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once)         ONCE=1; shift ;;
    --steps)        STEPS="$2"; shift 2 ;;
    --phase)        PHASE="$2"; shift 2 ;;
    --no-summary)   NO_SUMMARY=1; shift ;;
    --quiet)        QUIET=1; shift ;;
    *)              ROOT="$1"; shift ;;
  esac
done
ROOT="${ROOT:-$(pwd)}"
# Normalize to absolute path so shell and node (process.cwd()) agree on runner files
[[ -n "$ROOT" && "$ROOT" != /* ]] && ROOT="$(cd "$ROOT" && pwd)"
cd "$ROOT"

export PATH="$HOME/.local/bin:$PATH"
if ! command -v agent &>/dev/null; then
  echo "Cursor CLI not found. Install: curl -fsSL https://cursor.com/install | bash"
  exit 127
fi

NEXT_ARGS=()
[[ -n "$PHASE" ]] && NEXT_ARGS+=(--phase "$PHASE")

AGENT_LOG="$ROOT/docs/TODO/runner/agent_output.log"
RUNNER_DIR_FILES="$ROOT/docs/TODO/runner"
RUNNER_PROMPT="$RUNNER_DIR_FILES/RUNNER_PROMPT.txt"
NEXT_FILE="$RUNNER_DIR_FILES/NEXT.md"
RUNS=0

while true; do
  node "$RUNNER_DIR/next-step.mjs" "${NEXT_ARGS[@]}"
  NEXT_EXIT=$?
  case "$NEXT_EXIT" in
    0) ;; # Next step written; proceed to run agent
    2) # Phase/TODO finished: move TODO to completed (if needed), then generate execution summary once (unless --no-summary)
       ON_DONE_ARGS=()
       [[ -n "$PHASE" ]] && ON_DONE_ARGS+=(--phase "$PHASE")
       [[ -n "$NO_SUMMARY" ]] && ON_DONE_ARGS+=(--no-summary)
       node "$RUNNER_DIR/on-phase-done.mjs" "${ON_DONE_ARGS[@]}" 2>/dev/null || true
       if [[ -z "$NO_SUMMARY" && -r "$RUNNER_DIR_FILES/RUNNER_SUMMARY_PROMPT.txt" ]]; then
         echo "Generating execution summary (one per phase) ..."
         set +e
         if [[ -n "$QUIET" ]]; then
           agent -p --force --model auto \
             --output-format stream-json --stream-partial-output \
             "$(cat "$RUNNER_DIR_FILES/RUNNER_SUMMARY_PROMPT.txt")" >> "$AGENT_LOG" 2>&1
         else
           agent -p --force --model auto \
             --output-format stream-json --stream-partial-output \
             "$(cat "$RUNNER_DIR_FILES/RUNNER_SUMMARY_PROMPT.txt")" 2>&1 | tee -a "$AGENT_LOG"
         fi
         set -e
         echo "Summary prompt consumed; see docs/TODO/completed/summaries/ for output."
       fi
       echo "No pending steps; stopping."
       exit 0 ;;
    1) echo "Step blocked or action required; resolve then re-run."
       echo "  If you just ran a step, the agent may not have moved it — from project root run: node $RUNNER_DIR/accept-step.mjs (or yarn todo:accept), then re-run."
       exit 1 ;;
    *) echo "next-step.mjs exited with $NEXT_EXIT; stopping."
       exit "$NEXT_EXIT" ;;
  esac
  # Resolve step file path from NEXT.md (single source of truth written by next-step).
  # Using NEXT.md avoids depending on RUNNER_PROMPT format. Parsing is done with set +e so
  # sed/head never trigger set -e and cause a spurious exit 1 (e.g. from pipeline or missing file).
  if [[ ! -r "$NEXT_FILE" ]]; then
    echo "NEXT.md missing or unreadable: $NEXT_FILE (next-step should have written it); stopping."
    exit 1
  fi
  set +e
  STEP_RAW=$(sed -n 's/.*\*\*Step file:\*\* `\([^`]*\)`.*/\1/p' "$NEXT_FILE" 2>/dev/null | head -1 | tr -d '\r')
  set -e
  STEP_FILE="$ROOT/${STEP_RAW:-}"
  if [[ -z "$STEP_RAW" || -z "$STEP_FILE" || "$STEP_FILE" == "$ROOT/" || "$STEP_FILE" == "${ROOT}/" ]]; then
    echo "Step file path empty (NEXT.md may not match expected pattern); stopping to avoid loop."
    exit 0
  fi
  if [[ ! -f "$STEP_FILE" ]]; then
    echo "Step file missing or unreadable: $STEP_FILE"
    echo "  (NEXT.md was just written by next-step; file should be in docs/TODO/active/steps/.)"
    exit 0
  fi
  if [[ ! -r "$RUNNER_PROMPT" ]]; then
    echo "RUNNER_PROMPT missing or unreadable: $RUNNER_PROMPT (needed for agent prompt); stopping."
    exit 1
  fi

  # Debug: show what NEXT.md and RUNNER_PROMPT contain (when not --quiet)
  if [[ -z "$QUIET" ]]; then
    echo ""
    echo "--- NEXT.md ($NEXT_FILE) ---"
    head -30 "$NEXT_FILE"
    echo "--- RUNNER_PROMPT ($RUNNER_PROMPT, first 15 lines) ---"
    head -15 "$RUNNER_PROMPT"
    echo "---"
    echo ""
  fi

  if [[ -n "$QUIET" ]]; then
    echo "Running Cursor agent for step (log only: $AGENT_LOG) ..."
    set +e
    agent -p --force --model auto \
      --output-format stream-json --stream-partial-output \
      "$(cat "$RUNNER_PROMPT")" >> "$AGENT_LOG" 2>&1
    STEP_AGENT_EXIT=$?
    set -e
  else
    echo "Running Cursor agent for step (streaming to stdout and $AGENT_LOG) ..."
    set +e
    agent -p --force --model auto \
      --output-format stream-json --stream-partial-output \
      "$(cat "$RUNNER_PROMPT")" 2>&1 | tee -a "$AGENT_LOG"
    STEP_AGENT_EXIT=${PIPESTATUS[0]:-$?}
    set -e
  fi
  echo "Step agent finished (exit code $STEP_AGENT_EXIT)."
  RUNS=$((RUNS + 1))

  # Runner owns step-file moves: move step to completed so next iteration can run the following step.
  # (We do not rely on the agent to move the file.)
  ACTION_REQUIRED_DIR="$ROOT/docs/TODO/action_required"
  HAS_ACTION_FILES=""
  if [[ -d "$ACTION_REQUIRED_DIR" ]]; then
    HAS_ACTION_FILES=$(find "$ACTION_REQUIRED_DIR" -maxdepth 1 -name '*.md' -print 2>/dev/null || true)
  fi
  if [[ -z "$HAS_ACTION_FILES" && -f "$STEP_FILE" ]]; then
    COMPLETED_STEPS_DIR="$ROOT/docs/TODO/completed/steps"
    mkdir -p "$COMPLETED_STEPS_DIR"
    DEST="$COMPLETED_STEPS_DIR/$(basename "$STEP_FILE")"
    mv "$STEP_FILE" "$DEST"
    sync 2>/dev/null || true
    sleep 2
    echo "Step marked completed (runner). Moved to: $DEST"
  fi

  if [[ -n "$ONCE" ]]; then
    exit 0
  fi
  if [[ -n "$STEPS" && "$RUNS" -ge "$STEPS" ]]; then
    echo "Reached --steps $STEPS; stopping."
    exit 0
  fi
done

echo "Runner loop ended normally."
exit 0
