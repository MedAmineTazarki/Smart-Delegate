// Smart Delegate as a DeepSeek Harness plugin (host half).
//
// Registers, inside dsh:
//   - the `smart_delegate` tool, so the dsh agent can route a task to the best
//     available agent + model and delegate it under Smart Delegate's git
//     baseline, independent verification and review;
//   - the `/delegate` command, so the user can do the same from the composer
//     and record the final accept/reject decision (user-only).
//
// Safety model (host plugins run outside the dsh sandbox):
//   - all work runs in a child process (`bin/smart-delegate.mjs --json`), never
//     in the dsh host: no blocking calls in the host, no process-wide signal
//     handlers, and cancelling one call kills only its own child;
//   - the working directory is the session's own cwd, never a model argument;
//   - `run` (which launches coding agents that write to the repository) always
//     goes through the dsh approval flow; in a read-only session, or when the
//     session mode cannot be read, it is denied outright;
//   - workers launched by Smart Delegate carry SMART_DELEGATE_WORKER=1; a dsh
//     started as a worker does not register this plugin (no recursion);
//   - accepting or rejecting a result stays with the user (/delegate accept).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const name = "smart-delegate";
export const inject = ["tools"];

export const TOOL_NAME = "smart_delegate";
const BIN = fileURLToPath(new URL("../bin/smart-delegate.mjs", import.meta.url));
const MAX_TASK = 20_000;
const RUN_ID = /^[0-9TZ-]+-[a-z0-9]{6}$/i;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

/** Run the Smart Delegate CLI for one call; resolves with its JSON output. */
export function runCli(args, { cwd, signal, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args, "--json"], {
      cwd,
      env: { ...env, SMART_DELEGATE_LANG: "en" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    // SIGINT lets the CLI stop its worker tree and write run.json.
    const onAbort = () => child.kill("SIGINT");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      try {
        resolve({ code, json: JSON.parse(out) });
      } catch {
        reject(new Error(`smart-delegate exited ${code}: ${err.trim().split("\n").slice(-3).join(" ") || "no output"}`));
      }
    });
  });
}

/** Validate model arguments (raw tools own their validation) and build argv. */
export function argvFor(args) {
  const a = args ?? {};
  const action = a.action;
  if (!["route", "explain", "run", "history"].includes(action)) throw new Error("action must be route, explain, run or history");
  if (action === "history") return ["history", "--limit", String(Math.min(Math.max(Number(a.limit) || 10, 1), 50))];
  if (typeof a.task !== "string" || !a.task.trim()) throw new Error("task is required");
  if (a.task.length > MAX_TASK) throw new Error(`task is longer than ${MAX_TASK} characters`);
  const argv = [action, a.task];
  for (const [flag, value] of [["--mode", a.mode], ["--agent", a.agent], ["--model", a.model], ["--risk", a.risk]]) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !TOKEN.test(value)) throw new Error(`${flag.slice(2)} must be a plain token`);
    argv.push(flag, value);
  }
  if (Array.isArray(a.files) && a.files.length) {
    if (!a.files.every((f) => typeof f === "string" && f && !f.startsWith("-"))) throw new Error("files must be relative paths");
    argv.push("--files", a.files.join(","));
  }
  if (action === "run" && Array.isArray(a.gates)) {
    for (const g of a.gates) if (typeof g === "string" && g.trim()) argv.push("--gate", g);
  }
  return argv;
}

