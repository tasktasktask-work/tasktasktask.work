import { notFound } from 'next/navigation';
import { contentTypeFor } from '#features/attachment/image.ts';
import { findDeliverable } from '#features/attachment/queries.ts';
import { read } from '#features/attachment/storage.ts';
import { currentScope } from '#features/organization/scope.ts';

/* ==========================================================================
   添付を返す唯一の経路

   このシステムは添付の形式を検査しない。守っているのはここのヘッダである。
   だから、この経路を増やしてはいけない。

     Content-Disposition: attachment  ブラウザは表示せずダウンロードする
     X-Content-Type-Options: nosniff  中身を見て HTML と解釈する挙動を止める
     Content-Type: octet-stream       申告された種別を反映しない
     CSP: default-src 'none'; sandbox 万一実行されかけても止まる

   例外はサーバー側で作り直した画像だけで、そこだけ inline になる。
   分岐はこのファイルの中の一箇所で、問い合わせでは切り替えられない。

   本体と同じオリジンから返している。守っているのはオリジンの分離ではなく
   これらのヘッダだ、という判断の経緯は docs/features/attachment/ にある。
   ========================================================================== */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
): Promise<Response> {
  const { slug, id } = await params;
  if (!UUID.test(id)) {
    notFound();
  }

  /*
   * 入っていない人にも 404 を返す。ログイン画面へ送らない。
   * 画像として読み込まれる経路なので、送っても人は見ていない。
   */
  const found = await currentScope(slug);
  if (!found.ok) {
    notFound();
  }

  // 組織の外の添付、消された添付、見えないプロジェクトの添付は、
  // ここで区別なく null になる。存在の有無を返し分けない
  const attachment = await findDeliverable(found.scope, id);
  if (!attachment) {
    notFound();
  }

  const bytes = await read(attachment.storageKey);

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': attachment.isImage
        ? contentTypeFor(attachment.storageKey)
        : 'application/octet-stream',
      'Content-Disposition': `${attachment.isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'Content-Length': String(bytes.byteLength),
      /*
       * next.config.ts が全経路に同じものを付けているので、ここは二重である。
       * それでも書いてあるのは、この経路が守っているものを
       * 一枚のファイルの中で読み切れるようにするためである。
       * 片方を消しても壊れないため、テストでは片方の欠落を捕まえられない。
       */
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      /*
       * 画像だけは短いあいだ持たせる。スレッドを開くたびに全部を
       * 取り直すと、三枚貼られているだけで毎回それだけ流れる。
       * 消したときにブラウザへ残る窓は、この長さぶんである。
       */
      'Cache-Control': attachment.isImage
        ? 'private, max-age=600'
        : 'private, max-age=0, no-store',
    },
  });
}
