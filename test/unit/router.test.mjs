import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { builtinDefaults } from "../../src/config/config.mjs";
import { profileTask } from "../../src/profiler/task.mjs";
import { normalizeEntry } from "../../src/registry/registry.mjs";
import { route } from "../../src/routing/router.mjs";
import { explainRoute } from "../../src/routing/explain.mjs";
import { validate, loadSchema } from "../../src/config/schema.mjs";
import { discovered, entry } from "../helpers/env.mjs";

const config = builtinDefaults();

function decide(text, models, { agents = ["claude", "codex", "command-code"], request = {}, overrides = {}, history = [], cfg = config } = {}) {
  const profile = profileTask(text, { config: cfg, overrides });
  return route({ profile, config: cfg, entries: models.map(normalizeEntry), discovery: discovered(...agents), history, request });
}

const cheap = entry("command-code/cheap-model", { costTier: 1, capabilities: { coding: 0.8, reasoning: 0.72, reliability: 0.8, quality: 0.75, architecture: 0.6, toolUse: 0.8, speed: 0.85 } });
const premium = entry("claude/premium-model", { costTier: 5, capabilities: { coding: 0.93, reasoning: 0.96, reliability: 0.93, quality: 0.94, architecture: 0.95, toolUse: 0.92, speed: 0.35 } });
const mid = entry("codex/mid-model", { costTier: 3, capabilities: { coding: 0.91, reasoning: 0.86, reliability: 0.88, quality: 0.87, architecture: 0.8, toolUse: 0.88, speed: 0.6 } });

