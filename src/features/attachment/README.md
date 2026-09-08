# 添付ファイル

形式を検査しない。守るのは配信の仕方である。
インライン表示するのは、サーバー側で再エンコードした画像だけ。

仕様は [docs/features/attachment/index.html](../../../docs/features/attachment/index.html) にある。
先にそちらを読むこと。決めた理由まで書いてある。

## ここに置くもの

| ファイル | 役割 |
| --- | --- |
| `limits.ts` | 寸法の定数。画面の側からも読むので、`pg` を引き込まない |
| `incoming.ts` | フォームから届いたファイルの受け取りと、名前の始末 |
| `image.ts` | `sharp` での再エンコード。読めなければ `null` を返す |
| `storage.ts` | 実体の置き場。パスを組み立てるのはここだけ |
| `store.ts` | 作り直し（取引の外）と、行と実体の書き込み（取引の中） |
| `queries.ts` | 読み書きと、消す判定 |
| `actions.ts` | 画面から呼ぶ入口 |

配信の Route Handler は `src/app/o/[slug]/a/[id]/route.ts` にある。
**ヘッダを付ける経路は一本だけにする。**

## 決まりごと

- データにさわる関数は、組織のスコープ（`OrgScope`）を第一引数に取る
- 閲覧できるプロジェクトの判定は `#lib/db.ts` の `VISIBLE_PROJECT_IDS` を使う。ここに書き写さない
- import には必ず拡張子を書く（[規約](../../../docs/devops/coding-conventions/index.html#imports)）
- `store.ts` には判定を置かない。`#features/comment/queries.ts` から呼ぶための分割である
  （[模組の循環](../../../docs/devops/coding-conventions/index.html#module-cycle)）

## 触るときに気をつけること

- **再エンコードを取引の中へ戻さない。** 10MB の画像を読み直すあいだ、行を押さえたままになる
- **`created_at` の `clock_timestamp()` を消さない。** 既定の `now()` は取引の開始時刻を返すので、
  一度の送信で入れた行が全部同じ時刻になり、並びがランダムな `id` で決まる
- **実体を消すのはコミットの後である。** 先に消すと、コミットに失敗したときに
  「生きている行の実体が無い」状態が残る
- **`declared_type` を配信に使わない。** 送り手が自由に決められる値である
