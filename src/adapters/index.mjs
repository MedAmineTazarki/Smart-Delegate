// Adapter registry. Adding an agent = adding a module here (see CONTRIBUTING.md).
import claude from "./claude.mjs";
import codex from "./codex.mjs";
import commandCode from "./command-code.mjs";
import deepseekHarness from "./deepseek-harness.mjs";

export const ADAPTERS = new Map([claude, codex, commandCode, deepseekHarness].map((a) => [a.id, a]));

export function getAdapter(id) {
  const adapter = ADAPTERS.get(id);
  if (!adapter) throw Object.assign(new Error(`unknown agent "${id}" (known: ${[...ADAPTERS.keys()].join(", ")})`), { code: "SD_USAGE" });
  return adapter;
}
