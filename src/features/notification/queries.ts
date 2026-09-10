import type pg from 'pg';
import { z } from 'zod';
import {
  type OrgScope,
  orgNotFrozen,
  pool,
  VISIBLE_PROJECT_IDS,
  visibleProjectIds,
} from '#lib/db.ts';
import { many, one } from '#lib/row.ts';

/* ==========================================================================
   通知とウォッチ

   行を作るのは、コメントの投稿とスレッドの担当者設定である。
   どちらも自分の取引の途中で呼ぶので、書く側の関数はクライアントを受け取る。
   分けて後から積むと、コメントは残ったのに通知だけ飛ばなかった状態が起きる。

   宛先を絞る判定は、このファイルにだけ置く。
   ウォッチの行は、そのプロジェクトが見えなくなっても残る。
   公開だったプロジェクトが非公開に変わる経路と、
   メンバーから外される経路の二つがある。
   絞らなければ、読めないスレッドの通知が積まれ続ける。

   読む側でも同じ判定をかける。二重だが、片方は役割が違う。
   書く側は行を積ませないためで、読む側は最後の砦である。
   メールは積まれた行から文面を作るので、書く側を抜かすとそこが漏れる。

   仕様は docs/features/notification/index.html にある。
   ========================================================================== */

export type NotificationProblem = 'forbidden' | 'not-found';

export type WatchChange = { ok: true } | { ok: false; reason: NotificationProblem };

export const notificationKind = z.enum(['mention', 'assigned', 'comment']);
export type NotificationKind = z.infer<typeof notificationKind>;

/* --------------------------------------------------------------------------
   書く

   どの関数も、送り主自身には行を作らない。
   notifications_not_self が同じことを拒むが、制約違反で例外が飛ぶと
   投稿そのものが落ちる。ここで先に外す。
   -------------------------------------------------------------------------- */

type Fanout = {
  /** 通知の対象になったスレッド。 */
  readonly threadId: string;
  /** そのスレッドが属するプロジェクト。宛先を絞るのに使う。 */
  readonly projectId: string;
  /** メンションとコメントでは必須。担当者の設定では null。 */
  readonly commentId: string | null;
};

/**
 * 名指しの相手へ通知を作る。メンションと、担当者に設定されたときの二つ。
 *
 * 宛先はすでに絞られていることが多い（メンションの候補は
 * プロジェクトを閲覧できる人しか出ない）。それでも、ここでもう一度見る。
 * 候補の一覧を出した時刻と、投稿された時刻のあいだに権限は動きうる。
 */
export async function notifyUsers(
  client: pg.PoolClient,
  scope: OrgScope,
  kind: NotificationKind,
  fanout: Fanout,
  userIds: readonly string[],
): Promise<void> {
  const targets = [...new Set(userIds)].filter((id) => id !== scope.userId);
  if (targets.length === 0) {
    return;
  }

  await client.query(
    `INSERT INTO notifications
            (organization_id, user_id, kind, thread_id, comment_id, actor_user_id)
          SELECT $1, r.user_id, $5, $2, $3, $4
            FROM unnest($6::uuid[]) AS r(user_id)
           WHERE $7::uuid IN (${visibleProjectIds('$1', 'r.user_id')})`,
    [
      scope.organizationId,
      fanout.threadId,
      fanout.commentId,
      scope.userId,
      kind,
      targets,
      fanout.projectId,
    ],
  );
}

/**
 * ウォッチしている人へ通知を作る。
 *
 * すでに名指しで届く人は外す。同じコメントで二度知らせても、
 * 二度目に新しい情報がない。
 */
export async function notifyWatchers(
  client: pg.PoolClient,
  scope: OrgScope,
  fanout: Fanout,
  exclude: readonly string[] = [],
): Promise<void> {
  await client.query(
    `INSERT INTO notifications
            (organization_id, user_id, kind, thread_id, comment_id, actor_user_id)
          SELECT $1, w.user_id, 'comment', $2, $3, $4
            FROM watches w
           WHERE w.thread_id = $2
             AND w.user_id <> $4
             AND w.user_id <> ALL($5::uuid[])
             AND $6::uuid IN (${visibleProjectIds('$1', 'w.user_id')})`,
    [
      scope.organizationId,
      fanout.threadId,
      fanout.commentId,
      scope.userId,
      [...exclude],
      fanout.projectId,
    ],
  );
}

/* --------------------------------------------------------------------------
   読む
   -------------------------------------------------------------------------- */

const notificationRow = z.object({
  id: z.uuid(),
  kind: notificationKind,
  /** 誰がやったか。担当者の設定でも入る。行を消された人の分は null になりうる。 */
  actorName: z.string().nullable(),
  projectKey: z.string(),
  number: z.number().int(),
  title: z.string(),
  commentId: z.uuid().nullable(),
  /** コメントが消されていても通知は出す。指名された事実まで消さない。 */
  commentDeleted: z.boolean(),
  read: z.boolean(),
  createdAt: z.date(),
});

export type NotificationRow = z.infer<typeof notificationRow>;

/** 既読を何件まで残すか。未読は全部出すので、ここは過去を振り返る窓である。 */
export const READ_LIMIT = 20;

/*
 * 通知の一覧に出せる行。
 *
 * 消されたスレッドの通知は出さない。飛んだ先が無いためである。
 * 畳まれただけのものは出す。読めるので、行き先は残っている。
 */
const LISTABLE = `notifications n
       JOIN threads t   ON t.id = n.thread_id AND t.deleted_at IS NULL
       JOIN projects p  ON p.id = t.project_id
       LEFT JOIN users a   ON a.id = n.actor_user_id
       LEFT JOIN comments c ON c.id = n.comment_id
      WHERE n.organization_id = $1
        AND n.user_id = $2
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})`;

