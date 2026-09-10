import { defineConfig, devices } from '@playwright/test';

/* ==========================================================================
   ブラウザで押して確かめる

   ここにあるのは、ブラウザの中でしか起きないことだけである。
   判定の網は tests/*.test.ts が持っている。両方を同じ場所で見ない。

   分けているのは、この試験が遅くて、壊れやすいためである。
   全画面を押して回る形にすると、落ちても誰も直さなくなる。

   接続先は E2E_BASE_URL で差し替えられる。
   与えたときは、自分でサーバーを起こさない。
   データベースに手が届かないので、下ごしらえの要る試験は外れる。
   ========================================================================== */

const PORT = 3400;
const local = `http://127.0.0.1:${PORT}`;
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  /*
   * 一本ずつ走らせる。
   * 同じデータベースへ種を蒔くので、並べると互いの後片付けに当たる。
   */
  workers: 1,
  fullyParallel: false,

  timeout: 30_000,
  expect: { timeout: 8_000 },

  // 落ちた回を握りつぶさない。揺れているなら、揺れているままにする
  retries: 0,
  forbidOnly: true,

  reporter: [['list']],

  use: {
    baseURL: external ?? local,
    // 通ったときは何も残さない。読むのは落ちたときだけである
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  ...(external
    ? {}
    : {
        webServer: {
          /*
           * 本番と同じ standalone の出力を起こす。HOSTNAME も本番に揃える。
           * 静的な資材を写してから起こすところまでを、この一本に閉じてある。
           */
          command: 'node scripts/e2e-server.mjs',
          url: `${local}/login`,
          /*
           * 課金は偽物で動かす。Stripe へは出ていかない。
           * 凍結された組織で投稿欄が消えていることは、描画しないと確かめられない。
           *
           * APP_ORIGIN もここへ向ける。決済から戻る先は絶対 URL で組み立てるので、
           * .env の値のままだと、この試験用サーバーの外へ出ていく。
           */
          env: {
            PORT: String(PORT),
            HOSTNAME: '0.0.0.0',
            BILLING_MODE: 'fake',
            APP_ORIGIN: local,
          },
          reuseExistingServer: false,
          timeout: 60_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      }),
});
