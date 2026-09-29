// Single-page UI served by `smart-delegate ui`. No external resources.
// All data is inserted with textContent (never innerHTML) — task text, file
// paths and agent output are untrusted.

export const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Delegate</title>
<style>
:root {
  --bg: #f6f7f9; --panel: #ffffff; --ink: #1c2230; --muted: #5b6475; --line: #e3e6ec;
  --accent: #3b5bdb; --accent-ink: #ffffff; --ok: #1f8a4c; --warn: #b7791f; --bad: #c53030; --chip: #eef1f6;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #11141a; --panel: #181c24; --ink: #e6e9ef; --muted: #9aa3b2; --line: #2a303b;
    --accent: #7c95ff; --accent-ink: #0d1020; --ok: #48bb78; --warn: #ecc94b; --bad: #fc8181; --chip: #232936; color-scheme: dark; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { display: flex; align-items: center; gap: 16px; padding: 14px 24px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 2; }
header h1 { font-size: 17px; margin: 0; font-weight: 650; letter-spacing: .2px; }
header .sub { color: var(--muted); font-size: 13px; }
nav { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
nav button, .ghost { background: none; border: 1px solid transparent; color: var(--muted); padding: 6px 12px; border-radius: 8px; cursor: pointer; font: inherit; }
nav button[aria-selected="true"] { color: var(--ink); background: var(--chip); }
.lang { border-color: var(--line); }
main { max-width: 1100px; margin: 0 auto; padding: 24px; }
section[hidden] { display: none; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
h2 { font-size: 15px; margin: 0 0 14px; }
label { display: block; font-size: 13px; color: var(--muted); margin: 0 0 4px; }
textarea, input, select { width: 100%; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px; font: inherit; }
textarea { min-height: 110px; resize: vertical; }
.grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-top: 14px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; align-items: center; }
.btn { background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 8px; padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer; }
.btn.secondary { background: var(--chip); color: var(--ink); }
.btn.danger { background: none; color: var(--bad); border: 1px solid var(--bad); }
.btn:disabled { opacity: .5; cursor: default; }
.chip { display: inline-block; padding: 2px 9px; border-radius: 99px; background: var(--chip); font-size: 12.5px; margin: 0 6px 6px 0; }
.chip.ok { color: var(--ok); } .chip.warn { color: var(--warn); } .chip.bad { color: var(--bad); }
.muted { color: var(--muted); }
.mono { font-family: var(--mono); font-size: 13px; }
ul.clean { list-style: none; padding: 0; margin: 6px 0 0; }
ul.clean li { padding: 5px 0; border-bottom: 1px dashed var(--line); }
ul.clean li:last-child { border-bottom: 0; }
.bar { display: grid; grid-template-columns: 170px 1fr 44px; gap: 10px; align-items: center; font-size: 13px; margin: 5px 0; }
.bar i { display: block; height: 8px; border-radius: 4px; background: var(--accent); }
.bar span:last-child { text-align: right; color: var(--muted); }
.big { font-size: 20px; font-weight: 650; }
.two { display: grid; gap: 20px; grid-template-columns: 1fr 1fr; }
@media (max-width: 760px) { .two { grid-template-columns: 1fr; } header { flex-wrap: wrap; } nav { margin-left: 0; } }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 550; }
pre.diff { max-height: 420px; overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; font: 12.5px/1.45 var(--mono); white-space: pre; }
.add { color: var(--ok); } .del { color: var(--bad); }
.error { color: var(--bad); margin-top: 10px; }
.empty { color: var(--muted); padding: 18px 0; text-align: center; }
</style>
</head>
<body>
<header>
  <div><h1>Smart Delegate</h1><div class="sub" data-t="tagline"></div></div>
  <nav role="tablist">
    <button role="tab" data-tab="task" data-t="tabTask"></button>
    <button role="tab" data-tab="runs" data-t="tabRuns"></button>
    <button role="tab" data-tab="history" data-t="tabHistory"></button>
    <button role="tab" data-tab="setup" data-t="tabSetup"></button>
    <button class="ghost lang" id="lang"></button>
  </nav>
</header>
<main>
  <section id="tab-task">
    <div class="panel">
      <h2 data-t="newTask"></h2>
      <label for="task" data-t="taskLabel"></label>
      <textarea id="task"></textarea>
      <div class="grid">
        <div><label for="cwd" data-t="repo"></label><input id="cwd" class="mono"></div>
        <div><label for="mode" data-t="mode"></label>
          <select id="mode"><option value="">auto</option><option>quality</option><option>balanced</option><option>economy</option><option>fast</option><option>local-only</option></select></div>
        <div><label for="risk" data-t="risk"></label>
          <select id="risk"><option value="" data-t="riskAuto"></option><option value="low" data-t="riskLow"></option><option value="medium" data-t="riskMedium"></option><option value="high" data-t="riskHigh"></option></select></div>
        <div><label for="agent" data-t="agent"></label><select id="agent"><option value="" data-t="agentAuto"></option></select></div>
        <div><label for="model" data-t="model"></label><input id="model" class="mono" data-tp="modelHint"></div>
        <div><label for="files" data-t="files"></label><input id="files" class="mono" data-tp="filesHint"></div>
      </div>
      <div style="margin-top:14px"><label for="gates" data-t="gates"></label><input id="gates" class="mono" data-tp="gatesHint"></div>
      <div class="row">
        <button class="btn secondary" id="btn-route" data-t="analyze"></button>
        <button class="btn" id="btn-run" data-t="launch"></button>
        <span class="muted" id="route-busy"></span>
      </div>
      <div class="error" id="task-error"></div>
    </div>
    <div id="route-result"></div>
  </section>

  <section id="tab-runs" hidden>
    <div id="jobs"></div>
  </section>

  <section id="tab-history" hidden>
    <div class="panel"><h2 data-t="stats"></h2><div id="stats"></div></div>
    <div class="panel"><h2 data-t="recent"></h2><div id="history"></div></div>
  </section>

  <section id="tab-setup" hidden>
    <div class="panel"><h2 data-t="agents"></h2><div id="agents"></div></div>
    <div class="panel"><h2 data-t="models"></h2><p class="muted" data-t="modelsNote"></p><div id="models"></div></div>
  </section>
</main>
<script>
"use strict";
const TXT = {
  fr: {
    tagline: "Routage et délégation sécurisée entre agents de code", tabTask: "Tâche", tabRuns: "Runs", tabHistory: "Historique", tabSetup: "Agents et modèles",
    newTask: "Nouvelle tâche", taskLabel: "Que faut-il faire ?", repo: "Dépôt (dossier git)", mode: "Mode", risk: "Risque",
    riskAuto: "détecté automatiquement", riskLow: "faible", riskMedium: "moyen", riskHigh: "élevé",
    agent: "Agent", agentAuto: "choix automatique", model: "Modèle", modelHint: "ex. opus, ou fournisseur/modèle", files: "Fichiers du périmètre", filesHint: "src/auth, test/auth",
    gates: "Commandes de vérification (séparées par ;)", gatesHint: "npm test ; npm run lint",
    analyze: "Analyser le routage", launch: "Lancer la délégation", analyzing: "Analyse…",
    decision: "Décision", primary: "Agent principal", confidence: "confiance", fallbacks: "Replis", review: "Relecture", why: "Pourquoi",
    weights: "Pondérations", excluded: "Candidats écartés", ranked: "Classement", warnings: "Attention", profile: "Profil de la tâche",
    complexity: "complexité", none: "aucun",
    noJobs: "Aucun run pour l'instant. Lance une délégation depuis l'onglet Tâche.", running: "en cours…", cancel: "Annuler",
    attempts: "Tentatives", changes: "Fichiers modifiés par le worker", preserved: "modification(s) existante(s) préservée(s)",
    gatesRes: "Vérifications", next: "Prochaines étapes", viewDiff: "Voir le diff", hideDiff: "Masquer le diff", accept: "Accepter", reject: "Rejeter",
    recorded: "Décision enregistrée.", stats: "Statistiques par agent et modèle", recent: "Derniers résultats", noHistory: "Pas encore d'historique.",
    date: "Date", agentModel: "Agent / modèle", type: "Type", status: "Statut", accepted: "acceptées", transient: "transitoires",
    agents: "Agents détectés", installed: "installé", notInstalled: "non installé", version: "Version", path: "Chemin",
    models: "Registre de modèles", modelsNote: "Les candidats non notés ne sont jamais choisis automatiquement ; demande-les avec Agent + Modèle.",
    rated: "noté", unrated: "non noté", tier: "coût", context: "contexte", failed: "Échec", errToken: "Jeton manquant : ouvre l'URL complète affichée par « smart-delegate ui ».",
  },
  en: {
    tagline: "Routing and safe delegation across coding agents", tabTask: "Task", tabRuns: "Runs", tabHistory: "History", tabSetup: "Agents & models",
    newTask: "New task", taskLabel: "What needs to be done?", repo: "Repository (git folder)", mode: "Mode", risk: "Risk",
    riskAuto: "auto-detected", riskLow: "low", riskMedium: "medium", riskHigh: "high",
    agent: "Agent", agentAuto: "automatic", model: "Model", modelHint: "e.g. opus, or provider/model", files: "Files in scope", filesHint: "src/auth, test/auth",
    gates: "Verification commands (separated by ;)", gatesHint: "npm test ; npm run lint",
    analyze: "Analyze routing", launch: "Delegate", analyzing: "Analyzing…",
    decision: "Decision", primary: "Primary agent", confidence: "confidence", fallbacks: "Fallbacks", review: "Review", why: "Why",
    weights: "Weights", excluded: "Filtered out", ranked: "Ranking", warnings: "Warnings", profile: "Task profile",
    complexity: "complexity", none: "none",
    noJobs: "No runs yet. Start a delegation from the Task tab.", running: "running…", cancel: "Cancel",
    attempts: "Attempts", changes: "Files changed by the worker", preserved: "pre-existing change(s) preserved",
    gatesRes: "Verification", next: "Next steps", viewDiff: "View diff", hideDiff: "Hide diff", accept: "Accept", reject: "Reject",
    recorded: "Decision recorded.", stats: "Stats per agent and model", recent: "Recent outcomes", noHistory: "No history yet.",
    date: "Date", agentModel: "Agent / model", type: "Type", status: "Status", accepted: "accepted", transient: "transient",
    agents: "Detected agents", installed: "installed", notInstalled: "not installed", version: "Version", path: "Path",
    models: "Model registry", modelsNote: "Unrated candidates are never picked automatically; request them with Agent + Model.",
    rated: "rated", unrated: "unrated", tier: "cost", context: "context", failed: "Failed", errToken: "Missing token: open the full URL printed by \\"smart-delegate ui\\".",
  },
};
let lang = "fr";
try { lang = localStorage.getItem("sd-lang") || "fr"; } catch {}
let token = "";
try {
  const m = /token=([\\w-]+)/.exec(location.hash);
  if (m) { sessionStorage.setItem("sd-token", m[1]); history.replaceState(null, "", location.pathname); }
  token = sessionStorage.getItem("sd-token") || "";
} catch {}
const T = (k) => TXT[lang][k] ?? k;
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn); else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return n;
}

