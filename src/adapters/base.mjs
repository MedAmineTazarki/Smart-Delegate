// Adapter contract shared by every implementer CLI.
//
// An adapter module provides CLI-specific knowledge only:
//   id, displayName, binaryNames, binaryEnv
//   capabilities                  truthful feature flags (see CAPABILITY_FLAGS)
//   versionArgs, authProbe?       read-only probes
//   validateModel(model)          syntax check for a model id/alias
//   discoverModels?(ctx)          real model ids from the CLI / its cache
//   buildCommand(request)         argv + stdin + env, never a shell string
//   parseOutput(ctx)              raw events -> normalized fields
//   classifyExit?(exitCode)       adapter-documented exit codes -> failure hint
//   prepare?(req)                 async preflight -> { failure } | data passed to
//                                 buildCommand as req.prepared
//   verifyRun?(req, result)       post-run check -> { policyViolation, note }
//
// defineAdapter() adds the generic behaviour: detect(), getVersion(),
// getCapabilities(), run(), resume().
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { SCHEMAS } from "../config/schema.mjs";
import { classifyFailure } from "../relay/failure.mjs";
import { probe, runProcess } from "../relay/process.mjs";
import { redact } from "../brief/sanitize.mjs";

export const CAPABILITY_FLAGS = [
  "supportsReadOnly",
  "supportsWrite",
  "supportsResume",
  "supportsModelSelection",
  "supportsStructuredOutput",
];

const REQUIRED_FUNCTIONS = ["buildCommand", "parseOutput", "validateModel"];

