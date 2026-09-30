import { createHash } from "node:crypto";
import { readJson, withLock, writeJsonAtomic } from "../utils/fs.mjs";
import { SCHEMAS } from "./schema.mjs";
import { statePaths } from "./config.mjs";

export const DEFAULT_DELEGATION = Object.freeze({
  lanes: [],
  defaultLane: null,
  concurrentAttempts: 3,
  attemptLimitMinutes: 120,
  correctionLimit: 1,
});

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const CATEGORIES = new Set([
  "implementation", "feature", "bugfix", "debugging", "refactor", "tests",
  "review", "security", "performance", "research", "documentation",
  "ui", "vision", "large-context", "repository-analysis", "devops",
  "database", "infrastructure", "dependency-upgrade", "mechanical-edit",
  "architecture", "planning", "migration",
]);

export function normalizeDelegation(value = {}) {
  return { ...DEFAULT_DELEGATION, ...value, lanes: value.lanes ?? [] };
}

export function validateDelegation(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["delegation must be an object"];
  const allowed = new Set(Object.keys(DEFAULT_DELEGATION));
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`unknown delegation field: ${key}`);
  const settings = normalizeDelegation(value);
  if (!Array.isArray(settings.lanes) || settings.lanes.length > 32) errors.push("lanes must contain at most 32 entries");
  const ids = new Set();
  for (const [index, lane] of (Array.isArray(settings.lanes) ? settings.lanes : []).entries()) {
    const at = `lanes[${index}]`;
    if (!lane || typeof lane !== "object" || Array.isArray(lane)) { errors.push(`${at} must be an object`); continue; }
    for (const key of Object.keys(lane)) if (!["id", "name", "responsibility", "categories", "agent", "provider", "model", "reasoningEffort", "enabled"].includes(key)) errors.push(`${at}.${key} is unknown`);
    if (typeof lane.id !== "string" || !ID.test(lane.id)) errors.push(`${at}.id must be a lowercase slug`);
    if (ids.has(lane.id)) errors.push(`${at}.id is duplicated`);
    ids.add(lane.id);
    if (typeof lane.name !== "string" || !lane.name.trim() || lane.name.length > 80) errors.push(`${at}.name must be 1–80 characters`);
    if (typeof lane.responsibility !== "string" || lane.responsibility.length > 500) errors.push(`${at}.responsibility must be at most 500 characters`);
    if (!Array.isArray(lane.categories) || lane.categories.some((c) => !CATEGORIES.has(c)) || new Set(lane.categories).size !== lane.categories.length) errors.push(`${at}.categories are invalid`);
    if (typeof lane.agent !== "string" || !TOKEN.test(lane.agent)) errors.push(`${at}.agent is invalid`);
    if (lane.provider !== null && (typeof lane.provider !== "string" || !ID.test(lane.provider))) errors.push(`${at}.provider is invalid`);
    if (lane.model !== null && (typeof lane.model !== "string" || !TOKEN.test(lane.model))) errors.push(`${at}.model is invalid`);
    if (lane.agent === "deepseek-harness" && (!lane.provider || !lane.model)) errors.push(`${at} needs a provider and model`);
    if (lane.reasoningEffort !== null && (typeof lane.reasoningEffort !== "string" || !TOKEN.test(lane.reasoningEffort))) errors.push(`${at}.reasoningEffort is invalid`);
    if (typeof lane.enabled !== "boolean") errors.push(`${at}.enabled must be boolean`);
  }
  if (settings.defaultLane !== null && (!ids.has(settings.defaultLane) || !settings.lanes.find((l) => l.id === settings.defaultLane)?.enabled)) errors.push("defaultLane must name an enabled lane");
  if (!Number.isInteger(settings.concurrentAttempts) || settings.concurrentAttempts < 1 || settings.concurrentAttempts > 10) errors.push("concurrentAttempts must be 1–10");
  if (typeof settings.attemptLimitMinutes !== "number" || !Number.isFinite(settings.attemptLimitMinutes) || settings.attemptLimitMinutes < 1 || settings.attemptLimitMinutes > 480) errors.push("attemptLimitMinutes must be 1–480");
  if (!Number.isInteger(settings.correctionLimit) || settings.correctionLimit < 0 || settings.correctionLimit > 4) errors.push("correctionLimit must be 0–4");
  return errors;
}

const revisionOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function delegationSnapshot(home) {
  const read = readJson(statePaths(home).config);
  if (!read.ok && !read.missing) throw new Error(`global config is unreadable: ${read.error}`);
  const document = read.ok ? read.value : { schema: SCHEMAS.config };
  return { delegation: normalizeDelegation(document.delegation), revision: revisionOf(document) };
}

export function saveDelegation(value, revision, home) {
  const errors = validateDelegation(value);
  if (errors.length) throw Object.assign(new Error(errors.join("; ")), { status: 400 });
  const paths = statePaths(home);
  return withLock(paths.lock, () => {
    const read = readJson(paths.config);
    if (!read.ok && !read.missing) throw Object.assign(new Error(`global config is unreadable: ${read.error}`), { status: 409 });
    const document = read.ok ? read.value : { schema: SCHEMAS.config };
    if (revision !== revisionOf(document)) throw Object.assign(new Error("Settings changed elsewhere. Reload and try again."), { status: 409 });
    const next = { ...document, delegation: normalizeDelegation(value) };
    writeJsonAtomic(paths.config, next);
    return { delegation: next.delegation, revision: revisionOf(next) };
  });
}

export function chooseLane(delegation, profile, requestedId = null) {
  const settings = normalizeDelegation(delegation);
  const enabled = settings.lanes.filter((lane) => lane.enabled);
  if (!enabled.length) return requestedId ? { error: `Lane ${requestedId} is not enabled.` } : { lane: null };
  if (requestedId) {
    const lane = enabled.find((item) => item.id === requestedId);
    return lane ? { lane } : { error: `Lane ${requestedId} is not enabled.` };
  }
  const scored = enabled.map((lane) => ({ lane, score: lane.categories.filter((c) => profile.categories.includes(c)).length }));
  const top = Math.max(...scored.map((item) => item.score));
  const matches = scored.filter((item) => item.score === top && top > 0);
  if (matches.length === 1) return { lane: matches[0].lane };
  const fallback = enabled.find((lane) => lane.id === settings.defaultLane);
  if (fallback) return { lane: fallback };
  if (enabled.length === 1) return { lane: enabled[0] };
  return { error: "Several lanes are enabled. Choose a lane or set a default lane." };
}
