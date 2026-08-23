import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const APK_LEDGER_SCHEMA_VERSION = 1;
export const CURRENT_VERSION_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_EXPANDED_VERSIONS = 2;
export const DEFAULT_MAX_EXPANDED_BYTES = 1_073_741_824;
export const REQUIRED_APK_ROOTS = Object.freeze([
  "assets",
  "DataLocal",
  "DownloadLocal",
  "HtmlLocal",
  "ImageDataLocal",
  "ImageLocal",
  "MapLocal",
  "NumberLocal",
  "resLocal",
  "UnitLocal",
]);

const EXPANDED_STATES = new Set(["confirmed", "expanded"]);
const VERSION_STATES = new Set(["confirmed", "expanded", "archived", "skipped"]);
const COMPATIBILITY_STATES = new Set(["compatible", "incompatible"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function readApkLedger(ledgerPath) {
  let source;
  try {
    source = await readFile(ledgerPath, "utf8");
  } catch (error) {
    throw new Error(`APK ledger could not be read: ${ledgerPath}`, { cause: error });
  }
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`APK ledger is not valid JSON: ${ledgerPath}`, { cause: error });
  }
}

export async function readCurrentVersion(versionPath) {
  let source;
  try {
    source = await readFile(versionPath, "utf8");
  } catch (error) {
    throw new Error(`Current version metadata could not be read: ${versionPath}`, { cause: error });
  }
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Current version metadata is not valid JSON: ${versionPath}`, { cause: error });
  }
}

export function validateCurrentVersion(metadata, versionRecord) {
  assertPlainObject(metadata, "Current version metadata");
  assertExactKeys(metadata, [
    "schemaVersion",
    "packageName",
    "versionName",
    "versionCode",
    "compactVersion",
    "mergedApkSha256",
    "signingCertificateSha256",
    "source",
  ], "Current version metadata");
  if (metadata.schemaVersion !== CURRENT_VERSION_SCHEMA_VERSION) {
    throw new Error(`Unsupported current version schemaVersion: ${metadata.schemaVersion}`);
  }
  if (typeof metadata.packageName !== "string" || !/^[a-z][a-z0-9_.]+$/.test(metadata.packageName)) {
    throw new Error("Current version packageName is invalid.");
  }
  if (typeof metadata.versionName !== "string" || !/^\d+\.\d+\.\d+$/.test(metadata.versionName)) {
    throw new Error("Current version versionName is invalid.");
  }
  assertPositiveInteger(metadata.versionCode, "Current version versionCode");
  if (typeof metadata.compactVersion !== "string" || !/^\d+$/.test(metadata.compactVersion)) {
    throw new Error("Current version compactVersion is invalid.");
  }
  for (const field of ["mergedApkSha256", "signingCertificateSha256"]) {
    if (typeof metadata[field] !== "string" || !SHA256_PATTERN.test(metadata[field])) {
      throw new Error(`Current version ${field} must be a lowercase SHA-256 digest.`);
    }
  }
  if (typeof metadata.source !== "string" || metadata.source.trim() === "") {
    throw new Error("Current version source must be a non-empty string.");
  }

  for (const field of [
    "packageName",
    "versionName",
    "versionCode",
    "compactVersion",
    "mergedApkSha256",
    "signingCertificateSha256",
    "source",
  ]) {
    if (metadata[field] !== versionRecord[field]) {
      throw new Error(`Current version ${field} does not match the confirmed APK ledger record.`);
    }
  }
  return metadata;
}

export function validateApkLedgerSchema(ledger) {
  assertPlainObject(ledger, "APK ledger");
  assertExactKeys(ledger, [
    "schemaVersion",
    "packageName",
    "latestConfirmed",
    "retention",
    "versions",
  ], "APK ledger");
  if (ledger.schemaVersion !== APK_LEDGER_SCHEMA_VERSION) {
    throw new Error(`Unsupported APK ledger schemaVersion: ${ledger.schemaVersion}`);
  }
  if (typeof ledger.packageName !== "string" || !/^[a-z][a-z0-9_.]+$/.test(ledger.packageName)) {
    throw new Error("APK ledger packageName is invalid.");
  }
  assertPlainObject(ledger.latestConfirmed, "latestConfirmed");
  assertExactKeys(
    ledger.latestConfirmed,
    ["versionName", "versionCode", "compactVersion"],
    "latestConfirmed",
  );
  if (typeof ledger.latestConfirmed.versionName !== "string" || !/^\d+\.\d+\.\d+$/.test(ledger.latestConfirmed.versionName)) {
    throw new Error("latestConfirmed.versionName is invalid.");
  }
  if (typeof ledger.latestConfirmed.compactVersion !== "string" || !/^\d+$/.test(ledger.latestConfirmed.compactVersion)) {
    throw new Error("latestConfirmed.compactVersion must be a decimal string.");
  }
  assertPositiveInteger(ledger.latestConfirmed.versionCode, "latestConfirmed.versionCode");
  assertPlainObject(ledger.retention, "retention");
  assertExactKeys(
    ledger.retention,
    ["maxExpandedVersions", "maxExpandedBytes"],
    "retention",
  );
  assertPositiveInteger(ledger.retention.maxExpandedVersions, "retention.maxExpandedVersions");
  assertPositiveInteger(ledger.retention.maxExpandedBytes, "retention.maxExpandedBytes");
  if (!Array.isArray(ledger.versions) || ledger.versions.length === 0) {
    throw new Error("APK ledger versions must be a non-empty array.");
  }

  const versionCodes = new Set();
  const compactVersions = new Set();
  let confirmedCount = 0;
  let previousVersionCode = Number.POSITIVE_INFINITY;
  for (const [index, record] of ledger.versions.entries()) {
    validateVersionRecord(record, index);
    if (record.packageName !== ledger.packageName) {
      throw new Error(`versions[${index}].packageName must match the ledger packageName.`);
    }
    if (record.versionCode >= previousVersionCode) {
      throw new Error("APK ledger versions must be sorted by versionCode descending.");
    }
    previousVersionCode = record.versionCode;
    if (versionCodes.has(record.versionCode)) {
      throw new Error(`Duplicate APK versionCode: ${record.versionCode}`);
    }
    if (compactVersions.has(record.compactVersion)) {
      throw new Error(`Duplicate APK compactVersion: ${record.compactVersion}`);
    }
    versionCodes.add(record.versionCode);
    compactVersions.add(record.compactVersion);
    if (record.state === "confirmed") confirmedCount += 1;
  }
  if (confirmedCount !== 1) {
    throw new Error(`APK ledger must contain exactly one confirmed version; found ${confirmedCount}.`);
  }

  const selected = ledger.versions.find(record => (
    record.compactVersion === ledger.latestConfirmed.compactVersion
  ));
  if (!selected || selected.state !== "confirmed" || selected.compatibility !== "compatible") {
    throw new Error("latestConfirmed.compactVersion must reference the compatible confirmed version.");
  }
  if (selected.versionCode !== ledger.latestConfirmed.versionCode) {
    throw new Error("latestConfirmed.versionCode does not match the referenced compactVersion record.");
  }
  if (selected.versionName !== ledger.latestConfirmed.versionName) {
    throw new Error("latestConfirmed.versionName does not match the referenced compactVersion record.");
  }

  const expanded = ledger.versions.filter(record => EXPANDED_STATES.has(record.state));
  if (expanded.length > ledger.retention.maxExpandedVersions) {
    throw new Error(
      `Expanded APK count ${expanded.length} exceeds limit ${ledger.retention.maxExpandedVersions}.`,
    );
  }
  const expandedBytes = expanded.reduce((sum, record) => sum + record.size, 0);
  if (expandedBytes > ledger.retention.maxExpandedBytes) {
    throw new Error(
      `Expanded APK bytes ${expandedBytes} exceed limit ${ledger.retention.maxExpandedBytes}.`,
    );
  }
  return { selected, expanded, expandedBytes };
}

export async function validateApkLedger(ledger, apksRoot, options = {}) {
  const schema = validateApkLedgerSchema(ledger);
  const entries = await readdir(apksRoot, { withFileTypes: true });
  const actualDirectories = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(compareText);
  const expectedDirectories = schema.expanded
    .map(record => record.compactVersion)
    .sort(compareText);
  if (!arraysEqual(actualDirectories, expectedDirectories)) {
    throw new Error(
      `Expanded APK directories do not match the ledger: actual=${actualDirectories.join(",")} expected=${expectedDirectories.join(",")}`,
    );
  }

  const inspections = new Map();
  if (options.inspectFiles !== false) {
    for (const record of schema.expanded) {
      const expandedRoot = path.join(apksRoot, record.compactVersion);
      const inspection = await inspectExpandedApk(expandedRoot, options.concurrency);
      if (inspection.fileCount !== record.fileCount) {
        throw new Error(
          `APK ${record.compactVersion} fileCount mismatch: ledger=${record.fileCount} actual=${inspection.fileCount}`,
        );
      }
      if (inspection.size !== record.size) {
        throw new Error(
          `APK ${record.compactVersion} size mismatch: ledger=${record.size} actual=${inspection.size}`,
        );
      }
      if (inspection.sha256 !== record.sha256) {
        throw new Error(`APK ${record.compactVersion} SHA-256 mismatch.`);
      }
      inspections.set(record.compactVersion, inspection);
    }
  }
  return { ...schema, inspections };
}

export async function inspectExpandedApk(expandedRoot, concurrency = 16) {
  const entries = await readdir(expandedRoot, { withFileTypes: true });
  const actualRoots = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(compareText);
  const expectedRoots = [...REQUIRED_APK_ROOTS].sort(compareText);
  const rootFiles = entries.filter(entry => entry.isFile()).map(entry => entry.name);
  const unsupported = entries.filter(entry => !entry.isDirectory() && !entry.isFile());
  if (!arraysEqual(actualRoots, expectedRoots) || rootFiles.length > 0 || unsupported.length > 0) {
    throw new Error(
      `Expanded APK does not match the required raw layout at ${expandedRoot}.`,
    );
  }

  const files = await listFiles(expandedRoot);
  await mapConcurrent(files, concurrency, async file => {
    file.sha256 = await sha256File(file.absolutePath);
  });
  const treeHash = createHash("sha256");
  let size = 0;
  for (const file of files) {
    size += file.size;
    treeHash.update(file.relativePath);
    treeHash.update("\0");
    treeHash.update(String(file.size));
    treeHash.update("\0");
    treeHash.update(file.sha256);
    treeHash.update("\n");
  }
  return {
    fileCount: files.length,
    size,
    sha256: treeHash.digest("hex"),
    files,
  };
}

export function getLatestConfirmedVersion(ledger) {
  const { selected } = validateApkLedgerSchema(ledger);
  return selected;
}

export function isExpandedState(state) {
  return EXPANDED_STATES.has(state);
}

export async function listFiles(rootPath) {
  const files = [];
  await walk(rootPath, rootPath, files);
  return files.sort((left, right) => compareText(left.relativePath, right.relativePath));
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function mapConcurrent(items, concurrency = 16, callback) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error("concurrency must be an integer between 1 and 64.");
  }
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await callback(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

export function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateVersionRecord(record, index) {
  const label = `versions[${index}]`;
  assertPlainObject(record, label);
  assertExactKeys(record, [
    "versionName",
    "versionCode",
    "compactVersion",
    "packageName",
    "source",
    "compatibility",
    "state",
    "reason",
    "mergedApkSha256",
    "signingCertificateSha256",
    "sha256",
    "size",
    "fileCount",
    "expandedPath",
    "archive",
  ], label);
  if (typeof record.versionName !== "string" || !/^\d+\.\d+\.\d+$/.test(record.versionName)) {
    throw new Error(`${label}.versionName must use major.minor.patch.`);
  }
  assertPositiveInteger(record.versionCode, `${label}.versionCode`);
  if (typeof record.compactVersion !== "string" || !/^\d+$/.test(record.compactVersion)) {
    throw new Error(`${label}.compactVersion must be a decimal directory key.`);
  }
  if (!COMPATIBILITY_STATES.has(record.compatibility)) {
    throw new Error(`${label}.compatibility is invalid.`);
  }
  if (!VERSION_STATES.has(record.state)) {
    throw new Error(`${label}.state is invalid.`);
  }
  if (typeof record.source !== "string" || record.source.trim() === "") {
    throw new Error(`${label}.source must be a non-empty string.`);
  }
  if (typeof record.packageName !== "string" || !/^[a-z][a-z0-9_.]+$/.test(record.packageName)) {
    throw new Error(`${label}.packageName is invalid.`);
  }
  assertNonNegativeInteger(record.size, `${label}.size`);
  assertNonNegativeInteger(record.fileCount, `${label}.fileCount`);
  if (typeof record.sha256 !== "string" || !SHA256_PATTERN.test(record.sha256)) {
    throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest.`);
  }
  for (const field of ["mergedApkSha256", "signingCertificateSha256"]) {
    if (typeof record[field] !== "string" || !SHA256_PATTERN.test(record[field])) {
      throw new Error(`${label}.${field} must be a lowercase SHA-256 digest.`);
    }
  }

  if (EXPANDED_STATES.has(record.state)) {
    if (record.compatibility !== "compatible") {
      throw new Error(`${label} must be compatible while expanded.`);
    }
    if (record.expandedPath !== `jp/apks/${record.compactVersion}`) {
      throw new Error(`${label}.expandedPath must match jp/apks/<compactVersion>.`);
    }
  }
  if (record.state === "archived") {
    if (record.compatibility !== "compatible" || record.archive === null) {
      throw new Error(`${label} archived versions must be compatible and have archive metadata.`);
    }
  }
  if (!EXPANDED_STATES.has(record.state) && record.expandedPath !== null) {
    throw new Error(`${label}.expandedPath must be null unless the version is expanded.`);
  }
  if (record.archive !== null) validateArchive(record.archive, `${label}.archive`);
  if (record.compatibility === "incompatible") {
    if (record.state !== "skipped" || typeof record.reason !== "string" || record.reason.trim() === "") {
      throw new Error(`${label} incompatible versions must be skipped with a reason.`);
    }
  } else {
    if (record.state === "skipped") {
      throw new Error(`${label} skipped versions must be incompatible.`);
    }
    if (record.reason !== null) {
      throw new Error(`${label}.reason must be null for compatible versions.`);
    }
  }
}

