# V2 roadmap: dynamic intelligence

V2 starts only on top of a stable V1 (see [V1-STATUS.md](V1-STATUS.md)). Each item below names the
V1 seam it builds on, so V2 extends the system instead of redesigning it.

## Agents

- **Direct Kimi Code adapter** (`kimi`) and **direct ZCode adapter** (`zcode`, resolved from PATH or
  from the desktop app bundle).
  - Seam: a new `src/adapters/<id>.mjs` plus a fake-agent format.
  - Verify the real help for flags, model aliases, permission modes, resume and structured output.
    Keep agent and model separate (ZCode → agent, GLM → model).
- **Direct vs. harness candidates.** `kimi/<model>` and `command-code/<kimi-model>` stay separate
  registry entries, and history already tracks each `candidateId` separately.

## Model data

- **Refresh.** Layered discovery: native CLI → provider metadata API → official source → cached
  registry.
  - Seam: `discoverModels()` per adapter and `saveUserEntries()`, which never clobbers curated
    entries.
  - Add `contextWindow`, `vision`, `pricing` and `deprecation` with `source` and `retrievedAt`.
    Never invent values.
- **Lifecycle.** `experimental → local eval → limited low-risk use → stable`, plus `degraded`,
  `deprecated`, `disabled` and `unavailable`.
  - Seam: `status` is already enforced by the router (`experimentalMaxRisk`).
  - Add promotion rules driven by local eval results.
- **Pricing refresh.** Fill `costPerTaskUsd` and per-token prices. The budget filters already
  consume `costPerTaskUsd`.
- **Benchmark ingestion.** Records carry source, benchmark, model, agent, metric, score, date,
  retrieval date and sample size.
  - Normalise the metric before it touches a capability.
  - Apply freshness decay: `effective = normalized × freshness(age)`.
  - Order of evidence: local results > independent benchmarks > provider claims.

## Learning

- **Richer local learning** by repository (`repoId` is already recorded), language, framework, task
  type and risk. Use the same Beta smoothing and `n/(n+K)` influence already in `ledger.mjs`,
  keyed by a richer context.
- **Cost per accepted task.** The total cost is implementation + retries + fallbacks + review +
  repair.
  - The ledger already records `estimatedCostUsd` per attempt and `runId`, so V2 aggregates per run.
- **Latency learning** from `durationMs`.

## Health

- **Circuit breaker:** `healthy → degraded → open → half-open → probe → healthy`.
  - V1 has the degraded step (`healthFactor`).
  - V2 adds the open and half-open states with a cooling period, persisted in `health.json`.
  - Health never edits quality scores.

## Review and multi-agent work

- **Dynamic reviewer selection** from review-specific history. V1 already picks an independent,
  read-only-capable reviewer on a different agent + model using review weights.
- **Multi-agent consultation**, only for high-stakes decisions:
  - security architecture;
  - zero-downtime migrations;
  - data-loss risk.
- **Parallel delegation** of independent sub-tasks, with non-overlapping file scopes. It relies on
  `outOfScope()` and scope checks per worker.
- **Optional git worktrees** for parallel or experimental runs. They are never mandatory.
- **Local evaluation suites** to promote experimental models.

## Explicitly V3 (not planned)

- team sync;
- cloud dashboard;
- organisation policies;
- CI and PR routing;
- remote worker fleets;
- contextual bandits.
