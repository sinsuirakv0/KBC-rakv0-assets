# Integrated-data公開検証（2026-10-29）

## 実環境の結果

対象はJP 15.7.4（versionCode=1507040）、engine 0.5.0。生成物のbuildIdは `jp-1507040-506df7ed44ddcc9e-64a4ef4ac27231c3`。

| 確認項目 | 結果 |
| --- | --- |
| 通常公開経路 | [source Actions 40716857136](https://github.com/sinsuirakv0/battlecats-apk/actions/runs/40716857136) 成功。取得・署名検証・復号・134補完・元APK Release保存・Git pushまで完了 |
| 既存フォルダ移行 | 1507021 / 1507030 / 1507040のraw、索引、inventory、proofを数字だけのパスへ移行。元inventoryの全件検証後に移動。古い7版と元APKは保持 |
| 再現性・異常入力 | 同一入力の再生成一致、不正データ・欠損の拒否をsource Actionsで確認 |
| Integrated-data | 54,338ファイル、10フォルダ。生成元の採用索引と全件size/SHA256一致 |
| 音源初回コピー | OGG 190本・CAF 9本、計199本。コピー元とhashは `overrides/jp/music-sources.json`。元bytesを保持 |
| APK assets全体 | 236ファイル・139,573,796バイト、うち.list/.packは18本。実APKとの独立照合成功 |
| ZIP自動公開 | [assets Actions 40780972407](https://github.com/sinsuirakv0/KBC-rakv0-assets/actions/runs/40780972407) 成功。10 ZIPの内容・CRC・アップロード後size/SHA256を検証して公開 |
| 配布URL実取得 | latestのmanifestから版固定URLを取得し、music.zip（158,315,208バイト）とDownload.zipをダウンロード。size/SHA256一致 |
| SDK | mainのOGG/CAFを取得・hash検証し、出典台帳も取得成功。旧固定commit `ebb11d6ad05b14e84d0ceb0c294bc44547e3a097`（15.7.2）の読み取りも成功 |
| Web | [Actions 40716739300](https://github.com/sinsuirakv0/kbc-web/actions/runs/40716739300) 成功。新旧配置を共通SDKで解決 |
| イベント監視 | [Actions 40715747066](https://github.com/sinsuirakv0/KBC-rakv0-event/actions/runs/40715747066) 成功。storageVersion=2の数字だけの索引パスを使用 |

配布フォルダはData、Download、Image、ImageData、Map、Number、Unit、assets、music、res。初回公開Releaseは `integrated-jp-1507040-3-1`。全ZIPのhashは直前の候補生成とも一致し、ZIP自体も同じ入力から再現できた。

## 実際に発生した公開障害と修正

[assets Actions 40717767300](https://github.com/sinsuirakv0/KBC-rakv0-assets/actions/runs/40717767300) は全ZIPのアップロード後、下書きReleaseのタグ指定REST取得が404となり停止した。候補 `integrated-jp-1507040-2-1` は下書きのままで公開されなかった。

publish-integrated.ymlでは `gh release view --json databaseId` で下書きのRelease IDを取得し、RESTの `/releases/<id>` からassetのstate/size/digestを照合するよう修正した。検証が成功してから `gh release edit --draft=false --latest` で公開する。正常版のassetを途中で削除・上書きしない。

運用手順と関数関係は [integrated-data.md](integrated-data.md) を参照する。アプリは最新manifestを1回取得し、その版固定URLを使って必要なZIPを取得する。Git上のcurrent更新からZIP公開までには処理時間差があるため、ZIP利用時の版は配布manifestで完結させる。

## 同版再取得と並行更新

[source Actions 40780859612](https://github.com/sinsuirakv0/battlecats-apk/actions/runs/40780859612) で15.7.4を実際に再取得し、同じbuildIdとIntegrated-data全54,338ファイルの一致を確認した。移行済みの版には再移行処理を行わない。変更されたのは取得日時を含むproofだけだった。

この実行中にassetsのZIPワークフロー修正を先にpushしたため、sourceからの最終pushはnon-fast-forwardで拒否された。正常なcurrent・公開済みReleaseは維持され、並行更新を上書きしなかった。競合時は変更を強制pushせず、修正を確定してから通常Publishを再実行する。

修正確定後の [source Actions 40781548106](https://github.com/sinsuirakv0/battlecats-apk/actions/runs/40781548106) は通常公開まで成功した。公開commitは `877db31665dc12419df3cf0b07f016b3d1747a9b`。APK再取得22秒、同一buildId・全生成物一致、不正/欠損拒否、APK assets全236ファイルと統合物全件照合、private Release照合、Git pushを再確認した。差分は `1507040.proof.json` の取得記録1ファイルだけで、版フォルダや生成物は増えなかった。

配布内容が変わらないためZIPの再生成は起動せず、既存の検証済みReleaseを維持した。音源の採用元は最新APKが27本、保全正本が172本。保全側のsnd001.ogg、最新APK側のsnd195.oggもSDK経由で取得・hash検証した。
