# Smart Delegate

Smart Delegate is a data-driven router and safe delegation runtime for coding agents.

Give it an engineering task. It decides:

- whether the task is worth delegating at all;
- which **agent** (Claude Code, OpenAI Codex, Command Code, ...) should run it;
- which **model** that agent should use;
- which fallbacks to prepare;
- whether an independent reviewer is needed.

It then runs the worker with a self-contained brief, checks the real diff against a git baseline, and
re-runs the project's own gates. It records the outcome locally so future routing improves.

```text
task -> profile -> discover agents -> registry -> hard filters -> scoring -> primary + fallbacks
     -> brief -> worker -> git attribution -> independent gates -> review -> ledger
```

## Why it exists

Model rankings change every few weeks, so hard-coding "architecture → model X" goes stale.
Smart Delegate keeps every judgement about agents and models in **data**:

- a registry of agent + model pairs;
- config weights;
- local history.

The router itself never names a model. Edit `models.json` and routing changes, with no code change.
There is a test for exactly that.

Agent and model are different things. `{ "agent": "codex", "model": null }` and
`{ "agent": "command-code", "model": "vendor/kimi-..." }` are separate candidates. The ledger tracks
performance per agent + model pair.

## Installation

Requires Node.js 20+ and git. There are no npm dependencies.

```bash
git clone <this repo> smart-delegate && cd smart-delegate
npm link                    # puts `smart-delegate` on PATH (or run node bin/smart-delegate.mjs)
smart-delegate setup        # creates ~/.smart-delegate and discovers agents
smart-delegate doctor
```

To use it from an agent, install the skills in `skills/` (for example, copy them to `~/.claude/skills/`).

## Supported agents

