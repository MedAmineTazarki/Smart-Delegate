import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { captureBaseline, compareToBaseline, diffForPaths, outOfScope } from "../../src/git/git.mjs";
import { git, makeRepo, tempDir, writeFiles } from "../helpers/env.mjs";

const FILES = { "README.md": "# demo\n", "src/app.js": "export const a = 1;\n", "src/util.js": "export const u = 1;\n" };

describe("git safety", () => {
  it("clean repository: baseline is clean, worker change attributed", () => {
    const repo = makeRepo(FILES);
    assert.ok(repo.includes(" "), "test repo path contains a space");
    const base = captureBaseline(repo);
    assert.deepEqual(base.dirty, {});
    assert.ok(base.head);
    assert.equal(base.branch, "main");
    writeFileSync(join(repo, "src/app.js"), "export const a = 2;\n");
    const cmp = compareToBaseline(base);
    assert.deepEqual(cmp.workerChanges.map((c) => [c.path, c.kind]), [["src/app.js", "modified"]]);
    assert.equal(cmp.userWorkSafe, true);
  });

  it("dirty repository: pre-existing modified and untracked files are preserved and not attributed to the worker", () => {
    const repo = makeRepo(FILES);
    writeFileSync(join(repo, "README.md"), "# user edit\n");
    writeFileSync(join(repo, "notes.txt"), "user notes\n");
    const base = captureBaseline(repo);
    assert.deepEqual(Object.keys(base.dirty).sort(), ["README.md", "notes.txt"]);
    writeFileSync(join(repo, "src/util.js"), "export const u = 2;\n");
    const cmp = compareToBaseline(base);
    assert.deepEqual(cmp.workerChanges.map((c) => c.path), ["src/util.js"]);
    assert.deepEqual(cmp.userChangesPreserved.sort(), ["README.md", "notes.txt"]);
    assert.equal(cmp.userWorkSafe, true);
    assert.equal(readFileSync(join(repo, "README.md"), "utf8"), "# user edit\n");
  });

  it("worker touching a file the user already modified is flagged", () => {
    const repo = makeRepo(FILES);
    writeFileSync(join(repo, "src/app.js"), "export const a = 'user';\n");
    const base = captureBaseline(repo);
    writeFileSync(join(repo, "src/app.js"), "export const a = 'user';\nexport const worker = 1;\n");
    const cmp = compareToBaseline(base);
    assert.deepEqual(cmp.userFilesTouched.map((t) => t.path), ["src/app.js"]);
    assert.equal(cmp.workerChanges.length, 0);
    assert.equal(cmp.userWorkSafe, false);
  });

  it("worker reverting a user change is flagged", () => {
    const repo = makeRepo(FILES);
    writeFileSync(join(repo, "src/app.js"), "export const a = 'user';\n");
    const base = captureBaseline(repo);
    writeFileSync(join(repo, "src/app.js"), FILES["src/app.js"]);
    const cmp = compareToBaseline(base);
    assert.deepEqual(cmp.userChangesReverted, ["src/app.js"]);
    assert.equal(cmp.userWorkSafe, false);
  });

  it("worker modifying an unrelated file is detected as out of scope", () => {
    const repo = makeRepo(FILES);
    const base = captureBaseline(repo);
    writeFileSync(join(repo, "src/app.js"), "export const a = 3;\n");
    writeFileSync(join(repo, "README.md"), "# changed by worker\n");
    const cmp = compareToBaseline(base);
    const paths = cmp.workerChanges.map((c) => c.path);
    assert.deepEqual(outOfScope(paths, ["src/app.js"]), ["README.md"]);
    assert.deepEqual(outOfScope(paths, ["src/"]), ["README.md"]);
    assert.deepEqual(outOfScope(paths, []), []);
  });

  it("worker deleting and adding files is detected, with a diff", () => {
    const repo = makeRepo(FILES);
    const base = captureBaseline(repo);
    rmSync(join(repo, "src/util.js"));
    writeFiles(repo, { "src/new file.js": "export const n = 1;\n" });
    const cmp = compareToBaseline(base);
    const kinds = Object.fromEntries(cmp.workerChanges.map((c) => [c.path, c.kind]));
    assert.equal(kinds["src/util.js"], "deleted");
    assert.equal(kinds["src/new file.js"], "untracked");
    const diff = diffForPaths(repo, cmp.workerChanges);
    assert.match(diff.patch, /deleted file mode|-export const u = 1;/);
    assert.match(diff.patch, /\+export const n = 1;/);
  });

  it("a worker commit moves HEAD and is reported", () => {
    const repo = makeRepo(FILES);
    const base = captureBaseline(repo);
    writeFileSync(join(repo, "src/app.js"), "export const a = 9;\n");
    git(repo, "commit", "-q", "-am", "worker commit");
    const cmp = compareToBaseline(base);
    assert.equal(cmp.headChanged, true);
    assert.deepEqual(cmp.committedByWorker, ["src/app.js"]);
    assert.equal(cmp.userWorkSafe, false);
  });

  it("repository without commits still works", () => {
    const repo = makeRepo({ "a.txt": "a\n" }, { commit: false });
    const base = captureBaseline(repo);
    assert.equal(base.head, null);
    writeFileSync(join(repo, "b.txt"), "b\n");
    const cmp = compareToBaseline(base);
    assert.deepEqual(cmp.workerChanges.map((c) => c.path), ["b.txt"]);
  });

  it("refuses a non-git directory", () => {
    assert.throws(() => captureBaseline(tempDir()), /not inside a git work tree/);
  });

  it("never runs destructive git commands (source audit)", () => {
    const src = readFileSync(new URL("../../src/git/git.mjs", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const bad of ['"reset"', '"clean"', '"checkout"', '"stash"', '"push"', '"commit"']) {
      assert.equal(src.includes(bad), false, `git.mjs invokes ${bad}`);
    }
  });
});
