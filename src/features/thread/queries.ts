import type pg from 'pg';
import { z } from 'zod';
import {
  nextThreadNumber,
  type OrgScope,
  orgAdminExists,
  pool,
  transaction,
  VISIBLE_PROJECT_IDS,
} from '#lib/db.ts';
import { dateColumn, many, one } from '#lib/row.ts';

/* ==========================================================================
   スレッドの読み書き

   このファイルは、データにさわる関数の書き方の見本でもある。
   守っていることは三つ。

   1. 組織のスコープを第一引数に取る。呼ぶ側が条件を足すかどうかに依存しない
   2. 閲覧できるプロジェクトの判定は VISIBLE_PROJECT_IDS にだけ書く
   3. 一覧は一回のクエリで取る。行ごとにクエリを投げない

   誰が書けるかは、閲覧できるかどうかと同じである。
   見えている人は、立てられるし、直せるし、畳める。
   ここだけ別の線を引くと、質問を立てられない人が生まれる。

   例外は削除だけで、組織管理者に残してある。

   仕様は docs/features/thread/index.html にある。
   ========================================================================== */

export const threadType = z.enum(['kadai', 'giron', 'shitsumon']);
export type ThreadType = z.infer<typeof threadType>;

/**
 * 操作が通らなかった理由。
 *
 * 「できませんでした」で済ませると、畳んであるのか、
 * 期間の入れ方が違うのかが分からず、同じ操作を繰り返すことになる。
 */
export type ThreadProblem =
  | 'forbidden'
  | 'not-found'
  | 'archived'
  | 'not-archived'
  | 'project-archived'
  | 'invalid-title'
  | 'invalid-progress'
  | 'invalid-period'
  | 'period-not-allowed'
  | 'parent-not-found'
  | 'parent-cycle'
  | 'parent-archived'
  | 'not-org-member';

export type ThreadChange = { ok: true } | { ok: false; reason: ThreadProblem };

/**
 * 書き込める状態にあるスレッドの条件。threads を t と呼んでいることを前提にする。
 *
 * 畳んだスレッドと、畳んだプロジェクトの中身は読み取り専用である。
 * プロジェクトを畳んでも個々の archived_at は書き換えないので、
 * ここで両方を見なければ、畳んだプロジェクトの中身が書き換えられる。
 *
 * $1 = organization_id, $2 = user_id
 */
const WRITABLE = `t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        AND EXISTS (SELECT 1 FROM projects wp
                     WHERE wp.id = t.project_id AND wp.archived_at IS NULL)`;

/* --------------------------------------------------------------------------
   一覧
   -------------------------------------------------------------------------- */

const threadRow = z.object({
  id: z.uuid(),
  number: z.number().int(),
  projectKey: z.string(),
  type: threadType,
  title: z.string(),
  progress: z.number().int().min(0).max(100),
  startsOn: dateColumn.nullable(),
  endsOn: dateColumn.nullable(),
  assigneeUserId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  parentNumber: z.number().int().nullable(),
  childCount: z.number().int(),
  archived: z.boolean(),
  /** 親の期間の外に出ている。親子の両方に期間があるときだけ真になる。 */
  overflow: z.boolean(),
  updatedAt: z.date(),
  tags: z.array(z.object({ name: z.string(), color: z.string() })),
});

export type ThreadRow = z.infer<typeof threadRow>;

export type ThreadFilters = {
  readonly type?: ThreadType;
  readonly assigneeUserId?: string;
  /** 担当者が付いていないものだけを出す。assigneeUserId とは併用しない。 */
  readonly unassigned?: boolean;
  readonly tagId?: string;
  /** 進捗率 100 のものを含めるか。既定では隠す。 */
  readonly includeCompleted?: boolean;
  /** アーカイブ済みを含めるか。既定では隠す。 */
  readonly includeArchived?: boolean;
};

/*
 * 一覧と親子の共通部分。
 *
 * 一覧、子スレッド、詳細の親欄で同じ形の行が要る。
 * 書き写すと、はみ出しの判定だけ片方が古い、という状態が起きる。
 */
