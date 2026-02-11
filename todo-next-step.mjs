#!/usr/bin/env node
/**
 * Resolves next TODO step from docs/TODO (active/steps vs completed/steps),
 * respects "Depends on", and writes docs/TODO/runner/NEXT.md.
 * Run from project root. If action_required has any file, prints that and exits.
 *
 * Exit codes:
 *   0  Next step written; runner may invoke the agent.
 *   1  Action required or step blocked (dependencies not met).
 *   2  No pending steps (for this phase or at all); runner must not invoke the agent.
 *
 * Options:
 *   --phase ID   Only consider steps whose id starts with ID (e.g. P1_03 for P1_03.1, P1_03.2).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXECUTE_STEP_PROMPT_PATH = path.join(SCRIPT_DIR, "prompts", "03_Execute_Single_Step.prompt");

function parseArgs() {
  const args = process.argv.slice(2);
  let phase = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--phase" && args[i + 1]) {
      phase = args[i + 1];
      i++;
    }
  }
  return { phase };
}

const { phase: phaseFilter } = parseArgs();
const ROOT = process.cwd();
const TODO_DIR = path.join(ROOT, "docs", "TODO");
const ACTIVE_STEPS_DIR = path.join(TODO_DIR, "active", "steps");
const COMPLETED_STEPS_DIR = path.join(TODO_DIR, "completed", "steps");
const ACTION_REQUIRED_DIR = path.join(TODO_DIR, "action_required");
const RUNNER_DIR = path.join(TODO_DIR, "runner");
const NEXT_FILE = path.join(RUNNER_DIR, "NEXT.md");
const PROMPT_FILE = path.join(RUNNER_DIR, "RUNNER_PROMPT.txt");

function loadExecuteStepPrompt(stepPath) {
  const template = fs.readFileSync(EXECUTE_STEP_PROMPT_PATH, "utf8");
  if (!template.includes("@StepFile")) {
    throw new Error(`${EXECUTE_STEP_PROMPT_PATH} must contain @StepFile placeholder`);
  }
  return template.replace("@StepFile", "@" + stepPath);
}

const STEP_ID_REGEX = /P\d+_\d+\.\d+/g;

function stepIdFromFilename(name) {
  const match = name.match(/^(P\d+_\d+\.\d+)_/);
  return match ? match[1] : null;
}

function parseDependsOn(content) {
  const section = content.match(/## Depends on\s*\n([\s\S]*?)(?=\n## |$)/i);
  if (!section) return [];
  const line = section[1].trim();
  if (/^none/i.test(line)) return [];
  const ids = line.match(STEP_ID_REGEX);
  return ids ? [...new Set(ids)] : [];
}

function readStepFile(dir, filename) {
  const filepath = path.join(dir, filename);
  try {
    return fs.readFileSync(filepath, "utf8");
  } catch {
    return null;
  }
}

function listStepFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md") && stepIdFromFilename(f));
}

function getCompletedIds() {
  const files = listStepFiles(COMPLETED_STEPS_DIR);
  return new Set(files.map((f) => stepIdFromFilename(f)).filter(Boolean));
}

function getPendingSteps() {
  if (!fs.existsSync(ACTIVE_STEPS_DIR)) return [];
  const files = listStepFiles(ACTIVE_STEPS_DIR);
  return files.map((filename) => {
    const id = stepIdFromFilename(filename);
    const content = readStepFile(ACTIVE_STEPS_DIR, filename);
    const dependsOn = content ? parseDependsOn(content) : [];
    return { id, filename, dependsOn };
  });
}

function topoNext(pending, completedIds) {
  const ready = pending.filter((s) => s.dependsOn.every((d) => completedIds.has(d)));
  return ready;
}

function actionRequiredFiles() {
  if (!fs.existsSync(ACTION_REQUIRED_DIR)) return [];
  return fs.readdirSync(ACTION_REQUIRED_DIR).filter((f) => f.endsWith(".md"));
}

function main() {
  const actionFiles = actionRequiredFiles();
  if (actionFiles.length > 0) {
    console.log("Action required before next step. Resolve and remove:\n");
    actionFiles.forEach((f) => console.log(`  docs/TODO/action_required/${f}`));
    console.log("\nThen run this script again.");
    process.exit(1);
  }

  const completedIds = getCompletedIds();
  let pending = getPendingSteps();
  if (phaseFilter) {
    pending = pending.filter((s) => s.id && (s.id === phaseFilter || s.id.startsWith(phaseFilter + ".")));
    if (pending.length === 0) {
      console.log(`No pending steps matching phase '${phaseFilter}' in docs/TODO/active/steps/.`);
      process.exit(2);
    }
  }
  if (pending.length === 0) {
    console.log("No pending steps (no step files in docs/TODO/active/steps/).");
    process.exit(2);
  }

  let ready = topoNext(pending, completedIds);
  if (ready.length === 0) {
    const blocked = pending.map((s) => s.id).join(", ");
    console.log(`No step ready. Pending: ${blocked}. Complete dependencies first.`);
    process.exit(1);
  }
  // Only consider steps whose file still exists (e.g. not moved by a completed run)
  const activeStepsAbs = path.join(ROOT, "docs", "TODO", "active", "steps");
  ready = ready.filter((s) => fs.existsSync(path.join(activeStepsAbs, s.filename)));
  if (ready.length === 0) {
    console.log("No runnable step (step file(s) missing, e.g. already completed); stopping.");
    process.exit(2);
  }

  const next = ready[0];
  const stepPath = path.join("docs", "TODO", "active", "steps", next.filename);
  if (!fs.existsSync(RUNNER_DIR)) fs.mkdirSync(RUNNER_DIR, { recursive: true });

  const promptText = loadExecuteStepPrompt(stepPath);
  fs.writeFileSync(PROMPT_FILE, promptText, "utf8");

  const nextMd = `# Next step

**Step file:** \`${stepPath}\`

The exact prompt (with this step file @-mentioned) is in \`docs/TODO/runner/RUNNER_PROMPT.txt\`.

For manual run: paste the contents of RUNNER_PROMPT.txt into the chat (the @path will attach the step file).
`;

  fs.writeFileSync(NEXT_FILE, nextMd, "utf8");
  console.log(`Next step: ${next.id} (${next.filename})`);
  console.log(`Written: ${NEXT_FILE}, ${PROMPT_FILE}`);
}

main();
