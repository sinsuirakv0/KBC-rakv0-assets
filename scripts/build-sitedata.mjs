import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_APK_ROOTS,
  compareText,
  listFiles,
  mapConcurrent,
  readApkLedger,
  readCurrentVersion,
  sha256File,
  validateApkLedger,
  validateCurrentVersion,
} from "./apk-ledger.mjs";
import { createCharacterIndex } from "./build-character-index.mjs";

export const SITE_DATA_GROUPS = Object.freeze([
  "assets",
  "Data",
  "Download",
  "Html",
  "ImageData",
  "Image",
  "Map",
  "Number",
  "res",
  "Unit",
]);

export const GENERATED_METADATA_FILES = Object.freeze([
  "asset-index.json",
  "build-report.json",
  "character-index.json",
  "README.md",
]);

const LOCAL_ROOTS = Object.freeze({
  assets: { outputGroup: "assets", family: null },
  DataLocal: { outputGroup: "Data", family: "data" },
  DownloadLocal: { outputGroup: "Download", family: "download" },
  HtmlLocal: { outputGroup: "Html", family: "html" },
  ImageDataLocal: { outputGroup: "ImageData", family: "image-data" },
  ImageLocal: { outputGroup: "Image", family: "image" },
  MapLocal: { outputGroup: "Map", family: "map" },
  NumberLocal: { outputGroup: "Number", family: "number" },
  resLocal: { outputGroup: "res", family: "resource" },
  UnitLocal: { outputGroup: "Unit", family: "unit" },
});

const OLD_CLASSIFIED_GROUPS = Object.freeze([
  "animation-assets",
  "downloads",
  "enemies",
  "game-data",
  "html",
  "images",
  "maps",
  "number-assets",
  "resources",
  "unit-assets",
  "units",
]);

export class BuildConflictError extends Error {
  constructor(message, collisions) {
    super(message);
    this.name = "BuildConflictError";
    this.collisions = collisions;
  }
}

export function resolveLocalRoot(rootName) {
  const source = LOCAL_ROOTS[rootName];
  if (!source) throw new Error(`Unsupported APK raw root: ${rootName}`);
  return {
    ...source,
    generation: "local",
    priority: 0,
  };
}

export function resolveServerRoot(rootName) {
  const match = rootName.match(/^([A-Z]?)(ImageData|Image|Map|Number|Unit)Server$/);
  if (!match) throw new Error(`Unsupported server raw root: ${rootName}`);
  const [, prefix, familyName] = match;
  const outputGroup = {
    ImageData: "ImageData",
    Image: "Image",
    Map: "Map",
    Number: "Number",
    Unit: "Unit",
  }[familyName];
  return {
    outputGroup,
    family: {
      ImageData: "image-data",
      Image: "image",
      Map: "map",
      Number: "number",
      Unit: "unit",
    }[familyName],
    generation: prefix || "base",
    priority: 100 + (prefix ? prefix.charCodeAt(0) - 64 : 0),
  };
}

export async function scanBuildInputs({ repoRoot, apkRoot, serverRoot }) {
  const candidates = [];
  for (const rootName of REQUIRED_APK_ROOTS) {
    candidates.push(...await scanRawRoot({
      repoRoot,
      parentRoot: apkRoot,
      rootName,
      sourceKind: "apk",
      source: resolveLocalRoot(rootName),
    }));
  }

  const serverEntries = await import("node:fs/promises").then(module => (
    module.readdir(serverRoot, { withFileTypes: true })
  ));
  for (const entry of serverEntries.sort((left, right) => compareText(left.name, right.name))) {
    if (!entry.isDirectory()) {
      throw new Error(`Unsupported entry in server root: ${path.join(serverRoot, entry.name)}`);
    }
    candidates.push(...await scanRawRoot({
      repoRoot,
      parentRoot: serverRoot,
      rootName: entry.name,
      sourceKind: "server",
      source: resolveServerRoot(entry.name),
    }));
  }
  return candidates.sort(compareCandidate);
}

export async function createBuildPlan(options) {
  const candidates = options.candidates ?? await scanBuildInputs(options);
  const rawDecision = await selectCandidates(candidates, candidate => candidate.outputPath);
  if (rawDecision.collisions.length > 0) {
    throw new BuildConflictError(
      `Found ${rawDecision.collisions.length} same-priority raw path collisions.`,
      rawDecision.collisions,
    );
  }

  const selected = rawDecision.selected.sort((left, right) => (
    compareText(left.outputPath, right.outputPath)
  ));

  return {
    candidates,
    selected,
    overwrites: rawDecision.overwrites,
    identicalDuplicates: rawDecision.identicalDuplicates,
    collisions: [],
  };
}

