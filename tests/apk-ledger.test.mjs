import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REQUIRED_APK_ROOTS,
  inspectExpandedApk,
  validateApkLedger,
  validateApkLedgerSchema,
  validateCurrentVersion,
} from "../scripts/apk-ledger.mjs";

test("a compatible expanded APK must have the exact required raw roots", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "apk-ledger-"));
  const apksRoot = path.join(temporaryRoot, "apks");
  const expandedRoot = path.join(apksRoot, "150501");
  await createRequiredRoots(expandedRoot);
  await writeAsset(expandedRoot, "assets/base.pack", "base");
  await writeAsset(expandedRoot, "ImageDataLocal/007_f.imgcut", "cut");
  const inspection = await inspectExpandedApk(expandedRoot, 2);
  const ledger = createLedger([
    createVersion({
      fileCount: inspection.fileCount,
      size: inspection.size,
      sha256: inspection.sha256,
    }),
  ]);

  const result = await validateApkLedger(ledger, apksRoot, { concurrency: 2 });
  assert.equal(result.selected.versionName, "15.5.1");
  assert.equal(result.expandedBytes, inspection.size);
});

test("expanded APK retention count and bytes are guarded", () => {
  const records = [
    createVersion({ state: "confirmed", versionCode: 1505010, compactVersion: "150501" }),
    createVersion({ state: "expanded", versionName: "15.5.0", versionCode: 1505000, compactVersion: "150500", expandedPath: "jp/apks/150500" }),
    createVersion({ state: "expanded", versionName: "15.4.0", versionCode: 1504000, compactVersion: "150400", expandedPath: "jp/apks/150400" }),
  ];
  assert.throws(
    () => validateApkLedgerSchema(createLedger(records)),
    /Expanded APK count 3 exceeds limit 2/,
  );

  const oversized = createLedger([createVersion({ size: 101 })]);
  oversized.retention.maxExpandedBytes = 100;
  assert.throws(() => validateApkLedgerSchema(oversized), /Expanded APK bytes/);
});

test("manifest versionCode and compactVersion remain distinct identifiers", () => {
  const ledger = createLedger([createVersion()]);
  assert.doesNotThrow(() => validateApkLedgerSchema(ledger));
  assert.equal(ledger.versions[0].versionCode, 1505010);
  assert.equal(ledger.versions[0].compactVersion, "150501");

  ledger.latestConfirmed.versionCode = 150501;
  assert.throws(
    () => validateApkLedgerSchema(ledger),
    /does not match the referenced compactVersion record/,
  );
});

test("jp/version metadata must match the confirmed ledger record", () => {
  const record = createVersion();
  const metadata = {
    schemaVersion: 1,
    packageName: record.packageName,
    versionName: record.versionName,
    versionCode: record.versionCode,
    compactVersion: record.compactVersion,
    mergedApkSha256: record.mergedApkSha256,
    signingCertificateSha256: record.signingCertificateSha256,
    source: record.source,
  };
  assert.doesNotThrow(() => validateCurrentVersion(metadata, record));
  metadata.versionCode = 150501;
  assert.throws(() => validateCurrentVersion(metadata, record), /does not match/);
});

test("archived and incompatible versions require explicit metadata", () => {
  const ledger = createLedger([
    createVersion(),
    createVersion({
      versionName: "15.4.0",
      versionCode: 1504000,
      compactVersion: "150400",
      state: "archived",
      expandedPath: null,
      archive: createArchive(),
    }),
    createVersion({
      versionName: "14.0.0",
      versionCode: 1400000,
      compactVersion: "140000",
      compatibility: "incompatible",
      state: "skipped",
      reason: "ImageDataLocal is absent and the legacy names cannot be mapped safely.",
      size: 0,
      fileCount: 0,
      expandedPath: null,
    }),
  ]);
  assert.doesNotThrow(() => validateApkLedgerSchema(ledger));

  ledger.versions[2].reason = "";
  assert.throws(() => validateApkLedgerSchema(ledger), /with a reason/);
});

test("archive metadata supports deterministic multipart GitHub Release assets", () => {
  const ledger = createLedger([
    createVersion(),
    createVersion({
      versionName: "15.4.0",
      versionCode: 1504000,
      compactVersion: "150400",
      state: "archived",
      expandedPath: null,
      archive: createArchive(),
    }),
  ]);
  assert.doesNotThrow(() => validateApkLedgerSchema(ledger));
  ledger.versions[1].archive.assets.reverse();
  assert.throws(() => validateApkLedgerSchema(ledger), /sorted ascending/);
});

