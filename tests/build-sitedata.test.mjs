import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { REQUIRED_APK_ROOTS } from "../scripts/apk-ledger.mjs";
import {
  BuildConflictError,
  GENERATED_METADATA_FILES,
  applyBuildPlan,
  createBuildPlan,
  resolveServerRoot,
  scanBuildInputs,
  selectCandidates,
} from "../scripts/build-sitedata.mjs";

test("generated metadata root contract includes both character v2 files", () => {
  assert.deepEqual(GENERATED_METADATA_FILES, [
    "asset-index.json",
    "build-report.json",
    "character-assets.json",
    "character-index.json",
    "README.md",
  ]);
});

test("server roots parse ImageData exactly and later generations win", () => {
  assert.equal(resolveServerRoot("ImageDataServer").outputGroup, "ImageData");
  assert.equal(resolveServerRoot("ImageServer").outputGroup, "Image");
  assert.ok(resolveServerRoot("XImageDataServer").priority > resolveServerRoot("WImageDataServer").priority);
  assert.ok(resolveServerRoot("AImageServer").priority > resolveServerRoot("ImageServer").priority);
  assert.throws(() => resolveServerRoot("AServer"), /Unsupported server raw root/);
});

test("Local is the base and server applies from unprefixed through A to Z", async () => {
  const fixture = await createFixture();
  await writeAsset(fixture.apkRoot, "assets/ImageLocal.pack", "apk-pack");
  await writeAsset(fixture.apkRoot, "ImageLocal/shared.png", "local");
  await writeAsset(fixture.apkRoot, "ImageDataLocal/007_f.imgcut", "local-cut");
  await writeAsset(fixture.apkRoot, "resLocal/Enemyname.tsv", "names");
  await writeAsset(fixture.serverRoot, "ImageServer/shared.png", "base");
  await writeAsset(fixture.serverRoot, "AImageServer/shared.png", "a");
  await writeAsset(fixture.serverRoot, "XImageServer/shared.png", "x");
  await writeAsset(fixture.serverRoot, "WImageDataServer/007_f.imgcut", "server-cut");

  const candidates = await scanBuildInputs(fixture);
  const plan = await createBuildPlan({ candidates });
  const shared = plan.selected.find(candidate => candidate.outputPath === "Image/shared.png");
  assert.equal(shared.sourceRoot, "XImageServer");
  assert.equal(plan.overwrites.filter(item => item.path === "Image/shared.png").length, 3);
  assert.equal(plan.selected.find(item => item.outputPath.startsWith("assets/")).sourceKind, "apk");
});

test("same-priority different content is an unresolved collision", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "sitedata-collision-"));
  const leftPath = path.join(temporaryRoot, "left.bin");
  const rightPath = path.join(temporaryRoot, "right.bin");
  await writeFile(leftPath, "left");
  await writeFile(rightPath, "right");
  const base = {
    outputPath: "Image/same.bin",
    size: 4,
    priority: 101,
    sourceKind: "server",
    sourceRoot: "AImageServer",
    generation: "A",
  };
  const result = await selectCandidates([
    { ...base, sourcePath: leftPath, sourceRepoPath: "left.bin" },
    { ...base, sourcePath: rightPath, sourceRepoPath: "right.bin", size: 5 },
  ], candidate => candidate.outputPath);
  assert.equal(result.collisions.length, 1);

  await assert.rejects(
    () => createBuildPlan({ candidates: [
      { ...base, sourcePath: leftPath, sourceRepoPath: "left.bin", family: null },
      { ...base, sourcePath: rightPath, sourceRepoPath: "right.bin", size: 5, family: null },
    ] }),
    BuildConflictError,
  );
});

test("generated output and indexes are deterministic", async () => {
  const fixture = await createFixture();
  await writeAsset(fixture.apkRoot, "assets/base.pack", "base");
  await writeAsset(fixture.apkRoot, "ImageDataLocal/007_f.png", "sprite");
  await writeAsset(fixture.apkRoot, "DataLocal/unit001.csv", "stats // このコメント名は使わない");
  await writeAsset(fixture.apkRoot, "resLocal/Unit_Explanation1_ja.csv", "ネコ,説明一,説明二,　,,\n");
  const plan = await createBuildPlan({
    candidates: await scanBuildInputs(fixture),
  });
  const versionRecord = { versionName: "15.5.1", versionCode: 1505010 };
  const firstOutput = path.join(fixture.repoRoot, "first");
  const secondOutput = path.join(fixture.repoRoot, "second");
  await applyBuildPlan({
    plan,
    versionRecord,
    outputRoot: firstOutput,
    inputRoots: [fixture.apkRoot, fixture.serverRoot],
    concurrency: 2,
  });
  await applyBuildPlan({
    plan,
    versionRecord,
    outputRoot: secondOutput,
    inputRoots: [fixture.apkRoot, fixture.serverRoot],
    concurrency: 2,
  });
  for (const indexName of ["asset-index.json", "build-report.json", "character-assets.json", "character-index.json", "README.md"]) {
    assert.equal(
      await readFile(path.join(firstOutput, indexName), "utf8"),
      await readFile(path.join(secondOutput, indexName), "utf8"),
    );
  }
  const characterIndex = JSON.parse(await readFile(path.join(firstOutput, "character-index.json"), "utf8"));
  assert.equal(Object.keys(characterIndex)[0], "gameVersion");
  assert.equal(characterIndex.schemaVersion, 2);
  assert.equal(characterIndex.units[0].id, "000");
  assert.equal(characterIndex.units[0].forms[0].name, "ネコ");
  const characterAssetsSource = await readFile(path.join(firstOutput, "character-assets.json"), "utf8");
  assert.equal(characterAssetsSource.includes("\n  \""), false);
  const readme = await readFile(path.join(firstOutput, "README.md"));
  assert.deepEqual([...readme.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

function candidate(outputPath, family) {
  return { outputPath, family };
}

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "sitedata-build-"));
  const apkRoot = path.join(repoRoot, "jp", "apks", "150501");
  const serverRoot = path.join(repoRoot, "jp", "server");
  for (const rootName of REQUIRED_APK_ROOTS) {
    await mkdir(path.join(apkRoot, rootName), { recursive: true });
  }
  await mkdir(serverRoot, { recursive: true });
  return { repoRoot, apkRoot, serverRoot };
}

async function writeAsset(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
