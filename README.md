# Cursor TODO Runner

Turn high-level feature definitions into **Agent-first TODOs**, then into **ordered execution steps** that the Cursor CLI runs one-by-one. A thinking model (chat) does design and breakdown; the runner executes steps without scope creep.

**Requirements:** Cursor CLI (`agent`), Node, `jq`. Run from the **project root** (the repo that contains `docs/TODO`).

---

## Process

```
  MODE        STEP                     HOW
────────────────────────────────────────────────────────────────────────────────

            ┌──────────────────┐
  Chat      │   Design / MVP   │       THINKING MODEL, RESOLVE QUESTIONS
  manual    └────────┬─────────┘
                     ▼
            ┌──────────────────┐       BREAKDOWN TO PHASES, RESOLVE QUESTIONS
  Chat      │ Feature Overview │       @templates/01-feature-overview.template
  manual    └────────┬─────────┘       → docs/design/active/*.md
                     ▼
            ┌──────────────────┐       BREAKDOWN TO TODOs, RESOLVE QUESTIONS
  Chat      │ Agent-first TODO │       @prompts/01-breakdown-to-todos.prompt
  manual    └────────┬─────────┘       → docs/TODO/active/P2_04_*.md
                     ▼
            ┌──────────────────┐       BREAKDOWN TO EXECUTION STEPS
  Chat      │  Ordered Steps   │       @prompts/02-generate-execution-steps.prompt
  manual    └────────┬─────────┘       → docs/TODO/active/steps/P2_04.05_*.md
                     ▼
            ┌──────────────────┐       EXECUTES STEPS ONE AT A TIME
  CLI       │   Runner Loop    │       bash run-steps.sh [OPTIONS]
  auto      └────────┬─────────┘       → docs/TODO/completed/
                     ▼
               ┌───────────┐
               │  Blocker? │──yes──▶   BACK TO CHAT TO RESOLVE
               └───────────┘
```

---

## Example: docs folder structure

```
docs/
├── design/
│   ├── active/
│   │   ├── 00_Development_Roadmap.md
│   │   ├── 02_Phase2_Map_Integration.md
│   │   └── 03_Phase3_Course_Definition.md
│   └── completed/
│       └── 01_Phase1_Foundation.md
│
└── TODO/
    ├── active/
    │   ├── P2_04_Offline_Region_Management.md      ← current TODO
    │   └── steps/
    │       ├── P2_04.05_download_failure_retry.md  ← pending steps
    │       ├── P2_04.06_concurrent_prevention.md
    │       └── P2_04.07_storage_accuracy.md
    │
    ├── completed/
    │   ├── P1_01_Flutter_Project_Init.md           ← done TODOs
    │   ├── P1_02_Dependencies_And_Analysis.md
    │   ├── P2_01_MapLibre_Flutter_Setup.md
    │   └── steps/
    │       ├── P1_01.01_environment_verification.md
    │       ├── P1_01.02_flutter_create.md
    │       └── P2_01.01_add_dependencies.md
    │
    ├── runner/
    │   ├── NEXT.md              ← auto-generated current step
    │   └── RUNNER_PROMPT.txt    ← auto-generated agent prompt
    │
    └── action_required/         ← blockers that pause the runner
```

**Naming:**
- TODOs: `P<phase>_<seq>_<Name>.md` → `P1_01_Flutter_Project_Init.md`
- Steps: `P<phase>_<seq>.<step>_<slug>.md` → `P1_01.02_flutter_create.md`

---

## Usage examples

```bash
# Run all pending steps continuously
run-steps.sh

# Run only one step, then exit
run-steps.sh --once

# Run exactly 5 steps, then exit
run-steps.sh --steps 5

# Run only steps for TODO P1_01 (Flutter Project Init)
run-steps.sh --phase P1_01

# Run 3 steps from phase P2_04 (Offline Region Management), with debug logging
run-steps.sh --phase P2_04 --steps 3 --debug

# Run phase P1_02 silently (no agent output)
run-steps.sh --phase P1_02 --quiet

# Run unattended (skip manual test pauses)
run-steps.sh --phase P2_01 --skip-manual

# Use a specific model
run-steps.sh --model claude-opus-4-5-20250514-thinking --phase P1_01

# Combine options
run-steps.sh --phase P2_04 --steps 2 --quiet --skip-manual
```

---

## Parameters

### run-steps.sh

| Option | Description |
|--------|-------------|
| `--once` | Run one step, then exit |
| `--steps N` | Run N steps, then exit |
| `--phase ID` | Only run steps matching `ID` (e.g. `P1_03`) |
| `--no-summary` | Skip execution summary when phase finishes |
| `--skip-manual` | Don't pause for manual testing; report in summary only |
| `--quiet` | Suppress agent stdout (runner prompts still shown) |
| `--debug` | Show agent stdout, log to `docs/TODO/runner/agent_output_*.log` |
| `--model MODEL` | Specify model (default: `auto`) |
| `[ROOT]` | Project root (default: current directory) |

**Env:** `CURSOR_TODO_QUIET=1` — same as `--quiet`

### Supported models

| Model | Notes |
|-------|-------|
| `auto` | Default — Cursor picks |
| `claude-opus-4-5-20250514` | High capability |
| `claude-opus-4-5-20250514-thinking` | Extended thinking |
| `claude-sonnet-4-20250514` | Fast and capable |
| `gpt-5.2` | OpenAI flagship |
| `gpt-5.2-mini` | Faster, lower cost |
| `gpt-4o` | Multimodal, fast |
| `gpt-4o-mini` | Lightweight |
| `gemini-2.5-pro` | Google flagship |
| `gemini-2.5-flash` | Speed optimized |

### next-step.mjs

| Option | Description |
|--------|-------------|
| `--phase ID` | Only consider steps matching `ID` |

---

## How to use

**From project root:**
```bash
node <runner-path>/bin/runner/next-step.mjs [--phase ID]
bash <runner-path>/bin/runner/run-steps.sh [OPTIONS] [ROOT]
```

**Runner elsewhere:** set `CURSOR_TODO_RUNNER_DIR`:
```bash
export CURSOR_TODO_RUNNER_DIR=~/.local/share/todo-runner
bash "$CURSOR_TODO_RUNNER_DIR/bin/runner/run-steps.sh"
```

---

## Other details

- **Layout:** Runner creates `docs/TODO/active/steps/`, `docs/TODO/completed/steps/`, `docs/TODO/completed/summaries/`, `docs/TODO/runner/`, and `docs/TODO/action_required/` if missing.
- **Step ordering:** Runner uses "Depends on" field and step id prefix for ordering.
- **Blockers:** Failed verification creates a file in `action_required/`. Runner pauses until removed.
- **Manual testing:** Steps requiring manual testing create files in `action_required/` with instructions. Use `--skip-manual` for unattended runs.
- **Prompts:** Execute prompt is `prompts/03-execute-single-step.prompt`. Output level controlled by `prompts/fragments/output-step-only.txt` (default) or `output-zero.txt` (`--quiet`).

---

## Runner project structure

| Path | Purpose |
|------|---------|
| `bin/runner/` | Main workflow: `run-steps.sh`, `next-step.mjs`, `accept-step.mjs`, `on-phase-done.mjs` |
| `bin/debug/` | Debug helpers: `debug-agent.mjs`, `debug-runner.mjs`, `debug-output.mjs` |
| `prompts/` | Cursor prompts (01–04) + `fragments/` for output levels |
| `templates/` | Feature overview and agent-first TODO templates |
