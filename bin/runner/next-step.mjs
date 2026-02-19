#!/usr/bin/env node
/**
 * Resolves next TODO step from docs/TODO (active/steps vs completed/steps),
 * respects "Depends on", and writes docs/TODO/runner/NEXT.md.
 * Run from project root. If action_required has any file, prints that and exits.
 *
 * Exit codes:
 *   0  Next step written (NEXT.md present); or no steps left to process (successful completion).
 *   1  Action required or step blocked (dependencies not met).
 *   2  Only with --dry-run: no pending steps (allows runner to detect phase complete without writing).
 *
 * Options:
 *   --phase ID      Only consider steps whose id starts with ID (e.g. P1_03 for P1_03.1, P1_03.2).
 *   --quiet         Use no-output fragment for the execute prompt (prompts/fragments/output-zero.txt). Default: output-step-only.txt.
 *   --skip_manual   Do not create action_required files for manual testing; only report in summary.
 *   --dry-run       Only check status and exit with appropriate code; do not write files.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadGuiPatterns, loadModelRecommendations } from "./gui-config.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = path.join(SCRIPT_DIR, "..", "..");
const EXECUTE_STEP_PROMPT_PATH = path.join(RUNNER_ROOT, "prompts", "04-execute-single-step.prompt");
const FRAGMENTS_DIR = path.join(RUNNER_ROOT, "prompts", "fragments");
const USER_FRAGMENTS_DIR = path.join(FRAGMENTS_DIR, "user");

function parseArgs() {
  const args = process.argv.slice(2);
  let phase = null;
  let quiet = false;
  let skipManual = false;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--phase" && args[i + 1]) {
      phase = args[i + 1];
      i++;
    } else if (args[i] === "--quiet") {
      quiet = true;
    } else if (args[i] === "--skip_manual") {
      skipManual = true;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { phase, quiet, skipManual, dryRun };
}

const { phase: phaseFilter, quiet: useZeroOutput, skipManual, dryRun } = parseArgs();
const ROOT = process.cwd();
const TODO_DIR = path.join(ROOT, "docs", "TODO");
const ACTIVE_STEPS_DIR = path.join(TODO_DIR, "active", "steps");
const COMPLETED_STEPS_DIR = path.join(TODO_DIR, "completed", "steps");
const ACTION_REQUIRED_DIR = path.join(TODO_DIR, "action_required");
const RUNNER_DIR = path.join(TODO_DIR, "runner");
const NEXT_FILE = path.join(RUNNER_DIR, "NEXT.md");
const PROMPT_FILE = path.join(RUNNER_DIR, "RUNNER_PROMPT.txt");

function loadExecuteStepPrompt(stepPath) {
  let template = fs.readFileSync(EXECUTE_STEP_PROMPT_PATH, "utf8");
  if (!template.includes("@StepFile")) {
    throw new Error(`${EXECUTE_STEP_PROMPT_PATH} must contain @StepFile placeholder`);
  }
  template = template.replace("@StepFile", "@" + stepPath);

  // Output instruction fragment
  const outputFragmentName = useZeroOutput ? "output-zero.txt" : "output-step-only.txt";
  const outputFragmentPath = path.join(FRAGMENTS_DIR, outputFragmentName);
  if (!template.includes("@OutputInstruction")) {
    throw new Error(`${EXECUTE_STEP_PROMPT_PATH} must contain @OutputInstruction placeholder`);
  }
  const outputFragment = fs.readFileSync(outputFragmentPath, "utf8").trim();
  template = template.replace("@OutputInstruction", outputFragment);

  // Manual test instruction fragment
  const manualFragmentName = skipManual ? "manual-skip.txt" : "manual-block.txt";
  const manualFragmentPath = path.join(FRAGMENTS_DIR, manualFragmentName);
  if (!template.includes("@ManualTestInstruction")) {
    throw new Error(`${EXECUTE_STEP_PROMPT_PATH} must contain @ManualTestInstruction placeholder`);
  }
  const manualFragment = fs.readFileSync(manualFragmentPath, "utf8").trim();
  template = template.replace("@ManualTestInstruction", manualFragment);

  // Append user fragments matching the prompt number (e.g., 04_*.txt for 04-execute-single-step.prompt)
  const promptNumber = extractPromptNumber(EXECUTE_STEP_PROMPT_PATH);
  if (promptNumber) {
    const userFragments = loadUserFragments(promptNumber);
    if (userFragments) {
      template += "\n\n" + userFragments;
    }
  }

  return template;
}

/**
 * Extract the two-digit prompt number from a prompt filename.
 * E.g., "04-execute-single-step.prompt" -> "04"
 * @param {string} promptPath - Path to the prompt file
 * @returns {string|null} - Two-digit number or null if not found
 */
function extractPromptNumber(promptPath) {
  const filename = path.basename(promptPath);
  const match = filename.match(/^(\d{2})-/);
  return match ? match[1] : null;
}

/**
 * Load user-defined fragments from prompts/fragments/user/ that match a prompt number.
 * Files matching NN_*.txt (e.g., 04_testing.txt) are loaded and concatenated.
 * @param {string} promptNumber - Two-digit prompt number (e.g., "04")
 * @returns {string|null} - Concatenated fragment content, or null if none found
 */
function loadUserFragments(promptNumber) {
  if (!fs.existsSync(USER_FRAGMENTS_DIR)) return null;
  
  const files = fs.readdirSync(USER_FRAGMENTS_DIR)
    .filter((f) => f.startsWith(promptNumber + "_") && f.endsWith(".txt"))
    .sort();
  
  if (files.length === 0) return null;
  
  const contents = files.map((f) => {
    const content = fs.readFileSync(path.join(USER_FRAGMENTS_DIR, f), "utf8").trim();
    return `# User fragment: ${f}\n${content}`;
  });
  
  return contents.join("\n\n");
}

