// Secret redaction for anything that leaves the orchestrator: briefs, logs,
// history. Redaction keeps the *name* of a secret (useful context) and drops
// its *value* ("STRIPE_API_KEY=<redacted>").

const REDACTED = "<redacted>";

// Variable names whose values are secrets.
const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIALS?|COOKIE|SESSION[_-]?ID|AUTH)[A-Za-z0-9_.-]*`;

/** [pattern, replacer] pairs, applied in order. */
const RULES = [
  // PEM private keys (whole block).
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, () => `<redacted private key>`],
  // NAME=value / NAME: value / "name": "value" for secret-looking names.
  [
    new RegExp(String.raw`(\b${SECRET_NAME}\b["']?\s*[:=]\s*)(["']?)([^\s"'` + "`" + String.raw`,;]{4,})(\2)`, "gi"),
    (_m, head, q, _value, q2) => `${head}${q}${REDACTED}${q2}`,
  ],
  // HTTP auth headers and cookies.
  [/\b(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s"']+/gi, (_m, head) => `${head}${REDACTED}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, (_m, head) => `${head}${REDACTED}`],
  [/\b((?:Set-)?Cookie\s*:\s*)[^\r\n]+/gi, (_m, head) => `${head}${REDACTED}`],
  // Credentials embedded in URLs.
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi, (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`],
  // Well-known token shapes.
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, () => REDACTED], // Stripe
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, () => REDACTED], // OpenAI / Anthropic style
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, () => REDACTED], // GitHub
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, () => REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, () => REDACTED], // GitLab
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, () => REDACTED], // Slack
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, () => REDACTED], // AWS access key id
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, () => REDACTED], // Google API key
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, () => REDACTED], // JWT
];

/**
 * Redact secrets from text.
 * @param {string} text
 * @returns {{ text: string, redactions: number }}
 */
export function sanitize(text) {
  if (typeof text !== "string" || text.length === 0) return { text: text ?? "", redactions: 0 };
  let redactions = 0;
  let out = text;
  for (const [pattern, replacer] of RULES) {
    out = out.replace(pattern, (...args) => {
      redactions += 1;
      return replacer(...args);
    });
  }
  return { text: out, redactions };
}

/** Convenience: sanitized string only. */
export function redact(text) {
  return sanitize(text).text;
}
