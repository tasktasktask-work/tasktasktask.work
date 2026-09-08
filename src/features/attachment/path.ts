import type { Route } from 'next';

/**
 * 添付を返す経路。
 *
 * 返す経路はこの一本だけである。ここを通るものだけが、
 * ダウンロードを強いるヘッダと、種別を推測させないヘッダを受け取る。
 * インライン表示に切り替える問い合わせは持たない。
 * 切り替えられる形にすると、切り替えた側でヘッダが外れる。
 *
 * 判定に slug は使わない（セッションと VISIBLE_PROJECT_IDS で決まる）。
 * それでも組織の下に置くのは、既存の画面がすべてそこにあるためと、
 * 後から配信の前段で組織ごとに切り分けられるようにするためである。
 */
export function attachmentPath(slug: string, attachmentId: string): Route {
  return `/o/${slug}/a/${attachmentId}` as Route;
}
