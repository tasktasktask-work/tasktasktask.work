# 組織とメンバー

テナントの境界。すべてのデータがこの下に入る。
ひとりが複数の組織に所属できるので、所属関係は `organization_members` が持つ。

仕様は [docs/features/organization/index.html](../../../docs/features/organization/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- `queries.ts` スコープの組み立て、メンバー一覧、役割、外す、組織名
- `invitations.ts` 招待の発行、一覧、取り消し、確認、受諾
- `scope.ts` ページとスコープの橋渡し
- `actions.ts` Server Actions。slug からスコープを組み立て直す
- `mail.ts` 招待メールの文面
- `OrgShell.tsx` 組織の中の画面に共通する枠
- `InviteForm.tsx` / `MemberActions.tsx` / `SettingsForm.tsx` / `JoinForm.tsx` フォーム

最初の組織管理者は画面からは作れない。`pnpm org:create` で作る
（[組織を自分で作る](../../../docs/issues/organization-signup/index.html)）。

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- **`scope.isOrgAdmin` は画面の出し分けにだけ使う。**
  書き込みの可否と、返す情報の絞り込みは `orgAdminExists()` を使って SQL の中で確かめる
  （[規約](../../../docs/devops/coding-conventions/index.html#trust)）
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- 役割を変える、メンバーを外すときは、先に管理者の行を `FOR UPDATE` で掴む。
  掴まないと、最後の組織管理者が二人がかりで消える
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
