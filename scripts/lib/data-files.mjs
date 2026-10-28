import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

export const readJson=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
export async function writeJson(file,value){
  const text=JSON.stringify(value)+'\n';await mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,(/[^\x00-\x7f]/.test(text)?'\uFEFF':'')+text);
}
export function within(root,name){
  const file=path.resolve(root,name),relative=path.relative(path.resolve(root),file);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Path outside data root: '+name);
  return file;
}
export async function files(root,prefix=''){
  const result=[];
  for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){
    const name=prefix?prefix+'/'+entry.name:entry.name;
    if(entry.isDirectory())result.push(...await files(root,name));
    else if(entry.isFile())result.push(name);
    else throw Error('Nonregular data: '+name);
  }
  return result.sort();
}
export async function hashFile(file){
  const hash=createHash('sha256');let size=0;
  for await(const bytes of createReadStream(file)){size+=bytes.length;hash.update(bytes);}
  return {size,sha256:hash.digest('hex')};
}
export async function parallel(items,convert,concurrency=8){
  let index=0;const result=new Array(items.length);
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(index<items.length){const current=index++;result[current]=await convert(items[current],current);}}));
  return result;
}
