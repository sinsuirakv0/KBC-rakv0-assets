import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareText, listFiles, mapConcurrent, sha256File } from "./apk-ledger.mjs";
import { EXPLORER_DATASETS, loadExplorerContext, normalizeRelativePath, validateCatalog, validateManifest } from "./build-explorer-index.mjs";

export async function verifyExplorerIndex(options = {}) {
  const context = await loadExplorerContext(options);
  const catalog = await readJson(context.catalogPath);
  validateCatalog(catalog, context.ledger.packageName);
  const summaries = [];
  for (const dataset of EXPLORER_DATASETS) {
    for (const snapshot of catalog.datasets[dataset].snapshots) {
      const manifest = await readJson(path.join(context.repoRoot, ...snapshot.manifestPath.split("/")));
      validateManifest(manifest);
      if (manifest.dataset !== dataset || manifest.snapshot !== snapshot.id || manifest.fileCount !== snapshot.fileCount || manifest.totalSize !== snapshot.totalSize) throw new Error(`Explorer catalog and manifest differ: ${dataset}/${snapshot.id}`);
      if (snapshot.available) await verifyAvailableSnapshot(context.repoRoot, snapshot, manifest, options.concurrency ?? 16);
      summaries.push({ dataset, id: snapshot.id, available: snapshot.available, fileCount: manifest.fileCount, totalSize: manifest.totalSize });
    }
  }
  return { snapshotCount: summaries.length, snapshots: summaries };
}

async function verifyAvailableSnapshot(repoRoot, snapshot, manifest, concurrency) {
  const rawRoot = path.join(repoRoot, ...snapshot.rawRoot.split("/"));
  const files = (await listFiles(rawRoot)).filter(file => !(snapshot.rawRoot === "jp/sitedata" && ["asset-index.json", "motion-index.json", "build-report.json", "README.md"].includes(file.relativePath)));
  const actualPaths = files.map(file => normalizeRelativePath(file.relativePath));
  const indexedPaths = Object.keys(manifest.files);
  if (actualPaths.length !== indexedPaths.length || actualPaths.some((item, index) => item !== indexedPaths[index])) throw new Error(`Explorer manifest paths differ: ${snapshot.rawRoot}`);
  await mapConcurrent(files, concurrency, async file => {
    const relativePath = normalizeRelativePath(file.relativePath);
    const indexed = manifest.files[relativePath];
    if (file.size !== indexed.size) throw new Error(`Explorer manifest size differs: ${snapshot.rawRoot}/${relativePath}`);
    if (await sha256File(file.absolutePath) !== indexed.sha256) throw new Error(`Explorer manifest SHA-256 differs: ${snapshot.rawRoot}/${relativePath}`);
  });
}

async function readJson(filePath) { return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, "")); }
function parseArguments(argv) {
  const options = { concurrency: 16 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root") options.repoRoot = argv[++index];
    else if (argument === "--concurrency") options.concurrency = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 64) throw new Error("--concurrency must be an integer between 1 and 64.");
  return options;
}
const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) verifyExplorerIndex(parseArguments(process.argv.slice(2))).then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
