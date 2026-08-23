# キャラ索引の生成・手動差分契約

`jp/sitedata/character-index.json` は `npm run build:sitedata` がatomic生成するキャラ索引である。先頭キーは `gameVersion`、続いて `versionCode`、`schemaVersion`、`units` とする。`units` は数値ではなく最低3桁のゼロ埋め文字列IDで昇順に並び、`"000"` から始まる。`sourceId = Number(id) + 1` なので、ID `"000"` は `res/Unit_Explanation1_ja.csv` と `Data/unit001.csv`、画像系の `000` に対応する。

## 名前・説明・ゲーム由来別称

名前・説明・ゲーム由来別称の唯一の正は `res/Unit_Explanation{sourceId}_ja.csv` である。`Data/unit{sourceId}.csv` は対応ファイルの存在確認と関連path収録だけに使う。Data CSVには行末 `// ネコ` のようなコメント名が大量にあるため、名前・説明・別称へ絶対に流用しない。

Unit_Explanationの列は次のように解釈する。quoted comma・escaped quote・quoted newlineに対応したCSV parserを使う。

- col0: 形態名
- col1～col3: 説明の3断片。空文字または全角空白だけの断片を除き、順番どおり連結する
- col4: 任意のゲーム由来別称・読み。説明には連結せず、全形態分をunit-levelの `discoveredAliases` へ集約する
- col5以降: 末尾空欄として名前・説明・別称には使わない

行全体が `//`、`#`、`;` で始まる行は収録しない。説明本文内の同じ記号は切り捨てない。空名はskipし、補正後の形態名が直前と同じ行から先は旧KBC-GG生成scriptどおり未実装形態として打ち切る。最大4形態である。形態名が `^8\d\d[-_]\d+$` かつ説明先頭が `^精霊[：:]` の場合だけ、形態名を `精霊` に補正する。

## JSON構造

各unitは次の構造を持つ。

```json
{
  "id": "000",
  "forms": [
    { "index": 0, "name": "ネコ", "description": "安価で生産できる基本キャラ" }
  ],
  "aliases": [],
  "discoveredAliases": [],
  "aliasManual": { "include": [], "exclude": [] },
  "assets": {
    "paths": [],
    "discoveredPaths": [],
    "manual": { "include": [], "exclude": [] }
  }
}
```

`forms` は形態ごとの名前と説明の対応を明確にする。`aliases` と `assets.paths` は利用側が読む有効値、`discoveredAliases` と `assets.discoveredPaths` は現versionからの自動検出値、各manualは永続化する手動差分である。すべての文字列配列はordinal昇順・重複なしで生成する。

## 関連assetの検出

最低限、次をsitedata相対POSIX pathとしてanchored matchする。

- `Data/unit{sourceIdを0埋め可}.csv` と `res/Unit_Explanation{sourceId}_ja.csv`
- `ImageData/{id3}_[c,e,f,s,p,m,u,g,a]` 系と `ImageData/udi{id3}` 系
- `Unit/(uni|udi){id3}` 系
- `Image/gatyachara_{id3}` 系
- `Download/download_char_{id3}` 系

ID境界を固定するため、`download_char_0000` をID `000` に含めない。`000_stamp`、`001_img044`、bank系など、同じ数字を持つだけの無関係pathも含めない。実データ監査ではImageDataの追加先頭文字 `b` はbank系、`i` はimg044系だけであり、キャラ固有patternへ追加しない。

## 手動編集の保持

手動変更は `aliases` または `assets.paths` を直接編集する。次回buildは、旧 `discovered*` に旧manualを適用した期待有効値と、編集後の有効値との差分をmanualのinclude/excludeへ取り込み、新しいversionの `discovered*` に再適用する。これにより追加・削除・置換を保持しつつ、新しいゲーム由来別称と新assetを自動追加できる。

手動asset pathは現在のsitedata内に実在しなければbuild・verifyとも失敗する。絶対path、Windows区切り、空segment、`.`、`..` は拒否し、黙って修正・削除しない。aliasには存在確認先がないためpath gateは適用しない。

`verify:sitedata` は現rawから `forms`、`discoveredAliases`、`discoveredPaths` を独立再計算する。actual JSONをpreviousとして再生成しただけの自己充足検証にはせず、version、ID連続性、形態、manual、有効値、path実在をすべて照合する。
