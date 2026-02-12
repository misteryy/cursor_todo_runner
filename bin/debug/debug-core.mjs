/**
 * Core logic for debug utilities - extracted for testability.
 * This module exports pure functions that can be tested in isolation.
 */

/**
 * Summarize a tool call for debug output
 * @param {object} tc - Tool call object
 * @returns {string} Summary string
 */
export function summarizeToolCall(tc) {
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

/**
 * Summarize a result event for debug output
 * @param {object} res - Result object
 * @returns {string} Summary string
 */
export function summarizeResult(res) {
  if (!res || typeof res !== "object") return "";
  const parts = [];
  if (res.duration_ms != null) parts.push(`duration_ms=${res.duration_ms}`);
  if (res.is_error != null) parts.push(`is_error=${res.is_error}`);
  if (res.result && typeof res.result === "string" && res.result.length < 200)
    parts.push(`result=${res.result.slice(0, 150)}…`);
  return parts.join(" ");
}

/**
 * Parse a JSON line from agent output
 * @param {string} line - Line to parse
 * @returns {object|null} Parsed object or null
 */
export function parseLine(line) {
  line = line.trim();
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Format an event object for debug output
 * @param {object} ob - Event object
 * @returns {string} Formatted string
 */
export function formatEvent(ob) {
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
      const sum = summarizeResult(ob);
      const text = ob.result ?? "";
      const err = text && (text.includes("error Command failed") || text.includes("exit code"));
      return `${ts} result ${ob.subtype ?? ""} ${sum}${err ? "\n  >>> " + text.trim().split("\n").slice(-3).join("\n  >>> ") : ""}`;
    }
    default:
      return `${ts} ${type} ${subtype}${id}`;
  }
}

/**
 * Infer the run kind from user text
 * @param {string} userText - User message text
 * @returns {"step"|"summary"|"unknown"} Run kind
 */
export function inferRunKind(userText) {
  if (!userText || typeof userText !== "string") return "unknown";
  if (userText.includes("We are executing this step file") || userText.includes("active/steps/"))
    return "step";
  if (userText.includes("generating an execution summary") || userText.includes("Summary Requirements"))
    return "summary";
  return "unknown";
}

/**
 * Check if a line is an agent stream JSON line
 * @param {string} line - Line to check
 * @returns {boolean} True if it's an agent stream line
 */
export function isAgentStreamLine(line) {
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

/**
 * Clean ANSI escape codes from a line
 * @param {string} line - Line to clean
 * @returns {string} Cleaned line
 */
export function cleanAnsiCodes(line) {
  return line
    .replace(/\r$/, "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Format raw log content for output
 * @param {string} raw - Raw content
 * @param {number} maxLineLength - Maximum line length before truncation
 * @returns {string} Formatted content
 */
export function formatLogContent(raw, maxLineLength = 500) {
  raw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  raw = raw.replace(/\x1b\[[0-9;]*m/g, "");
  raw = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  const lines = raw.split("\n").map((l) => (l.length > maxLineLength ? l.slice(0, maxLineLength) + "…" : l));
  return lines.join("\n");
}
