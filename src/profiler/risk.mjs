// Risk assessment from task text and repository reality.
// risk = 1 - Π(1 - w_i) over matched risk signals, so several independent
// signals compound without ever exceeding 1.

export const RISK_SIGNALS = [
  { name: "authentication", weight: 0.5, pattern: /\b(auth(?:entication|n)?|login|log-in|sign[- ]?in|oauth|sso|session tokens?|jwt|password|mot de passe|authentification)\b/i },
  { name: "authorization", weight: 0.45, pattern: /\b(authori[sz]ation|permissions?|rbac|acl|roles?|access control|privilege)\b/i },
  { name: "payments", weight: 0.55, pattern: /\b(payments?|billing|invoices?|stripe|checkout|subscriptions?|refunds?|credits?|paiements?|facturation)\b/i },
  { name: "security", weight: 0.55, pattern: /\b(security|secure|vulnerab\w*|xss|csrf|sql injection|injection|encrypt\w*|crypto\w*|secrets?|cve|sécurité)\b/i },
  { name: "database-migration", weight: 0.5, pattern: /\b(migrations?|schema change|alter table|drop (?:table|column)|backfill|database schema)\b/i },
  { name: "production", weight: 0.4, pattern: /\b(production|prod deploy\w*|deploy\w*|release|rollout|hotfix|live traffic)\b/i },
  { name: "concurrency", weight: 0.45, pattern: /\b(concurren\w*|race conditions?|deadlocks?|mutex|locking|thread[- ]safe\w*|atomic\w*|parallel writes?)\b/i },
  { name: "destructive", weight: 0.45, pattern: /\b(delete all|drop database|truncate|rm -rf|purge|wipe|destroy|irreversible|supprimer tout)\b/i },
  { name: "user-data", weight: 0.45, pattern: /\b(user data|personal data|pii|gdpr|rgpd|customer data|données personnelles)\b/i },
];

/** Repository areas that make a matching task riskier than its wording suggests. */
const AREA_TO_SIGNAL = [
  [/(^|\/)(auth|authentication|login|oauth|sessions?)(\/|$)/i, "authentication"],
  [/(^|\/)(migrations?|db\/migrate|schema)(\/|$)/i, "database-migration"],
  [/(^|\/)(payments?|billing|checkout|stripe|invoices?)(\/|$)/i, "payments"],
  [/(^|\/)(security|crypto|secrets?)(\/|$)/i, "security"],
  [/(^|\/)(deploy|infra|terraform|k8s|helm)(\/|$)/i, "production"],
];

/**
 * @param {string} text task description
 * @param {{ sensitiveAreas?: string[] }|null} repo repository profile
 * @param {{ mediumThreshold: number, highThreshold: number }} thresholds
 */
export function assessRisk(text, repo, thresholds) {
  const matched = RISK_SIGNALS.filter((s) => s.pattern.test(text));
  const reasons = matched.map((s) => `task mentions ${s.name}`);
  let factors = matched.map((s) => s.weight);

  // Repository reality: the task touches an area that exists and is sensitive.
  // e.g. "small auth change" in a repo that has auth/ and migrations/.
  const areaSignals = new Set();
  for (const area of repo?.sensitiveAreas ?? []) {
    for (const [pattern, signal] of AREA_TO_SIGNAL) {
      if (pattern.test(area)) areaSignals.add(signal);
    }
  }
  const matchedNames = new Set(matched.map((s) => s.name));
  for (const signal of areaSignals) {
    if (matchedNames.has(signal)) {
      factors.push(0.15);
      reasons.push(`repository has a ${signal} area the task touches`);
    }
  }
  if (matchedNames.has("authentication") && areaSignals.has("database-migration")) {
    factors.push(0.15);
    reasons.push("auth change in a repository with database migrations");
  }

  // Every write carries some risk; baseline keeps the score meaningful.
  factors = [0.1, ...factors];
  const score = 1 - factors.reduce((acc, w) => acc * (1 - w), 1);
  const level = score >= thresholds.highThreshold ? "high" : score >= thresholds.mediumThreshold ? "medium" : "low";
  return { score: Math.round(score * 1000) / 1000, level, signals: [...matchedNames], reasons };
}

export function riskLevelToScore(level, thresholds) {
  if (level === "high") return Math.max(thresholds.highThreshold, 0.8);
  if (level === "medium") return (thresholds.mediumThreshold + thresholds.highThreshold) / 2;
  return 0.15;
}
