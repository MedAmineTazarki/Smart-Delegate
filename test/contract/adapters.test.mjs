// Adapter contract tests. Every adapter must satisfy the contract, build
// argv without shell interpolation, keep the brief off argv, and parse its
// CLI's real output format. Runs use fake binaries that speak each format.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ADAPTERS } from "../../src/adapters/index.mjs";
import { CAPABILITY_FLAGS, assertAdapterContract } from "../../src/adapters/base.mjs";
import { SCHEMAS } from "../../src/config/schema.mjs";
import { fake, tempDir } from "../helpers/env.mjs";

const BRIEF = "# Goal\n\nDo the thing; rm -rf / $(whoami) `id`\n";

for (const adapter of ADAPTERS.values()) {
  describe(`adapter contract: ${adapter.id}`, () => {
    it("satisfies the contract with truthful boolean capabilities", () => {
      assertAdapterContract(adapter);
      for (const flag of CAPABILITY_FLAGS) assert.equal(typeof adapter.capabilities[flag], "boolean");
      for (const fn of ["detect", "getVersion", "getCapabilities", "run", "resume", "buildCommand", "parseOutput", "validateModel"]) {
        assert.equal(typeof adapter[fn], "function", fn);
      }
    });

    it("keeps the brief on stdin, never on argv", () => {
      const cmd = adapter.buildCommand({ brief: BRIEF, outDir: tempDir(), model: "some-model", provider: "some-provider", readOnly: false });
      assert.ok(cmd.stdin.includes("Do the thing"));
      assert.ok(!cmd.args.some((a) => a.includes("Do the thing")));
      assert.ok(JSON.stringify([cmd.args, cmd.meta ?? {}]).includes("some-model"), "model selected via argv or patch");
    });

    it("read-only and write modes produce different permission flags", () => {
      const shape = (c) => JSON.stringify([c.args.map((a) => (a.endsWith("dsh-patch.json") ? "<patch>" : a)), c.meta ?? {}]);
      const w = shape(adapter.buildCommand({ brief: BRIEF, outDir: tempDir(), readOnly: false }));
      const r = shape(adapter.buildCommand({ brief: BRIEF, outDir: tempDir(), readOnly: true }));
      assert.notEqual(w, r);
    });

    it("resume passes the session id", () => {
      const args = adapter.buildCommand({ brief: BRIEF, outDir: tempDir(), sessionId: "sess-123" }).args;
      assert.ok(args.includes("sess-123"));
    });

    it("rejects unsafe model ids before building a command", async () => {
      assert.equal(adapter.validateModel("vendor/model-1.5"), true);
      assert.equal(adapter.validateModel("x; rm -rf /"), false);
      const r = await adapter.run({ binaryPath: fake("success"), cwd: tempDir(), brief: BRIEF, model: "bad model!", outDir: tempDir() });
      assert.equal(r.status, "failed");
      assert.equal(r.failure.class, "CAPABILITY");
    });

    it("detects a configured binary and reads its version", () => {
      const d = adapter.detect(fake("success"));
      assert.equal(d.installed, true);
      assert.match(adapter.getVersion(d.binaryPath).version, /9\.9\.9/);
      assert.equal(adapter.detect("/nonexistent/bin").installed, false);
    });

    it("run(): success produces a normalized result with session id and report", async () => {
      const cwd = tempDir();
      const log = join(tempDir(), "log.jsonl");
      process.env.FAKE_AGENT_LOG = log;
      try {
        const r = await adapter.run({ binaryPath: fake("success"), cwd, brief: BRIEF, outDir: join(tempDir(), "out") });
        assert.equal(r.schema, SCHEMAS.result);
        assert.equal(r.status, "completed", JSON.stringify(r));
        assert.ok(r.sessionId);
        assert.match(r.finalMessage, /STATUS: DONE/);
        assert.equal(r.failure, null);
        assert.ok(existsSync(r.artifacts.events));
        const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]);
        assert.equal(call.brief, BRIEF, "brief delivered intact on stdin");
        assert.equal(call.cwd, cwd);
      } finally {
        delete process.env.FAKE_AGENT_LOG;
      }
    });

    it("run(): failure is classified (rate limit -> TRANSIENT)", async () => {
      process.env.FAKE_EXIT_CODE = adapter.id === "command-code" ? "5" : "1";
      try {
        const r = await adapter.run({ binaryPath: fake("failure"), cwd: tempDir(), brief: BRIEF, outDir: tempDir() });
        assert.equal(r.status, "failed");
        assert.equal(r.failure.class, "TRANSIENT", JSON.stringify(r.failure));
      } finally {
        delete process.env.FAKE_EXIT_CODE;
      }
    });

    it("run(): timeout is enforced", async () => {
      const r = await adapter.run({ binaryPath: fake("timeout"), cwd: tempDir(), brief: BRIEF, outDir: tempDir(), timeoutMs: 500, killGraceMs: 300 });
      assert.equal(r.status, "timeout");
      assert.equal(r.failure.class, "TRANSIENT");
    });

    it("run(): malformed output is never reported as success", async () => {
      const r = await adapter.run({ binaryPath: fake("malformed"), cwd: tempDir(), brief: BRIEF, outDir: tempDir() });
      assert.equal(r.status, "malformed");
      assert.equal(r.failure.class, "UNKNOWN");
    });

    it("run(): a missing binary is ENVIRONMENT (agent scope), so fallback may help", async () => {
      const r = await adapter.run({ binaryPath: "/nonexistent/agent", cwd: tempDir(), brief: BRIEF, outDir: tempDir() });
      assert.equal(r.status, "unavailable");
      assert.equal(r.failure.class, "ENVIRONMENT");
      assert.equal(r.failure.scope, "agent");
    });
  });
}

