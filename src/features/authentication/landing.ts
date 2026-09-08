/* ==========================================================================
   マジックリンクから戻る先

   Next も next/headers も読み込まない。
   読み込むと、リクエストの外から試せなくなる（cookie.ts と同じ理由）。
   ========================================================================== */

/**
 * 入口へ戻す返事を作る。行き先は必ず相対で書く。
 *
 * NextRequest の nextUrl は Host ヘッダを見ない。
 * サーバが束ねているホスト名を返す。本番は HOSTNAME=0.0.0.0 で起動するため、
 * そこから絶対URLを組むとブラウザが 0.0.0.0 へ飛ばされ、接続を拒まれる。
 * X-Forwarded-Proto は効くのに、ホストは効かない（2026-09-08 に本番で踏んだ）。
 *
 * 相対の Location は RFC 7231 が認めている。
 * ブラウザはいま見ているオリジンに対して解決するので、
 * nginx-proxy の後ろでも、手元の 3000 番でも同じに動く。
 *
 * env.APP_ORIGIN から組む手もあるが、それだと別のホスト名で開いた人まで
 * 本番へ送ることになる。着いた場所へ戻すのが、この経路の望みである。
 */
export function backHome(reason?: string): Response {
  const query = reason ? `?magic=${encodeURIComponent(reason)}` : '';
  return new Response(null, { status: 307, headers: { Location: `/${query}` } });
}
