/**
 * atlas を .env を読み込んだうえで実行する。
 *
 * atlas.hcl は getenv("DATABASE_URL") で接続先を受け取る。
 * atlas は別プロセスなので、シェルに環境変数が入っていないと
 * 空文字が渡り「missing driver」で落ちる。
 * ここで .env を読んでから渡す。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const args = process.argv.slice(2);

/*
 * 作業用データベースが要るのは差分を計算するときだけである。
 * apply や status は接続先ひとつで足りるので、CI で余分な準備をさせない。
 */
const needsDevDatabase = args.includes('diff');

const required = ['DATABASE_URL', ...(needsDevDatabase ? ['ATLAS_DEV_URL'] : [])];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`環境変数が足りません: ${missing.join(', ')}`);
  console.error('.env.example を .env に写して、接続先を書いてください。');
  process.exit(1);
}

/*
 * Atlas は作業用データベースの中身を、実行のたびに作り直す。
 * DATABASE_URL と同じものを指していると、そこにあるデータが消える。
 * 気づけるのは消えたあとなので、ここで止める。
 */
if (process.env.ATLAS_DEV_URL === process.env.DATABASE_URL) {
  console.error('ATLAS_DEV_URL が DATABASE_URL と同じものを指しています。');
  console.error(
    'Atlas は作業用データベースの中身を作り直すため、このまま実行するとデータが消えます。',
  );
  process.exit(1);
}

const result = spawnSync('atlas', args, {
  stdio: 'inherit',
  env: process.env,
});

if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
  console.error('atlas が見つかりません。次のように入れてください。');
  console.error('');
  console.error('  ARCH=$(uname -m | sed "s/x86_64/amd64/;s/aarch64/arm64/")');
  console.error(
    '  curl -fsSL -o atlas "https://release.ariga.io/atlas/atlas-linux-$ARCH-$(cat .atlas-version)"',
  );
  console.error('  chmod +x atlas && sudo mv atlas /usr/local/bin/');
  process.exit(1);
}

process.exit(result.status ?? 1);
