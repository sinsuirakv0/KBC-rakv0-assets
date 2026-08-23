import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { compareText, listFiles } from "./apk-ledger.mjs";

export const CHARACTER_INDEX_SCHEMA_VERSION = 2;
export const CHARACTER_ASSETS_SCHEMA_VERSION = 1;
export const CHARACTER_PATH_RULE_VERSION = 1;
export const CHARACTER_OVERRIDES_SCHEMA_VERSION = 1;

export const CHARACTER_PATH_TEMPLATES = Object.freeze({
  i: "ImageData/{id}{suffix}",
  iu: "ImageData/udi{id}{suffix}",
  uu: "Unit/udi{id}{suffix}",
  un: "Unit/uni{id}{suffix}",
  g: "Image/gatyachara_{id}{suffix}",
  d: "Download/download_char_{id}{suffix}",
  x: "{suffix}",
});

export const CHARACTER_DERIVED_TEMPLATES = Object.freeze({
  data: "Data/unit{sourceId3}.csv",
  explanation: "res/Unit_Explanation{sourceId}_ja.csv",
});

const EXPLANATION_PATTERN = /^res\/Unit_Explanation(\d+)_ja\.csv$/;
const COMMENT_PATTERN = /^(?:\/\/|#|;)/;
const SPIRIT_NAME_PATTERN = /^8\d\d[-_]\d+$/;
const SPIRIT_DESCRIPTION_PATTERN = /^精霊[：:]/;
const PATH_CODES = Object.freeze(Object.keys(CHARACTER_PATH_TEMPLATES));
const DERIVED_CODES = Object.freeze(Object.keys(CHARACTER_DERIVED_TEMPLATES));

export async function collectCharacterIndexFiles(sitedataRoot) {
  return (await listFiles(sitedataRoot)).map(file => ({
    relativePath: file.relativePath,
    absolutePath: file.absolutePath,
  }));
}

export async function readCharacterOverrides(filePath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Character overrides file is required: ${filePath}`);
    throw error;
  }
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Invalid character overrides JSON: ${filePath}`, { cause: error });
  }
}

export async function createCharacterOutputs({ versionRecord, files, overrides }) {
  const discovery = await discoverCharacters(files);
  const overridesById = validateCharacterOverrides(overrides, discovery);
  const indexUnits = [];
  const assetUnits = [];
  const effectivePathsByUnit = {};

  for (const unit of discovery.units) {
    const override = overridesById.get(unit.id) ?? {};
    const aliases = [...(override.aliases?.include ?? [])];
    const paths = applyOverride(unit.discoveredPaths, override.paths);
    indexUnits.push({ id: unit.id, forms: unit.forms, aliases });
    assetUnits.push({ id: unit.id, ...encodeUnitAssetPaths(unit.id, paths) });
    effectivePathsByUnit[unit.id] = paths;
  }

  return {
    characterIndex: {
      gameVersion: versionRecord.versionName,
      versionCode: versionRecord.versionCode,
      schemaVersion: CHARACTER_INDEX_SCHEMA_VERSION,
      units: indexUnits,
    },
    characterAssets: {
      gameVersion: versionRecord.versionName,
      versionCode: versionRecord.versionCode,
      schemaVersion: CHARACTER_ASSETS_SCHEMA_VERSION,
      pathRuleVersion: CHARACTER_PATH_RULE_VERSION,
      pathTemplates: { ...CHARACTER_PATH_TEMPLATES },
      derivedTemplates: { ...CHARACTER_DERIVED_TEMPLATES },
      units: assetUnits,
    },
    effectivePathsByUnit,
  };
}

export function serializeCharacterIndex(characterIndex) {
  return `${JSON.stringify(characterIndex, null, 2)}\n`;
}

export function serializeCharacterAssets(characterAssets) {
  return `${JSON.stringify(characterAssets)}\n`;
}

