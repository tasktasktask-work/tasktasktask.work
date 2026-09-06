# 認証

マジックリンクとパスワードを併用する。同じアカウントがどちらでも入れるため、パスワード再設定の画面を別に作らずに済む。
アカウントロックの解除経路も兼ねている。

仕様は [docs/features/authentication/index.html](../../../docs/features/authentication/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- `password.ts` ハッシュと照合
- `token.ts` URL に入れる値の生成とハッシュ
- `session.ts` セッションの記録と引き当て（データベースだけ）
- `cookie.ts` `next/headers` との橋渡し（**ここだけ**。読み込むとテストできなくなる）
- `queries.ts` ユーザーの取得、失敗回数、ロック
- `magic-link.ts` リンクの発行と使用
- `return-to.ts` ログイン後の戻り先の検証
- `mail.ts` 認証メールの文面
- `actions.ts` Server Actions
- `LoginScreen.tsx` / `LoginForm.tsx` 未認証のときにどのURLでも出る画面

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