test("compatible confirmed and expanded records may retain a verified archive", () => {
  const ledger = createLedger([
    createVersion({ archive: createArchive() }),
    createVersion({
      versionName: "15.5.0",
      versionCode: 1505000,
      compactVersion: "150500",
      state: "expanded",
      expandedPath: "jp/apks/150500",
      archive: createArchive(),
    }),
  ]);
  assert.doesNotThrow(() => validateApkLedgerSchema(ledger));
  ledger.versions[0].archive.assets[0].sha256 = "invalid";
  assert.throws(() => validateApkLedgerSchema(ledger), /lowercase SHA-256/);
});

test("archive URLs, hashes and version ordering are validated", () => {
  const archived = createVersion({
    versionName: "15.4.0",
    versionCode: 1504000,
    compactVersion: "150400",
    state: "archived",
    expandedPath: null,
    archive: createArchive(),
  });
  const ledger = createLedger([createVersion(), archived]);
  archived.archive.assets[0].url = "http://example.test/part.zip";
  assert.throws(() => validateApkLedgerSchema(ledger), /HTTPS URL/);
  archived.archive = createArchive();
  archived.archive.assets[0].sha256 = "invalid";
  assert.throws(() => validateApkLedgerSchema(ledger), /lowercase SHA-256/);
  archived.archive = createArchive();
  ledger.versions.reverse();
  assert.throws(() => validateApkLedgerSchema(ledger), /versionCode descending/);
});

test("an archived version cannot remain as a local expanded directory", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "apk-archive-local-"));
  const apksRoot = path.join(temporaryRoot, "apks");
  await mkdir(path.join(apksRoot, "150501"), { recursive: true });
  await mkdir(path.join(apksRoot, "150400"), { recursive: true });
  const ledger = createLedger([
    createVersion(),
    createVersion({
      versionName: "15.4.0",
      versionCode: 1504000,
      compactVersion: "150400",
      state: "archived",
      expandedPath: null,
      archive: createArchive(),
    }),
  ]);
  await assert.rejects(
    () => validateApkLedger(ledger, apksRoot, { inspectFiles: false }),
    /directories do not match the ledger/,
  );
});

test("a differently named decrypted root is rejected as an expanded compatible APK", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "apk-layout-"));
  await createRequiredRoots(temporaryRoot);
  const { rename } = await import("node:fs/promises");
  await rename(
    path.join(temporaryRoot, "ImageDataLocal"),
    path.join(temporaryRoot, "Image_Data_Local"),
  );
  await assert.rejects(() => inspectExpandedApk(temporaryRoot), /required raw layout/);
});

function createLedger(versions) {
  return {
    schemaVersion: 1,
    packageName: "jp.co.ponos.battlecats",
    latestConfirmed: {
      versionName: "15.5.1",
      compactVersion: "150501",
      versionCode: 1505010,
    },
    retention: {
      maxExpandedVersions: 2,
      maxExpandedBytes: 1_073_741_824,
    },
    versions,
  };
}

function createVersion(overrides = {}) {
  return {
    versionName: "15.5.1",
    versionCode: 1505010,
    compactVersion: "150501",
    packageName: "jp.co.ponos.battlecats",
    source: "google-play",
    compatibility: "compatible",
    state: "confirmed",
    reason: null,
    mergedApkSha256: "b".repeat(64),
    signingCertificateSha256: "a".repeat(64),
    sha256: "0".repeat(64),
    size: 1,
    fileCount: 1,
    expandedPath: "jp/apks/150501",
    archive: null,
    ...overrides,
  };
}

function createArchive() {
  return {
    provider: "github-release",
    repository: "example/assets",
    tag: "apk-jp-150400",
    releaseUrl: "https://github.com/example/assets/releases/tag/apk-jp-150400",
    assets: [
      {
        name: "jp-150400.part01.zip",
        url: "https://github.com/example/assets/releases/download/apk-jp-150400/jp-150400.part01.zip",
        bytes: 123,
        sha256: "c".repeat(64),
        apiId: 101,
      },
      {
        name: "jp-150400.part02.zip",
        url: "https://github.com/example/assets/releases/download/apk-jp-150400/jp-150400.part02.zip",
        bytes: 456,
        sha256: "d".repeat(64),
        apiId: 102,
      },
    ],
  };
}

async function createRequiredRoots(root) {
  for (const rootName of REQUIRED_APK_ROOTS) {
    await mkdir(path.join(root, rootName), { recursive: true });
  }
}

async function writeAsset(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
