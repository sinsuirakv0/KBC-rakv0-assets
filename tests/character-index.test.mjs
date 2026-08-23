import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertLegacyCharacterIndexMigratable,
  collectCharacterIndexFiles,
  createCharacterOutputs,
  decodeAllCharacterAssetPaths,
  decodeCharacterAssetPaths,
  discoverUnitAssetPaths,
  serializeCharacterAssets,
  serializeCharacterIndex,
  verifyCharacterOutputs,
} from "../scripts/build-character-index.mjs";

const VERSION = { versionName: "15.5.1", versionCode: 1505010 };
const EMPTY_OVERRIDES = { schemaVersion: 1, units: {} };

test("array schemaはJSON parse後も000・099・100・872の連続順を保つ", () => {
  const ids = Array.from({ length: 873 }, (_, index) => String(index).padStart(3, "0"));
  const indexSource = serializeCharacterIndex({
    gameVersion: "1.0.0",
    versionCode: 1,
    schemaVersion: 2,
    units: ids.map(id => ({ id, forms: [{ name: id, description: "" }], aliases: [] })),
  });
  const assetsSource = serializeCharacterAssets({
    gameVersion: "1.0.0",
    versionCode: 1,
    schemaVersion: 1,
    pathRuleVersion: 1,
    pathTemplates: {},
    derivedTemplates: {},
    units: ids.map(id => ({ id })),
  });
  for (const source of [indexSource, assetsSource]) {
    const parsedIds = JSON.parse(source).units.map(unit => unit.id);
    assert.equal(parsedIds.length, 873);
    assert.equal(parsedIds[0], "000");
    assert.equal(parsedIds[99], "099");
    assert.equal(parsedIds[100], "100");
    assert.equal(parsedIds.at(-1), "872");
  }
});

test("v2 indexはID昇順array・形態順・unit-level aliasesだけを持つ", async () => {
  const root = await createFixture();
  await write(root, "Data/unit001.csv", "1,2,3 // Data側のネコ名は参照しない\n");
  await write(root, "res/Unit_Explanation1_ja.csv", [
    "// コメント形態,収録しない,,,,",
    "# コメント形態,収録しない,,,,",
    "; コメント形態,収録しない,,,,",
    '第一形態,"説明,一",説明二,　,,',
    "第二形態,本文//は残す,説明二,説明三,ダイニケイタイ,",
    "第二形態,重複以降は未実装,説明二,説明三,混入しない,",
  ].join("\r\n"));
  await write(root, "Data/unit002.csv", "// 精霊ではない\n");
  await write(root, "res/Unit_Explanation2_ja.csv", "800-1,精霊：説明,続き,　,セイレイ,\n");
  await write(root, "Data/unit003.csv", "// 名前候補\n");
  await write(root, "res/Unit_Explanation3_ja.csv", [
    "一,d1,d2,d3,",
    "二,d1,d2,d3,ニ,",
    "三,d1,d2,d3,,",
    "四,d1,d2,d3,ヨン,",
  ].join("\n"));

  const output = await build(root);
  assert.deepEqual(output.characterIndex.units.map(unit => unit.id), ["000", "001", "002"]);
  assert.deepEqual(output.characterIndex.units[0], {
    id: "000",
    forms: [
      { name: "第一形態", description: "説明,一説明二" },
      { name: "第二形態", description: "本文//は残す説明二説明三" },
    ],
    aliases: [],
  });
  assert.equal(output.characterIndex.units[0].forms.some(form => form.name.includes("Data側")), false);
  assert.equal(output.characterIndex.units[1].forms[0].name, "精霊");
  assert.equal(output.characterIndex.units[2].forms.length, 4);
  assert.ok(output.characterIndex.units.every(unit => unit.aliases.length === 0));
  assert.equal(JSON.stringify(output.characterAssets).includes("第一形態"), false);
  assert.equal(JSON.stringify(output.characterAssets).includes("ダイニケイタイ"), false);
});

