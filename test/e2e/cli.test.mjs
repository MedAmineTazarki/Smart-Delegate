// End-to-end tests through the real CLI binary, real adapters, real git,
// with fake implementer binaries standing in for the vendor CLIs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { entry, git, homeWithAgents, makeRepo, registryFile, runCli, tempDir, writeJson } from "../helpers/env.mjs";

const TASK = "Implement a CSV export feature for the reports page";
const PASSING_GATE = ["--gate", "node -e process.exit(0)"];

function history(home) {
  const path = join(home, "history.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
}

/** Registry layer that makes codex/default the clear primary and claude/opus the only fallback. */
function codexFirstRegistry(dir) {
  const strong = { coding: 0.97, reasoning: 0.95, reliability: 0.95, quality: 0.95, architecture: 0.95, toolUse: 0.95, speed: 0.9 };
  return registryFile(dir, [
    entry("codex/default", { provider: "openai", capabilities: strong, costTier: 1 }),
    entry("claude/opus", { provider: "anthropic", model: "opus" }),
    entry("claude/fable", { enabled: false }),
    entry("claude/sonnet", { enabled: false }),
    entry("claude/haiku", { enabled: false }),
    entry("command-code/default", { enabled: false }),
  ]);
}

describe("e2e: smart-delegate CLI", () => {
  it("full delegation: route -> edit -> independent gate -> verified, user changes untouched, history recorded", async () => {
    const home = homeWithAgents({ claude: "edit" });
    const repo = makeRepo({ "README.md": "# demo\n", "src/app.js": "export {}\n" });
    writeFileSync(join(repo, "README.md"), "# user's uncommitted edit\n");
    writeFileSync(join(repo, "notes.txt"), "user notes\n");
    const head = git(repo, "rev-parse", "HEAD");

    const r = await runCli(["run", TASK, "--json", ...PASSING_GATE], { cwd: repo, home });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const s = r.json;
    assert.equal(s.schema, "smart-delegate.run.v1");
    assert.equal(s.status, "verified", JSON.stringify(s, null, 2));
    assert.equal(s.attempts.length, 1);
    assert.equal(s.attempts[0].candidate.agent, "claude");
    assert.deepEqual(s.changes.workerChanges.map((c) => c.path), ["src/feature.txt"]);
    assert.equal(s.changes.userChangesPreserved, 2);
    assert.equal(s.verification.passed, true);
    assert.equal(readFileSync(join(repo, "README.md"), "utf8"), "# user's uncommitted edit\n");
    assert.equal(readFileSync(join(repo, "notes.txt"), "utf8"), "user notes\n");
    assert.equal(git(repo, "rev-parse", "HEAD"), head, "nothing was committed");
    assert.ok(existsSync(join(s.runDir, "brief.md")));
    assert.match(readFileSync(join(s.runDir, "diff.patch"), "utf8"), /\+feature/);
    const h = history(home);
    assert.equal(h.length, 1);
    assert.equal(h[0].success, true);
    assert.equal(h[0].testsPassed, true);
    assert.doesNotMatch(readFileSync(join(home, "history.jsonl"), "utf8"), /feature\\n|# Goal/, "no source or brief in history");
  });

  it("simulated transient failure falls back to the next candidate", async () => {
    const home = homeWithAgents({ codex: "failure", claude: "edit" });
    const repo = makeRepo();
    const reg = codexFirstRegistry(tempDir());
    const r = await runCli(["run", TASK, "--json", "--registry", reg, ...PASSING_GATE], { cwd: repo, home });
    const s = r.json;
    assert.equal(s.route.primary.agent, "codex");
    assert.equal(s.attempts.length, 2, JSON.stringify(s.attempts, null, 2));
    assert.equal(s.attempts[0].status, "failed");
    assert.equal(s.attempts[0].failure.class, "TRANSIENT");
    assert.equal(s.attempts[1].candidate.agent, "claude");
    assert.equal(s.status, "verified");
    const h = history(home);
    assert.equal(h.length, 2);
    assert.equal(h[0].failureClass, "TRANSIENT");
    assert.equal(h[1].fallbackUsed, true);
  });

  it("no fallback when the failed attempt left changes in the tree (never auto-cleans)", async () => {
    const home = homeWithAgents({ codex: "failure", claude: "edit" });
    const repo = makeRepo();
    const reg = codexFirstRegistry(tempDir());
    const r = await runCli(["run", TASK, "--json", "--registry", reg, ...PASSING_GATE], {
      cwd: repo,
      home,
      env: { FAKE_EDIT_ON_FAILURE: "1", FAKE_EDITS: JSON.stringify([{ op: "write", path: "half-done.txt", content: "partial\n" }]) },
    });
    assert.equal(r.code, 1);
    assert.equal(r.json.status, "failed");
    assert.equal(r.json.attempts.length, 1);
    assert.ok(r.json.warnings.some((w) => /fallback skipped/.test(w)));
    assert.equal(readFileSync(join(repo, "half-done.txt"), "utf8"), "partial\n", "partial work preserved");
  });

  it("changing only the registry file changes the selected model", async () => {
    const home = homeWithAgents({ claude: "success", codex: "success" });
    const repo = makeRepo();
    const dir = tempDir();
    const models = (bFit) => [
      entry("codex/model-a", { taskFit: { feature: 0.91 } }),
      entry("claude/model-b", { taskFit: { feature: bFit } }),
      ...["claude/fable", "claude/opus", "claude/sonnet", "claude/haiku", "codex/default", "command-code/default"].map((id) => entry(id, { enabled: false })),
    ];
    const reg = registryFile(dir, models(0.87));
    const first = await runCli(["route", TASK, "--json", "--registry", reg], { cwd: repo, home });
    assert.equal(first.json.primary.id, "codex/model-a");
    writeJson(reg, { schema: "smart-delegate.registry.v1", models: models(0.94) });
    const second = await runCli(["route", TASK, "--json", "--registry", reg], { cwd: repo, home });
    assert.equal(second.json.primary.id, "claude/model-b");
  });

  it("high risk: independent read-only review on another agent", async () => {
    const home = homeWithAgents({ claude: "edit", codex: "edit" });
    const repo = makeRepo();
    const reg = registryFile(tempDir(), [entry("codex/default", { capabilities: { coding: 0.9, reasoning: 0.9, reliability: 0.92, quality: 0.9, architecture: 0.9, toolUse: 0.9, speed: 0.6 } })]);
    const task = "Change the authentication and authorization flow for payments";
    const approve = await runCli(["run", task, "--json", "--registry", reg, ...PASSING_GATE], { cwd: repo, home });
    const s = approve.json;
    assert.equal(s.task.riskLevel, "high");
    assert.equal(s.review.by, "independent");
    assert.notEqual(s.review.agent, s.attempts[0].candidate.agent);
    assert.equal(s.review.verdict, "APPROVE");
    assert.equal(s.review.readOnlyViolation, false);
    assert.equal(s.status, "verified");

    const repo2 = makeRepo();
    const reject = await runCli(["run", task, "--json", "--registry", reg, ...PASSING_GATE], { cwd: repo2, home, env: { FAKE_VERDICT: "REQUEST_CHANGES" } });
    assert.equal(reject.json.status, "changes-requested");
    assert.equal(reject.code, 1);
  });

  it("verification is independent of the worker's claim", async () => {
    const home = homeWithAgents({ claude: "edit" });
    const repo = makeRepo();
    const r = await runCli(["run", TASK, "--json", "--gate", "node -e process.exit(1)"], { cwd: repo, home });
    assert.equal(r.json.attempts[0].workerReport.claimsTestsPass, true, "the fake worker claims tests pass");
    assert.equal(r.json.status, "verification-failed");
    assert.equal(r.code, 1);
    assert.equal(history(home).at(-1).failureClass, "QUALITY");
  });

  it("medium risk -> pending-review, then the orchestrator records the decision", async () => {
    const home = homeWithAgents({ claude: "edit" });
    const repo = makeRepo();
    const r = await runCli(["run", TASK, "--json", "--risk", "medium", ...PASSING_GATE], { cwd: repo, home });
    assert.equal(r.json.status, "pending-review");
    const o = await runCli(["outcome", r.json.runId, "--accept", "--json"], { cwd: repo, home });
    assert.equal(o.code, 0, o.stderr);
    const h = await runCli(["history", "--json"], { cwd: repo, home });
    assert.equal(h.json.records.at(-1).status, "accepted");
    const stats = await runCli(["history", "--stats", "--json"], { cwd: repo, home });
    assert.equal(stats.json.stats[0].accepted, 1);
  });

  it("worker timeout is enforced and reported", async () => {
    const home = homeWithAgents({ claude: "timeout" });
    const repo = makeRepo();
    const pidFile = join(tempDir(), "pids");
    const r = await runCli(["run", TASK, "--json", "--timeout", "1s"], { cwd: repo, home, env: { FAKE_PID_FILE: pidFile } });
    assert.equal(r.json.status, "failed");
    assert.equal(r.json.attempts[0].status, "timeout");
    for (const pid of readFileSync(pidFile, "utf8").trim().split(" ").map(Number)) {
      assert.throws(() => process.kill(pid, 0), "no process left running");
    }
  });

  it("manual override and --no-delegate", async () => {
    const home = homeWithAgents({ claude: "success", codex: "success" });
    const repo = makeRepo();
    const forced = await runCli(["route", TASK, "--json", "--agent", "codex"], { cwd: repo, home });
    assert.equal(forced.json.primary.agent, "codex");
    const stay = await runCli(["run", TASK, "--json", "--no-delegate"], { cwd: repo, home });
    assert.equal(stay.json.status, "not-delegated");
    assert.equal(stay.code, 0);
  });

  it("no candidate: controlled error with exit code 3", async () => {
    const home = homeWithAgents({});
    const repo = makeRepo();
    const r = await runCli(["route", TASK, "--json"], { cwd: repo, home });
    assert.equal(r.code, 3);
    assert.equal(r.json.decision, "no-candidate");
    assert.ok(r.json.excluded.every((e) => e.reason === "agent not installed"));
  });

  it("--json keeps stdout a single JSON document; usage errors are JSON too", async () => {
    const home = homeWithAgents({ claude: "success" });
    const repo = makeRepo();
    const ok = await runCli(["explain", TASK, "--json", "--log-level", "debug"], { cwd: repo, home });
    assert.ok(ok.json, `stdout was not JSON: ${ok.stdout.slice(0, 200)}`);
    assert.ok(Array.isArray(ok.json.ranked[0].breakdown ? ok.json.ranked : []));
    const bad = await runCli(["route", TASK, "--json", "--mode", "nonsense"], { cwd: repo, home });
    assert.equal(bad.code, 2);
    assert.equal(bad.json.schema, "smart-delegate.error.v1");
    const unknownFlag = await runCli(["route", "--bogus"], { cwd: repo, home });
    assert.equal(unknownFlag.code, 2);
  });

  it("refuses to delegate outside a git repository", async () => {
    const home = homeWithAgents({ claude: "edit" });
    const r = await runCli(["run", TASK, "--json"], { cwd: tempDir(), home });
    assert.equal(r.json.status, "refused");
  });

  it("setup, agents, models --discover --save, doctor", async () => {
    const home = homeWithAgents({ "command-code": "success", claude: "success" });
    const repo = makeRepo();
    const setup = await runCli(["setup", "--json", "--project"], { cwd: repo, home });
    assert.equal(setup.code, 0, setup.stderr);
    assert.ok(existsSync(join(repo, ".smart-delegate", "config.json")));
    const agents = await runCli(["agents", "--json"], { cwd: repo, home });
    assert.equal(agents.json.agents.find((a) => a.id === "command-code").installed, true);
    const models = await runCli(["models", "--discover", "--save", "--json"], { cwd: repo, home });
    assert.deepEqual(models.json.discovered.find((d) => d.agent === "command-code").notInRegistry, ["fake-vendor/model-a", "fake-vendor/model-b"]);
    const saved = JSON.parse(readFileSync(join(home, "models.json"), "utf8"));
    assert.ok(saved.models.every((m) => m.status === "experimental"));
    // Discovered-but-unrated models cannot take real work.
    const route = await runCli(["route", TASK, "--json"], { cwd: repo, home });
    assert.ok(route.json.excluded.some((e) => e.id === "command-code/fake-vendor/model-a"));
    const doctor = await runCli(["doctor", "--json"], { cwd: repo, home });
    assert.equal(doctor.json.healthy, true, JSON.stringify(doctor.json.checks, null, 2));
  });

  it("dry run writes the brief without executing anything", async () => {
    const home = homeWithAgents({ claude: "edit" });
    const repo = makeRepo({ "AGENTS.md": "Use tabs.\n" });
    const r = await runCli(["run", TASK, "--json", "--dry-run"], { cwd: repo, home });
    assert.equal(r.json.status, "dry-run");
    assert.match(r.json.brief, /# Forbidden actions/);
    assert.match(r.json.brief, /Use tabs\./);
    assert.equal(existsSync(join(repo, "src/feature.txt")), false);
  });
});
