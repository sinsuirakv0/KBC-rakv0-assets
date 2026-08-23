# Git payload bytes

`jp/apks/`、`jp/server/`、`jp/sitedata/` は、改行コードを意味の一部として扱うraw payloadです。rootの`.gitattributes`で`-text`を指定し、Gitの改行変換を禁止します。`jp/explorer/`などのExplorer metadataはこの属性対象に含めません。

## 監査契約

`npm run verify:git-payloads` は次を一括で確認します。

- `git ls-files --stage`のstage 0 payload blobだけを対象にする
- untracked、ignored untracked、unmerged entry、unsafe/control/newline pathを拒否する
- `git check-attr`で全payloadが`text: unset`（`.gitattributes`の`-text`）であることを確認する
- `git hash-object --no-filters --stdin-paths`を一括実行し、working bytesのblob IDとindex blob IDを全件比較する
- path一覧、ファイル内容、巨大なGit出力をエラーへ表示しない

この監査はpayloadを修正、stage、commitしません。現在のworking bytesとindex blobが異なる場合は、改行変換を推測せずfail closedにします。

## one-time repair

既存payloadをcanonical化する場合は、次の順序で実施します。

1. 別の作業コピーまたはバックアップを用意し、payloadのworking bytesが既存indexのsize/SHA-256と一致することを確認する。
2. `core.autocrlf=false` の隔離cloneで作業する。
3. root `.gitattributes`の`-text`を先に用意する。
4. `git add --renormalize`は使用しない。canonical bytesをLFへ変換する可能性がある。
5. `npm run repair:stage-git-payloads`を実行する。helperはworking payloadを編集せず、index blobとの差分が5,000件以下であること、全差分のhistorical `core.autocrlf=true` clean proofが一致することを確認した後、raw blobを一括writeしてpayload indexだけを更新する。既存のpayload以外のstaged変更は保持する。
6. helperが出力するのはstage件数だけである。途中のproof失敗、unsafe path、untracked、unmerged、属性不一致ではindexを更新しない。
7. `npm run verify:git-payloads`で、stage済みGit blobとworking bytesの全件一致を確認する。
8. `npm run verify:apks`、`npm run verify:sitedata`、`npm run verify:explorer`、`npm test`を実行する。
9. 新しいLinux cloneで同じ監査とverifyを再実行し、改行設定に依存しないことを確認する。

size/hash、source、pathのいずれかが一致しない場合は、ファイルを自動変換せず停止します。helperがstageするのは検証済みのGit indexだけで、working payloadやpayload内容を変更しません。
