// pi-ai model catalog: the same provider library DeepSeek Harness uses.
//
// Smart Delegate does not depend on pi-ai. It locates the copy installed with
// the harness (or an explicit directory) and reads two things from it:
//   - catalog FACTS per model: context window, max output, image input,
//     reasoning, price per million tokens -> contextWindow / vision / costTier
//   - which provider API-key environment variables are set (names only,
//     via pi-ai's own findEnvKeys; values are never read or stored)
// It never imports capability *scores*: the catalog knows prices and limits,
// not quality. Stored sign-ins (OAuth) live in the harness's credential store
// and are deliberately not inspected.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const PI_AI = ["@earendil-works", "pi-ai"];
const LLM_PI_AI = ["@deepseek-ai", "dsh-llm-pi-ai"];

function findUp(start, segments) {
  let dir = start;
  for (;;) {
    const candidate = join(dir, "node_modules", ...segments);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Locate pi-ai: SMART_DELEGATE_PI_AI_DIR, config catalog.piAiDir, then next to
 * the harness binary (hoisted npm layout, or pnpm's nested one through
 * @deepseek-ai/dsh-llm-pi-ai).
 * @returns {{ dir: string|null, source: string }}
 */
export function locatePiAi({ config = {}, dshBinary = null } = {}) {
  const explicit = process.env.SMART_DELEGATE_PI_AI_DIR || config.catalog?.piAiDir;
  if (explicit) {
    return existsSync(join(explicit, "package.json")) ? { dir: realpathSync(explicit), source: "explicit" } : { dir: null, source: `explicit path not found: ${explicit}` };
  }
  if (!dshBinary) return { dir: null, source: "no DeepSeek Harness (dsh) installation found" };
  const start = dirname(realpathSync(dshBinary));
  const direct = findUp(start, PI_AI);
  if (direct) return { dir: direct, source: "dsh installation" };
  const llm = findUp(start, LLM_PI_AI);
  const nested = llm ? findUp(llm, PI_AI) : null;
  if (nested) return { dir: nested, source: "dsh installation (via dsh-llm-pi-ai)" };
  return { dir: null, source: `pi-ai not found near ${dshBinary}` };
}

/** Load the catalog module and env-key helper from a pi-ai directory. */
export async function loadPiAi(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const catalog = await import(pathToFileURL(join(dir, "dist", "models.generated.js")).href);
  const env = await import(pathToFileURL(join(dir, "dist", "env-api-keys.js")).href);
  const providers = {};
  for (const [provider, models] of Object.entries(catalog.MODELS ?? {})) {
    providers[provider] = Array.isArray(models) ? models : Object.values(models);
  }
  return { version: pkg.version, providers, findEnvKeys: env.findEnvKeys };
}

/**
 * Relative cost tier (1 cheapest .. 5 priciest) from the output price per
 * million tokens. Zero or missing prices (subscription endpoints) are unknown.
 */
export function costTierFromPrice(cost, thresholds = [1, 4, 12, 30]) {
  const out = cost?.output;
  if (typeof out !== "number" || out <= 0) return null;
  const tier = thresholds.findIndex((t) => out <= t);
  return tier === -1 ? 5 : tier + 1;
}

/** Facts for one catalog model, tagged with their source. */
export function factsFor(model, version, retrievedAt = new Date().toISOString()) {
  return {
    contextWindow: Number.isInteger(model.contextWindow) ? model.contextWindow : null,
    vision: Array.isArray(model.input) ? model.input.includes("image") : null,
    costTier: costTierFromPrice(model.cost),
    maxTokens: Number.isInteger(model.maxTokens) ? model.maxTokens : null,
    reasoning: typeof model.reasoning === "boolean" ? model.reasoning : null,
    pricePerMTok: model.cost && typeof model.cost.output === "number" ? { input: model.cost.input ?? null, output: model.cost.output } : null,
    catalogId: model.id,
    source: `pi-ai@${version}`,
    retrievedAt,
  };
}

const FACT_FIELDS = ["contextWindow", "vision", "costTier"];

/**
 * Registry updates for the user layer.
 *  - existing entries whose catalog model is known (harness provider+model,
 *    or an explicit/observed `catalogId`) get their facts refreshed
 *  - new `deepseek-harness/<provider>/<model>` candidates for the requested
 *    providers, experimental and unrated
 * A top-level fact is only written when the user has not set it themselves
 * (the user layer records which fields the catalog owns in facts.fields).
 */
export function catalogUpdates({ entries, userEntries, catalog, providers = [], observed = {}, agents = ["deepseek-harness"] }) {
  const byCatalog = new Map();
  for (const [provider, models] of Object.entries(catalog.providers)) {
    for (const m of models) byCatalog.set(`${provider}|${m.id}`, m);
  }
  const findModel = (entry) => {
    if (agents.includes(entry.agent) && entry.provider && entry.model) return byCatalog.get(`${entry.provider}|${entry.model}`) ?? null;
    const id = entry.catalogId ?? observed[entry.id] ?? null;
    if (!id) return null;
    for (const [key, m] of byCatalog) if (key.endsWith(`|${id}`)) return m;
    return null;
  };
  const userById = new Map(userEntries.map((e) => [e.id, e]));
  const updates = [];
  const skipped = [];
  const retrievedAt = new Date().toISOString();

  for (const entry of entries) {
    const model = findModel(entry);
    if (!model) continue;
    const facts = factsFor(model, catalog.version, retrievedAt);
    const user = userById.get(entry.id);
    const owned = new Set(user?.facts?.fields ?? []);
    const patch = { id: entry.id, facts: { ...facts, fields: [] } };
    if (!entry.catalogId && observed[entry.id]) patch.catalogId = observed[entry.id];
    for (const field of FACT_FIELDS) {
      const userSet = user && field in user && !owned.has(field);
      if (userSet) {
        skipped.push(`${entry.id}.${field} (set by you)`);
        continue;
      }
      if (facts[field] !== null) {
        patch[field] = facts[field];
        patch.facts.fields.push(field);
      }
    }
    updates.push(patch);
  }

  const existing = new Set(entries.map((e) => e.id));
  for (const agent of agents) for (const provider of providers) {
    for (const m of catalog.providers[provider] ?? []) {
      const id = `${agent}/${provider}/${m.id}`;
      if (existing.has(id)) continue;
      const facts = factsFor(m, catalog.version, retrievedAt);
      updates.push({
        id, agent, provider, model: m.id, enabled: true, status: "experimental",
        source: `catalog: pi-ai@${catalog.version}`, confidence: 0.1, capabilities: {},
        contextWindow: facts.contextWindow, vision: facts.vision, costTier: facts.costTier,
        facts: { ...facts, fields: FACT_FIELDS.filter((f) => facts[f] !== null) },
      });
    }
  }
  return { updates, skipped };
}

/** Which providers have API-key environment variables set (names only). */
export function providerAuth(catalog, env = process.env) {
  return Object.keys(catalog.providers).sort().map((provider) => {
    let keys = [];
    try {
      keys = catalog.findEnvKeys?.(provider, env) ?? [];
    } catch {
      keys = [];
    }
    return { provider, models: catalog.providers[provider].length, envKeys: keys };
  });
}
