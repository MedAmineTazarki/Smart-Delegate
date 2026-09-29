---
name: smart-delegate-setup
description: >-
  Set up Smart Delegate on this machine or project: create its state directory, discover installed
  coding-agent CLIs, import real model ids, and write a project config with verification gates. Use
  when the user asks to install, configure, or set up Smart Delegate, add a newly installed agent,
  or refresh which models are available. Never dispatches coding work.
metadata:
  version: 0.1.0
---

# Smart Delegate setup

1. Initialise state and discover agents:

   ```bash
   smart-delegate setup            # ~/.smart-delegate, agent discovery
   smart-delegate setup --project  # also .smart-delegate/config.json in this repo
   ```

2. Show the user what was found (`smart-delegate agents`). Missing agents are fine; say which ones
   could be installed (Claude Code, Codex, Command Code). Do not install or log in to anything
   without the user's explicit OK.

3. Real model ids (never invent them):

   ```bash
   smart-delegate models --discover          # what each installed CLI reports
   smart-delegate models --discover --save   # record new ids as *experimental*
   ```

   Experimental entries have unknown capabilities, so they only run when requested explicitly
   (`--agent ... --model ...`) until someone rates them in `~/.smart-delegate/models.json`.

4. Verification gates: if `smart-delegate run --dry-run "<any task>" --json` shows no gates, ask the
   user for the project's real test/lint/build commands and write them to
   `.smart-delegate/config.json`:

   ```json
   { "verification": { "gates": [ { "name": "test", "argv": ["npm", "test"] } ] } }
   ```

5. Finish with `smart-delegate doctor`.
