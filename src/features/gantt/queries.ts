import { z } from 'zod';
import { type OrgScope, pool, VISIBLE_PROJECT_IDS } from '#lib/db.ts';
import { dateColumn, many, oneOrThrow } from '#lib/row.ts';
import { type GanttThread, ROW_LIMIT, UNDATED_LIMIT } from './layout.ts';

/* ==========================================================================
   ガントのための取得

   引くのは課題だけである。議論と質問は期間を持たないので時間軸に置けず、
   行としても出さない（docs/features/gantt/index.html）。

   一枚に描く数は上限を持つ。ただし切るのは期間を持つ課題の側だけで、
   その祖先は順位に関わらず引く。親だけが落ちると、子のインデントの
   根拠が消えて宙に浮く。
   ========================================================================== */

const ganttThread = z.object({
  id: z.uuid(),
  number: z.number().int(),
  title: z.string(),
  progress: z.number().int().min(0).max(100),
  startsOn: dateColumn.nullable(),
  endsOn: dateColumn.nullable(),
  assigneeName: z.string().nullable(),
  archived: z.boolean(),
  parentId: z.uuid().nullable(),
  parentNumber: z.number().int().nullable(),
});

const undatedRow = z.object({
  id: z.uuid(),
  number: z.number().int(),
  title: z.string(),
  assigneeName: z.string().nullable(),
});

export type UndatedRow = z.infer<typeof undatedRow>;

const counts = z.object({
  /** 畳まれていない課題の数。終わったものも含む。 */
  total: z.number().int(),
  /** そのうち期間が入っているもの。 */
  dated: z.number().int(),
  /** 終わっておらず、期間が入っていないもの。別枠に並ぶ数である。 */
  undated: z.number().int(),
});

export type Counts = z.infer<typeof counts>;

export type GanttData = {
  readonly threads: GanttThread[];
  readonly undated: UndatedRow[];
  readonly counts: Counts;
};

/*
 * 種になる課題を選び、そこから親を辿って引き上げる。
 *
 * 上の枝を辿る深さを 50 で切っているのは、万一データが輪になっていたときに
 * この問い合わせが返らなくなるのを避けるためである。
 * 親を付け替えるときの検査（setParent）と同じ値にしてある。
 *
 * 親として辿るのは課題だけである。議論や質問が親のときは辿らないので、
 * その課題は根として並ぶ。行として出せない親の下にぶら下げても、
 * なぜ下がっているのかが読めない。
 */
const TREE = `WITH RECURSIVE seed AS (
       SELECT t.id
         FROM threads t
        WHERE t.organization_id = $1
          AND t.project_id = $3
          AND t.project_id IN (${VISIBLE_PROJECT_IDS})
          -- 期間を持てるのは課題だけなので（threads_period_only_for_kadai）、
          -- 下の starts_on の条件だけでも議論と質問は落ちる。
          -- 種別で絞る意図をここに残しておく
          AND t.type = 'kadai'
          AND t.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND t.starts_on IS NOT NULL
        ORDER BY t.starts_on, t.ends_on, t.number
        LIMIT $4
     ),
     tree AS (
       SELECT t.id, t.parent_thread_id, 1 AS depth
         FROM threads t JOIN seed ON seed.id = t.id
       UNION ALL
       SELECT p.id, p.parent_thread_id, tree.depth + 1
         FROM threads p
         JOIN tree ON p.id = tree.parent_thread_id
        WHERE p.deleted_at IS NULL
          AND p.type = 'kadai'
          AND tree.depth < 50
     )`;

/**
 * 図に出しうる課題を引く。
 *
 * 並べ替えも木への組み直しもここではしない。それは layout.ts の仕事である。
 * 分けてあるので、切ったときの祖先の扱いをデータベース抜きで確かめられる。
 */
export async function listGanttThreads(
  scope: OrgScope,
  projectId: string,
  limit = ROW_LIMIT,
): Promise<GanttThread[]> {
  const result = await pool.query(
    `${TREE}
     SELECT t.id,
            t.number,
            t.title,
            t.progress,
            t.starts_on                 AS "startsOn",
            t.ends_on                   AS "endsOn",
            u.display_name              AS "assigneeName",
            (t.archived_at IS NOT NULL) AS archived,
            kadai.id                    AS "parentId",
            parent.number               AS "parentNumber"
       FROM threads t
       JOIN (SELECT DISTINCT id FROM tree) k ON k.id = t.id
       LEFT JOIN users u ON u.id = t.assignee_user_id
       -- 番号は親の種別を問わず出す。図から外れて見える理由がそれで読める
       LEFT JOIN threads parent
              ON parent.id = t.parent_thread_id AND parent.deleted_at IS NULL
       -- 木としてつなぐのは課題どうしだけ
       LEFT JOIN threads kadai
              ON kadai.id = parent.id AND kadai.type = 'kadai'
      WHERE t.organization_id = $1`,
    [scope.organizationId, scope.userId, projectId, limit],
  );
  return many(ganttThread, result, 'listGanttThreads');
}

/**
 * 期間が入っていない課題。
 *
 * 並ぶのは、終わっておらず、畳まれておらず、期間が入っていないものだけである。
 * 終わった課題をここに出しても、もう計画に載せる先がない。
 * この枠が空なら、動いている課題は全部計画に載っている、と読める。
 */
export async function listUndated(
  scope: OrgScope,
  projectId: string,
  limit = UNDATED_LIMIT,
): Promise<UndatedRow[]> {
  const result = await pool.query(
    `SELECT t.id, t.number, t.title, u.display_name AS "assigneeName"
       FROM threads t
       LEFT JOIN users u ON u.id = t.assignee_user_id
      WHERE t.organization_id = $1
        AND t.project_id = $3
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        AND t.type = 'kadai'
        AND t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND t.progress < 100
        AND t.starts_on IS NULL
      ORDER BY t.number
      LIMIT $4`,
    [scope.organizationId, scope.userId, projectId, limit],
  );
  return many(undatedRow, result, 'listUndated');
}

/**
 * 図の上に出す件数。
 *
 * 分母から畳んだ課題を外してあるのは、図にも別枠にも出ないものを
 * 数えても、その差が何をすれば埋まるのかを指さないためである。
 */
export async function countThreads(scope: OrgScope, projectId: string): Promise<Counts> {
  const result = await pool.query(
    `SELECT count(*)::int                                          AS total,
            count(*) FILTER (WHERE t.starts_on IS NOT NULL)::int   AS dated,
            count(*) FILTER (WHERE t.starts_on IS NULL
                               AND t.progress < 100)::int          AS undated
       FROM threads t
      WHERE t.organization_id = $1
        AND t.project_id = $3
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        AND t.type = 'kadai'
        AND t.deleted_at IS NULL
        AND t.archived_at IS NULL`,
    [scope.organizationId, scope.userId, projectId],
  );
  return oneOrThrow(counts, result, 'countThreads');
}

/** 画面が要るものをまとめて引く。 */
export async function ganttData(scope: OrgScope, projectId: string): Promise<GanttData> {
  const [threads, undated, totals] = await Promise.all([
    listGanttThreads(scope, projectId),
    listUndated(scope, projectId),
    countThreads(scope, projectId),
  ]);
  return { threads, undated, counts: totals };
}
