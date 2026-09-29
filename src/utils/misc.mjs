export const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export const round = (x, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Parse "90s", "30m", "2h", "1500ms" or a bare number of seconds into ms. */
export function parseDuration(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value * 1000;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(value).trim());
  if (!match) throw new Error(`invalid duration "${value}" (examples: 90s, 30m, 2h)`);
  const n = Number(match[1]);
  const unit = match[2] ?? "s";
  return Math.round(n * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit]);
}

/** Deep merge plain objects; arrays and scalars from `override` replace. */
export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
