# 生データ配置・統合・履歴版台帳

## 正式な配置契約

APK 15.5.1（manifest versionCode `1505010`、compactVersion `150501`）の生データは `jp/apks/150501/` に置く。versionCodeとcompactVersionは別の識別子であり、相互変換や同値比較をしない。compatibleな展開版は、次の10ディレクトリを名前どおりすべて持つ必要がある。

```text
jp/apks/<compactVersion>/
├─ assets/
├─ DataLocal/
├─ DownloadLocal/
├─ HtmlLocal/
├─ ImageDataLocal/
├─ ImageLocal/
├─ MapLocal/
├─ NumberLocal/
├─ resLocal/
└─ UnitLocal/
```

展開版root直下はこの10ディレクトリだけを許可する。`metadata.json`、`release-manifest.json` などの版メタデータをroot直下へ混在させない。現在版のメタデータは `jp/version.json`、履歴台帳は `jp/apks/index.json` に分離する。

移動済みserver群は `jp/server/` に置く。認識する名前は `([A-Z]?)(ImageData|Image|Map|Number|Unit)Server` だけである。`ImageData` は `Image` と別の種別として解析する。

最終データは次の固定構造にする。

```text
jp/sitedata/
├─ assets/
├─ Data/
├─ Download/
├─ Html/
├─ ImageData/
├─ Image/
├─ Map/
├─ Number/
├─ res/
├─ Unit/
├─ asset-index.json
├─ motion-index.json
├─ build-report.json
└─ README.md
```

## build規則

`scripts/build-sitedata.mjs` は台帳の `latestConfirmed.compactVersion` が指す `state: confirmed` かつ `compatibility: compatible` の1版だけをAPK基底に選び、同じpointerに記録したmanifest versionCodeとも一致することを検証する。別版のファイルを同時に走査しないため、履歴版は `sitedata` に混入しない。

Localの優先度は0、無接頭serverは100、AからZは101から126であり、後の世代ほど優先する。同じ出力パスに同内容が来た場合は優先度の高い採用元へまとめ、異内容なら高い優先度で上書きする。同順位・同一出力パス・異内容は未解決衝突として、出力を書き換える前に失敗する。

生成は一時ディレクトリで完了させてから `jp/sitedata/` と入れ替える。コンソールには件数と容量だけを出し、採用元は `asset-index.json`、上書きと同一内容の統合判断は `build-report.json` に記録する。

`README.md` はサイト正規参照先、統合元、手編集禁止、各indexの用途を説明するBOM付きUTF-8の固定生成物である。`templates/sitedata-README.md` から毎回決定的に配置し、atomic再生成でも保持する。

主な関数の関係は次のとおり。

- `loadBuildContext`: APK台帳を検証し、最新確定版の入力ルートを決める
- `scanBuildInputs`: APK 10群とserver群を固定規則で候補化する
- `createBuildPlan`: raw出力とlegacy pathの採用元、上書き、衝突を決定する
- `applyBuildPlan`: SHA-256算出、ファイル複製、3つのメタデータ生成、出力入れ替えを行う
- `verifySitedata`: 同じ入力から期待planを再構築し、全ファイルのsize/SHA-256、index、固定構造、旧分類パス不在を照合する

## asset-index.json

`schemaVersion`、`gameVersion`、`versionCode` と、`files` mapを持つ。mapのキーは `sitedata` 相対パス、値は `size`、`sha256`、`source` である。`source` はAPK/server種別、元ルート、世代、優先度、リポジトリ相対の元パスを保持する。

## motion-index.jsonと旧パス互換

`schemaVersion`、`gameVersion`、`assets` mapを持つ。mapのキーは旧公開パス、値は `sitedata` 相対の生データパスである。

旧 `asset-index.json`、旧classify処理、site API、save-app/labの `resolve_motion_asset` の調査結果に基づき、1つのraw fileから複数のlegacy keyを生成できる形で次を互換化する。

- `Number` / `ImageData` の `<id>_<form>` 系を `units/<id>/<form>/` または `enemies/<id>/` のsprite、cut、model、animationへ対応させる
- form `f` / `c` / `s` / `u` の同じrawを、save-app/lab用の `number/<form>/png|imgcut|mamodel|maanim/<filename>` にも対応させる
- `Unit` の `uni` / `udi`、`Image` の `gatyachara` / `enemy_icon`、`Data` の `unit<n>.csv`、`res` / `Unit` の `Unit_Explanation` を旧unit/enemyパスへ対応させる
- `res` の一般ファイルを旧 `resources/<category>/<filename>` へ対応させる

