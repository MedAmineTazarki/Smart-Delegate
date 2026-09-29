// Data-driven router.
//
//   candidates (registry agent+model pairs)
//     -> hard filters (remove impossible candidates, with reasons)
//     -> quality floors (remove candidates too weak for this task)
//     -> weighted scoring (weights from config, never from model names)
//     -> primary + fallbacks + review policy + confidence
//
// Nothing in this file names an agent or a model. Changing the registry or
// the config is enough to change the outcome.
import { ADAPTERS } from "../adapters/index.mjs";
import { SCHEMAS } from "../config/schema.mjs";
import { healthFactor, localReliability } from "../history/ledger.mjs";
import { UNKNOWN_CAPABILITY } from "../registry/registry.mjs";
import { clamp01, round } from "../utils/misc.mjs";

export const MODES = ["auto", "quality", "balanced", "economy", "fast", "local-only"];
const QUALITY_DIMS = ["quality", "reasoning", "reliability"];
const BLOCKING_STATUSES = new Set(["disabled", "unavailable", "deprecated"]);

function cap(entry, dim) {
  const v = entry.capabilities[dim];
  return typeof v === "number" ? v : UNKNOWN_CAPABILITY;
}

/** Weights for this task + mode, normalized to sum to 1. */
export function resolveWeights(profile, mode, routing) {
  const profileName = routing.categoryProfile[profile.taskType] ?? "implementation";
  const weights = { ...routing.weightProfiles[profileName] };
  if (mode === "auto") {
    for (const dim of QUALITY_DIMS) if (dim in weights) weights[dim] *= 0.5 + profile.qualityPriority;
    if ("costEfficiency" in weights) weights.costEfficiency *= 0.5 + profile.costPriority;
    if ("speed" in weights) weights.speed *= 0.5 + profile.latencyPriority;
  } else {
    for (const [dim, m] of Object.entries(routing.modeMultipliers[mode] ?? {})) {
      weights[dim] = (weights[dim] ?? 0.05) * m;
    }
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  for (const dim of Object.keys(weights)) weights[dim] /= total;
  return { profileName, weights };
}

function taskFit(entry, profile, routing) {
  const values = profile.categories.map((c) => {
    if (typeof entry.taskFit[c] === "number") return entry.taskFit[c];
    const blend = routing.categoryDimensions[c] ?? { coding: 1 };
    const total = Object.values(blend).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(blend).reduce((acc, [dim, w]) => acc + cap(entry, dim) * w, 0) / total;
  });
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function contextFit(entry, profile) {
  if (!entry.contextWindow) return UNKNOWN_CAPABILITY;
  const ratio = entry.contextWindow / Math.max(profile.desiredContextTokens ?? profile.requiredContextTokens, 1);
  return clamp01(0.5 + 0.5 * Math.min(1, (ratio - 1) / 3));
}

function floorApplies(when, profile) {
  if (when.anyCategory && !when.anyCategory.some((c) => profile.categories.includes(c))) return false;
  if (when.maxComplexity !== undefined && profile.complexity > when.maxComplexity) return false;
  if (when.minComplexity !== undefined && profile.complexity < when.minComplexity) return false;
  if (when.minRisk !== undefined && profile.risk < when.minRisk) return false;
  return true;
}

/** Strictest requirement per dimension across all applicable floors. */
export function applicableFloors(profile, routing) {
  const required = {};
  const names = [];
  for (const floor of routing.qualityFloors) {
    if (!floorApplies(floor.when ?? {}, profile)) continue;
    names.push(floor.name);
    for (const [dim, min] of Object.entries(floor.require)) {
      if (!(dim in required) || min > required[dim].min) required[dim] = { min, floor: floor.name };
    }
  }
  return { required, names };
}

/**
 * @param {object} input
 * @param {object} input.profile task profile
 * @param {object} input.config merged config
 * @param {object[]} input.entries normalized registry entries
 * @param {object} input.discovery result of discoverAgents()
 * @param {object[]} [input.history] ledger records
 * @param {object} [input.request] mode, agent, model, excludeAgents, excludeProviders,
 *   noDelegate, maxCostTier, maxUsdPerTask, forceDelegate
 */
export function route({ profile, config, entries, discovery, history = [], request = {} }) {
  const routing = config.routing;
  const mode = request.mode ?? routing.defaultMode;
  if (!MODES.includes(mode)) throw Object.assign(new Error(`unknown mode "${mode}" (use ${MODES.join(", ")})`), { code: "SD_USAGE" });
  const override = request.agent || request.model ? { agent: request.agent ?? null, model: request.model ?? null } : null;
  const warnings = [];

  const base = {
    schema: SCHEMAS.route,
    mode,
    override,
    profile,
    primary: null,
    fallbacks: [],
    review: { required: false, by: "none", agent: null, model: null },
    confidence: 0,
    reasons: [],
    warnings,
    excluded: [],
    ranked: [],
  };

  if (request.noDelegate) {
    return { ...base, decision: "stay", reasons: ["user asked not to delegate"] };
  }

  // Candidate pool (manual override narrows it; unknown pairs become ad-hoc entries).
  let pool = entries;
  if (override) {
    pool = entries.filter(
      (e) => (!override.agent || e.agent === override.agent) && (!override.model || e.model === override.model),
    );
    if (pool.length === 0 && override.agent && override.model) {
      // Multi-model agents take "provider/model" (e.g. anthropic/claude-x).
      const multi = ADAPTERS.get(override.agent)?.capabilities.multiModel === true;
      const slash = override.model.indexOf("/");
      const provider = multi && slash > 0 ? override.model.slice(0, slash) : null;
      const model = provider ? override.model.slice(slash + 1) : override.model;
      pool = entries.filter((e) => e.agent === override.agent && e.model === model && (!provider || e.provider === provider));
    }
    if (pool.length === 0 && override.agent && override.model) {
      const multi = ADAPTERS.get(override.agent)?.capabilities.multiModel === true;
      const slash = override.model.indexOf("/");
      const provider = multi && slash > 0 ? override.model.slice(0, slash) : null;
      const model = provider ? override.model.slice(slash + 1) : override.model;
      pool = [{
        id: `${override.agent}/${override.model}`, agent: override.agent, model, provider,
        enabled: true, status: "stable", local: false, contextWindow: null, vision: null, costTier: null,
        costPerTaskUsd: null, source: "manual-override", confidence: 0.1, capabilities: {}, taskFit: {}, effort: null,
      }];
      warnings.push(`${override.agent}/${override.model} is not in the registry; routing it with unknown capabilities`);
    }
    if (pool.length === 0) {
      return { ...base, decision: "no-candidate", reasons: [`no registry entry matches the override ${JSON.stringify(override)}`] };
    }
  }

  const agentsById = new Map((discovery?.agents ?? []).map((a) => [a.id, a]));
  const excludeAgents = new Set([...(config.exclude?.agents ?? []), ...(request.excludeAgents ?? [])]);
  const excludeProviders = new Set([...(config.exclude?.providers ?? []), ...(request.excludeProviders ?? [])]);
  const maxCostTier = request.maxCostTier ?? config.budget?.maxCostTier ?? null;
  const maxUsd = request.maxUsdPerTask ?? config.budget?.maxUsdPerTask ?? null;
  const { required: floors, names: floorNames } = applicableFloors(profile, routing);

  const excluded = [];
  const eligible = [];
  for (const entry of pool) {
    const reject = (reason) => excluded.push({ id: entry.id, agent: entry.agent, model: entry.model, reason });
    const adapter = ADAPTERS.get(entry.agent);
    const agent = agentsById.get(entry.agent);
    if (!adapter) { reject("no adapter for this agent"); continue; }
    if (!agent?.installed) { reject("agent not installed"); continue; }
    if (agent.enabled === false) { reject("agent disabled in config"); continue; }
    if (excludeAgents.has(entry.agent) && !override) { reject("agent excluded"); continue; }
    if (entry.provider && excludeProviders.has(entry.provider)) { reject(`provider ${entry.provider} excluded`); continue; }
    if (!entry.enabled) { reject("model disabled"); continue; }
    if (BLOCKING_STATUSES.has(entry.status)) {
      if (!(override && entry.status === "deprecated")) { reject(`model status ${entry.status}`); continue; }
      warnings.push(`${entry.id} is deprecated; used only because it was requested explicitly`);
    }
    if (entry.status === "experimental" && !override && profile.risk > routing.experimentalMaxRisk) {
      reject(`experimental model not allowed at risk ${profile.risk}`); continue;
    }
    if (mode === "local-only" && !entry.local) { reject("not a local model (local-only mode)"); continue; }
    if (profile.visionRequirement > 0 && (entry.vision !== true || !adapter.capabilities.supportsImages)) {
      reject("task needs vision; candidate has none (or unknown)"); continue;
    }
    if (profile.writeRequired && !adapter.capabilities.supportsWrite) { reject("task needs write access"); continue; }
    if (entry.contextWindow && entry.contextWindow < profile.requiredContextTokens) {
      reject(`context window ${entry.contextWindow} < required ~${profile.requiredContextTokens}`); continue;
    }
    if (maxCostTier !== null && entry.costTier !== null && entry.costTier > maxCostTier) {
      reject(`cost tier ${entry.costTier} above budget tier ${maxCostTier}`); continue;
    }
    if (maxUsd !== null) {
      if (entry.costPerTaskUsd !== null && entry.costPerTaskUsd > maxUsd) { reject(`~$${entry.costPerTaskUsd}/task above budget $${maxUsd}`); continue; }
      if (entry.costPerTaskUsd === null && config.budget?.strict) { reject("cost unknown under strict budget"); continue; }
    }

    const learned = localReliability(entry, profile.taskType, history, config.learning);
    const effective = { ...entry, capabilities: { ...entry.capabilities, reliability: learned.reliability } };

    if (!override) {
      // A floor needs a real score: an unrated dimension is not "average".
      const unrated = Object.keys(floors).filter((dim) => typeof entry.capabilities[dim] !== "number");
      if (unrated.length) {
        reject(`unrated for this task (no ${unrated.join(", ")} score); rate it in models.json or request it with --agent/--model`);
        continue;
      }
      const failed = Object.entries(floors).find(([dim, { min }]) => cap(effective, dim) < min);
      if (failed) {
        const [dim, { min, floor }] = failed;
        reject(`below quality floor "${floor}": ${dim} ${round(cap(effective, dim), 2)} < ${min}`);
        continue;
      }
    }
    eligible.push({ entry: effective, learned, health: healthFactor(entry, history, config.health) });
  }

  const { profileName, weights } = resolveWeights(profile, mode, routing);
  const scored = eligible.map(({ entry, learned, health }) => {
    const values = {
      taskFit: taskFit(entry, profile, routing),
      contextFit: contextFit(entry, profile),
    };
    const breakdown = {};
    let total = 0;
    for (const [dim, weight] of Object.entries(weights)) {
      const value = dim in values ? values[dim] : cap(entry, dim);
      const points = 100 * weight * value;
      breakdown[dim] = { value: round(value, 3), weight: round(weight, 3), points: round(points, 2) };
      total += points;
    }
    const score = round(total * health.factor, 1);
    return {
      id: entry.id,
      agent: entry.agent,
      model: entry.model,
      provider: entry.provider,
      effort: entry.effort ?? config.agents?.[entry.agent]?.effort ?? null,
      score,
      costTier: entry.costTier,
      status: entry.status,
      source: entry.source,
      dataConfidence: entry.confidence,
      breakdown,
      learned: learned.applied
        ? { applied: true, n: learned.n, successes: learned.successes, reliability: round(learned.reliability, 3), influence: round(learned.influence, 3) }
        : { applied: false, n: learned.n },
      health,
      readOnlyCapable: ADAPTERS.get(entry.agent).capabilities.supportsReadOnly,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (mode === "economy") {
    // Cheapest candidate that cleared every floor; score breaks ties.
    scored.sort((a, b) => (a.costTier ?? 3) - (b.costTier ?? 3) || b.score - a.score);
  }

  const result = { ...base, excluded, ranked: scored, weights: { profile: profileName, values: roundAll(weights) }, floors: { applied: floorNames, required: floors } };
  if (scored.length === 0) {
    return {
      ...result,
      decision: "no-candidate",
      reasons: [excluded.length ? "every candidate was filtered out (see excluded)" : "no candidates in the registry"],
    };
  }

  const primary = scored[0];
  const rest = scored.slice(1);
  // Diversity: a fallback on another agent survives a provider/agent outage.
  const diverse = rest.find((c) => c.agent !== primary.agent);
  if (diverse && rest[0].agent === primary.agent && rest[0].score - diverse.score <= 10) {
    rest.splice(rest.indexOf(diverse), 1);
    rest.unshift(diverse);
  }
  const fallbacks = rest.slice(0, Math.max(0, routing.maxCandidates - 1));

  const review = reviewPlan({ primary, eligible, profile, config, weights: resolveWeights({ ...profile, taskType: "review" }, "balanced", routing).weights });
  if (review.warning) warnings.push(review.warning);

  let decision = "delegate";
  const reasons = describe(primary, scored, profile);
  if (!override && !request.forceDelegate && profile.complexity < routing.minComplexityToDelegate) {
    decision = "stay";
    reasons.unshift(`task looks trivial (complexity ${profile.complexity}); doing it inline is cheaper than delegating`);
  }

  return {
    ...result,
    decision,
    primary: pick(primary),
    fallbacks: fallbacks.map(pick),
    review: review.plan,
    confidence: confidence(primary, fallbacks[0] ?? rest[0], profile, request),
    reasons,
  };
}

function pick(c) {
  return { id: c.id, agent: c.agent, model: c.model, provider: c.provider, effort: c.effort, score: c.score };
}

function roundAll(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round(v, 3)]));
}

function reviewPlan({ primary, eligible, profile, config, weights }) {
  const by = config.review?.[profile.riskLevel] ?? "orchestrator";
  if (by !== "independent") {
    return { plan: { required: by !== "none", by, agent: null, model: null } };
  }
  // Independent reviewer: a different agent+model, read-only capable,
  // ranked by review-oriented weights. Prefer a different agent entirely.
  const options = eligible
    .filter(({ entry }) => entry.id !== primary.id && ADAPTERS.get(entry.agent).capabilities.supportsReadOnly)
    .map(({ entry }) => ({
      entry,
      score: Object.entries(weights).reduce((acc, [dim, w]) => acc + w * (dim === "taskFit" || dim === "contextFit" ? UNKNOWN_CAPABILITY : cap(entry, dim)), 0),
    }))
    .sort((a, b) => (a.entry.agent === primary.agent) - (b.entry.agent === primary.agent) || b.score - a.score);
  if (options.length === 0) {
    return {
      plan: { required: true, by: "orchestrator", agent: null, model: null },
      warning: "high risk wants an independent reviewer but no other read-only-capable candidate is available; the orchestrator must review",
    };
  }
  const r = options[0].entry;
  return { plan: { required: true, by: "independent", id: r.id, agent: r.agent, model: r.model, provider: r.provider ?? null, effort: r.effort ?? null } };
}

function confidence(primary, runnerUp, profile, request) {
  const gap = runnerUp ? primary.score - runnerUp.score : 10;
  const gapFactor = clamp01(gap / 10);
  const learnedBoost = primary.learned.applied ? primary.learned.influence : 0;
  const dataFactor = clamp01((primary.dataConfidence ?? 0.2) + learnedBoost);
  const profileFactor = request.categories?.length || request.agent ? 0.9 : 0.6;
  return round(0.35 * gapFactor + 0.35 * dataFactor + 0.3 * profileFactor, 2);
}

const DIM_LABEL = {
  coding: "coding", reasoning: "reasoning", reliability: "reliability", quality: "quality",
  architecture: "architecture", toolUse: "tool use", speed: "speed", costEfficiency: "cost efficiency",
  taskFit: "task fit", contextFit: "context fit",
};

function describe(primary, scored, profile) {
  const reasons = [`${profile.taskType} task (${profile.categories.join(", ")})`, `${profile.riskLevel} risk (${profile.risk})`];
  // Dimensions where the primary beats the field average by the most points.
  const avg = {};
  for (const dim of Object.keys(primary.breakdown)) {
    avg[dim] = scored.reduce((acc, c) => acc + c.breakdown[dim].points, 0) / scored.length;
  }
  const strengths = Object.entries(primary.breakdown)
    .map(([dim, b]) => [dim, b.points - avg[dim]])
    .filter(([, delta]) => delta > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [dim] of strengths) reasons.push(`strong ${DIM_LABEL[dim] ?? dim} for this task`);
  if (primary.breakdown.contextFit && primary.breakdown.contextFit.value >= UNKNOWN_CAPABILITY) reasons.push("required context supported");
  if (primary.learned.applied) reasons.push(`local history: ${primary.learned.successes}/${primary.learned.n} accepted`);
  if (primary.health.state !== "healthy") reasons.push(`health ${primary.health.state}`);
  if (scored.length === 1) reasons.push("only compatible candidate");
  return reasons;
}