export async function hashSelectedFiles(plan, concurrency = 16) {
  await mapConcurrent(plan.selected, concurrency, async candidate => {
    candidate.sha256 ??= await sha256File(candidate.sourcePath);
  });
  return plan;
}

export function createAssetIndex(plan, versionRecord) {
  const files = {};
  for (const candidate of plan.selected) {
    if (!candidate.sha256) throw new Error(`Missing SHA-256 for ${candidate.outputPath}`);
    files[candidate.outputPath] = {
      size: candidate.size,
      sha256: candidate.sha256,
      source: toSourceRecord(candidate),
    };
  }
  return {
    schemaVersion: 1,
    gameVersion: versionRecord.versionName,
    versionCode: versionRecord.versionCode,
    files,
  };
}

export function createBuildReport(plan, versionRecord) {
  const sourceSummary = new Map();
  for (const candidate of plan.selected) {
    const key = `${candidate.sourceKind}:${candidate.sourceRoot}`;
    const current = sourceSummary.get(key) ?? {
      kind: candidate.sourceKind,
      root: candidate.sourceRoot,
      generation: candidate.generation,
      priority: candidate.priority,
      fileCount: 0,
      size: 0,
    };
    current.fileCount += 1;
    current.size += candidate.size;
    sourceSummary.set(key, current);
  }
  return {
    schemaVersion: 1,
    gameVersion: versionRecord.versionName,
    versionCode: versionRecord.versionCode,
    scannedFileCount: plan.candidates.length,
    selectedFileCount: plan.selected.length,
    selectedSources: [...sourceSummary.values()].sort((left, right) => (
      left.priority - right.priority || compareText(left.root, right.root)
    )),
    overwrites: plan.overwrites,
    identicalDuplicates: plan.identicalDuplicates,
    collisions: plan.collisions,
  };
}

export async function applyBuildPlan({
  plan,
  versionRecord,
  outputRoot,
  inputRoots,
  concurrency = 16,
}) {
  await assertSafeOutput(outputRoot, inputRoots);
  await hashSelectedFiles(plan, concurrency);
  const previousCharacterIndex = await readExistingCharacterIndex(outputRoot);
  const characterIndex = await createCharacterIndex({
    versionRecord,
    files: plan.selected.map(candidate => ({
      relativePath: candidate.outputPath,
      absolutePath: candidate.sourcePath,
    })),
    previousIndex: previousCharacterIndex,
  });
  const parentRoot = path.dirname(outputRoot);
  const stageRoot = path.join(parentRoot, `.sitedata-build-${process.pid}-${Date.now()}`);
  const backupRoot = path.join(parentRoot, `.sitedata-backup-${process.pid}-${Date.now()}`);
  await cleanupStaleBuildDirectories(parentRoot);
  await rm(stageRoot, { recursive: true, force: true });
  await rm(backupRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });

  try {
    for (const group of SITE_DATA_GROUPS) {
      await mkdir(path.join(stageRoot, group), { recursive: true });
    }
    await mapConcurrent(plan.selected, concurrency, async candidate => {
      const destination = path.join(stageRoot, ...candidate.outputPath.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(candidate.sourcePath, destination);
    });

    const metadata = [
      ["asset-index.json", createAssetIndex(plan, versionRecord)],
      ["build-report.json", createBuildReport(plan, versionRecord)],
      ["character-index.json", characterIndex],
    ];
    for (const [filename, payload] of metadata) {
      await writeFile(
        path.join(stageRoot, filename),
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8",
      );
    }
    await writeFile(path.join(stageRoot, "README.md"), await readSitedataReadme());

    let movedExisting = false;
    try {
      await rename(outputRoot, backupRoot);
      movedExisting = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(stageRoot, outputRoot);
    } catch (error) {
      if (movedExisting) await rename(backupRoot, outputRoot);
      throw error;
    }
    if (movedExisting) await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function loadBuildContext(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ));
  const apksRoot = path.resolve(options.apksRoot ?? path.join(repoRoot, "jp", "apks"));
  const serverRoot = path.resolve(options.serverRoot ?? path.join(repoRoot, "jp", "server"));
  const outputRoot = path.resolve(options.outputRoot ?? path.join(repoRoot, "jp", "sitedata"));
  const ledgerPath = path.resolve(options.ledgerPath ?? path.join(apksRoot, "index.json"));
  const versionPath = path.resolve(options.versionPath ?? path.join(repoRoot, "jp", "version.json"));
  const ledger = await readApkLedger(ledgerPath);
  const ledgerValidation = await validateApkLedger(ledger, apksRoot, {
    concurrency: options.concurrency,
    inspectFiles: options.inspectLedgerFiles !== false,
  });
  const versionRecord = ledgerValidation.selected;
  const currentVersion = await readCurrentVersion(versionPath);
  validateCurrentVersion(currentVersion, versionRecord);
  const apkRoot = path.resolve(repoRoot, ...versionRecord.expandedPath.split("/"));
  return {
    repoRoot,
    apksRoot,
    serverRoot,
    outputRoot,
    ledgerPath,
    versionPath,
    ledger,
    currentVersion,
    ledgerValidation,
    versionRecord,
    apkRoot,
  };
}

