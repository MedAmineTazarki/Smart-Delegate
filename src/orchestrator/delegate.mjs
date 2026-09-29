// End-to-end delegation pipeline.
//
//   profile + route -> git baseline -> brief -> attempt (primary, fallbacks)
//   -> attribute changes -> independent gates -> review -> ledger
//
// The worker never commits and never approves itself. Fallback only happens
// when a different agent/model could help AND the failed attempt left the
// tree exactly as it found it — we never "clean up" to make room.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAdapter } from "../adapters/index.mjs";
import { buildBrief, buildReviewBrief, parseVerdict, parseWorkerReport } from "../brief/brief.mjs";
import { loadConfig, stateHome, statePaths } from "../config/config.mjs";
import { SCHEMAS } from "../config/schema.mjs";
import { discoverAgents } from "../discovery/discovery.mjs";
import { captureBaseline, compareToBaseline, diffForPaths, outOfScope, repoId, repoRoot } from "../git/git.mjs";
import { appendOutcome, readHistory } from "../history/ledger.mjs";
import { profileRepo } from "../profiler/repo.mjs";
import { profileTask } from "../profiler/task.mjs";
import { FAILURE, fallbackCanHelp } from "../relay/failure.mjs";
import { loadRegistry } from "../registry/registry.mjs";
import { route } from "../routing/router.mjs";
import { discoverGates, runGates, summarizeGates } from "../verification/gates.mjs";
import { writeJsonAtomic } from "../utils/fs.mjs";
import { newRunId, parseDuration } from "../utils/misc.mjs";
import { log } from "../utils/log.mjs";

/**
 * Everything routing needs, gathered once.
 * @param {object} args
 * @param {string} args.task
 * @param {string} args.cwd
 * @param {object} [args.request] CLI/request options
 * @param {string} [args.home] state directory
 */
export function prepareRouting({ task, cwd, request = {}, home = stateHome() }) {
  const root = repoRoot(cwd);
  const { config, sources } = loadConfig({ repoRoot: root, home, overrides: request.configOverrides ?? null });
  const registry = loadRegistry({ repoRoot: root, home, registryPath: request.registryPath ?? null });
  const discovery = discoverAgents(config);
  const history = readHistory(home);
  if (history.corruptLines) log.warn(`history has ${history.corruptLines} unreadable line(s); they were skipped`);
  const repo = root ? profileRepo(root) : null;
  const profile = profileTask(task, {
    repo,
    config,
    overrides: {
      categories: request.categories,
      risk: request.risk,
      complexity: request.complexity,
      files: request.files,
      images: request.images,
    },
  });
  const decision = route({ profile, config, entries: registry.entries, discovery, history: history.records, request });
  return { root, repo, config, configSources: sources, registry, discovery, history, profile, route: decision };
}

function attemptOutcome({ runId, root, prep, candidate, attempt, result, fallbackUsed, fields }) {
  return {
    runId,
    repoId: root ? repoId(root) : null,
    taskType: prep.profile.taskType,
    categories: prep.profile.categories,
    riskLevel: prep.profile.riskLevel,
    mode: prep.route.mode,
    candidateId: candidate.id,
    agent: candidate.agent,
    model: candidate.model ?? null,
    routeScore: candidate.score ?? null,
    fallbackUsed,
    attempt,
    retryCount: attempt - 1,
    durationMs: result?.durationMs ?? null,
    estimatedCostUsd: result?.costUsd ?? null,
    ...fields,
  };
}

/**
 * Run a full delegation. Any unexpected error after the run started still
 * produces a run.json (status "error") describing what is in the tree.
 * @returns {Promise<object>} run summary (schema smart-delegate.run.v1)
 */
export async function runDelegation(args) {
  const holder = {};
  try {
    return await runPipeline(args, holder);
  } catch (error) {
    if (!holder.summary) throw error;
    holder.summary.error = error.message;
    if (holder.baseline && !holder.summary.changes) {
      try {
        const c = compareToBaseline(holder.baseline);
        holder.summary.changes = { workerChanges: c.workerChanges, userFilesTouched: c.userFilesTouched, userChangesReverted: c.userChangesReverted };
      } catch {
        // git itself failing; the error message above is all we have
      }
    }
    holder.summary.nextSteps.push("Internal error after the run started. Inspect the working tree before anything else; nothing was reverted.");
    log.error(`run ${holder.summary.runId} failed internally: ${error.message}`);
    return holder.finish("error");
  }
}

