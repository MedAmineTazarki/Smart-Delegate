// Smart Delegate as a DeepSeek Harness plugin (harness/index.js), driven with a
// fake dsh context: tool registration, approval policy, the allowed run path,
// per-call cancellation, the /delegate command, and the recursion guard.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TOOL_NAME, apply, argvFor, compact } from "../../harness/index.js";
import { homeWithAgents, makeRepo, tempDir } from "../helpers/env.mjs";

function fakeCtx({ mode = "workspace-write" } = {}) {
  const ctx = { tools: [], listeners: {}, commands: [] };
  ctx.tools.register = (t) => ctx.tools.push(t);
  ctx.on = (event, fn) => { ctx.listeners[event] = fn; };
  ctx.get = (name) => (name === "sandboxPolicy" && mode !== null ? { resolve: () => ({ mode }) } : undefined);
  ctx.inject = (_deps, fn) => fn({ commands: { register: (c) => ctx.commands.push(c) } });
  return ctx;
}

const exec = (repo, args, signal = new AbortController().signal) => ({
  name: TOOL_NAME, arguments: args, signal, agent: { session: { header: { cwd: repo } } },
});

describe("DeepSeek Harness plugin", () => {
  it("registers the tool and the /delegate command; nothing when running as a worker", () => {
    const ctx = fakeCtx();
    apply(ctx, {});
    assert.equal(ctx.tools.length, 1);
    assert.equal(ctx.tools[0].name, TOOL_NAME);
    assert.equal(ctx.tools[0].parameters.additionalProperties, false);
    assert.equal(ctx.commands[0].name, "delegate");
    process.env.SMART_DELEGATE_WORKER = "1";
    try {
      const worker = fakeCtx();
      apply(worker, {});
      assert.equal(worker.tools.length, 0);
      assert.equal(worker.commands.length, 0);
    } finally {
      delete process.env.SMART_DELEGATE_WORKER;
    }
  });

  it("run always asks (with a French reason); route does not; read-only or unknown mode denies", async () => {
    const ctx = fakeCtx();
    apply(ctx, {});
    const pre = ctx.listeners["tools/pre-execute"];
    const next = () => Promise.resolve({ kind: "allow" });
    const ask = await pre(exec("/repo", { action: "run", task: "t" }), next);
    assert.equal(ask.kind, "ask");
    assert.match(ask.displayReason.fr, /Smart Delegate va lancer/);
    assert.equal((await pre(exec("/repo", { action: "route", task: "t" }), next)).kind, "allow");
    assert.equal((await pre({ ...exec("/repo", {}), name: "bash" }, next)).kind, "allow");
    for (const mode of ["read-only", null]) {
      const locked = fakeCtx({ mode });
      apply(locked, {});
      assert.equal((await locked.listeners["tools/pre-execute"](exec("/repo", { action: "run", task: "t" }), next)).kind, "deny");
    }
  });

  it("validates model arguments and never takes a path from the model", () => {
    assert.throws(() => argvFor({ action: "rm" }), /action/);
    assert.throws(() => argvFor({ action: "run" }), /task/);
    assert.throws(() => argvFor({ action: "run", task: "x", agent: "claude; rm -rf /" }), /plain token/);
    assert.throws(() => argvFor({ action: "run", task: "x", files: ["--cwd"] }), /relative/);
    assert.ok(!argvFor({ action: "route", task: "x", cwd: "/etc" }).includes("/etc"));
    assert.deepEqual(argvFor({ action: "history", limit: 500 }), ["history", "--limit", "50"]);
  });

  it("allowed run: delegates in the session's cwd and returns a compact, diff-free result", async () => {
    const home = homeWithAgents({ claude: "edit" });
    const repo = makeRepo();
    const saved = process.env.SMART_DELEGATE_HOME;
    process.env.SMART_DELEGATE_HOME = home;
    try {
      const ctx = fakeCtx();
      apply(ctx, {});
      const value = await ctx.tools[0].execute({ action: "run", task: "Implement a CSV export feature", gates: ["node -e process.exit(0)"] }, exec(repo, {}));
      assert.equal(value.status, "verified", JSON.stringify(value));
      assert.deepEqual(value.changedFiles, ["untracked src/feature.txt"]);
      assert.ok(existsSync(join(repo, "src/feature.txt")));
      assert.ok(!JSON.stringify(value).includes("+feature"), "no diff content in the tool value");
      const text = ctx.tools[0].output.render({ action: "run" }, value)[0].text;
      assert.match(text, /never commits/);
      // The user, not the agent, records the verdict.
      const done = await ctx.commands[0].handler({ agent: { session: { header: { cwd: repo } } }, rawInput: `accept ${value.runId}` });
      assert.equal(done.kind, "success");
      const history = readFileSync(join(home, "history.jsonl"), "utf8");
      assert.match(history, /"accepted":true/);
    } finally {
      if (saved === undefined) delete process.env.SMART_DELEGATE_HOME;
      else process.env.SMART_DELEGATE_HOME = saved;
    }
  });

  it("cancelling one call stops only its own worker", async () => {
    const home = homeWithAgents({ claude: "timeout" });
    const saved = process.env.SMART_DELEGATE_HOME;
    process.env.SMART_DELEGATE_HOME = home;
    try {
      const ctx = fakeCtx();
      apply(ctx, {});
      const tool = ctx.tools[0];
      const a = new AbortController();
      const pidA = join(tempDir(), "a.pid");
      const pidB = join(tempDir(), "b.pid");
      const run = (repo, signal, pidFile) => {
        process.env.FAKE_PID_FILE = pidFile;
        return tool.execute({ action: "run", task: "Implement a CSV export feature" }, exec(repo, {}, signal));
      };
      const first = run(makeRepo(), a.signal, pidA);
      await new Promise((r) => setTimeout(r, 1500));
      const b = new AbortController();
      const second = run(makeRepo(), b.signal, pidB);
      await new Promise((r) => setTimeout(r, 1500));
      a.abort();
      const firstValue = await first;
      assert.equal(firstValue.status, "aborted");
      const [bPid] = readFileSync(pidB, "utf8").split(" ").map(Number);
      assert.doesNotThrow(() => process.kill(bPid, 0), "the other call's worker is still running");
      b.abort();
      assert.equal((await second).status, "aborted");
    } finally {
      delete process.env.FAKE_PID_FILE;
      if (saved === undefined) delete process.env.SMART_DELEGATE_HOME;
      else process.env.SMART_DELEGATE_HOME = saved;
    }
  });

  it("compact() keeps errors explicit", () => {
    assert.deepEqual(compact("run", { schema: "smart-delegate.error.v1", error: "boom" }), { ok: false, error: "boom" });
  });
});
