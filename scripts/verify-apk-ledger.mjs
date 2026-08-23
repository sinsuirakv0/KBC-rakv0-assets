import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readApkLedger,
  readCurrentVersion,
  validateApkLedger,
  validateCurrentVersion,
} from "./apk-ledger.mjs";

export async function verifyApkLedger(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ));
  const apksRoot = path.resolve(options.apksRoot ?? path.join(repoRoot, "jp", "Local"));
  const ledgerPath = path.resolve(options.ledgerPath ?? path.join(apksRoot, "index.json"));
  const versionPath = path.resolve(options.versionPath ?? path.join(repoRoot, "jp", "version.json"));
  const ledger = await readApkLedger(ledgerPath);
  const result = await validateApkLedger(ledger, apksRoot, {
    concurrency: options.concurrency ?? 16,
  });
  const currentVersion = await readCurrentVersion(versionPath);
  validateCurrentVersion(currentVersion, result.selected);
  return {
    versionCount: ledger.versions.length,
    expandedVersionCount: result.expanded.length,
    expandedBytes: result.expandedBytes,
    packageName: currentVersion.packageName,
    latestConfirmed: {
      versionName: result.selected.versionName,
      versionCode: result.selected.versionCode,
      compactVersion: result.selected.compactVersion,
    },
  };
}

function parseArguments(argv) {
  const options = { concurrency: 16 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root") options.repoRoot = requireValue(argv, ++index, argument);
    else if (argument === "--ledger") options.ledgerPath = requireValue(argv, ++index, argument);
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
  verifyApkLedger(parseArguments(process.argv.slice(2)))
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
