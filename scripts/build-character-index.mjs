import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { compareText, listFiles } from "./apk-ledger.mjs";

export const CHARACTER_INDEX_SCHEMA_VERSION = 1;

const EXPLANATION_PATTERN = /^res\/Unit_Explanation(\d+)_ja\.csv$/;
const COMMENT_PATTERN = /^(?:\/\/|#|;)/;
const SPIRIT_NAME_PATTERN = /^8\d\d[-_]\d+$/;
const SPIRIT_DESCRIPTION_PATTERN = /^精霊[：:]/;

export async function collectCharacterIndexFiles(sitedataRoot) {
  return (await listFiles(sitedataRoot)).map(file => ({
    relativePath: file.relativePath,
    absolutePath: file.absolutePath,
  }));
}

export async function createCharacterIndex({ versionRecord, files, previousIndex = null }) {
  const discovery = await discoverCharacters(files);
  const previousUnits = indexPreviousUnits(previousIndex);
  const units = discovery.units.map(unit => {
    const previous = previousUnits.get(unit.id);
    const aliasState = mergeEditableCollection({
      previousEffective: previous?.aliases ?? [],
      previousDiscovered: previous?.discoveredAliases ?? [],
      previousManual: previous?.aliasManual ?? emptyManual(),
      discovered: unit.discoveredAliases,
      label: `units[${unit.id}].aliases`,
    });
    const pathState = mergeEditableCollection({
      previousEffective: previous?.assets?.paths ?? [],
      previousDiscovered: previous?.assets?.discoveredPaths ?? [],
      previousManual: previous?.assets?.manual ?? emptyManual(),
      discovered: unit.discoveredPaths,
      label: `units[${unit.id}].assets.paths`,
      validateItem: value => validateExistingPath(value, discovery.filePaths),
    });
    return {
      id: unit.id,
      forms: unit.forms,
      aliases: aliasState.effective,
      discoveredAliases: unit.discoveredAliases,
      aliasManual: aliasState.manual,
      assets: {
        paths: pathState.effective,
        discoveredPaths: unit.discoveredPaths,
        manual: pathState.manual,
      },
    };
  });
  return {
    gameVersion: versionRecord.versionName,
    versionCode: versionRecord.versionCode,
    schemaVersion: CHARACTER_INDEX_SCHEMA_VERSION,
    units,
  };
}

export async function verifyCharacterIndex({ actual, versionRecord, files }) {
  const discovery = await discoverCharacters(files);
  assertExactKeys(actual, ["gameVersion", "versionCode", "schemaVersion", "units"], "character-index.json");
  if (actual.gameVersion !== versionRecord.versionName) throw new Error("character-index.json gameVersion is stale.");
  if (actual.versionCode !== versionRecord.versionCode) throw new Error("character-index.json versionCode is stale.");
  if (actual.schemaVersion !== CHARACTER_INDEX_SCHEMA_VERSION) throw new Error("character-index.json schemaVersion is unsupported.");
  if (!Array.isArray(actual.units) || actual.units.length !== discovery.units.length) {
    throw new Error("character-index.json does not contain every current unit.");
  }

  for (let index = 0; index < discovery.units.length; index += 1) {
    const expected = discovery.units[index];
    const unit = actual.units[index];
    assertExactKeys(unit, ["id", "forms", "aliases", "discoveredAliases", "aliasManual", "assets"], `units[${index}]`);
    const expectedId = String(index).padStart(3, "0");
    if (unit.id !== expectedId || unit.id !== expected.id) throw new Error(`Unit IDs are not continuous at units[${index}].`);
    if (!isDeepStrictEqual(unit.forms, expected.forms)) throw new Error(`Unit forms are stale: ${unit.id}`);
    assertCanonicalList(unit.discoveredAliases, `units[${index}].discoveredAliases`);
    if (!isDeepStrictEqual(unit.discoveredAliases, expected.discoveredAliases)) {
      throw new Error(`Unit source aliases are stale: ${unit.id}`);
    }
    validateManual(unit.aliasManual, `units[${index}].aliasManual`);
    assertCanonicalList(unit.aliases, `units[${index}].aliases`);
    const expectedAliases = applyManual(expected.discoveredAliases, unit.aliasManual);
    if (!isDeepStrictEqual(unit.aliases, expectedAliases)) throw new Error(`Unit aliases are invalid: ${unit.id}`);

    assertExactKeys(unit.assets, ["paths", "discoveredPaths", "manual"], `units[${index}].assets`);
    assertCanonicalList(unit.assets.discoveredPaths, `units[${index}].assets.discoveredPaths`, validateSafePath);
    if (!isDeepStrictEqual(unit.assets.discoveredPaths, expected.discoveredPaths)) {
      throw new Error(`Unit discovered asset paths are stale: ${unit.id}`);
    }
    validateManual(unit.assets.manual, `units[${index}].assets.manual`, value => (
      validateExistingPath(value, discovery.filePaths)
    ));
    assertCanonicalList(unit.assets.paths, `units[${index}].assets.paths`, value => (
      validateExistingPath(value, discovery.filePaths)
    ));
    const expectedPaths = applyManual(expected.discoveredPaths, unit.assets.manual);
    if (!isDeepStrictEqual(unit.assets.paths, expectedPaths)) throw new Error(`Unit effective asset paths are invalid: ${unit.id}`);
  }
  return { unitCount: discovery.units.length };
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
    const { forms, discoveredAliases } = extractForms(records, explanation.relativePath);
    const discoveredPaths = discoverUnitAssetPaths({
      filePaths,
      unitId: unitNumber,
      sourceId: explanation.sourceId,
      explanationPath: explanation.relativePath,
      dataPath,
    });
    units.push({ id: unitId, forms, discoveredAliases, discoveredPaths });
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
  const aliases = [];
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
    forms.push({ index: forms.length, name, description });
    const sourceAlias = (columns[4] ?? "").trim();
    if (sourceAlias && !/^\u3000+$/.test(sourceAlias)) aliases.push(sourceAlias);
    lastFormName = name;
  }
  if (forms.length === 0) throw new Error(`No implemented forms were found: ${sourceLabel}`);
  return { forms, discoveredAliases: canonicalize(aliases) };
}

