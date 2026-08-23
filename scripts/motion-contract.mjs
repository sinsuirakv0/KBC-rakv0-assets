export const SAVE_APP_FORMS = Object.freeze(["f", "c", "s", "u"]);
export const SAVE_APP_ASSET_KEYS = Object.freeze([
  "image",
  "imgcut",
  "model",
  "motion-0",
  "motion-1",
  "motion-2",
  "motion-3",
]);
export const SITE_UNIT_ASSET_KEYS = Object.freeze([
  ...SAVE_APP_ASSET_KEYS,
  "thumbnail",
  "name",
]);
export const SITE_ENEMY_ASSET_KEYS = Object.freeze([
  ...SAVE_APP_ASSET_KEYS,
  "name",
]);
export const SAVE_APP_REPRESENTATIVE_IDS = Object.freeze({
  f: "000",
  c: "000",
  s: "000",
  u: "059",
});
export const SITE_REPRESENTATIVE = Object.freeze({
  unitId: "000",
  unitForm: "f",
  enemyId: "000",
});

const SAVE_APP_DEFINITIONS = Object.freeze({
  image: ["png", ".png"],
  imgcut: ["imgcut", ".imgcut"],
  model: ["mamodel", ".mamodel"],
  "motion-0": ["maanim", "00.maanim"],
  "motion-1": ["maanim", "01.maanim"],
  "motion-2": ["maanim", "02.maanim"],
  "motion-3": ["maanim", "03.maanim"],
});

export function resolveSaveAppLegacyPath(unitId, form, assetKey) {
  const definition = SAVE_APP_DEFINITIONS[assetKey];
  if (!/^\d{3,5}$/.test(unitId) || !SAVE_APP_FORMS.includes(form) || !definition) {
    throw new Error(`Unsupported save-app motion request: ${unitId}-${form} ${assetKey}`);
  }
  const [directory, suffix] = definition;
  return `number/${form}/${directory}/${unitId}_${form}${suffix}`;
}

export function resolveSiteUnitLegacyPath(unitId, form, assetKey) {
  if (!/^\d{3,}$/.test(unitId) || !SAVE_APP_FORMS.includes(form)) {
    throw new Error(`Unsupported site unit motion request: ${unitId}-${form}`);
  }
  const root = `units/${unitId}/${form}`;
  if (assetKey === "thumbnail") return `${root}/thumbnail-00.png`;
  if (assetKey === "name") return `units/${unitId}/names-ja.csv`;
  return resolveEntityMotionPath(root, assetKey);
}

export function resolveSiteEnemyLegacyPath(enemyId, assetKey) {
  if (!/^\d{3,}$/.test(enemyId)) {
    throw new Error(`Unsupported site enemy motion request: ${enemyId}`);
  }
  if (assetKey === "name") return "resources/enemyname/Enemyname.tsv";
  return resolveEntityMotionPath(`enemies/${enemyId}`, assetKey);
}

export function verifyMotionConsumerContracts(assets) {
  const checked = [];
  for (const form of SAVE_APP_FORMS) {
    const unitId = SAVE_APP_REPRESENTATIVE_IDS[form];
    for (const assetKey of SAVE_APP_ASSET_KEYS) {
      const legacyPath = resolveSaveAppLegacyPath(unitId, form, assetKey);
      const rawPath = expectedSaveAppRawPath(unitId, form, assetKey);
      assertMapping(assets, legacyPath, rawPath, "save-app/lab");
      checked.push(legacyPath);
    }
  }

  for (const assetKey of SITE_UNIT_ASSET_KEYS) {
    const legacyPath = resolveSiteUnitLegacyPath(
      SITE_REPRESENTATIVE.unitId,
      SITE_REPRESENTATIVE.unitForm,
      assetKey,
    );
    assertPresent(assets, legacyPath, "site unit API");
    checked.push(legacyPath);
  }
  for (const assetKey of SITE_ENEMY_ASSET_KEYS) {
    const legacyPath = resolveSiteEnemyLegacyPath(SITE_REPRESENTATIVE.enemyId, assetKey);
    assertPresent(assets, legacyPath, "site enemy API");
    checked.push(legacyPath);
  }
  return {
    checkedKeyCount: new Set(checked).size,
    saveAppForms: [...SAVE_APP_FORMS],
    saveAppAssetKeys: [...SAVE_APP_ASSET_KEYS],
    siteUnitAssetKeys: [...SITE_UNIT_ASSET_KEYS],
    siteEnemyAssetKeys: [...SITE_ENEMY_ASSET_KEYS],
  };
}

function resolveEntityMotionPath(root, assetKey) {
  if (assetKey === "image") return `${root}/sprite.png`;
  if (assetKey === "imgcut") return `${root}/cuts.imgcut`;
  if (assetKey === "model") return `${root}/model.mamodel`;
  if (/^motion-[0-3]$/.test(assetKey)) {
    return `${root}/animations/0${assetKey.at(-1)}.maanim`;
  }
  throw new Error(`Unsupported entity motion asset: ${assetKey}`);
}

function expectedSaveAppRawPath(unitId, form, assetKey) {
  if (assetKey === "image") return `Number/${unitId}_${form}.png`;
  if (assetKey === "imgcut") return `ImageData/${unitId}_${form}.imgcut`;
  if (assetKey === "model") return `ImageData/${unitId}_${form}.mamodel`;
  return `ImageData/${unitId}_${form}0${assetKey.at(-1)}.maanim`;
}

function assertMapping(assets, legacyPath, expectedRawPath, consumer) {
  assertPresent(assets, legacyPath, consumer);
  if (assets[legacyPath] !== expectedRawPath) {
    throw new Error(
      `${consumer} key ${legacyPath} resolves to ${assets[legacyPath]}, expected ${expectedRawPath}.`,
    );
  }
}

function assertPresent(assets, legacyPath, consumer) {
  if (!Object.prototype.hasOwnProperty.call(assets, legacyPath)) {
    throw new Error(`${consumer} representative key is missing: ${legacyPath}`);
  }
}
