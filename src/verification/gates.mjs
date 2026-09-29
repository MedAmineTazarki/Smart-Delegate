// Independent verification. The worker's "tests pass" is a claim; these
// gates are run by Smart Delegate itself after the worker exits.
//
// Security: only *structured* sources become runnable gates (package.json
// scripts, Makefile targets, Gradle wrapper, Cargo, Go, explicit config /
// --gate). Commands merely mentioned in README/AGENTS.md prose are returned
// as suggestions and never executed automatically — repository text is
// untrusted input.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "../relay/process.mjs";

const PLACEHOLDER_TEST = /no test specified/i;
const WATCH = /\b(--watch|watch\b|-w\b|serve\b|dev\b|start\b)/;

function packageManager(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  return "npm";
}

function makeTargets(root) {
  const path = join(root, "Makefile");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((m) => m[1]);
}

/**
 * @param {string} root repository root
 * @param {object} config merged config (verification.gates / autoDiscover)
 * @param {string[]} [explicit] extra gates from --gate (whitespace-split argv)
 * @returns {{ gates: {name:string, argv:string[], source:string}[], suggestions: string[] }}
 */
export function discoverGates(root, config, explicit = []) {
  const gates = [];
  const add = (name, argv, source) => {
    if (!gates.some((g) => g.argv.join(" ") === argv.join(" "))) gates.push({ name, argv, source });
  };
  for (const g of config.verification?.gates ?? []) add(g.name, g.argv, "config");
  for (const cmd of explicit) {
    const argv = cmd.trim().split(/\s+/).filter(Boolean);
    if (argv.length) add(argv.join(" "), argv, "--gate");
  }
  const suggestions = [];

  if (config.verification?.autoDiscover !== false && gates.length === 0) {
    const pkgPath = join(root, "package.json");
    if (existsSync(pkgPath)) {
      let pkg = null;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      } catch {
        // unreadable package.json: no npm gates
      }
      const scripts = pkg?.scripts ?? {};
      const pm = packageManager(root);
      for (const name of ["typecheck", "lint", "test", "build"]) {
        const body = scripts[name];
        if (typeof body !== "string" || PLACEHOLDER_TEST.test(body) || WATCH.test(body)) continue;
        add(name, pm === "npm" && name === "test" ? ["npm", "test"] : [pm, "run", name], "package.json");
      }
    }
    if (existsSync(join(root, "gradlew"))) {
      add("gradle test", ["./gradlew", "test"], "gradlew");
    }
    const targets = makeTargets(root);
    for (const t of ["test", "lint", "check"]) if (targets.includes(t) && !gates.length) add(`make ${t}`, ["make", t], "Makefile");
    if (existsSync(join(root, "Cargo.toml")) && !gates.length) add("cargo test", ["cargo", "test"], "Cargo.toml");
    if (existsSync(join(root, "go.mod")) && !gates.length) add("go test", ["go", "test", "./..."], "go.mod");
  }

  // Prose mentions: suggestions only.
  for (const file of ["AGENTS.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").slice(0, 50_000);
    for (const m of text.matchAll(/`((?:npm|pnpm|yarn|bun|npx|make|cargo|go|\.\/gradlew|gradle|pytest|python -m pytest)\b[^`\n]{0,80})`/g)) {
      const cmd = m[1].trim();
      if (!suggestions.includes(cmd) && !gates.some((g) => g.argv.join(" ") === cmd)) suggestions.push(cmd);
    }
  }
  return { gates, suggestions: suggestions.slice(0, 10) };
}

/**
 * Run gates sequentially (argv, no shell). Stops nothing early: every gate
 * result is useful to the reviewer.
 */
export async function runGates(root, gates, { timeoutMs = 600_000, outDir = null } = {}) {
  const results = [];
  for (const [i, gate] of gates.entries()) {
    const [command, ...args] = gate.argv;
    const resolved = command.startsWith("./") ? join(root, command) : command;
    const r = await runProcess({
      command: resolved,
      args,
      cwd: root,
      env: { ...process.env, CI: process.env.CI ?? "1" },
      timeoutMs,
      stdoutPath: outDir ? join(outDir, `gate-${i + 1}.stdout.txt`) : null,
      stderrPath: outDir ? join(outDir, `gate-${i + 1}.stderr.txt`) : null,
    });
    results.push({
      name: gate.name,
      argv: gate.argv,
      passed: r.exitCode === 0 && !r.timedOut && !r.spawnError,
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      error: r.spawnError,
      durationMs: r.durationMs,
      stderrTail: r.stderrTail.split("\n").slice(-15).join("\n"),
    });
  }
  return {
    ran: results.length > 0,
    passed: results.length === 0 ? null : results.every((r) => r.passed),
    results,
  };
}

export function summarizeGates(verification) {
  if (!verification.ran) return "no gates ran";
  return verification.results.map((r) => `${r.passed ? "PASS" : "FAIL"} ${r.argv.join(" ")}${r.timedOut ? " (timeout)" : ""}`).join("\n");
}
