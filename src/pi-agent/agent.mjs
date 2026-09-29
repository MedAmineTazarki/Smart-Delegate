#!/usr/bin/env node
// Embedded coding agent: pi-ai (the provider library DeepSeek Harness uses)
// driving a minimal tool loop over repository-confined tools.
//
//   node agent.mjs <config.json>     brief on stdin
//
// Emits JSONL on stdout: start, tool_call, tool_result, text, final | error.
// Exit 0 when the model finished with a final answer, 1 otherwise.
// Auth: provider API keys from the environment only (pi-ai's in-memory
// credential store; no OAuth, no harness credential store).
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { detectShellSandbox } from "./sandbox.mjs";
import { ToolError, buildTools } from "./tools.mjs";

const emit = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
const fail = (code, message) => {
  emit({ type: "error", code, message });
  process.exitCode = 1;
};

const SYSTEM = (root, toolNames, readOnly) => `You are a careful coding agent working in the repository at ${root}.
Use the tools to inspect and change files; paths are relative to the repository root.
${readOnly ? "You are READ-ONLY: you cannot modify anything." : "Make the smallest correct change. Never commit, push, or rewrite git history; never touch .git or .env files."}
Available tools: ${toolNames.join(", ")}.
When you are done, reply without calling tools, ending with the report block the task asks for.`;

async function main() {
  const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const brief = readFileSync(0, "utf8");
  const piUrl = (rel) => pathToFileURL(join(cfg.piAiDir, rel)).href;
  const pi = await import(piUrl("dist/index.js"));
  const { builtinModels } = await import(piUrl("dist/providers/all.js"));
  const models = builtinModels();

  // Hand-declared OpenAI-compatible providers (local servers, gateways, tests).
  if (cfg.customProviders?.length) {
    const { openAICompletionsApi } = await import(piUrl("dist/api/openai-completions.lazy.js"));
    for (const p of cfg.customProviders) {
      models.setProvider(pi.createProvider({
        id: p.id,
        name: p.name ?? p.id,
        baseUrl: p.baseUrl,
        auth: { apiKey: pi.envApiKeyAuth(`${p.id} key`, [p.apiKeyEnv]) },
        models: p.models.map((m) => ({
          id: m.id, name: m.id, api: "openai-completions", provider: p.id, baseUrl: p.baseUrl,
          reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: m.contextWindow ?? 128000, maxTokens: m.maxTokens ?? 16000,
        })),
        api: openAICompletionsApi(),
      }));
    }
  }

  const model = models.getModel(cfg.provider, cfg.model);
  if (!model) return fail("UNKNOWN_MODEL", `unknown model ${cfg.provider}/${cfg.model} (invalid model for this pi-ai catalog)`);

  const root = realpathSync(cfg.root);
  const sandbox = cfg.readOnly ? null : detectShellSandbox();
  const tools = buildTools({ root, readOnly: cfg.readOnly, sandbox, network: cfg.shellNetwork === true, Type: pi.Type });
  const names = Object.keys(tools);
  emit({ type: "start", provider: cfg.provider, model: cfg.model, tools: names, shellSandbox: sandbox?.kind ?? null, readOnly: cfg.readOnly });

  const context = {
    systemPrompt: SYSTEM(root, names, cfg.readOnly),
    messages: [{ role: "user", content: brief, timestamp: Date.now() }],
    tools: names.map((name) => ({ name, description: tools[name].description, parameters: tools[name].parameters })),
  };
  const usage = { input: 0, output: 0, costUsd: 0 };
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());

  for (let step = 1; step <= (cfg.maxSteps ?? 60); step += 1) {
    const message = await models.completeSimple(model, context, {
      signal: controller.signal,
      ...(cfg.effort ? { reasoning: cfg.effort } : {}),
    });
    context.messages.push(message);
    usage.input += message.usage?.input ?? 0;
    usage.output += message.usage?.output ?? 0;
    usage.costUsd += message.usage?.cost?.total ?? 0;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return fail(message.stopReason === "aborted" ? "ABORTED" : "MODEL_ERROR", message.errorMessage ?? "model request failed");
    }
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (text) emit({ type: "text", text });
    const calls = message.content.filter((b) => b.type === "toolCall");
    if (calls.length === 0) {
      emit({ type: "final", text, usage, steps: step });
      return undefined;
    }
    for (const call of calls) {
      emit({ type: "tool_call", id: call.id, name: call.name, input: call.arguments });
      let output;
      let isError = false;
      try {
        const tool = tools[call.name];
        if (!tool) throw new ToolError(`unknown tool ${call.name}`);
        output = await tool.run(call.arguments ?? {});
      } catch (error) {
        isError = true;
        output = error instanceof ToolError ? `Error: ${error.message}` : `Error: ${error.message ?? error}`;
      }
      emit({ type: "tool_result", id: call.id, name: call.name, isError, preview: String(output).slice(0, 300) });
      context.messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: String(output) }], isError, timestamp: Date.now() });
    }
  }
  return fail("MAX_STEPS", `stopped after ${cfg.maxSteps ?? 60} steps without a final answer`);
}

main().catch((error) => fail("AGENT_CRASH", error?.stack ?? String(error)));