test("anchored matcherと圧縮assetsは全effective pathをlossless復元する", async () => {
  const root = await createFixture();
  await write(root, "Data/unit001.csv", "0 // 無視\n");
  await write(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,,\n");
  for (const relativePath of [
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
  ]) await write(root, relativePath, relativePath);

  const output = await build(root);
  const expected = [
    "Data/unit001.csv",
    "Download/download_char_000_walkR.maanim",
    "Image/gatyachara_000_f.png",
    "ImageData/000_c.imgcut",
    "ImageData/000_g02_1.maanim",
    "ImageData/udi000_s_ja.imgcut",
    "Unit/udi000_g.png",
    "Unit/uni000_c00.png",
    "res/Unit_Explanation1_ja.csv",
  ];
  assert.deepEqual(output.effectivePathsByUnit["000"], expected);
  assert.deepEqual(decodeCharacterAssetPaths(output.characterAssets, "000"), expected);
  assert.deepEqual(decodeAllCharacterAssetPaths(output.characterAssets), { "000": expected });
  assert.equal(expected.some(value => /stamp|img044|bank|0000/.test(value)), false);

  const discovered = discoverUnitAssetPaths({
    filePaths: new Set((await collectCharacterIndexFiles(root)).map(file => file.relativePath)),
    unitId: 0,
    sourceId: 1,
    explanationPath: "res/Unit_Explanation1_ja.csv",
    dataPath: "Data/unit001.csv",
  });
  assert.deepEqual(discovered, expected);
});

test("外部overrideの手動aliasを保持し新assetを自動反映する", async () => {
  const root = await createFixture();
  await write(root, "Data/unit001.csv", "0 // 無視\n");
  await write(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,ヨミ一,\n第二,d1,d2,d3,,\n");
  await write(root, "ImageData/000_c.imgcut", "c");
  await write(root, "Image/manual.png", "manual");
  const overrides = {
    schemaVersion: 1,
    units: {
      "000": {
        aliases: { include: ["手動別称"], exclude: [] },
        paths: { include: ["Image/manual.png"], exclude: ["ImageData/000_c.imgcut"] },
      },
    },
  };
  const first = await build(root, overrides);
  await write(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,ヨミ一,\n第二,d1,d2,d3,新規読み,\n");
  await write(root, "ImageData/000_f.imgcut", "f");
  const second = await build(root, overrides);

  assert.deepEqual(first.characterIndex.units[0].aliases, ["手動別称"]);
  assert.deepEqual(second.characterIndex.units[0].aliases, ["手動別称"]);
  const paths = decodeCharacterAssetPaths(second.characterAssets, "000");
  assert.ok(paths.includes("Image/manual.png"));
  assert.ok(paths.includes("ImageData/000_f.imgcut"));
  assert.equal(paths.includes("ImageData/000_c.imgcut"), false);
  assert.deepEqual(await build(root, overrides), second);
  await assert.rejects(() => build(root, {
    schemaVersion: 1,
    units: { "000": { aliases: { include: [], exclude: ["冗長"] } } },
  }), /redundant/);
});

test("manual include missingは失敗しexclude missingは将来用に許可する", async () => {
  const root = await createFixture();
  await write(root, "Data/unit001.csv", "0\n");
  await write(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,,\n");
  await assert.rejects(() => build(root, {
    schemaVersion: 1,
    units: { "000": { paths: { include: ["Image/missing.png"], exclude: [] } } },
  }), /include path does not exist/);

  const output = await build(root, {
    schemaVersion: 1,
    units: { "000": { paths: { include: [], exclude: ["Image/future.png"] } } },
  });
  assert.deepEqual(decodeCharacterAssetPaths(output.characterAssets, "000"), [
    "Data/unit001.csv",
    "res/Unit_Explanation1_ja.csv",
  ]);
  await assert.rejects(() => build(root, {
    schemaVersion: 1,
    units: { "000": { paths: { include: [], exclude: ["../future.png"] } } },
  }), /Unsafe sitedata-relative path/);
});

test("derived path除外とstandard外exact pathもroundtripする", async () => {
  const root = await createFixture();
  await write(root, "Data/unit001.csv", "0\n");
  await write(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,,\n");
  await write(root, "Image/manual.png", "manual");
  const output = await build(root, {
    schemaVersion: 1,
    units: {
      "000": {
        paths: {
          include: ["Image/manual.png"],
          exclude: ["Data/unit001.csv"],
        },
      },
    },
  });
  assert.deepEqual(output.characterAssets.units[0].omit, ["data"]);
  assert.deepEqual(output.characterAssets.units[0].x, ["Image/manual.png"]);
  assert.deepEqual(decodeCharacterAssetPaths(output.characterAssets, "000"), [
    "Image/manual.png",
    "res/Unit_Explanation1_ja.csv",
  ]);
});

test("verifierはraw+overrideから独立再計算しv1 manualを黙って捨てない", async () => {
  const root = await createFixture();
  await write(root, "Data/unit001.csv", "0\n");
  await write(root, "res/Unit_Explanation1_ja.csv", "第一,d1,d2,d3,,\n");
  const files = await collectCharacterIndexFiles(root);
  const output = await createCharacterOutputs({ versionRecord: VERSION, files, overrides: EMPTY_OVERRIDES });
  await verifyCharacterOutputs({
    actualIndex: output.characterIndex,
    actualAssets: output.characterAssets,
    versionRecord: VERSION,
    files,
    overrides: EMPTY_OVERRIDES,
  });
  const stale = structuredClone(output.characterAssets);
  stale.units[0].x = ["Image/fake.png"];
  await assert.rejects(() => verifyCharacterOutputs({
    actualIndex: output.characterIndex,
    actualAssets: stale,
    versionRecord: VERSION,
    files,
    overrides: EMPTY_OVERRIDES,
  }), /stale or invalid|asset codes/);

  const legacy = {
    schemaVersion: 1,
    units: [{
      id: "000",
      aliases: ["手動"],
      discoveredAliases: [],
      aliasManual: { include: ["手動"], exclude: [] },
      assets: {
        paths: ["Data/unit001.csv"],
        discoveredPaths: ["Data/unit001.csv"],
        manual: { include: [], exclude: [] },
      },
    }],
  };
  assert.throws(() => assertLegacyCharacterIndexMigratable(legacy), /migration/);
  legacy.units[0].aliases = [];
  legacy.units[0].aliasManual.include = [];
  assert.doesNotThrow(() => assertLegacyCharacterIndexMigratable(legacy));
});

async function build(root, overrides = EMPTY_OVERRIDES) {
  return createCharacterOutputs({
    versionRecord: VERSION,
    files: await collectCharacterIndexFiles(root),
    overrides,
  });
}

async function createFixture() {
  return mkdtemp(path.join(os.tmpdir(), "character-v2-"));
}

async function write(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
