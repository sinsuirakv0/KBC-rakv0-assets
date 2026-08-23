# jp/sitedata

このディレクトリは、KBCサイトが参照するオリジナルアセットと関連データの正規参照先です。

`Data/`、`Download/`、`Html/`、`ImageData/`、`Image/`、`Map/`、`Number/`、`res/`、`Unit/` は、最新確定APKのLocal 9群を基底に、無接頭server、A～Z serverの順で後の世代を優先して統合します。`assets/` は常に `jp/apks/index.json` が示す最新確定版のAPK由来です。アプリ更新時はbuild pipelineから全体を自動再生成します。

手作業でこのディレクトリを編集しないでください。

- `asset-index.json`: 全実ファイルのsize、SHA-256、採用元を記録します。
- `motion-index.json`: siteとsave-app/labの旧公開キーを、現在のraw相対パスへ対応させます。
- `build-report.json`: server上書き、同内容統合、採用元の集計を記録します。

生成・検証契約はリポジトリの `docs/raw-layout.md` を参照してください。
