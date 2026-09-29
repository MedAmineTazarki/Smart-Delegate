# V1 status

**V1 status: STABLE**, with one open Definition-of-Done item: a live end-to-end run through Codex and
through Command Code. Both need the user to install the CLI and log in (`codex login`, `cmd login`).

Assessed on 2026-09-29, macOS (Darwin 25.6), Node 26.7, git 2.54.

## Evidence

- `npm test`: **124 tests, 124 pass**, across unit, contract, integration and e2e, at the V1
  release. The suite has since grown to 172 with the pi-ai integration (see PI-AI-INTEGRATION.md).
- **Live runs against Claude Code 2.1.284:**
  - A write run (`--agent claude --model haiku`) in a throwaway repo:
    - the worker created 2 files;
    - the user's untracked `NOTES.txt` was preserved;
    - HEAD was unchanged, so nothing was committed;
    - `npm test` was re-run independently and passed;
    - the session id, the actual model (`claude-haiku-4-5-20251001`) and the cost ($0.058) were
      parsed;
    - the outcome was written to the ledger.
  - A read-only run asked to create a file: nothing was written, and the verdict was parsed.
- Codex (0.159.0) and Command Code (1.69.0) adapters:
  - every flag was checked against the real `--help`;
  - the full contract suite passes against fake binaries that emit their output formats;
  - the **argv was accepted by the real CLI parsers** in write, read-only, resume and model+effort
    modes. Both CLIs were installed in a scratch directory with an isolated `HOME` and no login.
    - Codex reached the API: 401 was classified ENVIRONMENT, and the real `thread.started` /
      `thread_id` events were parsed.
    - Command Code exited 3: not authenticated, classified ENVIRONMENT. An unknown model was
      classified CAPABILITY.

## Definition of Done

| Item | Status |
| --- | --- |
| Claude Code adapter works | ✅ live-verified (write + read-only) |
| Codex adapter works | ✅ real parser accepts argv; ⏳ live run needs `codex login` |
| Command Code adapter works | ✅ real parser accepts argv; ⏳ live run needs `cmd login` |
| Agent discovery | ✅ |
| Task / repo / risk profiling | ✅ (heuristic, overridable) |
| Capability filtering before scoring | ✅ |
| Dynamic scoring, no model ids in routing branches | ✅ enforced by a source-audit test |
| Routing modes, manual overrides | ✅ |
| Fallbacks | ✅ e2e: a simulated 429 on the primary falls back and succeeds |
| Self-contained, sanitized briefs | ✅ |
| Subprocess robustness, timeout, cleanup | ✅ grandchild reaping and SIGTERM-ignoring children tested |
| Git baseline, user changes untouched, worker changes identifiable | ✅ 10 git scenarios |
| Independent verification | ✅ worker claims "pass", gate fails → `verification-failed` |
| Basic review | ✅ independent read-only reviewer on a different agent for high risk; orchestrator review for medium risk |
| History recorded, explain output, JSON output | ✅ |
| Registry change alone changes the selected model | ✅ unit test, plus e2e with two CLI invocations |

## Stabilization review

**Shell injection.**
- There is no `shell: true` anywhere, and every process is spawned from an argv array.
- The brief only goes over stdin.
- Model and effort values are token-validated.
- A test proves `$(...)` and backticks in arguments are inert.

**Git safety.**
- The source-audit test proves no `reset`, `clean`, `checkout`, `stash`, `commit` or `push` calls
  exist.
- Fallback is refused when a failed attempt left changes, and that is covered by an e2e test.

**Subprocess cleanup.**
- Fixed a real bug that the e2e run surfaced: a grandchild ignoring SIGTERM survived a timeout
  because the pipe `close` event cancelled the pending SIGKILL.
- Group reaping is now awaited before a result is returned.

**Secrets.**
- Briefs, reviewer briefs and logs are redacted.
- History stores metadata only, and a test checks this.

**Config and state corruption.**
- Corrupt or invalid config and registry files are errors, never silently ignored.
- `setup` and `models --save` refuse to overwrite corrupt files.
- Corrupt history lines are skipped and counted.
- Fixed a real bug: `models --save` wrote `provider: null`, which the schema rejected. That would have
  broken all routing on the next call.

**Found in the final review and fixed, with regression tests:**
- The large-context hard filter used total repository bytes, so a 2.5 MB lockfile excluded every
  200k-context model and returned `no-candidate`. Repository size now only lowers `contextFit`.
- Learning counted unverified "worker exited 0" runs as successes. Only runs with a verdict (gates
  passed, orchestrator accept, or a quality failure) now count.
- The failure classifier read `claude-501` in a temp path as an HTTP 5xx. HTTP codes are now only
  trusted next to `status` / `HTTP` / `error`.
- An internal error after the worker ran now still writes `run.json` (status `error`).
- A Ctrl+C during the gates is recorded as aborted, not as a quality failure.

**Simplification.**
- There is one adapter contract with shared `run()`, one relay layer, and no dependencies.

## Known limitations

1. Codex and Command Code have not completed a live task, because no account is logged in here. The
   parsing of Codex's JSONL events (thread id, usage, errors) follows observed formats and is treated
   as optional: the final message comes from the documented `-o` file. Command Code's stream
   handling follows the verified notes from delegate-skills.
2. Registry scores are hand-set seed priors (`source: manual-seed`), not measurements. Tune them in
   `~/.smart-delegate/models.json`; local history then adjusts reliability conservatively.
3. The task profiler is keyword-based (English, with some French). Example: "add function X and a
   test" is classified as `tests`. Orchestrators should pass `--type`, `--risk` and `--files` when
   they know better.
4. `--gate` splits on whitespace and has no quoting. Use `verification.gates[].argv` in config for
   complex commands.
5. Gates execute the repository's own scripts (for example `npm test`), which is arbitrary repo
   code. That is inherent to verification.
6. Run artifacts (`diff.patch`, raw agent events) are stored locally unsanitized, in mode 0700
   directories. Only briefs, logs and history are sanitized.
7. Claude's commit/push deny rules are speed bumps. Command Code's write mode (`--yolo`) has no
   sandbox at all. The boundary is the brief plus independent review, not the OS.
8. Concurrent edits by someone else during a run cannot be told apart from worker edits.
9. Cost is known only when the CLI reports it (Claude does). There is no pricing data, so
   `--budget-usd` only filters entries with `costPerTaskUsd`.
10. Health has only one state change, `healthy → degraded`. There is no open or half-open circuit
    breaker.
11. Gitignored paths (`.env`, build output) are invisible to the git baseline and attribution. A
    worker edit there is not reported.
12. macOS is tested. Linux should work but was not run here: Claude's sandbox needs its Linux
    dependencies, and fails closed. Windows is not supported.

## Deferred to V2

See [V2-ROADMAP.md](V2-ROADMAP.md):

- direct Kimi Code and ZCode adapters;
- model, pricing and benchmark refresh with freshness decay;
- lifecycle promotion through local evals;
- repo, language and task learning;
- cost per accepted task;
- full circuit breaker;
- dynamic reviewer learning;
- multi-agent consultation;
- parallel delegation and worktrees.

**Decision: stopped after stable V1**, following spec §88. The V2 agents (Kimi Code, ZCode) are not
installed here, and no benchmark or pricing sources are configured. Starting V2 now would produce
unverifiable, half-finished code on top of a working V1.
