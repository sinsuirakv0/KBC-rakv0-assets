import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectCharacterIndexFiles,
  createCharacterIndex,
  discoverUnitAssetPaths,
  verifyCharacterIndex,
} from "../scripts/build-character-index.mjs";

const VERSION = { versionName: "15.5.1", versionCode: 1505010 };

test("Unit_Explanationだけから形態・説明・source aliasを抽出する", async () => {
  const root = await createCharacterFixture();
  await writeFixture(root, "Data/unit001.csv", "1,2,3 // Data側のネコ名は参照しない\n");
  await writeFixture(root, "res/Unit_Explanation1_ja.csv", [
    "// コメント形態,収録しない,,,,",
    "# コメント形態,収録しない,,,,",
    "; コメント形態,収録しない,,,,",
    '第一形態,"説明,一",説明二,　,,',
    "第二形態,本文//は残す,説明二,説明三,ダイニケイタイ,",
    "第二形態,重複以降は未実装,説明二,説明三,混入しない,",
    "第三形態,収録しない,,,,",
    "",
  ].join("\r\n"));
  await writeFixture(root, "Data/unit002.csv", "// 精霊ではない\n");
  await writeFixture(root, "res/Unit_Explanation2_ja.csv", [
    "800-1,精霊：説明,続き,　,セイレイ,",
    "",
  ].join("\n"));
  await writeFixture(root, "Data/unit003.csv", "// 名前候補A // 名前候補B\n");
  await writeFixture(root, "res/Unit_Explanation3_ja.csv", [
    "一,d1,d2,d3,",
    "二,d1,d2,d3,ニ,",
    "三,d1,d2,d3,,",
    "四,d1,d2,d3,ヨン,",
    "",
  ].join("\n"));

  const index = await buildFromRoot(root);
  assert.deepEqual(index.units.map(unit => unit.id), ["000", "001", "002"]);
  assert.deepEqual(index.units[0].forms, [
    { index: 0, name: "第一形態", description: "説明,一説明二" },
    { index: 1, name: "第二形態", description: "本文//は残す説明二説明三" },
  ]);
  assert.deepEqual(index.units[0].discoveredAliases, ["ダイニケイタイ"]);
  assert.deepEqual(index.units[0].aliases, ["ダイニケイタイ"]);
  assert.equal(index.units[0].forms.some(form => form.description.includes("ダイニケイタイ")), false);
  assert.equal(index.units[0].forms.some(form => form.name.includes("Data側")), false);
  assert.equal(index.units[1].forms[0].name, "精霊");
  assert.equal(index.units[1].forms[0].description, "精霊：説明続き");
  assert.ok(index.units[1].assets.paths.includes("Data/unit002.csv"));
  assert.equal(index.units[2].forms.length, 4);
  assert.deepEqual(index.units[2].discoveredAliases, ["ニ", "ヨン"]);
});

test("anchored asset matcherはキャラ固有pathだけを収録する", () => {
  const paths = new Set([
    "Data/unit001.csv",
    "res/Unit_Explanation1_ja.csv",
    "ImageData/000_c.imgcut",
    "ImageData/000_g02_1.maanim",
    "ImageData/udi000_s_ja.imgcut",
    "Unit/uni000_c00.png",
    "Unit/udi000_g.png",
    "Image/gatyachara_000_f.png",
    "Download/download_char_000_walkR.maanim",
    "ImageData/000_stamp_f.imgcut",
    "ImageData/000_img044_ja.imgcut",
    "Image/001_img044_ja.png",
    "Image/bank_000.png",
    "Download/download_char_0000.png",
  ]);
  assert.deepEqual(discoverUnitAssetPaths({
    filePaths: paths,
    unitId: 0,
    sourceId: 1,
    explanationPath: "res/Unit_Explanation1_ja.csv",
    dataPath: "Data/unit001.csv",
  }), [
    "Data/unit001.csv",
    "Download/download_char_000_walkR.maanim",
    "Image/gatyachara_000_f.png",
    "ImageData/000_c.imgcut",
    "ImageData/000_g02_1.maanim",
    "ImageData/udi000_s_ja.imgcut",
    "Unit/udi000_g.png",
    "Unit/uni000_c00.png",
    "res/Unit_Explanation1_ja.csv",
  ]);
});

