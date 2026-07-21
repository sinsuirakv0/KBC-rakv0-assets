import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_GROUPS = Object.freeze([
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

const LEGACY_GROUPS = Object.freeze([
  "data",
  "download",
  "image",
  "image-data",
  "map",
  "number",
  "resource",
  "unit",
]);

const PRUNABLE_GROUPS = Object.freeze([...new Set([...MANAGED_GROUPS, ...LEGACY_GROUPS])]);

const LOCAL_ROOT_GROUPS = Object.freeze({
  DataLocal: "data",
  DownloadLocal: "download",
  HtmlLocal: "html",
  ImageDataLocal: "image-data",
  ImageLocal: "image",
  MapLocal: "map",
  NumberLocal: "number",
  resLocal: "resource",
  UnitLocal: "unit",
});

const EXTENSION_TYPES = Object.freeze({
  imgcut: "cut",
  maanim: "animation",
  mamodel: "model",
  png: "image",
});

const VERSION_SUFFIX_PATTERN = /__v\d+(?:\.\d+)+(?:-[a-z0-9_-]+)?$/i;
const SERVER_SUFFIX_PATTERN = /__server-[a-z0-9_-]+$/i;
const NUMBERED_ASSET_PATTERN = /^(\d{3,})_([fcsue])(?:(\d{2}))?\.(png|imgcut|mamodel|maanim)$/i;
const UNIT_UI_PATTERN = /^(uni|udi)(\d{3,})_([fcsu])(?:(\d{2}))?\.png$/i;
const GACHA_UNIT_PATTERN = /^gatyachara_(\d{3,})_([fcsu])\.png$/i;
const UNIT_DATA_PATTERN = /^unit(\d+)\.csv$/i;
const UNIT_EXPLANATION_PATTERN = /^Unit_Explanation(\d+)_([a-z]{2})\.csv$/i;
const ENEMY_ICON_PATTERN = /^enemy_icon_(\d+)\.png$/i;

const SEMANTIC_GROUPS = Object.freeze({
  data: "game-data",
  download: "downloads",
  html: "html",
  image: "images",
  "image-data": "animation-assets",
  map: "maps",
  number: "number-assets",
  resource: "resources",
  unit: "unit-assets",
});

export function normalizeFilename(filename) {
  const extension = path.extname(filename);
  let stem = path.basename(filename, extension);
  stem = stem.replace(VERSION_SUFFIX_PATTERN, "");
  stem = stem.replace(SERVER_SUFFIX_PATTERN, "");
  return `${stem}${extension}`;
}

export function deriveCategory(filename) {
  const normalized = normalizeFilename(filename);
  const extension = path.extname(normalized);
  const stem = path.basename(normalized, extension);
  const category = stem
    .replace(/\d+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return category || "raw";
}

export function classifyAsset({ filename, sourceGroup }) {
  const normalizedFilename = normalizeFilename(filename);
  const extension = path.extname(normalizedFilename).slice(1).toLowerCase() || "raw";
  const numberedMatch = normalizedFilename.match(NUMBERED_ASSET_PATTERN);

  if (
    numberedMatch
    && (sourceGroup === "number" || sourceGroup === "image-data")
  ) {
    const [, id, rawForm, rawMotionIndex] = numberedMatch;
    const form = rawForm.toLowerCase();
    const motionIndex = extension === "maanim" && rawMotionIndex !== undefined
      ? Number(rawMotionIndex)
      : null;
    const entityType = form === "e" ? "enemy" : "unit";
    const entityRoot = entityType === "enemy"
      ? toPosixPath("enemies", formatEntityId(id))
      : toPosixPath("units", formatEntityId(id), form);
    const destination = resolveBattleDestination({
      entityRoot,
      extension,
      rawMotionIndex,
    });
    return {
      relativePath: destination,
      group: entityType === "enemy" ? "enemies" : "units",
      category: form,
      extension,
      assetType: EXTENSION_TYPES[extension] ?? "file",
      entityType,
      entityId: Number(id),
      form,
      motionIndex,
    };
  }

  const unitUiMatch = normalizedFilename.match(UNIT_UI_PATTERN);
  if (unitUiMatch && sourceGroup === "unit") {
    const [, family, id, rawForm, rawVariant] = unitUiMatch;
    const form = rawForm.toLowerCase();
    const variant = rawVariant === undefined ? null : Number(rawVariant);
    const uiFamily = family.toLowerCase() === "uni" ? "thumbnail" : "icon";
    const uiFilename = `${uiFamily}${rawVariant === undefined ? "" : `-${rawVariant}`}.png`;
    return {
      relativePath: toPosixPath("units", formatEntityId(id), form, uiFilename),
      group: "units",
      category: form,
      extension,
      assetType: family.toLowerCase() === "uni" ? "unit-thumbnail" : "unit-icon",
      entityType: "unit",
      entityId: Number(id),
      form,
      variant,
    };
  }

  const gachaUnitMatch = normalizedFilename.match(GACHA_UNIT_PATTERN);
  if (gachaUnitMatch && sourceGroup === "image") {
    const [, id, rawForm] = gachaUnitMatch;
    const form = rawForm.toLowerCase();
    return {
      relativePath: toPosixPath("units", formatEntityId(id), form, "gacha.png"),
      group: "units",
      category: form,
      extension,
      assetType: "gacha-image",
      entityType: "unit",
      entityId: Number(id),
      form,
    };
  }

  const unitDataMatch = normalizedFilename.match(UNIT_DATA_PATTERN);
  if (unitDataMatch && sourceGroup === "data" && Number(unitDataMatch[1]) > 0) {
    const entityId = Number(unitDataMatch[1]) - 1;
    return {
      relativePath: toPosixPath("units", formatEntityId(entityId), "stats.csv"),
      group: "units",
      category: "stats",
      extension,
      assetType: "unit-stats",
      entityType: "unit",
      entityId,
      form: null,
    };
  }

  const explanationMatch = normalizedFilename.match(UNIT_EXPLANATION_PATTERN);
  if (explanationMatch && (sourceGroup === "resource" || sourceGroup === "unit")) {
    const entityId = Number(explanationMatch[1]) - 1;
    if (entityId >= 0) {
      const locale = explanationMatch[2].toLowerCase();
      return {
        relativePath: toPosixPath("units", formatEntityId(entityId), `names-${locale}.csv`),
        group: "units",
        category: "names",
        extension,
        assetType: "unit-names",
        entityType: "unit",
        entityId,
        form: null,
        locale,
      };
    }
  }

  const enemyIconMatch = normalizedFilename.match(ENEMY_ICON_PATTERN);
  if (enemyIconMatch && sourceGroup === "image") {
    const entityId = Number(enemyIconMatch[1]);
    return {
      relativePath: toPosixPath("enemies", formatEntityId(entityId), "icon.png"),
      group: "enemies",
      category: "icon",
      extension,
      assetType: "enemy-icon",
      entityType: "enemy",
      entityId,
      form: "e",
    };
  }

  const category = deriveCategory(normalizedFilename);
  const semanticGroup = SEMANTIC_GROUPS[sourceGroup];
  if (!semanticGroup) throw new Error(`Unsupported semantic group: ${sourceGroup}`);
  return {
    relativePath: toPosixPath(semanticGroup, category, normalizedFilename),
    group: semanticGroup,
    category,
    extension,
    assetType: EXTENSION_TYPES[extension] ?? "file",
    entityType: null,
    entityId: null,
    form: null,
  };
}

export function resolveLocalRoot(rootName) {
  const group = LOCAL_ROOT_GROUPS[rootName];
  if (!group) throw new Error(`Unsupported local root: ${rootName}`);
  return { group, priority: 0, generation: "local" };
}

export function resolveServerRoot(rootName) {
  const match = rootName.match(/^([A-Z]?)(ImageData|Image|Map|Number|Unit)Server$/);
  if (!match) throw new Error(`Unsupported server root: ${rootName}`);
  const [, prefix, family] = match;
  const group = {
    ImageData: "image-data",
    Image: "image",
    Map: "map",
    Number: "number",
    Unit: "unit",
  }[family];
  const generation = prefix || "base";
  const priority = 100 + (prefix ? prefix.charCodeAt(0) - 64 : 0);
  return { group, priority, generation };
}

export async function buildPlan(inputSpecs, options = {}) {
  const candidates = [];
  for (const inputSpec of inputSpecs) {
    candidates.push(...await scanInput(inputSpec));
  }

  const selectedByPath = new Map();
  const duplicates = [];
  const conflicts = [];
  const unresolved = [];

  for (const candidate of candidates.sort(compareCandidateOrder)) {
    const previous = selectedByPath.get(candidate.relativePath);
    if (!previous) {
      selectedByPath.set(candidate.relativePath, candidate);
      continue;
    }

    const sameContent = await filesEqual(previous.sourcePath, candidate.sourcePath);
    if (sameContent) {
      const winner = chooseWinner(previous, candidate);
      const loser = winner === previous ? candidate : previous;
      selectedByPath.set(candidate.relativePath, winner);
      duplicates.push(createDecision(candidate.relativePath, winner, loser));
      continue;
    }

    if (previous.priority === candidate.priority) {
      unresolved.push({
        path: candidate.relativePath,
        sources: [toSourceRecord(previous), toSourceRecord(candidate)],
      });
      continue;
    }

    const winner = chooseWinner(previous, candidate);
    const loser = winner === previous ? candidate : previous;
    selectedByPath.set(candidate.relativePath, winner);
    conflicts.push(createDecision(candidate.relativePath, winner, loser));
  }

  const selected = [...selectedByPath.values()].sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath, "en")
  ));

  if (options.hashAll) {
    await mapConcurrent(selected, options.concurrency ?? 16, async (asset) => {
      asset.sha256 = await sha256File(asset.sourcePath);
    });
  }

  return {
    selected,
    duplicates,
    conflicts,
    unresolved,
    scannedCount: candidates.length,
  };
}

