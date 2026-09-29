import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { builtinDefaults } from "../../src/config/config.mjs";
import { catalogUpdates, costTierFromPrice, loadPiAi, locatePiAi, providerAuth } from "../../src/catalog/pi-ai.mjs";
import { profileTask } from "../../src/profiler/task.mjs";
import { normalizeEntry } from "../../src/registry/registry.mjs";
import { route } from "../../src/routing/router.mjs";
import { ROOT, discovered, entry, tempDir } from "../helpers/env.mjs";

const FIXTURE = join(ROOT, "fixtures", "fake-pi-ai");
const config = builtinDefaults();

function fakePackage(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
}

describe("pi-ai catalog", () => {
  it("locates pi-ai next to a hoisted npm dsh install", () => {
    const root = tempDir("sd npm ");
    const bin = join(root, "node_modules", "@deepseek-ai", "dsh", "lib");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "bin.js"), "");
    fakePackage(join(root, "node_modules", "@earendil-works", "pi-ai"), "@earendil-works/pi-ai");
    const found = locatePiAi({ dshBinary: join(bin, "bin.js") });
    assert.equal(found.dir, join(root, "node_modules", "@earendil-works", "pi-ai"));
  });

  it("locates pi-ai through dsh-llm-pi-ai in a pnpm layout", () => {
    const root = tempDir("sd pnpm ");
    const store = join(root, "node_modules", ".pnpm");
    const dshDir = join(store, "dsh@1", "node_modules", "@deepseek-ai", "dsh", "lib");
    mkdirSync(dshDir, { recursive: true });
    writeFileSync(join(dshDir, "bin.js"), "");
    const llmReal = join(store, "llm@1", "node_modules", "@deepseek-ai", "dsh-llm-pi-ai");
    fakePackage(llmReal, "@deepseek-ai/dsh-llm-pi-ai");
    fakePackage(join(store, "llm@1", "node_modules", "@earendil-works", "pi-ai"), "@earendil-works/pi-ai");
    symlinkSync(llmReal, join(store, "dsh@1", "node_modules", "@deepseek-ai", "dsh-llm-pi-ai"));
    const found = locatePiAi({ dshBinary: join(dshDir, "bin.js") });
    assert.match(found.source, /via dsh-llm-pi-ai/);
    assert.ok(found.dir.endsWith(join("llm@1", "node_modules", "@earendil-works", "pi-ai")));
  });

  it("reports a clear reason when pi-ai cannot be found", () => {
    assert.equal(locatePiAi({}).dir, null);
    assert.match(locatePiAi({ config: { catalog: { piAiDir: "/nope" } } }).source, /not found/);
  });

  it("cost tiers come from output price; zero-price subscriptions are unknown", () => {
    assert.equal(costTierFromPrice({ output: 0.5 }), 1);
    assert.equal(costTierFromPrice({ output: 2.2 }), 2);
    assert.equal(costTierFromPrice({ output: 5 }), 3);
    assert.equal(costTierFromPrice({ output: 25 }), 4);
    assert.equal(costTierFromPrice({ output: 50 }), 5);
    assert.equal(costTierFromPrice({ output: 0 }), null);
    assert.equal(costTierFromPrice(undefined), null);
  });

  it("key presence reports variable names only", async () => {
    const catalog = await loadPiAi(FIXTURE);
    const auth = providerAuth(catalog, { ANTHROPIC_API_KEY: "sk-ant-secret-value" });
    const anthropic = auth.find((a) => a.provider === "anthropic");
    assert.deepEqual(anthropic.envKeys, ["ANTHROPIC_API_KEY"]);
    assert.doesNotMatch(JSON.stringify(auth), /secret-value/);
  });

  it("imports facts (never scores), keeps user-set fields, and adds experimental candidates", async () => {
    const catalog = await loadPiAi(FIXTURE);
    const entries = [
      entry("claude/big", { model: "big", contextWindow: null }),
      entry("deepseek-harness/zai/glm-x", { agent: "deepseek-harness", provider: "zai", model: "glm-x", contextWindow: null }),
    ].map(normalizeEntry);
    const userEntries = [{ id: "deepseek-harness/zai/glm-x", costTier: 1 }];
    const observed = { "claude/big": "claude-big-9" };
    const { updates, skipped } = catalogUpdates({ entries, userEntries, catalog, providers: ["anthropic"], observed });

    const alias = updates.find((u) => u.id === "claude/big");
    assert.equal(alias.catalogId, "claude-big-9", "alias mapped only from an observed run");
    assert.equal(alias.contextWindow, 1000000);
    assert.equal(alias.vision, true);
    assert.equal(alias.costTier, 5);
    assert.equal(alias.capabilities, undefined, "no capability scores imported");

    const glm = updates.find((u) => u.id === "deepseek-harness/zai/glm-x");
    assert.equal(glm.costTier, undefined, "user's cost tier kept");
    assert.equal(glm.contextWindow, 204800);
    assert.ok(skipped.some((s) => /glm-x\.costTier/.test(s)));

    const added = updates.filter((u) => u.agent === "deepseek-harness" && u.provider === "anthropic");
    assert.equal(added.length, 2);
    for (const a of added) {
      assert.equal(a.status, "experimental");
      assert.deepEqual(a.capabilities, {});
      assert.match(a.facts.source, /^pi-ai@/);
    }

    const noEvidence = catalogUpdates({ entries, userEntries: [], catalog, providers: [], observed: {} });
    assert.equal(noEvidence.updates.some((u) => u.id === "claude/big"), false, "no guessing alias -> id");
  });

  it("imported harness candidates never win automatically; explicit override works", async () => {
    const catalog = await loadPiAi(FIXTURE);
    const { updates } = catalogUpdates({ entries: [], userEntries: [], catalog, providers: ["anthropic"], observed: {} });
    const entries = [...updates.map(normalizeEntry), normalizeEntry(entry("claude/opus", { model: "opus" }))];
    const profile = profileTask("Implement a CSV export feature", { config });
    const auto = route({ profile, config, entries, discovery: discovered("claude", "deepseek-harness"), request: {} });
    assert.equal(auto.primary.id, "claude/opus");
    const forced = route({ profile, config, entries, discovery: discovered("claude", "deepseek-harness"), request: { agent: "deepseek-harness", model: "claude-big-9" } });
    assert.equal(forced.primary.id, "deepseek-harness/anthropic/claude-big-9");
    assert.equal(forced.primary.provider, "anthropic");
  });
});
