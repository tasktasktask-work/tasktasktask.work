/**
 * db/functions.sql を適用する。
 *
 * 関数とトリガは Atlas の管理下に置いていない（無料の範囲では扱えない）。
 * マイグレーションを適用したあとに、これを流す。
 * 何度流しても同じ結果になるように書いてある。
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL が設定されていません');
  process.exit(1);
}

const sql = readFileSync('db/functions.sql', 'utf8');
const client = new pg.Client({ connectionString: url });

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');

  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal`,
  );
  console.log(`db/functions.sql を適用しました（トリガ ${rows[0].n} 個）`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
