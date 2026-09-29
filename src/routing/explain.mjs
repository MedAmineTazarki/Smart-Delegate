// Human-readable routing explanation (`smart-delegate explain`), localized.
import { ADAPTERS } from "../adapters/index.mjs";
import { label, t, tr } from "../i18n/index.mjs";

export function candidateLabel(c) {
  // Multi-model agents show provider/model so the pair is unambiguous.
  const multi = ADAPTERS.get(c.agent)?.capabilities.multiModel && c.provider;
  return `${c.agent} / ${c.model ? (multi ? `${c.provider}/${c.model}` : c.model) : t("explain.defaultModel")}`;
}

/** Compare a runner-up to the primary: where it wins and loses, in points. */
function comparison(candidate, primary) {
  const pros = [];
  const cons = [];
  for (const [dim, b] of Object.entries(candidate.breakdown)) {
    const delta = b.points - (primary.breakdown[dim]?.points ?? 0);
    if (Math.abs(delta) < 0.3) continue;
    (delta > 0 ? pros : cons).push([dim, delta]);
  }
  pros.sort((a, b) => b[1] - a[1]);
  cons.sort((a, b) => a[1] - b[1]);
  return {
    pros: pros.slice(0, 2).map(([d, v]) => t("explain.better", { dim: label("dim", d), pts: v.toFixed(1) })),
    cons: cons.slice(0, 2).map(([d, v]) => t("explain.weaker", { dim: label("dim", d), pts: v.toFixed(1) })),
  };
}

export function explainRoute(route) {
  const out = [];
  const p = route.profile;
  out.push(t("explain.task", { type: p.taskType, categories: p.categories.join(", "), complexity: p.complexity, level: label("level", p.riskLevel), risk: p.risk, mode: route.mode }));
  if (p.reasons.length) out.push(t("explain.signals", { signals: p.reasons.map((r) => tr(r)).join("; ") }));
  if (route.weights) {
    const w = Object.entries(route.weights.values).sort((a, b) => b[1] - a[1]).map(([d, v]) => `${label("dim", d)} ${Math.round(v * 100)}%`);
    out.push(t("explain.weights", { profile: route.weights.profile, weights: w.join(", ") }));
  }
  if (route.floors?.applied?.length) {
    const req = Object.entries(route.floors.required).map(([d, r]) => `${label("dim", d)} >= ${r.min}`);
    out.push(t("explain.floors", { names: route.floors.applied.join(", "), required: req.join(", ") }));
  }
  out.push("");

  if (route.decision === "no-candidate") {
    out.push(t("explain.noCandidate"));
    for (const r of route.reasons) out.push(`  ${tr(r)}`);
  } else {
    const primary = route.ranked.find((c) => c.id === route.primary.id);
    out.push(route.decision === "stay" ? t("explain.wouldSelect") : t("explain.selected"));
    out.push(t("explain.scoreLine", { candidate: candidateLabel(primary), score: primary.score, confidence: route.confidence }));
    out.push("");
    out.push(t("explain.why"));
    for (const r of route.reasons) out.push(`  + ${tr(r)}`);
    if (route.fallbacks.length) {
      out.push("");
      out.push(t("explain.fallbacks", { list: route.fallbacks.map((f) => `${candidateLabel(f)} (${f.score})`).join(", ") }));
    }
    out.push("");
    out.push(t("explain.review", { by: label("review", route.review.by), target: route.review.agent ? ` -> ${candidateLabel(route.review)}` : "" }));
    const others = route.ranked.filter((c) => c.id !== primary.id);
    if (others.length) {
      out.push("");
      out.push(t("explain.notSelected"));
      for (const c of others) {
        const { pros, cons } = comparison(c, primary);
        out.push(`  ${candidateLabel(c)}  score ${c.score}`);
        for (const line of [...pros, ...cons]) out.push(`    ${line}`);
      }
    }
  }
  if (route.excluded.length) {
    out.push("");
    out.push(t("explain.filtered"));
    for (const e of route.excluded) out.push(`  ${candidateLabel(e)}: ${tr(e.reason)}`);
  }
  if (route.warnings.length) {
    out.push("");
    for (const w of route.warnings) out.push(t("explain.warning", { text: tr(w) }));
  }
  return out.join("\n");
}
