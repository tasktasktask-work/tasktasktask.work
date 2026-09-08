# アカウント

組織に属さない、その人自身の設定。
いま置いてあるのはメール通知の入り切り一つだけである。

画面は `/me`（`src/app/me/page.tsx`）にある。
仕様は [docs/ui/pages/me/index.html](../../../docs/ui/pages/me/index.html) と
[docs/issues/account-settings/index.html](../../../docs/issues/account-settings/index.html) にある。

## ここに置くもの

- `users` のうち、本人が変える列の読み書き
- その画面のフォーム

表示名、パスワード、メールアドレスの変更は、この場所に足していくことになる。

## 組織のスコープを取らない

**このプロジェクトで `OrgScope` を第一引数に取らない、数少ない場所である。**

`users.email_notifications_enabled` は組織の外側にある値で、
所属しているすべての組織に効く。
「どの組織で切り替えたか」を問えないので、スコープを渡しても嘘の引数になる。

代わりに `userId` を受け取る。誰の設定かは Cookie から引き、フォームには書かせない。
書かせると、他人の通知を止める形が作れる。

画面の URL も揃えてある。`/o/{slug}/...` の下ではなく `/me` である。
組織の下に置くと、その組織だけの設定に見える
（[規約](../../../docs/devops/coding-conventions/index.html#org-scope-exception)）。

## 決まりごと

- 止める手段は、送る仕掛けと同じ回に入れる。
  止められないまま送り始めると、迷惑メールとして報告され、
  送信ドメインの評価が下がり、最後にはマジックリンクが届かなくなる
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