export async function verifyCharacterOutputs({ actualIndex, actualAssets, versionRecord, files, overrides }) {
  const expected = await createCharacterOutputs({ versionRecord, files, overrides });
  const expectedIds = expected.characterIndex.units.map(unit => unit.id);
  validateCharacterIndexShape(actualIndex, versionRecord, expectedIds);
  validateCharacterAssetsShape(actualAssets, versionRecord, expectedIds);
  if (!isDeepStrictEqual(actualIndex, expected.characterIndex)) {
    throw new Error("character-index.json is stale or invalid.");
  }
  if (!isDeepStrictEqual(actualAssets, expected.characterAssets)) {
    throw new Error("character-assets.json is stale or invalid.");
  }

  const decoded = decodeAllCharacterAssetPaths(actualAssets);
  let pathCount = 0;
  for (const id of expectedIds) {
    if (!isDeepStrictEqual(decoded[id], expected.effectivePathsByUnit[id])) {
      throw new Error(`Character asset path roundtrip failed: ${id}`);
    }
    pathCount += decoded[id].length;
  }
  return { unitCount: expectedIds.length, pathCount };
}

export function assertLegacyCharacterIndexMigratable(previousIndex) {
  if (previousIndex === null || previousIndex?.schemaVersion === CHARACTER_INDEX_SCHEMA_VERSION) return;
  if (previousIndex?.schemaVersion !== 1 || !Array.isArray(previousIndex.units)) {
    throw new Error("Existing character-index.json cannot be migrated safely.");
  }
  for (const unit of previousIndex.units) {
    const aliasManual = unit?.aliasManual;
    const pathManual = unit?.assets?.manual;
    const aliases = unit?.aliases;
    const discoveredAliases = unit?.discoveredAliases;
    const paths = unit?.assets?.paths;
    const discoveredPaths = unit?.assets?.discoveredPaths;
    if (!isManualBlock(aliasManual) || !isManualBlock(pathManual)
      || !Array.isArray(aliases) || !Array.isArray(discoveredAliases)
      || !Array.isArray(paths) || !Array.isArray(discoveredPaths)) {
      throw new Error("Existing v1 character-index.json cannot be migrated safely.");
    }
    const hasManual = aliasManual.include.length > 0 || aliasManual.exclude.length > 0
      || pathManual.include.length > 0 || pathManual.exclude.length > 0;
    const aliasesMatch = isDeepStrictEqual(canonicalize(aliases), applyOverride(discoveredAliases, aliasManual));
    const pathsMatch = isDeepStrictEqual(canonicalize(paths), applyOverride(discoveredPaths, pathManual));
    if (hasManual || !aliasesMatch || !pathsMatch) {
      throw new Error("Existing v1 character manual edits require migration to jp/character-overrides.json.");
    }
  }
}

export async function discoverCharacters(files) {
  const normalizedFiles = normalizeFiles(files);
  const filePaths = new Set(normalizedFiles.map(file => file.relativePath));
  const explanations = normalizedFiles
    .map(file => ({ file, match: EXPLANATION_PATTERN.exec(file.relativePath) }))
    .filter(item => item.match)
    .map(item => ({ ...item.file, sourceId: Number(item.match[1]) }))
    .sort((left, right) => left.sourceId - right.sourceId);
  if (explanations.length === 0) throw new Error("No Unit_Explanation*_ja.csv files were found.");

  const units = [];
  for (let index = 0; index < explanations.length; index += 1) {
    const explanation = explanations[index];
    const expectedSourceId = index + 1;
    if (explanation.sourceId !== expectedSourceId) {
      throw new Error(`Unit explanation IDs are not continuous: expected ${expectedSourceId}, got ${explanation.sourceId}.`);
    }
    const unitNumber = explanation.sourceId - 1;
    const unitId = String(unitNumber).padStart(3, "0");
    const dataPath = findUnitDataPath(filePaths, explanation.sourceId);
    const records = parseCsvRecords(await readFile(explanation.absolutePath, "utf8"));
    const forms = extractForms(records, explanation.relativePath);
    const discoveredPaths = discoverUnitAssetPaths({
      filePaths,
      unitId: unitNumber,
      sourceId: explanation.sourceId,
      explanationPath: explanation.relativePath,
      dataPath,
    });
    units.push({ id: unitId, forms, discoveredPaths });
  }
  return { units, filePaths };
}

