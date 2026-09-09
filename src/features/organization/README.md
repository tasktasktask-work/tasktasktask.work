# 組織とメンバー

テナントの境界。すべてのデータがこの下に入る。
ひとりが複数の組織に所属できるので、所属関係は `organization_members` が持つ。

仕様は [docs/features/organization/index.html](../../../docs/features/organization/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- `queries.ts` スコープの組み立て、組織を作る、メンバー一覧、役割、外す、組織名
- `invitations.ts` 招待の発行、一覧、取り消し、確認、受諾
- `signup.ts` 組織登録。確認リンクの発行、下見、完了
- `slug.ts` slug の形式と予約語。`scripts/create-organization.ts` からも呼ぶ
- `scope.ts` ページとスコープの橋渡し
- `actions.ts` Server Actions。slug からスコープを組み立て直す
- `mail.ts` 招待メールの文面
- `OrgShell.tsx` 組織の中の画面に共通する枠
- `InviteForm.tsx` / `MemberActions.tsx` / `SettingsForm.tsx` / `JoinForm.tsx` フォーム
- `SignupStartForm.tsx` / `CreateOrgForm.tsx` 組織を作る欄

組織は画面（`/signup`）から作れる。作った人が最初の組織管理者になる。
`pnpm org:create` も残してあるが、あちらはメールを出せない環境のための道である
（[組織の作り方](../../../docs/features/organization/index.html#make)）。

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- **`scope.isOrgAdmin` は画面の出し分けにだけ使う。**
  書き込みの可否と、返す情報の絞り込みは `orgAdminExists()` を使って SQL の中で確かめる
  （[規約](../../../docs/devops/coding-conventions/index.html#trust)）
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- 役割を変える、メンバーを外すときは、先に管理者の行を `FOR UPDATE` で掴む。
  掴まないと、最後の組織管理者が二人がかりで消える
- 組織を作る道は `createOrganization()` ひとつ。画面も CLI もここを通す。
  slug の検証を分けて持つと、片方にだけ予約語が増えた日から `admin` が通る
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
