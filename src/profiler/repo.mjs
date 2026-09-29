// Repository profiler: cheap metadata only (git ls-files + a handful of
// manifest reads). It never loads the codebase into memory.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { currentBranch, statusEntries } from "../git/git.mjs";

const LANGUAGES = {
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".py": "Python", ".rb": "Ruby", ".go": "Go",
  ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".swift": "Swift",
  ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".hpp": "C++", ".cs": "C#",
  ".php": "PHP", ".scala": "Scala", ".dart": "Dart", ".ex": "Elixir", ".exs": "Elixir",
  ".sql": "SQL", ".sh": "Shell", ".vue": "Vue", ".svelte": "Svelte",
};

const SENSITIVE_DIR = /(^|\/)(auth|authentication|login|oauth|sessions?|migrations?|db\/migrate|payments?|billing|checkout|stripe|invoices?|security|crypto|secrets?|deploy|infra|terraform|k8s|helm)$/i;

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md"];

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function detectFrameworks(root, pkg) {
  const found = new Set();
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const map = {
    react: "React", next: "Next.js", vue: "Vue", svelte: "Svelte", "@angular/core": "Angular",
    express: "Express", fastify: "Fastify", "@nestjs/core": "NestJS", vite: "Vite",
    electron: "Electron", "react-native": "React Native", prisma: "Prisma", "@prisma/client": "Prisma",
    typeorm: "TypeORM", sequelize: "Sequelize", "drizzle-orm": "Drizzle",
  };
  for (const [dep, name] of Object.entries(map)) if (dep in deps) found.add(name);
  const gradle = ["build.gradle", "build.gradle.kts", "app/build.gradle", "app/build.gradle.kts"]
    .map((f) => join(root, f))
    .filter(existsSync)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  if (/com\.android\.(application|library)/.test(gradle)) found.add("Android");
  if (/compose/i.test(gradle)) found.add("Jetpack Compose");
  if (/org\.springframework/.test(gradle) || existsSync(join(root, "pom.xml"))) {
    const pom = existsSync(join(root, "pom.xml")) ? readFileSync(join(root, "pom.xml"), "utf8") : "";
    if (/spring/.test(gradle + pom)) found.add("Spring");
  }
  const pyproject = existsSync(join(root, "pyproject.toml")) ? readFileSync(join(root, "pyproject.toml"), "utf8") : "";
  if (/django/i.test(pyproject)) found.add("Django");
  if (/fastapi/i.test(pyproject)) found.add("FastAPI");
  return [...found];
}

function detectTestFrameworks(root, pkg) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const found = ["jest", "vitest", "mocha", "ava", "@playwright/test", "cypress"].filter((d) => d in deps);
  const testScript = pkg?.scripts?.test ?? "";
  if (/node --test/.test(testScript)) found.push("node:test");
  if (existsSync(join(root, "pytest.ini")) || /pytest/.test(safeRead(join(root, "pyproject.toml")))) found.push("pytest");
  if (/junit|testImplementation/.test(safeRead(join(root, "app/build.gradle")) + safeRead(join(root, "build.gradle")))) found.push("JUnit");
  return [...new Set(found)];
}

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function detectBuildSystems(root) {
  const checks = [
    ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"],
    ["package-lock.json", "npm"], ["gradlew", "gradle"], ["build.gradle", "gradle"], ["build.gradle.kts", "gradle"],
    ["pom.xml", "maven"], ["Cargo.toml", "cargo"], ["go.mod", "go"], ["Makefile", "make"],
    ["pyproject.toml", "python"], ["requirements.txt", "python"],
  ];
  const found = new Set();
  for (const [file, system] of checks) if (existsSync(join(root, file))) found.add(system);
  if (existsSync(join(root, "package.json")) && ![...found].some((s) => ["pnpm", "yarn", "bun"].includes(s))) found.add("npm");
  return [...found];
}

function detectMonorepo(root, pkg) {
  if (pkg?.workspaces) return true;
  if (["pnpm-workspace.yaml", "lerna.json", "turbo.json", "nx.json"].some((f) => existsSync(join(root, f)))) return true;
  const settings = safeRead(join(root, "settings.gradle")) + safeRead(join(root, "settings.gradle.kts"));
  return (settings.match(/include\s*\(?\s*["']/g) ?? []).length > 1;
}

function detectCi(root) {
  const ci = [];
  const workflows = join(root, ".github", "workflows");
  try {
    for (const f of readdirSync(workflows)) if (/\.ya?ml$/.test(f)) ci.push(`.github/workflows/${f}`);
  } catch {
    // no GitHub workflows
  }
  for (const f of [".gitlab-ci.yml", ".circleci/config.yml", "azure-pipelines.yml", "Jenkinsfile", "bitbucket-pipelines.yml"]) {
    if (existsSync(join(root, f))) ci.push(f);
  }
  return ci;
}

/**
 * @param {string} root repository root
 * @returns {object} repository profile (metadata only)
 */
export function profileRepo(root) {
  const files = listFiles(root);
  const langCounts = {};
  const dirs = new Set();
  let sizeBytes = 0;
  let sized = 0;
  for (const file of files) {
    const lang = LANGUAGES[extname(file).toLowerCase()];
    if (lang) langCounts[lang] = (langCounts[lang] ?? 0) + 1;
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
    if (sized < 20_000) {
      try {
        sizeBytes += statSync(join(root, file)).size;
        sized += 1;
      } catch {
        // deleted but still indexed
      }
    }
  }
  const pkg = readJsonSafe(join(root, "package.json"));
  let dirtyCount = null;
  try {
    dirtyCount = statusEntries(root).size;
  } catch {
    // git status failed; leave unknown
  }
  const languages = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, files: count }));
  const sensitiveAreas = [...dirs].filter((d) => SENSITIVE_DIR.test(d)).sort().slice(0, 50);
  return {
    root,
    fileCount: files.length,
    sizeBytes: sized === files.length ? sizeBytes : Math.round((sizeBytes / Math.max(sized, 1)) * files.length),
    sizeEstimated: sized !== files.length,
    languages: languages.slice(0, 8),
    primaryLanguage: languages[0]?.name ?? null,
    frameworks: detectFrameworks(root, pkg),
    buildSystems: detectBuildSystems(root),
    testFrameworks: detectTestFrameworks(root, pkg),
    monorepo: detectMonorepo(root, pkg),
    branch: currentBranch(root),
    dirtyFiles: dirtyCount,
    instructionFiles: INSTRUCTION_FILES.filter((f) => existsSync(join(root, f))),
    ciFiles: detectCi(root),
    sensitiveAreas,
  };
}
