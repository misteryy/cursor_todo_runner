#!/usr/bin/env node
/**
 * Run after a step file is moved to completed/steps/.
 * If no sibling steps remain in active/steps/ for the same TODO, moves the parent
 * TODO from docs/TODO/active/ to docs/TODO/completed/.
 *
 * Usage: node on-step-completed.mjs <step-basename>
 * Example: node on-step-completed.mjs P1_01.05_foo.md
 *
 * Run from project root. Step file may already be in completed/steps/ (call after move).
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const ACTIVE_DIR = path.join(ROOT, "docs", "TODO", "active");
const ACTIVE_STEPS_DIR = path.join(ACTIVE_DIR, "steps");
const COMPLETED_DIR = path.join(ROOT, "docs", "TODO", "completed");

function stepIdFromFilename(name) {
  // Match versioned step ID: P{phase}_{todo}.{step} where each can be dotted (e.g., P2.5_01.5.01)
  const match = name.match(/^(P\d+(?:\.\d+)*_\d+(?:\.\d+)*\.\d+(?:\.\d+)*)_/);
  return match ? match[1] : null;
}

/** TODO id from step filename (e.g. P1_01.05_foo.md -> P1_01, P2.5_01.5.01_foo.md -> P2.5_01.5) */
function todoIdFromStepFilename(basename) {
  const stepId = stepIdFromFilename(basename);
  if (!stepId) return null;
  const idx = stepId.lastIndexOf(".");
  return idx > 0 ? stepId.slice(0, idx) : stepId;
}

function main() {
  const stepBasename = process.argv[2];
  if (!stepBasename || !stepBasename.endsWith(".md")) {
    process.exit(0);
  }

  const todoId = todoIdFromStepFilename(stepBasename);
  if (!todoId) process.exit(0);

  if (!fs.existsSync(ACTIVE_STEPS_DIR)) process.exit(0);

  const activeStepFiles = fs.readdirSync(ACTIVE_STEPS_DIR).filter((f) => {
    if (!f.endsWith(".md")) return false;
    const id = stepIdFromFilename(f);
    return id && (id === todoId || id.startsWith(todoId + "."));
  });

  if (activeStepFiles.length > 0) process.exit(0);

  const todoFiles = fs.existsSync(ACTIVE_DIR)
    ? fs.readdirSync(ACTIVE_DIR).filter((f) => f.endsWith(".md") && f.startsWith(todoId + "_"))
    : [];
  if (todoFiles.length === 0) process.exit(0);

  const todoFile = todoFiles[0];
  const src = path.join(ACTIVE_DIR, todoFile);
  const dest = path.join(COMPLETED_DIR, todoFile);
  if (!fs.existsSync(src)) process.exit(0);

  fs.mkdirSync(COMPLETED_DIR, { recursive: true });
  fs.renameSync(src, dest);
  console.log("Moved TODO to completed (no sibling steps left):", todoFile);
}

main();
