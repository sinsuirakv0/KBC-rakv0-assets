# キャラ索引v2・関連asset圧縮・手動override契約

キャラ情報は用途と取得タイミングに応じて2つのatomic生成物へ分ける。

- `jp/sitedata/character-index.json`: 一覧表示に必要な名前・説明・キャラ単位別称だけを持つ。先に取得する
- `jp/sitedata/character-assets.json`: 関連pathだけを圧縮して持つ。asset表示時に遅延取得する

`character-assets.json` は名前・説明・aliasesを重複保持しない。どちらも `asset-index.json` とExplorer raw payload一覧には含めない。手動編集の正は生成JSONではなく、sitedata外の `jp/character-overrides.json` である。

## 名前・説明・キャラ単位別称

名前・説明の唯一の正は `res/Unit_Explanation{sourceId}_ja.csv` である。`Data/unit{sourceId3}.csv` は対応存在確認と関連path導出だけに使う。Data CSVには行末 `// ネコ` のようなコメント名が大量にあるため、名前・説明・別称へ絶対に流用しない。

Unit_Explanationはquoted comma・escaped quote・quoted newline対応のCSV parserで読み、次のように解釈する。

- col0: 形態名
- col1～col3: 説明3断片。空文字または全角空白だけの断片を除き、順番どおり連結する
- col4: ゲーム由来の読み。説明へ連結せず、自動aliasesにも投入しない
- col5以降: 使用しない末尾空欄

行全体が `//`、`#`、`;` で始まる行は収録せず、説明本文内の同じ記号は切らない。空名はskipし、補正後の形態名が直前と同じ行から先は旧KBC-GG scriptどおり未実装形態として打ち切る。最大4形態である。形態名が `^8\d\d[-_]\d+$` かつ説明先頭が `^精霊[：:]` の場合だけ、形態名を `精霊` に補正する。

`aliases` は形態別ではなくキャラ単位fieldであり、`jp/character-overrides.json` の `aliases.include` だけから生成する。現overrideが空なら全キャラ `[]` になる。

## character-index.json schemaVersion 2

先頭キーは `gameVersion`、`versionCode`、`schemaVersion`、`units`。`units` はarrayで、各unitの先頭fieldに最低3桁のゼロ埋め `id` を持つ。`"000"` から数値昇順に連続させる。arrayにする理由は、`"100"` 以降がJavaScriptのcanonical integer-index object keyとなり、通常objectでは`JSON.parse`後に`"000"`～`"099"`より先へ列挙されるためである。`sourceId = Number(id) + 1` である。

```json
{
  "gameVersion": "15.5.1",
  "versionCode": 1505010,
  "schemaVersion": 2,
  "units": [
    {
      "id": "000",
      "forms": [
        { "name": "ネコ", "description": "安価で生産できる基本キャラ" }
      ],
      "aliases": []
    }
  ]
}
```

`units` のarray順と `id` の両方を検証し、現データでは0番目が`"000"`、99番目が`"099"`、100番目が`"100"`、最後が`"872"`となる。`forms` の配列順が第一～第四形態を表す。`aliases` は空でもarrayを残してconsumer schemaを単純にする。文字列配列はordinal昇順・重複なしである。

## character-assets.json

pathだけを持つ独立schemaであり、現在は `schemaVersion: 1`、`pathRuleVersion: 1`。容量削減のため決定的なminified JSONとして生成する。

```json
{
  "gameVersion": "15.5.1",
  "versionCode": 1505010,
  "schemaVersion": 1,
  "pathRuleVersion": 1,
  "pathTemplates": {
    "i": "ImageData/{id}{suffix}",
    "iu": "ImageData/udi{id}{suffix}",
    "uu": "Unit/udi{id}{suffix}",
    "un": "Unit/uni{id}{suffix}",
    "g": "Image/gatyachara_{id}{suffix}",
    "d": "Download/download_char_{id}{suffix}",
    "x": "{suffix}"
  },
  "derivedTemplates": {
    "data": "Data/unit{sourceId3}.csv",
    "explanation": "res/Unit_Explanation{sourceId}_ja.csv"
  },
  "units": [
    {
      "id": "000",
      "i": ["_c.imgcut", "_c.mamodel"],
      "g": ["_f.png"]
    }
  ]
}
```

DataとUnit_Explanationの2pathはIDから常に導出し、unitごとには保存しない。overrideでderived pathを除外した場合だけ、unitの `omit` に `data` または `explanation` を記録する。標準外manual pathは `x` にexact POSIX pathを保存する。各codeのsuffix配列をsortし、units arrayはindexとidの一致を厳格検証する。

`decodeCharacterAssetPaths(characterAssets, id)` は `Number(id)` のarray位置とid一致を確認して1キャラだけ復元する。`decodeAllCharacterAssetPaths(characterAssets)` は全キャラをlossless復元する。サイトはindexを先に取得し、asset機能を開いた時点でassets JSONを遅延取得できる。

anchored matcherが自動収集する範囲は次のとおり。

- `Data/unit{sourceId3}.csv` と `res/Unit_Explanation{sourceId}_ja.csv`
- `ImageData/{id}_[c,e,f,s,p,m,u,g,a]` 系と `ImageData/udi{id}` 系
- `Unit/(uni|udi){id}` 系
- `Image/gatyachara_{id}` 系
- `Download/download_char_{id}` 系

`download_char_0000` をID `000` に含めず、stamp、img044、bankなど同じ数字だけの無関係pathも混入させない。

## jp/character-overrides.json

```json
{
  "schemaVersion": 1,
  "units": {
    "000": {
      "aliases": { "include": ["手動別称"], "exclude": [] },
      "paths": { "include": ["Image/manual.png"], "exclude": [] }
    }
  }
}
```

必要なunitとblockだけを記録し、空blockを大量生成しない。path overrideはraw自動検出値へ毎回適用するため、更新で手動変更を潰さず新assetも自動反映できる。aliasesは`include`だけを有効値にする。source aliasを自動投入しないため、非空のalias `exclude` は冗長指定として拒否する。include/excludeはcanonical sort・重複なし・相互衝突なしとする。

pathはsitedata相対POSIXだけを許し、絶対path、Windows区切り、空segment、`.`、`..` を拒否する。manual include pathは現sitedataに存在しなければfail closed。exclude pathは将来再登場したときにも除外できるよう、現在存在しなくても保持を許可する。

v1生成物に非空manualまたは未反映の直接編集差分がある場合、buildはmigration requiredとして失敗する。生成物からoverrideを自動書換えしない。現在版v1は全manualが空であることを移行前に監査済みである。

`verify:sitedata` はactual generated JSONをpreviousにせず、現rawとoverrideから両JSONを独立再計算する。version、873件の連続array ID順、形態、manual-only unit aliases、template辞書、suffix encoding、全effective pathのdecode roundtripを検証する。
