# jp/sitedata

このディレクトリは、KBCサイトが参照するオリジナルアセットと関連データの正規参照先です。

`Data/`、`Download/`、`Html/`、`ImageData/`、`Image/`、`Map/`、`Number/`、`res/`、`Unit/` は、最新確定APKのLocal 9群を基底に、無接頭server、A～Z serverの順で後の世代を優先して統合します。`assets/` は常に `jp/apks/index.json` が示す最新確定版のAPK由来です。アプリ更新時はbuild pipelineから全体を自動再生成します。

rawファイルと自動検出欄は手作業で編集しないでください。`character-index.json` の有効値欄だけは、下記の差分保持契約に従って編集できます。

- `asset-index.json`: 全実ファイルのsize、SHA-256、採用元を記録します。
- `character-index.json`: キャラごとの形態名・説明、ゲーム由来別称、関連asset pathを記録します。`aliases` と `assets.paths` の直接編集は次回buildで手動差分へ取り込まれます。`discoveredAliases`、`aliasManual`、`assets.discoveredPaths`、`assets.manual` は生成・差分保持用です。
- 旧パス互換用JSONはこの生成物には含めません。必要な場合は利用側の専用JSONとして別途作成します。
- `build-report.json`: server上書き、同内容統合、採用元の集計を記録します。

生成・検証契約はリポジトリの `docs/raw-layout.md` を参照してください。