async function runPipeline({ task, cwd, request = {}, home = stateHome(), signal = { aborted: false } }, holder) {
  const prep = prepareRouting({ task, cwd, request, home });
  const { root, config, profile } = prep;
  const decision = prep.route;
  const runId = newRunId();
  const runDir = join(statePaths(home).runs, runId);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });

  const summary = {
    schema: SCHEMAS.run,
    runId,
    runDir,
    task: { taskType: profile.taskType, categories: profile.categories, riskLevel: profile.riskLevel },
    route: { decision: decision.decision, primary: decision.primary, fallbacks: decision.fallbacks, review: decision.review, confidence: decision.confidence, mode: decision.mode },
    status: null,
    attempts: [],
    changes: null,
    verification: null,
    review: null,
    warnings: [...decision.warnings],
    nextSteps: [],
  };
  const finish = (status) => {
    summary.status = status;
    writeJsonAtomic(join(runDir, "run.json"), summary);
    return summary;
  };
  holder.summary = summary;
  holder.finish = finish;

  if (!root) {
    summary.warnings.push("not a git repository: Smart Delegate refuses to delegate without a git baseline");
    return finish("refused");
  }
  if (decision.decision === "no-candidate") {
    summary.warnings.push(...decision.reasons);
    return finish("no-candidate");
  }
  if (decision.decision === "stay") {
    summary.nextSteps.push("Do the task inline, or re-run with --force-delegate / --agent to delegate anyway.");
    summary.warnings.push(...decision.reasons.slice(0, 1));
    return finish("not-delegated");
  }

  // 1. Baseline before anything touches the tree.
  const baseline = captureBaseline(root);
  holder.baseline = baseline;
  writeJsonAtomic(join(runDir, "baseline.json"), baseline);

  // 2. Gates and brief.
  const { gates, suggestions } = discoverGates(root, config, request.gates ?? []);
  const brief = buildBrief({
    task,
    profile,
    repo: prep.repo,
    root,
    context: request.context ?? "",
    requirements: request.requirements,
    constraints: request.constraints,
    acceptance: request.acceptance,
    gates,
    suggestedGates: suggestions,
    preexistingDirty: Object.keys(baseline.dirty),
  });
  writeFileSync(join(runDir, "brief.md"), brief.text, { mode: 0o600 });
  if (brief.redactions) summary.warnings.push(`${brief.redactions} secret-looking value(s) were redacted from the brief`);
  if (request.dryRun) {
    summary.brief = brief.text;
    summary.gates = gates;
    return finish("dry-run");
  }

  const timeoutMs = parseDuration(request.timeout ?? config.execution.timeout);
  const killGraceMs = config.execution.killGraceMs;

  let baselineGates = null;
  if (request.baselineGates && gates.length) {
    baselineGates = await runGates(root, gates, { timeoutMs: parseDuration(config.execution.gateTimeout), outDir: runDir });
    summary.baselineVerification = baselineGates;
  }

  // 3. Attempts: primary, then fallbacks while a fallback can help.
  const candidates = [decision.primary, ...decision.fallbacks].slice(0, config.routing.maxCandidates);
  let final = null;
  let finalCandidate = null;
  let comparison = null;
  for (const [i, candidate] of candidates.entries()) {
    if (signal.aborted) break;
    const attempt = i + 1;
    const adapter = getAdapter(candidate.agent);
    const agentInfo = prep.discovery.agents.find((a) => a.id === candidate.agent);
    log.info(`attempt ${attempt}: ${candidate.agent} / ${candidate.model ?? "(default model)"}`);
    const result = await adapter.run({
      binaryPath: agentInfo.binaryPath,
      cwd: root,
      brief: brief.text,
      model: candidate.model,
      provider: candidate.provider ?? null,
      agentConfig: config.agents?.[candidate.agent] ?? {},
      effort: candidate.effort ?? null,
      readOnly: false,
      outDir: join(runDir, `attempt-${attempt}`),
      timeoutMs,
      killGraceMs,
      images: request.images ?? [],
    });
    if (signal.aborted && result.status !== "completed") {
      result.status = "aborted";
      result.failure = { class: FAILURE.UNKNOWN, scope: "agent", reason: "aborted by user signal" };
    }
    writeJsonAtomic(join(runDir, `attempt-${attempt}`, "result.json"), result);
    comparison = compareToBaseline(baseline);
    const report = parseWorkerReport(result.finalMessage);
    summary.attempts.push({
      attempt,
      candidate,
      status: result.status,
      failure: result.failure,
      error: result.error,
      sessionId: result.sessionId,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      workerReport: report,
      changedFiles: comparison.workerChanges.length,
      artifacts: result.artifacts,
      notes: result.notes,
      policyViolation: result.policyViolation,
    });
    if (result.policyViolation === true) summary.warnings.push(`${candidate.agent} did not run under the requested safety policy: ${result.notes.at(-1)}`);
    final = result;
    finalCandidate = candidate;
    if (result.status === "completed") break;

    const clean = comparison.workerChanges.length === 0 && comparison.userWorkSafe && result.policyViolation !== true;
    const canFallback = fallbackCanHelp(result.failure) && clean && attempt < candidates.length && !signal.aborted;
    appendOutcome(attemptOutcome({
      runId, root, prep, candidate, attempt, result, fallbackUsed: attempt > 1,
      fields: { status: result.status, success: false, failureClass: result.failure?.class ?? FAILURE.UNKNOWN, testsPassed: null, reviewPassed: null, filesChanged: comparison.workerChanges.length },
    }), home);
    if (!canFallback) {
      if (fallbackCanHelp(result.failure) && !clean) {
        summary.warnings.push("fallback skipped: the failed attempt left changes in the working tree; inspect them before re-dispatching");
      }
      break;
    }
    log.warn(`attempt ${attempt} failed (${result.failure.class}: ${result.failure.reason}); falling back`);
  }

  // 4. Attribute changes.
  const workerPaths = comparison.workerChanges;
  const diff = diffForPaths(root, [...workerPaths, ...comparison.userFilesTouched.map((t) => ({ path: t.path, kind: t.kind }))]);
  writeFileSync(join(runDir, "diff.patch"), diff.patch, { mode: 0o600 });
  const outside = outOfScope([...workerPaths.map((c) => c.path), ...comparison.userFilesTouched.map((t) => t.path)], profile.scopeFiles);
  summary.changes = {
    workerChanges: workerPaths,
    userFilesTouched: comparison.userFilesTouched,
    userChangesReverted: comparison.userChangesReverted,
    userChangesPreserved: comparison.userChangesPreserved.length,
    outOfScope: outside,
    headChanged: comparison.headChanged,
    branchChanged: comparison.branchChanged,
    committedByWorker: comparison.committedByWorker,
    diffStat: diff.stat,
    diffPath: join(runDir, "diff.patch"),
  };
  if (comparison.headChanged) summary.warnings.push(`HEAD moved during delegation (${comparison.headBefore} -> ${comparison.headAfter}): the worker committed or switched history`);
  if (comparison.branchChanged) summary.warnings.push(`branch changed: ${comparison.branchBefore} -> ${comparison.branchAfter}`);
  if (comparison.userFilesTouched.length) summary.warnings.push(`the worker modified files you had already changed: ${comparison.userFilesTouched.map((t) => t.path).join(", ")}`);
  if (comparison.userChangesReverted.length) summary.warnings.push(`your pre-existing changes disappeared from: ${comparison.userChangesReverted.join(", ")}`);
  if (outside.length) summary.warnings.push(`changes outside the declared scope: ${outside.join(", ")}`);

  const fallbackUsed = summary.attempts.length > 1;
  const recordFinal = (fields) => appendOutcome(attemptOutcome({
    runId, root, prep, candidate: finalCandidate, attempt: summary.attempts.length, result: final, fallbackUsed,
    fields: { filesChanged: workerPaths.length, ...fields },
  }), home);

  if (signal.aborted) {
    summary.nextSteps.push("Aborted. Inspect the working tree before re-running; nothing was reverted.");
    return finish("aborted");
  }
  if (final.status !== "completed") {
    summary.nextSteps.push(`Inspect ${join(runDir, `attempt-${summary.attempts.length}`)} (stderr.txt, events.jsonl) and the working tree.`);
    return finish("failed");
  }

  const writeExpected = profile.writeRequired;
  const integrityProblem = comparison.headChanged || comparison.userChangesReverted.length > 0 || summary.attempts.some((a) => a.policyViolation === true);

  // 5. Independent verification.
  let verification = { ran: false, passed: null, results: [] };
  if (request.skipVerification) {
    summary.warnings.push("verification skipped by request; nothing is verified");
  } else if (gates.length) {
    verification = await runGates(root, gates, { timeoutMs: parseDuration(config.execution.gateTimeout), outDir: runDir });
  } else {
    summary.warnings.push("no verification gates found (configure verification.gates or pass --gate)");
  }
  summary.verification = { ...verification, suggestions, workerClaimedPass: summary.attempts.at(-1).workerReport.claimsTestsPass };
  if (signal.aborted) {
    // An interrupted gate is not the model's fault: record nothing against it.
    summary.nextSteps.push("Aborted during verification. The worker's changes are in the tree; re-run the gates yourself.");
    return finish("aborted");
  }
  if (baselineGates?.passed === false && verification.passed === false) {
    summary.warnings.push("gates were already failing before delegation (see baselineVerification)");
  }

  // 6. Review.
  const reviewBy = request.review ?? decision.review.by;
  let reviewPassed = null;
  if (workerPaths.length === 0 && writeExpected) {
    summary.review = { by: "none", verdict: null, note: "worker completed without changing any file" };
    recordFinal({ status: "no-changes", success: false, failureClass: FAILURE.QUALITY, testsPassed: verification.passed, reviewPassed: null });
    summary.nextSteps.push("The worker reported completion but changed nothing. Read its report before retrying.");
    return finish("no-changes");
  }
  if (reviewBy === "independent" && verification.passed !== false && !integrityProblem) {
    summary.review = await independentReview({ prep, task, runDir, root, diff, verification, workerReport: final.finalMessage, timeoutMs, killGraceMs, request });
    reviewPassed = summary.review.verdict === "APPROVE" ? true : summary.review.verdict === "REQUEST_CHANGES" ? false : null;
    if (summary.review.readOnlyViolation) summary.warnings.push("the reviewer changed files despite read-only mode; inspect the tree");
  } else {
    summary.review = { by: reviewBy, verdict: null };
  }

  // 7. Status.
  let status;
  let failureClass = null;
  if (integrityProblem) {
    status = "needs-attention";
    failureClass = FAILURE.POLICY;
  } else if (verification.passed === false) {
    status = "verification-failed";
    failureClass = FAILURE.QUALITY;
  } else if (reviewPassed === false) {
    status = "changes-requested";
    failureClass = FAILURE.QUALITY;
  } else if (verification.passed === true && (reviewBy === "none" || reviewPassed === true) && comparison.userFilesTouched.length === 0 && outside.length === 0) {
    status = "verified";
  } else {
    status = "pending-review";
  }
  const success = status === "verified" || status === "pending-review";
  recordFinal({ status, success, failureClass, testsPassed: verification.passed, reviewPassed });

  if (status === "verified") summary.nextSteps.push("Gates pass. Read the diff, then commit it yourself (the worker never commits).");
  if (status === "pending-review") summary.nextSteps.push(`Review ${summary.changes.diffPath}, then record the decision: smart-delegate outcome ${runId} --accept|--reject`);
  if (status === "verification-failed") summary.nextSteps.push(`Gates failed. Resume the worker with a delta brief or fix inline; session: ${final.sessionId ?? "n/a"}`);
  if (status === "changes-requested") summary.nextSteps.push("The independent reviewer requested changes; see review.findings.");
  if (status === "needs-attention") summary.nextSteps.push("Git integrity problem (HEAD moved or your changes vanished). Inspect before doing anything else.");
  return finish(status);
}