export function discoverUnitAssetPaths({ filePaths, unitId, sourceId, explanationPath, dataPath }) {
  const id3 = String(unitId).padStart(3, "0");
  const escapedId = escapeRegex(id3);
  const matchers = [
    new RegExp(`^ImageData/${escapedId}_[cefspmuga](?=[0-9_.])[^/]*$`),
    new RegExp(`^ImageData/udi${escapedId}(?=[_.])[^/]*$`),
    new RegExp(`^Unit/(?:uni|udi)${escapedId}(?=[_.])[^/]*$`),
    new RegExp(`^Image/gatyachara_${escapedId}(?=[_.])[^/]*$`),
    new RegExp(`^Download/download_char_${escapedId}(?=[_.])[^/]*$`),
  ];
  const paths = [dataPath, explanationPath];
  for (const relativePath of filePaths) {
    if (matchers.some(matcher => matcher.test(relativePath))) paths.push(relativePath);
  }
  if (sourceId !== unitId + 1) throw new Error(`Invalid sourceId mapping for unit ${unitId}.`);
  return canonicalize(paths);
}

export function decodeCharacterAssetPaths(characterAssets, unitId) {
  validateCharacterAssetsHeader(characterAssets);
  const unit = characterAssets.units[Number(unitId)];
  if (!unit || unit.id !== unitId) throw new Error(`Unknown character asset unit: ${unitId}`);
  return decodeUnitAssetPaths(unit, unitId);
}

export function decodeAllCharacterAssetPaths(characterAssets) {
  validateCharacterAssetsHeader(characterAssets);
  const decoded = {};
  for (const unit of characterAssets.units) {
    decoded[unit.id] = decodeUnitAssetPaths(unit, unit.id);
  }
  return decoded;
}

export function parseCsvRecords(source) {
  const text = source.replace(/^\uFEFF/, "");
  const records = [];
  let row = [];
  let field = "";
  let raw = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      raw += character;
      if (inQuotes && text[index + 1] === '"') {
        field += '"';
        raw += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
      raw += character;
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      records.push({ columns: row, raw });
      row = [];
      field = "";
      raw = "";
    } else {
      field += character;
      raw += character;
    }
  }
  if (inQuotes) throw new Error("CSV contains an unterminated quoted field.");
  if (field.length > 0 || row.length > 0 || raw.length > 0) {
    row.push(field);
    records.push({ columns: row, raw });
  }
  return records;
}

function extractForms(records, sourceLabel) {
  const forms = [];
  let lastFormName = null;
  for (const record of records) {
    if (COMMENT_PATTERN.test(record.raw.trimStart())) continue;
    const columns = record.columns;
    let name = (columns[0] ?? "").trim();
    const descriptionParts = columns.slice(1, 4).filter(value => !/^[\u3000]*$/.test(value));
    const description = descriptionParts.join("");
    if (SPIRIT_NAME_PATTERN.test(name) && SPIRIT_DESCRIPTION_PATTERN.test(description)) name = "精霊";
    if (!name) continue;
    // 旧KBC-GG生成規則どおり、直前形態と同名になった行から先は未実装形態として打ち切る。
    if (lastFormName !== null && name === lastFormName) break;
    if (forms.length >= 4) throw new Error(`More than four implemented forms were found: ${sourceLabel}`);
    forms.push({ name, description });
    lastFormName = name;
  }
  if (forms.length === 0) throw new Error(`No implemented forms were found: ${sourceLabel}`);
  return forms;
}

