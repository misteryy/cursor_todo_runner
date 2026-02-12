# Cursor TODO Runner

Decompose features into agent-executable steps. A thinking model designs and breaks down tasks with developer input, then the Cursor CLI executes each step sequentially—keeping scope tight and execution predictable.

**Requirements:** Cursor CLI (`agent`), Node, `jq`. Run from the **project root** (the repo that contains `docs/TODO`).

```bash
node <runner-path>/bin/runner/next-step.mjs [--phase ID]
bash <runner-path>/bin/runner/run-steps.sh [OPTIONS] [ROOT]
```

To run from elsewhere, set `CURSOR_TODO_RUNNER_DIR` to the runner install path.

---

## Process

```
            ┌──────────────────┐
  Chat      │   Design / MVP   │   Discuss with thinking model, resolve questions
  (manual)  └────────┬─────────┘
                     ▼
            ┌──────────────────┐
  Chat      │   Phase/Feature  │   Use prompts/01 to break down Design into Phases
  (manual)  └────────┬─────────┘   → docs/phase/active/*.md
                     ▼
            ┌──────────────────┐
  Chat      │ Agent-first TODO │   Use prompts/02 to break down Phase into TODOs
  (manual)  └────────┬─────────┘   → docs/TODO/active/P2_04_*.md
                     ▼
            ┌──────────────────┐
  Chat      │  Ordered Steps   │   Use prompts/03 to break down TODO into Steps
  (manual)  └────────┬─────────┘   → docs/TODO/active/steps/P2_04.05_*.md
                     ▼
            ┌──────────────────┐
  CLI       │   TODO Runner    │   Run: bash run-steps.sh [OPTIONS]
  (auto)    └────────┬─────────┘   → docs/TODO/completed/
                     ▼
               ┌───────────┐
               │  Blocker? │──yes──▶  Back to Chat to resolve
               └───────────┘
```

**What you do:** `prompts/01`, `prompts/02`, `prompts/03` are prompt files in this runner repo. In Cursor Chat you run each in order. During these manual phases, you will resolve any open questions before proceeding, so that scope is clear before execution.

- **00** — idea/MVP (your initial input)
- **01** — design → phases → `docs/phase/active/*.md`
- **02** — phase → Agent-first TODOs → `docs/TODO/active/*.md`
- **03** — TODO → ordered steps → `docs/TODO/active/steps/*.md`
- **Runner** — automated; uses `prompts/04` and the CLI to execute steps → `docs/TODO/completed/`

Prompts 01 and 02 use the templates in `templates/` for their output format.

---

## Docs layout

```
docs/
├── phase/
│   ├── active/
│   │   ├── P01_feature_Development_Roadmap.md
│   │   ├── P02_feature_Map_Integration.md
│   │   └── P03_feature_Course_Definition.md
│   └── completed/
│       └── P01_feature_Foundation.md
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

Naming: Phase docs `P<number:2d>_<type>_<Short_Name>.md` (type: feature | bugfix | chore | spike | refactor). TODOs `P<phase>_<seq>_<Name>.md`; steps `P<phase>_<seq>.<step>_<slug>.md`.

---

## Usage

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

See **Parameters** for all options.

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

**Env:** `CURSOR_TODO_QUIET=1` = `--quiet`

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

## Behavior

- **Layout:** Runner creates `docs/TODO/active/steps/`, `completed/steps/`, `completed/summaries/`, `runner/`, and `action_required/` if missing.
- **Ordering:** By "Depends on" and step id prefix.
- **Blockers:** Failed verification → file in `action_required/`; runner pauses until resolved.
- **Manual testing:** Manual steps write instructions to `action_required/`; use `--skip-manual` for unattended runs.
- **Execute prompt:** `prompts/04-execute-single-step.prompt`; output level via `prompts/fragments/output-step-only.txt` or `output-zero.txt` (`--quiet`).

---

## Runner layout

| Path | Purpose |
|------|---------|
| `bin/runner/` | `run-steps.sh`, `next-step.mjs`, `accept-step.mjs`, `on-phase-done.mjs` |
| `bin/debug/` | `debug-agent.mjs`, `debug-runner.mjs`, `debug-output.mjs` |
| `prompts/` | Prompts 01–04 + `fragments/` for output levels |
| `templates/` | Feature overview and agent-first TODO templates |
