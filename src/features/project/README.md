# プロジェクト

スレッドを入れる箱。閲覧範囲、ガントの範囲、メンションの候補、親子関係の範囲。
このシステムのいくつもの境界が、この一行に紐づいている。

仕様は [docs/features/project/index.html](../../../docs/features/project/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- プロジェクトの作成と設定
- 公開と非公開の切り替え
- 非公開プロジェクトのメンバー管理
- アーカイブと論理削除

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
