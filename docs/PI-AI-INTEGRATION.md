# Using DeepSeek Harness's provider library (pi-ai)

DeepSeek Harness connects to model providers through `@earendil-works/pi-ai`, via its
`@deepseek-ai/dsh-llm-pi-ai` package. Smart Delegate uses that same library in three ways. None of
them adds a dependency: pi-ai is located from the harness installation (npm or pnpm layout) or from
`SMART_DELEGATE_PI_AI_DIR`.

| Part | What | Credentials | Verified |
| --- | --- | --- | --- |
| 1. `deepseek-harness` agent | Runs `dsh --profile headless --json` with the provider and model set per run | dsh stored sign-ins or env keys, all resolved by dsh (subscription OAuth outside the vendor's client: check the vendor's terms) | Real dsh 0.2.0-rc.2 with a scripted mock model: write, sandboxed bash, read-only refusal, policy recorded in the session log, web tools absent from the tools the model is offered, no outbound connection during the scripted run |
| 2. `models --catalog` | Imports pi-ai catalog **facts** (context window, image input, cost tier) and reports which provider key variables are set (names only) | none read | Real pi-ai 0.87.1 catalog (41 providers, 1495 models) |
| 3. `pi-agent` | Smart Delegate's own tool loop on pi-ai, run as a child process | provider API keys from the environment only | Real pi-ai with a scripted mock: write, macOS-sandboxed bash, blocked escape |

## Harness safety, per run

The harness's configuration is YAML with `!!js` expressions. Smart Delegate therefore writes its
per-run `--patch` as **JSON**, which cannot carry expressions: a model id from a registry file can
never become code.

The patch sets:

- `sandbox-policy`: `workspace-write` (or `read-only`), rooted at the repository;
- `approval`: `never`, plus a single `smart-delegate` permission preset. Anything that would need a
  human is refused; sandboxed shell commands still run;
- `session-log-deepseek`: disabled;
- `session-telemetry-otel`: mode `DISABLED` and a dead local exporter. `DSH_TELEMETRY_DISABLED=1`
  is set too, because config alone cannot disable that row.
- `tool-web`, `web`, `web-search-deepseek`, `web-fetch-http`: disabled. `web_fetch` reaches public
  URLs without approval, which makes it an exfiltration channel.

Before each run, the real `dsh --dump-config` must show every one of those values. A renamed
upstream row, or a value that didn't apply, refuses the run with `POLICY`.

After the run, the harness's own session log must record preset `smart-delegate`, the requested
sandbox, and approval `never`. A mismatch makes the run `needs-attention`.

If your dsh config (for example from the Models page) already declares the provider route, it is
used as-is. Otherwise the run declares it without a key, so dsh resolves your stored sign-in or the
environment. Set `agents.deepseek-harness.declareRoutes: false` to never declare routes.

## Choosing models

```bash
smart-delegate models --catalog                          # providers, model counts, key presence
smart-delegate models --catalog --provider anthropic,zai --save
smart-delegate run "..." --agent deepseek-harness --model anthropic/claude-sonnet-4-5
smart-delegate run "..." --agent pi-agent --model zai/glm-4.7
```

Imported candidates are `experimental` and unrated, with capabilities left unknown. An unrated entry
fails every quality floor, so the router never picks it automatically, in any mode, economy
included. Rate it in `~/.smart-delegate/models.json`, or request it explicitly.

## pi-agent shell sandbox (macOS, verified)

The shell runs under `sandbox-exec` with these limits:

- writes go only to the repository and the temp dir, never to `.git`;
- network access is off unless `shellNetwork: true`;
- `.env*` files are unreadable anywhere;
- credential stores under `$HOME` are unreadable: `.ssh`, `.aws`, `.config/gh`, `.dsh`, `.claude`,
  `.codex`, Keychains and others;
- the environment is a minimal allowlist (`PATH`, `HOME`, locale, `TERM`, `TMPDIR`, `USER`), so
  provider API keys never reach a command the model runs.

## Not done / not verified

- No live provider run through the harness or `pi-agent` yet, because no provider credentials are
  set up on this machine. Everything was exercised against a scripted OpenAI-compatible mock through
  the real binaries and libraries.
- Using a Claude Pro/Max subscription outside Claude Code depends on Anthropic's terms, which were
  not checked here. `pi-agent` deliberately supports env API keys only.
- `pi-agent` on Linux (`bwrap`) is implemented but was not run.
- `pi-agent` has no resume.
