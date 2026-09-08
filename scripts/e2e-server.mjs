/**
 * ブラウザ試験のためにサーバーを起こす。
 *
 * standalone の出力は server.js と依存だけである。
 * CSS と JS は .next/static に別で残り、本番では Dockerfile が写している。
 * 写す前に起こすと、画面は出るのに CSS だけが 404 になる。
 * 見た目を確かめる試験が、そこで意味を失う。
 *
 * 起動の順に頼らないよう、写してから起こすところまでを一つにまとめてある。
 */
import { cp, stat } from 'node:fs/promises';

const SERVER = '.next/standalone/server.js';

try {
  await stat(SERVER);
} catch {
  console.error('先に pnpm build を実行してください（.next/standalone がありません）');
  process.exit(1);
}

await cp('.next/static', '.next/standalone/.next/static', { recursive: true });

// 本番と同じ形で起こす。HOSTNAME も揃えてある（playwright.config.ts が渡す）
await import(`../${SERVER}`);
