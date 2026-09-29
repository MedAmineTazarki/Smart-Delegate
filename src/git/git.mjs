// Git safety layer. Read-only git commands only: this module never runs
// reset, clean, checkout, stash, commit or push.
//
// Before a delegation we capture a baseline (HEAD, branch, every dirty path
// and a content fingerprint of it). Afterwards we compare, so the orchestrator
// can tell the user's pre-existing edits apart from the worker's edits, and
// notice when the worker touched, reverted, or committed over user work.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, openSync, readSync, closeSync, readlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";

const GIT_TIMEOUT_MS = 30_000;
const MAX_PATCH_BYTES = 4 * 1024 * 1024;

function runGit(cwd, args, { allowExit = [] } = {}) {
  try {
    return execFileSync("git", ["--literal-pathspecs", "-c", "core.quotepath=off", ...args], {
      cwd,
      encoding: "buffer",
      timeout: GIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (error) {
    if (allowExit.includes(error.status) && error.stdout) return error.stdout;
    throw error;
  }
}

function gitText(cwd, args, opts) {
  return runGit(cwd, args, opts).toString("utf8").trim();
}

function tryGit(cwd, args) {
  try {
    return gitText(cwd, args);
  } catch {
    return null;
  }
}

export function gitAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Repository root for `cwd`, or null when not inside a work tree. */
export function repoRoot(cwd) {
  const root = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? realpathSync(root) : null;
}

export function repoId(root) {
  return createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
}

export function currentHead(root) {
  return tryGit(root, ["rev-parse", "--verify", "-q", "HEAD"]);
}

export function currentBranch(root) {
  return tryGit(root, ["symbolic-ref", "--short", "-q", "HEAD"]) ?? (currentHead(root) ? "(detached)" : null);
}

/**
 * Parse `git status --porcelain=v1 -z -uall`.
 * @returns {Map<string, {xy: string, origPath: string|null}>}
 */
export function parsePorcelainZ(buffer) {
  const fields = buffer.toString("utf8").split("\0");
  const entries = new Map();
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (!field) continue;
    const xy = field.slice(0, 2);
    const path = field.slice(3);
    let origPath = null;
    if (xy[0] === "R" || xy[0] === "C") {
      origPath = fields[i + 1] ?? null;
      i += 1;
    }
    entries.set(path, { xy, origPath });
  }
  return entries;
}

export function statusEntries(root) {
  return parsePorcelainZ(runGit(root, ["status", "--porcelain=v1", "-z", "-uall", "--no-renames"]));
}

/** Content fingerprint of a working-tree path (streamed; never loads big files whole). */
export function fingerprint(root, path) {
  const abs = join(root, path);
  let stats;
  try {
    stats = lstatSync(abs);
  } catch (error) {
    return error.code === "ENOENT" ? "absent" : "unreadable";
  }
  if (stats.isSymbolicLink()) {
    try {
      return `symlink:${readlinkSync(abs)}`;
    } catch {
      return "unreadable";
    }
  }
  if (stats.isDirectory()) return "directory";
  if (!stats.isFile()) return "special";
  const hash = createHash("sha256");
  let fd;
  try {
    fd = openSync(abs, "r");
    const buf = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
    }
    return `file:${(stats.mode & 0o777).toString(8)}:${hash.digest("hex")}`;
  } catch {
    return "unreadable";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Snapshot the repository before delegation.
 * @returns {{ root: string, head: string|null, branch: string|null,
 *   dirty: Record<string,{xy:string,fingerprint:string}>, capturedAt: string }}
 */
export function captureBaseline(cwd) {
  const root = repoRoot(cwd);
  if (!root) {
    const error = new Error(`${cwd} is not inside a git work tree; Smart Delegate requires git to protect your changes`);
    error.code = "SD_NOT_GIT";
    throw error;
  }
  const dirty = {};
  for (const [path, { xy }] of statusEntries(root)) {
    dirty[path] = { xy, fingerprint: fingerprint(root, path) };
  }
  return { root, head: currentHead(root), branch: currentBranch(root), dirty, capturedAt: new Date().toISOString() };
}

function changeKind(xy) {
  if (xy === "??") return "untracked";
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A")) return "added";
  if (xy.includes("R")) return "renamed";
  return "modified";
}

/**
 * Compare the current tree with a baseline and attribute changes.
 * - workerChanges: paths clean at baseline that are dirty now
 * - userFilesTouched: paths the user had dirty whose content the worker changed
 * - userChangesReverted: paths the user had dirty that are clean now
 * - userChangesPreserved: user-dirty paths left byte-for-byte intact
 */
export function compareToBaseline(baseline) {
  const { root } = baseline;
  const now = statusEntries(root);
  const headAfter = currentHead(root);
  const branchAfter = currentBranch(root);

  const workerChanges = [];
  const userFilesTouched = [];
  const userChangesReverted = [];
  const userChangesPreserved = [];

  for (const [path, { xy }] of now) {
    if (!(path in baseline.dirty)) workerChanges.push({ path, kind: changeKind(xy), xy });
  }
  for (const [path, before] of Object.entries(baseline.dirty)) {
    const after = now.get(path);
    if (!after) {
      userChangesReverted.push(path);
      continue;
    }
    const print = fingerprint(root, path);
    if (print !== before.fingerprint || after.xy !== before.xy) {
      userFilesTouched.push({ path, kind: changeKind(after.xy), xyBefore: before.xy, xyAfter: after.xy });
    } else {
      userChangesPreserved.push(path);
    }
  }

  let committedByWorker = [];
  if (baseline.head && headAfter && headAfter !== baseline.head) {
    const out = tryGit(root, ["diff", "--name-only", baseline.head, headAfter]);
    committedByWorker = out ? out.split("\n").filter(Boolean) : [];
  }

  workerChanges.sort((a, b) => a.path.localeCompare(b.path));
  return {
    headBefore: baseline.head,
    headAfter,
    headChanged: headAfter !== baseline.head,
    branchBefore: baseline.branch,
    branchAfter,
    branchChanged: branchAfter !== baseline.branch,
    workerChanges,
    userFilesTouched,
    userChangesReverted,
    userChangesPreserved,
    committedByWorker,
    userWorkSafe: userFilesTouched.length === 0 && userChangesReverted.length === 0 && headAfter === baseline.head,
  };
}

/** Paths the worker changed that fall outside the declared scope. */
export function outOfScope(paths, scope) {
  if (!scope || scope.length === 0) return [];
  const prefixes = scope.map((s) => s.replace(/^\.\//, "").replace(/\/+$/, ""));
  return paths.filter((p) => !prefixes.some((pre) => p === pre || p.startsWith(`${pre}/`)));
}

/**
 * Diff of the given paths against HEAD (tracked) plus new-file diffs for
 * untracked paths. Bounded in size.
 */
export function diffForPaths(root, changes) {
  if (changes.length === 0) return { stat: "", patch: "", truncated: false };
  const tracked = changes.filter((c) => c.kind !== "untracked").map((c) => c.path);
  const untracked = changes.filter((c) => c.kind === "untracked").map((c) => c.path);
  const hasHead = Boolean(currentHead(root));
  const parts = [];
  const stats = [];
  if (tracked.length) {
    const base = hasHead ? ["HEAD"] : ["--cached"];
    stats.push(gitText(root, ["diff", "--stat", ...base, "--", ...tracked]));
    parts.push(runGit(root, ["diff", "--no-color", ...base, "--", ...tracked]).toString("utf8"));
  }
  for (const path of untracked) {
    const out = runGit(root, ["diff", "--no-color", "--no-index", "--", "/dev/null", path], { allowExit: [1] });
    parts.push(out.toString("utf8"));
    stats.push(` ${path} (new, untracked)`);
  }
  let patch = parts.join("");
  const truncated = Buffer.byteLength(patch) > MAX_PATCH_BYTES;
  if (truncated) patch = `${patch.slice(0, MAX_PATCH_BYTES)}\n[... diff truncated ...]\n`;
  return { stat: stats.filter(Boolean).join("\n"), patch, truncated };
}
