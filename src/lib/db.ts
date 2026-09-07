import pg from 'pg';
import { lazy } from './lazy.ts';

/* ==========================================================================
   接続と型変換
   docs/devops/coding-conventions/index.html#datetime を参照。
   ========================================================================== */

/**
 * date は Date に変換せず 'YYYY-MM-DD' の文字列のまま扱う。
 *
 * pg の既定では、date 列は「Node プロセスのローカル時刻の午前0時」の Date になる。
 * JST で動いていれば 2026-09-08 は UTC の 2026-09-07T15:00Z を指し、
 * toISOString() で日付が1日戻る。
 *
 * タイムゾーンの事故を避けるために課題の期間を date にしたのに、
 * ドライバの既定動作がそれを引き戻す。ここで止める。
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/**
 * timestamp（タイムゾーンなし）は使わない方針である。
 * 基準点を持たないため、異なる地域から書かれた行を比較できない。
 *
 * 既定の変換は「Node プロセスのローカル時刻として解釈する」であり、
 * 黙って動いたうえで値がずれる。混入したら気づけるよう、ここで落とす。
 */
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (value) => {
  throw new Error(
    `timestamp 型の列が使われています。timestamptz か date にしてください: ${value}`,
  );
});

/*
 * int8（bigint）は pg の既定どおり文字列で受け取る。
 * Number に変換する型パーサは入れない。
 * 現在 bigint を使っているのは attachments.byte_size だけで安全な範囲に収まるが、
 * 将来 bigserial の主キーが増えたときに、この変換が静かに精度を落とすため。
 * 数値として扱いたい場所では、呼び出し側で Number() を通す。
 */

function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL が設定されていません');
  }

  const created = new pg.Pool({
    connectionString,

    /*
     * セッションの TimeZone を UTC に固定する。
     *
     * timestamptz の入出力はセッションの設定で変換される。
     * ひとつのプールが複数の組織のリクエストを捌くため、
     * リクエストごとに SET TIME ZONE を撃つと、返却された接続に設定が残って
     * 次のリクエストへ漏れる。
     *
     * 表示のための変換は organizations.timezone を引数として渡し、
     * SQL の中で AT TIME ZONE $n を使って行う。
     */
    options: '-c timezone=UTC',

    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  created.on('error', (err) => {
    console.error('[db] アイドル接続でエラーが発生しました', err);
  });

  return created;
}

/*
 * 最初に触られるまでプールを作らない。
 * 読み込み時に作ると、next build がページの情報を集めるときにも
 * 接続先を要求することになる。
 */
export const pool = lazy(createPool);

/* ==========================================================================
   組織のスコープ

   マルチテナントで最も起きてはならないのは、他社のデータが混ざることである。
   WHERE organization_id = $1 を書き忘れると、それが起きる。

   データベースへのアクセスは必ずこのスコープを第一引数に取る関数を通し、
   ページや API のハンドラから pool.query を直接呼ばない。
   ========================================================================== */

export type OrgScope = {
  readonly organizationId: string;
  readonly userId: string;
  /** 組織管理者かどうか。非公開プロジェクトの閲覧判定に使う。 */
  readonly isOrgAdmin: boolean;
  /** 表示のためのタイムゾーン。organizations.timezone の値。 */
  readonly timezone: string;
};

/**
 * 閲覧できるプロジェクトの id を返す副問い合わせ。
 *
 * 組織の所属、公開設定、プロジェクトメンバー、組織管理者。
 * 四つを見る必要がある。
 * この論理を各所に散らすと必ずどこかで漏れるため、ここにだけ書く。
 *
 * 振る舞いは tests/permission.test.ts で固定してある。
 *
 * $1 = organization_id, $2 = user_id
 */
export const VISIBLE_PROJECT_IDS = `
  SELECT p.id
    FROM projects p
   WHERE p.organization_id = $1
     AND p.deleted_at IS NULL
     /*
      * 組織が境界である。所属が切れていれば、何も見えない。
      *
      * この条件を下の枝の中に入れてはいけない。
      * 入れると、組織から外れた人の project_members が残っているだけで
      * 非公開プロジェクトが見えてしまう。
      * 外すときに両方を消す、という規律に頼らずに済ませる。
      */
     AND EXISTS (
        SELECT 1 FROM organization_members om
         WHERE om.organization_id = p.organization_id
           AND om.user_id = $2
           AND om.deleted_at IS NULL)
     AND (
       p.visibility = 'public'
       OR EXISTS (
          SELECT 1 FROM project_members pm
           WHERE pm.project_id = p.id
             AND pm.user_id = $2
             AND pm.deleted_at IS NULL)
       OR EXISTS (
          SELECT 1 FROM organization_members om
           WHERE om.organization_id = p.organization_id
             AND om.user_id = $2
             AND om.role = 'admin'
             AND om.deleted_at IS NULL)
     )`;

/* ==========================================================================
   スレッド番号の採番

   組織の中で通し番号にするため、行ロックを取って加算する。
   Postgres のシーケンスは組織ごとに動的に作りにくく、
   失敗のたびに欠番が出る。番号が飛ぶ理由を
   「別プロジェクトが使った」だけに限りたいので、この方式を採る。
   ========================================================================== */

export async function nextThreadNumber(
  client: pg.PoolClient,
  organizationId: string,
): Promise<number> {
  const { rows } = await client.query<{ number: string }>(
    `UPDATE organizations
        SET next_thread_number = next_thread_number + 1
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING next_thread_number - 1 AS number`,
    [organizationId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`組織が見つかりません: ${organizationId}`);
  }
  return Number(row.number);
}

/** トランザクションの中で処理を実行する。 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
