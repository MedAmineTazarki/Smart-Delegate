import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { connectProvider, prepareProvider, providersView, toggleProviderModel } from "../../harness/providers.js";

function fixture() {
  const profiles = { anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY", headers: { "x-private": "keep" } } };
  const writes = [];
  const stored = [];
  const settings = {
    writable: true,
    describe: () => [{ ns: "llm-pi-ai", revision: 3, value: { providers: profiles } }],
    async mutate(ns, ops, revision) {
      writes.push({ ns, ops, revision });
      for (const op of ops) {
        if (op.path.length === 2) profiles[op.path[1]] = op.value;
        else if (op.op === "unset") delete profiles[op.path[1]][op.path[2]];
        else profiles[op.path[1]][op.path[2]] = op.value;
      }
    },
  };
  const llm = {
    listConfigurableProviders: () => ["anthropic", "baseten", "openai-codex"].map((provider) => ({ provider, displayName: provider, settingsNs: "llm-pi-ai", declared: false })),
    listProviders: () => Object.keys(profiles).map((id) => ({ id })),
    discoverModels: async (_ns, { provider }) => provider === "openai-codex" ? [{ id: "codex-a", name: "Codex A" }, { id: "codex-b", name: "Codex B" }] : [{ id: "default", name: "Default" }],
  };
  const credentials = {
    describe: async (ref) => ({ configured: stored.some((entry) => entry.ref === ref) }),
    describeRecord: async () => ({ configured: false }),
    set: async (ref, value) => { stored.push({ ref, value }); },
  };
  return { ctx: { get: (name) => ({ llm, settings, credentials })[name] }, profiles, writes, stored };
}

describe("Harness provider connections", () => {
  it("stores a catalog API key in Harness and activates its profile", async () => {
    const { ctx, profiles, writes, stored } = fixture();
    const view = await connectProvider(ctx, { id: "baseten", apiKey: "test-key" });
    assert.deepEqual(profiles.baseten, { apiKeyEnv: "BASETEN_API_KEY" });
    assert.deepEqual(stored, [{ ref: "BASETEN_API_KEY", value: "test-key" }]);
    assert.equal(writes[0].revision, 3);
    assert.equal(view.connected.find((row) => row.id === "baseten")?.ready, true);
  });

  it("does not overwrite advanced fields when rotating a key", async () => {
    const { ctx, profiles, writes, stored } = fixture();
    await connectProvider(ctx, { id: "anthropic", apiKey: "replacement" });
    assert.equal(writes.length, 0);
    assert.deepEqual(profiles.anthropic.headers, { "x-private": "keep" });
    assert.deepEqual(stored, [{ ref: "ANTHROPIC_API_KEY", value: "replacement" }]);
  });

  it("adds a keyless custom endpoint and edits only its changed fields", async () => {
    const { ctx, profiles, writes } = fixture();
    const input = { id: "local-demo", name: "Local Demo", baseURL: "http://127.0.0.1:9999/v1", api: "openai-completions", models: ["demo-model"] };
    await connectProvider(ctx, input);
    assert.deepEqual(profiles["local-demo"].models, [{ id: "demo-model" }]);
    profiles["local-demo"].headers = { "x-private": "keep" };
    await connectProvider(ctx, { ...input, name: "Updated Demo" });
    assert.deepEqual(writes[1].ops, [{ op: "set", path: ["providers", "local-demo", "displayName"], value: "Updated Demo" }]);
    assert.deepEqual(profiles["local-demo"].headers, { "x-private": "keep" });
    assert.equal((await providersView(ctx)).connected.find((row) => row.id === "local-demo")?.ready, true);
  });

  it("rejects invalid endpoint URLs before writing", async () => {
    const { ctx, writes } = fixture();
    await assert.rejects(connectProvider(ctx, { id: "bad", name: "Bad", baseURL: "file:///etc/passwd", api: "openai-completions", models: ["demo"] }), /valid HTTP endpoint/);
    assert.equal(writes.length, 0);
  });

  it("shows a signed-in OAuth provider as ready", async () => {
    const { ctx, profiles } = fixture();
    profiles["openai-codex"] = {};
    ctx.get("credentials").describeRecord = async () => ({ configured: true });
    const withAuthorization = { get: (name) => name === "authorization"
      ? { list: () => [{ key: "llm-pi-ai/openai-codex", methods: [{ id: "oauth", label: "Sign in" }] }] }
      : ctx.get(name) };
    const view = await providersView(withAuthorization);
    assert.equal(view.connected.find((row) => row.id === "openai-codex")?.ready, true);
    assert.equal(view.catalog.find((row) => row.id === "deepseek-official")?.native, true);
  });

  it("adds a signed-out account provider and persists its model switches", async () => {
    const { ctx, profiles } = fixture();
    const withAuthorization = { get: (name) => name === "authorization"
      ? { list: () => [{ key: "llm-pi-ai/openai-codex", methods: [{ id: "oauth", label: "Sign in" }] }] }
      : ctx.get(name) };
    const prepared = await prepareProvider(withAuthorization, { id: "openai-codex" });
    const account = prepared.connected.find((row) => row.id === "openai-codex");
    assert.equal(account.accountRequired, true);
    assert.deepEqual(account.availableModels.map((model) => [model.id, model.enabled]), [["codex-a", true], ["codex-b", true]]);

    const disabled = await toggleProviderModel(withAuthorization, { id: "openai-codex", model: "codex-a", enabled: false });
    assert.deepEqual(profiles["openai-codex"].models, [{ id: "codex-b" }]);
    assert.deepEqual(disabled.connected.find((row) => row.id === "openai-codex").availableModels.map((model) => model.enabled), [false, true]);
    await assert.rejects(toggleProviderModel(withAuthorization, { id: "openai-codex", model: "codex-b", enabled: false }), /at least one/);
    await toggleProviderModel(withAuthorization, { id: "openai-codex", model: "codex-a", enabled: true });
    assert.equal(profiles["openai-codex"].models, undefined);
  });
});
