# KBC Assets

本家由来データ、手動補完、再生成できる索引、版メタデータを分離して保存する。

- `jp/Local/<versionCode>/`：署名検証済みAPKから復号した9群とassets全体
- `jp/server/`：本家サーバー由来データ
- `overrides/jp/`：手動別称・補完表示名・画像・モーション
- `generated/jp/datasets/<versionCode>/`：採用元マップ・キャラ検索・Explorer
- `jp/Integrated-data/`：最新版の統合実体。musicに全OGG/CAF等を保持
- `metadata/jp/current.json`：検証済み最新版への参照

設計と操作は [docs/README.md](docs/README.md)、配置と保存方式の判断は [docs/data-platform.md](docs/data-platform.md)。

`npm run build` で保存済み現在版を再生成、`npm run verify` で原本・生成物・採用元を独立検証する。エンジンは `KBC_DATA_ENGINE` またはPATH上の `kbc-data` を使用する。ローカル開発では隣接battlecats-apkのreleaseビルドも利用する。

`npm run prune:generated -- --keep 2` は削除候補の表示だけを行い、`--apply` を追加した場合に古い生成物を削除する。現行buildと原本は削除しない。過去版再生成は対応するinventoryとraw、同じServer・overrideがあるGit commitを指定して行う。

生成物は手動編集せず、手動変更は必ずoverridesへ記録する。HTTP利用時はcurrent・索引・実ファイルを一つのGit commit SHAへ固定する。
Integrated-data・音源・フォルダ別ZIPの自動更新は [現行契約](docs/integrated-data.md)、Actions実行結果は [検証記録](docs/integrated-data-validation-20261029.md) を参照する。アプリ向けの入口は [配布manifest](https://github.com/sinsuirakv0/KBC-rakv0-assets/releases/latest/download/manifest.json)。同じmanifestの版固定URLを使用する。

統合実体の全件検証は `node scripts/integrated-data.mjs verify .`。通常のsource Actionsでは原本・索引・統合実体を全て検証してから公開する。
