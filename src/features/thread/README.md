# スレッド

このプロダクトの基本単位。課題、議論、質問はその種別である。
種別によって使える列が変わるため、制約が `threads` に集中している。

仕様は [docs/features/thread/index.html](../../../docs/features/thread/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- `queries.ts` 読み書き。データにさわる関数の書き方の見本でもある
- `actions.ts` 画面から呼ばれる操作。slug とキーと番号だけを受け取る
- `path.ts` 画面への行き先と、`WEB-3` の読み書き
- `ThreadRows.tsx` 一覧の行。詳細の子スレッド欄でも同じものを使う
- `ThreadFilters.tsx` 絞り込みの帯。JavaScript を使わない GET のフォーム
- `NewThreadForm.tsx` / `ThreadProps.tsx` / `ThreadEditForms.tsx` 入力の欄

## 誰が書けるか

**見えている人は書ける。** 立てる、直す、進捗率と担当者と期間と親を変える、畳む。
どれもそのプロジェクトを閲覧できる人なら行える。

例外は削除だけで、組織管理者が、畳んだあとにだけ行える。

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- 書き込みの条件は `WRITABLE` にまとめてある。スレッドとプロジェクトの
  **両方**のアーカイブを見る。片方だけだと、畳んだプロジェクトの中身が書き換わる
- 親の付け替えは輪を作りうる。`setParent` の中で祖先を辿って断る。
  辿るところと書くところは同じトランザクションに入れる
- 時刻の表示は `#lib/datetime.ts` を通し、組織のタイムゾーンを渡す
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
