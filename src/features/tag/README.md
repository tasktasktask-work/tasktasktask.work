# タグ

階層と直交する分類の軸。組織の単位で定義し、プロジェクトをまたいで使う。

仕様は [docs/features/tag/index.html](../../../docs/features/tag/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- タグの作成と一覧
- スレッドへの付け外し

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
