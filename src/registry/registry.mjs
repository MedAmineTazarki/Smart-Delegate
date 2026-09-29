// Model registry: data, not code. Each entry is one agent + model pair.
// Layers (later wins, merged per entry id):
//   config/capabilities.json < ~/.smart-delegate/models.json
//   < <repo>/.smart-delegate/models.json < --registry <file>
// The router never names a model; it only reads these entries.
import { join } from "node:path";
import { PACKAGE_ROOT, projectPaths, stateHome, statePaths } from "../config/config.mjs";
import { SCHEMAS, loadSchema, validate } from "../config/schema.mjs";
import { readJson, withLock, writeJsonAtomic } from "../utils/fs.mjs";
import { clamp01, deepMerge } from "../utils/misc.mjs";

export const CAPABILITY_KEYS = [
  "coding",
  "reasoning",
  "reliability",
  "quality",
  "architecture",
  "toolUse",
  "speed",
  "costEfficiency",
];

/** Prior used for a capability nobody has measured yet. */
export const UNKNOWN_CAPABILITY = 0.5;

function loadLayer(path, label, { optional = true } = {}) {
  const read = readJson(path);
  if (read.missing) {
    if (optional) return null;
    throw Object.assign(new Error(`${label} not found: ${path}`), { code: "SD_REGISTRY" });
  }
  if (!read.ok) throw Object.assign(new Error(`${label} is corrupt: ${read.error}`), { code: "SD_REGISTRY" });
  const errors = validate(loadSchema("registry"), read.value);
  if (errors.length) {
    throw Object.assign(new Error(`${label} (${path}) is invalid:\n  ${errors.slice(0, 10).join("\n  ")}`), {
      code: "SD_REGISTRY",
    });
  }
  return read.value;
}

/** Fill defaults and derived values so the router can rely on a full shape. */
export function normalizeEntry(raw) {
  const entry = {
    enabled: true,
    status: "stable",
    local: false,
    provider: null,
    model: null,
    contextWindow: null,
    vision: null,
    costTier: null,
    costPerTaskUsd: null,
    source: "unknown",
    confidence: 0.2,
    effort: null,
    ...raw,
    capabilities: { ...(raw.capabilities ?? {}) },
    taskFit: { ...(raw.taskFit ?? {}) },
  };
  if (!entry.agent) {
    const slash = entry.id.indexOf("/");
    if (slash <= 0) throw Object.assign(new Error(`registry entry "${entry.id}" has no agent`), { code: "SD_REGISTRY" });
    entry.agent = entry.id.slice(0, slash);
  }
  // Cost efficiency is derived from the relative cost tier unless measured.
  if (entry.capabilities.costEfficiency === undefined && entry.costTier !== null) {
    entry.capabilities.costEfficiency = clamp01((5 - entry.costTier) / 4);
  }
  return entry;
}

/**
 * @param {{ repoRoot?: string|null, home?: string, registryPath?: string|null }} [opts]
 * @returns {{ entries: object[], sources: string[] }}
 */
export function loadRegistry({ repoRoot = null, home = stateHome(), registryPath = null } = {}) {
  const layers = [[join(PACKAGE_ROOT, "config", "capabilities.json"), "built-in registry", false]];
  layers.push([statePaths(home).models, "user registry", true]);
  if (repoRoot) layers.push([projectPaths(repoRoot).models, "project registry", true]);
  if (registryPath) layers.push([registryPath, "registry file", false]);

  const byId = new Map();
  const sources = [];
  for (const [path, label, optional] of layers) {
    const layer = loadLayer(path, label, { optional });
    if (!layer) continue;
    sources.push(path);
    for (const raw of layer.models) {
      byId.set(raw.id, byId.has(raw.id) ? deepMerge(byId.get(raw.id), raw) : raw);
    }
  }
  return { entries: [...byId.values()].map(normalizeEntry), sources };
}

/**
 * Merge entries into the user registry (~/.smart-delegate/models.json).
 * Used by `models --discover --save`. Locked + atomic.
 */
export function saveUserEntries(newEntries, home = stateHome()) {
  const paths = statePaths(home);
  return withLock(paths.lock, () => {
    const read = readJson(paths.models);
    if (!read.ok && !read.missing) {
      throw Object.assign(new Error(`${paths.models} is corrupt (${read.error}); refusing to overwrite`), {
        code: "SD_REGISTRY",
      });
    }
    const current = read.ok ? read.value : { schema: SCHEMAS.registry, models: [] };
    const byId = new Map(current.models.map((m) => [m.id, m]));
    let added = 0;
    for (const entry of newEntries) {
      if (byId.has(entry.id)) continue; // never clobber user-curated entries
      byId.set(entry.id, entry);
      added += 1;
    }
    const next = { schema: SCHEMAS.registry, updatedAt: new Date().toISOString(), models: [...byId.values()] };
    writeJsonAtomic(paths.models, next);
    return { path: paths.models, added };
  });
}

/**
 * Field-level merge into the user registry: patches update existing user
 * entries (deep merge; `facts` replaced wholesale) or are added as partial
 * overrides layered over built-in entries. Locked + atomic.
 */
export function mergeUserEntries(patches, home = stateHome()) {
  const paths = statePaths(home);
  return withLock(paths.lock, () => {
    const read = readJson(paths.models);
    if (!read.ok && !read.missing) {
      throw Object.assign(new Error(`${paths.models} is corrupt (${read.error}); refusing to overwrite`), { code: "SD_REGISTRY" });
    }
    const current = read.ok ? read.value : { schema: SCHEMAS.registry, models: [] };
    const byId = new Map(current.models.map((m) => [m.id, m]));
    let added = 0;
    let updated = 0;
    for (const patch of patches) {
      const prev = byId.get(patch.id);
      if (prev) {
        const { facts, ...rest } = patch;
        byId.set(patch.id, { ...deepMerge(prev, rest), ...(facts ? { facts } : {}) });
        updated += 1;
      } else {
        byId.set(patch.id, patch);
        added += 1;
      }
    }
    writeJsonAtomic(paths.models, { schema: SCHEMAS.registry, updatedAt: new Date().toISOString(), models: [...byId.values()] });
    return { path: paths.models, added, updated };
  });
}

/** Raw entries of the user layer (for "who set this field" decisions). */
export function readUserEntries(home = stateHome()) {
  const read = readJson(statePaths(home).models);
  return read.ok ? read.value.models ?? [] : [];
}
