# 担当スレッド一覧

プロジェクトをまたいで、自分が担当のものだけを集める。
通知の一覧も同じ画面に置く。

仕様は [docs/features/dashboard/index.html](../../../docs/features/dashboard/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- 担当スレッドの取得（プロジェクト横断）
- 通知一覧の取得

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