対象キーはsite用の `units/`、`enemies/`、`resources/` と、save-app/lab用の `number/` である。値は必ず `asset-index.json` に存在するパスでなければならない。同じlegacy keyが異なるraw pathへ解決される場合は、内容や世代順位にかかわらず曖昧な契約としてfail closedする。

`verifySitedata` はsite APIのunit/enemy/name/thumbnail代表キーに加え、save-app/labが生成する4 form×7 asset keyの代表キーを実データindexに対して検証する。

## APK履歴版台帳

`jp/apks/index.json` が履歴版の唯一の台帳である。トップレベルは `schemaVersion`、`packageName`、`latestConfirmed`、`retention`、`versions` だけを持つ。`latestConfirmed` は `versionName`、manifest `versionCode`、展開キー `compactVersion` の三値を持ち、confirmedレコードと完全一致しなければならない。`versions` はversionCode降順に並べる。

各recordは次の固定フィールドを持つ。

- `versionName`、APK manifestの `versionCode`、`jp/apks/<compactVersion>/` に使う `compactVersion`
- `packageName`、`source`、merged APKの `mergedApkSha256`、署名証明書の `signingCertificateSha256`
- `compatibility`: `compatible` または `incompatible`
- `reason`: compatibleなら `null`、incompatibleなら判定理由
- 復号treeの `sha256`、`size`、`fileCount`
- `expandedPath`: confirmed/expandedでは `jp/apks/<compactVersion>`、それ以外は `null`
- `archive`: 初回bootstrap前のlocal展開版だけは `null` を許す。検証upload後のconfirmed/expandedとarchivedでは `provider`、`repository`、`tag`、`releaseUrl` と、multipart対応の `assets[{name,url,bytes,sha256,apiId}]` を持つ
- 15.5.1のmerged APK SHA-256は `f7363b230345508b9ede469c927340553828d2892e030f67ecffda165c38ec97`、Google Play基準のsigner SHA-256は `baf876d554213331c6fe5f6bbf9ae9af2f95c20e82b14bc232b0ac3a77680cb1`
- `source`: 取得元を識別できる説明
- `state`: `confirmed`、`expanded`、`archived`、`skipped`

recordのSHA-256は、復号済み全ファイルを相対パス順に並べ、相対パス・size・ファイルSHA-256から算出するtree digestである。Releaseの各partは `archive.assets` ごとにURL、bytes、SHA-256、API IDを記録し、asset名昇順に並べる。URLはHTTPS、hashは小文字64桁で検証する。

`jp/version.json` は現在確定版の `schemaVersion`、`packageName`、`versionName`、manifest `versionCode`、`compactVersion`、`mergedApkSha256`、`signingCertificateSha256`、`source` だけを持つ。build前にconfirmed台帳レコードとの完全一致を検証する。

`retention.maxExpandedVersions` の既定は2、`retention.maxExpandedBytes` の既定は1 GiBである。`confirmed` と `expanded` の合計がどちらかの上限を超えると検証に失敗する。`archived` と `skipped` のディレクトリが `jp/apks/` に残っている場合も失敗する。

## 履歴版の受け入れ手順

1. 復号結果に10個の必須ルートが正確に存在することを確認する。
2. 最新付近の版は `jp/apks/<compactVersion>/` に展開し、`expandedPath` と実測tree SHA-256、size、fileCount、検証済みarchiveを登録する。初回bootstrap前のconfirmed currentだけは過渡的に `archive: null` を許す。
3. 最新確定版だけを `state: confirmed` にし、`latestConfirmed` の三値を同じレコードに一致させる。保持する直前版は `expanded` にする。
4. 既定2版を超えるcompatible版はGitHub Release等へアーカイブし、展開ディレクトリを置かず `state: archived`、`expandedPath: null`、multipart対応の `archive` を記録する。
5. 必須ルートや命名形式が違い、安全な現行変換ができない版は展開せず、`compatibility: incompatible`、`state: skipped`、具体的な `reason` を記録する。
6. `npm run verify:apks`、`npm run build:sitedata`、`npm run verify:sitedata`、`npm test` の順に確認する。
