// Minimal i18n for human-facing output (English, French).
//
// The runtime produces plain English strings (so the --json contract and
// every stored artifact stay English and stable) through L(key, params).
// Human output re-renders any such string in the user's language with tr():
// it recognises which English template produced the text, extracts the
// parameters, and formats the translated template. This also works for
// messages read back from run.json or history, e.g. by the web UI.
import { MESSAGES } from "./messages.mjs";

export const LANGS = ["en", "fr"];

/** SMART_DELEGATE_LANG, then the POSIX locale variables; English otherwise. */
export function detectLang(env = process.env) {
  const explicit = env.SMART_DELEGATE_LANG?.toLowerCase().slice(0, 2);
  if (explicit && LANGS.includes(explicit)) return explicit;
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[key];
    if (value && value !== "C" && value !== "POSIX") return value.toLowerCase().startsWith("fr") ? "fr" : "en";
  }
  return "en";
}

let current = detectLang();
export function setLang(language) {
  if (!LANGS.includes(language)) throw new Error(`unsupported language "${language}" (use ${LANGS.join(", ")})`);
  current = language;
}
export const lang = () => current;

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (params && k in params ? String(params[k]) : `{${k}}`));
}

/** Translate a message key (falls back to English, then to the key). */
export function t(key, params = {}, language = current) {
  const template = MESSAGES[language]?.[key] ?? MESSAGES.en[key];
  return template === undefined ? key : format(template, params);
}

/** Produce the canonical (English) text of a runtime message. */
export function L(key, params = {}) {
  return t(key, params, "en");
}

// ---- reverse lookup: English text -> key + params

const PRODUCER_PREFIXES = ["ex.", "warn.", "why.", "prof.", "risk.", "run."];
const LABEL_PREFIXES = ["dim.", "level.", "status.", "decision.", "review."];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let reverse = null;
function reverseIndex() {
  if (reverse) return reverse;
  const templates = [];
  const labels = new Map();
  for (const [key, template] of Object.entries(MESSAGES.en)) {
    if (LABEL_PREFIXES.some((p) => key.startsWith(p))) labels.set(template, key);
    if (!PRODUCER_PREFIXES.some((p) => key.startsWith(p))) continue;
    const names = [];
    const pattern = template.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return esc(part);
      names.push(m[1]);
      return "([\\s\\S]+?)";
    }).join("");
    const literal = template.replace(/\{\w+\}/g, "").length;
    templates.push({ key, names, re: new RegExp(`^${pattern}$`), literal });
  }
  templates.sort((a, b) => b.literal - a.literal);
  reverse = { templates, labels };
  return reverse;
}

/** Render a runtime message for humans in the given language. */
export function tr(text, language = current) {
  if (text === null || text === undefined) return "";
  const s = String(text);
  if (language === "en") return s;
  const { templates, labels } = reverseIndex();
  const label = labels.get(s);
  if (label) return t(label, {}, language);
  for (const { key, names, re } of templates) {
    const m = re.exec(s);
    if (!m) continue;
    const params = {};
    names.forEach((name, i) => {
      const value = m[i + 1];
      const labelKey = labels.get(value);
      params[name] = labelKey ? t(labelKey, {}, language) : value;
    });
    return t(key, params, language);
  }
  return s;
}

/** Translate a label key family value, e.g. label("status", "verified"). */
export function label(family, value, language = current) {
  const key = `${family}.${value}`;
  return MESSAGES.en[key] === undefined ? String(value) : t(key, {}, language);
}
