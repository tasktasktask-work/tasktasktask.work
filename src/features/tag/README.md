# タグ

階層と直交する分類の軸。組織の単位で定義し、プロジェクトをまたいで使う。

仕様は [docs/features/tag/index.html](../../../docs/features/tag/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

- タグの作成、名前と色の変更、削除（`queries.ts`）
- 色見本（`colors.ts`）。画面の側でも読むので、`pg` を持ち込まない
- スレッドへの結び付け（`queries.ts` の `attachTagsTo`）
- 属性欄と管理画面（`TagPicker.tsx` / `TagAdmin.tsx`）

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- スレッドへ書けるかどうかは `#features/thread/queries.ts` の `threadWritable()` を使う
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）

## 結び付けを分けてあった話

2026-09-10 まで、行を入れるだけの `attach.ts` を切り出してあった。
スレッドを立てるときにタグも付けられたので `#features/thread/queries.ts` が
タグ側を呼び、一方でこの模組は `threadWritable()` を読む。
互いを参照する形を避けるための分割だった
（[規約](../../../docs/devops/coding-conventions/index.html#module-cycle)）。

立てる欄が種別とタイトルだけになり、スレッド側からの呼び出しが消えたので、
`attachTagsTo` は `queries.ts` の中の非公開の関数へ畳み戻した。
判定を持たないことは変わらない。呼ぶ側が先に `writable()` を済ませている。

子スレッドの作成欄にタグを足すと、同じ輪が戻る。そのときはまた切り出す。

## 消すと結びも消える

`deleteTag` はタグを論理削除し、`thread_tags` の行を物理削除する。
取り消せない。画面の側は二度押しにしてあり、一度目は
何件から外れるかを返すだけである。

結びを残す案もあった。残せば「消したのを取り消す」が作れるが、
同時に「同じ名前で作り直したら半年前のスレッドが一斉にタグ付きで現れる」
という道もできる。消したことを取り消したい人と、
同じ名前で始め直したい人が、同じ操作をすることになる。
