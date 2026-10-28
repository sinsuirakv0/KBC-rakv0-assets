import {datasetPaths} from "./platform-client.mjs";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function readJson(file) { return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")); }
export async function readDataContext(root = repoRoot) {
  const current = await readJson(path.join(root, "metadata/jp/current.json"));
  if (current.status !== "verified" || current.sourceRegion !== "jp" || !/^[a-zA-Z0-9._-]+$/.test(current.datasetId) || current.generatedPath !== datasetPaths(current).generatedPath) throw Error("Invalid current dataset");
  return { current, characterIndexPath: path.join(root, current.generatedPath, "site/characters.json"), inventoryPath: path.join(root, datasetPaths(current).inventoryPath), raw: datasetPaths(current).rawPath };
}
export async function runEngine(args) {
  const local = path.resolve(repoRoot, "../battlecats-apk/engine/target/release", process.platform === "win32" ? "kbc-data.exe" : "kbc-data");
  const executable = process.env.KBC_DATA_ENGINE || (existsSync(local) ? local : "kbc-data");
  const env = { ...process.env };
  if (process.platform === "win32") {
    const toolchain = spawnSync("rustup", ["which", "rustc"], { encoding: "utf8", windowsHide: true });
    if (toolchain.status === 0) env.PATH = `${path.dirname(toolchain.stdout.trim())};${env.PATH}`;
  }
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(Error(`Data engine failed: ${code}`)));
  });
}
export async function buildCurrent(root = repoRoot) {
  const { inventoryPath, raw } = await readDataContext(root);
  await runEngine(["build", "--root", root, "--inventory", inventoryPath, "--raw", raw, "--publish"]);
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(repoRoot,"scripts/integrated-data.mjs"),"build",root],{stdio:"inherit",windowsHide:true});child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(Error("Integrated-data build failed")));});
  return readDataContext(root);
}
async function main() {
  const command = process.argv[2];
  if (command === "build") await buildCurrent();
  else if (command === "verify") await runEngine(["verify-current", "--root", repoRoot]);
  else if (command === "prune") await runEngine(["prune-generated", "--root", repoRoot, ...process.argv.slice(3)]);
  else throw Error("Usage: node scripts/data.mjs build|verify|prune [--keep N] [--apply]");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
