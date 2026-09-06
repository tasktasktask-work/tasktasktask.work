# 通知とウォッチ

三つのきっかけで飛ぶ。アプリ内とメールの両方へ。
ウォッチは自動では付かない。

仕様は [docs/features/notification/index.html](../../../docs/features/notification/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- 通知の作成（メンション、担当者設定、ウォッチ中のコメント）
- 既読の管理
- 未送信のメールの送出
- ウォッチの付け外し

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
