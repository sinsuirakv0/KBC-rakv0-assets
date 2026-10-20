import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  validateCharacterAliases,
  readCharacterOverrides,
} from "./character-aliases.mjs";
import { readDataContext } from "./data.mjs";
import { CHARACTER_ALIAS_PATHS } from "./update-character-aliases.mjs";

export async function editCharacterAlias(options) {
  const repoRoot = path.resolve(options.repoRoot ?? path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ));
  const overridesPath = path.join(repoRoot, ...CHARACTER_ALIAS_PATHS[0].split("/"));
  const indexPath = (await readDataContext(repoRoot)).characterIndexPath;
  const [overrides, indexSource] = await Promise.all([
    readCharacterOverrides(overridesPath),
    readFile(indexPath, "utf8"),
  ]);
  const characterIndex = JSON.parse(indexSource.replace(/^\uFEFF/, ""));
  const result = editCharacterAliasOverrides({
    overrides,
    characterIndex,
    id: options.id,
    action: options.action,
    alias: options.alias,
  });
  if (result.changed) {
    await writeFile(overridesPath, serializeCharacterOverrides(result.overrides), "utf8");
  }
  return result;
}

export function editCharacterAliasOverrides({ overrides, characterIndex, id, action, alias }) {
  validateCharacterAliases(characterIndex, overrides);
  const normalizedId = normalizeCharacterId(id);
  const character = characterIndex.units.find(unit => unit.id === normalizedId);
  if (!character) throw new Error(`Unknown character ID: ${normalizedId}`);
  if (action !== "add" && action !== "remove") throw new Error(`Unsupported action: ${action}`);
  if (typeof alias !== "string" || alias.length === 0) throw new Error("Alias must not be empty.");

  const next = structuredClone(overrides);
  const currentUnit = next.units[normalizedId] ?? {};
  const aliases = new Set(currentUnit.aliases?.include ?? []);
  const previousSize = aliases.size;
  if (action === "add") aliases.add(alias);
  else aliases.delete(alias);
  const changed = aliases.size !== previousSize;
  if (!changed) {
    return { changed, id: normalizedId, action, alias, aliases: [...aliases], overrides };
  }

  const include = [...aliases].sort(compareText);
  if (include.length > 0) {
    next.units[normalizedId] = {
      aliases: { include, exclude: [] },
      ...(currentUnit.paths ? { paths: currentUnit.paths } : {}),
    };
  } else if (currentUnit.paths) {
    next.units[normalizedId] = { paths: currentUnit.paths };
  } else {
    delete next.units[normalizedId];
  }
  validateCharacterAliases(characterIndex, next);
  return { changed, id: normalizedId, action, alias, aliases: include, overrides: next };
}

export function serializeCharacterOverrides(overrides) {
  const ids = Object.keys(overrides.units).sort(compareCharacterId);
  const lines = ["\uFEFF{", "  \"schemaVersion\": 1,", "  \"units\": {"];
  for (const [index, id] of ids.entries()) {
    const blockLines = JSON.stringify(overrides.units[id], null, 2).split("\n");
    lines.push(`    ${JSON.stringify(id)}: ${blockLines[0]}`);
    for (let lineIndex = 1; lineIndex < blockLines.length; lineIndex += 1) {
      const comma = lineIndex === blockLines.length - 1 && index < ids.length - 1 ? "," : "";
      lines.push(`    ${blockLines[lineIndex]}${comma}`);
    }
  }
  lines.push("  }", "}");
  return `${lines.join("\n")}\n`;
}

async function runInteractive(repoRoot) {
  if (!process.stdin.isTTY) throw new Error("Interactive mode requires a terminal.");
  const indexPath = (await readDataContext(repoRoot)).characterIndexPath;
  const overridesPath = path.join(repoRoot, ...CHARACTER_ALIAS_PATHS[0].split("/"));
  const [indexSource, overrides] = await Promise.all([
    readFile(indexPath, "utf8"),
    readCharacterOverrides(overridesPath),
  ]);
  const characterIndex = JSON.parse(indexSource.replace(/^\uFEFF/, ""));
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const id = normalizeCharacterId(await terminal.question("キャラクターID: "));
    const character = characterIndex.units.find(unit => unit.id === id);
    if (!character) throw new Error(`Unknown character ID: ${id}`);
    process.stdout.write(`形態名: ${character.forms.map(form => form.name).join(" / ")}\n`);
    const currentAliases = overrides.units[id]?.aliases?.include ?? [];
    process.stdout.write(currentAliases.length > 0
      ? `現在の別称:\n${currentAliases.map((value, index) => `  ${index + 1}. ${value}`).join("\n")}\n`
      : "現在の別称: なし\n");
    const actionInput = (await terminal.question("操作 [a=追加 / d=削除]: ")).trim().toLowerCase();
    if (actionInput === "a" || actionInput === "add") {
      const alias = await terminal.question("追加する別称: ");
      return editCharacterAlias({ repoRoot, id, action: "add", alias });
    }
    if (actionInput === "d" || actionInput === "delete" || actionInput === "remove") {
      if (currentAliases.length === 0) throw new Error(`Character ${id} has no aliases to remove.`);
      const selection = Number((await terminal.question("削除する番号: ")).trim());
      if (!Number.isInteger(selection) || selection < 1 || selection > currentAliases.length) {
        throw new Error("Invalid alias number.");
      }
      return editCharacterAlias({
        repoRoot,
        id,
        action: "remove",
        alias: currentAliases[selection - 1],
      });
    }
    throw new Error(`Unsupported action: ${actionInput}`);
  } finally {
    terminal.close();
  }
}

function normalizeCharacterId(value) {
  const source = String(value ?? "").trim();
  if (!/^\d+$/.test(source)) throw new Error(`Invalid character ID: ${source}`);
  const id = Number(source);
  if (!Number.isSafeInteger(id)) throw new Error(`Invalid character ID: ${source}`);
  return String(id).padStart(3, "0");
}

function compareCharacterId(left, right) {
  return Number(left) - Number(right) || compareText(left, right);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseArguments(argv) {
  if (argv.length === 0) return { interactive: true };
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--id") options.id = requireValue(argv, ++index, argument);
    else if (argument === "--add") {
      if (options.action) throw new Error("Specify exactly one of --add/--remove.");
      options.action = "add";
      options.alias = requireValue(argv, ++index, argument);
    } else if (argument === "--remove") {
      if (options.action) throw new Error("Specify exactly one of --add/--remove.");
      options.action = "remove";
      options.alias = requireValue(argv, ++index, argument);
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && (!options.id || !options.action)) {
    throw new Error("--id and exactly one of --add/--remove are required.");
  }
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function printHelp() {
  process.stdout.write([
    "Usage:",
    "  npm run edit:character-aliases",
    "  npm run edit:character-aliases -- --id <id> --add <alias>",
    "  npm run edit:character-aliases -- --id <id> --remove <alias>",
    "",
  ].join("\n"));
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = options.interactive
    ? await runInteractive(repoRoot)
    : await editCharacterAlias({ repoRoot, ...options });
  process.stdout.write(`${JSON.stringify({
    updated: result.changed,
    id: result.id,
    action: result.action,
    alias: result.alias,
    aliases: result.aliases,
  }, null, 2)}\n`);
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  main().catch(error => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
