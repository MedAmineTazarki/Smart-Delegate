// The DeepSeek Harness French language pack must stay complete and consistent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ROOT } from "../helpers/env.mjs";

const PACK = join(ROOT, "integrations", "dsh-locale-fr");

describe("dsh French language pack", () => {
  it("every English key is translated with identical placeholders", () => {
    const r = spawnSync(process.execPath, [join(PACK, "scripts", "build.mjs"), join(PACK, "source", "en-dicts.json"), "--check"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /2602\/2602 strings translated; 0 problem/);
  });

  it("the committed plugin registers French with the documented locale API", () => {
    const client = readFileSync(join(PACK, "dist", "client.js"), "utf8");
    assert.match(client, /ctx\.locale\.addLanguage\(\{ id: 'fr', label: 'Français', fallback: 'en' \}\)/);
    assert.match(client, /ctx\.locale\.register\(ns, 'fr', DICTIONARIES\[ns\]\)/);
    const pkg = JSON.parse(readFileSync(join(PACK, "dist", "package.json"), "utf8"));
    assert.deepEqual(pkg.dsh.client.inject, ["@deepseek-ai/dsh-client-locale"]);
    assert.equal(pkg.exports["./client"], "./client.js");
  });
});
