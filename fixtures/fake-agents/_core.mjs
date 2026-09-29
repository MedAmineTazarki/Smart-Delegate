// Shared engine for the fake implementer CLIs used in tests.
//
// A fake binary is configured in place of a real CLI (agents.<id>.binary).
// It recognises which real CLI it is standing in for from the argv the real
// adapter builds, and answers in that CLI's output format:
//   Claude Code  -p --output-format stream-json ...   (JSONL stream)
//   Codex        exec --json -o <file> ...            (JSONL + final file)
//   Command Code -p --output-format json ...          (NDJSON + result line)
//
// Environment knobs (all optional):
//   FAKE_AGENT_LOG        append one JSON line per invocation (argv, cwd, brief)
//   FAKE_EDITS            JSON [{op:"write"|"append"|"delete", path, content}]
//   FAKE_MESSAGE          final report text
//   FAKE_VERDICT          reviewer verdict (default APPROVE)
//   FAKE_FAILURE_MESSAGE  stderr text for failure mode (default: a 429)
//   FAKE_EXIT_CODE        exit code for failure mode (default 1)
//   FAKE_PID_FILE         timeout mode: write "<pid> <grandchild pid>" here
//   FAKE_IGNORE_SIGTERM   timeout mode: ignore SIGTERM (forces SIGKILL path)
//   FAKE_EDIT_ON_FAILURE  failure mode: apply FAKE_EDITS before failing
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function detectFormat(argv) {
  if (argv[0] === "exec") return "codex";
  const i = argv.indexOf("--output-format");
  if (i !== -1 && argv[i + 1] === "stream-json") return "claude";
  if (i !== -1 && argv[i + 1] === "json") return "command-code";
  return "unknown";
}

function isReadOnly(argv, format) {
  if (format === "claude") return argv.includes("plan");
  if (format === "codex") return argv.includes("read-only");
  if (format === "command-code") return argv.includes("plan") && !argv.includes("--yolo");
  return false;
}

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

function emitSuccess(format, argv, message) {
  if (format === "claude") {
    out({ type: "system", subtype: "init", session_id: "fake-claude-session", model: "fake-model" });
    out({ type: "assistant", message: { content: [{ type: "text", text: message }] } });
    out({ type: "result", subtype: "success", is_error: false, result: message, session_id: "fake-claude-session", total_cost_usd: 0.0123, num_turns: 1, usage: { input_tokens: 10, output_tokens: 20 } });
  } else if (format === "codex") {
    const o = argv.indexOf("-o");
    if (o !== -1) writeFileSync(argv[o + 1], message);
    out({ type: "thread.started", thread_id: "fake-codex-thread" });
    out({ type: "item.completed", item: { type: "agent_message", text: message } });
    out({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 20 } });
  } else if (format === "command-code") {
    out({ type: "event", event: { type: "run_start", sessionId: "fake-cc-session" } });
    out({ type: "event", event: { type: "message_start" } });
    out({ type: "event", event: { type: "text_delta", delta: message } });
    out({ type: "event", event: { type: "message_end", content: [{ type: "text", text: message }] } });
    out({ type: "result", subtype: "success", finalText: message, sessionId: "fake-cc-session", stopReason: "end_turn", usage: { input: 10, output: 20 } });
  } else {
    process.stdout.write(`${message}\n`);
  }
}

function emitFailure(format, message) {
  process.stderr.write(`${message}\n`);
  if (format === "claude") {
    out({ type: "system", subtype: "init", session_id: "fake-claude-session" });
    out({ type: "result", subtype: "error_during_execution", is_error: true, result: message, session_id: "fake-claude-session" });
  } else if (format === "codex") {
    out({ type: "thread.started", thread_id: "fake-codex-thread" });
    out({ type: "error", message });
  } else if (format === "command-code") {
    out({ type: "event", event: { type: "run_start", sessionId: "fake-cc-session" } });
  }
}

function applyEdits(cwd) {
  const edits = process.env.FAKE_EDITS ? JSON.parse(process.env.FAKE_EDITS) : [];
  for (const e of edits) {
    const path = join(cwd, e.path);
    if (e.op === "delete") rmSync(path, { force: true });
    else {
      mkdirSync(dirname(path), { recursive: true });
      if (e.op === "append") appendFileSync(path, e.content ?? "fake edit\n");
      else writeFileSync(path, e.content ?? "fake edit\n");
    }
  }
}

export function runFake(behavior) {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv[0] === "-v") {
    process.stdout.write(`9.9.9 (fake ${behavior} agent)\n`);
    return;
  }
  if ((argv[0] === "auth" && argv[1] === "status") || (argv[0] === "login" && argv[1] === "status") || argv[0] === "status") {
    process.stdout.write(argv[0] === "auth" ? '{"loggedIn": true}\n' : "Logged in (Authenticated)\n");
    return;
  }
  if (argv.includes("--list-models")) {
    process.stdout.write("Available models\nfake-vendor/model-a  A fake model\nfake-vendor/model-b  Another\n");
    return;
  }

  const format = detectFormat(argv);
  const brief = readStdin();
  if (process.env.FAKE_AGENT_LOG) {
    appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify({ behavior, format, argv, cwd: process.cwd(), briefLength: brief.length, brief })}\n`);
  }
  const readOnly = isReadOnly(argv, format);
  const report = process.env.FAKE_MESSAGE ?? "STATUS: DONE\nSUMMARY: fake work done\nFILES_CHANGED:\n- see diff\nCOMMANDS_RUN:\n- npm test: pass\nRISKS:\n- none";

  if (readOnly && behavior !== "failure") {
    if (process.env.FAKE_REVIEW_WRITES) writeFileSync(join(process.cwd(), process.env.FAKE_REVIEW_WRITES), "reviewer wrote this\n");
    emitSuccess(format, argv, `Reviewed.\nVERDICT: ${process.env.FAKE_VERDICT ?? "APPROVE"}\nFINDINGS:\n- low none`);
    return;
  }

  switch (behavior) {
    case "success":
      applyEdits(process.cwd());
      emitSuccess(format, argv, report);
      return;
    case "edit":
      if (!process.env.FAKE_EDITS) process.env.FAKE_EDITS = JSON.stringify([{ op: "write", path: "src/feature.txt", content: "feature\n" }]);
      applyEdits(process.cwd());
      emitSuccess(format, argv, report);
      return;
    case "failure":
      if (process.env.FAKE_EDIT_ON_FAILURE) applyEdits(process.cwd());
      emitFailure(format, process.env.FAKE_FAILURE_MESSAGE ?? "Error: 429 Too Many Requests - rate limit exceeded");
      process.exitCode = Number(process.env.FAKE_EXIT_CODE ?? 1);
      return;
    case "malformed":
      process.stdout.write("this is not json\n{broken json\n");
      return;
    case "timeout": {
      if (process.env.FAKE_IGNORE_SIGTERM) process.on("SIGTERM", () => {});
      const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000)"], { stdio: "ignore" });
      if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, `${process.pid} ${grandchild.pid}`);
      setInterval(() => {}, 1000);
      return;
    }
    default:
      throw new Error(`unknown fake behavior ${behavior}`);
  }
}
