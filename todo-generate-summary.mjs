#!/usr/bin/env node
/**
 * Generates execution summaries for completed or blocked TODO work.
 * Run from project root after steps have been executed.
 *
 * Usage:
 *   node todo-generate-summary.mjs [options]
 *
 * Options:
 *   --todo ID        Generate summary for specific TODO (e.g., P1_02). Required unless --session.
 *   --session        Generate summaries for all TODOs touched in the current session
 *                    (based on runner/session_todos.json written by todo-run-steps.sh).
 *   --outcome TYPE   Force outcome: SUCCESS, PARTIAL, or BLOCKED. Auto-detected if omitted.
 *   --dry-run        Print what would be generated without writing files.
 *
 * Exit codes:
 *   0  Summary generated (or would be generated with --dry-run).
 *   1  Error (missing TODO, invalid args, etc.).
 *   2  Nothing to summarize.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUMMARY_PROMPT_PATH = path.join(SCRIPT_DIR, "prompts", "04_Generate_Summary.prompt");

const ROOT = process.cwd();
const TODO_DIR = path.join(ROOT, "docs", "TODO");
const ACTIVE_DIR = path.join(TODO_DIR, "active");
const ACTIVE_STEPS_DIR = path.join(ACTIVE_DIR, "steps");
const COMPLETED_DIR = path.join(TODO_DIR, "completed");
const COMPLETED_STEPS_DIR = path.join(COMPLETED_DIR, "steps");
const ACTION_REQUIRED_DIR = path.join(TODO_DIR, "action_required");
const SUMMARIES_DIR = path.join(TODO_DIR, "summaries");
const RUNNER_DIR = path.join(TODO_DIR, "runner");
const SESSION_FILE = path.join(RUNNER_DIR, "session_todos.json");
const SUMMARY_PROMPT_FILE = path.join(RUNNER_DIR, "SUMMARY_PROMPT.txt");

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { todoId: null, session: false, outcome: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--todo":
        result.todoId = args[++i];
        break;
      case "--session":
        result.session = true;
        break;
      case "--outcome":
        result.outcome = args[++i]?.toUpperCase();
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
    }
  }
  return result;
}

/** Extract TODO ID from filename (e.g., "P1_02" from "P1_02_Dependencies.md") */
function todoIdFromFilename(filename) {
  const match = filename.match(/^(P\d+_\d+)_/);
  return match ? match[1] : null;
}

/** Extract step's parent TODO ID (e.g., "P1_02" from "P1_02.03_something.md") */
function todoIdFromStepFilename(filename) {
  const match = filename.match(/^(P\d+_\d+)\.\d+_/);
  return match ? match[1] : null;
}

/** List markdown files in a directory */
function listMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
}

/** Find TODO file by ID in active or completed */
function findTodoFile(todoId) {
  for (const dir of [ACTIVE_DIR, COMPLETED_DIR]) {
    const files = listMdFiles(dir);
    const match = files.find((f) => todoIdFromFilename(f) === todoId);
    if (match) return { dir, filename: match, path: path.join(dir, match) };
  }
  return null;
}

/** Get all step files for a TODO ID */
function getStepsForTodo(todoId) {
  const completedSteps = listMdFiles(COMPLETED_STEPS_DIR)
    .filter((f) => todoIdFromStepFilename(f) === todoId)
    .map((f) => ({ filename: f, path: path.join(COMPLETED_STEPS_DIR, f), completed: true }));

  const pendingSteps = listMdFiles(ACTIVE_STEPS_DIR)
    .filter((f) => todoIdFromStepFilename(f) === todoId)
    .map((f) => ({ filename: f, path: path.join(ACTIVE_STEPS_DIR, f), completed: false }));

  return { completedSteps, pendingSteps };
}

/** Get action_required files for a TODO ID */
function getBlockersForTodo(todoId) {
  const files = listMdFiles(ACTION_REQUIRED_DIR);
  // Match blockers that reference this TODO's steps (e.g., step_P1_02.01_blocked.md)
  return files
    .filter((f) => {
      const stepMatch = f.match(/step_(P\d+_\d+)\.\d+/);
      return stepMatch && stepMatch[1] === todoId;
    })
    .map((f) => ({ filename: f, path: path.join(ACTION_REQUIRED_DIR, f) }));
}

/** Determine outcome for a TODO */
function detectOutcome(todoId) {
  const todoFile = findTodoFile(todoId);
  const { completedSteps, pendingSteps } = getStepsForTodo(todoId);
  const blockers = getBlockersForTodo(todoId);

  if (blockers.length > 0) return "BLOCKED";
  if (pendingSteps.length === 0 && completedSteps.length > 0) return "SUCCESS";
  if (completedSteps.length > 0 && pendingSteps.length > 0) return "PARTIAL";
  if (todoFile && todoFile.dir === COMPLETED_DIR) return "SUCCESS";
  return "PARTIAL";
}

