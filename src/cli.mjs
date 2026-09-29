// Command-line interface. With --json, stdout carries exactly one JSON
// document (the contract) and every diagnostic goes to stderr.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ensureGlobalConfig, loadConfig, projectPaths, stateHome, statePaths } from "./config/config.mjs";
import { SCHEMAS } from "./config/schema.mjs";
import { discoverAgents, discoverModels } from "./discovery/discovery.mjs";
import { gitAvailable, repoRoot } from "./git/git.mjs";
import { aggregate, appendOutcomeUpdate, readHistory } from "./history/ledger.mjs";
import { prepareRouting, runDelegation } from "./orchestrator/delegate.mjs";
import { loadRegistry, mergeUserEntries, readUserEntries, saveUserEntries } from "./registry/registry.mjs";
import { catalogUpdates, loadPiAi, locatePiAi, providerAuth } from "./catalog/pi-ai.mjs";
import { terminateAll } from "./relay/process.mjs";
import { candidateLabel, explainRoute } from "./routing/explain.mjs";
import { ensureDir, readJson, writeJsonAtomic } from "./utils/fs.mjs";
import { log, setLogLevel } from "./utils/log.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `smart-delegate ${VERSION} — route engineering tasks to the best available coding agent + model

Usage: smart-delegate <command> [options]

Commands:
  setup                 create ~/.smart-delegate, discover agents  (--project: add .smart-delegate/config.json)
  doctor                check node, git, state, config, registry, agents (incl. auth)
  agents                list implementer CLIs installed right now
  models                list registry candidates  (--discover: ask CLIs for real model ids, --save to record them)
                        --catalog: pi-ai catalog facts (context, vision, price) and provider key presence;
                        --catalog --provider <id,...> --save: add DeepSeek Harness candidates for those providers
  route <task>          choose primary, fallbacks and review policy (no execution)
  explain <task>        route + human-readable reasoning
  run <task>            route, delegate, verify, review, record
  history               recent outcomes  (--stats: per agent/model aggregates, --limit N)
  outcome <runId>       record your final decision: --accept | --reject [--reason text]

Task input: positional text, or --task-file <path>.

Routing options (route/explain/run):
  --mode <m>            auto | quality | balanced | economy | fast | local-only
  --agent <id>          use this agent (manual override)
  --model <id>          use this model (manual override)
  --exclude-agent <id>  repeatable      --exclude-provider <id>  repeatable
  --no-delegate         do not delegate (decision "stay")
  --force-delegate      delegate even if the task looks trivial
  --type <a,b>          task categories (skip keyword detection)
  --risk <low|medium|high|0..1>          --complexity <0..1>
  --files <a,b>         paths in scope (repeatable)
  --image <path>        image input (repeatable; implies vision)
  --max-cost-tier <1-5> hard budget     --budget-usd <n>  hard per-task budget
  --registry <file>     extra registry layer (highest precedence)

Run options:
  --timeout <dur>       worker watchdog (default from config, e.g. 30m)
  --gate "<cmd>"        verification command, argv split on spaces (repeatable)
  --context-file <p>    extra context for the brief
  --requirement / --constraint / --acceptance <text>  (repeatable)
  --review <by>         none | orchestrator | independent   (default: by risk)
  --skip-verification   do not run gates (result is never "verified")
  --baseline-gates      run gates before delegating too
  --dry-run             build the brief and plan, do not execute

