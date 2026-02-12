# Cursor TODO Runner

Turn high-level feature definitions into **Agent-first TODOs**, then into **ordered execution steps** that the Cursor CLI (Auto model) runs one-by-one. A thinking model (chat) does design and breakdown; the runner executes steps without scope creep.

**Requirements:** Cursor CLI (`agent`), Node, `jq`. Run from the **project root** (the repo that contains `docs/TODO`).

---

## Project structure

| Path | Purpose |
|------|--------|
| `bin/runner/` | Main workflow: `run-steps.sh`, `next-step.mjs`, `accept-step.mjs`, `generate-summary.mjs` |
| `bin/debug/` | Debug helpers (prefix `debug-`): `debug-agent.mjs`, `debug-runner.mjs`, `debug-output.mjs` |
| `prompts/` | Cursor prompts (01–04), kebab-case: `01-breakdown-high-level-plan.prompt`, `03-execute-single-step.prompt`, etc. |
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
**Quieter run (log only):** `run-steps.sh --quiet` or `CURSOR_TODO_QUIET=1 run-steps.sh`

---

## Parameters

### run-steps.sh

| Option | Description |
|--------|-------------|
| `--once` | Run at most one step, then exit. |
| `--steps N` | Run at most N steps, then exit. |
| `--phase ID` | Only run steps whose id starts with `ID` (e.g. `P1_03`). |
| `--skip_summary` / `--no-summary` | Skip summary generation at the end. |
| `--quiet` | Agent output only to `docs/TODO/runner/agent_output.log` (no stdout). Debug with `tail -f docs/TODO/runner/agent_output.log`. |
| `[ROOT]` | Project root; default is current directory. |

**Env:** `CURSOR_TODO_QUIET=1` — same as `--quiet`.

### next-step.mjs

| Option | Description |
|--------|-------------|
| `--phase ID` | Only consider steps whose id starts with `ID`. |

### generate-summary.mjs

| Option | Description |
|--------|-------------|
| `--todo ID` | Summary for one TODO (e.g. `P1_02`). |
| `--session` | Summaries for all TODOs touched this session. |
| `--outcome TYPE` | Force outcome: `SUCCESS`, `PARTIAL`, `BLOCKED`. |
| `--dry-run` | Show what would be generated, no writes. |

---

## Other details

- **Layout:** Project needs `docs/TODO/active/` (TODOs + `steps/`), `docs/TODO/completed/`, `docs/TODO/summaries/`, `docs/TODO/runner/`, `docs/TODO/action_required/`. Add `gitignore.example` contents to your `.gitignore`.
- **Step files:** In `docs/TODO/active/steps/`, names like `P1_03.1_slug.md`. Runner uses "Depends on" and step id prefix (e.g. `P1_03`) for ordering.
- **Blockers:** If the agent fails verification, it writes a file to `docs/TODO/action_required/`. The runner stops until that file is removed. Then run `node …/bin/runner/accept-step.mjs` if needed and re-run.
- **Summaries:** Generated automatically at end of run (or on interrupt). One file per TODO touched, in `docs/TODO/summaries/`.
- **Prompt source:** Execute prompt is `prompts/03-execute-single-step.prompt`; `next-step.mjs` writes `RUNNER_PROMPT.txt` with the step file @-mentioned.

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
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: Summary (automatic)                                                 │
│  generate-summary.mjs (prompt 04) → docs/TODO/summaries/*.summary.md         │
│  One per TODO touched; run at exit (or skip with --skip_summary)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Repo layout:** `bin/runner/` (run-steps.sh, next-step.mjs, accept-step.mjs, generate-summary.mjs), `bin/debug/` (debug-agent.mjs, debug-runner.mjs, debug-output.mjs), `templates/`, `prompts/`.
