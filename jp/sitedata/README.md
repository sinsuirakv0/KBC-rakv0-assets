# jp/sitedata

このディレクトリは、KBCサイトが参照するオリジナルアセットと関連データの正規参照先です。

`Data/`、`Download/`、`Html/`、`ImageData/`、`Image/`、`Map/`、`Number/`、`res/`、`Unit/` は、最新確定APKのLocal 9群を基底に、無接頭server、A～Z serverの順で後の世代を優先して統合します。`assets/` は常に `jp/apks/index.json` が示す最新確定版のAPK由来です。アプリ更新時はbuild pipelineから全体を自動再生成します。

このディレクトリのrawファイルと生成JSONは手作業で編集しないでください。キャラ別称・関連pathの手動変更は `jp/character-overrides.json` に記録します。

- `asset-index.json`: 全実ファイルのsize、SHA-256、採用元を記録します。
- `character-index.json`: サイトが先に取得する軽量索引です。ID昇順arrayに形態名・説明と手動設定したキャラ単位の別称だけを記録します。
- `character-assets.json`: 必要時に遅延取得する関連path索引です。top-level templateとunit別suffixからexact pathを復元できます。
- 旧パス互換用JSONはこの生成物には含めません。必要な場合は利用側の専用JSONとして別途作成します。
- `build-report.json`: server上書き、同内容統合、採用元の集計を記録します。

生成・検証契約はリポジトリの `docs/raw-layout.md` を参照してください。