const ROW_SELECT = `t.id,
            t.number,
            p.key                       AS "projectKey",
            t.type,
            t.title,
            t.progress,
            t.starts_on                 AS "startsOn",
            t.ends_on                   AS "endsOn",
            t.assignee_user_id          AS "assigneeUserId",
            u.display_name              AS "assigneeName",
            parent.number               AS "parentNumber",
            children.count::int         AS "childCount",
            (t.archived_at IS NOT NULL) AS archived,
            (parent.starts_on IS NOT NULL
             AND t.starts_on IS NOT NULL
             AND (t.starts_on < parent.starts_on
                  OR t.ends_on > parent.ends_on)) AS overflow,
            t.updated_at                AS "updatedAt",
            COALESCE(tags.list, '[]'::json) AS tags`;

const ROW_FROM = `threads t
       JOIN projects p        ON p.id = t.project_id
       LEFT JOIN users u      ON u.id = t.assignee_user_id
       LEFT JOIN threads parent
              ON parent.id = t.parent_thread_id AND parent.deleted_at IS NULL
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
       ) tags ON true`;

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
  if (filters.unassigned) {
    where.push('t.assignee_user_id IS NULL');
  } else if (filters.assigneeUserId) {
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
    `SELECT ${ROW_SELECT}
       FROM ${ROW_FROM}
      WHERE ${where.join('\n        AND ')}
      ORDER BY t.updated_at DESC
      LIMIT 200`,
    params,
  );

  return many(threadRow, result, 'listThreads');
}

/**
 * 子スレッドを並べる。
 *
 * 一覧と違って、畳んだものも完了したものも出す。
 * 親の画面から子が消えると、そこにぶら下がっていた事実まで消える。
 */
export async function listChildren(scope: OrgScope, threadId: string): Promise<ThreadRow[]> {
  const result = await pool.query(
    `SELECT ${ROW_SELECT}
       FROM ${ROW_FROM}
      WHERE t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        AND t.parent_thread_id = $3
      ORDER BY t.number`,
    [scope.organizationId, scope.userId, threadId],
  );
  return many(threadRow, result, 'listChildren');
}

/* --------------------------------------------------------------------------
   一件
   -------------------------------------------------------------------------- */

const threadDetail = z.object({
  id: z.uuid(),
  number: z.number().int(),
  projectId: z.uuid(),
  projectKey: z.string(),
  projectName: z.string(),
  type: threadType,
  title: z.string(),
  body: z.string(),
  bodyEditedAt: z.date().nullable(),
  progress: z.number().int().min(0).max(100),
  startsOn: dateColumn.nullable(),
  endsOn: dateColumn.nullable(),
  assigneeUserId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  parentNumber: z.number().int().nullable(),
  parentTitle: z.string().nullable(),
  childCount: z.number().int(),
  archived: z.boolean(),
  /** プロジェクトごと畳まれている。個々の archived_at とは別に見る。 */
  projectArchived: z.boolean(),
  createdByName: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  /** 自分が親の期間からはみ出している。 */
  overflow: z.boolean(),
  /** 子のどれかが自分の期間からはみ出している。 */
  childOverflow: z.boolean(),
});

export type ThreadDetail = z.infer<typeof threadDetail>;

/** 書ける状態か。閲覧できることは、ここに辿り着いた時点で確定している。 */
export function writable(thread: ThreadDetail): boolean {
  return !thread.archived && !thread.projectArchived;
}

/**
 * プロジェクトキーと番号からスレッドを引く。閲覧できなければ null。
 *
 * 番号は組織の中で通しなので、別のプロジェクトの番号を入れても引けない。
 * 存在しない番号と、見えないプロジェクトの番号を区別しない。
 */
