import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, readDataContext, buildCurrent } from "./data.mjs";

export const CHARACTER_ALIAS_PATHS = Object.freeze(["overrides/jp/characters/aliases.json", "metadata/jp/current.json", "metadata/jp/catalog.json", "generated/jp", "metadata/jp/integrated.json", "jp/Integrated-data"]);
export async function updateCharacterAliases(options = {}) {
  const root = path.resolve(options.repoRoot || repoRoot);
  const previous = await readDataContext(root);
  const next = await buildCurrent(root);
  return { changed: previous.current.buildId !== next.current.buildId, indexPath: next.characterIndexPath };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) updateCharacterAliases().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
