// Claude Code adapter.
// Flags verified against `claude --help` (Claude Code 2.1.283):
//   -p/--print, --output-format stream-json, --verbose, --tools, --settings,
//   --permission-mode (acceptEdits|plan|...), --model, --effort, --resume,
//   --strict-mcp-config, --disallowedTools, --disable-slash-commands.
// NOT available: --max-turns (absent from 2.1.283 help) — never passed.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAFE_TOKEN, defineAdapter, parseJsonLine } from "./base.mjs";

const WRITE_TOOLS = "Read,Glob,Grep,Edit,Write,Bash";
const READ_TOOLS = "Read,Glob,Grep";

// Speed bumps, not a boundary: aliases and scripts can bypass string rules.
// The brief's forbidden-actions list and independent review remain the boundary.
const DENY_RULES = [
  "Bash(git commit *)",
  "Bash(git * commit *)",
  "Bash(git push *)",
  "Bash(git * push *)",
  "Bash(git reset *)",
  "Bash(git clean *)",
  "Bash(git stash *)",
  "Bash(git checkout -- *)",
  "Bash(rm -rf *)",
  "Bash(claude *)",
  "Bash(*smart-delegate*)",
];

/** Inline settings profile passed with --settings (written to the run dir). */
export function claudeSettings({ readOnly }) {
  const settings = { disableClaudeAiConnectors: true, permissions: { deny: readOnly ? [] : DENY_RULES } };
  if (!readOnly && process.platform !== "win32") {
    // Shell commands run inside Claude's sandbox and are auto-approved only
    // while sandboxed; no silent unsandboxed retry.
    settings.sandbox = {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
    };
  }
  return settings;
}

export default defineAdapter({
  id: "claude",
  displayName: "Claude Code",
  binaryNames: ["claude"],
  binaryEnv: "SMART_DELEGATE_CLAUDE_BIN",
  // Claude Code refuses to start nested inside another Claude Code session
  // when CLAUDECODE is inherited. Nothing else is removed.
  stripEnv: ["CLAUDECODE"],
  capabilities: {
    supportsReadOnly: true,
    readOnlyEnforcement: "tool surface limited to Read/Glob/Grep + plan permission mode (not an OS sandbox)",
    supportsWrite: true,
    writeSandbox: "Claude shell sandbox for Bash on macOS/Linux; Edit/Write governed by permission mode",
    supportsResume: true,
    supportsModelSelection: true,
    supportsStructuredOutput: true,
    supportsEffort: true,
    supportsImages: true,
    imageInput: "file paths in the brief (Read tool)",
  },
  authProbe: {
    args: ["auth", "status"],
    interpret(r) {
      const text = `${r.stdout}${r.stderr}`;
      try {
        const parsed = JSON.parse(r.stdout);
        if (typeof parsed.loggedIn === "boolean") return { authenticated: parsed.loggedIn, detail: parsed.loggedIn ? "logged in" : "not logged in" };
      } catch {
        // fall through to text heuristics
      }
      if (/not logged in|logged out/i.test(text)) return { authenticated: false, detail: text.trim().slice(0, 200) };
      if (r.ok) return { authenticated: true, detail: text.trim().slice(0, 200) || "ok" };
      return { authenticated: null, detail: r.error ?? text.trim().slice(0, 200) };
    },
  },

  validateModel: (model) => SAFE_TOKEN.test(model),

  // `claude --help` documents aliases ("fable", "opus", "sonnet") that always
  // point at the latest model of that family; there is no listing command.
  discoverModels: () => ({ source: "claude --help (documented aliases)", models: ["fable", "opus", "sonnet"] }),

  buildCommand(req) {
    const settingsPath = join(req.outDir, "claude-settings.json");
    writeFileSync(settingsPath, `${JSON.stringify(claudeSettings(req), null, 2)}\n`, { mode: 0o600 });
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--tools", req.readOnly ? READ_TOOLS : WRITE_TOOLS,
      "--strict-mcp-config",
      "--disallowedTools", "mcp__*",
      "--disable-slash-commands",
      "--settings", settingsPath,
      "--permission-mode", req.readOnly ? "plan" : "acceptEdits",
    ];
    if (req.sessionId) args.push("--resume", req.sessionId);
    if (req.model) args.push("--model", req.model);
    if (req.effort) args.push("--effort", req.effort);
    let stdin = req.brief;
    if (req.images?.length) {
      stdin += `\n\n# Images\nInspect these image files with the Read tool:\n${req.images.map((p) => `- ${p}`).join("\n")}\n`;
    }
    return { args, stdin };
  },

  parseOutput({ lines, exitCode }) {
    let sessionId = null;
    let model = null;
    let result = null;
    let lastAssistantText = "";
    let sawJson = false;
    for (const line of lines) {
      const ev = parseJsonLine(line);
      if (!ev) continue;
      sawJson = true;
      if (typeof ev.session_id === "string") sessionId = ev.session_id;
      if (ev.type === "system" && ev.subtype === "init" && typeof ev.model === "string") model = ev.model;
      if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
        const text = ev.message.content.filter((b) => b?.type === "text").map((b) => b.text).join("");
        if (text.trim()) lastAssistantText = text.trim();
      }
      if (ev.type === "result") result = ev;
    }
    const notes = model ? [`model reported by Claude: ${model}`] : [];
    if (!result) {
      return {
        status: exitCode === 0 ? "malformed" : "failed",
        sessionId,
        finalMessage: lastAssistantText,
        error: sawJson ? "no terminal result event in stream" : "no JSON events on stdout",
        notes,
      };
    }
    const ok = exitCode === 0 && result.subtype === "success" && result.is_error !== true;
    return {
      status: ok ? "completed" : "failed",
      sessionId,
      finalMessage: typeof result.result === "string" ? result.result : lastAssistantText,
      usage: result.usage ?? null,
      costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
      error: ok ? null : `result subtype ${result.subtype}${result.is_error ? " (is_error)" : ""}: ${String(result.result ?? "").slice(0, 300)}`,
      notes,
    };
  },
});
