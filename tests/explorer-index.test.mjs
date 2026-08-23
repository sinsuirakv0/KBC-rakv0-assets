import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { REQUIRED_APK_ROOTS } from "../scripts/apk-ledger.mjs";
import {
  createApkDescriptor,
  createCatalog,
  createManifestFromRoot,
  describeFile,
  normalizeRelativePath,
  validateManifest,
} from "../scripts/build-explorer-index.mjs";

test("expanded APK snapshot carries the verified archive link", () => {
  const archive = {
    provider: "github-release",
    repository: "example/source",
    tag: "battlecats-jp-history",
    releaseUrl: "https://github.com/example/source/releases/tag/battlecats-jp-history",
    assets: [{
      name: "battlecats-jp-150501.tar.gz",
      url: "https://github.com/example/source/releases/download/battlecats-jp-history/battlecats-jp-150501.tar.gz",
      bytes: 123,
      sha256: "a".repeat(64),
      apiId: 1,
    }],
  };
  const descriptor = createApkDescriptor({
    versionName: "15.5.1", versionCode: 1505010, compactVersion: "150501", archive,
  }, { fileCount: 2, totalSize: 10 }, true);
  assert.deepEqual(descriptor.archive, archive);
  assert.equal(descriptor.available, true);
  assert.equal(descriptor.fileCount, 2);
  assert.equal(descriptor.totalSize, 10);
});

test("preview kinds use an explicit safe allowlist", () => {
  assert.deepEqual(describeFile("Image/a.png"), { contentType: "image/png", previewKind: "image" });
  assert.equal(describeFile("Html/a.svg").previewKind, "text");
  assert.equal(describeFile("Html/a.html").previewKind, "text");
  assert.equal(describeFile("assets/a.pack").previewKind, "binary");
});

test("relative paths reject traversal and Windows separators", () => {
  assert.equal(normalizeRelativePath("Image/猫.png"), "Image/猫.png");
  for (const unsafe of ["/Image/a.png", "Image//a.png", "Image/../a.png", "Image\\a.png", ""]) {
    assert.throws(() => normalizeRelativePath(unsafe), /Unsafe relative path/);
  }
});

test("manifest generation is deterministic and validates its hashes", async () => {
  const root = await mkdirTemp("explorer-manifest-");
  await writeFixture(root, "Image/b.png", "b");
  await writeFixture(root, "Data/猫.csv", "a,b\n");
  const first = await createManifestFromRoot({ dataset: "server", snapshot: "v15.5.1-150501", absoluteRoot: root, rawRoot: "jp/server", concurrency: 2 });
  const second = await createManifestFromRoot({ dataset: "server", snapshot: "v15.5.1-150501", absoluteRoot: root, rawRoot: "jp/server", concurrency: 1 });
  assert.deepEqual(first, second);
  validateManifest(first);
  assert.deepEqual(Object.keys(first.files), ["Data/猫.csv", "Image/b.png"]);
});

async function mkdirTemp(prefix) {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
async function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
