import pg from 'pg';

/*
 * テストは実データベースに対して行う。
 * CHECK 制約や複合外部キーが本当に効くかは、実物でしか確かめられない。
 *
 * 各テストはトランザクションの中で実行し、最後に必ず巻き戻す。
 * 後片付けを書かなくて済み、テストどうしが干渉しない。
 */

pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL が設定されていません');
}

export async function withRollback(fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: url, options: '-c timezone=UTC' });
  await client.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

/** 実行が制約違反で失敗することを確かめる。通ってしまったら失敗にする。 */
export async function rejects(
  client: pg.Client,
  run: () => Promise<unknown>,
  message: string,
): Promise<void> {
  await client.query('SAVEPOINT sp');
  try {
    await run();
    await client.query('RELEASE SAVEPOINT sp');
    throw new Error(`拒否されるはずが通った: ${message}`);
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp');
    if (err instanceof Error && err.message.startsWith('拒否されるはずが通った')) {
      throw err;
    }
  }
}

/* --------------------------------------------------------------------------
   下ごしらえ
   -------------------------------------------------------------------------- */

export type Fixture = Awaited<ReturnType<typeof seed>>;

export async function seed(client: pg.Client) {
  const org = await value(
    client,
    'INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id',
    ['株式会社アクメ', 'acme-test'],
  );
  const asuka = await value(
    client,
    'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
    ['asuka@example.com', '佐藤 明日香'],
  );
  const ryo = await value(
    client,
    'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
    ['ryo@example.com', '田中 亮'],
  );
  const web = await value(
    client,
    'INSERT INTO projects (organization_id, key, name, created_by_user_id) VALUES ($1,$2,$3,$4) RETURNING id',
    [org, 'WEB', '検索基盤の刷新', asuka],
  );
  const bill = await value(
    client,
    "INSERT INTO projects (organization_id, key, name, created_by_user_id, visibility) VALUES ($1,$2,$3,$4,'private') RETURNING id",
    [org, 'BILL', '請求まわり', asuka],
  );
  return { org, asuka, ryo, web, bill };
}

/** スレッドを一件作る。番号は組織の採番を通す。 */
export async function newThread(
  client: pg.Client,
  f: Fixture,
  projectId: string,
  type: 'kadai' | 'giron' | 'shitsumon',
  title: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; number: number }> {
  const number = await value<number>(
    client,
    `UPDATE organizations SET next_thread_number = next_thread_number + 1
      WHERE id = $1 RETURNING next_thread_number - 1`,
    [f.org],
  );
  const cols = [
    'organization_id',
    'project_id',
    'number',
    'type',
    'title',
    'created_by_user_id',
    ...Object.keys(extra),
  ];
  const vals = [f.org, projectId, number, type, title, f.asuka, ...Object.values(extra)];
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO threads (${cols.join(',')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    vals,
  );
  const row = rows[0];
  if (!row) {
    throw new Error('スレッドを作れませんでした');
  }
  return { id: row.id, number: Number(number) };
}

async function value<T = string>(
  client: pg.Client,
  sql: string,
  params: unknown[],
): Promise<T> {
  const { rows } = await client.query(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error(`行が返りませんでした: ${sql}`);
  }
  return Object.values(row)[0] as T;
}
