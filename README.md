# Cursor TODO Runner — Agentic Flow

A portable toolkit for turning **high-level product/feature definitions** into **Agent-first TODOs**, then into **small, ordered execution steps** that the Cursor **Auto** model can run one-by-one. Thinking-model AI (e.g. in chat) drives design and breakdown; the Auto runner executes steps without scope creep.

---

## High-Level Overview of the Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  THINKING MODEL (Chat / Design)                                              │
│  Conversation → MVP or Design → One or more phases/features                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: Feature / phase high-level definition                              │
│  Template: templates/00_Feature_Overview.template                            │
│  Output:   Feature overview doc (e.g. docs/overviews/ or project location)  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: Break down overview → Agent-first TODOs                           │
│  Prompt:   prompts/02_Breakdown_High-Level_Plan.prompt                      │
│  Template: templates/01_Agent-First_TODO.template (per TODO)                │
│  Output:   3–5 TODOs in docs/TODO/active/                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: Break down each TODO → ordered steps                              │
│  Prompt:   prompts/03_Generate_Execution_Steps.prompt                       │
│  Output:   Step files in docs/TODO/active/steps/ (~1 hr each, testable)      │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: Execute steps (Auto runner)                                       │
│  Scripts:  todo-next-step.mjs  →  todo-run-steps.sh                          │
│  Model:    Auto (Cursor CLI)                                                │
│  Prompt:   prompts/04_Execute_Single_Step.prompt (injected with @StepFile)  │
│  Output:   Code + tests; steps/TODOs moved to docs/TODO/completed/           │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Phases/features** can be multiple; they come from the thinking-model conversation (MVP or Design).
- Each **phase/feature** is captured with the **Feature Overview** template.
- Each **overview** is decomposed into **Agent-first TODOs** (one coherent problem per TODO).
- Each **TODO** is decomposed into **simple, ordered steps** that Auto can implement and verify in ~1 hour each.
- The **Auto runner** resolves the next ready step (respecting “Depends on”), runs the agent with the step prompt, and repeats.

---

## Repo Layout (this toolkit)

```
cursor_todo_runner/
├── README.md                    # This file
├── templates/
│   ├── 00_Feature_Overview.template   # Phase/feature high-level definition
│   └── 01_Agent-First_TODO.template   # Single TODO spec (agent-executable)
├── prompts/
│   ├── 02_Breakdown_High-Level_Plan.prompt   # Overview → TODOs
│   ├── 03_Generate_Execution_Steps.prompt    # TODO → step files
│   └── 04_Execute_Single_Step.prompt         # Run one step (used by runner)
├── todo-next-step.mjs           # Resolves next step, writes runner/NEXT.md + RUNNER_PROMPT.txt
└── todo-run-steps.sh            # Loop: next step → Cursor CLI (auto) → repeat
```

---

## Consumer Project Layout (where you run the flow)

Use a `docs/TODO` structure in the project that uses this flow:

```
<project_root>/
├── docs/
│   ├── TODO/
│   │   ├── active/              # Current TODOs and steps
│   │   │   ├── *.md             # Agent-first TODO files
│   │   │   └── steps/           # Step files (e.g. P1_15.1_slug.md)
│   │   ├── completed/           # Done
│   │   │   ├── *.md
│   │   │   └── steps/
│   │   ├── runner/              # Written by todo-next-step.mjs
│   │   │   ├── NEXT.md
│   │   │   ├── RUNNER_PROMPT.txt
│   │   │   └── agent_output.log
│   │   └── action_required/     # If any file here, runner stops until resolved
│   └── overviews/               # Optional: store feature overviews here
```

---

## Phases in Detail

### 1. Feature / phase high-level definition

- **Who:** You + thinking model (chat).
- **Input:** Conversation that produced an MVP or Design; can span multiple phases/features.
- **Template:** `templates/00_Feature_Overview.template`.
- **Output:** One overview doc per phase/feature (problem, goals, non-goals, constraints, risks, open questions). Save where you like (e.g. `docs/overviews/<feature>.md`).
- **Next:** Use that overview as input to the breakdown prompt.

### 2. Overview → Agent-first TODOs

- **Prompt:** `prompts/02_Breakdown_High-Level_Plan.prompt`.
- **In chat:** @-mention the overview file as `@HighLevelTemplate` and the template `@templates/01_Agent-First_TODO.template` (or copy into project and @ that path).
- **Output:** 3–5 TODOs in `docs/TODO/active/`, each following the Agent-First TODO template (one coherent problem each, invariants and constraints preserved).

### 3. TODO → ordered steps

- **Prompt:** `prompts/03_Generate_Execution_Steps.prompt`.
- **In chat:** @-mention one TODO from `docs/TODO/active/` as `@AgentFirstTODO`.
- **Output:** One markdown file per step in `docs/TODO/active/steps/`, with:
  - Step number and title  
  - Goal  
  - Depends on (step id or “none”)  
  - Concrete tasks  
  - “How to verify” (runnable commands; linter only for touched files)  
  - Estimated duration (~1 hr or less)

