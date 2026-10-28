# Integrated-dataと音源・ZIP配布

2026-10-29の現行契約。

```text
jp/Local/<versionCode>/<9群・assets>/  本家の原本（版名は数字だけ）
jp/server/                          本家サーバー素材
jp/Integrated-data/<分類>/           最新版の統合実体、直下を更新ごとに置換
jp/Integrated-data/music/            全OGG・CAF等、BGMとSEの両方
overrides/jp/music/                  初回音源と新規音源の再生成可能な正本
overrides/jp/music-sources.json      コピー元repo/commit/path、size/SHA256
generated/jp/datasets/<versionCode>/ キャラ・素材索引とmanifest
metadata/jp/versions/<versionCode>.* 元APK proof / inventory
metadata/jp/integrated.json          最新統合物の全件size/SHA256・採用元
metadata/jp/current.json             検証済み最新版
```

## 生成と上書き

datasetId/buildIdのhashは内容と原APKの識別子としてJSON内に保持する。フォルダ名と版台帳名はversionCodeだけ。storageVersion=2がこの配置を示す。同じversionCodeの再取得・再生成は候補checkout内で作り直し、検証した1コミットで上書きする。Git履歴と元APKのprivate Releaseは保護する。旧commitの読み取りは当時のパスを使う。

Rust generate::selectはLocal、Server、手動補完の採用元を決め、音声にはmusic/<name>の論理パスも作る。scripts/integrated-data.mjsがその索引から実体をコピーし、全件hashを照合してjp/Integrated-data直下を置換する。索引と統合物を別々の版で生成しない。generated、Integrated-data、metadataは手編集しない。

初回はKBC-rakv0-testのOGG 187本と、公開済みAPK内の不足音源をコピーした。正本はOGG 190本・CAF 9本。旧000.ogg等はsnd000.oggへ統一した。同じ名前・形式では最新APK側を優先し、異なる形式は両方残す。BGMだけに限定せずSEも含む。更新時に新しい音声を見つけたらoverrides/jp/musicにも追加し、次のAPKから消えても保持する。変換・再圧縮は行わない。

scripts/platform-client.mjsのdatasetPaths()は旧commitとstorageVersion=2のパスを解決する。openDataset()/readAsset('music/snd000.ogg')は固定commitでsize/SHA256を検証する。sourceKind=musicは保全した音源、localは署名検証済みAPK原本。詳しいコピー元はmusic-sources.json、原APKの出所はproofを参照する。

## アプリからのZIP取得

固定の入口:

- https://github.com/sinsuirakv0/KBC-rakv0-assets/releases/latest/download/manifest.json
- https://github.com/sinsuirakv0/KBC-rakv0-assets/releases/latest/download/music.zip
- 同じ形式でData.zip / Image.zip / ImageData.zip / Number.zip / Unit.zip等

manifest.jsonのheaderにversionCode/versionName/datasetId/buildId、revisionに生成元Git commit、archivesに各ZIPのfileCount/size/SHA256と版固定URLを持つ。ZIP内にはmusic/等の分類フォルダを含む。

アプリはmanifest.jsonを一度取得し、その中の版固定URLで必要なZIPだけを取得する。size/SHA256を確認し、一時領域へ展開してから利用中データを切り替える。複数ZIPを取得するときは同じmanifestを使い、個別にlatestを解決し直さない。

## GitHub Actions

1. battlecats-apkの通常Publish: 取得・署名・復号・旧フォルダ移行・索引生成・再生成一致・障害境界検証。
2. 同じジョブでIntegrated-dataの生成と全件検証、元APK Release保全、raw/補完/索引/metadata/Integrated-dataを1コミットでpush。
3. このrepoのpublish-integrated.ymlがpushを受け、scripts/package-integrated.pyで各フォルダを個別ZIP化する。原本hash、ZIP内容とCRCを検証する。
4. draft Releaseへ全ZIPとmanifestをuploadし、GitHub上のsize/digestも確認。全て揃った後だけReleaseを公開してlatestを切り替える。

同じ版の再実行でも新しい配布Releaseを作り、既存配布を壊さずlatestを切り替える。tagの末尾はActions実行番号で、利用側が固定する必要はない。生成失敗時は前のReleaseを維持する。upload失敗のdraftは公開されない。より新しいcurrentが先に公開された場合は古い候補をlatestへ昇格しない。

手動再生成はsource側のPublishをforce_download=trueで実行する。ZIPのみの再生成は本repoのPublish Integrated-data ZIP downloadsを手動実行する。別称編集の既存build/publishも同じIntegrated-data生成処理を使う。
実環境での検証結果・障害原因と修正は [2026-10-29検証記録](integrated-data-validation-20261029.md) を参照する。
