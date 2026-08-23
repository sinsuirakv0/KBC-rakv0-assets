import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_MISMATCHES,
  stageCanonicalPayloads,
} from "../scripts/stage-canonical-payloads.mjs";

const stageScript = path.resolve("scripts/stage-canonical-payloads.mjs");
const auditScript = path.resolve("scripts/verify-git-payloads.mjs");
const SAMPLE_PAYLOADS = Object.freeze([
  ["jp/apks/150501/mixed.csv", Buffer.from("first\r\nsecond\nthird\r\n", "utf8")],
  ["jp/server/server.bin", Buffer.from([0, 13, 10, 255, 10, 0], "binary")],
  ["jp/sitedata/Data/AbilityLimit.csv", Buffer.from("one\r\ntwo\n", "utf8")],
]);
const LIMIT_PAYLOADS = Object.freeze([
  ["jp/apks/150501/one.txt", Buffer.from("one\r\n", "utf8")],
  ["jp/server/two.txt", Buffer.from("two\r\n", "utf8")],
  ["jp/sitedata/Data/three.txt", Buffer.from("three\r\n", "utf8")],
]);

function runGit(repositoryRoot, args, input) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    input,
    encoding: "buffer",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

async function writePayloads(repositoryRoot, payloads) {
  const directories = [...new Set(
    payloads.map(([relativePath]) => path.dirname(
      path.join(repositoryRoot, ...relativePath.split("/")),
    )),
  )];
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
  await Promise.all(payloads.map(async ([relativePath, content]) => {
    const filePath = path.join(repositoryRoot, ...relativePath.split("/"));
    await writeFile(filePath, content);
  }));
}

async function createHistoricalFixture(payloads = SAMPLE_PAYLOADS) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "stage-canonical-payloads-"));
  const payloadRoots = [...new Set(payloads.map(([relativePath]) => relativePath.split("/").slice(0, 2).join("/")))];
  await writePayloads(repositoryRoot, payloads);
  runGit(repositoryRoot, ["init", "-q"]);
  runGit(repositoryRoot, ["config", "user.name", "git-payload-stage-test"]);
  runGit(repositoryRoot, ["config", "user.email", "git-payload-stage-test@example.invalid"]);
  runGit(repositoryRoot, ["config", "core.autocrlf", "true"]);
  runGit(repositoryRoot, ["add", "jp"]);
  runGit(repositoryRoot, ["commit", "-qm", "historical payload"]);
  await writeFile(path.join(repositoryRoot, ".gitattributes"), [
    "jp/apks/** -text",
    "jp/server/** -text",
    "jp/sitedata/** -text",
    "",
  ].join("\n"), "utf8");
  runGit(repositoryRoot, ["add", ".gitattributes"]);
  runGit(repositoryRoot, ["add", "--", ...payloadRoots]);
  runGit(repositoryRoot, ["reset", "--", ...payloadRoots]);
  return repositoryRoot;
}

function runNodeScript(repositoryRoot, scriptPath) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

function stagedPaths(repositoryRoot, root = null) {
  const args = ["diff", "--cached", "--name-only"];
  if (root) args.push("--", root);
  return runGit(repositoryRoot, args).toString("utf8").trim().split(/\r?\n/u).filter(Boolean);
}

async function withFixture(callback, payloads = SAMPLE_PAYLOADS) {
  const repositoryRoot = await createHistoricalFixture(payloads);
  try {
    return await callback(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("stages canonical mixed-EOL blobs without editing working files or unstaging code", async () => {
  await withFixture(async (repositoryRoot) => {
    const codePath = path.join(repositoryRoot, "docs", "keep.js");
    await mkdir(path.dirname(codePath), { recursive: true });
    await writeFile(codePath, "export const kept = true;\n", "utf8");
    runGit(repositoryRoot, ["add", "docs/keep.js"]);
    const codeBlobBefore = runGit(repositoryRoot, ["rev-parse", ":docs/keep.js"]).toString("utf8").trim();
    const workingBefore = await Promise.all(SAMPLE_PAYLOADS.map(async ([relativePath]) => [
      relativePath,
      await readFile(path.join(repositoryRoot, ...relativePath.split("/"))),
    ]));

    const beforeAudit = runNodeScript(repositoryRoot, auditScript);
    assert.notEqual(beforeAudit.status, 0);
    const result = runNodeScript(repositoryRoot, stageScript);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "2");
    assert.equal(result.stderr, "");

    const afterAudit = runNodeScript(repositoryRoot, auditScript);
    assert.equal(afterAudit.status, 0, afterAudit.stderr);
    assert.equal(runGit(repositoryRoot, ["rev-parse", ":docs/keep.js"]).toString("utf8").trim(), codeBlobBefore);
    assert.deepEqual(stagedPaths(repositoryRoot, "docs/keep.js"), ["docs/keep.js"]);
    for (const [relativePath, before] of workingBefore) {
      assert.deepEqual(await readFile(path.join(repositoryRoot, ...relativePath.split("/"))), before, relativePath);
      assert.deepEqual(runGit(repositoryRoot, ["show", `:${relativePath}`]), before, relativePath);
    }
  });
});

test("historical proof mismatch fails before index update", async () => {
  await withFixture(async (repositoryRoot) => {
    const target = path.join(repositoryRoot, ...SAMPLE_PAYLOADS[2][0].split("/"));
    const tampered = Buffer.from("different\r\ncontent\n", "utf8");
    await writeFile(target, tampered);
    const result = runNodeScript(repositoryRoot, stageScript);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /historical proof/);
    assert.doesNotMatch(result.stderr, /AbilityLimit|different|content/);
    assert.deepEqual(stagedPaths(repositoryRoot, "jp/sitedata"), []);
    assert.deepEqual(await readFile(target), tampered);
  });
});

test("configured mismatch limit rejects before proof or index update", async () => {
  assert.equal(MAX_MISMATCHES, 5_000);
  await withFixture(async (repositoryRoot) => {
    assert.throws(
      () => stageCanonicalPayloads(repositoryRoot, { maxMismatches: 2 }),
      /more content mismatches/,
    );
    assert.deepEqual(stagedPaths(repositoryRoot, "jp/apks"), []);
    assert.deepEqual(stagedPaths(repositoryRoot, "jp/server"), []);
    assert.deepEqual(stagedPaths(repositoryRoot, "jp/sitedata"), []);
  }, LIMIT_PAYLOADS);
});
