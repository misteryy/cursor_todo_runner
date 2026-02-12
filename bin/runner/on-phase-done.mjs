#!/usr/bin/env node
/**
 * Run when the runner loop exits with "no pending steps" (phase/TODO finished).
 * 1. Moves any Agent-First TODO from docs/TODO/active/ to docs/TODO/completed/ if still there.
 * 2. Builds execution-summary prompt with context (TodoFile, CompletedSteps, etc.) and writes
 *    docs/TODO/runner/RUNNER_SUMMARY_PROMPT.txt for the agent to run once.
 * Summary is generated only once per finished phase, not per step.
 *
 * Options:
 *   --phase ID      Only consider TODO and steps for this phase (e.g. P1_03).
 *   --no-summary    Only move TODO to completed; do not write RUNNER_SUMMARY_PROMPT.txt.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = path.join(SCRIPT_DIR, "..", "..");
const SUMMARY_PROMPT_PATH = path.join(RUNNER_ROOT, "prompts", "04-execution-summary.prompt");

function parseArgs() {
  const args = process.argv.slice(2);
  let phase = null;
  let noSummary = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--phase" && args[i + 1]) {
      phase = args[i + 1];
      i++;
    } else if (args[i] === "--no-summary") {
      noSummary = true;
    }
  }
  return { phase, noSummary };
}

const ROOT = process.cwd();
const TODO_DIR = path.join(ROOT, "docs", "TODO");
const ACTIVE_DIR = path.join(TODO_DIR, "active");
const COMPLETED_DIR = path.join(TODO_DIR, "completed");
const COMPLETED_STEPS_DIR = path.join(COMPLETED_DIR, "steps");
const SUMMARIES_DIR = path.join(COMPLETED_DIR, "summaries");
const RUNNER_DIR = path.join(TODO_DIR, "runner");
const SUMMARY_PROMPT_OUT = path.join(RUNNER_DIR, "RUNNER_SUMMARY_PROMPT.txt");

function stepIdFromFilename(name) {
  const match = name.match(/^(P\d+_\d+\.\d+)_/);
  return match ? match[1] : null;
}

function phaseFromStepId(stepId) {
  if (!stepId) return null;
  const idx = stepId.lastIndexOf(".");
  return idx > 0 ? stepId.slice(0, idx) : stepId;
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