/**
 * 自分あての通知。未読は全部、既読は直近だけ。
 *
 * 未読と既読を混ぜて時系列一本にする。未読だけを上に固めると、
 * 消化したあとに画面の上半分が空になる。
 */
export async function listNotifications(scope: OrgScope): Promise<NotificationRow[]> {
  const result = await pool.query(
    `WITH listable AS (
       SELECT n.id,
              n.kind,
              a.display_name              AS "actorName",
              p.key                       AS "projectKey",
              t.number,
              t.title,
              n.comment_id                AS "commentId",
              (c.id IS NOT NULL AND c.deleted_at IS NOT NULL) AS "commentDeleted",
              (n.read_at IS NOT NULL)     AS "read",
              n.created_at                AS "createdAt"
         FROM ${LISTABLE}
     )
     SELECT * FROM listable WHERE NOT "read"
      UNION ALL
     SELECT * FROM (
       SELECT * FROM listable WHERE "read" ORDER BY "createdAt" DESC LIMIT ${READ_LIMIT}
     ) recent
      ORDER BY "createdAt" DESC, id`,
    [scope.organizationId, scope.userId],
  );
  return many(notificationRow, result, 'listNotifications');
}

/**
 * 未読の件数。上帯のベルに出す。
 *
 * 組織の中のすべての画面がここを通る。数えるだけの問い合わせに留めてある。
 */
export async function countUnread(scope: OrgScope): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS count
       FROM ${LISTABLE}
        AND n.read_at IS NULL`,
    [scope.organizationId, scope.userId],
  );
  const row = one(z.object({ count: z.number().int() }), result, 'countUnread');
  return row?.count ?? 0;
}

const destination = z.object({
  projectKey: z.string(),
  number: z.number().int(),
  commentId: z.uuid().nullable(),
});

export type Destination = z.infer<typeof destination>;

/**
 * 通知を既読にして、行き先を返す。
 *
 * 行き先をフォームに書かせない。書かせると、他人のスレッドの番号を
 * 差し込んだうえで自分の通知を既読にする、という形が作れる。
 * 通知の行から引けば、行き先はその通知が指しているものだけになる。
 */
export async function openNotification(
  scope: OrgScope,
  notificationId: string,
): Promise<Destination | null> {
  const result = await pool.query(
    `UPDATE notifications n
        SET read_at = COALESCE(n.read_at, now())
       FROM threads t
       JOIN projects p ON p.id = t.project_id
      WHERE n.id = $3
        AND n.organization_id = $1
        AND n.user_id = $2
        AND t.id = n.thread_id
        AND t.deleted_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
        AND ${orgNotFrozen('$1')}
    RETURNING p.key AS "projectKey", t.number, n.comment_id AS "commentId"`,
    [scope.organizationId, scope.userId, notificationId],
  );
  return one(destination, result, 'openNotification');
}

/**
 * 未読をまとめて既読にする。
 *
 * 見えるものだけを対象にする。画面に出ていない行まで畳むと、
 * 「すべて」の指す範囲が押した人の見ているものとずれる。
 */
export async function markAllRead(scope: OrgScope): Promise<number> {
  const result = await pool.query(
    `UPDATE notifications n
        SET read_at = now()
      WHERE n.organization_id = $1
        AND n.user_id = $2
        AND n.read_at IS NULL
        AND EXISTS (
              SELECT 1
                FROM threads t
               WHERE t.id = n.thread_id
                 AND t.deleted_at IS NULL
                 AND t.project_id IN (${VISIBLE_PROJECT_IDS}))
        AND ${orgNotFrozen('$1')}`,
    [scope.organizationId, scope.userId],
  );
  return result.rowCount ?? 0;
}

/* --------------------------------------------------------------------------
   ウォッチ

   自動では付かない。押して初めて付く。
   自分あての設定なので、畳んだスレッドでも付け外しできる。
   畳んだ先にコメントは付かないから通知は飛ばないが、
   外す手段まで消えると、戻したときに困る。
   -------------------------------------------------------------------------- */

export async function isWatching(scope: OrgScope, threadId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM watches WHERE thread_id = $1 AND user_id = $2`,
    [threadId, scope.userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** ウォッチを付ける、あるいは外す。 */
export async function setWatch(
  scope: OrgScope,
  threadId: string,
  watching: boolean,
): Promise<WatchChange> {
  if (!watching) {
    /*
     * 外すのは、見えるかどうかに関わらず通す。自分の行を消すだけである。
     * ただし凍結中は通さない。読むための操作だが、実装としては書き込みで、
     * 例外を支払いの設定だけに絞ると決めてある。
     */
    await pool.query(
      `DELETE FROM watches w
         USING threads t
         WHERE w.thread_id = $3
           AND w.user_id = $2
           AND t.id = w.thread_id
           AND t.organization_id = $1
           AND ${orgNotFrozen('$1')}`,
      [scope.organizationId, scope.userId, threadId],
    );
    return { ok: true };
  }

  const { rowCount } = await pool.query(
    `INSERT INTO watches (thread_id, user_id)
          SELECT t.id, $2
            FROM threads t
           WHERE t.id = $3
             AND t.organization_id = $1
             AND t.deleted_at IS NULL
             AND t.project_id IN (${VISIBLE_PROJECT_IDS})
             AND ${orgNotFrozen('$1')}
     ON CONFLICT DO NOTHING`,
    [scope.organizationId, scope.userId, threadId],
  );

  // 0 件は「見えない」か「すでに付いている」のどちらかである。
  // 付いているなら、押した人の望む状態にはなっている。
  if (rowCount === 0 && !(await isWatching(scope, threadId))) {
    return { ok: false, reason: 'not-found' };
  }
  return { ok: true };
}