describe("router", () => {
  it("simple task: a cheaper compatible candidate beats an unnecessarily expensive one", () => {
    const r = decide("Fix a typo in the README", [cheap, premium]);
    assert.equal(r.decision === "delegate" || r.decision === "stay", true);
    assert.equal(r.primary.id, cheap.id);
  });

  it("architecture: strong reasoning/reliability candidate wins and weak ones are floored", () => {
    const r = decide("Design the architecture for a plugin system with module boundaries", [cheap, mid, premium]);
    assert.equal(r.profile.taskType, "architecture");
    assert.equal(r.primary.id, premium.id);
    assert.ok(r.excluded.some((e) => e.id === cheap.id && /quality floor/.test(e.reason)));
  });

  it("large context: models with too small a context window are filtered, not just penalized", () => {
    const small = entry("codex/small-context", { contextWindow: 32000 });
    const big = entry("claude/big-context", { contextWindow: 1_000_000, capabilities: { ...premium.capabilities } });
    const r = decide("Analyze the entire codebase and map module dependencies", [small, big]);
    assert.ok(r.profile.requiredContextTokens > 32000);
    assert.equal(r.primary.id, big.id);
    assert.match(r.excluded.find((e) => e.id === small.id).reason, /context window/);
  });

  it("large context: a big repository (lockfiles, assets) lowers context fit but never filters a normal model", () => {
    const repo = { fileCount: 300, monorepo: false, sizeBytes: 8_000_000, sensitiveAreas: [] };
    const profile = profileTask("Rename fooBar to fooBaz across the codebase", { config, repo });
    const r = route({ profile, config, entries: [entry("claude/normal", { contextWindow: 200000 })].map(normalizeEntry), discovery: discovered("claude"), request: {} });
    assert.equal(r.decision, "delegate");
    assert.ok(r.ranked[0].breakdown.contextFit === undefined || r.ranked[0].breakdown.contextFit.value < 0.5);
  });

  it("vision: candidates without vision are removed", () => {
    const blind = entry("codex/blind", { vision: false, capabilities: { ...premium.capabilities } });
    const seeing = entry("claude/seeing", { vision: true });
    const r = decide("Implement the layout shown in this screenshot", [blind, seeing]);
    assert.equal(r.profile.visionRequirement, 1);
    assert.equal(r.primary.id, seeing.id);
    assert.match(r.excluded.find((e) => e.id === blind.id).reason, /vision/);
  });

  it("vision: unknown vision support is not assumed", () => {
    const unknown = entry("claude/unknown-vision", { vision: null });
    const r = decide("Implement this mockup", [unknown], { overrides: { images: ["/tmp/x.png"] } });
    assert.equal(r.decision, "no-candidate");
  });

  it("provider/agent unavailable: candidate removed", () => {
    const r = decide("Implement a CSV export feature", [mid, premium], { agents: ["claude"] });
    assert.equal(r.primary.id, premium.id);
    assert.equal(r.excluded.find((e) => e.id === mid.id).reason, "agent not installed");
  });

  it("excluded provider is removed", () => {
    const r = decide("Implement a CSV export feature", [mid, premium], { request: { excludeProviders: ["claude-provider"] } });
    assert.equal(r.primary.id, mid.id);
  });

  it("hard budget: too-expensive candidate excluded", () => {
    const r = decide("Implement a CSV export feature", [mid, premium], { request: { maxCostTier: 3 } });
    assert.equal(r.primary.id, mid.id);
    assert.match(r.excluded.find((e) => e.id === premium.id).reason, /cost tier/);
    const usd = decide("Implement a CSV export feature", [entry("claude/pricey", { costPerTaskUsd: 5 }), mid], { request: { maxUsdPerTask: 1 } });
    assert.equal(usd.primary.id, mid.id);
  });

  it("registry update alone changes the ranking (no code change)", () => {
    const a = entry("codex/model-a", { taskFit: { feature: 0.91 } });
    const b = entry("claude/model-b", { taskFit: { feature: 0.87 } });
    const before = decide("Implement a CSV export feature", [a, b]);
    assert.equal(before.primary.id, a.id);
    const after = decide("Implement a CSV export feature", [a, { ...b, taskFit: { feature: 0.94 } }]);
    assert.equal(after.primary.id, b.id);
  });

  it("a newly added stronger model becomes primary", () => {
    const base = decide("Design the architecture of the billing service", [mid, premium]);
    const newer = entry("claude/brand-new", { capabilities: { ...premium.capabilities, reasoning: 0.99, architecture: 0.99, quality: 0.97 } });
    const r = decide("Design the architecture of the billing service", [mid, premium, newer]);
    assert.equal(base.primary.id, premium.id);
    assert.equal(r.primary.id, newer.id);
  });

  it("manual override: the user-selected agent/model wins even below floors", () => {
    const r = decide("Design the architecture for a plugin system", [cheap, premium], { request: { agent: "command-code" } });
    assert.equal(r.primary.id, cheap.id);
    assert.equal(r.decision, "delegate");
    const m = decide("Implement a CSV export feature", [cheap, premium], { request: { agent: "claude", model: "some-other-model" } });
    assert.equal(m.primary.model, "some-other-model");
    assert.ok(m.warnings.some((w) => /not in the registry/.test(w)));
  });

  it("no candidate: controlled result, not an exception", () => {
    const r = decide("Implement a CSV export feature", [premium], { agents: [] });
    assert.equal(r.decision, "no-candidate");
    assert.equal(r.primary, null);
    assert.ok(r.reasons.length > 0);
  });

  it("--no-delegate returns stay", () => {
    const r = decide("Implement a CSV export feature", [premium], { request: { noDelegate: true } });
    assert.equal(r.decision, "stay");
  });

  it("economy never means below the quality floor", () => {
    const junk = entry("command-code/junk", { costTier: 1, capabilities: { coding: 0.4, reasoning: 0.4, reliability: 0.5, quality: 0.4 } });
    const r = decide("Implement a CSV export feature for the reports page", [junk, cheap, mid, premium], { request: { mode: "economy" } });
    assert.ok(r.excluded.some((e) => e.id === junk.id));
    assert.notEqual(r.primary.id, junk.id);
    assert.equal(r.primary.id, cheap.id, "cheapest candidate above the floor");
  });

  it("quality mode prefers the strongest model", () => {
    const r = decide("Implement a CSV export feature", [cheap, mid, premium], { request: { mode: "quality" } });
    assert.equal(r.primary.id, premium.id);
  });

  it("local-only mode excludes remote models", () => {
    const local = entry("command-code/local-model", { local: true });
    const r = decide("Implement a CSV export feature", [local, premium], { request: { mode: "local-only" } });
    assert.equal(r.primary.id, local.id);
    assert.equal(decide("Implement a feature", [premium], { request: { mode: "local-only" } }).decision, "no-candidate");
  });

  it("experimental models do not receive risky work", () => {
    const exp = entry("codex/experimental", { status: "experimental", capabilities: { ...premium.capabilities } });
    const r = decide("Fix the authentication token refresh and the payment webhook", [exp, mid]);
    assert.ok(r.profile.risk > config.routing.experimentalMaxRisk);
    assert.ok(r.excluded.some((e) => e.id === exp.id && /experimental/.test(e.reason)));
  });

  it("disabled and deprecated models are filtered", () => {
    const r = decide("Implement a CSV export feature", [entry("codex/old", { status: "deprecated" }), entry("claude/off", { enabled: false }), mid]);
    assert.equal(r.primary.id, mid.id);
    assert.equal(r.excluded.length, 2);
  });

  it("fallbacks are prepared, capped, and prefer another agent", () => {
    const claudeB = entry("claude/second", { capabilities: { ...premium.capabilities, coding: 0.925 } });
    const r = decide("Implement a CSV export feature", [premium, claudeB, mid, cheap]);
    assert.ok(r.fallbacks.length <= config.routing.maxCandidates - 1);
    assert.notEqual(r.fallbacks[0].agent, r.primary.agent);
  });

  it("high risk requires an independent reviewer on a different agent", () => {
    const strongCodex = entry("codex/strong", { capabilities: { ...premium.capabilities, reliability: 0.92, coding: 0.9 } });
    const r = decide("Change the authentication and authorization flow for payments", [premium, strongCodex]);
    assert.equal(r.profile.riskLevel, "high");
    assert.equal(r.review.by, "independent");
    assert.notEqual(r.review.agent, r.primary.agent);
  });

  it("high risk without a second eligible candidate falls back to orchestrator review, with a warning", () => {
    const r = decide("Change the authentication and authorization flow for payments", [premium, mid]);
    assert.ok(r.excluded.some((e) => e.id === mid.id && /high-risk/.test(e.reason)));
    assert.equal(r.review.by, "orchestrator");
    assert.ok(r.warnings.some((w) => /independent reviewer/.test(w)));
  });

  it("low risk needs no reviewer; medium risk needs the orchestrator", () => {
    assert.equal(decide("Implement a CSV export feature", [premium, mid]).review.by, "none");
    const medium = decide("Implement a CSV export feature", [premium, mid], { overrides: { risk: "medium" } });
    assert.equal(medium.review.by, "orchestrator");
  });

  it("small local samples do not dominate; larger samples adjust gently", () => {
    const a = entry("codex/model-a", { capabilities: { ...mid.capabilities, reliability: 0.85 } });
    const b = entry("claude/model-b", { capabilities: { ...mid.capabilities, reliability: 0.85 } });
    const wins = (n) => Array.from({ length: n }, (_, i) => ({ candidateId: b.id, taskType: "feature", success: true, testsPassed: true, reviewPassed: true, timestamp: `2020-01-01T00:00:${String(i).padStart(2, "0")}Z` }));
    const two = decide("Implement a CSV export feature", [a, b], { history: wins(2) });
    const twoB = two.ranked.find((c) => c.id === b.id);
    assert.equal(twoB.learned.applied, false, "2 samples: no adjustment");
    const many = decide("Implement a CSV export feature", [a, b], { history: wins(40) });
    const manyB = many.ranked.find((c) => c.id === b.id);
    assert.equal(manyB.learned.applied, true);
    assert.ok(manyB.learned.reliability > 0.85 && manyB.learned.reliability <= 0.85 + config.learning.maxReliabilityShift);
    assert.equal(many.primary.id, b.id);
  });

  it("route output matches the published schema and explain renders", () => {
    const r = decide("Implement a CSV export feature", [cheap, mid, premium]);
    assert.deepEqual(validate(loadSchema("route"), r), []);
    const text = explainRoute(r);
    assert.match(text, /Selected:/);
    assert.match(text, /Not selected:/);
  });

  it("the router source never names a model or agent", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/routing/router.mjs", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const word of ["opus", "sonnet", "haiku", "fable", "gpt", "kimi", "glm", "qwen", '"claude"', '"codex"', '"command-code"']) {
      assert.equal(src.toLowerCase().includes(word), false, `router.mjs mentions ${word}`);
    }
  });
});
