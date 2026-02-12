# Cursor TODO Runner

Turn high-level feature definitions into **Agent-first TODOs**, then into **ordered execution steps** that the Cursor CLI (Auto model) runs one-by-one. A thinking model (chat) does design and breakdown; the runner executes steps without scope creep.

**Requirements:** Cursor CLI (`agent`), Node, `jq`. Run from the **project root** (the repo that contains `docs/TODO`).

---

## Project structure

| Path | Purpose |
|------|--------|
| `bin/runner/` | Main workflow: `run-steps.sh`, `next-step.mjs`, `accept-step.mjs`, `on-phase-done.mjs` |
| `bin/debug/` | Debug helpers (prefix `debug-`): `debug-agent.mjs`, `debug-runner.mjs`, `debug-output.mjs` |
| `prompts/` | Cursor prompts (01–04): breakdown, generate steps, execute single step (uses `fragments/` for output level), execution summary. `fragments/output-minimal.txt` and `output-zero.txt` are injected into the execute prompt via `@OutputInstruction`. |
| `templates/` | Feature overview and agent-first TODO templates: `01-feature-overview.template`, `02-agent-first-todo.template` |

---

## How to use

**Runner in project:** from project root:
```bash
node <runner-path>/bin/runner/next-step.mjs [--phase ID]   # resolve next step
bash <runner-path>/bin/runner/run-steps.sh [OPTIONS] [ROOT]   # run steps in a loop
```

**Runner elsewhere:** set `CURSOR_TODO_RUNNER_DIR` to the runner repo root, then:
```bash
export CURSOR_TODO_RUNNER_DIR=~/.local/share/todo-runner
bash "$CURSOR_TODO_RUNNER_DIR/bin/runner/run-steps.sh"
```

**One step only:** `run-steps.sh --once`  
**N steps:** `run-steps.sh --steps N`  
**One phase/todo:** `run-steps.sh --phase P1_03`  
**Skip execution summary when phase finishes:** `run-steps.sh --no-summary`  
**Quieter run (mute agent stdout):** `run-steps.sh --quiet` or `CURSOR_TODO_QUIET=1 run-steps.sh`  
**Log agent output to file (for debugging):** `run-steps.sh --debug` — writes to `docs/TODO/runner/agent_output.log`; use with `debug-agent.mjs` etc.

---

## Parameters

### run-steps.sh

| Option | Description |
|--------|-------------|
| `--once` | Run at most one step, then exit. |
| `--steps N` | Run at most N steps, then exit. |
| `--phase ID` | Only run steps whose id starts with `ID` (e.g. `P1_03`). |
| `--no-summary` | When phase finishes, do not generate execution summary (TODO is still moved to completed). |
| `--quiet` | Mute agent stdout (output discarded unless `--debug`). Summary still runs unless you pass `--no-summary`. |
| `--debug` | Log agent output to `docs/TODO/runner/agent_output.log` (and to stdout when not `--quiet`). Use with `debug-agent.mjs` etc. When not set, no log file is written. |
| `[ROOT]` | Project root; default is current directory. |

**Env:** `CURSOR_TODO_QUIET=1` — same as `--quiet`.

### next-step.mjs

| Option | Description |
|--------|-------------|
| `--phase ID` | Only consider steps whose id starts with `ID`. |

---

## Other details

- **Layout:** Runner creates `docs/TODO/active/steps/`, `docs/TODO/completed/steps/`, `docs/TODO/completed/summaries/`, `docs/TODO/runner/`, and `docs/TODO/action_required/` if missing. Add `gitignore.example` contents to your `.gitignore`.
- **Step files:** In `docs/TODO/active/steps/`, names like `P1_03.1_slug.md`. Runner uses "Depends on" and step id prefix (e.g. `P1_03`) for ordering.
- **Blockers:** If the agent fails verification, it writes a file to `docs/TODO/action_required/`. The runner stops until that file is removed. Then run `node …/bin/runner/accept-step.mjs` if needed and re-run.
- **Prompt source:** Execute prompt is `prompts/03-execute-single-step.prompt` (placeholder `@OutputInstruction` is replaced by `prompts/fragments/output-minimal.txt` or `output-zero.txt` when `--quiet`). `next-step.mjs` writes `NEXT.md` and `RUNNER_PROMPT.txt`. When not using `--quiet`, run-steps.sh echoes NEXT.md and the start of RUNNER_PROMPT.txt before each agent run for debugging.

---

## Process: how it’s stitched together

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  THINKING MODEL (Chat)                                                       │
│  Conversation → MVP/Design → feature overview(s)                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: Feature overview (template 01)                                     │
│  Output: e.g. docs/overviews/<feature>.md                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: Overview → Agent-first TODOs (prompt 01 + template 02)             │
│  Output: docs/TODO/active/*.md (one TODO per coherent problem)              │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: TODO → ordered steps (prompt 02)                                   │
│  Output: docs/TODO/active/steps/P1_XX.Y_slug.md                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: Execute steps (runner loop)                                        │
│  next-step.mjs → writes NEXT.md + RUNNER_PROMPT.txt                          │
│  run-steps.sh → agent -p … "$(cat RUNNER_PROMPT.txt)" (prompt 03)            │
│  On success: accept-step.mjs moves step to completed/                        │
│  Loop until no pending steps or --once / --steps limit                       │
│  When no pending steps: on-phase-done.mjs moves TODO to completed (if needed),│
│  then one execution summary per phase → docs/TODO/completed/summaries/       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Repo layout:** `bin/runner/` (run-steps.sh, next-step.mjs, accept-step.mjs), `bin/debug/` (debug-agent.mjs, debug-runner.mjs, debug-output.mjs), `templates/`, `prompts/`.
