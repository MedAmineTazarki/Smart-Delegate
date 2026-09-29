// Human-readable routing explanation (`smart-delegate explain`).

const LABEL = {
  coding: "coding", reasoning: "reasoning", reliability: "reliability", quality: "quality",
  architecture: "architecture", toolUse: "tool use", speed: "latency", costEfficiency: "cost",
  taskFit: "task fit", contextFit: "context fit",
};

export function candidateLabel(c) {
  return `${c.agent} / ${c.model ?? "(agent default model)"}`;
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
    pros: pros.slice(0, 2).map(([d, v]) => `+ better ${LABEL[d] ?? d} (+${v.toFixed(1)} pts)`),
    cons: cons.slice(0, 2).map(([d, v]) => `- weaker ${LABEL[d] ?? d} (${v.toFixed(1)} pts)`),
  };
}

export function explainRoute(route) {
  const out = [];
  const p = route.profile;
  out.push(`Task: ${p.taskType} [${p.categories.join(", ")}]  complexity ${p.complexity}  risk ${p.riskLevel} (${p.risk})  mode ${route.mode}`);
  if (p.reasons.length) out.push(`Profile signals: ${p.reasons.join("; ")}`);
  if (route.weights) {
    const w = Object.entries(route.weights.values).sort((a, b) => b[1] - a[1]).map(([d, v]) => `${LABEL[d] ?? d} ${Math.round(v * 100)}%`);
    out.push(`Weights (${route.weights.profile}): ${w.join(", ")}`);
  }
  if (route.floors?.applied?.length) {
    const req = Object.entries(route.floors.required).map(([d, r]) => `${d} >= ${r.min}`);
    out.push(`Quality floors (${route.floors.applied.join(", ")}): ${req.join(", ")}`);
  }
  out.push("");

  if (route.decision === "no-candidate") {
    out.push("No compatible candidate.");
    for (const r of route.reasons) out.push(`  ${r}`);
  } else {
    const primary = route.ranked.find((c) => c.id === route.primary.id);
    out.push(`${route.decision === "stay" ? "Would select (but recommends staying inline)" : "Selected"}:`);
    out.push(`  ${candidateLabel(primary)}  score ${primary.score}  confidence ${route.confidence}`);
    out.push("");
    out.push("Why:");
    for (const r of route.reasons) out.push(`  + ${r}`);
    if (route.fallbacks.length) {
      out.push("");
      out.push(`Fallbacks: ${route.fallbacks.map((f) => `${candidateLabel(f)} (${f.score})`).join(", ")}`);
    }
    out.push("");
    out.push(`Review: ${route.review.by}${route.review.agent ? ` -> ${candidateLabel(route.review)}` : ""}`);
    const others = route.ranked.filter((c) => c.id !== primary.id);
    if (others.length) {
      out.push("");
      out.push("Not selected:");
      for (const c of others) {
        const { pros, cons } = comparison(c, primary);
        out.push(`  ${candidateLabel(c)}  score ${c.score}`);
        for (const line of [...pros, ...cons]) out.push(`    ${line}`);
      }
    }
  }
  if (route.excluded.length) {
    out.push("");
    out.push("Filtered out:");
    for (const e of route.excluded) out.push(`  ${candidateLabel(e)}: ${e.reason}`);
  }
  if (route.warnings.length) {
    out.push("");
    for (const w of route.warnings) out.push(`Warning: ${w}`);
  }
  return out.join("\n");
}
