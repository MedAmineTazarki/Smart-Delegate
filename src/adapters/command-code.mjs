// Command Code adapter (an agent/harness that can run many models: Kimi,
// GLM, Qwen, MiniMax, DeepSeek, ... — the model is chosen with -m).
// Flags verified against `cmd --help` (command-code 1.69.0):
//   -p/--print, --output-format json (NDJSON + final result line),
//   --skip-onboarding, --no-auto-update, -t/--trust, --yolo,
//   --permission-mode plan, -r/--resume <id>, -m/--model, --effort,
//   --max-turns (exit 8 on cap), --list-models.
// npm installs the same binary as `command-code`, `commandcode`, `cmd`, `cmdc`;
// the unambiguous names are preferred over the generic `cmd`.
//
// Truthfulness: headless Command Code has no OS sandbox. Write runs need
// --yolo (no permission prompts at all); read-only runs withhold the write
// and shell tools via plan mode. Both are tool-level, not OS-level.
import { SAFE_TOKEN, defineAdapter, parseJsonLine } from "./base.mjs";

const EFFORT = /^[a-z]{2,16}$/;

// Documented headless exit codes (per delegate-skills' verified relay notes).
const EXIT_CLASSES = new Map([
  [3, { class: "ENVIRONMENT", scope: "agent", reason: "Command Code not authenticated (cmd login)" }],
  [4, { class: "POLICY", scope: "agent", reason: "permission denied" }],
  [5, { class: "TRANSIENT", scope: "agent", reason: "rate limited" }],
  [6, { class: "TRANSIENT", scope: "agent", reason: "network failure" }],
  [7, { class: "TRANSIENT", scope: "agent", reason: "Command Code API server error" }],
  [8, { class: "CAPABILITY", scope: "agent", reason: "hit the turn cap" }],
  [9, { class: "TRANSIENT", scope: "agent", reason: "model produced no response" }],
  [10, { class: "POLICY", scope: "agent", reason: "insufficient credits" }],
]);

export default defineAdapter({
  id: "command-code",
  displayName: "Command Code",
  binaryNames: ["command-code", "commandcode", "cmd"],
  binaryEnv: "SMART_DELEGATE_COMMAND_CODE_BIN",
  capabilities: {
    supportsReadOnly: true,
    readOnlyEnforcement: "write/shell tools withheld (no --yolo) + --permission-mode plan (not an OS sandbox)",
    supportsWrite: true,
    writeSandbox: "none (--yolo bypasses all permission prompts)",
    supportsResume: true,
    supportsModelSelection: true,
    supportsStructuredOutput: true,
    supportsEffort: true,
    supportsImages: false,
    multiModel: true,
  },
  authProbe: {
    args: ["status"],
    interpret(r) {
      const text = `${r.stdout}\n${r.stderr}`.trim();
      if (/not authenticated|logged out/i.test(text)) return { authenticated: false, detail: text.slice(0, 200) };
      if (/authenticated/i.test(text)) return { authenticated: true, detail: text.slice(0, 200) };
      return { authenticated: null, detail: r.error ?? text.slice(0, 200) };
    },
  },

  validateModel: (model) => SAFE_TOKEN.test(model),

  classifyExit: (code) => EXIT_CLASSES.get(code) ?? null,

  /** `--list-models` prints "vendor/name  description" rows under headers. */
  discoverModels(ctx) {
    if (!ctx?.probe) return { source: "cmd --list-models", models: [], error: "no probe available" };
    const r = ctx.probe(["--list-models"]);
    if (!r.ok) return { source: "cmd --list-models", models: [], error: r.error ?? `exit ${r.status}` };
    const models = r.stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/, 1)[0])
      .filter((first) => first && first.includes("/") && SAFE_TOKEN.test(first));
    return { source: "cmd --list-models", models: [...new Set(models)] };
  },

  buildCommand(req) {
    // Only known flags: an unknown one would be read as the optional -p query.
    const args = ["-p", "--output-format", "json", "--skip-onboarding", "--no-auto-update", "-t"];
    if (req.readOnly) args.push("--permission-mode", "plan");
    else args.push("--yolo");
    if (req.sessionId) args.push("--resume", req.sessionId);
    if (req.model) args.push("-m", req.model);
    if (req.effort) {
      if (!EFFORT.test(req.effort)) throw new Error(`invalid effort "${req.effort}"`);
      args.push("--effort", req.effort);
    }
    if (req.maxTurns) args.push("--max-turns", String(req.maxTurns));
    return { args, stdin: req.brief };
  },

  /**
   * NDJSON: {"type":"event","event":{...}} lines then one {"type":"result",...}
   * line. The tail can be cut (the CLI exits before flushing a huge run_end),
   * so the session id comes from early events and the report from the last
   * message_end / text deltas; the result line is used when it survives.
   */
  parseOutput({ lines, exitCode }) {
    let sessionId = null;
    let lastText = "";
    let deltas = [];
    let result = null;
    let sawJson = false;
    for (const line of lines) {
      const ev = parseJsonLine(line);
      if (!ev) continue;
      sawJson = true;
      const inner = ev.event;
      for (const c of [ev.sessionId, inner?.sessionId]) if (typeof c === "string" && c) sessionId = c;
      if (inner?.type === "message_start") deltas = [];
      if (inner?.type === "text_delta" && typeof inner.delta === "string") deltas.push(inner.delta);
      if (inner?.type === "message_end" && Array.isArray(inner.content)) {
        const text = inner.content.filter((b) => b?.type === "text").map((b) => b.text).join("").trim();
        if (text) lastText = text;
        deltas = [];
      }
      if (ev.type === "result") result = ev;
    }
    const recovered = lastText || deltas.join("").trim();
    if (!sawJson && exitCode === 0) {
      return { status: "malformed", sessionId, finalMessage: "", error: "no JSON events on stdout" };
    }
    if (result) {
      const ok = exitCode === 0 && result.subtype === "success";
      return {
        status: ok ? "completed" : "failed",
        sessionId: result.sessionId ?? sessionId,
        finalMessage: typeof result.finalText === "string" && result.finalText ? result.finalText : recovered,
        usage: result.usage ?? null,
        error: ok ? null : `result subtype ${result.subtype}${result.stopReason ? ` (${result.stopReason})` : ""}`,
      };
    }
    return {
      status: exitCode === 0 ? "completed" : "failed",
      sessionId,
      finalMessage: recovered,
      error: exitCode === 0 ? null : `command-code exited ${exitCode}`,
      notes: ["result line absent or truncated; outcome inferred from exit code — review the diff"],
    };
  },
});
