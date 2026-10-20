# v2での参照先

正本はoverrides/jp/。生成先はmetadata/jp/current.jsonのgeneratedPathから解決する。旧sitedata用スクリプトの記述は移行前の記録であり、再生成はscripts/data.mjsを使う。

# キャラ名・形態の補完

編集元は `overrides/jp/characters/data.json`。JP生データで仮番号になった名前、海外の実装形態、削除済みの名称を補う。**ステータスの数値は現行データを維持する**というユーザー指定のため、数値の上書きは扱わない。既存の `character-overrides.json` は別称・関連パス専用であり、このファイルと混ぜない。

## 編集するもの

```json
{
  "schemaVersion": 1,
  "reviewedVersion": "15.7.1",
  "sources": {"ybc": {"url": "https://ybcecho.vercel.app/l_unit.html", "checkedAt": "2026-10-13"}},
  "units": {
    "740": {"source": "ybc", "kind": "overseas", "forms": [{"name": "ゴミ箱ネコ"}, {"name": "ミミックネコ"}]}
  }
}
```

- IDはゲームのキャラID。unit CSV・説明ファイルの番号から1引いた値。
- kindはnormal / overseas / retired。精霊は召喚先IDから利用側で判定する。
- formsは実装を確認した形態の順。配列より後の仮形態は利用側のDBへ収録しない。存在する形態の数値を変更しない。
- 各形態はname、必要ならdescriptionのみ。statsなど数値の指定は同期処理で拒否する。
- useNativeNames:trueは現行の名前・説明を表示し、formsの補完名は検索用aliasesに加える。ユーザー指定により削除済み155はこの方式で156-1 / 156-2と表示し、のべにゃん / とばにゃんでも検索できる。海外・精霊は補完した表示名を維持する。
- sourceはsourcesに記録した参照元。URLに閲覧用キーを含めない。checkedAtとreviewedVersionは確認時に更新する。
- motionFormsは画像・モーションをWebビルドにも含めるIDと形態コードの一覧。例: `"741": ["f", "c"]`。定義した形態のPNG、imgcut、mamodel、00〜03.maanimを画像補完フォルダへ揃える。
- iconFormsは同梱する通常アイコンのIDと形態コードの一覧。`Unit/uni<id>_<code>00.png`を揃える。1×1の仮画像は実アイコンとして採用しない。
- JPで正式な名前・形態が追加された更新時は差分を確認し、不要になった補完を除く。自動で補完元の内容を置換しない。
- 配列から外す形態にアイコンと攻撃モーションが揃った場合、Web同期は補完の見直しを要求して停止する。新形態を古い補完で黙って隠さない。

2026-10-13、[ybcの一覧](https://ybcecho.vercel.app/l_unit.html)で海外20キャラ・44形態、ネコ小籠包の2形態を確認。のべにゃんはybc/JDBの現在表示も仮名だったため、名称と削除済みの扱いだけを[キャラ記録](https://wikiwiki.jp/bccharadata/%E3%81%AE%E3%81%B9%E3%81%AB%E3%82%83%E3%82%93)で確認した。旧数値は採用しない。

## Webへ反映する

`KBC-rakv0-lab/unit-db/overrides.mjs`がこの正本を読み、Web用DBの生成時に適用する。隣接するアセットリポジトリを優先し、存在しない環境では固定コミットの同じファイルを取得する。元のsource.jsonへ補完結果を書き込まないため、二重適用や更新キャッシュへの混入が起きない。

```powershell
cd D:\KBC\kbc-web
npm run sync:units -- --cached
npm run check
```

このメタデータはsitedataの名前・別称索引を直接書き換えない。他の利用先も補完を必要とする場合は同じ正本を明示して読む。別環境にはアセットリポジトリも用意するか、このファイルをアセット側へ公開してから同期する。

## 画像・モーションの上書き

画像とモーションは既存の `overrides/jp/assets/Unit`、`Number`、`ImageData` に置く。[画像補完の契約](character-image-overrides.md)の通り、sitedata生成時にLocal/serverより優先度1000で採用する。HTTP・PNG署名・定義のヘッダー・参照先を確認し、404や別形態の素材で埋めない。

`build:sitedata` → `verify:sitedata` → テストで確認し、新しいアセット版を公開した後にWebの`sync:units`で参照コミットを更新する。生成済みsitedataだけの手編集は再生成で失われる。

精霊の通常アイコンは全身画像が小さく潰れる場合があるため、Web側は同じ版のimgcutで「消えるとき」と名付けられた全身部分をNumberのスプライトから切り出す。23体で範囲を確認し、新たな画像実体をこのリポジトリへ増やしていない。

2026-10-13、海外741〜745の第1・第2形態は索引に名前がある一方、公開モーション定義が空だった。ybcの上記公開パスで70ファイル（866,064バイト）を取得し、HTTP 200・PNG署名・imgcut内のPNG名・定義のヘッダーを検査して正本に追加した。数値CSVを変更しない。攻撃周期・DPSの欠測は実モーションの長さから補える。

Webの`media-overrides.mjs`はmotionFormsとiconFormsを明示的に読み、同期時の攻撃アニメーションへ適用する。`unitMotionPlugin()`はモーション70ファイルをハッシュ付きでdist/images/unit-motion/へ出力する。公開アセット版の更新前でも同梱素材から描画でき、閲覧時にybcへ接続しない。Webをビルドする環境には正本のアセットリポジトリが必要。今回sitedata全体は再生成していない。

海外・削除済み・ネコ小籠包の全48アイコンを確認し、741〜745の10枚が1×1の仮画像だった。ybcのUnitLocalから実アイコンを取得しiconFormsへ宣言した。画像はPNG署名・幅・高さを検査。追加は42,779バイト。モーションと合わせて80ファイル・908,843バイトをWebへ同梱し、共通view.unitImageUrl()が検索・詳細・コンボ・モーションのアイコンを同じ優先順で参照する。
