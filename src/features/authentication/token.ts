import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * URL に埋め込むトークン。
 *
 * データベースには生の値を保存しない。
 * 中身が漏れたとき、保存されているのがハッシュであれば
 * そこからログインすることはできない。
 */

/** URL に入れる値を作る。返すのは「生の値」と「保存するハッシュ」の組。 */
export function issueToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** 長さの違いで内容を推測されないよう、時間の一定な比較を使う。 */
export function tokensMatch(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** マジックリンクと招待の有効期間。どちらも48時間で揃えてある。 */
export const TOKEN_LIFETIME_HOURS = 48;

export function expiresAt(hours: number = TOKEN_LIFETIME_HOURS): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
