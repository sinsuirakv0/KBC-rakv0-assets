import { readJson } from "./data.mjs";

export const readCharacterOverrides = readJson;
export function validateCharacterAliases(index, overrides) {
  if (overrides?.schemaVersion !== 1 || !overrides.units || typeof overrides.units !== "object" || !Array.isArray(index?.units)) throw Error("Invalid character aliases");
  const ids = new Set(index.units.map(unit => unit.id));
  for (const [id, value] of Object.entries(overrides.units)) {
    if (!ids.has(id)) throw Error(`Unknown character ID: ${id}`);
    const aliases = value.aliases?.include || [];
    if (!Array.isArray(aliases) || aliases.some(value => typeof value !== "string" || !value.length) || new Set(aliases).size !== aliases.length) throw Error(`Invalid aliases: ${id}`);
  }
}
