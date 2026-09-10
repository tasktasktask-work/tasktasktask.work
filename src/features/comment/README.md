# コメント

スレッドに時系列で連なる発言。枝分かれしない。
一度投稿したら編集も削除もできない。

仕様は [docs/features/comment/index.html](../../../docs/features/comment/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- `queries.ts` 投稿、一覧、チェックの付け外し、削除、指名の候補
- `actions.ts` 画面から呼ばれる操作
- `Markdown.tsx` 本文とコメントの描画。スレッドの本文もここを通る
- `CommentList.tsx` コメントの列。下ごしらえもここで行う
- `CommentForm.tsx` 投稿欄と、`@` の候補

走査そのもの（コードの範囲、チェックボックスの位置、指名の切り出し）は
`#lib/markdown.ts` にある。データベースを触らないので、そちらに置いてある。

## 直せないことが、この形を決めている

本文を書き換える関数が無い。だから `comments` に `updated_at` も無い。
そこから二つが従う。

- **チェックボックスの状態を本文に書けない。** `comment_checks` に番号で持つ
- **指名を表示のたびに解決し直せない。** `comment_mentions` に位置で持つ

どちらも「本文が動かない」ことに乗っている。
`comments` に更新の経路を足すと、この二枚が同時に壊れる。

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- 書き込みの条件は `#features/thread/queries.ts` の `threadWritable()` を使う。
  コメントもチェックも、スレッドと同じ条件で止まる
- 画面に出す前に必ず `prepare` を通す。
  通さないと、利用者が書いた `<mention>` がこちらのものと区別できなくなる
- `listMentionCandidates` は `VISIBLE_PROJECT_IDS` を逆から引いたものである。
  二つが食い違わないことを `tests/comment.test.ts` が確かめている
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
