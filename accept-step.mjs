#!/usr/bin/env node
/**
 * Moves the current step file from docs/TODO/active/steps/ to docs/TODO/completed/steps/
 * by reading the step path from docs/TODO/runner/NEXT.md or RUNNER_PROMPT.txt.
 * Run from project root: node cursor_todo_runner/accept-step.mjs (or yarn todo:accept)
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const RUNNER_DIR = path.join(ROOT, "docs", "TODO", "runner");
const NEXT_FILE = path.join(RUNNER_DIR, "NEXT.md");
const PROMPT_FILE = path.join(RUNNER_DIR, "RUNNER_PROMPT.txt");
const ACTIVE_STEPS = path.join(ROOT, "docs", "TODO", "active", "steps");
const COMPLETED_STEPS = path.join(ROOT, "docs", "TODO", "completed", "steps");

function findStepPath() {
  for (const file of [NEXT_FILE, PROMPT_FILE]) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    const match = content.match(/docs[/\\]TODO[/\\]active[/\\]steps[/\\](P\d+_\d+\.\d+_[^\s`]+\.md)/);
    if (match) return path.join(ROOT, "docs", "TODO", "active", "steps", match[1]);
  }
  return null;
}

function main() {
  const stepPath = findStepPath();
  if (!stepPath) {
    console.error("Could not find current step path in", NEXT_FILE, "or", PROMPT_FILE);
    process.exit(1);
  }
  const filename = path.basename(stepPath);
  const src = stepPath;
  const dest = path.join(COMPLETED_STEPS, filename);
  if (!fs.existsSync(src)) {
    console.error("Step file not found:", src);
    process.exit(1);
  }
  if (!fs.existsSync(COMPLETED_STEPS)) fs.mkdirSync(COMPLETED_STEPS, { recursive: true });
  fs.renameSync(src, dest);
  console.log("Moved to completed:", filename);
}

main();
