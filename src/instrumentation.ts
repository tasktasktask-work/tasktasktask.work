/*
 * サーバが立ち上がるときに一度だけ呼ばれる。
 *
 * 通知メールの巡回をここから始める。
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
}
