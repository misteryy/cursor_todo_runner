#!/usr/bin/env node
/**
 * Parses agent stream-json output and prints "our" debug: event timeline
 * (tool_call started/completed, thinking, assistant, result) with timestamps.
 * Reads from stdin or file path (first arg).
 * Usage: node debug-agent.mjs [path]  OR  cat agent_output.log | node debug-agent.mjs
 */

import fs from "fs";
import readline from "readline";

function summarizeToolCall(tc) {
  if (!tc || typeof tc !== "object") return "";
  const r =
    tc.readToolCall ||
    tc.lsToolCall ||
    tc.editToolCall ||
    tc.runToolCall ||
    tc.runTerminalCommand;
  if (!r) return "";
  const args = r.args || {};
  if (args.path) return `path=${args.path.replace(process.cwd(), ".")}`;
  if (args.offset) return `path=${(args.path || "").replace(process.cwd(), ".")} offset=${args.offset}`;
  if (args.command) return `command=${String(args.command).slice(0, 50)}…`;
  return "";
}

function summarizeResult(res) {
  if (!res || typeof res !== "object") return "";
  const parts = [];
  if (res.duration_ms != null) parts.push(`duration_ms=${res.duration_ms}`);
  if (res.is_error != null) parts.push(`is_error=${res.is_error}`);
  if (res.result && typeof res.result === "string" && res.result.length < 200)
    parts.push(`result=${res.result.slice(0, 150)}…`);
  return parts.join(" ");
}

function parseLine(line) {
  line = line.trim();
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function formatEvent(ob) {
  const type = ob.type;
  const subtype = ob.subtype || "";
  const ts = ob.timestamp_ms != null ? new Date(ob.timestamp_ms).toISOString() : "";
  const id = ob.call_id ? ` ${ob.call_id.slice(-8)}` : ob.model_call_id ? ` ${String(ob.model_call_id).slice(-12)}` : "";

  switch (type) {
    case "tool_call": {
      const tc =
        ob.tool_call?.readToolCall ||
        ob.tool_call?.lsToolCall ||
        ob.tool_call?.editToolCall ||
        ob.tool_call?.runToolCall ||
        ob.tool_call?.runTerminalCommand;
      const name = tc ? Object.keys(ob.tool_call).find((k) => k !== "args") : "";
      const sum = tc ? summarizeToolCall(ob.tool_call) : "";
      return `${ts} tool_call ${subtype} ${name}${sum ? " " + sum : ""}${id}`;
    }
    case "thinking":
      return `${ts} thinking ${subtype}${id}`;
    case "assistant":
      return `${ts} assistant message${id}`;
    case "result": {
      const res = ob;
      const sum = summarizeResult(res);
      const text = ob.result ?? "";
      const err = text && (text.includes("error Command failed") || text.includes("exit code"));
      return `${ts} result ${ob.subtype ?? ""} ${sum}${err ? "\n  >>> " + text.trim().split("\n").slice(-3).join("\n  >>> ") : ""}`;
    }
    default:
      return `${ts} ${type} ${subtype}${id}`;
  }
}

function inferRunKind(userText) {
  if (!userText || typeof userText !== "string") return "unknown";
  if (userText.includes("We are executing this step file") || userText.includes("active/steps/"))
    return "step";
  if (userText.includes("generating an execution summary") || userText.includes("Summary Requirements"))
    return "summary";
  return "unknown";
}

async function main() {
  const file = process.argv[2];
  const stream = file
    ? fs.createReadStream(file, { encoding: "utf8" })
    : process.stdin;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lastResult = null;
  const nonJsonLines = [];
  let runIndex = 0;

  for await (const line of rl) {
    const ob = parseLine(line);
    if (ob) {
      if (ob.type === "system" && ob.subtype === "init") {
        runIndex += 1;
        console.log(`\n--- Run ${runIndex} ---`);
      }
      if (ob.type === "user" && ob.message?.content) {
        const text = ob.message.content.find((c) => c.type === "text")?.text;
        const kind = inferRunKind(text);
        if (kind !== "unknown") console.log(`  (${kind})`);
      }
      if (ob.type === "result") lastResult = ob;
      console.log(formatEvent(ob));
    } else if (line.trim()) {
      nonJsonLines.push(line);
    }
  }

  if (nonJsonLines.length > 0) {
    console.log("\n--- Non-JSON (stderr / yarn / shell) ---");
    nonJsonLines.forEach((l) => console.log(l));
  }

  if (lastResult?.result != null && typeof lastResult.result === "string") {
    const r = lastResult.result;
    if (r.includes("error Command failed") || r.includes("exit code")) {
      console.log("\n--- Final run outcome (from result payload) ---");
      console.log(r.trim());
    }
  }

  const hasExit1 = nonJsonLines.some(
    (l) => l.includes("error Command failed with exit code 1") || l.includes("exit code 1")
  );
  if (hasExit1) {
    console.log(
      "\n--- Note: Exit code 1 can be from the runner (e.g. step blocked, or step file missing) or from an agent run."
    );
    console.log("  If a step did not run or was not moved: check docs/TODO/action_required/ and that the step file exists in docs/TODO/active/steps/.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
