## Explorer索引

`jp/explorer/` は、private assetsをサイトから安全かつ高速に列挙・比較するための決定的なメタデータである。巨大なGit tree APIの再帰取得には依存しない。

```text
jp/explorer/
├─ catalog.json
└─ manifests/
   ├─ apk/<compactVersion>.json
   ├─ server/v<versionName>-<compactVersion>.json
   └─ sitedata/v<versionName>-<compactVersion>.json
```

### 契約

- `catalog.json` と各manifestは `schemaVersion: 1` を持つ。
- catalogはpackage名、最新確定版、`apk`、`server`、`sitedata` のsnapshot一覧を持つ。ファイル一覧はcatalogへ入れない。
- APK snapshotのIDは台帳の`compactVersion`である。server/sitedataのIDは`v<versionName>-<compactVersion>`で、生成時点の最新確定APKに結び付く。
- manifestの`files`はraw rootからの相対pathをキーにし、size、SHA-256、content type、preview種別を記録する。パスはスラッシュ区切りで、絶対path、`..`、空segment、バックスラッシュを許可しない。
- `available: true` は対応するraw rootが存在し、manifestと全ファイルのsize/SHA-256が一致する場合だけである。過去のmanifestは削除せず、raw treeを保持しない過去版は`available: false`としてcatalogに残る。
- confirmed/expanded recordに検証済み`archive`があれば、APK snapshotにも同じarchive objectを保持する。初回bootstrap前の`archive: null`ではlinkを生成しない。
- `image` previewはPNG/JPEG/GIF/WebP/AVIF/BMP/ICOだけである。SVGやHTMLは`text`扱いで、サイト側はinline画像として表示してはならない。未知の拡張子は`binary`である。
- sitedataは既存`asset-index.json`のハッシュを再利用するが、生成時に実ファイルのsize/SHA-256を必ず照合する。APK/serverもストリームhashで走査し、全ファイルをBufferとして同時に保持しない。

### 実行順序

更新pipelineはsitedata構築直後にExplorerを構築し、commit前に検証する。

```text
npm run verify:apks
npm run build:sitedata
npm run verify:sitedata
npm run build:explorer
npm run verify:explorer
```

`build:explorer` は現在のmanifestを更新しつつ、既存の過去manifestを保持する。APK履歴をarchiveへ移す前に、その版のmanifestを生成しておくこと。archiveだけの版は、manifestが存在する限りdownload導線と差分比較の対象に残る。

### サイト側の利用

サイトはcatalogを取得後、選択したsnapshotのmanifestだけを取得する。差分は2つのmanifestのpathとSHA-256を比較して追加・変更・削除を求める。raw fileの取得APIはcatalogにある`rawRoot`とmanifestに存在する相対pathの組み合わせだけを許可する。
