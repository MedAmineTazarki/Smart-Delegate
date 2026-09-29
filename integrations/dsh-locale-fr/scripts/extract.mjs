#!/usr/bin/env node
// Extract every English UI dictionary registered through ctx.locale.register
// in a DeepSeek Harness checkout, keyed by namespace.
//
//   node --experimental-strip-types scripts/extract.mjs <harness-checkout> <out.json>
//
// Reads the TypeScript sources directly (Node type stripping); no build.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, out] = process.argv.slice(2);
if (!root || !out) {
  console.error("usage: extract.mjs <harness-checkout> <out.json>");
  process.exit(2);
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "tests" || name === "lib" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
  return files;
}

function importPath(file, id) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if ((alias ?? orig) === id && m[2].startsWith(".")) return { path: resolve(dirname(file), m[2]), name: orig };
    }
  }
  return null;
}

function constValue(file, id, depth = 0) {
  const src = readFileSync(file, "utf8");
  const m = new RegExp(`(?:export\\s+)?const\\s+${id}\\s*(?::[^=]+)?=\\s*'([^']+)'`).exec(src);
  if (m) return m[1];
  if (depth > 2) return null;
  const imp = importPath(file, id);
  return imp ? constValue(imp.path, imp.name, depth + 1) : null;
}

/**
 * When a locale module cannot be imported (it imports an unbuilt workspace
 * package), evaluate just its `export const <name> = { ... }` literal,
 * resolving `...spread` identifiers from their own (importable) modules.
 */
async function literalFallback(file, name) {
  const src = readFileSync(file, "utf8");
  const start = src.search(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{`));
  if (start === -1) throw new Error(`no literal for ${name}`);
  const open = src.indexOf("{", src.indexOf("=", start));
  let depth = 0;
  let end = open;
  for (; end < src.length; end += 1) {
    if (src[end] === "{") depth += 1;
    if (src[end] === "}" && --depth === 0) break;
  }
  const body = src.slice(open, end + 1);
  const scope = {};
  for (const m of body.matchAll(/\.\.\.([A-Za-z_]\w*)/g)) {
    const imp = importPath(file, m[1]);
    if (!imp) throw new Error(`cannot resolve spread ${m[1]}`);
    scope[m[1]] = (await import(pathToFileURL(imp.path).href))[imp.name];
  }
  return new Function(...Object.keys(scope), `return (${body});`)(...Object.values(scope));
}

const dictionaries = {};
const problems = [];
for (const file of walk(join(root, "packages")).concat(walk(join(root, "apps")))) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/locale\.register\(\s*([^,]+?)\s*,\s*(\{[^}]*\}|[A-Za-z_]+)\s*\)/g)) {
    const nsExpr = m[1].trim();
    const ns = /^'.*'$/.test(nsExpr) ? nsExpr.slice(1, -1) : constValue(file, nsExpr);
    let enId = null;
    const dict = m[2];
    const pair = /en\s*:\s*([A-Za-z_]\w*)/.exec(dict);
    if (pair) enId = pair[1];
    else if (/\ben\b/.test(dict)) enId = "en";
    if (!ns || !enId) {
      problems.push(`${file}: cannot resolve register(${nsExpr}, ${dict})`);
      continue;
    }
    const imp = importPath(file, enId);
    const modulePath = imp ? imp.path : file;
    const exportName = imp ? imp.name : enId;
    try {
      let value;
      try {
        value = (await import(pathToFileURL(modulePath).href))[exportName];
      } catch {
        value = await literalFallback(modulePath, exportName);
      }
      if (!value || typeof value !== "object") throw new Error(`export ${exportName} not an object`);
      dictionaries[ns] = { ...(dictionaries[ns] ?? {}), ...value };
    } catch (error) {
      problems.push(`${ns} (${modulePath}): ${error.message.split("\n")[0]}`);
    }
  }
}
// The shared "common" namespace ships in the locale package itself.
const common = await import(pathToFileURL(join(root, "packages/client/locale/src/locales/en.ts")).href);
dictionaries.common = { ...(dictionaries.common ?? {}), ...common.en };

const count = Object.values(dictionaries).reduce((n, d) => n + Object.keys(d).length, 0);
writeFileSync(out, `${JSON.stringify(dictionaries, null, 2)}\n`);
console.log(`${Object.keys(dictionaries).length} namespaces, ${count} strings -> ${out}`);
for (const p of problems) console.error(`warning: ${p}`);