function validateCharacterOverrides(overrides, discovery) {
  assertExactKeys(overrides, ["schemaVersion", "units"], "character-overrides.json");
  if (overrides.schemaVersion !== CHARACTER_OVERRIDES_SCHEMA_VERSION || !isPlainObject(overrides.units)) {
    throw new Error("character-overrides.json schema is unsupported.");
  }
  const currentIds = new Set(discovery.units.map(unit => unit.id));
  const unitIds = Object.keys(overrides.units).sort(compareUnitId);
  const result = new Map();
  for (const unitId of unitIds) {
    if (!/^\d{3,}$/.test(unitId) || !currentIds.has(unitId)) {
      throw new Error(`Unknown character override unit: ${unitId}`);
    }
    const unit = overrides.units[unitId];
    if (!isPlainObject(unit)) throw new Error(`Invalid character override unit: ${unitId}`);
    const keys = Object.keys(unit);
    if (keys.length === 0 || keys.some(key => !["aliases", "paths"].includes(key))
      || !isDeepStrictEqual(keys, ["aliases", "paths"].filter(key => Object.hasOwn(unit, key)))) {
      throw new Error(`Invalid character override unit keys: ${unitId}`);
    }
    const normalized = {};
    if (unit.aliases) {
      normalized.aliases = validateOverrideBlock(unit.aliases, `units.${unitId}.aliases`);
      if (normalized.aliases.exclude.length > 0) {
        throw new Error(`units.${unitId}.aliases.exclude is redundant while source aliases are disabled.`);
      }
    }
    if (unit.paths) {
      normalized.paths = validateOverrideBlock(unit.paths, `units.${unitId}.paths`, {
        include: value => validateExistingPath(value, discovery.filePaths),
        exclude: validateSafePath,
      });
    }
    result.set(unitId, normalized);
  }
  return result;
}

function validateOverrideBlock(block, label, validators = {}) {
  assertExactKeys(block, ["include", "exclude"], label);
  assertCanonicalList(block.include, `${label}.include`, validators.include);
  assertCanonicalList(block.exclude, `${label}.exclude`, validators.exclude);
  if (block.include.length === 0 && block.exclude.length === 0) throw new Error(`${label} must not be empty.`);
  const included = new Set(block.include);
  if (block.exclude.some(value => included.has(value))) throw new Error(`${label} contains conflicting values.`);
  return block;
}

function encodeUnitAssetPaths(unitId, effectivePaths) {
  const paths = new Set(effectivePaths);
  const unit = {};
  const derived = createDerivedPaths(unitId);
  const omitted = [];
  for (const [code, relativePath] of Object.entries(derived)) {
    if (paths.delete(relativePath)) continue;
    omitted.push(code);
  }
  if (omitted.length > 0) unit.omit = omitted;

  const encoded = new Map(PATH_CODES.map(code => [code, []]));
  for (const relativePath of [...paths].sort(compareText)) {
    const { code, suffix } = encodePath(relativePath, unitId);
    encoded.get(code).push(suffix);
  }
  for (const code of PATH_CODES) {
    const suffixes = canonicalize(encoded.get(code));
    if (suffixes.length > 0) unit[code] = suffixes;
  }
  return unit;
}

function encodePath(relativePath, unitId) {
  const prefixes = [
    ["iu", `ImageData/udi${unitId}`],
    ["i", `ImageData/${unitId}`],
    ["uu", `Unit/udi${unitId}`],
    ["un", `Unit/uni${unitId}`],
    ["g", `Image/gatyachara_${unitId}`],
    ["d", `Download/download_char_${unitId}`],
  ];
  for (const [code, prefix] of prefixes) {
    if (!relativePath.startsWith(prefix)) continue;
    const suffix = relativePath.slice(prefix.length);
    if (suffix.startsWith("_") || suffix.startsWith(".")) return { code, suffix };
  }
  return { code: "x", suffix: relativePath };
}