// Versioned step ID: P{phase}_{todo}.{step} where each component can be dotted (e.g., P2.5_01.5.01)
const STEP_ID_REGEX = /P\d+(?:\.\d+)*_\d+(?:\.\d+)*\.\d+(?:\.\d+)*/g;

function stepIdFromFilename(name) {
  // Match versioned step ID at start of filename: P{phase}_{todo}.{step}_
  const match = name.match(/^(P\d+(?:\.\d+)*_\d+(?:\.\d+)*\.\d+(?:\.\d+)*)_/);
  return match ? match[1] : null;
}

/**
 * Detect if a step filename indicates a GUI compound step (explicit).
 * GUI compound steps use filename pattern: P{phase}_{todo}.{step}_GUI_{description}.md
 */
function isGuiCompoundStep(filename) {
  return /^P\d+(?:\.\d+)*_\d+(?:\.\d+)*\.\d+(?:\.\d+)*_GUI_/i.test(filename);
}

/**
 * Detect if step content matches any configured GUI path patterns.
 * Returns false when no gui-patterns.json config exists (no implicit detection).
 */
function hasGuiPaths(content, guiPatterns) {
  if (!guiPatterns) return false;
  return guiPatterns.some((pattern) => pattern.test(content));
}

/**
 * Determine GUI step type based on filename and content.
 * - 'compound': explicit _GUI_ filename marker (always works, no config needed)
 * - 'simple': content matches configured GUI path patterns (requires gui-patterns.json)
 * - null: not a GUI step
 */
function getGuiStepType(filename, content, guiPatterns) {
  if (isGuiCompoundStep(filename)) {
    return "compound";
  }
  if (content && hasGuiPaths(content, guiPatterns)) {
    return "simple";
  }
  return null;
}

/**
 * Get recommended model for a step based on its GUI type.
 * Model names come from gui-patterns.json config or defaults.
 */
function getRecommendedModel(filename, content, guiPatterns, modelRecs) {
  const guiType = getGuiStepType(filename, content, guiPatterns);
  if (guiType === "compound") {
    return modelRecs.compound;
  }
  if (guiType === "simple") {
    return modelRecs.simple;
  }
  return null;
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
  const pendingIds = new Set(pending.map((s) => s.id));
  // Dependency is satisfied if completed OR not in current pending set (e.g. completed/steps was purged or dependency never had a step file).
  const satisfied = (d) => completedIds.has(d) || !pendingIds.has(d);
  const ready = pending.filter((s) => s.dependsOn.every(satisfied));
  return ready;
}

function actionRequiredFiles() {
  if (!fs.existsSync(ACTION_REQUIRED_DIR)) return [];
  // Block on any .md file except resolved_* (those are cleared by the runner)
  return fs.readdirSync(ACTION_REQUIRED_DIR).filter((f) => 
    f.endsWith(".md") && !f.startsWith("resolved_")
  );
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
      process.exit(dryRun ? 2 : 0);
    }
  }
  if (pending.length === 0) {
    console.log("No pending steps (no step files in docs/TODO/active/steps/).");
    process.exit(0);
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
    process.exit(dryRun ? 2 : 0);
  }

  const next = ready[0];
  const stepPathRootRelative = path.join("docs", "TODO", "active", "steps", next.filename);
  const stepFileAbs = path.join(ROOT, stepPathRootRelative);
  const stepPathForPrompt = path.relative(RUNNER_ROOT, stepFileAbs);

  if (dryRun) {
    process.exit(0);
  }

  if (!fs.existsSync(RUNNER_DIR)) fs.mkdirSync(RUNNER_DIR, { recursive: true });

  const promptText = loadExecuteStepPrompt(stepPathForPrompt);
  fs.writeFileSync(PROMPT_FILE, promptText, "utf8");

  const guiPatterns = loadGuiPatterns(ROOT);
  const modelRecs = loadModelRecommendations(ROOT);
  const stepContent = readStepFile(ACTIVE_STEPS_DIR, next.filename);
  const guiType = getGuiStepType(next.filename, stepContent, guiPatterns);
  const recommendedModel = getRecommendedModel(next.filename, stepContent, guiPatterns, modelRecs);
  const modelHint = recommendedModel ? `\n**Recommended model:** \`${recommendedModel}\`` : "";
  
  let guiNote = "";
  if (guiType === "compound") {
    guiNote = "\n\n> **GUI Compound Step:** This step groups multiple UI components. Use a capable model and expect 2-3 hours.";
  } else if (guiType === "simple") {
    guiNote = "\n\n> **GUI Step:** This step modifies UI/presentation code. Using a capable model for better visual reasoning.";
  }

  const nextMd = `# Next step

**Step file:** \`${stepPathRootRelative}\`${modelHint}

The exact prompt (with this step file @-mentioned) is in \`docs/TODO/runner/RUNNER_PROMPT.txt\`.

For manual run: paste the contents of RUNNER_PROMPT.txt into the chat (the @path will attach the step file).${guiNote}
`;

  fs.writeFileSync(NEXT_FILE, nextMd, "utf8");
  const promptFileAbs = path.resolve(PROMPT_FILE);
  const guiLabel = guiType === "compound" ? " [GUI-compound]" : guiType === "simple" ? " [GUI]" : "";
  console.log(`Next step: ${next.id} (${next.filename})${guiLabel}`);
  console.log(`Written: ${path.resolve(NEXT_FILE)}, ${promptFileAbs}`);
  if (recommendedModel) {
    console.log(`Recommended model: ${recommendedModel}`);
  }
}

main();
