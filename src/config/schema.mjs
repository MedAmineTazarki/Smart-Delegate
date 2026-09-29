// Schema identifiers for every persisted or emitted contract, plus a small
// JSON-Schema-subset validator (type, enum, const, required, properties,
// additionalProperties, items, minimum, maximum, minLength, pattern, anyOf).
// Kept dependency-free on purpose.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SCHEMAS = {
  config: "smart-delegate.config.v1",
  registry: "smart-delegate.registry.v1",
  agents: "smart-delegate.agents.v1",
  profile: "smart-delegate.profile.v1",
  route: "smart-delegate.route.v1",
  result: "smart-delegate.result.v1",
  run: "smart-delegate.run.v1",
  outcome: "smart-delegate.outcome.v1",
  outcomeUpdate: "smart-delegate.outcome-update.v1",
  doctor: "smart-delegate.doctor.v1",
};

const SCHEMA_DIR = fileURLToPath(new URL("../../config/schemas/", import.meta.url));
const cache = new Map();

/** Load one of the JSON Schemas shipped in config/schemas/. */
export function loadSchema(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(`${SCHEMA_DIR}${name}.schema.json`, "utf8")));
  return cache.get(name);
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some((t) => t === actual || (t === "number" && actual === "integer"));
}

/**
 * Validate `value` against `schema`.
 * @returns {string[]} human-readable errors; empty when valid
 */
export function validate(schema, value, path = "$") {
  const errors = [];
  if (schema.anyOf) {
    const ok = schema.anyOf.some((sub) => validate(sub, value, path).length === 0);
    if (!ok) errors.push(`${path}: does not match any allowed shape`);
    return errors;
  }
  if (schema.type && !typeMatches(schema.type, value)) {
    errors.push(`${path}: expected ${[].concat(schema.type).join("|")}, got ${typeOf(value)}`);
    return errors;
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(", ")}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: must match ${schema.pattern}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    }
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validate(sub, v, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${key}"`);
      else if (typeof schema.additionalProperties === "object") {
        errors.push(...validate(schema.additionalProperties, v, `${path}.${key}`));
      }
    }
  }
  return errors;
}

export function assertValid(schemaName, value, label = schemaName) {
  const errors = validate(loadSchema(schemaName), value);
  if (errors.length) {
    const error = new Error(`invalid ${label}:\n  ${errors.slice(0, 10).join("\n  ")}`);
    error.code = "SD_INVALID";
    throw error;
  }
  return value;
}