function decodeUnitAssetPaths(unit, unitId) {
  validateUnitAssetEncoding(unit, unitId);
  const derived = createDerivedPaths(unitId);
  const paths = new Set(Object.entries(derived)
    .filter(([code]) => !(unit.omit ?? []).includes(code))
    .map(([, relativePath]) => relativePath));
  for (const code of PATH_CODES) {
    for (const suffix of unit[code] ?? []) {
      const relativePath = CHARACTER_PATH_TEMPLATES[code]
        .replace("{id}", unitId)
        .replace("{suffix}", suffix);
      validateSafePath(relativePath);
      paths.add(relativePath);
    }
  }
  return canonicalize([...paths]);
}

function createDerivedPaths(unitId) {
  const sourceId = Number(unitId) + 1;
  if (!Number.isSafeInteger(sourceId) || sourceId < 1) throw new Error(`Invalid character unit ID: ${unitId}`);
  const sourceId3 = String(sourceId).padStart(3, "0");
  return Object.fromEntries(Object.entries(CHARACTER_DERIVED_TEMPLATES).map(([code, template]) => [
    code,
    template.replace("{sourceId3}", sourceId3).replace("{sourceId}", String(sourceId)),
  ]));
}

function validateCharacterIndexShape(value, versionRecord, expectedIds) {
  assertExactKeys(value, ["gameVersion", "versionCode", "schemaVersion", "units"], "character-index.json");
  if (value.gameVersion !== versionRecord.versionName || value.versionCode !== versionRecord.versionCode
    || value.schemaVersion !== CHARACTER_INDEX_SCHEMA_VERSION || !Array.isArray(value.units)) {
    throw new Error("character-index.json header is invalid.");
  }
  if (!isDeepStrictEqual(value.units.map(unit => unit?.id), expectedIds)) {
    throw new Error("character-index.json unit IDs are invalid.");
  }
  for (let index = 0; index < expectedIds.length; index += 1) {
    const id = expectedIds[index];
    const unit = value.units[index];
    assertExactKeys(unit, ["id", "forms", "aliases"], `character-index.json units.${id}`);
    assertCanonicalList(unit.aliases, `character-index.json units.${id}.aliases`);
    if (!Array.isArray(unit.forms) || unit.forms.length < 1 || unit.forms.length > 4) {
      throw new Error(`character-index.json forms are invalid: ${id}`);
    }
    for (const form of unit.forms) {
      assertExactKeys(form, ["name", "description"], `character-index.json units.${id}.forms`);
      if (typeof form.name !== "string" || !form.name || typeof form.description !== "string") {
        throw new Error(`character-index.json form is invalid: ${id}`);
      }
    }
  }
}

function validateCharacterAssetsShape(value, versionRecord, expectedIds) {
  validateCharacterAssetsHeader(value);
  if (value.gameVersion !== versionRecord.versionName || value.versionCode !== versionRecord.versionCode) {
    throw new Error("character-assets.json version is stale.");
  }
  if (!isDeepStrictEqual(value.units.map(unit => unit?.id), expectedIds)) {
    throw new Error("character-assets.json unit IDs are invalid.");
  }
  for (let index = 0; index < expectedIds.length; index += 1) {
    validateUnitAssetEncoding(value.units[index], expectedIds[index]);
  }
}

function validateCharacterAssetsHeader(value) {
  assertExactKeys(value, [
    "gameVersion",
    "versionCode",
    "schemaVersion",
    "pathRuleVersion",
    "pathTemplates",
    "derivedTemplates",
    "units",
  ], "character-assets.json");
  if (typeof value.gameVersion !== "string" || !Number.isSafeInteger(value.versionCode)
    || value.schemaVersion !== CHARACTER_ASSETS_SCHEMA_VERSION
    || value.pathRuleVersion !== CHARACTER_PATH_RULE_VERSION
    || !isDeepStrictEqual(value.pathTemplates, CHARACTER_PATH_TEMPLATES)
    || !isDeepStrictEqual(value.derivedTemplates, CHARACTER_DERIVED_TEMPLATES)
    || !Array.isArray(value.units)) {
    throw new Error("character-assets.json header is invalid.");
  }
  const ids = value.units.map(unit => unit?.id);
  if (ids.some((id, index) => !/^\d{3,}$/.test(id) || id !== String(index).padStart(3, "0"))) {
    throw new Error("character-assets.json unit IDs are invalid.");
  }
}

