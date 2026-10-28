# 外部ツール向けデータ契約

scripts/platform-client.mjsのopenDataset({ref,region})はGit commitを一度固定し、current→manifest→採用元/キャラ索引→実体の順にsize/SHA-256と版を検証する。readAsset(logicalPath)はBuffer、readInput('data.json')は元の補完JSONを返す。KBCSなど他言語からも同じHTTP順序で実装でき、Node依存は必須ではない。rawBaseとfiles[logicalPath].pathを結合したURLは同じ固定commitを指す。

JPの取得設定だけが実運用済み。regionはjp/en/kr/twを許可し、未配置地域のcurrentは404で停止する。海外版を追加する際はpackage/signature/keyと言語suffixの明示設定が必要で、JPの証明書・鍵を流用しない。

本家LocalはAPK proofのsplit hashと署名検証へ、本家Serverはそのcommitで保存された元ファイルへ接続する。sourceKind=overrideは本家ではない。補完の地域・調査元・URLはmanifest.inputs['data.json']がhash固定するoverrides/<region>/characters/data.jsonのsourcesとunitsのsourceで説明する。生成characters[].provenanceにも同じ出典を記録する。海外版由来の補完をJP本家と表示しない。別称はaliases.jsonの手動補完である。

再生成時は同じGit commitのraw・server・補完と同じエンジン版を使う。異なるエンジン版ではbuildIdが変わる。過去Server/overrideの内容を再取得する際も、その版を生成したcommitを固定する。


2026-10-29: [Integrated-data・music・自動ZIP配布](integrated-data.md)が現行の保存契約。数字だけの版パスはdatasetPaths()で解決し、ZIPはReleaseのmanifest.jsonから版固定URL・hashを取得する。
