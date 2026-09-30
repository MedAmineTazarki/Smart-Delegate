import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chooseLane, delegationSnapshot, saveDelegation, validateDelegation } from "../../src/config/delegation.mjs";
import { providerProfilesFromSettings } from "../../harness/settings.js";

const lane = (id, categories = []) => ({ id, name: id, responsibility: "", categories, agent: "codex", provider: null, model: null, reasoningEffort: null, enabled: true });

describe("delegation settings", () => {
  it("selects a matching lane, then a default, and reports ambiguous routing", () => {
    const lanes = [lane("build", ["implementation"]), lane("review", ["review"])];
    const profile = { categories: ["review"] };
    assert.equal(chooseLane({ lanes }, profile).lane.id, "review");
    assert.equal(chooseLane({ lanes, defaultLane: "build" }, { categories: ["research"] }).lane.id, "build");
    assert.match(chooseLane({ lanes }, { categories: ["research"] }).error, /Several lanes/);
    assert.match(chooseLane({ lanes }, profile, "missing").error, /not enabled/);
  });

  it("validates and saves with an optimistic revision", () => {
    const home = mkdtempSync(join(tmpdir(), "sd-delegation-"));
    const first = delegationSnapshot(home);
    const value = { ...first.delegation, lanes: [lane("build")], defaultLane: "build" };
    assert.deepEqual(validateDelegation(value), []);
    const saved = saveDelegation(value, first.revision, home);
    assert.equal(delegationSnapshot(home).delegation.defaultLane, "build");
    assert.throws(() => saveDelegation(value, first.revision, home), /changed elsewhere/);
    assert.equal(JSON.parse(readFileSync(join(home, "config.json"))).schema, "smart-delegate.config.v1");
    assert.notEqual(saved.revision, first.revision);
    assert.ok(validateDelegation({ ...value, defaultLane: "missing" }).length);
  });

  it("carries endpoint settings without credential values or request headers", () => {
    const ctx = { get: () => ({ describe: () => [
      { ns: "llm-pi-ai", user: { providers: { local: { api: "openai-completions", baseURL: "http://127.0.0.1:9999/v1", apiKeyEnv: "LOCAL_API_KEY", headers: { Authorization: "secret" }, models: [{ id: "model-a", name: "A" }] } } } },
      { ns: "llm-deepseek", user: { baseURL: "https://example.test", models: [{ id: "deepseek-flash" }] } },
    ] }) };
    const profiles = providerProfilesFromSettings(ctx);
    assert.equal(profiles.local.baseURL, "http://127.0.0.1:9999/v1");
    assert.equal(profiles.local.apiKeyEnv, "LOCAL_API_KEY");
    assert.equal(profiles["deepseek-official"].__row, "llm-deepseek");
    assert.ok(!JSON.stringify(profiles).includes("secret"));
  });
});
