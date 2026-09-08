import type { NextRequest } from 'next/server';
import { setSessionCookie } from '#features/authentication/cookie.ts';
import { backHome } from '#features/authentication/landing.ts';
import { consumeMagicLink } from '#features/authentication/magic-link.ts';

/*
 * メールで送ったリンクの着地点。
 *
 * 失敗の理由は問い合わせに載せて返す。文言はログイン画面が作る。
 * ここで文言を組み立てると、認証の見せ方が二か所に散る。
 *
 * 戻り先の組み立ては landing.ts にある。
 * リクエストから絶対URLを組んではいけない理由も、そちらに書いてある。
 */

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return backHome('invalid');
  }

  const result = await consumeMagicLink(token, {
    userAgent: request.headers.get('user-agent') ?? undefined,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });

  if (!result.ok) {
    return backHome(result.reason);
  }

  // Cookie は cookies() 経由で付く。Next が返り値の Response へ混ぜる
  await setSessionCookie(result.session);
  return backHome();
}
