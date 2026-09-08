'use client';

import { useState } from 'react';

/* ==========================================================================
   サーバから来た値を持つ入力欄

   フォームに action を渡すと、React はその action が終わったあとに
   フォームを自動で戻す。戻し先は組み立てたときの既定値である。

   新しく書く画面ではこれでよい。投稿し終えた欄は空に戻ってほしい。
   困るのは、すでにある値を書き換える画面のほうである。
   保存はできているのに、欄だけが変える前の値へ戻る。

   実際にそうなった。スレッドの担当者を変えると、保存はされるのに
   選択欄が元へ戻り、読み込み直すまで気づけなかった（2026-09-08 に本番で踏んだ）。
   ========================================================================== */

export type FieldState = { error?: string; notice?: string };

/**
 * 入力欄の値を画面の側で持つ。種はサーバから来た値である。
 *
 * サーバ側の値が動いたら、そちらに合わせ直す。
 * 自分が保存したときも、他の人が変えたものを引き直したときも、同じ道を通る。
 *
 * 返す三つめは「見えている値が、保存されている値と揃っているか」である。
 * 保存できたことを知らせてよいかの判断に使う。
 */
export function useField<T>(fromServer: T): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState(fromServer);
  const [seen, setSeen] = useState(fromServer);

  // 描いている途中で合わせ直す。useEffect にすると、
  // 古い値で一度描いてから直すことになり、値が飛ぶのが見える
  if (seen !== fromServer) {
    setSeen(fromServer);
    setValue(fromServer);
  }

  return [value, setValue, value === fromServer];
}

/**
 * 保存の結果を知らせる。
 *
 * 「保存しました」を出すのは、見えている値が保存済みの値と揃っているあいだだけである。
 * 続けて欄をいじれば消える。知らせが出たまま中身が違う、という状態を作らない。
 */
export function Told({ state, settled }: { state: FieldState; settled: boolean }) {
  if (state.error) {
    return <span className="err">{state.error}</span>;
  }
  if (state.notice && settled) {
    return <span className="ok">{state.notice}</span>;
  }
  return null;
}
