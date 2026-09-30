import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { answerAuthorization, authorizationStatus, cancelAuthorization, startAuthorization } from "../../harness/authorization.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("Harness account authorization", () => {
  it("relays notices and prompts, then activates the signed-in route", async () => {
    const profiles = {};
    const settings = {
      describe: () => [{ ns: "llm-pi-ai", revision: 1, value: { providers: profiles } }],
      mutate: async (_ns, ops) => { profiles[ops[0].path[1]] = ops[0].value; },
    };
    const authorization = {
      list: () => [{ key: "llm-pi-ai/openai-codex", methods: [{ id: "oauth", label: "Sign in" }] }],
      async begin({ interaction }) {
        interaction.notify({ message: "Open the account page", url: "https://example.invalid/login", code: "ABCD" });
        const answer = await interaction.prompt({ kind: "text", message: "Enter the code" });
        assert.equal(answer, "approved");
        return { status: "authorized" };
      },
    };
    const ctx = { get: (name) => ({ authorization, settings })[name] };
    const started = startAuthorization(ctx, "openai-codex");
    await tick();
    const pending = authorizationStatus(started.id);
    assert.equal(pending.notices[0].code, "ABCD");
    assert.equal(pending.prompt.kind, "text");
    answerAuthorization(started.id, pending.prompt.id, "approved");
    await tick();
    assert.equal(authorizationStatus(started.id).status, "authorized");
    assert.deepEqual(profiles["openai-codex"], {});
  });

  it("cancels an active attempt", async () => {
    const authorization = {
      list: () => [{ key: "llm-pi-ai/github-copilot", methods: [{ id: "oauth", label: "Sign in" }] }],
      async begin({ signal }) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        return { status: "cancelled" };
      },
    };
    const ctx = { get: (name) => ({ authorization })[name] };
    const started = startAuthorization(ctx, "github-copilot");
    await tick();
    cancelAuthorization(started.id);
    await tick();
    assert.equal(authorizationStatus(started.id).status, "cancelled");
  });
});
