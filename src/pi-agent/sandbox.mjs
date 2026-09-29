// OS sandbox for the embedded agent's shell tool. The bash tool exists only
// when one of these is available; otherwise the agent has no shell at all.
//   macOS: sandbox-exec with an SBPL profile (verified on macOS 26):
//          writes only inside the repository (never .git) and the temp dir,
//          no network unless explicitly allowed
//   Linux: bubblewrap (bwrap) with the same shape. Implemented, not yet
//          verified on a Linux machine.
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichBinary } from "../adapters/base.mjs";

/** Quote a path for an SBPL string literal. */
function sbpl(path) {
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function detectShellSandbox() {
  if (process.platform === "darwin" && whichBinary("sandbox-exec", "/usr/bin")) return { kind: "sandbox-exec", path: "/usr/bin/sandbox-exec", verified: true };
  if (process.platform === "linux") {
    const bwrap = whichBinary("bwrap");
    if (bwrap) return { kind: "bwrap", path: bwrap, verified: false };
  }
  return null;
}

export function macProfile(root, { network = false } = {}) {
  const tmp = realpathSync(tmpdir());
  return [
    "(version 1)",
    "(allow default)",
    ...(network ? [] : ["(deny network*)", "(allow network* (remote unix-socket))"]),
    "(deny file-write*)",
    `(allow file-write* (subpath ${sbpl(root)}) (subpath ${sbpl(tmp)}) (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/"))`,
    `(deny file-write* (subpath ${sbpl(join(root, ".git"))}))`,
  ].join("\n");
}

/**
 * argv that runs `command` through bash inside the sandbox.
 * @returns {{ command: string, args: string[] }}
 */
export function sandboxedShell(sandbox, root, command, { network = false } = {}) {
  if (sandbox.kind === "sandbox-exec") {
    return { command: sandbox.path, args: ["-p", macProfile(root, { network }), "/bin/bash", "-c", command] };
  }
  if (sandbox.kind === "bwrap") {
    return {
      command: sandbox.path,
      args: [
        "--ro-bind", "/", "/",
        "--bind", root, root,
        "--ro-bind", join(root, ".git"), join(root, ".git"),
        "--tmpfs", "/tmp",
        "--dev", "/dev",
        "--proc", "/proc",
        ...(network ? [] : ["--unshare-net"]),
        "--die-with-parent",
        "--chdir", root,
        "/bin/bash", "-c", command,
      ],
    };
  }
  throw new Error(`unknown sandbox ${sandbox.kind}`);
}
