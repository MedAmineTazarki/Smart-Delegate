// Failure classification decides whether a fallback can help.
//   TRANSIENT   rate limit, 5xx, network, overload, watchdog timeout
//   CAPABILITY  context too large, unsupported model/feature
//   QUALITY     the work was done but does not verify (gates/review fail)
//   ENVIRONMENT missing binary, unauthenticated CLI (scope "agent"), or the
//               repository/toolchain itself is broken (scope "repo")
//   POLICY      provider refused, permission denied, out of credits
//   UNKNOWN     anything else (malformed output, unexplained exit)

export const FAILURE = Object.freeze({
  TRANSIENT: "TRANSIENT",
  CAPABILITY: "CAPABILITY",
  QUALITY: "QUALITY",
  ENVIRONMENT: "ENVIRONMENT",
  POLICY: "POLICY",
  UNKNOWN: "UNKNOWN",
});

// Bare numbers are only trusted next to an HTTP context word: "claude-501"
// in a temp path must not read as a 5xx.
const HTTP = String.raw`(?:status(?: code)?|http(?:\/[\d.]+)?|error|code)\s*[:=]?\s*`;

const PATTERNS = [
  [FAILURE.TRANSIENT, "agent", new RegExp(String.raw`${HTTP}(?:429|5\d\d)\b|rate.?limit|too many requests|overloaded|internal server error|bad gateway|gateway time-?out|server error|service unavailable|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network (?:error|failure)|socket hang up|temporarily unavailable`, "i")],
  [FAILURE.CAPABILITY, "agent", /context (?:length|window)|too many tokens|maximum context|prompt is too long|input too large|model .*not (?:supported|found|available)|unknown model|invalid model|unsupported (?:model|effort)/i],
  [FAILURE.POLICY, "agent", new RegExp(String.raw`insufficient (?:credits|quota|balance)|quota exceeded|billing|permission denied|access denied|forbidden|${HTTP}403\b|content policy|usage policy|refused`, "i")],
  [FAILURE.ENVIRONMENT, "agent", new RegExp(String.raw`NO_ADAPTER|MISSING_CREDENTIAL|provider is not configured|no adapter registered|not (?:logged in|authenticated)|unauthori[sz]ed|${HTTP}401\b|login required|please (?:log ?in|run .*login)|invalid api key`, "i")],
];

/**
 * @param {object} input
 * @param {string} [input.status] adapter-level status
 * @param {boolean} [input.timedOut]
 * @param {string|null} [input.spawnError]
 * @param {string} [input.text] error text: stderr tail + adapter error message
 * @param {string|null} [input.hint] adapter-specific class hint (e.g. from an exit-code table)
 * @returns {{ class: string, scope: "agent"|"repo", reason: string }}
 */
export function classifyFailure({ status, timedOut = false, spawnError = null, text = "", hint = null }) {
  if (hint) return { class: hint.class, scope: hint.scope ?? "agent", reason: hint.reason };
  if (spawnError || status === "unavailable") {
    return { class: FAILURE.ENVIRONMENT, scope: "agent", reason: `agent could not start: ${spawnError ?? "binary unavailable"}` };
  }
  if (timedOut) return { class: FAILURE.TRANSIENT, scope: "agent", reason: "watchdog timeout" };
  for (const [cls, scope, pattern] of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { class: cls, scope, reason: `matched "${match[0]}"` };
  }
  if (status === "malformed") return { class: FAILURE.UNKNOWN, scope: "agent", reason: "unparseable agent output" };
  return { class: FAILURE.UNKNOWN, scope: "agent", reason: "unexplained failure" };
}

/**
 * Only fall back when a different agent/model could plausibly succeed.
 * QUALITY needs repair, not a different vendor; repo-scoped ENVIRONMENT
 * problems follow the task to every agent; UNKNOWN is not retried blindly.
 */
export function fallbackCanHelp(failure) {
  switch (failure.class) {
    case FAILURE.TRANSIENT:
    case FAILURE.CAPABILITY:
    case FAILURE.POLICY:
      return true;
    case FAILURE.ENVIRONMENT:
      return failure.scope === "agent";
    default:
      return false;
  }
}
