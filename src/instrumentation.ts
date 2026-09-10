/*
 * サーバが立ち上がるときに一度だけ呼ばれる。
 *
 * 通知メールと課金の巡回をここから始める。
 * デプロイ構成に常駐プロセスも定期実行も無く、
 * 足すとイメージの配り方から見直すことになる。
 * アプリと同じプロセスで回せば、置き場を増やさずに済む。
 *
 * 動くコンテナは一つである（deploy/compose.yaml）。
 * 増やすときは、掴み方を見直す必要がある
 * （docs/features/notification/index.html の「巡回」を参照）。
 */
export async function register(): Promise<void> {
  // Edge ランタイムでも呼ばれる。データベースへは Node からしか届かない
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { startNotificationMailLoop } = await import('#features/notification/mailer.ts');
  startNotificationMailLoop();

  /*
   * 課金の巡回。前月ぶんの請求と、おためし終了の知らせ。
   * 通知メールとは別の間隔で回すので、ループを分けてある。
   * 置き場は同じで、BILLING_MODE=off のときは始まらない。
   */
  const { startBillingLoop } = await import('#features/billing/monthly.ts');
  startBillingLoop();
}
