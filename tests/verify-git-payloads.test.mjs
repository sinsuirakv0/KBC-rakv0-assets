import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const auditScript = path.resolve("scripts/verify-git-payloads.mjs");
const payloadFiles = Object.freeze([
  ["jp/Local/150501/mixed.csv", Buffer.from("first\r\nsecond\nthird\r\n", "utf8")],
  ["jp/character-image-overrides/ImageData/875_f.imgcut", Buffer.from("imgcut\r\n", "utf8")],
  ["jp/server/server.bin", Buffer.from([0, 13, 10, 255, 10, 0], "binary")],
  ["jp/sitedata/Data/AbilityLimit.csv", Buffer.from("one\r\ntwo\n", "utf8")],
]);

function runGit(repositoryRoot, args, input) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    input,
    encoding: "buffer",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
}

async function createFixture() {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "git-payload-audit-"));
  await writeFile(path.join(repositoryRoot, ".gitattributes"), [
    "jp/Local/** -text",
    "jp/character-image-overrides/** -text",
    "jp/server/** -text",
    "jp/sitedata/** -text",
    "",
  ].join("\n"), "utf8");
  for (const [relativePath, content] of payloadFiles) {
    const filePath = path.join(repositoryRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  runGit(repositoryRoot, ["init", "-q"]);
  runGit(repositoryRoot, ["config", "user.name", "git-payload-test"]);
  runGit(repositoryRoot, ["config", "user.email", "git-payload-test@example.invalid"]);
  runGit(repositoryRoot, ["config", "core.autocrlf", "true"]);
  runGit(repositoryRoot, ["add", ".gitattributes", "jp"]);
  runGit(repositoryRoot, ["commit", "-qm", "fixture"]);
  return repositoryRoot;
}

function runAudit(repositoryRoot) {
  return spawnSync(process.execPath, [auditScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
}

async function withFixture(callback) {
  const repositoryRoot = await createFixture();
  try {
    return await callback(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("raw CRLF and mixed-EOL payload bytes are preserved in index blobs", async () => {
  await withFixture(async (repositoryRoot) => {
    const result = runAudit(repositoryRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /4 files across 4 roots/);
    for (const [relativePath, expected] of payloadFiles) {
      const actual = runGit(repositoryRoot, ["show", `HEAD:${relativePath}`]);
      assert.deepEqual(actual, expected, relativePath);
      assert.deepEqual(
        await readFile(path.join(repositoryRoot, ...relativePath.split("/"))),
        expected,
        relativePath,
      );
    }
  });
});

test("working-byte tampering is rejected without path or content leakage", async () => {
  await withFixture(async (repositoryRoot) => {
    const target = path.join(repositoryRoot, ...payloadFiles[2][0].split("/"));
    const secretLikeContent = "tampered-private-content\n";
    await writeFile(target, secretLikeContent, "utf8");
    const result = runAudit(repositoryRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Git payload audit/);
    assert.doesNotMatch(result.stderr, /AbilityLimit|tampered-private-content/);
  });
});

test("untracked payloads are rejected without listing their names", async () => {
  await withFixture(async (repositoryRoot) => {
    const untrackedPath = path.join(repositoryRoot, "jp", "server", "untracked-secret.bin");
    await writeFile(untrackedPath, "untracked-private-content", "utf8");
    const result = runAudit(repositoryRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /untracked payloads/);
    assert.doesNotMatch(result.stderr, /untracked-secret|untracked-private-content/);
  });
});
