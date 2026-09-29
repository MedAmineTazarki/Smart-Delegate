// DeepSeek Harness adapter: drives `dsh --profile headless --json`, whose LLM
// seam uses the same provider library as the harness itself (pi-ai via
// @deepseek-ai/dsh-llm-pi-ai), so one agent reaches Anthropic, OpenAI (incl.
// the Codex subscription), Moonshot/Kimi, Z.AI/GLM, Qwen, MiniMax, DeepSeek...
//
// Verified against @deepseek-ai/dsh 0.2.0-rc.2 (real binary, scripted mock LLM):
//   dsh --profile headless --patch <file> --json [--session-id <id>]   task on stdin
//   events: session, status(turn_start|step_*|turn_end{reason.kind}), text,
//           tool_call, tool_result, final | error; exit 0 only when completed
//   no --model flag: the model is the `agent-default-model` row, set by patch
//
// Safety, enforced per run through a JSON patch (JSON is a YAML subset with no
// `!!js` tags, so registry values can never become harness code):
//   sandbox-policy mode workspace-write | read-only, rooted at the repo
//   approval never + a single `smart-delegate` permission preset (fail closed:
//     anything that would need a human is rejected; sandboxed bash still runs)
//   session-log-deepseek disabled; session-telemetry-otel mode DISABLED plus
//     DSH_TELEMETRY_DISABLED=1 (config alone cannot disable that row)
// Preflight: the real `--dump-config` must show every one of those values or
// the run is refused (upstream row renames would otherwise silently restore
// defaults). Post-run: the persisted session log must record the same policy.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { probe } from "../relay/process.mjs";
import { SAFE_TOKEN, childEnv, defineAdapter, parseJsonLine } from "./base.mjs";

export const PRESET = "smart-delegate";
const ROUTE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DUMP_TIMEOUT_MS = 60_000;

export function dshHome(agentConfig = {}) {
  return agentConfig.home || process.env.DSH_HOME || join(homedir(), ".dsh");
}

function dshEnv(adapter, agentConfig) {
  return childEnv(adapter, {
    DSH_HOME: dshHome(agentConfig),
    DSH_TELEMETRY_DISABLED: "1",
    DSH_TELEMETRY_MODE: "DISABLED",
  });
}

/** Split `provider` / `model` for the harness; model null = harness default. */
function selection(req) {
  const provider = req.provider ?? null;
  const model = req.model ?? null;
  if (provider !== null && !ROUTE.test(provider)) throw new Error(`invalid provider route "${provider}"`);
  if (model !== null && !SAFE_TOKEN.test(model)) throw new Error(`invalid model id "${model}"`);
  if (model !== null && provider === null) throw new Error("a harness model needs its provider route (registry field `provider`)");
  return { provider, model };
}

/** The per-run patch (plain data; serialized as JSON). */
export function buildPatch({ cwd, readOnly, provider, model, effort, declareRoute }) {
  const sandbox = readOnly ? "read-only" : "workspace-write";
  const rows = [
    { id: "sandbox-policy", config: { mode: sandbox, workspaceRoot: cwd } },
    { id: "approval", config: { policy: "never" } },
    { id: "permission", config: { presets: { [PRESET]: { sandbox, approval: "never" } }, defaultPreset: PRESET } },
    { id: "session-log-deepseek", disabled: true },
    { id: "session-telemetry-otel", config: { mode: "DISABLED", exporter: { url: "http://127.0.0.1:9/v1/logs" } } },
  ];
  if (model !== null) {
    rows.unshift({ id: "agent-default-model", config: { provider, model, ...(effort ? { reasoningEffort: effort } : {}) } });
  }
  if (declareRoute) rows.push({ id: "llm-pi-ai", config: { providers: { [provider]: {} } } });
  return rows;
}

