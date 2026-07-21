# Asset organization

This repository keeps the current Battle Cats assets only. Historical copies
whose names contain `__v<version>-<source>` are not retained.

## Directory layout

Assets are organized by meaning rather than by the encrypted pack that carried them. Units and enemies have dedicated entity trees, while shared assets use semantic groups such as `game-data`, `maps`, `images`, `animation-assets`, and `resources`.

The authoritative layout and conflict rules are documented in `docs/asset-classifier.md` and implemented by `scripts/classify-assets.mjs`. Do not classify new files manually.

## Update policy

When a new game version is imported, overwrite the file at its canonical path.
Do not create version-suffixed copies. Before publishing, verify that every
decrypted source file exists at its canonical path and that no exact filename is
duplicated within the same source group.