export function analyzeBattleSets(selectedAssets) {
  const expectedFiles = [
    "sprite.png",
    "cuts.imgcut",
    "model.mamodel",
    "animations/00.maanim",
    "animations/01.maanim",
    "animations/02.maanim",
    "animations/03.maanim",
  ];
  const sets = new Map();
  for (const asset of selectedAssets) {
    const match = asset.relativePath.match(
      /^((?:units\/\d+\/[fcsu]|enemies\/\d+))\/(sprite\.png|cuts\.imgcut|model\.mamodel|animations\/(?:00|01|02|03)\.maanim)$/,
    );
    if (!match) continue;
    if (!sets.has(match[1])) sets.set(match[1], new Set());
    sets.get(match[1]).add(match[2]);
  }
  const incomplete = [...sets.entries()]
    .map(([root, files]) => ({ root, missing: expectedFiles.filter(filename => !files.has(filename)) }))
    .filter(result => result.missing.length > 0)
    .sort((left, right) => left.root.localeCompare(right.root, "en"));
  return {
    battleSetCount: sets.size,
    completeBattleSetCount: sets.size - incomplete.length,
    incompleteBattleSetCount: incomplete.length,
    incompleteBattleSets: incomplete,
  };
}

export async function applyPlan(plan, outputRoot, options = {}) {
  if (plan.unresolved.length > 0) {
    throw new Error(`Cannot apply a plan with ${plan.unresolved.length} unresolved conflicts.`);
  }
  await assertSafeOutput(outputRoot, options.inputRoots ?? []);
  await mkdir(outputRoot, { recursive: true });

  await mapConcurrent(plan.selected, options.concurrency ?? 16, async (asset) => {
    const targetPath = path.join(outputRoot, ...asset.relativePath.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    if (!await sameExistingFile(asset.sourcePath, targetPath)) {
      await copyFile(asset.sourcePath, targetPath);
    }
  });

  let prunedCount = 0;
  if (options.prune) {
    prunedCount = await pruneManagedFiles(outputRoot, new Set(plan.selected.map(asset => asset.relativePath)));
  }

  if (options.verify) {
    await verifyPlan(plan, outputRoot, options.concurrency ?? 16);
  }

  const manifestPath = path.join(outputRoot, "asset-index.json");
  const manifest = await createManifest(plan, options.concurrency ?? 16);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, prunedCount };
}