async function independentReview({ prep, task, runDir, root, diff, verification, workerReport, timeoutMs, killGraceMs }) {
  const plan = prep.route.review;
  if (!plan.agent) return { by: "orchestrator", verdict: null, note: "no independent reviewer available" };
  const adapter = getAdapter(plan.agent);
  const agentInfo = prep.discovery.agents.find((a) => a.id === plan.agent);
  const reviewBrief = buildReviewBrief({ task, profile: prep.profile, diffStat: diff.stat, diffPatch: diff.patch, gateSummary: summarizeGates(verification), workerReport });
  writeFileSync(join(runDir, "review-brief.md"), reviewBrief.text, { mode: 0o600 });
  const before = captureBaseline(root);
  const result = await adapter.run({
    binaryPath: agentInfo.binaryPath,
    cwd: root,
    brief: reviewBrief.text,
    model: plan.model,
    provider: plan.provider ?? null,
    agentConfig: prep.config.agents?.[plan.agent] ?? {},
    effort: plan.effort ?? null,
    readOnly: true,
    outDir: join(runDir, "review"),
    timeoutMs,
    killGraceMs,
  });
  writeJsonAtomic(join(runDir, "review", "result.json"), result);
  const after = compareToBaseline(before);
  const verdict = result.status === "completed" ? parseVerdict(result.finalMessage) : null;
  return {
    by: "independent",
    agent: plan.agent,
    model: plan.model,
    status: result.status,
    verdict,
    findings: result.finalMessage.slice(0, 4000),
    readOnlyViolation: after.workerChanges.length > 0 || after.userFilesTouched.length > 0 || result.policyViolation === true,
    error: result.error,
  };
}
