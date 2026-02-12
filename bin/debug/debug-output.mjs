#!/usr/bin/env node
/**
 * Formats runner agent output for readability: strips raw control chars,
 * normalizes line endings, and optionally truncates very long lines.
 * Reads from docs/TODO/runner/agent_output.log (or path as first arg).
 * Run from project root: node cursor_todo_runner/bin/debug/debug-output.mjs [path] (or yarn todo:format-output)
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DEFAULT_LOG = path.join(ROOT, "docs", "TODO", "runner", "agent_output.log");

const logPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_LOG;

if (!fs.existsSync(logPath)) {
  console.error("File not found:", logPath);
  process.exit(1);
}

let raw = fs.readFileSync(logPath, "utf8");
raw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
raw = raw.replace(/\x1b\[[0-9;]*m/g, "");
raw = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
const maxLine = 500;
const lines = raw.split("\n").map((l) => (l.length > maxLine ? l.slice(0, maxLine) + "…" : l));
process.stdout.write(lines.join("\n"));
if (!raw.endsWith("\n")) process.stdout.write("\n");
