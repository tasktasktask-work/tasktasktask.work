import { type NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '#features/authentication/cookie.ts';
import { consumeMagicLink } from '#features/authentication/magic-link.ts';

/*
 * メールで送ったリンクの着地点。
 *
 * 失敗の理由は問い合わせに載せて返す。文言はログイン画面が作る。
 * ここで文言を組み立てると、認証の見せ方が二か所に散る。
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  // 使えなかったときの戻り先。着いた先の画面がログイン画面を出す。
  const home = new URL('/', request.nextUrl.origin);

  if (!token) {
    home.searchParams.set('magic', 'invalid');
    return NextResponse.redirect(home);
  }

  const result = await consumeMagicLink(token, {
    userAgent: request.headers.get('user-agent') ?? undefined,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });

  if (!result.ok) {
    home.searchParams.set('magic', result.reason);
    return NextResponse.redirect(home);
  }

  await setSessionCookie(result.session);
  return NextResponse.redirect(new URL('/', request.nextUrl.origin));
}
