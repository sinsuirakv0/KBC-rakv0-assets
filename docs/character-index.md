# キャラ索引（v2）

metadata/jp/current.jsonのgeneratedPath/site/characters.jsonを同じGit commitから読む。headerにdatasetId/buildId/sourceRegion/versionName/versionCode/engineVersion、unitsにid/forms/aliases/assets/kind/provenanceを持つ。

formsは説明CSVから抽出し、overrides/jp/characters/data.jsonの明示した形態数・表示名・説明を反映する。別称はaliases.json、関連素材はassetsのlogical path。素材の実体と出典はindexes/assets.jsonで解決する。generatedは手編集しない。

functions: generate::charactersが抽出と補完、generate::buildが索引・manifestを生成し、CLI build --publishが候補currentを切り替える。公開はGitの1コミットで行う。scripts/data.mjsは保存済み版の再生成をRustへ委譲する。

旧character-index.json/character-assets.jsonの説明はlegacy/character-index.mdへ保存した。新契約の仕様として使わない。
