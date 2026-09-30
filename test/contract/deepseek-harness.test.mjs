// DeepSeek Harness adapter specifics, against the fake `dsh`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import harness, { buildPatch, routeDeclared, rowBlock, verifyDump } from "../../src/adapters/deepseek-harness.mjs";
import { fake, tempDir } from "../helpers/env.mjs";

const run = (extra = {}, env = {}) => {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  return harness
    .run({ binaryPath: fake("success"), cwd: tempDir(), brief: "task", outDir: join(tempDir(), "out"), ...extra })
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
};

describe("deepseek-harness adapter", () => {
  it("patch is JSON: a hostile value stays inert data", () => {
    const patch = buildPatch({ cwd: "/repo !!js process.exit(9)", readOnly: false, provider: "anthropic", model: "m", effort: null, declareRoute: true });
    const text = JSON.stringify(patch);
    assert.deepEqual(JSON.parse(text), patch);
    assert.equal(patch.find((r) => r.id === "sandbox-policy").config.workspaceRoot, "/repo !!js process.exit(9)");
    assert.deepEqual(patch.find((r) => r.id === "llm-pi-ai").config.providers, { anthropic: {} });
  });

  it("rejects route and model ids that are not plain tokens", async () => {
    const bad = await run({ provider: "Evil Route", model: "m" });
    assert.equal(bad.status, "failed");
    assert.equal(bad.failure.class, "CAPABILITY");
    const noRoute = await run({ model: "m" });
    assert.match(noRoute.error, /needs its provider route/);
  });

  it("verified run: safety values confirmed before, policy confirmed after", async () => {
    const r = await run({ provider: "anthropic", model: "claude-x" });
    assert.equal(r.status, "completed", JSON.stringify(r));
    assert.equal(r.sessionId, "session-fake-dsh");
    assert.equal(r.policyViolation, false);
    assert.ok(r.notes.some((n) => /recorded preset smart-delegate/.test(n)));
    const patch = JSON.parse(readFileSync(join(r.artifacts.events, "..", "dsh-patch.json"), "utf8"));
    assert.deepEqual(patch.find((p) => p.id === "agent-default-model").config, { provider: "anthropic", model: "claude-x" });
  });

  it("declares a pi-ai route only when the user's config lacks it", async () => {
    const declared = await run({ provider: "moonshotai", model: "kimi-x" });
    assert.ok(declared.notes.some((n) => /declared pi-ai route "moonshotai"/.test(n)));
    const own = await run({ provider: "moonshotai", model: "kimi-x" }, { FAKE_DSH_ROUTES: "moonshotai,zai" });
    const patch = JSON.parse(readFileSync(join(own.artifacts.events, "..", "dsh-patch.json"), "utf8"));
    assert.equal(patch.some((p) => p.id === "llm-pi-ai"), false, "user-configured route left untouched");
    const off = await run({ provider: "moonshotai", model: "kimi-x", agentConfig: { declareRoutes: false } });
    assert.ok(!off.notes.some((n) => /declared/.test(n)));
  });

  it("gives a keyless custom endpoint a local placeholder credential", async () => {
    const profile = { api: "openai-completions", baseURL: "http://127.0.0.1:9999/v1", models: [{ id: "mock-model" }] };
    const r = await run({ provider: "local-test", model: "mock-model" }, {
      SMART_DELEGATE_DSH_PROVIDER_PROFILES: JSON.stringify({ "local-test": profile }),
    });
    const patch = JSON.parse(readFileSync(join(r.artifacts.events, "..", "dsh-patch.json"), "utf8"));
    assert.equal(patch.find((p) => p.id === "llm-pi-ai").config.providers["local-test"].apiKeyEnv, "SMART_DELEGATE_KEYLESS_PROVIDER");
  });

  it("web tools are disabled and verified (a renamed web row refuses the run)", async () => {
    const r = await run({});
    const patch = JSON.parse(readFileSync(join(r.artifacts.events, "..", "dsh-patch.json"), "utf8"));
    for (const id of ["tool-web", "web", "web-search-deepseek", "web-fetch-http"]) assert.equal(patch.find((p) => p.id === id)?.disabled, true, id);
    const renamed = await run({}, { FAKE_DSH_DROP_ROW: "tool-web" });
    assert.equal(renamed.failure.class, "POLICY");
  });

  it("refuses to run when an upstream row rename would drop a safety setting", async () => {
    const r = await run({}, { FAKE_DSH_DROP_ROW: "approval" });
    assert.equal(r.status, "failed");
    assert.equal(r.failure.class, "POLICY");
    assert.match(r.failure.reason, /approval/);
    assert.equal(r.exitCode, null, "the agent never started");
  });

  it("flags a run whose recorded policy differs from the requested one", async () => {
    const r = await run({}, { FAKE_DSH_RECORDED_POLICY: JSON.stringify({ preset: "danger-full-access", sandbox: "danger-full-access", approval: "never" }) });
    assert.equal(r.policyViolation, true);
  });

  it("read-only runs use the read-only sandbox", async () => {
    const r = await run({ readOnly: true });
    const patch = JSON.parse(readFileSync(join(r.artifacts.events, "..", "dsh-patch.json"), "utf8"));
    assert.equal(patch.find((p) => p.id === "sandbox-policy").config.mode, "read-only");
    assert.equal(r.policyViolation, false);
  });

  it("missing provider credentials classify as agent ENVIRONMENT (fallback can help)", () => {
    for (const code of ["NO_ADAPTER: no adapter registered for provider \"x\"", "PI_AI_ERROR: Provider is not configured: anthropic"]) {
      const parsed = harness.parseOutput({ exitCode: 1, lines: [JSON.stringify({ type: "session", sessionId: "s" }), JSON.stringify({ type: "status", phase: "turn_end", reason: { kind: "error", error: { code: code.split(":")[0], message: code.split(": ").slice(1).join(": ") } } })] });
      assert.equal(parsed.status, "failed");
      assert.match(parsed.error, /NO_ADAPTER|not configured/);
    }
  });

  it("dump helpers read blocks and detect routes", () => {
    const dump = "- id: approval\n  name: 'x'\n  config:\n    policy: never\n# == layer\n- id: llm-pi-ai\n  name: 'y'\n  config:\n    providers:\n      anthropic: {}\n";
    assert.match(rowBlock(dump, "approval"), /policy: never/);
    assert.equal(routeDeclared(dump, "anthropic"), true);
    assert.equal(routeDeclared(dump, "zai"), false);
    const problems = verifyDump(dump, "patch: entry \"permission\" not found", [{ id: "sandbox-policy", config: { mode: "workspace-write" } }]);
    assert.ok(problems.some((p) => /permission/.test(p)));
  });
});
