# プロジェクト

スレッドを入れる箱。閲覧範囲、ガントの範囲、メンションの候補、親子関係の範囲。
このシステムのいくつもの境界が、この一行に紐づいている。

仕様は [docs/features/project/index.html](../../../docs/features/project/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- `queries.ts` 一覧、一件、作成、設定、アーカイブと削除、メンバー
- `actions.ts` Server Actions。slug とキーからスコープとプロジェクトを引き直す
- `path.ts` プロジェクトの画面への URL。ここ以外で組み立てない
- `ProjectTabs.tsx` プロジェクトの中の行き先
- `NewProjectForm.tsx` / `ProjectSettingsForm.tsx` / `ProjectMemberActions.tsx` フォーム

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- **`scope.isOrgAdmin` は画面の出し分けにだけ使う。**
  書き込みの可否は `orgAdminExists()` と `projectAdminExists()` を使って SQL の中で確かめる
  （[規約](../../../docs/devops/coding-conventions/index.html#trust)）
- **フォームからプロジェクトの id を受け取らない。**
  slug とキーだけを受け取り、`resolveProject()` で引き直す
  （[規約](../../../docs/devops/coding-conventions/index.html#form-ids)）
- 誰が何を変えられるか
  - 作成、削除 … 組織管理者だけ
  - 名前、説明文、公開設定、アーカイブ、メンバーの追加と削除 … 組織管理者かプロジェクト管理者
  - 判定は `projectAdminExists()`。`resolveProject()` が返す `canManage` は画面の出し分け用
- 最後のプロジェクト管理者を守る仕掛けは要らない。
  組織管理者が行を持たなくても管理者として扱われるので、外側に受け皿がある
- URL は `path.ts` の関数で組み立てる。文字列を画面に書かない
  （[規約](../../../docs/devops/coding-conventions/index.html#typed-routes)）
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