export async function resolveThread(
  scope: OrgScope,
  projectId: string,
  number: number,
): Promise<ThreadDetail | null> {
  const result = await pool.query(
    `SELECT t.id,
            t.number,
            t.project_id                AS "projectId",
            p.key                       AS "projectKey",
            p.name                      AS "projectName",
            t.type,
            t.title,
            t.body,
            t.body_edited_at            AS "bodyEditedAt",
            t.progress,
            t.starts_on                 AS "startsOn",
            t.ends_on                   AS "endsOn",
            t.assignee_user_id          AS "assigneeUserId",
            u.display_name              AS "assigneeName",
            parent.number               AS "parentNumber",
            parent.title                AS "parentTitle",
            children.count::int         AS "childCount",
            (t.archived_at IS NOT NULL) AS archived,
            (p.archived_at IS NOT NULL) AS "projectArchived",
            author.display_name         AS "createdByName",
            t.created_at                AS "createdAt",
            t.updated_at                AS "updatedAt",
            (parent.starts_on IS NOT NULL
             AND t.starts_on IS NOT NULL
             AND (t.starts_on < parent.starts_on
                  OR t.ends_on > parent.ends_on)) AS overflow,
            EXISTS (SELECT 1 FROM threads c
                     WHERE c.parent_thread_id = t.id
                       AND c.deleted_at IS NULL
                       AND c.starts_on IS NOT NULL
                       AND t.starts_on IS NOT NULL
                       AND (c.starts_on < t.starts_on
                            OR c.ends_on > t.ends_on)) AS "childOverflow"
       FROM threads t
       JOIN projects p       ON p.id = t.project_id
       JOIN users author     ON author.id = t.created_by_user_id
       LEFT JOIN users u     ON u.id = t.assignee_user_id
       LEFT JOIN threads parent
              ON parent.id = t.parent_thread_id AND parent.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT count(*) AS count
           FROM threads c
          WHERE c.parent_thread_id = t.id AND c.deleted_at IS NULL
       ) children ON true
      WHERE t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        AND t.project_id = $3
        AND t.number = $4`,
    [scope.organizationId, scope.userId, projectId, number],
  );
  return one(threadDetail, result, 'resolveThread');
}

/* --------------------------------------------------------------------------
   入力の検査

   種別によって使える欄が変わる。制約はデータベース側にもあるが、
   例外を握って理由に直すより、先に見たほうが読める。
   -------------------------------------------------------------------------- */

export type Period = { readonly startsOn: string | null; readonly endsOn: string | null };

function checkProgress(type: ThreadType, progress: number): ThreadProblem | null {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    return 'invalid-progress';
  }
  // 議論と質問はオープンとクローズしか取らない。40%の議論に意味がない。
  if (type !== 'kadai' && progress !== 0 && progress !== 100) {
    return 'invalid-progress';
  }
  return null;
}

function checkPeriod(type: ThreadType, period: Period): ThreadProblem | null {
  const { startsOn, endsOn } = period;
  if (startsOn === null && endsOn === null) {
    return null;
  }
  if (type !== 'kadai') {
    return 'period-not-allowed';
  }
  // 片方だけ入れられると、ガントに置けるのか置けないのかが決まらない。
  if (startsOn === null || endsOn === null) {
    return 'invalid-period';
  }
  if (startsOn > endsOn) {
    return 'invalid-period';
  }
  return null;
}

/* --------------------------------------------------------------------------
   作る
   -------------------------------------------------------------------------- */

export type CreateThread = {
  readonly type: ThreadType;
  readonly title: string;
  readonly body: string;
  /** 親のスレッド番号。同じプロジェクトのものに限る。 */
  readonly parentNumber: number | null;
  readonly assigneeUserId: string | null;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
};

export type CreateResult = { ok: true; number: number } | { ok: false; reason: ThreadProblem };

/**
 * スレッドを立てる。プロジェクトを閲覧できる人なら誰でも立てられる。
 *
 * 番号の採番と挿入は同じトランザクションに入れる。
 * 分けると、採番したあとで挿入が落ちたときに欠番が増える。
 * 番号が飛ぶ理由を「別のプロジェクトが使った」だけに保ちたい。
 */
