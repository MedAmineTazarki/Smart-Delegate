// File and shell tools for the embedded agent, confined to the repository.
//  - every path is resolved and realpath-checked against the repo root, so
//    `..`, absolute paths and symlinks cannot escape
//  - nothing under .git/ is writable; .env* files are neither read nor written
//  - read-only runs get read_file / list_files / search only
//  - bash exists only inside an OS sandbox (see sandbox.mjs)
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sandboxedShell } from "./sandbox.mjs";

const MAX_READ_BYTES = 256 * 1024;
const MAX_OUTPUT = 32 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", ".smart-delegate", "dist", "build"]);
const SECRET_FILE = /(^|\/)\.env(\..*)?$/;

export class ToolError extends Error {}

/** Nearest existing ancestor's realpath + the remaining segments. */
function realish(abs) {
  let existing = abs;
  const rest = [];
  while (!existsSync(existing)) {
    rest.unshift(existing.slice(dirname(existing).length + 1));
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

/**
 * Resolve a model-supplied path inside the repository or throw.
 * @param {string} root realpath of the repository
 */
export function confine(root, p, { write = false } = {}) {
  if (typeof p !== "string" || p.length === 0) throw new ToolError("path is required");
  if (p.includes("\0")) throw new ToolError("invalid path");
  const abs = isAbsolute(p) ? p : resolve(root, p);
  const real = realish(abs);
  if (real !== root && !real.startsWith(root + sep)) throw new ToolError(`path outside the repository: ${p}`);
  const rel = relative(root, real).split(sep).join("/");
  if (SECRET_FILE.test(rel)) throw new ToolError(`refusing to touch secrets file ${rel}`);
  if (write && (rel === ".git" || rel.startsWith(".git/"))) throw new ToolError("the .git directory is not writable");
  if (write && existsSync(abs) && lstatSync(abs).isSymbolicLink()) {
    const target = realpathSync(abs);
    if (target !== root && !target.startsWith(root + sep)) throw new ToolError(`symlink escapes the repository: ${p}`);
  }
  return { abs: real, rel };
}

function clip(text, max = MAX_OUTPUT) {
  return text.length > max ? `${text.slice(0, max)}\n[... truncated ${text.length - max} chars ...]` : text;
}

function walk(root, dir, out, limit) {
  for (const name of readdirSync(dir)) {
    if (out.length >= limit) return;
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(root, full, out, limit);
    else if (st.isFile()) out.push(full);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.root repository realpath
 * @param {boolean} opts.readOnly
 * @param {object|null} opts.sandbox detectShellSandbox() result
 * @param {boolean} [opts.network] shell network access
 * @param {object} opts.Type TypeBox builder exported by pi-ai
 */
// The shell gets a minimal environment: provider API keys and every other
// secret in the agent's environment stay out of reach of model-run commands.
const SHELL_ENV = ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "USER", "LOGNAME", "SHELL"];
export function shellEnv(env = process.env) {
  return Object.fromEntries(SHELL_ENV.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
}

export function buildTools({ root, readOnly, sandbox, network = false, home, Type }) {
  const tools = {
    read_file: {
      description: "Read a UTF-8 text file in the repository. Optional 1-based line offset and line limit.",
      parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) }),
      run({ path, offset, limit }) {
        const { abs } = confine(root, path);
        if (!statSync(abs).isFile()) throw new ToolError(`${path} is not a file`);
        const buf = readFileSync(abs);
        if (buf.length > MAX_READ_BYTES && !offset && !limit) throw new ToolError(`${path} is large (${buf.length} bytes); read it with offset/limit`);
        const lines = buf.toString("utf8").split("\n");
        const start = Math.max(1, Number(offset) || 1);
        const end = limit ? start - 1 + Number(limit) : lines.length;
        return clip(lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join("\n"));
      },
    },
    list_files: {
      description: "List files under a repository directory (recursive, skips .git and node_modules).",
      parameters: Type.Object({ path: Type.Optional(Type.String()) }),
      run({ path = "." }) {
        const { abs } = confine(root, path);
        const out = [];
        walk(root, abs, out, 2000);
        return clip(out.map((f) => relative(root, f)).join("\n") || "(empty)");
      },
    },
    search: {
      description: "Search file contents with a JavaScript regular expression. Returns path:line: text.",
      parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
      run({ pattern, path = "." }) {
        let re;
        try {
          re = new RegExp(pattern);
        } catch (error) {
          throw new ToolError(`invalid regex: ${error.message}`);
        }
        const { abs } = confine(root, path);
        const files = [];
        walk(root, abs, files, 5000);
        const hits = [];
        for (const f of files) {
          if (SECRET_FILE.test(relative(root, f))) continue;
          const st = statSync(f);
          if (st.size > 1024 * 1024) continue;
          const lines = readFileSync(f, "utf8").split("\n");
          lines.forEach((l, i) => {
            if (hits.length < 200 && re.test(l)) hits.push(`${relative(root, f)}:${i + 1}: ${l.slice(0, 300)}`);
          });
          if (hits.length >= 200) break;
        }
        return hits.join("\n") || "(no matches)";
      },
    },
  };
  if (readOnly) return tools;

  tools.write_file = {
    description: "Create or overwrite a file in the repository with the given content.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    run({ path, content }) {
      const { abs, rel } = confine(root, path, { write: true });
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      return `wrote ${rel} (${Buffer.byteLength(content)} bytes)`;
    },
  };
  tools.edit_file = {
    description: "Replace one exact, unique occurrence of old_string with new_string in a repository file.",
    parameters: Type.Object({ path: Type.String(), old_string: Type.String(), new_string: Type.String() }),
    run({ path, old_string: oldString, new_string: newString }) {
      const { abs, rel } = confine(root, path, { write: true });
      const text = readFileSync(abs, "utf8");
      const count = text.split(oldString).length - 1;
      if (count !== 1) throw new ToolError(`old_string must occur exactly once in ${rel} (found ${count})`);
      writeFileSync(abs, text.replace(oldString, () => newString));
      return `edited ${rel}`;
    },
  };
  if (sandbox) {
    tools.bash = {
      description: `Run a shell command in the repository inside an OS sandbox (${sandbox.kind}): writes only inside the repository (not .git) and the temp dir${network ? "" : ", no network"}; .env files and credential stores are unreadable; minimal environment. 120s timeout.`,
      parameters: Type.Object({ command: Type.String() }),
      run({ command }) {
        const { command: bin, args } = sandboxedShell(sandbox, root, command, { network, ...(home ? { home } : {}) });
        const r = spawnSync(bin, args, { cwd: root, env: shellEnv(), encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
        const out = `${r.stdout ?? ""}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`;
        return clip(`exit ${r.status ?? r.signal ?? "?"}${r.error ? ` (${r.error.code ?? r.error.message})` : ""}\n${out}`);
      },
    };
  }
  return tools;
}
