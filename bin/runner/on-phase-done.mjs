#!/usr/bin/env node
/**
 * Run when the runner loop exits with "no pending steps" (phase/TODO finished).
 * 1. Moves any Agent-First TODO from docs/TODO/active/ to docs/TODO/completed/ if still there.
 * 2. After last TODO of a phase is processed (no remaining in backlog or active, excluding cancelled),
 *    moves the phase doc from docs/phase/active/ to docs/phase/completed/.
 * 3. Builds execution-summary prompt with context (TodoFile, CompletedSteps, etc.) and writes
 *    docs/TODO/runner/RUNNER_SUMMARY_PROMPT.txt for the agent to run once.
 * Summary is generated only once per finished phase, not per step.
 *
 * Options:
 *   --phase ID      Only consider TODO and steps for this phase (e.g. P1_03).
 *   --no_summary    Only move TODO to completed; do not write RUNNER_SUMMARY_PROMPT.txt.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = path.join(SCRIPT_DIR, "..", "..");
const SUMMARY_PROMPT_PATH = path.join(RUNNER_ROOT, "prompts", "05-execution-summary.prompt");

function parseArgs() {
  const args = process.argv.slice(2);
  let phase = null;
  let noSummary = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--phase" && args[i + 1]) {
      phase = args[i + 1];
      i++;
    } else if (args[i] === "--no_summary") {
      noSummary = true;
    }
  }
  return { phase, noSummary };
}

const ROOT = process.cwd();
const TODO_DIR = path.join(ROOT, "docs", "TODO");
const ACTIVE_DIR = path.join(TODO_DIR, "active");
const BACKLOG_DIR = path.join(TODO_DIR, "backlog");
const COMPLETED_DIR = path.join(TODO_DIR, "completed");
const COMPLETED_STEPS_DIR = path.join(COMPLETED_DIR, "steps");
const SUMMARIES_DIR = path.join(COMPLETED_DIR, "summaries");
const RUNNER_DIR = path.join(TODO_DIR, "runner");
const SUMMARY_PROMPT_OUT = path.join(RUNNER_DIR, "RUNNER_SUMMARY_PROMPT.txt");
const PHASE_ACTIVE_DIR = path.join(ROOT, "docs", "phase", "active");
const PHASE_COMPLETED_DIR = path.join(ROOT, "docs", "phase", "completed");

function stepIdFromFilename(name) {
  // Match versioned step ID: P{phase}_{todo}.{step} where each can be dotted (e.g., P2.5_01.5.01)
  const match = name.match(/^(P\d+(?:\.\d+)*_\d+(?:\.\d+)*\.\d+(?:\.\d+)*)_/);
  return match ? match[1] : null;
}

function phaseFromStepId(stepId) {
  if (!stepId) return null;
  const idx = stepId.lastIndexOf(".");
  return idx > 0 ? stepId.slice(0, idx) : stepId;
}

/** Extract phase prefix from TODO filename (e.g. P1_01_foo.md -> P1, P2.5_01_foo.md -> P2.5) */
function phaseFromTodoFilename(name) {
  // Match versioned phase: P{version} where version can be dotted (e.g., P2.5)
  const match = name.match(/^(P\d+(?:\.\d+)*)_/);
  return match ? match[1] : null;
}

function listTodoFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
}

function listStepFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md") && stepIdFromFilename(f));
}

function todoMatchesPhase(todoBasename, phase) {
  if (!phase) return true;
  return todoBasename.startsWith(phase + "_") || todoBasename.includes("_" + phase + "_");
}

/** Check if a TODO file has Status: CANCELLED (case-insensitive) */
function isTodoCancelled(filepath) {
  try {
    const content = fs.readFileSync(filepath, "utf8");
    // Match "Status:" line followed by CANCELLED (case-insensitive)
    const statusMatch = content.match(/^Status:\s*\n?\s*(.+)/im);
    if (statusMatch) {
      return /cancelled/i.test(statusMatch[1]);
    }
    return false;
  } catch {
    return false;
  }
}

/** Get non-cancelled TODOs for a phase from a directory */
function getNonCancelledTodosForPhase(dir, phase) {
  const files = listTodoFiles(dir).filter((f) => todoMatchesPhase(f, phase));
  return files.filter((f) => !isTodoCancelled(path.join(dir, f)));
}

/** Check if there are remaining non-cancelled TODOs for this phase in backlog or active */
function hasRemainingTodosForPhase(phase) {
  const backlogTodos = getNonCancelledTodosForPhase(BACKLOG_DIR, phase);
  const activeTodos = getNonCancelledTodosForPhase(ACTIVE_DIR, phase);
  return backlogTodos.length > 0 || activeTodos.length > 0;
}