describe("adapter specifics", () => {
  it("claude: verified flags only (no --max-turns), strips CLAUDECODE, denies commits", () => {
    const claude = ADAPTERS.get("claude");
    const outDir = tempDir();
    const args = claude.buildCommand({ brief: "b", outDir, readOnly: false, effort: "high" }).args;
    for (const flag of ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--settings", "--effort"]) assert.ok(args.includes(flag), flag);
    assert.ok(!args.includes("--max-turns"));
    assert.ok(!args.includes("--dangerously-skip-permissions"));
    const settings = JSON.parse(readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
    assert.ok(settings.permissions.deny.some((r) => r.includes("git commit")));
    assert.deepEqual(claude.stripEnv, ["CLAUDECODE"]);
    const ro = claude.buildCommand({ brief: "b", outDir: tempDir(), readOnly: true }).args;
    assert.equal(ro[ro.indexOf("--tools") + 1], "Read,Glob,Grep");
    assert.equal(ro[ro.indexOf("--permission-mode") + 1], "plan");
  });

  it("codex: -s goes before `resume`, prompt from stdin via '-'", () => {
    const codex = ADAPTERS.get("codex");
    const fresh = codex.buildCommand({ brief: "b", outDir: tempDir(), readOnly: false }).args;
    assert.deepEqual(fresh.slice(0, 1), ["exec"]);
    assert.equal(fresh.at(-1), "-");
    assert.equal(fresh[fresh.indexOf("-s") + 1], "workspace-write");
    const resumed = codex.buildCommand({ brief: "b", outDir: tempDir(), sessionId: "t1", readOnly: true }).args;
    assert.deepEqual(resumed.slice(0, 5), ["exec", "-s", "read-only", "resume", "t1"]);
    assert.throws(() => codex.buildCommand({ brief: "b", outDir: tempDir(), effort: "high; rm" }));
  });

  it("command-code: --yolo only for write runs; exit codes map to failure classes", () => {
    const cc = ADAPTERS.get("command-code");
    assert.ok(cc.buildCommand({ brief: "b", readOnly: false }).args.includes("--yolo"));
    const ro = cc.buildCommand({ brief: "b", readOnly: true }).args;
    assert.ok(!ro.includes("--yolo"));
    assert.ok(ro.includes("plan"));
    assert.equal(cc.classifyExit(3).class, "ENVIRONMENT");
    assert.equal(cc.classifyExit(5).class, "TRANSIENT");
    assert.equal(cc.classifyExit(10).class, "POLICY");
    assert.equal(cc.capabilities.writeSandbox.startsWith("none"), true, "honest about no sandbox");
  });

  it("command-code: parses a truncated stream from early events", () => {
    const cc = ADAPTERS.get("command-code");
    const lines = [
      JSON.stringify({ type: "event", event: { type: "run_start", sessionId: "s-1" } }),
      JSON.stringify({ type: "event", event: { type: "message_end", content: [{ type: "text", text: "STATUS: DONE" }] } }),
      '{"type":"event","event":{"type":"run_end","conversation":[{"huge":"cut mid-str',
    ];
    const r = cc.parseOutput({ lines, exitCode: 0 });
    assert.equal(r.sessionId, "s-1");
    assert.equal(r.finalMessage, "STATUS: DONE");
    assert.equal(r.status, "completed");
    assert.ok(r.notes.length);
  });

  it("claude: parses error results as failures", () => {
    const claude = ADAPTERS.get("claude");
    const r = claude.parseOutput({ exitCode: 1, lines: [JSON.stringify({ type: "result", subtype: "error_max_budget", is_error: true, result: "budget", session_id: "s" })] });
    assert.equal(r.status, "failed");
    assert.match(r.error, /error_max_budget/);
  });

  it("model discovery never invents ids", () => {
    const cc = ADAPTERS.get("command-code");
    const found = cc.discoverModels({ probe: () => ({ ok: true, stdout: "Available models\nmoonshot/kimi-x  desc\nzai/glm-y  desc\nTip: something\n" }) });
    assert.deepEqual(found.models, ["moonshot/kimi-x", "zai/glm-y"]);
    assert.deepEqual(cc.discoverModels({ probe: () => ({ ok: false, status: 3, stdout: "" }) }).models, []);
  });
});
