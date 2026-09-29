// Embedded pi-ai agent: confinement, sandboxing, loop, and adapter contract.
// Uses the scripted fake pi-ai fixture; a real-pi-ai run lives in
// test/integration/pi-agent-real.test.mjs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import piAgent from "../../src/adapters/pi-agent.mjs";
import { macProfile, detectShellSandbox } from "../../src/pi-agent/sandbox.mjs";
import { ToolError, buildTools, confine } from "../../src/pi-agent/tools.mjs";
import { ROOT, makeRepo, tempDir } from "../helpers/env.mjs";

const FAKE_PI = join(ROOT, "fixtures", "fake-pi-ai");
const { Type } = await import(join(FAKE_PI, "dist", "index.js"));

function runAgent(script, { readOnly = false, repo = makeRepo(), provider = "fake", model = "m" } = {}) {
  process.env.FAKE_PI_SCRIPT = JSON.stringify(script);
  return piAgent
    .run({ binaryPath: process.execPath, cwd: repo, brief: "task", provider, model, readOnly, outDir: join(tempDir(), "out"), agentInfo: { piAiDir: FAKE_PI }, timeoutMs: 60_000 })
    .then((r) => ({ r, repo }))
    .finally(() => delete process.env.FAKE_PI_SCRIPT);
}