export async function verifyPlan(plan, outputRoot, concurrency = 16) {
  const failures = [];
  await mapConcurrent(plan.selected, concurrency, async (asset) => {
    const targetPath = path.join(outputRoot, ...asset.relativePath.split("/"));
    if (!await sameExistingFile(asset.sourcePath, targetPath)) {
      failures.push(asset.relativePath);
    }
  });
  if (failures.length > 0) {
    throw new Error(`Verification failed for ${failures.length} assets: ${failures.slice(0, 10).join(", ")}`);
  }
}

async function scanInput(inputSpec) {
  const inputRoot = path.resolve(inputSpec.path);
  const rootEntries = await readdir(inputRoot, { withFileTypes: true });
  const assets = [];

  for (const rootEntry of rootEntries) {
    if (!rootEntry.isDirectory()) continue;
    let source;
    try {
      source = inputSpec.kind === "local"
        ? resolveLocalRoot(rootEntry.name)
        : resolveServerRoot(rootEntry.name);
    } catch (error) {
      if (inputSpec.strict !== false) throw error;
      continue;
    }

    const sourceRoot = path.join(inputRoot, rootEntry.name);
    for (const sourcePath of await listFiles(sourceRoot)) {
      const filename = path.basename(sourcePath);
      const classification = classifyAsset({ filename, sourceGroup: source.group });
      const fileStat = await stat(sourcePath);
      assets.push({
        ...classification,
        sourcePath,
        sourceRelativePath: toPosixPath(path.relative(inputRoot, sourcePath)),
        sourceKind: inputSpec.kind,
        sourceRoot: rootEntry.name,
        sourceInput: inputRoot,
        generation: source.generation,
        priority: source.priority + (inputSpec.priorityOffset ?? 0),
        size: fileStat.size,
      });
    }
  }
  return assets;
}