/** Validate that an adapter module satisfies the contract (used by contract tests and the loader). */
export function assertAdapterContract(adapter) {
  const problems = [];
  for (const key of ["id", "displayName"]) if (typeof adapter[key] !== "string" || !adapter[key]) problems.push(`missing ${key}`);
  if (!Array.isArray(adapter.binaryNames) || adapter.binaryNames.length === 0) problems.push("missing binaryNames");
  for (const fn of REQUIRED_FUNCTIONS) if (typeof adapter[fn] !== "function") problems.push(`missing ${fn}()`);
  for (const flag of CAPABILITY_FLAGS) {
    if (typeof adapter.capabilities?.[flag] !== "boolean") problems.push(`capabilities.${flag} must be boolean`);
  }
  if (adapter.capabilities?.supportsReadOnly && !adapter.capabilities.readOnlyEnforcement) {
    problems.push("supportsReadOnly requires capabilities.readOnlyEnforcement (be explicit about how)");
  }
  if (problems.length) throw new Error(`adapter "${adapter.id ?? "?"}" violates the contract: ${problems.join("; ")}`);
  return adapter;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Resolve an executable by walking PATH (no shell, handles spaces in paths). */
export function whichBinary(name, envPath = process.env.PATH ?? "") {
  if (name.includes("/")) return isExecutable(resolve(name)) ? resolve(name) : null;
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolution order: explicit config path > adapter env var > PATH names.
 * @returns {{ path: string|null, source: string, tried: string[] }}
 */
export function resolveAdapterBinary(adapter, configuredBinary = null) {
  const tried = [];
  if (configuredBinary) {
    const p = isAbsolute(configuredBinary) ? configuredBinary : whichBinary(configuredBinary);
    tried.push(configuredBinary);
    return { path: p && isExecutable(p) ? p : null, source: "config", tried };
  }
  const fromEnv = adapter.binaryEnv ? process.env[adapter.binaryEnv] : null;
  if (fromEnv) {
    tried.push(fromEnv);
    return { path: isExecutable(fromEnv) ? fromEnv : null, source: `env:${adapter.binaryEnv}`, tried };
  }
  for (const name of adapter.binaryNames) {
    tried.push(name);
    const p = whichBinary(name);
    if (p) return { path: p, source: "PATH", tried };
  }
  return { path: null, source: "PATH", tried };
}

/** Child environment: inherit, minus variables the adapter must strip. */
export function childEnv(adapter, extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of adapter.stripEnv ?? []) delete env[key];
  return env;
}

const MAX_KEPT_LINE_BYTES = 32 * 1024 * 1024;

export function defineAdapter(spec) {
  const adapter = {
    versionArgs: ["--version"],
    stripEnv: [],
    ...spec,
  };

  adapter.getCapabilities = () => ({ ...adapter.capabilities });

  adapter.detect = (configuredBinary = null) => {
    const resolved = resolveAdapterBinary(adapter, configuredBinary);
    if (!resolved.path) return { id: adapter.id, installed: false, binaryPath: null, source: resolved.source, tried: resolved.tried };
    return { id: adapter.id, installed: true, binaryPath: resolved.path, source: resolved.source };
  };

  adapter.getVersion = (binaryPath) => {
    const r = probe(binaryPath, adapter.versionArgs, { env: childEnv(adapter) });
    if (!r.ok) return { version: null, error: r.error ?? `exit ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 200)}` };
    const text = `${r.stdout}\n${r.stderr}`.trim();
    return { version: (text.split("\n")[0] || "").trim() || "unknown", error: null };
  };

  adapter.checkAuth = (binaryPath) => {
    if (!adapter.authProbe) return { authenticated: null, detail: "no documented auth probe" };
    const r = probe(binaryPath, adapter.authProbe.args, { env: childEnv(adapter), timeoutMs: 15_000 });
    return adapter.authProbe.interpret(r);
  };

  /**
   * Execute one delegation attempt.
   * @param {object} req
   * @param {string} req.binaryPath
   * @param {string} req.cwd
   * @param {string} req.brief
   * @param {string|null} [req.model]
   * @param {string|null} [req.effort]
   * @param {boolean} [req.readOnly]
   * @param {string|null} [req.sessionId] resume this session when set
   * @param {string} req.outDir artifact directory (outside the repo)
   * @param {number|null} [req.timeoutMs]
   * @param {number} [req.killGraceMs]
   * @param {string[]} [req.images]
   */
  adapter.run = async (req) => {
    mkdirSync(req.outDir, { recursive: true, mode: 0o700 });
    if (req.readOnly && !adapter.capabilities.supportsReadOnly) {
      return normalizeResult(adapter, req, {
        status: "failed",
        error: `${adapter.displayName} cannot guarantee a read-only run`,
        failure: { class: "CAPABILITY", scope: "agent", reason: "read-only unsupported" },
      });
    }
    if (req.model && !adapter.validateModel(req.model)) {
      return normalizeResult(adapter, req, {
        status: "failed",
        error: `model "${req.model}" is not a valid ${adapter.displayName} model id`,
        failure: { class: "CAPABILITY", scope: "agent", reason: "invalid model id" },
      });
    }
    // Optional async preflight (e.g. verify a composed config). A failure here
    // means the agent never started, so the tree is untouched.
    let prepared = null;
    if (adapter.prepare) {
      prepared = await adapter.prepare(req);
      if (prepared?.failure) {
        return normalizeResult(adapter, req, { status: prepared.status ?? "failed", error: prepared.failure.reason, failure: prepared.failure, notes: prepared.notes ?? [] });
      }
    }
    const command = adapter.buildCommand({ ...req, prepared });
    const eventsPath = join(req.outDir, "events.jsonl");
    const stderrPath = join(req.outDir, "stderr.txt");
    const lines = [];
    let keptBytes = 0;
    const proc = await runProcess({
      command: req.binaryPath,
      args: command.args,
      cwd: req.cwd,
      env: command.env ?? childEnv(adapter),
      input: command.stdin ?? null,
      timeoutMs: req.timeoutMs ?? null,
      killGraceMs: req.killGraceMs ?? 5000,
      stdoutPath: eventsPath,
      stderrPath,
      onStdoutLine: (line) => {
        if (keptBytes + line.length > MAX_KEPT_LINE_BYTES) return;
        keptBytes += line.length;
        lines.push(line);
      },
    });
    const finalText = command.finalMessagePath && existsSync(command.finalMessagePath)
      ? readFileSync(command.finalMessagePath, "utf8").trim()
      : null;
    const parsed = adapter.parseOutput({ lines, exitCode: proc.exitCode, signal: proc.signal, timedOut: proc.timedOut, finalText });

    let status = parsed.status;
    if (proc.spawnError) status = "unavailable";
    else if (proc.timedOut) status = "timeout";

    let failure = null;
    if (status !== "completed") {
      const hint = adapter.classifyExit?.(proc.exitCode) ?? null;
      failure = classifyFailure({
        status,
        timedOut: proc.timedOut,
        spawnError: proc.spawnError,
        text: `${parsed.error ?? ""}\n${proc.stderrTail}`,
        hint: proc.timedOut ? null : hint,
      });
    }
    const notes = [...(prepared?.notes ?? []), ...(parsed.notes ?? [])];
    let policyViolation = null;
    if (adapter.verifyRun && !proc.spawnError) {
      const check = adapter.verifyRun(req, { ...parsed, status });
      policyViolation = check.policyViolation;
      if (check.note) notes.push(check.note);
    }
    return normalizeResult(adapter, req, {
      ...parsed,
      notes,
      policyViolation,
      status,
      exitCode: proc.exitCode,
      signal: proc.signal,
      durationMs: proc.durationMs,
      stderrTail: redact(proc.stderrTail.split("\n").slice(-20).join("\n")),
      error: proc.spawnError ?? parsed.error ?? (proc.timedOut ? `timed out after ${req.timeoutMs}ms` : null),
      failure,
      command: [req.binaryPath, ...command.args],
      artifacts: { events: eventsPath, stderr: stderrPath, final: command.finalMessagePath ?? null },
      stdoutTruncated: proc.stdoutTruncated,
    });
  };

  adapter.resume = (req) => {
    if (!adapter.capabilities.supportsResume) throw new Error(`${adapter.displayName} does not support resume`);
    if (!req.sessionId) throw new Error("resume requires a sessionId");
    return adapter.run(req);
  };

  return assertAdapterContract(adapter);
}

function normalizeResult(adapter, req, fields) {
  return {
    schema: SCHEMAS.result,
    agent: adapter.id,
    model: req.model ?? null,
    readOnly: Boolean(req.readOnly),
    resumed: Boolean(req.sessionId),
    status: fields.status,
    exitCode: fields.exitCode ?? null,
    signal: fields.signal ?? null,
    sessionId: fields.sessionId ?? null,
    finalMessage: fields.finalMessage ?? "",
    usage: fields.usage ?? null,
    costUsd: fields.costUsd ?? null,
    durationMs: fields.durationMs ?? 0,
    stderrTail: fields.stderrTail ?? "",
    error: fields.error ?? null,
    failure: fields.failure ?? null,
    notes: fields.notes ?? [],
    policyViolation: fields.policyViolation ?? null,
    command: fields.command ?? null,
    artifacts: fields.artifacts ?? null,
    stdoutTruncated: fields.stdoutTruncated ?? false,
  };
}

/** Parse a JSONL line, returning null for non-JSON noise. */
export function parseJsonLine(line) {
  try {
    const v = JSON.parse(line);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Token check for values that reach argv (model ids, effort levels). */
export const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,127}$/;
