// Runs against the REAL DeepSeek Harness CLI when available (no credentials,
// no cost): a scripted local OpenAI-compatible mock stands in for the model.
// Set SMART_DELEGATE_TEST_DSH_BIN=/path/to/dsh, or have `dsh` on PATH.
// Skipped otherwise. Catches upstream row renames and event-format changes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import harness from "../../src/adapters/deepseek-harness.mjs";
import { whichBinary } from "../../src/adapters/base.mjs";
import { ROOT, makeRepo, tempDir } from "../helpers/env.mjs";

const DSH = process.env.SMART_DELEGATE_TEST_DSH_BIN || whichBinary("dsh");
const skip = DSH ? false : "real dsh not available (set SMART_DELEGATE_TEST_DSH_BIN)";

describe("real DeepSeek Harness", { skip }, () => {
  let mock;
  let port;
  const dshHome = tempDir("sd real dsh home ");

  before(async () => {
    mock = spawn(process.execPath, [join(ROOT, "fixtures/mock-llm/openai-sse-server.mjs")], {
      env: { ...process.env, PORT: "0", MOCK_WRITE_PATH: "hello.txt", MOCK_BASH_COMMAND: "node -e \"require('fs').writeFileSync('bash-ran.txt','1')\"" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    port = await new Promise((resolve) => mock.stdout.once("data", (d) => resolve(Number(String(d).split(" ")[1]))));
  });
  after(() => mock?.kill());

  it("runs a scripted task under the verified safety policy", async () => {
    const repo = makeRepo();
    // The route is hand-declared in a home patch, exactly like a user's Models-page config.
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dshHome, { recursive: true });
    writeFileSync(join(dshHome, "cordis.patch.yml"), [
      "- id: llm-pi-ai",
      "  config:",
      "    providers:",
      "      mock-gw:",
      "        api: openai-completions",
      `        baseURL: http://127.0.0.1:${port}/v1`,
      "        apiKeyEnv: MOCK_KEY",
      "        models:",
      "          - id: mock-model",
      "            contextWindow: 100000",
      "",
    ].join("\n"));
    process.env.MOCK_KEY = "dummy";
    const r = await harness.run({
      binaryPath: DSH, cwd: repo, brief: "Create hello.txt, then run the node command.", provider: "mock-gw", model: "mock-model",
      outDir: join(tempDir(), "out"), agentConfig: { home: dshHome }, timeoutMs: 240_000,
    });
    assert.equal(r.status, "completed", JSON.stringify(r, null, 2));
    assert.ok(r.notes.every((n) => !/declared pi-ai route/.test(n)), "user's own route was reused");
    assert.equal(r.policyViolation, false, r.notes.join("\n"));
    assert.equal(readFileSync(join(repo, "hello.txt"), "utf8"), "written by mock\n");
    assert.ok(existsSync(join(repo, "bash-ran.txt")), "sandboxed bash ran under approval never");
    assert.match(r.finalMessage, /STATUS: DONE/);
  });

  it("read-only mode blocks the write", async () => {
    const repo = makeRepo();
    const r = await harness.run({
      binaryPath: DSH, cwd: repo, brief: "Try to write.", provider: "mock-gw", model: "mock-model", readOnly: true,
      outDir: join(tempDir(), "out"), agentConfig: { home: dshHome }, timeoutMs: 240_000,
    });
    assert.equal(r.policyViolation, false, r.notes.join("\n"));
    assert.equal(existsSync(join(repo, "hello.txt")), false, "read-only sandbox refused the write");
  });
});
