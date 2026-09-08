import { z } from 'zod';
import { threadType } from '#features/thread/queries.ts';
import { type OrgScope, pool, VISIBLE_PROJECT_IDS } from '#lib/db.ts';
import { dateColumn, many } from '#lib/row.ts';

/* ==========================================================================
   担当スレッドの取得

   プロジェクトをまたいで、自分が担当のものだけを集める。
   スレッド一覧もガントもプロジェクト単位なので、
   五つのプロジェクトに散った担当を見るには五枚の画面を開くことになる。

   絞り込みは一つだけ持つ。完了したものを出すかどうかである。
   畳んだスレッドと、畳んだプロジェクトの中身は、切り替えでも出てこない。
   終わった仕事ではなく、片付いた場所だからである。

   仕様は docs/features/dashboard/index.html にある。
   ========================================================================== */

const assignedRow = z.object({
  id: z.uuid(),
  number: z.number().int(),
  projectKey: z.string(),
  type: threadType,
  title: z.string(),
  progress: z.number().int().min(0).max(100),
  startsOn: dateColumn.nullable(),
  endsOn: dateColumn.nullable(),
  /** 今日から終了日までの日数。過ぎていれば負になる。期間が無ければ null。 */
  daysLeft: z.number().int().nullable(),
  tags: z.array(z.object({ name: z.string(), color: z.string() })),
});

export type AssignedRow = z.infer<typeof assignedRow>;

/**
 * 自分が担当のスレッド。終了日の近い順。
 *
 * 件数は絞らない。ここで打ち切ると、下のほうの担当が
 * 「無い」のと見分けが付かないまま忘れられる。
 *
 * 残り日数は組織のタイムゾーンで数える。
 * 期間は日付だけを持つので、時刻を持ち込むと日付が一日ずれる。
 */
export async function listAssignedThreads(
  scope: OrgScope,
  options: { includeCompleted?: boolean } = {},
): Promise<AssignedRow[]> {
  const result = await pool.query(
    `SELECT t.id,
            t.number,
            p.key        AS "projectKey",
            t.type,
            t.title,
            t.progress,
            t.starts_on  AS "startsOn",
            t.ends_on    AS "endsOn",
            (t.ends_on - (now() AT TIME ZONE $3)::date)::int AS "daysLeft",
            COALESCE(tags.list, '[]'::json) AS tags
       FROM threads t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('name', g.name, 'color', g.color)
                         ORDER BY g.name) AS list
           FROM thread_tags tt
           JOIN tags g ON g.id = tt.tag_id AND g.deleted_at IS NULL
          WHERE tt.thread_id = t.id
       ) tags ON true
      WHERE t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND p.archived_at IS NULL
        AND t.assignee_user_id = $2
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        ${options.includeCompleted ? '' : 'AND t.progress < 100'}
      ORDER BY t.ends_on ASC NULLS LAST, p.key, t.number`,
    [scope.organizationId, scope.userId, scope.timezone],
  );
  return many(assignedRow, result, 'listAssignedThreads');
}