export async function createThread(
  scope: OrgScope,
  projectId: string,
  input: CreateThread,
): Promise<CreateResult> {
  const title = input.title.trim();
  if (title === '') {
    return { ok: false, reason: 'invalid-title' };
  }

  const bad = checkPeriod(input.type, input);
  if (bad) {
    return { ok: false, reason: bad };
  }

  return transaction(async (client) => {
    // 畳んだプロジェクトには足せない。閲覧できることも、ここで確かめる。
    const project = await client.query(
      `SELECT 1 FROM projects p
        WHERE p.id = $3 AND p.archived_at IS NULL AND p.id IN (${VISIBLE_PROJECT_IDS})`,
      [scope.organizationId, scope.userId, projectId],
    );
    if (project.rowCount === 0) {
      return { ok: false, reason: 'not-found' };
    }

    let parentId: string | null = null;
    if (input.parentNumber !== null) {
      const found = await client.query<{ id: string; archived: boolean }>(
        `SELECT id, (archived_at IS NOT NULL) AS archived
           FROM threads
          WHERE organization_id = $1 AND project_id = $2 AND number = $3
            AND deleted_at IS NULL`,
        [scope.organizationId, projectId, input.parentNumber],
      );
      const parent = found.rows[0];
      // 親がプロジェクトの外に居る場合もここに落ちる。番号は組織で通しなので、
      // 別プロジェクトの番号を打ち込める。親子はプロジェクトをまたげない。
      if (!parent) {
        return { ok: false, reason: 'parent-not-found' };
      }
      if (parent.archived) {
        return { ok: false, reason: 'parent-archived' };
      }
      parentId = parent.id;
    }

    if (input.assigneeUserId !== null) {
      const ok = await isAssignable(client, scope.organizationId, input.assigneeUserId);
      if (!ok) {
        return { ok: false, reason: 'not-org-member' };
      }
    }

    const number = await nextThreadNumber(client, scope.organizationId);

    await client.query(
      `INSERT INTO threads
         (organization_id, project_id, number, type, title, body,
          parent_thread_id, assignee_user_id, starts_on, ends_on, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        scope.organizationId,
        projectId,
        number,
        input.type,
        title,
        input.body,
        parentId,
        input.assigneeUserId,
        input.startsOn,
        input.endsOn,
        scope.userId,
      ],
    );

    return { ok: true, number };
  });
}

/* --------------------------------------------------------------------------
   直す
   -------------------------------------------------------------------------- */

/**
 * タイトルと本文を書き換える。
 *
 * 履歴は残さない。残すのは「編集済み」の印と、その時刻だけである。
 * 本文は現在の定義であって発言ではないので、書き換わってよい。
 * ただし黙って書き換わると、それを前提に書かれたコメントが宙に浮く。
 * body_edited_at は、その食い違いに気づくための最低限の手がかりである。
 */
export async function editThreadText(
  scope: OrgScope,
  threadId: string,
  title: string,
  body: string,
): Promise<ThreadChange> {
  const trimmed = title.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'invalid-title' };
  }

  const { rowCount } = await pool.query(
    `UPDATE threads t
        SET title = $4, body = $5, body_edited_at = now(), updated_at = now()
      WHERE t.id = $3 AND ${WRITABLE}`,
    [scope.organizationId, scope.userId, threadId, trimmed, body],
  );
  return rowCount === 1 ? { ok: true } : { ok: false, reason: await whyNot(scope, threadId) };
}

/**
 * 進捗率を入れる。議論と質問は 0 か 100 しか取らない。
 *
 * 種別ごとの範囲は CHECK 制約でも守られている。
 * それでも先に読むのは、制約違反の例外を握って理由に直すより、
 * 「その値は種別に合わない」と返したほうが画面に出しやすいためである。
 */
export async function setProgress(
  scope: OrgScope,
  threadId: string,
  progress: number,
): Promise<ThreadChange> {
  const { rows } = await pool.query<{ type: ThreadType }>(
    `SELECT t.type FROM threads t WHERE t.id = $3 AND ${WRITABLE}`,
    [scope.organizationId, scope.userId, threadId],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, reason: await whyNot(scope, threadId) };
  }

  const bad = checkProgress(row.type, progress);
  if (bad) {
    return { ok: false, reason: bad };
  }

  const { rowCount } = await pool.query(
    `UPDATE threads t
        SET progress = $4, updated_at = now()
      WHERE t.id = $3 AND ${WRITABLE}`,
    [scope.organizationId, scope.userId, threadId, progress],
  );
  return rowCount === 1 ? { ok: true } : { ok: false, reason: await whyNot(scope, threadId) };
}

/** 担当者を差し替える。null で外す。 */
export async function setAssignee(
  scope: OrgScope,
  threadId: string,
  userId: string | null,
): Promise<ThreadChange> {
  if (userId !== null) {
    const ok = await isAssignable(pool, scope.organizationId, userId);
    if (!ok) {
      return { ok: false, reason: 'not-org-member' };
    }
  }

  const { rowCount } = await pool.query(
    `UPDATE threads t
        SET assignee_user_id = $4, updated_at = now()
      WHERE t.id = $3 AND ${WRITABLE}`,
    [scope.organizationId, scope.userId, threadId, userId],
  );
  return rowCount === 1 ? { ok: true } : { ok: false, reason: await whyNot(scope, threadId) };
}

/**
 * 期間を入れる。課題だけが持てる。
 *
 * 親からはみ出していても止めない。はみ出し警告は事実を伝えるだけで、
 * どう直すかは人が決める。ここで弾くと、親の締切を延ばす前に
 * 子の日付を入れられなくなる。
 */
export async function setPeriod(
  scope: OrgScope,
  threadId: string,
  period: Period,
): Promise<ThreadChange> {
  const { rows } = await pool.query<{ type: ThreadType }>(
    `SELECT t.type FROM threads t WHERE t.id = $3 AND ${WRITABLE}`,
    [scope.organizationId, scope.userId, threadId],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, reason: await whyNot(scope, threadId) };
  }

  const bad = checkPeriod(row.type, period);
  if (bad) {
    return { ok: false, reason: bad };
  }

  const { rowCount } = await pool.query(
    `UPDATE threads t
        SET starts_on = $4, ends_on = $5, updated_at = now()
      WHERE t.id = $3 AND ${WRITABLE}`,
    [scope.organizationId, scope.userId, threadId, period.startsOn, period.endsOn],
  );
  return rowCount === 1 ? { ok: true } : { ok: false, reason: await whyNot(scope, threadId) };
}

/**
 * 親を付け替える。番号で指す。null で外す。
 *
 * 循環参照は CHECK 制約では書けない。
 * 親から上へ辿って自分が現れないことを、ここで確かめる。
 * 確かめてから書くまでの隙間に別の付け替えが入りうるので、
 * 同じトランザクションの中で行い、辿る側で行を掴んでおく。
 */
export async function setParent(
  scope: OrgScope,
  threadId: string,
  parentNumber: number | null,
): Promise<ThreadChange> {
  return transaction(async (client) => {
    const self = await client.query<{ projectId: string }>(
      `SELECT t.project_id AS "projectId" FROM threads t WHERE t.id = $3 AND ${WRITABLE}`,
      [scope.organizationId, scope.userId, threadId],
    );
    const here = self.rows[0];
    if (!here) {
      return { ok: false, reason: await whyNot(scope, threadId) };
    }

    if (parentNumber === null) {
      await client.query(
        `UPDATE threads SET parent_thread_id = NULL, updated_at = now() WHERE id = $1`,
        [threadId],
      );
      return { ok: true };
    }

    const found = await client.query<{ id: string; archived: boolean }>(
      `SELECT id, (archived_at IS NOT NULL) AS archived
         FROM threads
        WHERE organization_id = $1 AND project_id = $2 AND number = $3
          AND deleted_at IS NULL
        FOR UPDATE`,
      [scope.organizationId, here.projectId, parentNumber],
    );
    const parent = found.rows[0];
    if (!parent) {
      return { ok: false, reason: 'parent-not-found' };
    }
    if (parent.archived) {
      return { ok: false, reason: 'parent-archived' };
    }
    if (parent.id === threadId) {
      return { ok: false, reason: 'parent-cycle' };
    }

    /*
     * 親から上へ辿る。自分が現れたら、その付け替えは輪を作る。
     *
     * 深さを 50 で切っているのは、万一データが輪になっていたときに
     * この問い合わせが返らなくなるのを避けるためである。
     * 仕様としての階層の上限ではない
     * （docs/database/threads/index.html に同じ値で書いてある）。
     */
    const loop = await client.query(
      `WITH RECURSIVE up(id, parent_id, depth) AS (
         SELECT id, parent_thread_id, 1 FROM threads WHERE id = $1
         UNION ALL
         SELECT t.id, t.parent_thread_id, up.depth + 1
           FROM threads t JOIN up ON t.id = up.parent_id
          WHERE up.depth < 50
       )
       SELECT 1 FROM up WHERE id = $2`,
      [parent.id, threadId],
    );
    if ((loop.rowCount ?? 0) > 0) {
      return { ok: false, reason: 'parent-cycle' };
    }

    await client.query(
      `UPDATE threads SET parent_thread_id = $2, updated_at = now() WHERE id = $1`,
      [threadId, parent.id],
    );
    return { ok: true };
  });
}

/* --------------------------------------------------------------------------
   畳む、消す
   -------------------------------------------------------------------------- */

/**
 * 畳む、あるいは戻す。
 *
 * 子には連鎖しない。親が終わっていても、子がまだ動いていることがある。
 * 代わりに、活動中の子を持つ親は一覧に読み取り専用として残す（listThreads）。
 */
export async function setThreadArchived(
  scope: OrgScope,
  threadId: string,
  archived: boolean,
): Promise<ThreadChange> {
  const { rowCount } = await pool.query(
    `UPDATE threads t
        SET archived_at = CASE WHEN $4 THEN now() ELSE NULL END,
            updated_at = now()
      WHERE t.id = $3
        AND t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        -- 畳んだプロジェクトの中では、畳むことも戻すこともできない
        AND EXISTS (SELECT 1 FROM projects wp
                     WHERE wp.id = t.project_id AND wp.archived_at IS NULL)`,
    [scope.organizationId, scope.userId, threadId, archived],
  );
  return rowCount === 1 ? { ok: true } : { ok: false, reason: await whyNot(scope, threadId) };
}

/**
 * 論理削除する。組織管理者だけが、畳んだあとにだけ行える。
 *
 * ここだけ他の操作と線が違う。
 * 番号は欠番のまま残るが、辿れるものが消える操作である以上、
 * 見える人全員に開く理由がない。
 */
export async function deleteThread(scope: OrgScope, threadId: string): Promise<ThreadChange> {
  const { rowCount } = await pool.query(
    `UPDATE threads t
        SET deleted_at = now(), updated_at = now()
      WHERE t.id = $3
        AND t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.archived_at IS NOT NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        AND ${orgAdminExists('$1', '$2')}`,
    [scope.organizationId, scope.userId, threadId],
  );
  if (rowCount === 1) {
    return { ok: true };
  }

  const { rows } = await pool.query<{ archived: boolean; admin: boolean }>(
    `SELECT (t.archived_at IS NOT NULL) AS archived,
            ${orgAdminExists('$1', '$2')} AS admin
       FROM threads t
      WHERE t.id = $3
        AND t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})`,
    [scope.organizationId, scope.userId, threadId],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, reason: 'not-found' };
  }
  if (!row.admin) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: false, reason: 'not-archived' };
}

/* --------------------------------------------------------------------------
   通らなかった理由
   -------------------------------------------------------------------------- */

/**
 * 更新が 0 行だったときに、もう一度だけ読んで理由を確かめる。
 *
 * 失敗したときにしか引かないので、通る経路は一回のままである。
 */
async function whyNot(scope: OrgScope, threadId: string): Promise<ThreadProblem> {
  const { rows } = await pool.query<{ archived: boolean; projectArchived: boolean }>(
    `SELECT (t.archived_at IS NOT NULL) AS archived,
            (p.archived_at IS NOT NULL) AS "projectArchived"
       FROM threads t
       JOIN projects p ON p.id = t.project_id
      WHERE t.id = $3
        AND t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})`,
    [scope.organizationId, scope.userId, threadId],
  );
  const row = rows[0];
  if (!row) {
    // 消えているか、そもそも見えていない。区別しない。
    return 'not-found';
  }
  if (row.projectArchived) {
    return 'project-archived';
  }
  if (row.archived) {
    return 'archived';
  }
  return 'not-found';
}

/** 担当者に置けるのは、その組織に今いる人だけである。 */
async function isAssignable(
  client: pg.Pool | pg.PoolClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM organization_members om
       JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
      WHERE om.organization_id = $1 AND om.user_id = $2 AND om.deleted_at IS NULL`,
    [organizationId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}
