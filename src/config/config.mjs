// Configuration hierarchy:
//   built-in defaults (config/defaults.json)
//     < global user config (~/.smart-delegate/config.json)
//     < project config (<repo>/.smart-delegate/config.json)
//     < request / CLI overrides (applied by the caller)
// Corrupt or invalid layers are reported as errors, never silently ignored:
// a broken config must not quietly change routing.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJsonAtomic, withLock } from "../utils/fs.mjs";
import { deepMerge } from "../utils/misc.mjs";
import { SCHEMAS, validate, loadSchema } from "./schema.mjs";

export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function stateHome() {
  return process.env.SMART_DELEGATE_HOME || join(homedir(), ".smart-delegate");
}

export function statePaths(home = stateHome()) {
  return {
    home,
    config: join(home, "config.json"),
    agents: join(home, "agents.json"),
    models: join(home, "models.json"),
    history: join(home, "history.jsonl"),
    runs: join(home, "runs"),
    lock: join(home, ".lock"),
  };
}

export function projectPaths(repoRoot) {
  const dir = join(repoRoot, ".smart-delegate");
  return { dir, config: join(dir, "config.json"), models: join(dir, "models.json") };
}

let defaultsCache = null;
export function builtinDefaults() {
  defaultsCache ??= JSON.parse(readFileSync(join(PACKAGE_ROOT, "config", "defaults.json"), "utf8"));
  return structuredClone(defaultsCache);
}

function loadLayer(path, label) {
  const read = readJson(path);
  if (read.missing) return null;
  if (!read.ok) {
    const error = new Error(`${label} is not valid JSON (${read.error}). Fix or remove it; Smart Delegate will not guess.`);
    error.code = "SD_CONFIG";
    throw error;
  }
  const errors = validate(loadSchema("config"), read.value);
  if (errors.length) {
    const error = new Error(`${label} (${path}) is invalid:\n  ${errors.slice(0, 10).join("\n  ")}`);
    error.code = "SD_CONFIG";
    throw error;
  }
  return read.value;
}

/**
 * @param {{ repoRoot?: string|null, home?: string, overrides?: object }} [opts]
 * @returns {{ config: object, sources: string[] }}
 */
export function loadConfig({ repoRoot = null, home = stateHome(), overrides = null } = {}) {
  let config = builtinDefaults();
  const sources = ["builtin:config/defaults.json"];
  const global = loadLayer(statePaths(home).config, "global config");
  if (global) {
    config = deepMerge(config, global);
    sources.push(statePaths(home).config);
  }
  if (repoRoot) {
    const project = loadLayer(projectPaths(repoRoot).config, "project config");
    if (project) {
      config = deepMerge(config, project);
      sources.push(projectPaths(repoRoot).config);
    }
  }
  if (overrides) {
    config = deepMerge(config, overrides);
    sources.push("request overrides");
  }
  config.schema = SCHEMAS.config;
  return { config, sources };
}

/** Create the global config skeleton if absent (idempotent, locked). */
export function ensureGlobalConfig(home = stateHome()) {
  const paths = statePaths(home);
  return withLock(paths.lock, () => {
    const existing = readJson(paths.config);
    if (existing.ok) return { path: paths.config, created: false };
    if (!existing.missing) {
      throw Object.assign(new Error(`${paths.config} is corrupt (${existing.error}); refusing to overwrite it`), {
        code: "SD_CONFIG",
      });
    }
    writeJsonAtomic(paths.config, {
      schema: SCHEMAS.config,
      routing: { defaultMode: "auto" },
      exclude: { agents: [], providers: [] },
    });
    return { path: paths.config, created: true };
  });
}