/** Small, log-safe projection of a run or route result (no diff, no brief). */
export function compact(action, json) {
  if (json?.schema === "smart-delegate.error.v1") return { ok: false, error: json.error };
  if (action === "history") return { ok: true, records: (json.records ?? []).slice(-20).map(({ runId, timestamp, agent, model, taskType, status, success }) => ({ runId, timestamp, agent, model, taskType, status, success })) };
  if (action === "run") {
    return {
      ok: ["verified", "pending-review", "not-delegated", "dry-run"].includes(json.status),
      runId: json.runId,
      status: json.status,
      route: json.route?.primary ?? null,
      attempts: (json.attempts ?? []).map((t) => ({ agent: t.candidate?.agent, model: t.candidate?.model ?? null, status: t.status, failure: t.failure?.class ?? null })),
      changedFiles: (json.changes?.workerChanges ?? []).map((c) => `${c.kind} ${c.path}`).slice(0, 100),
      verification: json.verification?.ran ? json.verification.results.map((g) => `${g.passed ? "PASS" : "FAIL"} ${g.argv.join(" ")}`) : [],
      review: json.review?.verdict ?? null,
      warnings: json.warnings ?? [],
      nextSteps: json.nextSteps ?? [],
      diffPath: json.changes?.diffPath ?? null,
    };
  }
  return {
    ok: json.decision !== "no-candidate",
    decision: json.decision,
    primary: json.primary,
    fallbacks: json.fallbacks,
    review: json.review,
    confidence: json.confidence,
    reasons: json.reasons,
    excluded: (json.excluded ?? []).map((e) => `${e.id}: ${e.reason}`),
    warnings: json.warnings ?? [],
  };
}

function renderText(action, v) {
  if (!v.ok && v.error) return `Smart Delegate error: ${v.error}`;
  if (action === "history") return v.records.length ? v.records.map((r) => `${r.timestamp} ${r.runId} ${r.agent}/${r.model ?? "default"} ${r.taskType} ${r.status ?? (r.success ? "ok" : "failed")}`).join("\n") : "No delegation history yet.";
  if (action === "run") {
    return [
      `Run ${v.runId}: ${v.status}`,
      v.route ? `Routed to ${v.route.agent} / ${v.route.model ?? "default model"}` : null,
      ...v.attempts.map((t, i) => `Attempt ${i + 1}: ${t.agent}/${t.model ?? "default"} -> ${t.status}${t.failure ? ` [${t.failure}]` : ""}`),
      v.changedFiles.length ? `Changed files:\n${v.changedFiles.join("\n")}` : "No files changed.",
      ...v.verification,
      v.review ? `Independent review: ${v.review}` : null,
      ...v.warnings.map((w) => `Warning: ${w}`),
      ...v.nextSteps.map((s) => `Next: ${s}`),
      "The worker never commits. Review the diff before committing; the user records accept/reject with /delegate accept|reject <runId>.",
    ].filter(Boolean).join("\n");
  }
  return [
    `Decision: ${v.decision}`,
    v.primary ? `Primary: ${v.primary.agent} / ${v.primary.model ?? "default model"} (score ${v.primary.score}, confidence ${v.confidence})` : null,
    v.fallbacks?.length ? `Fallbacks: ${v.fallbacks.map((f) => `${f.agent}/${f.model ?? "default"}`).join(", ")}` : null,
    `Review: ${v.review?.by ?? "none"}`,
    `Why: ${(v.reasons ?? []).join("; ")}`,
    v.excluded.length ? `Filtered out: ${v.excluded.slice(0, 10).join("; ")}` : null,
    ...v.warnings.map((w) => `Warning: ${w}`),
  ].filter(Boolean).join("\n");
}

const PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["route", "explain", "run", "history"], description: "route/explain: choose the best agent + model without running anything. run: delegate the task to that agent under a git baseline, independent verification and review (asks the user first). history: recent delegations." },
    task: { type: "string", description: "Self-contained engineering task (required for route, explain, run). The delegated worker sees only this text plus repository context." },
    mode: { type: "string", enum: ["auto", "quality", "balanced", "economy", "fast", "local-only"], description: "Routing mode (default auto)." },
    agent: { type: "string", description: "Force an agent: claude, codex, command-code, deepseek-harness, pi-agent." },
    model: { type: "string", description: "Force a model (provider/model for deepseek-harness and pi-agent)." },
    risk: { type: "string", enum: ["low", "medium", "high"], description: "Override the detected risk." },
    files: { type: "array", items: { type: "string" }, description: "Repository paths in scope." },
    gates: { type: "array", items: { type: "string" }, description: "Verification commands to run after the worker (e.g. \"npm test\")." },
    limit: { type: "integer", description: "history: number of records (max 50)." },
  },
};

