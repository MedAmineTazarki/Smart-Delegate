import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runProcess, activeCount } from "../../src/relay/process.mjs";
import { discoverGates, runGates } from "../../src/verification/gates.mjs";
import { fake, makeRepo, tempDir, writeJson } from "../helpers/env.mjs";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pids, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pids.every((p) => !alive(p))) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("relay process layer", () => {
  it("timeout kills the agent and its grandchildren (no orphans)", async () => {
    const dir = tempDir();
    const pidFile = join(dir, "pids");
    const r = await runProcess({
      command: fake("timeout"),
      args: ["-p", "--output-format", "stream-json"],
      cwd: dir,
      env: { ...process.env, FAKE_PID_FILE: pidFile },
      input: "brief",
      timeoutMs: 700,
      killGraceMs: 500,
    });
    assert.equal(r.timedOut, true);
    const pids = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
    assert.equal(pids.length, 2);
    assert.ok(await waitDead(pids), `processes still alive: ${pids.filter(alive)}`);
    assert.equal(activeCount(), 0);
  });

  it("an agent that ignores SIGTERM is SIGKILLed after the grace period", async () => {
    const dir = tempDir();
    const pidFile = join(dir, "pids");
    const started = Date.now();
    const r = await runProcess({
      command: fake("timeout"),
      args: ["-p", "--output-format", "stream-json"],
      cwd: dir,
      env: { ...process.env, FAKE_PID_FILE: pidFile, FAKE_IGNORE_SIGTERM: "1" },
      timeoutMs: 500,
      killGraceMs: 400,
    });
    assert.equal(r.timedOut, true);
    assert.equal(r.signal, "SIGKILL");
    assert.ok(Date.now() - started < 5000);
    const pids = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
    assert.ok(await waitDead(pids));
  });

  it("captures lines, stderr tail, exit codes; survives an agent that never reads stdin", async () => {
    const lines = [];
    const dir = tempDir();
    const r = await runProcess({
      command: process.execPath,
      args: ["-e", "console.log('a');console.log('b');console.error('oops');process.exit(3)"],
      cwd: dir,
      input: "x".repeat(2_000_000),
      onStdoutLine: (l) => lines.push(l),
      stdoutPath: join(dir, "out.txt"),
    });
    assert.equal(r.exitCode, 3);
    assert.deepEqual(lines, ["a", "b"]);
    assert.match(r.stderrTail, /oops/);
    assert.equal(readFileSync(join(dir, "out.txt"), "utf8"), "a\nb\n");
  });

  it("caps the stdout artifact for runaway output", async () => {
    const dir = tempDir();
    const r = await runProcess({
      command: process.execPath,
      args: ["-e", "const s='y'.repeat(1024)+'\\n'; for(let i=0;i<2000;i++) process.stdout.write(s)"],
      cwd: dir,
      stdoutPath: join(dir, "out.txt"),
      maxStdoutBytes: 100_000,
    });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdoutTruncated, true);
    assert.ok(readFileSync(join(dir, "out.txt")).length <= 100_000);
  });

  it("reports a missing binary as a spawn error, not a crash", async () => {
    const r = await runProcess({ command: "/nonexistent/binary", args: [], cwd: tempDir() });
    assert.ok(r.spawnError);
    assert.equal(r.exitCode, null);
  });

  it("never interprets arguments through a shell", async () => {
    const dir = tempDir();
    const r = await runProcess({
      command: process.execPath,
      args: ["-e", "require('fs').writeFileSync('arg.txt', process.argv[1])", "$(touch pwned); `touch pwned2`"],
      cwd: dir,
    });
    assert.equal(r.exitCode, 0);
    assert.equal(existsSync(join(dir, "pwned")), false);
    assert.equal(readFileSync(join(dir, "arg.txt"), "utf8"), "$(touch pwned); `touch pwned2`");
  });
});

describe("verification gates", () => {
  it("discovers package.json scripts, skips placeholders/watchers, and only suggests prose commands", () => {
    const repo = makeRepo({
      "package.json": JSON.stringify({ scripts: { test: "node --test", lint: "eslint .", build: "vite build --watch", typecheck: "echo \"Error: no test specified\" && exit 1" } }),
      "README.md": "Run `npm run e2e` and `rm -rf /` please. Also `make deploy`.\n",
    });
    const { gates, suggestions } = discoverGates(repo, { verification: { autoDiscover: true, gates: [] } });
    assert.deepEqual(gates.map((g) => g.argv.join(" ")), ["npm run lint", "npm test"]);
    assert.ok(suggestions.includes("npm run e2e"));
    assert.ok(suggestions.includes("make deploy"));
    assert.ok(!suggestions.some((s) => s.includes("rm -rf")));
  });

  it("explicit config gates and --gate take precedence over discovery", () => {
    const repo = makeRepo({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) });
    const { gates } = discoverGates(repo, { verification: { gates: [{ name: "unit", argv: ["node", "-e", "0"] }] } }, ["make check"]);
    assert.deepEqual(gates.map((g) => g.argv.join(" ")), ["node -e 0", "make check"]);
  });

  it("runs gates independently and reports pass/fail", async () => {
    const repo = makeRepo({ "ok.js": "process.exit(0)\n", "bad.js": "console.error('boom'); process.exit(1)\n" });
    const v = await runGates(repo, [{ name: "ok", argv: ["node", "ok.js"] }, { name: "bad", argv: ["node", "bad.js"] }]);
    assert.equal(v.ran, true);
    assert.equal(v.passed, false);
    assert.deepEqual(v.results.map((r) => r.passed), [true, false]);
    assert.match(v.results[1].stderrTail, /boom/);
  });
});
