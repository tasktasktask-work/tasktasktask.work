# 担当スレッド一覧

プロジェクトをまたいで、自分が担当のものだけを集める。
通知の一覧も同じ画面に置き、タブで切り替える。

仕様は [docs/features/dashboard/index.html](../../../docs/features/dashboard/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- 担当スレッドの取得（プロジェクト横断）

通知の一覧そのものは [`#features/notification`](../notification/README.md) にある。
画面（`src/app/o/[slug]/dashboard/page.tsx`）が両方を呼ぶ。

## プロジェクトの壁を越える唯一の場所

他の一覧はどれもプロジェクトを指定して引く。ここだけが指定せずに引く。
**越えたぶん、閲覧の判定を自分でかけなければならない。**

担当者に設定できる条件は組織のメンバーであることだけで、
プロジェクトのメンバーであることは要らない。
見えないプロジェクトのスレッドの担当者になりうる。

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- 日付の計算は組織のタイムゾーン（`scope.timezone`）で行う。期間は日付だけを持つ
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