function validateArchive(archive, label) {
  assertPlainObject(archive, label);
  assertExactKeys(
    archive,
    ["provider", "repository", "tag", "releaseUrl", "assets"],
    label,
  );
  if (typeof archive.provider !== "string" || archive.provider.trim() === "") {
    throw new Error(`${label}.provider must be a non-empty string.`);
  }
  if (typeof archive.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(archive.repository)) {
    throw new Error(`${label}.repository must use owner/name.`);
  }
  if (typeof archive.tag !== "string" || archive.tag.trim() === "") {
    throw new Error(`${label}.tag must be a non-empty string.`);
  }
  assertHttpsUrl(archive.releaseUrl, `${label}.releaseUrl`);
  if (!Array.isArray(archive.assets) || archive.assets.length === 0) {
    throw new Error(`${label}.assets must be a non-empty array.`);
  }
  let previousName = "";
  const names = new Set();
  const apiIds = new Set();
  for (const [index, asset] of archive.assets.entries()) {
    const assetLabel = `${label}.assets[${index}]`;
    assertPlainObject(asset, assetLabel);
    assertExactKeys(asset, ["name", "url", "bytes", "sha256", "apiId"], assetLabel);
    if (typeof asset.name !== "string" || asset.name.trim() === "") {
      throw new Error(`${assetLabel}.name must be a non-empty string.`);
    }
    if (asset.name <= previousName || names.has(asset.name)) {
      throw new Error(`${label}.assets must have unique names sorted ascending.`);
    }
    previousName = asset.name;
    names.add(asset.name);
    assertHttpsUrl(asset.url, `${assetLabel}.url`);
    assertNonNegativeInteger(asset.bytes, `${assetLabel}.bytes`);
    if (typeof asset.sha256 !== "string" || !SHA256_PATTERN.test(asset.sha256)) {
      throw new Error(`${assetLabel}.sha256 must be a lowercase SHA-256 digest.`);
    }
    assertPositiveInteger(asset.apiId, `${assetLabel}.apiId`);
    if (apiIds.has(asset.apiId)) throw new Error(`${label}.assets apiId values must be unique.`);
    apiIds.add(asset.apiId);
  }
}

async function walk(rootPath, currentPath, files) {
  const entries = (await readdir(currentPath, { withFileTypes: true }))
    .sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walk(rootPath, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported filesystem entry: ${absolutePath}`);
    }
    const fileStat = await stat(absolutePath);
    files.push({
      absolutePath,
      relativePath: toPosixPath(path.relative(rootPath, absolutePath)),
      size: fileStat.size,
    });
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  if (!arraysEqual(actual, expected)) {
    throw new Error(`${label} fields are invalid: ${actual.join(",")}`);
  }
}

function assertHttpsUrl(value, label) {
  if (typeof value !== "string" || !/^https:\/\//.test(value)) {
    throw new Error(`${label} must be an HTTPS URL.`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toPosixPath(value) {
  return value.replaceAll("\\", "/");
}