async function api(path, body) {
  const res = await fetch(path + (path.includes("?") ? "&" : "?") + "lang=" + lang, {
    method: body ? "POST" : "GET",
    headers: { "x-sd-token": token, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(res.status === 401 ? T("errToken") : (data.error || res.status));
  return data;
}

function applyText() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach((n) => { n.textContent = T(n.dataset.t); });
  document.querySelectorAll("[data-tp]").forEach((n) => { n.placeholder = T(n.dataset.tp); });
  $("lang").textContent = lang === "fr" ? "English" : "Français";
}

function showTab(name) {
  document.querySelectorAll("nav [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll("main > section").forEach((s) => { s.hidden = s.id !== "tab-" + name; });
  if (name === "runs") renderJobs();
  if (name === "history") loadHistory();
  if (name === "setup") loadState();
}

const statusClass = (s) => (["verified", "completed", "done"].includes(s) ? "ok" : ["pending-review", "not-delegated", "dry-run", "running"].includes(s) ? "warn" : "bad");

function formBody() {
  return {
    task: $("task").value, cwd: $("cwd").value, mode: $("mode").value, risk: $("risk").value,
    agent: $("agent").value, model: $("model").value, files: $("files").value,
    gates: $("gates").value.split(";").map((g) => g.trim()).filter(Boolean),
  };
}

function renderRoute(r) {
  const box = $("route-result");
  box.replaceChildren();
  const top = el("div", { class: "panel" },
    el("div", { class: "muted" }, T("decision")),
    el("div", { class: "big" }, r.decisionLabel),
    r.primary ? el("p", {}, el("strong", {}, T("primary") + " : "), el("span", { class: "mono" }, r.primary.label), " — score " + r.primary.score + " · " + T("confidence") + " " + Math.round(r.confidence * 100) + " %") : null,
    r.fallbacks.length ? el("p", {}, el("strong", {}, T("fallbacks") + " : "), r.fallbacks.map((f) => el("span", { class: "chip mono" }, f.label + " (" + f.score + ")"))) : null,
    el("p", {}, el("strong", {}, T("review") + " : "), r.review.byLabel + (r.review.label ? " → " + r.review.label : "")),
    el("div", {}, el("span", { class: "chip" }, r.profile.taskType), el("span", { class: "chip" }, T("complexity") + " " + r.profile.complexity), el("span", { class: "chip " + (r.profile.riskLevel === "high" ? "bad" : r.profile.riskLevel === "medium" ? "warn" : "ok") }, r.profile.riskLabel + " (" + r.profile.risk + ")")),
    r.warnings.length ? el("div", {}, el("h2", {}, T("warnings")), el("ul", { class: "clean" }, r.warnings.map((w) => el("li", { class: "chip warn" }, w)))) : null,
  );
  const why = el("div", { class: "panel" }, el("h2", {}, T("why")), el("ul", { class: "clean" }, r.reasons.map((x) => el("li", {}, x))),
    r.profile.signals.length ? el("p", { class: "muted" }, T("profile") + " : " + r.profile.signals.join(" · ")) : null);
  const weights = el("div", { class: "panel" }, el("h2", {}, T("weights")),
    r.weights.map((w) => el("div", { class: "bar" }, el("span", {}, w.label), el("span", {}, el("i", { style: "width:" + Math.round(w.weight * 100 / r.weights[0].weight) + "%" })), el("span", {}, Math.round(w.weight * 100) + "%"))));
  const ranked = el("div", { class: "panel" }, el("h2", {}, T("ranked")),
    r.ranked.length ? el("table", {}, el("tbody", {}, r.ranked.map((c) => el("tr", {}, el("td", { class: "mono" }, c.label), el("td", {}, String(c.score)), el("td", { class: "muted" }, T("tier") + " " + (c.costTier ?? "?")))))) : el("div", { class: "empty" }, T("none")));
  const excluded = el("div", { class: "panel" }, el("h2", {}, T("excluded")),
    r.excluded.length ? el("ul", { class: "clean" }, r.excluded.map((e) => el("li", {}, el("span", { class: "mono" }, e.label), el("div", { class: "muted" }, e.reason)))) : el("div", { class: "empty" }, T("none")));
  box.append(top, el("div", { class: "two" }, why, weights), el("div", { class: "two" }, ranked, excluded));
}

async function doRoute() {
  $("task-error").textContent = "";
  $("route-busy").textContent = T("analyzing");
  try { renderRoute(await api("/api/route", formBody())); } catch (e) { $("task-error").textContent = e.message; }
  $("route-busy").textContent = "";
}

async function doRun() {
  $("task-error").textContent = "";
  try { await api("/api/run", formBody()); showTab("runs"); } catch (e) { $("task-error").textContent = e.message; }
}

let polling = null;
async function renderJobs() {
  let jobs = [];
  try { jobs = await api("/api/jobs"); } catch (e) { $("jobs").replaceChildren(el("div", { class: "error" }, e.message)); return; }
  const box = $("jobs");
  box.replaceChildren();
  if (!jobs.length) box.append(el("div", { class: "panel empty" }, T("noJobs")));
  for (const j of jobs) box.append(jobCard(j));
  clearTimeout(polling);
  if (jobs.some((j) => j.status === "running")) polling = setTimeout(renderJobs, 2000);
}

function jobCard(j) {
  const run = j.run;
  const status = j.status === "running" ? "running" : run ? run.status : "error";
  const card = el("div", { class: "panel" },
    el("div", {}, el("span", { class: "chip " + statusClass(status) }, j.status === "running" ? T("running") : run ? run.statusLabel : T("failed")), el("span", { class: "muted mono" }, j.cwd)),
    el("p", {}, j.task));
  if (j.status === "running") card.append(el("button", { class: "btn danger", on: { click: async () => { await api("/api/jobs/" + j.id + "/cancel", {}); renderJobs(); } } }, T("cancel")));
  if (j.error) card.append(el("div", { class: "error mono" }, j.error));
  if (!run) return card;
  if (run.attempts?.length) card.append(el("h2", {}, T("attempts")), el("ul", { class: "clean" }, run.attempts.map((a) => el("li", {}, el("span", { class: "mono" }, a.label), " → ", el("span", { class: "chip " + statusClass(a.status) }, a.statusLabel), a.failure ? el("span", { class: "muted" }, " " + a.failure.class + " : " + a.failure.reason) : null))));
  if (run.changes) {
    card.append(el("h2", {}, T("changes")), el("ul", { class: "clean mono" }, run.changes.workerChanges.map((c) => el("li", {}, c.kind + "  " + c.path))),
      el("p", { class: "muted" }, run.changes.userChangesPreserved + " " + T("preserved")));
  }
  if (run.verification?.ran) card.append(el("h2", {}, T("gatesRes")), el("div", {}, run.verification.results.map((g) => el("span", { class: "chip mono " + (g.passed ? "ok" : "bad") }, (g.passed ? "✓ " : "✗ ") + g.argv.join(" ")))));
  if (run.warnings.length) card.append(el("h2", {}, T("warnings")), el("ul", { class: "clean" }, run.warnings.map((w) => el("li", {}, w))));
  if (run.nextSteps.length) card.append(el("h2", {}, T("next")), el("ul", { class: "clean" }, run.nextSteps.map((s) => el("li", {}, s))));
  const actions = el("div", { class: "row" });
  if (run.changes) {
    const pre = el("pre", { class: "diff", hidden: "" });
    const btn = el("button", { class: "btn secondary", on: { click: async () => {
      if (!pre.hidden) { pre.hidden = true; btn.textContent = T("viewDiff"); return; }
      const text = await api("/api/runs/" + encodeURIComponent(run.runId) + "/diff");
      pre.replaceChildren(...String(text).split("\\n").map((l) => el("div", { class: l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "" }, l || " ")));
      pre.hidden = false; btn.textContent = T("hideDiff");
    } } }, T("viewDiff"));
    actions.append(btn);
    card.append(actions, pre);
  }
  if (run.status === "pending-review") {
    const note = el("span", { class: "muted" });
    const decide = (accept) => async () => { await api("/api/outcome", { runId: run.runId, accept }); note.textContent = T("recorded"); };
    actions.append(el("button", { class: "btn", on: { click: decide(true) } }, T("accept")), el("button", { class: "btn danger", on: { click: decide(false) } }, T("reject")), note);
    if (!run.changes) card.append(actions);
  }
  return card;
}

async function loadHistory() {
  try {
    const h = await api("/api/history");
    $("stats").replaceChildren(h.stats.length ? el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, T("agentModel")), el("th", {}, T("type")), el("th", {}, T("accepted")), el("th", {}, T("transient")))),
      el("tbody", {}, h.stats.map((s) => el("tr", {}, el("td", { class: "mono" }, s.agent + " / " + (s.model ?? "—")), el("td", {}, s.taskType), el("td", {}, s.accepted + "/" + s.attempts), el("td", {}, String(s.transient)))))) : el("div", { class: "empty" }, T("noHistory")));
    $("history").replaceChildren(h.records.length ? el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, T("date")), el("th", {}, T("agentModel")), el("th", {}, T("type")), el("th", {}, T("status")))),
      el("tbody", {}, h.records.map((r) => el("tr", {}, el("td", { class: "muted" }, new Date(r.timestamp).toLocaleString(lang)), el("td", { class: "mono" }, r.agent + " / " + (r.model ?? "—")), el("td", {}, r.taskType), el("td", {}, el("span", { class: "chip " + statusClass(r.status ?? (r.success ? "completed" : "failed")) }, r.statusLabel)))))) : el("div", { class: "empty" }, T("noHistory")));
  } catch (e) { $("history").replaceChildren(el("div", { class: "error" }, e.message)); }
}

