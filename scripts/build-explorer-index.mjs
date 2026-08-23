import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareText,
  getLatestConfirmedVersion,
  listFiles,
  mapConcurrent,
  readApkLedger,
  sha256File,
  validateApkLedgerSchema,
} from "./apk-ledger.mjs";

export const EXPLORER_SCHEMA_VERSION = 1;
export const EXPLORER_DATASETS = Object.freeze(["apk", "server", "sitedata"]);

const IMAGE_TYPES = new Map([
  [".avif", "image/avif"], [".bmp", "image/bmp"], [".gif", "image/gif"],
  [".ico", "image/x-icon"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".png", "image/png"], [".webp", "image/webp"],
]);
const TEXT_TYPES = new Map([
  [".cfg", "text/plain; charset=utf-8"], [".conf", "text/plain; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ini", "text/plain; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".lua", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"], [".plist", "application/xml; charset=utf-8"],
  [".properties", "text/plain; charset=utf-8"], [".svg", "image/svg+xml"],
  [".toml", "text/plain; charset=utf-8"], [".tsv", "text/tab-separated-values; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"], [".xml", "application/xml; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"], [".yml", "text/yaml; charset=utf-8"],
]);

export async function buildExplorerIndex(options = {}) {
  const context = await loadExplorerContext(options);
  const previousCatalog = await readCatalogIfPresent(context.catalogPath, context.ledger.packageName);
  const previousSnapshots = indexPreviousSnapshots(previousCatalog);
  const currentSnapshots = await createCurrentSnapshots(context, options.concurrency ?? 16);
  const catalog = createCatalog(context, previousSnapshots, currentSnapshots);
  if (!options.dryRun) await writeExplorerOutput(context, catalog, currentSnapshots);
  return summarizeCatalog(catalog, currentSnapshots);
}

export async function loadExplorerContext(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const apksRoot = path.resolve(options.apksRoot ?? path.join(repoRoot, "jp", "apks"));
  const serverRoot = path.resolve(options.serverRoot ?? path.join(repoRoot, "jp", "server"));
  const sitedataRoot = path.resolve(options.sitedataRoot ?? path.join(repoRoot, "jp", "sitedata"));
  const explorerRoot = path.resolve(options.explorerRoot ?? path.join(repoRoot, "jp", "explorer"));
  const ledger = await readApkLedger(path.join(apksRoot, "index.json"));
  const { selected: latestConfirmed } = validateApkLedgerSchema(ledger);
  return {
    repoRoot, apksRoot, serverRoot, sitedataRoot, explorerRoot,
    catalogPath: path.join(explorerRoot, "catalog.json"), ledger, latestConfirmed,
  };
}

export async function createCurrentSnapshots(context, concurrency) {
  const apkSnapshots = [];
  for (const record of context.ledger.versions) {
    if (record.compatibility !== "compatible" || !["confirmed", "expanded", "archived"].includes(record.state)) continue;
    const rawRoot = `jp/apks/${record.compactVersion}`;
    const absoluteRoot = path.join(context.repoRoot, ...rawRoot.split("/"));
    const available = await isDirectory(absoluteRoot);
    if (!available) continue;
    const manifest = await createManifestFromRoot({
      dataset: "apk", snapshot: record.compactVersion, absoluteRoot, rawRoot, concurrency,
    });
    apkSnapshots.push({
      descriptor: createApkDescriptor(record, manifest, true), manifest,
    });
  }

  const sharedSnapshotId = createSharedSnapshotId(context.latestConfirmed);
  const serverManifest = await createManifestFromRoot({
    dataset: "server", snapshot: sharedSnapshotId, absoluteRoot: context.serverRoot,
    rawRoot: "jp/server", concurrency,
  });
  const sitedataManifest = await createSitedataManifest({
    absoluteRoot: context.sitedataRoot, snapshot: sharedSnapshotId, concurrency,
  });
  return [
    ...apkSnapshots,
    { descriptor: createSharedDescriptor("server", context.latestConfirmed, serverManifest), manifest: serverManifest },
    { descriptor: createSharedDescriptor("sitedata", context.latestConfirmed, sitedataManifest), manifest: sitedataManifest },
  ];
}

