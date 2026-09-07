import type pg from 'pg';
import { z } from 'zod';
import { notifyUsers, notifyWatchers } from '#features/notification/queries.ts';
import { THREAD_WRITABLE } from '#features/thread/queries.ts';
import {
  type OrgScope,
  orgAdminExists,
  pool,
  transaction,
  VISIBLE_PROJECT_IDS,
} from '#lib/db.ts';
import { type Candidate, findMentions, findTasks } from '#lib/markdown.ts';
import { many, one } from '#lib/row.ts';

/* ==========================================================================
   コメントの読み書き

   スレッドの下に、投稿順で一本に連なる。枝分かれはしない。
   そして一度書いたら直せない。

   直せないことが、このファイルの形を決めている。
   本文を書き換える関数が無いので、`comments` に `updated_at` も無い。
   チェックボックスの状態を本文に書けないので、別のテーブルに置いてある。
   メンションを表示のたびに解決し直せないので、投稿時に位置ごと記録する。

   誰が書けるかはスレッドと同じ線である。見えている人は書ける。
   例外は削除だけで、組織管理者に残してある。

   仕様は docs/features/comment/index.html にある。
   ========================================================================== */

export type CommentProblem =
  | 'forbidden'
  | 'not-found'
  | 'archived'
  | 'project-archived'
  | 'invalid-body'
  | 'no-such-check';

export type CommentChange = { ok: true } | { ok: false; reason: CommentProblem };

/* --------------------------------------------------------------------------
   指名できる人

   そのプロジェクトを閲覧できる人だけを候補にする。
   ここを広げると、非公開プロジェクトのスレッドのタイトルを含む通知が、
   そのプロジェクトを開けない人に届く。非公開という設定がそこで無効になる。

   VISIBLE_PROJECT_IDS が「その人に見えるプロジェクト」を返すのに対して、
   これは「そのプロジェクトが見える人」を返す。同じ判定を逆から引いている。
   二つが食い違わないことは tests/comment.test.ts で確かめてある。
   -------------------------------------------------------------------------- */

const candidate = z.object({ userId: z.uuid(), displayName: z.string() });

