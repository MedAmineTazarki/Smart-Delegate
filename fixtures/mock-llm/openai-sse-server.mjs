#!/usr/bin/env node
// Scripted OpenAI-compatible chat-completions server (SSE) for exercising a
// real agent harness without credentials or cost. It never calls a model.
//
// Script (by number of tool results already in the conversation):
//   0 -> call the harness's file-write tool: MOCK_WRITE_PATH / MOCK_WRITE_CONTENT
//   1 -> call the shell tool with MOCK_BASH_COMMAND
//   2+ -> final assistant text MOCK_FINAL_TEXT
// Tool names are picked from the request's own `tools` list (first match of
// /write/ and /bash|shell|exec/), so the script adapts to the harness.
//
// Env: PORT (default 0 = random, printed as "listening <port>"), MOCK_LOG (JSONL
// of each request: tool names, last tool result).
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const log = (obj) => process.env.MOCK_LOG && appendFileSync(process.env.MOCK_LOG, `${JSON.stringify(obj)}\n`);

function pickTool(tools, exact, pattern) {
  const names = tools.map((t) => t.function?.name ?? t.name).filter(Boolean);
  return names.find((n) => exact.includes(n)) ?? names.find((n) => pattern.test(n) && !/todo/i.test(n)) ?? null;
}

/** Fill every required string parameter the tool declares (e.g. a `description`). */
function argsFor(tools, name, args) {
  const params = tools.find((t) => (t.function?.name ?? t.name) === name)?.function?.parameters ?? {};
  const out = { ...args };
  for (const key of params.required ?? []) if (!(key in out)) out[key] = `mock ${key}`;
  return out;
}

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end("data: [DONE]\n\n");
}

const base = (delta, finish = null) => ({
  id: "mock", object: "chat.completion.chunk", created: 0, model: "mock-model",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

function toolCall(name, args, id) {
  return [
    base({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }] }),
    base({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
    { ...base({}, "tool_calls"), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ];
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    let parsed = {};
    try { parsed = JSON.parse(body || "{}"); } catch { /* keep empty */ }
    const messages = parsed.messages ?? [];
    const tools = parsed.tools ?? [];
    const toolResults = messages.filter((m) => m.role === "tool");
    const writeTool = pickTool(tools, ["write", "write_file", "Write"], /write/i);
    const bashTool = pickTool(tools, ["bash", "Bash", "shell"], /bash|shell|exec/i);
    log({ path: req.url, stream: parsed.stream, toolNames: tools.map((t) => t.function?.name ?? t.name), toolResults: toolResults.length, lastToolResult: toolResults.at(-1)?.content });
    if (!req.url.includes("chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    if (toolResults.length === 0 && writeTool) {
      const params = JSON.stringify(tools.find((t) => (t.function?.name ?? t.name) === writeTool)?.function?.parameters ?? {});
      const pathKey = /"file_path"/.test(params) ? "file_path" : /"path"/.test(params) ? "path" : "file";
      sse(res, toolCall(writeTool, argsFor(tools, writeTool, { [pathKey]: process.env.MOCK_WRITE_PATH ?? "mock-output.txt", content: process.env.MOCK_WRITE_CONTENT ?? "written by mock\n" }), "call_write"));
    } else if (toolResults.length === 1 && bashTool && process.env.MOCK_BASH_COMMAND) {
      sse(res, toolCall(bashTool, argsFor(tools, bashTool, { command: process.env.MOCK_BASH_COMMAND }), "call_bash"));
    } else {
      const text = process.env.MOCK_FINAL_TEXT ?? "STATUS: DONE\nSUMMARY: mock run\nCOMMANDS_RUN:\n- none";
      sse(res, [base({ role: "assistant", content: text }), { ...base({}, "stop"), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }]);
    }
  });
});

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  process.stdout.write(`listening ${server.address().port}\n`);
});
