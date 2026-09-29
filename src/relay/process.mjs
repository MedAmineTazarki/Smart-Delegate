// Robust subprocess execution for implementer CLIs.
//  - argv arrays only, never `shell: true` (no shell interpolation of briefs)
//  - the child leads its own process group so the whole tree can be killed
//  - watchdog timeout: SIGTERM to the group, SIGKILL after a grace period
//  - leftover group members are reaped after a normal exit (no orphans)
//  - stdout is streamed line by line to a parser and to an artifact file,
//    with byte caps so a runaway agent cannot exhaust memory or disk
//  - stdin EPIPE (agent exits before reading the brief) is not a crash
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const IS_WINDOWS = process.platform === "win32";
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL_BYTES = 16 * 1024;

/** Children currently running, so a signal to Smart Delegate can clean them up. */
const active = new Set();

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    if (!IS_WINDOWS) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

function groupAlive(child) {
  if (!child.pid || IS_WINDOWS) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Make sure nothing from the agent's process group survives: SIGTERM, wait
 * up to `graceMs` for the group to empty, then SIGKILL whatever is left.
 */
async function reapGroup(child, graceMs) {
  signalGroup(child, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (groupAlive(child) && Date.now() < deadline) await sleep(50);
  if (groupAlive(child)) signalGroup(child, "SIGKILL");
}

/** Terminate every running implementer tree (used by SIGINT/SIGTERM handlers). */
export function terminateAll(signal = "SIGTERM") {
  for (const child of active) signalGroup(child, signal);
  return active.size;
}

export function activeCount() {
  return active.size;
}

/**
 * @param {object} opts
 * @param {string} opts.command executable path
 * @param {string[]} opts.args argv (no shell)
 * @param {string} opts.cwd
 * @param {Record<string,string>} [opts.env]
 * @param {string|null} [opts.input] written to stdin, then stdin is closed
 * @param {number|null} [opts.timeoutMs]
 * @param {number} [opts.killGraceMs]
 * @param {string|null} [opts.stdoutPath] raw stdout artifact
 * @param {string|null} [opts.stderrPath] raw stderr artifact
 * @param {(line: string) => void} [opts.onStdoutLine]
 * @param {number} [opts.maxStdoutBytes] cap for the stdout artifact
 * @returns {Promise<{exitCode:number|null, signal:string|null, timedOut:boolean,
 *   spawnError:string|null, durationMs:number, stderrTail:string, stdoutBytes:number,
 *   stdoutTruncated:boolean}>}
 */
export function runProcess({
  command,
  args,
  cwd,
  env = process.env,
  input = null,
  timeoutMs = null,
  killGraceMs = 5000,
  stdoutPath = null,
  stderrPath = null,
  onStdoutLine = null,
  maxStdoutBytes = 64 * 1024 * 1024,
}) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const outFd = stdoutPath ? openSync(stdoutPath, "a", 0o600) : null;
    const errFd = stderrPath ? openSync(stderrPath, "a", 0o600) : null;
    let stdoutBytes = 0;
    let stdoutTruncated = false;
    let stderrTail = "";
    let lineBuf = "";
    let skippingOverlongLine = false;
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let watchdog = null;
    let reapTimer = null;

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: !IS_WINDOWS,
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({ exitCode: null, signal: null, spawnError: error.message });
      return;
    }
    active.add(child);

    const decoder = new StringDecoder("utf8");
    const emitLines = (text) => {
      lineBuf += text;
      let nl;
      while ((nl = lineBuf.indexOf("\n")) !== -1) {
        const line = lineBuf.slice(0, nl);
        lineBuf = lineBuf.slice(nl + 1);
        if (skippingOverlongLine) {
          skippingOverlongLine = false;
          continue;
        }
        if (line.trim() && onStdoutLine) safeCall(onStdoutLine, line);
      }
      if (lineBuf.length > MAX_LINE_BYTES) {
        lineBuf = "";
        skippingOverlongLine = true;
      }
    };

    child.stdout.on("data", (chunk) => {
      if (outFd !== null) {
        if (stdoutBytes + chunk.length <= maxStdoutBytes) writeSync(outFd, chunk);
        else stdoutTruncated = true;
      }
      stdoutBytes += chunk.length;
      emitLines(decoder.write(chunk));
    });
    child.stderr.on("data", (chunk) => {
      if (errFd !== null) writeSync(errFd, chunk);
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });

    // An agent may exit before reading stdin; EPIPE here is expected, not fatal.
    child.stdin.on("error", () => {});
    if (input !== null && input !== undefined) child.stdin.end(input);
    else child.stdin.end();

    if (timeoutMs) {
      watchdog = setTimeout(() => {
        timedOut = true;
        signalGroup(child, "SIGTERM");
        killTimer = setTimeout(() => signalGroup(child, "SIGKILL"), killGraceMs);
      }, timeoutMs);
    }

    child.on("error", (error) => {
      finish({ exitCode: null, signal: null, spawnError: error.message });
    });

    child.on("exit", (code, signal) => {
      // Reap anything the agent left behind in its process group (no orphans),
      // and let the pipes drain. If a stray process keeps them open past the
      // grace period, force-close so we never hang.
      const closed = new Promise((r) => {
        child.once("close", r);
        reapTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          r();
        }, Math.min(killGraceMs, 2000) + 500);
      });
      Promise.all([reapGroup(child, Math.min(killGraceMs, 2000)), closed]).then(() =>
        finish({ exitCode: code, signal, spawnError: null }),
      );
    });

    function finish({ exitCode, signal, spawnError }) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
      if (child) active.delete(child);
      const tail = decoder.end();
      if (tail) emitLines(tail);
      if (lineBuf.trim() && !skippingOverlongLine && onStdoutLine) safeCall(onStdoutLine, lineBuf);
      if (outFd !== null) closeSync(outFd);
      if (errFd !== null) closeSync(errFd);
      resolvePromise({
        exitCode: exitCode ?? null,
        signal: signal ?? null,
        timedOut,
        spawnError,
        durationMs: Date.now() - started,
        stderrTail,
        stdoutBytes,
        stdoutTruncated,
      });
    }
  });
}

function safeCall(fn, line) {
  try {
    fn(line);
  } catch {
    // a parser bug must not kill the relay; the raw line is still in the artifact
  }
}

/**
 * Short synchronous probe (e.g. `--version`, `auth status`). Bounded by a
 * timeout; never uses a shell.
 */
export function probe(command, args, { cwd = process.cwd(), env = process.env, timeoutMs = 10_000 } = {}) {
  const r = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  return {
    ok: r.status === 0 && !r.error,
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error ? (r.error.code === "ETIMEDOUT" ? "timeout" : r.error.message) : null,
  };
}
