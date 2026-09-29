// Scripted model collection (test fixture). FAKE_PI_SCRIPT is a JSON array;
// step N (N = tool results so far) is one of:
//   { "tool": "<name>", "args": {...} } | { "text": "..." } | { "error": "..." }
export function builtinModels() {
  return {
    setProvider() {},
    getModel(provider, id) {
      return provider === "fake" ? { id, provider } : undefined;
    },
    async completeSimple(model, context) {
      const script = JSON.parse(process.env.FAKE_PI_SCRIPT ?? '[{"text":"STATUS: DONE"}]');
      if (process.env.FAKE_PI_TOOLS_LOG) (await import("node:fs")).appendFileSync(process.env.FAKE_PI_TOOLS_LOG, `${JSON.stringify(context.tools.map((t) => t.name))}\n`);
      const done = context.messages.filter((m) => m.role === "toolResult").length;
      const step = script[Math.min(done, script.length - 1)];
      const usage = { input: 10, output: 5, cost: { total: 0.001 } };
      if (step.error) return { role: "assistant", content: [], stopReason: "error", errorMessage: step.error, usage };
      if (step.tool) return { role: "assistant", content: [{ type: "toolCall", id: `c${done}`, name: step.tool, arguments: step.args }], stopReason: "toolUse", usage };
      return { role: "assistant", content: [{ type: "text", text: step.text }], stopReason: "stop", usage };
    },
  };
}
