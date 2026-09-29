# Contributing

Ground rules:

- Node built-ins only.
- ES modules (`.mjs`), with JSDoc for types.
- Every change ships with tests (`npm test`, which uses `node:test`).
- Never hard-code a model or agent preference in routing code. Routing preferences are data.
- Never invent a CLI flag or model id. Verify against the installed CLI's `--help` or its official
  docs, and note the version you checked in the adapter header.

## New agent adapter

1. Install the CLI. Read `<cli> --help` and the help for its non-interactive subcommand. Write down
   the flags for:
   - non-interactive mode;
   - structured output;
   - model selection;
   - effort;
   - read-only or sandbox mode;
   - write mode;
   - resume;
   - version;
   - auth status.
2. Create `src/adapters/<id>.mjs`:

   ```js
   export default defineAdapter({
     id, displayName, binaryNames: [...], binaryEnv: "SMART_DELEGATE_<ID>_BIN",
     capabilities: { supportsReadOnly, readOnlyEnforcement, supportsWrite, writeSandbox,
                     supportsResume, supportsModelSelection, supportsStructuredOutput, supportsImages },
     authProbe: { args, interpret(r) },          // optional
     validateModel(model),                       // token check
     discoverModels?(ctx),                       // real ids only
     classifyExit?(code),                        // documented exit codes -> failure class
     buildCommand(req) -> { args, stdin, finalMessagePath? },   // brief on stdin, never argv
     parseOutput({ lines, exitCode, finalText }) -> { status, sessionId, finalMessage, usage, error },
   });
   ```

   Be truthful about capabilities. If read-only is only tool withholding, say so in
   `readOnlyEnforcement`. If it can't be guaranteed at all, set `supportsReadOnly: false`.
3. Register it in `src/adapters/index.mjs` and `config/defaults.json` (`agents.<id>`).
4. Teach `fixtures/fake-agents/_core.mjs` to recognise its argv and emit its output format.
   `test/contract/adapters.test.mjs` then covers it automatically:
   - contract;
   - brief on stdin;
   - read-only vs write;
   - resume;
   - success, failure, timeout, malformed and missing binary.
5. Add registry entries in `config/capabilities.json` **only** with verified model ids, marked
   `"source": "manual-seed"`. Use `"model": null` for the agent's own default.
6. Update the README's supported-agents table with the verification status. Claim only what you ran.

## New routing dimension

1. Add the capability key to registry entries. The schema accepts any `capabilities.<key>` in 0..1.
2. Reference it from a weight profile in `config/defaults.json` (`routing.weightProfiles`). If it is
   derived from the task rather than stored, compute it in `router.mjs` next to `taskFit` and
   `contextFit`.
3. Optionally add a quality floor (`routing.qualityFloors`).
4. Add a router test proving that changing only data changes the ranking.

## New CLI command

Add a handler in `src/cli.mjs` (`COMMANDS`) and any new options (`OPTIONS` and the `HELP` text).

- With `--json`, write exactly one JSON document to stdout with a versioned `schema` field.
- Diagnostics go through `log.*`, which writes to stderr.
- Add an e2e test in `test/e2e/cli.test.mjs`.

## New benchmark source (V2)

Each record must carry:

- source;
- benchmark;
- model;
- agent, when relevant;
- metric;
- score;
- date;
- retrieval date;
- sample size, when available.

Normalise the metric before it can influence a capability. Apply freshness decay. Local outcomes
outrank public benchmarks as evidence grows. See `docs/V2-ROADMAP.md`.

## New pricing source (V2)

Write `costPerTaskUsd` or per-token pricing with `source` and `retrievedAt` into a registry layer.
Never scrape silently, and never overwrite user-curated entries. `saveUserEntries` already refuses to
clobber them.

## Before sending a change

```bash
npm test
node bin/smart-delegate.mjs doctor
```

If you touched an adapter's launch, also do a real read-only smoke run against a throwaway repo, and
record the CLI version in the README.