export function apply(ctx, config) {
  if (process.env.SMART_DELEGATE_WORKER) {
    // This dsh is itself a Smart Delegate worker: never delegate recursively.
    return;
  }
  const options = config && typeof config === "object" ? config : {};

  ctx.tools.register({
    name: TOOL_NAME,
    description: "Smart Delegate: pick the best coding agent + model for an engineering task (Claude Code, Codex, Command Code, DeepSeek Harness, pi-ai agent) and optionally delegate it with a self-contained brief, a git baseline that protects the user's changes, independent verification and review. The worker never commits.",
    parameters: PARAMETERS,
    output: {
      schema: { description: "Smart Delegate result (route decision, run summary, or history)." },
      render: (args, value) => [{ type: "text", text: renderText(args?.action, value) }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session?.header?.cwd;
      if (!cwd) throw new Error("this session has no working directory");
      const argv = argvFor(args);
      if (argv[0] === "run" && options.timeout) argv.push("--timeout", String(options.timeout));
      const { json } = await runCli([...argv, "--cwd", cwd], { cwd, signal: exec.signal });
      return compact(args.action, json);
    },
  });

  // `run` launches agents that write to the repository: always ask the user,
  // and never in a read-only session.
  const sessionMode = (session) => {
    try {
      return ctx.get("sandboxPolicy")?.resolve({ session }).mode;
    } catch {
      return undefined;
    }
  };

  ctx.on("tools/pre-execute", (exec, next) => {
    if (exec.name !== TOOL_NAME || exec.arguments?.action !== "run") return next();
    const mode = sessionMode(exec.agent?.session);
    if (mode === undefined || mode === "read-only") {
      return Promise.resolve({ kind: "deny", reason: `smart_delegate run is not allowed in a ${mode ?? "unknown"} permission mode` });
    }
    const task = String(exec.arguments?.task ?? "").slice(0, 160);
    return Promise.resolve({
      kind: "ask",
      reason: `Smart Delegate will launch a coding agent that edits files in this workspace: ${task}`,
      displayReason: {
        en: `Smart Delegate will launch a coding agent that edits files in this workspace: ${task}`,
        fr: `Smart Delegate va lancer un agent de code qui modifiera des fichiers de cet espace de travail : ${task}`,
      },
    });
  });

  // `/delegate <task>` | `/delegate route <task>` | `/delegate history`
  // | `/delegate accept <runId>` | `/delegate reject <runId>` (user-only verdicts).
  ctx.inject(["commands"], (cctx) => {
    cctx.commands.register({
      name: "delegate",
      description: "Smart Delegate: route or delegate a task to the best coding agent; accept/reject a result",
      input: { hint: "<task> | route <task> | history | accept <runId> | reject <runId>" },
      async handler({ agent, rawInput, signal }) {
        const cwd = agent?.session?.header?.cwd;
        const line = String(rawInput ?? "").trim();
        if (!line) return { kind: "error", text: "Usage: /delegate <task> | route <task> | history | accept <runId> | reject <runId>" };
        const [first, ...rest] = line.split(/\s+/);
        try {
          if (first === "accept" || first === "reject") {
            const runId = rest[0];
            if (!RUN_ID.test(runId ?? "")) return { kind: "error", text: "Give a run id, e.g. /delegate accept 20260929T120000-abc123" };
            const { json } = await runCli(["outcome", runId, `--${first}`], { cwd, signal });
            return json.schema === "smart-delegate.error.v1" ? { kind: "error", text: json.error } : { kind: "success", text: `Recorded ${first} for ${runId}.` };
          }
          if (!cwd) return { kind: "error", text: "This session has no working directory." };
          const action = first === "route" || first === "explain" || first === "history" ? first : "run";
          const task = action === "run" ? line : rest.join(" ");
          if (action === "run") {
            const mode = sessionMode(agent?.session);
            if (mode === undefined || mode === "read-only") return { kind: "error", text: `Delegation is not allowed in a ${mode ?? "unknown"} permission mode.` };
          }
          const argv = argvFor({ action, task });
          const { json } = await runCli([...argv, "--cwd", cwd], { cwd, signal });
          const value = compact(action, json);
          return { kind: value.ok === false && value.error ? "error" : "success", text: renderText(action, value) };
        } catch (error) {
          return { kind: "error", text: error.message };
        }
      },
    });
  });
}
