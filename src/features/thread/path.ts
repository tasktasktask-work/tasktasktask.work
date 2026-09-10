import type { Route } from 'next';

/*
 * スレッドの画面への行き先。
 *
 * typedRoutes は動的な区間がひとつなら文字列のまま検査してくれるが、
 * /o/{slug}/p/{key}/t/{number} のように並ぶと推論が通らない。
 * 型を当て直すぶん綴りの誤りは検査されなくなるので、
 * 組み立てをこの一枚に閉じ込め、画面の側では文字列を書かない。
 */

export function threadPath(
  slug: string,
  key: string,
  number: number,
  options: { commentId?: string } = {},
): Route {
  // 通知からはコメントを名指しで開く。スレッドの先頭に落とすと、
  // コメントが50件あれば、そこから探すことになる。
  const anchor = options.commentId ? `#c-${options.commentId}` : '';
  return `/o/${slug}/p/${key}/t/${number}${anchor}` as Route;
}

/** WEB-128 の形。表示に使う。 */
export function threadLabel(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

/**
 * 親の指し方を読む。`WEB-3` でも `3` でも受ける。
 *
 * 空文字は「親を外す」である。数字にならないものは null ではなく
 * undefined を返し、呼ぶ側が入力の誤りとして扱えるようにする。
 */
export function parseThreadNumber(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  const digits = trimmed.replace(/^[A-Za-z0-9]+-/, '');
  if (!/^\d+$/.test(digits)) {
    return undefined;
  }
  return Number(digits);
}
