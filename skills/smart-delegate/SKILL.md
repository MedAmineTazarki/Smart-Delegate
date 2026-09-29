---
name: smart-delegate
description: >-
  Route an engineering task to the best currently available coding agent and model (Claude Code,
  Codex, Command Code, ...), delegate it with a self-contained brief, then verify the real diff
  independently before anything is committed. Use when the user asks to delegate, hand off, or
  "have another agent/model do" an implementation, fix, refactor, test or review task, or asks which
  agent/model should do a task. Do not use for trivial edits you can make inline, or when the user
  asks you to do the work yourself.
metadata:
  version: 0.1.0
---

# Smart Delegate

You are the **orchestrator**. The `smart-delegate` runtime decides *who* executes (agent + model),
runs the worker safely, and verifies the result. You own the task definition and the final judgment.
Routing logic lives in the runtime, not here: never pick a model from memory.

## 1. Decide whether to delegate

- Trivial edit (typo, one-liner)? Do it inline.
- User said "don't delegate"? Don't.
- Otherwise ask the runtime (cheap, no execution):

```bash
smart-delegate route "<task>" --json            # decision, primary, fallbacks, review, confidence
smart-delegate explain "<task>"                 # human-readable reasoning, if the user asks why
```

`decision` is `delegate`, `stay` (do it inline), or `no-candidate` (tell the user; `smart-delegate doctor`).

Pass what you know better than keyword heuristics: `--type feature,tests`, `--risk high`,
`--files src/auth,test/auth`. Honour user overrides literally: "use Codex" → `--agent codex`,
"use the cheapest" → `--mode economy`, "best quality" → `--mode quality`,
"not provider X" → `--exclude-provider X`.

## 2. Delegate

The worker gets **only** the brief. Put everything it needs into the task text and flags:
goal, constraints, acceptance criteria (`--acceptance`), extra context (`--context-file`), real gate
commands (`--gate "npm test"`) when the runtime cannot discover them. Never paste secrets.

```bash
smart-delegate run "<task>" --json [--files ...] [--gate "..."] [--timeout 30m]
```

Run it in the background for long tasks; it blocks until the worker exits and verification finishes.
`--dry-run` shows the brief and plan without executing.

## 3. Read the result (`status`)

| status | meaning | you do |
| --- | --- | --- |
| `verified` | worker finished, gates re-run by the runtime pass, required review passed | read `changes.diffPath`, then commit yourself |
| `pending-review` | gates pass (or none ran); review is yours | review the diff, then `smart-delegate outcome <runId> --accept\|--reject` |
| `verification-failed` / `changes-requested` | gates or independent reviewer rejected it | fix inline or re-run with a delta task |
| `failed` | worker failed; fallbacks were tried when a different agent could help | read `attempts[].failure`, inspect the tree |
| `needs-attention` | HEAD moved or user changes vanished | stop; show the user `warnings` |
| `not-delegated` / `no-candidate` / `refused` | nothing ran | follow `nextSteps` |

Always check `warnings` and `changes.userFilesTouched` / `changes.outOfScope`.

## 4. Rules

- The worker's report is a claim. The runtime's gate results and the diff are the evidence.
- Never commit worker changes before reviewing the diff. Workers never commit.
- Never run `git reset --hard`, `git clean`, or checkout over the user's work to "tidy up".
- Record your decision on `pending-review` runs so future routing learns from it.