function validateUnitAssetEncoding(unit, unitId) {
  if (!isPlainObject(unit)) throw new Error(`Invalid character asset encoding: ${unitId}`);
  const expectedKeyOrder = ["id", "omit", ...PATH_CODES].filter(code => Object.hasOwn(unit, code));
  if (!isDeepStrictEqual(Object.keys(unit), expectedKeyOrder)) throw new Error(`Invalid character asset codes: ${unitId}`);
  if (unit.id !== unitId) throw new Error(`Invalid character asset unit ID: ${unitId}`);
  if (unit.omit) {
    assertCanonicalList(unit.omit, `character-assets units.${unitId}.omit`);
    if (unit.omit.some(code => !DERIVED_CODES.includes(code))) throw new Error(`Invalid derived omission: ${unitId}`);
  }
  for (const code of PATH_CODES) {
    if (!unit[code]) continue;
    assertCanonicalList(unit[code], `character-assets units.${unitId}.${code}`);
    for (const suffix of unit[code]) {
      if (code === "x") validateSafePath(suffix);
      else if (!suffix.startsWith("_") && !suffix.startsWith(".")) {
        throw new Error(`Invalid character asset suffix: ${unitId}/${code}`);
      }
    }
  }
}

function findUnitDataPath(filePaths, sourceId) {
  const expected = `Data/unit${String(sourceId).padStart(3, "0")}.csv`;
  if (!filePaths.has(expected)) throw new Error(`Required unit Data CSV is missing: ${expected}`);
  return expected;
}

function applyOverride(discovered, block) {
  const values = new Set(discovered);
  for (const value of block?.include ?? []) values.add(value);
  for (const value of block?.exclude ?? []) values.delete(value);
  return canonicalize([...values]);
}

function validateExistingPath(value, filePaths) {
  validateSafePath(value);
  if (!filePaths.has(value)) throw new Error(`Manual asset include path does not exist in current sitedata: ${value}`);
}

function validateSafePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.startsWith("/")
    || /^[A-Za-z]:/.test(value) || value.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe sitedata-relative path: ${value}`);
  }
}

function assertCanonicalList(values, label, validateItem) {
  if (!Array.isArray(values) || values.some(value => typeof value !== "string" || value.length === 0)) {
    throw new Error(`${label} must be a string array.`);
  }
  if (!isDeepStrictEqual(values, canonicalize(values))) throw new Error(`${label} must be sorted and deduplicated.`);
  if (validateItem) for (const value of values) validateItem(value);
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) throw new Error("Character index files must be an array.");
  const seen = new Set();
  return files.map(file => {
    validateSafePath(file.relativePath);
    if (seen.has(file.relativePath)) throw new Error(`Duplicate sitedata path: ${file.relativePath}`);
    seen.add(file.relativePath);
    if (typeof file.absolutePath !== "string" || file.absolutePath.length === 0) throw new Error(`Missing source path: ${file.relativePath}`);
    return file;
  }).sort((left, right) => compareText(left.relativePath, right.relativePath));
}

function assertExactKeys(value, expected, label) {
  if (!isPlainObject(value) || !isDeepStrictEqual(Object.keys(value), expected)) {
    throw new Error(`${label} has unexpected keys or key order.`);
  }
}

function isManualBlock(value) {
  return isPlainObject(value) && Array.isArray(value.include) && Array.isArray(value.exclude);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(values) {
  return [...new Set(values)].sort(compareText);
}

function compareUnitId(left, right) {
  return Number(left) - Number(right) || compareText(left, right);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
