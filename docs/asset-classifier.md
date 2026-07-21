# Asset classifier

`scripts/classify-assets.mjs` builds one canonical asset tree from decrypted APK/XAPK assets and decrypted server packs. It is dependency-free and requires Node.js 20 or newer.

## Canonical policy

- Unit assets are grouped below `units/<id>/<form>/`. Each form can contain `sprite.png`, `cuts.imgcut`, `model.mamodel`, `animations/<index>.maanim`, `icon.png`, `thumbnail-<variant>.png`, and `gacha.png`.
- Unit-wide metadata is stored at `units/<id>/stats.csv` and `units/<id>/names-<locale>.csv`.
- Enemy battle assets are grouped below `enemies/<id>/` using the same battle filenames.
- Other files retain their semantic source group and use a stable filename-derived family.
- Historical `__v...` and `__server-...` metadata suffixes are removed from canonical filenames.
- APK/XAPK assets are the base layer. Server packs overwrite them in generation order, and later letter prefixes win (`X` over `W`, `B` over `A`, and `A` over an unprefixed pack). Therefore `X` is the newest and highest-priority generation.
- Identical files that resolve to the same path are collapsed. Different files with equal priority stop the run as an unresolved conflict.

The generated `asset-index.json` records path, type, entity ID, form, motion index, SHA-256, and the selected source. Future analyzers should consume this index instead of inferring every relationship from paths again.

Only `f`, `c`, `s`, and `u` are treated as unit forms; `e` is treated as an enemy. Other one-letter suffixes remain shared assets. The manifest validation section also lists battle sets that do not contain the standard sprite, cut, model, and four base animations.

## Dry run

```powershell
node scripts/classify-assets.mjs `
  --local "D:\storage\battlecats-cryptor_0.2.0-recheck\workspace\decrypt" `
  --server "D:\storage\battlecats-server-assets-decrypt\workspace\decrypt" `
  --output "D:\KBC\KBC-rakv0-assets"
```

## Apply and verify

```powershell
node scripts/classify-assets.mjs `
  --local "D:\storage\battlecats-cryptor_0.2.0-recheck\workspace\decrypt" `
  --server "D:\storage\battlecats-server-assets-decrypt\workspace\decrypt" `
  --output "D:\KBC\KBC-rakv0-assets" `
  --apply --prune --verify
```

Dry-run is the default. `--prune` is accepted only with `--apply` and removes stale files only inside the managed asset groups. During migration it also removes files below the legacy groups (`data`, `download`, `image`, `image-data`, `map`, `number`, `resource`, and `unit`). Repository metadata, scripts, tests, and documentation are outside that deletion scope.
