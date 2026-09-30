// Browser-authenticated settings endpoint for the DeepSeek Harness client.
// The Connection service applies its Host/Origin and session-cookie policy to
// every /api route before dispatching this handler.
import { delegationSnapshot, saveDelegation } from "../src/config/delegation.mjs";
import { loadConfig, stateHome } from "../src/config/config.mjs";
import { discoverAgents } from "../src/discovery/discovery.mjs";
import { loadRegistry } from "../src/registry/registry.mjs";

const PATH = "/api/smart-delegate/settings";
const HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });
const safeEndpoint = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
};

// The web profile and delegated headless profile are separate. Carry only
// non-secret endpoint/catalog settings into a run; credentials stay in DSH's
// shared credential store or in environment variables.
export function providerProfilesFromSettings(ctx) {
  try {
    const settings = ctx.get?.("settings");
    const row = settings?.describe?.({ redactSecrets: true })?.find((entry) => entry.ns === "llm-pi-ai");
    const providers = row?.user?.providers && typeof row.user.providers === "object" ? row.user.providers : {};
    const result = {};
    const profileFields = ["displayName", "api", "baseURL", "apiKeyEnv", "defaultContextWindow", "defaultMaxTokens", "defaultInput"];
    const modelFields = ["id", "name", "contextWindow", "maxTokens", "input", "reasoningEfforts", "compat"];
    for (const [id, profile] of Object.entries(providers)) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !profile || typeof profile !== "object") continue;
      const safe = {};
      for (const field of profileFields) if (profile[field] !== undefined) safe[field] = profile[field];
      if (safe.baseURL) {
        if (!safeEndpoint(safe.baseURL)) {
          result[id] = { __invalid: "unsupported endpoint URL" };
          continue;
        }
      }
      if (safe.apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(safe.apiKeyEnv)) delete safe.apiKeyEnv;
      if (Array.isArray(profile.models)) safe.models = profile.models.map((model) => Object.fromEntries(modelFields.filter((field) => model?.[field] !== undefined).map((field) => [field, model[field]])));
      if (profile.modelOverrides && typeof profile.modelOverrides === "object") {
        safe.modelOverrides = Object.fromEntries(Object.entries(profile.modelOverrides).map(([model, value]) =>
          [model, Object.fromEntries(modelFields.filter((field) => field !== "id" && value?.[field] !== undefined).map((field) => [field, value[field]]))]));
      }
      if (Object.keys(safe).length) result[id] = safe;
    }
    const deepseek = settings.describe({ redactSecrets: true }).find((entry) => entry.ns === "llm-deepseek")?.user;
    if (deepseek && typeof deepseek === "object") {
      const safe = Object.fromEntries(["baseURL", "thinking", "reasoningEffort", "maxTokens", "defaultContextWindow", "models"]
        .filter((field) => deepseek[field] !== undefined).map((field) => [field, deepseek[field]]));
      if (safe.baseURL) {
        if (!safeEndpoint(safe.baseURL)) {
          result["deepseek-official"] = { __invalid: "unsupported endpoint URL" };
        }
      }
      if (!result["deepseek-official"] && Object.keys(safe).length) result["deepseek-official"] = { __row: "llm-deepseek", ...safe };
    }
    return JSON.stringify(result).length <= 32 * 1024 ? result : {};
  } catch { return {}; }
}

async function liveModels(llm) {
  if (!llm?.listProviders || !llm?.listModels) return [];
  const providers = llm.listProviders();
  return Promise.all(providers.map(async ({ id, name }) => {
    try {
      const models = await llm.listModels(id);
      return { id, name, models: models.map((m) => ({ id: m.id, name: m.name, inputModalities: m.inputModalities ?? [] })) };
    } catch (error) {
      return { id, name, models: [], error: error.message };
    }
  }));
}

export async function settingsView({ home = stateHome(), llm = null } = {}) {
  const { delegation, revision } = delegationSnapshot(home);
  const { config } = loadConfig({ home });
  const registry = loadRegistry({ home });
  const agents = discoverAgents(config).agents;
  const installed = new Set(agents.filter((a) => a.installed && a.enabled).map((a) => a.id));
  return {
    delegation,
    revision,
    providers: await liveModels(llm),
    agentModels: registry.entries.filter((e) => installed.has(e.agent) && e.agent !== "deepseek-harness" && e.agent !== "pi-agent")
      .map((e) => ({ id: e.id, agent: e.agent, provider: e.provider, model: e.model, enabled: e.enabled, status: e.status })),
  };
}

export function registerSettingsApi(ctx) {
  ctx.inject(["connection"], (cctx) => {
    if (!cctx.connection?.fetch?.register) return;
    cctx.effect(() => cctx.connection.fetch.register({
      path: PATH,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      async fetch(request) {
        try {
          if (request.method === "GET") return respond(await settingsView({ llm: cctx.get?.("llm") }));
          const raw = await request.text();
          if (raw.length > 64 * 1024) return respond({ error: "Settings request is too large." }, 413);
          let body;
          try { body = JSON.parse(raw); } catch { return respond({ error: "Invalid JSON." }, 400); }
          const saved = saveDelegation(body?.delegation, body?.revision, stateHome());
          return respond(saved);
        } catch (error) {
          return respond({ error: error.message }, error.status ?? 500);
        }
      },
    }), "smart-delegate: settings API");
  });
}
