# スレッド

このプロダクトの基本単位。課題、議論、質問はその種別である。
種別によって使える列が変わるため、制約が `threads` に集中している。

仕様は [docs/features/thread/index.html](../../../docs/features/thread/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- `queries.ts` 一覧の取得。データにさわる関数の書き方の見本でもある
- スレッドの作成、編集、アーカイブ
- 親子関係の設定（循環参照の検査はここで行う）
- 進捗率と担当者の変更

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
