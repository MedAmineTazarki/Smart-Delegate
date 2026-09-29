// The embedded agent against the REAL pi-ai library (located from a DeepSeek
// Harness install, SMART_DELEGATE_PI_AI_DIR, or SMART_DELEGATE_TEST_DSH_BIN),
// with a scripted local OpenAI-compatible mock instead of a paid model.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import piAgent from "../../src/adapters/pi-agent.mjs";
import { whichBinary } from "../../src/adapters/base.mjs";
import { locatePiAi } from "../../src/catalog/pi-ai.mjs";
import { ROOT, makeRepo, tempDir } from "../helpers/env.mjs";

const dsh = process.env.SMART_DELEGATE_TEST_DSH_BIN || whichBinary("dsh");
const real = locatePiAi({ dshBinary: dsh });
const isFake = real.dir?.includes("fake-pi-ai");
const skip = real.dir && !isFake ? false : "real pi-ai not found (install DeepSeek Harness or set SMART_DELEGATE_TEST_DSH_BIN)";

describe("embedded agent with real pi-ai", { skip }, () => {
  let mock;
  let port;
  before(async () => {
    mock = spawn(process.execPath, [join(ROOT, "fixtures/mock-llm/openai-sse-server.mjs")], {
      env: { ...process.env, PORT: "0", MOCK_WRITE_PATH: "src/hello.txt", MOCK_BASH_COMMAND: "node -e \"require('fs').writeFileSync('bash-ran.txt','1')\"" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    port = await new Promise((resolve) => mock.stdout.once("data", (d) => resolve(Number(String(d).split(" ")[1]))));
  });
  after(() => mock?.kill());

  it("writes, runs sandboxed bash, and reports", async () => {
    const repo = makeRepo();
    process.env.MOCK_KEY = "dummy";
    const r = await piAgent.run({
      binaryPath: process.execPath, cwd: repo, brief: "Create src/hello.txt then run the command.", provider: "mock-gw", model: "mock-model",
      outDir: join(tempDir(), "out"), agentInfo: { piAiDir: real.dir }, timeoutMs: 120_000,
      agentConfig: { customProviders: [{ id: "mock-gw", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "MOCK_KEY", models: [{ id: "mock-model" }] }] },
    });
    assert.equal(r.status, "completed", JSON.stringify(r, null, 2));
    assert.equal(readFileSync(join(repo, "src/hello.txt"), "utf8"), "written by mock\n");
    if (process.platform === "darwin") assert.ok(existsSync(join(repo, "bash-ran.txt")));
  });
});