export async function buildSitedata(options = {}) {
  const concurrency = options.concurrency ?? 16;
  const context = await loadBuildContext({ ...options, concurrency });
  const plan = await createBuildPlan({
    repoRoot: context.repoRoot,
    apkRoot: context.apkRoot,
    serverRoot: context.serverRoot,
  });
  if (!options.dryRun) {
    await applyBuildPlan({
      plan,
      versionRecord: context.versionRecord,
      outputRoot: context.outputRoot,
      inputRoots: [context.apkRoot, context.serverRoot],
      concurrency,
    });
  }
  return { context, plan, summary: summarizePlan(plan, context.versionRecord) };
}

export function summarizePlan(plan, versionRecord) {
  let totalSize = 0;
  let largest = null;
  for (const candidate of plan.selected) {
    totalSize += candidate.size;
    if (!largest || candidate.size > largest.size || (
      candidate.size === largest.size && compareText(candidate.outputPath, largest.path) < 0
    )) {
      largest = { path: candidate.outputPath, size: candidate.size };
    }
  }
  return {
    gameVersion: versionRecord.versionName,
    versionCode: versionRecord.versionCode,
    scannedFileCount: plan.candidates.length,
    selectedFileCount: plan.selected.length,
    totalSize,
    largestFile: largest,
    overwriteCount: plan.overwrites.length,
    identicalDuplicateCount: plan.identicalDuplicates.length,
  };
}

export async function readSitedataReadme() {
  return readFile(new URL("../templates/sitedata-README.md", import.meta.url));
}

async function readExistingCharacterIndex(outputRoot) {
  try {
    const source = await readFile(path.join(outputRoot, "character-index.json"), "utf8");
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error("Existing character-index.json is invalid JSON.", { cause: error });
    }
    throw error;
  }
}

export async function selectCandidates(candidates, keySelector) {
  const selectedByPath = new Map();
  const overwrites = [];
  const identicalDuplicates = [];
  const collisions = [];
  for (const candidate of [...candidates].sort((left, right) => (
    compareText(keySelector(left), keySelector(right)) || compareCandidate(left, right)
  ))) {
    const decisionPath = keySelector(candidate);
    const previous = selectedByPath.get(decisionPath);
    if (!previous) {
      selectedByPath.set(decisionPath, candidate);
      continue;
    }
    const sameContent = await candidatesEqual(previous, candidate);
    const winner = chooseWinner(previous, candidate);
    const loser = winner === previous ? candidate : previous;
    if (sameContent) {
      selectedByPath.set(decisionPath, winner);
      identicalDuplicates.push(createDecision(decisionPath, winner, loser));
      continue;
    }
    if (previous.priority === candidate.priority) {
      collisions.push({
        path: decisionPath,
        sources: [toSourceRecord(previous), toSourceRecord(candidate)],
      });
      continue;
    }
    selectedByPath.set(decisionPath, winner);
    overwrites.push(createDecision(decisionPath, winner, loser));
  }
  return {
    selected: [...selectedByPath.values()],
    overwrites,
    identicalDuplicates,
    collisions,
  };
}

