/**
 * Loads GUI path patterns from user config (gui-patterns.json) with preset support.
 * Falls back to explicit _GUI_ filename detection only when no config is present.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = path.join(SCRIPT_DIR, "..", "..");
const PRESETS_PATH = path.join(RUNNER_ROOT, "config", "gui-presets.json");

const DEFAULT_MODEL_RECOMMENDATIONS = {
  compound: "claude-4.5-sonnet",
  simple: "claude-4.5-sonnet",
};

let _presets = null;

function loadPresets() {
  if (_presets) return _presets;
  try {
    _presets = JSON.parse(fs.readFileSync(PRESETS_PATH, "utf8"));
  } catch {
    _presets = {};
  }
  return _presets;
}

function findUserConfig(projectRoot) {
  const candidates = [
    path.join(projectRoot, "gui-patterns.json"),
    path.join(projectRoot, ".cursor", "gui-patterns.json"),
    path.join(projectRoot, "config", "gui-patterns.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Build compiled RegExp array from user config (presets + custom patterns).
 * Returns null if no user config exists (meaning: no content-based GUI detection).
 */
export function loadGuiPatterns(projectRoot) {
  const configPath = findUserConfig(projectRoot);
  if (!configPath) return null;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error(`Warning: failed to parse ${configPath}: ${err.message}`);
    return null;
  }

  const presets = loadPresets();
  const patternStrings = [];

  if (Array.isArray(config.presets)) {
    for (const name of config.presets) {
      const preset = presets[name];
      if (!preset) {
        console.error(`Warning: unknown GUI preset '${name}' in ${configPath}. Available: ${Object.keys(presets).filter(k => !k.startsWith("_")).join(", ")}`);
        continue;
      }
      patternStrings.push(...preset.patterns);
    }
  }

  if (Array.isArray(config.customPatterns)) {
    patternStrings.push(...config.customPatterns);
  }

  if (patternStrings.length === 0) return null;

  const compiled = patternStrings.map((p) => {
    try {
      return new RegExp(p, "i");
    } catch (err) {
      console.error(`Warning: invalid GUI pattern '${p}': ${err.message}`);
      return null;
    }
  }).filter(Boolean);

  return compiled.length > 0 ? compiled : null;
}

/**
 * Load model recommendations from user config, with defaults.
 */
export function loadModelRecommendations(projectRoot) {
  const configPath = findUserConfig(projectRoot);
  if (!configPath) return { ...DEFAULT_MODEL_RECOMMENDATIONS };

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { ...DEFAULT_MODEL_RECOMMENDATIONS };
  }

  const userRecs = config.modelRecommendations || {};
  const validKeys = new Set(Object.keys(DEFAULT_MODEL_RECOMMENDATIONS));
  for (const key of Object.keys(userRecs)) {
    if (!validKeys.has(key)) {
      console.error(`Warning: unknown modelRecommendations key '${key}' in ${configPath}. Valid keys: ${[...validKeys].join(", ")}`);
    }
  }

  return {
    ...DEFAULT_MODEL_RECOMMENDATIONS,
    ...Object.fromEntries(
      Object.entries(userRecs).filter(([k]) => validKeys.has(k))
    ),
  };
}

/**
 * List available preset names (for help/diagnostics).
 */
export function listPresets() {
  const presets = loadPresets();
  return Object.keys(presets).filter((k) => !k.startsWith("_"));
}