Global: --json  --cwd <dir>  --log-level <error|warn|info|debug|trace>  -h/--help  -v/--version
`;

const OPTIONS = {
  json: { type: "boolean" },
  cwd: { type: "string" },
  "log-level": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  "task-file": { type: "string" },
  mode: { type: "string" },
  agent: { type: "string" },
  model: { type: "string" },
  "exclude-agent": { type: "string", multiple: true },
  "exclude-provider": { type: "string", multiple: true },
  "no-delegate": { type: "boolean" },
  "force-delegate": { type: "boolean" },
  type: { type: "string" },
  risk: { type: "string" },
  complexity: { type: "string" },
  files: { type: "string", multiple: true },
  image: { type: "string", multiple: true },
  "max-cost-tier": { type: "string" },
  "budget-usd": { type: "string" },
  registry: { type: "string" },
  timeout: { type: "string" },
  gate: { type: "string", multiple: true },
  "context-file": { type: "string" },
  requirement: { type: "string", multiple: true },
  constraint: { type: "string", multiple: true },
  acceptance: { type: "string", multiple: true },
  review: { type: "string" },
  "skip-verification": { type: "boolean" },
  "baseline-gates": { type: "boolean" },
  "dry-run": { type: "boolean" },
  discover: { type: "boolean" },
  catalog: { type: "boolean" },
  provider: { type: "string", multiple: true },
  save: { type: "boolean" },
  stats: { type: "boolean" },
  limit: { type: "string" },
  project: { type: "boolean" },
  accept: { type: "boolean" },
  reject: { type: "boolean" },
  reason: { type: "string" },
};

export const EXIT = { ok: 0, failure: 1, usage: 2, noCandidate: 3 };

function usageError(message) {
  return Object.assign(new Error(message), { code: "SD_USAGE" });
}

function num(value, name, min, max) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw usageError(`--${name} must be a number between ${min} and ${max}`);
  return n;
}

function taskText(values, positionals) {
  if (values["task-file"]) return readFileSync(resolve(values["task-file"]), "utf8");
  const text = positionals.join(" ").trim();
  if (!text) throw usageError("missing task: pass it as text or with --task-file");
  return text;
}

function splitList(values) {
  return (values ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

function routingRequest(values) {
  let risk;
  if (values.risk !== undefined) risk = ["low", "medium", "high"].includes(values.risk) ? values.risk : num(values.risk, "risk", 0, 1);
  if (values.review && !["none", "orchestrator", "independent"].includes(values.review)) throw usageError("--review must be none, orchestrator or independent");
  return {
    mode: values.mode,
    agent: values.agent,
    model: values.model,
    excludeAgents: splitList(values["exclude-agent"]),
    excludeProviders: splitList(values["exclude-provider"]),
    noDelegate: values["no-delegate"] ?? false,
    forceDelegate: values["force-delegate"] ?? false,
    categories: values.type ? splitList([values.type]) : undefined,
    risk,
    complexity: num(values.complexity, "complexity", 0, 1),
    files: splitList(values.files),
    images: (values.image ?? []).map((p) => resolve(p)),
    maxCostTier: num(values["max-cost-tier"], "max-cost-tier", 1, 5),
    maxUsdPerTask: num(values["budget-usd"], "budget-usd", 0, 1e6),
    registryPath: values.registry ? resolve(values.registry) : null,
    timeout: values.timeout,
    gates: values.gate ?? [],
    context: values["context-file"] ? readFileSync(resolve(values["context-file"]), "utf8") : "",
    requirements: values.requirement,
    constraints: values.constraint,
    acceptance: values.acceptance,
    review: values.review,
    skipVerification: values["skip-verification"] ?? false,
    baselineGates: values["baseline-gates"] ?? false,
    dryRun: values["dry-run"] ?? false,
  };
}

function emit(json, data, text) {
  if (json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else process.stdout.write(`${text}\n`);
}

// ---------------------------------------------------------------- commands

function cmdAgents(ctx) {
  const root = repoRoot(ctx.cwd);
  const { config } = loadConfig({ repoRoot: root });
  const d = discoverAgents(config);
  const lines = d.agents.map((a) =>
    a.installed
      ? `${a.id.padEnd(13)} installed  ${a.version}  (${a.binaryPath}, via ${a.binarySource})${a.enabled ? "" : "  [disabled in config]"}`
      : `${a.id.padEnd(13)} not found  (looked for: ${(a.tried ?? []).join(", ")})`,
  );
  emit(ctx.json, d, lines.join("\n"));
  return EXIT.ok;
}

async function cmdModels(ctx) {
  const root = repoRoot(ctx.cwd);
  const { config } = loadConfig({ repoRoot: root });
  const registry = loadRegistry({ repoRoot: root, registryPath: ctx.values.registry ? resolve(ctx.values.registry) : null });
  const discovery = discoverAgents(config);
  const installed = new Map(discovery.agents.map((a) => [a.id, a]));
  const out = {
    schema: SCHEMAS.registry,
    sources: registry.sources,
    models: registry.entries.map((e) => ({
      id: e.id, agent: e.agent, model: e.model, provider: e.provider, status: e.status, enabled: e.enabled,
      agentInstalled: Boolean(installed.get(e.agent)?.installed), costTier: e.costTier, contextWindow: e.contextWindow,
      source: e.source, confidence: e.confidence,
    })),
  };
  const lines = out.models.map((m) =>
    `${m.id.padEnd(28)} ${m.status.padEnd(12)} ${m.agentInstalled ? "agent ok " : "no agent "} tier ${m.costTier ?? "?"}  ${m.enabled ? "" : "[disabled] "}(${m.source})`,
  );
  if (ctx.values.discover) {
    const known = new Set(registry.entries.map((e) => `${e.agent}|${e.model}`));
    out.discovered = [];
    for (const agent of discovery.agents.filter((a) => a.installed)) {
      const found = discoverModels(agent);
      const fresh = found.models.filter((m) => !known.has(`${agent.id}|${m}`));
      out.discovered.push({ agent: agent.id, source: found.source, error: found.error ?? null, models: found.models, notInRegistry: fresh });
      lines.push("", `${agent.id}: ${found.error ? `discovery failed (${found.error})` : `${found.models.length} model(s) from ${found.source}`}`);
      for (const m of fresh) lines.push(`  new: ${m}`);
    }
    if (ctx.values.save) {
      // New models start experimental with unknown capabilities: they cannot
      // pass quality floors until someone measures or rates them.
      const entries = out.discovered.flatMap((d) => d.notInRegistry.map((m) => ({
        id: `${d.agent}/${m}`, agent: d.agent, model: m, provider: null, enabled: true, status: "experimental",
        source: `discovered: ${d.source}`, confidence: 0.1, capabilities: {},
      })));
      out.saved = saveUserEntries(entries);
      lines.push("", `saved ${out.saved.added} new experimental entr${out.saved.added === 1 ? "y" : "ies"} to ${out.saved.path}`);
    }
  }
  if (ctx.values.catalog) await catalogSection(ctx, { config, registry, discovery, out, lines });
  emit(ctx.json, out, lines.join("\n"));
  return EXIT.ok;
}

async function catalogSection(ctx, { config, registry, discovery, out, lines }) {
  const dsh = discovery.agents.find((a) => a.id === "deepseek-harness");
  const where = locatePiAi({ config, dshBinary: dsh?.installed ? dsh.binaryPath : null });
  lines.push("");
  if (!where.dir) {
    out.catalog = { available: false, reason: where.source };
    lines.push(`pi-ai catalog unavailable: ${where.source}. Install DeepSeek Harness (npm i -g @deepseek-ai/dsh) or set SMART_DELEGATE_PI_AI_DIR.`);
    return;
  }
  const catalog = await loadPiAi(where.dir);
  const auth = providerAuth(catalog);
  const requested = splitList(ctx.values.provider);
  const unknown = requested.filter((p) => !(p in catalog.providers));
  if (unknown.length) throw usageError(`unknown pi-ai provider(s): ${unknown.join(", ")} (see smart-delegate models --catalog)`);
  // Real model ids Claude Code reported for its aliases (never guessed).
  const observed = {};
  for (const r of readHistory().records) if (r.resolvedModel) observed[r.candidateId] = r.resolvedModel;
  // Candidates for every installed pi-ai-based agent (harness: sign-ins or env keys; embedded agent: env keys).
  const agents = discovery.agents.filter((a) => a.installed && ["deepseek-harness", "pi-agent"].includes(a.id)).map((a) => a.id);
  const { updates, skipped } = catalogUpdates({ entries: registry.entries, userEntries: readUserEntries(), catalog, providers: requested, observed, agents: agents.length ? agents : ["deepseek-harness"] });
  out.catalog = { available: true, version: catalog.version, dir: where.dir, source: where.source, providers: auth, updates, skipped };
  lines.push(`pi-ai ${catalog.version} (${where.source}): ${auth.length} providers, ${auth.reduce((a, p) => a + p.models, 0)} models`);
  for (const p of auth) lines.push(`  ${p.provider.padEnd(28)} ${String(p.models).padStart(4)} models  ${p.envKeys.length ? `key set: ${p.envKeys.join(", ")}` : "no key in env (a dsh sign-in may still exist)"}`);
  const refreshed = updates.filter((u) => !u.agent).length;
  const added = updates.length - refreshed;
  lines.push("", `${refreshed} existing entr${refreshed === 1 ? "y" : "ies"} with catalog facts, ${added} new harness candidate(s)${requested.length ? ` for ${requested.join(", ")}` : " (pass --provider to add candidates)"}`);
  for (const s of skipped) lines.push(`  kept your value: ${s}`);
  if (ctx.values.save) {
    out.saved = mergeUserEntries(updates);
    lines.push(`saved to ${out.saved.path} (${out.saved.added} added, ${out.saved.updated} updated). New candidates are experimental and unrated: they run only when requested (--agent deepseek-harness --model <id>) until you rate them.`);
  }
}

function cmdRoute(ctx, { explain = false } = {}) {
  const task = taskText(ctx.values, ctx.positionals);
  const prep = prepareRouting({ task, cwd: ctx.cwd, request: routingRequest(ctx.values) });
  const r = prep.route;
  if (ctx.json) {
    const out = explain ? r : { ...r, ranked: r.ranked.map(({ breakdown, ...rest }) => rest) };
    emit(true, out);
  } else if (explain) {
    emit(false, null, explainRoute(r));
  } else {
    const lines = [`decision: ${r.decision}`];
    if (r.primary) lines.push(`primary:  ${candidateLabel(r.primary)}  (score ${r.primary.score}, confidence ${r.confidence})`);
    for (const f of r.fallbacks) lines.push(`fallback: ${candidateLabel(f)}  (score ${f.score})`);
    lines.push(`review:   ${r.review.by}${r.review.agent ? ` -> ${candidateLabel(r.review)}` : ""}`);
    lines.push(`why:      ${r.reasons.join("; ")}`);
    for (const w of r.warnings) lines.push(`warning:  ${w}`);
    emit(false, null, lines.join("\n"));
  }
  return r.decision === "no-candidate" ? EXIT.noCandidate : EXIT.ok;
}

async function cmdRun(ctx) {
  const task = taskText(ctx.values, ctx.positionals);
  const signal = { aborted: false };
  const onSignal = (sig) => {
    if (signal.aborted) {
      terminateAll("SIGKILL");
      process.exit(130);
    }
    signal.aborted = true;
    log.warn(`${sig} received: stopping the worker (send again to force)`);
    terminateAll("SIGTERM");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
  const summary = await runDelegation({ task, cwd: ctx.cwd, request: routingRequest(ctx.values), signal });
  const lines = [`run ${summary.runId}: ${summary.status}`];
  if (summary.route.primary) lines.push(`route: ${candidateLabel(summary.route.primary)} (score ${summary.route.primary.score})`);
  for (const a of summary.attempts) {
    lines.push(`attempt ${a.attempt}: ${candidateLabel(a.candidate)} -> ${a.status}${a.failure ? ` [${a.failure.class}: ${a.failure.reason}]` : ""}${a.durationMs ? ` in ${Math.round(a.durationMs / 1000)}s` : ""}`);
  }
  if (summary.changes) {
    lines.push(`worker changed ${summary.changes.workerChanges.length} file(s); your ${summary.changes.userChangesPreserved} pre-existing change(s) preserved`);
    for (const c of summary.changes.workerChanges.slice(0, 30)) lines.push(`  ${c.kind.padEnd(9)} ${c.path}`);
  }
  if (summary.verification?.ran) {
    for (const g of summary.verification.results) lines.push(`gate ${g.passed ? "PASS" : "FAIL"}: ${g.argv.join(" ")}`);
  }
  if (summary.review?.verdict) lines.push(`review (${summary.review.agent}): ${summary.review.verdict}`);
  for (const w of summary.warnings) lines.push(`warning: ${w}`);
  for (const s of summary.nextSteps) lines.push(`next: ${s}`);
  if (summary.brief) lines.push("", summary.brief);
  lines.push(`artifacts: ${summary.runDir}`);
  emit(ctx.json, summary, lines.join("\n"));
  const ok = ["verified", "pending-review", "not-delegated", "dry-run"].includes(summary.status);
  if (summary.status === "no-candidate") return EXIT.noCandidate;
  return ok ? EXIT.ok : EXIT.failure;
}

function cmdHistory(ctx) {
  const h = readHistory();
  const limit = ctx.values.limit ? Number(ctx.values.limit) : 20;
  if (ctx.values.stats) {
    const stats = aggregate(h.records);
    const lines = stats.map((s) => `${`${s.agent}/${s.model ?? "(default)"}`.padEnd(30)} ${s.taskType.padEnd(16)} ${s.accepted}/${s.attempts} accepted  ${s.transient} transient`);
    emit(ctx.json, { path: h.path, corruptLines: h.corruptLines, stats }, lines.join("\n") || "no history yet");
    return EXIT.ok;
  }
  const recent = h.records.slice(-limit);
  const lines = recent.map((r) => `${r.timestamp}  ${r.runId}  ${r.agent}/${r.model ?? "(default)"}  ${r.taskType}  ${r.status ?? (r.success ? "ok" : "failed")}${r.failureClass ? ` [${r.failureClass}]` : ""}`);
  emit(ctx.json, { path: h.path, corruptLines: h.corruptLines, records: recent }, lines.join("\n") || "no history yet");
  return EXIT.ok;
}

function cmdOutcome(ctx) {
  const runId = ctx.positionals[0];
  if (!runId) throw usageError("usage: smart-delegate outcome <runId> --accept|--reject [--reason text]");
  if (Boolean(ctx.values.accept) === Boolean(ctx.values.reject)) throw usageError("pass exactly one of --accept / --reject");
  const h = readHistory();
  if (!h.records.some((r) => r.runId === runId)) throw usageError(`no history for run ${runId}`);
  const rec = appendOutcomeUpdate(runId, { accepted: Boolean(ctx.values.accept), reason: ctx.values.reason ?? null });
  emit(ctx.json, rec, `recorded ${ctx.values.accept ? "accept" : "reject"} for ${runId}`);
  return EXIT.ok;
}

function cmdSetup(ctx) {
  const paths = statePaths();
  ensureDir(paths.home);
  const cfg = ensureGlobalConfig();
  const root = repoRoot(ctx.cwd);
  const { config } = loadConfig({ repoRoot: root });
  const d = discoverAgents(config);
  writeJsonAtomic(paths.agents, d);
  const out = { home: paths.home, config: cfg, agentsCache: paths.agents, agents: d.agents.map(({ id, installed, version, binaryPath }) => ({ id, installed, version, binaryPath })) };
  if (ctx.values.project) {
    if (!root) throw usageError("--project needs to run inside a git repository");
    const p = projectPaths(root);
    if (!existsSync(p.config)) {
      writeJsonAtomic(p.config, { schema: SCHEMAS.config, verification: { gates: [] }, exclude: { agents: [], providers: [] } });
      out.projectConfig = { path: p.config, created: true };
    } else {
      out.projectConfig = { path: p.config, created: false };
    }
  }
  const lines = [`state: ${paths.home}`, `config: ${cfg.path}${cfg.created ? " (created)" : ""}`];
  for (const a of out.agents) lines.push(`${a.id.padEnd(13)} ${a.installed ? `installed ${a.version}` : "not found"}`);
  if (out.projectConfig) lines.push(`project config: ${out.projectConfig.path}${out.projectConfig.created ? " (created)" : ""}`);
  if (!out.agents.some((a) => a.installed)) lines.push("No implementer CLI found. Install Claude Code, Codex or Command Code.");
  emit(ctx.json, out, lines.join("\n"));
  return EXIT.ok;
}

function cmdDoctor(ctx) {
  const checks = [];
  const check = (name, ok, detail, level = "error") => checks.push({ name, ok, level: ok ? "ok" : level, detail });
  const major = Number(process.versions.node.split(".")[0]);
  check("node >= 20", major >= 20, process.version);
  check("git available", gitAvailable(), gitAvailable() ? "ok" : "git not on PATH");
  const root = repoRoot(ctx.cwd);
  check("inside a git repository", Boolean(root), root ?? `${ctx.cwd} is not a git work tree`, "warn");
  const paths = statePaths();
  check("state directory", existsSync(paths.home), existsSync(paths.home) ? paths.home : `${paths.home} missing (run smart-delegate setup)`, "warn");
  let config = null;
  try {
    config = loadConfig({ repoRoot: root }).config;
    check("config valid", true, "defaults + global + project layers load");
  } catch (error) {
    check("config valid", false, error.message);
  }
  try {
    const reg = loadRegistry({ repoRoot: root });
    check("registry valid", true, `${reg.entries.length} candidates from ${reg.sources.length} layer(s)`);
  } catch (error) {
    check("registry valid", false, error.message);
  }
  const h = readHistory();
  check("history readable", h.corruptLines === 0, h.corruptLines ? `${h.corruptLines} corrupt line(s) in ${h.path} (skipped)` : `${h.records.length} record(s)`, "warn");
  const agentsCache = readJson(paths.agents);
  if (!agentsCache.ok && !agentsCache.missing) check("agents cache", false, `${paths.agents} is corrupt; re-run setup`, "warn");
  let agents = [];
  if (config) {
    agents = discoverAgents(config, { auth: true }).agents;
    for (const a of agents) {
      if (!a.installed) check(`agent ${a.id}`, false, "not installed (optional)", "info");
      else check(`agent ${a.id}`, a.authenticated !== false, `${a.version} at ${a.binaryPath}; auth: ${a.authenticated === null ? "unknown" : a.authenticated ? "ok" : "NOT authenticated"}`, "warn");
    }
    check("at least one agent usable", agents.some((a) => a.installed && a.authenticated !== false), "install and log in to Claude Code, Codex or Command Code");
  }
  const failed = checks.filter((c) => !c.ok && c.level === "error");
  const out = { schema: SCHEMAS.doctor, healthy: failed.length === 0, checks, agents };
  const icon = { ok: "ok  ", error: "FAIL", warn: "warn", info: "info" };
  emit(ctx.json, out, checks.map((c) => `[${icon[c.level]}] ${c.name}: ${c.detail}`).join("\n"));
  return failed.length ? EXIT.failure : EXIT.ok;
}

const COMMANDS = {
  setup: cmdSetup,
  doctor: cmdDoctor,
  agents: cmdAgents,
  models: (ctx) => cmdModels(ctx),
  route: (ctx) => cmdRoute(ctx),
  explain: (ctx) => cmdRoute(ctx, { explain: true }),
  run: cmdRun,
  history: cmdHistory,
  outcome: cmdOutcome,
};

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    process.stderr.write(`smart-delegate: ${error.message}\nRun smart-delegate --help.\n`);
    return EXIT.usage;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return EXIT.ok;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return command || values.help ? EXIT.ok : EXIT.usage;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`smart-delegate: unknown command "${command}". Run smart-delegate --help.\n`);
    return EXIT.usage;
  }
  try {
    if (values["log-level"]) setLogLevel(values["log-level"]);
    const ctx = { values, positionals: rest, json: Boolean(values.json), cwd: resolve(values.cwd ?? process.cwd()), home: stateHome() };
    return await handler(ctx);
  } catch (error) {
    const usage = error.code === "SD_USAGE";
    log.error(error.message);
    if (!usage && process.env.SMART_DELEGATE_LOG === "debug") process.stderr.write(`${error.stack}\n`);
    if (values.json) {
      process.stdout.write(`${JSON.stringify({ schema: "smart-delegate.error.v1", error: error.message, code: error.code ?? "SD_ERROR" }, null, 2)}\n`);
    }
    return usage ? EXIT.usage : EXIT.failure;
  }
}
