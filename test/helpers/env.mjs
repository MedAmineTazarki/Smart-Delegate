// Test helpers: isolated state homes, throwaway git repos (with spaces in
// their paths on purpose), fake agent paths, and a CLI runner.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BIN = join(ROOT, "bin", "smart-delegate.mjs");
export const FAKES = join(ROOT, "fixtures", "fake-agents");

// Never let a test touch the real ~/.dsh: every harness run gets a throwaway home.
process.env.DSH_HOME ??= realpathSync(mkdtempSync(join(tmpdir(), "sd dsh home ")));

export const fake = (behavior) => join(FAKES, `fake-${behavior}-agent.mjs`);

export function tempDir(prefix = "sd test ") {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A committed repository with the given files ({path: content}). */
export function makeRepo(files = { "README.md": "# demo\n" }, { commit = true } = {}) {
  const dir = tempDir("sd repo ");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  writeFiles(dir, files);
  if (commit) {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "initial");
  }
  return dir;
}

export function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Global config pointing each agent at a fake (or disabling it). */
export function homeWithAgents(agents) {
  const home = tempDir("sd home ");
  const config = { schema: "smart-delegate.config.v1", agents: {} };
  for (const id of ["claude", "codex", "command-code", "deepseek-harness"]) {
    config.agents[id] = agents[id] ? { enabled: true, binary: fake(agents[id]) } : { enabled: false, binary: "/nonexistent/agent" };
  }
  writeJson(join(home, "config.json"), config);
  return home;
}

/** Registry entry with sensible defaults for tests. */
export function entry(id, overrides = {}) {
  const [agent, model] = id.split("/");
  return {
    id,
    agent,
    model: model === "default" ? null : model,
    provider: overrides.provider ?? `${agent}-provider`,
    enabled: true,
    status: "stable",
    local: false,
    contextWindow: 200000,
    vision: true,
    costTier: 3,
    costPerTaskUsd: null,
    source: "test",
    confidence: 0.5,
    capabilities: { coding: 0.9, reasoning: 0.9, reliability: 0.9, quality: 0.9, architecture: 0.9, toolUse: 0.9, speed: 0.6 },
    taskFit: {},
    ...overrides,
  };
}

export function registryFile(dir, models) {
  const path = join(dir, "registry.json");
  writeJson(path, { schema: "smart-delegate.registry.v1", models });
  return path;
}

/** Run the CLI asynchronously (fake agents may run for a while). */
export function runCli(args, { cwd = ROOT, env = {}, home } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...process.env, SMART_DELEGATE_LOG: "warn", ...(home ? { SMART_DELEGATE_HOME: home } : {}), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        // not JSON output
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

/** Discovery result stub for pure routing tests. */
export function discovered(...ids) {
  return { agents: ["claude", "codex", "command-code", "deepseek-harness"].map((id) => ({ id, installed: ids.includes(id), enabled: true })) };
}