let stateLoaded = false;
async function loadState() {
  try {
    const s = await api("/api/state");
    if (!stateLoaded) {
      if (!$("cwd").value) $("cwd").value = s.repo || s.cwd;
      for (const a of s.agents.filter((x) => x.installed)) $("agent").append(el("option", { value: a.id }, a.name));
      stateLoaded = true;
    }
    $("agents").replaceChildren(el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, T("agent")), el("th", {}, T("status")), el("th", {}, T("version")), el("th", {}, T("path")))),
      el("tbody", {}, s.agents.map((a) => el("tr", {}, el("td", {}, a.name), el("td", {}, el("span", { class: "chip " + (a.installed ? "ok" : "") }, a.installed ? T("installed") : T("notInstalled"))), el("td", { class: "mono" }, a.version ?? "—"), el("td", { class: "mono muted" }, a.path ?? "—"))))));
    $("models").replaceChildren(el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "ID"), el("th", {}, T("status")), el("th", {}, T("tier")), el("th", {}, T("context")))),
      el("tbody", {}, s.models.map((m) => el("tr", {}, el("td", { class: "mono" }, m.id), el("td", {}, el("span", { class: "chip" }, m.status), el("span", { class: "chip " + (m.rated ? "ok" : "warn") }, m.rated ? T("rated") : T("unrated"))), el("td", {}, String(m.costTier ?? "?")), el("td", {}, m.contextWindow ? m.contextWindow.toLocaleString(lang) : "?"))))));
  } catch (e) { $("agents").replaceChildren(el("div", { class: "error" }, e.message)); }
}

document.querySelectorAll("nav [data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$("lang").addEventListener("click", () => { lang = lang === "fr" ? "en" : "fr"; try { localStorage.setItem("sd-lang", lang); } catch {} applyText(); });
$("btn-route").addEventListener("click", doRoute);
$("btn-run").addEventListener("click", doRun);
applyText();
showTab("task");
loadState();
</script>
</body>
</html>`;