/** Text of one row in a `--dump-config` listing. */
export function rowBlock(dump, id) {
  const lines = dump.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- id: ${id}`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^(- |# ==)/.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n");
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasValue = (block, key, value) => block !== null && new RegExp(`^\\s+${key}:\\s*['"]?${esc(String(value))}['"]?\\s*$`, "m").test(block);

/** Every safety value we patched must be visible in the composed tree. */
export function verifyDump(dump, stderr, patch) {
  const problems = [];
  for (const m of stderr.matchAll(/entry "([^"]+)" not found/g)) problems.push(`row "${m[1]}" no longer exists upstream`);
  const want = (id, key, value) => {
    if (!hasValue(rowBlock(dump, id), key, value)) problems.push(`${id}.${key} is not ${value} in the composed config`);
  };
  const sandbox = patch.find((r) => r.id === "sandbox-policy").config.mode;
  want("sandbox-policy", "mode", sandbox);
  want("approval", "policy", "never");
  want("permission", "defaultPreset", PRESET);
  want("permission", "approval", "never");
  want("session-log-deepseek", "disabled", "true");
  want("session-telemetry-otel", "mode", "DISABLED");
  const model = patch.find((r) => r.id === "agent-default-model");
  if (model) {
    want("agent-default-model", "provider", model.config.provider);
    want("agent-default-model", "model", model.config.model);
  }
  return problems;
}

/** Does the user's own composed config already declare this pi-ai route? */
export function routeDeclared(dump, provider) {
  const block = rowBlock(dump, "llm-pi-ai");
  return block !== null && new RegExp(`^\\s+${esc(provider)}:`, "m").test(block);
}

/** Decode a multi-frame zstd session log (Node >= 22.15). Null when unreadable. */
function readSessionLog(file) {
  if (typeof zlib.zstdDecompressSync !== "function") return null;
  const raw = readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  for (let i = raw.indexOf(magic); i !== -1; i = raw.indexOf(magic, i + 4)) starts.push(i);
  let text = "";
  for (let k = 0; k < starts.length; k += 1) {
    try {
      text += zlib.zstdDecompressSync(raw.subarray(starts[k], starts[k + 1] ?? raw.length)).toString("utf8");
    } catch {
      // a magic-number false positive inside a frame; neighbouring frames still decode
    }
  }
  return text;
}

/**
 * The policy the harness actually recorded for this session.
 * @returns {{ preset: string|null, sandbox: string|null, approval: string|null } | null}
 */
export function recordedPolicy(home, sessionId) {
  const root = join(home, "sessions");
  if (!sessionId || !existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    const file = join(root, dir, sessionId, "session.v4.jsonl.zstd");
    if (!existsSync(file)) continue;
    const text = readSessionLog(file);
    if (text === null) return null;
    const first = (type, key) => {
      const m = new RegExp(`"type":"${esc(type)}"[^\\n]*?"${key}":"([^"]+)"`).exec(text);
      return m ? m[1] : null;
    };
    return { preset: first("permission/preset", "preset"), sandbox: first("sandbox/mode", "mode"), approval: first("approval/policy", "policy") };
  }
  return null;
}

const adapter = defineAdapter({
  id: "deepseek-harness",
  displayName: "DeepSeek Harness",
  binaryNames: ["dsh"],
  binaryEnv: "SMART_DELEGATE_DSH_BIN",
  versionArgs: ["--version"],
  capabilities: {
    supportsReadOnly: true,
    readOnlyEnforcement: "harness sandbox-policy read-only (fs-sandbox fence + sandboxed shell) with approval never; verified in the composed config before each run",
    supportsWrite: true,
    writeSandbox: "harness sandbox-policy workspace-write rooted at the repository; approval never (no human prompts)",
    supportsResume: true,
    supportsModelSelection: true,
    supportsStructuredOutput: true,
    supportsEffort: true,
    supportsImages: false,
    multiModel: true,
  },
  authProbe: null,

  validateModel: (model) => SAFE_TOKEN.test(model),

  /** Preflight: route detection and a verified composed config. */
  async prepare(req) {
    const agentConfig = req.agentConfig ?? {};
    let sel;
    try {
      sel = selection(req);
    } catch (error) {
      return { failure: { class: "CAPABILITY", scope: "agent", reason: error.message } };
    }
    const env = dshEnv(adapter, agentConfig);
    const dump = (patchFile) => probe(req.binaryPath, ["--profile", "headless", ...(patchFile ? ["--patch", patchFile] : []), "--dump-config"], { cwd: req.cwd, env, timeoutMs: DUMP_TIMEOUT_MS });

    let declareRoute = false;
    if (sel.provider !== null && agentConfig.declareRoutes !== false) {
      const base = dump(null);
      if (/ENOENT/.test(base.error ?? "")) return { status: "unavailable", failure: { class: "ENVIRONMENT", scope: "agent", reason: `dsh not found: ${base.error}` } };
      if (!base.ok) return { failure: { class: "ENVIRONMENT", scope: "agent", reason: `dsh --dump-config failed: ${(base.stderr || base.error || "").trim().slice(0, 300)}` } };
      declareRoute = !routeDeclared(base.stdout, sel.provider);
    }
    const patch = buildPatch({ cwd: req.cwd, readOnly: Boolean(req.readOnly), provider: sel.provider, model: sel.model, effort: req.effort ?? null, declareRoute });
    const patchPath = join(req.outDir, "dsh-patch.json");
    writeFileSync(patchPath, `${JSON.stringify(patch, null, 2)}\n`, { mode: 0o600 });
    const composed = dump(patchPath);
    if (/ENOENT/.test(composed.error ?? "")) return { status: "unavailable", failure: { class: "ENVIRONMENT", scope: "agent", reason: `dsh not found: ${composed.error}` } };
    if (!composed.ok) return { failure: { class: "ENVIRONMENT", scope: "agent", reason: `dsh --dump-config rejected the patch: ${(composed.stderr || composed.error || "").trim().slice(0, 300)}` } };
    writeFileSync(join(req.outDir, "dsh-composed-config.yml"), composed.stdout, { mode: 0o600 });
    const problems = verifyDump(composed.stdout, composed.stderr, patch);
    if (problems.length) {
      return { failure: { class: "POLICY", scope: "agent", reason: `refusing to run: harness safety config not in effect (${problems.join("; ")})` } };
    }
    return { patchPath, env, notes: declareRoute ? [`declared pi-ai route "${sel.provider}" for this run (keyless: stored sign-in or environment)`] : [] };
  },

  buildCommand(req) {
    // Normally prepare() has written and verified the patch. Called directly
    // (contract tests, dry inspection) it writes the same patch unverified.
    let prepared = req.prepared;
    let patch = null;
    if (!prepared) {
      const sel = selection(req);
      patch = buildPatch({ cwd: req.cwd ?? process.cwd(), readOnly: Boolean(req.readOnly), provider: sel.provider, model: sel.model, effort: req.effort ?? null, declareRoute: false });
      const patchPath = join(req.outDir, "dsh-patch.json");
      writeFileSync(patchPath, `${JSON.stringify(patch, null, 2)}\n`, { mode: 0o600 });
      prepared = { patchPath, env: dshEnv(adapter, req.agentConfig ?? {}) };
    }
    const args = ["--profile", "headless", "--patch", prepared.patchPath, "--json"];
    if (req.sessionId) args.push("--session-id", req.sessionId);
    return { args, stdin: req.brief, env: prepared.env, meta: { patch: patch ?? JSON.parse(readFileSync(prepared.patchPath, "utf8")) } };
  },

  parseOutput({ lines, exitCode }) {
    let sessionId = null;
    let lastText = "";
    let finalText = null;
    let reason = null;
    let error = null;
    let sawJson = false;
    const usage = { input: 0, output: 0 };
    for (const line of lines) {
      const ev = parseJsonLine(line);
      if (!ev) continue;
      sawJson = true;
      if (ev.type === "session" && typeof ev.sessionId === "string") sessionId = ev.sessionId;
      if (ev.type === "text" && typeof ev.text === "string" && ev.text.trim()) lastText = ev.text;
      if (ev.type === "final" && typeof ev.text === "string") finalText = ev.text;
      if (ev.type === "error") error = String(ev.message ?? "harness error");
      if (ev.type === "status" && ev.phase === "turn_end") reason = ev.reason ?? null;
      if (ev.type === "status" && ev.phase === "step_end" && ev.usage) {
        usage.input += ev.usage.inputTokens ?? ev.usage.input ?? 0;
        usage.output += ev.usage.outputTokens ?? ev.usage.output ?? 0;
      }
    }
    const finalMessage = finalText?.trim() ? finalText : lastText;
    if (!sawJson) return { status: exitCode === 0 ? "malformed" : "failed", finalMessage: "", error: "no JSON events on stdout" };
    const kind = typeof reason === "object" ? reason?.kind : reason;
    if (exitCode === 0 && kind === "completed") return { status: "completed", sessionId, finalMessage, usage };
    const code = reason?.error?.code;
    const message = reason?.error?.message ?? error ?? `turn ended: ${kind ?? "unknown"}`;
    return { status: "failed", sessionId, finalMessage, usage, error: code ? `${code}: ${message}` : message };
  },

  /** Post-run: the session log must record the policy we asked for. */
  verifyRun(req, result) {
    const recorded = recordedPolicy(dshHome(req.agentConfig ?? {}), result.sessionId);
    if (recorded === null) return { policyViolation: null, note: "could not read the harness session log to confirm the applied policy" };
    const sandbox = req.readOnly ? "read-only" : "workspace-write";
    const ok = recorded.preset === PRESET && recorded.sandbox === sandbox && recorded.approval === "never";
    return {
      policyViolation: !ok,
      note: ok ? `harness recorded preset ${PRESET}, sandbox ${sandbox}, approval never` : `harness recorded ${JSON.stringify(recorded)} instead of ${PRESET}/${sandbox}/never`,
    };
  },
});

export default adapter;
