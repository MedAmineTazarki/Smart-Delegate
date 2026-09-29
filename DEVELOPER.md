# Developer guide

## Layout and ownership

| Area | Owns | Must not |
| --- | --- | --- |
| `profiler/` | Turning text and repo metadata into a normalized profile | Load the codebase or call agents |
| `registry/` | Loading and merging registry layers | Contain routing preferences in code |
| `routing/` | Filters, floors, weights, selection, explanation | Name any agent or model (a test enforces this) |
| `adapters/` | CLI-specific argv, output parsing, exit-code meaning | Decide routing or touch git |
| `relay/` | Spawning, timeouts, process-group cleanup, failure classes | Use a shell |
| `git/` | Read-only git: baseline, attribution, diff | Run reset, clean, checkout, stash, commit or push (a test enforces this) |
| `verification/` | Gate discovery (structured sources only) and execution | Execute commands parsed from prose |
| `orchestrator/` | Sequencing the pipeline and writing artifacts | Hold CLI-specific or routing logic |
| `skills/` | Telling an orchestrating agent when and how to call the runtime | Duplicate runtime logic |

## Contracts (versioned)

| Schema | Where |
| --- | --- |
| `smart-delegate.config.v1` | Config layers (`config/schemas/config.schema.json`) |
| `smart-delegate.registry.v1` | Registry layers |
| `smart-delegate.route.v1` | `route` / `explain` output |
| `smart-delegate.result.v1` | One adapter attempt (`attempt-N/result.json`) |
| `smart-delegate.run.v1` | `run` output and `runs/<id>/run.json` |
| `smart-delegate.outcome.v1`, `smart-delegate.outcome-update.v1` | History lines |
| `smart-delegate.agents.v1`, `smart-delegate.doctor.v1`, `smart-delegate.error.v1` | Other CLI outputs |

A breaking change bumps the version. Readers must tolerate unknown fields. History readers skip
schemas they do not know.

## State

`~/.smart-delegate/` (or `$SMART_DELEGATE_HOME`) contains:

- `config.json`, `models.json` — mutated under a lock file (`.lock`), with atomic writes;
- `agents.json` — discovery cache written by `setup`;
- `history.jsonl` — append-only; corrupt lines are skipped and counted;
- `runs/<runId>/` — mode 0700. Holds `baseline.json`, `brief.md`, `attempt-N/`
  (`events.jsonl`, `stderr.txt`, `result.json`, CLI-specific files), `diff.patch`, `gate-N.*`,
  `review/` and `run.json`.

Routing never takes the lock.

## Tests

```bash
npm test                  # everything (~35 s)
npm run test:unit         # pure logic
npm run test:contract     # adapters vs fake CLIs
npm run test:integration  # git, relay, gates
npm run test:e2e          # the real CLI binary end to end
```

`fixtures/fake-agents/fake-*-agent.mjs` stand in for the vendor CLIs. They detect which CLI they
impersonate from the argv the real adapter builds, then answer in that CLI's output format. Behaviour
knobs are environment variables (see the header of `_core.mjs`).

Test repositories and state homes are created under the OS temp dir, with spaces in their names on
purpose.

## Live smoke test (costs a few cents)

```bash
mkdir "/tmp/sd live" && cd "/tmp/sd live" && git init -q && echo '{"type":"module","scripts":{"test":"node --test"}}' > package.json && git add -A && git commit -qm init
SMART_DELEGATE_HOME=/tmp/sd-live-home smart-delegate run "Add add(a,b) in src/math.js with a node:test test" --agent claude --model haiku --timeout 5m
```
