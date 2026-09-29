---
name: smart-delegate-doctor
description: >-
  Diagnose Smart Delegate problems: agents not found or not authenticated, invalid or corrupt
  config/registry, unreadable history, "no-candidate" routing decisions, or failed delegations. Use
  when the user reports Smart Delegate is broken, a route returns no candidate, or a run failed and
  the cause is unclear.
metadata:
  version: 0.1.0
---

# Smart Delegate doctor

1. `smart-delegate doctor --json` — read every check with `ok: false`:
   - `config valid` / `registry valid` false: the message names the file and field. Fix that file;
     Smart Delegate refuses to guess around a broken config.
   - `agent <id>` not authenticated: tell the user the login command (`claude auth login`,
     `codex login`, `cmd login`); do not run interactive logins yourself.
   - no usable agent: at least one of Claude Code, Codex, Command Code must be installed.

2. `no-candidate`: run `smart-delegate explain "<task>" --json` and read `excluded[].reason`
   (agent not installed, quality floor, context window, vision, budget, experimental, excluded
   provider). Suggest the matching override (`--agent`, `--mode`, `--max-cost-tier`) only if the user
   agrees to the trade-off.

3. Failed run: open `<runDir>/run.json`, then `attempt-N/result.json`, `stderr.txt`,
   `events.jsonl`. `failure.class` tells you whether a retry on another agent can help
   (TRANSIENT, CAPABILITY, POLICY, agent ENVIRONMENT) or not (QUALITY, repo ENVIRONMENT, UNKNOWN).

4. Never delete `~/.smart-delegate/history.jsonl` or `models.json` to "fix" things; corrupt history
   lines are skipped automatically.