async function createManifest(plan, concurrency) {
  await mapConcurrent(plan.selected, concurrency, async (asset) => {
    asset.sha256 ??= await sha256File(asset.sourcePath);
  });
  return {
    schemaVersion: 1,
    assetCount: plan.selected.length,
    conflictsResolved: plan.conflicts.length,
    duplicatesCollapsed: plan.duplicates.length,
    validation: analyzeBattleSets(plan.selected),
    assets: plan.selected.map(asset => ({
      path: asset.relativePath,
      group: asset.group,
      category: asset.category,
      extension: asset.extension,
      assetType: asset.assetType,
      entityType: asset.entityType,
      entityId: asset.entityId,
      form: asset.form,
      motionIndex: asset.motionIndex ?? null,
      variant: asset.variant ?? null,
      size: asset.size,
      sha256: asset.sha256,
      source: toSourceRecord(asset),
    })),
  };
}

async function pruneManagedFiles(outputRoot, selectedPaths) {
  let count = 0;
  for (const group of PRUNABLE_GROUPS) {
    const groupRoot = path.join(outputRoot, group);
    for (const filePath of await listFilesIfExists(groupRoot)) {
      const relativePath = toPosixPath(path.relative(outputRoot, filePath));
      if (selectedPaths.has(relativePath)) continue;
      await rm(filePath, { force: true });
      count += 1;
    }
    await removeEmptyDirectories(groupRoot);
  }
  return count;
}

async function assertSafeOutput(outputRoot, inputRoots) {
  const resolvedOutput = path.resolve(outputRoot);
  const parsed = path.parse(resolvedOutput);
  if (resolvedOutput === parsed.root) throw new Error("The filesystem root cannot be used as output.");
  for (const inputRoot of inputRoots.map(value => path.resolve(value))) {
    if (resolvedOutput === inputRoot || inputRoot.startsWith(`${resolvedOutput}${path.sep}`)) {
      throw new Error(`Output must not contain an input root: ${resolvedOutput}`);
    }
  }
}

