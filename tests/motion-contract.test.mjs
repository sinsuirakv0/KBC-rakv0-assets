import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SAVE_APP_ASSET_KEYS,
  SAVE_APP_FORMS,
  resolveSaveAppLegacyPath,
  resolveSiteEnemyLegacyPath,
  resolveSiteUnitLegacyPath,
  verifyMotionConsumerContracts,
} from "../scripts/motion-contract.mjs";

test("save-app/lab resolver contract covers every form and asset key", () => {
  for (const form of SAVE_APP_FORMS) {
    for (const assetKey of SAVE_APP_ASSET_KEYS) {
      const path = resolveSaveAppLegacyPath("000", form, assetKey);
      assert.match(path, new RegExp(`^number/${form}/`));
    }
  }
  assert.equal(resolveSaveAppLegacyPath("000", "f", "image"), "number/f/png/000_f.png");
  assert.equal(
    resolveSaveAppLegacyPath("000", "f", "motion-3"),
    "number/f/maanim/000_f03.maanim",
  );
});

test("site API representative contract matches its allowlisted paths", () => {
  assert.equal(resolveSiteUnitLegacyPath("000", "f", "image"), "units/000/f/sprite.png");
  assert.equal(
    resolveSiteUnitLegacyPath("000", "f", "motion-2"),
    "units/000/f/animations/02.maanim",
  );
  assert.equal(resolveSiteUnitLegacyPath("000", "f", "name"), "units/000/names-ja.csv");
  assert.equal(
    resolveSiteEnemyLegacyPath("000", "name"),
    "resources/enemyname/Enemyname.tsv",
  );
});

test("generated motion index satisfies site and save-app/lab contracts", async () => {
  const source = await readFile(new URL("../jp/sitedata/motion-index.json", import.meta.url), "utf8");
  const motionIndex = JSON.parse(source);
  const result = verifyMotionConsumerContracts(motionIndex.assets);
  assert.deepEqual(result.saveAppForms, ["f", "c", "s", "u"]);
  assert.equal(result.saveAppAssetKeys.length, 7);
  assert.ok(result.checkedKeyCount >= 40);
});
