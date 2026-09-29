// Local web UI server (`smart-delegate ui`). Dependency-free.
//
// Security model: it can start delegations, so
//   - it binds 127.0.0.1 only;
//   - every /api call needs the random session token printed at startup
//     (header X-SD-Token), so other local pages cannot drive it (CSRF);
//   - the Host header must be the loopback address it listens on (DNS
//     rebinding) and a present Origin must match it; no CORS headers at all.
// Runs are executed by spawning the CLI (`run --json`), so every runtime
// safeguard (git baseline, verification, signals, cleanup) applies unchanged.
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, statePaths } from "../config/config.mjs";
import { discoverAgents } from "../discovery/discovery.mjs";
import { repoRoot } from "../git/git.mjs";
import { aggregate, appendOutcomeUpdate, readHistory } from "../history/ledger.mjs";
import { label, t, tr } from "../i18n/index.mjs";
import { prepareRouting } from "../orchestrator/delegate.mjs";
import { loadRegistry } from "../registry/registry.mjs";
import { candidateLabel } from "../routing/explain.mjs";
import { PAGE } from "./page.mjs";

const BIN = fileURLToPath(new URL("../../bin/smart-delegate.mjs", import.meta.url));
const MAX_BODY = 256 * 1024;
const RUN_ID = /^[0-9TZ-]+-[a-z0-9]{6}$/i;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(type.startsWith("text/html") ? { "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } : {}),
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    // Past the limit, keep draining (so the client gets a 413, not a reset) but store nothing.
    req.on("data", (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("request too large"), { status: 413 }));
        return;
      }
      try {
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
  });
}

const str = (v, max = 20_000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 50) : typeof v === "string" && v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** Request fields accepted from the page (everything else is ignored). */
function routingRequest(body) {
  return {
    mode: str(body.mode, 20) || undefined,
    agent: str(body.agent, 64) || undefined,
    model: str(body.model, 128) || undefined,
    risk: str(body.risk, 10) || undefined,
    files: list(body.files),
    categories: list(body.type).length ? list(body.type) : undefined,
  };
}

/** Route result with human strings rendered in the page's language. */
function routeView(route, language) {
  const cand = (c) => (c ? { ...c, label: candidateLabel(c, language) } : null);
  return {
    decision: route.decision,
    decisionLabel: label("decision", route.decision, language),
    mode: route.mode,
    confidence: route.confidence,
    profile: {
      taskType: route.profile.taskType,
      categories: route.profile.categories,
      complexity: route.profile.complexity,
      risk: route.profile.risk,
      riskLevel: route.profile.riskLevel,
      riskLabel: label("level", route.profile.riskLevel, language),
      signals: route.profile.reasons.map((r) => tr(r, language)),
    },
    primary: cand(route.primary),
    fallbacks: route.fallbacks.map(cand),
    review: { ...route.review, byLabel: label("review", route.review.by, language), label: route.review.agent ? candidateLabel(route.review, language) : null },
    reasons: route.reasons.map((r) => tr(r, language)),
    warnings: route.warnings.map((w) => tr(w, language)),
    ranked: route.ranked.map((c) => ({ id: c.id, label: candidateLabel(c, language), score: c.score, costTier: c.costTier, status: c.status })),
    excluded: route.excluded.map((e) => ({ id: e.id, label: candidateLabel(e, language), reason: tr(e.reason, language) })),
    weights: route.weights
      ? Object.entries(route.weights.values).sort((a, b) => b[1] - a[1]).map(([dim, w]) => ({ dim, label: label("dim", dim, language), weight: w }))
      : [],
  };
}

function runView(summary, language) {
  if (!summary) return null;
  return {
    ...summary,
    statusLabel: label("status", summary.status, language),
    warnings: (summary.warnings ?? []).map((w) => tr(w, language)),
    nextSteps: (summary.nextSteps ?? []).map((s) => tr(s, language)),
    attempts: (summary.attempts ?? []).map((a) => ({ ...a, label: candidateLabel(a.candidate, language), statusLabel: label("status", a.status, language) })),
  };
}

/**
 * @param {{ port?: number, cwd: string, home?: string, onReady?: (info) => void }} opts
 */