test("aliasesとpathsの直接編集差分を保持し新規source/assetも自動追加する", async () => {
  const root = await createCharacterFixture();
  await writeFixture(root, "Data/unit001.csv", "0 // ネコ\n");
  await writeFixture(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,ヨミ一,\n第二,d1,d2,d3,,\n");
  await writeFixture(root, "ImageData/000_c.imgcut", "c");
  await writeFixture(root, "Image/manual.png", "manual");
  const first = await buildFromRoot(root);

  first.units[0].aliases = ["手動別称"];
  first.units[0].assets.paths = first.units[0].assets.paths
    .filter(value => value !== "ImageData/000_c.imgcut")
    .concat("Image/manual.png")
    .sort();
  await writeFixture(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,ヨミ一,\n第二,d1,d2,d3,新規読み,\n");
  await writeFixture(root, "ImageData/000_f.imgcut", "f");
  const second = await createCharacterIndex({
    versionRecord: VERSION,
    files: await collectCharacterIndexFiles(root),
    previousIndex: first,
  });

  assert.deepEqual(second.units[0].aliasManual, {
    include: ["手動別称"],
    exclude: ["ヨミ一"],
  });
  assert.deepEqual(second.units[0].aliases, ["手動別称", "新規読み"]);
  assert.deepEqual(second.units[0].assets.manual, {
    include: ["Image/manual.png"],
    exclude: ["ImageData/000_c.imgcut"],
  });
  assert.ok(second.units[0].assets.paths.includes("ImageData/000_f.imgcut"));
  assert.ok(second.units[0].assets.paths.includes("Image/manual.png"));
  assert.equal(second.units[0].assets.paths.includes("ImageData/000_c.imgcut"), false);

  const third = await createCharacterIndex({
    versionRecord: VERSION,
    files: await collectCharacterIndexFiles(root),
    previousIndex: second,
  });
  assert.deepEqual(third, second);
});

test("存在しない手動path、traversal、rawと異なるdiscoveredPathsはfail closed", async () => {
  const root = await createCharacterFixture();
  await writeFixture(root, "Data/unit001.csv", "0 // 無視\n");
  await writeFixture(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,,\n");
  const first = await buildFromRoot(root);
  const currentFiles = await collectCharacterIndexFiles(root);
  const missing = structuredClone(first);
  missing.units[0].assets.paths.push("Image/missing.png");
  await assert.rejects(() => createCharacterIndex({
    versionRecord: VERSION,
    files: currentFiles,
    previousIndex: missing,
  }), /does not exist/);

  const traversal = structuredClone(first);
  traversal.units[0].assets.paths.push("../secret.txt");
  await assert.rejects(() => createCharacterIndex({
    versionRecord: VERSION,
    files: currentFiles,
    previousIndex: traversal,
  }), /Unsafe sitedata-relative path/);

  await verifyCharacterIndex({ actual: first, versionRecord: VERSION, files: await collectCharacterIndexFiles(root) });
  const stale = structuredClone(first);
  stale.units[0].assets.discoveredPaths = stale.units[0].assets.discoveredPaths.slice(1);
  await assert.rejects(() => verifyCharacterIndex({
    actual: stale,
    versionRecord: VERSION,
    files: currentFiles,
  }), /discovered asset paths are stale/);
});

async function buildFromRoot(root, previousIndex = null) {
  return createCharacterIndex({
    versionRecord: VERSION,
    files: await collectCharacterIndexFiles(root),
    previousIndex,
  });
}

async function createCharacterFixture() {
  return mkdtemp(path.join(os.tmpdir(), "character-index-"));
}

async function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return readFile(filePath);
}
