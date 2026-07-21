# Asset organization

This repository keeps the current Battle Cats assets only. Historical copies
whose names contain `__v<version>-<source>` are not retained.

## Directory layout

Every asset is stored below its source group:

- `data`
- `download`
- `image`
- `image-data`
- `map`
- `number`
- `resource`
- `unit`

Within a group, use the following structure:

`<group>/<category>/<extension>/<filename>`

`category` is derived from the base filename by lowercasing it, removing a
trailing `__server-*` source suffix, replacing every consecutive run of digits
with `_`, then trimming leading and trailing `_` characters.

Examples:

- `MapData_000.csv` -> `data/mapdata/csv/MapData_000.csv`
- `battle_soul_000.maanim` -> `image-data/battle_soul/maanim/battle_soul_000.maanim`
- `img009_C_013__server-EImageServer.png` -> `image/img__c/png/img009_C_013__server-EImageServer.png`

Files without an extension use `raw` as their extension directory.

## Update policy

When a new game version is imported, overwrite the file at its canonical path.
Do not create version-suffixed copies. Before publishing, verify that every
decrypted source file exists at its canonical path and that no exact filename is
duplicated within the same source group.
