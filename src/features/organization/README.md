# 組織とメンバー

テナントの境界。すべてのデータがこの下に入る。
ひとりが複数の組織に所属できるので、所属関係は `organization_members` が持つ。

仕様は [docs/features/organization/index.html](../../../docs/features/organization/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- 組織の作成と設定
- 招待の発行と受諾
- メンバーの一覧と役割の変更（組織管理者とメンバーの二段）

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