export async function createManifestFromRoot({ dataset, snapshot, absoluteRoot, rawRoot, concurrency = 16 }) {
  const files = await listFiles(absoluteRoot);
  const output = {};
  let totalSize = 0;
  await mapConcurrent(files, concurrency, async file => {
    const relativePath = normalizeRelativePath(file.relativePath);
    output[relativePath] = {
      size: file.size,
      sha256: await sha256File(file.absolutePath),
      ...describeFile(relativePath),
    };
  });
  const orderedFiles = orderFiles(output);
  for (const file of Object.values(orderedFiles)) totalSize += file.size;
  return { schemaVersion: EXPLORER_SCHEMA_VERSION, dataset, snapshot, fileCount: files.length, totalSize, files: orderedFiles };
}

export async function createSitedataManifest({ absoluteRoot, snapshot, concurrency = 16 }) {
  const indexPath = path.join(absoluteRoot, "asset-index.json");
  const assetIndex = await readJson(indexPath);
  if (assetIndex?.schemaVersion !== 1 || !isPlainObject(assetIndex.files)) {
    throw new Error("sitedata asset-index.json has an unsupported schema.");
  }
  const rootFiles = await listFiles(absoluteRoot);
  const payloadFiles = rootFiles.filter(file => !isSitedataMetadata(file.relativePath));
  const indexedPaths = Object.keys(assetIndex.files).sort(compareText);
  const actualPaths = payloadFiles.map(file => normalizeRelativePath(file.relativePath));
  if (indexedPaths.length !== actualPaths.length || indexedPaths.some((item, index) => item !== actualPaths[index])) {
    throw new Error("sitedata asset-index.json does not match the payload file list.");
  }
  const files = {};
  await mapConcurrent(payloadFiles, concurrency, async file => {
    const relativePath = normalizeRelativePath(file.relativePath);
    const indexed = assetIndex.files[relativePath];
    if (!isPlainObject(indexed) || !Number.isSafeInteger(indexed.size) || !isSha256(indexed.sha256)) {
      throw new Error(`Invalid sitedata asset index entry: ${relativePath}`);
    }
    if (file.size !== indexed.size) throw new Error(`sitedata size mismatch: ${relativePath}`);
    const sha256 = await sha256File(file.absolutePath);
    if (sha256 !== indexed.sha256) throw new Error(`sitedata SHA-256 mismatch: ${relativePath}`);
    files[relativePath] = { size: file.size, sha256, ...describeFile(relativePath), source: indexed.source };
  });
  const orderedFiles = orderFiles(files);
  return {
    schemaVersion: EXPLORER_SCHEMA_VERSION, dataset: "sitedata", snapshot,
    fileCount: payloadFiles.length,
    totalSize: Object.values(orderedFiles).reduce((sum, item) => sum + item.size, 0),
    files: orderedFiles,
  };
}

export function createCatalog(context, previousSnapshots, currentSnapshots) {
  const currentByKey = new Map(currentSnapshots.map(item => [snapshotKey(item.descriptor.dataset, item.descriptor.id), item]));
  const datasets = {};
  for (const dataset of EXPLORER_DATASETS) {
    const entries = [];
    for (const previous of previousSnapshots.get(dataset) ?? []) {
      const key = snapshotKey(dataset, previous.id);
      if (!currentByKey.has(key)) entries.push({ ...previous, available: false });
    }
    for (const current of currentSnapshots) if (current.descriptor.dataset === dataset) entries.push(current.descriptor);
    datasets[dataset] = { snapshots: entries.sort(compareSnapshots) };
  }
  return {
    schemaVersion: EXPLORER_SCHEMA_VERSION,
    packageName: context.ledger.packageName,
    latestConfirmed: {
      versionName: context.latestConfirmed.versionName,
      versionCode: context.latestConfirmed.versionCode,
      compactVersion: context.latestConfirmed.compactVersion,
    },
    datasets,
  };
}

export function describeFile(relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (IMAGE_TYPES.has(extension)) return { contentType: IMAGE_TYPES.get(extension), previewKind: "image" };
  if (TEXT_TYPES.has(extension)) return { contentType: TEXT_TYPES.get(extension), previewKind: "text" };
  return { contentType: "application/octet-stream", previewKind: "binary" };
}

