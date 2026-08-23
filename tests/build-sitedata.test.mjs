import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { REQUIRED_APK_ROOTS } from "../scripts/apk-ledger.mjs";
import {
  BuildConflictError,
  applyBuildPlan,
  createBuildPlan,
  deriveLegacyPaths,
  deriveLegacyPath,
  resolveServerRoot,
  scanBuildInputs,
  selectCandidates,
} from "../scripts/build-sitedata.mjs";

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
  assert.equal(plan.motionAssets["units/007/f/cuts.imgcut"], "ImageData/007_f.imgcut");
  assert.equal(plan.motionAssets["number/f/imgcut/007_f.imgcut"], "ImageData/007_f.imgcut");
  assert.equal(
    plan.motionAssets["resources/enemyname/Enemyname.tsv"],
    "res/Enemyname.tsv",
  );
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

test("a duplicate legacy key that points to different raw paths fails closed", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "legacy-collision-"));
  const numberPath = path.join(temporaryRoot, "number.png");
  const imageDataPath = path.join(temporaryRoot, "image-data.png");
  await writeFile(numberPath, "same");
  await writeFile(imageDataPath, "same");
  const common = {
    size: 4,
    priority: 0,
    sourceKind: "apk",
    generation: "local",
    sourceRelativePath: "007_f.png",
  };
  const candidates = [
    {
      ...common,
      sourcePath: numberPath,
      sourceRepoPath: "NumberLocal/007_f.png",
      sourceRoot: "NumberLocal",
      outputPath: "Number/007_f.png",
      family: "number",
    },
    {
      ...common,
      sourcePath: imageDataPath,
      sourceRepoPath: "ImageDataLocal/007_f.png",
      sourceRoot: "ImageDataLocal",
      outputPath: "ImageData/007_f.png",
      family: "image-data",
    },
  ];
  await assert.rejects(
    () => createBuildPlan({ candidates }),
    error => error instanceof BuildConflictError && /different raw paths/.test(error.message),
  );
});

test("legacy mapping covers unit, enemy and resource contracts", () => {
  assert.deepEqual(
    deriveLegacyPaths(candidate("ImageData/872_f02.maanim", "image-data")),
    ["units/872/f/animations/02.maanim", "number/f/maanim/872_f02.maanim"],
  );
  assert.deepEqual(
    deriveLegacyPaths(candidate("Number/013_e.png", "number")),
    ["enemies/013/sprite.png"],
  );
  assert.equal(
    deriveLegacyPath(candidate("Unit/uni007_c00.png", "unit")),
    "units/007/c/thumbnail-00.png",
  );
  assert.equal(
    deriveLegacyPath(candidate("res/Enemyname.tsv", "resource")),
    "resources/enemyname/Enemyname.tsv",
  );
});

test("generated output and indexes are deterministic", async () => {
  const fixture = await createFixture();
  await writeAsset(fixture.apkRoot, "assets/base.pack", "base");
  await writeAsset(fixture.apkRoot, "ImageDataLocal/007_f.png", "sprite");
  await writeAsset(fixture.apkRoot, "DataLocal/unit8.csv", "stats");
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
  for (const indexName of ["asset-index.json", "motion-index.json", "build-report.json", "README.md"]) {
    assert.equal(
      await readFile(path.join(firstOutput, indexName), "utf8"),
      await readFile(path.join(secondOutput, indexName), "utf8"),
    );
  }
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