export async function listMentionCandidates(
  scope: OrgScope,
  projectId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<Candidate[]> {
  const result = await client.query(
    `SELECT u.id           AS "userId",
            u.display_name AS "displayName"
       FROM users u
       JOIN organization_members om
         ON om.user_id = u.id
        AND om.organization_id = $1
        AND om.deleted_at IS NULL
      WHERE u.deleted_at IS NULL
        -- 引く側にそのプロジェクトが見えていることが前提である
        AND $3::uuid IN (${VISIBLE_PROJECT_IDS})
        AND (
          EXISTS (SELECT 1 FROM projects p
                   WHERE p.id = $3 AND p.visibility = 'public')
          OR EXISTS (SELECT 1 FROM project_members pm
                      WHERE pm.project_id = $3
                        AND pm.user_id = u.id
                        AND pm.deleted_at IS NULL)
          OR om.role = 'admin'
        )
      ORDER BY u.display_name`,
    [scope.organizationId, scope.userId, projectId],
  );
  return many(candidate, result, 'listMentionCandidates');
}

/* --------------------------------------------------------------------------
   一覧
   -------------------------------------------------------------------------- */

const commentRow = z.object({
  id: z.uuid(),
  authorUserId: z.uuid(),
  authorName: z.string(),
  /** 消されたコメントでは空になる。中身はデータベースから出さない */
  body: z.string(),
  createdAt: z.date(),
  deleted: z.boolean(),
  /** 投稿時に解決した指名の位置。表示のときに包む範囲である */
  mentions: z.array(z.object({ start: z.number().int(), end: z.number().int() })),
  /** 入っているチェックボックスの番号 */
  checks: z.array(z.number().int()),
});

export type CommentRow = z.infer<typeof commentRow>;

/**
 * スレッドに連なるコメントを、古い順に返す。
 *
 * 消されたコメントも行としては返す。跡を残すためである。
 * 跡形もなく消すと、残ったコメントが宙に浮く。
 * 「賛成です」だけが残って、何に賛成したのか分からない列になる。
 *
 * ただし本文は返さない。跡に要るのは、誰がいつ書いたかまでである。
 */
export async function listComments(scope: OrgScope, threadId: string): Promise<CommentRow[]> {
  const result = await pool.query(
    `SELECT c.id,
            c.author_user_id            AS "authorUserId",
            u.display_name              AS "authorName",
            CASE WHEN c.deleted_at IS NULL THEN c.body ELSE '' END AS body,
            c.created_at                AS "createdAt",
            (c.deleted_at IS NOT NULL)  AS deleted,
            COALESCE(mentions.list, '[]'::json) AS mentions,
            COALESCE(checks.list, '[]'::json)   AS checks
       FROM comments c
       JOIN users u ON u.id = c.author_user_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('start', span.start_offset, 'end', span.end_offset)
                         ORDER BY span.start_offset) AS list
           FROM (SELECT DISTINCT cm.start_offset, cm.end_offset
                   FROM comment_mentions cm
                  WHERE cm.comment_id = c.id) span
       ) mentions ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(cc.position ORDER BY cc.position) AS list
           FROM comment_checks cc
          WHERE cc.comment_id = c.id
       ) checks ON true
      WHERE c.organization_id = $1
        AND c.thread_id = $3
        AND EXISTS (
              SELECT 1 FROM threads t
               WHERE t.id = c.thread_id
                 AND t.organization_id = $1
                 AND t.deleted_at IS NULL
                 AND t.project_id IN (${VISIBLE_PROJECT_IDS}))
      ORDER BY c.created_at, c.id`,
    [scope.organizationId, scope.userId, threadId],
  );
  return many(commentRow, result, 'listComments');
}

/* --------------------------------------------------------------------------
   投稿
   -------------------------------------------------------------------------- */

export type PostResult = { ok: true; id: string } | { ok: false; reason: CommentProblem };

/**
 * コメントを投稿する。
 *
 * 指名の解決と通知の作成を、投稿と同じトランザクションに入れる。
 * 分けると、コメントは残ったのに通知だけ飛ばなかった状態が起きる。
 * 相手はメンションで気づく前提なので、それは気づけないのと同じである。
 */
export async function postComment(
  scope: OrgScope,
  threadId: string,
  body: string,
): Promise<PostResult> {
  const text = body.trim();
  if (text === '') {
    return { ok: false, reason: 'invalid-body' };
  }

  return transaction(async (client) => {
    const writable = await client.query<{ projectId: string }>(
      `SELECT t.project_id AS "projectId"
         FROM threads t
        WHERE t.id = $3 AND ${THREAD_WRITABLE}`,
      [scope.organizationId, scope.userId, threadId],
    );
    const thread = writable.rows[0];
    if (!thread) {
      return { ok: false, reason: await whyNot(scope, threadId) };
    }

    const candidates = await listMentionCandidates(scope, thread.projectId, client);
    const mentions = findMentions(text, candidates);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO comments (organization_id, thread_id, author_user_id, body)
            VALUES ($1, $2, $3, $4)
         RETURNING id`,
      [scope.organizationId, threadId, scope.userId, text],
    );
    const commentId = inserted.rows[0]?.id;
    if (!commentId) {
      throw new Error('コメントの挿入が行を返しませんでした');
    }

    if (mentions.length > 0) {
      const starts: number[] = [];
      const ends: number[] = [];
      const users: string[] = [];
      for (const mention of mentions) {
        for (const userId of mention.userIds) {
          starts.push(mention.start);
          ends.push(mention.end);
          users.push(userId);
        }
      }
      await client.query(
        `INSERT INTO comment_mentions (comment_id, start_offset, end_offset, user_id)
              SELECT $1, s, e, u
                FROM unnest($2::int[], $3::int[], $4::uuid[]) AS m(s, e, u)`,
        [commentId, starts, ends, users],
      );
    }

    /*
     * 通知は二種類できる。指名された人と、ウォッチしている人である。
     * 両方に当たる人には指名のほうだけを作るので、ウォッチの側から外す。
     * 同じコメントで二度知らせても、二度目に新しい情報がない。
     *
     * 誰に届くかの判定は notification 側にある。ここには書かない。
     */
    const mentioned = [...new Set(mentions.flatMap((m) => m.userIds))];
    const fanout = { threadId, projectId: thread.projectId, commentId };

    await notifyUsers(client, scope, 'mention', fanout, mentioned);
    await notifyWatchers(client, scope, fanout, mentioned);

    return { ok: true, id: commentId };
  });
}

/* --------------------------------------------------------------------------
   チェックボックス
   -------------------------------------------------------------------------- */

/**
 * コメントの中のチェックボックスを入れる、あるいは外す。
 *
 * 本文には触らない。状態は comment_checks にある。
 * 押せるのは、そのプロジェクトを閲覧できる人なら誰でもである。
 * 書いた本人に限ると、担当が変わった作業に永遠にチェックが入らない。
 *
 * 番号は本文を数え直して確かめる。
 * フォームから届いた番号をそのまま入れると、
 * どこにも出ない行がテーブルに溜まる。
 */
export async function setCommentCheck(
  scope: OrgScope,
  commentId: string,
  position: number,
  checked: boolean,
): Promise<CommentChange> {
  const { rows } = await pool.query<{ body: string; threadId: string }>(
    `SELECT c.body, c.thread_id AS "threadId"
       FROM comments c
       JOIN threads t ON t.id = c.thread_id
      WHERE c.id = $3
        AND c.organization_id = $1
        AND c.deleted_at IS NULL
        AND ${THREAD_WRITABLE}`,
    [scope.organizationId, scope.userId, commentId],
  );
  const found = rows[0];
  if (!found) {
    return { ok: false, reason: await whyNotComment(scope, commentId) };
  }

  if (!Number.isInteger(position) || position < 0) {
    return { ok: false, reason: 'no-such-check' };
  }
  if (position >= findTasks(found.body).length) {
    return { ok: false, reason: 'no-such-check' };
  }

  if (checked) {
    await pool.query(
      `INSERT INTO comment_checks (comment_id, position, checked_by_user_id)
            VALUES ($1, $2, $3)
       ON CONFLICT (comment_id, position) DO NOTHING`,
      [commentId, position, scope.userId],
    );
  } else {
    await pool.query(`DELETE FROM comment_checks WHERE comment_id = $1 AND position = $2`, [
      commentId,
      position,
    ]);
  }
  return { ok: true };
}

/* --------------------------------------------------------------------------
   削除

   本人は消せない。組織管理者だけが消せる。
   消しても行は残り、跡として並ぶ。
   -------------------------------------------------------------------------- */

/**
 * コメントを論理削除する。組織管理者だけが行える。
 *
 * 動線はまだ画面に無い。機密情報の誤投稿のような場面で使うものなので、
 * 押す前に何を確かめさせるかを決めてから出す。
 */
export async function deleteComment(
  scope: OrgScope,
  commentId: string,
): Promise<CommentChange> {
  const { rowCount } = await pool.query(
    `UPDATE comments c
        SET deleted_at = now()
      WHERE c.id = $3
        AND c.organization_id = $1
        AND c.deleted_at IS NULL
        AND EXISTS (
              SELECT 1 FROM threads t
               WHERE t.id = c.thread_id
                 AND t.organization_id = $1
                 AND t.deleted_at IS NULL
                 AND t.project_id IN (${VISIBLE_PROJECT_IDS}))
        AND ${orgAdminExists('$1', '$2')}`,
    [scope.organizationId, scope.userId, commentId],
  );
  if (rowCount === 1) {
    return { ok: true };
  }
  return { ok: false, reason: scope.isOrgAdmin ? 'not-found' : 'forbidden' };
}

/* --------------------------------------------------------------------------
   通らなかった理由
   -------------------------------------------------------------------------- */

/** スレッドの側の事情を、失敗したときにだけ引き直す。 */
async function whyNot(scope: OrgScope, threadId: string): Promise<CommentProblem> {
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

const commentThread = z.object({ threadId: z.uuid() });

/** コメントの id しか手元にないときは、先にスレッドを引いてから理由を出す。 */
async function whyNotComment(scope: OrgScope, commentId: string): Promise<CommentProblem> {
  const result = await pool.query(
    `SELECT c.thread_id AS "threadId"
       FROM comments c
      WHERE c.id = $2 AND c.organization_id = $1 AND c.deleted_at IS NULL`,
    [scope.organizationId, commentId],
  );
  const row = one(commentThread, result, 'whyNotComment');
  return row ? await whyNot(scope, row.threadId) : 'not-found';
}
