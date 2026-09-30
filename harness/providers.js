// Provider configuration is written to Harness' own settings and credential
// services. Smart Delegate never keeps a second copy of an API key.
import { oauthProviders } from "./authorization.js";
const PATH = "/api/smart-delegate/providers";
const HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });
const ROUTE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY = /^[\x21-\x7e]+$/;
const PROTOCOLS = new Set(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]);
const AMBIENT_AUTH = new Set(["amazon-bedrock", "google-vertex"]);
const ACCOUNT_AUTH = new Set(["openai-codex", "github-copilot", "google-gemini-cli"]);
const keyRef = (id) => `${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
const urlIsValid = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash && !url.search;
  } catch { return false; }
};

function services(ctx) {
  const llm = ctx.get?.("llm");
  const settings = ctx.get?.("settings");
  const credentials = ctx.get?.("credentials");
  if (!llm?.listConfigurableProviders || !settings?.describe || !credentials?.describe) {
    throw Object.assign(new Error("Harness provider services are unavailable."), { status: 503 });
  }
  return { llm, settings, credentials };
}

export async function providersView(ctx) {
  const { llm, settings, credentials } = services(ctx);
  const directory = llm.listConfigurableProviders().filter((item) => item.settingsNs === "llm-pi-ai" && ROUTE.test(item.provider));
  const live = new Set(llm.listProviders().map((item) => item.id));
  const descriptor = settings.describe({ redactSecrets: true }).find((item) => item.ns === "llm-pi-ai");
  const profiles = descriptor?.value?.providers ?? {};
  const oauth = oauthProviders(ctx);
  const recordStates = Object.fromEntries(await Promise.all([...oauth.entries()].map(async ([id, entry]) => [id, await credentials.describeRecord(entry.key)])));
  const refs = [...new Set(Object.entries(profiles).map(([id, profile]) => profile?.apiKeyEnv ?? keyRef(id)))];
  const states = await Promise.all(refs.map(async (ref) => [ref, await credentials.describe(ref)]));
  const byRef = Object.fromEntries(states);
  const known = new Map(directory.map((item) => [item.provider, item]));
  const ids = new Set([...Object.keys(profiles), ...Object.entries(recordStates).filter(([, state]) => state?.configured).map(([id]) => id)]);
  const connected = await Promise.all([...ids].filter((id) => ROUTE.test(id)).map(async (id) => {
    const profile = profiles[id] ?? {};
    const ref = profile?.apiKeyEnv ?? keyRef(id);
    const credential = byRef[ref];
    const account = recordStates[id]?.configured === true;
    const custom = !known.has(id) || known.get(id).declared === true;
    const needsKey = Boolean(profile?.apiKeyEnv) || (!custom && !AMBIENT_AUTH.has(id) && !oauth.has(id));
    let availableModels = [];
    let toggleable = false;
    try {
      if (!custom && llm.discoverModels) {
        availableModels = await llm.discoverModels("llm-pi-ai", { provider: id });
        toggleable = availableModels.length > 0;
      }
      else if (Array.isArray(profile.models)) availableModels = profile.models;
      if (!availableModels.length && live.has(id) && llm.listModels) availableModels = await llm.listModels(id);
    } catch {
      if (live.has(id) && llm.listModels) {
        try { availableModels = await llm.listModels(id); } catch { /* Keep the connection visible. */ }
      }
    }
    const selected = Array.isArray(profile.models) && profile.models.length ? new Set(profile.models.map((model) => model.id)) : null;
    return {
      id, name: profile?.displayName || known.get(id)?.displayName || id,
      custom, active: live.has(id), ready: live.has(id) && (account || credential?.configured === true || (!oauth.has(id) && !needsKey)),
      hasKey: credential?.configured === true, keyRequired: needsKey && credential?.configured !== true,
      accountRequired: oauth.has(id) && !account && credential?.configured !== true,
      baseURL: profile?.baseURL ?? "", api: profile?.api ?? "", models: Array.isArray(profile?.models) ? profile.models.map((model) => model.id) : [],
      availableModels: availableModels.map((model) => ({ id: model.id, name: model.name || model.id, enabled: selected ? selected.has(model.id) : true })), toggleable,
    };
  }));
  const catalog = directory.filter((item) => item.declared !== true).map((item) => ({ id: item.provider, name: item.displayName, oauth: oauth.has(item.provider) }));
  const deepseekIndex = catalog.findIndex((item) => item.id === "deepseek");
  catalog.splice(deepseekIndex < 0 ? catalog.length : deepseekIndex + 1, 0, { id: "deepseek-official", name: "DeepSeek", native: true });
  return {
    catalog,
    connected, writable: settings.writable, protocols: [...PROTOCOLS],
  };
}

export async function prepareProvider(ctx, input) {
  const { llm, settings } = services(ctx);
  const id = input?.id;
  if (!settings.writable) throw Object.assign(new Error("Harness settings are read-only."), { status: 403 });
  if (typeof id !== "string" || !ROUTE.test(id) || !oauthProviders(ctx).has(id) || !llm.listConfigurableProviders().some((item) => item.provider === id && item.settingsNs === "llm-pi-ai" && item.declared !== true)) {
    throw Object.assign(new Error("This provider does not support account sign-in."), { status: 400 });
  }
  const descriptor = settings.describe({ redactSecrets: true }).find((item) => item.ns === "llm-pi-ai");
  if (!descriptor) throw Object.assign(new Error("Harness model settings are unavailable."), { status: 503 });
  if (!descriptor.value?.providers?.[id]) await settings.mutate("llm-pi-ai", [{ op: "set", path: ["providers", id], value: {} }], descriptor.revision);
  return providersView(ctx);
}

export async function toggleProviderModel(ctx, input) {
  const { llm, settings } = services(ctx);
  const { id, model, enabled } = input ?? {};
  if (!settings.writable) throw Object.assign(new Error("Harness settings are read-only."), { status: 403 });
  if (typeof id !== "string" || !ROUTE.test(id) || typeof model !== "string" || !model || typeof enabled !== "boolean") {
    throw Object.assign(new Error("Invalid model selection."), { status: 400 });
  }
  const descriptor = settings.describe({ redactSecrets: true }).find((item) => item.ns === "llm-pi-ai");
  const profile = descriptor?.value?.providers?.[id];
  if (!profile || !llm.listConfigurableProviders().some((item) => item.provider === id && item.settingsNs === "llm-pi-ai" && item.declared !== true)) {
    throw Object.assign(new Error("Configure this catalog provider first."), { status: 400 });
  }
  const catalog = await llm.discoverModels("llm-pi-ai", { provider: id });
  if (!catalog.some((entry) => entry.id === model)) throw Object.assign(new Error("Unknown model for this provider."), { status: 400 });
  const current = Array.isArray(profile.models) && profile.models.length ? new Set(profile.models.map((entry) => entry.id)) : new Set(catalog.map((entry) => entry.id));
  if (enabled) current.add(model); else current.delete(model);
  if (!current.size) throw Object.assign(new Error("Keep at least one model enabled."), { status: 400 });
  const path = ["providers", id, "models"];
  const ops = current.size === catalog.length ? [{ op: "unset", path }] : [{ op: "set", path, value: catalog.filter((entry) => current.has(entry.id)).map((entry) => profile.models?.find((saved) => saved.id === entry.id) ?? { id: entry.id }) }];
  await settings.mutate("llm-pi-ai", ops, descriptor.revision);
  return providersView(ctx);
}

export async function connectProvider(ctx, input) {
  const { llm, settings, credentials } = services(ctx);
  if (!settings.writable) throw Object.assign(new Error("Harness settings are read-only."), { status: 403 });
  const id = input?.id;
  if (typeof id !== "string" || !ROUTE.test(id)) throw Object.assign(new Error("Invalid provider ID."), { status: 400 });
  if (id === "deepseek-official") throw Object.assign(new Error("Use Harness Models to configure the official DeepSeek provider."), { status: 400 });
  const directory = llm.listConfigurableProviders();
  const catalog = directory.find((item) => item.provider === id && item.settingsNs === "llm-pi-ai" && item.declared !== true);
  const descriptor = settings.describe({ redactSecrets: true }).find((item) => item.ns === "llm-pi-ai");
  if (!descriptor) throw Object.assign(new Error("Harness model settings are unavailable."), { status: 503 });
  const existing = descriptor.value?.providers?.[id];
  const custom = !catalog;
  if (ACCOUNT_AUTH.has(id)) throw Object.assign(new Error("Use Harness Models to sign in to this provider."), { status: 400 });
  const key = input?.apiKey ?? "";
  if (typeof key !== "string" || key.length > 512 || (key && (!KEY.test(key) || key.trim() !== key))) {
    throw Object.assign(new Error("Invalid API key format."), { status: 400 });
  }
  const profile = {};
  if (custom) {
    if (typeof input?.name !== "string" || !input.name.trim() || input.name.length > 80) throw Object.assign(new Error("Enter a provider name."), { status: 400 });
    if (typeof input?.baseURL !== "string" || !urlIsValid(input.baseURL)) throw Object.assign(new Error("Enter a valid HTTP endpoint URL."), { status: 400 });
    if (!PROTOCOLS.has(input?.api)) throw Object.assign(new Error("Choose a supported API protocol."), { status: 400 });
    if (!Array.isArray(input?.models) || input.models.length < 1 || input.models.length > 30 || input.models.some((model) => typeof model !== "string" || !model.trim() || model.length > 120)) {
      throw Object.assign(new Error("Enter at least one model ID."), { status: 400 });
    }
    Object.assign(profile, { displayName: input.name.trim(), baseURL: input.baseURL, api: input.api, models: input.models.map((model) => ({ id: model.trim() })) });
  }
  if (key && !existing?.apiKeyEnv) profile.apiKeyEnv = keyRef(id);
  if (!key && !existing && !custom && !AMBIENT_AUTH.has(id)) throw Object.assign(new Error("Enter an API key for this provider."), { status: 400 });
  // Existing profiles may include secret or advanced fields missing from a
  // redacted view. Name only edited paths; never rebuild the whole profile.
  const ops = existing
    ? Object.entries(profile).filter(([field, value]) => JSON.stringify(existing[field]) !== JSON.stringify(value))
      .map(([field, value]) => ({ op: "set", path: ["providers", id, field], value }))
    : [{ op: "set", path: ["providers", id], value: profile }];
  // The profile must exist first so an interrupted key write remains retryable.
  if (ops.length) await settings.mutate("llm-pi-ai", ops, descriptor.revision);
  if (key) await credentials.set(existing?.apiKeyEnv ?? profile.apiKeyEnv, key);
  return providersView(ctx);
}

export function registerProvidersApi(ctx) {
  ctx.inject(["connection"], (cctx) => {
    if (!cctx.connection?.fetch?.register) return;
    cctx.effect(() => cctx.connection.fetch.register({
      path: PATH, methods: ["GET", "POST"], requestBody: "buffered",
      async fetch(request) {
        try {
          if (request.method === "GET") return respond(await providersView(cctx));
          const raw = await request.text();
          if (raw.length > 16 * 1024) return respond({ error: "Provider request is too large." }, 413);
          let input;
          try { input = JSON.parse(raw); } catch { return respond({ error: "Invalid JSON." }, 400); }
          if (input?.action === "prepare") return respond(await prepareProvider(cctx, input));
          if (input?.action === "toggle-model") return respond(await toggleProviderModel(cctx, input));
          return respond(await connectProvider(cctx, input));
        } catch (error) { return respond({ error: error.message }, error.status ?? 500); }
      },
    }), "smart-delegate: providers API");
  });
}
