// Small filesystem helpers: atomic JSON writes, tolerant JSON reads, and a
// lightweight cross-process lock for mutable global state.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export function ensureDir(dir, mode = 0o700) {
  mkdirSync(dir, { recursive: true, mode });
  return dir;
}

/** Write a file atomically (temp file + rename) so readers never see half a file. */
export function writeFileAtomic(path, content, mode = 0o600) {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}

export function writeJsonAtomic(path, value) {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Read a JSON file.
 * Returns `{ ok: true, value }`, `{ ok: false, missing: true }`, or
 * `{ ok: false, error }` for unreadable/corrupt content. Never throws.
 */
export function readJson(path) {
  if (!existsSync(path)) return { ok: false, missing: true };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { ok: false, error: `${path}: ${error.message}` };
  }
}

const STALE_LOCK_MS = 60_000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding an exclusive lock file. Locks older than a minute
 * are considered abandoned (crashed process) and are broken.
 * Read-only routing never takes this lock.
 */
export function withLock(lockPath, fn, { timeoutMs = 10_000 } = {}) {
  ensureDir(dirname(lockPath));
  const deadline = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // lock vanished between open and stat
      }
      if (Date.now() > deadline) throw new Error(`could not acquire lock ${lockPath} within ${timeoutMs}ms`);
      sleepSync(50);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}