export function startUiServer({ port = 3090, cwd, onReady }) {
  const token = randomBytes(24).toString("base64url");
  const tokenBuf = Buffer.from(token);
  const jobs = new Map();
  let jobSeq = 0;
  let boundPort = port;

  const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]);
  const tokenOk = (req) => {
    const got = Buffer.from(String(req.headers["x-sd-token"] ?? ""));
    return got.length === tokenBuf.length && timingSafeEqual(got, tokenBuf);
  };

  function startJob(body) {
    const task = str(body.task);
    if (!task?.trim()) throw Object.assign(new Error(t("ui.errTask")), { status: 400 });
    const dir = resolve(str(body.cwd, 4096) || cwd);
    if (!existsSync(dir)) throw Object.assign(new Error(t("ui.errCwd", { dir })), { status: 400 });
    const r = routingRequest(body);
    const args = [BIN, "run", task, "--json", "--cwd", dir];
    if (r.mode) args.push("--mode", r.mode);
    if (r.agent) args.push("--agent", r.agent);
    if (r.model) args.push("--model", r.model);
    if (r.risk) args.push("--risk", r.risk);
    if (r.files.length) args.push("--files", r.files.join(","));
    for (const g of list(body.gates)) args.push("--gate", g);
    if (body.dryRun === true) args.push("--dry-run");
    const id = `job-${++jobSeq}`;
    const child = spawn(process.execPath, args, { env: { ...process.env, SMART_DELEGATE_LANG: "en" }, stdio: ["ignore", "pipe", "pipe"] });
    const job = { id, task: task.slice(0, 300), cwd: dir, startedAt: new Date().toISOString(), status: "running", result: null, stderr: "", child };
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { job.stderr = (job.stderr + d).slice(-8000); });
    child.on("close", (code) => {
      job.finishedAt = new Date().toISOString();
      try {
        job.result = JSON.parse(out);
        job.status = job.result.schema === "smart-delegate.error.v1" ? "error" : "done";
      } catch {
        job.status = "error";
        job.result = { error: job.stderr.trim().split("\n").slice(-3).join("\n") || `exit ${code}` };
      }
      job.child = null;
    });
    jobs.set(id, job);
    return job;
  }

  const jobView = (j, language) => ({
    id: j.id, task: j.task, cwd: j.cwd, startedAt: j.startedAt, finishedAt: j.finishedAt ?? null, status: j.status,
    run: j.status === "done" ? runView(j.result, language) : null, error: j.status === "error" ? (j.result?.error ?? null) : null,
  });

  async function api(req, res, url) {
    const language = url.searchParams.get("lang") === "en" ? "en" : "fr";
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /api/state") {
      const root = repoRoot(cwd);
      const { config } = loadConfig({ repoRoot: root });
      const discovery = discoverAgents(config);
      const registry = loadRegistry({ repoRoot: root });
      return send(res, 200, {
        cwd, repo: root,
        agents: discovery.agents.map((a) => ({ id: a.id, name: a.displayName, installed: a.installed, enabled: a.enabled, version: a.version, path: a.binaryPath })),
        models: registry.entries.map((e) => ({ id: e.id, agent: e.agent, provider: e.provider, model: e.model, status: e.status, enabled: e.enabled, costTier: e.costTier, contextWindow: e.contextWindow, rated: typeof e.capabilities.coding === "number" })),
      });
    }
    if (route === "POST /api/route") {
      const body = await readBody(req);
      const task = str(body.task);
      if (!task?.trim()) return send(res, 400, { error: t("ui.errTask", {}, language) });
      const dir = resolve(str(body.cwd, 4096) || cwd);
      const prep = prepareRouting({ task, cwd: dir, request: routingRequest(body) });
      return send(res, 200, routeView(prep.route, language));
    }
    if (route === "POST /api/run") {
      const job = startJob(await readBody(req));
      return send(res, 202, jobView(job, language));
    }
    if (route === "GET /api/jobs") return send(res, 200, [...jobs.values()].reverse().map((j) => jobView(j, language)));
    const cancel = /^POST \/api\/jobs\/(job-\d+)\/cancel$/.exec(route);
    if (cancel) {
      const job = jobs.get(cancel[1]);
      if (!job) return send(res, 404, { error: "not found" });
      job.child?.kill("SIGINT");
      return send(res, 200, { ok: true });
    }
    if (route === "GET /api/history") {
      const h = readHistory();
      return send(res, 200, {
        records: h.records.slice(-100).reverse().map((r) => ({ ...r, statusLabel: label("status", r.status ?? (r.success ? "completed" : "failed"), language) })),
        stats: aggregate(h.records),
        corruptLines: h.corruptLines,
      });
    }
    const diff = /^GET \/api\/runs\/([^/]+)\/diff$/.exec(route);
    if (diff) {
      if (!RUN_ID.test(diff[1])) return send(res, 400, { error: "bad run id" });
      const file = join(statePaths().runs, diff[1], "diff.patch");
      return existsSync(file) ? send(res, 200, readFileSync(file, "utf8"), "text/plain; charset=utf-8") : send(res, 404, { error: "not found" });
    }
    if (route === "POST /api/outcome") {
      const body = await readBody(req);
      const runId = str(body.runId, 64);
      if (!runId || !RUN_ID.test(runId) || typeof body.accept !== "boolean") return send(res, 400, { error: "runId and accept required" });
      if (!readHistory().records.some((r) => r.runId === runId)) return send(res, 404, { error: "unknown run" });
      return send(res, 200, appendOutcomeUpdate(runId, { accepted: body.accept, reason: str(body.reason, 500) ?? null }));
    }
    return send(res, 404, { error: "not found" });
  }

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHosts().has(String(req.headers.host))) return send(res, 421, { error: "unexpected host" });
      const origin = req.headers.origin;
      if (origin && !allowedHosts().has(origin.replace(/^https?:\/\//, ""))) return send(res, 403, { error: "cross-origin request refused" });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE, "text/html; charset=utf-8");
      if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
      if (!tokenOk(req)) return send(res, 401, { error: "missing or invalid token" });
      return await api(req, res, url);
    } catch (error) {
      return send(res, error.status ?? 500, { error: error.message });
    }
  });

  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      boundPort = server.address().port;
      const info = { port: boundPort, token, url: `http://127.0.0.1:${boundPort}/#token=${token}`, server, jobs };
      onReady?.(info);
      resolveStart(info);
    });
  });
}
