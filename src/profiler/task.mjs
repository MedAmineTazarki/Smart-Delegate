// Task profiler: turns an engineering request into normalized dimensions.
// Heuristic by design (keywords + repository signals) and fully overridable:
// an orchestrating agent that understands the task better can pass explicit
// categories / risk / complexity, and those win.
import { SCHEMAS } from "../config/schema.mjs";
import { clamp01, round } from "../utils/misc.mjs";
import { assessRisk, riskLevelToScore } from "./risk.mjs";

export const CATEGORIES = [
  "architecture", "planning", "implementation", "feature", "bugfix", "debugging", "refactor",
  "migration", "tests", "review", "security", "performance", "research", "documentation", "ui",
  "vision", "large-context", "repository-analysis", "devops", "database", "infrastructure",
  "dependency-upgrade", "mechanical-edit",
];

const CATEGORY_PATTERNS = {
  architecture: /\b(architect\w*|system design|design (?:the|a|an) |high-level design|module boundaries|restructure|re-?design|conception)\b/i,
  planning: /\b(plan(?:ning)?|roadmap|break (?:it )?down|spec(?:ification)?|tickets?|estimate)\b/i,
  implementation: /\b(implement\w*|build|create|add|write|code|develop|impl[ée]mente\w*|ajoute\w*|cr[ée]e\w*)\b/i,
  feature: /\b(feature|endpoint|screen|page|functionality|capability|fonctionnalit[ée])\b/i,
  bugfix: /\b(fix\w*|bug\w*|broken|regression|crash\w*|corrige\w*|répare\w*)\b/i,
  debugging: /\b(debug\w*|diagnos\w*|investigate|root cause|why does|stack ?trace|flaky|intermittent)\b/i,
  refactor: /\b(refactor\w*|clean ?up|simplif\w*|extract|decouple|reorganiz\w*|rename (?:module|class))\b/i,
  migration: /\b(migrat\w*|port (?:to|from)|upgrade (?:from|to)|convert (?:to|from))\b/i,
  tests: /\b(tests?|unit tests?|test coverage|spec files?|e2e|integration tests?|testing)\b/i,
  review: /\b(review\w*|audit\w*|critique|second opinion|relis\w*)\b/i,
  security: /\b(security|vulnerab\w*|xss|csrf|injection|harden\w*|threat model|sécurité)\b/i,
  performance: /\b(perf(?:ormance)?|slow|latency|optimi[sz]\w*|memory leak|throughput|speed up)\b/i,
  research: /\b(research|compare|evaluate options|investigate options|survey|state of the art)\b/i,
  documentation: /\b(docs?|documentation|readme|changelog|comments?|docstrings?|jsdoc)\b/i,
  ui: /\b(ui|ux|css|layout|styling|component|frontend|front-end|responsive|interface)\b/i,
  vision: /\b(screenshot|image|mockup|figma|diagram|picture|visual(?:ly)?|capture d'écran)\b/i,
  "large-context": /\b(entire (?:repo|codebase|project)|whole (?:repo|codebase|project)|across (?:the )?(?:repo|codebase)|all files|large codebase|monorepo-wide)\b/i,
  "repository-analysis": /\b(analy[sz]e (?:the )?(?:repo|codebase|repository)|map (?:the )?codebase|understand (?:the )?codebase|codebase overview|explore the repo)\b/i,
  devops: /\b(ci|cd|pipeline|github actions|workflow|docker\w*|container|deploy\w*)\b/i,
  database: /\b(database|sql|query|queries|schema|index(?:es)?|postgres\w*|mysql|sqlite|mongo\w*|orm)\b/i,
  infrastructure: /\b(infra\w*|terraform|kubernetes|k8s|helm|cloud|aws|gcp|azure|provision\w*)\b/i,
  "dependency-upgrade": /\b(bump|upgrade (?:dependenc\w*|packages?|deps)|update (?:dependenc\w*|packages?|deps)|dependabot|renovate)\b/i,
  "mechanical-edit": /\b(rename|typo|reformat|format(?:ting)?|lint fix\w*|sort imports|search and replace|replace all|find and replace|boilerplate)\b/i,
};

// Base dimension vector contributed by each category.
const CATEGORY_DIMS = {
  architecture: { reasoning: 0.9, architecture: 0.95, coding: 0.3, complexity: 0.75 },
  planning: { reasoning: 0.8, architecture: 0.6, coding: 0.1, complexity: 0.5 },
  implementation: { coding: 0.9, reasoning: 0.5, complexity: 0.5 },
  feature: { coding: 0.9, reasoning: 0.55, complexity: 0.55 },
  bugfix: { coding: 0.8, reasoning: 0.6, debugging: 0.7, complexity: 0.45 },
  debugging: { coding: 0.6, reasoning: 0.8, debugging: 0.95, complexity: 0.6 },
  refactor: { coding: 0.85, reasoning: 0.6, architecture: 0.4, complexity: 0.55 },
  migration: { coding: 0.8, reasoning: 0.7, architecture: 0.4, complexity: 0.7 },
  tests: { coding: 0.8, reasoning: 0.4, complexity: 0.35 },
  review: { coding: 0.5, reasoning: 0.8, complexity: 0.45 },
  security: { coding: 0.6, reasoning: 0.85, complexity: 0.65 },
  performance: { coding: 0.7, reasoning: 0.8, debugging: 0.5, complexity: 0.6 },
  research: { reasoning: 0.8, coding: 0.1, complexity: 0.4 },
  documentation: { coding: 0.2, reasoning: 0.3, complexity: 0.2 },
  ui: { coding: 0.8, reasoning: 0.4, complexity: 0.45 },
  vision: { coding: 0.6, reasoning: 0.5, complexity: 0.45 },
  "large-context": { reasoning: 0.7, coding: 0.4, complexity: 0.65 },
  "repository-analysis": { reasoning: 0.75, coding: 0.2, complexity: 0.5 },
  devops: { coding: 0.6, reasoning: 0.5, complexity: 0.5 },
  database: { coding: 0.75, reasoning: 0.6, complexity: 0.55 },
  infrastructure: { coding: 0.5, reasoning: 0.7, complexity: 0.6 },
  "dependency-upgrade": { coding: 0.5, reasoning: 0.4, complexity: 0.35 },
  "mechanical-edit": { coding: 0.6, reasoning: 0.15, complexity: 0.12 },
};

const READ_ONLY_CATEGORIES = new Set(["review", "research", "repository-analysis", "planning"]);
const WRITE_CATEGORIES = new Set([
  "implementation", "feature", "bugfix", "refactor", "migration", "tests", "mechanical-edit", "documentation",
  "ui", "devops", "database", "infrastructure", "dependency-upgrade",
]);

const SIMPLER =/\b(simple|small|tiny|trivial|quick|minor|one[- ]line|single (?:file|function)|petit\w*|simple)\b/i;
const HARDER = /\b(complex|large|entire|whole|across|end[- ]to[- ]end|system-wide|major|multi-?(?:step|file|service)|from scratch|complet\w*|gros\w*)\b/i;
const URGENT = /\b(urgent|asap|quick(?:ly)?|hotfix|right now|immediately|vite)\b/i;
const CHEAP = /\b(cheap\w*|budget|cost[- ]effective|low[- ]cost|économique)\b/i;

/**
 * @param {string} text
 * @param {object} opts
 * @param {object|null} [opts.repo] repository profile
 * @param {object} opts.config merged config
 * @param {{categories?: string[], risk?: string|number, complexity?: number,
 *          files?: string[], images?: string[]}} [opts.overrides]
 */
export function profileTask(text, { repo = null, config, overrides = {} }) {
  const reasons = [];
  let categories;
  if (overrides.categories?.length) {
    const unknown = overrides.categories.filter((c) => !CATEGORIES.includes(c));
    if (unknown.length) throw Object.assign(new Error(`unknown task type(s): ${unknown.join(", ")} (known: ${CATEGORIES.join(", ")})`), { code: "SD_USAGE" });
    categories = [...overrides.categories];
    reasons.push("task type set explicitly");
  } else {
    categories = CATEGORIES.filter((c) => CATEGORY_PATTERNS[c].test(text));
    // "implementation" is matched by generic verbs (add, write, create); a more
    // specific category ("add tests", "write docs") says more about the task.
    if (categories.length > 1) categories = categories.filter((c) => c !== "implementation");
    // "fix a typo" is a mechanical edit, not a bug hunt.
    if (categories.includes("mechanical-edit")) categories = categories.filter((c) => c !== "bugfix");
    if (categories.length === 0) categories = ["implementation"];
  }
  if (overrides.images?.length && !categories.includes("vision")) categories.push("vision");

  // Dimensions: strongest contribution of any matched category.
  const dims = { coding: 0, reasoning: 0, architecture: 0, debugging: 0 };
  let complexity = 0;
  for (const c of categories) {
    const v = CATEGORY_DIMS[c];
    for (const key of Object.keys(dims)) dims[key] = Math.max(dims[key], v[key] ?? 0);
    complexity = Math.max(complexity, v.complexity ?? 0);
  }
  // Several categories at once is itself a sign of a broader task.
  complexity += Math.min(0.15, Math.max(0, categories.length - 2) * 0.05);
  if (SIMPLER.test(text)) {
    complexity -= 0.2;
    reasons.push("described as small/simple");
  }
  if (HARDER.test(text)) {
    complexity += 0.2;
    reasons.push("described as large/complex");
  }
  if (text.length > 1500) complexity += 0.1;

  // Repository reality.
  let contextRequirement = categories.some((c) => c === "large-context" || c === "repository-analysis") ? 0.8 : 0.35;
  const files = overrides.files ?? [];
  if (files.length > 10) {
    complexity += 0.15;
    contextRequirement += 0.15;
    reasons.push(`${files.length} files in scope`);
  }
  if (repo) {
    if (repo.fileCount > 5000) {
      complexity += 0.1;
      contextRequirement += 0.15;
      reasons.push(`large repository (${repo.fileCount} files)`);
    }
    if (repo.monorepo) {
      complexity += 0.05;
      reasons.push("monorepo");
    }
  }

  const thresholds = config.risk;
  const risk = assessRisk(text, repo, thresholds);
  if (overrides.risk !== undefined && overrides.risk !== null) {
    const r = typeof overrides.risk === "number" ? clamp01(overrides.risk) : riskLevelToScore(overrides.risk, thresholds);
    risk.score = r;
    risk.level = r >= thresholds.highThreshold ? "high" : r >= thresholds.mediumThreshold ? "medium" : "low";
    risk.reasons.unshift("risk set explicitly");
  }
  // Risky work is harder than it sounds.
  if (risk.level === "high") complexity += 0.1;

  if (overrides.complexity !== undefined && overrides.complexity !== null) {
    complexity = overrides.complexity;
    reasons.push("complexity set explicitly");
  }
  complexity = clamp01(complexity);
  contextRequirement = clamp01(contextRequirement);

  // Read-only when the task is about looking (review, research, analysis,
  // planning) and nothing in it asks for a change.
  const lookOnly = categories.some((c) => READ_ONLY_CATEGORIES.has(c));
  const writes = !lookOnly || categories.some((c) => WRITE_CATEGORIES.has(c));
  const qualityPriority = clamp01(0.5 + risk.score * 0.4 + complexity * 0.2);
  let costPriority = clamp01(0.55 - complexity * 0.3 + (CHEAP.test(text) ? 0.35 : 0));
  if (categories.includes("mechanical-edit") || categories.includes("documentation")) costPriority = clamp01(costPriority + 0.2);
  const latencyPriority = clamp01(URGENT.test(text) ? 0.8 : 0.4);

  // Hard requirement: the working set an agent must hold at once (base +
  // scope; a floor for repo-wide tasks). Agents explore with tools, so the
  // size of the whole repository is only a *preference* (desiredContextTokens,
  // used for scoring), never a hard filter — lockfiles and assets would
  // otherwise exclude every normal model.
  let requiredContextTokens = 20_000 + files.length * 4_000;
  let desiredContextTokens = requiredContextTokens;
  if (contextRequirement >= 0.8) {
    requiredContextTokens = Math.max(requiredContextTokens, 150_000);
    const repoTokens = repo?.sizeBytes ? Math.round(repo.sizeBytes / 4) : 150_000;
    desiredContextTokens = Math.max(requiredContextTokens, Math.min(repoTokens, 1_000_000));
  }

  // Primary type: the most specific category matched (first in priority order).
  const PRIORITY = ["security", "architecture", "migration", "debugging", "performance", "refactor", "review",
    "mechanical-edit", "bugfix", "tests", "documentation", "feature", "implementation"];
  const taskType = PRIORITY.find((c) => categories.includes(c)) ?? categories[0];

  return {
    schema: SCHEMAS.profile,
    taskType,
    categories,
    complexity: round(complexity, 3),
    risk: risk.score,
    riskLevel: risk.level,
    riskSignals: risk.signals,
    coding: round(dims.coding, 3),
    reasoning: round(dims.reasoning, 3),
    architecture: round(dims.architecture, 3),
    debugging: round(dims.debugging, 3),
    contextRequirement: round(contextRequirement, 3),
    requiredContextTokens,
    desiredContextTokens,
    visionRequirement: categories.includes("vision") ? 1 : 0,
    writeRequired: writes,
    verificationRequirement: round(clamp01(writes ? 0.5 + risk.score * 0.5 : 0.2), 3),
    qualityPriority: round(qualityPriority, 3),
    costPriority: round(costPriority, 3),
    latencyPriority: round(latencyPriority, 3),
    scopeFiles: files,
    reasons: [...reasons, ...risk.reasons],
  };
}
