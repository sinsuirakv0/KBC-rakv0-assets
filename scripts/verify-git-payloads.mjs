import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PAYLOAD_ROOTS = Object.freeze([
  "jp/Local",
  "jp/character-image-overrides",
  "jp/server",
  "jp/sitedata",
]);
const COMMAND_BUFFER_BYTES = 64 * 1024 * 1024;
const HASH_PATTERN = /^[0-9a-f]{40}$/;
const CONTROL_PATH_PATTERN = /[\u0000-\u001f\u007f]/u;

export function runGit(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: options.cwd,
      input: options.input,
      maxBuffer: COMMAND_BUFFER_BYTES,
      encoding: options.encoding ?? "buffer",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw new Error(options.failureMessage ?? "Git payload audit could not complete safely.");
  }
}

function normalizeRepositoryPath(value) {
  return value.replaceAll("\\", "/");
}

function isPayloadPath(value) {
  const normalized = normalizeRepositoryPath(value);
  return PAYLOAD_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function validatePath(value) {
  const normalized = normalizeRepositoryPath(value);
  if (!normalized || normalized !== value || CONTROL_PATH_PATTERN.test(value)) return false;
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) return false;
  if (normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  return isPayloadPath(normalized);
}

function parseNullRecords(buffer) {
  const records = [];
  let start = 0;
  for (let end = 0; end <= buffer.length; end += 1) {
    if (end !== buffer.length && buffer[end] !== 0) continue;
    records.push(buffer.subarray(start, end));
    start = end + 1;
  }
  if (records.at(-1)?.length === 0) records.pop();
  return records;
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Git payload audit found a non-UTF-8 path.");
  }
}

function parseIndexEntries(buffer) {
  const entries = new Map();
  for (const record of parseNullRecords(buffer)) {
    const separator = record.indexOf(9);
    if (separator < 0) throw new Error("Git payload audit found a malformed index entry.");
    const header = decodeUtf8(record.subarray(0, separator)).split(" ");
    const repositoryPath = decodeUtf8(record.subarray(separator + 1));
    if (header.length !== 3 || !["100644", "100755"].includes(header[0]) || !HASH_PATTERN.test(header[1]) || header[2] !== "0") {
      throw new Error("Git payload audit found an unsupported or unmerged index entry.");
    }
    if (!validatePath(repositoryPath)) throw new Error("Git payload audit found an unsafe payload path.");
    if (entries.has(repositoryPath)) throw new Error("Git payload audit found a duplicate index path.");
    entries.set(repositoryPath, { mode: header[0], blobId: header[1] });
  }
  return entries;
}

function parsePathRecords(buffer) {
  return parseNullRecords(buffer).map((record) => {
    const repositoryPath = decodeUtf8(record);
    if (!validatePath(repositoryPath)) throw new Error("Git payload audit found an unsafe untracked path.");
    return repositoryPath;
  });
}

function assertNoUntrackedPayloads(repositoryRoot) {
  const untracked = parsePathRecords(runGit([
    "ls-files", "--others", "--exclude-standard", "-z", "--", ...PAYLOAD_ROOTS,
  ], { cwd: repositoryRoot }));
  const ignored = parsePathRecords(runGit([
    "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...PAYLOAD_ROOTS,
  ], { cwd: repositoryRoot }));
  if (untracked.length > 0 || ignored.length > 0) {
    throw new Error(`Git payload audit rejected untracked payloads (${untracked.length + ignored.length}).`);
  }
}

function assertPayloadAttributes(repositoryRoot, repositoryPaths) {
  const input = Buffer.from(`${repositoryPaths.join("\0")}\0`, "utf8");
  const output = parseNullRecords(runGit([
    "check-attr", "-z", "--stdin", "text",
  ], { cwd: repositoryRoot, input }));
  if (output.length !== repositoryPaths.length * 3) {
    throw new Error("Git payload audit could not verify payload attributes.");
  }
  for (let index = 0; index < output.length; index += 3) {
    const checkedPath = decodeUtf8(output[index]);
    const attribute = decodeUtf8(output[index + 1]);
    const value = decodeUtf8(output[index + 2]);
    if (checkedPath !== repositoryPaths[index / 3] || attribute !== "text" || value !== "unset") {
      throw new Error("Git payload audit found a payload without the -text attribute.");
    }
  }
}

export function collectPayloadState(repositoryRoot = process.cwd(), options = {}) {
  const indexEntries = parseIndexEntries(runGit([
    "ls-files", "--stage", "-z", "--", ...PAYLOAD_ROOTS,
  ], { cwd: repositoryRoot }));
  if (indexEntries.size === 0) throw new Error("Git payload audit found no tracked payloads.");
  assertNoUntrackedPayloads(repositoryRoot);
  const repositoryPaths = [...indexEntries.keys()];
  assertPayloadAttributes(repositoryRoot, repositoryPaths);
  const input = Buffer.from(`${repositoryPaths.join("\n")}\n`, "utf8");
  const output = decodeUtf8(runGit([
    "hash-object", "--no-filters", "--stdin-paths",
  ], { cwd: repositoryRoot, input })).trim().split(/\r?\n/u);
  if (output.length !== repositoryPaths.length || output.some((hash) => !HASH_PATTERN.test(hash))) {
    throw new Error("Git payload audit could not hash every payload.");
  }
  const mismatches = [];
  for (let index = 0; index < repositoryPaths.length; index += 1) {
    const entry = indexEntries.get(repositoryPaths[index]);
    if (output[index] !== entry.blobId) {
      mismatches.push({
        path: repositoryPaths[index],
        mode: entry.mode,
        indexBlobId: entry.blobId,
        workingBlobId: output[index],
      });
      if (mismatches.length > (options.maxMismatches ?? Number.POSITIVE_INFINITY)) {
        throw new Error("Git payload audit found more content mismatches than the configured limit.");
      }
    }
  }
  return { indexEntries, repositoryPaths, mismatches };
}

export function auditGitPayloads(repositoryRoot = process.cwd()) {
  const state = collectPayloadState(repositoryRoot);
  if (state.mismatches.length > 0) {
    throw new Error("Git payload audit found a staged blob different from working bytes.");
  }
  return { roots: [...PAYLOAD_ROOTS], fileCount: state.indexEntries.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = auditGitPayloads();
    process.stdout.write(`Git payload audit passed: ${result.fileCount} files across ${result.roots.length} roots.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Git payload audit failed."}\n`);
    process.exitCode = 1;
  }
}
