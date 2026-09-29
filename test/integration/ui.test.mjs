// Web UI server: access control and API, end to end with a fake agent.
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, it } from "node:test";
import { startUiServer } from "../../src/ui/server.mjs";
import { homeWithAgents, makeRepo } from "../helpers/env.mjs";

function call(port, path, { method = "GET", token, body, host, origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = request({
      host: "127.0.0.1", port, path, method,
      headers: {
        host: host ?? `127.0.0.1:${port}`,
        ...(token ? { "x-sd-token": token } : {}),
        ...(origin ? { origin } : {}),
        ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let text = "";
      res.on("data", (d) => { text += d; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, text, json, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

describe("web UI server", () => {
  let ui;
  let repo;
  const saved = process.env.SMART_DELEGATE_HOME;

  before(async () => {
    process.env.SMART_DELEGATE_HOME = homeWithAgents({ claude: "edit" });
    repo = makeRepo();
    ui = await startUiServer({ port: 0, cwd: repo });
  });
  after(() => {
    ui?.server.close();
    if (saved === undefined) delete process.env.SMART_DELEGATE_HOME;
    else process.env.SMART_DELEGATE_HOME = saved;
  });

  it("serves the page with a strict CSP and keeps the token out of the HTML", async () => {
    const r = await call(ui.port, "/");
    assert.equal(r.status, 200);
    assert.match(r.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.ok(!r.text.includes(ui.token));
    assert.match(r.text, /Smart Delegate/);
  });

  it("refuses API calls without the token, from a foreign Host, or cross-origin", async () => {
    assert.equal((await call(ui.port, "/api/state")).status, 401);
    assert.equal((await call(ui.port, "/api/state", { token: "wrong-token-of-some-length-xx" })).status, 401);
    assert.equal((await call(ui.port, "/api/state", { token: ui.token, host: "evil.example:80" })).status, 421);
    assert.equal((await call(ui.port, "/api/route", { method: "POST", token: ui.token, origin: "http://evil.example", body: { task: "x" } })).status, 403);
    assert.equal((await call(ui.port, "/api/state", { token: ui.token, origin: `http://127.0.0.1:${ui.port}` })).status, 200);
  });

  it("routes with reasons rendered in French", async () => {
    const r = await call(ui.port, "/api/route?lang=fr", { method: "POST", token: ui.token, body: { task: "Implement a CSV export feature", cwd: repo } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.decisionLabel, "déléguer");
    assert.ok(r.json.reasons.some((x) => /tâche de type/.test(x)));
    assert.ok(r.json.excluded.some((e) => /agent non installé/.test(e.reason)));
  });

  it("runs a delegation as a job, shows the diff, and records the decision", async () => {
    const start = await call(ui.port, "/api/run?lang=fr", { method: "POST", token: ui.token, body: { task: "Implement a CSV export feature", cwd: repo, risk: "medium", gates: ["node -e process.exit(0)"] } });
    assert.equal(start.status, 202, start.text);
    let job;
    for (let i = 0; i < 150; i += 1) {
      job = (await call(ui.port, "/api/jobs?lang=fr", { token: ui.token })).json.find((j) => j.id === start.json.id);
      if (job.status !== "running") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(job.status, "done", JSON.stringify(job));
    assert.equal(job.run.status, "pending-review");
    assert.equal(job.run.statusLabel, "en attente de relecture");
    assert.ok(job.run.nextSteps.some((s) => /Relis/.test(s)));
    const diff = await call(ui.port, `/api/runs/${job.run.runId}/diff`, { token: ui.token });
    assert.match(diff.text, /\+feature/);
    assert.equal((await call(ui.port, "/api/runs/..%2F..%2Fetc/diff", { token: ui.token })).status, 400);
    const decided = await call(ui.port, "/api/outcome", { method: "POST", token: ui.token, body: { runId: job.run.runId, accept: true } });
    assert.equal(decided.status, 200);
    const history = await call(ui.port, "/api/history?lang=fr", { token: ui.token });
    assert.equal(history.json.records[0].status, "accepted");
  });

  it("rejects empty tasks and oversized bodies", async () => {
    assert.equal((await call(ui.port, "/api/route", { method: "POST", token: ui.token, body: { task: "  " } })).status, 400);
    assert.equal((await call(ui.port, "/api/route", { method: "POST", token: ui.token, body: { task: "x".repeat(300_000) } })).status, 413);
  });
});
