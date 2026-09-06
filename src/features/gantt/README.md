# ガントチャート

プロジェクト一枚ぶん。日単位。階層表示。読み取り専用。
期間未設定の課題を隠さないことが、この画面の要である。

仕様は [docs/features/gantt/index.html](../../../docs/features/gantt/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- 期間を持つ課題の取得と、期間未設定の課題の取得
- はみ出し警告の判定
- 描画コンポーネント

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
