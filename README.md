# Todo runner (portable)

Use this folder from any project that has a `docs/TODO` layout:
- `docs/TODO/active/` (TODO files), `docs/TODO/active/steps/` (step files)
- `docs/TODO/completed/`, `docs/TODO/completed/steps/`
- `docs/TODO/runner/`, `docs/TODO/action_required/`

## In one project

From project root:
```
node todo-runner/todo-next-step.mjs   # resolve next step
bash todo-runner/todo-run-steps.sh    # loop: run agent per step
```

## In many projects

Copy this folder to a shared location, e.g. `~/.local/share/todo-runner`.
Then from any project root:
```
export TODO_RUNNER_HOME=~/.local/share/todo-runner
node "$TODO_RUNNER_HOME/todo-next-step.mjs"
bash "$TODO_RUNNER_HOME/todo-run-steps.sh"
```

Or add to your shell profile: `export TODO_RUNNER_HOME=~/.local/share/todo-runner`
and in each project's package.json:
```json
"scripts": {
  "todo:next": "node \"$TODO_RUNNER_HOME/todo-next-step.mjs\"",
  "todo:run": "bash \"$TODO_RUNNER_HOME/todo-run-steps.sh\""
}
```

Requires: Cursor CLI (`agent`), Node. The runner prompt is self-contained; no Cursor rule required.