export async function findOldClassifiedPaths(repoRoot) {
  const { access } = await import("node:fs/promises");
  const found = [];
  for (const group of OLD_CLASSIFIED_GROUPS) {
    try {
      await access(path.join(repoRoot, group));
      found.push(group);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return found;
}

async function scanRawRoot({ repoRoot, parentRoot, rootName, sourceKind, source }) {
  const sourceRoot = path.join(parentRoot, rootName);
  const files = await listFiles(sourceRoot);
  return files.map(file => ({
    sourcePath: file.absolutePath,
    sourceRepoPath: toPosixPath(path.relative(repoRoot, file.absolutePath)),
    sourceRelativePath: file.relativePath,
    sourceKind,
    sourceRoot: rootName,
    generation: source.generation,
    priority: source.priority,
    family: source.family,
    outputGroup: source.outputGroup,
    outputPath: `${source.outputGroup}/${file.relativePath}`,
    size: file.size,
  }));
}

async function candidatesEqual(left, right) {
  if (left.size !== right.size) return false;
  left.sha256 ??= await sha256File(left.sourcePath);
  right.sha256 ??= await sha256File(right.sourcePath);
  return left.sha256 === right.sha256;
}

function chooseWinner(left, right) {
  if (left.priority !== right.priority) return left.priority > right.priority ? left : right;
  return compareCandidate(left, right) <= 0 ? left : right;
}

function compareCandidate(left, right) {
  return left.priority - right.priority
    || compareText(left.sourceRepoPath, right.sourceRepoPath)
    || compareText(left.outputPath, right.outputPath);
}

function createDecision(decisionPath, winner, loser) {
  return {
    path: decisionPath,
    winner: toSourceRecord(winner),
    replaced: toSourceRecord(loser),
  };
}

function toSourceRecord(candidate) {
  return {
    kind: candidate.sourceKind,
    root: candidate.sourceRoot,
    generation: candidate.generation,
    priority: candidate.priority,
    path: candidate.sourceRepoPath,
  };
}

async function assertSafeOutput(outputRoot, inputRoots) {
  const resolvedOutput = path.resolve(outputRoot);
  if (resolvedOutput === path.parse(resolvedOutput).root) {
    throw new Error("Filesystem root cannot be used as sitedata output.");
  }
  for (const inputRoot of inputRoots.map(value => path.resolve(value))) {
    if (resolvedOutput === inputRoot || inputRoot.startsWith(`${resolvedOutput}${path.sep}`)) {
      throw new Error(`Sitedata output must not contain an input root: ${resolvedOutput}`);
    }
  }
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
}

async function cleanupStaleBuildDirectories(parentRoot) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(parentRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(".sitedata-build-")) continue;
    const stalePath = path.resolve(parentRoot, entry.name);
    if (path.dirname(stalePath) !== path.resolve(parentRoot)) {
      throw new Error(`Unsafe stale build path: ${stalePath}`);
    }
    await rm(stalePath, { recursive: true, force: true });
  }
}

function toPosixPath(value) {
  return value.replaceAll("\\", "/");
}

function parseArguments(argv) {
  const options = { concurrency: 16, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root") options.repoRoot = requireValue(argv, ++index, argument);
    else if (argument === "--ledger") options.ledgerPath = requireValue(argv, ++index, argument);
    else if (argument === "--server-root") options.serverRoot = requireValue(argv, ++index, argument);
    else if (argument === "--output") options.outputRoot = requireValue(argv, ++index, argument);
    else if (argument === "--concurrency") options.concurrency = Number(requireValue(argv, ++index, argument));
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 64) {
    throw new Error("--concurrency must be an integer between 1 and 64.");
  }
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function printHelp() {
  process.stdout.write(
    "Usage: node scripts/build-sitedata.mjs [--repo-root <dir>] [--ledger <file>] [--server-root <dir>] [--output <dir>] [--concurrency <1-64>] [--dry-run]\n",
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await buildSitedata(options);
  process.stdout.write(`${JSON.stringify({
    mode: options.dryRun ? "dry-run" : "build",
    ...result.summary,
  }, null, 2)}\n`);
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  main().catch(error => {
    if (error instanceof BuildConflictError) {
      process.stderr.write(`${JSON.stringify({
        error: error.message,
        collisions: error.collisions.slice(0, 20),
      }, null, 2)}\n`);
    } else {
      process.stderr.write(`${error.stack ?? error.message}\n`);
    }
    process.exitCode = 1;
  });
}
