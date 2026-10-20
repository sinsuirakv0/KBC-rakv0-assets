# 設計の入口

現行契約は [data-platform.md](data-platform.md)。取得・復号・生成の実装と関数関係は `battlecats-apk/engine/docs/README.md` を参照する。

旧資料のsitedata・jp/character-overrides・jp/explorer・jp/version.jsonは廃止済みの配置を説明している。補完の取得元に関する記録は引き続き有効で、現在の実体は `overrides/jp/` にある。旧スクリプト、旧テスト、移行前README、旧生成物のローカル保全先は `.local/pre-platform/`。未コミットだった別称・補完データ・設計資料も失っていない。

`metadata/jp/legacy/` は過去の出所とRelease参照を保つ資料で、新エンジンの入力台帳には使わない。過去Localの5版は唯一の取得物を失わないため保持している。

## 別称の編集

`npm run edit:character-aliases -- --id 11 --add "Mr. "` で `overrides/jp/characters/aliases.json` を編集する。`npm run build` は現在版の原本と全overrideから新しいbuildIdを作り、検証後にローカルのcurrentを切り替える。生成JSONを直接書き換えない。

`scripts/character-aliases.mjs` が別称の型・重複・存在IDを検証し、`edit-character-aliases.mjs` が編集、`data.mjs` がRustエンジン呼出し、`update-character-aliases.mjs` が再生成を担当する。公開はデータ基盤全体の検証済みcommitで行う。
