# コメント

スレッドに時系列で連なる発言。枝分かれしない。
一度投稿したら編集も削除もできない。

仕様は [docs/features/comment/index.html](../../../docs/features/comment/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- コメントの投稿
- Markdown の描画（GFM 相当、生 HTML は受け付けない）
- メンションの解析と通知の作成

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