| Agent | Binary | Write mode | Read-only mode | Resume | Status |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude` | `acceptEdits` + Claude shell sandbox + commit/push deny rules | `plan` mode, Read/Glob/Grep only | `--resume` | **live-verified** (2.1.284: write run, read-only run) |
| OpenAI Codex | `codex` | `-s workspace-write` (OS sandbox) | `-s read-only` (OS sandbox) | `exec resume <id>` | flags verified against `codex exec --help` 0.159.0; argv accepted by the real parser; **live task not yet run** |
| Command Code | `command-code` / `commandcode` / `cmd` | `--yolo` (**no sandbox**) | `--permission-mode plan`, write tools withheld | `--resume` | flags verified against `cmd --help` 1.69.0; argv accepted by the real parser; **live task not yet run** |
| DeepSeek Harness | `dsh` (`--profile headless --json`) | harness `workspace-write` sandbox + `approval never`, verified in the composed config before each run and in the session log after | harness `read-only` sandbox | `--session-id` | **real-binary verified** (0.2.0-rc.2) against a scripted mock model: write, sandboxed bash, read-only refusal; live provider run pending credentials |
| Embedded pi-ai agent (`pi-agent`) | `node` + `src/pi-agent/agent.mjs`, pi-ai located from the dsh install | file tools realpath-confined to the repo (never `.git`/`.env*`); `bash` only inside `sandbox-exec` (macOS) or `bwrap` (Linux), with no network by default; no sandbox means no bash | no write, edit or shell tools | none | **real pi-ai verified** against a scripted mock (write, sandboxed bash, blocked escape); env API keys only; Linux `bwrap` unverified |

DeepSeek Harness reaches providers through the same library the harness uses, `pi-ai`
(`@earendil-works/pi-ai`, through `@deepseek-ai/dsh-llm-pi-ai`). Registry entries for it carry the
pi-ai route in `provider` and the model id in `model`. Examples:

- `{ "agent": "deepseek-harness", "provider": "anthropic", "model": "claude-sonnet-4-5" }`
- `{ "agent": "deepseek-harness", "provider": "openai-codex", "model": "gpt-5.5" }`

Credentials come from the harness: `$DSH_HOME` stored sign-ins (made on the dsh Models page,
where pi-ai offers Claude Pro/Max and ChatGPT/Codex OAuth; whether a consumer subscription may be
used outside its vendor's own client depends on that vendor's terms, which were not checked here) or
provider environment variables. Smart Delegate
never reads them. Per run, Smart Delegate:

- turns off the harness's DeepSeek session-log upload and OTel;
- turns off the harness's web tools (`web_fetch`, `web_search`), so the model has no network channel.
  A real run confirms the model is no longer offered them;
- confines writes to the repository;
- sets approvals to `never`, so anything that would need a human is refused.

A live run with a mock model and a logging proxy made no outbound connection at all. The run uses
your real `~/.dsh` (or `agents.deepseek-harness.home`); the first run creates its `headless` profile
there.

The embedded `pi-agent` is Smart Delegate's own minimal agent loop on the same `pi-ai` library. It
is useful for providers with an API key when you don't want the whole harness. Select it with
`--agent pi-agent --model <provider>/<model>`, for example `--model zai/glm-4.7`. For local or
self-hosted OpenAI-compatible servers, add `agents.pi-agent.customProviders`.

Command Code is a harness. It can run many models (Kimi, GLM, Qwen, MiniMax, DeepSeek...), and each
one it reports becomes its own candidate. Kimi Code and ZCode direct adapters are planned for V2
(see [docs/V2-ROADMAP.md](docs/V2-ROADMAP.md)).

## Quick start

```bash
smart-delegate route   "Add rate limiting to the /login endpoint"      # decision only
smart-delegate explain "Add rate limiting to the /login endpoint"      # why
smart-delegate run     "Add rate limiting to the /login endpoint" --files src/auth --gate "npm test"
smart-delegate outcome <runId> --accept                                # your review decision
smart-delegate history --stats
```

`run` exits after the worker finishes and verification completes. Its `status` is one of:

| Status | Meaning |
| --- | --- |
| `verified` | Gates pass and any required review passed. Read the diff, then commit it yourself. |
| `pending-review` | Your review is needed. Record the decision with `outcome`. |
| `verification-failed`, `changes-requested` | The gates or the reviewer rejected the work. |
| `failed` | The worker failed. Fallbacks were already tried when a different agent could help. |
| `needs-attention` | HEAD moved or your uncommitted changes vanished. |
| `not-delegated`, `no-candidate`, `refused`, `dry-run` | Nothing ran. |

Everything supports `--json`. stdout then carries exactly one JSON document (versioned schemas such as
`smart-delegate.route.v1` and `smart-delegate.run.v1`), and diagnostics go to stderr.

## Routing modes

| Mode | Behaviour |
| --- | --- |
| `auto` (default) | Weights follow the task's quality, cost and latency priorities. |
| `quality` | Boosts quality, reasoning and reliability. |
| `balanced` | Uses the task-type weight profile as-is. |
| `economy` | Picks the cheapest candidate that clears every quality floor. It never picks "cheapest, period". |
| `fast` | Boosts latency. Quality floors still apply. |
| `local-only` | Only uses registry entries marked `"local": true`. |

Hard filters run before scoring, and they **remove** candidates:

- agent not installed or disabled;
- excluded agent or provider;
- model disabled, deprecated or unavailable;
- experimental model on risky work;
- vision needed but missing or unknown;
- context window too small;
- over the hard budget;
- below a quality floor.

## Manual overrides

| Intent | Flag |
| --- | --- |
| "Use Codex" | `--agent codex` |
| "Use this model" | `--model <id>` (with `--agent` for a pair not in the registry) |
| "Don't delegate" | `--no-delegate` |
| "Delegate anyway" | `--force-delegate` |
| "Cheapest compatible" | `--mode economy` |
| "Maximum quality" | `--mode quality` |
| "Not provider X" | `--exclude-provider X` |
| "Not agent X" | `--exclude-agent X` |
| Hard budget | `--max-cost-tier 1-5`, `--budget-usd N` |
| Better task profile | `--type feature,tests`, `--risk high`, `--complexity 0.7`, `--files a,b` |

An override bypasses quality floors, because you asked for it. It never bypasses "agent not installed".

## Configuration

Later layers win:

1. `config/defaults.json`
2. `~/.smart-delegate/config.json`
3. `<repo>/.smart-delegate/config.json`
4. CLI flags

The registry has its own layers, merged by entry id: `config/capabilities.json` <
`~/.smart-delegate/models.json` < `<repo>/.smart-delegate/models.json` < `--registry <file>`.

The shipped registry scores are **hand-set seed priors** (`"source": "manual-seed"`, low confidence),
not benchmarks. Model ids are limited to values verified against each CLI's help. Claude uses its
documented aliases. Codex and Command Code use the agent's configured default (`model: null`) until
`smart-delegate models --discover --save` imports the real ids they report. Imported ids start as
`experimental`. An entry with no score for a dimension that a quality floor checks counts as
**unrated**. Unrated entries are never picked automatically, in any mode; you can still select them
explicitly.

### Model catalog (pi-ai)

`smart-delegate models --catalog` reads the `pi-ai` catalog installed with DeepSeek Harness, or the
one pointed to by `SMART_DELEGATE_PI_AI_DIR`. It shows each provider, its model count, and which
API-key variables are set. It reports names only and never reads values; stored dsh sign-ins are
not inspected. `--provider anthropic,zai --save` then:

- adds `deepseek-harness/<provider>/<model>` candidates with catalog **facts** (context window,
  image input, cost tier from the output price, with source `pi-ai@<version>`), marked
  `experimental` and unrated, so they run only when requested until you rate them;
- refreshes facts on existing entries whose real model id is known. For Claude Code aliases, that
  id comes from a model a run has actually reported, never from a guess.

The import never overwrites a field you set yourself, and never imports quality scores.

Useful project config:

```json
{
  "schema": "smart-delegate.config.v1",
  "verification": { "gates": [{ "name": "test", "argv": ["./gradlew", "test"] }] },
  "exclude": { "providers": ["some-provider"] },
  "review": { "medium": "independent" }
}
```

## Safety model

- **Git baseline.** Before any work, Smart Delegate records HEAD, the branch, and every dirty path
  with a content fingerprint. It reports each of these separately:
  - worker changes;
  - user files the worker touched;
  - user changes that disappeared;
  - HEAD moves;
  - out-of-scope edits.
- **No destructive git.** It never runs `reset`, `clean`, `checkout`, `stash`, `commit` or `push`.
- **Workers don't commit.** They are told not to, and Claude additionally gets deny rules. You commit
  after reviewing.
- **Fallback only when it can help, and only on a clean tree.** Transient, capability, policy and
  agent-environment failures fall back. Quality failures and unknown failures don't. An attempt that
  left changes stops the run instead of being cleaned up.
- **Verification is independent.** Gates come from structured sources:
  - `package.json` scripts, the Gradle wrapper, Makefile, Cargo or Go;
  - config;
  - `--gate`.

  Commands mentioned in README or AGENTS.md prose are shown as suggestions and never executed.
  Gates run the repository's own scripts. Treat that exactly like running the tests yourself.
- **No shell.** Every process is spawned from an argv array. Briefs go over stdin, never argv. Model
  ids and effort values are token-validated.
- **Process cleanup.** Each worker leads its own process group. On timeout it gets SIGTERM, then
  SIGKILL after a grace period, and leftover group members are reaped even after a normal exit.
- **Secrets.** Briefs, reviewer briefs and logs are sanitized. Values are removed and names are kept
  (`STRIPE_API_KEY=<redacted>`).
- **Prompt injection.** Repository excerpts in the brief are labelled as untrusted and cannot widen
  scope or lift forbidden actions.

## Privacy and history

Nothing is uploaded and there is no telemetry.

`~/.smart-delegate/history.jsonl` stores routing metadata only: task type, agent, model, scores,
outcome, duration and cost. It never stores source, briefs or diffs.

Per-run artifacts live in `~/.smart-delegate/runs/<runId>/` with mode 0700:

- brief;
- diff;
- raw agent events;
- stderr.

Delete old runs whenever you like.

Learning is deliberately conservative:

- below 3 samples, the registry score is used unchanged;
- above that, a Beta-smoothed success rate blends in with influence n/(n+20), capped at ±0.10
  reliability;
- transient outages are tracked as short-term health, never as quality.

## Troubleshooting

- `smart-delegate doctor` checks Node, git, config and registry validity, history, and each agent's
  version and authentication.
- `no-candidate`: run `smart-delegate explain "<task>"`. The **Filtered out** section gives the
  reason for each excluded candidate.
- Nested Claude Code: the adapter removes the inherited `CLAUDECODE` variable so `claude -p` can run
  from inside a Claude Code session.
- `SMART_DELEGATE_HOME` relocates all state. `SMART_DELEGATE_LOG=debug` enables verbose logs.
- `SMART_DELEGATE_{CLAUDE,CODEX,COMMAND_CODE}_BIN`, or `agents.<id>.binary` in config, pins a binary.

## Architecture overview

```text
bin/smart-delegate.mjs      CLI entry
src/cli.mjs                 commands, --json contract, exit codes
src/profiler/               task.mjs (categories, dimensions), risk.mjs, repo.mjs (metadata only)
src/registry/registry.mjs   layered agent+model registry (data)
src/routing/router.mjs      filters -> floors -> weighted scoring -> primary/fallbacks/review
src/routing/explain.mjs     human explanation
src/adapters/               base.mjs (contract + generic run), claude/codex/command-code.mjs
src/relay/                  process.mjs (spawn, timeout, cleanup), failure.mjs (classification)
src/brief/                  brief.mjs (self-contained briefs), sanitize.mjs (secrets)
src/git/git.mjs             baseline, attribution, diff (read-only git)
src/verification/gates.mjs  gate discovery and independent execution
src/history/ledger.mjs      JSONL outcomes, smoothing, health
src/orchestrator/delegate.mjs  the end-to-end pipeline
config/                     defaults.json, capabilities.json, schemas/*.schema.json
fixtures/fake-agents/       fake CLIs speaking each real CLI's output format
skills/                     smart-delegate, smart-delegate-setup, smart-delegate-doctor
```

## Adding an adapter

See [CONTRIBUTING.md](CONTRIBUTING.md#new-agent-adapter). In short:

1. Verify the CLI's real help output.
2. Write `src/adapters/<id>.mjs` with `defineAdapter()`.
3. Register it in `src/adapters/index.mjs`.
4. Teach the fake agent its output format.

The contract test suite then runs against it automatically.

## Status

V1 is stable. See [docs/V1-STATUS.md](docs/V1-STATUS.md) for what is verified, the known limitations,
and what moves to V2.

The DeepSeek Harness / pi-ai integration came after V1:

- the `deepseek-harness` agent;
- `models --catalog`;
- the embedded `pi-agent`.

See [docs/PI-AI-INTEGRATION.md](docs/PI-AI-INTEGRATION.md). The test suite has 172 tests, plus
real-binary integration tests that run when `dsh` is available.
