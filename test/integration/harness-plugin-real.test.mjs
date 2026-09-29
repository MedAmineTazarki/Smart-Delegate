// Smart Delegate installed as a plugin in the REAL DeepSeek Harness, with a
// scripted mock model that calls the smart_delegate tool. Needs dsh (PATH or
// SMART_DELEGATE_TEST_DSH_BIN) and pnpm on PATH; skipped otherwise.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { whichBinary } from "../../src/adapters/base.mjs";
import { ROOT, homeWithAgents, makeRepo, tempDir } from "../helpers/env.mjs";

const DSH = process.env.SMART_DELEGATE_TEST_DSH_BIN || whichBinary("dsh");
const skip = DSH && whichBinary("pnpm") ? false : "needs dsh and pnpm";

function mock(toolCall, log) {
  const child = spawn(process.execPath, [join(ROOT, "fixtures/mock-llm/openai-sse-server.mjs")], {
    env: { ...process.env, PORT: "0", MOCK_LOG: log, MOCK_TOOL_CALL: JSON.stringify(toolCall) }, stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve) => child.stdout.once("data", (d) => resolve({ child, port: Number(String(d).split(" ")[1]) })));
}

describe("Smart Delegate plugin in real dsh", { skip }, () => {
  const home = tempDir("sd plugin dsh home ");
  const sdHome = homeWithAgents({ claude: "edit" });
  const add = spawnSync(DSH, ["plugin", "--profile", "headless", "add", ROOT], { env: { ...process.env, DSH_HOME: home }, encoding: "utf8" });

  async function run(toolCall, extraEnv = {}) {
    const log = join(tempDir(), "mock.jsonl");
    const { child, port } = await mock(toolCall, log);
    writeFileSync(join(home, "cordis.patch.yml"), `- id: llm-pi-ai\n  config:\n    providers:\n      mock-gw:\n        api: openai-completions\n        baseURL: http://127.0.0.1:${port}/v1\n        apiKeyEnv: MOCK_KEY\n        models:\n          - id: mock-model\n- id: agent-default-model\n  config:\n    provider: mock-gw\n    model: mock-model\n`);
    const r = spawnSync(DSH, ["--profile", "headless", "--json"], {
      cwd: makeRepo(), input: "Use smart_delegate.", encoding: "utf8", timeout: 180_000,
      env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1", MOCK_KEY: "dummy", SMART_DELEGATE_HOME: sdHome, ...extraEnv },
    });
    child.kill();
    const offered = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.toolNames?.length)?.toolNames ?? [];
    const final = r.stdout.trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "final")?.text ?? "";
    return { offered, final };
  }

  it("installs as a dsh bundle", () => assert.equal(add.status, 0, add.stderr));

  it("the agent can route through smart_delegate", async () => {
    const { offered, final } = await run({ name: "smart_delegate", args: { action: "route", task: "Implement a CSV export feature" } });
    assert.ok(offered.includes("smart_delegate"));
    assert.match(final, /Decision: delegate/);
  });

  it("run is never executed without an approval", async () => {
    const { final } = await run({ name: "smart_delegate", args: { action: "run", task: "Implement a CSV export feature" } });
    assert.match(final, /requires approval|rejected/);
  });

  it("a dsh launched as a Smart Delegate worker does not offer the tool", async () => {
    const { offered } = await run({ name: "smart_delegate", args: { action: "route", task: "x" } }, { SMART_DELEGATE_WORKER: "1" });
    assert.ok(!offered.includes("smart_delegate"));
  });
});
