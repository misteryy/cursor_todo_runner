#!/usr/bin/env bash
# Loop: resolve next step -> run Cursor CLI agent with fixed prompt -> repeat.
# Run from project root, or pass project root as last arg.
# Requires Cursor CLI: https://cursor.com/docs/cli/installation
#
# Options:
#   --once           Run at most one step, then exit.
#   --steps N        Run at most N steps, then exit.
#   --phase ID       Only run steps whose id starts with ID (e.g. P1_03).
#   --model MODEL    Agent model to use (default: auto).
#   --no_summary     When phase finishes, do not generate execution summary (still move TODO to completed).
#   --skip_manual    Do not create action_required files for manual testing; only report in summary.
#   --quiet          Send agent stdout to /dev/null (runner prompts and alerts always on stdout).
#   --debug          Show agent stdout, log to timestamped file with run parameters.
#   [ROOT]           Project root (default: current directory).
#
# Default: step-only output fragment (agent states which task from step file). With --quiet: no-output fragment, agent stdout to /dev/null. Env: CURSOR_TODO_QUIET=1 same as --quiet.
#
# Exit codes: 0 = success (steps run and/or no steps left); 1 = action required / step blocked, or RUNNER_PROMPT missing; 127 = runner/CLI not found; other = next-step.mjs exit code.

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
MODEL="auto"
ROOT=""
NO_SUMMARY=""
SKIP_MANUAL=""
QUIET="${CURSOR_TODO_QUIET:-}"
DEBUG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once)         ONCE=1; shift ;;
    --steps)        STEPS="$2"; shift 2 ;;
    --phase)        PHASE="$2"; shift 2 ;;
    --model)        MODEL="$2"; shift 2 ;;
    --no_summary)   NO_SUMMARY=1; shift ;;
    --skip_manual)  SKIP_MANUAL=1; shift ;;
    --quiet)        QUIET=1; shift ;;
    --debug)        DEBUG=1; shift ;;
    *)              ROOT="$1"; shift ;;
  esac
