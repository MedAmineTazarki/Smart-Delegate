import { randomUUID } from "node:crypto";

const PATH = "/api/smart-delegate/authorization";
const HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });
const attempts = new Map();
const ROUTE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function oauthProviders(ctx) {
  const service = ctx.get?.("authorization");
  if (!service?.list) return new Map();
  return new Map(service.list().filter((entry) => entry.key.startsWith("llm-pi-ai/") && entry.methods.some((method) => method.id === "oauth"))
    .map((entry) => [entry.key.slice("llm-pi-ai/".length), entry]));
}

const publicAttempt = (attempt) => ({
  id: attempt.id,
  provider: attempt.provider,
  status: attempt.status,
  notices: attempt.notices,
  prompt: attempt.prompt?.view ?? null,
  error: attempt.error ?? null,
});

function makePrompt(attempt, prompt) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const view = {
      id, kind: prompt.kind, message: prompt.message,
      ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
      ...(prompt.kind === "select" ? { options: prompt.options.map((option) => ({ id: option.id, label: option.label, description: option.description })) } : {}),
    };
    const finish = (value, error) => {
      if (attempt.prompt?.view.id !== id) return;
      attempt.prompt = null;
      prompt.signal?.removeEventListener("abort", onAbort);
      attempt.controller.signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(value);
    };
    const onAbort = () => finish(null, new Error("Authorization prompt cancelled."));
    attempt.prompt = { view, finish };
    prompt.signal?.addEventListener("abort", onAbort, { once: true });
    attempt.controller.signal.addEventListener("abort", onAbort, { once: true });
    if (prompt.signal?.aborted || attempt.controller.signal.aborted) onAbort();
  });
}

async function runAttempt(ctx, attempt, entry) {
  try {
    const outcome = await ctx.get("authorization").begin({
      key: entry.key, method: "oauth", signal: attempt.controller.signal,
      interaction: {
        notify(notice) { attempt.notices.push({ message: notice.message, ...(notice.url ? { url: notice.url } : {}), ...(notice.code ? { code: notice.code } : {}) }); },
        prompt(prompt) { return makePrompt(attempt, prompt); },
      },
    });
    if (outcome.status === "authorized") {
      const settings = ctx.get?.("settings");
      const descriptor = settings?.describe?.({ redactSecrets: true })?.find((row) => row.ns === "llm-pi-ai");
      if (!descriptor) throw new Error("Harness model settings are unavailable.");
      if (!descriptor.value?.providers?.[attempt.provider]) {
        await settings.mutate("llm-pi-ai", [{ op: "set", path: ["providers", attempt.provider], value: {} }], descriptor.revision);
      }
    }
    attempt.status = outcome.status;
  } catch (error) {
    attempt.status = attempt.controller.signal.aborted ? "cancelled" : "failed";
    attempt.error = attempt.status === "failed" ? error.message : null;
  } finally {
    attempt.prompt?.finish(null, new Error("Authorization finished."));
  }
}

export function startAuthorization(ctx, provider) {
  if (typeof provider !== "string" || !ROUTE.test(provider)) throw Object.assign(new Error("Invalid provider ID."), { status: 400 });
  const entry = oauthProviders(ctx).get(provider);
  if (!entry) throw Object.assign(new Error("No account sign-in is available for this provider."), { status: 400 });
  if ([...attempts.values()].some((attempt) => attempt.provider === provider && attempt.status === "pending")) {
    throw Object.assign(new Error("Sign-in is already in progress for this provider."), { status: 409 });
  }
  const attempt = { id: randomUUID(), provider, status: "pending", notices: [], prompt: null, error: null, controller: new AbortController() };
  attempts.set(attempt.id, attempt);
  const timeout = setTimeout(() => { attempt.controller.abort(); attempts.delete(attempt.id); }, 10 * 60 * 1000);
  timeout.unref?.();
  void runAttempt(ctx, attempt, entry).finally(() => {
    clearTimeout(timeout);
    const expiry = setTimeout(() => attempts.delete(attempt.id), 60 * 1000);
    expiry.unref?.();
  });
  return publicAttempt(attempt);
}

export function authorizationStatus(id) {
  const attempt = attempts.get(id);
  if (!attempt) throw Object.assign(new Error("Sign-in attempt not found or expired."), { status: 404 });
  return publicAttempt(attempt);
}

export function answerAuthorization(id, promptId, answer) {
  const attempt = attempts.get(id);
  if (!attempt?.prompt || attempt.prompt.view.id !== promptId || attempt.status !== "pending") {
    throw Object.assign(new Error("Authorization question is no longer active."), { status: 409 });
  }
  const view = attempt.prompt.view;
  if (typeof answer !== "string" || answer.length > 4096 || (view.kind === "select" && !view.options.some((option) => option.id === answer))) {
    throw Object.assign(new Error("Invalid authorization answer."), { status: 400 });
  }
  attempt.prompt.finish(answer);
  return publicAttempt(attempt);
}

export function cancelAuthorization(id) {
  const attempt = attempts.get(id);
  if (attempt?.status === "pending") attempt.controller.abort();
  return { cancelled: true };
}

export function registerAuthorizationApi(ctx) {
  ctx.inject(["connection"], (cctx) => {
    if (!cctx.connection?.fetch?.register) return;
    cctx.effect(() => cctx.connection.fetch.register({
      path: PATH, methods: ["GET", "POST", "DELETE"], requestBody: "buffered",
      async fetch(request) {
        try {
          if (request.method === "GET") return respond(authorizationStatus(new URL(request.url).searchParams.get("id")));
          const raw = await request.text();
          if (raw.length > 8 * 1024) return respond({ error: "Authorization request is too large." }, 413);
          let body;
          try { body = JSON.parse(raw); } catch { return respond({ error: "Invalid JSON." }, 400); }
          if (request.method === "DELETE") return respond(cancelAuthorization(body?.id));
          if (body?.action === "answer") return respond(answerAuthorization(body.id, body.promptId, body.answer));
          return respond(startAuthorization(cctx, body?.provider));
        } catch (error) { return respond({ error: error.message }, error.status ?? 500); }
      },
    }), "smart-delegate: authorization API");
  });
}
