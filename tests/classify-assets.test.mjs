import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyPlan,
  analyzeBattleSets,
  buildPlan,
  classifyAsset,
  deriveCategory,
  normalizeFilename,
  resolveServerRoot,
} from "../scripts/classify-assets.mjs";

test("unit battle files are grouped by unit ID and form", () => {
  assert.equal(
    classifyAsset({ filename: "872_f.png", sourceGroup: "number" }).relativePath,
    "units/872/f/sprite.png",
  );
  assert.equal(
    classifyAsset({ filename: "872_f.imgcut", sourceGroup: "image-data" }).relativePath,
    "units/872/f/cuts.imgcut",
  );
  assert.equal(
    classifyAsset({ filename: "872_f02.maanim", sourceGroup: "image-data" }).relativePath,
    "units/872/f/animations/02.maanim",
  );
});

test("unit UI files retain their searchable family", () => {
  const asset = classifyAsset({ filename: "uni872_f00.png", sourceGroup: "unit" });
  assert.equal(asset.relativePath, "units/872/f/thumbnail-00.png");
  assert.equal(asset.entityId, 872);
  assert.equal(asset.form, "f");
  assert.equal(
    classifyAsset({ filename: "udi871_s.png", sourceGroup: "unit" }).relativePath,
    "units/871/s/icon.png",
  );
  assert.equal(
    classifyAsset({ filename: "udi000_m01.png", sourceGroup: "unit" }).relativePath,
    "unit-assets/udi__m/udi000_m01.png",
  );
});

test("battle-set validation reports missing required files", () => {
  const completePaths = [
    "units/872/f/sprite.png",
    "units/872/f/cuts.imgcut",
    "units/872/f/model.mamodel",
    "units/872/f/animations/00.maanim",
    "units/872/f/animations/01.maanim",
    "units/872/f/animations/02.maanim",
    "units/872/f/animations/03.maanim",
  ];
  const complete = analyzeBattleSets(completePaths.map(relativePath => ({ relativePath })));
  assert.equal(complete.completeBattleSetCount, 1);
  assert.equal(complete.incompleteBattleSetCount, 0);

  const incomplete = analyzeBattleSets([{ relativePath: "units/871/s/sprite.png" }]);
  assert.equal(incomplete.incompleteBattleSetCount, 1);
  assert.ok(incomplete.incompleteBattleSets[0].missing.includes("cuts.imgcut"));
});

test("generic files use a stable digit-independent category", () => {
  assert.equal(deriveCategory("battle_soul_022.maanim"), "battle_soul");
  assert.equal(deriveCategory("img009_C_013.png"), "img__c");
  assert.equal(normalizeFilename("MapData_000__server-XMapServer.csv"), "MapData_000.csv");
  assert.equal(normalizeFilename("Enemyname__v15.5.1-resLocal.tsv"), "Enemyname.tsv");
});

test("newer server generations have higher priority", () => {
  assert.ok(resolveServerRoot("XNumberServer").priority > resolveServerRoot("WNumberServer").priority);
  assert.ok(resolveServerRoot("ANumberServer").priority > resolveServerRoot("NumberServer").priority);
});

test("the latest server generation overrides packaged local assets", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "asset-classifier-"));
  const serverRoot = path.join(temporaryRoot, "server");
  const localRoot = path.join(temporaryRoot, "local");
  const outputRoot = path.join(temporaryRoot, "output");

  await writeAsset(serverRoot, "XImageDataServer/872_f.imgcut", "server");
  await writeAsset(serverRoot, "XNumberServer/872_f.png", "png");
  await writeAsset(localRoot, "ImageDataLocal/872_f.imgcut", "local");
  await writeAsset(localRoot, "NumberLocal/872_f.png", "png");

  const plan = await buildPlan([
    { kind: "server", path: serverRoot },
    { kind: "local", path: localRoot },
  ]);
  assert.equal(plan.selected.length, 2);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.duplicates.length, 1);

  await applyPlan(plan, outputRoot, {
    verify: true,
    inputRoots: [serverRoot, localRoot],
  });
  assert.equal(await readFile(path.join(outputRoot, "units/872/f/cuts.imgcut"), "utf8"), "server");
  const manifest = JSON.parse(await readFile(path.join(outputRoot, "asset-index.json"), "utf8"));
  assert.equal(manifest.assetCount, 2);
  assert.equal(manifest.assets[0].sha256.length, 64);
});

test("unit metadata and related images join the same unit tree", () => {
  assert.equal(
    classifyAsset({ filename: "unit873.csv", sourceGroup: "data" }).relativePath,
    "units/872/stats.csv",
  );
  assert.equal(
    classifyAsset({ filename: "Unit_Explanation873_ja.csv", sourceGroup: "resource" }).relativePath,
    "units/872/names-ja.csv",
  );
  assert.equal(
    classifyAsset({ filename: "gatyachara_872_f.png", sourceGroup: "image" }).relativePath,
    "units/872/f/gacha.png",
  );
  assert.equal(
    classifyAsset({ filename: "729_e.mamodel", sourceGroup: "image-data" }).relativePath,
    "enemies/729/model.mamodel",
  );
});

async function writeAsset(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
