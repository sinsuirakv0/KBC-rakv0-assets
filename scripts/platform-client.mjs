import { createHash } from 'node:crypto';

export const assetRepository = 'sinsuirakv0/KBC-rakv0-assets';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const parseJson = bytes => JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, ''));
export function safePath(value) {
  if (typeof value !== 'string' || !value || /[\\:\x00-\x1f?#%]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Unsafe data path');
  return value;
}
export function verifyBytes(bytes, expected) {
  if (!expected || !Number.isSafeInteger(expected.size) || bytes.length !== expected.size || digest(bytes) !== expected.sha256) throw Error('Asset size/hash mismatch');
  return bytes;
}

export async function openDataset({ ref = 'main', region = 'jp', repository = assetRepository, read, readAssetFile, fetchImpl = fetch } = {}) {
  if (!['jp', 'en', 'kr', 'tw'].includes(region)) throw Error('Unknown region');
  let revision = ref;
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(`Revision request failed: ${response.status}`);
    revision = (await response.json()).sha;
  }
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Invalid revision');
  const rawBase = `https://raw.githubusercontent.com/${repository}/${revision}/`;
  const readFile = read || (async name => {
    const response = await fetchImpl(rawBase + safePath(name), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(`Asset request failed: ${name}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  });
  const current = parseJson(await readFile(`metadata/${region}/current.json`, revision));
  const { datasetId, buildId, generatedPath } = current;
  if (current.schemaVersion !== 1 || current.status !== 'verified' || current.sourceRegion !== region || generatedPath !== `generated/${region}/datasets/${buildId}`) throw Error('Invalid current');
  safePath(datasetId); safePath(buildId);
  if (datasetId.includes('/') || buildId.includes('/')) throw Error('Invalid dataset identity');
  const bytes = await readFile(`${generatedPath}/manifest.json`, revision);
  if (digest(bytes) !== current.manifestSha256) throw Error('Manifest hash mismatch');
  const manifest = parseJson(bytes);
  const checkHeader = header => {
    if (!header || ['datasetId', 'buildId', 'sourceRegion', 'versionName', 'versionCode'].some(key => header[key] !== current[key])) throw Error('Dataset header mismatch');
  };
  checkHeader(manifest.header);
  const readArtifact = async name => {
    const value = parseJson(verifyBytes(await readFile(`${generatedPath}/${safePath(name)}`, revision), manifest.artifacts[name]));
    checkHeader(value.header);
    return value;
  };
  const selected = await readArtifact('indexes/assets.json');
  const characters = await readArtifact('site/characters.json');
  const prefixes = [`${region}/Local/${datasetId}/`, `${region}/server/`, `overrides/${region}/assets/`];
  for (const [name, file] of Object.entries(selected.files)) {
    safePath(name); safePath(file.path);
    if (!prefixes.some(prefix => file.path.startsWith(prefix))) throw Error('Asset outside dataset');
  }
  const readAsset = async name => {
    const descriptor = selected.files[safePath(name)];
    if (!descriptor) throw Error(`Asset not selected: ${name}`);
    return verifyBytes(await (readAssetFile || readFile)(descriptor.path, revision), descriptor);
  };
  const readInput = async name => {
    const descriptor = manifest.inputs?.[name];
    if (!descriptor || descriptor.path !== `overrides/${region}/characters/${name}`) throw Error('Missing input descriptor');
    return parseJson(verifyBytes(await readFile(descriptor.path, revision), descriptor));
  };
  return { revision, current, manifest, files: selected.files, characters, rawBase, readAsset, readInput };
}
