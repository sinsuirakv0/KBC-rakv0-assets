# KBC-rakv0-assets

にゃんこ大戦争JP版の復号済み生データと、サイト配信用の確定データを管理するリポジトリです。旧来の `units/`、`enemies/`、`resources/` などの分類済み実体は置かず、実データは `jp/sitedata/asset-index.json` で管理します。旧パス互換用JSONは別途、利用側の要件に合わせて作成します。

## ディレクトリ

- `jp/apks/<compactVersion>/`: 最新付近のAPK由来生データ。既定で最大2版
- `jp/apks/index.json`: 展開版・アーカイブ版・非互換版の台帳と容量ガード
- `jp/version.json`: 現在確定版のpackage/version、merged APK・signer SHA-256、取得元
- `jp/server/`: 移動済みserver pack群
- `jp/sitedata/`: 台帳の最新確定版とserver群を統合したサイト配信用データ
- `scripts/`: build、台帳検証、sitedata検証
- `tests/`: Node.js組み込みtest runnerのテスト

詳細な契約、競合規則、履歴版の受け入れ手順は [docs/raw-layout.md](docs/raw-layout.md) を参照してください。

## コマンド

Node.js 20以上を使用します。

```powershell
npm test
npm run verify:apks
npm run build:sitedata
npm run verify:sitedata
```

`build:sitedata` は `jp/apks/index.json` の `latestConfirmed.compactVersion` が指す1版だけを基底にし、`jp/server/` を世代順に上書きして `jp/sitedata/` を再生成します。手作業で `sitedata` を編集しないでください。
