// Embedded pi-ai agent: Smart Delegate's own minimal coding agent, built on
// the same provider library as DeepSeek Harness (pi-ai), located from the
// harness installation or SMART_DELEGATE_PI_AI_DIR. It runs as a child
// process (src/pi-agent/agent.mjs) so the relay's timeout, process-group
// cleanup, and git baseline apply unchanged.
//
// Truthful capabilities:
//   file tools are realpath-confined to the repository (.git and .env* off-limits)
//   bash exists only inside an OS sandbox (macOS sandbox-exec verified;
//     Linux bwrap implemented, unverified); no sandbox -> no shell tool
//   read-only runs get no write/edit/shell tools at all
//   auth: provider API keys from the environment only
//   no resume (each run is a fresh conversation)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { locatePiAi } from "../catalog/pi-ai.mjs";
import { SAFE_TOKEN, defineAdapter, parseJsonLine, whichBinary } from "./base.mjs";

const AGENT_SCRIPT = fileURLToPath(new URL("../pi-agent/agent.mjs", import.meta.url));
const ROUTE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EFFORT = /^[a-z]{2,16}$/;

function piAiDirFor(req) {
  if (req.agentInfo?.piAiDir) return req.agentInfo.piAiDir;
  const found = locatePiAi({ config: { catalog: { piAiDir: req.agentConfig?.piAiDir } }, dshBinary: process.env.SMART_DELEGATE_DSH_BIN || whichBinary("dsh") });
  return found.dir;
}

const adapter = defineAdapter({
  id: "pi-agent",
  displayName: "Smart Delegate pi-ai agent",
  binaryNames: ["node"],
  // Runs in-tree (node + src/pi-agent/agent.mjs), not an external vendor CLI.
  embedded: true,
  capabilities: {
    supportsReadOnly: true,
    readOnlyEnforcement: "no write, edit, or shell tools are given to the model; read tools are realpath-confined to the repository",
    supportsWrite: true,
    writeSandbox: "file tools confined to the repository (not .git/.env); bash only inside sandbox-exec (macOS) or bwrap (Linux)",
    supportsResume: false,
    supportsModelSelection: true,
    supportsStructuredOutput: true,
    supportsEffort: true,
    supportsImages: false,
    multiModel: true,
  },

  /** Installed when pi-ai can be located (it ships with DeepSeek Harness). */
  detect(configuredBinary, ctx = {}) {
    const dsh = ctx.agents?.find((a) => a.id === "deepseek-harness");
    const found = locatePiAi({ config: { catalog: { piAiDir: ctx.config?.agents?.["pi-agent"]?.piAiDir } }, dshBinary: dsh?.installed ? dsh.binaryPath : null });
    if (!found.dir) return { id: "pi-agent", installed: false, binaryPath: null, source: found.source, tried: [found.source] };
    return { id: "pi-agent", installed: true, binaryPath: process.execPath, source: `pi-ai ${found.source}`, piAiDir: found.dir };
  },

  getVersion(_binaryPath, detected = {}) {
    try {
      const pkg = JSON.parse(readFileSync(join(detected.piAiDir, "package.json"), "utf8"));
      return { version: `pi-ai ${pkg.version} (embedded agent)`, error: null };
    } catch (error) {
      return { version: null, error: error.message };
    }
  },

  validateModel: (model) => SAFE_TOKEN.test(model),

  buildCommand(req) {
    const provider = req.provider ?? null;
    if (!provider || !ROUTE.test(provider)) throw new Error(`the embedded agent needs a pi-ai provider route (got "${provider}")`);
    if (!req.model) throw new Error("the embedded agent needs an explicit model id");
    if (req.effort && !EFFORT.test(req.effort)) throw new Error(`invalid effort "${req.effort}"`);
    const cfg = {
      piAiDir: piAiDirFor(req),
      provider,
      model: req.model,
      effort: req.effort ?? null,
      readOnly: Boolean(req.readOnly),
      root: req.cwd,
      maxSteps: req.agentConfig?.maxSteps ?? 60,
      shellNetwork: req.agentConfig?.shellNetwork === true,
      customProviders: req.agentConfig?.customProviders ?? [],
    };
    if (!cfg.piAiDir) throw new Error("pi-ai not found (install DeepSeek Harness or set SMART_DELEGATE_PI_AI_DIR)");
    const configPath = join(req.outDir, "pi-agent.json");
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
    return { args: [AGENT_SCRIPT, configPath], stdin: req.brief, meta: { config: cfg } };
  },

  parseOutput({ lines, exitCode }) {
    let final = null;
    let lastText = "";
    let error = null;
    let start = null;
    for (const line of lines) {
      const ev = parseJsonLine(line);
      if (!ev) continue;
      if (ev.type === "start") start = ev;
      if (ev.type === "text") lastText = ev.text;
      if (ev.type === "final") final = ev;
      if (ev.type === "error") error = `${ev.code}: ${ev.message}`;
    }
    const notes = start ? [`tools: ${start.tools.join(", ")}; shell sandbox: ${start.shellSandbox ?? "none (no bash tool)"}`] : [];
    if (exitCode === 0 && final) {
      return { status: "completed", finalMessage: final.text || lastText, usage: { input: final.usage.input, output: final.usage.output }, costUsd: final.usage.costUsd || null, notes };
    }
    if (!start && !error) return { status: exitCode === 0 ? "malformed" : "failed", finalMessage: "", error: "no agent events", notes };
    return { status: "failed", finalMessage: lastText, error: error ?? `agent exited ${exitCode}`, notes };
  },
});

export default adapter;
