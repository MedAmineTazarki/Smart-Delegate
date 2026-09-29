// Local performance ledger: append-only JSONL, one outcome per delegation
// attempt. It never contains source code, diffs, or brief text — only
// routing-relevant metadata. It never leaves the machine.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stateHome, statePaths } from "../config/config.mjs";
import { SCHEMAS, assertValid } from "../config/schema.mjs";
import { ensureDir } from "../utils/fs.mjs";
import { clamp01 } from "../utils/misc.mjs";

/** Append one outcome (validated). O_APPEND keeps concurrent writers line-atomic. */
export function appendOutcome(record, home = stateHome()) {
  const full = { schema: SCHEMAS.outcome, timestamp: new Date().toISOString(), ...record };
  assertValid("outcome", full, "outcome record");
  const path = statePaths(home).history;
  ensureDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(full)}\n`, { mode: 0o600 });
  return full;
}

/** Record the orchestrator's final accept/reject decision for a run. */
export function appendOutcomeUpdate(runId, fields, home = stateHome()) {
  const record = { schema: SCHEMAS.outcomeUpdate, timestamp: new Date().toISOString(), runId, ...fields };
  const path = statePaths(home).history;
  ensureDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return record;
}

/**
 * Read the ledger, applying outcome updates to the final attempt of their run.
 * Corrupt lines are skipped and counted, never fatal.
 */
export function readHistory(home = stateHome()) {
  const path = statePaths(home).history;
  if (!existsSync(path)) return { records: [], corruptLines: 0, path };
  const records = [];
  const updates = [];
  let corruptLines = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.schema === SCHEMAS.outcome) records.push(rec);
      else if (rec.schema === SCHEMAS.outcomeUpdate) updates.push(rec);
      else corruptLines += 1;
    } catch {
      corruptLines += 1;
    }
  }
  for (const update of updates) {
    const target = records.filter((r) => r.runId === update.runId).at(-1);
    if (!target) continue;
    if (typeof update.accepted === "boolean") {
      target.reviewPassed = update.accepted;
      target.success = target.success && update.accepted;
      target.status = update.accepted ? "accepted" : "rejected";
    }
  }
  return { records, corruptLines, path };
}

/** An attempt counts as a success for learning only when it was verified. */
function accepted(r) {
  return r.success === true && r.testsPassed !== false && r.reviewPassed !== false;
}

// Infrastructure/account failures say nothing about model quality.
const NOT_QUALITY = new Set(["TRANSIENT", "ENVIRONMENT", "POLICY"]);

/**
 * Only outcomes with a verdict teach the router: a quality-relevant failure,
 * or a success backed by independent evidence (gates passed or the
 * orchestrator accepted). "Worker exited 0" alone is a self-report.
 */
function hasVerdict(r) {
  if (NOT_QUALITY.has(r.failureClass)) return false;
  if (r.success === false) return true;
  return r.testsPassed === true || r.reviewPassed === true;
}

/**
 * Smoothed reliability for one candidate on one task type.
 * Beta prior centred on the registry reliability (strength = priorStrength),
 * blended with influence n / (n + K). Below minSamples: no adjustment.
 * Unverified runs and infrastructure failures are excluded (see hasVerdict).
 */
export function localReliability(entry, taskType, records, learning) {
  const base = entry.capabilities.reliability ?? 0.5;
  const relevant = records.filter((r) => r.candidateId === entry.id && r.taskType === taskType && hasVerdict(r));
  const n = relevant.length;
  const successes = relevant.filter(accepted).length;
  if (n < learning.minSamples) {
    return { reliability: base, n, successes, influence: 0, applied: false };
  }
  const alpha = base * learning.priorStrength;
  const beta = (1 - base) * learning.priorStrength;
  const posterior = (successes + alpha) / (n + alpha + beta);
  const influence = n / (n + learning.influenceK);
  let blended = (1 - influence) * base + influence * posterior;
  // Hard bound so a streak can never swing routing dramatically.
  blended = Math.min(base + learning.maxReliabilityShift, Math.max(base - learning.maxReliabilityShift, blended));
  return { reliability: clamp01(blended), n, successes, influence, posterior, applied: true };
}

/**
 * Short-term health of an agent+model from recent transient failures.
 * Separate from quality: it decays with the window and never edits the registry.
 */
export function healthFactor(entry, records, health, now = Date.now()) {
  const windowMs = health.windowMinutes * 60_000;
  const recent = records.filter(
    (r) => r.candidateId === entry.id && now - Date.parse(r.timestamp) <= windowMs,
  );
  const transient = recent.filter((r) => r.failureClass === "TRANSIENT").length;
  const recovered = recent.some((r) => r.success === true && r.timestamp > (recent.filter((x) => x.failureClass === "TRANSIENT").at(-1)?.timestamp ?? ""));
  if (transient >= health.transientFailuresToDegrade && !recovered) {
    return { factor: health.degradedFactor, state: "degraded", transient };
  }
  return { factor: 1, state: "healthy", transient };
}

/** Aggregate per agent+model for `history --stats`. */
export function aggregate(records) {
  const groups = new Map();
  for (const r of records) {
    const key = `${r.agent}|${r.model ?? "(default)"}|${r.taskType}`;
    const g = groups.get(key) ?? { agent: r.agent, model: r.model ?? null, taskType: r.taskType, attempts: 0, accepted: 0, transient: 0, durationMs: 0 };
    g.attempts += 1;
    if (accepted(r)) g.accepted += 1;
    if (r.failureClass === "TRANSIENT") g.transient += 1;
    g.durationMs += r.durationMs ?? 0;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    acceptRate: g.attempts ? Math.round((g.accepted / g.attempts) * 100) / 100 : null,
    avgDurationMs: g.attempts ? Math.round(g.durationMs / g.attempts) : null,
  }));
}