done
ROOT="${ROOT:-$(pwd)}"
# Normalize to absolute path so shell and node (process.cwd()) agree on runner files
[[ -n "$ROOT" && "$ROOT" != /* ]] && ROOT="$(cd "$ROOT" && pwd)"
# If runner is in a subfolder (e.g. apps/backend/cursor_todo_runner), find project root by docs/TODO
if [[ ! -d "$ROOT/docs/TODO" ]]; then
  find_root="$ROOT"
  while [[ -n "$find_root" && "$find_root" != "/" ]]; do
    find_root="$(dirname "$find_root")"
    [[ -d "$find_root/docs/TODO" ]] && ROOT="$find_root" && break
  done
fi
cd "$ROOT"

export PATH="$HOME/.local/bin:$PATH"
if ! command -v agent &>/dev/null; then
  echo "Cursor CLI not found. Install: curl -fsSL https://cursor.com/install | bash"
  exit 127
fi

# Ensure full TODO layout exists (runner creates dirs it writes to; create the rest here)
mkdir -p "$ROOT/docs/TODO/active/steps"
mkdir -p "$ROOT/docs/TODO/completed/steps"
mkdir -p "$ROOT/docs/TODO/completed/summaries"
mkdir -p "$ROOT/docs/TODO/runner"
mkdir -p "$ROOT/docs/TODO/action_required"

NEXT_ARGS=()
[[ -n "$PHASE" ]] && NEXT_ARGS+=(--phase "$PHASE")
# No-output fragment only when --quiet
[[ -n "$QUIET" ]] && NEXT_ARGS+=(--quiet)
# Skip manual test blocking when --skip_manual
[[ -n "$SKIP_MANUAL" ]] && NEXT_ARGS+=(--skip_manual)

RUNNER_DIR_FILES="$ROOT/docs/TODO/runner"
if [[ -n "$DEBUG" ]]; then
  AGENT_LOG="$ROOT/docs/TODO/runner/agent_output_$(date +%Y%m%d-%H%M%S).log"
  {
    echo "run_timestamp=$(date -Iseconds)"
    echo "root=$ROOT"
    echo "phase=${PHASE:-}"
    echo "model=$MODEL"
    echo "once=${ONCE:-}"
    echo "steps=${STEPS:-}"
    echo "no_summary=${NO_SUMMARY:-}"
    echo "skip_manual=${SKIP_MANUAL:-}"
    echo "quiet=${QUIET:-}"
    echo "---"
  } >> "$AGENT_LOG"
fi
RUNNER_PROMPT="$RUNNER_DIR_FILES/RUNNER_PROMPT.txt"

# ─────────────────────────────────────────────────────────────────────────────
# beautify_stream: Process stream-json output for human-readable progress display
#
# Reads JSON lines from stdin and outputs:
#   - Spinner during thinking phases (TTY only)
#   - Tool names when tools start (e.g., "Reading file.dart...")
#   - Tool completion markers
#   - Assistant text output (the actual agent response)
#
# When output is a TTY: shows animated spinners with ANSI escape codes
# When output is a file: clean text without spinners or escape codes
#
# Usage: agent --output-format stream-json ... | beautify_stream
# ─────────────────────────────────────────────────────────────────────────────
beautify_stream() {
  local thinking_active=""
  local current_tool=""
  local current_tool_category=""
  local spinner_chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local spinner_idx=0
  local is_tty=""

  # Tool grouping state
  local group_category=""      # read, search, write, edit, shell, other
  local group_count=0
  local group_last_name=""     # Last tool name (for single-item display)

  # Assistant streaming state
  local assistant_streaming=""
  local assistant_newline_needed=""

  # Detect if stdout is a terminal
  [[ -t 1 ]] && is_tty=1

  # Clear current line helper (no-op when not a TTY)
  clear_line() {
    [[ -n "$is_tty" ]] && printf '\r\033[K'
  }

  # Flush accumulated tool group to output
  flush_group() {
    [[ $group_count -eq 0 ]] && return
    clear_line
    if [[ $group_count -eq 1 ]]; then
      printf '✓ %s\n' "$group_last_name"
    else
      case "$group_category" in
        read)   printf '✓ Read %d files\n' "$group_count" ;;
        search) printf '✓ %d searches\n' "$group_count" ;;
        write)  printf '✓ Wrote %d files\n' "$group_count" ;;
        edit)   printf '✓ Edited %d files\n' "$group_count" ;;
        *)      printf '✓ %d operations\n' "$group_count" ;;
      esac
    fi
    group_category=""
    group_count=0
    group_last_name=""
  }

  while IFS= read -r line; do
    # Skip empty lines or non-JSON
    [[ -z "$line" ]] && continue
    [[ "$line" != "{"* ]] && continue

    # Parse type and subtype
    local msg_type msg_subtype
    msg_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null) || continue
    msg_subtype=$(echo "$line" | jq -r '.subtype // empty' 2>/dev/null)

    case "$msg_type" in
      thinking)
        case "$msg_subtype" in
          delta)
            # Show spinner while thinking (TTY only)
            if [[ -z "$thinking_active" ]]; then
              thinking_active=1
            fi
            if [[ -n "$is_tty" ]]; then
              local char="${spinner_chars:$spinner_idx:1}"
              spinner_idx=$(( (spinner_idx + 1) % ${#spinner_chars} ))
              clear_line
              printf '%s Thinking...' "$char"
            fi
            ;;
          completed)
            if [[ -n "$thinking_active" ]]; then
              clear_line
              thinking_active=""
            fi
            ;;
        esac
        ;;

      tool_call)
        case "$msg_subtype" in
          started)
            # Extract tool name and category
            local tool_info tool_name tool_path tool_cmd tool_category
            tool_info=$(echo "$line" | jq -r '.tool_call // empty' 2>/dev/null)

            if echo "$tool_info" | grep -q 'readToolCall'; then
              tool_path=$(echo "$line" | jq -r '.tool_call.readToolCall.args.path // empty' 2>/dev/null)
              tool_name="Reading"
              [[ -n "$tool_path" ]] && tool_name="Reading $(basename "$tool_path")"
              tool_category="read"
            elif echo "$tool_info" | grep -q 'lsToolCall'; then
              tool_path=$(echo "$line" | jq -r '.tool_call.lsToolCall.args.path // empty' 2>/dev/null)
              tool_name="Listing"
              [[ -n "$tool_path" ]] && tool_name="Listing $(basename "$tool_path")"
              tool_category="read"
            elif echo "$tool_info" | grep -q 'shellToolCall'; then
              tool_cmd=$(echo "$line" | jq -r '.tool_call.shellToolCall.args.command // empty' 2>/dev/null)
              # Extract meaningful command: if "cd ... && cmd" or "cd ...; cmd", show just cmd
              if [[ "$tool_cmd" == cd\ * ]] && [[ "$tool_cmd" == *" && "* || "$tool_cmd" == *"; "* ]]; then
                # Remove everything up to and including && or ;
                tool_cmd="${tool_cmd#*&&}"
                tool_cmd="${tool_cmd#*;}"
                tool_cmd="${tool_cmd# }"  # trim leading space
              fi
              # Truncate if still too long
              [[ ${#tool_cmd} -gt 80 ]] && tool_cmd="${tool_cmd:0:77}..."
              tool_name="Running: $tool_cmd"
              tool_category="shell"  # Never group shell commands
            elif echo "$tool_info" | grep -q 'globToolCall'; then
              tool_name="Searching files"
              tool_category="search"
            elif echo "$tool_info" | grep -q 'grepToolCall'; then
              tool_name="Searching content"
              tool_category="search"
            elif echo "$tool_info" | grep -q 'writeToolCall'; then
              tool_path=$(echo "$line" | jq -r '.tool_call.writeToolCall.args.path // empty' 2>/dev/null)
              tool_name="Writing"
              [[ -n "$tool_path" ]] && tool_name="Writing $(basename "$tool_path")"
              tool_category="write"
            elif echo "$tool_info" | grep -q 'strReplaceToolCall'; then
              tool_path=$(echo "$line" | jq -r '.tool_call.strReplaceToolCall.args.path // empty' 2>/dev/null)
              tool_name="Editing"
              [[ -n "$tool_path" ]] && tool_name="Editing $(basename "$tool_path")"
              tool_category="edit"
            else
              # Generic tool name extraction
              tool_name=$(echo "$tool_info" | jq -r 'keys[0] // "tool"' 2>/dev/null | sed 's/ToolCall$//')
              tool_name="Using $tool_name"
              tool_category="other"
            fi

            current_tool="$tool_name"
            current_tool_category="$tool_category"
            clear_line
            if [[ -n "$is_tty" ]]; then
              printf '→ %s...' "$tool_name"
            fi
            ;;

          completed)
            # Extract tool info from completed event (handles parallel tools correctly)
            local completed_tool_info completed_tool_name completed_tool_path completed_tool_cmd completed_tool_category
            completed_tool_info=$(echo "$line" | jq -r '.tool_call // empty' 2>/dev/null)
            
            # Determine tool name and category from the completed event
            if echo "$completed_tool_info" | grep -q 'readToolCall'; then
              completed_tool_path=$(echo "$line" | jq -r '.tool_call.readToolCall.args.path // empty' 2>/dev/null)
              completed_tool_name="Reading"
              [[ -n "$completed_tool_path" ]] && completed_tool_name="Reading $(basename "$completed_tool_path")"
              completed_tool_category="read"
            elif echo "$completed_tool_info" | grep -q 'lsToolCall'; then
              completed_tool_path=$(echo "$line" | jq -r '.tool_call.lsToolCall.args.path // empty' 2>/dev/null)
              completed_tool_name="Listing"
              [[ -n "$completed_tool_path" ]] && completed_tool_name="Listing $(basename "$completed_tool_path")"
              completed_tool_category="read"
            elif echo "$completed_tool_info" | grep -q 'shellToolCall'; then
              completed_tool_cmd=$(echo "$line" | jq -r '.tool_call.shellToolCall.args.command // empty' 2>/dev/null)
              if [[ "$completed_tool_cmd" == cd\ * ]] && [[ "$completed_tool_cmd" == *" && "* || "$completed_tool_cmd" == *"; "* ]]; then
                completed_tool_cmd="${completed_tool_cmd#*&&}"
                completed_tool_cmd="${completed_tool_cmd#*;}"
                completed_tool_cmd="${completed_tool_cmd# }"
              fi
              [[ ${#completed_tool_cmd} -gt 80 ]] && completed_tool_cmd="${completed_tool_cmd:0:77}..."
              completed_tool_name="Running: $completed_tool_cmd"
              completed_tool_category="shell"
            elif echo "$completed_tool_info" | grep -q 'globToolCall'; then
              completed_tool_name="Searching files"
              completed_tool_category="search"
            elif echo "$completed_tool_info" | grep -q 'grepToolCall'; then
              completed_tool_name="Searching content"
              completed_tool_category="search"
            elif echo "$completed_tool_info" | grep -q 'writeToolCall'; then
              completed_tool_path=$(echo "$line" | jq -r '.tool_call.writeToolCall.args.path // empty' 2>/dev/null)
              completed_tool_name="Writing"
              [[ -n "$completed_tool_path" ]] && completed_tool_name="Writing $(basename "$completed_tool_path")"
              completed_tool_category="write"
            elif echo "$completed_tool_info" | grep -q 'strReplaceToolCall'; then
              completed_tool_path=$(echo "$line" | jq -r '.tool_call.strReplaceToolCall.args.path // empty' 2>/dev/null)
              completed_tool_name="Editing"
              [[ -n "$completed_tool_path" ]] && completed_tool_name="Editing $(basename "$completed_tool_path")"
              completed_tool_category="edit"
            else
              completed_tool_name=$(echo "$completed_tool_info" | jq -r 'keys[0] // "tool"' 2>/dev/null | sed 's/ToolCall$//')
              completed_tool_name="Using $completed_tool_name"
              completed_tool_category="other"
            fi

            # Check if we should group with previous or flush
            if [[ "$completed_tool_category" == "shell" ]]; then
              # Shell commands are never grouped - flush any pending group first
              flush_group
              clear_line
              printf '✓ %s\n' "$completed_tool_name"
            elif [[ -z "$group_category" ]]; then
              # Start new group
              group_category="$completed_tool_category"
              group_count=1
              group_last_name="$completed_tool_name"
            elif [[ "$group_category" == "$completed_tool_category" ]]; then
              # Add to existing group
              group_count=$((group_count + 1))
              group_last_name="$completed_tool_name"
            else
              # Different category - flush previous, start new
              flush_group
              group_category="$completed_tool_category"
              group_count=1
              group_last_name="$completed_tool_name"
            fi
            # Reset current tool display state (not needed for grouping anymore)
            current_tool=""
            current_tool_category=""
            ;;
        esac
        ;;

      assistant)
        # Flush any pending tool group before assistant output
        flush_group

        # Handle both streaming deltas and complete messages
        local text delta_text
        if [[ "$msg_subtype" == "delta" ]]; then
          # Streaming delta - print incrementally
          delta_text=$(echo "$line" | jq -r '.delta.text // empty' 2>/dev/null)
          if [[ -n "$delta_text" ]]; then
            if [[ -z "$assistant_streaming" ]]; then
              # First delta - ensure clean line, add visual separator
              [[ -n "$thinking_active" || -n "$current_tool" ]] && clear_line
              thinking_active=""
              printf '\n'
              assistant_streaming=1
            fi
            printf '%s' "$delta_text"
            assistant_newline_needed=1
          fi
        else
          # Complete message (legacy format or final)
          text=$(echo "$line" | jq -r '.message.content[0].text // empty' 2>/dev/null)
          if [[ -n "$text" ]]; then
            # Skip if text is only whitespace (newlines)
            local trimmed="${text//[$'\n\r\t ']}"
            if [[ -n "$trimmed" ]]; then
              # Only show if we weren't streaming (avoid duplicate)
              if [[ -z "$assistant_streaming" ]]; then
                [[ -n "$thinking_active" || -n "$current_tool" ]] && clear_line
                thinking_active=""
                # Print assistant text with clear visual separation
                printf '\n%s\n' "$text"
                assistant_newline_needed=""
              fi
            fi
          fi
          # Reset streaming state on complete message
          if [[ -n "$assistant_streaming" && -n "$assistant_newline_needed" ]]; then
            printf '\n'
            assistant_newline_needed=""
          fi
          assistant_streaming=""
        fi
        ;;

      system)
        # Optionally show session start
        if [[ "$msg_subtype" == "init" ]]; then
          local model
          model=$(echo "$line" | jq -r '.model // "auto"' 2>/dev/null)
          printf '⚡ Agent started (model: %s)\n' "$model"
        fi
        ;;
    esac
  done

  # Flush any remaining group
  flush_group

  # Ensure final newline
  [[ -n "$thinking_active" || -n "$current_tool" ]] && clear_line
  [[ -n "$assistant_newline_needed" ]] && printf '\n'
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# run_agent: Execute agent with consistent options, respecting DEBUG/QUIET
#
# Usage: run_agent "prompt content" ["log_label"]
# Sets: AGENT_EXIT (exit code of agent command)
# ─────────────────────────────────────────────────────────────────────────────
run_agent() {
  local prompt="$1"
  local log_label="${2:-}"

  AGENT_EXIT=0
  set +e

  if [[ -n "$DEBUG" ]]; then
    [[ -n "$log_label" ]] && echo "=== $log_label ===" >> "$AGENT_LOG"
    if [[ -n "$QUIET" ]]; then
      agent -p --force --model "$MODEL" \
        --output-format stream-json \
        "$prompt" >> "$AGENT_LOG" 2>&1
      AGENT_EXIT=$?
    else
      agent -p --force --model "$MODEL" \
        --output-format stream-json \
        "$prompt" 2>&1 | tee -a "$AGENT_LOG" | beautify_stream
      AGENT_EXIT=${PIPESTATUS[0]:-$?}
    fi
  else
    if [[ -n "$QUIET" ]]; then
      agent -p --force --model "$MODEL" \
        --output-format stream-json \
        "$prompt" > /dev/null 2>&1
      AGENT_EXIT=$?
    else
      agent -p --force --model "$MODEL" \
        --output-format stream-json \
        "$prompt" 2>&1 | beautify_stream
      AGENT_EXIT=$?
    fi
  fi

  set -e
}

# Phase finished: run on-phase-done, optional summary, then exit 0.
run_phase_done_and_exit() {
  ON_DONE_ARGS=()
  [[ -n "$PHASE" ]] && ON_DONE_ARGS+=(--phase "$PHASE")
  [[ -n "$NO_SUMMARY" ]] && ON_DONE_ARGS+=(--no_summary)
  node "$RUNNER_DIR/on-phase-done.mjs" "${ON_DONE_ARGS[@]}" 2>/dev/null || true
  if [[ -z "$NO_SUMMARY" && -r "$RUNNER_DIR_FILES/RUNNER_SUMMARY_PROMPT.txt" ]]; then
    echo "Generating execution summary (one per phase) ..."
    run_agent "$(cat "$RUNNER_DIR_FILES/RUNNER_SUMMARY_PROMPT.txt")" "summary"
    echo "Summary prompt consumed; see docs/TODO/completed/summaries/ for output."
  fi
  echo "No pending steps; stopping."
  exit 0
}

NEXT_FILE="$RUNNER_DIR_FILES/NEXT.md"
RUNS=0
ACTION_REQUIRED_DIR="$ROOT/docs/TODO/action_required"
ACTIVE_STEPS_DIR="$ROOT/docs/TODO/active/steps"
COMPLETED_STEPS_DIR="$ROOT/docs/TODO/completed/steps"

while true; do
  # Process resolved_* files: delete file and move corresponding step to completed (by step id in filename)
  if [[ -d "$ACTION_REQUIRED_DIR" ]]; then
    for resolved_file in "$ACTION_REQUIRED_DIR"/resolved_*.md; do
      [[ -f "$resolved_file" ]] || continue
      base=$(basename "$resolved_file" .md)
      # Match versioned step ID: P{phase}_{todo}.{step} where each can be dotted (e.g., P2.5_01.5.01)
      if [[ "$base" =~ ^resolved_(P[0-9]+(\.[0-9]+)*_[0-9]+(\.[0-9]+)*\.[0-9]+(\.[0-9]+)*)(_|$) ]]; then
        step_id="${BASH_REMATCH[1]}"
        for step_candidate in "$ACTIVE_STEPS_DIR"/${step_id}_*.md; do
          if [[ -f "$step_candidate" ]]; then
            step_basename=$(basename "$step_candidate")
            mkdir -p "$COMPLETED_STEPS_DIR"
            mv "$step_candidate" "$COMPLETED_STEPS_DIR/$step_basename"
            echo "Action resolved; moved step to completed: $step_basename"
            node "$RUNNER_DIR/on-step-completed.mjs" "$step_basename" 2>/dev/null || true
            break
          fi
        done
      fi
      echo "Action resolved; removing: $(basename "$resolved_file")"
      rm -f "$resolved_file"
    done
  fi

  node "$RUNNER_DIR/next-step.mjs" "${NEXT_ARGS[@]}"
  NEXT_EXIT=$?
  case "$NEXT_EXIT" in
    0) ;; # Next step written (NEXT.md present) or no steps left; check NEXT.md below
    2) # Legacy: no pending steps (older next-step.mjs)
       run_phase_done_and_exit ;;
    1) echo "Step blocked or action required; resolve then re-run."
       echo "  If you just ran a step, the agent may not have moved it — from project root run: node $RUNNER_DIR/accept-step.mjs (or yarn todo:accept), then re-run."
       exit 1 ;;
    *) echo "next-step.mjs exited with $NEXT_EXIT; stopping."
       exit "$NEXT_EXIT" ;;
  esac
  # When next-step exits 0 with no steps left it does not write NEXT.md. Treat that as phase finished.
  if [[ ! -r "$NEXT_FILE" ]]; then
    echo "No pending steps; phase finished."
    run_phase_done_and_exit
  fi
  # Resolve step file path and recommended model from NEXT.md (single source of truth written by next-step).
  # Using NEXT.md avoids depending on RUNNER_PROMPT format. Parsing is done with set +e so
  # sed/head never trigger set -e and cause a spurious exit 1 (e.g. from pipeline or missing file).
  set +e
  STEP_RAW=$(sed -n 's/.*\*\*Step file:\*\* `\([^`]*\)`.*/\1/p' "$NEXT_FILE" 2>/dev/null | head -1 | tr -d '\r')
  STEP_RECOMMENDED_MODEL=$(sed -n 's/.*\*\*Recommended model:\*\* `\([^`]*\)`.*/\1/p' "$NEXT_FILE" 2>/dev/null | head -1 | tr -d '\r')
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

  # Runner prompts and alerts always on stdout (even when --quiet)
  echo ""
  echo "Next step: $(basename "$STEP_FILE") (run $((RUNS + 1)))"
  echo "--- NEXT.md ($NEXT_FILE) ---"
  head -30 "$NEXT_FILE"
  echo "--- RUNNER_PROMPT ($RUNNER_PROMPT, first 15 lines) ---"
  head -15 "$RUNNER_PROMPT"
  echo "---"
  echo ""

  # Use recommended model for GUI steps if user didn't explicitly specify --model
  EFFECTIVE_MODEL="$MODEL"
  if [[ -n "$STEP_RECOMMENDED_MODEL" && "$MODEL" == "auto" ]]; then
    EFFECTIVE_MODEL="$STEP_RECOMMENDED_MODEL"
    echo "Using recommended model for GUI step: $EFFECTIVE_MODEL"
  fi

  if [[ -n "$DEBUG" && -n "$QUIET" ]]; then
    echo "Running Cursor agent for step (log only: $AGENT_LOG) ..."
  elif [[ -n "$DEBUG" ]]; then
    echo "Running Cursor agent for step (stdout + $AGENT_LOG) ..."
  else
    echo "Running Cursor agent for step ..."
  fi
  
  # Temporarily override MODEL for this step
  OLD_MODEL="$MODEL"
  MODEL="$EFFECTIVE_MODEL"
  run_agent "$(cat "$RUNNER_PROMPT")" "step $(basename "$STEP_FILE")"
  MODEL="$OLD_MODEL"
  STEP_AGENT_EXIT=$AGENT_EXIT
  echo "Step agent finished (exit code $STEP_AGENT_EXIT)."
  RUNS=$((RUNS + 1))

  # Runner owns step-file moves: move step to completed so next iteration can run the following step.
  # (We do not rely on the agent to move the file.)
  # Delete any resolved_* from this run (agent renamed take_action_* to resolved_*), then move step if no blockers left.
  if [[ -d "$ACTION_REQUIRED_DIR" ]]; then
    for resolved_file in "$ACTION_REQUIRED_DIR"/resolved_*.md; do
      [[ -f "$resolved_file" ]] && rm -f "$resolved_file" && echo "Action resolved by agent; removed: $(basename "$resolved_file")"
    done
  fi

  # Block on any .md in action_required except resolved_*
  HAS_ACTION_FILES=""
  if [[ -d "$ACTION_REQUIRED_DIR" ]]; then
    for f in "$ACTION_REQUIRED_DIR"/*.md; do
      [[ -f "$f" ]] || continue
      [[ "$(basename "$f")" == resolved_* ]] && continue
      HAS_ACTION_FILES=1
      break
    done
  fi
  if [[ -z "$HAS_ACTION_FILES" && -f "$STEP_FILE" ]]; then
    mkdir -p "$COMPLETED_STEPS_DIR"
    STEP_BASENAME="$(basename "$STEP_FILE")"
    DEST="$COMPLETED_STEPS_DIR/$STEP_BASENAME"
    mv "$STEP_FILE" "$DEST"
    sync 2>/dev/null || true
    sleep 2
    echo "Step marked completed (runner). Moved to: $DEST"
    node "$RUNNER_DIR/on-step-completed.mjs" "$STEP_BASENAME" 2>/dev/null || true
  fi

  # Check if phase is complete before exiting (for --once or --steps limit)
  check_phase_complete() {
    # Run next-step to see if there are pending steps
    node "$RUNNER_DIR/next-step.mjs" "${NEXT_ARGS[@]}" --dry-run 2>/dev/null
    local check_exit=$?
    if [[ "$check_exit" -eq 2 ]]; then
      echo "Phase finished (no pending steps)."
      ON_DONE_ARGS=()
      [[ -n "$PHASE" ]] && ON_DONE_ARGS+=(--phase "$PHASE")
      [[ -n "$NO_SUMMARY" ]] && ON_DONE_ARGS+=(--no_summary)
      node "$RUNNER_DIR/on-phase-done.mjs" "${ON_DONE_ARGS[@]}" 2>/dev/null || true
      if [[ -z "$NO_SUMMARY" && -r "$RUNNER_DIR_FILES/RUNNER_SUMMARY_PROMPT.txt" ]]; then
        echo "Generating execution summary ..."
        run_agent "$(cat "$RUNNER_DIR_FILES/RUNNER_SUMMARY_PROMPT.txt")" "summary"
        echo "Summary prompt consumed; see docs/TODO/completed/summaries/ for output."
      fi
    fi
  }

  if [[ -n "$ONCE" ]]; then
    check_phase_complete
    exit 0
  fi
  if [[ -n "$STEPS" && "$RUNS" -ge "$STEPS" ]]; then
    echo "Reached --steps $STEPS; stopping."
    check_phase_complete
    exit 0
  fi
done

echo "Runner loop ended normally."
exit 0
