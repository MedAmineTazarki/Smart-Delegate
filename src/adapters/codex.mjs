// OpenAI Codex CLI adapter.
// Flags verified against `codex exec --help` and `codex exec resume --help`
// (@openai/codex 0.159.0):
//   exec [--json] [-o FILE] [-s read-only|workspace-write|danger-full-access]
//        [-m MODEL] [-c key=value] [-i FILE...] [-]   (prompt "-" = stdin)
//   exec [-s MODE] resume <SESSION_ID> [--json] [-o FILE] [-m] [-c] [-]
//   -s is not accepted after `resume`, so it goes before the subcommand.
// The final message is taken from the -o file (documented). JSONL event
// shapes are parsed defensively as optional enrichment (thread id, errors).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SAFE_TOKEN, defineAdapter, parseJsonLine } from "./base.mjs";

const EFFORT = /^[a-z]{2,16}$/;

function threadIdOf(ev) {
  return ev.thread_id ?? ev.threadId ?? ev.thread?.id ?? ev.thread?.thread_id ?? null;
}

export default defineAdapter({
  id: "codex",
  displayName: "OpenAI Codex",
  binaryNames: ["codex"],
  binaryEnv: "SMART_DELEGATE_CODEX_BIN",
  capabilities: {
    supportsReadOnly: true,
    readOnlyEnforcement: "Codex OS sandbox (-s read-only)",
    supportsWrite: true,
    writeSandbox: "Codex OS sandbox (-s workspace-write)",
    supportsResume: true,
    supportsModelSelection: true,
    supportsStructuredOutput: true,
    supportsEffort: true,
    supportsImages: true,
    imageInput: "-i/--image",
  },
  authProbe: {
    // `codex login status` reports on stderr.
    args: ["login", "status"],
    interpret(r) {
      const text = `${r.stdout}\n${r.stderr}`.trim();
      if (/not logged in/i.test(text)) return { authenticated: false, detail: text.slice(0, 200) };
      if (/logged in/i.test(text)) return { authenticated: true, detail: text.slice(0, 200) };
      return { authenticated: null, detail: r.error ?? text.slice(0, 200) };
    },
  },

  validateModel: (model) => SAFE_TOKEN.test(model),

  // Never spawn `codex models`-style commands: a positional word is a prompt
  // and would hit the API. The local cache is the only offline listing.
  discoverModels() {
    const file = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "models_cache.json");
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      const models = (parsed.models ?? []).map((m) => m?.slug).filter((s) => typeof s === "string" && SAFE_TOKEN.test(s));
      return { source: file, models };
    } catch {
      return { source: file, models: [], error: "no Codex model cache yet (run codex once)" };
    }
  },

  buildCommand(req) {
    const finalMessagePath = join(req.outDir, "final.txt");
    const sandbox = req.readOnly ? "read-only" : "workspace-write";
    const args = ["exec"];
    if (req.sessionId) args.push("-s", sandbox, "resume", req.sessionId);
    for (const image of req.images ?? []) args.push("-i", image);
    args.push("--json", "-o", finalMessagePath);
    if (!req.sessionId) args.push("-s", sandbox);
    if (req.model) args.push("-m", req.model);
    if (req.effort) {
      if (!EFFORT.test(req.effort)) throw new Error(`invalid effort "${req.effort}"`);
      args.push("-c", `model_reasoning_effort=${req.effort}`);
    }
    args.push("-"); // prompt from stdin; the brief never reaches argv
    return { args, stdin: req.brief, finalMessagePath };
  },

  parseOutput({ lines, exitCode, finalText }) {
    let sessionId = null;
    let usage = null;
    let error = null;
    let lastAgentMessage = "";
    let sawJson = false;
    for (const line of lines) {
      const ev = parseJsonLine(line);
      if (!ev) continue;
      sawJson = true;
      sessionId = threadIdOf(ev) ?? sessionId;
      if (ev.type === "turn.completed" && ev.usage) usage = ev.usage;
      if (ev.type === "error" && ev.message) error = String(ev.message);
      if (ev.type === "turn.failed") error = String(ev.error?.message ?? "turn failed");
      if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") {
        lastAgentMessage = ev.item.text;
      }
    }
    const finalMessage = finalText ?? lastAgentMessage;
    if (exitCode === 0 && !sawJson && finalText === null) {
      return { status: "malformed", sessionId, finalMessage: "", error: "no JSON events and no final message file" };
    }
    if (exitCode === 0) {
      return {
        status: "completed",
        sessionId,
        usage,
        finalMessage,
        notes: finalMessage ? [] : ["Codex exited 0 without a final message; review the diff"],
      };
    }
    return { status: "failed", sessionId, usage, finalMessage, error: error ?? `codex exited ${exitCode}` };
  },
});
