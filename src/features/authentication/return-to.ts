/*
 * ログイン後の戻り先。
 *
 * ログイン画面はどのURLにも現れるので、認証が済んだらそこへ戻す。
 * 戻り先はフォームの hidden 項目で運ばれる。つまり利用者が書き換えられる。
 *
 * 素通しすると、細工したリンクを踏んだ人を、
 * ログイン直後によそのサイトへ送り込める（オープンリダイレクト）。
 * 自分のサイトの中を指していることを、ここで確かめる。
 */

export const DEFAULT_RETURN_TO = '/';

/**
 * ヘッダを分割されないよう、制御文字を弾く。
 *
 * 制御文字を正規表現に書くこと自体を Biome は疑うが、
 * ここでは弾くのが目的なので、そのまま書く必要がある。
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を拒否するための表現である
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_RETURN_TO;
  }

  const path = value.trim();

  // 自分のサイトの絶対パスであること
  if (!path.startsWith('/')) {
    return DEFAULT_RETURN_TO;
  }

  // //evil.com はプロトコル相対で外部を指す。
  // /\evil.com もブラウザによっては同じに扱われる。
  if (path.startsWith('//') || path.startsWith('/\\')) {
    return DEFAULT_RETURN_TO;
  }

  if (CONTROL_CHARS.test(path)) {
    return DEFAULT_RETURN_TO;
  }

  // 認証の途中経過へ戻しても意味がない
  if (path.startsWith('/auth/')) {
    return DEFAULT_RETURN_TO;
  }

  return path;
}
