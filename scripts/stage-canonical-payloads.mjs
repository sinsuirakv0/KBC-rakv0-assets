import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectPayloadState,
  runGit,
} from "./verify-git-payloads.mjs";

export const MAX_MISMATCHES = 5_000;
const HASH_PATTERN = /^[0-9a-f]{40}$/;

function parseHashes(buffer, expectedCount) {
  const hashes = buffer.toString("utf8").trim().split(/\r?\n/u);
  if (hashes.length !== expectedCount || hashes.some((hash) => !HASH_PATTERN.test(hash))) {
    throw new Error("Canonical payload staging could not hash every payload safely.");
  }
  return hashes;
}

function readHistoricalAttributes(repositoryRoot) {
  try {
    return runGit(["show", "HEAD:.gitattributes"], { cwd: repositoryRoot });
  } catch {
    try {
      runGit(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: repositoryRoot });
      return null;
    } catch {
      throw new Error("Canonical payload staging could not verify the historical HEAD safely.");
    }
  }
}

function createHistoricalFixture(repositoryRoot, repositoryPaths) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "kbc-git-payload-history-"));
  try {
    const historicalAttributes = readHistoricalAttributes(repositoryRoot);
    if (historicalAttributes) writeFileSync(path.join(temporaryRoot, ".gitattributes"), historicalAttributes);
    for (const repositoryPath of repositoryPaths) {
      const source = path.join(repositoryRoot, ...repositoryPath.split("/"));
      const destination = path.join(temporaryRoot, ...repositoryPath.split("/"));
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    return temporaryRoot;
  } catch {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw new Error("Canonical payload staging could not prepare the historical proof.");
  }
}

function proveHistoricalClean(repositoryRoot, mismatches) {
  const repositoryPaths = mismatches.map((item) => item.path);
  const historicalRoot = createHistoricalFixture(repositoryRoot, repositoryPaths);
  try {
    const input = Buffer.from(`${repositoryPaths.join("\n")}\n`, "utf8");
    const historicalHashes = parseHashes(runGit([
      "-c", "core.autocrlf=true", "hash-object", "--stdin-paths",
    ], {
      cwd: historicalRoot,
      input,
      failureMessage: "Canonical payload staging historical hash failed safely.",
    }), repositoryPaths.length);
    for (let index = 0; index < mismatches.length; index += 1) {
      if (historicalHashes[index] !== mismatches[index].indexBlobId) {
        throw new Error("Canonical payload staging historical proof did not match the index.");
      }
    }
  } finally {
    rmSync(historicalRoot, { recursive: true, force: true });
  }
}

function writeCanonicalBlobs(repositoryRoot, mismatches) {
  const repositoryPaths = mismatches.map((item) => item.path);
  const input = Buffer.from(`${repositoryPaths.join("\n")}\n`, "utf8");
  const rawHashes = parseHashes(runGit([
    "hash-object", "-w", "--no-filters", "--stdin-paths",
  ], {
    cwd: repositoryRoot,
    input,
    failureMessage: "Canonical payload staging raw blob write failed safely.",
  }), repositoryPaths.length);
  for (let index = 0; index < mismatches.length; index += 1) {
    if (rawHashes[index] !== mismatches[index].workingBlobId) {
      throw new Error("Canonical payload staging detected working bytes changing during the operation.");
    }
  }
  return rawHashes;
}

function updatePayloadIndex(repositoryRoot, mismatches, rawHashes) {
  const indexInfo = mismatches.map((item, index) => (
    `${item.mode} blob ${rawHashes[index]}\t${item.path}\0`
  )).join("");
  runGit(["update-index", "-z", "--index-info"], {
    cwd: repositoryRoot,
    input: Buffer.from(indexInfo, "utf8"),
    failureMessage: "Canonical payload staging index update failed safely.",
  });
}

export function stageCanonicalPayloads(repositoryRoot = process.cwd(), options = {}) {
  const maxMismatches = options.maxMismatches ?? MAX_MISMATCHES;
  if (!Number.isSafeInteger(maxMismatches) || maxMismatches < 1 || maxMismatches > MAX_MISMATCHES) {
    throw new Error("Canonical payload staging mismatch limit is invalid.");
  }
  const state = collectPayloadState(repositoryRoot, { maxMismatches });
  if (state.mismatches.length === 0) return 0;
  proveHistoricalClean(repositoryRoot, state.mismatches);
  const rawHashes = writeCanonicalBlobs(repositoryRoot, state.mismatches);
  updatePayloadIndex(repositoryRoot, state.mismatches, rawHashes);
  return state.mismatches.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const stagedCount = stageCanonicalPayloads();
    process.stdout.write(`${stagedCount}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Canonical payload staging failed safely."}\n`);
    process.exitCode = 1;
  }
}