function findUnitDataPath(filePaths, sourceId) {
  const matcher = new RegExp(`^Data/unit0*${sourceId}\\.csv$`);
  const matches = [...filePaths].filter(relativePath => matcher.test(relativePath)).sort(compareText);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Data/unit CSV for sourceId ${sourceId}, found ${matches.length}.`);
  }
  return matches[0];
}

function mergeEditableCollection({ previousEffective, previousDiscovered, previousManual, discovered, label, validateItem }) {
  const effective = canonicalizeRequired(previousEffective, `${label}.effective`);
  const oldDiscovered = canonicalizeRequired(previousDiscovered, `${label}.discovered`);
  const include = new Set(canonicalizeRequired(previousManual.include, `${label}.manual.include`));
  const exclude = new Set(canonicalizeRequired(previousManual.exclude, `${label}.manual.exclude`));
  const previousExpected = new Set(applyManual(oldDiscovered, { include: [...include], exclude: [...exclude] }));
  const actual = new Set(effective);

  for (const item of actual) {
    if (previousExpected.has(item)) continue;
    exclude.delete(item);
    if (!oldDiscovered.includes(item)) include.add(item);
  }
  for (const item of previousExpected) {
    if (actual.has(item)) continue;
    include.delete(item);
    if (oldDiscovered.includes(item)) exclude.add(item);
  }
  for (const item of include) exclude.delete(item);
  const manual = { include: canonicalize([...include]), exclude: canonicalize([...exclude]) };
  validateManual(manual, `${label}.manual`, validateItem);
  return { manual, effective: applyManual(discovered, manual) };
}

function indexPreviousUnits(previousIndex) {
  if (previousIndex === null) return new Map();
  if (!previousIndex || !Array.isArray(previousIndex.units)) throw new Error("Existing character-index.json is invalid.");
  const result = new Map();
  for (const unit of previousIndex.units) {
    if (typeof unit?.id !== "string" || !/^\d{3,}$/.test(unit.id) || result.has(unit.id)) {
      throw new Error("Existing character-index.json has invalid unit IDs.");
    }
    if (!Array.isArray(unit.aliases) || !Array.isArray(unit.discoveredAliases)
      || !unit.aliasManual || !Array.isArray(unit.aliasManual.include) || !Array.isArray(unit.aliasManual.exclude)
      || !unit.assets || !Array.isArray(unit.assets.paths) || !Array.isArray(unit.assets.discoveredPaths)
      || !unit.assets.manual || !Array.isArray(unit.assets.manual.include) || !Array.isArray(unit.assets.manual.exclude)) {
      throw new Error(`Existing character-index.json unit state is invalid: ${unit.id}`);
    }
    result.set(unit.id, unit);
  }
  return result;
}

function validateManual(manual, label, validateItem) {
  assertExactKeys(manual, ["include", "exclude"], label);
  assertCanonicalList(manual.include, `${label}.include`, validateItem);
  assertCanonicalList(manual.exclude, `${label}.exclude`, validateItem);
  const included = new Set(manual.include);
  if (manual.exclude.some(value => included.has(value))) throw new Error(`${label} contains conflicting values.`);
}

function applyManual(discovered, manual) {
  const values = new Set([...discovered, ...manual.include]);
  for (const value of manual.exclude) values.delete(value);
  return canonicalize([...values]);
}

function validateExistingPath(value, filePaths) {
  validateSafePath(value);
  if (!filePaths.has(value)) throw new Error(`Manual asset path does not exist in current sitedata: ${value}`);
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

function canonicalizeRequired(values, label) {
  if (!Array.isArray(values) || values.some(value => typeof value !== "string" || value.length === 0)) {
    throw new Error(`${label} must be a string array.`);
  }
  return canonicalize(values);
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
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value), expected)) {
    throw new Error(`${label} has unexpected keys or key order.`);
  }
}

function emptyManual() {
  return { include: [], exclude: [] };
}

function canonicalize(values) {
  return [...new Set(values)].sort(compareText);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
