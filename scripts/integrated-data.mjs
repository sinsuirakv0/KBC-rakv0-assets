import {copyFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {files,hashFile,parallel,readJson,within,writeJson} from './lib/data-files.mjs';

const [mode,argument]=process.argv.slice(2),root=path.resolve(argument);
if(!['build','verify'].includes(mode))throw Error('Usage: integrated-data.mjs build|verify <assets>');
const current=await readJson(within(root,'metadata/jp/current.json'));
const generated=within(root,current.generatedPath);
const manifest=await readJson(within(generated,'manifest.json'));
if((await hashFile(within(generated,'manifest.json'))).sha256!==current.manifestSha256)throw Error('Unverified generated manifest');
const descriptor=manifest.artifacts['indexes/assets.json'],indexFile=within(generated,'indexes/assets.json');
const indexHash=await hashFile(indexFile);
if(indexHash.sha256!==descriptor.sha256||indexHash.size!==descriptor.size)throw Error('Asset index mismatch');
const index=await readJson(indexFile);
if(index.header.buildId!==current.buildId||index.header.datasetId!==current.datasetId)throw Error('Mixed integrated dataset');
const selected=Object.entries(index.files);
const target=within(root,'jp/Integrated-data');
const metadata=within(root,'metadata/jp/integrated.json');
if(mode==='build'){
  const music=await readJson(within(root,'overrides/jp/music-sources.json'));
  const baseline=within(root,'overrides/jp/music');
  if((await files(baseline)).join('\n')!==Object.keys(music.files).sort().join('\n'))throw Error('Music baseline inventory differs');
  await parallel(Object.entries(music.files),async([name,expected])=>{
    const actual=await hashFile(within(baseline,name));
    if(actual.size!==expected.size||actual.sha256!==expected.sha256)throw Error('Music baseline changed: '+name);
  });
  const stage=within(root,'.kbc-integrated');await mkdir(stage);
  await parallel(selected,async([name,file])=>{
    const destination=within(stage,name);await mkdir(path.dirname(destination),{recursive:true});
    await copyFile(within(root,file.path),destination);
    const actual=await hashFile(destination);
    if(actual.size!==file.size||actual.sha256!==file.sha256)throw Error('Integrated copy differs: '+name);
  });
  // 公開前の候補checkout内でだけ置換する。外部への確定はGitの1コミット。
  await rm(target,{recursive:true,force:true});await rename(stage,target);
  await writeJson(metadata,{schemaVersion:1,path:'jp/Integrated-data',header:index.header,files:Object.fromEntries(selected.map(([name,file])=>[name,{size:file.size,sha256:file.sha256,sourcePath:file.path,sourceKind:file.sourceKind}]))});
}
const integrated=await readJson(metadata);
if(integrated.header.buildId!==current.buildId||integrated.header.datasetId!==current.datasetId)throw Error('Integrated/current mismatch');
if((await files(target)).join('\n')!==selected.map(([name])=>name).sort().join('\n'))throw Error('Unexpected or missing integrated files');
await parallel(selected,async([name,file])=>{
  const actual=await hashFile(within(target,name)),entry=integrated.files[name];
  if(!entry||entry.sourcePath!==file.path||actual.size!==file.size||actual.sha256!==file.sha256||entry.size!==file.size||entry.sha256!==file.sha256)throw Error('Integrated integrity mismatch: '+name);
});
console.log(JSON.stringify({integratedVerified:true,versionCode:current.versionCode,buildId:current.buildId,files:selected.length,musicFiles:selected.filter(([name])=>name.startsWith('music/')).length,folders:[...new Set(selected.map(([name])=>name.split('/')[0]))]}));