async function listFiles(rootPath) {
  const files = [];
  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function listFilesIfExists(rootPath) {
  try {
    return await listFiles(rootPath);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function removeEmptyDirectories(rootPath) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirectories(path.join(rootPath, entry.name));
  }
  if ((await readdir(rootPath)).length === 0) await rmdir(rootPath);
}

async function filesEqual(leftPath, rightPath) {
  const [leftStat, rightStat] = await Promise.all([stat(leftPath), stat(rightPath)]);
  if (leftStat.size !== rightStat.size) return false;
  const [leftHash, rightHash] = await Promise.all([sha256File(leftPath), sha256File(rightPath)]);
  return leftHash === rightHash;
}

async function sameExistingFile(sourcePath, targetPath) {
  try {
    return await filesEqual(sourcePath, targetPath);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function chooseWinner(left, right) {
  if (left.priority !== right.priority) return left.priority > right.priority ? left : right;
  return compareCandidateOrder(left, right) <= 0 ? left : right;
}

function compareCandidateOrder(left, right) {
  return left.relativePath.localeCompare(right.relativePath, "en")
    || left.priority - right.priority
    || left.sourceRelativePath.localeCompare(right.sourceRelativePath, "en");
}

function createDecision(relativePath, winner, loser) {
  return {
    path: relativePath,
    winner: toSourceRecord(winner),
    loser: toSourceRecord(loser),
  };
}

function toSourceRecord(asset) {
  return {
    kind: asset.sourceKind,
    root: asset.sourceRoot,
    generation: asset.generation,
    priority: asset.priority,
    path: asset.sourceRelativePath,
  };
}

async function mapConcurrent(items, concurrency, callback) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await callback(items[index], index);
    }
  });
  await Promise.all(workers);
}

function toPosixPath(...parts) {
  return parts.filter(Boolean).join("/").replaceAll("\\", "/");
}

function resolveBattleDestination({ entityRoot, extension, rawMotionIndex }) {
  if (extension === "png") return toPosixPath(entityRoot, "sprite.png");
  if (extension === "imgcut") return toPosixPath(entityRoot, "cuts.imgcut");
  if (extension === "mamodel") return toPosixPath(entityRoot, "model.mamodel");
  if (extension === "maanim") {
    const filename = rawMotionIndex === undefined ? "animation.maanim" : `${rawMotionIndex}.maanim`;
    return toPosixPath(entityRoot, "animations", filename);
  }
  throw new Error(`Unsupported battle extension: ${extension}`);
}

function formatEntityId(value) {
  return String(Number(value)).padStart(3, "0");
}

function parseArguments(argv) {
  const options = {
    local: [],
    server: [],
    apply: false,
    prune: false,
    verify: false,
    hashAll: false,
    concurrency: 16,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--local") options.local.push(requireValue(argv, ++index, argument));
    else if (argument === "--server") options.server.push(requireValue(argv, ++index, argument));
    else if (argument === "--output") options.output = requireValue(argv, ++index, argument);
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--prune") options.prune = true;
    else if (argument === "--verify") options.verify = true;
    else if (argument === "--hash-all") options.hashAll = true;
    else if (argument === "--concurrency") options.concurrency = Number(requireValue(argv, ++index, argument));
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
  process.stdout.write(`Usage:\n  node scripts/classify-assets.mjs --local <decrypt-dir> [--server <server-decrypt-dir>] --output <dir> [--apply] [--prune] [--verify] [--hash-all]\n\nDefault mode is a dry run. --prune only removes stale files below managed asset groups.\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.local.length + options.server.length === 0) {
    throw new Error("At least one --local or --server input is required.");
  }
  if (!options.output) throw new Error("--output is required.");
  if (options.prune && !options.apply) throw new Error("--prune requires --apply.");

  const inputSpecs = [
    ...options.server.map(value => ({ kind: "server", path: value })),
    ...options.local.map(value => ({ kind: "local", path: value })),
  ];
  const plan = await buildPlan(inputSpecs, options);
  const validation = analyzeBattleSets(plan.selected);
  process.stdout.write(`${JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    scanned: plan.scannedCount,
    selected: plan.selected.length,
    duplicatesCollapsed: plan.duplicates.length,
    conflictsResolved: plan.conflicts.length,
    unresolved: plan.unresolved.length,
    battleSets: validation.battleSetCount,
    incompleteBattleSets: validation.incompleteBattleSetCount,
  }, null, 2)}\n`);

  if (plan.unresolved.length > 0) {
    process.stderr.write(`${JSON.stringify(plan.unresolved.slice(0, 20), null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  if (!options.apply) return;

  const result = await applyPlan(plan, options.output, {
    prune: options.prune,
    verify: options.verify,
    concurrency: options.concurrency,
    inputRoots: inputSpecs.map(input => input.path),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  main().catch(error => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
