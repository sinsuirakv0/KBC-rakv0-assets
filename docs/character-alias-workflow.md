# v2での参照先

正本はoverrides/jp/。生成先はmetadata/jp/current.jsonのgeneratedPathから解決する。旧sitedata用スクリプトの記述は移行前の記録であり、再生成はscripts/data.mjsを使う。

# キャラクター別称の編集と公開

キャラクター別称の正本は `overrides/jp/characters/aliases.json` であり、公開用の値は `jp/sitedata/character-index.json` の各キャラクターにある `aliases` である。生成物の `character-index.json` は直接編集しない。

## 対話形式で編集する

次のコマンドを実行する。

```powershell
npm run edit:character-aliases
```

キャラクターIDを入力すると形態名と現在の別称を表示する。`a` で追加、`d` で削除を選ぶ。削除時は表示された番号を入力する。IDは `0` と `000` のどちらでも指定できる。

最後の別称を削除した場合、そのキャラクターにpath overrideがなければunitブロック自体を削除する。path overrideがあればpathsだけを保持する。

## 引数で編集する

別称を追加する。

```powershell
npm run edit:character-aliases -- --id 860 --add "検索用別称"
```

別称を削除する。

```powershell
npm run edit:character-aliases -- --id 860 --remove "検索用別称"
```

編集内容はUnicode序数順に並べ、重複登録しない。同じ値の再追加または存在しない値の削除ではファイルを書き換えない。

## 生成物だけを確認する

commitせずに `character-index.json` へ別称を反映する場合は次を実行する。この処理では形態、説明、asset本体、`character-assets.json` を再生成しない。

```powershell
npm run build:character-aliases
```

差分は次のように確認できる。

```powershell
git diff -- overrides/jp/characters/aliases.json jp/sitedata/character-index.json
```

## commitしてpushする

編集後、次のコマンドで別称反映、`git add`、commit、現在branchのupstreamへのpushを順に実行する。

```powershell
npm run publish:character-aliases
```

既定commit messageは `chore(assets): update character aliases` である。変更する場合は `--message` を指定する。

```powershell
npm run publish:character-aliases -- --message "chore(assets): refresh character aliases"
```

公開対象は `overrides/jp/characters/aliases.json` と `jp/sitedata/character-index.json` の2ファイルだけである。対象外のstaged変更がある場合、upstream branchが設定されていない場合、別称差分がない場合はcommitとpushを行わない。pushが失敗した場合、作成済みcommitはローカルに残るため、原因を解消してから `git push` を再実行する。