/** Move phase doc for a phase from docs/phase/active/ to docs/phase/completed/ if it exists */
function movePhaseDocToCompleted(phase) {
  if (!phase || !fs.existsSync(PHASE_ACTIVE_DIR)) return;

  const phaseFiles = fs.readdirSync(PHASE_ACTIVE_DIR).filter((f) => {
    if (!f.endsWith(".md")) return false;
    // Match files that start with the phase prefix
    return f.startsWith(phase + "_") || f.startsWith(phase + "-") || f === phase + ".md";
  });

  if (phaseFiles.length === 0) return;

  fs.mkdirSync(PHASE_COMPLETED_DIR, { recursive: true });
  for (const file of phaseFiles) {
    const src = path.join(PHASE_ACTIVE_DIR, file);
    // Skip if it's a directory
    if (fs.statSync(src).isDirectory()) continue;
    const dest = path.join(PHASE_COMPLETED_DIR, file);
    fs.renameSync(src, dest);
    console.log("Moved phase doc to completed:", file);
  }
}

function chooseTodoToSummarize(phaseFilter) {
  const activeTodos = listTodoFiles(ACTIVE_DIR).filter((f) => todoMatchesPhase(f, phaseFilter));
  if (activeTodos.length > 0) {
    const chosen = activeTodos[0];
    const src = path.join(ACTIVE_DIR, chosen);
    const dest = path.join(COMPLETED_DIR, chosen);
    fs.mkdirSync(COMPLETED_DIR, { recursive: true });
    fs.renameSync(src, dest);
    console.log("Moved TODO to completed:", chosen);
    return { path: dest, basename: chosen };
  }
  const completedTodos = listTodoFiles(COMPLETED_DIR).filter((f) => todoMatchesPhase(f, phaseFilter));
  if (completedTodos.length === 0) return null;
  const byMtime = completedTodos
    .map((f) => ({
      basename: f,
      path: path.join(COMPLETED_DIR, f),
      mtime: fs.statSync(path.join(COMPLETED_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  const t = byMtime[0];
  return t ? { path: t.path, basename: t.basename } : null;
}

function getCompletedStepsContent(phaseFilter) {
  const files = listStepFiles(COMPLETED_STEPS_DIR);
  const filtered = phaseFilter
    ? files.filter((f) => phaseFromStepId(stepIdFromFilename(f)) === phaseFilter)
    : files;
  return filtered
    .map((f) => {
      const content = fs.readFileSync(path.join(COMPLETED_STEPS_DIR, f), "utf8");
      return `### ${f}\n${content.slice(0, 1200)}${content.length > 1200 ? "\n..." : ""}`;
    })
    .join("\n\n");
}

function main() {
  const { phase: phaseFilter, noSummary } = parseArgs();

  const todo = chooseTodoToSummarize(phaseFilter);
  if (!todo) {
    console.log("No TODO to summarize (none in active or completed for this phase).");
    process.exit(0);
  }

  // After moving TODO to completed, check if this was the last non-cancelled TODO for the phase
  // If so, move the phase doc to completed
  const phase = phaseFilter || phaseFromTodoFilename(todo.basename);
  if (phase && !hasRemainingTodosForPhase(phase)) {
    movePhaseDocToCompleted(phase);
  }

  if (noSummary) {
    process.exit(0);
  }

  const todoContent = fs.readFileSync(todo.path, "utf8");
  const completedStepsContent = getCompletedStepsContent(phaseFilter);
  const outcome = "SUCCESS";

  if (!fs.existsSync(RUNNER_DIR)) fs.mkdirSync(RUNNER_DIR, { recursive: true });
  fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
  const summaryBasename = path.basename(todo.basename, ".md") + ".summary.md";
  const outputPath = path.join(SUMMARIES_DIR, summaryBasename);

  let template = fs.readFileSync(SUMMARY_PROMPT_PATH, "utf8");
  template = template.replace("@TodoFile", todoContent);
  template = template.replace("@CompletedSteps", completedStepsContent || "(none listed)");
  template = template.replace("@PendingSteps", "None — phase completed.");
  template = template.replace("@ActionRequired", "None.");
  template = template.replace("@Outcome", outcome);
  template = template.replace("@OutputPath", outputPath);

  fs.writeFileSync(SUMMARY_PROMPT_OUT, template, "utf8");
  console.log("Summary prompt written:", SUMMARY_PROMPT_OUT);
  console.log("Summary will be saved to:", outputPath);
}

main();
