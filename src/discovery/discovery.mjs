// Agent discovery: which implementer CLIs are installed right now, where,
// and which version. Absent agents are reported, never fatal.
import { ADAPTERS } from "../adapters/index.mjs";
import { childEnv } from "../adapters/base.mjs";
import { probe } from "../relay/process.mjs";
import { SCHEMAS } from "../config/schema.mjs";

/**
 * @param {object} config merged config (agents.<id>.binary / enabled)
 * @param {{ auth?: boolean }} [opts] auth probes are slower; doctor only
 */
export function discoverAgents(config, { auth = false } = {}) {
  const agents = [];
  for (const adapter of ADAPTERS.values()) {
    const agentConfig = config.agents?.[adapter.id] ?? {};
    const detected = adapter.detect(agentConfig.binary ?? null);
    const entry = {
      id: adapter.id,
      displayName: adapter.displayName,
      enabled: agentConfig.enabled !== false,
      installed: detected.installed,
      binaryPath: detected.binaryPath,
      binarySource: detected.source,
      version: null,
      versionError: null,
      authenticated: null,
      authDetail: null,
      capabilities: adapter.getCapabilities(),
    };
    if (!detected.installed) entry.tried = detected.tried;
    if (detected.installed) {
      const v = adapter.getVersion(detected.binaryPath);
      entry.version = v.version;
      entry.versionError = v.error;
      // A binary that cannot even report its version is not usable.
      if (v.error) entry.installed = false;
      if (auth && entry.installed) {
        const a = adapter.checkAuth(detected.binaryPath);
        entry.authenticated = a.authenticated;
        entry.authDetail = a.detail;
      }
    }
    agents.push(entry);
  }
  return { schema: SCHEMAS.agents, discoveredAt: new Date().toISOString(), agents };
}

/** Ask an installed agent for its real model ids (never invented). */
export function discoverModels(agentEntry) {
  const adapter = ADAPTERS.get(agentEntry.id);
  if (!adapter?.discoverModels) return { source: null, models: [], error: "adapter has no model discovery" };
  if (!agentEntry.installed) return { source: null, models: [], error: "agent not installed" };
  const ctx = { probe: (args) => probe(agentEntry.binaryPath, args, { env: childEnv(adapter), timeoutMs: 20_000 }) };
  try {
    return adapter.discoverModels(ctx);
  } catch (error) {
    return { source: null, models: [], error: error.message };
  }
}