describe("pi-agent tools: repository confinement", () => {
  const repo = makeRepo({ "a.txt": "hello\nworld\n", ".env": "SECRET=1\n" });

  it("allows paths inside the repository", () => {
    assert.equal(confine(repo, "a.txt").rel, "a.txt");
    assert.equal(confine(repo, "new/dir/file.txt", { write: true }).rel, "new/dir/file.txt");
  });

  it("rejects .., absolute paths and symlinks that leave the repository", () => {
    const outside = tempDir("sd outside ");
    symlinkSync(outside, join(repo, "link-out"));
    assert.throws(() => confine(repo, "../escape.txt", { write: true }), ToolError);
    assert.throws(() => confine(repo, "/etc/hosts"), ToolError);
    assert.throws(() => confine(repo, "link-out/x.txt", { write: true }), /outside the repository/);
  });

  it("protects .git and .env files", () => {
    assert.throws(() => confine(repo, ".git/config", { write: true }), /\.git/);
    assert.throws(() => confine(repo, ".env"), /secrets/);
    assert.throws(() => confine(repo, "config/.env.production", { write: true }), /secrets/);
  });

  it("read-only tool set has no write, edit, or shell", () => {
    const tools = buildTools({ root: repo, readOnly: true, sandbox: { kind: "sandbox-exec", path: "/usr/bin/sandbox-exec" }, Type });
    assert.deepEqual(Object.keys(tools).sort(), ["list_files", "read_file", "search"]);
  });

  it("no OS sandbox means no bash tool", () => {
    const tools = buildTools({ root: repo, readOnly: false, sandbox: null, Type });
    assert.equal("bash" in tools, false);
    assert.ok("write_file" in tools);
  });

  it("edit_file requires a unique match; search skips secrets", async () => {
    const r = makeRepo({ "b.txt": "x x\n", ".env": "TOKEN=abc\n" });
    const tools = buildTools({ root: r, readOnly: false, sandbox: null, Type });
    assert.throws(() => tools.edit_file.run({ path: "b.txt", old_string: "x", new_string: "y" }), /exactly once/);
    tools.edit_file.run({ path: "b.txt", old_string: "x x", new_string: "$& y" });
    assert.equal(readFileSync(join(r, "b.txt"), "utf8"), "$& y\n", "replacement is literal");
    assert.doesNotMatch(tools.search.run({ pattern: "TOKEN" }), /abc/);
  });

  it("the macOS profile escapes paths and denies .git and network", () => {
    const p = macProfile('/tmp/we"ird\\repo');
    assert.match(p, /\(subpath "\/tmp\/we\\"ird\\\\repo"\)/);
    assert.match(p, /\(deny network\*\)/);
    assert.match(p, /deny file-write\* \(subpath "\/tmp\/we\\"ird\\\\repo\/\.git"\)/);
    assert.doesNotMatch(macProfile("/r", { network: true }), /deny network/);
  });

  it("the real sandbox confines shell writes (macOS only)", { skip: detectShellSandbox()?.kind !== "sandbox-exec" && "no sandbox-exec" }, () => {
    const r = makeRepo();
    const tools = buildTools({ root: r, readOnly: false, sandbox: detectShellSandbox(), Type });
    const outside = join(tempDir("sd outside "), "x.txt");
    const out = tools.bash.run({ command: `echo in > inside.txt; echo out > "${outside}"; echo g > .git/evil; echo done` });
    assert.match(out, /done/);
    assert.ok(existsSync(join(r, "inside.txt")));
    assert.equal(existsSync(join(r, ".git", "evil")), false);
    // the temp dir is writable by design, so check a path outside both
    const home = join(process.env.HOME, `.sd-sandbox-probe-${process.pid}`);
    tools.bash.run({ command: `echo x > "${home}"` });
    assert.equal(existsSync(home), false, "writes outside the repository are blocked");
  });
});

describe("pi-agent adapter", () => {
  it("runs the tool loop: write, then final report", async () => {
    const { r, repo } = await runAgent([{ tool: "write_file", args: { path: "src/out.txt", content: "made\n" } }, { text: "STATUS: DONE\nSUMMARY: ok" }]);
    assert.equal(r.status, "completed", JSON.stringify(r));
    assert.match(r.finalMessage, /STATUS: DONE/);
    assert.equal(readFileSync(join(repo, "src/out.txt"), "utf8"), "made\n");
    assert.ok(r.costUsd > 0);
  });

  it("an escape attempt becomes a tool error, never a write", async () => {
    const outside = join(tempDir("sd outside "), "pwned.txt");
    const { r } = await runAgent([{ tool: "write_file", args: { path: outside, content: "x" } }, { text: "STATUS: BLOCKED" }]);
    assert.equal(r.status, "completed");
    assert.equal(existsSync(outside), false);
  });

  it("read-only: write tools do not exist", async () => {
    const log = join(tempDir(), "tools.log");
    process.env.FAKE_PI_TOOLS_LOG = log;
    const { r, repo } = await runAgent([{ tool: "write_file", args: { path: "x.txt", content: "x" } }, { text: "VERDICT: APPROVE" }], { readOnly: true });
    delete process.env.FAKE_PI_TOOLS_LOG;
    assert.equal(r.status, "completed");
    assert.equal(existsSync(join(repo, "x.txt")), false);
    assert.deepEqual(JSON.parse(readFileSync(log, "utf8").split("\n")[0]).sort(), ["list_files", "read_file", "search"]);
  });

  it("model errors are classified (rate limit -> TRANSIENT)", async () => {
    const { r } = await runAgent([{ error: "429 Too Many Requests: rate limit exceeded" }]);
    assert.equal(r.status, "failed");
    assert.equal(r.failure.class, "TRANSIENT");
  });

  it("unknown model and missing provider fail cleanly as CAPABILITY", async () => {
    const unknown = await runAgent([{ text: "x" }], { provider: "nope" });
    assert.equal(unknown.r.status, "failed");
    assert.equal(unknown.r.failure.class, "CAPABILITY");
    const noProvider = await runAgent([{ text: "x" }], { provider: null });
    assert.equal(noProvider.r.failure.class, "CAPABILITY");
    assert.match(noProvider.r.error, /provider route/);
  });

  it("detects itself only when pi-ai can be located", () => {
    const saved = process.env.SMART_DELEGATE_PI_AI_DIR;
    process.env.SMART_DELEGATE_PI_AI_DIR = FAKE_PI;
    try {
      const d = piAgent.detect(null, { agents: [] });
      assert.equal(d.installed, true);
      assert.equal(d.piAiDir, FAKE_PI);
      assert.match(piAgent.getVersion(d.binaryPath, d).version, /0\.0\.0-fake/);
    } finally {
      if (saved === undefined) delete process.env.SMART_DELEGATE_PI_AI_DIR;
      else process.env.SMART_DELEGATE_PI_AI_DIR = saved;
    }
  });
});

