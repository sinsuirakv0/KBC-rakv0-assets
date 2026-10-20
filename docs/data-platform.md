# データ基盤v2

## 配置

```text
jp/Local/<datasetId>/<9群>/       本家の復号済みファイル
jp/server/<server群>/            本家サーバー由来ファイル
overrides/jp/assets/<分類>/       手動補完画像・モーション
overrides/jp/characters/          aliases.json / data.json
generated/jp/datasets/<buildId>/  site / indexes / explorer / manifest.json
metadata/jp/current.json         検証済み最新版への唯一のポインタ
metadata/jp/versions/             元split proof / 復号inventory
```

`jp/`へ生成JSON・手動補完を置かない。`generated/`は手動編集しない。変更は必ずoverridesへ記録し、エンジンで再生成する。関数・呼出関係の正本はbattlecats-apkの `engine/docs/README.md`。

Localは復号時inventoryを共有し、Serverと補完は一度の走査で一覧・hashを共通化する。採用優先度はLocal、Server、A～Z Server、手動補完の順。同順位・異内容はエラー。ファイルを統合先へコピーせず、`indexes/assets.json`のlogical path → 元pathを利用する。

生成物は共通のdatasetId・buildIdを持つ。rawの版をversionNameから推測せず、署名検証済みmanifestのversionCodeを使う。同じversionCodeに異なる元APKが来た場合は上書きしない。currentの切替前に復号inventoryの独立再読込検証を行う。

## 保存方式の判断

|方式|更新と配信|容量・ファイル数|運用|判断|
|---|---|---|---|---|
|Gitへrawと索引|コミット単位の一貫性、HTTP個別取得|大量ファイル・履歴増大|既存の無料運用を利用可能|当面の配信に採用|
|GitHub Releases|大きなarchiveをまとめて転送|個別ファイル配信には不向き|既存archiveを利用|元APKと過去版の保全|
|hash単位CAS|版間の同一内容を共有|物理重複を削減できる|GCと参照台帳が増える|重複率とGit容量の実測後に判断|
|オブジェクトストレージ|個別取得・CDNと相性がよい|Git履歴を抑制|アカウント・課金上限管理が必要|導入しない|
|Gitは索引のみ|checkoutは小さい|実体保存先が別途必要|二つの保存先の整合管理|無料の実体保存先が確定するまで保留|
|必要成果物だけ配信|消費側の転送を削減|Explorer全量利用とは別用途|同じ採用元マップで選択可能|キャラ・Explorer索引を分離して採用|

GitHubはリポジトリ1GB未満を理想、5GB未満を強く推奨し、Releaseの各assetは2GiB未満。R2は無料枠があるが超過時の従量課金があるため、完全無料という現行運用の条件により新規導入しない。無料枠の存在を無制限無料と扱わない。

出典（2026-10-20確認）: [GitHub large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)、[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)、[R2 pricing](https://developers.cloudflare.com/r2/pricing/)。方式の採否はKBCの要件に基づく判断で、外部サービスの性能実測を示すものではない。

## 移行時の保全

既存の未コミット別称・補完画像を保持する。旧Local版は保存元APKの再取得可否が版ごとに異なるため、一括削除しない。旧生成物を削除する前に、採用元マップから必要ファイルへ到達できることを確認する。元APK、独自補完、認証設定を生成物と同じ削除対象へ入れない。

## 公開検証 2026-10-21

134補完を含む通常経路のActionsでRelease保存・生成・再生成一致・破損/欠損拒否・Git pushを確認した。Release保存後の意図的停止ではbranch参照は正常版のまま。結果と復旧手順の正本はprivate battlecats-apk/docs/operations.md。mainはまだ切り替えていない。

過去Server/補完は当時のGit commitから読む。最新commitで別buildのServerを選ばず、current buildを使う。採用元マップのsourceKindと、manifest.inputsがhash固定する補完出典を外部ツールにも引き渡す。
