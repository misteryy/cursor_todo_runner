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

**GUI compound steps:** Use `P<phase>_<seq>.<step>_GUI_<slug>.md` for steps that group multiple related UI components. The runner automatically uses a more capable model for these steps. See **GUI step detection** below for configuration.

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
run-steps.sh --phase P2_01 --skip_manual

# Use a specific model for all steps
run-steps.sh --model claude-4.5-opus-high-thinking --phase P1_01

# Use a specific model for GUI steps only
run-steps.sh --GUI_model claude-4.5-opus-high --phase P2_04

# Use different models for GUI and non-GUI steps
run-steps.sh --model claude-4.5-sonnet --GUI_model claude-4.5-opus-high

# Combine options
run-steps.sh --phase P2_04 --steps 2 --quiet --skip_manual
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
| `--no_summary` | Skip execution summary when phase finishes |
| `--skip_manual` | Don't pause for manual testing; report in summary only |
| `--quiet` | Suppress agent stdout (runner prompts still shown) |
| `--debug` | Show agent stdout, log to `docs/TODO/runner/agent_output_*.log` |
| `--model MODEL` | Specify model for non-GUI steps (default: `auto`) |
| `--GUI_model MODEL` | Specify model for GUI steps (default: use `--model` value or auto-detected recommendation) |
| `[ROOT]` | Project root (default: current directory) |

**Env:** `CURSOR_TODO_QUIET=1` = `--quiet`

### Supported models

| Model | Notes |
|-------|-------|
| `auto` | Default — Cursor picks |
| `claude-4.5-opus-high` | High capability |
| `claude-4.5-opus-high-thinking` | Extended thinking |
| `claude-4.5-sonnet` | Fast and capable |
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
- **Manual testing:** Manual steps write instructions to `action_required/`; use `--skip_manual` for unattended runs.
- **Execute prompt:** `prompts/04-execute-single-step.prompt`; output level via `prompts/fragments/output-step-only.txt` or `output-zero.txt` (`--quiet`).
- **GUI steps:** Steps are detected as GUI in two ways: (1) `_GUI_` in the filename (compound — always works, no config needed), or (2) step content matches path patterns from a `gui-patterns.json` config file (simple). Without a config file, only explicit `_GUI_` filenames trigger GUI detection. Model selection priority: `--GUI_model` (if specified) → `--model` (if not `auto`) → recommended model. See **GUI step detection** below.

---

## GUI step detection

The runner can automatically detect GUI/UI steps and use a more capable model for them. This works in two ways:

1. **Explicit (always active):** Name your step file with `_GUI_` in the filename (e.g., `P2_04.03_GUI_dashboard_layout.md`). This marks it as a compound GUI step.

2. **Content-based (opt-in via config):** Create a `gui-patterns.json` in your project root to enable automatic detection based on file paths mentioned in step content.

### Setting up `gui-patterns.json`

Place this file in your project root (or `.cursor/gui-patterns.json`, or `config/gui-patterns.json`):

```json
{
  "presets": ["react", "next"],
  "customPatterns": [
    "src/design-system/",
    "packages/ui/"
  ],
  "modelRecommendations": {
    "compound": "claude-4.5-sonnet",
    "simple": "claude-4.5-sonnet"
  }
}
```

- **`presets`** — Select from built-in framework presets (see below). Combine multiple if your project uses several frameworks.
- **`customPatterns`** — Add project-specific regex patterns for paths that indicate GUI code.
- **`modelRecommendations`** — Override which model is recommended for GUI steps.

### Available presets

| Preset | Framework | GUI paths detected |
|--------|-----------|-------------------|
| `flutter` | Flutter/Dart | `lib/**/presentation/`, `lib/**/widgets/`, `lib/shared/widgets/`, `lib/**/screens/`, `lib/**/pages/` |
| `react` | React | `src/components/`, `src/pages/`, `src/views/`, `src/layouts/`, `src/styles/`, `app/components/` |
| `next` | Next.js | `app/**/page.tsx`, `app/**/layout.tsx`, `app/**/loading.tsx`, `app/**/error.tsx`, `src/components/`, `components/` |
| `vue` | Vue.js | `src/components/`, `src/views/`, `src/layouts/`, `src/pages/` |
| `nuxt` | Nuxt | `pages/`, `components/`, `layouts/` |
| `angular` | Angular | `.component.{ts,html,css,scss}`, `.directive.ts`, `.pipe.ts`, `src/app/**/components/` |
| `svelte` | Svelte/SvelteKit | `src/routes/**/+page.svelte`, `src/routes/**/+layout.svelte`, `src/lib/components/`, `src/components/` |
| `swift-uikit` | iOS UIKit | `ViewControllers/`, `Views/`, `.storyboard`, `.xib`, `Cells/` |
| `swiftui` | SwiftUI | `Views/`, `Screens/`, `Components/`, `Scenes/` |
| `android-xml` | Android XML | `res/layout/`, `res/drawable/`, `res/menu/`, `res/navigation/`, `**/fragments/`, `**/activities/` |
| `jetpack-compose` | Jetpack Compose | `/ui/`, `/composables/`, `/screens/`, `/components/`, `/theme/` |
| `django` | Django | `templates/`, `static/`, `templatetags/` |
| `rails` | Ruby on Rails | `app/views/`, `app/assets/`, `app/helpers/`, `app/javascript/components/` |
| `laravel` | Laravel | `resources/views/`, `resources/css/`, `resources/js/components/` |
| `wpf` | WPF (.NET) | `.xaml`, `Views/`, `Controls/`, `Pages/` |
| `qt` | Qt/QML | `.ui`, `.qml`, `qml/`, `forms/` |

Each preset has notes about caveats (e.g., which directories are intentionally excluded). See `config/gui-presets.json` for full details.

An example config file is available at `config/gui-patterns.example.json`.

### Without a config file

If no `gui-patterns.json` exists, content-based GUI detection is disabled entirely. Only explicit `_GUI_` filenames trigger GUI model selection. This is the safe default for a general-purpose runner — no assumptions about your project structure.

---

## User prompt fragments

Extend any numbered prompt with project-specific instructions by placing files in `prompts/fragments/user/`. Files matching `NN_*.txt` are appended to the corresponding `NN-*.prompt`.

```
prompts/fragments/user/
├── 03_project_context.txt    → appended to 03-generate-steps.prompt
├── 04_testing_rules.txt      → appended to 04-execute-single-step.prompt
└── 04_style_guide.txt        → appended to 04-execute-single-step.prompt
```

**Naming:** `<prompt-number>_<description>.txt`
- `03_*` → `03-generate-steps.prompt`
- `04_*` → `04-execute-single-step.prompt`

Multiple fragments for the same prompt are concatenated in alphabetical order. Each fragment is prefixed with a `# User fragment: <filename>` header in the final prompt.

**Use cases:**
- Project-specific coding standards
- Framework constraints
- Testing requirements
- Domain terminology

---

## Runner layout

| Path | Purpose |
|------|---------|
| `bin/runner/` | `run-steps.sh`, `next-step.mjs`, `accept-step.mjs`, `on-phase-done.mjs` |
| `bin/debug/` | `debug-agent.mjs`, `debug-runner.mjs`, `debug-output.mjs` |
| `prompts/` | Prompts 01–04 + `fragments/` for output levels |
| `prompts/fragments/user/` | User-defined prompt extensions (see above) |
| `templates/` | Feature overview and agent-first TODO templates |
