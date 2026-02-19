#!/usr/bin/env node
/**
 * Moves the current step file from docs/TODO/active/steps/ to docs/TODO/completed/steps/
 * by reading the step path from docs/TODO/runner/NEXT.md or RUNNER_PROMPT.txt.
 * If no sibling steps remain for that TODO, moves the parent TODO to completed.
 * Run from project root: node cursor_todo_runner/bin/runner/accept-step.mjs (or yarn todo:accept)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_DIR = path.join(ROOT, "docs", "TODO", "runner");
const NEXT_FILE = path.join(RUNNER_DIR, "NEXT.md");
const PROMPT_FILE = path.join(RUNNER_DIR, "RUNNER_PROMPT.txt");
const ACTIVE_STEPS = path.join(ROOT, "docs", "TODO", "active", "steps");
const COMPLETED_STEPS = path.join(ROOT, "docs", "TODO", "completed", "steps");

function runOnStepCompleted(filename) {
  const onStepCompleted = path.join(SCRIPT_DIR, "on-step-completed.mjs");
  if (fs.existsSync(onStepCompleted)) {
    spawnSync(process.execPath, [onStepCompleted, filename], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }
}

function findStepPath() {
  for (const file of [NEXT_FILE, PROMPT_FILE]) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    // Match versioned step filename: P{phase}_{todo}.{step}_slug.md (e.g., P2.5_01.5.01_foo.md)
    const match = content.match(/docs[/\\]TODO[/\\]active[/\\]steps[/\\](P\d+(?:\.\d+)*_\d+(?:\.\d+)*\.\d+(?:\.\d+)*_[^\s`]+\.md)/);
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

  // If source doesn't exist, check if it was already moved to completed (agent may have done it)
  if (!fs.existsSync(src)) {
    if (fs.existsSync(dest)) {
      console.log("Step already in completed (agent moved it):", filename);
      runOnStepCompleted(filename);
      process.exit(0); // Success — step was completed
    }
    console.error("Step file not found:", src);
    process.exit(1);
  }

  if (!fs.existsSync(COMPLETED_STEPS)) fs.mkdirSync(COMPLETED_STEPS, { recursive: true });
  fs.renameSync(src, dest);
  console.log("Moved to completed:", filename);
  runOnStepCompleted(filename);
}

main();
