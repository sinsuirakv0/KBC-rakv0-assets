# 生データ配置・統合・履歴版台帳

## 正式な配置契約

APK 15.5.1（manifest versionCode `1505010`、compactVersion `150501`）の生データは `jp/Local/150501/` に置く。versionCodeとcompactVersionは別の識別子であり、相互変換や同値比較をしない。compatibleな展開版は、次の10ディレクトリを名前どおりすべて持つ必要がある。

```text
jp/Local/<compactVersion>/
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

展開版root直下はこの10ディレクトリだけを許可する。`metadata.json`、`release-manifest.json` などの版メタデータをroot直下へ混在させない。現在版のメタデータは `jp/version.json`、履歴台帳は `jp/Local/index.json` に分離する。

移動済みserver群は `jp/server/` に置く。認識する名前は `([A-Z]?)(ImageData|Image|Map|Number|Unit)Server` だけである。`ImageData` は `Image` と別の種別として解析する。

JP版に存在しないキャラ画像の外部補完は `jp/character-image-overrides/` に置く。直下には `ImageData`、`Number`、`Unit` の3ディレクトリだけを許可し、同じ出力パスのAPK・serverファイルより常に優先する。これを補完画像の正本とし、`sitedata` 再生成時にも維持する。取得元と対象一覧は [character-image-overrides.md](character-image-overrides.md) を参照する。

キャラ別称・関連pathの永続手動変更は `jp/character-overrides.json` に置く。生成物を手編集せず、このファイルをbuildのsource of truthとする。

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
├─ build-report.json
├─ character-assets.json
├─ character-index.json
└─ README.md
```

## build規則

`scripts/build-sitedata.mjs` は台帳の `latestConfirmed.compactVersion` が指す `state: confirmed` かつ `compatibility: compatible` の1版だけをAPK基底に選び、同じpointerに記録したmanifest versionCodeとも一致することを検証する。別版のファイルを同時に走査しないため、履歴版は `sitedata` に混入しない。

Localの優先度は0、無接頭serverは100、AからZは101から126、キャラ画像補完は1000である。後の世代ほど優先し、キャラ画像補完は常に最終採用する。同じ出力パスに同内容が来た場合は優先度の高い採用元へまとめ、異内容なら高い優先度で上書きする。同順位・同一出力パス・異内容は未解決衝突として、出力を書き換える前に失敗する。

生成は一時ディレクトリで完了させてから `jp/sitedata/` と入れ替える。コンソールには件数と容量だけを出し、採用元は `asset-index.json`、上書き判断は `build-report.json`、キャラ本文は `character-index.json`、圧縮関連pathは `character-assets.json` に記録する。手動差分はsitedata外のoverrideから毎回適用する。

`README.md` はサイト正規参照先、統合元、手編集禁止、各indexの用途を説明するBOM付きUTF-8の固定生成物である。`templates/sitedata-README.md` から毎回決定的に配置し、atomic再生成でも保持する。motion確認サイト向けの互換JSONは生成せず、必要な場合は利用側の専用JSONとして別途管理する。

主な関数の関係は次のとおり。

- `loadBuildContext`: APK台帳を検証し、最新確定版の入力ルートを決める
- `scanBuildInputs`: APK 10群、server群、キャラ画像補完を固定規則で候補化する
- `createBuildPlan`: raw出力の採用元、上書き、衝突を決定する
- `applyBuildPlan`: SHA-256算出、ファイル複製、4つのJSONメタデータとREADME生成、出力入れ替えを行う
- `createCharacterOutputs`: Unit_Explanation、Data存在、関連assetとoverrideから本文索引・圧縮path索引を分離生成する
- `decodeCharacterAssetPaths`: templateとsuffixから指定unitのexact関連pathを復元する
- `verifyCharacterOutputs`: 現rawとoverrideから両生成物を独立再計算し、全path roundtripも照合する
- `verifySitedata`: 同じ入力から期待planを再構築し、全ファイルのsize/SHA-256、4 metadata JSON、固定構造、旧分類パス不在を照合する

## asset-index.json

`schemaVersion`、`gameVersion`、`versionCode` と、`files` mapを持つ。mapのキーは `sitedata` 相対パス、値は `size`、`sha256`、`source` である。`source` はAPK/server種別、元ルート、世代、優先度、リポジトリ相対の元パスを保持する。

