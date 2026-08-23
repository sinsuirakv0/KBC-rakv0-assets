import { isDeepStrictEqual } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareText, listFiles, mapConcurrent, sha256File } from "./apk-ledger.mjs";
import { verifyCharacterIndex } from "./build-character-index.mjs";
import {
  GENERATED_METADATA_FILES,
  SITE_DATA_GROUPS,
  createAssetIndex,
  createBuildPlan,
  createBuildReport,
  findOldClassifiedPaths,
  hashSelectedFiles,
  loadBuildContext,
  readSitedataReadme,
  summarizePlan,
} from "./build-sitedata.mjs";

export async function verifySitedata(options = {}) {
  const concurrency = options.concurrency ?? 16;
  const context = await loadBuildContext({ ...options, concurrency });
  const plan = await createBuildPlan({
    repoRoot: context.repoRoot,
    apkRoot: context.apkRoot,
    serverRoot: context.serverRoot,
  });
  await hashSelectedFiles(plan, concurrency);

  const expectedAssetIndex = createAssetIndex(plan, context.versionRecord);
  const expectedBuildReport = createBuildReport(plan, context.versionRecord);
  const actualAssetIndex = await readJson(path.join(context.outputRoot, "asset-index.json"));
  const actualBuildReport = await readJson(path.join(context.outputRoot, "build-report.json"));
  const actualCharacterIndex = await readJson(path.join(context.outputRoot, "character-index.json"));
  assertDeepEqual(actualAssetIndex, expectedAssetIndex, "asset-index.json is stale or invalid.");
  assertDeepEqual(actualBuildReport, expectedBuildReport, "build-report.json is stale or invalid.");
  const characterSummary = await verifyCharacterIndex({
    actual: actualCharacterIndex,
    versionRecord: context.versionRecord,
    files: plan.selected.map(candidate => ({
      relativePath: candidate.outputPath,
      absolutePath: candidate.sourcePath,
    })),
  });
  const [actualReadme, expectedReadme] = await Promise.all([
    readFile(path.join(context.outputRoot, "README.md")),
    readSitedataReadme(),
  ]);
  if (!actualReadme.equals(expectedReadme) || actualReadme[0] !== 0xef
    || actualReadme[1] !== 0xbb || actualReadme[2] !== 0xbf) {
    throw new Error("sitedata README.md is stale or does not have a UTF-8 BOM.");
  }

  const rootEntries = await readdir(context.outputRoot, { withFileTypes: true });
  const actualGroups = rootEntries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(compareText);
  const expectedGroups = [...SITE_DATA_GROUPS].sort(compareText);
  if (!isDeepStrictEqual(actualGroups, expectedGroups)) {
    throw new Error(`Unexpected sitedata groups: ${actualGroups.join(",")}`);
  }
  const rootFiles = rootEntries.filter(entry => entry.isFile()).map(entry => entry.name).sort(compareText);
  if (!isDeepStrictEqual(rootFiles, [...GENERATED_METADATA_FILES].sort(compareText))) {
    throw new Error(`Unexpected sitedata metadata files: ${rootFiles.join(",")}`);
  }

  const outputFiles = (await listFiles(context.outputRoot))
    .filter(file => !GENERATED_METADATA_FILES.includes(file.relativePath));
  const indexedPaths = Object.keys(actualAssetIndex.files);
  const actualPaths = outputFiles.map(file => file.relativePath);
  if (!isDeepStrictEqual(actualPaths, indexedPaths)) {
    throw new Error("asset-index.json paths do not exactly match sitedata files.");
  }
  await mapConcurrent(outputFiles, concurrency, async file => {
    const indexed = actualAssetIndex.files[file.relativePath];
    if (file.size !== indexed.size) {
      throw new Error(`Size mismatch: ${file.relativePath}`);
    }
    const sha256 = await sha256File(file.absolutePath);
    if (sha256 !== indexed.sha256) {
      throw new Error(`SHA-256 mismatch: ${file.relativePath}`);
    }
  });

  const oldPaths = await findOldClassifiedPaths(context.repoRoot);
  if (oldPaths.length > 0) {
    throw new Error(`Old classified paths remain: ${oldPaths.join(",")}`);
  }
  return {
    ...summarizePlan(plan, context.versionRecord),
    assetIndexCount: indexedPaths.length,
    characterCount: characterSummary.unitCount,
    oldClassifiedPathCount: oldPaths.length,
  };
}

async function readJson(filePath) {
  const source = await readFile(filePath, "utf8");
  try {
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Invalid JSON: ${filePath}`, { cause: error });
  }
}

function assertDeepEqual(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message);
}

function parseArguments(argv) {
  const options = { concurrency: 16 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root") options.repoRoot = requireValue(argv, ++index, argument);
    else if (argument === "--ledger") options.ledgerPath = requireValue(argv, ++index, argument);
    else if (argument === "--server-root") options.serverRoot = requireValue(argv, ++index, argument);
    else if (argument === "--output") options.outputRoot = requireValue(argv, ++index, argument);
    else if (argument === "--concurrency") options.concurrency = Number(requireValue(argv, ++index, argument));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  verifySitedata(parseArguments(process.argv.slice(2)))
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
