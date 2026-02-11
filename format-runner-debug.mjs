#!/usr/bin/env node
/**
 * Prints only cursor_todo_runner debug: shell echoes and our scripts' output.
 * Strips Cursor agent stream-json (tool_call, thinking, assistant, result).
 * Reads from stdin or file path (first arg).
 * Usage: node format-runner-debug.mjs [path]  OR  cat run.log | node format-runner-debug.mjs
 */

import fs from "fs";
import readline from "readline";

function isAgentStreamLine(line) {
  const t = line.trim();
  if (!t.startsWith("{")) return false;
  try {
    const ob = JSON.parse(line);
    if (ob && typeof ob !== "object") return false;
    if (ob.type && ["tool_call", "thinking", "assistant", "result", "system"].includes(ob.type))
      return true;
    if (ob.message && ob.message.role === "assistant") return true;
    if (ob.type === "user") return true;
    return false;
  } catch {
    return false;
  }
}

async function main() {
  const file = process.argv[2];
  const stream = file
    ? fs.createReadStream(file, { encoding: "utf8" })
    : process.stdin;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (isAgentStreamLine(line)) continue;
    const cleaned = line
      .replace(/\r$/, "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    if (cleaned.trim()) console.log(cleaned);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
