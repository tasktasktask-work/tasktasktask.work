# 添付ファイル

形式を検査しない。守るのは配信の仕方である。
インライン表示するのは、サーバー側で再エンコードした画像だけ。

仕様は [docs/features/attachment/index.html](../../../docs/features/attachment/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- アップロードの受け取りと保存
- 画像の再エンコード
- 配信の Route Handler（ヘッダを付ける経路は**一本だけ**にする）

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
