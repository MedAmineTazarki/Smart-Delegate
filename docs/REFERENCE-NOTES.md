# Reference research notes

These are the patterns taken from the two reference repositories and what Smart Delegate does with
each. No code was copied, and neither repository was cloned into this project. Both were read on
2026-09-29 through the GitHub API.

## mattpocock/skills (AIHero)

**What it is:** a library of small, composable `SKILL.md` files, such as `implement`, `code-review`,
`research`, `tdd`, `to-spec`, `to-tickets` and `wayfinder`. Several are orchestration skills that
call other skills rather than doing the work themselves.

Patterns kept:

- **Workflow orchestration ≠ implementation logic ≠ persistent runtime state.** The Smart Delegate
  skills only say *when* to call the runtime and *how* to read its result. Scoring, discovery,
  relay, verification and history live in `src/`. The router algorithm never appears in `SKILL.md`.
- **Concise skills.** The `description` is the trigger signal; the depth lives elsewhere. Our
  skills stay under a page, and the reference detail lives in the README and CONTRIBUTING.
- **Composition.** Smart Delegate slots into a pipeline such as `research → to-spec → to-tickets →
  smart-delegate (who executes each ticket) → code-review`. It answers one question, "who executes
  this, with which model, under which verification", and does not replace planning skills.
- **Context hygiene.** Durable facts (the registry, history, config) live in files, not in the
  conversation. The worker gets a bounded brief, not the orchestrator's context.
- **Code review along two axes.** The code-review skill checks both standards and spec. Our reviewer
  brief carries the original task, the diff, the independent gate results, and the worker's report
  labelled as a claim.

## amElnagdy/delegate-skills

**What it is:** a family of `<cli>-delegate` skills (Claude, Codex, Command Code, Kimi, ZCode and
others). Each wraps one implementer CLI through a `relay.mjs` and writes a stable `result.json`. A
`delegate-setup` utility discovers CLIs and records a static "fleet" of lanes.

Patterns kept:

- **Orchestrator → self-contained brief → implementer → real repo changes → independent
  verification → review → the orchestrator commits.** The implementer never self-approves and never
  commits.
- **Brief over stdin, never argv.** `spawn` takes argv arrays with no shell, and values are
  token-validated.
- **Artifacts outside the repository.** They go under `~/.smart-delegate/runs/`, so they never show
  up in `git status`.
- **Result contracts.** The result has a versioned schema, atomic writes, a terminal status, a
  session id for resume, and a stderr tail.
- **Process safety.** The child leads a process group. A watchdog sends SIGTERM, then SIGKILL, and
  the relay's own signals are forwarded.
- **Read-only tripwire.** The git state is compared before and after a read-only run. We reuse this
  idea for the independent reviewer.
- **Honest capability claims per CLI.** Examples:
  - Command Code's headless write mode is `--yolo`, which has no sandbox;
  - Codex's read-only mode is an OS sandbox;
  - Claude's read-only mode is tool withholding plus `plan`.
- **CLI-specific facts** that we then checked against the real help output:
  - Claude has no `--bare`, because bare mode skips OAuth and `CLAUDE.md`;
  - `CLAUDECODE` must be stripped for nested runs;
  - Codex needs `-s` before `resume`, and must never be spawned as `codex models`;
  - Command Code's result line can be truncated, so its session id comes from `run_start` and its
    report from `message_end`. Its exit codes 3, 5 and 10 mean auth, rate limit and credits.

What we deliberately do differently:

- **Static lanes → dynamic routing.** `delegate-setup` binds kinds of work to a CLI once. Smart
  Delegate scores every agent + model pair per task from registry data, config weights and local
  history. Model winners are never encoded anywhere.
- **One relay per CLI → one adapter contract.** Shared behaviour (spawn, timeout, cleanup,
  classification, result normalisation) lives once in `adapters/base.mjs` and `relay/`. Each
  adapter only builds argv and parses output.
- **Fallback with failure classes.** We add `TRANSIENT`, `CAPABILITY`, `QUALITY`, `ENVIRONMENT`,
  `POLICY` and `UNKNOWN`, with an explicit rule for when a different agent can help. We never fall
  back over a dirty tree.
- **Attribution, not just "touched files".** The baseline fingerprints user-dirty paths, so worker
  edits, user edits, touched-user-files and reverted-user-files are all distinguished.

## CLI verification record (2026-09-29)

| CLI | Version checked | How |
| --- | --- | --- |
| Claude Code | 2.1.283 help; 2.1.284 live runs | `claude --help`, `claude auth --help`. Live write run (haiku) and live read-only run |
| Codex | 0.159.0 | `npx @openai/codex@0.159.0 exec --help`, `exec resume --help`, `login --help` |
| Command Code | 1.69.0 | `npx command-code@1.69.0 --help` |
