import type { NextConfig } from 'next';

const config: NextConfig = {
  // Docker で配るため、依存を同梱した最小の出力にする
  output: 'standalone',

  typedRoutes: true,

  experimental: {
    serverActions: {
      /*
       * 既定は 1MB。添付は1ファイル 10MB、一度の送信で合計 30MB まで許す。
       * ここを上げないと、大きいファイルだけが本文ごと届かない。
       *
       * 本体は丸ごとメモリに載る。この値がそのまま
       * 同時アップロード1件あたりの消費になる。
       * nginx 側の上限（deploy/compose.yaml の CLIENT_MAX_BODY_SIZE）も
       * 揃えて上げないと、本番でだけ 413 になる。
       */
      bodySizeLimit: '32mb',
    },
  },

  // 添付ファイルは Route Handler が自前のヘッダで返す。
  // ここで指定するのは、ページ全体に効く共通のヘッダだけ。
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