Step filenames: use a consistent id prefix so the runner can sort and resolve dependencies (e.g. `P1_15.1_slug.md`). The runner’s `todo-next-step.mjs` expects step ids like `P<phase>_<todo>.<step>` at the start of the filename.

### 4. Execute steps (Auto runner)

- **Scripts:** Run from **project root** (the repo that contains `docs/TODO`):
  - `node <path-to-runner>/todo-next-step.mjs [--phase ID]` — resolves next step, writes `docs/TODO/runner/NEXT.md` and `RUNNER_PROMPT.txt`. Option `--phase ID` limits to steps whose id starts with `ID` (e.g. `P1_03` for steps `P1_03.1`, `P1_03.2`, …).
  - `bash <path-to-runner>/todo-run-steps.sh [OPTIONS] [ROOT]` — loop: resolve next → run Cursor CLI with that prompt → repeat. See **CLI options** below.
- **Model:** Cursor CLI with `--model auto` (steps are sized for Auto).
- **Prompt:** Effectively `prompts/04_Execute_Single_Step.prompt` with the current step file @-mentioned as `@StepFile` (injected into `RUNNER_PROMPT.txt`).
- **Rules:** Implement only that step; run “How to verify”; on success, move the step file to `docs/TODO/completed/steps/`; if it’s the last step for a TODO, move that TODO to `docs/TODO/completed/`. No git commit.

---

## TODOs and Steps Created by AI Prompts

| What                | Created by                                      | Where it lives              |
|---------------------|--------------------------------------------------|-----------------------------|
| Feature overview    | You + thinking model, using overview template   | e.g. `docs/overviews/`      |
| Agent-first TODOs   | `02_Breakdown_High-Level_Plan.prompt`           | `docs/TODO/active/`         |
| Step files          | `03_Generate_Execution_Steps.prompt`            | `docs/TODO/active/steps/`   |
| Execution           | `04_Execute_Single_Step.prompt` (via runner)    | Implemented in codebase     |

Templates used:

- **High-level overview:** `templates/00_Feature_Overview.template`
- **Per-TODO spec:** `templates/01_Agent-First_TODO.template`

---

## Usage

### CLI options (todo-run-steps.sh)

| Option | Description |
|--------|-------------|
| `--once` | Run at most one step, then exit. |
| `--steps N` | Run at most N steps, then exit. |
| `--phase ID` | Only run steps whose step id starts with `ID` (e.g. `P1_03` for `P1_03.1`, `P1_03.2`, …). |
| `[ROOT]` | Project root; default is current directory. |

Examples:

```bash
bash todo-runner/todo-run-steps.sh --once              # run one step and stop
bash todo-runner/todo-run-steps.sh --steps 3           # run up to 3 steps
bash todo-runner/todo-run-steps.sh --phase P1_03       # only steps for phase/todo P1_03
bash todo-runner/todo-run-steps.sh --once --phase P1_03  # one step from P1_03 only
```

The **todo-next-step.mjs** script accepts `--phase ID` as well when you only want to resolve the next step for a given phase (e.g. for manual runs).

### In one project (runner copied into repo)

From project root:

```bash
node todo-runner/todo-next-step.mjs    # resolve next step
bash todo-runner/todo-run-steps.sh     # loop: run agent per step
```

### In many projects (shared runner)

Copy this folder to a shared location, e.g. `~/.local/share/todo-runner`. From any project root:

```bash
export TODO_RUNNER_HOME=~/.local/share/todo-runner
node "$TODO_RUNNER_HOME/todo-next-step.mjs"
bash "$TODO_RUNNER_HOME/todo-run-steps.sh"
```

Or in each project’s `package.json`:

```json
{
  "scripts": {
    "todo:next": "node \"$TODO_RUNNER_HOME/todo-next-step.mjs\"",
    "todo:run": "bash \"$TODO_RUNNER_HOME/todo-run-steps.sh\""
  }
}
```

**Requirements:** Cursor CLI (`agent`), Node. The runner prompt is self-contained; no Cursor rule is required.

---

## Summary

- **Thinking model** produces MVP/Design and one or more **phases/features**.
- **Feature Overview** template defines each phase/feature at a high level.
- **02 breakdown prompt** turns each overview into **Agent-first TODOs** in `docs/TODO/active/`.
- **03 steps prompt** turns each TODO into **ordered steps** in `docs/TODO/active/steps/`.
- **Auto runner** (`todo-next-step.mjs` + `todo-run-steps.sh`) runs **04 execute prompt** per step and moves completed steps and TODOs into `docs/TODO/completed/`.

This keeps design and decomposition in the thinking model and leaves small, clear steps for the Auto model to execute reliably.