## character-index.json / character-assets.json

詳細なschema、CSV列契約、圧縮path復元、override規則は `docs/character-index.md` を参照する。両JSONは生成metadataであり、`asset-index.json` とExplorer raw payload一覧には含めない。

## 旧パス互換JSON

motion確認サイトや他サイト向けの旧パス互換JSONは、このリポジトリのsitedata buildでは生成・検証しない。必要な互換形式は各利用側の要件に合わせた専用JSONとして別途作成する。

## APK履歴版台帳

`jp/Local/index.json` が履歴版の唯一の台帳である。トップレベルは `schemaVersion`、`packageName`、`latestConfirmed`、`retention`、`versions` だけを持つ。`latestConfirmed` は `versionName`、manifest `versionCode`、展開キー `compactVersion` の三値を持ち、confirmedレコードと完全一致しなければならない。`versions` はversionCode降順に並べる。

各recordは次の固定フィールドを持つ。

- `versionName`、APK manifestの `versionCode`、`jp/Local/<compactVersion>/` に使う `compactVersion`
- `packageName`、`source`、merged APKの `mergedApkSha256`、署名証明書の `signingCertificateSha256`。展開treeだけを受け入れた履歴版は `state: expanded` に限り、取得できないAPK proofを `null` にする
- `compatibility`: `compatible` または `incompatible`
- `reason`: compatibleなら `null`、incompatibleなら判定理由
- 復号treeの `sha256`、`size`、`fileCount`
- `expandedPath`: confirmed/expandedでは `jp/Local/<compactVersion>`、それ以外は `null`
- `archive`: local展開版は `null` を許す。検証upload済みのconfirmed/expandedとarchivedでは `provider`、`repository`、`tag`、`releaseUrl` と、multipart対応の `assets[{name,url,bytes,sha256,apiId}]` を持つ
- 15.5.1のmerged APK SHA-256は `f7363b230345508b9ede469c927340553828d2892e030f67ecffda165c38ec97`、Google Play基準のsigner SHA-256は `baf876d554213331c6fe5f6bbf9ae9af2f95c20e82b14bc232b0ac3a77680cb1`
- `source`: 取得元を識別できる説明
- `state`: `confirmed`、`expanded`、`archived`、`skipped`

recordのSHA-256は、復号済み全ファイルを相対パス順に並べ、相対パス・size・ファイルSHA-256から算出するtree digestである。Releaseの各partは `archive.assets` ごとにURL、bytes、SHA-256、API IDを記録し、asset名昇順に並べる。URLはHTTPS、hashは小文字64桁で検証する。

`jp/version.json` は現在確定版の `schemaVersion`、`packageName`、`versionName`、manifest `versionCode`、`compactVersion`、`mergedApkSha256`、`signingCertificateSha256`、`source` だけを持つ。build前にconfirmed台帳レコードとの完全一致を検証する。

`retention.maxExpandedVersions` と `retention.maxExpandedBytes` は、自動取得してRelease archiveを持つ `confirmed` / `expanded` のGit展開保持枠である。`local-import` かつ `archive: null` の比較用snapshotは常設データとしてこの枠に数えない。管理対象の件数または容量が上限を超えると検証に失敗する。`archived` と `skipped` のディレクトリが `jp/Local/` に残っている場合も失敗する。

## 履歴版の受け入れ手順

1. 復号結果に10個の必須ルートが正確に存在することを確認する。
2. 最新付近の版は `jp/Local/<compactVersion>/` に展開し、`expandedPath` と実測tree SHA-256、size、fileCountを登録する。archiveやmerged APK proofがないlocal importは捏造せず `null` にする。
3. 最新確定版だけを `state: confirmed` にし、`latestConfirmed` の三値を同じレコードに一致させる。保持する直前版は `expanded` にする。
4. 既定4版を超えるcompatible版はGitHub Release等へアーカイブし、展開ディレクトリを置かず `state: archived`、`expandedPath: null`、multipart対応の `archive` を記録する。
5. 必須ルートや命名形式が違い、安全な現行変換ができない版は展開せず、`compatibility: incompatible`、`state: skipped`、具体的な `reason` を記録する。
6. `npm run verify:apks`、`npm run build:sitedata`、`npm run verify:sitedata`、`npm test` の順に確認する。
