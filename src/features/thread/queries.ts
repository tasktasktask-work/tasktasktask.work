import { z } from 'zod';
import { type OrgScope, pool, VISIBLE_PROJECT_IDS } from '#lib/db.ts';
import { dateColumn, many } from '#lib/row.ts';

/* ==========================================================================
   スレッド一覧の取得

   このファイルは、データにさわる関数の書き方の見本でもある。
   守っていることは三つ。

   1. 組織のスコープを第一引数に取る。呼ぶ側が条件を足すかどうかに依存しない
   2. 閲覧できるプロジェクトの判定は VISIBLE_PROJECT_IDS にだけ書く
   3. 一覧は一回のクエリで取る。行ごとにクエリを投げない
   ========================================================================== */

export const threadType = z.enum(['kadai', 'giron', 'shitsumon']);
export type ThreadType = z.infer<typeof threadType>;

const threadRow = z.object({
  id: z.uuid(),
  number: z.number().int(),
  projectKey: z.string(),
  type: threadType,
  title: z.string(),
  progress: z.number().int().min(0).max(100),
  startsOn: dateColumn.nullable(),
  endsOn: dateColumn.nullable(),
  assigneeName: z.string().nullable(),
  parentNumber: z.number().int().nullable(),
  childCount: z.number().int(),
  archived: z.boolean(),
  updatedAt: z.date(),
  tags: z.array(z.object({ name: z.string(), color: z.string() })),
});

export type ThreadRow = z.infer<typeof threadRow>;

export type ThreadFilters = {
  readonly type?: ThreadType;
  readonly assigneeUserId?: string;
  readonly tagId?: string;
  /** 進捗率 100 のものを含めるか。既定では隠す。 */
  readonly includeCompleted?: boolean;
  /** アーカイブ済みを含めるか。既定では隠す。 */
  readonly includeArchived?: boolean;
};

export async function listThreads(
  scope: OrgScope,
  projectId: string,
  filters: ThreadFilters = {},
): Promise<ThreadRow[]> {
  const params: unknown[] = [scope.organizationId, scope.userId, projectId];
  const where: string[] = [
    't.organization_id = $1',
    't.deleted_at IS NULL',
    // 閲覧できるプロジェクトに属していること。この条件を落とすと他人の非公開が漏れる。
    `t.project_id IN (${VISIBLE_PROJECT_IDS})`,
    't.project_id = $3',
  ];

  if (filters.type) {
    params.push(filters.type);
    where.push(`t.type = $${params.length}`);
  }
  if (filters.assigneeUserId) {
    params.push(filters.assigneeUserId);
    where.push(`t.assignee_user_id = $${params.length}`);
  }
  if (filters.tagId) {
    params.push(filters.tagId);
    where.push(
      `EXISTS (SELECT 1 FROM thread_tags tt
                WHERE tt.thread_id = t.id AND tt.tag_id = $${params.length})`,
    );
  }
  if (!filters.includeCompleted) {
    where.push('t.progress < 100');
  }
  if (!filters.includeArchived) {
    // アーカイブ済みでも、活動中の子を持つものは読み取り専用として残す。
    // そうしないと、動いている子が親ごと視界から消える。
    where.push(`(
      t.archived_at IS NULL
      OR EXISTS (SELECT 1 FROM threads c
                  WHERE c.parent_thread_id = t.id
                    AND c.archived_at IS NULL
                    AND c.deleted_at IS NULL)
    )`);
  }

  const result = await pool.query(
    `SELECT t.id,
            t.number,
            p.key                       AS "projectKey",
            t.type,
            t.title,
            t.progress,
            t.starts_on                 AS "startsOn",
            t.ends_on                   AS "endsOn",
            u.display_name              AS "assigneeName",
            parent.number               AS "parentNumber",
            children.count::int         AS "childCount",
            (t.archived_at IS NOT NULL) AS archived,
            t.updated_at                AS "updatedAt",
            COALESCE(tags.list, '[]'::json) AS tags
       FROM threads t
       JOIN projects p        ON p.id = t.project_id
       LEFT JOIN users u      ON u.id = t.assignee_user_id
       LEFT JOIN threads parent ON parent.id = t.parent_thread_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS count
           FROM threads c
          WHERE c.parent_thread_id = t.id AND c.deleted_at IS NULL
       ) children ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('name', g.name, 'color', g.color)
                         ORDER BY g.name) AS list
           FROM thread_tags tt
           JOIN tags g ON g.id = tt.tag_id AND g.deleted_at IS NULL
          WHERE tt.thread_id = t.id
       ) tags ON true
      WHERE ${where.join('\n        AND ')}
      ORDER BY t.updated_at DESC
      LIMIT 200`,
    params,
  );

  return many(threadRow, result, 'listThreads');
}