export function normalizeRelativePath(value) {
  if (typeof value !== "string" || value === "" || value.includes("\\") || value.startsWith("/")) {
    throw new Error(`Unsafe relative path: ${value}`);
  }
  const segments = value.split("/");
  if (segments.some(segment => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Unsafe relative path: ${value}`);
  }
  return value;
}

export function createApkDescriptor(record, manifest, available) {
  return {
    dataset: "apk",
    id: record.compactVersion,
    label: `${record.versionName} (${record.compactVersion})`,
    versionName: record.versionName,
    versionCode: record.versionCode,
    compactVersion: record.compactVersion,
    manifestPath: manifestPath("apk", record.compactVersion),
    rawRoot: `jp/apks/${record.compactVersion}`,
    available,
    fileCount: manifest.fileCount,
    totalSize: manifest.totalSize,
    ...(record.archive ? { archive: record.archive } : {}),
  };
}

function createSharedDescriptor(dataset, version, manifest) {
  return {
    dataset,
    id: manifest.snapshot,
    label: `${version.versionName} (${dataset})`,
    versionName: version.versionName,
    versionCode: version.versionCode,
    compactVersion: version.compactVersion,
    manifestPath: manifestPath(dataset, manifest.snapshot),
    rawRoot: dataset === "server" ? "jp/server" : "jp/sitedata",
    available: true,
    fileCount: manifest.fileCount,
    totalSize: manifest.totalSize,
  };
}

async function writeExplorerOutput(context, catalog, snapshots) {
  const stagingRoot = `${context.explorerRoot}.build-${process.pid}`;
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(path.join(stagingRoot, "manifests"), { recursive: true });
  try {
    for (const dataset of EXPLORER_DATASETS) {
      const oldDirectory = path.join(context.explorerRoot, "manifests", dataset);
      const newDirectory = path.join(stagingRoot, "manifests", dataset);
      await mkdir(newDirectory, { recursive: true });
      if (await isDirectory(oldDirectory)) {
        const entries = await listFiles(oldDirectory);
        for (const entry of entries) {
          const target = path.join(newDirectory, ...normalizeRelativePath(entry.relativePath).split("/"));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, await readFile(entry.absolutePath));
        }
      }
    }
    for (const { descriptor, manifest } of snapshots) {
      const target = path.join(stagingRoot, ...toExplorerRelativePath(descriptor.manifestPath).split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeJson(target, manifest);
    }
    await writeJson(path.join(stagingRoot, "catalog.json"), catalog);
    const backupRoot = `${context.explorerRoot}.backup-${process.pid}`;
    await rm(backupRoot, { recursive: true, force: true });
    let backedUp = false;
    try { await rename(context.explorerRoot, backupRoot); backedUp = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await rename(stagingRoot, context.explorerRoot); } catch (error) { if (backedUp) await rename(backupRoot, context.explorerRoot); throw error; }
    if (backedUp) await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function readCatalogIfPresent(catalogPath, packageName) {
  try {
    const catalog = await readJson(catalogPath);
    validateCatalog(catalog, packageName);
    return catalog;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function indexPreviousSnapshots(catalog) {
  const result = new Map(EXPLORER_DATASETS.map(dataset => [dataset, []]));
  if (!catalog) return result;
  for (const dataset of EXPLORER_DATASETS) result.set(dataset, catalog.datasets[dataset].snapshots);
  return result;
}

export function validateCatalog(catalog, packageName) {
  if (!isPlainObject(catalog) || catalog.schemaVersion !== EXPLORER_SCHEMA_VERSION || catalog.packageName !== packageName || !isPlainObject(catalog.datasets)) {
    throw new Error("Explorer catalog schema is invalid.");
  }
  for (const dataset of EXPLORER_DATASETS) {
    const entry = catalog.datasets[dataset];
    if (!isPlainObject(entry) || !Array.isArray(entry.snapshots)) throw new Error(`Explorer catalog dataset is invalid: ${dataset}`);
    const ids = new Set();
    for (const snapshot of entry.snapshots) {
      validateSnapshot(snapshot, dataset);
      if (ids.has(snapshot.id)) throw new Error(`Duplicate explorer snapshot: ${dataset}/${snapshot.id}`);
      ids.add(snapshot.id);
    }
  }
}

export function validateManifest(manifest) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== EXPLORER_SCHEMA_VERSION || !EXPLORER_DATASETS.includes(manifest.dataset) || !isSafeSnapshotId(manifest.snapshot) || !Number.isSafeInteger(manifest.fileCount) || manifest.fileCount < 0 || !Number.isSafeInteger(manifest.totalSize) || manifest.totalSize < 0 || !isPlainObject(manifest.files)) throw new Error("Explorer manifest schema is invalid.");
  const paths = Object.keys(manifest.files);
  if (paths.length !== manifest.fileCount || !isSorted(paths)) throw new Error("Explorer manifest paths are invalid.");
  let totalSize = 0;
  for (const filePath of paths) {
    normalizeRelativePath(filePath);
    const entry = manifest.files[filePath];
    if (!isPlainObject(entry) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !isSha256(entry.sha256) || typeof entry.contentType !== "string" || !["image", "text", "binary"].includes(entry.previewKind)) throw new Error(`Explorer manifest file is invalid: ${filePath}`);
    if (entry.previewKind === "image" && !IMAGE_TYPES.has(path.posix.extname(filePath).toLowerCase())) throw new Error(`Unsafe image preview type: ${filePath}`);
    totalSize += entry.size;
  }
  if (totalSize !== manifest.totalSize) throw new Error("Explorer manifest total size is invalid.");
}

function validateSnapshot(snapshot, dataset) {
  if (!isPlainObject(snapshot) || !isSafeSnapshotId(snapshot.id) || typeof snapshot.label !== "string" || !/^\d+\.\d+\.\d+$/.test(snapshot.versionName) || !Number.isSafeInteger(snapshot.versionCode) || snapshot.versionCode < 1 || !/^\d+$/.test(snapshot.compactVersion) || snapshot.manifestPath !== manifestPath(dataset, snapshot.id) || typeof snapshot.rawRoot !== "string" || typeof snapshot.available !== "boolean" || !Number.isSafeInteger(snapshot.fileCount) || snapshot.fileCount < 0 || !Number.isSafeInteger(snapshot.totalSize) || snapshot.totalSize < 0) throw new Error(`Explorer snapshot is invalid: ${dataset}`);
  try {
    normalizeRelativePath(snapshot.rawRoot);
  } catch {
    throw new Error(`Explorer snapshot rawRoot is invalid: ${dataset}`);
  }
  if ((dataset === "apk" && snapshot.rawRoot !== `jp/apks/${snapshot.compactVersion}`)
    || (dataset === "server" && snapshot.rawRoot !== "jp/server")
    || (dataset === "sitedata" && snapshot.rawRoot !== "jp/sitedata")) {
    throw new Error(`Explorer snapshot rawRoot is invalid: ${dataset}`);
  }
}

function manifestPath(dataset, snapshot) { return `jp/explorer/manifests/${dataset}/${snapshot}.json`; }
function toExplorerRelativePath(value) {
  const prefix = "jp/explorer/";
  if (!value.startsWith(prefix)) throw new Error(`Unsafe explorer output path: ${value}`);
  return normalizeRelativePath(value.slice(prefix.length));
}
function createSharedSnapshotId(version) { return `v${version.versionName}-${version.compactVersion}`; }
function snapshotKey(dataset, id) { return `${dataset}:${id}`; }
function compareSnapshots(left, right) { return right.versionCode - left.versionCode || compareText(left.id, right.id); }
function orderFiles(files) { return Object.fromEntries(Object.entries(files).sort(([left], [right]) => compareText(left, right))); }
function isSitedataMetadata(relativePath) { return ["asset-index.json", "motion-index.json", "build-report.json", "README.md"].includes(relativePath); }
function isSafeSnapshotId(value) { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value); }
function isSha256(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isSorted(values) { return values.every((value, index) => index === 0 || values[index - 1] < value); }
async function isDirectory(value) { try { return (await stat(value)).isDirectory(); } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function readJson(filePath) { return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, "")); }
async function writeJson(filePath, value) { await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

export function summarizeCatalog(catalog, snapshots = []) {
  const generated = snapshots.map(item => ({ dataset: item.descriptor.dataset, id: item.descriptor.id, fileCount: item.manifest.fileCount, totalSize: item.manifest.totalSize }));
  return { datasetCount: EXPLORER_DATASETS.length, snapshotCount: Object.values(catalog.datasets).reduce((sum, dataset) => sum + dataset.snapshots.length, 0), generated };
}

function parseArguments(argv) {
  const options = { concurrency: 16, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root") options.repoRoot = requireValue(argv, ++index, argument);
    else if (argument === "--concurrency") options.concurrency = Number(requireValue(argv, ++index, argument));
    else if (argument === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 64) throw new Error("--concurrency must be an integer between 1 and 64.");
  return options;
}
function requireValue(argv, index, option) { const value = argv[index]; if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`); return value; }

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) buildExplorerIndex(parseArguments(process.argv.slice(2))).then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
