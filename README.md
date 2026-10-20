# KBC Assets

本家由来データ、手動補完、再生成できる索引、版メタデータを分離して保存する。

- `jp/Local/<datasetId>/`：署名検証済みAPKから復号した9群
- `jp/server/`：本家サーバー由来データ
- `overrides/jp/`：手動別称・補完表示名・画像・モーション
- `generated/jp/datasets/<buildId>/`：採用元マップ・キャラ検索・Explorer
- `metadata/jp/current.json`：検証済み最新版への参照

設計と操作は [docs/README.md](docs/README.md)、配置と保存方式の判断は [docs/data-platform.md](docs/data-platform.md)。

`npm run build` で保存済み現在版を再生成、`npm run verify` で原本・生成物・採用元を独立検証する。エンジンは `KBC_DATA_ENGINE` またはPATH上の `kbc-data` を使用する。ローカル開発では隣接battlecats-apkのreleaseビルドも利用する。

`npm run prune:generated -- --keep 2` は削除候補の表示だけを行い、`--apply` を追加した場合に古い生成物を削除する。現行buildと原本は削除しない。過去版再生成は対応するinventoryとraw、同じServer・overrideがあるGit commitを指定して行う。

生成物は手動編集せず、手動変更は必ずoverridesへ記録する。HTTP利用時はcurrent・索引・実ファイルを一つのGit commit SHAへ固定する。