/** Generate summary prompt content for a TODO */
function generatePromptContent(todoId, outcome) {
  const todoFile = findTodoFile(todoId);
  if (!todoFile) {
    console.error(`TODO not found: ${todoId}`);
    return null;
  }

  const { completedSteps, pendingSteps } = getStepsForTodo(todoId);
  const blockers = getBlockersForTodo(todoId);

  if (completedSteps.length === 0 && blockers.length === 0) {
    console.log(`No completed steps or blockers for ${todoId}; nothing to summarize.`);
    return null;
  }

  const template = fs.readFileSync(SUMMARY_PROMPT_PATH, "utf8");

  // Build the prompt with actual file references
  let prompt = template
    .replace("@TodoFile", `@${path.relative(ROOT, todoFile.path)}`)
    .replace("@Outcome", outcome);

  // Replace completed steps placeholder
  if (completedSteps.length > 0) {
    const stepsRefs = completedSteps.map((s) => `@${path.relative(ROOT, s.path)}`).join("\n");
    prompt = prompt.replace("@CompletedSteps", stepsRefs);
  } else {
    prompt = prompt.replace("@CompletedSteps", "(none)");
  }

  // Replace pending steps placeholder
  if (pendingSteps.length > 0) {
    const pendingRefs = pendingSteps.map((s) => `@${path.relative(ROOT, s.path)}`).join("\n");
    prompt = prompt.replace("@PendingSteps", pendingRefs);
  } else {
    prompt = prompt.replace("@PendingSteps", "(none)");
  }

  // Replace blocker placeholder
  if (blockers.length > 0) {
    const blockerRefs = blockers.map((b) => `@${path.relative(ROOT, b.path)}`).join("\n");
    prompt = prompt.replace("@ActionRequired", blockerRefs);
  } else {
    prompt = prompt.replace("@ActionRequired", "(none)");
  }

  // Add output path instruction
  const summaryFilename = `${todoFile.filename.replace(".md", ".summary.md")}`;
  const summaryPath = path.join("docs", "TODO", "summaries", summaryFilename);
  prompt += `\n\n## Output Path\n\nSave to: \`${summaryPath}\`\n`;

  return {
    prompt,
    summaryPath,
    todoFile,
    completedSteps,
    pendingSteps,
    blockers,
  };
}

/** Load session TODOs from file */
function loadSessionTodos() {
  if (!fs.existsSync(SESSION_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    return data.todos || [];
  } catch {
    return [];
  }
}

/** Save session TODOs to file */
function saveSessionTodos(todos) {
  if (!fs.existsSync(RUNNER_DIR)) fs.mkdirSync(RUNNER_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ todos, timestamp: new Date().toISOString() }, null, 2));
}

/** Clear session file */
function clearSession() {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

function main() {
  const { todoId, session, outcome: forcedOutcome, dryRun } = parseArgs();

  if (!todoId && !session) {
    console.error("Usage: todo-generate-summary.mjs --todo ID | --session [--outcome TYPE] [--dry-run]");
    process.exit(1);
  }

  // Determine which TODOs to summarize
  let todoIds = [];
  if (session) {
    todoIds = loadSessionTodos();
    if (todoIds.length === 0) {
      console.log("No TODOs in session. Nothing to summarize.");
      process.exit(2);
    }
  } else {
    todoIds = [todoId];
  }

  // Ensure summaries directory exists
  if (!dryRun && !fs.existsSync(SUMMARIES_DIR)) {
    fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
  }

  let generated = 0;
  for (const id of todoIds) {
    const outcome = forcedOutcome || detectOutcome(id);
    const result = generatePromptContent(id, outcome);

    if (!result) continue;

    console.log(`\n=== ${id} (${outcome}) ===`);
    console.log(`TODO: ${result.todoFile.filename}`);
    console.log(`Completed steps: ${result.completedSteps.length}`);
    console.log(`Pending steps: ${result.pendingSteps.length}`);
    console.log(`Blockers: ${result.blockers.length}`);
    console.log(`Summary will be: ${result.summaryPath}`);

    if (dryRun) {
      console.log("\n[DRY RUN] Would write prompt to SUMMARY_PROMPT.txt");
      generated++;
      continue;
    }

    // Write prompt file for agent consumption
    fs.writeFileSync(SUMMARY_PROMPT_FILE, result.prompt, "utf8");
    console.log(`\nPrompt written to: ${SUMMARY_PROMPT_FILE}`);
    generated++;
  }

  if (session && !dryRun) {
    clearSession();
    console.log("\nSession cleared.");
  }

  if (generated === 0) {
    console.log("\nNothing to summarize.");
    process.exit(2);
  }

  console.log(`\n${generated} summary prompt(s) prepared.`);
  console.log("Run the agent with SUMMARY_PROMPT.txt to generate the summary file(s).");
}

// Export functions for use by todo-run-steps.sh
export { saveSessionTodos, loadSessionTodos, todoIdFromStepFilename };

main();
