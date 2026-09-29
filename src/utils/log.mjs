// Leveled logger. Everything goes to stderr so `--json` stdout stays a clean
// contract. Messages are secret-redacted before they are written.
import { redact } from "../brief/sanitize.mjs";

const LEVELS = { silent: -1, error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

let current = LEVELS[process.env.SMART_DELEGATE_LOG] ?? LEVELS.warn;

export function setLogLevel(name) {
  if (!(name in LEVELS)) throw new Error(`unknown log level "${name}" (use ${Object.keys(LEVELS).join(", ")})`);
  current = LEVELS[name];
}

export function logLevel() {
  return Object.keys(LEVELS).find((key) => LEVELS[key] === current);
}

function emit(level, parts) {
  if (LEVELS[level] > current) return;
  const text = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  process.stderr.write(`smart-delegate ${level}: ${redact(text)}\n`);
}

export const log = {
  error: (...p) => emit("error", p),
  warn: (...p) => emit("warn", p),
  info: (...p) => emit("info", p),
  debug: (...p) => emit("debug", p),
  trace: (...p) => emit("trace", p),
};
