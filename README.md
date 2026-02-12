# Cursor TODO Runner

Turn high-level feature definitions into **Agent-first TODOs**, then into **ordered execution steps** that the Cursor CLI (Auto model) runs one-by-one. A thinking model (chat) does design and breakdown; the runner executes steps without scope creep.

**Requirements:** Cursor CLI (`agent`), Node, `jq`. Run from the **project root** (the repo that contains `docs/TODO`).

---

## Project structure

| Path | Purpose |
|------|--------|
| `bin/runner/` | Main workflow: `run-steps.sh`, `next-step.mjs`, `accept-step.mjs`, `on-phase-done.mjs` |
| `bin/debug/` | Debug helpers (prefix `debug-`): `debug-agent.mjs`, `debug-runner.mjs`, `debug-output.mjs` |
| `prompts/` | Cursor prompts (01–04): breakdown, generate steps, execute single step (uses `fragments/` for output level), execution summary. Default: `output-step-only.txt` (output only when listing which task from the step file). With `--quiet`: `output-zero.txt`. Injected via `@OutputInstruction`. |
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
**Default:** Step-only output fragment (agent states which task from the step file it is working on, then minimal summary). Runner prompts and alerts on stdout.  
**Quiet:** `run-steps.sh --quiet` or `CURSOR_TODO_QUIET=1` — no-output fragment, agent stdout to /dev/null; runner prompts still printed.  
**Debug:** `run-steps.sh --debug` — visible agent stdout, timestamped log file with run parameters (root, phase, once, steps, etc.) and agent text output.

---

## Parameters

### run-steps.sh

| Option | Description |
|--------|-------------|
| `--once` | Run at most one step, then exit. |
| `--steps N` | Run at most N steps, then exit. |
| `--phase ID` | Only run steps whose id starts with `ID` (e.g. `P1_03`). |
| `--no-summary` | When phase finishes, do not generate execution summary (TODO is still moved to completed). |
| `--skip-manual` | Do not create `action_required/` files for manual testing; only report in summary. Useful for unattended runs. |
| `--quiet` | Send agent stdout to /dev/null. Runner prompts and alerts remain on stdout. |
| `--debug` | Use minimal output fragment, show agent stdout, log to `docs/TODO/runner/agent_output_YYYYMMDD-HHMMSS.log` with run parameters (run_timestamp, root, phase, once, steps, no_summary, skip_manual, quiet) at the top. |
| `[ROOT]` | Project root; default is current directory. |

**Env:** `CURSOR_TODO_QUIET=1` — same as `--quiet`.

### Supported Models

Use `--model MODEL` to specify which model the Cursor agent uses. Default is `auto`.

| Model | Notes |
|-------|-------|
| `auto` | Default. Cursor picks the best model for the task. |
| `claude-opus-4-5-20250514` | Claude Opus 4.5 — high capability, best for complex reasoning. |
| `claude-opus-4-5-20250514-thinking` | Claude Opus 4.5 with extended thinking — shows chain-of-thought. |
| `claude-sonnet-4-20250514` | Claude Sonnet 4 — fast and capable, good balance. |
| `gpt-5.2` | GPT-5.2 — OpenAI flagship model. |
| `gpt-5.2-mini` | GPT-5.2 Mini — faster, lower cost. |
| `gpt-4o` | GPT-4o — multimodal, fast responses. |
| `gpt-4o-mini` | GPT-4o Mini — lightweight, very fast. |
| `gemini-2.5-pro` | Gemini 2.5 Pro — Google's flagship. |
| `gemini-2.5-flash` | Gemini 2.5 Flash — optimized for speed. |

**Examples:**
```bash
run-steps.sh --model claude-opus-4-5-20250514-thinking --phase P1_03
run-steps.sh --model gpt-4o-mini --steps 5
```

**Note:** Model availability depends on your Cursor subscription. Use `cursor models` or check Cursor settings to see available models.

### next-step.mjs

| Option | Description |
|--------|-------------|
| `--phase ID` | Only consider steps whose id starts with `ID`. |

---

## Other details

- **Layout:** Runner creates `docs/TODO/active/steps/`, `docs/TODO/completed/steps/`, `docs/TODO/completed/summaries/`, `docs/TODO/runner/`, and `docs/TODO/action_required/` if missing. Add `gitignore.example` contents to your `.gitignore`.
- **Step files:** In `docs/TODO/active/steps/`, names like `P1_03.1_slug.md`. Runner uses "Depends on" and step id prefix (e.g. `P1_03`) for ordering.
- **Blockers:** If the agent fails verification, it writes a file to `docs/TODO/action_required/`. The runner stops until that file is removed. Then run `node …/bin/runner/accept-step.mjs` if needed and re-run.
- **Manual testing:** By default, if a step requires manual testing (UI verification, user interaction), the agent creates a file in `docs/TODO/action_required/` with instructions. The runner pauses until you complete testing and remove the file. Use `--skip-manual` to disable this and only report manual tests in the summary.
- **Prompt source:** Execute prompt is `prompts/03-execute-single-step.prompt` (placeholder `@OutputInstruction` is replaced by `prompts/fragments/output-step-only.txt` by default or `output-zero.txt` when `--quiet`). `next-step.mjs` writes `NEXT.md` and `RUNNER_PROMPT.txt`. Runner always echoes NEXT.md and the start of RUNNER_PROMPT.txt before each agent run (even with `--quiet`).

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
