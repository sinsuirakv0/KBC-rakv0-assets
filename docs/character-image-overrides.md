# キャラ画像補完

## 目的

`jp/character-image-overrides/` は、JP版APKとserver packに存在しないキャラ画像を外部データから補完する正本である。`jp/sitedata/` の再生成時に毎回読み込み、同じ出力パスのLocal・server候補より優先する。

```text
jp/character-image-overrides/
├─ ImageData/
├─ Number/
└─ Unit/
```

直下にはこの3ディレクトリ以外を置かない。画像以外のゲームデータは補完対象にしない。

## 現在の取得元

2026年9月10日に、次のybcecho公開パスから不足ファイルだけを取得した。

- アイコン: `https://ybcecho.vercel.app/img/UnitLocal/<filename>`
- スプライトシート: `https://ybcecho.vercel.app/unit/sprite_image/<stem>.png`
- モーション定義: `https://ybcecho.vercel.app/unit/ImageDataLocal_SiteOriginal/<filename>`

アイコンはキャラID `729`、`732`、`734`、`739`、`740`、`755`、`761`、`764`、`770`、`775`、`782`、`788`、`800`、`802`、`812`、`816`、`818`、`821`、`825`、`838`、`839`、`855`、`860`、`875` を補完する。ID `740` と `788` は第1・第2形態の2枚、それ以外は第1形態の1枚で、合計26枚である。

戦闘モーションは海外版限定の次の4形態を補完する。

| キャラID | 形態 | stem |
|---:|---:|---|
| 740 | 0 | `740_f` |
| 740 | 1 | `740_c` |
| 788 | 0 | `788_f` |
| 788 | 1 | `788_c` |

各stemには、`Number/<stem>.png` と、`ImageData/<stem>.imgcut`、`<stem>.mamodel`、`<stem>00.maanim` から `<stem>03.maanim` を収録する。

現行索引上で不足しているID `155`、`202`、`285`、`432`、`433`、`497`、`498`、`499`、`500` の第3形態画像は、上記取得元にも存在しない。404レスポンスや推測生成物は保存しない。

## build時の優先規則

`scanBuildInputs` はLocal、server、キャラ画像補完の順に候補化する。`resolveCharacterImageOverrideRoot` は補完ファイルへ優先度1000を設定するため、Localの0とserverの100から126より常に高い。`createBuildPlan` が同じ出力パスを選ぶ場合、補完ファイルが最終採用される。

`build:sitedata` は補完ファイルを通常の生成対象に含め、`asset-index.json` と`build-report.json`にも取得元を `character-image-override` として記録する。`verify:sitedata` は補完元と生成済みファイルのサイズ・SHA-256を照合する。

## 更新手順

1. 既存の`jp/sitedata`と比較し、不足しているファイルだけを特定する。
2. HTTP 200、PNG署名、`imgcut`内のPNG名、`mamodel`・`maanim`のヘッダーを確認する。
3. 対応する`jp/character-image-overrides/`配下へ配置する。
4. `npm run build:sitedata`、`npm run verify:sitedata`、`npm test`を実行する。

取得元に同名ファイルが存在しても、既存補完を自動更新しない。差し替える場合は内容を比較し、意図した更新としてレビューする。
